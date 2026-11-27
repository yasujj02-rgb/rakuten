# 楽天市場商品検索 API の利用メモ

最終確認日: 2026-11-27

## 2026-11-27 時点の状況

- **楽天ウェブサービスの管理画面（UIポータル）は 2026-11-09 からメンテナンスで停止中、復旧時期は未定**（楽天ウェブサービス公式ブログの告知。
  開発環境・ユーザー環境の双方から `webservice.rakuten.co.jp` は HTTP 503）。この間は**新規アプリ登録・アクセスキーの発行ができない**。
  既存アプリによる API 利用は継続できるとされる。
- API 本体（`openapi.rakuten.co.jp`）は応答している。認証情報なしのリクエストで次を確認した:

| 確認内容 | 実際の応答 |
|---|---|
| `GET .../IchibaItem/Search/20260701?keyword=test`（ID なし） | HTTP 400 `{"errors":{"errorCode":400,"errorMessage":"applicationId must be present in the query parameter or request body"}}` |
| 同（ダミーの applicationId のみ） | HTTP 400 `{"errors":{"errorCode":400,"errorMessage":"accessKey must be present as a query parameter or in the header"}}` |

→ **applicationId はクエリ、accessKey はクエリまたはヘッダー**（実装の既定どおり）。エラーは `errors` が**オブジェクト**で `errorCode` が**数値**の形式（パーサー対応済み）。
認証前に弾かれるため、バージョン（`20260701`）・ヘッダー名・Referer 要件は実キーでの接続まで未確認。

## 確認状況（重要）

開発環境から楽天ウェブサービスの公式サイト（`webservice.rakuten.co.jp`）に接続したところ、
**HTTP 503（アクセス集中エラー画面）が返り、公式ドキュメントを直接読めませんでした**。
そのため、以下の仕様は「Web 検索で得た公開情報（開発者ブログ等）」と「2022-06-01 版の既知の仕様」を元にしています。
実際に接続する前に、公式ドキュメントで次の ⚠ 項目を確認してください。

| 項目 | 実装での扱い | 確認状況 |
|---|---|---|
| エンドポイント | `https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701`（`RAKUTEN_ENDPOINT` で変更可能） | ⚠ 2026-07-01 版の存在は楽天ウェブサービス公式ブログの記事タイトル・開発者記事で確認。パスは推定 |
| 認証 | `applicationId` ＋ `accessKey` の両方が必須 | ✅ 2026-11-27 に実 API のエラー応答で確認 |
| accessKey の送り方 | 既定はクエリ `accessKey=`。`RAKUTEN_ACCESS_KEY_TRANSPORT=header` でヘッダー送信に切替 | ✅ クエリまたはヘッダーで受け付けると実 API が応答。⚠ ヘッダー名は未確認 |
| Referer | アプリ登録時の許可サイト URL を `RAKUTEN_REFERER` で送信 | 開発者記事で「Referer が無いと `REQUEST_CONTEXT_BODY_HTTP_REFERRER_MISSING`」との報告。⚠ 公式で再確認 |
| エラー形式 | `{error, error_description}`、`{errors:{errorCode, errorMessage}}`、配列形式のすべてを解析 | ✅ オブジェクト形式・数値コードを実 API で確認 |
| レート制限 | Worker 内で上流リクエストを 1.1 秒間隔に直列化、429 は Retry-After を尊重して最大 2 回再試行 | 「1 秒に 1 回程度」との記述が複数あり。⚠ 公式で再確認 |
| 1 ページの件数 | `hits=30`（最大値） | 2022-06-01 版の仕様 |
| 最大ページ | アプリでは 3 ページ（90 件）まで。API 上限は 100 ページ | 2022-06-01 版の仕様 |

## 使用している入力パラメータ

| パラメータ | 用途 |
|---|---|
| `applicationId`, `accessKey` | 認証（Worker の secret から付与。フロントエンドには出さない） |
| `affiliateId` | `RAKUTEN_AFFILIATE_ID` 設定時のみ。レスポンスの `affiliateUrl` を購入リンクに使用 |
| `format=json`, `formatVersion=2` | 配列形式のレスポンス（v1 形式にもマッパーは対応） |
| `keyword`, `NGKeyword` | キーワード・除外キーワード |
| `minPrice`, `maxPrice` | 価格範囲 |
| `postageFlag=1` | 送料込み（送料無料含む）のみ |
| `availability=1` | 在庫ありのみ（既定） |
| `shopCode` | 店舗指定 |
| `pointRateFlag=1` + `pointRate` | 商品別ポイント倍率 N 倍以上（2〜10） |
| `sort` | `standard` / `+itemPrice` / `-itemPrice` / `-reviewAverage` / `-reviewCount` |
| `hits`, `page` | ページネーション |

