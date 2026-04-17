#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createCanonicalState,
  createBranchPathResolvers,
} = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const FEATURE_BRANCH = 'feature_task4c';
const TRACKED_AGENT = 'beta';
const CHANNEL_NAME = 'ops';
const SUPPORTED_LEAKS = ['messages', 'delivery', 'control', 'channels', 'tasks-workflows', 'workspaces'];
const USAGE = `Usage: node agent-bridge/scripts/check-branch-isolation.js [--simulate-cross-branch-leak ${SUPPORTED_LEAKS.join('|')}]`;

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { simulateCrossBranchLeak: null };
  }

  if (argv.length === 2 && argv[0] === '--simulate-cross-branch-leak') {
    const simulateCrossBranchLeak = argv[1];
    if (!SUPPORTED_LEAKS.includes(simulateCrossBranchLeak)) {
      fail([
        `Unknown leak domain: ${simulateCrossBranchLeak}`,
        `Supported leak domains: ${SUPPORTED_LEAKS.join(', ')}`,
        USAGE,
      ], 2);
    }

    return { simulateCrossBranchLeak };
  }

  fail([USAGE], 2);
}

function stableSerialize(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function deepEqual(actual, expected) {
  return stableSerialize(actual) === stableSerialize(expected);
}

function toJsonl(rows) {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function displayScopedPath(dataDir, filePath) {
  const relative = path.relative(dataDir, filePath).split(path.sep).join('/');
  return `.agent-bridge/${relative}`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function collectCompressedMessageIds(compressed) {
  const segments = Array.isArray(compressed && compressed.segments) ? compressed.segments : [];
  return uniqueSorted(
    segments.flatMap((segment) => [segment.first_msg_id, segment.last_msg_id])
  );
}

function expectEqual(problems, label, filePath, actual, expected, dataDir) {
  if (!deepEqual(actual, expected)) {
    problems.push(`${label} in ${displayScopedPath(dataDir, filePath)} did not match the healthy branch-local fixture.`);
  }
}

function expectBasename(problems, label, filePath, expectedBasename, dataDir) {
  if (path.basename(filePath) !== expectedBasename) {
    problems.push(`${label} resolved to ${displayScopedPath(dataDir, filePath)} instead of .agent-bridge/${expectedBasename}.`);
  }
}

function reportForeignIds(problems, label, filePath, ids, foreignIds, dataDir) {
  const leakedIds = uniqueSorted(ids.filter((id) => foreignIds.has(id)));
  if (leakedIds.length > 0) {
    problems.push(`${label} leaked foreign branch message ids via ${displayScopedPath(dataDir, filePath)}: ${leakedIds.join(', ')}`);
  }
}

function createFixture() {
  const generalChannel = {
    description: 'General channel — all agents',
    members: ['*'],
    created_by: 'system',
    created_at: '2026-04-15T00:00:00.000Z',
  };

  const mainMessages = [
    {
      id: 'msg-task4c-main-1',
      from: 'alpha',
      to: 'beta',
      content: 'Main branch hello',
      timestamp: '2026-04-15T23:40:00.000Z',
      reply_to: null,
      system: false,
    },
    {
      id: 'msg-task4c-main-2',
      from: 'beta',
      to: 'alpha',
      content: 'Main branch reply',
      timestamp: '2026-04-15T23:40:05.000Z',
      reply_to: 'msg-task4c-main-1',
      system: false,
    },
  ];

  const featureMessages = [
    {
      id: 'msg-task4c-feature-1',
      from: 'alpha',
      to: 'beta',
      content: 'Feature branch hello',
      timestamp: '2026-04-15T23:41:00.000Z',
      reply_to: null,
      system: false,
    },
    {
      id: 'msg-task4c-feature-2',
      from: 'beta',
      to: 'alpha',
      content: 'Feature branch reply',
      timestamp: '2026-04-15T23:41:05.000Z',
      reply_to: 'msg-task4c-feature-1',
      system: false,
    },
  ];

  const mainChannelMessages = [
    {
      id: 'msg-task4c-main-ops-1',
      from: 'alpha',
      to: '__group__',
      channel: CHANNEL_NAME,
      content: 'Main branch ops note',
      timestamp: '2026-04-15T23:40:10.000Z',
      system: false,
    },
  ];

  const featureChannelMessages = [
    {
      id: 'msg-task4c-feature-ops-1',
      from: 'beta',
      to: '__group__',
      channel: CHANNEL_NAME,
      content: 'Feature branch ops note',
      timestamp: '2026-04-15T23:41:10.000Z',
      system: false,
    },
  ];

  return {
    featureBranch: FEATURE_BRANCH,
    trackedAgent: TRACKED_AGENT,
    channelName: CHANNEL_NAME,
    branches: {
      main: {
        tasks: [
          {
            id: 'task-task4c-main',
            title: 'Main branch task fixture',
            description: 'Main branch task branch-locality fixture',
            status: 'pending',
            assignee: 'alpha',
            created_by: 'alpha',
            created_at: '2026-04-15T23:39:00.000Z',
            updated_at: '2026-04-15T23:39:00.000Z',
            notes: [],
          },
        ],
        workflows: [
          {
            id: 'wf-task4c-main',
            name: 'Main branch workflow fixture',
            branch_id: 'main',
            status: 'active',
            autonomous: false,
            parallel: false,
            created_by: 'alpha',
            created_at: '2026-04-15T23:39:00.000Z',
            updated_at: '2026-04-15T23:39:00.000Z',
            steps: [
              {
                id: 1,
                description: 'Main branch workflow step',
                assignee: 'alpha',
                depends_on: [],
                status: 'in_progress',
                started_at: '2026-04-15T23:39:00.000Z',
                completed_at: null,
                notes: '',
              },
            ],
          },
        ],
        messages: mainMessages,
        history: mainMessages,
        acks: {
          'msg-task4c-main-2': {
            acked_by: 'alpha',
            acked_at: '2026-04-15T23:40:07.000Z',
          },
        },
        readReceipts: {
          'msg-task4c-main-1': {
            beta: '2026-04-15T23:40:01.000Z',
          },
        },
        consumedByAgent: {
          [TRACKED_AGENT]: ['msg-task4c-main-1'],
        },
        compressed: {
          segments: [
            {
              id: 'seg-task4c-main-1',
              from_time: '2026-04-15T23:40:00.000Z',
              to_time: '2026-04-15T23:40:05.000Z',
              message_count: 2,
              speakers: ['alpha', 'beta'],
              summary: 'alpha: Main branch hello | beta: Main branch reply',
              first_msg_id: 'msg-task4c-main-1',
              last_msg_id: 'msg-task4c-main-2',
            },
          ],
          last_compressed_at: '2026-04-15T23:40:06.000Z',
          total_original_messages: 2,
        },
        config: {
          conversation_mode: 'managed',
          group_cooldown: 1000,
          managed: {
            manager: 'alpha',
            phase: 'review',
            floor: 'alpha',
            turn_queue: ['beta'],
            turn_current: 'alpha',
            phase_history: [
              { phase: 'discussion', at: '2026-04-15T23:39:00.000Z' },
              { phase: 'review', at: '2026-04-15T23:40:06.000Z' },
            ],
          },
        },
        channels: {
          general: generalChannel,
          [CHANNEL_NAME]: {
            description: 'Main branch ops',
            members: ['alpha', 'beta'],
            created_by: 'alpha',
            created_at: '2026-04-15T23:40:10.000Z',
          },
        },
        channelMessages: mainChannelMessages,
        channelHistory: mainChannelMessages,
        workspaces: {
          alpha: {
            draft: { content: 'Main branch alpha workspace' },
          },
          beta: {
            _status: 'Main branch workspace status',
            retry_history: [
              { attempt: 1, task: 'main-task', timestamp: '2026-04-15T23:40:20.000Z' },
            ],
          },
        },
      },
      [FEATURE_BRANCH]: {
        tasks: [
          {
            id: 'task-task4c-feature',
            title: 'Feature branch task fixture',
            description: 'Feature branch task branch-locality fixture',
            status: 'in_progress',
            assignee: 'beta',
            created_by: 'beta',
            created_at: '2026-04-15T23:40:30.000Z',
            updated_at: '2026-04-15T23:40:30.000Z',
            notes: [
              {
                by: 'beta',
                text: 'Feature branch task note',
                at: '2026-04-15T23:40:31.000Z',
              },
            ],
          },
        ],
        workflows: [
          {
            id: 'wf-task4c-feature',
            name: 'Feature branch workflow fixture',
            branch_id: FEATURE_BRANCH,
            status: 'active',
            autonomous: true,
            parallel: false,
            created_by: 'beta',
            created_at: '2026-04-15T23:40:30.000Z',
            updated_at: '2026-04-15T23:40:30.000Z',
            steps: [
              {
                id: 1,
                description: 'Feature branch workflow step',
                assignee: 'beta',
                depends_on: [],
                status: 'in_progress',
                started_at: '2026-04-15T23:40:30.000Z',
                completed_at: null,
                notes: '',
              },
            ],
          },
        ],
        messages: featureMessages,
        history: featureMessages,
        acks: {
          'msg-task4c-feature-2': {
            acked_by: 'alpha',
            acked_at: '2026-04-15T23:41:07.000Z',
          },
        },
        readReceipts: {
          'msg-task4c-feature-1': {
            beta: '2026-04-15T23:41:01.000Z',
          },
        },
        consumedByAgent: {
          [TRACKED_AGENT]: ['msg-task4c-feature-1'],
        },
        compressed: {
          segments: [
            {
              id: 'seg-task4c-feature-1',
              from_time: '2026-04-15T23:41:00.000Z',
              to_time: '2026-04-15T23:41:05.000Z',
              message_count: 2,
              speakers: ['alpha', 'beta'],
              summary: 'alpha: Feature branch hello | beta: Feature branch reply',
              first_msg_id: 'msg-task4c-feature-1',
              last_msg_id: 'msg-task4c-feature-2',
            },
          ],
          last_compressed_at: '2026-04-15T23:41:06.000Z',
          total_original_messages: 2,
        },
        config: {
          conversation_mode: 'managed',
          group_cooldown: 1750,
          managed: {
            manager: 'beta',
            phase: 'execution',
            floor: 'beta',
            turn_queue: ['alpha'],
            turn_current: 'beta',
            phase_history: [
              { phase: 'planning', at: '2026-04-15T23:40:40.000Z' },
              { phase: 'execution', at: '2026-04-15T23:41:06.000Z' },
            ],
          },
        },
        channels: {
          general: generalChannel,
          [CHANNEL_NAME]: {
            description: 'Feature branch ops',
            members: ['beta'],
            created_by: 'beta',
            created_at: '2026-04-15T23:41:10.000Z',
          },
        },
        channelMessages: featureChannelMessages,
        channelHistory: featureChannelMessages,
        workspaces: {
          alpha: {
            draft: { content: 'Feature branch alpha workspace' },
          },
          beta: {
            _status: 'Feature branch workspace status',
            retry_history: [
              { attempt: 2, task: 'feature-task', timestamp: '2026-04-15T23:41:20.000Z' },
            ],
          },
        },
      },
    },
  };
}

function writeScenarioFixtures(dataDir, fixture) {
  const branchPaths = createBranchPathResolvers(dataDir);
  const canonicalState = createCanonicalState({ dataDir, processPid: 4545 });

  fs.mkdirSync(dataDir, { recursive: true });

  for (const message of fixture.branches.main.messages) {
    canonicalState.appendMessage(message);
  }

  for (const message of fixture.branches[fixture.featureBranch].messages) {
    canonicalState.appendMessage(message, { branch: fixture.featureBranch });
  }

  for (const [branchName, spec] of Object.entries(fixture.branches)) {
    fs.writeFileSync(branchPaths.getTasksFile(branchName), JSON.stringify(spec.tasks));
    fs.writeFileSync(branchPaths.getWorkflowsFile(branchName), JSON.stringify(spec.workflows));
    fs.writeFileSync(branchPaths.getAcksFile(branchName), JSON.stringify(spec.acks));
    fs.writeFileSync(branchPaths.getReadReceiptsFile(branchName), JSON.stringify(spec.readReceipts));
    fs.writeFileSync(branchPaths.getConsumedFile(fixture.trackedAgent, branchName), JSON.stringify(spec.consumedByAgent[fixture.trackedAgent] || []));
    fs.writeFileSync(branchPaths.getCompressedFile(branchName), JSON.stringify(spec.compressed));
    fs.writeFileSync(branchPaths.getConfigFile(branchName), JSON.stringify(spec.config));
    fs.writeFileSync(branchPaths.getChannelsFile(branchName), JSON.stringify(spec.channels));
    fs.writeFileSync(branchPaths.getChannelMessagesFile(fixture.channelName, branchName), toJsonl(spec.channelMessages));
    fs.writeFileSync(branchPaths.getChannelHistoryFile(fixture.channelName, branchName), toJsonl(spec.channelHistory));
    fs.mkdirSync(branchPaths.getWorkspacesDir(branchName), { recursive: true });
    for (const [agentName, workspace] of Object.entries(spec.workspaces || {})) {
      fs.writeFileSync(branchPaths.getWorkspaceFile(agentName, branchName), JSON.stringify(workspace));
    }
  }

  return branchPaths;
}

function applySimulatedCrossBranchLeak(dataDir, branchPaths, fixture, domain) {
  const mainSpec = fixture.branches.main;
  const featureBranch = fixture.featureBranch;

  if (domain === 'messages') {
    fs.writeFileSync(branchPaths.getMessagesFile(featureBranch), toJsonl(mainSpec.messages));
    fs.writeFileSync(branchPaths.getHistoryFile(featureBranch), toJsonl(mainSpec.history));
    return;
  }

  if (domain === 'delivery') {
    fs.writeFileSync(branchPaths.getAcksFile(featureBranch), JSON.stringify(mainSpec.acks));
    fs.writeFileSync(branchPaths.getReadReceiptsFile(featureBranch), JSON.stringify(mainSpec.readReceipts));
    fs.writeFileSync(branchPaths.getConsumedFile(fixture.trackedAgent, featureBranch), JSON.stringify(mainSpec.consumedByAgent[fixture.trackedAgent] || []));
    fs.writeFileSync(branchPaths.getCompressedFile(featureBranch), JSON.stringify(mainSpec.compressed));
    return;
  }

  if (domain === 'control') {
    fs.writeFileSync(branchPaths.getConfigFile(featureBranch), JSON.stringify(mainSpec.config));
    return;
  }

  if (domain === 'channels') {
    fs.writeFileSync(branchPaths.getChannelsFile(featureBranch), JSON.stringify(mainSpec.channels));
    fs.writeFileSync(branchPaths.getChannelMessagesFile(fixture.channelName, featureBranch), toJsonl(mainSpec.channelMessages));
    fs.writeFileSync(branchPaths.getChannelHistoryFile(fixture.channelName, featureBranch), toJsonl(mainSpec.channelHistory));
    return;
  }

  if (domain === 'tasks-workflows') {
    fs.writeFileSync(branchPaths.getTasksFile(featureBranch), JSON.stringify(mainSpec.tasks));
    fs.writeFileSync(branchPaths.getWorkflowsFile(featureBranch), JSON.stringify(mainSpec.workflows));
    return;
  }

  if (domain === 'workspaces') {
    fs.rmSync(branchPaths.getWorkspacesDir(featureBranch), { recursive: true, force: true });
    fs.mkdirSync(branchPaths.getWorkspacesDir(featureBranch), { recursive: true });
    for (const [agentName, workspace] of Object.entries(mainSpec.workspaces || {})) {
      fs.writeFileSync(branchPaths.getWorkspaceFile(agentName, featureBranch), JSON.stringify(workspace));
    }
    return;
  }

  fail([
    `Internal error: unsupported leak domain ${domain}`,
    USAGE,
  ], 2);
}

function getBranchIsolationChecks(dataDir, branchPaths, fixture) {
  const branchNames = ['main', fixture.featureBranch];
  const readWorkspaces = (branchName) => {
    const directory = branchPaths.getWorkspacesDir(branchName);
    if (!fs.existsSync(directory)) return {};

    return Object.fromEntries(
      fs.readdirSync(directory)
        .filter((fileName) => fileName.endsWith('.json'))
        .sort()
        .map((fileName) => [fileName.replace(/\.json$/i, ''), readJson(path.join(directory, fileName), {})])
    );
  };

  return [
    {
      key: 'path_resolution',
      success: 'Branch path resolvers still isolate legacy main files from branch-prefixed P0 projections.',
      run() {
        const problems = [];
        const featureBranch = fixture.featureBranch;

        expectBasename(problems, 'Main messages file', branchPaths.getMessagesFile('main'), 'messages.jsonl', dataDir);
        expectBasename(problems, 'Feature messages file', branchPaths.getMessagesFile(featureBranch), `branch-${featureBranch}-messages.jsonl`, dataDir);
        expectBasename(problems, 'Main history file', branchPaths.getHistoryFile('main'), 'history.jsonl', dataDir);
        expectBasename(problems, 'Feature history file', branchPaths.getHistoryFile(featureBranch), `branch-${featureBranch}-history.jsonl`, dataDir);
        expectBasename(problems, 'Main acks file', branchPaths.getAcksFile('main'), 'acks.json', dataDir);
        expectBasename(problems, 'Main tasks file', branchPaths.getTasksFile('main'), 'tasks.json', dataDir);
        expectBasename(problems, 'Feature tasks file', branchPaths.getTasksFile(featureBranch), `branch-${featureBranch}-tasks.json`, dataDir);
        expectBasename(problems, 'Main workflows file', branchPaths.getWorkflowsFile('main'), 'workflows.json', dataDir);
        expectBasename(problems, 'Feature workflows file', branchPaths.getWorkflowsFile(featureBranch), `branch-${featureBranch}-workflows.json`, dataDir);
        expectBasename(problems, 'Feature acks file', branchPaths.getAcksFile(featureBranch), `branch-${featureBranch}-acks.json`, dataDir);
        expectBasename(problems, 'Main read receipts file', branchPaths.getReadReceiptsFile('main'), 'read_receipts.json', dataDir);
        expectBasename(problems, 'Feature read receipts file', branchPaths.getReadReceiptsFile(featureBranch), `branch-${featureBranch}-read_receipts.json`, dataDir);
        expectBasename(problems, 'Main config file', branchPaths.getConfigFile('main'), 'config.json', dataDir);
        expectBasename(problems, 'Feature config file', branchPaths.getConfigFile(featureBranch), `branch-${featureBranch}-config.json`, dataDir);
        expectBasename(problems, 'Main channels file', branchPaths.getChannelsFile('main'), 'channels.json', dataDir);
        expectBasename(problems, 'Feature channels file', branchPaths.getChannelsFile(featureBranch), `branch-${featureBranch}-channels.json`, dataDir);
        expectBasename(problems, 'Main compressed file', branchPaths.getCompressedFile('main'), 'compressed.json', dataDir);
        expectBasename(problems, 'Feature compressed file', branchPaths.getCompressedFile(featureBranch), `branch-${featureBranch}-compressed.json`, dataDir);
        expectBasename(problems, 'Main consumed file', branchPaths.getConsumedFile(fixture.trackedAgent, 'main'), `consumed-${fixture.trackedAgent}.json`, dataDir);
        expectBasename(problems, 'Feature consumed file', branchPaths.getConsumedFile(fixture.trackedAgent, featureBranch), `branch-${featureBranch}-consumed-${fixture.trackedAgent}.json`, dataDir);
        expectBasename(problems, 'Main channel messages file', branchPaths.getChannelMessagesFile(fixture.channelName, 'main'), `channel-${fixture.channelName}-messages.jsonl`, dataDir);
        expectBasename(problems, 'Feature channel messages file', branchPaths.getChannelMessagesFile(fixture.channelName, featureBranch), `branch-${featureBranch}-channel-${fixture.channelName}-messages.jsonl`, dataDir);
        expectBasename(problems, 'Main channel history file', branchPaths.getChannelHistoryFile(fixture.channelName, 'main'), `channel-${fixture.channelName}-history.jsonl`, dataDir);
        expectBasename(problems, 'Feature channel history file', branchPaths.getChannelHistoryFile(fixture.channelName, featureBranch), `branch-${featureBranch}-channel-${fixture.channelName}-history.jsonl`, dataDir);
        expectBasename(problems, 'Main workspaces dir', branchPaths.getWorkspacesDir('main'), 'workspaces', dataDir);
        expectBasename(problems, 'Feature workspaces dir', branchPaths.getWorkspacesDir(featureBranch), `branch-${featureBranch}-workspaces`, dataDir);
        expectBasename(problems, 'Main tracked workspace file', branchPaths.getWorkspaceFile(fixture.trackedAgent, 'main'), `${fixture.trackedAgent}.json`, dataDir);
        expectBasename(problems, 'Feature tracked workspace file', branchPaths.getWorkspaceFile(fixture.trackedAgent, featureBranch), `${fixture.trackedAgent}.json`, dataDir);

        return problems;
      },
    },
    {
      key: 'messages_history',
      success: 'Messages/history remain isolated between main and feature_task4c branches.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const foreignMessageIds = new Set(fixture.branches[otherBranch].messages.map((message) => message.id));
          const messagesFile = branchPaths.getMessagesFile(branchName);
          const historyFile = branchPaths.getHistoryFile(branchName);
          const actualMessages = readJsonl(messagesFile);
          const actualHistory = readJsonl(historyFile);

          expectEqual(problems, `${branchName} messages`, messagesFile, actualMessages, spec.messages, dataDir);
          expectEqual(problems, `${branchName} history`, historyFile, actualHistory, spec.history, dataDir);
          reportForeignIds(problems, `${branchName} messages`, messagesFile, actualMessages.map((message) => message.id), foreignMessageIds, dataDir);
          reportForeignIds(problems, `${branchName} history`, historyFile, actualHistory.map((message) => message.id), foreignMessageIds, dataDir);
        }

        return problems;
      },
    },
    {
      key: 'tasks_workflows',
      success: 'Tasks and workflows remain isolated between main and feature_task4c branches.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const foreignTaskIds = new Set(fixture.branches[otherBranch].tasks.map((task) => task.id));
          const foreignWorkflowIds = new Set(fixture.branches[otherBranch].workflows.map((workflow) => workflow.id));
          const tasksFile = branchPaths.getTasksFile(branchName);
          const workflowsFile = branchPaths.getWorkflowsFile(branchName);
          const actualTasks = readJson(tasksFile, []);
          const actualWorkflows = readJson(workflowsFile, []);

          expectEqual(problems, `${branchName} tasks`, tasksFile, actualTasks, spec.tasks, dataDir);
          expectEqual(problems, `${branchName} workflows`, workflowsFile, actualWorkflows, spec.workflows, dataDir);
          reportForeignIds(problems, `${branchName} tasks`, tasksFile, Array.isArray(actualTasks) ? actualTasks.map((task) => task.id) : [], foreignTaskIds, dataDir);
          reportForeignIds(problems, `${branchName} workflows`, workflowsFile, Array.isArray(actualWorkflows) ? actualWorkflows.map((workflow) => workflow.id) : [], foreignWorkflowIds, dataDir);
        }

        return problems;
      },
    },
    {
      key: 'workspaces',
      success: 'Workspaces remain isolated between main and feature_task4c branches.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const actualWorkspaces = readWorkspaces(branchName);
          const workspacesDir = branchPaths.getWorkspacesDir(branchName);

          expectEqual(problems, `${branchName} workspaces`, workspacesDir, actualWorkspaces, spec.workspaces, dataDir);
          if (deepEqual(actualWorkspaces, fixture.branches[otherBranch].workspaces)) {
            problems.push(`${branchName} workspaces in ${displayScopedPath(dataDir, workspacesDir)} matched ${otherBranch} workspace state exactly.`);
          }
        }

        return problems;
      },
    },
    {
      key: 'delivery_read_state',
      success: 'Delivery/read projections remain branch-local for consumed ids, acknowledgements, read receipts, and compressed history.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const foreignMessageIds = new Set(fixture.branches[otherBranch].messages.map((message) => message.id));
          const acksFile = branchPaths.getAcksFile(branchName);
          const readReceiptsFile = branchPaths.getReadReceiptsFile(branchName);
          const consumedFile = branchPaths.getConsumedFile(fixture.trackedAgent, branchName);
          const compressedFile = branchPaths.getCompressedFile(branchName);
          const actualAcks = readJson(acksFile, {});
          const actualReadReceipts = readJson(readReceiptsFile, {});
          const actualConsumed = readJson(consumedFile, []);
          const actualCompressed = readJson(compressedFile, {});

          expectEqual(problems, `${branchName} acks`, acksFile, actualAcks, spec.acks, dataDir);
          expectEqual(problems, `${branchName} read receipts`, readReceiptsFile, actualReadReceipts, spec.readReceipts, dataDir);
          expectEqual(problems, `${branchName} consumed ids`, consumedFile, actualConsumed, spec.consumedByAgent[fixture.trackedAgent] || [], dataDir);
          expectEqual(problems, `${branchName} compressed history`, compressedFile, actualCompressed, spec.compressed, dataDir);

          reportForeignIds(problems, `${branchName} acks`, acksFile, Object.keys(actualAcks), foreignMessageIds, dataDir);
          reportForeignIds(problems, `${branchName} read receipts`, readReceiptsFile, Object.keys(actualReadReceipts), foreignMessageIds, dataDir);
          reportForeignIds(problems, `${branchName} consumed ids`, consumedFile, Array.isArray(actualConsumed) ? actualConsumed : [], foreignMessageIds, dataDir);
          reportForeignIds(problems, `${branchName} compressed history`, compressedFile, collectCompressedMessageIds(actualCompressed), foreignMessageIds, dataDir);
        }

        return problems;
      },
    },
    {
      key: 'conversation_control',
      success: 'Conversation mode, managed floor, and phase state remain branch-local.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const configFile = branchPaths.getConfigFile(branchName);
          const actualConfig = readJson(configFile, {});

          expectEqual(problems, `${branchName} config`, configFile, actualConfig, spec.config, dataDir);
          if (deepEqual(actualConfig, fixture.branches[otherBranch].config)) {
            problems.push(`${branchName} config in ${displayScopedPath(dataDir, configFile)} matched ${otherBranch} control state exactly.`);
          }
        }

        return problems;
      },
    },
    {
      key: 'non_general_channels',
      success: 'Non-general channel metadata plus channel message/history files remain branch-local.',
      run() {
        const problems = [];

        for (const branchName of branchNames) {
          const spec = fixture.branches[branchName];
          const otherBranch = branchName === 'main' ? fixture.featureBranch : 'main';
          const foreignChannelIds = new Set(fixture.branches[otherBranch].channelHistory.map((message) => message.id));
          const channelsFile = branchPaths.getChannelsFile(branchName);
          const channelMessagesFile = branchPaths.getChannelMessagesFile(fixture.channelName, branchName);
          const channelHistoryFile = branchPaths.getChannelHistoryFile(fixture.channelName, branchName);
          const actualChannels = readJson(channelsFile, {});
          const actualChannelMessages = readJsonl(channelMessagesFile);
          const actualChannelHistory = readJsonl(channelHistoryFile);

          expectEqual(problems, `${branchName} channels metadata`, channelsFile, actualChannels, spec.channels, dataDir);
          expectEqual(problems, `${branchName} channel messages`, channelMessagesFile, actualChannelMessages, spec.channelMessages, dataDir);
          expectEqual(problems, `${branchName} channel history`, channelHistoryFile, actualChannelHistory, spec.channelHistory, dataDir);

          if (deepEqual(actualChannels, fixture.branches[otherBranch].channels)) {
            problems.push(`${branchName} channel metadata in ${displayScopedPath(dataDir, channelsFile)} matched ${otherBranch} channel state exactly.`);
          }

          reportForeignIds(problems, `${branchName} channel messages`, channelMessagesFile, actualChannelMessages.map((message) => message.id), foreignChannelIds, dataDir);
          reportForeignIds(problems, `${branchName} channel history`, channelHistoryFile, actualChannelHistory.map((message) => message.id), foreignChannelIds, dataDir);
        }

        return problems;
      },
    },
  ];
}

