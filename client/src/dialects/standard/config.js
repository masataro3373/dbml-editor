// 日本語コメント: DBML (Standard) 汎用方言設定 (src/dialects/standard/config.js)
// DBMS非依存のクリーンなDBMLモデリングを行うためのベースライン設定です。
// 初期状態ではDBMS固有の物理属性や設計書メタデータは持たず、純粋なDBML標準仕様に従います。

export const standardConfig = {
  id: 'standard',
  displayName: 'DBML (Standard)',
  dbmlDatabaseType: 'DBML',
  dbmlCoreType: null,
  maxIdentifierLength: Infinity,
  namingRules: {
    autoConvertUpper: false,
  },
  // テーブル拡張メタデータ（純粋DBML標準では空）
  tableAttributes: [],
  // カラム拡張メタデータ（純粋DBML標準では空）
  columnAttributes: [],
  dataTypes: [
    { name: 'int' },
    { name: 'bigint' },
    { name: 'varchar', hasLength: true, defaultLength: 255 },
    { name: 'text' },
    { name: 'boolean' },
    { name: 'datetime' },
    { name: 'timestamp' },
    { name: 'decimal', hasPrecision: true, hasScale: true },
    { name: 'blob' },
    { name: 'json' },
  ],
  reservedWords: new Set([
    'TABLE', 'COLUMN', 'INDEX', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES',
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'WHERE', 'FROM',
  ]),
};
