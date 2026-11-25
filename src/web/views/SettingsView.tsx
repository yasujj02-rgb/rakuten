import type { ReactNode } from 'react';
import { DEFAULT_SETTINGS, sanitizeSettings, type CampaignSetting, type PointBase, type UserSettings } from '../../shared/pricing/settings';

interface Props {
  settings: UserSettings;
  onChange: (s: UserSettings) => void;
  token: string;
  onTokenChange: (t: string) => void;
  onClearAll: () => void;
}

function Field({ label, help, children }: { label: string; help: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>
        <span className="field-label">{label}</span>
        {children}
      </label>
      <p className="help">{help}</p>
    </div>
  );
}

function NumInput({
  value,
  onChange,
  nullable = false,
  label,
  step = 'any',
}: {
  value: number | null;
  onChange: (v: number | null) => void;
  nullable?: boolean;
  label: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      inputMode="decimal"
      step={step}
      aria-label={label}
      value={value ?? ''}
      placeholder={nullable ? '未設定' : undefined}
      onChange={(e) => {
        if (e.target.value === '') onChange(nullable ? null : 0);
        else onChange(Number(e.target.value));
      }}
    />
  );
}

function BaseSelect({ value, onChange, label }: { value: PointBase; onChange: (v: PointBase) => void; label: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as PointBase)} aria-label={label}>
      <option value="taxExcluded">税抜価格</option>
      <option value="taxIncluded">税込価格</option>
    </select>
  );
}

