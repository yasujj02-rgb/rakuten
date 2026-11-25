import { describe, expect, it } from 'vitest';
import { calculatePrice, parseJstDateTime, unitPrice } from '../../src/shared/pricing/engine';
import { DEFAULT_SETTINGS, sanitizeSettings, sanitizeOverride, type UserSettings } from '../../src/shared/pricing/settings';
import type { Product } from '../../src/shared/types';

type P = Pick<Product, 'itemPrice' | 'taxIncluded' | 'shipping' | 'pointRate' | 'pointRateStartTime' | 'pointRateEndTime'>;
const base: P = {
  itemPrice: 1100,
  taxIncluded: true,
  shipping: { kind: 'included' },
  pointRate: 1,
  pointRateStartTime: null,
  pointRateEndTime: null,
};
const NOW = new Date('2026-11-25T03:00:00Z'); // JST 12:00
const calc = (p: Partial<P> = {}, s: Partial<UserSettings> = {}, override = {}, tax = 10) =>
  calculatePrice({
    product: { ...base, ...p },
    settings: { ...DEFAULT_SETTINGS, ...s },
    override,
    categoryTaxRate: tax,
    now: NOW,
  });

describe('基本計算', () => {
  it('取得済み区分は通常1倍のみ（税抜対象）', () => {
    const r = calc();
    const t = r.tiers.confirmed;
    expect(t.payment).toBe(1100);
    expect(t.totalPoints).toBe(10); // 税抜1000円 × 1%
    expect(t.netPrice).toBe(1090);
  });
  it('既定（基本9倍）の概算: 通常1倍 + SPU8倍 = 9%', () => {
    const t = calc().tiers.estimated;
    expect(t.pointLines.map((l) => [l.id, l.points])).toEqual([
      ['normal', 10],
      ['spu', 80],
    ]);
    expect(t.totalPoints).toBe(90);
    expect(t.netPrice).toBe(1010);
  });
  it('実質単価 = 実質価格 ÷ 合計内容量 × 比較単位', () => {
    expect(unitPrice(1010, 7200, 100)).toBeCloseTo(14.0278, 3);
    expect(unitPrice(null, 7200, 100)).toBeNull();
    expect(unitPrice(1000, 0, 100)).toBeNull();
    expect(unitPrice(1000, null, 100)).toBeNull();
  });
  it('端数は各キャンペーンごとに切り捨て', () => {
    // 税込1,099円 → 税抜 999円 → 1%=9.99→9pt, 8%=79.92→79pt
    const t = calc({ itemPrice: 1099 }).tiers.estimated;
    expect(t.pointLines.find((l) => l.id === 'normal')!.points).toBe(9);
    expect(t.pointLines.find((l) => l.id === 'spu')!.points).toBe(79);
  });
  it('ポイント評価額を変更できる', () => {
    const t = calc({}, { pointValueYen: 0.5 }).tiers.estimated;
    expect(t.pointValue).toBe(45);
    expect(t.netPrice).toBe(1055);
  });
});

describe('重複計上の防止', () => {
  it('基本9倍 + スーパーDEAL20%（通常1倍を含む）は 1+8+19 = 28%', () => {
    const r = calc({ itemPrice: 11000 }, {}, { superDealPercent: 20 });
    const t = r.tiers.reference;
    const byId = Object.fromEntries(t.pointLines.map((l) => [l.id, l.points]));
    expect(byId.normal).toBe(100);
    expect(byId.spu).toBe(800);
    expect(byId.superDeal).toBe(1900);
    expect(t.totalPoints).toBe(2800); // 29%（2900）にならない
    expect(t.pointLines.filter((l) => l.id === 'normal')).toHaveLength(1);
  });
  it('スーパーDEALが通常1倍を含まない設定なら 20% をそのまま加算', () => {
    const t = calc(
      { itemPrice: 11000 },
      { superDeal: { ...DEFAULT_SETTINGS.superDeal, includesNormal: false } },
      { superDealPercent: 20 },
    ).tiers.reference;
    expect(t.totalPoints).toBe(2900);
  });
  it('商品別ポイント10倍（API pointRate）は +9倍として加算し通常1倍を重複させない', () => {
    const r = calc({ pointRate: 10 });
    expect(r.tiers.confirmed.totalPoints).toBe(100); // 1 + 9 = 10%
    expect(r.tiers.estimated.totalPoints).toBe(180); // 1 + 9 + 8 = 18%
  });
  it('基本倍率1倍なら SPU 行を出さない', () => {
    const t = calc({}, { baseMultiplier: 1 }).tiers.estimated;
    expect(t.pointLines.map((l) => l.id)).toEqual(['normal']);
  });
  it('スーパーDEALは手動指定がない限り適用しない', () => {
    const t = calc().tiers.reference;
    expect(t.pointLines.some((l) => l.id === 'superDeal')).toBe(false);
  });
});

