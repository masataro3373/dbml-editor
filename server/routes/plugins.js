// 日本語コメント: プラグイン配信用 Express API ルーター (server/routes/plugins.js)
// GET /api/plugins で導入済みプラグイン一覧を返却し、
// GET /api/plugins/:id/* でプラグイン内のスクリプトやスタイルシートを配信します。

import express from 'express';
import path from 'node:path';
import { pluginsService } from '../services/plugins-service.js';
import { serverLogger } from '../logger.js';

const router = express.Router();

/**
 * 拡張子に応じた適切な Content-Type を取得
 */
function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.woff2':
      return 'font/woff2';
    case '.woff':
      return 'font/woff';
    case '.ttf':
      return 'font/ttf';
    case '.md':
      return 'text/markdown; charset=utf-8';
    case '.html':
    case '.htm':
      return 'text/html; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

/**
 * GET /api/plugins
 * サーバーの plugins/ ディレクトリに存在するプラグイン一覧と多言語辞書データを取得
 */
router.get('/', (req, res) => {
  try {
    const plugins = pluginsService.scanPlugins();
    res.json({
      success: true,
      plugins,
    });
  } catch (err) {
    serverLogger.error('PluginsRouter', `プラグイン一覧取得エラー: ${err.message}`);
    res.status(500).json({
      success: false,
      error: `プラグイン一覧の取得に失敗しました: ${err.message}`,
    });
  }
});

/**
 * GET /api/plugins/:id/*assetPath
 * プラグイン内の個別アセット (JS / CSS / JSON / 画像等) を配信 (Express 5 準拠)
 */
router.get('/:id/*assetPath', (req, res) => {
  try {
    const { id } = req.params;
    const rawAssetPath = req.params.assetPath;

    if (!rawAssetPath || (Array.isArray(rawAssetPath) && rawAssetPath.length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'アセットパスが指定されていません',
      });
    }

    // 日本語コメント: Express 5 (path-to-regexp v8) ではワイルドカードパラメータが配列になる場合があるため各セグメントを安全にデコードして結合
    const joinedPath = Array.isArray(rawAssetPath)
      ? rawAssetPath.map((seg) => decodeURIComponent(seg)).join('/')
      : decodeURIComponent(rawAssetPath);

    const asset = pluginsService.getPluginAsset(id, joinedPath);
    if (!asset) {
      return res.status(404).json({
        success: false,
        error: `プラグインアセットが見つかりません: ${id}/${joinedPath}`,
      });
    }

    const contentType = getContentType(asset.fileName);
    res.setHeader('Content-Type', contentType);

    // キャッシュ制御: クエリパラメータに ?v= があればキャッシュを許可
    if (req.query.v) {
      res.setHeader('Cache-Control', 'public, max-age=86400'); // 1日
    } else {
      res.setHeader('Cache-Control', 'no-cache');
    }

    res.send(asset.buffer);
  } catch (err) {
    serverLogger.error('PluginsRouter', `アセット配信エラー: ${req.originalUrl} - ${err.message}`);
    res.status(500).json({
      success: false,
      error: `アセット配信に失敗しました: ${err.message}`,
    });
  }
});

export default router;

