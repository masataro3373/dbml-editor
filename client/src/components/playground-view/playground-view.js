// 日本語コメント: DBML AST プレイグラウンドビュー (src/components/playground-view/playground-view.js)
// DBML テキストを入力・編集し、リアルタイムに AST (抽象構文木) モデルへのパース結果を
// 再帰的階層ツリーおよび整形 Raw JSON で可視化・検証できる全画面プレイグラウンドコンポーネントです。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { generateDbml } from '../../core/dbml-generator.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { bindSearchClear } from '../../core/search-clear.js';
import './playground-view.css';

// ============================================================
// サンプル DBML プリセット定義
// 各種リレーション、インデックス、ノート、テーブルグループ、Projectブロックを網羅
// ============================================================
function getSamplePreset(key) {
  const presets = {
    ecommerce: `Project "E-Commerce Platform" {
  database_type: 'PostgreSQL'
  Note: '''
    ${t('playground.sampleNoteEcommerce')}
  '''
}

Table users {
  id integer [pk, increment]
  email varchar(255) [not null, unique, note: '${t('playground.sampleEmailNote')}']
  full_name varchar(100) [not null]
  role varchar(20) [default: 'customer']
  created_at timestamp [default: \`now()\`]

  indexes {
    email [unique]
    created_at
  }
}

Table products {
  id integer [pk, increment]
  name varchar(200) [not null]
  price decimal(10,2) [not null]
  stock integer [default: 0]
  category_id integer [not null]
  status varchar(20) [default: 'draft']
  created_at timestamp [default: \`now()\`]
}

Table categories {
  id integer [pk, increment]
  name varchar(100) [not null]
  parent_id integer [null]
}

Table orders {
  id integer [pk, increment]
  user_id integer [not null]
  status varchar(30) [default: 'pending']
  total_amount decimal(12,2) [not null]
  created_at timestamp [default: \`now()\`]
}

Table order_items {
  id integer [pk, increment]
  order_id integer [not null]
  product_id integer [not null]
  quantity integer [not null, default: 1]
  unit_price decimal(10,2) [not null]

  indexes {
    (order_id, product_id) [unique]
  }
}

Ref: orders.user_id > users.id [delete: cascade]
Ref: order_items.order_id > orders.id [delete: cascade]
Ref: order_items.product_id > products.id
Ref: categories.parent_id > categories.id

TableGroup order_fulfillment {
  orders
  order_items
}

TableGroup catalog {
  products
  categories
}`,

    rbac: `Project "RBAC Enterprise Security" {
  database_type: 'Oracle'
  Note: '${t('playground.sampleNoteRbac')}'
}

Table accounts {
  account_id varchar(36) [pk, note: 'UUID v4']
  username varchar(50) [not null, unique]
  password_hash varchar(255) [not null]
  is_active boolean [default: true]
  last_login_at timestamp
  created_at timestamp [default: \`CURRENT_TIMESTAMP\`]
}

Table roles {
  role_id integer [pk, increment]
  role_code varchar(50) [not null, unique]
  role_name varchar(100) [not null]
  description text
}

Table account_roles {
  account_id varchar(36) [not null]
  role_id integer [not null]
  assigned_at timestamp [default: \`CURRENT_TIMESTAMP\`]

  indexes {
    (account_id, role_id) [pk]
  }
}

Table permissions {
  permission_id integer [pk, increment]
  resource varchar(50) [not null]
  action varchar(30) [not null]
  description text

  indexes {
    (resource, action) [unique]
  }
}

Table role_permissions {
  role_id integer [not null]
  permission_id integer [not null]

  indexes {
    (role_id, permission_id) [pk]
  }
}

Ref: account_roles.account_id > accounts.account_id [delete: cascade]
Ref: account_roles.role_id > roles.role_id [delete: cascade]
Ref: role_permissions.role_id > roles.role_id [delete: cascade]
Ref: role_permissions.permission_id > permissions.permission_id [delete: cascade]

TableGroup security_core {
  accounts
  roles
  permissions
}`,

    finance: `Project "Payment Gateway & Billing" {
  database_type: 'MySQL'
  Note: '${t('playground.sampleNoteFinance')}'
}

Table customers {
  customer_id integer [pk, increment]
  company_name varchar(150) [not null]
  billing_email varchar(255) [not null]
  currency varchar(3) [default: 'USD']
}

Table invoices {
  invoice_id integer [pk, increment]
  customer_id integer [not null]
  invoice_number varchar(50) [not null, unique]
  issue_date date [not null]
  due_date date [not null]
  amount decimal(12,2) [not null]
  status varchar(20) [default: 'issued']
}

Table transactions {
  transaction_id varchar(64) [pk]
  invoice_id integer [not null]
  payment_method varchar(30) [not null]
  amount decimal(12,2) [not null]
  fee decimal(8,2) [default: 0]
  processed_at timestamp [default: \`now()\`]
  status varchar(20) [default: 'success']
}

Table payment_methods {
  method_id integer [pk, increment]
  customer_id integer [not null]
  provider varchar(50) [not null]
  token varchar(255) [not null]
  is_default boolean [default: false]
}

Ref: invoices.customer_id > customers.customer_id
Ref: transactions.invoice_id > invoices.invoice_id
Ref: payment_methods.customer_id > customers.customer_id

TableGroup billing_flow {
  invoices
  transactions
}

Note general_guideline {
  '${t('playground.sampleGuideline')}'
}`
  };
  return presets[key] || '';
}