describe('商品別ポイントの期間', () => {
  it('期間内は加算', () => {
    const r = calc({ pointRate: 5, pointRateStartTime: '2026-11-20 10:00', pointRateEndTime: '2026-11-30 09:59' });
    expect(r.shopRateStatus).toBe('active');
    expect(r.tiers.confirmed.totalPoints).toBe(50);
  });
  it('期間終了後は加算しない', () => {
    const r = calc({ pointRate: 5, pointRateStartTime: '2026-11-01 10:00', pointRateEndTime: '2026-11-25 11:59' });
    expect(r.shopRateStatus).toBe('expired');
    expect(r.tiers.confirmed.totalPoints).toBe(10);
  });
  it('期間前は加算しない', () => {
    const r = calc({ pointRate: 5, pointRateStartTime: '2026-11-25 12:01', pointRateEndTime: null });
    expect(r.shopRateStatus).toBe('notStarted');
  });
  it('JST 日時の解釈', () => {
    expect(parseJstDateTime('2026-11-25 12:00')!.toISOString()).toBe('2026-11-25T03:00:00.000Z');
    expect(parseJstDateTime('invalid')).toBeNull();
    expect(parseJstDateTime(null)).toBeNull();
  });
});

describe('送料', () => {
  it('送料別で金額不明なら支払額・実質価格は不明（送料無料とみなさない）', () => {
    const r = calc({ shipping: { kind: 'separate', amount: null } });
    expect(r.tiers.estimated.payment).toBeNull();
    expect(r.tiers.estimated.netPrice).toBeNull();
    expect(r.tiers.estimated.netPriceExShipping).toBe(1010);
    expect(r.notes.join()).toContain('送料無料とはみなしていません');
  });
  it('仮定送料は参考価格にのみ反映', () => {
    const r = calc({ shipping: { kind: 'separate', amount: null } }, { assumedShippingYen: 500 });
    expect(r.tiers.estimated.payment).toBeNull();
    expect(r.tiers.reference.payment).toBe(1600);
    expect(r.tiers.reference.shippingAssumed).toBe(true);
  });
  it('手動入力送料は全区分に反映し、ポイント対象外', () => {
    const r = calc({ shipping: { kind: 'separate', amount: null } }, {}, { shippingYen: 660 });
    expect(r.tiers.confirmed.payment).toBe(1760);
    expect(r.tiers.estimated.totalPoints).toBe(90);
  });
  it('送料無料は 0 円', () => {
    expect(calc().tiers.confirmed.shipping).toBe(0);
  });
});

describe('税率', () => {
  it('税別価格（taxFlag=1）は税込に換算', () => {
    const r = calc({ itemPrice: 1000, taxIncluded: false });
    expect(r.tiers.confirmed.itemPriceInclTax).toBe(1100);
    expect(r.tiers.estimated.totalPoints).toBe(90);
  });
  it('軽減税率8%の食品', () => {
    const r = calc({ itemPrice: 1080 }, {}, {}, 8);
    expect(r.taxRate).toBe(8);
    expect(r.tiers.confirmed.totalPoints).toBe(10); // 税抜1000円
  });
  it('税区分不明は税込として計算し注記', () => {
    const r = calc({ taxIncluded: null });
    expect(r.taxAssumed).toBe(true);
    expect(r.notes.join()).toContain('税区分が不明');
  });
  it('税込対象のキャンペーン設定', () => {
    const t = calc({}, { basePointBase: 'taxIncluded' }).tiers.estimated;
    expect(t.totalPoints).toBe(99); // 1100 × 9%
  });
  it('商品別の税率上書き', () => {
    expect(calc({}, {}, { taxRate: 8 }).taxRate).toBe(8);
  });
});

