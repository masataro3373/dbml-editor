// 日本語コメント: DBML シリアライザー (src/core/dbml-generator.js)
// UIで組み立てられた AST (Project, Table, Field, Index, Ref) から、
// @dbml/core (v12.1.0) 公式仕様に準拠したクリーンな標準 DBML テキストを自動生成します。
// - Project ブロック: カスタム属性を直下キーとして出力（案B）
// - 主キー (PK): 単一・複合・制約名の有無を問わずすべて Indexes ブロックへ完全統一
// - Note: 純粋なコメントのみを出力（HTMLコメント埋め込み廃止）
// - 論理名 (logicalName): Table および Column のインライン設定 ([logicalName: '...']) へ出力
// - その他拡張属性: ファイル末尾の Metadata Table / Metadata Column ブロックへ出力
// - クリーン消去 (方式A): プラグイン未導入または方言不一致の拡張属性・論理名を自動除去。セーフモード時は保持。

import { metadataManager } from './metadata-manager.js';
import { pluginManager } from './plugin-manager.js';

/**
 * インライン文字列（シングルクォート内）のエスケープ
 */
function escapeInlineString(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * DBMLの Note 値を適切にクォート（改行がある場合やブロック要素は '''、1行の場合は '）
 * @param {string} text - Note テキスト
 * @param {boolean} isBlock - テーブルやProject等のブロック要素かどうか
 * @param {string} indent - インデント文字列
 * @returns {string} クォートされた Note 値文字列（例: '...' または '''\n...\n'''）
 */
function quoteNote(text, isBlock = false, indent = '  ') {
  if (!text) return '';
  const hasNewline = text.includes('\n') || text.includes('\r');

  if (hasNewline || isBlock) {
    // 改行が含まれる場合、またはブロック要素の場合はトリプルクォート ''' で囲む
    const safeText = text.replace(/'''/g, "\\'\\'\\'").replace(/\r\n|\r/g, '\n');
    if (isBlock) {
      // インデントを考慮したブロックフォーマット
      const lines = safeText.split('\n').map(l => `${indent}${l}`).join('\n');
      return `'''\n${lines}\n${indent}'''`;
    } else {
      return `'''${safeText}'''`;
    }
  } else {
    // 1行の場合は単一クォート '...'
    const safeText = text.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    return `'${safeText}'`;
  }
}

/**
 * Metadata ブロック内の値を適切なリテラル形式（boolean / number / string）にフォーマット
 */
function formatMetadataValue(val) {
  if (typeof val === 'boolean' || typeof val === 'number') {
    return String(val);
  }
  const str = String(val ?? '');
  if (str === 'true' || str === 'false') {
    return str;
  }
  if (str.includes('\n') || str.includes('\r')) {
    const safeBlock = str.replace(/'''/g, "\\'\\'\\'").replace(/\r\n|\r/g, '\n');
    return `'''\n${safeBlock}\n  '''`;
  }
  return `'${escapeInlineString(str)}'`;
}

/**
 * @dbml/core (v11.0.0) のエンドポイント多重度 (ep1.relation, ep2.relation) から
 * 標準 DBML リレーション演算子（>, <, -, <>, ?<?, <? 等）へ変換
 */
const CARDINALITY_TO_OP_MAP = {
  '1|1': '-',
  '*|*': '<>',
  '*|1': '>',
  '1|*': '<',
  '1|0..1': '-?',
  '0..1|1': '?-',
  '0..1|0..1': '?-?',
  '0..*|1': '?>',
  '*|0..1': '>?',
  '0..*|0..1': '?>?',
  '0..1|*': '?<',
  '1|0..*': '<?',
  '0..1|0..*': '?<?',
  '0..*|*': '?<>',
  '*|0..*': '<>?',
  '0..*|0..*': '?<>?',
};

const VALID_DBML_REL_OPS = new Set(Object.values(CARDINALITY_TO_OP_MAP));

