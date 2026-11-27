// 日本語コメント: マイグレーションSQL生成モジュール (src/core/migration-generator.js)
// スキーマ差分抽出結果から、指定テーブルごとのマイグレーションSQLファイル群（1〜5ファイル）を自動生成します。
// データ移行（INSERT INTO ... SELECT ...）時のインデックス再構築コスト削減および
// 外部キー(FK)制約違反エラー防止のため、CREATE TABLEからINDEX/FKを除外しデータ移行後のステップで一括付与します。

import { formatColumnFullType, cleanName } from './schema-diff.js';

/**
 * タイムスタンプ文字列 (YYYYMMDDHHMMSS)
 */
function getFormattedTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/**
 * SQLデフォルト値のスマート整形関数
 */
function formatSqlDefault(val, dataTypeStr) {
  if (val === undefined || val === null || String(val).trim() === '') return '';
  const strVal = String(val).trim();

  if (strVal.startsWith("'") && strVal.endsWith("'")) {
    return strVal;
  }

  const typeStr = (dataTypeStr || '').trim();
  const isStringType = /^(VARCHAR|VARCHAR2|CHAR|NVARCHAR|NVARCHAR2|TEXT|CLOB|STRING)/i.test(typeStr);

  if (isStringType) {
    return `'${strVal.replace(/'/g, "''")}'`;
  }

  if (!isNaN(Number(strVal))) {
    return strVal;
  }

  const isFunctionOrKeyword = /^(sysdate|current_timestamp|now\(\)|null|true|false|sequence\.nextval)/i.test(strVal) || strVal.endsWith(')') || strVal.startsWith('(');
  if (isFunctionOrKeyword) {
    return strVal;
  }

  return `'${strVal.replace(/'/g, "''")}'`;
}

/**
 * テーブル作成SQL (CREATE TABLE) を生成（INDEX・FK除外版）
 */
