// 日本語コメント: テーブル一覧ビューコンポーネント (src/components/table-list/table-list-view.js)
// v1に準拠したグリッドテーブル（固定ヘッダー、列幅リサイズ、リンク遷移、削除）形式で
// 全テーブルの一覧、基本サマリー、新規作成、削除を提供します。
// Shadow DOM は使わず Light DOM で動作します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { escapeHtml } from '../../core/html-utils.js';
import { bindSearchClear } from '../../core/search-clear.js';
import { TABLE_COLOR_PRESETS, renderTableColorBar } from '../../core/table-colors.js';

export class DbeTableListView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.searchQuery = '';
    this.colorFilter = 'all';

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-table-list-view';

    this.element.innerHTML = `
      <div class="table-list-header">
        <h2 id="table-list-heading">
          <span>📋</span>
          <span id="table-list-title-text">${t('table_list.title')}</span>
        </h2>
        <div class="table-list-header-actions" style="display: flex; gap: 0.75rem; align-items: center;">
          <select id="table-list-color-filter" class="table-list-color-filter" title="${t('table_color.label')}" aria-label="${t('table_color.label')}">
            <option value="all">${t('table_color.filter_all')}</option>
            <option value="none">${t('table_color.filter_none')}</option>
            ${TABLE_COLOR_PRESETS.map(p => `<option value="${p.color.toLowerCase()}">${t(p.labelKey)}</option>`).join('')}
          </select>
          <div class="dbe-search-input-wrap">
            <input
              type="text"
              id="table-list-search-input"
              class="table-list-search-input"
              placeholder="${t('table_list.search_placeholder')}"
            />
            <button type="button" id="btn-table-list-search-clear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
          </div>
          <button class="primary" id="btn-list-add-table">
            + ${t('table_list.btn_add_table')}
          </button>
        </div>
      </div>

      <div class="table-list-body" id="table-list-body" style="flex: 1; min-height: 0; display: flex; flex-direction: column;"></div>
      <div class="table-list-footer" id="table-list-footer"></div>
    `;

    this.container.appendChild(this.element);
    this.updateGrid();
  }

  bindEvents() {
    const addBtn = this.element.querySelector('#btn-list-add-table');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        appStore.emit('table:create:request');
      });
    }

    const searchInput = this.element.querySelector('#table-list-search-input');
    const clearBtn = this.element.querySelector('#btn-table-list-search-clear');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.filterRows();
      });
      bindSearchClear(searchInput, clearBtn);
    }

    const colorFilterEl = this.element.querySelector('#table-list-color-filter');
    if (colorFilterEl) {
      colorFilterEl.addEventListener('change', (e) => {
        this.colorFilter = e.target.value || 'all';
        this.filterRows();
      });
    }
  }

  /**
   * 検索クエリおよびカラーフィルタによる行の絞り込み
   */
  filterRows() {
    const query = this.searchQuery || '';
    const colorFilter = this.colorFilter || 'all';
    const rows = this.element.querySelectorAll('#schema-table-grid tbody tr');
    rows.forEach(tr => {
      if (tr.querySelector('.empty-table-cell')) return;
      const name = tr.getAttribute('data-table-name') || '';
      const logical = tr.getAttribute('data-table-logical') || '';
      const note = tr.getAttribute('data-table-note') || '';
      const tblColor = (tr.getAttribute('data-table-color') || '').toLowerCase();

      const matchText = !query
        || name.toLowerCase().includes(query)
        || logical.toLowerCase().includes(query)
        || note.toLowerCase().includes(query);

      let matchColor = true;
      if (colorFilter === 'none') {
        matchColor = !tblColor;
      } else if (colorFilter !== 'all') {
        matchColor = tblColor === colorFilter;
      }

      tr.style.display = (matchText && matchColor) ? '' : 'none';
    });
  }

  bindStore() {
    appStore.on('model:updated', () => this.updateGrid());
    appStore.on('schemas:updated', () => this.updateGrid());
    appStore.on('schema:changed', () => this.updateGrid());
    appStore.on('projectMeta:updated', () => this.updateGrid());
    appStore.on('project:empty', () => this.updateGrid());
  }

  updateGrid() {
    const bodyContainer = this.element.querySelector('#table-list-body');
    const footerContainer = this.element.querySelector('#table-list-footer');
    const headerTitle = this.element.querySelector('#table-list-title-text');
    const addBtn = this.element.querySelector('#btn-list-add-table');
    const searchInput = this.element.querySelector('#table-list-search-input');

    if (!bodyContainer) return;

    // 1. プロジェクト未作成 (0個) の場合
    if (appStore.state.isEmptyProject || !appStore.state.projectMeta) {
      if (headerTitle) headerTitle.textContent = t('project.no_project_title');
      if (addBtn) addBtn.style.display = 'none';
      if (searchInput) searchInput.style.display = 'none';
      if (footerContainer) footerContainer.innerHTML = '';

      bodyContainer.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">📁</div>
          <p style="font-size: 1.15rem; font-weight: bold; margin-bottom: 0.5rem;">${t('project.no_project_title')}</p>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 450px; margin-left: auto; margin-right: auto;">
            ${t('project.no_project_desc')}
          </p>
          <button class="primary" id="btn-empty-create-project" style="padding: 0.6rem 1.4rem; font-size: 0.95rem;">
            ✨ ${t('project.btn_create_project')}
          </button>
        </div>
      `;

      const createProjBtn = bodyContainer.querySelector('#btn-empty-create-project');
      if (createProjBtn) {
        createProjBtn.addEventListener('click', () => {
          appStore.emit('project:create:request');
        });
      }
      return;
    }

    // 2. プロジェクトはあるがスキーマ未登録 (0個) の場合
    const schemasCount = appStore.state.schemas?.size || 0;
    if (schemasCount === 0) {
      if (headerTitle) headerTitle.textContent = t('project.no_schema_title');
      if (addBtn) addBtn.style.display = 'none';
      if (searchInput) searchInput.style.display = 'none';
      if (footerContainer) footerContainer.innerHTML = '';

      bodyContainer.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🗄️</div>
          <p style="font-size: 1.15rem; font-weight: bold; margin-bottom: 0.5rem;">${t('project.no_schema_title')}</p>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 450px; margin-left: auto; margin-right: auto;">
            ${t('project.no_schema_desc')}
          </p>
          <button class="primary" id="btn-empty-create-schema" style="padding: 0.6rem 1.4rem; font-size: 0.95rem;">
            + ${t('project.btn_create_schema')}
          </button>
        </div>
      `;

      const createSchemaBtn = bodyContainer.querySelector('#btn-empty-create-schema');
      if (createSchemaBtn) {
        createSchemaBtn.addEventListener('click', () => {
          appStore.emit('schema:create:request');
        });
      }
      return;
    }

    // 3. 通常時：テーブル一覧（表形式）
    if (addBtn) addBtn.style.display = 'inline-block';
    if (searchInput) searchInput.style.display = 'inline-block';

    const activeSchema = appStore.state.activeSchema;
    if (headerTitle) {
      headerTitle.textContent = activeSchema
        ? t('table_list.title_with_schema', { schema: activeSchema })
        : t('table_list.title');
    }

    const tables = appStore.state.tables || [];
    const showLogical = metadataManager.isLogicalNameEnabled();
    const colCount = showLogical ? 6 : 5;

    // 行HTMLの組み立て
    const rowsHtml = tables.length === 0
      ? `<tr><td colspan="${colCount}" class="empty-table-cell">${t('table_list.empty_title')}</td></tr>`
      : tables.map(tbl => {
        const fieldCount = tbl.fields?.length || 0;
        const indexCount = tbl.indexes?.length || 0;

        // Noteから <!-- custom --> を除外して本文のみ抽出
        let noteText = '';
        if (tbl.note) {
          noteText = typeof tbl.note === 'object' ? (tbl.note.value || '') : String(tbl.note);
        }
        if (noteText.includes('<!-- custom -->')) {
          noteText = noteText.split('<!-- custom -->')[0].trim();
        }

        const logicalDisp = tbl.logicalName
          ? escapeHtml(tbl.logicalName)
          : `<span class="placeholder-text">${t('table_list.placeholder_logical_name')}</span>`;

        const noteDisp = noteText
          ? escapeHtml(noteText)
          : `<span class="placeholder-text">${t('table_list.placeholder_note')}</span>`;

        const tblColor = (tbl.headerColor || tbl.headercolor || '').trim();

        return `
          <tr data-table-name="${escapeHtml(tbl.name)}" data-table-logical="${escapeHtml(tbl.logicalName || '')}" data-table-note="${escapeHtml(noteText)}" data-table-color="${escapeHtml(tblColor.toLowerCase())}">
            <td title="${escapeHtml(tbl.name)}">
              <a class="table-name-link" data-name="${escapeHtml(tbl.name)}">${renderTableColorBar(tblColor)}<span>${escapeHtml(tbl.name)}</span></a>
            </td>
            ${showLogical ? `<td title="${escapeHtml(tbl.logicalName || '')}">${logicalDisp}</td>` : ''}
            <td style="text-align: right;" title="${fieldCount}">${fieldCount}</td>
            <td style="text-align: right;" title="${indexCount}">${indexCount}</td>
            <td title="${escapeHtml(noteText)}">${noteDisp}</td>
            <td style="text-align: center;">
              <button class="btn-table-delete" data-name="${escapeHtml(tbl.name)}">${t('table_list.btn_delete')}</button>
            </td>
          </tr>
        `;
      }).join('');

    bodyContainer.innerHTML = `
      <div class="table-wrapper">
        <table class="schema-table" id="schema-table-grid">
          <thead>
            <tr>
              <th class="resizable" style="width: ${showLogical ? '25%' : '35%'};">
                ${t('table_list.col_name')}
                <div class="resizer"></div>
              </th>
              ${showLogical ? `
              <th class="resizable" style="width: 22%;">
                ${t('table_list.col_logical_name')}
                <div class="resizer"></div>
              </th>` : ''}
              <th class="resizable" style="width: 10%; text-align: right;">
                ${t('table_list.col_columns')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 11%; text-align: right;">
                ${t('table_list.col_indexes')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: ${showLogical ? '24%' : '36%'};">
                ${t('table_list.col_note')}
                <div class="resizer"></div>
              </th>
              <th style="width: 8%; text-align: center;">
                ${t('table_list.col_actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    // 統計情報の集計
    const totalCols = tables.reduce((acc, t) => acc + (t.fields?.length || 0), 0);
    const totalIdxs = tables.reduce((acc, t) => acc + (t.indexes?.length || 0), 0);
    const totalRefs = (appStore.state.refs || []).length;

    if (footerContainer) {
      footerContainer.innerHTML = `
        <div class="table-list-stats-bar">
          <span class="stats-title">📊 ${t('table_list.stats_title')}</span>
          <span class="stats-item">${t('schema_dashboard.table_count')} <b>${tables.length}</b></span>
          <span class="stats-divider">|</span>
          <span class="stats-item">${t('table_list.stats_total_cols')} <b>${totalCols}</b></span>
          <span class="stats-divider">|</span>
          <span class="stats-item">${t('table_list.stats_total_idxs')} <b>${totalIdxs}</b></span>
          <span class="stats-divider">|</span>
          <span class="stats-item">${t('table_list.stats_total_refs')} <b>${totalRefs}</b></span>
        </div>
      `;
    }

    // 検索フィルタの適用
    this.filterRows();

    // テーブル名リンククリックイベント
    bodyContainer.querySelectorAll('.table-name-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const tblName = link.getAttribute('data-name');
        if (tblName) {
          appStore.emit('table:select', tblName);
        }
      });
    });

    // 削除ボタンクリックイベント
    bodyContainer.querySelectorAll('.btn-table-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const tblName = btn.getAttribute('data-name');
        if (tblName) {
          this.handleDeleteTable(tblName);
        }
      });
    });

    // 列幅リサイズハンドルの初期化
    this.initResizableColumns();
  }

  /**
   * テーブル各列の手動ドラッグリサイズ機能
   */
  initResizableColumns() {
    const table = this.element.querySelector('#schema-table-grid');
    if (!table) return;

    const cols = table.querySelectorAll('th');

    cols.forEach(col => {
      const resizer = col.querySelector('.resizer');
      if (!resizer) return;

      let startX = 0;
      let startWidthPx = 0;
      let tableWidthPx = 0;

      const onMouseMove = (e) => {
        const deltaX = e.clientX - startX;
        const newWidthPx = startWidthPx + deltaX;
        if (newWidthPx > 45) {
          const newWidthPct = (newWidthPx / tableWidthPx) * 100;
          col.style.width = `${newWidthPct}%`;
        }
      };

      const onMouseUp = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        resizer.classList.remove('resizing');
      };

      resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX;
        tableWidthPx = table.offsetWidth;
        startWidthPx = col.offsetWidth;

        // 全ての列の幅をパーセンテージに固定して計算準備
        cols.forEach(c => {
          const pct = (c.offsetWidth / tableWidthPx) * 100;
          c.style.width = `${pct}%`;
        });

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        resizer.classList.add('resizing');
        e.preventDefault();
      });
    });
  }

  /**
   * テーブル削除処理
   */
  async handleDeleteTable(tableName) {
    const confirmMsg = t('table_list.delete_confirm', { name: tableName });
    if (!confirm(confirmMsg)) return;

    try {
      // 日本語コメント: 大文字小文字を区別せず削除対象テーブル・関連外部キー・TableGroup内テーブル参照を除去
      const targetUpper = String(tableName || '').toUpperCase();
      const currentTables = appStore.state.tables || [];
      const newTables = currentTables.filter(t => String(t.name || '').toUpperCase() !== targetUpper);

      const currentRefs = appStore.state.refs || [];
      const newRefs = currentRefs.filter(ref => {
        const ep0 = String(ref.endpoints?.[0]?.tableName || '').toUpperCase();
        const ep1 = String(ref.endpoints?.[1]?.tableName || '').toUpperCase();
        return ep0 !== targetUpper && ep1 !== targetUpper;
      });

      const currentGroups = appStore.state.tableGroups || [];
      const newTableGroups = currentGroups.map(group => {
        const groupTables = Array.isArray(group.tables) ? group.tables : [];
        return {
          ...group,
          tables: groupTables.filter(gt => {
            const gtName = typeof gt === 'string' ? gt : (gt?.tableName || gt?.name || '');
            return String(gtName).toUpperCase() !== targetUpper;
          }),
        };
      });

      // モデル更新
      appStore.setModel({
        project: appStore.state.project,
        tables: newTables,
        tableGroups: newTableGroups,
        notes: appStore.state.notes,
        refs: newRefs,
      });

      // サーバーへ自動保存
      await projectService.saveProject();
      // 日本語コメント: テーブル削除完了ステータスメッセージの多言語化
      appStore.emit('status:message', t('table_list.status_deleted', { name: tableName }));
    } catch (err) {
      // 日本語コメント: テーブル削除失敗ダイアログの多言語化
      alert(t('table_list.alert_delete_failed', { error: err.message }));
    }
  }
}
