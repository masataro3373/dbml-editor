// 日本語コメント: テーブル詳細閲覧ビューコンポーネント (src/components/table-view/table-view.js)
// 選択されたテーブルの構造 (カラム一覧、インデックス、外部キー、Check制約、物理属性) を表示し、
// v1準拠の統計情報ダッシュボード（カラム数、インデックス数、FK数、Check数、想定レコードサイズ）をカード表示します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { renderTableColorBar } from '../../core/table-colors.js';
import './table-view.css';

/**
 * 日本語コメント: HTML属性値およびテキストのエスケープ
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 日本語コメント: テーブル列のドラッグリサイズを初期化
 */
function initResizableColumns(tableEl) {
  if (!tableEl) return;
  const thList = tableEl.querySelectorAll('th');
  thList.forEach((th) => {
    if (th.querySelector('.resizer')) return;
    const resizer = document.createElement('div');
    resizer.className = 'resizer';
    th.style.position = 'sticky';
    th.appendChild(resizer);

    let startX = 0;
    let startWidth = 0;

    const onMouseMove = (e) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(30, startWidth + diff);
      th.style.width = `${newWidth}px`;
      resizer.classList.add('resizing');
    };

    const onMouseUp = () => {
      resizer.classList.remove('resizing');
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    resizer.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startX = e.clientX;
      startWidth = th.offsetWidth;
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  });
}

/**
 * 日本語コメント: データ型から想定される概算バイトサイズを算出 (v1移植)
 */
function estimateTypeSize(typeStr) {
  if (!typeStr) return 0;
  const lowerType = typeStr.toLowerCase().trim();

  // 桁数指定 (n) を抽出
  const lengthMatch = lowerType.match(/\(([^)]+)\)/);
  let specifiedLength = 0;
  if (lengthMatch) {
    const parts = lengthMatch[1].split(',');
    specifiedLength = parseInt(parts[0], 10) || 0;
  }

  if (lowerType.startsWith('int') || lowerType.startsWith('integer')) return 4;
  if (lowerType.startsWith('bigint') || lowerType.startsWith('bigserial')) return 8;
  if (lowerType.startsWith('smallint')) return 2;
  if (lowerType.startsWith('tinyint')) return 1;
  if (lowerType.startsWith('float') || lowerType.startsWith('real')) return 4;
  if (lowerType.startsWith('double') || lowerType.startsWith('numeric') || lowerType.startsWith('decimal')) {
    return specifiedLength ? Math.ceil(specifiedLength / 2) + 2 : 10;
  }
  if (lowerType.startsWith('varchar') || lowerType.startsWith('char') || lowerType.startsWith('varchar2')) {
    return specifiedLength || 255;
  }
  if (lowerType.startsWith('text') || lowerType.startsWith('clob') || lowerType.startsWith('blob')) return 16;
  if (lowerType.startsWith('timestamp') || lowerType.startsWith('datetime')) return 8;
  if (lowerType.startsWith('date')) return 4;
  if (lowerType.startsWith('boolean') || lowerType.startsWith('bool')) return 1;
  if (lowerType.startsWith('uuid')) return 16;

  return 8; // デフォルト推定サイズ
}

