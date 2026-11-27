// 日本語コメント: 新規ER図作成モーダル (client/src/components/erd-modal/erd-modal.js)
// ユーザーからのER図名・説明入力を受け付け、新規ERDを作成・登録します。

import { t } from '../../core/i18n.js';
import { projectService } from '../../core/project-service.js';
import './erd-modal.css';

export class ErdModal {
  constructor(container = document.body) {
    this.container = container;
    this.element = null;
    this.onCreatedCallback = null;

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'erd-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="erd-modal-title">
        <div class="dbe-modal-header">
          <h3 id="erd-modal-title">
            <span>🗺️</span>
            <span>${t('erd_modal.title_create')}</span>
          </h3>
          <button type="button" class="dbe-modal-close" id="btn-close-erd-modal" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <div class="dbe-form-field">
            <label for="erd-input-name">${t('erd_modal.label_name')} <span class="dbe-required-mark">*</span></label>
            <input type="text" id="erd-input-name" placeholder="${t('erd_modal.placeholder_name')}" />
          </div>
          <div class="dbe-form-error" id="erd-form-error" style="display: none;" role="alert"></div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-erd-modal">${t('common.cancel')}</button>
          <button type="button" class="primary" id="btn-submit-erd-modal">${t('erd_modal.btn_create')}</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    const btnClose = this.element.querySelector('#btn-close-erd-modal');
    const btnCancel = this.element.querySelector('#btn-cancel-erd-modal');
    const btnSubmit = this.element.querySelector('#btn-submit-erd-modal');

    const handleClose = () => this.hide();
    btnClose.addEventListener('click', handleClose);
    btnCancel.addEventListener('click', handleClose);

    const nameInput = this.element.querySelector('#erd-input-name');
    nameInput?.addEventListener('input', () => this.setError(''));
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        btnSubmit.click();
      }
    });

    btnSubmit.addEventListener('click', async () => {
      const name = nameInput.value.trim();

      if (!name) {
        this.setError(t('erd_modal.err_name_required'));
        nameInput.focus();
        return;
      }

      this.setError('');
      btnSubmit.disabled = true;
      try {
        const erdEntry = await projectService.createErd({ name, description: '' });
        this.hide();
        if (typeof this.onCreatedCallback === 'function') {
          this.onCreatedCallback(erdEntry);
        }
      } catch (err) {
        this.setError(t('erd_modal.err_create_failed', { message: err.message || err }));
      } finally {
        btnSubmit.disabled = false;
      }
    });

    // Escape キーで閉じる
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    });
  }

  /**
   * モーダル内エラー表示制御
   * @param {string} message
   */
  setError(message) {
    const errorBox = this.element.querySelector('#erd-form-error');
    if (!errorBox) return;
    if (message) {
      errorBox.textContent = message;
      errorBox.style.display = 'block';
    } else {
      errorBox.textContent = '';
      errorBox.style.display = 'none';
    }
  }

  show(onCreated = null) {
    this.onCreatedCallback = onCreated;
    const nameInput = this.element.querySelector('#erd-input-name');
    const btnSubmit = this.element.querySelector('#btn-submit-erd-modal');
    nameInput.value = t('erd_modal.default_erd_name');
    this.setError('');
    if (btnSubmit) btnSubmit.disabled = false;
    this.element.style.display = 'flex';
    nameInput.focus();
    nameInput.select();
  }

  hide() {
    this.element.style.display = 'none';
    this.setError('');
  }
}
