// 日本語コメント: 個人設定モーダルコンポーネント (src/components/settings-modal/settings-modal.js)
// ユーザー名メニューから起動し、言語やテーマなどの個人設定を管理します。
// 将来的な設定項目の増加にも柔軟に対応できるセクション構造を持ち、Light DOM で動作します。

import { t, getLocale, setLocale } from '../../core/i18n.js';
import { setTheme, getTheme, THEME_LIST } from '../../core/theme.js';
import { clientConfigService } from '../../core/config-service.js';
import { appStore } from '../../core/store.js';
import './settings-modal.css';

export class SettingsModal {
  constructor(container = document.body) {
    this.container = container;
    this.element = null;
    this.initialTheme = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'settings-modal-overlay';
    this.element.style.display = 'none';

    const currentLang = getLocale();
    const currentTheme = getTheme(clientConfigService.defaultTheme);

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--medium" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="dbe-modal-header">
          <h3 id="settings-title">
            <span>⚙️</span>
            <span>${t('settingsModal.title')}</span>
          </h3>
          <button type="button" class="dbe-modal-close" id="btn-close-settings" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <!-- セクション: 表示・外観設定 -->
          <div class="dbe-settings-section">
            <div class="dbe-settings-section-title">${t('settingsModal.sectionAppearance')}</div>

            <!-- 表示言語設定 -->
            <div class="dbe-settings-item">
              <div class="dbe-settings-item-header">
                <label class="dbe-settings-label" for="setting-lang">${t('settingsModal.labelLang')}</label>
              </div>
              <div class="dbe-settings-desc">${t('settingsModal.descLang')}</div>
              <select class="dbe-settings-select" id="setting-lang">
                <option value="ja" ${currentLang === 'ja' ? 'selected' : ''}>${t('settingsModal.langJa')}</option>
                <option value="en" ${currentLang === 'en' ? 'selected' : ''}>${t('settingsModal.langEn')}</option>
              </select>
            </div>

            <!-- カラーテーマ設定 -->
            <div class="dbe-settings-item">
              <div class="dbe-settings-item-header">
                <label class="dbe-settings-label" for="setting-theme">${t('settingsModal.labelTheme')}</label>
              </div>
              <div class="dbe-settings-desc">${t('settingsModal.descTheme')}</div>
              <select class="dbe-settings-select" id="setting-theme">
                ${THEME_LIST.map(item => `<option value="${item.id}" ${currentTheme === item.id ? 'selected' : ''}>${t(item.labelKey)}</option>`).join('')}
              </select>
            </div>
          </div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-settings">${t('settingsModal.btnCancel')}</button>
          <button type="button" class="primary" id="btn-save-settings">${t('settingsModal.btnSave')}</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    const closeBtn = this.element.querySelector('#btn-close-settings');
    const cancelBtn = this.element.querySelector('#btn-cancel-settings');
    const saveBtn = this.element.querySelector('#btn-save-settings');
    const themeSelectEl = this.element.querySelector('#setting-theme');

    // 日本語コメント: セレクト変更時にリアルタイムプレビューを適用
    themeSelectEl?.addEventListener('change', (e) => {
      if (e.target.value) {
        setTheme(e.target.value, { persist: false });
      }
    });

    const handleCancelClose = () => {
      if (this.initialTheme) {
        setTheme(this.initialTheme, { persist: false });
      }
      this.hide();
    };

    closeBtn?.addEventListener('click', handleCancelClose);
    cancelBtn?.addEventListener('click', handleCancelClose);

    // ESCキーで閉じる
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.style.display !== 'none') {
        handleCancelClose();
      }
    });

    // 保存ボタン
    saveBtn?.addEventListener('click', () => {
      const langSelect = this.element.querySelector('#setting-lang');
      const themeSelect = this.element.querySelector('#setting-theme');

      const newLang = langSelect?.value;
      const newTheme = themeSelect?.value;
      const prevLang = getLocale();

      if (newTheme) {
        setTheme(newTheme, { persist: true });
        this.initialTheme = newTheme;
      }

      this.hide();

      if (newLang && newLang !== prevLang) {
        setLocale(newLang);
        // 言語切替時はリソース再読込のためリロード
        window.location.reload();
      }
    });
  }

  bindStore() {
    appStore.on('settings:open:request', () => {
      this.show();
    });
  }

  show() {
    // 現在の値をセレクトボックスに反映
    const currentLang = getLocale();
    const currentTheme = getTheme(clientConfigService.defaultTheme);
    this.initialTheme = currentTheme;

    const langSelect = this.element.querySelector('#setting-lang');
    if (langSelect) langSelect.value = currentLang;

    const themeSelect = this.element.querySelector('#setting-theme');
    if (themeSelect) themeSelect.value = currentTheme;

    this.element.style.display = 'flex';
  }

  hide() {
    if (this.element) {
      this.element.style.display = 'none';
    }
  }
}
