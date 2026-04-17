#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { createStateIo } = require(path.resolve(__dirname, '..', 'state', 'io.js'));
const { createSessionsState } = require(path.resolve(__dirname, '..', 'state', 'sessions.js'));

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function sessionTypesForAgent(eventLog, branchName, agentName) {
  return eventLog
    .readBranchEvents(branchName, { typePrefix: 'session.' })
    .filter((event) => event.actor_agent === agentName)
    .map((event) => event.type);
}

function main() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-session-lifecycle-'));
  const dataDir = path.join(tempDir, '.agent-bridge');
  const branchPaths = createBranchPathResolvers(dataDir);
  const io = createStateIo({ dataDir });
  const eventLog = createCanonicalEventLog({ dataDir });
  const sessionsState = createSessionsState({ io, branchPaths, canonicalEventLog: eventLog });

  const times = {
    alphaRegister: '2026-04-16T01:00:00.000Z',
    alphaHeartbeat: '2026-04-16T01:00:10.000Z',
    alphaSwitchAway: '2026-04-16T01:00:20.000Z',
    alphaFeatureStart: '2026-04-16T01:00:30.000Z',
    alphaFeatureTouch: '2026-04-16T01:00:40.000Z',
    alphaDeadSnapshot: '2026-04-16T01:00:50.000Z',
    alphaResume: '2026-04-16T01:01:00.000Z',
    alphaGracefulExit: '2026-04-16T01:01:10.000Z',
    alphaFreshStart: '2026-04-16T01:01:20.000Z',
    betaStart: '2026-04-16T01:01:30.000Z',
    betaResume: '2026-04-16T01:01:40.000Z',
    rebuildIndex: '2026-04-16T01:01:50.000Z',
  };

  const problems = [];

  try {
    const alphaMain = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: 'main',
      provider: 'claude',
      reason: 'register',
      at: times.alphaRegister,
    });
    const alphaMainId = alphaMain.session.session_id;

    sessionsState.touchSession({
      sessionId: alphaMainId,
      branchName: 'main',
      at: times.alphaHeartbeat,
      heartbeat: true,
    });

    sessionsState.transitionSession({
      sessionId: alphaMainId,
      branchName: 'main',
      state: 'interrupted',
      reason: 'branch_switch',
      at: times.alphaSwitchAway,
    });

    const alphaFeature = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: 'feature_task5a',
      provider: 'claude',
      reason: 'branch_activate',
      at: times.alphaFeatureStart,
    });
    const alphaFeatureId = alphaFeature.session.session_id;

    sessionsState.touchSession({
      sessionId: alphaFeatureId,
      branchName: 'feature_task5a',
      at: times.alphaFeatureTouch,
    });

    const alphaInterrupted = sessionsState.transitionLatestSessionForAgent({
      agentName: 'alpha',
      branchName: 'feature_task5a',
      state: 'interrupted',
      reason: 'dead_agent_snapshot',
      recoverySnapshotFile: 'recovery-alpha.json',
      at: times.alphaDeadSnapshot,
    });

    const alphaResumed = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: 'feature_task5a',
      provider: 'claude',
      reason: 'register',
      at: times.alphaResume,
    });

    sessionsState.transitionSession({
      sessionId: alphaResumed.session.session_id,
      branchName: 'feature_task5a',
      state: 'completed',
      reason: 'graceful_exit',
      recoverySnapshotFile: 'recovery-alpha.json',
      at: times.alphaGracefulExit,
    });

    const alphaFresh = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: 'feature_task5a',
      provider: 'claude',
      reason: 'register',
      at: times.alphaFreshStart,
    });

    const betaStart = sessionsState.activateSession({
      agentName: 'beta',
      branchName: 'main',
      provider: 'gemini',
      reason: 'register',
      at: times.betaStart,
    });

    const betaResume = sessionsState.activateSession({
      agentName: 'beta',
      branchName: 'main',
      provider: 'gemini',
      reason: 'register',
      at: times.betaResume,
    });

    const alphaMainManifest = readJson(branchPaths.getBranchSessionFile(alphaMainId, 'main'));
    const alphaFeatureManifest = readJson(branchPaths.getBranchSessionFile(alphaFeatureId, 'feature_task5a'));
    const alphaFreshManifest = readJson(branchPaths.getBranchSessionFile(alphaFresh.session.session_id, 'feature_task5a'));
    const betaManifest = readJson(branchPaths.getBranchSessionFile(betaStart.session.session_id, 'main'));
    const indexFile = branchPaths.getSessionsIndexFile();
    const index = readJson(indexFile);

    assert(alphaMain.created && !alphaMain.resumed, 'Initial register should create a main-branch session for alpha.', problems);
    assert(alphaMainManifest.state === 'interrupted', 'Switching branches should interrupt alpha\'s main-branch session.', problems);
    assert(alphaMainManifest.transition_reason === 'branch_switch', 'Main-branch interruption should record the branch_switch reason.', problems);
    assert(alphaMainManifest.last_heartbeat_at === times.alphaHeartbeat, 'Heartbeat touch should update the session heartbeat timestamp.', problems);

    assert(alphaFeature.created && !alphaFeature.resumed, 'First feature-branch activation should create a fresh branch-local session.', problems);
    assert(alphaInterrupted.session && alphaInterrupted.session.state === 'interrupted', 'Dead-agent snapshot should mark the active feature session interrupted.', problems);
    assert(alphaInterrupted.session && alphaInterrupted.session.recovery_snapshot_file === 'recovery-alpha.json', 'Dead-agent interruption should retain the recovery snapshot reference.', problems);

    assert(alphaResumed.resumed, 'Registering again on the same interrupted branch should resume the feature session.', problems);
    assert(alphaResumed.session.session_id === alphaFeatureId, 'Branch-local resume should reuse the interrupted feature session id.', problems);
    assert(alphaFeatureManifest.state === 'completed', 'Graceful exit should mark the resumed feature session completed.', problems);
    assert(alphaFeatureManifest.resume_count === 1, 'Feature session should record one resume after interruption.', problems);
    assert(alphaFeatureManifest.transition_reason === 'graceful_exit', 'Graceful completion should keep the graceful_exit reason.', problems);

    assert(alphaFresh.created && !alphaFresh.resumed, 'Registering after a completed session should create a new feature session.', problems);
    assert(alphaFresh.session.session_id !== alphaFeatureId, 'Completed sessions must not be resumed as the next live interval.', problems);
    assert(alphaFreshManifest.state === 'active', 'Fresh post-completion session should be active.', problems);

    assert(betaStart.created && !betaStart.resumed, 'Beta should start with a new main-branch session.', problems);
    assert(betaResume.resumed, 'An orphaned active session should be reclaimed by interrupt+resume on register.', problems);
    assert(betaResume.session.session_id === betaStart.session.session_id, 'Orphaned active recovery should reuse the same beta session id.', problems);
    assert(betaManifest.resume_count === 1, 'Recovered orphaned beta session should record one resume.', problems);

    assert(fs.existsSync(indexFile), 'Session discovery index should be written under runtime/projections.', problems);
    assert(index.sessions[alphaMainId] && index.sessions[alphaFeatureId] && index.sessions[alphaFresh.session.session_id], 'Index should contain every session summary.', problems);
    assert(index.by_agent.alpha && index.by_agent.alpha.active_session_id === alphaFresh.session.session_id, 'Index should point alpha to the latest active branch session.', problems);
    assert(index.by_branch.feature_task5a && index.by_branch.feature_task5a.active_session_ids.includes(alphaFresh.session.session_id), 'Index should expose the active feature-branch session.', problems);

    fs.unlinkSync(indexFile);
    const rebuiltIndex = sessionsState.rebuildIndex({ at: times.rebuildIndex });
    assert(rebuiltIndex.sessions[alphaFeatureId] && rebuiltIndex.sessions[alphaFeatureId].state === 'completed', 'Rebuilt index should recover completed feature-session state from manifests.', problems);
    assert(rebuiltIndex.by_agent.alpha.active_session_id === alphaFresh.session.session_id, 'Rebuilt index should restore the latest active alpha session.', problems);

    const alphaMainEvents = sessionTypesForAgent(eventLog, 'main', 'alpha');
    const alphaFeatureEvents = sessionTypesForAgent(eventLog, 'feature_task5a', 'alpha');
    const betaEvents = sessionTypesForAgent(eventLog, 'main', 'beta');

    assert(JSON.stringify(alphaMainEvents) === JSON.stringify(['session.started', 'session.interrupted']), 'Main branch should log start+interrupt events for alpha.', problems);
    assert(JSON.stringify(alphaFeatureEvents) === JSON.stringify(['session.started', 'session.interrupted', 'session.resumed', 'session.completed', 'session.started']), 'Feature branch should log the full alpha lifecycle sequence.', problems);
    assert(JSON.stringify(betaEvents) === JSON.stringify(['session.started', 'session.interrupted', 'session.resumed']), 'Main branch should log orphaned-active recovery for beta as start+interrupt+resume.', problems);

    if (problems.length > 0) {
      fail(['Session lifecycle validation failed.', ...problems], 1);
    }

    console.log([
      'Session lifecycle validation passed.',
      'Validated branch-scoped session creation, heartbeat activity, branch interruption, dead-agent interruption, resume, graceful completion, orphaned-active recovery, and index rebuild.',
      `Index file: .agent-bridge/${path.relative(dataDir, indexFile).split(path.sep).join('/')}`,
    ].join('\n'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
