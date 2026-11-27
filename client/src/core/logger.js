// 日本語コメント: クライアント側バッチロガー (src/core/logger.js)
// ブラウザコンソールへの出力と同時に、ログをメモリキューにバッファリングし、
// 定期バッチ (3秒毎または10件) でサーバーの /api/logs へ送信して client.log に保存します。
// エラー発生時は待機せずに即時送信します。設定された logLevel に応じて出力・送信を制御します。

const LOG_LEVEL_PRIORITY = {
  ERROR: 0,
  WARN: 1,
  INFO: 2,
  DEBUG: 3,
};

class ClientLogger {
  constructor() {
    this.queue = [];
    this.flushInterval = 3000; // 3秒ごとにフラッシュ
    this.batchThreshold = 10;  // 10件たまれば即フラッシュ
    this.maxPendingQueue = 100; // 未ログイン時の最大バッファ件数
    this.timer = null;
    this.currentUser = null;
    // 日本語コメント: 本番運用時のデフォルトは INFO とし、config/app-config.json で debug 指定時のみ DEBUG ログを有効化する
    this.logLevel = 'INFO';
    this._rawFetch = (typeof window !== 'undefined' && typeof window.fetch === 'function')
      ? window.fetch.bind(window)
      : null;

    this.setupFetchInterceptor();
    this.startAutoFlush();
    this.setupGlobalErrorHandlers();
  }

  /**
   * 出力・送信対象のログレベルを設定 (error / warn / info / debug)
   */
  setLevel(level) {
    const upper = String(level || 'INFO').toUpperCase();
    if (LOG_LEVEL_PRIORITY[upper] !== undefined) {
      this.logLevel = upper;
    }
  }

  /**
   * ログインユーザー情報をセット (ログイン時は蓄積済み未送信ログをフラッシュ、ログアウト時はクリア)
   */
  setUser(username) {
    const prevUser = this.currentUser;
    this.currentUser = username || null;
    if (this.currentUser) {
      // 日本語コメント: ログイン確定前に記録されたログにもユーザー名を補完して即座にフラッシュ送信
      this.queue.forEach(entry => {
        if (!entry.user) entry.user = this.currentUser;
      });
      this.flush();
    } else if (prevUser) {
      // ログアウト時はキューをクリア
      this.queue = [];
    }
  }

  /**
   * サーバーAPI (/api/*) 呼び出し前後のデバッグログ出力用 fetch インターセプター
   */
  setupFetchInterceptor() {
    if (typeof window === 'undefined' || !this._rawFetch) return;

    const self = this;
    const rawFetch = this._rawFetch;

    window.fetch = async function interceptedFetch(input, init) {
      let url = '';
      let method = 'GET';

      if (typeof input === 'string') {
        url = input;
      } else if (input && typeof input.url === 'string') {
        url = input.url;
        if (input.method) method = input.method;
      } else if (input) {
        url = String(input);
      }

      if (init && init.method) {
        method = String(init.method).toUpperCase();
      } else {
        method = String(method || 'GET').toUpperCase();
      }

      // 日本語コメント: /api/ へのリクエスト（ただし /api/logs 自身は無限ループ防止のため除外）のみ対象
      const isApiCall = (url.startsWith('/api/') || url.includes('/api/')) && !url.includes('/api/logs');

      if (!isApiCall) {
        return rawFetch(input, init);
      }

      const startTime = Date.now();
      self.debug('API', `Request: ${method} ${url}`);

      try {
        const response = await rawFetch(input, init);
        const duration = Date.now() - startTime;
        self.debug('API', `Response: ${method} ${url} -> ${response.status} (${duration}ms)`);
        return response;
      } catch (err) {
        const duration = Date.now() - startTime;
        self.debug('API', `Error: ${method} ${url} -> ${err?.message || err} (${duration}ms)`);
        throw err;
      }
    };
  }

  /**
   * ログ追加
   */
  log(level, category, message, meta = null) {
    const upperLevel = String(level || 'INFO').toUpperCase();
    const targetPriority = LOG_LEVEL_PRIORITY[upperLevel] ?? LOG_LEVEL_PRIORITY.INFO;
    const maxPriority = LOG_LEVEL_PRIORITY[this.logLevel] ?? LOG_LEVEL_PRIORITY.INFO;
    if (targetPriority > maxPriority) {
      return;
    }

    const entry = {
      timestamp: new Date().toISOString(),
      level: upperLevel,
      category,
      message,
      user: this.currentUser,
      meta,
    };

    // 1. ブラウザコンソールへの出力
    const prefix = `[CLIENT:${upperLevel}] [${category}]`;
    if (upperLevel === 'ERROR') {
      console.error(prefix, message, meta || '');
    } else if (upperLevel === 'WARN') {
      console.warn(prefix, message, meta || '');
    } else if (upperLevel === 'DEBUG') {
      console.debug(prefix, message, meta || '');
    } else {
      console.log(prefix, message, meta || '');
    }

    // 2. サーバー送信キューに追加（未ログイン時も上限まで保持し、ログイン完了後に送信）
    if (!this.currentUser) {
      if (this.queue.length < this.maxPendingQueue) {
        this.queue.push(entry);
      }
      return;
    }
    this.queue.push(entry);

    // エラー時は即時送信、または件数が閾値に達したらフラッシュ
    if (upperLevel === 'ERROR' || this.queue.length >= this.batchThreshold) {
      this.flush();
    }
  }

  debug(category, message, meta = null) {
    this.log('DEBUG', category, message, meta);
  }

  info(category, message, meta = null) {
    this.log('INFO', category, message, meta);
  }

  warn(category, message, meta = null) {
    this.log('WARN', category, message, meta);
  }

  error(category, message, error = null) {
    const errorMeta = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : null;
    this.log('ERROR', category, message, errorMeta);
  }

  /**
   * キューに蓄積されたログをサーバー (/api/logs) に送信
   */
  async flush() {
    if (this.queue.length === 0) return;
    const fetchFn = this._rawFetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (!this.currentUser || typeof window === 'undefined' || !fetchFn) {
      return;
    }

    const itemsToSend = [...this.queue];
    this.queue = [];

    try {
      await fetchFn('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: itemsToSend }),
      });
    } catch (err) {
      // 送信失敗時はコンソール警告 (無限ループ防止のため logger は呼ばない)
      console.warn('[Logger] サーバーへのログ送信に失敗しました:', err.message);
    }
  }

  /**
   * 定期送信タイマーの開始 (ブラウザ環境のみ)
   */
  startAutoFlush() {
    if (typeof window === 'undefined') return;
    this.timer = setInterval(() => {
      this.flush();
    }, this.flushInterval);
  }

  /**
   * ページ終了時および未捕捉エラーのハンドリング (ブラウザ環境のみ)
   */
  setupGlobalErrorHandlers() {
    if (typeof window === 'undefined') return;

    // ページ離脱時に残存ログを sendBeacon で送信
    window.addEventListener('beforeunload', () => {
      if (this.queue.length > 0 && navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify({ logs: this.queue })], { type: 'application/json' });
        navigator.sendBeacon('/api/logs', blob);
      }
    });

    // 画面の未補足ランタイムエラー
    window.addEventListener('error', (event) => {
      this.error('GlobalError', event.message, event.error);
    });

    // 未補足 Promise 拒否
    window.addEventListener('unhandledrejection', (event) => {
      this.error('UnhandledRejection', String(event.reason?.message || event.reason), event.reason);
    });
  }
}

export const logger = new ClientLogger();
