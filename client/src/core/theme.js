// 日本語コメント: テーマ管理基盤 (src/core/theme.js)
// 多テーマ（標準 / テクスチャ / タイポグラフィ / 色弱者向け）をルート要素 (html[data-theme]) に適用し、0ミリ秒での切替を実現します。

export const THEME_LIST = [
  { id: 'light', labelKey: 'settingsModal.themeLight' },
  { id: 'dark', labelKey: 'settingsModal.themeDark' },
  { id: 'sepia', labelKey: 'settingsModal.themeSepia' },
  // 拡張テーマ（設計図・四季パステル透かし・モノクロ・色弱者向け）
  { id: 'blueprint', labelKey: 'settingsModal.themeBlueprint' },
  { id: 'pastel-spring', labelKey: 'settingsModal.themePastelSpring' },
  { id: 'pastel-summer', labelKey: 'settingsModal.themePastelSummer' },
  { id: 'pastel-autumn', labelKey: 'settingsModal.themePastelAutumn' },
  { id: 'pastel-winter', labelKey: 'settingsModal.themePastelWinter' },
  { id: 'monochrome', labelKey: 'settingsModal.themeMonochrome' },
  { id: 'cud', labelKey: 'settingsModal.themeCud' },
  { id: 'frosted-glass', labelKey: 'settingsModal.themeFrostedGlass' }
];

const STORAGE_KEY = 'dbml_editor_theme';

// 旧パステルテーマIDからの自動移行マッピング
const LEGACY_THEME_MAP = {
  'pastel-strawberry': 'pastel-spring',
  'pastel-pumpkin': 'pastel-autumn'
};

export function getTheme(defaultTheme = 'light') {
  const raw = localStorage.getItem(STORAGE_KEY);
  const saved = LEGACY_THEME_MAP[raw] || raw;
  if (saved && THEME_LIST.some(item => item.id === saved)) {
    return saved;
  }
  return defaultTheme;
}

export function setTheme(theme, options = {}) {
  const { persist = true } = options;
  if (!THEME_LIST.some(item => item.id === theme)) return;
  document.documentElement.setAttribute('data-theme', theme);
  if (persist) {
    localStorage.setItem(STORAGE_KEY, theme);
  }
  window.dispatchEvent(new CustomEvent('dbe:theme-changed', { detail: { theme } }));
}

export function initTheme(defaultTheme = 'light') {
  const current = getTheme(defaultTheme);
  setTheme(current, { persist: true });
}
