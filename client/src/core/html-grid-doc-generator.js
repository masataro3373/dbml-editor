// 日本語コメント: 検索強化版（カラムグリッド型）単一オフライン完結型 HTMLデータ仕様書 生成エンジン
// (client/src/core/html-grid-doc-generator.js)
// 左ツリーのテーブル選択と中央の列別フィルタ付きカラムグリッドを連動させ、
// 大規模スキーマでも柔軟な横断検索・絞り込み・ソートができる HTML 仕様書を生成します。

import { escapeHtml, extractSchemaDocModel, safeJsonForScript, HTML_DOC_I18N, formatDocText } from './html-doc-generator.js';

/**
 * グリッド版埋め込み用に冗長な空値・重複フラグを省いて JSON を軽量化する
 * @param {Object} docModel
 * @returns {Object}
 */
function compactDocModelForGrid(docModel) {
  return {
    tables: (docModel.tables || []).map((t) => {
      const compactTable = { name: t.name };
      if (t.logicalName) compactTable.logicalName = t.logicalName;
      if (t.note) compactTable.note = t.note;
      if (t.indexes && t.indexes.length > 0) compactTable.indexes = t.indexes;
      if (t.checks && t.checks.length > 0) compactTable.checks = t.checks;
      compactTable.fields = (t.fields || []).map((f) => {
        const compactField = { name: f.name, type: f.type };
        if (f.logicalName) compactField.logicalName = f.logicalName;
        if (f.defaultValue) compactField.defaultValue = f.defaultValue;
        if (f.note) compactField.note = f.note;
        if (f.constraints && f.constraints.length > 0) compactField.constraints = f.constraints;
        if (f.fkTargetTable) compactField.fkTargetTable = f.fkTargetTable;
        if (f.fkTargetField) compactField.fkTargetField = f.fkTargetField;
        return compactField;
      });
      return compactTable;
    })
  };
}

/**
 * HTMLデータ仕様書を生成（検索強化版：カラムグリッド型）
 * @param {Object} schemaModel - { project, tables, refs }
 * @param {Object} options - { schemaName, dialectName, lang }
 * @returns {string} 完全なスタンドアロン HTML 文字列
 */
