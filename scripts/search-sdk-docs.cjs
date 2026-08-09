const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..');
const sdkName = process.argv[2];
const query = process.argv.slice(3).join(' ').trim();
const supportedSdks = new Set(['ai', 'workflow']);

if (!supportedSdks.has(sdkName) || query.length === 0) {
  console.error(
    'Usage: node scripts/search-sdk-docs.cjs <ai|workflow> <search text>',
  );
  process.exitCode = 1;
  return;
}

const packageRoot = path.join(
  repositoryRoot,
  'packages',
  'workflow',
  'node_modules',
  sdkName,
);
const docsRoot = path.join(packageRoot, 'docs');
const packageManifestPath = path.join(packageRoot, 'package.json');

if (!fs.existsSync(docsRoot) || !fs.existsSync(packageManifestPath)) {
  console.error(
    `Bundled docs for ${sdkName} are unavailable. Run pnpm install first.`,
  );
  process.exitCode = 1;
  return;
}

const packageManifest = JSON.parse(
  fs.readFileSync(packageManifestPath, 'utf8'),
);
const normalizedQuery = query.toLocaleLowerCase('en-US');
const supportedExtensions = new Set(['.md', '.mdx']);
const resultLimit = 100;
let matchCount = 0;
let hasTruncatedResults = false;

function collectDocumentationFiles(directory) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectDocumentationFiles(absolutePath));
      continue;
    }

    if (supportedExtensions.has(path.extname(entry.name))) {
      files.push(absolutePath);
    }
  }

  return files;
}

console.log(
  `Searching ${packageManifest.name}@${packageManifest.version} bundled docs for "${query}"`,
);

for (const filePath of collectDocumentationFiles(docsRoot).sort()) {
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);

  for (const [index, line] of lines.entries()) {
    if (!line.toLocaleLowerCase('en-US').includes(normalizedQuery)) {
      continue;
    }

    if (matchCount >= resultLimit) {
      hasTruncatedResults = true;
      break;
    }

    const relativePath = path
      .relative(repositoryRoot, filePath)
      .split(path.sep)
      .join('/');
    console.log(`${relativePath}:${index + 1}:${line.trim()}`);
    matchCount += 1;
  }

  if (hasTruncatedResults) {
    break;
  }
}

if (matchCount === 0) {
  console.log('No matches found.');
} else if (hasTruncatedResults) {
  console.log(`Results truncated after ${resultLimit} matches.`);
}