function generateCreateTableSql(tableNode, targetDbms, options = {}) {
  if (!tableNode) return '-- エラー: テーブル定義が存在しません';

  const lines = [];
  const noteStr = tableNode.note ? ` (${tableNode.note})` : '';
  lines.push(`-- ============================================================`);
  lines.push(`-- テーブル作成: ${tableNode.name}${noteStr}`);
  lines.push(`-- (※データ移行の高速化および依存関係保護のため、INDEX/FKは除外して作成します)`);
  lines.push(`-- ============================================================`);
  lines.push(`CREATE TABLE ${tableNode.name} (`);

  const colLines = [];
  const fields = tableNode.columns || tableNode.fields || [];

  const pkIndex = tableNode.indexes ? tableNode.indexes.find(idx => idx.pk || idx.isPrimaryKey) : null;
  const pkCols = pkIndex ? pkIndex.fields : fields.filter(f => f.pk).map(f => f.name);

  fields.forEach((field, index) => {
    const fullType = formatColumnFullType(field, targetDbms);
    let colDef = `  ${field.name} ${fullType}`;

    const rawDef = field.default !== undefined ? field.default : field.dbdefault;
    const formattedDef = formatSqlDefault(rawDef, fullType);
    if (formattedDef) {
      colDef += ` DEFAULT ${formattedDef}`;
    }

    if (field.notNull || field.not_null) {
      colDef += ` NOT NULL`;
    }

    const hasPkDef = pkCols.length > 0;
    const isLastField = (index === fields.length - 1);
    if (!isLastField || hasPkDef) {
      colDef += `,`;
    }

    colLines.push(colDef);
  });

  if (pkCols.length > 0) {
    const pkConstraintName = (pkIndex && pkIndex.name) ? pkIndex.name : `PK_${tableNode.name.toUpperCase()}`;
    colLines.push(`  CONSTRAINT ${pkConstraintName} PRIMARY KEY (${pkCols.join(', ')})`);
  }

  lines.push(colLines.join('\n'));
  lines.push(`);`);
  lines.push('');

  // コメント出力 (COMMENT ON)
  if (options.includeComment !== false) {
    if (tableNode.note) {
      lines.push(`COMMENT ON TABLE ${tableNode.name} IS '${tableNode.note.replace(/'/g, "''")}';`);
    }
    fields.forEach(field => {
      if (field.note) {
        lines.push(`COMMENT ON COLUMN ${tableNode.name}.${field.name} IS '${field.note.replace(/'/g, "''")}';`);
      }
    });
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * 退避および外部キー・制約削除SQL (ファイル1)
 */
function generateRenameAndDropConstraintsSql(tableName, oldBackupName, oldTableNode, targetDbms, options = {}) {
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- ステップ1: テーブル退避および外部キー制約の事前解除`);
  lines.push(`-- 対象テーブル: ${tableName} ➔ 一時退避名: ${oldBackupName}`);
  lines.push(`-- ============================================================`);

  const dbms = (targetDbms || 'oracle').toLowerCase();
  if (dbms === 'oracle') {
    lines.push(`-- 既存テーブルの名前変更`);
    lines.push(`ALTER TABLE ${tableName} RENAME TO ${oldBackupName};`);
  } else if (dbms === 'mysql') {
    lines.push(`RENAME TABLE ${tableName} TO ${oldBackupName};`);
  } else {
    // postgresql
    lines.push(`ALTER TABLE ${tableName} RENAME TO ${oldBackupName};`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * データ移行SQL (INSERT INTO ... SELECT ...)
 */
function generateInsertDataSql(tableName, oldBackupName, tableDiff, targetDbms, options = {}) {
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- ステップ3: 旧テーブルから新テーブルへのデータ一括移行`);
  lines.push(`-- 移行元: ${oldBackupName} ➔ 移行先: ${tableName}`);
  lines.push(`-- ============================================================`);

  const oldFields = (tableDiff.oldTable?.columns || tableDiff.oldTable?.fields || []).map(f => f.name);
  const newFields = (tableDiff.newTable?.columns || tableDiff.newTable?.fields || []).map(f => f.name);

  // 旧新共通のカラムを特定
  const commonCols = newFields.filter(fName => oldFields.some(oldName => cleanName(oldName) === cleanName(fName)));

  if (commonCols.length === 0) {
    lines.push(`-- 共通カラムが存在しないため、データ移行はスキップされます。`);
    return lines.join('\n');
  }

  const colListStr = commonCols.join(', ');
  lines.push(`INSERT INTO ${tableName} (`);
  lines.push(`  ${colListStr}`);
  lines.push(`)`);
  lines.push(`SELECT`);
  lines.push(`  ${colListStr}`);
  lines.push(`FROM ${oldBackupName};`);
  lines.push('');
  lines.push(`COMMIT;`);
  lines.push('');

  return lines.join('\n');
}

/**
 * インデックスおよび外部キー作成SQL
 */
function generateIndexesAndFkSql(tableNode, targetDbms, diffResult, options = {}) {
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- インデックス作成および外部キー(FK)制約付与`);
  lines.push(`-- 対象テーブル: ${tableNode.name}`);
  lines.push(`-- ============================================================`);

  const indexes = (tableNode.indexes || []).filter(idx => !idx.pk && !idx.isPrimaryKey);
  indexes.forEach(idx => {
    const rawCols = idx.fields || idx.columns || [];
    const colStr = rawCols.join(', ');
    const uniqueStr = idx.unique ? 'UNIQUE ' : '';
    const idxName = idx.name || `IDX_${tableNode.name}_${rawCols.join('_')}`.toUpperCase();

    lines.push(`CREATE ${uniqueStr}INDEX ${idxName} ON ${tableNode.name} (${colStr});`);
  });

  // 外部キー(Ref)の抽出
  const allRefs = diffResult?.newAst?.refs || [];
  const cleanTbl = cleanName(tableNode.name);

  allRefs.forEach(ref => {
    const fromParts = (ref.from || '').split('.');
    const toParts = (ref.to || '').split('.');

    if (fromParts.length >= 2 && cleanName(fromParts[0]) === cleanTbl) {
      const fromCol = fromParts[1];
      const toTbl = toParts[0];
      const toCol = toParts[1];
      const fkName = ref.name || `FK_${tableNode.name}_${fromCol}`.toUpperCase();

      lines.push(`ALTER TABLE ${tableNode.name} ADD CONSTRAINT ${fkName} FOREIGN KEY (${fromCol}) REFERENCES ${toTbl} (${toCol});`);
    }
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * 退避テーブル削除SQL (ステップ5)
 */
function generateDropBackupTableSql(oldBackupName, targetDbms, options = {}) {
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- ステップ5: 一時退避テーブルのクリーンアップ削除`);
  lines.push(`-- 対象テーブル: ${oldBackupName}`);
  lines.push(`-- ============================================================`);
  lines.push(`DROP TABLE ${oldBackupName} CASCADE CONSTRAINTS;`);
  lines.push('');
  return lines.join('\n');
}

/**
 * 単純変更用 ALTER TABLE スクリプト (ALTER_INPLACE)
 */
function generateAlterTableSql(tableDiff, targetDbms, options = {}) {
  const lines = [];
  const tblName = tableDiff.name;
  lines.push(`-- ============================================================`);
  lines.push(`-- テーブル定義変更 (ALTER TABLE): ${tblName}`);
  lines.push(`-- ============================================================`);

  (tableDiff.columnsDiff || []).forEach(colDiff => {
    const colName = colDiff.name;
    const col = colDiff.newColumn;
    const fullType = col ? formatColumnFullType(col, targetDbms) : '';

    if (colDiff.status === 'ADDED') {
      let addDef = `${colName} ${fullType}`;
      if (col.notNull || col.not_null) addDef += ' NOT NULL';
      lines.push(`ALTER TABLE ${tblName} ADD (${addDef});`);
    } else if (colDiff.status === 'DROPPED') {
      lines.push(`ALTER TABLE ${tblName} DROP COLUMN ${colName};`);
    } else if (colDiff.status === 'MODIFIED') {
      let modDef = `${colName} ${fullType}`;
      lines.push(`ALTER TABLE ${tblName} MODIFY (${modDef});`);
    }
  });

  lines.push('');
  return lines.join('\n');
}

