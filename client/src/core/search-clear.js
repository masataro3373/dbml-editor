// 日本語コメント: 検索・フィルタ入力欄の右端「×」クリアボタン共通制御ヘルパー (src/core/search-clear.js)

/**
 * 検索/フィルタ入力欄とクリアボタンの連動イベントを登録します。
 * @param {HTMLInputElement|null} inputEl - 対象のテキストボックス
 * @param {HTMLButtonElement|null} clearBtn - 右端の「×」クリアボタン
 * @param {Object} [options]
 * @param {boolean} [options.clearOnEscape=true] - Escapeキー押下時に入力中ならクリアするか
 * @param {Function} [options.onClear] - クリア後に追加で実行するコールバック
 */
export function bindSearchClear(inputEl, clearBtn, { clearOnEscape = true, onClear } = {}) {
  if (!inputEl || !clearBtn) return;

  const syncVisibility = () => {
    clearBtn.style.display = inputEl.value.length > 0 ? 'flex' : 'none';
  };

  const executeClear = () => {
    inputEl.value = '';
    syncVisibility();
    // 日本語コメント: 各画面の既存 input リスナーを発火させて絞り込み・検索結果をリセットする
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    if (typeof onClear === 'function') {
      onClear();
    }
    inputEl.focus();
  };

  syncVisibility();
  inputEl.addEventListener('input', syncVisibility);
  clearBtn.addEventListener('click', executeClear);

  if (clearOnEscape) {
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && inputEl.value.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        executeClear();
      }
    });
  }
}
