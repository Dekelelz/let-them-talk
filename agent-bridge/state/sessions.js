const fs = require('fs');
const path = require('path');

const SESSION_MANIFEST_SCHEMA_VERSION = 1;
const SESSION_INDEX_SCHEMA_VERSION = 1;
const DEFAULT_STALE_THRESHOLD_MS = 60000;

const SESSION_STATES = Object.freeze([
  'active',
  'interrupted',
  'completed',
  'failed',
  'abandoned',
]);

const TERMINAL_SESSION_EVENTS = Object.freeze({
  interrupted: 'session.interrupted',
  completed: 'session.completed',
  failed: 'session.failed',
  abandoned: 'session.abandoned',
});

function fallbackSessionId() {
  return `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function toTimestamp(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function compareSessionsByRecency(left, right) {
  return toTimestamp(left && (left.updated_at || left.last_activity_at || left.resumed_at || left.started_at || left.created_at))
    - toTimestamp(right && (right.updated_at || right.last_activity_at || right.resumed_at || right.started_at || right.created_at));
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readFileFingerprint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      exists: false,
      size: 0,
      mtime_ms: 0,
    };
  }

  const stats = fs.statSync(filePath);
  return {
    exists: true,
    size: stats.size,
    mtime_ms: stats.mtimeMs,
  };
}

function sameFileFingerprint(left, right) {
  return !!left
    && !!right
    && left.exists === right.exists
    && left.size === right.size
    && left.mtime_ms === right.mtime_ms;
}

function normalizeAgentIndexSummary(summary) {
  return {
    latest_session_id: typeof (summary && summary.latest_session_id) === 'string' ? summary.latest_session_id : null,
    latest_branch_id: typeof (summary && summary.latest_branch_id) === 'string' ? summary.latest_branch_id : null,
    active_session_id: typeof (summary && summary.active_session_id) === 'string' ? summary.active_session_id : null,
    active_branch_id: typeof (summary && summary.active_branch_id) === 'string' ? summary.active_branch_id : null,
    branch_ids: Array.isArray(summary && summary.branch_ids)
      ? [...new Set(summary.branch_ids.filter((branchId) => typeof branchId === 'string' && branchId.length > 0))]
      : [],
  };
}

function normalizeBranchIndexSummary(summary) {
  const latestByAgent = summary && summary.latest_by_agent && typeof summary.latest_by_agent === 'object' && !Array.isArray(summary.latest_by_agent)
    ? summary.latest_by_agent
    : {};

  return {
    latest_session_id: typeof (summary && summary.latest_session_id) === 'string' ? summary.latest_session_id : null,
    session_ids: Array.isArray(summary && summary.session_ids)
      ? [...new Set(summary.session_ids.filter((sessionId) => typeof sessionId === 'string' && sessionId.length > 0))]
      : [],
    active_session_ids: Array.isArray(summary && summary.active_session_ids)
      ? [...new Set(summary.active_session_ids.filter((sessionId) => typeof sessionId === 'string' && sessionId.length > 0))]
      : [],
    latest_by_agent: Object.fromEntries(
      Object.entries(latestByAgent).filter(([, sessionId]) => typeof sessionId === 'string' && sessionId.length > 0)
    ),
  };
}

function moveRecentIdToFront(values, value, includeValue = true) {
  const normalized = Array.isArray(values)
    ? values.filter((entry) => typeof entry === 'string' && entry.length > 0 && entry !== value)
    : [];

  if (includeValue && typeof value === 'string' && value.length > 0) {
    normalized.unshift(value);
  }

  return normalized;
}

function normalizeIndex(index) {
  const sessions = index && index.sessions && typeof index.sessions === 'object' && !Array.isArray(index.sessions)
    ? { ...index.sessions }
    : {};
  const byAgent = index && index.by_agent && typeof index.by_agent === 'object' && !Array.isArray(index.by_agent)
    ? index.by_agent
    : {};
  const byBranch = index && index.by_branch && typeof index.by_branch === 'object' && !Array.isArray(index.by_branch)
    ? index.by_branch
    : {};

  return {
    schema_version: SESSION_INDEX_SCHEMA_VERSION,
    updated_at: index && index.updated_at ? index.updated_at : null,
    sessions,
    active_sessions: Array.isArray(index && index.active_sessions)
      ? [...new Set(index.active_sessions.filter((sessionId) => typeof sessionId === 'string' && sessionId.length > 0))]
      : [],
    by_agent: Object.fromEntries(
      Object.entries(byAgent).map(([agentName, summary]) => [agentName, normalizeAgentIndexSummary(summary)])
    ),
    by_branch: Object.fromEntries(
      Object.entries(byBranch).map(([branchId, summary]) => [branchId, normalizeBranchIndexSummary(summary)])
    ),
  };
}

function buildSessionSummary(session, indexedAt, options = {}) {
  const staleThresholdMs = Number.isFinite(options.staleThresholdMs) ? options.staleThresholdMs : DEFAULT_STALE_THRESHOLD_MS;
  const lastActivityAt = session.last_activity_at || session.resumed_at || session.started_at || session.created_at || null;
  const indexedAtMs = toTimestamp(indexedAt);
  const stale = session.state === 'active'
    && indexedAtMs > 0
    && toTimestamp(lastActivityAt) > 0
    && indexedAtMs - toTimestamp(lastActivityAt) > staleThresholdMs;

  return {
    session_id: session.session_id,
    agent_name: session.agent_name,
    branch_id: session.branch_id,
    provider: session.provider || null,
    state: session.state,
    created_at: session.created_at || null,
    started_at: session.started_at || null,
    resumed_at: session.resumed_at || null,
    ended_at: session.ended_at || null,
    updated_at: session.updated_at || null,
    last_activity_at: lastActivityAt,
    last_heartbeat_at: session.last_heartbeat_at || null,
    transition_reason: session.transition_reason || null,
    resume_count: Number.isInteger(session.resume_count) ? session.resume_count : 0,
    recovery_snapshot_file: session.recovery_snapshot_file || null,
    stale,
  };
}

function createSessionsState(options = {}) {
  const {
    io,
    branchPaths,
    canonicalEventLog = null,
    now = () => new Date().toISOString(),
    createSessionId = fallbackSessionId,
    staleThresholdMs = DEFAULT_STALE_THRESHOLD_MS,
  } = options;

  if (!io) throw new Error('createSessionsState requires io');
  if (!branchPaths) throw new Error('createSessionsState requires branchPaths');
  if (typeof branchPaths.getBranchSessionFile !== 'function') {
    throw new Error('createSessionsState requires branchPaths.getBranchSessionFile()');
  }
  if (typeof branchPaths.getBranchSessionsDir !== 'function') {
    throw new Error('createSessionsState requires branchPaths.getBranchSessionsDir()');
  }
  if (typeof branchPaths.getSessionsIndexFile !== 'function') {
    throw new Error('createSessionsState requires branchPaths.getSessionsIndexFile()');
  }

  let indexCache = null;

  function ensureFileDir(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
  }

  function readSessionManifest(sessionId, branchName = 'main') {
    return io.readJsonFile(branchPaths.getBranchSessionFile(sessionId, branchName), null);
  }

  function listBranchSessionFiles(branchName = 'main') {
    const sessionsDir = branchPaths.getBranchSessionsDir(branchName);
    if (!fs.existsSync(sessionsDir)) return [];
    return fs.readdirSync(sessionsDir)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => path.join(sessionsDir, fileName));
  }

  function listBranchSessions(branchName = 'main') {
    return listBranchSessionFiles(branchName)
      .map((filePath) => io.readJsonFile(filePath, null))
      .filter((session) => session && typeof session === 'object' && session.session_id)
      .sort(compareSessionsByRecency);
  }

  function cacheIndex(index) {
    const indexFile = branchPaths.getSessionsIndexFile();
    const normalized = normalizeIndex(index);
    indexCache = {
      index: normalized,
      fingerprint: readFileFingerprint(indexFile),
    };
    return normalized;
  }

  function getIndexedSessionSummary(index, sessionId, branchName, indexedAt) {
    const entry = index
      && index.sessions
      && Object.prototype.hasOwnProperty.call(index.sessions, sessionId)
      ? index.sessions[sessionId]
      : null;

    if (!entry || entry.branch_id !== branchName) return null;
    return buildSessionSummary(entry, indexedAt || index.updated_at || now(), {
      staleThresholdMs,
    });
  }

  function getIndexedLatestSessionId(index, branchName, agentName) {
    const branchSummary = index
      && index.by_branch
      && index.by_branch[branchName]
      && typeof index.by_branch[branchName] === 'object'
      ? index.by_branch[branchName]
      : null;

    if (!branchSummary || !branchSummary.latest_by_agent) return null;
    return typeof branchSummary.latest_by_agent[agentName] === 'string'
      ? branchSummary.latest_by_agent[agentName]
      : null;
  }

  function getMostRecentActiveAgentSession(index, agentName, excludingSessionId = null) {
    if (!index || !index.sessions || typeof index.sessions !== 'object') return null;

    let best = null;
    for (const entry of Object.values(index.sessions)) {
      if (!entry || entry.agent_name !== agentName || entry.state !== 'active') continue;
      if (excludingSessionId && entry.session_id === excludingSessionId) continue;
      if (!best || compareSessionsByRecency(best, entry) < 0) {
        best = entry;
      }
    }

    return best;
  }

  function getLatestSessionForAgent(branchName = 'main', agentName) {
    const index = loadIndex();
    const indexedSessionId = getIndexedLatestSessionId(index, branchName, agentName);

    if (indexedSessionId) {
      const indexedSession = readSessionManifest(indexedSessionId, branchName);
      if (indexedSession && indexedSession.agent_name === agentName) {
        return indexedSession;
      }

      const rebuiltIndex = rebuildIndex({ at: now() });
      const rebuiltSessionId = getIndexedLatestSessionId(rebuiltIndex, branchName, agentName);
      if (rebuiltSessionId) {
        const rebuiltSession = readSessionManifest(rebuiltSessionId, branchName);
        if (rebuiltSession && rebuiltSession.agent_name === agentName) {
          return rebuiltSession;
        }
      }
    }

    const sessions = listBranchSessions(branchName).filter((session) => session.agent_name === agentName);
    return sessions.length > 0 ? sessions[sessions.length - 1] : null;
  }

  function summarizeSession(session, options = {}) {
    if (!session || !session.session_id) return null;
    return buildSessionSummary(session, options.indexedAt || now(), {
      staleThresholdMs,
    });
  }

  function getSessionSummary(sessionId, branchName = 'main', options = {}) {
    const index = loadIndex();
    const indexedSummary = getIndexedSessionSummary(index, sessionId, branchName, options.indexedAt || (index && index.updated_at) || now());
    if (indexedSummary) return indexedSummary;

    const session = readSessionManifest(sessionId, branchName);
    if (!session) return null;
    return summarizeSession(session, {
      indexedAt: options.indexedAt || (index && index.updated_at) || now(),
    });
  }

  function getLatestSessionSummaryForAgent(branchName = 'main', agentName, options = {}) {
    const index = loadIndex();
    const indexedSessionId = getIndexedLatestSessionId(index, branchName, agentName);
    const indexedSummary = indexedSessionId
      ? getIndexedSessionSummary(index, indexedSessionId, branchName, options.indexedAt || (index && index.updated_at) || now())
      : null;
    if (indexedSummary) return indexedSummary;

    const session = getLatestSessionForAgent(branchName, agentName);
    if (!session) return null;
    return summarizeSession(session, {
      indexedAt: options.indexedAt || (index && index.updated_at) || now(),
    });
  }

  function finalizeIndex(index, indexedAt) {
    const normalized = normalizeIndex(index);
    const entries = Object.values(normalized.sessions).sort(compareSessionsByRecency).reverse();

    normalized.updated_at = indexedAt;
    normalized.active_sessions = entries
      .filter((entry) => entry.state === 'active')
      .map((entry) => entry.session_id);
    normalized.by_agent = {};
    normalized.by_branch = {};

    for (const entry of entries) {
      if (!normalized.by_agent[entry.agent_name]) {
        normalized.by_agent[entry.agent_name] = {
          latest_session_id: entry.session_id,
          latest_branch_id: entry.branch_id,
          active_session_id: null,
          active_branch_id: null,
          branch_ids: [],
        };
      }

      const agentSummary = normalized.by_agent[entry.agent_name];
      if (!agentSummary.branch_ids.includes(entry.branch_id)) agentSummary.branch_ids.push(entry.branch_id);
      if (entry.state === 'active' && !agentSummary.active_session_id) {
        agentSummary.active_session_id = entry.session_id;
        agentSummary.active_branch_id = entry.branch_id;
      }

      if (!normalized.by_branch[entry.branch_id]) {
        normalized.by_branch[entry.branch_id] = {
          latest_session_id: entry.session_id,
          session_ids: [],
          active_session_ids: [],
          latest_by_agent: {},
        };
      }

      normalized.by_branch[entry.branch_id].session_ids.push(entry.session_id);
      if (!normalized.by_branch[entry.branch_id].latest_by_agent[entry.agent_name]) {
        normalized.by_branch[entry.branch_id].latest_by_agent[entry.agent_name] = entry.session_id;
      }
      if (entry.state === 'active') {
        normalized.by_branch[entry.branch_id].active_session_ids.push(entry.session_id);
      }
    }

    return normalized;
  }

  function writeIndex(index) {
    const filePath = branchPaths.getSessionsIndexFile();
    ensureFileDir(filePath);
    return io.withLock(filePath, () => {
      const normalized = normalizeIndex(index);
      fs.writeFileSync(filePath, JSON.stringify(normalized));
      return cloneJsonValue(cacheIndex(normalized));
    });
  }

  function rebuildIndex(options = {}) {
    const indexedAt = options.at || now();
    const runtimeBranchesDir = path.join(branchPaths.runtimeDir, 'branches');
    const sessions = {};

    if (fs.existsSync(runtimeBranchesDir)) {
      for (const entry of fs.readdirSync(runtimeBranchesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const branchName = entry.name;
        for (const session of listBranchSessions(branchName)) {
          sessions[session.session_id] = buildSessionSummary(session, indexedAt, {
            staleThresholdMs,
          });
        }
      }
    }

    return writeIndex(finalizeIndex({ schema_version: SESSION_INDEX_SCHEMA_VERSION, sessions }, indexedAt));
  }

  function loadIndex() {
    const indexFile = branchPaths.getSessionsIndexFile();
    const currentFingerprint = readFileFingerprint(indexFile);
    if (!currentFingerprint.exists) {
      indexCache = null;
      return null;
    }

    if (indexCache && sameFileFingerprint(indexCache.fingerprint, currentFingerprint)) {
      return cloneJsonValue(indexCache.index);
    }

    const parsed = io.readJsonFile(indexFile, null);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const normalized = normalizeIndex(parsed);
    indexCache = {
      index: normalized,
      fingerprint: currentFingerprint,
    };
    return cloneJsonValue(normalized);
  }

  function syncIndexForSession(session, indexedAt) {
    const currentIndex = loadIndex() || rebuildIndex({ at: indexedAt });
    const nextSummary = buildSessionSummary(session, indexedAt, {
      staleThresholdMs,
    });
    const previousSummary = currentIndex.sessions[session.session_id] || null;

    if (previousSummary
      && (previousSummary.agent_name !== nextSummary.agent_name || previousSummary.branch_id !== nextSummary.branch_id)) {
      return rebuildIndex({ at: indexedAt });
    }

    currentIndex.updated_at = indexedAt;
    currentIndex.sessions[session.session_id] = nextSummary;
    currentIndex.active_sessions = moveRecentIdToFront(
      currentIndex.active_sessions,
      session.session_id,
      nextSummary.state === 'active'
    );

    const agentSummary = normalizeAgentIndexSummary(currentIndex.by_agent[nextSummary.agent_name]);
    agentSummary.latest_session_id = session.session_id;
    agentSummary.latest_branch_id = nextSummary.branch_id;
    agentSummary.branch_ids = moveRecentIdToFront(agentSummary.branch_ids, nextSummary.branch_id, true);
    if (nextSummary.state === 'active') {
      agentSummary.active_session_id = session.session_id;
      agentSummary.active_branch_id = nextSummary.branch_id;
    } else if (agentSummary.active_session_id === session.session_id) {
      const fallbackActiveSession = getMostRecentActiveAgentSession(currentIndex, nextSummary.agent_name, session.session_id);
      agentSummary.active_session_id = fallbackActiveSession ? fallbackActiveSession.session_id : null;
      agentSummary.active_branch_id = fallbackActiveSession ? fallbackActiveSession.branch_id : null;
    }
    currentIndex.by_agent[nextSummary.agent_name] = agentSummary;

    const branchSummary = normalizeBranchIndexSummary(currentIndex.by_branch[nextSummary.branch_id]);
    branchSummary.session_ids = moveRecentIdToFront(branchSummary.session_ids, session.session_id, true);
    branchSummary.latest_session_id = branchSummary.session_ids[0] || session.session_id;
    branchSummary.active_session_ids = moveRecentIdToFront(
      branchSummary.active_session_ids,
      session.session_id,
      nextSummary.state === 'active'
    );
    branchSummary.latest_by_agent = {
      ...branchSummary.latest_by_agent,
      [nextSummary.agent_name]: session.session_id,
    };
    currentIndex.by_branch[nextSummary.branch_id] = branchSummary;

    return writeIndex(currentIndex);
  }

  function writeSessionManifest(session) {
    const filePath = branchPaths.getBranchSessionFile(session.session_id, session.branch_id);
    ensureFileDir(filePath);
    return io.withLock(filePath, () => {
      fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
      return session;
    });
  }

  function appendSessionEvent(type, session, payload = {}) {
    if (!canonicalEventLog) return null;
    return canonicalEventLog.appendEvent({
      type,
      branchId: session.branch_id,
      actorAgent: session.agent_name,
      sessionId: session.session_id,
      payload: {
        state: session.state,
        reason: payload.reason || session.transition_reason || null,
        provider: session.provider || null,
        started_at: session.started_at || null,
        resumed_at: session.resumed_at || null,
        ended_at: session.ended_at || null,
        recovery_snapshot_file: payload.recoverySnapshotFile || session.recovery_snapshot_file || null,
      },
    });
  }

  function activateSession(params = {}) {
    const branchName = params.branchName || 'main';
    const agentName = params.agentName;
    const activatedAt = params.at || now();
    const transitionReason = params.reason || 'register';

    if (!agentName) throw new Error('activateSession requires agentName');

    let latest = getLatestSessionForAgent(branchName, agentName);

    if (latest && latest.state === 'active') {
      latest = transitionSession({
        sessionId: latest.session_id,
        branchName,
        state: 'interrupted',
        reason: params.orphanedReason || 'orphaned_active_recovery',
        at: activatedAt,
      }).session;
    }

    if (latest && latest.state === 'interrupted') {
      const resumedSession = {
        ...latest,
        state: 'active',
        provider: params.provider || latest.provider || null,
        resumed_at: activatedAt,
        ended_at: null,
        updated_at: activatedAt,
        last_activity_at: activatedAt,
        transition_reason: transitionReason,
        recovery_snapshot_file: null,
        resume_count: (Number.isInteger(latest.resume_count) ? latest.resume_count : 0) + 1,
      };

      appendSessionEvent('session.resumed', resumedSession, { reason: transitionReason });
      writeSessionManifest(resumedSession);
      syncIndexForSession(resumedSession, activatedAt);

      return {
        session: resumedSession,
        created: false,
        resumed: true,
        previous_state: latest.state,
      };
    }

    const startedSession = {
      schema_version: SESSION_MANIFEST_SCHEMA_VERSION,
      session_id: params.sessionId || createSessionId(),
      agent_name: agentName,
      branch_id: branchName,
      provider: params.provider || null,
      state: 'active',
      created_at: activatedAt,
      started_at: activatedAt,
      resumed_at: activatedAt,
      ended_at: null,
      updated_at: activatedAt,
      last_activity_at: activatedAt,
      last_heartbeat_at: null,
      transition_reason: transitionReason,
      recovery_snapshot_file: null,
      resume_count: 0,
    };

    appendSessionEvent('session.started', startedSession, { reason: transitionReason });
    writeSessionManifest(startedSession);
    syncIndexForSession(startedSession, activatedAt);

    return {
      session: startedSession,
      created: true,
      resumed: false,
      previous_state: latest ? latest.state : null,
    };
  }

  function touchSession(params = {}) {
    const sessionId = params.sessionId;
    const branchName = params.branchName || 'main';
    const touchedAt = params.at || now();
    if (!sessionId) return { session: null, updated: false };

    const session = readSessionManifest(sessionId, branchName);
    if (!session || session.state !== 'active') {
      return { session, updated: false };
    }

    const touchedSession = {
      ...session,
      last_activity_at: touchedAt,
      updated_at: touchedAt,
      ...(params.heartbeat ? { last_heartbeat_at: touchedAt } : {}),
    };

    writeSessionManifest(touchedSession);
    syncIndexForSession(touchedSession, touchedAt);

    return { session: touchedSession, updated: true };
  }

  function transitionSession(params = {}) {
    const sessionId = params.sessionId;
    const branchName = params.branchName || 'main';
    const nextState = params.state;
    const transitionedAt = params.at || now();

    if (!sessionId) return { session: null, updated: false };
    if (!SESSION_STATES.includes(nextState) || nextState === 'active') {
      throw new Error(`Invalid session transition target: ${String(nextState)}`);
    }

    const session = readSessionManifest(sessionId, branchName);
    if (!session) return { session: null, updated: false };
    if (session.state === nextState) return { session, updated: false };
    if (session.state !== 'active' && nextState !== 'active') return { session, updated: false };

    const transitionedSession = {
      ...session,
      state: nextState,
      ended_at: transitionedAt,
      updated_at: transitionedAt,
      transition_reason: params.reason || session.transition_reason || null,
      recovery_snapshot_file: params.recoverySnapshotFile || session.recovery_snapshot_file || null,
      last_activity_at: session.last_activity_at || transitionedAt,
    };

    appendSessionEvent(TERMINAL_SESSION_EVENTS[nextState], transitionedSession, {
      reason: params.reason,
      recoverySnapshotFile: params.recoverySnapshotFile,
    });
    writeSessionManifest(transitionedSession);
    syncIndexForSession(transitionedSession, transitionedAt);

    return { session: transitionedSession, updated: true };
  }

  function transitionLatestSessionForAgent(params = {}) {
    const branchName = params.branchName || 'main';
    const agentName = params.agentName;
    if (!agentName) return { session: null, updated: false };
    const latest = getLatestSessionForAgent(branchName, agentName);
    if (!latest) return { session: null, updated: false };

    return transitionSession({
      sessionId: latest.session_id,
      branchName,
      state: params.state,
      reason: params.reason,
      at: params.at,
      recoverySnapshotFile: params.recoverySnapshotFile,
    });
  }

  return {
    SESSION_MANIFEST_SCHEMA_VERSION,
    SESSION_INDEX_SCHEMA_VERSION,
    SESSION_STATES,
    activateSession,
    getLatestSessionForAgent,
    getLatestSessionSummaryForAgent,
    getSessionSummary,
    listBranchSessions,
    loadIndex,
    readSessionManifest,
    rebuildIndex,
    summarizeSession,
    touchSession,
    transitionLatestSessionForAgent,
    transitionSession,
  };
}

module.exports = {
  DEFAULT_STALE_THRESHOLD_MS,
  buildSessionSummary,
  SESSION_INDEX_SCHEMA_VERSION,
  SESSION_MANIFEST_SCHEMA_VERSION,
  SESSION_STATES,
  createSessionsState,
};
