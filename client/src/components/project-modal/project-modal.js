// 日本語コメント: プロジェクト設定モーダル (src/components/project-modal/project-modal.js)
// プロジェクト全体のメタ情報 (プロジェクト名、バージョン番号、説明) を編集し、project.json に同期します。
// ※ テーブルスペース (表領域) などの物理情報はスキーマ単位で管理するため、ここには含めません。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import './project-modal.css';

export class ProjectModal {
  constructor(container = document.body) {
    this.container = container;
    this.element = null;

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'project-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--medium" role="dialog" aria-modal="true" aria-labelledby="project-modal-title">
        <div class="dbe-modal-header">
          <h3 id="project-modal-title">
            <span>⚙️</span>
            <span>${t('project_modal.title')}</span>
          </h3>
          <button type="button" class="dbe-modal-close" id="btn-close-project-modal" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <div class="dbe-form-row">
            <div class="dbe-form-field" style="flex: 2;">
              <label for="proj-input-name">${t('project_modal.project_name')}</label>
              <input type="text" id="proj-input-name" placeholder="${t('project_modal.placeholder_name')}" />
            </div>
            <div class="dbe-form-field" style="flex: 1;">
              <label for="proj-input-version">${t('project_modal.version')}</label>
              <input type="text" id="proj-input-version" placeholder="1.0.0" />
            </div>
          </div>

          <div class="dbe-form-field">
            <label for="proj-input-desc">${t('project_modal.description')}</label>
            <textarea id="proj-input-desc" rows="3" placeholder="${t('project_modal.placeholder_description')}"></textarea>
          </div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-project-modal">${t('common.cancel')}</button>
          <button type="button" class="primary" id="btn-save-project-modal">${t('common.save')}</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    const closeBtn = this.element.querySelector('#btn-close-project-modal');
    const cancelBtn = this.element.querySelector('#btn-cancel-project-modal');
    const saveBtn = this.element.querySelector('#btn-save-project-modal');

    const handleClose = () => this.hide();

    closeBtn?.addEventListener('click', handleClose);
    cancelBtn?.addEventListener('click', handleClose);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.style.display !== 'none') {
        handleClose();
      }
    });

    saveBtn?.addEventListener('click', () => {
      this.saveChanges();
    });
  }

  show() {
    const projectMeta = appStore.state.projectMeta || {};
    const info = projectMeta.info || {};

    const nameInput = this.element.querySelector('#proj-input-name');
    const versionInput = this.element.querySelector('#proj-input-version');
    const descInput = this.element.querySelector('#proj-input-desc');

    if (nameInput) nameInput.value = info.name || 'Project';
    if (versionInput) versionInput.value = info.version || '1.0.0';
    if (descInput) descInput.value = info.description || '';

    this.element.style.display = 'flex';
    nameInput?.focus();
  }

  hide() {
    this.element.style.display = 'none';
  }

  async saveChanges() {
    const nameInput = this.element.querySelector('#proj-input-name');
    const versionInput = this.element.querySelector('#proj-input-version');
    const descInput = this.element.querySelector('#proj-input-desc');

    const newName = nameInput ? nameInput.value.trim() : '';
    const newVersion = versionInput ? versionInput.value.trim() : '1.0.0';
    const newDesc = descInput ? descInput.value.trim() : '';

    if (!appStore.state.projectMeta) {
      this.hide();
      return;
    }

    try {
      appStore.state.projectMeta.info = {
        ...(appStore.state.projectMeta.info || {}),
        name: newName || 'Project',
        version: newVersion,
        description: newDesc,
      };

      appStore.state.projectMeta.meta = {
        ...(appStore.state.projectMeta.meta || {}),
        updatedAt: new Date().toISOString(),
      };

      appStore.emit('projectMeta:updated', appStore.state.projectMeta);

      // サーバーへ一括保存
      await projectService.saveProject();
      appStore.emit('status:message', t('project_modal.saved_message'));
      this.hide();
    } catch (err) {
      alert(t('project_modal.err_save_failed', { message: err.message }));
    }
  }
}
