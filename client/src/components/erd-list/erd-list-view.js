// 日本語コメント: ER図一覧ビューコンポーネント (src/components/erd-list/erd-list-view.js)
// プロジェクト内の全ER図を一覧表示し、配置テーブル数・関連線数・説明の確認、
// ER図詳細（キャンバス）への遷移、新規ER図追加および削除を提供するグリッドテーブルビューです。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';

export class DbeErdListView {
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
    this.element.className = 'dbe-erd-list-view';

    this.element.innerHTML = `
      <div class="erd-list-header">
        <h2 id="erd-list-heading">
          <span class="header-icon">🗺️</span>
          <span id="erd-list-title-text">${t('erd_list.title')}</span>
          <span class="badge" id="erd-list-count-badge">${t('erd_list.count_badge', { count: 0 })}</span>
        </h2>
        <div class="erd-list-actions">
          <button class="primary" id="btn-list-add-erd">
            + ${t('erd_list.btn_add_erd')}
          </button>
        </div>
      </div>

      <div class="erd-list-body" id="erd-list-body"></div>
    `;

    this.container.appendChild(this.element);
    this.update();
  }

  /**
   * DOMイベントリスナーの登録
   */
  bindEvents() {
    const addBtn = this.element.querySelector('#btn-list-add-erd');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        appStore.emit('erd:create:request');
      });
    }
  }

  /**
   * ストア変更通知リスナーの登録
   */
  bindStore() {
    appStore.on('erds:updated', () => this.update());
    appStore.on('erd:updated', () => this.update());
    appStore.on('projectMeta:updated', () => this.update());
    appStore.on('project:empty', () => this.update());
  }

  /**
   * 画面全体の再描画
   */
  update() {
    const bodyContainer = this.element.querySelector('#erd-list-body');
    const headerTitle = this.element.querySelector('#erd-list-title-text');
    const countBadge = this.element.querySelector('#erd-list-count-badge');
    const addBtn = this.element.querySelector('#btn-list-add-erd');

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
    if (headerTitle) headerTitle.textContent = t('erd_list.title');

    const erdsMap = appStore.state.erds || new Map();
    const erdEntries = Array.from(erdsMap.values());
    const count = erdEntries.length;

    if (countBadge) {
      countBadge.textContent = t('erd_list.count_badge', { count });
    }

    // 2. ER図0件の場合
    if (count === 0) {
      bodyContainer.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🗺️</div>
          <p style="font-size: 1.15rem; font-weight: bold; margin-bottom: 0.5rem;">${t('erd_list.empty_title')}</p>
          <p style="color: var(--text-muted); font-size: 0.9rem; margin-bottom: 1.5rem; max-width: 450px; margin-left: auto; margin-right: auto;">
            ${t('erd_list.empty_desc')}
          </p>
          <button class="primary" id="btn-empty-create-erd" style="padding: 0.6rem 1.4rem; font-size: 0.95rem;">
            + ${t('erd_list.btn_add_erd')}
          </button>
        </div>
      `;
      const emptyBtn = bodyContainer.querySelector('#btn-empty-create-erd');
      if (emptyBtn) {
        emptyBtn.addEventListener('click', () => {
          appStore.emit('erd:create:request');
        });
      }
      return;
    }

    // 3. 通常のER図グリッドテーブル描画
    const rowsHtml = erdEntries.map((erd) => {
      const erdId = erd.id || erd.filename;
      const erdName = erd.name || erdId;
      const noDescText = t('table_list.placeholder_note');
      const desc = erd.description || erd.content?.info?.description || noDescText;
      const nodeCount = (erd.content?.nodes || []).length;
      const edgeCount = (erd.content?.edges || []).length;

      return `
        <tr data-erd-id="${escapeHtml(erdId)}">
          <td title="${escapeHtml(erdName)}">
            <a class="erd-name-link" data-erd-id="${escapeHtml(erdId)}">
              <span class="icon">🗺️</span>
              <span class="name-text">${escapeHtml(erdName)}</span>
            </a>
          </td>
          <td title="${escapeHtml(desc)}">
            <span class="${desc === noDescText ? 'placeholder-text' : ''}">${escapeHtml(desc)}</span>
          </td>
          <td style="text-align: right;" title="${nodeCount}">${nodeCount}</td>
          <td style="text-align: right;" title="${edgeCount}">${edgeCount}</td>
          <td style="text-align: center;">
            <button class="btn-erd-delete" data-erd-id="${escapeHtml(erdId)}">${t('common.delete')}</button>
          </td>
        </tr>
      `;
    }).join('');

    bodyContainer.innerHTML = `
      <div class="table-wrapper">
        <table class="erd-list-table" id="erd-list-grid">
          <thead>
            <tr>
              <th class="resizable" style="width: 30%;">
                ${t('erd_list.col_name')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 40%;">
                ${t('erd_list.col_description')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 10%; text-align: right;">
                ${t('erd_list.col_tables_count')}
                <div class="resizer"></div>
              </th>
              <th class="resizable" style="width: 10%; text-align: right;">
                ${t('erd_list.col_edges_count')}
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

    // ER図名リンクのクリックイベント（ER図切り替え＆ERDビューへ遷移）
    bodyContainer.querySelectorAll('.erd-name-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const erdId = link.getAttribute('data-erd-id');
        if (erdId) {
          appStore.switchErd(erdId);
          appStore.emit('erd:select', erdId);
        }
      });
    });

    // 削除ボタンイベント
    bodyContainer.querySelectorAll('.btn-erd-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const erdId = btn.getAttribute('data-erd-id');
        if (erdId) {
          this.handleDeleteErd(erdId);
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
    const table = this.element.querySelector('#erd-list-grid');
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
   * ER図削除処理
   */
  async handleDeleteErd(erdId) {
    const erd = appStore.state.erds?.get(erdId);
    const erdName = erd?.name || erdId;
    // 日本語コメント: ER図削除確認ダイアログの多言語化
    const confirmMsg = t('erd_list.delete_confirm', { name: erdName });
    if (!confirm(confirmMsg)) return;

    try {
      await projectService.deleteErd(erdId);
      // 日本語コメント: ER図削除完了ステータスメッセージの多言語化
      appStore.emit('status:message', t('erd_list.status_deleted', { name: erdName }));
      this.update();
    } catch (err) {
      // 日本語コメント: ER図削除失敗アラートの多言語化
      alert(t('erd_list.alert_delete_failed', { error: err.message }));
    }
  }
}
