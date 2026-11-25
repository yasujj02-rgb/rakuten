import { Fragment, useState, useSyncExternalStore } from 'react';
import type { ItemOverride } from '../../shared/pricing/settings';
import { formatAmount, type ComparisonUnit } from '../../shared/quantity/categories';
import type { RankedRow, RowGroup } from '../../shared/ranking';
import type { DataMode } from '../../shared/types';
import { CONFIDENCE_LABEL, dateTime, PACKAGE_LABEL, pct, pts, unitYen, yen } from '../format';
import { ItemDetail } from './ItemDetail';

function subscribe(cb: () => void) {
  const mq = window.matchMedia('(min-width: 960px)');
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
function useWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia('(min-width: 960px)').matches,
    () => false,
  );
}

export interface ResultsProps {
  rows: RankedRow[];
  group: RowGroup;
  unit: ComparisonUnit;
  mode: DataMode;
  affiliateEnabled: boolean;
  overrides: Record<string, ItemOverride>;
  onOverride: (itemCode: string, o: ItemOverride | null) => void;
  isFavorite: (itemCode: string) => boolean;
  onToggleFavorite: (row: RankedRow) => void;
  targetUnitPrice?: number | null;
}

function shippingText(row: RankedRow): string {
  const t = row.tier;
  if (row.product.shipping.kind === 'included') return '送料込み';
  if (t.shipping === null) return '送料別（不明）';
  return `送料 ${yen(t.shipping)}${t.shippingAssumed ? '（仮定）' : ''}`;
}

function quantityText(row: RankedRow, unit: ComparisonUnit): string {
  const q = row.quantity;
  if (!row.selected) {
    if (q.dimension && q.totalAmount !== null) return `${formatAmount(q.totalAmount, q.dimension)}（単位違い）`;
    return '不明';
  }
  const per = q.unitAmount !== null && q.dimension ? formatAmount(q.unitAmount, q.dimension) : null;
  const total = formatAmount(row.selected.total, unit.dimension);
  if (per && q.setCount && q.setCount > 1 && q.dimension === unit.dimension) return `${per}×${q.setCount} = ${total}`;
  return total;
}

function displayUnitPrice(row: RankedRow, group: RowGroup): number | null {
  return group === 'shippingUnknown' ? row.unitPriceExShipping : row.unitPrice;
}

function BuyLink({ row, mode, affiliateEnabled }: { row: RankedRow; mode: DataMode; affiliateEnabled: boolean }) {
  const href = row.product.affiliateUrl ?? row.product.itemUrl;
  if (mode === 'mock' || !href) {
    return <span className="btn disabled" title="モックデータのため購入リンクはありません">リンクなし（サンプル）</span>;
  }
  const isAff = Boolean(row.product.affiliateUrl) && affiliateEnabled;
  return (
    <a
      className="btn buy"
      href={href}
      target="_blank"
      rel={isAff ? 'sponsored nofollow noopener noreferrer' : 'nofollow noopener noreferrer'}
    >
      楽天市場で見る{isAff && <span className="pr">PR</span>}
    </a>
  );
}

function Confidence({ row }: { row: RankedRow }) {
  const c = row.selected?.confidence ?? row.quantity.confidence;
  return <span className={`conf conf-${c}`}>{CONFIDENCE_LABEL[c]}</span>;
}

function Thumb({ url, alt }: { url: string | null; alt: string }) {
  return url ? (
    <img className="thumb" src={url} alt={alt} loading="lazy" referrerPolicy="no-referrer" width={96} height={96} />
  ) : (
    <div className="thumb placeholder" aria-hidden="true">
      画像なし
    </div>
  );
}