describe('ポイント上限', () => {
  it('買い回りの上限と残り上限の小さい方を適用', () => {
    const t = calc(
      { itemPrice: 1_100_000 },
      { kaimawari: { enabled: true, extraMultiplier: 9, base: 'taxExcluded', cap: 7000, remainingCap: 3000 } },
    ).tiers.estimated;
    const line = t.pointLines.find((l) => l.id === 'kaimawari')!;
    expect(line.rawPoints).toBe(90_000);
    expect(line.points).toBe(3000);
    expect(line.note).toContain('上限3000pt');
  });
  it('残り上限0なら0pt', () => {
    const t = calc(
      {},
      { kaimawari: { enabled: true, extraMultiplier: 9, base: 'taxExcluded', cap: 7000, remainingCap: 0 } },
    ).tiers.estimated;
    expect(t.pointLines.find((l) => l.id === 'kaimawari')!.points).toBe(0);
  });
  it('SPU の上限', () => {
    const t = calc({ itemPrice: 110_000 }, { baseCap: 5000 }).tiers.estimated;
    expect(t.pointLines.find((l) => l.id === 'spu')!.points).toBe(5000);
  });
  it('無効なキャンペーンは加算しない', () => {
    const t = calc({}, { kaimawari: { ...DEFAULT_SETTINGS.kaimawari, enabled: false, extraMultiplier: 9 } }).tiers.estimated;
    expect(t.pointLines.some((l) => l.id === 'kaimawari')).toBe(false);
  });
});

describe('クーポン', () => {
  it('未確認クーポンは概算に適用せず参考価格のみ', () => {
    const r = calc({}, { coupon: { enabled: true, amountYen: 100, percent: 0, minPurchaseYen: 0 } });
    expect(r.tiers.estimated.couponDiscount).toBe(0);
    expect(r.tiers.reference.couponDiscount).toBe(100);
    // クーポン後 1000円 → 税抜 909円 → 9pt + 72pt
    expect(r.tiers.reference.totalPoints).toBe(9 + 72);
    expect(r.tiers.reference.payment).toBe(1000);
  });
  it('利用条件額未満は適用しない', () => {
    const r = calc({}, { coupon: { enabled: true, amountYen: 100, percent: 0, minPurchaseYen: 2000 } });
    expect(r.tiers.reference.couponDiscount).toBe(0);
  });
  it('金額クーポンと割引率クーポンの併用（商品別＋共通）', () => {
    const r = calc({ itemPrice: 2000 }, { coupon: { enabled: true, amountYen: 0, percent: 10, minPurchaseYen: 0 } }, { couponYen: 300 });
    expect(r.tiers.reference.couponDiscount).toBe(500);
  });
  it('値引きは商品価格を超えない', () => {
    const r = calc({}, {}, { couponYen: 5000 });
    expect(r.tiers.reference.goodsPayment).toBe(0);
    expect(r.tiers.reference.totalPoints).toBe(0);
  });
});

describe('設定値の検証', () => {
  it('不正値は既定値・範囲内に補正', () => {
    const s = sanitizeSettings({ baseMultiplier: 'abc', spuExtra: -5, pointValueYen: 999, kaimawari: { extraMultiplier: 200 } });
    expect(s.baseMultiplier).toBe(9);
    expect(s.spuExtra).toBe(0);
    expect(s.pointValueYen).toBe(10);
    expect(s.kaimawari.extraMultiplier).toBe(100);
  });
  it('null/undefined/配列でも既定値', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings([])).toEqual(DEFAULT_SETTINGS);
  });
  it('手動補正の検証', () => {
    expect(sanitizeOverride({ quantity: { dimension: 'volume', perUnit: 1200, setCount: 6 }, couponYen: -1, superDealPercent: '20' })).toEqual({
      quantity: { dimension: 'volume', perUnit: 1200, setCount: 6 },
      couponYen: 0,
      superDealPercent: 20,
    });
    expect(sanitizeOverride({ quantity: { dimension: 'evil', perUnit: 1, setCount: 1 } })).toEqual({});
  });
});
