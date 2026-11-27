// 日本語コメント: ユーザーメンテナンス CLI スクリプト (server/scripts/manage-users.js)
// storage/conf/users.json (server/auth/local-auth.js と同一ファイル) に対して
// ユーザーの一覧表示・追加・パスワード変更・削除を安全に行います。
// Docker コンテナ内 (docker compose exec) でもホスト側でも直接実行可能です。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const CONF_DIR = path.join(STORAGE_ROOT, 'conf');
const USERS_FILE = path.join(CONF_DIR, 'users.json');
const USERS_DATA_DIR = path.join(STORAGE_ROOT, 'users');

/**
 * 日本語コメント: local-auth.js と同一仕様のランダムID (10文字) を生成
 */
function generateShortId(length = 10) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

/**
 * 日本語コメント: storage/conf/users.json の初期化および読み込み
 */
function loadUsers() {
  if (!fs.existsSync(CONF_DIR)) {
    fs.mkdirSync(CONF_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    return {};
  }
  const content = fs.readFileSync(USERS_FILE, 'utf8').trim();
  if (!content) {
    return {};
  }
  return JSON.parse(content);
}

/**
 * 日本語コメント: users.json の保存（整形済み JSON）
 */
function saveUsers(users) {
  if (!fs.existsSync(CONF_DIR)) {
    fs.mkdirSync(CONF_DIR, { recursive: true });
  }
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2) + '\n', 'utf8');
}

/**
 * 日本語コメント: ユーザー名バリデーション
 */
function validateUsername(username) {
  if (!username || typeof username !== 'string') {
    throw new Error('ユーザー名を指定してください。');
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(username)) {
    throw new Error('ユーザー名は半角英数字および記号 (._-) のみ使用できます。');
  }
}

function printHelp() {
  console.log(`
DBML Editor ユーザーメンテナンスツール
対象ファイル: ${USERS_FILE}

使い方:
  node server/scripts/manage-users.js <command> [options]
  (または npm run user:manage -- <command> [options])

コマンド一覧:
  list                                     登録済みユーザー一覧を表示します
  add <username> <password> [displayName]  新規ユーザーを追加します
  passwd <username> <newPassword>          指定ユーザーのパスワードを変更します
  delete <username> [--with-storage]       指定ユーザーを削除します
                                           (--with-storage 指定時はユーザーの保存データも削除)
  --help                                   このヘルプを表示します

実行例 (Docker 環境):
  docker compose exec dbml-editor node server/scripts/manage-users.js list
  docker compose exec dbml-editor node server/scripts/manage-users.js add tanaka Pass1234 "田中 太郎"
  docker compose exec dbml-editor node server/scripts/manage-users.js passwd tanaka NewPass5678
  docker compose exec dbml-editor node server/scripts/manage-users.js delete tanaka
`);
}

function cmdList() {
  const users = loadUsers();
  const entries = Object.entries(users);

  console.log(`\n対象ファイル: ${USERS_FILE}`);
  if (entries.length === 0) {
    console.log('登録されているユーザーはいません。\n');
    return;
  }

  console.log(`登録ユーザー数: ${entries.length} 件\n`);
  console.log('USERNAME         | ID         | NAME                 | CREATED AT');
  console.log('-----------------+------------+----------------------+-------------------------');
  for (const [username, data] of entries) {
    const u = username.padEnd(16, ' ');
    const id = String(data.id || '-').padEnd(10, ' ');
    const name = String(data.name || username).padEnd(20, ' ');
    const createdAt = data.createdAt || '-';
    console.log(`${u} | ${id} | ${name} | ${createdAt}`);
  }
  console.log('');
}

function cmdAdd(args) {
  const [username, password, displayName] = args;
  validateUsername(username);
  if (!password) {
    throw new Error('パスワードを指定してください。');
  }

  const users = loadUsers();
  if (users[username]) {
    throw new Error(`ユーザー '${username}' は既に存在します。`);
  }

  const newUser = {
    id: generateShortId(10),
    password,
    name: displayName || username,
    createdAt: new Date().toISOString(),
  };

  users[username] = newUser;
  saveUsers(users);
  console.log(`✅ ユーザー '${username}' (ID: ${newUser.id}, 表示名: ${newUser.name}) を追加しました。`);
}

function cmdPasswd(args) {
  const [username, newPassword] = args;
  validateUsername(username);
  if (!newPassword) {
    throw new Error('新しいパスワードを指定してください。');
  }

  const users = loadUsers();
  if (!users[username]) {
    throw new Error(`ユーザー '${username}' は存在しません。`);
  }

  users[username].password = newPassword;
  users[username].updatedAt = new Date().toISOString();
  saveUsers(users);
  console.log(`✅ ユーザー '${username}' のパスワードを更新しました。`);
}

function cmdDelete(args) {
  const withStorage = args.includes('--with-storage');
  const positional = args.filter((a) => !a.startsWith('--'));
  const [username] = positional;
  validateUsername(username);

  const users = loadUsers();
  const target = users[username];
  if (!target) {
    throw new Error(`ユーザー '${username}' は存在しません。`);
  }

  const userId = target.id;
  delete users[username];
  saveUsers(users);
  console.log(`✅ ユーザー '${username}' (ID: ${userId}) を users.json から削除しました。`);

  if (withStorage && userId) {
    const userStorageDir = path.join(USERS_DATA_DIR, userId);
    if (fs.existsSync(userStorageDir)) {
      fs.rmSync(userStorageDir, { recursive: true, force: true });
      console.log(`🗑️  ユーザーストレージ領域を削除しました: ${userStorageDir}`);
    }
  } else if (userId) {
    console.log(`ℹ️  ユーザーデータ (storage/users/${userId}) は保護のため残されています。完全に削除する場合は --with-storage を指定してください。`);
  }
}

try {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case 'list':
      cmdList();
      break;
    case 'add':
      cmdAdd(argv.slice(1));
      break;
    case 'passwd':
      cmdPasswd(argv.slice(1));
      break;
    case 'delete':
      cmdDelete(argv.slice(1));
      break;
    default:
      console.error(`❌ 不明なコマンドです: ${command}`);
      printHelp();
      process.exit(1);
  }
} catch (err) {
  console.error(`❌ エラー: ${err.message}`);
  process.exit(1);
}
