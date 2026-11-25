/**
 * ユーザー設定（ポイント倍率・キャンペーン・クーポン等）と商品別の手動補正。
 * 端末内（localStorage）に保存され、Worker には送信されない。
 */
import type { Dimension } from '../types';

/** ポイント計算の対象金額 */
export type PointBase = 'taxExcluded' | 'taxIncluded';

export interface CampaignSetting {
  enabled: boolean;
  /** 追加倍率（通常購入分の1倍を含まない。例: 買い回り10店舗なら +9） */
  extraMultiplier: number;
  base: PointBase;
  /** キャンペーンのポイント付与上限（null は上限なし／不明） */
  cap: number | null;
  /** 当該キャンペーンで今回獲得できる残り上限（null は未入力） */
  remainingCap: number | null;
}

export interface UserSettings {
  version: 1;
  /** 基本ポイント倍率（SPU 等の合計。通常購入分 1 倍を含む）初期値 9 */
  baseMultiplier: number;
  /** 基本倍率分（通常1倍を除く）の付与上限（null=考慮しない） */
  baseCap: number | null;
  baseRemainingCap: number | null;
  /** SPU の一時的な追加倍率（基本倍率に含まれない分） */
  spuExtra: number;
  /** 楽天市場の通常ポイント・SPU の計算対象金額 */
  basePointBase: PointBase;
  /** 買い回り（お買い物マラソン・楽天スーパーSALE 等） */
  kaimawari: CampaignSetting;
  /** 5と0のつく日など日付キャンペーン */
  dayCampaign: CampaignSetting;
  /**
   * 楽天スーパーDEAL の既定値。商品ごとに「DEAL対象」として手動指定した場合のみ適用する
   * （スーパーDEAL の対象可否・還元率は商品検索 API では取得できないため）。
   */
  superDeal: {
    /** 還元率（%）。例: 20 */
    ratePercent: number;
    /** 還元率に通常購入分 1 倍（1%）が含まれるか。含まれる場合は重複計上しない */
    includesNormal: boolean;
    base: PointBase;
    cap: number | null;
    remainingCap: number | null;
  };
  /** 商品別ポイント倍率（API の pointRate）の計算対象金額 */
  shopPointBase: PointBase;
  /** 全商品に仮定するクーポン（参考価格にのみ反映） */
  coupon: {
    enabled: boolean;
    amountYen: number;
    percent: number;
    /** クーポン利用条件（この金額以上で利用可） */
    minPurchaseYen: number;
  };
  /** 1ポイントの評価額（円） */
  pointValueYen: number;
  /** 送料別で金額不明の商品に仮定する送料（null=仮定しない。参考価格にのみ反映） */
  assumedShippingYen: number | null;
  /** 消費税率（%）。null ならカテゴリ既定（食品・飲料 8%、その他 10%） */
  taxRateOverride: number | null;
  /** ランキングに使う価格区分 */
  rankingTier: 'estimated' | 'reference';
}

export interface ItemOverride {
  /** 容量・個数の手動修正 */
  quantity?: { perUnit: number; setCount: number; dimension: Dimension };
  /** 送料（円）。送料別の商品で手動入力 */
  shippingYen?: number;
  couponYen?: number;
  couponPercent?: number;
  /** スーパーDEAL 還元率（%）。設定時のみ DEAL として計算 */
  superDealPercent?: number;
  /** 店舗独自の追加ポイント（%）。API の pointRate に含まれない分 */
  shopExtraPercent?: number;
  /** 1回あたり使用量（主要単位: ml または g） */
  perUseAmount?: number;
  taxRate?: number;
}

export const DEFAULT_SETTINGS: UserSettings = {
  version: 1,
  baseMultiplier: 9,
  baseCap: null,
  baseRemainingCap: null,
  spuExtra: 0,
  basePointBase: 'taxExcluded',
  kaimawari: {
    enabled: false,
    extraMultiplier: 0,
    base: 'taxExcluded',
    cap: 7000,
    remainingCap: null,
  },
  dayCampaign: {
    enabled: false,
    extraMultiplier: 0,
    base: 'taxExcluded',
    cap: null,
    remainingCap: null,
  },
  superDeal: {
    ratePercent: 20,
    includesNormal: true,
    base: 'taxExcluded',
    cap: null,
    remainingCap: null,
  },
  shopPointBase: 'taxExcluded',
  coupon: { enabled: false, amountYen: 0, percent: 0, minPurchaseYen: 0 },
  pointValueYen: 1,
  assumedShippingYen: null,
  taxRateOverride: null,
  rankingTier: 'estimated',
};

