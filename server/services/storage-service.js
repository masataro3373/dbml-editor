// 日本語コメント: ユーザー別ストレージ管理サービス (server/services/storage-service.js)
// ログイン中の各ユーザーごとに storage/users/<userId>/ 配下のディレクトリを隔離管理し、
// マルチユーザー環境におけるプロジェクトデータの独立性を担保します。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { serverLogger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const USERS_DIR = path.join(STORAGE_ROOT, 'users');

/**
 * ユーザー専用のストレージディレクトリパスを取得 (存在しなければ作成)
 * @param {string} userId - ユーザーID
 * @returns {string} ディレクトリの絶対パス
 */
export function ensureUserStorageDir(userId) {
  if (!userId || typeof userId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
    throw new Error('Invalid userId to resolve storage directory');
  }

  const resolvedUsersDir = path.resolve(USERS_DIR);
  const userDir = path.resolve(resolvedUsersDir, userId);
  if (!userDir.startsWith(resolvedUsersDir + path.sep)) {
    throw new Error('Invalid storage directory path');
  }
  const schemasDir = path.join(userDir, 'schemas');

  if (!fs.existsSync(schemasDir)) {
    fs.mkdirSync(schemasDir, { recursive: true });
    serverLogger.info('Storage', `ユーザー専用ストレージを初期化しました: ${userId}`);
  }

  return userDir;
}

/**
 * ユーザーの全スキーマファイル名一覧を取得
 * @param {string} userId - ユーザーID
 * @returns {string[]} スキーマファイル名の配列 (例: ['main.dbml'])
 */
export function listUserSchemas(userId) {
  const userDir = ensureUserStorageDir(userId);
  const schemasDir = path.join(userDir, 'schemas');

  try {
    const files = fs.readdirSync(schemasDir);
    return files.filter(f => f.endsWith('.dbml'));
  } catch (err) {
    serverLogger.error('Storage', `スキーマ一覧の読み込み失敗 (${userId})`, err);
    return [];
  }
}
