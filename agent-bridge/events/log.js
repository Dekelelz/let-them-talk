const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  CANONICAL_EVENT_SCHEMA_VERSION,
  EVENT_STREAMS,
  resolveTypeStream,
  validateCanonicalEvent,
} = require('./schema');
const {
  CANONICAL_REPLAY_ERROR_CODES,
  createCanonicalReplayError,
} = require('./replay');

const EVENT_STREAM_HEAD_SCHEMA_VERSION = 1;

function defaultSanitizeBranchName(branchName) {
  if (!branchName || branchName === 'main') return 'main';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(branchName)) {
    throw new Error('Invalid branch name');
  }
  return branchName;
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJsonlObjects(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];

  const raw = fs.readFileSync(filePath, 'utf8');
  if (!raw.trim()) return [];

  return raw
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_JSONL,
          `Canonical event replay rejected invalid JSONL at ${filePath}:${index + 1} (${error.message})`,
          {
            file_path: filePath,
            line_number: index + 1,
          }
        );
      }
    });
}

function readJsonObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function readLastJsonlObject(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;

  const stats = fs.statSync(filePath);
  if (stats.size === 0) return null;

  const fd = fs.openSync(filePath, 'r');
  const byte = Buffer.alloc(1);

  try {
    let position = stats.size - 1;

    while (position >= 0) {
      fs.readSync(fd, byte, 0, 1, position);
      if (byte[0] !== 0x0a && byte[0] !== 0x0d) break;
      position -= 1;
    }

    if (position < 0) return null;

    const lineEnd = position + 1;
    while (position >= 0) {
      fs.readSync(fd, byte, 0, 1, position);
      if (byte[0] === 0x0a || byte[0] === 0x0d) break;
      position -= 1;
    }

    const lineStart = position + 1;
    const lineLength = lineEnd - lineStart;
    const lineBuffer = Buffer.alloc(lineLength);
    fs.readSync(fd, lineBuffer, 0, lineLength, lineStart);

    try {
      return JSON.parse(lineBuffer.toString('utf8'));
    } catch (error) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_JSONL,
        `Canonical event replay rejected invalid JSONL near the tail of ${filePath} (${error.message})`,
        {
          file_path: filePath,
        }
      );
    }
  } finally {
    fs.closeSync(fd);
  }
}

function readFileFingerprint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return {
      exists: false,
      size: 0,
      mtime_ms: 0,
    };
  }

  const stats = fs.statSync(filePath);
  return {
    exists: true,
    size: stats.size,
    mtime_ms: stats.mtimeMs,
  };
}

function sameFileFingerprint(left, right) {
  return !!left
    && !!right
    && left.exists === right.exists
    && left.size === right.size
    && left.mtime_ms === right.mtime_ms;
}

function normalizeHeadFingerprint(head) {
  return {
    exists: !!head.file_exists,
    size: Number.isInteger(head.file_size) ? head.file_size : 0,
    mtime_ms: Number.isFinite(head.file_mtime_ms) ? head.file_mtime_ms : 0,
  };
}

function normalizeEventStreamHead(head) {
  if (!head || typeof head !== 'object' || Array.isArray(head)) return null;
  if (head.schema_version !== EVENT_STREAM_HEAD_SCHEMA_VERSION) return null;
  if (!Object.values(EVENT_STREAMS).includes(head.stream)) return null;
  if (!Number.isInteger(head.last_seq) || head.last_seq < 0) return null;
  if (!Number.isInteger(head.event_count) || head.event_count < 0) return null;

  return {
    schema_version: EVENT_STREAM_HEAD_SCHEMA_VERSION,
    stream: head.stream,
    branch_id: head.stream === EVENT_STREAMS.BRANCH ? (head.branch_id || 'main') : null,
    last_seq: head.last_seq,
    event_count: head.event_count,
    last_event_id: typeof head.last_event_id === 'string' ? head.last_event_id : null,
    last_event_type: typeof head.last_event_type === 'string' ? head.last_event_type : null,
    last_occurred_at: typeof head.last_occurred_at === 'string' ? head.last_occurred_at : null,
    file_exists: !!head.file_exists,
    file_size: Number.isInteger(head.file_size) ? head.file_size : 0,
    file_mtime_ms: Number.isFinite(head.file_mtime_ms) ? head.file_mtime_ms : 0,
    updated_at: typeof head.updated_at === 'string' ? head.updated_at : null,
  };
}

