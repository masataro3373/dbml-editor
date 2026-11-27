// 日本語コメント: クライアント側認証マネージャー (src/core/auth.js)
// サーバーの認証 API (/api/auth) と通信し、セッション確認・ログイン・ログアウトおよび Store への反映を制御します。

import { appStore } from './store.js';
import { logger } from './logger.js';

export const authManager = {
  /**
   * 現在の認証設定 (local / oauth) を取得
   */
  async getAuthConfig() {
    try {
      const res = await fetch('/api/auth/config');
      return await res.json();
    } catch (err) {
      logger.error('Auth', '認証設定の取得に失敗しました', err);
      return { authMode: 'local' };
    }
  },

  /**
   * 現在のセッション確認
   */
  async checkSession() {
    try {
      const res = await fetch('/api/auth/session', { credentials: 'include' });
      const data = await res.json();
      if (data.authenticated && data.user) {
        appStore.setUser(data.user);
        logger.info('Auth', `セッションが復元されました: ${data.user.username}`);
        return data.user;
      } else {
        appStore.setUser(null);
        return null;
      }
    } catch (err) {
      logger.error('Auth', 'セッション確認に失敗しました', err);
      appStore.setUser(null);
      return null;
    }
  },

  /**
   * ユーザー名/パスワードによるログイン
   */
  async login(username, password) {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (res.ok && data.success && data.user) {
        appStore.setUser(data.user);
        logger.info('Auth', `ログインしました: ${data.user.username}`);
        return { success: true, user: data.user };
      } else {
        return { success: false, errorKey: data.errorKey || 'auth.error_invalid_credentials' };
      }
    } catch (err) {
      logger.error('Auth', 'ログインAPI呼び出しエラー', err);
      return { success: false, errorKey: 'auth.error_internal' };
    }
  },

  /**
   * ログアウト
   */
  async logout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      appStore.setUser(null);
      logger.info('Auth', 'ログアウトしました');
    } catch (err) {
      logger.error('Auth', 'ログアウトAPI呼び出しエラー', err);
      appStore.setUser(null);
    }
  },
};
