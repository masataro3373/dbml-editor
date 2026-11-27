// 日本語コメント: 編集データの変更履歴（Undo / Redo）を管理する状態管理クラス (src/core/draft-manager.js)
// フォーム側でデータを直接書き換えて pushHistory() を呼び出す設計に適合しています。

export class DraftManager {
  /**
   * @param {Object} initialData - 初期状態のデータオブジェクト
   */
  constructor(initialData) {
    // 履歴管理用の配列。各履歴エントリはディープコピーで保存
    this._history = [this._deepCopy(initialData)];
    this._currentIndex = 0;
    // 現在編集中・参照中の実データオブジェクト (直接参照)
    this._currentData = initialData;
  }

  /**
   * 現在のデータオブジェクト（直接の参照）を取得します
   * @returns {Object} 現在のデータ
   */
  getData() {
    return this._currentData;
  }

  /**
   * 現在のデータ状態を履歴スタックに保存します
   */
  pushHistory() {
    // 現在のインデックスより後ろの履歴（Redo履歴）を破棄
    this._history = this._history.slice(0, this._currentIndex + 1);
    // 現在のデータ状態のコピーを履歴に積む
    this._history.push(this._deepCopy(this._currentData));
    this._currentIndex++;
  }

  /**
   * 1つ前の履歴に戻します
   * @returns {Object|null} 戻した後のデータ（履歴がない場合はnull）
   */
  undo() {
    if (!this.canUndo()) return null;
    
    this._currentIndex--;
    // 履歴から1つ前の状態をディープコピーして現在の編集データに上書き
    this._currentData = this._deepCopy(this._history[this._currentIndex]);
    return this._currentData;
  }

  /**
   * 1つ先の履歴に進めます
   * @returns {Object|null} 進めた後のデータ（履歴がない場合はnull）
   */
  redo() {
    if (!this.canRedo()) return null;
    
    this._currentIndex++;
    // 履歴から1つ先の状態をディープコピーして現在の編集データに上書き
    this._currentData = this._deepCopy(this._history[this._currentIndex]);
    return this._currentData;
  }

  /**
   * Undoが可能かどうかを判定します
   * @returns {boolean}
   */
  canUndo() {
    return this._currentIndex > 0;
  }

  /**
   * Redoが可能かどうかを判定します
   * @returns {boolean}
   */
  canRedo() {
    return this._currentIndex < this._history.length - 1;
  }

  /**
   * オブジェクトのディープコピーを作成するヘルパー
   * @private
   */
  _deepCopy(obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      console.error('ディープコピーに失敗しました:', e);
      return obj;
    }
  }
}
