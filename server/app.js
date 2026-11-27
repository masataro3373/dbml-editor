// 日本語コメント: Express サーバーエントリポイント (server/app.js)
// バックエンド API (/api/auth, /api/logs, /api/parse, /api/plugins 等) の提供、
// および本番用フロントエンド静的ファイル (dist/) の配信と SPA フォールバックルーティングを制御します。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import { serverLogger } from './logger.js';
import { configService } from './services/config-service.js';
import logsRouter from './routes/logs.js';
import authRouter from './routes/auth.js';
import parseRouter from './routes/parse.js';
import projectRouter from './routes/project.js';
import configRouter from './routes/config.js';
import pluginsRouter from './routes/plugins.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serverConfig = configService.getServerConfig();
// 環境変数 PORT を最優先（Docker/クラウド実行環境向け）、未指定時は設定ファイルまたはデフォルト 3000
const PORT = process.env.PORT || serverConfig.port || 3000;
const app = express();

// CORS 設定 (本番時は明示されたオリジンのみ許可し、未設定時は別オリジンからのアクセスを拒否)
const configuredOrigins = Array.isArray(serverConfig.corsOrigins) ? serverConfig.corsOrigins : [];
const isProduction = process.env.NODE_ENV === 'production';
app.use(cors({
  origin(origin, callback) {
    // 同一オリジンや curl 等 (Origin ヘッダなし) は許可
    if (!origin) return callback(null, true);
    if (configuredOrigins.includes('*') || configuredOrigins.includes(origin)) {
      return callback(null, true);
    }
    if (!isProduction && configuredOrigins.length === 0) {
      return callback(null, true);
    }
    return callback(null, false);
  },
  credentials: true,
}));

// ボディパーサー (大規模DBMLテキスト受信のため 50MB 制限)
app.use(express.json({ limit: '50mb' }));
app.use(express.text({ limit: '50mb' }));

// セッション設定
const DEFAULT_SESSION_SECRET = 'dbml-editor-v2-dev-secret-key-2026';
const sessionSecret = serverConfig.sessionSecret || DEFAULT_SESSION_SECRET;
if (sessionSecret === DEFAULT_SESSION_SECRET) {
  serverLogger.warn('Security', 'sessionSecret がデフォルト値のままです。本番環境では環境変数 SESSION_SECRET または app-config.json で固有の値に変更してください。');
}
const sessionMaxAgeMs = (serverConfig.sessionMaxAgeDays || 7) * 24 * 60 * 60 * 1000;
app.use(session({
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  // 日本語コメント: アクティブ操作のたびにセッション有効期限をスライド延長
  rolling: true,
  cookie: {
    secure: false, // HTTP通信（リバースプロキシ配下での運用を考慮）
    httpOnly: true,
    sameSite: 'lax',
    maxAge: sessionMaxAgeMs,
  },
}));

// API アクセスロギングミドルウェア
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.originalUrl.startsWith('/api') || req.originalUrl === '/api/logs') {
      return;
    }

    const username = req.session?.user?.username;
    const userLabel = username ? `[User:${username}] ` : '';
    const message = `${userLabel}${req.method} ${req.originalUrl} ${res.statusCode} (${duration}ms)`;

    if (res.statusCode >= 500) {
      serverLogger.error('HTTP', message);
    } else if (res.statusCode >= 400) {
      serverLogger.warn('HTTP', message);
    } else if (req.originalUrl.startsWith('/api/auth/session') || req.originalUrl.startsWith('/api/config')) {
      // 高頻度のポーリング・設定参照は debug レベルにして通常ログのノイズを抑制
      serverLogger.debug('HTTP', message);
    } else {
      serverLogger.info('HTTP', message);
    }
  });
  next();
});

// バックエンド API ルーターマウント
app.use('/api/logs', logsRouter);
app.use('/api/auth', authRouter);
app.use('/api/parse', parseRouter);
app.use('/api/project', projectRouter);
app.use('/api/config', configRouter);
app.use('/api/plugins', pluginsRouter);

// クライアントビルド成果物 (dist/) の静的ファイル配信および SPA フォールバック
const clientDistDir = path.resolve(__dirname, '../dist');
if (fs.existsSync(clientDistDir)) {
  serverLogger.info('Server', `静的クライアント配信を有効化しました: ${clientDistDir}`);
  app.use(express.static(clientDistDir));

  // SPA ルーティングフォールバック (Express v5 互換)
  // API 以外の GET リクエストに対して index.html を返却
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(clientDistDir, 'index.html'));
    }
    next();
  });
} else {
  serverLogger.warn('Server', 'dist ディレクトリが存在しません。開発時は Vite (5173 ポート) をご利用ください。');
}

// サーバー起動
app.listen(PORT, () => {
  serverLogger.info('Server', `サーバーが起動しました: http://localhost:${PORT}`);
});
