import type { SearchQuery, SearchResponse } from '../shared/types';
import { queryToParams } from '../shared/validation';
import { demoSearch } from './demoApi';

export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export interface AppConfig {
  mode: 'mock' | 'live';
  affiliateEnabled: boolean;
  maxPages: number;
  development: boolean;
}

async function call<T>(path: string, token: string, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 45_000);
  signal?.addEventListener('abort', () => timeout.abort());
  let res: Response;
  try {
    res = await fetch(path, { headers, signal: timeout.signal, credentials: 'same-origin' });
  } catch {
    if (signal?.aborted) throw new ApiClientError('aborted', '中止しました', 0, false);
    throw new ApiClientError('network', 'サーバーに接続できませんでした。通信状況を確認してください', 0, true);
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Cloudflare Access のログイン画面（HTML）が返る場合など
    if (res.ok || res.redirected) {
      throw new ApiClientError('unexpected', 'サーバーの応答を解析できませんでした。再読み込みしてログインし直してください', res.status, false);
    }
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; retryable?: boolean } } | null)?.error;
    throw new ApiClientError(e?.code ?? 'http_error', e?.message ?? `エラーが発生しました（HTTP ${res.status}）`, res.status, Boolean(e?.retryable));
  }
  return body as T;
}

/** `vite build --mode demo` のときだけ true（ビルド時に定数化され、通常ビルドからは除去される） */
const DEMO = import.meta.env.MODE === 'demo';

export function fetchConfig(token: string): Promise<AppConfig> {
  if (DEMO) return Promise.resolve({ mode: 'mock', affiliateEnabled: false, maxPages: 3, development: true });
  return call<AppConfig>('/api/config', token);
}

export async function searchApi(q: SearchQuery, token: string, signal?: AbortSignal): Promise<SearchResponse> {
  if (DEMO) return demoSearch(q);
  return call<SearchResponse>(`/api/search?${queryToParams(q).toString()}`, token, signal);
}
