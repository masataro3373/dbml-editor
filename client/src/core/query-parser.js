/**
 * 高度SQLクエリパーサーモジュール (client/src/core/query-parser.js)
 * 
 * node-sql-parser をベースに、実務の現場で多用される
 * 「WITH句 (CTE)」「FROM句インラインビュー」「カンマ区切り暗黙JOIN」「Oracle構文 (+)」
 * 「UNION / UNION ALL」「SELECT/WHERE内の相関・非相関サブクエリ」「関数・CASE・OR条件」
 * に対応したAST解析を行い、ビジュアライザー用データモデルへ変換します。
 */
import * as nodeSqlParserModule from 'node-sql-parser';

// Vite / CommonJS インターロップの安全な初期化
const ParserClass = nodeSqlParserModule.Parser || nodeSqlParserModule.default?.Parser || nodeSqlParserModule.default;
const parser = new ParserClass();

/**
 * 式(Expression)オブジェクトから可読性のある文字列を抽出・整形する汎用ヘルパー関数
 * 関数引数・CASE式・修飾付きアスタリスクも展開し、内部のカラム参照を保持します。
 * @param {Object|string|number} expr - AST式ノード
 * @returns {string} 整形後の文字列表現
 */
export function exprToString(expr) {
  if (expr === null || expr === undefined) return '';
  if (typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') {
    return String(expr);
  }
  if (typeof expr !== 'object') return String(expr);

  const typeLower = String(expr.type || '').toLowerCase();

  // 1. 列参照 (table.column または column)
  if (typeLower === 'column_ref') {
    const tablePrefix = expr.table ? `${expr.table}.` : '';
    const colName = typeof expr.column === 'object' ? exprToString(expr.column) : expr.column;
    return `${tablePrefix}${colName}`;
  }

  // 2. 文字列リテラル
  if (typeLower === 'single_quote_string' || typeLower === 'string') {
    return `'${expr.value}'`;
  }

  // 3. 数値・真偽値・NULLリテラル
  if (typeLower === 'number' || typeLower === 'numeric' || typeLower === 'int' || typeLower === 'bigint') {
    return String(expr.value);
  }
  if (typeLower === 'bool' || typeLower === 'boolean') {
    return String(expr.value).toUpperCase();
  }
  if (typeLower === 'null') {
    return 'NULL';
  }

  // 4. 二項演算式 (例: a.id = b.id, status = 'ACTIVE')
  if (typeLower === 'binary_expr') {
    const left = exprToString(expr.left);
    const right = exprToString(expr.right);
    const body = `${left} ${expr.operator} ${right}`;
    return expr.parentheses ? `(${body})` : body;
  }

  // 5. 単項演算式 (例: NOT ..., -value)
  if (typeLower === 'unary_expr') {
    return `${expr.operator} ${exprToString(expr.expr)}`;
  }

  // 6. 式リスト (例: IN (1, 2, 3))
  if (typeLower === 'expr_list') {
    const values = Array.isArray(expr.value) ? expr.value.map(exprToString).join(', ') : exprToString(expr.value);
    return `(${values})`;
  }

  // 7. アスタリスク (table.* または *)
  if (typeLower === 'star') {
    return expr.table ? `${expr.table}.*` : '*';
  }

  // 8. CASE 式 (WHEN / THEN / ELSE を展開)
  if (typeLower === 'case') {
    const branches = Array.isArray(expr.args) ? expr.args.map(arg => {
      if (arg.type === 'when') {
        return `WHEN ${exprToString(arg.cond)} THEN ${exprToString(arg.result)}`;
      }
      if (arg.type === 'else') {
        return `ELSE ${exprToString(arg.result)}`;
      }
      return exprToString(arg);
    }).join(' ') : '';
    const base = expr.expr ? ` ${exprToString(expr.expr)}` : '';
    return `CASE${base} ${branches} END`.trim();
  }

  // 9. 集約関数 (aggr_func: COUNT(*), SUM(...), MAX(...) 等)
  if (typeLower === 'aggr_func') {
    const funcName = String(expr.name || 'FUNC').toUpperCase();
    const argExpr = expr.args?.expr ? exprToString(expr.args.expr) : (expr.args ? exprToString(expr.args) : '');
    const distinctStr = expr.args?.distinct ? 'DISTINCT ' : '';
    return `${funcName}(${distinctStr}${argExpr})`;
  }

  // 10. 通常関数呼び出し (例: TO_CHAR(...), NVL(...), TRIM(...))
  if (typeLower === 'function' || expr.name) {
    let nameStr = 'FUNC';
    if (typeof expr.name === 'string') nameStr = expr.name;
    else if (typeof expr.name === 'object') {
      if (Array.isArray(expr.name.name)) {
        nameStr = expr.name.name.map(n => n.value || n).join('.');
      } else {
        nameStr = exprToString(expr.name);
      }
    }
    let argsStr = '';
    if (expr.args) {
      if (Array.isArray(expr.args.value)) {
        argsStr = expr.args.value.map(exprToString).join(', ');
      } else if (Array.isArray(expr.args)) {
        argsStr = expr.args.map(exprToString).join(', ');
      } else if (expr.args.expr) {
        argsStr = exprToString(expr.args.expr);
      } else {
        argsStr = exprToString(expr.args);
      }
    }
    return `${String(nameStr).toUpperCase()}(${argsStr})`;
  }

  // 11. サブクエリ
  if (typeLower === 'select' || typeLower === 'subquery' || expr.ast) {
    return 'SUBQUERY(...)';
  }

  // 12. 汎用値プロパティが存在する場合
  if (expr.value !== undefined) {
    if (typeof expr.value === 'object') return exprToString(expr.value);
    return String(expr.value);
  }

  // 13. その他のキーワードノード (CAST, INTERVAL等)
  if (typeLower) {
    const keyword = typeLower.replace(/_expr$/, '').replace(/_func$/, '');
    return `${keyword.toUpperCase()}(...)`;
  }

  return 'EXPR(...)';
}

