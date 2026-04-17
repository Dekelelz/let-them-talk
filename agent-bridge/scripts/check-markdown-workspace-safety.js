#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME } = require(path.resolve(__dirname, '..', 'data-dir.js'));
const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createStateIo } = require(path.resolve(__dirname, '..', 'state', 'io.js'));
const { createSessionsState } = require(path.resolve(__dirname, '..', 'state', 'sessions.js'));

const DASHBOARD_SOURCE = path.resolve(__dirname, '..', 'dashboard.js');
const CANONICAL_SOURCE = path.resolve(__dirname, '..', 'state', 'canonical.js');
const MARKDOWN_SOURCE = path.resolve(__dirname, '..', 'state', 'markdown-workspace.js');

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
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

function captureSnapshot(canonicalState, eventLog) {
  return JSON.stringify({
    branches: canonicalState.listMarkdownBranches(),
    branch_sequences: {
      main: canonicalState.getBranchEventSequence('main'),
      feature_docs: canonicalState.getBranchEventSequence('feature_docs'),
    },
    events: {
      main: eventLog.readBranchEvents('main'),
      feature_docs: eventLog.readBranchEvents('feature_docs'),
    },
    conversations: {
      main: canonicalState.getConversationMessages({ branch: 'main' }),
      feature_docs: canonicalState.getConversationMessages({ branch: 'feature_docs' }),
    },
    channels: {
      main: canonicalState.getChannelsView({ branch: 'main' }),
      feature_docs: canonicalState.getChannelsView({ branch: 'feature_docs' }),
    },
    sessions: {
      main: canonicalState.listBranchSessions('main'),
      feature_docs: canonicalState.listBranchSessions('feature_docs'),
    },
    evidence: {
      main: canonicalState.readEvidence('main'),
      feature_docs: canonicalState.readEvidence('feature_docs'),
    },
    decisions: {
      main: canonicalState.listDecisions({ branch: 'main' }),
      feature_docs: canonicalState.listDecisions({ branch: 'feature_docs' }),
    },
    workspaces: {
      main: canonicalState.listWorkspaces({ branch: 'main' }),
      feature_docs: canonicalState.listWorkspaces({ branch: 'feature_docs' }),
    },
  }, null, 2);
}

function expectExportFailure(params) {
  const {
    canonicalState,
    projectRoot,
    outputRoot,
    expectedMessage,
    label,
    problems,
  } = params;

  try {
    canonicalState.exportMarkdownWorkspace({ projectRoot, outputRoot });
    problems.push(`${label} should be rejected by the markdown safety guard.`);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    if (!message.includes(expectedMessage)) {
      problems.push(`${label} should fail with message containing "${expectedMessage}", got: ${message}`);
    }
  }
}

