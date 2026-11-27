// 日本語コメント: クエリビジュアライザーメインビュー (src/components/query-visualizer/query-visualizer.js)
// 複雑なSQL（WITH句、FROM句インラインビュー、暗黙カンマ結合、Oracle構文等）をAST解析し、
// テーブル・ビュー間の依存関係とデータフローを視覚的に美しく可視化する全画面コンポーネントです。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { escapeHtml } from '../../core/html-utils.js';
import { parseSqlQuery, getAllTablesFromSchemaData } from '../../core/query-parser.js';
import { extractSqlAliases, resolveDotCompletionItems } from '../../core/sql-completion-utils.js';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { sql } from '@codemirror/lang-sql';
import { autocompletion, startCompletion } from '@codemirror/autocomplete';
import './query-visualizer.css';

export class DbeQueryVisualizer {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.editorView = null;
    this.editorWrapper = null;

    // キャンバス状態
    this.scale = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // 解析結果およびノード位置データ
    this.parsedResult = null;
    this.nodePositions = new Map(); // alias -> { x, y, width, height }
    this.foldedNodes = new Map(); // 日本語コメント: alias -> boolean (10カラム超の折りたたみ状態)
    this.activeTab = 'select';
    this.selectedDefaultSchema = '';

    // 日本語コメント: v1準拠の双方向ハイライト状態
    this.highlightedSelectKey = null;
    this.highlightedJoinIndex = null;
    this.highlightedWhereIndex = null;

    // ドラッグ状態
    this.dragTargetNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;

    this.render();
    this.initCodeMirror();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-query-visualizer-view';

    this.element.innerHTML = `
      <!-- 1. トップバー -->
      <div class="qv-header-bar">
        <div class="qv-header-left">
          <h2><span>📊</span> ${t('queryVis.title')}</h2>
          <div class="qv-header-controls">
            <!-- ダイアレクト選択 -->
            <select class="qv-select" id="selectQvDialect">
              <option value="Oracle">Oracle (<= 11g / 12c+)</option>
              <option value="Generic">${t('queryVis.dialectGeneric')}</option>
              <option value="PostgreSQL">PostgreSQL</option>
              <option value="MySQL">MySQL</option>
            </select>

            <!-- デフォルトスキーマ選択 -->
            <div class="qv-schema-picker">
              <label for="selectQvDefaultSchema" class="qv-schema-label">📂 ${t('queryVis.defaultSchema')}:</label>
              <select class="qv-select" id="selectQvDefaultSchema"></select>
            </div>

            <!-- 解析実行ボタン -->
            <button class="qv-btn qv-btn-primary" id="btnRunParse">
              ${t('queryVis.btnParse')}
            </button>
          </div>
        </div>

        <button class="qv-btn qv-btn-back" id="btnQvBackToEditor">
          ${t('queryVis.backToEditor')}
        </button>
      </div>

      <!-- 2. メイン作業スプリット領域 -->
      <div class="qv-main-workspace">
        <!-- 左ペイン: SQLエディタ ＆ 解析結果パネル -->
        <div class="qv-left-pane">
          <div class="qv-editor-container">
            <div class="qv-editor-header">
              <span>SQL QUERY INPUT</span>
              <span style="font-size: 0.7rem; opacity: 0.8;">${t('queryVis.editorShortcutHint')}</span>
            </div>
            <div class="qv-cm-wrapper" id="qvEditorWrapper"></div>
          </div>

          <div class="qv-panel-container">
            <div class="qv-panel-nav-tabs">
              <button class="qv-panel-nav-tab active" data-tab="select">${t('queryVis.tabSelect')}</button>
              <button class="qv-panel-nav-tab" data-tab="joins">${t('queryVis.tabJoins')}</button>
              <button class="qv-panel-nav-tab" data-tab="where">${t('queryVis.tabWhere')}</button>
            </div>
            <div class="qv-panel-tab-content" id="qvPanelContent">
              <div style="color: var(--text-secondary); font-size: 0.8rem; text-align: center; padding: 20px;">
                ${t('queryVis.emptyPrompt')}
              </div>
            </div>
          </div>
        </div>

        <!-- 右ペイン: ビジュアライザーキャンバス -->
        <div class="qv-canvas-pane" id="qvCanvasPane">
          <div class="qv-canvas-world" id="qvCanvasWorld">
            <svg class="qv-canvas-svg" id="qvCanvasSvg">
              <defs>
                <marker id="arrow-join" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#2196f3" />
                </marker>
                <marker id="arrow-pipeline" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#ab47bc" />
                </marker>
                <marker id="arrow-outer" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#ff7043" />
                </marker>
              </defs>
              <g id="qvLinksGroup"></g>
            </svg>
            <div id="qvNodesContainer"></div>
          </div>

          <!-- 下部フローティングツールバー (ER図ビュー準拠) -->
          <div class="qv-bottom-toolbar">
            <button type="button" id="btnZoomIn" title="${t('queryVis.zoomIn')}">➕</button>
            <button type="button" id="btnZoomOut" title="${t('queryVis.zoomOut')}">➖</button>
            <span class="qv-zoom-text" id="qvZoomLevel">100%</span>
            <button type="button" id="btnZoomReset" title="${t('queryVis.zoom100Tip')}">1:1</button>
            <div class="separator"></div>
            <button type="button" id="btnFitView" title="${t('queryVis.fitViewTip')}">🎯 ${t('queryVis.fitView')}</button>
            <button type="button" id="btnAutoLayout" title="${t('queryVis.autoLayoutTip')}">${t('queryVis.autoLayout')}</button>
            <div class="separator"></div>
            <button type="button" id="btnExportSvg" title="${t('queryVis.exportSvgTip')}">📊 ${t('queryVis.exportSvg')}</button>
            <button type="button" id="btnExportPng" title="${t('queryVis.exportPngTip')}">🖼️ ${t('queryVis.exportPng')}</button>
          </div>
        </div>
      </div>
    `;

