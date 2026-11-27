// 日本語コメント: プロジェクト管理・ファイル永続化サービス (server/services/project-service.js)
// ログイン中ユーザーの storage/users/<userId>/ 配下の project.json (DBMS非依存マニフェスト)
// および schemas/*.dbml (1ファイル1スキーマ) の生成・読み込み・保存・追加・削除を統括します。
// 特定のスキーマ名 (main 等) のハードコードは排除し、すべて対等なスキーマとして管理します。

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ensureUserStorageDir } from './storage-service.js';
import { serverLogger } from '../logger.js';
import { generateShortId, isValidShortId } from './id-generator.js';

/**
 * 日本語コメント: パストラバーサル防止用の安全パス解決ヘルパー
 * ファイル名ベース部分にディレクトリ区切りや相対パス指定が含まれないことを検証し、
 * 解決後の絶対パスが必ず baseDir 配下であることを保証します。
 */
function resolveSafeChildPath(baseDir, rawName, ext = '') {
  if (!rawName || typeof rawName !== 'string') {
    throw new Error('Invalid file identifier');
  }
  const trimmed = rawName.trim();
  if (
    !trimmed
    || trimmed === '.'
    || trimmed === '..'
    || trimmed.includes('/')
    || trimmed.includes('\\')
    || trimmed.includes('\0')
    || path.basename(trimmed) !== trimmed
  ) {
    throw new Error(`Unsafe file path detected: ${rawName}`);
  }

  const resolvedBase = path.resolve(baseDir);
  const targetPath = path.resolve(resolvedBase, `${trimmed}${ext}`);
  if (!targetPath.startsWith(resolvedBase + path.sep)) {
    throw new Error(`Path traversal detected: ${rawName}`);
  }
  return targetPath;
}

/**
 * ユーザーのプロジェクト存在確認
 * @param {string} userId - ユーザーID
 * @returns {boolean} project.json が存在するかどうか
 */
export function hasUserProject(userId) {
  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  return fs.existsSync(projectJsonPath);
}

/**
 * 日本語コメント: 指定ディレクトリ内の有効ファイル名集合に含まれない不要ファイル・サブディレクトリを削除する
 * Windows (NTFS) 環境では大文字・小文字を区別せず照合する
 * @param {string} dirPath - 対象ディレクトリパス
 * @param {Set<string>} validNames - 保持すべきファイル名 (basename) の集合
 * @param {string} label - ログ出力用ラベル
 * @param {string} userId - ユーザーID
 */
function cleanupStaleEntries(dirPath, validNames, label, userId) {
  if (!fs.existsSync(dirPath)) return;
  const isWin = process.platform === 'win32';
  const normalizedValid = new Set(
    Array.from(validNames).map(name => (isWin ? name.toLowerCase() : name))
  );

  for (const entry of fs.readdirSync(dirPath)) {
    const safeName = path.basename(entry);
    const key = isWin ? safeName.toLowerCase() : safeName;
    if (normalizedValid.has(key)) continue;

    const targetPath = path.join(dirPath, safeName);
    try {
      fs.rmSync(targetPath, { recursive: true, force: true });
      serverLogger.info('Project', `関連外の${label}ファイルを削除しました: ${safeName} (${userId})`);
    } catch (err) {
      serverLogger.warn('Project', `関連外の${label}ファイル削除失敗: ${safeName}`, err);
    }
  }
}

/**
 * 日本語コメント: ユーザーディレクトリ直下に誤って残った project.json 以外の .dbml / .json を削除する
 * @param {string} userDir - ユーザーストレージディレクトリパス
 * @param {string} userId - ユーザーID
 */
function cleanupStrayUserRootFiles(userDir, userId) {
  if (!fs.existsSync(userDir)) return;
  const isWin = process.platform === 'win32';
  for (const entry of fs.readdirSync(userDir)) {
    const safeName = path.basename(entry);
    const lower = safeName.toLowerCase();
    const isProjectJson = isWin ? lower === 'project.json' : safeName === 'project.json';
    if (!isProjectJson && (lower.endsWith('.dbml') || lower.endsWith('.json'))) {
      try {
        fs.rmSync(path.join(userDir, safeName), { recursive: true, force: true });
        serverLogger.info('Project', `ユーザー直下の関連外ファイルを削除しました: ${safeName} (${userId})`);
      } catch (err) {
        serverLogger.warn('Project', `ユーザー直下ファイル削除失敗: ${safeName}`, err);
      }
    }
  }
}

/**
 * 新規プロジェクトを作成 (初期状態: スキーマ0個、ERD0個)
 * @param {string} userId - ユーザーID
 * @param {string} username - ユーザー名
 * @param {Object} options - { name?: string, description?: string }
 * @returns {Object} 作成された project.json データ
 */
