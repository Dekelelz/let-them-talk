#!/usr/bin/env node

const path = require('path');

const schema = require(path.resolve(__dirname, '..', 'events', 'schema.js'));

const EXPECTED_EVENT_ENVELOPE_FIELDS = [
  'event_id',
  'stream',
  'branch_id',
  'seq',
  'type',
  'occurred_at',
  'schema_version',
  'actor_agent',
  'session_id',
  'command_id',
  'causation_id',
  'correlation_id',
  'payload',
];

const EXPECTED_RUNTIME_GLOBAL_FAMILIES = [
  'agent',
  'profile',
  'lock',
  'branch',
  'migration',
];

const EXPECTED_BRANCH_LOCAL_FAMILIES = [
  'session',
  'conversation',
  'message',
  'task',
  'workflow',
  'workspace',
  'decision',
  'kb',
  'review',
  'dependency',
  'vote',
  'rule',
  'progress',
  'evidence',
];

const EXPECTED_EVENT_TYPES = [
  'agent.registered',
  'agent.unregistered',
  'agent.status_updated',
  'agent.heartbeat_recorded',
  'agent.branch_assigned',
  'agent.listening_updated',
  'profile.updated',
  'lock.acquired',
  'lock.released',
  'branch.created',
  'migration.started',
  'migration.completed',
  'migration.failed',
  'session.started',
  'session.resumed',
  'session.interrupted',
  'session.completed',
  'session.failed',
  'session.abandoned',
  'conversation.mode_updated',
  'conversation.channel_joined',
  'conversation.channel_left',
  'conversation.manager_claimed',
  'conversation.phase_updated',
  'conversation.floor_yielded',
  'message.sent',
  'message.corrected',
  'message.redacted',
  'task.created',
  'task.updated',
  'task.claimed',
  'task.completed',
  'workflow.created',
  'workflow.step_started',
  'workflow.step_completed',
  'workflow.step_reassigned',
  'workflow.completed',
  'workflow.paused',
  'workflow.resumed',
  'workflow.stopped',
  'workspace.written',
  'decision.logged',
  'kb.written',
  'review.requested',
  'review.submitted',
  'dependency.declared',
  'dependency.resolved',
  'vote.called',
  'vote.cast',
  'vote.resolved',
  'rule.added',
  'rule.toggled',
  'rule.removed',
  'progress.updated',
  'evidence.recorded',
];

function fail(lines) {
  console.error(lines.join('\n'));
  process.exit(1);
}

function ensureIncludesAll(problems, actualValues, expectedValues, label) {
  const actualSet = new Set(actualValues);
  for (const expected of expectedValues) {
    if (!actualSet.has(expected)) {
      problems.push(`${label} is missing: ${expected}`);
    }
  }
}

function buildSampleEvent(type) {
  const stream = schema.resolveTypeStream(type);
  let payload = {};
  if (type === 'message.sent') {
    payload = {
      message: {
        id: 'msg_task3a_sample',
        from: 'schema-alpha',
        to: 'schema-beta',
        content: 'schema sample message',
        timestamp: '2026-04-15T00:00:00.000Z',
      },
    };
  } else if (type === 'message.corrected') {
    payload = {
      message_id: 'msg_task3a_sample',
      content: 'schema sample edit',
      edited_at: '2026-04-15T00:01:00.000Z',
      max_edit_history: 10,
    };
  } else if (type === 'message.redacted') {
    payload = {
      message_id: 'msg_task3a_sample',
      redacted_at: '2026-04-15T00:02:00.000Z',
    };
  }

  return {
    event_id: 'evt_task3a_sample',
    stream,
    branch_id: stream === schema.EVENT_STREAMS.BRANCH ? 'main' : null,
    seq: 1,
    type,
    occurred_at: '2026-04-15T00:00:00.000Z',
    schema_version: schema.CANONICAL_EVENT_SCHEMA_VERSION,
    actor_agent: 'task3a-validator',
    session_id: stream === schema.EVENT_STREAMS.BRANCH ? 'session_task3a' : null,
    command_id: 'cmd_task3a',
    causation_id: null,
    correlation_id: null,
    payload,
    extra_field_kept_for_future_replay: true,
  };
}

