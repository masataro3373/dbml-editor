// 日本語コメント: サーバー側ロガーモジュール (server/logger.js)
// サーバー自体の動作ログ (server.log) と、クライアントから送信されたログ (client.log) を
// 日次ローテーション（1日ごと・設定により gzip 圧縮 ON/OFF・設定日数経過後の自動削除）付きで出力します。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { configService } from './services/config-service.js';

const gzipAsync = promisify(zlib.gzip);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクトルート配下の logs ディレクトリ
const LOGS_DIR = path.resolve(__dirname, '../logs');

// ログレベル優先度（数値が小さいほど重要度が高い）
const LOG_LEVEL_PRIORITY = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

// logs ディレクトリが存在しない場合は自動作成
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

/**
 * 2桁ゼロ埋めヘルパー
 */
function pad2(num) {
  return String(num).padStart(2, '0');
}

/**
 * ローカル日付文字列 (YYYY-MM-DD) を取得
 */
function getLocalDateString(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * ローカルタイムゾーンのオフセット付き ISO 文字列 (例: 2026-11-14T15:20:00.123+09:00) を取得
 */
function formatLocalTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());
  const millis = String(date.getMilliseconds()).padStart(3, '0');

  // getTimezoneOffset() は UTC - ローカル の分（JST は -540）
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absOffset = Math.abs(offsetMinutes);
  const offsetHours = pad2(Math.floor(absOffset / 60));
  const offsetMins = pad2(absOffset % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${millis}${sign}${offsetHours}:${offsetMins}`;
}

/**
 * 指定ログレベルが現在のサーバー設定で出力対象か判定
 */
function shouldLogServer(level) {
  const configured = String(configService.getServerConfig().logLevel || 'info').toLowerCase();
  const maxPriority = LOG_LEVEL_PRIORITY[configured] ?? LOG_LEVEL_PRIORITY.info;
  const targetPriority = LOG_LEVEL_PRIORITY[level.toLowerCase()] ?? LOG_LEVEL_PRIORITY.info;
  return targetPriority <= maxPriority;
}

/**
 * 単一ファイルを非同期で gzip 圧縮し、成功後に元ファイルを削除
 */
async function compressLogFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    const raw = await fs.promises.readFile(filePath);
    const compressed = await gzipAsync(raw);
    await fs.promises.writeFile(`${filePath}.gz`, compressed);
    await fs.promises.unlink(filePath);
  } catch (err) {
    console.error(`[LOGGER:ERROR] ログファイルの圧縮に失敗しました (${filePath}):`, err.message);
  }
}

/**
 * 日次ローテーション・圧縮・保持期間管理を担うログチャンネルクラス
 */
class DailyLogChannel {
  constructor(baseName) {
    this.baseName = baseName;
    this.activeFilePath = path.join(LOGS_DIR, `${baseName}.log`);
    this.currentDate = getLocalDateString();
    this.stream = null;
    this.archivedPattern = new RegExp(`^${baseName}\\.(\\d{4}-\\d{2}-\\d{2})(?:\\.\\d+)?\\.log(?:\\.gz)?$`);

    this.initialize();
  }

  /**
   * 起動時の初期ローテーション判定・ストリームオープン・古いログ削除
   */
  initialize() {
    const today = getLocalDateString();
    if (fs.existsSync(this.activeFilePath)) {
      try {
        const stats = fs.statSync(this.activeFilePath);
        const fileDate = getLocalDateString(stats.mtime);
        if (fileDate < today && stats.size > 0) {
          this.archiveActiveFile(fileDate);
        }
      } catch (err) {
        console.error(`[LOGGER:ERROR] 起動時ログ確認に失敗しました (${this.activeFilePath}):`, err.message);
      }
    }

    this.currentDate = today;
    this.openStream();
    this.cleanupOldLogs();
  }

  /**
   * 追記用 WriteStream を開く
   */
  openStream() {
    this.stream = fs.createWriteStream(this.activeFilePath, { flags: 'a', encoding: 'utf8' });
    this.stream.on('error', (err) => {
      console.error(`[LOGGER:ERROR] ログストリーム書き込みエラー (${this.activeFilePath}):`, err.message);
    });
  }

  /**
   * アクティブファイルを日付付きファイルへリネームし、設定に応じて圧縮
   */
  archiveActiveFile(dateStr) {
    if (!fs.existsSync(this.activeFilePath)) return;

    let rotatedPath = path.join(LOGS_DIR, `${this.baseName}.${dateStr}.log`);
    if (fs.existsSync(rotatedPath) || fs.existsSync(`${rotatedPath}.gz`)) {
      rotatedPath = path.join(LOGS_DIR, `${this.baseName}.${dateStr}.${Date.now()}.log`);
    }

    try {
      fs.renameSync(this.activeFilePath, rotatedPath);
      const { logCompress } = configService.getServerConfig();
      if (logCompress) {
        // 圧縮は非同期でバックグラウンド実行し、ロギングを止めない
        void compressLogFile(rotatedPath);
      }
    } catch (err) {
      console.error(`[LOGGER:ERROR] ログローテーションに失敗しました (${this.activeFilePath}):`, err.message);
    }
  }

  /**
   * 日付切り替わり時のローテーション実行
   */
  rotateIfNeeded() {
    const today = getLocalDateString();
    if (today === this.currentDate) return;

    const oldDate = this.currentDate;
    this.currentDate = today;

    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    this.archiveActiveFile(oldDate);
    this.openStream();
    this.cleanupOldLogs();
  }

  /**
   * 保持期間（logRetentionDays）を経過したアーカイブファイルを削除
   */
  cleanupOldLogs() {
    const { logRetentionDays = 30 } = configService.getServerConfig();
    const retentionDays = Number(logRetentionDays) > 0 ? Number(logRetentionDays) : 30;
    const todayParts = getLocalDateString().split('-').map(Number);
    const todayUtcMs = Date.UTC(todayParts[0], todayParts[1] - 1, todayParts[2]);

    try {
      const files = fs.readdirSync(LOGS_DIR);
      for (const fileName of files) {
        const match = fileName.match(this.archivedPattern);
        if (!match) continue;

        const [y, m, d] = match[1].split('-').map(Number);
        const fileUtcMs = Date.UTC(y, m - 1, d);
        const diffDays = Math.floor((todayUtcMs - fileUtcMs) / 86400000);

        if (diffDays > retentionDays) {
          fs.unlinkSync(path.join(LOGS_DIR, fileName));
        }
      }
    } catch (err) {
      console.error(`[LOGGER:ERROR] 古いログの削除に失敗しました (${this.baseName}):`, err.message);
    }
  }

  /**
   * ログ1行を書き込み
   */
  writeLine(text) {
    this.rotateIfNeeded();
    if (this.stream) {
      this.stream.write(`${text}\n`);
    }
  }

  /**
   * ストリームを安全にクローズ
   */
  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

const serverChannel = new DailyLogChannel('server');
const clientChannel = new DailyLogChannel('client');

// イベントループ終了前にストリームをクローズ
process.once('beforeExit', () => {
  serverChannel.close();
  clientChannel.close();
});

/**
 * コンソールおよびファイルへ出力する共通ヘルパー
 */
function emitServerLog(level, category, message, detail = null) {
  if (!shouldLogServer(level)) return;

  const ts = formatLocalTimestamp();
  let detailStr = '';
  if (detail) {
    detailStr = detail instanceof Error
      ? ` ${detail.stack || detail.message}`
      : ` ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`;
  }

  const line = `[${ts}] [SERVER:${level.toUpperCase()}] [${category}] ${message}${detailStr}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
  serverChannel.writeLine(line);
}

