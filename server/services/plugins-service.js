// 日本語コメント: サーバー側プラグインスキャナー＆配信サービス (server/services/plugins-service.js)
// dbml-editor-v2/plugins ディレクトリ内の .zip プラグインをスキャン・検証し、
// マニフェストや多言語辞書、個別アセット (JS/CSS/アセット) の安全な配信を行います。
// 外部ライブラリへの依存ゼロで、Node.js 標準モジュールのみで ZIP を解析します。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { serverLogger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プラグイン配置ディレクトリ (dbml-editor-v2/plugins)
const PLUGINS_DIR = path.resolve(__dirname, '../../plugins');

/**
 * 日本語コメント: パスの安全性を検証し、Zip-Slip (パストラバーサル) 攻撃を防御
 * @param {string} filePath - 検証対象のファイルパス
 * @returns {boolean} 安全な相対パスであれば true
 */
function isSafeRelativePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;

  // バックスラッシュをスラッシュに置換して正規化
  const normalized = path.normalize(filePath).replace(/\\/g, '/');

  // 先頭スラッシュ、Windowsドライブ文字、.. を含む相対パスは不正と判定
  if (
    normalized.startsWith('/') ||
    normalized.startsWith('\\') ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return false;
  }

  return true;
}

/**
 * 日本語コメント: Node.js 標準モジュールのみで ZIP バッファを解析するクラス
 */
export class PureZipReader {
  constructor(buffer, fileName = '') {
    this.buffer = buffer;
    this.fileName = fileName;
    this.entries = new Map(); // path -> entry
    this._parseCentralDirectory();
  }

