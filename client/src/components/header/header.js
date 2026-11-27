// 日本語コメント: ヘッダーコンポーネント (src/components/header/header.js)
// メニューバー形式 (ファイル, ツール, ヘルプ) と、中央ビュー切替、
// 右端のクイック保存ボタンおよびユーザープロファイルメニュー (個人設定: 言語/テーマ, ログアウト) を提供します。
// Light DOM で動作します。

import { t, setLocale, getLocale } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { setTheme, getTheme } from '../../core/theme.js';
import { clientConfigService } from '../../core/config-service.js';
import { projectService } from '../../core/project-service.js';
import { pluginManager } from '../../core/plugin-manager.js';
import { escapeHtml } from '../../core/html-utils.js';
import './header.css';

export class DbeHeader {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.currentMode = 'list';
    this.isMenuOpen = false;

    this.render();
    this.bindEvents();
    this.updateProjectMenuState();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('header');
    this.element.className = 'dbe-header';

    const currentTheme = getTheme(clientConfigService.defaultTheme);
    const currentLang = getLocale();

    this.element.innerHTML = `
      <!-- 左側: ロゴ ＆ メニューバー -->
      <div class="dbe-header-left">
        <div class="dbe-header-logo">
          <span>🗄️</span>
          <span>${t('app.title')}</span>
        </div>

        <nav class="dbe-menubar" aria-label="Main Menu">
          <!-- ① ファイルメニュー -->
          <div class="dbe-menu-item" id="menu-item-file">
            <button type="button" class="dbe-menu-trigger" id="trigger-file">
              <span>📁</span>
              <span>${t('header.menu_file')}</span>
              <span style="font-size: 0.65rem; opacity: 0.7;">▼</span>
            </button>
            <div class="dbe-menu-dropdown">
              <button type="button" class="dbe-menu-action" id="action-file-new">
                <span class="dbe-menu-action-icon">✨</span>
                <span>${t('header.menu_new_project')}</span>
              </button>
              <button type="button" class="dbe-menu-action" id="action-file-save">
                <span class="dbe-menu-action-icon">💾</span>
                <span>${t('header.menu_save_project')}</span>
              </button>
              <div class="dbe-menu-separator"></div>
              <button type="button" class="dbe-menu-action" id="action-file-import">
                <span class="dbe-menu-action-icon">📥</span>
                <span>${t('header.menu_import')}</span>
              </button>
              <button type="button" class="dbe-menu-action" id="action-file-export">
                <span class="dbe-menu-action-icon">📤</span>
                <span>${t('header.menu_export')}</span>
              </button>
              <div class="dbe-menu-separator"></div>
              <button type="button" class="dbe-menu-action" id="action-file-project-settings">
                <span class="dbe-menu-action-icon">⚙️</span>
                <span>${t('header.menu_project_settings')}</span>
              </button>
            </div>
          </div>

          <!-- ④ ツールメニュー -->
          <div class="dbe-menu-item" id="menu-item-tools">
            <button type="button" class="dbe-menu-trigger" id="trigger-tools">
              <span>🛠️</span>
              <span>${t('header.menu_tools')}</span>
              <span style="font-size: 0.65rem; opacity: 0.7;">▼</span>
            </button>
            <div class="dbe-menu-dropdown">
              <button type="button" class="dbe-menu-action" id="action-tools-playground">
                <span class="dbe-menu-action-icon">🛝</span>
                <span>${t('header.menu_playground')}</span>
              </button>
              <button type="button" class="dbe-menu-action" id="action-tools-migration">
                <span class="dbe-menu-action-icon">🔄</span>
                <span>${t('header.menu_migration')}</span>
              </button>
              <button type="button" class="dbe-menu-action" id="action-tools-query-vis">
                <span class="dbe-menu-action-icon">📊</span>
                <span>${t('header.menu_query_vis')}</span>
              </button>
            </div>
          </div>

          <!-- ⑤ ヘルプメニュー -->
          <div class="dbe-menu-item" id="menu-item-help">
            <button type="button" class="dbe-menu-trigger" id="trigger-help">
              <span>❓</span>
              <span>${t('header.menu_help')}</span>
              <span style="font-size: 0.65rem; opacity: 0.7;">▼</span>
            </button>
            <div class="dbe-menu-dropdown">
              <button type="button" class="dbe-menu-action" id="action-help-manual">
                <span class="dbe-menu-action-icon">📖</span>
                <span>${t('header.menu_manual')}</span>
              </button>
              <button type="button" class="dbe-menu-action" id="action-help-about">
                <span class="dbe-menu-action-icon">ℹ️</span>
                <span>${t('header.menu_about')}</span>
              </button>
            </div>
          </div>
        </nav>
      </div>

      <!-- 中央: ビューモード切替タブ -->
      <div class="dbe-header-center">
        <button class="dbe-nav-tab active" data-mode="list" id="btn-tab-list">
          📋 ${t('header.tab_tables')}
        </button>
        <button class="dbe-nav-tab" data-mode="preview" id="btn-tab-preview">
          👁️ ${t('header.tab_dbml_preview')}
        </button>
      </div>

      <!-- 右側: ユーザープロファイルメニュー -->
      <div class="dbe-header-right">
        <!-- ユーザーメニュー -->
        <div class="dbe-user-menu-item" id="user-menu-container">
          <button type="button" class="dbe-user-trigger" id="btn-user-trigger">
            <span class="dbe-user-avatar">👤</span>
            <span class="dbe-user-name" id="header-username">User</span>
            <span style="font-size: 0.65rem; opacity: 0.7;">▼</span>
          </button>
          
          <div class="dbe-user-dropdown" id="user-menu-dropdown">
            <div class="dbe-user-dropdown-header">
              <div class="dbe-user-dropdown-title" id="user-dropdown-display-name">User</div>
              <div class="dbe-user-dropdown-sub">${t('header.status_logged_in')}</div>
            </div>

            <!-- 個人設定 (モーダル起動) -->
            <button type="button" class="dbe-menu-action" id="action-user-settings">
              <span class="dbe-menu-action-icon">⚙️</span>
              <span>${t('header.menu_settings')}</span>
            </button>

            <div class="dbe-menu-separator"></div>

            <!-- ログアウト -->
            <button type="button" class="dbe-menu-action" id="action-user-logout" style="color: #ff6b6b;">
              <span class="dbe-menu-action-icon">🚪</span>
              <span>${t('header.menu_logout')}</span>
            </button>
          </div>
        </div>
      </div>

      <!-- 新規プロジェクト作成モーダル (Light DOM) -->
      <div class="dbe-modal-overlay" id="header-project-modal" style="display: none;">
        <div class="dbe-modal-card dbe-modal-card--compact" role="dialog" aria-modal="true" aria-labelledby="header-project-modal-title">
          <div class="dbe-modal-header">
            <h3 id="header-project-modal-title">📦 ${t('project.modal_create_title')}</h3>
            <button type="button" class="dbe-modal-close" id="btn-close-new-project" aria-label="${t('common.close')}">&times;</button>
          </div>
          <div class="dbe-modal-body">
            <div class="dbe-form-field">
              <label for="input-new-project-name">
                ${t('project.project_name')}
                <span class="dbe-required-mark">*</span>
              </label>
              <input type="text" id="input-new-project-name" placeholder="My Database Project" />
            </div>
            <div class="dbe-form-error" id="new-project-error" style="display: none;" role="alert"></div>
          </div>
          <div class="dbe-modal-actions">
            <button type="button" id="btn-cancel-new-project">${t('common.cancel')}</button>
            <button type="button" class="primary" id="btn-submit-new-project">${t('common.add')}</button>
          </div>
        </div>
      </div>

      <!-- バージョン情報 (About) モーダル (Light DOM) -->
      <div class="dbe-modal-overlay" id="header-about-modal" style="display: none;">
        <div class="dbe-modal-card" style="width: 680px; max-width: 92vw; text-align: center;">
          <div style="font-size: 2.5rem; margin-bottom: 8px;">🗄️</div>
          <h3 style="margin-top: 0;">${t('header.about_title')}</h3>
          <p style="font-size: 0.9rem; font-weight: bold; color: var(--primary, #007acc); margin: 6px 0;">
            ${t('header.about_version')}
          </p>
          <p style="font-size: 0.85rem; color: var(--text-secondary); line-height: 1.5; margin: 12px 0 16px;">
            ${t('header.about_desc')}
          </p>

          <!-- プラグイン一覧表示セクション -->
          <div style="text-align: left; margin: 16px 0; border-top: 1px solid var(--border-color, #e0e0e0); padding-top: 12px;">
            <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px; color: var(--text-main);">
              ${t('header.about_plugins_title')}
            </div>
            <div id="about-plugins-list" style="max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;">
              <!-- 動的に描画 -->
            </div>
          </div>

          <div class="dbe-modal-actions" style="justify-content: center;">
            <button class="primary" id="btn-close-about">${t('header.about_close')}</button>
          </div>
        </div>
      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    // ─── メニューバーの開閉制御 ───
    const menuItems = this.element.querySelectorAll('.dbe-menu-item');
    const userMenuItem = this.element.querySelector('#user-menu-container');

    const closeAllMenus = () => {
      menuItems.forEach(item => item.classList.remove('active'));
      if (userMenuItem) userMenuItem.classList.remove('active');
      this.isMenuOpen = false;
    };

    menuItems.forEach(item => {
      const trigger = item.querySelector('.dbe-menu-trigger');
      if (trigger) {
        trigger.addEventListener('click', (e) => {
          e.stopPropagation();
          const wasActive = item.classList.contains('active');
          closeAllMenus();
          if (!wasActive) {
            item.classList.add('active');
            this.isMenuOpen = true;
          }
        });

        // メニューが開いている時に他のメニュートリガーにマウスオーバーした時のシームレス切替
        trigger.addEventListener('mouseenter', () => {
          if (this.isMenuOpen && !item.classList.contains('active')) {
            closeAllMenus();
            item.classList.add('active');
            this.isMenuOpen = true;
          }
        });
      }
    });

    // ─── ユーザーメニューの開閉制御 ───
    const userTrigger = this.element.querySelector('#btn-user-trigger');
    if (userTrigger && userMenuItem) {
      userTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const wasActive = userMenuItem.classList.contains('active');
        closeAllMenus();
        if (!wasActive) {
          userMenuItem.classList.add('active');
        }
      });
    }

    // 画面外クリックですべてのメニューを閉じる
    document.addEventListener('click', () => {
      closeAllMenus();
    });

    // ESCキーですべてのメニューを閉じる
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeAllMenus();
      }
    });

    // ─── ナビゲーションタブ切替 ───
    const tabs = this.element.querySelectorAll('.dbe-nav-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.getAttribute('data-mode');
        this.setActiveMode(mode);
        appStore.emit('view:mode:change', mode);
      });
    });

    // ─── ファイルメニューアクション ───
    // 新規プロジェクト
    const fileNewBtn = this.element.querySelector('#action-file-new');
    fileNewBtn?.addEventListener('click', () => {
      closeAllMenus();
      this.openCreateProjectModal();
    });

    // プロジェクト保存
    const fileSaveBtn = this.element.querySelector('#action-file-save');
    fileSaveBtn?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('project:save:request');
    });

    // インポート
    const fileImportBtn = this.element.querySelector('#action-file-import');
    fileImportBtn?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('import:open:request');
    });

    // エクスポート
    const fileExportBtn = this.element.querySelector('#action-file-export');
    fileExportBtn?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('export:open:request');
    });

    // プロジェクト設定
    const projSettingsBtn = this.element.querySelector('#action-file-project-settings');
    projSettingsBtn?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('project:settings:open');
    });

    // ログアウト (ユーザーメニュー)
    this.element.querySelector('#action-user-logout')?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('auth:logout:request');
    });

    // ─── ツールメニューアクション ───
    this.element.querySelector('#action-tools-playground')?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('playground:open:request');
    });

    this.element.querySelector('#action-tools-migration')?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('migration:open:request');
    });

    this.element.querySelector('#action-tools-query-vis')?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('query-vis:open:request');
    });

    // ─── ヘルプメニューアクション ───
    this.element.querySelector('#action-help-manual')?.addEventListener('click', () => {
      closeAllMenus();
      window.open('/manual/viewer/index.html', '_blank');
    });

    const aboutModal = this.element.querySelector('#header-about-modal');
    const pluginsListContainer = this.element.querySelector('#about-plugins-list');

    const renderAboutPlugins = () => {
      if (!pluginsListContainer) return;
      const plugins = pluginManager.getPluginList();
      if (!plugins || plugins.length === 0) {
        pluginsListContainer.innerHTML = `
          <div style="font-size: 0.8rem; color: var(--text-secondary); background: var(--bg-secondary, rgba(0,0,0,0.03)); padding: 8px 12px; border-radius: 4px; border: 1px dashed var(--border-color, #ccc);">
            ${t('header.about_no_plugins')}
          </div>
        `;
        return;
      }

      pluginsListContainer.innerHTML = plugins.map(p => {
        let statusBadge = `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; background: var(--bg-secondary); color: var(--warning); border: 1px solid var(--warning);">${t('header.plugin_status_standby')}</span>`;
        if (p.status === 'active') {
          statusBadge = `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; background: var(--bg-secondary); color: var(--success); border: 1px solid var(--success);">${t('header.plugin_status_active')}</span>`;
        } else if (p.status === 'error') {
          const errReason = p.errorReason ? `: ${escapeHtml(p.errorReason)}` : '';
          statusBadge = `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; background: var(--bg-secondary); color: var(--danger); border: 1px solid var(--danger);">${t('header.plugin_status_error')}${errReason}</span>`;
        } else if (p.status === 'missing_libs') {
          const missing = escapeHtml((p.missingLibs || []).join(', '));
          statusBadge = `<span style="font-size: 0.7rem; padding: 2px 6px; border-radius: 10px; background: var(--bg-secondary); color: var(--warning); border: 1px solid var(--warning);">${t('header.plugin_status_missing_deps', { missing })}</span>`;
        }

