import { describe, expect, it } from 'vitest';
import { rankByUnits, rankProducts, sortRows } from '../../src/shared/ranking';
import { DEFAULT_SETTINGS } from '../../src/shared/pricing/settings';
import { chooseUnit, getCategory, getUnit, guessCategory, resolveCategory, selectAmount } from '../../src/shared/quantity/categories';
import { parseQuantity } from '../../src/shared/quantity/parser';
import type { Product } from '../../src/shared/types';

const NOW = new Date('2026-11-25T03:00:00Z');
let n = 0;
function prod(name: string, price: number, extra: Partial<Product> = {}): Product {
  n++;
  return {
    itemCode: `s:${String(n).padStart(3, '0')}`,
    itemName: name,
    catchcopy: null,
    itemCaption: null,
    imageUrl: null,
    brand: null,
    shopName: 'shop',
    shopCode: 's',
    itemPrice: price,
    taxIncluded: true,
    itemPriceMin: null,
    itemPriceMax: null,
    shipping: { kind: 'included' },
    pointRate: 1,
    pointRateStartTime: null,
    pointRateEndTime: null,
    available: true,
    reviewAverage: null,
    reviewCount: 0,
    itemUrl: null,
    affiliateUrl: null,
    genreId: null,
    fetchedAt: NOW.toISOString(),
    ...extra,
  };
}

const cat = getCategory('liquid-detergent');
const unit = getUnit(cat);
const rank = (products: Product[], sortKey: Parameters<typeof rankProducts>[0]['sortKey'] = 'unitPrice', overrides = {}) =>
  rankProducts({ products, category: cat, unit, settings: DEFAULT_SETTINGS, overrides, sortKey, now: NOW });