/**
 * 式ASTからすべての column_ref ({ table, column }) を再帰抽出します（サブクエリ境界では停止）。
 * @param {Object} expr
 * @param {Array<{table: string, column: string}>} outRefs
 */
function extractColumnRefsFromExpr(expr, outRefs = []) {
  if (!expr || typeof expr !== 'object') return outRefs;
  if (Array.isArray(expr)) {
    expr.forEach(item => extractColumnRefsFromExpr(item, outRefs));
    return outRefs;
  }

  const typeLower = String(expr.type || '').toLowerCase();
  // サブクエリ内部は別スコープで解析するため、ここでは踏み込まない
  if (typeLower === 'select' || expr.ast) {
    return outRefs;
  }

  if (typeLower === 'column_ref') {
    const colName = typeof expr.column === 'object' ? exprToString(expr.column) : String(expr.column || '');
    outRefs.push({
      table: expr.table ? String(expr.table) : '',
      column: colName
    });
    return outRefs;
  }

  for (const key of Object.keys(expr)) {
    if (key === 'loc' || key === 'parentheses') continue;
    const val = expr[key];
    if (val && typeof val === 'object') {
      extractColumnRefsFromExpr(val, outRefs);
    }
  }
  return outRefs;
}

/**
 * 式ASTから内部に埋め込まれたサブクエリ (select AST) を再帰抽出します。
 * @param {Object} expr
 * @param {Array<{ast: Object, operator: string}>} outSubqueries
 * @param {string} parentContextLabel
 */
function extractSubqueriesFromExpr(expr, outSubqueries = [], parentContextLabel = '') {
  if (!expr || typeof expr !== 'object') return outSubqueries;
  if (Array.isArray(expr)) {
    expr.forEach(item => extractSubqueriesFromExpr(item, outSubqueries, parentContextLabel));
    return outSubqueries;
  }

  if (expr.ast && expr.ast.type === 'select') {
    outSubqueries.push({ ast: expr.ast, contextLabel: parentContextLabel });
    return outSubqueries;
  }
  if (expr.type === 'select') {
    outSubqueries.push({ ast: expr, contextLabel: parentContextLabel });
    return outSubqueries;
  }

  let nextLabel = parentContextLabel;
  if (expr.type === 'binary_expr' && expr.operator) {
    nextLabel = String(expr.operator).toUpperCase();
  } else if (expr.type === 'function' && expr.name) {
    nextLabel = exprToString(expr.name).toUpperCase();
  }

  for (const key of Object.keys(expr)) {
    if (key === 'loc') continue;
    const val = expr[key];
    if (val && typeof val === 'object') {
      extractSubqueriesFromExpr(val, outSubqueries, nextLabel);
    }
  }
  return outSubqueries;
}

/**
 * SQL文字列から Oracle 外部結合演算子 (+) の付いたテーブル.カラムペアを事前抽出します。
 * @param {string} sqlString
 * @returns {Set<string>} "tableAlias.colName" (小文字) の集合
 */
