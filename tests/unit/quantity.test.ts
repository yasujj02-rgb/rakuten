import { describe, expect, it } from 'vitest';
import { parseQuantity } from '../../src/shared/quantity/parser';
import { normalizeText } from '../../src/shared/normalize';

describe('normalizeText', () => {
  it('全角・単位語・掛け算記号・カンマを正規化する', () => {
    expect(normalizeText('１，２００ｍＬ Ｘ ６袋')).toBe('1200ml×6袋');
    expect(normalizeText('1.2リットル*3個')).toBe('1.2l×3個');
    expect(normalizeText('詰替え用 つめかえ用')).toBe('詰め替え 詰め替え');
    expect(normalizeText('500ml✕24本')).toBe('500ml×24本');
  });
  it('数量文脈以外の x は変換しない', () => {
    expect(normalizeText('MAX 2')).toBe('max 2');
    expect(normalizeText('premium x 2')).toBe('premium x 2');
  });
});

describe('parseQuantity: 指示書の例', () => {
  const cases: Array<[string, string, number, number]> = [
    ['柔軟剤 詰め替え 1200ml×6袋', 'volume', 7200, 6],
    ['柔軟剤 1,200mL 6個セット', 'volume', 7200, 6],
    ['柔軟剤 1.2L 詰替え 6袋入り', 'volume', 7200, 6],
    ['洗剤 1.2L×3個', 'volume', 3600, 3],
    ['洗剤 400g×3個', 'mass', 1200, 3],
    ['米 2kg 4袋セット', 'mass', 8000, 4],
    ['トイレットペーパー 50m×12ロール×4パック', 'length', 2400, 48],
    ['携帯トイレ 100回分', 'uses', 100, 1],
    ['保存食 24食セット', 'meals', 24, 1],
    ['お茶 500ml×24本×2ケース', 'volume', 24000, 48],
  ];
  it.each(cases)('%s', (name, dim, total, pieces) => {
    const r = parseQuantity(name);
    expect(r.dimension).toBe(dim);
    expect(r.totalAmount).toBe(total);
    expect(r.totalPieces).toBe(pieces);
    expect(r.confidence).toBe('confirmed');
  });
});

describe('parseQuantity: 誤認識の防止', () => {
  it('「ポイント10倍」をセット個数にしない', () => {
    const r = parseQuantity('【ポイント10倍】柔軟剤 詰め替え 1200ml');
    expect(r.setCount).toBe(1);
    expect(r.totalAmount).toBe(1200);
  });
  it('「P10倍」「最大20%OFF」も無視する', () => {
    const r = parseQuantity('P10倍 最大20%OFF 洗剤 400g×3個');
    expect(r.totalAmount).toBe(1200);
    expect(r.setCount).toBe(3);
  });
  it('「送料無料3000円以上」を内容量にしない', () => {
    const r = parseQuantity('送料無料3,000円以上 キッチン洗剤 本体');
    expect(r.totalAmount).toBeNull();
    expect(r.confidence).toBe('unknown');
  });
  it('型番・対応機種の数字を数量にしない', () => {
    const r = parseQuantity('交換用フィルター 対応機種 SX-500 KX1200 2個入');
    expect(r.amounts.volume).toBeUndefined();
    expect(r.totalPieces).toBe(2);
    expect(r.dimension).toBeNull();
  });
  it('「1個あたり」の単価表記を無視する', () => {
    const r = parseQuantity('柔軟剤 1200ml×6袋 1袋あたり398円');
    expect(r.totalAmount).toBe(7200);
  });
  it('トイレットペーパーの幅(mm)を長さにしない', () => {
    const r = parseQuantity('トイレットペーパー 114mm×30m 12ロール ダブル');
    expect(r.totalAmount).toBe(360);
    expect(r.variant).toContain('ダブル');
  });
  it('複数容量から選べる商品は最大容量で計算せず判定不能', () => {
    const r = parseQuantity('【選べる容量】柔軟剤 400ml / 1200ml / 2000ml');
    expect(r.totalAmount).toBeNull();
    expect(r.confidence).toBe('unknown');
    expect(r.reasons.join()).toContain('選択');
    expect(r.candidateDimension).toBe('volume');
  });
  it('本体と詰め替えのセットを単純合計しない', () => {
    const r = parseQuantity('食器用洗剤 本体 240ml＋詰め替え 770ml×2');
    expect(r.packageKind).toBe('mixed');
    expect(r.totalAmount).toBeNull();
    expect(r.confidence).toBe('unknown');
  });
  it('商品説明に含まれる別商品の容量は名前に容量がある場合は使わない', () => {
    const r = parseQuantity('柔軟剤 詰め替え 1200ml', '関連商品: 本体 520ml、特大 2000ml もございます');
    expect(r.totalAmount).toBe(1200);
    expect(r.source).toBe('name');
  });
  it('商品説明に容量が複数あれば採用しない', () => {
    const r = parseQuantity('柔軟剤 詰め替え 6袋', '内容量:1200ml。他に本体520mlもあります');
    expect(r.totalAmount).toBeNull();
  });
  it('商品名に容量がなく説明に1つだけあれば「要確認」で採用', () => {
    const r = parseQuantity('柔軟剤 詰め替え 6袋', '内容量:1200ml');
    expect(r.totalAmount).toBe(7200);
    expect(r.confidence).toBe('review');
    expect(r.source).toBe('caption');
  });
  it('香りを抽出する', () => {
    const r = parseQuantity('ソフラン プレミアム消臭 フローラルアロマの香り 詰め替え 1200ml');
    expect(r.variant).toContain('フローラルアロマの香り');
    expect(r.packageKind).toBe('refill');
  });
});

