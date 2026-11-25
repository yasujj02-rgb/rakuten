import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/worker/app';
import type { Env } from '../../src/worker/env';
import { MemoryCache } from '../../src/worker/lib/cache';
import { SlidingWindowLimiter, SpacingQueue } from '../../src/worker/lib/rateLimit';
import { fetchWithRetry, TimeoutError } from '../../src/worker/lib/http';
import { buildSearchUrl } from '../../src/worker/rakuten/client';
import { mapItem, mapSearchResponse, parseRakutenError, safeRakutenUrl } from '../../src/worker/rakuten/mapper';
import { _resetJwksCacheForTest, verifyAccessJwt } from '../../src/worker/lib/auth';

const noSleep = async () => {};
const LIVE_ENV: Env = {
  ENVIRONMENT: 'production',
  AUTH_MODE: 'token',
  APP_ACCESS_TOKEN: 'test-token-0123456789abcdef',
  RAKUTEN_APPLICATION_ID: 'app-id-secret',
  RAKUTEN_ACCESS_KEY: 'pk_access_secret',
  RAKUTEN_REFERER: 'https://example.workers.dev/',
};
const AUTH = { authorization: 'Bearer test-token-0123456789abcdef' };

function rakutenItem(i: number, extra: Record<string, unknown> = {}) {
  return {
    itemCode: `shop:${i}`,
    itemName: `柔軟剤 詰め替え 1200ml×${i}袋`,
    itemPrice: 1000 * i,
    taxFlag: 0,
    postageFlag: 0,
    pointRate: 1,
    availability: 1,
    reviewAverage: 4.5,
    reviewCount: 10,
    shopName: 'テスト店',
    shopCode: 'shop',
    itemUrl: `https://item.rakuten.co.jp/shop/${i}/`,
    mediumImageUrls: [`https://thumbnail.image.rakuten.co.jp/a/${i}.jpg?_ex=128x128`],
    ...extra,
  };
}