function buildEventStreamHead(params = {}) {
  const {
    stream,
    branchId = null,
    fingerprint,
    lastEvent = null,
    eventCount = 0,
    updatedAt = null,
  } = params;

  return {
    schema_version: EVENT_STREAM_HEAD_SCHEMA_VERSION,
    stream,
    branch_id: stream === EVENT_STREAMS.BRANCH ? (branchId || 'main') : null,
    last_seq: lastEvent && Number.isInteger(lastEvent.seq) ? lastEvent.seq : 0,
    event_count: Number.isInteger(eventCount) ? eventCount : 0,
    last_event_id: lastEvent && typeof lastEvent.event_id === 'string' ? lastEvent.event_id : null,
    last_event_type: lastEvent && typeof lastEvent.type === 'string' ? lastEvent.type : null,
    last_occurred_at: lastEvent && typeof lastEvent.occurred_at === 'string' ? lastEvent.occurred_at : null,
    file_exists: !!(fingerprint && fingerprint.exists),
    file_size: fingerprint && Number.isInteger(fingerprint.size) ? fingerprint.size : 0,
    file_mtime_ms: fingerprint && Number.isFinite(fingerprint.mtime_ms) ? fingerprint.mtime_ms : 0,
    updated_at: updatedAt,
  };
}

