// 日本語コメント: テキストエクスポートユーティリティ (src/core/text-export-utils.js)
// エクスポートモーダル等で指定された文字コード (UTF-8 / Shift_JIS) および
// 改行コード (LF / CRLF) を正確に反映した Blob オブジェクトを生成します。

import * as cptableModule from 'codepage';

// 日本語コメント: ESM / CommonJS 両環境における互換性確保
const cptable = cptableModule.default || cptableModule;

/**
 * 指定された改行コードと文字コードを適用した Blob を生成
 *
 * @param {string} text - 出力対象の文字列
 * @param {Object} [options={}] - 出力オプション
 * @param {string} [options.encoding='utf-8'] - 文字コード ('utf-8', 'sjis', 'shift_jis', 'cp932')
 * @param {string} [options.newline='lf'] - 改行コード ('lf', 'crlf')
 * @returns {Blob} 変換後のバイナリ/テキストを保持する Blob オブジェクト
 */
export function formatExportBlob(text, { encoding = 'utf-8', newline = 'lf' } = {}) {
  const sourceText = typeof text === 'string' ? text : String(text ?? '');

  // ① 改行コードの変換
  // 一旦 \r\n および \r を \n に正規化し、newline が 'crlf' の場合は \r\n に置換
  const normalized = sourceText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const isCrlf = typeof newline === 'string' && newline.toLowerCase() === 'crlf';
  const formattedText = isCrlf ? normalized.replace(/\n/g, '\r\n') : normalized;

  // ② 文字コードの変換
  const enc = (typeof encoding === 'string' ? encoding : 'utf-8').toLowerCase();
  if (enc === 'sjis' || enc === 'shift_jis' || enc === 'cp932') {
    // 日本語コメント: SheetJS codepage (CP932) エンコーダーで Shift_JIS のバイト列にエンコード
    const encoded = cptable.utils.encode(932, formattedText);
    const uint8 = (encoded instanceof Uint8Array) ? encoded : new Uint8Array(encoded);
    return new Blob([uint8], { type: 'text/plain;charset=shift_jis' });
  }

  // デフォルト: UTF-8
  return new Blob([formattedText], { type: 'text/plain;charset=utf-8' });
}
