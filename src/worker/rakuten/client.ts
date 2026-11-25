/**
 * 楽天市場商品検索 API クライアント。
 * - 認証情報はクエリまたはヘッダーで送信し、ログ・エラーメッセージに含めない
 * - 1 リクエストずつ間隔を空けて取得（SpacingQueue）
 * - 429 / 5xx / タイムアウトのみ限定的に再試行
 */
import type { Product, SearchQuery } from '../../shared/types';
import { HITS_PER_PAGE } from '../../shared/validation';
import { DEFAULT_ENDPOINT, type Env } from '../env';
import { AppError } from '../lib/errors';
import { fetchWithRetry, TimeoutError, type FetchFn, type SleepFn } from '../lib/http';
import type { SpacingQueue } from '../lib/rateLimit';
import { mapSearchResponse, parseRakutenError } from './mapper';

export interface RakutenDeps {
  fetchFn?: FetchFn;
  sleepFn?: SleepFn;
  queue: SpacingQueue;
  now?: () => Date;
}

export interface RakutenSearchResult {
  products: Product[];
  totalCount: number;
  pageCount: number;
  fetchedPages: number;
  notices: string[];
}

/** API のページ上限（ドキュメント記載の最大ページ） */
const API_MAX_PAGE = 100;

export function buildSearchUrl(q: SearchQuery, page: number, env: Env): string {
  const endpoint = env.RAKUTEN_ENDPOINT || DEFAULT_ENDPOINT;
  const u = new URL(endpoint);
  if (u.protocol !== 'https:') throw new AppError('config', 'API エンドポイントの設定が不正です', 500);
  const p = u.searchParams;
  p.set('format', 'json');
  p.set('formatVersion', '2');
  p.set('applicationId', env.RAKUTEN_APPLICATION_ID ?? '');
  if ((env.RAKUTEN_ACCESS_KEY_TRANSPORT ?? 'query') !== 'header') {
    p.set('accessKey', env.RAKUTEN_ACCESS_KEY ?? '');
  }
  if (env.RAKUTEN_AFFILIATE_ID) p.set('affiliateId', env.RAKUTEN_AFFILIATE_ID);
  p.set('keyword', q.keyword);
  if (q.ngKeyword) p.set('NGKeyword', q.ngKeyword);
  if (q.minPrice !== undefined) p.set('minPrice', String(q.minPrice));
  if (q.maxPrice !== undefined) p.set('maxPrice', String(q.maxPrice));
  if (q.freeShippingOnly) p.set('postageFlag', '1');
  p.set('availability', q.inStockOnly === false ? '0' : '1');
  if (q.shopCode) p.set('shopCode', q.shopCode);
  if (q.minPointRate !== undefined) {
    p.set('pointRateFlag', '1');
    p.set('pointRate', String(q.minPointRate));
  }
  if (q.apiSort && q.apiSort !== 'standard') p.set('sort', q.apiSort);
  p.set('hits', String(HITS_PER_PAGE));
  p.set('page', String(page));
  return u.toString();
}

function buildHeaders(env: Env): Headers {
  const h = new Headers({ accept: 'application/json', 'user-agent': 'NetPriceWatch/0.1 (+personal price comparison)' });
  // 2026-07-01 版では Referer が無いとエラーになるとの報告があるため、アプリ登録時の許可サイトURLを送る
  if (env.RAKUTEN_REFERER) h.set('referer', env.RAKUTEN_REFERER);
  if (env.RAKUTEN_ACCESS_KEY_TRANSPORT === 'header' && env.RAKUTEN_ACCESS_KEY) {
    h.set('accessKey', env.RAKUTEN_ACCESS_KEY);
  }
  return h;
}

