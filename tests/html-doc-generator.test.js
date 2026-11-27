// 日本語コメント: HTML仕様書生成エンジン（標準版 / 検索強化グリッド版）の単体テスト
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateHtmlDoc, extractSchemaDocModel } from '../client/src/core/html-doc-generator.js';
import { generateHtmlGridDoc } from '../client/src/core/html-grid-doc-generator.js';

const sampleSchemaModel = {
  project: { name: 'OrderSystem', databaseType: 'PostgreSQL' },
  tables: [
    {
      name: 'users',
      logicalName: 'ユーザー',
      note: '会員マスタ</script><script>alert(1)</script>',
      fields: [
        { name: 'id', logicalName: 'ユーザーID', type: { type_name: 'bigint' }, pk: true, not_null: true },
        { name: 'email', logicalName: 'メールアドレス', type: { type_name: 'varchar(255)' }, unique: true, not_null: true, dbdefault: '' }
      ],
      indexes: [
        { name: 'idx_users_email', unique: true, columns: ['email'] }
      ],
      checks: [
        { name: 'chk_email_len', expression: 'length(email) > 3' }
      ]
    },
    {
      name: 'orders',
      logicalName: '注文',
      note: '注文トランザクション',
      fields: [
        { name: 'id', logicalName: '注文ID', type: { type_name: 'bigint' }, pk: true, not_null: true },
        { name: 'user_id', logicalName: 'ユーザーID', type: { type_name: 'bigint' }, not_null: true, dbdefault: 0 }
      ]
    }
  ],
  refs: [
    {
      endpoints: [
        { tableName: 'orders', fieldNames: ['user_id'] },
        { tableName: 'users', fieldNames: ['id'] }
      ]
    }
  ]
};

test('extractSchemaDocModel: テーブル・カラム・FK・インデックス・Check制約を正規化抽出する', () => {
  const model = extractSchemaDocModel(sampleSchemaModel, { schemaName: 'order_schema', dialectName: 'PostgreSQL' });
  assert.equal(model.projectName, 'OrderSystem');
  assert.equal(model.databaseType, 'PostgreSQL');
  assert.equal(model.totalTables, 2);
  assert.equal(model.totalColumns, 4);
  assert.equal(model.totalRefs, 1);

  const orders = model.tables.find(t => t.name === 'orders');
  const userIdCol = orders.fields.find(f => f.name === 'user_id');
  assert.equal(userIdCol.isFk, true);
  assert.equal(userIdCol.fkTargetTable, 'users');
  assert.equal(userIdCol.fkTargetField, 'id');
  assert.equal(userIdCol.defaultValue, '0');
});

test('generateHtmlDoc: 標準版（テーブルカード型）HTMLを生成しXSS文字をエスケープする', () => {
  const html = generateHtmlDoc(sampleSchemaModel, { schemaName: 'order_schema' });
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('OrderSystem データ仕様書'));
  assert.ok(html.includes('class="table-card"'));
  assert.ok(html.includes('idx_users_email'));
  assert.ok(html.includes('chk_email_len'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('generateHtmlGridDoc: 検索強化版（カラムグリッド型）HTMLを生成し安全にJSONデータを埋め込む', () => {
  const html = generateHtmlGridDoc(sampleSchemaModel, { schemaName: 'order_schema' });
  assert.ok(html.includes('<!DOCTYPE html>'));
  assert.ok(html.includes('検索強化グリッド版'));
  assert.ok(html.includes('id="columnGridTable"'));
  assert.ok(html.includes('class="grid-header-row"'));
  assert.ok(html.includes('class="grid-filter-row"'));
  assert.ok(html.includes('id="schemaDocData" type="application/json"'));
  // </script> インジェクションがエスケープされていること
  assert.ok(!html.includes('会員マスタ</script>'));
  assert.ok(html.includes('\\u003c/script\\u003e'));
});

test('generateHtmlDoc: 日英辞書と言語切替ボタンを埋め込み、lang="en" 指定時に英語見出しで初期出力する', () => {
  const html = generateHtmlDoc(sampleSchemaModel, { schemaName: 'order_schema', lang: 'en' });
  assert.ok(html.includes('id="btnToggleLang"'));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('Database Specification'));
  assert.ok(html.includes('OrderSystem Data Specification'));
  assert.ok(html.includes('Total Tables'));
  assert.ok(html.includes('"btnToggleLang":"🌐 日本語"'));
});

test('generateHtmlGridDoc: 日英辞書と言語切替ボタンを埋め込み、lang="en" 指定時に英語見出しで初期出力する', () => {
  const html = generateHtmlGridDoc(sampleSchemaModel, { schemaName: 'order_schema', lang: 'en' });
  assert.ok(html.includes('id="btnToggleLang"'));
  assert.ok(html.includes('<html lang="en">'));
  assert.ok(html.includes('Enhanced Search Grid'));
  assert.ok(html.includes('OrderSystem Data Specification'));
  assert.ok(html.includes('Table Physical Name'));
  assert.ok(html.includes('"gridEmptyMessage"'));
});
