#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');
const {
  evaluateAutonomyCandidate,
  rankClaimableTasks,
  resolveAgentDecisionContext,
  selectAutonomyDecisionCandidate,
} = require(path.resolve(__dirname, '..', 'autonomy', 'decision-v2.js'));
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

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const getWorkBlock = extractBlock(serverSource, 'async function toolGetWork(params = {}) {', 'async function toolVerifyAndAdvance(params) {');

  assert(serverSource.includes("require('./autonomy/decision-v2')"), 'server.js must load the shared autonomy-v2 decision helper module.', problems);
  assert(getWorkBlock.includes('const decisionContext = buildAutonomyDecisionContext(contract, skills, agents);'), 'toolGetWork() must build an autonomy-v2 decision context before selecting work.', problems);
  assert(getWorkBlock.includes('rankClaimableTasks('), 'toolGetWork() must rank self-claimable tasks through the autonomy-v2 decision helper.', problems);
  assert(getWorkBlock.includes('selectAutonomyDecisionCandidate(prelistenCandidates, decisionContext)'), 'toolGetWork() must select pre-listen work from explicit ranked candidates.', problems);
  assert(getWorkBlock.includes('selectAutonomyDecisionCandidate(postlistenCandidates, decisionContext)'), 'toolGetWork() must select post-listen work from explicit ranked candidates.', problems);
  assert(getWorkBlock.includes('attachCapabilityAdvisory('), 'toolGetWork() must surface capability advisory metadata from the autonomy-v2 decision helper when relevant.', problems);
  assert(!getWorkBlock.includes('const unassigned = findUnassignedTasks(skills);'), 'toolGetWork() must no longer fall back to the old direct findUnassignedTasks(skills) heuristic seam.', problems);

  const reviewerContext = resolveAgentDecisionContext({
    agentName: 'qa_agent',
    branchId: 'main',
    sessionSummary: { session_id: 'sess_qa', branch_id: 'main', state: 'active' },
    contract: resolveAgentContract({ role: 'quality', archetype: 'reviewer', skills: ['testing'] }),
    agentRecord: { runtime_type: 'cli' },
  });

  const assignedPrecedenceSelection = selectAutonomyDecisionCandidate([
    {
      id: 'task_followup',
      order: 20,
      target: {
        work_type: 'task',
        title: 'Review follow-up notes',
        description: 'Write the release summary',
      },
    },
    {
      id: 'assigned_media_step',
      order: 10,
      target: {
        work_type: 'workflow_step',
        title: 'Produce the release video',
        description: 'Assigned media step',
        assigned: true,
        assignment_priority: 'active',
        required_capabilities: ['video_generation'],
        session_summary: { session_id: 'sess_qa', branch_id: 'main', state: 'active' },
        resume_context: { dependency_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_dep' } } }] },
      },
    },
  ], reviewerContext);
  assert(!!assignedPrecedenceSelection, 'Assigned-precedence fixture must yield a selected candidate.', problems);
  assert(assignedPrecedenceSelection && assignedPrecedenceSelection.id === 'assigned_media_step', 'Explicitly assigned workflow work must still outrank non-assigned work even when capability fit is weaker.', problems);
  assert(assignedPrecedenceSelection && assignedPrecedenceSelection.evaluation.capability_advisory.status === 'mismatch', 'Assigned precedence fixture must expose capability mismatch advisory instead of silently overriding ownership.', problems);
  assert(assignedPrecedenceSelection && assignedPrecedenceSelection.evaluation.capability_advisory.admissible === true, 'Assigned precedence fixture must keep assigned work admissible in the decision-only slice.', problems);

  const imageCapableContext = resolveAgentDecisionContext({
    agentName: 'media_agent',
    branchId: 'main',
    contract: resolveAgentContract({ archetype: 'implementer', skills: ['media'] }),
    agentRecord: {
      runtime_type: 'api',
      provider_id: 'gemini',
      model_id: 'gemini-image',
      capabilities: ['image_generation'],
    },
  });
  const chatOnlyContext = resolveAgentDecisionContext({
    agentName: 'chat_agent',
    branchId: 'main',
    contract: resolveAgentContract({ archetype: 'implementer', skills: ['media'] }),
    agentRecord: { runtime_type: 'cli' },
  });
  const capabilityCandidates = [
    {
      id: 'image_asset_task',
      order: 10,
      target: {
        work_type: 'task',
        title: 'Render release poster',
        description: 'Create the poster asset for the launch',
        required_capabilities: ['image_generation'],
      },
    },
    {
      id: 'text_release_task',
      order: 20,
      target: {
        work_type: 'task',
        title: 'Write release notes',
        description: 'Document the launch details',
      },
    },
  ];
  const imageSelection = selectAutonomyDecisionCandidate(capabilityCandidates, imageCapableContext);
  const chatSelection = selectAutonomyDecisionCandidate(capabilityCandidates, chatOnlyContext);
  assert(imageSelection && imageSelection.id === 'image_asset_task', 'Capability-aware selection must prefer explicitly image-capable work when the runtime advertises the required capability.', problems);
  assert(chatSelection && chatSelection.id === 'text_release_task', 'Capability-aware selection must skip inadmissible media work instead of silently assigning it to a runtime that lacks the required capability.', problems);

  const reviewPreferredSelection = selectAutonomyDecisionCandidate([
    {
      id: 'implementation_task',
      order: 20,
      target: {
        work_type: 'task',
        title: 'Implement dashboard drag and drop',
        description: 'Write the feature code and wire the client behavior',
      },
    },
    {
      id: 'review_request',
      order: 10,
      target: {
        work_type: 'review',
        title: 'Review API regression fix',
        description: 'Verify tests and review the patch for regressions',
      },
    },
  ], reviewerContext);
  assert(reviewPreferredSelection && reviewPreferredSelection.id === 'review_request', 'Contract-aware selection must be able to rank review work above generic implementation work for reviewer-style agents.', problems);

  const prepWithEvidence = evaluateAutonomyCandidate({
    target: {
      work_type: 'prep_work',
      title: 'Prepare for downstream implementation',
      description: 'Read the latest verified upstream context',
      assigned: true,
      assignment_priority: 'assigned',
      session_summary: { session_id: 'sess_qa', branch_id: 'main', state: 'active' },
      resume_context: {
        dependency_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_dep' } } }],
        recent_evidence: [{ evidence: { evidence_ref: { evidence_id: 'ev_recent' } } }],
      },
    },
  }, reviewerContext);
  const prepWithoutEvidence = evaluateAutonomyCandidate({
    target: {
      work_type: 'prep_work',
      title: 'Prepare for downstream implementation',
      description: 'Read the latest verified upstream context',
      assigned: true,
      assignment_priority: 'assigned',
    },
  }, reviewerContext);
  assert(prepWithEvidence.resume_signal_count > prepWithoutEvidence.resume_signal_count, 'Session/evidence-aware evaluation must count resume signals when authoritative resume context is present.', problems);
  assert(prepWithEvidence.score > prepWithoutEvidence.score, 'Session/evidence-aware evaluation must boost ranked prep work when authoritative resume context is present.', problems);

  const rankedTasks = rankClaimableTasks([
    { id: 'docs_task', status: 'pending', title: 'Refresh docs', description: 'Documentation cleanup' },
    { id: 'backend_task', status: 'pending', title: 'Implement backend route', description: 'Backend service endpoint for launch flows' },
  ], resolveAgentDecisionContext({
    agentName: 'builder',
    branchId: 'main',
    contract: resolveAgentContract({ archetype: 'implementer' }),
    agentRecord: { runtime_type: 'cli' },
    availableSkills: ['backend'],
  }), {
    allTasks: [
      { id: 'done_backend', assignee: 'builder', status: 'done', title: 'Fix backend auth', description: 'Backend service token refresh path' },
      { id: 'other_done', assignee: 'someone_else', status: 'done', title: 'Tidy styles', description: 'CSS cleanup' },
    ],
    availableSkills: ['backend'],
  });
  assert(rankedTasks.length === 2, 'rankClaimableTasks() must keep admissible pending tasks available for selection.', problems);
  assert(rankedTasks[0] && rankedTasks[0].task.id === 'backend_task', 'rankClaimableTasks() must preserve the historical-affinity behavior for self-claimable tasks inside the autonomy-v2 selector.', problems);

  if (problems.length > 0) {
    fail(['Autonomy-v2 decision validation failed.', ...problems.map((problem) => `- ${problem}`)]);
  }

  console.log([
    'Autonomy-v2 decision validation passed.',
    '- get_work now selects from explicit ranked candidates built on the shared autonomy-v2 helper.',
    '- Assigned work stays admissible and takes precedence even when capability fit is weaker.',
    '- Capability metadata gates self-claimable work without silently reassigning existing ownership.',
    '- Contract fit can rerank non-assigned work, while session/evidence resume signals boost context-rich prep decisions.',
    '- Historical self-claim task affinity remains preserved inside the new selector.',
  ].join('\n'));
}

main();
