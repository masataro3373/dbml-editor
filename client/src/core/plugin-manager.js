// 日本語コメント: プラグインライフサイクル統括マネージャー (client/src/core/plugin-manager.js)
// サーバーから /api/plugins を取得し、ホワイトリスト検証・多言語辞書登録・
// スタイル注入・動的 import() および activate(context) のライフサイクルを安全に実行します。
// エラーや必須ライブラリ不足の安全検知と、セーフモード保存ガードを管理します。

import { registerPluginTranslations, t } from './i18n.js';
import { PLUGIN_LIBS, checkRequiredLibs } from './plugin-libs.js';
import { metadataManager } from './metadata-manager.js';
import { BaseDialect, BaseImporter, BaseExporter } from '../dialects/base.js';
import { logger } from './logger.js';

export class PluginManager {
  constructor(options = {}) {
    this._plugins = []; // スキャン・ロードされたプラグイン一覧
    this._importers = new Map(); // id -> importer
    this._exporters = new Map(); // id -> exporter
    this._menuItems = []; // メニュー項目定義配列
    this._dialectManager = options.dialectManager || null;
    this.isInitialized = false;
    this.hasUnhealthyPlugins = false; // missing_libs または error のプラグインが存在するか
  }

  /**
   * 方言マネージャーの参照をセット
   * @param {Object} dialectManager - 方言マネージャーインスタンス
   */
  setDialectManager(dialectManager) {
    this._dialectManager = dialectManager;
  }

