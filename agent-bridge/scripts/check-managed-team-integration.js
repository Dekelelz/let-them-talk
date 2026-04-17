#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { resolveAgentContract } = require(path.resolve(__dirname, '..', 'agent-contracts.js'));
const {
  MANAGED_TEAM_HOOK_TOPICS,
  buildManagedTeamContractContext,
  readManagedTeamHookDigest,
} = require(path.resolve(__dirname, '..', 'managed-team-integration.js'));

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');

function fail(lines, exitCode = 1) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function extractBlock(source, startAnchor, endAnchor) {
  const startIndex = source.indexOf(startAnchor);
  if (startIndex === -1) return '';
  const endIndex = endAnchor ? source.indexOf(endAnchor, startIndex + startAnchor.length) : source.length;
  if (endIndex === -1) return source.slice(startIndex);
  return source.slice(startIndex, endIndex);
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');

  const claimManagerBlock = extractBlock(serverSource, 'function toolClaimManager() {', 'function toolYieldFloor(to, prompt = null) {');
  const yieldFloorBlock = extractBlock(serverSource, 'function toolYieldFloor(to, prompt = null) {', 'function toolSetPhase(phase) {');
  const setPhaseBlock = extractBlock(serverSource, 'function toolSetPhase(phase) {', '// Deterministic stagger delay based on agent name');
  const listenGroupBlock = extractBlock(serverSource, 'function buildListenGroupResponse(batch, consumed, agentName, listenStart) {', 'function toolGetHistory(limit = 50, thread_id = null) {');
  const getBriefingBlock = extractBlock(serverSource, 'function toolGetBriefing() {', 'function toolLockFile(filePath) {');
  const attachSignalsBlock = extractBlock(serverSource, 'function attachManagedTeamSurfaceSignals(result, options = {}) {', '// --- Autonomy Engine tools ---');

  assert(serverSource.includes("require('./managed-team-integration')"), 'server.js must load the shared managed/team integration helper.', problems);
  assert(attachSignalsBlock.includes('buildManagedTeamContractContext('), 'Managed/team server helper must derive contract signals through the shared managed/team contract helper.', problems);
  assert(attachSignalsBlock.includes('readManagedTeamHookDigest('), 'Managed/team server helper must derive coordination hooks through the shared hook helper.', problems);
  assert(claimManagerBlock.includes("buildManagedTeamContractContext(contract, 'claim_manager')"), 'claim_manager must reuse the shared managed/team contract helper.', problems);
  assert(claimManagerBlock.includes("code: 'contract_violation'"), 'claim_manager must return an explicit contract_violation code when the trusted manager gate blocks.', problems);
  assert(yieldFloorBlock.includes('attachManagedTeamSurfaceSignals('), 'yield_floor must reuse the shared managed/team signal helper.', problems);
  assert(setPhaseBlock.includes('attachManagedTeamSurfaceSignals('), 'set_phase must reuse the shared managed/team signal helper.', problems);
  assert(listenGroupBlock.includes('attachManagedTeamSurfaceSignals(result,'), 'listen_group responses must reuse the shared managed/team signal helper.', problems);
  assert(getBriefingBlock.includes('attachManagedTeamSurfaceSignals(result,'), 'get_briefing must reuse the shared managed/team signal helper.', problems);
  assert(!yieldFloorBlock.includes('canonicalState.readBranchHooks('), 'yield_floor must not duplicate direct hook reads when the shared managed/team helper exists.', problems);
  assert(!setPhaseBlock.includes('canonicalState.readBranchHooks('), 'set_phase must not duplicate direct hook reads when the shared managed/team helper exists.', problems);
  assert(!listenGroupBlock.includes('canonicalState.readBranchHooks('), 'listen_group must not duplicate direct hook reads when the shared managed/team helper exists.', problems);
  assert(!getBriefingBlock.includes('canonicalState.readBranchHooks('), 'get_briefing must not duplicate direct hook reads when the shared managed/team helper exists.', problems);

  const alignedManager = buildManagedTeamContractContext(
    resolveAgentContract({ role: 'manager', archetype: 'coordinator', contract_mode: 'strict' }),
    'claim_manager'
  );
  assert(alignedManager && alignedManager.contract_advisory && alignedManager.contract_advisory.status === 'aligned', 'Coordinator manager claims should stay aligned under the shared contract helper.', problems);
  assert(!alignedManager.contract_violation, 'Aligned manager claims must not surface a contract violation.', problems);

  const advisoryManager = buildManagedTeamContractContext(
    resolveAgentContract({ archetype: 'advisor', contract_mode: 'advisory' }),
    'claim_manager'
  );
  assert(advisoryManager && advisoryManager.contract_violation && advisoryManager.contract_violation.status === 'warning', 'Advisory-only manager mismatches must remain warnings instead of hard blocks.', problems);

  const strictAdvisorManager = buildManagedTeamContractContext(
    resolveAgentContract({ archetype: 'advisor', contract_mode: 'strict' }),
    'claim_manager'
  );
  assert(strictAdvisorManager && strictAdvisorManager.contract_violation && strictAdvisorManager.contract_violation.status === 'blocked', 'Strict advisor manager claims must block at the trusted manager gate.', problems);
  assert(strictAdvisorManager && strictAdvisorManager.contract_violation && strictAdvisorManager.contract_violation.message.includes('Strict contract mismatch'), 'Strict manager-gate contract blocks must explain that the block comes from a strict mismatch.', problems);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-managed-team-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'managed_team';
  const canonicalState = createCanonicalState({ dataDir, processPid: 6111 });

  try {
    fs.mkdirSync(dataDir, { recursive: true });

    const modeEvent = canonicalState.appendCanonicalEvent({
      type: 'conversation.mode_updated',
      branchId: branchName,
      actorAgent: 'manager',
      sessionId: 'session_manager',
      correlationId: branchName,
      payload: {
        mode: 'managed',
        previous_mode: 'group',
        updated_at: '2026-04-16T20:00:00.000Z',
      },
    });
    const phaseEvent = canonicalState.appendCanonicalEvent({
      type: 'conversation.phase_updated',
      branchId: branchName,
      actorAgent: 'manager',
      sessionId: 'session_manager',
      correlationId: branchName,
      payload: {
        phase: 'execution',
        previous_phase: 'planning',
        floor: 'execution',
        updated_at: '2026-04-16T20:00:05.000Z',
      },
    });
    const stepEvent = canonicalState.appendCanonicalEvent({
      type: 'workflow.step_started',
      branchId: branchName,
      actorAgent: 'manager',
      sessionId: 'session_manager',
      correlationId: 'wf_demo',
      payload: {
        workflow_id: 'wf_demo',
        workflow_name: 'Demo workflow',
        step_id: 2,
        assignee: 'builder',
        started_at: '2026-04-16T20:00:10.000Z',
      },
    });
    const reviewEvent = canonicalState.appendCanonicalEvent({
      type: 'review.requested',
      branchId: branchName,
      actorAgent: 'builder',
      sessionId: 'session_builder',
      correlationId: 'rev_demo',
      payload: {
        review_id: 'rev_demo',
        file: 'agent-bridge/server.js',
        requested_by: 'builder',
        status: 'pending',
      },
    });

    const digest = readManagedTeamHookDigest(canonicalState.readBranchHooks, branchName, { limit: 3 });
    assert(digest && digest.source === 'derived_post_commit_hooks', 'Managed/team hook digest must stay explicitly derived and post-commit.', problems);
    assert(digest && digest.branch === branchName, 'Managed/team hook digest must stay branch-scoped.', problems);
    assert(digest && Array.isArray(digest.recent) && digest.recent.length === 3, 'Managed/team hook digest must respect deterministic hook limits.', problems);
    assert(digest && digest.topics.every((topic) => MANAGED_TEAM_HOOK_TOPICS.includes(topic)), 'Managed/team hook digest must stay on the shared managed/team topic allowlist.', problems);
    assert(digest && digest.recent[0].event_id === phaseEvent.event_id, 'Managed/team hook digest must preserve canonical ordering for limited hook views.', problems);
    assert(digest && digest.recent[1].event_id === stepEvent.event_id, 'Managed/team hook digest must include workflow coordination events.', problems);
    assert(digest && digest.recent[2].event_id === reviewEvent.event_id, 'Managed/team hook digest must include review coordination events.', problems);
    assert(digest && digest.recent[0].summary.includes('execution'), 'Managed/team hook summaries must expose deterministic coordination-friendly descriptions.', problems);
    assert(modeEvent && reviewEvent, 'Fixture canonical events for managed/team integration must be created successfully.', problems);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail(['Managed/team integration validation failed.', ...problems.map((problem) => `- ${problem}`)]);
  }

  console.log([
    'Managed/team integration validation passed.',
    '- Managed/team coordination surfaces reuse one shared helper for advisory contract signals and derived hook digests.',
    '- claim_manager keeps strict hard blocking limited to explicit manager-gate mismatches while broader managed/team surfaces remain advisory.',
    '- Derived hook digests stay branch-scoped, post-commit, and limited to the shared managed/team topic set.',
  ].join('\n'));
}

main();
