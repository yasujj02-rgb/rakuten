import { expect, test, type Page } from '@playwright/test';

const yenToNumber = (s: string) => Number(s.replace(/[^\d.]/g, ''));

async function search(page: Page, keyword: string) {
  await page.getByLabel('検索キーワード').fill(keyword);
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/search')),
    page.getByRole('button', { name: '検索', exact: true }).click(),
  ]);
  await expect(page.getByTestId('summary')).toBeVisible();
}

/** アプリの連続検索抑制（1秒）を超えて待つ */
const pause = (page: Page) => page.waitForTimeout(1100);

/** メインランキング（最初の一覧）の実質単価 */
async function mainUnitPrices(page: Page): Promise<number[]> {
  const list = page.locator('.unit-group > .cards, .unit-group > .table-wrap').first();
  await expect(list.getByTestId('unit-price').first()).toBeVisible();
  const texts = await list.getByTestId('unit-price').allTextContents();
  return texts.map(yenToNumber);
}

async function expectNoHorizontalScroll(page: Page) {
  const [sw, iw] = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  expect(sw).toBeLessThanOrEqual(iw);
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test('トップ画面: ロゴ・モック表示・お気に入り初期候補・カテゴリ', async ({ page }) => {
  await expect(page.getByRole('link', { name: /実質最安値 Watch/ })).toBeVisible();
  await expect(page.getByTestId('mode-banner')).toContainText('モックモード');
  await expect(page.getByRole('button', { name: '★ ソフラン プレミアム消臭 ウルトラゼロ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'カテゴリから探す' })).toBeVisible();
  await expect(page.getByText('基本 9倍（通常1倍を含む）')).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test('検索: 実質単価の安い順に並び、モック商品は購入リンクを持たない', async ({ page }) => {
  await search(page, '柔軟剤');
  await expect(page.getByTestId('summary')).toContainText('楽天市場全体の最安値ではありません');
  const prices = await mainUnitPrices(page);
  expect(prices.length).toBeGreaterThan(1);
  expect(prices).toEqual([...prices].sort((a, b) => a - b));
  await expect(page.locator('a.btn.buy')).toHaveCount(0);
  await expect(page.getByText('リンクなし（サンプル）').first()).toBeVisible();
  // 全商品名がサンプル表記
  const names = await page.locator('[data-testid=result-row] .name').allTextContents();
  for (const n of names) expect(n).toContain('【サンプル】');
  await expectNoHorizontalScroll(page);
});

test('並べ替え: 支払額順・内容量順', async ({ page }) => {
  await search(page, 'トイレットペーパー');
  await page.getByLabel('並び替え').selectOption('payment');
  const list = page.locator('.unit-group > .cards, .unit-group > .table-wrap').first();
  await expect(list.getByTestId('result-row')).not.toHaveCount(0);
  await page.getByLabel('並び替え').selectOption('quantity');
  await expect(list.getByTestId('result-row').first()).toContainText('12ロール×8パック');
});

test('比較単位は自動で選ばれ、単位の違う商品は別ランキング', async ({ page }) => {
  await expect(page.getByLabel('比較単位')).toHaveCount(0); // メインフォームに単位の選択欄はない
  await search(page, 'ソフラン');
  await expect(page.getByTestId('primary-unit')).toContainText('100mlあたりで比較');
  await pause(page);
  await search(page, 'トイレットペーパー');
  await expect(page.getByTestId('primary-unit')).toContainText('1mあたりで比較');
  await pause(page);
  // アタックZERO は液体でも g 表記のため 100g あたりが自動で選ばれる
  await search(page, 'アタックZERO 洗剤');
  await expect(page.getByTestId('primary-unit')).toContainText('100gあたり');
});

test('詳細条件で比較単位を固定できる', async ({ page }) => {
  await page.getByRole('button', { name: '詳細条件' }).click();
  await page.getByLabel('比較単位').selectOption('piece1');
  await search(page, 'トイレットペーパー');
  await expect(page.getByTestId('primary-unit')).toContainText('1個あたりで比較');
});

test('送料不明・判定不能は別枠で表示', async ({ page }) => {
  await search(page, '柔軟剤');
  await expect(page.getByText('送料不明の商品')).toBeVisible();
  await expect(page.getByText('比較対象外（内容量を判定できない商品）')).toBeVisible();
});

test('設定変更でAPIを再取得せずに即時再計算される', async ({ page }) => {
  let apiCalls = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/search')) apiCalls++;
  });
  await search(page, '柔軟剤');
  const before = await mainUnitPrices(page);
  expect(apiCalls).toBe(1);
  await page.getByRole('link', { name: '設定', exact: true }).click();
  await page.getByLabel('基本ポイント倍率').fill('15');
  await page.getByRole('link', { name: '検索', exact: true }).click();
  const after = await mainUnitPrices(page);
  expect(after[0]!).toBeLessThan(before[0]!);
  expect(apiCalls).toBe(1);
  // 再訪問時も設定が残る
  await page.reload();
  await page.getByRole('link', { name: '設定', exact: true }).click();
  await expect(page.getByLabel('基本ポイント倍率')).toHaveValue('15');
});

test('ポイント内訳と手動補正で判定不能商品をランキングに入れる', async ({ page }) => {
  await search(page, '選べる容量');
  await expect(page.getByText('比較対象外（内容量を判定できない商品）')).toBeVisible();
  await page.getByText('比較対象外（内容量を判定できない商品）').click();
  await page.getByRole('button', { name: /内訳/ }).first().click();
  await expect(page.getByText('通常購入ポイント（1倍）')).toBeVisible();
  await page.getByLabel('内容量・個数を修正する').check();
  await page.getByLabel('1個あたりの量').fill('400');
  await page.getByLabel('セット個数').fill('1');
  await page.getByRole('button', { name: '補正を保存' }).click();
  await expect(page.getByTestId('primary-unit')).toContainText('100mlあたりで比較');
  const prices = await mainUnitPrices(page);
  expect(prices).toHaveLength(1);
  expect(prices[0]).toBeGreaterThan(0);
});

test('スーパーDEALの重複計上防止が内訳に表示される', async ({ page }) => {
  await search(page, 'キュキュット 超特大');
  await page.getByRole('button', { name: /内訳/ }).first().click();
  await page.getByLabel(/スーパーDEAL（%）/).fill('20');
  await page.getByRole('button', { name: '補正を保存' }).click();
  await expect(page.getByText('スーパーDEAL 20%（通常1%分を除く）')).toBeVisible();
  await expect(page.getByText(/× 19% =/)).toBeVisible();
  await expect(page.locator('.point-lines li', { hasText: '通常購入ポイント' })).toHaveCount(1);
});

test('お気に入り: 検索条件の登録・目標単価・一括再検索', async ({ page }) => {
  await search(page, '天然水');
  await page.getByRole('button', { name: '☆ この検索条件を登録' }).click();
  await expect(page.getByRole('button', { name: '★ 登録済みの検索条件' })).toBeVisible();
  await page.getByRole('link', { name: 'お気に入り', exact: true }).click();
  const item = page.getByTestId('favorite-item').filter({ hasText: '天然水' });
  await item.getByRole('button', { name: '編集' }).click();
  await item.getByLabel('目標単価').fill('999');
  // 他の初期候補は削除して一括再検索を短くする
  for (const name of ['ソフラン プレミアム消臭 ウルトラゼロ', 'キュキュット', 'アタックZERO', 'トイレットペーパー', 'ティッシュペーパー', '災害用携帯トイレ', '長期保存食']) {
    await page.getByRole('button', { name: `${name}を削除` }).click();
  }
  await page.getByRole('button', { name: '一括再検索' }).click();
  await expect(item).toContainText('最安', { timeout: 15_000 });
  await expect(item).toContainText('目標達成');
});

test('商品をお気に入り登録できる', async ({ page }) => {
  await search(page, '柔軟剤');
  await page.getByRole('button', { name: 'お気に入り' }).first().click();
  await expect(page.getByRole('button', { name: 'お気に入り', pressed: true })).toHaveCount(1);
  await page.getByRole('link', { name: 'お気に入り', exact: true }).click();
  await expect(page.getByTestId('favorite-item').filter({ hasText: '商品' }).first()).toBeVisible();
});

test('APIエラー時も画面が停止しない', async ({ page }) => {
  await page.route('**/api/search**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: { code: 'upstream_unavailable', message: '楽天APIが一時的に利用できません', retryable: true } }),
    }),
  );
  await page.getByLabel('検索キーワード').fill('柔軟剤');
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('楽天APIが一時的に利用できません');
  // 画面操作は継続可能
  await page.getByRole('link', { name: '設定', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ポイント設定' })).toBeVisible();
});

test('不正な入力は検索前に検証', async ({ page }) => {
  await page.getByLabel('検索キーワード').fill('a');
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('2文字以上');
});

test('最近の検索に履歴が残る', async ({ page }) => {
  await search(page, '保存食');
  await page.reload();
  await expect(page.getByRole('heading', { name: '最近の検索' })).toBeVisible();
  await expect(page.locator('.chip', { hasText: '保存食' }).first()).toBeVisible();
});

test('全画面で横スクロールが発生しない', async ({ page }) => {
  await search(page, 'ティッシュ');
  await page.getByRole('button', { name: /内訳/ }).first().click();
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: 'お気に入り', exact: true }).click();
  await expectNoHorizontalScroll(page);
  await page.getByRole('link', { name: '設定', exact: true }).click();
  await expectNoHorizontalScroll(page);
});

test('セキュリティヘッダーとAPIの秘密情報非露出', async ({ page, request }) => {
  const res = await request.get('/');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
  expect(res.headers()['x-frame-options']).toBe('DENY');
  const cfg = await (await request.get('/api/config')).json();
  expect(Object.keys(cfg).sort()).toEqual(['affiliateEnabled', 'development', 'maxPages', 'mode']);
  await page.goto('/');
});
