const { analyzeContractFit } = require('../agent-contracts');
const { resolveAgentRuntimeMetadata, VALID_CAPABILITIES } = require('../runtime-descriptor');

const VALID_CAPABILITY_SET = new Set(VALID_CAPABILITIES);

const WORK_TYPE_BASE_SCORES = Object.freeze({
  workflow_step: 100,
  messages: 90,
  task: 60,
  help_teammate: 55,
  review: 54,
  unblock: 50,
  stolen_task: 48,
  prep_work: 30,
  idle: 0,
  advisor_context: 95,
  monitor_report: 95,
});

const ASSIGNMENT_PRIORITIES = Object.freeze({
  none: 0,
  assigned: 1,
  active: 2,
});

function normalizeText(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeCapabilityList(value) {
  const entries = Array.isArray(value)
    ? value
    : (value == null ? [] : [value]);
  const normalized = [];
  const seen = new Set();

  for (const entry of entries) {
    const text = normalizeText(entry);
    if (!text) continue;
    const token = text.toLowerCase();
    if (!VALID_CAPABILITY_SET.has(token) || seen.has(token)) continue;
    seen.add(token);
    normalized.push(token);
  }

  return normalized;
}

function resolveAssignmentPriority(target = {}) {
  if (target.assignment_priority && Object.prototype.hasOwnProperty.call(ASSIGNMENT_PRIORITIES, target.assignment_priority)) {
    return ASSIGNMENT_PRIORITIES[target.assignment_priority];
  }
  return target.assigned ? ASSIGNMENT_PRIORITIES.assigned : ASSIGNMENT_PRIORITIES.none;
}

function resolveWorkType(target = {}) {
  const workType = normalizeText(target.work_type);
  if (!workType) return 'task';
  return workType.toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveTargetScore(target = {}) {
  if (Number.isFinite(target.base_score)) return target.base_score;
  return WORK_TYPE_BASE_SCORES[resolveWorkType(target)] || 0;
}

function resolveAgentDecisionContext(params = {}) {
  const agentRecord = params.agentRecord && typeof params.agentRecord === 'object'
    ? params.agentRecord
    : {};
  const runtimeMetadata = resolveAgentRuntimeMetadata({
    ...agentRecord,
    name: params.agentName,
    is_api_agent: !!agentRecord.is_api_agent,
  });
  const capabilities = Array.isArray(runtimeMetadata.capabilities) && runtimeMetadata.capabilities.length > 0
    ? runtimeMetadata.capabilities
    : ['chat'];

  return {
    agent_name: params.agentName || null,
    branch_id: params.branchId || 'main',
    session_summary: params.sessionSummary || null,
    contract: params.contract || null,
    available_skills: Array.isArray(params.availableSkills) ? [...params.availableSkills] : [],
    runtime: {
      runtime_type: runtimeMetadata.runtime_type || (agentRecord.is_api_agent ? 'api' : 'cli'),
      provider_id: runtimeMetadata.provider_id || null,
      model_id: runtimeMetadata.model_id || null,
      provider: runtimeMetadata.provider || null,
      capabilities,
      bot_capability: runtimeMetadata.bot_capability || null,
    },
  };
}

function collectCapabilityRequirements(target = {}) {
  return {
    required_capabilities: normalizeCapabilityList(
      target.required_capabilities || target.requiredCapabilities || target.capability_requirements || []
    ),
    preferred_capabilities: normalizeCapabilityList(
      target.preferred_capabilities || target.preferredCapabilities || []
    ),
  };
}

function analyzeCapabilityFit(runtime, target = {}) {
  const normalizedRuntime = runtime && typeof runtime === 'object'
    ? {
        runtime_type: runtime.runtime_type || 'cli',
        provider_id: runtime.provider_id || null,
        model_id: runtime.model_id || null,
        capabilities: normalizeCapabilityList(runtime.capabilities),
        bot_capability: runtime.bot_capability || null,
      }
    : {
        runtime_type: 'cli',
        provider_id: null,
        model_id: null,
        capabilities: ['chat'],
        bot_capability: null,
      };
  if (normalizedRuntime.capabilities.length === 0) normalizedRuntime.capabilities = ['chat'];

  const requirements = collectCapabilityRequirements(target);
  const matchedRequired = requirements.required_capabilities.filter((capability) => normalizedRuntime.capabilities.includes(capability));
  const missingRequired = requirements.required_capabilities.filter((capability) => !normalizedRuntime.capabilities.includes(capability));
  const matchedPreferred = requirements.preferred_capabilities.filter((capability) => normalizedRuntime.capabilities.includes(capability));
  const missingPreferred = requirements.preferred_capabilities.filter((capability) => !normalizedRuntime.capabilities.includes(capability));

  let status = 'neutral';
  let admissible = true;
  let summary = 'No explicit capability requirement shaped this decision.';

  if (missingRequired.length > 0) {
    if (target.assigned) {
      status = 'mismatch';
      summary = `This assigned work asks for ${missingRequired.join(', ')}, which your runtime does not currently advertise, but assigned work still takes precedence in this decision-only slice.`;
    } else {
      status = 'blocked';
      admissible = false;
      summary = `This work asks for ${missingRequired.join(', ')}, which your runtime does not currently advertise.`;
    }
  } else if (requirements.required_capabilities.length > 0) {
    status = 'aligned';
    summary = `Your runtime advertises the required capability set: ${requirements.required_capabilities.join(', ')}.`;
  } else if (requirements.preferred_capabilities.length > 0) {
    status = missingPreferred.length === 0 ? 'aligned' : 'partial';
    summary = missingPreferred.length === 0
      ? `Your runtime advertises the preferred capability set: ${requirements.preferred_capabilities.join(', ')}.`
      : `This work prefers ${missingPreferred.join(', ')}, which your runtime does not currently advertise.`;
  }

  return {
    status,
    admissible,
    summary,
    runtime_type: normalizedRuntime.runtime_type,
    provider_id: normalizedRuntime.provider_id,
    model_id: normalizedRuntime.model_id,
    runtime_capabilities: normalizedRuntime.capabilities,
    required_capabilities: requirements.required_capabilities,
    preferred_capabilities: requirements.preferred_capabilities,
    matched_required: matchedRequired,
    matched_preferred: matchedPreferred,
    missing_required: missingRequired,
    missing_preferred: missingPreferred,
  };
}

function countResumeSignals(target = {}) {
  let count = 0;

  if (target.session_summary && target.session_summary.session_id) count += 1;

  const resumeContext = target.resume_context && typeof target.resume_context === 'object'
    ? target.resume_context
    : null;
  if (!resumeContext) return count;

  if (Array.isArray(resumeContext.dependency_evidence)) count += resumeContext.dependency_evidence.length;
  if (Array.isArray(resumeContext.recent_evidence)) count += resumeContext.recent_evidence.length;
  if (Array.isArray(resumeContext.message_handoffs)) count += resumeContext.message_handoffs.length;

  return count;
}

function getContractScore(advisory) {
  if (!advisory) return 0;
  if (advisory.status === 'aligned') return 20;
  if (advisory.status === 'partial') return 8;
  if (advisory.status === 'mismatch') return -20;
  return 0;
}

function getCapabilityScore(advisory) {
  if (!advisory) return 0;
  if (advisory.status === 'aligned') return advisory.required_capabilities.length > 0 ? 15 : 10;
  if (advisory.status === 'partial') return 4;
  if (advisory.status === 'mismatch') return -5;
  if (advisory.status === 'blocked') return -1000;
  return 0;
}

function analyzeContractAdmissibility(contract, target = {}, advisory = null) {
  const assigned = resolveAssignmentPriority(target) > ASSIGNMENT_PRIORITIES.none;
  const status = advisory && advisory.status ? advisory.status : 'neutral';

  if (!contract || !contract.has_explicit_contract || contract.contract_mode !== 'strict') {
    return {
      admissible: true,
      status,
      reason: 'advisory_only',
      summary: 'Contract fit remains advisory for this decision context.',
    };
  }

  if (!assigned && status !== 'aligned' && status !== 'partial') {
    return {
      admissible: false,
      status,
      reason: status === 'mismatch' ? 'strict_contract_mismatch' : 'strict_contract_no_positive_fit',
      summary: status === 'mismatch'
        ? 'Strict contract mode blocks claiming new work that mismatches the explicit contract.'
        : 'Strict contract mode blocks claiming new work unless the explicit contract provides a positive fit signal.',
    };
  }

  return {
    admissible: true,
    status,
    reason: assigned ? 'assigned_precedence' : 'strict_contract_aligned',
    summary: assigned
      ? 'Assigned work keeps precedence even under strict contract mode.'
      : 'Strict contract mode allows this work item.',
  };
}

function getAffinityScore(target = {}) {
  if (!Number.isFinite(target.affinity_score)) return 0;
  return Math.max(-20, Math.min(20, target.affinity_score));
}

function evaluateAutonomyCandidate(candidate, context = {}) {
  const normalizedCandidate = candidate && typeof candidate === 'object' ? candidate : {};
  const target = normalizedCandidate.target && typeof normalizedCandidate.target === 'object'
    ? normalizedCandidate.target
    : normalizedCandidate;
  const contractAdvisory = analyzeContractFit(context.contract, target);
  const contractAdmissibility = analyzeContractAdmissibility(context.contract, target, contractAdvisory);
  const capabilityAdvisory = analyzeCapabilityFit(context.runtime, target);
  const resumeSignalCount = countResumeSignals(target);
  const sessionMatch = !!(
    target.session_summary
    && target.session_summary.session_id
    && context.session_summary
    && context.session_summary.session_id
    && target.session_summary.session_id === context.session_summary.session_id
  );
  const score = resolveTargetScore(target)
    + getContractScore(contractAdvisory)
    + getCapabilityScore(capabilityAdvisory)
    + getAffinityScore(target)
    + Math.min(resumeSignalCount, 6) * 2
    + (sessionMatch ? 3 : 0);

  return {
    admissible: capabilityAdvisory.admissible && contractAdmissibility.admissible,
    assigned_priority: resolveAssignmentPriority(target),
    base_score: resolveTargetScore(target),
    score,
    session_match: sessionMatch,
    resume_signal_count: resumeSignalCount,
    work_type: resolveWorkType(target),
    contract_advisory: contractAdvisory,
    contract_admissibility: contractAdmissibility,
    capability_advisory: capabilityAdvisory,
  };
}

function compareEvaluatedCandidates(left, right) {
  const leftEvaluation = left.evaluation || {};
  const rightEvaluation = right.evaluation || {};

  if ((rightEvaluation.assigned_priority || 0) !== (leftEvaluation.assigned_priority || 0)) {
    return (rightEvaluation.assigned_priority || 0) - (leftEvaluation.assigned_priority || 0);
  }
  if ((rightEvaluation.score || 0) !== (leftEvaluation.score || 0)) {
    return (rightEvaluation.score || 0) - (leftEvaluation.score || 0);
  }

  const leftOrder = Number.isFinite(left.order) ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = Number.isFinite(right.order) ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const leftId = normalizeText(left.id) || '';
  const rightId = normalizeText(right.id) || '';
  return leftId.localeCompare(rightId);
}

function selectAutonomyDecisionCandidate(candidates, context = {}) {
  return (Array.isArray(candidates) ? candidates : [])
    .map((candidate) => ({
      ...candidate,
      evaluation: evaluateAutonomyCandidate(candidate, context),
    }))
    .filter((candidate) => candidate.evaluation && candidate.evaluation.admissible)
    .sort(compareEvaluatedCandidates)[0] || null;
}

function buildTaskHistoryKeywords(allTasks, agentName, availableSkills) {
  const keywords = new Set();
  const tasks = Array.isArray(allTasks) ? allTasks : [];

  for (const task of tasks) {
    if (!task || task.assignee !== agentName || task.status !== 'done') continue;
    const words = `${task.title || ''} ${task.description || ''}`
      .toLowerCase()
      .split(/\W+/)
      .filter((word) => word.length > 3);
    for (const word of words) keywords.add(word);
  }

  for (const skill of Array.isArray(availableSkills) ? availableSkills : []) {
    const token = normalizeText(skill);
    if (!token) continue;
    keywords.add(token.toLowerCase());
  }

  return keywords;
}

function computeTaskAffinityScore(task, historyKeywords) {
  if (!task || !(historyKeywords instanceof Set) || historyKeywords.size === 0) return 0;
  const words = `${task.title || ''} ${task.description || ''}`
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
  return words.filter((word) => historyKeywords.has(word)).length;
}

function rankClaimableTasks(tasks, context = {}, options = {}) {
  const allTasks = Array.isArray(options.allTasks) ? options.allTasks : tasks;
  const historyKeywords = buildTaskHistoryKeywords(allTasks, context.agent_name, options.availableSkills || context.available_skills);

  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => {
      const target = {
        work_type: 'task',
        title: task.title || '',
        description: task.description || '',
        assigned: false,
        affinity_score: computeTaskAffinityScore(task, historyKeywords),
        required_capabilities: task.required_capabilities || null,
        preferred_capabilities: task.preferred_capabilities || null,
      };

      return {
        id: task.id || `task_${index}`,
        order: Number.isFinite(options.orderOffset) ? options.orderOffset + index : index,
        task,
        target,
        evaluation: evaluateAutonomyCandidate({ target }, context),
      };
    })
    .filter((entry) => entry.evaluation.admissible)
    .sort(compareEvaluatedCandidates);
}

module.exports = {
  analyzeCapabilityFit,
  compareEvaluatedCandidates,
  evaluateAutonomyCandidate,
  rankClaimableTasks,
  resolveAgentDecisionContext,
  selectAutonomyDecisionCandidate,
};
