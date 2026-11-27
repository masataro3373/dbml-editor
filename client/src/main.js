// 日本語コメント: クライアント側メインエントリポイント (src/main.js)
// v1アーキテクチャに準拠した4ペインレイアウト (Header, ObjectTree, Content, Footer) をマウントし、
// ビューモードの切り替えおよびイベント連携を調停する軽量なオーケストレーターです。

import { initTheme } from './core/theme.js';
import { logger } from './core/logger.js';
import { t } from './core/i18n.js';
import { appStore } from './core/store.js';
import { authManager } from './core/auth.js';
import { projectService } from './core/project-service.js';
import { clientConfigService } from './core/config-service.js';
import { dialectManager } from './dialects/index.js';
import { pluginManager } from './core/plugin-manager.js';
import { initSidebarResizer } from './core/ui-resizer.js';

import { LoadingOverlay } from './components/loading-overlay/loading-overlay.js';
import { AuthModal } from './components/auth-modal/auth-modal.js';
import { DbeHeader } from './components/header/header.js';
import { DbeFooter } from './components/footer/footer.js';
import { DbeObjectTree } from './components/object-tree/object-tree.js';
import { DbeProjectView } from './components/project-view/project-view.js';
import { DbeSchemaListView } from './components/schema-list/schema-list-view.js';
import { DbeSchemaView } from './components/schema-view/schema-view.js';
import { DbeTableListView } from './components/table-list/table-list-view.js';
import { DbeTableView } from './components/table-view/table-view.js';
import { DbeTableEditorView } from './components/table-editor/table-editor-view.js';
import { DbeDbmlPreview } from './components/dbml-preview/dbml-preview.js';
import { DbeImportModal } from './components/import-modal/import-modal.js';
import { DbeExportModal } from './components/export-modal/export-modal.js';
import { SettingsModal } from './components/settings-modal/settings-modal.js';
import { ProjectModal } from './components/project-modal/project-modal.js';
import { SchemaModal } from './components/schema-modal/schema-modal.js';
import { TableGroupModal } from './components/table-group-modal/table-group-modal.js';
import { DbeTableGroupListView } from './components/table-group-list/table-group-list-view.js';
import { DbeTableGroupView } from './components/table-group-view/table-group-view.js';
import { NoteModal } from './components/note-modal/note-modal.js';
import { DbeNoteListView } from './components/note-list/note-list-view.js';
import { DbeNoteView } from './components/note-view/note-view.js';
import { DbeErdListView } from './components/erd-list/erd-list-view.js';
import { DbeErdView } from './components/erd-view/erd-view.js';
import { ErdModal } from './components/erd-modal/erd-modal.js';
import { DbeMigrationView } from './components/migration-view/migration-view.js';
import { DbeQueryVisualizer } from './components/query-visualizer/query-visualizer.js';
import { DbePlaygroundView } from './components/playground-view/playground-view.js';

let authModal = null;
let projectViewComponent = null;
let schemaListViewComponent = null;
let schemaViewComponent = null;
let tableViewComponent = null;
let tableEditorComponent = null;
let tableGroupListViewComponent = null;
let tableGroupViewComponent = null;
let noteListViewComponent = null;
let noteViewComponent = null;
let erdListViewComponent = null;
let erdViewComponent = null;
let migrationViewComponent = null;
let queryVisViewComponent = null;
let playgroundViewComponent = null;
let projectModal = null;
let schemaModal = null;
let tableGroupModal = null;
let noteModal = null;
let erdModal = null;
let currentViewMode = 'list';
let previousViewMode = 'list';

/**
 * 4ペインレイアウトの初期化とコンポーネント配置
 */
