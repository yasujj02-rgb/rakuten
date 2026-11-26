/**
 * 商品カテゴリと比較単位。
 * 異なる次元（ml と g 等）の商品は同一ランキングに混在させない。
 */
import type { Confidence, Dimension, QuantityParseResult } from '../types';

export interface ComparisonUnit {
  id: string;
  /** 表示ラベル（例: 100mlあたり） */
  label: string;
  dimension: Dimension;
  /** 比較単位の量（例: 100ml → 100） */
  per: number;
  /** 単位記号（表示用） */
  symbol: string;
  /**
   * 指定次元が無い場合に代替として使う次元（例: 携帯トイレで「個」を「回」とみなす）。
   * 代替を使った場合は信頼度を「要確認」に下げる。
   */
  aliasFrom?: Dimension[];
  aliasNote?: string;
}

export interface Category {
  id: string;
  label: string;
  units: ComparisonUnit[];
  /** 自動判定用キーワード（正規化済み小文字で照合） */
  keywords: string[];
  /** 既定の消費税率（%）。食品・飲料は軽減税率 8% */
  taxRate: number;
}

const U = {
  ml100: { id: 'ml100', label: '100mlあたり', dimension: 'volume', per: 100, symbol: 'ml' },
  g100: { id: 'g100', label: '100gあたり', dimension: 'mass', per: 100, symbol: 'g' },
  kg1: { id: 'kg1', label: '1kgあたり', dimension: 'mass', per: 1000, symbol: 'g' },
  m1: { id: 'm1', label: '1mあたり', dimension: 'length', per: 1, symbol: 'm' },
  pair100: { id: 'pair100', label: '100組あたり', dimension: 'pairs', per: 100, symbol: '組' },
  use1: {
    id: 'use1',
    label: '1回あたり',
    dimension: 'uses',
    per: 1,
    symbol: '回',
    aliasFrom: ['pieces'],
    aliasNote: '回数表記がないため「1個=1回」と仮定',
  },
  meal1: {
    id: 'meal1',
    label: '1食あたり',
    dimension: 'meals',
    per: 1,
    symbol: '食',
    aliasFrom: ['pieces'],
    aliasNote: '食数表記がないため「1個=1食」と仮定',
  },
  sheet1: { id: 'sheet1', label: '1枚あたり', dimension: 'sheets', per: 1, symbol: '枚' },
  piece1: { id: 'piece1', label: '1個あたり', dimension: 'pieces', per: 1, symbol: '個' },
  bottle1: { id: 'bottle1', label: '1本あたり', dimension: 'pieces', per: 1, symbol: '本' },
} satisfies Record<string, ComparisonUnit>;

export const CATEGORIES: Category[] = [
  {
    id: 'liquid-detergent',
    label: '柔軟剤・液体洗剤',
    units: [U.ml100],
    keywords: [
      '柔軟剤',
      '液体洗剤',
      '洗濯洗剤',
      'ソフラン',
      'レノア',
      'ハミング',
      'アタック',
      'アリエール',
      'ボールド',
      'キュキュット',
      'ジョイ',
      '食器用洗剤',
      '台所用洗剤',
      '洗剤',
    ],
    taxRate: 10,
  },
  {
    id: 'powder-detergent',
    label: '粉末洗剤',
    units: [U.g100],
    keywords: ['粉末洗剤', '粉洗剤', '粉末'],
    taxRate: 10,
  },
  {
    id: 'beverage',
    label: '飲料',
    units: [U.ml100, U.bottle1],
    keywords: ['水', 'ミネラルウォーター', 'お茶', '緑茶', 'コーヒー', '飲料', 'ジュース', '炭酸'],
    taxRate: 8,
  },
  {
    id: 'food',
    label: '米・食品',
    units: [U.g100, U.kg1],
    keywords: ['米', '白米', '玄米', 'パスタ', '食品', '小麦粉'],
    taxRate: 8,
  },
  {
    id: 'toilet-paper',
    label: 'トイレットペーパー',
    units: [U.m1],
    keywords: ['トイレットペーパー', 'トイレットロール'],
    taxRate: 10,
  },
  {
    id: 'tissue',
    label: 'ティッシュ',
    units: [U.pair100],
    keywords: ['ティッシュ'],
    taxRate: 10,
  },
  {
    id: 'portable-toilet',
    label: '携帯トイレ',
    units: [U.use1],
    keywords: ['携帯トイレ', '簡易トイレ', '非常用トイレ', '災害用トイレ'],
    taxRate: 10,
  },
  {
    id: 'emergency-food',
    label: '保存食',
    units: [U.meal1],
    keywords: ['保存食', '非常食', '長期保存', 'アルファ米'],
    taxRate: 8,
  },
  {
    id: 'diaper',
    label: 'おむつ',
    units: [U.sheet1],
    keywords: ['おむつ', 'オムツ', '紙おむつ'],
    taxRate: 10,
  },
  {
    id: 'other',
    label: 'その他',
    units: [U.piece1],
    keywords: [],
    taxRate: 10,
  },
];

