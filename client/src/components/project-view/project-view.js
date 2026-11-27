// 日本語コメント: プロジェクトダッシュボードコンポーネント (src/components/project-view/project-view.js)
// v1に準拠し、プロジェクト全体の概要、サマリー統計、メタデータ、全スキーマ一覧カードを表示します。
// Light DOM で動作します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../core/html-utils.js';

export class DbeProjectView {
  constructor(container) {
    this.container = container;
    this.element = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-project-view';
    this.container.appendChild(this.element);
    this.update();
  }

  bindEvents() {
    this.element.addEventListener('click', (e) => {
      // プロジェクト設定ボタン
      if (e.target.closest('#btn-project-settings')) {
        appStore.emit('project:settings:open');
        return;
      }

      // サマリーカード：スキーマ一覧
      if (e.target.closest('#card-proj-schemas')) {
        appStore.emit('schema:list:request');
        return;
      }

      // サマリーカード：テーブル一覧
      if (e.target.closest('#card-proj-tables')) {
        appStore.emit('view:mode:change', 'list');
        return;
      }

      // サマリーカード：ER図一覧
      if (e.target.closest('#card-proj-erds')) {
        appStore.emit('erd:list:request');
        return;
      }

      // スキーマ詳細ボタン
      const schemaBtn = e.target.closest('.btn-schema-detail');
      if (schemaBtn) {
        const schemaName = schemaBtn.getAttribute('data-schema-name');
        if (schemaName) {
          appStore.switchSchema(schemaName);
          appStore.emit('schema:select', schemaName);
        }
        return;
      }

      // テーブル一覧ボタン
      const tablesBtn = e.target.closest('.btn-schema-tables');
      if (tablesBtn) {
        const schemaName = tablesBtn.getAttribute('data-schema-name');
        if (schemaName) {
          appStore.switchSchema(schemaName);
          appStore.emit('view:mode:change', 'list');
        }
        return;
      }
    });
  }

  bindStore() {
    appStore.on('projectMeta:updated', () => this.update());
    appStore.on('schemas:updated', () => this.update());
  }

