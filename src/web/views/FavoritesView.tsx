import { useState } from 'react';
import { ALL_UNITS, AUTO, CATEGORIES, findUnit, resolveCategory } from '../../shared/quantity/categories';
import type { Favorite } from '../storage';
import { dateTime, unitYen } from '../format';

interface Props {
  favorites: Favorite[];
  onChange: (f: Favorite[]) => void;
  onOpen: (f: Favorite) => void;
  onBulkCheck: () => void;
  bulkProgress: { done: number; total: number } | null;
  onCancelBulk: () => void;
}

/** 自動単位のお気に入りは、直近の確認で使った単位を表示 */
const lcUnit = (f: Favorite): string | undefined => (f.unitId === AUTO ? f.lastCheck?.unitLabel : undefined);

export function FavoritesView({ favorites, onChange, onOpen, onBulkCheck, bulkProgress, onCancelBulk }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const [newKeyword, setNewKeyword] = useState('');

  const update = (id: string, patch: Partial<Favorite>) =>
    onChange(favorites.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const removeFav = (id: string) => onChange(favorites.filter((f) => f.id !== id));

  const add = () => {
    const kw = newKeyword.trim();
    if (!kw) return;
    onChange([
      ...favorites,
      {
        id: crypto.randomUUID(),
        label: kw,
        kind: 'search',
        query: { keyword: kw, inStockOnly: true, pages: 1, apiSort: 'standard' },
        categoryId: AUTO,
        unitId: AUTO,
        targetUnitPrice: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewKeyword('');
  };

  return (
    <div className="view">
      <div className="fav-head">
        <h2>お気に入り</h2>
        {bulkProgress ? (
          <div className="bulk">
            一括再検索中… {bulkProgress.done}/{bulkProgress.total}
            <button type="button" className="btn" onClick={onCancelBulk}>
              中止
            </button>
          </div>
        ) : (
          <button type="button" className="btn primary" onClick={onBulkCheck} disabled={favorites.length === 0}>
            一括再検索
          </button>
        )}
      </div>
      <p className="hint">
        一括再検索は楽天APIへの負荷を抑えるため、1件ずつ間隔を空けて実行します。結果は直近1回分のみ端末に保存し、価格履歴は保存しません。
      </p>

      <form
        className="search-bar"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="検索条件を追加（例: 柔軟剤 詰め替え）" aria-label="お気に入りに追加するキーワード" maxLength={100} />
        <button type="submit" className="btn">
          追加
        </button>
      </form>

      {favorites.length === 0 && <p className="empty">お気に入りはまだありません。検索結果の ★ や「この検索条件を登録」から追加できます。</p>}

      <ul className="fav-list">
        {favorites.map((f) => {
          const cat = resolveCategory(f.categoryId, f.query.keyword);
          const fixedUnit = findUnit(f.unitId);
          const unitLabel = fixedUnit?.label ?? lcUnit(f) ?? '自動';
          const lc = f.lastCheck;
          const hit = lc && f.targetUnitPrice !== null && lc.bestUnitPrice !== null && lc.bestUnitPrice <= f.targetUnitPrice;
          return (
            <li key={f.id} className={`fav-item ${hit ? 'hit' : ''}`} data-testid="favorite-item">
              <div className="fav-main">
                <div className="fav-title">
                  <span className="tag">{f.kind === 'product' ? '商品' : '検索条件'}</span> {f.label}
                </div>
                <div className="meta">
                  {cat.label}・{fixedUnit ? fixedUnit.label : '単位は自動'}
                  {f.targetUnitPrice !== null && `・目標 ${unitYen(f.targetUnitPrice)}（${unitLabel}）`}
                </div>
                {lc && (
                  <div className="fav-check">
                    {lc.error ? (
                      <span className="error-text">{lc.error}</span>
                    ) : (
                      <>
                        最安 {unitYen(lc.bestUnitPrice)}（{lc.unitLabel ?? unitLabel}）
                        {lc.bestItemName && <span className="fav-best">{lc.bestItemName}</span>}
                        {hit && <strong className="hit-badge">目標達成</strong>}
                      </>
                    )}
                    <small>
                      {lc.mode === 'mock' ? 'モック・' : ''}
                      {dateTime(lc.at)} 確認
                    </small>
                  </div>
                )}
              </div>
              <div className="row-actions">
                <button type="button" className="btn primary" onClick={() => onOpen(f)}>
                  検索
                </button>
                <button type="button" className="btn" onClick={() => setEditing(editing === f.id ? null : f.id)}>
                  編集
                </button>
                <button type="button" className="btn danger" onClick={() => removeFav(f.id)} aria-label={`${f.label}を削除`}>
                  削除
                </button>
              </div>
              {editing === f.id && (
                <div className="fav-edit">
                  <label>
                    表示名
                    <input value={f.label} maxLength={100} onChange={(e) => update(f.id, { label: e.target.value })} />
                  </label>
                  <label>
                    検索キーワード
                    <input
                      value={f.query.keyword}
                      maxLength={100}
                      onChange={(e) => update(f.id, { query: { ...f.query, keyword: e.target.value } })}
                    />
                  </label>
                  <label>
                    除外キーワード
                    <input
                      value={f.query.ngKeyword ?? ''}
                      maxLength={100}
                      onChange={(e) => update(f.id, { query: { ...f.query, ngKeyword: e.target.value || undefined } })}
                    />
                  </label>
                  <div className="grid2">
                    <label>
                      比較単位
                      <select value={f.unitId} onChange={(e) => update(f.id, { unitId: e.target.value })} aria-label="比較単位">
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
                      <select value={f.categoryId} onChange={(e) => update(f.id, { categoryId: e.target.value })} aria-label="カテゴリ">
                        <option value={AUTO}>自動（{cat.label}）</option>
                        {CATEGORIES.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label>
                    目標単価（円／{unitLabel}）
                    <input
                      inputMode="decimal"
                      value={f.targetUnitPrice ?? ''}
                      onChange={(e) => {
                        const n = Number(e.target.value);
                        update(f.id, { targetUnitPrice: e.target.value && Number.isFinite(n) && n > 0 ? n : null });
                      }}
                      aria-label="目標単価"
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={Boolean(f.query.freeShippingOnly)}
                      onChange={(e) => update(f.id, { query: { ...f.query, freeShippingOnly: e.target.checked || undefined } })}
                    />
                    送料込みのみ
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