  /**
   * ZIP の End of Central Directory (EOCD) を探索して Central Directory をパース
   */
  _parseCentralDirectory() {
    const buf = this.buffer;
    const len = buf.length;
    if (len < 22) {
      throw new Error('ZIPファイルサイズが小さすぎます');
    }

    // EOCD シグネチャ (0x06054b50) を末尾から探索 (コメント長は最大 65535 バイト)
    let eocdOffset = -1;
    const maxSearch = Math.min(len, 65535 + 22);
    for (let i = len - 22; i >= len - maxSearch; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('End of Central Directory (EOCD) シグネチャが見つかりません');
    }

    const totalEntries = buf.readUInt16LE(eocdOffset + 10);
    const cdSize = buf.readUInt32LE(eocdOffset + 12);
    const cdOffset = buf.readUInt32LE(eocdOffset + 16);

    if (cdOffset + cdSize > len) {
      throw new Error('Central Directory オフセットがファイル範囲外です');
    }

    let pos = cdOffset;
    for (let i = 0; i < totalEntries && pos < cdOffset + cdSize; i++) {
      const sig = buf.readUInt32LE(pos);
      if (sig !== 0x02014b50) {
        break;
      }

      const compressionMethod = buf.readUInt16LE(pos + 10);
      const compressedSize = buf.readUInt32LE(pos + 20);
      const uncompressedSize = buf.readUInt32LE(pos + 24);
      const fileNameLength = buf.readUInt16LE(pos + 28);
      const extraFieldLength = buf.readUInt16LE(pos + 30);
      const fileCommentLength = buf.readUInt16LE(pos + 32);
      const localHeaderOffset = buf.readUInt32LE(pos + 42);

      const rawFileName = buf.toString('utf-8', pos + 46, pos + 46 + fileNameLength).replace(/\\/g, '/');

      // Zip-Slip チェック
      if (!isSafeRelativePath(rawFileName)) {
        serverLogger.warn('PluginSecurity', `Zip-Slipの疑いがある不正エントリを検知・スキップしました: ${rawFileName} in ${this.fileName}`);
        pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
        continue;
      }

      // 末尾スラッシュ（ディレクトリ）以外のファイルエントリを記録
      if (!rawFileName.endsWith('/')) {
        this.entries.set(rawFileName, {
          fileName: rawFileName,
          compressionMethod,
          compressedSize,
          uncompressedSize,
          localHeaderOffset,
        });
      }

      pos += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
  }

  /**
   * 指定した相対パスのエントリの展開後 Buffer を取得
   * @param {string} entryPath - 展開対象の相対パス
   * @returns {Buffer|null}
   */
  readEntryBuffer(entryPath) {
    const normalized = entryPath.replace(/\\/g, '/').replace(/^\/+/, '');
    const entry = this.entries.get(normalized);
    if (!entry) return null;

    const buf = this.buffer;
    const lPos = entry.localHeaderOffset;
    if (lPos + 30 > buf.length) {
      throw new Error(`ローカルヘッダがファイル外を指しています: ${normalized}`);
    }

    const localSig = buf.readUInt32LE(lPos);
    if (localSig !== 0x04034b50) {
      throw new Error(`不正なローカルヘッダシグネチャです: ${normalized}`);
    }

    const lFileNameLen = buf.readUInt16LE(lPos + 26);
    const lExtraLen = buf.readUInt16LE(lPos + 28);
    const dataStart = lPos + 30 + lFileNameLen + lExtraLen;
    const dataEnd = dataStart + entry.compressedSize;

    if (dataEnd > buf.length) {
      throw new Error(`圧縮データ領域がファイル範囲外です: ${normalized}`);
    }

    const rawData = buf.subarray(dataStart, dataEnd);

    if (entry.compressionMethod === 0) {
      // STORE (無圧縮)
      return Buffer.from(rawData);
    } else if (entry.compressionMethod === 8) {
      // DEFLATE (圧縮)
      return zlib.inflateRawSync(rawData);
    } else {
      throw new Error(`未対応の圧縮方式です (method=${entry.compressionMethod}): ${normalized}`);
    }
  }

  /**
   * エントリのテキスト内容を UTF-8 で取得
   */
  readEntryText(entryPath) {
    const buf = this.readEntryBuffer(entryPath);
    if (!buf) return null;
    return buf.toString('utf-8');
  }

  /**
   * 全エントリのパス一覧を取得
   */
  getEntryPaths() {
    return Array.from(this.entries.keys());
  }
}

/**
 * 日本語コメント: プラグイン管理サービスクラス
 */
export class PluginsService {
  constructor(pluginsDir = PLUGINS_DIR) {
    this.pluginsDir = pluginsDir;
    this._cache = new Map(); // zipFileName -> { mtimeMs, reader, pluginInfo }
  }

  /**
   * plugins ディレクトリ内の全 ZIP ファイルを走査・検証してプラグイン一覧を返却
   * @returns {Array<Object>} 検出されたプラグイン情報一覧
   */
  scanPlugins() {
    if (!fs.existsSync(this.pluginsDir)) {
      try {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      } catch (err) {
        serverLogger.error('PluginsService', `プラグインディレクトリ作成に失敗しました: ${err.message}`);
        return [];
      }
    }

    const files = fs.readdirSync(this.pluginsDir);
    const zipFiles = files.filter((f) => f.toLowerCase().endsWith('.zip'));

    const seenIds = new Set();
    const plugins = [];

    for (const zipFile of zipFiles) {
      const fullPath = path.join(this.pluginsDir, zipFile);
      try {
        const stats = fs.statSync(fullPath);
        const cached = this._cache.get(zipFile);

        let reader;
        if (cached && cached.mtimeMs === stats.mtimeMs) {
          reader = cached.reader;
        } else {
          const zipBuffer = fs.readFileSync(fullPath);
          reader = new PureZipReader(zipBuffer, zipFile);
        }

        const pluginInfo = this._inspectPlugin(reader, zipFile);

        // 重複 ID のチェック
        if (pluginInfo.status !== 'error') {
          if (seenIds.has(pluginInfo.id)) {
            pluginInfo.status = 'error';
            pluginInfo.errorReason = `重複するプラグイン ID が検出されました: '${pluginInfo.id}' (${zipFile})`;
            serverLogger.warn('PluginsService', pluginInfo.errorReason);
          } else {
            seenIds.add(pluginInfo.id);
          }
        }

        this._cache.set(zipFile, {
          mtimeMs: stats.mtimeMs,
          reader,
          pluginInfo,
        });

        plugins.push(pluginInfo);
      } catch (err) {
        serverLogger.error('PluginsService', `プラグイン ZIP の解析に失敗しました: ${zipFile} - ${err.message}`);
        plugins.push({
          id: path.basename(zipFile, '.zip'),
          nameKey: 'plugin.name',
          descriptionKey: 'plugin.description',
          version: '0.0.0',
          entry: '',
          capabilities: [],
          requires: [],
          status: 'error',
          errorReason: `ZIPファイルの解析エラー: ${err.message}`,
          locales: {},
          zipFileName: zipFile,
        });
      }
    }

    return plugins;
  }

