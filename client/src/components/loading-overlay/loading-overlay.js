// 日本語コメント: ローディング/プログレス表示コンポーネント (src/components/loading-overlay/loading-overlay.js)
// Shadow DOM は使用せず、Light DOM で全画面オーバーレイおよびスピナー/進捗バーをレンダリングします。
// AppStore の loading 状態変更イベントを購読して自動的に描画を更新します。

import { appStore } from '../../core/store.js';
import { t } from '../../core/i18n.js';

export class LoadingOverlay {
  /**
   * @param {HTMLElement} container - マウント先要素
   */
  constructor(container) {
    this.container = container;
    this.element = null;
    this.messageEl = null;
    this.progressContainerEl = null;
    this.progressBarEl = null;
    this.progressTextEl = null;

    this.render();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'loading-overlay';

    this.element.innerHTML = `
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-message"></div>
        <div class="loading-progress-container" style="display: none;">
          <div class="loading-progress-track">
            <div class="loading-progress-bar"></div>
          </div>
          <div class="loading-progress-text"></div>
        </div>
      </div>
    `;

    this.messageEl = this.element.querySelector('.loading-message');
    this.progressContainerEl = this.element.querySelector('.loading-progress-container');
    this.progressBarEl = this.element.querySelector('.loading-progress-bar');
    this.progressTextEl = this.element.querySelector('.loading-progress-text');

    this.container.appendChild(this.element);
  }

  bindStore() {
    appStore.on('loading:changed', ({ active, message, progress }) => {
      if (active) {
        this.show(message, progress);
      } else {
        this.hide();
      }
    });
  }

  /**
   * ローディングオーバーレイの表示および進捗バー更新
   * @param {string} [message] - 表示メッセージ
   * @param {number|null} [progress] - 0〜100 のパーセンテージ（null の場合はスピナーのみ）
   */
  show(message, progress) {
    // 日本語コメント: message が指定されている場合は確実に更新。空文字の場合はデフォルト待機文言へフォールバック
    const text = message !== undefined && message !== null && message !== '' 
      ? message 
      : (this.messageEl.textContent || t('loading.default_wait'));
    this.messageEl.textContent = text;

    // 日本語コメント: 数値進捗が指定された場合はプログレスバーと%表示を更新
    if (typeof progress === 'number') {
      const clamped = Math.max(0, Math.min(100, Math.round(progress)));
      this.progressContainerEl.style.display = 'flex';
      this.progressBarEl.style.width = `${clamped}%`;
      this.progressTextEl.textContent = `${clamped}%`;
    } else {
      this.progressContainerEl.style.display = 'none';
    }

    this.element.classList.add('active');
  }

  hide() {
    this.element.classList.remove('active');
  }
}
