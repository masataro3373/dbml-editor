// 日本語コメント: 外部CDNに依存しないローカル Markdown パーサ (manual/viewer/simple-marked.js)
// 見出し、段落、コードブロック、テーブル、リスト、引用、水平線、インライン装飾を安全に HTML へ変換します。

(function (global) {
  'use strict';

  /**
   * HTML 特殊文字をエスケープして XSS を防止します。
   */
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * 安全な URL かどうかを判定します（javascript: などを除外）。
   */
  function sanitizeUrl(url) {
    const trimmed = String(url || '').trim();
    if (/^(https?:\/\/|\/|\.\/|\.\.\/|#)/i.test(trimmed)) {
      return trimmed;
    }
    return '#';
  }

  /**
   * インライン Markdown 装飾（コード、リンク、太字、斜体、打ち消し線）を変換します。
   */
  function parseInline(rawText) {
    const codeTokens = [];
    // インラインコードを先に退避して中の記号が装飾扱いされないようにする
    let text = String(rawText).replace(/`([^`]+)`/g, (_, code) => {
      const idx = codeTokens.length;
      codeTokens.push('<code>' + escapeHtml(code) + '</code>');
      return '\u0000CODE' + idx + '\u0000';
    });

    text = escapeHtml(text);

    // リンク [label](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => {
      const safeUrl = escapeHtml(sanitizeUrl(url));
      const isExternal = /^https?:\/\//i.test(safeUrl);
      const targetAttr = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return '<a href="' + safeUrl + '"' + targetAttr + '>' + label + '</a>';
    });

    // 太字 (**text** または __text__)
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // 打ち消し線 (~~text~~)
    text = text.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    // 斜体 (*text* または _text_)
    text = text.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, '$1<em>$2</em>');

    // インラインコードを復元
    text = text.replace(/\u0000CODE(\d+)\u0000/g, (_, i) => codeTokens[Number(i)] || '');

    return text;
  }

  /**
   * Markdown 表のセパレータ行 (| :--- | :---: |) かどうかを判定します。
   */
  function isTableSeparator(line) {
    return /^\s*\|?(\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
  }

  /**
   * Markdown 表の行をセル配列に分割します。
   */
  function splitTableRow(line) {
    let trimmed = line.trim();
    if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
    if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
    return trimmed.split('|').map(cell => cell.trim());
  }

  /**
   * Markdown テキスト全体を HTML 文字列に変換します。
   */
  function parseMarkdown(md) {
    const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      // 1. フェンスコードブロック (```)
      const fenceMatch = line.match(/^\s*```([a-zA-Z0-9_-]*)\s*$/);
      if (fenceMatch) {
        const lang = fenceMatch[1] || '';
        const codeLines = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // 閉じ ``` をスキップ
        const langClass = lang ? ' class="language-' + escapeHtml(lang) + '"' : '';
        out.push('<pre><code' + langClass + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
        continue;
      }

      // 2. 空行
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // 3. 水平線 (---, ***, ___)
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
        out.push('<hr />');
        i++;
        continue;
      }

      // 4. 見出し (# 〜 ######)
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        out.push('<h' + level + '>' + parseInline(headingMatch[2].trim()) + '</h' + level + '>');
        i++;
        continue;
      }

      // 5. テーブル (ヘッダー行 + セパレータ行)
      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        const headers = splitTableRow(line);
        const alignsRaw = splitTableRow(lines[i + 1]);
        const aligns = alignsRaw.map(a => {
          if (a.startsWith(':') && a.endsWith(':')) return 'center';
          if (a.endsWith(':')) return 'right';
          return 'left';
        });
        i += 2;

        let tableHtml = '<table><thead><tr>';
        headers.forEach((h, idx) => {
          const align = aligns[idx] || 'left';
          tableHtml += '<th style="text-align:' + align + ';">' + parseInline(h) + '</th>';
        });
        tableHtml += '</tr></thead><tbody>';

        while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) {
          const cells = splitTableRow(lines[i]);
          tableHtml += '<tr>';
          headers.forEach((_, idx) => {
            const align = aligns[idx] || 'left';
            tableHtml += '<td style="text-align:' + align + ';">' + parseInline(cells[idx] || '') + '</td>';
          });
          tableHtml += '</tr>';
          i++;
        }
        tableHtml += '</tbody></table>';
        out.push(tableHtml);
        continue;
      }

      // 6. 引用ブロック (>)
      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + parseMarkdown(quoteLines.join('\n')) + '</blockquote>');
        continue;
      }

      // 7. 箇条書きリスト (- / * / + または 1.)
      if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
        const isOrdered = /^\s*\d+\.\s+/.test(line);
        const tag = isOrdered ? 'ol' : 'ul';
        const items = [];
        while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
          const itemText = lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, '');
          items.push('<li>' + parseInline(itemText) + '</li>');
          i++;
        }
        out.push('<' + tag + '>' + items.join('') + '</' + tag + '>');
        continue;
      }

      // 8. 通常の段落
      const paraLines = [];
      while (
        i < lines.length &&
        !/^\s*$/.test(lines[i]) &&
        !/^\s*```/.test(lines[i]) &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^\s*([-*_])\1{2,}\s*$/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*([-*+]|\d+\.)\s+/.test(lines[i])
      ) {
        paraLines.push(lines[i]);
        i++;
      }
      out.push('<p>' + paraLines.map(parseInline).join('<br />') + '</p>');
    }

    return out.join('\n');
  }

  global.SimpleMarked = {
    parse: parseMarkdown,
  };
})(window);