function getDbmlRelationshipOp(rel1, rel2) {
  const norm = (r) => {
    const s = String(r || '').trim();
    if (s === 'one') return '1';
    if (s === 'many') return '*';
    return s;
  };
  const r1 = norm(rel1);
  const r2 = norm(rel2);
  // 既に演算子形式（'>', '<', '-', '?<?' 等）が格納されている場合はそのまま返す
  if (VALID_DBML_REL_OPS.has(r1) && (!r2 || VALID_DBML_REL_OPS.has(r2))) {
    return r1;
  }
  const key = `${r1}|${r2}`;
  return CARDINALITY_TO_OP_MAP[key] || '>';
}

/**
 * 文字列を二重引用符で安全にエスケープ
 */
function quoteIdent(name) {
  if (!name) return '""';
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    return `"${name}"`;
  }
  return `"${String(name).replace(/"/g, '\\"')}"`;
}

/**
 * データ型文字列を整形（空白を含む VARCHAR2(10 BYTE) や NUMBER(3, 0) 等は二重引用符で囲む）
 */
function formatFieldType(typeStr) {
  const raw = String(typeStr || 'varchar').trim();
  if (!raw) return 'varchar';
  if (raw.startsWith('"') && raw.endsWith('"')) return raw;
  if (/\s/.test(raw)) {
    return `"${raw.replace(/"/g, '\\"')}"`;
  }
  return raw;
}

/**
 * 日本語コメント: フィールドの型名・桁数・精度から標準DBML型文字列を合成・整形
 * @param {Object|string} f - フィールドオブジェクト、または型文字列
 * @returns {string} フォーマットされたDBML型名（例: VARCHAR2(50), NUMBER(10,2), DATE）
 */
function synthesizeFieldType(f) {
  if (!f) return 'varchar';
  if (typeof f === 'string') return formatFieldType(f);

  const typeVal = typeof f.type === 'object' && f.type !== null ? (f.type.type_name || '') : (f.type || '');
  const rawBase = String(f.baseType || typeVal || 'varchar').trim();
  const base = rawBase.replace(/\(.*?\)/, '').trim() || 'varchar';
  const len = f.length !== undefined && f.length !== null ? String(f.length).trim() : '';
  const sc = f.scale !== undefined && f.scale !== null ? String(f.scale).trim() : '';

  let combined = base;
  if (len && sc) {
    combined = `${base}(${len}, ${sc})`;
  } else if (len) {
    combined = `${base}(${len})`;
  } else if (typeof typeVal === 'string' && typeVal.includes('(')) {
    // 従来の type にカッコが含まれている場合のフォールバック
    combined = typeVal.trim();
  }

  return formatFieldType(combined);
}

/**
 * DBMLのデフォルト値をデータ型に応じてスマートに整形
 */
function formatDbmlDefaultValue(defVal, fieldType) {
  if (defVal === null || defVal === undefined || String(defVal).trim() === '') return '';
  let str = String(defVal).trim();

  // すでにクォートされている場合はそのまま
  if ((str.startsWith("'") && str.endsWith("'")) ||
      (str.startsWith('"') && str.endsWith('"')) ||
      (str.startsWith('`') && str.endsWith('`'))) {
    return str;
  }

  // true / false / null
  const lower = str.toLowerCase();
  if (['true', 'false', 'null'].includes(lower)) {
    return lower;
  }

  const typeStr = (fieldType || '').toUpperCase().replace(/^"|"$/g, '').trim();
  const isStringType = /^(VARCHAR|VARCHAR2|CHAR|NVARCHAR|NVARCHAR2|TEXT|CLOB|STRING)/i.test(typeStr);
  const isNumericType = /^(NUMBER|INT|INTEGER|BIGINT|SMALLINT|TINYINT|DECIMAL|NUMERIC|FLOAT|DOUBLE)/i.test(typeStr);

  // SQL関数・式 (例: SYSDATE, NOW(), CURRENT_TIMESTAMP, GETDATE(), またはカッコを含む式)
  if (/^(SYSDATE|NOW\(\)|CURRENT_TIMESTAMP|GETDATE\(\)|LOCALTIMESTAMP)/i.test(str) || str.includes('(')) {
    return `\`${str}\``;
  }

  // 文字列型の場合: 数値 '0' 等であっても必ずシングルクォートで囲む
  if (isStringType) {
    return `'${str.replace(/'/g, "\\'")}'`;
  }

  // 数値型の場合: 単純な数値であればアンクォート
  if (isNumericType && /^-?\d+(\.\d+)?$/.test(str)) {
    return str;
  }

  // その他: 単純な数値ならアンクォート、それ以外はシングルクォート
  if (/^-?\d+(\.\d+)?$/.test(str) && !/^0\d+/.test(str)) {
    return str;
  }

  return `'${str.replace(/'/g, "\\'")}'`;
}

