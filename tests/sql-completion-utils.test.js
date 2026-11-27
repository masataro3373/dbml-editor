// 日本語コメント: SQL ビジュアライザ オートコンプリート解析ユーティリティの単体テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractSqlAliases, resolveDotCompletionItems } from '../client/src/core/sql-completion-utils.js';

const mockSchemasMap = new Map([
  ['public', {
    model: {
      tables: [
        {
          name: 'users',
          logicalName: 'ユーザー',
          fields: [
            { name: 'id', logicalName: 'ID', type: { type_name: 'bigint' }, pk: true },
            { name: 'email', logicalName: 'メール', type: { type_name: 'varchar(255)' }, note: 'ログイン用' }
          ]
        },
        {
          name: 'orders',
          logicalName: '注文',
          fields: [
            { name: 'order_id', logicalName: '注文ID', type: { type_name: 'bigint' }, pk: true },
            { name: 'user_id', logicalName: 'ユーザーID', type: { type_name: 'bigint' } }
          ]
        }
      ]
    }
  }]
]);

test('extractSqlAliases: FROM / JOIN / カンマ結合のエイリアスを抽出し予約語を除外する', () => {
  const sql = `
    SELECT u.id, o.order_id
    FROM public.users u
    INNER JOIN orders AS o ON o.user_id = u.id
    WHERE u.id > 0
  `;
  const aliases = extractSqlAliases(sql);
  assert.deepEqual(aliases.get('u'), { schema: 'public', tableName: 'users' });
  assert.deepEqual(aliases.get('o'), { schema: '', tableName: 'orders' });

  const commaSql = 'SELECT a.id FROM users a, orders b WHERE a.id = b.user_id';
  const commaAliases = extractSqlAliases(commaSql);
  assert.deepEqual(commaAliases.get('a'), { schema: '', tableName: 'users' });
  assert.deepEqual(commaAliases.get('b'), { schema: '', tableName: 'orders' });
  assert.equal(commaAliases.has('where'), false);
});

test('resolveDotCompletionItems: テーブル名・エイリアス名・スキーマ名から候補を解決する', () => {
  const aliases = extractSqlAliases('SELECT * FROM users u');

  // 1. エイリアス u.
  const aliasItems = resolveDotCompletionItems({
    prefix: 'u',
    schemasMap: mockSchemasMap,
    defaultSchema: 'public',
    aliases
  });
  assert.equal(aliasItems.length, 2);
  assert.equal(aliasItems[0].label, 'id');
  assert.ok(aliasItems[0].detail.includes('PK'));
  assert.equal(aliasItems[1].label, 'email');
  assert.equal(aliasItems[1].info, 'ログイン用');

  // 2. テーブル名直指定 orders.
  const tableItems = resolveDotCompletionItems({
    prefix: 'orders',
    schemasMap: mockSchemasMap,
    defaultSchema: 'public',
    aliases
  });
  assert.equal(tableItems.length, 2);
  assert.equal(tableItems[0].label, 'order_id');

  // 3. スキーマ名指定 public.
  const schemaItems = resolveDotCompletionItems({
    prefix: 'public',
    schemasMap: mockSchemasMap,
    defaultSchema: 'public',
    aliases
  });
  assert.equal(schemaItems.length, 2);
  assert.equal(schemaItems[0].label, 'users');
  assert.equal(schemaItems[0].type, 'class');
});
