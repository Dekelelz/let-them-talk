#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { createStateIo } = require(path.resolve(__dirname, '..', 'state', 'io.js'));
const { createSessionsState } = require(path.resolve(__dirname, '..', 'state', 'sessions.js'));

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeTarget(filePath) {
  return typeof filePath === 'string' ? path.resolve(filePath) : filePath;
}

function withBlockedReadFileSync(blockedFiles, fn) {
  const blocked = new Set(blockedFiles.map(normalizeTarget));
  const originalReadFileSync = fs.readFileSync;

  fs.readFileSync = function patchedReadFileSync(filePath, ...args) {
    if (blocked.has(normalizeTarget(filePath))) {
      throw new Error(`Blocked readFileSync for hot-path validation: ${filePath}`);
    }
    return originalReadFileSync.call(this, filePath, ...args);
  };

  try {
    return fn();
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
}

function withBlockedReaddirSync(blockedDirs, fn) {
  const blocked = new Set(blockedDirs.map(normalizeTarget));
  const originalReaddirSync = fs.readdirSync;

  fs.readdirSync = function patchedReaddirSync(dirPath, ...args) {
    if (blocked.has(normalizeTarget(dirPath))) {
      throw new Error(`Blocked readdirSync for hot-path validation: ${dirPath}`);
    }
    return originalReaddirSync.call(this, dirPath, ...args);
  };

  try {
    return fn();
  } finally {
    fs.readdirSync = originalReaddirSync;
  }
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-performance-indexing-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_perf_index';
  const secondaryBranchName = 'feature_perf_index_secondary';
  const problems = [];

  try {
    const branchPaths = createBranchPathResolvers(dataDir);
    const io = createStateIo({ dataDir });
    const eventLog = createCanonicalEventLog({ dataDir });
    const sessionsState = createSessionsState({ io, branchPaths, canonicalEventLog: eventLog });
    const canonicalState = createCanonicalState({ dataDir, processPid: process.pid });

    eventLog.appendEvent({
      type: 'session.started',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'sess_perf_alpha',
      occurredAt: '2026-04-16T23:20:00.000Z',
      payload: {
        state: 'active',
        reason: 'validator_setup',
      },
    });
    const secondEvent = eventLog.appendEvent({
      type: 'session.resumed',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'sess_perf_alpha',
      occurredAt: '2026-04-16T23:20:05.000Z',
      payload: {
        state: 'active',
        reason: 'validator_setup',
      },
    });

    const eventFile = eventLog.getBranchEventsFile(branchName);
    const headFile = eventLog.getBranchEventsHeadFile(branchName);
    fs.unlinkSync(headFile);

    const coldHeadLog = createCanonicalEventLog({ dataDir });
    let repairedHead = null;
    withBlockedReadFileSync([eventFile], () => {
      repairedHead = coldHeadLog.getEventsHead({
        stream: 'branch',
        branchId: branchName,
        at: '2026-04-16T23:20:06.000Z',
      });
    });

    assert(repairedHead && repairedHead.last_seq === secondEvent.seq, 'Event heads should rebuild from the stream tail without a full event-file read when the head is missing.', problems);
    assert(repairedHead && repairedHead.event_count === secondEvent.seq, 'Tail-repaired event heads should preserve the monotonic branch event count.', problems);

    fs.unlinkSync(headFile);
    const coldAppendLog = createCanonicalEventLog({ dataDir });
    let thirdEvent = null;
    withBlockedReadFileSync([eventFile], () => {
      thirdEvent = coldAppendLog.appendEvent({
        type: 'session.completed',
        branchId: branchName,
        actorAgent: 'alpha',
        sessionId: 'sess_perf_alpha',
        occurredAt: '2026-04-16T23:20:10.000Z',
        payload: {
          state: 'completed',
          reason: 'validator_setup',
        },
      });
    });
    assert(thirdEvent && thirdEvent.seq === secondEvent.seq + 1, 'Event append should derive the next seq from tail/head metadata without rescanning the branch log.', problems);

    const generalMessage = {
      id: 'msg_perf_general',
      from: 'alpha',
      to: 'beta',
      content: 'General projection baseline',
      timestamp: '2026-04-16T23:21:00.000Z',
    };
    const labMessage = {
      id: 'msg_perf_lab',
      from: 'beta',
      to: 'alpha',
      channel: 'lab',
      content: 'Lab query needle',
      timestamp: '2026-04-16T23:21:10.000Z',
    };

    canonicalState.appendMessage(generalMessage, { branch: branchName });
    canonicalState.appendScopedMessage(labMessage, { branch: branchName, channel: 'lab' });
    writeJson(branchPaths.getChannelsFile(branchName), {
      general: {
        description: 'General channel',
        members: ['*'],
      },
      lab: {
        description: 'Perf validator lab channel',
        members: ['alpha', 'beta'],
      },
    });
    writeJson(branchPaths.getAcksFile(branchName), {
      [generalMessage.id]: true,
      [labMessage.id]: true,
    });

    const initialConversation = canonicalState.getConversationMessages({ branch: branchName });
    const projectionFile = branchPaths.getBranchDashboardProjectionFile(branchName);
    assert(initialConversation.length === 2, 'Dashboard conversation projection should merge general and non-general branch history.', problems);
    assert(fs.existsSync(projectionFile), 'Dashboard branch queries should persist a branch-scoped merged-history projection file.', problems);

    const historyFile = branchPaths.getHistoryFile(branchName);
    const channelHistoryFile = branchPaths.getChannelHistoryFile('lab', branchName);
    let cachedConversation = null;
    let cachedChannels = null;
    let cachedSearch = null;
    withBlockedReadFileSync([historyFile, channelHistoryFile], () => {
      cachedConversation = canonicalState.getConversationMessages({ branch: branchName });
      cachedChannels = canonicalState.getChannelsView({ branch: branchName });
      cachedSearch = canonicalState.getSearchResultsView({
        branch: branchName,
        query: 'query needle',
        limit: 10,
      });
    });

    assert(Array.isArray(cachedConversation) && cachedConversation.length === 2, 'Cached dashboard conversation reads should succeed from the shared projection without rereading branch history files.', problems);
    assert(cachedChannels && cachedChannels.lab && cachedChannels.lab.message_count === 1, 'Cached dashboard channel queries should preserve branch-local channel counts from the shared projection.', problems);
    assert(Array.isArray(cachedSearch) && cachedSearch.length === 1 && cachedSearch[0].id === labMessage.id, 'Cached dashboard search should reuse the shared merged projection and stay branch-local.', problems);

    fs.unlinkSync(projectionFile);
    const rebuiltConversation = canonicalState.getConversationMessages({ branch: branchName });
    assert(Array.isArray(rebuiltConversation) && rebuiltConversation.length === 2 && fs.existsSync(projectionFile), 'Dashboard query projection should rebuild cleanly when the branch projection file is missing.', problems);

    const activation = sessionsState.activateSession({
      agentName: 'alpha',
      branchName,
      provider: 'claude',
      reason: 'register',
      at: '2026-04-16T23:22:00.000Z',
    });
    sessionsState.touchSession({
      sessionId: activation.session.session_id,
      branchName,
      at: '2026-04-16T23:22:10.000Z',
      heartbeat: true,
    });

    const secondaryActivation = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: secondaryBranchName,
      provider: 'claude',
      reason: 'branch_switch',
      at: '2026-04-16T23:22:20.000Z',
    });

    const indexFile = branchPaths.getSessionsIndexFile();
    const indexRaw = fs.readFileSync(indexFile, 'utf8');
    const index = JSON.parse(indexRaw);
    assert(!indexRaw.includes('\n'), 'Session index writes should stay compact on hot heartbeat/touch paths to reduce churn.', problems);
    assert(index.by_agent.alpha && index.by_agent.alpha.latest_branch_id === secondaryBranchName, 'Session index should track the latest branch per agent for hot resume lookups.', problems);
    assert(index.by_agent.alpha && index.by_agent.alpha.active_session_id === secondaryActivation.session.session_id && index.by_agent.alpha.active_branch_id === secondaryBranchName, 'Session index should point agent-level active session metadata at the latest active branch session.', problems);
    assert(index.by_branch[branchName] && index.by_branch[branchName].latest_by_agent && index.by_branch[branchName].latest_by_agent.alpha === activation.session.session_id, 'Session index should expose the latest session id per branch+agent.', problems);
    assert(index.by_branch[secondaryBranchName] && index.by_branch[secondaryBranchName].latest_by_agent && index.by_branch[secondaryBranchName].latest_by_agent.alpha === secondaryActivation.session.session_id, 'Session index should expose the latest session id for newly activated secondary branches.', problems);

    sessionsState.transitionSession({
      sessionId: secondaryActivation.session.session_id,
      branchName: secondaryBranchName,
      state: 'interrupted',
      reason: 'secondary_branch_paused',
      at: '2026-04-16T23:22:30.000Z',
    });

    const repointedIndex = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
    assert(repointedIndex.by_agent.alpha && repointedIndex.by_agent.alpha.active_session_id === activation.session.session_id && repointedIndex.by_agent.alpha.active_branch_id === branchName, 'Session index should repoint the agent active-session pointer to another still-active branch session instead of clearing it.', problems);

    const sessionsDir = branchPaths.getBranchSessionsDir(branchName);
    let latestSession = null;
    let latestSummary = null;
    let exactSummary = null;
    withBlockedReaddirSync([sessionsDir], () => {
      latestSession = sessionsState.getLatestSessionForAgent(branchName, 'alpha');
      latestSummary = sessionsState.getLatestSessionSummaryForAgent(branchName, 'alpha', {
        indexedAt: '2026-04-16T23:22:15.000Z',
      });
      exactSummary = sessionsState.getSessionSummary(activation.session.session_id, branchName, {
        indexedAt: '2026-04-16T23:22:15.000Z',
      });
    });

    assert(latestSession && latestSession.session_id === activation.session.session_id, 'Latest session manifest lookup should resolve from the session index without rescanning the branch sessions directory.', problems);
    assert(latestSummary && latestSummary.session_id === activation.session.session_id, 'Latest session summary lookup should resolve from the session index hot path.', problems);
    assert(exactSummary && exactSummary.session_id === activation.session.session_id && exactSummary.last_heartbeat_at === '2026-04-16T23:22:10.000Z', 'Direct session summary lookup should reuse indexed summary state before falling back to the manifest.', problems);

    if (problems.length > 0) {
      fail(['Performance/indexing validation failed.', ...problems.map((problem) => `- ${problem}`)], 1);
    }

    console.log([
      'Performance/indexing validation passed.',
      'Validated tail-based canonical event-head repair, branch-scoped dashboard query projection reuse/rebuild, and session-index-driven hot lookups with compact touch-path index writes.',
    ].join('\n'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
