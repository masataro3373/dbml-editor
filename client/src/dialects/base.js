// 日本語コメント: DBMS方言プラグイン基底クラス (src/dialects/base.js)
// すべてのDBMS方言 (Standard DBML, Oracle, 将来の PostgreSQL/MySQL 等) が実装すべき共通インターフェースです。

export class BaseDialect {
  /**
   * @param {Object} config - 方言設定オブジェクト
   */
  constructor(config = {}) {
    this.config = config;
  }

  /** 方言の内部識別子 (例: 'standard', 'oracle_12c', 'oracle_11g') */
  get id() {
    return this.config.id || 'unknown';
  }

  /** UI表示名 (例: 'DBML (Standard)', 'Oracle (12c+)', 'Oracle (<= 11g)') */
  get displayName() {
    return this.config.displayName || this.id;
  }

  /** DBMLの Project ブロックに書き出す database_type の値 */
  get dbmlDatabaseType() {
    return this.config.dbmlDatabaseType || '';
  }

  /** @dbml/core に渡すDBMS種別名 (例: 'oracle', 'postgres') */
  get dbmlCoreType() {
    return this.config.dbmlCoreType || null;
  }

  /** 識別子（テーブル名・カラム名）の最大文字数 (無制限の場合は Infinity) */
  get maxIdentifierLength() {
    return this.config.maxIdentifierLength || Infinity;
  }

  /** サポートするデータ型一覧 */
  get dataTypes() {
    return this.config.dataTypes || [];
  }

  /** テーブル物理属性スキーマ（TABLESPACE等） */
  get tableAttributes() {
    return this.config.tableAttributes || [];
  }

  /** 予約語一覧の Set */
  get reservedWords() {
    return this.config.reservedWords || new Set();
  }

  /**
   * テーブル名またはカラム名の検証 (文字数制限・予約語チェック)
   * @param {string} name - 検証する識別子名
   * @param {'table' | 'column'} type - 種別
   * @returns {Object[]} 検証警告/エラーの配列
   */
  validateIdentifier(name, type) {
    const issues = [];
    if (!name) return issues;

    // 1. 桁数チェック
    if (name.length > this.maxIdentifierLength) {
      issues.push({
        type: 'length_exceeded',
        max: this.maxIdentifierLength,
        current: name.length,
      });
    }

    // 2. 予約語チェック
    if (this.reservedWords.has(name.toUpperCase())) {
      issues.push({
        type: 'reserved_word',
        word: name,
      });
    }

    return issues;
  }

  /**
   * カラム名やテーブル名の自動整形 (大文字化ルール等)
   */
  formatIdentifier(name) {
    if (!name) return '';
    if (this.config.namingRules?.autoConvertUpper) {
      return name.toUpperCase();
    }
    return name;
  }
}

/**
 * DBMS方言インポーター基底クラス (Template Method パターン)
 * 前処理 (クレンジング・属性抽出) → 本処理 (パース・DBML変換) → 後処理 (属性注入・整形) の標準フローを規定
 */
export class BaseImporter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 日本語コメント: インポート時にUIへ動的表示するオプション定義配列
   * @returns {Array<{ key: string, label: string, type: 'boolean'|'select', options?: Array<{label: string, value: any}>, default: any, description?: string }>}
   */
  get importOptions() {
    return [];
  }

  /**
   * テンプレートメソッド: インポート処理の標準実行フロー
   * @param {string} rawSql - 生SQL (DDL) テキスト
   * @param {Object} options - オプション
   * @returns {Promise<{ success: boolean, dbml: string, warnings?: string[], error?: string }>}
   */
  async execute(rawSql, options = {}) {
    try {
      // 1. 前処理 (ノイズ除去、物理属性・メタデータ抽出、セミコロン補正)
      const preprocessed = await this.preprocess(rawSql, options);

      // 2. 本処理 (@dbml/core 等によるDBML変換・ASTパース)
      const baseDbml = await this.process(preprocessed.cleanedSql, options, preprocessed);

      // 3. 後処理 (物理属性の復元、Projectブロック補完、フォーマット整形)
      const postResult = await this.postprocess(baseDbml, preprocessed, options);
      // 日本語コメント: postprocess が文字列を返した場合も { dbml } オブジェクトを返した場合も正規化して文字列を取り出す
      const finalDbml = (postResult && typeof postResult === 'object' && typeof postResult.dbml === 'string')
        ? postResult.dbml
        : String(postResult || '');

      return {
        success: true,
        dbml: finalDbml,
        warnings: preprocessed.warnings || postResult?.warnings || [],
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
        warnings: [],
      };
    }
  }

  /** 前処理フック (サブクラスでオーバーライド) */
  async preprocess(rawSql, options = {}) {
    return { cleanedSql: rawSql, warnings: [] };
  }

  /** 本処理フック (サブクラスでオーバーライド) */
  async process(cleanedSql, options = {}, context = {}) {
    throw new Error('BaseImporter.process() はサブクラスで実装してください');
  }

  /** 後処理フック (サブクラスでオーバーライド) */
  async postprocess(dbml, preprocessed = {}, options = {}) {
    return dbml;
  }
}

/**
 * DBMS方言エクスポーター基底クラス (Template Method パターン)
 * 前処理 (モデル正規化・対象選定) → 本処理 (DDL生成) → 後処理 (改行・エンコード・ZIP分割) の標準フローを規定
 */
export class BaseExporter {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * 日本語コメント: エクスポート時にUIへ動的表示するオプション定義配列
   * @returns {Array<{ key: string, label: string, type: 'boolean'|'select', options?: Array<{label: string, value: any}>, default: any, description?: string }>}
   */
  get exportOptions() {
    return [];
  }

  /**
   * テンプレートメソッド: エクスポート処理の標準実行フロー
   * @param {Object} model - ASTモデル (tables, refs, project 等)
   * @param {Object} options - オプション
   * @returns {Promise<{ success: boolean, content: string, filename?: string, error?: string }>}
   */
  async execute(model, options = {}) {
    try {
      // 1. 前処理 (出力対象選定、物理属性展開、論理名解決)
      const context = await this.preprocess(model, options);

      // 2. 本処理 (DDL 文の生成: CREATE TABLE, INDEX, 制約, COMMENT ON 等)
      const rawSql = await this.process(context, options);

      // 3. 後処理 (改行コード正規化、エンコーディング適用、分割・ZIP化対応)
      const result = await this.postprocess(rawSql, context, options);

      return {
        success: true,
        ...result,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /** 前処理フック (サブクラスでオーバーライド) */
  async preprocess(model, options = {}) {
    return { model, options };
  }

  /** 本処理フック (サブクラスでオーバーライド) */
  async process(context, options = {}) {
    throw new Error('BaseExporter.process() はサブクラスで実装してください');
  }

  /** 後処理フック (サブクラスでオーバーライド) */
  async postprocess(rawSql, context = {}, options = {}) {
    return { content: rawSql };
  }
}
