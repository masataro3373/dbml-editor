// 日本語コメント: スキーマ設定モーダル (src/components/schema-modal/schema-modal.js)
// スキーマ単位のプロジェクトメタデータ (バージョン、DBMS方言、Note、およびプラグイン動的属性) の編集モーダルです。
// 方言に依存する物理属性 (Oracle 表領域等) は metadataManager から動的に生成されます。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { dialectManager } from '../../dialects/index.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { escapeHtml } from '../../core/html-utils.js';
import './schema-modal.css';

/**
 * カンマ区切り文字列を配列に変換
 */
function parseListInput(str) {
  if (!str) return [];
  return str.split(/[,、]/).map(s => s.trim().toUpperCase()).filter(Boolean);
}

/**
 * 配列をカンマ区切り文字列に変換
 */
function formatListOutput(arr) {
  if (!arr) return '';
  if (Array.isArray(arr)) return arr.join(', ');
  return String(arr);
}

export class SchemaModal {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.targetSchemaName = null;

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'schema-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--wide" role="dialog" aria-modal="true" aria-labelledby="schema-modal-title-text">
        <div class="dbe-modal-header">
          <h3 id="schema-modal-title-text">${t('schema_modal.title', { name: '' })}</h3>
          <button type="button" class="dbe-modal-close" id="btn-close-schema-modal" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <div class="dbe-form-row">
            <div class="dbe-form-field" style="flex: 1;">
              <label for="schema-input-version">${t('schema_modal.version')}</label>
              <input type="text" id="schema-input-version" placeholder="1.0.0" />
            </div>
            <div class="dbe-form-field" style="flex: 1.5;">
              <label for="schema-input-dbms">${t('schema_modal.database_type')}</label>
              <select id="schema-input-dbms"></select>
            </div>
          </div>

          <!-- プラグイン動的 Project 属性コンテナ (Oracle 表領域など) -->
          <div id="schema-project-attributes-container"></div>

          <!-- 任意カスタム設定項目セクション -->
          <div class="dbe-form-field">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <label style="margin: 0;">${t('schema_modal.custom_settings_title')}</label>
              <button type="button" class="secondary" id="btn-add-custom-attr" style="padding: 0.25rem 0.6rem; font-size: 0.78rem;">
                ${t('schema_modal.btn_add_custom_attr')}
              </button>
            </div>
            <div id="schema-custom-attributes-list" style="display: flex; flex-direction: column; gap: 0.5rem;"></div>
          </div>

          <div class="dbe-form-field">
            <label for="schema-input-note">${t('schema_modal.note')}</label>
            <textarea id="schema-input-note" rows="2" placeholder="${t('schema_modal.placeholder_note')}"></textarea>
          </div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-schema-modal">${t('common.cancel')}</button>
          <button type="button" class="primary" id="btn-save-schema-modal">${t('common.save')}</button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  /**
   * 選択中の DBMS 方言に応じた動的 Project 属性入力フォームを描画
   */
  renderDynamicAttributes(dialectId, currentCustom = {}) {
    const container = this.element.querySelector('#schema-project-attributes-container');
    if (!container) return;
    container.innerHTML = '';

    const attrs = metadataManager.getProjectAttributes(dialectId);
    if (!attrs || attrs.length === 0) return;

    for (const attr of attrs) {
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'dbe-schema-field';

      const labelText = metadataManager.resolveLabel(attr);
      const hintText = metadataManager.resolveHint(attr);
      const inputId = `schema-dynamic-input-${attr.key}`;

      const rawVal = currentCustom[attr.key] !== undefined
        ? currentCustom[attr.key]
        : (currentCustom[this._snakeToCamel(attr.key)] || '');
      const displayVal = attr.type === 'list' ? formatListOutput(rawVal) : String(rawVal || '');

      fieldDiv.innerHTML = `
        <label for="${escapeHtml(inputId)}">${escapeHtml(labelText)}</label>
        ${hintText ? `<span class="field-hint">${escapeHtml(hintText)}</span>` : ''}
        ${attr.type === 'list' || attr.type === 'textarea'
          ? `<textarea class="dbe-schema-textarea" id="${escapeHtml(inputId)}" rows="2" data-key="${escapeHtml(attr.key)}" data-type="${escapeHtml(attr.type)}">${escapeHtml(displayVal)}</textarea>`
          : `<input type="text" class="dbe-schema-input" id="${escapeHtml(inputId)}" data-key="${escapeHtml(attr.key)}" value="${escapeHtml(displayVal)}" />`
        }
      `;

      container.appendChild(fieldDiv);
    }
  }

