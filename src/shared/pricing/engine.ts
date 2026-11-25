/**
 * 実質価格計算エンジン（UI から独立した純粋関数）。
 *
 * 価格区分:
 *  - confirmed  : 取得済み情報（API の価格・送料区分・商品別ポイント倍率）＋通常購入分1倍のみ
 *  - estimated  : confirmed ＋ ユーザー設定（SPU・買い回り・日付キャンペーン）を反映した概算
 *  - reference  : estimated ＋ 未確認条件（クーポン、スーパーDEAL、店舗独自ポイント、仮定送料）を仮定した参考価格
 *
 * 重複計上防止:
 *  - 通常購入分 1 倍（1%）は "normal" 行で 1 回だけ計上する
 *  - 基本倍率（初期値9倍）は通常1倍を含むため、SPU 行は (基本倍率 − 1) 倍
 *  - API の pointRate（商品別ポイント倍率）も通常1倍を含む倍率として扱い、(pointRate − 1) 倍
 *  - スーパーDEAL の還元率が通常1倍を含む設定なら (還元率 − 1)%
 *
 * 端数処理: 各キャンペーンごとに対象金額×倍率% を算出し、小数点以下切り捨て、その後に上限を適用。
 */
import type { Product } from '../types';
import type { ItemOverride, PointBase, UserSettings } from './settings';

export type PriceTier = 'confirmed' | 'estimated' | 'reference';
export const TIERS: PriceTier[] = ['confirmed', 'estimated', 'reference'];

export const TIER_LABELS: Record<PriceTier, string> = {
  confirmed: '取得済み情報に基づく価格',
  estimated: 'ユーザー設定を反映した概算実質価格',
  reference: 'クーポン・追加還元を仮定した参考価格',
};

export interface PointLine {
  id: 'normal' | 'shop' | 'spu' | 'kaimawari' | 'day' | 'superDeal' | 'shopExtra';
  label: string;
  /** この行が最初に含まれる価格区分 */
  tier: PriceTier;
  basis: PointBase;
  /** 計算対象金額（円） */
  baseAmount: number;
  /** 適用率（%） */
  ratePercent: number;
  /** 上限適用前のポイント（切り捨て後） */
  rawPoints: number;
  /** 適用した上限（null=上限なし） */
  cap: number | null;
  points: number;
  note: string | null;
}

export interface TierResult {
  tier: PriceTier;
  /** 税込商品価格 */
  itemPriceInclTax: number;
  couponDiscount: number;
  /** クーポン適用後の商品代金 */
  goodsPayment: number;
  /** 送料（不明なら null） */
  shipping: number | null;
  shippingAssumed: boolean;
  /** 実際の支払額（送料不明なら null） */
  payment: number | null;
  pointLines: PointLine[];
  totalPoints: number;
  /** ポイント評価額（円） */
  pointValue: number;
  /** 実質価格 = 支払額 − ポイント評価額（送料不明なら null） */
  netPrice: number | null;
  /** 送料を含まない実質価格（送料不明商品の参考表示用） */
  netPriceExShipping: number;
  /** ポイント還元率（%）= ポイント評価額 ÷ 支払額（送料不明時は商品代金で計算） */
  pointReturnPercent: number;
}

export interface PriceResult {
  taxRate: number;
  /** 税区分が不明で税込と仮定した */
  taxAssumed: boolean;
  /** 商品別ポイント倍率が期間内か */
  shopRateStatus: 'active' | 'none' | 'notStarted' | 'expired';
  tiers: Record<PriceTier, TierResult>;
  notes: string[];
}

export interface PriceInput {
  product: Pick<
    Product,
    'itemPrice' | 'taxIncluded' | 'shipping' | 'pointRate' | 'pointRateStartTime' | 'pointRateEndTime'
  >;
  settings: UserSettings;
  override?: ItemOverride;
  /** カテゴリ既定の税率（%） */
  categoryTaxRate: number;
  now?: Date;
}

const floor = (n: number) => Math.floor(n + 1e-9);

/** 楽天 API の日時表記（JST, "YYYY-MM-DD HH:mm"）を Date に変換 */
export function parseJstDateTime(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', sec = '0'] = m;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 9, Number(mi), Number(sec));
  return Number.isFinite(utc) ? new Date(utc) : null;
}

