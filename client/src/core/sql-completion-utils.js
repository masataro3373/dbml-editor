// 日本語コメント: SQL ビジュアライザ用 オートコンプリート解析ユーティリティ (client/src/core/sql-completion-utils.js)
// SQL テキストからテーブルエイリアスを抽出し、「テーブル名.」や「エイリアス.」入力時のカラム補完候補を解決します。

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'OUTER', 'NATURAL',
  'ON', 'USING', 'GROUP', 'ORDER', 'BY', 'HAVING', 'UNION', 'INTERSECT', 'EXCEPT', 'ALL',
  'LIMIT', 'OFFSET', 'FETCH', 'FIRST', 'NEXT', 'ROWS', 'ONLY', 'FOR', 'UPDATE', 'SET',
  'VALUES', 'INTO', 'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'EXISTS', 'BETWEEN', 'LIKE',
  'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'CONNECT', 'START', 'WITH', 'PRIOR', 'PIVOT', 'UNPIVOT'
]);

/**
 * 識別子からクォート（" や `）を除去する
 * @param {string} ident
 * @returns {string}
 */
function stripQuotes(ident) {
  if (!ident) return '';
  return String(ident).replace(/^["`]+|["`]+$/g, '');
}

/**
 * SQL テキストからテーブルとエイリアスの対応マップを抽出する
 * @param {string} sqlText
 * @returns {Map<string, { schema: string, tableName: string }>} 小文字エイリアス名 -> { schema, tableName }
 */
export function extractSqlAliases(sqlText = '') {
  const aliases = new Map();
  if (!sqlText) return aliases;

  // コメントを空白に置換して誤検出を防止
  const cleaned = String(sqlText)
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ');

  // 1. FROM / JOIN 句の基本パターン: FROM [schema.]table [AS] alias
  const clauseRegex = /\b(?:FROM|JOIN)\s+(?:(["`]?\w+["`]?)\.)?(["`]?\w+["`]?)(?:\s+(?:AS\s+)?(["`]?\w+["`]?))?/gi;
  let match;
  while ((match = clauseRegex.exec(cleaned)) !== null) {
    const schema = stripQuotes(match[1] || '');
    const tableName = stripQuotes(match[2] || '');
    const rawAlias = stripQuotes(match[3] || '');
    if (tableName && rawAlias && !SQL_KEYWORDS.has(rawAlias.toUpperCase())) {
      aliases.set(rawAlias.toLowerCase(), { schema, tableName });
    }
  }

  // 2. カンマ結合の追加パターン: , [schema.]table [AS] alias
  const commaRegex = /,\s*(?:(["`]?\w+["`]?)\.)?(["`]?\w+["`]?)(?:\s+(?:AS\s+)?(["`]?\w+["`]?))?/gi;
  while ((match = commaRegex.exec(cleaned)) !== null) {
    const schema = stripQuotes(match[1] || '');
    const tableName = stripQuotes(match[2] || '');
    const rawAlias = stripQuotes(match[3] || '');
    if (tableName && rawAlias && !SQL_KEYWORDS.has(rawAlias.toUpperCase()) && !SQL_KEYWORDS.has(tableName.toUpperCase())) {
      aliases.set(rawAlias.toLowerCase(), { schema, tableName });
    }
  }

  return aliases;
}

/**
 * 指定されたスキーママップからテーブル定義を検索する（デフォルトスキーマ優先）
 * @param {Map<string, Object>} schemasMap
 * @param {string} tableName
 * @param {string} preferredSchema
 * @returns {Object|null}
 */
function findTableInSchemas(schemasMap, tableName, preferredSchema = '') {
  if (!(schemasMap instanceof Map) || !tableName) return null;
  const targetLc = tableName.toLowerCase();

  // 1. 優先スキーマ内を検索
  if (preferredSchema && schemasMap.has(preferredSchema)) {
    const entry = schemasMap.get(preferredSchema);
    const found = (entry?.model?.tables || []).find(t => (t.name || '').toLowerCase() === targetLc);
    if (found) return found;
  }

  // 2. 全スキーマを走査
  for (const [, entry] of schemasMap.entries()) {
    const found = (entry?.model?.tables || []).find(t => (t.name || '').toLowerCase() === targetLc);
    if (found) return found;
  }
  return null;
}

/**
 * 「prefix.」入力時の CodeMirror オートコンプリート候補を生成する
 * @param {Object} params
 * @param {string} params.prefix - ドット直前の識別子（テーブル名 / エイリアス名 / スキーマ名）
 * @param {Map<string, Object>} params.schemasMap - appStore.state.schemas
 * @param {string} [params.defaultSchema] - デフォルトスキーマ名
 * @param {Map<string, { schema: string, tableName: string }>} [params.aliases] - エイリアスマップ
 * @returns {Array<Object>}
 */
export function resolveDotCompletionItems({ prefix, schemasMap, defaultSchema = '', aliases = new Map() }) {
  const cleanPrefix = stripQuotes(prefix);
  if (!cleanPrefix || !(schemasMap instanceof Map)) return [];
  const prefixLc = cleanPrefix.toLowerCase();

  // 1. エイリアスからテーブル解決、または直接テーブル名として検索
  let targetTable = null;
  const aliasInfo = aliases.get(prefixLc);
  if (aliasInfo) {
    targetTable = findTableInSchemas(schemasMap, aliasInfo.tableName, aliasInfo.schema || defaultSchema);
  }
  if (!targetTable) {
    targetTable = findTableInSchemas(schemasMap, cleanPrefix, defaultSchema);
  }

  if (targetTable) {
    const fields = targetTable.fields || targetTable.columns || [];
    return fields.map((field) => {
      const typeStr = String(field.type?.type_name || field.type || '');
      const detailParts = [];
      if (field.pk) detailParts.push('PK');
      if (typeStr) detailParts.push(typeStr);
      if (field.logicalName) detailParts.push(`(${field.logicalName})`);
      return {
        label: field.name,
        type: 'property',
        detail: detailParts.join(' '),
        info: field.note || undefined,
        boost: field.pk ? 2 : 0
      };
    });
  }

  // 2. スキーマ名と一致した場合はそのスキーマ内のテーブル一覧を返す
  for (const [schemaName, entry] of schemasMap.entries()) {
    if (schemaName.toLowerCase() === prefixLc) {
      const tables = entry?.model?.tables || [];
      return tables.map((t) => ({
        label: t.name,
        type: 'class',
        detail: t.logicalName ? `Table (${t.logicalName})` : 'Table'
      }));
    }
  }

  return [];
}
