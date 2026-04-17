#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { createCanonicalState, createBranchPathResolvers } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));
const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createStateIo } = require(path.resolve(__dirname, '..', 'state', 'io.js'));
const { createSessionsState } = require(path.resolve(__dirname, '..', 'state', 'sessions.js'));

const EXPORT_SCRIPT = path.resolve(__dirname, 'export-markdown-workspace.js');

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

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return null;
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const raw = line.slice(index + 1).trim();
    if (raw === 'null') {
      result[key] = null;
    } else if (raw === 'true') {
      result[key] = true;
    } else if (raw === 'false') {
      result[key] = false;
    } else if (/^-?\d+(\.\d+)?$/.test(raw)) {
      result[key] = Number(raw);
    } else if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      try {
        result[key] = JSON.parse(raw);
      } catch {
        result[key] = raw.slice(1, -1);
      }
    } else {
      result[key] = raw;
    }
  }
  return result;
}

function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-markdown-export-'));
  const projectRoot = tempRoot;
  const dataDir = path.join(projectRoot, '.agent-bridge');
  const outputRoot = path.join(projectRoot, '.agent-bridge-markdown');
  const branchPaths = createBranchPathResolvers(dataDir);
  const io = createStateIo({ dataDir });
  const eventLog = createCanonicalEventLog({ dataDir });
  const sessionsState = createSessionsState({ io, branchPaths, canonicalEventLog: eventLog });
  const canonicalState = createCanonicalState({ dataDir, processPid: process.pid });
  const problems = [];

  try {
    const now = '2026-04-16T12:00:00.000Z';
    const mainSessionTime = '2026-04-16T12:01:00.000Z';
    const featureSessionTime = '2026-04-16T12:02:00.000Z';

    writeJson(path.join(dataDir, 'branches.json'), {
      main: {
        created_at: now,
        created_by: 'alpha',
        message_count: 2,
      },
      feature_docs: {
        created_at: '2026-04-16T12:00:30.000Z',
        created_by: 'beta',
        forked_from: 'main',
        fork_point: 'msg_main_1',
        message_count: 1,
      },
    });

    writeJson(path.join(dataDir, 'agents.json'), {
      alpha: { pid: process.pid, provider: 'claude', timestamp: now, last_activity: now },
      beta: { pid: process.pid, provider: 'codex', timestamp: now, last_activity: now },
    });

    writeJson(path.join(dataDir, 'profiles.json'), {
      alpha: { display_name: 'Alpha' },
      beta: { display_name: 'Beta' },
    });

    canonicalState.appendMessage({
      id: 'msg_main_1',
      from: 'alpha',
      to: 'beta',
      content: 'Main branch hello',
      timestamp: '2026-04-16T12:03:00.000Z',
    }, { branch: 'main', actorAgent: 'alpha', sessionId: 'session_alpha_main' });

    canonicalState.appendMessage({
      id: 'msg_feature_1',
      from: 'beta',
      to: 'alpha',
      content: 'Feature branch hello',
      timestamp: '2026-04-16T12:04:00.000Z',
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
      timestamp: '2026-04-16T12:03:30.000Z',
    }]);

    writeJsonl(branchPaths.getChannelHistoryFile('dev', 'feature_docs'), [{
      id: 'msg_feature_dev_1',
      from: 'beta',
      to: 'alpha',
      channel: 'dev',
      content: 'Feature dev note',
      timestamp: '2026-04-16T12:04:30.000Z',
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
      at: mainSessionTime,
    });
    sessionsState.transitionSession({
      sessionId: mainSession.session.session_id,
      branchName: 'main',
      state: 'completed',
      reason: 'graceful_exit',
      at: '2026-04-16T12:01:30.000Z',
    });
    const featureSession = sessionsState.activateSession({
      agentName: 'beta',
      branchName: 'feature_docs',
      provider: 'codex',
      reason: 'register',
      at: featureSessionTime,
    });

    writeJson(branchPaths.getEvidenceFile('main'), {
      schema_version: 1,
      updated_at: '2026-04-16T12:05:00.000Z',
      records: [{
        evidence_id: 'evidence_main_1',
        branch_id: 'main',
        subject_kind: 'task',
        task_id: 'task_main',
        task_title: 'Main task',
        summary: 'Validated the main branch fixture',
        verification: 'Ran the markdown export validator fixture.',
        files_changed: ['agent-bridge/state/canonical.js'],
        confidence: 92,
        learnings: 'Keep export one-way.',
        recorded_at: '2026-04-16T12:05:00.000Z',
        recorded_by: 'alpha',
        recorded_by_session: mainSession.session.session_id,
        source_tool: 'fixture',
      }],
    });

    writeJson(branchPaths.getEvidenceFile('feature_docs'), {
      schema_version: 1,
      updated_at: '2026-04-16T12:05:30.000Z',
      records: [{
        evidence_id: 'evidence_feature_1',
        branch_id: 'feature_docs',
        subject_kind: 'workflow',
        workflow_id: 'wf_feature',
        summary: 'Validated the feature branch fixture',
        verification: 'Confirmed the branch-local export stays isolated.',
        files_changed: ['agent-bridge/scripts/export-markdown-workspace.js'],
        confidence: 88,
        learnings: 'Do not fabricate shared pages on non-main branches.',
        recorded_at: '2026-04-16T12:05:30.000Z',
        recorded_by: 'beta',
        recorded_by_session: featureSession.session.session_id,
        source_tool: 'fixture',
      }],
    });

    writeJson(branchPaths.getDecisionsFile('main'), [{
      id: 'dec_markdown_1',
      decision: 'Keep markdown export projection-only.',
      reasoning: 'Markdown is a generated workspace, not a runtime input.',
      topic: 'markdown',
      decided_by: 'alpha',
      decided_at: '2026-04-16T12:06:00.000Z',
    }]);
    writeJson(branchPaths.getDecisionsFile('feature_docs'), [{
      id: 'dec_feature_1',
      decision: 'Keep feature export isolated.',
      reasoning: 'Feature branches should not inherit shared governance summaries.',
      topic: 'branching',
      decided_by: 'beta',
      decided_at: '2026-04-16T12:06:10.000Z',
    }]);

    writeJson(branchPaths.getKnowledgeBaseFile('main'), {
      markdown_contract: {
        content: 'Use canonical read surfaces for export assembly.',
        updated_by: 'alpha',
        updated_at: '2026-04-16T12:06:30.000Z',
      },
    });
    writeJson(branchPaths.getKnowledgeBaseFile('feature_docs'), {
      feature_export: {
        content: 'Feature branch exports should summarize only feature-branch governance state.',
        updated_by: 'beta',
        updated_at: '2026-04-16T12:06:35.000Z',
      },
    });

    writeJson(branchPaths.getRulesFile('main'), [{
      id: 'rule_markdown_one_way',
      text: 'Do not import markdown back into runtime state.',
      category: 'safety',
      active: true,
      created_by: 'alpha',
      created_at: '2026-04-16T12:06:45.000Z',
    }]);
    writeJson(branchPaths.getRulesFile('feature_docs'), [{
      id: 'rule_feature_isolation',
      text: 'Keep feature governance surfaces branch-local.',
      category: 'workflow',
      active: true,
      created_by: 'beta',
      created_at: '2026-04-16T12:06:50.000Z',
    }]);

    writeJson(branchPaths.getProgressFile('main'), {
      markdown_workspace: {
        percent: 60,
        notes: 'One-way export slice in progress.',
      },
    });
    writeJson(branchPaths.getProgressFile('feature_docs'), {
      feature_export: {
        percent: 85,
        notes: 'Feature branch export summary nearly complete.',
      },
    });

    writeJson(branchPaths.getReviewsFile('main'), [{
      id: 'review_1',
      file_path: 'agent-bridge/state/markdown-workspace.js',
      status: 'approved',
    }]);
    writeJson(branchPaths.getReviewsFile('feature_docs'), [{
      id: 'review_feature_1',
      file_path: 'agent-bridge/scripts/export-markdown-workspace.js',
      status: 'changes_requested',
    }]);

    writeJson(branchPaths.getDependenciesFile('main'), [{
      task_id: 'task_markdown_export',
      depends_on: 'task_markdown_contract',
    }]);
    writeJson(branchPaths.getDependenciesFile('feature_docs'), [{
      task_id: 'task_feature_export',
      depends_on: 'task_feature_contract',
    }]);

    writeJson(branchPaths.getVotesFile('main'), [{
      id: 'vote_1',
      question: 'Ship the markdown export slice?',
      status: 'resolved',
      result: 'yes',
    }]);
    writeJson(branchPaths.getVotesFile('feature_docs'), [{
      id: 'vote_feature_1',
      question: 'Ship the feature export slice?',
      status: 'open',
      result: null,
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

    writeJson(path.join(dataDir, 'workflows.json'), [
      {
        id: 'wf_active',
        name: 'Active markdown export',
        status: 'active',
        autonomous: true,
        parallel: false,
        paused: false,
        created_at: '2026-04-16T12:07:00.000Z',
        steps: [{
          id: 1,
          description: 'Write the exporter',
          assignee: 'alpha',
          status: 'in_progress',
          depends_on: [],
          started_at: '2026-04-16T12:07:10.000Z',
          completed_at: null,
          flagged: false,
          verification: null,
        }],
      },
      {
        id: 'wf_report',
        name: 'Completed markdown export',
        status: 'completed',
        autonomous: true,
        parallel: true,
        paused: false,
        created_at: '2026-04-16T12:08:00.000Z',
        completed_at: '2026-04-16T12:09:00.000Z',
        steps: [{
          id: 1,
          description: 'Validate output',
          assignee: 'beta',
          status: 'done',
          depends_on: [],
          started_at: '2026-04-16T12:08:10.000Z',
          completed_at: '2026-04-16T12:08:50.000Z',
          flagged: false,
          verification: { confidence: 90 },
        }],
      },
    ]);

    writeJson(branchPaths.getWorkflowsFile('feature_docs'), [
      {
        id: 'wf_feature_active',
        name: 'Feature branch export follow-up',
        status: 'active',
        autonomous: false,
        parallel: false,
        paused: false,
        created_at: '2026-04-16T12:10:00.000Z',
        steps: [{
          id: 1,
          description: 'Document branch-local plans',
          assignee: 'beta',
          status: 'in_progress',
          depends_on: [],
          started_at: '2026-04-16T12:10:10.000Z',
          completed_at: null,
          flagged: false,
          verification: null,
        }],
      },
    ]);

    const exportRun = spawnSync(process.execPath, [
      EXPORT_SCRIPT,
      '--data-dir',
      dataDir,
      '--output',
      outputRoot,
    ], {
      cwd: projectRoot,
      encoding: 'utf8',
    });

    assert(exportRun.status === 0, `Export script should exit 0. stderr: ${exportRun.stderr || '<empty>'}`, problems);

    let summary = null;
    try {
      summary = JSON.parse(exportRun.stdout || '{}');
    } catch {
      problems.push('Export script should print JSON summary output.');
    }

    const expectedFiles = [
      'README.md',
      'branches/index.md',
      'branches/main/metadata.md',
      'branches/main/conversations/index.md',
      'branches/main/conversations/channels/general.md',
      'branches/main/conversations/channels/ops.md',
      'branches/main/decisions/index.md',
      'branches/main/sessions/index.md',
      `branches/main/sessions/${mainSession.session.session_id}.md`,
      'branches/main/evidence/index.md',
      'branches/main/workspaces/index.md',
      'branches/main/workspaces/agents/alpha.md',
      'branches/main/plans/status.md',
      'branches/main/plans/report.md',
      'branches/feature_docs/metadata.md',
      'branches/feature_docs/conversations/index.md',
      'branches/feature_docs/conversations/channels/general.md',
      'branches/feature_docs/conversations/channels/dev.md',
      'branches/feature_docs/decisions/index.md',
      'branches/feature_docs/sessions/index.md',
      `branches/feature_docs/sessions/${featureSession.session.session_id}.md`,
      'branches/feature_docs/workspaces/index.md',
      'branches/feature_docs/workspaces/agents/alpha.md',
      'branches/feature_docs/workspaces/agents/beta.md',
      'branches/feature_docs/plans/status.md',
      'branches/feature_docs/plans/report.md',
      'branches/feature_docs/evidence/index.md',
      'project/notes/project-notes.md',
      'project/notes/team-notes.md',
    ];

    for (const relativePath of expectedFiles) {
      assert(fs.existsSync(path.join(outputRoot, relativePath)), `Expected exported file missing: ${relativePath}`, problems);
    }

    const readmeFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'README.md')));
    const mainConversationFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'main', 'conversations', 'index.md')));
    const featureMetadataFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')));
    const decisionsFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'main', 'decisions', 'index.md')));
    const featureDecisionsFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'decisions', 'index.md')));
    const workspaceFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'main', 'workspaces', 'agents', 'alpha.md')));
    const featureWorkspaceFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'workspaces', 'agents', 'beta.md')));
    const mainPlanStatusFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'main', 'plans', 'status.md')));
    const mainPlanReportFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'main', 'plans', 'report.md')));
    const featurePlanStatusFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'status.md')));
    const featurePlanReportFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'report.md')));
    const projectNoteFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'project', 'notes', 'project-notes.md')));
    const teamNoteFrontmatter = parseFrontmatter(readFile(path.join(outputRoot, 'project', 'notes', 'team-notes.md')));

    assert(readmeFrontmatter && readmeFrontmatter.authoritative === false, 'README frontmatter must mark the markdown workspace non-authoritative.', problems);
    assert(readmeFrontmatter && readmeFrontmatter.generated_by === 'let-them-talk-markdown-export', 'README frontmatter must carry the generator name.', problems);
    assert(mainConversationFrontmatter && mainConversationFrontmatter.source_scope === 'branch_local', 'Conversation index frontmatter must mark branch-local source scope.', problems);
    assert(mainConversationFrontmatter && Number.isInteger(mainConversationFrontmatter.source_sequence) && mainConversationFrontmatter.source_sequence > 0, 'Conversation index frontmatter should record the latest branch event sequence.', problems);
    assert(featureMetadataFrontmatter && featureMetadataFrontmatter.branch_parent === 'main', 'Feature branch metadata frontmatter must carry branch_parent.', problems);
    assert(featureMetadataFrontmatter && featureMetadataFrontmatter.branch_source === 'msg_main_1', 'Feature branch metadata frontmatter must carry branch_source.', problems);
    assert(decisionsFrontmatter && decisionsFrontmatter.source_scope === 'branch_local', 'Decision export frontmatter must mark branch-local scope.', problems);
    assert(decisionsFrontmatter && decisionsFrontmatter.decision_count === 1, 'Decision export frontmatter must report the decision count.', problems);
    assert(featureDecisionsFrontmatter && featureDecisionsFrontmatter.source_scope === 'branch_local', 'Feature decision export frontmatter must mark branch-local scope.', problems);
    assert(featureDecisionsFrontmatter && featureDecisionsFrontmatter.decision_count === 1, 'Feature decision export frontmatter must report the feature decision count.', problems);
    assert(workspaceFrontmatter && workspaceFrontmatter.source_scope === 'branch_local', 'Workspace export frontmatter must mark branch-local scope.', problems);
    assert(workspaceFrontmatter && workspaceFrontmatter.source_surface === 'createCanonicalState().listWorkspaces({ branch })', 'Workspace export frontmatter must name the branch-local workspace read surface.', problems);
    assert(workspaceFrontmatter && workspaceFrontmatter.key_count === 2, 'Workspace agent frontmatter must report the top-level key count.', problems);
    assert(featureWorkspaceFrontmatter && featureWorkspaceFrontmatter.source_scope === 'branch_local', 'Feature workspace export frontmatter must mark branch-local scope.', problems);
    assert(featureWorkspaceFrontmatter && featureWorkspaceFrontmatter.key_count === 1, 'Feature workspace export frontmatter must report the feature branch key count.', problems);
    assert(mainPlanStatusFrontmatter && mainPlanStatusFrontmatter.source_scope === 'branch_local', 'Main plan status frontmatter must mark branch-local scope.', problems);
    assert(mainPlanStatusFrontmatter && mainPlanStatusFrontmatter.source_surface === 'createCanonicalState().getPlanStatusView({ branch })', 'Main plan status frontmatter must name the branch-local source surface.', problems);
    assert(mainPlanStatusFrontmatter && mainPlanStatusFrontmatter.workflow_id === 'wf_active', 'Main plan status frontmatter should record the active branch workflow id when one workflow is present.', problems);
    assert(mainPlanStatusFrontmatter && mainPlanStatusFrontmatter.workflow_status === 'active', 'Main plan status frontmatter should record the active branch workflow status when one workflow is present.', problems);
    assert(mainPlanReportFrontmatter && mainPlanReportFrontmatter.source_scope === 'branch_local', 'Main plan report frontmatter must mark branch-local scope.', problems);
    assert(mainPlanReportFrontmatter && mainPlanReportFrontmatter.workflow_id === null, 'Main plan report frontmatter should leave workflow_id null when the branch report aggregates multiple workflows.', problems);
    assert(featurePlanStatusFrontmatter && featurePlanStatusFrontmatter.source_scope === 'branch_local', 'Feature plan status frontmatter must mark branch-local scope.', problems);
    assert(featurePlanStatusFrontmatter && featurePlanStatusFrontmatter.workflow_id === 'wf_feature_active', 'Feature plan status frontmatter should record the feature branch workflow id.', problems);
    assert(featurePlanReportFrontmatter && featurePlanReportFrontmatter.workflow_id === 'wf_feature_active', 'Feature plan report frontmatter should record the feature branch workflow id when one workflow is present.', problems);
    assert(projectNoteFrontmatter && projectNoteFrontmatter.note_scope === 'branch_local_summary', 'Project note frontmatter must label branch-local summary scope truthfully.', problems);
    assert(projectNoteFrontmatter && projectNoteFrontmatter.source_scope === 'runtime_global', 'Project note frontmatter must describe the cross-branch summary source scope truthfully.', problems);
    assert(teamNoteFrontmatter && teamNoteFrontmatter.note_scope === 'branch_local_summary', 'Team note frontmatter must label branch-local summary scope truthfully.', problems);
    assert(teamNoteFrontmatter && teamNoteFrontmatter.source_scope === 'runtime_global', 'Team note frontmatter must describe the cross-branch summary source scope truthfully.', problems);

    assert(readFile(path.join(outputRoot, 'branches', 'main', 'conversations', 'channels', 'general.md')).includes('Main branch hello'), 'Main general transcript should include readable general-channel content.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'main', 'conversations', 'channels', 'ops.md')).includes('Ops-only update'), 'Main ops transcript should include readable non-general channel content.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'conversations', 'channels', 'dev.md')).includes('Feature dev note'), 'Feature branch transcript should include readable feature channel content.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')).includes('- `plans/`'), 'Feature branch metadata should list plans as an exported branch-local page.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')).includes('plans/ omitted'), 'Feature branch metadata must not describe plans as omitted.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')).includes('- `workspaces/`'), 'Feature branch metadata should list workspaces as an exported branch-local page.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')).includes('workspaces/ omitted'), 'Feature branch metadata must not describe workspaces as omitted.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'metadata.md')).includes('- `decisions/`'), 'Feature branch metadata should list decisions as an exported branch-local page.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'main', 'decisions', 'index.md')).includes('Keep markdown export projection-only.'), 'Main decision export should include the main branch decision.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'decisions', 'index.md')).includes('Keep feature export isolated.'), 'Feature decision export should include the feature branch decision.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'decisions', 'index.md')).includes('Keep markdown export projection-only.'), 'Feature decision export must stay isolated from main-branch decisions.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'main', 'plans', 'status.md')).includes('Active markdown export'), 'Main plan status should summarize the branch-local active workflow.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'main', 'plans', 'report.md')).includes('Completed markdown export'), 'Main plan report should summarize completed workflows for the branch.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'status.md')).includes('Feature branch export follow-up'), 'Feature plan status should summarize the feature branch workflow.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'report.md')).includes('Feature branch export follow-up'), 'Feature plan report should summarize the feature branch workflow.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'status.md')).includes('Active markdown export'), 'Feature plan status must stay isolated from main-branch workflows.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'plans', 'report.md')).includes('Completed markdown export'), 'Feature plan report must stay isolated from main-branch workflows.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'workspaces', 'agents', 'beta.md')).includes('Feature branch workspace note'), 'Feature workspace export should include readable branch-local workspace content.', problems);
    assert(!readFile(path.join(outputRoot, 'branches', 'feature_docs', 'workspaces', 'agents', 'beta.md')).includes('Main branch workspace note'), 'Feature workspace export must exclude main-branch workspace content.', problems);
    assert(readFile(path.join(outputRoot, 'branches', 'feature_docs', 'evidence', 'index.md')).includes('Validated the feature branch fixture'), 'Evidence index should include readable evidence summaries.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'project-notes.md')).includes('## Branch: main'), 'Project note should include the main branch summary.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'project-notes.md')).includes('## Branch: feature_docs'), 'Project note should include the feature branch summary.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'project-notes.md')).includes('Do not import markdown back into runtime state.'), 'Project note should summarize main-branch rules truthfully.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'project-notes.md')).includes('Keep feature governance surfaces branch-local.'), 'Project note should summarize feature-branch rules truthfully.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'team-notes.md')).includes('Keep markdown export projection-only.'), 'Team note should summarize main-branch decisions truthfully.', problems);
    assert(readFile(path.join(outputRoot, 'project', 'notes', 'team-notes.md')).includes('Keep feature export isolated.'), 'Team note should summarize feature-branch decisions truthfully.', problems);

    assert(summary && summary.success === true, 'Export summary should report success.', problems);
    assert(summary && summary.branch_count === 2, 'Export summary should report the exported branch count.', problems);
    assert(summary && Array.isArray(summary.omissions) && summary.omissions.length === 0, 'Export summary should not record governance omissions after the branch-local migration.', problems);
    assert(summary && !summary.omissions.some((entry) => typeof entry.path === 'string' && entry.path.includes('/workspaces/')), 'Export summary must not treat branch-local workspace pages as omissions.', problems);
    assert(summary && !summary.omissions.some((entry) => typeof entry.path === 'string' && entry.path.includes('/plans/')), 'Export summary must not treat branch-local plan pages as omissions.', problems);

    if (problems.length > 0) {
      fail(['Markdown workspace export validation failed.', ...problems], 1);
    }

    console.log([
      'Markdown workspace export validation passed.',
      'Validated projection-only markdown export structure, branch-local governance pages, cross-branch note summaries, frontmatter truthfulness, and readable content.',
      `Output root: ${outputRoot}`,
    ].join('\n'));
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main();
