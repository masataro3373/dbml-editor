# DBML Editor

DBML（Database Markup Language）構文を核とした、高機能で拡張性に優れた次世代データベースモデリング・設計支援エディタです。
直感的なビジュアルモデリング（テーブルエディタ / ER図）とリアルタイム DBML プレビュー（CodeMirror 6）を備え、物理名・論理名の完全なネイティブ対応、プラグイン拡張アーキテクチャ、Excel 設計書（ER/Studio 形式対応）の高精度インポート、各種 RDBMS・クラウド DWH 向け DDL 生成および差分マイグレーション SQL 生成を提供します。

---

## 📁 ディレクトリ構造

```
dbml-editor-v2/
├── client/                     # フロントエンドソースコード (Vite ルート)
│   ├── index.html              # SPA エントリポイント
│   └── src/
│       ├── main.js             # アプリケーション起動・オーケストレーター
│       ├── core/               # 状態管理 (store), 通信, プラグイン, テーマ管理
│       ├── components/         # UI コンポーネント群 (WebComponent / Vanilla JS)
│       │   ├── header/         # ヘッダーペイン（メニュー、ユーザー情報、テーマ切替）
│       │   ├── footer/         # フッターペイン（ステータス、ショートカット）
│       │   ├── object-tree/    # 左ペイン: スキーマ・テーブル・ERD ツリービュー
│       │   ├── table-editor/   # テーブル編集画面（カラム、型、PK/FK、制約、メタデータ）
│       │   ├── table-view/     # テーブル詳細参照ビュー
│       │   ├── table-list/     # スキーマ内テーブル一覧ビュー
│       │   ├── erd-view/       # ER図（実体関連図）キャンバス (SVG/Canvas)
│       │   ├── dbml-preview/   # CodeMirror 6 DBML コードプレビュー
│       │   ├── import-modal/   # 各種設計書・DDL インポートダイアログ
│       │   └── export-modal/   # DDL・仕様書・プロジェクトエクスポートダイアログ
│       ├── dialects/           # ビルトイン方言マネージャー
│       └── styles/             # デザインシステム・トークン・テーマ定義 (CSS)
├── server/                     # バックエンドソースコード (Node.js / Express v5)
│   ├── app.js                  # サーバーエントリポイント (REST API & 静的 SPA 配信)
│   ├── routes/                 # API ルーティング (auth, project, plugins, export, logs)
│   └── services/               # プラグインロード、プロジェクト永続化、認証ロジック
├── plugins/                    # 動的ロード対象のプラグインパッケージ (*.zip)
├── samples/                    # すぐに体験できる5業種マルチDBMSサンプルプロジェクト・DDL・クエリ集
│   ├── sample_project.zip      #   完成版サンプルプロジェクト (5スキーマ＋ER図一括復元用)
│   ├── ddl/                    #   業種別サンプルDDL (Oracle / PostgreSQL / MySQL)
│   ├── migration/              #   マイグレーション差分比較体験用 旧版DDL
│   └── queries/                #   SQLビジュアライザー体験用 サンプルクエリ集
├── scripts/                    # 保守・デプロイ用スクリプトディレクトリ
│   ├── create-deploy-zip.js    # 純 Node.js による本番配布用 ZIP パッケージャー
│   └── generate-licenses.js    # サードパーティライセンス一覧自動生成ツール
├── storage/                    # 永続データディレクトリ（非公開）
│   ├── projects/               # ユーザー／プロジェクト別 DBML データ
│   └── settings.json           # アプリケーション共通設定ファイル
├── logs/                       # サーバー／クライアント日次ローテーションログ
├── Dockerfile                  # マルチステージビルド (node:24-alpine)
├── docker-compose.yml          # 本番コンテナ起動構成 (ポート 3000 単一公開)
├── package.json                # プロジェクト定義および依存関係
└── README.md                   # 本ドキュメント
```

---

## ✨ 主要な特徴と機能

### 1. 直感的なビジュアルモデリングとリアルタイム DBML 生成
* **ビジュアル編集とリアルタイム DBML プレビュー**:
  直感的なテーブルエディタや ER 図での編集内容から、CodeMirror 6 による DBML コードプレビューをリアルタイムに生成・表示します（Playground では DBML コードの直接記述・確認も可能です）。
* **物理名／論理名（和名）の完全分離とネイティブ対応**:
  DBML 標準構文を崩すことなく、拡張構文（`Metadata Column`, `Metadata Table`）を採用。カラム・テーブルの論理名、定義、業務ノート、ドメイン名を正確に保持・編集できます。

### 2. プラグイン拡張アーキテクチャ (`plugins/`)
コア機能と方言・インポート・エクスポート機能を分離し、プラグイン ZIP を `plugins/` ディレクトリに配置するだけで動的に機能拡張できます。
* **Dialect プラグイン**:
  PostgreSQL、MySQL、SQL Server、Oracle、Google Cloud Spanner、およびクラウド DWH 系 Beta 方言（Snowflake / BigQuery / Redshift / Databricks）固有の物理属性、DDL 生成・解析、差分マイグレーション SQL 生成を担当。
