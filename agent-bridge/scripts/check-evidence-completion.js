#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

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

function buildWorkflow(id, description) {
  return {
    id,
    name: `Workflow ${id}`,
    status: 'active',
    created_by: 'alpha',
    created_at: '2026-04-16T02:15:00.000Z',
    updated_at: '2026-04-16T02:15:00.000Z',
    steps: [
      {
        id: 1,
        description,
        assignee: 'alpha',
        depends_on: [],
        status: 'in_progress',
        started_at: '2026-04-16T02:15:00.000Z',
        completed_at: null,
        notes: '',
      },
      {
        id: 2,
        description: `Follow-up for ${id}`,
        assignee: 'beta',
        depends_on: [1],
        status: 'pending',
        started_at: null,
        completed_at: null,
        notes: '',
      },
    ],
  };
}

function buildTask(id, title) {
  return {
    id,
    title,
    description: `${title} description`,
    status: 'pending',
    assignee: 'alpha',
    created_by: 'alpha',
    created_at: '2026-04-16T02:15:00.000Z',
    updated_at: '2026-04-16T02:15:00.000Z',
    notes: [],
  };
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const updateTaskBlock = extractBlock(serverSource, 'function toolUpdateTask(taskId, status, notes = null, evidence = null) {', 'function toolListTasks(status = null, assignee = null) {');
  const advanceWorkflowBlock = extractBlock(serverSource, 'function toolAdvanceWorkflow(workflowId, notes, evidence = null) {', 'function toolWorkflowStatus(workflowId) {');
  const verifyAndAdvanceBlock = extractBlock(serverSource, 'async function toolVerifyAndAdvance(params) {', 'function toolRetryWithImprovement(params) {');
  const handoffBlock = extractBlock(serverSource, 'function emitWorkflowHandoffMessages(options = {}) {', '// --- Tool implementations ---');
  const updateTaskSchemaBlock = extractBlock(serverSource, "name: 'update_task',", "name: 'list_tasks',");
  const advanceWorkflowSchemaBlock = extractBlock(serverSource, "name: 'advance_workflow',", "name: 'workflow_status',");

  assert(updateTaskBlock.includes('canonicalState.updateTaskStatus({'), 'toolUpdateTask() must route terminal completion through canonicalState.updateTaskStatus(...).', problems);
  assert(advanceWorkflowBlock.includes('canonicalState.advanceWorkflow({'), 'toolAdvanceWorkflow() must route advancement through canonicalState.advanceWorkflow(...).', problems);
  assert(verifyAndAdvanceBlock.includes('canonicalState.advanceWorkflow({'), 'toolVerifyAndAdvance() must route verified advancement through canonicalState.advanceWorkflow(...).', problems);
  assert(!verifyAndAdvanceBlock.includes('currentStep.verification = {'), 'toolVerifyAndAdvance() must not write inline verification on the workflow step directly.', problems);
  assert(handoffBlock.includes('evidence_ref: evidenceRef || null'), 'Workflow handoff messages must carry an evidence_ref field.', problems);
  assert(handoffBlock.includes('session_id: currentSessionId || null'), 'Workflow handoff messages must carry a session_id field.', problems);
  assert(handoffBlock.includes('canonicalState.appendMessage(msg, {'), 'Workflow handoff messages must use canonicalState.appendMessage(...) so canonical message metadata is preserved.', problems);
  assert(updateTaskSchemaBlock.includes('evidence: COMPLETION_EVIDENCE_INPUT_SCHEMA'), 'update_task tool schema must expose the evidence input object for terminal transitions.', problems);
  assert(advanceWorkflowSchemaBlock.includes('evidence: COMPLETION_EVIDENCE_INPUT_SCHEMA'), 'advance_workflow tool schema must expose the evidence input object.', problems);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-evidence-completion-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_task5b';
  const branchPaths = createBranchPathResolvers(dataDir);
  const canonicalState = createCanonicalState({ dataDir, processPid: 5150 });
  const eventLog = createCanonicalEventLog({ dataDir });

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(branchPaths.getWorkflowsFile(branchName), JSON.stringify([
      buildWorkflow('wf_verify_path', 'Verify and advance path'),
      buildWorkflow('wf_manual_advance', 'Manual advance path'),
      buildWorkflow('wf_missing_evidence', 'Evidence-less path should fail'),
    ], null, 2));
    fs.writeFileSync(branchPaths.getTasksFile(branchName), JSON.stringify([
      buildTask('task_missing_evidence', 'Task without evidence'),
      buildTask('task_evidence_backed', 'Task with evidence'),
    ], null, 2));

    const missingAdvance = canonicalState.advanceWorkflow({
      workflowId: 'wf_missing_evidence',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      sourceTool: 'advance_workflow',
    });
    assert(!!missingAdvance.error, 'advanceWorkflow() must reject evidence-less workflow advancement.', problems);

    const verifyAdvance = canonicalState.advanceWorkflow({
      workflowId: 'wf_verify_path',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      commandId: 'cmd_verify',
      correlationId: 'wf_verify_path',
      expectedAssignee: 'alpha',
      sourceTool: 'verify_and_advance',
      evidence: {
        summary: 'Implemented the first evidence-backed verify path',
        verification: 'Ran the deterministic evidence validation fixture',
        files_changed: ['agent-bridge/server.js', 'agent-bridge/state/canonical.js'],
        confidence: 88,
        learnings: 'Keep evidence authoritative and thin.',
      },
    });
    assert(verifyAdvance.success, 'advanceWorkflow() should succeed for the verify_and_advance evidence path.', problems);
    assert(verifyAdvance.evidence_ref && verifyAdvance.evidence_ref.branch_id === branchName, 'Verified advancement must return a branch-scoped evidence reference.', problems);

    const manualAdvance = canonicalState.advanceWorkflow({
      workflowId: 'wf_manual_advance',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      commandId: 'cmd_manual',
      correlationId: 'wf_manual_advance',
      sourceTool: 'advance_workflow',
      evidence: {
        summary: 'Manually advanced the workflow with evidence',
        verification: 'Checked step state and next-step activation',
        files_changed: ['agent-bridge/state/evidence.js'],
        confidence: 91,
      },
    });
    assert(manualAdvance.success, 'advanceWorkflow() should succeed for the manual advance_workflow evidence path.', problems);
    assert(Array.isArray(manualAdvance.next_steps) && manualAdvance.next_steps.length === 1, 'Manual workflow advancement should activate the next ready step.', problems);

    const missingTaskEvidence = canonicalState.updateTaskStatus({
      taskId: 'task_missing_evidence',
      status: 'done',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      sourceTool: 'update_task',
    });
    assert(!!missingTaskEvidence.error, 'updateTaskStatus() must reject evidence-less terminal task completion.', problems);

    const taskCompletion = canonicalState.updateTaskStatus({
      taskId: 'task_evidence_backed',
      status: 'done',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      commandId: 'cmd_task',
      correlationId: 'task_evidence_backed',
      sourceTool: 'update_task',
      evidence: {
        summary: 'Completed the task with canonical evidence',
        verification: 'Validated task projection and event references',
        files_changed: ['docs/architecture/runtime-contract.md'],
        confidence: 93,
      },
    });
    assert(taskCompletion.success, 'updateTaskStatus() should succeed for evidence-backed task completion.', problems);
    assert(taskCompletion.evidence_ref && taskCompletion.evidence_ref.evidence_id, 'Task completion must return an evidence reference.', problems);

    const evidenceFile = branchPaths.getEvidenceFile(branchName);
    const mainEvidenceFile = branchPaths.getEvidenceFile('main');
    const evidenceStore = readJson(evidenceFile);
    const workflows = readJson(branchPaths.getWorkflowsFile(branchName));
    const tasks = readJson(branchPaths.getTasksFile(branchName));
    const branchEvents = eventLog.readBranchEvents(branchName);
    const branchEventTypes = branchEvents.map((event) => event.type);
    const verifyWorkflow = workflows.find((workflow) => workflow.id === 'wf_verify_path');
    const manualWorkflow = workflows.find((workflow) => workflow.id === 'wf_manual_advance');
    const completedTask = tasks.find((task) => task.id === 'task_evidence_backed');

    assert(fs.existsSync(evidenceFile), 'Evidence-backed completions must materialize a branch-scoped evidence file.', problems);
    assert(!fs.existsSync(mainEvidenceFile), 'Evidence recorded on a feature branch must not leak into the main-branch evidence file.', problems);
    assert(Array.isArray(evidenceStore.records) && evidenceStore.records.length === 3, 'Evidence store should contain one record for verify_and_advance, one for advance_workflow, and one for task completion.', problems);
    assert(evidenceStore.records.every((record) => record.recorded_by_session === 'session_alpha'), 'Evidence records must retain the originating session id.', problems);
    assert(evidenceStore.records.some((record) => record.source_tool === 'verify_and_advance'), 'Evidence store must retain verify_and_advance provenance.', problems);
    assert(evidenceStore.records.some((record) => record.source_tool === 'advance_workflow'), 'Evidence store must retain advance_workflow provenance.', problems);
    assert(evidenceStore.records.some((record) => record.source_tool === 'update_task'), 'Evidence store must retain update_task provenance.', problems);

    assert(verifyWorkflow.steps[0].status === 'done', 'Verified workflow step should be marked done.', problems);
    assert(verifyWorkflow.steps[0].evidence_ref && verifyWorkflow.steps[0].evidence_ref.evidence_id === verifyAdvance.evidence_ref.evidence_id, 'Verified workflow step must reference its evidence record.', problems);
    assert(verifyWorkflow.steps[1].status === 'in_progress', 'Verified workflow advancement should start the next pending step.', problems);
    assert(manualWorkflow.steps[0].evidence_ref && manualWorkflow.steps[0].evidence_ref.evidence_id === manualAdvance.evidence_ref.evidence_id, 'Manual workflow advancement must reference its evidence record.', problems);
    assert(completedTask.status === 'done', 'Evidence-backed task completion must mark the task done.', problems);
    assert(completedTask.evidence_ref && completedTask.evidence_ref.evidence_id === taskCompletion.evidence_ref.evidence_id, 'Completed task must reference its evidence record.', problems);

    assert(branchEventTypes.filter((type) => type === 'evidence.recorded').length === 3, 'Canonical branch events must record three evidence.recorded events for the successful targeted paths.', problems);
    assert(branchEventTypes.includes('workflow.step_completed'), 'Canonical branch events must include workflow.step_completed for evidence-backed workflow advancement.', problems);
    assert(branchEventTypes.includes('task.completed'), 'Canonical branch events must include task.completed for evidence-backed task completion.', problems);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail(['Evidence-backed completion validation failed.', ...problems.map((problem) => `- ${problem}`)], 1);
  }

  console.log([
    'Evidence-backed completion validation passed.',
    'Validated canonical evidence storage by reference for verify_and_advance, advance_workflow, and terminal update_task flows.',
    'Validated evidence-less terminal transitions fail closed and workflow handoffs keep evidence/session linkage in the server routing layer.',
  ].join('\n'));
}

main();
