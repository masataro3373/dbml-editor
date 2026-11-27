// 日本語コメント: スキーマ一覧ビューコンポーネント (src/components/schema-list/schema-list-view.js)
// プロジェクト内の全スキーマを横断的に一覧表示し、DBMS方言・ツリー表示トグル・各リソース数確認、
// スキーマ詳細への遷移および新規作成・削除を提供するグリッドテーブルビューです。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';

export class DbeSchemaListView {
  constructor(container) {
    this.container = container;
    this.element = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  /**
   * コンポーネント基本枠組みの生成
   */
  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-schema-list-view';

    this.element.innerHTML = `
      <div class="schema-list-header">
        <h2 id="schema-list-heading">
          <span class="header-icon">📁</span>
          <span id="schema-list-title-text">${t('schema_list.title')}</span>
          <span class="badge" id="schema-list-count-badge">${t('schema_list.count_badge', { count: 0 })}</span>
        </h2>
        <div class="schema-list-actions">
          <button class="primary" id="btn-list-add-schema">
            + ${t('schema_list.btn_add_schema')}
          </button>
        </div>
      </div>

      <div class="schema-list-body" id="schema-list-body"></div>
    `;

    this.container.appendChild(this.element);
    this.update();
  }

  /**
   * DOMイベントリスナーの登録
   */
  bindEvents() {
    const addBtn = this.element.querySelector('#btn-list-add-schema');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        appStore.emit('schema:create:request');
      });
    }
  }

  /**
   * ストア変更通知リスナーの登録
   */
  bindStore() {
    appStore.on('schemas:updated', () => this.update());
    appStore.on('model:updated', () => this.update());
    appStore.on('projectMeta:updated', () => this.update());
    appStore.on('project:empty', () => this.update());
  }

  /**
   * 画面全体の再描画
   */
  update() {
    const bodyContainer = this.element.querySelector('#schema-list-body');
    const headerTitle = this.element.querySelector('#schema-list-title-text');
    const countBadge = this.element.querySelector('#schema-list-count-badge');
    const addBtn = this.element.querySelector('#btn-list-add-schema');

    if (!bodyContainer) return;

    // 1. プロジェクト未作成 (0個) の場合
    if (appStore.state.isEmptyProject || !appStore.state.projectMeta) {
      if (headerTitle) headerTitle.textContent = t('project.no_project_title');
      if (countBadge) countBadge.style.display = 'none';
      if (addBtn) addBtn.style.display = 'none';

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

    if (countBadge) countBadge.style.display = 'inline-flex';
    if (addBtn) addBtn.style.display = 'inline-block';
    if (headerTitle) headerTitle.textContent = t('schema_list.title');

    const schemasMap = appStore.state.schemas || new Map();
    const schemaEntries = Array.from(schemasMap.entries());
    const count = schemaEntries.length;

    if (countBadge) {
      countBadge.textContent = t('schema_list.count_badge', { count });
    }

    // 2. スキーマ0件の場合
    if (count === 0) {
      bodyContainer.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🗄️</div>
          <p style="font-size: 1.15rem; font-weight: bold; margin-bottom: 0.5rem;">${t('schema_list.empty_title')}</p>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 450px; margin-left: auto; margin-right: auto;">
            ${t('schema_list.empty_desc')}
          </p>
          <button class="primary" id="btn-empty-create-schema" style="padding: 0.6rem 1.4rem; font-size: 0.95rem;">
            + ${t('schema_list.btn_add_schema')}
          </button>
        </div>
      `;
      const emptyBtn = bodyContainer.querySelector('#btn-empty-create-schema');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', () => {
          appStore.emit('schema:create:request');
        });
      }
      return;
    }

    // 3. 通常のスキーマグリッドテーブル描画
    const rowsHtml = schemaEntries.map(([schemaName, schemaData]) => {
      const model = schemaData.model || {};
      const dbType = model.project?.databaseType || 'standard';
      const isVisible = schemaData.visible !== false;
      const tableCount = model.tables?.length || 0;
      const groupCount = model.tableGroups?.length || 0;
      const noteCount = model.notes?.length || 0;

      return `
        <tr data-schema-name="${escapeHtml(schemaName)}">
          <td title="${escapeHtml(schemaName)}">
            <a class="schema-name-link" data-schema="${escapeHtml(schemaName)}">
              <span class="icon">🗄️</span>
              <span class="name-text">${escapeHtml(schemaName)}</span>
            </a>
          </td>
          <td>
            <span class="badge dialect-badge dialect-${escapeHtml(dbType.toLowerCase())}">${escapeHtml(dbType)}</span>
          </td>
          <td style="text-align: center;">
            <input type="checkbox" class="schema-visible-toggle" data-schema="${escapeHtml(schemaName)}" ${isVisible ? 'checked' : ''} title="${t('schema_list.toggle_visible_tip')}" />
          </td>
          <td style="text-align: right;" title="${tableCount}">${tableCount}</td>
          <td style="text-align: right;" title="${groupCount}">${groupCount}</td>
          <td style="text-align: right;" title="${noteCount}">${noteCount}</td>
          <td style="text-align: center;">
            <button class="btn-schema-delete" data-schema="${escapeHtml(schemaName)}">${t('common.delete')}</button>
          </td>
        </tr>
      `;
    }).join('');

    bodyContainer.innerHTML = `
      <div class="table-wrapper">
        <table class="schema-list-table" id="schema-list-grid">
          <thead>
            <tr>
              <th class="resizable" style="width: 30%;">
                ${t('schema_list.col_name')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 15%;">
                ${t('schema_list.col_dbms')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 12%; text-align: center;">
                ${t('schema_list.col_tree_visible')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 11%; text-align: right;">
                ${t('schema_dashboard.table_count')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 11%; text-align: right;">
                ${t('schema_dashboard.group_count')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 11%; text-align: right;">
                ${t('schema_dashboard.note_count')}
                <div class="resizer"></div>
              </th>
              <th style="width: 10%; text-align: center;">
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

    // スキーマ名リンクのクリックイベント（スキーマ切替＆スキーマ詳細画面へ遷移）
    bodyContainer.querySelectorAll('.schema-name-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const schema = link.getAttribute('data-schema');
        if (schema) {
          appStore.switchSchema(schema);
          appStore.emit('schema:select', schema);
        }
      });
    });

    // ツリー表示トグルチェックボックスの変更イベント
    bodyContainer.querySelectorAll('.schema-visible-toggle').forEach(input => {
      input.addEventListener('change', async (e) => {
        const schema = input.getAttribute('data-schema');
        const checked = e.target.checked;
        const sData = appStore.state.schemas?.get(schema);
        if (sData) {
          sData.visible = checked;
        }

        // projectMeta内の該当エントリも同期
        if (appStore.state.projectMeta?.files?.schemas) {
          const entry = appStore.state.projectMeta.files.schemas.find(s => s.filename === schema || s.name === schema);
          if (entry) {
            entry.visible = checked;
          }
        }

        appStore.emit('schemas:updated', appStore.state.schemas);
        await projectService.saveProject({ skipRegenerateActive: true });
        // 日本語コメント: ツリー表示切り替えステータスメッセージの多言語化
        appStore.emit('status:message', t('schema_list.status_visible_toggled', {
          name: schema,
          status: checked ? t('schema_list.status_enabled') : t('schema_list.status_disabled'),
        }));
      });
    });

    // 削除ボタンイベント
    bodyContainer.querySelectorAll('.btn-schema-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const schema = btn.getAttribute('data-schema');
        if (schema) {
          this.handleDeleteSchema(schema);
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
    const table = this.element.querySelector('#schema-list-grid');
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
   * スキーマ削除処理
   */
  async handleDeleteSchema(schemaName) {
    // 日本語コメント: スキーマ削除確認メッセージの多言語化
    const confirmMsg = t('tree.schema_delete_confirm', { name: schemaName });
    if (!confirm(confirmMsg)) return;

    try {
      await projectService.deleteSchema(schemaName);
      // 日本語コメント: スキーマ削除完了メッセージの多言語化
      appStore.emit('status:message', t('schema_list.status_deleted', { name: schemaName }));
      this.update();
    } catch (err) {
      // 日本語コメント: スキーマ削除失敗ダイアログの多言語化
      alert(t('schema_list.alert_delete_failed', { error: err.message }));
    }
  }
}
