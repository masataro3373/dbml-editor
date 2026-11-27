// 日本語コメント: v2最適化エクスポートモーダル (src/components/export-modal/export-modal.js)
// Light DOM で動作し、v2 の複数スキーマ環境に完全連動。
// 「SQL (DDL)」「スキーマ (DBML)」「プロジェクト」の3つのコアタブに集約し、
// スキーマごとの動的テーブル一覧抽出とダイレクトエクスポートを提供します。

import { t, getLang } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { dialectManager } from '../../dialects/index.js';
import { generateHtmlDoc } from '../../core/html-doc-generator.js';
import { generateHtmlGridDoc } from '../../core/html-grid-doc-generator.js';
import { createZipBlob } from '../../core/zip-utils.js';
import { formatExportBlob } from '../../core/text-export-utils.js';
import { generateShortId } from '../../core/id-generator.js';
import { escapeHtml } from '../../core/html-utils.js';
import { generateDbml } from '../../core/dbml-generator.js';
import { bindSearchClear } from '../../core/search-clear.js';
import './export-modal.css';

export class DbeExportModal {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.activeTab = 'sql'; // デフォルトは SQL タブ
    this.selectedTables = new Set();

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-export-modal-overlay';
    this.element.id = 'export-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-export-modal-container">
        
        <!-- ヘッダー -->
        <div class="dbe-export-modal-header">
          <h3><span>📤</span> ${t('exportModal.title')}</h3>
          <button class="dbe-export-modal-close-btn" id="btnCloseExport">&times;</button>
        </div>

        <!-- タブナビゲーション -->
        <div class="dbe-export-modal-tabs">
          <button class="dbe-export-modal-tab-btn active" data-tab="sql">${t('exportModal.tabSql')}</button>
          <button class="dbe-export-modal-tab-btn" data-tab="schema">${t('exportModal.tabSchema')}</button>
          <button class="dbe-export-modal-tab-btn" data-tab="erd">${t('exportModal.tabErd')}</button>
          <button class="dbe-export-modal-tab-btn" data-tab="project">${t('exportModal.tabProject')}</button>
          <button class="dbe-export-modal-tab-btn" data-tab="html">${t('exportModal.tabHtml')}</button>
        </div>

        <!-- コンテンツ領域 -->
        <div class="dbe-export-modal-body">
          
          <!-- ① SQL (左右2ペイン) -->
          <div class="dbe-export-tab-content active" id="sqlExportContent">
            <div class="dbe-export-grid">
              
              <!-- 左: オプション -->
              <div class="dbe-export-panel">
                <div class="dbe-export-panel-title">${t('exportModal.titleSqlOpt')}</div>

                <!-- DROP文設定 -->
                <div class="dbe-export-form-group">
                  <label class="dbe-export-checkbox-label">
                    <input type="checkbox" id="sqlIncludeDelete" checked>
                    <span style="font-weight: 500;">${t('exportModal.optionSqlDelete')}</span>
                  </label>
                  <div class="dbe-export-sub-options" id="subSqlDeletePos">
                    <div style="display: flex; gap: 15px;">
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlDeletePosition" value="top" checked>
                        <span>${t('exportModal.optionSqlDeleteTop')}</span>
                      </label>
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlDeletePosition" value="inline">
                        <span>${t('exportModal.optionSqlDeleteInline')}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <!-- COMMENT文設定 -->
                <div class="dbe-export-form-group">
                  <label class="dbe-export-checkbox-label">
                    <input type="checkbox" id="sqlIncludeComment" checked>
                    <span style="font-weight: 500;">${t('exportModal.optionSqlComment')}</span>
                  </label>
                  <div class="dbe-export-sub-options" id="subSqlCommentOptions">
                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 2px;">${t('exportModal.labelSqlCommentPosition')}:</div>
                    <div style="display: flex; gap: 15px;">
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlCommentPosition" value="bottom" checked>
                        <span>${t('exportModal.optionSqlCommentBottom')}</span>
                      </label>
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlCommentPosition" value="inline">
                        <span>${t('exportModal.optionSqlCommentInline')}</span>
                      </label>
                    </div>

