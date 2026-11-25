import { useState, type ChangeEvent } from 'react';
import { TIER_LABELS, TIERS, type PriceTier } from '../../shared/pricing/engine';
import type { ItemOverride } from '../../shared/pricing/settings';
import { formatAmount, type ComparisonUnit } from '../../shared/quantity/categories';
import type { RankedRow } from '../../shared/ranking';
import type { Dimension } from '../../shared/types';
import { CONFIDENCE_LABEL, dateTime, PACKAGE_LABEL, pts, unitYen, yen } from '../format';

const DIM_OPTIONS: Array<[Dimension, string]> = [
  ['volume', 'ml'],
  ['mass', 'g'],
  ['length', 'm'],
  ['uses', '回'],
  ['meals', '食'],
  ['sheets', '枚'],
  ['pairs', '組'],
  ['pieces', '個'],
];

const BASIS_LABEL = { taxExcluded: '税抜', taxIncluded: '税込' } as const;

interface Props {
  row: RankedRow;
  unit: ComparisonUnit;
  override: ItemOverride | undefined;
  onOverride: (o: ItemOverride | null) => void;
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function ItemDetail({ row, unit, override, onOverride }: Props) {
  const { price, quantity, product } = row;
  const ref = price.tiers.reference;
  const q = override?.quantity;
  const [form, setForm] = useState({
    dimension: (q?.dimension ?? quantity.dimension ?? unit.dimension) as Dimension,
    perUnit: String(q?.perUnit ?? quantity.unitAmount ?? ''),
    setCount: String(q?.setCount ?? quantity.setCount ?? 1),
    shippingYen: override?.shippingYen?.toString() ?? '',
    couponYen: override?.couponYen?.toString() ?? '',
    couponPercent: override?.couponPercent?.toString() ?? '',
    superDealPercent: override?.superDealPercent?.toString() ?? '',
    shopExtraPercent: override?.shopExtraPercent?.toString() ?? '',
    perUseAmount: override?.perUseAmount?.toString() ?? '',
    taxRate: override?.taxRate?.toString() ?? '',
  });
  const [qtyEdit, setQtyEdit] = useState(Boolean(q));
  const set = (k: keyof typeof form) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = () => {
    const o: ItemOverride = {};
    if (qtyEdit) {
      const perUnit = numOrUndef(form.perUnit);
      const setCount = numOrUndef(form.setCount);
      if (perUnit && setCount && setCount >= 1) {
        o.quantity = { dimension: form.dimension, perUnit, setCount: Math.floor(setCount) };
      }
    }
    const assign = (k: Exclude<keyof ItemOverride, 'quantity'>, v: string) => {
      const n = numOrUndef(v);
      if (n !== undefined) o[k] = n;
    };
    assign('shippingYen', form.shippingYen);
    assign('couponYen', form.couponYen);
    assign('couponPercent', form.couponPercent);
    assign('superDealPercent', form.superDealPercent);
    assign('shopExtraPercent', form.shopExtraPercent);
    assign('perUseAmount', form.perUseAmount);
    assign('taxRate', form.taxRate);
    onOverride(Object.keys(o).length > 0 ? o : null);
  };

  const unitPriceFor = (t: PriceTier) => {
    const tier = price.tiers[t];
    const total = row.selected?.total ?? null;
    if (tier.netPrice === null || total === null) return null;
    return (tier.netPrice / total) * unit.per;
  };

  return (
    <div className="detail">
      <section>
        <h4>価格区分ごとの計算</h4>
        <div className="table-scroll">
          <table className="mini">
            <thead>
              <tr>
                <th>区分</th>
                <th>支払額</th>
                <th>ポイント</th>
                <th>実質価格</th>
                <th>{unit.label}</th>
              </tr>
            </thead>
            <tbody>
              {TIERS.map((t) => {
                const tier = price.tiers[t];
                return (
                  <tr key={t} className={row.tier.tier === t ? 'current' : ''}>
                    <th scope="row">{TIER_LABELS[t]}</th>
                    <td>
                      {yen(tier.payment)}
                      {tier.couponDiscount > 0 && <small>（クーポン −{yen(tier.couponDiscount)}）</small>}
                      {tier.shippingAssumed && <small>（送料仮定）</small>}
                    </td>
                    <td>{pts(tier.totalPoints)}</td>
                    <td>{yen(tier.netPrice)}</td>
                    <td>{unitYen(unitPriceFor(t))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h4>ポイント内訳（参考価格の条件まで含む）</h4>
        <ul className="point-lines">
          {ref.pointLines.map((l) => (
            <li key={l.id}>
              <span className={`tag tier-${l.tier}`}>{l.tier === 'confirmed' ? '取得済' : l.tier === 'estimated' ? '設定' : '仮定'}</span>
              <span className="pl-label">{l.label}</span>
              <span className="pl-calc">
                {BASIS_LABEL[l.basis]}
                {yen(l.baseAmount)} × {l.ratePercent}% = {pts(l.rawPoints)}
                {l.points !== l.rawPoints && ` → ${pts(l.points)}`}
              </span>
              {l.note && <small className="pl-note">{l.note}</small>}
            </li>
          ))}
        </ul>
        <p className="hint">
          通常購入分1倍は1回のみ計上。基本倍率・商品別倍率・スーパーDEAL還元率に含まれる1倍分は差し引いています。各行で小数点以下切り捨て。
        </p>
        {price.notes.length > 0 && (
          <ul className="notes">
            {price.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>数量の解析結果</h4>
        <dl className="kv">
          <dt>信頼度</dt>
          <dd>
            <span className={`conf conf-${row.selected?.confidence ?? quantity.confidence}`}>
              {CONFIDENCE_LABEL[row.selected?.confidence ?? quantity.confidence]}
            </span>
            {quantity.source === 'caption' && '（商品説明から推定）'}
            {quantity.source === 'manual' && '（手動補正）'}
          </dd>
          <dt>1個あたり</dt>
          <dd>{quantity.unitAmount !== null && quantity.dimension ? formatAmount(quantity.unitAmount, quantity.dimension) : '不明'}</dd>
          <dt>セット個数</dt>
          <dd>{quantity.setCount ?? '不明'}</dd>
          <dt>合計</dt>
          <dd>{row.selected ? formatAmount(row.selected.total, unit.dimension) : '不明'}</dd>
          {quantity.packageKind !== 'unknown' && (
            <>
              <dt>区分</dt>
              <dd>{PACKAGE_LABEL[quantity.packageKind]}</dd>
            </>
          )}
          {quantity.variant && (
            <>
              <dt>香り・種類</dt>
              <dd>{quantity.variant}</dd>
            </>
          )}
          {quantity.matchedText.length > 0 && (
            <>
              <dt>抽出した表記</dt>
              <dd>{quantity.matchedText.join(' / ')}</dd>
            </>
          )}
          <dt>情報取得</dt>
          <dd>{dateTime(product.fetchedAt)}</dd>
          <dt>税区分</dt>
          <dd>
            {product.taxIncluded === null ? '不明（税込として計算）' : product.taxIncluded ? '税込' : '税別'}・税率{price.taxRate}%
          </dd>
        </dl>
        {(quantity.reasons.length > 0 || row.selected?.note) && (
          <ul className="notes">
            {row.selected?.note && <li>{row.selected.note}</li>}
            {quantity.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {row.perUsePrice !== null && <p>1回使用あたり実質価格: <strong>{unitYen(row.perUsePrice)}</strong></p>}
      </section>

      <section>
        <h4>手動補正（この端末にのみ保存）</h4>
        <label className="check">
          <input type="checkbox" checked={qtyEdit} onChange={(e) => setQtyEdit(e.target.checked)} /> 内容量・個数を修正する
        </label>
        {qtyEdit && (
          <div className="grid3">
            <label>
              1個あたりの量
              <input inputMode="decimal" value={form.perUnit} onChange={set('perUnit')} aria-label="1個あたりの量" />
            </label>
            <label>
              単位
              <select value={form.dimension} onChange={set('dimension')} aria-label="単位">
                {DIM_OPTIONS.map(([d, l]) => (
                  <option key={d} value={d}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label>
              セット個数
              <input inputMode="numeric" value={form.setCount} onChange={set('setCount')} aria-label="セット個数" />
            </label>
          </div>
        )}
        <div className="grid3">
          {product.shipping.kind === 'separate' && (
            <label>
              送料（円）
              <input inputMode="numeric" value={form.shippingYen} onChange={set('shippingYen')} placeholder="不明" />
            </label>
          )}
          <label>
            クーポン（円）
            <input inputMode="numeric" value={form.couponYen} onChange={set('couponYen')} placeholder="0" />
          </label>
          <label>
            クーポン（%）
            <input inputMode="decimal" value={form.couponPercent} onChange={set('couponPercent')} placeholder="0" />
          </label>
          <label>
            スーパーDEAL（%）
            <input inputMode="decimal" value={form.superDealPercent} onChange={set('superDealPercent')} placeholder="対象外" />
          </label>
          <label>
            店舗独自ポイント（%）
            <input inputMode="decimal" value={form.shopExtraPercent} onChange={set('shopExtraPercent')} placeholder="0" />
          </label>
          <label>
            1回使用量（ml/g）
            <input inputMode="decimal" value={form.perUseAmount} onChange={set('perUseAmount')} placeholder="未入力" />
          </label>
          <label>
            税率（%）
            <input inputMode="numeric" value={form.taxRate} onChange={set('taxRate')} placeholder={`${price.taxRate}`} />
          </label>
        </div>
        <p className="hint">クーポン・スーパーDEAL・店舗独自ポイントは未確認条件のため「参考価格」にのみ反映されます。</p>
        <div className="row-actions">
          <button type="button" className="btn primary" onClick={save}>
            補正を保存
          </button>
          {override && (
            <button type="button" className="btn" onClick={() => onOverride(null)}>
              補正を解除
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