export function SettingsView({ settings, onChange, token, onTokenChange, onClearAll }: Props) {
  // 入力のたびに検証して保存（ランキングは即時再計算される）
  const patch = (p: Partial<UserSettings>) => onChange(sanitizeSettings({ ...settings, ...p }));
  const camp = (key: 'kaimawari' | 'dayCampaign', p: Partial<CampaignSetting>) => patch({ [key]: { ...settings[key], ...p } });

  return (
    <div className="view settings">
      <h2>ポイント設定</h2>
      <p className="hint">
        設定はこの端末にのみ保存されます。変更すると表示中のランキングを即座に再計算します（APIの再取得は行いません）。
        実際の付与ポイントは楽天の各キャンペーン条件・エントリー状況により異なります。
      </p>

      <section>
        <h3>基本</h3>
        <Field label="基本ポイント倍率（倍）" help="SPU などで普段獲得している合計倍率。通常購入分の1倍を含みます（初期値9倍）。">
          <NumInput label="基本ポイント倍率" value={settings.baseMultiplier} onChange={(v) => patch({ baseMultiplier: v ?? 1 })} />
        </Field>
        <Field label="SPUの追加倍率（倍）" help="基本倍率に含めていない一時的なSPU上乗せ分。通常1倍は含めないでください。">
          <NumInput label="SPUの追加倍率" value={settings.spuExtra} onChange={(v) => patch({ spuExtra: v ?? 0 })} />
        </Field>
        <Field label="基本倍率分の付与上限（pt）" help="SPU 等の上限を考慮する場合に入力。未設定なら上限なしで計算します。">
          <NumInput label="基本倍率分の上限" nullable value={settings.baseCap} onChange={(v) => patch({ baseCap: v })} />
        </Field>
        <Field label="基本倍率分の残り上限（pt）" help="今月すでに上限近くまで獲得している場合に入力。">
          <NumInput label="基本倍率分の残り上限" nullable value={settings.baseRemainingCap} onChange={(v) => patch({ baseRemainingCap: v })} />
        </Field>
        <Field label="通常・SPUポイントの計算対象" help="楽天市場の通常ポイントは原則として税抜価格（送料除く）が対象です。">
          <BaseSelect label="通常・SPUポイントの計算対象" value={settings.basePointBase} onChange={(v) => patch({ basePointBase: v })} />
        </Field>
        <Field label="ポイントの評価額（円/pt）" help="1ポイントを何円とみなすか。期間限定ポイントを低く評価する場合などに変更します。">
          <NumInput label="ポイントの評価額" value={settings.pointValueYen} onChange={(v) => patch({ pointValueYen: v ?? 1 })} />
        </Field>
        <Field label="消費税率（%）" help="未設定ならカテゴリ既定（食品・飲料 8%、その他 10%）。税別表示の商品の税込換算とポイント対象額の計算に使用します。">
          <NumInput label="消費税率" nullable value={settings.taxRateOverride} onChange={(v) => patch({ taxRateOverride: v })} />
        </Field>
        <Field label="商品別ポイント倍率の計算対象" help="楽天APIで取得できる商品別ポイント倍率（店舗のポイントアップ。通常1倍を含む倍率として扱います）の対象金額。">
          <BaseSelect label="商品別ポイント倍率の計算対象" value={settings.shopPointBase} onChange={(v) => patch({ shopPointBase: v })} />
        </Field>
      </section>

      {(
        [
          ['kaimawari', '買い回りキャンペーン', 'お買い物マラソン等の「ショップ数に応じた倍率」。追加倍率は通常1倍を含めない値（例: 10店舗なら +9）。'],
          ['dayCampaign', '5と0のつく日等の追加キャンペーン', '日付キャンペーン等の追加倍率。条件（エントリー・カード決済等）を満たす場合のみ有効にしてください。'],
        ] as const
      ).map(([key, title, help]) => (
        <section key={key}>
          <h3>{title}</h3>
          <label className="check">
            <input type="checkbox" checked={settings[key].enabled} onChange={(e) => camp(key, { enabled: e.target.checked })} aria-label={`${title}を有効にする`} />
            有効にする（概算実質価格に反映）
          </label>
          <p className="help">{help}</p>
          <div className="grid2">
            <Field label="追加倍率（倍）" help="通常1倍を含まない上乗せ分">
              <NumInput label={`${title}の追加倍率`} value={settings[key].extraMultiplier} onChange={(v) => camp(key, { extraMultiplier: v ?? 0 })} />
            </Field>
            <Field label="計算対象" help="対象金額の基準">
              <BaseSelect label={`${title}の計算対象`} value={settings[key].base} onChange={(v) => camp(key, { base: v })} />
            </Field>
            <Field label="付与上限（pt）" help="キャンペーン期間中の上限">
              <NumInput label={`${title}の上限`} nullable value={settings[key].cap} onChange={(v) => camp(key, { cap: v })} />
            </Field>
            <Field label="残り上限（pt）" help="既に獲得済みの分を差し引いた残り">
              <NumInput label={`${title}の残り上限`} nullable value={settings[key].remainingCap} onChange={(v) => camp(key, { remainingCap: v })} />
            </Field>
          </div>
        </section>
      ))}

      <section>
        <h3>楽天スーパーDEAL</h3>
        <p className="help">
          スーパーDEALの対象可否と還元率は商品検索APIでは取得できません。商品の「内訳・補正」でDEAL還元率を入力した商品にのみ、参考価格として反映します。
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.superDeal.includesNormal}
            onChange={(e) => patch({ superDeal: { ...settings.superDeal, includesNormal: e.target.checked } })}
          />
          DEAL還元率に通常購入分1倍（1%）が含まれる（重複計上しない）
        </label>
        <div className="grid2">
          <Field label="計算対象" help="DEALポイントの対象金額">
            <BaseSelect label="DEALの計算対象" value={settings.superDeal.base} onChange={(v) => patch({ superDeal: { ...settings.superDeal, base: v } })} />
          </Field>
          <Field label="付与上限（pt）" help="DEALの上限がある場合">
            <NumInput label="DEALの上限" nullable value={settings.superDeal.cap} onChange={(v) => patch({ superDeal: { ...settings.superDeal, cap: v } })} />
          </Field>
        </div>
      </section>

      <section>
        <h3>クーポン・送料（参考価格のみ）</h3>
        <label className="check">
          <input type="checkbox" checked={settings.coupon.enabled} onChange={(e) => patch({ coupon: { ...settings.coupon, enabled: e.target.checked } })} />
          全商品にクーポンを仮定する
        </label>
        <p className="help">未確認のクーポンは自動適用しません。有効にしても「参考価格」にのみ反映されます。</p>
        <div className="grid3">
          <Field label="クーポン金額（円）" help="定額値引き">
            <NumInput label="クーポン金額" value={settings.coupon.amountYen} onChange={(v) => patch({ coupon: { ...settings.coupon, amountYen: v ?? 0 } })} />
          </Field>
          <Field label="クーポン割引率（%）" help="定率値引き">
            <NumInput label="クーポン割引率" value={settings.coupon.percent} onChange={(v) => patch({ coupon: { ...settings.coupon, percent: v ?? 0 } })} />
          </Field>
          <Field label="利用条件（円以上）" help="この金額以上で適用">
            <NumInput label="クーポン利用条件" value={settings.coupon.minPurchaseYen} onChange={(v) => patch({ coupon: { ...settings.coupon, minPurchaseYen: v ?? 0 } })} />
          </Field>
        </div>
        <Field label="送料別商品の仮定送料（円）" help="送料別で金額が不明な商品に仮定する送料。未設定なら送料不明として別枠表示します（送料無料とはみなしません）。">
          <NumInput label="仮定送料" nullable value={settings.assumedShippingYen} onChange={(v) => patch({ assumedShippingYen: v })} />
        </Field>
      </section>

      <section>
        <h3>アクセス</h3>
        <Field label="アクセストークン" help="サーバーを共有トークン方式で保護している場合に入力します（Cloudflare Access 利用時は不要）。この端末にのみ保存されます。">
          <input type="password" autoComplete="off" value={token} onChange={(e) => onTokenChange(e.target.value.trim())} aria-label="アクセストークン" />
        </Field>
      </section>

      <section className="danger-zone">
        <div className="row-actions">
          <button type="button" className="btn" onClick={() => onChange(DEFAULT_SETTINGS)}>
            ポイント設定を初期値に戻す
          </button>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              if (window.confirm('設定・履歴・お気に入り・手動補正をすべて削除しますか？')) onClearAll();
            }}
          >
            端末内のデータをすべて削除
          </button>
        </div>
      </section>
    </div>
  );
}
