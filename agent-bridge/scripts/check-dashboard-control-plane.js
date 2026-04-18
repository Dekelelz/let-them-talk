#!/usr/bin/env node

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const DASHBOARD_FILE = path.resolve(__dirname, '..', 'dashboard.js');
const DASHBOARD_HTML_FILE = path.resolve(__dirname, '..', 'dashboard.html');
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const FIXTURE_PORT_HOST = '127.0.0.1';
const USAGE = 'Usage: node agent-bridge/scripts/check-dashboard-control-plane.js [--scenario healthy|edit-delete-semantic-gap]';

function parseArgs(argv) {
  let scenario = 'healthy';

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--scenario') {
      if (index + 1 >= argv.length) fail([USAGE], 2);
      scenario = argv[index + 1];
      index += 1;
      continue;
    }

    fail([USAGE], 2);
  }

  if (!['healthy', 'edit-delete-semantic-gap'].includes(scenario)) {
    fail([
      `Unknown scenario: ${scenario}`,
      'Supported scenarios: healthy, edit-delete-semantic-gap',
      USAGE,
    ], 2);
  }

  return { scenario };
}

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function writeJsonl(filePath, entries) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = entries.map((entry) => JSON.stringify(entry));
  fs.writeFileSync(filePath, lines.length > 0 ? `${lines.join('\n')}\n` : '');
}

function getScopedBranchFile(dataDir, branchName, suffix) {
  return branchName === 'main'
    ? path.join(dataDir, suffix)
    : path.join(dataDir, `branch-${branchName}-${suffix}`);
}

function getChannelHistoryFixtureFile(dataDir, channelName, branchName = 'main') {
  return branchName === 'main'
    ? path.join(dataDir, `channel-${channelName}-history.jsonl`)
    : path.join(dataDir, `branch-${branchName}-channel-${channelName}-history.jsonl`);
}

function getScopedWorkspacesDir(dataDir, branchName = 'main') {
  return branchName === 'main'
    ? path.join(dataDir, 'workspaces')
    : path.join(dataDir, `branch-${branchName}-workspaces`);
}

function getScopedWorkspaceFile(dataDir, agentName, branchName = 'main') {
  return path.join(getScopedWorkspacesDir(dataDir, branchName), `${agentName}.json`);
}

function readMessageEvents(eventLog, branchName = 'main') {
  return eventLog.readBranchEvents(branchName, { typePrefix: 'message.' });
}

