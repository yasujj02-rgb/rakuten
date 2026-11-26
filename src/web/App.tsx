import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ItemOverride, UserSettings } from '../shared/pricing/settings';
import { getCategory, getUnit } from '../shared/quantity/categories';
import { rankProducts, type RankedRow } from '../shared/ranking';
import type { SearchResponse, SortKey } from '../shared/types';
import { validateSearchQuery, ValidationError } from '../shared/validation';
import { ApiClientError, fetchConfig, searchApi, type AppConfig } from './api';
import * as store from './storage';
import type { Favorite } from './storage';
import { FavoritesView } from './views/FavoritesView';
import { SearchView, type SearchState } from './views/SearchView';
import { SettingsView } from './views/SettingsView';

type Route = 'search' | 'favorites' | 'settings';

function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}
/** ルートは単純なハッシュ（#search / #favorites / #point-settings）。旧形式 #/settings も受け付ける */
function getRoute(): Route {
  const h = window.location.hash.replace(/^#\/?/, '');
  if (h === 'favorites') return 'favorites';
  if (h === 'point-settings' || h === 'settings') return 'settings';
  return 'search';
}

const SEED_FAVORITES: Array<[string, string]> = [
  ['ソフラン プレミアム消臭 ウルトラゼロ', 'liquid-detergent'],
  ['キュキュット', 'liquid-detergent'],
  ['アタックZERO', 'liquid-detergent'],
  ['トイレットペーパー', 'toilet-paper'],
  ['ティッシュペーパー', 'tissue'],
  ['災害用携帯トイレ', 'portable-toilet'],
  ['長期保存食', 'emergency-food'],
];

function initialFavorites(): Favorite[] {
  const saved = store.loadFavorites();
  if (saved) return saved;
  const now = new Date().toISOString();
  const seeded = SEED_FAVORITES.map(([kw, cid], i) => {
    const c = getCategory(cid);
    return {
      id: `seed-${i}`,
      label: kw,
      kind: 'search' as const,
      query: { keyword: kw, inStockOnly: true, pages: 1, apiSort: 'standard' as const },
      categoryId: c.id,
      unitId: c.units[0]!.id,
      targetUnitPrice: null,
      createdAt: now,
    };
  });
  store.saveFavorites(seeded);
  return seeded;
}

const SORT_KEYS: SortKey[] = ['unitPrice', 'netPrice', 'payment', 'pointRate', 'review', 'quantity'];
const MIN_SEARCH_INTERVAL_MS = 1000;
const BULK_INTERVAL_MS = 1500;

export function App() {
  const route = useSyncExternalStore(subscribeHash, getRoute, () => 'search' as Route);
  const [settings, setSettingsState] = useState<UserSettings>(store.loadSettings);
  const [overrides, setOverrides] = useState<Record<string, ItemOverride>>(store.loadOverrides);
  const [history, setHistory] = useState(store.loadHistory);
  const [favorites, setFavoritesState] = useState<Favorite[]>(initialFavorites);
  const [token, setTokenState] = useState(store.loadToken);
  const [ui, setUi] = useState(store.loadUi);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [searchState, setSearchState] = useState<SearchState>({
    query: { keyword: '', inStockOnly: true, pages: 1, apiSort: 'standard' },
    categoryId: 'other',
    unitId: getCategory('other').units[0]!.id,
  });
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSearchAt = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const bulkCancel = useRef(false);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [route]);

  const sortKey: SortKey = SORT_KEYS.includes(ui.sortKey as SortKey) ? (ui.sortKey as SortKey) : 'unitPrice';

  useEffect(() => {
    let alive = true;
    fetchConfig(token)
      .then((c) => {
        if (!alive) return;
        setConfig(c);
        setConfigError(null);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setConfigError(e instanceof ApiClientError ? e.message : 'サーバー設定を取得できませんでした');
      });
    return () => {
      alive = false;
    };
  }, [token]);

  const setSettings = useCallback((s: UserSettings) => {
    setSettingsState(s);
    store.saveSettings(s);
  }, []);
  const setFavorites = useCallback((f: Favorite[]) => {
    setFavoritesState(f);
    store.saveFavorites(f);
  }, []);
  const setToken = (t: string) => {
    setTokenState(t);
    store.saveToken(t);
  };
  const updateUi = (patch: store.UiPrefs) => {
    const next = { ...ui, ...patch };
    setUi(next);
    store.saveUi(next);
  };

  const onOverride = (itemCode: string, o: ItemOverride | null) => {
    setOverrides((prev) => {
      const next = { ...prev };
      if (o) next[itemCode] = o;
      else delete next[itemCode];
      store.saveOverrides(next);
      return next;
    });
  };

  const runSearch = async (s: SearchState) => {
    if (loading) return;
    const since = Date.now() - lastSearchAt.current;
    if (since < MIN_SEARCH_INTERVAL_MS) {
      setError('連続検索を抑制しています。少し待ってから再度お試しください');
      return;
    }
    let query;
    try {
      query = validateSearchQuery(s.query as unknown as Record<string, unknown>);
    } catch (e) {
      setError(e instanceof ValidationError ? e.message : '検索条件が正しくありません');
      return;
    }
    lastSearchAt.current = Date.now();
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    const nextState = { ...s, query };
    setSearchState(nextState);
    setLoading(true);
    setError(null);
    if (getRoute() !== 'search') window.location.hash = '#search';
    try {
      const res = await searchApi(query, token, ac.signal);
      setResponse(res);
      setHistory((prev) => {
        const next = [
          { query, categoryId: s.categoryId, at: new Date().toISOString() },
          ...prev.filter((h) => h.query.keyword !== query.keyword),
        ].slice(0, 10);
        store.saveHistory(next);
        return next;
      });
    } catch (e) {
      if (e instanceof ApiClientError && e.code === 'aborted') return;
      setError(e instanceof ApiClientError ? e.message : '検索に失敗しました');
    } finally {
      setLoading(false);
    }
  };

  const toggleProductFavorite = (row: RankedRow, s: SearchState) => {
    const code = row.product.itemCode;
    if (favorites.some((f) => f.itemCode === code)) {
      setFavorites(favorites.filter((f) => f.itemCode !== code));
      return;
    }
    setFavorites([
      ...favorites,
      {
        id: crypto.randomUUID(),
        label: row.product.itemName.slice(0, 80),
        kind: 'product',
        query: s.query,
        categoryId: s.categoryId,
        unitId: s.unitId,
        targetUnitPrice: null,
        itemCode: code,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const saveSearchFavorite = (s: SearchState) => {
    const exists = favorites.find((f) => f.kind === 'search' && f.query.keyword === s.query.keyword && f.categoryId === s.categoryId);
    if (exists) {
      window.location.hash = '#favorites';
      return;
    }
    setFavorites([
      ...favorites,
      {
        id: crypto.randomUUID(),
        label: s.query.keyword,
        kind: 'search',
        query: s.query,
        categoryId: s.categoryId,
        unitId: s.unitId,
        targetUnitPrice: null,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const bulkCheck = async () => {
    if (bulk) return;
    bulkCancel.current = false;
    const list = [...favorites];
    const results = new Map<string, store.FavoriteCheck>();
    setBulk({ done: 0, total: list.length });
    for (let i = 0; i < list.length; i++) {
      if (bulkCancel.current) break;
      const f = list[i]!;
      const cat = getCategory(f.categoryId);
      const unit = getUnit(cat, f.unitId);
      try {
        const res = await searchApi(validateSearchQuery(f.query as unknown as Record<string, unknown>), token);
        const ranking = rankProducts({ products: res.products, category: cat, unit, settings, overrides, sortKey: 'unitPrice' });
        const best = f.kind === 'product' ? ranking.main.find((r) => r.product.itemCode === f.itemCode) : ranking.main[0];
        results.set(f.id, {
          at: res.fetchedAt,
          mode: res.mode,
          bestUnitPrice: best?.unitPrice ?? null,
          bestItemName: best?.product.itemName.slice(0, 60) ?? (f.kind === 'product' ? '（検索結果に見つかりません）' : null),
          comparedCount: ranking.main.length,
        });
      } catch (e) {
        results.set(f.id, {
          at: new Date().toISOString(),
          mode: config?.mode ?? 'mock',
          bestUnitPrice: null,
          bestItemName: null,
          comparedCount: 0,
          error: e instanceof ApiClientError ? e.message : '取得に失敗しました',
        });
      }
      setBulk({ done: i + 1, total: list.length });
      if (i < list.length - 1 && !bulkCancel.current) await new Promise((r) => setTimeout(r, BULK_INTERVAL_MS));
    }
    setFavoritesState((prev) => {
      const next = prev.map((f) => (results.has(f.id) ? { ...f, lastCheck: results.get(f.id) } : f));
      store.saveFavorites(next);
      return next;
    });
    setBulk(null);
  };

  const mode = response?.mode ?? config?.mode ?? null;

  return (
    <div className="app">
      <header className="site-header">
        <a href="#search" className="logo" aria-label="実質最安値 Watch トップ">
          <span className="logo-mark" aria-hidden="true">
            ¥
          </span>
          <span>
            <span className="logo-ja">実質最安値 Watch</span>
            <span className="logo-en">NetPrice Watch</span>
          </span>
        </a>
        <nav className="tabs" aria-label="メイン">
          <a href="#search" aria-current={route === 'search' ? 'page' : undefined}>
            検索
          </a>
          <a href="#favorites" aria-current={route === 'favorites' ? 'page' : undefined}>
            お気に入り
          </a>
          <a href="#point-settings" aria-current={route === 'settings' ? 'page' : undefined}>
            設定
          </a>
        </nav>
      </header>

      {mode === 'mock' && (
        <div className="mode-banner mock" data-testid="mode-banner">
          モックモード：表示される商品・価格はすべて架空のサンプルです（楽天APIの認証情報が未設定）
        </div>
      )}
      {mode === 'live' && (
        <div className="mode-banner live" data-testid="mode-banner">
          楽天市場 商品検索API（実データ）
        </div>
      )}
      {configError && (
        <div className="alert error" role="alert">
          {configError}
          {route !== 'settings' && (
            <>
              {' '}
              <a href="#point-settings">設定でアクセストークンを確認</a>
            </>
          )}
        </div>
      )}

      <main>
        {route === 'search' && (
          <SearchView
            state={searchState}
            onStateChange={setSearchState}
            response={response}
            loading={loading}
            error={error}
            onSearch={(s) => void runSearch(s)}
            settings={settings}
            onSettingsChange={setSettings}
            overrides={overrides}
            onOverride={onOverride}
            history={history}
            favorites={favorites}
            onToggleFavorite={toggleProductFavorite}
            onSaveSearchFavorite={saveSearchFavorite}
            affiliateEnabled={Boolean(config?.affiliateEnabled)}
            sortKey={sortKey}
            onSortKey={(k) => updateUi({ sortKey: k })}
            showAdvanced={Boolean(ui.showAdvanced)}
            onShowAdvanced={(v) => updateUi({ showAdvanced: v })}
          />
        )}
        {route === 'favorites' && (
          <FavoritesView
            favorites={favorites}
            onChange={setFavorites}
            onOpen={(f) => void runSearch({ query: f.query, categoryId: f.categoryId, unitId: f.unitId })}
            onBulkCheck={() => void bulkCheck()}
            bulkProgress={bulk}
            onCancelBulk={() => {
              bulkCancel.current = true;
            }}
          />
        )}
        {route === 'settings' && (
          <SettingsView
            settings={settings}
            onChange={setSettings}
            token={token}
            onTokenChange={setToken}
            onClearAll={() => {
              store.clearAll();
              window.location.reload();
            }}
          />
        )}
      </main>

      <footer className="site-footer">
        {config?.affiliateEnabled && <p>本サービスは楽天アフィリエイトを利用しています（「PR」表示のリンク）。表示順位は報酬率に影響されません。</p>}
        <p>
          実質価格・獲得ポイントは設定に基づく概算です。購入前に必ず楽天市場の商品ページで価格・送料・ポイント条件をご確認ください。
        </p>
        <p>設定・履歴・お気に入りはこの端末内（localStorage）にのみ保存されます。広告用の追跡技術は使用していません。</p>
        <p>
          <a href="https://webservice.rakuten.co.jp/" target="_blank" rel="noopener noreferrer">
            Supported by Rakuten Developers
          </a>
        </p>
      </footer>
    </div>
  );
}