    this.editorWrapper = this.element.querySelector('#qvEditorWrapper');
    this.container.appendChild(this.element);
  }

  initCodeMirror() {
    const startState = EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        sql(),
        EditorView.lineWrapping,
        // 日本語コメント: 「テーブル名.」または「エイリアス名.」入力時のカラム一覧オートコンプリート
        // @codemirror/lang-sql の標準キーワード補完と競合しないよう override で独自プロバイダを優先
        autocompletion({
          override: [(context) => this.provideSqlCompletion(context)],
          activateOnTyping: true
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            const pos = update.state.selection.main.head;
            if (pos > 0 && update.state.doc.sliceString(pos - 1, pos) === '.') {
              setTimeout(() => startCompletion(update.view), 0);
            }
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '0.85rem' },
          '.cm-scroller': { overflow: 'auto' }
        }),
        // 日本語コメント: エディタフォーカス時にフローティング拡大表示をトグル (v1操作感)
        // あわせて左ツリーからのテーブル名ドラッグ＆ドロップ挿入に対応
        EditorView.domEventHandlers({
          focus: () => {
            this.element.querySelector('.qv-editor-container')?.classList.add('is-focused');
          },
          blur: () => {
            this.element.querySelector('.qv-editor-container')?.classList.remove('is-focused');
          },
          dragover: (event) => {
            event.preventDefault();
            if (event.dataTransfer) {
              event.dataTransfer.dropEffect = 'copy';
            }
            this.element.querySelector('.qv-editor-container')?.classList.add('is-drag-over');
            return true;
          },
          dragleave: (event, view) => {
            if (!event.relatedTarget || !view.dom.contains(event.relatedTarget)) {
              this.element.querySelector('.qv-editor-container')?.classList.remove('is-drag-over');
            }
          },
          drop: (event, view) => {
            event.preventDefault();
            event.stopPropagation();
            this.element.querySelector('.qv-editor-container')?.classList.remove('is-drag-over');

            const raw = event.dataTransfer?.getData('text/plain') || '';
            if (!raw) return true;

            let insertText = raw;
            try {
              const parsed = JSON.parse(raw);
              if (parsed && parsed.type === 'Table' && parsed.tableName) {
                insertText = parsed.tableName;
              }
            } catch (_) {
              // 通常のテキストドロップ時はそのまま挿入
            }

            if (!insertText) return true;

            const coordsPos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            const insertPos = coordsPos !== null ? coordsPos : view.state.selection.main.from;
            view.dispatch({
              changes: { from: insertPos, to: insertPos, insert: insertText },
              selection: { anchor: insertPos + insertText.length }
            });
            view.focus();
            return true;
          }
        })
      ]
    });

    this.editorView = new EditorView({
      state: startState,
      parent: this.editorWrapper
    });
  }

  /**
   * SQL エディタでの「テーブル名.」/「エイリアス名.」入力時カラム補完プロバイダ
   * @param {Object} context - CodeMirror CompletionContext
   */
  provideSqlCompletion(context) {
    const match = context.matchBefore(/["`]?\w+["`]?\.[\w"`]*$/);
    if (!match) return null;

    const dotIndex = match.text.lastIndexOf('.');
    if (dotIndex === -1) return null;

    const prefix = match.text.slice(0, dotIndex);
    const aliases = extractSqlAliases(context.state.doc.toString());
    const options = resolveDotCompletionItems({
      prefix,
      schemasMap: appStore.state.schemas,
      defaultSchema: this.selectedDefaultSchema || appStore.state.activeSchema || '',
      aliases
    });

    if (options.length === 0) return null;

    return {
      from: match.from + dotIndex + 1,
      options,
      validFor: /^[\w"`]*$/
    };
  }

  bindEvents() {
    this.element.querySelector('#btnQvBackToEditor')?.addEventListener('click', () => {
      appStore.emit('view:restore');
    });

    this.element.querySelector('#btnRunParse')?.addEventListener('click', () => {
      this.executeParse();
    });

    this.element.querySelector('#btnAutoLayout')?.addEventListener('click', () => {
      this.panX = 0;
      this.panY = 0;
      this.scale = 1.0;
      this.updateCanvasTransform();
      this.layoutAndRenderCanvas();
    });

    this.element.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        this.executeParse();
      }
    });

    this.element.querySelector('#selectQvDefaultSchema')?.addEventListener('change', (e) => {
      this.selectedDefaultSchema = e.target.value;
      this.executeParse();
    });

    const tabs = this.element.querySelectorAll('.qv-panel-nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        this.activeTab = tab.getAttribute('data-tab');
        this.renderPanelContent();
      });
    });

    // 日本語コメント: マウスホイールによるスクロール / Ctrl+ホイールによるカーソル中心ズーム (ER図ビュー準拠)
    const canvasPane = this.element.querySelector('#qvCanvasPane');
    canvasPane.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // カーソル位置を中心としたズーム
        const zoomFactor = 0.05;
        const rect = canvasPane.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasMouseX = (mouseX - this.panX) / this.scale;
        const canvasMouseY = (mouseY - this.panY) / this.scale;
        if (e.deltaY < 0) {
          this.scale = Math.min(this.scale + zoomFactor, 3.0);
        } else {
          this.scale = Math.max(this.scale - zoomFactor, 0.2);
        }
        this.panX = mouseX - canvasMouseX * this.scale;
        this.panY = mouseY - canvasMouseY * this.scale;
        this.updateCanvasTransform();
      } else {
        // 通常スクロール (Shiftキーで横スクロール)
        if (e.shiftKey) {
          this.panX -= e.deltaY;
        } else {
          this.panY -= e.deltaY;
        }
        this.updateCanvasTransform();
      }
    }, { passive: false });

    canvasPane.addEventListener('mousedown', (e) => {
      if (e.target.closest('.qv-node-card') || e.target.closest('.qv-bottom-toolbar')) {
        return;
      }
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      canvasPane.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.updateCanvasTransform();
      } else if (this.dragTargetNode) {
        const x = (e.clientX - this.dragOffsetX - this.panX) / this.scale;
        const y = (e.clientY - this.dragOffsetY - this.panY) / this.scale;
        const node = this.dragTargetNode;
        node.style.left = `${x}px`;
        node.style.top = `${y}px`;

        const alias = node.getAttribute('data-alias');
        if (alias && this.nodePositions.has(alias)) {
          const pos = this.nodePositions.get(alias);
          pos.x = x;
          pos.y = y;
        }
        this.renderLinks();
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        canvasPane.style.cursor = 'default';
      }
      this.dragTargetNode = null;
    });

    this.element.querySelector('#btnZoomIn')?.addEventListener('click', () => {
      this.scale = Math.min(3.0, this.scale * 1.15);
      this.updateCanvasTransform();
    });
    this.element.querySelector('#btnZoomOut')?.addEventListener('click', () => {
      this.scale = Math.max(0.2, this.scale * 0.85);
      this.updateCanvasTransform();
    });
    this.element.querySelector('#btnZoomReset')?.addEventListener('click', () => {
      this.scale = 1.0;
      this.panX = 0;
      this.panY = 0;
      this.updateCanvasTransform();
    });
    this.element.querySelector('#btnFitView')?.addEventListener('click', () => {
      this.fitView();
    });
    this.element.querySelector('#btnExportSvg')?.addEventListener('click', () => {
      this.exportSVG();
    });
    this.element.querySelector('#btnExportPng')?.addEventListener('click', () => {
      this.exportPNG();
    });
  }

  bindStore() {
    // 必要に応じたストア購読
  }

  setEditorSql(sqlText) {
    if (!this.editorView) return;
    this.editorView.dispatch({
      changes: { from: 0, to: this.editorView.state.doc.length, insert: sqlText }
    });
  }

  getEditorSql() {
    return this.editorView ? this.editorView.state.doc.toString() : '';
  }

  open() {
    this.populateSchemaSelect();
    setTimeout(() => {
      if (this.editorView) {
        this.editorView.requestMeasure();
      }
      this.executeParse();
    }, 50);
  }

  /**
   * 日本語コメント: プロジェクト内のスキーマ一覧を取得してデフォルトスキーマ選択を更新
   */
  populateSchemaSelect() {
    const selectEl = this.element.querySelector('#selectQvDefaultSchema');
    if (!selectEl) return;

    const schemaNames = [];
    if (appStore.state.schemas instanceof Map) {
      for (const [key, s] of appStore.state.schemas.entries()) {
        const sName = (s && s.name) || String(key || '');
        if (sName && !schemaNames.includes(sName)) {
          schemaNames.push(sName);
        }
      }
    }

    if (schemaNames.length === 0) {
      schemaNames.push('public');
    }

    if (!this.selectedDefaultSchema || !schemaNames.includes(this.selectedDefaultSchema)) {
      this.selectedDefaultSchema = schemaNames[0];
    }

    selectEl.innerHTML = schemaNames
      .map(name => `<option value="${name}" ${name === this.selectedDefaultSchema ? 'selected' : ''}>${name}</option>`)
      .join('');
  }

  /**
   * 現在のプロジェクトから全スキーマのテーブル定義を収集（所属スキーマ名付き）
   */
  collectAllSchemaTables() {
    const tables = [];
    if (appStore.state.schemas instanceof Map) {
      for (const [key, s] of appStore.state.schemas.entries()) {
        const schemaName = (s && s.name) || String(key || '');
        if (s.model && Array.isArray(s.model.tables)) {
          s.model.tables.forEach(t => {
            tables.push({ ...t, _schemaName: t._schemaName || t.schemaName || schemaName });
          });
        }
      }
    }
    if (tables.length === 0 && Array.isArray(appStore.state.tables)) {
      tables.push(...appStore.state.tables);
    }
    return tables;
  }

  executeParse() {
    const sqlText = this.getEditorSql();
    const dialect = this.element.querySelector('#selectQvDialect')?.value || 'Oracle';
    const schemaTables = this.collectAllSchemaTables();
    const defaultSchema = this.element.querySelector('#selectQvDefaultSchema')?.value || this.selectedDefaultSchema || null;

    this.parsedResult = parseSqlQuery(sqlText, {
      dialect,
      schemaData: schemaTables,
      defaultSchema
    });
    this.highlightedSelectKey = null;
    this.highlightedJoinIndex = null;
    this.highlightedWhereIndex = null;

    this.renderPanelContent();
    this.layoutAndRenderCanvas();
  }

  /**
   * 日本語コメント: DBML定義上のカラム存在チェック (⚠️ NOT FOUND 警告用)
   */
  checkColumnExists(alias, columnName) {
    if (!alias || !columnName || columnName === '*' || columnName.endsWith('.*')) return true;
    // 関数式・演算式（括弧やスペースを含む）はスキップ
    if (/[()\s]/.test(columnName)) return true;

    const table = (this.parsedResult?.tables || []).find(t => t.alias.toLowerCase() === alias.toLowerCase());
    if (!table || !table.hasSchemaDef || !Array.isArray(table.columns) || table.columns.length === 0) {
      return true;
    }
    return table.columns.some(c => (c.name || '').toLowerCase() === columnName.toLowerCase());
  }

  /**
   * 日本語コメント: DBML定義上のPK/Index有無チェック (⚠️ NO INDEX 警告用)
   */
  checkColumnIndex(alias, columnName) {
    if (!alias || !columnName) return true;
    const table = (this.parsedResult?.tables || []).find(t => t.alias.toLowerCase() === alias.toLowerCase());
    if (!table || !table.hasSchemaDef || !Array.isArray(table.columns) || table.columns.length === 0) {
      return true;
    }
    const col = table.columns.find(c => (c.name || '').toLowerCase() === columnName.toLowerCase());
    if (!col) return true;
    return Boolean(col.isPk || col.isIndexed);
  }

  /**
   * 日本語コメント: 指定エイリアスのノードがキャンバス中央付近に来るよう自動パン
   */
  focusCanvasOnAlias(alias) {
    if (!alias) return;
    const pos = this.nodePositions.get(alias.toLowerCase());
    const pane = this.element.querySelector('#qvCanvasPane');
    if (!pos || !pane) return;

    const paneW = pane.clientWidth || 600;
    const paneH = pane.clientHeight || 500;
    const targetCenterX = pos.x + (pos.width || 280) / 2;
    const targetCenterY = pos.y + (pos.height || 200) / 2;

    this.panX = Math.round(paneW / 2 - targetCenterX * this.scale);
    this.panY = Math.round(paneH / 2 - targetCenterY * this.scale);
    this.updateCanvasTransform();
  }

  /**
   * 日本語コメント: 左パネル選択状態に応じてキャンバス上のカラム・JOIN線・WHEREバッジを強調表示
   */
  applyCanvasHighlights() {
    const nodesContainer = this.element.querySelector('#qvNodesContainer');
    const linksGroup = this.element.querySelector('#qvLinksGroup');

    if (nodesContainer) {
      nodesContainer.querySelectorAll('.qv-field-row.is-highlighted').forEach(el => el.classList.remove('is-highlighted'));
      nodesContainer.querySelectorAll('.qv-where-badge.is-highlighted').forEach(el => el.classList.remove('is-highlighted'));

      if (this.highlightedSelectKey) {
        const [tAlias, cName] = this.highlightedSelectKey.split('.');
        const card = tAlias
          ? nodesContainer.querySelector(`.qv-node-card[data-alias="${tAlias}"]`)
          : null;
        if (card && cName) {
          if (cName === '*') {
            card.querySelectorAll('.qv-field-row').forEach(r => r.classList.add('is-highlighted'));
          } else {
            card.querySelector(`.qv-field-row[data-field="${cName}"]`)?.classList.add('is-highlighted');
          }
        }
      }

      if (this.highlightedWhereIndex !== null) {
        nodesContainer
          .querySelectorAll(`.qv-where-badge[data-where-idx="${this.highlightedWhereIndex}"]`)
          .forEach(el => el.classList.add('is-highlighted'));
      }
    }

    if (linksGroup) {
      linksGroup.querySelectorAll('.qv-join-group').forEach((group, idx) => {
        group.classList.toggle('is-highlighted', this.highlightedJoinIndex === idx);
      });
    }
  }

  updateCanvasTransform() {
    const world = this.element.querySelector('#qvCanvasWorld');
    if (world) {
      world.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    }
    const zoomLabel = this.element.querySelector('#qvZoomLevel');
    if (zoomLabel) {
      zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  /**
   * 日本語コメント: 全テーブルカードがキャンバス内に収まるようにズームとパンを自動調整 (ER図ビュー準拠)
   */
  fitView() {
    const pane = this.element.querySelector('#qvCanvasPane');
    if (!pane || this.nodePositions.size === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const pos of this.nodePositions.values()) {
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + (pos.width || 280));
      maxY = Math.max(maxY, pos.y + (pos.height || 240));
    }

    if (minX === Infinity) return;

    const contentW = Math.max(100, maxX - minX);
    const contentH = Math.max(100, maxY - minY);
    const paneW = pane.clientWidth || 800;
    const paneH = pane.clientHeight || 600;
    const padding = 60;

    const scaleX = (paneW - padding * 2) / contentW;
    const scaleY = (paneH - padding * 2) / contentH;
    this.scale = Math.max(0.3, Math.min(1.5, Math.min(scaleX, scaleY)));

    const centerX = minX + contentW / 2;
    const centerY = minY + contentH / 2;
    this.panX = Math.round(paneW / 2 - centerX * this.scale);
    this.panY = Math.round(paneH / 2 - centerY * this.scale);
    this.updateCanvasTransform();
  }

  /**
   * 日本語コメント: XML/SVG属性・テキスト用の安全なエスケープヘルパー
   */
  escapeXml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * 日本語コメント: 現在のキャンバス状態（カード・論理名・カラム・WHERE・結合線・L/Rバッジ・ラベル）を純粋なSVG文字列として生成
   */
  generateSvgString() {
    const tables = (this.parsedResult && this.parsedResult.tables) || [];
    if (tables.length === 0) return null;

    // 日本語コメント: テーマ名ハードコードを廃止し、現在適用中のCSS変数から動的に配色を取得する
    const styleTarget = (typeof document !== 'undefined') ? (this.container || document.documentElement) : null;
    const computedStyle = (typeof getComputedStyle === 'function' && styleTarget) ? getComputedStyle(styleTarget) : null;
    const readVar = (names, fallback) => {
      if (!computedStyle) return fallback;
      for (const name of names) {
        const val = computedStyle.getPropertyValue(name)?.trim();
        if (val) return val;
      }
      return fallback;
    };

    const colors = {
      bg: readVar(['--erd-canvas-bg', '--bg-secondary', '--bg-primary'], '#0d1117'),
      cardBg: readVar(['--bg-card', '--bg-secondary'], '#1e242c'),
      cardBorder: readVar(['--border-color'], '#3c4452'),
      headerBg: readVar(['--bg-tertiary', '--bg-header'], '#252d38'),
      tableName: readVar(['--text-primary'], '#f0f6fc'),
      logicalText: readVar(['--text-muted', '--text-secondary'], '#94a3b8'),
      colBg: readVar(['--bg-primary', '--bg-subtle'], '#161b22'),
      colBorder: readVar(['--border-color'], '#2a323d'),
      colText: readVar(['--text-primary'], '#e6edf3'),
      joinLine: readVar(['--primary'], '#2196f3'),
      implicitLine: readVar(['--warning'], '#ff7043'),
      pipelineLine: '#ab47bc',
      badgeBg: readVar(['--bg-card', '--bg-secondary'], '#1e242c'),
      badgeText: readVar(['--text-primary'], '#e6edf3'),
      whereBorder: readVar(['--warning'], '#d97706'),
      whereBg: readVar(['--bg-tertiary', '--bg-subtle'], 'rgba(255, 193, 7, 0.14)'),
      whereText: readVar(['--warning'], '#ffd54f')
    };

    const maxFoldCol = (appStore.state.config && appStore.state.config.maxFoldColumnCount !== undefined)
      ? appStore.state.config.maxFoldColumnCount
      : 10;
    const allWheres = this.parsedResult.whereConditions || [];

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let cardsSvg = '';
    const colYMap = new Map();

    tables.forEach(table => {
      const aliasKey = table.alias.toLowerCase();
      const pos = this.nodePositions.get(aliasKey) || { x: 60, y: 60, width: 280, height: 240 };
      const cardW = pos.width || 280;
      const columns = table.columns || [];
      const isFolded = Boolean(this.foldedNodes.get(aliasKey));
      const visibleCols = (isFolded && columns.length > maxFoldCol) ? columns.slice(0, maxFoldCol) : columns;
      const hasMore = isFolded && columns.length > maxFoldCol;
      const tableWheres = allWheres.filter(w => (w.targetAlias || '').toLowerCase() === aliasKey);

      const headerH = table.logicalName ? 46 : 34;
      const rowH = 24;
      const moreH = hasMore ? 24 : 0;
      const whereH = tableWheres.length > 0 ? 12 + tableWheres.length * 24 : 8;
      const cardH = Math.max(pos.height || 0, headerH + 8 + Math.max(1, visibleCols.length) * rowH + moreH + whereH);

      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + cardW);
      maxY = Math.max(maxY, pos.y + cardH);

      const titleStr = this.escapeXml(`${table.alias} (${table.name})`);
      const logicalStr = table.logicalName ? this.escapeXml(table.logicalName) : '';

      cardsSvg += `<g transform="translate(${pos.x}, ${pos.y})">`;
      cardsSvg += `<rect width="${cardW}" height="${cardH}" rx="6" fill="${colors.cardBg}" stroke="${colors.cardBorder}" stroke-width="1.5"/>`;
      cardsSvg += `<path d="M 0 6 Q 0 0 6 0 L ${cardW - 6} 0 Q ${cardW} 0 ${cardW} 6 L ${cardW} ${headerH} L 0 ${headerH} Z" fill="${colors.headerBg}"/>`;
      cardsSvg += `<text x="12" y="21" fill="${colors.tableName}" font-size="12" font-weight="bold" font-family="system-ui, sans-serif">${titleStr}</text>`;
      if (logicalStr) {
        cardsSvg += `<text x="12" y="37" fill="${colors.logicalText}" font-size="10" font-family="system-ui, sans-serif">${logicalStr}</text>`;
      }

      const aliasColY = new Map();
      visibleCols.forEach((col, cIdx) => {
        const cy = headerH + 6 + cIdx * rowH;
        aliasColY.set((col.name || '').toLowerCase(), pos.y + cy + 10);
        const iconText = `${col.isSelect ? '✅' : ''}${col.isJoin ? '🔗' : ''}${col.isWhere ? '🔍' : ''}`;
        cardsSvg += `<rect x="6" y="${cy}" width="${cardW - 12}" height="20" rx="3" fill="${colors.colBg}" stroke="${colors.colBorder}" stroke-width="0.8"/>`;
        cardsSvg += `<text x="12" y="${cy + 14}" fill="${colors.colText}" font-size="11" font-family="monospace">${this.escapeXml((col.isPk ? '🔑 ' : '• ') + col.name)}</text>`;
        if (iconText) {
          cardsSvg += `<text x="${cardW - 12}" y="${cy + 14}" text-anchor="end" font-size="10">${iconText}</text>`;
        }
      });
      if (hasMore) {
        const my = headerH + 6 + visibleCols.length * rowH;
        aliasColY.set('__more__', pos.y + my + 10);
        cardsSvg += `<text x="${cardW / 2}" y="${my + 15}" text-anchor="middle" fill="${colors.logicalText}" font-size="10" font-style="italic" font-family="system-ui, sans-serif">... (+${columns.length - maxFoldCol})</text>`;
      }
      colYMap.set(aliasKey, { pos, cardW, cardH, aliasColY });

      if (tableWheres.length > 0) {
        const wyStart = headerH + 10 + visibleCols.length * rowH + moreH;
        tableWheres.forEach((w, wIdx) => {
          const wy = wyStart + wIdx * 24;
          cardsSvg += `<rect x="6" y="${wy}" width="${cardW - 12}" height="20" rx="4" fill="${colors.whereBg}" stroke="${colors.whereBorder}" stroke-width="0.9"/>`;
          cardsSvg += `<text x="12" y="${wy + 14}" fill="${colors.whereText}" font-size="10" font-family="monospace">${this.escapeXml('🔍 ' + w.condition)}</text>`;
        });
      }
      cardsSvg += `</g>`;
    });

    let linksSvg = '';
    const joins = this.parsedResult.joins || [];
    joins.forEach(join => {
      const leftInfo = colYMap.get((join.leftTableAlias || '').toLowerCase());
      const rightInfo = colYMap.get((join.rightTableAlias || '').toLowerCase());
      if (!leftInfo || !rightInfo) return;

      const y1 = (join.leftColumn && leftInfo.aliasColY.get(join.leftColumn.toLowerCase()))
        || leftInfo.aliasColY.get('__more__')
        || (leftInfo.pos.y + leftInfo.cardH / 2);
      const y2 = (join.rightColumn && rightInfo.aliasColY.get(join.rightColumn.toLowerCase()))
        || rightInfo.aliasColY.get('__more__')
        || (rightInfo.pos.y + rightInfo.cardH / 2);

      const leftRightEdge = leftInfo.pos.x + leftInfo.cardW;
      const rightRightEdge = rightInfo.pos.x + rightInfo.cardW;
      let x1, x2, cp1X, cp2X;
      if (leftRightEdge <= rightInfo.pos.x) {
        x1 = leftRightEdge + 8;
        x2 = rightInfo.pos.x - 8;
        const offset = Math.max(40, Math.min(120, Math.abs(x2 - x1) / 2));
        cp1X = x1 + offset;
        cp2X = x2 - offset;
      } else if (rightRightEdge <= leftInfo.pos.x) {
        x1 = leftInfo.pos.x - 8;
        x2 = rightRightEdge + 8;
        const offset = Math.max(40, Math.min(120, Math.abs(x2 - x1) / 2));
        cp1X = x1 - offset;
        cp2X = x2 + offset;
      } else {
        x1 = leftInfo.pos.x - 8;
        x2 = rightInfo.pos.x - 8;
        const offset = Math.max(50, Math.min(100, Math.abs(y2 - y1) * 0.4 + 40));
        cp1X = x1 - offset;
        cp2X = x2 - offset;
      }

      const pathD = `M ${x1} ${y1} C ${cp1X} ${y1}, ${cp2X} ${y2}, ${x2} ${y2}`;
      const midX = 0.125 * x1 + 0.375 * cp1X + 0.375 * cp2X + 0.125 * x2;
      const midY = (y1 + y2) / 2;

      const strokeColor = join.isPipeline ? colors.pipelineLine : (join.isSubqueryRef || join.isOracleOuter || join.isImplicit) ? colors.implicitLine : colors.joinLine;
      const dashAttr = (!join.isPipeline && (join.isSubqueryRef || join.isOracleOuter || join.isImplicit)) ? ' stroke-dasharray="5 3"' : '';
      const labelText = this.formatJoinLabel(join);
      let textPx = 0;
      for (const ch of labelText) textPx += /[^\x00-\xff]/.test(ch) ? 12 : 7.2;
      const badgeW = Math.max(82, Math.round(textPx + 20));

      minX = Math.min(minX, x1 - 20, x2 - 20, midX - badgeW / 2);
      maxX = Math.max(maxX, x1 + 20, x2 + 20, midX + badgeW / 2);
      minY = Math.min(minY, y1 - 20, y2 - 20, midY - 20);
      maxY = Math.max(maxY, y1 + 20, y2 + 20, midY + 20);

      linksSvg += `<g>`;
      linksSvg += `<path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="2"${dashAttr}/>`;
      linksSvg += `<circle cx="${x1}" cy="${y1}" r="8" fill="#2196f3"/><text x="${x1}" y="${y1 + 3.5}" fill="#ffffff" font-size="9" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif">L</text>`;
      linksSvg += `<circle cx="${x2}" cy="${y2}" r="8" fill="#d97706"/><text x="${x2}" y="${y2 + 3.5}" fill="#ffffff" font-size="9" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif">R</text>`;
      linksSvg += `<rect x="${midX - badgeW / 2}" y="${midY - 11}" width="${badgeW}" height="22" rx="5" fill="${colors.badgeBg}" stroke="${strokeColor}" stroke-width="1.2"/>`;
      linksSvg += `<text x="${midX}" y="${midY + 3.5}" fill="${colors.badgeText}" font-size="11" font-weight="bold" text-anchor="middle" font-family="system-ui, sans-serif">${this.escapeXml(labelText)}</text>`;
      linksSvg += `</g>`;
    });

    const pad = 40;
    const vx = Math.floor(minX - pad);
    const vy = Math.floor(minY - pad);
    const vw = Math.ceil((maxX - minX) + pad * 2);
    const vh = Math.ceil((maxY - minY) + pad * 2);

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vx} ${vy} ${vw} ${vh}" width="${vw}" height="${vh}">
  <rect x="${vx}" y="${vy}" width="${vw}" height="${vh}" fill="${colors.bg}"/>
  <g id="cardsLayer">${cardsSvg}</g>
  <g id="linksLayer">${linksSvg}</g>