/**
 * ASTモデルから DBML テキストを生成
 * @param {Object} model - { project, tables, refs, tableGroups, notes }
 * @returns {string} 生成された DBML テキスト
 */
export function generateDbml(model) {
  const { project, tables = [], refs = [], tableGroups = [], notes = [] } = model || {};
  const chunks = [];
  const metadataBlocks = [];

  // 日本語コメント: セーフモード判定 (プラグインの欠落・ライブラリ不足がある場合は属性消去を防止)
  const isSafeMode = Boolean(pluginManager.hasUnhealthyPlugins);
  const currentDialect = project?.databaseType || '';
  const isLogicalNameEnabled = isSafeMode || metadataManager.isLogicalNameEnabled();
  const allowedProjectKeys = metadataManager.getAllowedProjectKeys(currentDialect);
  const allowedTableKeys = metadataManager.getAllowedTableMetadataKeys(currentDialect);
  const allowedColumnKeys = metadataManager.getAllowedColumnMetadataKeys(currentDialect);

  // 1. Project ブロックの生成（案B: カスタム属性を直下キーとして出力）
  if (project && (project.name || project.databaseType || project.note || (project.custom && Object.keys(project.custom).length > 0))) {
    const projName = project.name ? quoteIdent(project.name) : '""';
    chunks.push(`Project ${projName} {`);
    if (project.databaseType) {
      chunks.push(`  database_type: '${escapeInlineString(project.databaseType)}'`);
    }

    const pc = project.custom || {};
    if (pc.version) {
      chunks.push(`  version: '${escapeInlineString(pc.version)}'`);
    }
    
    // 表領域などの物理属性: セーフモードか許可キーに含まれる場合のみ出力 (camelCase / snake_case 両対応)
    if (isSafeMode || allowedProjectKeys.has('dataTablespaces') || allowedProjectKeys.has('data_tablespaces')) {
      const dt = pc.dataTablespaces || pc.data_tablespaces;
      if (Array.isArray(dt) && dt.length > 0) {
        chunks.push(`  data_tablespaces: '${escapeInlineString(dt.join(', '))}'`);
      } else if (typeof dt === 'string' && dt.trim()) {
        chunks.push(`  data_tablespaces: '${escapeInlineString(dt.trim())}'`);
      }
    }
    if (isSafeMode || allowedProjectKeys.has('indexTablespaces') || allowedProjectKeys.has('index_tablespaces')) {
      const it = pc.indexTablespaces || pc.index_tablespaces;
      if (Array.isArray(it) && it.length > 0) {
        chunks.push(`  index_tablespaces: '${escapeInlineString(it.join(', '))}'`);
      } else if (typeof it === 'string' && it.trim()) {
        chunks.push(`  index_tablespaces: '${escapeInlineString(it.trim())}'`);
      }
    }
    if (isSafeMode || allowedProjectKeys.has('lobTablespaces') || allowedProjectKeys.has('lob_tablespaces')) {
      const lt = pc.lobTablespaces || pc.lob_tablespaces;
      if (Array.isArray(lt) && lt.length > 0) {
        chunks.push(`  lob_tablespaces: '${escapeInlineString(lt.join(', '))}'`);
      } else if (typeof lt === 'string' && lt.trim()) {
        chunks.push(`  lob_tablespaces: '${escapeInlineString(lt.trim())}'`);
      }
    }

    // その他のカスタムProject属性があれば出力 (セーフモードまたは方言許可キー)
    const handledProjKeys = new Set([
      'version', 'dataTablespaces', 'indexTablespaces', 'lobTablespaces',
      'data_tablespaces', 'index_tablespaces', 'lob_tablespaces',
    ]);
    for (const [k, v] of Object.entries(pc)) {
      if (handledProjKeys.has(k) || v === undefined || v === null || v === '') continue;
      // 他方言専用のプラグインProject属性のみ除外し、ユーザー定義の任意カスタム項目は出力を許可
      const isDisallowedPluginKey = Array.isArray(metadataManager._projectAttributes) &&
        metadataManager._projectAttributes.some(a => a.key === k && !allowedProjectKeys.has(k));
      if (!isSafeMode && isDisallowedPluginKey) continue;
      chunks.push(`  ${k}: ${formatMetadataValue(v)}`);
    }

    // 純粋な Project Note のみを出力
    const cleanProjNote = (project.note || '').trim();
    if (cleanProjNote) {
      chunks.push(`  Note: ${quoteNote(cleanProjNote, true, '  ')}`);
    }
    chunks.push('}\n');
  }

  // 2. 各 Table ブロックの生成
  for (const tbl of tables) {
    const tblName = quoteIdent(tbl.name);
    const headerColor = tbl.headerColor || tbl.headercolor || tbl.custom?.headerColor || tbl.custom?.headercolor;
    const tblSettings = [];
    const cleanTblLogical = tbl.logicalName ? String(tbl.logicalName).replace(/[\r\n]+/g, '').trim() : '';
    if (isLogicalNameEnabled && cleanTblLogical !== '') {
      tblSettings.push(`logicalName: '${escapeInlineString(cleanTblLogical)}'`);
    }
    if (headerColor) {
      tblSettings.push(`headercolor: ${headerColor}`);
    }
    const tblSettingsStr = tblSettings.length > 0 ? ` [${tblSettings.join(', ')}]` : '';
    chunks.push(`Table ${tblName}${tblSettingsStr} {`);

    const rawFields = tbl.fields || [];
    const pkFields = rawFields.filter(f => f.pk);
    const existingPkIndex = (tbl.indexes || []).find(idx => idx.pk || idx.isPrimaryKey);

    // 主キーは単一・複合・名前の有無にかかわらずすべて Indexes ブロックに出力する
    const hasPk = pkFields.length > 0;

    // (1) フィールド定義（インライン pk は一切出力しない）
    for (const f of rawFields) {
      const fieldName = quoteIdent(f.name);
      const fieldType = synthesizeFieldType(f);
      const settings = [];

      if (f.not_null || f.pk) settings.push('not null');
      if (f.unique) settings.push('unique');
      if (f.increment) settings.push('increment');

      if (f.dbdefault !== null && f.dbdefault !== undefined && f.dbdefault !== '') {
        const formattedDef = formatDbmlDefaultValue(f.dbdefault, fieldType);
        if (formattedDef) {
          settings.push(`default: ${formattedDef}`);
        }
      }

      // カラムの論理名をインラインカスタムプロパティへ出力（改行コードは無効化）
      const cleanColLogical = f.logicalName ? String(f.logicalName).replace(/[\r\n]+/g, '').trim() : '';
      if (isLogicalNameEnabled && cleanColLogical !== '') {
        settings.push(`logicalName: '${escapeInlineString(cleanColLogical)}'`);
      }

      // カラムの純粋な Note のみを出力
      const cleanColNote = (f.note || '').trim();
      if (cleanColNote) {
        settings.push(`note: ${quoteNote(cleanColNote, false)}`);
      }

      const settingsStr = settings.length > 0 ? ` [${settings.join(', ')}]` : '';
      chunks.push(`  ${fieldName} ${fieldType}${settingsStr}`);

      // カラムの Metadata Column ブロック収集（logicalName 以外のカスタム属性のみ）
      const colMeta = {};
      if (f.custom && typeof f.custom === 'object') {
        for (const [k, v] of Object.entries(f.custom)) {
          if (k.toLowerCase() === 'logicalname' || v === undefined || v === null || v === '') continue;
          if (!isSafeMode && !allowedColumnKeys.has(k)) continue;
          colMeta[k] = v;
        }
      }
      if (Object.keys(colMeta).length > 0) {
        const metaLines = Object.entries(colMeta).map(([k, v]) => `  ${k}: ${formatMetadataValue(v)}`);
        metadataBlocks.push(`Metadata Column ${tblName}.${fieldName} {\n${metaLines.join('\n')}\n}`);
      }
    }

    // (2) Indexes ブロックの正規化と重複排除 (PK完全統一)
    const rawIndexes = (tbl.indexes || []).filter(idx => idx.columns && idx.columns.length > 0);
    const normalizedIndexes = [];
    let pkIndexAdded = false;

    if (hasPk) {
      const pkFieldNames = pkFields.map(f => f.name);
      let pkColNames = [];

      // 日本語コメント: tbl.pkOrder が指定されている場合はその順序を最優先
      if (Array.isArray(tbl.pkOrder) && tbl.pkOrder.length > 0) {
        pkColNames = tbl.pkOrder.filter(name => pkFieldNames.some(pf => String(pf).toUpperCase() === String(name).toUpperCase()));
        // pkOrder に漏れている PK フィールドがあれば末尾に補完
        for (const pf of pkFieldNames) {
          if (!pkColNames.some(c => String(c).toUpperCase() === String(pf).toUpperCase())) {
            pkColNames.push(pf);
          }
        }
      } else {
        const existingPkColNames = existingPkIndex
          ? existingPkIndex.columns.map(c => typeof c === 'object' && c !== null ? c.value : c)
          : [];

        // UIでPKカラム構成が変更されていない場合は既存PKインデックスのカラム順（複合キー順序）を維持
        const isSamePkSet = existingPkColNames.length === pkFieldNames.length &&
          existingPkColNames.every(col => pkFieldNames.some(pf => String(pf).toUpperCase() === String(col).toUpperCase()));

        pkColNames = isSamePkSet ? existingPkColNames : pkFieldNames;
      }

      // 日本語コメント: tbl.pkName が指定されている場合は優先して使用
      const pkName = (tbl.pkName && String(tbl.pkName).trim())
        ? String(tbl.pkName).trim()
        : ((existingPkIndex && existingPkIndex.name)
            ? existingPkIndex.name
            : `PK_${String(tbl.name || '').toUpperCase()}`);

      normalizedIndexes.push({
        columns: pkColNames,
        pk: true,
        unique: false,
        name: pkName,
        note: existingPkIndex ? (existingPkIndex.note || '') : '',
      });
      pkIndexAdded = true;
    }

    // 通常のインデックスを重複排除しながら追加
    const seenIndexSignatures = new Set();
    const seenPkNames = new Set();
    const seenPkColSigs = new Set();
    if (pkIndexAdded && normalizedIndexes.length > 0) {
      const pkIdx = normalizedIndexes[0];
      const pkSig = pkIdx.columns.map(c => String(c).toUpperCase()).sort().join(',');
      seenIndexSignatures.add(`PK:${pkSig}`);
      if (pkIdx.name) seenPkNames.add(String(pkIdx.name).trim().toUpperCase());
      seenPkColSigs.add(pkIdx.columns.map(c => String(c).toUpperCase()).join(','));
      seenPkColSigs.add(pkSig);
    }

    for (const idx of rawIndexes) {
      // PKインデックスは既に上で処理済み（またはPK解除済み）のためスキップ
      if (idx.pk || idx.isPrimaryKey) {
        continue;
      }

      const colObjs = idx.columns.map(c => {
        if (typeof c === 'object' && c !== null) {
          return {
            value: String(c.value || ''),
            type: c.type || 'column',
          };
        }
        const valStr = String(c || '');
        const isExpr = valStr.includes('(') || valStr.startsWith('`');
        const cleanVal = valStr.startsWith('`') && valStr.endsWith('`') ? valStr.slice(1, -1) : valStr;
        return {
          value: cleanVal,
          type: isExpr ? 'expression' : 'column',
        };
      });
      const colSignature = colObjs.map(c => c.value.toUpperCase()).join(',');
      const colSortSignature = colObjs.map(c => c.value.toUpperCase()).sort().join(',');
      const idxNameUpper = String(idx.name || '').trim().toUpperCase();

      // 日本語コメント: PKと同名のインデックス、またはPKと同一カラム構成のUniqueインデックスは重複としてスキップ
      if (
        (idxNameUpper && seenPkNames.has(idxNameUpper)) ||
        (idx.unique && (seenPkColSigs.has(colSignature) || seenPkColSigs.has(colSortSignature)))
      ) {
        continue;
      }

      const signatureKey = `${idx.unique ? 'UQ' : 'IDX'}:${colSignature}:${idxNameUpper}`;

      if (seenIndexSignatures.has(signatureKey)) {
        continue;
      }
      seenIndexSignatures.add(signatureKey);

      normalizedIndexes.push({
        columns: colObjs,
        pk: false,
        unique: Boolean(idx.unique),
        name: idx.name || '',
        note: idx.note || '',
      });
    }

    if (normalizedIndexes.length > 0) {
      chunks.push('\n  Indexes {');
      for (const idx of normalizedIndexes) {
        const colNames = idx.columns.map(c => {
          if (typeof c === 'object' && c !== null) {
            const valStr = String(c.value || '');
            // 関数インデックス等の式 (expression) はバッククォートで囲む
            if (c.type === 'expression' || valStr.includes('(') || valStr.startsWith('`')) {
              const cleanExpr = valStr.replace(/^`|`$/g, '');
              return `\`${cleanExpr}\``;
            }
            return quoteIdent(valStr);
          }
          const strVal = String(c || '');
          if (strVal.startsWith('`') && strVal.endsWith('`')) return strVal;
          if (strVal.includes('(')) return `\`${strVal}\``;
          return quoteIdent(strVal);
        });
        const target = colNames.length > 1 ? `(${colNames.join(', ')})` : colNames[0];
        const idxSettings = [];

        if (idx.pk) idxSettings.push('pk');
        if (idx.unique) idxSettings.push('unique');
        if (idx.name) idxSettings.push(`name: "${idx.name.replace(/"/g, '\\"')}"`);

        const cleanIdxNote = (idx.note || '').trim();
        if (cleanIdxNote) idxSettings.push(`note: ${quoteNote(cleanIdxNote, false)}`);

        const idxSettingsStr = idxSettings.length > 0 ? ` [${idxSettings.join(', ')}]` : '';
        chunks.push(`    ${target}${idxSettingsStr}`);
      }
      chunks.push('  }');
    }

    // 日本語コメント: (2.5) Checks ブロックの出力 (@dbml/core v11 準拠)
    const rawChecks = (tbl.checks || tbl.constraints || []).filter(c => c && String(c.expression || '').trim() !== '');
    if (rawChecks.length > 0) {
      chunks.push('\n  checks {');
      for (const chk of rawChecks) {
        const exprClean = String(chk.expression).trim().replace(/^`|`$/g, '');
        const chkSettings = [];
        if (chk.name && String(chk.name).trim()) {
          chkSettings.push(`name: '${escapeInlineString(String(chk.name).trim())}'`);
        }
        const chkSettingsStr = chkSettings.length > 0 ? ` [${chkSettings.join(', ')}]` : '';
        chunks.push(`    \`${exprClean}\`${chkSettingsStr}`);
      }
      chunks.push('  }');
    }

    // (3) テーブル全体の純粋な Note のみを出力
    const cleanTblNote = (tbl.note || '').trim();
    if (cleanTblNote) {
      chunks.push(`\n  Note: ${quoteNote(cleanTblNote, true, '  ')}`);
    }

    chunks.push('}\n');

    // (4) テーブルの Metadata Table ブロック収集（logicalName 以外の物理属性・設計属性のみ）
    const tblMeta = {};
    if (tbl.custom && typeof tbl.custom === 'object') {
      for (const [k, v] of Object.entries(tbl.custom)) {
        if (k.toLowerCase() === 'logicalname' || v === undefined || v === null || v === '') continue;
        if (!isSafeMode && !allowedTableKeys.has(k)) continue;
        tblMeta[k] = v;
      }
    }
    if (Object.keys(tblMeta).length > 0) {
      const metaLines = Object.entries(tblMeta).map(([k, v]) => `  ${k}: ${formatMetadataValue(v)}`);
      metadataBlocks.push(`Metadata Table ${tblName} {\n${metaLines.join('\n')}\n}`);
    }
  }

  // 3. テーブルグループ (TableGroup) の生成
  for (const tg of tableGroups) {
    if (!tg.name) continue;
    const tgName = quoteIdent(tg.name);
    chunks.push(`TableGroup ${tgName} {`);

    for (const t of (tg.tables || [])) {
      const tName = typeof t === 'object' && t !== null ? (t.name || t.tableName) : String(t);
      if (tName) {
        chunks.push(`  ${quoteIdent(tName)}`);
      }
    }

    const cleanTgNote = (tg.note || '').trim();
    if (cleanTgNote) {
      chunks.push(`  Note: ${quoteNote(cleanTgNote, false)}`);
    }

    chunks.push('}\n');
  }

  // 4. リレーション (Refs) の生成
  for (const ref of refs) {
    if (ref.endpoints && ref.endpoints.length === 2) {
      const [ep1, ep2] = ref.endpoints;
      const refNamePrefix = ref.name ? ` ${quoteIdent(ref.name)}` : '';
      const formatEpFields = (ep) => {
        const names = (ep.fieldNames || []).filter(Boolean).map(quoteIdent);
        if (names.length === 0) return '""';
        return names.length > 1 ? `(${names.join(', ')})` : names[0];
      };
      const ep1Field = formatEpFields(ep1);
      const ep2Field = formatEpFields(ep2);
      const relOp = getDbmlRelationshipOp(ep1.relation, ep2.relation);

      const refActions = [];
      if (ref.onUpdate) refActions.push(`update: ${ref.onUpdate}`);
      if (ref.onDelete) refActions.push(`delete: ${ref.onDelete}`);
      const refActionsStr = refActions.length > 0 ? ` [${refActions.join(', ')}]` : '';

      chunks.push(`Ref${refNamePrefix}: ${quoteIdent(ep1.tableName)}.${ep1Field} ${relOp} ${quoteIdent(ep2.tableName)}.${ep2Field}${refActionsStr}`);
    }
  }

  // 5. 独立したノート (Notes) の生成
  for (const n of notes) {
    const nName = n.name ? ` ${quoteIdent(n.name)}` : '';
    const noteVal = typeof n.value === 'object' && n.value !== null ? (n.value.value || '') : String(n.value || '');
    chunks.push(`Note${nName} {`);
    if (noteVal) {
      chunks.push(`  ${quoteNote(noteVal, true, '  ')}`);
    }
    chunks.push('}\n');
  }

  // 6. 末尾に Metadata Table / Metadata Column ブロックを一括出力
  if (metadataBlocks.length > 0) {
    chunks.push('');
    chunks.push(metadataBlocks.join('\n\n'));
  }

  return chunks.join('\n');
}
