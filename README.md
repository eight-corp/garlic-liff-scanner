# にんにく冷蔵庫管理

このリポジトリの正式版は、GitHub Pages上のUIとSupabase DBを使う方式です。

## 注文管理

`orders/` は共通ログインで利用する部署別の注文・承認・進捗・分納管理です。
業務管理メニューの旧「黒にんにく出荷管理」と同じアプリ権限IDを使います。

- 初回は共通認証スキーマの導入後、`orders/schema.sql` をSupabaseに適用します。再適用可能です。
- ユーザー情報の「注文管理」で利用権限を設定します。商品・取引先・配送業者のマスタ編集は同アプリの管理者のみです。
- 注文の確定・差戻し・取消、出荷の取消には「注文承認」のチェックと、注文管理の作業者以上の権限が両方必要です。管理者にも自動付与しません。
- 商品には乾燥にんにく・黒にんにく・にんにく加工品の部署を設定します。注文は部署ごとに登録します。マスタの初期データは空です。
- 出荷準備完了の明細を分納でき、未出荷残数を超える出荷は禁止します。取消履歴は残します。在庫管理とは連動しません。
- 変更は4秒ごとに共通認証付きRPCで検出します。未保存の入力は保持し、競合した保存は拒否します。
- ローカル検証は `orders/` で `npm ci`、`npm test`、`npm run test:browser`、`node tests/account.browser.mjs`。ブラウザーテストにはChromeが必要です。外部通信は遮断し、PGlite内でのみ業務データを変更します。

## 正式版

```text
https://eight-corp.github.io/garlic-liff-scanner/
```

## Supabase確認ページ

```text
https://eight-corp.github.io/garlic-liff-scanner/supabase/
```

## 資材 在庫管理

```text
https://eight-corp.github.io/garlic-liff-scanner/frozen-ingredient/
```
