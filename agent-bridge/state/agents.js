function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createAgentsState(options = {}) {
  const {
    io,
    agentsFile,
    profilesFile,
    heartbeatFile,
    lockAgentsFile,
    unlockAgentsFile,
    withAgentsFileLock,
    processPid,
  } = options;

  function withAgentsLock(fn) {
    if (typeof withAgentsFileLock === 'function') {
      return withAgentsFileLock(fn);
    }
    if (typeof lockAgentsFile === 'function') lockAgentsFile();
    try {
      return fn();
    } finally {
      if (typeof unlockAgentsFile === 'function') unlockAgentsFile();
    }
  }

  function saveAgents(agents) {
    io.writeJson(agentsFile, agents, { cacheKey: 'agents' });
    return agents;
  }

  function readProfiles() {
    if (!profilesFile) return {};
    return io.readJsonFile(profilesFile, {}) || {};
  }

  function saveProfiles(profiles) {
    if (!profilesFile) return profiles;
    io.writeJson(profilesFile, profiles, { cacheKey: 'profiles', space: 2 });
    return profiles;
  }

  function readAgent(name) {
    if (!name) return null;
    const agents = io.readJsonFile(agentsFile, {}) || {};
    return agents[name] ? cloneJsonValue(agents[name]) : null;
  }

  function touchHeartbeat(name, at = new Date().toISOString()) {
    if (!name) return;

    io.writeJson(heartbeatFile(name), {
      last_activity: at,
      pid: processPid,
    });

    return {
      last_activity: at,
      pid: processPid,
    };
  }

  function updateAgent(name, updater) {
    if (!name) return false;

    return withAgentsLock(() => {
      const agents = io.readJsonFile(agentsFile, {}) || {};
      if (!agents[name]) return false;

      updater(agents[name], agents);
      saveAgents(agents);
      return cloneJsonValue(agents[name]);
    });
  }

  function setAgent(name, value) {
    if (!name) return null;

    return withAgentsLock(() => {
      const agents = io.readJsonFile(agentsFile, {}) || {};
      agents[name] = value;
      saveAgents(agents);
      return cloneJsonValue(agents[name]);
    });
  }

  function removeAgent(name) {
    if (!name) return false;

    return withAgentsLock(() => {
      const agents = io.readJsonFile(agentsFile, {}) || {};
      if (!agents[name]) return false;
      const removed = cloneJsonValue(agents[name]);
      delete agents[name];
      saveAgents(agents);
      return removed;
    });
  }

  function updateProfile(name, updater) {
    if (!name || !profilesFile) return null;

    return io.withLock(profilesFile, () => {
      const profiles = readProfiles();
      if (!profiles[name]) profiles[name] = {};
      updater(profiles[name], profiles);
      saveProfiles(profiles);
      return profiles[name];
    });
  }

  function deleteProfile(name) {
    if (!name || !profilesFile) return false;

    return io.withLock(profilesFile, () => {
      const profiles = readProfiles();
      if (!profiles[name]) return false;
      delete profiles[name];
      saveProfiles(profiles);
      return true;
    });
  }

  function setListeningState(name, isListening, at = new Date().toISOString()) {
    return updateAgent(name, (agent) => {
      agent.listening_since = isListening ? at : null;
      // Stamp last_listened_at on BOTH start and stop. On start this records
      // "we're listening right now"; on stop it records "we were listening
      // up to this moment" so callers can apply a recency grace window
      // rather than treating every brief listen-return as "working".
      agent.last_listened_at = at;
    });
  }

  function setBranch(name, branchName, at = new Date().toISOString()) {
    return updateAgent(name, (agent) => {
      agent.branch = branchName;
      agent.last_activity = at;
    });
  }

  return {
    saveAgents,
    saveProfiles,
    readProfiles,
    readAgent,
    touchHeartbeat,
    updateAgent,
    setAgent,
    removeAgent,
    updateProfile,
    deleteProfile,
    setListeningState,
    setBranch,
    withAgentsLock,
  };
}

module.exports = { createAgentsState };