function readRuleEvents(eventLog, branchName = 'main') {
  return eventLog.readBranchEvents(branchName, { typePrefix: 'rule.' });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, FIXTURE_PORT_HOST, () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function requestJson(baseUrl, pathname, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 5000);
  try {
    const response = await fetch(baseUrl + pathname, {
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-LTT-Request': 'dashboard-control-plane-fixture',
        ...(options.headers || {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }

    return {
      status: response.status,
      body: json,
      raw: text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForDashboard(baseUrl, child, capture) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10000) {
    if (child.exitCode !== null) {
      throw new Error([
        `Dashboard exited before becoming ready (exit ${child.exitCode}).`,
        capture.stdout ? `stdout:\n${capture.stdout.trimEnd()}` : 'stdout: <empty>',
        capture.stderr ? `stderr:\n${capture.stderr.trimEnd()}` : 'stderr: <empty>',
      ].join('\n'));
    }

    try {
      const response = await requestJson(baseUrl, '/api/server-info', { timeoutMs: 1000 });
      if (response.status === 200) return;
    } catch {}

    await sleep(100);
  }

  throw new Error([
    'Dashboard did not become ready within 10 seconds.',
    capture.stdout ? `stdout:\n${capture.stdout.trimEnd()}` : 'stdout: <empty>',
    capture.stderr ? `stderr:\n${capture.stderr.trimEnd()}` : 'stderr: <empty>',
  ].join('\n'));
}

async function stopDashboard(child) {
  if (!child || child.exitCode !== null) return;

  child.kill('SIGTERM');

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    sleep(2000),
  ]);

  if (child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/f', '/t'], { stdio: 'ignore' });
    return;
  }

  child.kill('SIGKILL');
}

function buildAgents(now) {
  return {
    alpha: {
      pid: 1001,
      provider: 'claude',
      timestamp: now,
      last_activity: now,
    },
    beta: {
      pid: 1002,
      provider: 'codex',
      timestamp: now,
      last_activity: now,
    },
  };
}

function buildTask(now) {
  return [{
    id: 'task_dashboard_control',
    title: 'Dashboard control-plane task',
    description: 'Representative task route mutation fixture',
    status: 'pending',
    assignee: 'alpha',
    created_by: 'alpha',
    created_at: now,
    updated_at: now,
    notes: [],
  }];
}

function buildWorkflows(now) {
  return [
    {
      id: 'wf_plan_control',
      name: 'Dashboard plan control',
      status: 'active',
      autonomous: true,
      parallel: false,
      created_by: 'alpha',
      created_at: now,
      updated_at: now,
      steps: [
        {
          id: 1,
          description: 'Current autonomous step',
          assignee: 'alpha',
          depends_on: [],
          status: 'in_progress',
          started_at: now,
          completed_at: null,
          notes: '',
        },
        {
          id: 2,
          description: 'Next autonomous step',
          assignee: 'alpha',
          depends_on: [1],
          status: 'pending',
          started_at: null,
          completed_at: null,
          notes: '',
        },
      ],
    },
    {
      id: 'wf_dashboard_skip',
      name: 'Dashboard workflow skip',
      status: 'active',
      autonomous: false,
      parallel: false,
      created_by: 'alpha',
      created_at: now,
      updated_at: now,
      steps: [
        {
          id: 1,
          description: 'Dashboard skip current step',
          assignee: 'alpha',
          depends_on: [],
          status: 'in_progress',
          started_at: now,
          completed_at: null,
          notes: '',
        },
        {
          id: 2,
          description: 'Dashboard activated next step',
          assignee: 'beta',
          depends_on: [1],
          status: 'pending',
          started_at: null,
          completed_at: null,
          notes: '',
        },
      ],
    },
  ];
}

function buildBranchTaskWorkflowFixture(canonicalState) {
  const featureBranch = 'feature-dashboard';
  const featureTask = {
    id: 'task_feature_dashboard_control',
    title: 'Feature branch dashboard task',
    description: 'Branch-local dashboard task mutation fixture',
    status: 'pending',
    assignee: 'beta',
    created_by: 'alpha',
    created_at: '2026-04-16T05:31:00.000Z',
    updated_at: '2026-04-16T05:31:00.000Z',
    notes: [],
  };
  const featureWorkflow = {
    id: 'wf_feature_dashboard_skip',
    name: 'Feature dashboard workflow skip',
    status: 'active',
    autonomous: false,
    parallel: false,
    created_by: 'alpha',
    created_at: '2026-04-16T05:32:00.000Z',
    updated_at: '2026-04-16T05:32:00.000Z',
    branch_id: featureBranch,
    steps: [
      {
        id: 1,
        description: 'Feature branch current step',
        assignee: 'beta',
        depends_on: [],
        status: 'in_progress',
        started_at: '2026-04-16T05:32:00.000Z',
        completed_at: null,
        notes: '',
      },
      {
        id: 2,
        description: 'Feature branch next step',
        assignee: 'alpha',
        depends_on: [1],
        status: 'pending',
        started_at: null,
        completed_at: null,
        notes: '',
      },
    ],
  };
  const featurePlanWorkflow = {
    id: 'wf_feature_plan_control',
    name: 'Feature branch plan control',
    status: 'active',
    autonomous: true,
    parallel: false,
    created_by: 'alpha',
    created_at: '2026-04-16T05:33:00.000Z',
    updated_at: '2026-04-16T05:33:00.000Z',
    branch_id: featureBranch,
    steps: [
      {
        id: 1,
        description: 'Feature branch autonomous step',
        assignee: 'alpha',
        depends_on: [],
        status: 'in_progress',
        started_at: '2026-04-16T05:33:00.000Z',
        completed_at: null,
        notes: '',
      },
      {
        id: 2,
        description: 'Feature branch autonomous follow-up',
        assignee: 'beta',
        depends_on: [1],
        status: 'pending',
        started_at: null,
        completed_at: null,
        notes: '',
      },
    ],
  };

  const createTaskResult = canonicalState.createTask({
    task: featureTask,
    actor: 'alpha',
    branch: featureBranch,
    sessionId: 'sess_feature_dashboard',
    correlationId: featureTask.id,
  });
  if (createTaskResult.error) {
    throw new Error(`Failed to create feature-branch task fixture: ${createTaskResult.error}`);
  }

  for (const workflow of [featureWorkflow, featurePlanWorkflow]) {
    const createWorkflowResult = canonicalState.createWorkflow({
      workflow,
      actor: 'alpha',
      branch: featureBranch,
      sessionId: 'sess_feature_dashboard',
      correlationId: workflow.id,
    });
    if (createWorkflowResult.error) {
      throw new Error(`Failed to create feature-branch workflow fixture ${workflow.id}: ${createWorkflowResult.error}`);
    }
  }

  return {
    featureBranch,
    featureTaskId: featureTask.id,
    featureWorkflowId: featureWorkflow.id,
    featurePlanWorkflowId: featurePlanWorkflow.id,
  };
}

function buildBranchReadFixture(canonicalState, dataDir) {
  const featureBranch = 'feature-dashboard';
  const mainMessage = {
    id: 'msg_main_branch_fixture',
    from: 'alpha',
    to: 'beta',
    content: 'Main branch baseline message for Task 7C',
    timestamp: '2026-04-16T05:00:00.000Z',
  };
  const featureMessage = {
    id: 'msg_feature_branch_fixture',
    from: 'alpha',
    to: 'beta',
    content: 'Feature branch needle 7C runtime message',
    timestamp: '2026-04-16T05:01:00.000Z',
  };
  const mainChannelMessage = {
    id: 'msg_main_ops_fixture',
    from: 'beta',
    to: 'alpha',
    channel: 'ops',
    content: 'Main ops channel message for Task 7C',
    timestamp: '2026-04-16T05:00:30.000Z',
  };
  const featureChannelMessage = {
    id: 'msg_feature_lab_fixture',
    from: 'beta',
    to: 'alpha',
    channel: 'featurelab',
    content: 'Feature lab channel message for Task 7C',
    timestamp: '2026-04-16T05:01:30.000Z',
  };

  canonicalState.appendMessage(mainMessage, { branch: 'main' });
  canonicalState.appendMessage(featureMessage, { branch: featureBranch });
  canonicalState.appendScopedMessage(mainChannelMessage, { branch: 'main', channel: 'ops' });
  canonicalState.appendScopedMessage(featureChannelMessage, { branch: featureBranch, channel: 'featurelab' });

  writeJson(getScopedBranchFile(dataDir, 'main', 'acks.json'), {
    [mainMessage.id]: true,
  });
  writeJson(getScopedBranchFile(dataDir, featureBranch, 'acks.json'), {
    [featureMessage.id]: true,
  });

  writeJson(getScopedBranchFile(dataDir, 'main', 'channels.json'), {
    general: {
      description: 'General channel',
      members: ['*'],
    },
    ops: {
      description: 'Main branch ops channel',
      members: ['alpha', 'beta'],
    },
  });
  writeJson(getScopedBranchFile(dataDir, featureBranch, 'channels.json'), {
    general: {
      description: 'General channel',
      members: ['*'],
    },
    featurelab: {
      description: 'Feature branch lab channel',
      members: ['alpha', 'beta'],
    },
  });

  writeJson(getScopedBranchFile(dataDir, 'main', 'config.json'), {
    conversation_mode: 'managed',
  });
  writeJson(getScopedBranchFile(dataDir, featureBranch, 'config.json'), {
    conversation_mode: 'direct',
  });

  writeJson(getScopedWorkspaceFile(dataDir, 'alpha', 'main'), {
    _status: 'Main branch workspace status',
    retry_history: [
      { attempt: 1, task: 'main-retry-task', timestamp: '2026-04-16T05:00:40.000Z' },
    ],
    draft: { content: 'Main branch workspace draft' },
  });
  writeJson(getScopedWorkspaceFile(dataDir, 'alpha', featureBranch), {
    _status: 'Feature branch alpha status',
    draft: { content: 'Feature branch workspace draft' },
  });
  writeJson(getScopedWorkspaceFile(dataDir, 'beta', featureBranch), {
    _status: 'Feature branch beta status',
    retry_history: [
      { attempt: 2, task: 'feature-retry-task', timestamp: '2026-04-16T05:01:40.000Z' },
    ],
  });

  return {
    featureBranch,
    mainMessage,
    featureMessage,
    mainChannelMessage,
    featureChannelMessage,
    mainWorkspaceStatus: 'Main branch workspace status',
    featureConversationMode: 'direct',
    featureWorkspaceStatus: 'Feature branch beta status',
    featureWorkspaceDraft: 'Feature branch workspace draft',
    featureRetryTask: 'feature-retry-task',
  };
}

function buildRespawnPromptFixture(canonicalState, dataDir) {
  const featureBranch = 'feature-dashboard';

  canonicalState.ensureAgentSession({
    agentName: 'alpha',
    branch: 'main',
    sessionId: 'sess_respawn_alpha_main',
    reason: 'dashboard_respawn_fixture',
  });
  canonicalState.transitionLatestSessionForAgent({
    agentName: 'alpha',
    branch: 'main',
    state: 'interrupted',
    reason: 'dashboard_respawn_fixture',
    recoverySnapshotFile: 'recovery-alpha-main.json',
  });
  writeJson(path.join(dataDir, 'recovery-alpha-main.json'), {
    agent: 'alpha',
    branch: 'main',
    died_at: '2026-04-16T05:35:00.000Z',
    locked_files: ['main-only-lock.js'],
    decisions_made: [
      { decision: 'Main-only recovery decision', reasoning: 'Main branch recovery context' },
    ],
    last_messages_sent: [
      { to: 'beta', content: 'Main-only recovery message', timestamp: '2026-04-16T05:35:30.000Z' },
    ],
  });

  writeJson(path.join(dataDir, 'recovery-beta.json'), {
    agent: 'beta',
    branch: 'main',
    died_at: '2026-04-16T05:36:00.000Z',
    locked_files: ['main-branch-legacy-leak.js'],
    decisions_made: [
      { decision: 'Main legacy recovery leak', reasoning: 'Should never appear in feature respawn prompt' },
    ],
    last_messages_sent: [
      { to: 'alpha', content: 'Main legacy recovery message', timestamp: '2026-04-16T05:36:30.000Z' },
    ],
  });

  return {
    featureBranch,
    mainRecoveryLock: 'main-only-lock.js',
    mainRecoveryDecision: 'Main-only recovery decision',
    leakedRecoveryLock: 'main-branch-legacy-leak.js',
    leakedRecoveryDecision: 'Main legacy recovery leak',
  };
}

async function assertBranchAwareRespawnPrompt(baseUrl, branchFixture, respawnFixture, problems) {
  const dashboardHtml = fs.readFileSync(DASHBOARD_HTML_FILE, 'utf8');
  const branchAwareRespawnUiPattern = /function respawnAgent\(agentName\)\s*\{[\s\S]*?lttFetch\(scopedApiUrl\('\/api\/agents\/' \+ encodeURIComponent\(agentName\) \+ '\/respawn-prompt'\), \{/;

  assert(branchAwareRespawnUiPattern.test(dashboardHtml), 'Dashboard respawn UI must call /api/agents/:name/respawn-prompt through scopedApiUrl() so the active branch is included.', problems);

  const mainRespawnResponse = await requestJson(baseUrl, '/api/agents/alpha/respawn-prompt?branch=main');
  assert(mainRespawnResponse.status === 200, `GET /api/agents/alpha/respawn-prompt?branch=main should return 200, got ${mainRespawnResponse.status}.`, problems);
  assert(mainRespawnResponse.body && mainRespawnResponse.body.has_recovery === true, 'Main-branch respawn prompt should load matching main-branch recovery context.', problems);
  assert(mainRespawnResponse.body && typeof mainRespawnResponse.body.prompt === 'string' && mainRespawnResponse.body.prompt.includes(respawnFixture.mainRecoveryLock), 'Main-branch respawn prompt should include the main-branch recovery lock context.', problems);
  assert(mainRespawnResponse.body && typeof mainRespawnResponse.body.prompt === 'string' && mainRespawnResponse.body.prompt.includes(respawnFixture.mainRecoveryDecision), 'Main-branch respawn prompt should include the main-branch recovery decision context.', problems);

  const featureRespawnResponse = await requestJson(baseUrl, `/api/agents/beta/respawn-prompt?branch=${respawnFixture.featureBranch}`);
  assert(featureRespawnResponse.status === 200, `GET /api/agents/beta/respawn-prompt?branch=${respawnFixture.featureBranch} should return 200, got ${featureRespawnResponse.status}.`, problems);
  assert(featureRespawnResponse.body && featureRespawnResponse.body.has_recovery === false, 'Feature-branch respawn prompt should ignore mismatched main-branch recovery snapshots.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && featureRespawnResponse.body.prompt.includes(branchFixture.featureConversationMode), 'Feature-branch respawn prompt should use the feature-branch conversation config.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && featureRespawnResponse.body.prompt.includes('Feature branch dashboard task'), 'Feature-branch respawn prompt should include the feature-branch assigned task.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && featureRespawnResponse.body.prompt.includes('Feature branch needle 7C runtime message'), 'Feature-branch respawn prompt should include feature-branch history only.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && featureRespawnResponse.body.prompt.includes(branchFixture.featureWorkspaceStatus), 'Feature-branch respawn prompt should include the feature-branch workspace status.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && !featureRespawnResponse.body.prompt.includes('Dashboard control-plane task'), 'Feature-branch respawn prompt must exclude main-branch task context.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && !featureRespawnResponse.body.prompt.includes('Main branch baseline message for Task 7C'), 'Feature-branch respawn prompt must exclude main-branch history context.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && !featureRespawnResponse.body.prompt.includes('Main branch workspace status'), 'Feature-branch respawn prompt must exclude main-branch workspace state.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && !featureRespawnResponse.body.prompt.includes(respawnFixture.leakedRecoveryLock), 'Feature-branch respawn prompt must exclude mismatched main-branch recovery lock context.', problems);
  assert(featureRespawnResponse.body && typeof featureRespawnResponse.body.prompt === 'string' && !featureRespawnResponse.body.prompt.includes(respawnFixture.leakedRecoveryDecision), 'Feature-branch respawn prompt must exclude mismatched main-branch recovery decision context.', problems);
}

function assertDashboardScopedMessageTaskUi(problems) {
  const dashboardHtml = fs.readFileSync(DASHBOARD_HTML_FILE, 'utf8');
  const clearMessagesUiPattern = /function clearMessages\(\)\s*\{[\s\S]*?scopedApiUrl\('\/api\/clear-messages'\)[\s\S]*?showToast\('Clear messages failed:/;
  const fetchTasksBranchAwarePattern = /function fetchTasks\(\)\s*\{[\s\S]*?lttFetch\(scopedApiUrl\('\/api\/tasks'\)\)/;
  const fetchTasksMainGatePattern = /function fetchTasks\(\)\s*\{[\s\S]*?renderMainBranchOnlyView\('tasks-area', 'Tasks'\)/;
  const renderTasksMainGatePattern = /function renderTasks\(\)\s*\{[\s\S]*?mainBranchOnlyViewHtml\('Tasks'\)/;
  const updateTaskStatusMainGatePattern = /function updateTaskStatus\(taskId, newStatus\)\s*\{[\s\S]*?Tasks only support the main branch right now\./;
  const injectTargetHelperPattern = /function getEligibleInjectTargets\(agentNames, agents\)\s*\{/;
  const injectTargetPopulationPattern = /updateInjectTargets\(getEligibleInjectTargets\(filtered, agents\)\);/;
  const staleInjectTargetPattern = /updateInjectTargets\(keys\);/;

  assert(clearMessagesUiPattern.test(dashboardHtml), 'Dashboard Clear Messages UI must call the scoped branch-aware clear route and surface clear failures instead of failing silently.', problems);
  assert(fetchTasksBranchAwarePattern.test(dashboardHtml), 'Dashboard Tasks UI must fetch tasks through scopedApiUrl(/api/tasks) so the active branch is honored.', problems);
  assert(!fetchTasksMainGatePattern.test(dashboardHtml), 'Dashboard Tasks UI must not block non-main branches before fetching branch-local tasks.', problems);
  assert(!renderTasksMainGatePattern.test(dashboardHtml), 'Dashboard Tasks UI must not render the legacy main-branch-only placeholder for branch-local tasks.', problems);
  assert(!updateTaskStatusMainGatePattern.test(dashboardHtml), 'Dashboard Tasks UI must not reject task updates on non-main branches before calling the branch-aware API.', problems);
  assert(injectTargetHelperPattern.test(dashboardHtml), 'Dashboard Send To population must derive an eligible inject-target list before rendering options.', problems);
  assert(injectTargetPopulationPattern.test(dashboardHtml), 'Dashboard Send To dropdown must be populated from the eligible visible agent set instead of raw agent keys.', problems);
  assert(!staleInjectTargetPattern.test(dashboardHtml), 'Dashboard Send To dropdown must not be repopulated directly from raw agent keys.', problems);
}

async function assertBranchScopedDashboardReads(baseUrl, fixture, problems) {
  const mainHistoryResponse = await requestJson(baseUrl, '/api/history?branch=main&limit=10');
  assert(mainHistoryResponse.status === 200, `GET /api/history?branch=main should return 200, got ${mainHistoryResponse.status}.`, problems);
  assert(Array.isArray(mainHistoryResponse.body), 'GET /api/history?branch=main should return an array.', problems);

  const mainHistory = Array.isArray(mainHistoryResponse.body) ? mainHistoryResponse.body : [];
  const mainIds = new Set(mainHistory.map((message) => message.id));
  const mainAckedMessage = mainHistory.find((message) => message.id === fixture.mainMessage.id);
  assert(mainHistory.length === 2, `GET /api/history?branch=main should return exactly 2 main-branch messages, found ${mainHistory.length}.`, problems);
  assert(mainIds.has(fixture.mainMessage.id), 'Main-branch history should include the main baseline message.', problems);
  assert(mainIds.has(fixture.mainChannelMessage.id), 'Main-branch history should include the main non-general channel message.', problems);
  assert(!mainIds.has(fixture.featureMessage.id), 'Main-branch history must exclude the feature-branch general message.', problems);
  assert(!mainIds.has(fixture.featureChannelMessage.id), 'Main-branch history must exclude the feature-branch channel message.', problems);
  assert(mainAckedMessage && mainAckedMessage.acked === true, 'Main-branch history should read acknowledgements from main acks.json.', problems);

  const featureHistoryResponse = await requestJson(baseUrl, `/api/history?branch=${fixture.featureBranch}&limit=10`);
  assert(featureHistoryResponse.status === 200, `GET /api/history?branch=${fixture.featureBranch} should return 200, got ${featureHistoryResponse.status}.`, problems);
  assert(Array.isArray(featureHistoryResponse.body), `GET /api/history?branch=${fixture.featureBranch} should return an array.`, problems);

  const featureHistory = Array.isArray(featureHistoryResponse.body) ? featureHistoryResponse.body : [];
  const featureIds = new Set(featureHistory.map((message) => message.id));
  const featureAckedMessage = featureHistory.find((message) => message.id === fixture.featureMessage.id);
  assert(featureHistory.length === 2, `GET /api/history?branch=${fixture.featureBranch} should return exactly 2 feature-branch messages, found ${featureHistory.length}.`, problems);
  assert(featureIds.has(fixture.featureMessage.id), 'Feature-branch history should include the feature baseline message.', problems);
  assert(featureIds.has(fixture.featureChannelMessage.id), 'Feature-branch history should include the feature non-general channel message.', problems);
  assert(!featureIds.has(fixture.mainMessage.id), 'Feature-branch history must exclude the main-branch general message.', problems);
  assert(!featureIds.has(fixture.mainChannelMessage.id), 'Feature-branch history must exclude the main-branch channel message.', problems);
  assert(featureAckedMessage && featureAckedMessage.acked === true, 'Feature-branch history should read acknowledgements from branch-scoped acks.', problems);

  const mainChannelsResponse = await requestJson(baseUrl, '/api/channels?branch=main');
  assert(mainChannelsResponse.status === 200, `GET /api/channels?branch=main should return 200, got ${mainChannelsResponse.status}.`, problems);
  assert(mainChannelsResponse.body && mainChannelsResponse.body.ops && mainChannelsResponse.body.ops.message_count === 1, 'Main-branch channels should report the main ops channel count from main projections.', problems);
  assert(mainChannelsResponse.body && !('featurelab' in mainChannelsResponse.body), 'Main-branch channels must exclude feature-only channel metadata.', problems);

  const featureChannelsResponse = await requestJson(baseUrl, `/api/channels?branch=${fixture.featureBranch}`);
  assert(featureChannelsResponse.status === 200, `GET /api/channels?branch=${fixture.featureBranch} should return 200, got ${featureChannelsResponse.status}.`, problems);
  assert(featureChannelsResponse.body && featureChannelsResponse.body.featurelab && featureChannelsResponse.body.featurelab.message_count === 1, 'Feature-branch channels should report the feature channel count from branch-scoped projections.', problems);
  assert(featureChannelsResponse.body && !('ops' in featureChannelsResponse.body), 'Feature-branch channels must exclude main-only channel metadata.', problems);

  const mainWorkspacesResponse = await requestJson(baseUrl, '/api/workspaces?branch=main');
  assert(mainWorkspacesResponse.status === 200, `GET /api/workspaces?branch=main should return 200, got ${mainWorkspacesResponse.status}.`, problems);
  assert(mainWorkspacesResponse.body && mainWorkspacesResponse.body.alpha && mainWorkspacesResponse.body.alpha._status === fixture.mainWorkspaceStatus, 'Main-branch workspaces should return the main branch workspace projection.', problems);
  assert(!JSON.stringify(mainWorkspacesResponse.body || {}).includes(fixture.featureRetryTask), 'Main-branch workspaces must exclude feature-only workspace retry history.', problems);

  const featureWorkspacesResponse = await requestJson(baseUrl, `/api/workspaces?branch=${fixture.featureBranch}`);
  assert(featureWorkspacesResponse.status === 200, `GET /api/workspaces?branch=${fixture.featureBranch} should return 200, got ${featureWorkspacesResponse.status}.`, problems);
  assert(featureWorkspacesResponse.body && featureWorkspacesResponse.body.alpha && featureWorkspacesResponse.body.alpha.draft && featureWorkspacesResponse.body.alpha.draft.content === fixture.featureWorkspaceDraft, 'Feature-branch workspaces should return the feature branch workspace projection.', problems);
  assert(featureWorkspacesResponse.body && featureWorkspacesResponse.body.beta && Array.isArray(featureWorkspacesResponse.body.beta.retry_history) && featureWorkspacesResponse.body.beta.retry_history[0].task === fixture.featureRetryTask, 'Feature-branch workspaces should include feature-only retry history.', problems);
  assert(featureWorkspacesResponse.body && featureWorkspacesResponse.body.alpha && featureWorkspacesResponse.body.alpha._status !== fixture.mainWorkspaceStatus, 'Feature-branch workspaces must exclude main-branch workspace state.', problems);

  const featureWorkspaceAgentResponse = await requestJson(baseUrl, `/api/workspaces?branch=${fixture.featureBranch}&agent=beta`);
  assert(featureWorkspaceAgentResponse.status === 200, `GET /api/workspaces?branch=${fixture.featureBranch}&agent=beta should return 200, got ${featureWorkspaceAgentResponse.status}.`, problems);
  assert(featureWorkspaceAgentResponse.body && featureWorkspaceAgentResponse.body.beta && Array.isArray(featureWorkspaceAgentResponse.body.beta.retry_history) && featureWorkspaceAgentResponse.body.beta.retry_history[0].task === fixture.featureRetryTask, 'Feature-branch single-agent workspace reads should stay branch-local.', problems);

  const mainRetriesResponse = await requestJson(baseUrl, '/api/plan/retries?branch=main');
  assert(mainRetriesResponse.status === 200, `GET /api/plan/retries?branch=main should return 200, got ${mainRetriesResponse.status}.`, problems);
  assert(mainRetriesResponse.body && mainRetriesResponse.body.count === 1 && mainRetriesResponse.body.retries[0].agent === 'alpha', 'Main-branch retry view should read retry_history only from main-branch workspaces.', problems);

  const featureRetriesResponse = await requestJson(baseUrl, `/api/plan/retries?branch=${fixture.featureBranch}`);
  assert(featureRetriesResponse.status === 200, `GET /api/plan/retries?branch=${fixture.featureBranch} should return 200, got ${featureRetriesResponse.status}.`, problems);
  assert(featureRetriesResponse.body && featureRetriesResponse.body.count === 1 && featureRetriesResponse.body.retries[0].agent === 'beta' && featureRetriesResponse.body.retries[0].task === fixture.featureRetryTask, 'Feature-branch retry view should read retry_history only from feature-branch workspaces.', problems);

  const featureSearchResponse = await requestJson(baseUrl, `/api/search?branch=${fixture.featureBranch}&q=${encodeURIComponent('needle 7C')}`);
  assert(featureSearchResponse.status === 200, `GET /api/search?branch=${fixture.featureBranch} should return 200, got ${featureSearchResponse.status}.`, problems);
  assert(featureSearchResponse.body && featureSearchResponse.body.results_count === 1, 'Feature-branch search should only find the feature-specific query hit.', problems);
  assert(featureSearchResponse.body && Array.isArray(featureSearchResponse.body.results) && featureSearchResponse.body.results[0] && featureSearchResponse.body.results[0].id === fixture.featureMessage.id, 'Feature-branch search should return the feature-branch general message, not main history.', problems);

  const exportJsonResponse = await requestJson(baseUrl, `/api/export-json?branch=${fixture.featureBranch}`);
  assert(exportJsonResponse.status === 200, `GET /api/export-json?branch=${fixture.featureBranch} should return 200, got ${exportJsonResponse.status}.`, problems);
  assert(exportJsonResponse.body && exportJsonResponse.body.branch === fixture.featureBranch, 'JSON export should report the requested non-main branch.', problems);
  assert(exportJsonResponse.body && exportJsonResponse.body.summary && exportJsonResponse.body.summary.message_count === 2, 'Feature-branch JSON export should count only feature-branch messages.', problems);
  assert(exportJsonResponse.body && exportJsonResponse.body.channels && exportJsonResponse.body.channels.featurelab && exportJsonResponse.body.channels.featurelab.message_count === 1, 'Feature-branch JSON export should include feature-only channel counts.', problems);
  assert(exportJsonResponse.body && exportJsonResponse.body.channels && !('ops' in exportJsonResponse.body.channels), 'Feature-branch JSON export must exclude main-only channels.', problems);
  const exportJsonIds = new Set(exportJsonResponse.body && Array.isArray(exportJsonResponse.body.messages)
    ? exportJsonResponse.body.messages.map((message) => message.id)
    : []);
  assert(exportJsonIds.has(fixture.featureMessage.id), 'Feature-branch JSON export should include the feature general message.', problems);
  assert(exportJsonIds.has(fixture.featureChannelMessage.id), 'Feature-branch JSON export should include the feature channel message.', problems);
  assert(!exportJsonIds.has(fixture.mainMessage.id), 'Feature-branch JSON export must exclude the main general message.', problems);
  assert(!exportJsonIds.has(fixture.mainChannelMessage.id), 'Feature-branch JSON export must exclude the main channel message.', problems);

  const exportHtmlResponse = await requestJson(baseUrl, `/api/export?branch=${fixture.featureBranch}`);
  assert(exportHtmlResponse.status === 200, `GET /api/export?branch=${fixture.featureBranch} should return 200, got ${exportHtmlResponse.status}.`, problems);
  assert(exportHtmlResponse.raw.includes(fixture.featureMessage.content), 'HTML export should render the feature general message content.', problems);
  assert(exportHtmlResponse.raw.includes(fixture.featureChannelMessage.content), 'HTML export should render the feature channel message content.', problems);
  assert(!exportHtmlResponse.raw.includes(fixture.mainMessage.content), 'HTML export must exclude main-branch general content when exporting a feature branch.', problems);
  assert(!exportHtmlResponse.raw.includes(fixture.mainChannelMessage.content), 'HTML export must exclude main-branch channel content when exporting a feature branch.', problems);

  const exportReplayResponse = await requestJson(baseUrl, `/api/export-replay?branch=${fixture.featureBranch}`);
  assert(exportReplayResponse.status === 200, `GET /api/export-replay?branch=${fixture.featureBranch} should return 200, got ${exportReplayResponse.status}.`, problems);
  assert(exportReplayResponse.raw.includes(fixture.featureMessage.content), 'Replay export should embed the feature general message content.', problems);
  assert(exportReplayResponse.raw.includes(fixture.featureChannelMessage.content), 'Replay export should embed the feature channel message content.', problems);
  assert(!exportReplayResponse.raw.includes(fixture.mainMessage.content), 'Replay export must exclude main-branch general content when exporting a feature branch.', problems);
  assert(!exportReplayResponse.raw.includes(fixture.mainChannelMessage.content), 'Replay export must exclude main-branch channel content when exporting a feature branch.', problems);
}

function captureMessageBaseline(dataDir, eventLog) {
  const messagesFile = path.join(dataDir, 'messages.jsonl');
  const historyFile = path.join(dataDir, 'history.jsonl');
  return {
    mainMessageCount: readJsonl(messagesFile).length,
    mainHistoryCount: readJsonl(historyFile).length,
    messageEventCount: readMessageEvents(eventLog).length,
  };
}

async function assertDashboardRuleRoutes(baseUrl, canonicalState, eventLog, problems) {
  const beforeRules = canonicalState.listRules({ branch: 'main' });
  const beforeRuleEvents = readRuleEvents(eventLog);

  const addResponse = await requestJson(baseUrl, '/api/rules', {
    method: 'POST',
    body: {
      action: 'add',
      text: 'Dashboard canonical rule fixture',
      category: 'workflow',
    },
  });
  assert((addResponse.status === 200 || addResponse.status === 201), `POST /api/rules should return 200 or 201, got ${addResponse.status}.`, problems);
  const addedRule = addResponse.body && addResponse.body.rule ? addResponse.body.rule : addResponse.body;
  assert(addedRule && addedRule.id, 'POST /api/rules should return the created rule.', problems);

  const rulesAfterAdd = canonicalState.listRules({ branch: 'main' });
  const storedRuleAfterAdd = Array.isArray(rulesAfterAdd) ? rulesAfterAdd.find((rule) => rule.id === (addedRule && addedRule.id)) : null;
  const ruleEventsAfterAdd = readRuleEvents(eventLog);
  assert(Array.isArray(rulesAfterAdd) && rulesAfterAdd.length === beforeRules.length + 1, 'Adding a dashboard rule should append one rule projection row.', problems);
  assert(storedRuleAfterAdd && storedRuleAfterAdd.text === 'Dashboard canonical rule fixture', 'Dashboard rule add should persist the rule text in canonical branch-local rule state.', problems);
  assert(ruleEventsAfterAdd.length === beforeRuleEvents.length + 1, 'Dashboard rule add should append one canonical rule event.', problems);
  assert(ruleEventsAfterAdd.some((event) => event.type === 'rule.added' && event.payload && event.payload.rule_id === addedRule.id), 'Dashboard rule add should emit rule.added for the created rule.', problems);

  const toggleResponse = await requestJson(baseUrl, `/api/rules/${addedRule.id}/toggle`, { method: 'POST' });
  assert(toggleResponse.status === 200, `POST /api/rules/:id/toggle should return 200, got ${toggleResponse.status}.`, problems);
  assert(toggleResponse.body && toggleResponse.body.id === addedRule.id, 'Rule toggle should return the toggled rule payload.', problems);

  const rulesAfterToggle = canonicalState.listRules({ branch: 'main' });
  const toggledRule = Array.isArray(rulesAfterToggle) ? rulesAfterToggle.find((rule) => rule.id === addedRule.id) : null;
  const ruleEventsAfterToggle = readRuleEvents(eventLog);
  assert(toggledRule && toggledRule.active === false, 'Dashboard rule toggle should persist the inactive rule state.', problems);
  assert(ruleEventsAfterToggle.length === ruleEventsAfterAdd.length + 1, 'Dashboard rule toggle should append one canonical rule event.', problems);
  assert(ruleEventsAfterToggle.some((event) => event.type === 'rule.toggled' && event.payload && event.payload.rule_id === addedRule.id && event.payload.active === false), 'Dashboard rule toggle should emit rule.toggled with the new active state.', problems);

  const deleteResponse = await requestJson(baseUrl, `/api/rules/${addedRule.id}`, { method: 'DELETE' });
  assert(deleteResponse.status === 200, `DELETE /api/rules/:id should return 200, got ${deleteResponse.status}.`, problems);
  assert(deleteResponse.body && deleteResponse.body.success === true, 'Rule delete should report success.', problems);

  const rulesAfterDelete = canonicalState.listRules({ branch: 'main' });
  const ruleEventsAfterDelete = readRuleEvents(eventLog);
  assert(Array.isArray(rulesAfterDelete) && !rulesAfterDelete.some((rule) => rule.id === addedRule.id), 'Dashboard rule delete should remove the rule from canonical branch-local rule state.', problems);
  assert(ruleEventsAfterDelete.length === ruleEventsAfterToggle.length + 1, 'Dashboard rule delete should append one canonical rule event.', problems);
  assert(ruleEventsAfterDelete.some((event) => event.type === 'rule.removed' && event.payload && event.payload.rule_id === addedRule.id), 'Dashboard rule delete should emit rule.removed for the deleted rule.', problems);
}

async function withDashboardFixture(runScenario) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-dashboard-control-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const capture = { stdout: '', stderr: '' };
  let dashboardChild = null;

  try {
    fs.mkdirSync(dataDir, { recursive: true });

    const now = '2026-04-16T05:30:00.000Z';
    writeJson(path.join(dataDir, 'agents.json'), buildAgents(now));
    writeJson(path.join(dataDir, 'tasks.json'), buildTask(now));
    writeJson(path.join(dataDir, 'workflows.json'), buildWorkflows(now));

    const canonicalState = createCanonicalState({ dataDir, processPid: process.pid });
    const eventLog = createCanonicalEventLog({ dataDir });
    const port = await getFreePort();
    const baseUrl = `http://${FIXTURE_PORT_HOST}:${port}`;

    dashboardChild = spawn(process.execPath, [DASHBOARD_FILE], {
      cwd: PACKAGE_ROOT,
      env: {
        ...process.env,
        AGENT_BRIDGE_DATA: dataDir,
        AGENT_BRIDGE_DATA_DIR: dataDir,
        AGENT_BRIDGE_PORT: String(port),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    dashboardChild.stdout.on('data', (chunk) => {
      capture.stdout += chunk.toString();
    });
    dashboardChild.stderr.on('data', (chunk) => {
      capture.stderr += chunk.toString();
    });

    await waitForDashboard(baseUrl, dashboardChild, capture);
    return await runScenario({ baseUrl, dataDir, canonicalState, eventLog });
  } finally {
    await stopDashboard(dashboardChild);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

async function runHealthyScenario() {
  const problems = [];

  try {
    await withDashboardFixture(async ({ baseUrl, dataDir, canonicalState, eventLog }) => {
      const branchFixture = buildBranchReadFixture(canonicalState, dataDir);
      const respawnFixture = buildRespawnPromptFixture(canonicalState, dataDir);
      const branchTaskWorkflowFixture = buildBranchTaskWorkflowFixture(canonicalState);
      assertDashboardScopedMessageTaskUi(problems);
      await assertBranchScopedDashboardReads(baseUrl, branchFixture, problems);
      await assertBranchAwareRespawnPrompt(baseUrl, branchFixture, respawnFixture, problems);
      const messageBaseline = captureMessageBaseline(dataDir, eventLog);
      await assertDashboardRuleRoutes(baseUrl, canonicalState, eventLog, problems);

      const messagesFile = path.join(dataDir, 'messages.jsonl');
      const historyFile = path.join(dataDir, 'history.jsonl');
      const mainMessageCountBeforeInject = readJsonl(messagesFile).length;
      const mainHistoryCountBeforeInject = readJsonl(historyFile).length;
      const messageEventCountBeforeInject = readMessageEvents(eventLog).length;

      const injectResponse = await requestJson(baseUrl, '/api/inject', {
        method: 'POST',
        body: { to: 'alpha', content: 'Dashboard fixture hello' },
      });
      assert(injectResponse.status === 200, `POST /api/inject should return 200, got ${injectResponse.status}.`, problems);
      assert(injectResponse.body && injectResponse.body.success === true, 'POST /api/inject should succeed.', problems);
      assert(typeof injectResponse.body.messageId === 'string' && injectResponse.body.messageId.length > 0, 'POST /api/inject should return a messageId.', problems);

      const injectedMessageId = injectResponse.body && injectResponse.body.messageId;
      const afterInjectMessages = readJsonl(messagesFile);
      const afterInjectHistory = readJsonl(historyFile);
      assert(afterInjectMessages.length === mainMessageCountBeforeInject + 1, 'Inject route should append one canonical message projection row.', problems);
      assert(afterInjectHistory.length === mainHistoryCountBeforeInject + 1, 'Inject route should append one canonical history projection row.', problems);
      assert(afterInjectMessages[afterInjectMessages.length - 1] && afterInjectMessages[afterInjectMessages.length - 1].id === injectedMessageId, 'Injected message should appear in messages.jsonl with the returned messageId.', problems);
      assert(afterInjectMessages[afterInjectMessages.length - 1] && afterInjectMessages[afterInjectMessages.length - 1].from === 'Dashboard', 'Injected message should originate from Dashboard.', problems);

      const editResponse = await requestJson(baseUrl, '/api/message', {
        method: 'PUT',
        body: { id: injectedMessageId, content: 'Dashboard fixture edited content' },
      });
      assert(editResponse.status === 200, `PUT /api/message should return 200, got ${editResponse.status}.`, problems);
      assert(editResponse.body && editResponse.body.success === true, 'PUT /api/message should succeed.', problems);

      const afterEditMessages = readJsonl(messagesFile);
      const afterEditHistory = readJsonl(historyFile);
      const editedMessage = afterEditMessages.find((message) => message.id === injectedMessageId);
      const editedHistoryMessage = afterEditHistory.find((message) => message.id === injectedMessageId);
      assert(!!editedMessage, 'Edited message should still exist in messages.jsonl.', problems);
      assert(editedMessage && editedMessage.content === 'Dashboard fixture edited content', 'Edited message should persist updated content.', problems);
      assert(editedMessage && typeof editedMessage.edited_at === 'string', 'Edited message should persist edited_at metadata.', problems);
      assert(
        editedHistoryMessage
          && Array.isArray(editedHistoryMessage.edit_history)
          && editedHistoryMessage.edit_history[0]
          && editedHistoryMessage.edit_history[0].content === 'Dashboard fixture hello'
          && typeof editedHistoryMessage.edit_history[0].edited_at === 'string',
        'Edited message history should retain structured edit history in history.jsonl.',
        problems
      );

      const deleteResponse = await requestJson(baseUrl, '/api/message', {
        method: 'DELETE',
        body: { id: injectedMessageId },
      });
      assert(deleteResponse.status === 200, `DELETE /api/message should return 200, got ${deleteResponse.status}.`, problems);
      assert(deleteResponse.body && deleteResponse.body.success === true, 'DELETE /api/message should succeed for dashboard-authored messages.', problems);
      assert(readJsonl(messagesFile).length === mainMessageCountBeforeInject, 'Delete route should restore the canonical message projection count to its pre-inject baseline.', problems);
      assert(readJsonl(historyFile).length === mainHistoryCountBeforeInject, 'Delete route should restore the canonical history projection count to its pre-inject baseline.', problems);

      const taskResponse = await requestJson(baseUrl, '/api/tasks', {
        method: 'POST',
        body: {
          task_id: 'task_dashboard_control',
          status: 'in_progress',
          notes: 'Claimed from dashboard fixture',
        },
      });
      assert(taskResponse.status === 200, `POST /api/tasks should return 200, got ${taskResponse.status}.`, problems);
      assert(taskResponse.body && taskResponse.body.success === true, 'POST /api/tasks should succeed for a non-terminal task update.', problems);

      const tasks = readJson(path.join(dataDir, 'tasks.json'), []);
      const updatedTask = Array.isArray(tasks) ? tasks.find((task) => task.id === 'task_dashboard_control') : null;
      assert(!!updatedTask, 'Updated dashboard task should still exist in tasks.json.', problems);
      assert(updatedTask && updatedTask.status === 'in_progress', 'Task route should mutate canonical task status.', problems);
      assert(updatedTask && Array.isArray(updatedTask.notes) && updatedTask.notes.length === 1, 'Task route should append one dashboard note.', problems);
      assert(updatedTask && updatedTask.notes[0] && updatedTask.notes[0].by === 'Dashboard', 'Task route should attribute notes to Dashboard.', problems);
      assert(updatedTask && updatedTask.notes[0] && updatedTask.notes[0].text === 'Claimed from dashboard fixture', 'Task route should persist the provided note text.', problems);

      const workflowSkipResponse = await requestJson(baseUrl, '/api/workflows', {
        method: 'POST',
        body: {
          action: 'skip',
          workflow_id: 'wf_dashboard_skip',
          step_id: 1,
        },
      });
      assert(workflowSkipResponse.status === 200, `POST /api/workflows should return 200 for skip, got ${workflowSkipResponse.status}.`, problems);
      assert(workflowSkipResponse.body && workflowSkipResponse.body.success === true, 'POST /api/workflows skip should succeed.', problems);

      let workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      let dashboardSkipWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_dashboard_skip') : null;
      assert(!!dashboardSkipWorkflow, 'Workflow route should preserve the targeted workflow entry.', problems);
      assert(dashboardSkipWorkflow && dashboardSkipWorkflow.steps[0].status === 'done', 'Workflow skip route should mark the current step done.', problems);
      assert(dashboardSkipWorkflow && dashboardSkipWorkflow.steps[1].status === 'in_progress', 'Workflow skip route should activate the next pending step.', problems);

      const pauseResponse = await requestJson(baseUrl, '/api/plan/pause', { method: 'POST' });
      assert(pauseResponse.status === 200, `POST /api/plan/pause should return 200, got ${pauseResponse.status}.`, problems);
      assert(pauseResponse.body && pauseResponse.body.success === true, 'POST /api/plan/pause should succeed.', problems);

      workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      let planWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      assert(!!planWorkflow, 'Pause route should preserve the autonomous workflow entry.', problems);
      assert(planWorkflow && planWorkflow.paused === true, 'Pause route should set workflow.paused.', problems);
      assert(planWorkflow && typeof planWorkflow.paused_at === 'string', 'Pause route should stamp paused_at.', problems);

      const resumeResponse = await requestJson(baseUrl, '/api/plan/resume', { method: 'POST' });
      assert(resumeResponse.status === 200, `POST /api/plan/resume should return 200, got ${resumeResponse.status}.`, problems);
      assert(resumeResponse.body && resumeResponse.body.success === true, 'POST /api/plan/resume should succeed.', problems);

      workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      planWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      assert(planWorkflow && planWorkflow.paused === false, 'Resume route should clear workflow.paused.', problems);
      assert(planWorkflow && !('paused_at' in planWorkflow), 'Resume route should remove paused_at.', problems);

      const planSkipResponse = await requestJson(baseUrl, '/api/plan/skip/1', {
        method: 'POST',
        body: { workflow_id: 'wf_plan_control' },
      });
      assert(planSkipResponse.status === 200, `POST /api/plan/skip/1 should return 200, got ${planSkipResponse.status}.`, problems);
      assert(planSkipResponse.body && planSkipResponse.body.success === true, 'POST /api/plan/skip/1 should succeed.', problems);

      workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      planWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      assert(planWorkflow && planWorkflow.steps[0].status === 'done', 'Plan skip route should mark the targeted step done.', problems);
      assert(planWorkflow && planWorkflow.steps[0].skipped === true, 'Plan skip route should mark the targeted step skipped.', problems);
      assert(planWorkflow && typeof planWorkflow.steps[0].notes === 'string' && planWorkflow.steps[0].notes.includes('[Skipped from dashboard]'), 'Plan skip route should append the dashboard skip note.', problems);
      assert(planWorkflow && planWorkflow.steps[1].status === 'in_progress', 'Plan skip route should activate dependency-ready steps.', problems);

      const reassignResponse = await requestJson(baseUrl, '/api/plan/reassign/2', {
        method: 'POST',
        body: {
          workflow_id: 'wf_plan_control',
          new_assignee: 'beta',
        },
      });
      assert(reassignResponse.status === 200, `POST /api/plan/reassign/2 should return 200, got ${reassignResponse.status}.`, problems);
      assert(reassignResponse.body && reassignResponse.body.success === true, 'POST /api/plan/reassign/2 should succeed.', problems);

      workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      planWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      assert(planWorkflow && planWorkflow.steps[1].assignee === 'beta', 'Plan reassign route should mutate the assignee through canonical workflow state.', problems);

      const stopResponse = await requestJson(baseUrl, '/api/plan/stop', { method: 'POST' });
      assert(stopResponse.status === 200, `POST /api/plan/stop should return 200, got ${stopResponse.status}.`, problems);
      assert(stopResponse.body && stopResponse.body.success === true, 'POST /api/plan/stop should succeed.', problems);

      workflows = readJson(path.join(dataDir, 'workflows.json'), []);
      planWorkflow = Array.isArray(workflows) ? workflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      assert(planWorkflow && planWorkflow.status === 'stopped', 'Plan stop route should mutate workflow.status to stopped.', problems);
      assert(planWorkflow && typeof planWorkflow.stopped_at === 'string', 'Plan stop route should stamp stopped_at.', problems);

      const finalMessages = readJsonl(messagesFile);
      const finalHistory = readJsonl(historyFile);
      const pauseMessages = finalHistory.filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN PAUSED]'));
      const resumeMessages = finalHistory.filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN RESUMED]'));
      const reassignMessages = finalHistory.filter((message) => typeof message.content === 'string' && message.content.startsWith('[REASSIGNED]'));
      const stopMessages = finalHistory.filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN STOPPED]'));

      assert(finalMessages.length === messageBaseline.mainMessageCount + 7, `Plan control routes should leave ${messageBaseline.mainMessageCount + 7} live main-branch messages, found ${finalMessages.length}.`, problems);
      assert(finalHistory.length === messageBaseline.mainHistoryCount + 7, `Plan control routes should leave ${messageBaseline.mainHistoryCount + 7} canonical main-branch history rows after deleting the injected dashboard message, found ${finalHistory.length}.`, problems);
      assert(pauseMessages.length === 2, 'Pause route should broadcast one message per registered agent.', problems);
      assert(resumeMessages.length === 2, 'Resume route should broadcast one message per registered agent.', problems);
      assert(reassignMessages.length === 1 && reassignMessages[0].to === 'beta', 'Reassign route should inject one direct message to the new assignee.', problems);
      assert(stopMessages.length === 2, 'Stop route should broadcast one message per registered agent.', problems);

      const messageEvents = readMessageEvents(eventLog);
      assert(messageEvents.length === messageEventCountBeforeInject + 10, `Canonical main-branch event log should retain ${messageEventCountBeforeInject + 10} message events including correction/redaction history, found ${messageEvents.length}.`, problems);
      assert(messageEvents.filter((event) => event.type === 'message.corrected').length === 1, 'Dashboard control-plane fixture should emit one canonical message.corrected event for the dashboard edit path.', problems);
      assert(messageEvents.filter((event) => event.type === 'message.redacted').length === 1, 'Dashboard control-plane fixture should emit one canonical message.redacted event for the dashboard delete path.', problems);
      assert(messageEvents.some((event) => event.payload && event.payload.message && event.payload.message.id === injectedMessageId), 'Canonical event log should retain the original injected message even after projection deletion.', problems);
      assert(messageEvents.filter((event) => event.payload && event.payload.message && typeof event.payload.message.content === 'string' && event.payload.message.content.startsWith('[PLAN PAUSED]')).length === 2, 'Canonical event log should record the plan pause broadcasts.', problems);
      assert(messageEvents.filter((event) => event.payload && event.payload.message && typeof event.payload.message.content === 'string' && event.payload.message.content.startsWith('[PLAN STOPPED]')).length === 2, 'Canonical event log should record the plan stop broadcasts.', problems);

      const featureBranch = branchTaskWorkflowFixture.featureBranch;
      const featureTasksResponse = await requestJson(baseUrl, `/api/tasks?branch=${featureBranch}`);
      assert(featureTasksResponse.status === 200, `GET /api/tasks?branch=${featureBranch} should return 200, got ${featureTasksResponse.status}.`, problems);
      assert(Array.isArray(featureTasksResponse.body), `GET /api/tasks?branch=${featureBranch} should return an array.`, problems);
      assert(featureTasksResponse.body && featureTasksResponse.body.length === 1 && featureTasksResponse.body[0].id === branchTaskWorkflowFixture.featureTaskId, `GET /api/tasks?branch=${featureBranch} should return only the feature-branch task fixture.`, problems);

      const featureTaskUpdateResponse = await requestJson(baseUrl, `/api/tasks?branch=${featureBranch}`, {
        method: 'POST',
        body: {
          task_id: branchTaskWorkflowFixture.featureTaskId,
          status: 'in_progress',
          notes: 'Claimed on feature dashboard branch',
        },
      });
      assert(featureTaskUpdateResponse.status === 200, `POST /api/tasks?branch=${featureBranch} should return 200, got ${featureTaskUpdateResponse.status}.`, problems);
      assert(featureTaskUpdateResponse.body && featureTaskUpdateResponse.body.success === true, `POST /api/tasks?branch=${featureBranch} should succeed.`, problems);

      const featureTasks = canonicalState.listTasks({ branch: featureBranch });
      const mainTasks = canonicalState.listTasks({ branch: 'main' });
      const updatedFeatureTask = Array.isArray(featureTasks) ? featureTasks.find((task) => task.id === branchTaskWorkflowFixture.featureTaskId) : null;
      assert(!!updatedFeatureTask, 'Feature-branch task update should remain visible in canonical branch-local task state.', problems);
      assert(updatedFeatureTask && updatedFeatureTask.status === 'in_progress', 'Feature-branch task update should mutate only the feature-branch task status.', problems);
      assert(updatedFeatureTask && Array.isArray(updatedFeatureTask.notes) && updatedFeatureTask.notes.some((note) => note && note.text === 'Claimed on feature dashboard branch'), 'Feature-branch task update should append the provided dashboard note.', problems);
      assert(Array.isArray(mainTasks) && !mainTasks.some((task) => task.id === branchTaskWorkflowFixture.featureTaskId), 'Feature-branch task fixture must not leak into canonical main-branch task reads.', problems);

      const featureWorkflowsResponse = await requestJson(baseUrl, `/api/workflows?branch=${featureBranch}`);
      assert(featureWorkflowsResponse.status === 200, `GET /api/workflows?branch=${featureBranch} should return 200, got ${featureWorkflowsResponse.status}.`, problems);
      assert(Array.isArray(featureWorkflowsResponse.body), `GET /api/workflows?branch=${featureBranch} should return an array.`, problems);
      assert(Array.isArray(featureWorkflowsResponse.body) && featureWorkflowsResponse.body.length === 2, `GET /api/workflows?branch=${featureBranch} should return the two feature-branch workflows.`, problems);
      assert(Array.isArray(featureWorkflowsResponse.body) && featureWorkflowsResponse.body.every((workflow) => workflow && workflow.branch_id === featureBranch), `GET /api/workflows?branch=${featureBranch} should only surface feature-branch workflows.`, problems);

      const featureWorkflowSkipResponse = await requestJson(baseUrl, `/api/workflows?branch=${featureBranch}`, {
        method: 'POST',
        body: {
          action: 'skip',
          workflow_id: branchTaskWorkflowFixture.featureWorkflowId,
          step_id: 1,
        },
      });
      assert(featureWorkflowSkipResponse.status === 200, `POST /api/workflows?branch=${featureBranch} should return 200 for skip, got ${featureWorkflowSkipResponse.status}.`, problems);
      assert(featureWorkflowSkipResponse.body && featureWorkflowSkipResponse.body.success === true, `POST /api/workflows?branch=${featureBranch} skip should succeed.`, problems);

      const featureWorkflows = canonicalState.listWorkflows({ branch: featureBranch });
      const mainWorkflowsAfterFeatureSkip = canonicalState.listWorkflows({ branch: 'main' });
      const updatedFeatureWorkflow = Array.isArray(featureWorkflows) ? featureWorkflows.find((workflow) => workflow.id === branchTaskWorkflowFixture.featureWorkflowId) : null;
      assert(!!updatedFeatureWorkflow, 'Feature-branch workflow skip should preserve the targeted feature workflow entry.', problems);
      assert(updatedFeatureWorkflow && updatedFeatureWorkflow.steps[0].status === 'done', 'Feature-branch workflow skip should mark the current feature step done.', problems);
      assert(updatedFeatureWorkflow && updatedFeatureWorkflow.steps[1].status === 'in_progress', 'Feature-branch workflow skip should activate the next dependency-ready feature step.', problems);
      assert(Array.isArray(mainWorkflowsAfterFeatureSkip) && !mainWorkflowsAfterFeatureSkip.some((workflow) => workflow.id === branchTaskWorkflowFixture.featureWorkflowId), 'Feature-branch workflow fixture must not leak into canonical main-branch workflow reads.', problems);

      const featurePlanStatusResponse = await requestJson(baseUrl, `/api/plan/status?branch=${featureBranch}`);
      assert(featurePlanStatusResponse.status === 200, `GET /api/plan/status?branch=${featureBranch} should return 200, got ${featurePlanStatusResponse.status}.`, problems);
      assert(featurePlanStatusResponse.body && Array.isArray(featurePlanStatusResponse.body.workflows), `GET /api/plan/status?branch=${featureBranch} should return a workflows array.`, problems);
      assert(featurePlanStatusResponse.body && Array.isArray(featurePlanStatusResponse.body.workflows) && featurePlanStatusResponse.body.workflows.every((workflow) => workflow && workflow.branch_id === featureBranch), `GET /api/plan/status?branch=${featureBranch} should only surface feature-branch workflows.`, problems);
      assert(featurePlanStatusResponse.body && Array.isArray(featurePlanStatusResponse.body.workflows) && featurePlanStatusResponse.body.workflows.some((workflow) => workflow.id === branchTaskWorkflowFixture.featurePlanWorkflowId), `GET /api/plan/status?branch=${featureBranch} should include the feature autonomous workflow.`, problems);

      const featurePlanReportResponse = await requestJson(baseUrl, `/api/plan/report?branch=${featureBranch}`);
      assert(featurePlanReportResponse.status === 200, `GET /api/plan/report?branch=${featureBranch} should return 200, got ${featurePlanReportResponse.status}.`, problems);
      assert(featurePlanReportResponse.body && Array.isArray(featurePlanReportResponse.body.workflows), `GET /api/plan/report?branch=${featureBranch} should return a workflows array.`, problems);
      assert(featurePlanReportResponse.body && Array.isArray(featurePlanReportResponse.body.workflows) && featurePlanReportResponse.body.workflows.every((workflow) => workflow && workflow.branch_id === featureBranch), `GET /api/plan/report?branch=${featureBranch} should only report feature-branch workflows.`, problems);

      const mainPauseMessagesBeforeFeaturePause = canonicalState.getConversationMessages({ branch: 'main' }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN PAUSED]')).length;
      const mainResumeMessagesBeforeFeatureResume = canonicalState.getConversationMessages({ branch: 'main' }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN RESUMED]')).length;

      const featurePauseResponse = await requestJson(baseUrl, `/api/plan/pause?branch=${featureBranch}`, { method: 'POST' });
      assert(featurePauseResponse.status === 200, `POST /api/plan/pause?branch=${featureBranch} should return 200, got ${featurePauseResponse.status}.`, problems);
      assert(featurePauseResponse.body && featurePauseResponse.body.success === true, `POST /api/plan/pause?branch=${featureBranch} should succeed.`, problems);

      let featurePlanWorkflows = canonicalState.listWorkflows({ branch: featureBranch });
      let mainPlanWorkflows = canonicalState.listWorkflows({ branch: 'main' });
      let featurePlanWorkflow = Array.isArray(featurePlanWorkflows) ? featurePlanWorkflows.find((workflow) => workflow.id === branchTaskWorkflowFixture.featurePlanWorkflowId) : null;
      let mainPlanWorkflow = Array.isArray(mainPlanWorkflows) ? mainPlanWorkflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      let featurePauseMessages = canonicalState.getConversationMessages({ branch: featureBranch }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN PAUSED]'));
      assert(featurePlanWorkflow && featurePlanWorkflow.paused === true, 'Feature-branch plan pause should set workflow.paused on the feature autonomous workflow only.', problems);
      assert(mainPlanWorkflow && mainPlanWorkflow.paused !== true, 'Feature-branch plan pause must not pause the main autonomous workflow.', problems);
      assert(featurePauseMessages.length === 2, 'Feature-branch plan pause should broadcast one pause message per registered agent on the feature branch.', problems);
      assert(canonicalState.getConversationMessages({ branch: 'main' }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN PAUSED]')).length === mainPauseMessagesBeforeFeaturePause, 'Feature-branch plan pause must not add pause broadcasts to main-branch conversation history.', problems);

      const featureResumeResponse = await requestJson(baseUrl, `/api/plan/resume?branch=${featureBranch}`, { method: 'POST' });
      assert(featureResumeResponse.status === 200, `POST /api/plan/resume?branch=${featureBranch} should return 200, got ${featureResumeResponse.status}.`, problems);
      assert(featureResumeResponse.body && featureResumeResponse.body.success === true, `POST /api/plan/resume?branch=${featureBranch} should succeed.`, problems);

      featurePlanWorkflows = canonicalState.listWorkflows({ branch: featureBranch });
      mainPlanWorkflows = canonicalState.listWorkflows({ branch: 'main' });
      featurePlanWorkflow = Array.isArray(featurePlanWorkflows) ? featurePlanWorkflows.find((workflow) => workflow.id === branchTaskWorkflowFixture.featurePlanWorkflowId) : null;
      mainPlanWorkflow = Array.isArray(mainPlanWorkflows) ? mainPlanWorkflows.find((workflow) => workflow.id === 'wf_plan_control') : null;
      const featureResumeMessages = canonicalState.getConversationMessages({ branch: featureBranch }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN RESUMED]'));
      assert(featurePlanWorkflow && featurePlanWorkflow.paused === false, 'Feature-branch plan resume should clear paused on the feature autonomous workflow.', problems);
      assert(featurePlanWorkflow && !('paused_at' in featurePlanWorkflow), 'Feature-branch plan resume should remove paused_at from the feature autonomous workflow.', problems);
      assert(mainPlanWorkflow && mainPlanWorkflow.paused !== true, 'Feature-branch plan resume must not mutate the main autonomous workflow pause state.', problems);
      assert(featureResumeMessages.length === 2, 'Feature-branch plan resume should broadcast one resume message per registered agent on the feature branch.', problems);
      assert(canonicalState.getConversationMessages({ branch: 'main' }).filter((message) => typeof message.content === 'string' && message.content.startsWith('[PLAN RESUMED]')).length === mainResumeMessagesBeforeFeatureResume, 'Feature-branch plan resume must not add resume broadcasts to main-branch conversation history.', problems);

      const invalidEditTarget = readJsonl(messagesFile)[0];
      const invalidEditEventCountBefore = readMessageEvents(eventLog).length;
      let invalidEditError = null;
      try {
        canonicalState.editMessage({
          id: invalidEditTarget && invalidEditTarget.id,
          content: { invalid: true },
          actor: 'Dashboard',
          maxEditHistory: 10,
        });
      } catch (error) {
        invalidEditError = error;
      }
      assert(!!invalidEditTarget && typeof invalidEditTarget.id === 'string', 'Invalid edit payload guard needs a live message fixture to target.', problems);
      assert(!!invalidEditError && typeof invalidEditError.message === 'string' && invalidEditError.message.includes('payload.content to be a string'), 'Invalid edit payloads must fail before canonical append instead of poisoning replay state.', problems);
      assert(readMessageEvents(eventLog).length === invalidEditEventCountBefore, 'Invalid edit payload rejection must not append new canonical message events.', problems);

      const mainMessagesBeforeClear = canonicalState.getConversationMessages({ branch: 'main' });
      const featureMessagesBeforeClear = canonicalState.getConversationMessages({ branch: featureBranch });
      const featureMessageEventsBeforeClear = readMessageEvents(eventLog, featureBranch);
      const featureClearResponse = await requestJson(baseUrl, `/api/clear-messages?branch=${featureBranch}`, {
        method: 'POST',
        body: { confirm: true },
      });
      assert(featureClearResponse.status === 200, `POST /api/clear-messages?branch=${featureBranch} should return 200, got ${featureClearResponse.status}.`, problems);
      assert(featureClearResponse.body && featureClearResponse.body.success === true, `POST /api/clear-messages?branch=${featureBranch} should succeed.`, problems);
      assert(featureClearResponse.body && featureClearResponse.body.branch === featureBranch, 'Clear Messages should report the cleared non-main branch.', problems);
      assert(featureClearResponse.body && featureClearResponse.body.cleared_messages === featureMessagesBeforeClear.length, 'Clear Messages should report the number of cleared branch-local messages.', problems);
      assert(canonicalState.getConversationMessages({ branch: featureBranch }).length === 0, 'Clear Messages should remove all live messages from the targeted non-main branch.', problems);
      assert(canonicalState.getConversationMessages({ branch: 'main' }).length === mainMessagesBeforeClear.length, 'Clear Messages on a feature branch must not remove main-branch messages.', problems);
      assert(readMessageEvents(eventLog, featureBranch).length === featureMessageEventsBeforeClear.length + featureMessagesBeforeClear.length, 'Clear Messages should append one canonical message.redacted event per cleared branch-local message.', problems);
      assert(readMessageEvents(eventLog, featureBranch).filter((event) => event.type === 'message.redacted').length === featureMessagesBeforeClear.length, 'Clear Messages should record canonical redactions for every cleared branch-local message.', problems);

      const archiveResult = canonicalState.archiveCurrentConversation();
      assert(archiveResult && archiveResult.fail_closed === true, 'archiveCurrentConversation() must fail closed while projection-only archive rotation is unsupported.', problems);

      const conversationsDir = path.join(dataDir, 'conversations');
      fs.mkdirSync(conversationsDir, { recursive: true });
      writeJsonl(path.join(conversationsDir, 'conversation-fixture.jsonl'), [
        { id: 'archived-fixture-message', from: 'alpha', to: 'beta', content: 'archived fixture', timestamp: '2026-04-16T06:00:00.000Z' },
      ]);
      const loadResult = canonicalState.loadConversation('conversation-fixture');
      assert(loadResult && loadResult.fail_closed === true, 'loadConversation() must fail closed instead of replay-poisoning canonical state from archived projections.', problems);
      assert(readJsonl(getScopedBranchFile(dataDir, featureBranch, 'messages.jsonl')).length === 0, 'Fail-closed loadConversation() must not rewrite cleared feature-branch message projections.', problems);

      const runtimeDir = path.join(dataDir, 'runtime');
      const resetResult = canonicalState.resetRuntime();
      assert(resetResult && resetResult.success === true, 'resetRuntime() should still succeed as a full canonical reset.', problems);
      assert(!fs.existsSync(runtimeDir), 'resetRuntime() must delete canonical runtime data instead of leaving event truth behind.', problems);
      assert(!fs.existsSync(messagesFile), 'resetRuntime() must clear main messages.jsonl during a full canonical reset.', problems);
      assert(!fs.existsSync(historyFile), 'resetRuntime() must clear main history.jsonl during a full canonical reset.', problems);
    });
  } catch (error) {
    problems.push(error.stack || error.message);
  }

  if (problems.length > 0) {
    fail(['Dashboard control-plane runtime validation failed.', ...problems.map((problem) => `- ${problem}`)], 1);
  }

  console.log([
    'Dashboard control-plane runtime validation passed.',
    'Validated real dashboard HTTP routes for branch-scoped history/channels/search/export reads, Assistant default-vs-private inject routing, non-terminal task mutation, workflow skip, and representative plan pause/resume/skip/reassign/stop control against a temp canonical runtime.',
    'Validated canonical projection state plus branch-local message.sent and rule.* events for dashboard-originated control-plane mutations without widening into browser/UI automation.',
    'Validated invalid message edits fail before canonical append, branch-aware Clear Messages redacts canonical history instead of failing closed, archive/load helpers still fail closed, and full reset removes canonical runtime truth instead of only deleting projections.',
  ].join('\n'));
}

async function runEditDeleteSemanticGapScenario() {
  const problems = [];

  try {
    await withDashboardFixture(async ({ baseUrl, dataDir, canonicalState, eventLog }) => {
      const messagesFile = path.join(dataDir, 'messages.jsonl');
      const historyFile = path.join(dataDir, 'history.jsonl');

      const editSeedResponse = await requestJson(baseUrl, '/api/inject', {
        method: 'POST',
        body: { to: 'alpha', content: 'Dashboard semantic gap edit seed' },
      });
      assert(editSeedResponse.status === 200, `POST /api/inject edit seed should return 200, got ${editSeedResponse.status}.`, problems);
      const editSeedId = editSeedResponse.body && editSeedResponse.body.messageId;

      const editResponse = await requestJson(baseUrl, '/api/message', {
        method: 'PUT',
        body: { id: editSeedId, content: 'Dashboard semantic gap edited content' },
      });
      assert(editResponse.status === 200, `PUT /api/message should return 200 during semantic-gap validation, got ${editResponse.status}.`, problems);
      const editedProjection = readJsonl(messagesFile).find((message) => message.id === editSeedId);
      const editedHistoryProjection = readJsonl(historyFile).find((message) => message.id === editSeedId);
      assert(editedProjection && editedProjection.content === 'Dashboard semantic gap edited content', 'Edit/delete invariant expected PUT /api/message to rewrite the live message projection from canonical replay.', problems);
      assert(editedHistoryProjection && Array.isArray(editedHistoryProjection.edit_history) && editedHistoryProjection.edit_history.length === 1, 'Edit/delete invariant expected PUT /api/message to materialize edit_history metadata into history.jsonl.', problems);

      const editEvents = readMessageEvents(eventLog);
      assert(editEvents.some((event) => event.type === 'message.corrected'), 'PUT /api/message should emit a canonical message.corrected event instead of relying only on projection rewrites.', problems);

      fs.unlinkSync(messagesFile);
      fs.unlinkSync(historyFile);
      canonicalState.rebuildMessageProjections({ branch: 'main' });
      const rebuiltEditedProjection = readJsonl(messagesFile).find((message) => message.id === editSeedId);
      const rebuiltEditedHistoryProjection = readJsonl(historyFile).find((message) => message.id === editSeedId);
      assert(rebuiltEditedProjection && rebuiltEditedProjection.content === 'Dashboard semantic gap edited content', 'Edited content must survive a branch projection rebuild from canonical events.', problems);
      assert(rebuiltEditedHistoryProjection && Array.isArray(rebuiltEditedHistoryProjection.edit_history) && rebuiltEditedHistoryProjection.edit_history.length === 1, 'Edited history metadata must survive a branch projection rebuild from canonical events.', problems);

      const deleteSeedResponse = await requestJson(baseUrl, '/api/inject', {
        method: 'POST',
        body: { to: 'alpha', content: 'Dashboard semantic gap delete seed' },
      });
      assert(deleteSeedResponse.status === 200, `POST /api/inject delete seed should return 200, got ${deleteSeedResponse.status}.`, problems);
      const deleteSeedId = deleteSeedResponse.body && deleteSeedResponse.body.messageId;

      const deleteResponse = await requestJson(baseUrl, '/api/message', {
        method: 'DELETE',
        body: { id: deleteSeedId },
      });
      assert(deleteResponse.status === 200, `DELETE /api/message should return 200 during semantic-gap validation, got ${deleteResponse.status}.`, problems);
      assert(!readJsonl(messagesFile).some((message) => message.id === deleteSeedId), 'Edit/delete invariant expected DELETE /api/message to remove the live message projection row.', problems);
      assert(!readJsonl(historyFile).some((message) => message.id === deleteSeedId), 'Edit/delete invariant expected DELETE /api/message to remove the live history projection row.', problems);

      const deleteEvents = readMessageEvents(eventLog);
      assert(deleteEvents.some((event) => event.type === 'message.redacted'), 'DELETE /api/message should emit a canonical message.redacted event instead of deleting projections in place.', problems);

      fs.unlinkSync(messagesFile);
      fs.unlinkSync(historyFile);
      canonicalState.rebuildMessageProjections({ branch: 'main' });
      assert(!readJsonl(messagesFile).some((message) => message.id === deleteSeedId), 'Deleted messages must remain absent after replay/materialization rebuild.', problems);
      assert(!readJsonl(historyFile).some((message) => message.id === deleteSeedId), 'Deleted history rows must remain absent after replay/materialization rebuild.', problems);
    });
  } catch (error) {
    problems.push(error.stack || error.message);
  }

  if (problems.length > 0) {
    fail(['Dashboard edit/delete semantic-gap invariant failed.', ...problems.map((problem) => `- ${problem}`)], 1);
  }

  console.log([
    'Dashboard edit/delete semantic-gap invariant passed.',
    'Dashboard edit/delete routes emitted canonical correction/redaction events and rebuild from canonical message events preserved the edited/deleted state.',
  ].join('\n'));
}

async function main() {
  const { scenario } = parseArgs(process.argv.slice(2));
  if (scenario === 'edit-delete-semantic-gap') {
    await runEditDeleteSemanticGapScenario();
    return;
  }

  await runHealthyScenario();
}

main();
