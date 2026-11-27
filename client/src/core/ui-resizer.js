// 日本語コメント: サイドバー（左ツリー）のドラッグ幅調整リサイザー (src/core/ui-resizer.js)
// マウスドラッグによるツリー幅の伸縮、localStorage による幅の永続化、およびダブルクリックでの初期値復元を提供します。

const STORAGE_KEY = 'dbe_sidebar_width';
const DEFAULT_WIDTH = 280;
const MIN_WIDTH = 180;
const MAX_WIDTH = 700;

/**
 * サイドバーのドラッグリサイザーを初期化
 * @param {HTMLElement} layoutEl - .main-layout 要素
 * @param {HTMLElement} resizerEl - .pane-resizer 要素
 */
export function initSidebarResizer(layoutEl, resizerEl) {
  if (!layoutEl || !resizerEl) return;

  // 1. localStorage から保存済みの幅を復元（存在しない場合は初期値 280px）
  let currentWidth = DEFAULT_WIDTH;
  const savedWidth = localStorage.getItem(STORAGE_KEY);
  if (savedWidth) {
    const parsed = parseInt(savedWidth, 10);
    if (!isNaN(parsed) && parsed >= MIN_WIDTH && parsed <= MAX_WIDTH) {
      currentWidth = parsed;
    }
  }
  layoutEl.style.setProperty('--sidebar-width', `${currentWidth}px`);

  // 2. ドラッグ操作の状態管理
  let isDragging = false;
  let startX = 0;
  let startWidth = currentWidth;

  const onMouseMove = (e) => {
    if (!isDragging) return;
    const deltaX = e.clientX - startX;
    let newWidth = startWidth + deltaX;

    // 最小・最大幅の制約
    if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
    if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;

    currentWidth = newWidth;
    layoutEl.style.setProperty('--sidebar-width', `${newWidth}px`);
  };

  const onMouseUp = () => {
    if (!isDragging) return;
    isDragging = false;
    resizerEl.classList.remove('resizing');
    document.body.style.cursor = '';
    document.body.style.userSelect = '';

    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    // 現在の幅を localStorage に永続化
    localStorage.setItem(STORAGE_KEY, String(currentWidth));
  };

  resizerEl.addEventListener('mousedown', (e) => {
    // 左クリックのみ
    if (e.button !== 0) return;
    e.preventDefault();
    isDragging = true;
    startX = e.clientX;
    startWidth = currentWidth;

    resizerEl.classList.add('resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  });

  // 3. ダブルクリックで初期幅 (280px) にリセット
  resizerEl.addEventListener('dblclick', () => {
    currentWidth = DEFAULT_WIDTH;
    layoutEl.style.setProperty('--sidebar-width', `${DEFAULT_WIDTH}px`);
    localStorage.setItem(STORAGE_KEY, String(DEFAULT_WIDTH));
  });
}
