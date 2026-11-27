// 日本語コメント: テーブルグループ編集・作成モーダル (src/components/table-group-modal/table-group-modal.js)
// テーブルグループの物理名、論理名、および所属テーブルの割り当てを編集・保存します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { escapeHtml } from '../../core/html-utils.js';
import './table-group-modal.css';

export class TableGroupModal {
  constructor(container = document.body) {
    this.container = container;
    this.element = null;
    this.targetGroup = null; // nullなら新規作成、オブジェクトなら編集モード
    this.targetSchema = null;

    // 日本語コメント: デュアルリスト用状態管理
    this.belongingTables = [];
    this.availableTables = [];
    this.selectedBelonging = new Set();
    this.selectedAvailable = new Set();
    this.belongingFilter = '';
    this.availableFilter = '';
    this.tableMetaMap = new Map();

    this.render();
    this.bindEvents();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-modal-overlay';
    this.element.id = 'tg-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-modal-card dbe-modal-card--compact" id="tg-modal-card" role="dialog" aria-modal="true" aria-labelledby="tg-modal-title">
        <div class="dbe-modal-header">
          <h3 id="tg-modal-title">
            <span>📁</span>
            <span id="tg-modal-title-text">${t('table_group_modal.title_new')}</span>
          </h3>
          <button type="button" class="dbe-modal-close" id="btn-close-tg-modal" aria-label="${t('common.close')}">&times;</button>
        </div>

        <div class="dbe-modal-body">
          <div class="dbe-form-field">
            <label for="tg-input-name">
              ${t('table_group_modal.group_name')}
              <span class="dbe-required-mark">*</span>
            </label>
            <input type="text" id="tg-input-name" placeholder="auth_group / billing_group..." />
          </div>

          <!-- 日本語コメント: 編集モード時のみ表示するデュアルリスト（シャトル）UI -->
          <div class="dbe-tg-dual-section" id="tg-dual-list-section" style="display: none;">
            <div class="dbe-tg-dual-container">
              <!-- 左：内包するテーブル一覧 -->
              <div class="dbe-tg-dual-pane">
                <div class="dbe-tg-dual-pane-header">
                  <div class="dbe-tg-dual-pane-title">
                    <span>${t('table_group_modal.belonging_tables')}</span>
                    <span class="dbe-tg-dual-count" id="tg-belonging-count">0</span>
                  </div>
                  <div class="dbe-tg-pane-actions">
                    <button type="button" class="dbe-tg-pane-action-btn" id="btn-tg-select-all-belonging">${t('table_group_modal.btn_select_all')}</button>
                    <span class="dbe-tg-pane-action-sep">|</span>
                    <button type="button" class="dbe-tg-pane-action-btn" id="btn-tg-deselect-all-belonging">${t('table_group_modal.btn_deselect_all')}</button>
                  </div>
                </div>
                <div class="dbe-tg-filter-box">
                  <div class="dbe-tg-filter-wrap">
                    <input type="text" class="dbe-tg-filter-input" id="tg-filter-belonging" placeholder="${t('table_group_modal.filter_placeholder')}" />
                    <button type="button" class="dbe-tg-filter-clear" id="btn-tg-clear-filter-belonging" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                  </div>
                </div>
                <div class="dbe-tg-dual-list" id="tg-belonging-list"></div>
              </div>

              <!-- 中央：追加 / 削除ボタン -->
              <div class="dbe-tg-dual-controls">
                <button type="button" class="dbe-tg-dual-btn primary" id="btn-tg-add-tables" disabled>
                  ${t('table_group_modal.btn_add')}
                </button>
                <button type="button" class="dbe-tg-dual-btn" id="btn-tg-remove-tables" disabled>
                  ${t('table_group_modal.btn_remove')}
                </button>
              </div>

              <!-- 右：テーブル一覧（未所属） -->
              <div class="dbe-tg-dual-pane">
                <div class="dbe-tg-dual-pane-header">
                  <div class="dbe-tg-dual-pane-title">
                    <span>${t('table_group_modal.available_tables')}</span>
                    <span class="dbe-tg-dual-count" id="tg-available-count">0</span>
                  </div>
                  <div class="dbe-tg-pane-actions">
                    <button type="button" class="dbe-tg-pane-action-btn" id="btn-tg-select-all-available">${t('table_group_modal.btn_select_all')}</button>
                    <span class="dbe-tg-pane-action-sep">|</span>
                    <button type="button" class="dbe-tg-pane-action-btn" id="btn-tg-deselect-all-available">${t('table_group_modal.btn_deselect_all')}</button>
                  </div>
                </div>
                <div class="dbe-tg-filter-box">
                  <div class="dbe-tg-filter-wrap">
                    <input type="text" class="dbe-tg-filter-input" id="tg-filter-available" placeholder="${t('table_group_modal.filter_placeholder')}" />
                    <button type="button" class="dbe-tg-filter-clear" id="btn-tg-clear-filter-available" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
                  </div>
                </div>
                <div class="dbe-tg-dual-list" id="tg-available-list"></div>
              </div>
            </div>
            <div class="dbe-tg-field-hint">${t('table_group_modal.hint_dual_list')}</div>
          </div>

          <div class="dbe-form-error" id="tg-form-error" style="display: none;" role="alert"></div>
        </div>

        <div class="dbe-modal-actions">
          <button type="button" id="btn-cancel-tg-modal">
            ${t('common.cancel')}
          </button>
          <button type="button" class="primary" id="btn-save-tg-modal">
            ${t('common.save')}
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // 閉じるボタン
    this.element.querySelector('#btn-close-tg-modal').addEventListener('click', () => this.close());
    this.element.querySelector('#btn-cancel-tg-modal').addEventListener('click', () => this.close());

    // 日本語コメント: グループ名入力時にリアルタイムバリデーションを実行・Enterで保存
    const nameInput = this.element.querySelector('#tg-input-name');
    nameInput?.addEventListener('input', () => {
      this.validateGroupName(nameInput.value, { allowEmpty: true });
    });
    nameInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleSave();
      }
    });

    // 中央の追加ボタン (右 -> 左)
    this.element.querySelector('#btn-tg-add-tables')?.addEventListener('click', () => {
      if (this.selectedAvailable.size === 0) return;
      const toAdd = this.availableTables.filter(name => this.selectedAvailable.has(name));
      this.belongingTables = [...this.belongingTables, ...toAdd];
      this.availableTables = this.availableTables.filter(name => !this.selectedAvailable.has(name));
      this.selectedAvailable.clear();
      this.renderDualLists();
    });

    // 中央の削除ボタン (左 -> 右)
    this.element.querySelector('#btn-tg-remove-tables')?.addEventListener('click', () => {
      if (this.selectedBelonging.size === 0) return;
      const toRemove = this.belongingTables.filter(name => this.selectedBelonging.has(name));
      this.availableTables = [...this.availableTables, ...toRemove];
      this.belongingTables = this.belongingTables.filter(name => !this.selectedBelonging.has(name));
      this.selectedBelonging.clear();
      this.renderDualLists();
    });

    // 日本語コメント: 左右テーブル一覧のフィルタ入力および×クリアボタンを共通バインド
    const bindFilter = (inputSelector, clearSelector, stateKey) => {
      const inputEl = this.element.querySelector(inputSelector);
      const clearEl = this.element.querySelector(clearSelector);
      const syncClearBtn = () => {
        if (clearEl) clearEl.style.display = this[stateKey] ? 'flex' : 'none';
      };

      inputEl?.addEventListener('input', () => {
        this[stateKey] = inputEl.value;
        syncClearBtn();
        this.renderDualLists();
      });
      inputEl?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
        } else if (e.key === 'Escape' && this[stateKey]) {
          e.stopPropagation();
          this[stateKey] = '';
          inputEl.value = '';
          syncClearBtn();
          this.renderDualLists();
        }
      });
      clearEl?.addEventListener('click', () => {
        this[stateKey] = '';
        if (inputEl) {
          inputEl.value = '';
          inputEl.focus();
        }
        syncClearBtn();
        this.renderDualLists();
      });
    };

    bindFilter('#tg-filter-belonging', '#btn-tg-clear-filter-belonging', 'belongingFilter');
    bindFilter('#tg-filter-available', '#btn-tg-clear-filter-available', 'availableFilter');

    // 日本語コメント: 左右リストの全選択（表示中のみ）・全解除ボタンを共通バインド
    const bindSelectActions = (selectAllId, deselectAllId, listKey, filterKey, selectedKey) => {
      this.element.querySelector(selectAllId)?.addEventListener('click', () => {
        const visibleItems = this.getFilteredTables(this[listKey], this[filterKey]);
        visibleItems.forEach(name => this[selectedKey].add(name));
        this.renderDualLists();
      });
      this.element.querySelector(deselectAllId)?.addEventListener('click', () => {
        this[selectedKey].clear();
        this.renderDualLists();
      });
    };

    bindSelectActions(
      '#btn-tg-select-all-belonging',
      '#btn-tg-deselect-all-belonging',
      'belongingTables',
      'belongingFilter',
      'selectedBelonging'
    );
    bindSelectActions(
      '#btn-tg-select-all-available',
      '#btn-tg-deselect-all-available',
      'availableTables',
      'availableFilter',
      'selectedAvailable'
    );

    // 保存ボタン
    this.element.querySelector('#btn-save-tg-modal').addEventListener('click', () => {
      this.handleSave();
    });

    // Ctrl+Enterで保存 / Escapeで閉じる
    this.element.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        this.handleSave();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  /**
   * モーダル内エラー表示制御
   * @param {string} message
   */
  setError(message) {
    const errorBox = this.element.querySelector('#tg-form-error');
    const nameInput = this.element.querySelector('#tg-input-name');
    if (nameInput) {
      nameInput.classList.toggle('dbe-input-invalid', Boolean(message));
    }
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
   * グループ名のバリデーション（半角英数字・アンダースコアのみ、重複チェック）
   * @param {string} rawValue
   * @param {Object} options
   * @param {boolean} options.allowEmpty - 入力中の空文字を許容するか
   * @returns {boolean} 有効なら true
   */
  validateGroupName(rawValue, { allowEmpty = false } = {}) {
    const groupName = (rawValue || '').trim();
    const saveBtn = this.element.querySelector('#btn-save-tg-modal');

    if (!groupName) {
      if (allowEmpty) {
        this.setError('');
        if (saveBtn) saveBtn.disabled = false;
        return true;
      }
      this.setError(t('table_group_modal.err_name_required'));
      if (saveBtn) saveBtn.disabled = false;
      return false;
    }

    // DBML 識別子（半角英字または _ 始まり、以降半角英数字・_）チェック
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(groupName)) {
      this.setError(t('table_group_modal.err_name_invalid'));
      if (saveBtn) saveBtn.disabled = true;
      return false;
    }

    // 重複チェック（自身以外で同名）
    const currentGroups = appStore.state.tableGroups || [];
    const isDuplicate = currentGroups.some(g => {
      if (this.targetGroup && g.name === this.targetGroup.name) {
        return false;
      }
      return g.name.toLowerCase() === groupName.toLowerCase();
    });

    if (isDuplicate) {
      this.setError(t('table_group_modal.err_duplicate', { name: groupName }));
      if (saveBtn) saveBtn.disabled = true;
      return false;
    }

    this.setError('');
    if (saveBtn) saveBtn.disabled = false;
    return true;
  }

  /**
   * フィルタ文字列によるテーブル名絞り込み
   * @param {string[]} items
   * @param {string} query
   * @returns {string[]}
   */
  getFilteredTables(items, query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return items;
    return items.filter(name => {
      const meta = this.tableMetaMap.get(name);
      const physical = (meta?.name || name).toLowerCase();
      const logical = (meta?.logicalName || '').toLowerCase();
      return physical.includes(q) || logical.includes(q);
    });
  }

  /**
   * デュアルリストの描画と中央ボタン状態更新
   */
  renderDualLists() {
    const belongingListEl = this.element.querySelector('#tg-belonging-list');
    const availableListEl = this.element.querySelector('#tg-available-list');
    const belongingCountEl = this.element.querySelector('#tg-belonging-count');
    const availableCountEl = this.element.querySelector('#tg-available-count');
    const addBtn = this.element.querySelector('#btn-tg-add-tables');
    const removeBtn = this.element.querySelector('#btn-tg-remove-tables');
    const selectAllBelongingBtn = this.element.querySelector('#btn-tg-select-all-belonging');
    const deselectAllBelongingBtn = this.element.querySelector('#btn-tg-deselect-all-belonging');
    const selectAllAvailableBtn = this.element.querySelector('#btn-tg-select-all-available');
    const deselectAllAvailableBtn = this.element.querySelector('#btn-tg-deselect-all-available');

    const filteredBelonging = this.getFilteredTables(this.belongingTables, this.belongingFilter);
    const filteredAvailable = this.getFilteredTables(this.availableTables, this.availableFilter);

    if (selectAllBelongingBtn) selectAllBelongingBtn.disabled = filteredBelonging.length === 0;
    if (deselectAllBelongingBtn) deselectAllBelongingBtn.disabled = this.selectedBelonging.size === 0;
    if (selectAllAvailableBtn) selectAllAvailableBtn.disabled = filteredAvailable.length === 0;
    if (deselectAllAvailableBtn) deselectAllAvailableBtn.disabled = this.selectedAvailable.size === 0;

    const hasBelongingFilter = Boolean(this.belongingFilter.trim());
    const hasAvailableFilter = Boolean(this.availableFilter.trim());

    if (belongingCountEl) {
      belongingCountEl.textContent = hasBelongingFilter
        ? `${filteredBelonging.length} / ${this.belongingTables.length}`
        : String(this.belongingTables.length);
    }
    if (availableCountEl) {
      availableCountEl.textContent = hasAvailableFilter
        ? `${filteredAvailable.length} / ${this.availableTables.length}`
        : String(this.availableTables.length);
    }

    const buildList = (containerEl, items, totalCount, selectedSet, emptyText, isBelonging) => {
      containerEl.innerHTML = '';
      if (items.length === 0) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'dbe-tg-dual-empty';
        emptyEl.textContent = totalCount > 0 ? t('table_group_modal.empty_filtered') : emptyText;
        containerEl.appendChild(emptyEl);
        return;
      }

      items.forEach(tableName => {
        const meta = this.tableMetaMap.get(tableName) || { name: tableName, logicalName: '' };
        const itemEl = document.createElement('div');
        itemEl.className = `dbe-tg-dual-item${selectedSet.has(tableName) ? ' selected' : ''}`;

        const logicalHtml = meta.logicalName
          ? `<span class="dbe-tg-table-logical">(${escapeHtml(meta.logicalName)})</span>`
          : '';

        itemEl.innerHTML = `
          <span class="dbe-tg-table-label">
            <span>📋</span>
            <strong>${escapeHtml(meta.name)}</strong>
            ${logicalHtml}
          </span>
        `;

        // クリックで選択状態トグル
        itemEl.addEventListener('click', () => {
          if (selectedSet.has(tableName)) {
            selectedSet.delete(tableName);
          } else {
            selectedSet.add(tableName);
          }
          this.renderDualLists();
        });

        // ダブルクリックで即移動
        itemEl.addEventListener('dblclick', () => {
          if (isBelonging) {
            this.belongingTables = this.belongingTables.filter(n => n !== tableName);
            this.availableTables = [...this.availableTables, tableName];
            this.selectedBelonging.delete(tableName);
          } else {
            this.availableTables = this.availableTables.filter(n => n !== tableName);
            this.belongingTables = [...this.belongingTables, tableName];
            this.selectedAvailable.delete(tableName);
          }
          this.renderDualLists();
        });

        containerEl.appendChild(itemEl);
      });
    };

    buildList(
      belongingListEl,
      filteredBelonging,
      this.belongingTables.length,
      this.selectedBelonging,
      t('table_group_modal.empty_belonging'),
      true
    );
    buildList(
      availableListEl,
      filteredAvailable,
      this.availableTables.length,
      this.selectedAvailable,
      t('table_group_modal.empty_available'),
      false
    );

    if (addBtn) addBtn.disabled = this.selectedAvailable.size === 0;
    if (removeBtn) removeBtn.disabled = this.selectedBelonging.size === 0;
  }

  /**
   * モーダルを開く
   * @param {Object|null} group - 編集対象グループ (nullなら新規作成)
   * @param {string|null} schemaName - 対象スキーマ名
   */
  open(group = null, schemaName = null) {
    this.targetGroup = group;
    this.targetSchema = schemaName || appStore.state.activeSchema;

    const cardEl = this.element.querySelector('#tg-modal-card');
    const titleEl = this.element.querySelector('#tg-modal-title-text');
    const nameInput = this.element.querySelector('#tg-input-name');
    const dualSection = this.element.querySelector('#tg-dual-list-section');
    const saveBtn = this.element.querySelector('#btn-save-tg-modal');

    this.setError('');
    if (saveBtn) saveBtn.disabled = false;

    // フィルタ状態のリセット
    this.belongingFilter = '';
    this.availableFilter = '';
    const belongingFilterInput = this.element.querySelector('#tg-filter-belonging');
    const availableFilterInput = this.element.querySelector('#tg-filter-available');
    const clearBelongingBtn = this.element.querySelector('#btn-tg-clear-filter-belonging');
    const clearAvailableBtn = this.element.querySelector('#btn-tg-clear-filter-available');
    if (belongingFilterInput) belongingFilterInput.value = '';
    if (availableFilterInput) availableFilterInput.value = '';
    if (clearBelongingBtn) clearBelongingBtn.style.display = 'none';
    if (clearAvailableBtn) clearAvailableBtn.style.display = 'none';

    if (group) {
      // 編集モード：デュアルリストを表示し、幅を拡張
      cardEl?.classList.remove('dbe-modal-card--compact');
      cardEl?.classList.add('dbe-tg-modal-card--dual');
      titleEl.textContent = t('table_group_modal.title_edit', { name: group.name });
      nameInput.value = group.name || '';
      if (dualSection) dualSection.style.display = 'flex';

      const tables = appStore.state.tables || [];
      this.tableMetaMap.clear();
      tables.forEach(tbl => {
        this.tableMetaMap.set(tbl.name, tbl);
      });

      const belongingSet = new Set();
      const orderedBelonging = [];
      if (group.tables) {
        group.tables.forEach(item => {
          const tName = typeof item === 'object' && item !== null ? (item.name || item.tableName) : String(item);
          if (tName && !belongingSet.has(tName)) {
            belongingSet.add(tName);
            orderedBelonging.push(tName);
          }
        });
      }

      // 日本語コメント: DBML仕様上、1テーブルは1グループにのみ所属できるため他グループ所属済みテーブルを収集して除外する
      const otherGroupTableSet = new Set();
      (appStore.state.tableGroups || []).forEach(other => {
        if (other.name === group.name || !other.tables) return;
        other.tables.forEach(item => {
          const tName = typeof item === 'object' && item !== null ? (item.name || item.tableName) : String(item);
          if (tName) otherGroupTableSet.add(tName);
        });
      });

      this.belongingTables = orderedBelonging;
      this.availableTables = tables
        .map(tbl => tbl.name)
        .filter(name => !belongingSet.has(name) && !otherGroupTableSet.has(name));
      this.selectedBelonging.clear();
      this.selectedAvailable.clear();
      this.renderDualLists();
    } else {
      // 新規作成モード：テーブルグループ名のみのコンパクトモーダル
      cardEl?.classList.remove('dbe-tg-modal-card--dual');
      cardEl?.classList.add('dbe-modal-card--compact');
      titleEl.textContent = t('table_group_modal.title_new');
      nameInput.value = '';
      if (dualSection) dualSection.style.display = 'none';
      this.belongingTables = [];
      this.availableTables = [];
      this.selectedBelonging.clear();
      this.selectedAvailable.clear();
    }

    this.element.style.display = 'flex';
    nameInput.focus();
  }

  close() {
    this.element.style.display = 'none';
    this.targetGroup = null;
    this.targetSchema = null;
    this.setError('');
  }

  async handleSave() {
    const nameInput = this.element.querySelector('#tg-input-name');
    const saveBtn = this.element.querySelector('#btn-save-tg-modal');
    const groupName = nameInput.value.trim();

    if (!this.validateGroupName(nameInput.value, { allowEmpty: false })) {
      nameInput.focus();
      return;
    }

    // 既存グループリストの取得
    const currentGroups = [...(appStore.state.tableGroups || [])];

    const newGroupData = {
      name: groupName,
      tables: this.targetGroup ? [...this.belongingTables] : [],
    };

    let updatedGroups = [];
    if (this.targetGroup) {
      // 編集モード
      updatedGroups = currentGroups.map(g => {
        if (g.name === this.targetGroup.name) {
          return { ...g, ...newGroupData };
        }
        return g;
      });
    } else {
      // 新規作成モード
      updatedGroups = [...currentGroups, newGroupData];
    }

    if (saveBtn) saveBtn.disabled = true;
    try {
      // モデルを更新
      appStore.setModel({
        project: appStore.state.project,
        tables: appStore.state.tables,
        tableGroups: updatedGroups,
        refs: appStore.state.refs,
      });

      // サーバー永続化
      await projectService.saveProject();

      const savedGroup = updatedGroups.find(g => g.name === groupName);
      appStore.emit('tableGroup:saved', { group: savedGroup, isNew: !this.targetGroup });

      this.close();
    } catch (err) {
      console.error('TableGroup保存エラー:', err);
      this.setError(t('table_group_modal.err_save_failed', { message: err.message || err }));
    } finally {
      if (saveBtn) saveBtn.disabled = false;
    }
  }
}
