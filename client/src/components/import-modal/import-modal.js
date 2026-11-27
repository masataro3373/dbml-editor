// 日本語コメント: v2最適化インポートモーダル (src/components/import-modal/import-modal.js)
// Light DOM で動作し、v2 の複数スキーマ環境に完全連動。
// 「SQL (DDL)」「スキーマ (DBML)」「プロジェクト」の3つのコアタブに集約し、
// ファイルドロップゾーン、新規／マージ設定、インポート後の自動アクティブ化・画面遷移を提供します。

import { t } from '../../core/i18n.js';
import { appStore } from '../../core/store.js';
import { projectService } from '../../core/project-service.js';
import { dialectManager } from '../../dialects/index.js';
import { pluginManager } from '../../core/plugin-manager.js';
import { readZipBlob } from '../../core/zip-utils.js';
import { generateShortId } from '../../core/id-generator.js';
import { escapeHtml } from '../../core/html-utils.js';
import './import-modal.css';

/**
 * 正規表現メタ文字を安全にエスケープするヘルパー
 */
function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 識別子からクォートやスキーマ修飾を除去するヘルパー
 */
function cleanIdentifier(identifierStr) {
  if (!identifierStr) return '';
  let str = identifierStr.trim();
  if (str.includes('.')) {
    const parts = str.split('.');
    str = parts[parts.length - 1];
  }
  return str.replace(/^["']|["']$/g, '').trim();
}

/**
 * 日本語コメント: 文字列リテラル（'''...''', '...', "..."）を無視して対応する閉じ括弧 '}' のインデックスを安全に特定
 * Note や Metadata 内に波括弧（JSON、正規表現、説明文など）が含まれていても深さ判定が壊れません
 * 連続するバックスラッシュ（偶数個＝エスケープなし、奇数個＝エスケープあり）も正確に判定します
 */
function findMatchingBraceEnd(text, startPos) {
  let depth = 1;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTripleQuote = false;

  const isEscaped = (pos) => {
    let count = 0;
    for (let k = pos - 1; k >= 0 && text[k] === '\\'; k--) {
      count++;
    }
    return count % 2 === 1;
  };

  for (let i = startPos; i < text.length; i++) {
    // トリプルクォート ('''...''')
    if (text.startsWith("'''", i)) {
      if (inTripleQuote) {
        inTripleQuote = false;
        i += 2;
        continue;
      } else if (!inSingleQuote && !inDoubleQuote) {
        inTripleQuote = true;
        i += 2;
        continue;
      }
    }

    if (inTripleQuote) continue;

    const ch = text[i];

    // シングルクォート ('...')
    if (ch === "'" && !isEscaped(i)) {
      if (!inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      }
      continue;
    }

    // ダブルクォート ("...")
    if (ch === '"' && !isEscaped(i)) {
      if (!inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      }
      continue;
    }

    // クォート外での波括弧カウント
    if (!inSingleQuote && !inDoubleQuote) {
      if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          return i;
        }
      }
    }
  }

  return -1;
}

/**
 * DBMLテキストから各 Table ブロックの位置・構造を波括弧深さ（depth）で確実に抽出
 */
