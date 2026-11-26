import { useMemo, useState, type FormEvent } from 'react';
import { TIER_LABELS } from '../../shared/pricing/engine';
import type { ItemOverride, UserSettings } from '../../shared/pricing/settings';
import { ALL_UNITS, AUTO, CATEGORIES, resolveCategory } from '../../shared/quantity/categories';
import { rankByUnits, type RankedRow, type UnitRanking } from '../../shared/ranking';
import type { ApiSort, SearchQuery, SearchResponse, SortKey } from '../../shared/types';
import type { Favorite, HistoryEntry } from '../storage';
import { Results } from '../components/Results';
import { dateTime } from '../format';

export interface SearchState {
  query: SearchQuery;
  categoryId: string;
  unitId: string;
}

interface Props {
  state: SearchState;
  onStateChange: (s: SearchState) => void;
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
  onSearch: (s: SearchState) => void;
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
  overrides: Record<string, ItemOverride>;
  onOverride: (itemCode: string, o: ItemOverride | null) => void;
  history: HistoryEntry[];
  favorites: Favorite[];
  onToggleFavorite: (row: RankedRow, state: SearchState) => void;
  onSaveSearchFavorite: (state: SearchState) => void;
  affiliateEnabled: boolean;
  sortKey: SortKey;
  onSortKey: (k: SortKey) => void;
  showAdvanced: boolean;
  onShowAdvanced: (v: boolean) => void;
}

const SORT_OPTIONS: Array<[SortKey, string]> = [
  ['unitPrice', '実質単価が安い順'],
  ['netPrice', '実質総額が安い順'],
  ['payment', '支払額が安い順'],
  ['pointRate', 'ポイント還元率が高い順'],
  ['review', 'レビュー評価順'],
  ['quantity', '内容量が多い順'],
];

const API_SORT_LABEL: Record<ApiSort, string> = {
  standard: '楽天の標準（関連度）順',
  '+itemPrice': '価格が安い順',
  '-itemPrice': '価格が高い順',
  '-reviewAverage': 'レビュー評価順',
  '-reviewCount': 'レビュー件数順',
};

const QUICK_CATEGORIES = [
  ['ソフラン プレミアム消臭 ウルトラゼロ', 'liquid-detergent'],
  ['キュキュット', 'liquid-detergent'],
  ['アタックZERO', 'liquid-detergent'],
  ['トイレットペーパー', 'toilet-paper'],
  ['ティッシュペーパー', 'tissue'],
  ['携帯トイレ', 'portable-toilet'],
  ['保存食', 'emergency-food'],
] as const;

