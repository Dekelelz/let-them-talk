#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');
const {
  classifyBlockedTaskPolicy,
  classifyRetryPolicy,
  classifyStalledWorkflowStepPolicy,
  planWatchdogActions,
} = require(path.resolve(__dirname, '..', 'autonomy', 'watchdog-policy.js'));
const { resolveAgentDecisionContext } = require(path.resolve(__dirname, '..', 'autonomy', 'decision-v2.js'));
const { resolveAgentContract } = require(path.resolve(__dirname, '..', 'agent-contracts.js'));

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

function isoFromMs(ms) {
  return new Date(ms).toISOString();
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const watchdogBlock = extractBlock(serverSource, 'function watchdogCheck() {', '// --- Monitor Agent: system health check ---');
  const updateTaskBlock = extractBlock(serverSource, 'function toolUpdateTask(taskId, status, notes = null, evidence = null) {', 'function toolListTasks(status = null, assignee = null) {');
  const monitorBlock = extractBlock(serverSource, 'function monitorHealthCheck() {', '// --- Advisor Agent: strategic analysis ---');

  assert(serverSource.includes("require('./autonomy/watchdog-policy')"), 'server.js must load the shared autonomy/watchdog policy helper.', problems);
  assert(watchdogBlock.includes('const watchdogActions = planWatchdogActions({'), 'watchdogCheck() must derive actions from the shared watchdog policy planner.', problems);
  assert(watchdogBlock.includes('canonicalState.setWorkflowStepPolicySignal({'), 'watchdogCheck() must persist workflow-step watchdog signals through canonical state helpers.', problems);
  assert(watchdogBlock.includes("sourceTool: 'watchdog_policy'"), 'watchdogCheck() task transitions must identify the explicit watchdog policy source tool.', problems);
  assert(!serverSource.includes('function reassignWorkFrom('), 'server.js must remove the old raw watchdog reassignment helper seam.', problems);
  assert(!watchdogBlock.includes('step.assignee = replacement'), 'watchdogCheck() must no longer silently assign stalled workflow steps to a replacement agent.', problems);
  assert(!watchdogBlock.includes('task.assignee = null; // Unassign so get_work can claim it'), 'watchdogCheck() must no longer mutate task claims through the old raw reassignment block.', problems);
  assert(!monitorBlock.includes('task.assignee = freshAgents[0]'), 'monitorHealthCheck() must stop acting like a second scheduler by directly assigning fresh agents.', problems);
  assert(updateTaskBlock.includes('const retryPolicy = status === \'pending\''), 'toolUpdateTask() must classify pending-task retry policy explicitly before mutating task state.', problems);
  assert(updateTaskBlock.includes('classifyRetryPolicy({'), 'toolUpdateTask() must use the shared retry policy classifier.', problems);
  assert(!updateTaskBlock.includes("task.status = 'blocked_permanent';"), 'toolUpdateTask() must not mutate blocked_permanent directly via the old raw circuit-breaker branch.', problems);

  const interruptedReviewerContext = resolveAgentDecisionContext({
    agentName: 'qa_agent',
    branchId: 'main',
    sessionSummary: { session_id: 'sess_qa', branch_id: 'main', state: 'interrupted', stale: true },
    contract: resolveAgentContract({ role: 'quality', archetype: 'reviewer', skills: ['testing'] }),
    agentRecord: { runtime_type: 'cli' },
  });
  const activeImageContext = resolveAgentDecisionContext({
    agentName: 'media_bot',
    branchId: 'main',
    sessionSummary: { session_id: 'sess_media', branch_id: 'main', state: 'active', stale: false },
    contract: resolveAgentContract({ archetype: 'implementer', skills: ['media'] }),
    agentRecord: {
      runtime_type: 'api',
      provider_id: 'gemini',
      model_id: 'gemini-image',
      capabilities: ['image_generation'],
    },
  });

  const retryPolicy = classifyRetryPolicy({
    target: {
      work_type: 'task',
      title: 'Render launch poster',
      description: 'Create the image asset for release day',
      assigned: true,
      required_capabilities: ['image_generation'],
    },
    context: interruptedReviewerContext,
    attemptCount: 3,
    ownerAlive: true,
    idleMs: 0,
  });
  assert(retryPolicy.state === 'blocked_permanent', 'Retry policy must block permanently at the bounded attempt limit.', problems);
  assert(retryPolicy.owner_state === 'session_interrupted', 'Retry policy must surface interrupted canonical session state explicitly.', problems);
  assert(retryPolicy.capability_advisory && retryPolicy.capability_advisory.status === 'mismatch', 'Retry policy must keep provider/capability context visible instead of falling back to raw attempt counts only.', problems);

  const blockedPolicy = classifyBlockedTaskPolicy({
    target: {
      work_type: 'task',
      title: 'Recover blocked artifact pipeline',
      description: 'Blocked build artifact repair task',
      assigned: true,
    },
    context: interruptedReviewerContext,
    attemptCount: 2,
    ownerAlive: false,
    idleMs: 0,
    blockedAgeMs: 360000,
  });
  assert(blockedPolicy.signal === 'escalate', 'Blocked-task policy must produce an explicit escalation signal once the bounded window or retry threshold is crossed.', problems);
  assert(blockedPolicy.classification === 'blocked_owner_unavailable', 'Blocked-task policy must classify unavailable owners explicitly from canonical session/aliveness context.', problems);

  const checkinStepPolicy = classifyStalledWorkflowStepPolicy({
    target: {
      work_type: 'workflow_step',
      title: 'Assemble release pack',
      description: 'Launch workflow',
      assigned: true,
      required_capabilities: ['image_generation'],
    },
    context: activeImageContext,
    ownerAlive: true,
    idleMs: 0,
    stepAgeMs: 960000,
    resumeContext: {
      dependency_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_dep' } } }],
      recent_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_recent' } } }],
    },
  });
  assert(checkinStepPolicy.signal === 'checkin', 'Stalled-step policy must request a bounded status check before a full escalation.', problems);
  assert(checkinStepPolicy.dependency_evidence_count === 1 && checkinStepPolicy.recent_evidence_count === 1, 'Stalled-step policy must carry evidence context counts explicitly.', problems);

  const unavailableStepPolicy = classifyStalledWorkflowStepPolicy({
    target: {
      work_type: 'workflow_step',
      title: 'Finalize release',
      description: 'Launch workflow',
      assigned: true,
    },
    context: interruptedReviewerContext,
    ownerAlive: false,
    idleMs: 0,
    stepAgeMs: 60000,
  });
  assert(unavailableStepPolicy.signal === 'escalate', 'Stalled-step policy must escalate immediately when the canonical owner is unavailable.', problems);
  assert(unavailableStepPolicy.classification === 'step_owner_unavailable', 'Unavailable-step policy must be classified explicitly for follow-on 12C handling.', problems);

  const nowMs = Date.UTC(2026, 3, 16, 12, 0, 0);
  const watchdogActions = planWatchdogActions({
    watchdogAgentName: 'alpha',
    branchId: 'main',
    nowMs,
    agents: {
      alpha: { branch: 'main', last_activity: isoFromMs(nowMs - 1000) },
      bravo: { branch: 'main', last_activity: isoFromMs(nowMs - 360000), watchdog_nudged: nowMs - 240000 },
      charlie: { branch: 'main', last_activity: isoFromMs(nowMs - 720000) },
    },
    tasks: [
      {
        id: 'task_blocked',
        title: 'Blocked publish checklist',
        description: 'Wait on blocked release dependency',
        status: 'blocked',
        assignee: 'bravo',
        updated_at: isoFromMs(nowMs - 400000),
        attempt_agents: ['alpha', 'bravo'],
      },
      {
        id: 'task_claim',
        title: 'Recover dead owner claim',
        description: 'Resume from interrupted owner state',
        status: 'in_progress',
        assignee: 'charlie',
        updated_at: isoFromMs(nowMs - 120000),
        attempt_agents: ['charlie'],
      },
    ],
    workflows: [{
      id: 'wf_launch',
      name: 'Launch workflow',
      status: 'active',
      steps: [{
        id: 2,
        description: 'Finalize release notes',
        status: 'in_progress',
        assignee: 'charlie',
        started_at: isoFromMs(nowMs - 1900000),
      }],
    }],
    resolveContext: (agentName) => {
      if (agentName === 'bravo') return activeImageContext;
      if (agentName === 'charlie') return interruptedReviewerContext;
      return resolveAgentDecisionContext({
        agentName,
        branchId: 'main',
        sessionSummary: { session_id: `sess_${agentName}`, branch_id: 'main', state: 'active', stale: false },
        contract: resolveAgentContract({ archetype: 'generalist' }),
        agentRecord: { runtime_type: 'cli' },
      });
    },
    resolveStepResumeContext: () => ({
      dependency_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_dep' } } }],
      recent_evidence: [],
    }),
    isAgentAlive: (agentName) => agentName !== 'charlie',
  });

  assert(watchdogActions.some((action) => action.kind === 'nudge_idle_hard' && action.agentName === 'bravo'), 'Watchdog planner must emit explicit hard-idle nudges deterministically.', problems);
  assert(watchdogActions.some((action) => action.kind === 'escalate_blocked_task' && action.taskId === 'task_blocked'), 'Watchdog planner must escalate blocked tasks through explicit policy actions.', problems);
  assert(watchdogActions.some((action) => action.kind === 'release_task_claim' && action.taskId === 'task_claim'), 'Watchdog planner must release interrupted/dead task claims without assigning a replacement.', problems);
  assert(watchdogActions.some((action) => action.kind === 'signal_stalled_step' && action.workflowId === 'wf_launch' && action.signal === 'escalate'), 'Watchdog planner must surface stalled workflow steps as explicit escalation signals.', problems);
  assert(!watchdogActions.some((action) => String(action.kind || '').includes('reassign')), 'Watchdog planner must not emit broad reassignment actions in the 12B policy-only slice.', problems);
  assert(!watchdogActions.some((action) => String(action.kind || '').includes('assign')), 'Watchdog planner must not silently assign new owners in the 12B policy-only slice.', problems);

  if (problems.length > 0) {
    fail(['Autonomy-v2 watchdog policy validation failed.', ...problems.map((problem) => `- ${problem}`)]);
  }

  console.log([
    'Autonomy-v2 watchdog policy validation passed.',
    '- Watchdog and retry policy now flow through a shared classifier/planner instead of raw server-side mutation seams.',
    '- Retry, blocked-task, and stalled-step decisions all carry explicit session, contract, capability, and evidence context.',
    '- Dead/interrupted ownership now releases task claims or emits escalation signals without broad silent reassignment.',
    '- Monitor health reporting consumes the same policy planner and no longer acts like a second scheduler.',
  ].join('\n'));
}

main();
