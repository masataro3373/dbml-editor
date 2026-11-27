// 日本語コメント: DBML 構文解析 API ルーター (server/routes/parse.js)
// @dbml/core (v13.0.0) dbmlv2 パーサーを用いてDBMLテキストを構文解析し、
// クライアントUI描画用に最適化したテーブル・フィールド・インデックス・Projectモデルを返却します。

import express from 'express';
import { Parser, importer } from '@dbml/core';
import { serverLogger } from '../logger.js';

const router = express.Router();

/**
 * Note オブジェクトまたは文字列から安全に文字列を抽出
 */
function extractNoteString(note) {
  if (!note) return '';
  if (typeof note === 'object' && note !== null) {
    return note.value || '';
  }
  return String(note);
}

/**
 * dbdefault オブジェクトまたは値から安全にデフォルト文字列を抽出
 * (0 や false、空文字が falsy 判定で [object Object] に化けないよう厳格判定)
 */
function extractDefaultValue(dbdefault) {
  if (dbdefault === null || dbdefault === undefined) return null;
  if (typeof dbdefault === 'object') {
    if (dbdefault.value !== undefined && dbdefault.value !== null) {
      return String(dbdefault.value);
    }
    return null;
  }
  return String(dbdefault);
}

/**
 * Note文字列から <!-- custom {...} --> JSONを抽出
 */
function extractCustomMetadata(noteString) {
  if (!noteString) return { cleanNote: '', custom: {} };

  // パターン1: <!-- custom {...} --> (コメントタグ内にJSONが内包されている形式)
  const match1 = noteString.match(/<!--\s*custom\s+([\s\S]*?)\s*-->/);
  if (match1) {
    try {
      const custom = JSON.parse(match1[1]);
      const cleanNote = noteString.replace(match1[0], '').trim();
      return { cleanNote, custom };
    } catch (_) {}
  }

  // パターン2: <!-- custom -->\n{...} (マーカー直後にJSONが配置されている形式)
  const match2 = noteString.match(/<!--\s*custom\s*-->\s*(\{[\s\S]*\})/);
  if (match2) {
    try {
      const custom = JSON.parse(match2[1]);
      const cleanNote = noteString.replace(/<!--\s*custom\s*-->[\s\S]*/, '').trim();
      return { cleanNote, custom };
    } catch (_) {}
  }

  return { cleanNote: noteString, custom: {} };
}

/**
 * DBMLテキストから直接 Project ブロックを抽出するフォールバック処理
 */
function extractProjectFromText(dbmlText) {
  if (!dbmlText) return null;
  const headerMatch = dbmlText.match(/Project\s+(?:"([^"]+)"|'([^']+)'|([^{\s]+))?\s*\{/i);
  if (!headerMatch) return null;

  const name = headerMatch[1] || headerMatch[2] || headerMatch[3] || '';
  const bodyStart = headerMatch.index + headerMatch[0].length;

  // 中括弧のネスト深さ (depth) を走査して Project の終了 '}' を正確に特定
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

  if (bodyEnd === -1) return null;
  const body = dbmlText.substring(bodyStart, bodyEnd);

  const dbTypeMatch = body.match(/database_type:\s*['"]([^'"]+)['"]/i);
  // トリプルクォート (''')、シングルクォート、ダブルクォートのブロック Note に完全対応
  const noteMatch = body.match(/Note:\s*(?:'''([\s\S]*?)'''|'([^']*)'|"([^"]*)")/i);

  const rawNote = noteMatch ? (noteMatch[1] !== undefined ? noteMatch[1] : (noteMatch[2] !== undefined ? noteMatch[2] : (noteMatch[3] || ''))) : '';
  const { cleanNote, custom } = extractCustomMetadata(rawNote);

  return {
    name,
    databaseType: dbTypeMatch ? dbTypeMatch[1] : '',
    note: cleanNote,
    custom,
  };
}

/**
 * DBMLテキストから直接テーブルおよびカラムの logicalName を抽出するフォールバック処理
 * 中括弧のネスト深さ (depth) を走査することで、Indexes や Note などの内部ブロックがあっても
 * 100% 正確に各テーブルブロックとそのカラム行を特定します。
 */
