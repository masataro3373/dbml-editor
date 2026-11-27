/**
 * クエリパーサー自動検証テストスクリプト (scripts/test-query-parser.js)
 * 
 * WITH句、FROM句インラインビュー、カンマ区切り暗黙JOIN、
 * および無修飾カラムのDBML自動逆引きの正確性をテストします。
 */
import { parseSqlQuery } from '../client/src/core/query-parser.js';

// モック用のDBMLスキーマ定義データ
const mockSchemaData = [
  {
    name: 'public',
    tables: [
      {
        name: 'users',
        note: 'ユーザーマスタ',
        fields: [
          { name: 'user_id', pk: true, type: { type_name: 'NUMBER' } },
          { name: 'username', note: 'ユーザー名', type: { type_name: 'VARCHAR2' } },
          { name: 'department_id', type: { type_name: 'NUMBER' } }
        ]
      },
      {
        name: 'departments',
        note: '部署マスタ',
        fields: [
          { name: 'department_id', pk: true, type: { type_name: 'NUMBER' } },
          { name: 'department_name', note: '部署名', type: { type_name: 'VARCHAR2' } }
        ]
      },
      {
        name: 'orders',
        note: '注文テーブル',
        fields: [
          { name: 'order_id', pk: true, type: { type_name: 'NUMBER' } },
          { name: 'user_id', type: { type_name: 'NUMBER' } },
          { name: 'amount', note: '金額', type: { type_name: 'NUMBER' } }
        ]
      }
    ]
  }
];

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passCount++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failCount++;
  }
}

console.log('====================================================');
console.log(' 高度SQLパーサー（query-parser.js）自動検証テスト');
console.log('====================================================\n');

// -----------------------------------------------------------------
// ケース1: 標準的な明示的JOIN (INNER JOIN)
// -----------------------------------------------------------------
console.log('【ケース1: 標準的な明示的JOIN】');
const sql1 = `
  SELECT u.user_id, u.username, d.department_name
  FROM users u
  INNER JOIN departments d ON u.department_id = d.department_id
  WHERE u.username = '田中';
`;
const res1 = parseSqlQuery(sql1, { dialect: 'Generic', schemaData: mockSchemaData });
assert(!res1.error, '構文解析エラーなし');
assert(res1.tables.length === 2, `テーブル数が2 (取得: ${res1.tables.length})`);
assert(res1.joins.length === 1, `JOIN線が1本 (取得: ${res1.joins.length})`);
assert(res1.joins[0]?.joinType === 'INNER JOIN', 'INNER JOIN として認識');
assert(res1.whereConditions.length === 1, 'WHERE条件が1件');
console.log('');

// -----------------------------------------------------------------
// ケース2: カンマ区切りのレガシー暗黙JOIN
// -----------------------------------------------------------------
console.log('【ケース2: カンマ区切りの暗黙JOIN（WHERE結合）】');
const sql2 = `
  SELECT u.user_id, d.department_name
  FROM users u, departments d
  WHERE u.department_id = d.department_id
    AND u.username = '佐藤';
`;
const res2 = parseSqlQuery(sql2, { dialect: 'Generic', schemaData: mockSchemaData });
assert(!res2.error, '構文解析エラーなし');
assert(res2.tables.length === 2, `テーブル数が2 (取得: ${res2.tables.length})`);
const implicitJoin = res2.joins.find(j => j.isImplicit);
assert(Boolean(implicitJoin), 'WHERE句の等号条件から IMPLICIT JOIN が自動検出');
assert(implicitJoin?.leftTableAlias === 'u' && implicitJoin?.rightTableAlias === 'd', 'u と d の結合線を正しく確立');
assert(res2.whereConditions.length === 1, '通常のWHEREフィルター(佐藤)のみがWHERE条件に残存');
console.log('');

// -----------------------------------------------------------------
// ケース3: FROM句のインラインビュー（サブクエリ）
// -----------------------------------------------------------------
console.log('【ケース3: FROM句のインラインビュー（サブクエリ）】');
const sql3 = `
  SELECT u.username, sub.order_count
  FROM users u
  JOIN (
    SELECT o.user_id, COUNT(*) AS order_count
    FROM orders o
    GROUP BY o.user_id
  ) sub ON u.user_id = sub.user_id;
`;
const res3 = parseSqlQuery(sql3, { dialect: 'Generic', schemaData: mockSchemaData });
assert(!res3.error, '構文解析エラーなし');
const subNode = res3.tables.find(t => t.type === 'subquery');
assert(Boolean(subNode), 'サブクエリ仮想ノード (type: subquery) が抽出');
assert(subNode?.alias === 'sub', 'サブクエリエイリアス名が sub');
const virtualCol = subNode?.columns.find(c => c.name === 'order_count');
assert(Boolean(virtualCol), '内側SELECTから集計列 order_count が仮想カラムとしてバインド');
const pipeline = res3.joins.find(j => j.joinType === 'SUBQUERY_SOURCE');
assert(Boolean(pipeline), '元テーブル orders から sub へのデータ集約線が存在');
console.log('');

// -----------------------------------------------------------------
// ケース4: WITH句（CTE: 共通テーブル式）
// -----------------------------------------------------------------
console.log('【ケース4: WITH句（CTE: 共通テーブル式）】');
const sql4 = `
  WITH order_summary AS (
    SELECT o.user_id, SUM(o.amount) AS total_amount
    FROM orders o
    GROUP BY o.user_id
  )
  SELECT u.username, s.total_amount
  FROM users u
  JOIN order_summary s ON u.user_id = s.user_id;
`;
const res4 = parseSqlQuery(sql4, { dialect: 'Generic', schemaData: mockSchemaData });
assert(!res4.error, '構文解析エラーなし');
const cteNode = res4.tables.find(t => t.type === 'cte');
assert(Boolean(cteNode), 'CTE仮想ノード (type: cte) が抽出');
assert(cteNode?.name === 'order_summary', 'CTE名が order_summary');
const cteCol = cteNode?.columns.find(c => c.name === 'total_amount');
assert(Boolean(cteCol), 'CTE集計列 total_amount が仮想カラムとしてバインド');
const ctePipeline = res4.joins.find(j => j.joinType === 'CTE_SOURCE');
assert(Boolean(ctePipeline), '元テーブル orders から order_summary へのデータ集約線が存在');
console.log('');

// -----------------------------------------------------------------
// ケース5: 無修飾カラムのDBML自動逆引き解決
// -----------------------------------------------------------------
console.log('【ケース5: テーブル無修飾カラムのDBML自動逆引き】');
const sql5 = `
  SELECT username, department_name
  FROM users, departments
  WHERE users.department_id = departments.department_id;
`;
const res5 = parseSqlQuery(sql5, { dialect: 'Generic', schemaData: mockSchemaData });
assert(!res5.error, '構文解析エラーなし');
const userCol = res5.selectColumns.find(c => c.columnName === 'username');
const deptCol = res5.selectColumns.find(c => c.columnName === 'department_name');
assert(userCol?.tableAlias === 'users', `username の所属が users に解決 (取得: ${userCol?.tableAlias})`);
assert(deptCol?.tableAlias === 'departments', `department_name の所属が departments に解決 (取得: ${deptCol?.tableAlias})`);
console.log('');

console.log('====================================================');
console.log(` 検証完了: 成功 ${passCount} 件 / 失敗 ${failCount} 件`);
console.log('====================================================');

if (failCount > 0) {
  process.exit(1);
}
