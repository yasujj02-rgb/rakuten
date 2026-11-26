/**
 * デモ版（`vite build --mode demo`）専用: サーバーを使わずブラウザ内でモックデータを検索する。
 * 通常ビルドでは import されない。実データは一切含まない。
 */
import type { SearchQuery, SearchResponse } from '../shared/types';
import { searchMock } from '../worker/rakuten/mock';

export async function demoSearch(query: SearchQuery): Promise<SearchResponse> {
  await new Promise((r) => setTimeout(r, 250));
  const now = new Date();
  return {
    mode: 'mock',
    query,
    ...searchMock(query, now),
    fetchedAt: now.toISOString(),
    cached: false,
    notices: ['デモ版: ブラウザ内のモックデータ（架空の商品）を表示しています。実際の楽天市場の商品・価格ではありません'],
  };
}
