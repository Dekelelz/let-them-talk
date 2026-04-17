#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const {
  CANONICAL_REPLAY_ERROR_CODES,
  isCanonicalReplayError,
} = require(path.resolve(__dirname, '..', 'events', 'replay.js'));
const {
  createBranchPathResolvers,
  createCanonicalState,
} = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RUNTIME_CONTRACT_PATH = path.join(REPO_ROOT, 'docs', 'architecture', 'runtime-contract.md');
const RUNTIME_CONTRACT_DISPLAY = 'docs/architecture/runtime-contract.md';
const HARDENING_DOC_PATH = path.join(REPO_ROOT, 'docs', 'architecture', 'runtime-migration-hardening.md');
const HARDENING_DOC_DISPLAY = 'docs/architecture/runtime-migration-hardening.md';
const USAGE = 'Usage: node agent-bridge/scripts/check-migration-hardening.js [--scenario healthy|legacy-projection-without-canonical-log]';

const SCENARIOS = Object.freeze({
  healthy: 'healthy',
  legacyProjectionWithoutCanonicalLog: 'legacy-projection-without-canonical-log',
});

const REQUIRED_RUNTIME_CONTRACT_SNIPPETS = Object.freeze([
  '- if a compatibility projection exists but its canonical event stream is missing, rebuild and rollback MUST fail explicitly instead of treating the projection as authoritative.',
  'Migration hardening is not complete until deterministic validation proves both canonical-first rebuild and explicit rejection of legacy-only rollback assumptions. Task 13C freezes that validator-facing slice in `docs/architecture/runtime-migration-hardening.md`.',
  '- Missing canonical stream with surviving compatibility projections -> fail explicit rebuild/rollback checks instead of promoting the projection back to authority.',
  '9. compatibility projections are rejected as rollback authority when the corresponding canonical stream is missing.',
]);

const REQUIRED_HARDENING_DOC_HEADINGS = Object.freeze([
  '## Cutover invariants',
  '## Rollback and recovery rules',
  '## Stale transitional assumptions that stay invalid',
  '## Guarded runtime slice in current code',
  '## Validation path',
]);

const REQUIRED_HARDENING_DOC_SNIPPETS = Object.freeze([
  'Legacy filenames such as `messages.jsonl`, `history.jsonl`, `tasks.json`, and `workflows.json` are compatibility projections during migration. They are not rollback authority.',
  'If a compatibility projection exists without its canonical event stream, rebuild and rollback checks MUST fail explicitly instead of silently promoting the projection back to authority.',
  'Legacy `messages.jsonl` or `history.jsonl` can stand in for a missing canonical branch event log during rebuild',
  'The second command exits `1` by design. It proves the runtime does not treat surviving compatibility projections as rollback authority when the canonical branch event stream is missing.',
]);

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { scenario: SCENARIOS.healthy };
  }

  if (argv.length === 2 && argv[0] === '--scenario') {
    const scenario = argv[1];
    const supportedScenarios = Object.values(SCENARIOS);
    if (!supportedScenarios.includes(scenario)) {
      fail([
        `Unknown scenario: ${scenario}`,
        `Supported scenarios: ${supportedScenarios.join(', ')}`,
        USAGE,
      ], 2);
    }

    return { scenario };
  }

  fail([USAGE], 2);
}