function setupMainLayout(appContainer) {
  appContainer.innerHTML = `
    <div class="main-layout">
      <div class="pane-header" id="pane-header"></div>
      <div class="pane-sidebar" id="pane-sidebar"></div>
      <div class="pane-resizer" id="pane-sidebar-resizer" title="${t('app.sidebar_resizer_tip')}"></div>
      <div class="pane-content" id="pane-content">
        <div id="slot-project-view" style="display: none;"></div>
        <div id="slot-schema-list" style="display: none;"></div>
        <div id="slot-schema-view" style="display: none;"></div>
        <div id="slot-table-list" style="display: block;"></div>
        <div id="slot-table-view" style="display: none;"></div>
        <div id="slot-table-editor" style="display: none;"></div>
        <div id="slot-table-group-list" style="display: none;"></div>
        <div id="slot-table-group-view" style="display: none;"></div>
        <div id="slot-note-list" style="display: none;"></div>
        <div id="slot-note-view" style="display: none;"></div>
        <div id="slot-erd-list" style="display: none;"></div>
        <div id="slot-erd-view" style="display: none; height: 100%;"></div>
        <div id="slot-dbml-preview" style="display: none; height: 100%;"></div>
        <div id="slot-migration-view" style="display: none; height: 100%;"></div>
        <div id="slot-query-visualizer" style="display: none; height: 100%;"></div>
        <div id="slot-playground-view" style="display: none; height: 100%;"></div>
      </div>
      <div class="pane-footer" id="pane-footer"></div>
    </div>
  `;

  const mainLayout = appContainer.querySelector('.main-layout');
  const sidebarResizer = appContainer.querySelector('#pane-sidebar-resizer');
  // 日本語コメント: サイドバーのドラッグリサイザー（スプリッター）を初期化
  initSidebarResizer(mainLayout, sidebarResizer);

  const headerPane = appContainer.querySelector('#pane-header');
  const sidebarPane = appContainer.querySelector('#pane-sidebar');
  const footerPane = appContainer.querySelector('#pane-footer');

  const slotProject = appContainer.querySelector('#slot-project-view');
  const slotSchemaList = appContainer.querySelector('#slot-schema-list');
  const slotSchema = appContainer.querySelector('#slot-schema-view');
  const slotList = appContainer.querySelector('#slot-table-list');
  const slotView = appContainer.querySelector('#slot-table-view');
  const slotEditor = appContainer.querySelector('#slot-table-editor');
  const slotTableGroupList = appContainer.querySelector('#slot-table-group-list');
  const slotTableGroupView = appContainer.querySelector('#slot-table-group-view');
  const slotNoteList = appContainer.querySelector('#slot-note-list');
  const slotNoteView = appContainer.querySelector('#slot-note-view');
  const slotErdList = appContainer.querySelector('#slot-erd-list');
  const slotErd = appContainer.querySelector('#slot-erd-view');
  const slotPreview = appContainer.querySelector('#slot-dbml-preview');
  const slotMigration = appContainer.querySelector('#slot-migration-view');
  const slotQueryVis = appContainer.querySelector('#slot-query-visualizer');
  const slotPlayground = appContainer.querySelector('#slot-playground-view');

  // 各ペインコンポーネントのマウント (Light DOM)
  new DbeHeader(headerPane);
  new DbeObjectTree(sidebarPane);
  new DbeFooter(footerPane);

  projectViewComponent = new DbeProjectView(slotProject);
  schemaListViewComponent = new DbeSchemaListView(slotSchemaList);
  schemaViewComponent = new DbeSchemaView(slotSchema);
  new DbeTableListView(slotList);
  tableViewComponent = new DbeTableView(slotView);
  tableEditorComponent = new DbeTableEditorView(slotEditor);
  tableGroupListViewComponent = new DbeTableGroupListView(slotTableGroupList);
  tableGroupViewComponent = new DbeTableGroupView(slotTableGroupView);
  noteListViewComponent = new DbeNoteListView(slotNoteList);
  noteViewComponent = new DbeNoteView(slotNoteView);
  erdListViewComponent = new DbeErdListView(slotErdList);
  erdViewComponent = new DbeErdView(slotErd);
  new DbeDbmlPreview(slotPreview);
  migrationViewComponent = new DbeMigrationView(slotMigration);
  queryVisViewComponent = new DbeQueryVisualizer(slotQueryVis);
  playgroundViewComponent = new DbePlaygroundView(slotPlayground);

  // インポート / エクスポート / 個人設定 / プロジェクト設定 / スキーマ設定 / テーブルグループ設定 / ノート作成 / ER図作成 モーダルのマウント (Light DOM)
  new DbeImportModal(document.body);
  new DbeExportModal(document.body);
  new SettingsModal(document.body);
  projectModal = new ProjectModal(document.body);
  schemaModal = new SchemaModal(document.body);
  tableGroupModal = new TableGroupModal(document.body);
  noteModal = new NoteModal(document.body);
  erdModal = new ErdModal(document.body);

  setupViewRouting(appContainer);
}