function extractTableBlocks(dbmlText) {
  const tables = [];
  const headerRegex = /^\s*Table\s+(?:(?:"([^"]+)"|([^\s.,;(){}\[\]]+))\.)?(?:"([^"]+)"|([^\s.,;(){}\[\]]+))(?:\s+as\s+(?:"[^"]+"|[^\s.,;(){}\[\]]+))?(?:\s*\[([^\]]*)\])?\s*\{/gim;
  let match;

  while ((match = headerRegex.exec(dbmlText)) !== null) {
    const rawTable = match[3] || match[4] || match[1] || match[2];
    const tableName = cleanIdentifier(rawTable).toUpperCase();
    const settingsStr = match[5] || '';

    const headerStart = match.index;
    const bodyStart = headerStart + match[0].length;
    const bodyEnd = findMatchingBraceEnd(dbmlText, bodyStart);

    if (bodyEnd !== -1) {
      tables.push({
        tableName,
        settingsStr,
        fullStart: headerStart,
        fullEnd: bodyEnd + 1,
        headerText: match[0],
        bodyText: dbmlText.substring(bodyStart, bodyEnd),
        fullText: dbmlText.substring(headerStart, bodyEnd + 1),
      });
      headerRegex.lastIndex = bodyEnd + 1;
    }
  }

  return tables;
}

/**
 * DBMLテキストから各 Metadata ブロックを波括弧深さ（depth）で確実に抽出
 * トリプルクォート ('''...''') や改行・コロンを含む値も安全に正規化して抽出します
 */
function extractMetadataBlocks(dbmlText) {
  const tableMetaMap = new Map();
  const colMetaMap = new Map();

  const metaHeaderRegex = /^\s*Metadata\s+(Table|Column)\s+(?:(?:"([^"]+)"|([^\s.,;(){}\[\]]+))\.)?(?:"([^"]+)"|([^\s.,;(){}\[\]]+))\s*\{/gim;
  let match;

  while ((match = metaHeaderRegex.exec(dbmlText)) !== null) {
    const kind = match[1].toLowerCase();
    const part1 = cleanIdentifier(match[2] || match[3] || '');
    const part2 = cleanIdentifier(match[4] || match[5] || '');

    const bodyStart = match.index + match[0].length;
    const bodyEnd = findMatchingBraceEnd(dbmlText, bodyStart);

    if (bodyEnd !== -1) {
      const body = dbmlText.substring(bodyStart, bodyEnd);
      const props = new Map();

      // トークン認識型プロパティスキャン (トリプルクォート・クォート文字列・数値・真偽値を確実に抽出)
      const propRegex = /(?:^|\n)\s*([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*/g;
      let pMatch;
      while ((pMatch = propRegex.exec(body)) !== null) {
        const propKey = pMatch[1];
        const valStart = pMatch.index + pMatch[0].length;

        // 値のパース
        let valEnd = -1;
        let formattedVal = '';

        if (body.startsWith("'''", valStart)) {
          // トリプルクォート ('''...''')
          const closeIdx = body.indexOf("'''", valStart + 3);
          if (closeIdx !== -1) {
            valEnd = closeIdx + 3;
            const inner = body.substring(valStart + 3, closeIdx).trim();
            // 改行を \n に安全にエスケープして単一行シングルクォート化
            const escaped = inner
              .replace(/\\/g, '\\\\')
              .replace(/'/g, "\\'")
              .replace(/\r\n|\r|\n/g, '\\n');
            formattedVal = `'${escaped}'`;
          } else {
            valEnd = body.length;
            const inner = body.substring(valStart + 3).trim();
            formattedVal = `'${inner.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r\n|\r|\n/g, '\\n')}'`;
          }
        } else if (body[valStart] === "'") {
          // シングルクォート ('...')
          let escaped = false;
          let endQuote = -1;
          for (let k = valStart + 1; k < body.length; k++) {
            if (escaped) {
              escaped = false;
            } else if (body[k] === '\\') {
              escaped = true;
            } else if (body[k] === "'") {
              endQuote = k;
              break;
            }
          }
          if (endQuote !== -1) {
            valEnd = endQuote + 1;
            const inner = body.substring(valStart + 1, endQuote);
            // 内部に生改行があれば \n にエスケープ
            formattedVal = `'${inner.replace(/\r\n|\r|\n/g, '\\n')}'`;
          } else {
            valEnd = body.length;
            formattedVal = body.substring(valStart).trim();
          }
        } else {
          // 1行の値 (数値、boolean、ダブルクォート、または単一リテラル)
          const nextNewline = body.indexOf('\n', valStart);
          valEnd = nextNewline !== -1 ? nextNewline : body.length;
          const rawVal = body.substring(valStart, valEnd).trim();
          if (rawVal === 'true' || rawVal === 'false' || /^-?\d+(?:\.\d+)?$/.test(rawVal)) {
            formattedVal = rawVal;
          } else if (rawVal.startsWith('"') && rawVal.endsWith('"')) {
            formattedVal = rawVal;
          } else {
            formattedVal = `'${rawVal.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
          }
        }

        if (propKey && formattedVal) {
          props.set(propKey, formattedVal);
        }

        propRegex.lastIndex = valEnd;
      }

      if (kind === 'table') {
        const tbl = (part2 || part1).toUpperCase();
        if (!tableMetaMap.has(tbl)) tableMetaMap.set(tbl, new Map());
        for (const [k, v] of props.entries()) tableMetaMap.get(tbl).set(k, v);
      } else {
        const tbl = part1.toUpperCase();
        const col = part2.toUpperCase();
        const key = `${tbl}.${col}`;
        if (!colMetaMap.has(key)) colMetaMap.set(key, new Map());
        for (const [k, v] of props.entries()) colMetaMap.get(key).set(k, v);
      }

      metaHeaderRegex.lastIndex = bodyEnd + 1;
    }
  }

  return { tableMetaMap, colMetaMap };
}

/**
 * 既存スキーマの DBML に新しい DBML（Table/Enum/Ref/Metadata）を安全にマージするヘルパー
 * options:
 *   metaOnly: boolean (論理名、説明文、ヘッダー色、拡張メタデータのみをマージし、既存の型・PK・Indexesを保護)
 *   mergeColumns: boolean (カラム追加/削除をマージ)
 */
function mergeDbml(existingDbml, newDbml, options = {}) {
  if (!existingDbml || !existingDbml.trim()) return newDbml;
  if (!newDbml || !newDbml.trim()) return existingDbml;

  const { metaOnly = true, mergeColumns = false } = options;

  // 0. Project ブロックからの表領域 (data_tablespaces, index_tablespaces) の抽出と合算
  const extractTablespaces = (dbmlStr) => {
    const dataTs = new Set();
    const idxTs = new Set();
    if (!dbmlStr) return { dataTs, idxTs };

    const dMatch = dbmlStr.match(/\bdata_tablespaces:\s*'([^']*)'/i);
    if (dMatch && dMatch[1]) {
      dMatch[1].split(',').forEach(s => {
        const clean = s.trim();
        if (clean) dataTs.add(clean);
      });
    }

    const iMatch = dbmlStr.match(/\bindex_tablespaces:\s*'([^']*)'/i);
    if (iMatch && iMatch[1]) {
      iMatch[1].split(',').forEach(s => {
        const clean = s.trim();
        if (clean) idxTs.add(clean);
      });
    }

    return { dataTs, idxTs };
  };

  const existingTs = extractTablespaces(existingDbml);
  const newTs = extractTablespaces(newDbml);

  for (const ts of newTs.dataTs) existingTs.dataTs.add(ts);
  for (const ts of newTs.idxTs) existingTs.idxTs.add(ts);

  // 1. Metadata ブロックの抽出とマージ（logicalName はインライン属性へ統合するため別途退避）
  const existingMeta = extractMetadataBlocks(existingDbml);
  const newMeta = extractMetadataBlocks(newDbml);

  const inlineTableLogicalFromMeta = new Map();
  const inlineColLogicalFromMeta = new Map();

  const mergedTableMeta = new Map();
  for (const [tbl, props] of existingMeta.tableMetaMap.entries()) {
    const filtered = new Map();
    for (const [k, v] of props.entries()) {
      if (k.toLowerCase() === 'logicalname') {
        inlineTableLogicalFromMeta.set(tbl, v);
      } else {
        filtered.set(k, v);
      }
    }
    if (filtered.size > 0) mergedTableMeta.set(tbl, filtered);
  }
  for (const [tbl, props] of newMeta.tableMetaMap.entries()) {
    if (!mergedTableMeta.has(tbl)) mergedTableMeta.set(tbl, new Map());
    const targetProps = mergedTableMeta.get(tbl);
    for (const [k, v] of props.entries()) {
      if (k.toLowerCase() === 'logicalname') {
        inlineTableLogicalFromMeta.set(tbl, v);
      } else {
        targetProps.set(k, v);
      }
    }
  }

  const mergedColMeta = new Map();
  for (const [key, props] of existingMeta.colMetaMap.entries()) {
    const filtered = new Map();
    for (const [k, v] of props.entries()) {
      if (k.toLowerCase() === 'logicalname') {
        inlineColLogicalFromMeta.set(key, v);
      } else {
        filtered.set(k, v);
      }
    }
    if (filtered.size > 0) mergedColMeta.set(key, filtered);
  }
  for (const [key, props] of newMeta.colMetaMap.entries()) {
    if (!mergedColMeta.has(key)) mergedColMeta.set(key, new Map());
    const targetProps = mergedColMeta.get(key);
    for (const [k, v] of props.entries()) {
      if (k.toLowerCase() === 'logicalname') {
        inlineColLogicalFromMeta.set(key, v);
      } else {
        targetProps.set(k, v);
      }
    }
  }

  // 2. 既存DBMLから Metadata ブロックを波括弧深さ（depth）で確実に除去
  const removeMetadataBlocks = (text) => {
    let result = '';
    let lastIndex = 0;
    const metaRegex = /^\s*Metadata\s+(Table|Column)\b[\s\S]*?\{/gim;
    let m;
    while ((m = metaRegex.exec(text)) !== null) {
      const start = m.index;
      const bStart = start + m[0].length;
      const bEnd = findMatchingBraceEnd(text, bStart);
      if (bEnd !== -1) {
        result += text.substring(lastIndex, start);
        lastIndex = bEnd + 1;
        metaRegex.lastIndex = bEnd + 1;
      }
    }
    result += text.substring(lastIndex);
    return result;
  };

  const cleanExisting = removeMetadataBlocks(existingDbml).trim();
  const cleanNew = removeMetadataBlocks(newDbml).replace(/^\s*Project\s+(?:"[^"]+"|'[^']+'|[^{\s]+)?\s*\{[\s\S]*?\}\s*/im, '').trim();

  // 3. テーブルブロックの抽出 (Brace Depth 方式)
  const existingTables = extractTableBlocks(cleanExisting);
  const newTables = extractTableBlocks(cleanNew);

  // インライン属性 (logicalName) 抽出・置換ヘルパー（改行コードは無効化）
  const stripLogicalNewlines = (str) => (str ? String(str).replace(/[\r\n]+/g, '').replace(/\\r|\\n/g, '') : str);
  const extractInlineLogical = (bracketText) => {
    if (!bracketText) return null;
    const m = bracketText.match(/\blogicalName\s*:\s*('(?:''|\\'|[^'])*'|"(?:""|\\"|[^"])*")/i);
    return m ? stripLogicalNewlines(m[1]) : null;
  };
  const upsertInlineProp = (target, propName, rawFormattedVal, isTableHeader = false) => {
    const cleanVal = propName.toLowerCase() === 'logicalname' ? stripLogicalNewlines(rawFormattedVal) : rawFormattedVal;
    const propRegex = new RegExp(`\\b${propName}\\s*:\\s*(?:'(?:''|\\\\'|[^'])*'|"(?:""|\\\\"|[^"])*"|[^,\\]]+)`, 'i');
    if (propRegex.test(target)) {
      return target.replace(propRegex, `${propName}: ${cleanVal}`);
    }
    if (/\[[^\]]*\]/.test(target)) {
      return target.replace(/\[([^\]]*)\]/, (_, inner) => {
        const trimmed = inner.trim();
        return trimmed ? `[${trimmed}, ${propName}: ${cleanVal}]` : `[${propName}: ${cleanVal}]`;
      });
    }
    if (isTableHeader) {
      return target.replace(/\s*\{$/, ` [${propName}: ${cleanVal}] {`);
    }
    return `${target.trimEnd()} [${propName}: ${cleanVal}]`;
  };

  const newTablesMap = new Map();
  for (const t of newTables) {
    const colorMatch = t.headerText.match(/\bheadercolor:\s*([^,\]]+)/i);
    const headerColor = colorMatch ? colorMatch[1].trim() : null;
    const logicalNameVal = extractInlineLogical(t.settingsStr) || inlineTableLogicalFromMeta.get(t.tableName) || null;
    newTablesMap.set(t.tableName, { ...t, headerColor, logicalNameVal });
  }

  // 4. 既存DBMLのテーブル部分を置き換えながら先頭からスライス再構築 (.replace の全廃)
  let rebuilt = '';
  let lastPos = 0;
  const processedNewTables = new Set();

  for (const exTbl of existingTables) {
    rebuilt += cleanExisting.substring(lastPos, exTbl.fullStart);

    const newTblInfo = newTablesMap.get(exTbl.tableName);
    if (!newTblInfo) {
      rebuilt += exTbl.fullText;
    } else {
      processedNewTables.add(exTbl.tableName);

      if (!metaOnly && !mergeColumns) {
        // 完全置換
        rebuilt += newTblInfo.fullText;
      } else {
        // ヘッダーに headercolor / logicalName をマージ
        let updatedHeader = exTbl.headerText;
        const resolvedTblLogical = newTblInfo.logicalNameVal || inlineTableLogicalFromMeta.get(exTbl.tableName) || null;
        if (resolvedTblLogical) {
          updatedHeader = upsertInlineProp(updatedHeader, 'logicalName', resolvedTblLogical, true);
        }
        if (newTblInfo.headerColor) {
          if (/headercolor:/i.test(updatedHeader)) {
            updatedHeader = updatedHeader.replace(/headercolor:\s*[^,\]]+/i, `headercolor: ${newTblInfo.headerColor}`);
          } else if (/\[[^\]]*\]/.test(updatedHeader)) {
            updatedHeader = updatedHeader.replace(/\[([^\]]*)\]/, `[$1, headercolor: ${newTblInfo.headerColor}]`);
          } else {
            updatedHeader = updatedHeader.replace(/^(Table\s+"?[\w$]+"?(?:\."?[\w$]+"?)?)/i, `$1 [headercolor: ${newTblInfo.headerColor}]`);
          }
        }

        let updatedBody = exTbl.bodyText;

        // 既存カラムへのインライン logicalName マージ（metaOnly 時も含め反映、Indexes/checks/Noteブロック内は除外）
        const parseColLogicalMap = (bodyStr) => {
          const map = new Map();
          let inBlock = false;
          let inBlockNote = false;
          for (const line of bodyStr.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (inBlockNote) {
              if (trimmed.includes("'''")) inBlockNote = false;
              continue;
            }
            if (/^\s*Note\s*:\s*'''/i.test(line)) {
              const afterStart = line.slice(line.indexOf("'''") + 3);
              if (!afterStart.includes("'''")) inBlockNote = true;
              continue;
            }
            if (/^\s*(?:indexes|checks)\s*\{/i.test(line)) { inBlock = true; continue; }
            if (inBlock) {
              if (trimmed === '}') inBlock = false;
              continue;
            }
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || /^\s*note\s*:/i.test(line)) continue;
            const cMatch = line.match(/^\s*(?:"([a-zA-Z0-9_#$]+)"|([a-zA-Z0-9_#$]+))\s+[^\[]*\[([^\]]*)\]/);
            if (cMatch) {
              const cName = (cMatch[1] || cMatch[2]).toUpperCase();
              const ln = extractInlineLogical(cMatch[3]);
              if (ln) map.set(cName, ln);
            }
          }
          return map;
        };
        const newColLogicalMap = parseColLogicalMap(newTblInfo.bodyText);
        if (newColLogicalMap.size > 0 || inlineColLogicalFromMeta.size > 0) {
          let inBlock = false;
          let inBlockNote = false;
          updatedBody = updatedBody.split(/\r?\n/).map(line => {
            const trimmed = line.trim();
            if (inBlockNote) {
              if (trimmed.includes("'''")) inBlockNote = false;
              return line;
            }
            if (/^\s*Note\s*:\s*'''/i.test(line)) {
              const afterStart = line.slice(line.indexOf("'''") + 3);
              if (!afterStart.includes("'''")) inBlockNote = true;
              return line;
            }
            if (/^\s*(?:indexes|checks)\s*\{/i.test(line)) { inBlock = true; return line; }
            if (inBlock) {
              if (trimmed === '}') inBlock = false;
              return line;
            }
            if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || /^\s*note\s*:/i.test(line)) return line;
            const cMatch = line.match(/^(\s*)(?:"([a-zA-Z0-9_#$]+)"|([a-zA-Z0-9_#$]+))\s+/);
            if (!cMatch) return line;
            const cName = (cMatch[2] || cMatch[3]).toUpperCase();
            const ln = newColLogicalMap.get(cName) || inlineColLogicalFromMeta.get(`${exTbl.tableName}.${cName}`) || null;
            return ln ? upsertInlineProp(line, 'logicalName', ln, false) : line;
          }).join('\n');
        }

        if (mergeColumns) {
          const escapeRegExp = (str) => String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

          const parseColLines = (bodyStr) => {
            const lines = bodyStr.split(/\r?\n/);
            const cols = [];
            let inIndexes = false;
            let inChecks = false;

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;

              // サブブロック (indexes, checks) のスキップ
              if (/^\s*indexes\s*\{/i.test(line)) { inIndexes = true; continue; }
              if (/^\s*checks\s*\{/i.test(line)) { inChecks = true; continue; }
              if (trimmed === '}') {
                if (inIndexes) { inIndexes = false; continue; }
                if (inChecks) { inChecks = false; continue; }
                continue;
              }
              if (inIndexes || inChecks || trimmed.startsWith('Note:')) continue;

              // カラム定義行の厳密な抽出 (有効な識別子名のみ)
              const cMatch = line.match(/^(\s*)(?:"([a-zA-Z0-9_#$]+)"|([a-zA-Z0-9_#$]+))\s+/);
              if (cMatch) {
                const colName = (cMatch[2] || cMatch[3]).toUpperCase();
                cols.push({ name: colName, line });
              }
            }
            return cols;
          };

          const existingCols = parseColLines(exTbl.bodyText);
          const newCols = parseColLines(newTblInfo.bodyText);
          const existingColNames = new Set(existingCols.map(c => c.name));
          const newColNames = new Set(newCols.map(c => c.name));

          const colsToAdd = newCols.filter(c => !existingColNames.has(c.name));
          if (colsToAdd.length > 0) {
            const addStr = colsToAdd.map(c => `  ${c.line.trim()}`).join('\n');
            const idxPos = updatedBody.search(/^\s*(?:indexes|checks)\s*\{/im);
            if (idxPos !== -1) {
              updatedBody = `${updatedBody.substring(0, idxPos)}${addStr}\n\n${updatedBody.substring(idxPos)}`;
            } else {
              updatedBody = `${updatedBody.trimEnd()}\n${addStr}\n`;
            }
          }

          const colsToDelete = existingCols.filter(c => !newColNames.has(c.name));
          const idxStart = updatedBody.search(/^\s*indexes\s*\{/im);
          const idxText = idxStart !== -1 ? updatedBody.substring(idxStart) : '';
          for (const col of colsToDelete) {
            const safeColName = escapeRegExp(col.name);
            if (!new RegExp(`\\b${safeColName}\\b`, 'i').test(idxText)) {
              const colRegex = new RegExp(`^\\s*"?${safeColName}"?\\s+[^\\n]+(?:\\r?\\n)?`, 'gim');
              updatedBody = updatedBody.replace(colRegex, '');
            }
          }
        }

        rebuilt += `${updatedHeader}${updatedBody}}`;
      }
    }

    lastPos = exTbl.fullEnd;
  }

  rebuilt += cleanExisting.substring(lastPos);

  // 5. 新DBMLにあって既存に存在しなかった新規テーブルを末尾に追記
  for (const newTbl of newTables) {
    if (!processedNewTables.has(newTbl.tableName)) {
      rebuilt = `${rebuilt.trim()}\n\n${newTbl.fullText}`;
    }
  }

  // 6. 最終的なテーブルごとの実在カラム集合を収集
  const finalTables = extractTableBlocks(rebuilt);
  const tableColsMap = new Map();
  for (const t of finalTables) {
    const colSet = new Set();
    const lines = t.bodyText.split(/\r?\n/);
    let inIdx = false;
    let inChk = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*')) continue;
      if (/^indexes\s*\{/i.test(trimmed)) { inIdx = true; continue; }
      if (/^checks\s*\{/i.test(trimmed)) { inChk = true; continue; }
      if (trimmed === '}') {
        if (inIdx) { inIdx = false; continue; }
        if (inChk) { inChk = false; continue; }
        continue;
      }
      if (!inIdx && !inChk && !trimmed.startsWith('Note:')) {
        const cMatch = line.match(/^\s*["']?([a-zA-Z0-9_#$]+)["']?\s+/);
        if (cMatch) colSet.add(cMatch[1].toUpperCase());
      }
    }
    tableColsMap.set(t.tableName, colSet);
  }

  // 7. マージされた Metadata Table / Metadata Column を末尾に出力（実在するものに限定）
  const metadataBlocks = [];
  for (const [tbl, props] of mergedTableMeta.entries()) {
    if (props.size > 0 && tableColsMap.has(tbl)) {
      const lines = Array.from(props.entries()).map(([k, v]) => `  ${k}: ${v}`);
      metadataBlocks.push(`Metadata Table "${tbl}" {\n${lines.join('\n')}\n}`);
    }
  }
  for (const [tblCol, props] of mergedColMeta.entries()) {
    if (props.size > 0) {
      const [t, c] = tblCol.split('.');
      const colSet = tableColsMap.get(t);
      if (colSet && colSet.has(c)) {
        const lines = Array.from(props.entries()).map(([k, v]) => `  ${k}: ${v}`);
        metadataBlocks.push(`Metadata Column "${t}"."${c}" {\n${lines.join('\n')}\n}`);
      }
    }
  }

  if (metadataBlocks.length > 0) {
    rebuilt = `${rebuilt.trim()}\n\n${metadataBlocks.join('\n\n')}\n`;
  }

  // 8. Project ブロック内の表領域設定を最新の合算値で更新・追記
  if (existingTs.dataTs.size > 0 || existingTs.idxTs.size > 0) {
    if (existingTs.dataTs.size > 0) {
      const dataStr = `data_tablespaces: '${Array.from(existingTs.dataTs).join(', ')}'`;
      if (/data_tablespaces:\s*'[^']*'/i.test(rebuilt)) {
        rebuilt = rebuilt.replace(/data_tablespaces:\s*'[^']*'/i, dataStr);
      } else {
        rebuilt = rebuilt.replace(/(Project\s+(?:"[^"]+"|'[^']+'|[^{\s]+)?\s*\{)/i, `$1\n  ${dataStr}`);
      }
    }

    if (existingTs.idxTs.size > 0) {
      const idxStr = `index_tablespaces: '${Array.from(existingTs.idxTs).join(', ')}'`;
      if (/index_tablespaces:\s*'[^']*'/i.test(rebuilt)) {
        rebuilt = rebuilt.replace(/index_tablespaces:\s*'[^']*'/i, idxStr);
      } else {
        rebuilt = rebuilt.replace(/(Project\s+(?:"[^"]+"|'[^']+'|[^{\s]+)?\s*\{)/i, `$1\n  ${idxStr}`);
      }
    }
  }

  return rebuilt;
}

export class DbeImportModal {
  constructor(container) {
    this.container = container;
    this.element = null;
    this.activeTab = 'sql'; // デフォルトは SQL タブ
    this.selectedFile = null;
    this.fileContent = '';
    this.fileBuffer = null;

    this.render();
    this.bindEvents();
    this.bindStore();
  }

  render() {
    this.element = document.createElement('div');
    this.element.className = 'dbe-import-modal-overlay';
    this.element.id = 'import-modal-overlay';
    this.element.style.display = 'none';

    this.element.innerHTML = `
      <div class="dbe-import-modal-container">
        
        <!-- ヘッダー -->
        <div class="dbe-import-modal-header">
          <h3><span>📥</span> ${t('importModal.title')}</h3>
          <button class="dbe-import-modal-close-btn" id="btnCloseImport">&times;</button>
        </div>

        <!-- タブナビゲーション (v2最適化: コア機能 + Excel設計書対応 + ER図 + プロジェクトZIP) -->
        <div class="dbe-import-modal-tabs">
          <button class="dbe-import-modal-tab-btn active" data-tab="sql">${t('importModal.tabSql')}</button>
          <button class="dbe-import-modal-tab-btn" data-tab="excel">${t('importModal.tabExcel')}</button>
          <button class="dbe-import-modal-tab-btn" data-tab="schema">${t('importModal.tabSchema')}</button>
          <button class="dbe-import-modal-tab-btn" data-tab="erd">${t('importModal.tabErd')}</button>
          <button class="dbe-import-modal-tab-btn" data-tab="project">${t('importModal.tabProject')}</button>
        </div>

        <!-- コンテンツ領域 -->
        <div class="dbe-import-modal-body">
          <!-- 日本語コメント: プロジェクト未作成時の案内バナー (初期非表示) -->
          <div class="dbe-import-no-project-banner" id="importNoProjectBanner" style="display: none;"></div>
          
          <!-- ① SQL (DDL) -->
          <div class="dbe-import-tab-content active" id="sqlImportContent">
            <p class="dbe-import-description">
              ${t('importModal.descSql')}
            </p>
            
            <div class="dbe-import-checkbox-group" style="flex-direction: row; gap: 20px;">
              <label class="dbe-import-checkbox-label">
                <input type="radio" name="sqlImportMode" value="new" checked><span>${t('importModal.modeNew')}</span>
              </label>
              <label class="dbe-import-checkbox-label">
                <input type="radio" name="sqlImportMode" value="merge"><span>${t('importModal.modeMerge')}</span>
              </label>
            </div>

            <!-- 新規作成フォーム -->
            <div id="sqlNewForm">
              <div class="dbe-import-form-group">
                <label for="sqlSchemaName">${t('importModal.labelNewSchema')}</label>
                <input type="text" class="dbe-import-input" id="sqlSchemaName" placeholder="${t('importModal.placeholderNewSchema')}">
              </div>
            </div>

            <!-- マージ先選択フォーム -->
            <div id="sqlMergeForm" style="display: none;">
              <div class="dbe-import-form-group">
                <label for="sqlMergeSchemaSelect">${t('importModal.labelMergeSchema')}</label>
                <select class="dbe-import-select" id="sqlMergeSchemaSelect"></select>
              </div>
            </div>

            <div class="dbe-import-form-group">
              <label for="sqlDbType">${t('importModal.labelDbType')}</label>
              <select class="dbe-import-select" id="sqlDbType"></select>
            </div>

            <!-- インポーター動的オプション領域 -->
            <div id="sqlDynamicOptionsArea"></div>

            <!-- ファイルドロップゾーン -->
            <div class="dbe-import-form-group">
              <label>${t('importModal.labelSqlArea')}</label>
              <div class="dbe-import-dropzone" id="sqlDropzone">
                <div class="dbe-import-dropzone-icon">📄</div>
                <div class="dbe-import-dropzone-text">${t('importModal.placeholderSqlDrop')}</div>
                <input type="file" class="dbe-import-file-input" id="sqlFileInput" accept=".sql,.ddl,.dbml">
              </div>
            </div>

            <div class="dbe-import-file-info" id="sqlFileInfo">
              <span class="file-name"></span>
              <button class="dbe-import-file-clear" id="btnSqlFileClear">&times;</button>
            </div>
          </div>

          <!-- ② 設計書 (Excel: ER/Studio対応) -->
          <div class="dbe-import-tab-content" id="excelImportContent">
            <p class="dbe-import-description">
              ${t('importModal.descExcel')}
            </p>
            
            <div class="dbe-import-checkbox-group" style="flex-direction: row; gap: 20px;">
              <label class="dbe-import-checkbox-label">
                <input type="radio" name="excelImportMode" value="new" checked><span>${t('importModal.modeNew')}</span>
              </label>
              <label class="dbe-import-checkbox-label">
                <input type="radio" name="excelImportMode" value="merge"><span>${t('importModal.modeMerge')}</span>
              </label>
            </div>

            <!-- 新規作成フォーム -->
            <div id="excelNewForm">
              <div class="dbe-import-form-group">
                <label for="excelSchemaName">${t('importModal.labelNewSchema')}</label>
                <input type="text" class="dbe-import-input" id="excelSchemaName" placeholder="${t('importModal.placeholderExcelSchema')}">
              </div>
            </div>

            <!-- マージ先選択フォーム -->
            <div id="excelMergeForm" style="display: none;">
              <div class="dbe-import-form-group">
                <label for="excelMergeSchemaSelect">${t('importModal.labelMergeSchema')}</label>
                <select class="dbe-import-select" id="excelMergeSchemaSelect"></select>
              </div>

              <!-- マージ詳細設定 -->
              <div class="dbe-import-form-group" style="margin-top: 12px; padding: 12px; background: var(--bg-secondary, #f8f9fa); border-radius: 6px; border: 1px solid var(--border-color, #e2e8f0);">
                <div style="font-weight: 600; font-size: 0.85rem; margin-bottom: 8px; color: var(--text-color, #1e293b);">${t('importModal.labelMergeSettings')}</div>
                <label class="dbe-import-checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; margin-bottom: 8px; cursor: pointer;">
                  <input type="checkbox" id="excelMergeMetaOnly" checked>
                  <span>${t('importModal.optMergeMetaOnly')}</span>
                </label>
                <label class="dbe-import-checkbox-label" style="display: flex; align-items: center; gap: 8px; font-size: 0.85rem; cursor: pointer;">
                  <input type="checkbox" id="excelMergeColumns">
                  <span>${t('importModal.optMergeColumns')}</span>
                </label>
              </div>
            </div>

            <!-- ファイルドロップゾーン -->
            <div class="dbe-import-form-group">
              <label>${t('importModal.labelExcelArea')}</label>
              <div class="dbe-import-dropzone" id="excelDropzone">
                <div class="dbe-import-dropzone-icon">📊</div>
                <div class="dbe-import-dropzone-text">${t('importModal.placeholderExcelDrop')}</div>
                <div class="dbe-import-dropzone-subtext">${t('importModal.formatExcelSheets')}</div>
                <input type="file" class="dbe-import-file-input" id="excelFileInput" accept=".xlsx,.xlsm,.xls,.csv">
              </div>
            </div>

            <div class="dbe-import-file-info" id="excelFileInfo">
              <span class="file-name"></span>
              <button class="dbe-import-file-clear" id="btnExcelFileClear">&times;</button>
            </div>
          </div>

          <!-- ③ スキーマ (DBML) -->
          <div class="dbe-import-tab-content" id="schemaImportContent">
            <p class="dbe-import-description">
              ${t('importModal.descSchema')}
            </p>
            
            <div class="dbe-import-dropzone" id="schemaDropzone">
              <div class="dbe-import-dropzone-icon">📄</div>
              <div class="dbe-import-dropzone-text">${t('importModal.placeholderSchemaDrop')}</div>
              <div class="dbe-import-dropzone-subtext">${t('importModal.formatDbml')}</div>
              <input type="file" class="dbe-import-file-input" id="schemaFileInput" accept=".dbml,.txt">
            </div>

            <div class="dbe-import-file-info" id="schemaFileInfo">
              <span class="file-name"></span>
              <button class="dbe-import-file-clear" id="btnSchemaFileClear">&times;</button>
            </div>
          </div>

          <!-- ④ ER図 (JSON) -->
          <div class="dbe-import-tab-content" id="erdImportContent">
            <p class="dbe-import-description">
              ${t('importModal.descErd')}
            </p>
            
            <div class="dbe-import-dropzone" id="erdDropzone">
              <div class="dbe-import-dropzone-icon">🗺️</div>
              <div class="dbe-import-dropzone-text">${t('importModal.placeholderErdDrop')}</div>
              <div class="dbe-import-dropzone-subtext">${t('importModal.formatErd')}</div>
              <input type="file" class="dbe-import-file-input" id="erdFileInput" accept=".json">
            </div>

            <div class="dbe-import-file-info" id="erdFileInfo">
              <span class="file-name"></span>
              <button class="dbe-import-file-clear" id="btnErdFileClear">&times;</button>
            </div>
          </div>

          <!-- ⑤ プロジェクト (アーカイブ復元: ZIP / JSON) -->
          <div class="dbe-import-tab-content" id="projectImportContent">
            <p class="dbe-import-description">
              ${t('importModal.descProjectArchive')}
            </p>
            
            <div class="dbe-import-dropzone" id="projectDropzone">
              <div class="dbe-import-dropzone-icon">📦</div>
              <div class="dbe-import-dropzone-text">${t('importModal.placeholderProjectDrop')}</div>
              <div class="dbe-import-dropzone-subtext">${t('importModal.formatProject')}</div>
              <input type="file" class="dbe-import-file-input" id="projectFileInput" accept=".zip,.json">
            </div>

            <div class="dbe-import-file-info" id="projectFileInfo">
              <span class="file-name"></span>
              <button class="dbe-import-file-clear" id="btnProjectFileClear">&times;</button>
            </div>
          </div>

        </div>

        <!-- フッター -->
        <div class="dbe-import-modal-footer">
          <button class="dbe-import-btn dbe-import-btn-secondary" id="btnCancelImport">${t('importModal.btnCancel')}</button>
          <button class="dbe-import-btn dbe-import-btn-primary" id="btnSubmitImport">${t('importModal.btnSubmit')}</button>
        </div>

      </div>
    `;

    this.container.appendChild(this.element);
  }

  bindEvents() {
    const closeBtn = this.element.querySelector('#btnCloseImport');
    const cancelBtn = this.element.querySelector('#btnCancelImport');
    const submitBtn = this.element.querySelector('#btnSubmitImport');
    const tabBtns = this.element.querySelectorAll('.dbe-import-modal-tab-btn');

    const hideModal = () => {
      this.element.style.display = 'none';
    };

    closeBtn.addEventListener('click', hideModal);
    cancelBtn.addEventListener('click', hideModal);

    // ESCキーで閉じる
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.element.style.display !== 'none') {
        hideModal();
      }
    });

    // タブ切り替え
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.getAttribute('data-tab'));
      });
    });

    // SQL インポートモード切り替え (new vs merge)
    const modeRadios = this.element.querySelectorAll('input[name="sqlImportMode"]');
    const sqlNewForm = this.element.querySelector('#sqlNewForm');
    const sqlMergeForm = this.element.querySelector('#sqlMergeForm');

    modeRadios.forEach(r => {
      r.addEventListener('change', () => {
        const isNew = r.value === 'new';
        sqlNewForm.style.display = isNew ? 'block' : 'none';
        sqlMergeForm.style.display = isNew ? 'none' : 'block';
      });
    });

    // Excel インポートモード切り替え (new vs merge)
    const excelModeRadios = this.element.querySelectorAll('input[name="excelImportMode"]');
    const excelNewForm = this.element.querySelector('#excelNewForm');
    const excelMergeForm = this.element.querySelector('#excelMergeForm');

    excelModeRadios.forEach(r => {
      r.addEventListener('change', () => {
        const isNew = r.value === 'new';
        excelNewForm.style.display = isNew ? 'block' : 'none';
        excelMergeForm.style.display = isNew ? 'none' : 'block';
      });
    });

    // SQL 方言切り替え時の動的オプション再描画
    const sqlDbTypeSelect = this.element.querySelector('#sqlDbType');
    if (sqlDbTypeSelect) {
      sqlDbTypeSelect.addEventListener('change', () => {
        this.renderDynamicOptions();
      });
    }

    // ドロップゾーンの設定ヘルパー
    const setupDropzone = (dropzoneId, inputId, infoId, clearBtnId) => {
      const dropzone = this.element.querySelector(`#${dropzoneId}`);
      const fileInput = this.element.querySelector(`#${inputId}`);
      const fileInfo = this.element.querySelector(`#${infoId}`);
      const clearBtn = this.element.querySelector(`#${clearBtnId}`);

      if (!dropzone || !fileInput) return;

      dropzone.addEventListener('click', () => fileInput.click());

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleFileSelected(file, fileInfo);
      });

      dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('dragover');
      });
      dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
      dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) this.handleFileSelected(file, fileInfo);
      });

      if (clearBtn) {
        clearBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectedFile = null;
          this.fileContent = '';
          this.fileBuffer = null;
          fileInput.value = '';
          fileInfo.style.display = 'none';
        });
      }
    };

    setupDropzone('sqlDropzone', 'sqlFileInput', 'sqlFileInfo', 'btnSqlFileClear');
    setupDropzone('excelDropzone', 'excelFileInput', 'excelFileInfo', 'btnExcelFileClear');
    setupDropzone('schemaDropzone', 'schemaFileInput', 'schemaFileInfo', 'btnSchemaFileClear');
    setupDropzone('erdDropzone', 'erdFileInput', 'erdFileInfo', 'btnErdFileClear');
    setupDropzone('projectDropzone', 'projectFileInput', 'projectFileInfo', 'btnProjectFileClear');

    // インポート実行ボタン
    submitBtn.addEventListener('click', async () => {
      await this.handleImportSubmit();
    });
  }

  bindStore() {
    appStore.on('import:open:request', () => {
      this.show();
    });
  }

  show() {
    this.updateSchemaSelector();
    this.updateDialectSelector();
    this.resetForm();

    // 日本語コメント: プロジェクト未作成状態の判定と案内バナーの表示制御
    const isNoProject = appStore.state.isEmptyProject || !appStore.state.projectMeta;
    const noProjectBanner = this.element.querySelector('#importNoProjectBanner');
    if (noProjectBanner) {
      noProjectBanner.textContent = t('importModal.warnNoProjectBanner');
      noProjectBanner.style.display = isNoProject ? 'block' : 'none';
    }

    // 独立インポーター (Excel設計書など) の存在チェック
    const hasExcelImporter = pluginManager.getImporters().some(i => i.id === 'erstudio-excel' || i.id === 'excel' || i.type === 'excel');
    const excelTabBtn = this.element.querySelector('.dbe-import-modal-tab-btn[data-tab="excel"]');
    if (excelTabBtn) {
      excelTabBtn.style.display = hasExcelImporter ? 'inline-block' : 'none';
    }

    if (this.activeTab === 'excel' && !hasExcelImporter) {
      this.activeTab = 'sql';
    }

    this.element.style.display = 'flex';
    this.switchTab(this.activeTab);
  }

  updateDialectSelector() {
    const sqlDbTypeSelect = this.element.querySelector('#sqlDbType');
    if (!sqlDbTypeSelect) return;

    const dialectsWithImporter = dialectManager.getAll().filter(d => Boolean(d.importer));
    if (dialectsWithImporter.length > 0) {
      sqlDbTypeSelect.innerHTML = dialectsWithImporter.map(d =>
        `<option value="${escapeHtml(d.id)}">${escapeHtml(d.displayName)}</option>`
      ).join('');
      sqlDbTypeSelect.disabled = false;
    } else {
      sqlDbTypeSelect.innerHTML = `<option value="" disabled selected>${t('importModal.noDialectPlugins')}</option>`;
      sqlDbTypeSelect.disabled = true;
    }
  }

  switchTab(tabId) {
    this.activeTab = tabId;

    // タブボタンのアクティブ更新
    const tabBtns = this.element.querySelectorAll('.dbe-import-modal-tab-btn');
    tabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
    });

    // コンテンツのアクティブ更新
    const contents = {
      sql: this.element.querySelector('#sqlImportContent'),
      excel: this.element.querySelector('#excelImportContent'),
      schema: this.element.querySelector('#schemaImportContent'),
      erd: this.element.querySelector('#erdImportContent'),
      project: this.element.querySelector('#projectImportContent'),
    };

    Object.entries(contents).forEach(([k, el]) => {
      if (el) el.classList.toggle('active', k === tabId);
    });

    if (tabId === 'sql') {
      this.renderDynamicOptions();
    }
  }

  renderDynamicOptions() {
    const container = this.element.querySelector('#sqlDynamicOptionsArea');
    if (!container) return;

    const selectedDbType = this.element.querySelector('#sqlDbType')?.value || 'Oracle';
    const dialect = dialectManager.resolve(selectedDbType);
    const importer = dialect?.importer;
    const options = importer?.importOptions || [];

    if (options.length === 0) {
      container.innerHTML = '';
      return;
    }

    container.innerHTML = options.map(opt => {
      if (opt.type === 'select') {
        const optHtml = (opt.options || []).map(o =>
          `<option value="${escapeHtml(o.value)}" ${o.value === opt.default ? 'selected' : ''}>${escapeHtml(o.label)}</option>`
        ).join('');
        return `
          <div class="dbe-import-form-group" style="margin-top: 10px;">
            <label for="import-opt-${escapeHtml(opt.key)}">${escapeHtml(opt.label)}</label>
            <select class="dbe-import-select" id="import-opt-${escapeHtml(opt.key)}">${optHtml}</select>
            ${opt.description ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${escapeHtml(opt.description)}</div>` : ''}
          </div>
        `;
      }
      return '';
    }).join('');
  }

  updateSchemaSelector() {
    const schemas = Array.from(appStore.state.schemas?.keys() || []);
    const selects = [
      this.element.querySelector('#sqlMergeSchemaSelect'),
      this.element.querySelector('#excelMergeSchemaSelect'),
    ];

    const activeSchema = appStore.state.activeSchema || '';
    selects.forEach(select => {
      if (!select) return;
      select.innerHTML = `<option value="">${t('importModal.selectMergeSchema')}</option>`;
      schemas.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.textContent = s;
        if (s === activeSchema) opt.selected = true;
        select.appendChild(opt);
      });
    });
  }

  resetForm() {
    this.selectedFile = null;
    this.fileContent = '';
    this.fileBuffer = null;

    const inputs = this.element.querySelectorAll('.dbe-import-file-input');
    inputs.forEach(i => i.value = '');

    const infos = this.element.querySelectorAll('.dbe-import-file-info');
    infos.forEach(i => i.style.display = 'none');

    const sqlSchemaInput = this.element.querySelector('#sqlSchemaName');
    if (sqlSchemaInput) sqlSchemaInput.value = '';

    const excelSchemaInput = this.element.querySelector('#excelSchemaName');
    if (excelSchemaInput) excelSchemaInput.value = '';

    const metaOnlyCheck = this.element.querySelector('#excelMergeMetaOnly');
    if (metaOnlyCheck) metaOnlyCheck.checked = true;

    const mergeColsCheck = this.element.querySelector('#excelMergeColumns');
    if (mergeColsCheck) mergeColsCheck.checked = false;
  }

  handleFileSelected(file, fileInfoEl) {
    this.selectedFile = file;
    const reader = new FileReader();

    // Excel または ZIP はバイナリ (ArrayBuffer) として読み込む
    const isBinary = /\.(xlsx|xlsm|xls|zip)$/i.test(file.name);

    reader.onload = (e) => {
      if (isBinary) {
        this.fileBuffer = e.target.result;
        this.fileContent = '';
      } else {
        this.fileContent = e.target.result;
        this.fileBuffer = null;
      }

      if (fileInfoEl) {
        fileInfoEl.style.display = 'flex';
        fileInfoEl.querySelector('.file-name').textContent = `${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
      }

      // 新規スキーマ名の自動提案 (SQLタブまたはExcelタブ)
      if (this.activeTab === 'sql' || this.activeTab === 'excel') {
        const inputId = this.activeTab === 'sql' ? '#sqlSchemaName' : '#excelSchemaName';
        const schemaInput = this.element.querySelector(inputId);
        if (schemaInput && !schemaInput.value) {
          const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();
          schemaInput.value = nameWithoutExt;
        }
      }
    };

    if (isBinary) {
      reader.readAsArrayBuffer(file);
    } else {
      reader.readAsText(file);
    }
  }

  async handleImportSubmit() {
    // 日本語コメント: プロジェクト未作成時は「プロジェクト」タブ（ZIP/JSON復元）以外のインポート実行をガード
    if ((appStore.state.isEmptyProject || !appStore.state.projectMeta) && this.activeTab !== 'project') {
      alert(t('importModal.errNoProject'));
      return;
    }

    if (this.activeTab === 'sql') {
      await this.handleSqlImport();
    } else if (this.activeTab === 'excel') {
      await this.handleExcelImport();
    } else if (this.activeTab === 'schema') {
      await this.handleSchemaImport();
    } else if (this.activeTab === 'erd') {
      await this.handleErdImport();
    } else if (this.activeTab === 'project') {
      await this.handleProjectImport();
    }
  }

  async handleSqlImport() {
    if (!this.fileContent || !this.fileContent.trim()) {
      alert(t('importModal.errNoFile'));
      return;
    }

    const isNew = this.element.querySelector('input[name="sqlImportMode"]:checked')?.value === 'new';
    const schemaNameInput = this.element.querySelector('#sqlSchemaName')?.value.trim();
    const mergeSchema = this.element.querySelector('#sqlMergeSchemaSelect')?.value;

    if (isNew && !schemaNameInput) {
      alert(t('importModal.errSchemaName'));
      return;
    }
    if (!isNew && !mergeSchema) {
      alert(t('importModal.errMergeSchema'));
      return;
    }

    let targetSchemaName = isNew ? schemaNameInput : mergeSchema;

    // 画面で選択されたデータベース種別から方言を解決
    const selectedDbType = this.element.querySelector('#sqlDbType')?.value || 'Oracle';
    const dialect = dialectManager.resolve(selectedDbType);

    // 日本語コメント: UI描画更新のためのウェイトヘルパー
    const delay = (ms = 50) => new Promise(r => setTimeout(r, ms));
    const onProgress = async ({ step, percent, message }) => {
      appStore.setProgress(percent, message);
      await delay(40); // 日本語コメント: ブラウザのUIスレッドへ描画を譲致
    };

    // 日本語コメント: インポート実行開始時にモーダルを非表示化し、全画面プログレス表示を確実に前面へ可視化
    this.element.style.display = 'none';

    // 日本語コメント: 進捗初期化 (5%: DDL解析開始)
    appStore.setProgress(5, t('importModal.progressParsingSql'));

    try {
      let importedDbml = this.fileContent;
      const isDbml = (this.selectedFile?.name || '').endsWith('.dbml') || /^\s*(Table|Project|Enum|TableGroup)\s+/im.test(this.fileContent);

      if (!isDbml) {
        if (!dialect || !dialect.importer) {
          throw new Error(t('importModal.errNoImporter'));
        }

        const sqlOptions = {
          schemaName: targetSchemaName,
          onProgress,
        };
        const commentTargetSelect = this.element.querySelector('#import-opt-commentTarget');
        if (commentTargetSelect) {
          sqlOptions.commentTarget = commentTargetSelect.value;
        }

        const importResult = await dialect.importer.execute(this.fileContent, sqlOptions);

        if (!importResult.success) {
          throw new Error(importResult.error || t('importModal.errSqlConvert'));
        }
        importedDbml = importResult.dbml;
      }

      let finalDbml = importedDbml;
      let createdNewSchema = false;

      // 新規スキーマ作成 または 既存スキーマへのマージ
      if (isNew) {
        if (!appStore.state.schemas.has(targetSchemaName)) {
          // 日本語コメント: サーバー側で正規化されたスキーマ名を受け取り、作成フラグを記録
          const createdEntry = await projectService.createSchema({
            filename: targetSchemaName,
            databaseType: dialect?.dbmlDatabaseType || appStore.state.activeDialect?.dbmlDatabaseType || 'standard',
          });
          if (createdEntry?.filename) {
            targetSchemaName = createdEntry.filename;
          }
          createdNewSchema = true;
        }
      } else {
        const existingEntry = appStore.state.schemas.get(targetSchemaName);
        const existingDbml = existingEntry?.dbml || '';
        const metaOnly = this.element.querySelector('#excelMergeMetaOnly')?.checked ?? true;
        const mergeColumns = this.element.querySelector('#excelMergeColumns')?.checked ?? false;
        finalDbml = mergeDbml(existingDbml, importedDbml, {
          metaOnly,
          mergeColumns,
        });
      }

      // 日本語コメント: Step 4 (85%) DBMLロード中
      appStore.setProgress(85, t('importModal.progressLoadingDbml'));
      await delay(50);

      // saveSchemaDbml で DBML 更新・パース・サーバー永続化を一気通貫で実行（失敗時は新規作成した空スキーマをロールバック削除）
      try {
        await projectService.saveSchemaDbml(targetSchemaName, finalDbml);
      } catch (saveErr) {
        if (createdNewSchema) {
          await projectService.deleteSchema(targetSchemaName).catch(() => {});
        }
        throw saveErr;
      }

      // インポートしたスキーマを即座にアクティブスキーマに切り替えて画面を更新
      appStore.switchSchema(targetSchemaName, { force: true });

      // 日本語コメント: Step 4 (100%) インポート完了
      appStore.setProgress(100, t('importModal.progressImportComplete'));
      await delay(300);

      this.element.style.display = 'none';
      appStore.hideLoading();
      alert(t('importModal.successSql'));
    } catch (err) {
      // 日本語コメント: インポート失敗時はモーダルを再表示してユーザーが設定を見直せるように復帰
      this.element.style.display = 'flex';
      appStore.hideLoading();
      alert(t('importModal.errImportFailed', { message: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }

  /**
   * 日本語コメント: ER/Studio Excel 設計書インポート実行
   */
  async handleExcelImport() {
    if (!this.fileBuffer && (!this.fileContent || !this.fileContent.trim())) {
      alert(t('importModal.errNoExcelFile'));
      return;
    }

    const isNew = this.element.querySelector('input[name="excelImportMode"]:checked')?.value === 'new';
    const schemaNameInput = this.element.querySelector('#excelSchemaName')?.value.trim();
    const mergeSchema = this.element.querySelector('#excelMergeSchemaSelect')?.value;

    if (isNew && !schemaNameInput) {
      alert(t('importModal.errSchemaName'));
      return;
    }
    if (!isNew && !mergeSchema) {
      alert(t('importModal.errMergeSchema'));
      return;
    }

    let targetSchemaName = isNew ? schemaNameInput : mergeSchema;
    appStore.showLoading(t('importModal.loadingExcel'));

    try {
      const importer = pluginManager.getImporters().find(i => i.id === 'erstudio-excel' || i.id === 'excel' || i.type === 'excel');
      if (!importer || typeof importer.execute !== 'function') {
        throw new Error(t('importModal.errNoExcelImporter'));
      }

      const dataToParse = this.fileBuffer || this.fileContent;
      const importResult = await importer.execute(dataToParse, {
        schemaName: targetSchemaName,
      });

      if (!importResult.success) {
        throw new Error(importResult.error || t('importModal.errExcelParse'));
      }

      const importedDbml = importResult.dbml;
      let finalDbml = importedDbml;
      let createdNewSchema = false;

      // 新規スキーマ作成 または 既存スキーマへのマージ
      if (isNew) {
        if (!appStore.state.schemas.has(targetSchemaName)) {
          // 日本語コメント: サーバー側で正規化されたスキーマ名を受け取り、作成フラグを記録
          const createdEntry = await projectService.createSchema({
            filename: targetSchemaName,
            databaseType: appStore.state.activeDialect?.dbmlDatabaseType || 'standard',
          });
          if (createdEntry?.filename) {
            targetSchemaName = createdEntry.filename;
          }
          createdNewSchema = true;
        }
      } else {
        const existingEntry = appStore.state.schemas.get(targetSchemaName);
        const existingDbml = existingEntry?.dbml || '';
        const metaOnly = this.element.querySelector('#excelMergeMetaOnly')?.checked ?? true;
        const mergeColumns = this.element.querySelector('#excelMergeColumns')?.checked ?? false;
        finalDbml = mergeDbml(existingDbml, importedDbml, {
          metaOnly,
          mergeColumns,
        });
      }

      // saveSchemaDbml で DBML 更新・パース・サーバー永続化を一気通貫で実行（失敗時は新規作成した空スキーマをロールバック削除）
      try {
        await projectService.saveSchemaDbml(targetSchemaName, finalDbml);
      } catch (saveErr) {
        if (createdNewSchema) {
          await projectService.deleteSchema(targetSchemaName).catch(() => {});
        }
        throw saveErr;
      }

      // インポートしたスキーマを即座にアクティブ化
      appStore.switchSchema(targetSchemaName, { force: true });

      this.element.style.display = 'none';
      alert(t('importModal.successExcel', { schema: targetSchemaName }));
    } catch (err) {
      alert(t('importModal.errExcelFailed', { message: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }

  async handleSchemaImport() {
    if (!this.fileContent || !this.fileContent.trim()) {
      alert(t('importModal.errNoFile'));
      return;
    }

    const fileName = this.selectedFile?.name || 'imported_schema.dbml';
    let schemaName = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    appStore.showLoading(t('importModal.loadingSchema'));
    try {
      let createdNewSchema = false;
      if (!appStore.state.schemas.has(schemaName)) {
        // 日本語コメント: サーバー側で正規化されたスキーマ名を受け取り、作成フラグを記録
        const createdEntry = await projectService.createSchema({
          filename: schemaName,
          databaseType: appStore.state.activeDialect?.dbmlDatabaseType || 'standard',
        });
        if (createdEntry?.filename) {
          schemaName = createdEntry.filename;
        }
        createdNewSchema = true;
      }

      // DBML保存に失敗した場合は新規作成した空スキーマをロールバック削除
      try {
        await projectService.saveSchemaDbml(schemaName, this.fileContent);
      } catch (saveErr) {
        if (createdNewSchema) {
          await projectService.deleteSchema(schemaName).catch(() => {});
        }
        throw saveErr;
      }

      // インポートしたスキーマを即座にアクティブ化
      appStore.switchSchema(schemaName, { force: true });

      this.element.style.display = 'none';
      alert(t('importModal.successSchema'));
    } catch (err) {
      alert(t('importModal.errImportFailed', { message: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }

  /**
   * 日本語コメント: 単一 ER図 (JSON) インポート処理
   */
  async handleErdImport() {
    if (!this.fileContent || !this.fileContent.trim()) {
      alert(t('importModal.errNoFile'));
      return;
    }

    appStore.showLoading(t('importModal.loadingErd'));
    try {
      let erdData;
      try {
        erdData = JSON.parse(this.fileContent);
      } catch (e) {
        throw new Error(t('importModal.errErdParse'));
      }

      const defaultName = (this.selectedFile?.name || 'imported_erd.json').replace(/\.[^/.]+$/, '');
      const erdName = erdData.name || defaultName;
      const erdDesc = erdData.description || '';
      const content = erdData.content || erdData;

      // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
      const erdId = generateShortId(10);

      if (!appStore.state.erds) {
        appStore.state.erds = new Map();
      }
      appStore.state.erds.set(erdId, {
        id: erdId,
        filename: erdId,
        name: erdName,
        description: erdDesc,
        visible: true,
        content: content,
        // 日本語コメント: 新規インポートしたER図のみを差分保存対象(dirty: true)としてマーク
        dirty: true,
      });

      // 日本語コメント: projectMeta.files.erds に登録し、ブラウザリロード時にも永続化されるようにする
      if (!appStore.state.projectMeta) {
        appStore.state.projectMeta = { files: { schemas: [], erds: [] } };
      }
      if (!appStore.state.projectMeta.files) {
        appStore.state.projectMeta.files = { schemas: [], erds: [] };
      }
      if (!Array.isArray(appStore.state.projectMeta.files.erds)) {
        appStore.state.projectMeta.files.erds = [];
      }
      appStore.state.projectMeta.files.erds.push({
        id: erdId,
        filename: erdId,
        name: erdName,
        description: erdDesc,
        visible: true,
      });

      // 日本語コメント: アクティブスキーマの無駄なDBML再生成をスキップし、インポートしたER図とproject.jsonのみをサーバー永続化
      await projectService.saveProject({ skipRegenerateActive: true });

      // 日本語コメント: UI一覧を更新し、インポートしたER図へ自動画面遷移
      appStore.emit('erds:updated', appStore.state.erds);
      appStore.switchErd(erdId);

      this.element.style.display = 'none';
      alert(t('importModal.successErdImport', { name: erdName }));
    } catch (err) {
      alert(t('importModal.errErdImportFailed', { error: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }

  /**
   * 日本語コメント: プロジェクト一括復元処理（.zip パッケージ または .json）
   */
  async handleProjectImport() {
    const isZip = this.fileBuffer && (
      (this.selectedFile?.name || '').toLowerCase().endsWith('.zip') ||
      new Uint8Array(this.fileBuffer)[0] === 0x50 // PKヘッダー
    );

    if (!isZip && (!this.fileContent || !this.fileContent.trim())) {
      alert(t('importModal.errNoFile'));
      return;
    }

    appStore.showLoading(t('importModal.loadingProject'));
    try {
      if (isZip) {
        // --- ① ZIP パッケージ復元 ---
        const zipFiles = await readZipBlob(this.fileBuffer);

        if (!zipFiles || zipFiles.length === 0) {
          throw new Error(t('importModal.errZipEmpty'));
        }

        // パスを正規化し、フォルダエントリを除外
        const normalizedFiles = new Map();
        for (const file of zipFiles) {
          const normPath = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
          if (!normPath.endsWith('/')) {
            normalizedFiles.set(normPath, file);
          }
        }

        // もし共通の最上位フォルダ（例: "project_name/schemas/..."）で包まれている場合、プレフィックスをトリム
        let pathList = Array.from(normalizedFiles.keys());
        const firstSlashIdx = pathList[0].indexOf('/');
        if (firstSlashIdx !== -1) {
          const commonPrefix = pathList[0].substring(0, firstSlashIdx + 1);
          const allSharePrefix = pathList.every(p => p.startsWith(commonPrefix));
          if (allSharePrefix && !normalizedFiles.has('project.json')) {
            const remapped = new Map();
            for (const [p, f] of normalizedFiles) {
              remapped.set(p.substring(commonPrefix.length), f);
            }
            normalizedFiles.clear();
            for (const [p, f] of remapped) {
              normalizedFiles.set(p, f);
            }
            pathList = Array.from(normalizedFiles.keys());
          }
        }

        // 1. プロジェクトメタデータの抽出 (project.json)
        let restoredMeta = null;
        for (const [path, file] of normalizedFiles) {
          if (path === 'project.json' || path.endsWith('/project.json')) {
            try {
              const parsed = JSON.parse(file.content);
              if (parsed && typeof parsed === 'object') {
                restoredMeta = parsed;
              }
            } catch (err) {
              console.warn('[handleProjectImport] Failed to parse project.json:', err);
            }
          }
        }

        if (!restoredMeta) {
          // 日本語コメント: project.json が含まれていない場合のデフォルトメタデータ生成（多言語対応）
          restoredMeta = appStore.state.projectMeta || {
            meta: { jsonFormatVersion: '2.0.0' },
            info: { name: 'imported_project', description: t('importModal.defaultImportedProjectDesc') },
            files: { schemas: [], erds: [] },
          };
        }

        if (!restoredMeta.files) restoredMeta.files = {};
        if (!restoredMeta.files.schemas) restoredMeta.files.schemas = [];
        if (!restoredMeta.files.erds) restoredMeta.files.erds = [];

        // 2. スキーマファイルの抽出 (schemas/*.dbml または 直下の *.dbml)
        const schemasPayload = {};
        let firstSchemaName = null;
        for (const [path, file] of normalizedFiles) {
          if (path.endsWith('.dbml')) {
            const fileName = path.split('/').pop() || '';
            const schemaName = fileName.replace(/\.dbml$/i, '');
            if (schemaName) {
              schemasPayload[schemaName] = file.content;
              if (!firstSchemaName) firstSchemaName = schemaName;

              // restoredMeta.files.schemas に未登録なら追加
              const exists = restoredMeta.files.schemas.some(s => s.filename === schemaName);
              if (!exists) {
                restoredMeta.files.schemas.push({
                  // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
                  ShortID: generateShortId(10),
                  filename: schemaName,
                  visible: true,
                });
              }
            }
          }
        }

        const schemaCount = Object.keys(schemasPayload).length;
        if (schemaCount === 0) {
          throw new Error(t('importModal.errZipNoSchema'));
        }

        // 3. ER図ファイルの抽出 (erds/*.json)
        const erdsPayload = {};
        for (const [path, file] of normalizedFiles) {
          if ((path.startsWith('erds/') || path.includes('/erds/')) && path.endsWith('.json')) {
            try {
              const erdJson = JSON.parse(file.content);
              const fileName = path.split('/').pop() || '';
              const erdName = erdJson.name || fileName.replace(/\.json$/i, '');
              const erdId = erdJson.id || generateShortId(10);
              erdsPayload[erdId] = erdJson.content || erdJson;

              // restoredMeta.files.erds に未登録なら追加
              const exists = restoredMeta.files.erds.some(e => (e.id || e.filename) === erdId);
              if (!exists) {
                restoredMeta.files.erds.push({
                  // 日本語コメント: 確定した erdId をそのまま設定
                  id: erdId,
                  filename: erdId,
                  name: erdName,
                  description: erdJson.description || '',
                  visible: true,
                });
              }
            } catch (err) {
              console.warn(`[handleProjectImport] Failed to parse ERD JSON ${path}:`, err);
            }
          }
        }

        // 4. サーバーの一括保存API (/api/project/save) へ直接永続化
        // 画面モデルからの意図しない再生成上書きを防ぎ、全スキーマ・全ER図を完全保存
        const saveRes = await fetch('/api/project/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            project: restoredMeta,
            schemas: schemasPayload,
            erds: erdsPayload,
          }),
        });

        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${saveRes.status}`);
        }

        // 5. サーバーから最新プロジェクトを一括パース・読み込み
        await projectService.loadProject();

        // 6. 最初のスキーマをアクティブ化
        if (firstSchemaName) {
          appStore.switchSchema(firstSchemaName);
        }

        this.element.style.display = 'none';
        alert(t('importModal.successProjectZip', { schemaCount, erdCount: Object.keys(erdsPayload).length }));

      } else {
        // --- ② 単一 JSON プロジェクト復元 (従来互換) ---
        let projectData;
        try {
          projectData = JSON.parse(this.fileContent);
        } catch (e) {
          throw new Error(t('importModal.errProjectJsonParse'));
        }

        const schemas = projectData.schemas || {};
        const schemaEntries = Object.entries(schemas);

        if (schemaEntries.length === 0) {
          throw new Error(t('importModal.errProjectNoSchema'));
        }

        const schemasPayload = {};
        const restoredMeta = projectData.project || appStore.state.projectMeta || {
          meta: { jsonFormatVersion: '2.0.0' },
          info: { name: 'imported_project' },
          files: { schemas: [], erds: [] },
        };
        if (!restoredMeta.files) restoredMeta.files = {};
        if (!restoredMeta.files.schemas) restoredMeta.files.schemas = [];
        // 日本語コメント: files.erds 配列の存在を保証
        if (!restoredMeta.files.erds) restoredMeta.files.erds = [];

        let firstSchemaName = null;
        for (const [name, sData] of schemaEntries) {
          const dbml = typeof sData === 'string' ? sData : (sData.dbml || '');
          schemasPayload[name] = dbml;
          if (!firstSchemaName) firstSchemaName = name;
          if (!restoredMeta.files.schemas.some(s => s.filename === name)) {
            restoredMeta.files.schemas.push({
              // 日本語コメント: 接頭辞なしBase62 10桁のShortIDを採番
              ShortID: generateShortId(10),
              filename: name,
              visible: true,
            });
          }
        }

        const erdsPayload = projectData.erds || {};
        // 日本語コメント: projectData.erds の各エントリについて restoredMeta.files.erds に未登録なら追加
        for (const [erdKey, erdObj] of Object.entries(erdsPayload)) {
          const targetId = erdObj?.id || erdKey;
          const exists = restoredMeta.files.erds.some(e => (e.id || e.filename) === targetId);
          if (!exists) {
            restoredMeta.files.erds.push({
              id: targetId,
              filename: erdObj?.filename || targetId,
              name: erdObj?.name || erdKey,
              description: erdObj?.description || '',
              visible: erdObj?.visible !== undefined ? erdObj.visible : true,
            });
          }
        }

        // サーバーに一括保存
        const saveRes = await fetch('/api/project/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            project: restoredMeta,
            schemas: schemasPayload,
            erds: erdsPayload,
          }),
        });

        if (!saveRes.ok) {
          const errData = await saveRes.json().catch(() => ({}));
          throw new Error(errData.error || `HTTP ${saveRes.status}`);
        }

        await projectService.loadProject();

        if (firstSchemaName) {
          appStore.switchSchema(firstSchemaName);
        }

        this.element.style.display = 'none';
        alert(t('importModal.successProject'));
      }
    } catch (err) {
      alert(t('importModal.errImportFailed', { message: err.message }));
    } finally {
      appStore.hideLoading();
    }
  }
}
