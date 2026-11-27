// 日本語コメント: テキスト検索共通ヘルパー (src/core/text-search-helper.js)
// DBML プレビュー (CodeMirror) およびマイグレーション画面 (textarea) の両方で検索ロジックを共通化します。

/**
 * テキスト内の検索クエリ一致箇所（start/end オフセット配列）を検索する純粋関数
 * @param {string} text - 検索対象テキスト
 * @param {string} query - 検索キーワード
 * @param {Object} [options]
 * @param {boolean} [options.caseSensitive=false] - 大文字・小文字を区別するか
 * @returns {Array<{ start: number, end: number }>}
 */
export function findTextMatches(text, query, { caseSensitive = false } = {}) {
  if (!text || !query) return [];
  const source = caseSensitive ? String(text) : String(text).toLowerCase();
  const needle = caseSensitive ? String(query) : String(query).toLowerCase();
  if (!needle) return [];

  const matches = [];
  let pos = 0;
  while (pos <= source.length - needle.length) {
    const idx = source.indexOf(needle, pos);
    if (idx === -1) break;
    matches.push({ start: idx, end: idx + needle.length });
    pos = idx + Math.max(1, needle.length);
  }
  return matches;
}

/**
 * 次の検索ヒットインデックスを循環計算する
 * @param {number} currentIndex - 現在のインデックス (-1 は未選択)
 * @param {number} total - 総ヒット数
 * @param {number} [direction=1] - 1 (次へ) または -1 (前へ)
 * @returns {number}
 */
export function computeNextMatchIndex(currentIndex, total, direction = 1) {
  if (!total || total <= 0) return -1;
  if (currentIndex < 0 || currentIndex >= total) {
    return direction >= 0 ? 0 : total - 1;
  }
  return (currentIndex + direction + total) % total;
}

/**
 * テキストエリアを指定文字オフセット付近へ縦スクロールする
 * @param {HTMLTextAreaElement} textarea
 * @param {number} offset
 */
export function scrollTextareaToOffset(textarea, offset) {
  if (!textarea) return;
  const textBefore = textarea.value.slice(0, Math.max(0, offset));
  const lineIndex = textBefore.split('\n').length - 1;
  const computed = typeof window !== 'undefined' ? window.getComputedStyle(textarea) : null;
  const parsedLineHeight = computed ? parseFloat(computed.lineHeight) : NaN;
  const lineHeight = Number.isFinite(parsedLineHeight) ? parsedLineHeight : 20;
  const targetTop = Math.max(0, lineIndex * lineHeight - textarea.clientHeight * 0.35);
  textarea.scrollTop = targetTop;
}

/**
 * <textarea> に検索バー（入力欄・件数・前へ/次へ）をバインドする共通コントローラ
 * @param {Object} params
 * @param {HTMLTextAreaElement} params.textarea
 * @param {HTMLInputElement} params.inputEl
 * @param {HTMLElement} params.countEl
 * @param {HTMLButtonElement} params.prevBtn
 * @param {HTMLButtonElement} params.nextBtn
 * @returns {{ refresh: (focusTextarea?: boolean) => void }}
 */
export function attachTextareaSearchController({ textarea, inputEl, countEl, prevBtn, nextBtn }) {
  let matches = [];
  let currentIndex = -1;

  const updateCountView = () => {
    if (!countEl) return;
    const hasQuery = Boolean(inputEl?.value);
    if (!hasQuery) {
      countEl.textContent = '';
      countEl.classList.remove('no-match');
      return;
    }
    if (matches.length === 0) {
      countEl.textContent = '0/0';
      countEl.classList.add('no-match');
    } else {
      const displayIdx = currentIndex >= 0 ? currentIndex + 1 : 0;
      countEl.textContent = `${displayIdx}/${matches.length}`;
      countEl.classList.remove('no-match');
    }
  };

  const jumpTo = (index, focusTextarea = false) => {
    if (!textarea || matches.length === 0 || index < 0 || index >= matches.length) {
      updateCountView();
      return;
    }
    currentIndex = index;
    const match = matches[currentIndex];
    scrollTextareaToOffset(textarea, match.start);
    textarea.setSelectionRange(match.start, match.end);
    if (focusTextarea) {
      textarea.focus();
    }
    updateCountView();
  };

  const refresh = (focusTextarea = false) => {
    const query = inputEl?.value || '';
    matches = findTextMatches(textarea?.value || '', query);
    currentIndex = matches.length > 0 ? 0 : -1;
    if (currentIndex >= 0) {
      jumpTo(currentIndex, focusTextarea);
    } else {
      updateCountView();
    }
  };

  const step = (direction, focusTextarea = true) => {
    const query = inputEl?.value || '';
    if (!query) return;
    // テキストが外部変更されている可能性に備え再スキャン
    const latestMatches = findTextMatches(textarea?.value || '', query);
    if (latestMatches.length !== matches.length) {
      matches = latestMatches;
    }
    if (matches.length === 0) {
      currentIndex = -1;
      updateCountView();
      return;
    }
    const nextIdx = computeNextMatchIndex(currentIndex, matches.length, direction);
    jumpTo(nextIdx, focusTextarea);
  };

  inputEl?.addEventListener('input', () => refresh(false));
  inputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1, false);
    }
  });
  prevBtn?.addEventListener('click', () => step(-1, true));
  nextBtn?.addEventListener('click', () => step(1, true));

  return { refresh };
}

/**
 * <textarea> の左側に行番号ガターを連動表示する共通コントローラ
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} gutterEl
 * @returns {{ refresh: () => void }}
 */
export function attachTextareaLineNumbers(textarea, gutterEl) {
  let lastLineCount = -1;

  const refresh = () => {
    if (!textarea || !gutterEl) return;
    const text = textarea.value || '';
    const lineCount = text ? text.split('\n').length : 1;
    if (lineCount !== lastLineCount) {
      lastLineCount = lineCount;
      const lines = new Array(lineCount);
      for (let i = 0; i < lineCount; i++) {
        lines[i] = i + 1;
      }
      gutterEl.textContent = lines.join('\n');
    }
    gutterEl.scrollTop = textarea.scrollTop;
  };

  textarea?.addEventListener('input', refresh);
  textarea?.addEventListener('scroll', () => {
    if (gutterEl) {
      gutterEl.scrollTop = textarea.scrollTop;
    }
  });

  refresh();
  return { refresh };
}

