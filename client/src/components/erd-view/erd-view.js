// 日本語コメント: ER図メインビューコンポーネント (client/src/components/erd-view/erd-view.js)
// スキーマのテーブルおよびリレーション定義を元に、仮想キャンバス上へテーブルカードと
// SVGベジェ曲線リレーションをインタラクティブに描画し、ドラッグ配置・ズーム・パン・レイアウト永続化を提供します。

import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { logger } from '../../core/logger.js';
import { metadataManager } from '../../core/metadata-manager.js';
import { i18n } from '../../core/i18n.js';
import { generateShortId } from '../../core/id-generator.js';
import { renderTableColorBar } from '../../core/table-colors.js';
import './erd-view.css';

export class DbeErdView {
  constructor(container) {
    this.container = container;
    this.currentErdId = null;
    this.layoutData = null; // { info, nodes, edges, memos, boxes }

    // ビューポート状態
    this.scale = 1.0;
    this.panX = 50;
    this.panY = 50;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;

    // 表示設定
    this.displayMode = 'physical'; // 'physical' | 'logical'
    this.searchQuery = '';
    this.snapToGrid = false;
    this.showFKs = true;
    this.showMemos = true;
    this.showNotes = true;
    this.showBoxes = true;

    // 選択中のテーブルノード名、所属スキーマ名、インスタンスID（選択ハイライト・dimmed探索用）
    this.selectedTableName = null;
    this.selectedSchemaName = null;
    this.selectedInstanceId = null;
    this.selectedNodeInstanceId = null;

    // ドラッグ中のノード
    this.draggedNode = null;
    this.dragStartMouseX = 0;
    this.dragStartMouseY = 0;
    this.dragStartNodeX = 0;
    this.dragStartNodeY = 0;

    // ドラッグ中のメモ
    this.draggedMemo = null;

    // ドラッグ中のスキーマノート
    this.draggedSchemaNote = null;

    // ドラッグ中のグループ枠
    this.draggedBox = null;

    // リレーション手動接続ドラッグ情報
    this.connectingSource = null; // { tableName, fieldName, portX, portY }

    // 編集中のリレーション
    this.editingEdge = null;

    // 編集中のテーブル別名対象ノード
    this.editingNodeForAlias = null;

    // 編集中のグループ枠
    this.editingBox = null;
    this.selectedBoxColor = '#3b82f6';

    // 編集中のスキーマノート
    this.editingSchemaNote = null;
    this.selectedNoteColor = '#3b82f6';

    // DOM要素参照
    this.element = null;
    this.canvasElement = null;
    this.nodesLayer = null;
    this.memosLayer = null;
    this.schemaNotesLayer = null;
    this.boxesLayer = null;
    this.svgLayer = null;
    this.zoomText = null;
    this.infoCardEl = null;

    this.render();
    this.bindEvents();
    this.subscribeStore();
  }

