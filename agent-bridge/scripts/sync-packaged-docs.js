#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const ARCHITECTURE_DOCS = [
  'runtime-contract.md',
  'branch-semantics.md',
  'canonical-event-schema.md',
  'markdown-workspace.md',
  'runtime-migration-hardening.md',
];

function ensureTrailingNewline(text) {
  return text.endsWith('\n') ? text : `${text}\n`;
}

function removePackagePrefix(text) {
  return text.replace(/(^|[^.])agent-bridge\//gm, '$1');
}

function buildGeneratedHeader(sourceRelativePath) {
  return `<!-- Generated from ${sourceRelativePath} by scripts/sync-packaged-docs.js for published package consumers. -->\n\n`;
}

function transformArchitectureDoc(text) {
  return removePackagePrefix(text);
}

function transformUsageDoc(text) {
  return removePackagePrefix(text)
    .replace(/npm --prefix agent-bridge test/g, 'npm test')
    .replace(/npm --prefix agent-bridge run /g, 'npm run ')
    .replace('Repo root:', 'Package directory:')
    .replace('- `CLAUDE.md`\n', '');
}

function syncFile({ sourcePath, targetPath, sourceRelativePath, transform }) {
  const sourceText = fs.readFileSync(sourcePath, 'utf8');
  const transformedText = ensureTrailingNewline(
    buildGeneratedHeader(sourceRelativePath) + transform(sourceText)
  );

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, transformedText, 'utf8');
}

function main() {
  for (const docName of ARCHITECTURE_DOCS) {
    syncFile({
      sourcePath: path.join(REPO_ROOT, 'docs', 'architecture', docName),
      targetPath: path.join(PACKAGE_ROOT, 'docs', 'architecture', docName),
      sourceRelativePath: path.posix.join('..', 'docs', 'architecture', docName),
      transform: transformArchitectureDoc,
    });
  }

  syncFile({
    sourcePath: path.join(REPO_ROOT, 'USAGE.md'),
    targetPath: path.join(PACKAGE_ROOT, 'USAGE.md'),
    sourceRelativePath: path.posix.join('..', 'USAGE.md'),
    transform: transformUsageDoc,
  });
}

main();
