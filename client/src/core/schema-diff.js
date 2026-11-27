// 日本語コメント: スキーマ差分抽出モジュール (src/core/schema-diff.js)
// 旧DBMLと新DBML（またはASTモデル）を精密比較し、テーブルおよびカラム単位の正確な差分情報を抽出します。
// カラムだけでなくインデックス、外部キー(FK)、テーブル物理属性の左右1対1アラインメント比較をサポートします。

import { t } from './i18n.js';

/**
 * ダブルクォートや余分な空白を除去して正規化された名前（テーブル名・カラム名）を取得
 */
export function cleanName(str) {
  if (str === undefined || str === null) return '';
  if (typeof str === 'object') {
    str = str.name || str.type_name || String(str);
  }
  return String(str).replace(/"/g, '').trim().toLowerCase();
}

/**
 * クォート外のカンマで安全に文字列を分割する
 * シングルクォート、ダブルクォート、バッククォート内のカンマを保護します（note: '住所（A, B）' 等の破壊防止）。
 */
export function splitByCommaOutsideQuotes(str) {
  if (!str) return [];
  const tokens = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : '';

    if (char === "'" && !inDoubleQuote && !inBacktick && prevChar !== '\\') {
      inSingleQuote = !inSingleQuote;
      current += char;
    } else if (char === '"' && !inSingleQuote && !inBacktick && prevChar !== '\\') {
      inDoubleQuote = !inDoubleQuote;
      current += char;
    } else if (char === '`' && !inSingleQuote && !inDoubleQuote && prevChar !== '\\') {
      inBacktick = !inBacktick;
      current += char;
    } else if (char === ',' && !inSingleQuote && !inDoubleQuote && !inBacktick) {
      tokens.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    tokens.push(current.trim());
  }
  return tokens;
}

/**
 * [...] オプション文字列を安全にパースして属性オブジェクトを返却
 */
export function parseOptionsBracket(optContent) {
  const options = {};
  if (!optContent) return options;

  const parts = splitByCommaOutsideQuotes(optContent);
  for (const part of parts) {
    const colonIdx = part.indexOf(':');
    if (colonIdx !== -1) {
      const key = part.substring(0, colonIdx).trim().toLowerCase();
      let val = part.substring(colonIdx + 1).trim();
      // 外側のクォートを除去してエスケープ文字を復元
      if ((val.startsWith("'") && val.endsWith("'")) ||
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith('`') && val.endsWith('`'))) {
        val = val.substring(1, val.length - 1);
      }
      val = val.replace(/\\([n'"\\])/g, (_, ch) => (ch === 'n' ? '\n' : ch));
      options[key] = val;
    } else {
      // フラグ属性 (pk, not null, unique, increment など)
      const flag = part.trim().toLowerCase();
      if (flag) {
        options[flag] = true;
      }
    }
  }
  return options;
}

/**
 * カラムの完全な型・桁数文字列（例: "VARCHAR2(10)", "NUMBER(10,2)"）をASTノードから抽出
 * oracle, postgresql, mysql, standard の各DBMS表示補正をサポート
 */
export function formatColumnFullType(field, targetDbms = 'oracle') {
  const dbms = (targetDbms || 'oracle').toLowerCase();
  if (!field) {
    return dbms === 'oracle' ? 'VARCHAR2(255)' : 'VARCHAR(255)';
  }

  let typeName = field.dataType || (typeof field.type === 'string' ? field.type : (field.type?.type_name || ''));
  let typeArgs = field.typeArgs || (field.type?.args || '');

  typeName = (typeName || '').replace(/"/g, '').trim().toUpperCase();
  typeArgs = String(typeArgs || '').replace(/"/g, '').trim();

  // typeName にすでに括弧が含まれている場合（例: "VARCHAR2(10)"）の分解処理
  if (typeName.includes('(') && typeName.endsWith(')')) {
    const parenIdx = typeName.indexOf('(');
    if (!typeArgs) {
      typeArgs = typeName.substring(parenIdx + 1, typeName.length - 1).trim();
    }
    typeName = typeName.substring(0, parenIdx).trim();
  }

  // DBMS別の標準型補正
  if (dbms === 'oracle') {
    if (typeName === 'VARCHAR' || typeName === 'STRING') typeName = 'VARCHAR2';
    if (typeName === 'INT' || typeName === 'INTEGER') typeName = 'NUMBER';
    if (typeName === 'DATETIME' || typeName === 'TIMESTAMP') typeName = 'DATE';
    if (typeName === 'TEXT' || typeName === 'LONGTEXT') typeName = 'CLOB';
    if (typeName === 'BYTEA') typeName = 'BLOB';
  } else if (dbms === 'postgresql') {
    if (typeName === 'NUMBER') typeName = 'NUMERIC';
    if (typeName === 'VARCHAR2' || typeName === 'STRING') typeName = 'VARCHAR';
    if (typeName === 'DATETIME') typeName = 'TIMESTAMP';
    if (typeName === 'CLOB' || typeName === 'LONGTEXT') typeName = 'TEXT';
    if (typeName === 'BLOB' || typeName === 'LONGBLOB') typeName = 'BYTEA';
    if (typeName === 'INT4') typeName = 'INTEGER';
    if (typeName === 'INT8') typeName = 'BIGINT';
  } else if (dbms === 'mysql') {
    if (typeName === 'VARCHAR2' || typeName === 'STRING') typeName = 'VARCHAR';
    if (typeName === 'NUMBER') typeName = 'DECIMAL';
    if (typeName === 'CLOB') typeName = 'LONGTEXT';
    if (typeName === 'BYTEA') typeName = 'BLOB';
  } else if (dbms === 'standard') {
    if (typeName === 'VARCHAR2' || typeName === 'STRING') typeName = 'VARCHAR';
    if (typeName === 'INT4') typeName = 'INTEGER';
    if (typeName === 'INT8') typeName = 'BIGINT';
  }

  // 既に括弧付きで解決している場合（特殊型）のガード
  if (typeName.includes('(') && typeName.endsWith(')')) {
    return typeName;
  }

  const cleanedArgs = typeArgs.replace(/\s+/g, '');
  return cleanedArgs ? `${typeName}(${cleanedArgs})` : typeName;
}

/**
 * デフォルト値を比較用に正規化
 */
export function cleanDefaultValue(col) {
  if (!col) return '';
  let val = col.default !== undefined ? col.default : col.dbdefault;
  if (val === undefined || val === null) return '';
  let str = String(val).trim();
  str = str.replace(/^['"`]|['"`]$/g, '');
  return str.toLowerCase();
}

/**
 * DBML構文エラーを未然に自動修復するサニタイズ関数
 */
function sanitizeDbmlForParser(dbmlText) {
  if (!dbmlText) return '';
  let cleaned = String(dbmlText);

  // カラムオプション内の重複 default: の自動除去 (例: [default: 'x', default: 'y'] ➔ [default: 'x'])
  // カンマを含む default リテラルを壊さないようクォート対応分割を利用
  cleaned = cleaned.replace(/\[([^\]]*)\]/g, (match, optContent) => {
    if (!optContent.includes('default:')) return match;
    const parts = splitByCommaOutsideQuotes(optContent);
    let hasDefault = false;
    const newParts = [];
    for (const part of parts) {
      if (/^\s*default\s*:/i.test(part)) {
        if (!hasDefault) {
          hasDefault = true;
          newParts.push(part);
        }
      } else {
        newParts.push(part);
      }
    }
    return `[${newParts.join(', ')}]`;
  });

  return cleaned;
}

/**
 * Note 文字列から本文と <!-- custom --> JSON メタデータを安全に分離・抽出
 * @param {string} noteString - 生の Note 文字列
 * @returns {{ cleanNote: string, custom: Object }}
 */
export function extractCustomMetadata(noteString) {
  if (!noteString || typeof noteString !== 'string') {
    return { cleanNote: '', custom: {} };
  }

  // 1. <!-- custom {...} --> 形式 (コメントタグ内にJSONが内包されている形式)
  const match1 = noteString.match(/<!--\s*custom\s+([\s\S]*?)\s*-->/i);
  if (match1) {
    try {
      const custom = JSON.parse(match1[1]);
      const cleanNote = noteString.replace(match1[0], '').trim();
      return { cleanNote, custom: (custom && typeof custom === 'object') ? custom : {} };
    } catch (_) {}
  }

  // 2. <!-- custom -->\n{...} または <!-- custom --> {...} 形式 (マーカー直後にJSONが配置されている形式)
  const customIdx = noteString.search(/<!--\s*custom\s*-->/i);
  if (customIdx !== -1) {
    const cleanNote = noteString.substring(0, customIdx).trim();
    const afterMarker = noteString.substring(customIdx).replace(/<!--\s*custom\s*-->/i, '').trim();

    // JSON の開始波括弧 '{' を探索
    const braceIdx = afterMarker.indexOf('{');
    if (braceIdx !== -1) {
      const jsonCandidate = afterMarker.substring(braceIdx);
      // 末尾から対応する '}' を探索
      const lastBraceIdx = jsonCandidate.lastIndexOf('}');
      if (lastBraceIdx !== -1) {
        const jsonStr = jsonCandidate.substring(0, lastBraceIdx + 1);
        try {
          const custom = JSON.parse(jsonStr);
          return { cleanNote, custom: (custom && typeof custom === 'object') ? custom : {} };
        } catch (_) {}
      }
    }
  }

  return { cleanNote: noteString.trim(), custom: {} };
}

/**
 * DBMLテキストから Project ブロックを抽出し、Note内の <!-- custom --> や表領域デフォルト設定を解析
 * @param {string} dbmlText - DBMLソーステキスト
 * @returns {Object} projectDefaults
 */
export function extractProjectDefaults(dbmlText) {
  const projectDefaults = {
    tablespace: '',
    index_tablespace: '',
    lob_tablespace: '',
    custom: {}
  };
  if (!dbmlText) return projectDefaults;

  const headerMatch = dbmlText.match(/Project\s+(?:"([^"]+)"|'([^']+)'|([^{\s]+))?\s*\{/i);
  if (!headerMatch) return projectDefaults;

  const bodyStart = headerMatch.index + headerMatch[0].length;
  let depth = 1;
  let bodyEnd = -1;
  for (let i = bodyStart; i < dbmlText.length; i++) {
    const ch = dbmlText[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        bodyEnd = i;
        break;
      }
    }
  }

  if (bodyEnd === -1) return projectDefaults;
  const body = dbmlText.substring(bodyStart, bodyEnd);

  // Project 直下に記述された表領域デフォルト設定（単数形のみ対象。data_tablespaces 等の複数形はUI候補リストのため除外）
  const tsMatch = body.match(/\btablespace\s*:\s*['"]?([^'"\r\n]+)['"]?/i);
  const idxTsMatch = body.match(/\b(?:index_tablespace|indexTablespace)\s*:\s*['"]?([^'"\r\n]+)['"]?/i);
  const lobTsMatch = body.match(/\b(?:lob_tablespace|lobTablespace)\s*:\s*['"]?([^'"\r\n]+)['"]?/i);

  if (tsMatch) projectDefaults.tablespace = tsMatch[1].trim();
  if (idxTsMatch) projectDefaults.index_tablespace = idxTsMatch[1].trim();
  if (lobTsMatch) projectDefaults.lob_tablespace = lobTsMatch[1].trim();

  // Project 内の Note: 抽出 ('''...''', """...""", '...', "...", Note { ... })
  const noteMatch = body.match(/Note(?:\s*:\s*(?:'''([\s\S]*?)'''|"""([\s\S]*?)"""|'([^']*)'|"([^"]*)"|`([^`]*)`|([^\r\n]+))|\s*\{([\s\S]*?)\})/i);
  const rawNote = noteMatch
    ? (noteMatch[1] ?? noteMatch[2] ?? noteMatch[3] ?? noteMatch[4] ?? noteMatch[5] ?? noteMatch[6] ?? noteMatch[7] ?? '')
    : '';

  if (rawNote) {
    const { cleanNote, custom } = extractCustomMetadata(rawNote);
    projectDefaults.note = cleanNote;
    projectDefaults.custom = custom;

    // custom 内の単数形デフォルト表領域設定のみフォールバック反映（複数形 *_tablespaces は候補リストのため除外）
    const cTs = custom.tablespace;
    if (cTs && !String(cTs).includes(',')) {
      projectDefaults.tablespace = Array.isArray(cTs) ? cTs[0] : String(cTs).trim();
    }
    const cIdxTs = custom.index_tablespace || custom.indexTablespace;
    if (cIdxTs && !String(cIdxTs).includes(',')) {
      projectDefaults.index_tablespace = Array.isArray(cIdxTs) ? cIdxTs[0] : String(cIdxTs).trim();
    }
    const cLobTs = custom.lob_tablespace || custom.lobTablespace;
    if (cLobTs && !String(cLobTs).includes(',')) {
      projectDefaults.lob_tablespace = Array.isArray(cLobTs) ? cLobTs[0] : String(cLobTs).trim();
    }

    // その他 custom のプロパティもマージ
    Object.keys(custom).forEach(k => {
      if (projectDefaults[k] === undefined) {
        projectDefaults[k] = custom[k];
      }
    });
  }

  return projectDefaults;
}

/**
 * 構文エラーDBML用の強力な行/正規表現ベース・フォールバックパーサー
 * テーブル・カラムのメタデータ、外部キー(Refs)、インデックスを完全抽出
 */
export function parseDbmlToAst(dbmlText) {
  const tables = [];
  const refs = [];
  if (!dbmlText || !dbmlText.trim()) return { tables, refs };

  const projectDefaults = extractProjectDefaults(dbmlText);
  const sanitized = sanitizeDbmlForParser(dbmlText);
  const lines = sanitized.split('\n');
  let currentTable = null;
  let inIndexes = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) continue;

    // Table 宣言判定: Table tblName [note: 'xxx', ...] { or Table "tblName" as alias {
    const isTableStart = /^Table\s+/i.test(trimmed) && trimmed.includes('{');
    if (isTableStart) {
      let headerPart = trimmed.substring(5, trimmed.indexOf('{')).trim();
      let tableOpts = {};

      const bracketMatch = headerPart.match(/\[(.*)\]/);
      if (bracketMatch) {
        tableOpts = parseOptionsBracket(bracketMatch[1]);
        headerPart = headerPart.replace(/\[.*\]/, '').trim();
      }

      const asIdx = headerPart.search(/\s+as\s+/i);
      const namePart = asIdx !== -1 ? headerPart.substring(0, asIdx).trim() : headerPart;

      let cleanTblName = namePart;
      if (namePart.includes('.')) {
        const parts = namePart.split('.');
        cleanTblName = parts[parts.length - 1];
      }
      cleanTblName = cleanTblName.replace(/"/g, '').trim();

      if (cleanTblName) {
        currentTable = {
          name: cleanTblName,
          columns: [],
          fields: [],
          indexes: [],
          fks: [],
          note: tableOpts.note || '',
          logicalName: tableOpts.logical_name || tableOpts.logicalname || tableOpts.title || '',
          tablespace: tableOpts.tablespace || '',
          indexTablespace: tableOpts.index_tablespace || tableOpts.indexTablespace || '',
          custom: {},
          attributes: tableOpts
        };

        // tableOpts.note に <!-- custom --> が含まれる場合の抽出
        if (currentTable.note) {
          const { cleanNote, custom } = extractCustomMetadata(currentTable.note);
          currentTable.note = cleanNote;
          if (custom && Object.keys(custom).length > 0) {
            currentTable.custom = { ...custom };
            if (!currentTable.tablespace && custom.tablespace) currentTable.tablespace = custom.tablespace;
            if (!currentTable.indexTablespace && (custom.index_tablespace || custom.indexTablespace)) currentTable.indexTablespace = custom.index_tablespace || custom.indexTablespace;
            if (!currentTable.logicalName && (custom.logicalName || custom.logical_name)) currentTable.logicalName = custom.logicalName || custom.logical_name;
          }
        }

        tables.push(currentTable);
        inIndexes = false;
        continue;
      }
    }

    if (trimmed.startsWith('}')) {
      if (inIndexes) {
        inIndexes = false;
      } else if (currentTable) {
        // テーブル定義完了時のフォールバック反映・主キーおよびインデックスの正規化
        finalizeParsedTable(currentTable, projectDefaults);
        currentTable = null;
      }
      continue;
    }

    if (currentTable) {
      if (/^indexes\s*\{/i.test(trimmed)) {
        inIndexes = true;
        continue;
      }

      if (inIndexes) {
        // インデックス定義: col [options] または (col1, col2) [options]
        // カッコなしの単一カラム定義で '[' まで貪欲一致するバグを防ぐため、末尾の [...] オプションを先に分離する
        let colsPart = trimmed;
        let optStr = '';
        const optMatch = trimmed.match(/\s*\[(.*)\]\s*$/);
        if (optMatch) {
          optStr = optMatch[1];
          colsPart = trimmed.slice(0, optMatch.index).trim();
        }
        if (colsPart.startsWith('(') && colsPart.endsWith(')')) {
          colsPart = colsPart.slice(1, -1).trim();
        }

        if (colsPart) {
          const rawCols = splitByCommaOutsideQuotes(colsPart)
            .map(c => c.replace(/^["`]|["`]$/g, '').trim())
            .filter(Boolean);
          const opts = parseOptionsBracket(optStr);

          currentTable.indexes.push({
            name: opts.name || '',
            fields: rawCols,
            unique: Boolean(opts.unique),
            pk: Boolean(opts.pk),
            type: opts.type || 'btree',
            note: opts.note || '',
            tablespace: opts.tablespace || ''
          });
        }
        continue;
      }

      // テーブル内の Note: 'xxx' 定義または Note: '''...''' 複数行定義または Note { ... } 定義の抽出
      const isNoteLine = /^Note(?:\s*:\s*|\s*\{)/i.test(trimmed);
      if (isNoteLine && !currentTable.columns.some(c => c.name.toLowerCase() === 'note')) {
        let rawNote = '';
        if (/^Note\s*:\s*'''/i.test(trimmed)) {
          // トリプルクォート開始
          let content = trimmed.replace(/^Note\s*:\s*'''/i, '');
          const closeIdx = content.indexOf("'''");
          if (closeIdx !== -1) {
            rawNote = content.substring(0, closeIdx);
          } else {
            rawNote = content;
            while (i + 1 < lines.length) {
              i++;
              const nextLine = lines[i];
              const cIdx = nextLine.indexOf("'''");
              if (cIdx !== -1) {
                rawNote += '\n' + nextLine.substring(0, cIdx);
                break;
              } else {
                rawNote += '\n' + nextLine;
              }
            }
          }
        } else if (/^Note\s*:\s*"""/i.test(trimmed)) {
          // ダブルトリプルクォート開始
          let content = trimmed.replace(/^Note\s*:\s*"""/i, '');
          const closeIdx = content.indexOf('"""');
          if (closeIdx !== -1) {
            rawNote = content.substring(0, closeIdx);
          } else {
            rawNote = content;
            while (i + 1 < lines.length) {
              i++;
              const nextLine = lines[i];
              const cIdx = nextLine.indexOf('"""');
              if (cIdx !== -1) {
                rawNote += '\n' + nextLine.substring(0, cIdx);
                break;
              } else {
                rawNote += '\n' + nextLine;
              }
            }
          }
        } else if (/^Note\s*\{/i.test(trimmed)) {
          // ブロック形式 Note { ... }
          let content = trimmed.replace(/^Note\s*\{/i, '');
          let depth = 1;
          for (const c of content) {
            if (c === '{') depth++;
            else if (c === '}') depth--;
          }
          if (depth === 0) {
            rawNote = content.substring(0, content.lastIndexOf('}'));
          } else {
            rawNote = content;
            while (i + 1 < lines.length && depth > 0) {
              i++;
              const nextLine = lines[i];
              for (const c of nextLine) {
                if (c === '{') depth++;
                else if (c === '}') depth--;
              }
              if (depth === 0) {
                rawNote += '\n' + nextLine.substring(0, nextLine.lastIndexOf('}'));
                break;
              } else {
                rawNote += '\n' + nextLine;
              }
            }
          }
        } else {
          // 単一行 Note: '...' または "..." または `...`
          const match = trimmed.match(/^Note\s*:\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`|([^\r\n]+))/i);
          if (match) {
            rawNote = match[1] ?? match[2] ?? match[3] ?? match[4] ?? '';
          }
        }

        if (rawNote) {
          const { cleanNote, custom } = extractCustomMetadata(rawNote);
          if (cleanNote && !currentTable.note) {
            currentTable.note = cleanNote;
          }
          if (custom && Object.keys(custom).length > 0) {
            currentTable.custom = { ...(currentTable.custom || {}), ...custom };
            if (!currentTable.tablespace && custom.tablespace) {
              currentTable.tablespace = custom.tablespace;
            }
            if (!currentTable.indexTablespace && (custom.index_tablespace || custom.indexTablespace)) {
              currentTable.indexTablespace = custom.index_tablespace || custom.indexTablespace;
            }
            if (!currentTable.logicalName && (custom.logicalName || custom.logical_name)) {
              currentTable.logicalName = custom.logicalName || custom.logical_name;
            }
          }
        }
        continue;
      }

      // カラム定義: colName colType [options...]
      const colMatch = trimmed.match(/^(?:"([^"]+)"|([\w]+))\s+(?:"([^"]+)"|([a-zA-Z0-9_\(\),]+))(?:\s*\[(.*)\])?/);
      if (colMatch) {
        const colName = (colMatch[1] || colMatch[2] || '').replace(/"/g, '').trim();
        const colType = (colMatch[3] || colMatch[4] || '').replace(/"/g, '').trim();
        const optsStr = colMatch[5] || '';

        const reservedKeywords = ['indexes', 'tablegroup', 'ref', 'enum', 'note', '}'];
        if (colName && colType && !reservedKeywords.includes(colName.toLowerCase())) {
          const opts = parseOptionsBracket(optsStr);
          const isPk = Boolean(opts.pk);
          const isNotNull = Boolean(opts['not null'] || opts.notnull);
          const defaultVal = opts.default !== undefined ? opts.default : undefined;
          const rawNoteVal = opts.note !== undefined ? opts.note : undefined;
          const logicalNameVal = opts.logical_name || opts.logicalname || undefined;

          // カラム Note から <!-- custom --> を分離
          let colCleanNote = rawNoteVal;
          let colCustom = {};
          if (rawNoteVal) {
            const extracted = extractCustomMetadata(rawNoteVal);
            colCleanNote = extracted.cleanNote;
            colCustom = extracted.custom || {};
          }

          const colLogicalName = logicalNameVal || colCustom.logicalName || colCustom.logical_name || '';

          // インライン Ref 定義の抽出 (例: [ref: > tbl2.col2, delete: cascade, update: no action])
          if (opts.ref) {
            const refMatch = String(opts.ref).match(/([><\-]|<>)\s*([^\s,\]]+)/);
            if (refMatch) {
              const op = refMatch[1];
              const target = refMatch[2].replace(/"/g, '');
              let toTable = '';
              let toCols = [];
              if (target.includes('.')) {
                const parts = target.split('.');
                toTable = parts[0];
                toCols = [parts[1]];
              } else {
                toTable = target;
              }
              const fkObj = {
                name: opts.ref_name || `fk_${currentTable.name}_${colName}`,
                fromTable: currentTable.name,
                fromCols: [colName],
                toTable: toTable,
                toCols: toCols,
                op: op,
                onDelete: opts.delete || null,
                onUpdate: opts.update || null,
                from: `${currentTable.name}.${colName}`,
                to: target
              };
              refs.push(fkObj);
              currentTable.fks.push(fkObj);
            }
          }

          const colObj = {
            name: colName,
            dataType: colType,
            type: colType,
            pk: isPk,
            notNull: isNotNull,
            not_null: isNotNull,
            default: defaultVal,
            note: colCleanNote,
            logicalName: colLogicalName,
            custom: colCustom,
            attributes: { ...opts, ...colCustom, logicalName: colLogicalName }
          };
          currentTable.columns.push(colObj);
          currentTable.fields.push(colObj);
        }
      }
    }

    // スタンドアロン Ref 参照定義: Ref fk_name: tbl1.col1 > tbl2.col2 [delete: cascade, update: no action]
    const refMatch = trimmed.match(/^Ref(?:\s+([\w_]+))?:\s*([^\s]+)\s*([><\-]|<>)\s*([^\s\[]+)(?:\s*\[(.*)\])?/i);
    if (refMatch) {
      const refName = refMatch[1] || '';
      const rawFrom = refMatch[2].replace(/"/g, '');
      const op = refMatch[3];
      const rawTo = refMatch[4].replace(/"/g, '');
      const refOptsStr = refMatch[5] || '';
      const refOpts = parseOptionsBracket(refOptsStr);

      const parseEndpoint = (endpoint) => {
        const dotIdx = endpoint.indexOf('.');
        if (dotIdx === -1) return { table: endpoint, cols: [] };
        const table = endpoint.substring(0, dotIdx);
        const colPart = endpoint.substring(dotIdx + 1).replace(/[\(\)]/g, '');
        const cols = colPart.split(',').map(c => c.trim()).filter(Boolean);
        return { table, cols };
      };

      const fromInfo = parseEndpoint(rawFrom);
      const toInfo = parseEndpoint(rawTo);

      const refObj = {
        name: refName || refOpts.name || '',
        fromTable: fromInfo.table,
        fromCols: fromInfo.cols,
        toTable: toInfo.table,
        toCols: toInfo.cols,
        op: op,
        onDelete: refOpts.delete || null,
        onUpdate: refOpts.update || null,
        from: rawFrom,
        to: rawTo
      };
      refs.push(refObj);

      // 該当するテーブルの fks 配列にも登録
      const matchedTable = tables.find(t => cleanName(t.name) === cleanName(fromInfo.table));
      if (matchedTable) {
        if (!matchedTable.fks) matchedTable.fks = [];
        matchedTable.fks.push(refObj);
      }
    }
  }

  // ファイル末尾で未完了のテーブルがあればフォールバック確定
  if (currentTable) {
    finalizeParsedTable(currentTable, projectDefaults);
  }

  return { tables, refs, projectDefaults };
}

/**
 * 日本語コメント: テーブル解析完了時に物理属性フォールバック・Indexes内の[pk]からカラムpk/notNullへの同期・重複Uniqueインデックス除外を行う
 */
function finalizeParsedTable(table, projectDefaults = {}) {
  if (!table) return;

  if (!table.tablespace) {
    table.tablespace = table.custom?.tablespace || table.attributes?.tablespace || projectDefaults.tablespace || '';
  }
  if (!table.indexTablespace) {
    table.indexTablespace = table.custom?.index_tablespace || table.custom?.indexTablespace || table.attributes?.index_tablespace || table.attributes?.indexTablespace || projectDefaults.index_tablespace || '';
  }
  if (!table.logicalName) {
    table.logicalName = table.custom?.logicalName || table.custom?.logical_name || table.attributes?.logical_name || table.attributes?.logicalname || table.attributes?.title || '';
  }
  if (table.tablespace) table.attributes.tablespace = table.tablespace;
  if (table.indexTablespace) table.attributes.index_tablespace = table.indexTablespace;
  if (table.logicalName) table.attributes.logicalName = table.logicalName;
  if (table.custom) {
    table.attributes = { ...table.attributes, ...table.custom };
  }

  // 日本語コメント: カラム直接指定の [pk] および Indexes ブロック内の [pk] を収集して相互同期
  const pkColNames = new Set();
  const pkIndexNames = new Set();
  const pkColSigs = new Set();

  (table.columns || []).forEach(col => {
    if (col && col.pk) {
      col.notNull = true;
      col.not_null = true;
      pkColNames.add(cleanName(col.name));
    }
  });

  (table.indexes || []).forEach(idx => {
    if (idx && idx.pk) {
      const normCols = normalizeIndexFields(idx).filter(Boolean);
      normCols.forEach(c => pkColNames.add(c));
      if (idx.name) pkIndexNames.add(cleanName(idx.name));
      if (normCols.length > 0) {
        pkColSigs.add(normCols.join(','));
        pkColSigs.add([...normCols].sort().join(','));
      }
    }
  });

  if (pkColNames.size > 0) {
    const allPkList = Array.from(pkColNames);
    pkColSigs.add(allPkList.join(','));
    pkColSigs.add([...allPkList].sort().join(','));
    // 日本語コメント: Indexes 内の [pk] に含まれるカラムへ col.pk = true および col.notNull = true を同期
    (table.columns || []).forEach(col => {
      if (col && pkColNames.has(cleanName(col.name))) {
        col.pk = true;
        col.notNull = true;
        col.not_null = true;
      }
    });
  }

  // 日本語コメント: PKと同名または同一カラム構成の重複Uniqueインデックスおよび重複PKインデックスを除外
  if (Array.isArray(table.indexes) && table.indexes.length > 0) {
    const dedupedIndexes = [];
    const seenIdxSigs = new Set();
    let hasRegisteredPk = false;

    // 名前付きPKが名前なしPKより優先されるよう先に評価
    const orderedIndexes = [
      ...table.indexes.filter(idx => idx && idx.pk && idx.name),
      ...table.indexes.filter(idx => idx && idx.pk && !idx.name),
      ...table.indexes.filter(idx => idx && !idx.pk),
    ];

    for (const idx of orderedIndexes) {
      const normCols = normalizeIndexFields(idx).filter(Boolean);
      const colSig = normCols.join(',');
      const colSortSig = [...normCols].sort().join(',');
      const idxNameClean = cleanName(idx.name);

      if (idx.pk) {
        if (hasRegisteredPk) continue;
        hasRegisteredPk = true;
        dedupedIndexes.push(idx);
        continue;
      }

      if (
        (idxNameClean && pkIndexNames.has(idxNameClean)) ||
        (idx.unique && (pkColSigs.has(colSig) || pkColSigs.has(colSortSig)))
      ) {
        continue;
      }

      const sig = `${idx.unique ? 'UQ' : 'IDX'}:${colSig}:${idxNameClean}`;
      if (!seenIdxSigs.has(sig)) {
        seenIdxSigs.add(sig);
        dedupedIndexes.push(idx);
      }
    }

    table.indexes = dedupedIndexes;
  }
}

/**
 * 2つのカラム型定義のサイズ・桁数・精度（スケール）を精密比較し、拡大/縮小/型変更を判定
 * 第1引数（桁数）と第2引数（スケール）の両方を抽出して比較します。
 */
export function compareColumnTypeAndSize(oldCol, newCol) {
  const oldFull = formatColumnFullType(oldCol);
  const newFull = formatColumnFullType(newCol);

  if (oldFull === newFull) return 'SAME';

  const parseTypeAndArg = (fullStr) => {
    const pIdx = fullStr.indexOf('(');
    if (pIdx === -1) {
      return { baseType: fullStr.trim().toUpperCase(), length: null, scale: null, hasArgs: false };
    }
    const baseType = fullStr.substring(0, pIdx).trim().toUpperCase();
    const argStr = fullStr.substring(pIdx + 1, fullStr.length - 1).trim();
    const nums = argStr.split(',').map(s => {
      const m = s.match(/\d+/);
      return m ? parseInt(m[0], 10) : null;
    });
    return {
      baseType,
      length: nums[0] !== undefined ? nums[0] : null,
      scale: nums[1] !== undefined ? nums[1] : null,
      hasArgs: true
    };
  };

  const oldInfo = parseTypeAndArg(oldFull);
  const newInfo = parseTypeAndArg(newFull);

  // 基本データ型が異なる場合は型変更
  if (oldInfo.baseType !== newInfo.baseType) {
    return 'TYPE_CHANGED';
  }

  // 引数の有無の変更
  if (oldInfo.hasArgs !== newInfo.hasArgs) {
    if (!oldInfo.hasArgs && newInfo.hasArgs) return 'SIZE_EXPANDED';
    if (oldInfo.hasArgs && !newInfo.hasArgs) return 'SIZE_REDUCED';
    return 'TYPE_CHANGED';
  }

  const oldLen = oldInfo.length;
  const newLen = newInfo.length;
  const oldScale = oldInfo.scale;
  const newScale = newInfo.scale;

  // 桁数またはスケールが縮小しているか
  const isLengthReduced = (oldLen !== null && newLen !== null && newLen < oldLen);
  const isScaleReduced = (oldScale !== null && newScale !== null && newScale < oldScale);
  if (isLengthReduced || isScaleReduced) {
    return 'SIZE_REDUCED';
  }

  // どちらかが拡大しているか
  const isLengthExpanded = (oldLen !== null && newLen !== null && newLen > oldLen);
  const isScaleExpanded = (oldScale !== null && newScale !== null && newScale > oldScale);
  if (isLengthExpanded || isScaleExpanded) {
    return 'SIZE_EXPANDED';
  }

  // スケールの有無の変化
  if (oldScale === null && newScale !== null) return 'SIZE_EXPANDED';
  if (oldScale !== null && newScale === null) return 'SIZE_REDUCED';

  return 'TYPE_CHANGED';
}

/**
 * テーブル内の新旧カラム差分および【ズレない構造化アラインメントペア】を算出
 */
export function diffColumnsWithAlignment(oldFields = [], newFields = []) {
  const safeOld = (oldFields || []).filter(f => f && f.name);
  const safeNew = (newFields || []).filter(f => f && f.name);

  const oldMap = new Map();
  safeOld.forEach(f => oldMap.set(cleanName(f.name), f));

  const newMap = new Map();
  safeNew.forEach(f => newMap.set(cleanName(f.name), f));

  const columnsDiff = [];
  const alignedColumns = [];

  // 1. 新カラム側を巡回
  for (const newCol of safeNew) {
    const oldCol = oldMap.get(cleanName(newCol.name));

    if (!oldCol) {
      // 新規追加カラム (ADDED)
      const diffItem = {
        name: newCol.name,
        status: 'ADDED',
        oldColumn: null,
        newColumn: newCol,
        changes: ['COLUMN_ADDED']
      };
      columnsDiff.push(diffItem);
      alignedColumns.push({
        oldCol: null,
        newCol: newCol,
        status: 'ADDED',
        changes: ['COLUMN_ADDED']
      });
    } else {
      // 既存カラムの比較 (MODIFIED or UNCHANGED)
      const changes = [];

      const typeStatus = compareColumnTypeAndSize(oldCol, newCol);
      if (typeStatus !== 'SAME') {
        changes.push(typeStatus);
      }

      const oldPk = Boolean(oldCol.pk);
      const newPk = Boolean(newCol.pk);
      if (oldPk !== newPk) {
        changes.push(newPk ? 'PK_ADDED' : 'PK_REMOVED');
      }

      const oldNotNull = Boolean(oldCol.notNull || oldCol.not_null);
      const newNotNull = Boolean(newCol.notNull || newCol.not_null);
      if (oldNotNull !== newNotNull) {
        changes.push(newNotNull ? 'NOT_NULL_ADDED' : 'NOT_NULL_REMOVED');
      }

      const oldDef = cleanDefaultValue(oldCol);
      const newDef = cleanDefaultValue(newCol);
      if (oldDef !== newDef) {
        changes.push('DEFAULT_CHANGED');
      }

      const status = changes.length > 0 ? 'MODIFIED' : 'UNCHANGED';
      const diffItem = {
        name: newCol.name,
        status: status,
        oldColumn: oldCol,
        newColumn: newCol,
        changes: changes
      };
      columnsDiff.push(diffItem);
      alignedColumns.push({
        oldCol: oldCol,
        newCol: newCol,
        status: status,
        changes: changes
      });
    }
  }

  // 2. 旧カラムにあって新カラムにないもの ➔ 削除 (DROPPED)
  for (const oldCol of safeOld) {
    if (!newMap.has(cleanName(oldCol.name))) {
      const diffItem = {
        name: oldCol.name,
        status: 'DROPPED',
        oldColumn: oldCol,
        newColumn: null,
        changes: ['COLUMN_DROPPED']
      };
      columnsDiff.push(diffItem);
      alignedColumns.push({
        oldCol: oldCol,
        newCol: null,
        status: 'DROPPED',
        changes: ['COLUMN_DROPPED']
      });
    }
  }

  return { columnsDiff, alignedColumns };
}

/**
 * インデックス定義の正規化
 */
function normalizeIndexFields(idx) {
  if (!idx) return [];
  const raw = idx.fields || idx.columns || [];
  return raw.map(f => {
    if (typeof f === 'string') return cleanName(f);
    if (f && typeof f === 'object') {
      const name = f.name || f.value || f.column || f.type || '';
      return cleanName(name);
    }
    return cleanName(String(f));
  });
}

/**
 * インデックスの1対1アラインメント比較
 * @returns {Array<{ status: 'ADDED'|'DROPPED'|'MODIFIED'|'UNCHANGED', oldIdx: Object|null, newIdx: Object|null, name: string, summary: string }>}
 */
export function diffIndexesWithAlignment(oldIndexes = [], newIndexes = []) {
  const safeOld = (oldIndexes || []).filter(Boolean);
  const safeNew = (newIndexes || []).filter(Boolean);

  const getIdxKey = (idx) => {
    const name = cleanName(idx.name);
    if (name) return `name:${name}`;
    const fields = normalizeIndexFields(idx).sort().join(',');
    return `cols:${fields}`;
  };

  const oldMap = new Map();
  safeOld.forEach(idx => oldMap.set(getIdxKey(idx), idx));

  const newMap = new Map();
  safeNew.forEach(idx => newMap.set(getIdxKey(idx), idx));

  const alignedIndexes = [];

  // 1. 新インデックス巡回 (ADDED or MODIFIED or UNCHANGED)
  for (const newIdx of safeNew) {
    const key = getIdxKey(newIdx);
    const oldIdx = oldMap.get(key);
    const idxName = newIdx.name || (oldIdx?.name) || '';

    if (!oldIdx) {
      const cols = normalizeIndexFields(newIdx).join(', ');
      alignedIndexes.push({
        status: 'ADDED',
        oldIdx: null,
        newIdx: newIdx,
        name: idxName,
        summary: `${t('migration.idxAdded')}: (${cols})`
      });
    } else {
      const oldCols = normalizeIndexFields(oldIdx);
      const newCols = normalizeIndexFields(newIdx);
      const isColsSame = oldCols.join(',') === newCols.join(',');
      const isUniqueSame = Boolean(oldIdx.unique) === Boolean(newIdx.unique);
      const isPkSame = Boolean(oldIdx.pk) === Boolean(newIdx.pk);
      const isTypeSame = cleanName(oldIdx.type || 'btree') === cleanName(newIdx.type || 'btree');
      const isTablespaceSame = cleanName(oldIdx.tablespace || '') === cleanName(newIdx.tablespace || '');

      const isSame = isColsSame && isUniqueSame && isPkSame && isTypeSame && isTablespaceSame;
      const status = isSame ? 'UNCHANGED' : 'MODIFIED';
      const cols = newCols.join(', ');

      alignedIndexes.push({
        status: status,
        oldIdx: oldIdx,
        newIdx: newIdx,
        name: idxName,
        summary: isSame ? t('migration.idxUnchanged') : `${t('migration.idxModified')}: (${cols})`
      });
    }
  }

  // 2. 旧インデックスにあって新インデックスにないもの (DROPPED)
  for (const oldIdx of safeOld) {
    const key = getIdxKey(oldIdx);
    if (!newMap.has(key)) {
      const idxName = oldIdx.name || '';
      const cols = normalizeIndexFields(oldIdx).join(', ');
      alignedIndexes.push({
        status: 'DROPPED',
        oldIdx: oldIdx,
        newIdx: null,
        name: idxName,
        summary: `${t('migration.idxDropped')}: (${cols})`
      });
    }
  }

  return alignedIndexes;
}

/**
 * 外部キー (FK) の1対1アラインメント比較
 * @returns {Array<{ status: 'ADDED'|'DROPPED'|'MODIFIED'|'UNCHANGED', oldFk: Object|null, newFk: Object|null, name: string, relation: string }>}
 */
export function diffFksWithAlignment(oldFks = [], newFks = []) {
  const safeOld = (oldFks || []).filter(Boolean);
  const safeNew = (newFks || []).filter(Boolean);

  const getFkKey = (fk) => {
    const name = cleanName(fk.name);
    if (name) return `name:${name}`;
    const fromCols = (fk.fromCols || []).map(cleanName).sort().join(',');
    const toTable = cleanName(fk.toTable);
    const toCols = (fk.toCols || []).map(cleanName).sort().join(',');
    return `rel:${fromCols}->${toTable}(${toCols})`;
  };

  const formatRelation = (fk) => {
    if (!fk) return '';
    const fromTbl = fk.fromTable || '';
    const fromCols = (fk.fromCols || []).join(', ');
    const toTbl = fk.toTable || '';
    const toCols = (fk.toCols || []).join(', ');
    const op = fk.op || '>';
    return `${fromTbl}(${fromCols}) ${op} ${toTbl}(${toCols})`;
  };

  const oldMap = new Map();
  safeOld.forEach(fk => oldMap.set(getFkKey(fk), fk));

  const newMap = new Map();
  safeNew.forEach(fk => newMap.set(getFkKey(fk), fk));

  const alignedFks = [];

  // 1. 新FK巡回
  for (const newFk of safeNew) {
    const key = getFkKey(newFk);
    const oldFk = oldMap.get(key);
    const fkName = newFk.name || (oldFk?.name) || '';
    const relStr = formatRelation(newFk);

    if (!oldFk) {
      alignedFks.push({
        status: 'ADDED',
        oldFk: null,
        newFk: newFk,
        name: fkName,
        relation: relStr
      });
    } else {
      const isFromColsSame = JSON.stringify((oldFk.fromCols || []).map(cleanName)) === JSON.stringify((newFk.fromCols || []).map(cleanName));
      const isToTblSame = cleanName(oldFk.toTable) === cleanName(newFk.toTable);
      const isToColsSame = JSON.stringify((oldFk.toCols || []).map(cleanName)) === JSON.stringify((newFk.toCols || []).map(cleanName));
      const isOpSame = (oldFk.op || '>') === (newFk.op || '>');
      const isOnDelSame = cleanName(oldFk.onDelete || '') === cleanName(newFk.onDelete || '');
      const isOnUpdSame = cleanName(oldFk.onUpdate || '') === cleanName(newFk.onUpdate || '');

      const isSame = isFromColsSame && isToTblSame && isToColsSame && isOpSame && isOnDelSame && isOnUpdSame;
      alignedFks.push({
        status: isSame ? 'UNCHANGED' : 'MODIFIED',
        oldFk: oldFk,
        newFk: newFk,
        name: fkName,
        relation: relStr
      });
    }
  }

  // 2. 旧FK巡回 (DROPPED)
  for (const oldFk of safeOld) {
    const key = getFkKey(oldFk);
    if (!newMap.has(key)) {
      alignedFks.push({
        status: 'DROPPED',
        oldFk: oldFk,
        newFk: null,
        name: oldFk.name || '',
        relation: formatRelation(oldFk)
      });
    }
  }

  return alignedFks;
}

/**
 * テーブル物理属性・メタデータ（Note、論理名、表領域、カスタム属性）の1対1アラインメント比較
 * @returns {Array<{ status: 'ADDED'|'DROPPED'|'MODIFIED'|'UNCHANGED', key: string, oldVal: string, newVal: string }>}
 */
export function diffAttributesWithAlignment(oldTable, newTable) {
  const getAttrVal = (table, key) => {
    if (!table) return null;
    if (key === 'note') return table.note || table.attributes?.note || null;
    if (key === 'logicalName') return table.logicalName || table.logical_name || table.attributes?.logical_name || table.attributes?.logicalName || table.custom?.logicalName || null;
    if (key === 'tablespace') return table.tablespace || table.attributes?.tablespace || table.custom?.tablespace || null;
    if (key === 'index_tablespace') return table.indexTablespace || table.index_tablespace || table.attributes?.index_tablespace || table.attributes?.indexTablespace || table.custom?.index_tablespace || table.custom?.indexTablespace || null;
    if (table.custom && table.custom[key] !== undefined && typeof table.custom[key] !== 'object') return table.custom[key];
    if (table.attributes && table.attributes[key] !== undefined) return table.attributes[key];
    if (table[key] !== undefined && typeof table[key] !== 'object') return table[key];
    return null;
  };

  const keys = new Set();
  const extractKeys = (tbl) => {
    if (!tbl) return;
    if (tbl.note) keys.add('note');
    if (tbl.logicalName || tbl.logical_name || tbl.custom?.logicalName) keys.add('logicalName');
    if (tbl.tablespace || tbl.custom?.tablespace) keys.add('tablespace');
    if (tbl.indexTablespace || tbl.index_tablespace || tbl.custom?.index_tablespace || tbl.custom?.indexTablespace) keys.add('index_tablespace');
    if (tbl.custom && typeof tbl.custom === 'object') {
      Object.keys(tbl.custom).forEach(k => {
        if (!['name', 'columns', 'fields', 'indexes', 'fks', 'tablespace', 'index_tablespace', 'indexTablespace', 'logicalName'].includes(k)) {
          keys.add(k);
        }
      });
    }
    if (tbl.attributes && typeof tbl.attributes === 'object') {
      Object.keys(tbl.attributes).forEach(k => {
        if (!['name', 'columns', 'fields', 'indexes', 'fks', 'tablespace', 'index_tablespace', 'indextablespace', 'logicalname', 'logical_name', 'note', 'headercolor'].includes(k.toLowerCase())) {
          keys.add(k);
        }
      });
    }
  };

  extractKeys(oldTable);
  extractKeys(newTable);

  const alignedAttributes = [];

  for (const key of Array.from(keys).sort()) {
    const oldValRaw = getAttrVal(oldTable, key);
    const newValRaw = getAttrVal(newTable, key);

    const oldStr = oldValRaw !== null && oldValRaw !== undefined ? String(oldValRaw).trim() : '';
    const newStr = newValRaw !== null && newValRaw !== undefined ? String(newValRaw).trim() : '';

    if (!oldStr && !newStr) continue;

    let status = 'UNCHANGED';
    if (!oldStr && newStr) {
      status = 'ADDED';
    } else if (oldStr && !newStr) {
      status = 'DROPPED';
    } else if (oldStr !== newStr) {
      status = 'MODIFIED';
    }

    alignedAttributes.push({
      status,
      key,
      oldVal: oldStr,
      newVal: newStr
    });
  }

  return alignedAttributes;
}

/**
 * テーブルに関連付けられたすべての外部キーを収集（インラインFK + 全体Refsの統合）
 */
function collectTableFks(table, allRefs = []) {
  const tblName = cleanName(table?.name);
  const fks = [...(table?.fks || table?.foreignKeys || [])];

  (allRefs || []).forEach(ref => {
    if (cleanName(ref.fromTable) === tblName) {
      const isAlreadyAdded = fks.some(f =>
        (f.name && ref.name && cleanName(f.name) === cleanName(ref.name)) ||
        (cleanName(f.toTable) === cleanName(ref.toTable) &&
         JSON.stringify(f.fromCols) === JSON.stringify(ref.fromCols) &&
         JSON.stringify(f.toCols) === JSON.stringify(ref.toCols))
      );
      if (!isAlreadyAdded) {
        fks.push(ref);
      }
    }
  });

  return fks;
}

/**
 * 2つのDBMLテキスト（またはパース済みモデル）を比較し、差分情報を抽出
 * @param {string|Object} oldSource - 旧DBMLテキストまたはモデル
 * @param {string|Object} newSource - 新DBMLテキストまたはモデル
 * @returns {Object} 差分結果オブジェクト
 */
export function diffSchemas(oldSource, newSource) {
  const oldAst = typeof oldSource === 'string' ? parseDbmlToAst(oldSource) : (oldSource || { tables: [], refs: [] });
  const newAst = typeof newSource === 'string' ? parseDbmlToAst(newSource) : (newSource || { tables: [], refs: [] });

  const oldTablesMap = new Map();
  (oldAst.tables || []).forEach(t => {
    if (t && t.name) oldTablesMap.set(cleanName(t.name), t);
  });

  const newTablesMap = new Map();
  (newAst.tables || []).forEach(t => {
    if (t && t.name) newTablesMap.set(cleanName(t.name), t);
  });

  const tables = [];

  // 1. 新テーブル巡回 (ADD or MODIFY or UNCHANGED)
  for (const [newCleanName, newTable] of newTablesMap.entries()) {
    if (!newTable || !newTable.name) continue;
    const oldTable = oldTablesMap.get(newCleanName);

    const newFields = newTable.columns || newTable.fields || [];
    const newIdxs = newTable.indexes || [];
    const newFks = collectTableFks(newTable, newAst.refs || []);

    if (!oldTable) {
      // テーブル新規追加 (ADD)
      const { columnsDiff, alignedColumns } = diffColumnsWithAlignment([], newFields);
      const alignedIndexes = diffIndexesWithAlignment([], newIdxs);
      const alignedFks = diffFksWithAlignment([], newFks);
      const alignedAttributes = diffAttributesWithAlignment(null, newTable);

      const hasIndexChange = alignedIndexes.length > 0;
      const hasFkChange = alignedFks.length > 0;
      const hasAttrChange = alignedAttributes.length > 0;

      tables.push({
        name: newTable.name,
        status: 'ADD',
        migrationMode: 'ADD',
        hasDataMigration: false,
        hasIndexChange: hasIndexChange,
        hasFkChange: hasFkChange,
        hasAttrChange: hasAttrChange,
        hasIndexOrFkChange: hasIndexChange || hasFkChange,
        oldTable: null,
        newTable: newTable,
        columnsDiff: columnsDiff,
        alignedColumns: alignedColumns,
        alignedIndexes: alignedIndexes,
        alignedFks: alignedFks,
        alignedAttributes: alignedAttributes,
        summary: t('migration.summaryNewTable', { count: newFields.length })
      });
    } else {
      // 既存テーブル比較 (MODIFY or UNCHANGED)
      const oldFields = oldTable.columns || oldTable.fields || [];
      const oldIdxs = oldTable.indexes || [];
      const oldFks = collectTableFks(oldTable, oldAst.refs || []);

      const { columnsDiff, alignedColumns } = diffColumnsWithAlignment(oldFields, newFields);
      const alignedIndexes = diffIndexesWithAlignment(oldIdxs, newIdxs);
      const alignedFks = diffFksWithAlignment(oldFks, newFks);
      const alignedAttributes = diffAttributesWithAlignment(oldTable, newTable);

      const addedCount = columnsDiff.filter(c => c.status === 'ADDED').length;
      const droppedCount = columnsDiff.filter(c => c.status === 'DROPPED').length;
      const modifiedCount = columnsDiff.filter(c => c.status === 'MODIFIED').length;
      const hasColumnChanges = addedCount > 0 || droppedCount > 0 || modifiedCount > 0;

      const hasIndexChange = alignedIndexes.some(idx => idx.status !== 'UNCHANGED');
      const hasFkChange = alignedFks.some(fk => fk.status !== 'UNCHANGED');
      const hasAttrChange = alignedAttributes.some(attr => attr.status !== 'UNCHANGED');
      const hasIndexOrFkChange = hasIndexChange || hasFkChange;

      const hasSizeReduced = columnsDiff.some(c => c.changes.includes('SIZE_REDUCED') || c.changes.includes('TYPE_CHANGED'));
      const hasNotNullAdded = columnsDiff.some(c => c.changes.includes('NOT_NULL_ADDED'));

      let status = 'UNCHANGED';
      let migrationMode = 'UNCHANGED';

      if (hasColumnChanges) {
        status = 'MODIFY';
        // 破壊的変更（カラム追加、サイズ縮小、型変更、NOT NULL付与）は RECREATE_TABLE (5分割マイグレーション)
        if (addedCount > 0 || hasSizeReduced || hasNotNullAdded) {
          migrationMode = 'RECREATE_TABLE';
        } else {
          migrationMode = 'ALTER_INPLACE';
        }
      } else if (hasIndexChange) {
        status = 'MODIFY';
        migrationMode = 'INDEX_ONLY';
      } else if (hasFkChange) {
        status = 'MODIFY';
        migrationMode = 'FK_ONLY';
      } else if (hasAttrChange) {
        status = 'MODIFY';
        migrationMode = 'ATTR_ONLY';
      }

      // サマリー文字列の多言語構築
      const summaryParts = [];
      if (addedCount > 0) summaryParts.push(t('migration.summaryColAdded', { count: addedCount }));
      if (droppedCount > 0) summaryParts.push(t('migration.summaryColDropped', { count: droppedCount }));
      if (modifiedCount > 0) summaryParts.push(t('migration.summaryColModified', { count: modifiedCount }));
      if (hasIndexChange) summaryParts.push(t('migration.summaryIndexChanged'));
      if (hasFkChange) summaryParts.push(t('migration.summaryFkChanged'));
      if (hasAttrChange) summaryParts.push(t('migration.summaryAttrChanged'));
      const summary = summaryParts.length > 0 ? summaryParts.join(', ') : t('migration.summaryNoDiff');

      tables.push({
        name: newTable.name,
        status: status,
        migrationMode: migrationMode,
        hasDataMigration: migrationMode === 'RECREATE_TABLE',
        hasIndexChange: hasIndexChange,
        hasFkChange: hasFkChange,
        hasAttrChange: hasAttrChange,
        hasIndexOrFkChange: hasIndexOrFkChange,
        oldTable: oldTable,
        newTable: newTable,
        columnsDiff: columnsDiff,
        alignedColumns: alignedColumns,
        alignedIndexes: alignedIndexes,
        alignedFks: alignedFks,
        alignedAttributes: alignedAttributes,
        summary: summary
      });
    }
  }

  // 2. 旧にあって新にないテーブル ➔ 削除 (DROP)
  for (const [oldCleanName, oldTable] of oldTablesMap.entries()) {
    if (!oldTable || !oldTable.name) continue;
    if (!newTablesMap.has(oldCleanName)) {
      const oldFields = oldTable.columns || oldTable.fields || [];
      const oldIdxs = oldTable.indexes || [];
      const oldFks = collectTableFks(oldTable, oldAst.refs || []);

      const { columnsDiff, alignedColumns } = diffColumnsWithAlignment(oldFields, []);
      const alignedIndexes = diffIndexesWithAlignment(oldIdxs, []);
      const alignedFks = diffFksWithAlignment(oldFks, []);
      const alignedAttributes = diffAttributesWithAlignment(oldTable, null);

      const hasIndexChange = alignedIndexes.length > 0;
      const hasFkChange = alignedFks.length > 0;
      const hasAttrChange = alignedAttributes.length > 0;

      tables.push({
        name: oldTable.name,
        status: 'DROP',
        migrationMode: 'DROP',
        hasDataMigration: false,
        hasIndexChange: hasIndexChange,
        hasFkChange: hasFkChange,
        hasAttrChange: hasAttrChange,
        hasIndexOrFkChange: hasIndexChange || hasFkChange,
        oldTable: oldTable,
        newTable: null,
        columnsDiff: columnsDiff,
        alignedColumns: alignedColumns,
        alignedIndexes: alignedIndexes,
        alignedFks: alignedFks,
        alignedAttributes: alignedAttributes,
        summary: t('migration.summaryDropTable', { count: oldFields.length })
      });
    }
  }

  return {
    oldAst,
    newAst,
    tables
  };
}
