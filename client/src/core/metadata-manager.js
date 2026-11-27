// 日本語コメント: メタデータ属性＆論理名マネージャー (client/src/core/metadata-manager.js)
// プラグインから登録された Project / Table / Column レベルの拡張属性定義および
// 論理名 (logicalName) の有効化状態を一元管理し、方言に応じたフィルタリングと
// DBML 保存時のクリーン消去用ホワイトリストを提供します。

import { t } from './i18n.js';

/**
 * 方言ターゲットと現在の方言 ID が合致するか判定
 * 例: targetDialect: 'oracle' は 'oracle', 'oracle_12c', 'oracle_11g' に合致
 */
function isDialectMatch(targetDialect, dialectId) {
  if (!targetDialect || !dialectId) return false;
  const target = targetDialect.toLowerCase();
  const current = dialectId.toLowerCase();
  return current === target || current.startsWith(target + '_') || current.includes(target);
}

export class MetadataManager {
  constructor() {
    this._logicalNamePlugins = new Set();
    this._projectAttributes = [];
    this._tableAttributes = [];
    this._columnAttributes = [];
  }

  /**
   * プラグインからのメタデータ属性定義を登録
   * @param {string} pluginId - プラグインID
   * @param {Object} def - { enableLogicalName, projectAttributes, tableAttributes, columnAttributes }
   */
  registerAttributes(pluginId, def = {}) {
    if (!pluginId || typeof def !== 'object') return;

    // 論理名有効化フラグ
    if (def.enableLogicalName === true) {
      this._logicalNamePlugins.add(pluginId);
    }

    // スキーマ (Project) レベル属性
    if (Array.isArray(def.projectAttributes)) {
      for (const attr of def.projectAttributes) {
        this._projectAttributes.push({ ...attr, pluginId });
      }
    }

    // テーブルレベル属性
    if (Array.isArray(def.tableAttributes)) {
      for (const attr of def.tableAttributes) {
        this._tableAttributes.push({ ...attr, pluginId });
      }
    }

    // カラムレベル属性
    if (Array.isArray(def.columnAttributes)) {
      for (const attr of def.columnAttributes) {
        this._columnAttributes.push({ ...attr, pluginId });
      }
    }
  }

  /**
   * 指定プラグインの登録属性を解除
   * @param {string} pluginId
   */
  unregisterPlugin(pluginId) {
    if (!pluginId) return;
    this._logicalNamePlugins.delete(pluginId);
    this._projectAttributes = this._projectAttributes.filter((a) => a.pluginId !== pluginId);
    this._tableAttributes = this._tableAttributes.filter((a) => a.pluginId !== pluginId);
    this._columnAttributes = this._columnAttributes.filter((a) => a.pluginId !== pluginId);
  }

  /**
   * 全定義をリセット
   */
  reset() {
    this._logicalNamePlugins.clear();
    this._projectAttributes = [];
    this._tableAttributes = [];
    this._columnAttributes = [];
  }

  /**
   * reset のエイリアス
   */
  clear() {
    this.reset();
  }

  /**
   * テーブル・カラムの「論理名 (logicalName)」が有効かどうか
   * @returns {boolean} 有効なプラグインで enableLogicalName が宣言されていれば true
   */
  isLogicalNameEnabled() {
    return this._logicalNamePlugins.size > 0;
  }

  /**
   * 日本語コメント: 論理名関連の表示ラベル・プレースホルダーをアクティブなプラグイン辞書から解決
   * @param {'table' | 'column' | 'tablePlaceholder' | 'columnPlaceholder' | 'erdModeOption'} type
   * @returns {string}
   */
  getLogicalNameLabel(type = 'column') {
    if (!this.isLogicalNameEnabled()) return '';

    // 1. 有効化されている論理名プラグインの辞書から優先探索
    for (const pluginId of this._logicalNamePlugins) {
      const fullKey = `plugins.${pluginId}.logicalName.${type}`;
      const val = t(fullKey);
      if (val && val !== fullKey) {
        return val;
      }
    }

    // 2. 本体辞書のフォールバック (metadata.logicalName.<type>)
    const coreKey = `metadata.logicalName.${type}`;
    const coreVal = t(coreKey);
    if (coreVal && coreVal !== coreKey) {
      return coreVal;
    }

    // 3. 最終既定値
    const defaults = {
      table: 'テーブル論理名',
      tablePlaceholder: '例: ユーザーマスタ',
      column: '論理名',
      columnPlaceholder: '論理名',
      erdModeOption: '論理名（和名）優先',
    };
    return defaults[type] || '';
  }