function okBody(items: unknown[], page = 1, pageCount = 1) {
  return new Response(JSON.stringify({ count: items.length, page, pageCount, Items: items }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function makeApp(fetchFn: (url: string, init?: RequestInit) => Promise<Response>, opts: { limit?: number } = {}) {
  return createApp({
    fetchFn,
    sleepFn: noSleep,
    cache: new MemoryCache(),
    queue: new SpacingQueue(0, noSleep),
    limiter: new SlidingWindowLimiter(opts.limit ?? 100, 60_000),
  });
}

const req = (path: string, headers: Record<string, string> = AUTH) =>
  new Request(`https://app.example${path}`, { headers });

describe('mapper', () => {
  it('formatVersion 2 の商品を変換', () => {
    const p = mapItem(rakutenItem(2, { taxFlag: 1, postageFlag: 1, pointRate: 5 }), 'T')!;
    expect(p.itemPrice).toBe(2000);
    expect(p.taxIncluded).toBe(false);
    expect(p.shipping).toEqual({ kind: 'separate', amount: null });
    expect(p.pointRate).toBe(5);
    expect(p.imageUrl).toContain('_ex=300x300');
    expect(p.fetchedAt).toBe('T');
  });
  it('formatVersion 1 の形式（Item ラップ・画像オブジェクト）', () => {
    const p = mapItem({ Item: rakutenItem(1, { mediumImageUrls: [{ imageUrl: 'http://thumbnail.image.rakuten.co.jp/x.jpg' }] }) }, 'T')!;
    expect(p.itemCode).toBe('shop:1');
    expect(p.imageUrl).toBe('https://thumbnail.image.rakuten.co.jp/x.jpg');
  });
  it('不明な項目は null（送料不明は送料別扱い、推測しない）', () => {
    const p = mapItem({ itemCode: 'a', itemName: 'b', itemPrice: 100 }, 'T')!;
    expect(p.taxIncluded).toBeNull();
    expect(p.available).toBeNull();
    expect(p.shipping).toEqual({ kind: 'separate', amount: null });
    expect(p.pointRate).toBeNull();
    expect(p.reviewAverage).toBeNull();
    expect(p.itemUrl).toBeNull();
  });
  it('必須項目欠落・不正値は除外', () => {
    expect(mapItem({ itemName: 'b', itemPrice: 1 }, 'T')).toBeNull();
    expect(mapItem({ itemCode: 'a', itemName: 'b', itemPrice: -1 }, 'T')).toBeNull();
    expect(mapItem(null, 'T')).toBeNull();
    expect(mapSearchResponse('garbage', 'T').products).toEqual([]);
  });
  it('楽天以外・javascript: の URL を拒否（XSS 対策）', () => {
    expect(safeRakutenUrl('javascript:alert(1)')).toBeNull();
    expect(safeRakutenUrl('https://evil.example.com/rakuten.co.jp')).toBeNull();
    expect(safeRakutenUrl('https://rakuten.co.jp.evil.com/')).toBeNull();
    expect(safeRakutenUrl('https://item.rakuten.co.jp/a/b/')).toBe('https://item.rakuten.co.jp/a/b/');
    expect(safeRakutenUrl('https://hb.afl.rakuten.co.jp/hgc/x/')).toBe('https://hb.afl.rakuten.co.jp/hgc/x/');
  });
  it('2 種類のエラー形式を解析', () => {
    expect(parseRakutenError({ error: 'wrong_parameter', error_description: 'keyword is not valid' })).toEqual({
      code: 'wrong_parameter',
      message: 'keyword is not valid',
    });
    expect(parseRakutenError({ errors: [{ errorCode: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING', errorMessage: 'x' }] })).toEqual({
      code: 'REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING',
      message: 'x',
    });
    expect(parseRakutenError({ Items: [] })).toBeNull();
  });
});

describe('buildSearchUrl', () => {
  it('検索条件を API パラメータに変換', () => {
    const u = new URL(
      buildSearchUrl(
        { keyword: '柔軟剤', ngKeyword: '本体', minPrice: 100, maxPrice: 5000, freeShippingOnly: true, inStockOnly: true, shopCode: 'abc', minPointRate: 5, apiSort: '+itemPrice' },
        2,
        { ...LIVE_ENV, RAKUTEN_AFFILIATE_ID: 'aff' },
      ),
    );
    expect(u.origin + u.pathname).toBe('https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701');
    const p = u.searchParams;
    expect(p.get('keyword')).toBe('柔軟剤');
    expect(p.get('NGKeyword')).toBe('本体');
    expect(p.get('postageFlag')).toBe('1');
    expect(p.get('availability')).toBe('1');
    expect(p.get('pointRateFlag')).toBe('1');
    expect(p.get('pointRate')).toBe('5');
    expect(p.get('sort')).toBe('+itemPrice');
    expect(p.get('hits')).toBe('30');
    expect(p.get('page')).toBe('2');
    expect(p.get('affiliateId')).toBe('aff');
    expect(p.get('formatVersion')).toBe('2');
  });
  it('ヘッダー送信モードでは accessKey をクエリに含めない', () => {
    const u = buildSearchUrl({ keyword: 'a b' }, 1, { ...LIVE_ENV, RAKUTEN_ACCESS_KEY_TRANSPORT: 'header' });
    expect(u).not.toContain('pk_access_secret');
  });
  it('エンドポイントを上書きでき、https 以外は拒否', () => {
    expect(buildSearchUrl({ keyword: 'aa' }, 1, { ...LIVE_ENV, RAKUTEN_ENDPOINT: 'https://openapi.rakuten.co.jp/x/20220601' })).toContain('/x/20220601');
    expect(() => buildSearchUrl({ keyword: 'aa' }, 1, { ...LIVE_ENV, RAKUTEN_ENDPOINT: 'http://insecure/' })).toThrow();
  });
});

describe('fetchWithRetry', () => {
  it('429 は Retry-After を尊重して再試行し、成功を返す', async () => {
    const sleeps: number[] = [];
    const f = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchWithRetry('https://x', {}, { fetchFn: f, sleepFn: async (ms) => void sleeps.push(ms) });
    expect(res.status).toBe(200);
    expect(sleeps).toEqual([2000]);
  });
  it('400 は再試行しない', async () => {
    const f = vi.fn().mockResolvedValue(new Response('', { status: 400 }));
    const res = await fetchWithRetry('https://x', {}, { fetchFn: f, sleepFn: noSleep });
    expect(res.status).toBe(400);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('5xx は上限回数まで再試行して最後の応答を返す', async () => {
    const f = vi.fn().mockImplementation(async () => new Response('', { status: 503 }));
    const res = await fetchWithRetry('https://x', {}, { fetchFn: f, sleepFn: noSleep, policy: { retries: 2 } });
    expect(res.status).toBe(503);
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('タイムアウトで TimeoutError', async () => {
    const f = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))));
    await expect(fetchWithRetry('https://x', {}, { fetchFn: f, sleepFn: noSleep, policy: { timeoutMs: 10, retries: 0 } })).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('API: 認証・アクセス制限', () => {
  it('本番で AUTH_MODE 未設定なら拒否（fail closed）', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', {}), { ENVIRONMENT: 'production' });
    expect(res.status).toBe(503);
  });
  it('ENVIRONMENT 未設定でも none は許可しない', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', {}), { AUTH_MODE: 'none' });
    expect(res.status).toBe(503);
  });
  it('トークン不一致は 401', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', { authorization: 'Bearer wrong' }), LIVE_ENV);
    expect(res.status).toBe(401);
  });
  it('短すぎるトークン設定は拒否', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', { authorization: 'Bearer short' }), { ...LIVE_ENV, APP_ACCESS_TOKEN: 'short' });
    expect(res.status).toBe(503);
  });
  it('health は認証不要だが情報を含まない', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/health', {}), {});
    expect(await res.json()).toEqual({ ok: true, version: '0.1.0' });
  });
  it('POST は 405', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(new Request('https://app.example/api/search', { method: 'POST', headers: AUTH }), LIVE_ENV);
    expect(res.status).toBe(405);
  });
});

describe('API: Cloudflare Access JWT 検証', () => {
  let keyPair: CryptoKeyPair;
  let jwk: JsonWebKey;
  const team = 'myteam.cloudflareaccess.com';
  const b64url = (b: Uint8Array | string) =>
    Buffer.from(typeof b === 'string' ? new TextEncoder().encode(b) : b).toString('base64url');
  async function sign(payload: Record<string, unknown>, kid = 'k1') {
    const h = b64url(JSON.stringify({ alg: 'RS256', kid }));
    const p = b64url(JSON.stringify(payload));
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keyPair.privateKey, new TextEncoder().encode(`${h}.${p}`)));
    return `${h}.${p}.${b64url(sig)}`;
  }
  beforeEach(async () => {
    _resetJwksCacheForTest();
    keyPair = (await crypto.subtle.generateKey(
      { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair;
    jwk = { ...(await crypto.subtle.exportKey('jwk', keyPair.publicKey)), kid: 'k1' } as JsonWebKey;
  });
  const certs = () => vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] })));
  const now = Math.floor(Date.now() / 1000);
  const good = { aud: ['AUD1'], exp: now + 600, iss: `https://${team}`, sub: 'user1' };

  it('正しい署名・aud・exp・iss を受理', async () => {
    const payload = await verifyAccessJwt(await sign(good), { teamDomain: team, aud: 'AUD1', fetchFn: certs() as unknown as typeof fetch });
    expect(payload.sub).toBe('user1');
  });
  it.each([
    ['aud 不一致', { ...good, aud: ['OTHER'] }],
    ['期限切れ', { ...good, exp: now - 10 }],
    ['iss 不一致', { ...good, iss: 'https://evil.cloudflareaccess.com' }],
  ])('%s は拒否', async (_l, payload) => {
    await expect(verifyAccessJwt(await sign(payload), { teamDomain: team, aud: 'AUD1', fetchFn: certs() as unknown as typeof fetch })).rejects.toThrow();
  });
  it('改ざんされた署名を拒否', async () => {
    const t = await sign(good);
    const [h, , s] = t.split('.');
    const forged = `${h}.${b64url(JSON.stringify({ ...good, sub: 'attacker' }))}.${s}`;
    await expect(verifyAccessJwt(forged, { teamDomain: team, aud: 'AUD1', fetchFn: certs() as unknown as typeof fetch })).rejects.toThrow();
  });
  it('alg=none を拒否', async () => {
    const t = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(good))}.`;
    await expect(verifyAccessJwt(t, { teamDomain: team, aud: 'AUD1', fetchFn: certs() as unknown as typeof fetch })).rejects.toThrow();
  });
  it('Access モードで API を利用できる', async () => {
    const f = vi.fn(async (url: string) => (url.includes('cloudflareaccess') ? new Response(JSON.stringify({ keys: [jwk] })) : okBody([rakutenItem(1)])));
    const app = makeApp(f);
    const env: Env = { ...LIVE_ENV, AUTH_MODE: 'access', ACCESS_TEAM_DOMAIN: team, ACCESS_AUD: 'AUD1' };
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', { 'cf-access-jwt-assertion': await sign(good) }), env);
    expect(res.status).toBe(200);
    const noJwt = await app.fetch(req('/api/search?keyword=柔軟剤', {}), env);
    expect(noJwt.status).toBe(401);
  });
});

describe('API: 検索（実APIモード）', () => {
  it('結果を返し、mode=live、秘密情報をレスポンスに含めない', async () => {
    const f = vi.fn(async (_u: string, _i?: RequestInit) => okBody([rakutenItem(1), rakutenItem(2)]));
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=柔軟剤'), LIVE_ENV);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('pk_access_secret');
    expect(text).not.toContain('app-id-secret');
    const body = JSON.parse(text);
    expect(body.mode).toBe('live');
    expect(body.products).toHaveLength(2);
    // Referer ヘッダーを送信
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get('referer')).toBe('https://example.workers.dev/');
  });
  it('同一検索はキャッシュから返し、上流に再アクセスしない', async () => {
    const f = vi.fn(async () => okBody([rakutenItem(1)]));
    const app = makeApp(f);
    await app.fetch(req('/api/search?keyword=柔軟剤'), LIVE_ENV);
    const res2 = await app.fetch(req('/api/search?keyword=%E3%80%80柔軟剤%20'), LIVE_ENV);
    expect((await res2.json()).cached).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('同時の同一検索は 1 回の上流アクセスにまとめる', async () => {
    const f = vi.fn(async () => okBody([rakutenItem(1)]));
    const app = makeApp(f);
    await Promise.all([1, 2, 3].map(() => app.fetch(req('/api/search?keyword=洗剤'), LIVE_ENV)));
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('複数ページを取得し重複を除く', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(okBody([rakutenItem(1), rakutenItem(2)], 1, 5))
      .mockResolvedValueOnce(okBody([rakutenItem(2), rakutenItem(3)], 2, 5));
    const app = makeApp(f);
    const body = await (await app.fetch(req('/api/search?keyword=柔軟剤&pages=2'), LIVE_ENV)).json();
    expect(body.products.map((p: { itemCode: string }) => p.itemCode)).toEqual(['shop:1', 'shop:2', 'shop:3']);
    expect(body.fetchedPages).toBe(2);
  });
  it('最終ページに達したら追加取得しない', async () => {
    const f = vi.fn(async () => okBody([rakutenItem(1)], 1, 1));
    const app = makeApp(f);
    await app.fetch(req('/api/search?keyword=柔軟剤&pages=3'), LIVE_ENV);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('2ページ目の失敗は取得済み分を返して通知', async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(okBody([rakutenItem(1)], 1, 5))
      .mockResolvedValue(new Response('{}', { status: 400 }));
    const app = makeApp(f);
    const body = await (await app.fetch(req('/api/search?keyword=柔軟剤&pages=2'), LIVE_ENV)).json();
    expect(body.products).toHaveLength(1);
    expect(body.notices.join()).toContain('1ページ分のみ');
  });
  it.each([
    [429, 429, 'upstream_rate_limited'],
    [500, 503, 'upstream_unavailable'],
    [403, 502, 'upstream_auth'],
    [400, 400, 'upstream_bad_request'],
  ])('上流 %i → %i %s（画面停止しないエラー JSON）', async (up, status, code) => {
    const f = vi.fn(async () => new Response(JSON.stringify({ errors: [{ errorCode: 'X', errorMessage: 'secret pk_access_secret' }] }), { status: up }));
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=柔軟剤'), LIVE_ENV);
    expect(res.status).toBe(status);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe(code);
    expect(text).not.toContain('pk_access_secret');
  });
  it('not_found は空の結果', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ error: 'not_found', error_description: 'not found' }), { status: 404 }));
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=存在しない'), LIVE_ENV);
    expect(res.status).toBe(200);
    expect((await res.json()).products).toEqual([]);
  });
  it('ネットワークエラーは 502', async () => {
    const f = vi.fn(async () => {
      throw new TypeError('network');
    });
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=柔軟剤'), LIVE_ENV);
    expect(res.status).toBe(502);
  });
  it('不正 JSON は 502', async () => {
    const f = vi.fn(async () => new Response('<html>', { status: 200 }));
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=柔軟剤'), LIVE_ENV);
    expect(res.status).toBe(502);
  });
});

describe('API: 入力検証・頻度制限・モード', () => {
  it.each([
    ['/api/search', 'キーワード'],
    ['/api/search?keyword=a', 'キーワード'],
    ['/api/search?keyword=aa&minPrice=-1', '最低価格'],
    ['/api/search?keyword=aa&minPrice=500&maxPrice=100', '最低価格は最高価格以下'],
    ['/api/search?keyword=aa&pages=99', '取得ページ数'],
    ['/api/search?keyword=aa&minPointRate=11', '最低ポイント倍率'],
    ['/api/search?keyword=aa&shopCode=<script>', '店舗コード'],
    ['/api/search?keyword=aa&apiSort=evil', '並び順'],
  ])('%s → 400', async (path, msg) => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req(path), LIVE_ENV);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toContain(msg);
  });
  it('連続検索を制限（429）', async () => {
    const f = vi.fn(async () => okBody([rakutenItem(1)]));
    const app = makeApp(f, { limit: 2 });
    await app.fetch(req('/api/search?keyword=aa'), LIVE_ENV);
    await app.fetch(req('/api/search?keyword=bb'), LIVE_ENV);
    const res = await app.fetch(req('/api/search?keyword=cc'), LIVE_ENV);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('10');
  });
  it('認証情報なしならモックモード（架空商品は【サンプル】付き・URLなし）', async () => {
    const f = vi.fn();
    const app = makeApp(f);
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', {}), { ENVIRONMENT: 'development' });
    const body = await res.json();
    expect(body.mode).toBe('mock');
    expect(body.products.length).toBeGreaterThan(3);
    for (const p of body.products) {
      expect(p.itemName.startsWith('【サンプル】')).toBe(true);
      expect(p.itemUrl).toBeNull();
      expect(p.affiliateUrl).toBeNull();
    }
    expect(body.notices.join()).toContain('架空');
    expect(f).not.toHaveBeenCalled();
  });
  it('DATA_MODE=live で認証情報がなければ 503（モックに切り替えない）', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/search?keyword=柔軟剤', {}), { ENVIRONMENT: 'development', DATA_MODE: 'live' });
    expect(res.status).toBe(503);
  });
  it('モック検索の絞り込み', async () => {
    const app = makeApp(vi.fn());
    const env = { ENVIRONMENT: 'development' };
    const all = await (await app.fetch(req('/api/search?keyword=柔軟剤', {}), env)).json();
    const free = await (await app.fetch(req('/api/search?keyword=柔軟剤&freeShippingOnly=1', {}), env)).json();
    const ng = await (await app.fetch(req('/api/search?keyword=柔軟剤&ngKeyword=本体', {}), env)).json();
    const pr = await (await app.fetch(req('/api/search?keyword=柔軟剤&minPointRate=5', {}), env)).json();
    expect(free.products.length).toBeLessThan(all.products.length);
    expect(free.products.every((p: { shipping: { kind: string } }) => p.shipping.kind === 'included')).toBe(true);
    expect(ng.products.some((p: { itemName: string }) => p.itemName.includes('本体'))).toBe(false);
    expect(pr.products.every((p: { pointRate: number }) => p.pointRate >= 5)).toBe(true);
  });
  it('config は mode とアフィリエイト有無のみ返す', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/api/config'), { ...LIVE_ENV, RAKUTEN_AFFILIATE_ID: 'aff-secret' });
    const text = await res.text();
    expect(JSON.parse(text)).toMatchObject({ mode: 'live', affiliateEnabled: true });
    expect(text).not.toContain('aff-secret');
  });
  it('非 API パスは静的アセットへ委譲', async () => {
    const app = makeApp(vi.fn());
    const res = await app.fetch(req('/'), { ASSETS: { fetch: async () => new Response('asset') } });
    expect(await res.text()).toBe('asset');
  });
});

describe('SpacingQueue', () => {
  it('最小間隔を空けて順に実行', async () => {
    let t = 0;
    const waits: number[] = [];
    const q = new SpacingQueue(1000, async (ms) => {
      waits.push(ms);
      t += ms;
    }, () => t);
    t = 5000;
    await Promise.all([q.run(async () => 1), q.run(async () => 2), q.run(async () => 3)]);
    expect(waits).toEqual([1000, 1000]);
  });
});
