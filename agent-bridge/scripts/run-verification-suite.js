#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const PACKAGE_ROOT = path.resolve(__dirname, '..');
const USAGE = 'Usage: node agent-bridge/scripts/run-verification-suite.js <replay-negative|dashboard-semantic-gap|smoke>';

const SUITES = Object.freeze({
  'replay-negative': Object.freeze({
    title: 'Replay negative verification suite',
    successLine: 'Expected-failure replay scenarios rejected invalid fixtures deterministically.',
    steps: Object.freeze([
      Object.freeze({
        label: 'corrupt-jsonl',
        args: ['scripts/check-message-replay.js', '--scenario', 'corrupt-jsonl'],
        expectedExitCode: 1,
      }),
      Object.freeze({
        label: 'corrupt-payload',
        args: ['scripts/check-message-replay.js', '--scenario', 'corrupt-payload'],
        expectedExitCode: 1,
      }),
      Object.freeze({
        label: 'corrupt-correction-payload',
        args: ['scripts/check-message-replay.js', '--scenario', 'corrupt-correction-payload'],
        expectedExitCode: 1,
      }),
      Object.freeze({
        label: 'out-of-order',
        args: ['scripts/check-message-replay.js', '--scenario', 'out-of-order'],
        expectedExitCode: 1,
      }),
    ]),
  }),
  'dashboard-semantic-gap': Object.freeze({
    title: 'Dashboard semantic-gap verification suite',
    successLine: 'Dashboard semantic-gap coverage now passes with canonical edit/delete replay behavior.',
    steps: Object.freeze([
      Object.freeze({
        label: 'edit-delete-semantic-gap',
        args: ['scripts/check-dashboard-control-plane.js', '--scenario', 'edit-delete-semantic-gap'],
        expectedExitCode: 0,
      }),
    ]),
  }),
  smoke: Object.freeze({
    title: 'Verification smoke suite',
    successLine: 'Representative verification smoke checks passed.',
    steps: Object.freeze([
      Object.freeze({
        label: 'runtime-contract',
        args: ['scripts/check-runtime-contract.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'event-schema',
        args: ['scripts/check-event-schema.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'markdown-workspace-contract',
        args: ['scripts/check-markdown-workspace.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'message-replay-healthy',
        args: ['scripts/check-message-replay.js', '--scenario', 'healthy'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'authority-invariants',
        args: ['scripts/check-invariants.js', '--suite', 'authority'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'dashboard-control-plane',
        args: ['scripts/check-dashboard-control-plane.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'performance-indexing',
        args: ['scripts/check-performance-indexing.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'provider-capabilities',
        args: ['scripts/check-provider-capabilities.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'api-agent-parity',
        args: ['scripts/check-api-agent-parity.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'dashboard-semantic-gap',
        args: ['scripts/check-dashboard-control-plane.js', '--scenario', 'edit-delete-semantic-gap'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'migration-hardening',
        args: ['scripts/check-migration-hardening.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'session-lifecycle',
        args: ['scripts/check-session-lifecycle.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'autonomy-v2-decision',
        args: ['scripts/check-autonomy-v2-decision.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'autonomy-v2-watchdog',
        args: ['scripts/check-autonomy-v2-watchdog.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'autonomy-v2-execution',
        args: ['scripts/check-autonomy-v2-execution.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'agent-contract-advisory',
        args: ['scripts/check-agent-contract-advisory.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'managed-team-integration',
        args: ['scripts/check-managed-team-integration.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'lifecycle-hooks',
        args: ['scripts/check-lifecycle-hooks.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'markdown-workspace-safety',
        args: ['scripts/check-markdown-workspace-safety.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'docs-onboarding',
        args: ['scripts/check-docs-onboarding.js'],
        expectedExitCode: 0,
      }),
      Object.freeze({
        label: 'docs-onboarding-stale-reference',
        args: ['scripts/check-docs-onboarding.js', '--simulate-stale', 'launcher_lan'],
        expectedExitCode: 1,
      }),
    ]),
  }),
});

function fail(lines, exitCode = 1) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  if (argv.length !== 1) {
    fail([USAGE], 2);
  }

  const suiteName = argv[0];
  if (!SUITES[suiteName]) {
    fail([
      `Unknown verification suite: ${suiteName}`,
      `Supported suites: ${Object.keys(SUITES).join(', ')}`,
      USAGE,
    ], 2);
  }

  return suiteName;
}

function formatCapturedOutput(label, output) {
  if (!output || !output.trim()) return [];
  return [
    `  ${label}:`,
    ...output.trimEnd().split(/\r?\n/).map((line) => `    ${line}`),
  ];
}

function runStep(step) {
  const result = spawnSync(process.execPath, step.args, {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });

  return {
    status: typeof result.status === 'number' ? result.status : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    error: result.error || null,
  };
}

function main() {
  const suiteName = parseArgs(process.argv.slice(2));
  const suite = SUITES[suiteName];
  const successLines = [suite.title];

  for (const step of suite.steps) {
    const result = runStep(step);

    if (result.error) {
      fail([
        `${suite.title} failed.`,
        `Step: ${step.label}`,
        `Command: node ${step.args.join(' ')}`,
        `Process error: ${result.error.message}`,
        ...formatCapturedOutput('stdout', result.stdout),
        ...formatCapturedOutput('stderr', result.stderr),
      ]);
    }

    if (result.status !== step.expectedExitCode) {
      fail([
        `${suite.title} failed.`,
        `Step: ${step.label}`,
        `Command: node ${step.args.join(' ')}`,
        `Expected exit code: ${step.expectedExitCode}`,
        `Actual exit code: ${result.status === null ? 'null' : result.status}`,
        ...formatCapturedOutput('stdout', result.stdout),
        ...formatCapturedOutput('stderr', result.stderr),
      ]);
    }

    successLines.push(`- ${step.label} (exit ${step.expectedExitCode} as expected)`);
  }

  successLines.push(suite.successLine);
  console.log(successLines.join('\n'));
}

main();