  /**
   * 指定方言で有効な Project 属性リストを取得
   * @param {string} dialectId - 現在の方言ID (例: 'standard', 'oracle_12c')
   * @returns {Array<Object>}
   */
  getProjectAttributes(dialectId = 'standard') {
    return this._projectAttributes.filter((attr) => {
      if (attr.scope === 'global') return true;
      if (attr.scope === 'dialect') {
        return isDialectMatch(attr.targetDialect, dialectId);
      }
      return false;
    });
  }

  /**
   * 指定方言で有効な Table 属性リストを取得
   * @param {string} dialectId - 現在の方言ID
   * @returns {Array<Object>}
   */
  getTableAttributes(dialectId = 'standard') {
    return this._tableAttributes.filter((attr) => {
      if (attr.scope === 'global') return true;
      if (attr.scope === 'dialect') {
        return isDialectMatch(attr.targetDialect, dialectId);
      }
      return false;
    });
  }

  /**
   * 指定方言で有効な Column 属性リストを取得
   * @param {string} dialectId - 現在の方言ID
   * @returns {Array<Object>}
   */
  getColumnAttributes(dialectId = 'standard') {
    return this._columnAttributes.filter((attr) => {
      if (attr.scope === 'global') return true;
      if (attr.scope === 'dialect') {
        return isDialectMatch(attr.targetDialect, dialectId);
      }
      return false;
    });
  }

  /**
   * 属性定義のラベル文字列を翻訳解決
   * @param {Object} attr - 属性定義オブジェクト
   * @returns {string} 翻訳後のラベル
   */
  resolveLabel(attr) {
    if (!attr) return '';
    if (attr.label) return attr.label;
    if (attr.labelKey) {
      // プラグイン名前空間を補完
      const fullKey = attr.labelKey.startsWith('plugins.')
        ? attr.labelKey
        : `plugins.${attr.pluginId}.${attr.labelKey}`;
      const translated = t(fullKey);
      if (translated !== fullKey) return translated;
      return t(attr.labelKey);
    }
    return attr.key || '';
  }

  /**
   * 属性定義のヒント文字列を翻訳解決
   * @param {Object} attr
   * @returns {string}
   */
  resolveHint(attr) {
    if (!attr || !attr.hintKey) return '';
    const fullKey = attr.hintKey.startsWith('plugins.')
      ? attr.hintKey
      : `plugins.${attr.pluginId}.${attr.hintKey}`;
    const translated = t(fullKey);
    if (translated !== fullKey) return translated;
    return t(attr.hintKey);
  }

  /**
   * DBML Project ブロック保存時に許可される属性キーの Set を取得 (クリーン消去用)
   * @param {string} dialectId
   * @returns {Set<string>}
   */
  getAllowedProjectKeys(dialectId = 'standard') {
    const keys = new Set(['name', 'database_type', 'version', 'Note', 'note']);
    for (const attr of this.getProjectAttributes(dialectId)) {
      keys.add(attr.key);
    }
    return keys;
  }

  /**
   * DBML Metadata Table 保存時に許可される属性キーの Set を取得 (クリーン消去用)
   * @param {string} dialectId
   * @returns {Set<string>}
   */
  getAllowedTableMetadataKeys(dialectId = 'standard') {
    const keys = new Set();
    if (this.isLogicalNameEnabled()) {
      keys.add('logicalName');
    }
    for (const attr of this.getTableAttributes(dialectId)) {
      keys.add(attr.key);
    }
    return keys;
  }

  /**
   * DBML Metadata Column 保存時に許可される属性キーの Set を取得 (クリーン消去用)
   * @param {string} dialectId
   * @returns {Set<string>}
   */
  getAllowedColumnMetadataKeys(dialectId = 'standard') {
    const keys = new Set();
    if (this.isLogicalNameEnabled()) {
      keys.add('logicalName');
    }
    for (const attr of this.getColumnAttributes(dialectId)) {
      keys.add(attr.key);
    }
    return keys;
  }
}

export const metadataManager = new MetadataManager();