function main() {
  const problems = [];

  ensureIncludesAll(
    problems,
    schema.REQUIRED_EVENT_ENVELOPE_FIELDS,
    EXPECTED_EVENT_ENVELOPE_FIELDS,
    'Required event envelope field'
  );

  if (schema.DEFAULT_COLLABORATION_STREAM !== schema.EVENT_STREAMS.BRANCH) {
    problems.push('Collaboration event default stream must be branch.');
  }

  ensureIncludesAll(
    problems,
    schema.EVENT_SCOPE_SPLIT.runtimeGlobalFamilies,
    EXPECTED_RUNTIME_GLOBAL_FAMILIES,
    'Runtime-global family'
  );

  ensureIncludesAll(
    problems,
    schema.EVENT_SCOPE_SPLIT.branchLocalFamilies,
    EXPECTED_BRANCH_LOCAL_FAMILIES,
    'Branch-local family'
  );

  for (const family of EXPECTED_RUNTIME_GLOBAL_FAMILIES) {
    const definition = schema.EVENT_FAMILY_REGISTRY[family];
    if (!definition) {
      problems.push(`Missing family registry entry: ${family}`);
      continue;
    }
    if (definition.scope !== schema.EVENT_STREAMS.RUNTIME) {
      problems.push(`Family ${family} must resolve to runtime scope.`);
    }
    if (!Array.isArray(definition.types) || definition.types.length === 0) {
      problems.push(`Family ${family} must register at least one event type.`);
    }
  }

  for (const family of EXPECTED_BRANCH_LOCAL_FAMILIES) {
    const definition = schema.EVENT_FAMILY_REGISTRY[family];
    if (!definition) {
      problems.push(`Missing family registry entry: ${family}`);
      continue;
    }
    if (definition.scope !== schema.EVENT_STREAMS.BRANCH) {
      problems.push(`Family ${family} must resolve to branch scope.`);
    }
    if (!Array.isArray(definition.types) || definition.types.length === 0) {
      problems.push(`Family ${family} must register at least one event type.`);
    }
  }

  ensureIncludesAll(
    problems,
    Object.keys(schema.EVENT_TYPE_REGISTRY),
    EXPECTED_EVENT_TYPES,
    'Required canonical event type'
  );

  for (const type of EXPECTED_EVENT_TYPES) {
    const definition = schema.EVENT_TYPE_REGISTRY[type];
    if (!definition) continue;

    const familyDefinition = schema.EVENT_FAMILY_REGISTRY[definition.family];
    if (!familyDefinition) {
      problems.push(`Event type ${type} points at unknown family ${definition.family}.`);
      continue;
    }

    if (definition.scope !== familyDefinition.scope) {
      problems.push(`Event type ${type} has scope ${definition.scope}, but family ${definition.family} is ${familyDefinition.scope}.`);
    }

    const validation = schema.validateCanonicalEvent(buildSampleEvent(type));
    if (!validation.ok) {
      problems.push(`Sample event for ${type} failed validation: ${validation.problems.join('; ')}`);
    }
  }

  const invalidCorrectionValidation = schema.validateCanonicalEvent({
    ...buildSampleEvent('message.corrected'),
    payload: {
      message_id: 'msg_task3a_sample',
      content: 42,
    },
  });
  if (invalidCorrectionValidation.ok || !invalidCorrectionValidation.problems.some((problem) => problem.includes('payload.content'))) {
    problems.push('message.corrected payload validation must reject non-string payload.content values.');
  }

  if (problems.length > 0) {
    fail([
      'Canonical event schema validation failed.',
      ...problems.map((problem) => `- ${problem}`),
    ]);
  }

  console.log([
    'Canonical event schema validation passed.',
    `Envelope fields checked: ${EXPECTED_EVENT_ENVELOPE_FIELDS.length}`,
    `Runtime-global families checked: ${EXPECTED_RUNTIME_GLOBAL_FAMILIES.length}`,
    `Branch-local families checked: ${EXPECTED_BRANCH_LOCAL_FAMILIES.length}`,
    `Seed event types checked: ${EXPECTED_EVENT_TYPES.length}`,
    'Branch-local collaboration default: branch',
  ].join('\n'));
}

main();