function collectOracleOuterMarkers(sqlString) {
  const markers = new Set();
  if (!sqlString) return markers;
  const regex = /([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*\(\+\)/g;
  let m;
  while ((m = regex.exec(sqlString)) !== null) {
    markers.add(`${m[1].toLowerCase()}.${m[2].toLowerCase()}`);
  }
  return markers;
}

/**
 * WHERE句のASTを再帰的に走査し、
 * ① 2つのテーブル間を等号結合している条件（暗黙JOIN）
 * ② 単一テーブルの絞り込み条件（WHEREフィルター）
 * を分離・抽出します（AND / OR の両方に対応）。
 * 
 * @param {Object} whereAst - WHERE句のASTノード
 * @param {Array} resultWhereConditions - 通常のWHERE条件の格納先
 * @param {Array} resultImplicitJoins - 暗黙JOIN（テーブル間結合）の格納先
 * @param {Map<string, Object>} activeTablesMap - クエリ内で有効なテーブルエイリアスマップ
 * @param {Set<string>} oracleOuterMarkers - Oracle (+) マーカー集合
 * @param {boolean} isInsideOr - OR 句の配下かどうか
 */
function extractWhereAndImplicitJoins(
  whereAst,
  resultWhereConditions,
  resultImplicitJoins,
  activeTablesMap,
  oracleOuterMarkers = new Set(),
  isInsideOr = false
) {
  if (!whereAst) return;

  // AND / OR 条件で結ばれている場合は左右を個別に再帰分解
  if (whereAst.type === 'binary_expr' && ['AND', 'OR'].includes(String(whereAst.operator || '').toUpperCase())) {
    const opUpper = String(whereAst.operator).toUpperCase();
    const childInsideOr = isInsideOr || opUpper === 'OR';
    extractWhereAndImplicitJoins(whereAst.left, resultWhereConditions, resultImplicitJoins, activeTablesMap, oracleOuterMarkers, childInsideOr);
    extractWhereAndImplicitJoins(whereAst.right, resultWhereConditions, resultImplicitJoins, activeTablesMap, oracleOuterMarkers, childInsideOr);
    return;
  }

  let condStr = exprToString(whereAst);

  // OR 配下でない二項等号演算 (tableA.col = tableB.col) かどうかを判定
  if (!isInsideOr && whereAst.type === 'binary_expr' && whereAst.operator === '=') {
    const left = whereAst.left;
    const right = whereAst.right;

    // 左右両方が column_ref であり、異なるテーブルエイリアスを持つかチェック
    if (left && right && left.type === 'column_ref' && right.type === 'column_ref') {
      const leftTable = left.table || '';
      const rightTable = right.table || '';
      const leftCol = typeof left.column === 'object' ? exprToString(left.column) : String(left.column || '');
      const rightCol = typeof right.column === 'object' ? exprToString(right.column) : String(right.column || '');

      if (leftTable && rightTable && leftTable.toLowerCase() !== rightTable.toLowerCase()) {
        const leftMatch = activeTablesMap.has(leftTable.toLowerCase());
        const rightMatch = activeTablesMap.has(rightTable.toLowerCase());

        // 両テーブルがFROM句に存在する有効なエイリアスの場合、暗黙JOINとして登録
        if (leftMatch && rightMatch) {
          const leftMarkerKey = `${leftTable.toLowerCase()}.${leftCol.toLowerCase()}`;
          const rightMarkerKey = `${rightTable.toLowerCase()}.${rightCol.toLowerCase()}`;
          const hasLeftPlus = oracleOuterMarkers.has(leftMarkerKey) || condStr.includes(`${leftTable}.${leftCol}(+)`);
          const hasRightPlus = oracleOuterMarkers.has(rightMarkerKey) || condStr.includes(`${rightTable}.${rightCol}(+)`);

          let joinType = 'IMPLICIT JOIN';
          let isOracleOuter = false;
          if (hasLeftPlus || hasRightPlus) {
            isOracleOuter = true;
            if (hasRightPlus && !hasLeftPlus) {
              joinType = 'LEFT OUTER JOIN (+)';
            } else if (hasLeftPlus && !hasRightPlus) {
              joinType = 'RIGHT OUTER JOIN (+)';
            } else {
              joinType = 'OUTER JOIN (+)';
            }
            // condStr 側に (+) が抜けていれば復元
            const leftDisp = hasLeftPlus && !condStr.includes(`${leftTable}.${leftCol}(+)`)
              ? `${leftTable}.${leftCol}(+)`
              : `${leftTable}.${leftCol}`;
            const rightDisp = hasRightPlus && !condStr.includes(`${rightTable}.${rightCol}(+)`)
              ? `${rightTable}.${rightCol}(+)`
              : `${rightTable}.${rightCol}`;
            condStr = `${leftDisp} = ${rightDisp}`;
          }

          resultImplicitJoins.push({
            leftTableAlias: leftTable,
            leftColumn: leftCol,
            rightTableAlias: rightTable,
            rightColumn: rightCol,
            joinType,
            condition: condStr,
            isImplicit: true,
            isOracleOuter
          });
          return;
        }
      }
    }
  }

  // 暗黙JOINに該当しない場合は、式中の column_ref から対象テーブルエイリアスを特定して通常のWHERE条件として登録
  let targetAlias = null;
  const refs = extractColumnRefsFromExpr(whereAst, []);
  const matchedRef = refs.find(r => r.table && activeTablesMap.has(r.table.toLowerCase()));
  if (matchedRef) {
    targetAlias = matchedRef.table;
  } else if (refs.length > 0 && refs[0].table) {
    targetAlias = refs[0].table;
  } else {
    const match = condStr.match(/([a-zA-Z0-9_$]+)\.[a-zA-Z0-9_$]+/);
    if (match && activeTablesMap.has(match[1].toLowerCase())) {
      targetAlias = match[1];
    }
  }

  resultWhereConditions.push({
    targetAlias: targetAlias || 'GLOBAL',
    condition: condStr
  });
}

/**
 * 様々なデータ構造 (Map, Array, Object) から全テーブル定義をフラットに抽出するヘルパー関数
 * @param {*} schemaData 
 * @returns {Array<Object>}
 */
export function getAllTablesFromSchemaData(schemaData) {
  const tables = [];
  if (!schemaData) return tables;

  if (schemaData instanceof Map) {
    for (const [key, val] of schemaData.entries()) {
      const schemaName = (val && val.name) || String(key || '');
      if (val && val.model && Array.isArray(val.model.tables)) {
        val.model.tables.forEach(t => tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || schemaName }));
      } else if (val && Array.isArray(val.tables)) {
        val.tables.forEach(t => tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || schemaName }));
      }
    }
  } else if (Array.isArray(schemaData)) {
    for (const item of schemaData) {
      if (item && item.model && Array.isArray(item.model.tables)) {
        const sName = item.name || '';
        item.model.tables.forEach(t => tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || sName }));
      } else if (item && Array.isArray(item.tables)) {
        const sName = item.name || '';
        item.tables.forEach(t => tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || sName }));
      } else if (item && item.name && (item.fields || item.columns)) {
        tables.push(item);
      }
    }
  } else if (typeof schemaData === 'object') {
    if (Array.isArray(schemaData.tables)) {
      const sName = schemaData.name || '';
      schemaData.tables.forEach(t => tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || sName }));
    }
  }
  return tables;
}

/**
 * 明示的スキーマ名またはデフォルトスキーマを優先してDBMLテーブル定義を解決します。
 * @param {string} tableName - テーブル名
 * @param {string|null} explicitSchema - SQL上で指定されたスキーマ名
 * @param {*} schemaData - DBMLスキーマデータ
 * @param {string|null} defaultSchema - デフォルトスキーマ名
 * @returns {Object|null} マッチしたテーブル定義
 */
function resolveSchemaTable(tableName, explicitSchema, schemaData, defaultSchema) {
  if (!tableName || !schemaData) return null;
  const allTables = getAllTablesFromSchemaData(schemaData);
  const targetLower = tableName.toLowerCase();
  const candidates = allTables.filter(t => (t.name || '').toLowerCase() === targetLower);
  if (candidates.length === 0) return null;

  const preferredSchema = (explicitSchema || defaultSchema || '').trim().toLowerCase();
  if (preferredSchema) {
    const exact = candidates.find(t => {
      const sName = String(t._schemaName || t.schemaName || (t.schema && t.schema.name) || '').trim().toLowerCase();
      return sName === preferredSchema;
    });
    if (exact) return exact;
  }
  return candidates[0];
}

