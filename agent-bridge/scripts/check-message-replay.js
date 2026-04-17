#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CANONICAL_REPLAY_ERROR_CODES,
  isCanonicalReplayError,
} = require(path.resolve(__dirname, '..', 'events', 'replay.js'));
const { createCanonicalEventLog } = require(path.resolve(__dirname, '..', 'events', 'log.js'));
const { createCanonicalState } = require(path.resolve(__dirname, '..', 'state', 'canonical.js'));

const FIXTURE_ROOT = path.resolve(__dirname, 'fixtures', 'message-replay');
const FIXTURE_DISPLAY_ROOT = 'agent-bridge/scripts/fixtures/message-replay';
const USAGE = 'Usage: node agent-bridge/scripts/check-message-replay.js [--scenario healthy|clean|corrupt-jsonl|corrupt-payload|corrupt-correction-payload|out-of-order]';

const FAILURE_SCENARIOS = Object.freeze({
  'corrupt-jsonl': Object.freeze({
    fixtureName: 'corrupt-jsonl',
    expectedCode: CANONICAL_REPLAY_ERROR_CODES.INVALID_JSONL,
    expectedMessageFragments: ['invalid JSONL'],
  }),
  'corrupt-payload': Object.freeze({
    fixtureName: 'corrupt-payload',
    expectedCode: CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
    expectedMessageFragments: ['payload.message to be an object'],
  }),
  'corrupt-correction-payload': Object.freeze({
    fixtureName: 'corrupt-correction-payload',
    expectedCode: CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
    expectedMessageFragments: ['message.corrected events require payload.content to be a string'],
  }),
  'out-of-order': Object.freeze({
    fixtureName: 'out-of-order',
    expectedCode: CANONICAL_REPLAY_ERROR_CODES.INVALID_SEQUENCE,
    expectedMessageFragments: ['strictly increasing seq values'],
  }),
});