## 使用している出力項目と解釈

| 項目 | 解釈 | 注意 |
|---|---|---|
| `itemPrice` | 販売価格 | SKU（容量違い等）がある商品は代表価格の可能性 |
| `taxFlag` | 0=税込 / 1=税別 | 不明時は税込として計算し注記を表示 |
| `postageFlag` | 0=送料込み / 1=送料別 | **送料の金額は取得できない**。送料別は「送料不明」として扱い、送料無料とみなさない |
| `pointRate` | 商品別ポイント倍率 | **通常購入分 1 倍を含む倍率として扱い、加算は (pointRate − 1) 倍**。スーパーDEAL の還元率とは別物として扱う。⚠ 公式で定義を再確認 |
| `pointRateStartTime` / `EndTime` | ポイントアップ期間（JST） | 期間外なら加算しない |
| `availability` | 1=在庫あり / 0=なし | |
| `reviewAverage`, `reviewCount` | レビュー | 件数 0 の平均は「不明」 |
| `itemUrl`, `affiliateUrl` | 購入リンク | `*.rakuten.co.jp` の https のみ許可 |
| `mediumImageUrls` | 画像 | `_ex=300x300` に変更して表示 |
| `itemCaption` | 商品説明 | 商品名に容量がない場合のみ容量解析のフォールバックに使用（信頼度「要確認」）。HTML として表示しない |
| `affiliateRate` | アフィリエイト料率 | **取得しても使用しない**（ランキングに影響させない） |

## API で取得できない情報（手動入力方式）

- 送料の金額（送料別の場合）
- 楽天スーパーDEAL の対象可否・還元率
- 店舗クーポン・楽天クーポン
- 個人の SPU 倍率、買い回り店舗数、キャンペーンのエントリー状況・獲得済みポイント
- ブランド（専用項目なし。推定はしない）

## アプリ登録時の注意（ユーザー作業）

1. 楽天ウェブサービス（Rakuten Developers）でアプリを新規登録し、アプリ ID とアクセスキーを取得する。
2. 「許可されたウェブサイト」等の項目に、デプロイ先 URL（例: `https://netprice-watch.<account>.workers.dev`）を登録する。
   同じ URL を `RAKUTEN_REFERER` に設定する。
3. ⚠ IP アドレス制限の設定がある場合、Cloudflare Workers の送信元 IP は固定されないため、IP 制限は使用できない可能性が高い。
4. アフィリエイト ID は楽天アフィリエイトの管理画面で確認する（任意）。

## キャッシュ・データ保存

- 検索結果は **最大 10 分（`CACHE_TTL_SECONDS`、上限 3600 秒）** の短時間キャッシュのみ（isolate メモリ＋Cloudflare Cache API）。
- 価格の履歴・推移はサーバー・端末のいずれにも保存しない。お気に入りの一括再検索結果は「直近 1 回分」のみ端末内に保存。
- ⚠ 楽天ウェブサービス利用規約のキャッシュ・保存・クレジット表示に関する条項は公式サイトで確認すること。
  価格推移グラフ・長期保存は規約確認まで実装しない（docs/roadmap.md）。
- 画面フッターに「Supported by Rakuten Developers」のクレジットを表示している（⚠ 表示要件は公式で確認）。

## 参考にした公開情報

- 楽天ウェブサービス公式ドキュメント（503 のため未読）: https://webservice.rakuten.co.jp/documentation/ichiba-item-search
- 開発者記事「楽天商品検索 API（2026-07-01 版）に移るときの対処：アクセスキーと Referer が必須、エラーの形式もドキュメントと違う」（poco-tech.blog）
- Qiita「楽天市場APIが2026年に全面刷新されていた — 新認証（applicationId + accessKey + Referer）移行メモ」
- 楽天ウェブサービスブログ（2026-07-07 付で IchibaItem/Search/20260701 リリースの告知）
