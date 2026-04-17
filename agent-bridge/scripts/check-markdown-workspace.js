#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const DOC_PATH = path.resolve(__dirname, '..', '..', 'docs', 'architecture', 'markdown-workspace.md');
const DOC_DISPLAY_PATH = 'docs/architecture/markdown-workspace.md';
const USAGE = 'Usage: node agent-bridge/scripts/check-markdown-workspace.js [--simulate-missing <key>]';

const REQUIRED_HEADINGS = [
  { key: 'non_authoritative_authority_model', heading: '## Non-authoritative authority model' },
  { key: 'workspace_root_layout', heading: '## Workspace root / layout' },
  { key: 'required_generated_frontmatter', heading: '## Required generated frontmatter' },
  { key: 'common_frontmatter', heading: '### Common frontmatter' },
  { key: 'kind_specific_frontmatter', heading: '### Kind-specific frontmatter' },
  { key: 'export_source_mapping', heading: '## Export-source mapping' },
  { key: 'branch_compatibility_safety_rules', heading: '## Branch and compatibility safety rules' },
  { key: 'task_9b_implementation_seam', heading: '## Task 9B implementation seam' },
  { key: 'validation_path', heading: '## Validation path' },
];

const REQUIRED_SNIPPETS = [
  { key: 'non_authoritative_rule', snippet: 'Markdown files are rebuilt from canonical and legacy-compat read models and never treated as runtime inputs.' },
  { key: 'frontmatter_authority_rule', snippet: 'Every exported markdown file MUST set `authoritative: false` in frontmatter.' },
  { key: 'source_sequence_frontmatter', snippet: 'source_sequence: <stream-seq-or-null>' },
  { key: 'no_write_back_rule', snippet: 'Task 9B MUST NOT implement write-back or live sync loops.' },
  { key: 'explicit_import_rule', snippet: 'Any future import must be explicit and broker-mediated.' },
  { key: 'default_export_root', snippet: 'Default export root: `<repo>/.agent-bridge-markdown/`' },
  { key: 'project_note_path', snippet: 'project/notes/project-notes.md' },
  { key: 'team_note_path', snippet: 'project/notes/team-notes.md' },
  { key: 'branch_conversation_path', snippet: 'branches/<branch>/conversations/index.md' },
  { key: 'session_path', snippet: 'branches/<branch>/sessions/<session-id>.md' },
  { key: 'workspace_agent_path', snippet: 'branches/<branch>/workspaces/agents/<agent>.md' },
  { key: 'plan_status_path', snippet: 'branches/<branch>/plans/status.md' },
  { key: 'governance_branch_local_rule', snippet: 'Governance pages and cross-branch note summaries MUST read branch-local governance views; they MUST NOT fall back to shared legacy governance files.' },
  { key: 'canonical_assembly_point', snippet: 'The best low-churn export assembly point is `agent-bridge/state/canonical.js`.' },
  { key: 'dashboard_export_seam', snippet: 'The best outward-facing seam is the existing dashboard export family (`/api/export-json`, `/api/export`, and `/api/export-replay`), not a watcher loop.' },
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
    fail(`Markdown workspace validation failed.\nMissing file: ${DOC_DISPLAY_PATH}`, 1);
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
    const lines = ['Markdown workspace validation failed.', `Checked file: ${DOC_DISPLAY_PATH}`];

    if (simulateMissingKey) {
      lines.push(`Simulated missing key: ${simulateMissingKey}`);
    }

    lines.push('Missing required markdown workspace contract markers:');
    lines.push(...problems);
    fail(lines.join('\n'), 1);
  }

  console.log([
    'Markdown workspace validation passed.',
    `Checked file: ${DOC_DISPLAY_PATH}`,
    `Validated ${REQUIRED_HEADINGS.length} required headings.`,
    `Validated ${REQUIRED_SNIPPETS.length} required markdown workspace markers.`,
  ].join('\n'));
}

main();
