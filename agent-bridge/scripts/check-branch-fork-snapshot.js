#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const { createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const SERVER_FILE = path.resolve(PACKAGE_ROOT, 'server.js');

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
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

async function callTool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = Array.isArray(result.content)
    ? result.content.map((entry) => (entry && entry.type === 'text' ? entry.text : '')).join('')
    : '';

  if (result.isError) {
    throw new Error(`${name} failed: ${text || 'unknown error'}`);
  }

  return text ? JSON.parse(text) : {};
}

function createFixture() {
  const evidenceRef = {
    evidence_id: 'evidence-task4f-main',
    branch_id: 'main',
    recorded_at: '2026-04-16T00:00:05.000Z',
    recorded_by_session: 'session-alpha-main',
  };

  return {
    message: {
      id: 'msg-task4f-main-1',
      from: 'alpha',
      to: 'beta',
      content: 'Main branch snapshot seed',
      timestamp: '2026-04-16T00:00:10.000Z',
      reply_to: null,
      system: false,
    },
    task: {
      id: 'task-task4f-main',
      title: 'Main branch fork snapshot task',
      description: 'Task fixture that must copy into the forked branch snapshot.',
      status: 'done',
      assignee: 'alpha',
      created_by: 'alpha',
      created_at: '2026-04-16T00:00:00.000Z',
      updated_at: '2026-04-16T00:00:05.000Z',
      evidence_ref: evidenceRef,
      notes: [],
    },
    workflow: {
      id: 'wf-task4f-main',
      name: 'Main branch fork snapshot workflow',
      branch_id: 'main',
      status: 'active',
      autonomous: false,
      parallel: false,
      created_by: 'alpha',
      created_at: '2026-04-16T00:00:00.000Z',
      updated_at: '2026-04-16T00:00:05.000Z',
      steps: [
        {
          id: 1,
          description: 'Seeded workflow step',
          assignee: 'alpha',
          depends_on: [],
          status: 'done',
          started_at: '2026-04-16T00:00:00.000Z',
          completed_at: '2026-04-16T00:00:05.000Z',
          notes: '',
          evidence_ref: evidenceRef,
        },
      ],
    },
    evidenceStore: {
      schema_version: 1,
      updated_at: '2026-04-16T00:00:05.000Z',
      records: [
        {
          evidence_id: 'evidence-task4f-main',
          subject_kind: 'completion',
          branch_id: 'main',
          task_id: 'task-task4f-main',
          workflow_id: 'wf-task4f-main',
          step_id: 1,
          notes: 'Seeded branch-local evidence',
          summary: 'Validated seeded fork snapshot state.',
          verification: 'Manual temp-runtime inspection',
          files_changed: ['agent-bridge/server.js'],
          confidence: 95,
          learnings: 'Fork snapshots should preserve task/workflow evidence context.',
          flagged: false,
          flag_reason: null,
          recorded_at: '2026-04-16T00:00:05.000Z',
          recorded_by: 'alpha',
          recorded_by_session: 'session-alpha-main',
          source_tool: 'check-branch-fork-snapshot',
        },
      ],
    },
    workspaces: {
      alpha: {
        draft: { content: 'Main branch workspace note' },
        retry_history: [],
      },
    },
  };
}

