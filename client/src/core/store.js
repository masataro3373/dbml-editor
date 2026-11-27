// 日本語コメント: アプリケーション一元状態管理ストア (src/core/store.js)
// ユーザー情報、プロジェクトメタデータ (project.json)、複数スキーマ (schemas/*.dbml)、
// 現在のアクティブスキーマおよびアクティブ方言、パース済みASTモデル、ローディング状態を一元管理します。

import { logger } from './logger.js';
import { dialectManager } from '../dialects/index.js';

class AppStore {
  constructor() {
    this.events = new Map();

    // アプリケーション全体の状態
    this.state = {
      config: null,
      user: null,
      isProjectLoaded: false,// プロジェクト情報がロードされたか
      isEmptyProject: false, // プロジェクトが未作成(0個)かどうか
      projectMeta: null,     // project.json の内容 (meta, info, files)
      schemas: new Map(),    // Map<filename, { ShortID, filename, visible, dbml, model }>
      activeSchema: null,    // 現在編集対象のアクティブスキーマ名
      activeDialect: null,   // アクティブスキーマの方言 (BaseDialect)
      erds: new Map(),       // Map<erdId, { id, filename, name, description, content }>
      activeErdId: null,     // 現在表示中のアクティブERD ID
      project: null,         // アクティブスキーマの Project AST
      tables: [],            // アクティブスキーマの tables
      tableGroups: [],
      notes: [],
      refs: [],
      loading: {
        active: false,
        message: '',
        progress: null, // null の場合はスピナー、0〜100 の数値の場合はプログレスバー
      },
    };
  }