function fail(lines, exitCode = 1) {
  fs.writeSync(2, lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { scenario: 'healthy' };
  }

  if (argv.length === 2 && argv[0] === '--scenario') {
    const scenario = argv[1];
    const supportedScenarios = ['healthy', 'clean', ...Object.keys(FAILURE_SCENARIOS)];
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

function readFileText(filePath) {
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

function expectEqual(problems, label, actual, expected) {
  if (actual !== expected) {
    problems.push(`${label} did not match expected content.`);
  }
}

function expect(problems, condition, message) {
  if (!condition) {
    problems.push(message);
  }
}

function toJsonl(messages) {
  return messages.map((message) => JSON.stringify(message)).join('\n') + (messages.length ? '\n' : '');
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function getFixtureSpec(fixtureName) {
  return {
    path: path.join(FIXTURE_ROOT, `${fixtureName}.jsonl`),
    display: `${FIXTURE_DISPLAY_ROOT}/${fixtureName}.jsonl`,
  };
}

function ensureFixtureExists(fixtureSpec) {
  if (!fs.existsSync(fixtureSpec.path)) {
    fail([
      'Canonical message replay validation failed.',
      `Missing fixture: ${fixtureSpec.display}`,
    ]);
  }
}

function parseFixtureObjects(fixtureSpec) {
  ensureFixtureExists(fixtureSpec);
  const raw = fs.readFileSync(fixtureSpec.path, 'utf8');
  if (!raw.trim()) return [];

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Fixture ${fixtureSpec.display} contains invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function stageFixtureAsBranchEventLog(dataDir, branchName, fixtureSpec) {
  ensureFixtureExists(fixtureSpec);
  const branchEventsFile = path.join(dataDir, 'runtime', 'branches', branchName, 'events.jsonl');
  fs.mkdirSync(path.dirname(branchEventsFile), { recursive: true });
  fs.writeFileSync(branchEventsFile, fs.readFileSync(fixtureSpec.path, 'utf8'));
  return branchEventsFile;
}

function buildReplayErrorLines(scenario, fixtureSpec, error) {
  return [
    'Canonical message replay rejected fixture.',
    `Scenario: ${scenario}`,
    `Fixture: ${fixtureSpec.display}`,
    `Replay error code: ${isCanonicalReplayError(error) ? error.code : 'canonical_replay.unclassified'}`,
    `Replay error message: ${error && error.message ? error.message : String(error)}`,
  ];
}

function runHealthyScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-task3b-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'feature_task3b';
  const canonicalState = createCanonicalState({ dataDir, processPid: 4242 });
  const eventLog = createCanonicalEventLog({ dataDir });
  const problems = [];

  const mainMessages = [
    {
      id: 'msg-task3b-main-1',
      from: 'alpha',
      to: 'beta',
      content: 'Main branch hello',
      timestamp: '2026-04-15T19:00:00.000Z',
      reply_to: null,
      system: false,
    },
    {
      id: 'msg-task3b-main-2',
      from: 'beta',
      to: 'alpha',
      content: 'Main branch reply',
      timestamp: '2026-04-15T19:00:05.000Z',
      reply_to: 'msg-task3b-main-1',
      system: false,
    },
  ];

  const featureMessages = [
    {
      id: 'msg-task3b-feature-1',
      from: 'gamma',
      to: 'delta',
      content: 'Feature branch hello',
      timestamp: '2026-04-15T19:01:00.000Z',
      reply_to: null,
      system: false,
    },
  ];

  const mainChannelMessages = [
    {
      id: 'msg-task3b-main-ops-1',
      from: 'alpha',
      to: 'beta',
      channel: 'ops',
      content: 'Main branch ops message',
      timestamp: '2026-04-15T19:00:03.000Z',
      reply_to: null,
      system: false,
    },
  ];

  const featureChannelMessages = [
    {
      id: 'msg-task3b-feature-lab-1',
      from: 'gamma',
      to: 'delta',
      channel: 'lab',
      content: 'Feature branch lab message',
      timestamp: '2026-04-15T19:01:03.000Z',
      reply_to: null,
      system: false,
    },
  ];

  try {
    for (const message of mainMessages) {
      canonicalState.appendMessage(message);
    }
    for (const message of mainChannelMessages) {
      canonicalState.appendScopedMessage(message, { branch: 'main', channel: 'ops' });
    }

    for (const message of featureMessages) {
      canonicalState.appendMessage(message, { branch: branchName });
    }
    for (const message of featureChannelMessages) {
      canonicalState.appendScopedMessage(message, { branch: branchName, channel: 'lab' });
    }

    writeJson(path.join(dataDir, 'channels.json'), {
      general: { description: 'General channel' },
      ops: { description: 'Ops channel' },
    });
    writeJson(path.join(dataDir, `branch-${branchName}-channels.json`), {
      general: { description: 'General channel' },
      lab: { description: 'Lab channel' },
    });

    const mainEvents = eventLog.readBranchEvents('main');
    const featureEvents = eventLog.readBranchEvents(branchName);
    const mainEventFile = eventLog.getBranchEventsFile('main');
    const featureEventFile = eventLog.getBranchEventsFile(branchName);

    expect(problems, fs.existsSync(mainEventFile), `Missing canonical event log for main branch: ${mainEventFile}`);
    expect(problems, fs.existsSync(featureEventFile), `Missing canonical event log for ${branchName}: ${featureEventFile}`);
    expect(problems, mainEvents.length === mainMessages.length + mainChannelMessages.length, 'Main branch canonical event count was incorrect.');
    expect(problems, featureEvents.length === featureMessages.length + featureChannelMessages.length, `${branchName} canonical event count was incorrect.`);
    expect(problems, mainEvents.every((event) => event.type === 'message.sent' && event.stream === 'branch' && event.branch_id === 'main'), 'Main branch events were not persisted as branch-local message.sent events.');
    expect(problems, featureEvents.every((event) => event.type === 'message.sent' && event.stream === 'branch' && event.branch_id === branchName), `${branchName} events were not persisted as branch-local message.sent events.`);
    expect(problems, mainEvents.map((event) => event.seq).join(',') === '1,2,3', 'Main branch canonical event sequence should be 1,2,3.');
    expect(problems, featureEvents.map((event) => event.seq).join(',') === '1,2', `${branchName} canonical event sequence should reset to 1,2.`);

    const mainMessagesFile = path.join(dataDir, 'messages.jsonl');
    const mainHistoryFile = path.join(dataDir, 'history.jsonl');
    const mainChannelMessagesFile = path.join(dataDir, 'channel-ops-messages.jsonl');
    const mainChannelHistoryFile = path.join(dataDir, 'channel-ops-history.jsonl');
    const featureMessagesFile = path.join(dataDir, `branch-${branchName}-messages.jsonl`);
    const featureHistoryFile = path.join(dataDir, `branch-${branchName}-history.jsonl`);
    const featureChannelMessagesFile = path.join(dataDir, `branch-${branchName}-channel-lab-messages.jsonl`);
    const featureChannelHistoryFile = path.join(dataDir, `branch-${branchName}-channel-lab-history.jsonl`);

    deleteFile(mainMessagesFile);
    deleteFile(mainHistoryFile);
    deleteFile(mainChannelMessagesFile);
    deleteFile(mainChannelHistoryFile);
    deleteFile(featureMessagesFile);
    deleteFile(featureHistoryFile);
    deleteFile(featureChannelMessagesFile);
    deleteFile(featureChannelHistoryFile);

    canonicalState.rebuildMessageProjections();
    canonicalState.rebuildMessageProjections({ branch: branchName });

    const expectedMainJsonl = toJsonl(mainMessages);
    const expectedMainChannelJsonl = toJsonl(mainChannelMessages);
    const expectedFeatureJsonl = toJsonl(featureMessages);
    const expectedFeatureChannelJsonl = toJsonl(featureChannelMessages);

    expectEqual(problems, 'Rebuilt main messages.jsonl', readFileText(mainMessagesFile), expectedMainJsonl);
    expectEqual(problems, 'Rebuilt main history.jsonl', readFileText(mainHistoryFile), expectedMainJsonl);
    expectEqual(problems, 'Rebuilt main channel messages.jsonl', readFileText(mainChannelMessagesFile), expectedMainChannelJsonl);
    expectEqual(problems, 'Rebuilt main channel history.jsonl', readFileText(mainChannelHistoryFile), expectedMainChannelJsonl);
    expectEqual(problems, `Rebuilt ${branchName} messages.jsonl`, readFileText(featureMessagesFile), expectedFeatureJsonl);
    expectEqual(problems, `Rebuilt ${branchName} history.jsonl`, readFileText(featureHistoryFile), expectedFeatureJsonl);
    expectEqual(problems, `Rebuilt ${branchName} channel messages.jsonl`, readFileText(featureChannelMessagesFile), expectedFeatureChannelJsonl);
    expectEqual(problems, `Rebuilt ${branchName} channel history.jsonl`, readFileText(featureChannelHistoryFile), expectedFeatureChannelJsonl);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail([
      'Canonical message replay validation failed.',
      'Scenario: healthy',
      ...problems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'Canonical message replay validation passed.',
    'Scenario: healthy',
    'Validated branch-local message.sent canonical event append.',
    'Validated replay/materialization preserves general-vs-channel message scope across branch-global and per-channel projections on main + feature_task3b branches.',
  ].join('\n'));
}

function runCleanFixtureScenario() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'letthemtalk-task3c-clean-'));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'main';
  const fixtureSpec = getFixtureSpec('clean');
  const canonicalState = createCanonicalState({ dataDir, processPid: 4343 });
  const eventLog = createCanonicalEventLog({ dataDir });
  const problems = [];

  try {
    stageFixtureAsBranchEventLog(dataDir, branchName, fixtureSpec);
    const replayResult = canonicalState.rebuildMessageProjections({ branch: branchName });
    const fixtureEvents = parseFixtureObjects(fixtureSpec);
    const expectedMessages = fixtureEvents.map((event) => event.payload.message);
    const expectedJsonl = toJsonl(expectedMessages);
    const messagesFile = path.join(dataDir, 'messages.jsonl');
    const historyFile = path.join(dataDir, 'history.jsonl');
    const replayedEvents = eventLog.readBranchEvents(branchName, { typePrefix: 'message.' });

    expect(problems, replayResult.events_applied === expectedMessages.length, `Expected ${expectedMessages.length} replayed message events, received ${replayResult.events_applied}.`);
    expect(problems, replayResult.message_count === expectedMessages.length, `Expected ${expectedMessages.length} replayed messages, received ${replayResult.message_count}.`);
    expect(problems, replayResult.history_count === expectedMessages.length, `Expected ${expectedMessages.length} replayed history entries, received ${replayResult.history_count}.`);
    expect(problems, replayedEvents.length === expectedMessages.length, `Expected ${expectedMessages.length} fixture events in the branch log, received ${replayedEvents.length}.`);
    expectEqual(problems, 'Replayed clean fixture messages.jsonl', readFileText(messagesFile), expectedJsonl);
    expectEqual(problems, 'Replayed clean fixture history.jsonl', readFileText(historyFile), expectedJsonl);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    fail([
      'Canonical message replay validation failed.',
      'Scenario: clean',
      `Fixture: ${fixtureSpec.display}`,
      ...problems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'Canonical message replay fixture validation passed.',
    'Scenario: clean',
    `Fixture: ${fixtureSpec.display}`,
    'Validated deterministic replay/materialization from a clean canonical message-event fixture.',
  ].join('\n'));
}

function runFailureFixtureScenario(scenario) {
  const scenarioConfig = FAILURE_SCENARIOS[scenario];
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `letthemtalk-task3c-${scenario}-`));
  const dataDir = path.join(tempRoot, '.agent-bridge');
  const branchName = 'main';
  const fixtureSpec = getFixtureSpec(scenarioConfig.fixtureName);
  const canonicalState = createCanonicalState({ dataDir, processPid: 4444 });
  let outcome = null;

  try {
    stageFixtureAsBranchEventLog(dataDir, branchName, fixtureSpec);

    try {
      canonicalState.rebuildMessageProjections({ branch: branchName });
      outcome = {
        exitCode: 2,
        lines: [
          'Canonical message replay failure validation did not match expectations.',
          `Scenario: ${scenario}`,
          `Fixture: ${fixtureSpec.display}`,
          'Replay unexpectedly succeeded for an invalid fixture.',
        ],
      };
    } catch (error) {
      const errorLines = buildReplayErrorLines(scenario, fixtureSpec, error);
      const matchesExpectedCode = isCanonicalReplayError(error) && error.code === scenarioConfig.expectedCode;
      const matchesExpectedMessage = scenarioConfig.expectedMessageFragments.every((fragment) =>
        error && typeof error.message === 'string' && error.message.includes(fragment)
      );

      if (!matchesExpectedCode || !matchesExpectedMessage) {
        outcome = {
          exitCode: 2,
          lines: [
          'Canonical message replay failure validation did not match expectations.',
          `Scenario: ${scenario}`,
          `Expected replay error code: ${scenarioConfig.expectedCode}`,
          `Expected replay error fragments: ${scenarioConfig.expectedMessageFragments.join(' | ')}`,
          ...errorLines,
          ],
        };
      } else {
        outcome = { exitCode: 1, lines: errorLines };
      }
    }
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  fail(outcome.lines, outcome.exitCode);
}

function main() {
  const { scenario } = parseArgs(process.argv.slice(2));

  if (scenario === 'healthy') {
    runHealthyScenario();
    return;
  }

  if (scenario === 'clean') {
    runCleanFixtureScenario();
    return;
  }

  if (FAILURE_SCENARIOS[scenario]) {
    runFailureFixtureScenario(scenario);
    return;
  }

  fail([`Unsupported scenario: ${scenario}`, USAGE], 2);
}

main();
