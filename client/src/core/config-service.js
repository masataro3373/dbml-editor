// 日本語コメント: クライアント側設定管理サービス (src/core/config-service.js)
// サーバーの GET /api/config から公開設定を取得し、キャッシュと各モジュールへの設定値提供を行います。

import { logger } from './logger.js';

// オフライン・初期フォールバック用のデフォルト設定値
const FALLBACK_CONFIG = {
  appName: 'DBML Editor',
  defaultDialect: 'standard',
  defaultTheme: 'light',
  defaultLocale: 'ja',
  logLevel: 'info',
  features: {
    showDevTools: false,
    enableDbmlPreview: true,
  },
  authMode: 'local',
};

class ClientConfigService {
  constructor() {
    this.config = { ...FALLBACK_CONFIG };
    this.isLoaded = false;
  }

  /**
   * サーバーから設定情報を非同期ロード
   */
  async loadConfig() {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) {
        throw new Error(`設定取得失敗: HTTP ${res.status}`);
      }
      const data = await res.json();
      if (data.success && data.config) {
        this.config = {
          ...FALLBACK_CONFIG,
          ...data.config,
          features: {
            ...FALLBACK_CONFIG.features,
            ...(data.config.features || {}),
          },
        };
        this.isLoaded = true;
        logger.setLevel(this.config.logLevel);
        logger.info('Config', 'アプリ設定を正常に読み込みました', this.config);
      }
    } catch (err) {
      logger.warn('Config', '設定ファイル取得に失敗したため、デフォルト値を使用します', err);
      this.config = { ...FALLBACK_CONFIG };
    }
    return this.config;
  }

  /**
   * 設定値の取得 (キー指定、または全設定)
   */
  get(key, defaultValue = null) {
    if (!key) return this.config;
    return this.config[key] !== undefined ? this.config[key] : defaultValue;
  }

  get defaultDialect() {
    return this.config.defaultDialect || 'standard';
  }

  get defaultTheme() {
    return this.config.defaultTheme || 'light';
  }

  get defaultLocale() {
    return this.config.defaultLocale || 'ja';
  }

  get logLevel() {
    return this.config.logLevel || 'info';
  }

  get features() {
    return this.config.features || {};
  }

  get authMode() {
    return this.config.authMode || 'local';
  }
}

export const clientConfigService = new ClientConfigService();