  /**
   * 単一プラグインの ZIP 内容を検査して構造化オブジェクトを生成
   * @private
   */
  _inspectPlugin(reader, zipFileName) {
    const defaultId = path.basename(zipFileName, '.zip');
    const entryPaths = reader.getEntryPaths();

    // 1. plugin.json の読み取りとパース
    const manifestText = reader.readEntryText('plugin.json');
    if (!manifestText) {
      return {
        id: defaultId,
        name: defaultId,
        description: '',
        nameKey: `plugins.${defaultId}.name`,
        descriptionKey: `plugins.${defaultId}.description`,
        version: '0.0.0',
        entry: '',
        capabilities: [],
        requires: [],
        status: 'error',
        errorReason: 'マニフェストファイル (plugin.json) が存在しません',
        locales: {},
        zipFileName,
      };
    }

    let manifest;
    try {
      manifest = JSON.parse(manifestText);
    } catch (err) {
      return {
        id: defaultId,
        name: defaultId,
        description: '',
        nameKey: `plugins.${defaultId}.name`,
        descriptionKey: `plugins.${defaultId}.description`,
        version: '0.0.0',
        entry: '',
        capabilities: [],
        requires: [],
        status: 'error',
        errorReason: `plugin.json の JSON 構文エラー: ${err.message}`,
        locales: {},
        zipFileName,
      };
    }

    // 2. 必須属性のバリデーション
    const pluginId = manifest.id || defaultId;
    if (!/^[a-z0-9-]+$/.test(pluginId)) {
      return {
        id: pluginId,
        name: manifest.name || pluginId,
        description: manifest.description || '',
        nameKey: manifest.nameKey || `plugins.${pluginId}.name`,
        descriptionKey: manifest.descriptionKey || `plugins.${pluginId}.description`,
        version: manifest.version || '0.0.0',
        entry: manifest.entry || '',
        capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
        requires: Array.isArray(manifest.requires) ? manifest.requires : [],
        status: 'error',
        errorReason: `プラグインIDは英小文字・数字・ハイフンのみ使用できます: '${pluginId}'`,
        locales: {},
        zipFileName,
      };
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      return {
        id: pluginId,
        name: manifest.name || pluginId,
        description: manifest.description || '',
        nameKey: manifest.nameKey || `plugins.${pluginId}.name`,
        descriptionKey: manifest.descriptionKey || `plugins.${pluginId}.description`,
        version: '0.0.0',
        entry: manifest.entry || '',
        capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
        requires: Array.isArray(manifest.requires) ? manifest.requires : [],
        status: 'error',
        errorReason: 'plugin.json に有効な version が指定されていません',
        locales: {},
        zipFileName,
      };
    }

    if (!manifest.entry || typeof manifest.entry !== 'string') {
      return {
        id: pluginId,
        name: manifest.name || pluginId,
        description: manifest.description || '',
        nameKey: manifest.nameKey || `plugins.${pluginId}.name`,
        descriptionKey: manifest.descriptionKey || `plugins.${pluginId}.description`,
        version: manifest.version,
        entry: '',
        capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
        requires: Array.isArray(manifest.requires) ? manifest.requires : [],
        status: 'error',
        errorReason: 'plugin.json にエントリポイント (entry) が指定されていません',
        locales: {},
        zipFileName,
      };
    }

    // 3. 多言語リソースの読み取りと locales/en.json の必須チェック
    const locales = {};
    const localeFiles = entryPaths.filter((p) => p.startsWith('locales/') && p.endsWith('.json'));

    for (const locPath of localeFiles) {
      const langMatch = locPath.match(/^locales\/([^/]+)\.json$/);
      if (langMatch) {
        const langCode = langMatch[1];
        const jsonText = reader.readEntryText(locPath);
        if (jsonText) {
          try {
            locales[langCode] = JSON.parse(jsonText);
          } catch (e) {
            serverLogger.warn('PluginsService', `言語ファイルの JSON 解析に失敗しました: ${locPath} in ${zipFileName}`);
          }
        }
      }
    }

    if (!locales.en) {
      return {
        id: pluginId,
        name: manifest.name || pluginId,
        description: manifest.description || '',
        nameKey: manifest.nameKey || `plugins.${pluginId}.name`,
        descriptionKey: manifest.descriptionKey || `plugins.${pluginId}.description`,
        version: manifest.version,
        entry: manifest.entry,
        capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
        requires: Array.isArray(manifest.requires) ? manifest.requires : [],
        status: 'error',
        errorReason: '必須の英語言語ファイル (locales/en.json) が存在しないか破損しています',
        locales,
        zipFileName,
      };
    }

    // 4. README.md の確認
    const hasReadme = entryPaths.includes('README.md');
    const readmeContent = hasReadme ? reader.readEntryText('README.md') : null;

    return {
      id: pluginId,
      name: manifest.name || pluginId,
      description: manifest.description || '',
      nameKey: manifest.nameKey || `plugins.${pluginId}.name`,
      descriptionKey: manifest.descriptionKey || `plugins.${pluginId}.description`,
      version: manifest.version,
      author: manifest.author || '',
      minAppVersion: manifest.minAppVersion || '2.0.0',
      entry: manifest.entry,
      styles: Array.isArray(manifest.styles) ? manifest.styles : [],
      capabilities: Array.isArray(manifest.capabilities) ? manifest.capabilities : [],
      requires: Array.isArray(manifest.requires) ? manifest.requires : [],
      status: 'installed',
      errorReason: null,
      locales,
      hasReadme,
      readme: readmeContent,
      zipFileName,
    };
  }