  /**
   * 任意カスタム設定項目リストの描画
   */
  renderCustomAttributes(dialectId, currentCustom = {}) {
    const listContainer = this.element.querySelector('#schema-custom-attributes-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    const attrs = metadataManager.getProjectAttributes(dialectId) || [];
    const handledKeys = new Set(['version']);
    attrs.forEach(a => {
      handledKeys.add(a.key);
      handledKeys.add(this._snakeToCamel(a.key));
    });

    const seenNormalized = new Set();
    Object.entries(currentCustom).forEach(([key, val]) => {
      if (handledKeys.has(key)) return;
      const normalized = key.toLowerCase().replace(/_/g, '');
      if (seenNormalized.has(normalized)) return;
      seenNormalized.add(normalized);

      const displayVal = Array.isArray(val) ? formatListOutput(val) : String(val !== undefined && val !== null ? val : '');
      const row = this.createCustomAttrRow(key, displayVal);
      listContainer.appendChild(row);
    });
  }

  /**
   * カスタム属性1行分のDOMを生成
   */
  createCustomAttrRow(key = '', val = '') {
    const row = document.createElement('div');
    row.className = 'custom-attr-row';
    row.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    row.innerHTML = `
      <input type="text" class="dbe-schema-input custom-attr-key" placeholder="${t('schema_modal.placeholder_custom_key')}" value="${escapeHtml(key)}" style="flex: 1; padding: 6px 8px; font-size: 0.85rem;" />
      <input type="text" class="dbe-schema-input custom-attr-value" placeholder="${t('schema_modal.placeholder_custom_val')}" value="${escapeHtml(val)}" style="flex: 1.5; padding: 6px 8px; font-size: 0.85rem;" />
      <button type="button" class="btn-remove-custom-attr" title="${t('common.delete')}" style="background: none; border: 1px solid var(--border-color); color: var(--danger, #dc2626); border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 0.85rem;">✕</button>
    `;

    const removeBtn = row.querySelector('.btn-remove-custom-attr');
    removeBtn.addEventListener('click', () => {
      row.remove();
    });

    return row;
  }

  _snakeToCamel(str) {
    return str.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
  }

  bindEvents() {
    const closeBtn = this.element.querySelector('#btn-close-schema-modal');
    const cancelBtn = this.element.querySelector('#btn-cancel-schema-modal');
    const saveBtn = this.element.querySelector('#btn-save-schema-modal');
    const dbmsSelect = this.element.querySelector('#schema-input-dbms');

    const handleClose = () => this.hide();

    closeBtn?.addEventListener('click', handleClose);
    cancelBtn?.addEventListener('click', handleClose);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.style.display !== 'none') {
        handleClose();
      }
    });

    // 方言プルダウン切替時に動的属性入力欄を再描画
    dbmsSelect?.addEventListener('change', () => {
      const schemaData = appStore.state.schemas?.get(this.targetSchemaName);
      const custom = schemaData?.model?.project?.custom || {};
      this.renderDynamicAttributes(dbmsSelect.value, custom);
      this.renderCustomAttributes(dbmsSelect.value, custom);
    });

    // 新規カスタム設定項目行の追加
    const addCustomBtn = this.element.querySelector('#btn-add-custom-attr');
    addCustomBtn?.addEventListener('click', () => {
      const listContainer = this.element.querySelector('#schema-custom-attributes-list');
      if (listContainer) {
        const newRow = this.createCustomAttrRow('', '');
        listContainer.appendChild(newRow);
        const keyInput = newRow.querySelector('.custom-attr-key');
        keyInput?.focus();
      }
    });

    saveBtn?.addEventListener('click', () => {
      this.saveChanges();
    });
  }

  show(schemaName) {
    this.targetSchemaName = schemaName || appStore.state.activeSchema;
    if (!this.targetSchemaName || !appStore.state.schemas?.has(this.targetSchemaName)) {
      alert(t('schema_modal.err_no_schema_selected'));
      return;
    }

    const schemaData = appStore.state.schemas.get(this.targetSchemaName);
    const model = schemaData.model || {};
    const project = model.project || {};
    const custom = project.custom || {};

    const titleText = this.element.querySelector('#schema-modal-title-text');
    const versionInput = this.element.querySelector('#schema-input-version');
    const dbmsSelect = this.element.querySelector('#schema-input-dbms');
    const noteInput = this.element.querySelector('#schema-input-note');

    // DBMS方言選択肢の更新 (登録済み方言から動的生成)
    if (dbmsSelect) {
      const dialects = dialectManager.getAll();
      dbmsSelect.innerHTML = dialects.map(d => `<option value="${d.dbmlDatabaseType}">${d.displayName}</option>`).join('');
      dbmsSelect.value = project.databaseType || 'standard';
    }

    if (titleText) titleText.textContent = t('schema_modal.title', { name: this.targetSchemaName });
    if (versionInput) versionInput.value = custom.version || '1.0.0';

    const selectedDbType = dbmsSelect?.value || project.databaseType || 'standard';
    this.renderDynamicAttributes(selectedDbType, custom);
    this.renderCustomAttributes(selectedDbType, custom);

    const noteText = project.note
      ? (typeof project.note === 'object' ? (project.note.value || '') : String(project.note))
      : '';
    if (noteInput) noteInput.value = noteText;

    this.element.style.display = 'flex';
    versionInput?.focus();
  }

  hide() {
    this.element.style.display = 'none';
  }

  async saveChanges() {
    if (!this.targetSchemaName || !appStore.state.schemas?.has(this.targetSchemaName)) {
      this.hide();
      return;
    }

    const versionInput = this.element.querySelector('#schema-input-version');
    const dbmsSelect = this.element.querySelector('#schema-input-dbms');
    const noteInput = this.element.querySelector('#schema-input-note');

    const newVersion = versionInput ? versionInput.value.trim() : '1.0.0';
    const newDbType = dbmsSelect ? dbmsSelect.value : 'standard';
    const newNote = noteInput ? noteInput.value.trim() : '';

    const schemaData = appStore.state.schemas.get(this.targetSchemaName);
    const model = schemaData.model || {};
    const currentProj = model.project || {};
    const currentCustom = { ...(currentProj.custom || {}) };

    // プラグイン動的 Project 属性の収集
    const dynamicInputs = this.element.querySelectorAll('#schema-project-attributes-container [data-key]');
    const dynamicKeys = new Set(['version']);
    dynamicInputs.forEach(input => {
      const key = input.dataset.key;
      const type = input.dataset.type;
      dynamicKeys.add(key);
      dynamicKeys.add(this._snakeToCamel(key));
      const rawVal = input.value.trim();
      if (type === 'list') {
        const listVal = parseListInput(rawVal);
        currentCustom[key] = listVal;
        // 既存プロパティとの互換性用 (camelCase)
        currentCustom[this._snakeToCamel(key)] = listVal;
      } else {
        currentCustom[key] = rawVal;
      }
    });

    // 以前の任意カスタムキーを一度クリア（動的属性・version以外）
    Object.keys(currentCustom).forEach(k => {
      if (!dynamicKeys.has(k)) {
        delete currentCustom[k];
      }
    });

    // 任意カスタム属性の収集
    const customRows = this.element.querySelectorAll('#schema-custom-attributes-list .custom-attr-row');
    customRows.forEach(row => {
      const kInput = row.querySelector('.custom-attr-key');
      const vInput = row.querySelector('.custom-attr-value');
      const k = kInput ? kInput.value.trim() : '';
      const v = vInput ? vInput.value.trim() : '';
      if (k && !dynamicKeys.has(k)) {
        currentCustom[k] = v;
      }
    });

    currentCustom.version = newVersion;

    const updatedProject = {
      ...currentProj,
      // 日本語コメント: Project 名は対象スキーマ名に固定し、スキーマ識別名の個別設定を廃止
      name: this.targetSchemaName,
      databaseType: newDbType,
      note: newNote,
      custom: currentCustom,
    };

    schemaData.model = {
      ...model,
      project: updatedProject,
    };
    // 日本語コメント: 対象スキーマを未保存(dirty)・DBML再生成対象(dbmlDirty)としてマーク
    appStore.markSchemaDirty(this.targetSchemaName);

    // アクティブスキーマならストア状態も同期
    if (this.targetSchemaName === appStore.state.activeSchema) {
      appStore.setModel({
        project: updatedProject,
        tables: model.tables || [],
        tableGroups: model.tableGroups || [],
        notes: model.notes || [],
        refs: model.refs || [],
      });
    } else {
      appStore.emit('model:updated', appStore.state);
    }

    try {
      // サーバーへ一括保存
      await projectService.saveProject();
      appStore.emit('status:message', t('schema_modal.saved_message', { name: this.targetSchemaName }));
      this.hide();
    } catch (err) {
      alert(t('schema_modal.err_save_failed', { message: err.message }));
    }
  }
}
