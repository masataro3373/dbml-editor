// 日本語コメント: スキーマ詳細ダッシュボードビュー (src/components/schema-view/schema-view.js)
// スキーマを選択した際に中央コンテンツペインに表示される専用ダッシュボードです。
// 物理属性セクションは metadataManager から取得した有効属性を動的に描画します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { escapeHtml } from '../../core/html-utils.js';
import './schema-view.css';

export class DbeSchemaView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentSchemaName = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-schema-view';
    this.container.appendChild(this.element);
  }

  bindEvents() {
    this.element.addEventListener('click', (e) => {
      if (e.target.closest('#btn-schema-settings')) {
        appStore.emit('schema:settings:open', this.currentSchemaName);
      } else if (e.target.closest('#btn-schema-view-tables') || e.target.closest('#card-schema-tables')) {
        appStore.emit('view:mode:change', 'list');
      } else if (e.target.closest('#btn-schema-add-table')) {
        appStore.emit('table:create:request');
      } else if (e.target.closest('#card-schema-groups')) {
        appStore.emit('tableGroup:list:request', this.currentSchemaName);
      } else if (e.target.closest('#card-schema-notes')) {
        appStore.emit('note:list:request', this.currentSchemaName);
      }
    });
  }

  bindStore() {
    appStore.on('model:updated', () => {
      if (this.currentSchemaName) {
        this.update(this.currentSchemaName);
      }
    });
    appStore.on('schemas:updated', () => {
      if (this.currentSchemaName) {
        this.update(this.currentSchemaName);
      }
    });
  }

  setSchema(schemaName) {
    this.currentSchemaName = schemaName;
    this.update(schemaName);
  }

  update(schemaName) {
    if (!schemaName || !appStore.state.schemas?.has(schemaName)) {
      this.element.innerHTML = `
        <div class="tree-empty-state" style="padding: 4rem 1rem; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 1rem;">🗄️</div>
          <p style="font-size: 1.15rem; font-weight: bold; margin-bottom: 0.5rem;">${t('schema_dashboard.empty_title')}</p>
          <p style="color: var(--text-muted); font-size: 0.9rem;">${t('schema_dashboard.empty_desc')}</p>
        </div>
      `;
      return;
    }

    const schemaData = appStore.state.schemas.get(schemaName);
    const model = schemaData.model || {};
    const tables = model.tables || [];
    const tableGroups = model.tableGroups || [];
    const notes = model.notes || [];
    const projectObj = model.project || {};
    const custom = projectObj.custom || {};
    const dbType = projectObj.databaseType || 'standard';

    const noteText = projectObj.note
      ? (typeof projectObj.note === 'object' ? (projectObj.note.value || '') : String(projectObj.note))
      : '';

    // 動的 Project 属性 (表領域など) の取得
    const projectAttrs = metadataManager.getProjectAttributes(dbType) || [];

    const renderBadges = (list) => {
      if (!list || list.length === 0) {
        return `<span class="placeholder-text">${t('schema_dashboard.no_tablespaces')}</span>`;
      }
      const arr = Array.isArray(list) ? list : String(list).split(/[,、]/).map(s => s.trim()).filter(Boolean);
      return arr.map(ts => `<span class="tablespace-badge">${escapeHtml(ts)}</span>`).join(' ');
    };

    // 既知のプラグインキーの収集 (camelCase も含む)
    const handledKeys = new Set(['version']);
    projectAttrs.forEach(a => {
      handledKeys.add(a.key);
      handledKeys.add(a.key.replace(/_([a-z])/g, (_, g) => g.toUpperCase()));
    });

    const rows = [];

    // 1. プラグイン定義属性
    projectAttrs.forEach(attr => {
      const label = metadataManager.resolveLabel(attr);
      const val = custom[attr.key] !== undefined
        ? custom[attr.key]
        : (custom[attr.key.replace(/_([a-z])/g, (_, g) => g.toUpperCase())] || []);

      const valHtml = attr.type === 'list'
        ? renderBadges(val)
        : (val !== undefined && val !== null && String(val).trim() !== '' ? escapeHtml(val) : `<span class="placeholder-text">${t('schema_dashboard.not_set')}</span>`);

      rows.push(`
        <tr>
          <td class="schema-attr-label" style="width: 35%; font-weight: 600;">${escapeHtml(label)}</td>
          <td class="schema-attr-val">${valHtml}</td>
        </tr>
      `);
    });

    // 2. その他の任意カスタムキー (version や重複を除外)
    const customKeys = Object.keys(custom);
    const seenNormalizedKeys = new Set();
    customKeys.forEach(k => {
      if (handledKeys.has(k)) return;
      const normalized = k.toLowerCase().replace(/_/g, '');
      if (seenNormalizedKeys.has(normalized)) return;
      seenNormalizedKeys.add(normalized);

      const val = custom[k];
      let valHtml = '';
      if (Array.isArray(val)) {
        valHtml = renderBadges(val);
      } else if (val !== undefined && val !== null && String(val).trim() !== '') {
        valHtml = escapeHtml(val);
      } else {
        valHtml = `<span class="placeholder-text">${t('schema_dashboard.not_set')}</span>`;
      }

      rows.push(`
        <tr>
          <td class="schema-attr-label" style="width: 35%; font-weight: 600;">${escapeHtml(k)}</td>
          <td class="schema-attr-val">${valHtml}</td>
        </tr>
      `);
    });

    const physicalSectionHtml = `
      <div class="schema-section">
        <h2 class="schema-section-title">⚙️ ${t('schema_dashboard.section_physical_custom')}</h2>
        <div class="schema-info-card" style="padding: 0; overflow: hidden;">
          ${rows.length > 0 ? `
            <table class="schema-attr-table" style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
              <thead>
                <tr style="background-color: var(--bg-secondary); border-bottom: 2px solid var(--border-color); text-align: left;">
                  <th style="padding: 10px 14px; color: var(--text-secondary); width: 35%;">${t('schema_dashboard.col_item_name')}</th>
                  <th style="padding: 10px 14px; color: var(--text-secondary);">${t('schema_dashboard.col_item_value')}</th>
                </tr>
              </thead>
              <tbody>
                ${rows.join('')}
              </tbody>
            </table>
          ` : `
            <div style="padding: 1.25rem; color: var(--text-muted); font-size: 0.875rem;">
              ${t('schema_dashboard.no_physical_custom')}
            </div>
          `}
        </div>
      </div>
    `;

    this.element.innerHTML = `
      <!-- ヘッダー -->
      <div class="schema-dashboard-header">
        <div class="schema-title-area">
          <h1 class="schema-dashboard-title">🗄️ ${escapeHtml(schemaName)}</h1>
          <span class="schema-dialect-badge">${escapeHtml(dbType)}</span>
          <span class="dashboard-version-badge">${escapeHtml(custom.version || '1.0.0')}</span>
        </div>
        <div class="schema-header-actions">
          <button class="secondary" id="btn-schema-settings">
            ${t('schema_dashboard.btn_settings')}
          </button>
          <button class="primary" id="btn-schema-view-tables">
            ${t('schema_dashboard.btn_tables')}
          </button>
          <button class="secondary" id="btn-schema-add-table">
            ${t('schema_dashboard.btn_add_table')}
          </button>
        </div>
      </div>

      <!-- サマリーカード -->
      <div class="schema-summary-grid">
        <div class="schema-summary-card" id="card-schema-tables" title="${t('schema_dashboard.tip_card_tables')}">
          <div class="schema-summary-icon">📊</div>
          <div class="schema-summary-info">
            <span class="schema-summary-count">${tables.length}</span>
            <span class="schema-summary-label">${t('schema_dashboard.table_count')}</span>
          </div>
        </div>
        <div class="schema-summary-card" id="card-schema-groups">
          <div class="schema-summary-icon">📁</div>
          <div class="schema-summary-info">
            <span class="schema-summary-count">${tableGroups.length}</span>
            <span class="schema-summary-label">${t('schema_dashboard.group_count')}</span>
          </div>
        </div>
        <div class="schema-summary-card" id="card-schema-notes">
          <div class="schema-summary-icon">📝</div>
          <div class="schema-summary-info">
            <span class="schema-summary-count">${notes.length}</span>
            <span class="schema-summary-label">${t('schema_dashboard.note_count')}</span>
          </div>
        </div>
      </div>

      <!-- スキーマ説明 (Note) -->
      <div class="schema-section">
        <h2 class="schema-section-title">📝 ${t('schema_dashboard.section_note')}</h2>
        <div class="schema-info-card">
          ${noteText ? `<p class="schema-note-text">${escapeHtml(noteText)}</p>` : `<span class="placeholder-text">${t('table_list.placeholder_note')}</span>`}
        </div>
      </div>

      <!-- 物理属性・拡張設定 (有効なプラグインがある場合のみ表示) -->
      ${physicalSectionHtml}
    `;
  }
}
