#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');
const PACKAGE_FILE = path.resolve(__dirname, '..', 'package.json');
const SUITE_FILE = path.resolve(__dirname, 'run-verification-suite.js');

const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const {
  evaluateAutonomyCandidate,
  resolveAgentDecisionContext,
  selectAutonomyDecisionCandidate,
} = require(path.resolve(__dirname, '..', 'autonomy', 'decision-v2.js'));
const {
  classifyStalledWorkflowStepPolicy,
  planStalledStepOwnershipChange,
} = require(path.resolve(__dirname, '..', 'autonomy', 'watchdog-policy.js'));
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

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function makeSessionSummary(sessionId, branchId, state = 'active', stale = false) {
  return {
    session_id: sessionId,
    branch_id: branchId,
    state,
    stale,
  };
}

function buildContext(params) {
  return resolveAgentDecisionContext({
    agentName: params.agentName,
    branchId: params.branchId,
    sessionSummary: params.sessionSummary || null,
    contract: resolveAgentContract({
      role: params.role || '',
      archetype: params.archetype,
      skills: params.skills,
      contract_mode: params.contractMode,
    }),
    agentRecord: {
      runtime_type: params.runtimeType || 'cli',
      provider_id: params.providerId || null,
      model_id: params.modelId || null,
      capabilities: params.capabilities || null,
    },
    availableSkills: params.availableSkills || params.skills || [],
  });
}

function readWorkflow(canonicalState, branchName, workflowId) {
  const workflows = canonicalState.listWorkflows({ branch: branchName });
  return Array.isArray(workflows)
    ? workflows.find((entry) => entry && entry.id === workflowId) || null
    : null;
}

function getBranchEventsFile(dataDir, branchName) {
  return path.join(dataDir, 'runtime', 'branches', branchName, 'events.jsonl');
}

