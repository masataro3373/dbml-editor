// 日本語コメント: Vite 開発サーバー設定 (vite.config.js)
// セキュリティ向上のため root を 'client' ディレクトリに隔離し、
// プロジェクトルートの重要ファイル (Dockerfile, server/, config/ 等) が外部公開されないように保護します。
// バックエンド API (/api/*) へのリクエストは Express サーバー (3000 ポート) へプロキシします。

import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: '../dist',
    sourcemap: true,
  },
});
