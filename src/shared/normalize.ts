/**
 * 商品名・商品説明の表記揺れを正規化する。
 * - 全角→半角（NFKC）、英字の小文字化
 * - 単位の日本語表記（リットル等）を記号に統一
 * - 掛け算記号（x, X, *, ✕, ✖）を × に統一（数量の文脈でのみ）
 * - 桁区切りカンマの除去
 * - 「詰め替え」等の表記揺れ統一
 */

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/ミリリットル/g, 'ml'],
  [/リットル|ℓ/g, 'l'],
  [/キログラム|キロ(?=グラム|\s|$|[×\d])/g, 'kg'],
  [/グラム/g, 'g'],
  [/メートル/g, 'm'],
  [/(\d)\s*cc(?![a-z])/g, '$1ml'],
];

const REFILL_WORDS = /詰め替え用?|詰替え?用?|詰め替用?|つめかえ用?|ツメカエ用?|リフィル|refill/g;

/** 数量・単位の直後に続く掛け算記号として扱う文字列 */
const MULTIPLIER_CONTEXT =
  /(?<=\d\s?(?:ml|l|kg|g|m|本|袋|個|缶|箱|ロール|パック|枚|組|食|回分|回|p|pcs)?(?:入り|入|セット)?)\s*[x*✕✖]\s*(?=\d)/g;

export function normalizeText(input: string | null | undefined): string {
  if (!input) return '';
  let s = input.normalize('NFKC').toLowerCase();
  // 制御文字を除去
  // eslint-disable-next-line no-control-regex
  s = s.replace(/[\u0000-\u001f\u007f]/g, ' ');
  // 桁区切りカンマ（1,200 → 1200）。小数点のカンマは日本語商品名では稀なため考慮しない
  s = s.replace(/(\d),(?=\d{3}(?!\d))/g, '$1');
  for (const [re, rep] of UNIT_WORDS) s = s.replace(re, rep);
  s = s.replace(MULTIPLIER_CONTEXT, '×');
  s = s.replace(/\s*×\s*/g, '×');
  s = s.replace(REFILL_WORDS, '詰め替え');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}