export class DbePlaygroundView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.editorView = null;
    this.editorWrapper = null;

    // 内部ステート
    this.currentAst = null;
    this.activeTab = 'tree'; // 'tree' | 'json'
    this.autoParseEnabled = true;
    this.debounceTimer = null;
    this.openTimer = null;
    this.parseAbortController = null;
    this.isParsing = false;
    this.filterKeyword = '';
    this.nodeExpandState = new Map(); // path -> boolean

    this.render();
    this.initCodeMirror();
    this.bindEvents();
    this.bindStore();
  }

  /**
   * メイン DOM 構造の生成
   */
  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-playground-view';

    this.element.innerHTML = `
      <!-- 1. トップバー -->
      <div class="pg-header-bar">
        <div class="pg-header-left">
          <h2 class="pg-header-title">
            <span class="pg-title-icon">🧪</span>
            <span id="pgTitleText">${t('playground.title')}</span>
          </h2>

          <div class="pg-header-controls">
            <!-- サンプル DBML プリセット選択 -->
            <select class="pg-select" id="selectPgSample">
              <option value="">${t('playground.samplePrompt')}</option>
              <option value="ecommerce">${t('playground.sampleEcommerce')}</option>
              <option value="rbac">${t('playground.sampleRbac')}</option>
              <option value="finance">${t('playground.sampleGroups')}</option>
            </select>

            <!-- 現在のスキーマから読込 -->
            <button class="pg-btn pg-btn-secondary" id="btnLoadCurrentSchema" title="${t('playground.btnLoadCurrent')}">
              <span>📥</span> <span id="textBtnLoadCurrent">${t('playground.btnLoadCurrent')}</span>
            </button>

            <!-- 自動パース切り替え -->
            <label class="pg-checkbox-label" title="${t('playground.autoParse')}">
              <input type="checkbox" id="chkAutoParse" checked />
              <span id="textChkAutoParse">${t('playground.autoParse')}</span>
            </label>

            <!-- パース実行ボタン -->
            <button class="pg-btn pg-btn-primary" id="btnRunParse" title="${t('playground.btnParseTooltip')}">
              <span id="btnRunParseIcon">▶</span>
              <span id="textBtnParse">${t('playground.btnParse')}</span>
            </button>
          </div>
        </div>

        <!-- エディタへ戻るボタン -->
        <button class="pg-btn pg-btn-back" id="btnBackToEditor">
          <span id="textBtnBack">${t('playground.backToEditor')}</span>
        </button>
      </div>

      <!-- 2. メイン作業スプリット領域 -->
      <div class="pg-main-workspace">
        
        <!-- 左ペイン: DBML 入力エディタ -->
        <div class="pg-left-pane">
          <div class="pg-editor-header">
            <div class="pg-editor-header-left">
              <span id="pgEditorHeaderTitle">${t('playground.editorHeader')}</span>
              <span class="pg-editor-shortcut-hint" id="pgEditorShortcutHint">${t('playground.editorShortcutHint')}</span>
            </div>
            <div class="pg-editor-header-actions">
              <button class="pg-btn-small" id="btnCopyDbml">📋 ${t('playground.btnCopy')}</button>
              <button class="pg-btn-small" id="btnClearDbml">🗑️ ${t('playground.btnClear')}</button>
            </div>
          </div>
          <div class="pg-cm-wrapper" id="pgEditorWrapper"></div>
        </div>

        <!-- 右ペイン: AST プレビュー -->
        <div class="pg-right-pane">
          
          <!-- サマリーバー -->
          <div class="pg-summary-bar">
            <div class="pg-summary-badges" id="pgSummaryBadges">
              <span class="pg-badge-pill tables" id="badgeTables">📋 ${t('playground.summaryTables')}: 0</span>
              <span class="pg-badge-pill refs" id="badgeRefs">🔗 ${t('playground.summaryRefs')}: 0</span>
              <span class="pg-badge-pill groups" id="badgeGroups">📦 ${t('playground.summaryGroups')}: 0</span>
              <span class="pg-badge-pill notes" id="badgeNotes">📝 ${t('playground.summaryNotes')}: 0</span>
            </div>
            <div class="pg-parse-time" id="pgParseTime"></div>
          </div>

          <!-- エラーバナー -->
          <div class="pg-error-banner" id="pgErrorBanner">
            <div class="pg-error-header">
              <span>⚠️</span>
              <span id="pgErrorTitle">${t('playground.errorTitle')}</span>
            </div>
            <div class="pg-error-detail" id="pgErrorDetail"></div>
          </div>

          <!-- ナビタブバー -->
          <div class="pg-nav-tabs-bar">
            <div class="pg-nav-tabs">
              <button class="pg-nav-tab active" data-tab="tree" id="tabBtnTree">
                ${t('playground.tabTree')}
              </button>
              <button class="pg-nav-tab" data-tab="json" id="tabBtnJson">
                ${t('playground.tabJson')}
              </button>
            </div>
          </div>

          <!-- パネルコンテンツ -->
          <div class="pg-panel-content">
            
            <!-- Tab 1: 階層ツリー -->
            <div class="pg-tab-pane active" id="paneTree">
              <div class="pg-tree-toolbar">
                <div class="pg-tree-toolbar-left">
                  <button class="pg-btn-small" id="btnExpandAll">${t('playground.btnExpandAll')}</button>
                  <button class="pg-btn-small" id="btnCollapseAll">${t('playground.btnCollapseAll')}</button>
                </div>
                <div class="pg-tree-search-wrapper dbe-search-input-wrap">
                  <span class="pg-tree-search-icon">🔍</span>
                  <input type="text" class="pg-tree-search-input" id="inputTreeFilter" placeholder="${t('playground.filterPlaceholder')}" />
                  <button type="button" id="btnTreeFilterClear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                </div>
              </div>
              <div class="pg-tree-container" id="pgTreeContainer">
                <div class="pg-empty-state">
                  <div class="pg-empty-icon">🌳</div>
                  <div class="pg-empty-title">${t('playground.emptyTitle')}</div>
                  <div class="pg-empty-desc">${t('playground.emptyDesc')}</div>
                </div>
              </div>
            </div>

            <!-- Tab 2: Raw JSON -->
            <div class="pg-tab-pane" id="paneJson">
              <div class="pg-json-container">
                <div class="pg-json-toolbar">
                  <button class="pg-btn-small" id="btnCopyJson">📋 ${t('playground.btnCopyJson')}</button>
                  <button class="pg-btn-small" id="btnDownloadJson">💾 ${t('playground.btnDownloadJson')}</button>
                </div>
                <pre class="pg-json-pre" id="pgJsonViewer"><code id="pgJsonCode"></code></pre>
              </div>
            </div>

          </div>

        </div>

      </div>
    `;

    this.editorWrapper = this.element.querySelector('#pgEditorWrapper');
    this.container.appendChild(this.element);
  }

  /**
   * CodeMirror 6 エディタ初期化
   */
  initCodeMirror() {
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        this.handleEditorChange();
      }
    });

    const startState = EditorState.create({
      doc: getSamplePreset('ecommerce'),
      extensions: [
        basicSetup,
        updateListener,
        EditorView.lineWrapping,
        EditorView.theme({
          '&': { height: '100%', fontSize: '0.86rem' },
          '.cm-scroller': { overflow: 'auto' }
        })
      ]
    });

    this.editorView = new EditorView({
      state: startState,
      parent: this.editorWrapper
    });
  }

  /**
   * 各種イベントハンドラーのバインド
   */
  bindEvents() {
    // 1. エディタへ戻る
    this.element.querySelector('#btnBackToEditor')?.addEventListener('click', () => {
      appStore.emit('view:restore');
    });

    // 2. パース実行ボタン
    this.element.querySelector('#btnRunParse')?.addEventListener('click', () => {
      this.executeParse();
    });

    // 3. Ctrl+Enter (Cmd+Enter) ショートカット
    this.element.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.executeParse();
      }
    });

    // 4. サンプルプリセット選択
    this.element.querySelector('#selectPgSample')?.addEventListener('change', (e) => {
      const key = e.target.value;
      const preset = key ? getSamplePreset(key) : '';
      if (preset) {
        this.setEditorDbml(preset);
        this.executeParse();
      }
    });

    // 5. 現在のスキーマから読込
    this.element.querySelector('#btnLoadCurrentSchema')?.addEventListener('click', () => {
      this.loadCurrentSchema();
    });

    // 6. 自動パースチェックボックス
    const chkAuto = this.element.querySelector('#chkAutoParse');
    chkAuto?.addEventListener('change', (e) => {
      this.autoParseEnabled = e.target.checked;
    });

    // 7. DBML コピー & クリア
    this.element.querySelector('#btnCopyDbml')?.addEventListener('click', async (e) => {
      await this.copyDbml(e.currentTarget);
    });

    this.element.querySelector('#btnClearDbml')?.addEventListener('click', () => {
      this.clearDbml();
    });

    // 8. 右ペイン タブ切り替え
    const tabs = this.element.querySelectorAll('.pg-nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.getAttribute('data-tab');

        const paneTree = this.element.querySelector('#paneTree');
        const paneJson = this.element.querySelector('#paneJson');
        if (this.activeTab === 'tree') {
          paneTree?.classList.add('active');
          paneJson?.classList.remove('active');
        } else {
          paneTree?.classList.remove('active');
          paneJson?.classList.add('active');
          this.renderJsonViewer();
        }
      });
    });

    // 9. ツリー展開 / 折り畳み
    this.element.querySelector('#btnExpandAll')?.addEventListener('click', () => {
      this.expandAllTreeNodes();
    });

    this.element.querySelector('#btnCollapseAll')?.addEventListener('click', () => {
      this.collapseAllTreeNodes();
    });

    // 10. ツリー検索フィルタ
    const searchInput = this.element.querySelector('#inputTreeFilter');
    searchInput?.addEventListener('input', (e) => {
      this.filterKeyword = e.target.value.trim().toLowerCase();
      this.applyTreeFilter();
    });
    bindSearchClear(searchInput, this.element.querySelector('#btnTreeFilterClear'));

    // 11. JSON コピー & ダウンロード
    this.element.querySelector('#btnCopyJson')?.addEventListener('click', async (e) => {
      await this.copyJson(e.currentTarget);
    });

    this.element.querySelector('#btnDownloadJson')?.addEventListener('click', () => {
      this.downloadJson();
    });
  }

  /**
   * アプリストアイベントの購読
   */
  bindStore() {
    // 多言語切り替え時の反映
    appStore.on('i18n:changed', () => {
      this.updateI18nTexts();
    });
  }

  /**
   * エディタ入力変更時のデバウンスパース
   */
  handleEditorChange() {
    if (!this.autoParseEnabled) return;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.executeParse();
    }, 400);
  }

  /**
   * エディタのDBMLテキスト取得
   */
  getEditorDbml() {
    return this.editorView ? this.editorView.state.doc.toString() : '';
  }

  /**
   * エディタのDBMLテキスト設定
   */
  setEditorDbml(text) {
    if (!this.editorView) return;
    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: text,
      }
    });
  }

  /**
   * ビューオープン時のライフサイクル
   */
  open() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
    }
    this.openTimer = setTimeout(() => {
      this.openTimer = null;
      if (this.editorView) {
        this.editorView.requestMeasure();
      }

      // エディタが空の場合、現在のアクティブスキーマがあれば読込、無ければサンプル
      const currentDoc = this.getEditorDbml();
      if (!currentDoc.trim()) {
        const schemaDbml = this.getCurrentSchemaDbml();
        if (schemaDbml.trim()) {
          this.setEditorDbml(schemaDbml);
        } else {
          this.setEditorDbml(getSamplePreset('ecommerce'));
        }
      }

      this.executeParse();
    }, 50);
  }

  /**
   * ビュークローズ時のクリーンアップ（離脱後のメモリ・DOM負荷を解放）
   */
  close() {
    if (this.openTimer) {
      clearTimeout(this.openTimer);
      this.openTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.parseAbortController) {
      this.parseAbortController.abort();
      this.parseAbortController = null;
    }
    this.isParsing = false;
    this.updateParseButtonState(false);
    this.currentAst = null;

    const treeContainer = this.element.querySelector('#pgTreeContainer');
    if (treeContainer) {
      treeContainer.innerHTML = '';
    }
    const jsonCode = this.element.querySelector('#pgJsonCode');
    if (jsonCode) {
      jsonCode.innerHTML = '';
    }
  }

  /**
   * 現在のアクティブスキーマから DBML テキストを抽出
   */
  getCurrentSchemaDbml() {
    const activeSchemaName = appStore.state.activeSchema;
    const schemasMap = appStore.state.schemas;

    if (activeSchemaName && schemasMap instanceof Map && schemasMap.has(activeSchemaName)) {
      const entry = schemasMap.get(activeSchemaName);
      if (entry.dbml && entry.dbml.trim()) {
        return entry.dbml;
      }
      if (entry.model) {
        try {
          return generateDbml({
            project: entry.model.project || appStore.state.project || {},
            tables: entry.model.tables || [],
            refs: entry.model.refs || [],
            tableGroups: entry.model.tableGroups || [],
            notes: entry.model.notes || [],
          });
        } catch (_) {}
      }
    }

    // 全体テーブルからのフォールバック
    if (Array.isArray(appStore.state.tables) && appStore.state.tables.length > 0) {
      try {
        return generateDbml({
          project: appStore.state.project || {},
          tables: appStore.state.tables,
          refs: appStore.state.refs || [],
          tableGroups: appStore.state.tableGroups || [],
          notes: appStore.state.notes || [],
        });
      } catch (_) {}
    }

    return '';
  }

  /**
   * 現在のスキーマを左エディタへロード
   */
  loadCurrentSchema() {
    const text = this.getCurrentSchemaDbml();
    if (text && text.trim()) {
      this.setEditorDbml(text);
      this.executeParse();
    } else {
      alert(t('playground.emptySchemaAlert'));
    }
  }

  /**
   * AST 変換パース API 呼び出し
   */
  async executeParse() {
    const dbmlText = this.getEditorDbml();

    if (!dbmlText.trim()) {
      this.currentAst = null;
      this.renderSummary();
      this.renderTree();
      this.renderJsonViewer();
      this.hideError();
      return;
    }

    if (this.parseAbortController) {
      this.parseAbortController.abort();
    }
    const controller = new AbortController();
    this.parseAbortController = controller;

    this.isParsing = true;
    this.updateParseButtonState(true);

    try {
      const startTime = performance.now();
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbml: dbmlText }),
        signal: controller.signal,
      });

      const clientTimeMs = Math.round(performance.now() - startTime);
      const data = await res.json();

      if (!res.ok) {
        // パースエラー
        this.currentAst = null;
        this.showError(data.error || t('playground.errorDefault'), data.diags);
        this.renderSummary(null);
      } else {
        // パース成功
        this.hideError();
        this.currentAst = data;
        const parseTime = data.parseTimeMs !== undefined ? data.parseTimeMs : clientTimeMs;
        this.renderSummary(data, parseTime);
        this.renderTree();
        if (this.activeTab === 'json') {
          this.renderJsonViewer();
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;
      this.currentAst = null;
      this.showError(err.message || String(err));
      this.renderSummary(null);
    } finally {
      if (this.parseAbortController === controller) {
        this.parseAbortController = null;
      }
      this.isParsing = false;
      this.updateParseButtonState(false);
    }
  }

  /**
   * パース実行ボタンのスピナー/状態制御
   */
  updateParseButtonState(isLoading) {
    const btn = this.element.querySelector('#btnRunParse');
    const icon = this.element.querySelector('#btnRunParseIcon');
    if (!btn || !icon) return;

    if (isLoading) {
      icon.innerHTML = `<span class="pg-loading-spinner"></span>`;
      btn.disabled = true;
    } else {
      icon.textContent = '▶';
      btn.disabled = false;
    }
  }

  /**
   * サマリーバーのバッジ更新
   */
  renderSummary(data = null, timeMs = null) {
    const badgeTables = this.element.querySelector('#badgeTables');
    const badgeRefs = this.element.querySelector('#badgeRefs');
    const badgeGroups = this.element.querySelector('#badgeGroups');
    const badgeNotes = this.element.querySelector('#badgeNotes');
    const parseTimeEl = this.element.querySelector('#pgParseTime');

    if (!data) {
      if (badgeTables) badgeTables.textContent = `📋 ${t('playground.summaryTables')}: 0`;
      if (badgeRefs) badgeRefs.textContent = `🔗 ${t('playground.summaryRefs')}: 0`;
      if (badgeGroups) badgeGroups.textContent = `📦 ${t('playground.summaryGroups')}: 0`;
      if (badgeNotes) badgeNotes.textContent = `📝 ${t('playground.summaryNotes')}: 0`;
      if (parseTimeEl) parseTimeEl.textContent = '';
      return;
    }

    const tableCount = Array.isArray(data.tables) ? data.tables.length : 0;
    const refCount = Array.isArray(data.refs) ? data.refs.length : 0;
    const groupCount = Array.isArray(data.tableGroups) ? data.tableGroups.length : 0;
    const noteCount = Array.isArray(data.notes) ? data.notes.length : 0;

    if (badgeTables) badgeTables.textContent = `📋 ${t('playground.summaryTables')}: ${tableCount}`;
    if (badgeRefs) badgeRefs.textContent = `🔗 ${t('playground.summaryRefs')}: ${refCount}`;
    if (badgeGroups) badgeGroups.textContent = `📦 ${t('playground.summaryGroups')}: ${groupCount}`;
    if (badgeNotes) badgeNotes.textContent = `📝 ${t('playground.summaryNotes')}: ${noteCount}`;

    if (parseTimeEl && timeMs !== null) {
      parseTimeEl.textContent = `⏱️ ${timeMs} ms`;
    }
  }

  /**
   * エラーバナー表示
   */
  showError(message, diags = null) {
    const banner = this.element.querySelector('#pgErrorBanner');
    const detail = this.element.querySelector('#pgErrorDetail');
    if (!banner || !detail) return;

    let text = message;
    if (Array.isArray(diags) && diags.length > 0) {
      text += '\n' + diags.map(d => `Line ${d.location?.start?.line || '?'}: ${d.message}`).join('\n');
    }

    detail.textContent = text;
    banner.classList.add('active');
  }

  /**
   * エラーバナー非表示
   */
  hideError() {
    const banner = this.element.querySelector('#pgErrorBanner');
    if (banner) {
      banner.classList.remove('active');
    }
  }

  // ============================================================
  // Tab 1: 🌳 階層ツリー (Tree View) 描画
  // ============================================================

  /**
   * AST 階層ツリーの全体レンダリング
   */
  renderTree() {
    const container = this.element.querySelector('#pgTreeContainer');
    if (!container) return;

    if (!this.currentAst) {
      container.innerHTML = `
        <div class="pg-empty-state">
          <div class="pg-empty-icon">🌳</div>
          <div class="pg-empty-title">${t('playground.emptyTitle')}</div>
          <div class="pg-empty-desc">${t('playground.emptyDesc')}</div>
        </div>
      `;
      return;
    }

    container.innerHTML = '';
    const rootEl = document.createElement('div');
    rootEl.className = 'pg-tree-root';

    // ルート AST オブジェクトを走査
    for (const [key, val] of Object.entries(this.currentAst)) {
      if (key === 'parseTimeMs') continue; // 所要時間はサマリーバーで表示
      const nodeEl = this.createTreeNode(key, val, key, 0);
      rootEl.appendChild(nodeEl);
    }

    container.appendChild(rootEl);

    // 検索フィルタが入力中であれば適用
    if (this.filterKeyword) {
      this.applyTreeFilter();
    }
  }

  /**
   * 単一ツリーノードの再帰的 DOM 生成
   * @param {string} key - プロパティキーまたはインデックス
   * @param {*} value - ノードの値
   * @param {string} path - ノードのパス (例: tables.0.fields.1)
   * @param {number} depth - 階層深さ
   */
  createTreeNode(key, value, path, depth) {
    const node = document.createElement('div');
    node.className = 'pg-tree-node';
    node.setAttribute('data-path', path);
    node.setAttribute('data-key', String(key));

    const isArray = Array.isArray(value);
    const isObject = value !== null && typeof value === 'object' && !isArray;
    const isContainer = isArray || isObject;

    // 開閉状態: 明示的な状態があればそれを優先、無ければ深さ < 2 はデフォルト展開
    let isExpanded = depth < 2;
    if (this.nodeExpandState.has(path)) {
      isExpanded = this.nodeExpandState.get(path);
    } else {
      this.nodeExpandState.set(path, isExpanded);
    }

    if (isContainer && isExpanded) {
      node.classList.add('expanded');
    }

    // 行要素 (Row)
    const row = document.createElement('div');
    row.className = 'pg-tree-row';

    // トグルアイコン
    const toggle = document.createElement('span');
    toggle.className = `pg-tree-toggle ${isContainer ? '' : 'empty'}`;
    toggle.textContent = '▶';
    row.appendChild(toggle);

    // キー名
    const keyEl = document.createElement('span');
    keyEl.className = 'pg-tree-key';
    keyEl.textContent = key;
    row.appendChild(keyEl);

    const colon = document.createElement('span');
    colon.className = 'pg-tree-colon';
    colon.textContent = ':';
    row.appendChild(colon);

    // AST 特化タグ＆サマリー生成
    this.appendAstSpecificTags(row, key, value, path);

    // 型バッジ＆値プレビュー
    if (isContainer) {
      const typeBadge = document.createElement('span');
      typeBadge.className = `pg-type-badge ${isArray ? 'array' : 'object'}`;
      typeBadge.textContent = isArray ? `array [${value.length}]` : `object {${Object.keys(value).length}}`;
      row.appendChild(typeBadge);
    } else {
      // プリミティブ型
      const { type, text, cls } = this.formatPrimitive(value);
      const typeBadge = document.createElement('span');
      typeBadge.className = `pg-type-badge ${type}`;
      typeBadge.textContent = type;
      row.appendChild(typeBadge);

      const valEl = document.createElement('span');
      valEl.className = `pg-tree-val ${cls}`;
      valEl.textContent = text;
      row.appendChild(valEl);
    }

    node.appendChild(row);

    // 子ノードコンテナ（展開時のみ遅延レンダリングして初期DOM数を抑制）
    if (isContainer) {
      const childrenContainer = document.createElement('div');
      childrenContainer.className = 'pg-tree-children';

      const buildChildren = () => {
        if (node._childrenBuilt) return;
        node._childrenBuilt = true;
        const entries = isArray
          ? value.map((v, i) => [String(i), v])
          : Object.entries(value);
        const frag = document.createDocumentFragment();
        for (const [subKey, subVal] of entries) {
          const subPath = `${path}.${subKey}`;
          frag.appendChild(this.createTreeNode(subKey, subVal, subPath, depth + 1));
        }
        childrenContainer.appendChild(frag);
      };

      node._ensureChildren = buildChildren;

      if (isExpanded) {
        buildChildren();
      }

      // クリックによる開閉トグル
      row.addEventListener('click', (e) => {
        // テキスト選択などの誤動作を抑止
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'MARK') return;
        const nowExpanded = node.classList.toggle('expanded');
        this.nodeExpandState.set(path, nowExpanded);
        if (nowExpanded) {
          buildChildren();
        }
      });

      node.appendChild(childrenContainer);
    }

    return node;
  }

  /**
   * AST の特定ノードに応じた分かりやすいタグ・サマリーの付加
   */
  appendAstSpecificTags(row, key, value, path) {
    if (!value || typeof value !== 'object') return;

    // 1. テーブルノード (tables.*)
    if (path.startsWith('tables.') && path.split('.').length === 2 && value.name) {
      const tag = document.createElement('span');
      tag.className = 'pg-ast-tag table';
      tag.textContent = `Table: ${value.name}`;
      row.appendChild(tag);

      if (Array.isArray(value.fields)) {
        const fieldCount = document.createElement('span');
        fieldCount.className = 'pg-tree-summary';
        fieldCount.textContent = `(${value.fields.length} columns)`;
        row.appendChild(fieldCount);
      }
    }

    // 2. カラム・フィールドノード (tables.*.fields.*)
    else if (path.includes('.fields.') && path.split('.').length === 4 && value.name) {
      const colName = document.createElement('span');
      colName.className = 'pg-ast-tag';
      colName.textContent = value.name;
      row.appendChild(colName);

      // データ型
      const typeName = value.type?.type_name || value.type || '';
      if (typeName) {
        const typeTag = document.createElement('span');
        typeTag.className = 'pg-tree-summary';
        typeTag.textContent = `[${typeName}]`;
        row.appendChild(typeTag);
      }

      // PK バッジ
      if (value.pk) {
        const pkTag = document.createElement('span');
        pkTag.className = 'pg-ast-tag pk';
        pkTag.textContent = 'PK';
        row.appendChild(pkTag);
      }
      // Not Null バッジ
      if (value.not_null) {
        const nnTag = document.createElement('span');
        nnTag.className = 'pg-ast-tag notnull';
        nnTag.textContent = 'NN';
        row.appendChild(nnTag);
      }
      // Unique バッジ
      if (value.unique) {
        const uqTag = document.createElement('span');
        uqTag.className = 'pg-ast-tag unique';
        uqTag.textContent = 'UQ';
        row.appendChild(uqTag);
      }
    }

    // 3. リレーションノード (refs.*)
    else if (path.startsWith('refs.') && path.split('.').length === 2 && Array.isArray(value.endpoints)) {
      const ep1 = value.endpoints[0];
      const ep2 = value.endpoints[1];
      if (ep1 && ep2) {
        const refTag = document.createElement('span');
        refTag.className = 'pg-ast-tag ref';
        const t1 = `${ep1.tableName}.${(ep1.fieldNames || []).join(',')}`;
        const rel = ep1.relation || '>';
        const t2 = `${ep2.tableName}.${(ep2.fieldNames || []).join(',')}`;
        refTag.textContent = `${t1} ${rel} ${t2}`;
        row.appendChild(refTag);
      }
    }

    // 4. テーブルグループノード (tableGroups.*)
    else if (path.startsWith('tableGroups.') && path.split('.').length === 2 && value.name) {
      const groupTag = document.createElement('span');
      groupTag.className = 'pg-ast-tag';
      groupTag.textContent = `Group: ${value.name}`;
      row.appendChild(groupTag);
    }
  }

  /**
   * プリミティブ値のフォーマット情報取得
   */
  formatPrimitive(value) {
    if (value === null) {
      return { type: 'null', text: 'null', cls: 'pg-val-null' };
    }
    if (typeof value === 'boolean') {
      return { type: 'boolean', text: String(value), cls: 'pg-val-boolean' };
    }
    if (typeof value === 'number') {
      return { type: 'number', text: String(value), cls: 'pg-val-number' };
    }
    if (typeof value === 'string') {
      return { type: 'string', text: JSON.stringify(value), cls: 'pg-val-string' };
    }
    return { type: typeof value, text: String(value), cls: 'pg-val-unknown' };
  }

  /**
   * 遅延レンダリングされた全ノードの子要素を必要に応じて構築する
   */
  ensureAllTreeNodesBuilt() {
    let builtAny = true;
    while (builtAny) {
      builtAny = false;
      const nodes = this.element.querySelectorAll('.pg-tree-node');
      nodes.forEach(node => {
        if (typeof node._ensureChildren === 'function' && !node._childrenBuilt) {
          node._ensureChildren();
          builtAny = true;
        }
      });
    }
  }

  /**
   * 全ノードを展開
   */
  expandAllTreeNodes() {
    this.ensureAllTreeNodesBuilt();
    const nodes = this.element.querySelectorAll('.pg-tree-node');
    nodes.forEach(node => {
      if (node.querySelector('.pg-tree-children')) {
        node.classList.add('expanded');
        const path = node.getAttribute('data-path');
        if (path) this.nodeExpandState.set(path, true);
      }
    });
  }

  /**
   * 全ノードを折り畳み (ルート直下のみ残す)
   */
  collapseAllTreeNodes() {
    const nodes = this.element.querySelectorAll('.pg-tree-node');
    nodes.forEach(node => {
      node.classList.remove('expanded');
      const path = node.getAttribute('data-path');
      if (path) this.nodeExpandState.set(path, false);
    });
  }

  /**
   * ツリーノードのキーワード検索フィルタとハイライト
   */
  applyTreeFilter() {
    const keyword = this.filterKeyword;
    if (keyword) {
      this.ensureAllTreeNodesBuilt();
    }
    const allNodes = this.element.querySelectorAll('.pg-tree-node');

    if (!keyword) {
      // フィルタ解除
      allNodes.forEach(node => {
        node.classList.remove('search-hidden', 'search-match');
        this.clearHighlight(node);
      });
      return;
    }

    const matchedNodes = new Set();

    allNodes.forEach(node => {
      this.clearHighlight(node);
      const row = node.querySelector(':scope > .pg-tree-row');
      if (!row) return;

      const text = row.textContent.toLowerCase();
      if (text.includes(keyword)) {
        matchedNodes.add(node);
        node.classList.add('search-match');
        this.highlightMatches(row, keyword);

        // 先祖ノードをすべて展開かつ表示対象に設定
        let parent = node.parentElement?.closest('.pg-tree-node');
        while (parent) {
          matchedNodes.add(parent);
          parent.classList.add('expanded');
          parent = parent.parentElement?.closest('.pg-tree-node');
        }
      } else {
        node.classList.remove('search-match');
      }
    });

    // マッチしないノードを非表示化
    allNodes.forEach(node => {
      if (matchedNodes.has(node)) {
        node.classList.remove('search-hidden');
      } else {
        node.classList.add('search-hidden');
      }
    });
  }

  /**
   * DOM 内のキーワードを <mark> タグでハイライト
   */
  highlightMatches(element, keyword) {
    const textNodes = [];
    const walk = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walk.nextNode())) {
      if (n.nodeValue.toLowerCase().includes(keyword)) {
        textNodes.push(n);
      }
    }

    textNodes.forEach(textNode => {
      const val = textNode.nodeValue;
      const lowerVal = val.toLowerCase();
      const idx = lowerVal.indexOf(keyword);
      if (idx === -1) return;

      const before = val.substring(0, idx);
      const match = val.substring(idx, idx + keyword.length);
      const after = val.substring(idx + keyword.length);

      const span = document.createElement('span');
      if (before) span.appendChild(document.createTextNode(before));

      const mark = document.createElement('mark');
      mark.className = 'pg-search-highlight';
      mark.textContent = match;
      span.appendChild(mark);

      if (after) span.appendChild(document.createTextNode(after));

      textNode.parentNode?.replaceChild(span, textNode);
    });
  }

  /**
   * ハイライトを解除してプレーンテキストに戻す
   */
  clearHighlight(node) {
    const marks = node.querySelectorAll('mark.pg-search-highlight');
    marks.forEach(mark => {
      const parent = mark.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(mark.textContent || ''), mark);
        parent.normalize();
      }
    });
  }

  // ============================================================
  // Tab 2: { } Raw AST JSON 描画
  // ============================================================

  /**
   * Raw JSON ビューワーのレンダリング
   */
  renderJsonViewer() {
    const codeEl = this.element.querySelector('#pgJsonCode');
    if (!codeEl) return;

    if (!this.currentAst) {
      codeEl.innerHTML = '';
      return;
    }

    const jsonStr = JSON.stringify(this.currentAst, null, 2);
    codeEl.innerHTML = this.syntaxHighlightJson(jsonStr);
  }

  /**
   * JSON シンタックスハイライター (HTML spanタグ化)
   */
  syntaxHighlightJson(json) {
    if (!json) return '';
    const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'tok-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'tok-key';
          } else {
            cls = 'tok-string';
          }
        } else if (/true|false/.test(match)) {
          cls = 'tok-boolean';
        } else if (/null/.test(match)) {
          cls = 'tok-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  /**
   * JSON クリップボードコピー
   */
  async copyJson(btn) {
    if (!this.currentAst) return;
    const jsonStr = JSON.stringify(this.currentAst, null, 2);
    await navigator.clipboard.writeText(jsonStr);

    const origText = btn.textContent;
    btn.textContent = '✓ ' + t('common.copied');
    setTimeout(() => {
      btn.textContent = origText;
    }, 1800);
  }

  /**
   * JSON ファイルダウンロード (.ast.json)
   */
  downloadJson() {
    if (!this.currentAst) return;
    const jsonStr = JSON.stringify(this.currentAst, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dbml_ast.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * DBML クリップボードコピー
   */
  async copyDbml(btn) {
    const text = this.getEditorDbml();
    if (!text) return;
    await navigator.clipboard.writeText(text);

    const origText = btn.textContent;
    btn.textContent = '✓ ' + t('common.copied');
    setTimeout(() => {
      btn.textContent = origText;
    }, 1800);
  }

  /**
   * DBML エディタクリア
   */
  clearDbml() {
    if (confirm(t('playground.confirmClear'))) {
      this.setEditorDbml('');
      this.executeParse();
    }
  }

  /**
   * 多言語テキストの動的再反映
   */
  updateI18nTexts() {
    const el = (id) => this.element.querySelector(id);

    if (el('#pgTitleText')) el('#pgTitleText').textContent = t('playground.title');
    if (el('#textBtnLoadCurrent')) el('#textBtnLoadCurrent').textContent = t('playground.btnLoadCurrent');
    if (el('#textChkAutoParse')) el('#textChkAutoParse').textContent = t('playground.autoParse');
    if (el('#textBtnParse')) el('#textBtnParse').textContent = t('playground.btnParse');
    if (el('#textBtnBack')) el('#textBtnBack').textContent = t('playground.backToEditor');
    if (el('#pgEditorHeaderTitle')) el('#pgEditorHeaderTitle').textContent = t('playground.editorHeader');
    if (el('#pgEditorShortcutHint')) el('#pgEditorShortcutHint').textContent = t('playground.editorShortcutHint');
    if (el('#btnCopyDbml')) el('#btnCopyDbml').textContent = `📋 ${t('playground.btnCopy')}`;
    if (el('#btnClearDbml')) el('#btnClearDbml').textContent = `🗑️ ${t('playground.btnClear')}`;
    if (el('#tabBtnTree')) el('#tabBtnTree').textContent = t('playground.tabTree');
    if (el('#tabBtnJson')) el('#tabBtnJson').textContent = t('playground.tabJson');
    if (el('#btnExpandAll')) el('#btnExpandAll').textContent = t('playground.btnExpandAll');
    if (el('#btnCollapseAll')) el('#btnCollapseAll').textContent = t('playground.btnCollapseAll');
    if (el('#inputTreeFilter')) el('#inputTreeFilter').placeholder = t('playground.filterPlaceholder');
    if (el('#btnCopyJson')) el('#btnCopyJson').textContent = `📋 ${t('playground.btnCopyJson')}`;
    if (el('#btnDownloadJson')) el('#btnDownloadJson').textContent = `💾 ${t('playground.btnDownloadJson')}`;

    this.renderSummary(this.currentAst);
  }
}