  /**
   * プラグインシステム初期化
   * アプリ起動時に呼び出され、/api/plugins からプラグインを走査・ロードします
   */
  async init() {
    if (this.isInitialized) return;

    logger.info('PluginManager', 'プラグイン初期化開始');

    let serverPlugins = [];
    try {
      if (typeof fetch !== 'undefined') {
        const res = await fetch('/api/plugins');
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.plugins)) {
            serverPlugins = data.plugins;
          }
        } else {
          logger.warn('PluginManager', `/api/plugins 応答エラー: HTTP ${res.status}`);
        }
      }
    } catch (err) {
      logger.error('PluginManager', `プラグイン一覧取得失敗: ${err.message}`);
    }

    this._plugins = [];
    this._importers.clear();
    this._exporters.clear();
    this._menuItems = [];
    metadataManager.reset();

    let hasUnhealthy = false;

    for (const p of serverPlugins) {
      const pluginState = {
        ...p,
        status: p.status || 'installed',
        missingLibs: [],
        instance: null,
      };

      // 1. 多言語辞書の先行登録 (エラー時でも About 画面で多言語名称を表示できるようにするため)
      await this.loadPluginLocales(p.id, p);

      // 2. サーバー側で既にエラー判定されているプラグインはスキップ
      if (pluginState.status === 'error') {
        hasUnhealthy = true;
        this._plugins.push(pluginState);
        continue;
      }

      // 3. 必須ライブラリ (requires) のホワイトリスト検証
      const libCheck = checkRequiredLibs(p.requires || []);
      if (!libCheck.valid) {
        pluginState.status = 'missing_libs';
        pluginState.missingLibs = libCheck.missing;
        hasUnhealthy = true;
        logger.warn('PluginManager', `プラグイン '${p.id}' の必須ライブラリが未導入です: ${libCheck.missing.join(', ')}`);
        this._plugins.push(pluginState);
        continue;
      }

      // 4. プラグイン固有スタイルシート (<link>) の注入 (ブラウザ環境のみ)
      if (typeof document !== 'undefined' && Array.isArray(p.styles)) {
        for (const stylePath of p.styles) {
          const linkId = `plugin-style-${p.id}-${stylePath.replace(/[^a-zA-Z0-9-]/g, '_')}`;
          if (!document.getElementById(linkId)) {
            const linkEl = document.createElement('link');
            linkEl.id = linkId;
            linkEl.rel = 'stylesheet';
            linkEl.href = `/api/plugins/${p.id}/${stylePath}?v=${encodeURIComponent(p.version || '1.0.0')}`;
            document.head.appendChild(linkEl);
          }
        }
      }

      // 5. エントリポイントの動的 import()
      try {
        const entryUrl = `/api/plugins/${p.id}/${p.entry}?v=${encodeURIComponent(p.version || '1.0.0')}`;
        // Viteビルド時の静的解析を回避するため /* @vite-ignore */ を付与
        const module = await import(/* @vite-ignore */ entryUrl);
        const pluginInstance = module.default || module;

        // 6. PluginContext の生成と activate() の呼び出し
        if (typeof pluginInstance?.activate === 'function') {
          const context = this._createPluginContext(p.id);
          await pluginInstance.activate(context);
          pluginState.status = 'active';
          pluginState.instance = pluginInstance;
          logger.info('PluginManager', `プラグイン '${p.id}' (v${p.version}) を有効化しました`);
        } else {
          pluginState.status = 'error';
          pluginState.errorReason = 'デフォルトエクスポートに activate(context) メソッドが存在しません';
          hasUnhealthy = true;
          logger.error('PluginManager', `プラグイン '${p.id}' に activate() がありません`);
        }
      } catch (err) {
        pluginState.status = 'error';
        pluginState.errorReason = `ロード・初期化例外: ${err.message}`;
        hasUnhealthy = true;
        logger.error('PluginManager', `プラグイン '${p.id}' のロードに失敗しました: ${err.message}`, err);
      }

      this._plugins.push(pluginState);
    }

    this.hasUnhealthyPlugins = hasUnhealthy;
    this.isInitialized = true;
    logger.info('PluginManager', `プラグイン初期化完了 (有効: ${this._plugins.filter((p) => p.status === 'active').length}個, 全体: ${this._plugins.length}個, 不健全: ${hasUnhealthy})`);
  }

  /**
   * プラグインの多言語辞書リソースをロードして登録
   * @param {string} pluginId - プラグインID
   * @param {Object} manifest - プラグインマニフェスト情報
   */
  async loadPluginLocales(pluginId, manifest) {
    // 日本語コメント: manifest.locales が存在する場合は即座に登録
    if (manifest && manifest.locales && typeof manifest.locales === 'object') {
      for (const [lang, dict] of Object.entries(manifest.locales)) {
        registerPluginTranslations(pluginId, lang, dict);
      }
      return;
    }

    // 日本語コメント: 存在しない場合のみ /api/plugins/${pluginId}/locales/${lang}.json を fetch
    if (typeof fetch !== 'undefined') {
      const langs = ['en', 'ja'];
      for (const lang of langs) {
        try {
          const res = await fetch(`/api/plugins/${pluginId}/locales/${lang}.json`);
          if (res.ok) {
            const dict = await res.json();
            registerPluginTranslations(pluginId, lang, dict);
          }
        } catch (e) {
          // 個別言語ファイルの取得失敗は許容
        }
      }
    }
  }

  /**
   * プラグインへ渡す安全な実行コンテキスト (PluginContext) を生成
   * @private
   */
  _createPluginContext(pluginId) {
    const self = this;

    return {
      // 1. 基底クラス群
      api: {
        BaseDialect,
        BaseImporter,
        BaseExporter,
      },

      // 2. ホワイトリスト登録済み外部ライブラリ
      libs: PLUGIN_LIBS,

      // 3. プラグイン専用多言語翻訳関数 (辞書キーの頭に plugins.<id>. を自動補完)
      t(subKey, params = null) {
        if (!subKey || typeof subKey !== 'string') return '';
        const fullKey = subKey.startsWith('plugins.')
          ? subKey
          : `plugins.${pluginId}.${subKey}`;
        return t(fullKey, params);
      },

      // 4. 方言レジストリ
      dialects: {
        register(dialect) {
          if (self._dialectManager && typeof self._dialectManager.register === 'function') {
            self._dialectManager.register(dialect);
          }
        },
      },

      // 5. 独立インポーターレジストリ (Excel等)
      importers: {
        register(importer) {
          if (importer && importer.id) {
            self._importers.set(importer.id, { ...importer, pluginId });
          }
        },
      },

      // 6. 独立エクスポーターレジストリ
      exporters: {
        register(exporter) {
          if (exporter && exporter.id) {
            self._exporters.set(exporter.id, { ...exporter, pluginId });
          }
        },
      },

      // 7. メタデータ属性レジストリ (論理名・Project・Table・Column属性)
      // 日本語コメント: registerAttributes(def) および registerAttributes(pluginId, def) の両シグネチャを安全に許容
      metadata: {
        registerAttributes(defOrPluginId, maybeDef) {
          const targetDef = (maybeDef && typeof maybeDef === 'object')
            ? maybeDef
            : (defOrPluginId && typeof defOrPluginId === 'object' ? defOrPluginId : {});
          metadataManager.registerAttributes(pluginId, targetDef);
        },
      },

      // 8. ヘッダーメニュー拡張レジストリ
      menus: {
        registerItem(menuItem) {
          if (menuItem && menuItem.id) {
            self._menuItems.push({ ...menuItem, pluginId });
          }
        },
      },
    };
  }

  /**
   * 導入済みプラグイン一覧を取得 (バージョン情報モーダル表示用)
   * @returns {Array<Object>}
   */
  getPluginList() {
    return [...this._plugins];
  }

  /**
   * 登録された独立インポーター一覧を取得 (インポートモーダル動的タブ用)
   * @returns {Array<Object>}
   */
  getImporters() {
    return Array.from(this._importers.values());
  }

  /**
   * 登録された独立エクスポーター一覧を取得
   * @returns {Array<Object>}
   */
  getExporters() {
    return Array.from(this._exporters.values());
  }

  /**
   * 登録されたメニュー項目一覧を取得
   * @returns {Array<Object>}
   */
  getMenuItems() {
    return [...this._menuItems];
  }
}

export const pluginManager = new PluginManager();