describe('ランキング', () => {
  const a = prod('柔軟剤 1200ml×6袋', 3980, { reviewAverage: 4.2, reviewCount: 10 }); // 7200ml
  const b = prod('柔軟剤 1200ml×3袋', 1800, { reviewAverage: 4.8, reviewCount: 5 }); // 3600ml 安い
  const c = prod('柔軟剤 2000ml', 1500, { pointRate: 10, reviewAverage: 4.8, reviewCount: 50 }); // 高還元
  const products = [a, b, c];

  it('実質単価が安い順（初期表示）', () => {
    const r = rank(products);
    const ups = r.main.map((x) => x.unitPrice!);
    expect(ups).toEqual([...ups].sort((x, y) => x - y));
    expect(r.main[0]!.product.itemCode).toBe(b.itemCode);
  });
  it('実質総額順・支払額順・内容量順', () => {
    expect(rank(products, 'netPrice').main.map((x) => x.product.itemCode)).toEqual([c, b, a].map((p) => p.itemCode));
    expect(rank(products, 'payment').main.map((x) => x.product.itemCode)).toEqual([c, b, a].map((p) => p.itemCode));
    expect(rank(products, 'quantity').main.map((x) => x.product.itemCode)).toEqual([a, b, c].map((p) => p.itemCode));
  });
  it('ポイント還元率順', () => {
    expect(rank(products, 'pointRate').main[0]!.product.itemCode).toBe(c.itemCode);
  });
  it('レビュー順（同評価は件数の多い順）', () => {
    expect(rank(products, 'review').main.map((x) => x.product.itemCode)).toEqual([c, b, a].map((p) => p.itemCode));
  });
  it('単価の検算', () => {
    const r = rank([a]).main[0]!;
    // 3980円 税抜3618 → 1%=36, 8%=289 → 325pt → 実質3655円 / 7200ml × 100
    expect(r.tier.totalPoints).toBe(36 + 289);
    expect(r.unitPrice).toBeCloseTo((3980 - 325) / 72, 6);
  });
  it('判定不能・単位違いは別枠', () => {
    const r = rank([a, prod('【選べる】柔軟剤 400ml/1200ml', 500), prod('粉末洗剤 900g', 400)]);
    expect(r.main).toHaveLength(1);
    expect(r.unrankable).toHaveLength(2);
    expect(r.unrankable.map((x) => x.reason).join()).toMatch(/判定できません|異なる単位/);
  });
  it('送料不明は別枠（送料無料とみなさない）', () => {
    const r = rank([a, prod('柔軟剤 1200ml×6袋', 100, { shipping: { kind: 'separate', amount: null } })]);
    expect(r.main).toHaveLength(1);
    expect(r.shippingUnknown).toHaveLength(1);
    expect(r.shippingUnknown[0]!.unitPrice).toBeNull();
    expect(r.shippingUnknown[0]!.unitPriceExShipping).not.toBeNull();
  });
  it('手動補正で判定不能をランキングに入れられる', () => {
    const x = prod('【選べる】柔軟剤 400ml/1200ml', 500);
    const r = rank([x], 'unitPrice', { [x.itemCode]: { quantity: { dimension: 'volume', perUnit: 400, setCount: 1 } } });
    expect(r.main).toHaveLength(1);
    expect(r.main[0]!.quantity.source).toBe('manual');
    expect(r.main[0]!.overridden).toBe(true);
  });
  it('アフィリエイト報酬率が異なっても順位は変わらない', () => {
    const r1 = rank(products).main.map((x) => x.product.itemCode);
    const withAff = products.map((p, i) => ({ ...p, affiliateRate: i * 10 }) as Product);
    expect(rank(withAff).main.map((x) => x.product.itemCode)).toEqual(r1);
  });
  it('本体・詰め替えフィルター、最低内容量フィルター', () => {
    const r = rankProducts({
      products: [prod('柔軟剤 詰め替え 1200ml', 500), prod('柔軟剤 本体 500ml', 400), prod('柔軟剤 詰め替え 400ml', 200)],
      category: cat,
      unit,
      settings: DEFAULT_SETTINGS,
      overrides: {},
      sortKey: 'unitPrice',
      filters: { packageKind: 'refill', minTotalAmount: 1000 },
      now: NOW,
    });
    expect(r.main).toHaveLength(1);
    expect(r.filteredOut).toBe(2);
  });
  it('null は常に末尾', () => {
    const r = rank([prod('柔軟剤 1200ml', 500, { reviewAverage: null }), prod('柔軟剤 1000ml', 500, { reviewAverage: 3, reviewCount: 1 })], 'review');
    expect(r.main[1]!.product.reviewAverage).toBeNull();
    expect(sortRows([], 'unitPrice')).toEqual([]);
  });
  it('設定変更で即座に再計算される（基本倍率を上げると実質価格が下がる）', () => {
    const r1 = rank([a]).main[0]!.tier.netPrice!;
    const r2 = rankProducts({ products: [a], category: cat, unit, settings: { ...DEFAULT_SETTINGS, baseMultiplier: 15 }, overrides: {}, sortKey: 'unitPrice', now: NOW }).main[0]!.tier.netPrice!;
    expect(r2).toBeLessThan(r1);
  });
});

describe('カテゴリ', () => {
  it('キーワードからカテゴリ推定', () => {
    expect(guessCategory('ソフラン プレミアム消臭').id).toBe('liquid-detergent');
    expect(guessCategory('トイレットペーパー ダブル').id).toBe('toilet-paper');
    expect(guessCategory('災害用携帯トイレ').id).toBe('portable-toilet');
    expect(guessCategory('長期保存食').id).toBe('emergency-food');
    expect(guessCategory('ティッシュペーパー').id).toBe('tissue');
    expect(guessCategory('なにか').id).toBe('other');
    expect(guessCategory('洗剤').id).toBe('liquid-detergent');
    expect(guessCategory('粉末洗剤 3kg').id).toBe('powder-detergent');
  });
  it('携帯トイレで個数のみの場合は「1個=1回」と仮定して要確認', () => {
    const s = selectAmount(parseQuantity('携帯トイレ 30個入'), getUnit(getCategory('portable-toilet')));
    expect(s).toEqual({ total: 30, confidence: 'review', note: expect.stringContaining('仮定') });
  });
  it('飲料は 100ml と 1本 を切替', () => {
    const q = parseQuantity('水 500ml×24本×2ケース');
    const bev = getCategory('beverage');
    expect(selectAmount(q, getUnit(bev, 'ml100'))!.total).toBe(24000);
    expect(selectAmount(q, getUnit(bev, 'bottle1'))!.total).toBe(48);
  });
  it('異なる次元は選択されない', () => {
    expect(selectAmount(parseQuantity('洗剤 400g'), getUnit(cat))).toBeNull();
  });
});

