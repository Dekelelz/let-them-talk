#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { createStateIo } = require(path.resolve(__dirname, '..', 'state', 'io.js'));
const { createSessionsState } = require(path.resolve(__dirname, '..', 'state', 'sessions.js'));

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function extractBlock(source, startAnchor, endAnchor) {
  const startIndex = source.indexOf(startAnchor);
  if (startIndex === -1) return '';
  const endIndex = endAnchor ? source.indexOf(endAnchor, startIndex + startAnchor.length) : source.length;
  if (endIndex === -1) return source.slice(startIndex);
  return source.slice(startIndex, endIndex);
}

function countOccurrences(source, needle) {
  if (!needle) return 0;
  return source.split(needle).length - 1;
}

function buildWorkflow() {
  return {
    id: 'wf_context',
    name: 'Session-aware context workflow',
    status: 'active',
    created_by: 'alpha',
    created_at: '2026-04-16T03:20:00.000Z',
    updated_at: '2026-04-16T03:20:00.000Z',
    steps: [
      {
        id: 1,
        description: 'Complete the upstream verified step',
        assignee: 'alpha',
        depends_on: [],
        status: 'in_progress',
        started_at: '2026-04-16T03:20:00.000Z',
        completed_at: null,
        notes: '',
      },
      {
        id: 2,
        description: 'Resume from upstream evidence',
        assignee: 'alpha',
        depends_on: [1],
        status: 'pending',
        started_at: null,
        completed_at: null,
        notes: '',
      },
    ],
  };
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const registerBlock = extractBlock(serverSource, 'function toolRegister(name, provider = null) {', '// Update last_activity timestamp for this agent');
  const getWorkBlock = extractBlock(serverSource, 'async function toolGetWork(params = {}) {', 'async function toolVerifyAndAdvance(params) {');
  const getBriefingBlock = extractBlock(serverSource, 'function toolGetBriefing() {', 'function toolLockFile(filePath) {');

  assert(serverSource.includes('function getAuthoritativeSessionSummary(agentName = registeredName, branchName = currentBranch, sessionId = currentSessionId) {'), 'server.js must define getAuthoritativeSessionSummary() for manifest/index-backed resume lookup.', problems);
  assert(serverSource.includes('function buildAuthoritativeResumeContext(options = {}) {'), 'server.js must define buildAuthoritativeResumeContext() for session/evidence-first context assembly.', problems);
  assert(serverSource.includes('function collectMessageHandoffContext(messages, branchName = currentBranch) {'), 'server.js must define collectMessageHandoffContext() for evidence-backed message resume context.', problems);

  assert(registerBlock.includes('const recoveryContext = buildAuthoritativeResumeContext({'), 'toolRegister() must assemble recovery context from authoritative session/evidence helpers first.', problems);
  assert(registerBlock.includes('result.recovery.session_summary = recoveryContext.session_summary;'), 'toolRegister() recovery payload must expose the authoritative session summary.', problems);
  assert(registerBlock.includes('result.recovery.checkpoint_fallbacks = checkpointFallbacks;'), 'toolRegister() must keep workspace checkpoints as fallback recovery state.', problems);
  assert(registerBlock.includes('result.recovery.compatibility_hint = compatibilityHint;'), 'toolRegister() must downgrade recovery snapshots to compatibility fallback context instead of replacing the authoritative hint.', problems);

  assert(countOccurrences(getWorkBlock, 'buildAuthoritativeResumeContext({') >= 2, 'toolGetWork() must use authoritative session/evidence context in both the active-step and upcoming-step branches.', problems);
  assert(countOccurrences(getWorkBlock, 'resume_context: { message_handoffs: messageContext }') >= 2, 'toolGetWork() must enrich both message-return branches with evidence-backed handoff context.', problems);
  assert(getWorkBlock.includes('Fallback checkpoint (saved ${checkpoint.saved_at})'), 'toolGetWork() active-step branch must keep checkpoints as fallback after authoritative context.', problems);
  assert(getWorkBlock.includes('checkpoint_fallbacks contains older workspace WIP notes for this workflow if you need compatibility context.'), 'toolGetWork() upcoming-step branch must preserve checkpoint fallback wording after authoritative evidence context.', problems);

  assert(getBriefingBlock.includes('const briefingContext = buildAuthoritativeResumeContext({'), 'toolGetBriefing() must start from authoritative session/evidence context.', problems);
  assert(getBriefingBlock.includes('...(briefingContext.session_summary ? { session_summary: briefingContext.session_summary } : {}),'), 'toolGetBriefing() must surface the authoritative session summary in its response.', problems);
  assert(getBriefingBlock.includes('...(Object.keys(resumeContext).length > 0 ? { resume_context: resumeContext } : {}),'), 'toolGetBriefing() must expose resume_context before the heuristic message/task summary fields.', problems);
  assert(getBriefingBlock.indexOf('session_summary') !== -1 && getBriefingBlock.indexOf('session_summary') < getBriefingBlock.indexOf('recent_messages'), 'toolGetBriefing() must place session_summary before recent_messages in the response assembly.', problems);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-session-aware-context-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_task5c';
  const branchPaths = createBranchPathResolvers(dataDir);
  const io = createStateIo({ dataDir });
  const eventLog = createCanonicalEventLog({ dataDir });
  const sessionsState = createSessionsState({ io, branchPaths, canonicalEventLog: eventLog });
  const canonicalState = createCanonicalState({ dataDir, processPid: 5150 });

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(branchPaths.getWorkflowsFile(branchName), JSON.stringify([buildWorkflow()], null, 2));

    const activation = sessionsState.activateSession({
      agentName: 'alpha',
      branchName,
      provider: 'claude',
      reason: 'register',
      at: '2026-04-16T03:20:00.000Z',
    });
    const sessionSummary = sessionsState.getLatestSessionSummaryForAgent(branchName, 'alpha', {
      indexedAt: '2026-04-16T03:20:05.000Z',
    });

    assert(!!sessionSummary, 'sessionsState must be able to project an authoritative session summary for the active branch session.', problems);
    assert(sessionSummary && sessionSummary.session_id === activation.session.session_id, 'Projected session summary must track the active session manifest id.', problems);
    assert(sessionSummary && sessionSummary.branch_id === branchName, 'Projected session summary must remain branch-scoped.', problems);
    assert(sessionSummary && sessionSummary.state === 'active', 'Projected session summary must reflect the active session state.', problems);

    const completion = canonicalState.advanceWorkflow({
      workflowId: 'wf_context',
      actor: 'alpha',
      branch: branchName,
      sessionId: activation.session.session_id,
      expectedAssignee: 'alpha',
      sourceTool: 'verify_and_advance',
      evidence: {
        summary: 'Completed the upstream step with evidence',
        verification: 'Ran the Task 5C deterministic fixture',
        files_changed: ['agent-bridge/server.js'],
        confidence: 92,
      },
    });

    assert(completion.success, 'canonicalState.advanceWorkflow() must produce evidence-backed workflow context for the Task 5C fixture.', problems);
    assert(!!completion.evidence_ref, 'advanceWorkflow() must return an evidence reference for the completed upstream step.', problems);

    const projectedEvidence = canonicalState.projectEvidence(branchName, completion.evidence_ref);
    const workflows = readJson(branchPaths.getWorkflowsFile(branchName));
    const workflow = workflows.find((entry) => entry.id === 'wf_context');
    const completedStep = workflow.steps.find((step) => step.id === 1);
    const activeStep = workflow.steps.find((step) => step.status === 'in_progress');

    assert(!!projectedEvidence, 'canonicalState.projectEvidence() must resolve an evidence reference into the existing verification projection shape.', problems);
    assert(projectedEvidence && projectedEvidence.evidence_ref && projectedEvidence.evidence_ref.evidence_id === completion.evidence_ref.evidence_id, 'Projected evidence must preserve the evidence reference identity.', problems);
    assert(projectedEvidence && projectedEvidence.recorded_by_session === activation.session.session_id, 'Projected evidence must retain the recorded_by_session field for resume context.', problems);
    assert(projectedEvidence && projectedEvidence.summary === 'Completed the upstream step with evidence', 'Projected evidence must preserve the summary text for downstream briefing/work context.', problems);
    assert(completedStep && completedStep.verification && completedStep.verification.summary === projectedEvidence.summary, 'Workflow step verification projection must stay aligned with projectEvidence() output.', problems);
    assert(activeStep && activeStep.id === 2, 'Evidence-backed completion fixture must activate the dependency step for downstream prep/resume context.', problems);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail(['Session-aware context validation failed.', ...problems.map((problem) => `- ${problem}`)], 1);
  }

  console.log([
    'Session-aware context validation passed.',
    'Validated session summary and evidence projection helpers plus the targeted server seams for get_briefing(), get_work(), and register recovery.',
  ].join('\n'));
}

main();
