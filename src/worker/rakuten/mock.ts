/**
 * モックデータ（架空の商品）。
 * 実在の商品と誤認されないよう、全商品名に【サンプル】を付け、商品URL・画像URLは持たない。
 * 容量解析・送料不明・ポイント期間・税別価格などのテスト用パターンを含む。
 */
import type { Product, SearchQuery } from '../../shared/types';
import { HITS_PER_PAGE } from '../../shared/validation';
import { normalizeText } from '../../shared/normalize';

interface MockSeed {
  id: string;
  name: string;
  tags: string;
  price: number;
  shop: string;
  postage: 0 | 1;
  pointRate?: number;
  /** 現在時刻からの相対日数で期間を指定 */
  pointDays?: [number, number];
  tax?: 0 | 1;
  available?: 0 | 1;
  review?: [number, number];
  caption?: string;
}

const SEEDS: MockSeed[] = [
  // 柔軟剤（ソフラン系の架空品）
  { id: 'sf01', name: 'ソフラン プレミアム消臭 ウルトラゼロ 詰め替え 1200ml×6袋', tags: '柔軟剤', price: 3980, shop: 'サンプル日用品店', postage: 0, pointRate: 5, pointDays: [-2, 5], review: [4.6, 812] },
  { id: 'sf02', name: 'ソフラン プレミアム消臭 ウルトラゼロ 詰替え 1,200mL 3個セット', tags: '柔軟剤', price: 2180, shop: 'サンプルドラッグ', postage: 1, review: [4.5, 120] },
  { id: 'sf03', name: '【ポイント10倍】ソフラン プレミアム消臭 ウルトラゼロ フローラルアロマの香り 詰め替え 1.2L 6袋入り', tags: '柔軟剤', price: 4280, shop: 'サンプル生活館', postage: 0, pointRate: 10, pointDays: [-1, 3], review: [4.7, 45] },
  { id: 'sf04', name: 'ソフラン プレミアム消臭 ウルトラゼロ 本体 510ml', tags: '柔軟剤', price: 398, shop: 'サンプルドラッグ', postage: 1, review: [4.2, 30] },
  { id: 'sf05', name: '【選べる容量】ソフラン プレミアム消臭 ウルトラゼロ 400ml / 1200ml / 2000ml', tags: '柔軟剤', price: 498, shop: 'サンプル日用品店', postage: 0, review: [4.0, 8] },
  { id: 'sf06', name: 'ソフラン プレミアム消臭 ウルトラゼロ 本体 510ml＋詰め替え 1200ml×2 セット', tags: '柔軟剤', price: 1580, shop: 'サンプル生活館', postage: 0 },
  { id: 'sf07', name: '送料無料3,000円以上 ソフラン プレミアム消臭 ウルトラゼロ 特大 詰め替え 2000ml×4袋', tags: '柔軟剤', price: 4980, shop: 'サンプルホームセンター', postage: 1, pointRate: 3, pointDays: [3, 10], review: [4.4, 210] },
  { id: 'sf08', name: 'ソフラン ウルトラゼロ 詰め替え 6袋セット', tags: '柔軟剤', price: 3880, shop: 'サンプルドラッグ', postage: 0, caption: '内容量：1袋あたり1200ml。お一人様5点まで。' },
  // 食器用洗剤（キュキュット系の架空品）
  { id: 'kk01', name: 'キュキュット 食器用洗剤 詰め替え用 超特大 1250ml×4個', tags: '食器用洗剤', price: 2280, shop: 'サンプルドラッグ', postage: 0, pointRate: 2, review: [4.6, 1530] },
  { id: 'kk02', name: 'キュキュット クリア除菌 つめかえ用 700ml×6個セット', tags: '食器用洗剤', price: 1980, shop: 'サンプル日用品店', postage: 1, review: [4.5, 300] },
  { id: 'kk03', name: 'キュキュット 本体 240ml', tags: '食器用洗剤', price: 238, shop: 'サンプル生活館', postage: 1, tax: 1, review: [4.3, 15] },
  // 洗濯洗剤（アタックZERO系の架空品）
  { id: 'at01', name: 'アタックZERO 洗濯洗剤 詰め替え 1620g ×6個 ケース販売', tags: '液体洗剤', price: 5980, shop: 'サンプルドラッグ', postage: 0, pointRate: 4, pointDays: [-5, 2], review: [4.7, 2200] },
  { id: 'at02', name: 'アタックZERO ドラム式専用 詰替用 超特大 1,620g 2個セット 【P10倍】', tags: '液体洗剤', price: 2180, shop: 'サンプル生活館', postage: 1, pointRate: 10, pointDays: [-30, -1], review: [4.5, 80] },
  { id: 'at03', name: 'アタックZERO パーフェクトスティック 76本入×3個', tags: '液体洗剤', price: 4280, shop: 'サンプル日用品店', postage: 0, review: [4.4, 56] },
  { id: 'pw01', name: 'サンプル粉末洗剤 0.9kg 約45回分 ×3個', tags: '粉末洗剤', price: 1180, shop: 'サンプルホームセンター', postage: 0, review: [4.1, 22] },
  // トイレットペーパー
  { id: 'tp01', name: 'トイレットペーパー ダブル 114mm×30m 12ロール×8パック 業務用', tags: 'トイレットペーパー', price: 4980, shop: 'サンプル紙問屋', postage: 0, review: [4.3, 410] },
  { id: 'tp02', name: 'トイレットペーパー シングル 1.5倍巻き 75m×8ロール', tags: 'トイレットペーパー', price: 698, shop: 'サンプルホームセンター', postage: 1, review: [4.2, 95] },
  { id: 'tp03', name: 'トイレットペーパー 2倍巻 ダブル 50m×12ロール×4パック', tags: 'トイレットペーパー', price: 3480, shop: 'サンプル紙問屋', postage: 0, pointRate: 5, pointDays: [-1, 1], review: [4.5, 180] },
  { id: 'tp04', name: 'トイレットペーパー まとめ買い 96ロール', tags: 'トイレットペーパー', price: 5280, shop: 'サンプル生活館', postage: 0 },
  // ティッシュ
  { id: 'ts01', name: 'ティッシュペーパー 150組(300枚)×5箱×12パック', tags: 'ティッシュ', price: 4380, shop: 'サンプル紙問屋', postage: 0, review: [4.4, 620] },
  { id: 'ts02', name: 'ボックスティッシュ 200組 5P', tags: 'ティッシュ', price: 498, shop: 'サンプルドラッグ', postage: 1, review: [4.1, 40] },
  { id: 'ts03', name: 'ティッシュ 保湿 ソフトパック 160組×20個', tags: 'ティッシュ', price: 2480, shop: 'サンプル日用品店', postage: 0, pointRate: 3 },
  // 携帯トイレ
  { id: 'pt01', name: '災害用 携帯トイレ 100回分 15年保存', tags: '携帯トイレ 簡易トイレ', price: 7980, shop: 'サンプル防災館', postage: 0, review: [4.6, 330] },
  { id: 'pt02', name: '簡易トイレ 非常用 50回分×2箱', tags: '携帯トイレ 簡易トイレ', price: 6480, shop: 'サンプル防災館', postage: 1 },
  { id: 'pt03', name: '携帯トイレ 凝固剤 30個入', tags: '携帯トイレ 簡易トイレ', price: 2980, shop: 'サンプルホームセンター', postage: 0, review: [4.0, 12] },
  // 保存食
  { id: 'ef01', name: '長期保存食 アルファ米 24食セット 5年保存', tags: '保存食 非常食', price: 8640, shop: 'サンプル防災館', postage: 0, review: [4.5, 140] },
  { id: 'ef02', name: '非常食 パン缶 5年保存 24缶', tags: '保存食 非常食', price: 9800, shop: 'サンプル防災館', postage: 1, tax: 0 },
  { id: 'ef03', name: '保存食 3日分 9食セット 2026年製造', tags: '保存食 非常食', price: 4980, shop: 'サンプル食品', postage: 0, pointRate: 2 },
  // 飲料
  { id: 'bv01', name: '天然水 500ml×24本×2ケース', tags: '水 飲料', price: 3480, shop: 'サンプル食品', postage: 0, review: [4.6, 3000] },
  { id: 'bv02', name: '天然水 2L×6本 計12L', tags: '水 飲料', price: 980, shop: 'サンプル食品', postage: 1, review: [4.5, 900] },
  { id: 'bv03', name: '緑茶 525ml 24本入', tags: 'お茶 飲料', price: 2380, shop: 'サンプル食品', postage: 0, available: 0 },
  // おむつ
  { id: 'dp01', name: '紙おむつ テープ Mサイズ 64枚×3パック', tags: 'おむつ', price: 4980, shop: 'サンプルベビー', postage: 0, review: [4.7, 520] },
  { id: 'dp02', name: 'おむつ パンツ Lサイズ 44枚', tags: 'おむつ', price: 1680, shop: 'サンプルドラッグ', postage: 1 },
  // その他（型番を含む）
  { id: 'ot01', name: '交換用フィルター 対応機種 SX-500 KX1200 2個入', tags: 'フィルター', price: 1980, shop: 'サンプル家電', postage: 0 },
];

