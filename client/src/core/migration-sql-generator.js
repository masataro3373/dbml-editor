// 日本語コメント: 標準 (ANSI SQL) マイグレーションSQLジェネレーター (client/src/core/migration-sql-generator.js)
// Standard (ANSI SQL) 向けに「RECREATE_TABLE 安全マイグレーション方式」で
// 差分マイグレーション DDL を自動生成します。
// diffSchemas() の構造化差分結果および選択されたテーブル群を受け取り、
// テーブル単位 × 状態別のファイル分割（RECREATE_TABLE 6分割、CREATE 最大2分割、DROP 1分割、ALTER 1分割）を出力します。

import { t } from './i18n.js';

/**
 * 日本語コメント: i18n 辞書から安全にテキストを取得（純粋な t(key) 呼び出し）
 * UIおよび生成SQL用コメントの多言語化のため、ハードコード文字列を排除して辞書から取得します。
 * @param {string} key - 翻訳キー
 * @param {Object} [params] - 埋め込みパラメータ
 * @returns {string} 翻訳後文字列
 */
function getI18nText(key, params = null) {
  return t(key, params);
}

/**
 * 日本語コメント: バックアップ退避テーブル名用のタイムスタンプ文字列 (YYYYMMDD_HHMMSS) を生成
 * @returns {string} タイムスタンプ文字列
 */
function getTimestamp() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad(now.getMonth() + 1);
  const dd = pad(now.getDate());
  const hh = pad(now.getHours());
  const mi = pad(now.getMinutes());
  const ss = pad(now.getSeconds());
  return `${yyyy}${mm}${dd}_${hh}${mi}${ss}`;
}

/**
 * 日本語コメント: 識別子（テーブル名・カラム名・制約名等）を ANSI SQL 標準の二重引用符でクォート
 * @param {string} name - 識別子名
 * @param {string} [dbms='standard'] - 対象 DBMS ('standard')
 * @returns {string} クォート済み識別子
 */