  formatDate(dateStr) {
    if (!dateStr) return 'N/A';
    try {
      const date = new Date(dateStr);
      return date.toLocaleString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  update() {
    const projectMeta = appStore.state.projectMeta;
    if (!projectMeta) {
      this.element.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <p style="color: var(--text-muted);">${t('project.no_project_title')}</p>
        </div>
      `;
      return;
    }

    const info = projectMeta.info || {};
    const meta = projectMeta.meta || {};
    const schemasMap = appStore.state.schemas || new Map();
    const erdsList = projectMeta.files?.erds || [];

    // テーブル総数の集計
    let totalTablesCount = 0;
    const schemaCardsHtml = [];

    for (const [schemaName, schemaData] of schemasMap.entries()) {
      const model = schemaData.model || {};
      const tables = model.tables || [];
      const tblCount = tables.length;
      totalTablesCount += tblCount;
      const dbType = model.project?.databaseType || 'standard';

      const custom = model.project?.custom || {};
      const schemaVer = custom.version ? `${custom.version}` : '1.0.0';

      schemaCardsHtml.push(`
        <div class="schema-card">
          <div class="schema-card-top">
            <span class="schema-card-name">🗄️ ${escapeHtml(schemaName)}</span>
            <div style="display: flex; gap: 0.35rem; align-items: center;">
              <span class="schema-card-badge">${escapeHtml(dbType)}</span>
              <span class="dashboard-version-badge" style="font-size: 0.7rem; padding: 0.1rem 0.4rem;">${escapeHtml(schemaVer)}</span>
            </div>
          </div>
          <div style="font-size: 0.8rem; color: var(--text-secondary);">
            ${t('schema_dashboard.table_count')}: <b>${tblCount}</b>
          </div>
          <div class="schema-card-actions">
            <button class="secondary btn-schema-detail" data-schema-name="${escapeHtml(schemaName)}">
              ${t('project_dashboard.btn_open_schema')}
            </button>
            <button class="primary btn-schema-tables" data-schema-name="${escapeHtml(schemaName)}">
              ${t('project_dashboard.btn_open_tables')}
            </button>
          </div>
        </div>
      `);
    }

    this.element.innerHTML = `
      <!-- ヘッダー -->
      <div class="dashboard-header">
        <div class="dashboard-title-area">
          <div class="dashboard-title-row">
            <h1 class="dashboard-title">📦 ${escapeHtml(info.name || 'Project')}</h1>
            <span class="dashboard-version-badge">${escapeHtml(info.version || '1.0.0')}</span>
          </div>
          <p class="dashboard-desc">${escapeHtml(info.description) || t('common.no_description')}</p>
        </div>
        <button class="secondary" id="btn-project-settings">
          ${t('project_dashboard.btn_settings')}
        </button>
      </div>

      <!-- サマリーカード -->
      <div class="summary-grid">
        <div class="summary-card clickable" id="card-proj-schemas" title="${t('project_dashboard.tip_show_schemas')}">
          <div class="summary-icon">🗄️</div>
          <div class="summary-info">
            <span class="summary-count">${schemasMap.size}</span>
            <span class="summary-label">${t('project_dashboard.schema_count')}</span>
          </div>
        </div>
        <div class="summary-card clickable" id="card-proj-tables" title="${t('project_dashboard.tip_show_tables')}">
          <div class="summary-icon">📊</div>
          <div class="summary-info">
            <span class="summary-count">${totalTablesCount}</span>
            <span class="summary-label">${t('project_dashboard.table_count')}</span>
          </div>
        </div>
        <div class="summary-card clickable" id="card-proj-erds" title="${t('project_dashboard.tip_show_erds')}">
          <div class="summary-icon">🗺️</div>
          <div class="summary-info">
            <span class="summary-count">${erdsList.length}</span>
            <span class="summary-label">${t('project_dashboard.erd_count')}</span>
          </div>
        </div>
      </div>

      <!-- プロジェクトメタ情報 -->
      <div class="dashboard-section">
        <h2 class="dashboard-section-title">ℹ️ ${t('project_dashboard.section_meta')}</h2>
        <div class="meta-card">
          <div class="meta-grid">
            <div class="meta-label">${t('project_dashboard.project_id')}</div>
            <div class="meta-value">${escapeHtml(meta.id || 'N/A')}</div>

            <div class="meta-label">${t('project_dashboard.version')}</div>
            <div class="meta-value">${escapeHtml(info.version || '1.0.0')}</div>

            <div class="meta-label">${t('project_dashboard.created_at')}</div>
            <div class="meta-value">${escapeHtml(this.formatDate(meta.createdAt))}</div>

            <div class="meta-label">${t('project_dashboard.created_by')}</div>
            <div class="meta-value">${escapeHtml(meta.createdBy || 'N/A')}</div>

            <div class="meta-label">${t('project_dashboard.updated_at')}</div>
            <div class="meta-value">${escapeHtml(this.formatDate(meta.updatedAt))}</div>

            <div class="meta-label">${t('project_dashboard.updated_by')}</div>
            <div class="meta-value">${meta.updatedBy || 'N/A'}</div>

            <div class="meta-label">${t('project_dashboard.format_version')}</div>
            <div class="meta-value">${meta.jsonFormatVersion || '1.0.0'}</div>
          </div>
        </div>
      </div>

      <!-- 登録スキーマ一覧 -->
      <div class="dashboard-section">
        <h2 class="dashboard-section-title">🗄️ ${t('project_dashboard.section_schemas')} (${schemasMap.size})</h2>
        <div class="schema-cards-grid">
          ${schemaCardsHtml.length > 0 ? schemaCardsHtml.join('') : `<p class="placeholder-text">${t('tree.no_schemas')}</p>`}
        </div>
      </div>
    `;
  }
}