function daysFromNow(now: Date, d: number): string {
  const t = new Date(now.getTime() + d * 86400_000 + 9 * 3600_000); // JST
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} ${d < 0 ? '10:00' : '09:59'}`;
}

export function mockProducts(now: Date): Array<Product & { _tags: string }> {
  const fetchedAt = now.toISOString();
  return SEEDS.map((s) => ({
    itemCode: `sample-shop:${s.id}`,
    itemName: `【サンプル】${s.name}`,
    catchcopy: null,
    itemCaption: s.caption ?? null,
    imageUrl: null,
    brand: null,
    shopName: s.shop,
    shopCode: 'sample-shop',
    itemPrice: s.price,
    taxIncluded: s.tax === 1 ? false : true,
    itemPriceMin: null,
    itemPriceMax: null,
    shipping: s.postage === 0 ? { kind: 'included' as const } : { kind: 'separate' as const, amount: null },
    pointRate: s.pointRate ?? 1,
    pointRateStartTime: s.pointDays ? daysFromNow(now, s.pointDays[0]) : null,
    pointRateEndTime: s.pointDays ? daysFromNow(now, s.pointDays[1]) : null,
    available: s.available === 0 ? false : true,
    reviewAverage: s.review?.[0] ?? null,
    reviewCount: s.review?.[1] ?? 0,
    itemUrl: null,
    affiliateUrl: null,
    genreId: null,
    fetchedAt,
    _tags: s.tags,
  }));
}

export function searchMock(q: SearchQuery, now: Date) {
  const tokens = normalizeText(q.keyword).split(' ').filter(Boolean);
  const ng = normalizeText(q.ngKeyword ?? '').split(' ').filter(Boolean);
  let items = mockProducts(now).filter((p) => {
    const hay = normalizeText(`${p.itemName} ${p._tags}`);
    if (!tokens.every((t) => hay.includes(t))) return false;
    if (ng.some((t) => hay.includes(t))) return false;
    if (q.minPrice !== undefined && p.itemPrice < q.minPrice) return false;
    if (q.maxPrice !== undefined && p.itemPrice > q.maxPrice) return false;
    if (q.freeShippingOnly && p.shipping.kind !== 'included') return false;
    if (q.inStockOnly !== false && p.available === false) return false;
    if (q.shopCode && p.shopCode !== q.shopCode) return false;
    if (q.minPointRate !== undefined && (p.pointRate ?? 1) < q.minPointRate) return false;
    return true;
  });
  if (q.apiSort === '+itemPrice') items = items.sort((a, b) => a.itemPrice - b.itemPrice);
  if (q.apiSort === '-itemPrice') items = items.sort((a, b) => b.itemPrice - a.itemPrice);
  if (q.apiSort === '-reviewAverage') items = items.sort((a, b) => (b.reviewAverage ?? 0) - (a.reviewAverage ?? 0));
  if (q.apiSort === '-reviewCount') items = items.sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
  const pages = q.pages ?? 1;
  const totalCount = items.length;
  const pageCount = Math.ceil(totalCount / HITS_PER_PAGE);
  const products: Product[] = items.slice(0, pages * HITS_PER_PAGE).map(({ _tags, ...p }) => p);
  return {
    products,
    totalCount,
    pageCount,
    fetchedPages: Math.max(1, Math.min(pages, pageCount)),
  };
}
