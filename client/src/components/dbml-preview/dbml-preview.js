// 日本語コメント: DBML 参照ビューコンポーネント (src/components/dbml-preview/dbml-preview.js)
// UIで組み立てられた AST から生成された最新の DBML テキストを CodeMirror 6 (Read-only) でウィンドウ全体に表示し、
// テキスト内検索機能を提供します。テキストの直接編集は行いません (UI操作が正本)。

import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { generateDbml } from '../../core/dbml-generator.js';
import { findTextMatches, computeNextMatchIndex } from '../../core/text-search-helper.js';
import { bindSearchClear } from '../../core/search-clear.js';

export class DbeDbmlPreview {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.editorView = null;
    this.editorWrapper = null;
    this.searchMatches = [];
    this.searchIndex = -1;

    this.render();
    this.initCodeMirror();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-dbml-preview';

    this.element.innerHTML = `
      <div class="preview-header-bar">
        <h2>
          <span>👁️</span>
          <span>${t('preview.title')}</span>
          <span class="badge">${t('preview.readonly_badge')}</span>
        </h2>

        <div class="preview-toolbar">
          <div class="preview-search-box">
            <div class="dbe-search-input-wrap">
              <input type="text" id="input-preview-search" class="preview-search-input" placeholder="${t('preview.search_placeholder')}" />
              <button type="button" id="btn-preview-search-clear" class="dbe-search-clear-btn" style="display: none;" title="${t('table_group_modal.filter_clear')}" aria-label="${t('table_group_modal.filter_clear')}">&times;</button>
            </div>
            <span id="preview-search-count" class="preview-search-count"></span>
            <button type="button" id="btn-preview-prev" class="preview-search-btn" title="${t('preview.btn_prev')}">▲</button>
            <button type="button" id="btn-preview-next" class="preview-search-btn" title="${t('preview.btn_next')}">▼</button>
          </div>
          <button type="button" id="btn-copy-dbml" class="preview-action-btn">📋 ${t('preview.btn_copy')}</button>
          <button type="button" id="btn-close-preview" class="preview-close-btn">${t('preview.btn_close')}</button>
        </div>
      </div>

      <div class="preview-editor-wrapper" id="preview-editor-container"></div>
    `;

    this.editorWrapper = this.element.querySelector('#preview-editor-container');
    this.container.appendChild(this.element);
  }

  initCodeMirror() {
    const startState = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        EditorView.editable.of(false), // ★ 参照専用 (Read-only)
        EditorState.readOnly.of(true),
      ],
    });

    this.editorView = new EditorView({
      state: startState,
      parent: this.editorWrapper,
    });
  }

  bindEvents() {
    const copyBtn = this.element.querySelector('#btn-copy-dbml');
    copyBtn.addEventListener('click', async () => {
      const text = this.editorView.state.doc.toString();
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = '✓ ' + t('common.copied');
      setTimeout(() => {
        copyBtn.textContent = '📋 ' + t('preview.btn_copy');
      }, 2000);
    });

    const closeBtn = this.element.querySelector('#btn-close-preview');
    closeBtn.addEventListener('click', () => {
      appStore.emit('view:restore');
    });

    const searchInput = this.element.querySelector('#input-preview-search');
    const clearSearchBtn = this.element.querySelector('#btn-preview-search-clear');
    const prevBtn = this.element.querySelector('#btn-preview-prev');
    const nextBtn = this.element.querySelector('#btn-preview-next');

    bindSearchClear(searchInput, clearSearchBtn);

    searchInput.addEventListener('input', () => {
      this.runSearch(true);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.stepSearch(e.shiftKey ? -1 : 1);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        appStore.emit('view:restore');
      }
    });

    prevBtn.addEventListener('click', () => this.stepSearch(-1));
    nextBtn.addEventListener('click', () => this.stepSearch(1));

    // 日本語コメント: プレビュー表示中の Ctrl+F で検索入力欄へフォーカス / Esc で閉じる
    this.element.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      } else if (e.key === 'Escape') {
        appStore.emit('view:restore');
      }
    });
  }

  bindStore() {
    appStore.on('model:updated', () => {
      this.refreshContent();
    });

    appStore.on('schema:changed', () => {
      this.refreshContent();
    });

    appStore.on('view:mode:change', (mode) => {
      if (mode === 'preview') {
        this.refreshContent();
      }
    });
  }

  updateSearchCountUI() {
    const searchInput = this.element.querySelector('#input-preview-search');
    const countEl = this.element.querySelector('#preview-search-count');
    if (!countEl) return;
    if (!searchInput?.value) {
      countEl.textContent = '';
      countEl.classList.remove('no-match');
      return;
    }
    if (this.searchMatches.length === 0) {
      countEl.textContent = '0/0';
      countEl.classList.add('no-match');
    } else {
      countEl.textContent = `${this.searchIndex + 1}/${this.searchMatches.length}`;
      countEl.classList.remove('no-match');
    }
  }

  jumpToMatch(index) {
    if (!this.editorView || this.searchMatches.length === 0 || index < 0 || index >= this.searchMatches.length) {
      this.updateSearchCountUI();
      return;
    }
    this.searchIndex = index;
    const match = this.searchMatches[index];
    this.editorView.dispatch({
      selection: { anchor: match.start, head: match.end },
      effects: EditorView.scrollIntoView(match.start, { y: 'center' }),
    });
    this.updateSearchCountUI();
  }

  runSearch(jumpToFirst = true) {
    const query = this.element.querySelector('#input-preview-search')?.value || '';
    const text = this.editorView ? this.editorView.state.doc.toString() : '';
    this.searchMatches = findTextMatches(text, query);
    this.searchIndex = this.searchMatches.length > 0 ? 0 : -1;
    if (jumpToFirst && this.searchIndex >= 0) {
      this.jumpToMatch(this.searchIndex);
    } else {
      this.updateSearchCountUI();
    }
  }

  stepSearch(direction) {
    if (this.searchMatches.length === 0) {
      this.runSearch(true);
      return;
    }
    const nextIdx = computeNextMatchIndex(this.searchIndex, this.searchMatches.length, direction);
    this.jumpToMatch(nextIdx);
  }

  refreshContent() {
    const dbmlText = generateDbml({
      project: appStore.state.project || {
        name: 'DatabaseDesign',
        databaseType: appStore.state.activeDialect?.dbmlDatabaseType,
      },
      tables: appStore.state.tables,
      tableGroups: appStore.state.tableGroups,
      notes: appStore.state.notes,
      refs: appStore.state.refs,
    });

    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorView.state.doc.length,
        insert: dbmlText,
      },
    });

    const query = this.element.querySelector('#input-preview-search')?.value;
    if (query) {
      this.runSearch(false);
    }
  }
}