/**
 * サーバー側ロガー
 */
export const serverLogger = {
  debug(category, message, meta = null) {
    emitServerLog('debug', category, message, meta);
  },

  info(category, message, meta = null) {
    emitServerLog('info', category, message, meta);
  },

  warn(category, message, meta = null) {
    emitServerLog('warn', category, message, meta);
  },

  error(category, message, error = null) {
    emitServerLog('error', category, message, error);
  },
};

/**
 * クライアント受信ログ専用ロガー (client.log へ記録)
 */
export const clientLogger = {
  write(entry) {
    const {
      timestamp = formatLocalTimestamp(),
      level = 'INFO',
      category = 'Client',
      message = '',
      user = null,
      meta = null,
    } = entry;

    const upperLevel = String(level).toUpperCase();
    // クライアント側タイムスタンプ（UTC ISO の場合も含め）をそのまままたはローカル整形して記録
    const parsedDate = new Date(timestamp);
    const formattedTs = Number.isNaN(parsedDate.getTime()) ? timestamp : formatLocalTimestamp(parsedDate);
    const userStr = user ? ` [User:${user}]` : '';
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    const line = `[${formattedTs}] [CLIENT:${upperLevel}]${userStr} [${category}] ${message}${metaStr}`;

    if (upperLevel === 'ERROR') {
      console.error(line);
    } else if (upperLevel === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }

    clientChannel.writeLine(line);
  },
};