export function generateHtmlGridDoc(schemaModel = {}, options = {}) {
  const docModel = extractSchemaDocModel(schemaModel, options);
  const { projectName, databaseType, generatedDateJa, generatedDateEn, defaultLang, totalTables, totalColumns, totalRefs } = docModel;
  // 日本語コメント: 初期言語に応じた作成日時を選択してテンプレートを組み立てる
  const initDate = defaultLang === 'en' ? generatedDateEn : generatedDateJa;
  const embeddedJson = safeJsonForScript(compactDocModelForGrid(docModel));

  return `<!DOCTYPE html>
<html lang="${defaultLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(formatDocText(defaultLang, 'pageTitleGrid', { project: projectName }))}</title>
  <style>
    /* CSS 変数 (ダークテーマ標準) */
    :root {
      --bg-base: #0f141c;
      --bg-panel: #161c26;
      --bg-card: #1c2432;
      --bg-hover: #253042;
      --bg-row-alt: rgba(255, 255, 255, 0.02);
      --border-color: #2d3748;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-accent: #38bdf8;
      --primary: #3b82f6;
      --primary-soft: rgba(59, 130, 246, 0.16);
      --pk-bg: rgba(245, 158, 11, 0.15);
      --pk-text: #fbbf24;
      --pk-border: rgba(245, 158, 11, 0.4);
      --fk-bg: rgba(168, 85, 247, 0.15);
      --fk-text: #c084fc;
      --fk-border: rgba(168, 85, 247, 0.4);
      --uq-bg: rgba(16, 185, 129, 0.15);
      --uq-text: #34d399;
      --uq-border: rgba(16, 185, 129, 0.4);
      --nn-bg: rgba(239, 68, 68, 0.15);
      --nn-text: #f87171;
      --nn-border: rgba(239, 68, 68, 0.4);
      --idx-bg: rgba(59, 130, 246, 0.15);
      --idx-text: #60a5fa;
      --idx-border: rgba(59, 130, 246, 0.4);
      --font-sans: "Segoe UI", "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif;
      --font-mono: "Cascadia Code", "Consolas", "Monaco", monospace;
    }

    /* ライトテーマ変数 */
    body.light-theme {
      --bg-base: #f1f5f9;
      --bg-panel: #ffffff;
      --bg-card: #ffffff;
      --bg-hover: #eff6ff;
      --bg-row-alt: #f8fafc;
      --border-color: #e2e8f0;
      --text-main: #1e293b;
      --text-muted: #64748b;
      --text-accent: #0284c7;
      --primary: #2563eb;
      --primary-soft: rgba(37, 99, 235, 0.1);
      --pk-bg: #fef3c7;
      --pk-text: #b45309;
      --pk-border: #fde68a;
      --fk-bg: #f3e8ff;
      --fk-text: #7e22ce;
      --fk-border: #e9d5ff;
      --uq-bg: #d1fae5;
      --uq-text: #047857;
      --uq-border: #a7f3d0;
      --nn-bg: #fee2e2;
      --nn-text: #b91c1c;
      --nn-border: #fecaca;
      --idx-bg: #dbeafe;
      --idx-text: #1d4ed8;
      --idx-border: #bfdbfe;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: var(--font-sans);
      background-color: var(--bg-base);
      color: var(--text-main);
      line-height: 1.5;
      display: flex;
      min-height: 100vh;
      overflow-x: hidden;
    }

    /* 左ツリー（サイドバー） */
    .sidebar {
      width: 310px;
      background-color: var(--bg-panel);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 0;
      bottom: 0;
      left: 0;
      z-index: 100;
    }

    .sidebar-header {
      padding: 18px 16px 14px;
      border-bottom: 1px solid var(--border-color);
    }

    .sidebar-brand {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-accent);
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 12px;
    }

    .sidebar-search-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-input {
      width: 100%;
      padding: 8px 30px 8px 10px;
      background-color: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: var(--primary);
    }

    .clear-btn-inline {
      position: absolute;
      right: 6px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 13px;
      padding: 2px 5px;
      border-radius: 4px;
      display: none;
    }

    .clear-btn-inline:hover {
      color: var(--text-main);
      background: var(--bg-hover);
    }

    .nav-list {
      list-style: none;
      overflow-y: auto;
      flex: 1;
      padding: 8px;
    }

    .nav-header-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      padding: 8px 10px 4px;
    }

    .nav-item-btn {
      width: 100%;
      text-align: left;
      background: transparent;
      border: 1px solid transparent;
      border-radius: 6px;
      padding: 8px 10px;
      margin-bottom: 3px;
      color: var(--text-main);
      cursor: pointer;
      transition: background-color 0.15s, border-color 0.15s;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-family: inherit;
    }

    .nav-item-btn:hover {
      background-color: var(--bg-hover);
    }

    .nav-item-btn.active {
      background-color: var(--primary-soft);
      border-color: var(--primary);
    }

    .nav-item-text {
      min-width: 0;
      flex: 1;
    }

    .nav-table-name {
      font-family: var(--font-mono);
      font-size: 13px;
      font-weight: 600;
      word-break: break-all;
    }

    .nav-table-logical {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .nav-col-count {
      font-size: 11px;
      color: var(--text-muted);
      background: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 1px 7px;
      flex-shrink: 0;
    }

    /* 右メインコンテンツ */
    .main-content {
      margin-left: 310px;
      flex: 1;
      min-width: 0;
      padding: 24px 28px 48px;
    }

    .doc-top-bar {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      flex-wrap: wrap;
      gap: 16px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .doc-main-title {
      font-size: 24px;
      font-weight: 700;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .mode-pill {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-accent);
      background: var(--primary-soft);
      border: 1px solid var(--primary);
      padding: 2px 10px;
      border-radius: 999px;
    }

    .doc-meta {
      font-size: 13px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .top-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .action-btn {
      padding: 8px 14px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-panel);
      color: var(--text-main);
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background-color 0.2s, border-color 0.2s;
      font-family: inherit;
    }

    .action-btn:hover {
      background-color: var(--bg-hover);
      border-color: var(--primary);
    }

    /* 統計カード */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 14px;
      margin-bottom: 20px;
    }

    .stats-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 14px 16px;
    }

    .stats-label {
      font-size: 12px;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .stats-value {
      font-size: 22px;
      font-weight: 700;
      color: var(--text-accent);
    }

    /* 選択中テーブル補助パネル */
    .selected-table-panel {
      display: none;
      background-color: var(--bg-card);
      border: 1px solid var(--primary);
      border-radius: 8px;
      padding: 14px 18px;
      margin-bottom: 16px;
    }

    .selected-table-panel.visible {
      display: block;
    }

    .selected-table-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 8px;
    }

    .selected-table-title {
      display: flex;
      align-items: baseline;
      gap: 10px;
      flex-wrap: wrap;
    }

    .selected-table-name {
      font-family: var(--font-mono);
      font-size: 17px;
      font-weight: 700;
      color: var(--text-accent);
    }

    .selected-table-logical {
      font-size: 14px;
      color: var(--text-muted);
    }

    .selected-table-note {
      font-size: 13px;
      color: var(--text-main);
      background: var(--bg-base);
      border-left: 3px solid var(--primary);
      padding: 8px 12px;
      border-radius: 0 6px 6px 0;
      margin-top: 8px;
      white-space: pre-wrap;
    }

    .selected-sub-blocks {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }

    .sub-block-box {
      background: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      padding: 10px 12px;
    }

    .sub-block-title {
      font-size: 12px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 6px;
    }

    .sub-list {
      list-style: none;
      font-size: 12px;
    }

    .sub-list li {
      padding: 3px 0;
      border-bottom: 1px dashed var(--border-color);
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }

    .sub-list li:last-child {
      border-bottom: none;
    }

    /* 中央グリッドカード */
    .grid-card {
      background-color: var(--bg-card);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      overflow: hidden;
    }

    .grid-toolbar {
      padding: 12px 16px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-panel);
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 10px;
    }

    .grid-status {
      font-size: 13px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .grid-status strong {
      color: var(--text-main);
    }

    .active-table-chip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: var(--primary-soft);
      color: var(--text-accent);
      border: 1px solid var(--primary);
      border-radius: 999px;
      padding: 2px 10px;
      font-size: 12px;
      font-family: var(--font-mono);
    }

    .chip-close-btn {
      background: none;
      border: none;
      color: inherit;
      cursor: pointer;
      font-size: 12px;
      padding: 0 2px;
    }

    .grid-toolbar-actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .highlight-box-wrap {
      position: relative;
      display: flex;
      align-items: center;
      width: 230px;
    }

    .highlight-input {
      width: 100%;
      padding: 5px 26px 5px 10px;
      font-size: 12px;
      border-radius: 6px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-base);
      color: var(--text-main);
      outline: none;
      font-family: inherit;
      transition: border-color 0.2s;
    }

    .highlight-input:focus {
      border-color: #f59e0b;
    }

    mark.hl-match {
      background-color: rgba(250, 204, 21, 0.35);
      color: inherit;
      padding: 0 2px;
      border-radius: 2px;
      box-shadow: 0 0 0 1px rgba(250, 204, 21, 0.55);
    }

    body.light-theme mark.hl-match {
      background-color: #fef08a;
      color: #1e293b;
      box-shadow: 0 0 0 1px #eab308;
    }

    .grid-scroll-wrap {
      width: 100%;
      overflow-x: auto;
    }

    .grid-table {
      width: 100%;
      min-width: 1080px;
      border-collapse: collapse;
      font-size: 13px;
    }

    /* 1行目: カラムヘッダー行 */
    .grid-header-row th {
      background-color: var(--bg-panel);
      color: var(--text-muted);
      font-weight: 700;
      font-size: 12px;
      text-align: left;
      padding: 10px 10px;
      border-bottom: 1px solid var(--border-color);
      border-right: 1px solid var(--border-color);
      white-space: nowrap;
      cursor: pointer;
      user-select: none;
      transition: background-color 0.15s, color 0.15s;
    }

    .grid-header-row th:last-child {
      border-right: none;
    }

    .grid-header-row th:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
    }

    .sort-indicator {
      margin-left: 4px;
      font-size: 10px;
      opacity: 0.7;
    }

    /* 2行目: 列フィルタ行 */
    .grid-filter-row th {
      background-color: var(--bg-base);
      padding: 6px 6px;
      border-bottom: 2px solid var(--border-color);
      border-right: 1px solid var(--border-color);
    }

    .grid-filter-row th:last-child {
      border-right: none;
    }

    .col-filter-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .col-filter-input {
      width: 100%;
      padding: 5px 24px 5px 8px;
      font-size: 12px;
      border-radius: 4px;
      border: 1px solid var(--border-color);
      background-color: var(--bg-panel);
      color: var(--text-main);
      outline: none;
      font-family: inherit;
    }

    .col-filter-input:focus {
      border-color: var(--primary);
    }

    .col-filter-clear {
      position: absolute;
      right: 4px;
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      font-size: 11px;
      line-height: 1;
      padding: 2px 4px;
      border-radius: 3px;
      display: none;
    }

    .col-filter-clear:hover {
      color: var(--text-main);
      background: var(--bg-hover);
    }

    /* 3行目以降: 1行1カラム データ行 */
    .grid-table tbody tr {
      border-bottom: 1px solid var(--border-color);
      transition: background-color 0.12s;
    }

    .grid-table tbody tr:nth-child(even) {
      background-color: var(--bg-row-alt);
    }

    .grid-table tbody tr:hover {
      background-color: var(--bg-hover);
    }

    .grid-table tbody td {
      padding: 8px 10px;
      vertical-align: top;
      border-right: 1px solid var(--border-color);
    }

    .grid-table tbody td:last-child {
      border-right: none;
    }

    .mono-link-btn {
      background: none;
      border: none;
      padding: 0;
      color: var(--text-accent);
      font-family: var(--font-mono);
      font-weight: 600;
      font-size: 13px;
      cursor: pointer;
      text-align: left;
    }

    .mono-link-btn:hover {
      text-decoration: underline;
    }

    .col-name {
      font-family: var(--font-mono);
      font-weight: 600;
      color: var(--text-main);
    }

    .data-type {
      font-family: var(--font-mono);
      font-size: 12px;
      color: var(--text-accent);
      background-color: var(--primary-soft);
      padding: 2px 6px;
      border-radius: 4px;
      display: inline-block;
    }

    .badge {
      display: inline-block;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 700;
      border-radius: 4px;
      margin-right: 3px;
      margin-bottom: 2px;
      border: 1px solid transparent;
    }

    .badge-pk { background-color: var(--pk-bg); color: var(--pk-text); border-color: var(--pk-border); }
    .badge-fk { background-color: var(--fk-bg); color: var(--fk-text); border-color: var(--fk-border); }
    .badge-uq { background-color: var(--uq-bg); color: var(--uq-text); border-color: var(--uq-border); }
    .badge-nn { background-color: var(--nn-bg); color: var(--nn-text); border-color: var(--nn-border); }
    .badge-idx { background-color: var(--idx-bg); color: var(--idx-text); border-color: var(--idx-border); }

    code {
      font-family: var(--font-mono);
      font-size: 12px;
      background-color: rgba(128, 128, 128, 0.14);
      padding: 2px 5px;
      border-radius: 4px;
    }

    .text-muted {
      color: var(--text-muted);
    }

    .empty-row-cell {
      text-align: center;
      padding: 36px 16px !important;
      color: var(--text-muted);
      font-size: 14px;
    }

    .grid-load-more-bar {
      display: none;
      align-items: center;
      justify-content: center;
      gap: 10px;
      padding: 12px 16px;
      border-top: 1px solid var(--border-color);
      background-color: var(--bg-panel);
      font-size: 13px;
      color: var(--text-muted);
    }

    .grid-load-more-bar.visible {
      display: flex;
      flex-wrap: wrap;
    }

    /* 印刷用スタイル */
    @media print {
      .sidebar, .top-actions, .grid-filter-row, .chip-close-btn, .grid-load-more-bar {
        display: none !important;
      }
      body {
        background-color: #ffffff;
        color: #000000;
        display: block;
      }
      .main-content {
        margin-left: 0;
        padding: 0;
      }
      .grid-card, .stats-card, .selected-table-panel {
        border: 1px solid #cbd5e1;
        background-color: #ffffff;
      }
      .grid-table {
        min-width: 0;
        font-size: 11px;
      }
      .grid-table tbody tr {
        page-break-inside: avoid;
      }
    }
  </style>
</head>
<body>

  <!-- 左ツリー（テーブル一覧） -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span>📘</span>
        <span>Data Dictionary</span>
      </div>
      <div class="sidebar-search-wrap">
        <input type="text" class="search-input" id="treeSearchInput" data-i18n-placeholder="searchPlaceholderTree" placeholder="${escapeHtml(formatDocText(defaultLang, 'searchPlaceholderTree'))}" />
        <button type="button" class="clear-btn-inline" id="btnClearTreeSearch" data-i18n-title="clearTitle" title="${escapeHtml(formatDocText(defaultLang, 'clearTitle'))}">✕</button>
      </div>
    </div>
    <ul class="nav-list" id="navList"></ul>
  </aside>

  <!-- 右メインコンテンツ -->
  <main class="main-content">
    <div class="doc-top-bar">
      <div>
        <h1 class="doc-main-title">
          <span id="docMainTitleText">${escapeHtml(formatDocText(defaultLang, 'mainTitle', { project: projectName }))}</span>
          <span class="mode-pill" data-i18n="modePillGrid">${escapeHtml(formatDocText(defaultLang, 'modePillGrid'))}</span>
        </h1>
        <div class="doc-meta" id="docMeta">${escapeHtml(formatDocText(defaultLang, 'metaLine', { date: initDate, db: databaseType }))}</div>
      </div>
      <div class="top-actions">
        <button type="button" class="action-btn" id="btnToggleLang">${escapeHtml(formatDocText(defaultLang, 'btnToggleLang'))}</button>
        <button type="button" class="action-btn" id="btnResetAllFilters" data-i18n="btnResetAllFilters">${escapeHtml(formatDocText(defaultLang, 'btnResetAllFilters'))}</button>
        <button type="button" class="action-btn" id="btnPrint" data-i18n="btnPrint">${escapeHtml(formatDocText(defaultLang, 'btnPrint'))}</button>
        <button type="button" class="action-btn" id="btnToggleTheme">${escapeHtml(formatDocText(defaultLang, 'btnToggleThemeDefault'))}</button>
      </div>
    </div>

    <!-- 統計サマリー -->
    <div class="stats-grid">
      <div class="stats-card">
        <div class="stats-label" data-i18n="statTotalTables">${escapeHtml(formatDocText(defaultLang, 'statTotalTables'))}</div>
        <div class="stats-value">${totalTables}</div>
      </div>
      <div class="stats-card">
        <div class="stats-label" data-i18n="statTotalColumns">${escapeHtml(formatDocText(defaultLang, 'statTotalColumns'))}</div>
        <div class="stats-value">${totalColumns}</div>
      </div>
      <div class="stats-card">
        <div class="stats-label" data-i18n="statTotalRefs">${escapeHtml(formatDocText(defaultLang, 'statTotalRefs'))}</div>
        <div class="stats-value">${totalRefs}</div>
      </div>
      <div class="stats-card">
        <div class="stats-label" data-i18n="statDbms">${escapeHtml(formatDocText(defaultLang, 'statDbms'))}</div>
        <div class="stats-value" style="font-size: 18px; margin-top: 6px;">${escapeHtml(databaseType)}</div>
      </div>
    </div>

    <!-- 左ツリーでテーブル選択時に表示する補助パネル -->
    <section class="selected-table-panel" id="selectedTablePanel"></section>

    <!-- 中央グリッド（1行目: カラム名 / 2行目: フィルタ / 3行目以降: 1行1カラム） -->
    <section class="grid-card">
      <div class="grid-toolbar">
        <div class="grid-status" id="gridStatus"></div>
        <div class="grid-toolbar-actions">
          <div class="highlight-box-wrap">
            <input type="text" class="highlight-input" id="highlightInput" data-i18n-placeholder="highlightPlaceholder" placeholder="${escapeHtml(formatDocText(defaultLang, 'highlightPlaceholder'))}" />
            <button type="button" class="clear-btn-inline" id="btnClearHighlight" data-i18n-title="clearHighlightTitle" title="${escapeHtml(formatDocText(defaultLang, 'clearHighlightTitle'))}">✕</button>
          </div>
          <button type="button" class="action-btn" id="btnClearColFilters" data-i18n="btnClearColFilters" style="padding: 5px 10px; font-size: 12px;">${escapeHtml(formatDocText(defaultLang, 'btnClearColFilters'))}</button>
        </div>
      </div>
      <div class="grid-scroll-wrap">
        <table class="grid-table" id="columnGridTable">
          <thead>
            <tr class="grid-header-row" id="gridHeaderRow">
              ${[
                ['tableName', 'gridColTablePhysical'],
                ['tableLogical', 'gridColTableLogical'],
                ['colName', 'gridColColPhysical'],
                ['colLogical', 'gridColColLogical'],
                ['type', 'gridColType'],
                ['constraintsText', 'gridColConstraints'],
                ['defaultValue', 'gridColDefault'],
                ['fkTarget', 'gridColFk'],
                ['note', 'gridColNote']
              ].map(([col, key]) => `<th data-sort="${col}"><span data-i18n="${key}">${escapeHtml(formatDocText(defaultLang, key))}</span> <span class="sort-indicator"></span></th>`).join('\n              ')}
            </tr>
            <tr class="grid-filter-row" id="gridFilterRow">
              ${[
                ['tableName', 'filterTableName'],
                ['tableLogical', 'filterTableLogical'],
                ['colName', 'filterColName'],
                ['colLogical', 'filterColLogical'],
                ['type', 'filterType'],
                ['constraintsText', 'filterConstraints'],
                ['defaultValue', 'filterDefault'],
                ['fkTarget', 'filterFk'],
                ['note', 'filterNote']
              ].map(([col, phKey]) => `<th><div class="col-filter-wrap"><input type="text" class="col-filter-input" data-col="${col}" data-i18n-placeholder="${phKey}" placeholder="${escapeHtml(formatDocText(defaultLang, phKey))}" /><button type="button" class="col-filter-clear" data-clear-col="${col}" data-i18n-title="clearTitle" title="${escapeHtml(formatDocText(defaultLang, 'clearTitle'))}">✕</button></div></th>`).join('')}
            </tr>
          </thead>
          <tbody id="gridBody"></tbody>
        </table>
      </div>
      <div class="grid-load-more-bar" id="gridLoadMoreBar"></div>
    </section>
  </main>

  <script id="schemaDocData" type="application/json">${embeddedJson}</script>
  <script>
    (function () {
      const PAGE_SIZE = 200;
      const I18N = ${safeJsonForScript(HTML_DOC_I18N)};
      const DOC_META = ${safeJsonForScript({ projectName, databaseType, generatedDateJa, generatedDateEn, defaultLang })};
      let currentLang = DOC_META.defaultLang === 'en' ? 'en' : 'ja';
      try {
        const savedLang = localStorage.getItem('dbml_doc_lang');
        if (savedLang === 'ja' || savedLang === 'en') {
          currentLang = savedLang;
        }
      } catch {}
      let collator = new Intl.Collator(currentLang === 'en' ? 'en' : 'ja');

      // 日本語コメント: 埋め込み辞書から現在言語の文言を取得し、プレースホルダを置換する
      function docT(key, params) {
        let text = I18N[currentLang]?.[key] ?? I18N.ja?.[key] ?? key;
        if (params && typeof params === 'object') {
          Object.keys(params).forEach((k) => {
            text = String(text).split('{' + k + '}').join(params[k] !== undefined && params[k] !== null ? String(params[k]) : '');
          });
        }
        return String(text);
      }

      const rawJson = document.getElementById('schemaDocData')?.textContent || '{}';
      const docModel = JSON.parse(rawJson);
      const tables = docModel.tables || [];

      // テーブル辞書および1行1カラムのフラット配列を構築（検索用小文字キャッシュを事前生成）
      const tableMap = new Map();
      const allRows = [];
      tables.forEach((tbl) => {
        tableMap.set(tbl.name, tbl);
        const tName = tbl.name || '';
        const tLogical = tbl.logicalName || '';
        const tNameLc = tName.toLowerCase();
        const tLogicalLc = tLogical.toLowerCase();

        (tbl.fields || []).forEach((fld) => {
          const fkTarget = fld.fkTargetTable
            ? (fld.fkTargetField ? fld.fkTargetTable + '.' + fld.fkTargetField : fld.fkTargetTable)
            : '';
          const constraints = fld.constraints || [];
          const constraintsText = constraints.join(' ');
          const cName = fld.name || '';
          const cLogical = fld.logicalName || '';
          const type = fld.type || '';
          const defVal = fld.defaultValue || '';
          const note = fld.note || '';

          allRows.push({
            tableName: tName,
            tableLogical: tLogical,
            colName: cName,
            colLogical: cLogical,
            type,
            constraints,
            constraintsText,
            defaultValue: defVal,
            fkTarget,
            fkTargetTable: fld.fkTargetTable || '',
            note,
            _lc: {
              tableName: tNameLc,
              tableLogical: tLogicalLc,
              colName: cName.toLowerCase(),
              colLogical: cLogical.toLowerCase(),
              type: type.toLowerCase(),
              constraintsText: constraintsText.toLowerCase(),
              defaultValue: defVal.toLowerCase(),
              fkTarget: fkTarget.toLowerCase(),
              note: note.toLowerCase()
            }
          });
        });
      });

      const state = {
        selectedTable: null,
        treeQuery: '',
        colFilters: {
          tableName: '',
          tableLogical: '',
          colName: '',
          colLogical: '',
          type: '',
          constraintsText: '',
          defaultValue: '',
          fkTarget: '',
          note: ''
        },
        sortKey: null,
        sortDir: 'asc',
        highlightQuery: '',
        filteredRows: allRows,
        renderedCount: 0
      };

      function debounce(fn, waitMs) {
        let timer = null;
        return function (...args) {
          clearTimeout(timer);
          timer = setTimeout(() => fn.apply(this, args), waitMs);
        };
      }

      function esc(str) {
        if (str === null || str === undefined) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function escHighlight(str) {
        const text = str === null || str === undefined ? '' : String(str);
        const q = state.highlightQuery.trim();
        if (!q) return esc(text);
        const qLc = q.toLowerCase();
        const textLc = text.toLowerCase();
        let idx = textLc.indexOf(qLc);
        if (idx === -1) return esc(text);
        let res = '';
        let pos = 0;
        const qLen = q.length;
        while (idx !== -1) {
          if (idx > pos) res += esc(text.slice(pos, idx));
          res += '<mark class="hl-match">' + esc(text.slice(idx, idx + qLen)) + '</mark>';
          pos = idx + qLen;
          idx = textLc.indexOf(qLc, pos);
        }
        if (pos < text.length) res += esc(text.slice(pos));
        return res;
      }

      // 1. テーマ切替 (localStorage 永続化・オフライン環境保護)
      const btnToggleTheme = document.getElementById('btnToggleTheme');
      let savedTheme = null;
      try {
        savedTheme = localStorage.getItem('dbml_doc_theme');
      } catch {}
      let hasThemeToggled = (savedTheme === 'light' || savedTheme === 'dark');
      if (savedTheme === 'light') {
        document.body.classList.add('light-theme');
      }
      // 日本語コメント: 現在のテーマ状態と言語に合わせてテーマ切替ボタンの表示文言を更新する
      function updateThemeButtonLabel() {
        if (!btnToggleTheme) return;
        const isLight = document.body.classList.contains('light-theme');
        if (!hasThemeToggled && !isLight) {
          btnToggleTheme.textContent = docT('btnToggleThemeDefault');
          return;
        }
        btnToggleTheme.textContent = docT(isLight ? 'btnThemeLight' : 'btnThemeDark');
      }
      updateThemeButtonLabel();
      btnToggleTheme.addEventListener('click', () => {
        hasThemeToggled = true;
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        updateThemeButtonLabel();
        try {
          localStorage.setItem('dbml_doc_theme', isLight ? 'light' : 'dark');
        } catch {}
      });

      // 2. 印刷 / PDF（印刷時は未描画の残り行があれば全展開してから印刷）
      document.getElementById('btnPrint').addEventListener('click', () => {
        if (state.renderedCount < state.filteredRows.length) {
          appendGridRows(state.filteredRows.length - state.renderedCount);
        }
        window.print();
      });

      // 3. 左ツリー描画
      const navListEl = document.getElementById('navList');
      const treeSearchInput = document.getElementById('treeSearchInput');
      const btnClearTreeSearch = document.getElementById('btnClearTreeSearch');

      function renderSidebar() {
        const q = state.treeQuery.toLowerCase().trim();
        const filteredTables = tables.filter((t) => {
          if (!q) return true;
          return t.name.toLowerCase().includes(q) || (t.logicalName || '').toLowerCase().includes(q);
        });

        let html = '<li class="nav-header-label">TABLES (' + filteredTables.length + ' / ' + tables.length + ')</li>';
        html += '<li>' +
          '<button type="button" class="nav-item-btn ' + (state.selectedTable === null ? 'active' : '') + '" data-select-table="">' +
            '<div class="nav-item-text">' +
              '<div class="nav-table-name">' + esc(docT('sidebarShowAllTitle')) + '</div>' +
              '<div class="nav-table-logical">' + esc(docT('sidebarShowAllDesc')) + '</div>' +
            '</div>' +
            '<span class="nav-col-count">' + allRows.length + '</span>' +
          '</button>' +
        '</li>';

        filteredTables.forEach((t) => {
          const isActive = state.selectedTable === t.name;
          const colCount = (t.fields || []).length;
          html += '<li>' +
            '<button type="button" class="nav-item-btn ' + (isActive ? 'active' : '') + '" data-select-table="' + esc(t.name) + '">' +
              '<div class="nav-item-text">' +
                '<div class="nav-table-name">' + esc(t.name) + '</div>' +
                (t.logicalName ? '<div class="nav-table-logical">(' + esc(t.logicalName) + ')</div>' : '') +
              '</div>' +
              '<span class="nav-col-count">' + colCount + '</span>' +
            '</button>' +
          '</li>';
        });

        navListEl.innerHTML = html;
      }

      // 4. 選択中テーブル詳細パネル描画
      const selectedTablePanelEl = document.getElementById('selectedTablePanel');
      function renderSelectedTablePanel() {
        if (!state.selectedTable || !tableMap.has(state.selectedTable)) {
          selectedTablePanelEl.classList.remove('visible');
          selectedTablePanelEl.innerHTML = '';
          return;
        }
        const tbl = tableMap.get(state.selectedTable);
        let subHtml = '';
        const hasIndexes = tbl.indexes && tbl.indexes.length > 0;
        const hasChecks = tbl.checks && tbl.checks.length > 0;
        if (hasIndexes || hasChecks) {
          subHtml += '<div class="selected-sub-blocks">';
          if (hasIndexes) {
            subHtml += '<div class="sub-block-box"><div class="sub-block-title">' + esc(docT('sectionIndexes', { count: tbl.indexes.length })) + '</div><ul class="sub-list">' +
              tbl.indexes.map((idx) => {
                const badgeCls = idx.isPkIndex ? 'badge-pk' : idx.isUnique ? 'badge-uq' : 'badge-idx';
                return '<li><span class="badge ' + badgeCls + '">' + esc(idx.type) + '</span><code>' + esc(idx.name) + '</code><span class="text-muted">(' + esc(idx.columns) + ')</span></li>';
              }).join('') +
              '</ul></div>';
          }
          if (hasChecks) {
            subHtml += '<div class="sub-block-box"><div class="sub-block-title">' + esc(docT('sectionChecks', { count: tbl.checks.length })) + '</div><ul class="sub-list">' +
              tbl.checks.map((chk) => '<li><code>' + esc(chk.name) + '</code><span>' + esc(chk.expression) + '</span></li>').join('') +
              '</ul></div>';
          }
          subHtml += '</div>';
        }

        selectedTablePanelEl.innerHTML =
          '<div class="selected-table-head">' +
            '<div class="selected-table-title">' +
              '<span class="selected-table-name">' + esc(tbl.name) + '</span>' +
              (tbl.logicalName ? '<span class="selected-table-logical">(' + esc(tbl.logicalName) + ')</span>' : '') +
              '<span class="nav-col-count">' + esc(docT('columnCount', { count: (tbl.fields || []).length })) + '</span>' +
            '</div>' +
            '<button type="button" class="action-btn" id="btnShowAllTables" style="padding: 5px 10px; font-size: 12px;">' + esc(docT('btnBackToAllTables')) + '</button>' +
          '</div>' +
          (tbl.note ? '<div class="selected-table-note">📝 ' + esc(tbl.note) + '</div>' : '') +
          subHtml;

        selectedTablePanelEl.classList.add('visible');
      }

      // 5. 中央グリッド描画（チャンク描画で軽量化）
      const gridBodyEl = document.getElementById('gridBody');
      const gridStatusEl = document.getElementById('gridStatus');
      const gridLoadMoreBarEl = document.getElementById('gridLoadMoreBar');

      function buildRowHtml(r) {
        const badgesHtml = r.constraints.length
          ? r.constraints.map((c) => {
              const cls = c === 'PK' ? 'badge-pk' : c === 'FK' ? 'badge-fk' : c === 'UQ' ? 'badge-uq' : 'badge-nn';
              return '<span class="badge ' + cls + '">' + escHighlight(c) + '</span>';
            }).join('')
          : '<span class="text-muted">-</span>';

        const fkHtml = r.fkTarget
          ? '<button type="button" class="mono-link-btn" data-jump-table="' + esc(r.fkTargetTable) + '">➔ ' + escHighlight(r.fkTarget) + '</button>'
          : '<span class="text-muted">-</span>';

        return '<tr>' +
          '<td><button type="button" class="mono-link-btn" data-jump-table="' + esc(r.tableName) + '">' + escHighlight(r.tableName) + '</button></td>' +
          '<td>' + (r.tableLogical ? escHighlight(r.tableLogical) : '<span class="text-muted">-</span>') + '</td>' +
          '<td><span class="col-name">' + escHighlight(r.colName) + '</span></td>' +
          '<td>' + (r.colLogical ? escHighlight(r.colLogical) : '<span class="text-muted">-</span>') + '</td>' +
          '<td><span class="data-type">' + escHighlight(r.type) + '</span></td>' +
          '<td>' + badgesHtml + '</td>' +
          '<td>' + (r.defaultValue ? '<code>' + escHighlight(r.defaultValue) + '</code>' : '<span class="text-muted">-</span>') + '</td>' +
          '<td>' + fkHtml + '</td>' +
          '<td>' + (r.note ? escHighlight(r.note) : '<span class="text-muted">-</span>') + '</td>' +
        '</tr>';
      }

      function updateLoadMoreBar() {
        const remaining = state.filteredRows.length - state.renderedCount;
        if (remaining <= 0) {
          gridLoadMoreBarEl.classList.remove('visible');
          gridLoadMoreBarEl.innerHTML = '';
          return;
        }
        const nextBatch = Math.min(remaining, PAGE_SIZE);
        gridLoadMoreBarEl.innerHTML =
          '<span>' + docT('loadMoreStatus', { remaining: remaining, rendered: state.renderedCount, total: state.filteredRows.length }) + '</span>' +
          '<button type="button" class="action-btn" id="btnLoadMoreRows" style="padding: 5px 12px; font-size: 12px;">' + esc(docT('btnLoadMoreRows', { count: nextBatch })) + '</button>' +
          '<button type="button" class="action-btn" id="btnLoadAllRows" style="padding: 5px 12px; font-size: 12px;">' + esc(docT('btnLoadAllRows')) + '</button>';
        gridLoadMoreBarEl.classList.add('visible');
      }

      function appendGridRows(count) {
        const start = state.renderedCount;
        const end = Math.min(start + count, state.filteredRows.length);
        if (start >= end) return;
        let html = '';
        for (let i = start; i < end; i++) {
          html += buildRowHtml(state.filteredRows[i]);
        }
        gridBodyEl.insertAdjacentHTML('beforeend', html);
        state.renderedCount = end;
        updateLoadMoreBar();
      }

      function renderGrid() {
        const activeFilters = [];
        for (const key in state.colFilters) {
          const f = state.colFilters[key].toLowerCase().trim();
          if (f) activeFilters.push([key, f]);
        }

        let rows = allRows.filter((row) => {
          if (state.selectedTable && row.tableName !== state.selectedTable) {
            return false;
          }
          for (let i = 0; i < activeFilters.length; i++) {
            const key = activeFilters[i][0];
            const val = activeFilters[i][1];
            if (!row._lc[key].includes(val)) {
              return false;
            }
          }
          return true;
        });

        if (state.sortKey) {
          const dir = state.sortDir === 'desc' ? -1 : 1;
          const k = state.sortKey;
          rows = rows.slice().sort((a, b) => collator.compare(a[k], b[k]) * dir);
        }

        state.filteredRows = rows;
        state.renderedCount = 0;

        let statusHtml = '<span>' + docT('gridStatusCount', { matched: rows.length, total: allRows.length }) + '</span>';
        if (state.selectedTable) {
          statusHtml += '<span class="active-table-chip">' + esc(docT('gridStatusTableChip', { table: state.selectedTable })) + ' <button type="button" class="chip-close-btn" id="btnChipClearTable" title="' + esc(docT('clearSelectionTitle')) + '">✕</button></span>';
        }
        gridStatusEl.innerHTML = statusHtml;

        if (rows.length === 0) {
          gridBodyEl.innerHTML = '<tr><td colspan="9" class="empty-row-cell">' + esc(docT('gridEmptyMessage')) + '</td></tr>';
          updateLoadMoreBar();
          return;
        }

        const initialCount = Math.min(PAGE_SIZE, rows.length);
        let html = '';
        for (let i = 0; i < initialCount; i++) {
          html += buildRowHtml(rows[i]);
        }
        gridBodyEl.innerHTML = html;
        state.renderedCount = initialCount;
        updateLoadMoreBar();
      }

      // スクロール末尾で次のチャンクを自動読み込み
      if ('IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
          if (entries[0] && entries[0].isIntersecting && state.renderedCount < state.filteredRows.length) {
            appendGridRows(PAGE_SIZE);
          }
        }, { rootMargin: '160px' });
        observer.observe(gridLoadMoreBarEl);
      }

      gridLoadMoreBarEl.addEventListener('click', (e) => {
        if (e.target.id === 'btnLoadMoreRows') {
          appendGridRows(PAGE_SIZE);
        } else if (e.target.id === 'btnLoadAllRows') {
          appendGridRows(state.filteredRows.length - state.renderedCount);
        }
      });

      function renderAll() {
        renderSidebar();
        renderSelectedTablePanel();
        renderGrid();
      }

      function selectTable(tableName) {
        if (!tableName) {
          state.selectedTable = null;
        } else {
          state.selectedTable = (state.selectedTable === tableName) ? null : tableName;
        }
        renderAll();
      }

      // イベント登録: 左ツリー選択
      navListEl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-select-table]');
        if (!btn) return;
        const tbl = btn.getAttribute('data-select-table');
        selectTable(tbl || null);
      });

      // イベント登録: 左ツリー検索（デバウンス適用）
      const debouncedRenderSidebar = debounce(renderSidebar, 120);
      treeSearchInput.addEventListener('input', (e) => {
        state.treeQuery = e.target.value;
        btnClearTreeSearch.style.display = state.treeQuery ? 'block' : 'none';
        debouncedRenderSidebar();
      });
      btnClearTreeSearch.addEventListener('click', () => {
        treeSearchInput.value = '';
        state.treeQuery = '';
        btnClearTreeSearch.style.display = 'none';
        renderSidebar();
      });

      // イベント登録: 2行目 列フィルタ入力（デバウンス適用）＆右端クリアボタン連動
      const debouncedRenderGrid = debounce(renderGrid, 120);
      const colFilterInputs = document.querySelectorAll('.col-filter-input');
      const colFilterClearBtns = document.querySelectorAll('.col-filter-clear');

      function syncColFilterClearBtn(col, val) {
        const btn = document.querySelector('.col-filter-clear[data-clear-col="' + col + '"]');
        if (btn) btn.style.display = val ? 'block' : 'none';
      }

      colFilterInputs.forEach((input) => {
        input.addEventListener('input', (e) => {
          const col = e.target.getAttribute('data-col');
          state.colFilters[col] = e.target.value;
          syncColFilterClearBtn(col, e.target.value);
          debouncedRenderGrid();
        });
      });

      colFilterClearBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
          const col = btn.getAttribute('data-clear-col');
          const input = document.querySelector('.col-filter-input[data-col="' + col + '"]');
          if (input) {
            input.value = '';
            input.focus();
          }
          state.colFilters[col] = '';
          btn.style.display = 'none';
          renderGrid();
        });
      });

      // イベント登録: 1行目 ヘッダークリックでソート
      const headerCells = document.querySelectorAll('#gridHeaderRow th[data-sort]');
      headerCells.forEach((th) => {
        th.addEventListener('click', () => {
          const key = th.getAttribute('data-sort');
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortKey = key;
            state.sortDir = 'asc';
          }
          headerCells.forEach((cell) => {
            const ind = cell.querySelector('.sort-indicator');
            if (!ind) return;
            ind.textContent = cell.getAttribute('data-sort') === state.sortKey
              ? (state.sortDir === 'asc' ? '▲' : '▼')
              : '';
          });
          renderGrid();
        });
      });

      // イベント登録: グリッド内のテーブル名/FKクリックでテーブル絞り込み
      gridBodyEl.addEventListener('click', (e) => {
        const jumpBtn = e.target.closest('[data-jump-table]');
        if (!jumpBtn) return;
        const tbl = jumpBtn.getAttribute('data-jump-table');
        if (tbl && tableMap.has(tbl)) {
          state.selectedTable = tbl;
          renderAll();
        }
      });

      // イベント登録: 選択解除ボタン群
      selectedTablePanelEl.addEventListener('click', (e) => {
        if (e.target.id === 'btnShowAllTables') {
          state.selectedTable = null;
          renderAll();
        }
      });
      gridStatusEl.addEventListener('click', (e) => {
        if (e.target.id === 'btnChipClearTable') {
          state.selectedTable = null;
          renderAll();
        }
      });

      function clearColFilters() {
        for (const k in state.colFilters) state.colFilters[k] = '';
        colFilterInputs.forEach((inp) => { inp.value = ''; });
        colFilterClearBtns.forEach((btn) => { btn.style.display = 'none'; });
      }

      const highlightInput = document.getElementById('highlightInput');
      const btnClearHighlight = document.getElementById('btnClearHighlight');

      highlightInput.addEventListener('input', (e) => {
        state.highlightQuery = e.target.value;
        btnClearHighlight.style.display = state.highlightQuery ? 'block' : 'none';
        debouncedRenderGrid();
      });

      btnClearHighlight.addEventListener('click', () => {
        highlightInput.value = '';
        state.highlightQuery = '';
        btnClearHighlight.style.display = 'none';
        highlightInput.focus();
        renderGrid();
      });

      document.getElementById('btnClearColFilters').addEventListener('click', () => {
        clearColFilters();
        renderGrid();
      });

      document.getElementById('btnResetAllFilters').addEventListener('click', () => {
        state.selectedTable = null;
        state.treeQuery = '';
        treeSearchInput.value = '';
        btnClearTreeSearch.style.display = 'none';
        state.highlightQuery = '';
        highlightInput.value = '';
        btnClearHighlight.style.display = 'none';
        clearColFilters();
        state.sortKey = null;
        state.sortDir = 'asc';
        headerCells.forEach((cell) => {
          const ind = cell.querySelector('.sort-indicator');
          if (ind) ind.textContent = '';
        });
        renderAll();
      });

      // 日本語コメント: 表示言語を切り替え、静的要素および動的描画をすべて即時更新する
      function applyLang(lang) {
        currentLang = lang === 'en' ? 'en' : 'ja';
        collator = new Intl.Collator(currentLang === 'en' ? 'en' : 'ja');
        document.documentElement.lang = currentLang;
        document.title = docT('pageTitleGrid', { project: DOC_META.projectName });

        const mainTitleEl = document.getElementById('docMainTitleText');
        if (mainTitleEl) {
          mainTitleEl.textContent = docT('mainTitle', { project: DOC_META.projectName });
        }
        const docMetaEl = document.getElementById('docMeta');
        if (docMetaEl) {
          const dateStr = currentLang === 'en' ? DOC_META.generatedDateEn : DOC_META.generatedDateJa;
          docMetaEl.textContent = docT('metaLine', { date: dateStr, db: DOC_META.databaseType });
        }
        const btnToggleLangEl = document.getElementById('btnToggleLang');
        if (btnToggleLangEl) {
          btnToggleLangEl.textContent = docT('btnToggleLang');
        }

        document.querySelectorAll('[data-i18n]').forEach((el) => {
          const key = el.getAttribute('data-i18n');
          if (key) el.textContent = docT(key);
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
          const key = el.getAttribute('data-i18n-placeholder');
          if (key) el.placeholder = docT(key);
        });
        document.querySelectorAll('[data-i18n-title]').forEach((el) => {
          const key = el.getAttribute('data-i18n-title');
          if (key) el.title = docT(key);
        });

        updateThemeButtonLabel();
        renderSidebar();
        renderSelectedTablePanel();
        renderGrid();
      }

      // イベント登録: 言語切替（日英トグル＋localStorage保存）
      const btnToggleLang = document.getElementById('btnToggleLang');
      if (btnToggleLang) {
        btnToggleLang.addEventListener('click', () => {
          const next = currentLang === 'ja' ? 'en' : 'ja';
          try {
            localStorage.setItem('dbml_doc_lang', next);
          } catch {}
          applyLang(next);
        });
      }

      // 初期描画（保存済みまたは指定言語を適用し、初回のみ描画）
      applyLang(currentLang);
    })();
  </script>
</body>
</html>`;
}