/**
 * テーブル削除SQL (DROP TABLE)
 */
function generateDropTableSql(tableName, targetDbms, options = {}) {
  const lines = [];
  lines.push(`-- ============================================================`);
  lines.push(`-- テーブル削除: ${tableName}`);
  lines.push(`-- ============================================================`);
  lines.push(`DROP TABLE ${tableName} CASCADE CONSTRAINTS;`);
  lines.push('');
  return lines.join('\n');
}

/**
 * 差分結果から選択されたテーブルのマイグレーションSQLファイル群を生成
 * @param {Object} diffResult - diffSchemas の戻り値
 * @param {Object} options - { selectedTableNames, targetDbms, includeComment }
 * @returns {Object} { [tableName]: Array<{ filename: string, content: string }> }
 */
export function generateMigrationScripts(diffResult, options = {}) {
  const targetDbms = (options.targetDbms || 'oracle').toLowerCase();
  const includeComment = options.includeComment !== false;
  const selectedTableNames = options.selectedTableNames
    ? options.selectedTableNames.map(n => cleanName(n))
    : null;

  const timestamp = getFormattedTimestamp();
  const result = {};
  const opts = { includeComment, targetDbms };

  for (const tableDiff of diffResult.tables || []) {
    const tableName = tableDiff.name;
    const cleanTbl = cleanName(tableName);

    if (selectedTableNames && !selectedTableNames.includes(cleanTbl)) {
      continue;
    }

    if (tableDiff.status === 'UNCHANGED') {
      continue;
    }

    if (tableDiff.status === 'ADD') {
      const file1 = generateCreateTableSql(tableDiff.newTable, targetDbms, opts);
      const file2 = generateIndexesAndFkSql(tableDiff.newTable, targetDbms, diffResult, opts);

      result[tableName] = [
        { filename: `01_create_table_${cleanTbl}.sql`, content: file1 }
      ];
      if (file2 && file2.trim()) {
        result[tableName].push({ filename: `02_create_indexes_and_fk_${cleanTbl}.sql`, content: file2 });
      }
    } else if (tableDiff.status === 'DROP') {
      result[tableName] = [
        { filename: `01_drop_table_${cleanTbl}.sql`, content: generateDropTableSql(tableName, targetDbms, opts) }
      ];
    } else if (tableDiff.status === 'MODIFY') {
      if (tableDiff.migrationMode === 'INDEX_ONLY') {
        const file1 = generateIndexesAndFkSql(tableDiff.newTable, targetDbms, diffResult, opts);
        result[tableName] = [
          { filename: `01_create_indexes_and_fk_${cleanTbl}.sql`, content: file1 }
        ];
      } else if (tableDiff.migrationMode === 'ALTER_INPLACE') {
        const file1 = generateAlterTableSql(tableDiff, targetDbms, opts);
        const file2 = generateIndexesAndFkSql(tableDiff.newTable, targetDbms, diffResult, opts);

        result[tableName] = [
          { filename: `01_alter_table_${cleanTbl}.sql`, content: file1 }
        ];
        if (file2 && file2.trim()) {
          result[tableName].push({ filename: `02_create_indexes_and_fk_${cleanTbl}.sql`, content: file2 });
        }
      } else {
        // RECREATE_TABLE (5ファイル分割)
        const oldBackupName = `${tableName}_OLD_${timestamp}`;
        const f1 = generateRenameAndDropConstraintsSql(tableName, oldBackupName, tableDiff.oldTable, targetDbms, opts);
        const f2 = generateCreateTableSql(tableDiff.newTable, targetDbms, opts);
        const f3 = generateInsertDataSql(tableName, oldBackupName, tableDiff, targetDbms, opts);
        const f4 = generateIndexesAndFkSql(tableDiff.newTable, targetDbms, diffResult, opts);
        const f5 = generateDropBackupTableSql(oldBackupName, targetDbms, opts);

        result[tableName] = [
          { filename: `01_rename_and_drop_constraints_${cleanTbl}.sql`, content: f1 },
          { filename: `02_create_table_${cleanTbl}.sql`, content: f2 },
          { filename: `03_insert_data_${cleanTbl}.sql`, content: f3 },
          { filename: `04_create_indexes_and_fk_${cleanTbl}.sql`, content: f4 },
          { filename: `05_drop_table_${cleanTbl}.sql`, content: f5 }
        ];
      }
    }
  }

  // 末尾改行の正規化
  for (const fileList of Object.values(result)) {
    fileList.forEach(fileObj => {
      if (fileObj.content) {
        fileObj.content = fileObj.content.trimEnd() + '\n';
      }
    });
  }

  return result;
}
