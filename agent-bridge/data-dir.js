const fs = require('fs');
const path = require('path');

const DEFAULT_DATA_DIR_NAME = '.agent-bridge';
const DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME = '.agent-bridge-markdown';
const DATA_DIR_ENV_KEYS = Object.freeze(['AGENT_BRIDGE_DATA_DIR', 'AGENT_BRIDGE_DATA']);

function resolveExplicitDataDir(env = process.env) {
  for (const key of DATA_DIR_ENV_KEYS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

function isWithinDir(parentDir, childDir) {
  const relative = path.relative(parentDir, childDir);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveRepoRootForLocalDev(moduleDir = __dirname) {
  const packageDir = path.resolve(moduleDir);
  const repoRoot = path.resolve(packageDir, '..');

  if (path.basename(packageDir) !== 'agent-bridge') return null;
  if (path.resolve(repoRoot, 'agent-bridge') !== packageDir) return null;

  const packageJson = path.join(packageDir, 'package.json');
  const rootPackageJson = path.join(repoRoot, 'package.json');
  if (!fs.existsSync(packageJson) || !fs.existsSync(rootPackageJson)) return null;

  return repoRoot;
}

function resolveDefaultDataRoot({ cwd = process.cwd(), moduleDir = __dirname } = {}) {
  const resolvedCwd = path.resolve(cwd);
  const packageDir = path.resolve(moduleDir);
  const repoRoot = resolveRepoRootForLocalDev(moduleDir);

  if (repoRoot && isWithinDir(packageDir, resolvedCwd)) {
    return repoRoot;
  }

  return resolvedCwd;
}

function resolveDataDir({ env = process.env, cwd = process.cwd(), moduleDir = __dirname } = {}) {
  return resolveExplicitDataDir(env) || path.join(resolveDefaultDataRoot({ cwd, moduleDir }), DEFAULT_DATA_DIR_NAME);
}

module.exports = {
  DEFAULT_DATA_DIR_NAME,
  DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME,
  isWithinDir,
  resolveExplicitDataDir,
  resolveDefaultDataRoot,
  resolveDataDir,
};