export function SearchView(p: Props) {
  const { state } = p;
  const [packageKind, setPackageKind] = useState<'all' | 'body' | 'refill'>('all');
  const [minAmount, setMinAmount] = useState('');
  const category = resolveCategory(state.categoryId, state.query.keyword);

  const setQuery = (patch: Partial<SearchQuery>) => p.onStateChange({ ...state, query: { ...state.query, ...patch } });

  const ranking = useMemo(() => {
    if (!p.response) return null;
    return rankByUnits({
      products: p.response.products,
      category,
      unitId: state.unitId,
      settings: p.settings,
      overrides: p.overrides,
      sortKey: p.sortKey,
      filters: { packageKind, minTotalAmount: Number(minAmount) > 0 ? Number(minAmount) : null },
    });
  }, [p.response, category, state.unitId, p.settings, p.overrides, p.sortKey, packageKind, minAmount]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    p.onSearch(state);
  };

  const favForQuery = p.favorites.find(
    (f) => f.kind === 'search' && f.query.keyword === state.query.keyword && f.categoryId === state.categoryId,
  );
  const target = favForQuery?.targetUnitPrice ?? null;

  const resultsProps = {
    mode: p.response?.mode ?? 'mock',
    affiliateEnabled: p.affiliateEnabled,
    overrides: p.overrides,
    onOverride: p.onOverride,
    isFavorite: (code: string) => p.favorites.some((f) => f.itemCode === code),
    onToggleFavorite: (row: RankedRow) => p.onToggleFavorite(row, state),
  } as const;

  /** 目標単価はお気に入りの単位と一致する（または自動）ランキングにのみ適用 */
  const targetFor = (g: UnitRanking, i: number) =>
    target !== null && (favForQuery?.unitId === g.unit.id || (favForQuery?.unitId === AUTO && i === 0)) ? target : null;

  return (
    <div className="view">
      <form className="search-form" onSubmit={submit} role="search">
        <div className="search-bar">
          <input
            type="search"
            name="keyword"
            placeholder="商品名・キーワード（例: 柔軟剤 詰め替え）"
            value={state.query.keyword}
            onChange={(e) => setQuery({ keyword: e.target.value })}
            aria-label="検索キーワード"
            maxLength={100}
            enterKeyHint="search"
          />
          <button type="submit" className="btn primary" disabled={p.loading}>
            {p.loading ? '検索中…' : '検索'}
          </button>
        </div>

        <div className="inline-fields">
          <span className="auto-note">
            比較単位: {state.unitId === AUTO ? '自動（検索結果の内容量から選択）' : ALL_UNITS.find((u) => u.id === state.unitId)?.label}
          </span>
          <button type="button" className="btn link" onClick={() => p.onShowAdvanced(!p.showAdvanced)} aria-expanded={p.showAdvanced}>
            {p.showAdvanced ? '詳細条件を閉じる' : '詳細条件'}
          </button>
        </div>

        {p.showAdvanced && (
          <fieldset className="advanced">
            <legend>詳細条件</legend>
            <div className="grid2">
              <label>
                比較単位
                <select value={state.unitId} onChange={(e) => p.onStateChange({ ...state, unitId: e.target.value })} aria-label="比較単位">
                  <option value={AUTO}>自動（おすすめ）</option>
                  {ALL_UNITS.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}に固定
                    </option>
                  ))}
                </select>
              </label>
              <label>
                カテゴリ（税率の判定用）
                <select value={state.categoryId} onChange={(e) => p.onStateChange({ ...state, categoryId: e.target.value })} aria-label="カテゴリ">
                  <option value={AUTO}>自動（{category.label}）</option>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              除外キーワード
              <input value={state.query.ngKeyword ?? ''} onChange={(e) => setQuery({ ngKeyword: e.target.value || undefined })} maxLength={100} />
            </label>
            <div className="grid2">
              <label>
                最低価格（円）
                <input
                  inputMode="numeric"
                  value={state.query.minPrice ?? ''}
                  onChange={(e) => setQuery({ minPrice: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
              <label>
                最高価格（円）
                <input
                  inputMode="numeric"
                  value={state.query.maxPrice ?? ''}
                  onChange={(e) => setQuery({ maxPrice: e.target.value === '' ? undefined : Number(e.target.value) })}
                />
              </label>
            </div>
            <div className="grid2">
              <label>
                店舗コード
                <input value={state.query.shopCode ?? ''} onChange={(e) => setQuery({ shopCode: e.target.value || undefined })} maxLength={64} />
              </label>
              <label>
                最低ポイント倍率（商品別）
                <select
                  value={state.query.minPointRate ?? ''}
                  onChange={(e) => setQuery({ minPointRate: e.target.value ? Number(e.target.value) : undefined })}
                >
                  <option value="">指定なし</option>
                  {[2, 3, 4, 5, 10].map((n) => (
                    <option key={n} value={n}>
                      {n}倍以上
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="grid2">
              <label>
                本体・詰め替え（表示の絞り込み）
                <select value={packageKind} onChange={(e) => setPackageKind(e.target.value as typeof packageKind)}>
                  <option value="all">すべて</option>
                  <option value="body">本体のみ</option>
                  <option value="refill">詰め替えのみ</option>
                </select>
              </label>
              <label>
                最低内容量（ml・g・m・枚など・表示の絞り込み）
                <input inputMode="decimal" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
              </label>
            </div>
            <div className="grid2">
              <label>
                取得件数（API）
                <select value={state.query.pages ?? 1} onChange={(e) => setQuery({ pages: Number(e.target.value) })}>
                  <option value={1}>30件（1ページ）</option>
                  <option value={2}>60件（2ページ）</option>
                  <option value={3}>90件（3ページ）</option>
                </select>
              </label>
              <label>
                API取得順
                <select value={state.query.apiSort ?? 'standard'} onChange={(e) => setQuery({ apiSort: e.target.value as ApiSort })}>
                  {Object.entries(API_SORT_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="check">
              <input type="checkbox" checked={Boolean(state.query.freeShippingOnly)} onChange={(e) => setQuery({ freeShippingOnly: e.target.checked || undefined })} />
              送料込み（送料無料）の商品のみ
            </label>
            <label className="check">
              <input type="checkbox" checked={state.query.inStockOnly !== false} onChange={(e) => setQuery({ inStockOnly: e.target.checked })} />
              在庫ありのみ
            </label>
          </fieldset>
        )}
      </form>

      {!p.response && !p.loading && (
        <div className="home-blocks">
          {p.history.length > 0 && (
            <section>
              <h3>最近の検索</h3>
              <div className="chips">
                {p.history.map((h) => (
                  <button
                    key={h.at + h.query.keyword}
                    type="button"
                    className="chip"
                    onClick={() => p.onSearch({ query: h.query, categoryId: h.categoryId, unitId: AUTO })}
                  >
                    {h.query.keyword}
                  </button>
                ))}
              </div>
            </section>
          )}
          {p.favorites.length > 0 && (
            <section>
              <h3>お気に入り</h3>
              <div className="chips">
                {p.favorites.slice(0, 12).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="chip fav"
                    onClick={() => p.onSearch({ query: f.query, categoryId: f.categoryId, unitId: f.unitId })}
                  >
                    ★ {f.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          <section>
            <h3>カテゴリから探す</h3>
            <div className="chips">
              {QUICK_CATEGORIES.map(([kw, cid]) => (
                <button
                  key={kw}
                  type="button"
                  className="chip"
                  onClick={() => p.onSearch({ query: { ...state.query, keyword: kw }, categoryId: cid, unitId: AUTO })}
                >
                  {kw}
                </button>
              ))}
            </div>
          </section>
          <section className="settings-summary">
            <h3>現在のポイント設定</h3>
            <p>
              基本 {p.settings.baseMultiplier}倍（通常1倍を含む）
              {p.settings.spuExtra > 0 && `＋SPU追加 ${p.settings.spuExtra}倍`}
              {p.settings.kaimawari.enabled && `＋買い回り ${p.settings.kaimawari.extraMultiplier}倍`}
              {p.settings.dayCampaign.enabled && `＋日付キャンペーン ${p.settings.dayCampaign.extraMultiplier}倍`}・1pt＝{p.settings.pointValueYen}円
            </p>
            <a href="#point-settings">ポイント設定を変更</a>
          </section>
        </div>
      )}

      {p.error && (
        <div className="alert error" role="alert">
          {p.error}
        </div>
      )}

      {p.response && ranking && (
        <section className="results" aria-live="polite">
          <div className="results-head">
            <div className="summary" data-testid="summary">
              <strong>{p.response.products.length}件</strong>を比較
              {p.response.mode === 'live'
                ? `（楽天市場の検索結果 全${p.response.totalCount.toLocaleString('ja-JP')}件のうち、${API_SORT_LABEL[p.response.query.apiSort ?? 'standard']}で上位${p.response.fetchedPages}ページ分）`
                : '（モックデータ）'}
              。楽天市場全体の最安値ではありません。取得 {dateTime(p.response.fetchedAt)}
              {p.response.cached && '（キャッシュ）'}
            </div>
            <div className="controls">
              <label>
                並び替え
                <select value={p.sortKey} onChange={(e) => p.onSortKey(e.target.value as SortKey)} aria-label="並び替え">
                  {SORT_OPTIONS.map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                価格区分
                <select
                  value={p.settings.rankingTier}
                  onChange={(e) => p.onSettingsChange({ ...p.settings, rankingTier: e.target.value as 'estimated' | 'reference' })}
                  aria-label="価格区分"
                >
                  <option value="estimated">{TIER_LABELS.estimated}</option>
                  <option value="reference">{TIER_LABELS.reference}</option>
                </select>
              </label>
              <button type="button" className="btn" onClick={() => p.onSaveSearchFavorite(state)}>
                {favForQuery ? '★ 登録済みの検索条件' : '☆ この検索条件を登録'}
              </button>
            </div>
          </div>
          {p.response.notices.map((n) => (
            <div key={n} className={`alert ${p.response!.mode === 'mock' ? 'mock' : 'info'}`}>
              {n}
            </div>
          ))}
          {ranking.filteredOut > 0 && <p className="hint">表示条件により {ranking.filteredOut}件を非表示にしています。</p>}

          {ranking.groups.length === 0 && ranking.unrankable.length === 0 && <p className="empty">該当する商品がありません。</p>}

          {ranking.groups.map((g, i) => {
            const count = g.main.length + g.shippingUnknown.length;
            const t = targetFor(g, i);
            const body = (
              <>
                {t !== null && <p className="hint">目標単価 {t}円（{g.unit.label}）以下の商品を強調表示しています。</p>}
                {g.main.length > 0 && <Results rows={g.main} group="main" unit={g.unit} targetUnitPrice={t} {...resultsProps} />}
                {g.shippingUnknown.length > 0 && (
                  <details className="group" open={g.main.length === 0}>
                    <summary>
                      送料不明の商品 <span className="count">{g.shippingUnknown.length}件</span>
                      <small>送料別で金額を取得できないため、送料を含まない参考値で並べています</small>
                    </summary>
                    <Results rows={g.shippingUnknown} group="shippingUnknown" unit={g.unit} targetUnitPrice={t} {...resultsProps} />
                  </details>
                )}
              </>
            );
            if (i === 0) {
              return (
                <div key={g.unit.id} className="unit-group">
                  <h3 className="group-title" data-testid="primary-unit">
                    {g.unit.label}で比較（{TIER_LABELS[p.settings.rankingTier]}）<span className="count">{count}件</span>
                  </h3>
                  {ranking.auto && ranking.groups.length > 1 && (
                    <p className="hint">比較単位は件数の最も多い「{g.unit.label}」を自動で選びました。別の単位の商品は下に分けて表示しています。</p>
                  )}
                  {body}
                </div>
              );
            }
            return (
              <details key={g.unit.id} className="group unit-group">
                <summary>
                  {g.unit.label}で比較できる商品 <span className="count">{count}件</span>
                  <small>単位が異なる（例: ml と g）ため、上のランキングとは混ぜずに比較しています</small>
                </summary>
                {body}
              </details>
            );
          })}

          {ranking.unrankable.length > 0 && (
            <details className="group">
              <summary>
                比較対象外（内容量を判定できない商品） <span className="count">{ranking.unrankable.length}件</span>
                <small>「内訳・補正」から内容量を手動で修正するとランキングに入ります</small>
              </summary>
              <Results rows={ranking.unrankable} group="unrankable" unit={ranking.groups[0]?.unit ?? category.units[0]!} {...resultsProps} />
            </details>
          )}
        </section>
      )}
    </div>
  );
}
