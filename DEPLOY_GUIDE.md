# DBML Editor デプロイ ＆ 運用手順書

本書は、DBML Editor のデプロイパッケージ生成から Docker 環境への構築、プラグインの導入・更新、およびユーザーメンテナンスまでの手順をまとめたガイドです。

---

## 1. デプロイ用パッケージの生成（ビルド元環境）

アプリ本体とプラグインは別々にビルド・管理されます。本体のデプロイパッケージには、ビルド・実行に必要最小限のファイルのみが含まれます。

```powershell
npm --prefix dbml-editor-v2 run pack:deploy
```

- 親ディレクトリに `dbml-editor-2.0.0.zip`（DEFLATE 圧縮済み）が出力され、自動で整合性検証が実行されます。
- `node_modules/`、`dist/`、`logs/`、`storage/`、`scripts/`、`tests/`、`samples/`、`plugins/*.zip` は除外され、運用ガイド・ライセンス文書（`README.md`, `DEPLOY_GUIDE.md`, `SERVER_ADMIN_GUIDE.md`, `LICENSE.md`, `THIRD_PARTY_LICENSES.md`）が同梱されます。

---

## 2. サーバーへの配置・初回起動（Docker 環境）

### 2.1. パッケージの転送と解凍
```bash
# サーバーへ ZIP を転送
scp dbml-editor-2.0.0.zip <user>@<server-host>:/opt/

# サーバー上で解凍
cd /opt
unzip dbml-editor-2.0.0.zip
cd dbml-editor
```

### 2.2. （任意）プラグインの事前配置
別途ビルドしたプラグイン（例: `oracle-dialect-1.0.0.zip`, `erstudio-excel-1.0.0.zip`）を導入する場合は、`plugins/` ディレクトリへコピーします。
（プラグインを導入しない場合は、そのまま純粋な DBML 標準モードで起動します）

```bash
cp /path/to/oracle-dialect-1.0.0.zip ./plugins/
cp /path/to/erstudio-excel-1.0.0.zip ./plugins/
```

### 2.3. Docker イメージのビルドと起動
```bash
docker compose build
docker compose up -d
```

起動確認（ログ確認）:
```bash
docker compose logs -f dbml-editor
```
ブラウザで `http://<server-host>:3000` にアクセスできることを確認してください。

---

## 3. プラグインの新規追加・更新・削除（Docker 再ビルド手順）

Docker 環境ではプラグインはコンテナイメージ内に組み込まれるため、プラグインの追加・更新・無効化・削除を行う際は **Docker イメージの再ビルドとコンテナ再作成** を行います。

### 3.1. プラグインの追加・更新
```bash
cd /opt/dbml-editor

# 新しいプラグイン .zip を plugins/ に配置（または上書き）
cp /path/to/new-plugin.zip ./plugins/

# イメージ再ビルド＆コンテナ再起動
docker compose build
docker compose up -d
```

### 3.2. プラグインの無効化・削除
```bash
cd /opt/dbml-editor

# 一時無効化する場合（拡張子を .zip 以外へ変更）
mv ./plugins/oracle-dialect-1.0.0.zip ./plugins/oracle-dialect-1.0.0.zip.disabled

# 完全に削除する場合
rm ./plugins/oracle-dialect-1.0.0.zip

# イメージ再ビルド＆コンテナ再起動
docker compose build
docker compose up -d
```

※ `storage/` と `logs/` はホスト側にボリュームマウント（`./storage:/app/storage`, `./logs:/app/logs`）されているため、再ビルド・再起動を行ってもユーザーデータや保存済みプロジェクトは消えません。

---

## 4. ユーザーメンテナンス手順

ローカル認証（`authMode: "local"`）のユーザー情報は `storage/conf/users.json` で管理されています。
付属の CLI スクリプト `server/scripts/manage-users.js` を使用して、**コンテナを起動したまま**ユーザーの追加・削除・パスワード変更が行えます（コンテナの再起動は不要です）。

### 4.1. コマンド一覧（Docker コンテナ内で実行する場合）

#### ユーザー一覧の確認
```bash
docker compose exec dbml-editor node server/scripts/manage-users.js list
```
（※ 初回起動直後はデフォルトユーザー `user1` / パスワード `password` が作成されています。運用開始時はパスワード変更または別ユーザー作成を推奨します）

#### ユーザーの追加
```bash
# 書式: add <username> <password> [表示名]
docker compose exec dbml-editor node server/scripts/manage-users.js add tanaka Pass1234 "田中 太郎"
```

#### パスワードの変更
```bash
# 書式: passwd <username> <newPassword>
docker compose exec dbml-editor node server/scripts/manage-users.js passwd tanaka NewPass5678
```

#### ユーザーの削除
```bash
# 認証アカウントのみ削除（作成済みプロジェクトデータは保護のため残す）
docker compose exec dbml-editor node server/scripts/manage-users.js delete tanaka

# ユーザーの保存データ (storage/users/<userId>) も完全に削除する場合
docker compose exec dbml-editor node server/scripts/manage-users.js delete tanaka --with-storage
```

### 4.2. ホスト側 / 開発環境で直接実行する場合
Node.js が導入されている環境では、コンテナを介さず直接実行することもできます。

```powershell
# 一覧表示
npm --prefix dbml-editor-v2 run user:manage -- list

# ユーザー追加
npm --prefix dbml-editor-v2 run user:manage -- add tanaka Pass1234 "田中 太郎"

# パスワード変更
npm --prefix dbml-editor-v2 run user:manage -- passwd tanaka NewPass5678

# ユーザー削除
npm --prefix dbml-editor-v2 run user:manage -- delete tanaka
```

---

## 5. 永続化データとバックアップ
Docker Compose 構成では、以下のディレクトリがホスト側に永続化されます。定期的なバックアップはこれらを対象としてください。

- `./storage/`: ユーザー設定（`storage/conf/users.json`）および各ユーザーのプロジェクトデータ（`storage/users/`）
- `./logs/`: サーバーログ・クライアントエラーログ