        const caps = Array.isArray(p.capabilities) ? p.capabilities : [];
        const capsLabels = [];
        if (caps.includes('dialect')) capsLabels.push(t('header.plugin_cap_dialect'));
        if (caps.includes('importer')) capsLabels.push(t('header.plugin_cap_importer'));
        if (caps.includes('exporter')) capsLabels.push(t('header.plugin_cap_exporter'));
        if (caps.includes('metadata')) capsLabels.push(t('header.plugin_cap_metadata'));
        if (caps.includes('migration')) capsLabels.push(t('header.plugin_cap_migration'));

        const capsHtml = capsLabels.map(c => `<span style="font-size: 0.65rem; background: var(--bg-secondary); padding: 1px 5px; border-radius: 3px; color: var(--text-secondary); border: 1px solid var(--border-color);">${c}</span>`).join(' ');

        // 表示名と説明文の多言語解決
        const nameKey = p.nameKey || `plugins.${p.id}.name`;
        const translatedName = t(nameKey);
        const displayName = (translatedName && translatedName !== nameKey) ? translatedName : (p.name || p.id);

        const descKey = p.descriptionKey || `plugins.${p.id}.description`;
        const translatedDesc = t(descKey);
        const displayDesc = (translatedDesc && translatedDesc !== descKey) ? translatedDesc : (p.description || '');

