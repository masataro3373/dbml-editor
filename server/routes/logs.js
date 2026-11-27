// 日本語コメント: クライアントログ受信 API ルーター (server/routes/logs.js)
// クライアント側でバッチ送信された操作ログ・エラーログを受信し、
// client.log ファイルおよびコンソールに出力します。

import express from 'express';
import { clientLogger, serverLogger } from '../logger.js';

const router = express.Router();

const MAX_LOG_BATCH_SIZE = 100;
const MAX_LOG_MESSAGE_LENGTH = 10000;

/**
 * POST /api/logs
 * クライアントからのログエントリ配列を受信して保存（認証済みユーザーのみ許可）
 */
router.post('/', (req, res) => {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { logs } = req.body || {};
  const currentUserId = req.session.user.username || req.session.user.id;

  if (!logs || !Array.isArray(logs)) {
    return res.status(400).json({ error: 'logs array is required' });
  }
  if (logs.length > MAX_LOG_BATCH_SIZE) {
    return res.status(400).json({ error: `Too many log entries (max ${MAX_LOG_BATCH_SIZE})` });
  }

  try {
    for (const entry of logs) {
      if (!entry || typeof entry !== 'object') continue;
      const rawMessage = typeof entry.message === 'string' ? entry.message : String(entry.message ?? '');
      const safeMessage = rawMessage.length > MAX_LOG_MESSAGE_LENGTH
        ? `${rawMessage.slice(0, MAX_LOG_MESSAGE_LENGTH)}...(truncated)`
        : rawMessage;

      clientLogger.write({
        ...entry,
        message: safeMessage,
        user: currentUserId,
      });
    }
    res.json({ success: true, count: logs.length });
  } catch (err) {
    serverLogger.error('LogsRouter', 'クライアントログの保存処理で例外が発生しました', err);
    res.status(500).json({ error: 'failed to write client logs' });
  }
});

export default router;
