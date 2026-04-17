#!/usr/bin/env node

const path = require('path');

const {
  resolveDataDir,
  resolveDefaultDataRoot,
} = require(path.resolve(__dirname, '..', 'data-dir.js'));
const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const USAGE = [
  'Usage: node agent-bridge/scripts/export-markdown-workspace.js',
  '  [--data-dir <path>] [--project-root <path>] [--output <path>] [--branch <branch> ...]',
].join('\n');

function fail(message, exitCode = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {
    branches: [],
    dataDir: null,
    outputRoot: null,
    projectRoot: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      fail(USAGE, 0);
    }

    if (!['--data-dir', '--output', '--project-root', '--branch'].includes(arg)) {
      fail(USAGE, 2);
    }

    if (index + 1 >= argv.length) {
      fail(USAGE, 2);
    }

    const value = argv[index + 1];
    index += 1;

    if (arg === '--data-dir') {
      result.dataDir = path.resolve(value);
      continue;
    }

    if (arg === '--output') {
      result.outputRoot = path.resolve(value);
      continue;
    }

    if (arg === '--project-root') {
      result.projectRoot = path.resolve(value);
      continue;
    }

    result.branches.push(value);
  }

  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const projectRoot = args.projectRoot
    || (args.dataDir ? path.resolve(args.dataDir, '..') : resolveDefaultDataRoot({ cwd: process.cwd(), moduleDir: PACKAGE_ROOT }));
  const dataDir = args.dataDir
    || resolveDataDir({ cwd: projectRoot, moduleDir: PACKAGE_ROOT });
  const canonicalState = createCanonicalState({ dataDir, processPid: process.pid });
  const result = canonicalState.exportMarkdownWorkspace({
    projectRoot,
    outputRoot: args.outputRoot,
    branches: args.branches.length > 0 ? args.branches : null,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main();
