/**
 * Worker の環境変数・バインディング。
 * 秘密情報（RAKUTEN_ACCESS_KEY 等）は `wrangler secret put` で設定し、ソースコードに含めない。
 */
export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

/** Cloudflare Workers Rate Limiting バインディング（任意） */
export interface RateLimitBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  ASSETS?: AssetsBinding;
  RATE_LIMITER?: RateLimitBinding;

  /** development | production（未設定は production 扱い＝安全側） */
  ENVIRONMENT?: string;
  /** auto（認証情報があれば live）| mock | live */
  DATA_MODE?: string;

  // 楽天ウェブサービス（secret）
  RAKUTEN_APPLICATION_ID?: string;
  RAKUTEN_ACCESS_KEY?: string;
  RAKUTEN_AFFILIATE_ID?: string;
  /** 楽天のアプリ登録で許可したサイトURL（Referer として送信） */
  RAKUTEN_REFERER?: string;
  /** 商品検索 API のエンドポイント（バージョン変更時に上書き） */
  RAKUTEN_ENDPOINT?: string;
  /** accessKey の送り方: query（既定）| header */
  RAKUTEN_ACCESS_KEY_TRANSPORT?: string;

  // アクセス制限
  /** access（Cloudflare Access の JWT を検証）| token（共有トークン）| none（development のみ） */
  AUTH_MODE?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  APP_ACCESS_TOKEN?: string;

  /** 検索結果キャッシュ秒数（既定 600 秒） */
  CACHE_TTL_SECONDS?: string;
  /** 1クライアント当たりの 1 分間の検索上限（既定 20） */
  SEARCH_LIMIT_PER_MINUTE?: string;
}

export const DEFAULT_ENDPOINT =
  'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';

export function isDevelopment(env: Env): boolean {
  return env.ENVIRONMENT === 'development';
}

export function resolveDataMode(env: Env): 'mock' | 'live' {
  const hasCreds = Boolean(env.RAKUTEN_APPLICATION_ID && env.RAKUTEN_ACCESS_KEY);
  if (env.DATA_MODE === 'mock') return 'mock';
  if (env.DATA_MODE === 'live') return 'live';
  return hasCreds ? 'live' : 'mock';
}
