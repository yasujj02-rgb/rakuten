# デプロイ手順（Cloudflare Workers）

> 本番デプロイ・一般公開は開発者の承認事項です。以下は手順書であり、まだ実行していません。

## 0. 前提

- Cloudflare アカウント（無料プラン）
- Node.js 22 以上
- `npx wrangler login` でログイン済み

## 1. アクセス制限（必須・デプロイ前に方式を決める）

API は認証方式が設定されていないと全リクエストを拒否します（fail closed）。

### 方式 A: Cloudflare Access（推奨・無料）

1. Cloudflare ダッシュボード → Zero Trust を有効化（Free プラン: 50 ユーザーまで無料）。
2. 初回デプロイ後、Workers & Pages → `netprice-watch` → Settings → Domains & Routes で
   `workers.dev` の「Cloudflare Access」を有効化（または Zero Trust → Access → Applications で Self-hosted アプリを作成）。
3. ポリシー: Include → Emails → 自分のメールアドレスのみ。
4. アプリケーションの **Application Audience (AUD) Tag** と **チームドメイン**（例: `myteam.cloudflareaccess.com`）を控える。
5. `wrangler.jsonc` の `vars` に設定:
   ```jsonc
   "AUTH_MODE": "access",
   "ACCESS_TEAM_DOMAIN": "myteam.cloudflareaccess.com",
   "ACCESS_AUD": "<AUD タグ>"
   ```
   Worker 側でも `Cf-Access-Jwt-Assertion` の署名・aud・iss・有効期限を検証するため、Access をすり抜けた直接アクセスも拒否されます。

### 方式 B: 共有トークン

```bash
npx wrangler secret put APP_ACCESS_TOKEN
```
（16 文字以上のランダム値。例: `openssl rand -base64 32`）
`wrangler.jsonc` で `"AUTH_MODE": "token"`。ブラウザの「設定 → アクセストークン」に同じ値を入力します。
静的画面（データなし）は誰でも表示できますが、API はトークンが無いと 401 になります。

## 2. 楽天 API の認証情報（secret）

```bash
npx wrangler secret put RAKUTEN_APPLICATION_ID
npx wrangler secret put RAKUTEN_ACCESS_KEY
npx wrangler secret put RAKUTEN_AFFILIATE_ID   # 任意（アフィリエイト運用開始は承認事項）
```

`wrangler.jsonc` の `RAKUTEN_REFERER` に、楽天のアプリ登録で許可したサイト URL（デプロイ先 URL）を設定します。
未設定の間は `DATA_MODE=auto` によりモックモードで動作します（画面に「モックモード」と表示）。

## 3. デプロイ

```bash
npm ci
npm run check     # 型・Lint・単体・ビルド・E2E・秘密情報チェック
npm run deploy    # = vite build && wrangler deploy
```

## 4. 確認

- `https://netprice-watch.<account>.workers.dev/` にアクセスし、Access のログイン画面が出ること
- ログイン後、画面上部に「楽天市場 商品検索API（実データ）」と表示されること
- 別ブラウザ（未ログイン）で `/api/search?keyword=test` が 401/302 になること

## 5. 任意: Workers Rate Limiting

`wrangler.jsonc` のコメントを外して `RATE_LIMITER` バインディングを有効化すると、isolate を跨いだ頻度制限が加わります。

## 無料枠と想定運営費（2026-11 時点の公開情報。⚠ 料金ページで再確認）

| 項目 | 無料枠 | 本アプリの想定使用量（個人利用） |
|---|---|---|
| Workers リクエスト | 100,000 / 日 | 検索 1 回 = 1 リクエスト（静的アセットは対象外）。1 日数十〜数百 |
| Workers CPU | 10ms / リクエスト | 正規化処理のみ（計算はブラウザ側）。数 ms 程度 |
| Workers Static Assets | 無料・無制限 | 約 300KB |
| Cache API | 無料 | 検索結果 JSON のみ |
| Cloudflare Access | 50 ユーザーまで無料 | 1 ユーザー |
| 楽天ウェブサービス | 無料 | 1 検索 = 1〜3 API コール |
| 生成 AI API | 不使用 | 0 円 |

**想定運営費: 月額 0 円**（独自ドメインを使う場合のみドメイン代が別途必要）。

## ロールバック

```bash
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```
