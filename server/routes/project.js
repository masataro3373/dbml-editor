// 日本語コメント: プロジェクトファイル API ルーター (server/routes/project.js)
// ログイン中ユーザーの project.json (マニフェスト) および複数スキーマ DBML ファイル群の
// 読み込み (GET /api/project/load)、保存 (POST /api/project/save)、新規作成 (POST /api/project/schema) を提供します。

import express from 'express';
import {
  loadUserProject,
  saveUserProject,
  createUserProject,
  createSchema,
  deleteSchema,
  createErd,
  deleteErd,
} from '../services/project-service.js';
import { serverLogger } from '../logger.js';

const router = express.Router();

/**
 * 認証必須ミドルウェア
 */
function requireAuth(req, res, next) {
  if (!req.session?.user?.id) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

router.use(requireAuth);

/**
 * GET /api/project/load および GET /api/project
 * ログインユーザーの project.json および全スキーマ DBML テキストをロード
 * プロジェクト未作成の場合は { success: true, empty: true } を返却
 */
const handleLoadProject = (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || 'user';
  try {
    const data = loadUserProject(userId, username);
    res.json({ success: true, ...data });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'プロジェクトロード失敗', err);
    res.status(500).json({ error: 'Failed to load project files' });
  }
};

router.get('/load', handleLoadProject);
router.get('/', handleLoadProject);

/**
 * POST /api/project/create および POST /api/project
 * 新規プロジェクトを作成 (初期状態: スキーマ0個)
 */
const handleCreateProject = (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || 'user';
  const { name, description } = req.body || {};

  try {
    const project = createUserProject(userId, username, { name, description });
    serverLogger.info('ProjectRoute', `新規プロジェクト作成: ${username} (${project.name || 'unnamed'})`);
    res.json({ success: true, project, schemas: {} });
  } catch (err) {
    serverLogger.error('ProjectRoute', '新規プロジェクト作成失敗', err);
    res.status(500).json({ error: 'Failed to create project' });
  }
};

router.post('/create', handleCreateProject);
router.post('/', handleCreateProject);

/**
 * POST /api/project/save
 * ログインユーザーの project.json および全スキーマ DBML テキストを一括保存
 */
router.post('/save', (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || userId;
  const { project, schemas, erds } = req.body || {};

  try {
    saveUserProject(userId, { project, schemas, erds });
    serverLogger.info('ProjectRoute', `プロジェクト保存: ${username}`, {
      schemasCount: schemas ? Object.keys(schemas).length : 0,
    });
    res.json({ success: true });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'プロジェクト保存失敗', err);
    res.status(500).json({ error: 'Failed to save project files' });
  }
});

/**
 * POST /api/project/schema
 * 新規スキーマファイルの作成と project.json への登録
 */
router.post('/schema', (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || userId;
  const { filename, title, databaseType } = req.body || {};

  try {
    const result = createSchema(userId, { filename, title, databaseType });
    serverLogger.info('ProjectRoute', `スキーマ作成: ${username} -> ${filename}`);
    res.json({ success: true, ...result });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'スキーマ作成失敗', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/project/schema/:filename
 * スキーマファイルの削除と project.json からのエントリ削除
 */
router.delete('/schema/:filename', (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || userId;
  const { filename } = req.params;

  try {
    const result = deleteSchema(userId, filename);
    serverLogger.info('ProjectRoute', `スキーマ削除: ${username} -> ${filename}`);
    res.json({ success: true, ...result });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'スキーマ削除失敗', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/project/erd
 * 新規ERDの作成と project.json への登録
 */
router.post('/erd', (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || userId;
  const { name, description } = req.body || {};

  try {
    const result = createErd(userId, { name, description });
    serverLogger.info('ProjectRoute', `ER図作成: ${username} -> ${name || result?.erd?.id || 'erd'}`);
    res.json({ success: true, ...result });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'ER図作成失敗', err);
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/project/erd/:id
 * ERDファイルの削除と project.json からのエントリ削除
 */
router.delete('/erd/:id', (req, res) => {
  const userId = req.session.user.id;
  const username = req.session.user.username || userId;
  const { id } = req.params;

  try {
    const result = deleteErd(userId, id);
    serverLogger.info('ProjectRoute', `ER図削除: ${username} -> ${id}`);
    res.json({ success: true, ...result });
  } catch (err) {
    serverLogger.error('ProjectRoute', 'ER図削除失敗', err);
    res.status(400).json({ error: err.message });
  }
});

export default router;