* **Importer プラグイン**:
  ER/Studio などの Excel 設計書（.xlsx, .xlsm）や既存 DDL からのシソーラス自動マッピングによるモデル取り込み。
* **Exporter プラグイン**:
  DDL スクリプト、差分マイグレーション SQL、各種言語モデル（Java Model/VO 等）の柔軟な出力。

### 3. 高精度 Excel 設計書インポート（ER/Studio 形式対応）
* チームやバージョンによってフォーマットの異なる Excel 設計書を柔軟に解析。
* ヘッダー文字列の正規化と自動シソーラス照合により、列順序のズレや余白を自動吸収し、テーブル論理名、カラム物理名、論理名、データ型、精度、デフォルト値/デフォルト名、外部キー参照を 100% 正確に抽出します。

### 4. リッチな ER 図（実体関連図）キャンバス
* **Crow's foot 記法**: テーブル間のリレーションを直感的なカラスの足（多重度）記法で可視化。
* **配置・座標の自動保存**: ドラッグ＆ドロップによる自由な配置、自動整列、テーブルヘッダカラー設定（プリセットパレット・カラーフィルタ対応）、スキーマ別グループカラー、ズーム・パン、ミニマップに対応。
* **画像出力**: PNG / SVG による設計図の即時エクスポート（ヘッダカラー・スキーマ名表示対応）。

### 5. プロダクション・シングルポート配信
* Express v5 と Vite の融合により、本番環境ではポート `3000` のみで SPA クライアント（静的アセット）と REST API を同時にホスティング。
* リバースプロキシの設定やポート管理の負担を最小限に抑えます。

---

## 🛠️ 技術スタック

* **フロントエンド**:
  * `Vanilla JS (ES Modules)` / `Web Components`
  * `Vite 8` (超高速フロントエンドツール)
  * `CodeMirror 6` + `Lezer` (次世代コードエディタ)
  * CSS Custom Properties (Design Tokens, Light / Dark / Sepia 等 10種類のテーマ対応)
* **バックエンド**:
  * `Node.js >= 22.0.0` (推奨 24.x LTS)
  * `Express 5.3` (次世代 Web フレームワーク)
  * `express-session` (セッション管理)
  * `@dbml/core 13.0.0` (DBML 構文解析・シリアライズ)
  * `node-sql-parser` (SQL 構文解析)
  * `xlsx (SheetJS)` (Excel 設計書バイナリ解析)
* **コンテナ & インフラ**:
  * `Docker` & `Docker Compose`
  * `Alpine Linux 3.20` (`node:24-alpine`) による軽量・セキュアなコンテナイメージ

---

## 🚀 開発環境のセットアップと起動手順

### 1. 依存パッケージのインストール
```bash
npm install
```