                    <div style="font-size: 0.78rem; color: var(--text-secondary); margin-top: 4px;">${t('exportModal.labelSqlCommentSource')}:</div>
                    <div style="display: flex; gap: 15px;">
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlCommentSource" value="note" checked>
                        <span>${t('exportModal.optionCommentNote')}</span>
                      </label>
                      <label class="dbe-export-checkbox-label">
                        <input type="radio" name="sqlCommentSource" value="logicalName">
                        <span>${t('exportModal.optionCommentLogicalName')}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <!-- 日本語コメント: 物理属性設定（TABLESPACE, PCTFREE/INITRANSの出力切り替え） -->
                <div class="dbe-export-form-group">
                  <div class="dbe-export-checkbox-group" style="gap: 8px;">
                    <label class="dbe-export-checkbox-label">
                      <input type="checkbox" id="sqlIncludeTablespace" checked>
                      <span style="font-weight: 500;">${t('exportModal.optionSqlTablespace')}</span>
                    </label>
                    <label class="dbe-export-checkbox-label">
                      <input type="checkbox" id="sqlIncludePctfreeInitrans" checked>
                      <span style="font-weight: 500;">${t('exportModal.optionSqlPctfreeInitrans')}</span>
                    </label>
                  </div>
                </div>

                <div class="dbe-export-form-group">
                  <label>${t('exportModal.labelEncoding')}</label>
                  <div class="dbe-export-checkbox-group" style="flex-direction: row; gap: 15px;">
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlEncoding" value="utf-8" checked><span>UTF-8</span>
                    </label>
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlEncoding" value="sjis"><span>SJIS (Shift_JIS)</span>
                    </label>
                  </div>
                </div>

                <div class="dbe-export-form-group">
                  <label>${t('exportModal.labelNewline')}</label>
                  <div class="dbe-export-checkbox-group" style="flex-direction: row; gap: 15px;">
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlNewline" value="lf" checked><span>LF</span>
                    </label>
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlNewline" value="crlf"><span>CRLF</span>
                    </label>
                  </div>
                </div>

                <div class="dbe-export-form-group">
                  <label>${t('exportModal.labelOutputMode')}</label>
                  <div class="dbe-export-checkbox-group" style="flex-direction: row; gap: 15px;">
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlSplit" value="false" checked><span>${t('exportModal.optionMergeOne')}</span>
                    </label>
                    <label class="dbe-export-checkbox-label">
                      <input type="radio" name="sqlSplit" value="true"><span>${t('exportModal.optionSplitZip')}</span>
                    </label>
                  </div>
                </div>
              </div>

              <!-- 右: 対象テーブル -->
              <div class="dbe-export-panel">
                <div class="dbe-export-panel-title">${t('exportModal.titleSqlTarget')}</div>
                
                <div class="dbe-export-form-group">
                  <label for="sqlSchemaSelect">${t('exportModal.labelSchema')}</label>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <select class="dbe-export-select" id="sqlSchemaSelect" style="flex: 1;"></select>
                    <div class="dbe-export-dialect-badge" id="sqlDialectBadge" title="${t('exportModal.labelDatabaseType')}">
                      <span class="dbe-badge-icon" id="sqlDialectIcon">🗄️</span>
                      <span class="dbe-badge-text" id="sqlDialectName">Standard</span>
                    </div>
                  </div>
                </div>

                <div class="dbe-export-checkbox-group" style="flex-direction: row; gap: 15px;">
                  <label class="dbe-export-checkbox-label">
                    <input type="radio" name="sqlSelection" value="all" checked><span>${t('exportModal.optionSelectionAll')}</span>
                  </label>
                  <label class="dbe-export-checkbox-label">
                    <input type="radio" name="sqlSelection" value="select"><span>${t('exportModal.optionSelectionSelect')}</span>
                  </label>
                </div>

                <div id="sqlFilterRow" style="display: none; flex-direction: column; gap: 6px;">
                  <div style="display: flex; gap: 8px; align-items: center;">
                    <div class="dbe-search-input-wrap" style="flex: 1;">
                      <input type="text" class="dbe-export-filter-input" id="sqlTableFilter" placeholder="${t('exportModal.placeholderFilter')}" style="margin-bottom: 0;">
                      <button type="button" id="btnSqlTableFilterClear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                    </div>
                    <button type="button" class="btn-action-small" id="btnSqlSelectAll">${t('exportModal.btnSelectAll')}</button>
                    <button type="button" class="btn-action-small" id="btnSqlDeselectAll">${t('exportModal.btnDeselectAll')}</button>
                  </div>
                </div>

                <div class="dbe-export-table-list-container" id="sqlTableList"></div>
                <div class="dbe-export-tbl-count" id="sqlTableCount"></div>
              </div>
            </div>
          </div>

