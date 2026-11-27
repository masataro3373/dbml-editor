// 日本語コメント: 認証 API ルーター (server/routes/auth.js)
// ログイン、セッション確認、ログアウト、および現在の認証方式 (local / oauth) を提供します。

import express from 'express';
import { LocalAuthProvider } from '../auth/local-auth.js';
import { OAuthAuthProvider } from '../auth/oauth-auth.js';
import { ensureUserStorageDir } from '../services/storage-service.js';
import { serverLogger } from '../logger.js';
import { configService } from '../services/config-service.js';

const router = express.Router();

// 設定ファイルおよび環境設定に応じた認証プロバイダーの解決 (デフォルト: local)
const authMode = configService.getServerConfig().authMode || 'local';
const authProvider = authMode === 'oauth'
  ? new OAuthAuthProvider()
  : new LocalAuthProvider();

/**
 * GET /api/auth/config
 * 現在のサーバー認証設定 (モード) を取得
 */
router.get('/config', (req, res) => {
  res.json({
    authMode: authProvider.type,
  });
});

/**
 * POST /api/auth/login
 * アカウント認証
 */
router.post('/login', async (req, res) => {
  const credentials = req.body || {};

  try {
    const user = await authProvider.authenticate(credentials);
    if (!user) {
      serverLogger.warn('Auth', `認証失敗: username=${credentials.username}`);
      return res.status(401).json({
        success: false,
        errorKey: 'auth.error_invalid_credentials',
      });
    }

    // セッションに保持
    req.session.user = {
      id: user.id,
      username: user.username,
      name: user.name,
    };

    // ユーザー別ストレージ領域の存在を保証
    ensureUserStorageDir(user.id);

    serverLogger.info('Auth', `ユーザーログイン成功: ${user.username} (${user.id})`);

    res.json({
      success: true,
      user: req.session.user,
    });
  } catch (err) {
    serverLogger.error('Auth', 'ログイン処理で例外が発生しました', err);
    res.status(500).json({ success: false, errorKey: 'auth.error_internal' });
  }
});

/**
 * GET /api/auth/session
 * セッション状態の確認
 */
router.get('/session', (req, res) => {
  if (req.session && req.session.user) {
    res.json({
      authenticated: true,
      user: req.session.user,
    });
  } else {
    res.json({
      authenticated: false,
    });
  }
});

/**
 * POST /api/auth/logout
 * ログアウト処理
 */
router.post('/logout', (req, res) => {
  const username = req.session?.user?.username;
  if (req.session) {
    req.session.destroy(err => {
      if (err) {
        serverLogger.error('Auth', 'ログアウト処理失敗', err);
        return res.status(500).json({ success: false });
      }
      res.clearCookie('connect.sid');
      if (username) {
        serverLogger.info('Auth', `ログアウトしました: ${username}`);
      }
      res.json({ success: true });
    });
  } else {
    res.json({ success: true });
  }
});

export default router;
