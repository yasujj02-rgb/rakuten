/**
 * 外部 API 取得の共通処理（タイムアウト・限定的な再試行）。
 * 楽天以外の情報収集サービスにも流用できるよう、API 固有の処理は含めない。
 */
export interface FetchPolicy {
  timeoutMs: number;
  /** 再試行回数（429 / 5xx / タイムアウトのみ） */
  retries: number;
  /** 再試行の基本待機時間 */
  backoffMs: number;
  /** Retry-After の最大採用秒数 */
  maxRetryAfterMs: number;
}

export const DEFAULT_POLICY: FetchPolicy = {
  timeoutMs: 8000,
  retries: 2,
  backoffMs: 1200,
  maxRetryAfterMs: 5000,
};

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
export type SleepFn = (ms: number) => Promise<void>;

export const sleep: SleepFn = (ms) => new Promise((r) => setTimeout(r, ms));

export class TimeoutError extends Error {
  constructor() {
    super('timeout');
    this.name = 'TimeoutError';
  }
}

export async function fetchWithTimeout(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) throw new TimeoutError();
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(res: Response, policy: FetchPolicy): number | null {
  const h = res.headers.get('retry-after');
  if (!h) return null;
  const sec = Number(h);
  if (Number.isFinite(sec)) return Math.min(policy.maxRetryAfterMs, Math.max(0, sec * 1000));
  return null;
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * 429・5xx・タイムアウト時のみ限定的に再試行する。
 * 最終的なレスポンス（失敗含む）を返し、ネットワーク例外・タイムアウトは投げる。
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { fetchFn?: FetchFn; sleepFn?: SleepFn; policy?: Partial<FetchPolicy> } = {},
): Promise<Response> {
  const policy = { ...DEFAULT_POLICY, ...opts.policy };
  const fetchFn = opts.fetchFn ?? ((u, i) => fetch(u, i));
  const sleepFn = opts.sleepFn ?? sleep;
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= policy.retries; attempt++) {
    try {
      const res = await fetchWithTimeout(fetchFn, url, init, policy.timeoutMs);
      if (!isRetryableStatus(res.status) || attempt === policy.retries) return res;
      const wait = retryAfterMs(res, policy) ?? policy.backoffMs * 2 ** attempt;
      await res.body?.cancel();
      await sleepFn(wait);
    } catch (e) {
      lastError = e;
      if (attempt === policy.retries) throw e;
      await sleepFn(policy.backoffMs * 2 ** attempt);
    }
  }
  throw lastError ?? new Error('fetch failed');
}
