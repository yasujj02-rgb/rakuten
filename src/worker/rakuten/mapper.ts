/**
 * 楽天市場商品検索 API のレスポンスを内部の Product 型に変換する。
 * formatVersion=1（{Items:[{Item:{...}}]}）と 2（{Items:[{...}]}）の両方に対応。
 * 取得できない項目は null とし、推測で補完しない。
 */
import type { Product } from '../../shared/types';

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const numOrNull = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

/** 楽天ドメインの https URL のみ許可（XSS・オープンリダイレクト対策） */
export function safeRakutenUrl(v: unknown, allowedHostSuffixes = ['.rakuten.co.jp', '.r10s.jp']): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:') {
      // 画像 URL が http で返る場合は https に揃える
      if (u.protocol === 'http:') u.protocol = 'https:';
      else return null;
    }
    const host = u.hostname.toLowerCase();
    if (!allowedHostSuffixes.some((suf) => host.endsWith(suf) || host === suf.slice(1))) return null;
    return u.toString();
  } catch {
    return null;
  }
}

function firstImage(item: Raw): string | null {
  for (const key of ['mediumImageUrls', 'smallImageUrls']) {
    const arr = item[key];
    if (Array.isArray(arr) && arr.length > 0) {
      const first = arr[0] as unknown;
      const url = typeof first === 'string' ? first : str((first as Raw | null)?.imageUrl);
      const safe = safeRakutenUrl(url);
      if (safe) {
        // サムネイルサイズを 300x300 に（楽天画像サーバーの _ex パラメータ）
        try {
          const u = new URL(safe);
          if (u.searchParams.has('_ex')) u.searchParams.set('_ex', '300x300');
          return u.toString();
        } catch {
          return safe;
        }
      }
    }
  }
  return null;
}

export function mapItem(rawInput: unknown, fetchedAt: string): Product | null {
  if (!rawInput || typeof rawInput !== 'object') return null;
  let item = rawInput as Raw;
  if (item.Item && typeof item.Item === 'object') item = item.Item as Raw;

  const itemCode = str(item.itemCode);
  const itemName = str(item.itemName);
  const itemPrice = numOrNull(item.itemPrice);
  if (!itemCode || !itemName || itemPrice === null || itemPrice < 0) return null;

  const taxFlag = numOrNull(item.taxFlag);
  const postageFlag = numOrNull(item.postageFlag);
  const availability = numOrNull(item.availability);
  const pointRate = numOrNull(item.pointRate);
  const reviewCount = numOrNull(item.reviewCount);
  const reviewAverage = numOrNull(item.reviewAverage);

  return {
    itemCode,
    itemName,
    catchcopy: str(item.catchcopy),
    itemCaption: str(item.itemCaption),
    imageUrl: firstImage(item),
    // 商品検索 API にブランド専用項目はないため null（タグ情報からの推定はしない）
    brand: str(item.brandName),
    shopName: str(item.shopName) ?? '（店舗名不明）',
    shopCode: str(item.shopCode) ?? '',
    itemPrice,
    // taxFlag: 0=税込, 1=税別
    taxIncluded: taxFlag === 0 ? true : taxFlag === 1 ? false : null,
    itemPriceMin: numOrNull(item.itemPriceMin1) ?? numOrNull(item.itemPriceMin2) ?? null,
    itemPriceMax: numOrNull(item.itemPriceMax1) ?? numOrNull(item.itemPriceMax2) ?? null,
    // postageFlag: 0=送料込（送料無料含む）, 1=送料別
    shipping: postageFlag === 0 ? { kind: 'included' } : { kind: 'separate', amount: null },
    pointRate: pointRate !== null && pointRate >= 1 ? pointRate : null,
    pointRateStartTime: str(item.pointRateStartTime),
    pointRateEndTime: str(item.pointRateEndTime),
    available: availability === 1 ? true : availability === 0 ? false : null,
    reviewAverage: reviewAverage !== null && reviewCount !== null && reviewCount > 0 ? reviewAverage : null,
    reviewCount,
    itemUrl: safeRakutenUrl(item.itemUrl),
    affiliateUrl: safeRakutenUrl(item.affiliateUrl),
    genreId: str(item.genreId) ?? (numOrNull(item.genreId)?.toString() ?? null),
    fetchedAt,
  };
}

export interface MappedPage {
  products: Product[];
  count: number;
  page: number;
  pageCount: number;
}

export function mapSearchResponse(body: unknown, fetchedAt: string): MappedPage {
  const b = (body && typeof body === 'object' ? body : {}) as Raw;
  const items = Array.isArray(b.Items) ? b.Items : Array.isArray(b.items) ? b.items : [];
  const products = items.map((i) => mapItem(i, fetchedAt)).filter((p): p is Product => p !== null);
  return {
    products,
    count: numOrNull(b.count) ?? products.length,
    page: numOrNull(b.page) ?? 1,
    pageCount: numOrNull(b.pageCount) ?? 1,
  };
}

const codeStr = (v: unknown): string | null => str(v) ?? (typeof v === 'number' ? String(v) : null);

/**
 * エラー応答の解析。次の形式に対応:
 *  - {error, error_description}（旧ドキュメント記載）
 *  - {errors: {errorCode: 400, errorMessage}}（2026-11-27 に実 API で確認した形式。errorCode は数値）
 *  - {errors: [{errorCode, errorMessage}]}（配列形式の報告あり）
 */
export function parseRakutenError(body: unknown): { code: string; message: string } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Raw;
  if (typeof b.error === 'string') {
    return { code: b.error, message: str(b.error_description) ?? '' };
  }
  const errs = Array.isArray(b.errors) ? b.errors[0] : b.errors;
  if (errs && typeof errs === 'object') {
    const e = errs as Raw;
    return {
      code: codeStr(e.errorCode) ?? codeStr(e.code) ?? 'unknown',
      message: str(e.errorMessage) ?? str(e.message) ?? '',
    };
  }
  if (b.error && typeof b.error === 'object') {
    const e = b.error as Raw;
    return { code: str(e.code) ?? 'unknown', message: str(e.message) ?? '' };
  }
  return null;
}
