// 日本語コメント: 多言語化 (i18n) 基盤モジュール (src/core/i18n.js)
// ソースコード内での文字列ハードコードを防止し、t('key', params) による一元的なテキスト取得を提供します。
// プラグイン用名前空間 (plugins.<pluginId>.*) および英語 (en) フォールバックをサポートします。

import ja from '../locales/ja.js';
import en from '../locales/en.js';

const resources = {
  ja,
  en, // 英語リソース
};

const STORAGE_KEY = 'dbml_editor_lang';

let currentLang = 'ja';
try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved && resources[saved]) {
    currentLang = saved;
  }
} catch {}

/**
 * 現在の言語コードを取得
 */
export function getLang() {
  return currentLang;
}
export const getLocale = getLang;

/**
 * 言語を変更
 */
export function setLang(lang) {
  if (resources[lang]) {
    currentLang = lang;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {}
  }
}
export const setLocale = setLang;

/**
 * プラグインの多言語リソースを登録
 * @param {string} pluginId - プラグインの一意識別子
 * @param {Object<string, Object>|string} localesObj - 各言語の辞書オブジェクト (例: { en: {...}, ja: {...} }) または言語コード
 * @param {Object} [dictParam] - 言語コード指定時の辞書オブジェクト
 */
export function registerPluginTranslations(pluginId, localesObj = {}, dictParam = null) {
  if (!pluginId) return;

  // 第2引数が言語文字列 ('ja', 'en' 等) で第3引数に辞書が渡された場合も許容
  let targetObj = localesObj;
  if (typeof localesObj === 'string' && dictParam && typeof dictParam === 'object') {
    targetObj = { [localesObj]: dictParam };
  } else if (!targetObj || typeof targetObj !== 'object') {
    return;
  }

  for (const [lang, dict] of Object.entries(targetObj)) {
    if (!resources[lang]) {
      resources[lang] = {};
    }
    if (!resources[lang].plugins) {
      resources[lang].plugins = {};
    }
    resources[lang].plugins[pluginId] = {
      ...(resources[lang].plugins[pluginId] || {}),
      ...dict,
    };
  }
}

/**
 * オブジェクト階層からドット区切りキーの値を安全に探索
 */
function resolveKeyPath(root, keys) {
  let current = root;
  for (const k of keys) {
    if (current && typeof current === 'object' && k in current) {
      current = current[k];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * 辞書キーから翻訳テキストを取得し、パラメータを補間する
 * @param {string} key - ドット区切りの辞書キー (例: 'common.save', 'plugins.oracle-dialect.attributes.tablespace')
 * @param {Object} [params] - 埋め込みパラメータ (例: { name: 'USERS' })
 * @returns {string} 翻訳後のテキスト
 */
export function t(key, params = null) {
  if (!key || typeof key !== 'string') return '';

  const keys = key.split('.');

  // 1. 現在の言語リソースから探索
  let value = resolveKeyPath(resources[currentLang], keys);

  // 2. プラグイン名前空間 (plugins.<id>.*) の場合で未検出なら、英語 (en) リソースにフォールバック
  if (value === undefined && keys[0] === 'plugins' && resources['en']) {
    value = resolveKeyPath(resources['en'], keys);
  }

  // 3. 一般キーで現在言語に未定義の場合、'ja' からフォールバック探索
  if (value === undefined && currentLang !== 'ja' && resources['ja']) {
    value = resolveKeyPath(resources['ja'], keys);
  }

  // 4. 見つからない場合はキー名をそのまま返却
  if (typeof value !== 'string') {
    return key;
  }

  // パラメータ置換 ({name} -> 値)
  if (params && typeof params === 'object') {
    return value.replace(/\{(\w+)\}/g, (_, pName) => {
      return pName in params ? String(params[pName]) : `{${pName}}`;
    });
  }

  return value;
}

// 日本語コメント: i18n オブジェクトのエクスポート（named export および default export 両対応）
export const i18n = {
  t,
  getLang,
  setLang,
  getLocale,
  setLocale,
  registerPluginTranslations,
};

export default i18n;