          <!-- ② スキーマ (DBML) -->
          <div class="dbe-export-tab-content" id="schemaExportContent">
            <div class="dbe-export-single-layout">
              <div class="dbe-export-single-icon">📄</div>
              <div class="dbe-export-single-title">${t('exportModal.titleSchema')}</div>
              <div class="dbe-export-description" style="margin-bottom: 20px;">
                ${t('exportModal.descSchema')}
              </div>
              <div class="dbe-export-form-group" style="width: 320px; margin: 0 auto 20px auto;">
                <label for="schemaExportSelect">${t('exportModal.labelSchema')}</label>
                <select class="dbe-export-select" id="schemaExportSelect"></select>
              </div>
              <button class="dbe-export-btn dbe-export-btn-primary" id="btnExportSchemaAction">${t('exportModal.btnSchema')}</button>
            </div>
          </div>

          <!-- ③ ER図 (JSON) -->
          <div class="dbe-export-tab-content" id="erdExportContent">
            <div class="dbe-export-single-layout">
              <div class="dbe-export-single-icon">📊</div>
              <div class="dbe-export-single-title">${t('exportModal.titleErd')}</div>
              <div class="dbe-export-description" style="margin-bottom: 20px;">
                ${t('exportModal.descErd')}
              </div>
              <div class="dbe-export-form-group" style="width: 320px; margin: 0 auto 20px auto;">
                <label for="erdExportSelect">${t('exportModal.labelErd')}</label>
                <select class="dbe-export-select" id="erdExportSelect"></select>
              </div>
              <button class="dbe-export-btn dbe-export-btn-primary" id="btnExportErdAction">${t('exportModal.btnErd')}</button>
            </div>
          </div>

          <!-- ④ プロジェクト (ZIPアーカイブ) -->
          <div class="dbe-export-tab-content" id="projectExportContent">
            <div class="dbe-export-single-layout">
              <div class="dbe-export-single-icon">📦</div>
              <div class="dbe-export-single-title">${t('exportModal.titleProject')}</div>
              <div class="dbe-export-description" style="margin-bottom: 20px;">
                ${t('exportModal.descProject')}
              </div>
              <button class="dbe-export-btn dbe-export-btn-primary" id="btnExportProjectAction">${t('exportModal.btnProject')}</button>
            </div>
          </div>

          <!-- ⑤ HTML仕様書 (Web版データ辞書) -->
          <div class="dbe-export-tab-content" id="htmlExportContent">
            <div class="dbe-export-single-layout">
              <div class="dbe-export-single-icon">📘</div>
              <div class="dbe-export-single-title">${t('exportModal.titleHtml')}</div>
              <div class="dbe-export-description" style="margin-bottom: 16px;">
                ${t('exportModal.descHtml')}
              </div>
              <div class="dbe-export-form-group" style="width: 380px; max-width: 100%; margin: 0 auto 14px auto; text-align: left;">
                <label for="htmlExportSelect">${t('exportModal.labelSchema')}</label>
                <select class="dbe-export-select" id="htmlExportSelect"></select>
              </div>
              <div class="dbe-export-form-group" style="width: 380px; max-width: 100%; margin: 0 auto 20px auto; text-align: left;">
                <label>${t('exportModal.labelHtmlFormat')}</label>
                <div class="dbe-export-format-group">
                  <label class="dbe-export-format-option">
                    <input type="radio" name="htmlExportFormat" value="card" checked />
                    <div class="dbe-export-format-body">
                      <div class="dbe-export-format-title">📄 ${t('exportModal.htmlFormatCardTitle')}</div>
                      <div class="dbe-export-format-desc">${t('exportModal.htmlFormatCardDesc')}</div>
                    </div>
                  </label>
                  <label class="dbe-export-format-option">
                    <input type="radio" name="htmlExportFormat" value="grid" />
                    <div class="dbe-export-format-body">
                      <div class="dbe-export-format-title">🔍 ${t('exportModal.htmlFormatGridTitle')}</div>
                      <div class="dbe-export-format-desc">${t('exportModal.htmlFormatGridDesc')}</div>
                    </div>
                  </label>
                </div>
              </div>
              <button class="dbe-export-btn dbe-export-btn-primary" id="btnExportHtmlAction">${t('exportModal.btnHtml')}</button>
            </div>
          </div>

        </div>

        <!-- フッター -->
        <div class="dbe-export-modal-footer">
          <button class="dbe-export-btn dbe-export-btn-secondary" id="btnCancelExport">${t('exportModal.btnCancel')}</button>
          <button class="dbe-export-btn dbe-export-btn-primary" id="btnSubmitExport">${t('exportModal.btnSubmit')}</button>
        </div>

      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    const closeBtn = this.element.querySelector('#btnCloseExport');
    const cancelBtn = this.element.querySelector('#btnCancelExport');
    const submitBtn = this.element.querySelector('#btnSubmitExport');
    const tabBtns = this.element.querySelectorAll('.dbe-export-modal-tab-btn');