function main() {
  const problems = [];
  const dashboardSource = fs.readFileSync(DASHBOARD_SOURCE, 'utf8');
  const canonicalSource = fs.readFileSync(CANONICAL_SOURCE, 'utf8');
  const markdownSource = fs.readFileSync(MARKDOWN_SOURCE, 'utf8');

  assert(
    dashboardSource.includes('entry.name === DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME'),
    'Dashboard project discovery should explicitly skip the markdown workspace directory.',
    problems
  );
  assert(
    canonicalSource.includes('runtimeDataDir: dataDir'),
    'Canonical markdown export should pass the runtime data dir into the markdown safety guard.',
    problems
  );
  assert(
    markdownSource.includes('Markdown workspace output root must stay outside the canonical runtime data directory.'),
    'Markdown export should reject output roots inside the canonical runtime data directory.',
    problems
  );
  assert(
    markdownSource.includes('Markdown workspace output root must not contain the canonical runtime data directory.'),
    'Markdown export should reject output roots that would contain the canonical runtime data directory.',
    problems
  );

  const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-markdown-safety-'));
  const projectRoot = path.join(tempBase, 'project');
  const dataDir = path.join(projectRoot, '.agent-bridge');
  const outputRoot = path.join(projectRoot, DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME);
  const branchPaths = createBranchPathResolvers(dataDir);
  const io = createStateIo({ dataDir });
  const canonicalEventLog = createCanonicalEventLog({ dataDir });
  const sessionsState = createSessionsState({ io, branchPaths, canonicalEventLog });
  const canonicalState = createCanonicalState({ dataDir, processPid: process.pid });

  try {
    fs.mkdirSync(projectRoot, { recursive: true });

    writeJson(path.join(dataDir, 'branches.json'), {
      main: {
        created_at: '2026-04-16T16:00:00.000Z',
        created_by: 'alpha',
        message_count: 2,
      },
      feature_docs: {
        created_at: '2026-04-16T16:00:30.000Z',
        created_by: 'beta',
        forked_from: 'main',
        fork_point: 'msg_main_1',
        message_count: 1,
      },
    });

    canonicalState.appendMessage({
      id: 'msg_main_1',
      from: 'alpha',
      to: 'beta',
      content: 'Main branch hello',
      timestamp: '2026-04-16T16:01:00.000Z',
    }, { branch: 'main', actorAgent: 'alpha', sessionId: 'session_alpha_main' });

    canonicalState.appendMessage({
      id: 'msg_feature_1',
      from: 'beta',
      to: 'alpha',
      content: 'Feature branch hello',
      timestamp: '2026-04-16T16:02:00.000Z',
    }, { branch: 'feature_docs', actorAgent: 'beta', sessionId: 'session_beta_feature' });

    writeJson(branchPaths.getChannelsFile('main'), {
      general: { description: 'General channel', members: ['*'] },
      ops: { description: 'Ops sync', members: ['alpha'] },
    });
    writeJson(branchPaths.getChannelsFile('feature_docs'), {
      general: { description: 'General channel', members: ['*'] },
      dev: { description: 'Feature development', members: ['alpha', 'beta'] },
    });

    writeJsonl(branchPaths.getChannelHistoryFile('ops', 'main'), [{
      id: 'msg_main_ops_1',
      from: 'alpha',
      to: 'alpha',
      channel: 'ops',
      content: 'Ops-only update',
      timestamp: '2026-04-16T16:01:30.000Z',
    }]);
    writeJsonl(branchPaths.getChannelHistoryFile('dev', 'feature_docs'), [{
      id: 'msg_feature_dev_1',
      from: 'beta',
      to: 'alpha',
      channel: 'dev',
      content: 'Feature dev note',
      timestamp: '2026-04-16T16:02:30.000Z',
    }]);

    writeJson(branchPaths.getAcksFile('main'), {
      msg_main_1: true,
      msg_main_ops_1: false,
    });
    writeJson(branchPaths.getAcksFile('feature_docs'), {
      msg_feature_1: true,
      msg_feature_dev_1: false,
    });

    const mainSession = sessionsState.activateSession({
      agentName: 'alpha',
      branchName: 'main',
      provider: 'claude',
      reason: 'register',
      at: '2026-04-16T16:03:00.000Z',
    });
    sessionsState.transitionSession({
      sessionId: mainSession.session.session_id,
      branchName: 'main',
      state: 'completed',
      reason: 'graceful_exit',
      at: '2026-04-16T16:03:30.000Z',
    });
    const featureSession = sessionsState.activateSession({
      agentName: 'beta',
      branchName: 'feature_docs',
      provider: 'codex',
      reason: 'register',
      at: '2026-04-16T16:04:00.000Z',
    });

    writeJson(branchPaths.getEvidenceFile('main'), {
      schema_version: 1,
      updated_at: '2026-04-16T16:05:00.000Z',
      records: [{
        evidence_id: 'evidence_main_1',
        branch_id: 'main',
        subject_kind: 'task',
        task_id: 'task_main',
        summary: 'Validated the main branch fixture',
        verification: 'Ran the markdown safety fixture.',
        files_changed: ['agent-bridge/state/markdown-workspace.js'],
        confidence: 93,
        learnings: 'Markdown stays projection-only.',
        recorded_at: '2026-04-16T16:05:00.000Z',
        recorded_by: 'alpha',
        recorded_by_session: mainSession.session.session_id,
        source_tool: 'fixture',
      }],
    });
    writeJson(branchPaths.getEvidenceFile('feature_docs'), {
      schema_version: 1,
      updated_at: '2026-04-16T16:05:30.000Z',
      records: [{
        evidence_id: 'evidence_feature_1',
        branch_id: 'feature_docs',
        subject_kind: 'workflow',
        workflow_id: 'wf_feature',
        summary: 'Validated the feature branch fixture',
        verification: 'Confirmed markdown edits stay non-authoritative.',
        files_changed: ['agent-bridge/scripts/check-markdown-workspace-safety.js'],
        confidence: 89,
        learnings: 'Keep markdown outside runtime storage.',
        recorded_at: '2026-04-16T16:05:30.000Z',
        recorded_by: 'beta',
        recorded_by_session: featureSession.session.session_id,
        source_tool: 'fixture',
      }],
    });

    writeJson(branchPaths.getDecisionsFile('main'), [{
      id: 'dec_markdown_1',
      decision: 'Keep markdown export projection-only.',
      topic: 'markdown',
      decided_at: '2026-04-16T16:06:00.000Z',
    }]);
    writeJson(branchPaths.getDecisionsFile('feature_docs'), [{
      id: 'dec_feature_1',
      decision: 'Keep feature export isolated.',
      topic: 'branching',
      decided_at: '2026-04-16T16:06:10.000Z',
    }]);
    writeJson(branchPaths.getWorkspaceFile('alpha', 'main'), {
      draft: { content: 'Summarize export findings.' },
      retry_history: [],
    });
    writeJson(branchPaths.getWorkspaceFile('beta', 'main'), {
      notes: 'Main branch workspace note',
    });
    writeJson(branchPaths.getWorkspaceFile('alpha', 'feature_docs'), {
      notes: 'Feature branch alpha workspace note',
    });
    writeJson(branchPaths.getWorkspaceFile('beta', 'feature_docs'), {
      notes: 'Feature branch workspace note',
    });

    const snapshotBeforeExport = captureSnapshot(canonicalState, canonicalEventLog);
    const exportResult = canonicalState.exportMarkdownWorkspace({ projectRoot, outputRoot });
    const snapshotAfterExport = captureSnapshot(canonicalState, canonicalEventLog);

    assert(exportResult && exportResult.success === true, 'Markdown workspace export should succeed in the safety fixture.', problems);
    assert(snapshotAfterExport === snapshotBeforeExport, 'Exporting the markdown workspace must not mutate canonical runtime state.', problems);

    fs.appendFileSync(path.join(outputRoot, 'README.md'), '\n\nManual edits should stay non-authoritative.\n');
    fs.writeFileSync(
      path.join(outputRoot, 'branches', 'main', 'conversations', 'channels', 'general.md'),
      '---\nauthoritative: true\nbranch: "main"\n---\nThis markdown was edited manually and must not change runtime state.\n'
    );
    fs.mkdirSync(path.join(outputRoot, 'branches', 'rogue'), { recursive: true });
    fs.writeFileSync(path.join(outputRoot, 'branches', 'rogue', 'metadata.md'), '# Rogue markdown branch\n');

    const snapshotAfterMarkdownEdits = captureSnapshot(canonicalState, canonicalEventLog);
    assert(snapshotAfterMarkdownEdits === snapshotBeforeExport, 'Editing exported markdown files must not alter canonical runtime projections or event streams.', problems);
    assert(!canonicalState.listMarkdownBranches().some((entry) => entry.branch === 'rogue'), 'Markdown-only branch folders must not appear in the canonical branch registry.', problems);

    expectExportFailure({
      canonicalState,
      projectRoot,
      outputRoot: projectRoot,
      expectedMessage: 'must not be the project root',
      label: 'Project-root markdown export',
      problems,
    });
    expectExportFailure({
      canonicalState,
      projectRoot,
      outputRoot: tempBase,
      expectedMessage: 'must not contain the project root',
      label: 'Ancestor markdown export',
      problems,
    });
    expectExportFailure({
      canonicalState,
      projectRoot,
      outputRoot: path.join(dataDir, DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME),
      expectedMessage: 'must stay outside the canonical runtime data directory',
      label: 'Data-dir markdown export',
      problems,
    });

    if (problems.length > 0) {
      fail(['Markdown workspace safety validation failed.', ...problems], 1);
    }

    console.log([
      'Markdown workspace safety validation passed.',
      'Validated explicit markdown discovery/output guards plus fixture-backed proof that markdown export and manual markdown edits do not change canonical runtime state.',
      `Output root: ${outputRoot}`,
    ].join('\n'));
  } finally {
    fs.rmSync(tempBase, { recursive: true, force: true });
  }
}

main();