        return `
          <div style="display: flex; justify-content: space-between; align-items: flex-start; padding: 8px 10px; background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 4px; font-size: 0.8rem; margin-bottom: 6px;">
            <div style="flex: 1; margin-right: 12px;">
              <div style="font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 6px;">
                <span>${escapeHtml(displayName)}</span>
                <span style="font-size: 0.7rem; color: var(--text-secondary); font-weight: normal;">v${escapeHtml(p.version || '1.0.0')}</span>
              </div>
              ${displayDesc ? `<div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">${escapeHtml(displayDesc)}</div>` : ''}
              <div style="font-size: 0.7rem; color: var(--text-secondary); margin-top: 4px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                <span>by ${escapeHtml(p.author || 'Unknown')}</span>
                ${capsHtml ? `<span>·</span> ${capsHtml}` : ''}
              </div>
            </div>
            <div style="flex-shrink: 0;">${statusBadge}</div>
          </div>
        `;
      }).join('');
    };

    this.element.querySelector('#action-help-about')?.addEventListener('click', () => {
      closeAllMenus();
      renderAboutPlugins();
      if (aboutModal) aboutModal.style.display = 'flex';
    });

    this.element.querySelector('#btn-close-about')?.addEventListener('click', () => {
      if (aboutModal) aboutModal.style.display = 'none';
    });

    // ─── 個人設定モーダル表示 ───
    this.element.querySelector('#action-user-settings')?.addEventListener('click', () => {
      closeAllMenus();
      appStore.emit('settings:open:request');
    });

    // ─── 新規プロジェクト作成モーダル ───
    const projectModal = this.element.querySelector('#header-project-modal');
    const inputProjName = this.element.querySelector('#input-new-project-name');
    const errorProjBox = this.element.querySelector('#new-project-error');
    const closeProjBtn = this.element.querySelector('#btn-close-new-project');
    const cancelProjBtn = this.element.querySelector('#btn-cancel-new-project');
    const submitProjBtn = this.element.querySelector('#btn-submit-new-project');

    // 日本語コメント: モーダル内エラーメッセージの表示制御ヘルパー
    const setProjectError = (message) => {
      if (!errorProjBox) return;
      if (message) {
        errorProjBox.textContent = message;
        errorProjBox.style.display = 'block';
      } else {
        errorProjBox.textContent = '';
        errorProjBox.style.display = 'none';
      }
    };

    const closeCreateProjectModal = () => {
      projectModal.style.display = 'none';
      setProjectError('');
    };

    const openCreateProjectModal = () => {
      inputProjName.value = '';
      setProjectError('');
      if (submitProjBtn) submitProjBtn.disabled = false;
      projectModal.style.display = 'flex';
      inputProjName.focus();
    };

    const submitCreateProject = async () => {
      const name = inputProjName.value.trim();
      if (!name) {
        setProjectError(t('project.err_name_required'));
        inputProjName.focus();
        return;
      }
      setProjectError('');
      if (submitProjBtn) submitProjBtn.disabled = true;
      try {
        await projectService.createProject({ name });
        closeCreateProjectModal();
      } catch (err) {
        setProjectError(t('project.err_create_failed', { error: err.message }));
      } finally {
        if (submitProjBtn) submitProjBtn.disabled = false;
      }
    };

    closeProjBtn?.addEventListener('click', closeCreateProjectModal);
    cancelProjBtn?.addEventListener('click', closeCreateProjectModal);
    // 日本語コメント: Escape キーでのキャンセル閉じに対応
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && projectModal && projectModal.style.display === 'flex') {
        closeCreateProjectModal();
      }
    });

    inputProjName?.addEventListener('input', () => setProjectError(''));
    inputProjName?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitCreateProject();
      }
    });

    submitProjBtn?.addEventListener('click', submitCreateProject);

    this.openCreateProjectModal = openCreateProjectModal;
  }

  bindStore() {
    appStore.on('project:create:request', () => {
      if (this.openCreateProjectModal) {
        this.openCreateProjectModal();
      }
    });

    // 日本語コメント: プロジェクト作成状態・空状態の切替に連動してメニューボタンの活性状態を更新
    appStore.on('projectMeta:updated', () => {
      this.updateProjectMenuState();
    });

    appStore.on('project:empty', () => {
      this.updateProjectMenuState();
    });

    appStore.on('user:changed', (user) => {
      const userSpan = this.element.querySelector('#header-username');
      const dropdownName = this.element.querySelector('#user-dropdown-display-name');
      const name = user ? (user.name || user.username) : 'User';
      if (userSpan) userSpan.textContent = name;
      if (dropdownName) dropdownName.textContent = name;
    });

    appStore.on('view:mode:change', (mode) => {
      this.setActiveMode(mode);
    });
  }

  /**
   * 日本語コメント: プロジェクト作成有無に応じて保存・エクスポート・プロジェクト設定の活性状態を制御
   */
  updateProjectMenuState() {
    const hasProject = Boolean(appStore.state.projectMeta) && !appStore.state.isEmptyProject;
    const targetIds = [
      '#action-file-save',
      '#action-file-export',
      '#action-file-project-settings',
    ];
    targetIds.forEach(selector => {
      const btn = this.element.querySelector(selector);
      if (!btn) return;
      btn.disabled = !hasProject;
      btn.title = hasProject ? '' : t('header.tip_requires_project');
    });
  }

  setActiveMode(mode) {
    this.currentMode = mode;
    const tabs = this.element.querySelectorAll('.dbe-nav-tab');
    tabs.forEach(tab => {
      if (tab.getAttribute('data-mode') === mode) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });
  }
}
