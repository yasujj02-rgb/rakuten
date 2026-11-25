/**
 * 検索条件の検証（Worker・フロントエンド共通）。
 */
import type { ApiSort, SearchQuery } from './types';

export const API_SORTS: ApiSort[] = ['standard', '+itemPrice', '-itemPrice', '-reviewAverage', '-reviewCount'];
export const MAX_PAGES = 3;
export const HITS_PER_PAGE = 30;
const MAX_PRICE = 999_999_999;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

function cleanText(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  // 制御文字除去・空白正規化
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function optInt(v: unknown, min: number, max: number, label: string): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ValidationError(`${label}は${min}〜${max}の整数で指定してください`);
  }
  return n;
}

function bool(v: unknown): boolean | undefined {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return undefined;
}

/** 楽天 API のキーワード条件: 半角のみの場合は 2 文字以上 */
function keywordLongEnough(k: string): boolean {
  const compact = k.replace(/\s/g, '');
  if (compact.length === 0) return false;
  // eslint-disable-next-line no-control-regex
  const asciiOnly = /^[\u0000-\u007f]+$/.test(compact);
  return asciiOnly ? compact.length >= 2 : compact.length >= 1;
}

export function validateSearchQuery(input: Record<string, unknown>): SearchQuery {
  const keyword = cleanText(input.keyword, 100);
  if (!keywordLongEnough(keyword)) {
    throw new ValidationError('キーワードを入力してください（半角英数字のみの場合は2文字以上）');
  }
  const q: SearchQuery = { keyword };
  const ng = cleanText(input.ngKeyword, 100);
  if (ng) q.ngKeyword = ng;
  const minPrice = optInt(input.minPrice, 0, MAX_PRICE, '最低価格');
  const maxPrice = optInt(input.maxPrice, 0, MAX_PRICE, '最高価格');
  if (minPrice !== undefined) q.minPrice = minPrice;
  if (maxPrice !== undefined) q.maxPrice = maxPrice;
  if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
    throw new ValidationError('最低価格は最高価格以下にしてください');
  }
  if (bool(input.freeShippingOnly)) q.freeShippingOnly = true;
  const stock = bool(input.inStockOnly);
  q.inStockOnly = stock ?? true;
  const shop = cleanText(input.shopCode, 64);
  if (shop) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(shop)) throw new ValidationError('店舗コードの形式が正しくありません');
    q.shopCode = shop;
  }
  const minPointRate = optInt(input.minPointRate, 2, 10, '最低ポイント倍率');
  if (minPointRate !== undefined) q.minPointRate = minPointRate;
  q.pages = optInt(input.pages, 1, MAX_PAGES, '取得ページ数') ?? 1;
  const sort = typeof input.apiSort === 'string' ? input.apiSort : 'standard';
  if (!API_SORTS.includes(sort as ApiSort)) throw new ValidationError('並び順の指定が正しくありません');
  q.apiSort = sort as ApiSort;
  return q;
}

/** キャッシュ・重複排除用の正規化キー */
export function queryKey(q: SearchQuery): string {
  return JSON.stringify([
    q.keyword.normalize('NFKC').toLowerCase(),
    q.ngKeyword?.normalize('NFKC').toLowerCase() ?? '',
    q.minPrice ?? '',
    q.maxPrice ?? '',
    q.freeShippingOnly ? 1 : 0,
    q.inStockOnly === false ? 0 : 1,
    q.shopCode ?? '',
    q.minPointRate ?? '',
    q.pages ?? 1,
    q.apiSort ?? 'standard',
  ]);
}

export function queryToParams(q: SearchQuery): URLSearchParams {
  const p = new URLSearchParams();
  p.set('keyword', q.keyword);
  if (q.ngKeyword) p.set('ngKeyword', q.ngKeyword);
  if (q.minPrice !== undefined) p.set('minPrice', String(q.minPrice));
  if (q.maxPrice !== undefined) p.set('maxPrice', String(q.maxPrice));
  if (q.freeShippingOnly) p.set('freeShippingOnly', '1');
  p.set('inStockOnly', q.inStockOnly === false ? '0' : '1');
  if (q.shopCode) p.set('shopCode', q.shopCode);
  if (q.minPointRate !== undefined) p.set('minPointRate', String(q.minPointRate));
  if (q.pages && q.pages > 1) p.set('pages', String(q.pages));
  if (q.apiSort && q.apiSort !== 'standard') p.set('apiSort', q.apiSort);
  return p;
}
