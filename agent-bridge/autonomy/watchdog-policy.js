const { analyzeContractFit } = require('../agent-contracts');
const { analyzeCapabilityFit, evaluateAutonomyCandidate } = require('./decision-v2');

const WATCHDOG_POLICY_THRESHOLDS = Object.freeze({
  idle_nudge_ms: 120000,
  idle_hard_nudge_ms: 300000,
  dead_claim_release_ms: 600000,
  blocked_escalation_ms: 300000,
  step_ping_ms: 900000,
  step_escalation_ms: 1800000,
  retry_escalation_attempts: 2,
  retry_blocked_permanent_attempts: 3,
});

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function resolveThresholds(overrides = {}) {
  return {
    ...WATCHDOG_POLICY_THRESHOLDS,
    ...(overrides && typeof overrides === 'object' ? overrides : {}),
  };
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function serializeAdvisory(advisory) {
  if (!advisory || typeof advisory !== 'object') return null;
  return cloneJson(advisory);
}

function resolveOwnerState(context = {}, ownerAlive = true, idleMs = 0, thresholds = WATCHDOG_POLICY_THRESHOLDS) {
  const sessionSummary = context && context.session_summary && typeof context.session_summary === 'object'
    ? context.session_summary
    : null;

  if (!ownerAlive) return 'dead';
  if (sessionSummary && sessionSummary.state && sessionSummary.state !== 'active') {
    return `session_${sessionSummary.state}`;
  }
  if (sessionSummary && sessionSummary.stale) return 'session_stale';
  if (idleMs >= thresholds.idle_hard_nudge_ms) return 'idle_hard';
  if (idleMs >= thresholds.idle_nudge_ms) return 'idle';
  return 'active';
}

function buildWorkTarget(params = {}) {
  return {
    work_type: params.work_type || 'task',
    title: normalizeText(params.title) || '',
    description: normalizeText(params.description) || '',
    assigned: !!params.assigned,
    required_capabilities: Array.isArray(params.required_capabilities) ? [...params.required_capabilities] : [],
    preferred_capabilities: Array.isArray(params.preferred_capabilities) ? [...params.preferred_capabilities] : [],
  };
}

function compareOwnershipCandidates(left, right) {
  const leftScore = left && left.evaluation ? left.evaluation.score || 0 : 0;
  const rightScore = right && right.evaluation ? right.evaluation.score || 0 : 0;
  if (rightScore !== leftScore) return rightScore - leftScore;

  const leftName = left && left.agent_name ? left.agent_name : '';
  const rightName = right && right.agent_name ? right.agent_name : '';
  return leftName.localeCompare(rightName);
}

function canTransferStalledStepOwnership(policy) {
  return !!(
    policy
    && policy.signal === 'escalate'
    && policy.classification === 'step_owner_unavailable'
  );
}

function planStalledStepOwnershipChange(params = {}) {
  const branchId = normalizeText(params.branchId) || 'main';
  const currentAssignee = normalizeText(params.currentAssignee) || null;
  const watchdogAgentName = normalizeText(params.watchdogAgentName) || null;
  const policy = params.policy && typeof params.policy === 'object' ? params.policy : null;
  const target = buildWorkTarget(params.target && typeof params.target === 'object' ? params.target : params);
  const selectionTarget = {
    ...target,
    assigned: false,
    assignment_priority: 'none',
  };
  const agents = params.agents && typeof params.agents === 'object' ? params.agents : {};
  const resolveContext = typeof params.resolveContext === 'function' ? params.resolveContext : (() => ({}));
  const isAgentAlive = typeof params.isAgentAlive === 'function'
    ? params.isAgentAlive
    : ((_name, agent) => !!agent);
  const rejectedCandidates = [];
  const eligibleCandidates = [];

  if (!canTransferStalledStepOwnership(policy)) {
    return {
      allowed: false,
      classification: 'ownership_change_blocked',
      reason: 'policy_disallows_transfer',
      branch_id: branchId,
      current_assignee: currentAssignee,
      new_assignee: null,
      policy: cloneJson(policy),
      eligible_candidates: [],
      rejected_candidates: [],
      summary: 'Ownership transfer stays blocked until the stalled-step policy explicitly marks the owner unavailable.',
    };
  }

  for (const [agentName, agentRecord] of Object.entries(agents)) {
    if (!agentRecord) continue;

    if (agentName === currentAssignee) {
      rejectedCandidates.push({ agent_name: agentName, reason: 'current_owner' });
      continue;
    }
    if (watchdogAgentName && agentName === watchdogAgentName) {
      rejectedCandidates.push({ agent_name: agentName, reason: 'watchdog_agent' });
      continue;
    }

    const agentBranch = normalizeText(agentRecord.branch) || branchId;
    if (agentBranch !== branchId) {
      rejectedCandidates.push({ agent_name: agentName, reason: 'branch_mismatch', branch_id: agentBranch });
      continue;
    }

    if (!isAgentAlive(agentName, agentRecord)) {
      rejectedCandidates.push({ agent_name: agentName, reason: 'agent_unavailable' });
      continue;
    }

    const evaluation = evaluateAutonomyCandidate({ target: selectionTarget }, resolveContext(agentName, branchId));
    if (!evaluation.capability_advisory || !evaluation.capability_advisory.admissible) {
      rejectedCandidates.push({
        agent_name: agentName,
        reason: evaluation.capability_advisory && evaluation.capability_advisory.status === 'blocked'
          ? 'required_capability_unavailable'
          : 'capability_mismatch',
      });
      continue;
    }
    if (evaluation.contract_admissibility && evaluation.contract_admissibility.admissible === false) {
      rejectedCandidates.push({
        agent_name: agentName,
        reason: evaluation.contract_admissibility.reason || 'contract_mismatch',
      });
      continue;
    }

    eligibleCandidates.push({
      agent_name: agentName,
      branch_id: agentBranch,
      evaluation,
    });
  }

  eligibleCandidates.sort(compareOwnershipCandidates);
  const selected = eligibleCandidates[0] || null;

  if (!selected) {
    return {
      allowed: false,
      classification: 'ownership_change_blocked',
      reason: 'no_eligible_replacement',
      branch_id: branchId,
      current_assignee: currentAssignee,
      new_assignee: null,
      policy: cloneJson(policy),
      eligible_candidates: [],
      rejected_candidates: rejectedCandidates,
      summary: 'Ownership transfer stayed blocked because no same-branch replacement satisfied the current capability and strict-contract gates.',
    };
  }

  return {
    allowed: true,
    classification: 'ownership_change_allowed',
    reason: 'owner_unavailable_policy',
    branch_id: branchId,
    current_assignee: currentAssignee,
    new_assignee: selected.agent_name,
    policy: cloneJson(policy),
    selected_evaluation: {
      score: selected.evaluation.score,
      contract_status: selected.evaluation.contract_advisory ? selected.evaluation.contract_advisory.status : 'neutral',
      capability_status: selected.evaluation.capability_advisory ? selected.evaluation.capability_advisory.status : 'neutral',
    },
    eligible_candidates: eligibleCandidates.map((entry) => ({
      agent_name: entry.agent_name,
      score: entry.evaluation.score,
      contract_status: entry.evaluation.contract_advisory ? entry.evaluation.contract_advisory.status : 'neutral',
      capability_status: entry.evaluation.capability_advisory ? entry.evaluation.capability_advisory.status : 'neutral',
    })),
    rejected_candidates: rejectedCandidates,
    summary: `Explicit owner-unavailable policy allows moving this workflow step from ${currentAssignee || 'unassigned'} to ${selected.agent_name} on branch ${branchId}.`,
  };
}

function buildRetrySummary(state, attemptCount, maxAttempts, ownerState, contractAdvisory, capabilityAdvisory) {
  const fragments = [];
  fragments.push(`retry ${attemptCount}/${maxAttempts}`);
  if (ownerState !== 'active') fragments.push(`owner ${ownerState.replace(/_/g, ' ')}`);
  if (contractAdvisory && contractAdvisory.status && contractAdvisory.status !== 'neutral') {
    fragments.push(`contract ${contractAdvisory.status}`);
  }
  if (capabilityAdvisory && capabilityAdvisory.status && capabilityAdvisory.status !== 'neutral') {
    fragments.push(`capability ${capabilityAdvisory.status}`);
  }

  if (state === 'blocked_permanent') {
    return `Retry policy hit its bounded limit (${fragments.join(', ')}). Escalate for human/team review instead of silently reassigning ownership.`;
  }
  if (state === 'escalate') {
    return `Retry policy requests an explicit help signal (${fragments.join(', ')}). Keep ownership stable until a deliberate reassignment decision is made.`;
  }
  return `Retry remains within bounds (${fragments.join(', ')}).`;
}

function classifyRetryPolicy(params = {}) {
  const thresholds = resolveThresholds(params.thresholds);
  const target = params.target && typeof params.target === 'object' ? params.target : buildWorkTarget(params);
  const context = params.context && typeof params.context === 'object' ? params.context : {};
  const attemptCount = Number.isFinite(params.attemptCount) ? params.attemptCount : 0;
  const ownerAlive = params.ownerAlive !== false;
  const idleMs = Number.isFinite(params.idleMs) ? params.idleMs : 0;
  const ownerState = resolveOwnerState(context, ownerAlive, idleMs, thresholds);
  const contractAdvisory = analyzeContractFit(context.contract, target);
  const capabilityAdvisory = analyzeCapabilityFit(context.runtime, target);
  const reasons = [];

  if (attemptCount >= thresholds.retry_blocked_permanent_attempts) {
    reasons.push('retry_limit_reached');
  } else if (attemptCount >= thresholds.retry_escalation_attempts) {
    reasons.push('multiple_failed_attempts');
  }
  if (ownerState !== 'active') reasons.push(`owner_${ownerState}`);
  if (contractAdvisory && contractAdvisory.status === 'mismatch') reasons.push('contract_mismatch');
  if (capabilityAdvisory.status === 'blocked') reasons.push('required_capability_unavailable');
  else if (capabilityAdvisory.status === 'mismatch') reasons.push('capability_mismatch');

  let state = 'continue';
  if (attemptCount >= thresholds.retry_blocked_permanent_attempts) {
    state = 'blocked_permanent';
  } else if (attemptCount >= thresholds.retry_escalation_attempts || ownerState !== 'active') {
    state = 'escalate';
  }

  return {
    state,
    classification: `retry_${state}`,
    attempt_count: attemptCount,
    max_attempts: thresholds.retry_blocked_permanent_attempts,
    escalation_attempts: thresholds.retry_escalation_attempts,
    owner_state: ownerState,
    session_summary: cloneJson(context.session_summary || null),
    contract_advisory: serializeAdvisory(contractAdvisory),
    capability_advisory: serializeAdvisory(capabilityAdvisory),
    reasons,
    summary: buildRetrySummary(
      state,
      attemptCount,
      thresholds.retry_blocked_permanent_attempts,
      ownerState,
      contractAdvisory,
      capabilityAdvisory
    ),
  };
}

function classifyBlockedTaskPolicy(params = {}) {
  const thresholds = resolveThresholds(params.thresholds);
  const blockedAgeMs = Number.isFinite(params.blockedAgeMs) ? params.blockedAgeMs : 0;
  const blockedMinutes = Math.max(1, Math.round(blockedAgeMs / 60000));
  const retryPolicy = classifyRetryPolicy({
    thresholds,
    target: params.target,
    context: params.context,
    attemptCount: params.attemptCount,
    ownerAlive: params.ownerAlive,
    idleMs: params.idleMs,
  });

  let classification = 'blocked_waiting';
  let signal = 'none';
  if (retryPolicy.state === 'blocked_permanent') {
    classification = 'blocked_permanent_candidate';
    signal = 'escalate';
  } else if (blockedAgeMs >= thresholds.blocked_escalation_ms || retryPolicy.state === 'escalate') {
    classification = retryPolicy.owner_state !== 'active'
      ? 'blocked_owner_unavailable'
      : 'blocked_escalation_candidate';
    signal = 'escalate';
  }

  return {
    ...retryPolicy,
    classification,
    signal,
    blocked_age_ms: blockedAgeMs,
    blocked_minutes: blockedMinutes,
    summary: signal === 'escalate'
      ? `Blocked task needs an explicit escalation after ${blockedMinutes} minute(s). ${retryPolicy.summary}`
      : `Blocked task remains within the bounded waiting window after ${blockedMinutes} minute(s).`,
  };
}

function classifyStalledWorkflowStepPolicy(params = {}) {
  const thresholds = resolveThresholds(params.thresholds);
  const target = params.target && typeof params.target === 'object' ? params.target : buildWorkTarget(params);
  const context = params.context && typeof params.context === 'object' ? params.context : {};
  const stepAgeMs = Number.isFinite(params.stepAgeMs) ? params.stepAgeMs : 0;
  const stepMinutes = Math.max(1, Math.round(stepAgeMs / 60000));
  const ownerAlive = params.ownerAlive !== false;
  const idleMs = Number.isFinite(params.idleMs) ? params.idleMs : 0;
  const ownerState = resolveOwnerState(context, ownerAlive, idleMs, thresholds);
  const contractAdvisory = analyzeContractFit(context.contract, target);
  const capabilityAdvisory = analyzeCapabilityFit(context.runtime, target);
  const resumeContext = params.resumeContext && typeof params.resumeContext === 'object' ? params.resumeContext : {};
  const dependencyEvidenceCount = Array.isArray(resumeContext.dependency_evidence) ? resumeContext.dependency_evidence.length : 0;
  const recentEvidenceCount = Array.isArray(resumeContext.recent_evidence) ? resumeContext.recent_evidence.length : 0;
  const reasons = [];

  let classification = 'step_healthy';
  let signal = 'none';
  if (ownerState !== 'active') {
    classification = 'step_owner_unavailable';
    signal = 'escalate';
    reasons.push(`owner_${ownerState}`);
  } else if (stepAgeMs >= thresholds.step_escalation_ms) {
    classification = 'step_stalled_escalation';
    signal = 'escalate';
    reasons.push('duration_limit_exceeded');
  } else if (stepAgeMs >= thresholds.step_ping_ms) {
    classification = 'step_stalled_checkin';
    signal = 'checkin';
    reasons.push('duration_checkin_due');
  }

  if (contractAdvisory && contractAdvisory.status === 'mismatch') reasons.push('contract_mismatch');
  if (capabilityAdvisory.status === 'blocked') reasons.push('required_capability_unavailable');
  else if (capabilityAdvisory.status === 'mismatch') reasons.push('capability_mismatch');

  const summary = signal === 'escalate'
    ? `Workflow step needs explicit escalation after ${stepMinutes} minute(s). Owner ${ownerState.replace(/_/g, ' ')}.`
    : signal === 'checkin'
      ? `Workflow step needs a bounded status check after ${stepMinutes} minute(s).`
      : `Workflow step is within the current watchdog window after ${stepMinutes} minute(s).`;

  return {
    classification,
    signal,
    owner_state: ownerState,
    step_age_ms: stepAgeMs,
    step_minutes: stepMinutes,
    session_summary: cloneJson(context.session_summary || null),
    contract_advisory: serializeAdvisory(contractAdvisory),
    capability_advisory: serializeAdvisory(capabilityAdvisory),
    dependency_evidence_count: dependencyEvidenceCount,
    recent_evidence_count: recentEvidenceCount,
    reasons,
    summary,
  };
}

function canReleaseUnavailableClaim(ownerState) {
  return ownerState === 'dead'
    || ownerState === 'session_interrupted'
    || ownerState === 'session_failed'
    || ownerState === 'session_abandoned';
}

function planWatchdogActions(params = {}) {
  const thresholds = resolveThresholds(params.thresholds);
  const nowMs = Number.isFinite(params.nowMs) ? params.nowMs : Date.now();
  const agents = params.agents && typeof params.agents === 'object' ? params.agents : {};
  const tasks = Array.isArray(params.tasks) ? params.tasks : [];
  const workflows = Array.isArray(params.workflows) ? params.workflows : [];
  const resolveContext = typeof params.resolveContext === 'function' ? params.resolveContext : (() => ({}));
  const resolveStepResumeContext = typeof params.resolveStepResumeContext === 'function' ? params.resolveStepResumeContext : (() => null);
  const isAgentAlive = typeof params.isAgentAlive === 'function'
    ? params.isAgentAlive
    : ((_name, agent) => !!agent);
  const actions = [];

  for (const [name, agent] of Object.entries(agents)) {
    if (!agent || name === params.watchdogAgentName) continue;
    if (!isAgentAlive(name, agent)) continue;

    const lastActivityMs = Date.parse(agent.last_activity || '') || 0;
    const idleMs = Math.max(0, nowMs - lastActivityMs);
    const context = resolveContext(name, agent.branch || params.branchId || 'main');

    if (idleMs >= thresholds.idle_hard_nudge_ms && !agent.watchdog_hard_nudged) {
      actions.push({
        kind: 'nudge_idle_hard',
        agentName: name,
        branchId: agent.branch || params.branchId || 'main',
        idleMs,
        policy: {
          classification: 'agent_idle_hard',
          owner_state: resolveOwnerState(context, true, idleMs, thresholds),
          session_summary: cloneJson(context.session_summary || null),
          summary: `Agent has been idle for ${Math.round(idleMs / 60000)} minute(s) and needs an explicit get_work() reminder.`,
        },
      });
      continue;
    }

    if (idleMs >= thresholds.idle_nudge_ms && !agent.watchdog_nudged) {
      actions.push({
        kind: 'nudge_idle',
        agentName: name,
        branchId: agent.branch || params.branchId || 'main',
        idleMs,
        policy: {
          classification: 'agent_idle',
          owner_state: resolveOwnerState(context, true, idleMs, thresholds),
          session_summary: cloneJson(context.session_summary || null),
          summary: `Agent has been idle for ${Math.round(idleMs / 60000)} minute(s) and should refresh work ownership explicitly.`,
        },
      });
    }
  }

  for (const task of tasks) {
    if (!task || !task.id) continue;
    const branchId = task.branch_id || (task.assignee && agents[task.assignee] && agents[task.assignee].branch) || params.branchId || 'main';
    const assignee = normalizeText(task.assignee);
    const ownerAlive = assignee ? isAgentAlive(assignee, agents[assignee] || null) : true;
    const lastActivityMs = assignee && agents[assignee] ? (Date.parse(agents[assignee].last_activity || '') || 0) : 0;
    const idleMs = assignee ? Math.max(0, nowMs - lastActivityMs) : 0;
    const context = assignee ? resolveContext(assignee, branchId) : {};
    const target = buildWorkTarget({
      work_type: 'task',
      title: task.title,
      description: task.description,
      assigned: !!assignee,
      required_capabilities: task.required_capabilities,
      preferred_capabilities: task.preferred_capabilities,
    });
    const retryPolicy = classifyRetryPolicy({
      thresholds,
      target,
      context,
      attemptCount: Array.isArray(task.attempt_agents) ? task.attempt_agents.length : 0,
      ownerAlive,
      idleMs,
    });

    if (task.status === 'in_progress' && assignee && canReleaseUnavailableClaim(retryPolicy.owner_state)) {
      actions.push({
        kind: 'release_task_claim',
        branchId,
        taskId: task.id,
        taskTitle: task.title || task.id,
        assignee,
        policy: {
          ...retryPolicy,
          classification: 'claimed_task_owner_unavailable',
          summary: `Current task owner is unavailable (${retryPolicy.owner_state.replace(/_/g, ' ')}). Release the claim back to pending without selecting a replacement.`,
        },
      });
    }

    if (task.status === 'blocked' && !task.escalated_at) {
      const blockedAgeMs = Math.max(0, nowMs - (Date.parse(task.updated_at || '') || 0));
      const blockedPolicy = classifyBlockedTaskPolicy({
        thresholds,
        target,
        context,
        attemptCount: Array.isArray(task.attempt_agents) ? task.attempt_agents.length : 0,
        ownerAlive,
        idleMs,
        blockedAgeMs,
      });
      if (blockedPolicy.signal === 'escalate') {
        actions.push({
          kind: 'escalate_blocked_task',
          branchId,
          taskId: task.id,
          taskTitle: task.title || task.id,
          assignee,
          blockedAgeMs,
          policy: blockedPolicy,
        });
      }
    }
  }

  for (const workflow of workflows) {
    if (!workflow || workflow.status !== 'active') continue;
    for (const step of Array.isArray(workflow.steps) ? workflow.steps : []) {
      if (!step || step.status !== 'in_progress' || !step.started_at) continue;
      const assignee = normalizeText(step.assignee);
      const branchId = normalizeText(workflow.branch_id)
        || normalizeText(step.branch_id)
        || (assignee && normalizeText(agents[assignee] && agents[assignee].branch))
        || normalizeText(params.branchId)
        || 'main';
      const ownerAlive = assignee ? isAgentAlive(assignee, agents[assignee] || null) : true;
      const lastActivityMs = assignee && agents[assignee] ? (Date.parse(agents[assignee].last_activity || '') || 0) : 0;
      const idleMs = assignee ? Math.max(0, nowMs - lastActivityMs) : 0;
      const stepAgeMs = Math.max(0, nowMs - (Date.parse(step.started_at || '') || 0));
      const context = assignee ? resolveContext(assignee, branchId) : {};
      const resumeContext = resolveStepResumeContext(workflow, step, branchId, assignee);
      const stepPolicy = classifyStalledWorkflowStepPolicy({
        thresholds,
        target: buildWorkTarget({
          work_type: 'workflow_step',
          title: step.description,
          description: workflow.name,
          assigned: !!assignee,
          required_capabilities: step.required_capabilities,
          preferred_capabilities: step.preferred_capabilities,
        }),
        context,
        ownerAlive,
        idleMs,
        stepAgeMs,
        resumeContext,
      });

      if (stepPolicy.signal === 'checkin' && !step.watchdog_pinged_at && !step.watchdog_pinged) {
        actions.push({
          kind: 'signal_stalled_step',
          signal: 'checkin',
          branchId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          stepId: step.id,
          stepDescription: step.description || step.id,
          assignee,
          stepAgeMs,
          policy: stepPolicy,
        });
      }

      if (stepPolicy.signal === 'escalate' && !step.watchdog_escalated_at && !step.watchdog_escalated) {
        actions.push({
          kind: 'signal_stalled_step',
          signal: 'escalate',
          branchId,
          workflowId: workflow.id,
          workflowName: workflow.name,
          stepId: step.id,
          stepDescription: step.description || step.id,
          assignee,
          stepAgeMs,
          policy: stepPolicy,
        });
      }
    }
  }

  return actions;
}

module.exports = {
  WATCHDOG_POLICY_THRESHOLDS,
  classifyBlockedTaskPolicy,
  classifyRetryPolicy,
  classifyStalledWorkflowStepPolicy,
  planStalledStepOwnershipChange,
  planWatchdogActions,
  resolveOwnerState,
};