export function Results(props: ResultsProps) {
  const wide = useWide();
  const [open, setOpen] = useState<string | null>(null);
  const { rows, group, unit } = props;
  if (rows.length === 0) return null;
  const toggle = (code: string) => setOpen((o) => (o === code ? null : code));
  const upLabel = group === 'shippingUnknown' ? `${unit.label}（送料除く参考）` : `実質単価（${unit.label}）`;

  if (wide) {
    return (
      <div className="table-wrap">
        <table className="results-table">
          <thead>
            <tr>
              <th>#</th>
              <th>商品</th>
              <th className="num">{upLabel}</th>
              <th className="num">実質価格</th>
              <th className="num">支払額</th>
              <th className="num">獲得見込み</th>
              <th>内容量</th>
              <th>信頼度</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const code = row.product.itemCode;
              const up = displayUnitPrice(row, group);
              const hit = props.targetUnitPrice && up !== null && up <= props.targetUnitPrice;
              return (
                <Fragment key={code}>
                  <tr className={hit ? 'hit' : ''} data-testid="result-row">
                    <td>{group === 'unrankable' ? '–' : i + 1}</td>
                    <td className="prod">
                      <Thumb url={row.product.imageUrl} alt="" />
                      <div>
                        <div className="name">{row.product.itemName}</div>
                        <div className="meta">
                          {row.product.shopName}・販売価格 {yen(row.product.itemPrice)}
                          {row.product.taxIncluded === false && '（税別）'}・{shippingText(row)}
                          {row.quantity.packageKind !== 'unknown' && `・${PACKAGE_LABEL[row.quantity.packageKind]}`}
                          ・取得 {dateTime(row.product.fetchedAt)}
                        </div>
                        {row.reason && <div className="reason">{row.reason}</div>}
                      </div>
                    </td>
                    <td className="num unit-price" data-testid="unit-price">
                      {unitYen(up)}
                    </td>
                    <td className="num">{yen(group === 'shippingUnknown' ? row.tier.netPriceExShipping : row.tier.netPrice)}</td>
                    <td className="num">{yen(group === 'shippingUnknown' ? row.tier.goodsPayment : row.tier.payment)}</td>
                    <td className="num">
                      {pts(row.tier.totalPoints)}
                      <small>{pct(row.tier.pointReturnPercent)}</small>
                    </td>
                    <td>{quantityText(row, unit)}</td>
                    <td>
                      <Confidence row={row} />
                    </td>
                    <td className="actions">
                      <BuyLink row={row} mode={props.mode} affiliateEnabled={props.affiliateEnabled} />
                      <button
                        type="button"
                        className={`btn icon ${props.isFavorite(code) ? 'on' : ''}`}
                        aria-label="お気に入り"
                        aria-pressed={props.isFavorite(code)}
                        onClick={() => props.onToggleFavorite(row)}
                      >
                        ★
                      </button>
                      <button type="button" className="btn" aria-expanded={open === code} onClick={() => toggle(code)}>
                        内訳
                      </button>
                    </td>
                  </tr>
                  {open === code && (
                    <tr className="detail-row">
                      <td colSpan={9}>
                        <ItemDetail
                          row={row}
                          unit={unit}
                          override={props.overrides[code]}
                          onOverride={(o) => props.onOverride(code, o)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <ol className="cards">
      {rows.map((row, i) => {
        const code = row.product.itemCode;
        const up = displayUnitPrice(row, group);
        const hit = props.targetUnitPrice && up !== null && up <= props.targetUnitPrice;
        return (
          <li key={code} className={`card ${hit ? 'hit' : ''}`} data-testid="result-row">
            <div className="card-top">
              <div className="rank">{group === 'unrankable' ? '–' : i + 1}</div>
              <Thumb url={row.product.imageUrl} alt="" />
              <div className="card-main">
                <div className="name">{row.product.itemName}</div>
                <div className="meta">{row.product.shopName}</div>
              </div>
            </div>
            <div className="card-price">
              <div className="up-block">
                <div className="up-label">{upLabel}</div>
                <div className="unit-price" data-testid="unit-price">
                  {unitYen(up)}
                </div>
              </div>
              <Confidence row={row} />
            </div>
            <dl className="card-kv">
              <dt>実質価格</dt>
              <dd>{yen(group === 'shippingUnknown' ? row.tier.netPriceExShipping : row.tier.netPrice)}</dd>
              <dt>支払額</dt>
              <dd>{yen(group === 'shippingUnknown' ? row.tier.goodsPayment : row.tier.payment)}</dd>
              <dt>販売価格</dt>
              <dd>
                {yen(row.product.itemPrice)}
                {row.product.taxIncluded === false && '（税別）'}
              </dd>
              <dt>送料</dt>
              <dd>{shippingText(row)}</dd>
              <dt>獲得見込み</dt>
              <dd>
                {pts(row.tier.totalPoints)}（{pct(row.tier.pointReturnPercent)}）
              </dd>
              <dt>内容量</dt>
              <dd>
                {quantityText(row, unit)}
                {row.quantity.packageKind !== 'unknown' && ` ${PACKAGE_LABEL[row.quantity.packageKind]}`}
              </dd>
              <dt>取得日時</dt>
              <dd>{dateTime(row.product.fetchedAt)}</dd>
            </dl>
            {row.reason && <p className="reason">{row.reason}</p>}
            <div className="row-actions">
              <BuyLink row={row} mode={props.mode} affiliateEnabled={props.affiliateEnabled} />
              <button
                type="button"
                className={`btn icon ${props.isFavorite(code) ? 'on' : ''}`}
                aria-label="お気に入り"
                aria-pressed={props.isFavorite(code)}
                onClick={() => props.onToggleFavorite(row)}
              >
                ★
              </button>
              <button type="button" className="btn" aria-expanded={open === code} onClick={() => toggle(code)}>
                内訳・補正
              </button>
            </div>
            {open === code && (
              <ItemDetail row={row} unit={unit} override={props.overrides[code]} onOverride={(o) => props.onOverride(code, o)} />
            )}
          </li>
        );
      })}
    </ol>
  );
}
