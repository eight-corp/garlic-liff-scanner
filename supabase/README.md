# Supabase版 準備手順

このフォルダは、GitHub Pages上の正式版UIから使うSupabase DBを準備・更新するためのものです。

## 1. テーブル作成

Supabaseの対象プロジェクトを開きます。

1. 左メニューの `SQL Editor` を開く
2. `New query` を押す
3. `schema.sql` の内容をすべて貼り付ける
4. `Run` を押す

これでDB版のテーブル、初期マスタ、読み取り用RLSポリシーが作成されます。

## 2. 書き込みRPC作成

Supabase版で登録・入庫・出庫・移動を安全に実行するため、直接テーブルを書かずにRPC関数を使います。

1. 左メニューの `SQL Editor` を開く
2. `New query` を押す
3. `rpc.sql` の内容をすべて貼り付ける
4. `Run` を押す

これで以下のRPCが作成されます。

- `upsert_pallet`
- `delete_pallet_rpc`
- `record_inbound`
- `record_outbound`
- `start_move`
- `complete_move`
- `save_standards`
- `save_coolers`
- `save_location_grid`
- `save_workers`
- `save_app_setting`

マスタ編集を使う場合も、この `rpc.sql` を最新内容で実行してください。
古いRPCのままだと、画面の保存ボタンを押したときに `Could not find the function ...` のようなエラーになります。

## 3. 現在のスプレッドシートデータを反映

`schema.sql` を実行した直後は、作業者などが初期データのままです。
既存のスプレッドシート版に入っている現在のデータへ揃える場合は、次を実行します。

1. 左メニューの `SQL Editor` を開く
2. `New query` を押す
3. `import-current-spreadsheet-data.sql` の内容をすべて貼り付ける
4. `Run` を押す

このSQLはSupabase側のテスト/初期データを消して、現在のスプレッドシートから取得した作業者、規格、冷蔵庫、保管場所、生産者、パレット、配置を入れ直します。
スプレッドシート本体には影響しません。

生産者マスタをExcelから再取り込みする場合は、セルの表示文字列だけを使います。
読み仮名、ふりがな、phonetic情報、rich textの内部情報は生産者名に含めないでください。

既存データの表示名だけを補修する場合は、`fix-producer-display-names.sql` をSupabaseの `SQL Editor` で実行します。

生産者番号は、Excel上の番号をそのまま明細へ保存しません。
A列由来の生産者は `令和年 + 3桁番号` の4桁に変換します。例: 278番を令和8年に登録した場合は `8278`。
D列由来の生産者は `令和年 + 月日 + 2桁番号` の7桁に変換します。例: 01番を令和8年6月15日に登録した場合は `8061501`。
4桁の `YXXX` と7桁の `YMMDDXX` は別々の生産者番号として同時に存在できます。
直接入力時は、4桁ならA列の末尾3桁、7桁ならD列の末尾2桁で生産者名を補足します。

既存SupabaseプロジェクトでA列/D列の区別をDBに持たせる場合は、`producer-number-rules.sql` をSupabaseの `SQL Editor` で実行します。
このSQLを実行すると、生産者マスタは `producer_source` と `producer_no` の組み合わせで管理されるため、A列とD列に同じ番号があっても片方が上書きされません。
D列由来の生産者を追加する場合は、`producer_source` に `D`、`producer_no` にExcel上のD列番号、`producer_name` にE列の表示名を入れてください。
公開用の `publishable key` ではテーブル定義の変更はできないため、既存DBの更新はSupabaseの `SQL Editor` から実行します。

ログイン画面では作業者を選択します。
作業者マスタの備考に `PIN:1234` のように書かれている場合は、そのPINを入力しないとログインできません。
PIN未設定の作業者はログインできません。
一度ログインしたスマホやPCでは、ログイン状態をブラウザ内に保存し、次回以降はログイン画面を省略します。

## 4. 接続確認

GitHub Pagesに反映後、次の確認URLを開きます。

```text
https://eight-corp.github.io/garlic-liff-scanner/supabase/
```

`接続OK` と表示され、作業者が表示されればSupabase接続は成功です。
`RPC状態` が `RPC接続OK` になれば、書き込み用RPCも準備済みです。

正式版アプリ:

```text
https://eight-corp.github.io/garlic-liff-scanner/
```

## 5. 現在の運用への影響

この作業は既存のスプレッドシート本体には影響しません。

正式版:

```text
https://eight-corp.github.io/garlic-liff-scanner/
```

Supabase版準備確認:

```text
https://eight-corp.github.io/garlic-liff-scanner/supabase/
```

## 6. 注意

`publishable key` はブラウザ側に置ける公開キーです。
`secret`、`service_role`、DB password はここに書かないでください。

公開キーでは直接テーブルを書き込めないようにし、登録・入庫・出庫・移動はRPC経由で実行します。
