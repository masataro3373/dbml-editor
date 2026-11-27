// 日本語コメント: 標準 (ANSI SQL) マイグレーション SQL ジェネレーターの結合テスト (tests/standard-migration.test.js)

import test from 'node:test';
import assert from 'node:assert/strict';
import { ensureBrowserStubs } from './helpers/browser-stub.js';

ensureBrowserStubs();

const { diffSchemas } = await import('../client/src/core/schema-diff.js');
const { generateStandardMigrationSql } = await import('../client/src/core/migration-sql-generator.js');

test('diffSchemas -> generateStandardMigrationSql: CREATE / RECREATE_TABLE(6分割) / DROP を正しく生成する', () => {
  const oldAst = {
    tables: [
      {
        name: 'users',
        fields: [
          { name: 'id', type: 'INT', pk: true, not_null: true },
          { name: 'email', type: 'VARCHAR(100)', not_null: true },
        ],
        indexes: [],
      },
      {
        name: 'legacy_logs',
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
          { name: 'email', type: 'VARCHAR(200)', not_null: true },
          { name: 'role', type: 'VARCHAR(20)', not_null: true, dbdefault: 'USER' },
          { name: 'dept_id', type: 'INT', not_null: true },
        ],
        indexes: [],
      },
      {
        name: 'new_items',
        fields: [
          { name: 'id', type: 'INT', pk: true, not_null: true },
          { name: 'title', type: 'VARCHAR(100)', not_null: true, dbdefault: 'untitled' },
        ],
        indexes: [],
      },
    ],
    refs: [],
  };

  const diff = diffSchemas(oldAst, newAst);
  const scriptsByTable = generateStandardMigrationSql(diff, ['users', 'new_items', 'legacy_logs'], {
    targetDbms: 'standard',
    includeComment: true,
    commentSource: 'note',
  });

  // 1. CREATE 検証
  const createFiles = scriptsByTable.new_items;
  assert.ok(Array.isArray(createFiles) && createFiles.length > 0);
  assert.ok(createFiles[0].content.includes('CREATE TABLE "new_items"'));
  assert.ok(createFiles[0].content.includes("DEFAULT 'untitled'"));

  // 2. RECREATE_TABLE (6分割) 検証
  const recreateFiles = scriptsByTable.users;
  assert.ok(Array.isArray(recreateFiles) && recreateFiles.length === 6, `6分割が期待されますが ${recreateFiles?.length} 件でした`);
  const recreateTable = recreateFiles.find(f => f.filename.includes('03_recreate_table'));
  assert.ok(recreateTable, '03_recreate_table ファイルが存在しません');
  assert.ok(recreateTable.content.includes("DEFAULT 'USER'"), '03_recreate_table に追加カラムのデフォルト値 USER が含まれていません');
  const dataCopy = recreateFiles.find(f => f.filename.includes('04_data_copy'));
  assert.ok(dataCopy, '04_data_copy ファイルが存在しません');
  assert.ok(dataCopy.content.includes('INSERT INTO "users"'), '04_data_copy に INSERT INTO "users" が含まれていません');
  assert.ok(dataCopy.content.includes('"email"'), '04_data_copy に共通カラム email が含まれていません');

  // 3. DROP 検証
  const dropFiles = scriptsByTable.legacy_logs;
  assert.ok(Array.isArray(dropFiles) && dropFiles.length === 1);
  assert.ok(dropFiles[0].content.includes('DROP TABLE'));
});