  render() {
    this.container.innerHTML = `
      <div class="erd-view-wrapper">
        <!-- 右上操作コントロール（開閉トグルヘッダー付き） -->
        <div class="erd-top-controls" id="erd-top-controls">
          <div class="erd-top-controls-toggle" id="erd-top-controls-toggle" title="${i18n.t('erd.controls_toggle_tip')}">
            <div class="erd-controls-header-left">
              <span>⚙️</span>
              <span>${i18n.t('erd.controls_title')}</span>
            </div>
            <span class="erd-controls-arrow" id="erd-controls-arrow">▲</span>
          </div>
          <div class="erd-top-controls-content" id="erd-top-controls-content">
            <div class="erd-search-wrapper">
              <input type="text" class="erd-search-input" id="erd-search-input" placeholder="${i18n.t('erd.search_placeholder')}" />
              <button type="button" class="erd-search-clear-btn" id="btn-erd-search-clear" title="${i18n.t('erd.search_clear_tip')}" aria-label="Clear">✕</button>
            </div>
            <button type="button" class="btn-erd-action" id="btn-add-memo" title="${i18n.t('erd.add_memo_tip')}">
              <span>📝</span>
              <span>${i18n.t('erd.add_memo')}</span>
            </button>
            <button type="button" class="btn-erd-action" id="btn-add-box" title="${i18n.t('erd.add_box_tip')}">
              <span>📦</span>
              <span>${i18n.t('erd.add_box')}</span>
            </button>
            <div class="erd-toggle-group">
              <label class="erd-toggle-label" title="${i18n.t('erd.snap_tip')}"><input type="checkbox" id="chk-snap-grid"><span>${i18n.t('erd.snap')}</span></label>
              <!-- 日本語コメント: ワイド幅オプショントグル（340px拡張） -->
              <label class="erd-toggle-label" title="${i18n.t('erd.wide_tip')}">
                <input type="checkbox" id="chk-wide-mode">
                <span>${i18n.t('erd.wide')}</span>
              </label>
              <label class="erd-toggle-label" title="${i18n.t('erd.fks_tip')}"><input type="checkbox" id="chk-show-fks" checked><span>${i18n.t('erd.fks')}</span></label>
              <label class="erd-toggle-label" title="${i18n.t('erd.memos_tip')}"><input type="checkbox" id="chk-show-memos" checked><span>${i18n.t('erd.memos')}</span></label>
              <label class="erd-toggle-label" title="${i18n.t('erd.notes_tip')}"><input type="checkbox" id="chk-show-notes" checked><span>${i18n.t('erd.notes')}</span></label>
              <label class="erd-toggle-label" title="${i18n.t('erd.boxes_tip')}"><input type="checkbox" id="chk-show-boxes" checked><span>${i18n.t('erd.boxes')}</span></label>
            </div>
            <select class="erd-select-mode" id="erd-display-mode-select">
              <option value="physical">${i18n.t('erd.mode_physical')}</option>
              <option value="logical">${metadataManager.getLogicalNameLabel('erdModeOption')}</option>
            </select>
            <button type="button" class="btn-save-erd-layout" id="btn-save-erd-layout">
              <span>💾</span>
              <span>${i18n.t('erd.save')}</span>
            </button>
          </div>
        </div>

        <!-- メイン描画キャンバスコンテナ -->
        <div class="erd-container" id="erd-main-container">
          <div class="erd-canvas" id="erd-canvas-layer">
            <div class="erd-boxes-layer" id="erd-boxes-layer"></div>
            <svg class="erd-svg-layer" id="erd-svg-layer"></svg>
            <div class="erd-notes-layer" id="erd-notes-layer"></div>
            <div class="erd-memos-layer" id="erd-memos-layer"></div>
            <div class="erd-nodes-layer" id="erd-nodes-layer"></div>
          </div>
        </div>

        <!-- 下部フローティングツールバー -->
        <div class="erd-bottom-toolbar">
          <button type="button" id="btn-erd-zoom-in" title="${i18n.t('erd.zoom_in')}">➕</button>
          <button type="button" id="btn-erd-zoom-out" title="${i18n.t('erd.zoom_out')}">➖</button>
          <span class="erd-zoom-text" id="erd-zoom-level">100%</span>
          <button type="button" id="btn-erd-zoom-reset" title="${i18n.t('erd.zoom_reset')}">1:1</button>
          <div class="separator"></div>
          <button type="button" id="btn-erd-fit-view" title="${i18n.t('erd.fit_view_tip')}">🎯 ${i18n.t('erd.fit_view')}</button>
          <button type="button" id="btn-erd-auto-layout" title="${i18n.t('erd.auto_layout_tip')}">📐 ${i18n.t('erd.auto_layout')}</button>
          <div class="separator"></div>
          <button type="button" id="btn-erd-export-svg" title="${i18n.t('erd.export_svg_tip')}">📊 ${i18n.t('erd.export_svg')}</button>
          <button type="button" id="btn-erd-export-png" title="${i18n.t('erd.export_png_tip')}">🖼️ ${i18n.t('erd.export_png')}</button>
        </div>

        <!-- リレーション編集モーダル -->
        <div class="erd-modal-backdrop hidden" id="erd-edge-modal-backdrop">
          <div class="erd-edge-modal">
            <div class="erd-edge-modal-header">
              <h3>${i18n.t('erd.modal_relation_title')}</h3>
              <button type="button" class="erd-edge-modal-close" id="btn-close-edge-modal">&times;</button>
            </div>
            <div class="erd-edge-modal-body">
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_from')}</label>
                <div class="erd-modal-endpoint" id="edge-modal-from">table.col</div>
              </div>
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_to')}</label>
                <div class="erd-modal-endpoint" id="edge-modal-to">table.col</div>
              </div>
              <div class="erd-modal-form-group">
                <label for="edge-modal-type">${i18n.t('erd.modal_cardinality')}</label>
                <select class="erd-modal-select" id="edge-modal-type">
                  <option value="many-to-one">${i18n.t('erd.cardinality_m_1')}</option>
                  <option value="one-to-many">${i18n.t('erd.cardinality_1_m')}</option>
                  <option value="one-to-one">${i18n.t('erd.cardinality_1_1')}</option>
                  <option value="many-to-many">${i18n.t('erd.cardinality_m_m')}</option>
                  <option value="many-to-zero-one">${i18n.t('erd.cardinality_m_01')}</option>
                  <option value="zero-one-to-many">${i18n.t('erd.cardinality_01_m')}</option>
                  <option value="one-to-zero-one">${i18n.t('erd.cardinality_1_01')}</option>
                  <option value="zero-one-to-one">${i18n.t('erd.cardinality_01_1')}</option>
                </select>
              </div>
              <div class="erd-modal-form-group">
                <label for="edge-modal-label">${i18n.t('erd.modal_label')}</label>
                <input type="text" class="erd-modal-input" id="edge-modal-label" placeholder="${i18n.t('erd.modal_label_placeholder')}" />
              </div>
            </div>
            <div class="erd-edge-modal-footer">
              <button type="button" class="btn-modal-delete" id="btn-delete-edge">${i18n.t('erd.modal_btn_delete')}</button>
              <div class="erd-modal-actions-right">
                <button type="button" class="btn-modal-cancel" id="btn-cancel-edge">${i18n.t('erd.modal_btn_cancel')}</button>
                <button type="button" class="btn-modal-save" id="btn-save-edge">${i18n.t('erd.modal_btn_save')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- テーブル別名（Alias）設定モーダル -->
        <div class="erd-modal-backdrop hidden" id="erd-alias-modal-backdrop">
          <div class="erd-edge-modal">
            <div class="erd-edge-modal-header">
              <h3>${i18n.t('erd.modal_alias_title')}</h3>
              <button type="button" class="erd-edge-modal-close" id="btn-close-alias-modal">&times;</button>
            </div>
            <div class="erd-edge-modal-body">
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_alias_table_name')}</label>
                <div class="erd-modal-endpoint" id="alias-modal-table-name">table</div>
              </div>
              <div class="erd-modal-form-group">
                <label for="alias-modal-input">${i18n.t('erd.modal_alias_label')}</label>
                <input type="text" class="erd-modal-input" id="alias-modal-input" placeholder="${i18n.t('erd.modal_alias_placeholder')}" />
              </div>
            </div>
            <div class="erd-edge-modal-footer">
              <div></div>
              <div class="erd-modal-actions-right">
                <button type="button" class="btn-modal-cancel" id="btn-cancel-alias">${i18n.t('erd.modal_btn_cancel')}</button>
                <button type="button" class="btn-modal-save" id="btn-save-alias">${i18n.t('erd.modal_btn_save')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- グループ枠（Box）編集モーダル -->
        <div class="erd-modal-backdrop hidden" id="erd-box-modal-backdrop">
          <div class="erd-edge-modal">
            <div class="erd-edge-modal-header">
              <h3>${i18n.t('erd.modal_box_title')}</h3>
              <button type="button" class="erd-edge-modal-close" id="btn-close-box-modal">&times;</button>
            </div>
            <div class="erd-edge-modal-body">
              <div class="erd-modal-form-group">
                <label for="box-modal-label-input">${i18n.t('erd.modal_box_group_name')}</label>
                <input type="text" class="erd-modal-input" id="box-modal-label-input" placeholder="${i18n.t('erd.box_placeholder')}" />
              </div>
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_box_color')}</label>
                <div class="erd-box-color-palette" id="box-modal-color-palette">
                  <button type="button" class="erd-color-swatch" data-color="#4b5563" style="background:#4b5563" title="${i18n.t('erd.swatch_gray')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#3b82f6" style="background:#3b82f6" title="${i18n.t('erd.swatch_blue')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#10b981" style="background:#10b981" title="${i18n.t('erd.swatch_green')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#f59e0b" style="background:#f59e0b" title="${i18n.t('erd.swatch_amber')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#ef4444" style="background:#ef4444" title="${i18n.t('erd.swatch_red')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#8b5cf6" style="background:#8b5cf6" title="${i18n.t('erd.swatch_purple')}"></button>
                </div>
              </div>
            </div>
            <div class="erd-edge-modal-footer">
              <button type="button" class="btn-modal-delete" id="btn-delete-box-modal">${i18n.t('erd.modal_btn_delete')}</button>
              <div class="erd-modal-actions-right">
                <button type="button" class="btn-modal-cancel" id="btn-cancel-box-modal">${i18n.t('erd.modal_btn_cancel')}</button>
                <button type="button" class="btn-modal-save" id="btn-save-box-modal">${i18n.t('erd.modal_btn_save')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- スキーマノート設定（枠色）編集モーダル -->
        <div class="erd-modal-backdrop hidden" id="erd-note-modal-backdrop">
          <div class="erd-edge-modal">
            <div class="erd-edge-modal-header">
              <h3>${i18n.t('erd.modal_note_title')}</h3>
              <button type="button" class="erd-edge-modal-close" id="btn-close-note-modal">&times;</button>
            </div>
            <div class="erd-edge-modal-body">
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_note_name')}</label>
                <div class="erd-modal-endpoint" id="note-modal-name">Note</div>
              </div>
              <div class="erd-modal-form-group">
                <label>${i18n.t('erd.modal_note_color')}</label>
                <div class="erd-box-color-palette" id="note-modal-color-palette">
                  <button type="button" class="erd-color-swatch" data-color="#3b82f6" style="background:#3b82f6" title="${i18n.t('erd.swatch_blue')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#10b981" style="background:#10b981" title="${i18n.t('erd.swatch_green')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#f59e0b" style="background:#f59e0b" title="${i18n.t('erd.swatch_amber')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#ef4444" style="background:#ef4444" title="${i18n.t('erd.swatch_red')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#8b5cf6" style="background:#8b5cf6" title="${i18n.t('erd.swatch_purple')}"></button>
                  <button type="button" class="erd-color-swatch" data-color="#4b5563" style="background:#4b5563" title="${i18n.t('erd.swatch_gray')}"></button>
                </div>
              </div>
            </div>
            <div class="erd-edge-modal-footer">
              <div></div>
              <div class="erd-modal-actions-right">
                <button type="button" class="btn-modal-cancel" id="btn-cancel-note-modal">${i18n.t('erd.modal_btn_cancel')}</button>
                <button type="button" class="btn-modal-save" id="btn-save-note-modal">${i18n.t('erd.modal_btn_save')}</button>
              </div>
            </div>
          </div>
        </div>

        <!-- ER図情報（タイトル・バージョン・説明）編集モーダル -->
        <div class="erd-modal-backdrop hidden" id="erd-info-modal-backdrop">
          <div class="erd-edge-modal erd-info-modal">
            <div class="erd-edge-modal-header">
              <h3>${i18n.t('erd.modal_info_title')}</h3>
              <button type="button" class="erd-edge-modal-close" id="btn-close-info-modal">&times;</button>
            </div>
            <div class="erd-edge-modal-body">
              <div class="erd-modal-form-group">
                <label for="info-modal-title-input">${i18n.t('erd.modal_info_name')}</label>
                <input type="text" class="erd-modal-input" id="info-modal-title-input" placeholder="ER Diagram..." />
              </div>
              <div class="erd-modal-form-group">
                <label for="info-modal-version-input">${i18n.t('erd.modal_info_version')}</label>
                <input type="text" class="erd-modal-input" id="info-modal-version-input" placeholder="1.0.0" />
              </div>
              <div class="erd-modal-form-group">
                <label for="info-modal-memo-input">${i18n.t('erd.modal_info_memo')}</label>
                <textarea class="erd-modal-textarea erd-info-memo-textarea" id="info-modal-memo-input" rows="5" placeholder="${i18n.t('erd.modal_info_memo_placeholder')}"></textarea>
              </div>
            </div>
            <div class="erd-edge-modal-footer">
              <div></div>
              <div class="erd-modal-actions-right">
                <button type="button" class="btn-modal-cancel" id="btn-cancel-info-modal">${i18n.t('erd.modal_btn_cancel')}</button>
                <button type="button" class="btn-modal-save" id="btn-save-info-modal">${i18n.t('erd.modal_btn_save')}</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.element = this.container.querySelector('.erd-view-wrapper');
    this.canvasElement = this.container.querySelector('#erd-canvas-layer');
    this.canvasLayer = this.canvasElement; // 日本語コメント: キャンバスレイヤー参照保持
    this.nodesLayer = this.container.querySelector('#erd-nodes-layer');
    this.memosLayer = this.container.querySelector('#erd-memos-layer');
    this.schemaNotesLayer = this.container.querySelector('#erd-notes-layer');
    this.boxesLayer = this.container.querySelector('#erd-boxes-layer');
    this.svgLayer = this.container.querySelector('#erd-svg-layer');
    this.zoomText = this.container.querySelector('#erd-zoom-level');
    this.erdTitleEl = this.container.querySelector('#erd-badge-title');

    this.updateCanvasTransform();
  }

  bindEvents() {
    const mainContainer = this.container.querySelector('#erd-main-container');

    // 0. 左ツリーからのテーブル Drag & Drop 受け入れ
    mainContainer.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });

    mainContainer.addEventListener('drop', (e) => {
      e.preventDefault();
      const rawData = e.dataTransfer.getData('text/plain');
      if (!rawData) return;
      let dragData;
      try {
        dragData = JSON.parse(rawData);
      } catch (_) {
        return;
      }

      if (dragData && dragData.type === 'Table' && dragData.tableName) {
        const rect = mainContainer.getBoundingClientRect();
        let canvasX = Math.round((e.clientX - rect.left - this.panX) / this.scale);
        let canvasY = Math.round((e.clientY - rect.top - this.panY) / this.scale);

        // グリッド吸着の適用
        if (this.snapToGrid) {
          canvasX = Math.round(canvasX / 20) * 20;
          canvasY = Math.round(canvasY / 20) * 20;
        }
        if (canvasX < 10) canvasX = 10;
        if (canvasY < 10) canvasY = 10;

        if (!this.layoutData) return;
        if (!this.layoutData.nodes) this.layoutData.nodes = [];

        // 日本語コメント: 接頭辞なしBase62 10桁のShortIDをインスタンスIDとして採番
        const dragSchema = dragData.schema || appStore.state.activeSchema || '';
        const newInstanceId = generateShortId(10);

        // 重なり防止ループ (近接配置時は 25px ずつずらす)
        let overlap = true;
        while (overlap) {
          overlap = this.layoutData.nodes.some(n => Math.abs(n.x - canvasX) < 20 && Math.abs(n.y - canvasY) < 20);
          if (overlap) {
            canvasX += 25;
            canvasY += 25;
          }
        }

        // 新規ノード追加 (所属スキーマ情報および個別インスタンスIDを保持)
        this.layoutData.nodes.push({
          instanceId: newInstanceId,
          schema: dragSchema,
          table_name: dragData.tableName,
          alias: '',
          x: canvasX,
          y: canvasY,
          folded: false,
        });

        this.draw();
        this.selectTable(dragData.tableName, dragSchema);
      } else if (dragData && dragData.type === 'Note' && dragData.noteName) {
        // 日本語コメント: スキーマノート (DBML Note) のキャンバスD&D配置処理
        const rect = mainContainer.getBoundingClientRect();
        let canvasX = Math.round((e.clientX - rect.left - this.panX) / this.scale);
        let canvasY = Math.round((e.clientY - rect.top - this.panY) / this.scale);

        if (this.snapToGrid) {
          canvasX = Math.round(canvasX / 20) * 20;
          canvasY = Math.round(canvasY / 20) * 20;
        }
        if (canvasX < 10) canvasX = 10;
        if (canvasY < 10) canvasY = 10;

        if (!this.layoutData) return;
        this.layoutData.notes = this.layoutData.notes || [];

        // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
        const noteShortId = generateShortId(10);
        const dragSchema = dragData.schema || appStore.state.activeSchema || '';

        this.layoutData.notes.push({
          noteShortId: noteShortId,
          schema: dragSchema,
          note: dragData.noteName,
          x: canvasX,
          y: canvasY,
          width: 220,
          height: 140,
          color: '#3b82f6',
        });

        this.draw();
      }
    });

    // キャンバス背景クリック時の選択解除
    mainContainer.addEventListener('click', (e) => {
      if (
        e.target.closest('.erd-table-card') ||
        e.target.closest('.erd-memo-card') ||
        e.target.closest('.erd-schema-note-card') ||
        e.target.closest('.erd-box-card') ||
        e.target.closest('.erd-info-card') ||
        e.target.closest('.erd-bottom-toolbar') ||
        e.target.closest('.erd-top-controls') ||
        e.target.closest('.erd-port') ||
        e.target.closest('.erd-edge-modal') ||
        e.target.closest('.erd-title-badge') ||
        e.target.closest('.erd-edge-badge')
      ) {
        return;
      }
      this.clearSelection();
    });

    // 1. キャンバスのパン（平行移動）
    mainContainer.addEventListener('mousedown', (e) => {
      // ノードカード・メモカード・スキーマノート・ボックス・ツールバー上でのクリックはパン開始から除外
      if (
        e.target.closest('.erd-table-card') ||
        e.target.closest('.erd-memo-card') ||
        e.target.closest('.erd-schema-note-card') ||
        e.target.closest('.erd-box-card') ||
        e.target.closest('.erd-info-card') ||
        e.target.closest('.erd-bottom-toolbar') ||
        e.target.closest('.erd-top-controls') ||
        e.target.closest('.erd-port') ||
        e.target.closest('.erd-edge-modal')
      ) {
        return;
      }
      this.isPanning = true;
      this.panStartX = e.clientX - this.panX;
      this.panStartY = e.clientY - this.panY;
      mainContainer.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isPanning) {
        this.panX = e.clientX - this.panStartX;
        this.panY = e.clientY - this.panStartY;
        this.updateCanvasTransform();
      } else if (this.connectingSource) {
        // 手動リレーション接続のドラッグ中 (仮線の描画)
        const rect = mainContainer.getBoundingClientRect();
        const canvasMouseX = (e.clientX - rect.left - this.panX) / this.scale;
        const canvasMouseY = (e.clientY - rect.top - this.panY) / this.scale;

        let tempLine = this.svgLayer.querySelector('#erd-temp-line');
        if (!tempLine) {
          tempLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          tempLine.setAttribute('id', 'erd-temp-line');
          this.svgLayer.appendChild(tempLine);
        }
        tempLine.setAttribute('x1', this.connectingSource.portX);
        tempLine.setAttribute('y1', this.connectingSource.portY);
        tempLine.setAttribute('x2', canvasMouseX);
        tempLine.setAttribute('y2', canvasMouseY);
      } else if (this.draggedNode) {
        // ノードのドラッグ移動
        const dx = (e.clientX - this.dragStartMouseX) / this.scale;
        const dy = (e.clientY - this.dragStartMouseY) / this.scale;
        let newX = Math.round(this.dragStartNodeX + dx);
        let newY = Math.round(this.dragStartNodeY + dy);
        if (this.snapToGrid) {
          newX = Math.round(newX / 20) * 20;
          newY = Math.round(newY / 20) * 20;
        }
        if (newX < 10) newX = 10;
        if (newY < 10) newY = 10;

        this.draggedNode.element.style.left = `${newX}px`;
        this.draggedNode.element.style.top = `${newY}px`;
        this.draggedNode.data.x = newX;
        this.draggedNode.data.y = newY;

        // リレーション線をリアルタイム再描画
        this.drawEdges();
      } else if (this.draggedMemo) {
        // メモのドラッグ移動
        const dx = (e.clientX - this.dragStartMouseX) / this.scale;
        const dy = (e.clientY - this.dragStartMouseY) / this.scale;
        let newX = Math.round(this.dragStartNodeX + dx);
        let newY = Math.round(this.dragStartNodeY + dy);
        if (this.snapToGrid) {
          newX = Math.round(newX / 20) * 20;
          newY = Math.round(newY / 20) * 20;
        }
        if (newX < 10) newX = 10;
        if (newY < 10) newY = 10;

        this.draggedMemo.element.style.left = `${newX}px`;
        this.draggedMemo.element.style.top = `${newY}px`;
        this.draggedMemo.data.x = newX;
        this.draggedMemo.data.y = newY;
      } else if (this.draggedSchemaNote) {
        // 日本語コメント: スキーマノートのドラッグ移動
        const dx = (e.clientX - this.dragStartMouseX) / this.scale;
        const dy = (e.clientY - this.dragStartMouseY) / this.scale;
        let newX = Math.round(this.dragStartNodeX + dx);
        let newY = Math.round(this.dragStartNodeY + dy);
        if (this.snapToGrid) {
          newX = Math.round(newX / 20) * 20;
          newY = Math.round(newY / 20) * 20;
        }
        if (newX < 10) newX = 10;
        if (newY < 10) newY = 10;

        this.draggedSchemaNote.element.style.left = `${newX}px`;
        this.draggedSchemaNote.element.style.top = `${newY}px`;
        this.draggedSchemaNote.data.x = newX;
        this.draggedSchemaNote.data.y = newY;
      } else if (this.draggedBox) {
        // グループ枠のドラッグ移動
        const dx = (e.clientX - this.dragStartMouseX) / this.scale;
        const dy = (e.clientY - this.dragStartMouseY) / this.scale;
        let newX = Math.round(this.dragStartNodeX + dx);
        let newY = Math.round(this.dragStartNodeY + dy);
        if (this.snapToGrid) {
          newX = Math.round(newX / 20) * 20;
          newY = Math.round(newY / 20) * 20;
        }
        if (newX < 10) newX = 10;
        if (newY < 10) newY = 10;

        this.draggedBox.element.style.left = `${newX}px`;
        this.draggedBox.element.style.top = `${newY}px`;
        this.draggedBox.data.x = newX;
        this.draggedBox.data.y = newY;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (this.isPanning) {
        this.isPanning = false;
        mainContainer.style.cursor = 'grab';
      }

      if (this.connectingSource) {
        // 手動リレーション線の接続ドロップ判定
        const tempLine = this.svgLayer.querySelector('#erd-temp-line');
        if (tempLine) tempLine.remove();

        // ドロップ先のカラム行判定
        const targetRow = e.target.closest('.erd-field-row');
        if (targetRow) {
          const targetTable = targetRow.getAttribute('data-table');
          const targetField = targetRow.getAttribute('data-field');
          const targetSchema = targetRow.getAttribute('data-schema') || '';
          const sourceSchema = this.connectingSource.schemaName || '';
          const targetCard = targetRow.closest('.erd-table-card');
          const targetInstanceId = targetCard ? targetCard.getAttribute('data-instance-id') : null;

          // 自己接続（同一インスタンスまたは同一テーブルかつ同一スキーマ）でなければリレーション作成
          const isSameInstance = this.connectingSource.instanceId && targetInstanceId && this.connectingSource.instanceId === targetInstanceId;
          const isSameTable = targetTable === this.connectingSource.tableName && targetSchema === sourceSchema && !this.connectingSource.instanceId;
          if (targetTable && !isSameInstance && !isSameTable) {
            this.createManualEdge(
              { instanceId: this.connectingSource.instanceId, tableName: this.connectingSource.tableName, fieldName: this.connectingSource.fieldName, schema: sourceSchema },
              { instanceId: targetInstanceId, tableName: targetTable, fieldName: targetField, schema: targetSchema }
            );
          }
        }

        this.connectingSource = null;
      }

      if (this.draggedNode) this.draggedNode = null;
      if (this.draggedMemo) this.draggedMemo = null;
      if (this.draggedSchemaNote) this.draggedSchemaNote = null;
      if (this.draggedBox) this.draggedBox = null;

      // リサイズやドラッグ終了時にDOMの最新座標・サイズを自動同期
      this.syncDomToLayout();
    });

    // 2. マウスホイールによるスクロール / Ctrl+ホイールによるズーム
    mainContainer.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (e.ctrlKey) {
        // カーソル位置を中心としたズーム
        const zoomFactor = 0.05;
        const rect = mainContainer.getBoundingClientRect();
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

    // 3. ツールバーのズーム・整列・エクスポートボタン
    this.container.querySelector('#btn-erd-zoom-in').addEventListener('click', () => {
      const rect = mainContainer.getBoundingClientRect();
      this.zoomAt(1.15, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    this.container.querySelector('#btn-erd-zoom-out').addEventListener('click', () => {
      const rect = mainContainer.getBoundingClientRect();
      this.zoomAt(0.85, rect.left + rect.width / 2, rect.top + rect.height / 2);
    });

    this.container.querySelector('#btn-erd-zoom-reset').addEventListener('click', () => {
      this.scale = 1.0;
      this.updateCanvasTransform();
    });

    this.container.querySelector('#btn-erd-fit-view').addEventListener('click', () => {
      this.fitView();
    });

    this.container.querySelector('#btn-erd-auto-layout').addEventListener('click', () => {
      this.autoLayoutGrid();
    });

    this.container.querySelector('#btn-erd-export-svg').addEventListener('click', () => {
      this.exportSVG();
    });

    this.container.querySelector('#btn-erd-export-png').addEventListener('click', () => {
      this.exportPNG();
    });

    // 4. 表示モード切替
    const modeSelect = this.container.querySelector('#erd-display-mode-select');
    modeSelect.addEventListener('change', (e) => {
      this.displayMode = e.target.value;
      this.draw();
    });

    // 5. 検索ボックス入力およびクリアボタン
    const searchInput = this.container.querySelector('#erd-search-input');
    const searchClearBtn = this.container.querySelector('#btn-erd-search-clear');

    // 日本語コメント: クリアボタンの表示/非表示トグル更新処理
    const updateClearButtonVisibility = () => {
      if (searchClearBtn) {
        if (searchInput.value.length > 0) {
          searchClearBtn.classList.add('visible');
        } else {
          searchClearBtn.classList.remove('visible');
        }
      }
    };

    // 日本語コメント: 検索クエリをクリアして再フィルタリングする共通処理
    const clearSearch = () => {
      searchInput.value = '';
      this.searchQuery = '';
      updateClearButtonVisibility();
      this.applySearchFilter();
      searchInput.focus();
    };

    searchInput.addEventListener('input', (e) => {
      this.searchQuery = e.target.value.trim().toLowerCase();
      updateClearButtonVisibility();
      this.applySearchFilter();
    });

    // 日本語コメント: Escapeキー押下による検索クリア
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && searchInput.value.length > 0) {
        e.preventDefault();
        clearSearch();
      }
    });

    if (searchClearBtn) {
      // 日本語コメント: クリアボタン押下による検索クリア
      searchClearBtn.addEventListener('click', () => {
        clearSearch();
      });
    }

    // 6. メモ追加ボタン
    this.container.querySelector('#btn-add-memo').addEventListener('click', () => {
      this.addMemo();
    });

    // 7. 枠追加ボタン
    this.container.querySelector('#btn-add-box').addEventListener('click', () => {
      this.addBox();
    });

    // 8. チェックボックストグル群
    this.container.querySelector('#chk-snap-grid').addEventListener('change', (e) => {
      this.snapToGrid = e.target.checked;
    });

    // 日本語コメント: ワイド幅オプショントグルのイベント
    const chkWide = this.container.querySelector('#chk-wide-mode');
    if (chkWide) {
      chkWide.addEventListener('change', (e) => {
        if (!this.layoutData) return;
        this.layoutData.tableWidth = e.target.checked ? 'wide' : 'normal';
        if (this.canvasLayer) {
          this.canvasLayer.classList.toggle('wide-mode', e.target.checked);
        }
        // 幅変更に伴うリレーション線ポート位置の即時再描画
        this.drawEdges();
      });
    }

    this.container.querySelector('#chk-show-fks').addEventListener('change', (e) => {
      this.showFKs = e.target.checked;
      this.svgLayer.style.display = this.showFKs ? 'block' : 'none';
    });

    this.container.querySelector('#chk-show-memos').addEventListener('change', (e) => {
      this.showMemos = e.target.checked;
      if (this.memosLayer) this.memosLayer.style.display = this.showMemos ? 'block' : 'none';
    });

    // 日本語コメント: スキーマノート表示トグル
    const chkShowNotes = this.container.querySelector('#chk-show-notes');
    if (chkShowNotes) {
      chkShowNotes.addEventListener('change', (e) => {
        this.showNotes = e.target.checked;
        if (this.schemaNotesLayer) this.schemaNotesLayer.style.display = this.showNotes ? 'block' : 'none';
      });
    }

    this.container.querySelector('#chk-show-boxes').addEventListener('change', (e) => {
      this.showBoxes = e.target.checked;
      if (this.boxesLayer) this.boxesLayer.style.display = this.showBoxes ? 'block' : 'none';
    });

    // 9. 保存ボタン
    this.container.querySelector('#btn-save-erd-layout').addEventListener('click', async () => {
      await this.saveLayout();
    });

    // 10. リレーション編集モーダルのイベント
    this.container.querySelector('#btn-close-edge-modal').addEventListener('click', () => {
      this.closeEdgeModal();
    });
    this.container.querySelector('#btn-cancel-edge').addEventListener('click', () => {
      this.closeEdgeModal();
    });
    this.container.querySelector('#btn-save-edge').addEventListener('click', () => {
      this.saveEdgeModal();
    });
    this.container.querySelector('#btn-delete-edge').addEventListener('click', () => {
      this.deleteEdgeModal();
    });

    // 11. テーブル別名（Alias）設定モーダルのイベント
    this.container.querySelector('#btn-close-alias-modal').addEventListener('click', () => {
      this.closeTableAliasModal();
    });
    this.container.querySelector('#btn-cancel-alias').addEventListener('click', () => {
      this.closeTableAliasModal();
    });
    this.container.querySelector('#btn-save-alias').addEventListener('click', () => {
      this.saveTableAliasModal();
    });
    this.container.querySelector('#alias-modal-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveTableAliasModal();
      }
    });

    // 12. グループ枠編集モーダルのイベント
    this.container.querySelector('#btn-close-box-modal').addEventListener('click', () => {
      this.closeBoxModal();
    });
    this.container.querySelector('#btn-cancel-box-modal').addEventListener('click', () => {
      this.closeBoxModal();
    });
    this.container.querySelector('#btn-save-box-modal').addEventListener('click', () => {
      this.saveBoxModal();
    });
    this.container.querySelector('#btn-delete-box-modal').addEventListener('click', () => {
      this.deleteBoxModal();
    });
    // カラーパレット選択
    const swatches = this.container.querySelectorAll('.erd-box-color-palette .erd-color-swatch');
    swatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        swatches.forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        this.selectedBoxColor = swatch.getAttribute('data-color') || '#3b82f6';
      });
    });

    // 13. スキーマノート設定モーダルのイベント
    const btnCloseNoteModal = this.container.querySelector('#btn-close-note-modal');
    if (btnCloseNoteModal) btnCloseNoteModal.addEventListener('click', () => this.closeNoteModal());
    const btnCancelNoteModal = this.container.querySelector('#btn-cancel-note-modal');
    if (btnCancelNoteModal) btnCancelNoteModal.addEventListener('click', () => this.closeNoteModal());
    const btnSaveNoteModal = this.container.querySelector('#btn-save-note-modal');
    if (btnSaveNoteModal) btnSaveNoteModal.addEventListener('click', () => this.saveNoteModal());
    const noteSwatches = this.container.querySelectorAll('#note-modal-color-palette .erd-color-swatch');
    noteSwatches.forEach(swatch => {
      swatch.addEventListener('click', () => {
        noteSwatches.forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
        this.selectedNoteColor = swatch.getAttribute('data-color') || '#3b82f6';
      });
    });

    // 14. ER図情報（タイトル・バージョン）編集モーダルのイベント
    this.container.querySelector('#btn-close-info-modal').addEventListener('click', () => {
      this.closeInfoModal();
    });
    this.container.querySelector('#btn-cancel-info-modal').addEventListener('click', () => {
      this.closeInfoModal();
    });
    this.container.querySelector('#btn-save-info-modal').addEventListener('click', () => {
      this.saveInfoModal();
    });
    this.container.querySelector('#info-modal-title-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveInfoModal();
      }
    });

    // 14. 左上ER図インジケーターのダブルクリック編集
    const titleBadge = this.container.querySelector('.erd-title-badge');
    if (titleBadge) {
      titleBadge.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.openInfoModal();
      });
    }

    // 15. 右上コントロールパネルの開閉トグル（最小化/展開）
    const controlsPanel = this.container.querySelector('#erd-top-controls');
    const controlsToggle = this.container.querySelector('#erd-top-controls-toggle');
    const controlsArrow = this.container.querySelector('#erd-controls-arrow');
    if (controlsToggle && controlsPanel) {
      controlsToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isCollapsed = controlsPanel.classList.toggle('collapsed');
        if (controlsArrow) {
          controlsArrow.textContent = isCollapsed ? '▼' : '▲';
        }
      });
    }
  }

  subscribeStore() {
    // ERD変更イベント
    appStore.on('erd:changed', (erdData) => {
      if (erdData) {
        this.loadErd(erdData);
      } else {
        // 日本語コメント: ER図がクリアまたは削除された場合は描画状態とDOMを初期化
        this.clearErd();
      }
    });

    // スキーマ/モデル更新イベント
    appStore.on('model:updated', () => {
      if (this.currentErdId) {
        this.draw();
      }
    });
  }

  /**
   * キャンバスの拡大・縮小・平行移動を反映
   */
  updateCanvasTransform() {
    this.canvasElement.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    if (this.zoomText) {
      this.zoomText.textContent = `${Math.round(this.scale * 100)}%`;
    }
  }

  /**
   * 指定した座標を中心にズーム
   */
  zoomAt(factor, clientX, clientY) {
    const mainContainer = this.container.querySelector('#erd-main-container');
    const rect = mainContainer.getBoundingClientRect();
    const mouseX = clientX - rect.left;
    const mouseY = clientY - rect.top;

    const newScale = Math.min(Math.max(this.scale * factor, 0.25), 2.5);
    const scaleRatio = newScale / this.scale;

    this.panX = mouseX - (mouseX - this.panX) * scaleRatio;
    this.panY = mouseY - (mouseY - this.panY) * scaleRatio;
    this.scale = newScale;

    this.updateCanvasTransform();
  }

  /**
   * ERDデータのロード
   */
  loadErd(erdData) {
    this.currentErdId = erdData.id;
    this.layoutData = JSON.parse(JSON.stringify(erdData.content || {}));

    if (!this.layoutData.nodes) this.layoutData.nodes = [];
    if (!this.layoutData.edges) this.layoutData.edges = [];
    if (!this.layoutData.memos) this.layoutData.memos = [];
    if (!this.layoutData.notes) this.layoutData.notes = [];
    if (!this.layoutData.boxes) this.layoutData.boxes = [];
    if (!this.layoutData.info) this.layoutData.info = { description: erdData.name || 'ER Diagram', version: '1.0.0', memo: '' };

    // 日本語コメント: 既存ノードにinstanceIdが存在しない場合は補完 (10桁ランダム英数字ID)
    this.layoutData.nodes.forEach(n => {
      if (!n.instanceId) {
        n.instanceId = generateShortId(10);
      }
    });

    // 日本語コメント: v1仕様正規化 (既存エッジデータの table_instanceId 補完・移行)
    if (this.layoutData.edges) {
      this.layoutData.edges.forEach(edge => {
        if (!edge.from) edge.from = {};
        if (!edge.to) edge.to = {};

        // 1. table_instanceId の正規化 (instanceId からの移行)
        if (!edge.from.table_instanceId && edge.from.instanceId) {
          edge.from.table_instanceId = edge.from.instanceId;
        }
        if (!edge.to.table_instanceId && edge.to.instanceId) {
          edge.to.table_instanceId = edge.to.instanceId;
        }

        // 2. 古いレガシーデータ (table_name のみ) のインスタンスID補完
        if (!edge.from.table_instanceId && edge.from.table_name) {
          const found = this.layoutData.nodes.find(n => n.table_name === edge.from.table_name && (!edge.from.schema || n.schema === edge.from.schema));
          if (found) edge.from.table_instanceId = found.instanceId;
        }
        if (!edge.to.table_instanceId && edge.to.table_name) {
          const found = this.layoutData.nodes.find(n => n.table_name === edge.to.table_name && (!edge.to.schema || n.schema === edge.to.schema));
          if (found) edge.to.table_instanceId = found.instanceId;
        }
      });
    }

    if (this.erdTitleEl) {
      this.erdTitleEl.textContent = erdData.name || i18n.t('erd.title');
    }

    // 日本語コメント: テーブル幅設定（wide / normal）のUIおよびキャンバスクラスへの反映
    const isWide = this.layoutData.tableWidth === 'wide';
    const chkWide = this.container.querySelector('#chk-wide-mode');
    if (chkWide) {
      chkWide.checked = isWide;
    }
    if (this.canvasLayer) {
      this.canvasLayer.classList.toggle('wide-mode', isWide);
    }

    this.draw();
  }

  /**
   * ER図キャンバス・状態のリセット（プロジェクト新規作成・空状態・表示中ER図削除時）
   */
  clearErd() {
    this.currentErdId = null;
    this.layoutData = null;
    this.clearSelection();
    if (this.nodesLayer) this.nodesLayer.innerHTML = '';
    if (this.svgLayer) this.svgLayer.innerHTML = '';
    if (this.memosLayer) this.memosLayer.innerHTML = '';
    if (this.schemaNotesLayer) this.schemaNotesLayer.innerHTML = '';
    if (this.boxesLayer) this.boxesLayer.innerHTML = '';
    const infoCard = this.canvasElement?.querySelector('.erd-info-card');
    if (infoCard) infoCard.remove();
    if (this.erdTitleEl) this.erdTitleEl.textContent = i18n.t('erd.title');
  }

  /**
   * スキーマ名とテーブル名からテーブル定義と所属スキーマを取得
   * @param {string|null} schemaName - スキーマ名 (未指定時のみ横断探索)
   * @param {string} tableName - テーブル名
   * @returns {{ table: Object, schemaName: string } | null}
   */
  getTableDef(schemaName, tableName) {
    if (!tableName) return null;
    const schemas = appStore.state.schemas;

    // 1. スキーマ名が明示指定されている場合はそのスキーマ内のみ厳格に検索（他スキーマへフォールバックしない）
    if (schemaName) {
      if (schemas && schemas.has(schemaName)) {
        const sc = schemas.get(schemaName);
        const tbl = (sc.model?.tables || []).find(t => t.name === tableName);
        if (tbl) return { table: tbl, schemaName };
      }
      return null;
    }

    // 2. アクティブスキーマからの検索 (レガシーデータ等でスキーマ未指定時のみ)
    const activeSchema = appStore.state.activeSchema;
    if (activeSchema && schemas && schemas.has(activeSchema)) {
      const sc = schemas.get(activeSchema);
      const tbl = (sc.model?.tables || []).find(t => t.name === tableName);
      if (tbl) return { table: tbl, schemaName: activeSchema };
    }

    // 3. 全スキーマからの横断探索 (スキーマ未指定時のみ)
    if (schemas && schemas.size > 0) {
      for (const [scName, sc] of schemas.entries()) {
        const tbl = (sc.model?.tables || []).find(t => t.name === tableName);
        if (tbl) return { table: tbl, schemaName: scName };
      }
    }

    // 4. appStore.state.tables へのフォールバック (スキーマ未指定時のみ)
    const fallbackTbl = (appStore.state.tables || []).find(t => t.name === tableName);
    if (fallbackTbl) {
      return { table: fallbackTbl, schemaName: activeSchema || 'default' };
    }

    return null;
  }

  /**
   * スキーマ名、テーブル名、インスタンスIDからテーブルカードDOM要素を取得
   * @param {string|null} schemaName - スキーマ名 (未指定時のみテーブル名単体検索へフォールバック)
   * @param {string} tableName - テーブル名
   * @param {string|null} [instanceId=null] - インスタンス一意識別ID (指定時は他インスタンス・他スキーマへフォールバックしない)
   * @returns {HTMLElement|null}
   */
  getTableCardElement(schemaName, tableName, instanceId = null) {
    if (!this.nodesLayer) return null;

    // 1. instanceId が指定されている場合は該当インスタンスのみを検索し、見つからなければ即 null を返す
    if (instanceId) {
      return this.nodesLayer.querySelector(`#erd-node-${instanceId}`) ||
             this.nodesLayer.querySelector(`.erd-table-card[data-instance-id="${instanceId}"]`) ||
             null;
    }