    const hideModal = () => {
      this.element.style.display = 'none';
    };

    closeBtn.addEventListener('click', hideModal);
    cancelBtn.addEventListener('click', hideModal);

    // ESCキーで閉じる
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.style.display !== 'none') {
        hideModal();
      }
    });

    // タブ切り替え
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.getAttribute('data-tab'));
      });
    });

    // SQL スキーマ変更 -> 該当スキーマのテーブル一覧を動的更新
    const sqlSchemaSelect = this.element.querySelector('#sqlSchemaSelect');
    sqlSchemaSelect.addEventListener('change', () => {
      this.onSchemaSelectionChanged();
    });

    // DROP文のON/OFF連動
    const chkDelete = this.element.querySelector('#sqlIncludeDelete');
    const subDelete = this.element.querySelector('#subSqlDeletePos');
    const updateDeleteState = () => {
      if (chkDelete && subDelete) {
        subDelete.classList.toggle('disabled', !chkDelete.checked);
      }
    };
    chkDelete?.addEventListener('change', updateDeleteState);
    updateDeleteState();

    // COMMENT文のON/OFF連動
    const chkComment = this.element.querySelector('#sqlIncludeComment');
    const subComment = this.element.querySelector('#subSqlCommentOptions');
    const updateCommentState = () => {
      if (chkComment && subComment) {
        subComment.classList.toggle('disabled', !chkComment.checked);
      }
    };
    chkComment?.addEventListener('change', updateCommentState);
    updateCommentState();

    // SQL 選択モード（全体／個別）
    const selectionRadios = this.element.querySelectorAll('input[name="sqlSelection"]');
    const filterRow = this.element.querySelector('#sqlFilterRow');
    const filterInput = this.element.querySelector('#sqlTableFilter');

    selectionRadios.forEach(r => {
      r.addEventListener('change', () => {
        const isSelect = r.value === 'select';
        filterRow.style.display = isSelect ? 'flex' : 'none';
        this.renderSqlTableList(filterInput?.value.trim() || '');
      });
    });

    // テーブル検索フィルタ
    filterInput?.addEventListener('input', () => {
      this.renderSqlTableList(filterInput.value.trim());
    });
    bindSearchClear(filterInput, this.element.querySelector('#btnSqlTableFilterClear'));

    // 全選択ボタン (フィルタ適用時は表示中のテーブルのみを選択)
    const btnSelectAll = this.element.querySelector('#btnSqlSelectAll');
    btnSelectAll?.addEventListener('click', () => {
      const currentFilter = filterInput?.value.trim() || '';
      const visibleTables = this.getFilteredSqlTables(currentFilter);
      visibleTables.forEach(t => this.selectedTables.add(t.name));
      this.renderSqlTableList(currentFilter);
    });

    // 全解除ボタン (フィルタ適用時は表示中のテーブルのみを解除)
    const btnDeselectAll = this.element.querySelector('#btnSqlDeselectAll');
    btnDeselectAll?.addEventListener('click', () => {
      const currentFilter = filterInput?.value.trim() || '';
      const visibleTables = this.getFilteredSqlTables(currentFilter);
      visibleTables.forEach(t => this.selectedTables.delete(t.name));
      this.renderSqlTableList(currentFilter);
    });

    // エクスポート実行ボタン
    submitBtn.addEventListener('click', async () => {
      await this.handleExportSubmit();
    });

    // スキーマ単体エクスポート
    const btnExportSchemaAction = this.element.querySelector('#btnExportSchemaAction');
    btnExportSchemaAction.addEventListener('click', () => {
      this.handleSchemaExport();
    });

    // ER図単体エクスポート
    const btnExportErdAction = this.element.querySelector('#btnExportErdAction');
    btnExportErdAction?.addEventListener('click', () => {
      this.handleErdExport();
    });

    // HTML仕様書単体エクスポート
    const btnExportHtmlAction = this.element.querySelector('#btnExportHtmlAction');
    btnExportHtmlAction?.addEventListener('click', () => {
      this.handleHtmlExport();
    });

    // プロジェクト単体エクスポート
    const btnExportProjectAction = this.element.querySelector('#btnExportProjectAction');
    btnExportProjectAction.addEventListener('click', () => {
      this.handleProjectExport();
    });
  }

  bindStore() {
    appStore.on('export:open:request', () => {
      this.show();
    });
  }

  show() {
    this.updateSchemaSelectors();
    this.onSchemaSelectionChanged();
    this.element.style.display = 'flex';
    this.switchTab(this.activeTab);
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // タブボタンのアクティブ更新
    const tabBtns = this.element.querySelectorAll('.dbe-export-modal-tab-btn');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // コンテンツのアクティブ更新
    const contents = {
      sql: this.element.querySelector('#sqlExportContent'),
      schema: this.element.querySelector('#schemaExportContent'),
      erd: this.element.querySelector('#erdExportContent'), // 日本語コメント: ER図コンテンツを追加
      html: this.element.querySelector('#htmlExportContent'),
      project: this.element.querySelector('#projectExportContent'),
    };

    Object.entries(contents).forEach(([k, el]) => {
      if (el) el.classList.toggle('active', k === tabId);
    });
  }

  updateSchemaSelectors() {
    const schemas = Array.from(appStore.state.schemas?.keys() || []);
    const activeSchema = appStore.state.activeSchema || (schemas[0] || 'default');

    const sqlSelect = this.element.querySelector('#sqlSchemaSelect');
    const schemaSelect = this.element.querySelector('#schemaExportSelect');
    const htmlSelect = this.element.querySelector('#htmlExportSelect');
    const erdSelect = this.element.querySelector('#erdExportSelect');

    const buildOptions = (sel) => {
      if (!sel) return;
      sel.innerHTML = '';
      if (schemas.length === 0) {
        sel.innerHTML = `<option value="${escapeHtml(activeSchema)}">${escapeHtml(activeSchema)}</option>`;
        return;
      }
      schemas.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === activeSchema) opt.selected = true;
        sel.appendChild(opt);
      });
    };

    buildOptions(sqlSelect);
    buildOptions(schemaSelect);
    buildOptions(htmlSelect);

    // ER図選択肢の構築
    if (erdSelect) {
      erdSelect.innerHTML = '';
      const erds = Array.from(appStore.state.erds?.entries() || []);
      const activeErdId = appStore.state.activeErdId || (erds[0]?.[0] || '');
      if (erds.length === 0) {
        // 日本語コメント: ER図が存在しない場合の文言をi18n辞書から取得
        erdSelect.innerHTML = `<option value="">${t('exportModal.noErds')}</option>`;
      } else {
        erds.forEach(([id, entry]) => {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = entry.name ? `${entry.name} (${id})` : id;
          if (id === activeErdId) opt.selected = true;
          erdSelect.appendChild(opt);
        });
      }
    }
  }

  /**
   * 現在選択中のスキーマに属するテーブル一覧を取得
   */
  getSelectedSchemaTables() {
    const select = this.element.querySelector('#sqlSchemaSelect');
    const selectedSchema = select?.value || appStore.state.activeSchema;
    if (selectedSchema && appStore.state.schemas?.has(selectedSchema)) {
      const entry = appStore.state.schemas.get(selectedSchema);
      return entry.model?.tables || [];
    }
    return appStore.state.tables || [];
  }

  /**
   * スキーマ選択変更時にテーブル選択状態をリセットし再描画＆方言バッジ更新
   */
  onSchemaSelectionChanged() {
    this.selectedTables.clear();
    const tables = this.getSelectedSchemaTables();
    tables.forEach(t => this.selectedTables.add(t.name));

    const select = this.element.querySelector('#sqlSchemaSelect');
    const selectedSchema = select?.value || appStore.state.activeSchema;
    this.updateSqlDialectDisplay(selectedSchema);

    this.renderSqlTableList();
  }

  /**
   * 選択中スキーマの databaseType から方言バッジ表示を更新
   */
  updateSqlDialectDisplay(selectedSchema) {
    const schemaEntry = appStore.state.schemas?.get(selectedSchema);
    const dbType = schemaEntry?.model?.project?.databaseType || appStore.state.project?.databaseType;
    const dialect = dialectManager.resolve(dbType) || appStore.state.activeDialect;

    const badgeName = this.element.querySelector('#sqlDialectName');
    const badgeSub = this.element.querySelector('#sqlDialectTemplate');
    const badgeIcon = this.element.querySelector('#sqlDialectIcon');
    const badge = this.element.querySelector('#sqlDialectBadge');
    const submitBtn = this.element.querySelector('#btnSubmitExport');

    const hasExporter = Boolean(dialect?.exporter);
    const displayName = dialect?.displayName || dbType || 'Standard';

    if (badgeName) {
      badgeName.textContent = displayName;
    }
    if (badgeSub) {
      badgeSub.textContent = hasExporter ? (dialect.exporter.templateName || t('exportModal.pluginTemplate')) : t('exportModal.unsupportedDialect');
    }
    if (badgeIcon) {
      badgeIcon.textContent = dialect?.icon || (dialect?.id?.includes('oracle') ? '🏛️' : '🗄️');
    }
    if (badge) {
      badge.title = `${t('exportModal.labelDatabaseType')}: ${displayName}${hasExporter ? '' : t('exportModal.noExporterBadge')}`;
    }

    if (submitBtn && this.activeTab === 'sql') {
      submitBtn.disabled = !hasExporter;
      if (!hasExporter) {
        submitBtn.title = t('exportModal.errExporterNotInstalled');
      } else {
        submitBtn.title = '';
      }
    }
  }

  /**
   * フィルタ文字列に一致する SQL 出力対象テーブル一覧を取得
   * @param {string} [filter='']
   * @returns {Array}
   */
  getFilteredSqlTables(filter = '') {
    const tables = this.getSelectedSchemaTables();
    const query = (filter || '').trim().toLowerCase();
    if (!query) return tables;
    return tables.filter(tbl => {
      const logicalName = tbl.logicalName || tbl.custom?.logicalName || '';
      return tbl.name.toLowerCase().includes(query) || logicalName.toLowerCase().includes(query);
    });
  }

  renderSqlTableList(filter = '') {
    const container = this.element.querySelector('#sqlTableList');
    container.innerHTML = '';

    const tables = this.getSelectedSchemaTables();
    if (tables.length === 0) {
      container.innerHTML = `<div class="dbe-export-description" style="padding: 12px; text-align: center;">${t('exportModal.noTables')}</div>`;
      this.updateTableCountDisplay(0);
      return;
    }

    const isAll = this.element.querySelector('input[name="sqlSelection"]:checked')?.value === 'all';
    const filteredTables = this.getFilteredSqlTables(filter);

    filteredTables.forEach(tbl => {
      const logicalName = tbl.logicalName || tbl.custom?.logicalName || '';
      const item = document.createElement('div');
      item.className = 'dbe-export-table-item';

      const isChecked = isAll || this.selectedTables.has(tbl.name);

      item.innerHTML = `
        <label class="dbe-export-checkbox-label" style="width: 100%;">
          <input type="checkbox" value="${escapeHtml(tbl.name)}" ${isChecked ? 'checked' : ''} ${isAll ? 'disabled' : ''} />
          <span class="dbe-export-tbl-name">${escapeHtml(tbl.name)}</span>
          ${logicalName ? `<span class="dbe-export-tbl-logical">(${escapeHtml(logicalName)})</span>` : ''}
        </label>
      `;

      if (!isAll) {
        const chk = item.querySelector('input');
        chk.addEventListener('change', () => {
          if (chk.checked) {
            this.selectedTables.add(tbl.name);
          } else {
            this.selectedTables.delete(tbl.name);
          }
          this.updateTableCountDisplay(tables.length);
        });
      }

      container.appendChild(item);
    });

    this.updateTableCountDisplay(tables.length);
  }

  /**
   * テーブル選択カウンターの表示更新
   */
  updateTableCountDisplay(totalCount) {
    const countBar = this.element.querySelector('#sqlTableCount');
    if (countBar) {
      const isAll = this.element.querySelector('input[name="sqlSelection"]:checked')?.value === 'all';
      const selectedCount = isAll ? totalCount : this.selectedTables.size;
      countBar.textContent = t('exportModal.selectedTableCount', {
        selected: selectedCount,
        total: totalCount
      });
    }
  }

  getSqlOptions() {
    const includeDelete = this.element.querySelector('#sqlIncludeDelete')?.checked ?? true;
    const deletePosition = this.element.querySelector('input[name="sqlDeletePosition"]:checked')?.value || 'top';
    const includeComment = this.element.querySelector('#sqlIncludeComment')?.checked ?? true;
    const commentPosition = this.element.querySelector('input[name="sqlCommentPosition"]:checked')?.value || 'bottom';
    const commentSource = this.element.querySelector('input[name="sqlCommentSource"]:checked')?.value || 'note';
    // 日本語コメント: 物理属性（TABLESPACE、PCTFREE/INITRANS）の出力選択オプション値を取得
    const includeTablespace = this.element.querySelector('#sqlIncludeTablespace')?.checked ?? true;
    const includePctfreeInitrans = this.element.querySelector('#sqlIncludePctfreeInitrans')?.checked ?? true;
    const encoding = this.element.querySelector('input[name="sqlEncoding"]:checked')?.value || 'utf-8';
    const newline = this.element.querySelector('input[name="sqlNewline"]:checked')?.value || 'lf';
    const split = this.element.querySelector('input[name="sqlSplit"]:checked')?.value === 'true';

    return {
      includeDelete,
      deletePosition,
      includeComment,
      commentPosition,
      commentSource,
      includeTablespace,
      includePctfreeInitrans,
      encoding,
      newline,
      splitMode: split,
      split,
      targetTableNames: Array.from(this.selectedTables),
      // 下位互換プロパティ
      includeDrop: includeDelete,
      dropPosition: deletePosition,
    };
  }

  async handleExportSubmit() {
    if (this.activeTab === 'sql') {
      await this.handleSqlExport();
    } else if (this.activeTab === 'schema') {
      this.handleSchemaExport();
    } else if (this.activeTab === 'erd') {
      // 日本語コメント: ER図エクスポートを実行
      this.handleErdExport();
    } else if (this.activeTab === 'html') {
      this.handleHtmlExport();
    } else if (this.activeTab === 'project') {
      this.handleProjectExport();
    }
  }

  async handleSqlExport() {
    const isAll = this.element.querySelector('input[name="sqlSelection"]:checked')?.value === 'all';
    const tables = this.getSelectedSchemaTables();

    if (!isAll && this.selectedTables.size === 0) {
      alert(t('exportModal.noTables'));
      return;
    }

    const options = this.getSqlOptions();
    if (isAll) {
      options.targetTableNames = tables.map(t => t.name);
    }

    // 選択されたスキーマのモデルを取得
    const select = this.element.querySelector('#sqlSchemaSelect');
    const selectedSchema = select?.value || appStore.state.activeSchema;
    let schemaModel = {
      project: appStore.state.project,
      tables: appStore.state.tables,
      refs: appStore.state.refs,
    };
    if (selectedSchema && appStore.state.schemas?.has(selectedSchema)) {
      const entry = appStore.state.schemas.get(selectedSchema);
      if (entry.model) {
        schemaModel = {
          project: entry.model.project || appStore.state.project,
          tables: entry.model.tables || [],
          refs: entry.model.refs || [],
        };
      }
    }

    // スキーマの databaseType から方言とエクスポーターを自動解決
    const dbType = schemaModel.project?.databaseType || appStore.state.project?.databaseType;
    const dialect = dialectManager.resolve(dbType) || appStore.state.activeDialect;

    if (!dialect || !dialect.exporter) {
      alert(t('exportModal.errNoExporter'));
      return;
    }

    appStore.showLoading(t('exportModal.loadingExport'));
    try {
      const result = await dialect.exporter.execute(schemaModel, options);
      if (result.success && result.content) {
        const filename = result.filename || `${selectedSchema || 'schema'}.sql`;
        // 日本語コメント: ユーザーが選択した文字コード (UTF-8/SJIS) および改行コード (LF/CRLF) を適用した Blob を生成
        const blob = formatExportBlob(result.content, options);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        this.element.style.display = 'none';
      } else {
        alert(t('exportModal.errExportFailed', { error: result.error || '' }));
      }
    } catch (err) {
      alert(t('exportModal.errExportFailed', { error: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }

  handleSchemaExport() {
    const select = this.element.querySelector('#schemaExportSelect');
    const schemaName = select?.value || appStore.state.activeSchema;
    const schema = appStore.state.schemas?.get(schemaName);
    const dbmlText = schema?.dbml || '';

    const blob = new Blob([dbmlText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${schemaName || 'schema'}.dbml`;
    a.click();
    URL.revokeObjectURL(url);
    this.element.style.display = 'none';
  }

  handleHtmlExport() {
    const select = this.element.querySelector('#htmlExportSelect');
    const schemaName = select?.value || appStore.state.activeSchema;

    let schemaModel = {
      project: appStore.state.project,
      tables: appStore.state.tables || [],
      refs: appStore.state.refs || [],
    };

    if (schemaName && appStore.state.schemas?.has(schemaName)) {
      const entry = appStore.state.schemas.get(schemaName);
      if (entry.model) {
        schemaModel = {
          project: entry.model.project || appStore.state.project,
          tables: entry.model.tables || [],
          refs: entry.model.refs || [],
        };
      }
    }

    const dialect = dialectManager.resolve(schemaModel.project?.databaseType) || appStore.state.activeDialect;
    const formatInput = this.element.querySelector('input[name="htmlExportFormat"]:checked');
    const format = formatInput ? formatInput.value : 'card';
    const docOptions = {
      schemaName: schemaName,
      dialectName: dialect?.name || schemaModel.project?.databaseType || 'Standard',
      // 日本語コメント: アプリの現在言語を HTML 仕様書の初期表示言語として引き継ぐ
      lang: getLang(),
    };

    // 日本語コメント: 選択された出力形式（標準カード型 / 検索強化グリッド型）に応じて HTML を生成
    const htmlContent = format === 'grid'
      ? generateHtmlGridDoc(schemaModel, docOptions)
      : generateHtmlDoc(schemaModel, docOptions);

    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = format === 'grid'
      ? `${schemaName || 'schema'}_doc_grid.html`
      : `${schemaName || 'schema'}_doc.html`;
    a.click();
    URL.revokeObjectURL(url);
    this.element.style.display = 'none';
  }

  handleErdExport() {
    const select = this.element.querySelector('#erdExportSelect');
    const erdId = select?.value || appStore.state.activeErdId;
    if (!erdId || !appStore.state.erds?.has(erdId)) {
      // 日本語コメント: 未選択警告メッセージをi18n辞書から取得
      alert(t('exportModal.errNoErdSelected'));
      return;
    }

    const erdEntry = appStore.state.erds.get(erdId);
    const erdData = {
      id: erdEntry.id || erdId,
      name: erdEntry.name || t('erd.title'),
      description: erdEntry.description || '',
      content: erdEntry.content || {},
      exportedAt: new Date().toISOString(),
    };

    const jsonStr = JSON.stringify(erdData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (erdEntry.name || erdId).replace(/[\\/:*?"<>|]/g, '_');
    a.href = url;
    a.download = `${safeName}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.element.style.display = 'none';
  }

  handleProjectExport() {
    const files = [];

    // 1. project.json マニフェストの構築
    const currentMeta = appStore.state.projectMeta || {};
    const schemasList = [];
    if (appStore.state.schemas) {
      for (const [name, entry] of appStore.state.schemas.entries()) {
        schemasList.push({
          // 日本語コメント: ShortID, filename, visible を含めてマニフェストに追加
          ShortID: entry.ShortID || generateShortId(10),
          filename: entry.filename || name,
          visible: entry.visible !== undefined ? entry.visible : true,
        });
      }
    }

    const erdsList = [];
    if (appStore.state.erds) {
      for (const [erdId, entry] of appStore.state.erds.entries()) {
        erdsList.push({
          // 日本語コメント: id, filename, name, description, visible を含めてマニフェストに追加
          id: entry.id || erdId,
          filename: entry.filename || entry.id || erdId,
          name: entry.name || t('erd.title'),
          description: entry.description || '',
          visible: entry.visible !== undefined ? entry.visible : true,
        });
      }
    }

    const manifest = {
      meta: currentMeta.meta || {
        jsonFormatVersion: '2.0.0',
        exportedAt: new Date().toISOString(),
      },
      info: currentMeta.info || {
        name: 'database_project',
        description: 'Exported from DBML Editor',
        version: '1.0.0',
      },
      files: {
        schemas: schemasList,
        erds: erdsList,
      },
    };

    files.push({
      filename: 'project.json',
      content: JSON.stringify(manifest, null, 2),
    });

    // 2. schemas/*.dbml の追加
    if (appStore.state.schemas) {
      for (const [name, entry] of appStore.state.schemas.entries()) {
        const schemaFilename = entry.filename || name;
        // 日本語コメント: アクティブスキーマかつメモリ上にテーブル等のASTが存在する場合は最新変更を反映したDBMLを再生成
        let dbmlContent = entry.dbml || '';
        if (name === appStore.state.activeSchema && appStore.state.tables) {
          try {
            dbmlContent = generateDbml({
              project: appStore.state.project,
              tables: appStore.state.tables,
              tableGroups: appStore.state.tableGroups,
              notes: appStore.state.notes,
              refs: appStore.state.refs,
            });
          } catch (err) {
            console.warn('[handleProjectExport] generateDbml error, fallback to entry.dbml:', err);
            dbmlContent = entry.dbml || '';
          }
        }
        files.push({
          filename: `schemas/${schemaFilename}.dbml`,
          content: dbmlContent,
        });
      }
    }

    // 3. erds/*.json の追加
    if (appStore.state.erds) {
      for (const [erdId, entry] of appStore.state.erds.entries()) {
        const erdIdClean = entry.id || erdId;
        const erdData = {
          id: erdIdClean,
          name: entry.name || t('erd.title'),
          description: entry.description || '',
          content: entry.content || {},
        };
        files.push({
          filename: `erds/${erdIdClean}.json`,
          content: JSON.stringify(erdData, null, 2),
        });
      }
    }

    // 4. ZIP Blob の生成とダウンロード
    const zipBlob = createZipBlob(files);
    const projectName = currentMeta.info?.name || 'database_project';
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = `${projectName}_${nowStr}.zip`.replace(/[\\/:*?"<>|]/g, '_');

    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    this.element.style.display = 'none';
  }
}
