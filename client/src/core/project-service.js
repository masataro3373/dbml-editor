// 日本語コメント: クライアント側プロジェクト管理サービス (src/core/project-service.js)
// サーバーの /api/project API と連携して project.json および全 schemas/*.dbml の
// ロード・パース・一括保存・新規スキーマ作成・スキーマ削除を調停します。

import { appStore } from './store.js';
import { logger } from './logger.js';
import { generateDbml } from './dbml-generator.js';

export const projectService = {
  /**
   * サーバーからプロジェクト全体 (project.json と全スキーマ) をロードし、ASTモデルを初期化
   * 初回未作成時は empty: true を処理
   */
  async loadProject() {
    appStore.showLoading('プロジェクトを読み込んでいます...');
    try {
      const res = await fetch('/api/project/load', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      // プロジェクト未作成 (0個) の場合
      if (data.empty) {
        appStore.setEmptyProject();
        logger.info('Project', '初回ログイン: プロジェクト未作成状態です');
        return { empty: true };
      }

      const projectMeta = data.project || {};
      const rawSchemas = data.schemas || {};
      const rawErds = data.erds || {};

      appStore.setProjectMeta(projectMeta);

      // ERD マップの構築
      const erdsMap = new Map();
      const erdEntries = projectMeta.files?.erds || [];
      for (const entry of erdEntries) {
        const erdId = entry.id || entry.filename;
        const erdContent = rawErds[erdId] || {
          info: { description: entry.description || entry.name, version: '1.0.0' },
          nodes: [],
          edges: [],
          memos: [],
          boxes: [],
        };
        erdsMap.set(erdId, {
          id: erdId,
          filename: entry.filename || erdId,
          name: entry.name || erdId,
          description: entry.description || '',
          visible: entry.visible !== false,
          content: erdContent,
          // 日本語コメント: 初期ロード時は未変更(dirty: false)として初期化
          dirty: false,
        });
      }
      appStore.setErds(erdsMap);

      const schemasMap = new Map();
      const schemaEntries = projectMeta.files?.schemas || [];

      // 全スキーマをパースして Map に構築
      for (const entry of schemaEntries) {
        const filename = entry.filename;
        const dbmlText = rawSchemas[filename] || '';

        try {
          const parseRes = await fetch('/api/parse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dbml: dbmlText }),
          });

          let model = { project: null, tables: [], tableGroups: [], notes: [], refs: [] };
          if (parseRes.ok) {
            const parseData = await parseRes.json();
            model = {
              project: parseData.project,
              tables: parseData.tables || [],
              tableGroups: parseData.tableGroups || [],
              notes: parseData.notes || [],
              refs: parseData.refs || [],
            };
          }

          schemasMap.set(filename, {
            ShortID: entry.ShortID,
            filename,
            visible: entry.visible !== false,
            dbml: dbmlText,
            model,
            // 日本語コメント: 初期ロード時は未変更状態として初期化
            dirty: false,
            dbmlDirty: false,
          });
        } catch (err) {
          logger.warn('Project', `スキーマ「${filename}」のパースに失敗しました`, err);
          schemasMap.set(filename, {
            ShortID: entry.ShortID,
            filename,
            visible: true,
            dbml: dbmlText,
            model: { project: null, tables: [], tableGroups: [], refs: [] },
            dirty: false,
            dbmlDirty: false,
          });
        }
      }

      // 先頭スキーマを初期選択として Store に反映
      appStore.setSchemas(schemasMap);

      logger.info('Project', `プロジェクトをロードしました (全 ${schemasMap.size} スキーマ)`);
      return true;
    } catch (err) {
      logger.error('Project', 'プロジェクト読み込みエラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 現在編集中の AST モデルから変更があったスキーマの DBML を再生成し、差分(または全件)保存
   * @param {Object} options - { skipRegenerateActive: boolean, forceAll: boolean }
   */
  async saveProject(options = {}) {
    const { skipRegenerateActive = false, forceAll = false } = options;
    appStore.showLoading('プロジェクトを保存中...');
    try {
      // 1. アクティブスキーマに変更がある場合のみ最新 DBML を AST から再生成して反映 (インポート時はスキップ可能)
      const activeSchemaName = appStore.state.activeSchema;
      if (!skipRegenerateActive && activeSchemaName && appStore.state.schemas.has(activeSchemaName)) {
        const activeEntry = appStore.state.schemas.get(activeSchemaName);
        if (activeEntry.dirty || activeEntry.dbmlDirty || forceAll) {
          activeEntry.model = {
            project: appStore.state.project,
            tables: appStore.state.tables,
            tableGroups: appStore.state.tableGroups,
            notes: appStore.state.notes,
            refs: appStore.state.refs,
          };
          activeEntry.dbml = generateDbml(activeEntry.model);
          activeEntry.dbmlDirty = false;
        }
      }

      // 2. 変更があったスキーマ (dirty または forceAll) の DBML テキストのみを収集
      const schemasPayload = {};
      const savedSchemas = [];
      for (const [filename, item] of appStore.state.schemas.entries()) {
        if (item.dirty || forceAll) {
          if ((item.dbmlDirty || !item.dbml) && item.model) {
            item.dbml = generateDbml(item.model);
            item.dbmlDirty = false;
          }
          schemasPayload[filename] = item.dbml || '';
          savedSchemas.push(item);
        }
      }

      // 3. 変更があった ERD データ (dirty または forceAll) のみを収集
      const erdsPayload = {};
      const savedErds = [];
      for (const [erdId, item] of appStore.state.erds.entries()) {
        if (item.dirty || forceAll) {
          erdsPayload[erdId] = item.content || { info: { description: item.name }, nodes: [], edges: [], memos: [], boxes: [] };
          savedErds.push(item);
        }
      }

      const res = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project: appStore.state.projectMeta,
          schemas: schemasPayload,
          erds: erdsPayload,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // 日本語コメント: 保存成功後に送信対象となったスキーマ・ERDのdirtyフラグをクリア
      savedSchemas.forEach(s => {
        s.dirty = false;
        s.dbmlDirty = false;
      });
      savedErds.forEach(e => {
        e.dirty = false;
      });

      logger.info('Project', `プロジェクトをサーバーに保存しました (更新スキーマ: ${savedSchemas.length}件, 更新ERD: ${savedErds.length}件)`);
      return true;
    } catch (err) {
      logger.error('Project', 'プロジェクト保存エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 新規プロジェクトを作成 (初期状態: スキーマ0個)
   */
  async createProject({ name = '', description = '' } = {}) {
    appStore.showLoading('プロジェクトを作成中...');
    try {
      const res = await fetch('/api/project/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      appStore.setProjectMeta(data.project);
      appStore.setSchemas(new Map());
      // 日本語コメント: 新規プロジェクト作成時はER図一覧を空にし、プロジェクト画面へ遷移させる
      appStore.setErds(new Map());
      appStore.emit('project:select');
      logger.info('Project', `新規プロジェクトを作成しました: ${data.project?.info?.name}`);
      return true;
    } catch (err) {
      logger.error('Project', 'プロジェクト作成エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 新規スキーマを作成して追加
   */
  async createSchema({ filename, title = '', databaseType = 'standard' }) {
    appStore.showLoading('スキーマを作成中...');
    try {
      const res = await fetch('/api/project/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ filename, title, databaseType }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const { schemaEntry, content, project } = data;

      // パースしてモデル化
      const parseRes = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbml: content }),
      });
      const parseData = parseRes.ok ? await parseRes.json() : {};

      // Store の schemas Map に追加 (サーバー側で作成・保存済みのため dirty: false)
      appStore.state.schemas.set(schemaEntry.filename, {
        ShortID: schemaEntry.ShortID,
        filename: schemaEntry.filename,
        visible: true,
        dbml: content,
        model: {
          project: parseData.project || null,
          tables: parseData.tables || [],
          tableGroups: parseData.tableGroups || [],
          notes: parseData.notes || [],
          refs: parseData.refs || [],
        },
        dirty: false,
        dbmlDirty: false,
      });

      appStore.setProjectMeta(project);
      appStore.switchSchema(schemaEntry.filename);
      appStore.emit('schemas:updated', appStore.state.schemas);

      logger.info('Project', `新規スキーマを作成しました: ${schemaEntry.filename}`);
      return schemaEntry;
    } catch (err) {
      logger.error('Project', 'スキーマ作成エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 指定スキーマの DBML を更新してサーバーに永続化し、モデルを同期
   * インポート時や外部定義反映時に使用
   * @param {string} filename - スキーマ名
   * @param {string} dbml - 新しい DBML テキスト
   */
  async saveSchemaDbml(filename, dbml) {
    appStore.showLoading('スキーマを保存中...');
    try {
      const entry = appStore.state.schemas.get(filename);
      if (!entry) {
        throw new Error(`スキーマ「${filename}」が存在しません`);
      }

      // 1. DBML テキストを更新
      entry.dbml = dbml;

      // 2. /api/parse で最新 AST モデルを構築
      const parseRes = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbml }),
      });

      if (!parseRes.ok) {
        const errData = await parseRes.json().catch(() => ({}));
        const diagMsg = errData.diags?.[0]?.message ? ` (行 ${errData.diags[0]?.location?.start?.line}: ${errData.diags[0]?.message})` : '';
        const errMsg = errData.error ? `${errData.error}${diagMsg}` : `DBML構文解析エラー (HTTP ${parseRes.status})${diagMsg}`;
        throw new Error(errMsg);
      }

      const parseData = await parseRes.json();
      entry.model = {
        project: parseData.project || null,
        tables: parseData.tables || [],
        tableGroups: parseData.tableGroups || [],
        notes: parseData.notes || [],
        refs: parseData.refs || [],
      };
      // 日本語コメント: インポート時とテーブル編集・削除保存時でDBML生成ロジックを完全統一するため、構築したモデルから正規化DBMLを再生成
      const normalizedDbml = generateDbml(entry.model);
      if (normalizedDbml) {
        entry.dbml = normalizedDbml;
      }
      // 日本語コメント: 正規化DBMLで更新済みのため dirty=true, dbmlDirty=false にセット
      entry.dirty = true;
      entry.dbmlDirty = false;

      // 日本語コメント: アクティブスキーマであれば Store のモデルと方言 (activeDialect) も強制同期
      if (appStore.state.activeSchema === filename) {
        appStore.switchSchema(filename, { force: true });
      }

      // 3. 変更のあるスキーマ (dirty) および ERD (dirty) のみをサーバーに差分保存
      const schemasPayload = {};
      const savedSchemas = [];
      for (const [name, item] of appStore.state.schemas.entries()) {
        if (item.dirty) {
          if ((item.dbmlDirty || !item.dbml) && item.model) {
            item.dbml = generateDbml(item.model);
            item.dbmlDirty = false;
          }
          schemasPayload[name] = item.dbml || '';
          savedSchemas.push(item);
        }
      }

      const erdsPayload = {};
      const savedErds = [];
      for (const [erdId, item] of appStore.state.erds.entries()) {
        if (item.dirty) {
          erdsPayload[erdId] = item.content || { info: { description: item.name }, nodes: [], edges: [], memos: [], boxes: [] };
          savedErds.push(item);
        }
      }

      const res = await fetch('/api/project/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          project: appStore.state.projectMeta,
          schemas: schemasPayload,
          erds: erdsPayload,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // 日本語コメント: 保存成功後に送信したスキーマ・ERDのdirtyフラグをクリア
      savedSchemas.forEach(s => {
        s.dirty = false;
        s.dbmlDirty = false;
      });
      savedErds.forEach(e => {
        e.dirty = false;
      });

      appStore.emit('schemas:updated', appStore.state.schemas);
      logger.info('Project', `スキーマ「${filename}」のDBMLを更新・保存しました`);
      return true;
    } catch (err) {
      logger.error('Project', 'スキーマDBML保存エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * スキーマを削除 (最後の1個でも削除可能でスキーマ0個になる)
   */
  async deleteSchema(filename) {
    if (!filename) {
      throw new Error('削除対象のスキーマが指定されていません');
    }

    appStore.showLoading('スキーマを削除中...');
    try {
      const res = await fetch(`/api/project/schema/${filename}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      appStore.state.schemas.delete(filename);
      appStore.setProjectMeta(data.project);

      // アクティブスキーマだった場合は、残存する先頭のスキーマへ切り替え、無ければクリア
      if (appStore.state.activeSchema === filename) {
        const nextSchema = appStore.state.schemas.keys().next().value || null;
        if (nextSchema) {
          appStore.switchSchema(nextSchema);
        } else {
          appStore.state.activeSchema = null;
          appStore.state.project = null;
          appStore.state.tables = [];
          appStore.state.tableGroups = [];
          appStore.state.refs = [];
          appStore.emit('schema:changed', null);
          appStore.emit('model:updated', appStore.state);
        }
      }

      appStore.emit('schemas:updated', appStore.state.schemas);
      logger.info('Project', `スキーマを削除しました: ${filename}`);
      return true;
    } catch (err) {
      logger.error('Project', 'スキーマ削除エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 新規ERDを作成してプロジェクトに追加
   */
  async createErd({ name, description = '' }) {
    if (!name) throw new Error('ER図名を入力してください');
    appStore.showLoading('ER図を作成中...');
    try {
      const res = await fetch('/api/project/erd', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, description }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      const { erdEntry, content, project } = data;

      appStore.setProjectMeta(project);
      // 日本語コメント: サーバー側で新規作成・保存済みのため dirty: false で登録
      appStore.state.erds.set(erdEntry.id, {
        id: erdEntry.id,
        filename: erdEntry.filename,
        name: erdEntry.name,
        description: erdEntry.description,
        visible: erdEntry.visible !== false,
        content,
        dirty: false,
      });

      appStore.emit('erds:updated', appStore.state.erds);
      appStore.switchErd(erdEntry.id);
      logger.info('Project', `新規ER図を作成しました: ${name} (${erdEntry.id})`);
      return erdEntry;
    } catch (err) {
      logger.error('Project', 'ER図作成エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * ERDを削除
   */
  async deleteErd(erdId) {
    if (!erdId) throw new Error('削除対象のER図IDが指定されていません');
    appStore.showLoading('ER図を削除中...');
    try {
      const res = await fetch(`/api/project/erd/${erdId}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      appStore.state.erds.delete(erdId);
      appStore.setProjectMeta(data.project);

      if (appStore.state.activeErdId === erdId) {
        appStore.state.activeErdId = null;
        appStore.emit('erd:changed', null);
      }

      appStore.emit('erds:updated', appStore.state.erds);
      logger.info('Project', `ER図を削除しました: ${erdId}`);
      return true;
    } catch (err) {
      logger.error('Project', 'ER図削除エラー', err);
      throw err;
    } finally {
      appStore.hideLoading();
    }
  },

  /**
   * 特定のERDレイアウトを更新して保存
   */
  async saveErdLayout(erdId, layoutContent) {
    if (!erdId) return;
    appStore.updateErdContent(erdId, layoutContent);
    return await this.saveProject();
  },

  /**
   * 全スキーマ配列を取得
   */
  getAllSchemas() {
    const schemasMap = appStore.state.schemas || new Map();
    return Array.from(schemasMap.entries()).map(([filename, entry]) => ({
      id: filename,
      filename,
      name: entry.model?.project?.name || filename,
      dbml: entry.dbml,
      model: entry.model,
      visible: entry.visible,
    }));
  },

  /**
   * 特定のスキーマを取得
   */
  getSchema(schemaName) {
    const schemasMap = appStore.state.schemas || new Map();
    const entry = schemasMap.get(schemaName);
    if (!entry) return null;
    return {
      id: schemaName,
      filename: schemaName,
      name: entry.model?.project?.name || schemaName,
      dbml: entry.dbml,
      model: entry.model,
      project: entry.model?.project,
      tables: entry.model?.tables || [],
      tableGroups: entry.model?.tableGroups || [],
      notes: entry.model?.notes || [],
      refs: entry.model?.refs || [],
    };
  },

  /**
   * 現在のアクティブスキーマを取得
   */
  getActiveSchema() {
    const activeName = appStore.state.activeSchema;
    if (!activeName) return null;
    return this.getSchema(activeName);
  },
};
