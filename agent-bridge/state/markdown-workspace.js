const fs = require('fs');
const path = require('path');

const {
  DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME,
  isWithinDir,
} = require('../data-dir');

const MARKDOWN_WORKSPACE_SCHEMA = 'markdown-workspace/v1';
const GENERATED_BY = 'let-them-talk-markdown-export';

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function yamlScalar(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(String(value));
}

function renderFrontmatter(frontmatter) {
  const lines = ['---'];
  for (const [key, value] of Object.entries(frontmatter)) {
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function renderMarkdown(frontmatter, body) {
  const normalizedBody = typeof body === 'string' ? body.trimEnd() : '';
  return `${renderFrontmatter(frontmatter)}${normalizedBody}\n`;
}

function writeMarkdownFile(outputRoot, relativePath, frontmatter, body, filesWritten) {
  const absolutePath = path.join(outputRoot, relativePath);
  ensureDir(path.dirname(absolutePath));
  fs.writeFileSync(absolutePath, renderMarkdown(frontmatter, body));
  filesWritten.push(toPosixPath(relativePath));
}

function truncate(value, maxLength = 240) {
  const stringValue = String(value == null ? '' : value);
  return stringValue.length > maxLength
    ? `${stringValue.slice(0, maxLength - 3)}...`
    : stringValue;
}

function sortByTimestampDescending(entries, getTimestamp) {
  return [...entries].sort((left, right) => {
    const leftTimestamp = Date.parse(getTimestamp(left) || '') || 0;
    const rightTimestamp = Date.parse(getTimestamp(right) || '') || 0;
    return rightTimestamp - leftTimestamp;
  });
}

function buildFrontmatter(options = {}) {
  return {
    ltt_schema: MARKDOWN_WORKSPACE_SCHEMA,
    doc_kind: options.docKind,
    authoritative: false,
    branch: options.branch === undefined ? null : options.branch,
    projection_of: options.projectionOf,
    source_surface: options.sourceSurface,
    source_scope: options.sourceScope,
    source_sequence: options.sourceSequence === undefined ? null : options.sourceSequence,
    generated_at: options.generatedAt,
    generated_by: GENERATED_BY,
    ...(options.extra || {}),
  };
}

function formatTarget(target) {
  if (Array.isArray(target)) return target.join(', ');
  return target || 'broadcast';
}

function groupMessagesByChannel(messages) {
  const grouped = new Map();
  for (const message of messages) {
    const channel = message && typeof message.channel === 'string' && message.channel.trim()
      ? message.channel.trim()
      : 'general';
    if (!grouped.has(channel)) grouped.set(channel, []);
    grouped.get(channel).push(message);
  }
  return grouped;
}

function formatBulletList(items, emptyLine) {
  if (!items || items.length === 0) return `${emptyLine}\n`;
  return `${items.map((item) => `- ${item}`).join('\n')}\n`;
}

function renderWorkspaceReadme(branches, generatedAt) {
  return [
    '# Let Them Talk markdown workspace',
    '',
    'This workspace is generated from canonical and compatibility read models.',
    'It is non-authoritative and safe to rebuild.',
    '',
    `Generated at: ${generatedAt}`,
    `Known branches: ${branches.length}`,
    '',
    '## Layout',
    '',
    '- `branches/` contains branch metadata plus branch-safe exported surfaces.',
    '- `project/notes/` contains cross-branch summaries built from branch-local governance surfaces.',
    '',
    'Manual edits here do not change runtime state.',
  ].join('\n');
}

function renderBranchesIndex(branches) {
  const items = branches.map((branchInfo) => {
    const branch = branchInfo.branch;
    const branchMode = 'includes branch-local governance pages';
    const runtimeNote = branchInfo.runtime_present ? 'runtime present' : 'runtime pending';
    return `[${branch}](./${branch}/metadata.md) , ${runtimeNote} , ${branchMode}`;
  });

  return [
    '# Branch index',
    '',
    'Known branches resolved from the branch registry plus runtime branch directories.',
    '',
    formatBulletList(items, 'No branches found.').trimEnd(),
  ].join('\n');
}

function renderBranchMetadata(branchInfo) {
  return [
    `# Branch metadata: ${branchInfo.branch}`,
    '',
    `- Created at: ${branchInfo.created_at || 'unknown'}`,
    `- Created by: ${branchInfo.created_by || 'unknown'}`,
    `- Parent branch: ${branchInfo.forked_from || 'none'}`,
    `- Source marker: ${branchInfo.branch_source}`,
    `- Registry entry present: ${branchInfo.listed_in_registry ? 'yes' : 'no'}`,
    `- Runtime branch present: ${branchInfo.runtime_present ? 'yes' : 'no'}`,
    `- Message count snapshot: ${branchInfo.message_count == null ? 'unknown' : branchInfo.message_count}`,
    '',
    '## Exported pages',
    '',
    '- `conversations/`',
    '- `sessions/`',
    '- `evidence/`',
    '- `workspaces/`',
    '- `plans/`',
    '- `decisions/`',
    '',
    '## Compatibility omissions',
    '',
    'None.',
  ].join('\n');
}

function renderConversationIndex(branch, channelEntries, messageCount) {
  const items = channelEntries.map(({ name, count }) => `[${name}](./channels/${name}.md) , ${count} messages`);

  return [
    `# Conversations: ${branch}`,
    '',
    `Total messages across visible channels: ${messageCount}`,
    '',
    '## Channels',
    '',
    formatBulletList(items, 'No channels available.').trimEnd(),
  ].join('\n');
}

function renderConversationTranscript(branch, channelName, messages, channelInfo) {
  const lines = [
    `# Channel transcript: ${channelName}`,
    '',
    `- Branch: ${branch}`,
    `- Description: ${channelInfo && channelInfo.description ? channelInfo.description : 'none'}`,
    `- Members: ${channelInfo && Array.isArray(channelInfo.members) ? channelInfo.members.join(', ') : 'unknown'}`,
    `- Message count: ${messages.length}`,
    '',
  ];

  if (messages.length === 0) {
    lines.push('No messages recorded for this channel yet.');
    return lines.join('\n');
  }

  for (const message of messages) {
    lines.push(`## ${message.timestamp || 'unknown-time'} , ${message.from || 'unknown'} -> ${formatTarget(message.to)}`);
    lines.push('');
    lines.push(`Acked: ${message.acked ? 'yes' : 'no'}`);
    lines.push('');
    lines.push(String(message.content || '').trim() || '_No content_');
    lines.push('');
  }

  return lines.join('\n');
}

function renderDecisionIndex(decisions) {
  const ordered = sortByTimestampDescending(decisions, (entry) => entry && (entry.decided_at || entry.created_at));
  const items = ordered.map((entry) => {
    const topic = entry && entry.topic ? `[${entry.topic}] ` : '';
    const decidedAt = entry && (entry.decided_at || entry.created_at) ? ` (${entry.decided_at || entry.created_at})` : '';
    return `${topic}${truncate(entry && (entry.decision || entry.title || entry.id || 'Untitled decision'))}${decidedAt}`;
  });

  return [
    '# Decisions',
    '',
    'Branch-local decision summaries exported from the decision log.',
    '',
    formatBulletList(items, 'No decisions recorded.').trimEnd(),
  ].join('\n');
}

function renderSessionIndex(branch, sessions) {
  const ordered = sortByTimestampDescending(sessions, (entry) => entry && (entry.updated_at || entry.last_activity_at || entry.started_at));
  const items = ordered.map((session) => `[${session.session_id}](./${session.session_id}.md) , ${session.agent_name || 'unknown'} , ${session.state || 'unknown'}`);

  return [
    `# Sessions: ${branch}`,
    '',
    'Branch-local session manifests exported from the runtime session read model.',
    '',
    formatBulletList(items, 'No sessions recorded for this branch.').trimEnd(),
  ].join('\n');
}

function renderSessionDetail(session) {
  return [
    `# Session ${session.session_id}`,
    '',
    `- Agent: ${session.agent_name || 'unknown'}`,
    `- Provider: ${session.provider || 'unknown'}`,
    `- State: ${session.state || 'unknown'}`,
    `- Created at: ${session.created_at || 'unknown'}`,
    `- Started at: ${session.started_at || 'unknown'}`,
    `- Resumed at: ${session.resumed_at || 'unknown'}`,
    `- Updated at: ${session.updated_at || 'unknown'}`,
    `- Last activity: ${session.last_activity_at || 'unknown'}`,
    `- Ended at: ${session.ended_at || 'not ended'}`,
    `- Resume count: ${Number.isInteger(session.resume_count) ? session.resume_count : 0}`,
    `- Transition reason: ${session.transition_reason || 'unknown'}`,
    `- Recovery snapshot file: ${session.recovery_snapshot_file || 'none'}`,
    '',
    '## Manifest',
    '',
    '```json',
    JSON.stringify(session, null, 2),
    '```',
  ].join('\n');
}

function renderEvidenceIndex(records) {
  const ordered = sortByTimestampDescending(records, (entry) => entry && entry.recorded_at);
  const lines = [
    '# Evidence',
    '',
    'Branch-local evidence records exported from the evidence store.',
    '',
  ];

  if (ordered.length === 0) {
    lines.push('No evidence records found.');
    return lines.join('\n');
  }

  for (const record of ordered) {
    lines.push(`## ${record.recorded_at || 'unknown-time'} , ${record.evidence_id || 'unknown-evidence'}`);
    lines.push('');
    lines.push(`- Summary: ${record.summary || 'none'}`);
    lines.push(`- Confidence: ${record.confidence == null ? 'unknown' : record.confidence}`);
    lines.push(`- Subject kind: ${record.subject_kind || 'unknown'}`);
    lines.push(`- Files changed: ${Array.isArray(record.files_changed) && record.files_changed.length > 0 ? record.files_changed.join(', ') : 'none'}`);
    lines.push(`- Recorded by session: ${record.recorded_by_session || 'none'}`);
    lines.push('');
    lines.push(record.verification || 'No verification note recorded.');
    lines.push('');
  }

  return lines.join('\n');
}

function renderWorkspaceIndex(workspaces) {
  const items = workspaces.map((workspace) => `[${workspace.agent}](./agents/${workspace.agent}.md) , ${workspace.key_count} keys`);
  return [
    '# Workspaces',
    '',
    'Branch-local agent workspaces exported as generated notes.',
    '',
    formatBulletList(items, 'No workspace files found.').trimEnd(),
  ].join('\n');
}

function renderWorkspaceAgent(workspace) {
  const lines = [
    `# Workspace: ${workspace.agent}`,
    '',
    `Top-level keys: ${workspace.key_count}`,
    '',
  ];

  const keys = Object.keys(workspace.data || {}).sort((left, right) => left.localeCompare(right));
  if (keys.length === 0) {
    lines.push('No workspace keys recorded.');
    return lines.join('\n');
  }

  for (const key of keys) {
    const value = workspace.data[key];
    lines.push(`## ${key}`);
    lines.push('');
    lines.push('```json');
    lines.push(truncate(JSON.stringify(value, null, 2), 1200));
    lines.push('```');
    lines.push('');
  }

  return lines.join('\n');
}

function getPlanViewWorkflows(view) {
  return view && Array.isArray(view.workflows) ? view.workflows : [];
}

function getPlanViewPrimaryWorkflow(view) {
  const workflows = getPlanViewWorkflows(view);
  return workflows.length === 1 ? workflows[0] : null;
}

function countCompletedPlanSteps(steps) {
  return (Array.isArray(steps) ? steps : []).filter((step) => {
    const status = step && typeof step.status === 'string' ? step.status : '';
    return status === 'done' || status === 'completed';
  }).length;
}

function renderPlanStatus(view) {
  const workflows = getPlanViewWorkflows(view);
  if (workflows.length === 0) {
    return [
      '# Plan status',
      '',
      'No active or paused workflows for this branch.',
    ].join('\n');
  }

  const lines = [
    '# Plan status',
    '',
    `- Active or paused workflows: ${workflows.length}`,
    '',
    '## Workflows',
    '',
  ];

  for (const workflow of workflows) {
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    lines.push(`### ${workflow.name || workflow.id || 'Unknown workflow'}`);
    lines.push('');
    lines.push(`- Workflow ID: ${workflow.workflow_id || workflow.id || 'unknown'}`);
    lines.push(`- Status: ${workflow.status || 'unknown'}`);
    lines.push(`- Progress: ${countCompletedPlanSteps(steps)}/${steps.length}`);
    lines.push(`- Autonomous: ${workflow.autonomous === true ? 'yes' : 'no'}`);
    lines.push(`- Parallel: ${workflow.parallel === true ? 'yes' : 'no'}`);
    lines.push('');
    lines.push('#### Steps');
    lines.push('');
    if (steps.length > 0) {
      lines.push(...steps.map((step) => `- #${step.id} ${step.description} , ${step.status || 'unknown'} , ${step.assignee || 'unassigned'}`));
    } else {
      lines.push('No steps available.');
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderPlanReport(view) {
  const workflows = getPlanViewWorkflows(view);
  if (workflows.length === 0) {
    return [
      '# Plan report',
      '',
      'No workflow report is available for this branch.',
    ].join('\n');
  }

  const totals = view && view.totals && typeof view.totals === 'object' ? view.totals : {};
  const lines = [
    '# Plan report',
    '',
    `- Workflows: ${totals.workflows == null ? workflows.length : totals.workflows}`,
    `- Active workflows: ${totals.active_workflows == null ? workflows.filter((workflow) => workflow && workflow.status === 'active').length : totals.active_workflows}`,
    `- Completed workflows: ${totals.completed_workflows == null ? workflows.filter((workflow) => workflow && workflow.status === 'completed').length : totals.completed_workflows}`,
    `- Paused workflows: ${totals.paused_workflows == null ? workflows.filter((workflow) => workflow && workflow.status === 'paused').length : totals.paused_workflows}`,
    `- Generated at: ${view && view.generated_at ? view.generated_at : 'unknown'}`,
    '',
    '## Workflows',
    '',
  ];

  for (const workflow of workflows) {
    const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
    const flagged = steps.filter((step) => step && step.flagged === true);
    lines.push(`### ${workflow.name || workflow.id || 'Unknown workflow'}`);
    lines.push('');
    lines.push(`- Workflow ID: ${workflow.workflow_id || workflow.id || 'unknown'}`);
    lines.push(`- Status: ${workflow.status || 'unknown'}`);
    lines.push(`- Progress: ${countCompletedPlanSteps(steps)}/${steps.length}`);
    lines.push(`- Completed at: ${workflow.completed_at || 'not completed'}`);
    lines.push('');
    lines.push('#### Flagged steps');
    lines.push('');
    if (flagged.length > 0) {
      lines.push(...flagged.map((step) => `- #${step.id} ${step.description} , ${step.reason || 'no reason recorded'}`));
    } else {
      lines.push('No flagged steps.');
    }
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderProjectNote(view) {
  const branches = Array.isArray(view && view.branches) ? view.branches : [];
  const lines = [
    '# Project notes',
    '',
    'Cross-branch summary of branch-local project guidance surfaces.',
    '',
    `- Branches summarized: ${branches.length}`,
    '',
  ];

  if (branches.length === 0) {
    lines.push('No branch-local project notes found.');
    return lines.join('\n');
  }

  for (const entry of branches) {
    const kbEntries = Object.entries(entry.view && entry.view.knowledge_base ? entry.view.knowledge_base : {}).sort(([left], [right]) => left.localeCompare(right));
    const progressEntries = Object.entries(entry.view && entry.view.progress ? entry.view.progress : {}).sort(([left], [right]) => left.localeCompare(right));
    const rules = entry.view && Array.isArray(entry.view.rules) ? entry.view.rules : [];
    lines.push(`## Branch: ${entry.branch}`);
    lines.push('');
    lines.push(`- Knowledge base entries: ${kbEntries.length}`);
    lines.push(`- Rules: ${rules.length}`);
    lines.push(`- Progress entries: ${progressEntries.length}`);
    lines.push('');
    lines.push('### Rules');
    lines.push('');
    lines.push(formatBulletList(rules.map((rule) => `${rule.active === false ? '[inactive] ' : ''}${truncate(rule.text || rule.id || 'Untitled rule')}`), 'No rules found.').trimEnd());
    lines.push('');
    lines.push('### Progress');
    lines.push('');
    lines.push(formatBulletList(progressEntries.map(([key, value]) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const percent = value.percent == null ? 'unknown' : `${value.percent}%`;
        const notes = value.notes ? ` , ${truncate(value.notes)}` : '';
        return `${key}: ${percent}${notes}`;
      }
      return `${key}: ${truncate(value)}`;
    }), 'No progress entries found.').trimEnd());
    lines.push('');
    lines.push('### Knowledge base');
    lines.push('');
    lines.push(formatBulletList(kbEntries.map(([key, value]) => `${key}: ${truncate(value && value.content ? value.content : value)}`), 'No knowledge base entries found.').trimEnd());
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function renderTeamNote(view) {
  const branches = Array.isArray(view && view.branches) ? view.branches : [];
  const lines = [
    '# Team notes',
    '',
    'Cross-branch summary of branch-local collaboration governance surfaces.',
    '',
    `- Branches summarized: ${branches.length}`,
    '',
  ];

  if (branches.length === 0) {
    lines.push('No branch-local team notes found.');
    return lines.join('\n');
  }

  for (const entry of branches) {
    const decisions = Array.isArray(entry.view && entry.view.decisions) ? entry.view.decisions : [];
    const reviews = Array.isArray(entry.view && entry.view.reviews) ? entry.view.reviews : [];
    const dependencies = Array.isArray(entry.view && entry.view.dependencies) ? entry.view.dependencies : [];
    const votes = Array.isArray(entry.view && entry.view.votes) ? entry.view.votes : [];
    lines.push(`## Branch: ${entry.branch}`);
    lines.push('');
    lines.push(`- Decisions: ${decisions.length}`);
    lines.push(`- Reviews: ${reviews.length}`);
    lines.push(`- Dependencies: ${dependencies.length}`);
    lines.push(`- Votes: ${votes.length}`);
    lines.push('');
    lines.push('### Decisions');
    lines.push('');
    lines.push(formatBulletList(decisions.map((decision) => truncate(decision.decision || decision.title || decision.id || 'Untitled decision')), 'No decisions found.').trimEnd());
    lines.push('');
    lines.push('### Reviews');
    lines.push('');
    lines.push(formatBulletList(reviews.map((review) => `${review.status || 'unknown'}: ${truncate(review.file_path || review.file || review.id || 'unknown review')}`), 'No reviews found.').trimEnd());
    lines.push('');
    lines.push('### Dependencies');
    lines.push('');
    lines.push(formatBulletList(dependencies.map((dependency) => `${dependency.task_id || dependency.id || 'unknown task'} -> ${dependency.depends_on || dependency.dependsOn || 'unknown dependency'}`), 'No dependencies found.').trimEnd());
    lines.push('');
    lines.push('### Votes');
    lines.push('');
    lines.push(formatBulletList(votes.map((vote) => `${truncate(vote.question || vote.id || 'Untitled vote')} , ${vote.status || 'unknown'}`), 'No votes found.').trimEnd());
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function resolveBranchSource(branchInfo) {
  if (branchInfo.branch === 'main') return 'root';
  if (branchInfo.fork_point) return branchInfo.fork_point;
  if (branchInfo.forked_from) return 'fork';
  if (branchInfo.runtime_present && !branchInfo.listed_in_registry) return 'runtime-directory';
  return 'registry';
}

function assertSafeOutputRoot(options = {}) {
  const {
    projectRoot,
    outputRoot,
    runtimeDataDir,
  } = options;

  const resolvedProjectRoot = path.resolve(projectRoot);
  const resolvedOutputRoot = path.resolve(outputRoot);

  if (resolvedOutputRoot === resolvedProjectRoot) {
    throw new Error('Markdown workspace output root must not be the project root.');
  }

  if (isWithinDir(resolvedOutputRoot, resolvedProjectRoot)) {
    throw new Error('Markdown workspace output root must not contain the project root.');
  }

  if (runtimeDataDir) {
    const resolvedRuntimeDataDir = path.resolve(runtimeDataDir);
    if (isWithinDir(resolvedRuntimeDataDir, resolvedOutputRoot)) {
      throw new Error('Markdown workspace output root must stay outside the canonical runtime data directory.');
    }
    if (isWithinDir(resolvedOutputRoot, resolvedRuntimeDataDir)) {
      throw new Error('Markdown workspace output root must not contain the canonical runtime data directory.');
    }
  }

  return {
    resolvedProjectRoot,
    resolvedOutputRoot,
  };
}

function exportMarkdownWorkspace(options = {}) {
  const {
    projectRoot,
    outputRoot,
    generatedAt = new Date().toISOString(),
    branches = null,
    readModel,
    runtimeDataDir = null,
  } = options;

  if (!readModel) throw new Error('exportMarkdownWorkspace requires readModel');
  if (!projectRoot) throw new Error('exportMarkdownWorkspace requires projectRoot');
  if (!outputRoot) throw new Error('exportMarkdownWorkspace requires outputRoot');

  const { resolvedOutputRoot } = assertSafeOutputRoot({
    projectRoot,
    outputRoot,
    runtimeDataDir,
  });

  const branchRegistry = (branches || readModel.listBranches())
    .map((entry) => ({
      ...entry,
      branch_source: resolveBranchSource(entry),
    }));
  const branchProjectNotes = [];
  const branchTeamNotes = [];
  const filesWritten = [];
  const omissions = [];

  fs.rmSync(resolvedOutputRoot, { recursive: true, force: true });
  ensureDir(resolvedOutputRoot);

  writeMarkdownFile(
    resolvedOutputRoot,
    'README.md',
    buildFrontmatter({
      docKind: 'workspace-readme',
      branch: null,
      projectionOf: 'markdown-workspace',
      sourceSurface: 'createCanonicalState().exportMarkdownWorkspace()',
      sourceScope: 'runtime_global',
      sourceSequence: null,
      generatedAt,
    }),
    renderWorkspaceReadme(branchRegistry, generatedAt),
    filesWritten
  );

  writeMarkdownFile(
    resolvedOutputRoot,
    path.join('branches', 'index.md'),
    buildFrontmatter({
      docKind: 'branch-index',
      branch: null,
      projectionOf: 'branch-registry',
      sourceSurface: 'createCanonicalState().listMarkdownBranches()',
      sourceScope: 'runtime_global',
      sourceSequence: null,
      generatedAt,
    }),
    renderBranchesIndex(branchRegistry),
    filesWritten
  );

  for (const branchInfo of branchRegistry) {
    const branch = branchInfo.branch;
    const branchSequence = readModel.getBranchEventSequence(branch);
    const messages = readModel.getConversationMessages({ branch });
    const channelsView = readModel.getChannelsView({ branch }) || {};
    const groupedMessages = groupMessagesByChannel(messages);
    const channelNames = new Set(['general']);
    for (const channelName of Object.keys(channelsView)) channelNames.add(channelName);
    for (const channelName of groupedMessages.keys()) channelNames.add(channelName);
    const orderedChannelNames = [...channelNames].sort((left, right) => {
      if (left === right) return 0;
      if (left === 'general') return -1;
      if (right === 'general') return 1;
      return left.localeCompare(right);
    });
    const channelEntries = orderedChannelNames.map((channelName) => ({
      name: channelName,
      count: (groupedMessages.get(channelName) || []).length,
    }));
    const sessions = readModel.listBranchSessions(branch) || [];
    const evidenceStore = readModel.readEvidence(branch) || { records: [] };
    const evidenceRecords = Array.isArray(evidenceStore.records) ? evidenceStore.records : [];
    const decisions = readModel.listDecisions ? (readModel.listDecisions({ branch }) || []) : [];
    const projectNotes = readModel.getProjectNotesView ? (readModel.getProjectNotesView({ branch }) || {}) : {};
    const teamNotes = readModel.getTeamNotesView ? (readModel.getTeamNotesView({ branch }) || {}) : {};
    const planStatus = readModel.getPlanStatusView ? readModel.getPlanStatusView({ branch }) : null;
    const planReport = readModel.getPlanReportView ? readModel.getPlanReportView({ branch }) : null;
    const primaryPlanStatusWorkflow = getPlanViewPrimaryWorkflow(planStatus);
    const primaryPlanReportWorkflow = getPlanViewPrimaryWorkflow(planReport);

    branchProjectNotes.push({ branch, view: projectNotes });
    branchTeamNotes.push({ branch, view: teamNotes });

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'metadata.md'),
      buildFrontmatter({
        docKind: 'branch-metadata',
        branch,
        projectionOf: 'branch-metadata',
        sourceSurface: 'createCanonicalState().listMarkdownBranches()',
        sourceScope: 'runtime_global',
        sourceSequence: null,
        generatedAt,
        extra: {
          branch_parent: branchInfo.forked_from || null,
          branch_source: branchInfo.branch_source,
        },
      }),
      renderBranchMetadata(branchInfo),
      filesWritten
    );

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'conversations', 'index.md'),
      buildFrontmatter({
        docKind: 'conversation-index',
        branch,
        projectionOf: 'conversation-history',
        sourceSurface: 'createCanonicalState().getConversationMessages() + createCanonicalState().getChannelsView()',
        sourceScope: 'branch_local',
        sourceSequence: branchSequence,
        generatedAt,
        extra: {
          channel_count: channelEntries.length,
          message_count: messages.length,
        },
      }),
      renderConversationIndex(branch, channelEntries, messages.length),
      filesWritten
    );

    for (const channelName of orderedChannelNames) {
      writeMarkdownFile(
        resolvedOutputRoot,
        path.join('branches', branch, 'conversations', 'channels', `${channelName}.md`),
        buildFrontmatter({
          docKind: 'conversation-transcript',
          branch,
          projectionOf: 'conversation-channel-transcript',
          sourceSurface: 'createCanonicalState().getConversationMessages() + createCanonicalState().getChannelsView()',
          sourceScope: 'branch_local',
          sourceSequence: branchSequence,
          generatedAt,
          extra: {
            channel: channelName,
            message_count: (groupedMessages.get(channelName) || []).length,
          },
        }),
        renderConversationTranscript(branch, channelName, groupedMessages.get(channelName) || [], channelsView[channelName]),
        filesWritten
      );
    }

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'sessions', 'index.md'),
      buildFrontmatter({
        docKind: 'session-index',
        branch,
        projectionOf: 'session-manifest-index',
        sourceSurface: 'createCanonicalState().listBranchSessions()',
        sourceScope: 'branch_local',
        sourceSequence: branchSequence,
        generatedAt,
        extra: {
          session_count: sessions.length,
        },
      }),
      renderSessionIndex(branch, sessions),
      filesWritten
    );

    for (const session of sessions) {
      const sessionManifest = readModel.getBranchSessionManifest(session.session_id, branch) || session;
      writeMarkdownFile(
        resolvedOutputRoot,
        path.join('branches', branch, 'sessions', `${session.session_id}.md`),
        buildFrontmatter({
          docKind: 'session-detail',
          branch,
          projectionOf: 'session-manifest',
          sourceSurface: 'createCanonicalState().getBranchSessionManifest()',
          sourceScope: 'branch_local',
          sourceSequence: branchSequence,
          generatedAt,
          extra: {
            session_id: session.session_id,
            session_state: session.state || sessionManifest.state || null,
          },
        }),
        renderSessionDetail(sessionManifest),
        filesWritten
      );
    }

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'plans', 'status.md'),
      buildFrontmatter({
        docKind: 'plan-status',
        branch,
        projectionOf: 'plan-status-view',
        sourceSurface: 'createCanonicalState().getPlanStatusView({ branch })',
        sourceScope: 'branch_local',
        sourceSequence: null,
        generatedAt,
        extra: {
          workflow_id: primaryPlanStatusWorkflow && (primaryPlanStatusWorkflow.workflow_id || primaryPlanStatusWorkflow.id) ? (primaryPlanStatusWorkflow.workflow_id || primaryPlanStatusWorkflow.id) : null,
          workflow_status: primaryPlanStatusWorkflow && primaryPlanStatusWorkflow.status ? primaryPlanStatusWorkflow.status : null,
        },
      }),
      renderPlanStatus(planStatus),
      filesWritten
    );

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'plans', 'report.md'),
      buildFrontmatter({
        docKind: 'plan-report',
        branch,
        projectionOf: 'plan-report-view',
        sourceSurface: 'createCanonicalState().getPlanReportView({ branch })',
        sourceScope: 'branch_local',
        sourceSequence: null,
        generatedAt,
        extra: {
          workflow_id: primaryPlanReportWorkflow && (primaryPlanReportWorkflow.workflow_id || primaryPlanReportWorkflow.id) ? (primaryPlanReportWorkflow.workflow_id || primaryPlanReportWorkflow.id) : null,
          workflow_status: primaryPlanReportWorkflow && primaryPlanReportWorkflow.status ? primaryPlanReportWorkflow.status : null,
        },
      }),
      renderPlanReport(planReport),
      filesWritten
    );

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'evidence', 'index.md'),
      buildFrontmatter({
        docKind: 'evidence-index',
        branch,
        projectionOf: 'evidence-records',
        sourceSurface: 'createCanonicalState().readEvidence()',
        sourceScope: 'branch_local',
        sourceSequence: branchSequence,
        generatedAt,
        extra: {
          evidence_count: evidenceRecords.length,
        },
      }),
      renderEvidenceIndex(evidenceRecords),
      filesWritten
    );

    const workspaces = readModel.listWorkspaces ? (readModel.listWorkspaces({ branch }) || []) : [];

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'workspaces', 'index.md'),
      buildFrontmatter({
        docKind: 'workspace-index',
        branch,
        projectionOf: 'workspace-directory',
        sourceSurface: 'createCanonicalState().listWorkspaces({ branch })',
        sourceScope: 'branch_local',
        sourceSequence: branchSequence,
        generatedAt,
        extra: {
          agent_count: workspaces.length,
        },
      }),
      renderWorkspaceIndex(workspaces),
      filesWritten
    );

    for (const workspace of workspaces) {
      writeMarkdownFile(
        resolvedOutputRoot,
        path.join('branches', branch, 'workspaces', 'agents', `${workspace.agent}.md`),
        buildFrontmatter({
          docKind: 'workspace-agent',
          branch,
          projectionOf: 'workspace-agent-state',
          sourceSurface: 'createCanonicalState().listWorkspaces({ branch })',
          sourceScope: 'branch_local',
          sourceSequence: branchSequence,
          generatedAt,
          extra: {
            agent: workspace.agent,
            key_count: workspace.key_count,
          },
        }),
        renderWorkspaceAgent(workspace),
        filesWritten
      );
    }

    writeMarkdownFile(
      resolvedOutputRoot,
      path.join('branches', branch, 'decisions', 'index.md'),
      buildFrontmatter({
        docKind: 'decision-index',
        branch,
        projectionOf: 'decision-log',
        sourceSurface: 'createCanonicalState().listDecisions({ branch })',
        sourceScope: 'branch_local',
        sourceSequence: branchSequence,
        generatedAt,
        extra: {
          decision_count: decisions.length,
        },
      }),
      renderDecisionIndex(decisions),
      filesWritten
    );
  }

  writeMarkdownFile(
    resolvedOutputRoot,
    path.join('project', 'notes', 'project-notes.md'),
    buildFrontmatter({
      docKind: 'project-note',
      branch: null,
      projectionOf: 'project-branch-notes-summary',
      sourceSurface: 'createCanonicalState().listMarkdownBranches() + createCanonicalState().getProjectNotesView({ branch })',
      sourceScope: 'runtime_global',
      sourceSequence: null,
      generatedAt,
      extra: {
        note_scope: 'branch_local_summary',
      },
    }),
    renderProjectNote({ branches: branchProjectNotes }),
    filesWritten
  );

  writeMarkdownFile(
    resolvedOutputRoot,
    path.join('project', 'notes', 'team-notes.md'),
    buildFrontmatter({
      docKind: 'team-note',
      branch: null,
      projectionOf: 'team-branch-notes-summary',
      sourceSurface: 'createCanonicalState().listMarkdownBranches() + createCanonicalState().getTeamNotesView({ branch })',
      sourceScope: 'runtime_global',
      sourceSequence: null,
      generatedAt,
      extra: {
        note_scope: 'branch_local_summary',
      },
    }),
    renderTeamNote({ branches: branchTeamNotes }),
    filesWritten
  );

  return {
    success: true,
    generated_at: generatedAt,
    output_root: resolvedOutputRoot,
    branch_count: branchRegistry.length,
    files_written: filesWritten,
    omissions,
  };
}

module.exports = {
  DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME,
  GENERATED_BY,
  MARKDOWN_WORKSPACE_SCHEMA,
  exportMarkdownWorkspace,
};
