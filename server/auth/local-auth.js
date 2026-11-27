// 日本語コメント: ユーザー/パスワード認証プロバイダー (server/auth/local-auth.js)
// storage/conf/users.json を読み込み、開発時・社内利用時のアカウント認証を提供します。
// 初回起動時に users.json が存在しない場合は初期ユーザー (user1 / password) を自動生成します。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { BaseAuthProvider } from './auth-provider.js';
import { serverLogger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_ROOT = path.resolve(__dirname, '../../storage');
const CONF_DIR = path.join(STORAGE_ROOT, 'conf');
const USERS_FILE = path.join(CONF_DIR, 'users.json');

/**
 * ランダムな短いID (10文字) を生成
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

export class LocalAuthProvider extends BaseAuthProvider {
  constructor() {
    super();
    this.ensureInitialized();
  }

  get type() {
    return 'local';
  }

  /**
   * 初期ディレクトリおよび初期アカウントの準備
   */
  ensureInitialized() {
    if (!fs.existsSync(CONF_DIR)) {
      fs.mkdirSync(CONF_DIR, { recursive: true });
    }

    if (!fs.existsSync(USERS_FILE)) {
      const defaultUsers = {
        user1: {
          id: generateShortId(10),
          password: 'password',
          name: 'Default User',
          createdAt: new Date().toISOString(),
        },
      };
      fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
      serverLogger.info('Auth', `初期ユーザー設定ファイルを作成しました: ${USERS_FILE}`);
    }
  }

  /**
   * ユーザー一覧の読み込み
   */
  loadUsers() {
    try {
      this.ensureInitialized();
      const content = fs.readFileSync(USERS_FILE, 'utf8');
      return JSON.parse(content);
    } catch (err) {
      serverLogger.error('Auth', 'users.json の読み込みに失敗しました', err);
      return {};
    }
  }

  /**
   * 認証実行
   */
  async authenticate({ username, password }) {
    if (!username || !password) return null;

    const users = this.loadUsers();
    const user = users[username];

    if (!user || user.password !== password) {
      return null;
    }

    return {
      id: user.id,
      username: username,
      name: user.name || username,
    };
  }

  /**
   * IDによるユーザー情報取得
   */
  async getUserById(userId) {
    const users = this.loadUsers();
    for (const [uname, data] of Object.entries(users)) {
      if (data.id === userId) {
        return {
          id: data.id,
          username: uname,
          name: data.name || uname,
        };
      }
    }
    return null;
  }
}
