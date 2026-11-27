# 📦 DBML Editor v2 サンプルデータ集 (`samples/`)

DBML Editor v2 の機能をすぐに体験できる、**5業種 × マルチDBMS（Oracle / PostgreSQL / MySQL）** のサンプルデータ一式です。

エンタープライズ環境でよくある「基幹の販売・生産システムは Oracle、人事システムや決済基盤は PostgreSQL、医療・予約システムは MySQL」といった **分散システムのデータベース設計を1つのプロジェクトで一元管理し、スキーマ横断でER図や仕様書を作成できる** ことを体験いただけます。

---

## 📁 収録ファイル一覧

```text
samples/
├── README.md                                        # 本ガイド
├── sample_project.zip                               # ★【プロジェクトZIP】5業種スキーマ＋ER図を一括復元！
├── ddl/                                             # 【SQL (DDL) インポート用】5業種×3大DBMSのDDL集
│   ├── 01_sales_order_oracle.sql                    #   1. 販売・受注・在庫管理 (Oracle / 8テーブル)
│   ├── 02_manufacturing_bom_oracle.sql              #   2. 生産・製造・BOM・購買管理 (Oracle / 7テーブル)
│   ├── 03_hr_attendance_postgres.sql                #   3. 人事・給与・勤怠管理 (PostgreSQL / 7テーブル)
│   ├── 04_medical_emr_mysql.sql                     #   4. 病院・電子カルテ・予約診療 (MySQL / 8テーブル)
│   └── 05_fintech_wallet_postgres.sql               #   5. 金融・ウォレット決済・複式仕訳 (PostgreSQL / 7テーブル)
├── migration/                                       # 【マイグレーションツール体験用】旧世代DDL
│   └── 01_sales_order_oracle_v0_old.sql             #   販売管理システムの旧バージョンDDL (v0)
└── queries/                                         # 【SQLビジュアライザー体験用】複雑SELECT文サンプル集
    └── sample_visualizer_queries.sql                #   各業種のJOIN / WITH句(CTE) 可視化クエリ集
```

---

## 🚀 体験ウォークスルー

### Step 0: 事前準備（プラグインの導入）
本サンプルの論理名・物理属性・各DBMSのDDLインポート／エクスポートをフル活用するため、`plugins/` フォルダに以下の公式プラグイン（`.zip`）を配置して DBML Editor を起動してください。
- `logicalname-1.0.0.zip`（論理名拡張）
- `oracle-dialect-1.0.0.zip`（Oracle方言）
- `postgres-dialect-1.0.0.zip`（PostgreSQL方言）
- `mysql-dialect-1.0.0.zip`（MySQL方言）

---

### Step 1: 【最速体験】サンプルプロジェクト (`sample_project.zip`) を一括インポートする
まずは完成版のプロジェクトZIPを読み込んで、全5業種のスキーマとER図をすぐに触ってみるのがおすすめです。

1. ヘッダー右上の **「📥 インポート」**（または上部メニュー **「ファイル → インポート...」**）をクリックします。
2. **「プロジェクト (ZIP)」** タブを開きます。
3. 本フォルダ内の **`samples/sample_project.zip`** をドラッグ＆ドロップして **「インポート」** をクリックします。
4. 5つのスキーマ（Oracle / PostgreSQL / MySQL）と作成済みの **ER図** が一括で復元されます！左側のツリーから各スキーマのテーブル一覧や「ER図」をクリックしてご覧ください。

---

### Step 2: 5業種のサンプル DDL を個別にインポートしてみる
生SQL（DDL）からDBMLへ変換・取り込みする機能を試したい場合は、`ddl/` フォルダ内のSQLファイルを使います。

1. 上部メニュー **「ファイル → 新規プロジェクト」** からプロジェクトを作成します。
2. ヘッダー右上の **「📥 インポート」** ボタンをクリックし、**「SQL (DDL)」** タブを開きます。
3. 「新規スキーマとして作成」を選び、以下の組み合わせで5つのDDLをインポートしてみてください。

| 対象DDLファイル | 推奨スキーマ名 | 選択する DatabaseType (DBMS方言) | 見どころ |
| :--- | :--- | :--- | :--- |
| `ddl/01_sales_order_oracle.sql` | `sales_order` | **Oracle (12c+)** | 表領域 (`APP_DATA` / `APP_IDX`)、受注ヘッダ・明細や在庫の複合主キー、`COMMENT ON` からの論理名反映 |
| `ddl/02_manufacturing_bom_oracle.sql` | `manufacturing_bom` | **Oracle (12c+)** | 部品構成表 (`MST_BOM_STRUCTURES`) の親品目×子品目 自己参照リレーション |
| `ddl/03_hr_attendance_postgres.sql` | `hr_attendance` | **PostgreSQL** | 組織階層 (`mst_organizations`) の自己参照、社員×勤務日の複合PK |
| `ddl/04_medical_emr_mysql.sql` | `medical_emr` | **MySQL** | `ENGINE=InnoDB`、インライン `COMMENT` からの論理名抽出、予約→カルテ→処方・会計のリレーション |
| `ddl/05_fintech_wallet_postgres.sql` | `fintech_wallet` | **PostgreSQL** | ウォレット決済トランザクションと複式簿記（仕訳ヘッダ・仕訳明細）の厳格なモデル |

---

### Step 3: HTML データ仕様書を出力してみる
1. ヘッダー右上の **「📤 エクスポート」** を開き、**「HTML仕様書」** タブを選択します。
2. **「標準版（テーブルカード型）」** または **「検索強化版（カラムグリッド型）」** を選んでエクスポートすると、単一HTMLファイルで全テーブル・カラム・制約・インデックスを検索でき、右上のボタンで **日本語 / 英語（JA / EN）** をリアルタイムに切り替えられます。

---

### Step 4: マイグレーションツールで新旧スキーマ差分と移行SQLを体験する
1. `migration/01_sales_order_oracle_v0_old.sql` を別スキーマ（例：`sales_order_v0`）としてインポートし、一度 DBML ファイルとしてエクスポート（またはDBMLプレビューからコピー）しておきます。
2. 上部メニュー **「ツール → マイグレーションツール」** を開きます。
3. **比較元（旧DBML）** に `sales_order_v0` のDBMLを読み込み、**比較先スキーマ** に現行の `sales_order` を選択します。
4. 自動的に以下の差分が検出され、Step 3 で安全な移行SQL（バックアップ作成→テーブル再作成→データコピー→インデックス再作成を含む）が自動生成されます：
   - **新規追加テーブル**: `TRN_SHIPMENTS`（出荷実績）
   - **カラム追加・桁数拡張（ALTER TABLE）**: `MST_PARTNERS`（請求締日の追加・取引先名の桁数80→120拡張）、`TRN_ORDERS`（客先注文番号・希望納期の追加）
   - **カラム縮小に伴うテーブル再作成**: `MST_ITEMS`（単位名の20→10桁への縮小および税率区分カラム追加）

---

### Step 5: SQLビジュアライザーで複雑なJOIN・WITH句を図解する
1. 上部メニュー **「ツール → SQLビジュアライザー」** を開きます。
2. `queries/sample_visualizer_queries.sql` に収録されている5業種それぞれのサンプルSELECT文（WITH句や5〜7テーブルのJOINを含むクエリ）を貼り付け、対応するデフォルトスキーマを選択して **「▶ クエリ解析」** をクリックします。
3. テーブル間の結合条件（INNER / LEFT JOIN）や CTE（WITH句）のデータフローがキャンバス上に自動レイアウトで可視化されます。
