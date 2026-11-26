/**
 * 共有型定義（フロントエンド・Worker 双方で使用）
 */

/** データの出所。モックと実APIを絶対に混同しないために全レスポンスに付与する */
export type DataMode = 'mock' | 'live';

/** 数量の次元。異なる次元の商品は同一ランキングに混在させない */
export type Dimension =
  | 'volume' // ml
  | 'mass' // g
  | 'length' // m
  | 'uses' // 回
  | 'meals' // 食
  | 'sheets' // 枚
  | 'pairs' // 組
  | 'pieces'; // 個（本・袋など数えられる物の個数）

/** 解析の信頼度 */
export type Confidence = 'confirmed' | 'review' | 'unknown';

/** 本体・詰め替え区分 */
export type PackageKind = 'body' | 'refill' | 'mixed' | 'unknown';

export interface DimensionAmount {
  /** 1個当たりの量 */
  perUnit: number;
  /** 合計量（perUnit × setCount） */
  total: number;
  /** 「約」等の概数表記 */
  approx: boolean;
}

export interface QuantityParseResult {
  /** 次元ごとの量（例: 粉末洗剤の「0.9kg 約45回分」は mass と uses の両方を持つ） */
  amounts: Partial<Record<Dimension, DimensionAmount>>;
  /** 1個当たりの内容量（基本単位: ml / g / m / 回 / 食 / 枚 / 組）。不明なら null */
  unitAmount: number | null;
  /** 基本単位の次元 */
  dimension: Dimension | null;
  /** セット個数（全ての個数指定の積）。不明なら null */
  setCount: number | null;
  /** 合計内容量（unitAmount × setCount）。不明なら null */
  totalAmount: number | null;
  /** 合計個数（本・袋などの物理的な個数）。不明なら null */
  totalPieces: number | null;
  packageKind: PackageKind;
  /** 香り・種類（抽出できた場合） */
  variant: string | null;
  confidence: Confidence;
  /** 判定理由（UI 表示用、日本語） */
  reasons: string[];
  /** どの文字列から抽出したか */
  source: 'name' | 'caption' | 'manual' | 'none';
  /** 抽出に使ったトークン（デバッグ・説明用） */
  matchedText: string[];
  /** 容量を特定できなかったが表記されていた次元（手動補正フォームの既定単位に使う） */
  candidateDimension?: Dimension | null;
}

/** 送料情報 */
export type ShippingInfo =
  | { kind: 'included' } // 送料込み・送料無料（API の postageFlag=0）
  | { kind: 'separate'; amount: number | null }; // 送料別。金額はAPIで取得不可のため通常 null

/** API から取得した商品（正規化済み） */
export interface Product {
  itemCode: string;
  itemName: string;
  catchcopy: string | null;
  itemCaption: string | null;
  imageUrl: string | null;
  brand: string | null;
  shopName: string;
  shopCode: string;
  /** 販売価格（API の itemPrice） */
  itemPrice: number;
  /** itemPrice が税込なら true（taxFlag=0）。不明なら null */
  taxIncluded: boolean | null;
  /** SKU により価格が異なる場合の最小/最大（取得できた場合） */
  itemPriceMin: number | null;
  itemPriceMax: number | null;
  shipping: ShippingInfo;
  /** 商品別ポイント倍率（API の pointRate。通常購入分 1 倍を含む倍率として扱う） */
  pointRate: number | null;
  pointRateStartTime: string | null;
  pointRateEndTime: string | null;
  /** 在庫あり: true / なし: false / 不明: null */
  available: boolean | null;
  reviewAverage: number | null;
  reviewCount: number | null;
  itemUrl: string | null;
  affiliateUrl: string | null;
  genreId: string | null;
  /** 情報取得日時（ISO8601） */
  fetchedAt: string;
}

export type SortKey =
  | 'unitPrice'
  | 'netPrice'
  | 'payment'
  | 'pointRate'
  | 'review'
  | 'quantity';

export type ApiSort =
  | 'standard'
  | '+itemPrice'
  | '-itemPrice'
  | '-reviewAverage'
  | '-reviewCount';

export interface SearchQuery {
  keyword: string;
  ngKeyword?: string;
  minPrice?: number;
  maxPrice?: number;
  freeShippingOnly?: boolean;
  inStockOnly?: boolean;
  shopCode?: string;
  minPointRate?: number;
  /** 取得ページ数（1ページ最大30件） */
  pages?: number;
  apiSort?: ApiSort;
}

export interface SearchResponse {
  mode: DataMode;
  query: SearchQuery;
  products: Product[];
  /** API が返した総ヒット件数 */
  totalCount: number;
  /** 実際に取得した件数・ページ */
  fetchedPages: number;
  pageCount: number;
  fetchedAt: string;
  cached: boolean;
  notices: string[];
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    retryable: boolean;
  };
}
