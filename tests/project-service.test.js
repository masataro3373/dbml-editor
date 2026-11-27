// 日本語コメント: プロジェクト保存・新規作成時の関連外ファイルクリーンアップ機能のユニットテスト

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ensureUserStorageDir } from '../server/services/storage-service.js';
import { createUserProject, saveUserProject } from '../server/services/project-service.js';

test('saveUserProject: プロジェクトに関連しないDBML・ERD JSON・不要ファイルを削除し、有効なファイルを保持する', (t) => {
  const testUserId = `__test_cleanup_save_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userDir = ensureUserStorageDir(testUserId);
  const schemasDir = path.join(userDir, 'schemas');
  const erdsDir = path.join(userDir, 'erds');
  fs.mkdirSync(schemasDir, { recursive: true });
  fs.mkdirSync(erdsDir, { recursive: true });

  t.after(() => {
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  // 事前に孤立ファイルや関連外ファイルを配置
  fs.writeFileSync(path.join(schemasDir, 'orphan_schema.dbml'), 'Table orphan {}', 'utf8');
  fs.writeFileSync(path.join(schemasDir, 'stale.bak'), 'backup', 'utf8');
  fs.writeFileSync(path.join(erdsDir, 'orphan_erd.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(erdsDir, 'notes.txt'), 'unused', 'utf8');
  fs.writeFileSync(path.join(userDir, 'stray.dbml'), 'Table stray {}', 'utf8');
  fs.writeFileSync(path.join(userDir, 'stray.json'), '{}', 'utf8');

  // プロジェクト保存実行（main.dbml と erd_1.json のみが有効）
  saveUserProject(testUserId, {
    project: {
      meta: { name: 'Test Project' },
      files: {
        schemas: [{ ShortID: 's1', filename: 'main', visible: true }],
        erds: [{ id: 'erd_1', filename: 'erd_1', name: 'Main ERD', visible: true }],
      },
    },
    schemas: {
      main: 'Table users { id int [pk] }',
    },
    erds: {
      erd_1: { info: { description: 'Main ERD' }, nodes: [], edges: [], memos: [], boxes: [] },
    },
  });

  assert.deepEqual(fs.readdirSync(schemasDir), ['main.dbml']);
  assert.deepEqual(fs.readdirSync(erdsDir), ['erd_1.json']);
  assert.equal(fs.existsSync(path.join(userDir, 'project.json')), true);
  assert.equal(fs.existsSync(path.join(userDir, 'stray.dbml')), false);
  assert.equal(fs.existsSync(path.join(userDir, 'stray.json')), false);
});

test('createUserProject: 新規プロジェクト作成時に既存のスキーマ・ERD・直下関連外ファイルをクリーンアップする', (t) => {
  const testUserId = `__test_cleanup_create_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const userDir = ensureUserStorageDir(testUserId);
  const schemasDir = path.join(userDir, 'schemas');
  const erdsDir = path.join(userDir, 'erds');
  fs.mkdirSync(schemasDir, { recursive: true });
  fs.mkdirSync(erdsDir, { recursive: true });

  t.after(() => {
    fs.rmSync(userDir, { recursive: true, force: true });
  });

  fs.writeFileSync(path.join(schemasDir, 'old_schema.dbml'), 'Table old {}', 'utf8');
  fs.writeFileSync(path.join(erdsDir, 'old_erd.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(userDir, 'stray.dbml'), 'Table stray {}', 'utf8');

  createUserProject(testUserId, 'tester', { name: 'Fresh Project' });

  assert.deepEqual(fs.readdirSync(schemasDir), []);
  assert.deepEqual(fs.readdirSync(erdsDir), []);
  assert.equal(fs.existsSync(path.join(userDir, 'project.json')), true);
  assert.equal(fs.existsSync(path.join(userDir, 'stray.dbml')), false);
});
