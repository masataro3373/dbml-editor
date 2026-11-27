// 日本語コメント: テーブルグループ一覧ビュー (src/components/table-group-list/table-group-list-view.js)
// スキーマ内のテーブルグループを表形式（グリッド）で一覧表示し、詳細遷移、新規作成、削除などの操作を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';
import './table-group-list-view.css';

export class DbeTableGroupListView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.tableGroups = [];
    this.schemaName = '';

    // 列幅の初期値 (テーブルグループ名 / 内包するテーブル数 / 操作)
    this.columnWidths = {
      name: 380,
      count: 160,
      actions: 100,
    };

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-table-group-list-view';

    this.element.innerHTML = `
      <div class="tg-list-header">
        <div class="tg-list-title-area">
          <h2 id="tg-list-title">${t('table_group_list.title')}</h2>
          <span class="tg-list-badge" id="tg-list-count">0</span>
        </div>
        <div class="tg-list-actions">
          <button type="button" class="tg-btn-primary" id="btn-add-table-group">
            <span>➕</span>
            <span>${t('table_group_list.btn_add_group')}</span>
          </button>
        </div>
      </div>

      <div class="tg-list-content" id="tg-list-content-area">
        <!-- テーブルグループ一覧または空表示 -->
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // 新規作成ボタン
    this.element.querySelector('#btn-add-table-group').addEventListener('click', () => {
      appStore.emit('tableGroup:create:request', { schemaName: this.schemaName });
    });

    // ストアの変更購読
    appStore.on('model:updated', () => {
      if (this.element && this.element.style.display !== 'none') {
        this.update();
      }
    });

    appStore.on('schema:switched', () => {
      if (this.element && this.element.style.display !== 'none') {
        this.update();
      }
    });
  }

  /**
   * 画面の更新表示
   * @param {string|null} schemaName 
   */
  update(schemaName = null) {
    if (schemaName) {
      this.schemaName = schemaName;
    } else {
      this.schemaName = appStore.state.activeSchema || '';
    }

    this.tableGroups = appStore.state.tableGroups || [];

    const titleEl = this.element.querySelector('#tg-list-title');
    const countBadge = this.element.querySelector('#tg-list-count');
    const contentArea = this.element.querySelector('#tg-list-content-area');

    titleEl.textContent = this.schemaName 
      ? t('table_group_list.title_with_schema', { schema: this.schemaName })
      : t('table_group_list.title');
    countBadge.textContent = String(this.tableGroups.length);

    contentArea.innerHTML = '';

    if (this.tableGroups.length === 0) {
      // 空状態表示
      contentArea.innerHTML = `
        <div class="tg-empty-state">
          <div class="tg-empty-icon">📁</div>
          <div class="tg-empty-title">${t('table_group_list.empty_title')}</div>
          <div class="tg-empty-desc">${t('table_group_list.empty_desc')}</div>
          <button type="button" class="tg-btn-primary" id="btn-empty-add-table-group">
            <span>➕</span>
            <span>${t('table_group_list.btn_add_group')}</span>
          </button>
        </div>
      `;
      contentArea.querySelector('#btn-empty-add-table-group')?.addEventListener('click', () => {
        appStore.emit('tableGroup:create:request', { schemaName: this.schemaName });
      });
      return;
    }

    // テーブルグリッドの構築
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'tg-table-wrapper';

    const table = document.createElement('table');
    table.className = 'tg-grid-table';

    // thead
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th style="width: ${this.columnWidths.name}px" data-col="name">
          ${t('table_group_list.col_name')}
          <div class="tg-col-resizer"></div>
        </th>
        <th style="width: ${this.columnWidths.count}px" data-col="count">
          ${t('table_group_list.col_tables_count')}
          <div class="tg-col-resizer"></div>
        </th>
        <th style="width: ${this.columnWidths.actions}px; text-align: center;" data-col="actions">
          ${t('table_group_list.col_actions')}
        </th>
      </tr>
    `;
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    this.tableGroups.forEach(tg => {
      const tr = document.createElement('tr');

      const rawTables = tg.tables || [];
      const tableNames = rawTables.map(t => typeof t === 'object' && t !== null ? (t.name || t.tableName) : String(t)).filter(Boolean);

      tr.innerHTML = `
        <td>
          <a class="tg-group-link" data-group-name="${escapeHtml(tg.name)}">
            <span>📁</span>
            <strong>${escapeHtml(tg.name)}</strong>
          </a>
        </td>
        <td>
          <span class="tg-list-badge">${t('table_group_list.count_badge', { count: tableNames.length })}</span>
        </td>
        <td style="text-align: center;">
          <button type="button" class="tg-action-btn-delete" data-group-name="${escapeHtml(tg.name)}" title="${t('table_group_list.btn_delete')}">
            ${t('table_group_list.btn_delete')}
          </button>
        </td>
      `;

      // グループリンククリック → 詳細画面へ
      tr.querySelector('.tg-group-link').addEventListener('click', (e) => {
        e.preventDefault();
        appStore.emit('tableGroup:select', {
          schemaName: this.schemaName,
          groupName: tg.name,
          group: tg,
        });
      });

      // 削除ボタンクリック
      tr.querySelector('.tg-action-btn-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleDeleteGroup(tg.name);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    contentArea.appendChild(tableWrapper);

    // 列幅リサイズハンドラの初期化
    this.initColumnResize(table);
  }

  /**
   * テーブルグループの削除処理
   * @param {string} groupName 
   */
  async handleDeleteGroup(groupName) {
    const msg = t('table_group_list.delete_confirm', { name: groupName });
    if (!confirm(msg)) {
      return;
    }

    const updatedGroups = (appStore.state.tableGroups || []).filter(g => g.name !== groupName);

    try {
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: updatedGroups,
        refs: appStore.state.refs,
      });

      await projectService.saveProject();
      this.update();
    } catch (err) {
      console.error('テーブルグループ削除エラー:', err);
      // 日本語コメント: テーブルグループ削除失敗アラートの多言語化
      alert(t('table_group_list.alert_delete_failed', { error: err.message || err }));
    }
  }

  /**
   * カラムドラッグリサイズの初期化
   * @param {HTMLTableElement} table 
   */
  initColumnResize(table) {
    const resizers = table.querySelectorAll('.tg-col-resizer');
    resizers.forEach(resizer => {
      resizer.addEventListener('mousedown', (e) => {
        e.preventDefault();
        resizer.classList.add('is-resizing');

        const th = resizer.parentElement;
        const colKey = th.getAttribute('data-col');
        const startX = e.pageX;
        const startWidth = th.offsetWidth;

        const onMouseMove = (moveEvent) => {
          const newWidth = Math.max(70, startWidth + (moveEvent.pageX - startX));
          th.style.width = `${newWidth}px`;
          if (colKey) {
            this.columnWidths[colKey] = newWidth;
          }
        };

        const onMouseUp = () => {
          resizer.classList.remove('is-resizing');
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      });
    });
  }

  show() {
    this.element.style.display = 'flex';
    this.update();
  }

  hide() {
    this.element.style.display = 'none';
  }
}
