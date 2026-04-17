#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const SERVER_FILE = path.resolve(__dirname, '..', 'server.js');
const CANONICAL_FILE = path.resolve(__dirname, '..', 'state', 'canonical.js');
const LOG_FILE = path.resolve(__dirname, '..', 'events', 'log.js');
const HOOKS_FILE = path.resolve(__dirname, '..', 'events', 'hooks.js');

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
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

function buildTask(id, title) {
  return {
    id,
    title,
    description: `${title} description`,
    status: 'pending',
    assignee: null,
    created_by: 'alpha',
    created_at: '2026-04-16T18:00:10.000Z',
    updated_at: '2026-04-16T18:00:10.000Z',
    notes: [],
  };
}

function buildWorkflow(id, description) {
  return {
    id,
    name: `Workflow ${id}`,
    status: 'active',
    autonomous: true,
    parallel: false,
    created_by: 'alpha',
    created_at: '2026-04-16T18:00:20.000Z',
    updated_at: '2026-04-16T18:00:20.000Z',
    steps: [
      {
        id: 1,
        description,
        assignee: 'alpha',
        depends_on: [],
        status: 'in_progress',
        started_at: '2026-04-16T18:00:20.000Z',
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

function assertHookTopics(events, hooks, topic, problems, label) {
  const expectedEventIds = events.filter((event) => event.type === topic).map((event) => event.event_id);
  const actualHookEventIds = hooks.filter((hook) => hook.topic === topic).map((hook) => hook.event_id);
  assert(
    JSON.stringify(actualHookEventIds) === JSON.stringify(expectedEventIds),
    `${label} hooks for ${topic} must mirror committed canonical events 1:1.`,
    problems
  );
}

function main() {
  const problems = [];
  const serverSource = fs.readFileSync(SERVER_FILE, 'utf8');
  const canonicalSource = fs.readFileSync(CANONICAL_FILE, 'utf8');
  const logSource = fs.readFileSync(LOG_FILE, 'utf8');
  const hooksSource = fs.readFileSync(HOOKS_FILE, 'utf8');

  const registerBlock = extractBlock(serverSource, 'function toolRegister(name, provider = null) {', '// Update last_activity timestamp for this agent');
  const conversationModeBlock = extractBlock(serverSource, 'function toolSetConversationMode(mode) {', '// --- Managed mode tools ---');
  const claimManagerBlock = extractBlock(serverSource, 'function toolClaimManager() {', 'function toolYieldFloor(to, prompt = null) {');
  const yieldFloorBlock = extractBlock(serverSource, 'function toolYieldFloor(to, prompt = null) {', 'function toolSetPhase(phase) {');
  const setPhaseBlock = extractBlock(serverSource, 'function toolSetPhase(phase) {', '// Deterministic stagger delay based on agent name');
  const createTaskBlock = extractBlock(serverSource, 'function toolCreateTask(title, description = \'\', assignee = null) {', 'function toolUpdateTask(taskId, status, notes = null, evidence = null) {');
  const updateTaskBlock = extractBlock(serverSource, 'function toolUpdateTask(taskId, status, notes = null, evidence = null) {', 'function toolListTasks(status = null, assignee = null) {');
  const workspaceWriteBlock = extractBlock(serverSource, 'function toolWorkspaceWrite(key, content) {', 'function toolWorkspaceRead(key, agent) {');
  const createWorkflowBlock = extractBlock(serverSource, 'function toolCreateWorkflow(name, steps, autonomous = false, parallel = false) {', 'function toolAdvanceWorkflow(workflowId, notes, evidence = null) {');
  const logDecisionBlock = extractBlock(serverSource, 'function toolLogDecision(decision, reasoning, topic) {', 'function toolGetDecisions(topic) {');
  const kbWriteBlock = extractBlock(serverSource, 'function toolKBWrite(key, content) {', 'function toolKBRead(key) {');
  const progressBlock = extractBlock(serverSource, 'function toolUpdateProgress(feature, percent, notes) {', 'function toolGetProgress() {');
  const callVoteBlock = extractBlock(serverSource, 'function toolCallVote(question, options) {', 'function toolCastVote(voteId, choice) {');
  const castVoteBlock = extractBlock(serverSource, 'function toolCastVote(voteId, choice) {', 'function toolVoteStatus(voteId) {');
  const requestReviewBlock = extractBlock(serverSource, 'function toolRequestReview(filePath, description) {', 'function toolSubmitReview(reviewId, status, feedback) {');
  const submitReviewBlock = extractBlock(serverSource, 'function toolSubmitReview(reviewId, status, feedback) {', 'function toolDeclareDependency(taskId, dependsOnTaskId) {');
  const declareDependencyBlock = extractBlock(serverSource, 'function toolDeclareDependency(taskId, dependsOnTaskId) {', 'function toolCheckDependencies(taskId) {');
  const addRuleBlock = extractBlock(serverSource, 'function toolAddRule(text, category = \'custom\') {', 'function toolListRules() {');
  const removeRuleBlock = extractBlock(serverSource, 'function toolRemoveRule(ruleId) {', 'function toolToggleRule(ruleId) {');
  const toggleRuleBlock = extractBlock(serverSource, 'function toolToggleRule(ruleId) {', '// --- MCP Server setup ---');
  const exitBlock = extractBlock(serverSource, "process.on('exit', () => {", "process.on('SIGTERM', () => process.exit(0));");

  assert(hooksSource.includes('topic: event.type'), 'Hook projection must key topic directly from canonical event type.', problems);
  assert(!hooksSource.includes('appendEvent('), 'Hook projection must not append canonical events or create a second event store.', problems);
  assert(logSource.includes('onCommitted(cloneJsonValue(event));'), 'Canonical event log must feed hook projection only after append succeeds.', problems);
  assert(canonicalSource.includes('function appendCanonicalEvent(params = {}) {'), 'canonical state must expose a shared canonical append helper.', problems);
  assert(canonicalSource.includes('readHooks,'), 'canonical state must expose the hook subscription surface.', problems);
  assert(canonicalSource.includes("type: 'workflow.step_started'"), 'canonical workflow helpers must emit workflow.step_started where steps enter progress.', problems);
  assert(canonicalSource.includes("type: 'workflow.step_reassigned'"), 'canonical workflow helpers must emit workflow.step_reassigned.', problems);
  assert(canonicalSource.includes('function saveWorkspace(agentName, workspace, params = {}) {'), 'canonical state must expose saveWorkspace().', problems);
  assert(canonicalSource.includes("type: 'workspace.written'"), 'canonical state must emit workspace.written.', problems);
  assert(canonicalSource.includes('function logDecision(params = {}) {'), 'canonical state must expose logDecision().', problems);
  assert(canonicalSource.includes("type: 'decision.logged'"), 'canonical state must emit decision.logged.', problems);
  assert(canonicalSource.includes('function writeKnowledgeBaseEntry(params = {}) {'), 'canonical state must expose writeKnowledgeBaseEntry().', problems);
  assert(canonicalSource.includes("type: 'kb.written'"), 'canonical state must emit kb.written.', problems);
  assert(canonicalSource.includes('function updateProgressRecord(params = {}) {'), 'canonical state must expose updateProgressRecord().', problems);
  assert(canonicalSource.includes("type: 'progress.updated'"), 'canonical state must emit progress.updated.', problems);
  assert(canonicalSource.includes('function createVote(params = {}) {'), 'canonical state must expose createVote().', problems);
  assert(canonicalSource.includes('function castVote(params = {}) {'), 'canonical state must expose castVote().', problems);
  assert(canonicalSource.includes("type: 'vote.called'"), 'canonical state must emit vote.called.', problems);
  assert(canonicalSource.includes("type: 'vote.cast'"), 'canonical state must emit vote.cast.', problems);
  assert(canonicalSource.includes("type: 'vote.resolved'"), 'canonical state must emit vote.resolved.', problems);
  assert(canonicalSource.includes('function addRule(params = {}) {'), 'canonical state must expose addRule().', problems);
  assert(canonicalSource.includes('function toggleRule(params = {}) {'), 'canonical state must expose toggleRule().', problems);
  assert(canonicalSource.includes('function removeRule(params = {}) {'), 'canonical state must expose removeRule().', problems);
  assert(canonicalSource.includes("type: 'rule.added'"), 'canonical state must emit rule.added.', problems);
  assert(canonicalSource.includes("type: 'rule.toggled'"), 'canonical state must emit rule.toggled.', problems);
  assert(canonicalSource.includes("type: 'rule.removed'"), 'canonical state must emit rule.removed.', problems);

  assert(registerBlock.includes("type: 'agent.registered'"), 'toolRegister() must emit agent.registered.', problems);
  assert(serverSource.includes('canonicalState.recordAgentHeartbeat(name,'), 'Server heartbeat helper must route through canonicalState.recordAgentHeartbeat(...).', problems);
  assert(serverSource.includes('canonicalState.setAgentListeningState(registeredName, isListening'), 'Listening transitions must route through canonicalState.setAgentListeningState(...).', problems);
  assert(serverSource.includes('canonicalState.updateAgentBranch(registeredName, branchName'), 'Branch activation must route through canonicalState.updateAgentBranch(...).', problems);
  assert(exitBlock.includes("type: 'agent.unregistered'"), 'Graceful exit cleanup must emit agent.unregistered.', problems);
  assert(conversationModeBlock.includes("type: 'conversation.mode_updated'"), 'set_conversation_mode must emit conversation.mode_updated.', problems);
  assert(claimManagerBlock.includes("type: 'conversation.manager_claimed'"), 'claim_manager must emit conversation.manager_claimed.', problems);
  assert(yieldFloorBlock.includes("type: 'conversation.floor_yielded'"), 'yield_floor must emit conversation.floor_yielded.', problems);
  assert(setPhaseBlock.includes("type: 'conversation.phase_updated'"), 'set_phase must emit conversation.phase_updated.', problems);
  assert(createTaskBlock.includes('canonicalState.createTask({'), 'create_task must route through canonicalState.createTask(...).', problems);
  assert(updateTaskBlock.includes('canonicalState.updateTaskStatus({'), 'update_task must route status transitions through canonicalState.updateTaskStatus(...).', problems);
  assert(workspaceWriteBlock.includes('saveWorkspace(registeredName, ws, { key, keys: [key] });'), 'workspace_write must persist through saveWorkspace(...).', problems);
  assert(serverSource.includes('const result = canonicalState.saveWorkspace(agentName, data, {'), 'workspace save helper must route through canonicalState.saveWorkspace(...).', problems);
  assert(createWorkflowBlock.includes('canonicalState.createWorkflow({'), 'create_workflow must route through canonicalState.createWorkflow(...).', problems);
  assert(logDecisionBlock.includes('canonicalState.logDecision({'), 'log_decision must route through canonicalState.logDecision(...).', problems);
  assert(kbWriteBlock.includes('canonicalState.writeKnowledgeBaseEntry({'), 'kb_write must route through canonicalState.writeKnowledgeBaseEntry(...).', problems);
  assert(progressBlock.includes('canonicalState.updateProgressRecord({'), 'update_progress must route through canonicalState.updateProgressRecord(...).', problems);
  assert(callVoteBlock.includes('canonicalState.createVote({'), 'call_vote must route through canonicalState.createVote(...).', problems);
  assert(castVoteBlock.includes('canonicalState.castVote({'), 'cast_vote must route through canonicalState.castVote(...).', problems);
  assert(requestReviewBlock.includes("type: 'review.requested'"), 'request_review must emit review.requested.', problems);
  assert(submitReviewBlock.includes("type: 'review.submitted'"), 'submit_review must emit review.submitted.', problems);
  assert(declareDependencyBlock.includes("type: 'dependency.declared'"), 'declare_dependency must emit dependency.declared.', problems);
  assert(updateTaskBlock.includes("type: 'dependency.resolved'"), 'Task completion dependency resolution must emit dependency.resolved.', problems);
  assert(addRuleBlock.includes('canonicalState.addRule({'), 'add_rule must route through canonicalState.addRule(...).', problems);
  assert(removeRuleBlock.includes('canonicalState.removeRule({'), 'remove_rule must route through canonicalState.removeRule(...).', problems);
  assert(toggleRuleBlock.includes('canonicalState.toggleRule({'), 'toggle_rule must route through canonicalState.toggleRule(...).', problems);

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-lifecycle-hooks-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_hooks';
  const canonicalState = createCanonicalState({ dataDir, processPid: 5150 });
  const eventLog = createCanonicalEventLog({ dataDir });

  try {
    fs.mkdirSync(dataDir, { recursive: true });

    canonicalState.registerApiAgent({
      name: 'alpha',
      sessionId: 'session_alpha',
      reason: 'api_register',
      agent: {
        pid: 5150,
        timestamp: '2026-04-16T18:00:00.000Z',
        last_activity: '2026-04-16T18:00:00.000Z',
        provider: 'claude',
        branch: 'main',
        started_at: '2026-04-16T18:00:00.000Z',
        status: 'active',
      },
    });
    canonicalState.updateAgentStatus('alpha', 'sleeping', { actorAgent: 'alpha', sessionId: 'session_alpha', reason: 'idle' });
    canonicalState.updateAgentHeartbeat('alpha', { actorAgent: 'alpha', sessionId: 'session_alpha', reason: 'api_heartbeat' });
    canonicalState.updateAgentBranch('alpha', branchName, { actorAgent: 'alpha', sessionId: 'session_alpha', reason: 'branch_activate' });
    canonicalState.setAgentListeningState('alpha', true, { actorAgent: 'alpha', sessionId: 'session_alpha', reason: 'listen_start' });

    const task = buildTask('task_hooks', 'Hook lifecycle task');
    const createdTask = canonicalState.createTask({ task, actor: 'alpha', branch: branchName, sessionId: 'session_alpha', correlationId: task.id });
    assert(createdTask.success, 'Fixture task creation should succeed.', problems);

    const claimedTask = canonicalState.updateTaskStatus({
      taskId: task.id,
      status: 'in_progress',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: task.id,
      assignee: 'alpha',
      trackAttemptAgent: true,
      expectedStatuses: ['pending'],
    });
    assert(claimedTask.success, 'Fixture task claim should succeed.', problems);

    const workflow = buildWorkflow('wf_hooks', 'Hook lifecycle workflow');
    const createdWorkflow = canonicalState.createWorkflow({ workflow, actor: 'alpha', branch: branchName, sessionId: 'session_alpha', correlationId: workflow.id });
    assert(createdWorkflow.success, 'Fixture workflow creation should succeed.', problems);

    const reassigned = canonicalState.reassignWorkflowStep({
      workflowId: workflow.id,
      stepId: 1,
      newAssignee: 'beta',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: workflow.id,
    });
    assert(reassigned.success, 'Fixture workflow reassignment should succeed.', problems);

    const paused = canonicalState.pausePlan({ actor: 'alpha', branch: branchName, sessionId: 'session_alpha', correlationId: workflow.id });
    const resumed = canonicalState.resumePlan({ actor: 'alpha', branch: branchName, sessionId: 'session_alpha', correlationId: workflow.id });
    const stopped = canonicalState.stopPlan({ actor: 'alpha', branch: branchName, sessionId: 'session_alpha', correlationId: workflow.id });
    assert(paused.success && resumed.success && stopped.success, 'Fixture pause/resume/stop workflow transitions should succeed.', problems);

    const modeEvent = canonicalState.appendCanonicalEvent({
      type: 'conversation.mode_updated',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'session_alpha',
      correlationId: branchName,
      payload: {
        mode: 'managed',
        previous_mode: 'direct',
        updated_at: '2026-04-16T18:01:00.000Z',
      },
    });
    const reviewRequested = canonicalState.appendCanonicalEvent({
      type: 'review.requested',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'session_alpha',
      correlationId: 'rev_hooks',
      payload: {
        review_id: 'rev_hooks',
        file: 'agent-bridge/server.js',
        requested_by: 'alpha',
        status: 'pending',
      },
    });
    canonicalState.appendCanonicalEvent({
      type: 'review.submitted',
      branchId: branchName,
      actorAgent: 'beta',
      sessionId: 'session_beta',
      causationId: reviewRequested.event_id,
      correlationId: 'rev_hooks',
      payload: {
        review_id: 'rev_hooks',
        file: 'agent-bridge/server.js',
        reviewer: 'beta',
        requested_by: 'alpha',
        status: 'approved',
      },
    });
    const dependencyDeclared = canonicalState.appendCanonicalEvent({
      type: 'dependency.declared',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'session_alpha',
      correlationId: 'dep_hooks',
      payload: {
        dependency_id: 'dep_hooks',
        task_id: task.id,
        depends_on: 'task_root',
        declared_by: 'alpha',
      },
    });
    canonicalState.appendCanonicalEvent({
      type: 'dependency.resolved',
      branchId: branchName,
      actorAgent: 'alpha',
      sessionId: 'session_alpha',
      causationId: dependencyDeclared.event_id,
      correlationId: 'dep_hooks',
      payload: {
        dependency_id: 'dep_hooks',
        task_id: task.id,
        depends_on: 'task_root',
        resolved_by_task_id: 'task_root',
        reason: 'fixture_resolution',
      },
    });

    const workspaceWrite = canonicalState.saveWorkspace('alpha', {
      note: {
        content: 'Workspace event fixture',
        updated_at: '2026-04-16T18:02:00.000Z',
      },
    }, {
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      key: 'note',
      keys: ['note'],
      correlationId: 'workspace_hooks',
      updatedAt: '2026-04-16T18:02:00.000Z',
    });
    const loggedDecision = canonicalState.logDecision({
      entry: {
        id: 'dec_hooks',
        decision: 'Route governance writes through canonical helpers',
        topic: 'architecture',
        decided_by: 'alpha',
        decided_at: '2026-04-16T18:02:10.000Z',
      },
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'dec_hooks',
    });
    const kbWrite = canonicalState.writeKnowledgeBaseEntry({
      key: 'lesson_hooks',
      value: {
        content: 'Canonical governance writes emit real events now.',
        updated_by: 'alpha',
        updated_at: '2026-04-16T18:02:20.000Z',
      },
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'lesson_hooks',
      maxEntries: 100,
    });
    const progressUpdate = canonicalState.updateProgressRecord({
      feature: 'governance-hooks',
      value: {
        percent: 42,
        notes: 'Hook fixture update',
        updated_by: 'alpha',
        updated_at: '2026-04-16T18:02:30.000Z',
      },
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'governance-hooks',
    });
    const createdVote = canonicalState.createVote({
      vote: {
        id: 'vote_hooks',
        question: 'Use canonical governance helpers?',
        options: ['yes', 'no'],
        votes: {},
        status: 'open',
        created_by: 'alpha',
        created_at: '2026-04-16T18:02:40.000Z',
      },
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'vote_hooks',
    });
    const castVoteAlpha = canonicalState.castVote({
      voteId: 'vote_hooks',
      voter: 'alpha',
      choice: 'yes',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'vote_hooks',
      onlineAgents: ['alpha', 'beta'],
    });
    const castVoteBeta = canonicalState.castVote({
      voteId: 'vote_hooks',
      voter: 'beta',
      choice: 'yes',
      actor: 'beta',
      branch: branchName,
      sessionId: 'session_beta',
      correlationId: 'vote_hooks',
      onlineAgents: ['alpha', 'beta'],
    });
    const addedRule = canonicalState.addRule({
      rule: {
        id: 'rule_hooks',
        text: 'Use canonical state helpers',
        category: 'workflow',
        priority: 'high',
        created_by: 'alpha',
        created_at: '2026-04-16T18:02:50.000Z',
        active: true,
      },
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'rule_hooks',
    });
    const toggledRule = canonicalState.toggleRule({
      ruleId: 'rule_hooks',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'rule_hooks',
    });
    const removedRule = canonicalState.removeRule({
      ruleId: 'rule_hooks',
      actor: 'alpha',
      branch: branchName,
      sessionId: 'session_alpha',
      correlationId: 'rule_hooks',
    });

    assert(workspaceWrite && workspaceWrite.event && workspaceWrite.event.type === 'workspace.written', 'Fixture workspace write should emit workspace.written.', problems);
    assert(loggedDecision && loggedDecision.success, 'Fixture decision log should succeed.', problems);
    assert(kbWrite && kbWrite.success, 'Fixture KB write should succeed.', problems);
    assert(progressUpdate && progressUpdate.success, 'Fixture progress update should succeed.', problems);
    assert(createdVote && createdVote.success, 'Fixture vote creation should succeed.', problems);
    assert(castVoteAlpha && castVoteAlpha.success, 'Fixture first vote cast should succeed.', problems);
    assert(castVoteBeta && castVoteBeta.success, 'Fixture second vote cast should succeed.', problems);
    assert(addedRule && addedRule.success, 'Fixture rule add should succeed.', problems);
    assert(toggledRule && toggledRule.success, 'Fixture rule toggle should succeed.', problems);
    assert(removedRule && removedRule.success, 'Fixture rule removal should succeed.', problems);

    canonicalState.unregisterApiAgent('alpha', { sessionId: 'session_alpha', reason: 'api_unregister' });

    const runtimeEvents = eventLog.readEvents({ stream: 'runtime' });
    const branchEvents = eventLog.readBranchEvents(branchName);
    const runtimeHooks = canonicalState.readRuntimeHooks();
    const branchHooks = canonicalState.readBranchHooks(branchName);

    const runtimeEventTypes = runtimeEvents.map((event) => event.type);
    const branchEventTypes = branchEvents.map((event) => event.type);

    assert(runtimeEventTypes.includes('agent.registered'), 'Runtime canonical events must include agent.registered.', problems);
    assert(runtimeEventTypes.includes('agent.status_updated'), 'Runtime canonical events must include agent.status_updated.', problems);
    assert(runtimeEventTypes.includes('agent.heartbeat_recorded'), 'Runtime canonical events must include agent.heartbeat_recorded.', problems);
    assert(runtimeEventTypes.includes('agent.branch_assigned'), 'Runtime canonical events must include agent.branch_assigned.', problems);
    assert(runtimeEventTypes.includes('agent.listening_updated'), 'Runtime canonical events must include agent.listening_updated.', problems);
    assert(runtimeEventTypes.includes('agent.unregistered'), 'Runtime canonical events must include agent.unregistered.', problems);

    assert(branchEventTypes.includes('task.created'), 'Branch canonical events must include task.created.', problems);
    assert(branchEventTypes.includes('task.claimed'), 'Branch canonical events must include task.claimed.', problems);
    assert(branchEventTypes.includes('workflow.created'), 'Branch canonical events must include workflow.created.', problems);
    assert(branchEventTypes.includes('workflow.step_started'), 'Branch canonical events must include workflow.step_started.', problems);
    assert(branchEventTypes.includes('workflow.step_reassigned'), 'Branch canonical events must include workflow.step_reassigned.', problems);
    assert(branchEventTypes.includes('workflow.paused'), 'Branch canonical events must include workflow.paused.', problems);
    assert(branchEventTypes.includes('workflow.resumed'), 'Branch canonical events must include workflow.resumed.', problems);
    assert(branchEventTypes.includes('workflow.stopped'), 'Branch canonical events must include workflow.stopped.', problems);
    assert(branchEventTypes.includes('conversation.mode_updated'), 'Branch canonical events must include conversation.mode_updated.', problems);
    assert(branchEventTypes.includes('workspace.written'), 'Branch canonical events must include workspace.written.', problems);
    assert(branchEventTypes.includes('decision.logged'), 'Branch canonical events must include decision.logged.', problems);
    assert(branchEventTypes.includes('kb.written'), 'Branch canonical events must include kb.written.', problems);
    assert(branchEventTypes.includes('progress.updated'), 'Branch canonical events must include progress.updated.', problems);
    assert(branchEventTypes.includes('vote.called'), 'Branch canonical events must include vote.called.', problems);
    assert(branchEventTypes.includes('vote.cast'), 'Branch canonical events must include vote.cast.', problems);
    assert(branchEventTypes.includes('vote.resolved'), 'Branch canonical events must include vote.resolved.', problems);
    assert(branchEventTypes.includes('rule.added'), 'Branch canonical events must include rule.added.', problems);
    assert(branchEventTypes.includes('rule.toggled'), 'Branch canonical events must include rule.toggled.', problems);
    assert(branchEventTypes.includes('rule.removed'), 'Branch canonical events must include rule.removed.', problems);
    assert(branchEventTypes.includes('review.requested'), 'Branch canonical events must include review.requested.', problems);
    assert(branchEventTypes.includes('review.submitted'), 'Branch canonical events must include review.submitted.', problems);
    assert(branchEventTypes.includes('dependency.declared'), 'Branch canonical events must include dependency.declared.', problems);
    assert(branchEventTypes.includes('dependency.resolved'), 'Branch canonical events must include dependency.resolved.', problems);

    assert(runtimeHooks.length === runtimeEvents.length, 'Runtime hook projection must mirror the runtime canonical event count.', problems);
    assert(branchHooks.length === branchEvents.length, 'Branch hook projection must mirror the branch canonical event count.', problems);
    assert(runtimeHooks.every((hook) => hook.topic && hook.event_id && hook.payload), 'Runtime hooks must expose topic, event_id, and payload.', problems);
    assert(branchHooks.every((hook) => hook.topic && hook.event_id && hook.payload), 'Branch hooks must expose topic, event_id, and payload.', problems);

    assertHookTopics(runtimeEvents, runtimeHooks, 'agent.registered', problems, 'Runtime');
    assertHookTopics(runtimeEvents, runtimeHooks, 'agent.heartbeat_recorded', problems, 'Runtime');
    assertHookTopics(runtimeEvents, runtimeHooks, 'agent.listening_updated', problems, 'Runtime');
    assertHookTopics(branchEvents, branchHooks, 'task.created', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'workflow.step_started', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'workspace.written', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'decision.logged', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'kb.written', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'progress.updated', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'vote.called', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'vote.cast', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'vote.resolved', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'rule.added', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'rule.toggled', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'rule.removed', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'review.requested', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'dependency.resolved', problems, 'Branch');
    assertHookTopics(branchEvents, branchHooks, 'conversation.mode_updated', problems, 'Branch');

    const managedHooks = canonicalState.readBranchHooks(branchName, { topic: 'conversation.mode_updated' });
    const reviewHooks = canonicalState.readBranchHooks(branchName, { topics: ['review.requested', 'review.submitted'] });
    const heartbeatHooks = canonicalState.readRuntimeHooks({ topic: 'agent.heartbeat_recorded' });

    assert(managedHooks.length === 1 && managedHooks[0].topic === 'conversation.mode_updated', 'Hook subscription surface must filter by one canonical topic.', problems);
    assert(reviewHooks.length === 2 && reviewHooks.every((hook) => hook.topic.startsWith('review.')), 'Hook subscription surface must filter by canonical topic sets.', problems);
    assert(heartbeatHooks.length === 1 && heartbeatHooks[0].topic === 'agent.heartbeat_recorded', 'Runtime hook subscription surface must filter by canonical agent topic.', problems);
    assert(modeEvent && managedHooks[0].event_id === modeEvent.event_id, 'Branch hook records must retain the originating canonical event id.', problems);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail(['Lifecycle hook validation failed.', ...problems.map((problem) => `- ${problem}`)], 1);
  }

  console.log([
    'Lifecycle hook validation passed.',
    'Validated runtime, governance, and branch lifecycle seams now emit canonical events for the targeted slices.',
    'Validated the derived hook surface is projected post-commit from canonical events and remains keyed by canonical event type.',
  ].join('\n'));
}

main();
