# 06. インポート機能（DDL・Excel・DBML）

## 1. インポートダイアログの起動と取込先スキーマ指定

ヘッダーの **「📁 ファイル」→「📥 インポート...」** をクリックすると、インポートモーダルが開きます。

### 取込先スキーマの選択（既存スキーマ or 新規スキーマ同時作成）
SQL DDL、Excel 設計書、DBML ファイルをインポートする際は、モーダル上部の **「取込先スキーマ」** で以下のいずれかを選択できます。

1. **既存のスキーマを選択**:
   現在プロジェクト内に存在するスキーマを選択して取り込みます。
2. **「＋ 新規スキーマを作成してインポート」を選択**:
   あらかじめ空のスキーマを手動作成しておく必要はありません。インポート画面上で **新しいスキーマ名** を入力するだけで、選択したインポート形式（Oracle DDL なら Oracle 方言、PostgreSQL DDL なら PostgreSQL 方言など）に合わせた新規スキーマが自動作成され、そのまま取り込みと正規化保存まで一括で完了します。

---

## 2. 対応インポート形式の詳細

### ① SQL DDL インポート
既存のデータベースからダンプした `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` / `COMMENT ON` 等の SQL スクリプト（`.sql` / `.ddl` ファイル、またはテキスト直接貼り付け）を解析し、DBML モデルへ自動変換します。

- **対応方言**:
  導入済みの Dialect プラグイン（Oracle Database、PostgreSQL、MySQL / MariaDB、SQL Server、Cloud Spanner、Snowflake、BigQuery、Redshift、Databricks）および標準 SQL に対応しています。
- **Oracle DDL (`oracle-dialect`) の高度な解析機能**:
  - **物理属性・表領域の自動抽出**: `TABLESPACE`, `STORAGE (INITIAL / NEXT)`, `PCTFREE`, `PCTUSED`, `INITRANS`, `MAXTRANS`, `LOGGING / NOLOGGING`, `COMPRESS / NOCOMPRESS`, `LOB (...) STORE AS (TABLESPACE ...)`、`USING INDEX TABLESPACE` などを自動抽出し、スキーマの表領域候補リストおよび各テーブルの `Metadata Table` に保持します。
  - **外付け主キー・インデックスの自動統合**: `CREATE TABLE` 後に記述された `CREATE UNIQUE INDEX ... COMPUTE STATISTICS` や `ALTER TABLE ... ADD CONSTRAINT ... PRIMARY KEY (...) USING INDEX ... ENABLE` を正確に解析し、主キーカラムへの `NOT NULL` 自動補完および重複ユニークインデックスの整理を行います。
  - **論理名の自動抽出**: `COMMENT ON TABLE` および `COMMENT ON COLUMN` からテーブル論理名・カラム論理名を抽出し、`[logicalName: '...']` として反映します。
- **インポート完了時の自動正規化**:
  インポート完了時に内部モデルから正規化 DBML（`generateDbml`）が自動生成・保存されるため、インポート直後のスキーマと後から画面でテーブル編集・削除を行ったスキーマの間でフォーマット差異（不要な誤差分）が発生しません。

### ② Excel 設計書インポート（ER/Studio 形式対応）
`erstudio-excel` プラグインが有効な場合、Excel 形式（`.xlsx`, `.xlsm`）のテーブル定義書を取り込めます。

- **柔軟なヘッダー自動認識（シソーラス照合）**:
  シート内のヘッダー行を自動スキャンし、プロジェクトや版によって微妙に異なる列名（例: `エンティティ論理名` / `テーブル和名`、`属性物理名` / `カラム名`、`データ型`、`長さ` / `桁数`、`精度`、`NULL許可` / `NOT NULL`、`初期値` / `DEFAULT`、`備考` 等）を自動マッピングして取り込みます。
- 複数シートにまたがるテーブル定義や外部キー制約、表領域情報も一括で抽出されます。

### ③ DBML ファイル (`.dbml`) インポート
- 既存の `.dbml` ファイルを読み込み、新規スキーマまたは選択中スキーマへ反映します。
- 標準 DBML 構文に加え、`[logicalName: '...']` インライン属性や `Metadata Table` ブロック、旧バージョンの `<!-- custom {...} -->` 形式ノートメタデータも後方互換で自動的に読み取ります。

### ④ ER図 (`.json`) インポート
- エクスポートした ER図レイアウト JSON ファイルを読み込み、テーブルの配置座標、メモ付箋、グループ枠、表示設定をプロジェクト内に復元・追加します。

### ⑤ プロジェクト一括 (`.zip`) インポート
- 本ツールからエクスポートしたプロジェクトアーカイブ（`.zip`）をアップロードし、全スキーマ（`.dbml`）、全 ER図（`.json`）、およびプロジェクト設定（`project.json`）を丸ごと一括復元します。