describe('比較単位の自動選択', () => {
  const auto = (products: Product[], categoryId = 'liquid-detergent', unitId = 'auto') =>
    rankByUnits({ products, category: getCategory(categoryId), unitId, settings: DEFAULT_SETTINGS, overrides: {}, sortKey: 'unitPrice', now: NOW });

  it('商品ごとの単位: カテゴリ単位 → 主要次元の既定単位 → 個数', () => {
    const liquid = getCategory('liquid-detergent');
    expect(chooseUnit(parseQuantity('柔軟剤 1.2L×6袋'), liquid)!.id).toBe('ml100');
    expect(chooseUnit(parseQuantity('粉末洗剤 0.9kg'), liquid)!.id).toBe('g100');
    expect(chooseUnit(parseQuantity('ペーパー 50m×12ロール'), liquid)!.id).toBe('m1');
    expect(chooseUnit(parseQuantity('洗剤 6個セット'), liquid)).toBeNull();
    // その他カテゴリでも ml の商品は個数ではなく ml で比較
    expect(chooseUnit(parseQuantity('なにか 500ml×3本'), getCategory('other'))!.id).toBe('ml100');
    expect(chooseUnit(parseQuantity('なにか 3個セット'), getCategory('other'))!.id).toBe('piece1');
    // 粉末洗剤は「0.9kg 約45回分」でも g を優先
    expect(chooseUnit(parseQuantity('粉末洗剤 0.9kg 約45回分'), getCategory('powder-detergent'))!.id).toBe('g100');
    // 携帯トイレは個数のみでも「回」（要確認）
    expect(chooseUnit(parseQuantity('携帯トイレ 30個入'), getCategory('portable-toilet'))!.id).toBe('use1');
  });

  it('L と ml、kg と g は換算して同じランキングに入る', () => {
    const r = auto([prod('柔軟剤 1.2L×3', 1500), prod('柔軟剤 400ml×2', 600), prod('柔軟剤 2000ml', 900)]);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]!.unit.id).toBe('ml100');
    expect(r.groups[0]!.main).toHaveLength(3);
  });

  it('ml と g は混ぜず、件数の多い単位を主ランキングにする', () => {
    const r = auto([prod('洗剤 1.2L', 500), prod('洗剤 400g', 300), prod('洗剤 900g', 500), prod('洗剤 2kg', 900)]);
    expect(r.groups.map((g) => [g.unit.id, g.main.length])).toEqual([
      ['g100', 3],
      ['ml100', 1],
    ]);
  });

  it('同数ならカテゴリの単位を優先', () => {
    const r = auto([prod('洗剤 400g', 300), prod('洗剤 1.2L', 500)]);
    expect(r.groups[0]!.unit.id).toBe('ml100');
  });

  it('内容量不明は比較対象外、送料不明は各単位の中で別枠', () => {
    const r = auto([
      prod('洗剤 1.2L', 500),
      prod('洗剤 1.2L', 400, { shipping: { kind: 'separate', amount: null } }),
      prod('【選べる】洗剤 400ml/1200ml', 500),
    ]);
    expect(r.groups[0]!.main).toHaveLength(1);
    expect(r.groups[0]!.shippingUnknown).toHaveLength(1);
    expect(r.unrankable).toHaveLength(1);
  });

  it('単位を指定すれば従来どおり 1 つのランキング', () => {
    const r = auto([prod('洗剤 1.2L', 500), prod('洗剤 400g', 300)], 'liquid-detergent', 'ml100');
    expect(r.auto).toBe(false);
    expect(r.groups).toHaveLength(1);
    expect(r.unrankable).toHaveLength(1);
  });

  it('カテゴリ auto はキーワードから推定', () => {
    expect(resolveCategory('auto', 'トイレットペーパー').id).toBe('toilet-paper');
    expect(resolveCategory('food', 'トイレットペーパー').id).toBe('food');
  });
});