/**
 * DBMLスキーマ定義を参照し、テーブル無修飾のカラム名から所属テーブルを逆引きします。
 * @param {string} columnName - カラム名
 * @param {Array<Object>} queryTables - クエリ内で使用されているテーブルノード一覧
 * @param {Array|Map|Object} dbmlSchemas - DBMLプロジェクトの全スキーマデータ
 * @returns {string|null} 発見されたテーブルエイリアス（見つからない場合は null）
 */
function resolveTableForColumn(columnName, queryTables, dbmlSchemas) {
  if (!columnName || !queryTables || queryTables.length === 0 || !dbmlSchemas) return null;

  const targetColLower = columnName.toLowerCase();
  const allTables = getAllTablesFromSchemaData(dbmlSchemas);

  for (const qTable of queryTables) {
    if (qTable.columns && Array.isArray(qTable.columns)) {
      const foundInVirtual = qTable.columns.find(c =>
        (c.alias || c.name || '').toLowerCase() === targetColLower
      );
      if (foundInVirtual) return qTable.alias;
    }

    const tableDef = allTables.find(t => t.name.toLowerCase() === qTable.name.toLowerCase());
    if (tableDef && tableDef.fields) {
      const foundField = tableDef.fields.find(f => f.name.toLowerCase() === targetColLower);
      if (foundField) return qTable.alias;
    }
  }

  return null;
}

/**
 * 集合演算 (_next: UNION / UNION ALL / INTERSECT / MINUS 等) を含む SELECT チェーンを再帰解析します。
 * @param {Object} rootSelectAst
 * @param {Object} context
 * @param {string} scopePrefix
 * @param {Map<string, Object>} [outerTablesMap] - 親スコープのテーブルマップ（相関サブクエリ検知用）
 * @returns {Object} { tables, joins, selectColumns, whereConditions }
 */
function parseSelectChain(rootSelectAst, context, scopePrefix = 'main', outerTablesMap = null) {
  const combined = {
    tables: [],
    joins: [],
    selectColumns: [],
    whereConditions: []
  };

  let curr = rootSelectAst;
  let branchIdx = 0;

  while (curr && curr.type === 'select') {
    const branchScope = branchIdx === 0 ? scopePrefix : `${scopePrefix}_u${branchIdx}`;
    const branchResult = parseSelectAst(curr, context, branchScope, outerTablesMap);

    branchResult.tables.forEach(t => {
      if (!combined.tables.some(existing => existing.id === t.id)) {
        combined.tables.push(t);
      }
    });
    branchResult.joins.forEach(j => combined.joins.push(j));
    branchResult.whereConditions.forEach(w => combined.whereConditions.push(w));

    // SELECT 列は先頭ブランチを主軸としつつ、全ブランチのカラム使用フラグ用にマージ
    branchResult.selectColumns.forEach(c => combined.selectColumns.push(c));

    curr = curr._next || null;
    branchIdx++;
  }

  return combined;
}

/**
 * 単一の SELECT 文 AST（メインクエリ、CTE内部クエリ、サブクエリ共通）を再帰解析します。
 * @param {Object} selectAst - 解析対象の SELECT AST
 * @param {Object} context - 共有コンテキスト
 * @param {string} scopePrefix - スコープ識別子
 * @param {Map<string, Object>} [outerTablesMap] - 親スコープのテーブルマップ（相関サブクエリ用）
 * @returns {Object} { tables, joins, selectColumns, whereConditions }
 */
