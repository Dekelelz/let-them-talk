const {
  analyzeContractFit,
  buildRuntimeContractMetadata,
} = require('./agent-contracts');

const MANAGED_TEAM_HOOK_TOPICS = Object.freeze([
  'conversation.mode_updated',
  'conversation.manager_claimed',
  'conversation.floor_yielded',
  'conversation.phase_updated',
  'task.created',
  'task.claimed',
  'task.completed',
  'workflow.created',
  'workflow.step_started',
  'workflow.step_completed',
  'workflow.step_reassigned',
  'workflow.completed',
  'review.requested',
  'review.submitted',
  'dependency.declared',
  'dependency.resolved',
]);

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeBranchName(branchName) {
  return typeof branchName === 'string' && branchName.trim() ? branchName.trim() : 'main';
}

function resolveManagedTeamContractTarget(surface, options = {}) {
  const defaults = {
    claim_manager: {
      work_type: 'managed_manager',
      title: 'Managed mode manager controls',
      description: 'Claim manager control, coordinate the team, delegate work, manage floor control, and set phases.',
      assigned: true,
    },
    manager_briefing: {
      work_type: 'team_coordination',
      title: 'Managed/team coordination briefing',
      description: 'Coordinate the team, track workflow progress, review recent coordination changes, and manage shared execution state.',
      assigned: true,
    },
    manager_listen: {
      work_type: 'team_coordination',
      title: 'Managed/team coordination updates',
      description: 'Process managed/team coordination updates, delegate next actions, and steer the team loop.',
      assigned: true,
    },
    participant_briefing: {
      work_type: 'messages',
      title: 'Managed/team execution briefing',
      description: 'Process team messages, workflow coordination updates, and manager guidance.',
      assigned: true,
    },
    participant_listen: {
      work_type: 'messages',
      title: 'Managed/team execution updates',
      description: 'Process team messages, workflow coordination updates, and manager guidance.',
      assigned: true,
    },
    team_briefing: {
      work_type: 'team_coordination',
      title: 'Team coordination briefing',
      description: 'Review recent workflow coordination, team-wide state changes, and shared execution progress.',
      assigned: true,
    },
    team_listen: {
      work_type: 'messages',
      title: 'Team coordination updates',
      description: 'Process shared team messages and workflow coordination updates.',
      assigned: true,
    },
    yield_floor: {
      work_type: 'team_coordination',
      title: 'Managed mode floor control',
      description: 'Coordinate which teammate should speak next and keep the managed conversation moving.',
      assigned: true,
    },
    set_phase: {
      work_type: 'team_coordination',
      title: 'Managed mode phase control',
      description: 'Set the managed team phase and coordinate how the team should operate next.',
      assigned: true,
    },
  };

  const base = defaults[surface] || defaults.team_listen;
  return Object.assign({}, base, options.target || {});
}

function buildContractAdvisoryMetadata(contract, advisory, surface) {
  if (!contract || !advisory) return null;
  const metadata = buildRuntimeContractMetadata(contract);
  return Object.assign({
    surface,
    archetype: metadata.contract ? metadata.contract.archetype : null,
    declared_archetype: metadata.archetype || null,
    role: contract.role || '',
    role_token: contract.role_token || null,
    skills: metadata.skills,
    effective_skills: metadata.contract ? metadata.contract.effective_skills : [],
    contract_mode: metadata.contract_mode,
  }, advisory);
}

function buildManagedTeamContractContext(contract, surface, options = {}) {
  if (!contract) return null;

  const target = resolveManagedTeamContractTarget(surface, options);
  const advisory = analyzeContractFit(contract, target);
  const contractAdvisory = buildContractAdvisoryMetadata(contract, advisory, surface);

  const shouldHardBlock = !!(
    surface === 'claim_manager'
    && contract.contract_mode === 'strict'
    && contract.has_explicit_contract
    && advisory
    && advisory.status === 'mismatch'
  );

  let contractViolation = null;
  if (advisory && (advisory.status === 'mismatch' || advisory.status === 'partial' || shouldHardBlock)) {
    contractViolation = {
      surface,
      status: shouldHardBlock ? 'blocked' : 'warning',
      advisory_status: advisory.status,
      contract_mode: contract.contract_mode,
      message: shouldHardBlock
        ? `Strict contract mismatch: ${advisory.summary}`
        : advisory.summary,
      migration_note: advisory.migration_note || null,
    };
  }

  return {
    target,
    advisory,
    contract_advisory: contractAdvisory,
    contract_violation: contractViolation,
  };
}

