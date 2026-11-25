/**
 * 商品名・商品説明から内容量・セット個数を抽出するルールベースのパーサー。
 * 生成AIは使用しない（正規表現＋辞書＋ルール）。
 *
 * 方針:
 * - 商品名を優先し、商品名で判定できない場合のみ () 内 → 商品説明の順でフォールバック（信頼度は「要確認」以下）
 * - 「ポイント10倍」「3000円以上」「1個あたり」「型番」などは数量として扱わない（マスク）
 * - 同じ次元で異なる容量が並ぶ場合（選べる容量・本体＋詰め替え等）は合計せず「判定不能」
 */
import { normalizeText } from '../normalize';
import type {
  Confidence,
  Dimension,
  DimensionAmount,
  PackageKind,
  QuantityParseResult,
} from '../types';

interface UnitDef {
  dimension: Dimension;
  factor: number;
}

const MEASURE_UNITS: Record<string, UnitDef> = {
  ml: { dimension: 'volume', factor: 1 },
  l: { dimension: 'volume', factor: 1000 },
  g: { dimension: 'mass', factor: 1 },
  kg: { dimension: 'mass', factor: 1000 },
  m: { dimension: 'length', factor: 1 },
  回分: { dimension: 'uses', factor: 1 },
  回: { dimension: 'uses', factor: 1 },
  食: { dimension: 'meals', factor: 1 },
  枚: { dimension: 'sheets', factor: 1 },
  組: { dimension: 'pairs', factor: 1 },
};

/** 1単位当たりの量として妥当な上限（これを超える値は型番等の誤認とみなす） */
const SANITY_MAX: Record<Dimension, number> = {
  volume: 200_000, // 200L
  mass: 100_000, // 100kg
  length: 10_000,
  uses: 10_000,
  meals: 1_000,
  sheets: 10_000,
  pairs: 10_000,
  pieces: 10_000,
};
const MAX_SET_COUNT = 1000;

const COUNTER_PATTERN =
  '袋|個|本|缶|箱|ケース|パック|セット|ロール|ボトル|パウチ|カートン|コ|pcs|p';
const MEASURE_PATTERN = 'ml|l|kg|g|m|回分|回|食|枚|組';

