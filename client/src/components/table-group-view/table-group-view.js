// 日本語コメント: テーブルグループ詳細ビュー (src/components/table-group-view/table-group-view.js)
// 選択されたテーブルグループの詳細情報および所属テーブル一覧を表示し、テーブル遷移やグループ編集を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';
import './table-group-view.css';

export class DbeTableGroupView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentGroupName = null;
    this.schemaName = '';

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-table-group-view';

    this.element.innerHTML = `
      <div class="tg-view-header">
        <div class="tg-view-header-left">
          <button type="button" class="tg-btn-back" id="btn-tg-back">
            <span>←</span>
            <span>${t('table_group_view.btn_back')}</span>
          </button>
          <div class="tg-view-title-area">
            <h2>
              <span>📁</span>
              <span id="tg-view-name">Group Name</span>
            </h2>
          </div>
        </div>

        <div class="tg-view-header-right">
          <button type="button" class="tg-btn-action tg-btn-edit" id="btn-tg-edit">
            <span>${t('table_group_view.btn_edit')}</span>
          </button>
          <button type="button" class="tg-btn-action tg-btn-delete" id="btn-tg-delete">
            <span>${t('table_group_view.btn_delete')}</span>
          </button>
        </div>
      </div>

      <div class="tg-view-content" id="tg-view-content-area">
        <!-- サマリーカードおよび所属テーブルカード一覧 -->
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // 一覧に戻る
    this.element.querySelector('#btn-tg-back').addEventListener('click', () => {
      appStore.emit('tableGroup:list:request', { schemaName: this.schemaName });
    });

    // 編集ボタン
    this.element.querySelector('#btn-tg-edit').addEventListener('click', () => {
      const group = (appStore.state.tableGroups || []).find(g => g.name === this.currentGroupName);
      if (group) {
        appStore.emit('tableGroup:edit:request', { group, schemaName: this.schemaName });
      }
    });

    // 削除ボタン
    this.element.querySelector('#btn-tg-delete').addEventListener('click', async () => {
      if (!this.currentGroupName) return;
      const msg = t('table_group_list.delete_confirm', { name: this.currentGroupName });
      if (!confirm(msg)) return;

      const updatedGroups = (appStore.state.tableGroups || []).filter(g => g.name !== this.currentGroupName);

      try {
        appStore.setModel({
          project: appStore.state.project,
          tables: appStore.state.tables,
          tableGroups: updatedGroups,
          refs: appStore.state.refs,
        });

        await projectService.saveProject();
        appStore.emit('tableGroup:list:request', { schemaName: this.schemaName });
      } catch (err) {
        console.error('テーブルグループ削除エラー:', err);
        // 日本語コメント: テーブルグループ削除失敗アラートの多言語化
        alert(t('table_group_list.alert_delete_failed', { error: err.message || err }));
      }
    });

    // モデル更新時、自画面が表示中ならリロード
    appStore.on('model:updated', () => {
      if (this.element && this.element.style.display !== 'none' && this.currentGroupName) {
        this.update(this.currentGroupName, this.schemaName);
      }
    });
  }

  /**
   * 指定グループの表示更新
   * @param {string} groupName 
   * @param {string|null} schemaName 
   */
  update(groupName, schemaName = null) {
    this.currentGroupName = groupName;
    this.schemaName = schemaName || appStore.state.activeSchema || '';

    const group = (appStore.state.tableGroups || []).find(g => g.name === groupName);

    if (!group) {
      // グループが存在しない場合は一覧へフォールバック
      appStore.emit('tableGroup:list:request', { schemaName: this.schemaName });
      return;
    }

    const nameEl = this.element.querySelector('#tg-view-name');
    const contentArea = this.element.querySelector('#tg-view-content-area');

    nameEl.textContent = group.name;

    // 所属テーブルの抽出
    const rawTables = group.tables || [];
    const tableNames = rawTables.map(t => typeof t === 'object' && t !== null ? (t.name || t.tableName) : String(t)).filter(Boolean);

    // スキーマのテーブル定義オブジェクトを取得
    const allTables = appStore.state.tables || [];
    const matchedTables = tableNames.map(name => {
      const found = allTables.find(t => t.name === name);
      return found || { name, logicalName: '', fields: [], indexes: [] };
    });

    contentArea.innerHTML = `
      <div class="tg-summary-card">
        <div class="tg-summary-item">
          <span class="tg-summary-item-label">${t('table_group_list.col_name')}</span>
          <span class="tg-summary-item-val">${escapeHtml(group.name)}</span>
        </div>
        <div class="tg-summary-item">
          <span class="tg-summary-item-label">${t('table_group_list.col_tables_count')}</span>
          <span class="tg-summary-item-val">${t('table_group_list.count_badge', { count: matchedTables.length })}</span>
        </div>
      </div>

      <div class="tg-section-header">
        <h3 class="tg-section-title">
          <span>📋</span>
          <span>${t('table_group_view.belonging_tables')}</span>
        </h3>
      </div>

      <div id="tg-tables-container">
        <!-- テーブル一覧 -->
      </div>
    `;

    const tablesContainer = contentArea.querySelector('#tg-tables-container');

    if (matchedTables.length === 0) {
      tablesContainer.innerHTML = `
        <div class="tg-empty-tables-box">
          ${t('table_group_view.no_tables')}
        </div>
      `;
    } else {
      // 日本語コメント: 内包テーブルを一覧テーブル形式で描画
      const wrapper = document.createElement('div');
      wrapper.className = 'tg-view-table-wrapper';

      const table = document.createElement('table');
      table.className = 'tg-view-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>${t('table_group_view.col_table_name')}</th>
            <th>${t('table_group_view.col_logical_name')}</th>
            <th style="width: 120px; text-align: right;">${t('table_group_view.col_columns')}</th>
            <th style="width: 140px; text-align: right;">${t('table_group_view.col_indexes')}</th>
          </tr>
        </thead>
        <tbody></tbody>
      `;

      const tbody = table.querySelector('tbody');
      matchedTables.forEach(tbl => {
        const tr = document.createElement('tr');
        tr.className = 'tg-view-table-row';

        const colsCount = (tbl.fields || []).length;
        const idxsCount = (tbl.indexes || []).length;
        const logicalHtml = tbl.logicalName
          ? escapeHtml(tbl.logicalName)
          : `<span class="tg-view-muted">${t('table_list.placeholder_logical_name')}</span>`;

        tr.innerHTML = `
          <td>
            <span class="tg-view-table-link">
              <span>📋</span>
              <strong>${escapeHtml(tbl.name)}</strong>
            </span>
          </td>
          <td>${logicalHtml}</td>
          <td style="text-align: right;">
            <span class="tg-list-badge">${colsCount}</span>
          </td>
          <td style="text-align: right;">
            <span class="tg-list-badge">${idxsCount}</span>
          </td>
        `;

        // クリックでテーブル詳細へジャンプ
        tr.addEventListener('click', () => {
          appStore.emit('table:select', tbl.name);
        });

        tbody.appendChild(tr);
      });

      wrapper.appendChild(table);
      tablesContainer.appendChild(wrapper);
    }
  }

  show() {
    this.element.style.display = 'flex';
  }

  hide() {
    this.element.style.display = 'none';
  }
}