async function runValidation() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-fork-snapshot-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchPaths = createBranchPathResolvers(dataDir);
  const fixture = createFixture();
  const problems = [];
  let transport = null;

  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(branchPaths.getMessagesFile('main'), toJsonl([fixture.message]));
    fs.writeFileSync(branchPaths.getHistoryFile('main'), toJsonl([fixture.message]));
    fs.writeFileSync(branchPaths.getTasksFile('main'), JSON.stringify([fixture.task], null, 2));
    fs.writeFileSync(branchPaths.getWorkflowsFile('main'), JSON.stringify([fixture.workflow], null, 2));
    fs.writeFileSync(branchPaths.getEvidenceFile('main'), JSON.stringify(fixture.evidenceStore, null, 2));
    fs.mkdirSync(branchPaths.getWorkspacesDir('main'), { recursive: true });
    for (const [agentName, workspace] of Object.entries(fixture.workspaces)) {
      fs.writeFileSync(branchPaths.getWorkspaceFile(agentName, 'main'), JSON.stringify(workspace, null, 2));
    }

    const client = new Client({ name: 'branch-fork-validator', version: '1.0.0' });
    transport = new StdioClientTransport({
      command: process.execPath,
      args: [SERVER_FILE],
      cwd: PACKAGE_ROOT,
      env: {
        AGENT_BRIDGE_DATA_DIR: dataDir,
      },
      stderr: 'pipe',
    });

    await client.connect(transport);
    await client.listTools();

    await callTool(client, 'register', { name: 'alpha', provider: 'Verifier' });
    const forkResult = await callTool(client, 'fork_conversation', { branch_name: 'feature_task4f' });

    if (!forkResult.success || forkResult.branch !== 'feature_task4f') {
      problems.push('fork_conversation must create and switch into the target feature_task4f branch.');
    }

    const forkMessages = readJsonl(branchPaths.getMessagesFile('feature_task4f'));
    const forkHistory = readJsonl(branchPaths.getHistoryFile('feature_task4f'));
    const forkTasks = readJson(branchPaths.getTasksFile('feature_task4f'), []);
    const forkWorkflows = readJson(branchPaths.getWorkflowsFile('feature_task4f'), []);
    const forkEvidence = readJson(branchPaths.getEvidenceFile('feature_task4f'), null);
    const forkWorkspace = readJson(branchPaths.getWorkspaceFile('alpha', 'feature_task4f'), {});

    const expectedForkTask = {
      ...fixture.task,
      evidence_ref: {
        ...fixture.task.evidence_ref,
        branch_id: 'feature_task4f',
      },
    };

    const expectedForkWorkflow = {
      ...fixture.workflow,
      branch_id: 'feature_task4f',
      steps: fixture.workflow.steps.map((step) => ({
        ...step,
        evidence_ref: {
          ...step.evidence_ref,
          branch_id: 'feature_task4f',
        },
      })),
    };

    const expectedForkEvidence = {
      ...fixture.evidenceStore,
      records: fixture.evidenceStore.records.map((record) => ({
        ...record,
        branch_id: 'feature_task4f',
      })),
    };

    if (forkMessages.length !== 0) {
      problems.push('Forked branch messages projection must start empty after the snapshot copy.');
    }

    if (!deepEqual(forkHistory, [fixture.message])) {
      problems.push('Forked branch history must preserve the visible main-branch conversation snapshot.');
    }

    if (!deepEqual(forkTasks, [expectedForkTask])) {
      problems.push('Forked branch tasks must copy the source branch task snapshot and remap embedded branch references.');
    }

    if (!deepEqual(forkWorkflows, [expectedForkWorkflow])) {
      problems.push('Forked branch workflows must copy the source branch workflow snapshot and remap branch_id fields to the fork.');
    }

    if (!deepEqual(forkEvidence, expectedForkEvidence)) {
      problems.push('Forked branch evidence store must copy historical evidence context and remap branch_id fields to the fork.');
    }

    if (!deepEqual(forkWorkspace, fixture.workspaces.alpha)) {
      problems.push('Forked branch workspaces must copy the source branch workspace snapshot.');
    }

    await callTool(client, 'create_task', {
      title: 'Fork-only branch task',
      description: 'Verifies post-fork task divergence stays branch-local.',
    });
    await callTool(client, 'create_workflow', {
      name: 'Fork-only branch workflow',
      steps: ['Fork-only step', 'Fork-only follow-up'],
      autonomous: false,
      parallel: false,
    });
    await callTool(client, 'workspace_write', {
      key: 'fork_note',
      content: 'Fork-only workspace note',
    });

    const mainTasksAfterForkWrites = readJson(branchPaths.getTasksFile('main'), []);
    const mainWorkflowsAfterForkWrites = readJson(branchPaths.getWorkflowsFile('main'), []);
    const forkTasksAfterWrites = readJson(branchPaths.getTasksFile('feature_task4f'), []);
    const forkWorkflowsAfterWrites = readJson(branchPaths.getWorkflowsFile('feature_task4f'), []);
    const mainWorkspaceAfterForkWrites = readJson(branchPaths.getWorkspaceFile('alpha', 'main'), {});
    const forkWorkspaceAfterWrites = readJson(branchPaths.getWorkspaceFile('alpha', 'feature_task4f'), {});

    if (!deepEqual(mainTasksAfterForkWrites, [fixture.task])) {
      problems.push('Fork-local task writes must not mutate the source branch task snapshot.');
    }

    if (!deepEqual(mainWorkflowsAfterForkWrites, [fixture.workflow])) {
      problems.push('Fork-local workflow writes must not mutate the source branch workflow snapshot.');
    }

    if (!(Array.isArray(forkTasksAfterWrites) && forkTasksAfterWrites.length === 2)) {
      problems.push('Fork-local task writes must append only inside the forked branch task projection.');
    }

    if (!(Array.isArray(forkWorkflowsAfterWrites) && forkWorkflowsAfterWrites.length === 2)) {
      problems.push('Fork-local workflow writes must append only inside the forked branch workflow projection.');
    }

    if (!deepEqual(mainWorkspaceAfterForkWrites, fixture.workspaces.alpha)) {
      problems.push('Fork-local workspace writes must not mutate the source branch workspace snapshot.');
    }

    if (!(forkWorkspaceAfterWrites && forkWorkspaceAfterWrites.fork_note && forkWorkspaceAfterWrites.fork_note.content === 'Fork-only workspace note')) {
      problems.push('Fork-local workspace writes must persist only inside the forked branch workspace projection.');
    }
  } finally {
    if (transport) {
      try {
        await transport.close();
      } catch {}
    }
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return problems;
}

async function main() {
  const problems = await runValidation();

  if (problems.length > 0) {
    fail([
      'Branch fork snapshot validation failed.',
      'Violations:',
      ...problems.map((problem) => `- ${problem}`),
    ], 1);
  }

  console.log([
    'Branch fork snapshot validation passed.',
    'Validated fork-time history/message reset plus branch-local task/workflow/evidence/workspace snapshot copying and post-fork divergence.',
  ].join('\n'));
}

main().catch((error) => {
  fail([
    'Branch fork snapshot validation failed.',
    `Unhandled error: ${error && error.message ? error.message : String(error)}`,
  ], 1);
});