function collectHeadings(markdown) {
  return new Set(
    markdown
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => /^(##|###)\s+/.test(line))
  );
}

function readRequiredFile(filePath, displayPath) {
  if (!fs.existsSync(filePath)) {
    fail([
      'Migration hardening validation failed.',
      `Missing file: ${displayPath}`,
    ]);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function expectIncludes(problems, markdown, snippet, label) {
  if (!markdown.includes(snippet)) {
    problems.push(`${label} Missing snippet: ${snippet}`);
  }
}

function expectHeading(problems, headings, heading, label) {
  if (!headings.has(heading)) {
    problems.push(`${label} Missing heading: ${heading}`);
  }
}

function toJsonl(messages) {
  return messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '');
}

function relativeFromDataDir(dataDir, filePath) {
  return path.relative(dataDir, filePath).split(path.sep).join('/');
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function validateDocs() {
  const problems = [];
  const runtimeContract = readRequiredFile(RUNTIME_CONTRACT_PATH, RUNTIME_CONTRACT_DISPLAY);
  const hardeningDoc = readRequiredFile(HARDENING_DOC_PATH, HARDENING_DOC_DISPLAY);
  const hardeningHeadings = collectHeadings(hardeningDoc);

  for (const snippet of REQUIRED_RUNTIME_CONTRACT_SNIPPETS) {
    expectIncludes(problems, runtimeContract, snippet, `${RUNTIME_CONTRACT_DISPLAY}.`);
  }

  for (const heading of REQUIRED_HARDENING_DOC_HEADINGS) {
    expectHeading(problems, hardeningHeadings, heading, `${HARDENING_DOC_DISPLAY}.`);
  }

  for (const snippet of REQUIRED_HARDENING_DOC_SNIPPETS) {
    expectIncludes(problems, hardeningDoc, snippet, `${HARDENING_DOC_DISPLAY}.`);
  }

  return problems;
}

function runHealthyScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-migration-hardening-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_migration_guard';
  const branchPaths = createBranchPathResolvers(dataDir);
  const canonicalState = createCanonicalState({ dataDir, processPid: 4545 });
  const canonicalEventLog = createCanonicalEventLog({ dataDir });
  const message = {
    id: 'msg-migration-guard-1',
    from: 'alpha',
    to: 'beta',
    content: 'Migration guard baseline',
    timestamp: '2026-04-16T23:40:00.000Z',
    reply_to: null,
    system: false,
  };
  const expectedJsonl = toJsonl([message]);
  const problems = [];

  try {
    canonicalState.appendMessage(message, { branch: branchName });

    const targets = branchPaths.getMessageTargets(branchName);
    const eventFile = canonicalEventLog.getBranchEventsFile(branchName);
    const eventFileRelative = relativeFromDataDir(dataDir, eventFile);
    const messageFileRelative = relativeFromDataDir(dataDir, targets.messageFile);
    const historyFileRelative = relativeFromDataDir(dataDir, targets.historyFile);

    if (!fs.existsSync(eventFile)) {
      problems.push(`Missing canonical branch event file: ${eventFileRelative}`);
    }
    if (!fs.existsSync(targets.messageFile)) {
      problems.push(`Missing compatibility message projection: ${messageFileRelative}`);
    }
    if (!fs.existsSync(targets.historyFile)) {
      problems.push(`Missing compatibility history projection: ${historyFileRelative}`);
    }
    if (eventFileRelative !== `runtime/branches/${branchName}/events.jsonl`) {
      problems.push(`Canonical message events should live under runtime/branches/<branch>/events.jsonl. Actual: ${eventFileRelative}`);
    }
    if (messageFileRelative !== `branch-${branchName}-messages.jsonl`) {
      problems.push(`Compatibility message projection path drifted. Actual: ${messageFileRelative}`);
    }
    if (historyFileRelative !== `branch-${branchName}-history.jsonl`) {
      problems.push(`Compatibility history projection path drifted. Actual: ${historyFileRelative}`);
    }

    const canonicalBeforeRebuild = fs.readFileSync(eventFile, 'utf8');
    deleteFile(targets.messageFile);
    deleteFile(targets.historyFile);
    canonicalState.rebuildMessageProjections({ branch: branchName });
    const canonicalAfterRebuild = fs.readFileSync(eventFile, 'utf8');

    if (canonicalBeforeRebuild !== canonicalAfterRebuild) {
      problems.push('Projection rebuild mutated the canonical event log instead of treating it as read-only authority.');
    }
    if (fs.readFileSync(targets.messageFile, 'utf8') !== expectedJsonl) {
      problems.push('Compatibility messages.jsonl projection did not rebuild deterministically from canonical events.');
    }
    if (fs.readFileSync(targets.historyFile, 'utf8') !== expectedJsonl) {
      problems.push('Compatibility history.jsonl projection did not rebuild deterministically from canonical events.');
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  return problems;
}

function runLegacyProjectionWithoutCanonicalLogScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-migration-legacy-only-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_migration_guard';
  const branchPaths = createBranchPathResolvers(dataDir);
  const canonicalState = createCanonicalState({ dataDir, processPid: 4646 });
  const targets = branchPaths.getMessageTargets(branchName);

  try {
    fs.mkdirSync(path.dirname(targets.messageFile), { recursive: true });
    fs.writeFileSync(targets.messageFile, '{"id":"legacy-only-message"}\n');
    fs.writeFileSync(targets.historyFile, '{"id":"legacy-only-message"}\n');

    try {
      canonicalState.rebuildMessageProjections({ branch: branchName });
      fail([
        'Migration hardening validation failed.',
        `Scenario: ${SCENARIOS.legacyProjectionWithoutCanonicalLog}`,
        'Expected rebuild to reject the legacy-only projection fixture, but it succeeded.',
      ]);
    } catch (error) {
      if (!isCanonicalReplayError(error) || error.code !== CANONICAL_REPLAY_ERROR_CODES.MISSING_CANONICAL_STREAM) {
        fail([
          'Migration hardening validation failed.',
          `Scenario: ${SCENARIOS.legacyProjectionWithoutCanonicalLog}`,
          `Expected replay error code: ${CANONICAL_REPLAY_ERROR_CODES.MISSING_CANONICAL_STREAM}`,
          `Actual error code: ${error && error.code ? error.code : 'unknown'}`,
          `Actual error message: ${error && error.message ? error.message : String(error)}`,
        ]);
      }

      if (!String(error.message).includes('legacy-only recovery')
        || !String(error.message).includes('compatibility projections still exist')) {
        fail([
          'Migration hardening validation failed.',
          `Scenario: ${SCENARIOS.legacyProjectionWithoutCanonicalLog}`,
          'Expected the rejection message to explain the legacy-only rebuild guard clearly.',
          `Actual error message: ${error.message}`,
        ]);
      }

      fail([
        'Migration hardening rejected legacy-only rebuild fixture.',
        `Scenario: ${SCENARIOS.legacyProjectionWithoutCanonicalLog}`,
        `Replay error code: ${error.code}`,
        `Replay error message: ${error.message}`,
      ]);
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  const { scenario } = parseArgs(process.argv.slice(2));
  const docProblems = validateDocs();

  if (docProblems.length > 0) {
    fail([
      'Migration hardening validation failed.',
      ...docProblems.map((problem) => `- ${problem}`),
    ]);
  }

  if (scenario === SCENARIOS.legacyProjectionWithoutCanonicalLog) {
    runLegacyProjectionWithoutCanonicalLogScenario();
    return;
  }

  const healthyProblems = runHealthyScenario();
  if (healthyProblems.length > 0) {
    fail([
      'Migration hardening validation failed.',
      `Scenario: ${SCENARIOS.healthy}`,
      ...healthyProblems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'Migration hardening validation passed.',
    `Checked file: ${RUNTIME_CONTRACT_DISPLAY}`,
    `Checked file: ${HARDENING_DOC_DISPLAY}`,
    'Validated canonical-first rebuild from branch-local event streams, read-only canonical rollback behavior, and explicit rejection of legacy-only projection authority.',
  ].join('\n'));
}

main();