  /**
   * 指定したプラグイン ID の ZIP からアセットを取得
   * @param {string} pluginId - プラグインID
   * @param {string} assetPath - プラグイン内部の相対パス
   * @returns {{ buffer: Buffer, fileName: string } | null}
   */
  getPluginAsset(pluginId, assetPath) {
    if (!isSafeRelativePath(assetPath)) {
      serverLogger.warn('PluginSecurity', `不正なアセット要求を拒否しました: plugin=${pluginId}, path=${assetPath}`);
      return null;
    }

    // キャッシュまたは最新スキャンから対象プラグインを探す
    const plugins = this.scanPlugins();
    const plugin = plugins.find((p) => p.id === pluginId);
    if (!plugin || !plugin.zipFileName) {
      return null;
    }

    const cached = this._cache.get(plugin.zipFileName);
    if (!cached || !cached.reader) {
      return null;
    }

    try {
      const buffer = cached.reader.readEntryBuffer(assetPath);
      if (!buffer) return null;
      return {
        buffer,
        fileName: path.basename(assetPath),
      };
    } catch (err) {
      serverLogger.error('PluginsService', `アセット取得エラー: ${pluginId}/${assetPath} - ${err.message}`);
      return null;
    }
  }
}

export const pluginsService = new PluginsService();

