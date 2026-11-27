// 日本語コメント: マイグレーションメインビュー (src/components/migration-view/migration-view.js)
// 中央コンテンツ領域（pane-content）に全画面で展開されるデータベース設計変更・運用支援ビューです。
// テキストエディタのスクロールズレを廃止し、ASTモデルベースの【ズレない構造化Side-by-Side Diff】を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { diffSchemas, formatColumnFullType } from '../../core/schema-diff.js';
import { dialectManager } from '../../dialects/index.js';
import { createZipBlob } from '../../core/zip-utils.js';
import { generateDbml } from '../../core/dbml-generator.js';
import { generateStandardMigrationSql } from '../../core/migration-sql-generator.js';
import { attachTextareaSearchController, attachTextareaLineNumbers } from '../../core/text-search-helper.js';
import { bindSearchClear } from '../../core/search-clear.js';
import './migration-view.css';

/**
 * 日本語コメント: HTMLエスケープ処理（XSS防止および安全なテキストレンダリング）
 * @param {string} str - 対象文字列
 * @returns {string} エスケープ済み文字列
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

export class DbeMigrationView {
  constructor(container) {
    this.container = container;
    this.element = null;

    this.currentTab = 'step1'; // 'step1' | 'step2' | 'step3'
    this.isOpened = false;
    this.diffResult = null;
    this.generatedScripts = null; // { [tableName]: [{ filename, content }] }
    this.selectedTableNames = new Set();
    this.activeDiffTableName = null;
    this.activeFileKey = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-migration-view';

    this.element.innerHTML = `
      <!-- 1. トップバー -->
      <div class="migration-header-bar">
        <div class="migration-header-title">
          <h2><span>🚀</span> ${t('migration.title')}</h2>
          <div class="migration-badges" id="migrationSummaryBadges"></div>
        </div>
        <button class="btn-back-to-editor" id="btnBackToEditor">
          ${t('migration.backToEditor')}
        </button>
      </div>

      <!-- 2. ステップタブ -->
      <div class="migration-nav-tabs">
        <button class="migration-nav-tab active" data-tab="step1">${t('migration.tabStep1')}</button>
        <button class="migration-nav-tab" data-tab="step2">${t('migration.tabStep2')}</button>
        <button class="migration-nav-tab" data-tab="step3">${t('migration.tabStep3')}</button>
      </div>

      <!-- 3. メインコンテンツ領域 -->
      <div class="migration-main-content">
        
        <!-- Step 1: 入力ペイン -->
        <div class="migration-tab-pane active" id="paneStep1">
          <div class="migration-step1-container">
            <div class="step1-header-action">
              <button class="btn-primary-action" id="btnRunDiff">
                ${t('migration.runDiffBtn')} ➔
              </button>
            </div>
            <div class="step1-grid">
              
              <!-- 左: 比較元 (旧DBML) -->
              <div class="step1-card">
                <div class="step1-card-header">
                  <span>${t('migration.oldDbmlLabel')}</span>
                  <div style="display:flex; align-items:center; gap:8px;">
                    <select id="selectOldSchema" style="font-size:0.8rem; padding:2px 6px;">
                      <option value="">${t('migration.selectSchemaPrompt')}</option>
                    </select>
                    <label for="inputOldFile" class="btn-secondary-action" style="cursor:pointer; font-size:0.78rem; padding:2px 8px;">
                      ${t('migration.loadFile')}
                    </label>
                    <input type="file" id="inputOldFile" accept=".dbml,.sql,.txt" style="display:none;" />
                  </div>
                </div>
                <div class="step1-card-body">
                  <div class="step1-search-bar">
                    <div class="dbe-search-input-wrap" style="flex: 1;">
                      <input type="text" id="inputOldDbmlSearch" class="step1-search-input" placeholder="${t('preview.search_placeholder')}" />
                      <button type="button" id="btnOldDbmlSearchClear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                    </div>
                    <span id="oldDbmlSearchCount" class="step1-search-count"></span>
                    <button type="button" id="btnOldDbmlPrev" class="step1-search-btn" title="${t('preview.btn_prev')}">▲</button>
                    <button type="button" id="btnOldDbmlNext" class="step1-search-btn" title="${t('preview.btn_next')}">▼</button>
                  </div>
                  <div class="dbml-editor-with-gutter">
                    <div id="gutterOldDbml" class="dbml-line-gutter" aria-hidden="true">1</div>
                    <textarea id="textareaOldDbml" class="dbml-textarea-input" wrap="off" placeholder="${t('migration.oldDbmlPlaceholder')}"></textarea>
                  </div>
                </div>
              </div>

              <!-- 右: 比較先 (新DBML) -->
              <div class="step1-card">
                <div class="step1-card-header">
                  <span>${t('migration.targetSchemaLabel')}</span>
                  <select id="selectNewSchema" style="font-size:0.8rem; padding:2px 6px;"></select>
                </div>
                <div class="step1-card-body">
                  <div class="step1-search-bar">
                    <div class="dbe-search-input-wrap" style="flex: 1;">
                      <input type="text" id="inputNewDbmlSearch" class="step1-search-input" placeholder="${t('preview.search_placeholder')}" />
                      <button type="button" id="btnNewDbmlSearchClear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                    </div>
                    <span id="newDbmlSearchCount" class="step1-search-count"></span>
                    <button type="button" id="btnNewDbmlPrev" class="step1-search-btn" title="${t('preview.btn_prev')}">▲</button>
                    <button type="button" id="btnNewDbmlNext" class="step1-search-btn" title="${t('preview.btn_next')}">▼</button>
                  </div>
                  <div class="dbml-editor-with-gutter">
                    <div id="gutterNewDbml" class="dbml-line-gutter" aria-hidden="true">1</div>
                    <textarea id="textareaNewDbml" class="dbml-textarea-input" wrap="off" placeholder="${t('migration.newDbmlPlaceholder')}"></textarea>
                  </div>
                </div>
              </div>

            </div>
          </div>
        </div>

        <!-- Step 2: ズレない構造化Side-by-Side Diffペイン -->
        <div class="migration-tab-pane" id="paneStep2">
          <div class="migration-step2-container">
            
            <!-- 左: 差分テーブル一覧サイドバー -->
            <div class="step2-table-sidebar">
              <div class="step2-sidebar-header">
                <div class="dbe-search-input-wrap">
                  <input type="text" class="step2-search-input" id="inputTableFilter" placeholder="${t('migration.filterTablesPlaceholder')}" />
                  <button type="button" id="btnTableFilterClear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                </div>
                <label class="step2-diff-only-label" style="display:flex; align-items:center; gap:6px; margin-top:6px; font-size:0.78rem; color:var(--text-secondary); cursor:pointer; user-select:none;">
                  <input type="checkbox" id="chkDiffOnly" checked />
                  <span>${t('migration.showChangedOnly')}</span>
                </label>
                <div class="step2-actions-row">
                  <div>
                    <button class="btn-secondary-action" id="btnSelectAll" style="padding:2px 6px; font-size:0.75rem;">${t('migration.selectAll')}</button>
                    <button class="btn-secondary-action" id="btnDeselectAll" style="padding:2px 6px; font-size:0.75rem;">${t('migration.deselectAll')}</button>
                  </div>
                  <span id="selectedCountLabel" style="color:var(--text-secondary); font-size:0.78rem;"></span>
                </div>
              </div>
              <div class="step2-table-list" id="diffTableList"></div>
            </div>

            <!-- 右: 構造化 Side-by-Side カラムDiff詳細 -->
            <div class="step2-diff-detail">
              
              <!-- オプションツールバー -->
              <div class="step2-options-toolbar">
                <div style="display:flex; align-items:center; gap:6px;">
                  <label for="selectTargetDbms" style="font-weight:600;">${t('migration.dbmsLabel')}</label>
                  <select id="selectTargetDbms" style="padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                    <option value="standard" selected>Standard (ANSI SQL)</option>
                  </select>
                </div>

                <div style="display:flex; align-items:center; gap:6px;">
                  <input type="checkbox" id="chkIncludeComment" checked />
                  <label for="chkIncludeComment" style="cursor:pointer; font-weight:600;">${t('migration.includeComment')}</label>
                </div>

                <!-- 日本語コメント: エクスポート画面と統一したコメント生成元選択 (Note / 論理名 / 両方) -->
                <div style="display:flex; align-items:center; gap:6px;" id="wrapperCommentSource">
                  <label for="selectCommentSource" style="font-weight:600;">${t('migration.commentSourceLabel')}</label>
                  <select id="selectCommentSource" style="padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                    <option value="note">${t('migration.commentSourceNote')}</option>
                    <option value="logicalName">${t('migration.commentSourceLogical')}</option>
                    <option value="both" selected>${t('migration.commentSourceBoth')}</option>
                  </select>
                </div>

                <!-- 日本語コメント: 表領域 (TABLESPACE) 出力チェックボックス (デフォルト checked) -->
                <div style="display:flex; align-items:center; gap:6px;">
                  <input type="checkbox" id="chkIncludeTablespace" checked />
                  <label for="chkIncludeTablespace" style="cursor:pointer; font-weight:600;">${t('migration.includeTablespace')}</label>
                </div>

                <!-- 日本語コメント: PCTFREE / INITRANS 物理属性出力チェックボックス (デフォルト checked) -->
                <div style="display:flex; align-items:center; gap:6px;">
                  <input type="checkbox" id="chkIncludePctfreeInitrans" checked />
                  <label for="chkIncludePctfreeInitrans" style="cursor:pointer; font-weight:600;">${t('migration.includePctfreeInitrans')}</label>
                </div>

                <div style="display:flex; align-items:center; gap:6px;">
                  <label for="selectEncoding" style="font-weight:600;">${t('migration.encodingLabel')}</label>
                  <select id="selectEncoding" style="padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                    <option value="utf-8" selected>UTF-8</option>
                    <option value="sjis">Shift_JIS</option>
                  </select>
                </div>

                <div style="display:flex; align-items:center; gap:6px;">
                  <label for="selectLineEnding" style="font-weight:600;">${t('migration.lineEndingLabel')}</label>
                  <select id="selectLineEnding" style="padding:2px 8px; border-radius:4px; font-size:0.8rem;">
                    <option value="LF" selected>LF (Linux/Mac)</option>
                    <option value="CRLF">CRLF (Windows)</option>
                  </select>
                </div>

                <div style="margin-left:auto;">
                  <button class="btn-primary-action" id="btnGenerateSql">
                    ${t('migration.generateSqlBtn')} ➔
                  </button>
                </div>
              </div>

              <!-- ズレない構造化Side-by-SideカラムDiff本体 -->
              <div class="structured-diff-container" id="structuredDiffContainer">
                <div style="display:flex; align-items:center; justify-content:center; height:100%; color:var(--text-secondary);">
                  ${t('migration.selectTablePrompt')}
                </div>
              </div>

            </div>

          </div>
        </div>

        <!-- Step 3: SQL生成 & プレビュー & エクスポートペイン -->
        <div class="migration-tab-pane" id="paneStep3">
          <div class="migration-step3-container">
            
            <!-- 左: 生成ファイル一覧 -->
            <div class="step3-file-sidebar">
              <div class="step3-sidebar-header">${t('migration.generatedSqlScriptsHeader')}</div>
              <div class="step3-file-list" id="generatedFileList"></div>
            </div>

            <!-- 右: SQLプレビューと各種エクスポート -->
            <div class="step3-preview-pane">
              <div class="step3-preview-header">
                <div class="step3-preview-title" id="activeFileTitle">-</div>
                <div class="step3-preview-actions">
                  <button class="btn-secondary-action" id="btnCopySql">${t('migration.copyBtn')}</button>
                  <button class="btn-primary-action" id="btnDownloadZip">${t('migration.downloadZipBtn')}</button>
                </div>
              </div>
              <pre class="step3-sql-viewer" id="sqlPreviewViewer"></pre>
            </div>

          </div>
        </div>

      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // エディタへ戻るボタン
    this.element.querySelector('#btnBackToEditor')?.addEventListener('click', () => {
      appStore.emit('view:restore');
    });

    // タブ切り替え
    const tabs = this.element.querySelectorAll('.migration-nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        this.switchTab(tab.dataset.tab);
      });
    });

    // 日本語コメント: 変更前・変更後 DBML テキストエリア用の検索コントローラ・行番号ガターを初期化
    const oldTextarea = this.element.querySelector('#textareaOldDbml');
    const newTextarea = this.element.querySelector('#textareaNewDbml');
    this.oldLineCtrl = attachTextareaLineNumbers(oldTextarea, this.element.querySelector('#gutterOldDbml'));
    this.newLineCtrl = attachTextareaLineNumbers(newTextarea, this.element.querySelector('#gutterNewDbml'));
    this.oldSearchCtrl = attachTextareaSearchController({
      textarea: oldTextarea,
      inputEl: this.element.querySelector('#inputOldDbmlSearch'),
      countEl: this.element.querySelector('#oldDbmlSearchCount'),
      prevBtn: this.element.querySelector('#btnOldDbmlPrev'),
      nextBtn: this.element.querySelector('#btnOldDbmlNext'),
    });
    this.newSearchCtrl = attachTextareaSearchController({
      textarea: newTextarea,
      inputEl: this.element.querySelector('#inputNewDbmlSearch'),
      countEl: this.element.querySelector('#newDbmlSearchCount'),
      prevBtn: this.element.querySelector('#btnNewDbmlPrev'),
      nextBtn: this.element.querySelector('#btnNewDbmlNext'),
    });
    bindSearchClear(
      this.element.querySelector('#inputOldDbmlSearch'),
      this.element.querySelector('#btnOldDbmlSearchClear')
    );
    bindSearchClear(
      this.element.querySelector('#inputNewDbmlSearch'),
      this.element.querySelector('#btnNewDbmlSearchClear')
    );
    oldTextarea?.addEventListener('input', () => this.oldSearchCtrl?.refresh(false));
    newTextarea?.addEventListener('input', () => this.newSearchCtrl?.refresh(false));

    // ファイル読込
    const fileInput = this.element.querySelector('#inputOldFile');
    fileInput?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      if (oldTextarea) oldTextarea.value = text;
      this.oldLineCtrl?.refresh();
      this.oldSearchCtrl?.refresh(false);
      fileInput.value = '';
    });

    // スキーマ選択時の自動反映
    this.element.querySelector('#selectOldSchema')?.addEventListener('change', (e) => {
      const schemaId = e.target.value;
      if (schemaId) {
        const text = this.getSchemaDbmlText(schemaId);
        if (oldTextarea) oldTextarea.value = text;
        this.oldLineCtrl?.refresh();
        this.oldSearchCtrl?.refresh(false);
      }
    });

    this.element.querySelector('#selectNewSchema')?.addEventListener('change', (e) => {
      const schemaId = e.target.value;
      if (schemaId) {
        const text = this.getSchemaDbmlText(schemaId);
        if (newTextarea) newTextarea.value = text;
        this.newLineCtrl?.refresh();
        this.newSearchCtrl?.refresh(false);
      }
    });

    // Diff実行
    this.element.querySelector('#btnRunDiff')?.addEventListener('click', () => {
      this.executeDiff();
    });

    // 全選択 / 全解除
    this.element.querySelector('#btnSelectAll')?.addEventListener('click', () => {
      if (!this.diffResult) return;
      this.diffResult.tables.forEach(t => {
        if (t.status !== 'UNCHANGED') this.selectedTableNames.add(t.name.toLowerCase());
      });
      this.updateTableCheckboxes();
    });

    this.element.querySelector('#btnDeselectAll')?.addEventListener('click', () => {
      this.selectedTableNames.clear();
      this.updateTableCheckboxes();
    });

    // テーブル検索フィルタ
    const tableFilterInput = this.element.querySelector('#inputTableFilter');
    tableFilterInput?.addEventListener('input', (e) => {
      this.filterTableList(e.target.value);
    });
    bindSearchClear(tableFilterInput, this.element.querySelector('#btnTableFilterClear'));

    // 日本語コメント: 差分のあるテーブルのみ表示チェックボックスの変更時フィルタリング
    this.element.querySelector('#chkDiffOnly')?.addEventListener('change', () => {
      this.filterTableList();
    });

    // 日本語コメント: コメント出力チェックボックスと生成元セレクトボックスの連動
    const chkComment = this.element.querySelector('#chkIncludeComment');
    const selectCommentSource = this.element.querySelector('#selectCommentSource');
    if (chkComment && selectCommentSource) {
      const updateCommentSourceState = () => {
        selectCommentSource.disabled = !chkComment.checked;
      };
      chkComment.addEventListener('change', updateCommentSourceState);
      updateCommentSourceState();
    }

    // SQL生成ボタン (非同期ハンドリング)
    this.element.querySelector('#btnGenerateSql')?.addEventListener('click', async () => {
      await this.executeGenerateSql();
    });

    // クリップボードコピー
    this.element.querySelector('#btnCopySql')?.addEventListener('click', () => {
      const viewer = this.element.querySelector('#sqlPreviewViewer');
      if (viewer && viewer.textContent) {
        navigator.clipboard.writeText(viewer.textContent);
        alert(t('migration.alertCopied'));
      }
    });

    // 一括ZIPダウンロード (外部依存ゼロ)
    this.element.querySelector('#btnDownloadZip')?.addEventListener('click', () => {
      if (!this.generatedScripts) return;
      const filePayload = [];
      for (const [tblName, fileList] of Object.entries(this.generatedScripts)) {
        fileList.forEach(f => {
          filePayload.push({
            filename: `${tblName}_${f.filename}`,
            content: f.content
          });
        });
      }

      if (filePayload.length === 0) return;

      const lineEnding = this.element.querySelector('#selectLineEnding')?.value || 'LF';
      const zipBlob = createZipBlob(filePayload, { lineEnding });
      const timestamp = new Date().toISOString().replace(/[-T:]/g, '').slice(0, 14);
      this.downloadBlob(zipBlob, `migration_scripts_${timestamp}.zip`);
    });
  }

  bindStore() {
    // プロジェクト変更時にスキーマ一覧を再同期（非表示中の無駄な再計算を防止）
    appStore.on('project:loaded', () => {
      if (this.isOpened) this.refreshSchemaSelects();
    });
    appStore.on('schema:activated', () => {
      if (this.isOpened) this.syncActiveSchema();
    });
  }

  /**
   * 画面表示時の初期化処理
   */
  open() {
    this.isOpened = true;
    this.refreshSchemaSelects();
    this.updateTargetDbmsSelect();
    this.syncActiveSchema();
    this.oldLineCtrl?.refresh();
    this.switchTab('step1');
  }

  /**
   * 日本語コメント: ビュークローズ時のクリーンアップ（離脱後の大量DOM・メモリ負荷を解放）
   */
  close() {
    this.isOpened = false;
    this.diffResult = null;
    this.generatedScripts = null;
    this.selectedTableNames.clear();
    this.activeDiffTableName = null;
    this.activeFileKey = null;

    const clearHtmlIds = ['#structuredDiffContainer', '#diffTableList', '#generatedFileList'];
    for (const selector of clearHtmlIds) {
      const el = this.element?.querySelector(selector);
      if (el) el.innerHTML = '';
    }

    const clearTextIds = ['#sqlPreviewViewer', '#gutterOldDbml', '#gutterNewDbml'];
    for (const selector of clearTextIds) {
      const el = this.element?.querySelector(selector);
      if (el) el.textContent = '';
    }
  }

  /**
   * マイグレーション出力先方言プルダウンの動的更新
   * 登録済み方言プラグインに加え、標準対応（PostgreSQL, MySQL, Standard）を重複なく統合します。
   */
  updateTargetDbmsSelect() {
    const select = this.element.querySelector('#selectTargetDbms');
    if (!select) return;

    const prevVal = select.value || 'postgresql';
    const registeredDialects = dialectManager.getAll();
    const standardSupported = new Set(['postgresql', 'mysql', 'standard', 'ansi']);

    // 組み込み方言候補の定義
    const builtinDefs = [
      { id: 'postgresql', displayName: 'PostgreSQL' },
      { id: 'mysql', displayName: 'MySQL / MariaDB' },
      { id: 'standard', displayName: 'Standard (ANSI SQL)' }
    ];

    const options = [];
    const seenIds = new Set();

    // 1. プラグイン・登録済み方言の収集
    for (const d of registeredDialects) {
      const idKey = (d.id || '').toLowerCase();
      seenIds.add(idKey);
      const isSqlSupported = typeof d.migrationGenerator === 'function' || standardSupported.has(idKey);
      options.push({
        id: d.id,
        displayName: d.displayName || d.id,
        supported: isSqlSupported
      });
    }

    // 2. 組み込み標準方言（PostgreSQL, MySQL, Standard）で未登録のものを補完
    for (const b of builtinDefs) {
      if (!seenIds.has(b.id.toLowerCase())) {
        seenIds.add(b.id.toLowerCase());
        options.push({
          id: b.id,
          displayName: b.displayName,
          supported: true
        });
      }
    }

    select.innerHTML = options.map(opt => {
      const suffix = opt.supported ? '' : ` (${t('migration.sqlNotSupported')})`;
      return `<option value="${opt.id}">${opt.displayName}${suffix}</option>`;
    }).join('');

    // 直前の選択値、または先頭要素を選択
    if (options.some(o => o.id === prevVal)) {
      select.value = prevVal;
    } else if (options.length > 0) {
      select.value = options[0].id;
    }
  }

  /**
   * 日本語コメント: 変更後 DBML テキスト（および選択中スキーマモデル）から対象 DBMS (database_type) を検出し、
   * Step 2 の #selectTargetDbms プルダウン初期値として自動反映します。
   * @param {string} newDbmlText - 変更後（比較先）の DBML テキスト
   */
  syncTargetDbmsFromNewDbml(newDbmlText) {
    const select = this.element.querySelector('#selectTargetDbms');
    if (!select) return;

    let rawDbType = '';

    // 1. DBML テキスト内の Project { database_type: '...' } から抽出
    if (newDbmlText && typeof newDbmlText === 'string') {
      const match = newDbmlText.match(/\bdatabase_type\s*:\s*(['"`])([^'"`]+)\1/i);
      if (match && match[2]) {
        rawDbType = match[2].trim();
      }
    }

    // 2. テキストから取得できない場合は、選択中スキーマのモデル情報からフォールバック取得
    if (!rawDbType) {
      const newSchemaName = this.element.querySelector('#selectNewSchema')?.value || appStore.state.activeSchema;
      const schemasMap = appStore.state.schemas;
      if (newSchemaName && schemasMap && typeof schemasMap.get === 'function') {
        const entry = schemasMap.get(newSchemaName);
        if (entry?.model?.project?.databaseType) {
          rawDbType = String(entry.model.project.databaseType).trim();
        }
      }
    }

    if (!rawDbType) return;

    // 3. 登録済み方言プラグインまたは組み込み方言 ID へ正規化
    let targetId = '';
    const resolved = dialectManager.resolve(rawDbType);
    if (resolved && resolved.id && resolved.id !== 'standard') {
      targetId = resolved.id;
    } else {
      const lower = rawDbType.toLowerCase();
      if (lower.includes('oracle')) targetId = 'oracle';
      else if (lower.includes('postgres')) targetId = 'postgresql';
      else if (lower.includes('mysql') || lower.includes('mariadb')) targetId = 'mysql';
      else if (lower.includes('standard') || lower.includes('ansi') || lower.includes('dbml')) targetId = 'standard';
    }

    if (!targetId) return;

    // 4. プルダウンの選択肢に一致する option があれば選択
    const matchedOpt = Array.from(select.options).find(
      opt => opt.value.toLowerCase() === targetId.toLowerCase()
    );
    if (matchedOpt) {
      select.value = matchedOpt.value;
    }
  }

  /**
   * スキーマ選択ドロップダウンの更新
   */
  refreshSchemaSelects() {
    const schemasMap = appStore.state.schemas || new Map();
    const activeSchemaName = appStore.state.activeSchema;

    const oldSelect = this.element.querySelector('#selectOldSchema');
    const newSelect = this.element.querySelector('#selectNewSchema');

    if (oldSelect) {
      oldSelect.innerHTML = `<option value="">${t('migration.selectSchemaPrompt')}</option>`;
      for (const [filename] of schemasMap.entries()) {
        const opt = document.createElement('option');
        opt.value = filename;
        opt.textContent = filename;
        oldSelect.appendChild(opt);
      }
    }

    if (newSelect) {
      newSelect.innerHTML = '';
      for (const [filename] of schemasMap.entries()) {
        const opt = document.createElement('option');
        opt.value = filename;
        const isActive = filename === activeSchemaName;
        opt.textContent = `${filename}${isActive ? ` [${t('migration.activeEditing')}]` : ''}`;
        newSelect.appendChild(opt);
        if (isActive) opt.selected = true;
      }
    }
  }

  /**
   * アクティブスキーマのDBMLを比較先（新DBML）へ自動設定
   */
  syncActiveSchema() {
    const activeSchemaName = appStore.state.activeSchema;
    if (activeSchemaName) {
      const text = this.getSchemaDbmlText(activeSchemaName);
      const textarea = this.element.querySelector('#textareaNewDbml');
      if (textarea) {
        textarea.value = text;
        this.newLineCtrl?.refresh();
        this.newSearchCtrl?.refresh(false);
      }
    }
  }

  /**
   * スキーマ名からDBMLテキストを抽出
   */
  getSchemaDbmlText(schemaName) {
    const schemasMap = appStore.state.schemas || new Map();
    const entry = schemasMap.get(schemaName);
    if (!entry) return '';
    if (entry.dbml && entry.dbml.trim()) return entry.dbml;
    if (entry.model) {
      try {
        return generateDbml({
          project: entry.model.project || {},
          tables: entry.model.tables || [],
          refs: entry.model.refs || [],
          tableGroups: entry.model.tableGroups || []
        });
      } catch (_) {}
    }
    return '';
  }

  /**
   * タブ切り替え
   */
  switchTab(tabId) {
    this.currentTab = tabId;

    const tabs = this.element.querySelectorAll('.migration-nav-tab');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabId);
    });

    this.element.querySelector('#paneStep1')?.classList.toggle('active', tabId === 'step1');
    this.element.querySelector('#paneStep2')?.classList.toggle('active', tabId === 'step2');
    this.element.querySelector('#paneStep3')?.classList.toggle('active', tabId === 'step3');
  }

  /**
   * Diffの実行
   */
  executeDiff() {
    const oldText = this.element.querySelector('#textareaOldDbml')?.value || '';
    const newText = this.element.querySelector('#textareaNewDbml')?.value || '';

    if (!oldText.trim()) {
      alert(t('migration.alertOldEmpty'));
      return;
    }
    if (!newText.trim()) {
      alert(t('migration.alertNewEmpty'));
      return;
    }

    try {
      this.diffResult = diffSchemas(oldText, newText);
      // 日本語コメント: 変更後の DBML に記述された database_type から対象 DBMS の初期値を自動設定
      this.updateTargetDbmsSelect();
      this.syncTargetDbmsFromNewDbml(newText);

      this.renderDiffSummaryBadges();
      this.renderDiffTableList();
      this.switchTab('step2');

      // 日本語コメント: 差分のあるテーブルのみ表示が有効な場合は最初の変更テーブルを優先選択
      if (this.diffResult.tables.length > 0) {
        const diffOnly = this.element.querySelector('#chkDiffOnly')?.checked ?? true;
        const firstTarget = (diffOnly
          ? this.diffResult.tables.find(t => t.status !== 'UNCHANGED')
          : null) || this.diffResult.tables[0];
        this.selectDiffTable(firstTarget.name);
      }
    } catch (err) {
      console.error('[MigrationView] Diff error:', err);
      alert(t('migration.alertDiffError') + err.message);
    }
  }

  /**
   * ヘッダーサマリーバッジの描画
   */
  renderDiffSummaryBadges() {
    const container = this.element.querySelector('#migrationSummaryBadges');
    if (!container || !this.diffResult) return;

    let addCount = 0;
    let dropCount = 0;
    let modifyCount = 0;

    this.diffResult.tables.forEach(t => {
      if (t.status === 'ADD') addCount++;
      else if (t.status === 'DROP') dropCount++;
      else if (t.status === 'MODIFY') modifyCount++;
    });

    container.innerHTML = `
      <span class="migration-badge-pill add">+${addCount} ${t('migration.badgeAdd')}</span>
      <span class="migration-badge-pill drop">-${dropCount} ${t('migration.badgeDrop')}</span>
      <span class="migration-badge-pill modify">${modifyCount} ${t('migration.badgeModify')}</span>
    `;
  }

  /**
   * 差分テーブル一覧の描画
   */
  renderDiffTableList() {
    const target = this.element.querySelector('#diffTableList');
    if (!target) return;
    target.innerHTML = '';

    this.selectedTableNames.clear();

    if (!this.diffResult || this.diffResult.tables.length === 0) {
      target.innerHTML = `<div style="padding:14px; color:var(--text-secondary);">${t('migration.noTablesFound')}</div>`;
      return;
    }

    this.diffResult.tables.forEach(tableDiff => {
      const isChanged = tableDiff.status !== 'UNCHANGED';
      if (isChanged) {
        this.selectedTableNames.add(tableDiff.name.toLowerCase());
      }

      const itemEl = document.createElement('div');
      itemEl.className = 'step2-table-item';
      itemEl.dataset.name = tableDiff.name;
      itemEl.dataset.status = tableDiff.status;

      let badgeClass = 'modify';
      let badgeLabel = t('migration.badgeModify');
      if (tableDiff.status === 'ADD') {
        badgeClass = 'add';
        badgeLabel = t('migration.badgeAdd');
      } else if (tableDiff.status === 'DROP') {
        badgeClass = 'drop';
        badgeLabel = t('migration.badgeDrop');
      } else if (tableDiff.status === 'UNCHANGED') {
        badgeClass = 'unchanged';
        badgeLabel = t('migration.badgeUnchanged');
      }

      itemEl.innerHTML = `
        <div class="step2-table-info">
          <input type="checkbox" class="chk-table-select" data-name="${escapeHtml(tableDiff.name.toLowerCase())}" ${isChanged ? 'checked' : ''} ${!isChanged ? 'disabled' : ''} />
          <div style="min-width:0;">
            <div class="step2-table-name" title="${escapeHtml(tableDiff.name)}">${escapeHtml(tableDiff.name)}</div>
            <div class="step2-table-summary">${escapeHtml(tableDiff.summary || '')}</div>
          </div>
        </div>
        <span class="migration-badge-pill ${badgeClass}">${badgeLabel}</span>
      `;

      // クリックで右ペインの構造化Diffを切り替え
      itemEl.addEventListener('click', (e) => {
        if (e.target.tagName.toLowerCase() === 'input') return;
        this.selectDiffTable(tableDiff.name);
      });

      // チェックボックス操作
      const chk = itemEl.querySelector('.chk-table-select');
      chk.addEventListener('change', (e) => {
        const name = e.target.dataset.name;
        if (e.target.checked) this.selectedTableNames.add(name);
        else this.selectedTableNames.delete(name);
        this.updateSelectedCountLabel();
      });

      target.appendChild(itemEl);
    });

    this.updateSelectedCountLabel();
    // 日本語コメント: 描画直後に検索キーワードおよび「差分のあるテーブルのみ表示」フィルタを適用
    this.filterTableList();
  }

  /**
   * テーブル選択時のズレない構造化Side-by-Side Diff描画（カラム・インデックス・FK・属性の完全対比）
   */
  selectDiffTable(tableName) {
    this.activeDiffTableName = tableName;

    // 左一覧のアクティブハイライト
    this.element.querySelectorAll('.step2-table-item').forEach(el => {
      el.classList.toggle('selected', el.dataset.name === tableName);
    });

    const tableDiff = this.diffResult?.tables.find(t => t.name.toLowerCase() === tableName.toLowerCase());
    const detailContainer = this.element.querySelector('#structuredDiffContainer');
    if (!detailContainer) return;

    if (!tableDiff) {
      detailContainer.innerHTML = `<div style="padding:20px; color:var(--text-secondary);">${t('migration.selectTablePrompt')}</div>`;
      return;
    }

    const alignedColumns = tableDiff.alignedColumns || [];
    const alignedIndexes = tableDiff.alignedIndexes || [];
    const alignedFks = tableDiff.alignedFks || [];
    const alignedAttributes = tableDiff.alignedAttributes || [];
    const targetDbms = this.element.querySelector('#selectTargetDbms')?.value || 'standard';

    // 1. カラム差分行の生成 (1対1アラインメント)
    let columnRowsHtml = '';
    alignedColumns.forEach(pair => {
      const { oldCol, newCol, status } = pair;

      let rowClass = '';
      if (status === 'ADDED') rowClass = 'row-added';
      else if (status === 'DROPPED') rowClass = 'row-dropped';
      else if (status === 'MODIFIED') rowClass = 'row-modified';

      // 左セル (旧定義)
      let oldCardHtml = '';
      if (oldCol) {
        const fullType = formatColumnFullType(oldCol, targetDbms);
        oldCardHtml = `
          <div class="col-card old-col">
            <span class="col-name-badge">${escapeHtml(oldCol.name)}</span>
            <span class="col-type-badge">${escapeHtml(fullType)}</span>
            ${oldCol.pk ? '<span class="col-attr-tag pk">PK</span>' : ''}
            ${oldCol.notNull ? '<span class="col-attr-tag notnull">NOT NULL</span>' : ''}
            ${oldCol.note ? `<span class="col-attr-tag note" title="${escapeHtml(oldCol.note)}">${escapeHtml(oldCol.note)}</span>` : ''}
          </div>
        `;
      } else {
        oldCardHtml = `<div class="col-card empty-placeholder">${t('migration.notDefinedInOld')}</div>`;
      }

      // 右セル (新定義)
      let newCardHtml = '';
      if (newCol) {
        const fullType = formatColumnFullType(newCol, targetDbms);
        newCardHtml = `
          <div class="col-card new-col">
            <span class="col-name-badge">${escapeHtml(newCol.name)}</span>
            <span class="col-type-badge">${escapeHtml(fullType)}</span>
            ${newCol.pk ? '<span class="col-attr-tag pk">PK</span>' : ''}
            ${newCol.notNull ? '<span class="col-attr-tag notnull">NOT NULL</span>' : ''}
            ${newCol.note ? `<span class="col-attr-tag note" title="${escapeHtml(newCol.note)}">${escapeHtml(newCol.note)}</span>` : ''}
          </div>
        `;
      } else {
        newCardHtml = `<div class="col-card empty-placeholder">${t('migration.droppedInNew')}</div>`;
      }

      // 差分インジケータ記号
      let indicator = '⇄';
      if (status === 'ADDED') indicator = '＋';
      else if (status === 'DROPPED') indicator = '－';
      else if (status === 'UNCHANGED') indicator = '＝';

      columnRowsHtml += `
        <tr class="structured-diff-row ${rowClass}">
          <td class="structured-diff-cell">${oldCardHtml}</td>
          <td class="structured-diff-cell divider">${indicator}</td>
          <td class="structured-diff-cell">${newCardHtml}</td>
        </tr>
      `;
    });

    // 2. インデックス差分行の生成
    let indexSectionHtml = '';
    if (alignedIndexes.length > 0) {
      let indexRowsHtml = '';
      alignedIndexes.forEach(pair => {
        const { status, oldIdx, newIdx, name, summary } = pair;
        let rowClass = '';
        if (status === 'ADDED') rowClass = 'row-added';
        else if (status === 'DROPPED') rowClass = 'row-dropped';
        else if (status === 'MODIFIED') rowClass = 'row-modified';

        // 旧インデックス定義カード
        let oldCardHtml = '';
        if (oldIdx) {
          const oldFields = (oldIdx.fields || oldIdx.columns || []).map(c => (typeof c === 'object' && c !== null ? (c.value || c.name || '') : String(c))).join(', ');
          oldCardHtml = `
            <div class="col-card old-col">
              <span class="col-name-badge">${escapeHtml(oldIdx.name || name || 'INDEX')}</span>
              <span class="col-type-badge">(${escapeHtml(oldFields)})</span>
              ${oldIdx.unique ? '<span class="col-attr-tag unique">UNIQUE</span>' : ''}
              ${oldIdx.type && oldIdx.type.toLowerCase() !== 'btree' ? `<span class="col-attr-tag type">${escapeHtml(oldIdx.type.toUpperCase())}</span>` : ''}
              ${summary ? `<span class="col-attr-tag note" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>` : ''}
            </div>
          `;
        } else {
          oldCardHtml = `<div class="col-card empty-placeholder">${t('migration.notDefinedInOld')}</div>`;
        }

        // 新インデックス定義カード
        let newCardHtml = '';
        if (newIdx) {
          const newFields = (newIdx.fields || newIdx.columns || []).map(c => (typeof c === 'object' && c !== null ? (c.value || c.name || '') : String(c))).join(', ');
          newCardHtml = `
            <div class="col-card new-col">
              <span class="col-name-badge">${escapeHtml(newIdx.name || name || 'INDEX')}</span>
              <span class="col-type-badge">(${escapeHtml(newFields)})</span>
              ${newIdx.unique ? '<span class="col-attr-tag unique">UNIQUE</span>' : ''}
              ${newIdx.type && newIdx.type.toLowerCase() !== 'btree' ? `<span class="col-attr-tag type">${escapeHtml(newIdx.type.toUpperCase())}</span>` : ''}
              ${summary ? `<span class="col-attr-tag note" title="${escapeHtml(summary)}">${escapeHtml(summary)}</span>` : ''}
            </div>
          `;
        } else {
          newCardHtml = `<div class="col-card empty-placeholder">${t('migration.droppedInNew')}</div>`;
        }

        let indicator = '⇄';
        if (status === 'ADDED') indicator = '＋';
        else if (status === 'DROPPED') indicator = '－';
        else if (status === 'UNCHANGED') indicator = '＝';

        indexRowsHtml += `
          <tr class="structured-diff-row ${rowClass}">
            <td class="structured-diff-cell">${oldCardHtml}</td>
            <td class="structured-diff-cell divider">${indicator}</td>
            <td class="structured-diff-cell">${newCardHtml}</td>
          </tr>
        `;
      });

      indexSectionHtml = `
        <div class="diff-sub-section">
          <div class="diff-sub-section-header">
            <h5><span>⚡</span> ${t('migration.indexesSectionTitle')} (${alignedIndexes.length})</h5>
          </div>
          <table class="structured-diff-table indexes-diff-table">
            <thead>
              <tr>
                <th style="width:48%;">${t('migration.oldIndexHeader')}</th>
                <th style="width:4%; text-align:center;"></th>
                <th style="width:48%;">${t('migration.newIndexHeader')}</th>
              </tr>
            </thead>
            <tbody>
              ${indexRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    // 3. 外部キー (FK) 差分行の生成
    let fkSectionHtml = '';
    if (alignedFks.length > 0) {
      let fkRowsHtml = '';
      alignedFks.forEach(pair => {
        const { status, oldFk, newFk, name, relation } = pair;
        let rowClass = '';
        if (status === 'ADDED') rowClass = 'row-added';
        else if (status === 'DROPPED') rowClass = 'row-dropped';
        else if (status === 'MODIFIED') rowClass = 'row-modified';

        // 旧FK定義カード
        let oldCardHtml = '';
        if (oldFk) {
          const relStr = relation || `${oldFk.fromTable || ''}(${(oldFk.fromCols || []).join(', ')}) ${oldFk.op || '>'} ${oldFk.toTable || ''}(${(oldFk.toCols || []).join(', ')})`;
          oldCardHtml = `
            <div class="col-card old-col">
              <span class="col-name-badge">${escapeHtml(oldFk.name || name || 'FK')}</span>
              <span class="col-type-badge">${escapeHtml(relStr)}</span>
              ${oldFk.onDelete ? `<span class="col-attr-tag note">ON DELETE ${escapeHtml(oldFk.onDelete.toUpperCase())}</span>` : ''}
              ${oldFk.onUpdate ? `<span class="col-attr-tag note">ON UPDATE ${escapeHtml(oldFk.onUpdate.toUpperCase())}</span>` : ''}
            </div>
          `;
        } else {
          oldCardHtml = `<div class="col-card empty-placeholder">${t('migration.notDefinedInOld')}</div>`;
        }

        // 新FK定義カード
        let newCardHtml = '';
        if (newFk) {
          const relStr = relation || `${newFk.fromTable || ''}(${(newFk.fromCols || []).join(', ')}) ${newFk.op || '>'} ${newFk.toTable || ''}(${(newFk.toCols || []).join(', ')})`;
          newCardHtml = `
            <div class="col-card new-col">
              <span class="col-name-badge">${escapeHtml(newFk.name || name || 'FK')}</span>
              <span class="col-type-badge">${escapeHtml(relStr)}</span>
              ${newFk.onDelete ? `<span class="col-attr-tag note">ON DELETE ${escapeHtml(newFk.onDelete.toUpperCase())}</span>` : ''}
              ${newFk.onUpdate ? `<span class="col-attr-tag note">ON UPDATE ${escapeHtml(newFk.onUpdate.toUpperCase())}</span>` : ''}
            </div>
          `;
        } else {
          newCardHtml = `<div class="col-card empty-placeholder">${t('migration.droppedInNew')}</div>`;
        }

        let indicator = '⇄';
        if (status === 'ADDED') indicator = '＋';
        else if (status === 'DROPPED') indicator = '－';
        else if (status === 'UNCHANGED') indicator = '＝';

        fkRowsHtml += `
          <tr class="structured-diff-row ${rowClass}">
            <td class="structured-diff-cell">${oldCardHtml}</td>
            <td class="structured-diff-cell divider">${indicator}</td>
            <td class="structured-diff-cell">${newCardHtml}</td>
          </tr>
        `;
      });

      fkSectionHtml = `
        <div class="diff-sub-section">
          <div class="diff-sub-section-header">
            <h5><span>🔗</span> ${t('migration.fksSectionTitle')} (${alignedFks.length})</h5>
          </div>
          <table class="structured-diff-table fks-diff-table">
            <thead>
              <tr>
                <th style="width:48%;">${t('migration.oldFkHeader')}</th>
                <th style="width:4%; text-align:center;"></th>
                <th style="width:48%;">${t('migration.newFkHeader')}</th>
              </tr>
            </thead>
            <tbody>
              ${fkRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    // 4. テーブル物理属性・メタデータ差分行の生成
    let attrSectionHtml = '';
    if (alignedAttributes.length > 0) {
      let attrRowsHtml = '';
      alignedAttributes.forEach(pair => {
        const { status, key, oldVal, newVal } = pair;
        let rowClass = '';
        if (status === 'ADDED') rowClass = 'row-added';
        else if (status === 'DROPPED') rowClass = 'row-dropped';
        else if (status === 'MODIFIED') rowClass = 'row-modified';

        const keyLabel = key === 'note' ? t('migration.attrNote') :
                         key === 'logicalName' ? t('migration.attrLogicalName') :
                         key === 'tablespace' ? t('migration.attrTablespace') :
                         key === 'index_tablespace' ? t('migration.attrIndexTablespace') : key;

        const oldCardHtml = oldVal ? `
          <div class="col-card old-col">
            <span class="col-name-badge">${escapeHtml(keyLabel)}</span>
            <span class="col-attr-val" title="${escapeHtml(oldVal)}">${escapeHtml(oldVal)}</span>
          </div>
        ` : `<div class="col-card empty-placeholder">${t('migration.emptyNotApplicable')}</div>`;

        const newCardHtml = newVal ? `
          <div class="col-card new-col">
            <span class="col-name-badge">${escapeHtml(keyLabel)}</span>
            <span class="col-attr-val" title="${escapeHtml(newVal)}">${escapeHtml(newVal)}</span>
          </div>
        ` : `<div class="col-card empty-placeholder">${t('migration.emptyNotApplicable')}</div>`;

        let indicator = '⇄';
        if (status === 'ADDED') indicator = '＋';
        else if (status === 'DROPPED') indicator = '－';
        else if (status === 'UNCHANGED') indicator = '＝';

        attrRowsHtml += `
          <tr class="structured-diff-row ${rowClass}">
            <td class="structured-diff-cell">${oldCardHtml}</td>
            <td class="structured-diff-cell divider">${indicator}</td>
            <td class="structured-diff-cell">${newCardHtml}</td>
          </tr>
        `;
      });

      attrSectionHtml = `
        <div class="diff-sub-section">
          <div class="diff-sub-section-header">
            <h5><span>🏷️</span> ${t('migration.attributesSectionTitle')} (${alignedAttributes.length})</h5>
          </div>
          <table class="structured-diff-table attributes-diff-table">
            <thead>
              <tr>
                <th style="width:48%;">${t('migration.oldAttrHeader')}</th>
                <th style="width:4%; text-align:center;"></th>
                <th style="width:48%;">${t('migration.newAttrHeader')}</th>
              </tr>
            </thead>
            <tbody>
              ${attrRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    // 全セクションを包括してレンダリング
    detailContainer.innerHTML = `
      <div style="margin-bottom:12px; display:flex; align-items:center; justify-content:space-between;">
        <h4 style="margin:0; font-size:1rem; display:flex; align-items:center; gap:8px;">
          <span>📋</span> ${escapeHtml(tableDiff.name)}
          <span class="migration-badge-pill ${tableDiff.status.toLowerCase()}">${escapeHtml(tableDiff.summary)}</span>
        </h4>
        <span style="font-size:0.8rem; color:var(--text-secondary);">
          ${t('migration.columnsAlignmentCount', { count: alignedColumns.length })}
        </span>
      </div>

      <div class="diff-sections-container">
        <!-- 1. カラム定義対比 -->
        <div class="diff-sub-section">
          <div class="diff-sub-section-header">
            <h5><span>📋</span> ${t('migration.columnsSectionTitle')} (${alignedColumns.length})</h5>
          </div>
          <table class="structured-diff-table columns-diff-table">
            <thead>
              <tr>
                <th style="width:48%;">${t('migration.oldColHeader')}</th>
                <th style="width:4%; text-align:center;"></th>
                <th style="width:48%;">${t('migration.newColHeader')}</th>
              </tr>
            </thead>
            <tbody>
              ${columnRowsHtml}
            </tbody>
          </table>
        </div>

        <!-- 2. インデックス対比 -->
        ${indexSectionHtml}

        <!-- 3. 外部キー対比 -->
        ${fkSectionHtml}

        <!-- 4. 属性・メタデータ対比 -->
        ${attrSectionHtml}
      </div>
    `;
  }

  updateTableCheckboxes() {
    this.element.querySelectorAll('.chk-table-select').forEach(chk => {
      chk.checked = this.selectedTableNames.has(chk.dataset.name);
    });
    this.updateSelectedCountLabel();
  }

  updateSelectedCountLabel() {
    const label = this.element.querySelector('#selectedCountLabel');
    if (label) {
      label.textContent = t('migration.selectedTableCount', { count: this.selectedTableNames.size });
    }
  }

  /**
   * 日本語コメント: 検索キーワードと「差分のあるテーブルのみ表示」チェック状態を組み合わせて一覧をフィルタリング
   */
  filterTableList(query) {
    const rawQuery = query !== undefined
      ? query
      : (this.element.querySelector('#inputTableFilter')?.value || '');
    const q = rawQuery.trim().toLowerCase();
    const diffOnly = this.element.querySelector('#chkDiffOnly')?.checked ?? false;

    this.element.querySelectorAll('.step2-table-item').forEach(item => {
      const name = item.dataset.name.toLowerCase();
      const isChanged = item.dataset.status !== 'UNCHANGED';
      const matchesQuery = name.includes(q);
      const matchesDiff = !diffOnly || isChanged;
      item.style.display = (matchesQuery && matchesDiff) ? 'flex' : 'none';
    });
  }

  /**
   * 日本語コメント: 比較先（新DBMLテキスト）に対応する正規 AST モデルを解決
   * 1. appStore.state.schemas 内に entry.dbml === newDbmlText のスキーマがあれば entry.model を再利用
   * 2. なければ POST /api/parse ({ dbml: newDbmlText }) を呼び出して正規 AST を取得（失敗時は null で安全にフォールバック）
   * @param {string} newDbmlText - 新DBMLテキスト
   * @returns {Promise<Object|null>} 正規 AST モデルまたは null
   */
  async resolveNewSchemaModel(newDbmlText) {
    if (!newDbmlText || typeof newDbmlText !== 'string' || !newDbmlText.trim()) {
      return null;
    }

    const trimmedNew = newDbmlText.trim();

    // 1. appStore.state.schemas 内に entry.dbml === newDbmlText のスキーマがあれば entry.model を再利用
    const schemasMap = appStore.state.schemas;
    if (schemasMap && typeof schemasMap.values === 'function') {
      for (const entry of schemasMap.values()) {
        if (!entry) continue;
        if ((entry.dbml === newDbmlText || entry.dbml?.trim() === trimmedNew) && entry.model) {
          return entry.model;
        }
      }
    }

    // 2. なければ POST /api/parse ({ dbml: newDbmlText }) を呼び出して正規 AST を取得
    try {
      const response = await fetch('/api/parse', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dbml: newDbmlText }),
      });

      if (!response.ok) {
        console.warn(`[MigrationView] /api/parse failed: HTTP ${response.status}`);
        return null;
      }

      const parsedData = await response.json();
      return parsedData;
    } catch (err) {
      console.warn('[MigrationView] /api/parse request error:', err);
      return null;
    }
  }

  /**
   * 日本語コメント: 正規 AST モデルのメタデータを this.diffResult.tables の各 newTable へマージ・補完
   * custom, logicalName, note, tablespace, indexTablespace, indexes, checks、および各カラムの logicalName, note, custom を反映
   * @param {Object} newSchemaModel - 正規 AST モデル
   */
  mergeAstMetadataIntoDiff(newSchemaModel) {
    if (!newSchemaModel || !Array.isArray(newSchemaModel.tables) || !this.diffResult?.tables) {
      return;
    }

    // テーブル名（小文字化）で正規 AST テーブルをマップ化
    const astTableMap = new Map();
    for (const astTbl of newSchemaModel.tables) {
      if (astTbl && astTbl.name) {
        astTableMap.set(String(astTbl.name).replace(/["`]/g, '').trim().toLowerCase(), astTbl);
      }
    }

    for (const tableDiff of this.diffResult.tables) {
      if (!tableDiff.newTable) continue;
      const cleanTblName = String(tableDiff.name || tableDiff.newTable.name || '').replace(/["`]/g, '').trim().toLowerCase();
      const astTbl = astTableMap.get(cleanTblName);
      if (!astTbl) continue;

      const newTable = tableDiff.newTable;

      // 1. テーブルレベルのメタデータ補完
      // custom: 既存の newTable.custom と astTbl.custom を安全にマージ
      newTable.custom = { ...(newTable.custom || {}), ...(astTbl.custom || {}) };

      // logicalName
      if (astTbl.logicalName) {
        newTable.logicalName = astTbl.logicalName;
      }
      // note
      if (astTbl.note) {
        newTable.note = astTbl.note;
      }
      // tablespace
      const tblspace = astTbl.tablespace || astTbl.custom?.tablespace || newTable.tablespace;
      if (tblspace) {
        newTable.tablespace = tblspace;
        if (!newTable.attributes) newTable.attributes = {};
        newTable.attributes.tablespace = tblspace;
      }
      // indexTablespace
      const idxTblspace = astTbl.indexTablespace || astTbl.custom?.index_tablespace || astTbl.custom?.indexTablespace || newTable.indexTablespace;
      if (idxTblspace) {
        newTable.indexTablespace = idxTblspace;
        if (!newTable.attributes) newTable.attributes = {};
        newTable.attributes.index_tablespace = idxTblspace;
      }
      // indexes
      if (Array.isArray(astTbl.indexes) && astTbl.indexes.length > 0) {
        newTable.indexes = astTbl.indexes;
      }
      // checks
      if (Array.isArray(astTbl.checks) && astTbl.checks.length > 0) {
        newTable.checks = astTbl.checks;
      }

      // 2. 各カラムの logicalName, note, custom を補完
      const astFieldMap = new Map();
      if (Array.isArray(astTbl.fields)) {
        for (const f of astTbl.fields) {
          if (f && f.name) {
            astFieldMap.set(String(f.name).replace(/["`]/g, '').trim().toLowerCase(), f);
          }
        }
      }

      const columns = newTable.columns || newTable.fields || [];
      for (const col of columns) {
        if (!col || !col.name) continue;
        const colCleanName = String(col.name).replace(/["`]/g, '').trim().toLowerCase();
        const astField = astFieldMap.get(colCleanName);
        if (!astField) continue;

        if (astField.logicalName) {
          col.logicalName = astField.logicalName;
        }
        if (astField.note) {
          col.note = astField.note;
        }
        // 日本語コメント: 正規ASTのデフォルト値 (dbdefault) を補完し、プラグイン側で DEFAULT 句を生成できるようにする
        if (astField.dbdefault !== undefined && astField.dbdefault !== null && astField.dbdefault !== '') {
          col.dbdefault = astField.dbdefault;
        }
        col.custom = { ...(col.custom || {}), ...(astField.custom || {}) };
      }
    }
  }

  /**
   * 日本語コメント: マイグレーションSQLの生成実行 (非同期)
   * 比較先正規ASTモデルを取得してメタデータを補完し、プラグイン方言および標準ジェネレーターを呼び出します。
   */
  async executeGenerateSql() {
    if (this.selectedTableNames.size === 0) {
      alert(t('migration.alertSelectTable'));
      return;
    }

    const targetDbms = this.element.querySelector('#selectTargetDbms')?.value || 'standard';
    const includeComment = Boolean(this.element.querySelector('#chkIncludeComment')?.checked);
    const commentSource = this.element.querySelector('#selectCommentSource')?.value || 'both';
    const includeTablespace = this.element.querySelector('#chkIncludeTablespace')
      ? Boolean(this.element.querySelector('#chkIncludeTablespace').checked)
      : true;
    const includePctfreeInitrans = this.element.querySelector('#chkIncludePctfreeInitrans')
      ? Boolean(this.element.querySelector('#chkIncludePctfreeInitrans').checked)
      : true;

    // 日本語コメント: 比較先（新DBML）に対応する正規 AST モデルを取得してメタデータを補完
    const newDbmlText = this.element.querySelector('#textareaNewDbml')?.value || '';
    if (newDbmlText.trim()) {
      try {
        const newSchemaModel = await this.resolveNewSchemaModel(newDbmlText);
        if (newSchemaModel && this.diffResult) {
          this.mergeAstMetadataIntoDiff(newSchemaModel);
        }
      } catch (err) {
        console.warn('[MigrationView] Failed to resolve/merge AST metadata:', err);
      }
    }

    // 日本語コメント: エクスポート画面と統一された全オプションを構築
    const options = {
      selectedTableNames: Array.from(this.selectedTableNames),
      targetDbms,
      includeComment,
      commentSource,
      includeTablespace,
      includePctfreeInitrans,
    };

    const dialect = dialectManager.getById(targetDbms) || dialectManager.resolve(targetDbms);
    const standardSupported = ['standard', 'ansi'];

    if (dialect && typeof dialect.migrationGenerator === 'function') {
      // 1. プラグイン固有ジェネレーターの呼び出し（例: Oracle）
      this.generatedScripts = dialect.migrationGenerator(this.diffResult, Array.from(this.selectedTableNames), options);
    } else if (standardSupported.includes(targetDbms.toLowerCase())) {
      // 2. 標準マイグレーションジェネレーターの呼び出し（Standard ANSI SQL）
      this.generatedScripts = generateStandardMigrationSql(this.diffResult, Array.from(this.selectedTableNames), options);
    } else {
      // 未対応方言
      alert(t('migration.alertNoGenerator', { dialect: dialect?.displayName || targetDbms }));
      return;
    }

    this.renderGeneratedFiles();
    this.switchTab('step3');
  }

  /**
   * 生成ファイル一覧（テーブルごとのツリー階層）とプレビューの描画
   */
  renderGeneratedFiles() {
    const listEl = this.element.querySelector('#generatedFileList');
    if (!listEl) return;
    listEl.innerHTML = '';

    const entries = Object.entries(this.generatedScripts || {})
      .filter(([, fileList]) => Array.isArray(fileList) && fileList.length > 0);

    if (entries.length === 0) {
      listEl.innerHTML = `<div style="padding:14px; color:var(--text-secondary);">${t('migration.noGeneratedFiles')}</div>`;
      this.showFilePreview(null);
      return;
    }

    let firstFileObj = null;

    entries.forEach(([tblName, fileList], tblIdx) => {
      // 日本語コメント: テーブル単位のツリーグループ（初期状態は展開）
      const groupEl = document.createElement('div');
      groupEl.className = 'step3-tree-group expanded';

      const headerEl = document.createElement('div');
      headerEl.className = 'step3-tree-table-header';
      headerEl.innerHTML = `
        <span class="step3-tree-toggle">▼</span>
        <span class="step3-tree-folder-icon">📂</span>
        <span class="step3-tree-table-name" title="${escapeHtml(tblName)}">${escapeHtml(tblName)}</span>
        <span class="step3-tree-count">${fileList.length}</span>
      `;

      const childrenEl = document.createElement('div');
      childrenEl.className = 'step3-tree-children';

      // 日本語コメント: テーブルノードクリックで配下ファイル一覧を開閉
      headerEl.addEventListener('click', () => {
        const isExpanded = groupEl.classList.toggle('expanded');
        const toggleEl = headerEl.querySelector('.step3-tree-toggle');
        const iconEl = headerEl.querySelector('.step3-tree-folder-icon');
        if (toggleEl) toggleEl.textContent = isExpanded ? '▼' : '▶';
        if (iconEl) iconEl.textContent = isExpanded ? '📂' : '📁';
      });

      fileList.forEach((f, fileIdx) => {
        const fileObj = {
          key: `${tblName}_${f.filename}`,
          displayName: f.filename,
          tableName: tblName,
          content: f.content
        };
        const isFirst = tblIdx === 0 && fileIdx === 0;
        if (isFirst) firstFileObj = fileObj;

        const itemEl = document.createElement('div');
        itemEl.className = `step3-file-tab-item ${isFirst ? 'active' : ''}`;
        itemEl.innerHTML = `<span class="step3-file-icon">📄</span> <span class="step3-file-name" title="${escapeHtml(fileObj.key)}">${escapeHtml(fileObj.displayName)}</span>`;

        itemEl.addEventListener('click', () => {
          this.element.querySelectorAll('.step3-file-tab-item').forEach(el => el.classList.remove('active'));
          itemEl.classList.add('active');
          this.showFilePreview(fileObj);
        });

        childrenEl.appendChild(itemEl);
      });

      groupEl.appendChild(headerEl);
      groupEl.appendChild(childrenEl);
      listEl.appendChild(groupEl);
    });

    this.showFilePreview(firstFileObj);
  }

  showFilePreview(fileObj) {
    const titleEl = this.element.querySelector('#activeFileTitle');
    const viewerEl = this.element.querySelector('#sqlPreviewViewer');

    if (!fileObj) {
      this.activeFileKey = null;
      if (titleEl) titleEl.textContent = '-';
      if (viewerEl) viewerEl.textContent = '';
      return;
    }

    this.activeFileKey = fileObj.key;
    if (titleEl) titleEl.textContent = fileObj.key;
    if (viewerEl) viewerEl.textContent = fileObj.content;
  }

  downloadBlob(blob, filename) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
}
