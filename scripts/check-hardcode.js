// 日本語コメント: テーマ・多言語化（i18n）ハードコード静的チェックツール
// 使用方法: npm --prefix dbml-editor-v2 run check:hardcode [-- --strict]
// 1. CSS/JS 内のテーマ名・data-theme ハードコード検出 (Error)
// 2. locales/ja.js と locales/en.js の辞書キー不整合検出 (Error)
// 3. t('...') で参照されている未定義キーの検出 (Error)
// 4. UI コンポーネント内の日本語直書き候補の検出 (Warning)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ja from '../client/src/locales/ja.js';
import en from '../client/src/locales/en.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const CLIENT_SRC_DIR = path.join(ROOT_DIR, 'client', 'src');
const STRICT_MODE = process.argv.includes('--strict');

/**
 * 指定ディレクトリ配下の対象拡張子ファイルを再帰収集する
 */
function collectFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, extensions));
    } else if (extensions.some(ext => entry.name.endsWith(ext))) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * プロジェクト相対パス（スラッシュ区切り）を返す
 */
function toRelPath(filePath) {
  return path.relative(ROOT_DIR, filePath).replace(/\\/g, '/');
}

/**
 * ネストされた辞書オブジェクトをドット区切りキーの Set に展開する
 */
function flattenKeys(obj, prefix = '', out = new Set()) {
  if (!obj || typeof obj !== 'object') return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      flattenKeys(v, key, out);
    } else {
      out.add(key);
    }
  }
  return out;
}

/**
 * 1行コメント・ブロックコメント行かどうかの簡易判定
 */
function isCommentLine(trimmed) {
  return trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*');
}

/**
 * テーマのハードコードチェック（CSS / JS）
 */
function checkThemeHardcoding(errors) {
  const cssFiles = collectFiles(CLIENT_SRC_DIR, ['.css']);
  const themeCssAllowList = new Set(['client/src/styles/tokens.css']);

  for (const file of cssFiles) {
    const rel = toRelPath(file);
    if (themeCssAllowList.has(rel)) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (isCommentLine(trimmed)) return;
      if (/\[data-theme\s*=/.test(line)) {
        errors.push(`[Theme CSS] ${rel}:${idx + 1} - テーマ固有セレクタ [data-theme=...] がハードコードされています: ${trimmed}`);
      }
    });
  }

  const jsFiles = collectFiles(CLIENT_SRC_DIR, ['.js']);
  const themeJsAllowList = new Set([
    'client/src/core/theme.js',
    'client/src/core/config-service.js',
  ]);

  for (const file of jsFiles) {
    const rel = toRelPath(file);
    if (themeJsAllowList.has(rel) || rel.startsWith('client/src/locales/')) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (isCommentLine(trimmed)) return;
      if (/(getAttribute|setAttribute)\(\s*['"]data-theme['"]|\bdataset\.theme\b/.test(line)) {
        errors.push(`[Theme JS] ${rel}:${idx + 1} - data-theme への直接参照/操作があります: ${trimmed}`);
      }
    });
  }
}

/**
 * 多言語化（i18n）の辞書整合性・未定義キー・直書き候補チェック
 */
function checkI18n(errors, warnings) {
  const jaKeys = flattenKeys(ja);
  const enKeys = flattenKeys(en);

  for (const k of jaKeys) {
    if (!enKeys.has(k)) {
      errors.push(`[i18n Dict] en.js にキー "${k}" が不足しています`);
    }
  }
  for (const k of enKeys) {
    if (!jaKeys.has(k)) {
      errors.push(`[i18n Dict] ja.js にキー "${k}" が不足しています`);
    }
  }

  const jsFiles = collectFiles(CLIENT_SRC_DIR, ['.js']);
  const tCallRegex = /\bt\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;
  const jaCharRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;

  for (const file of jsFiles) {
    const rel = toRelPath(file);
    if (rel.startsWith('client/src/locales/')) continue;

    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const isComponent = rel.startsWith('client/src/components/');

    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (isCommentLine(trimmed)) return;

      // コメント除去（行末の // コメント）
      const codePart = line.replace(/\/\/.*$/, '');

      // t('key') の未定義キー検査
      let match;
      tCallRegex.lastIndex = 0;
      while ((match = tCallRegex.exec(codePart)) !== null) {
        const key = match[1];
        if (key.startsWith('plugins.')) continue; // プラグイン動的登録キーは対象外
        if (!jaKeys.has(key) && !enKeys.has(key)) {
          errors.push(`[i18n Key] ${rel}:${idx + 1} - 未定義の翻訳キー "${key}" が使用されています`);
        }
      }

      // コンポーネント内の日本語文字列リテラル直書き候補 (Warning)
      if (isComponent && !/\b(console|logger)\.(log|warn|error|info|debug)\b/.test(codePart)) {
        if (jaCharRegex.test(codePart) && /['"`]/.test(codePart)) {
          warnings.push(`[i18n Literal?] ${rel}:${idx + 1} - ${trimmed}`);
        }
      }
    });
  }
}

function main() {
  const errors = [];
  const warnings = [];

  checkThemeHardcoding(errors);
  checkI18n(errors, warnings);

  console.log('=== DBML Editor v2 ハードコードチェック ===');
  console.log(`Errors: ${errors.length}, Warnings: ${warnings.length}\n`);

  if (errors.length > 0) {
    console.log('--- Errors (要修正) ---');
    errors.forEach(e => console.log(`  ✖ ${e}`));
    console.log('');
  }

  if (warnings.length > 0) {
    const maxDisplay = 50;
    console.log(`--- Warnings (日本語直書き候補: 全${warnings.length}件${warnings.length > maxDisplay ? ` / 先頭${maxDisplay}件を表示` : ''}) ---`);
    warnings.slice(0, maxDisplay).forEach(w => console.log(`  ⚠ ${w}`));
    console.log('');
  }

  if (errors.length === 0 && warnings.length === 0) {
    console.log('✔ 問題は検出されませんでした。');
  }

  if (errors.length > 0 || (STRICT_MODE && warnings.length > 0)) {
    process.exitCode = 1;
  }
}

main();