export function createUserProject(userId, username = 'user', { name = '', description = '' } = {}) {
  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const schemasDir = path.join(userDir, 'schemas');

  // schemas および erds ディレクトリの保証
  if (!fs.existsSync(schemasDir)) {
    fs.mkdirSync(schemasDir, { recursive: true });
  }
  const erdsDir = path.join(userDir, 'erds');
  if (!fs.existsSync(erdsDir)) {
    fs.mkdirSync(erdsDir, { recursive: true });
  }

  const projectData = {
    meta: {
      id: generateShortId(10),
      createdAt: new Date().toISOString(),
      createdBy: username,
      updatedAt: new Date().toISOString(),
      updatedBy: username,
      jsonFormatVersion: '2.0.0',
    },
    info: {
      name: name || '新規データベース設計プロジェクト',
      description: description || '初期作成されたDBML設計プロジェクト',
      version: '1.0.0',
    },
    files: {
      schemas: [], // 新規作成時はスキーマ0個
      erds: [],    // 新規作成時はERD0個
    },
  };

  fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2), 'utf8');

  // 日本語コメント: 新規作成時は既存の関連外スキーマ・ERD・直下ファイルをすべてクリーンアップ
  cleanupStaleEntries(schemasDir, new Set(), 'スキーマ', userId);
  cleanupStaleEntries(erdsDir, new Set(), 'ERD', userId);
  cleanupStrayUserRootFiles(userDir, userId);

  serverLogger.info('Project', `新規プロジェクトを作成しました (${userId}: ${projectData.info.name})`);

  return projectData;
}

/**
 * ユーザーのプロジェクト全体 (project.json と全スキーマの DBML テキスト、全ERDデータ) を読み込む
 * 初回ログイン時などプロジェクト未作成の場合は { empty: true } を返却
 * @param {string} userId - ユーザーID
 * @param {string} username - ユーザー名
 * @returns {Object} { empty: boolean, project?: Object, schemas?: { [filename: string]: string }, erds?: { [id: string]: Object } }
 */