function runValidation(simulateCrossBranchLeak) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-task4c-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const fixture = createFixture();
  let result = null;

  try {
    const branchPaths = writeScenarioFixtures(dataDir, fixture);
    if (simulateCrossBranchLeak) {
      applySimulatedCrossBranchLeak(dataDir, branchPaths, fixture, simulateCrossBranchLeak);
    }

    const checks = getBranchIsolationChecks(dataDir, branchPaths, fixture);
    const failures = [];
    const successes = [];

    for (const check of checks) {
      const problems = check.run();
      if (problems.length > 0) {
        failures.push({ key: check.key, problems });
        continue;
      }
      successes.push({ key: check.key, message: check.success });
    }

    result = { failures, successes };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return result;
}

function main() {
  const { simulateCrossBranchLeak } = parseArgs(process.argv.slice(2));
  const result = runValidation(simulateCrossBranchLeak);

  if (result.failures.length > 0) {
    const lines = [
      'Branch isolation validation failed.',
      `Simulated cross-branch leak: ${simulateCrossBranchLeak || 'none'}`,
      'Violations:',
    ];

    for (const failure of result.failures) {
      lines.push(`- ${failure.key}`);
      for (const problem of failure.problems) {
        lines.push(`  - ${problem}`);
      }
    }

    fail(lines, 1);
  }

  const lines = [
    'Branch isolation validation passed.',
    `Simulated cross-branch leak: ${simulateCrossBranchLeak || 'none'}`,
    `Validated ${result.successes.length} branch-isolation checks for Task 4 P0 domains.`,
  ];

  for (const success of result.successes) {
    lines.push(`- ${success.key}: ${success.message}`);
  }

  console.log(lines.join('\n'));
}

main();