function buildHookSummary(hook) {
  const payload = hook && hook.payload && typeof hook.payload === 'object' ? hook.payload : {};
  const topic = hook && hook.topic ? hook.topic : 'unknown';
  let summary = topic;
  let details = {};

  switch (topic) {
    case 'conversation.mode_updated':
      summary = `Conversation mode changed from ${payload.previous_mode || 'unknown'} to ${payload.mode || 'unknown'}.`;
      details = { mode: payload.mode || null, previous_mode: payload.previous_mode || null };
      break;
    case 'conversation.manager_claimed':
      summary = `${payload.manager || hook.actor_agent || 'An agent'} claimed manager controls.`;
      details = { manager: payload.manager || null, previous_manager: payload.previous_manager || null, phase: payload.phase || null, floor: payload.floor || null };
      break;
    case 'conversation.floor_yielded':
      summary = payload.floor === 'closed'
        ? 'The manager closed the floor.'
        : `The floor was set to ${payload.floor || 'unknown'}${payload.to ? ` for ${payload.to}` : ''}.`;
      details = { floor: payload.floor || null, to: payload.to || null, turn_queue: Array.isArray(payload.turn_queue) ? [...payload.turn_queue] : [] };
      break;
    case 'conversation.phase_updated':
      summary = `Managed phase changed from ${payload.previous_phase || 'unknown'} to ${payload.phase || 'unknown'}.`;
      details = { phase: payload.phase || null, previous_phase: payload.previous_phase || null, floor: payload.floor || null };
      break;
    case 'task.created':
      summary = `Task "${payload.title || payload.task_id || 'unknown'}" was created.`;
      details = { task_id: payload.task_id || null, title: payload.title || null, assignee: payload.assignee || null };
      break;
    case 'task.claimed':
      summary = `Task "${payload.title || payload.task_id || 'unknown'}" was claimed by ${payload.assignee || 'unknown'}.`;
      details = { task_id: payload.task_id || null, title: payload.title || null, assignee: payload.assignee || null };
      break;
    case 'task.completed':
      summary = `Task "${payload.title || payload.task_id || 'unknown'}" was completed.`;
      details = { task_id: payload.task_id || null, title: payload.title || null, evidence_ref: cloneJsonValue(payload.evidence_ref || null) };
      break;
    case 'workflow.created':
      summary = `Workflow "${payload.workflow_name || payload.workflow_id || 'unknown'}" was created.`;
      details = { workflow_id: payload.workflow_id || null, workflow_name: payload.workflow_name || null, started_step_ids: Array.isArray(payload.started_step_ids) ? [...payload.started_step_ids] : [] };
      break;
    case 'workflow.step_started':
      summary = `Workflow "${payload.workflow_name || payload.workflow_id || 'unknown'}" step ${payload.step_id || '?'} started.`;
      details = { workflow_id: payload.workflow_id || null, workflow_name: payload.workflow_name || null, step_id: payload.step_id || null, assignee: payload.assignee || null };
      break;
    case 'workflow.step_completed':
      summary = `Workflow "${payload.workflow_name || payload.workflow_id || 'unknown'}" step ${payload.step_id || '?'} completed.`;
      details = { workflow_id: payload.workflow_id || null, workflow_name: payload.workflow_name || null, step_id: payload.step_id || null, evidence_ref: cloneJsonValue(payload.evidence_ref || null), next_step_ids: Array.isArray(payload.next_step_ids) ? [...payload.next_step_ids] : [] };
      break;
    case 'workflow.step_reassigned':
      summary = `Workflow "${payload.workflow_name || payload.workflow_id || 'unknown'}" step ${payload.step_id || '?'} was reassigned to ${payload.new_assignee || 'unknown'}.`;
      details = { workflow_id: payload.workflow_id || null, workflow_name: payload.workflow_name || null, step_id: payload.step_id || null, old_assignee: payload.old_assignee || null, new_assignee: payload.new_assignee || null };
      break;
    case 'workflow.completed':
      summary = `Workflow "${payload.workflow_name || payload.workflow_id || 'unknown'}" completed.`;
      details = { workflow_id: payload.workflow_id || null, workflow_name: payload.workflow_name || null, evidence_ref: cloneJsonValue(payload.evidence_ref || null) };
      break;
    case 'review.requested':
      summary = `Review requested for "${payload.file || payload.review_id || 'unknown'}".`;
      details = { review_id: payload.review_id || null, file: payload.file || null, requested_by: payload.requested_by || null, status: payload.status || null };
      break;
    case 'review.submitted':
      summary = `Review ${payload.status || 'submitted'} for "${payload.file || payload.review_id || 'unknown'}".`;
      details = { review_id: payload.review_id || null, file: payload.file || null, reviewer: payload.reviewer || null, status: payload.status || null };
      break;
    case 'dependency.declared':
      summary = `Dependency declared for task ${payload.task_id || 'unknown'}.`;
      details = { dependency_id: payload.dependency_id || null, task_id: payload.task_id || null, depends_on: payload.depends_on || null, resolved: !!payload.resolved };
      break;
    case 'dependency.resolved':
      summary = `Dependency ${payload.dependency_id || 'unknown'} was resolved.`;
      details = { dependency_id: payload.dependency_id || null, task_id: payload.task_id || null, depends_on: payload.depends_on || null, resolved_by_task_id: payload.resolved_by_task_id || null, reason: payload.reason || null };
      break;
    default:
      details = cloneJsonValue(payload);
      break;
  }

  return {
    hook_id: hook.hook_id,
    topic,
    event_id: hook.event_id,
    event_seq: hook.event_seq,
    actor_agent: hook.actor_agent || null,
    published_at: hook.published_at || hook.occurred_at || null,
    summary,
    details,
  };
}

function readManagedTeamHookDigest(readBranchHooks, branchName, options = {}) {
  if (typeof readBranchHooks !== 'function') return null;

  const branch = normalizeBranchName(branchName);
  const topics = Array.isArray(options.topics) && options.topics.length > 0
    ? options.topics
    : MANAGED_TEAM_HOOK_TOPICS;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 5;
  const hooks = readBranchHooks(branch, { topics, limit });
  if (!Array.isArray(hooks) || hooks.length === 0) return null;

  return {
    source: 'derived_post_commit_hooks',
    branch,
    topics: [...new Set(hooks.map((hook) => hook.topic))],
    recent: hooks.map(buildHookSummary),
  };
}

module.exports = {
  MANAGED_TEAM_HOOK_TOPICS,
  buildManagedTeamContractContext,
  readManagedTeamHookDigest,
  resolveManagedTeamContractTarget,
};