export const DEFAULT_CATEGORY_ID = 'other';
/** カテゴリ・比較単位を自動判定する指定値 */
export const AUTO = 'auto';

/** 選択可能なすべての比較単位 */
export const ALL_UNITS: ComparisonUnit[] = Object.values(U);

/** 次元ごとの既定の比較単位（自動選択で使用） */
export const DEFAULT_UNIT_BY_DIMENSION: Record<Dimension, ComparisonUnit> = {
  volume: U.ml100,
  mass: U.g100,
  length: U.m1,
  pairs: U.pair100,
  sheets: U.sheet1,
  uses: U.use1,
  meals: U.meal1,
  pieces: U.piece1,
};

export function findUnit(id: string | null | undefined): ComparisonUnit | null {
  return ALL_UNITS.find((u) => u.id === id) ?? null;
}

export function getCategory(id: string | null | undefined): Category {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1]!;
}

/** 'auto' ならキーワードから推定、それ以外は指定カテゴリ */
export function resolveCategory(categoryId: string | null | undefined, keyword: string): Category {
  return !categoryId || categoryId === AUTO ? guessCategory(keyword) : getCategory(categoryId);
}

/**
 * 商品ごとに比較単位を自動で選ぶ。
 * 1. カテゴリの比較単位（個数系以外）で量が取れればそれを使う（例: 粉末洗剤は 0.9kg と 45回分 のうち g）
 * 2. 取れなければ、商品の主要な次元の既定単位（ml→100ml, g→100g 等。L→ml, kg→g は換算済み）
 * 3. それも無ければ、カテゴリが個数系の単位（1個・1本）を持つ場合のみ個数で比較
 * いずれも無ければ null（比較対象外）。
 */
export function chooseUnit(q: QuantityParseResult, category: Category): ComparisonUnit | null {
  const countLike = (u: ComparisonUnit) => u.dimension === 'pieces';
  for (const u of category.units.filter((u) => !countLike(u))) {
    if (selectAmount(q, u)) return u;
  }
  if (q.dimension) return DEFAULT_UNIT_BY_DIMENSION[q.dimension];
  for (const u of category.units.filter(countLike)) {
    if (selectAmount(q, u)) return u;
  }
  return null;
}

export function getUnit(category: Category, unitId?: string | null): ComparisonUnit {
  return category.units.find((u) => u.id === unitId) ?? category.units[0]!;
}

/** キーワードからカテゴリを推定（より長いキーワード一致を優先） */
export function guessCategory(keyword: string): Category {
  const k = keyword.normalize('NFKC').toLowerCase();
  let best: { cat: Category; len: number } | null = null;
  for (const cat of CATEGORIES) {
    for (const w of cat.keywords) {
      if (k.includes(w.toLowerCase()) && (!best || w.length > best.len)) {
        best = { cat, len: w.length };
      }
    }
  }
  return best?.cat ?? getCategory(DEFAULT_CATEGORY_ID);
}

export interface SelectedAmount {
  /** 比較単位の次元での合計量 */
  total: number;
  confidence: Confidence;
  note: string | null;
}

/**
 * 解析結果から、比較単位に対応する合計量を選ぶ。
 * 対応する次元が無ければ null（＝このランキングでは比較不能）。
 */
export function selectAmount(
  q: QuantityParseResult,
  unit: ComparisonUnit,
): SelectedAmount | null {
  const direct = q.amounts[unit.dimension];
  if (direct) {
    let confidence = q.confidence;
    // 主要次元以外（例: 粉末洗剤の「約45回分」）を使う場合
    if (q.dimension !== unit.dimension && unit.dimension !== 'pieces' && confidence === 'confirmed') {
      confidence = direct.approx ? 'review' : confidence;
    }
    if (unit.dimension === 'pieces' && q.confidence === 'unknown' && q.totalPieces !== null) {
      confidence = 'review';
    }
    return { total: direct.total, confidence, note: null };
  }
  for (const alt of unit.aliasFrom ?? []) {
    const a = q.amounts[alt];
    if (a && (q.dimension === null || q.dimension === alt)) {
      return {
        total: a.total,
        confidence: q.confidence === 'unknown' ? 'unknown' : 'review',
        note: unit.aliasNote ?? null,
      };
    }
  }
  return null;
}

export function formatAmount(total: number, dimension: Dimension): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString('ja-JP') : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
  switch (dimension) {
    case 'volume':
      return total >= 1000 ? `${fmt(total / 1000)}L` : `${fmt(total)}ml`;
    case 'mass':
      return total >= 1000 ? `${fmt(total / 1000)}kg` : `${fmt(total)}g`;
    case 'length':
      return `${fmt(total)}m`;
    case 'uses':
      return `${fmt(total)}回`;
    case 'meals':
      return `${fmt(total)}食`;
    case 'sheets':
      return `${fmt(total)}枚`;
    case 'pairs':
      return `${fmt(total)}組`;
    case 'pieces':
      return `${fmt(total)}個`;
  }
}
