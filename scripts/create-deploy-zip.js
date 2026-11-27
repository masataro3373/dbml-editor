// 日本語コメント: デプロイ用ZIPアーカイブ作成＆検証スクリプト (scripts/create-deploy-zip.js)
// 外部ライブラリおよびOSコマンド (tar等) への依存を排除し、
// Node.js 標準モジュールのみで安全かつ最小構成の dbml-editor-[version].zip を生成します。
// 再作成可能なファイル (node_modules, dist, logs, storage等) や開発用ファイル (scripts, *.md)、
// および別ビルド対象であるプラグインZIP (plugins/*.zip) を除外し、DEFLATE圧縮＋インメモリ自己検証を行います。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';
import { PureZipReader } from '../server/services/plugins-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクトルート (dbml-editor-v2)、親ディレクトリ、およびZIP内ルートフォルダ名 (dbml-editor) の設定
const projectRoot = path.resolve(__dirname, '..');
const parentDir = path.resolve(projectRoot, '..');
const projectName = 'dbml-editor';

// package.json からバージョン番号を取得
const packageJsonPath = path.join(projectRoot, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '2.0.0';

// 出力する ZIP ファイル名と出力先パスの決定
const zipFileName = `dbml-editor-${version}.zip`;
const outputZipPath = path.join(parentDir, zipFileName);

console.log('========================================');
console.log('📦 DBML Editor デプロイ用ZIP作成開始 (最小構成・DEFLATE圧縮)');
console.log(`バージョン: ${version}`);
console.log(`出力ファイル名: ${zipFileName}`);
console.log(`出力先ディレクトリ: ${parentDir}`);
console.log('========================================\n');

/**
 * 日本語コメント: CRC-32 参照テーブルの事前生成 (多項式: 0xEDB88320)
 */
function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = createCrc32Table();

/**
 * 日本語コメント: バッファの CRC-32 チェックサムを高速計算
 */
function calculateCrc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// 除外対象ディレクトリ名（再作成可能・実行時生成・開発専用）
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  '.git',
  '.vscode',
  'logs',
  'storage',
  'dist',
]);

// プロジェクトルート直下のみ除外するディレクトリ名（server/scripts 等は残す）
const EXCLUDED_ROOT_DIR_NAMES = new Set([
  'scripts',
  'tests',
  'samples',
]);

// ルート直下でデプロイパッケージに同梱する Markdown ドキュメント一覧（小文字で比較）
const ALLOWED_ROOT_MD_FILES = new Set([
  'readme.md',
  'deploy_guide.md',
  'server_admin_guide.md',
  'license.md',
  'third_party_licenses.md',
  'third_party_license.md',
]);

/**
 * 日本語コメント: ファイル除外判定（必要最低限のファイルのみ残す）
 */
function shouldExcludeFile(fileName, relativePath) {
  const normalizedRel = relativePath.replace(/\\/g, '/');

  // 環境変数・ログ・既存アーカイブ・OS一時ファイル
  if (fileName.startsWith('.env')) return true;
  if (fileName.endsWith('.log')) return true;
  if (fileName.startsWith('dbml-editor-') && fileName.endsWith('.zip')) return true;
  if (fileName === '.DS_Store' || fileName === 'Thumbs.db') return true;

  // ルート直下の *.md は ALLOWED_ROOT_MD_FILES に含まれる運用・ライセンス文書のみ同梱し、それ以外は除外
  if (!normalizedRel.includes('/') && fileName.toLowerCase().endsWith('.md')) {
    return !ALLOWED_ROOT_MD_FILES.has(fileName.toLowerCase());
  }

  // plugins/ 配下は .gitkeep のみ残し、プラグインZIPや無効化ファイルは除外（プラグインは別ビルド）
  if (normalizedRel.startsWith('plugins/') && fileName !== '.gitkeep') {
    return true;
  }

  return false;
}

/**
 * 日本語コメント: プロジェクト配下のファイルを再帰走査して収集
 */
function collectDeployFiles(dir, base = '') {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const relativePath = base ? `${base}/${entry.name}` : entry.name;
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name) || (base === '' && EXCLUDED_ROOT_DIR_NAMES.has(entry.name))) {
        continue;
      }
      results.push(...collectDeployFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      if (shouldExcludeFile(entry.name, relativePath)) {
        continue;
      }
      results.push({
        // ZIP内のパスは "dbml-editor/..." とする
        zipEntryPath: `${projectName}/${relativePath}`.replace(/\\/g, '/'),
        relativePath,
        fullPath,
      });
    }
  }

  return results;
}

