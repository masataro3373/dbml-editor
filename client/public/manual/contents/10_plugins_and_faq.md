# 10. プラグイン・ショートカット & FAQ

## 1. プラグインアーキテクチャの概要

DBML Editor v2.0.0 は、標準 DBML モデリングを担う **コア本体** と、各 DBMS 固有の方言・物理属性・DDL 入出力・Excel 設計書連携・マイグレーション SQL 生成を担う **プラグイン (`plugins/`)** を完全分離したアーキテクチャを採用しています。

- **純粋 DBML 標準モード**:
  プラグインを1つも導入していない状態でも、標準 DBML エディタとしてすべての基本モデリング機能が動作します。
- **プラグインによる動的機能拡張**:
  サーバーの `plugins/` ディレクトリにプラグインパッケージ（`.zip`）を配置するだけで、起動時に自動認識され、以下の 5 種類の機能（Capabilities）がシームレスに拡張されます。
  - `🗄️ 方言 (Dialect)`: データ型候補、識別子長・予約語チェック、専用テンプレートの追加
  - `📥 インポート (Importer)`: DBMS 固有 DDL や Excel 設計書（`.xlsx` / `.xlsm`）の取り込み
  - `📤 エクスポート (Exporter)`: DBMS 固有構文・物理属性を含んだ高精度 DDL の出力
  - `🏷️ メタデータ拡張 (Metadata)`: 論理名（`logicalName`）や表領域・ストレージ属性入力フォームの追加
  - `🚀 マイグレーション (Migration)`: DBMS 固有の安全なデータ移行・スキーマ変更 SQL 生成ロジックの提供

---

## 2. 導入済みプラグインの確認と管理方法

### 画面からの確認方法
ヘッダーの **「❓ ヘルプ」→「ℹ️ バージョン情報 (About)」** をクリックすると、「🔌 導入済みプラグイン」一覧が表示されます。
- 各プラグインの **名称・バージョン・提供機能バッジ** と、現在のステータスを確認できます：
  - `✓ 有効 (Active)`: 正常に読み込まれ、機能が利用可能な状態
  - `待機中 (Standby)`: プラグインは配置されているが待機の状態
  - `待機中 (依存欠落)`: 前提となる他のプラグイン（例: `erstudio-excel` に対する `logicalname` 等）が不足している状態
  - `✕ エラー`: パッケージまたは初期化エラーが発生している状態

### プラグインの追加・無効化（サーバー管理者向け）
- **追加・更新**:
  `dbml-editor-v2/plugins/` ディレクトリに対象プラグインの `.zip` ファイル（例: `oracle-dialect-1.0.0.zip`）を配置し、ブラウザをリロード（またはサーバー再起動）します。
- **無効化・削除**:
  `dbml-editor-v2/plugins/` ディレクトリから該当の `.zip` ファイルを削除（または別フォルダへ退避）すると、そのプラグイン機能は切り離されます。

---

## 3. 公式プラグイン一覧（全11種）

### ① 標準・実機検証済みプラグイン（7種）

| プラグインID | 名称 | 主な提供機能 |
| :--- | :--- | :--- |
| **`logicalname`** | 論理名拡張プラグイン | テーブル・カラムの論理名（和名）および属性補足（`columnNote`）の入力フォーム・DBMLインライン属性 `[logicalName: '...']` 連携を提供 |
| **`erstudio-excel`** | ER/Studio Excel 設計書インポーター | ER/Studio 形式等の Excel テーブル定義書（`.xlsx`, `.xlsm`）をシソーラス自動ヘッダー照合で解析し DBML スキーマへ一括変換 |
| **`oracle-dialect`** | Oracle Database 方言プラグイン | Oracle（11g 互換 / 12cR2 以降）のデータ型、表領域（データ / INDEX / LOB）・PCTFREE・INITRANS・LOGGING・COMPRESS 等の物理属性、外付け PK/Unique Index・COMMENT 対応 DDL インポート／エクスポート、6分割データ移行マイグレーション SQL 生成 |
| **`postgres-dialect`** | PostgreSQL 方言プラグイン | PostgreSQL 固有データ型（`SERIAL`, `JSONB`, `UUID` 等）、スキーマ・TABLESPACE・COMMENT 対応 DDL 入出力、PostgreSQL 向けマイグレーション SQL 生成 |
| **`mysql-dialect`** | MySQL / MariaDB 方言プラグイン | MySQL 固有データ型、`AUTO_INCREMENT`、ENGINE / CHARSET / COMMENT 対応 DDL 入出力、MySQL 向けマイグレーション SQL 生成 |
| **`mssql-dialect`** | Microsoft SQL Server 方言プラグイン | SQL Server（T-SQL）固有データ型（`NVARCHAR`, `DATETIME2` 等）、`IDENTITY`、`sp_addextendedproperty` コメント対応 DDL 入出力、マイグレーション SQL 生成 |
| **`spanner-dialect`** | Google Cloud Spanner 方言プラグイン | Cloud Spanner 固有データ型（`STRING`, `INT64`, `ARRAY` 等）、`INTERLEAVE IN PARENT` 親子階層定義、DDL 入出力およびマイグレーション SQL 生成 |

