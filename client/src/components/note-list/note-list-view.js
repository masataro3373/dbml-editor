// 日本語コメント: ノート一覧ビュー (src/components/note-list/note-list-view.js)
// スキーマ内の単独 Note をグリッド表形式で一覧表示し、詳細遷移、新規作成、削除を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';
import './note-list-view.css';

export class DbeNoteListView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.notes = [];
    this.schemaName = '';

    // 列幅の初期値
    this.columnWidths = {
      name: 240,
      content: 480,
      actions: 90,
    };

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-note-list-view';

    this.element.innerHTML = `
      <div class="note-list-header">
        <div class="note-list-title-area">
          <h2 id="note-list-title">${t('note_list.title')}</h2>
          <span class="note-list-badge" id="note-list-count">0</span>
        </div>
        <div class="note-list-actions">
          <button type="button" class="note-btn-primary" id="btn-add-note">
            <span>➕</span>
            <span>${t('note_list.btn_add_note')}</span>
          </button>
        </div>
      </div>

      <div class="note-list-content" id="note-list-content-area">
        <!-- ノート一覧または空表示 -->
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // 新規作成ボタン
    this.element.querySelector('#btn-add-note').addEventListener('click', () => {
      appStore.emit('note:create:request', { schemaName: this.schemaName });
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

    this.notes = appStore.state.notes || [];

    const titleEl = this.element.querySelector('#note-list-title');
    const countBadge = this.element.querySelector('#note-list-count');
    const contentArea = this.element.querySelector('#note-list-content-area');

    titleEl.textContent = this.schemaName 
      ? t('note_list.title_with_schema', { schema: this.schemaName })
      : t('note_list.title');
    countBadge.textContent = String(this.notes.length);

    contentArea.innerHTML = '';

    if (this.notes.length === 0) {
      // 空状態表示
      contentArea.innerHTML = `
        <div class="note-empty-state">
          <div class="note-empty-icon">📝</div>
          <div class="note-empty-title">${t('note_list.empty_title')}</div>
          <div class="note-empty-desc">${t('note_list.empty_desc')}</div>
          <button type="button" class="note-btn-primary" id="btn-empty-add-note">
            <span>➕</span>
            <span>${t('note_list.btn_add_note')}</span>
          </button>
        </div>
      `;
      contentArea.querySelector('#btn-empty-add-note')?.addEventListener('click', () => {
        appStore.emit('note:create:request', { schemaName: this.schemaName });
      });
      return;
    }

    // テーブルグリッドの構築
    const tableWrapper = document.createElement('div');
    tableWrapper.className = 'note-table-wrapper';

    const table = document.createElement('table');
    table.className = 'note-grid-table';

    // thead
    const thead = document.createElement('thead');
    thead.innerHTML = `
      <tr>
        <th style="width: ${this.columnWidths.name}px" data-col="name">
          ${t('note_list.col_name')}
          <div class="note-col-resizer"></div>
        </th>
        <th style="width: ${this.columnWidths.content}px" data-col="content">
          ${t('note_list.col_content')}
          <div class="note-col-resizer"></div>
        </th>
        <th style="width: ${this.columnWidths.actions}px; text-align: center;" data-col="actions">
          ${t('note_list.col_actions')}
        </th>
      </tr>
    `;
    table.appendChild(thead);

    // tbody
    const tbody = document.createElement('tbody');
    this.notes.forEach(note => {
      const tr = document.createElement('tr');

      const rawContent = typeof note.value === 'string' ? note.value : (note.value?.value || '');
      const firstLine = rawContent.split(/\r?\n/)[0] || '';
      // 日本語コメント: 空ノートのプレビュー代替文字列の多言語化
      const previewText = firstLine.length > 80 ? firstLine.slice(0, 80) + '...' : (firstLine || t('note_list.empty_content_preview'));

      tr.innerHTML = `
        <td>
          <a class="note-item-link" data-note-name="${escapeHtml(note.name)}">
            <span>📝</span>
            <strong>${escapeHtml(note.name)}</strong>
          </a>
        </td>
        <td>
          <div class="note-preview-cell" title="${escapeHtml(rawContent)}">
            ${escapeHtml(previewText)}
          </div>
        </td>
        <td style="text-align: center;">
          <button type="button" class="note-action-btn-delete" data-note-name="${escapeHtml(note.name)}" title="${t('note_list.btn_delete')}">
            ${t('note_list.btn_delete')}
          </button>
        </td>
      `;

      // ノートリンククリック → 詳細画面へ
      tr.querySelector('.note-item-link').addEventListener('click', (e) => {
        e.preventDefault();
        appStore.emit('note:select', {
          schemaName: this.schemaName,
          noteName: note.name,
          note,
        });
      });

      // 削除ボタンクリック
      tr.querySelector('.note-action-btn-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        await this.handleDeleteNote(note.name);
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrapper.appendChild(table);
    contentArea.appendChild(tableWrapper);

    // 列幅リサイズの初期化
    this.initColumnResize(table);
  }

  /**
   * ノート削除処理
   * @param {string} noteName 
   */
  async handleDeleteNote(noteName) {
    const msg = t('note_list.delete_confirm', { name: noteName });
    if (!confirm(msg)) {
      return;
    }

    const updatedNotes = (appStore.state.notes || []).filter(n => n.name !== noteName);

    try {
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: appStore.state.tableGroups,
        notes: updatedNotes,
        refs: appStore.state.refs,
      });

      await projectService.saveProject();
      this.update();
    } catch (err) {
      console.error('ノート削除エラー:', err);
      // 日本語コメント: ノート削除失敗アラートの多言語化
      alert(t('note_list.alert_delete_failed', { error: err.message || err }));
    }
  }

  /**
   * カラムドラッグリサイズの初期化
   * @param {HTMLTableElement} table 
   */
  initColumnResize(table) {
    const resizers = table.querySelectorAll('.note-col-resizer');
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
