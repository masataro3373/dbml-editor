// 日本語コメント: クライアント完結型 ZIP 作成ユーティリティ (src/core/zip-utils.js)
// 外部ライブラリ（JSZip, AdmZip等）への依存ゼロで、ブラウザ標準の JavaScript のみで
// ZIP アーカイブバイナリ (PK0304) を生成し、一括ダウンロードを実現します。

/**
 * CRC32 計算テーブル
 */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

/**
 * Uint8Array データから CRC32 値を算出
 */
function calculateCrc32(uint8Array) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < uint8Array.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ uint8Array[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/**
 * 現在日時の MS-DOS 形式（日付・時刻）を取得
 */
function getDosDateTime(date = new Date()) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);

  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
};

/**
 * 複数ファイルを1つの ZIP Blob として生成
 * @param {Array<{ filename: string, content: string }>} files - ファイルリスト
 * @param {Object} options - { encoding: 'utf-8', lineEnding: 'LF' | 'CRLF' }
 * @returns {Blob} ZIP バイナリ Blob
 */
export function createZipBlob(files = [], options = {}) {
  const lineEnding = options.lineEnding || 'LF';
  const textEncoder = new TextEncoder();

  const fileEntries = [];
  let offset = 0;

  // 1. 各ファイルのバイナリ化と Local File Header の準備
  for (const file of files) {
    if (!file || !file.filename || file.content === undefined) continue;

    let contentStr = file.content.trimEnd() + '\n';
    if (lineEnding === 'CRLF') {
      contentStr = contentStr.replace(/\r?\n/g, '\r\n');
    } else {
      contentStr = contentStr.replace(/\r?\n/g, '\n');
    }

    const contentBytes = textEncoder.encode(contentStr);
    const filenameBytes = textEncoder.encode(file.filename);
    const crc = calculateCrc32(contentBytes);
    const { dosTime, dosDate } = getDosDateTime();

    // Local file header (30 bytes + filename + data)
    const localHeader = new Uint8Array(30 + filenameBytes.length);
    const view = new DataView(localHeader.buffer);

    view.setUint32(0, 0x04034b50, true);  // Local file header signature
    view.setUint16(4, 20, true);          // Version needed to extract (2.0)
    view.setUint16(6, 0x0800, true);      // General purpose bit flag (UTF-8)
    view.setUint16(8, 0, true);           // Compression method (0 = STORE: 無圧縮)
    view.setUint16(10, dosTime, true);    // Last mod file time
    view.setUint16(12, dosDate, true);    // Last mod file date
    view.setUint32(14, crc, true);        // CRC-32
    view.setUint32(18, contentBytes.length, true); // Compressed size
    view.setUint32(22, contentBytes.length, true); // Uncompressed size
    view.setUint16(26, filenameBytes.length, true); // File name length
    view.setUint16(28, 0, true);          // Extra field length

    localHeader.set(filenameBytes, 30);

    fileEntries.push({
      filenameBytes,
      contentBytes,
      localHeader,
      crc,
      dosTime,
      dosDate,
      offset
    });

    offset += localHeader.length + contentBytes.length;
  }

  // 2. Central Directory Header の生成
  const centralHeaders = [];
  let centralDirectorySize = 0;

  for (const entry of fileEntries) {
    // Central directory header (46 bytes + filename)
    const cdHeader = new Uint8Array(46 + entry.filenameBytes.length);
    const view = new DataView(cdHeader.buffer);

    view.setUint32(0, 0x02014b50, true);  // Central file header signature
    view.setUint16(4, 20, true);          // Version made by
    view.setUint16(6, 20, true);          // Version needed to extract
    view.setUint16(8, 0x0800, true);      // General purpose bit flag (UTF-8)
    view.setUint16(10, 0, true);          // Compression method
    view.setUint16(12, entry.dosTime, true);
    view.setUint16(14, entry.dosDate, true);
    view.setUint32(16, entry.crc, true);
    view.setUint32(20, entry.contentBytes.length, true);
    view.setUint32(24, entry.contentBytes.length, true);
    view.setUint16(28, entry.filenameBytes.length, true);
    view.setUint16(30, 0, true);          // Extra field length
    view.setUint16(32, 0, true);          // File comment length
    view.setUint16(34, 0, true);          // Disk number start
    view.setUint16(36, 0, true);          // Internal file attributes
    view.setUint32(38, 0, true);          // External file attributes
    view.setUint32(42, entry.offset, true); // Relative offset of local header

    cdHeader.set(entry.filenameBytes, 46);
    centralHeaders.push(cdHeader);
    centralDirectorySize += cdHeader.length;
  }

  // 3. End of Central Directory Record (22 bytes)
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);

  eocdView.setUint32(0, 0x06054b50, true); // End of central dir signature
  eocdView.setUint16(4, 0, true);          // Number of this disk
  eocdView.setUint16(6, 0, true);          // Disk where central directory starts
  eocdView.setUint16(8, fileEntries.length, true);  // Number of central directory records on this disk
  eocdView.setUint16(10, fileEntries.length, true); // Total number of central directory records
  eocdView.setUint32(12, centralDirectorySize, true); // Size of central directory
  eocdView.setUint32(16, offset, true);               // Offset of start of central directory
  eocdView.setUint16(20, 0, true);                    // Comment length

  // 4. 全バイナリパーツを結合した Blob を生成
  const parts = [];
  for (const entry of fileEntries) {
    parts.push(entry.localHeader);
    parts.push(entry.contentBytes);
  }
  for (const cd of centralHeaders) {
    parts.push(cd);
  }
  parts.push(eocd);

  return new Blob(parts, { type: 'application/zip' });
}