function extractLogicalNamesFromText(dbmlText) {
  const tableLogicalNames = {};  // tableNameUpper -> logicalName
  const columnLogicalNames = {}; // `${tableNameUpper}.${colNameUpper}` -> logicalName

  if (!dbmlText) return { tableLogicalNames, columnLogicalNames };

  const tableHeaderRegex = /^\s*Table\s+(?:(?:"([^"]+)"|([^\s.,;(){}\[\]]+))\.)?(?:"([^"]+)"|([^\s.,;(){}\[\]]+))(?:\s+as\s+[^\s\[]+)?(?:\s*\[([^\]]*)\])?\s*\{/gim;
  let match;

  while ((match = tableHeaderRegex.exec(dbmlText)) !== null) {
    const rawTable = match[3] || match[4] || match[1] || match[2] || '';
    const tblSettings = match[5] || '';
    const tblName = rawTable.replace(/^["']|["']$/g, '').trim().toUpperCase();
    if (!tblName) continue;

    // テーブルの logicalName 抽出
    if (tblSettings) {
      const logicalMatch = tblSettings.match(/logicalName\s*:\s*(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/i);
      if (logicalMatch) {
        const val = logicalMatch[1] !== undefined ? logicalMatch[1] : logicalMatch[2];
        tableLogicalNames[tblName] = val.replace(/\\'/g, "'").replace(/''/g, "'").replace(/\\"/g, '"').trim();
      }
    }

    // 中括弧のネスト深さを走査して対応するテーブル終了 '}' を特定
    const bodyStart = match.index + match[0].length;
    let depth = 1;
    let bodyEnd = -1;
    for (let i = bodyStart; i < dbmlText.length; i++) {
      const char = dbmlText[i];
      if (char === '{') depth++;
      else if (char === '}') {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }

    if (bodyEnd === -1) continue;

    const body = dbmlText.substring(bodyStart, bodyEnd);
    const lines = body.split(/\r?\n/);
    let inSubBlock = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\s*(indexes|checks)\s*\{/i.test(line)) {
        inSubBlock = true;
        continue;
      }
      if (inSubBlock) {
        if (trimmed === '}') inSubBlock = false;
        continue;
      }
      if (trimmed.startsWith('//') || trimmed.startsWith('Note:') || trimmed === '') continue;

      // カラム行の logicalName 抽出
      const colMatch = line.match(/^\s*(?:"([^"]+)"|([^\s\[\]{}]+))\s+[^\[\n]+?\s*\[([^\]]*)\]/);
      if (colMatch) {
        const colName = (colMatch[1] || colMatch[2]).replace(/^["']|["']$/g, '').trim().toUpperCase();
        const colSettings = colMatch[3] || '';
        const colLogicalMatch = colSettings.match(/logicalName\s*:\s*(?:'((?:''|\\'|[^'])*)'|"((?:""|\\"|[^"])*)")/i);
        if (colLogicalMatch && colName) {
          const val = colLogicalMatch[1] !== undefined ? colLogicalMatch[1] : colLogicalMatch[2];
          columnLogicalNames[`${tblName}.${colName}`] = val.replace(/\\'/g, "'").replace(/''/g, "'").replace(/\\"/g, '"').trim();
        }
      }
    }
  }

  return { tableLogicalNames, columnLogicalNames };
}

/**
 * @dbml/core (v13.0.0) の Metadata ブロック (tbl.metadata / f.metadata) から
 * キーバリューオブジェクトを抽出し、適切なプリミティブ型 (boolean / number / string) に復元
 */
function extractAstMetadata(metadataObj) {
  if (!metadataObj || typeof metadataObj !== 'object') return {};
  const result = {};
  for (const [key, entry] of Object.entries(metadataObj)) {
    if (entry === null || entry === undefined) continue;
    const rawVal = (typeof entry === 'object' && 'value' in entry) ? entry.value : entry;
    const valType = (typeof entry === 'object' && entry.type) ? entry.type : typeof rawVal;
    if (valType === 'boolean' || valType === 'bool' || rawVal === true || rawVal === false || rawVal === 'true' || rawVal === 'false') {
      result[key] = rawVal === true || rawVal === 'true';
    } else if ((valType === 'number' || valType === 'int' || valType === 'float') && rawVal !== '' && !Number.isNaN(Number(rawVal))) {
      result[key] = Number(rawVal);
    } else if (rawVal !== undefined && rawVal !== null) {
      result[key] = String(rawVal);
    }
  }
  return result;
}

/**
 * カンマ区切りの表領域文字列または配列をクリーンな文字列配列へ正規化
 */
function parseTablespaceList(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map(v => String(v).trim()).filter(Boolean);
  }
  return String(val)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Parser.parseDBMLToJSONv2(dbml).project から直接記述されたカスタム属性（案B）を抽出
 */
function extractProjectCustomFromRaw(rawProject) {
  if (!rawProject || typeof rawProject !== 'object') return {};
  const reservedKeys = new Set([
    'name', 'database_type', 'databaseType', 'note',
    'tables', 'refs', 'enums', 'tableGroups', 'tablePartials', 'token',
  ]);
  const custom = {};

  for (const [key, rawVal] of Object.entries(rawProject)) {
    if (reservedKeys.has(key) || rawVal === undefined || rawVal === null) continue;
    const val = (typeof rawVal === 'object' && 'value' in rawVal) ? rawVal.value : rawVal;

    if (key === 'data_tablespaces' || key === 'dataTablespaces') {
      custom.dataTablespaces = parseTablespaceList(val);
    } else if (key === 'index_tablespaces' || key === 'indexTablespaces') {
      custom.indexTablespaces = parseTablespaceList(val);
    } else if (key === 'lob_tablespaces' || key === 'lobTablespaces') {
      custom.lobTablespaces = parseTablespaceList(val);
    } else if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      custom[key] = val;
    }
  }

  return custom;
}

/**
 * POST /api/parse
 * DBMLテキストの構文解析
 */
router.post('/', (req, res) => {
  const { dbml } = req.body || {};

  if (typeof dbml !== 'string') {
    return res.status(400).json({ error: 'dbml text is required' });
  }

  // 空の場合は空モデルを即時返却
  if (dbml.trim() === '') {
    return res.json({
      project: null,
      tables: [],
      tableGroups: [],
      notes: [],
      refs: [],
      parseTimeMs: 0,
    });
  }

  const startTime = Date.now();

  try {
    // @dbml/core v13.0.0 (parseDBMLToJSONv2 + parseJSONToDatabase) で1パス構文解析
    // インラインの [logicalName: '...'] も標準カスタムプロパティとしてそのままパースする
    const rawDb = Parser.parseDBMLToJSONv2(dbml);
    const database = Parser.parseJSONToDatabase(rawDb);
    const parseTimeMs = Date.now() - startTime;

    // Project ブロックの特定 (Raw AST / Database AST / テキストフォールバック)
    const textProject = extractProjectFromText(dbml);
    const rawProject = rawDb.project || null;
    const astProject = database.project || (database.schemas?.[0]?.project) || rawProject;
    let project = null;

    if (textProject || astProject || rawProject) {
      const rawNote = astProject?.note
        ? extractNoteString(astProject.note)
        : (rawProject?.note ? extractNoteString(rawProject.note) : (textProject?.note || ''));
      const { cleanNote, custom: noteCustom } = extractCustomMetadata(rawNote);
      const rawProjectCustom = extractProjectCustomFromRaw(rawProject);

      project = {
        name: astProject?.name || rawProject?.name || textProject?.name || '',
        databaseType: astProject?.database_type || astProject?.databaseType || rawProject?.database_type || textProject?.databaseType || '',
        note: cleanNote,
        custom: {
          ...(textProject?.custom || {}),
          ...noteCustom,
          ...rawProjectCustom,
        },
      };
    }

    // 旧形式DBMLテキストからの論理名抽出フォールバック
    const { tableLogicalNames, columnLogicalNames } = extractLogicalNamesFromText(dbml);

    // テーブル一覧の整形
    const tables = (database.schemas || []).flatMap(schema =>
      (schema.tables || []).map(tbl => {
        const tblNameUpper = String(tbl.name || '').toUpperCase();
        const rawNote = extractNoteString(tbl.note);
        const { cleanNote, custom: noteCustom } = extractCustomMetadata(rawNote);
        const metaCustom = extractAstMetadata(tbl.metadata);
        const mergedCustom = { ...noteCustom, ...metaCustom };

        const rawTblLogicalName = mergedCustom.logicalName || mergedCustom.logicalname || tbl.logicalName || tableLogicalNames[tblNameUpper] || '';
        const tblLogicalName = String(rawTblLogicalName).replace(/[\r\n]+/g, '').trim();
        delete mergedCustom.logicalName;
        delete mergedCustom.logicalname;

        // インデックスとPKの抽出 (重複排除付き)
        const pkColSet = new Set();
        const rawIndexes = (tbl.indexes || []).map(idx => {
          const idxNote = extractNoteString(idx.note);
          const { cleanNote: cleanIdxNote, custom: idxCustom } = extractCustomMetadata(idxNote);

          const cols = (idx.columns || []).map(c => {
            const colName = typeof c === 'object' && c !== null ? c.value : c;
            if (idx.pk && colName) pkColSet.add(String(colName).toUpperCase());
            return {
              value: colName,
              type: c.type || 'column',
            };
          });

          return {
            name: idx.name || '',
            unique: Boolean(idx.unique),
            pk: Boolean(idx.pk),
            columns: cols,
            note: cleanIdxNote,
            custom: idxCustom,
          };
        });

        // 重複インデックスの自動クリーンアップ (命名付きPKを最優先)
        const indexes = [];
        const seenSignatures = new Set();
        const seenPkNames = new Set();
        const seenPkColSigs = new Set();

        // 1. まず名前付きPKインデックスを優先登録
        rawIndexes.filter(idx => idx.pk && idx.name).forEach(idx => {
          const colSig = idx.columns.map(c => String(c.value || c).toUpperCase()).join(',');
          const colSortSig = idx.columns.map(c => String(c.value || c).toUpperCase()).sort().join(',');
          const sig = `PK:${colSortSig}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            seenPkNames.add(idx.name.trim().toUpperCase());
            if (colSig) seenPkColSigs.add(colSig);
            if (colSortSig) seenPkColSigs.add(colSortSig);
            indexes.push(idx);
          }
        });

        // 2. その他のインデックス（名前なしPK、Unique、通常Index）を追加
        rawIndexes.forEach(idx => {
          const colSig = idx.columns.map(c => String(c.value || c).toUpperCase()).join(',');
          const colSortSig = idx.columns.map(c => String(c.value || c).toUpperCase()).sort().join(',');

          // PKの場合、既にPKが登録済みなら重複としてスキップ
          if (idx.pk) {
            const pkSig = `PK:${colSortSig}`;
            if (seenSignatures.has(pkSig)) return;
            seenSignatures.add(pkSig);
            if (idx.name) seenPkNames.add(idx.name.trim().toUpperCase());
            if (colSig) seenPkColSigs.add(colSig);
            if (colSortSig) seenPkColSigs.add(colSortSig);
            indexes.push(idx);
            return;
          }

          // 日本語コメント: PKと同名のインデックス、またはPKと同一カラム構成のUniqueインデックスは重複としてスキップ
          const idxNameUpper = (idx.name || '').trim().toUpperCase();
          if (
            (idxNameUpper && seenPkNames.has(idxNameUpper)) ||
            (idx.unique && (seenPkColSigs.has(colSig) || seenPkColSigs.has(colSortSig)))
          ) {
            return;
          }

          // 通常IndexまたはUnique
          const sig = `${idx.unique ? 'UQ' : 'IDX'}:${colSig}:${idxNameUpper}`;
          if (!seenSignatures.has(sig)) {
            seenSignatures.add(sig);
            indexes.push(idx);
          }
        });

        // フィールド一覧
        const fields = (tbl.fields || []).map(f => {
          const colNameUpper = String(f.name || '').toUpperCase();
          const colKey = `${tblNameUpper}.${colNameUpper}`;
          const colRawNote = extractNoteString(f.note);
          const { cleanNote: colCleanNote, custom: colNoteCustom } = extractCustomMetadata(colRawNote);
          const colMetaCustom = extractAstMetadata(f.metadata);
          const mergedColCustom = { ...colNoteCustom, ...colMetaCustom };

          // 日本語コメント: @dbml/parse の Metadata 小文字キー (columnnote / attributenote) および旧形式 attributeNote を columnNote へ正規化
          const fallbackColumnNote = mergedColCustom.columnNote || mergedColCustom.columnnote || mergedColCustom.attributeNote || mergedColCustom.attributenote;
          if (fallbackColumnNote !== undefined) {
            mergedColCustom.columnNote = fallbackColumnNote;
          }
          delete mergedColCustom.columnnote;
          delete mergedColCustom.attributeNote;
          delete mergedColCustom.attributenote;

          const isPk = Boolean(f.pk) || pkColSet.has(colNameUpper);
          const rawColLogicalName = mergedColCustom.logicalName || mergedColCustom.logicalname || f.logicalName || columnLogicalNames[colKey] || '';
          const colLogicalName = String(rawColLogicalName).replace(/[\r\n]+/g, '').trim();
          delete mergedColCustom.logicalName;
          delete mergedColCustom.logicalname;

          // 日本語コメント: データ型・桁数・精度のスマート分解
          const rawTypeName = f.type?.type_name || String(f.type || '');
          const rawArgs = f.type?.args !== undefined && f.type?.args !== null ? String(f.type.args) : '';
          const baseType = rawTypeName.replace(/\(.*?\)/, '').trim();
          let length = '';
          let scale = '';
          if (rawArgs) {
            const parts = rawArgs.split(',').map(s => s.trim());
            length = parts[0] || '';
            scale = parts[1] || '';
          } else {
            // rawArgs が無くても rawTypeName にカッコがある場合のフォールバック (例: "VARCHAR2(50)")
            const parenMatch = rawTypeName.match(/\(([^)]+)\)/);
            if (parenMatch) {
              const parts = parenMatch[1].split(',').map(s => s.trim());
              length = parts[0] || '';
              scale = parts[1] || '';
            }
          }

          return {
            name: f.name,
            logicalName: colLogicalName,
            type: rawTypeName,
            baseType: baseType || rawTypeName,
            length: length,
            scale: scale,
            pk: isPk,
            // 日本語コメント: 主キーカラムは常に not_null: true として統一
            not_null: Boolean(f.not_null) || isPk,
            unique: Boolean(f.unique),
            increment: Boolean(f.increment),
            dbdefault: extractDefaultValue(f.dbdefault),
            note: colCleanNote || '',
            custom: mergedColCustom,
          };
        });

        // 日本語コメント: Check制約一覧の抽出 (@dbml/core v11 準拠)
        const checks = (tbl.checks || []).map(c => ({
          name: c.name || '',
          expression: c.expression || '',
        }));

        return {
          name: tbl.name,
          logicalName: tblLogicalName,
          alias: tbl.alias || null,
          headerColor: tbl.headerColor || tbl.headercolor || null,
          note: cleanNote || '',
          custom: mergedCustom,
          fields,
          indexes,
          checks,
        };
      })
    );

    // リレーション (Refs)
    const refs = (database.schemas || []).flatMap(schema =>
      (schema.refs || []).map(ref => ({
        name: ref.name || '',
        endpoints: (ref.endpoints || []).map(ep => ({
          tableName: ep.tableName,
          fieldNames: ep.fieldNames || [],
          relation: ep.relation,
        })),
        onDelete: ref.onDelete || null,
        onUpdate: ref.onUpdate || null,
      }))
    );

    // テーブルグループ (TableGroups)
    const rawGroups = (database.tableGroups && database.tableGroups.length > 0)
      ? database.tableGroups
      : (database.schemas || []).flatMap(schema => schema.tableGroups || []);

    const tableGroups = rawGroups.map(g => ({
      name: g.name,
      tables: (g.tables || []).map(t => {
        if (typeof t === 'object' && t !== null) {
          return t.name || t.tableName || '';
        }
        return String(t);
      }).filter(Boolean),
      note: g.note ? extractNoteString(g.note) : '',
    }));

    // 独立したノート (Notes)
    const rawNotes = (database.notes && database.notes.length > 0)
      ? database.notes
      : (database.schemas || []).flatMap(schema => schema.notes || []);

    const notes = rawNotes.map(n => ({
      name: n.name || '',
      value: n.content || (typeof n.value === 'object' && n.value !== null ? (n.value.value || '') : (n.value || '')),
    }));

    serverLogger.info('Parse', `パース成功: テーブル数=${tables.length}, グループ数=${tableGroups.length}, ノート数=${notes.length}, 処理時間=${parseTimeMs}ms`);

    res.json({
      project,
      tables,
      tableGroups,
      notes,
      refs,
      parseTimeMs,
    });
  } catch (err) {
    serverLogger.error('Parse', 'パース失敗', err);
    res.status(422).json({
      error: err.message,
      diags: err.diags || null,
    });
  }
});

/**
 * POST /api/parse/import
 * 生SQL (DDL) を @dbml/core を用いて標準 DBML テキストに変換
 */
router.post('/import', (req, res) => {
  const { sql, format = 'oracle' } = req.body || {};
  if (!sql || typeof sql !== 'string') {
    return res.status(400).json({ error: 'SQLテキストが指定されていません' });
  }

  try {
    const dbml = importer.import(sql, format);
    serverLogger.info('Parse', `SQLインポート成功 (format: ${format}, 長さ: ${sql.length})`);
    res.json({ success: true, dbml });
  } catch (err) {
    serverLogger.error('Parse', 'SQLインポート変換失敗', err);
    res.status(422).json({
      error: err.message || 'SQLのDBML変換に失敗しました',
      diags: err.diags || null,
    });
  }
});

export default router;
