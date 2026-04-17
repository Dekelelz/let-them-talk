const fs = require('fs');
const path = require('path');

const { EVENT_STREAMS } = require('./schema');

function defaultSanitizeBranchName(branchName) {
  if (!branchName || branchName === 'main') return 'main';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(branchName)) {
    throw new Error('Invalid branch name');
  }
  return branchName;
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJsonlObjects(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createCanonicalHookState(options = {}) {
  const {
    dataDir,
    withLock,
    sanitizeBranchName = defaultSanitizeBranchName,
    now = () => new Date().toISOString(),
  } = options;

  function runWithLock(filePath, fn) {
    if (typeof withLock === 'function') {
      return withLock(filePath, fn);
    }
    return fn();
  }

  function getRuntimeHooksFile() {
    return path.join(dataDir, 'runtime', 'hooks.jsonl');
  }

  function getBranchHooksFile(branchName = 'main') {
    return path.join(dataDir, 'runtime', 'branches', sanitizeBranchName(branchName), 'hooks.jsonl');
  }

  function getHooksFile(stream, branchId) {
    if (stream === EVENT_STREAMS.RUNTIME) {
      return getRuntimeHooksFile();
    }

    if (stream === EVENT_STREAMS.BRANCH) {
      return getBranchHooksFile(branchId || 'main');
    }

    throw new Error(`Unsupported hook stream: ${String(stream)}`);
  }

  function createHookRecord(event) {
    return {
      hook_id: `hook_${event.event_id}`,
      topic: event.type,
      stream: event.stream,
      branch_id: event.branch_id,
      event_id: event.event_id,
      event_seq: event.seq,
      occurred_at: event.occurred_at,
      published_at: now(),
      actor_agent: event.actor_agent,
      session_id: event.session_id,
      command_id: event.command_id,
      causation_id: event.causation_id,
      correlation_id: event.correlation_id,
      payload: cloneJsonValue(event.payload),
    };
  }

  function projectCommittedEvent(event) {
    if (!event || typeof event !== 'object' || !event.type || !event.stream) return null;

    const hookFile = getHooksFile(event.stream, event.branch_id);
    const hook = createHookRecord(event);

    return runWithLock(hookFile, () => {
      fs.mkdirSync(path.dirname(hookFile), { recursive: true });
      fs.appendFileSync(hookFile, JSON.stringify(hook) + '\n');
      return hook;
    });
  }

  function readHooks(params = {}) {
    const stream = params.stream || EVENT_STREAMS.BRANCH;
    const branchId = stream === EVENT_STREAMS.BRANCH
      ? sanitizeBranchName(params.branchId || params.branch_id || 'main')
      : null;
    const hookFile = getHooksFile(stream, branchId);
    let hooks = readJsonlObjects(hookFile);

    if (params.topic) {
      hooks = hooks.filter((hook) => hook.topic === params.topic);
    }

    if (Array.isArray(params.topics) && params.topics.length > 0) {
      const topicSet = new Set(params.topics);
      hooks = hooks.filter((hook) => topicSet.has(hook.topic));
    }

    if (Number.isInteger(params.afterEventSeq) && params.afterEventSeq >= 0) {
      hooks = hooks.filter((hook) => hook.event_seq > params.afterEventSeq);
    }

    if (params.eventId) {
      hooks = hooks.filter((hook) => hook.event_id === params.eventId);
    }

    if (Number.isInteger(params.limit) && params.limit > 0) {
      hooks = hooks.slice(-params.limit);
    }

    return hooks;
  }

  function readBranchHooks(branchName = 'main', options = {}) {
    return readHooks({
      ...options,
      stream: EVENT_STREAMS.BRANCH,
      branchId: branchName,
    });
  }

  function readRuntimeHooks(options = {}) {
    return readHooks({
      ...options,
      stream: EVENT_STREAMS.RUNTIME,
    });
  }

  return {
    getRuntimeHooksFile,
    getBranchHooksFile,
    projectCommittedEvent,
    readHooks,
    readBranchHooks,
    readRuntimeHooks,
  };
}

module.exports = { createCanonicalHookState };
