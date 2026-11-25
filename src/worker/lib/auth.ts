/**
 * API のアクセス制限。
 *  - access: Cloudflare Access（Zero Trust 無料プラン）が付与する Cf-Access-Jwt-Assertion を検証
 *  - token : 共有トークン（Authorization: Bearer / X-App-Token）を定数時間比較
 *  - none  : ENVIRONMENT=development の場合のみ許可（本番で未設定なら全拒否＝fail closed）
 */
import type { Env } from '../env';
import { isDevelopment } from '../env';
import { AppError } from './errors';

export interface AuthResult {
  /** レート制限キー等に使う利用者識別子（ログには出さない） */
  subject: string;
  mode: 'access' | 'token' | 'none';
}

type Jwk = JsonWebKey & { kid?: string };
interface JwksCacheEntry {
  keys: Jwk[];
  expires: number;
}
let jwksCache: { url: string; entry: JwksCacheEntry } | null = null;

export function _resetJwksCacheForTest() {
  jwksCache = null;
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as Record<string, unknown>;
}

async function getJwks(teamDomain: string, fetchFn: typeof fetch): Promise<Jwk[]> {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  if (jwksCache && jwksCache.url === url && jwksCache.entry.expires > Date.now()) {
    return jwksCache.entry.keys;
  }
  const res = await fetchFn(url);
  if (!res.ok) throw new AppError('auth_unavailable', '認証サーバーに接続できません', 503, true);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache = { url, entry: { keys, expires: Date.now() + 60 * 60 * 1000 } };
  return keys;
}

export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; fetchFn?: typeof fetch; now?: number },
): Promise<Record<string, unknown>> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('unauthorized', '認証が必要です', 401);
  const [h, p, s] = parts as [string, string, string];
  let header: Record<string, unknown>;
  let payload: Record<string, unknown>;
  try {
    header = decodeJson(h);
    payload = decodeJson(p);
  } catch {
    throw new AppError('unauthorized', '認証が必要です', 401);
  }
  if (header.alg !== 'RS256') throw new AppError('unauthorized', '認証が必要です', 401);
  const keys = await getJwks(opts.teamDomain, opts.fetchFn ?? fetch);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new AppError('unauthorized', '認証が必要です', 401);
  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    b64urlToBytes(s),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!ok) throw new AppError('unauthorized', '認証が必要です', 401);
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const aud = payload.aud;
  const audOk = Array.isArray(aud) ? aud.includes(opts.aud) : aud === opts.aud;
  if (!audOk) throw new AppError('unauthorized', '認証が必要です', 401);
  if (typeof payload.exp !== 'number' || payload.exp < now) {
    throw new AppError('unauthorized', '認証の有効期限が切れています', 401);
  }
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) {
    throw new AppError('unauthorized', '認証が必要です', 401);
  }
  if (payload.iss !== `https://${opts.teamDomain}`) {
    throw new AppError('unauthorized', '認証が必要です', 401);
  }
  return payload;
}

async function sha256(s: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
}

/** ハッシュ化してから全バイト比較（長さ・内容による時間差を抑える） */
export async function timingSafeEqualString(a: string, b: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i]! ^ hb[i]!;
  return diff === 0;
}

export async function authenticate(
  request: Request,
  env: Env,
  fetchFn?: typeof fetch,
): Promise<AuthResult> {
  const mode = env.AUTH_MODE ?? (isDevelopment(env) ? 'none' : '');
  if (mode === 'access') {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
      throw new AppError('auth_misconfigured', 'アクセス制限の設定が不完全です', 503);
    }
    const token = request.headers.get('cf-access-jwt-assertion');
    if (!token) throw new AppError('unauthorized', '認証が必要です', 401);
    const payload = await verifyAccessJwt(token, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
      fetchFn,
    });
    const subject = typeof payload.sub === 'string' ? payload.sub : 'access-user';
    return { subject: `access:${subject}`, mode: 'access' };
  }
  if (mode === 'token') {
    if (!env.APP_ACCESS_TOKEN || env.APP_ACCESS_TOKEN.length < 16) {
      throw new AppError('auth_misconfigured', 'アクセス制限の設定が不完全です', 503);
    }
    const auth = request.headers.get('authorization');
    const provided =
      (auth?.startsWith('Bearer ') ? auth.slice(7) : null) ?? request.headers.get('x-app-token');
    if (!provided || !(await timingSafeEqualString(provided, env.APP_ACCESS_TOKEN))) {
      throw new AppError('unauthorized', '認証が必要です', 401);
    }
    return { subject: 'token-user', mode: 'token' };
  }
  if (mode === 'none' && isDevelopment(env)) {
    const ip = request.headers.get('cf-connecting-ip') ?? 'local';
    return { subject: `dev:${ip}`, mode: 'none' };
  }
  // 本番で認証方式が未設定・不正 → 全拒否
  throw new AppError('auth_misconfigured', 'アクセス制限が設定されていないため API を利用できません', 503);
}
