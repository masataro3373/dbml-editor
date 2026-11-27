// 日本語コメント: schema-diff.js の単体テスト (tests/schema-diff.test.js)

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBrowserStubs } from './helpers/browser-stub.js';

ensureBrowserStubs();

const { cleanName, splitByCommaOutsideQuotes, diffSchemas } = await import('../client/src/core/schema-diff.js');

test('cleanName: ダブルクォート除去と小文字正規化', () => {
  assert.equal(cleanName('"Users"'), 'users');
  assert.equal(cleanName('  "Order_Items"  '), 'order_items');
  assert.equal(cleanName({ name: '"Accounts"' }), 'accounts');
  assert.equal(cleanName(null), '');
});

test('splitByCommaOutsideQuotes: クォート内のカンマを保護して分割する', () => {
  const result = splitByCommaOutsideQuotes("col1, note: '住所（東京, 大阪）', \"col,2\"");
  assert.equal(result.length, 3);
  assert.equal(result[0].trim(), 'col1');
  assert.equal(result[1].trim(), "note: '住所（東京, 大阪）'");
  assert.equal(result[2].trim(), '"col,2"');
});

test('diffSchemas: テーブルの CREATE / RECREATE_TABLE / DROP / UNCHANGED を正確に判定する', () => {
  const oldAst = {
    tables: [
      {
        name: 'users',
        fields: [
          { name: 'id', type: 'INT', pk: true, not_null: true },
          { name: 'name', type: 'VARCHAR(100)', not_null: true },
        ],
        indexes: [],
      },
      {
        name: 'unchanged_tbl',
        fields: [{ name: 'id', type: 'INT', pk: true }],
        indexes: [],
      },
      {
        name: 'old_only',
        fields: [{ name: 'id', type: 'INT', pk: true }],
        indexes: [],
      },
    ],
    refs: [],
  };

  const newAst = {
    tables: [
      {
        name: 'users',
        fields: [
          { name: 'id', type: 'INT', pk: true, not_null: true },
          { name: 'name', type: 'VARCHAR(100)', not_null: true },
          { name: 'status', type: 'VARCHAR(20)', not_null: true, dbdefault: 'ACTIVE' },
        ],
        indexes: [],
      },
      {
        name: 'unchanged_tbl',
        fields: [{ name: 'id', type: 'INT', pk: true }],
        indexes: [],
      },
      {
        name: 'new_only',
        fields: [{ name: 'id', type: 'INT', pk: true }],
        indexes: [],
      },
    ],
    refs: [],
  };

  const diff = diffSchemas(oldAst, newAst);
  assert.ok(Array.isArray(diff.tables));

  const usersDiff = diff.tables.find(t => t.name === 'users');
  const unchangedDiff = diff.tables.find(t => t.name === 'unchanged_tbl');
  const newOnlyDiff = diff.tables.find(t => t.name === 'new_only');
  const oldOnlyDiff = diff.tables.find(t => t.name === 'old_only');

  assert.equal(usersDiff.status, 'MODIFY');
  assert.equal(usersDiff.migrationMode, 'RECREATE_TABLE');
  assert.equal(unchangedDiff.status, 'UNCHANGED');
  assert.equal(newOnlyDiff.migrationMode, 'ADD');
  assert.equal(oldOnlyDiff.migrationMode, 'DROP');
});
