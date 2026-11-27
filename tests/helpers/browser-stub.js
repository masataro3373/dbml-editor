// 日本語コメント: Node.js 上でクライアント側コアロジックを実行するための最小ブラウザ環境スタブ

/**
 * 日本語コメント: localStorage / window 等が存在しない Node.js 環境向けに安全なスタブを設定
 */
export function ensureBrowserStubs() {
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, val) => { store.set(key, String(val)); },
      removeItem: (key) => { store.delete(key); },
      clear: () => { store.clear(); },
    };
  }
}