export function quoteIdent(name, dbms = 'standard') {
  if (name === null || name === undefined) return '';
  const clean = String(name).replace(/["`]/g, '').trim();
  if (!clean) return '';
  return `"${clean}"`;
}

/**
 * 日本語コメント: 文字列リテラル内のシングルクォートを SQL エスケープ
 * @param {string} str - 対象文字列
 * @returns {string} エスケープ後文字列
 */
export function escapeSqlString(str) {
  if (str === null || str === undefined) return '';
  return String(str).replace(/'/g, "''");
}

/**
 * 日本語コメント: カラムまたはテーブルから論理名 (logicalName) と説明 (note) を抽出し、SQLコメント文言を合成
 * options.commentSource ('note' | 'logicalName' | 'both') に応じた文言を返却します。
 * <!-- custom --> ブロックが含まれている場合は除去して純粋なコメント文言のみを抽出します。
 * @param {Object} obj - テーブルまたはカラム定義オブジェクト
 * @param {string} [commentSource='note'] - コメント抽出元 ('note' | 'logicalName' | 'both')
 * @returns {string} 合成されたコメント文言
 */
export function extractCommentText(obj, commentSource = 'note') {
  if (!obj) return '';
  const logical = String(obj.logicalName || obj.custom?.logicalName || '').trim();
  let note = String(obj.note || '').trim();

  // 日本語コメント: <!-- custom --> 以降の拡張JSONブロックを除去して純粋なノート文言を抽出
  if (note.includes('<!-- custom -->')) {
    note = note.split('<!-- custom -->')[0].trim();
  }

  const source = (commentSource || 'note').toLowerCase();
  if (source === 'logicalname') {
    return logical;
  }
  if (source === 'both') {
    if (logical && note && logical !== note) {
      return `${logical}: ${note}`;
    }
    return logical || note || '';
  }

  // デフォルト: 'note' (説明文のみ)
  return note;
}

/**
 * 日本語コメント: Standard (ANSI SQL) 向けデータ型の解決
 * @param {Object} field - カラム定義オブジェクト
 * @param {string} [dbms='standard'] - 対象 DBMS ('standard')
 * @returns {string} データ型文字列
 */
export function resolveColumnType(field, dbms = 'standard') {
  if (!field) {
    return 'VARCHAR(255)';
  }

  let typeName = field.dataType || (typeof field.type === 'string' ? field.type : (field.type?.type_name || ''));
  let typeArgs = field.typeArgs || (field.type?.args || '');

  typeName = String(typeName || '').replace(/["`]/g, '').trim().toUpperCase();
  typeArgs = String(typeArgs || '').replace(/["`]/g, '').trim();

  // "VARCHAR(255)" のように typeName に括弧が含まれる場合のパース
  if (typeName.includes('(') && typeName.endsWith(')')) {
    const parenIdx = typeName.indexOf('(');
    if (!typeArgs) {
      typeArgs = typeName.substring(parenIdx + 1, typeName.length - 1).trim();
    }
    typeName = typeName.substring(0, parenIdx).trim();
  }

  // Standard (ANSI SQL) 向けデータ型解決
  switch (typeName) {
    case 'VARCHAR2':
      return typeArgs ? `VARCHAR(${typeArgs})` : 'VARCHAR(255)';
    case 'NUMBER':
      return typeArgs ? `NUMERIC(${typeArgs})` : 'NUMERIC';
    case 'SERIAL':
    case 'BIGSERIAL':
      return 'INTEGER';
    default:
      return typeArgs ? `${typeName}(${typeArgs})` : typeName;
  }
}

/**
 * 日本語コメント: カラムのデフォルト値句 (DEFAULT ...) をフォーマット
 * @param {Object} col - カラム定義オブジェクト
 * @param {string} [dbms='standard'] - 対象 DBMS ('standard')
 * @returns {string} DEFAULT 句文字列（未指定時は空文字列）
 */
export function formatDefaultClause(col, dbms = 'standard') {
  if (!col) return '';
  const rawVal = col.default !== undefined ? col.default : col.dbdefault;
  if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
    return '';
  }

  let str = String(rawVal).trim();

  // 既にクォートされている場合
  if ((str.startsWith("'") && str.endsWith("'")) || (str.startsWith('`') && str.endsWith('`'))) {
    const unquoted = str.slice(1, -1);
    return `DEFAULT '${unquoted.replace(/'/g, "''")}'`;
  }

  const lower = str.toLowerCase();
  if (['true', 'false', 'null'].includes(lower)) {
    return `DEFAULT ${lower.toUpperCase()}`;
  }

  // 日時関数・SQL関数
  if (['now()', 'current_timestamp', 'sysdate', 'localtimestamp'].includes(lower) || str.includes('(')) {
    return `DEFAULT ${str}`;
  }

  // 単純な数値リテラル
  if (/^-?\d+(\.\d+)?$/.test(str) && !/^0\d+/.test(str)) {
    return `DEFAULT ${str}`;
  }

  // 文字列リテラル
  return `DEFAULT '${str.replace(/'/g, "''")}'`;
}

/**
 * 日本語コメント: AST モデル（endpoints または from/to 形式）から外部キー関係を正規化抽出
 * @param {Array<Object>} refsList - スキーマ内の Ref 定義配列
 * @returns {Array<Object>} 正規化された外部キー情報配列
 */
function normalizeRefs(refsList = []) {
  const result = [];
  for (const ref of (refsList || [])) {
    if (!ref) continue;

    // 形式1: endpoints 形式 (@dbml/core AST)
    if (ref.endpoints && ref.endpoints.length === 2) {
      const [ep1, ep2] = ref.endpoints;
      const op = ref.op || (ep1.relation === '*' ? '>' : (ep2.relation === '*' ? '<' : '-'));
      let childTable = ep1.tableName;
      let childCols = ep1.fieldNames || [];
      let parentTable = ep2.tableName;
      let parentCols = ep2.fieldNames || [];

      if (op === '<') {
        childTable = ep2.tableName;
        childCols = ep2.fieldNames || [];
        parentTable = ep1.tableName;
        parentCols = ep1.fieldNames || [];
      }

      const refName = ref.name || `FK_${childTable}_${parentTable}`;
      result.push({
        name: refName,
        childTable: String(childTable).replace(/["`]/g, '').trim(),
        childCols: (Array.isArray(childCols) ? childCols : [childCols]).map(c => String(c).replace(/["`]/g, '').trim()),
        parentTable: String(parentTable).replace(/["`]/g, '').trim(),
        parentCols: (Array.isArray(parentCols) ? parentCols : [parentCols]).map(c => String(c).replace(/["`]/g, '').trim()),
        onDelete: ref.onDelete || null,
        onUpdate: ref.onUpdate || null,
      });
      continue;
    }

    // 形式2: from / to 文字列形式 (parseDbmlToAst)
    if (ref.from && ref.to) {
      const parseEndpoint = (str) => {
        const pIdx = str.indexOf('.');
        if (pIdx === -1) return { table: str.replace(/["`]/g, '').trim(), cols: [] };
        const table = str.substring(0, pIdx).replace(/["`]/g, '').trim();
        const colPart = str.substring(pIdx + 1).replace(/[()"`]/g, '').trim();
        const cols = colPart.split(',').map(c => c.trim()).filter(Boolean);
        return { table, cols };
      };

      const fromEp = parseEndpoint(ref.from);
      const toEp = parseEndpoint(ref.to);
      const op = ref.op || '>';

      let childTable = fromEp.table;
      let childCols = fromEp.cols;
      let parentTable = toEp.table;
      let parentCols = toEp.cols;

      if (op === '<') {
        childTable = toEp.table;
        childCols = toEp.cols;
        parentTable = fromEp.table;
        parentCols = fromEp.cols;
      }

      const refName = ref.name || `FK_${childTable}_${parentTable}`;
      result.push({
        name: refName,
        childTable,
        childCols,
        parentTable,
        parentCols,
        onDelete: ref.onDelete || null,
        onUpdate: ref.onUpdate || null,
      });
    }
  }
  return result;
}

/**
 * 日本語コメント: 単一テーブルの新規作成 DDL (CREATE TABLE) を生成
 * @param {Object} table - 新規テーブルの AST 定義
 * @param {string} dbms - 対象 DBMS
 * @param {boolean} includeComment - コメントを出力するかどうか
 * @param {string} [commentSource='note'] - コメント抽出元 ('note' | 'logicalName' | 'both')
 * @param {boolean} [includeTablespace=true] - 表領域 (TABLESPACE) 句を出力するかどうか
 * @param {Object} [metadataContext=null] - プラグイン・拡張メタデータコンテキスト
 * @returns {string} CREATE TABLE SQL 文
 */
function buildCreateTableSql(table, dbms, includeComment, commentSource = 'note', includeTablespace = true, metadataContext = null) {
  const d = (dbms || 'postgresql').toLowerCase();
  const tblName = quoteIdent(table.name, d);
  const fields = table.columns || table.fields || [];

  const colDefs = [];
  const pkFields = [];

  for (const f of fields) {
    const colName = quoteIdent(f.name, d);
    const colType = resolveColumnType(f, d);
    const parts = [colName, colType];

    // MySQL の AUTO_INCREMENT 句の付与 (型に含まれていなければ)
    if ((d === 'mysql' || d === 'mariadb') && f.increment && !colType.includes('AUTO_INCREMENT')) {
      parts.push('AUTO_INCREMENT');
    }

    // デフォルト値句 (PostgreSQL の SERIAL/BIGSERIAL には DEFAULT を付けない)
    const isPgSerial = (d === 'postgresql' || d === 'postgres') && (colType === 'SERIAL' || colType === 'BIGSERIAL');
    if (!isPgSerial) {
      const defClause = formatDefaultClause(f, d);
      if (defClause) {
        parts.push(defClause);
      }
    }

    // NOT NULL 句
    if (f.notNull || f.not_null || f.pk) {
      parts.push('NOT NULL');
    }

    colDefs.push(`  ${parts.join(' ')}`);

    if (f.pk) {
      pkFields.push(f.name);
    }
  }

  // 主キー (PRIMARY KEY) 制約の付与
  const existingPkIndex = (table.indexes || []).find(idx => idx.pk || idx.isPrimaryKey);
  let pkColNames = pkFields;
  if (existingPkIndex && Array.isArray(existingPkIndex.columns) && existingPkIndex.columns.length > 0) {
    pkColNames = existingPkIndex.columns.map(c => (typeof c === 'object' && c !== null ? c.value : c));
  }

  if (pkColNames.length > 0) {
    const pkName = table.pkName || (existingPkIndex && existingPkIndex.name) || `PK_${table.name.toUpperCase()}`;
    const quotedPkCols = pkColNames.map(c => quoteIdent(c, d)).join(', ');
    colDefs.push(`  CONSTRAINT ${quoteIdent(pkName, d)} PRIMARY KEY (${quotedPkCols})`);
  }

  const tableBody = colDefs.join(',\n');
  const createSql = `CREATE TABLE ${tblName} (\n${tableBody}\n)`;

  return `${createSql};`;
}

/**
 * 日本語コメント: テーブルリネーム SQL を生成
 * @param {string} oldName - 変更前テーブル名
 * @param {string} newName - 変更後テーブル名
 * @param {string} dbms - 対象 DBMS
 * @returns {string} リネーム SQL 文
 */
function buildRenameTableSql(oldName, newName, dbms) {
  const d = (dbms || 'standard').toLowerCase();
  const quotedOld = quoteIdent(oldName, d);
  const quotedNew = quoteIdent(newName, d);

  // Standard (ANSI SQL)
  return `ALTER TABLE ${quotedOld} RENAME TO ${quotedNew};`;
}

/**
 * 日本語コメント: 旧バックアップテーブルから新テーブルへの共通カラムデータ移行 SQL を生成
 * @param {string} newTableName - 新テーブル名
 * @param {string} backupTableName - 旧退避テーブル名
 * @param {Object} tableDiff - テーブル差分オブジェクト
 * @param {string} dbms - 対象 DBMS
 * @returns {string} データ移行 SQL スクリプト
 */
function buildDataCopySql(newTableName, backupTableName, tableDiff, dbms) {
  const d = (dbms || 'postgresql').toLowerCase();
  const newTblQuoted = quoteIdent(newTableName, d);
  const backupTblQuoted = quoteIdent(backupTableName, d);

  const oldCols = tableDiff.oldTable?.columns || tableDiff.oldTable?.fields || [];
  const newCols = tableDiff.newTable?.columns || tableDiff.newTable?.fields || [];

  const oldColSet = new Set(
    oldCols.map(c => String(c.name).replace(/["`]/g, '').trim().toLowerCase())
  );

  // 新テーブル側の定義順序を基準に、旧テーブルにも存在する共通カラムのみを抽出
  const commonCols = [];
  for (const c of newCols) {
    const colClean = String(c.name).replace(/["`]/g, '').trim();
    if (oldColSet.has(colClean.toLowerCase())) {
      commonCols.push(colClean);
    }
  }

  if (commonCols.length === 0) {
    const noColsText = t('migration.sql_no_common_cols');
    return `-- ${noColsText}\n`;
  }

  const quotedCols = commonCols.map(c => quoteIdent(c, d)).join(',\n    ');

  if (d === 'mysql' || d === 'mariadb') {
    return [
      `INSERT INTO ${newTblQuoted} (`,
      `    ${quotedCols}`,
      `)`,
      `SELECT`,
      `    ${quotedCols}`,
      `FROM ${backupTblQuoted};`,
      ``,
      `COMMIT;`
    ].join('\n');
  }

  // PostgreSQL および Standard (ANSI SQL)
  return [
    `BEGIN;`,
    ``,
    `INSERT INTO ${newTblQuoted} (`,
    `    ${quotedCols}`,
    `)`,
    `SELECT`,
    `    ${quotedCols}`,
    `FROM ${backupTblQuoted};`,
    ``,
    `COMMIT;`
  ].join('\n');
}

/**
 * 日本語コメント: 新テーブル用のインデックス作成 SQL を生成 (PKインデックスは除く)
 * @param {Object} table - 対象テーブル定義
 * @param {string} dbms - 対象 DBMS
 * @param {boolean} [includeTablespace=true] - 表領域 (TABLESPACE) 句を出力するかどうか
 * @returns {Array<string>} インデックス作成 SQL 文の配列
 */
function buildTableIndexCreationSql(table, dbms, includeTablespace = true) {
  if (!table) return [];
  const d = (dbms || 'postgresql').toLowerCase();
  const tblName = quoteIdent(table.name, d);
  const statements = [];

  const indexes = (table.indexes || []).filter(idx => !idx.pk && !idx.isPrimaryKey && idx.type !== 'primary');
  for (const idx of indexes) {
    const rawCols = (idx.columns || idx.fields || []).map(c => {
      if (typeof c === 'object' && c !== null) return c.value || c.name || '';
      return String(c);
    });
    if (rawCols.length === 0) continue;

    const idxName = idx.name || `IDX_${table.name}_${rawCols.join('_')}`;
    const quotedIdx = quoteIdent(idxName, d);
    const quotedCols = rawCols.map(c => quoteIdent(c, d)).join(', ');
    const uniquePrefix = idx.unique ? 'UNIQUE ' : '';

    statements.push(`CREATE ${uniquePrefix}INDEX ${quotedIdx} ON ${tblName} (${quotedCols});`);
  }

  return statements;
}

/**
 * 日本語コメント: 指定テーブルが子テーブルとなる新スキーマの外部キー制約作成 SQL を生成
 * @param {string} tableName - 対象テーブル名
 * @param {Array<Object>} newRefs - 新スキーマの正規化外部キー一覧
 * @param {string} dbms - 対象 DBMS
 * @returns {Array<string>} 外部キー追加 SQL 文の配列
 */
function buildTableFkCreationSql(tableName, newRefs, dbms) {
  const d = (dbms || 'postgresql').toLowerCase();
  const lowerName = tableName.toLowerCase();
  const statements = [];

  for (const newFk of (newRefs || [])) {
    if (newFk.childTable.toLowerCase() === lowerName) {
      const childTbl = quoteIdent(newFk.childTable, d);
      const parentTbl = quoteIdent(newFk.parentTable, d);
      const fkName = quoteIdent(newFk.name, d);
      const childCols = newFk.childCols.map(c => quoteIdent(c, d)).join(', ');
      const parentCols = newFk.parentCols.map(c => quoteIdent(c, d)).join(', ');

      let fkSql = `ALTER TABLE ${childTbl} ADD CONSTRAINT ${fkName} FOREIGN KEY (${childCols}) REFERENCES ${parentTbl} (${parentCols})`;
      if (newFk.onDelete) {
        fkSql += ` ON DELETE ${newFk.onDelete.toUpperCase()}`;
      }
      if (newFk.onUpdate) {
        fkSql += ` ON UPDATE ${newFk.onUpdate.toUpperCase()}`;
      }
      statements.push(`${fkSql};`);
    }
  }

  return statements;
}

/**
 * 日本語コメント: 指定テーブルが子テーブルとなる旧スキーマの外部キー制約削除 SQL を生成
 * @param {string} tableName - 対象テーブル名
 * @param {Array<Object>} oldRefs - 旧スキーマの正規化外部キー一覧
 * @param {string} dbms - 対象 DBMS
 * @returns {Array<string>} 外部キー削除 SQL 文の配列
 */
function buildTableFkDropSql(tableName, oldRefs, dbms) {
  const d = (dbms || 'postgresql').toLowerCase();
  const lowerName = tableName.toLowerCase();
  const statements = [];

  for (const oldFk of (oldRefs || [])) {
    if (oldFk.childTable.toLowerCase() === lowerName) {
      const childTbl = quoteIdent(oldFk.childTable, d);
      const fkName = quoteIdent(oldFk.name, d);
      statements.push(`ALTER TABLE ${childTbl} DROP CONSTRAINT ${fkName};`);
    }
  }

  return statements;
}

/**
 * 日本語コメント: RECREATE_TABLE Step 1: 旧テーブルの既存 FK・非PKインデックス・主キー制約の削除 SQL を生成
 * Standard (ANSI SQL) 向けに DROP CONSTRAINT IF EXISTS / DROP INDEX IF EXISTS を出力します。
 * @param {string} cleanTableName - 対象テーブル名
 * @param {Object} oldTable - 旧テーブル定義オブジェクト
 * @param {Array<Object>} oldRefs - 旧スキーマの正規化外部キー一覧
 * @param {string} dbms - 対象 DBMS
 * @returns {Array<string>} DROP SQL 文の配列
 */
function buildRecreateTableStep1DropSql(cleanTableName, oldTable, oldRefs, dbms) {
  const d = (dbms || 'standard').toLowerCase();
  const tblName = quoteIdent(cleanTableName, d);
  const statements = [];

  // 1. 旧テーブル（tableDiff.oldTable）に紐づく既存 FK 制約の削除
  const lowerName = cleanTableName.toLowerCase();
  for (const oldFk of (oldRefs || [])) {
    if (oldFk.childTable.toLowerCase() === lowerName) {
      const childTbl = quoteIdent(oldFk.childTable, d);
      const fkName = quoteIdent(oldFk.name, d);
      statements.push(`ALTER TABLE ${childTbl} DROP CONSTRAINT IF EXISTS ${fkName};`);
    }
  }

  // 2. 旧テーブルの非PKインデックス (!idx.pk && idx.type !== 'primary') の削除
  if (oldTable && Array.isArray(oldTable.indexes)) {
    const nonPkIndexes = oldTable.indexes.filter(idx => !idx.pk && idx.type !== 'primary' && !idx.isPrimaryKey);
    for (const oldIdx of nonPkIndexes) {
      const rawCols = (oldIdx.columns || oldIdx.fields || []).map(c => {
        if (typeof c === 'object' && c !== null) return c.value || c.name || '';
        return String(c);
      }).filter(Boolean);

      const idxName = oldIdx.name || `IDX_${cleanTableName}_${rawCols.join('_') || 'col'}`;
      const quotedIdx = quoteIdent(idxName, d);
      statements.push(`DROP INDEX IF EXISTS ${quotedIdx};`);
    }
  }

  // 3. 旧テーブルの主キー制約の削除
  if (oldTable) {
    const oldCols = oldTable.columns || oldTable.fields || [];
    const oldPkIndex = (oldTable.indexes || []).find(idx => idx.pk || idx.type === 'primary' || idx.isPrimaryKey);
    const hasPkCol = oldCols.some(c => c.pk);

    if (oldPkIndex || hasPkCol) {
      const oldPkName = (oldPkIndex && oldPkIndex.name) || oldTable.pkName || `PK_${cleanTableName.toUpperCase()}`;
      statements.push(`ALTER TABLE ${tblName} DROP CONSTRAINT IF EXISTS ${quoteIdent(oldPkName, d)};`);
    }
  }

  return statements;
}

/**
 * 日本語コメント: 既存テーブルの差分変更 DDL (ALTER TABLE) を生成
 * @param {Object} tableDiff - テーブル差分オブジェクト
 * @param {string} dbms - 対象 DBMS
 * @param {boolean} includeComment - コメントを出力するかどうか
 * @param {string} [commentSource='note'] - コメント抽出元 ('note' | 'logicalName' | 'both')
 * @returns {Array<string>} ALTER TABLE SQL 文の配列
 */
function buildAlterTableSql(tableDiff, dbms, includeComment, commentSource = 'note') {
  const d = (dbms || 'postgresql').toLowerCase();
  const tblName = quoteIdent(tableDiff.name, d);
  const statements = [];
  const columnsDiff = tableDiff.columnsDiff || [];

  for (const colDiff of columnsDiff) {
    const colName = quoteIdent(colDiff.name, d);

    // 1. カラム追加 (ADDED)
    if (colDiff.status === 'ADDED' && colDiff.newColumn) {
      const col = colDiff.newColumn;
      const colType = resolveColumnType(col, d);
      const parts = [colName, colType];

      const defClause = formatDefaultClause(col, d);
      if (defClause) parts.push(defClause);

      if (col.notNull || col.not_null || col.pk) {
        parts.push('NOT NULL');
      }

      statements.push(`ALTER TABLE ${tblName} ADD COLUMN ${parts.join(' ')};`);
      continue;
    }

    // 2. カラム削除 (DROPPED)
    if (colDiff.status === 'DROPPED') {
      statements.push(`ALTER TABLE ${tblName} DROP COLUMN ${colName};`);
      continue;
    }

    // 3. カラム変更 (MODIFIED)
    if (colDiff.status === 'MODIFIED' && colDiff.newColumn) {
      const col = colDiff.newColumn;
      const colType = resolveColumnType(col, d);

      // Standard (ANSI SQL)
      statements.push(`ALTER TABLE ${tblName} ALTER COLUMN ${colName} TYPE ${colType};`);
      if (col.notNull || col.not_null) {
        statements.push(`ALTER TABLE ${tblName} ALTER COLUMN ${colName} SET NOT NULL;`);
      } else {
        statements.push(`ALTER TABLE ${tblName} ALTER COLUMN ${colName} DROP NOT NULL;`);
      }
    }
  }

  return statements;
}

/**
 * 日本語コメント: 単一テーブルの削除 DDL (DROP TABLE) を生成
 * @param {string} tableName - テーブル名
 * @param {string} dbms - 対象 DBMS
 * @returns {string} DROP TABLE SQL 文
 */
function buildDropTableSql(tableName, dbms) {
  const d = (dbms || 'standard').toLowerCase();
  const tblName = quoteIdent(tableName, d);
  return `DROP TABLE ${tblName};`;
}

/**
 * 日本語コメント: インデックスの差分検出と作成・削除 SQL を生成
 * @param {Object} tableDiff - テーブル差分オブジェクト
 * @param {string} dbms - 対象 DBMS
 * @param {boolean} [includeTablespace=true] - 表領域 (TABLESPACE) 句を出力するかどうか
 * @returns {Array<string>} インデックス関連 SQL 文の配列
 */
function buildIndexSql(tableDiff, dbms, includeTablespace = true) {
  const d = (dbms || 'postgresql').toLowerCase();
  const tblName = quoteIdent(tableDiff.name, d);
  const statements = [];

  const oldIndexes = (tableDiff.oldTable?.indexes || []).filter(idx => !idx.pk && !idx.isPrimaryKey);
  const newIndexes = (tableDiff.newTable?.indexes || []).filter(idx => !idx.pk && !idx.isPrimaryKey);

  const getIdxSig = (idx) => {
    const cols = (idx.columns || idx.fields || []).map(c => {
      const val = typeof c === 'object' && c !== null ? (c.value || c.name || '') : String(c);
      return val.replace(/["`]/g, '').trim().toLowerCase();
    }).sort().join(',');
    return `${Boolean(idx.unique)}:${cols}`;
  };

  const oldSigMap = new Map();
  oldIndexes.forEach(idx => {
    if (idx.name) oldSigMap.set(idx.name.toLowerCase(), idx);
    else oldSigMap.set(getIdxSig(idx), idx);
  });

  const newSigMap = new Map();
  newIndexes.forEach(idx => {
    if (idx.name) newSigMap.set(idx.name.toLowerCase(), idx);
    else newSigMap.set(getIdxSig(idx), idx);
  });

  // 1. 旧にあって新にないインデックスの削除 (DROP INDEX)
  if (tableDiff.status === 'MODIFY' || tableDiff.status === 'DROP') {
    for (const oldIdx of oldIndexes) {
      const key = oldIdx.name ? oldIdx.name.toLowerCase() : getIdxSig(oldIdx);
      if (tableDiff.status === 'DROP' || !newSigMap.has(key)) {
        const idxName = oldIdx.name || `IDX_${tableDiff.name}_${oldIdx.fields?.join('_') || 'col'}`;
        const quotedIdx = quoteIdent(idxName, d);
        statements.push(`DROP INDEX ${quotedIdx};`);
      }
    }
  }

  // 2. 新にあって旧にないインデックスの作成 (CREATE INDEX)
  if (tableDiff.status === 'ADD' || tableDiff.status === 'MODIFY') {
    for (const newIdx of newIndexes) {
      const key = newIdx.name ? newIdx.name.toLowerCase() : getIdxSig(newIdx);
      if (tableDiff.status === 'ADD' || !oldSigMap.has(key)) {
        const rawCols = (newIdx.columns || newIdx.fields || []).map(c => {
          if (typeof c === 'object' && c !== null) {
            return c.value || c.name || '';
          }
          return String(c);
        });

        if (rawCols.length === 0) continue;

        const idxName = newIdx.name || `IDX_${tableDiff.name}_${rawCols.join('_')}`;
        const quotedIdx = quoteIdent(idxName, d);
        const quotedCols = rawCols.map(c => quoteIdent(c, d)).join(', ');
        const uniquePrefix = newIdx.unique ? 'UNIQUE ' : '';
        statements.push(`CREATE ${uniquePrefix}INDEX ${quotedIdx} ON ${tblName} (${quotedCols});`);
      }
    }
  }

  return statements;
}

/**
 * 日本語コメント: 外部キー (FK) の差分抽出と削除/追加 SQL を生成
 * @param {string} tableName - 対象テーブル名
 * @param {Array<Object>} oldRefs - 旧スキーマの正規化FK一覧
 * @param {Array<Object>} newRefs - 新スキーマの正規化FK一覧
 * @param {Object} tableDiff - テーブル差分オブジェクト
 * @param {string} dbms - 対象 DBMS
 * @returns {{ dropStatements: Array<string>, addStatements: Array<string> }}
 */
function buildFkSql(tableName, oldRefs, newRefs, tableDiff, dbms) {
  const d = (dbms || 'postgresql').toLowerCase();
  const lowerName = tableName.toLowerCase();
  const dropStatements = [];
  const addStatements = [];

  const getFkSig = (fk) => {
    return `${fk.childTable.toLowerCase()}:${fk.childCols.join(',').toLowerCase()}->${fk.parentTable.toLowerCase()}:${fk.parentCols.join(',').toLowerCase()}`;
  };

  const oldFkMap = new Map();
  oldRefs.forEach(fk => {
    if (fk.childTable.toLowerCase() === lowerName) {
      oldFkMap.set(getFkSig(fk), fk);
    }
  });

  const newFkMap = new Map();
  newRefs.forEach(fk => {
    if (fk.childTable.toLowerCase() === lowerName) {
      newFkMap.set(getFkSig(fk), fk);
    }
  });

  // 1. 外部キー削除
  for (const oldFk of oldRefs) {
    const isChild = oldFk.childTable.toLowerCase() === lowerName;
    const isParent = oldFk.parentTable.toLowerCase() === lowerName;

    // テーブル削除時は自身が親または子のFKをすべて削除
    if (tableDiff?.status === 'DROP' && (isChild || isParent)) {
      const childTbl = quoteIdent(oldFk.childTable, d);
      const fkName = quoteIdent(oldFk.name, d);
      dropStatements.push(`ALTER TABLE ${childTbl} DROP CONSTRAINT ${fkName};`);
      continue;
    }

    // テーブル変更時は自身が子のFKで削除されたものをDROP
    if (isChild && !newFkMap.has(getFkSig(oldFk))) {
      const childTbl = quoteIdent(oldFk.childTable, d);
      const fkName = quoteIdent(oldFk.name, d);
      dropStatements.push(`ALTER TABLE ${childTbl} DROP CONSTRAINT ${fkName};`);
    }
  }

  // 2. 外部キー追加
  if (tableDiff?.status === 'ADD' || tableDiff?.status === 'MODIFY') {
    for (const newFk of newRefs) {
      if (newFk.childTable.toLowerCase() === lowerName) {
        if (tableDiff.status === 'ADD' || !oldFkMap.has(getFkSig(newFk))) {
          const childTbl = quoteIdent(newFk.childTable, d);
          const parentTbl = quoteIdent(newFk.parentTable, d);
          const fkName = quoteIdent(newFk.name, d);
          const childCols = newFk.childCols.map(c => quoteIdent(c, d)).join(', ');
          const parentCols = newFk.parentCols.map(c => quoteIdent(c, d)).join(', ');

          let fkSql = `ALTER TABLE ${childTbl} ADD CONSTRAINT ${fkName} FOREIGN KEY (${childCols}) REFERENCES ${parentTbl} (${parentCols})`;

          if (newFk.onDelete) {
            fkSql += ` ON DELETE ${newFk.onDelete.toUpperCase()}`;
          }
          if (newFk.onUpdate) {
            fkSql += ` ON UPDATE ${newFk.onUpdate.toUpperCase()}`;
          }

          addStatements.push(`${fkSql};`);
        }
      }
    }
  }

  return { dropStatements, addStatements };
}

/**
 * 日本語コメント: Standard 向けの COMMENT ON 文を生成
 * @param {Object} tableDiff - テーブル差分オブジェクト
 * @param {string} dbms - 対象 DBMS
 * @param {boolean} includeComment - コメントを出力するかどうか
 * @param {string} [commentSource='note'] - コメント抽出元 ('note' | 'logicalName' | 'both')
 * @returns {Array<string>} COMMENT ON SQL 文の配列
 */
function buildCommentSql(tableDiff, dbms, includeComment, commentSource = 'note') {
  if (!includeComment) return [];
  const d = (dbms || 'standard').toLowerCase();

  const table = tableDiff.newTable;
  if (!table) return [];

  const statements = [];
  const tblName = quoteIdent(table.name, d);

  // テーブルコメント
  const tblComment = extractCommentText(table, commentSource);
  if (tblComment) {
    statements.push(`COMMENT ON TABLE ${tblName} IS '${escapeSqlString(tblComment)}';`);
  }

  // カラムコメント
  const fields = table.columns || table.fields || [];
  for (const f of fields) {
    const colComment = extractCommentText(f, commentSource);
    if (colComment) {
      const colName = quoteIdent(f.name, d);
      statements.push(`COMMENT ON COLUMN ${tblName}.${colName} IS '${escapeSqlString(colComment)}';`);
    }
  }

  return statements;
}

/**
 * 日本語コメント: SQL ファイル用の多言語化ヘッダーコメントを生成
 * ハードコード文字列を排除し、多言語辞書キーから見出しを取得して出力します。
 * 未登録キーの場合は fallbackKeyOrText でフォールバックします。
 * @param {string} titleKey - タイトル用 i18n キー
 * @param {string} tableName - 対象テーブル名
 * @param {string} dbms - 対象 DBMS
 * @param {string} [fallbackKeyOrText=''] - フォールバック用のキーまたは代替テキスト
 * @returns {string} ヘッダーコメント文字列
 */
function formatSqlHeader(titleKey, tableName, dbms, fallbackKeyOrText = '') {
  let title = t(titleKey);
  if (!title || title === titleKey) {
    if (fallbackKeyOrText) {
      const fbTranslated = t(fallbackKeyOrText);
      title = (fbTranslated && fbTranslated !== fallbackKeyOrText) ? fbTranslated : fallbackKeyOrText;
    } else {
      title = titleKey;
    }
  }
  return [
    `-- ============================================================`,
    `-- ${title}`,
    `-- Target: ${tableName} (${dbms})`,
    `-- Generated At: ${new Date().toISOString()}`,
    `-- ============================================================`,
    '',
    ''
  ].join('\n');
}

/**
 * 日本語コメント: Standard (ANSI SQL) 向け標準マイグレーション SQL ジェネレーター
 * 5ファイル構成（RECREATE_TABLE）および最大2ファイル構成（CREATE/ADD）の安全マイグレーション DDL を生成します。
 *
 * @param {Object} diffResult - diffSchemas() の解析結果オブジェクト
 * @param {Array<string>} selectedTableNames - 出力対象として選択されたテーブル名配列
 * @param {Object} [options] - オプション ({ targetDbms = 'standard', includeComment = true, commentSource = 'note', includeTablespace = true, metadataContext = null })
 * @returns {Object<string, Array<{ filename: string, content: string }>>} テーブルごとの生成ファイルマップ
 */
export function generateStandardMigrationSql(diffResult, selectedTableNames = [], options = {}) {
  const targetDbms = (options.targetDbms || 'standard').toLowerCase();
  const includeComment = options.includeComment !== false;
  const commentSource = options.commentSource || 'note';
  const includeTablespace = options.includeTablespace !== false;
  const metadataContext = options.metadataContext || null;

  const selectedSet = new Set((selectedTableNames || []).map(n => String(n).toLowerCase()));
  const allTables = diffResult?.tables || [];

  const oldRefs = normalizeRefs(diffResult?.oldAst?.refs || []);
  const newRefs = normalizeRefs(diffResult?.newAst?.refs || []);

  const result = {};

  for (const tableDiff of allTables) {
    const lowerName = tableDiff.name.toLowerCase();
    // 選択されたテーブルのみ処理
    if (!selectedSet.has(lowerName)) {
      continue;
    }

    const tableName = tableDiff.name;
    const cleanTableName = String(tableName).replace(/["`]/g, '').trim();
    const tbl = cleanTableName.toLowerCase();
    const mode = String(tableDiff.migrationMode || tableDiff.status || '').toUpperCase();

    const fileEntries = [];

    // =========================================================================
    // CASE A: RECREATE_TABLE（Oracle プラグインと一貫した 6ステップ安全マイグレーション構成）
    // =========================================================================
    if (mode === 'RECREATE_TABLE') {
      const timestamp = getTimestamp();
      const backupTableName = `${cleanTableName}_OLD_${timestamp}`;

      // -----------------------------------------------------------------------
      // Step 1: 01_drop_constraints_and_indexes_${tbl}.sql
      // （旧テーブルの既存 FK・非PKインデックス・主キー制約の削除）
      // -----------------------------------------------------------------------
      const dropStep1Statements = buildRecreateTableStep1DropSql(
        cleanTableName,
        tableDiff.oldTable,
        oldRefs,
        targetDbms
      );
      const header1 = formatSqlHeader(
        'migration.sql_header_drop_constraints_and_indexes',
        cleanTableName,
        targetDbms,
        'migration.sql_header_drop_fk'
      );
      if (dropStep1Statements.length > 0) {
        fileEntries.push({
          filename: `01_drop_constraints_and_indexes_${tbl}.sql`,
          content: header1 + dropStep1Statements.join('\n\n') + '\n',
        });
      } else {
        const noChangesText = t('migration.sql_no_changes');
        fileEntries.push({
          filename: `01_drop_constraints_and_indexes_${tbl}.sql`,
          content: header1 + `-- ${noChangesText}\n`,
        });
      }

      // -----------------------------------------------------------------------
      // Step 2: 02_backup_table_${tbl}.sql（旧テーブルを退避リネーム）
      // -----------------------------------------------------------------------
      const renameSql = buildRenameTableSql(cleanTableName, backupTableName, targetDbms);
      const header2 = formatSqlHeader(
        'migration.sql_header_step2_backup_table',
        cleanTableName,
        targetDbms,
        'migration.sql_header_backup_table'
      );
      fileEntries.push({
        filename: `02_backup_table_${tbl}.sql`,
        content: header2 + renameSql + '\n',
      });

      // -----------------------------------------------------------------------
      // Step 3: 03_recreate_table_${tbl}.sql（新テーブル作成・PKインライン含む）
      // -----------------------------------------------------------------------
      if (tableDiff.newTable) {
        const createSql = buildCreateTableSql(tableDiff.newTable, targetDbms, includeComment, commentSource, includeTablespace, metadataContext);
        const header3 = formatSqlHeader(
          'migration.sql_header_step3_recreate_table',
          cleanTableName,
          targetDbms,
          'migration.sql_header_recreate_table'
        );
        fileEntries.push({
          filename: `03_recreate_table_${tbl}.sql`,
          content: header3 + createSql + '\n',
        });
      }

      // -----------------------------------------------------------------------
      // Step 4: 04_data_copy_${tbl}.sql（データ移行）
      // -----------------------------------------------------------------------
      const copySql = buildDataCopySql(cleanTableName, backupTableName, tableDiff, targetDbms);
      const header4 = formatSqlHeader(
        'migration.sql_header_step4_data_copy',
        cleanTableName,
        targetDbms,
        'migration.sql_header_data_copy'
      );
      fileEntries.push({
        filename: `04_data_copy_${tbl}.sql`,
        content: header4 + copySql + '\n',
      });

      // -----------------------------------------------------------------------
      // Step 5: 05_indexes_fk_comments_${tbl}.sql
      // （全非PKインデックス再作成 ＋ FK ＋ コメント付与）
      // -----------------------------------------------------------------------
      const indexSqls = buildTableIndexCreationSql(tableDiff.newTable, targetDbms, includeTablespace);
      const fkSqls = buildTableFkCreationSql(cleanTableName, newRefs, targetDbms);
      const commentSqls = includeComment
        ? buildCommentSql(tableDiff, targetDbms, includeComment, commentSource)
        : [];
      const step5Statements = [...indexSqls, ...fkSqls, ...commentSqls];
      const header5 = formatSqlHeader(
        'migration.sql_header_step5_indexes_fk_comments',
        cleanTableName,
        targetDbms,
        'migration.sql_header_indexes_and_comments'
      );
      if (step5Statements.length > 0) {
        fileEntries.push({
          filename: `05_indexes_fk_comments_${tbl}.sql`,
          content: header5 + step5Statements.join('\n\n') + '\n',
        });
      } else {
        const noChangesText = t('migration.sql_no_changes');
        fileEntries.push({
          filename: `05_indexes_fk_comments_${tbl}.sql`,
          content: header5 + `-- ${noChangesText}\n`,
        });
      }

      // -----------------------------------------------------------------------
      // Step 6: 06_drop_backup_table_${tbl}.sql（退避テーブル削除）
      // -----------------------------------------------------------------------
      const dropBackupSql = buildDropTableSql(backupTableName, targetDbms);
      const header6 = formatSqlHeader(
        'migration.sql_header_step6_drop_backup_table',
        cleanTableName,
        targetDbms,
        'migration.sql_header_drop_backup_table'
      );
      fileEntries.push({
        filename: `06_drop_backup_table_${tbl}.sql`,
        content: header6 + dropBackupSql + '\n',
      });
    }
    // =========================================================================
    // CASE B: CREATE または ADD（最大2ファイル構成）
    // =========================================================================
    else if (mode === 'CREATE' || mode === 'ADD') {
      // 1. 01_create_table_${tbl}.sql: テーブル新規作成（インライン PK ＋ TABLESPACE）
      if (tableDiff.newTable) {
        const createSql = buildCreateTableSql(tableDiff.newTable, targetDbms, includeComment, commentSource, includeTablespace, metadataContext);
        const header1 = formatSqlHeader(
          'migration.sql_header_create_table',
          cleanTableName,
          targetDbms
        );
        fileEntries.push({
          filename: `01_create_table_${tbl}.sql`,
          content: header1 + createSql + '\n',
        });
      }

      // 2. 02_indexes_and_comments_${tbl}.sql: PK以外の Index・FK 制約・コメント（対象がある場合のみ）
      const indexSqls = buildTableIndexCreationSql(tableDiff.newTable, targetDbms, includeTablespace);
      const fkSqls = buildTableFkCreationSql(cleanTableName, newRefs, targetDbms);
      const commentSqls = includeComment
        ? buildCommentSql(tableDiff, targetDbms, includeComment, commentSource)
        : [];
      const step2Statements = [...indexSqls, ...fkSqls, ...commentSqls];
      if (step2Statements.length > 0) {
        const header2 = formatSqlHeader(
          'migration.sql_header_indexes_and_comments',
          cleanTableName,
          targetDbms,
          'migration.sql_header_index_and_fk'
        );
        fileEntries.push({
          filename: `02_indexes_and_comments_${tbl}.sql`,
          content: header2 + step2Statements.join('\n\n') + '\n',
        });
      }
    }
    // =========================================================================
    // CASE C: DROP（1ファイル）
    // =========================================================================
    else if (mode === 'DROP') {
      const dropStatements = [];
      // MySQL の場合は FK 制約が残っていると DROP TABLE が外部キー制約エラーで失敗するため先行削除
      if (targetDbms === 'mysql' || targetDbms === 'mariadb') {
        const dropFkSqls = buildTableFkDropSql(cleanTableName, oldRefs, targetDbms);
        if (dropFkSqls.length > 0) {
          dropStatements.push(...dropFkSqls);
        }
      }

      const dropSql = buildDropTableSql(cleanTableName, targetDbms);
      dropStatements.push(dropSql);

      const header = formatSqlHeader(
        'migration.sql_header_drop_table',
        cleanTableName,
        targetDbms
      );
      fileEntries.push({
        filename: `01_drop_table_${tbl}.sql`,
        content: header + dropStatements.join('\n\n') + '\n',
      });
    }
    // =========================================================================
    // CASE D: ALTER_INPLACE / INDEX_ONLY / FK_ONLY / ATTR_ONLY / その他（1ファイル）
    // =========================================================================
    else {
      const { dropStatements: fkDropSqls, addStatements: fkAddSqls } = buildFkSql(
        cleanTableName,
        oldRefs,
        newRefs,
        tableDiff,
        targetDbms
      );
      const alterSqls = buildAlterTableSql(tableDiff, targetDbms, includeComment, commentSource);
      const indexSqls = buildIndexSql(tableDiff, targetDbms, includeTablespace);
      const commentSqls = buildCommentSql(tableDiff, targetDbms, includeComment, commentSource);

      const alterStatements = [
        ...fkDropSqls,
        ...alterSqls,
        ...indexSqls,
        ...fkAddSqls,
        ...commentSqls,
      ];

      const header = formatSqlHeader(
        'migration.sql_header_alter_table',
        cleanTableName,
        targetDbms
      );

      if (alterStatements.length > 0) {
        fileEntries.push({
          filename: `01_alter_table_${tbl}.sql`,
          content: header + alterStatements.join('\n\n') + '\n',
        });
      } else {
        const noChangesText = t('migration.sql_no_changes');
        fileEntries.push({
          filename: `01_alter_table_${tbl}.sql`,
          content: header + `-- ${noChangesText}\n`,
        });
      }
    }

    result[tableName] = fileEntries;
  }

  return result;
}

export default generateStandardMigrationSql;