export class DbeTableView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentTable = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-table-view';
    this.container.appendChild(this.element);
  }

  bindEvents() {
    this.element.addEventListener('click', (e) => {
      if (e.target.closest('#btn-back-to-list')) {
        appStore.emit('view:mode:change', 'list');
      } else if (e.target.closest('#btn-view-edit-table')) {
        if (this.currentTable) {
          appStore.emit('table:edit:request', this.currentTable.name);
        }
      }
    });
  }

  bindStore() {
    appStore.on('model:updated', () => {
      if (this.currentTable) {
        const found = (appStore.state.tables || []).find(t => t.name.toUpperCase() === this.currentTable.name.toUpperCase());
        this.currentTable = found || null;
        this.updateView();
      }
    });
  }

  setTable(tableData) {
    this.currentTable = tableData;
    this.updateView();
  }

  updateView() {
    if (!this.currentTable) {
      // 日本語コメント: 未選択時のメッセージ表示（多言語化対応）
      this.element.innerHTML = `<div class="placeholder-msg">${t('table_view.not_selected')}</div>`;
      return;
    }

    const tbl = this.currentTable;
    const fields = tbl.fields || [];
    const showLogical = metadataManager.isLogicalNameEnabled();

    // 1. カラム一覧行
    let totalRecordSize = 0;
    const fieldRows = fields.map((f, i) => {
      const typeStr = f.type || f.baseType || '';
      totalRecordSize += estimateTypeSize(typeStr);

      const badges = [];
      if (f.pk) badges.push('<span class="badge badge-pk">PK</span>');
      if (f.not_null) badges.push('<span class="badge badge-nn">NN</span>');
      if (f.unique) badges.push('<span class="badge badge-uq">UQ</span>');

      const lenScale = f.length ? (f.scale ? `${f.length},${f.scale}` : `${f.length}`) : '-';

      return `
        <tr>
          <!-- 行番号列（3桁対応: 幅50px） -->
          <td style="width: 50px; text-align: center;">${i + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(f.name)}</td>
          ${showLogical ? `<td style="color: var(--text-secondary);">${escapeHtml(f.logicalName) || '-'}</td>` : ''}
          <td><code>${escapeHtml(f.baseType || f.type)}</code></td>
          <td style="text-align: right;">${escapeHtml(lenScale)}</td>
          <!-- 制約バッジ（PK/NN/UQ） -->
          <td>${badges.join(' ')}</td>
          <!-- デフォルト値 -->
          <td>${f.dbdefault !== null && f.dbdefault !== undefined ? `<code>${escapeHtml(f.dbdefault)}</code>` : '-'}</td>
          <td style="color: var(--text-secondary);">${escapeHtml(f.note) || '-'}</td>
        </tr>
      `;
    }).join('');

    // 2. インデックス一覧（PK以外のインデックス）
    const nonPkIndexes = (tbl.indexes || []).filter(idx => !idx.pk && !idx.isPrimaryKey);
    const indexRows = nonPkIndexes.map((idx, i) => {
      const colNames = (idx.columns || []).map(c => {
        const val = typeof c === 'object' && c !== null ? (c.value || c.name || '') : c;
        return escapeHtml(val);
      }).join(', ');
      return `
        <tr>
          <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
          <td style="width: 50px; text-align: center;">${i + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(idx.name) || '-'}</td>
          <td style="width: 70px; text-align: center;">${idx.unique ? '✓' : '-'}</td>
          <td>${colNames || '-'}</td>
          <td style="color: var(--text-secondary);">${escapeHtml(idx.note) || '-'}</td>
        </tr>
      `;
    }).join('');

    // 3. 外部キー (FK) 一覧
    const relatedRefs = (appStore.state.refs || []).filter(r => r.endpoints?.[0]?.tableName === tbl.name);
    const fkRows = relatedRefs.map((ref, i) => {
      const localEp = (ref.endpoints || [])[0] || {};
      const foreignEp = (ref.endpoints || [])[1] || {};
      const relStr = `${localEp.fieldNames?.join(',') || '?'} -> ${foreignEp.tableName}.${foreignEp.fieldNames?.join(',') || '?'}`;
      const actions = [
        ref.onDelete ? `DELETE: ${ref.onDelete}` : '',
        ref.onUpdate ? `UPDATE: ${ref.onUpdate}` : '',
      ].filter(Boolean).join(', ') || '-';

      return `
        <tr>
          <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
          <td style="width: 50px; text-align: center;">${i + 1}</td>
          <td style="font-weight: 600;">${escapeHtml(ref.name || `FK_${i + 1}`)}</td>
          <td><code>${escapeHtml(relStr)}</code></td>
          <td style="color: var(--text-secondary);">${escapeHtml(actions)}</td>
        </tr>
      `;
    }).join('');

    // 4. Check 制約一覧
    const checkConstraints = tbl.checks || (tbl.constraints || []).filter(c => c.type === 'check') || [];
    const checkRows = checkConstraints.map((chk, i) => `
      <tr>
        <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
        <td style="width: 50px; text-align: center;">${i + 1}</td>
        <td style="font-weight: 600;">${escapeHtml(chk.name || `CHK_${i + 1}`)}</td>
        <td><code>${escapeHtml(chk.expression || '-')}</code></td>
      </tr>
    `).join('');

    // 5. 物理属性 (DBMS固有設定)
    const dialect = appStore.state.activeDialect;
    const currentDialect = dialect?.id || appStore.state.project?.databaseType || 'standard';
    const attrSchemas = metadataManager.getTableAttributes(currentDialect);
    const custom = tbl.custom || {};
    const customEntries = Object.entries(custom).filter(([k, v]) => k.toLowerCase() !== 'logicalname' && v !== undefined && v !== null && v !== '');

    this.element.innerHTML = `
      <!-- ヘッダー -->
      <div class="table-view-header">
        <div class="table-view-title-group">
          <div>
            <h2 class="table-view-title">
              <span>📌</span>
              ${renderTableColorBar(tbl.headerColor || tbl.headercolor)}
              <span>${escapeHtml(tbl.name)}</span>
            </h2>
            ${showLogical && tbl.logicalName ? `<p class="table-view-subtitle">${escapeHtml(tbl.logicalName)}</p>` : ''}
          </div>
        </div>
        <div class="table-view-actions">
          <button type="button" class="btn btn-secondary" id="btn-back-to-list">${t('table_view.btn_back_list')}</button>
          <button type="button" class="btn btn-primary" id="btn-view-edit-table">${t('table_view.btn_edit')}</button>
        </div>
      </div>

      <!-- テーブルの説明 (Note) -->
      ${tbl.note ? `
        <div class="table-view-section">
          <h3>📝 ${t('table_view.section_note')}</h3>
          <div style="background-color: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; padding: 12px; font-size: 0.9rem; white-space: pre-wrap; line-height: 1.5;">${escapeHtml(tbl.note)}</div>
        </div>
      ` : ''}

      <!-- 📊 統計情報ダッシュボード -->
      <div class="table-view-section">
        <h3>📊 ${t('table_view.section_stats')}</h3>
        <div class="dashboard-stats-grid">
          <div class="dashboard-stat-card">
            <span class="dashboard-stat-val">${fields.length}</span>
            <span class="dashboard-stat-lbl">${t('table_view.stat_columns')}</span>
          </div>
          <div class="dashboard-stat-card">
            <span class="dashboard-stat-val">${nonPkIndexes.length}</span>
            <span class="dashboard-stat-lbl">${t('table_view.stat_indexes')}</span>
          </div>
          <div class="dashboard-stat-card">
            <span class="dashboard-stat-val">${relatedRefs.length}</span>
            <span class="dashboard-stat-lbl">${t('table_view.stat_foreign_keys')}</span>
          </div>
          <div class="dashboard-stat-card">
            <span class="dashboard-stat-val">${checkConstraints.length}</span>
            <span class="dashboard-stat-lbl">${t('table_view.stat_check_constraints')}</span>
          </div>
          <div class="dashboard-stat-card">
            <span class="dashboard-stat-val">${totalRecordSize}</span>
            <span class="dashboard-stat-lbl">${t('table_view.stat_record_size')}</span>
          </div>
        </div>
      </div>

      <!-- カラム一覧 -->
      <div class="table-view-section">
        <h3>📋 ${t('table_view.section_columns')} (${fields.length})</h3>
        <div class="data-table-wrapper">
          <table class="data-table" id="viewColumnsTable">
            <thead>
              <tr>
                <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                <th style="width: 50px; text-align: center;">#</th>
                <th>${t('table_view.col_name')}</th>
                ${showLogical ? `<th>${metadataManager.getLogicalNameLabel('column')}</th>` : ''}
                <th style="width: 120px;">${t('table_view.col_type')}</th>
                <th style="width: 90px; text-align: right;">${t('table_view.col_length_scale')}</th>
                <!-- カラム順序統一: 制約 -> デフォルト値 -->
                <th style="width: 100px;">${t('table_view.col_constraints')}</th>
                <th style="width: 110px;">${t('table_view.col_default')}</th>
                <th>${t('table_view.col_comment')}</th>
              </tr>
            </thead>
            <tbody>
              ${fieldRows || `<tr><td colspan="${showLogical ? 8 : 7}" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_view.no_columns')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- インデックス一覧 -->
      <div class="table-view-section">
        <h3>⚡ ${t('table_view.section_indexes')} (${nonPkIndexes.length})</h3>
        <div class="data-table-wrapper">
          <table class="data-table" id="viewIndexesTable">
            <thead>
              <tr>
                <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                <th style="width: 50px; text-align: center;">#</th>
                <th style="width: 220px;">${t('table_view.idx_name')}</th>
                <th style="width: 70px; text-align: center;">${t('table_view.idx_unique')}</th>
                <th>${t('table_view.idx_columns')}</th>
                <th>${t('table_view.idx_note')}</th>
              </tr>
            </thead>
            <tbody>
              ${indexRows || `<tr><td colspan="5" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_view.no_indexes')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- 外部キー一覧 -->
      <div class="table-view-section">
        <h3>🔗 ${t('table_view.section_fks')} (${relatedRefs.length})</h3>
        <div class="data-table-wrapper">
          <table class="data-table" id="viewFksTable">
            <thead>
              <tr>
                <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                <th style="width: 50px; text-align: center;">#</th>
                <th style="width: 220px;">${t('table_view.fk_name')}</th>
                <th>${t('table_view.fk_relation')}</th>
                <th style="width: 200px;">${t('table_view.fk_actions')}</th>
              </tr>
            </thead>
            <tbody>
              ${fkRows || `<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_view.no_fks')}</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Check 制約一覧 -->
      ${checkConstraints.length > 0 ? `
        <div class="table-view-section">
          <h3>✅ ${t('table_view.section_checks')} (${checkConstraints.length})</h3>
          <div class="data-table-wrapper">
            <table class="data-table" id="viewChecksTable">
              <thead>
                <tr>
                  <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                  <th style="width: 50px; text-align: center;">#</th>
                  <th style="width: 220px;">${t('table_view.check_name')}</th>
                  <th>${t('table_view.check_expression')}</th>
                </tr>
              </thead>
              <tbody>
                ${checkRows}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}

      <!-- 物理属性 (DBMS固有設定) -->
      ${customEntries.length > 0 ? `
        <div class="table-view-section">
          <h3>⚙️ ${t('table_view.section_physical_custom')}</h3>
          <div class="data-table-wrapper">
            <table class="data-table">
              <thead>
                <tr>
                  <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                  <th style="width: 50px; text-align: center;">#</th>
                  <th style="width: 250px;">${t('table_view.custom_attr_name')}</th>
                  <th>${t('table_view.custom_attr_value')}</th>
                </tr>
              </thead>
              <tbody>
                ${customEntries.map(([k, v], idx) => {
                  const schema = attrSchemas.find(a => a.key === k);
                  const label = schema ? metadataManager.resolveLabel(schema) : k;
                  return `
                    <tr>
                      <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                      <td style="width: 50px; text-align: center;">${idx + 1}</td>
                      <td><b>${escapeHtml(label)}</b> <small style="color: var(--text-muted);">(${escapeHtml(k)})</small></td>
                      <td><code>${escapeHtml(String(v))}</code></td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      ` : ''}
    `;

    // テーブルのリサイズ機能有効化
    initResizableColumns(this.element.querySelector('#viewColumnsTable'));
    initResizableColumns(this.element.querySelector('#viewIndexesTable'));
    initResizableColumns(this.element.querySelector('#viewFksTable'));
    initResizableColumns(this.element.querySelector('#viewChecksTable'));
  }
}
