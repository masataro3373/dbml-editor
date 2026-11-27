// 日本語コメント: サーバー側設定管理サービス (server/services/config-service.js)
// config/app-config.json を読み込み、環境変数とのマージおよびクライアント向け公開設定の提供を行います。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクトルート配下の config ディレクトリ
const CONFIG_FILE = path.resolve(__dirname, '../../config/app-config.json');

// デフォルト設定値
const DEFAULT_CONFIG = {
  server: {
    port: 3000,
    authMode: 'local',
    sessionMaxAgeDays: 7,
    sessionSecret: 'dbml-editor-v2-dev-secret-key-2026',
    logLevel: 'info',
    logRetentionDays: 30,
    logCompress: false,
    corsOrigins: [],
  },
  app: {
    appName: 'DBML Editor',
    defaultDialect: 'standard',
    defaultTheme: 'light',
    defaultLocale: 'ja',
    logLevel: 'info',
    features: {
      showDevTools: false,
      enableDbmlPreview: true,
    },
  },
};

class ConfigService {
  constructor() {
    this.config = this.loadConfig();
  }

  /**
   * 設定ファイルの読み込みと環境変数マージ
   */
  loadConfig() {
    let fileConfig = {};
    if (fs.existsSync(CONFIG_FILE)) {
      try {
        const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
        fileConfig = JSON.parse(raw);
      } catch (err) {
        console.error(`[CONFIG:ERROR] 設定ファイル (${CONFIG_FILE}) の読み込みまたはパースに失敗しました:`, err.message);
      }
    }

    // デフォルトとファイル設定をディープマージ
    const merged = {
      server: {
        ...DEFAULT_CONFIG.server,
        ...(fileConfig.server || {}),
      },
      app: {
        ...DEFAULT_CONFIG.app,
        ...(fileConfig.app || {}),
        features: {
          ...DEFAULT_CONFIG.app.features,
          ...(fileConfig.app?.features || {}),
        },
      },
    };

    // 環境変数によるオーバーライド
    if (process.env.PORT) {
      merged.server.port = parseInt(process.env.PORT, 10) || merged.server.port;
    }
    if (process.env.AUTH_MODE) {
      merged.server.authMode = process.env.AUTH_MODE;
    }
    if (process.env.SESSION_SECRET) {
      merged.server.sessionSecret = process.env.SESSION_SECRET;
    }
    if (process.env.LOG_LEVEL) {
      merged.server.logLevel = process.env.LOG_LEVEL;
    }
    // 日本語コメント: 本番環境等でクライアント側のログレベルを環境変数 (APP_LOG_LEVEL) から info 等へ切り替え可能にする
    if (process.env.APP_LOG_LEVEL) {
      merged.app.logLevel = process.env.APP_LOG_LEVEL;
    }
    if (process.env.LOG_RETENTION_DAYS !== undefined) {
      const parsedDays = parseInt(process.env.LOG_RETENTION_DAYS, 10);
      if (!Number.isNaN(parsedDays) && parsedDays > 0) {
        merged.server.logRetentionDays = parsedDays;
      }
    }
    if (process.env.LOG_COMPRESS !== undefined) {
      merged.server.logCompress = process.env.LOG_COMPRESS === 'true';
    }
    if (process.env.CORS_ORIGIN !== undefined) {
      merged.server.corsOrigins = process.env.CORS_ORIGIN
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    }

    return merged;
  }

  /**
   * 設定の再読み込み
   */
  reload() {
    this.config = this.loadConfig();
    return this.config;
  }

  /**
   * サーバー内部用設定取得
   */
  getServerConfig() {
    return this.config.server;
  }

  /**
   * クライアント公開用設定取得 (セキュリティ上安全な項目のみ返却)
   */
  getClientConfig() {
    return {
      appName: this.config.app.appName,
      defaultDialect: this.config.app.defaultDialect,
      defaultTheme: this.config.app.defaultTheme,
      defaultLocale: this.config.app.defaultLocale,
      logLevel: this.config.app.logLevel,
      features: this.config.app.features,
      authMode: this.config.server.authMode,
    };
  }
}

export const configService = new ConfigService();
