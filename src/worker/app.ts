/**
 * API ルーター。/api/* のみ Worker で処理し、それ以外は静的アセットに委譲する。
 */
import type { SearchResponse } from '../shared/types';
import { MAX_PAGES, queryKey, validateSearchQuery, ValidationError } from '../shared/validation';
import { isDevelopment, resolveDataMode, type Env } from './env';
import { authenticate } from './lib/auth';
import { EdgeCache, getEdgeCache, InflightDeduper, MemoryCache, TieredCache, type JsonCache } from './lib/cache';
import { AppError } from './lib/errors';
import { sleep, type FetchFn, type SleepFn } from './lib/http';
import { SlidingWindowLimiter, SpacingQueue } from './lib/rateLimit';
import { searchRakuten } from './rakuten/client';
import { searchMock } from './rakuten/mock';

export const APP_VERSION = '0.1.0';

export interface AppDeps {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  now?: () => Date;
  cache?: JsonCache;
  limiter?: SlidingWindowLimiter;
  queue?: SpacingQueue;
  deduper?: InflightDeduper;
}

const SECURITY_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-robots-tag': 'noindex, nofollow',
  'cache-control': 'no-store',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...SECURITY_HEADERS, ...extra },
  });
}

function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    const extra: Record<string, string> = e.status === 429 ? { 'retry-after': '10' } : {};
    return json({ error: { code: e.code, message: e.message, retryable: e.retryable } }, e.status, extra);
  }
  if (e instanceof ValidationError) {
    return json({ error: { code: 'invalid_request', message: e.message, retryable: false } }, 400);
  }
  // 想定外のエラー: 詳細はクライアントに返さない
  console.error('unexpected error', e instanceof Error ? e.name : typeof e);
  return json({ error: { code: 'internal', message: 'サーバー内部でエラーが発生しました', retryable: true } }, 500);
}

export function createApp(deps: AppDeps = {}) {
  const sleepFn = deps.sleepFn ?? sleep;
  const now = deps.now ?? (() => new Date());
  const memory = new MemoryCache(100);
  const queue = deps.queue ?? new SpacingQueue(1100, sleepFn);
  const deduper = deps.deduper ?? new InflightDeduper();
  let limiter = deps.limiter ?? null;

  const getCache = (): JsonCache => {
    if (deps.cache) return deps.cache;
    const edge = getEdgeCache();
    return edge ? new TieredCache([memory, new EdgeCache(edge)]) : memory;
  };

  async function handleSearch(request: Request, env: Env, url: URL): Promise<Response> {
    const auth = await authenticate(request, env, deps.fetchFn as typeof fetch | undefined);

    // クライアント毎の検索回数制限（無料枠・API 枠の浪費防止）
    const perMinute = Number(env.SEARCH_LIMIT_PER_MINUTE ?? '20') || 20;
    limiter ??= new SlidingWindowLimiter(perMinute, 60_000);
    if (!limiter.take(auth.subject)) {
      throw new AppError('rate_limited', '検索回数が多すぎます。1分ほど待ってから再度お試しください', 429, true);
    }
    if (env.RATE_LIMITER) {
      const { success } = await env.RATE_LIMITER.limit({ key: auth.subject });
      if (!success) throw new AppError('rate_limited', '検索回数が多すぎます。少し待ってから再度お試しください', 429, true);
    }

    const query = validateSearchQuery(Object.fromEntries(url.searchParams));
    const mode = resolveDataMode(env);
    const affiliate = mode === 'live' && Boolean(env.RAKUTEN_AFFILIATE_ID);
    const key = `search:v1:${mode}:${affiliate ? 'aff' : 'noaff'}:${queryKey(query)}`;
    const ttl = Math.min(3600, Math.max(0, Number(env.CACHE_TTL_SECONDS ?? '600') || 0));
    const cache = getCache();

    const cached = await cache.get<SearchResponse>(key);
    if (cached) return json({ ...cached, cached: true });

    const result = await deduper.run(key, async (): Promise<SearchResponse> => {
      const fetchedAt = now().toISOString();
      const notices: string[] = [];
      let body: Omit<SearchResponse, 'notices' | 'cached' | 'mode' | 'query' | 'fetchedAt'>;
      if (mode === 'mock') {
        body = searchMock(query, now());
        notices.push('モックデータ（架空の商品）を表示しています。実際の楽天市場の商品・価格ではありません');
      } else {
        const r = await searchRakuten(query, env, { fetchFn: deps.fetchFn, sleepFn, queue, now });
        notices.push(...r.notices);
        body = r;
      }
      const response: SearchResponse = { mode, query, ...body, fetchedAt, cached: false, notices };
      await cache.set(key, response, ttl);
      return response;
    });
    return json(result);
  }

  return {
    async fetch(request: Request, env: Env): Promise<Response> {
      const url = new URL(request.url);
      if (!url.pathname.startsWith('/api/')) {
        if (env.ASSETS) return env.ASSETS.fetch(request);
        return new Response('Not found', { status: 404 });
      }
      try {
        if (request.method !== 'GET') {
          throw new AppError('method_not_allowed', '許可されていないメソッドです', 405);
        }
        switch (url.pathname) {
          case '/api/health':
            return json({ ok: true, version: APP_VERSION });
          case '/api/config': {
            await authenticate(request, env, deps.fetchFn as typeof fetch | undefined);
            const mode = resolveDataMode(env);
            return json({
              mode,
              affiliateEnabled: mode === 'live' && Boolean(env.RAKUTEN_AFFILIATE_ID),
              maxPages: MAX_PAGES,
              development: isDevelopment(env),
            });
          }
          case '/api/search':
            return await handleSearch(request, env, url);
          default:
            throw new AppError('not_found', 'API が見つかりません', 404);
        }
      } catch (e) {
        return errorResponse(e);
      }
    },
  };
}
