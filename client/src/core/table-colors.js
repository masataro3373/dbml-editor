// 日本語コメント: テーブルカラー用プリセットパレット・共通バッジ描画ヘルパー (src/core/table-colors.js)

import { escapeHtml } from './html-utils.js';

/**
 * テーブルカラー用プリセットパレット (8色)
 */
export const TABLE_COLOR_PRESETS = [
  { color: '#64748b', labelKey: 'table_color.gray' },
  { color: '#3b82f6', labelKey: 'table_color.blue' },
  { color: '#10b981', labelKey: 'table_color.green' },
  { color: '#f59e0b', labelKey: 'table_color.amber' },
  { color: '#ef4444', labelKey: 'table_color.red' },
  { color: '#8b5cf6', labelKey: 'table_color.purple' },
  { color: '#06b6d4', labelKey: 'table_color.cyan' },
  { color: '#ec4899', labelKey: 'table_color.pink' },
];

/**
 * テーブルカラーが有効な色コードの場合、細い縦線バッジの HTML を返します。
 * @param {string|null|undefined} color
 * @returns {string}
 */
export function renderTableColorBar(color) {
  const safeColor = String(color || '').trim();
  if (!safeColor) return '';
  return `<span class="dbe-table-color-bar" style="background-color: ${escapeHtml(safeColor)};" aria-hidden="true"></span>`;
}
