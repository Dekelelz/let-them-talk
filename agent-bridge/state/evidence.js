const EVIDENCE_STORE_SCHEMA_VERSION = 1;

function normalizeEvidenceStore(store) {
  return {
    schema_version: EVIDENCE_STORE_SCHEMA_VERSION,
    updated_at: store && store.updated_at ? store.updated_at : null,
    records: Array.isArray(store && store.records) ? [...store.records] : [],
  };
}

function createEvidenceState(options = {}) {
  const { io } = options;

  if (!io) throw new Error('createEvidenceState requires io');

  function readEvidenceStore(filePath) {
    return normalizeEvidenceStore(io.readJsonFile(filePath, null));
  }

  function saveEvidenceStore(filePath, store, writeOptions = {}) {
    return io.withLock(filePath, () => io.writeJson(filePath, normalizeEvidenceStore(store), {
      space: writeOptions.space,
    }));
  }

  function mutateEvidence(filePath, mutator, writeOptions = {}) {
    return io.withLock(filePath, () => {
      const store = readEvidenceStore(filePath);
      const result = mutator(store);
      io.writeJson(filePath, store, {
        space: writeOptions.space,
      });
      return result;
    });
  }

  function findEvidenceRecord(filePath, evidenceId) {
    if (!evidenceId) return null;
    const store = readEvidenceStore(filePath);
    return store.records.find((record) => record && record.evidence_id === evidenceId) || null;
  }

  return {
    EVIDENCE_STORE_SCHEMA_VERSION,
    findEvidenceRecord,
    mutateEvidence,
    readEvidenceStore,
    saveEvidenceStore,
  };
}

module.exports = {
  EVIDENCE_STORE_SCHEMA_VERSION,
  createEvidenceState,
  normalizeEvidenceStore,
};
