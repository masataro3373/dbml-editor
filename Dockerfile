# 日本語コメント: DBML Editor 本番用コンテナイメージ定義 (マルチステージビルド)
# 軽量かつ最新の Node.js 24 Alpine Linux を採用し、
# クライアントの最適化バンドル (Vite) と Express サーバー単一ポート (3000) 本番配信を実現します。

# ========================================================
# Stage 1: ビルドステージ (フロントエンドの最適化バンドル)
# ========================================================
FROM node:24-alpine AS builder

WORKDIR /app

# パッケージ定義ファイルのコピーと依存関係インストール
COPY package*.json ./
RUN npm ci || npm install

# ソースコード全体をコピーしてフロントエンドを本番ビルド (dist/ の生成)
COPY . .
RUN npm run build

# ========================================================
# Stage 2: 本番実行ステージ (超軽量ランナー)
# ========================================================
FROM node:24-alpine AS runner

WORKDIR /app

# 本番実行環境変数の定義
ENV NODE_ENV=production
ENV PORT=3000

# 本番用依存パッケージのみをインストール (devDependencies 除外でコンテナサイズを極小化)
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# サーバーコード、設定ファイル、プラグインのコピー
COPY server/ ./server/
COPY config/ ./config/
COPY plugins/ ./plugins/

# Stage 1 で生成された静的クライアント成果物 (dist/) のコピー
COPY --from=builder /app/dist ./dist

# 永続化対象ディレクトリ (logs, storage) の初期作成
RUN mkdir -p logs storage

# 公開ポート定義 (3000: Express 単一ポート運用)
EXPOSE 3000

# 本番サーバー起動
CMD ["npm", "start"]
