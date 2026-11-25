# アーキテクチャ

## 全体構成

```
[ブラウザ（PC / Android / タブレット）]
   │  React SPA（静的アセット）… 設定・履歴・お気に入り・手動補正は localStorage
   │  価格計算・容量解析・ランキングはブラウザ内で実行（APIの再取得なしに即時再計算）
   │
   │ GET /api/search?keyword=…
   ▼
[Cloudflare Access]（推奨: 本人のみログイン可。無料プラン 50 ユーザーまで）
   ▼
[Cloudflare Worker]  src/worker
   ├─ 認証（Access JWT 検証 / 共有トークン / 開発時のみ none）… fail closed
   ├─ 入力検証（shared/validation）
   ├─ クライアント毎の頻度制限（isolate 内 + 任意で Rate Limiting バインディング）
   ├─ 短時間キャッシュ（isolate メモリ → Cache API, 既定 600 秒）
   ├─ 同一検索の同時実行を 1 本化（InflightDeduper）
   └─ 楽天 API クライアント
        ├─ 上流リクエスト間隔 1.1 秒（SpacingQueue）
        ├─ タイムアウト 8 秒、429/5xx/タイムアウトのみ最大 2 回再試行
        └─ レスポンス正規化（mapper）… 不明値は null
   ▼
[楽天市場 商品検索 API]  ※ モックモードでは呼ばず架空データを返す
```

静的アセットは Workers Static Assets から直接配信され、`/api/*` のみ Worker が処理します
（`wrangler.jsonc` の `run_worker_first`）。静的アセットへのリクエストは Workers の課金リクエストに数えられません。

## ディレクトリ

| パス | 内容 |
|---|---|
| `src/shared/types.ts` | 共通型（Product, SearchQuery, SearchResponse 等） |
| `src/shared/normalize.ts` | 表記揺れの正規化 |
| `src/shared/quantity/parser.ts` | 容量・セット個数解析（ルールベース） |
| `src/shared/quantity/categories.ts` | カテゴリと比較単位、次元の選択 |
| `src/shared/pricing/settings.ts` | ユーザー設定・手動補正の型と検証 |
| `src/shared/pricing/engine.ts` | 実質価格計算エンジン |
| `src/shared/ranking.ts` | ランキング・グループ分け・並べ替え |
| `src/shared/validation.ts` | 検索条件の検証（Worker とフロント共通） |
| `src/worker/app.ts` | API ルーター |
| `src/worker/lib/*` | 汎用部品（HTTP 再試行、キャッシュ、頻度制限、認証、エラー） |
| `src/worker/rakuten/*` | 楽天 API 固有（クライアント、マッパー、モック） |
| `src/web/*` | React フロントエンド |
| `tests/unit` | Vitest（解析・計算・ランキング・Worker） |
| `tests/e2e` | Playwright（wrangler dev 上の実 Worker に対する E2E） |

## 設計上の判断

- **計算はブラウザ側**: ポイント設定は個人情報に近く、また設定変更時に API を再取得せず即時再計算するため。
  Worker は「検索結果の正規化済みデータ」だけを返す。
- **D1 は未使用**: 初期版では保存対象がすべて端末内で足りるため。価格監視（Phase 5）で必要になった時点で追加する。
- **生成 AI 不使用**: 容量解析は正規表現・辞書・ルールのみ。`scripts/check-bundle-secrets.mjs` で生成 AI API の参照がないことを検査。
- **モックと実データの分離**: レスポンスに `mode` を必ず含め、画面上部に常時表示。モック商品は全件【サンプル】付き、URL なし。
  `DATA_MODE=live` で認証情報が無い場合はモックに切り替えずエラーにする。
- **汎用部品の分離**: `lib/http.ts`（タイムアウト・再試行）、`lib/cache.ts`、`lib/rateLimit.ts`、`lib/auth.ts` は楽天に依存しない。
  別の情報収集サービス（例: Infra Watch）でも流用できる。
- **ランキングとアフィリエイトの分離**: `affiliateRate` はマッパーで取り込まず、ランキングに影響しない（テストで確認）。

## 技術スタック

TypeScript 6 / React 19 / Vite 8 / Cloudflare Workers（Wrangler 4）/ Vitest 5 / Playwright 1.63 / ESLint 9 + typescript-eslint
（TypeScript 7 は typescript-eslint が未対応のため 6 系を使用）