/**
 * 日本語コメント: DEFLATE (Method 8) 圧縮 ZIP アーカイブ Buffer を生成
 * 圧縮後のサイズが元サイズ以上の場合は自動的に STORE (Method 0) を選択する
 */
function buildCompressedZip(files) {
  const localHeaderChunks = [];
  const centralDirectoryChunks = [];

  let currentOffset = 0;
  const cdEntries = [];

  // 1. 各ファイルの Local File Header および データ本体を構築
  for (const file of files) {
    const nameBuffer = Buffer.from(file.zipEntryPath, 'utf-8');
    const rawBuffer = file.data;
    const crc = calculateCrc32(rawBuffer);
    const uncompressedSize = rawBuffer.length;

    const deflatedBuffer = zlib.deflateRawSync(rawBuffer, { level: 6 });
    const useDeflate = deflatedBuffer.length < rawBuffer.length;
    const method = useDeflate ? 8 : 0;
    const payloadBuffer = useDeflate ? deflatedBuffer : rawBuffer;
    const compressedSize = payloadBuffer.length;

    const localHeaderOffset = currentOffset;

    // Local File Header 固定部 30 バイト
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);          // Local file header signature
    localHeader.writeUInt16LE(20, 4);                  // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6);                   // General purpose bit flag
    localHeader.writeUInt16LE(method, 8);              // Compression method (8 = DEFLATE, 0 = STORE)
    localHeader.writeUInt16LE(0, 10);                  // Last mod file time
    localHeader.writeUInt16LE(0, 12);                  // Last mod file date
    localHeader.writeUInt32LE(crc, 14);                // CRC-32
    localHeader.writeUInt32LE(compressedSize, 18);     // Compressed size
    localHeader.writeUInt32LE(uncompressedSize, 22);   // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26);  // File name length
    localHeader.writeUInt16LE(0, 28);                  // Extra field length

    localHeaderChunks.push(localHeader, nameBuffer, payloadBuffer);
    currentOffset += localHeader.length + nameBuffer.length + payloadBuffer.length;

    cdEntries.push({
      nameBuffer,
      method,
      crc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });
  }

  // 2. Central Directory Header を構築
  const cdOffset = currentOffset;
  let cdSize = 0;

  for (const entry of cdEntries) {
    const cdHeader = Buffer.alloc(46);
    cdHeader.writeUInt32LE(0x02014b50, 0);                 // Central file header signature
    cdHeader.writeUInt16LE(20, 4);                         // Version made by
    cdHeader.writeUInt16LE(20, 6);                         // Version needed to extract
    cdHeader.writeUInt16LE(0, 8);                          // General purpose bit flag
    cdHeader.writeUInt16LE(entry.method, 10);              // Compression method
    cdHeader.writeUInt16LE(0, 12);                         // Last mod file time
    cdHeader.writeUInt16LE(0, 14);                         // Last mod file date
    cdHeader.writeUInt32LE(entry.crc, 16);                 // CRC-32
    cdHeader.writeUInt32LE(entry.compressedSize, 20);      // Compressed size
    cdHeader.writeUInt32LE(entry.uncompressedSize, 24);    // Uncompressed size
    cdHeader.writeUInt16LE(entry.nameBuffer.length, 28);   // File name length
    cdHeader.writeUInt16LE(0, 30);                         // Extra field length
    cdHeader.writeUInt16LE(0, 32);                         // File comment length
    cdHeader.writeUInt16LE(0, 34);                         // Disk number start
    cdHeader.writeUInt16LE(0, 36);                         // Internal file attributes
    cdHeader.writeUInt32LE(0, 38);                         // External file attributes
    cdHeader.writeUInt32LE(entry.localHeaderOffset, 42);   // Relative offset of local header

    centralDirectoryChunks.push(cdHeader, entry.nameBuffer);
    cdSize += cdHeader.length + entry.nameBuffer.length;
  }

  // 3. End of Central Directory Record (EOCD) 固定部 22 バイト
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);          // EOCD signature
  eocd.writeUInt16LE(0, 4);                   // Number of this disk
  eocd.writeUInt16LE(0, 6);                   // Disk where central directory starts
  eocd.writeUInt16LE(cdEntries.length, 8);    // Number of central directory records on this disk
  eocd.writeUInt16LE(cdEntries.length, 10);   // Total number of central directory records
  eocd.writeUInt32LE(cdSize, 12);             // Size of central directory
  eocd.writeUInt32LE(cdOffset, 16);           // Offset of start of central directory
  eocd.writeUInt16LE(0, 20);                  // Comment length

  return Buffer.concat([...localHeaderChunks, ...centralDirectoryChunks, eocd]);
}