function mapHttpError(status: number, body: unknown): AppError {
  const parsed = parseRakutenError(body);
  const code = parsed?.code ?? '';
  // 秘密情報を含む可能性があるため上流のメッセージはそのまま返さず、コードのみ付加する
  const suffix = code ? `（${code.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 64)}）` : '';
  if (status === 429) return new AppError('upstream_rate_limited', `楽天APIのアクセス上限に達しました。少し待ってから再検索してください${suffix}`, 429, true);
  if (status === 401 || status === 403) return new AppError('upstream_auth', `楽天APIの認証に失敗しました。アプリID・アクセスキー・許可サイト（Referer）設定を確認してください${suffix}`, 502);
  if (status === 400 || status === 404) {
    if (/not_found/i.test(code)) return new AppError('upstream_not_found', `該当する商品が見つかりませんでした${suffix}`, 404);
    return new AppError('upstream_bad_request', `楽天APIが検索条件を受け付けませんでした${suffix}`, 400);
  }
  if (status >= 500) return new AppError('upstream_unavailable', `楽天APIが一時的に利用できません${suffix}`, 503, true);
  return new AppError('upstream_error', `楽天APIでエラーが発生しました（HTTP ${status}）${suffix}`, 502);
}

async function fetchPage(q: SearchQuery, page: number, env: Env, deps: RakutenDeps) {
  const url = buildSearchUrl(q, page, env);
  let res: Response;
  try {
    res = await deps.queue.run(() =>
      fetchWithRetry(url, { method: 'GET', headers: buildHeaders(env) }, { fetchFn: deps.fetchFn, sleepFn: deps.sleepFn }),
    );
  } catch (e) {
    if (e instanceof TimeoutError) throw new AppError('upstream_timeout', '楽天APIの応答がタイムアウトしました', 504, true);
    throw new AppError('upstream_network', '楽天APIに接続できませんでした', 502, true);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    if (res.ok) throw new AppError('upstream_invalid_response', '楽天APIの応答を解析できませんでした', 502);
  }
  if (!res.ok) throw mapHttpError(res.status, body);
  // 200 でもエラー形式の場合がある
  const err = parseRakutenError(body);
  if (err && !(body as Record<string, unknown>).Items) throw mapHttpError(400, body);
  return mapSearchResponse(body, (deps.now?.() ?? new Date()).toISOString());
}

export async function searchRakuten(q: SearchQuery, env: Env, deps: RakutenDeps): Promise<RakutenSearchResult> {
  if (!env.RAKUTEN_APPLICATION_ID || !env.RAKUTEN_ACCESS_KEY) {
    throw new AppError('not_configured', '楽天APIの認証情報が設定されていません', 503);
  }
  const notices: string[] = [];
  if (!env.RAKUTEN_REFERER) notices.push('RAKUTEN_REFERER が未設定です。楽天APIが Referer を要求する場合は失敗します');
  const wantPages = Math.min(q.pages ?? 1, API_MAX_PAGE);
  const products: Product[] = [];
  const seen = new Set<string>();
  let totalCount = 0;
  let pageCount = 0;
  let fetchedPages = 0;
  for (let page = 1; page <= wantPages; page++) {
    let result;
    try {
      result = await fetchPage(q, page, env, deps);
    } catch (e) {
      if (e instanceof AppError && e.code === 'upstream_not_found' && page === 1) {
        return { products: [], totalCount: 0, pageCount: 0, fetchedPages: 1, notices };
      }
      // 2 ページ目以降の失敗は取得済み分を返す
      if (page > 1 && e instanceof AppError) {
        notices.push(`${page}ページ目以降の取得に失敗したため、${page - 1}ページ分のみ表示しています`);
        break;
      }
      throw e;
    }
    fetchedPages = page;
    totalCount = result.count;
    pageCount = result.pageCount;
    for (const p of result.products) {
      if (!seen.has(p.itemCode)) {
        seen.add(p.itemCode);
        products.push(p);
      }
    }
    if (page >= result.pageCount) break;
  }
  return { products, totalCount, pageCount, fetchedPages, notices };
}