function createCanonicalEventLog(options = {}) {
  const {
    dataDir,
    withLock,
    onCommitted = null,
    sanitizeBranchName = defaultSanitizeBranchName,
    createEventId = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
  } = options;
  const streamHeadCache = new Map();

  function runWithLock(filePath, fn) {
    if (typeof withLock === 'function') {
      return withLock(filePath, fn);
    }
    return fn();
  }

  function getRuntimeEventsFile() {
    return path.join(dataDir, 'runtime', 'events.jsonl');
  }

  function getBranchEventsFile(branchName = 'main') {
    return path.join(dataDir, 'runtime', 'branches', sanitizeBranchName(branchName), 'events.jsonl');
  }

  function getRuntimeEventsHeadFile() {
    return path.join(dataDir, 'runtime', 'events.head.json');
  }

  function getBranchEventsHeadFile(branchName = 'main') {
    return path.join(dataDir, 'runtime', 'branches', sanitizeBranchName(branchName), 'events.head.json');
  }

  function getEventsFile(stream, branchId) {
    if (stream === EVENT_STREAMS.RUNTIME) {
      return getRuntimeEventsFile();
    }

    if (stream === EVENT_STREAMS.BRANCH) {
      return getBranchEventsFile(branchId || 'main');
    }

    throw new Error(`Unsupported canonical event stream: ${String(stream)}`);
  }

  function getEventsHeadFile(stream, branchId) {
    if (stream === EVENT_STREAMS.RUNTIME) {
      return getRuntimeEventsHeadFile();
    }

    if (stream === EVENT_STREAMS.BRANCH) {
      return getBranchEventsHeadFile(branchId || 'main');
    }

    throw new Error(`Unsupported canonical event stream: ${String(stream)}`);
  }

  function cacheStreamHead(headFile, head) {
    const normalized = normalizeEventStreamHead(head);
    if (!normalized) {
      streamHeadCache.delete(headFile);
      return null;
    }

    streamHeadCache.set(headFile, {
      head: normalized,
      fingerprint: normalizeHeadFingerprint(normalized),
    });
    return normalized;
  }

  function writeStreamHead(headFile, head) {
    const normalized = cacheStreamHead(headFile, head);
    if (!normalized) return null;
    fs.mkdirSync(path.dirname(headFile), { recursive: true });
    fs.writeFileSync(headFile, JSON.stringify(normalized, null, 2));
    return normalized;
  }

  function scanEventsHead(stream, branchId, eventFile, headFile, updatedAt) {
    const events = readJsonlObjects(eventFile);
    const lastEvent = events.length > 0 ? events[events.length - 1] : null;
    const head = buildEventStreamHead({
      stream,
      branchId,
      fingerprint: readFileFingerprint(eventFile),
      lastEvent,
      eventCount: events.length,
      updatedAt,
    });
    return writeStreamHead(headFile, head);
  }

  function repairEventsHeadFromTail(stream, branchId, eventFile, headFile, updatedAt) {
    try {
      const lastEvent = readLastJsonlObject(eventFile);
      const fingerprint = readFileFingerprint(eventFile);

      if (!lastEvent) {
        return writeStreamHead(headFile, buildEventStreamHead({
          stream,
          branchId,
          fingerprint,
          eventCount: 0,
          updatedAt,
        }));
      }

      if (!Number.isInteger(lastEvent.seq)
        || lastEvent.seq < 1
        || lastEvent.stream !== stream
        || (stream === EVENT_STREAMS.BRANCH && lastEvent.branch_id !== branchId)
        || (stream === EVENT_STREAMS.RUNTIME && lastEvent.branch_id !== null)) {
        return null;
      }

      return writeStreamHead(headFile, buildEventStreamHead({
        stream,
        branchId,
        fingerprint,
        lastEvent,
        eventCount: lastEvent.seq,
        updatedAt,
      }));
    } catch {
      return null;
    }
  }

  function getEventsHead(params = {}) {
    const stream = params.stream || EVENT_STREAMS.BRANCH;
    const branchId = stream === EVENT_STREAMS.BRANCH
      ? sanitizeBranchName(params.branchId || params.branch_id || 'main')
      : null;
    const eventFile = getEventsFile(stream, branchId);
    const headFile = getEventsHeadFile(stream, branchId);
    const currentFingerprint = readFileFingerprint(eventFile);
    const cached = streamHeadCache.get(headFile);

    if (cached && sameFileFingerprint(cached.fingerprint, currentFingerprint)) {
      return cloneJsonValue(cached.head);
    }

    const persisted = normalizeEventStreamHead(readJsonObject(headFile));
    if (persisted
      && persisted.stream === stream
      && persisted.branch_id === (stream === EVENT_STREAMS.BRANCH ? branchId : null)
      && sameFileFingerprint(normalizeHeadFingerprint(persisted), currentFingerprint)) {
      cacheStreamHead(headFile, persisted);
      return cloneJsonValue(persisted);
    }

    const repairedFromTail = repairEventsHeadFromTail(stream, branchId, eventFile, headFile, params.at || now());
    if (repairedFromTail) {
      return cloneJsonValue(repairedFromTail);
    }

    return cloneJsonValue(scanEventsHead(stream, branchId, eventFile, headFile, params.at || now()));
  }

  function appendEvent(params = {}) {
    const stream = params.stream || resolveTypeStream(params.type);
    if (!stream) {
      throw new Error(`Cannot resolve canonical event stream for type: ${String(params.type)}`);
    }

    const branchId = stream === EVENT_STREAMS.BRANCH
      ? sanitizeBranchName(params.branchId || params.branch_id || 'main')
      : null;
    const eventFile = getEventsFile(stream, branchId);
    const headFile = getEventsHeadFile(stream, branchId);

    return runWithLock(eventFile, () => {
      fs.mkdirSync(path.dirname(eventFile), { recursive: true });

      const currentHead = getEventsHead({ stream, branchId, at: params.occurredAt || params.occurred_at || now() });
      const lastSeq = currentHead && Number.isInteger(currentHead.last_seq) ? currentHead.last_seq : 0;
      const event = {
        event_id: params.eventId || params.event_id || createEventId(),
        stream,
        branch_id: branchId,
        seq: lastSeq + 1,
        type: params.type,
        occurred_at: params.occurredAt || params.occurred_at || now(),
        schema_version: params.schemaVersion || params.schema_version || CANONICAL_EVENT_SCHEMA_VERSION,
        actor_agent: params.actorAgent || params.actor_agent || 'system',
        session_id: params.sessionId || params.session_id || null,
        command_id: params.commandId || params.command_id || null,
        causation_id: params.causationId || params.causation_id || null,
        correlation_id: params.correlationId || params.correlation_id || null,
        payload: cloneJsonValue(params.payload === undefined ? {} : params.payload),
      };

      if (params.extra && typeof params.extra === 'object' && !Array.isArray(params.extra)) {
        Object.assign(event, cloneJsonValue(params.extra));
      }

      const validation = validateCanonicalEvent(event);
      if (!validation.ok) {
        throw new Error(`Invalid canonical event ${String(params.type)}: ${validation.problems.join('; ')}`);
      }

      fs.appendFileSync(eventFile, JSON.stringify(event) + '\n');
      writeStreamHead(headFile, buildEventStreamHead({
        stream,
        branchId,
        fingerprint: readFileFingerprint(eventFile),
        lastEvent: event,
        eventCount: (currentHead && Number.isInteger(currentHead.event_count) ? currentHead.event_count : 0) + 1,
        updatedAt: event.occurred_at,
      }));
      if (typeof onCommitted === 'function') {
        try {
          onCommitted(cloneJsonValue(event));
        } catch {}
      }
      return event;
    });
  }

  function readEvents(params = {}) {
    const stream = params.stream || EVENT_STREAMS.BRANCH;
    const branchId = stream === EVENT_STREAMS.BRANCH
      ? sanitizeBranchName(params.branchId || params.branch_id || 'main')
      : null;
    const eventFile = getEventsFile(stream, branchId);
    const events = readJsonlObjects(eventFile);

    if (Array.isArray(params.types) && params.types.length > 0) {
      const typeSet = new Set(params.types);
      return events.filter((event) => typeSet.has(event.type));
    }

    if (params.typePrefix) {
      return events.filter((event) => typeof event.type === 'string' && event.type.startsWith(params.typePrefix));
    }

    return events;
  }

  function readBranchEvents(branchName = 'main', options = {}) {
    return readEvents({
      ...options,
      stream: EVENT_STREAMS.BRANCH,
      branchId: branchName,
    });
  }

  return {
    appendEvent,
    getBranchEventsHeadFile,
    getRuntimeEventsFile,
    getRuntimeEventsHeadFile,
    getBranchEventsFile,
    getEventsHead,
    readEvents,
    readBranchEvents,
  };
}

module.exports = { createCanonicalEventLog };