function effectiveCap(cap: number | null, remaining: number | null): number | null {
  const vals = [cap, remaining].filter((v): v is number => v !== null && v !== undefined);
  return vals.length > 0 ? Math.max(0, Math.min(...vals)) : null;
}

export function calculatePrice(input: PriceInput): PriceResult {
  const { product, settings, override = {}, now = new Date() } = input;
  const notes: string[] = [];
  const taxRate = override.taxRate ?? settings.taxRateOverride ?? input.categoryTaxRate;

  // 税込価格
  let taxAssumed = false;
  let itemPriceInclTax: number;
  if (product.taxIncluded === false) {
    itemPriceInclTax = floor((product.itemPrice * (100 + taxRate)) / 100);
    notes.push(`税別価格のため消費税${taxRate}%を加算（切り捨て）`);
  } else {
    itemPriceInclTax = product.itemPrice;
    if (product.taxIncluded === null) {
      taxAssumed = true;
      notes.push('税区分が不明のため税込価格として計算');
    }
  }

  // 商品別ポイント倍率の期間判定
  let shopRateStatus: PriceResult['shopRateStatus'] = 'none';
  const rate = product.pointRate ?? 1;
  if (rate > 1) {
    const start = parseJstDateTime(product.pointRateStartTime);
    const end = parseJstDateTime(product.pointRateEndTime);
    if (start && now < start) {
      shopRateStatus = 'notStarted';
      notes.push('商品別ポイントアップは期間前のため未加算');
    } else if (end && now > end) {
      shopRateStatus = 'expired';
      notes.push('商品別ポイントアップは期間終了のため未加算');
    } else {
      shopRateStatus = 'active';
    }
  }

  const computeTier = (tier: PriceTier): TierResult => {
    const includes = (t: PriceTier) => TIERS.indexOf(t) <= TIERS.indexOf(tier);

    // クーポン（参考価格のみ）
    let couponDiscount = 0;
    if (includes('reference')) {
      const itemCouponYen = override.couponYen ?? 0;
      const itemCouponPct = override.couponPercent ?? 0;
      let globalYen = 0;
      let globalPct = 0;
      if (settings.coupon.enabled && itemPriceInclTax >= settings.coupon.minPurchaseYen) {
        globalYen = settings.coupon.amountYen;
        globalPct = settings.coupon.percent;
      }
      const pct = Math.min(100, itemCouponPct + globalPct);
      couponDiscount = Math.min(
        itemPriceInclTax,
        itemCouponYen + globalYen + floor((itemPriceInclTax * pct) / 100),
      );
    }
    const goodsPayment = itemPriceInclTax - couponDiscount;

    // 送料
    let shipping: number | null;
    let shippingAssumed = false;
    if (product.shipping.kind === 'included') {
      shipping = 0;
    } else if (override.shippingYen !== undefined) {
      shipping = override.shippingYen;
    } else if (product.shipping.amount !== null) {
      shipping = product.shipping.amount;
    } else if (includes('reference') && settings.assumedShippingYen !== null) {
      shipping = settings.assumedShippingYen;
      shippingAssumed = true;
    } else {
      shipping = null;
    }
    const payment = shipping === null ? null : goodsPayment + shipping;

    // ポイント対象金額（送料は対象外）
    const taxExcluded = floor((goodsPayment * 100) / (100 + taxRate));
    const baseOf = (b: PointBase) => (b === 'taxIncluded' ? goodsPayment : taxExcluded);

    const lines: PointLine[] = [];
    const addLine = (
      id: PointLine['id'],
      label: string,
      lineTier: PriceTier,
      basis: PointBase,
      ratePercent: number,
      cap: number | null,
      note: string | null = null,
    ) => {
      if (!includes(lineTier) || ratePercent <= 0) return;
      const baseAmount = baseOf(basis);
      const rawPoints = floor((baseAmount * ratePercent) / 100);
      const points = cap === null ? rawPoints : Math.min(rawPoints, cap);
      lines.push({
        id,
        label,
        tier: lineTier,
        basis,
        baseAmount,
        ratePercent,
        rawPoints,
        cap,
        points,
        note: points < rawPoints ? `上限${cap}ptを適用` : note,
      });
    };

    // 1. 通常購入分（1倍）— 1回だけ計上
    addLine('normal', '通常購入ポイント（1倍）', 'confirmed', settings.basePointBase, 1, null);

    // 2. 商品別ポイント倍率（API）— 通常1倍を含むため −1
    if (shopRateStatus === 'active') {
      addLine(
        'shop',
        `商品別ポイント${rate}倍（通常1倍を除く+${rate - 1}倍）`,
        'confirmed',
        settings.shopPointBase,
        rate - 1,
        null,
      );
    }

    // 3. SPU 等（基本倍率は通常1倍を含むため −1）
    const spuRate = Math.max(0, settings.baseMultiplier - 1) + settings.spuExtra;
    addLine(
      'spu',
      `SPU等（基本${settings.baseMultiplier}倍−通常1倍${settings.spuExtra > 0 ? `＋追加${settings.spuExtra}倍` : ''}）`,
      'estimated',
      settings.basePointBase,
      spuRate,
      effectiveCap(settings.baseCap, settings.baseRemainingCap),
    );

    // 4. 買い回り
    if (settings.kaimawari.enabled) {
      addLine(
        'kaimawari',
        `買い回り（+${settings.kaimawari.extraMultiplier}倍）`,
        'estimated',
        settings.kaimawari.base,
        settings.kaimawari.extraMultiplier,
        effectiveCap(settings.kaimawari.cap, settings.kaimawari.remainingCap),
      );
    }

    // 5. 日付キャンペーン
    if (settings.dayCampaign.enabled) {
      addLine(
        'day',
        `日付キャンペーン（+${settings.dayCampaign.extraMultiplier}倍）`,
        'estimated',
        settings.dayCampaign.base,
        settings.dayCampaign.extraMultiplier,
        effectiveCap(settings.dayCampaign.cap, settings.dayCampaign.remainingCap),
      );
    }

    // 6. スーパーDEAL（商品ごとに手動指定した場合のみ）
    if (override.superDealPercent !== undefined && override.superDealPercent > 0) {
      const dealRate = override.superDealPercent;
      const extra = settings.superDeal.includesNormal ? Math.max(0, dealRate - 1) : dealRate;
      addLine(
        'superDeal',
        `スーパーDEAL ${dealRate}%${settings.superDeal.includesNormal ? '（通常1%分を除く）' : ''}`,
        'reference',
        settings.superDeal.base,
        extra,
        effectiveCap(settings.superDeal.cap, settings.superDeal.remainingCap),
      );
    }

    // 7. 店舗独自の追加ポイント（手動入力）
    if (override.shopExtraPercent !== undefined && override.shopExtraPercent > 0) {
      addLine(
        'shopExtra',
        `店舗独自ポイント（+${override.shopExtraPercent}%）`,
        'reference',
        settings.shopPointBase,
        override.shopExtraPercent,
        null,
      );
    }

    const totalPoints = lines.reduce((s, l) => s + l.points, 0);
    const pointValue = Math.round(totalPoints * settings.pointValueYen * 100) / 100;
    const netPrice = payment === null ? null : payment - pointValue;
    const netPriceExShipping = goodsPayment - pointValue;
    const denom = payment ?? goodsPayment;
    const pointReturnPercent = denom > 0 ? (pointValue / denom) * 100 : 0;

    return {
      tier,
      itemPriceInclTax,
      couponDiscount,
      goodsPayment,
      shipping,
      shippingAssumed,
      payment,
      pointLines: lines,
      totalPoints,
      pointValue,
      netPrice,
      netPriceExShipping,
      pointReturnPercent,
    };
  };

  if (product.shipping.kind === 'separate' && product.shipping.amount === null && override.shippingYen === undefined) {
    notes.push('送料別（金額不明）。送料無料とはみなしていません');
  }

  return {
    taxRate,
    taxAssumed,
    shopRateStatus,
    tiers: {
      confirmed: computeTier('confirmed'),
      estimated: computeTier('estimated'),
      reference: computeTier('reference'),
    },
    notes,
  };
}

/** 実質単価 = 実質価格 ÷ 合計内容量 × 比較単位 */
export function unitPrice(netPrice: number | null, totalAmount: number | null, per: number): number | null {
  if (netPrice === null || totalAmount === null || !(totalAmount > 0) || !(per > 0)) return null;
  return (netPrice / totalAmount) * per;
}