  /**
   * イベント購読
   */
  on(event, handler) {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event).add(handler);
    return () => this.off(event, handler);
  }

  /**
   * イベント購読解除
   */
  off(event, handler) {
    if (this.events.has(event)) {
      this.events.get(event).delete(handler);
    }
  }

  /**
   * イベント発火
   */
  emit(event, payload) {
    if (this.events.has(event)) {
      for (const handler of this.events.get(event)) {
        try {
          handler(payload);
        } catch (err) {
          logger.error('Store', `イベントハンドラ実行エラー (${event})`, err);
        }
      }
    }
  }

  /**
   * アプリケーション設定の更新
   */
  setConfig(config) {
    this.state.config = config;
    this.emit('config:changed', config);
  }

  /**
   * ユーザー状態の更新
   */
  setUser(user) {
    this.state.user = user;
    logger.setUser(user?.username || null);
    this.emit('user:changed', user);
  }

  /**
   * プロジェクトマニフェスト (project.json) のセット
   */
  setProjectMeta(projectMeta) {
    this.state.isProjectLoaded = true;
    this.state.isEmptyProject = !projectMeta;
    this.state.projectMeta = projectMeta;
    this.emit('projectMeta:updated', projectMeta);
  }

  /**
   * プロジェクト未作成 (0個) 状態のセット
   */
  setEmptyProject() {
    this.state.isProjectLoaded = true;
    this.state.isEmptyProject = true;
    this.state.projectMeta = null;
    this.state.schemas = new Map();
    this.state.activeSchema = null;
    this.state.erds = new Map();
    this.state.activeErdId = null;
    this.state.project = null;
    this.state.tables = [];
    this.state.tableGroups = [];
    this.state.refs = [];
    this.emit('project:empty');
    this.emit('projectMeta:updated', null);
    this.emit('schemas:updated', this.state.schemas);
    this.emit('erds:updated', this.state.erds);
    this.emit('schema:changed', null);
    // 日本語コメント: 空プロジェクト遷移時に表示中ER図のクリアと画面離脱を通知
    this.emit('erd:changed', null);
    this.emit('model:updated', this.state);
  }

  /**
   * 全スキーママップのセット
   * @param {Map<string, Object>} schemasMap - Map<filename, { ShortID, filename, visible, dbml, model }>
   * @param {string|null} initialActiveSchema - 初期アクティブスキーマ名
   */
  setSchemas(schemasMap, initialActiveSchema = null) {
    this.state.schemas = schemasMap;
    const targetSchema = (initialActiveSchema && schemasMap.has(initialActiveSchema))
      ? initialActiveSchema
      : (schemasMap.keys().next().value || null);
    if (targetSchema) {
      this.switchSchema(targetSchema, { force: true });
    } else {
      // スキーマが0個の場合の安全なクリア処理
      this.state.activeSchema = null;
      this.state.project = null;
      this.state.tables = [];
      this.state.tableGroups = [];
      this.state.notes = [];
      this.state.refs = [];
      this.emit('schema:changed', null);
      this.emit('model:updated', this.state);
    }
    this.emit('schemas:updated', this.state.schemas);
  }

  /**
   * アクティブスキーマの切り替え
   * @param {string} schemaName - スキーマファイル名 (例: 'main')
   * @param {Object} [options] - オプション ({ force = false })
   */
  switchSchema(schemaName, { force = false } = {}) {
    if (!this.state.schemas.has(schemaName)) {
      logger.warn('Store', `指定されたスキーマが存在しません: ${schemaName}`);
      return;
    }

    const schemaData = this.state.schemas.get(schemaName);
    const model = schemaData.model || {};

    // 既にアクティブかつモデル参照が同一で、強制フラグがなければ冗長なイベント発火を防止して早期リターン
    if (!force && this.state.activeSchema === schemaName && this.state.tables === (schemaData?.model?.tables)) {
      return;
    }

    this.state.activeSchema = schemaName;

    this.state.project = model.project || null;
    this.state.tables = model.tables || [];
    this.state.tableGroups = model.tableGroups || [];
    this.state.notes = model.notes || [];
    this.state.refs = model.refs || [];

    // スキーマの databaseType から方言を解決し自動連動
    const databaseType = model.project?.databaseType;
    const dialect = dialectManager.resolve(databaseType);
    this.setActiveDialect(dialect);

    logger.info('Store', `アクティブスキーマを切り替えました: ${schemaName} (方言: ${dialect.displayName})`);
    this.emit('schema:changed', schemaName);
    this.emit('model:updated', this.state);
  }

  /**
   * アクティブ方言の変更
   */
  setActiveDialect(dialect) {
    this.state.activeDialect = dialect;
    logger.info('Store', `アクティブ方言が変更されました: ${dialect?.displayName}`);
    this.emit('dialect:changed', dialect);
  }

  /**
   * 現在のアクティブスキーマのモデルを更新
   * (省略されたプロパティは現在の state を維持し、notes 等の意図せぬ消失を防止)
   */
  setModel({ project, tables, tableGroups, notes, refs } = {}) {
    this.state.project = project !== undefined ? project : this.state.project;
    this.state.tables = tables !== undefined ? tables : (this.state.tables || []);
    this.state.tableGroups = tableGroups !== undefined ? tableGroups : (this.state.tableGroups || []);
    this.state.notes = notes !== undefined ? notes : (this.state.notes || []);
    this.state.refs = refs !== undefined ? refs : (this.state.refs || []);

    // schemas Map のアクティブ要素も更新
    if (this.state.schemas.has(this.state.activeSchema)) {
      const current = this.state.schemas.get(this.state.activeSchema);
      current.model = {
        project: this.state.project,
        tables: this.state.tables,
        tableGroups: this.state.tableGroups,
        notes: this.state.notes,
        refs: this.state.refs,
      };
      // 日本語コメント: モデル更新時に未保存(dirty)およびDBML再生成必要(dbmlDirty)フラグをセット
      current.dirty = true;
      current.dbmlDirty = true;
    }

    logger.info('Store', `モデルが更新されました (スキーマ: ${this.state.activeSchema}, テーブル数: ${this.state.tables.length})`);
    this.emit('model:updated', this.state);
  }

  /**
   * 指定したスキーマを未保存 (dirty) 状態としてマークする
   * @param {string} schemaName - スキーマ名
   * @param {Object} [options] - { dbmlDirty = true }
   */
  markSchemaDirty(schemaName, { dbmlDirty = true } = {}) {
    if (schemaName && this.state.schemas.has(schemaName)) {
      const entry = this.state.schemas.get(schemaName);
      entry.dirty = true;
      if (dbmlDirty) entry.dbmlDirty = true;
    }
  }

  /**
   * ERDマップのセット
   * @param {Map<string, Object>} erdsMap - Map<erdId, { id, filename, name, description, content }>
   */
  setErds(erdsMap) {
    this.state.erds = erdsMap;
    // 日本語コメント: アクティブER図が更新後マップに含まれない場合は選択を解除して通知
    if (this.state.activeErdId && (!erdsMap || !erdsMap.has(this.state.activeErdId))) {
      this.state.activeErdId = null;
      this.emit('erd:changed', null);
    }
    this.emit('erds:updated', this.state.erds);
  }

  /**
   * アクティブERDの切り替え
   * @param {string} erdId - ERD ID
   */
  switchErd(erdId) {
    if (!this.state.erds.has(erdId)) {
      logger.warn('Store', `指定されたER図が存在しません: ${erdId}`);
      return;
    }
    this.state.activeErdId = erdId;
    const erdData = this.state.erds.get(erdId);
    logger.info('Store', `アクティブER図を切り替えました: ${erdData.name || erdId}`);
    this.emit('erd:changed', erdData);
  }

  /**
   * ERDレイアウト内容の更新
   * @param {string} erdId - ERD ID
   * @param {Object} content - ERDデータ (info, nodes, edges, memos, boxes)
   */
  updateErdContent(erdId, content) {
    if (this.state.erds.has(erdId)) {
      const erdEntry = this.state.erds.get(erdId);
      erdEntry.content = content;
      // 日本語コメント: ER図レイアウト変更時に未保存(dirty)フラグをセット
      erdEntry.dirty = true;
      this.emit('erd:updated', erdEntry);
    }
  }

  /**
   * 未保存の変更 (dirty) が存在するかどうかを判定
   * @returns {boolean}
   */
  hasDirtyChanges() {
    for (const item of this.state.schemas.values()) {
      if (item.dirty) return true;
    }
    for (const item of this.state.erds.values()) {
      if (item.dirty) return true;
    }
    return false;
  }

  /**
   * ローディング/Wait表示の制御
   */
  showLoading(message = '', progress = null) {
    this.state.loading = { active: true, message, progress };
    this.emit('loading:changed', this.state.loading);
  }

  hideLoading() {
    this.state.loading = { active: false, message: '', progress: null };
    this.emit('loading:changed', this.state.loading);
  }

  setProgress(progress, message = '') {
    this.state.loading = { active: true, message, progress };
    this.emit('loading:changed', this.state.loading);
  }
}

export const appStore = new AppStore();
