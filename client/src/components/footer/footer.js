// 日本語コメント: フッターコンポーネント (src/components/footer/footer.js)
// 下段ペインとして、ステータス表示、総テーブル数、バージョン表示を管理します。
// Shadow DOM は使わず Light DOM で動作します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';

export class DbeFooter {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.statusTextEl = null;
    this.tableCountEl = null;

    this.render();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('footer');
    this.element.className = 'dbe-footer';

    this.element.innerHTML = `
      <div class="dbe-footer-left">
        <span class="dbe-footer-status-indicator"></span>
        <span id="footer-status-text">${t('footer.ready')}</span>
      </div>

      <div class="dbe-footer-right">
        <span class="dbe-footer-stat" id="footer-table-count">
          ${t('footer.table_count', { count: 0 })}
        </span>
        <span class="dbe-footer-version">v2.0.0</span>
      </div>
    `;

    this.statusTextEl = this.element.querySelector('#footer-status-text');
    this.tableCountEl = this.element.querySelector('#footer-table-count');

    this.container.appendChild(this.element);
  }

  bindStore() {
    appStore.on('model:updated', (state) => {
      const count = state.tables?.length || 0;
      this.tableCountEl.textContent = t('footer.table_count', { count });
    });

    appStore.on('status:message', (message) => {
      this.statusTextEl.textContent = message;
    });
  }
}