/**
 * 中央コンテンツペインの表示切り替えルーティング
 */
function setupViewRouting(appContainer) {
  const slots = {
    project: appContainer.querySelector('#slot-project-view'),
    schemaList: appContainer.querySelector('#slot-schema-list'),
    schema: appContainer.querySelector('#slot-schema-view'),
    list: appContainer.querySelector('#slot-table-list'),
    view: appContainer.querySelector('#slot-table-view'),
    edit: appContainer.querySelector('#slot-table-editor'),
    tableGroupList: appContainer.querySelector('#slot-table-group-list'),
    tableGroupView: appContainer.querySelector('#slot-table-group-view'),
    noteList: appContainer.querySelector('#slot-note-list'),
    noteView: appContainer.querySelector('#slot-note-view'),
    erdList: appContainer.querySelector('#slot-erd-list'),
    erd: appContainer.querySelector('#slot-erd-view'),
    preview: appContainer.querySelector('#slot-dbml-preview'),
    migration: appContainer.querySelector('#slot-migration-view'),
    queryVis: appContainer.querySelector('#slot-query-visualizer'),
    playground: appContainer.querySelector('#slot-playground-view'),
  };

  function switchView(mode) {
    const prevMode = currentViewMode;
    if (prevMode === 'playground' && mode !== 'playground' && playgroundViewComponent?.close) {
      // 日本語コメント: Playground 離脱時に大量DOMや進行中パースを解放し、復帰後の動作軽量化を図る
      playgroundViewComponent.close();
    }
    if (prevMode === 'migration' && mode !== 'migration' && migrationViewComponent?.close) {
      // 日本語コメント: マイグレーションツール離脱時に大量DOMやDiff結果を解放し、復帰後の動作軽量化を図る
      migrationViewComponent.close();
    }
    if (currentViewMode !== 'migration' && currentViewMode !== 'queryVis' && currentViewMode !== 'playground' && currentViewMode !== 'preview') {
      previousViewMode = currentViewMode;
    }
    currentViewMode = mode;
    Object.entries(slots).forEach(([m, el]) => {
      if (el) el.style.display = m === mode ? (m === 'preview' || m === 'erd' || m === 'migration' || m === 'queryVis' || m === 'playground' ? 'flex' : 'block') : 'none';
    });
  }

  // マイグレーションビュー表示要求
  appStore.on('migration:open:request', () => {
    if (migrationViewComponent) {
      migrationViewComponent.open();
    }
    switchView('migration');
  });

  // クエリビジュアライザー表示要求
  appStore.on('query-vis:open:request', () => {
    if (queryVisViewComponent) {
      queryVisViewComponent.open();
    }
    switchView('queryVis');
  });

  // Playground 表示要求
  appStore.on('playground:open:request', () => {
    if (playgroundViewComponent) {
      playgroundViewComponent.open();
    }
    switchView('playground');
  });

  // エディタ復帰要求
  appStore.on('view:restore', () => {
    switchView(previousViewMode || 'list');
  });

  // プロジェクト選択 -> プロジェクトダッシュボード表示
  appStore.on('project:select', () => {
    if (projectViewComponent) projectViewComponent.update();
    switchView('project');
  });

  // スキーマ一覧表示要求
  appStore.on('schema:list:request', () => {
    if (schemaListViewComponent) schemaListViewComponent.update();
    switchView('schemaList');
  });

  // ER図一覧表示要求
  appStore.on('erd:list:request', () => {
    if (erdListViewComponent) erdListViewComponent.update();
    switchView('erdList');
  });

  // スキーマ選択 -> スキーマ詳細ダッシュボード表示
  appStore.on('schema:select', (schemaName) => {
    if (schemaViewComponent) schemaViewComponent.setSchema(schemaName);
    switchView('schema');
  });

  // テーブル選択 -> 詳細ビュー表示
  appStore.on('table:select', (payload) => {
    const tableName = typeof payload === 'object' && payload !== null ? payload.tableName : payload;
    const table = (appStore.state.tables || []).find(t => t.name === tableName);
    if (table) {
      tableViewComponent.setTable(table);
      switchView('view');
    }
  });

  // テーブル編集要求 -> 編集画面表示
  appStore.on('table:edit:request', (tableName) => {
    const table = (appStore.state.tables || []).find(t => t.name === tableName);
    if (table) {
      tableEditorComponent.setTable(table);
      switchView('edit');
    }
  });

  // 新規テーブル作成要求 -> 編集画面 (新規モード) 表示
  appStore.on('table:create:request', () => {
    tableEditorComponent.setTable(null);
    switchView('edit');
  });

  // テーブルグループ一覧表示要求
  appStore.on('tableGroup:list:request', (payload) => {
    const schemaName = typeof payload === 'object' && payload !== null ? payload.schemaName : payload;
    if (tableGroupListViewComponent) {
      tableGroupListViewComponent.update(schemaName);
    }
    switchView('tableGroupList');
  });

  // テーブルグループ詳細表示要求
  appStore.on('tableGroup:select', (payload) => {
    const { groupName, schemaName } = typeof payload === 'object' && payload !== null ? payload : { groupName: payload };
    if (tableGroupViewComponent) {
      tableGroupViewComponent.update(groupName, schemaName);
    }
    switchView('tableGroupView');
  });

  // テーブルグループ新規作成要求
  appStore.on('tableGroup:create:request', (payload) => {
    const schemaName = typeof payload === 'object' && payload !== null ? payload.schemaName : payload;
    if (tableGroupModal) {
      tableGroupModal.open(null, schemaName);
    }
  });

  // テーブルグループ編集要求
  appStore.on('tableGroup:edit:request', ({ group, schemaName }) => {
    if (tableGroupModal) {
      tableGroupModal.open(group, schemaName);
    }
  });

  // テーブルグループ保存完了時
  appStore.on('tableGroup:saved', ({ group }) => {
    if (currentViewMode === 'tableGroupView' && group) {
      tableGroupViewComponent.update(group.name);
    } else if (currentViewMode === 'tableGroupList') {
      tableGroupListViewComponent.update();
    }
  });

  // ノート一覧表示要求
  appStore.on('note:list:request', (payload) => {
    const schemaName = typeof payload === 'object' && payload !== null ? payload.schemaName : payload;
    if (noteListViewComponent) {
      noteListViewComponent.update(schemaName);
    }
    switchView('noteList');
  });

  // ノート詳細表示要求
  appStore.on('note:select', (payload) => {
    const { noteName, schemaName } = typeof payload === 'object' && payload !== null ? payload : { noteName: payload };
    if (noteViewComponent) {
      noteViewComponent.update(noteName, schemaName);
    }
    switchView('noteView');
  });

  // ノート新規作成要求
  appStore.on('note:create:request', (payload) => {
    const schemaName = typeof payload === 'object' && payload !== null ? payload.schemaName : payload;
    if (noteModal) {
      noteModal.open(schemaName);
    }
  });

  // ナビゲーションタブ切替 (list / preview)
  appStore.on('view:mode:change', (mode) => {
    switchView(mode);
  });

  // ER図新規作成要求
  appStore.on('erd:create:request', () => {
    if (erdModal) {
      erdModal.show(() => {
        switchView('erd');
      });
    }
  });

  // ER図選択要求 -> ERDビュー表示
  appStore.on('erd:select', () => {
    switchView('erd');
  });

  // ER図切り替え時 -> ERDビュー表示（解除時はERDビュー表示中ならプロジェクト画面へ遷移）
  appStore.on('erd:changed', (erd) => {
    if (erd) {
      switchView('erd');
    } else if (currentViewMode === 'erd') {
      // 日本語コメント: 表示中のER図が削除・クリアされた場合はプロジェクトダッシュボードへ戻す
      if (projectViewComponent) projectViewComponent.update();
      switchView('project');
    }
  });

  // スキーマ切り替え時 -> 詳細・編集画面中なら一覧ビューに切り替え
  appStore.on('schema:changed', () => {
    if (
      currentViewMode === 'view' ||
      currentViewMode === 'edit' ||
      currentViewMode === 'tableGroupView' ||
      currentViewMode === 'noteView'
    ) {
      switchView('list');
    }
  });

  // プロジェクト設定モーダル表示要求
  appStore.on('project:settings:open', () => {
    if (projectModal) {
      projectModal.show();
    }
  });

  // スキーマ設定モーダル表示要求
  appStore.on('schema:settings:open', (schemaName) => {
    if (schemaModal) {
      schemaModal.show(schemaName);
    }
  });

  // プロジェクト保存要求
  appStore.on('project:save:request', async () => {
    try {
      await projectService.saveProject();
      appStore.emit('status:message', t('project.save_success'));
    } catch (err) {
      alert(t('project.err_save_failed', { error: err.message }));
    }
  });

  // ログアウト要求
  appStore.on('auth:logout:request', async () => {
    // 日本語コメント: ログアウト前に未保存の変更(dirty)が存在する場合のみ自動保存を実行して未保存データの消失を防止
    if (appStore.state.isProjectLoaded && !appStore.state.isEmptyProject && appStore.state.projectMeta && appStore.hasDirtyChanges()) {
      try {
        await projectService.saveProject();
      } catch (err) {
        logger.warn('Auth', 'ログアウト前のプロジェクト自動保存をスキップしました', err);
      }
    }
    await authManager.logout();
    const appContainer = document.getElementById('app');
    if (appContainer) {
      // 日本語コメント: ログアウト時にメイン画面を隠して背景透け・ちらつきを防止
      appContainer.style.visibility = 'hidden';
    }
    authModal.show();
  });
}

