#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'architecture', 'branch-semantics.md');
const DOC_DISPLAY_PATH = 'docs/architecture/branch-semantics.md';
const USAGE = 'Usage: node agent-bridge/scripts/check-branch-semantics.js [--simulate-missing <key>]';

const REQUIRED_HEADINGS = [
  { key: 'two_bucket_scope_model', heading: '## Two-bucket scope model' },
  { key: 'runtime_global_bucket', heading: '### Runtime-global bucket' },
  { key: 'branch_local_bucket', heading: '### Branch-local bucket' },
  { key: 'fork_time_snapshot_semantics', heading: '## Fork-time snapshot semantics' },
  { key: 'inherited_branch_local_state', heading: '### Inherited branch-local state' },
  { key: 'session_and_evidence_snapshot_rules', heading: '### Session and evidence snapshot rules' },
  { key: 'branch_local_read_write_resolution', heading: '## Branch-local read/write resolution' },
  { key: 'read_resolution', heading: '### Read resolution' },
  { key: 'write_resolution', heading: '### Write resolution' },
  { key: 'domain_matrix', heading: '## Domain matrix' },
  { key: 'current_leak_points', heading: '## Current leak points / migration-first priorities' },
  { key: 'validation_path', heading: '## Validation path' },
];

const REQUIRED_SNIPPETS = [
  { key: 'copy_on_fork_rule', snippet: 'Snapshot inheritance is copy-on-fork, not a live overlay.' },
  { key: 'no_branch_fallback_rule', snippet: 'A branch-local read MUST NOT fall back to another branch, to `main`, or to a shared global collaboration file.' },
  { key: 'active_session_rule', snippet: 'Active sessions do not stay live across a fork, and the target branch does not start with copied session manifests or cloned live execution.' },
  { key: 'governance_branch_local_rule', snippet: '- decisions, KB, reviews, dependencies, votes, rules, and progress,' },
  { key: 'fork_governance_snapshot_rule', snippet: '- governance state such as decisions, KB, reviews, dependencies, votes, rules, and progress,' },
  { key: 'no_remaining_governance_gap_rule', snippet: 'There are no remaining agent-visible collaboration surfaces that intentionally resolve through shared compatibility governance files in the shipped runtime.' },
  { key: 'next_domains_done_rule', snippet: 'Tasks, workflows, delivery/read state, conversation control, non-general channels, workspaces, governance surfaces, sessions, and evidence are already in the shipped branch-local slice.' },
  { key: 'matrix_delivery_row', snippet: '| Delivery/read markers (`consumed-*`, acknowledgements, read receipts, compressed history) |' },
  { key: 'matrix_conversation_row', snippet: '| Conversation metadata and non-general channels |' },
  { key: 'matrix_tasks_row', snippet: '| Tasks |' },
  { key: 'matrix_workflows_row', snippet: '| Workflows |' },
  { key: 'matrix_workspaces_row', snippet: '| Workspaces |' },
  { key: 'matrix_governance_row', snippet: '| Decisions / KB / reviews / dependencies / votes / rules / progress |' },
  { key: 'matrix_sessions_row', snippet: '| Sessions / evidence |' },
  { key: 'matrix_global_row', snippet: '| Agent registry / profiles |' },
];

function fail(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { simulateMissingKey: null };
  }

  if (argv.length === 2 && argv[0] === '--simulate-missing') {
    const simulateMissingKey = argv[1];
    const supportedKeys = [
      ...REQUIRED_HEADINGS.map((item) => item.key),
      ...REQUIRED_SNIPPETS.map((item) => item.key),
    ];

    if (!supportedKeys.includes(simulateMissingKey)) {
      fail(
        [
          `Unknown key for --simulate-missing: ${simulateMissingKey}`,
          `Supported keys: ${supportedKeys.join(', ')}`,
          USAGE,
        ].join('\n'),
        2
      );
    }

    return { simulateMissingKey };
  }

  fail(USAGE, 2);
}

function collectHeadings(markdown) {
  return new Set(
    markdown
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => /^(##|###)\s+/.test(line))
  );
}

function main() {
  const { simulateMissingKey } = parseArgs(process.argv.slice(2));

  if (!fs.existsSync(DOC_PATH)) {
    fail(`Branch semantics validation failed.\nMissing file: ${DOC_DISPLAY_PATH}`, 1);
  }

  const markdown = fs.readFileSync(DOC_PATH, 'utf8');
  const headings = collectHeadings(markdown);
  const problems = [];

  for (const item of REQUIRED_HEADINGS) {
    if (item.key === simulateMissingKey) {
      problems.push(`- ${item.key}: ${item.heading}`);
      continue;
    }

    if (!headings.has(item.heading)) {
      problems.push(`- ${item.key}: ${item.heading}`);
    }
  }

  for (const item of REQUIRED_SNIPPETS) {
    if (item.key === simulateMissingKey) {
      problems.push(`- ${item.key}: ${item.snippet}`);
      continue;
    }

    if (!markdown.includes(item.snippet)) {
      problems.push(`- ${item.key}: ${item.snippet}`);
    }
  }

  if (problems.length > 0) {
    const lines = ['Branch semantics validation failed.', `Checked file: ${DOC_DISPLAY_PATH}`];

    if (simulateMissingKey) {
      lines.push(`Simulated missing key: ${simulateMissingKey}`);
    }

    lines.push('Missing required branch semantics contract markers:');
    lines.push(...problems);
    fail(lines.join('\n'), 1);
  }

  console.log([
    'Branch semantics validation passed.',
    `Checked file: ${DOC_DISPLAY_PATH}`,
    `Validated ${REQUIRED_HEADINGS.length} required headings.`,
    `Validated ${REQUIRED_SNIPPETS.length} required branch markers.`,
  ].join('\n'));
}

main();
