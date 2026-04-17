const fs = require('fs');

function ensureDir(dirPath) {
  if (!dirPath) return;
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  }
}

function createStateIo(options = {}) {
  const { dataDir, invalidateCache, withFileLock } = options;

  function ensureDataDir() {
    ensureDir(dataDir);
  }

  function readJsonFile(filePath, fallback = null) {
    if (!fs.existsSync(filePath)) return fallback;
    try {
      return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      return fallback;
    }
  }

  function appendJsonl(filePath, value) {
    ensureDataDir();
    fs.appendFileSync(filePath, JSON.stringify(value) + '\n');
    return value;
  }

  function writeJson(filePath, data, options = {}) {
    const { cacheKey = null, space } = options;

    ensureDataDir();
    fs.writeFileSync(filePath, JSON.stringify(data, null, space));

    if (cacheKey && typeof invalidateCache === 'function') {
      invalidateCache(cacheKey);
    }

    return data;
  }

  function writeJsonl(filePath, rows) {
    ensureDataDir();
    const lines = Array.isArray(rows) ? rows.map((row) => JSON.stringify(row)) : [];
    fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
    return rows;
  }

  function withLock(filePath, fn) {
    if (typeof withFileLock === 'function') {
      return withFileLock(filePath, fn);
    }
    return fn();
  }

  return {
    ensureDataDir,
    readJsonFile,
    appendJsonl,
    writeJson,
    writeJsonl,
    withLock,
  };
}

module.exports = { createStateIo };