function num(v: unknown, def: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}
function nullableNum(v: unknown, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}
function base(v: unknown, def: PointBase): PointBase {
  return v === 'taxIncluded' || v === 'taxExcluded' ? v : def;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function sanitizeCampaign(v: unknown, def: CampaignSetting): CampaignSetting {
  const o = obj(v);
  return {
    enabled: typeof o.enabled === 'boolean' ? o.enabled : def.enabled,
    extraMultiplier: num(o.extraMultiplier, def.extraMultiplier, 0, 100),
    base: base(o.base, def.base),
    cap: o.cap === undefined ? def.cap : nullableNum(o.cap, 0, 10_000_000),
    remainingCap: o.remainingCap === undefined ? def.remainingCap : nullableNum(o.remainingCap, 0, 10_000_000),
  };
}

/** 保存データや入力値を検証し、不正値は既定値・範囲内に丸める */
export function sanitizeSettings(input: unknown): UserSettings {
  const o = obj(input);
  const d = DEFAULT_SETTINGS;
  const sd = obj(o.superDeal);
  const cp = obj(o.coupon);
  return {
    version: 1,
    baseMultiplier: num(o.baseMultiplier, d.baseMultiplier, 1, 100),
    baseCap: o.baseCap === undefined ? d.baseCap : nullableNum(o.baseCap, 0, 10_000_000),
    baseRemainingCap:
      o.baseRemainingCap === undefined ? d.baseRemainingCap : nullableNum(o.baseRemainingCap, 0, 10_000_000),
    spuExtra: num(o.spuExtra, d.spuExtra, 0, 100),
    basePointBase: base(o.basePointBase, d.basePointBase),
    kaimawari: sanitizeCampaign(o.kaimawari, d.kaimawari),
    dayCampaign: sanitizeCampaign(o.dayCampaign, d.dayCampaign),
    superDeal: {
      ratePercent: num(sd.ratePercent, d.superDeal.ratePercent, 0, 100),
      includesNormal: typeof sd.includesNormal === 'boolean' ? sd.includesNormal : d.superDeal.includesNormal,
      base: base(sd.base, d.superDeal.base),
      cap: sd.cap === undefined ? d.superDeal.cap : nullableNum(sd.cap, 0, 10_000_000),
      remainingCap:
        sd.remainingCap === undefined ? d.superDeal.remainingCap : nullableNum(sd.remainingCap, 0, 10_000_000),
    },
    shopPointBase: base(o.shopPointBase, d.shopPointBase),
    coupon: {
      enabled: typeof cp.enabled === 'boolean' ? cp.enabled : d.coupon.enabled,
      amountYen: num(cp.amountYen, 0, 0, 10_000_000),
      percent: num(cp.percent, 0, 0, 100),
      minPurchaseYen: num(cp.minPurchaseYen, 0, 0, 10_000_000),
    },
    pointValueYen: num(o.pointValueYen, d.pointValueYen, 0, 10),
    assumedShippingYen:
      o.assumedShippingYen === undefined ? d.assumedShippingYen : nullableNum(o.assumedShippingYen, 0, 100_000),
    taxRateOverride:
      o.taxRateOverride === undefined ? d.taxRateOverride : nullableNum(o.taxRateOverride, 0, 30),
    rankingTier: o.rankingTier === 'reference' ? 'reference' : 'estimated',
  };
}

const DIMENSIONS: Dimension[] = ['volume', 'mass', 'length', 'uses', 'meals', 'sheets', 'pairs', 'pieces'];

export function sanitizeOverride(input: unknown): ItemOverride {
  const o = obj(input);
  const out: ItemOverride = {};
  const q = obj(o.quantity);
  const dim = DIMENSIONS.find((d) => d === q.dimension);
  const perUnit = nullableNum(q.perUnit, 0, 1_000_000);
  const setCount = nullableNum(q.setCount, 1, 10_000);
  if (dim && perUnit && perUnit > 0 && setCount) {
    out.quantity = { dimension: dim, perUnit, setCount: Math.floor(setCount) };
  }
  const pick = (k: keyof ItemOverride, min: number, max: number) => {
    const v = nullableNum(o[k], min, max);
    if (v !== null) (out as Record<string, unknown>)[k] = v;
  };
  pick('shippingYen', 0, 100_000);
  pick('couponYen', 0, 10_000_000);
  pick('couponPercent', 0, 100);
  pick('superDealPercent', 0, 100);
  pick('shopExtraPercent', 0, 100);
  pick('perUseAmount', 0.001, 100_000);
  pick('taxRate', 0, 30);
  return out;
}