### ② Beta 版プラグイン（4種 / `1.0.0-beta`）

| プラグインID | 名称 | 主な提供機能 |
| :--- | :--- | :--- |
| **`snowflake-dialect`** | Snowflake 方言プラグイン (Beta) | Snowflake 固有型（`VARIANT`, `NUMBER(38,0)`）、`CLUSTER BY`、Transient テーブル等の DDL 入出力・マイグレーション |
| **`bigquery-dialect`** | Google BigQuery 方言プラグイン (Beta) | BigQuery 固有型（`STRING`, `INT64`, `STRUCT`）、`PARTITION BY` / `CLUSTER BY`、`OPTIONS(description=...)` 対応 DDL 入出力・マイグレーション |
| **`redshift-dialect`** | Amazon Redshift 方言プラグイン (Beta) | Redshift 固有属性（`DISTSTYLE`, `DISTKEY`, `SORTKEY`, `ENCODE`）対応の DDL 入出力・マイグレーション |
| **`databricks-dialect`** | Databricks SQL 方言プラグイン (Beta) | Databricks Unity Catalog / Delta Lake 向け型、`USING DELTA`、`TBLPROPERTIES` 対応の DDL 入出力・マイグレーション |

---

## 4. キーボードショートカット & 便利操作一覧

| 操作対象 | ショートカット / 操作 | 動作 |
| :--- | :--- | :--- |
| **DBML参照 / Playground / マイグレーション** | `Ctrl + F`（Mac: `Cmd + F`） | コードエディタ内のテキスト検索バーを開き、一致箇所をハイライト |
| **コード検索バー** | `Enter` / `Shift + Enter` | 次の一致箇所へジャンプ / 前の一致箇所へジャンプ |
| **各種検索ボックス（ツリー・一覧・マニュアル）** | `Esc` キー（または右端の `×`） | 入力中の検索キーワードを即座にクリアして全件表示に戻す |
| **各種モーダルダイアログ** | `Esc` キー | 開いているモーダルをキャンセルして閉じる |
| **新規プロジェクト作成等の入力フォーム** | `Enter` キー | 入力確定・作成実行 |
| **左ペイン（オブジェクトツリー）境界線** | ドラッグ / **ダブルクリック** | ドラッグでツリー幅を自由調整 / **ダブルクリックで初期幅にリセット** |
| **ER図キャンバス** | マウスホイール / 背景ドラッグ | キャンバスの拡大・縮小（ズーム） / 視点移動（パン） |

---

## 5. よくある質問 (FAQ)

### Q1. 画面上に「保存」ボタンが見当たりませんが、編集内容はいつ保存されますか？
**A.** DBML Editor v2.0.0 では、テーブルの保存・削除、スキーマの追加・インポート、ER図の配置変更などを行ったタイミングで、**変更のあったファイルのみを自動検知して即座にサーバーへ差分保存**します。手動で明示的に保存したい場合は、ヘッダーの **「📁 ファイル」→「💾 プロジェクトを保存」** を実行できます。

### Q2. 同じ DDL を2つのスキーマにインポートし、片方のテーブルを編集・削除して比較したとき、未編集のテーブルに差分は出ませんか？
**A.** 出ません。DDL インポート完了時点でも、テーブル編集・削除保存時と全く同じ正規化エンジン（`generateDbml`）を通して DBML が生成・保存されるため、変更していないテーブルの記述は1行の狂いもなく完全一致します。

### Q3. 出力した HTML 仕様書を SharePoint や Microsoft Teams でチーム共有できますか？
**A.** はい、そのまま共有可能です。出力される `.html` ファイル（標準カード形式／検索強化カラムグリッド形式とも）は CSS・検索スクリプト・日英辞書・全10テーマが 1 ファイル内に完全内包されているため、SharePoint 上に配置して Teams のタブ等で開くだけで、専用 Web アプリのように検索・言語切替（JA/EN）・テーマ切替を利用できます。

### Q4. Oracle DDL でカラム定義には `NOT NULL` が無く、後続の `ALTER TABLE ... ADD PRIMARY KEY` で主キー指定されている場合、主キーカラムは `NOT NULL` になりますか？
**A.** はい。Oracle の仕様上、主キーカラムは必ず `NOT NULL` となるため、`CREATE TABLE` 内のインライン `PRIMARY KEY` か後続の `ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY` かを問わず、インポートおよび構文解析時に主キー構成カラムへ自動的に `NOT NULL` が付与・統一されます。
