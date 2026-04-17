const EVENT_STREAMS = Object.freeze({
  RUNTIME: 'runtime',
  BRANCH: 'branch',
});

const CANONICAL_EVENT_SCHEMA_VERSION = 1;

const REQUIRED_EVENT_ENVELOPE_FIELDS = Object.freeze([
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
]);

const DEFAULT_COLLABORATION_STREAM = EVENT_STREAMS.BRANCH;

const EVENT_SCOPE_SPLIT = Object.freeze({
  defaultStream: DEFAULT_COLLABORATION_STREAM,
  runtimeGlobalFamilies: Object.freeze([
    'agent',
    'profile',
    'lock',
    'branch',
    'migration',
  ]),
  branchLocalFamilies: Object.freeze([
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
  ]),
});

function resolveFamilyStream(family) {
  return EVENT_SCOPE_SPLIT.runtimeGlobalFamilies.includes(family)
    ? EVENT_STREAMS.RUNTIME
    : EVENT_SCOPE_SPLIT.defaultStream;
}

function freezeFamilyDefinition(definition) {
  return Object.freeze({
    family: definition.family,
    scope: definition.scope,
    projectionTargets: Object.freeze([...definition.projectionTargets]),
    types: Object.freeze([...definition.types]),
    summary: definition.summary,
  });
}

const FAMILY_DEFINITIONS = Object.freeze([
  freezeFamilyDefinition({
    family: 'agent',
    scope: resolveFamilyStream('agent'),
    projectionTargets: ['agents-index', 'sessions-index'],
    types: [
      'agent.registered',
      'agent.unregistered',
      'agent.status_updated',
      'agent.heartbeat_recorded',
      'agent.branch_assigned',
      'agent.listening_updated',
    ],
    summary: 'Runtime-global agent identity, liveness, and branch-assignment state.',
  }),
  freezeFamilyDefinition({
    family: 'profile',
    scope: resolveFamilyStream('profile'),
    projectionTargets: ['profiles'],
    types: ['profile.updated'],
    summary: 'Runtime-global agent profile updates.',
  }),
  freezeFamilyDefinition({
    family: 'lock',
    scope: resolveFamilyStream('lock'),
    projectionTargets: ['locks'],
    types: ['lock.acquired', 'lock.released'],
    summary: 'Runtime-global file lock ownership with branch/session context when present.',
  }),
  freezeFamilyDefinition({
    family: 'branch',
    scope: resolveFamilyStream('branch'),
    projectionTargets: ['branch-index'],
    types: ['branch.created'],
    summary: 'Runtime-global branch registry lifecycle.',
  }),
  freezeFamilyDefinition({
    family: 'migration',
    scope: resolveFamilyStream('migration'),
    projectionTargets: ['manifest'],
    types: ['migration.started', 'migration.completed', 'migration.failed'],
    summary: 'Runtime-global storage/runtime migration metadata.',
  }),
  freezeFamilyDefinition({
    family: 'session',
    scope: resolveFamilyStream('session'),
    projectionTargets: ['sessions', 'sessions-index'],
    types: [
      'session.started',
      'session.resumed',
      'session.interrupted',
      'session.completed',
      'session.failed',
      'session.abandoned',
    ],
    summary: 'Branch-scoped agent execution lifecycle and recovery state.',
  }),
  freezeFamilyDefinition({
    family: 'conversation',
    scope: resolveFamilyStream('conversation'),
    projectionTargets: ['conversation'],
    types: [
      'conversation.mode_updated',
      'conversation.channel_joined',
      'conversation.channel_left',
      'conversation.manager_claimed',
      'conversation.phase_updated',
      'conversation.floor_yielded',
    ],
    summary: 'Branch-local conversation mode, channel, and managed-floor state.',
  }),
  freezeFamilyDefinition({
    family: 'message',
    scope: resolveFamilyStream('message'),
    projectionTargets: ['messages', 'history'],
    types: ['message.sent', 'message.corrected', 'message.redacted'],
    summary: 'Branch-local collaboration message stream and historical corrections.',
  }),
  freezeFamilyDefinition({
    family: 'task',
    scope: resolveFamilyStream('task'),
    projectionTargets: ['tasks'],
    types: ['task.created', 'task.updated', 'task.claimed', 'task.completed'],
    summary: 'Branch-local task planning and status transitions.',
  }),
  freezeFamilyDefinition({
    family: 'workflow',
    scope: resolveFamilyStream('workflow'),
    projectionTargets: ['workflows'],
    types: [
      'workflow.created',
      'workflow.step_started',
      'workflow.step_completed',
      'workflow.step_reassigned',
      'workflow.completed',
      'workflow.paused',
      'workflow.resumed',
      'workflow.stopped',
    ],
    summary: 'Branch-local workflow lifecycle and step handoff state.',
  }),
  freezeFamilyDefinition({
    family: 'workspace',
    scope: resolveFamilyStream('workspace'),
    projectionTargets: ['workspaces'],
    types: ['workspace.written'],
    summary: 'Branch-local per-agent workspace and memory materialization.',
  }),
  freezeFamilyDefinition({
    family: 'decision',
    scope: resolveFamilyStream('decision'),
    projectionTargets: ['decisions'],
    types: ['decision.logged'],
    summary: 'Branch-local decision log entries.',
  }),
  freezeFamilyDefinition({
    family: 'kb',
    scope: resolveFamilyStream('kb'),
    projectionTargets: ['kb'],
    types: ['kb.written'],
    summary: 'Branch-local shared knowledge base entries.',
  }),
  freezeFamilyDefinition({
    family: 'review',
    scope: resolveFamilyStream('review'),
    projectionTargets: ['reviews'],
    types: ['review.requested', 'review.submitted'],
    summary: 'Branch-local review requests and review results.',
  }),
  freezeFamilyDefinition({
    family: 'dependency',
    scope: resolveFamilyStream('dependency'),
    projectionTargets: ['dependencies'],
    types: ['dependency.declared', 'dependency.resolved'],
    summary: 'Branch-local blocked-work dependency graph changes.',
  }),
  freezeFamilyDefinition({
    family: 'vote',
    scope: resolveFamilyStream('vote'),
    projectionTargets: ['votes'],
    types: ['vote.called', 'vote.cast', 'vote.resolved'],
    summary: 'Branch-local governance votes and outcomes.',
  }),
  freezeFamilyDefinition({
    family: 'rule',
    scope: resolveFamilyStream('rule'),
    projectionTargets: ['rules'],
    types: ['rule.added', 'rule.toggled', 'rule.removed'],
    summary: 'Branch-local project rule lifecycle.',
  }),
  freezeFamilyDefinition({
    family: 'progress',
    scope: resolveFamilyStream('progress'),
    projectionTargets: ['progress'],
    types: ['progress.updated'],
    summary: 'Branch-local feature progress reporting.',
  }),
  freezeFamilyDefinition({
    family: 'evidence',
    scope: resolveFamilyStream('evidence'),
    projectionTargets: ['evidence'],
    types: ['evidence.recorded'],
    summary: 'Branch-local evidence records backing completion and advancement claims.',
  }),
]);

