// 日本語コメント: ノート詳細ビューコンポーネント (src/components/note-view/note-view.js)
// v1に準拠した参照専用ビュー（Reader Mode）と編集モード（Edit Mode）の分離を提供します。
// 選択時は見やすいテキスト表示を行い、「✏️ 編集」クリック時のみリアルタイムバリデーション付きの入力フォームを表示します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';

export class DbeNoteView {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentNoteName = null;
    this.schemaName = '';
    this.isEditing = false; // false: Reader Mode, true: Edit Mode

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  /**
   * コンポーネント基本枠組みの生成
   */
  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-note-view';
    this.container.appendChild(this.element);
  }

  /**
   * ストア変更通知の登録
   */
  bindStore() {
    appStore.on('model:updated', () => {
      if (this.currentNoteName) {
        const note = (appStore.state.notes || []).find(n => n.name === this.currentNoteName);
        if (note && !this.isEditing) {
          this.renderContent();
        }
      }
    });
  }

  /**
   * グローバルイベントの登録 (Ctrl+S / Cmd+S 保存など)
   */
  bindEvents() {
    this.element.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (this.isEditing) {
          e.preventDefault();
          this.handleSave();
        }
      }
    });
  }

  /**
   * 指定ノートの表示更新（Reader Modeで初期化）
   * @param {string} noteName 
   * @param {string|null} schemaName 
   */
  update(noteName, schemaName = null) {
    this.currentNoteName = noteName;
    this.schemaName = schemaName || appStore.state.activeSchema || '';
    this.isEditing = false; // 常に参照専用ビューから開始

    this.renderContent();
  }

  /**
   * 現在のモード (Reader Mode または Edit Mode) に応じたコンテンツ描画
   */
  renderContent() {
    const note = (appStore.state.notes || []).find(n => n.name === this.currentNoteName);

    if (!note) {
      // ノートが存在しない場合は一覧へフォールバック
      this.element.innerHTML = `
        <div class="note-view-empty">
          <p>${t('note_view.not_found', { name: this.escapeHtml(this.currentNoteName || '') })}</p>
          <button type="button" class="primary" id="btn-note-empty-back">${t('note_view.btn_back')}</button>
        </div>
      `;
      const backBtn = this.element.querySelector('#btn-note-empty-back');
      if (backBtn) {
        backBtn.addEventListener('click', () => {
          appStore.emit('note:list:request', { schemaName: this.schemaName });
        });
      }
      return;
    }

    const noteRawContent = typeof note.value === 'string' ? note.value : (note.value?.value || '');

    if (!this.isEditing) {
      // ==========================================
      // ① 参照専用ビュー (Reader Mode)
      // ==========================================
      const displayContent = noteRawContent.trim() !== ''
        ? this.escapeHtml(noteRawContent)
        : `<span class="note-placeholder-text">${t('note_view.empty_body')}</span>`;

      this.element.innerHTML = `
        <div class="note-view-header">
          <div class="note-view-header-left">
            <button type="button" class="note-btn-back" id="btn-note-back">
              <span>←</span>
              <span>${t('note_view.btn_back')}</span>
            </button>
            <div class="note-view-title-area">
              <h2>
                <span class="icon">📝</span>
                <span class="note-title-name">${this.escapeHtml(note.name)}</span>
              </h2>
              <span class="badge note-schema-badge">🗄️ ${this.escapeHtml(this.schemaName)}</span>
            </div>
          </div>

          <div class="note-view-header-right">
            <button type="button" class="note-btn-action note-btn-edit" id="btn-note-edit-mode">
              <span>✏️</span>
              <span>${t('common.edit')}</span>
            </button>
            <button type="button" class="note-btn-action note-btn-delete" id="btn-note-delete">
              <span>🗑️</span>
              <span>${t('note_view.btn_delete')}</span>
            </button>
          </div>
        </div>

        <div class="note-view-body">
          <div class="note-card note-reader-card">
            <div class="note-reader-content">${displayContent}</div>
          </div>
        </div>
      `;

      // イベントバインド: 一覧に戻る
      this.element.querySelector('#btn-note-back').addEventListener('click', () => {
        appStore.emit('note:list:request', { schemaName: this.schemaName });
      });

      // イベントバインド: 編集モードへ移行
      this.element.querySelector('#btn-note-edit-mode').addEventListener('click', () => {
        this.isEditing = true;
        this.renderContent();
      });

      // イベントバインド: 削除
      this.element.querySelector('#btn-note-delete').addEventListener('click', () => {
        this.handleDelete();
      });

    } else {
      // ==========================================
      // ② 編集モード (Edit Mode)
      // ==========================================
      this.element.innerHTML = `
        <div class="note-view-header">
          <div class="note-view-header-left">
            <button type="button" class="note-btn-back" id="btn-note-cancel">
              <span>${t('common.cancel')}</span>
            </button>
            <div class="note-view-title-area">
              <h2>
                <span class="icon">✏️</span>
                <span class="note-title-name">${t('note_view.title_edit', { name: this.escapeHtml(note.name) })}</span>
              </h2>
              <span class="badge note-schema-badge">🗄️ ${this.escapeHtml(this.schemaName)}</span>
            </div>
          </div>

          <div class="note-view-header-right">
            <button type="button" class="note-btn-action note-btn-save primary" id="btn-note-save">
              <span>💾</span>
              <span>${t('note_view.btn_apply')}</span>
            </button>
          </div>
        </div>

        <div class="note-view-body">
          <div class="note-card note-form-card">
            <div class="note-form-field">
              <label for="note-edit-name">${t('note_view.label_name')} <span class="required-mark">*</span></label>
              <input type="text" class="note-form-input" id="note-edit-name" value="${this.escapeHtml(note.name)}" />
              <div class="note-error-msg" id="note-name-error" style="display: none;"></div>
            </div>

            <div class="note-form-field" style="flex: 1; display: flex; flex-direction: column;">
              <label for="note-edit-content">${t('note_view.label_content')}</label>
              <textarea class="note-form-textarea" id="note-edit-content" placeholder="${t('note_view.placeholder_content')}">${this.escapeHtml(noteRawContent)}</textarea>
            </div>
          </div>
        </div>
      `;

      const cancelBtn = this.element.querySelector('#btn-note-cancel');
      const saveBtn = this.element.querySelector('#btn-note-save');
      const nameInput = this.element.querySelector('#note-edit-name');
      const contentTextarea = this.element.querySelector('#note-edit-content');
      const errorMsgEl = this.element.querySelector('#note-name-error');

      // キャンセル
      cancelBtn.addEventListener('click', () => {
        this.isEditing = false;
        this.renderContent();
      });

      // リアルタイムバリデーション
      const validate = () => {
        const val = nameInput.value.trim();
        let errMsg = '';

        if (!val) {
          errMsg = t('note_modal.err_name_required');
        } else {
          // 重複チェック
          const isDuplicate = (appStore.state.notes || []).some(n => {
            if (n.name === this.currentNoteName) return false;
            return n.name.toLowerCase() === val.toLowerCase();
          });
          if (isDuplicate) {
            errMsg = t('note_modal.err_duplicate', { name: val });
          }
        }

        if (errMsg) {
          errorMsgEl.textContent = errMsg;
          errorMsgEl.style.display = 'block';
          nameInput.classList.add('input-error');
          saveBtn.disabled = true;
          return false;
        } else {
          errorMsgEl.textContent = '';
          errorMsgEl.style.display = 'none';
          nameInput.classList.remove('input-error');
          saveBtn.disabled = false;
          return true;
        }
      };

      nameInput.addEventListener('input', validate);

      // 保存
      saveBtn.addEventListener('click', async () => {
        if (!validate()) return;
        await this.handleSave(nameInput.value.trim(), contentTextarea.value);
      });

      nameInput.focus();
    }
  }

  /**
   * 保存処理
   */
  async handleSave(newName, newContent) {
    if (!newName) return;

    const currentNotes = [...(appStore.state.notes || [])];

    // 重複チェック
    const isDuplicate = currentNotes.some(n => {
      if (n.name === this.currentNoteName) return false;
      return n.name.toLowerCase() === newName.toLowerCase();
    });

    if (isDuplicate) {
      // 日本語コメント: 重複エラーアラートの多言語化
      alert(t('note_modal.err_duplicate', { name: newName }));
      return;
    }

    const updatedNotes = currentNotes.map(n => {
      if (n.name === this.currentNoteName) {
        return { name: newName, value: newContent };
      }
      return n;
    });

    try {
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: appStore.state.tableGroups,
        notes: updatedNotes,
        refs: appStore.state.refs,
      });

      await projectService.saveProject();

      this.currentNoteName = newName;
      this.isEditing = false;
      this.renderContent();

      // 日本語コメント: ノート保存完了ステータスメッセージの多言語化
      appStore.emit('status:message', t('note_view.saved_message'));
    } catch (err) {
      console.error('ノート保存エラー:', err);
      // 日本語コメント: ノート保存失敗アラートの多言語化
      alert(t('note_view.alert_save_failed', { error: err.message || err }));
    }
  }

  /**
   * 削除処理
   */
  async handleDelete() {
    if (!this.currentNoteName) return;
    // 日本語コメント: ノート削除確認ダイアログの多言語化
    const msg = t('note_list.delete_confirm', { name: this.currentNoteName });
    if (!confirm(msg)) return;

    const updatedNotes = (appStore.state.notes || []).filter(n => n.name !== this.currentNoteName);

    try {
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: appStore.state.tableGroups,
        notes: updatedNotes,
        refs: appStore.state.refs,
      });

      await projectService.saveProject();
      // 日本語コメント: ノート削除完了ステータスメッセージの多言語化
      appStore.emit('status:message', t('note_view.status_deleted', { name: this.currentNoteName }));
      appStore.emit('note:list:request', { schemaName: this.schemaName });
    } catch (err) {
      console.error('ノート削除エラー:', err);
      // 日本語コメント: ノート削除失敗アラートの多言語化
      alert(t('note_view.alert_delete_failed', { error: err.message || err }));
    }
  }

  /**
   * HTMLエスケープヘルパー
   */
  escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