/** 数量ではない数値（マスク対象） */
const EXCLUDE_RES: RegExp[] = [
  // 「1個あたり」「100mlあたり」等の単価表記
  new RegExp(
    `\\d+(?:\\.\\d+)?\\s?(?:${MEASURE_PATTERN}|${COUNTER_PATTERN})?\\s?(?:あたり|当たり|当り)`,
    'g',
  ),
  // 第3類、No.5、ver2、ポイント10 等
  /(?:第|no\.?|#|ver\.?|ポイント|pt)\s?\d+(?:\.\d+)?/g,
  // 倍率・割合・金額・日付・寸法・型番的単位など
  /\d+(?:\.\d+)?\s?(?:倍|%|円|年|ヶ月|か月|カ月|ヵ月|月|日|時間|時|位|号|型|段|cm|mm|km|歳|才|代|kcal|mg|mah|gb|tb|w|v|℃|度|色|種類|種|インチ|枚目|個目|本目|人前|人分|錠|粒|カプセル|店舗|ショップ|倍巻き?)(?![a-z])/g,
];

const TOKEN_RE = new RegExp(
  `(計|合計|総量|総|約)?\\s?(×)?(?<![a-z0-9.\\-_])(\\d+(?:\\.\\d+)?)\\s?(${MEASURE_PATTERN}|${COUNTER_PATTERN})?(?![a-z])(入り|入|セット)?`,
  'g',
);

const CHOICE_RE = /選べる|選択|よりどり|から選|いずれか|サイズ違い|容量違い|組み合わせ自由|お好きな/;
const BODY_RE = /本体(?!価格)|ボトル本体|容器付/;
const REFILL_RE = /詰め替え|付け替え|付替/;

const VARIANT_WORDS = [
  '無香料',
  '微香',
  'フローラル',
  'せっけん',
  '石けん',
  '石鹸',
  'ラベンダー',
  'シトラス',
  'グリーン',
  'ローズ',
  'ホワイト',
  'ピュア',
  'ダブル',
  'シングル',
  '濃縮',
  '超濃縮',
  '業務用',
  '部屋干し',
];

interface MeasureToken {
  dimension: Dimension;
  perUnit: number;
  approx: boolean;
  total: boolean;
  text: string;
}
interface CountToken {
  value: number;
  counter: string | null;
  text: string;
}

function mask(text: string): string {
  let s = text;
  for (const re of EXCLUDE_RES) {
    s = s.replace(re, (m) => ' '.repeat(m.length));
  }
  return s;
}

/** () 内を分離する（【】・[] は商品名の主要情報であることが多いため外側扱い） */
function splitParens(text: string): { outside: string; inside: string } {
  let depth = 0;
  let outside = '';
  let inside = '';
  for (const ch of text) {
    if (ch === '(') {
      depth++;
      outside += ' ';
      inside += ' ';
      continue;
    }
    if (ch === ')' && depth > 0) {
      depth--;
      outside += ' ';
      inside += ' ';
      continue;
    }
    if (depth > 0) {
      inside += ch;
      outside += ' ';
    } else {
      outside += ch;
    }
  }
  return { outside, inside };
}

function tokenize(text: string): {
  measures: MeasureToken[];
  counts: CountToken[];
  ignored: string[];
  suspicious: boolean;
} {
  const measures: MeasureToken[] = [];
  const counts: CountToken[] = [];
  const ignored: string[] = [];
  let suspicious = false;
  const masked = mask(text);
  for (const m of masked.matchAll(TOKEN_RE)) {
    const prefix = m[1];
    const hasTimes = Boolean(m[2]);
    const num = Number(m[3]);
    const unit = m[4];
    const raw = m[0].trim();
    if (!Number.isFinite(num) || num <= 0) continue;
    if (unit && unit in MEASURE_UNITS) {
      const def = MEASURE_UNITS[unit]!;
      const perUnit = num * def.factor;
      if (perUnit > SANITY_MAX[def.dimension]) {
        ignored.push(raw);
        suspicious = true;
        continue;
      }
      measures.push({
        dimension: def.dimension,
        perUnit: Math.round(perUnit * 1000) / 1000,
        approx: prefix === '約',
        total: prefix === '計' || prefix === '合計' || prefix === '総量' || prefix === '総',
        text: raw,
      });
    } else if (unit || hasTimes) {
      if (!Number.isInteger(num) || num > MAX_SET_COUNT) {
        ignored.push(raw);
        suspicious = true;
        continue;
      }
      if (prefix === '計' || prefix === '合計' || prefix === '総') {
        // 「計48本」は合計の表記であり掛け算しない
        ignored.push(raw);
        continue;
      }
      counts.push({ value: num, counter: unit ?? null, text: raw });
    }
    // 単位も×もない裸の数値は型番・年式等の可能性が高いため無視
  }
  return { measures, counts, ignored, suspicious };
}

/** 同じ個数の重複表記（「6袋セット【6袋】」等）を除去 */
function dedupeCounts(counts: CountToken[]): CountToken[] {
  const result: CountToken[] = [];
  for (const c of counts) {
    const dup = result.find(
      (r) =>
        r.value === c.value &&
        (r.counter === c.counter || r.counter === null || c.counter === null),
    );
    if (!dup) result.push(c);
  }
  return result;
}

const DIMENSION_PRIORITY: Dimension[] = [
  'volume',
  'mass',
  'length',
  'pairs',
  'sheets',
  'uses',
  'meals',
];

interface Combined {
  amounts: Partial<Record<Dimension, DimensionAmount>>;
  ambiguous: Dimension[];
  reasons: string[];
  setCount: number;
  hasCounts: boolean;
  matched: string[];
}

function combine(measures: MeasureToken[], counts: CountToken[]): Combined {
  const reasons: string[] = [];
  const deduped = dedupeCounts(counts);
  const setCount = deduped.reduce((acc, c) => acc * c.value, 1);
  const amounts: Partial<Record<Dimension, DimensionAmount>> = {};
  const ambiguous: Dimension[] = [];

  const byDim = new Map<Dimension, MeasureToken[]>();
  for (const m of measures) {
    const list = byDim.get(m.dimension) ?? [];
    list.push(m);
    byDim.set(m.dimension, list);
  }

  for (const [dim, list] of byDim) {
    const regular = list.filter((m) => !m.total);
    const totals = list.filter((m) => m.total);
    const distinct = [...new Set(regular.map((m) => m.perUnit))].sort((a, b) => a - b);
    const approx = list.some((m) => m.approx);

    if (distinct.length === 0) {
      // 合計表記のみ（例: 6袋 計7.2L）
      const t = [...new Set(totals.map((m) => m.perUnit))];
      if (t.length === 1) {
        amounts[dim] = { perUnit: t[0]! / setCount, total: t[0]!, approx };
      } else {
        ambiguous.push(dim);
      }
      continue;
    }

    if (distinct.length === 1) {
      const perUnit = distinct[0]!;
      const total = perUnit * setCount;
      const totalConflict = totals.some((t) => Math.abs(t.perUnit - total) > 0.001);
      if (totalConflict) {
        ambiguous.push(dim);
        reasons.push('合計表記と個別容量×個数が一致しません');
        continue;
      }
      amounts[dim] = { perUnit, total, approx };
      continue;
    }

    // 2種類以上の値: 「500ml×24本 12L」のように大きい方が合計の場合のみ許容
    if (distinct.length === 2 && setCount > 1) {
      const [small, large] = distinct as [number, number];
      if (Math.abs(small * setCount - large) < 0.001) {
        amounts[dim] = { perUnit: small, total: large, approx };
        continue;
      }
    }
    ambiguous.push(dim);
  }

  return {
    amounts,
    ambiguous,
    reasons,
    setCount,
    hasCounts: deduped.length > 0,
    matched: [...measures.map((m) => m.text), ...deduped.map((c) => c.text)],
  };
}

function extractVariant(text: string): string | null {
  const found: string[] = [];
  const kaori = text.match(/([^\s【】()[\]・/、,]{1,12}の香り)/);
  if (kaori?.[1]) found.push(kaori[1]);
  for (const w of VARIANT_WORDS) {
    if (text.includes(w) && !found.some((f) => f.includes(w))) found.push(w);
  }
  return found.length > 0 ? found.join('・') : null;
}

function detectPackageKind(text: string): PackageKind {
  const body = BODY_RE.test(text);
  const refill = REFILL_RE.test(text);
  if (body && refill) return 'mixed';
  if (refill) return 'refill';
  if (body) return 'body';
  return 'unknown';
}

function emptyResult(
  packageKind: PackageKind,
  variant: string | null,
  reasons: string[],
): QuantityParseResult {
  return {
    amounts: {},
    unitAmount: null,
    dimension: null,
    setCount: null,
    totalAmount: null,
    totalPieces: null,
    packageKind,
    variant,
    confidence: 'unknown',
    reasons,
    source: 'none',
    matchedText: [],
  };
}

/**
 * 商品名（必須）と商品説明（任意）から数量を解析する。
 */
export function parseQuantity(
  itemName: string,
  itemCaption?: string | null,
): QuantityParseResult {
  const name = normalizeText(itemName);
  const packageKind = detectPackageKind(name);
  const variant = extractVariant(name);
  const isChoice = CHOICE_RE.test(name);
  const reasons: string[] = [];

  const { outside, inside } = splitParens(name);
  const out = tokenize(outside);
  let source: QuantityParseResult['source'] = 'name';
  let combined = combine(out.measures, out.counts);
  let fallbackUsed = false;

  if (out.measures.length === 0) {
    const ins = tokenize(inside);
    if (ins.measures.length > 0) {
      // () 内の容量のみ採用（() 内の個数は合計表記であることが多いため外側の個数を使う）
      combined = combine(ins.measures, out.counts);
      fallbackUsed = true;
      reasons.push('括弧内の表記から抽出');
    } else if (itemCaption) {
      const cap = tokenize(splitParens(normalizeText(itemCaption)).outside);
      if (cap.measures.length > 0) {
        const capCombined = combine(cap.measures, out.counts);
        const dims = Object.keys(capCombined.amounts);
        if (dims.length > 0 && capCombined.ambiguous.length === 0) {
          combined = capCombined;
          source = 'caption';
          fallbackUsed = true;
          reasons.push('商品名に容量がなく、商品説明から推定');
        } else {
          reasons.push('商品説明に複数の容量表記があり採用できません');
        }
      }
    }
  }

  if (combined.setCount > MAX_SET_COUNT) {
    return emptyResult(packageKind, variant, ['セット個数が異常値のため判定不能']);
  }

  reasons.push(...combined.reasons);
  if (out.ignored.length > 0) {
    reasons.push(`数量として扱わなかった表記: ${out.ignored.join(', ')}`);
  }

  // 主要次元の決定
  const primary = DIMENSION_PRIORITY.find((d) => combined.amounts[d] !== undefined) ?? null;
  const physicalAmbiguous = combined.ambiguous.filter((d) =>
    ['volume', 'mass', 'length'].includes(d),
  );

  const amounts = { ...combined.amounts };
  const hasAnyMeasure = primary !== null;
  const totalPieces = hasAnyMeasure || combined.hasCounts ? combined.setCount : null;
  if (totalPieces !== null) {
    amounts.pieces = { perUnit: 1, total: totalPieces, approx: false };
  }

  if (combined.ambiguous.length > 0) {
    reasons.push(
      isChoice
        ? '複数の容量・サイズから選択する商品のため、容量を特定できません'
        : '複数の異なる容量表記があり、合計できません',
    );
  }
  if (packageKind === 'mixed') {
    reasons.push('本体と詰め替えの混在セットのため、容量を単純合計していません');
  }

  let confidence: Confidence;
  if (physicalAmbiguous.length > 0) {
    // 物理量（ml/g/m）が曖昧な場合は全体を判定不能とし、誤った単価を出さない
    for (const d of physicalAmbiguous) delete amounts[d];
    return {
      ...emptyResult(packageKind, variant, reasons),
      amounts: totalPieces !== null ? { pieces: amounts.pieces! } : {},
      totalPieces,
      setCount: combined.hasCounts ? combined.setCount : null,
      source,
      matchedText: combined.matched,
    };
  }

  if (!primary) {
    if (combined.hasCounts) {
      reasons.push('容量表記が見つからないため、個数のみ抽出');
    } else {
      reasons.push('容量・個数の表記が見つかりません');
    }
    return {
      ...emptyResult(packageKind, variant, reasons),
      amounts,
      totalPieces,
      setCount: combined.hasCounts ? combined.setCount : null,
      confidence: combined.hasCounts ? 'review' : 'unknown',
      source: combined.hasCounts ? 'name' : 'none',
      matchedText: combined.matched,
    };
  }

  const p = amounts[primary]!;
  if (
    fallbackUsed ||
    out.suspicious ||
    packageKind === 'mixed' ||
    combined.ambiguous.length > 0 ||
    p.approx
  ) {
    confidence = 'review';
    if (p.approx) reasons.push('「約」付きの概数表記');
  } else {
    confidence = 'confirmed';
  }

  return {
    amounts,
    unitAmount: p.perUnit,
    dimension: primary,
    setCount: combined.setCount,
    totalAmount: p.total,
    totalPieces,
    packageKind,
    variant,
    confidence,
    reasons,
    source,
    matchedText: combined.matched,
  };
}
