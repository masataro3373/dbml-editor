// 日本語コメント: 方言マネージャー (src/dialects/index.js)
// 登録されているすべての方言プラグインを統括し、DBMLの Project ブロック (database_type) に応じた方言の解決を提供します。
// 初期状態では純粋な DBML (Standard) のみを内蔵し、Oracle 等の方言はプラグインから登録されます。

import { standardDialect } from './standard/index.js';

class DialectManager {
  constructor() {
    this.dialects = new Map();
    this.defaultDialect = standardDialect;

    // 初期方言の登録 (純粋 DBML Standard のみ)
    this.register(standardDialect);
  }

  /**
   * 新しい方言プラグインを登録
   */
  register(dialect) {
    if (dialect && dialect.id) {
      this.dialects.set(dialect.id, dialect);
    }
  }

  /**
   * デフォルト方言を設定 (設定ファイルの defaultDialect 反映用)
   */
  setDefaultDialect(dialectId) {
    const found = this.dialects.get(dialectId);
    if (found) {
      this.defaultDialect = found;
    }
  }

  /**
   * 登録済み全方言の一覧を取得 (プルダウン用)
   */
  getAll() {
    return Array.from(this.dialects.values());
  }

  /**
   * IDによる方言取得
   */
  getById(id) {
    return this.dialects.get(id) || this.defaultDialect;
  }

  /**
   * DBMLの Project ブロック (database_type) から対応する方言を解決
   * @param {string} databaseType - database_type の文字列
   * @returns {BaseDialect}
   */
  resolve(databaseType) {
    if (!databaseType || typeof databaseType !== 'string') {
      return this.defaultDialect;
    }

    const trimmed = databaseType.trim();

    // 1. 完全一致チェック (dbmlDatabaseType または id)
    for (const d of this.dialects.values()) {
      if (
        (d.dbmlDatabaseType && d.dbmlDatabaseType.toLowerCase() === trimmed.toLowerCase()) ||
        d.id.toLowerCase() === trimmed.toLowerCase()
      ) {
        return d;
      }
    }

    // 2. 登録済み方言のキーワード解決 (部分一致・正規表現)
    for (const d of this.dialects.values()) {
      if (d.id !== 'standard' && trimmed.toLowerCase().includes(d.id.toLowerCase())) {
        return d;
      }
      if (d.dbmlDatabaseType && d.dbmlDatabaseType !== 'DBML' && trimmed.toLowerCase().includes(d.dbmlDatabaseType.toLowerCase())) {
        return d;
      }
    }

    return this.defaultDialect;
  }
}

export const dialectManager = new DialectManager();
