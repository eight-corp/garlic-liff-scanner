# 資材 在庫管理

GitHub Pagesにそのまま置ける、Supabase直結のスマホ向け在庫管理アプリです。

## 公開URL

```text
https://eight-corp.github.io/garlic-liff-scanner/frozen-ingredient/
```

## できること

- 業務管理メニューと同じ共通ユーザー＋共通PIN方式のログイン
- カテゴリ別の在庫管理: ダンボール、カップ、シール、冷食など
- 保管場所マスタの追加、編集、使用停止
- 品目マスタの追加、編集、使用停止
- 品目マスタで仕入先、品目名、数量単位を直接入力
- 入庫登録: 保管場所、品目、期限/管理日、数量を登録
- 出庫登録: 保管場所と品目から現在庫ロットを選び、数量を登録
- 保管場所別の現在庫一覧
- 品目別の現在庫一覧

にんにく、黒にんにく、米穀は別システムで管理するため、このアプリのカテゴリからは除外します。

## セットアップ

1. 既存または新規のSupabase Projectを用意します。
2. Supabase SQL Editorで `supabase-schema.sql` を実行します。
3. ユーザー管理で対象作業者に `frozen_ingredients` の権限と共通PINを設定します。
4. `config.js` にSupabaseのProject URLとanon keyを入れます。
5. `index.html`, `styles.css`, `app.js`, `config.js` をGitHub Pagesで公開する場所へ置きます。

既に冷食原料版のテーブル作成まで済んでいる場合は、Supabase SQL Editorで `supabase-add-inventory-categories.sql` を実行します。既存の品目と在庫は `冷食` カテゴリへ紐づきます。

## ローカル確認

`config.js` が未設定でも、初回画面でProject URLとanon keyを入力するとブラウザのlocalStorageに保存して接続できます。

## 注意

- anon keyは公開される前提のキーです。service role keyは絶対に入れないでください。
- 実運用では必ず `supabase-schema.sql` のRLSを有効にした状態で使ってください。
- 入出庫はRPC関数で処理しているため、数量更新と履歴記録が同じDB処理内で行われます。
- Supabase Authのメールログインは使いません。業務管理メニューの共通ユーザーと共通PINでログインします。

## 作成されるテーブル

- `inventory_item_categories`: 在庫カテゴリマスタ
- `frozen_ingredient_fridges`: 保管場所マスタ
- `frozen_ingredient_materials`: 品目マスタ
- `frozen_ingredient_stock_lots`: 現在庫ロット
- `frozen_ingredient_stock_movements`: 入出庫履歴

作業者は、にんにく冷蔵庫管理と同じ `workers` テーブルを使います。

品目マスタには `category_id` と `unit_name` があり、カテゴリと `kg`、`袋`、`個` などの単位を管理できます。

入出庫登録用のRPC関数は `frozen_ingredient_record_inbound` と `frozen_ingredient_record_outbound` です。どちらも `p_worker_id` を受け取り、作業者が有効か確認してから登録します。
