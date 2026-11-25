/**
 * 端末内保存（localStorage）。プライベートブラウズ等で使えない場合も動作を継続する。
 * 保存データは Worker に送信しない。
 */
import { sanitizeOverride, sanitizeSettings, type ItemOverride, type UserSettings } from '../shared/pricing/settings';
import type { SearchQuery } from '../shared/types';
import { validateSearchQuery } from '../shared/validation';

const PREFIX = 'npw:v1:';

function read(key: string): unknown {
  try {
    const raw = globalThis.localStorage?.getItem(PREFIX + key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    globalThis.localStorage?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 保存できなくても画面は継続
  }
}
function remove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(PREFIX + key);
  } catch {
    /* noop */
  }
}

export const loadSettings = (): UserSettings => sanitizeSettings(read('settings'));
export const saveSettings = (s: UserSettings) => write('settings', s);

export function loadOverrides(): Record<string, ItemOverride> {
  const raw = read('overrides');
  const out: Record<string, ItemOverride> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof k === 'string' && k.length <= 200) {
        const o = sanitizeOverride(v);
        if (Object.keys(o).length > 0) out[k] = o;
      }
    }
  }
  return out;
}
export const saveOverrides = (o: Record<string, ItemOverride>) => write('overrides', o);

export interface HistoryEntry {
  query: SearchQuery;
  categoryId: string;
  at: string;
}

function safeQuery(q: unknown): SearchQuery | null {
  try {
    return validateSearchQuery((q ?? {}) as Record<string, unknown>);
  } catch {
    return null;
  }
}

export function loadHistory(): HistoryEntry[] {
  const raw = read('history');
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h: Record<string, unknown>) => {
      const query = safeQuery(h?.query);
      return query ? { query, categoryId: String(h.categoryId ?? 'other'), at: String(h.at ?? '') } : null;
    })
    .filter((h): h is HistoryEntry => h !== null)
    .slice(0, 10);
}
export const saveHistory = (h: HistoryEntry[]) => write('history', h.slice(0, 10));

export interface FavoriteCheck {
  at: string;
  mode: 'mock' | 'live';
  bestUnitPrice: number | null;
  bestItemName: string | null;
  comparedCount: number;
  error?: string;
}

export interface Favorite {
  id: string;
  label: string;
  kind: 'search' | 'product';
  query: SearchQuery;
  categoryId: string;
  unitId: string;
  targetUnitPrice: number | null;
  /** 商品のお気に入りの場合の商品コード */
  itemCode?: string;
  createdAt: string;
  /** 直近 1 回分の確認結果のみ保持（価格履歴は保存しない） */
  lastCheck?: FavoriteCheck;
}

export function loadFavorites(): Favorite[] | null {
  const raw = read('favorites');
  if (raw === null) return null;
  if (!Array.isArray(raw)) return [];
  const out: Favorite[] = [];
  for (const f of raw as Array<Record<string, unknown>>) {
    const query = safeQuery(f?.query);
    if (!query || typeof f.id !== 'string') continue;
    const target = Number(f.targetUnitPrice);
    out.push({
      id: f.id,
      label: typeof f.label === 'string' ? f.label.slice(0, 100) : query.keyword,
      kind: f.kind === 'product' ? 'product' : 'search',
      query,
      categoryId: String(f.categoryId ?? 'other'),
      unitId: String(f.unitId ?? ''),
      targetUnitPrice: f.targetUnitPrice !== null && Number.isFinite(target) && target > 0 ? target : null,
      itemCode: typeof f.itemCode === 'string' ? f.itemCode : undefined,
      createdAt: String(f.createdAt ?? ''),
      lastCheck: (f.lastCheck as FavoriteCheck | undefined) ?? undefined,
    });
  }
  return out;
}
export const saveFavorites = (f: Favorite[]) => write('favorites', f);

export const loadToken = (): string => {
  const v = read('token');
  return typeof v === 'string' ? v : '';
};
export const saveToken = (t: string) => (t ? write('token', t) : remove('token'));

export function clearAll(): void {
  for (const k of ['settings', 'overrides', 'history', 'favorites', 'token', 'ui']) remove(k);
}

export interface UiPrefs {
  sortKey?: string;
  showAdvanced?: boolean;
}
export const loadUi = (): UiPrefs => (read('ui') as UiPrefs | null) ?? {};
export const saveUi = (u: UiPrefs) => write('ui', u);