/**
 * アプリケーション起動
 */
async function bootstrap() {
  // アプリ設定の読み込み
  await clientConfigService.loadConfig();
  appStore.setConfig(clientConfigService.get());

  // テーマの初期化 (設定ファイルの defaultTheme をフォールバックとして適用)
  initTheme(clientConfigService.defaultTheme);

  // 方言マネージャーの連携とプラグイン初期化
  pluginManager.setDialectManager(dialectManager);
  await pluginManager.init();

  // デフォルト方言の適用
  dialectManager.setDefaultDialect(clientConfigService.defaultDialect);
  if (!appStore.state.activeDialect) {
    appStore.setActiveDialect(dialectManager.getById(clientConfigService.defaultDialect));
  }

  logger.info('App', 'DBML Editor 起動開始');

  const appContainer = document.getElementById('app');
  const loadingContainer = document.getElementById('loading-overlay-container');
  const authContainer = document.getElementById('auth-modal-container');

  // グローバルオーバーレイのマウント
  new LoadingOverlay(loadingContainer);
  authModal = new AuthModal(authContainer);
  await authModal.init();

  // 日本語コメント: セッション確認完了までメイン画面を非表示にし、未ログイン時のちらつきを防止
  appContainer.style.visibility = 'hidden';

  // 4ペインレイアウトの構築
  setupMainLayout(appContainer);

  // ログインセッション確認
  const user = await authManager.checkSession();
  if (!user) {
    authModal.show({ immediate: true });
  } else {
    appContainer.style.visibility = '';
    // ログイン済みならプロジェクトをロード
    await projectService.loadProject().catch(err => {
      logger.warn('Bootstrap', '初期プロジェクト読み込みスキップ', err);
    });
  }

  // ログイン成功時のイベント購読
  appStore.on('user:changed', async (newUser) => {
    if (newUser) {
      appContainer.style.visibility = '';
      await projectService.loadProject().catch(err => {
        logger.warn('Auth', 'プロジェクトロード失敗', err);
      });
    }
  });

  logger.info('App', 'DBML Editor 起動完了');
}

bootstrap().catch((err) => {
  console.error('[Bootstrap:ERROR]', err);
  logger.error('Bootstrap', '初期化エラー', err);
});
