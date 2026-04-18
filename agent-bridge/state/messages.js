const fs = require('fs');
const path = require('path');

const {
  CANONICAL_REPLAY_ERROR_CODES,
  createCanonicalReplayError,
} = require('../events/replay');
const { EVENT_STREAMS, validateCanonicalEvent } = require('../events/schema');

function createMessagesState(options = {}) {
  const { io } = options;

  function readJsonlLines(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw.trim()) return [];
    return raw.split(/\r?\n/).filter(Boolean);
  }

  function writeJsonlLines(filePath, lines) {
    io.ensureDataDir();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, lines.join('\n') + (lines.length ? '\n' : ''));
    return lines;
  }

  function cloneJsonValue(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function createConversationProjection() {
    return {
      messages: [],
      history: [],
    };
  }

  function createScopedConversationProjection() {
    return {
      branch: createConversationProjection(),
      channels: {},
    };
  }

  function resolveMessageChannelName(message, fallbackChannel = null) {
    const rawChannel = typeof fallbackChannel === 'string'
      ? fallbackChannel
      : (message && typeof message.channel === 'string' ? message.channel : '');
    const channel = typeof rawChannel === 'string' ? rawChannel.trim() : '';
    return channel && channel !== 'general' ? channel : null;
  }

  function getConversationProjectionForChannel(projection, channelName) {
    if (!channelName) return projection.branch;
    if (!projection.channels[channelName]) {
      projection.channels[channelName] = createConversationProjection();
    }
    return projection.channels[channelName];
  }

  function listProjectionChannelNames(projection) {
    return Object.keys(projection.channels || {}).sort();
  }

  function findProjectedMessageRecord(projection, messageId) {
    if (!messageId) return null;

    const scopes = [
      { channel: null, conversation: projection.branch },
      ...listProjectionChannelNames(projection).map((channelName) => ({
        channel: channelName,
        conversation: projection.channels[channelName],
      })),
    ];

    for (const scope of scopes) {
      const conversation = scope.conversation;
      const messageIndex = conversation.messages.findIndex((message) => message && message.id === messageId);
      const historyIndex = conversation.history.findIndex((message) => message && message.id === messageId);
      if (messageIndex === -1 && historyIndex === -1) continue;

      return {
        channel: scope.channel,
        conversation,
        messageIndex,
        historyIndex,
        message: messageIndex >= 0 ? conversation.messages[messageIndex] : null,
        historyMessage: historyIndex >= 0 ? conversation.history[historyIndex] : null,
      };
    }

    return null;
  }

  function applyMessageCorrection(message, content, editedAt, options = {}) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return;

    if (options.includeHistory) {
      if (!Array.isArray(message.edit_history)) message.edit_history = [];
      message.edit_history.push({
        content: message.content,
        edited_at: editedAt,
      });
      if (message.edit_history.length > options.maxEditHistory) {
        message.edit_history = message.edit_history.slice(-options.maxEditHistory);
      }
    }

    message.content = content;
    message.edited = true;
    message.edited_at = editedAt;
  }

  function validateCanonicalMessageCorrectionPayload(event) {
    const payload = event && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : null;
    if (!payload || typeof payload.message_id !== 'string' || payload.message_id.length === 0) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.corrected canonical events require payload.message_id to be a non-empty string.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
        }
      );
    }

    if (typeof payload.content !== 'string') {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.corrected canonical events require payload.content to be a string.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
          message_id: payload.message_id,
        }
      );
    }

    if ('edited_at' in payload && (typeof payload.edited_at !== 'string' || payload.edited_at.length === 0)) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.corrected canonical events require payload.edited_at to be a non-empty string when provided.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
          message_id: payload.message_id,
        }
      );
    }

    if ('max_edit_history' in payload && (!Number.isInteger(payload.max_edit_history) || payload.max_edit_history <= 0)) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.corrected canonical events require payload.max_edit_history to be a positive integer when provided.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
          message_id: payload.message_id,
        }
      );
    }

    return {
      messageId: payload.message_id,
      content: payload.content,
      editedAt: typeof payload.edited_at === 'string' && payload.edited_at ? payload.edited_at : event.occurred_at,
      maxEditHistory: Number.isInteger(payload.max_edit_history) && payload.max_edit_history > 0
        ? payload.max_edit_history
        : 10,
    };
  }

  function validateCanonicalMessageRedactionPayload(event) {
    const payload = event && event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload
      : null;
    if (!payload || typeof payload.message_id !== 'string' || payload.message_id.length === 0) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.redacted canonical events require payload.message_id to be a non-empty string.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
        }
      );
    }

    if ('redacted_at' in payload && (typeof payload.redacted_at !== 'string' || payload.redacted_at.length === 0)) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.redacted canonical events require payload.redacted_at to be a non-empty string when provided.`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
          message_id: payload.message_id,
        }
      );
    }

    return {
      messageId: payload.message_id,
    };
  }

  function buildConversationProjectionFromEvents(events) {
    const projection = createScopedConversationProjection();
    let eventsApplied = 0;

    const replayEvents = Array.isArray(events)
      ? events.filter((event) => event && typeof event.type === 'string' && event.type.startsWith('message.'))
      : [];

    validateCanonicalMessageReplayEvents(replayEvents);

    for (const event of replayEvents) {
      applyCanonicalMessageEvent(projection, event);
      eventsApplied += 1;
    }

    return {
      projection,
      eventsApplied,
    };
  }

  function describeReplayEvent(event) {
    const type = event && typeof event.type === 'string' ? event.type : 'unknown';
    const seq = event && Number.isInteger(event.seq) ? event.seq : 'unknown';
    return `seq ${seq} (${type})`;
  }

  function validateCanonicalMessageReplayEvents(events) {
    let previousEvent = null;
    let replayBranchId = null;

    for (const event of Array.isArray(events) ? events : []) {
      const validation = validateCanonicalEvent(event);
      if (!validation.ok) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
          `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: ${validation.problems.join('; ')}`,
          {
            event_type: event && event.type,
            seq: event && event.seq,
            branch_id: event && event.branch_id,
            problems: validation.problems,
          }
        );
      }

      if (event.stream !== EVENT_STREAMS.BRANCH) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
          `Canonical message replay requires branch-scoped events, received ${describeReplayEvent(event)} on ${String(event.stream)}.`,
          {
            event_type: event.type,
            seq: event.seq,
            branch_id: event.branch_id,
            stream: event.stream,
          }
        );
      }

      if (!event.type.startsWith('message.')) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
          `Canonical message replay only accepts message.* events, received ${describeReplayEvent(event)}.`,
          {
            event_type: event.type,
            seq: event.seq,
            branch_id: event.branch_id,
          }
        );
      }

      if (replayBranchId === null) {
        replayBranchId = event.branch_id;
      } else if (event.branch_id !== replayBranchId) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_SEQUENCE,
          `Canonical message replay cannot mix branch streams: saw branch ${String(event.branch_id)} after branch ${String(replayBranchId)}.`,
          {
            previous_branch_id: replayBranchId,
            branch_id: event.branch_id,
            event_type: event.type,
            seq: event.seq,
          }
        );
      }

      if (previousEvent && event.seq <= previousEvent.seq) {
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_SEQUENCE,
          `Canonical message replay requires strictly increasing seq values for branch ${event.branch_id}: saw seq ${event.seq} after seq ${previousEvent.seq}.`,
          {
            previous_seq: previousEvent.seq,
            seq: event.seq,
            event_type: event.type,
            branch_id: event.branch_id,
          }
        );
      }

      previousEvent = event;
    }
  }

  function applyCanonicalMessageEvent(projection, event) {
    const validation = validateCanonicalEvent(event);
    if (!validation.ok) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: ${validation.problems.join('; ')}`,
        {
          event_type: event && event.type,
          seq: event && event.seq,
          branch_id: event && event.branch_id,
          problems: validation.problems,
        }
      );
    }

    if (event.stream !== EVENT_STREAMS.BRANCH) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
        `Canonical message replay requires branch-scoped events, received ${describeReplayEvent(event)} on ${String(event.stream)}.`,
        {
          event_type: event.type,
          seq: event.seq,
          branch_id: event.branch_id,
          stream: event.stream,
        }
      );
    }

    switch (event.type) {
      case 'message.sent': {
        const message = event.payload && event.payload.message;
        if (!message || typeof message !== 'object' || Array.isArray(message)) {
          throw createCanonicalReplayError(
            CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
            `Canonical message replay rejected invalid event ${describeReplayEvent(event)}: message.sent canonical events require payload.message to be an object.`,
            {
              event_type: event.type,
              seq: event.seq,
              branch_id: event.branch_id,
            }
          );
        }

        const channelName = resolveMessageChannelName(message);
        const conversation = getConversationProjectionForChannel(projection, channelName);
        conversation.messages.push(cloneJsonValue(message));
        conversation.history.push(cloneJsonValue(message));
        return projection;
      }

      case 'message.corrected': {
        const correction = validateCanonicalMessageCorrectionPayload(event);
        const record = findProjectedMessageRecord(projection, correction.messageId);
        if (!record) {
          throw createCanonicalReplayError(
            CANONICAL_REPLAY_ERROR_CODES.INVALID_SEQUENCE,
            `Canonical message replay cannot apply ${describeReplayEvent(event)} because message ${correction.messageId} does not exist in the current branch projection.`,
            {
              event_type: event.type,
              seq: event.seq,
              branch_id: event.branch_id,
              message_id: correction.messageId,
            }
          );
        }

        if (record.messageIndex >= 0) {
          applyMessageCorrection(record.message, correction.content, correction.editedAt, {
            includeHistory: false,
            maxEditHistory: correction.maxEditHistory,
          });
        }
        if (record.historyIndex >= 0) {
          applyMessageCorrection(record.historyMessage, correction.content, correction.editedAt, {
            includeHistory: true,
            maxEditHistory: correction.maxEditHistory,
          });
        }
        return projection;
      }

      case 'message.redacted': {
        const redaction = validateCanonicalMessageRedactionPayload(event);
        const record = findProjectedMessageRecord(projection, redaction.messageId);
        // Redaction is idempotent: if the message is already gone from the
        // projection (e.g. a prior message.redacted for the same id already
        // ran during this replay), the second redaction is a no-op rather
        // than a fatal error. The canonical log can legitimately carry
        // multiple redaction events per id — operators running Clear
        // Messages repeatedly on the same branch would produce that shape,
        // and aborting the whole replay over it is worse than ignoring the
        // duplicate.
        if (!record) return projection;

        if (record.messageIndex >= 0) {
          record.conversation.messages.splice(record.messageIndex, 1);
        }
        if (record.historyIndex >= 0) {
          record.conversation.history.splice(record.historyIndex, 1);
        }
        if (
          record.channel
          && record.conversation.messages.length === 0
          && record.conversation.history.length === 0
        ) {
          delete projection.channels[record.channel];
        }
        return projection;
      }

      default:
        throw createCanonicalReplayError(
          CANONICAL_REPLAY_ERROR_CODES.INVALID_EVENT,
          `Unknown canonical message event type: ${String(event.type)}`,
          {
            event_type: event.type,
            seq: event.seq,
            branch_id: event.branch_id,
          }
        );
    }
  }

  function materializeConversationProjection(projection, targets) {
    const branchTargets = targets && targets.branch
      ? targets.branch
      : targets;
    if (!branchTargets || !branchTargets.messageFile || !branchTargets.historyFile) {
      throw new Error('materializeConversationProjection requires branch messageFile and historyFile');
    }

    const configuredChannels = targets && targets.channels && typeof targets.channels === 'object' && !Array.isArray(targets.channels)
      ? targets.channels
      : {};
    const resolveChannelTargets = targets && typeof targets.getChannelTargets === 'function'
      ? targets.getChannelTargets
      : null;
    const allChannelNames = new Set([
      ...Object.keys(configuredChannels),
      ...listProjectionChannelNames(projection),
    ]);

    const writeConversation = (conversationProjection, conversationTargets) => {
      const messageLines = conversationProjection.messages.map((message) => JSON.stringify(message));
      const historyLines = conversationProjection.history.map((message) => JSON.stringify(message));

      io.withLock(conversationTargets.historyFile, () => {
        io.withLock(conversationTargets.messageFile, () => {
          writeJsonlLines(conversationTargets.historyFile, historyLines);
          writeJsonlLines(conversationTargets.messageFile, messageLines);
        });
      });
    };

    writeConversation(projection.branch, branchTargets);

    for (const channelName of [...allChannelNames].sort()) {
      const channelTargets = configuredChannels[channelName]
        || (resolveChannelTargets ? resolveChannelTargets(channelName) : null);
      if (!channelTargets || !channelTargets.messageFile || !channelTargets.historyFile) continue;
      writeConversation(
        projection.channels[channelName] || createConversationProjection(),
        channelTargets
      );
    }

    return {
      message_count: projection.branch.messages.length,
      history_count: projection.branch.history.length,
    };
  }

  function rebuildConversationProjectionsFromEvents(events, targets) {
    const { projection, eventsApplied } = buildConversationProjectionFromEvents(events);
    const counts = materializeConversationProjection(projection, targets);
    return {
      events_applied: eventsApplied,
      message_count: counts.message_count,
      history_count: counts.history_count,
    };
  }

  function getConversationMessageFromEvents(events, messageId) {
    const { projection } = buildConversationProjectionFromEvents(events);
    const record = findProjectedMessageRecord(projection, messageId);
    if (!record) return null;
    const message = record.message || record.historyMessage;
    if (!message) return null;

    return {
      channel: record.channel,
      message: cloneJsonValue(message),
    };
  }

  function appendConversationMessage(message, targets) {
    if (!targets || !targets.messageFile || !targets.historyFile) {
      throw new Error('appendConversationMessage requires messageFile and historyFile');
    }

    io.withLock(targets.historyFile, () => {
      io.withLock(targets.messageFile, () => {
        io.appendJsonl(targets.messageFile, message);
        io.appendJsonl(targets.historyFile, message);
      });
    });

    return message;
  }

  function appendAuxiliaryMessage(message, filePath) {
    if (!filePath) {
      throw new Error('appendAuxiliaryMessage requires a file path');
    }

    io.appendJsonl(filePath, message);
    return message;
  }

  function editConversationMessage(messageId, content, targets, options = {}) {
    if (!messageId) {
      throw new Error('editConversationMessage requires a message id');
    }
    if (!targets || !targets.messageFile || !targets.historyFile) {
      throw new Error('editConversationMessage requires messageFile and historyFile');
    }

    const maxEditHistory = options.maxEditHistory || 10;
    const editedAt = options.editedAt || new Date().toISOString();
    let found = false;

    io.withLock(targets.historyFile, () => {
      const lines = readJsonlLines(targets.historyFile);
      if (lines.length === 0) return;

      const updated = lines.map((line) => {
        try {
          const message = JSON.parse(line);
          if (message.id !== messageId) return line;

          found = true;
          if (!Array.isArray(message.edit_history)) message.edit_history = [];
          message.edit_history.push({ content: message.content, edited_at: editedAt });
          if (message.edit_history.length > maxEditHistory) {
            message.edit_history = message.edit_history.slice(-maxEditHistory);
          }
          message.content = content;
          message.edited = true;
          message.edited_at = editedAt;
          return JSON.stringify(message);
        } catch {
          return line;
        }
      });

      if (found) writeJsonlLines(targets.historyFile, updated);
    });

    if (!found) return null;

    io.withLock(targets.messageFile, () => {
      const lines = readJsonlLines(targets.messageFile);
      if (lines.length === 0) return;

      const updated = lines.map((line) => {
        try {
          const message = JSON.parse(line);
          if (message.id !== messageId) return line;
          message.content = content;
          message.edited = true;
          message.edited_at = editedAt;
          return JSON.stringify(message);
        } catch {
          return line;
        }
      });

      writeJsonlLines(targets.messageFile, updated);
    });

    return { id: messageId, edited_at: editedAt };
  }

  function deleteConversationMessage(messageId, targets, options = {}) {
    if (!messageId) {
      throw new Error('deleteConversationMessage requires a message id');
    }
    if (!targets || !targets.messageFile || !targets.historyFile) {
      throw new Error('deleteConversationMessage requires messageFile and historyFile');
    }

    const allowedFrom = Array.isArray(options.allowedFrom) ? options.allowedFrom : null;
    let found = false;
    let denied = false;
    let messageFrom = null;

    io.withLock(targets.historyFile, () => {
      const lines = readJsonlLines(targets.historyFile);
      if (lines.length === 0) return;

      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.id === messageId) {
            found = true;
            messageFrom = message.from || null;
            break;
          }
        } catch {}
      }

      if (!found) return;
      if (allowedFrom && !allowedFrom.includes(messageFrom)) {
        denied = true;
        return;
      }

      const filtered = lines.filter((line) => {
        try { return JSON.parse(line).id !== messageId; } catch { return true; }
      });
      writeJsonlLines(targets.historyFile, filtered);
    });

    if (!found || denied) {
      return { found, denied, from: messageFrom };
    }

    io.withLock(targets.messageFile, () => {
      const lines = readJsonlLines(targets.messageFile);
      const filtered = lines.filter((line) => {
        try { return JSON.parse(line).id !== messageId; } catch { return true; }
      });
      writeJsonlLines(targets.messageFile, filtered);
    });

    return { found: true, deleted: true, from: messageFrom };
  }

  return {
    appendConversationMessage,
    appendAuxiliaryMessage,
    applyCanonicalMessageEvent,
    materializeConversationProjection,
    rebuildConversationProjectionsFromEvents,
    getConversationMessageFromEvents,
    editConversationMessage,
    deleteConversationMessage,
  };
}

module.exports = { createMessagesState };
