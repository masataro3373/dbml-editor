// 日本語コメント: 新規ノート作成モーダル (src/components/note-modal/note-modal.js)
// スキーマ配下に新しい独立した Note を作成・保存します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import './note-modal.css';

export class NoteModal {
  constructor(container = document.body) {
    this.container = container;
    this.element = null;
    this.targetSchema = null;

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'note-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="note-modal-title">
        <div class="dbe-modal-header">
          <h3 id="note-modal-title">
            <span>📝</span>
            <span id="note-modal-title-text">${t('note_modal.title_new')}</span>
          </h3>
          <button type="button" class="dbe-modal-close" id="btn-close-note-modal" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <div class="dbe-form-field">
            <label for="note-input-name">
              ${t('note_modal.note_name')}
              <span class="dbe-required-mark">*</span>
            </label>
            <input type="text" id="note-input-name" placeholder="architecture_overview / conventions..." />
          </div>
          <div class="dbe-form-error" id="note-form-error" style="display: none;" role="alert"></div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-note-modal">
            ${t('common.cancel')}
          </button>
          <button type="button" class="primary" id="btn-save-note-modal">
            ${t('common.add')}
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // 閉じるボタン
    this.element.querySelector('#btn-close-note-modal').addEventListener('click', () => this.close());
    this.element.querySelector('#btn-cancel-note-modal').addEventListener('click', () => this.close());

    // 入力時のエラークリア・Enterキー送信
    const nameInput = this.element.querySelector('#note-input-name');
    nameInput?.addEventListener('input', () => this.setError(''));
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSave();
      }
    });

    // 保存ボタン
    this.element.querySelector('#btn-save-note-modal').addEventListener('click', () => {
      this.handleSave();
    });

    // Escapeキーで閉じる
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  /**
   * モーダル内エラー表示制御
   * @param {string} message
   */
  setError(message) {
    const errorBox = this.element.querySelector('#note-form-error');
    if (!errorBox) return;
    if (message) {
      errorBox.textContent = message;
      errorBox.style.display = 'block';
    } else {
      errorBox.textContent = '';
      errorBox.style.display = 'none';
    }
  }

  /**
   * モーダルを開く
   * @param {string|null} schemaName 
   */
  open(schemaName = null) {
    this.targetSchema = schemaName || appStore.state.activeSchema;

    const nameInput = this.element.querySelector('#note-input-name');
    const saveBtn = this.element.querySelector('#btn-save-note-modal');

    nameInput.value = '';
    this.setError('');
    if (saveBtn) saveBtn.disabled = false;

    this.element.style.display = 'flex';
    nameInput.focus();
  }

  close() {
    this.element.style.display = 'none';
    this.targetSchema = null;
    this.setError('');
  }

  async handleSave() {
    const nameInput = this.element.querySelector('#note-input-name');
    const saveBtn = this.element.querySelector('#btn-save-note-modal');
    const noteName = nameInput.value.trim();

    if (!noteName) {
      this.setError(t('note_modal.err_name_required'));
      nameInput.focus();
      return;
    }

    const currentNotes = [...(appStore.state.notes || [])];

    // 重複チェック
    const isDuplicate = currentNotes.some(n => n.name.toLowerCase() === noteName.toLowerCase());
    if (isDuplicate) {
      this.setError(t('note_modal.err_duplicate', { name: noteName }));
      nameInput.focus();
      return;
    }

    const newNote = {
      name: noteName,
      value: '',
    };

    const updatedNotes = [...currentNotes, newNote];

    if (saveBtn) saveBtn.disabled = true;
    try {
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: appStore.state.tableGroups,
        notes: updatedNotes,
        refs: appStore.state.refs,
      });

      await projectService.saveProject();

      appStore.emit('note:created', newNote);
      appStore.emit('note:select', { noteName: newNote.name, schemaName: this.targetSchema });

      this.close();
    } catch (err) {
      console.error('Note作成エラー:', err);
      this.setError(t('note_modal.err_save_failed', { message: err.message || err }));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
}
