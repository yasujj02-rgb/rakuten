/**
 * 商品ランキング。比較単位ごとに次元を揃え、異なる次元・判定不能の商品は別枠に分ける。
 * アフィリエイト報酬率はランキングに一切使用しない。
 */
import { calculatePrice, unitPrice, type PriceResult, type TierResult } from './pricing/engine';
import type { ItemOverride, UserSettings } from './pricing/settings';
import { parseQuantity } from './quantity/parser';
import {
  AUTO,
  chooseUnit,
  findUnit,
  selectAmount,
  type Category,
  type ComparisonUnit,
  type SelectedAmount,
} from './quantity/categories';
import type { PackageKind, Product, QuantityParseResult, SortKey } from './types';

export type RowGroup = 'main' | 'shippingUnknown' | 'unrankable';

export interface RankedRow {
  product: Product;
  quantity: QuantityParseResult;
  selected: SelectedAmount | null;
  price: PriceResult;
  /** ランキングに用いた価格区分の計算結果 */
  tier: TierResult;
  unitPrice: number | null;
  /** 送料を含まない実質単価（送料不明商品の参考） */
  unitPriceExShipping: number | null;
  /** 1回使用あたりの実質価格（使用量を手動入力した場合のみ） */
  perUsePrice: number | null;
  group: RowGroup;
  reason: string | null;
  overridden: boolean;
}

export interface RankingFilters {
  packageKind?: Exclude<PackageKind, 'mixed' | 'unknown'> | 'all';
  /** 比較単位の基本単位での最低合計量（例: ml） */
  minTotalAmount?: number | null;
}

export interface RankingResult {
  unit: ComparisonUnit;
  main: RankedRow[];
  shippingUnknown: RankedRow[];
  unrankable: RankedRow[];
  filteredOut: number;
}

export function applyQuantityOverride(
  parsed: QuantityParseResult,
  override?: ItemOverride,
): QuantityParseResult {
  const q = override?.quantity;
  if (!q) return parsed;
  const total = q.perUnit * q.setCount;
  return {
    ...parsed,
    amounts: {
      [q.dimension]: { perUnit: q.perUnit, total, approx: false },
      ...(q.dimension === 'pieces'
        ? {}
        : { pieces: { perUnit: 1, total: q.setCount, approx: false } }),
    },
    unitAmount: q.perUnit,
    dimension: q.dimension,
    setCount: q.setCount,
    totalAmount: total,
    totalPieces: q.setCount,
    confidence: 'confirmed',
    reasons: ['手動で補正した数量'],
    source: 'manual',
  };
}

export function buildRow(
  product: Product,
  category: Category,
  unit: ComparisonUnit,
  settings: UserSettings,
  override: ItemOverride | undefined,
  now: Date,
  parsedInput?: QuantityParseResult,
): RankedRow {
  const parsed =
    parsedInput ?? applyQuantityOverride(parseQuantity(product.itemName, product.itemCaption), override);
  const selected = selectAmount(parsed, unit);
  const price = calculatePrice({
    product,
    settings,
    override,
    categoryTaxRate: category.taxRate,
    now,
  });
  const tier = price.tiers[settings.rankingTier];
  const total = selected?.total ?? null;
  const up = unitPrice(tier.netPrice, total, unit.per);
  const upEx = unitPrice(tier.netPriceExShipping, total, unit.per);

  let perUsePrice: number | null = null;
  if (override?.perUseAmount && parsed.dimension && (parsed.dimension === 'volume' || parsed.dimension === 'mass')) {
    const amt = parsed.amounts[parsed.dimension];
    if (amt && tier.netPrice !== null) {
      const uses = amt.total / override.perUseAmount;
      perUsePrice = uses > 0 ? tier.netPrice / uses : null;
    }
  }

  let group: RowGroup = 'main';
  let reason: string | null = null;
  if (!selected) {
    group = 'unrankable';
    reason =
      parsed.confidence === 'unknown' && parsed.dimension === null && Object.keys(parsed.amounts).length <= 1
        ? '内容量を判定できません'
        : `比較単位（${unit.label}）と異なる単位の商品です`;
  } else if (selected.confidence === 'unknown') {
    group = 'unrankable';
    reason = '内容量を判定できません';
  } else if (tier.payment === null) {
    group = 'shippingUnknown';
    reason = '送料が不明のため、送料を含まない参考値で並べています';
  }

  return {
    product,
    quantity: parsed,
    selected,
    price,
    tier,
    unitPrice: up,
    unitPriceExShipping: upEx,
    perUsePrice,
    group,
    reason,
    overridden: Boolean(override && Object.keys(override).length > 0),
  };
}

type Extract = (r: RankedRow) => number | null;

function metric(key: SortKey, group: RowGroup): { get: Extract; dir: 1 | -1 } {
  switch (key) {
    case 'unitPrice':
      return { get: (r) => (group === 'shippingUnknown' ? r.unitPriceExShipping : r.unitPrice), dir: 1 };
    case 'netPrice':
      return { get: (r) => (group === 'shippingUnknown' ? r.tier.netPriceExShipping : r.tier.netPrice), dir: 1 };
    case 'payment':
      return { get: (r) => (group === 'shippingUnknown' ? r.tier.goodsPayment : r.tier.payment), dir: 1 };
    case 'pointRate':
      return { get: (r) => r.tier.pointReturnPercent, dir: -1 };
    case 'review':
      return { get: (r) => r.product.reviewAverage, dir: -1 };
    case 'quantity':
      return { get: (r) => r.selected?.total ?? null, dir: -1 };
  }
}

