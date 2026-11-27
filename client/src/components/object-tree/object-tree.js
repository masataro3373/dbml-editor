// 日本語コメント: オブジェクトツリーコンポーネント (src/components/object-tree/object-tree.js)
// v1 アーキテクチャに準拠した階層構造 (Project -> Schemas -> Schema -> Tables/TableGroups/Notes, ERDs)
// を Light DOM で描画し、スキーマごとの独立管理とテーブル選択を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { dialectManager } from '../../dialects/index.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';
import { bindSearchClear } from '../../core/search-clear.js';
import { renderTableColorBar } from '../../core/table-colors.js';

export class DbeObjectTree {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.treeRoot = null;
    this.schemaModalElement = null; // 日本語コメント: 画面中央表示のため document.body 直下にマウントするモーダル要素

    this.searchQueries = {};     // スキーマごとの検索キーワード
    this.sortModes = {};         // スキーマごとのソートモード ('group' | 'flat')
    this.activeMenuSchema = null; // メニュー表示対象のスキーマ名
    this.selectedItem = null;     // { type, id, name }

    this.savedScrollTop = 0;     // スクロール位置保持用
    this.openStates = new Map(); // 各 details 要素の開閉状態保持用 (Map<nodeKey, boolean>)
    this._suppressRenderOnSwitch = false; // スキーマ切替時の renderTree 抑制フラグ

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-object-tree';

    this.element.innerHTML = `
      <div class="tree-header">
        <div class="tree-header-title">
          <span>📦</span>
          <span>${t('tree.project_title')}</span>
        </div>
      </div>

      <div class="tree-container" id="tree-root"></div>

      <!-- 表示オプション用ドロップダウンメニュー -->
      <div class="dropdown-menu" id="tree-dropdown-menu">
        <div class="dropdown-item" id="menu-sort-group">
          <span>${t('tree.menu_sort_group')}</span>
          <span class="dropdown-item-check" id="check-group"></span>
        </div>
        <div class="dropdown-item" id="menu-sort-name">
          <span>${t('tree.menu_sort_name')}</span>
          <span class="dropdown-item-check" id="check-flat"></span>
        </div>
      </div>
    `;

    this.treeRoot = this.element.querySelector('#tree-root');

    // スクロール位置の自動追従
    this.treeRoot.addEventListener('scroll', () => {
      this.savedScrollTop = this.treeRoot.scrollTop;
    });

    this.container.appendChild(this.element);

    // 日本語コメント: 新規スキーマ作成モーダルは左ツリー領域(overflow:hidden)に閉じ込められないよう document.body 直下にマウントする
    const existingModal = document.getElementById('tree-schema-modal');
    if (existingModal) existingModal.remove();