function buildStepCandidate(workflow, step, sessionSummary) {
  return {
    id: `step_${workflow.id}_${step.id}`,
    order: 10,
    target: {
      work_type: 'workflow_step',
      title: step.description,
      description: workflow.name,
      assigned: true,
      assignment_priority: step.status === 'in_progress' ? 'active' : 'assigned',
      required_capabilities: step.required_capabilities || null,
      preferred_capabilities: step.preferred_capabilities || null,
      session_summary: sessionSummary || null,
    },
  };
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_FILE, 'utf8'));
  const suiteSource = fs.readFileSync(SUITE_FILE, 'utf8');
  const watchdogBlock = extractBlock(serverSource, 'function watchdogCheck() {', '// --- Monitor Agent: system health check ---');
  const activeStepBlock = extractBlock(serverSource, 'function findMyActiveWorkflowStep() {', 'function findReadySteps(workflow) {');
  const upcomingStepBlock = extractBlock(serverSource, 'function findUpcomingStepsForMe() {', 'async function listenWithTimeout(timeoutMs) {');

  assert(serverSource.includes('planStalledStepOwnershipChange'), 'server.js must load the bounded stalled-step ownership-change planner.', problems);
  assert(watchdogBlock.includes('planStalledStepOwnershipChange({'), 'watchdogCheck() must derive any stalled-step ownership change from the shared policy helper.', problems);
  assert(watchdogBlock.includes('canonicalState.reassignWorkflowStep({'), 'watchdogCheck() must apply policy-approved stalled-step ownership changes through canonical state.', problems);
  assert(watchdogBlock.includes('clearPolicySignal: true'), 'Policy-approved stalled-step ownership changes must clear the previous watchdog policy signal.', problems);
  assert(watchdogBlock.includes("clearSignalFields: ['watchdog_pinged_at', 'watchdog_escalated_at']"), 'Policy-approved stalled-step ownership changes must clear prior watchdog timestamps.', problems);
  assert(watchdogBlock.includes('restartStartedAt: reassignedAt'), 'Policy-approved stalled-step ownership changes must restart the in-progress timer for the new owner.', problems);
  assert(activeStepBlock.includes('workflowMatchesActiveBranch(wf)'), 'findMyActiveWorkflowStep() must stay scoped to the current branch-local workflow view.', problems);
  assert(upcomingStepBlock.includes('workflowMatchesActiveBranch(wf)'), 'findUpcomingStepsForMe() must stay scoped to the current branch-local workflow view.', problems);

  assert(packageJson.scripts['verify:invariants:autonomy-v2-execution'] === 'node scripts/check-autonomy-v2-execution.js', 'package.json must expose the autonomy-v2 execution validator in verify:invariants.', problems);
  assert(packageJson.scripts['verify:invariants'].includes('verify:invariants:autonomy-v2-execution'), 'package.json verify:invariants must include the autonomy-v2 execution validator.', problems);
  assert(suiteSource.includes("label: 'autonomy-v2-execution'"), 'run-verification-suite.js smoke coverage must include autonomy-v2 execution validation.', problems);
  assert(suiteSource.includes("args: ['scripts/check-autonomy-v2-execution.js']"), 'run-verification-suite.js smoke coverage must execute the autonomy-v2 execution validator.', problems);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-task12c-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const canonicalState = createCanonicalState({ dataDir, processPid: 4242 });

  try {
    const branchHealthy = 'feature_autonomy_v2';
    const healthyWorkflow = {
      id: 'wf_autonomy_v2_branch',
      name: 'Branch-local autonomy-v2 workflow',
      status: 'active',
      autonomous: true,
      parallel: false,
      created_by: 'lead',
      created_at: '2026-04-16T12:00:00.000Z',
      updated_at: '2026-04-16T12:00:00.000Z',
      steps: [
        {
          id: 1,
          description: 'Implement branch-local autonomy slice',
          assignee: 'alpha',
          depends_on: [],
          status: 'in_progress',
          started_at: '2026-04-16T12:01:00.000Z',
          completed_at: null,
          notes: '',
        },
        {
          id: 2,
          description: 'Review the branch-local autonomy slice',
          assignee: 'beta',
          depends_on: [1],
          status: 'pending',
          started_at: null,
          completed_at: null,
          notes: '',
        },
      ],
    };
    canonicalState.createWorkflow({
      workflow: healthyWorkflow,
      actor: 'lead',
      branch: branchHealthy,
      sessionId: 'sess_lead_feature',
      correlationId: healthyWorkflow.id,
    });

    const alphaContext = buildContext({
      agentName: 'alpha',
      branchId: branchHealthy,
      sessionSummary: makeSessionSummary('sess_alpha_feature', branchHealthy),
      archetype: 'implementer',
      skills: ['backend'],
      contractMode: 'strict',
      runtimeType: 'cli',
    });
    const alphaSelection = selectAutonomyDecisionCandidate([
      buildStepCandidate(healthyWorkflow, healthyWorkflow.steps[0], makeSessionSummary('sess_alpha_feature', branchHealthy)),
    ], alphaContext);
    assert(alphaSelection && alphaSelection.id === 'step_wf_autonomy_v2_branch_1', 'Healthy autonomy-v2 branch execution must select the active step for the branch-local owner.', problems);

    const healthyAdvance = canonicalState.advanceWorkflow({
      workflowId: healthyWorkflow.id,
      actor: 'alpha',
      branch: branchHealthy,
      sessionId: 'sess_alpha_feature',
      commandId: 'cmd_autonomy_v2_branch',
      correlationId: healthyWorkflow.id,
      at: '2026-04-16T12:05:00.000Z',
      sourceTool: 'check-autonomy-v2-execution',
      expectedAssignee: 'alpha',
      evidence: {
        summary: 'Implemented the branch-local autonomy slice.',
        verification: 'Deterministic fixture advance executed cleanly.',
        files_changed: ['agent-bridge/server.js'],
        confidence: 96,
        learnings: 'Branch-local autonomy steps advance cleanly through canonical workflow state.',
      },
    });
    assert(healthyAdvance && healthyAdvance.success, 'Healthy autonomy-v2 branch execution must advance through canonical workflow state.', problems);

    const healthyWorkflowAfter = readWorkflow(canonicalState, branchHealthy, healthyWorkflow.id);
    const healthyFeatureEvents = readJsonl(getBranchEventsFile(dataDir, branchHealthy));
    const mainEvents = readJsonl(getBranchEventsFile(dataDir, 'main'));
    assert(healthyWorkflowAfter && healthyWorkflowAfter.branch_id === branchHealthy, 'Autonomy-v2 workflows created on a branch must persist their branch_id explicitly.', problems);
    assert(healthyWorkflowAfter && healthyWorkflowAfter.steps[0].status === 'done', 'Healthy autonomy-v2 execution must mark the completed branch-local step done.', problems);
    assert(healthyWorkflowAfter && healthyWorkflowAfter.steps[1].status === 'in_progress', 'Healthy autonomy-v2 execution must start the next branch-local step deterministically.', problems);
    assert(healthyWorkflowAfter && healthyWorkflowAfter.steps[1].assignee === 'beta', 'Healthy autonomy-v2 execution must preserve the explicit next-step assignee.', problems);
    assert(healthyFeatureEvents.some((event) => event.type === 'workflow.step_completed' && event.payload && event.payload.step_id === 1), 'Healthy autonomy-v2 execution must emit branch-local workflow.step_completed events.', problems);
    assert(healthyFeatureEvents.some((event) => event.type === 'workflow.step_started' && event.payload && event.payload.step_id === 2), 'Healthy autonomy-v2 execution must emit branch-local workflow.step_started events for the next step.', problems);
    assert(mainEvents.length === 0, 'Healthy autonomy-v2 branch execution must not leak workflow events into main.', problems);

    const branchRecovery = 'feature_recovery_v2';
    const recoveryWorkflow = {
      id: 'wf_autonomy_v2_recovery',
      name: 'Unavailable owner recovery workflow',
      status: 'active',
      autonomous: true,
      parallel: false,
      created_by: 'lead',
      created_at: '2026-04-16T11:00:00.000Z',
      updated_at: '2026-04-16T11:00:00.000Z',
      steps: [
        {
          id: 1,
          description: 'Render release poster',
          assignee: 'stalled_owner',
          depends_on: [],
          status: 'in_progress',
          started_at: '2026-04-16T11:05:00.000Z',
          completed_at: null,
          notes: '',
          required_capabilities: ['image_generation'],
        },
      ],
    };
    canonicalState.createWorkflow({
      workflow: recoveryWorkflow,
      actor: 'lead',
      branch: branchRecovery,
      sessionId: 'sess_lead_recovery',
      correlationId: recoveryWorkflow.id,
    });

    const ownerContext = buildContext({
      agentName: 'stalled_owner',
      branchId: branchRecovery,
      sessionSummary: makeSessionSummary('sess_stalled_owner', branchRecovery, 'interrupted', true),
      archetype: 'implementer',
      skills: ['media'],
      contractMode: 'strict',
      runtimeType: 'cli',
    });
    const stalledPolicy = classifyStalledWorkflowStepPolicy({
      target: {
        work_type: 'workflow_step',
        title: 'Render release poster',
        description: recoveryWorkflow.name,
        assigned: true,
        required_capabilities: ['image_generation'],
      },
      context: ownerContext,
      ownerAlive: false,
      idleMs: 0,
      stepAgeMs: 1900000,
      resumeContext: {
        dependency_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_dep_recovery' } } }],
        recent_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_recent_recovery' } } }],
      },
    });
    assert(stalledPolicy.signal === 'escalate', 'Unavailable stalled-step policy must escalate explicitly before ownership can move.', problems);
    assert(stalledPolicy.classification === 'step_owner_unavailable', 'Unavailable stalled-step policy must classify owner-unavailable recovery explicitly.', problems);

    canonicalState.setWorkflowStepPolicySignal({
      workflowId: recoveryWorkflow.id,
      stepId: 1,
      expectedAssignee: 'stalled_owner',
      signalAtField: 'watchdog_escalated_at',
      policySignal: {
        source: 'watchdog',
        classification: stalledPolicy.classification,
        summary: stalledPolicy.summary,
      },
      at: '2026-04-16T12:10:00.000Z',
    });

    const replacementContexts = {
      replacement_good: buildContext({
        agentName: 'replacement_good',
        branchId: branchRecovery,
        sessionSummary: makeSessionSummary('sess_replacement_good', branchRecovery),
        archetype: 'implementer',
        skills: ['media'],
        contractMode: 'strict',
        runtimeType: 'api',
        providerId: 'gemini',
        modelId: 'gemini-image',
        capabilities: ['image_generation'],
      }),
      replacement_bad_contract: buildContext({
        agentName: 'replacement_bad_contract',
        branchId: branchRecovery,
        sessionSummary: makeSessionSummary('sess_bad_contract', branchRecovery),
        archetype: 'advisor',
        skills: ['strategy'],
        contractMode: 'strict',
        runtimeType: 'api',
        providerId: 'gemini',
        modelId: 'gemini-image',
        capabilities: ['image_generation'],
      }),
      replacement_bad_capability: buildContext({
        agentName: 'replacement_bad_capability',
        branchId: branchRecovery,
        sessionSummary: makeSessionSummary('sess_bad_capability', branchRecovery),
        archetype: 'implementer',
        skills: ['media'],
        contractMode: 'strict',
        runtimeType: 'cli',
      }),
      off_branch_image: buildContext({
        agentName: 'off_branch_image',
        branchId: 'main',
        sessionSummary: makeSessionSummary('sess_off_branch', 'main'),
        archetype: 'implementer',
        skills: ['media'],
        contractMode: 'strict',
        runtimeType: 'api',
        providerId: 'gemini',
        modelId: 'gemini-image',
        capabilities: ['image_generation'],
      }),
    };

    const ownershipChange = planStalledStepOwnershipChange({
      branchId: branchRecovery,
      currentAssignee: 'stalled_owner',
      watchdogAgentName: 'watchdog',
      policy: stalledPolicy,
      target: {
        work_type: 'workflow_step',
        title: 'Render release poster',
        description: recoveryWorkflow.name,
        assigned: true,
        required_capabilities: ['image_generation'],
      },
      agents: {
        stalled_owner: { branch: branchRecovery },
        replacement_good: { branch: branchRecovery },
        replacement_bad_contract: { branch: branchRecovery },
        replacement_bad_capability: { branch: branchRecovery },
        off_branch_image: { branch: 'main' },
        watchdog: { branch: branchRecovery },
      },
      resolveContext: (agentName) => replacementContexts[agentName] || ownerContext,
      isAgentAlive: (agentName) => agentName !== 'stalled_owner',
    });
    assert(ownershipChange.allowed === true, 'Owner-unavailable stalled-step recovery must allow a bounded ownership transfer when one same-branch replacement passes policy checks.', problems);
    assert(ownershipChange.new_assignee === 'replacement_good', 'Bounded stalled-step ownership transfer must choose the best same-branch admissible replacement deterministically.', problems);
    assert(ownershipChange.rejected_candidates.some((entry) => entry.agent_name === 'off_branch_image' && entry.reason === 'branch_mismatch'), 'Bounded stalled-step ownership transfer must reject off-branch replacements.', problems);
    assert(ownershipChange.rejected_candidates.some((entry) => entry.agent_name === 'replacement_bad_contract' && entry.reason === 'strict_contract_mismatch'), 'Bounded stalled-step ownership transfer must fail closed on strict contract mismatches.', problems);
    assert(ownershipChange.rejected_candidates.some((entry) => entry.agent_name === 'replacement_bad_capability' && entry.reason === 'required_capability_unavailable'), 'Bounded stalled-step ownership transfer must fail closed on capability mismatches.', problems);

    const reassigned = canonicalState.reassignWorkflowStep({
      workflowId: recoveryWorkflow.id,
      stepId: 1,
      newAssignee: ownershipChange.new_assignee,
      actor: 'watchdog',
      branch: branchRecovery,
      expectedAssignee: 'stalled_owner',
      clearPolicySignal: true,
      clearSignalFields: ['watchdog_pinged_at', 'watchdog_escalated_at'],
      restartStartedAt: '2026-04-16T12:11:00.000Z',
      at: '2026-04-16T12:11:00.000Z',
    });
    assert(reassigned && reassigned.success, 'Policy-approved stalled-step ownership transfer must apply through canonical workflow reassignment.', problems);

    const recoveryWorkflowAfter = readWorkflow(canonicalState, branchRecovery, recoveryWorkflow.id);
    const recoveryStepAfter = recoveryWorkflowAfter && recoveryWorkflowAfter.steps ? recoveryWorkflowAfter.steps[0] : null;
    const recoveryEvents = readJsonl(getBranchEventsFile(dataDir, branchRecovery));
    assert(recoveryStepAfter && recoveryStepAfter.assignee === 'replacement_good', 'Policy-approved stalled-step ownership transfer must update the workflow assignee.', problems);
    assert(recoveryStepAfter && recoveryStepAfter.started_at === '2026-04-16T12:11:00.000Z', 'Policy-approved stalled-step ownership transfer must restart the in-progress timer for the new owner.', problems);
    assert(recoveryStepAfter && !Object.prototype.hasOwnProperty.call(recoveryStepAfter, 'policy_signal'), 'Policy-approved stalled-step ownership transfer must clear the prior watchdog policy signal.', problems);
    assert(recoveryStepAfter && !Object.prototype.hasOwnProperty.call(recoveryStepAfter, 'watchdog_escalated_at'), 'Policy-approved stalled-step ownership transfer must clear the prior watchdog escalation timestamp.', problems);
    assert(recoveryEvents.some((event) => event.type === 'workflow.step_reassigned' && event.payload && event.payload.new_assignee === 'replacement_good'), 'Policy-approved stalled-step ownership transfer must emit workflow.step_reassigned canonically.', problems);

    const branchMixedProviders = 'feature_mixed_provider_v2';
    const mixedProviderWorkflow = {
      id: 'wf_autonomy_v2_mixed_provider',
      name: 'Mixed-provider autonomy-v2 workflow',
      status: 'active',
      autonomous: true,
      parallel: false,
      created_by: 'lead',
      created_at: '2026-04-16T13:00:00.000Z',
      updated_at: '2026-04-16T13:00:00.000Z',
      steps: [
        {
          id: 1,
          description: 'Generate launch poster',
          assignee: 'image_bot',
          depends_on: [],
          status: 'in_progress',
          started_at: '2026-04-16T13:01:00.000Z',
          completed_at: null,
          notes: '',
          required_capabilities: ['image_generation'],
        },
        {
          id: 2,
          description: 'Write launch summary',
          assignee: 'writer_bot',
          depends_on: [1],
          status: 'pending',
          started_at: null,
          completed_at: null,
          notes: '',
        },
      ],
    };
    canonicalState.createWorkflow({
      workflow: mixedProviderWorkflow,
      actor: 'lead',
      branch: branchMixedProviders,
      sessionId: 'sess_mixed_provider_lead',
      correlationId: mixedProviderWorkflow.id,
    });

    const imageBotContext = buildContext({
      agentName: 'image_bot',
      branchId: branchMixedProviders,
      sessionSummary: makeSessionSummary('sess_image_bot', branchMixedProviders),
      archetype: 'implementer',
      skills: ['media'],
      contractMode: 'strict',
      runtimeType: 'api',
      providerId: 'gemini',
      modelId: 'gemini-image',
      capabilities: ['image_generation'],
    });
    const writerBotContext = buildContext({
      agentName: 'writer_bot',
      branchId: branchMixedProviders,
      sessionSummary: makeSessionSummary('sess_writer_bot', branchMixedProviders),
      archetype: 'implementer',
      skills: ['writing'],
      contractMode: 'strict',
      runtimeType: 'cli',
    });

    const mixedProviderSelection = selectAutonomyDecisionCandidate([
      buildStepCandidate(mixedProviderWorkflow, mixedProviderWorkflow.steps[0], makeSessionSummary('sess_image_bot', branchMixedProviders)),
    ], imageBotContext);
    assert(mixedProviderSelection && mixedProviderSelection.id === 'step_wf_autonomy_v2_mixed_provider_1', 'Mixed-provider autonomy-v2 execution must select the explicit image-capable branch-local owner for the media step.', problems);

    const mixedProviderAdvance = canonicalState.advanceWorkflow({
      workflowId: mixedProviderWorkflow.id,
      actor: 'image_bot',
      branch: branchMixedProviders,
      sessionId: 'sess_image_bot',
      commandId: 'cmd_mixed_provider_step_1',
      correlationId: mixedProviderWorkflow.id,
      at: '2026-04-16T13:06:00.000Z',
      sourceTool: 'check-autonomy-v2-execution',
      expectedAssignee: 'image_bot',
      evidence: {
        summary: 'Generated the launch poster.',
        verification: 'Mixed-provider branch-local fixture advanced successfully.',
        files_changed: ['agent-bridge/autonomy/decision-v2.js'],
        confidence: 94,
      },
    });
    assert(mixedProviderAdvance && mixedProviderAdvance.success, 'Mixed-provider autonomy-v2 execution must advance the first provider-specific step.', problems);

    const mixedProviderWorkflowAfter = readWorkflow(canonicalState, branchMixedProviders, mixedProviderWorkflow.id);
    const writerStep = mixedProviderWorkflowAfter && mixedProviderWorkflowAfter.steps
      ? mixedProviderWorkflowAfter.steps.find((entry) => entry.id === 2) || null
      : null;
    const writerSelection = writerStep
      ? selectAutonomyDecisionCandidate([
          buildStepCandidate(mixedProviderWorkflowAfter, writerStep, makeSessionSummary('sess_writer_bot', branchMixedProviders)),
        ], writerBotContext)
      : null;
    const mixedProviderEvents = readJsonl(getBranchEventsFile(dataDir, branchMixedProviders));
    assert(writerStep && writerStep.status === 'in_progress', 'Mixed-provider autonomy-v2 execution must start the branch-local follow-up step after the provider-specific step completes.', problems);
    assert(writerSelection && writerSelection.id === 'step_wf_autonomy_v2_mixed_provider_2', 'Mixed-provider autonomy-v2 execution must hand branch-local follow-up work to the next explicitly assigned provider/runtime owner.', problems);
    assert(mixedProviderEvents.some((event) => event.type === 'workflow.step_completed' && event.payload && event.payload.workflow_id === mixedProviderWorkflow.id), 'Mixed-provider autonomy-v2 execution must record branch-local completion events for the provider-specific workflow.', problems);

    const strictAdvisorContext = buildContext({
      agentName: 'strategy_bot',
      branchId: 'feature_contract_v2',
      sessionSummary: makeSessionSummary('sess_strategy_bot', 'feature_contract_v2'),
      archetype: 'advisor',
      skills: ['analysis', 'strategy'],
      contractMode: 'strict',
      runtimeType: 'cli',
    });
    const strictMismatchEvaluation = evaluateAutonomyCandidate({
      target: {
        work_type: 'task',
        title: 'Implement dashboard drag and drop',
        description: 'Write code for the dashboard interaction.',
      },
    }, strictAdvisorContext);
    const strictNeutralEvaluation = evaluateAutonomyCandidate({
      target: {
        work_type: 'review',
        title: 'Review the launch checklist',
        description: 'Check the release notes for typos.',
      },
    }, strictAdvisorContext);
    const strictAssignedEvaluation = evaluateAutonomyCandidate({
      target: {
        work_type: 'task',
        title: 'Implement dashboard drag and drop',
        description: 'Write code for the dashboard interaction.',
        assigned: true,
        assignment_priority: 'assigned',
      },
    }, strictAdvisorContext);
    const strictSelection = selectAutonomyDecisionCandidate([
      {
        id: 'blocked_implementation_task',
        order: 10,
        target: {
          work_type: 'task',
          title: 'Implement dashboard drag and drop',
          description: 'Write code for the dashboard interaction.',
        },
      },
      {
        id: 'aligned_help_request',
        order: 20,
        target: {
          work_type: 'help_teammate',
          title: 'Help debug a launch blocker',
          description: 'Investigate why the verification suite is blocked.',
        },
      },
    ], strictAdvisorContext);
    const strictNoSelection = selectAutonomyDecisionCandidate([
      {
        id: 'only_blocked_implementation',
        order: 10,
        target: {
          work_type: 'task',
          title: 'Implement dashboard drag and drop',
          description: 'Write code for the dashboard interaction.',
        },
      },
    ], strictAdvisorContext);

    assert(strictMismatchEvaluation.admissible === false, 'Strict contract mode must fail closed on mismatched unowned work in autonomy-v2 selection.', problems);
    assert(strictMismatchEvaluation.contract_admissibility && strictMismatchEvaluation.contract_admissibility.reason === 'strict_contract_mismatch', 'Strict contract mode must classify mismatched unowned work explicitly.', problems);
    assert(strictNeutralEvaluation.admissible === false, 'Strict contract mode must also fail closed when unowned work has no positive contract-fit signal.', problems);
    assert(strictNeutralEvaluation.contract_admissibility && strictNeutralEvaluation.contract_admissibility.reason === 'strict_contract_no_positive_fit', 'Strict contract mode must classify neutral unowned work explicitly when it is blocked.', problems);
    assert(strictAssignedEvaluation.admissible === true, 'Assigned-work precedence must remain intact even when strict contract mode marks the work as a weaker fit.', problems);
    assert(strictSelection && strictSelection.id === 'aligned_help_request', 'Stronger autonomy-v2 contract-aware selection must prefer aligned work over fail-closed mismatched work.', problems);
    assert(strictNoSelection === null, 'Stronger autonomy-v2 contract-aware selection must return no candidate when every available item is blocked by strict contract mismatch.', problems);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail(['Autonomy-v2 execution validation failed.', ...problems.map((problem) => `- ${problem}`)]);
  }

  console.log([
    'Autonomy-v2 execution validation passed.',
    '- Healthy branch-local autonomous workflows advance deterministically and emit branch-scoped evidence/workflow events.',
    '- Owner-unavailable stalled steps can change ownership only through an explicit policy-approved, same-branch, fail-closed recovery path.',
    '- Mixed-provider workflows stay branch-local while advancing between explicit provider/runtime owners.',
    '- Strict contract-aware autonomy-v2 selection now fail-closes mismatched unowned work while preserving assigned-work precedence.',
  ].join('\n'));
}

main();