export function loadUserProject(userId, username = 'user') {
  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const schemasDir = path.join(userDir, 'schemas');
  const erdsDir = path.join(userDir, 'erds');

  // project.json が存在しない場合は未作成 (empty: true) を返却
  if (!fs.existsSync(projectJsonPath)) {
    serverLogger.info('Project', `プロジェクトが存在しません (初回未作成状態: ${userId})`);
    return { empty: true, project: null, schemas: {}, erds: {} };
  }

  // schemas および erds ディレクトリの保証
  if (!fs.existsSync(schemasDir)) {
    fs.mkdirSync(schemasDir, { recursive: true });
  }
  if (!fs.existsSync(erdsDir)) {
    fs.mkdirSync(erdsDir, { recursive: true });
  }

  try {
    const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
    const schemas = {};
    const erds = {};

    // project.json に登録されているスキーマファイルを読み込み
    const schemaEntries = project.files?.schemas || [];
    for (const entry of schemaEntries) {
      const filename = entry.filename;
      const filePath = resolveSafeChildPath(schemasDir, filename, '.dbml');
      if (fs.existsSync(filePath)) {
        schemas[filename] = fs.readFileSync(filePath, 'utf8');
      } else {
        // ファイルが存在しない場合は空作成
        schemas[filename] = `Project ${filename} {\n  database_type: 'standard'\n}\n`;
        fs.writeFileSync(filePath, schemas[filename], 'utf8');
      }
    }

    // project.json に登録されている ERD ファイルを読み込み
    const erdEntries = project.files?.erds || [];
    for (const entry of erdEntries) {
      const erdId = entry.id || entry.filename;
      const filePath = resolveSafeChildPath(erdsDir, entry.filename || erdId, '.json');
      if (fs.existsSync(filePath)) {
        try {
          erds[erdId] = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (e) {
          serverLogger.error('Project', `ERDファイル解析失敗: ${filePath}`, e);
        }
      }
    }

    serverLogger.info('Project', `プロジェクトをロードしました (${userId}: スキーマ数 ${Object.keys(schemas).length}, ERD数 ${Object.keys(erds).length})`);
    return { empty: false, project, schemas, erds };
  } catch (err) {
    serverLogger.error('Project', `プロジェクト読み込み失敗 (${userId})`, err);
    throw err;
  }
}

/**
 * ユーザーのプロジェクト (project.json と全スキーマの DBML テキスト、全ERDデータ) を一括保存する
 * @param {string} userId - ユーザーID
 * @param {Object} data - { project?: Object, schemas?: { [filename: string]: string }, erds?: { [id: string]: Object } }
 */
export function saveUserProject(userId, data) {
  const { project, schemas, erds } = data || {};
  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const schemasDir = path.join(userDir, 'schemas');
  const erdsDir = path.join(userDir, 'erds');

  try {
    // 1. project.json の更新保存 (マニフェスト内のファイル識別子も安全性を事前検証)
    if (project && typeof project === 'object') {
      if (Array.isArray(project.files?.schemas)) {
        for (const s of project.files.schemas) {
          resolveSafeChildPath(schemasDir, s?.filename, '.dbml');
        }
      }
      if (Array.isArray(project.files?.erds)) {
        for (const e of project.files.erds) {
          resolveSafeChildPath(erdsDir, e?.filename || e?.id, '.json');
        }
      }
      project.meta = {
        ...(project.meta || {}),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf8');
    }

    // 日本語コメント: クリーンアップ基準となるマニフェスト情報を確定（未指定時は保存済み project.json を参照）
    let manifestProject = (project && typeof project === 'object') ? project : null;
    if (!manifestProject && fs.existsSync(projectJsonPath)) {
      try {
        manifestProject = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      } catch {
        manifestProject = null;
      }
    }

    // 2. 各スキーマ DBML ファイルの書き込み
    if (schemas && typeof schemas === 'object') {
      if (!fs.existsSync(schemasDir)) {
        fs.mkdirSync(schemasDir, { recursive: true });
      }
      for (const [filename, content] of Object.entries(schemas)) {
        const filePath = resolveSafeChildPath(schemasDir, filename, '.dbml');
        fs.writeFileSync(filePath, typeof content === 'string' ? content : '', 'utf8');
      }
    }

    // 日本語コメント: スキーマ一覧（project.files.schemas / schemas）に存在しない関連外ファイルを削除
    if (Array.isArray(manifestProject?.files?.schemas) || (schemas && typeof schemas === 'object')) {
      const validSchemaFiles = new Set([
        ...(Array.isArray(manifestProject?.files?.schemas)
          ? manifestProject.files.schemas.filter(s => s?.filename).map(s => `${path.basename(s.filename)}.dbml`)
          : []),
        ...(schemas && typeof schemas === 'object'
          ? Object.keys(schemas).map(k => `${path.basename(k)}.dbml`)
          : []),
      ]);
      cleanupStaleEntries(schemasDir, validSchemaFiles, 'スキーマ', userId);
    }

    // 3. 各 ERD JSON ファイルの書き込み
    if (erds && typeof erds === 'object') {
      if (!fs.existsSync(erdsDir)) {
        fs.mkdirSync(erdsDir, { recursive: true });
      }
      for (const [erdId, content] of Object.entries(erds)) {
        const filePath = resolveSafeChildPath(erdsDir, erdId, '.json');
        fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf8');
      }
    }

    // 日本語コメント: ERD一覧（project.files.erds / erds）に存在しない関連外ファイルを削除
    if (Array.isArray(manifestProject?.files?.erds) || (erds && typeof erds === 'object')) {
      const validErdFiles = new Set([
        ...(Array.isArray(manifestProject?.files?.erds)
          ? manifestProject.files.erds.flatMap(e => {
              const names = [];
              if (e?.filename) names.push(`${path.basename(e.filename)}.json`);
              if (e?.id) names.push(`${path.basename(e.id)}.json`);
              return names;
            })
          : []),
        ...(erds && typeof erds === 'object'
          ? Object.keys(erds).map(k => `${path.basename(k)}.json`)
          : []),
      ]);
      cleanupStaleEntries(erdsDir, validErdFiles, 'ERD', userId);
    }

    cleanupStrayUserRootFiles(userDir, userId);

    serverLogger.info('Project', `プロジェクトを保存しました (${userId})`);
    return { success: true };
  } catch (err) {
    serverLogger.error('Project', `プロジェクト保存失敗 (${userId})`, err);
    throw err;
  }
}

/**
 * 新規スキーマを作成してプロジェクトに登録
 * @param {string} userId - ユーザーID
 * @param {Object} params - { filename: string, title?: string, databaseType?: string }
 */
export function createSchema(userId, { filename, title = '', databaseType = 'standard' }) {
  if (!filename || typeof filename !== 'string') {
    throw new Error('有効なスキーマファイル名 (filename) が必要です');
  }

  // ファイル名サニタイズ (英数字・アンダースコア・ハイフンのみ)
  const cleanFilename = filename.trim().replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const schemasDir = path.join(userDir, 'schemas');
  const filePath = path.join(schemasDir, `${cleanFilename}.dbml`);

  if (fs.existsSync(filePath)) {
    throw new Error(`同名のスキーマファイルが既に存在します: ${cleanFilename}`);
  }

  // 初期DBMLテキスト (Project ブロックに方言を指定)
  const initialDbml = `Project ${cleanFilename} {\n  database_type: '${databaseType}'\n  Note: '${title || cleanFilename}'\n}\n`;
  fs.writeFileSync(filePath, initialDbml, 'utf8');

  // project.json へのエントリ追加
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const newSchemaEntry = {
    // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
    ShortID: generateShortId(10),
    filename: cleanFilename,
    visible: true,
  };

  project.files = project.files || {};
  project.files.schemas = project.files.schemas || [];
  project.files.schemas.push(newSchemaEntry);
  project.meta.updatedAt = new Date().toISOString();

  fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf8');
  serverLogger.info('Project', `新規スキーマを作成しました (${userId}: ${cleanFilename})`);

  return {
    schemaEntry: newSchemaEntry,
    content: initialDbml,
    project,
  };
}

/**
 * スキーマを削除
 * @param {string} userId - ユーザーID
 * @param {string} filename - スキーマファイル名
 */
export function deleteSchema(userId, filename) {
  if (!filename) {
    throw new Error('削除対象のスキーマファイル名が指定されていません');
  }

  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const schemasDir = path.join(userDir, 'schemas');
  const filePath = resolveSafeChildPath(schemasDir, filename, '.dbml');

  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const schemaList = project.files?.schemas || [];

  // スキーマの存在確認
  const targetEntry = schemaList.find(e => e.filename === filename);
  if (!targetEntry) {
    throw new Error(`削除対象のスキーマが見つかりません: ${filename}`);
  }

  // 物理ファイル削除
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // project.json から削除
  project.files.schemas = schemaList.filter(e => e.filename !== filename);
  project.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf8');

  serverLogger.info('Project', `スキーマを削除しました (${userId}: ${filename})`);
  return { success: true, project };
}

/**
 * 新規ERDを作成してプロジェクトに登録
 * @param {string} userId - ユーザーID
 * @param {Object} params - { name: string, description?: string }
 */
export function createErd(userId, { name, description = '' }) {
  if (!name || typeof name !== 'string') {
    throw new Error('有効なER図名 (name) が必要です');
  }

  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const erdsDir = path.join(userDir, 'erds');

  if (!fs.existsSync(erdsDir)) {
    fs.mkdirSync(erdsDir, { recursive: true });
  }

  // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
  const erdId = generateShortId(10);
  const filePath = path.join(erdsDir, `${erdId}.json`);

  // 初期ERDデータ構造 (erd-v1スキーマ準拠)
  const initialErdData = {
    info: {
      description: description || name,
      version: '1.0.0',
    },
    nodes: [],
    edges: [],
    memos: [],
    boxes: [],
  };

  fs.writeFileSync(filePath, JSON.stringify(initialErdData, null, 2), 'utf8');

  // project.json へのエントリ追加
  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const newErdEntry = {
    id: erdId,
    filename: erdId,
    name: name.trim(),
    description: description.trim(),
    visible: true,
  };

  project.files = project.files || {};
  project.files.erds = project.files.erds || [];
  project.files.erds.push(newErdEntry);
  project.meta.updatedAt = new Date().toISOString();

  fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf8');
  serverLogger.info('Project', `新規ER図を作成しました (${userId}: ${name} / ${erdId})`);

  return {
    erdEntry: newErdEntry,
    content: initialErdData,
    project,
  };
}

/**
 * ER図を削除
 * @param {string} userId - ユーザーID
 * @param {string} erdId - ERD ID
 */
export function deleteErd(userId, erdId) {
  if (!erdId) {
    throw new Error('削除対象のERD IDが指定されていません');
  }

  const userDir = ensureUserStorageDir(userId);
  const projectJsonPath = path.join(userDir, 'project.json');
  const erdsDir = path.join(userDir, 'erds');
  const filePath = resolveSafeChildPath(erdsDir, erdId, '.json');

  const project = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
  const erdList = project.files?.erds || [];

  // 存在確認
  const targetEntry = erdList.find(e => (e.id === erdId || e.filename === erdId));
  if (!targetEntry) {
    throw new Error(`削除対象のER図が見つかりません: ${erdId}`);
  }

  // 物理ファイル削除
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }

  // project.json から削除
  project.files.erds = erdList.filter(e => (e.id !== erdId && e.filename !== erdId));
  project.meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(projectJsonPath, JSON.stringify(project, null, 2), 'utf8');

  serverLogger.info('Project', `ER図を削除しました (${userId}: ${erdId})`);
  return { success: true, project };
}