    this.schemaModalElement = document.createElement('div');
    this.schemaModalElement.className = 'dbe-modal-overlay';
    this.schemaModalElement.id = 'tree-schema-modal';
    this.schemaModalElement.style.display = 'none';
    this.schemaModalElement.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="tree-schema-modal-title">
        <div class="dbe-modal-header">
          <h3 id="tree-schema-modal-title">📁 ${t('tree.modal_add_schema_title')}</h3>
          <button type="button" class="dbe-modal-close" id="btn-close-new-schema" aria-label="${t('common.close')}">&times;</button>
        </div>
        <div class="dbe-modal-body">
          <div class="dbe-form-field">
            <label for="input-new-schema-name">
              ${t('tree.schema_filename')}
              <span class="dbe-required-mark">*</span>
            </label>
            <input type="text" id="input-new-schema-name" placeholder="auth / billing..." />
          </div>
          <div class="dbe-form-field">
            <label for="select-new-schema-dbms">${t('tree.schema_dbms')}</label>
            <select id="select-new-schema-dbms"></select>
          </div>
          <div class="dbe-form-error" id="new-schema-error" style="display: none;" role="alert"></div>
        </div>
        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-new-schema">${t('common.cancel')}</button>
          <button type="button" class="primary" id="btn-submit-new-schema">${t('common.add')}</button>
        </div>
      </div>
    `;

    // 方言セレクトボックス初期化
    const dbmsSelect = this.schemaModalElement.querySelector('#select-new-schema-dbms');
    const dialects = dialectManager.getAll();
    dbmsSelect.innerHTML = dialects.map(d => `<option value="${d.dbmlDatabaseType}">${d.displayName}</option>`).join('');

    document.body.appendChild(this.schemaModalElement);
  }

  bindEvents() {
    // 新規スキーマモーダル表示
    const schemaModal = this.schemaModalElement;
    const inputSchemaName = schemaModal.querySelector('#input-new-schema-name');
    const dbmsSelect = schemaModal.querySelector('#select-new-schema-dbms');
    const errorSchemaBox = schemaModal.querySelector('#new-schema-error');
    const closeSchemaBtn = schemaModal.querySelector('#btn-close-new-schema');
    const cancelSchemaBtn = schemaModal.querySelector('#btn-cancel-new-schema');
    const submitSchemaBtn = schemaModal.querySelector('#btn-submit-new-schema');

    // 日本語コメント: モーダル内エラーメッセージの表示制御ヘルパー
    const setSchemaError = (message) => {
      if (!errorSchemaBox) return;
      if (message) {
        errorSchemaBox.textContent = message;
        errorSchemaBox.style.display = 'block';
      } else {
        errorSchemaBox.textContent = '';
        errorSchemaBox.style.display = 'none';
      }
    };

    const closeAddSchemaModal = () => {
      schemaModal.style.display = 'none';
      setSchemaError('');
    };

    const openAddSchemaModal = () => {
      inputSchemaName.value = '';
      setSchemaError('');
      if (submitSchemaBtn) submitSchemaBtn.disabled = false;
      schemaModal.style.display = 'flex';
      inputSchemaName.focus();
    };

    const submitAddSchema = async () => {
      const filename = inputSchemaName.value.trim();
      if (!filename) {
        setSchemaError(t('tree.err_filename_required'));
        inputSchemaName.focus();
        return;
      }
      setSchemaError('');
      if (submitSchemaBtn) submitSchemaBtn.disabled = true;
      const databaseType = dbmsSelect.value;
      try {
        await projectService.createSchema({ filename, databaseType });
        closeAddSchemaModal();
      } catch (err) {
        setSchemaError(t('tree.err_create_failed', { error: err.message }));
      } finally {
        if (submitSchemaBtn) submitSchemaBtn.disabled = false;
      }
    };

    this.openAddSchemaModal = openAddSchemaModal;

    closeSchemaBtn?.addEventListener('click', closeAddSchemaModal);
    cancelSchemaBtn?.addEventListener('click', closeAddSchemaModal);
    // 日本語コメント: Escape キーでのキャンセル閉じに対応
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && schemaModal && schemaModal.style.display === 'flex') {
        closeAddSchemaModal();
      }
    });

    inputSchemaName?.addEventListener('input', () => setSchemaError(''));
    inputSchemaName?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitAddSchema();
      }
    });

    submitSchemaBtn?.addEventListener('click', submitAddSchema);

    // ドロップダウンメニュー外クリック時の自動クローズ
    document.addEventListener('click', (e) => {
      const dropdown = this.element.querySelector('#tree-dropdown-menu');
      const isMenuTrigger = e.target.classList.contains('menu-trigger');
      if (dropdown && !dropdown.contains(e.target) && !isMenuTrigger) {
        this.closeMenu();
      }
    });

    // ドロップダウンメニュー内：グループ化表示クリック
    const menuSortGroup = this.element.querySelector('#menu-sort-group');
    if (menuSortGroup) {
      menuSortGroup.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeMenuSchema) {
          this.sortModes[this.activeMenuSchema] = 'group';
          this.renderTree();
        }
        this.closeMenu();
      });
    }

    // ドロップダウンメニュー内：テーブル名順ソートクリック
    const menuSortName = this.element.querySelector('#menu-sort-name');
    if (menuSortName) {
      menuSortName.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.activeMenuSchema) {
          this.sortModes[this.activeMenuSchema] = 'flat';
          this.renderTree();
        }
        this.closeMenu();
      });
    }
  }

  /**
   * オプションメニューを開く
   */
  openMenu(event, triggerElement, schemaName) {
    this.activeMenuSchema = schemaName;
    const dropdown = this.element.querySelector('#tree-dropdown-menu');
    const menuSortName = this.element.querySelector('#menu-sort-name');
    const menuSortGroup = this.element.querySelector('#menu-sort-group');
    const checkFlat = this.element.querySelector('#check-flat');
    const checkGroup = this.element.querySelector('#check-group');

    const currentMode = this.sortModes[schemaName] || 'group';
    if (currentMode === 'flat') {
      menuSortName.classList.add('active');
      menuSortGroup.classList.remove('active');
      checkFlat.textContent = '✓';
      checkGroup.textContent = '';
    } else {
      menuSortName.classList.remove('active');
      menuSortGroup.classList.add('active');
      checkFlat.textContent = '';
      checkGroup.textContent = '✓';
    }

    const treeRect = this.element.getBoundingClientRect();
    const triggerRect = triggerElement.getBoundingClientRect();

    const topPos = triggerRect.bottom - treeRect.top;
    let leftPos = triggerRect.right - treeRect.left - 130;
    if (leftPos < 4) leftPos = 4;

    dropdown.style.top = `${topPos + 4}px`;
    dropdown.style.left = `${leftPos}px`;
    dropdown.style.display = 'block';
  }

  /**
   * オプションメニューを閉じる
   */
  closeMenu() {
    const dropdown = this.element.querySelector('#tree-dropdown-menu');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
    this.activeMenuSchema = null;
  }

  bindStore() {
    appStore.on('schema:create:request', () => {
      if (this.openAddSchemaModal) {
        this.openAddSchemaModal();
      }
    });
    appStore.on('schemas:updated', () => this.renderTree());
    // スキーマ変更時はツリーを全再構築せずインプレースでハイライト更新（スクロール位置リセット防止）
    appStore.on('schema:changed', () => this.highlightActive());
    // スキーマ切替によるmodel:updatedでなければツリーを再描画
    appStore.on('model:updated', () => {
      if (!this._suppressRenderOnSwitch) {
        this.renderTree();
      }
    });
    appStore.on('projectMeta:updated', () => this.renderTree());
    appStore.on('erds:updated', () => this.renderTree());

    appStore.on('erd:changed', (erd) => {
      if (erd) {
        this.selectedItem = { type: 'Erd', id: erd.id, name: erd.name };
        this.highlightActive();
      }
    });

    appStore.on('erd:select', (erdId) => {
      const erd = appStore.state.erds?.get(erdId);
      this.selectedItem = { type: 'Erd', id: erdId, name: erd?.name || erdId };
      this.highlightActive();
    });

    appStore.on('table:select', (tblName) => {
      const name = typeof tblName === 'object' && tblName !== null ? tblName.tableName : tblName;
      this.selectedItem = { type: 'Table', name, schema: appStore.state.activeSchema };
      this.highlightActive();
    });

    appStore.on('tableGroup:select', (payload) => {
      const { groupName, schemaName } = typeof payload === 'object' && payload !== null ? payload : { groupName: payload, schemaName: appStore.state.activeSchema };
      this.selectedItem = { type: 'TableGroup', name: groupName, schema: schemaName || appStore.state.activeSchema };
      this.highlightActive();
    });

    appStore.on('note:select', (payload) => {
      const { noteName, schemaName } = typeof payload === 'object' && payload !== null ? payload : { noteName: payload, schemaName: appStore.state.activeSchema };
      this.selectedItem = { type: 'Note', name: noteName, schema: schemaName || appStore.state.activeSchema };
      this.highlightActive();
    });
  }

  /**
   * スキーマを静かに切り替え（ツリー全体のDOM再構築を抑止しインプレースハイライト更新）
   * @param {string} schemaName
   */
  switchSchemaSilently(schemaName) {
    if (appStore.state.activeSchema !== schemaName) {
      this._suppressRenderOnSwitch = true;
      try {
        appStore.switchSchema(schemaName);
      } finally {
        this._suppressRenderOnSwitch = false;
      }
      this.highlightActive();
    }
  }

  /**
   * details 要素の開閉状態（open属性）を保持・同期
   * @param {HTMLDetailsElement} details
   * @param {string} nodeKey
   * @param {boolean} defaultOpen
   */
  bindDetailsOpenState(details, nodeKey, defaultOpen = true) {
    details.setAttribute('data-node-key', nodeKey);
    const isOpen = this.openStates.has(nodeKey) ? this.openStates.get(nodeKey) : defaultOpen;
    details.open = isOpen;
    details.addEventListener('toggle', () => {
      this.openStates.set(nodeKey, details.open);
    });
  }

  /**
   * summary クリック補助 (矢印のみ開閉トグル、ラベルクリック時は選択イベント)
   */
  bindSummaryEvents(details, summary, onSelect) {
    summary.addEventListener('click', (e) => {
      const isToggle = e.target.classList.contains('toggle-icon');
      const isMenu = e.target.classList.contains('menu-trigger');
      if (isMenu) {
        e.preventDefault();
        return;
      }
      if (!isToggle) {
        // ラベルクリック時はデフォルトの開閉をキャンセルし、選択を実行
        e.preventDefault();
        if (onSelect) onSelect(e);
      }
    });

    // ダブルクリックで開閉
    summary.addEventListener('dblclick', (e) => {
      e.preventDefault();
      details.open = !details.open;
      const nodeKey = details.getAttribute('data-node-key');
      if (nodeKey) {
        this.openStates.set(nodeKey, details.open);
      }
    });
  }

  /**
   * v1 完全準拠の階層ツリー描画
   */
  renderTree() {
    if (!this.treeRoot) return;
    const prevScrollTop = this.treeRoot ? (this.treeRoot.scrollTop || this.savedScrollTop || 0) : (this.savedScrollTop || 0);
    const prevContainerScroll = this.container ? this.container.scrollTop : 0;
    this.treeRoot.innerHTML = '';

    // プロジェクト未作成 (0個) の場合
    if (appStore.state.isEmptyProject || !appStore.state.projectMeta) {
      const noProjDetails = document.createElement('details');
      this.bindDetailsOpenState(noProjDetails, 'no-project', true);

      const noProjSummary = document.createElement('summary');
      noProjSummary.innerHTML = `
        <span class="summary-content">
          <span class="icon">📁</span>
          <span style="color: var(--text-muted); font-style: italic;">${t('tree.no_project')}</span>
        </span>
      `;
      noProjDetails.appendChild(noProjSummary);
      this.treeRoot.appendChild(noProjDetails);
      return;
    }

    const projectMeta = appStore.state.projectMeta || {};
    const projectName = projectMeta.info?.name || 'Project';
    const schemasMap = appStore.state.schemas || new Map();
    const activeSchema = appStore.state.activeSchema;

    // --- ルート: Project details ---
    const projDetails = document.createElement('details');
    this.bindDetailsOpenState(projDetails, 'project', true);

    const projSummary = document.createElement('summary');
    projSummary.innerHTML = `
      <span class="summary-content">
        <span class="toggle-icon">▶</span>
        <span class="icon">📁</span>
        <b>${escapeHtml(projectName)}</b>
      </span>
    `;
    this.bindSummaryEvents(projDetails, projSummary, () => {
      appStore.emit('project:select');
    });
    projDetails.appendChild(projSummary);

    const projChildren = document.createElement('div');
    projChildren.className = 'tree-children';

    // ==========================================
    // 1. スキーマセクション (Schemas)
    // ==========================================
    const schemasDetails = document.createElement('details');
    this.bindDetailsOpenState(schemasDetails, 'schemas', true);

    // 表示対象スキーマ数の集計
    const schemasSummary = document.createElement('summary');
    schemasSummary.innerHTML = `
      <span class="summary-content">
        <span class="toggle-icon">▶</span>
        <span class="icon">📁</span>
        <b>${t('tree.schemas_title')}</b>
      </span>
    `;
    this.bindSummaryEvents(schemasDetails, schemasSummary, () => {
      this.selectedItem = { type: 'Schemas' };
      this.highlightActive();
      appStore.emit('schema:list:request');
    });
    schemasDetails.appendChild(schemasSummary);

    const schemasChildren = document.createElement('div');
    schemasChildren.className = 'tree-children';

    // スキーマが0個の場合
    if (schemasMap.size === 0) {
      const emptySchemaEl = document.createElement('div');
      emptySchemaEl.className = 'tree-empty-placeholder';
      emptySchemaEl.textContent = t('tree.no_schemas');
      schemasChildren.appendChild(emptySchemaEl);
    }

    for (const [schemaName, schemaData] of schemasMap.entries()) {
      // ツリー非表示フラグが設定されているスキーマはスキップ
      if (schemaData.visible === false) continue;

      const model = schemaData.model || {};
      const tables = model.tables || [];
      const tableGroups = model.tableGroups || [];
      const notes = model.notes || [];
      const dbType = model.project?.databaseType || 'standard';
      const isActive = schemaName === activeSchema;

      const schemaDetails = document.createElement('details');
      this.bindDetailsOpenState(schemaDetails, 'schema:' + schemaName, true);
      schemaDetails.setAttribute('data-schema-name', schemaName);

      const schemaSummary = document.createElement('summary');
      schemaSummary.className = `schema-summary ${isActive ? 'active-schema' : ''}`;
      schemaSummary.setAttribute('data-schema-name', schemaName);
      schemaSummary.innerHTML = `
        <span class="summary-content">
          <span class="toggle-icon">▶</span>
          <span class="icon">🗄️</span>
          <span>${escapeHtml(schemaName)}</span>
          <span class="schema-badge">${escapeHtml(dbType)}</span>
        </span>
      `;

      // スキーマ選択イベント（DOM全再構築を抑止してインプレース切替）
      this.bindSummaryEvents(schemaDetails, schemaSummary, () => {
        this.switchSchemaSilently(schemaName);
        appStore.emit('schema:select', schemaName);
      });

      schemaDetails.appendChild(schemaSummary);

      const schemaChildren = document.createElement('div');
      schemaChildren.className = 'tree-children';

      // ----------------------------------------
      // 1-A. テーブルセクション (Tables)
      // ----------------------------------------
      const tablesDetails = document.createElement('details');
      this.bindDetailsOpenState(tablesDetails, 'tables:' + schemaName, true);

      const tablesSummary = document.createElement('summary');
      tablesSummary.innerHTML = `
        <span class="summary-content">
          <span class="toggle-icon">▶</span>
          <span class="icon">📊</span>
          <span>${t('tree.tables_title')}</span>
        </span>
        <span class="tree-table-summary-right">
          <span class="menu-trigger" title="${t('tree.option_menu')}">...</span>
        </span>
      `;

      // 「...」メニューボタンのイベント登録
      const menuTrigger = tablesSummary.querySelector('.menu-trigger');
      if (menuTrigger) {
        menuTrigger.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.openMenu(e, menuTrigger, schemaName);
        });
      }

      this.bindSummaryEvents(tablesDetails, tablesSummary, () => {
        this.switchSchemaSilently(schemaName);
        appStore.emit('view:mode:change', 'list');
      });
      tablesDetails.appendChild(tablesSummary);

      const tablesChildren = document.createElement('div');
      tablesChildren.className = 'tree-children';

      // インクリメンタル検索ボックス
      const searchBox = document.createElement('div');
      searchBox.className = 'search-container';
      const searchWrap = document.createElement('div');
      searchWrap.className = 'dbe-search-input-wrap';
      const searchInput = document.createElement('input');
      searchInput.className = 'search-input';
      searchInput.type = 'text';
      searchInput.placeholder = t('tree.search_placeholder');
      searchInput.value = this.searchQueries[schemaName] || '';

      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'dbe-search-clear-btn';
      clearBtn.innerHTML = '&times;';
      clearBtn.title = t('table_group_modal.filter_clear');
      clearBtn.setAttribute('aria-label', t('table_group_modal.filter_clear'));

      searchWrap.appendChild(searchInput);
      searchWrap.appendChild(clearBtn);
      searchBox.appendChild(searchWrap);
      tablesChildren.appendChild(searchBox);

      const tableListDiv = document.createElement('div');

      const sortMode = this.sortModes[schemaName] || 'group';
      const filterWord = (this.searchQueries[schemaName] || '').toLowerCase().trim();
      searchInput.addEventListener('input', (e) => {
        this.searchQueries[schemaName] = e.target.value;
        const currentSort = this.sortModes[schemaName] || 'group';
        this.renderTableItems(tableListDiv, tables, tableGroups, schemaName, e.target.value.toLowerCase().trim(), currentSort);
      });
      bindSearchClear(searchInput, clearBtn);

      this.renderTableItems(tableListDiv, tables, tableGroups, schemaName, filterWord, sortMode);
      tablesChildren.appendChild(tableListDiv);

      tablesDetails.appendChild(tablesChildren);
      schemaChildren.appendChild(tablesDetails);

      // ----------------------------------------
      // 1-B. テーブルグループセクション (TableGroup) ★メンテ対応
      // ----------------------------------------
      const tgDetails = document.createElement('details');
      this.bindDetailsOpenState(tgDetails, 'tg:' + schemaName, false);

      const tgSummary = document.createElement('summary');
      tgSummary.innerHTML = `
        <span class="summary-content">
          <span class="toggle-icon">▶</span>
          <span class="icon">📁</span>
          <span>${t('tree.table_groups_title')}</span>
        </span>
      `;
      this.bindSummaryEvents(tgDetails, tgSummary, () => {
        this.switchSchemaSilently(schemaName);
        appStore.emit('tableGroup:list:request', { schemaName });
      });
      tgDetails.appendChild(tgSummary);

      const tgChildren = document.createElement('div');
      tgChildren.className = 'tree-children';

      if (tableGroups.length > 0) {
        tableGroups.forEach(group => {
          const item = document.createElement('div');
          item.className = 'tree-item';
          item.setAttribute('data-group-name', group.name);
          item.setAttribute('data-schema-name', schemaName);
          const isGroupActive = this.selectedItem?.type === 'TableGroup'
            && this.selectedItem?.name === group.name
            && (!this.selectedItem?.schema || this.selectedItem?.schema === schemaName);
          if (isGroupActive) item.classList.add('active');

          const dispName = group.name;
          item.innerHTML = `
            <span class="tree-item-label">
              <span class="icon">📁</span>
              <span>${escapeHtml(dispName)}</span>
            </span>
          `;
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.switchSchemaSilently(schemaName);
            this.selectedItem = { type: 'TableGroup', name: group.name, schema: schemaName };
            this.highlightActive();
            appStore.emit('tableGroup:select', {
              schemaName,
              groupName: group.name,
              group,
            });
          });
          tgChildren.appendChild(item);
        });
      } else {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'tree-empty-placeholder';
        emptyEl.textContent = t('tree.no_table_groups');
        tgChildren.appendChild(emptyEl);
      }

      tgDetails.appendChild(tgChildren);
      schemaChildren.appendChild(tgDetails);

      // ----------------------------------------
      // 1-C. ノートセクション (Notes)
      // ----------------------------------------
      const notesDetails = document.createElement('details');
      this.bindDetailsOpenState(notesDetails, 'notes:' + schemaName, false);

      const notesSummary = document.createElement('summary');
      notesSummary.innerHTML = `
        <span class="summary-content">
          <span class="toggle-icon">▶</span>
          <span class="icon">📝</span>
          <span>${t('tree.notes_title')}</span>
        </span>
      `;
      this.bindSummaryEvents(notesDetails, notesSummary, () => {
        this.switchSchemaSilently(schemaName);
        appStore.emit('note:list:request', { schemaName });
      });
      notesDetails.appendChild(notesSummary);

      const notesChildren = document.createElement('div');
      notesChildren.className = 'tree-children';

      if (notes.length > 0) {
        notes.forEach(note => {
          const item = document.createElement('div');
          item.className = 'tree-item';
          item.setAttribute('data-note-name', note.name);
          item.setAttribute('data-schema-name', schemaName);

          // 日本語コメント: ER図キャンバスへのスキーマノート(DBML Note)のDrag & Drop配置をサポート
          item.setAttribute('draggable', 'true');
          item.addEventListener('dragstart', (e) => {
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('text/plain', JSON.stringify({
              type: 'Note',
              schema: schemaName,
              noteName: note.name,
            }));
          });

          const isNoteActive = this.selectedItem?.type === 'Note'
            && this.selectedItem?.name === note.name
            && (!this.selectedItem?.schema || this.selectedItem?.schema === schemaName);
          if (isNoteActive) item.classList.add('active');

          item.innerHTML = `
            <span class="tree-item-label">
              <span class="icon">📝</span>
              <span>${escapeHtml(note.name || 'Note')}</span>
            </span>
          `;
          item.addEventListener('click', (e) => {
            e.stopPropagation();
            this.switchSchemaSilently(schemaName);
            this.selectedItem = { type: 'Note', name: note.name, schema: schemaName };
            this.highlightActive();
            appStore.emit('note:select', {
              schemaName,
              noteName: note.name,
              note,
            });
          });
          notesChildren.appendChild(item);
        });
      } else {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'tree-empty-placeholder';
        emptyEl.textContent = t('tree.no_notes');
        notesChildren.appendChild(emptyEl);
      }

      notesDetails.appendChild(notesChildren);
      schemaChildren.appendChild(notesDetails);

      schemaDetails.appendChild(schemaChildren);
      schemasChildren.appendChild(schemaDetails);
    }

    schemasDetails.appendChild(schemasChildren);
    projChildren.appendChild(schemasDetails);

    // ==========================================
    // 2. ER図セクション (ER Diagrams)
    // ==========================================
    const erdsList = Array.from(appStore.state.erds?.values() || []);
    const erdsDetails = document.createElement('details');
    this.bindDetailsOpenState(erdsDetails, 'erds', true);

    const erdsSummary = document.createElement('summary');
    erdsSummary.className = 'schema-summary';
    erdsSummary.innerHTML = `
      <span class="summary-content">
        <span class="toggle-icon">▶</span>
        <span class="icon">📁</span>
        <b>${t('tree.erds_title')}</b>
      </span>
    `;
    this.bindSummaryEvents(erdsDetails, erdsSummary, () => {
      this.selectedItem = { type: 'Erds' };
      this.highlightActive();
      appStore.emit('erd:list:request');
    });

    erdsDetails.appendChild(erdsSummary);

    const erdsChildren = document.createElement('div');
    erdsChildren.className = 'tree-children';

    if (erdsList.length > 0) {
      erdsList.forEach(erd => {
        const item = document.createElement('div');
        item.className = `tree-item ${this.selectedItem?.type === 'Erd' && this.selectedItem?.id === erd.id ? 'active' : ''}`;
        item.setAttribute('data-erd-id', erd.id);
        item.innerHTML = `
          <span class="tree-item-label" style="flex:1; display:flex; align-items:center; gap:6px; overflow:hidden;">
            <span class="icon">🗺️</span>
            <span class="tree-item-name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(erd.name || erd.filename)}</span>
          </span>
          <button type="button" class="btn-erd-delete" title="${t('tree.btn_delete_erd')}" style="background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:12px; padding:0 4px; display:none;">✕</button>
        `;

        const btnDelete = item.querySelector('.btn-erd-delete');
        item.addEventListener('mouseenter', () => { btnDelete.style.display = 'inline-block'; });
        item.addEventListener('mouseleave', () => { btnDelete.style.display = 'none'; });

        btnDelete.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(t('tree.erd_delete_confirm', { name: erd.name || erd.filename }))) {
            try {
              await projectService.deleteErd(erd.id);
            } catch (err) {
              alert(t('tree.err_erd_delete_failed', { error: err.message || err }));
            }
          }
        });

        item.addEventListener('click', () => {
          this.selectedItem = { type: 'Erd', id: erd.id, name: erd.name };
          this.highlightActive();
          appStore.switchErd(erd.id);
          appStore.emit('erd:select', erd.id);
        });

        erdsChildren.appendChild(item);
      });
    } else {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-empty-placeholder';
      emptyEl.textContent = t('tree.no_erds');
      erdsChildren.appendChild(emptyEl);
    }

    erdsDetails.appendChild(erdsChildren);
    projChildren.appendChild(erdsDetails);

    projDetails.appendChild(projChildren);
    this.treeRoot.appendChild(projDetails);

    this.highlightActive();

    // スクロール位置の復元
    if (this.treeRoot) {
      this.treeRoot.scrollTop = prevScrollTop;
      this.savedScrollTop = prevScrollTop;
    }
    if (this.container) {
      this.container.scrollTop = prevContainerScroll;
    }
    requestAnimationFrame(() => {
      if (this.treeRoot) {
        this.treeRoot.scrollTop = prevScrollTop;
      }
    });
  }

  /**
   * テーブル一覧の描画 (グループ化 または フラットソート)
   */
  renderTableItems(container, tables, tableGroups, schemaName, query, sortMode = 'group') {
    container.innerHTML = '';

    const filteredTables = tables.filter(t => {
      if (!query) return true;
      const matchName = t.name.toLowerCase().includes(query);
      const matchNote = (t.note || '').toLowerCase().includes(query);
      return matchName || matchNote;
    });

    if (filteredTables.length === 0) {
      const emptyEl = document.createElement('div');
      emptyEl.className = 'tree-empty-placeholder';
      emptyEl.textContent = t('tree.no_tables');
      container.appendChild(emptyEl);
      return;
    }

    // A. グループ化表示モード (グループが存在する場合)
    if (sortMode === 'group' && tableGroups.length > 0) {
      tableGroups.forEach(tg => {
        const matched = filteredTables.filter(t => {
          return tg.tables && tg.tables.some(gt => {
            const gtName = typeof gt === 'object' ? (gt.name || gt.tableName) : String(gt);
            return gtName === t.name;
          });
        });

        if (matched.length > 0 || !query) {
          const groupDetails = document.createElement('details');
          this.bindDetailsOpenState(groupDetails, 'group:' + schemaName + ':' + tg.name, true);

          const groupSummary = document.createElement('summary');
          const dispName = tg.name;
          groupSummary.innerHTML = `
            <span class="summary-content">
              <span class="toggle-icon">▶</span>
              <span class="icon">📁</span>
              <span>${escapeHtml(dispName)}</span>
            </span>
          `;
          this.bindSummaryEvents(groupDetails, groupSummary, () => {
            this.switchSchemaSilently(schemaName);
            this.selectedItem = { type: 'TableGroup', name: tg.name, schema: schemaName };
            this.highlightActive();
            appStore.emit('tableGroup:select', { schemaName, groupName: tg.name, group: tg });
          });
          groupDetails.appendChild(groupSummary);

          const groupChildren = document.createElement('div');
          groupChildren.className = 'tree-children';

          matched.forEach(tbl => {
            groupChildren.appendChild(this.createTableItem(tbl, schemaName));
          });

          groupDetails.appendChild(groupChildren);
          container.appendChild(groupDetails);
        }
      });

      // 未分類テーブル
      const ungrouped = filteredTables.filter(t => {
        return !tableGroups.some(tg => {
          return tg.tables && tg.tables.some(gt => {
            const gtName = typeof gt === 'object' ? (gt.name || gt.tableName) : String(gt);
            return gtName === t.name;
          });
        });
      });

      if (ungrouped.length > 0) {
        const unDetails = document.createElement('details');
        this.bindDetailsOpenState(unDetails, 'ungrouped:' + schemaName, true);
        const unSummary = document.createElement('summary');
        unSummary.innerHTML = `
          <span class="summary-content">
            <span class="toggle-icon">▶</span>
            <span class="icon">📁</span>
            <span>${t('tree.ungrouped')}</span>
          </span>
        `;
        this.bindSummaryEvents(unDetails, unSummary, null);
        unDetails.appendChild(unSummary);

        const unChildren = document.createElement('div');
        unChildren.className = 'tree-children';
        ungrouped.forEach(tbl => {
          unChildren.appendChild(this.createTableItem(tbl, schemaName));
        });
        unDetails.appendChild(unChildren);
        container.appendChild(unDetails);
      }
    } else {
      // B. フラット表示 (テーブル名順)
      const sortedTables = [...filteredTables].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
      sortedTables.forEach(tbl => {
        container.appendChild(this.createTableItem(tbl, schemaName));
      });
    }
  }

  /**
   * 個別テーブルアイテムの作成
   * ER図へのDrag & Drop配置に対応するため draggable="true" と dragstart を設定
   */
  createTableItem(table, schemaName) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.setAttribute('data-table-name', table.name);
    item.setAttribute('data-schema-name', schemaName);

    // ER図キャンバスへのドラッグ＆ドロップ配置をサポート
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/plain', JSON.stringify({
        type: 'Table',
        schema: schemaName,
        tableName: table.name,
      }));
    });

    const isCurrentActive = this.selectedItem?.type === 'Table'
      && this.selectedItem?.name === table.name
      && this.selectedItem?.schema === schemaName;

    if (isCurrentActive) {
      item.classList.add('active');
    }

    const dispName = table.logicalName ? `${table.name} (${table.logicalName})` : table.name;
    const tblColor = (table.headerColor || table.headercolor || '').trim();

    item.innerHTML = `
      <span class="tree-item-label">
        <span class="icon">📄</span>
        ${renderTableColorBar(tblColor)}
        <span>${escapeHtml(dispName)}</span>
      </span>
    `;

    item.addEventListener('click', (e) => {
      e.stopPropagation();
      // 他スキーマのテーブルなら静かにスキーマ切り替え
      this.switchSchemaSilently(schemaName);
      this.selectedItem = { type: 'Table', name: table.name, schema: schemaName };
      this.highlightActive();
      appStore.emit('table:select', table.name);
    });

    return item;
  }

  /**
   * アクティブ状態のハイライト更新 (Schema, Table, TableGroup, Note, Erd)
   */
  highlightActive() {
    if (!this.treeRoot) return;

    // 1. スキーマサマリーの .active-schema をインプレース更新
    const currentActiveSchema = appStore.state.activeSchema;
    const schemaSummaries = this.treeRoot.querySelectorAll('.schema-summary[data-schema-name]');
    schemaSummaries.forEach(sSummary => {
      const scName = sSummary.getAttribute('data-schema-name');
      if (scName === currentActiveSchema) {
        sSummary.classList.add('active-schema');
      } else {
        sSummary.classList.remove('active-schema');
      }
    });

    // 2. 各 tree-item の .active をインプレース更新
    const items = this.treeRoot.querySelectorAll('.tree-item');
    items.forEach(el => {
      const tblName = el.getAttribute('data-table-name');
      const grpName = el.getAttribute('data-group-name');
      const noteName = el.getAttribute('data-note-name');
      const erdId = el.getAttribute('data-erd-id');
      const scName = el.getAttribute('data-schema-name');

      let isMatch = false;

      if (tblName && scName) {
        isMatch = this.selectedItem?.type === 'Table'
          && this.selectedItem?.name === tblName
          && (!this.selectedItem?.schema || this.selectedItem?.schema === scName);
      } else if (grpName) {
        isMatch = this.selectedItem?.type === 'TableGroup'
          && this.selectedItem?.name === grpName
          && (!this.selectedItem?.schema || !scName || this.selectedItem?.schema === scName);
      } else if (noteName) {
        isMatch = this.selectedItem?.type === 'Note'
          && this.selectedItem?.name === noteName
          && (!this.selectedItem?.schema || !scName || this.selectedItem?.schema === scName);
      } else if (erdId) {
        isMatch = this.selectedItem?.type === 'Erd'
          && (this.selectedItem?.id === erdId || this.selectedItem?.name === erdId);
      }

      if (isMatch) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  }
}
