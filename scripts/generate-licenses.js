// 日本語コメント: サードパーティライセンス一覧自動生成スクリプト (scripts/generate-licenses.js)
// package.json の dependencies および devDependencies を自動走査し、
// node_modules 配下のパッケージ情報およびライセンス本文を取得して
// license/THIRD_PARTY_LICENSES.md を自動生成します。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// プロジェクトルートおよび出力先ファイルのパス解決
const projectRoot = path.resolve(__dirname, '..');
const packageJsonPath = path.join(projectRoot, 'package.json');
const outputFile = path.join(projectRoot, 'THIRD_PARTY_LICENSES.md');

console.log('========================================');
console.log('📜 サードパーティライセンス情報生成開始');
console.log('========================================\n');

// package.json の読み込み
if (!fs.existsSync(packageJsonPath)) {
  console.error('❌ package.json が見つかりません。');
  process.exit(1);
}

const rootPackage = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const dependencies = Object.keys(rootPackage.dependencies || {});
const devDependencies = Object.keys(rootPackage.devDependencies || {});
const allPackages = [
  ...dependencies.map((name) => ({ name, type: 'Runtime' })),
  ...devDependencies.map((name) => ({ name, type: 'Development' })),
];

// ライセンスファイル名候補
const licenseFileNames = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'LICENCE.txt',
  'license',
  'license.md',
  'license.txt',
];

// 各パッケージのライセンス情報収集
const packageDetails = [];

for (const pkg of allPackages) {
  const pkgDir = path.join(projectRoot, 'node_modules', pkg.name);
  const pkgJsonPath = path.join(pkgDir, 'package.json');

  let pkgInfo = {
    name: pkg.name,
    type: pkg.type,
    version: '不明',
    license: '不明',
    author: '-',
    repository: '-',
    licenseText: '',
  };

  if (fs.existsSync(pkgJsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      pkgInfo.version = data.version || '不明';

      // ライセンス種別の取得
      if (typeof data.license === 'string') {
        pkgInfo.license = data.license;
      } else if (typeof data.license === 'object' && data.license.type) {
        pkgInfo.license = data.license.type;
      } else if (Array.isArray(data.licenses) && data.licenses.length > 0) {
        pkgInfo.license = data.licenses.map((l) => l.type || l).join(', ');
      }

      // 作者情報
      if (typeof data.author === 'string') {
        pkgInfo.author = data.author;
      } else if (typeof data.author === 'object' && data.author.name) {
        pkgInfo.author = data.author.name;
      }

      // リポジトリURLまたはホームページ
      if (typeof data.repository === 'string') {
        pkgInfo.repository = data.repository.replace(/^git\+/, '').replace(/\.git$/, '');
      } else if (typeof data.repository === 'object' && data.repository.url) {
        pkgInfo.repository = data.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
      } else if (data.homepage) {
        pkgInfo.repository = data.homepage;
      }

      // ライセンスファイル本文の取得
      for (const licFileName of licenseFileNames) {
        const licFilePath = path.join(pkgDir, licFileName);
        if (fs.existsSync(licFilePath)) {
          pkgInfo.licenseText = fs.readFileSync(licFilePath, 'utf-8').trim();
          break;
        }
      }
    } catch (e) {
      console.warn(`⚠️ ${pkg.name} の読み込み中に警告: ${e.message}`);
    }
  }

  packageDetails.push(pkgInfo);
}

// Markdown ドキュメントの生成
const now = new Date().toISOString().slice(0, 10);
let markdown = `# サードパーティライセンス一覧 (Third-Party Licenses)

本プロジェクト（${rootPackage.name || 'dbml-editor-v2'} v${rootPackage.version || '2.0.0'}）で使用されているサードパーティ製オープンソースソフトウェア（OSS）のライセンス一覧です。

- **自動生成日**: ${now}
- **生成スクリプト**: \`scripts/generate-licenses.js\` (再生成コマンド: \`npm run license:generate\`)

---

## 1. 依存パッケージサマリー

| パッケージ名 | 用途 | バージョン | ライセンス | リポジトリ / ホームページ |
|:---|:---:|:---:|:---:|:---|
`;

for (const pkg of packageDetails) {
  const repoLink = pkg.repository !== '-' ? `[Link](${pkg.repository})` : '-';
  markdown += `| **${pkg.name}** | ${pkg.type} | \`${pkg.version}\` | **${pkg.license}** | ${repoLink} |\n`;
}

markdown += `
---

## 2. インフラ・コンテナ環境（参考）

| ソフトウェア | バージョン / イメージ | ライセンス | 補足 |
|:---|:---|:---|:---|
| **Node.js** | 22 (Alpine Linux) | MIT / BSD / GPL | アプリケーションコンテナベースイメージ |
| **Oracle Database** | 23ai Free (\`gvenzl/oracle-free:slim\`) | [Free Use Terms and Conditions (FUTC)](https://www.oracle.com/downloads/licenses/oracle-free-license.html) | 開発・検証・商用無料版（最大12GBユーザーデータ、2CPU、2GB RAM制限） |

---

## 3. 各パッケージのライセンス詳細・条文

`;

for (const pkg of packageDetails) {
  markdown += `### ${pkg.name} (v${pkg.version})\n\n`;
  markdown += `- **ライセンス**: ${pkg.license}\n`;
  markdown += `- **区分**: ${pkg.type}\n`;
  if (pkg.author !== '-') markdown += `- **作者**: ${pkg.author}\n`;
  if (pkg.repository !== '-') markdown += `- **URL**: ${pkg.repository}\n`;
  markdown += '\n';

  if (pkg.licenseText) {
    markdown += `<details>\n<summary>ライセンス全文を表示</summary>\n\n\`\`\`\n${pkg.licenseText}\n\`\`\`\n\n</details>\n\n`;
  } else {
    markdown += `> ※ライセンスファイルはパッケージ内に同梱されていないか、標準的な ${pkg.license} ライセンスが適用されます。\n\n`;
  }
  markdown += '---\n\n';
}

// ファイル書き込み
fs.writeFileSync(outputFile, markdown, 'utf-8');

console.log('✅ サードパーティライセンスドキュメントの生成が完了しました！');
console.log(`📁 出力ファイル: ${outputFile}`);
console.log(`📊 走査パッケージ数: ${packageDetails.length} 件`);