    if (!tableName) return null;

    // 2. instanceId 未指定かつ schemaName 指定時は該当スキーマ・テーブルのみを検索し、見つからなければ即 null を返す
    if (schemaName) {
      const sanitizedSchema = schemaName.replace(/[^a-zA-Z0-9_-]/g, '_');
      return this.nodesLayer.querySelector(`#erd-node-${sanitizedSchema}_${tableName}`) ||
             this.nodesLayer.querySelector(`.erd-table-card[data-schema-name="${schemaName}"][data-table-name="${tableName}"]`) ||
             null;
    }

    // 3. instanceId・schemaName の両方未指定の場合のみ、テーブル名一致のカードを検索（後方互換性）
    return this.nodesLayer.querySelector(`.erd-table-card[data-table-name="${tableName}"]`) ||
           this.nodesLayer.querySelector(`#erd-node-${tableName}`);
  }

  /**
   * スキーマ定義のRef構造を正規化 (endpoints形式・from/to形式の両方に対応)
   */
  normalizeRef(ref) {
    if (!ref) return { fromTable: '', fromField: '', fromRelation: '1', toTable: '', toField: '', toRelation: '*' };
    if (ref.endpoints && ref.endpoints.length >= 2) {
      const ep1 = ref.endpoints[0];
      const ep2 = ref.endpoints[1];
      return {
        fromTable: ep1.tableName || '',
        fromField: (ep1.fieldNames && ep1.fieldNames[0]) || '',
        fromRelation: ep1.relation || '1',
        toTable: ep2.tableName || '',
        toField: (ep2.fieldNames && ep2.fieldNames[0]) || '',
        toRelation: ep2.relation || '*',
      };
    }
    return {
      fromTable: ref.fromTable || '',
      fromField: Array.isArray(ref.fromFields) ? ref.fromFields[0] : (ref.fromFields || ''),
      fromRelation: ref.fromRelation || '1',
      toTable: ref.toTable || '',
      toField: Array.isArray(ref.toFields) ? ref.toFields[0] : (ref.toFields || ''),
      toRelation: ref.toRelation || '*',
    };
  }

  /**
   * テーブル選択時の関連テーブル・線ハイライトおよび無関係要素のdimmed処理 (v1完全準拠・インスタンスID基準)
   * @param {string} tableName - テーブル名
   * @param {string|null} [schemaName=null] - スキーマ名
   * @param {string|null} [instanceId=null] - 選択したインスタンスID
   */
  selectTable(tableName, schemaName = null, instanceId = null) {
    // 日本語コメント: 選択の主キーを this.selectedNodeInstanceId とし、未指定時はインスタンスIDを補完
    if (!instanceId && tableName && this.layoutData?.nodes) {
      const found = this.layoutData.nodes.find(n => n.table_name === tableName && (!schemaName || n.schema === schemaName));
      if (found) instanceId = found.instanceId;
    }

    this.selectedNodeInstanceId = instanceId;
    this.selectedTableName = tableName;
    this.selectedSchemaName = schemaName;
    this.selectedInstanceId = instanceId;

    if (!this.selectedNodeInstanceId) {
      this.clearSelection();
      return;
    }

    // スキーマ自動FKリレーション情報の収集
    const allRefs = [];
    const schemas = appStore.state.schemas;
    if (schemas && schemas.size > 0) {
      for (const [scName, sc] of schemas.entries()) {
        const scRefs = sc.model?.refs || [];
        scRefs.forEach(r => allRefs.push({ ref: r, schemaName: scName }));
      }
    } else {
      (appStore.state.refs || []).forEach(r => allRefs.push({ ref: r, schemaName: appStore.state.activeSchema || '' }));
    }

    // 1. 各カードのハイライト / connected / dimmed 制御
    if (this.nodesLayer) {
      const cards = this.nodesLayer.querySelectorAll('.erd-table-card');
      cards.forEach(card => {
        const cInstId = card.getAttribute('data-instance-id');
        card.classList.remove('selected', 'connected', 'dimmed');
        const isSelected = (cInstId === this.selectedNodeInstanceId);

        if (isSelected) {
          card.classList.add('selected');
        } else {
          // 手動関連線による接続判定 (v1完全準拠: インスタンスID完全一致のみ)
          const connectedViaManual = (this.layoutData.edges || []).some(edge => {
            const fId = edge.from?.table_instanceId || edge.from?.instanceId;
            const tId = edge.to?.table_instanceId || edge.to?.instanceId;
            return (fId === this.selectedNodeInstanceId && tId === cInstId) ||
                   (tId === this.selectedNodeInstanceId && fId === cInstId);
          });

          // 自動FKによる接続判定 (v1完全準拠)
          const selectedNode = (this.layoutData.nodes || []).find(n => n.instanceId === this.selectedNodeInstanceId);
          const cNode = (this.layoutData.nodes || []).find(n => n.instanceId === cInstId);
          let connectedViaFK = false;
          if (selectedNode && cNode && this.showFKs) {
            // 日本語コメント: allRefs要素 { ref, schemaName } を分割代入し、同一スキーマ内の自動FK関連を判定
            connectedViaFK = allRefs.some(({ ref, schemaName: rSchema }) => {
              const norm = this.normalizeRef(ref);
              const targetSchema = rSchema || '';
              if (targetSchema === selectedNode.schema && targetSchema === cNode.schema) {
                const match1 = (norm.fromTable === selectedNode.table_name && norm.toTable === cNode.table_name);
                const match2 = (norm.toTable === selectedNode.table_name && norm.fromTable === cNode.table_name);
                return match1 || match2;
              }
              return false;
            });
          }

          const isConnected = connectedViaManual || connectedViaFK;
          if (isConnected) {
            card.classList.add('connected');
          } else {
            card.classList.add('dimmed');
          }
        }
      });
    }

    // 2. リレーション線およびバッジのハイライト / dimmed 制御
    if (this.svgLayer) {
      const lines = this.svgLayer.querySelectorAll('.erd-ref-line, .erd-edge-line');
      lines.forEach(line => {
        const fId = line.getAttribute('data-from-instance-id');
        const tId = line.getAttribute('data-to-instance-id');
        const isLineRelated = (fId === this.selectedNodeInstanceId || tId === this.selectedNodeInstanceId);
        line.classList.remove('highlight', 'dimmed');
        if (isLineRelated) {
          line.classList.add('highlight');
        } else {
          line.classList.add('dimmed');
        }
      });

      // 中央バッジおよび端点バッジの dimmed 制御
      const badges = this.svgLayer.querySelectorAll('.erd-edge-badge, .erd-cardinality-badge');
      badges.forEach(badge => {
        const fId = badge.getAttribute('data-from-instance-id');
        const tId = badge.getAttribute('data-to-instance-id');
        const isBadgeRelated = (fId === this.selectedNodeInstanceId || tId === this.selectedNodeInstanceId);
        badge.classList.remove('dimmed');
        if (!isBadgeRelated) {
          badge.classList.add('dimmed');
        }
      });
    }
  }

  /**
   * テーブル選択・ハイライトの全解除
   */
  clearSelection() {
    this.selectedTableName = null;
    this.selectedSchemaName = null;
    this.selectedInstanceId = null;
    this.selectedNodeInstanceId = null;
    if (this.nodesLayer) {
      const cards = this.nodesLayer.querySelectorAll('.erd-table-card');
      cards.forEach(card => card.classList.remove('selected', 'connected', 'dimmed'));
    }
    if (this.svgLayer) {
      const lines = this.svgLayer.querySelectorAll('.erd-ref-line, .erd-edge-line');
      lines.forEach(line => line.classList.remove('highlight', 'dimmed'));
      const badges = this.svgLayer.querySelectorAll('.erd-edge-badge, .erd-cardinality-badge');
      badges.forEach(badge => badge.classList.remove('dimmed'));
    }
  }

  /**
   * キャンバス全体の再描画
   * 強制全配置を撤廃し、layoutData.nodesに存在するテーブルのみを描画するオプトイン方式
   * 複数スキーマからの混在配置に対応
   */
  draw() {
    if (!this.currentErdId || !this.layoutData) return;

    this.nodesLayer.innerHTML = '';
    this.svgLayer.innerHTML = '';
    if (this.memosLayer) this.memosLayer.innerHTML = '';
    if (this.schemaNotesLayer) this.schemaNotesLayer.innerHTML = '';
    if (this.boxesLayer) this.boxesLayer.innerHTML = '';

    // 日本語コメント: ER図タイトル・バージョンスタンプ（キャンバス内浮動カード）の描画
    this.drawInfoCard();

    // グループ枠 (Boxes) の描画 (最背面)
    this.drawBoxes();

    // スキーマノートカードの描画
    this.drawSchemaNotes();

    // メモカードの描画
    this.drawMemos();

    // ノードが0件の場合は空キャンバス案内を表示
    if (!this.layoutData.nodes || this.layoutData.nodes.length === 0) {
      const guide = document.createElement('div');
      guide.className = 'erd-empty-canvas-guide';
      guide.innerHTML = `
        <div class="erd-empty-guide-icon">📥</div>
        <div class="erd-empty-guide-title">${i18n.t('erd.empty_title')}</div>
        <div class="erd-empty-guide-text">${i18n.t('erd.empty_desc')}</div>
      `;
      this.nodesLayer.appendChild(guide);
      return;
    }

    // ノードDOMの描画 (複数スキーマ対応: layoutData.nodes に登録されたテーブルを全スキーマから探索して描画)
    this.layoutData.nodes.forEach(node => {
      const def = this.getTableDef(node.schema, node.table_name);
      if (!def) return; // スキーマから削除されたテーブルはスキップ

      // node に schema が未設定の場合は補完
      if (!node.schema && def.schemaName) {
        node.schema = def.schemaName;
      }

      this.createTableCard(node, def.table, def.schemaName);
    });

    // リレーション線 (SVG) の描画
    this.drawEdges();

    // DOMレイアウト確定後に再度描画を同期 (フォントやカード高さ確定後のズレ防止)
    requestAnimationFrame(() => {
      this.drawEdges();
      if (this.selectedNodeInstanceId || this.selectedTableName) {
        this.selectTable(this.selectedTableName, this.selectedSchemaName, this.selectedNodeInstanceId || this.selectedInstanceId);
      }
    });

    // 検索フィルタの適用
    this.applySearchFilter();

    // 選択状態の復元
    if (this.selectedNodeInstanceId || this.selectedTableName) {
      this.selectTable(this.selectedTableName, this.selectedSchemaName, this.selectedNodeInstanceId || this.selectedInstanceId);
    }
  }

  /**
   * HTML特殊文字のエスケープ処理
   * @param {string} str
   * @returns {string}
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * ER図タイトル・バージョン情報スタンプカードの描画 (キャンバス内配置・浮動カード化)
   */
  drawInfoCard() {
    if (!this.canvasElement) return;

    let card = this.canvasElement.querySelector('.erd-info-card');
    if (!card) {
      card = document.createElement('div');
      card.className = 'erd-info-card';
      // 日本語コメント: ER図情報カードのツールチップ多言語化
      card.title = i18n.t('erd.title_tooltip');
      this.canvasElement.appendChild(card);

      // ダブルクリックで編集モーダルを表示
      card.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.openInfoModal();
      });
    }

    const title = this.layoutData?.info?.description || 'ER Diagram';
    const version = `v${this.layoutData?.info?.version || '1.0.0'}`;
    const memo = this.layoutData?.info?.memo || '';

    // 日本語コメント: 概要メモが存在する場合はタイトル・バージョン行の下に描画
    const memoHtml = memo
      ? `<div class="erd-info-card-memo">${this.escapeHtml(memo)}</div>`
      : '';

    card.innerHTML = `
      <div class="erd-info-card-header">
        <span class="erd-info-card-icon">🗺️</span>
        <h4 class="erd-info-card-title">${this.escapeHtml(title)}</h4>
      </div>
      <div class="erd-info-card-version">${this.escapeHtml(version)}</div>
      ${memoHtml}
    `;
  }

  /**
   * スキーマノートの本文（content または text）を取得
   */
  getSchemaNoteContent(schemaName, noteName) {
    if (!noteName) return '';
    const schemas = appStore.state.schemas;

    // ノートオブジェクトから本文を安全に抽出するヘルパー
    const extractNoteValue = (noteObj) => {
      if (!noteObj) return '';
      if (typeof noteObj.value === 'string') return noteObj.value;
      if (noteObj.value && typeof noteObj.value.value === 'string') return noteObj.value.value;
      if (typeof noteObj.content === 'string') return noteObj.content;
      if (typeof noteObj.text === 'string') return noteObj.text;
      return '';
    };

    if (schemaName && schemas && schemas.has(schemaName)) {
      const sc = schemas.get(schemaName);
      const noteObj = (sc.model?.notes || []).find(n => n.name === noteName);
      const val = extractNoteValue(noteObj);
      if (val) return val;
    }

    const activeSchema = appStore.state.activeSchema;
    if (activeSchema && schemas && schemas.has(activeSchema)) {
      const sc = schemas.get(activeSchema);
      const noteObj = (sc.model?.notes || []).find(n => n.name === noteName);
      const val = extractNoteValue(noteObj);
      if (val) return val;
    }

    // appStore.state.notes (フラットな配列) からの探索
    const stateNotes = appStore.state.notes || [];
    const stateNote = stateNotes.find(n => n.name === noteName);
    const stateVal = extractNoteValue(stateNote);
    if (stateVal) return stateVal;

    if (schemas && schemas.size > 0) {
      for (const [_, sc] of schemas.entries()) {
        const noteObj = (sc.model?.notes || []).find(n => n.name === noteName);
        const val = extractNoteValue(noteObj);
        if (val) return val;
      }
    }

    return '';
  }

  /**
   * スキーマノートカードの描画
   */
  drawSchemaNotes() {
    if (!this.schemaNotesLayer) return;
    this.schemaNotesLayer.innerHTML = '';
    const notes = this.layoutData?.notes || [];

    notes.forEach(note => {
      const card = document.createElement('div');
      card.className = 'erd-schema-note-card';
      card.id = `erd-note-${note.noteShortId}`;
      card.style.left = `${note.x || 100}px`;
      card.style.top = `${note.y || 100}px`;
      if (note.width) card.style.width = `${note.width}px`;
      if (note.height) card.style.height = `${note.height}px`;
      const cardColor = note.color || '#3b82f6';
      card.style.borderColor = cardColor;

      const rawContent = this.getSchemaNoteContent(note.schema, note.note);
      const dispContent = rawContent || i18n.t('erd.no_note_content');

      card.innerHTML = `
        <div class="erd-schema-note-header" style="background: ${this.escapeHtml(cardColor)};">
          <span class="erd-schema-note-title" title="${this.escapeHtml(note.note)}">ℹ️ ${this.escapeHtml(note.note)}</span>
          <button type="button" class="erd-schema-note-btn-delete" title="${i18n.t('erd.delete_note_tip')}">✕</button>
        </div>
        <div class="erd-schema-note-body">
          <div class="erd-schema-note-content">${this.escapeHtml(dispContent)}</div>
        </div>
      `;

      // カード上での mousedown イベント伝播抑止 (リサイズ中にキャンバスのパンが同時に始まるのを防ぐ)
      // 日本語コメント: 右下リサイズハンドル操作時に .is-resizing を付与し、リサイズ中のスクロール競合を完全防止
      card.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        const rect = card.getBoundingClientRect();
        const isResizeHandle = (e.clientX >= rect.right - 24) && (e.clientY >= rect.bottom - 24);
        if (isResizeHandle) {
          card.classList.add('is-resizing');
          const onMouseUp = () => {
            card.classList.remove('is-resizing');
            window.removeEventListener('mouseup', onMouseUp);
          };
          window.addEventListener('mouseup', onMouseUp);
        }
      });

      // 日本語コメント: リサイズ時に外枠コンテナ自体が勝手にスクロールして本文が上へ押し出されるのを防止
      card.addEventListener('scroll', () => {
        if (card.scrollTop !== 0) card.scrollTop = 0;
        if (card.scrollLeft !== 0) card.scrollLeft = 0;
      });

      // 日本語コメント: ResizeObserver によるサイズ変更検知とデータ同期（力技のscrollTop強制書き換えを撤廃）
      if (typeof window !== 'undefined' && window.ResizeObserver) {
        const ro = new ResizeObserver(() => {
          if (card.scrollTop !== 0) card.scrollTop = 0;
          if (card.scrollLeft !== 0) card.scrollLeft = 0;
          if (card.offsetWidth) note.width = card.offsetWidth;
          if (card.offsetHeight) note.height = card.offsetHeight;
        });
        ro.observe(card);
      }

      // 削除ボタン
      const btnDelete = card.querySelector('.erd-schema-note-btn-delete');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        this.layoutData.notes = (this.layoutData.notes || []).filter(n => n.noteShortId !== note.noteShortId);
        card.remove();
      });

      // ダブルクリックでカラー選択モーダルを表示
      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('.erd-schema-note-btn-delete')) return;
        e.stopPropagation();
        this.openNoteModal(note);
      });

      // ドラッグ移動ハンドラ
      const header = card.querySelector('.erd-schema-note-header');
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.erd-schema-note-btn-delete')) return;
        e.stopPropagation();
        this.draggedSchemaNote = {
          element: card,
          data: note,
        };
        this.dragStartMouseX = e.clientX;
        this.dragStartMouseY = e.clientY;
        this.dragStartNodeX = note.x || 100;
        this.dragStartNodeY = note.y || 100;
      });

      this.schemaNotesLayer.appendChild(card);
    });
  }

  /**
   * スキーマノート設定モーダルを開く
   */
  openNoteModal(note) {
    this.syncDomToLayout(); // 現在のDOMサイズ・座標を先に同期
    this.editingSchemaNote = note;
    this.selectedNoteColor = note.color || '#3b82f6';

    const backdrop = this.container.querySelector('#erd-note-modal-backdrop');
    const nameEl = this.container.querySelector('#note-modal-name');
    const swatches = this.container.querySelectorAll('#note-modal-color-palette .erd-color-swatch');

    if (nameEl) nameEl.textContent = note.note;
    swatches.forEach(swatch => {
      const color = swatch.getAttribute('data-color');
      if (color === this.selectedNoteColor) {
        swatch.classList.add('selected');
      } else {
        swatch.classList.remove('selected');
      }
    });

    if (backdrop) backdrop.classList.remove('hidden');
  }

  /**
   * スキーマノート設定モーダルを閉じる
   */
  closeNoteModal() {
    this.editingSchemaNote = null;
    const backdrop = this.container.querySelector('#erd-note-modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  /**
   * スキーマノート設定の保存
   * インプレース更新によりリサイズ後のサイズ初期化やチラつきを完全防止
   */
  saveNoteModal() {
    if (!this.editingSchemaNote) return;
    this.syncDomToLayout(); // 現在のサイズを確実に保持
    const newColor = this.selectedNoteColor || '#3b82f6';
    this.editingSchemaNote.color = newColor;

    // インプレースでDOMの枠色・ヘッダー背景色を更新
    const card = this.schemaNotesLayer?.querySelector(`#erd-note-${this.editingSchemaNote.noteShortId}`);
    if (card) {
      card.style.borderColor = newColor;
      const header = card.querySelector('.erd-schema-note-header');
      if (header) header.style.background = newColor;
    } else {
      this.drawSchemaNotes();
    }
    this.closeNoteModal();
  }

  /**
   * カラムのカード内相対Y座標（中央）を厳密に取得
   */
  getFieldPortOffset(card, fieldName) {
    if (!card) return 24;
    const body = card.querySelector('.erd-card-body');
    if (!body) return 24;
    const row = body.querySelector(`.erd-field-row[data-field="${fieldName}"]`);
    if (!row) {
      // 折りたたみ等で省略されたカラムはヘッダー付近へ接続
      return 24;
    }

    // 1. getBoundingClientRect によるカード上端からの精密な相対距離
    const cardRect = card.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (cardRect.height > 0 && rowRect.height > 0) {
      return Math.round((rowRect.top - cardRect.top) + (rowRect.height / 2));
    }

    // 2. レンダリング直後等でRect未確定時の理論値フォールバック
    const header = card.querySelector('.erd-card-header');
    const headerHeight = header ? (header.offsetHeight || 37) : 37;
    const allRows = Array.from(body.querySelectorAll('.erd-field-row'));
    const idx = allRows.indexOf(row);
    if (idx >= 0) {
      return headerHeight + 4 + idx * 28 + 14;
    }

    return 24;
  }

  /**
   * テーブルカード要素の生成 (複数スキーマ対応)
   * @param {Object} nodeData - ERDノードデータ ({ schema, table_name, x, y, folded, alias, ... })
   * @param {Object} tableModel - テーブルモデル定義
   * @param {string} [schemaName] - 所属スキーマ名
   */
  createTableCard(nodeData, tableModel, schemaName) {
    const currentSchema = nodeData.schema || schemaName || 'default';
    const sanitizedSchema = currentSchema.replace(/[^a-zA-Z0-9_-]/g, '_');
    // 日本語コメント: インスタンスIDが未設定の場合は接頭辞なしBase62 10桁のShortIDを補完採番
    const instanceId = nodeData.instanceId || generateShortId(10);
    nodeData.instanceId = instanceId;

    const card = document.createElement('div');
    card.className = 'erd-table-card';
    card.id = `erd-node-${instanceId}`;
    card.setAttribute('data-instance-id', instanceId);
    card.setAttribute('data-table-name', nodeData.table_name);
    card.setAttribute('data-schema-name', currentSchema);
    card.style.left = `${nodeData.x}px`;
    card.style.top = `${nodeData.y}px`;

    // 設定ファイルからの折りたたみ閾値取得（未設定時は10カラム）
    const maxFoldCol = (appStore.state.config && appStore.state.config.maxFoldColumnCount !== undefined)
      ? appStore.state.config.maxFoldColumnCount
      : 10;
    const fieldCount = (tableModel.fields || []).length;
    const canFold = fieldCount > maxFoldCol;

    // 折りたたみ対象外の場合はfoldedをfalseにリセット
    if (!canFold) {
      nodeData.folded = false;
    }

    // 論理名（logicalName）の正常参照 (存在しない場合はnoteにフォールバック)
    // 要件9: 論理名モード時、論理名が未設定または物理名と同一の場合はサブタイトルを表示せず二重表示を防止
    const logicalName = (tableModel.logicalName || tableModel.note || '').trim();
    let mainTitle = tableModel.name;
    let subTitle = '';

    if (this.displayMode === 'logical') {
      if (logicalName && logicalName !== tableModel.name) {
        mainTitle = logicalName;
        subTitle = tableModel.name;
      } else {
        mainTitle = tableModel.name;
        subTitle = '';
      }
    } else {
      mainTitle = tableModel.name;
      subTitle = (logicalName && logicalName !== tableModel.name) ? logicalName : '';
    }

    // テーブル別名（Alias）の表示サフィックス (インスタンス単位で反映)
    const aliasText = nodeData.alias ? ` (${nodeData.alias})` : '';
    const tblColor = (tableModel.headerColor || tableModel.headercolor || '').trim();

    card.innerHTML = `
      <div class="erd-card-header" id="header-${this.escapeHtml(instanceId)}">
        <div class="erd-card-title-group">
          <div class="erd-card-title-line">
            <span class="erd-schema-badge" title="Schema: ${this.escapeHtml(currentSchema)}">${this.escapeHtml(currentSchema)}</span>
            ${renderTableColorBar(tblColor)}
            <span class="erd-card-title" title="${this.escapeHtml(tableModel.name)}${this.escapeHtml(aliasText)}">${this.escapeHtml(mainTitle)}${this.escapeHtml(aliasText)}</span>
            ${tableModel.note ? `<span class="erd-table-note-icon" title="${this.escapeHtml(tableModel.note)}">📝</span>` : ''}
          </div>
          ${subTitle ? `<span class="erd-card-subtitle" title="${this.escapeHtml(subTitle)}">${this.escapeHtml(subTitle)}</span>` : ''}
        </div>
        <div class="erd-card-actions">
          ${canFold ? `
            <button type="button" class="erd-card-btn btn-fold" title="${nodeData.folded ? i18n.t('erd.btn_unfold') : i18n.t('erd.btn_fold')}">
              ${nodeData.folded ? '🔽' : '🔼'}
            </button>
          ` : ''}
          <button type="button" class="erd-card-btn btn-remove-node" title="${i18n.t('erd.btn_remove_table')}">❌</button>
        </div>
      </div>
      <div class="erd-card-body ${nodeData.folded ? 'folded' : ''}">
        ${(tableModel.fields || []).map((f, fieldIdx) => {
          // 折りたたみ時は maxFoldCol 件まで表示し、以降は省略
          if (nodeData.folded && fieldIdx >= maxFoldCol) {
            return '';
          }
          const fieldLogical = (f.logicalName || f.note || '').trim();
          const fieldMain = this.displayMode === 'logical' && fieldLogical ? fieldLogical : f.name;
          const fieldType = f.type?.type_name || f.type || '';
          return `
            <div class="erd-field-row" data-table="${this.escapeHtml(tableModel.name)}" data-field="${this.escapeHtml(f.name)}" data-schema="${this.escapeHtml(currentSchema)}">
              <span class="erd-port left" data-table="${this.escapeHtml(tableModel.name)}" data-field="${this.escapeHtml(f.name)}" data-schema="${this.escapeHtml(currentSchema)}" title="${i18n.t('erd.port_tooltip')}"></span>
              <div class="erd-field-left">
                ${f.pk ? `<span class="erd-pk-badge" title="${i18n.t('erd.tooltip_pk')}">PK</span>` : ''}
                ${f.not_null ? `<span class="erd-nn-badge" title="${i18n.t('erd.tooltip_not_null')}">NN</span>` : ''}
                ${f.unique ? `<span class="erd-uq-badge" title="${i18n.t('erd.tooltip_unique')}">UQ</span>` : ''}
                <span class="erd-field-name" title="${this.escapeHtml(f.name)}${fieldLogical ? ` (${this.escapeHtml(fieldLogical)})` : ''}">${this.escapeHtml(fieldMain)}</span>
              </div>
              <span class="erd-field-type">${this.escapeHtml(fieldType)}</span>
              <span class="erd-port right" data-table="${this.escapeHtml(tableModel.name)}" data-field="${this.escapeHtml(f.name)}" data-schema="${this.escapeHtml(currentSchema)}" title="${i18n.t('erd.port_tooltip')}"></span>
            </div>
          `;
        }).join('')}
        ${nodeData.folded && fieldCount > maxFoldCol ? `
          <div class="erd-field-more-row">${i18n.t('erd.more_columns', { count: fieldCount - maxFoldCol })}</div>
        ` : ''}
      </div>
    `;

    // カードクリック時の関連テーブル・線ハイライト (特定インスタンス個別選択)
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selectTable(nodeData.table_name, currentSchema, instanceId);
    });

    // カードダブルクリック時のテーブル別名（Alias）編集モーダル表示 (特定インスタンス対象)
    card.addEventListener('dblclick', (e) => {
      if (e.target.closest('.erd-card-btn') || e.target.closest('.erd-port')) return;
      e.stopPropagation();
      this.openTableAliasModal(nodeData, tableModel);
    });

    // カラム接続ポート (アンカー) のドラッグ開始イベント
    card.querySelectorAll('.erd-port').forEach(port => {
      port.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const fieldName = port.getAttribute('data-field');
        const isLeft = port.classList.contains('left');
        const cardW = card.offsetWidth || 260;
        const portX = nodeData.x + (isLeft ? 0 : cardW);
        const portY = nodeData.y + this.getFieldPortOffset(card, fieldName);

        this.connectingSource = {
          instanceId: instanceId,
          schemaName: currentSchema,
          tableName: nodeData.table_name,
          fieldName: fieldName,
          portX,
          portY,
        };
      });
    });

    // ドラッグ移動イベントの接続
    const header = card.querySelector('.erd-card-header');
    if (header) {
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.erd-card-btn')) return; // ボタンクリックは除外
        e.stopPropagation();
        this.draggedNode = {
          element: card,
          data: nodeData,
        };
        this.dragStartMouseX = e.clientX;
        this.dragStartMouseY = e.clientY;
        this.dragStartNodeX = nodeData.x;
        this.dragStartNodeY = nodeData.y;
      });
    }

    // 折りたたみイベント (設定閾値を超える場合のみボタンが存在)
    const btnFold = card.querySelector('.btn-fold');
    if (btnFold) {
      btnFold.addEventListener('click', (e) => {
        e.stopPropagation();
        nodeData.folded = !nodeData.folded;
        this.draw();
      });
    }

    // ER図レイアウトからの除外イベント
    const btnRemove = card.querySelector('.btn-remove-node');
    if (btnRemove) {
      btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        // 日本語コメント: 削除されたカードが選択中だった場合は選択状態をクリア
        if (this.selectedNodeInstanceId === instanceId || this.selectedInstanceId === instanceId || (this.selectedTableName === nodeData.table_name && !this.selectedNodeInstanceId)) {
          this.clearSelection();
        }
        this.layoutData.nodes = this.layoutData.nodes.filter(n => 
          n.instanceId ? n.instanceId !== instanceId : !(n.table_name === nodeData.table_name && (n.schema || '') === (nodeData.schema || ''))
        );
        this.draw();
      });
    }

    this.nodesLayer.appendChild(card);
  }

  /**
   * 手動リレーション線の作成 (v1スキーマ準拠・table_instanceId対応)
   */
  createManualEdge(fromInfo, toInfo) {
    if (!this.layoutData) return;
    if (!this.layoutData.edges) this.layoutData.edges = [];

    const fromInstId = fromInfo.instanceId || fromInfo.table_instanceId;
    const toInstId = toInfo.instanceId || toInfo.table_instanceId;
    const fromField = fromInfo.fieldName || fromInfo.field;
    const toField = toInfo.fieldName || toInfo.field;

    if (!fromInstId || !toInstId || !fromField || !toField) return;

    // 重複接続の防止 (インスタンス単位)
    const exists = this.layoutData.edges.some(edge => {
      const fId = edge.from?.table_instanceId || edge.from?.instanceId;
      const tId = edge.to?.table_instanceId || edge.to?.instanceId;
      return ((fId === fromInstId && edge.from?.field === fromField && tId === toInstId && edge.to?.field === toField) ||
              (fId === toInstId && edge.from?.field === toField && tId === fromInstId && edge.to?.field === fromField));
    });
    if (exists) return;

    // 日本語コメント: 手動エッジIDの生成 (10桁ランダム英数字ID)
    const edgeId = generateShortId(10);
    const newEdge = {
      id: edgeId,
      from: {
        table_instanceId: fromInstId,
        field: fromField,
      },
      to: {
        table_instanceId: toInstId,
        field: toField,
      },
      type: 'many-to-one',
      label: '',
    };

    this.layoutData.edges.push(newEdge);
    this.drawEdges();
  }

  /**
   * テーブル間リレーション線 (SVG ベジェ曲線) の描画 (全スキーマ対応・v1仕様準拠)
   */
  drawEdges() {
    this.svgLayer.innerHTML = '';

    const nodes = this.layoutData?.nodes || [];

    // 1. 自動FK関連線 (スキーマ定義由来: 全スキーマから探索)
    if (this.showFKs) {
      const allRefs = [];
      const schemas = appStore.state.schemas;
      if (schemas && schemas.size > 0) {
        for (const [scName, sc] of schemas.entries()) {
          const scRefs = sc.model?.refs || [];
          scRefs.forEach(r => allRefs.push({ ref: r, schemaName: scName }));
        }
      } else {
        (appStore.state.refs || []).forEach(r => allRefs.push({ ref: r, schemaName: appStore.state.activeSchema || '' }));
      }

      allRefs.forEach(({ ref, schemaName: rSchema }) => {
        const norm = this.normalizeRef(ref);
        if (!norm.fromTable || !norm.toTable) return;

        // 日本語コメント: キャンバス上の同一テーブル複数インスタンスに対応し、配置されている全ノードペアで描画
        const fromNodes = nodes.filter(n => n.table_name === norm.fromTable && (!rSchema || !n.schema || n.schema === rSchema));
        const toNodes = nodes.filter(n => n.table_name === norm.toTable && (!rSchema || !n.schema || n.schema === rSchema));

        fromNodes.forEach(fNode => {
          toNodes.forEach(tNode => {
            if (fNode.instanceId === tNode.instanceId) return;
            const fCard = this.nodesLayer.querySelector(`.erd-table-card[data-instance-id="${fNode.instanceId}"]`);
            const tCard = this.nodesLayer.querySelector(`.erd-table-card[data-instance-id="${tNode.instanceId}"]`);
            if (!fCard || !tCard) return;

            const fromX = parseInt(fCard.style.left, 10);
            const fromY = parseInt(fCard.style.top, 10);
            const fromW = fCard.offsetWidth || 260;

            const toX = parseInt(tCard.style.left, 10);
            const toY = parseInt(tCard.style.top, 10);
            const toW = tCard.offsetWidth || 260;

            const startOffsetY = this.getFieldPortOffset(fCard, norm.fromField);
            const endOffsetY = this.getFieldPortOffset(tCard, norm.toField);

            // 左右位置関係に応じて接続ポートおよび内外方向を決定
            let startX, startY, endX, endY;
            let startIsRight = true;
            let endIsRight = false;
            if (fromX + fromW <= toX) {
              startX = fromX + fromW;
              startIsRight = true;
              endX = toX;
              endIsRight = false;
            } else if (toX + toW <= fromX) {
              startX = fromX;
              startIsRight = false;
              endX = toX + toW;
              endIsRight = true;
            } else if (fromX < toX) {
              startX = fromX;
              startIsRight = false;
              endX = toX + toW;
              endIsRight = true;
            } else {
              startX = fromX + fromW;
              startIsRight = true;
              endX = toX;
              endIsRight = false;
            }
            startY = fromY + startOffsetY;
            endY = toY + endOffsetY;

            const dx = Math.abs(endX - startX) * 0.55;
            const pathD = `M ${startX} ${startY} C ${startX + (endX > startX ? dx : -dx)} ${startY}, ${endX - (endX > startX ? dx : -dx)} ${endY}, ${endX} ${endY}`;

            // 日本語コメント: 選択中インスタンスに基づくハイライト・dimmed判定
            const hasSelected = !!this.selectedNodeInstanceId;
            const isSelectedFk = hasSelected && (fNode.instanceId === this.selectedNodeInstanceId || tNode.instanceId === this.selectedNodeInstanceId);
            const isDimmedFk = hasSelected && !isSelectedFk;

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', pathD);
            path.setAttribute('class', `erd-ref-line ${isSelectedFk ? 'highlight' : ''} ${isDimmedFk ? 'dimmed' : ''}`.trim());
            path.setAttribute('data-ref', `${norm.fromTable}->${norm.toTable}`);
            path.setAttribute('data-from-table', norm.fromTable);
            path.setAttribute('data-from-schema', rSchema);
            path.setAttribute('data-to-table', norm.toTable);
            path.setAttribute('data-to-schema', rSchema);
            path.setAttribute('data-from-instance-id', fNode.instanceId);
            path.setAttribute('data-to-instance-id', tNode.instanceId);

            path.addEventListener('mouseenter', () => {
              path.classList.add('highlight');
              fCard.classList.add('highlight');
              tCard.classList.add('highlight');
            });
            path.addEventListener('mouseleave', () => {
              if (!this.selectedNodeInstanceId || !isSelectedFk) {
                path.classList.remove('highlight');
              }
              if (!fCard.classList.contains('selected') && !fCard.classList.contains('connected')) {
                fCard.classList.remove('highlight');
              }
              if (!tCard.classList.contains('selected') && !tCard.classList.contains('connected')) {
                tCard.classList.remove('highlight');
              }
            });

            this.svgLayer.appendChild(path);

            // 日本語コメント: 自動FK線の端点多重度ラベル（視認性向上のためバッジプレート化 & テーブル被り防止クリアランス配置）
            const fromRelStr = norm.fromRelation === 'many' || norm.fromRelation === '*' ? '*' : '1';
            const toRelStr = norm.toRelation === 'many' || norm.toRelation === '*' ? '*' : '1';

            const fromBadgeW = fromRelStr.length > 2 ? 36 : 20;
            const toBadgeW = toRelStr.length > 2 ? 36 : 20;

            const fromBadgeX = startIsRight ? (startX + fromBadgeW / 2 + 5) : (startX - fromBadgeW / 2 - 5);
            const fromBadgeY = startY;
            const badgeFromG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeFromG.setAttribute('class', `erd-cardinality-badge ${isDimmedFk ? 'dimmed' : ''}`.trim());
            badgeFromG.setAttribute('transform', `translate(${fromBadgeX}, ${fromBadgeY})`);
            badgeFromG.setAttribute('data-from-instance-id', fNode.instanceId);
            badgeFromG.setAttribute('data-to-instance-id', tNode.instanceId);
            badgeFromG.innerHTML = `
              <rect x="${-fromBadgeW / 2}" y="-9" width="${fromBadgeW}" height="18" rx="4" ry="4" />
              <text class="erd-ref-cardinality" x="0" y="0" text-anchor="middle" dominant-baseline="central">${fromRelStr}</text>
            `;
            this.svgLayer.appendChild(badgeFromG);

            const toBadgeX = endIsRight ? (endX + toBadgeW / 2 + 5) : (endX - toBadgeW / 2 - 5);
            const toBadgeY = endY;
            const badgeToG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            badgeToG.setAttribute('class', `erd-cardinality-badge ${isDimmedFk ? 'dimmed' : ''}`.trim());
            badgeToG.setAttribute('transform', `translate(${toBadgeX}, ${toBadgeY})`);
            badgeToG.setAttribute('data-from-instance-id', fNode.instanceId);
            badgeToG.setAttribute('data-to-instance-id', tNode.instanceId);
            badgeToG.innerHTML = `
              <rect x="${-toBadgeW / 2}" y="-9" width="${toBadgeW}" height="18" rx="4" ry="4" />
              <text class="erd-ref-cardinality" x="0" y="0" text-anchor="middle" dominant-baseline="central">${toRelStr}</text>
            `;
            this.svgLayer.appendChild(badgeToG);
          });
        });
      });
    }

    // 2. 手動作成リレーション線 (layoutData.edges)
    if (this.showFKs && this.layoutData?.edges) {
      this.layoutData.edges.forEach(edge => {
        // 日本語コメント: v1仕様に基づき table_instanceId (または instanceId) による厳密なノード特定
        const fromId = edge.from?.table_instanceId || edge.from?.instanceId;
        const toId = edge.to?.table_instanceId || edge.to?.instanceId;
        const fromNode = nodes.find(n => n.instanceId === fromId);
        const toNode = nodes.find(n => n.instanceId === toId);
        if (!fromNode || !toNode) return;

        const fromCard = this.nodesLayer.querySelector(`.erd-table-card[data-instance-id="${fromId}"]`);
        const toCard = this.nodesLayer.querySelector(`.erd-table-card[data-instance-id="${toId}"]`);
        if (!fromCard || !toCard) return;

        const fromX = parseInt(fromCard.style.left, 10);
        const fromY = parseInt(fromCard.style.top, 10);
        const fromW = fromCard.offsetWidth || 260;

        const toX = parseInt(toCard.style.left, 10);
        const toY = parseInt(toCard.style.top, 10);
        const toW = toCard.offsetWidth || 260;

        // getFieldPortOffset による厳密なカラム中央Y座標の取得
        const startOffsetY = this.getFieldPortOffset(fromCard, edge.from?.field);
        const endOffsetY = this.getFieldPortOffset(toCard, edge.to?.field);

        // 左右位置関係に応じて接続ポートおよび内外方向を決定
        let startX, startY, endX, endY;
        let startIsRight = true;
        let endIsRight = false;
        if (fromX + fromW <= toX) {
          startX = fromX + fromW;
          startIsRight = true;
          endX = toX;
          endIsRight = false;
        } else if (toX + toW <= fromX) {
          startX = fromX;
          startIsRight = false;
          endX = toX + toW;
          endIsRight = true;
        } else if (fromX < toX) {
          startX = fromX;
          startIsRight = false;
          endX = toX + toW;
          endIsRight = true;
        } else {
          startX = fromX + fromW;
          startIsRight = true;
          endX = toX;
          endIsRight = false;
        }
        startY = fromY + startOffsetY;
        endY = toY + endOffsetY;

        const dx = Math.max(Math.abs(endX - startX) * 0.5, 40);
        const pathD = `M ${startX} ${startY} C ${startX + (endX > startX ? dx : -dx)} ${startY}, ${endX - (endX > startX ? dx : -dx)} ${endY}, ${endX} ${endY}`;

        // 日本語コメント: 選択中インスタンスに基づくハイライト・dimmed判定
        const hasSelected = !!this.selectedNodeInstanceId;
        const isSelectedEdge = hasSelected && (fromId === this.selectedNodeInstanceId || toId === this.selectedNodeInstanceId);
        const isDimmed = hasSelected && !isSelectedEdge;

        // リレーション線描画
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', pathD);
        path.setAttribute('class', `erd-edge-line ${isSelectedEdge ? 'highlight' : ''} ${isDimmed ? 'dimmed' : ''}`.trim());
        path.setAttribute('data-edge-id', edge.id);
        path.setAttribute('data-from-instance-id', fromId);
        path.setAttribute('data-to-instance-id', toId);

        path.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openEdgeModal(edge);
        });
        path.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.openEdgeModal(edge);
        });

        path.addEventListener('mouseenter', () => {
          path.classList.add('highlight');
          fromCard.classList.add('highlight');
          toCard.classList.add('highlight');
        });
        path.addEventListener('mouseleave', () => {
          if (!this.selectedNodeInstanceId || !isSelectedEdge) {
            path.classList.remove('highlight');
          }
          if (!fromCard.classList.contains('selected') && !fromCard.classList.contains('connected')) {
            fromCard.classList.remove('highlight');
          }
          if (!toCard.classList.contains('selected') && !toCard.classList.contains('connected')) {
            toCard.classList.remove('highlight');
          }
        });

        this.svgLayer.appendChild(path);

        // 日本語コメント: 手動リレーション線の多重度（カーディナリティ）判定
        // 接続元（From）対 接続先（To）の完全体系化（8パターン）を判定（レガシーキー互換含む）
        let fromCardText = '*';
        let toCardText = '1';
        let cardinalityText = 'n:1';
        if (edge.type === 'one-to-many') {
          fromCardText = '1';
          toCardText = '*';
          cardinalityText = '1:n';
        } else if (edge.type === 'one-to-one') {
          fromCardText = '1';
          toCardText = '1';
          cardinalityText = '1:1';
        } else if (edge.type === 'many-to-many') {
          fromCardText = '*';
          toCardText = '*';
          cardinalityText = 'n:m';
        } else if (edge.type === 'many-to-zero-one') {
          fromCardText = '*';
          toCardText = '0..1';
          cardinalityText = 'n:0..1';
        } else if (edge.type === 'zero-one-to-many' || edge.type === 'zero-to-many') {
          fromCardText = '0..1';
          toCardText = '*';
          cardinalityText = '0..1:n';
        } else if (edge.type === 'one-to-zero-one') {
          fromCardText = '1';
          toCardText = '0..1';
          cardinalityText = '1:0..1';
        } else if (edge.type === 'zero-one-to-one' || edge.type === 'zero-to-one') {
          fromCardText = '0..1';
          toCardText = '1';
          cardinalityText = '0..1:1';
        }

        // 中央の多重度バッジ描画（カーディナリティ + ラベル表示）
        const midX = Math.round((startX + endX) / 2);
        const midY = Math.round((startY + endY) / 2);

        const badgeText = (edge.label && edge.label.trim())
          ? `${cardinalityText} ${edge.label.trim()}`
          : cardinalityText;

        let textWidth = 0;
        for (const ch of badgeText) {
          textWidth += ch.charCodeAt(0) > 255 ? 12 : 7.5;
        }
        const rectWidth = Math.max(44, Math.round(textWidth + 16));
        const rectX = -Math.round(rectWidth / 2);

        const badgeG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeG.setAttribute('class', `erd-edge-badge ${isDimmed ? 'dimmed' : ''}`.trim());
        badgeG.setAttribute('transform', `translate(${midX}, ${midY})`);
        badgeG.setAttribute('data-from-instance-id', fromId);
        badgeG.setAttribute('data-to-instance-id', toId);
        badgeG.innerHTML = `
          <rect x="${rectX}" y="-11" width="${rectWidth}" height="22" rx="4" ry="4" />
          <text x="0" y="0">${this.escapeHtml(badgeText)}</text>
        `;

        badgeG.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openEdgeModal(edge);
        });
        badgeG.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.openEdgeModal(edge);
        });

        this.svgLayer.appendChild(badgeG);

        // 日本語コメント: 端点多重度バッジ描画 (テーブル被り防止クリアランス配置: 外側にバッジ半幅+5pxオフセット)
        const fromBadgeW = fromCardText.length > 2 ? 36 : 20;
        const toBadgeW = toCardText.length > 2 ? 36 : 20;

        const fromEdgeBadgeX = startIsRight ? (startX + fromBadgeW / 2 + 5) : (startX - fromBadgeW / 2 - 5);
        const fromEdgeBadgeY = startY;
        const badgeEdgeFromG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeEdgeFromG.setAttribute('class', `erd-cardinality-badge ${isDimmed ? 'dimmed' : ''}`.trim());
        badgeEdgeFromG.setAttribute('transform', `translate(${fromEdgeBadgeX}, ${fromEdgeBadgeY})`);
        badgeEdgeFromG.setAttribute('data-from-instance-id', fromId);
        badgeEdgeFromG.setAttribute('data-to-instance-id', toId);
        badgeEdgeFromG.innerHTML = `
          <rect x="${-fromBadgeW / 2}" y="-9" width="${fromBadgeW}" height="18" rx="4" ry="4" />
        `;
        const labelEdgeFrom = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelEdgeFrom.setAttribute('class', `erd-edge-cardinality ${isDimmed ? 'dimmed' : ''}`.trim());
        labelEdgeFrom.setAttribute('x', 0);
        labelEdgeFrom.setAttribute('y', 0);
        labelEdgeFrom.setAttribute('text-anchor', 'middle');
        labelEdgeFrom.setAttribute('dominant-baseline', 'central');
        labelEdgeFrom.textContent = fromCardText;
        badgeEdgeFromG.appendChild(labelEdgeFrom);
        this.svgLayer.appendChild(badgeEdgeFromG);

        const toEdgeBadgeX = endIsRight ? (endX + toBadgeW / 2 + 5) : (endX - toBadgeW / 2 - 5);
        const toEdgeBadgeY = endY;
        const badgeEdgeToG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        badgeEdgeToG.setAttribute('class', `erd-cardinality-badge ${isDimmed ? 'dimmed' : ''}`.trim());
        badgeEdgeToG.setAttribute('transform', `translate(${toEdgeBadgeX}, ${toEdgeBadgeY})`);
        badgeEdgeToG.setAttribute('data-from-instance-id', fromId);
        badgeEdgeToG.setAttribute('data-to-instance-id', toId);
        badgeEdgeToG.innerHTML = `
          <rect x="${-toBadgeW / 2}" y="-9" width="${toBadgeW}" height="18" rx="4" ry="4" />
        `;
        const labelEdgeTo = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        labelEdgeTo.setAttribute('class', `erd-edge-cardinality ${isDimmed ? 'dimmed' : ''}`.trim());
        labelEdgeTo.setAttribute('x', 0);
        labelEdgeTo.setAttribute('y', 0);
        labelEdgeTo.setAttribute('text-anchor', 'middle');
        labelEdgeTo.setAttribute('dominant-baseline', 'central');
        labelEdgeTo.textContent = toCardText;
        badgeEdgeToG.appendChild(labelEdgeTo);
        this.svgLayer.appendChild(badgeEdgeToG);
      });
    }
  }

  /**
   * リレーション編集モーダルを開く
   */
  openEdgeModal(edge) {
    this.editingEdge = edge;
    const backdrop = this.container.querySelector('#erd-edge-modal-backdrop');
    const fromEl = this.container.querySelector('#edge-modal-from');
    const toEl = this.container.querySelector('#edge-modal-to');
    const typeSelect = this.container.querySelector('#edge-modal-type');
    const labelInput = this.container.querySelector('#edge-modal-label');

    // 日本語コメント: v1仕様に基づき table_instanceId からノードを探してテーブル名を表示
    const nodes = this.layoutData?.nodes || [];
    const fromNode = nodes.find(n => n.instanceId === (edge.from?.table_instanceId || edge.from?.instanceId));
    const toNode = nodes.find(n => n.instanceId === (edge.to?.table_instanceId || edge.to?.instanceId));
    fromEl.textContent = `${fromNode ? fromNode.table_name : (edge.from?.table_name || '')}.${edge.from?.field}`;
    toEl.textContent = `${toNode ? toNode.table_name : (edge.to?.table_name || '')}.${edge.to?.field}`;
    // 日本語コメント: レガシーなカーディナリティ種別（zero-to-one, zero-to-many）の後方互換マッピング
    let edgeType = edge.type || 'many-to-one';
    if (edgeType === 'zero-to-one') {
      edgeType = 'zero-one-to-one';
    } else if (edgeType === 'zero-to-many') {
      edgeType = 'zero-one-to-many';
    }
    typeSelect.value = edgeType;
    labelInput.value = edge.label || '';

    backdrop.classList.remove('hidden');
  }

  /**
   * リレーション編集モーダルを閉じる
   */
  closeEdgeModal() {
    this.editingEdge = null;
    const backdrop = this.container.querySelector('#erd-edge-modal-backdrop');
    backdrop.classList.add('hidden');
  }

  /**
   * リレーション編集モーダルの保存
   */
  saveEdgeModal() {
    if (!this.editingEdge) return;
    const typeSelect = this.container.querySelector('#edge-modal-type');
    const labelInput = this.container.querySelector('#edge-modal-label');

    this.editingEdge.type = typeSelect.value;
    this.editingEdge.label = labelInput.value.trim();

    this.closeEdgeModal();
    this.drawEdges();
  }

  /**
   * リレーションの削除
   */
  deleteEdgeModal() {
    if (!this.editingEdge || !this.layoutData?.edges) return;
    this.layoutData.edges = this.layoutData.edges.filter(e => e.id !== this.editingEdge.id);
    this.closeEdgeModal();
    this.drawEdges();
  }

  /**
   * 全テーブルが収まるようにキャンバス位置・ズームを自動調整
   */
  fitView() {
    if (!this.layoutData?.nodes?.length) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    this.layoutData.nodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + 280 > maxX) maxX = n.x + 280;
      if (n.y + 200 > maxY) maxY = n.y + 200;
    });

    const mainContainer = this.container.querySelector('#erd-main-container');
    const containerW = mainContainer.clientWidth || 1000;
    const containerH = mainContainer.clientHeight || 700;

    const contentW = maxX - minX + 100;
    const contentH = maxY - minY + 100;

    const scaleX = containerW / contentW;
    const scaleY = containerH / contentH;
    this.scale = Math.min(Math.max(Math.min(scaleX, scaleY), 0.35), 1.0);

    this.panX = (containerW - (maxX + minX) * this.scale) / 2;
    this.panY = (containerH - (maxY + minY) * this.scale) / 2;

    this.updateCanvasTransform();
  }

  /**
   * メモカード (付箋) の描画
   */
  drawMemos() {
    if (!this.memosLayer) return;
    this.memosLayer.innerHTML = '';
    const memos = this.layoutData?.memos || [];

    memos.forEach(memo => {
      const card = document.createElement('div');
      card.className = 'erd-memo-card';
      card.id = `erd-memo-${memo.id}`;
      card.style.left = `${memo.x || 100}px`;
      card.style.top = `${memo.y || 100}px`;
      if (memo.width) card.style.width = `${memo.width}px`;
      if (memo.height) card.style.height = `${memo.height}px`;

      card.innerHTML = `
        <div class="erd-memo-header" id="memo-header-${this.escapeHtml(memo.id)}">
          <span>${i18n.t('erd.memo_title')}</span>
          <button type="button" class="erd-memo-btn-delete" title="${i18n.t('erd.memo_delete_tip')}">✕</button>
        </div>
        <div class="erd-memo-body">
          <textarea class="erd-memo-textarea" placeholder="${i18n.t('erd.memo_placeholder')}">${this.escapeHtml(memo.text || '')}</textarea>
        </div>
      `;

      // テキスト入力の同期
      const textarea = card.querySelector('.erd-memo-textarea');
      textarea.addEventListener('input', (e) => {
        memo.text = e.target.value;
      });

      // カード上での mousedown イベント伝播抑止 (リサイズ中にキャンバスのパンが同時に始まるのを防ぐ)
      card.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

      // 日本語コメント: リサイズ時に外枠コンテナ自体が勝手にスクロールしてテキストエリアが上へ押し出されるのを防止
      card.addEventListener('scroll', () => {
        if (card.scrollTop !== 0) card.scrollTop = 0;
        if (card.scrollLeft !== 0) card.scrollLeft = 0;
      });

      // 削除ボタン
      const btnDelete = card.querySelector('.erd-memo-btn-delete');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        this.layoutData.memos = (this.layoutData.memos || []).filter(m => m.id !== memo.id);
        card.remove();
      });

      // ドラッグ移動イベント
      const header = card.querySelector(`#memo-header-${memo.id}`);
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.erd-memo-btn-delete')) return;
        e.stopPropagation();
        this.draggedMemo = {
          element: card,
          data: memo,
        };
        this.dragStartMouseX = e.clientX;
        this.dragStartMouseY = e.clientY;
        this.dragStartNodeX = memo.x || 100;
        this.dragStartNodeY = memo.y || 100;
      });

      this.memosLayer.appendChild(card);
    });
  }

  /**
   * 新規メモカードの追加
   */
  addMemo() {
    if (!this.layoutData) return;
    if (!this.layoutData.memos) this.layoutData.memos = [];

    // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
    const memoId = generateShortId(10);
    const centerX = Math.round((-this.panX + 300) / this.scale);
    const centerY = Math.round((-this.panY + 200) / this.scale);

    const newMemo = {
      id: memoId,
      x: Math.max(50, centerX),
      y: Math.max(50, centerY),
      width: 220,
      height: 130,
      text: '',
    };

    this.layoutData.memos.push(newMemo);
    this.drawMemos();

    // 追加したメモのテキストエリアにフォーカス
    const newCard = this.memosLayer.querySelector(`#erd-memo-${memoId}`);
    if (newCard) {
      const textarea = newCard.querySelector('.erd-memo-textarea');
      if (textarea) textarea.focus();
    }
  }

  /**
   * 検索フィルターの適用
   * テーブル名・論理名の一致判定に加え、該当カラム行への .search-match-field クラス付与を行う (全スキーマ対応)
   * 日本語コメント: ユーザーが設定したテーブルの折りたたみ状態(nodeData.folded)は維持し、一致したテーブルカードおよび表示中カラムのハイライトのみを行う (v1仕様準拠)
   */
  applySearchFilter() {
    if (!this.nodesLayer) return;
    const cards = this.nodesLayer.querySelectorAll('.erd-table-card');
    const query = this.searchQuery;

    if (!query) {
      cards.forEach(card => {
        card.classList.remove('search-match', 'search-dimmed');
        const rows = card.querySelectorAll('.erd-field-row');
        rows.forEach(row => row.classList.remove('search-match-field'));
      });
      return;
    }

    cards.forEach(card => {
      const tableName = card.getAttribute('data-table-name') || '';
      const schemaName = card.getAttribute('data-schema-name') || '';
      const def = this.getTableDef(schemaName, tableName);
      if (!def) return;
      const table = def.table;

      const matchTableName = table.name.toLowerCase().includes(query);
      const matchLogical = (table.logicalName || table.note || '').toLowerCase().includes(query);

      // 全フィールド定義からの検索判定（折りたたまれているカラムを持つテーブルも検出）
      let matchedFieldInDef = false;
      (table.fields || []).forEach(f => {
        const fName = (f.name || '').toLowerCase();
        const fLogical = (f.logicalName || f.note || '').toLowerCase();
        if (fName.includes(query) || fLogical.includes(query)) {
          matchedFieldInDef = true;
        }
      });

      // 表示中のカラム行（DOM）へのハイライト付与
      let hasMatchedFieldRow = false;
      const rows = card.querySelectorAll('.erd-field-row');
      rows.forEach(row => {
        const fieldName = (row.getAttribute('data-field') || '').toLowerCase();
        const f = (table.fields || []).find(field => field.name.toLowerCase() === fieldName);
        const fLogical = (f?.logicalName || f?.note || '').toLowerCase();
        if (fieldName.includes(query) || fLogical.includes(query)) {
          row.classList.add('search-match-field');
          hasMatchedFieldRow = true;
        } else {
          row.classList.remove('search-match-field');
        }
      });

      const isMatch = matchTableName || matchLogical || hasMatchedFieldRow || matchedFieldInDef;

      // 日本語コメント: テーブルの折りたたみ状態は変更せず、マッチ/非マッチのクラス付与のみ実施
      if (isMatch) {
        card.classList.add('search-match');
        card.classList.remove('search-dimmed');
      } else {
        card.classList.add('search-dimmed');
        card.classList.remove('search-match');
      }
    });
  }

  /**
   * 等間隔グリッド状に自動整列 (Auto-Layout)
   * ノードが0件の場合は全スキーマから配置可能な全テーブルを一括配置して整列、既存ノードがある場合は既存ノードを整列
   */
  autoLayoutGrid() {
    if (!this.layoutData) return;
    if (!this.layoutData.nodes) this.layoutData.nodes = [];

    // ノードが0件の場合は、全スキーマから配置可能な全テーブルを一括配置
    if (this.layoutData.nodes.length === 0) {
      const schemas = appStore.state.schemas;
      const allTables = [];
      if (schemas && schemas.size > 0) {
        for (const [scName, sc] of schemas.entries()) {
          (sc.model?.tables || []).forEach(table => {
            allTables.push({ table, schema: scName });
          });
        }
      } else {
        (appStore.state.tables || []).forEach(table => {
          allTables.push({ table, schema: appStore.state.activeSchema || 'main' });
        });
      }

      if (allTables.length > 0) {
        allTables.forEach(({ table, schema }) => {
          this.layoutData.nodes.push({
            // 日本語コメント: 接頭辞なしBase62 10桁のShortIDをインスタンスIDとして採番
            instanceId: generateShortId(10),
            schema: schema,
            table_name: table.name,
            alias: table.alias || '',
            x: 0,
            y: 0,
            folded: false,
          });
        });
        this.draw();
      }
    }

    if (!this.layoutData.nodes.length || !this.nodesLayer) return;

    const cols = 4;
    const spacingX = 330;
    const spacingY = 320;
    const startX = 60;
    const startY = 60;

    this.layoutData.nodes.forEach((node, index) => {
      const col = index % cols;
      const row = Math.floor(index / cols);
      node.x = startX + col * spacingX;
      node.y = startY + row * spacingY;

      const card = this.getTableCardElement(node.schema, node.table_name, node.instanceId);
      if (card) {
        card.style.left = `${node.x}px`;
        card.style.top = `${node.y}px`;
      }
    });

    this.drawEdges();
    this.fitView();
  }

  /**
   * グループ枠 (Boxes) の描画
   */
  drawBoxes() {
    if (!this.boxesLayer) return;
    this.boxesLayer.innerHTML = '';
    const boxes = this.layoutData?.boxes || [];

    boxes.forEach(box => {
      const card = document.createElement('div');
      card.className = 'erd-box-card';
      card.id = `erd-box-${box.id}`;
      card.style.left = `${box.x || 60}px`;
      card.style.top = `${box.y || 60}px`;
      if (box.width) card.style.width = `${box.width}px`;
      if (box.height) card.style.height = `${box.height}px`;

      const boxColor = box.color || '#3b82f6';
      card.style.borderColor = boxColor;
      card.style.backgroundColor = `${boxColor}14`;

      card.innerHTML = `
        <div class="erd-box-header" id="box-header-${this.escapeHtml(box.id)}" style="background-color: ${this.escapeHtml(boxColor)}33;">
          <input type="text" class="erd-box-title-input" value="${this.escapeHtml(box.label || i18n.t('erd.box_default_title'))}" placeholder="${i18n.t('erd.box_placeholder')}" />
          <button type="button" class="erd-box-btn-delete" title="${i18n.t('erd.box_delete_tip')}">✕</button>
        </div>
      `;

      // ダブルクリックでグループ枠編集モーダルを開く
      card.addEventListener('dblclick', (e) => {
        if (e.target.closest('.erd-box-btn-delete')) return;
        e.stopPropagation();
        this.openBoxModal(box);
      });

      // タイトル入力の同期
      const titleInput = card.querySelector('.erd-box-title-input');
      titleInput.addEventListener('input', (e) => {
        box.label = e.target.value;
      });

      // カード上での mousedown イベント伝播抑止 (リサイズ中にキャンバスのパンが同時に始まるのを防ぐ)
      card.addEventListener('mousedown', (e) => {
        e.stopPropagation();
      });

      // 削除ボタン
      const btnDelete = card.querySelector('.erd-box-btn-delete');
      btnDelete.addEventListener('click', (e) => {
        e.stopPropagation();
        this.layoutData.boxes = (this.layoutData.boxes || []).filter(b => b.id !== box.id);
        card.remove();
      });

      // ドラッグ移動イベント
      const header = card.querySelector(`#box-header-${box.id}`);
      header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.erd-box-btn-delete') || e.target.closest('.erd-box-title-input')) return;
        e.stopPropagation();
        this.draggedBox = {
          element: card,
          data: box,
        };
        this.dragStartMouseX = e.clientX;
        this.dragStartMouseY = e.clientY;
        this.dragStartNodeX = box.x || 60;
        this.dragStartNodeY = box.y || 60;
      });

      this.boxesLayer.appendChild(card);
    });
  }

  /**
   * 新規グループ枠の追加
   */
  addBox() {
    if (!this.layoutData) return;
    if (!this.layoutData.boxes) this.layoutData.boxes = [];

    // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
    const boxId = generateShortId(10);
    const centerX = Math.round((-this.panX + 250) / this.scale);
    const centerY = Math.round((-this.panY + 150) / this.scale);

    const newBox = {
      id: boxId,
      x: Math.max(50, centerX),
      y: Math.max(50, centerY),
      width: 480,
      height: 360,
      label: i18n.t('erd.box_default_title'),
      color: '#3182ce',
    };

    this.layoutData.boxes.push(newBox);
    this.drawBoxes();

    const newCard = this.boxesLayer.querySelector(`#erd-box-${boxId}`);
    if (newCard) {
      const input = newCard.querySelector('.erd-box-title-input');
      if (input) {
        input.focus();
        input.select();
      }
    }
  }

  /**
   * SVG文字列の生成 (スタンドアロン完全版: v1仕様準拠)
   */
  generateStandaloneSvgString() {
    if (!this.layoutData?.nodes?.length && !this.layoutData?.notes?.length) return '';

    // テーマカラー動的取得 (v1準拠: CSS変数から現在のテーマ配色を反映)
    const computedStyle = (typeof window !== 'undefined' && this.container && typeof getComputedStyle === 'function')
      ? getComputedStyle(this.container)
      : null;
    const bgCanvas = computedStyle?.getPropertyValue('--bg-canvas')?.trim() || computedStyle?.getPropertyValue('--bg-primary')?.trim() || '#0f141c';
    const bgPanel = computedStyle?.getPropertyValue('--bg-secondary')?.trim() || '#1e2530';
    const bgHeader = computedStyle?.getPropertyValue('--bg-tertiary')?.trim() || '#161c24';
    const textPrimary = computedStyle?.getPropertyValue('--text-primary')?.trim() || '#ffffff';
    const textMuted = computedStyle?.getPropertyValue('--text-muted')?.trim() || '#94a3b8';
    const borderColor = computedStyle?.getPropertyValue('--border-color')?.trim() || '#303e54';
    const primaryColor = computedStyle?.getPropertyValue('--primary')?.trim() || '#3b82f6';

    // 外接矩形の計算 (タイトルスタンプ x: 20, y: 20 を含める)
    const erdTitle = this.layoutData?.info?.description || 'ER Diagram';
    const erdVer = `v${this.layoutData?.info?.version || '1.0.0'}`;
    const erdMemo = this.layoutData?.info?.memo || '';

    const stampWidth = erdMemo ? 280 : 220;
    const memoLines = erdMemo ? erdMemo.split('\n') : [];
    const memoLineHeight = 16;
    const stampHeight = erdMemo ? 56 + memoLines.length * memoLineHeight + 8 : 52;

    let minX = 20, minY = 20, maxX = 20 + stampWidth, maxY = 20 + stampHeight;

    // 日本語コメント: ワイド幅設定の取得（wide時は340px、通常時は260px）
    const isWide = this.layoutData?.tableWidth === 'wide';
    const defaultCardWidth = isWide ? 340 : 260;

    // テーブルノードのBBox計算 (固定値260pxは廃止し、実DOMのoffsetHeightまたはカラム数・折りたたみ状態から動的高さを計算)
    const maxFoldCol = (appStore.state.config && appStore.state.config.maxFoldColumnCount !== undefined)
      ? appStore.state.config.maxFoldColumnCount
      : 10;

    this.layoutData.nodes.forEach(n => {
      const card = this.getTableCardElement(n.schema, n.table_name, n.instanceId);
      const def = this.getTableDef(n.schema, n.table_name);
      // 日本語コメント: 削除済みまたはスキーマ不一致で描画されないノードはBBox計算から除外する
      if (!def) return;
      const table = def?.table;
      const fieldCount = (table?.fields || []).length;
      const canFold = fieldCount > maxFoldCol;
      const visibleCount = (n.folded && canFold) ? maxFoldCol : fieldCount;
      const cardWidth = card ? (card.offsetWidth || defaultCardWidth) : defaultCardWidth;
      const cardHeight = card ? (card.offsetHeight || (38 + visibleCount * 28 + (n.folded && canFold ? 30 : 12))) : (38 + visibleCount * 28 + (n.folded && canFold ? 30 : 12));

      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + cardWidth > maxX) maxX = n.x + cardWidth;
      if (n.y + cardHeight > maxY) maxY = n.y + cardHeight;
    });

    // スキーマノートのBBox計算
    if (this.showNotes) {
      (this.layoutData.notes || []).forEach(n => {
        const card = this.schemaNotesLayer?.querySelector(`#erd-note-${n.noteShortId}`);
        const cardW = card ? (card.offsetWidth || n.width || 220) : (n.width || 220);
        const cardH = card ? (card.offsetHeight || n.height || 140) : (n.height || 140);
        if (n.x < minX) minX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.x + cardW > maxX) maxX = n.x + cardW;
        if (n.y + cardH > maxY) maxY = n.y + cardH;
      });
    }

    // メモカードのBBox計算
    if (this.showMemos) {
      (this.layoutData.memos || []).forEach(m => {
        const card = this.memosLayer?.querySelector(`#erd-memo-${m.id}`);
        const cardW = card ? (card.offsetWidth || m.width || 220) : (m.width || 220);
        const cardH = card ? (card.offsetHeight || m.height || 130) : (m.height || 130);
        if (m.x < minX) minX = m.x;
        if (m.y < minY) minY = m.y;
        if (m.x + cardW > maxX) maxX = m.x + cardW;
        if (m.y + cardH > maxY) maxY = m.y + cardH;
      });
    }

    // グループ枠のBBox計算
    if (this.showBoxes) {
      (this.layoutData.boxes || []).forEach(b => {
        const card = this.boxesLayer?.querySelector(`#erd-box-${b.id}`);
        const cardW = card ? (card.offsetWidth || b.width || 400) : (b.width || 400);
        const cardH = card ? (card.offsetHeight || b.height || 300) : (b.height || 300);
        if (b.x < minX) minX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.x + cardW > maxX) maxX = b.x + cardW;
        if (b.y + cardH > maxY) maxY = b.y + cardH;
      });
    }

    // 余白の計算 (padding = 50: 上下左右に適切なマージンを確保)
    const padding = 50;
    minX -= padding;
    minY -= padding;
    const width = maxX - minX + padding * 2;
    const height = maxY - minY + padding * 2;

    let elementsSvg = '';

    // 0. タイトル・バージョン・概要メモスタンプ枠 (左上 x: 20, y: 20)
    let memoSvgElements = '';
    if (erdMemo) {
      memoSvgElements += `<line x1="12" y1="52" x2="${stampWidth - 12}" y2="52" stroke="${borderColor}" stroke-dasharray="3,3" />`;
      memoLines.forEach((line, idx) => {
        const lineY = 68 + idx * memoLineHeight;
        memoSvgElements += `<text x="12" y="${lineY}" fill="${textMuted}" font-family="sans-serif" font-size="11px">${this.escapeHtml(line)}</text>`;
      });
    }

    elementsSvg += `
      <g class="svg-title-stamp" transform="translate(20, 20)">
        <rect x="0" y="0" width="${stampWidth}" height="${stampHeight}" fill="${bgPanel}" stroke="${primaryColor}" stroke-width="1.5" rx="8" ry="8" />
        <text x="12" y="24" fill="${textPrimary}" font-family="sans-serif" font-size="13px" font-weight="bold">🗺️ ${this.escapeHtml(erdTitle)}</text>
        <text x="12" y="42" fill="${textMuted}" font-family="monospace, sans-serif" font-size="11px">${this.escapeHtml(erdVer)}</text>
        ${memoSvgElements}
      </g>
    `;

    // 1. グループ枠 (最背面)
    if (this.showBoxes) {
      (this.layoutData.boxes || []).forEach(b => {
        const bColor = b.color || '#3b82f6';
        const card = this.boxesLayer?.querySelector(`#erd-box-${b.id}`);
        const boxW = card ? (card.offsetWidth || b.width || 400) : (b.width || 400);
        const boxH = card ? (card.offsetHeight || b.height || 300) : (b.height || 300);
        elementsSvg += `
          <g class="svg-box">
            <rect x="${b.x}" y="${b.y}" width="${boxW}" height="${boxH}" fill="${bColor}14" stroke="${bColor}" stroke-width="2" stroke-dasharray="6,4" rx="8" ry="8" />
            <rect x="${b.x}" y="${b.y}" width="${boxW}" height="32" fill="${bColor}33" rx="8" ry="8" />
            <text x="${b.x + 12}" y="${b.y + 21}" fill="${textPrimary}" font-family="sans-serif" font-size="13px" font-weight="bold">${this.escapeHtml(b.label || '')}</text>
          </g>
        `;
      });
    }

    // 2. リレーション線 (背面: 不要なボタンや操作イベント要素を除外して埋め込み)
    // 日本語コメント: drawEdges() で描画された zero-to-one / zero-to-many のバッジおよび fromBadgeW / toBadgeW 動的プレート幅のSVG要素がそのまま忠実に埋め込まれます
    if (this.showFKs && this.svgLayer) {
      const sanitizedSvg = this.svgLayer.innerHTML
        .replace(/<button[\s\S]*?<\/button>/gi, '')
        .replace(/\bon[a-z]+\s*=\s*"[^"]*"/gi, '');
      elementsSvg += `<g class="svg-refs">${sanitizedSvg}</g>`;
    }

    // 3. テーブルノード (前面: 複数スキーマ対応)
    this.layoutData.nodes.forEach(node => {
      const def = this.getTableDef(node.schema, node.table_name);
      if (!def) return;
      const table = def.table;

      const card = this.getTableCardElement(node.schema, node.table_name, node.instanceId);
      const fieldCount = (table.fields || []).length;
      const canFold = fieldCount > maxFoldCol;
      const visibleFields = (node.folded && canFold)
        ? (table.fields || []).slice(0, maxFoldCol)
        : (table.fields || []);

      const cardWidth = card ? (card.offsetWidth || defaultCardWidth) : defaultCardWidth;
      const cardHeight = card ? (card.offsetHeight || (38 + visibleFields.length * 28 + (node.folded && canFold ? 30 : 12))) : (38 + visibleFields.length * 28 + (node.folded && canFold ? 30 : 12));
      const logicalName = table.logicalName || table.note || '';
      const mainTitle = this.displayMode === 'logical' && logicalName ? logicalName : table.name;
      const aliasText = node.alias ? ` (${node.alias})` : '';
      const currentSchema = node.schema || def.schemaName || 'default';
      const schemaLabel = `[${currentSchema}]`;
      const tableTitle = `${mainTitle}${aliasText}`;
      const svgTblColor = (table.headerColor || table.headercolor || '').trim();

      // 日本語コメント: SVG/PNG出力でも「スキーマ名 -> カラー縦線 -> テーブル名」の順に配置するためテキスト幅を概算
      let schemaWidth = 0;
      for (const ch of schemaLabel) {
        schemaWidth += ch.charCodeAt(0) <= 0x7f ? 7.2 : 12;
      }
      const schemaX = 12;
      const barX = schemaX + schemaWidth + 6;
      const colorBarSvg = svgTblColor
        ? `<rect x="${barX}" y="11" width="4" height="16" rx="2" fill="${this.escapeHtml(svgTblColor)}" />`
        : '';
      const titleX = svgTblColor ? (barX + 10) : (schemaX + schemaWidth + 6);

      elementsSvg += `
        <g class="svg-node" transform="translate(${node.x}, ${node.y})">
          <rect x="0" y="0" width="${cardWidth}" height="${cardHeight}" fill="${bgPanel}" stroke="${borderColor}" stroke-width="1.5" rx="6" ry="6" />
          <rect x="0" y="0" width="${cardWidth}" height="38" fill="${bgHeader}" rx="6" ry="6" />
          <line x1="0" y1="38" x2="${cardWidth}" y2="38" stroke="${borderColor}" stroke-width="1" />
          <text x="${schemaX}" y="24" fill="${textMuted}" font-family="sans-serif" font-size="12px" font-weight="600">${this.escapeHtml(schemaLabel)}</text>
          ${colorBarSvg}
          <text x="${titleX}" y="24" fill="${textPrimary}" font-family="sans-serif" font-size="13px" font-weight="bold">${this.escapeHtml(tableTitle)}</text>
      `;

      visibleFields.forEach((f, idx) => {
        // カラム行のY座標: 実DOMの offsetTop が取得できればそれを反映
        const rowEl = card ? card.querySelector(`.erd-field-row[data-field="${f.name}"]`) : null;
        const rowY = rowEl ? (rowEl.offsetTop + 18) : (38 + idx * 28 + 18);
        const fieldLogical = f.logicalName || f.note || '';
        const fieldMain = this.displayMode === 'logical' && fieldLogical ? fieldLogical : f.name;
        const typeStr = f.type?.type_name || f.type || '';

        // 行セパレーター線
        if (idx > 0) {
          const sepY = rowEl ? rowEl.offsetTop : (38 + idx * 28);
          elementsSvg += `<line x1="0" y1="${sepY}" x2="${cardWidth}" y2="${sepY}" stroke="${borderColor}" stroke-width="0.5" stroke-opacity="0.5" />`;
        }

        let badgeOffset = 12;
        // PK バッジ (ゴールド)
        if (f.pk) {
          elementsSvg += `<rect x="${badgeOffset}" y="${rowY - 11}" width="20" height="14" fill="#f1e05a" rx="3" ry="3" />`;
          elementsSvg += `<text x="${badgeOffset + 10}" y="${rowY}" fill="#1a1a1a" font-family="sans-serif" font-size="9px" font-weight="bold" text-anchor="middle">PK</text>`;
          badgeOffset += 24;
        }
        // NN バッジ (ブルー)
        if (f.not_null) {
          elementsSvg += `<rect x="${badgeOffset}" y="${rowY - 11}" width="20" height="14" fill="#3b82f6" rx="3" ry="3" />`;
          elementsSvg += `<text x="${badgeOffset + 10}" y="${rowY}" fill="#ffffff" font-family="sans-serif" font-size="9px" font-weight="bold" text-anchor="middle">NN</text>`;
          badgeOffset += 24;
        }
        // UQ バッジ (グリーン)
        if (f.unique) {
          elementsSvg += `<rect x="${badgeOffset}" y="${rowY - 11}" width="20" height="14" fill="#10b981" rx="3" ry="3" />`;
          elementsSvg += `<text x="${badgeOffset + 10}" y="${rowY}" fill="#ffffff" font-family="sans-serif" font-size="9px" font-weight="bold" text-anchor="middle">UQ</text>`;
          badgeOffset += 24;
        }

        elementsSvg += `<text x="${badgeOffset}" y="${rowY}" fill="${textPrimary}" font-family="sans-serif" font-size="12px">${this.escapeHtml(fieldMain)}</text>`;
        elementsSvg += `<text x="${cardWidth - 12}" y="${rowY}" fill="${textMuted}" font-family="monospace" font-size="11px" text-anchor="end">${this.escapeHtml(typeStr)}</text>`;
      });

      // 折りたたみ時の省略表示
      if (node.folded && canFold) {
        const moreY = 38 + visibleFields.length * 28 + 18;
        // 日本語コメント: SVGエクスポート内の省略カラム数文言の多言語化
        elementsSvg += `<text x="${cardWidth / 2}" y="${moreY}" fill="${textMuted}" font-family="sans-serif" font-size="11px" font-style="italic" text-anchor="middle">${this.escapeHtml(i18n.t('erd.more_columns', { count: fieldCount - maxFoldCol }))}</text>`;
      }

      elementsSvg += `</g>`;
    });

    // 4. スキーマノート (前面)
    if (this.showNotes) {
      (this.layoutData.notes || []).forEach(n => {
        const nColor = n.color || '#3b82f6';
        const card = this.schemaNotesLayer?.querySelector(`#erd-note-${n.noteShortId}`);
        const noteW = card ? (card.offsetWidth || n.width || 220) : (n.width || 220);
        const noteH = card ? (card.offsetHeight || n.height || 140) : (n.height || 140);
        const rawContent = this.getSchemaNoteContent(n.schema, n.note);
        const dispContent = rawContent || i18n.t('erd.no_note_content');
        elementsSvg += `
          <g class="svg-schema-note" transform="translate(${n.x}, ${n.y})">
            <rect x="0" y="0" width="${noteW}" height="${noteH}" fill="${bgPanel}" stroke="${nColor}" stroke-width="2" rx="8" ry="8" />
            <rect x="0" y="0" width="${noteW}" height="30" fill="${nColor}" rx="8" ry="8" />
            <text x="10" y="20" fill="#ffffff" font-family="sans-serif" font-size="12px" font-weight="bold">ℹ️ ${this.escapeHtml(n.note || '')}</text>
        `;
        const lines = dispContent.split('\n');
        lines.forEach((line, idx) => {
          if (idx * 16 + 48 > noteH - 8) return;
          elementsSvg += `<text x="10" y="${idx * 16 + 48}" fill="${textPrimary}" font-family="sans-serif" font-size="11px">${this.escapeHtml(line)}</text>`;
        });
        elementsSvg += `</g>`;
      });
    }

    // 5. メモ (最前面)
    if (this.showMemos) {
      (this.layoutData.memos || []).forEach(m => {
        const card = this.memosLayer?.querySelector(`#erd-memo-${m.id}`);
        const memoW = card ? (card.offsetWidth || m.width || 220) : (m.width || 220);
        const memoH = card ? (card.offsetHeight || m.height || 130) : (m.height || 130);
        // 日本語コメント: SVGエクスポート内の付箋メモタイトルの多言語化
        elementsSvg += `
          <g class="svg-memo" transform="translate(${m.x}, ${m.y})">
            <rect x="0" y="0" width="${memoW}" height="${memoH}" fill="#fef08a" stroke="#facc15" stroke-width="1.5" rx="6" ry="6" />
            <rect x="0" y="0" width="${memoW}" height="26" fill="#fde047" rx="6" ry="6" />
            <text x="10" y="18" fill="#854d0e" font-family="sans-serif" font-size="11px" font-weight="bold">${this.escapeHtml(i18n.t('erd.memo_title'))}</text>
        `;
        const lines = (m.text || '').split('\n');
        lines.forEach((line, idx) => {
          if (idx * 16 + 44 > memoH - 8) return;
          elementsSvg += `<text x="10" y="${idx * 16 + 44}" fill="#1e293b" font-family="sans-serif" font-size="12px">${this.escapeHtml(line)}</text>`;
        });
        elementsSvg += `</g>`;
      });
    }

    return `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">
        <style>
          .erd-ref-line { fill: none; stroke: #6272a4; stroke-width: 2; }
          .erd-ref-cardinality { fill: ${textPrimary}; stroke: ${bgCanvas}; stroke-width: 3.5px; stroke-linejoin: round; paint-order: stroke fill; font-family: monospace, sans-serif; font-size: 14px; font-weight: 800; text-anchor: middle; dominant-baseline: central; }
          .erd-edge-cardinality { fill: ${textPrimary}; stroke: ${bgCanvas}; stroke-width: 3.5px; stroke-linejoin: round; paint-order: stroke fill; font-family: monospace, sans-serif; font-size: 14px; font-weight: 800; text-anchor: middle; dominant-baseline: central; }
          .erd-cardinality-badge rect { fill: ${bgPanel}; stroke: ${borderColor}; stroke-width: 1.2px; rx: 4px; ry: 4px; }
          .erd-edge-line { fill: none; stroke: #38bdf8; stroke-width: 2.5; stroke-dasharray: 6 3; }
          .erd-edge-badge rect { fill: ${bgPanel}; stroke: #38bdf8; stroke-width: 1.5; rx: 4px; ry: 4px; }
          .erd-edge-badge text { fill: ${textPrimary}; font-family: monospace, sans-serif; font-size: 12px; font-weight: bold; text-anchor: middle; dominant-baseline: central; }
        </style>
        <rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${bgCanvas}" />
        ${elementsSvg}
      </svg>
    `;
  }

  /**
   * SVGエクスポート (最新座標を同期してからSVGファイルをダウンロード)
   */
  exportSVG() {
    // エクスポート直前に最新のDOM座標・サイズを同期
    this.syncDomToLayout();
    const svgStr = this.generateStandaloneSvgString();
    if (!svgStr) {
      alert(i18n.t('erd.export_no_data'));
      return;
    }
    const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.layoutData?.info?.description || 'erd'}.svg`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  /**
   * PNGエクスポート (最新座標を同期してからPNG画像をダウンロード)
   * 大規模なER図の場合はフリーズやメモリクラッシュを防ぐため、事前警告および安全スケールでの出力を実施
   */
  exportPNG() {
    // エクスポート直前に最新のDOM座標・サイズを同期
    this.syncDomToLayout();
    const svgStr = this.generateStandaloneSvgString();
    if (!svgStr) {
      alert(i18n.t('erd.export_no_data'));
      return;
    }

    // SVG文字列からキャンバスの寸法を取得
    const widthMatch = svgStr.match(/width="([^"]+)"/);
    const heightMatch = svgStr.match(/height="([^"]+)"/);
    const width = widthMatch ? parseFloat(widthMatch[1]) : 1200;
    const height = heightMatch ? parseFloat(heightMatch[1]) : 800;

    // 大規模判定 (高負荷・クラッシュリスクの事前検知)
    const isLarge = width >= 3500 || height >= 3500 || (width * height) >= 12000000 || (this.layoutData?.nodes && this.layoutData.nodes.length >= 15);

    // 事前警告ダイアログ (高負荷リスク時にレイアウト保存を促し、安全モードでの出力を確認)
    if (isLarge) {
      const msg = i18n.t('erd.export_png_warning', { width: Math.round(width), height: Math.round(height) });
      if (!confirm(msg)) {
        return; // 未保存データを保護するため即中断
      }
    }

    // スケール決定 (大規模時は安全重視で1.0倍、通常時はRetina高解像度2.0倍)
    let scale = isLarge ? 1.0 : 2.0;

    // 通常時でもキャンバスサイズ上限 (長辺 8,192px または 総面積 2,500万px) を超える場合は安全スケールダウン
    const maxDimension = 8192;
    const maxPixels = 25000000;
    if ((width * scale > maxDimension) || (height * scale > maxDimension)) {
      scale = Math.min(scale, maxDimension / Math.max(width, height));
    }
    if ((width * scale) * (height * scale) > maxPixels) {
      scale = Math.min(scale, Math.sqrt(maxPixels / (width * height)));
    }

    const img = new Image();
    const svgBlob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);

    img.onload = () => {
      const renderWidth = img.width || width;
      const renderHeight = img.height || height;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(renderWidth * scale);
      canvas.height = Math.round(renderHeight * scale);
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((blob) => {
          if (blob) {
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = `${this.layoutData?.info?.description || 'erd'}.png`;
            link.click();
            URL.revokeObjectURL(link.href);
          }
          URL.revokeObjectURL(url);
        }, 'image/png');
      } else {
        URL.revokeObjectURL(url);
      }
    };

    img.onerror = (err) => {
      console.error('Failed to load SVG for PNG export:', err);
      // 日本語コメント: PNG画像書き出し失敗アラートの多言語化
      alert(i18n.t('erd.export_error'));
      URL.revokeObjectURL(url);
    };

    img.src = url;
  }

  /**
   * キャンバス上の全DOM要素の最新座標・サイズ・テキストを layoutData へ同期
   */
  syncDomToLayout() {
    if (!this.layoutData) return;

    // 1. テーブルカードの最新DOM座標をノードデータに同期 (複数スキーマ対応)
    if (this.layoutData.nodes && this.nodesLayer) {
      this.layoutData.nodes.forEach(node => {
        const card = this.getTableCardElement(node.schema, node.table_name, node.instanceId);
        if (card) {
          const left = parseInt(card.style.left, 10);
          const top = parseInt(card.style.top, 10);
          if (!isNaN(left)) node.x = left;
          if (!isNaN(top)) node.y = top;
        }
      });
    }

    // 2. メモカードの最新DOM座標・サイズ・テキストを同期
    if (this.layoutData.memos && this.memosLayer) {
      this.layoutData.memos.forEach(memo => {
        const card = this.memosLayer.querySelector(`#erd-memo-${memo.id}`);
        if (card) {
          const left = parseInt(card.style.left, 10);
          const top = parseInt(card.style.top, 10);
          const width = card.offsetWidth;
          const height = card.offsetHeight;
          const textarea = card.querySelector('.erd-memo-textarea');
          if (!isNaN(left)) memo.x = left;
          if (!isNaN(top)) memo.y = top;
          if (width) memo.width = width;
          if (height) memo.height = height;
          if (textarea) memo.text = textarea.value;
        }
      });
    }

    // 3. グループ枠の最新DOM座標・サイズ・タイトルを同期
    if (this.layoutData.boxes && this.boxesLayer) {
      this.layoutData.boxes.forEach(box => {
        const card = this.boxesLayer.querySelector(`#erd-box-${box.id}`);
        if (card) {
          const left = parseInt(card.style.left, 10);
          const top = parseInt(card.style.top, 10);
          const width = card.offsetWidth;
          const height = card.offsetHeight;
          const titleInput = card.querySelector('.erd-box-title-input');
          if (!isNaN(left)) box.x = left;
          if (!isNaN(top)) box.y = top;
          if (width) box.width = width;
          if (height) box.height = height;
          if (titleInput) box.label = titleInput.value;
        }
      });
    }

    // 4. 日本語コメント: スキーマノートの最新DOM座標・サイズを同期 (本文contentはDBMLが真実の出所のため保存対象から除外)
    if (this.layoutData.notes && this.schemaNotesLayer) {
      this.layoutData.notes.forEach(note => {
        delete note.content; // 本文プロパティの混入を安全に除去
        const card = this.schemaNotesLayer.querySelector(`#erd-note-${note.noteShortId}`);
        if (card) {
          const left = parseInt(card.style.left, 10);
          const top = parseInt(card.style.top, 10);
          const width = card.offsetWidth;
          const height = card.offsetHeight;
          if (!isNaN(left)) note.x = left;
          if (!isNaN(top)) note.y = top;
          if (width) note.width = width;
          if (height) note.height = height;
        }
      });
    }
  }

  /**
   * レイアウトの保存
   * 要件3: alert()撤廃、インラインアニメーションによる「保存中...」→「✅ 保存完了」遷移
   */
  async saveLayout() {
    if (!this.currentErdId || !this.layoutData) return;

    const btnSave = this.container.querySelector('#btn-save-erd-layout');
    const originalHtml = btnSave ? btnSave.innerHTML : '';

    if (btnSave) {
      btnSave.disabled = true;
      btnSave.innerHTML = `<span>💾</span><span>${i18n.t('erd.saving')}</span>`;
    }

    // キャンバス上の全要素の最新DOM状態を layoutData へ同期
    this.syncDomToLayout();


    try {
      await projectService.saveErdLayout(this.currentErdId, this.layoutData);
      if (btnSave) {
        btnSave.classList.add('btn-saved');
        btnSave.innerHTML = `<span>✅</span><span>${i18n.t('erd.saved')}</span>`;
        setTimeout(() => {
          btnSave.classList.remove('btn-saved');
          btnSave.disabled = false;
          btnSave.innerHTML = originalHtml || `<span>💾</span><span>${i18n.t('erd.save')}</span>`;
        }, 2000);
      }
    } catch (err) {
      logger.error('ER図レイアウトの保存に失敗:', err);
      if (btnSave) {
        btnSave.disabled = false;
        btnSave.innerHTML = originalHtml;
      }
      alert(i18n.t('erd.save_error') + ': ' + (err.message || err));
    }
  }

  /**
   * テーブル別名（Alias）設定モーダルを開く
   */
  openTableAliasModal(nodeData, tableModel) {
    this.editingNodeForAlias = nodeData;
    const backdrop = this.container.querySelector('#erd-alias-modal-backdrop');
    const nameEl = this.container.querySelector('#alias-modal-table-name');
    const input = this.container.querySelector('#alias-modal-input');

    const logicalName = tableModel.logicalName || tableModel.note || '';
    nameEl.textContent = tableModel.name + (logicalName ? ` (${logicalName})` : '');
    input.value = nodeData.alias || '';

    backdrop.classList.remove('hidden');
    input.focus();
    input.select();
  }

  /**
   * テーブル別名（Alias）設定モーダルを閉じる
   */
  closeTableAliasModal() {
    this.editingNodeForAlias = null;
    const backdrop = this.container.querySelector('#erd-alias-modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  /**
   * テーブル別名（Alias）設定の保存
   */
  saveTableAliasModal() {
    if (!this.editingNodeForAlias) return;
    const input = this.container.querySelector('#alias-modal-input');
    this.editingNodeForAlias.alias = input.value.trim();
    this.closeTableAliasModal();
    this.draw();
  }

  /**
   * グループ枠編集モーダルを開く
   */
  openBoxModal(box) {
    this.syncDomToLayout(); // 現在のDOMサイズ・座標を先に同期
    this.editingBox = box;
    this.selectedBoxColor = box.color || '#3b82f6';

    const backdrop = this.container.querySelector('#erd-box-modal-backdrop');
    const labelInput = this.container.querySelector('#box-modal-label-input');
    const swatches = this.container.querySelectorAll('.erd-box-color-palette .erd-color-swatch');

    labelInput.value = box.label || '';
    swatches.forEach(swatch => {
      const color = swatch.getAttribute('data-color');
      if (color === this.selectedBoxColor) {
        swatch.classList.add('selected');
      } else {
        swatch.classList.remove('selected');
      }
    });

    backdrop.classList.remove('hidden');
    labelInput.focus();
    labelInput.select();
  }

  /**
   * グループ枠編集モーダルを閉じる
   */
  closeBoxModal() {
    this.editingBox = null;
    const backdrop = this.container.querySelector('#erd-box-modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  /**
   * グループ枠編集の保存
   * インプレース更新によりリサイズ後のサイズ初期化やチラつきを完全防止
   */
  saveBoxModal() {
    if (!this.editingBox) return;
    this.syncDomToLayout(); // 現在のサイズを確実に保持
    const labelInput = this.container.querySelector('#box-modal-label-input');
    const newLabel = labelInput ? labelInput.value.trim() : (this.editingBox.label || '');
    const newColor = this.selectedBoxColor || '#3b82f6';

    this.editingBox.label = newLabel;
    this.editingBox.color = newColor;

    // インプレースでDOMの枠色・内側背景色・タイトル・ヘッダー背景を更新
    const card = this.boxesLayer?.querySelector(`#erd-box-${this.editingBox.id}`);
    if (card) {
      card.style.borderColor = newColor;
      card.style.backgroundColor = `${newColor}14`;
      const titleInput = card.querySelector('.erd-box-title-input');
      if (titleInput) titleInput.value = newLabel;
      const header = card.querySelector('.erd-box-header');
      if (header) header.style.backgroundColor = `${newColor}33`;
    } else {
      this.drawBoxes();
    }
    this.closeBoxModal();
  }

  /**
   * グループ枠の削除（モーダルから）
   */
  deleteBoxModal() {
    if (!this.editingBox || !this.layoutData?.boxes) return;
    this.layoutData.boxes = this.layoutData.boxes.filter(b => b.id !== this.editingBox.id);
    this.closeBoxModal();
    this.drawBoxes();
  }

  /**
   * ER図情報（タイトル・バージョン・概要メモ）編集モーダルを開く
   */
  openInfoModal() {
    if (!this.layoutData) return;
    if (!this.layoutData.info) {
      this.layoutData.info = { description: 'ER Diagram', version: '1.0.0', memo: '' };
    }

    const backdrop = this.container.querySelector('#erd-info-modal-backdrop');
    const titleInput = this.container.querySelector('#info-modal-title-input');
    const versionInput = this.container.querySelector('#info-modal-version-input');
    const memoInput = this.container.querySelector('#info-modal-memo-input');

    titleInput.value = this.layoutData.info.description || '';
    versionInput.value = this.layoutData.info.version || '1.0.0';
    if (memoInput) {
      memoInput.value = this.layoutData.info.memo || '';
    }

    backdrop.classList.remove('hidden');
    titleInput.focus();
    titleInput.select();
  }

  /**
   * ER図情報編集モーダルを閉じる
   */
  closeInfoModal() {
    const backdrop = this.container.querySelector('#erd-info-modal-backdrop');
    if (backdrop) backdrop.classList.add('hidden');
  }

  /**
   * ER図情報編集の保存
   */
  saveInfoModal() {
    if (!this.layoutData) return;
    if (!this.layoutData.info) this.layoutData.info = {};

    const titleInput = this.container.querySelector('#info-modal-title-input');
    const versionInput = this.container.querySelector('#info-modal-version-input');
    const memoInput = this.container.querySelector('#info-modal-memo-input');

    this.layoutData.info.description = titleInput.value.trim() || 'ER Diagram';
    this.layoutData.info.version = versionInput.value.trim() || '1.0.0';
    this.layoutData.info.memo = memoInput ? memoInput.value.trim() : '';

    if (this.erdTitleEl) {
      this.erdTitleEl.textContent = this.layoutData.info.description;
    }

    // 日本語コメント: キャンバス内浮動カードのタイトル・バージョン・概要メモ表示を更新
    this.drawInfoCard();

    this.closeInfoModal();
  }

  /**
   * 日本語コメント: HTML / SVG 特殊文字エスケープ処理
   * @param {string} str - エスケープ対象文字列
   * @returns {string} エスケープ済み文字列
   */
  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
