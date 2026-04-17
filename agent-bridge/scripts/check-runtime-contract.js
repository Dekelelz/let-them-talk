#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const CONTRACT_PATH = path.resolve(__dirname, '..', '..', 'docs', 'architecture', 'runtime-contract.md');
const CONTRACT_DISPLAY_PATH = 'docs/architecture/runtime-contract.md';
const USAGE = 'Usage: node agent-bridge/scripts/check-runtime-contract.js [--simulate-missing <section-key>]';

const REQUIRED_SECTIONS = [
  { key: 'authority_boundaries', heading: '## Authority boundaries' },
  { key: 'canonical_writer_rule', heading: '### 1. Canonical writer rule' },
  { key: 'storage_model', heading: '## Storage model' },
  { key: 'event_command_model', heading: '## Event / command model' },
  { key: 'required_event_envelope', heading: '### 3. Required event envelope' },
  { key: 'evidence_model', heading: '### 5. Evidence-backed completion semantics' },
  { key: 'branch_semantics', heading: '## Branching / isolation semantics' },
  { key: 'session_scope', heading: '### 5. Session scope / resumption semantics' },
  { key: 'versioning_migration', heading: '## Versioning / migration / compatibility' },
  { key: 'migration_policy', heading: '### 4. Migration policy' },
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
    const supportedKeys = REQUIRED_SECTIONS.map((section) => section.key);

    if (!supportedKeys.includes(simulateMissingKey)) {
      fail(
        [
          `Unknown section key for --simulate-missing: ${simulateMissingKey}`,
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

  if (!fs.existsSync(CONTRACT_PATH)) {
    fail(`Runtime contract validation failed.\nMissing file: ${CONTRACT_DISPLAY_PATH}`, 1);
  }

  const markdown = fs.readFileSync(CONTRACT_PATH, 'utf8');
  const headings = collectHeadings(markdown);
  const missingSections = REQUIRED_SECTIONS.filter((section) => {
    if (section.key === simulateMissingKey) {
      return true;
    }

    return !headings.has(section.heading);
  });

  if (missingSections.length > 0) {
    const lines = ['Runtime contract validation failed.', `Checked file: ${CONTRACT_DISPLAY_PATH}`];

    if (simulateMissingKey) {
      lines.push(`Simulated missing section key: ${simulateMissingKey}`);
    }

    lines.push('Missing required contract sections:');

    for (const section of missingSections) {
      lines.push(`- ${section.key}: ${section.heading}`);
    }

    fail(lines.join('\n'), 1);
  }

  const successLines = [
    'Runtime contract validation passed.',
    `Checked file: ${CONTRACT_DISPLAY_PATH}`,
    `Validated ${REQUIRED_SECTIONS.length} required contract sections.`,
  ];

  for (const section of REQUIRED_SECTIONS) {
    successLines.push(`- ${section.key}: ${section.heading}`);
  }

  console.log(successLines.join('\n'));
}

main();