describe('parseQuantity: 表記揺れ・境界値', () => {
  it('全角数字と全角単位', () => {
    const r = parseQuantity('柔軟剤　１２００ｍｌ×６袋');
    expect(r.totalAmount).toBe(7200);
  });
  it('「×6」のみ（単位なし）も個数として扱う', () => {
    expect(parseQuantity('洗剤 1.2L×6').totalAmount).toBe(7200);
  });
  it('「6P」をパック数として扱う', () => {
    expect(parseQuantity('ティッシュ 150組 5P').totalAmount).toBe(750);
  });
  it('括弧内の枚数は組数と別扱い', () => {
    const r = parseQuantity('ティッシュペーパー 150組(300枚)×5箱');
    expect(r.amounts.pairs?.total).toBe(750);
    expect(r.amounts.sheets).toBeUndefined();
  });
  it('重複した個数表記を二重に掛けない', () => {
    expect(parseQuantity('柔軟剤 1200ml×6袋 【6袋セット】').totalAmount).toBe(7200);
  });
  it('合計表記と整合すれば確定', () => {
    const r = parseQuantity('水 500ml×24本 計12L');
    expect(r.totalAmount).toBe(12000);
    expect(r.confidence).toBe('confirmed');
  });
  it('合計表記と矛盾すれば判定不能', () => {
    const r = parseQuantity('水 500ml×24本 計10L');
    expect(r.totalAmount).toBeNull();
  });
  it('大きい方が合計表記の場合（計なし）', () => {
    expect(parseQuantity('水 500ml×24本 12L').totalAmount).toBe(12000);
  });
  it('括弧内のみに容量がある場合は要確認', () => {
    const r = parseQuantity('柔軟剤 詰め替え 6袋 (1200ml)');
    expect(r.totalAmount).toBe(7200);
    expect(r.confidence).toBe('review');
  });
  it('約付きの回数は要確認', () => {
    const r = parseQuantity('携帯トイレ 約50回分');
    expect(r.totalAmount).toBe(50);
    expect(r.confidence).toBe('review');
  });
  it('質量と回数を両方持つ', () => {
    const r = parseQuantity('粉末洗剤 0.9kg 約45回分 ×3個');
    expect(r.dimension).toBe('mass');
    expect(r.amounts.mass?.total).toBe(2700);
    expect(r.amounts.uses?.total).toBe(135);
  });
  it('おむつ 64枚×3パック', () => {
    const r = parseQuantity('紙おむつ テープ Mサイズ 64枚×3パック');
    expect(r.dimension).toBe('sheets');
    expect(r.totalAmount).toBe(192);
  });
  it('空文字・記号のみ', () => {
    expect(parseQuantity('').confidence).toBe('unknown');
    expect(parseQuantity('!!!').totalAmount).toBeNull();
  });
  it('異常に大きいセット数は無視', () => {
    const r = parseQuantity('洗剤 400g×99999個');
    expect(r.totalAmount).toBe(400);
    expect(r.confidence).toBe('review');
  });
  it('個数のみの商品は「要確認」で個数を返す', () => {
    const r = parseQuantity('簡易トイレ 30個入');
    expect(r.dimension).toBeNull();
    expect(r.totalPieces).toBe(30);
    expect(r.confidence).toBe('review');
  });
  it('年式・日付を数量にしない', () => {
    const r = parseQuantity('長期保存水 2026年製造 5年保存 2L×6本');
    expect(r.totalAmount).toBe(12000);
  });
  it('3種セットは個数として扱わない', () => {
    const r = parseQuantity('柔軟剤 3種セット 400ml');
    expect(r.setCount).toBe(1);
  });
  it('倍巻きトイレットペーパー', () => {
    const r = parseQuantity('トイレットペーパー 1.5倍巻き 75m×8ロール');
    expect(r.totalAmount).toBe(600);
  });
});
