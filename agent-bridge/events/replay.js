const CANONICAL_REPLAY_ERROR_CODES = Object.freeze({
  INVALID_JSONL: 'canonical_replay.invalid_jsonl',
  INVALID_EVENT: 'canonical_replay.invalid_event',
  INVALID_SEQUENCE: 'canonical_replay.invalid_sequence',
  MISSING_CANONICAL_STREAM: 'canonical_replay.missing_canonical_stream',
});

function createCanonicalReplayError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'CanonicalReplayError';
  error.code = code;

  if (details && typeof details === 'object' && !Array.isArray(details)) {
    Object.assign(error, details);
  }

  return error;
}

function isCanonicalReplayError(error) {
  return Boolean(
    error
      && error.name === 'CanonicalReplayError'
      && typeof error.code === 'string'
      && Object.values(CANONICAL_REPLAY_ERROR_CODES).includes(error.code)
  );
}

module.exports = {
  CANONICAL_REPLAY_ERROR_CODES,
  createCanonicalReplayError,
  isCanonicalReplayError,
};