</svg>`;
  }

  /**
   * 日本語コメント: 現在のビジュアライザをSVGファイルとしてダウンロード保存
   */
  exportSVG() {
    const svgString = this.generateSvgString();
    if (!svgString) {
      alert(t('queryVis.noExportData'));
      return;
    }
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query-visualization-${Date.now()}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * 日本語コメント: 現在のビジュアライザを高解像度PNG画像としてダウンロード保存
   * 大規模な場合はフリーズやメモリクラッシュを防ぐため、事前警告および安全スケールでの出力を実施 (ER図ビュー準拠)
   */
  exportPNG() {
    const svgString = this.generateSvgString();
    if (!svgString) {
      alert(t('queryVis.noExportData'));
      return;
    }

    // SVG文字列からキャンバスの寸法を取得
    const widthMatch = svgString.match(/width="([^"]+)"/);
    const heightMatch = svgString.match(/height="([^"]+)"/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : 800;
    const height = heightMatch ? parseFloat(heightMatch[1]) : 600;

    // 大規模判定 (高負荷・クラッシュリスクの事前検知)
    const tableCount = (this.parsedResult && Array.isArray(this.parsedResult.tables)) ? this.parsedResult.tables.length : 0;
    const isLarge = width >= 3500 || height >= 3500 || (width * height) >= 12000000 || tableCount >= 15;

    // 事前警告ダイアログ (SVG出力を推奨しつつ、1x安全モードでの続行を確認)
    if (isLarge) {
      const msg = t('queryVis.exportPngWarning', { width: Math.round(width), height: Math.round(height) });
      if (!confirm(msg)) {
        return;
      }
    }

    // スケール決定 (大規模時は安全重視で1.0倍、通常時は2.0倍。ただし上限サイズでクランプ)
    let scaleFactor = isLarge ? 1.0 : 2.0;
    const maxDimension = 8192;
    const maxPixels = 25000000;
    if ((width * scaleFactor > maxDimension) || (height * scaleFactor > maxDimension)) {
      scaleFactor = Math.min(scaleFactor, maxDimension / Math.max(width, height));
    }
    if ((width * scaleFactor) * (height * scaleFactor) > maxPixels) {
      scaleFactor = Math.min(scaleFactor, Math.sqrt(maxPixels / (width * height)));
    }

    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const renderWidth = img.width || width;
      const renderHeight = img.height || height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(renderWidth * scaleFactor);
      canvas.height = Math.round(renderHeight * scaleFactor);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(scaleFactor, scaleFactor);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) return;
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = `query-visualization-${Date.now()}.png`;
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      } else {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  renderPanelContent() {
    const container = this.element.querySelector('#qvPanelContent');
    if (!container || !this.parsedResult) return;

    if (this.parsedResult.error) {
      container.innerHTML = `
        <div style="padding: 10px; background: rgba(244, 67, 54, 0.15); border: 1px solid #f44336; border-radius: 4px; color: #ff8a80; font-size: 0.78rem;">
          ⚠️ <strong>${escapeHtml(this.parsedResult.error)}</strong><br>
          <span style="font-size: 0.72rem; opacity: 0.8;">${t('queryVis.regexFallbackNote')}</span>
        </div>
      `;
      return;
    }

    if (this.activeTab === 'select') {
      const cols = this.parsedResult.selectColumns || [];
      if (cols.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); font-size:0.8rem; text-align:center;">${t('queryVis.noSelectCols')}</div>`;
        return;
      }
      container.innerHTML = `
        <table class="qv-table">
          <thead>
            <tr>
              <th>${t('queryVis.colTable')}</th>
              <th>${t('queryVis.colColumn')}</th>
              <th>${t('queryVis.colAlias')}</th>
            </tr>
          </thead>
          <tbody>
            ${cols.map((c, idx) => {
              const key = `${(c.tableAlias || '').toLowerCase()}.${(c.columnName || '').toLowerCase()}`;
              const isHl = this.highlightedSelectKey === key;
              const exists = this.checkColumnExists(c.tableAlias, c.columnName);
              return `
                <tr class="qv-clickable-row ${isHl ? 'is-highlighted' : ''}" data-sel-idx="${idx}" data-sel-key="${escapeHtml(key)}" data-alias="${escapeHtml((c.tableAlias || '').toLowerCase())}">
                  <td><span class="qv-badge qv-badge-pk">${escapeHtml(c.tableAlias || '-')}</span></td>
                  <td>
                    <code>${escapeHtml(c.columnName)}</code>
                    ${!exists ? `<span class="qv-warn-badge">⚠️ ${t('queryVis.warnNotFound')}</span>` : ''}
                  </td>
                  <td>${c.alias && c.alias !== c.columnName ? `<span style="color:#4ec9b0;">${escapeHtml(c.alias)}</span>` : '-'}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      container.querySelectorAll('tr[data-sel-key]').forEach(row => {
        row.addEventListener('click', () => {
          const key = row.getAttribute('data-sel-key');
          const alias = row.getAttribute('data-alias');
          this.highlightedSelectKey = (this.highlightedSelectKey === key) ? null : key;
          this.highlightedJoinIndex = null;
          this.highlightedWhereIndex = null;
          this.renderPanelContent();
          this.applyCanvasHighlights();
          if (this.highlightedSelectKey && alias) {
            this.focusCanvasOnAlias(alias);
          }
        });
      });
    } else if (this.activeTab === 'joins') {
      const joins = this.parsedResult.joins || [];
      if (joins.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); font-size:0.8rem; text-align:center;">${t('queryVis.noRelations')}</div>`;
        return;
      }
      container.innerHTML = `
        <table class="qv-table">
          <thead>
            <tr>
              <th>${t('queryVis.colRelation')}</th>
              <th>${t('queryVis.colJoinType')}</th>
              <th>${t('queryVis.colCondition')}</th>
            </tr>
          </thead>
          <tbody>
            ${joins.map((j, idx) => {
              const isHl = this.highlightedJoinIndex === idx;
              const hasIdx = j.isPipeline || j.isSubqueryRef ? true : this.checkColumnIndex(j.rightTableAlias, j.rightColumn);
              return `
                <tr class="qv-clickable-row ${isHl ? 'is-highlighted' : ''}" data-join-idx="${idx}">
                  <td><strong>${escapeHtml(j.leftTableAlias || '?')}</strong> ➔ <strong>${escapeHtml(j.rightTableAlias || '?')}</strong></td>
                  <td>
                    <span class="qv-badge ${j.isPipeline ? 'qv-badge-cte' : j.isSubqueryRef ? 'qv-badge-sub' : j.isImplicit ? 'qv-badge-implicit' : 'qv-badge-join'}">
                      ${escapeHtml(this.formatJoinLabel(j))}
                    </span>
                  </td>
                  <td style="font-family: var(--font-mono); font-size:0.72rem;">
                    ${escapeHtml(j.condition || '-')}
                    ${!hasIdx ? `<span class="qv-warn-badge">⚠️ ${t('queryVis.warnNoIndex')}</span>` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      container.querySelectorAll('tr[data-join-idx]').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.getAttribute('data-join-idx'), 10);
          this.highlightedJoinIndex = (this.highlightedJoinIndex === idx) ? null : idx;
          this.highlightedSelectKey = null;
          this.highlightedWhereIndex = null;
          this.renderPanelContent();
          this.applyCanvasHighlights();
          if (this.highlightedJoinIndex !== null) {
            const j = joins[idx];
            if (j) this.focusCanvasOnAlias(j.leftTableAlias || j.rightTableAlias);
          }
        });
      });
    } else if (this.activeTab === 'where') {
      const wheres = this.parsedResult.whereConditions || [];
      if (wheres.length === 0) {
        container.innerHTML = `<div style="color:var(--text-secondary); font-size:0.8rem; text-align:center;">${t('queryVis.noWhereConds')}</div>`;
        return;
      }
      container.innerHTML = `
        <table class="qv-table">
          <thead>
            <tr>
              <th>${t('queryVis.colTarget')}</th>
              <th>${t('queryVis.colWhereCond')}</th>
            </tr>
          </thead>
          <tbody>
            ${wheres.map((w, idx) => {
              const isHl = this.highlightedWhereIndex === idx;
              let hasIdx = true;
              if (w.targetAlias && !['GLOBAL', 'HAVING'].includes(w.targetAlias.toUpperCase()) && w.condition) {
                const colMatch = w.condition.match(/(?:[a-zA-Z0-9_$]+\.)?([a-zA-Z0-9_$]+)\s*(?:=|<>|!=|>|<|>=|<=|\bIN\b|\bLIKE\b)/i);
                if (colMatch && colMatch[1]) {
                  hasIdx = this.checkColumnIndex(w.targetAlias, colMatch[1]);
                }
              }
              return `
                <tr class="qv-clickable-row ${isHl ? 'is-highlighted' : ''}" data-where-idx="${idx}" data-alias="${escapeHtml((w.targetAlias || '').toLowerCase())}">
                  <td><span class="qv-badge qv-badge-pk">${escapeHtml(w.targetAlias)}</span></td>
                  <td style="font-family: var(--font-mono); font-size:0.72rem;">
                    ${escapeHtml(w.condition)}
                    ${!hasIdx ? `<span class="qv-warn-badge">⚠️ ${t('queryVis.warnNoIndex')}</span>` : ''}
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      `;

      container.querySelectorAll('tr[data-where-idx]').forEach(row => {
        row.addEventListener('click', () => {
          const idx = parseInt(row.getAttribute('data-where-idx'), 10);
          const alias = row.getAttribute('data-alias');
          this.highlightedWhereIndex = (this.highlightedWhereIndex === idx) ? null : idx;
          this.highlightedSelectKey = null;
          this.highlightedJoinIndex = null;
          this.renderPanelContent();
          this.applyCanvasHighlights();
          if (this.highlightedWhereIndex !== null && alias && alias !== 'global' && alias !== 'having') {
            this.focusCanvasOnAlias(alias);
          }
        });
      });
    }
  }

  /**
   * 日本語コメント: エンティティカード内のカラム一覧HTMLを生成（折りたたみ対応・ER図準拠）
   * @param {Object} table - テーブルノード情報
   * @param {boolean} isFolded - 折りたたみ状態かどうか
   * @param {number} maxFoldCol - 折りたたみ閾値（デフォルト10）
   * @returns {string} カラム行HTML文字列
   */
  renderNodeFieldsHtml(table, isFolded, maxFoldCol) {
    const columns = table.columns || [];
    const fieldCount = columns.length;
    if (fieldCount === 0) {
      return `
        <div style="padding: 12px; color: var(--text-secondary); font-size: 0.74rem; text-align: center;">
          カラム情報なし
        </div>
      `;
    }

    const visibleCols = (isFolded && fieldCount > maxFoldCol)
      ? columns.slice(0, maxFoldCol)
      : columns;

    const rowsHtml = visibleCols.map(col => {
      const hasUsage = col.isSelect || col.isJoin || col.isWhere;
      const colLabel = col.logicalName || col.note || '';
      return `
        <div class="qv-field-row ${hasUsage ? 'is-active-col' : ''}" data-field="${(col.name || '').toLowerCase()}">
          <div class="qv-field-left">
            <span class="qv-field-marker">${col.isPk ? '🔑' : '•'}</span>
            <span class="qv-field-name" title="${col.name}">${col.name}</span>
            ${colLabel ? `<span class="qv-field-note" title="${colLabel}">(${colLabel})</span>` : ''}
          </div>
          <div class="qv-field-right">
            <span class="qv-field-type">${col.type || ''}</span>
            <div class="qv-field-icons">
              ${col.isSelect ? `<span class="qv-col-icon sel" title="${t('queryVis.iconSelectTip')}">✅</span>` : ''}
              ${col.isJoin ? `<span class="qv-col-icon jn" title="${t('queryVis.iconJoinTip')}">🔗</span>` : ''}
              ${col.isWhere ? `<span class="qv-col-icon wh" title="${t('queryVis.iconWhereTip')}">🔍</span>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const moreHtml = (isFolded && fieldCount > maxFoldCol)
      ? `<div class="qv-field-more-row">${t('erd.more_columns', { count: fieldCount - maxFoldCol })}</div>`
      : '';

    return rowsHtml + moreHtml;
  }

  /**
   * 日本語コメント: JOIN・CTE・サブクエリ依存関係に基づく階層型トポロジカル自動配置座標を計算 (v1準拠)
   */
  computeTopologicalPositions(tables, joins) {
    const layers = new Map();
    const inDegree = new Map();

    tables.forEach(t => {
      const a = t.alias.toLowerCase();
      layers.set(a, 0);
      inDegree.set(a, 0);
    });

    joins.forEach(j => {
      const left = (j.leftTableAlias || '').toLowerCase();
      const right = (j.rightTableAlias || '').toLowerCase();
      if (left && right && left !== right && inDegree.has(right) && inDegree.has(left)) {
        inDegree.set(right, inDegree.get(right) + 1);
      }
    });

    const queue = [];
    tables.forEach(t => {
      const a = t.alias.toLowerCase();
      if (inDegree.get(a) === 0) {
        queue.push(a);
      }
    });

    const visited = new Set();
    while (queue.length > 0) {
      const curr = queue.shift();
      visited.add(curr);
      const currLayer = layers.get(curr) || 0;

      joins.forEach(j => {
        const left = (j.leftTableAlias || '').toLowerCase();
        const right = (j.rightTableAlias || '').toLowerCase();
        if (left === curr && right && layers.has(right) && !visited.has(right)) {
          layers.set(right, Math.max(layers.get(right) || 0, currLayer + 1));
          queue.push(right);
        }
      });
    }

    const layerGroups = new Map();
    tables.forEach(t => {
      const a = t.alias.toLowerCase();
      const l = layers.get(a) || 0;
      if (!layerGroups.has(l)) layerGroups.set(l, []);
      layerGroups.get(l).push(a);
    });

    const posMap = new Map();
    const startX = 60;
    const startY = 60;
    const layerWidth = 420;
    const rowHeight = 320;

    Array.from(layerGroups.keys()).sort((a, b) => a - b).forEach(l => {
      const group = layerGroups.get(l);
      group.forEach((aliasKey, rIdx) => {
        posMap.set(aliasKey, {
          x: startX + l * layerWidth,
          y: startY + rIdx * rowHeight
        });
      });
    });

    return posMap;
  }

  /**
   * キャンバス上にテーブルノードをトポロジカル階層配置し、リレーション線を描画
   */
  layoutAndRenderCanvas() {
    const nodesContainer = this.element.querySelector('#qvNodesContainer');
    if (!nodesContainer || !this.parsedResult) return;

    nodesContainer.innerHTML = '';
    this.nodePositions.clear();

    const tables = this.parsedResult.tables || [];
    if (tables.length === 0) return;

    // 日本語コメント: ER図と共通の折りたたみ閾値設定を取得（未設定時は10カラム）
    const maxFoldCol = (appStore.state.config && appStore.state.config.maxFoldColumnCount !== undefined)
      ? appStore.state.config.maxFoldColumnCount
      : 10;

    const joins = this.parsedResult.joins || [];
    const topoCoords = this.computeTopologicalPositions(tables, joins);
    const allWheres = this.parsedResult.whereConditions || [];

    tables.forEach((table) => {
      const aliasKey = table.alias.toLowerCase();
      const coord = topoCoords.get(aliasKey) || { x: 60, y: 60 };
      const x = coord.x;
      const y = coord.y;

      this.nodePositions.set(aliasKey, { x, y, width: 280, height: 240 });

      const fieldCount = (table.columns || []).length;
      const canFold = fieldCount > maxFoldCol;
      if (!canFold) {
        this.foldedNodes.set(aliasKey, false);
      } else if (!this.foldedNodes.has(aliasKey)) {
        // 日本語コメント: 閾値を超えるテーブルは初期状態で折りたたむ
        this.foldedNodes.set(aliasKey, true);
      }
      const isFolded = Boolean(this.foldedNodes.get(aliasKey));

      const isCteKind = table.type === 'cte' || table.type === 'cte_ref';
      const card = document.createElement('div');
      card.className = `qv-node-card type-${isCteKind ? 'cte' : table.type}`;
      card.setAttribute('data-alias', aliasKey);
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;

      const badgeHtml = table.type === 'cte' ? '<span class="qv-badge qv-badge-cte">WITH (CTE)</span>' :
                        table.type === 'cte_ref' ? '<span class="qv-badge qv-badge-cte">CTE REF</span>' :
                        table.type === 'subquery' ? '<span class="qv-badge qv-badge-sub">SubQuery</span>' :
                        '<span class="qv-badge qv-badge-pk">TABLE</span>';

      const tableWheres = [];
      allWheres.forEach((w, wIdx) => {
        if ((w.targetAlias || '').toLowerCase() === aliasKey) {
          tableWheres.push({ idx: wIdx, condition: w.condition });
        }
      });

      const wheresHtml = tableWheres.length > 0 ? `
        <div class="qv-node-wheres">
          ${tableWheres.map(w => `
            <div class="qv-where-badge" data-where-idx="${w.idx}" title="${w.condition}">
              <span>🔍</span>
              <span class="qv-where-badge-text">${escapeHtml(w.condition)}</span>
            </div>
          `).join('')}
        </div>
      ` : '';

      card.innerHTML = `
        <div class="qv-node-header">
          <div class="qv-node-title-wrap">
            <div class="qv-node-title" title="${escapeHtml(table.name)}">
              <span>${isCteKind ? '🗂️' : table.type === 'subquery' ? '📦' : '🗄️'}</span>
              <span>${escapeHtml(table.alias)}</span>
              <span style="font-size:0.7rem; opacity:0.7; font-weight:normal;">(${escapeHtml(table.name)})</span>
            </div>
            ${table.logicalName ? `<div class="qv-node-logical" title="${escapeHtml(table.logicalName)}">${escapeHtml(table.logicalName)}</div>` : ''}
          </div>
          <div class="qv-node-actions">
            ${badgeHtml}
            ${canFold ? `
              <button type="button" class="qv-node-fold-btn" title="${isFolded ? t('erd.btn_unfold') : t('erd.btn_fold')}">
                ${isFolded ? '🔽' : '🔼'}
              </button>
            ` : ''}
          </div>
        </div>
        <div class="qv-node-fields">
          ${this.renderNodeFieldsHtml(table, isFolded, maxFoldCol)}
        </div>
        ${wheresHtml}
      `;

      // 日本語コメント: 折りたたみボタンのクリックイベント（ER図と同じ操作感で位置を保持したまま開閉）
      const btnFold = card.querySelector('.qv-node-fold-btn');
      if (btnFold) {
        btnFold.addEventListener('mousedown', (e) => {
          e.stopPropagation();
        });
        btnFold.addEventListener('click', (e) => {
          e.stopPropagation();
          const nextFolded = !Boolean(this.foldedNodes.get(aliasKey));
          this.foldedNodes.set(aliasKey, nextFolded);

          btnFold.textContent = nextFolded ? '🔽' : '🔼';
          btnFold.setAttribute('title', nextFolded ? t('erd.btn_unfold') : t('erd.btn_fold'));

          const fieldsEl = card.querySelector('.qv-node-fields');
          if (fieldsEl) {
            fieldsEl.innerHTML = this.renderNodeFieldsHtml(table, nextFolded, maxFoldCol);
          }

          requestAnimationFrame(() => {
            const pos = this.nodePositions.get(aliasKey);
            if (pos) {
              pos.width = card.offsetWidth || 280;
              pos.height = card.offsetHeight || 240;
            }
            this.renderLinks();
          });
        });
      }

      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('.qv-node-fold-btn')) return;
        e.stopPropagation();
        this.dragTargetNode = card;
        this.dragOffsetX = e.clientX - (card.offsetLeft * this.scale + this.panX);
        this.dragOffsetY = e.clientY - (card.offsetTop * this.scale + this.panY);
      });

      nodesContainer.appendChild(card);
    });

    requestAnimationFrame(() => {
      tables.forEach(table => {
        const card = nodesContainer.querySelector(`[data-alias="${table.alias.toLowerCase()}"]`);
        if (card) {
          const pos = this.nodePositions.get(table.alias.toLowerCase());
          if (pos) {
            pos.width = card.offsetWidth || 280;
            pos.height = card.offsetHeight || 240;
          }
        }
      });
      this.renderLinks();
    });
  }

  /**
   * 日本語コメント: 結合種別コードを直感的な表示ラベル（i18n対応）へ整形
   * @param {Object} join - JOIN情報オブジェクト
   * @returns {string} 表示用ラベル
   */
  formatJoinLabel(join) {
    const raw = String((join && join.joinType) || 'JOIN').trim();
    const upper = raw.toUpperCase();

    if (upper === 'IMPLICIT JOIN' || upper === 'IMPLICIT') {
      return t('queryVis.joinTypeImplicit');
    }
    if (upper === 'CORRELATED') {
      return t('queryVis.joinTypeCorrelated');
    }
    if (upper === 'CTE_SOURCE') {
      return t('queryVis.joinTypeCteSource');
    }
    if (upper === 'OUTER JOIN (+)') {
      return t('queryVis.joinTypeOuterPlus');
    }
    if (upper === 'LEFT OUTER JOIN (+)') {
      return 'LEFT JOIN (+)';
    }
    if (upper === 'RIGHT OUTER JOIN (+)') {
      return 'RIGHT JOIN (+)';
    }
    const subMatch = raw.match(/^SUBQUERY\s*\((.+)\)$/i);
    if (subMatch) {
      return t('queryVis.joinTypeSubquery', { ctx: subMatch[1] });
    }
    return raw;
  }

  /**
   * ノード間・カラム行間のリレーション線 (SVGグループ: 線 + [L]/[R]端点バッジ + 中央ラベル) を描画 (v1準拠)
   */
  renderLinks() {
    const svgGroup = this.element.querySelector('#qvLinksGroup');
    const nodesContainer = this.element.querySelector('#qvNodesContainer');
    if (!svgGroup || !this.parsedResult || !nodesContainer) return;

    svgGroup.innerHTML = '';
    const joins = this.parsedResult.joins || [];
    const svgNs = 'http://www.w3.org/2000/svg';

    joins.forEach((join, idx) => {
      const leftAlias = (join.leftTableAlias || '').toLowerCase();
      const rightAlias = (join.rightTableAlias || '').toLowerCase();

      const leftPos = this.nodePositions.get(leftAlias);
      const rightPos = this.nodePositions.get(rightAlias);

      if (!leftPos || !rightPos) return;

      const leftCard = nodesContainer.querySelector(`[data-alias="${leftAlias}"]`);
      const rightCard = nodesContainer.querySelector(`[data-alias="${rightAlias}"]`);

      // 左側・右側の結合カラムポートY座標の算出
      let leftYOffset = leftPos.height / 2;
      let rightYOffset = rightPos.height / 2;

      if (leftCard && join.leftColumn) {
        const leftColEl = leftCard.querySelector(`[data-field="${join.leftColumn.toLowerCase()}"]`);
        if (leftColEl) {
          leftYOffset = leftColEl.offsetTop + leftColEl.offsetHeight / 2;
        } else {
          const moreEl = leftCard.querySelector('.qv-field-more-row');
          if (moreEl) leftYOffset = moreEl.offsetTop + moreEl.offsetHeight / 2;
        }
      }

      if (rightCard && join.rightColumn) {
        const rightColEl = rightCard.querySelector(`[data-field="${join.rightColumn.toLowerCase()}"]`);
        if (rightColEl) {
          rightYOffset = rightColEl.offsetTop + rightColEl.offsetHeight / 2;
        } else {
          const moreEl = rightCard.querySelector('.qv-field-more-row');
          if (moreEl) rightYOffset = moreEl.offsetTop + moreEl.offsetHeight / 2;
        }
      }

      const y1 = leftPos.y + leftYOffset;
      const y2 = rightPos.y + rightYOffset;

      // 日本語コメント: カードの左右配置関係に応じて接続辺とベジェ制御点を算出（v1準拠）
      const leftRightEdge = leftPos.x + leftPos.width;
      const rightRightEdge = rightPos.x + rightPos.width;
      let x1, x2, cp1X, cp2X;

      if (leftRightEdge <= rightPos.x) {
        // 左テーブル (L) が完全に右テーブル (R) の左側にある
        x1 = leftRightEdge + 8;
        x2 = rightPos.x - 8;
        const offset = Math.max(40, Math.min(120, Math.abs(x2 - x1) / 2));
        cp1X = x1 + offset;
        cp2X = x2 - offset;
      } else if (rightRightEdge <= leftPos.x) {
        // 左テーブル (L) が完全に右テーブル (R) の右側にある
        x1 = leftPos.x - 8;
        x2 = rightRightEdge + 8;
        const offset = Math.max(40, Math.min(120, Math.abs(x2 - x1) / 2));
        cp1X = x1 - offset;
        cp2X = x2 + offset;
      } else if (leftPos.x <= rightPos.x) {
        // 水平方向に重なっている場合（左辺同士から外へ出す）
        x1 = leftPos.x - 8;
        x2 = rightPos.x - 8;
        const offset = Math.max(50, Math.min(100, Math.abs(y2 - y1) * 0.4 + 40));
        cp1X = x1 - offset;
        cp2X = x2 - offset;
      } else {
        // 水平方向に重なっている場合（右辺同士から外へ出す）
        x1 = leftRightEdge + 8;
        x2 = rightRightEdge + 8;
        const offset = Math.max(50, Math.min(100, Math.abs(y2 - y1) * 0.4 + 40));
        cp1X = x1 + offset;
        cp2X = x2 + offset;
      }

      const pathData = `M ${x1} ${y1} C ${cp1X} ${y1}, ${cp2X} ${y2}, ${x2} ${y2}`;

      // 3次ベジェ曲線の中点 (t = 0.5) を算出してラベルバッジを線上に配置
      const midX = 0.125 * x1 + 0.375 * cp1X + 0.375 * cp2X + 0.125 * x2;
      const midY = (y1 + y2) / 2;

      let linkTypeClass = 'link-join';
      if (join.isPipeline) {
        linkTypeClass = 'link-pipeline';
      } else if (join.isSubqueryRef || join.isOracleOuter || join.isImplicit) {
        linkTypeClass = 'link-implicit';
      }

      const group = document.createElementNS(svgNs, 'g');
      group.setAttribute('class', `qv-join-group ${linkTypeClass}`);
      group.setAttribute('data-join-idx', String(idx));

      const labelText = this.formatJoinLabel(join);

      const title = document.createElementNS(svgNs, 'title');
      title.textContent = `[${labelText}] ${join.leftTableAlias || '?'} ➔ ${join.rightTableAlias || '?'} : ${join.condition || ''}`;
      group.appendChild(title);

      // クリック判定用の透明太線パス
      const hitPath = document.createElementNS(svgNs, 'path');
      hitPath.setAttribute('d', pathData);
      hitPath.setAttribute('class', 'qv-link-hit');
      group.appendChild(hitPath);

      // 表示用のリレーション線パス
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', pathData);
      path.setAttribute('class', `qv-link-path ${linkTypeClass}`);
      group.appendChild(path);

      // 左(駆動側)端点 [L] バッジ
      const dotL = document.createElementNS(svgNs, 'circle');
      dotL.setAttribute('class', 'qv-join-dot-l');
      dotL.setAttribute('cx', String(x1));
      dotL.setAttribute('cy', String(y1));
      dotL.setAttribute('r', '8');
      group.appendChild(dotL);

      const textL = document.createElementNS(svgNs, 'text');
      textL.setAttribute('class', 'qv-join-dot-text');
      textL.setAttribute('x', String(x1));
      textL.setAttribute('y', String(y1 + 3.5));
      textL.textContent = 'L';
      group.appendChild(textL);

      // 右(被結合側)端点 [R] バッジ
      const dotR = document.createElementNS(svgNs, 'circle');
      dotR.setAttribute('class', 'qv-join-dot-r');
      dotR.setAttribute('cx', String(x2));
      dotR.setAttribute('cy', String(y2));
      dotR.setAttribute('r', '8');
      group.appendChild(dotR);

      const textR = document.createElementNS(svgNs, 'text');
      textR.setAttribute('class', 'qv-join-dot-text');
      textR.setAttribute('x', String(x2));
      textR.setAttribute('y', String(y2 + 3.5));
      textR.textContent = 'R';
      group.appendChild(textR);

      // 中央結合タイプラベルバッジ（全角文字を考慮した幅計算）
      let textPx = 0;
      for (const ch of labelText) {
        textPx += /[^\x00-\xff]/.test(ch) ? 12 : 7.2;
      }
      const badgeW = Math.max(82, Math.round(textPx + 20));
      const badgeRect = document.createElementNS(svgNs, 'rect');
      badgeRect.setAttribute('class', 'qv-join-badge-rect');
      badgeRect.setAttribute('x', String(midX - badgeW / 2));
      badgeRect.setAttribute('y', String(midY - 11));
      badgeRect.setAttribute('width', String(badgeW));
      badgeRect.setAttribute('height', '22');
      badgeRect.setAttribute('rx', '5');
      group.appendChild(badgeRect);

      const badgeText = document.createElementNS(svgNs, 'text');
      badgeText.setAttribute('class', 'qv-line-label');
      badgeText.setAttribute('x', String(midX));
      badgeText.setAttribute('y', String(midY + 3.5));
      badgeText.textContent = labelText;
      group.appendChild(badgeText);

      // 日本語コメント: キャンバス上の結合線・ラベルクリックで左パネルと相互ハイライト
      group.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });
      group.addEventListener('click', (e) => {
        e.stopPropagation();
        this.highlightedJoinIndex = (this.highlightedJoinIndex === idx) ? null : idx;
        this.highlightedSelectKey = null;
        this.highlightedWhereIndex = null;
        if (this.highlightedJoinIndex !== null && this.activeTab !== 'joins') {
          this.activeTab = 'joins';
          this.element.querySelectorAll('.qv-panel-nav-tab').forEach(t => {
            t.classList.toggle('active', t.getAttribute('data-tab') === 'joins');
          });
        }
        this.renderPanelContent();
        this.applyCanvasHighlights();
      });

      svgGroup.appendChild(group);
    });

    // 日本語コメント: 再描画後も左パネルのハイライト状態を維持
    this.applyCanvasHighlights();
  }
}