### 2. 開発サーバーの起動 (同時起動)
```bash
npm run dev
```
* **クライアント (Vite)**: [http://localhost:5173](http://localhost:5173) （HMR 有効）
* **バックエンド (Express)**: [http://localhost:3000](http://localhost:3000) （API サーバー）
* *※ Vite から Express API へのプロキシが自動構成されます。ブラウザからは `http://localhost:5173` にアクセスしてください。*

---

## 🎁 同梱サンプル (`samples/`) で今すぐ体験

初めて DBML Editor を触る方向けに、`samples/` ディレクトリ配下に **5業種 × マルチDBMS（Oracle / PostgreSQL / MySQL）** のサンプルデータ一式を同梱しています。

1. **完成版プロジェクトの一括インポート (`samples/sample_project.zip`)**:
   * 画面右上の **「📥 インポート → プロジェクト (ZIP)」** から `samples/sample_project.zip` を読み込むだけで、販売管理（Oracle）・生産BOM管理（Oracle）・人事勤怠（PostgreSQL）・電子カルテ（MySQL）・金融ウォレット仕訳（PostgreSQL）の5スキーマと作成済み **ER図** を即座に体験できます。
2. **業種別 DDL / マイグレーション / SQLビジュアライザー体験**:
   * `samples/ddl/`（5業種の生DDL）、`samples/migration/`（新旧スキーマ差分比較用）、`samples/queries/`（複雑JOIN/CTE可視化クエリ）も収録しています。詳しくは [samples/README.md](samples/README.md) をご覧ください。

---

## 🔌 プラグインの開発とビルド・デプロイ

プラグインは `dbml-editor-plugin` ディレクトリ配下で個別に開発・ビルドします。

```bash
# 1. 特定のプラグインをビルド (例: erstudio-excel)
node dbml-editor-plugin/scripts/build.mjs erstudio-excel

# 2. エディタ本体の plugins/ フォルダへデプロイ
node dbml-editor-plugin/scripts/deploy.mjs erstudio-excel

# 全プラグインを一括ビルド＆デプロイする場合
node dbml-editor-plugin/scripts/build.mjs
node dbml-editor-plugin/scripts/deploy.mjs
```

### 現在同梱されている公式プラグイン（全11種）
#### 標準・実機検証済みプラグイン（7種）
1. **`logicalname`**: DBML 内の論理名・メタデータ編集および多言語 i18n 表示拡張
2. **`erstudio-excel`**: ER/Studio 形式 Excel 設計書 (.xlsx, .xlsm) のインポートプラグイン
3. **`postgres-dialect`**: PostgreSQL 向け DDL 入出力・差分マイグレーション方言プラグイン
4. **`mysql-dialect`**: MySQL 向け DDL 入出力・差分マイグレーション方言プラグイン
5. **`mssql-dialect`**: Microsoft SQL Server 向け DDL 入出力・差分マイグレーション方言プラグイン
6. **`oracle-dialect`**: Oracle Database 向け表領域・制約・DDL エクスポート・差分マイグレーション方言プラグイン
7. **`spanner-dialect`**: Google Cloud Spanner 向け DDL 入出力・差分マイグレーション方言プラグイン

#### Beta 版プラグイン（4種 / `1.0.0-beta`）
8. **`snowflake-dialect`**: Snowflake 向け DDL 入出力・差分マイグレーション方言プラグイン（Beta）
9. **`bigquery-dialect`**: Google BigQuery 向け DDL 入出力・差分マイグレーション方言プラグイン（Beta）
10. **`redshift-dialect`**: Amazon Redshift 向け DDL 入出力・差分マイグレーション方言プラグイン（Beta）
11. **`databricks-dialect`**: Databricks SQL 向け DDL 入出力・差分マイグレーション方言プラグイン（Beta）

---

## 🐳 本番環境へのデプロイ手順

### 1. Docker Compose によるコンテナ起動 (推奨)
マルチステージビルドにより、ビルド用依存関係を含まない最小サイズの Alpine 本番イメージが構築されます。

```bash
# ビルドおよびバックグラウンド起動
docker compose up -d --build

# ログの確認
docker compose logs -f

# 停止
docker compose down
```
起動完了後、ブラウザで [http://localhost:3000](http://localhost:3000)（または VPC サーバー IP）にアクセスします。

### 2. オフライン配布パッケージ (ZIP) の生成
本番サーバーがインターネットから隔離されている場合や、ZIP 配布を行う場合は以下のコマンドを実行します。

```bash
npm run pack:deploy
```
* ルート直下にプラグイン一式同梱の `dbml-editor-2.0.0.zip` が純 Node.js（OS依存なし）で自動生成されます。
* 展開後、対象サーバーで `npm ci --omit=dev` および `npm start` を実行するだけで即座に稼働します。

### 3. スタンドアロン起動 (Node.js 直接実行)
```bash
# クライアントのプロダクションビルド (dist/ 生成)
npm run build

# 本番サーバーの単一ポート起動
npm start
```

---

## 🤝 コントリビューション・開発参加について (Contributing & Contact)

### 🇯🇵 日本語 (Primary Language)
本プロジェクトは日本語をメイン言語として開発・運営しています。将来的にこのツールを一緒に育ててくださる開発仲間が集まってくれたら嬉しく思います！

* **コンタクト・開発参加のご相談は歓迎です**:
  「一緒に開発に参加したい」「新しいプラグインや改善案を相談したい」といったご連絡は大歓迎です。作業に着手される前に、まずは Issue または Discussions でお気軽にコンタクトしてください。
* **お願いとご注意**:
  * **事前相談のない突然の Pull Request**（「勝手に直しました！」等のコード送信）はマージいたしかねます。必ず事前に方針をご相談ください。
  * 本ツールは無償で公開しているプロジェクトであり、サポート窓口ではありません。**「あれを直せ」「この機能を追加しろ」といった一方的な要求・要望には対応いたしかねます**ので、あらかじめご了承ください。

### 🌐 English
Please note that **Japanese is the primary language** used for the development, documentation, and communication of this project.

* **Contact & Collaboration Welcome**:
  We welcome developers who are interested in collaborating and growing this tool together! If you would like to contribute or discuss ideas, please **contact us first** via Issues or Discussions before writing or submitting any code.
* **Important Guidelines**:
  * **Unsolicited Pull Requests without prior discussion/agreement will not be accepted.** Please reach out and align on the design before submitting a PR.
  * This software is provided "as-is" without official support obligations. **We do not accept one-sided feature demands or fix requests.** Thank you for your understanding.

---

> ※ 本ツール（DBML Editor v2）は `@dbml/core`（dbml/core）を開発・提供するプロジェクトとは一切関係のない、独立したツールです。  
> ※ 本ドキュメントに記載されている製品名・サービス名（Oracle、ER/Studio、SQL Server、Google Cloud Spanner、Snowflake、BigQuery、Redshift、Databricks 等）は各社の商標または登録商標であり、本ツールはこれらの開発元・提供元と提携・承認関係にあるものではありません。

*Developed with 💛 in partnership with Antigravity, Gemini & Copilot*