const EVENT_FAMILY_REGISTRY = Object.freeze(
  Object.fromEntries(FAMILY_DEFINITIONS.map((definition) => [definition.family, definition]))
);

const EVENT_TYPE_REGISTRY = Object.freeze(
  Object.fromEntries(
    FAMILY_DEFINITIONS.flatMap((definition) =>
      definition.types.map((type) => [
        type,
        Object.freeze({
          type,
          family: definition.family,
          scope: definition.scope,
          projectionTargets: definition.projectionTargets,
        }),
      ])
    )
  )
);

function getEventFamily(type) {
  if (typeof type !== 'string') return null;
  const separatorIndex = type.indexOf('.');
  return separatorIndex === -1 ? null : type.slice(0, separatorIndex);
}

function getEventFamilyDefinition(family) {
  return EVENT_FAMILY_REGISTRY[family] || null;
}

function getEventTypeDefinition(type) {
  return EVENT_TYPE_REGISTRY[type] || null;
}

function resolveTypeStream(type) {
  const definition = getEventTypeDefinition(type);
  if (definition) return definition.scope;
  const family = getEventFamily(type);
  return family ? resolveFamilyStream(family) : null;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateMessageSentPayload(payload) {
  const problems = [];
  if (!isPlainObject(payload)) {
    problems.push('message.sent events require payload to be an object.');
    return problems;
  }

  if (!isPlainObject(payload.message)) {
    problems.push('message.sent events require payload.message to be an object.');
  }

  return problems;
}

function validateMessageCorrectedPayload(payload) {
  const problems = [];
  if (!isPlainObject(payload)) {
    problems.push('message.corrected events require payload to be an object.');
    return problems;
  }

  if (typeof payload.message_id !== 'string' || payload.message_id.length === 0) {
    problems.push('message.corrected events require payload.message_id to be a non-empty string.');
  }
  if (typeof payload.content !== 'string') {
    problems.push('message.corrected events require payload.content to be a string.');
  }
  if ('edited_at' in payload && (typeof payload.edited_at !== 'string' || payload.edited_at.length === 0)) {
    problems.push('message.corrected events require payload.edited_at to be a non-empty string when provided.');
  }
  if ('max_edit_history' in payload && (!Number.isInteger(payload.max_edit_history) || payload.max_edit_history <= 0)) {
    problems.push('message.corrected events require payload.max_edit_history to be a positive integer when provided.');
  }

  return problems;
}

function validateMessageRedactedPayload(payload) {
  const problems = [];
  if (!isPlainObject(payload)) {
    problems.push('message.redacted events require payload to be an object.');
    return problems;
  }

  if (typeof payload.message_id !== 'string' || payload.message_id.length === 0) {
    problems.push('message.redacted events require payload.message_id to be a non-empty string.');
  }
  if ('redacted_at' in payload && (typeof payload.redacted_at !== 'string' || payload.redacted_at.length === 0)) {
    problems.push('message.redacted events require payload.redacted_at to be a non-empty string when provided.');
  }

  return problems;
}

function validateEventPayload(type, payload) {
  switch (type) {
    case 'message.sent':
      return validateMessageSentPayload(payload);
    case 'message.corrected':
      return validateMessageCorrectedPayload(payload);
    case 'message.redacted':
      return validateMessageRedactedPayload(payload);
    default:
      return [];
  }
}

/**
 * @typedef {'runtime' | 'branch'} CanonicalEventStream
 */

/**
 * @typedef {Object} CanonicalEvent
 * @property {string} event_id
 * @property {CanonicalEventStream} stream
 * @property {string | null} branch_id
 * @property {number} seq
 * @property {string} type
 * @property {string} occurred_at
 * @property {number} schema_version
 * @property {string} actor_agent
 * @property {string | null} session_id
 * @property {string | null} command_id
 * @property {string | null} causation_id
 * @property {string | null} correlation_id
 * @property {*} payload
 */

function validateCanonicalEvent(event) {
  const problems = [];

  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return {
      ok: false,
      problems: ['Canonical event must be an object.'],
      definition: null,
    };
  }

  for (const field of REQUIRED_EVENT_ENVELOPE_FIELDS) {
    if (!(field in event)) {
      problems.push(`Missing required envelope field: ${field}`);
    }
  }

  if (!Object.values(EVENT_STREAMS).includes(event.stream)) {
    problems.push(`Invalid event stream: ${String(event.stream)}`);
  }

  if (!Number.isInteger(event.seq) || event.seq < 0) {
    problems.push('seq must be a non-negative integer.');
  }

  const definition = getEventTypeDefinition(event.type);
  if (!definition) {
    problems.push(`Unknown canonical event type: ${String(event.type)}`);
  } else if (event.stream !== definition.scope) {
    problems.push(`Event type ${event.type} belongs on the ${definition.scope} stream, received ${String(event.stream)}.`);
  }

  if (event.stream === EVENT_STREAMS.BRANCH && !event.branch_id) {
    problems.push('Branch stream events must include branch_id.');
  }

  if (event.schema_version !== CANONICAL_EVENT_SCHEMA_VERSION) {
    problems.push(`schema_version must equal ${CANONICAL_EVENT_SCHEMA_VERSION}.`);
  }

  problems.push(...validateEventPayload(event.type, event.payload));

  return {
    ok: problems.length === 0,
    problems,
    definition,
  };
}

module.exports = {
  CANONICAL_EVENT_SCHEMA_VERSION,
  DEFAULT_COLLABORATION_STREAM,
  EVENT_FAMILY_REGISTRY,
  EVENT_SCOPE_SPLIT,
  EVENT_STREAMS,
  EVENT_TYPE_REGISTRY,
  FAMILY_DEFINITIONS,
  REQUIRED_EVENT_ENVELOPE_FIELDS,
  getEventFamily,
  getEventFamilyDefinition,
  getEventTypeDefinition,
  resolveFamilyStream,
  resolveTypeStream,
  validateCanonicalEvent,
};
