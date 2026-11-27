// 日本語コメント: HTML エスケープユーティリティ (src/core/html-utils.js)
// innerHTML を用いた描画箇所での XSS を防止するため、ユーザー入力・DBML 由来文字列をエスケープします。

/**
 * HTML 特殊文字 (&, <, >, ", ') を実体参照へエスケープ
 * @param {*} str
 * @returns {string}
 */
export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
