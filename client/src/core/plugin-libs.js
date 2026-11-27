// 日本語コメント: プラグイン向け外部ライブラリ ホワイトリスト定義 (client/src/core/plugin-libs.js)
// サーバー管理者が本体に導入し、プラグインへの利用を許可するサードパーティライブラリをここで一括管理します。
// プラグインマニフェスト (plugin.json) の "requires" に宣言されたライブラリ名と一致するものが PluginContext.libs 経由で渡されます。

import * as XLSX from 'xlsx';
import ejs from 'ejs';

export const PLUGIN_LIBS = {
  xlsx: XLSX,
  ejs: ejs,
};

/**
 * ライブラリ名に対応するライブラリオブジェクトを取得
 * @param {string} libName
 * @returns {any|null}
 */
export function getPluginLib(libName) {
  if (!libName || typeof libName !== 'string') return null;
  return PLUGIN_LIBS[libName.toLowerCase()] || null;
}

/**
 * 必須ライブラリ一覧がすべてホワイトリストに存在するか検証
 * @param {string[]} requiresList
 * @returns {{ valid: boolean, missing: string[] }}
 */
export function checkRequiredLibs(requiresList = []) {
  if (!Array.isArray(requiresList) || requiresList.length === 0) {
    return { valid: true, missing: [] };
  }

  const missing = [];
  for (const name of requiresList) {
    if (!PLUGIN_LIBS[name.toLowerCase()]) {
      missing.push(name);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}