/**
 * 日本語コメント: DEFLATE (Raw) バイト列を解凍するヘルパー (ブラウザ標準 DecompressionStream または Node.js zlib)
 */
async function decompressDeflate(compressedBytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(compressedBytes);
    writer.close();

    const chunks = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  // Node.js 環境フォールバック (単体テスト用)
  try {
    const zlib = await import('node:zlib');
    return new Uint8Array(zlib.inflateRawSync(compressedBytes));
  } catch (e) {
    throw new Error('DEFLATE 解凍エンジンを利用できません: ' + e.message);
  }
}

/**
 * 日本語コメント: ZIP Blob または ArrayBuffer を解析して、含まれるファイル一覧を展開
 * 外部ライブラリ不要で、ブラウザ完結で ZIP アーカイブを展開します
 * @param {Blob|ArrayBuffer|Uint8Array} zipData - ZIPデータ
 * @returns {Promise<Array<{ path: string, content: string, bytes: Uint8Array }>>}
 */
export async function readZipBlob(zipData) {
  let arrayBuffer;
  if (typeof Blob !== 'undefined' && zipData instanceof Blob) {
    arrayBuffer = await zipData.arrayBuffer();
  } else if (zipData instanceof ArrayBuffer) {
    arrayBuffer = zipData;
  } else if (zipData && zipData.buffer instanceof ArrayBuffer) {
    arrayBuffer = zipData.buffer.slice(zipData.byteOffset, zipData.byteOffset + zipData.byteLength);
  } else {
    throw new Error('無効なZIPデータです');
  }

  const bytes = new Uint8Array(arrayBuffer);
  const view = new DataView(arrayBuffer);
  const textDecoder = new TextDecoder('utf-8');
  const files = [];

  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      // Local File Header シグネチャ (PK\x03\x04) でなければ Central Directory に到達したとみなして終了
      break;
    }

    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const fileNameBytes = bytes.subarray(offset + 30, offset + 30 + fileNameLen);
    const filePath = textDecoder.decode(fileNameBytes).replace(/\\/g, '/');

    const dataStart = offset + 30 + fileNameLen + extraLen;
    const dataEnd = dataStart + compressedSize;

    if (dataEnd > bytes.length) {
      break;
    }

    const fileDataBytes = bytes.subarray(dataStart, dataEnd);

    // ディレクトリ（末尾が '/'）はスキップ
    if (!filePath.endsWith('/') && fileNameLen > 0) {
      let decompressedBytes;
      if (method === 0) {
        // STORE (無圧縮)
        decompressedBytes = fileDataBytes;
      } else if (method === 8) {
        // DEFLATE (圧縮)
        decompressedBytes = await decompressDeflate(fileDataBytes);
      } else {
        throw new Error(`未対応のZIP圧縮方式です: method=${method}`);
      }

      const content = textDecoder.decode(decompressedBytes);
      files.push({
        path: filePath,
        content,
        bytes: decompressedBytes,
      });
    }

    offset = dataEnd;
  }

  return files;
}
