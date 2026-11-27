// 日本語コメント: v1完全準拠テーブル編集画面コンポーネント (src/components/table-editor/table-editor-view.js)
// 6タブ構成（テーブル、カラム、PK、インデックス、FK、Check）、2ペインMaster-Detail UI、
// Undo/Redo履歴管理、リアルタイムバリデーション、列幅リサイズ、および拡張メタデータ管理を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { DraftManager } from '../../core/draft-manager.js';
import { generateDbml } from '../../core/dbml-generator.js';
import { TABLE_COLOR_PRESETS } from '../../core/table-colors.js';
import './table-editor-view.css';

/**
 * 日本語コメント: HTML属性値のエスケープヘルパー
 */
function escapeAttr(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 日本語コメント: HTML表示用のエスケープヘルパー
 */
function escapeHtml(val) {
  if (val === null || val === undefined) return '';
  return String(val)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 日本語コメント: 型文字列（VARCHAR2(50)等）を baseType, length, scale に分解
 */
function splitFieldType(rawType) {
  if (!rawType) return { baseType: 'varchar', length: '', scale: '' };
  const str = String(rawType).trim();
  const baseType = str.replace(/\(.*?\)/, '').trim() || str;
  const parenMatch = str.match(/\(([^)]+)\)/);
  let length = '';
  let scale = '';
  if (parenMatch) {
    const parts = parenMatch[1].split(',').map(s => s.trim());
    length = parts[0] || '';
    scale = parts[1] || '';
  }
  return { baseType, length, scale };
}

/**
 * 日本語コメント: データ型の引数対応状況（桁数・精度が指定可能か）を判定
 */
function getTypeCapability(typeName, dialect) {
  if (!typeName) return { hasLength: false, hasScale: false };
  const upper = String(typeName).trim().toUpperCase();
  const dt = (dialect?.dataTypes || []).find(d => (d.name || '').toUpperCase() === upper);
  if (dt) {
    return {
      hasLength: Boolean(dt.hasLength || dt.hasPrecision),
      hasScale: Boolean(dt.hasScale),
    };
  }
  // フォールバック判定 (方言定義に無いカスタム型用)
  const isNumeric = /^(NUMBER|DECIMAL|NUMERIC|FLOAT|DOUBLE)/i.test(upper);
  const isString = /^(VARCHAR|VARCHAR2|CHAR|NVARCHAR|NVARCHAR2|RAW)/i.test(upper);
  return {
    hasLength: isNumeric || isString,
    hasScale: isNumeric,
  };
}

/**
 * 日本語コメント: テーブル列のドラッグリサイズを初期化
 */
function initResizableColumns(tableEl) {
  if (!tableEl) return;
  const thList = tableEl.querySelectorAll('th');
  thList.forEach((th, i) => {
    // 最終列や特定列以外にリサイザーを付加
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

export class DbeTableEditorView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentTable = null;
    this.isNew = false;

    // 内部状態
    this._draftManager = null;
    this.activeTab = 'table'; // 'table' | 'column' | 'pk' | 'index' | 'fk' | 'check'
    this._selectedColumnIndex = 0;
    this._selectedIndexIndex = 0;
    this._selectedFkIndex = 0;
    this._selectedCheckIndex = 0;
    this._errors = { table: null, columns: {}, columnTypes: {}, columnLengths: {}, columnScales: {}, indexes: {}, fks: {}, checks: {}, dbmlParse: null };
    this._errorItems = [];
    this._tabErrorCounts = {};

    // 日本語コメント: カラム設計メタデータの表示/非表示状態 (localStorage 永続化)
    this._colMetaVisibility = this._loadColMetaVisibility();
    this._showColMetaSettings = false;

    // グローバルキーボードショートカット (Ctrl+Z / Ctrl+Y)
    this._onKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (e.key === 'z' || e.key === 'Z') {
          if (e.shiftKey) {
            this.handleRedo();
          } else {
            this.handleUndo();
          }
          e.preventDefault();
        } else if (e.key === 'y' || e.key === 'Y') {
          this.handleRedo();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', this._onKeyDown);

    this.render();
  }

  /**
   * カラムメタデータ項目の表示/非表示設定を localStorage からロード
   * @returns {Record<string, boolean>}
   */
  _loadColMetaVisibility() {
    try {
      const saved = localStorage.getItem('dbml_col_meta_visibility');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.warn('Failed to load column metadata visibility:', e);
    }
    // デフォルト表示設定（基本メタデータはすべてON）
    return {
      definition: true,
      domainName: true,
      defaultName: true,
      columnNote: true,
    };
  }

  /**
   * カラムメタデータ項目の表示/非表示設定を localStorage へ保存
   */
  _saveColMetaVisibility() {
    try {
      localStorage.setItem('dbml_col_meta_visibility', JSON.stringify(this._colMetaVisibility));
    } catch (e) {
      console.warn('Failed to save column metadata visibility:', e);
    }
  }

  /**
   * 対象カラムで利用可能なメタデータ属性（定義済みスキーマ＋独自カスタム属性）を抽出
   * @param {Object} col
   * @returns {Array<{key: string, label: string, type: string, description?: string, isCustom?: boolean}>}
   */
  getAvailableColumnAttributes(col) {
    const dialect = appStore.state.activeDialect;
    const currentDialect = dialect?.id || appStore.state.project?.databaseType || 'standard';
    const schemas = metadataManager.getColumnAttributes(currentDialect) || [];

    const attrMap = new Map();
    schemas.forEach(schema => {
      attrMap.set(schema.key, {
        key: schema.key,
        label: metadataManager.resolveLabel(schema),
        type: schema.type || 'text',
        description: schema.description || '',
        isCustom: false,
      });
    });

    // カラムの custom オブジェクトに保存されている属性のうち、スキーマ未定義のものをカスタム属性として追加
    if (col && col.custom) {
      Object.keys(col.custom).forEach(k => {
        if (!attrMap.has(k)) {
          attrMap.set(k, {
            key: k,
            label: k,
            type: 'text',
            // 日本語コメント: i18n対応した独自カスタム属性の説明
            description: t('table_editor.custom_attribute_desc'),
            isCustom: true,
          });
        }
      });
    }

    return Array.from(attrMap.values());
  }

  /**
   * 現在のドラフトオブジェクトの直接参照を取得
   */
  get draft() {
    return this._draftManager ? this._draftManager.getData() : null;
  }

  /**
   * 編集履歴を1ステップ進める (Undo/Redo用)
   */
  pushHistory() {
    if (this._draftManager) {
      this._draftManager.pushHistory();
      this.updateHistoryButtons();
      this.validateAll();
    }
  }

  /**
   * 編集対象テーブルをセットしてフォームを初期化
   * @param {Object|null} tableData - null の場合は新規テーブル作成
   */
  setTable(tableData) {
    this.isNew = !tableData;
    this.currentTable = tableData;
    this.activeTab = 'table';
    this._selectedColumnIndex = 0;
    this._selectedIndexIndex = 0;
    this._selectedFkIndex = 0;
    this._selectedCheckIndex = 0;
    this._errors = { table: null, columns: {}, columnTypes: {}, columnLengths: {}, columnScales: {}, indexes: {}, fks: {}, checks: {}, dbmlParse: null };
    this._errorItems = [];
    this._tabErrorCounts = {};

    const dialect = appStore.state.activeDialect;
    const defaultPkType = dialect?.dataTypes?.some(d => d.name === 'NUMBER')
      ? { baseType: 'NUMBER', length: '10', type: 'NUMBER(10)' }
      : { baseType: 'int', length: '', type: 'int' };

    let draftJson;

    if (tableData) {
      // 既存テーブルのクローン
      const cloned = JSON.parse(JSON.stringify(tableData));

      // フィールド情報の正規化
      const fields = (cloned.fields || []).map(f => {
        let baseType = f.baseType;
        let length = f.length;
        let scale = f.scale;
        if (!baseType && f.type) {
          const parsed = splitFieldType(f.type);
          baseType = parsed.baseType;
          length = parsed.length;
          scale = parsed.scale;
        }
        return {
          ...f,
          name: f.name || '',
          logicalName: f.logicalName || '',
          // 日本語コメント: データ型未指定時のフォールバックは DBML 構文エラーにならない unknown とする
          baseType: baseType || f.type || (f.pk ? defaultPkType.baseType : 'unknown'),
          length: length !== undefined && length !== null ? String(length) : '',
          scale: scale !== undefined && scale !== null ? String(scale) : '',
          type: f.type || baseType || '',
          pk: Boolean(f.pk),
          not_null: Boolean(f.not_null || f.pk),
          unique: Boolean(f.unique),
          increment: Boolean(f.increment),
          dbdefault: f.dbdefault !== undefined ? f.dbdefault : null,
          note: f.note || '',
          custom: f.custom ? { ...f.custom } : {},
        };
      });

      // PKインデックスの復元
      const existingPkIndex = (cloned.indexes || []).find(idx => idx.pk || idx.isPrimaryKey);
      let pkOrder = [];
      if (Array.isArray(cloned.pkOrder) && cloned.pkOrder.length > 0) {
        pkOrder = [...cloned.pkOrder];
      } else if (existingPkIndex && Array.isArray(existingPkIndex.columns)) {
        pkOrder = existingPkIndex.columns.map(c => typeof c === 'object' && c !== null ? (c.value || c.name || '') : String(c)).filter(Boolean);
      } else {
        pkOrder = fields.filter(f => f.pk).map(f => f.name);
      }

      const pkName = cloned.pkName || (existingPkIndex ? existingPkIndex.name : `PK_${cloned.name}`);

      // PK以外の通常インデックスの抽出
      const indexes = (cloned.indexes || [])
        .filter(idx => !idx.pk && !idx.isPrimaryKey)
        .map(idx => ({
          name: idx.name || '',
          type: idx.type || 'btree',
          unique: Boolean(idx.unique),
          note: idx.note || '',
          columns: (idx.columns || []).map(c => {
            if (typeof c === 'object' && c !== null) {
              return { value: c.value || c.name || '', type: c.type || 'column' };
            }
            const strVal = String(c || '');
            const isExpr = strVal.includes('(') || strVal.startsWith('`');
            const cleanVal = strVal.replace(/^`|`$/g, '');
            return { value: cleanVal, type: isExpr ? 'expression' : 'column' };
          }),
        }));

      // Check制約
      const checks = (cloned.checks || []).map(c => ({
        name: c.name || '',
        expression: c.expression || '',
      }));

      // 自テーブルが参照元の Ref (外部キー) を抽出
      const refs = (appStore.state.refs || [])
        .filter(r => r.endpoints?.[0]?.tableName === cloned.name)
        .map(r => JSON.parse(JSON.stringify(r)));

      draftJson = {
        name: cloned.name || '',
        logicalName: cloned.logicalName || '',
        headerColor: cloned.headerColor || cloned.headercolor || '',
        note: cloned.note || '',
        custom: cloned.custom ? { ...cloned.custom } : {},
        fields,
        pkName,
        pkOrder,
        indexes,
        checks,
        refs,
      };
    } else {
      // 新規テーブル作成時の初期ドラフト
      draftJson = {
        name: 'NEW_TABLE',
        logicalName: '',
        headerColor: '',
        note: '',
        custom: {},
        fields: [
          {
            name: 'ID',
            logicalName: 'ID',
            baseType: defaultPkType.baseType,
            length: defaultPkType.length || '',
            scale: '',
            type: defaultPkType.type,
            pk: true,
            not_null: true,
            unique: false,
            increment: true,
            dbdefault: null,
            note: '',
            custom: {},
          },
        ],
        pkName: 'PK_NEW_TABLE',
        pkOrder: ['ID'],
        indexes: [],
        checks: [],
        refs: [],
      };
    }

    this._draftManager = new DraftManager(draftJson);
    this.render();
    this.validateAll();
  }

  /**
   * baseType, length, scale から合成型文字列 (type) を再計算
   */
  syncFieldTypeString(idx) {
    if (!this.draft || !this.draft.fields[idx]) return;
    const f = this.draft.fields[idx];
    const base = (f.baseType || f.type || 'varchar').replace(/\(.*?\)/, '').trim() || 'varchar';
    const len = f.length !== undefined && f.length !== null ? String(f.length).trim() : '';
    const sc = f.scale !== undefined && f.scale !== null ? String(f.scale).trim() : '';
    if (len && sc) {
      f.type = `${base}(${len}, ${sc})`;
    } else if (len) {
      f.type = `${base}(${len})`;
    } else {
      f.type = base;
    }
  }

  /**
   * テーブル全体および全タブのバリデーションを実行
   */
  validateAll() {
    if (!this.draft) return true;
    const dialect = appStore.state.activeDialect;
    const errors = {
      table: null,
      columns: {},
      columnTypes: {},
      columnLengths: {},
      columnScales: {},
      indexes: {},
      fks: {},
      checks: {},
      dbmlParse: null,
    };
    const errorItems = [];
    const tabCounts = { table: 0, column: 0, pk: 0, index: 0, fk: 0, check: 0 };
    let hasError = false;

    const addErrorItem = (tab, label, message, index = null, focusSelector = null) => {
      errorItems.push({ tab, label, message, index, focusSelector });
      tabCounts[tab] = (tabCounts[tab] || 0) + 1;
    };

    // 1. テーブル名バリデーション
    const tblName = (this.draft.name || '').trim();
    if (!tblName) {
      errors.table = t('table_editor.err_name_required');
      addErrorItem('table', t('table_editor.tab_table'), errors.table, null, '#tableNameInput');
      hasError = true;
    } else if (/[\s"'`\\]/.test(tblName)) {
      // 日本語コメント: 空白・引用符混入によるDBML構文破壊を防止
      errors.table = t('table_editor.err_table_name_invalid');
      addErrorItem('table', t('table_editor.tab_table'), errors.table, null, '#tableNameInput');
      hasError = true;
    } else {
      // 重複チェック（自分自身を除く）
      const existing = (appStore.state.tables || []).find(t =>
        t.name.toUpperCase() === tblName.toUpperCase() &&
        (this.isNew || t.name.toUpperCase() !== (this.currentTable?.name || '').toUpperCase())
      );
      if (existing) {
        errors.table = t('table_editor.err_table_exists', { name: tblName });
        addErrorItem('table', t('table_editor.tab_table'), errors.table, null, '#tableNameInput');
        hasError = true;
      } else if (dialect) {
        const issues = dialect.validateIdentifier(tblName, 'table');
        const lenIssue = issues.find(i => i.type === 'length_exceeded');
        if (lenIssue) {
          errors.table = t('dialect.warning_identifier_length', {
            dbms: dialect.displayName,
            type: t('dialect.type_table'),
            max: lenIssue.max,
            current: lenIssue.current,
          });
        }
      }
    }

    // 2. カラムバリデーション（名前・データ型・桁数・精度）
    const colNamesSeen = new Map();
    const validColNames = new Set();
    (this.draft.fields || []).forEach((f, i) => {
      const colName = (f.name || '').trim();
      const colLabel = colName || `#${i + 1}`;
      if (!colName) {
        errors.columns[i] = t('table_editor.err_col_name_required');
        addErrorItem('column', colLabel, errors.columns[i], i, '#colName');
        hasError = true;
      } else if (/[\s"'`\\]/.test(colName)) {
        errors.columns[i] = t('table_editor.err_col_name_invalid');
        addErrorItem('column', colLabel, errors.columns[i], i, '#colName');
        hasError = true;
      } else {
        const upper = colName.toUpperCase();
        validColNames.add(upper);
        if (colNamesSeen.has(upper)) {
          const dupMsg = t('table_editor.err_col_name_duplicate', { name: colName });
          errors.columns[i] = dupMsg;
          errors.columns[colNamesSeen.get(upper)] = dupMsg;
          addErrorItem('column', colLabel, dupMsg, i, '#colName');
          hasError = true;
        } else {
          colNamesSeen.set(upper, i);
          if (dialect) {
            const issues = dialect.validateIdentifier(colName, 'column');
            const lenIssue = issues.find(i => i.type === 'length_exceeded');
            if (lenIssue) {
              errors.columns[i] = t('dialect.warning_identifier_length', {
                dbms: dialect.displayName,
                type: t('dialect.type_column'),
                max: lenIssue.max,
                current: lenIssue.current,
              });
            }
          }
        }
      }

      // データ型チェック
      const colBaseType = (f.baseType || '').trim();
      if (!colBaseType) {
        errors.columnTypes[i] = t('table_editor.err_col_type_required');
        addErrorItem('column', colLabel, errors.columnTypes[i], i, '#colDataType');
        hasError = true;
      } else if (/[\s"'`()\\]/.test(colBaseType)) {
        // 日本語コメント: データ型欄への括弧や空白混入を防止
        errors.columnTypes[i] = t('table_editor.err_col_type_invalid');
        addErrorItem('column', colLabel, errors.columnTypes[i], i, '#colDataType');
        hasError = true;
      }

      // 桁数・精度チェック
      const lenStr = f.length !== undefined && f.length !== null ? String(f.length).trim() : '';
      const scaleStr = f.scale !== undefined && f.scale !== null ? String(f.scale).trim() : '';
      if (lenStr && !/^[1-9]\d*$/.test(lenStr)) {
        errors.columnLengths[i] = t('table_editor.err_col_length_invalid');
        addErrorItem('column', colLabel, errors.columnLengths[i], i, '#colLength');
        hasError = true;
      }
      if (scaleStr) {
        if (!lenStr) {
          errors.columnScales[i] = t('table_editor.err_col_scale_without_length');
          addErrorItem('column', colLabel, errors.columnScales[i], i, '#colScale');
          hasError = true;
        } else if (!/^\d+$/.test(scaleStr)) {
          errors.columnScales[i] = t('table_editor.err_col_scale_invalid');
          addErrorItem('column', colLabel, errors.columnScales[i], i, '#colScale');
          hasError = true;
        }
      }
    });

    // 3. インデックスバリデーション
    const idxNamesSeen = new Map();
    (this.draft.indexes || []).forEach((idx, i) => {
      if (idx.pk) return;
      const idxName = (idx.name || '').trim();
      const idxLabel = idxName || `IDX_${i + 1}`;
      if (idxName) {
        const upper = idxName.toUpperCase();
        if (idxNamesSeen.has(upper)) {
          const msg = t('table_editor.err_idx_name_duplicate', { name: idxName });
          errors.indexes[i] = msg;
          errors.indexes[idxNamesSeen.get(upper)] = msg;
          addErrorItem('index', idxLabel, msg, i, '#idxName');
          hasError = true;
        } else {
          idxNamesSeen.set(upper, i);
        }
      }
      if (!idx.columns || idx.columns.length === 0) {
        const msg = t('table_editor.err_idx_columns_required');
        if (!errors.indexes[i]) errors.indexes[i] = msg;
        addErrorItem('index', idxLabel, msg, i, '#rightIdxList');
        hasError = true;
      }
    });

    // 4. 外部キー (FK) バリデーション（サーバ側パース検証にFKを含めないためクライアント側で正常性を担保）
    (this.draft.refs || []).forEach((ref, i) => {
      const localEp = (ref.endpoints || [])[0] || {};
      const foreignEp = (ref.endpoints || [])[1] || {};
      const localCol = (localEp.fieldNames?.[0] || '').trim();
      const foreignTable = (foreignEp.tableName || '').trim();
      const foreignCol = (foreignEp.fieldNames?.[0] || '').trim();
      const fkLabel = (ref.name || '').trim() || `FK_${i + 1}`;

      if (!localCol || !foreignTable || !foreignCol) {
        errors.fks[i] = t('table_editor.err_fk_incomplete');
        addErrorItem('fk', fkLabel, errors.fks[i], i, !foreignTable ? '#fkForeignTable' : '#fkForeignCol');
        hasError = true;
      } else if (!validColNames.has(localCol.toUpperCase())) {
        errors.fks[i] = t('table_editor.err_fk_local_col_missing', { col: localCol });
        addErrorItem('fk', fkLabel, errors.fks[i], i, '#fkLocalCol');
        hasError = true;
      }
    });

    // 5. Check 制約バリデーション
    (this.draft.checks || []).forEach((c, i) => {
      const chkLabel = (c.name || '').trim() || `CHK_${i + 1}`;
      if (!(c.expression || '').trim()) {
        errors.checks[i] = t('table_editor.err_check_expr_required');
        addErrorItem('check', chkLabel, errors.checks[i], i, '#chkExpr');
        hasError = true;
      }
    });

    this._errors = errors;
    this._errorItems = errorItems;
    this._tabErrorCounts = tabCounts;

    this.updateErrorUI();

    return !hasError;
  }

  /**
   * タブバッジ・エラーサマリーバナー・保存ボタン状態の更新
   */
  updateErrorUI() {
    if (!this.element) return;
    const errorItems = this._errorItems || [];
    const tabCounts = this._tabErrorCounts || {};
    const hasBlockingError = errorItems.length > 0 || Boolean(this._errors?.dbmlParse);

    // タブバーのエラー件数バッジを更新
    this.element.querySelectorAll('.tab-btn').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      const count = tabCounts[tab] || 0;
      let badge = btn.querySelector('.tab-err-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'tab-err-badge';
          btn.appendChild(badge);
        }
        badge.textContent = String(count);
      } else if (badge) {
        badge.remove();
      }
    });

    // エラーサマリーバナーを更新
    const banner = this.element.querySelector('#editorErrorBanner');
    if (banner) {
      if (!hasBlockingError) {
        banner.style.display = 'none';
        banner.innerHTML = '';
      } else {
        banner.style.display = 'flex';
        const titleText = this._errors?.dbmlParse
          ? escapeHtml(this._errors.dbmlParse)
          : escapeHtml(t('table_editor.err_banner_title', { count: errorItems.length }));
        const chipsHtml = errorItems.map((item, idx) => `
          <button type="button" class="editor-error-chip" data-err-idx="${idx}">
            <span>⚠️</span>
            <b>[${escapeHtml(item.label)}]</b>
            <span>${escapeHtml(item.message)}</span>
          </button>
        `).join('');
        banner.innerHTML = `
          <div class="editor-error-banner-title">⚠️ ${titleText}</div>
          ${chipsHtml ? `<div class="editor-error-chips">${chipsHtml}</div>` : ''}
        `;
        banner.querySelectorAll('.editor-error-chip').forEach(chip => {
          chip.addEventListener('click', () => {
            const idx = Number(chip.getAttribute('data-err-idx'));
            const item = errorItems[idx];
            if (item) this.jumpToError(item);
          });
        });
      }
    }

    // 保存ボタンの活性/非活性・理由ツールチップを更新
    const saveBtns = this.element.querySelectorAll('#btn-editor-save, #btn-editor-save-footer');
    saveBtns.forEach(btn => {
      btn.disabled = errorItems.length > 0;
      btn.title = errorItems.length > 0
        ? t('table_editor.err_save_disabled_tip', { count: errorItems.length })
        : '';
    });
  }

  /**
   * エラー該当箇所（タブ・行・入力欄）へジャンプしてフォーカス
   */
  jumpToError(item) {
    if (!item || !this.element) return;
    if (item.tab === 'column' && item.index !== null && item.index !== undefined) {
      this._selectedColumnIndex = item.index;
    } else if (item.tab === 'index' && item.index !== null && item.index !== undefined) {
      this._selectedIndexIndex = item.index;
    } else if (item.tab === 'fk' && item.index !== null && item.index !== undefined) {
      this._selectedFkIndex = item.index;
    } else if (item.tab === 'check' && item.index !== null && item.index !== undefined) {
      this._selectedCheckIndex = item.index;
    }

    this.activeTab = item.tab;
    this.element.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === item.tab));
    this.element.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-tab-content') === item.tab));
    this.renderActiveTab();

    if (item.focusSelector) {
      const target = this.element.querySelector(item.focusSelector);
      if (target) {
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
        target.focus();
      }
    }
  }

  /**
   * Undo 実行
   */
  handleUndo() {
    if (this._draftManager && this._draftManager.canUndo()) {
      this._draftManager.undo();
      this.render();
      this.validateAll();
    }
  }

  /**
   * Redo 実行
   */
  handleRedo() {
    if (this._draftManager && this._draftManager.canRedo()) {
      this._draftManager.redo();
      this.render();
      this.validateAll();
    }
  }

  /**
   * 履歴ボタンの有効・無効状態を更新
   */
  updateHistoryButtons() {
    if (!this.element) return;
    const undoBtn = this.element.querySelector('#btnUndo');
    const redoBtn = this.element.querySelector('#btnRedo');
    if (undoBtn) undoBtn.disabled = !this._draftManager?.canUndo();
    if (redoBtn) redoBtn.disabled = !this._draftManager?.canRedo();
  }

  /**
   * 全体描画
   */
  render() {
    if (!this.element) {
      this.element = document.createElement('div');
      this.element.className = 'dbe-table-editor-view';
      this.container.appendChild(this.element);
    }

    if (!this.draft) {
      // 日本語コメント: テーブル未選択メッセージの多言語化
      this.element.innerHTML = `<div class="placeholder-msg">${t('table_editor.no_table_selected')}</div>`;
      return;
    }

    const draft = this.draft;
    const showLogical = metadataManager.isLogicalNameEnabled();

    // 日本語コメント: ヘッダー、タブバー、フッターのボタンおよびラベルを多言語化対応
    this.element.innerHTML = `
      <!-- 1. 上段ヘッダー -->
      <div class="edit-header">
        <div class="edit-header-left">
          <div class="edit-table-names">
            <h1 class="edit-table-title" id="headerTableTitle">
              <span>📌</span>
              <span class="table-name-text">${escapeHtml(draft.name || 'NEW_TABLE')}</span>
            </h1>
            ${showLogical ? `<p class="edit-table-subtitle" id="headerTableSubtitle">${escapeHtml(draft.logicalName || '')}</p>` : ''}
          </div>
        </div>
        <div class="edit-header-actions">
          <button type="button" class="btn btn-secondary" id="btn-editor-cancel">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary" id="btn-editor-save">💾 ${t('common.save')}</button>
        </div>
      </div>

      <!-- 2. 中段タブバー -->
      <div class="tab-section">
        <div class="editor-error-banner" id="editorErrorBanner" style="display: none;"></div>
        <div class="tab-bar">
          <button type="button" class="tab-btn ${this.activeTab === 'table' ? 'active' : ''}" data-tab="table">${t('table_editor.tab_table')}</button>
          <button type="button" class="tab-btn ${this.activeTab === 'column' ? 'active' : ''}" data-tab="column">${t('table_editor.tab_column')}</button>
          <button type="button" class="tab-btn ${this.activeTab === 'pk' ? 'active' : ''}" data-tab="pk">${t('table_editor.tab_pk')}</button>
          <button type="button" class="tab-btn ${this.activeTab === 'index' ? 'active' : ''}" data-tab="index">${t('table_editor.tab_index')}</button>
          <button type="button" class="tab-btn ${this.activeTab === 'fk' ? 'active' : ''}" data-tab="fk">${t('table_editor.tab_fk')}</button>
          <button type="button" class="tab-btn ${this.activeTab === 'check' ? 'active' : ''}" data-tab="check">${t('table_editor.tab_check')}</button>
        </div>

        <!-- タブコンテンツエリア -->
        <div class="tab-content">
          <div class="tab-pane ${this.activeTab === 'table' ? 'active' : ''}" data-tab-content="table" id="tabContentTable"></div>
          <div class="tab-pane ${this.activeTab === 'column' ? 'active' : ''}" data-tab-content="column" id="tabContentColumn"></div>
          <div class="tab-pane ${this.activeTab === 'pk' ? 'active' : ''}" data-tab-content="pk" id="tabContentPk"></div>
          <div class="tab-pane ${this.activeTab === 'index' ? 'active' : ''}" data-tab-content="index" id="tabContentIndex"></div>
          <div class="tab-pane ${this.activeTab === 'fk' ? 'active' : ''}" data-tab-content="fk" id="tabContentFk"></div>
          <div class="tab-pane ${this.activeTab === 'check' ? 'active' : ''}" data-tab-content="check" id="tabContentCheck"></div>
        </div>
      </div>

      <!-- 3. 下段フッター -->
      <div class="edit-footer">
        <div class="history-btns">
          <button type="button" class="history-btn" id="btnUndo" ${!this._draftManager?.canUndo() ? 'disabled' : ''}>${t('table_editor.btn_undo')}</button>
          <button type="button" class="history-btn" id="btnRedo" ${!this._draftManager?.canRedo() ? 'disabled' : ''}>${t('table_editor.btn_redo')}</button>
        </div>
        <div class="action-btns">
          <button type="button" class="btn btn-secondary" id="btn-editor-cancel-footer">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary" id="btn-editor-save-footer">💾 ${t('common.save')}</button>
        </div>
      </div>
    `;

    this.bindGlobalEvents();
    this.renderActiveTab();
    this.validateAll();
  }

  /**
   * タブ切り替えと全体ボタンのイベントバインド
   */
  bindGlobalEvents() {
    // タブ切り替え
    const tabBtns = this.element.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-tab');
        if (this.activeTab !== tab) {
          this.activeTab = tab;
          tabBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === tab));
          const panes = this.element.querySelectorAll('.tab-pane');
          panes.forEach(p => p.classList.toggle('active', p.getAttribute('data-tab-content') === tab));
          this.renderActiveTab();
        }
      });
    });

    // Undo / Redo
    const undoBtn = this.element.querySelector('#btnUndo');
    const redoBtn = this.element.querySelector('#btnRedo');
    if (undoBtn) undoBtn.addEventListener('click', () => this.handleUndo());
    if (redoBtn) redoBtn.addEventListener('click', () => this.handleRedo());

    // キャンセル
    const cancelAction = () => {
      if (this.isNew) {
        appStore.emit('view:mode:change', 'list');
      } else {
        appStore.emit('table:select', this.currentTable?.name || this.draft.name);
      }
    };
    this.element.querySelector('#btn-editor-cancel')?.addEventListener('click', cancelAction);
    this.element.querySelector('#btn-editor-cancel-footer')?.addEventListener('click', cancelAction);

    // 保存
    const saveAction = () => this.handleSave();
    this.element.querySelector('#btn-editor-save')?.addEventListener('click', saveAction);
    this.element.querySelector('#btn-editor-save-footer')?.addEventListener('click', saveAction);
  }

  /**
   * 現在アクティブなタブを描画
   */
  renderActiveTab() {
    switch (this.activeTab) {
      case 'table':
        this.renderTableTab();
        break;
      case 'column':
        this.renderColumnTab();
        break;
      case 'pk':
        this.renderPkTab();
        break;
      case 'index':
        this.renderIndexTab();
        break;
      case 'fk':
        this.renderFkTab();
        break;
      case 'check':
        this.renderCheckTab();
        break;
    }
    this.updateHistoryButtons();
  }

  // =========================================================================
  // ① 📌 テーブルタブ (table)
  // =========================================================================
  renderTableTab() {
    const container = this.element.querySelector('#tabContentTable');
    if (!container || !this.draft) return;

    const draft = this.draft;
    const showLogical = metadataManager.isLogicalNameEnabled();
    const dialect = appStore.state.activeDialect;
    const currentDialect = dialect?.id || appStore.state.project?.databaseType || 'standard';
    const attrSchemas = metadataManager.getTableAttributes(currentDialect);
    const custom = draft.custom || {};

    // 定義済み属性のキー
    const definedKeys = new Set(attrSchemas.map(a => a.key));
    // 未定義の追加カスタムキー一覧
    const extraCustomKeys = Object.keys(custom).filter(k => k.toLowerCase() !== 'logicalname' && !definedKeys.has(k));

    let rowsHtml = '';
    attrSchemas.forEach((attr, idx) => {
      const k = attr.key;
      const v = custom[k] !== undefined ? custom[k] : (attr.default !== undefined ? attr.default : '');
      const labelText = metadataManager.resolveLabel(attr);

      let inputHtml = '';
      if (attr.type === 'boolean') {
        inputHtml = `<input type="checkbox" class="tbl-attr-input" data-key="${k}" data-type="boolean" ${v ? 'checked' : ''} />`;
      } else if (attr.type === 'select' && Array.isArray(attr.options)) {
        // 日本語コメント: select 型属性用のプルダウン選択肢（<option>）を生成
        const optHtml = attr.options.map(opt => {
          const optVal = typeof opt === 'object' ? opt.value : opt;
          const optLabel = typeof opt === 'object' ? (opt.label || opt.value) : opt;
          const isSelected = String(v).toUpperCase() === String(optVal).toUpperCase();
          return `<option value="${escapeAttr(optVal)}" ${isSelected ? 'selected' : ''}>${escapeHtml(optLabel)}</option>`;
        }).join('');
        inputHtml = `<select class="tbl-attr-input" data-key="${k}" data-type="select">${optHtml}</select>`;
      } else if (attr.type === 'textarea') {
        inputHtml = `<textarea class="tbl-attr-input" data-key="${k}" data-type="textarea" rows="2">${escapeHtml(v)}</textarea>`;
      } else {
        // サジェスト候補取得
        const activeSchemaData = appStore.state.schemas?.get(appStore.state.activeSchema);
        const schemaProj = activeSchemaData?.model?.project || appStore.state.project || {};
        const schemaCustom = schemaProj.custom || {};
        let candidates = [];
        const suggestKey = attr.suggestFromProjectKey || (attr.key === 'tablespace' ? 'data_tablespaces' : null);
        if (suggestKey) {
          const rawCandidates = schemaCustom[suggestKey] || schemaCustom[suggestKey.replace(/_([a-z])/g, (_, c) => c.toUpperCase())];
          candidates = Array.isArray(rawCandidates) ? rawCandidates : [];
        }
        const datalistId = `datalist-tbl-attr-${k}`;
        const datalistHtml = candidates.length > 0
          ? `<datalist id="${datalistId}">${candidates.map(c => `<option value="${escapeAttr(c)}">`).join('')}</datalist>`
          : '';
        const listAttr = candidates.length > 0 ? `list="${datalistId}"` : '';

        inputHtml = `
          <input type="${attr.type === 'number' ? 'number' : 'text'}" class="tbl-attr-input" data-key="${k}" data-type="${attr.type || 'text'}" value="${escapeAttr(v)}" ${listAttr} />
          ${datalistHtml}
        `;
      }

      // 日本語コメント: 属性種別の表示を多言語化
      rowsHtml += `
        <tr>
          <td style="width: 35px; text-align: center;">${idx + 1}</td>
          <td><b>${escapeHtml(labelText)}</b><br><small style="color: var(--text-muted);">${k}</small></td>
          <td>${inputHtml}</td>
          <td style="color: var(--text-muted); font-size: 11px;">${t('table_editor.attr_type_plugin')}</td>
        </tr>
      `;
    });

    // 任意カスタム属性
    extraCustomKeys.forEach((k, idx) => {
      const v = custom[k];
      rowsHtml += `
        <tr>
          <td style="width: 35px; text-align: center;">${attrSchemas.length + idx + 1}</td>
          <td><b>${escapeHtml(k)}</b></td>
          <td>
            <input type="text" class="tbl-attr-input" data-key="${k}" data-type="text" value="${escapeAttr(v || '')}" />
          </td>
          <td>
            <button type="button" class="action-btn btn-danger btn-del-extra-attr" data-key="${k}" style="padding: 2px 6px; font-size: 11px;">${t('common.delete')}</button>
          </td>
        </tr>
      `;
    });

    // 日本語コメント: フルリキッド2ペインレイアウトで描画（各ラベル・ヘッダー・プレースホルダーの多言語化）
    container.innerHTML = `
      <div class="table-tab-layout">
        <!-- 左カラム：基本情報 -->
        <div class="table-tab-left">
          <div class="pane-form">
            <h3>${t('table_editor.tab_general')}</h3>
            
            <div class="form-group">
              <label for="tableNameInput">${t('table_editor.tbl_physical_name_label')} <span style="color: var(--danger);">*</span></label>
              <input type="text" id="tableNameInput" value="${escapeAttr(draft.name || '')}" placeholder="${t('table_editor.tbl_name_placeholder')}" />
              <div id="tableNameError" style="font-size: 12px; color: var(--danger); display: ${this._errors.table ? 'block' : 'none'};">
                ${escapeHtml(this._errors.table || '')}
              </div>
            </div>

            ${showLogical ? `
            <div class="form-group">
              <label for="tableLogicalNameInput">${metadataManager.getLogicalNameLabel('table')}</label>
              <input type="text" id="tableLogicalNameInput" value="${escapeAttr(draft.logicalName || '')}" placeholder="${metadataManager.getLogicalNameLabel('tablePlaceholder')}" />
            </div>` : ''}

            <div class="form-group">
              <label>${t('table_color.label')}</label>
              <div class="tbl-color-palette" id="tableColorPalette">
                <button type="button" class="tbl-color-none-btn ${!draft.headerColor ? 'active' : ''}" data-color="" title="${t('table_color.none')}">
                  ${t('table_color.none')}
                </button>
                ${TABLE_COLOR_PRESETS.map(p => {
                  const isActive = (draft.headerColor || '').toLowerCase() === p.color.toLowerCase();
                  return `<button type="button" class="tbl-color-swatch ${isActive ? 'active' : ''}" data-color="${p.color}" style="background-color: ${p.color};" title="${t(p.labelKey)}" aria-label="${t(p.labelKey)}"></button>`;
                }).join('')}
              </div>
            </div>

            <div class="form-group form-group-note">
              <label for="tableNoteText">${t('table_editor.tbl_note_label')}</label>
              <textarea id="tableNoteText" placeholder="${t('table_editor.tbl_note_placeholder')}">${escapeHtml(draft.note || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- 右カラム：DBMS固有設定・拡張属性 -->
        <div class="table-tab-right">
          <div class="pane-form">
            <h3>${t('table_editor.section_dbms_custom')}</h3>
            <p class="tab-description">${t('table_editor.desc_dbms_custom', { dialect: escapeHtml(dialect?.displayName || 'Standard') })}</p>

            <div class="table-wrapper">
              <table class="grid-table">
                <thead>
                  <tr>
                    <th style="width: 35px;">#</th>
                    <th style="width: 35%;">${t('table_editor.col_attr_item')}</th>
                    <th>${t('table_editor.col_attr_value')}</th>
                    <th style="width: 75px;">${t('table_editor.col_attr_type')}</th>
                  </tr>
                </thead>
                <tbody>
                  ${rowsHtml || `<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_editor.no_ext_attributes')}</td></tr>`}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;

    // イベントバインド
    const nameInput = container.querySelector('#tableNameInput');
    nameInput?.addEventListener('input', (e) => {
      const val = e.target.value.trim();
      draft.name = dialect ? dialect.formatIdentifier(val) : val;
      const headerTitle = this.element.querySelector('#headerTableTitle .table-name-text');
      if (headerTitle) headerTitle.textContent = draft.name;
      this.validateAll();
      const errDiv = container.querySelector('#tableNameError');
      if (errDiv) {
        errDiv.textContent = this._errors.table || '';
        errDiv.style.display = this._errors.table ? 'block' : 'none';
      }
    });
    nameInput?.addEventListener('change', () => this.pushHistory());

    const logicalInput = container.querySelector('#tableLogicalNameInput');
    logicalInput?.addEventListener('input', (e) => {
      const sanitized = e.target.value.replace(/[\r\n]+/g, '');
      if (e.target.value !== sanitized) {
        e.target.value = sanitized;
      }
      draft.logicalName = sanitized.trim();
      const headerSub = this.element.querySelector('#headerTableSubtitle');
      if (headerSub) headerSub.textContent = draft.logicalName;
    });
    logicalInput?.addEventListener('change', () => this.pushHistory());

    const noteText = container.querySelector('#tableNoteText');
    noteText?.addEventListener('change', (e) => {
      draft.note = e.target.value.trim();
      this.pushHistory();
    });

    // テーブルカラーパレット選択
    const colorBtns = container.querySelectorAll('#tableColorPalette button');
    colorBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const selected = btn.getAttribute('data-color') || '';
        draft.headerColor = selected;
        colorBtns.forEach(b => b.classList.toggle('active', b === btn));
        this.pushHistory();
      });
    });

    // 属性入力イベント
    container.querySelectorAll('.tbl-attr-input').forEach(input => {
      input.addEventListener('change', (e) => {
        const k = e.target.getAttribute('data-key');
        const type = e.target.getAttribute('data-type');
        let val;
        if (type === 'boolean') {
          val = e.target.checked;
        } else if (type === 'number') {
          val = e.target.value === '' ? '' : Number(e.target.value);
        } else {
          val = e.target.value.trim();
        }
        draft.custom[k] = val;
        this.pushHistory();
      });
    });

    // 追加カスタム属性削除（既存DBML由来の属性削除用）
    container.querySelectorAll('.btn-del-extra-attr').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const k = e.target.getAttribute('data-key');
        delete draft.custom[k];
        this.pushHistory();
        this.renderTableTab();
      });
    });
  }

  // =========================================================================
  // ② 📋 カラムタブ (column) - 2ペイン Master-Detail
  // =========================================================================
  renderColumnTab() {
    const container = this.element.querySelector('#tabContentColumn');
    if (!container || !this.draft) return;

    // 日本語コメント: 再描画前のカラム一覧スクロール位置を退避
    const prevWrapper = container.querySelector('#colGridWrapper');
    const savedScrollTop = prevWrapper ? prevWrapper.scrollTop : 0;
    const savedScrollLeft = prevWrapper ? prevWrapper.scrollLeft : 0;

    const draft = this.draft;
    const fields = draft.fields || [];
    const showLogical = metadataManager.isLogicalNameEnabled();
    const dialect = appStore.state.activeDialect;

    if (this._selectedColumnIndex >= fields.length) {
      this._selectedColumnIndex = Math.max(0, fields.length - 1);
    }
    const selectedIdx = this._selectedColumnIndex;

    // 左ペイン：カラム一覧テーブルの行HTML
    let rowsHtml = '';
    fields.forEach((f, i) => {
      const isSelected = i === selectedIdx;
      // 日本語コメント: カラム名・データ型・桁数・精度エラーを左ペインの警告表示および行ハイライト対象とする
      const colErrMsg = [
        this._errors.columns?.[i],
        this._errors.columnTypes?.[i],
        this._errors.columnLengths?.[i],
        this._errors.columnScales?.[i],
      ].filter(Boolean).join(' / ');
      const hasError = Boolean(colErrMsg);

      const badges = [];
      if (f.pk) badges.push('<span class="badge badge-pk">PK</span>');
      if (f.not_null) badges.push('<span class="badge badge-nn">NN</span>');
      if (f.unique) badges.push('<span class="badge badge-uq">UQ</span>');

      const lenScale = f.length ? (f.scale ? `${f.length},${f.scale}` : `${f.length}`) : '-';
      // デフォルト値の表示用文字列（未設定時はハイフン表示）
      const defVal = f.dbdefault !== null && f.dbdefault !== undefined && String(f.dbdefault).trim() !== '' ? f.dbdefault : '-';

      rowsHtml += `
        <tr class="${isSelected ? 'selected-row' : ''} ${hasError ? 'has-error-row' : ''}" data-index="${i}">
          <!-- 行番号列（3桁対応: 幅50px） -->
          <td style="width: 50px; text-align: center;">${i + 1}</td>
          <td>
            ${hasError ? '<span title="' + escapeAttr(colErrMsg) + '" style="margin-right: 4px;">⚠️</span>' : ''}
            <b class="col-name-label">${escapeHtml(f.name)}</b>
          </td>
          ${showLogical ? `<td>${escapeHtml(f.logicalName || '-')}</td>` : ''}
          <td><code>${escapeHtml(f.baseType || f.type || '')}</code></td>
          <td style="text-align: right;">${escapeHtml(lenScale)}</td>
          <td>${badges.join(' ')}</td>
          <td><code>${escapeHtml(defVal)}</code></td>
        </tr>
      `;
    });

    // 右ペイン：選択中カラムの詳細編集フォーム（上下2段構成: 基本情報 + 設計メタデータ）
    const selectedCol = fields[selectedIdx];
    let rightFormHtml = '';

    if (selectedCol) {
      if (!selectedCol.custom) selectedCol.custom = {};

      const cap = getTypeCapability(selectedCol.baseType, dialect);
      const dataTypes = dialect?.dataTypes || [];
      const typeOptions = dataTypes.map(d => `<option value="${escapeAttr(d.name)}">${escapeAttr(d.name)}</option>`).join('');

      // カラムで利用可能なメタデータ属性一覧（定義済みスキーマ＋独自カスタム）
      const availableAttrs = this.getAvailableColumnAttributes(selectedCol);

      // --- 項目表示設定パネルのチェックボックス一覧 ---
      const settingsCheckboxesHtml = availableAttrs.map(attr => {
        const isVisible = this._colMetaVisibility[attr.key] !== false;
        return `
          <label class="col-meta-vis-label">
            <input type="checkbox" class="col-meta-vis-check" data-key="${escapeAttr(attr.key)}" ${isVisible ? 'checked' : ''} />
            <span>${escapeHtml(attr.label)}</span>
          </label>
        `;
      }).join('');

      // --- 表示が有効なメタデータ入力項目一覧 ---
      const metaFormRowsHtml = availableAttrs
        .filter(attr => this._colMetaVisibility[attr.key] !== false)
        .map(attr => {
          const curVal = selectedCol.custom[attr.key] !== undefined
            ? selectedCol.custom[attr.key]
            : '';

          let inputWidget = '';
          if (attr.type === 'boolean') {
            inputWidget = `
              <label class="col-meta-bool-label">
                <input type="checkbox" class="col-meta-input" data-key="${escapeAttr(attr.key)}" data-type="boolean" ${curVal ? 'checked' : ''} />
                <span>${escapeHtml(attr.label)}</span>
              </label>
            `;
          } else if (attr.type === 'textarea') {
            inputWidget = `
              <label class="col-meta-field-label" for="col-meta-${escapeAttr(attr.key)}">${escapeHtml(attr.label)}</label>
              <textarea class="col-meta-input" id="col-meta-${escapeAttr(attr.key)}" data-key="${escapeAttr(attr.key)}" data-type="textarea" rows="2" placeholder="${escapeAttr(attr.description || '')}">${escapeHtml(curVal)}</textarea>
            `;
          } else {
            inputWidget = `
              <label class="col-meta-field-label" for="col-meta-${escapeAttr(attr.key)}">${escapeHtml(attr.label)}</label>
              <input type="${attr.type === 'number' ? 'number' : 'text'}" class="col-meta-input" id="col-meta-${escapeAttr(attr.key)}" data-key="${escapeAttr(attr.key)}" data-type="${escapeAttr(attr.type || 'text')}" value="${escapeAttr(curVal)}" placeholder="${escapeAttr(attr.description || '')}" />
            `;
          }

          return `
            <div class="col-meta-row ${attr.type === 'textarea' ? 'col-meta-row-full' : ''}">
              <div class="col-meta-input-wrap">
                ${inputWidget}
              </div>
              ${attr.isCustom ? `
                <button type="button" class="btn-del-col-meta action-btn btn-danger" data-key="${escapeAttr(attr.key)}" title="${t('table_editor.tip_del_custom_attr')}">🗑️</button>
              ` : ''}
            </div>
          `;
        }).join('');

      rightFormHtml = `
        <div class="column-detail-layout">
          <!-- 上段：基本設計情報 -->
          <div class="column-detail-upper pane-form">
            <div class="section-title-bar">
              <h3>${t('table_editor.section_basic_num', { num: selectedIdx + 1 })}</h3>
            </div>

            <div class="form-row-2">
              <div class="form-group" style="flex: 1.2;">
                <label for="colName">${t('table_editor.col_physical_name_label')} <span style="color: var(--danger);">*</span></label>
                <input type="text" id="colName" value="${escapeAttr(selectedCol.name)}" />
                <div id="colNameError" style="font-size: 11px; color: var(--danger); display: ${this._errors.columns[selectedIdx] ? 'block' : 'none'};">
                  ${escapeHtml(this._errors.columns[selectedIdx] || '')}
                </div>
              </div>

              ${showLogical ? `
              <div class="form-group" style="flex: 1.2;">
                <label for="colLogicalName">${metadataManager.getLogicalNameLabel('column')}</label>
                <input type="text" id="colLogicalName" value="${escapeAttr(selectedCol.logicalName || '')}" placeholder="${metadataManager.getLogicalNameLabel('columnPlaceholder')}" />
              </div>` : ''}
            </div>

            <div class="form-row-2">
              <div class="form-group" style="flex: 1.4;">
                <label for="colDataType">${t('table_editor.col_type')} <span style="color: var(--danger);">*</span></label>
                <input type="text" list="colDataTypesList" id="colDataType" value="${escapeAttr(selectedCol.baseType || '')}" />
                <datalist id="colDataTypesList">${typeOptions}</datalist>
                <div id="colTypeError" style="font-size: 11px; color: var(--danger); display: ${this._errors.columnTypes?.[selectedIdx] ? 'block' : 'none'};">
                  ${escapeHtml(this._errors.columnTypes?.[selectedIdx] || '')}
                </div>
              </div>
              <div class="form-group" style="flex: 0.8;">
                <label for="colLength">${t('table_editor.col_length')}</label>
                <input type="text" id="colLength" value="${escapeAttr(selectedCol.length || '')}" placeholder="${t('table_editor.col_length_placeholder')}" ${!cap.hasLength ? 'disabled' : ''} />
                <div id="colLengthError" class="field-error-text" style="display: ${this._errors.columnLengths?.[selectedIdx] ? 'block' : 'none'};">
                  ${escapeHtml(this._errors.columnLengths?.[selectedIdx] || '')}
                </div>
              </div>
              <div class="form-group" style="flex: 0.8;">
                <label for="colScale">${t('table_editor.col_scale')}</label>
                <input type="text" id="colScale" value="${escapeAttr(selectedCol.scale || '')}" placeholder="${t('table_editor.col_scale_placeholder')}" ${!cap.hasScale ? 'disabled' : ''} />
                <div id="colScaleError" class="field-error-text" style="display: ${this._errors.columnScales?.[selectedIdx] ? 'block' : 'none'};">
                  ${escapeHtml(this._errors.columnScales?.[selectedIdx] || '')}
                </div>
              </div>
            </div>

            <div class="form-group-checkboxes">
              <label><input type="checkbox" id="colPk" ${selectedCol.pk ? 'checked' : ''} /> <span>${t('table_editor.col_chk_pk')}</span></label>
              <label><input type="checkbox" id="colNotNull" ${selectedCol.not_null ? 'checked' : ''} /> <span>${t('table_editor.col_chk_not_null')}</span></label>
              <label><input type="checkbox" id="colUnique" ${selectedCol.unique ? 'checked' : ''} /> <span>${t('table_editor.col_chk_unique')}</span></label>
              <label><input type="checkbox" id="colIncrement" ${selectedCol.increment ? 'checked' : ''} /> <span>${t('table_editor.col_chk_increment')}</span></label>
            </div>

            <div class="form-group">
              <label for="colDefault">${t('table_editor.col_default')}</label>
              <input type="text" id="colDefault" value="${escapeAttr(selectedCol.dbdefault !== null ? selectedCol.dbdefault : '')}" placeholder="${t('table_editor.col_default_placeholder')}" />
            </div>

            <div class="form-group">
              <label for="colNote">${t('table_editor.col_note_label')}</label>
              <textarea id="colNote" rows="2" placeholder="${t('table_editor.col_note_placeholder')}">${escapeHtml(selectedCol.note || '')}</textarea>
            </div>
          </div>

          <!-- 下段：設計メタデータ -->
          <div class="column-detail-lower pane-form">
            <div class="col-meta-header">
              <div class="col-meta-title">
                <h3>${t('table_editor.section_col_meta')}</h3>
                <span class="col-meta-subtitle">${t('table_editor.section_col_meta_target', { name: escapeHtml(selectedCol.name) })}</span>
              </div>
              <div class="col-meta-header-actions">
                <button type="button" class="btn btn-secondary btn-sm" id="btnToggleColMetaSettings" title="${t('table_editor.tip_col_meta_settings')}">
                  ${t('table_editor.btn_col_meta_settings')} ${this._showColMetaSettings ? '▲' : '▼'}
                </button>
              </div>
            </div>

            <!-- 項目表示設定パネル (開閉) -->
            <div class="col-meta-settings-panel" id="colMetaSettingsPanel" style="display: ${this._showColMetaSettings ? 'block' : 'none'};">
              <div class="col-meta-settings-desc">${t('table_editor.col_meta_settings_desc')}</div>
              <div class="col-meta-settings-grid">
                ${settingsCheckboxesHtml || `<span style="color: var(--text-muted); font-size: 11px;">${t('table_editor.no_col_meta_settings')}</span>`}
              </div>
            </div>

            <!-- メタデータ入力項目グリッド -->
            <div class="col-meta-fields-container">
              ${metaFormRowsHtml || `<div class="col-meta-empty-msg">${t('table_editor.col_meta_empty_msg')}</div>`}
            </div>
          </div>
        </div>
      `;
    } else {
      rightFormHtml = `<div class="placeholder-msg">${t('table_editor.msg_select_column')}</div>`;
    }

    container.innerHTML = `
      <div class="pane-layout">
        <!-- 左ペイン：カラム一覧 -->
        <div class="left-pane">
          <div class="table-wrapper" id="colGridWrapper">
            <table class="grid-table" id="colGridTable">
              <thead>
                <tr>
                  <!-- 行番号列（3桁対応: 幅50px、中央揃え） -->
                  <th style="width: 50px; text-align: center;">#</th>
                  <th>${t('table_editor.col_grid_name')}</th>
                  ${showLogical ? `<th>${metadataManager.getLogicalNameLabel('column')}</th>` : ''}
                  <th style="width: 100px;">${t('table_editor.col_type')}</th>
                  <th style="width: 75px; text-align: right;">${t('table_editor.col_grid_length_scale')}</th>
                  <th style="width: 90px;">${t('table_editor.col_grid_constraints')}</th>
                  <th style="width: 95px;">${t('table_editor.col_default')}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || `<tr><td colspan="${showLogical ? 7 : 6}" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_editor.no_columns')}</td></tr>`}
              </tbody>
            </table>
          </div>

          <!-- 下部操作ボタンバー -->
          <div class="grid-actions">
            <button type="button" class="action-btn btn-success" id="btnAddCol">+ ${t('table_editor.btn_add_column')}</button>
            <button type="button" class="action-btn btn-danger" id="btnDelCol" ${fields.length <= 1 ? 'disabled' : ''}>🗑️ ${t('common.delete')}</button>
            <button type="button" class="action-btn btn-secondary" id="btnMoveColUp" ${selectedIdx === 0 ? 'disabled' : ''}>${t('table_editor.btn_move_up')}</button>
            <button type="button" class="action-btn btn-secondary" id="btnMoveColDown" ${selectedIdx >= fields.length - 1 ? 'disabled' : ''}>${t('table_editor.btn_move_down')}</button>
          </div>
        </div>

        <!-- 右ペイン：詳細フォーム -->
        <div class="right-pane">
          ${rightFormHtml}
        </div>
      </div>
    `;

    // テーブルリサイズ初期化
    initResizableColumns(container.querySelector('#colGridTable'));

    // 日本語コメント: カラム一覧のスクロール位置を復元（行選択や右ペイン編集時の先頭戻りを防止）
    const nextWrapper = container.querySelector('#colGridWrapper');
    if (nextWrapper && (savedScrollTop > 0 || savedScrollLeft > 0)) {
      nextWrapper.scrollTop = savedScrollTop;
      nextWrapper.scrollLeft = savedScrollLeft;
    }

    // 行クリックイベント
    container.querySelectorAll('#colGridTable tbody tr').forEach(tr => {
      tr.addEventListener('click', (e) => {
        const idx = Number(tr.getAttribute('data-index'));
        if (!isNaN(idx) && idx !== this._selectedColumnIndex) {
          this._selectedColumnIndex = idx;
          this.renderColumnTab();
        }
      });
    });

    // カラム追加 (+ カラム追加: 選択行のすぐ下 selectedIdx + 1 に挿入)
    container.querySelector('#btnAddCol')?.addEventListener('click', () => {
      const insertAt = Math.min(fields.length, this._selectedColumnIndex + 1);
      // 日本語コメント: 新規カラムの初期データ型は DBML 構文エラーを回避しつつ明示選択を促す unknown とし、桁数は空にする
      const newCol = {
        name: `COL_${fields.length + 1}`,
        logicalName: '',
        baseType: 'unknown',
        length: '',
        scale: '',
        type: 'unknown',
        pk: false,
        not_null: false,
        unique: false,
        increment: false,
        dbdefault: null,
        note: '',
        custom: {},
      };
      fields.splice(insertAt, 0, newCol);
      this._selectedColumnIndex = insertAt;
      this.validateAll();
      this.pushHistory();
      this.renderColumnTab();
    });

    // カラム削除
    container.querySelector('#btnDelCol')?.addEventListener('click', () => {
      if (fields.length <= 1) return;
      const deletedName = fields[this._selectedColumnIndex]?.name;
      fields.splice(this._selectedColumnIndex, 1);
      // pkOrder からも除外
      if (deletedName && draft.pkOrder) {
        draft.pkOrder = draft.pkOrder.filter(n => n.toUpperCase() !== deletedName.toUpperCase());
      }
      if (this._selectedColumnIndex >= fields.length) {
        this._selectedColumnIndex = Math.max(0, fields.length - 1);
      }
      this.validateAll();
      this.pushHistory();
      this.renderColumnTab();
    });

    // カラム上へ移動
    container.querySelector('#btnMoveColUp')?.addEventListener('click', () => {
      if (this._selectedColumnIndex > 0) {
        const idx = this._selectedColumnIndex;
        const temp = fields[idx];
        fields[idx] = fields[idx - 1];
        fields[idx - 1] = temp;
        this._selectedColumnIndex--;
        this.pushHistory();
        this.renderColumnTab();
      }
    });

    // カラム下へ移動
    container.querySelector('#btnMoveColDown')?.addEventListener('click', () => {
      if (this._selectedColumnIndex < fields.length - 1) {
        const idx = this._selectedColumnIndex;
        const temp = fields[idx];
        fields[idx] = fields[idx + 1];
        fields[idx + 1] = temp;
        this._selectedColumnIndex++;
        this.pushHistory();
        this.renderColumnTab();
      }
    });

    // 右ペインフォーム入力バインド
    if (selectedCol) {
      const colNameInput = container.querySelector('#colName');
      colNameInput?.addEventListener('input', (e) => {
        const oldName = selectedCol.name;
        const val = e.target.value.trim();
        selectedCol.name = dialect ? dialect.formatIdentifier(val) : val;

        // pkOrder のカラム名も追従
        if (draft.pkOrder && oldName) {
          draft.pkOrder = draft.pkOrder.map(n => n.toUpperCase() === oldName.toUpperCase() ? selectedCol.name : n);
        }

        // 左グリッドの行テキストを更新
        const activeRow = container.querySelector(`tr[data-index="${selectedIdx}"] .col-name-label`);
        if (activeRow) activeRow.textContent = selectedCol.name;

        this.validateAll();
        const errDiv = container.querySelector('#colNameError');
        if (errDiv) {
          errDiv.textContent = this._errors.columns[selectedIdx] || '';
          errDiv.style.display = this._errors.columns[selectedIdx] ? 'block' : 'none';
        }
      });
      colNameInput?.addEventListener('change', () => this.pushHistory());

      const colLogicalInput = container.querySelector('#colLogicalName');
      colLogicalInput?.addEventListener('input', (e) => {
        const sanitized = e.target.value.replace(/[\r\n]+/g, '');
        if (e.target.value !== sanitized) {
          e.target.value = sanitized;
        }
        selectedCol.logicalName = sanitized.trim();
      });
      colLogicalInput?.addEventListener('change', () => {
        this.pushHistory();
        this.renderColumnTab();
      });

      const colTypeInput = container.querySelector('#colDataType');
      // 日本語コメント: データ型入力中に空チェックと保存ボタンの活性状態を即時更新する
      colTypeInput?.addEventListener('input', (e) => {
        selectedCol.baseType = e.target.value.trim();
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        const errEl = container.querySelector('#colTypeError');
        if (errEl) {
          const msg = this._errors.columnTypes?.[selectedIdx] || '';
          errEl.textContent = msg;
          errEl.style.display = msg ? 'block' : 'none';
        }
      });

      colTypeInput?.addEventListener('change', (e) => {
        const newBase = e.target.value.trim();
        selectedCol.baseType = newBase;
        const cap = getTypeCapability(newBase, dialect);
        const lenInput = container.querySelector('#colLength');
        const scaleInput = container.querySelector('#colScale');
        if (lenInput) {
          lenInput.disabled = !cap.hasLength;
          if (!cap.hasLength) {
            lenInput.value = '';
            selectedCol.length = '';
          }
        }
        if (scaleInput) {
          scaleInput.disabled = !cap.hasScale;
          if (!cap.hasScale) {
            scaleInput.value = '';
            selectedCol.scale = '';
          }
        }
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        this.pushHistory();
        this.renderColumnTab();
      });

      const colLengthInput = container.querySelector('#colLength');
      colLengthInput?.addEventListener('input', (e) => {
        selectedCol.length = e.target.value.trim();
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        const errEl = container.querySelector('#colLengthError');
        if (errEl) {
          const msg = this._errors.columnLengths?.[selectedIdx] || '';
          errEl.textContent = msg;
          errEl.style.display = msg ? 'block' : 'none';
        }
        const scaleErrEl = container.querySelector('#colScaleError');
        if (scaleErrEl) {
          const msg = this._errors.columnScales?.[selectedIdx] || '';
          scaleErrEl.textContent = msg;
          scaleErrEl.style.display = msg ? 'block' : 'none';
        }
      });
      colLengthInput?.addEventListener('change', (e) => {
        selectedCol.length = e.target.value.trim();
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        this.pushHistory();
        this.renderColumnTab();
      });

      const colScaleInput = container.querySelector('#colScale');
      colScaleInput?.addEventListener('input', (e) => {
        selectedCol.scale = e.target.value.trim();
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        const errEl = container.querySelector('#colScaleError');
        if (errEl) {
          const msg = this._errors.columnScales?.[selectedIdx] || '';
          errEl.textContent = msg;
          errEl.style.display = msg ? 'block' : 'none';
        }
      });
      colScaleInput?.addEventListener('change', (e) => {
        selectedCol.scale = e.target.value.trim();
        this.syncFieldTypeString(selectedIdx);
        this.validateAll();
        this.pushHistory();
        this.renderColumnTab();
      });

      const colPkCheck = container.querySelector('#colPk');
      colPkCheck?.addEventListener('change', (e) => {
        selectedCol.pk = e.target.checked;
        if (selectedCol.pk) {
          selectedCol.not_null = true;
          if (!draft.pkOrder) draft.pkOrder = [];
          if (!draft.pkOrder.some(n => n.toUpperCase() === selectedCol.name.toUpperCase())) {
            draft.pkOrder.push(selectedCol.name);
          }
        } else {
          if (draft.pkOrder) {
            draft.pkOrder = draft.pkOrder.filter(n => n.toUpperCase() !== selectedCol.name.toUpperCase());
          }
        }
        this.pushHistory();
        this.renderColumnTab();
      });

      const colNotNullCheck = container.querySelector('#colNotNull');
      colNotNullCheck?.addEventListener('change', (e) => {
        selectedCol.not_null = e.target.checked;
        this.pushHistory();
        this.renderColumnTab();
      });

      const colUniqueCheck = container.querySelector('#colUnique');
      colUniqueCheck?.addEventListener('change', (e) => {
        selectedCol.unique = e.target.checked;
        this.pushHistory();
        this.renderColumnTab();
      });

      const colIncrementCheck = container.querySelector('#colIncrement');
      colIncrementCheck?.addEventListener('change', (e) => {
        selectedCol.increment = e.target.checked;
        this.pushHistory();
      });

      const colDefaultInput = container.querySelector('#colDefault');
      colDefaultInput?.addEventListener('change', (e) => {
        const v = e.target.value.trim();
        selectedCol.dbdefault = v === '' ? null : v;
        this.pushHistory();
        // 左一覧のデフォルト値列へ即時反映
        this.renderColumnTab();
      });

      const colNoteInput = container.querySelector('#colNote');
      colNoteInput?.addEventListener('change', (e) => {
        selectedCol.note = e.target.value.trim();
        this.pushHistory();
      });

      // --- 下段：設計メタデータのイベントバインド ---
      // 1. 項目表示設定トグルボタン
      container.querySelector('#btnToggleColMetaSettings')?.addEventListener('click', () => {
        this._showColMetaSettings = !this._showColMetaSettings;
        const panel = container.querySelector('#colMetaSettingsPanel');
        const btn = container.querySelector('#btnToggleColMetaSettings');
        if (panel) {
          panel.style.display = this._showColMetaSettings ? 'block' : 'none';
        }
        if (btn) {
          // 日本語コメント: 項目表示設定ボタン文言の多言語化
          btn.innerHTML = `${t('table_editor.btn_col_meta_settings')} ${this._showColMetaSettings ? '▲' : '▼'}`;
        }
      });

      // 2. 項目表示設定チェックボックス (表示/非表示切り替え & localStorage 永続化)
      container.querySelectorAll('.col-meta-vis-check').forEach(chk => {
        chk.addEventListener('change', (e) => {
          const key = e.target.getAttribute('data-key');
          if (key) {
            this._colMetaVisibility[key] = e.target.checked;
            this._saveColMetaVisibility();
            this.renderColumnTab();
          }
        });
      });

      // 3. メタデータ各入力欄の変更
      container.querySelectorAll('.col-meta-input').forEach(input => {
        input.addEventListener('change', (e) => {
          const key = e.target.getAttribute('data-key');
          const type = e.target.getAttribute('data-type');
          if (!key) return;
          if (!selectedCol.custom) selectedCol.custom = {};

          let val;
          if (type === 'boolean') {
            val = e.target.checked;
          } else if (type === 'number') {
            val = e.target.value === '' ? '' : Number(e.target.value);
          } else {
            val = e.target.value.trim();
          }
          selectedCol.custom[key] = val;
          this.pushHistory();
        });
      });

      // 4. カスタムメタデータ属性の削除（既存のDBMLに記述されたカスタム属性の削除をサポート）
      container.querySelectorAll('.btn-del-col-meta').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const key = e.target.getAttribute('data-key');
          if (key && selectedCol.custom) {
            delete selectedCol.custom[key];
            this.pushHistory();
            this.renderColumnTab();
          }
        });
      });

      // 互換性保持: 旧モーダル呼び出しボタンが存在する場合のフォールバック
      container.querySelector('#btnColMetaModal')?.addEventListener('click', () => {
        this.openColumnMetadataModal(selectedIdx);
      });
    }
  }

  // =========================================================================
  // ③ 🔑 PKタブ (pk) - 主キー物理名＋デュアルリスト順序設定
  // =========================================================================
  renderPkTab() {
    const container = this.element.querySelector('#tabContentPk');
    if (!container || !this.draft) return;

    const draft = this.draft;
    const fields = draft.fields || [];

    if (!draft.pkOrder) {
      draft.pkOrder = [];
    }

    // pkOrder に従いPK対象カラムを構築
    const pkFields = [];
    draft.pkOrder.forEach(colName => {
      const f = fields.find(field => field.name.toUpperCase() === String(colName).toUpperCase());
      if (f) pkFields.push(f);
    });

    // pk === true だが pkOrder にないものを補正
    fields.forEach(f => {
      if (f.pk && !draft.pkOrder.some(n => n.toUpperCase() === f.name.toUpperCase())) {
        pkFields.push(f);
        draft.pkOrder.push(f.name);
      }
    });

    const nonPkFields = fields.filter(f => !draft.pkOrder.some(n => n.toUpperCase() === f.name.toUpperCase()));

    const leftOptionsHtml = pkFields.map(f =>
      `<option value="${escapeAttr(f.name)}">${escapeHtml(f.name)} ${f.logicalName ? `(${escapeHtml(f.logicalName)})` : ''}</option>`
    ).join('');

    const rightOptionsHtml = nonPkFields.map(f =>
      `<option value="${escapeAttr(f.name)}">${escapeHtml(f.name)} ${f.logicalName ? `(${escapeHtml(f.logicalName)})` : ''}</option>`
    ).join('');

    // 日本語コメント: フルリキッド主キー(PK)設定画面を描画（全幅適応＆デュアルリストの縦伸縮対応・多言語化）
    container.innerHTML = `
      <div class="pk-tab-layout">
        <div class="pane-form">
          <h3>${t('table_editor.section_pk_settings')}</h3>
          <p class="tab-description">${t('table_editor.desc_pk_settings')}</p>

          <div class="form-group" style="max-width: 400px; margin-top: 8px;">
            <label for="pkPhysicalName">${t('table_editor.pk_name_label')}</label>
            <input type="text" id="pkPhysicalName" value="${escapeAttr(draft.pkName || `PK_${draft.name}`)}" placeholder="${t('table_editor.pk_name_placeholder', { name: draft.name })}" />
          </div>

          <div class="dual-list-container">
            <!-- 左側：PK対象カラム -->
            <div class="dual-list-wrapper">
              <span style="font-weight: 700; font-size: 12px; margin-bottom: 6px; display: flex; align-items: center; gap: 4px;">
                <span class="badge badge-pk">PK</span> ${t('table_editor.pk_target_columns')}
              </span>
              <div class="dual-list-inner">
                <select id="leftPkList" multiple>
                  ${leftOptionsHtml}
                </select>
                <div style="display: flex; flex-direction: column; gap: 6px; justify-content: center;">
                  <button type="button" class="btn btn-secondary btn-icon" id="btnPkUp" title="${t('table_editor.tip_reorder_up')}">▲</button>
                  <button type="button" class="btn btn-secondary btn-icon" id="btnPkDown" title="${t('table_editor.tip_reorder_down')}">▼</button>
                </div>
              </div>
            </div>

            <!-- 中央：移動ボタン -->
            <div class="dual-list-center-actions">
              <button type="button" class="btn btn-secondary" id="btnMoveToPk" style="width: 120px;">${t('table_editor.btn_add_to_pk')}</button>
              <button type="button" class="btn btn-secondary" id="btnMoveFromPk" style="width: 120px;">${t('table_editor.btn_remove_from_pk')}</button>
            </div>

            <!-- 右側：PK以外のカラム -->
            <div class="dual-list-wrapper">
              <span style="font-weight: 700; font-size: 12px; margin-bottom: 6px; color: var(--text-secondary);">
                ${t('table_editor.pk_other_columns')}
              </span>
              <select id="rightPkList" multiple>
                ${rightOptionsHtml}
              </select>
            </div>
          </div>
        </div>
      </div>
    `;

    // PK名変更
    const pkNameInput = container.querySelector('#pkPhysicalName');
    pkNameInput?.addEventListener('input', (e) => {
      draft.pkName = e.target.value.trim();
    });
    pkNameInput?.addEventListener('change', () => this.pushHistory());

    const leftSelect = container.querySelector('#leftPkList');
    const rightSelect = container.querySelector('#rightPkList');

    // PK順序 上へ
    container.querySelector('#btnPkUp')?.addEventListener('click', () => {
      const selected = Array.from(leftSelect.selectedOptions).map(opt => opt.value);
      if (selected.length === 0) return;
      const order = [...draft.pkOrder];
      for (let i = 0; i < order.length; i++) {
        if (selected.includes(order[i]) && i > 0 && !selected.includes(order[i - 1])) {
          const temp = order[i];
          order[i] = order[i - 1];
          order[i - 1] = temp;
        }
      }
      draft.pkOrder = order;
      this.pushHistory();
      this.renderPkTab();
    });

    // PK順序 下へ
    container.querySelector('#btnPkDown')?.addEventListener('click', () => {
      const selected = Array.from(leftSelect.selectedOptions).map(opt => opt.value);
      if (selected.length === 0) return;
      const order = [...draft.pkOrder];
      for (let i = order.length - 1; i >= 0; i--) {
        if (selected.includes(order[i]) && i < order.length - 1 && !selected.includes(order[i + 1])) {
          const temp = order[i];
          order[i] = order[i + 1];
          order[i + 1] = temp;
        }
      }
      draft.pkOrder = order;
      this.pushHistory();
      this.renderPkTab();
    });

    // PKに追加
    container.querySelector('#btnMoveToPk')?.addEventListener('click', () => {
      const selected = Array.from(rightSelect.selectedOptions).map(opt => opt.value);
      if (selected.length === 0) return;
      selected.forEach(colName => {
        if (!draft.pkOrder.includes(colName)) {
          draft.pkOrder.push(colName);
        }
        const f = fields.find(field => field.name === colName);
        if (f) {
          f.pk = true;
          f.not_null = true;
        }
      });
      this.pushHistory();
      this.renderPkTab();
    });

    // PKから除外
    container.querySelector('#btnMoveFromPk')?.addEventListener('click', () => {
      const selected = Array.from(leftSelect.selectedOptions).map(opt => opt.value);
      if (selected.length === 0) return;
      draft.pkOrder = draft.pkOrder.filter(n => !selected.includes(n));
      selected.forEach(colName => {
        const f = fields.find(field => field.name === colName);
        if (f) f.pk = false;
      });
      this.pushHistory();
      this.renderPkTab();
    });
  }

  // =========================================================================
  // ④ ⚡ インデックスタブ (index) - 2ペイン ＋ デュアルリスト ＋ 関数式追加
  // =========================================================================
  renderIndexTab() {
    const container = this.element.querySelector('#tabContentIndex');
    if (!container || !this.draft) return;

    this.validateAll();
    const draft = this.draft;
    const indexes = draft.indexes || [];
    const fields = draft.fields || [];

    if (this._selectedIndexIndex >= indexes.length) {
      this._selectedIndexIndex = Math.max(0, indexes.length - 1);
    }
    const selectedIdx = this._selectedIndexIndex;

    // 左ペイン：一覧
    let rowsHtml = '';
    indexes.forEach((idx, i) => {
      const isSelected = i === selectedIdx;
      const errMsg = this._errors.indexes?.[i] || '';
      const hasError = Boolean(errMsg);
      const colSummary = (idx.columns || []).map(c => typeof c === 'object' && c !== null ? c.value : c).join(', ');
      rowsHtml += `
        <tr class="${isSelected ? 'selected-row' : ''} ${hasError ? 'has-error-row' : ''}" data-index="${i}">
          <td style="width: 35px; text-align: center;">${i + 1}</td>
          <td>${hasError ? '<span title="' + escapeAttr(errMsg) + '" style="margin-right: 4px;">⚠️</span>' : ''}<b>${escapeHtml(idx.name || `IDX_${i + 1}`)}</b></td>
          <td style="width: 60px; text-align: center;">${idx.unique ? '✓' : '-'}</td>
          <td>${escapeHtml(colSummary || '-')}</td>
        </tr>
      `;
    });

    // 右ペイン：詳細フォーム
    const selectedIdxObj = indexes[selectedIdx];
    let rightFormHtml = '';

    if (selectedIdxObj) {
      const targetCols = selectedIdxObj.columns || [];
      const leftOptionsHtml = targetCols.map((c, i) => {
        const isExpr = c.type === 'expression';
        // 日本語コメント: 式インデックスのプレフィックス表示を多言語化
        const display = isExpr ? t('table_editor.idx_expr_prefix', { expr: c.value }) : c.value;
        return `<option value="${i}">${escapeHtml(display)}</option>`;
      }).join('');

      const nonTargetFields = fields.filter(f => !targetCols.some(c => c.type !== 'expression' && c.value.toUpperCase() === f.name.toUpperCase()));
      const rightOptionsHtml = nonTargetFields.map(f =>
        `<option value="${escapeAttr(f.name)}">${escapeHtml(f.name)}</option>`
      ).join('');

      // 日本語コメント: インデックス詳細フォームのラベルおよびプレースホルダーを多言語化
      rightFormHtml = `
        <div class="pane-form">
          <h3>${t('table_editor.section_idx_detail', { num: selectedIdx + 1 })}</h3>

          <div class="form-row-2">
            <div class="form-group" style="flex: 1.5;">
              <label for="idxName">${t('table_editor.idx_name')}</label>
              <input type="text" id="idxName" value="${escapeAttr(selectedIdxObj.name || '')}" placeholder="${t('table_editor.idx_name_placeholder')}" />
            </div>
            <div class="form-group" style="flex: 0.8;">
              <label for="idxType">${t('table_editor.idx_type_label')}</label>
              <select id="idxType">
                <option value="btree" ${selectedIdxObj.type === 'btree' ? 'selected' : ''}>btree</option>
                <option value="hash" ${selectedIdxObj.type === 'hash' ? 'selected' : ''}>hash</option>
              </select>
            </div>
          </div>

          <div class="form-group-checkboxes">
            <label><input type="checkbox" id="idxUnique" ${selectedIdxObj.unique ? 'checked' : ''} /> <span>${t('table_editor.idx_chk_unique')}</span></label>
          </div>

          <div class="form-group">
            <label for="idxNote">${t('table_editor.idx_note_label')}</label>
            <input type="text" id="idxNote" value="${escapeAttr(selectedIdxObj.note || '')}" placeholder="${t('table_editor.idx_note_placeholder')}" />
          </div>

          <!-- 対象カラム デュアルリスト -->
          <div class="dual-list-container" style="margin-top: 8px;">
            <div class="dual-list-wrapper">
              <span style="font-weight: 700; font-size: 12px; margin-bottom: 4px;">${t('table_editor.idx_target_columns')}</span>
              <div class="dual-list-inner">
                <select id="leftIdxList" multiple>
                  ${leftOptionsHtml}
                </select>
                <div style="display: flex; flex-direction: column; gap: 6px; justify-content: center;">
                  <button type="button" class="btn btn-secondary btn-icon" id="btnIdxUp">▲</button>
                  <button type="button" class="btn btn-secondary btn-icon" id="btnIdxDown">▼</button>
                </div>
              </div>
            </div>

            <div class="dual-list-center-actions">
              <button type="button" class="btn btn-secondary" id="btnMoveToIdx" style="width: 100px;">${t('table_editor.btn_add_to_idx')}</button>
              <button type="button" class="btn btn-secondary" id="btnMoveFromIdx" style="width: 100px;">${t('table_editor.btn_remove_from_idx')}</button>
            </div>

            <div class="dual-list-wrapper">
              <span style="font-weight: 700; font-size: 12px; margin-bottom: 4px; color: var(--text-secondary);">${t('table_editor.idx_other_columns')}</span>
              <select id="rightIdxList" multiple>
                ${rightOptionsHtml}
              </select>
            </div>
          </div>

          <!-- 関数式インデックス追加バー -->
          <div style="display: flex; gap: 8px; margin-top: 10px; align-items: center; border-top: 1px dashed var(--border-color); padding-top: 8px;">
            <input type="text" id="inputCustomExpr" placeholder="${t('table_editor.idx_expr_placeholder')}" style="flex: 1;" />
            <button type="button" class="btn btn-secondary" id="btnAddCustomExpr">${t('table_editor.btn_add_expr')}</button>
          </div>
        </div>
      `;
    } else {
      rightFormHtml = `<div class="placeholder-msg">${t('table_editor.msg_select_index')}</div>`;
    }

    container.innerHTML = `
      <div class="pane-layout">
        <!-- 左ペイン：一覧 -->
        <div class="left-pane" style="flex: 1.3;">
          <div class="table-wrapper">
            <table class="grid-table" id="idxGridTable">
              <thead>
                <tr>
                  <th style="width: 35px;">#</th>
                  <th>${t('table_editor.idx_name')}</th>
                  <th style="width: 60px; text-align: center;">${t('table_editor.idx_grid_unique')}</th>
                  <th>${t('table_editor.idx_columns')}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || `<tr><td colspan="4" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_editor.no_indexes')}</td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="grid-actions">
            <button type="button" class="action-btn btn-success" id="btnAddIdx">+ ${t('table_editor.btn_add_index')}</button>
            <button type="button" class="action-btn btn-danger" id="btnDelIdx" ${indexes.length === 0 ? 'disabled' : ''}>🗑️ ${t('common.delete')}</button>
          </div>
        </div>

        <!-- 右ペイン：詳細フォーム -->
        <div class="right-pane" style="flex: 2;">
          ${rightFormHtml}
        </div>
      </div>
    `;

    initResizableColumns(container.querySelector('#idxGridTable'));

    // 行選択
    container.querySelectorAll('#idxGridTable tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.getAttribute('data-index'));
        if (!isNaN(idx) && idx !== this._selectedIndexIndex) {
          this._selectedIndexIndex = idx;
          this.renderIndexTab();
        }
      });
    });

    // 追加
    container.querySelector('#btnAddIdx')?.addEventListener('click', () => {
      indexes.push({
        name: `IDX_${draft.name}_${indexes.length + 1}`,
        type: 'btree',
        unique: false,
        note: '',
        columns: [],
      });
      this._selectedIndexIndex = indexes.length - 1;
      this.pushHistory();
      this.renderIndexTab();
    });

    // 削除
    container.querySelector('#btnDelIdx')?.addEventListener('click', () => {
      if (indexes.length === 0) return;
      indexes.splice(this._selectedIndexIndex, 1);
      if (this._selectedIndexIndex >= indexes.length) {
        this._selectedIndexIndex = Math.max(0, indexes.length - 1);
      }
      this.pushHistory();
      this.renderIndexTab();
    });

    // 詳細フォームイベント
    if (selectedIdxObj) {
      container.querySelector('#idxName')?.addEventListener('change', (e) => {
        selectedIdxObj.name = e.target.value.trim();
        this.pushHistory();
        this.renderIndexTab();
      });

      container.querySelector('#idxType')?.addEventListener('change', (e) => {
        selectedIdxObj.type = e.target.value;
        this.pushHistory();
      });

      container.querySelector('#idxUnique')?.addEventListener('change', (e) => {
        selectedIdxObj.unique = e.target.checked;
        this.pushHistory();
        this.renderIndexTab();
      });

      container.querySelector('#idxNote')?.addEventListener('change', (e) => {
        selectedIdxObj.note = e.target.value.trim();
        this.pushHistory();
      });

      const leftSelect = container.querySelector('#leftIdxList');
      const rightSelect = container.querySelector('#rightIdxList');

      // 追加
      container.querySelector('#btnMoveToIdx')?.addEventListener('click', () => {
        const selectedCols = Array.from(rightSelect.selectedOptions).map(opt => opt.value);
        if (selectedCols.length === 0) return;
        selectedCols.forEach(colName => {
          selectedIdxObj.columns.push({ value: colName, type: 'column' });
        });
        this.pushHistory();
        this.renderIndexTab();
      });

      // 除外
      container.querySelector('#btnMoveFromIdx')?.addEventListener('click', () => {
        const selectedIndices = Array.from(leftSelect.selectedOptions).map(opt => Number(opt.value)).sort((a, b) => b - a);
        if (selectedIndices.length === 0) return;
        selectedIndices.forEach(idx => {
          selectedIdxObj.columns.splice(idx, 1);
        });
        this.pushHistory();
        this.renderIndexTab();
      });

      // 順序 上へ
      container.querySelector('#btnIdxUp')?.addEventListener('click', () => {
        const selectedIndices = Array.from(leftSelect.selectedOptions).map(opt => Number(opt.value)).sort((a, b) => a - b);
        if (selectedIndices.length === 0 || selectedIndices[0] === 0) return;
        selectedIndices.forEach(idx => {
          const temp = selectedIdxObj.columns[idx];
          selectedIdxObj.columns[idx] = selectedIdxObj.columns[idx - 1];
          selectedIdxObj.columns[idx - 1] = temp;
        });
        this.pushHistory();
        this.renderIndexTab();
      });

      // 順序 下へ
      container.querySelector('#btnIdxDown')?.addEventListener('click', () => {
        const selectedIndices = Array.from(leftSelect.selectedOptions).map(opt => Number(opt.value)).sort((a, b) => b - a);
        if (selectedIndices.length === 0 || selectedIndices[0] === selectedIdxObj.columns.length - 1) return;
        selectedIndices.forEach(idx => {
          const temp = selectedIdxObj.columns[idx];
          selectedIdxObj.columns[idx] = selectedIdxObj.columns[idx + 1];
          selectedIdxObj.columns[idx + 1] = temp;
        });
        this.pushHistory();
        this.renderIndexTab();
      });

      // 関数式追加
      container.querySelector('#btnAddCustomExpr')?.addEventListener('click', () => {
        const exprInput = container.querySelector('#inputCustomExpr');
        const expr = exprInput?.value.trim();
        if (!expr) return;
        const cleanExpr = expr.replace(/^`|`$/g, '');
        selectedIdxObj.columns.push({ value: cleanExpr, type: 'expression' });
        this.pushHistory();
        this.renderIndexTab();
      });
    }
  }

  // =========================================================================
  // ⑤ 🔗 FKタブ (fk) - 外部キー (Ref) エディタ
  // =========================================================================
  renderFkTab() {
    const container = this.element.querySelector('#tabContentFk');
    if (!container || !this.draft) return;

    const draft = this.draft;
    const refs = draft.refs || [];
    const fields = draft.fields || [];

    if (this._selectedFkIndex >= refs.length) {
      this._selectedFkIndex = Math.max(0, refs.length - 1);
    }
    const selectedIdx = this._selectedFkIndex;

    // 左ペイン：自テーブルのFK一覧
    let rowsHtml = '';
    this.validateAll();
    refs.forEach((ref, i) => {
      const isSelected = i === selectedIdx;
      const errMsg = this._errors.fks?.[i] || '';
      const hasError = Boolean(errMsg);
      const localEp = (ref.endpoints || [])[0] || {};
      const foreignEp = (ref.endpoints || [])[1] || {};
      const relSummary = foreignEp.tableName
        ? `${localEp.fieldNames?.join(',') || '?'} -> ${foreignEp.tableName}.${foreignEp.fieldNames?.join(',') || '?'}`
        : t('table_editor.fk_not_set');

      rowsHtml += `
        <tr class="${isSelected ? 'selected-row' : ''} ${hasError ? 'has-error-row' : ''}" data-index="${i}">
          <td style="width: 35px; text-align: center;">${i + 1}</td>
          <td>${hasError ? '<span title="' + escapeAttr(errMsg) + '" style="margin-right: 4px;">⚠️</span>' : ''}<b>${escapeHtml(ref.name || `FK_${i + 1}`)}</b></td>
          <td>${escapeHtml(relSummary)}</td>
        </tr>
      `;
    });

    // 右ペイン：詳細フォーム
    const selectedRef = refs[selectedIdx];
    let rightFormHtml = '';

    if (selectedRef) {
      const localEp = (selectedRef.endpoints || [])[0] || { tableName: draft.name, fieldNames: [''], relation: 'many-to-one' };
      const foreignEp = (selectedRef.endpoints || [])[1] || { tableName: '', fieldNames: [''], relation: 'many-to-one' };

      // 自テーブルのカラム選択肢
      const localColOptions = fields.map(f =>
        `<option value="${escapeAttr(f.name)}" ${localEp.fieldNames?.[0] === f.name ? 'selected' : ''}>${escapeHtml(f.name)} ${f.logicalName ? `(${escapeHtml(f.logicalName)})` : ''}</option>`
      ).join('');

      // 同スキーマ内の他テーブル一覧
      const otherTables = (appStore.state.tables || []).filter(t => t.name.toUpperCase() !== draft.name.toUpperCase());
      const foreignTableOptions = otherTables.map(t =>
        `<option value="${escapeAttr(t.name)}" ${foreignEp.tableName === t.name ? 'selected' : ''}>${escapeHtml(t.name)} ${t.logicalName ? `(${escapeHtml(t.logicalName)})` : ''}</option>`
      ).join('');

      // 参照先テーブルのカラム選択肢
      const foreignTableObj = otherTables.find(t => t.name === foreignEp.tableName);
      let foreignColOptions = `<option value="">${t('table_editor.fk_select_foreign_table_first')}</option>`;
      if (foreignTableObj && foreignTableObj.fields) {
        foreignColOptions = foreignTableObj.fields.map(f =>
          `<option value="${escapeAttr(f.name)}" ${foreignEp.fieldNames?.[0] === f.name ? 'selected' : ''}>${escapeHtml(f.name)} ${f.pk ? '🔑 PK' : ''}</option>`
        ).join('');
      }

      // 多重度判定 ('*'/'1' と 'many'/'one' 両対応)
      const isOne = (r) => r === '1' || r === 'one';
      const isMany = (r) => r === '*' || r === 'many' || (r && r.includes('*'));
      let relationType = 'many-to-one';
      if (isOne(localEp.relation) && isMany(foreignEp.relation)) relationType = 'one-to-many';
      else if (isOne(localEp.relation) && isOne(foreignEp.relation)) relationType = 'one-to-one';
      else if (isMany(localEp.relation) && isMany(foreignEp.relation)) relationType = 'many-to-many';

      // 日本語コメント: 外部キー詳細フォームの各種ラベルおよびプレースホルダーを多言語化
      rightFormHtml = `
        <div class="pane-form">
          <h3>${t('table_editor.section_fk_detail', { num: selectedIdx + 1 })}</h3>

          <div class="form-group" style="max-width: 400px;">
            <label for="fkName">${t('table_editor.fk_name_label')}</label>
            <input type="text" id="fkName" value="${escapeAttr(selectedRef.name || '')}" placeholder="${t('table_editor.fk_name_placeholder')}" />
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label for="fkLocalCol">${t('table_editor.fk_local_col_label', { tableName: escapeHtml(draft.name) })}</label>
              <select id="fkLocalCol">${localColOptions}</select>
            </div>

            <div class="form-group">
              <label for="fkForeignTable">${t('table_editor.fk_foreign_table_label')}</label>
              <select id="fkForeignTable">
                <option value="">${t('table_editor.fk_select_table_prompt')}</option>
                ${foreignTableOptions}
              </select>
            </div>

            <div class="form-group">
              <label for="fkForeignCol">${t('table_editor.fk_foreign_col_label')}</label>
              <select id="fkForeignCol">${foreignColOptions}</select>
            </div>
          </div>

          <div class="form-row-2">
            <div class="form-group">
              <label for="fkRelationType">${t('table_editor.fk_cardinality_label')}</label>
              <select id="fkRelationType">
                <option value="many-to-one" ${relationType === 'many-to-one' ? 'selected' : ''}>${t('table_editor.fk_cardinality_m_1')}</option>
                <option value="one-to-many" ${relationType === 'one-to-many' ? 'selected' : ''}>${t('table_editor.fk_cardinality_1_m')}</option>
                <option value="one-to-one" ${relationType === 'one-to-one' ? 'selected' : ''}>${t('table_editor.fk_cardinality_1_1')}</option>
                <option value="many-to-many" ${relationType === 'many-to-many' ? 'selected' : ''}>${t('table_editor.fk_cardinality_m_m')}</option>
              </select>
            </div>

            <div class="form-group">
              <label for="fkOnDelete">ON DELETE</label>
              <select id="fkOnDelete">
                <option value="" ${!selectedRef.onDelete ? 'selected' : ''}>${t('table_editor.fk_action_unspecified')}</option>
                <option value="cascade" ${selectedRef.onDelete === 'cascade' ? 'selected' : ''}>cascade</option>
                <option value="restrict" ${selectedRef.onDelete === 'restrict' ? 'selected' : ''}>restrict</option>
                <option value="set null" ${selectedRef.onDelete === 'set null' ? 'selected' : ''}>set null</option>
                <option value="set default" ${selectedRef.onDelete === 'set default' ? 'selected' : ''}>set default</option>
                <option value="no action" ${selectedRef.onDelete === 'no action' ? 'selected' : ''}>no action</option>
              </select>
            </div>

            <div class="form-group">
              <label for="fkOnUpdate">ON UPDATE</label>
              <select id="fkOnUpdate">
                <option value="" ${!selectedRef.onUpdate ? 'selected' : ''}>${t('table_editor.fk_action_unspecified')}</option>
                <option value="cascade" ${selectedRef.onUpdate === 'cascade' ? 'selected' : ''}>cascade</option>
                <option value="restrict" ${selectedRef.onUpdate === 'restrict' ? 'selected' : ''}>restrict</option>
                <option value="set null" ${selectedRef.onUpdate === 'set null' ? 'selected' : ''}>set null</option>
                <option value="set default" ${selectedRef.onUpdate === 'set default' ? 'selected' : ''}>set default</option>
                <option value="no action" ${selectedRef.onUpdate === 'no action' ? 'selected' : ''}>no action</option>
              </select>
            </div>
          </div>
        </div>
      `;
    } else {
      rightFormHtml = `<div class="placeholder-msg">${t('table_editor.msg_select_fk')}</div>`;
    }

    container.innerHTML = `
      <div class="pane-layout">
        <!-- 左ペイン -->
        <div class="left-pane" style="flex: 1.2;">
          <div class="table-wrapper">
            <table class="grid-table" id="fkGridTable">
              <thead>
                <tr>
                  <th style="width: 35px;">#</th>
                  <th>${t('table_editor.fk_grid_name')}</th>
                  <th>${t('table_editor.fk_grid_relation')}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || `<tr><td colspan="3" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_editor.no_fks')}</td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="grid-actions">
            <button type="button" class="action-btn btn-success" id="btnAddFk">${t('table_editor.btn_add_fk')}</button>
            <button type="button" class="action-btn btn-danger" id="btnDelFk" ${refs.length === 0 ? 'disabled' : ''}>🗑️ ${t('common.delete')}</button>
          </div>
        </div>

        <!-- 右ペイン -->
        <div class="right-pane" style="flex: 2;">
          ${rightFormHtml}
        </div>
      </div>
    `;

    initResizableColumns(container.querySelector('#fkGridTable'));

    // 行選択
    container.querySelectorAll('#fkGridTable tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.getAttribute('data-index'));
        if (!isNaN(idx) && idx !== this._selectedFkIndex) {
          this._selectedFkIndex = idx;
          this.renderFkTab();
        }
      });
    });

    // 追加
    container.querySelector('#btnAddFk')?.addEventListener('click', () => {
      refs.push({
        name: `FK_${draft.name}_${refs.length + 1}`,
        endpoints: [
          { tableName: draft.name, fieldNames: [fields[0]?.name || ''], relation: '*' },
          { tableName: '', fieldNames: [''], relation: '1' },
        ],
        onDelete: '',
        onUpdate: '',
      });
      this._selectedFkIndex = refs.length - 1;
      this.pushHistory();
      this.renderFkTab();
    });

    // 削除
    container.querySelector('#btnDelFk')?.addEventListener('click', () => {
      if (refs.length === 0) return;
      refs.splice(this._selectedFkIndex, 1);
      if (this._selectedFkIndex >= refs.length) {
        this._selectedFkIndex = Math.max(0, refs.length - 1);
      }
      this.pushHistory();
      this.renderFkTab();
    });

    // 詳細フォームイベント
    if (selectedRef) {
      container.querySelector('#fkName')?.addEventListener('change', (e) => {
        selectedRef.name = e.target.value.trim();
        this.pushHistory();
        this.renderFkTab();
      });

      container.querySelector('#fkLocalCol')?.addEventListener('change', (e) => {
        if (!selectedRef.endpoints[0]) selectedRef.endpoints[0] = { tableName: draft.name, fieldNames: [] };
        selectedRef.endpoints[0].tableName = draft.name;
        selectedRef.endpoints[0].fieldNames = [e.target.value];
        this.pushHistory();
        this.renderFkTab();
      });

      container.querySelector('#fkForeignTable')?.addEventListener('change', (e) => {
        const tblName = e.target.value;
        if (!selectedRef.endpoints[1]) selectedRef.endpoints[1] = { tableName: '', fieldNames: [] };
        selectedRef.endpoints[1].tableName = tblName;

        // 相手先テーブルのPKカラムまたは先頭カラムを自動セット
        const otherTbl = (appStore.state.tables || []).find(t => t.name === tblName);
        if (otherTbl && otherTbl.fields && otherTbl.fields.length > 0) {
          const pkField = otherTbl.fields.find(f => f.pk);
          selectedRef.endpoints[1].fieldNames = [pkField ? pkField.name : otherTbl.fields[0].name];
        } else {
          selectedRef.endpoints[1].fieldNames = [''];
        }
        this.pushHistory();
        this.renderFkTab();
      });

      container.querySelector('#fkForeignCol')?.addEventListener('change', (e) => {
        if (!selectedRef.endpoints[1]) selectedRef.endpoints[1] = { tableName: '', fieldNames: [] };
        selectedRef.endpoints[1].fieldNames = [e.target.value];
        this.pushHistory();
        this.renderFkTab();
      });

      container.querySelector('#fkRelationType')?.addEventListener('change', (e) => {
        const rel = e.target.value;
        if (rel === 'many-to-one') {
          selectedRef.endpoints[0].relation = '*';
          selectedRef.endpoints[1].relation = '1';
        } else if (rel === 'one-to-many') {
          selectedRef.endpoints[0].relation = '1';
          selectedRef.endpoints[1].relation = '*';
        } else if (rel === 'one-to-one') {
          selectedRef.endpoints[0].relation = '1';
          selectedRef.endpoints[1].relation = '1';
        } else if (rel === 'many-to-many') {
          selectedRef.endpoints[0].relation = '*';
          selectedRef.endpoints[1].relation = '*';
        }
        this.pushHistory();
      });

      container.querySelector('#fkOnDelete')?.addEventListener('change', (e) => {
        selectedRef.onDelete = e.target.value;
        this.pushHistory();
      });

      container.querySelector('#fkOnUpdate')?.addEventListener('change', (e) => {
        selectedRef.onUpdate = e.target.value;
        this.pushHistory();
      });
    }
  }

  // =========================================================================
  // ⑥ ✅ Checkタブ (check) - Check 制約エディタ
  // =========================================================================
  renderCheckTab() {
    const container = this.element.querySelector('#tabContentCheck');
    if (!container || !this.draft) return;

    const draft = this.draft;
    const checks = draft.checks || [];

    if (this._selectedCheckIndex >= checks.length) {
      this._selectedCheckIndex = Math.max(0, checks.length - 1);
    }
    const selectedIdx = this._selectedCheckIndex;

    this.validateAll();
    // 左ペイン：一覧
    let rowsHtml = '';
    checks.forEach((c, i) => {
      const isSelected = i === selectedIdx;
      const errMsg = this._errors.checks?.[i] || '';
      const hasError = Boolean(errMsg);
      rowsHtml += `
        <tr class="${isSelected ? 'selected-row' : ''} ${hasError ? 'has-error-row' : ''}" data-index="${i}">
          <td style="width: 35px; text-align: center;">${i + 1}</td>
          <td>${hasError ? '<span title="' + escapeAttr(errMsg) + '" style="margin-right: 4px;">⚠️</span>' : ''}<b>${escapeHtml(c.name || `CHK_${i + 1}`)}</b></td>
          <td><code>${escapeHtml(c.expression || '-')}</code></td>
        </tr>
      `;
    });

    // 右ペイン：詳細フォーム
    const selectedChk = checks[selectedIdx];
    let rightFormHtml = '';

    if (selectedChk) {
      // 日本語コメント: Check制約詳細フォームのラベルおよびプレースホルダーを多言語化
      rightFormHtml = `
        <div class="pane-form">
          <h3>${t('table_editor.section_check_detail', { num: selectedIdx + 1 })}</h3>

          <div class="form-group">
            <label for="chkName">${t('table_editor.chk_name_label')}</label>
            <input type="text" id="chkName" value="${escapeAttr(selectedChk.name || '')}" placeholder="${t('table_editor.chk_name_placeholder')}" />
          </div>

          <div class="form-group">
            <label for="chkExpr">${t('table_editor.chk_expr_label')} <span style="color: var(--danger);">*</span></label>
            <textarea id="chkExpr" rows="4" placeholder="${t('table_editor.chk_expr_placeholder')}">${escapeHtml(selectedChk.expression || '')}</textarea>
          </div>
        </div>
      `;
    } else {
      rightFormHtml = `<div class="placeholder-msg">${t('table_editor.msg_select_check')}</div>`;
    }

    container.innerHTML = `
      <div class="pane-layout">
        <!-- 左ペイン -->
        <div class="left-pane" style="flex: 1.2;">
          <div class="table-wrapper">
            <table class="grid-table" id="chkGridTable">
              <thead>
                <tr>
                  <th style="width: 35px;">#</th>
                  <th>${t('table_editor.chk_grid_name')}</th>
                  <th>${t('table_editor.chk_grid_expr')}</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || `<tr><td colspan="3" style="text-align:center; color: var(--text-muted); padding: 16px;">${t('table_editor.no_checks')}</td></tr>`}
              </tbody>
            </table>
          </div>

          <div class="grid-actions">
            <button type="button" class="action-btn btn-success" id="btnAddChk">${t('table_editor.btn_add_check')}</button>
            <button type="button" class="action-btn btn-danger" id="btnDelChk" ${checks.length === 0 ? 'disabled' : ''}>🗑️ ${t('common.delete')}</button>
          </div>
        </div>

        <!-- 右ペイン -->
        <div class="right-pane" style="flex: 2;">
          ${rightFormHtml}
        </div>
      </div>
    `;

    initResizableColumns(container.querySelector('#chkGridTable'));

    // 行選択
    container.querySelectorAll('#chkGridTable tbody tr').forEach(tr => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.getAttribute('data-index'));
        if (!isNaN(idx) && idx !== this._selectedCheckIndex) {
          this._selectedCheckIndex = idx;
          this.renderCheckTab();
        }
      });
    });

    // 追加
    container.querySelector('#btnAddChk')?.addEventListener('click', () => {
      checks.push({
        name: `CHK_${draft.name}_${checks.length + 1}`,
        expression: '',
      });
      this._selectedCheckIndex = checks.length - 1;
      this.pushHistory();
      this.renderCheckTab();
    });

    // 削除
    container.querySelector('#btnDelChk')?.addEventListener('click', () => {
      if (checks.length === 0) return;
      checks.splice(this._selectedCheckIndex, 1);
      if (this._selectedCheckIndex >= checks.length) {
        this._selectedCheckIndex = Math.max(0, checks.length - 1);
      }
      this.pushHistory();
      this.renderCheckTab();
    });

    // 詳細フォームイベント
    if (selectedChk) {
      container.querySelector('#chkName')?.addEventListener('change', (e) => {
        selectedChk.name = e.target.value.trim();
        this.pushHistory();
        this.renderCheckTab();
      });

      container.querySelector('#chkExpr')?.addEventListener('change', (e) => {
        selectedChk.expression = e.target.value.trim();
        this.pushHistory();
        this.renderCheckTab();
      });
    }
  }

  // =========================================================================
  // カラム拡張設計メタデータモーダル
  // =========================================================================
  openColumnMetadataModal(fieldIndex) {
    const f = this.draft.fields[fieldIndex];
    if (!f) return;

    const dialect = appStore.state.activeDialect;
    const currentDialect = dialect?.id || appStore.state.project?.databaseType || 'standard';
    const schemas = metadataManager.getColumnAttributes(currentDialect);
    if (schemas.length === 0) return;

    const modalBackdrop = document.createElement('div');
    modalBackdrop.className = 'col-meta-modal-backdrop';

    const modalFormRows = schemas.map(attr => {
      const labelText = metadataManager.resolveLabel(attr);
      const curVal = f.custom && f.custom[attr.key] !== undefined
        ? f.custom[attr.key]
        : (attr.default !== undefined ? attr.default : '');

      if (attr.type === 'boolean') {
        return `
          <div class="form-group">
            <label style="display: flex; align-items: center; gap: 0.5rem; cursor: pointer;">
              <input type="checkbox" id="modal-attr-${attr.key}" ${curVal ? 'checked' : ''} />
              <span>${escapeHtml(labelText)}</span>
            </label>
          </div>
        `;
      } else if (attr.type === 'textarea') {
        return `
          <div class="form-group">
            <label for="modal-attr-${attr.key}">${escapeHtml(labelText)}</label>
            <textarea id="modal-attr-${attr.key}" rows="3">${escapeHtml(curVal)}</textarea>
          </div>
        `;
      } else {
        return `
          <div class="form-group">
            <label for="modal-attr-${attr.key}">${escapeHtml(labelText)}</label>
            <input type="${attr.type === 'number' ? 'number' : 'text'}" id="modal-attr-${attr.key}" value="${escapeAttr(curVal)}" />
          </div>
        `;
      }
    }).join('');

    // 日本語コメント: 旧モーダルのタイトルおよびボタン文言を多言語化
    modalBackdrop.innerHTML = `
      <div class="col-meta-modal-card">
        <div class="col-meta-modal-header">
          <div class="col-meta-modal-title">${t('table_editor.modal_col_meta_title', { name: escapeHtml(f.name) })}</div>
          <button type="button" class="btn btn-secondary btn-close-modal" style="padding: 2px 8px;">✕</button>
        </div>
        <div class="col-meta-modal-body">
          ${modalFormRows}
        </div>
        <div class="col-meta-modal-footer">
          <button type="button" class="btn btn-secondary btn-close-modal">${t('common.cancel')}</button>
          <button type="button" class="btn btn-primary btn-save-modal">${t('table_editor.btn_apply')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(modalBackdrop);

    const closeModal = () => modalBackdrop.remove();
    modalBackdrop.querySelectorAll('.btn-close-modal').forEach(btn => btn.addEventListener('click', closeModal));

    modalBackdrop.querySelector('.btn-save-modal').addEventListener('click', () => {
      if (!f.custom) f.custom = {};
      schemas.forEach(attr => {
        const el = modalBackdrop.querySelector(`#modal-attr-${attr.key}`);
        if (!el) return;
        if (attr.type === 'boolean') {
          f.custom[attr.key] = el.checked;
        } else if (attr.type === 'number') {
          f.custom[attr.key] = el.value === '' ? '' : Number(el.value);
        } else {
          f.custom[attr.key] = el.value.trim();
        }
      });
      closeModal();
      this.pushHistory();
      this.renderColumnTab();
    });
  }

  // =========================================================================
  // 保存処理 (handleSave)
  // =========================================================================
  async handleSave() {
    if (!this.validateAll()) {
      // 日本語コメント: 保存時バリデーションエラーダイアログの多言語化
      alert(t('table_editor.alert_save_validation_error'));
      return;
    }

    const draft = this.draft;
    const oldTableName = this.isNew ? null : this.currentTable?.name;
    const newTableName = draft.name;

    // 1. 全フィールドの合成型文字列 (type) を確実に同期
    (draft.fields || []).forEach((_, i) => {
      this.syncFieldTypeString(i);
    });

    // 2. PKインデックスの構築
    const finalIndexes = [];
    const pkFields = (draft.fields || []).filter(f => f.pk);

    if (pkFields.length > 0) {
      let pkColNames = [];
      if (Array.isArray(draft.pkOrder) && draft.pkOrder.length > 0) {
        pkColNames = draft.pkOrder.filter(n => pkFields.some(pf => pf.name.toUpperCase() === n.toUpperCase()));
        for (const pf of pkFields) {
          if (!pkColNames.some(c => c.toUpperCase() === pf.name.toUpperCase())) {
            pkColNames.push(pf.name);
          }
        }
      } else {
        pkColNames = pkFields.map(f => f.name);
      }

      const pkName = (draft.pkName && draft.pkName.trim()) ? draft.pkName.trim() : `PK_${newTableName}`;

      finalIndexes.push({
        name: pkName,
        pk: true,
        unique: false,
        columns: pkColNames.map(c => ({ value: c, type: 'column' })),
      });
    }

    // 通常インデックスを結合
    (draft.indexes || []).forEach(idx => {
      if (!idx.pk) {
        finalIndexes.push({
          ...idx,
          columns: (idx.columns || []).map(c => typeof c === 'object' && c !== null ? c : { value: String(c), type: 'column' }),
        });
      }
    });

    // 3. テーブルオブジェクトの生成（logicalName の改行コードは無効化）
    const sanitizeLogicalName = (val) => String(val || '').replace(/[\r\n]+/g, '').trim();
    const sanitizedFields = (draft.fields || []).map(f => ({
      ...f,
      logicalName: sanitizeLogicalName(f.logicalName),
    }));
    const updatedTable = {
      name: newTableName,
      logicalName: sanitizeLogicalName(draft.logicalName),
      headerColor: draft.headerColor || '',
      note: draft.note || '',
      custom: draft.custom ? { ...draft.custom } : {},
      fields: sanitizedFields,
      indexes: finalIndexes,
      checks: draft.checks || [],
      pkName: draft.pkName || `PK_${newTableName}`,
      pkOrder: draft.pkOrder || [],
    };

    // 3.5. 保存前 1テーブル単体 DBML パース検証（FKはクライアントバリデーションで担保するため除外）
    try {
      appStore.emit('status:message', t('table_editor.status_validating_dbml'));
      const singleTableDbml = generateDbml({
        project: appStore.state.project || null,
        tables: [updatedTable],
        tableGroups: [],
        notes: [],
        refs: [],
      });
      const parseRes = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbml: singleTableDbml }),
      });
      if (!parseRes.ok) {
        const errData = await parseRes.json().catch(() => ({}));
        const diag = Array.isArray(errData.diags) && errData.diags.length > 0 ? errData.diags[0] : null;
        const lineNum = diag?.location?.start?.line;
        const diagMsg = diag?.message || errData.error || 'Syntax error';
        const detail = lineNum ? `L${lineNum}: ${diagMsg}` : diagMsg;

        // 日本語コメント: エラー行に含まれるカラム名から該当カラムを推定して選択・ハイライトする
        if (lineNum && typeof singleTableDbml === 'string') {
          const errLineText = singleTableDbml.split(/\r?\n/)[lineNum - 1] || '';
          const matchedColIdx = (draft.fields || []).findIndex(f =>
            f.name && errLineText.includes(f.name)
          );
          if (matchedColIdx >= 0) {
            this._selectedColumnIndex = matchedColIdx;
            this._errors.columns[matchedColIdx] = detail;
            this.activeTab = 'column';
            this.element?.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.getAttribute('data-tab') === 'column'));
            this.element?.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.getAttribute('data-tab-content') === 'column'));
            this.renderColumnTab();
          }
        }

        this._errors.dbmlParse = t('table_editor.err_dbml_parse_failed', { detail });
        this.updateErrorUI();
        return;
      }
    } catch (err) {
      // 通信エラー等の場合はパース失敗として保存を中断する
      this._errors.dbmlParse = t('table_editor.err_dbml_parse_failed', { detail: err.message });
      this.updateErrorUI();
      return;
    }

    // 4. tables 配列の更新
    const tables = [...(appStore.state.tables || [])];
    const targetIdx = tables.findIndex(t => t.name.toUpperCase() === (oldTableName ? oldTableName.toUpperCase() : ''));

    if (targetIdx >= 0) {
      tables[targetIdx] = updatedTable;
    } else {
      tables.push(updatedTable);
    }

    // 5. refs (外部キー) の更新とテーブル名変更時の追従
    let currentRefs = [...(appStore.state.refs || [])];

    if (oldTableName) {
      // 自テーブルが参照元だった既存 Ref を除外
      currentRefs = currentRefs.filter(r => r.endpoints?.[0]?.tableName?.toUpperCase() !== oldTableName.toUpperCase());

      // 他テーブルから旧テーブル名を参照していた endpoints[1] を新テーブル名に更新
      currentRefs.forEach(r => {
        if (r.endpoints?.[1]?.tableName?.toUpperCase() === oldTableName.toUpperCase()) {
          r.endpoints[1].tableName = newTableName;
        }
      });
    }

    // ドラフト内の有効な FK を追加
    (draft.refs || []).forEach(ref => {
      const foreignEp = ref.endpoints?.[1];
      if (foreignEp && foreignEp.tableName && foreignEp.fieldNames?.[0]) {
        currentRefs.push({
          ...ref,
          endpoints: [
            {
              tableName: newTableName,
              fieldNames: ref.endpoints[0]?.fieldNames || [],
              relation: ref.endpoints[0]?.relation || '*',
            },
            {
              tableName: foreignEp.tableName,
              fieldNames: foreignEp.fieldNames || [],
              relation: foreignEp.relation || '1',
            },
          ],
        });
      }
    });

    // 6. Store の更新
    appStore.setModel({
      project: appStore.state.project,
      tables: tables,
      tableGroups: appStore.state.tableGroups,
      notes: appStore.state.notes,
      refs: currentRefs,
    });

    // 7. サーバへ即時保存（処理中オーバーレイは saveProject 内で自動表示）
    try {
      await projectService.saveProject();
      appStore.emit('status:message', t('project.save_success'));
    } catch (err) {
      alert(t('project.err_save_failed', { error: err.message }));
    }

    // 8. 詳細ビューへ遷移
    appStore.emit('table:select', newTableName);
  }
}