export function sortRows(rows: RankedRow[], key: SortKey, group: RowGroup = 'main'): RankedRow[] {
  const { get, dir } = metric(key, group);
  return [...rows].sort((a, b) => {
    const va = get(a);
    const vb = get(b);
    if (va === null && vb === null) return tieBreak(a, b);
    if (va === null) return 1; // 不明値は常に末尾
    if (vb === null) return -1;
    if (va !== vb) return (va - vb) * dir;
    if (key === 'review') {
      const ca = a.product.reviewCount ?? 0;
      const cb = b.product.reviewCount ?? 0;
      if (ca !== cb) return cb - ca;
    }
    return tieBreak(a, b);
  });
}

function tieBreak(a: RankedRow, b: RankedRow): number {
  const pa = a.tier.payment ?? a.tier.goodsPayment;
  const pb = b.tier.payment ?? b.tier.goodsPayment;
  if (pa !== pb) return pa - pb;
  return a.product.itemCode < b.product.itemCode ? -1 : a.product.itemCode > b.product.itemCode ? 1 : 0;
}

export function rankProducts(params: {
  products: Product[];
  category: Category;
  unit: ComparisonUnit;
  settings: UserSettings;
  overrides: Record<string, ItemOverride>;
  sortKey: SortKey;
  filters?: RankingFilters;
  now?: Date;
}): RankingResult {
  const { products, category, unit, settings, overrides, sortKey, filters = {}, now = new Date() } = params;
  const rows = products.map((p) => buildRow(p, category, unit, settings, overrides[p.itemCode], now));
  let filteredOut = 0;
  const kept = rows.filter((r) => {
    if (filters.packageKind && filters.packageKind !== 'all') {
      if (r.quantity.packageKind !== filters.packageKind) {
        filteredOut++;
        return false;
      }
    }
    if (filters.minTotalAmount && filters.minTotalAmount > 0) {
      // 量が不明な商品は除外せず別枠に残す（不明を条件外と断定しない）
      if (r.selected && r.selected.total < filters.minTotalAmount) {
        filteredOut++;
        return false;
      }
    }
    return true;
  });
  return {
    unit,
    main: sortRows(kept.filter((r) => r.group === 'main'), sortKey, 'main'),
    shippingUnknown: sortRows(kept.filter((r) => r.group === 'shippingUnknown'), sortKey, 'shippingUnknown'),
    unrankable: sortRows(kept.filter((r) => r.group === 'unrankable'), 'payment', 'unrankable'),
    filteredOut,
  };
}

/** 比較単位ごとのランキング */
export interface UnitRanking {
  unit: ComparisonUnit;
  main: RankedRow[];
  shippingUnknown: RankedRow[];
}

export interface MultiRankingResult {
  /** 先頭が主たる比較単位（商品数が最も多い単位） */
  groups: UnitRanking[];
  unrankable: RankedRow[];
  filteredOut: number;
  /** 比較単位を自動選択したか */
  auto: boolean;
}

function passesFilters(r: RankedRow, filters: RankingFilters): boolean {
  if (filters.packageKind && filters.packageKind !== 'all' && r.quantity.packageKind !== filters.packageKind) {
    return false;
  }
  // 量が不明な商品は除外せず残す（不明を条件外と断定しない）
  if (filters.minTotalAmount && filters.minTotalAmount > 0 && r.selected && r.selected.total < filters.minTotalAmount) {
    return false;
  }
  return true;
}

/**
 * unitId が 'auto' なら商品ごとに比較単位を自動選択し、単位ごとにランキングを作る。
 * 単位を指定した場合はその単位 1 つのランキング（従来どおり）。
 */
export function rankByUnits(params: {
  products: Product[];
  category: Category;
  unitId: string;
  settings: UserSettings;
  overrides: Record<string, ItemOverride>;
  sortKey: SortKey;
  filters?: RankingFilters;
  now?: Date;
}): MultiRankingResult {
  const { products, category, settings, overrides, sortKey, filters = {}, now = new Date() } = params;
  const fixed = params.unitId === AUTO ? null : findUnit(params.unitId);
  if (fixed) {
    const r = rankProducts({ ...params, unit: fixed, filters, now });
    return {
      groups: [{ unit: fixed, main: r.main, shippingUnknown: r.shippingUnknown }],
      unrankable: r.unrankable,
      filteredOut: r.filteredOut,
      auto: false,
    };
  }

  const byUnit = new Map<string, { unit: ComparisonUnit; rows: RankedRow[] }>();
  const unrankable: RankedRow[] = [];
  let filteredOut = 0;
  for (const p of products) {
    const override = overrides[p.itemCode];
    const parsed = applyQuantityOverride(parseQuantity(p.itemName, p.itemCaption), override);
    const unit = chooseUnit(parsed, category) ?? category.units[0]!;
    const row = buildRow(p, category, unit, settings, override, now, parsed);
    if (!passesFilters(row, filters)) {
      filteredOut++;
      continue;
    }
    if (row.group === 'unrankable') {
      unrankable.push(row);
      continue;
    }
    const entry = byUnit.get(unit.id) ?? { unit, rows: [] };
    entry.rows.push(row);
    byUnit.set(unit.id, entry);
  }

  const catOrder = (u: ComparisonUnit) => {
    const i = category.units.findIndex((c) => c.id === u.id);
    return i < 0 ? 99 : i;
  };
  const groups = [...byUnit.values()]
    .sort((a, b) => b.rows.length - a.rows.length || catOrder(a.unit) - catOrder(b.unit))
    .map(({ unit, rows }) => ({
      unit,
      main: sortRows(rows.filter((r) => r.group === 'main'), sortKey, 'main'),
      shippingUnknown: sortRows(rows.filter((r) => r.group === 'shippingUnknown'), sortKey, 'shippingUnknown'),
    }));
  return { groups, unrankable: sortRows(unrankable, 'payment', 'unrankable'), filteredOut, auto: true };
}
