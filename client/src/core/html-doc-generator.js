// 日本語コメント: 単一オフライン完結型 HTMLデータ仕様書 生成エンジン (client/src/core/html-doc-generator.js)
// スキーマのテーブル定義・カラム・制約・論理名・説明・リレーション・インデックスを元に、
// 外部依存なしで任意のブラウザで閲覧・高速検索・テーマ切替・印刷ができる自己完結型 HTML ファイルを生成します。

/**
 * HTML 特殊文字のエスケープ処理
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * script タグ内へ安全に JSON を埋め込むためのシリアライズ処理
 * @param {*} data
 * @returns {string}
 */
export function safeJsonForScript(data) {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

// 日本語コメント: 出力 HTML 仕様書（標準版・検索強化グリッド版共通）の多言語翻訳辞書
export const HTML_DOC_I18N = {
  ja: {
    pageTitle: '{project} - データベース仕様書',
    pageTitleGrid: '{project} - データベース仕様書 (検索強化グリッド版)',
    mainTitle: '📘 {project} データ仕様書',
    modePillGrid: '検索強化グリッド版',
    metaLine: '作成日時: {date} ｜ DB Engine: {db}',
    btnResetAllFilters: '🔄 フィルタ全解除',
    btnPrint: '🖨️ 印刷 / PDF',
    btnToggleThemeDefault: '🌙 テーマ切替',
    btnThemeLight: '☀️ ライト表示中',
    btnThemeDark: '🌙 ダーク表示中',
    btnToggleLang: '🌐 English',
    statTotalTables: '総テーブル数',
    statTotalColumns: '総カラム数',
    statTotalRefs: 'リレーション数 (FK)',
    statDbms: 'DBMS 種別',
    searchPlaceholderCard: '🔍 テーブル・カラムを検索...',
    searchPlaceholderTree: '🔍 テーブル名・論理名で絞込...',
    clearTitle: 'クリア',
    highlightPlaceholder: '🖍️ ハイライト検索...',
    clearHighlightTitle: 'ハイライトをクリア',
    btnClearColFilters: '✕ 列フィルタをクリア',
    columnCount: '{count} カラム',
    colPhysicalName: '物理名',
    colLogicalName: '論理名 (和名)',
    colDataType: 'データ型',
    colConstraints: '制約',
    colDefaultValue: 'デフォルト値',
    colDescAndRef: '説明・関連',
    sectionIndexes: '🔑 インデックス定義 ({count})',
    idxColName: 'インデックス名',
    idxColType: '種別',
    idxColTarget: '対象カラム',
    sectionChecks: '🛡️ Check制約 ({count})',
    chkColName: '制約名',
    chkColExpr: '条件式',
    gridColTablePhysical: 'テーブル物理名',
    gridColTableLogical: 'テーブル論理名',
    gridColColPhysical: 'カラム物理名',
    gridColColLogical: 'カラム論理名',
    gridColType: 'データ型',
    gridColConstraints: '制約',
    gridColDefault: 'デフォルト値',
    gridColFk: '関連 (FK)',
    gridColNote: '説明 (Note)',
    filterTableName: 'テーブル絞込...',
    filterTableLogical: '論理名絞込...',
    filterColName: 'カラム絞込...',
    filterColLogical: '論理名絞込...',
    filterType: '型絞込...',
    filterConstraints: 'PK/FK/UQ/NN...',
    filterDefault: 'デフォルト...',
    filterFk: '参照先...',
    filterNote: '説明絞込...',
    sidebarShowAllTitle: '📋 すべて表示',
    sidebarShowAllDesc: '全テーブルのカラムを表示',
    btnBackToAllTables: '📋 すべて表示に戻る',
    loadMoreStatus: '残り <strong>{remaining}</strong> 件未表示（現在 {rendered} / {total} 件描画中）',
    btnLoadMoreRows: '⏬ さらに {count} 件表示',
    btnLoadAllRows: '📋 すべて表示',
    gridStatusCount: '該当: <strong>{matched}</strong> / {total} カラム',
    gridStatusTableChip: 'テーブル: {table}',
    clearSelectionTitle: '選択解除',
    gridEmptyMessage: '該当するカラムが見つかりません。フィルタ条件を変更またはクリアしてください。',
  },
  en: {
    pageTitle: '{project} - Database Specification',
    pageTitleGrid: '{project} - Database Specification (Enhanced Search Grid)',
    mainTitle: '📘 {project} Data Specification',
    modePillGrid: 'Enhanced Search Grid',
    metaLine: 'Generated: {date} ｜ DB Engine: {db}',
    btnResetAllFilters: '🔄 Reset Filters',
    btnPrint: '🖨️ Print / PDF',
    btnToggleThemeDefault: '🌙 Theme',
    btnThemeLight: '☀️ Light Mode',
    btnThemeDark: '🌙 Dark Mode',
    btnToggleLang: '🌐 日本語',
    statTotalTables: 'Total Tables',
    statTotalColumns: 'Total Columns',
    statTotalRefs: 'Relations (FK)',
    statDbms: 'DBMS Type',
    searchPlaceholderCard: '🔍 Search tables & columns...',
    searchPlaceholderTree: '🔍 Filter by table / logical name...',
    clearTitle: 'Clear',
    highlightPlaceholder: '🖍️ Highlight search...',
    clearHighlightTitle: 'Clear highlight',
    btnClearColFilters: '✕ Clear Column Filters',
    columnCount: '{count} Columns',
    colPhysicalName: 'Physical Name',
    colLogicalName: 'Logical Name',
    colDataType: 'Data Type',
    colConstraints: 'Constraints',
    colDefaultValue: 'Default',
    colDescAndRef: 'Description & Relations',
    sectionIndexes: '🔑 Indexes ({count})',
    idxColName: 'Index Name',
    idxColType: 'Type',
    idxColTarget: 'Columns',
    sectionChecks: '🛡️ Check Constraints ({count})',
    chkColName: 'Constraint Name',
    chkColExpr: 'Expression',
    gridColTablePhysical: 'Table Physical Name',
    gridColTableLogical: 'Table Logical Name',
    gridColColPhysical: 'Column Physical Name',
    gridColColLogical: 'Column Logical Name',
    gridColType: 'Data Type',
    gridColConstraints: 'Constraints',
    gridColDefault: 'Default',
    gridColFk: 'Relation (FK)',
    gridColNote: 'Description (Note)',
    filterTableName: 'Filter table...',
    filterTableLogical: 'Filter logical...',
    filterColName: 'Filter column...',
    filterColLogical: 'Filter logical...',
    filterType: 'Filter type...',
    filterConstraints: 'PK/FK/UQ/NN...',
    filterDefault: 'Default...',
    filterFk: 'Reference...',
    filterNote: 'Filter note...',
    sidebarShowAllTitle: '📋 Show All',
    sidebarShowAllDesc: 'Display columns of all tables',
    btnBackToAllTables: '📋 Back to All Tables',
    loadMoreStatus: '<strong>{remaining}</strong> more hidden (showing {rendered} / {total})',
    btnLoadMoreRows: '⏬ Show {count} more',
    btnLoadAllRows: '📋 Show All',
    gridStatusCount: 'Showing: <strong>{matched}</strong> / {total} Columns',
    gridStatusTableChip: 'Table: {table}',
    clearSelectionTitle: 'Clear selection',
    gridEmptyMessage: 'No matching columns found. Please change or clear filter criteria.',
  },
};

/**
 * HTML 仕様書の文言テンプレートを言語・パラメータに応じてフォーマットする
 * @param {string} lang - 'ja' | 'en'
 * @param {string} key - HTML_DOC_I18N のキー
 * @param {Object} [params={}] - プレースホルダ置換パラメータ
 * @returns {string} フォーマット済み文字列
 */
export function formatDocText(lang, key, params = {}) {
  const template = HTML_DOC_I18N[lang]?.[key] ?? HTML_DOC_I18N.ja[key] ?? key;
  if (!params || typeof params !== 'object') return String(template);
  return String(template).replace(/\{(\w+)\}/g, (_, paramKey) => {
    return paramKey in params ? String(params[paramKey]) : `{${paramKey}}`;
  });
}

/**
 * スキーマモデルから HTML ドキュメント生成用の正規化データを抽出する
 * @param {Object} schemaModel - { project, tables, refs }
 * @param {Object} options - { schemaName, dialectName, lang }
 * @returns {Object} 正規化済みドキュメントモデル
 */
export function extractSchemaDocModel(schemaModel = {}, options = {}) {
  const project = schemaModel.project || {};
  const rawTables = schemaModel.tables || [];
  const refs = schemaModel.refs || [];
  const projectName = project.name || options.schemaName || 'Database';
  const databaseType = project.databaseType || options.dialectName || 'Standard DBML';
  // 日本語コメント: 初期表示言語と日英双方の作成日時を生成
  const defaultLang = options.lang === 'en' ? 'en' : 'ja';
  const now = new Date();
  const generatedDateJa = now.toLocaleString('ja-JP');
  const generatedDateEn = now.toLocaleString('en-US');
  const generatedDate = defaultLang === 'en' ? generatedDateEn : generatedDateJa;

  const tables = rawTables.map(table => {
    const rawFields = table.fields || table.columns || [];
    const fields = rawFields.map(field => {
      const typeStr = String(field.type?.type_name || field.type || 'varchar');
      // 日本語コメント: デフォルト値の参照は field.dbdefault を優先 (0 や false の falsy 判定漏れを防止)
      const rawDef = field.dbdefault !== undefined ? field.dbdefault : field.default;
      const defaultValue = rawDef !== undefined && rawDef !== null && rawDef !== ''
        ? (typeof rawDef === 'object' ? (rawDef.value !== undefined ? String(rawDef.value) : String(rawDef)) : String(rawDef))
        : '';

      const isPk = Boolean(field.pk || (field.settings && (field.settings.pk || field.settings.primaryKey)));
      const isUnique = Boolean(field.unique);
      const isNotNull = Boolean(field.not_null || field.notNull);

      // 日本語コメント: v2 の endpoints 構造 (endpoints[0]=from, endpoints[1]=to) に対応
      let fkTargetTable = '';
      let fkTargetField = '';
      const fk = refs.find(r => {
        if (r.endpoints && r.endpoints.length >= 2) {
          const epFrom = r.endpoints[0];
          return (epFrom.tableName === table.name) &&
            Array.isArray(epFrom.fieldNames) && epFrom.fieldNames.includes(field.name);
        }
        return (r.fromTable === table.name || r.from?.table === table.name) &&
          ((r.fromFields && r.fromFields.includes(field.name)) || (r.from?.fields && r.from.fields.includes(field.name)));
      });

      if (fk) {
        if (fk.endpoints && fk.endpoints.length >= 2) {
          const epTo = fk.endpoints[1];
          fkTargetTable = epTo.tableName || '';
          const toFields = epTo.fieldNames || [];
          fkTargetField = Array.isArray(toFields) ? toFields.join(',') : String(toFields);
        } else {
          fkTargetTable = fk.toTable || fk.to?.table || '';
          const toFields = fk.toFields || fk.to?.fields || [];
          fkTargetField = Array.isArray(toFields) ? toFields.join(',') : String(toFields);
        }
      }

      const constraints = [];
      if (isPk) constraints.push('PK');
      if (fkTargetTable) constraints.push('FK');
      if (isUnique) constraints.push('UQ');
      if (isNotNull) constraints.push('NN');

      return {
        name: String(field.name || ''),
        logicalName: String(field.logicalName || ''),
        type: typeStr,
        defaultValue,
        note: String(field.note || field.description || ''),
        isPk,
        isFk: Boolean(fkTargetTable),
        isUnique,
        isNotNull,
        constraints,
        fkTargetTable: String(fkTargetTable),
        fkTargetField: String(fkTargetField)
      };
    });

    const indexes = (table.indexes || []).map(idx => {
      const cols = (idx.columns || idx.fields || []).map(c => typeof c === 'object' ? (c.value || c.name) : String(c)).join(', ');
      const isUnique = Boolean(idx.unique || idx.type === 'unique');
      const isPkIndex = Boolean(idx.pk || idx.type === 'primary');
      const idxType = isPkIndex ? 'PRIMARY' : isUnique ? 'UNIQUE' : 'INDEX';
      return {
        name: String(idx.name || 'unnamed_index'),
        type: idxType,
        isPkIndex,
        isUnique,
        columns: cols
      };
    });

    const checks = (table.checks || []).map(chk => ({
      name: String(chk.name || '-'),
      expression: String(chk.expression || '')
    }));

    return {
      name: String(table.name || ''),
      logicalName: String(table.logicalName || ''),
      note: String(table.note || table.description || ''),
      fields,
      indexes,
      checks
    };
  });

  const totalTables = tables.length;
  const totalColumns = tables.reduce((acc, t) => acc + t.fields.length, 0);
  const totalRefs = refs.length;

  return {
    projectName: String(projectName),
    databaseType: String(databaseType),
    generatedDate,
    generatedDateJa,
    generatedDateEn,
    defaultLang,
    totalTables,
    totalColumns,
    totalRefs,
    tables
  };
}

/**
 * HTMLデータ仕様書を生成（標準版：テーブルカード型）
 * @param {Object} schemaModel - { project, tables, refs }
 * @param {Object} options - { schemaName, dialectName, lang }
 * @returns {string} 完全なスタンドアロン HTML 文字列
 */
export function generateHtmlDoc(schemaModel = {}, options = {}) {
  const docModel = extractSchemaDocModel(schemaModel, options);
  const {
    projectName,
    databaseType,
    generatedDateJa,
    generatedDateEn,
    defaultLang,
    totalTables,
    totalColumns,
    totalRefs,
    tables
  } = docModel;
  const initDate = defaultLang === 'en' ? generatedDateEn : generatedDateJa;

  // 1. サイドバー用テーブルリストのHTML
  const navItemsHtml = tables.map(table => {
    const tableName = escapeHtml(table.name);
    const logicalName = escapeHtml(table.logicalName);
    return `
      <li class="nav-item" data-table="${tableName}" data-logical="${logicalName}">
        <a href="#table-${tableName}">
          <div class="nav-table-name">${tableName}</div>
          ${logicalName ? `<div class="nav-table-logical">${logicalName}</div>` : ''}
        </a>
      </li>
    `;
  }).join('');

  // 2. メインコンテンツ用テーブルセクション群のHTML
  const tableSectionsHtml = tables.map(table => {
    const tableName = escapeHtml(table.name);
    const logicalName = escapeHtml(table.logicalName);
    const tableDesc = escapeHtml(table.note);
    const fields = table.fields;
    const indexes = table.indexes;
    const checks = table.checks;

    // カラム行のHTML生成
    const fieldsRowsHtml = fields.map(field => {
      const fieldName = escapeHtml(field.name);
      const fieldLogical = escapeHtml(field.logicalName);
      const typeStr = escapeHtml(field.type);
      const defVal = escapeHtml(field.defaultValue);
      const desc = escapeHtml(field.note);

      // 制約バッジ群
      const badges = [];
      if (field.isPk) badges.push('<span class="badge badge-pk" title="Primary Key">PK</span>');
      if (field.fkTargetTable) badges.push('<span class="badge badge-fk" title="Foreign Key">FK</span>');
      if (field.isUnique) badges.push('<span class="badge badge-uq" title="Unique">UQ</span>');
      if (field.isNotNull) badges.push('<span class="badge badge-nn" title="Not Null">NN</span>');

      return `
        <tr>
          <td><strong class="col-name">${fieldName}</strong></td>
          <td>${fieldLogical || '<span class="text-muted">-</span>'}</td>
          <td><span class="data-type">${typeStr}</span></td>
          <td>${badges.length ? badges.join('') : '<span class="text-muted">-</span>'}</td>
          <td>${defVal ? `<code>${defVal}</code>` : '<span class="text-muted">-</span>'}</td>
          <td>
            ${desc ? `<div class="field-desc">${desc}</div>` : ''}
            ${field.fkTargetTable ? `
              <div class="fk-link-container">
                <span class="fk-arrow">➔</span>
                <a href="#table-${escapeHtml(field.fkTargetTable)}" class="fk-link">
                  ${escapeHtml(field.fkTargetTable)}.${escapeHtml(field.fkTargetField)}
                </a>
              </div>
            ` : ''}
            ${!desc && !field.fkTargetTable ? '<span class="text-muted">-</span>' : ''}
          </td>
        </tr>
      `;
    }).join('');

    // インデックスセクションのHTML生成 (存在する場合)
    let indexesHtml = '';
    if (indexes.length > 0) {
      const indexRowsHtml = indexes.map(idx => `
          <tr>
            <td><code>${escapeHtml(idx.name)}</code></td>
            <td><span class="badge ${idx.isPkIndex ? 'badge-pk' : idx.isUnique ? 'badge-uq' : 'badge-idx'}">${escapeHtml(idx.type)}</span></td>
            <td><code>${escapeHtml(idx.columns)}</code></td>
          </tr>
        `).join('');

      indexesHtml = `
        <div class="table-sub-section">
          <h4 class="sub-section-title" data-i18n="sectionIndexes" data-i18n-count="${indexes.length}">${escapeHtml(formatDocText(defaultLang, 'sectionIndexes', { count: indexes.length }))}</h4>
          <table class="data-table index-table">
            <thead>
              <tr>
                <th style="width: 35%;" data-i18n="idxColName">${escapeHtml(formatDocText(defaultLang, 'idxColName'))}</th>
                <th style="width: 20%;" data-i18n="idxColType">${escapeHtml(formatDocText(defaultLang, 'idxColType'))}</th>
                <th style="width: 45%;" data-i18n="idxColTarget">${escapeHtml(formatDocText(defaultLang, 'idxColTarget'))}</th>
              </tr>
            </thead>
            <tbody>
              ${indexRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    // 日本語コメント: Check制約セクションのHTML生成 (存在する場合)
    let checksHtml = '';
    if (checks && checks.length > 0) {
      const checkRowsHtml = checks.map(chk => {
        const chkName = escapeHtml(chk.name || '-');
        const chkExpr = escapeHtml(chk.expression || '');

        return `
          <tr>
            <td><code>${chkName}</code></td>
            <td><code>${chkExpr}</code></td>
          </tr>
        `;
      }).join('');

      checksHtml = `
        <div class="table-sub-section">
          <h4 class="sub-section-title" data-i18n="sectionChecks" data-i18n-count="${checks.length}">${escapeHtml(formatDocText(defaultLang, 'sectionChecks', { count: checks.length }))}</h4>
          <table class="data-table check-table">
            <thead>
              <tr>
                <th style="width: 35%;" data-i18n="chkColName">${escapeHtml(formatDocText(defaultLang, 'chkColName'))}</th>
                <th style="width: 65%;" data-i18n="chkColExpr">${escapeHtml(formatDocText(defaultLang, 'chkColExpr'))}</th>
              </tr>
            </thead>
            <tbody>
              ${checkRowsHtml}
            </tbody>
          </table>
        </div>
      `;
    }

    return `
      <section class="table-card" id="table-${tableName}" data-table="${tableName}">
        <div class="table-card-header">
          <div class="table-title-group">
            <h2 class="table-name">${tableName}</h2>
            ${logicalName ? `<span class="table-logical-name">${logicalName}</span>` : ''}
          </div>
          <span class="table-column-count" data-i18n="columnCount" data-i18n-count="${fields.length}">${escapeHtml(formatDocText(defaultLang, 'columnCount', { count: fields.length }))}</span>
        </div>

        ${tableDesc ? `
          <div class="table-desc-box">
            <span class="desc-icon">📝</span>
            <div class="desc-text">${tableDesc}</div>
          </div>
        ` : ''}

        <table class="data-table columns-table">
          <thead>
            <tr>
              <th style="width: 20%;" data-i18n="colPhysicalName">${escapeHtml(formatDocText(defaultLang, 'colPhysicalName'))}</th>
              <th style="width: 20%;" data-i18n="colLogicalName">${escapeHtml(formatDocText(defaultLang, 'colLogicalName'))}</th>
              <th style="width: 14%;" data-i18n="colDataType">${escapeHtml(formatDocText(defaultLang, 'colDataType'))}</th>
              <th style="width: 12%;" data-i18n="colConstraints">${escapeHtml(formatDocText(defaultLang, 'colConstraints'))}</th>
              <th style="width: 12%;" data-i18n="colDefaultValue">${escapeHtml(formatDocText(defaultLang, 'colDefaultValue'))}</th>
              <th style="width: 22%;" data-i18n="colDescAndRef">${escapeHtml(formatDocText(defaultLang, 'colDescAndRef'))}</th>
            </tr>
          </thead>
          <tbody>
            ${fieldsRowsHtml}
          </tbody>
        </table>

        ${indexesHtml}
        ${checksHtml}
      </section>
    `;
  }).join('');

  // 3. 全体HTMLテンプレート（CSS + JS インライン埋め込み）
  return `<!DOCTYPE html>
<html lang="${defaultLang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(formatDocText(defaultLang, 'pageTitle', { project: projectName }))}</title>
  <style>
    /* CSS 変数 (ダークテーマ標準) */
    :root {
      --bg-base: #0f141c;
      --bg-panel: #161c26;
      --bg-card: #1e2634;
      --bg-hover: #263143;
      --border-color: #303d52;
      --border-subtle: #202a3a;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --color-primary: #38bdf8;
      --color-primary-hover: #0ea5e9;
      --table-header-bg: #1a2230;
      
      --badge-pk: #facc15;
      --badge-pk-text: #1a1a1a;
      --badge-fk: #38bdf8;
      --badge-fk-text: #042f2e;
      --badge-uq: #c084fc;
      --badge-uq-text: #3b0764;
      --badge-nn: #fb923c;
      --badge-nn-text: #431407;
      --badge-idx: #64748b;
      --badge-idx-text: #f8fafc;
    }

    /* ライトテーマ */
    body.light-theme {
      --bg-base: #f8fafc;
      --bg-panel: #ffffff;
      --bg-card: #ffffff;
      --bg-hover: #f1f5f9;
      --border-color: #cbd5e1;
      --border-subtle: #e2e8f0;
      --text-main: #0f172a;
      --text-muted: #64748b;
      --color-primary: #0284c7;
      --color-primary-hover: #0369a1;
      --table-header-bg: #f1f5f9;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: var(--bg-base);
      color: var(--text-main);
      display: flex;
      height: 100vh;
      overflow: hidden;
      line-height: 1.5;
      transition: background-color 0.2s, color 0.2s;
    }

    /* 左サイドバー */
    .sidebar {
      width: 320px;
      background-color: var(--bg-panel);
      border-right: 1px solid var(--border-color);
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
    }

    .sidebar-header {
      padding: 16px;
      border-bottom: 1px solid var(--border-color);
    }

    .sidebar-brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 15px;
      font-weight: 700;
      color: var(--color-primary);
      margin-bottom: 12px;
    }

    .search-input {
      width: 100%;
      padding: 8px 12px;
      background-color: var(--bg-base);
      border: 1px solid var(--border-color);
      border-radius: 6px;
      color: var(--text-main);
      font-size: 13px;
      outline: none;
      transition: border-color 0.15s;
    }

    .search-input:focus {
      border-color: var(--color-primary);
    }

    .nav-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 8px;
      list-style: none;
    }

    .nav-header-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      color: var(--text-muted);
      padding: 8px 10px 4px 10px;
    }

    .nav-item {
      margin-bottom: 2px;
    }

    .nav-item a {
      display: flex;
      flex-direction: column;
      padding: 6px 10px;
      color: var(--text-main);
      text-decoration: none;
      border-radius: 6px;
      transition: background-color 0.12s;
    }

    .nav-item a:hover {
      background-color: var(--bg-hover);
    }

    .nav-table-name {
      font-size: 13px;
      font-weight: 600;
    }

    .nav-table-logical {
      font-size: 11px;
      color: var(--text-muted);
      margin-top: 1px;
    }

    /* メインエリア */
    .main-content {
      flex: 1;
      overflow-y: auto;
      padding: 30px 40px;
      scroll-behavior: smooth;
    }

    .doc-top-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--border-color);
      margin-bottom: 24px;
    }

    .doc-main-title {
      font-size: 24px;
      font-weight: 800;
      color: var(--text-main);
    }

    .doc-meta {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 4px;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .action-btn {
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      color: var(--text-main);
      padding: 7px 14px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.15s;
    }

    .action-btn:hover {
      background-color: var(--bg-hover);
      border-color: var(--color-primary);
    }

    /* 統計サマリー */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin-bottom: 32px;
    }

    .stats-card {
      background-color: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 8px;
      padding: 16px;
    }

    .stats-label {
      font-size: 11px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .stats-value {
      font-size: 24px;
      font-weight: 800;
      color: var(--color-primary);
      margin-top: 4px;
    }

    /* テーブルカード */
    .table-card {
      background-color: var(--bg-panel);
      border: 1px solid var(--border-color);
      border-radius: 10px;
      padding: 24px;
      margin-bottom: 32px;
      scroll-margin-top: 24px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
    }

    .table-card-header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
      margin-bottom: 16px;
    }

    .table-title-group {
      display: flex;
      align-items: baseline;
      gap: 12px;
    }

    .table-name {
      font-size: 20px;
      font-weight: 700;
      color: var(--color-primary);
    }

    .table-logical-name {
      font-size: 15px;
      font-weight: 500;
      color: var(--text-muted);
    }

    .table-column-count {
      font-size: 12px;
      color: var(--text-muted);
      background: var(--bg-card);
      padding: 3px 8px;
      border-radius: 12px;
      border: 1px solid var(--border-subtle);
    }

    .table-desc-box {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      background: var(--bg-card);
      border-left: 4px solid var(--color-primary);
      border-radius: 4px;
      padding: 10px 14px;
      margin-bottom: 18px;
      font-size: 13px;
    }

    .desc-icon {
      font-size: 14px;
    }

    /* データテーブル */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-top: 10px;
    }

    .data-table th,
    .data-table td {
      padding: 9px 12px;
      text-align: left;
      border-bottom: 1px solid var(--border-subtle);
      vertical-align: middle;
    }

    .data-table th {
      background-color: var(--table-header-bg);
      color: var(--text-muted);
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }

    .data-table tbody tr:hover {
      background-color: var(--bg-hover);
    }

    .col-name {
      color: var(--text-main);
    }

    .data-type {
      font-family: monospace;
      color: var(--color-primary);
      font-weight: 600;
      font-size: 12px;
    }

    .badge {
      display: inline-block;
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 9px;
      font-weight: 800;
      line-height: 1.1;
      margin-right: 4px;
    }

    .badge-pk { background: var(--badge-pk); color: var(--badge-pk-text); }
    .badge-fk { background: var(--badge-fk); color: var(--badge-fk-text); }
    .badge-uq { background: var(--badge-uq); color: var(--badge-uq-text); }
    .badge-nn { background: var(--badge-nn); color: var(--badge-nn-text); }
    .badge-idx { background: var(--badge-idx); color: var(--badge-idx-text); }

    .text-muted {
      color: var(--text-muted);
      font-size: 12px;
    }

    code {
      font-family: monospace;
      background: var(--bg-card);
      padding: 2px 5px;
      border-radius: 3px;
      font-size: 12px;
      border: 1px solid var(--border-subtle);
    }

    .field-desc {
      font-size: 12px;
      color: var(--text-main);
    }

    .fk-link-container {
      display: flex;
      align-items: center;
      gap: 4px;
      margin-top: 3px;
      font-size: 11px;
    }

    .fk-arrow {
      color: var(--color-primary);
    }

    .fk-link {
      color: var(--color-primary);
      text-decoration: none;
      font-family: monospace;
      font-weight: 600;
    }

    .fk-link:hover {
      text-decoration: underline;
    }

    /* インデックスサブセクション */
    .table-sub-section {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid var(--border-subtle);
    }

    .sub-section-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      margin-bottom: 8px;
    }

    /* 印刷スタイル */
    @media print {
      body {
        height: auto !important;
        overflow: visible !important;
        background: #ffffff !important;
        color: #000000 !important;
      }
      .sidebar, .top-actions {
        display: none !important;
      }
      .main-content {
        padding: 0 !important;
        overflow: visible !important;
      }
      .table-card {
        page-break-inside: avoid;
        box-shadow: none !important;
        border: 1px solid #ccc !important;
        background: #ffffff !important;
        color: #000000 !important;
        margin-bottom: 24px !important;
      }
      .table-name { color: #0369a1 !important; }
      .data-table th { background: #f1f5f9 !important; color: #333 !important; }
      .data-table td { border-bottom: 1px solid #ddd !important; }
      .data-type, .fk-link { color: #0284c7 !important; }
    }
  </style>
</head>
<body>

  <!-- サイドバー -->
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="sidebar-brand">
        <span>📘</span>
        <span>Data Dictionary</span>
      </div>
      <input type="text" class="search-input" id="tableSearch" placeholder="${escapeHtml(formatDocText(defaultLang, 'searchPlaceholderCard'))}" data-i18n-placeholder="searchPlaceholderCard" />
    </div>
    <ul class="nav-list" id="navList">
      <li class="nav-header-label">TABLES (${totalTables})</li>
      ${navItemsHtml}
    </ul>
  </aside>

  <!-- メインコンテンツ -->
  <main class="main-content">
    <div class="doc-top-bar">
      <div>
        <h1 class="doc-main-title" id="docMainTitle">${escapeHtml(formatDocText(defaultLang, 'mainTitle', { project: projectName }))}</h1>
        <div class="doc-meta" id="docMeta">${escapeHtml(formatDocText(defaultLang, 'metaLine', { date: initDate, db: databaseType }))}</div>
      </div>
      <div class="top-actions">
        <button type="button" class="action-btn" id="btnToggleLang">${escapeHtml(formatDocText(defaultLang, 'btnToggleLang'))}</button>
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

    <!-- テーブル定義一覧 -->
    <div id="tableSectionContainer">
      ${tableSectionsHtml}
    </div>
  </main>

  <script>
    // 0. 翻訳辞書とメタ情報・多言語化関数 (docT)
    const I18N = ${safeJsonForScript(HTML_DOC_I18N)};
    const DOC_META = ${safeJsonForScript({ projectName, databaseType, generatedDateJa, generatedDateEn, defaultLang })};

    let currentLang = DOC_META.defaultLang === 'en' ? 'en' : 'ja';
    try {
      const savedLang = localStorage.getItem('dbml_doc_lang');
      if (savedLang === 'ja' || savedLang === 'en') {
        currentLang = savedLang;
      }
    } catch {}

    function docT(key, params) {
      const dict = I18N[currentLang] || I18N.ja;
      let text = (dict && dict[key] !== undefined)
        ? dict[key]
        : (I18N.ja && I18N.ja[key] !== undefined ? I18N.ja[key] : key);
      if (params && typeof params === 'object') {
        text = String(text).replace(/\\{(\\w+)\\}/g, (_, paramKey) => {
          return Object.prototype.hasOwnProperty.call(params, paramKey)
            ? String(params[paramKey])
            : '{' + paramKey + '}';
        });
      }
      return String(text);
    }

    // 1. テーマ切り替え機能 (localStorage で保持)
    const btnToggleTheme = document.getElementById('btnToggleTheme');
    let savedTheme = null;
    try {
      savedTheme = localStorage.getItem('dbml_doc_theme');
    } catch {}
    let hasSavedTheme = savedTheme === 'light' || savedTheme === 'dark';
    if (savedTheme === 'light') {
      document.body.classList.add('light-theme');
    }

    function updateThemeButtonLabel() {
      if (!btnToggleTheme) return;
      const isLight = document.body.classList.contains('light-theme');
      btnToggleTheme.textContent = isLight
        ? docT('btnThemeLight')
        : (hasSavedTheme ? docT('btnThemeDark') : docT('btnToggleThemeDefault'));
    }

    if (btnToggleTheme) {
      btnToggleTheme.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        hasSavedTheme = true;
        try {
          localStorage.setItem('dbml_doc_theme', isLight ? 'light' : 'dark');
        } catch {}
        updateThemeButtonLabel();
      });
    }

    // 2. 表示言語切り替え機能 (日本語 / English)
    const docMainTitleEl = document.getElementById('docMainTitle');
    const docMetaEl = document.getElementById('docMeta');
    const btnToggleLang = document.getElementById('btnToggleLang');

    function applyLang(lang) {
      currentLang = lang === 'en' ? 'en' : 'ja';
      document.documentElement.lang = currentLang;
      document.title = docT('pageTitle', { project: DOC_META.projectName });

      if (docMainTitleEl) {
        docMainTitleEl.textContent = docT('mainTitle', { project: DOC_META.projectName });
      }
      if (docMetaEl) {
        const displayDate = currentLang === 'en' ? DOC_META.generatedDateEn : DOC_META.generatedDateJa;
        docMetaEl.textContent = docT('metaLine', { date: displayDate, db: DOC_META.databaseType });
      }
      if (btnToggleLang) {
        btnToggleLang.textContent = docT('btnToggleLang');
      }

      document.querySelectorAll('[data-i18n]').forEach((el) => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;
        const countAttr = el.getAttribute('data-i18n-count');
        if (countAttr !== null) {
          el.textContent = docT(key, { count: countAttr });
        } else {
          el.textContent = docT(key);
        }
      });

      document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (key) {
          el.setAttribute('placeholder', docT(key));
        }
      });

      document.querySelectorAll('[data-i18n-title]').forEach((el) => {
        const key = el.getAttribute('data-i18n-title');
        if (key) {
          el.setAttribute('title', docT(key));
        }
      });

      updateThemeButtonLabel();
    }

    if (btnToggleLang) {
      btnToggleLang.addEventListener('click', () => {
        const nextLang = currentLang === 'ja' ? 'en' : 'ja';
        try {
          localStorage.setItem('dbml_doc_lang', nextLang);
        } catch {}
        applyLang(nextLang);
      });
    }

    // 3. 印刷 / PDF保存
    const btnPrint = document.getElementById('btnPrint');
    if (btnPrint) {
      btnPrint.addEventListener('click', () => {
        window.print();
      });
    }

    // 4. リアルタイム・インクリメンタル高速検索フィルター (カラム検索時もサイドバーを連動)
    const searchInput = document.getElementById('tableSearch');
    const navItems = document.querySelectorAll('#navList .nav-item');
    const tableCards = document.querySelectorAll('#tableSectionContainer .table-card');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase().trim();
        const visibleTables = new Set();

        // 各テーブルカードのフィルタリング
        tableCards.forEach(card => {
          const text = card.textContent.toLowerCase();
          const tbl = card.getAttribute('data-table') || '';
          if (!q || text.includes(q)) {
            card.style.display = 'block';
            visibleTables.add(tbl);
          } else {
            card.style.display = 'none';
          }
        });

        // サイドバー項目のフィルタリング（カード表示結果と同期）
        navItems.forEach(item => {
          const tableName = item.getAttribute('data-table') || '';
          const logicalName = (item.getAttribute('data-logical') || '').toLowerCase();
          if (!q || visibleTables.has(tableName) || tableName.toLowerCase().includes(q) || logicalName.includes(q)) {
            item.style.display = 'block';
          } else {
            item.style.display = 'none';
          }
        });
      });
    }

    // 5. 初期表示言語を適用
    applyLang(currentLang);
  </script>
</body>
</html>`;
}
