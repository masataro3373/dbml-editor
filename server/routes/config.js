// 日本語コメント: 設定情報提供 API ルーター (server/routes/config.js)
// クライアントに対して、アプリケーション起動に必要な公開設定情報 (GET /api/config) を提供します。

import express from 'express';
import { configService } from '../services/config-service.js';
import { serverLogger } from '../logger.js';

const router = express.Router();

/**
 * GET /api/config
 * クライアント公開用設定の取得
 */
router.get('/', (req, res) => {
  try {
    const clientConfig = configService.getClientConfig();
    res.json({
      success: true,
      config: clientConfig,
    });
  } catch (err) {
    serverLogger.error('Config', '設定情報取得中にエラーが発生しました', err);
    res.status(500).json({
      success: false,
      errorKey: 'common.error_internal',
    });
  }
});

export default router;