function parseSelectAst(selectAst, context, scopePrefix = 'main', outerTablesMap = null) {
  const result = {
    tables: [],
    joins: [],
    selectColumns: [],
    whereConditions: []
  };

  if (!selectAst || selectAst.type !== 'select') {
    return result;
  }

  const activeTablesMap = new Map();

  // 1. FROM 句および JOIN 句の走査
  if (selectAst.from && Array.isArray(selectAst.from)) {
    selectAst.from.forEach((fromItem, idx) => {
      // A. インラインビュー / 派生テーブル (FROM (SELECT ...) sub)
      if (fromItem.expr && (fromItem.expr.ast || fromItem.expr.type === 'select')) {
        const innerSelect = fromItem.expr.ast || fromItem.expr;
        const subAlias = fromItem.as || `sub_${idx + 1}`;
        const subId = `${scopePrefix}_sub_${subAlias}`;

        // インラインビュー内側のクエリ（UNION含む）を再帰解析
        const innerResult = parseSelectChain(innerSelect, context, subId, outerTablesMap);

        // インラインビューの仮想ノードを生成
        const virtualColumns = innerResult.selectColumns.map(col => ({
          name: col.alias || col.columnName,
          alias: col.alias || col.columnName,
          expr: col.fullExpr,
          isKey: false,
          isOutput: true
        }));

        const subNode = {
          id: subId,
          type: 'subquery',
          schema: null,
          name: `(SubQuery: ${subAlias})`,
          alias: subAlias,
          label: subAlias,
          columns: virtualColumns,
          innerAst: innerSelect,
          sourceTableIds: innerResult.tables.map(t => t.id)
        };

        result.tables.push(subNode);
        activeTablesMap.set(subAlias.toLowerCase(), subNode);

        // 内側で生成されたテーブル・結合・WHERE条件もマージ
        innerResult.tables.forEach(t => result.tables.push(t));
        innerResult.joins.forEach(j => result.joins.push(j));
        innerResult.whereConditions.forEach(w => result.whereConditions.push(w));

        // インラインビューへのデータ供給パイプライン線を生成
        innerResult.tables.forEach(srcTable => {
          result.joins.push({
            id: `flow_${srcTable.id}_to_${subId}`,
            leftTableAlias: srcTable.alias,
            leftColumn: '',
            rightTableAlias: subAlias,
            rightColumn: '',
            joinType: 'SUBQUERY_SOURCE',
            condition: 'データ抽出・集計',
            isPipeline: true
          });
        });
      }
      // B. 通常の実テーブル参照 (または既存CTEの参照)
      else if (fromItem.table) {
        const schema = fromItem.db || null;
        const tableName = fromItem.table;
        const alias = fromItem.as || tableName;
        const tableId = `${scopePrefix}_${alias}`;

        // 既存のCTE定義を参照しているか確認
        const isCteRef = context.cteMap.has(tableName.toLowerCase());
        const cteDef = isCteRef ? context.cteMap.get(tableName.toLowerCase()) : null;

        let tableLabel = alias;
        let logicalName = '';
        let hasSchemaDef = false;
        let tableFields = [];

        if (cteDef) {
          tableLabel = `${alias} [CTE]`;
          tableFields = (cteDef.columns || []).map(c => ({ ...c }));
        } else if (context.schemaData) {
          const matched = resolveSchemaTable(tableName, schema, context.schemaData, context.defaultSchema);
          if (matched) {
            hasSchemaDef = true;
            logicalName = (matched.logicalName || matched.note || matched.headerComment || '').trim();
            const note = logicalName ? ` (${logicalName})` : '';
            tableLabel = `${alias}${note}`;

            // 日本語コメント: DBML テーブルの indexes / pk からインデックス対象カラム集合を構築
            const indexedColSet = new Set();
            const rawIndexes = matched.indexes || matched.indices || [];
            rawIndexes.forEach(idx => {
              const cols = idx.columns || idx.fields || [];
              cols.forEach(c => {
                const cName = typeof c === 'object' && c !== null ? (c.value || c.name || '') : String(c);
                if (cName) indexedColSet.add(cName.toLowerCase());
              });
            });

            const fields = matched.fields || matched.columns || [];
            tableFields = fields.map(f => {
              const fName = f.name || f;
              const isPk = Boolean(f.pk || f.isPk || f.isPrimaryKey);
              const isIndexed = isPk || Boolean(f.unique || f.indexed || f.isIndex) || indexedColSet.has(String(fName).toLowerCase());
              return {
                name: fName,
                alias: fName,
                type: typeof f.type === 'object' ? (f.type.type_name || '') : (f.type || ''),
                note: f.note || '',
                logicalName: (f.logicalName || f.note || '').trim(),
                isPk,
                isIndexed
              };
            });
          }
        }

        const tableNode = {
          id: tableId,
          type: isCteRef ? 'cte_ref' : 'table',
          schema: schema,
          name: tableName,
          alias: alias,
          label: tableLabel,
          logicalName,
          hasSchemaDef,
          columns: tableFields,
          innerAst: null,
          sourceTableIds: []
        };

        result.tables.push(tableNode);
        activeTablesMap.set(alias.toLowerCase(), tableNode);

        // CTE参照の場合は、元のCTEノードからのデータパイプライン線を引く
        if (isCteRef && cteDef) {
          result.joins.push({
            id: `flow_${cteDef.id}_to_${tableId}`,
            leftTableAlias: cteDef.alias,
            leftColumn: '',
            rightTableAlias: alias,
            rightColumn: '',
            joinType: 'CTE_PIPELINE',
            condition: '共通テーブル式 (CTE) 参照',
            isPipeline: true
          });
        }
      }

      // 明示的 JOIN (INNER JOIN, LEFT JOIN 等) の解析
      if (fromItem.join && idx > 0) {
        const joinType = (fromItem.join || 'INNER JOIN').toUpperCase();
        const onCond = fromItem.on ? exprToString(fromItem.on) : '';
        const currentAlias = fromItem.as || fromItem.table || (fromItem.expr && fromItem.expr.as);

        let leftAlias = '';
        let leftCol = '';
        let rightAlias = currentAlias || '';
        let rightCol = '';

        // 1. AST 内の column_ref から関数ラップを含めて左右の結合カラムを抽出
        if (fromItem.on) {
          const onRefs = extractColumnRefsFromExpr(fromItem.on, []);
          const rightRef = onRefs.find(r => r.table && r.table.toLowerCase() === (currentAlias || '').toLowerCase());
          const leftRef = onRefs.find(r => r.table && r.table.toLowerCase() !== (currentAlias || '').toLowerCase());
          if (rightRef) {
            rightAlias = rightRef.table;
            rightCol = rightRef.column;
          }
          if (leftRef) {
            leftAlias = leftRef.table;
            leftCol = leftRef.column;
          }
        }

        // 2. フォールバック正規表現
        if ((!leftAlias || !rightCol) && onCond) {
          const match = onCond.match(/([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)\s*=\s*([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)/i);
          if (match) {
            const t1 = match[1];
            const c1 = match[2];
            const t2 = match[3];
            const c2 = match[4];

            if (t1.toLowerCase() === (currentAlias || '').toLowerCase()) {
              rightAlias = t1;
              rightCol = c1;
              leftAlias = t2;
              leftCol = c2;
            } else {
              leftAlias = t1;
              leftCol = c1;
              rightAlias = t2;
              rightCol = c2;
            }
          }
        }

        if (!leftAlias && idx > 0) {
          const prevTable = result.tables[idx - 1];
          leftAlias = prevTable ? prevTable.alias : '';
        }

        result.joins.push({
          id: `join_${leftAlias}_${rightAlias}_${idx}`,
          leftTableAlias: leftAlias,
          leftColumn: leftCol,
          rightTableAlias: rightAlias,
          rightColumn: rightCol,
          joinType: joinType,
          condition: onCond,
          isImplicit: false
        });
      }
    });
  }

  // 2. 結合されたスコープマップ（現在スコープ + 親スコープ）を作成し、相関参照・WHEREを解析
  const combinedScopeMap = new Map(outerTablesMap || []);
  for (const [k, v] of activeTablesMap.entries()) {
    combinedScopeMap.set(k, v);
  }

  // WHERE 句の解析 ＆ 暗黙JOIN（カンマ結合）の自動抽出
  if (selectAst.where) {
    const implicitJoins = [];
    extractWhereAndImplicitJoins(
      selectAst.where,
      result.whereConditions,
      implicitJoins,
      combinedScopeMap,
      context.oracleOuterMarkers,
      false
    );
    implicitJoins.forEach((impJoin, idx) => {
      impJoin.id = `implicit_join_${scopePrefix}_${impJoin.leftTableAlias}_${impJoin.rightTableAlias}_${idx}`;
      // 親スコープテーブルとの結合は相関サブクエリ参照リンクとしてマーク
      const leftInOuter = outerTablesMap && outerTablesMap.has(impJoin.leftTableAlias.toLowerCase()) && !activeTablesMap.has(impJoin.leftTableAlias.toLowerCase());
      const rightInOuter = outerTablesMap && outerTablesMap.has(impJoin.rightTableAlias.toLowerCase()) && !activeTablesMap.has(impJoin.rightTableAlias.toLowerCase());
      if (leftInOuter || rightInOuter) {
        impJoin.joinType = 'CORRELATED';
        impJoin.isSubqueryRef = true;
      }
      result.joins.push(impJoin);
    });
  }

  // HAVING 句の解析
  if (selectAst.having) {
    const havingStr = exprToString(selectAst.having);
    if (havingStr) {
      result.whereConditions.push({
        targetAlias: 'HAVING',
        condition: `HAVING ${havingStr}`
      });
    }
  }

  // 3. WHERE 句・SELECT 句に含まれる相関・非相関サブクエリを展開
  const subqueriesToExpand = [];
  if (selectAst.where) {
    extractSubqueriesFromExpr(selectAst.where, subqueriesToExpand, 'WHERE');
  }
  if (Array.isArray(selectAst.columns)) {
    selectAst.columns.forEach(col => {
      if (col && col.expr) {
        extractSubqueriesFromExpr(col.expr, subqueriesToExpand, col.as ? `SELECT ${col.as}` : 'SELECT');
      }
    });
  }

  subqueriesToExpand.forEach((sq, sqIdx) => {
    const subScope = `${scopePrefix}_exprsub_${sqIdx + 1}`;
    const sqResult = parseSelectChain(sq.ast, context, subScope, combinedScopeMap);

    sqResult.tables.forEach(t => result.tables.push(t));
    sqResult.joins.forEach(j => result.joins.push(j));
    sqResult.whereConditions.forEach(w => result.whereConditions.push(w));

    // 相関リンクがまだ1本もない非相関サブクエリの場合は、親の主テーブルと参考リンクを結ぶ
    const hasCorrelated = sqResult.joins.some(j => j.isSubqueryRef);
    if (!hasCorrelated && sqResult.tables.length > 0 && result.tables.length > 0) {
      const parentAnchor = Array.from(activeTablesMap.values())[0] || result.tables[0];
      const childAnchor = sqResult.tables[0];
      if (parentAnchor && childAnchor && parentAnchor.alias.toLowerCase() !== childAnchor.alias.toLowerCase()) {
        result.joins.push({
          id: `subref_${subScope}`,
          leftTableAlias: parentAnchor.alias,
          leftColumn: '',
          rightTableAlias: childAnchor.alias,
          rightColumn: '',
          joinType: `SUBQUERY (${sq.contextLabel || 'REF'})`,
          condition: `${sq.contextLabel || 'SUBQUERY'} 参照`,
          isSubqueryRef: true
        });
      }
    }
  });

  // 4. SELECT カラムの抽出 ＆ 無修飾カラムの自動逆引き解決
  if (selectAst.columns) {
    if (selectAst.columns === '*') {
      result.selectColumns.push({
        tableAlias: '',
        columnName: '*',
        alias: '*',
        fullExpr: '*'
      });
    } else if (Array.isArray(selectAst.columns)) {
      selectAst.columns.forEach(col => {
        if (!col.expr) return;

        const expr = col.expr;
        let tableAlias = '';
        let columnName = '';

        if (expr.type === 'column_ref') {
          tableAlias = expr.table || '';
          columnName = typeof expr.column === 'object' ? exprToString(expr.column) : (expr.column || '');

          if (!tableAlias && context.schemaData) {
            const resolvedAlias = resolveTableForColumn(columnName, result.tables, context.schemaData);
            if (resolvedAlias) {
              tableAlias = resolvedAlias;
            }
          }
        } else if (expr.type === 'star') {
          tableAlias = expr.table || '';
          columnName = '*';
        } else {
          columnName = exprToString(expr);
          const refs = extractColumnRefsFromExpr(expr, []);
          if (refs.length > 0 && refs[0].table) {
            tableAlias = refs[0].table;
          }
        }

        const colAlias = col.as || columnName;
        result.selectColumns.push({
          tableAlias: tableAlias,
          columnName: columnName,
          alias: colAlias,
          fullExpr: col.as ? `${tableAlias ? tableAlias + '.' : ''}${columnName} AS ${col.as}` : `${tableAlias ? tableAlias + '.' : ''}${columnName}`
        });
      });
    }
  }

  return result;
}

/**
 * SQL文字列をパースし、ビジュアライザー用データモデル（テーブル、CTE、サブクエリ、リレーション）を生成します。
 * 
 * @param {string} sqlString - 入力SQLクエリ
 * @param {Object} options - 解析オプション
 * @param {string} [options.dialect='Generic'] - SQLダイアレクト ('Generic' | 'MySQL' | 'PostgreSQL' | 'Oracle')
 * @param {Array<Object>} [options.schemaData=[]] - プロジェクトの全DBMLスキーマデータ
 * @returns {Object} 解析結果 { tables, joins, selectColumns, whereConditions, error }
 */
export function parseSqlQuery(sqlString, options = {}) {
  const { dialect = 'Generic', schemaData = [], defaultSchema = null } = options;

  const result = {
    tables: [],
    joins: [],
    selectColumns: [],
    whereConditions: [],
    error: null
  };

  if (!sqlString || !sqlString.trim()) {
    return result;
  }

  // Oracle の外部結合演算子 (+) の位置を事前記録
  const hasOracleOuterJoin = /\(\+\)/.test(sqlString);
  const oracleOuterMarkers = collectOracleOuterMarkers(sqlString);
  const cleanSql = sqlString.trim().replace(/;+$/, '');

  // 指定ダイアレクト → Generic → MySQL の順で AST パースを試行するヘルパー
  const tryAstify = (sqlText) => {
    try {
      return parser.astify(sqlText, { database: dialect.toLowerCase() });
    } catch (_) {
      try {
        return parser.astify(sqlText);
      } catch (__) {
        return parser.astify(sqlText, { database: 'mysql' });
      }
    }
  };

  try {
    let ast;
    try {
      ast = tryAstify(cleanSql);
    } catch (firstErr) {
      // (+) 演算子が原因でパース失敗した場合は (+) を除去して再パース（記録済みマーカーで復元）
      if (hasOracleOuterJoin) {
        const sanitizedSql = cleanSql.replace(/\(\+\)/g, '');
        ast = tryAstify(sanitizedSql);
      } else {
        throw firstErr;
      }
    }

    const queryAst = Array.isArray(ast) ? ast[0] : ast;

    if (!queryAst || queryAst.type !== 'select') {
      result.error = 'SELECT文以外のクエリ、または構文解析できない形式です。';
      return result;
    }

    // 共有コンテキストの初期化
    const context = {
      schemaData,
      defaultSchema,
      cteMap: new Map(),
      oracleOuterMarkers
    };

    // 1. WITH 句 (CTE: 共通テーブル式) の先行再帰解析
    if (queryAst.with && Array.isArray(queryAst.with)) {
      queryAst.with.forEach((cteItem, idx) => {
        const cteName = (cteItem.name && (cteItem.name.value || cteItem.name)) || `cte_${idx + 1}`;
        const cteSelectAst = cteItem.stmt && (cteItem.stmt.ast || cteItem.stmt);
        const cteId = `cte_${cteName}`;

        if (cteSelectAst) {
          const cteResult = parseSelectChain(cteSelectAst, context, cteId);

          const virtualColumns = cteResult.selectColumns.map(col => ({
            name: col.alias || col.columnName,
            alias: col.alias || col.columnName,
            expr: col.fullExpr,
            isKey: false,
            isOutput: true
          }));

          const cteNode = {
            id: cteId,
            type: 'cte',
            schema: null,
            name: cteName,
            alias: cteName,
            label: `${cteName} [WITH]`,
            columns: virtualColumns,
            innerAst: cteSelectAst,
            sourceTableIds: cteResult.tables.map(t => t.id)
          };

          result.tables.push(cteNode);
          context.cteMap.set(cteName.toLowerCase(), cteNode);

          // CTE内側で参照されているテーブル・結合・WHERE条件もマージ
          cteResult.tables.forEach(t => result.tables.push(t));
          cteResult.joins.forEach(j => result.joins.push(j));
          cteResult.whereConditions.forEach(w => result.whereConditions.push(w));

          // 元テーブルからCTEへのデータ集約線を生成
          cteResult.tables.forEach(srcTable => {
            result.joins.push({
              id: `flow_${srcTable.id}_to_${cteId}`,
              leftTableAlias: srcTable.alias,
              leftColumn: '',
              rightTableAlias: cteName,
              rightColumn: '',
              joinType: 'CTE_SOURCE',
              condition: 'WITH句へのデータ集約',
              isPipeline: true
            });
          });
        }
      });
    }

    // 2. メインクエリ（UNIONチェーン含む）の解析
    const mainResult = parseSelectChain(queryAst, context, 'main');

    mainResult.tables.forEach(t => {
      if (!result.tables.some(existing => existing.id === t.id)) {
        result.tables.push(t);
      }
    });

    mainResult.joins.forEach(j => result.joins.push(j));
    result.selectColumns = mainResult.selectColumns;
    mainResult.whereConditions.forEach(w => result.whereConditions.push(w));

    // Oracle (+) 演算子が含まれる場合、該当する結合を OUTER_JOIN として注記
    if (hasOracleOuterJoin) {
      result.joins.forEach(j => {
        if (j.condition && j.condition.includes('(+)')) {
          j.isOracleOuter = true;
          if (!j.joinType || j.joinType === 'IMPLICIT JOIN') {
            j.joinType = 'OUTER JOIN (+)';
          }
        }
      });
    }

  } catch (err) {
    result.error = `構文解析エラー: ${err.message}`;
    // エラー停止を防ぐため正規表現フォールバックで基本テーブルとJOINを救出
    fallbackRegexParse(sqlString, result, schemaData);
  }

  // 各テーブルのカラムに使用状態（SELECT, JOIN, WHERE）フラグを付与
  decorateColumnsWithUsageFlags(result);

  return result;
}

/**
 * クエリ解析結果の全カラムに対して、SELECT / JOIN / WHERE での使用状態フラグを付与します。
 * スキーマにカラムが存在しない場合でも、クエリ内で参照されているカラムを自動生成します。
 * @param {Object} result 
 */
function decorateColumnsWithUsageFlags(result) {
  const selectColsByTable = new Map();
  (result.selectColumns || []).forEach(c => {
    const alias = (c.tableAlias || '').toLowerCase();
    if (!selectColsByTable.has(alias)) selectColsByTable.set(alias, new Set());
    selectColsByTable.get(alias).add((c.columnName || '').toLowerCase());
  });

  const joinColsByTable = new Map();
  (result.joins || []).forEach(j => {
    if (j.leftTableAlias && j.leftColumn) {
      const alias = j.leftTableAlias.toLowerCase();
      if (!joinColsByTable.has(alias)) joinColsByTable.set(alias, new Set());
      joinColsByTable.get(alias).add(j.leftColumn.toLowerCase());
    }
    if (j.rightTableAlias && j.rightColumn) {
      const alias = j.rightTableAlias.toLowerCase();
      if (!joinColsByTable.has(alias)) joinColsByTable.set(alias, new Set());
      joinColsByTable.get(alias).add(j.rightColumn.toLowerCase());
    }
    // condition 文字列から table.column パターンを抽出
    if (j.condition) {
      const matches = j.condition.matchAll(/([a-zA-Z0-9_$]+)\.([a-zA-Z0-9_$]+)/g);
      for (const m of matches) {
        const alias = m[1].toLowerCase();
        const col = m[2].toLowerCase();
        if (!joinColsByTable.has(alias)) joinColsByTable.set(alias, new Set());
        joinColsByTable.get(alias).add(col);
      }
    }
  });

  const whereColsByTable = new Map();
  (result.whereConditions || []).forEach(w => {
    const alias = (w.targetAlias || '').toLowerCase();
    if (!whereColsByTable.has(alias)) whereColsByTable.set(alias, new Set());
    if (w.condition) {
      const matches = w.condition.matchAll(/(?:([a-zA-Z0-9_$]+)\.)?([a-zA-Z0-9_$]+)/g);
      for (const m of matches) {
        const tAlias = m[1] ? m[1].toLowerCase() : alias;
        const col = m[2].toLowerCase();
        if (col.length > 1 && !['and', 'or', 'in', 'is', 'not', 'null', 'like', 'case', 'when', 'then', 'else', 'end', 'having'].includes(col)) {
          if (!whereColsByTable.has(tAlias)) whereColsByTable.set(tAlias, new Set());
          whereColsByTable.get(tAlias).add(col);
        }
      }
    }
  });

  result.tables.forEach(table => {
    const aliasLower = table.alias.toLowerCase();
    const selSet = selectColsByTable.get(aliasLower) || new Set();
    const isStarSelect = selSet.has('*') || (selectColsByTable.get('') && selectColsByTable.get('').has('*'));
    const joinSet = joinColsByTable.get(aliasLower) || new Set();
    const whereSet = whereColsByTable.get(aliasLower) || new Set();

    // スキーマからカラムが取得できなかった場合でも、クエリ内で使われているカラムを自動追加
    if (!table.columns || table.columns.length === 0) {
      const inferredColNames = new Set([...selSet, ...joinSet, ...whereSet]);
      inferredColNames.delete('*');
      table.columns = Array.from(inferredColNames).map(colName => ({
        name: colName,
        alias: colName,
        type: 'VARCHAR2',
        note: '',
        isPk: false
      }));
    }

    // 各カラムにフラグを設定
    table.columns.forEach(col => {
      const cLower = (col.name || '').toLowerCase();
      col.isSelect = Boolean(isStarSelect || selSet.has(cLower));
      col.isJoin = Boolean(joinSet.has(cLower));
      col.isWhere = Boolean(whereSet.has(cLower));
    });
  });
}

/**
 * 構文解析エラー時のセーフティネット（正規表現ベースのフォールバック抽出）
 * @param {string} sql 
 * @param {Object} result 
 * @param {Array<Object>} schemaData 
 */
function fallbackRegexParse(sql, result, schemaData) {
  // カンマ区切りおよびJOINを含む全テーブル名を簡易抽出
  const fromRegex = /FROM\s+([a-zA-Z0-9_$.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_$]+))?/i;
  const fromMatch = sql.match(fromRegex);
  if (fromMatch) {
    const rawTable = fromMatch[1];
    const alias = fromMatch[2] || rawTable.split('.').pop();
    const parts = rawTable.split('.');
    const name = parts.length > 1 ? parts[1] : parts[0];

    result.tables.push({
      id: `main_${alias}`,
      type: 'table',
      schema: parts.length > 1 ? parts[0] : null,
      name: name,
      alias: alias,
      label: alias,
      columns: [],
      innerAst: null,
      sourceTableIds: []
    });
  }

  // JOIN 句の救出
  const joinRegex = /(INNER|LEFT|RIGHT|FULL)?\s*JOIN\s+([a-zA-Z0-9_$.]+)(?:\s+(?:AS\s+)?([a-zA-Z0-9_$]+))?\s+ON\s+([^WHERE|GROUP|ORDER|HAVING|LIMIT]+)/gi;
  let match;
  while ((match = joinRegex.exec(sql)) !== null) {
    const rawTable = match[2];
    const alias = match[3] || rawTable.split('.').pop();
    const parts = rawTable.split('.');
    const name = parts.length > 1 ? parts[1] : parts[0];
    const condition = match[4].trim();

    result.tables.push({
      id: `main_${alias}`,
      type: 'table',
      schema: parts.length > 1 ? parts[0] : null,
      name: name,
      alias: alias,
      label: alias,
      columns: [],
      innerAst: null,
      sourceTableIds: []
    });

    result.joins.push({
      id: `fallback_join_${alias}`,
      leftTableAlias: result.tables[0] ? result.tables[0].alias : '',
      leftColumn: '',
      rightTableAlias: alias,
      rightColumn: '',
      joinType: (match[1] || 'INNER') + ' JOIN',
      condition: condition,
      isImplicit: false
    });
  }
}
