// 日本語コメント: 認証モーダルコンポーネント (src/components/auth-modal/auth-modal.js)
// Shadow DOM は使わず Light DOM でログインフォームを表示します。
// すべての文言は i18n.t() 経由で取得し、ハードコードを排除しています。

import { authManager } from '../../core/auth.js';
import { t } from '../../core/i18n.js';
import { logger } from '../../core/logger.js';

export class AuthModal {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.form = null;
    this.usernameInput = null;
    this.passwordInput = null;
    this.errorEl = null;
    this.submitBtn = null;
    this.authMode = 'local';

    this.render();
  }

  async init() {
    const config = await authManager.getAuthConfig();
    this.authMode = config.authMode || 'local';
    this.updateModeUI();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'auth-modal-backdrop';

    this.element.innerHTML = `
      <div class="auth-modal-dialog">
        <div class="auth-modal-header">
          <h2>${t('app.title')}</h2>
          <p>${t('app.subtitle')}</p>
        </div>

        <div class="auth-error-message"></div>

        <form class="auth-form" id="auth-form">
          <div class="auth-form-field">
            <label for="auth-username">${t('auth.username_label')}</label>
            <input type="text" id="auth-username" autocomplete="username" required />
          </div>

          <div class="auth-form-field">
            <label for="auth-password">${t('auth.password_label')}</label>
            <input type="password" id="auth-password" autocomplete="current-password" required />
          </div>

          <button type="submit" class="primary auth-modal-btn" id="auth-submit-btn">
            ${t('auth.login_button')}
          </button>
        </form>

        <div id="oauth-container" style="display: none;">
          <button type="button" class="primary auth-modal-btn" id="oauth-submit-btn">
            ${t('auth.oauth_button')}
          </button>
        </div>
      </div>
    `;

    this.usernameInput = this.element.querySelector('#auth-username');
    this.passwordInput = this.element.querySelector('#auth-password');
    this.errorEl = this.element.querySelector('.auth-error-message');
    this.submitBtn = this.element.querySelector('#auth-submit-btn');

    this.form = this.element.querySelector('#auth-form');
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    this.container.appendChild(this.element);
  }

  updateModeUI() {
    const form = this.element.querySelector('#auth-form');
    const oauthContainer = this.element.querySelector('#oauth-container');

    if (this.authMode === 'oauth') {
      form.style.display = 'none';
      oauthContainer.style.display = 'block';
    } else {
      form.style.display = 'flex';
      oauthContainer.style.display = 'none';
    }
  }

  show({ immediate = false } = {}) {
    this.clearError();
    // 日本語コメント: 再表示時に前回の入力値が残らないよう初期化
    this.form?.reset();
    if (this.usernameInput) this.usernameInput.value = '';
    if (this.passwordInput) this.passwordInput.value = '';
    this.element.classList.toggle('no-transition', Boolean(immediate));
    this.element.classList.add('active');
    if (immediate) {
      // 日本語コメント: 初回表示時のトランジション無効化を1フレーム後に解除し、以降のフェードアウトを滑らかにする
      requestAnimationFrame(() => {
        this.element?.classList.remove('no-transition');
      });
    }
    setTimeout(() => {
      if (this.usernameInput && this.authMode === 'local') {
        this.usernameInput.focus();
      }
    }, 100);
  }

  hide() {
    // 日本語コメント: ログイン成功後の非表示時に入力値とフォーカスをクリアし、ブラウザのパスワード確認ポップアップ誤再表示を防止
    this.usernameInput?.blur();
    this.passwordInput?.blur();
    this.form?.reset();
    if (this.usernameInput) this.usernameInput.value = '';
    if (this.passwordInput) this.passwordInput.value = '';
    this.clearError();
    this.element.classList.remove('no-transition');
    this.element.classList.remove('active');
  }

  showError(messageKey) {
    this.errorEl.textContent = t(messageKey);
    this.errorEl.classList.add('active');
  }

  clearError() {
    this.errorEl.textContent = '';
    this.errorEl.classList.remove('active');
  }

  async handleSubmit(e) {
    e.preventDefault();
    this.clearError();

    const username = this.usernameInput.value.trim();
    const password = this.passwordInput.value;

    if (!username || !password) return;

    this.submitBtn.disabled = true;
    this.submitBtn.textContent = t('auth.logging_in');

    try {
      const result = await authManager.login(username, password);
      if (result.success) {
        this.hide();
      } else {
        this.showError(result.errorKey);
      }
    } catch (err) {
      logger.error('AuthModal', 'ログイン処理例外', err);
      this.showError('auth.error_internal');
    } finally {
      this.submitBtn.disabled = false;
      this.submitBtn.textContent = t('auth.login_button');
    }
  }
}
