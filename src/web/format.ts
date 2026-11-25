import type { Confidence, PackageKind } from '../shared/types';

export const yen = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '不明' : `${Math.round(n).toLocaleString('ja-JP')}円`;

export const unitYen = (n: number | null | undefined): string => {
  if (n === null || n === undefined || !Number.isFinite(n)) return '不明';
  const digits = n < 10 ? 2 : n < 100 ? 1 : 0;
  return `${n.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits })}円`;
};

export const pct = (n: number | null | undefined): string =>
  n === null || n === undefined || !Number.isFinite(n) ? '不明' : `${n.toFixed(1)}%`;

export const pts = (n: number): string => `${n.toLocaleString('ja-JP')}pt`;

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '不明';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '不明';
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  confirmed: '確定',
  review: '要確認',
  unknown: '判定不能',
};

export const PACKAGE_LABEL: Record<PackageKind, string> = {
  body: '本体',
  refill: '詰め替え',
  mixed: '本体+詰め替え',
  unknown: '',
};