try {
  // 1. ファイル走査と読み込み
  console.log('🔍 プロジェクトファイルを走査中...');
  const fileItems = collectDeployFiles(projectRoot);
  console.log(`📁 対象ファイル数: ${fileItems.length} 件`);

  const filesForZip = fileItems.map((item) => {
    const data = fs.readFileSync(item.fullPath);
    return {
      zipEntryPath: item.zipEntryPath,
      data,
    };
  });

  // 2. ZIP生成
  console.log('\n⚙️ ZIPバイナリ (DEFLATE圧縮・CRC32付与) を構築中...');
  const zipBuffer = buildCompressedZip(filesForZip);

  // 3. 出力先へ書き出し
  if (fs.existsSync(outputZipPath)) {
    fs.unlinkSync(outputZipPath);
  }
  fs.writeFileSync(outputZipPath, zipBuffer);

  const sizeKB = (zipBuffer.length / 1024).toFixed(2);
  const sizeMB = (zipBuffer.length / (1024 * 1024)).toFixed(2);

  console.log('✅ デプロイ用ZIPの書き出しが完了しました！');
  console.log(`📁 ファイルパス: ${outputZipPath}`);
  console.log(`📊 ファイルサイズ: ${sizeKB} KB (${sizeMB} MB)\n`);

  // ========================================================
  // ZIP アーカイブの自己整合性検証
  // ========================================================
  console.log('🔍 [自己検証] ZIPアーカイブの内容を検査中...');
  const reader = new PureZipReader(zipBuffer, zipFileName);
  const entries = reader.getEntryPaths();

  console.log(`  総エントリ数: ${entries.length} 件`);

  // 必須コアファイルの確認
  const requiredFiles = [
    `${projectName}/Dockerfile`,
    `${projectName}/docker-compose.yml`,
    `${projectName}/package.json`,
    `${projectName}/package-lock.json`,
    `${projectName}/vite.config.js`,
    `${projectName}/README.md`,
    `${projectName}/DEPLOY_GUIDE.md`,
    `${projectName}/SERVER_ADMIN_GUIDE.md`,
    `${projectName}/LICENSE.md`,
    `${projectName}/THIRD_PARTY_LICENSES.md`,
    `${projectName}/server/app.js`,
    `${projectName}/server/scripts/manage-users.js`,
    `${projectName}/client/index.html`,
    `${projectName}/plugins/.gitkeep`,
  ];

  for (const req of requiredFiles) {
    const exists = entries.includes(req);
    assert(exists, `必須ファイルが見つかりません: ${req}`);
    console.log(`  ✅ 必須ファイル確認: ${req}`);
  }

  // プラグイン ZIP が同梱されていないことの確認（プラグインは別ビルド）
  const pluginEntries = entries.filter((e) => e.startsWith(`${projectName}/plugins/`) && e.endsWith('.zip'));
  assert(pluginEntries.length === 0, `プラグイン ZIP が混入しています: ${pluginEntries.join(', ')}`);
  console.log('  ✅ プラグイン ZIP 非同梱（本体のみ最小構成）を確認');

  // 除外対象ファイルが含まれていないことの確認
  for (const badPattern of ['node_modules/', '/logs/', '/storage/', '/dist/', '/scripts/', '/tests/', '/samples/']) {
    // server/scripts/manage-users.js は許可対象のためルート直下の /scripts/, /tests/, /samples/ を検査
    const leak = entries.find((e) =>
      (badPattern === '/scripts/' || badPattern === '/tests/' || badPattern === '/samples/')
        ? e.startsWith(`${projectName}${badPattern}`)
        : e.includes(badPattern)
    );
    assert(!leak, `除外対象が含まれています: ${leak}`);
  }
  console.log('  ✅ 除外対象（node_modules, logs, storage, dist, scripts, tests, samples）の完全除外を確認');

  console.log('\n========================================================');
  console.log('🎉 Dockerデプロイ用パッケージの検証が正常に完了しました！');
  console.log('========================================================');
  console.log('\n🚀 サーバーでのデプロイ・起動手順（詳細は DEPLOY_GUIDE.md を参照）:');
  console.log('--------------------------------------------------');
  console.log('1. ZIPファイルを転送して解凍:');
  console.log(`   unzip ${zipFileName}`);
  console.log(`   cd ${projectName}`);
  console.log('2. （任意）別途ビルドしたプラグイン .zip を plugins/ に配置:');
  console.log('   cp /path/to/*.zip ./plugins/');
  console.log('3. Docker コンテナをビルド＆起動:');
  console.log('   docker compose build');
  console.log('   docker compose up -d');
  console.log('--------------------------------------------------\n');
} catch (error) {
  console.error('\n❌ アーカイブ作成または検証中にエラーが発生しました:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
