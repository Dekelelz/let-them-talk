const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { createDefaultContractMetadata } = require('../agent-contracts');

const { createCanonicalEventLog } = require('../events/log');
const { createCanonicalHookState } = require('../events/hooks');
const { createStateIo } = require('./io');
const { createMessagesState } = require('./messages');
const { createAgentsState } = require('./agents');
const { createEvidenceState } = require('./evidence');
const { createDashboardQueries } = require('./dashboard-queries');
const {
  DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME,
  exportMarkdownWorkspace,
} = require('./markdown-workspace');
const { createSessionsState } = require('./sessions');
const { createTasksWorkflowsState } = require('./tasks-workflows');
const {
  CANONICAL_REPLAY_ERROR_CODES,
  createCanonicalReplayError,
} = require('../events/replay');

function sanitizeBranchName(branchName) {
  if (!branchName || branchName === 'main') return 'main';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(branchName)) {
    throw new Error('Invalid branch name');
  }
  return branchName;
}

function sanitizeScopedName(name, label = 'name', maxLength = 64) {
  if (typeof name !== 'string' || name.length < 1 || name.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid ${label}`);
  }
  return name;
}

function createBranchPathResolvers(dataDir) {
  const messagesFile = path.join(dataDir, 'messages.jsonl');
  const historyFile = path.join(dataDir, 'history.jsonl');
  const runtimeDir = path.join(dataDir, 'runtime');
  const runtimeProjectionsDir = path.join(runtimeDir, 'projections');
  const agentsFile = path.join(dataDir, 'agents.json');
  const acksFile = path.join(dataDir, 'acks.json');
  const tasksFile = path.join(dataDir, 'tasks.json');
  const evidenceFile = path.join(dataDir, 'evidence.json');
  const profilesFile = path.join(dataDir, 'profiles.json');
  const workflowsFile = path.join(dataDir, 'workflows.json');
  const branchesFile = path.join(dataDir, 'branches.json');
  const readReceiptsFile = path.join(dataDir, 'read_receipts.json');
  const permissionsFile = path.join(dataDir, 'permissions.json');
  const configFile = path.join(dataDir, 'config.json');
  const channelsFile = path.join(dataDir, 'channels.json');
  const compressedFile = path.join(dataDir, 'compressed.json');
  const workspacesDir = path.join(dataDir, 'workspaces');
  const decisionsFile = path.join(dataDir, 'decisions.json');
  const kbFile = path.join(dataDir, 'kb.json');
  const reviewsFile = path.join(dataDir, 'reviews.json');
  const dependenciesFile = path.join(dataDir, 'dependencies.json');
  const votesFile = path.join(dataDir, 'votes.json');
  const rulesFile = path.join(dataDir, 'rules.json');
  const progressFile = path.join(dataDir, 'progress.json');

  function getScopedBranchFile(branchName, mainFilePath, branchSuffix) {
    const branch = sanitizeBranchName(branchName);
    return branch === 'main'
      ? mainFilePath
      : path.join(dataDir, `branch-${branch}-${branchSuffix}`);
  }

  function getMessagesFile(branchName = 'main') {
    return getScopedBranchFile(branchName, messagesFile, 'messages.jsonl');
  }

  function getHistoryFile(branchName = 'main') {
    return getScopedBranchFile(branchName, historyFile, 'history.jsonl');
  }

  function getAcksFile(branchName = 'main') {
    return getScopedBranchFile(branchName, acksFile, 'acks.json');
  }

  function getTasksFile(branchName = 'main') {
    return getScopedBranchFile(branchName, tasksFile, 'tasks.json');
  }

  function getWorkflowsFile(branchName = 'main') {
    return getScopedBranchFile(branchName, workflowsFile, 'workflows.json');
  }

  function getReadReceiptsFile(branchName = 'main') {
    return getScopedBranchFile(branchName, readReceiptsFile, 'read_receipts.json');
  }

  function getConfigFile(branchName = 'main') {
    return getScopedBranchFile(branchName, configFile, 'config.json');
  }

  function getChannelsFile(branchName = 'main') {
    return getScopedBranchFile(branchName, channelsFile, 'channels.json');
  }

  function getCompressedFile(branchName = 'main') {
    return getScopedBranchFile(branchName, compressedFile, 'compressed.json');
  }

  function getDecisionsFile(branchName = 'main') {
    return getScopedBranchFile(branchName, decisionsFile, 'decisions.json');
  }

  function getKnowledgeBaseFile(branchName = 'main') {
    return getScopedBranchFile(branchName, kbFile, 'kb.json');
  }

  function getReviewsFile(branchName = 'main') {
    return getScopedBranchFile(branchName, reviewsFile, 'reviews.json');
  }

  function getDependenciesFile(branchName = 'main') {
    return getScopedBranchFile(branchName, dependenciesFile, 'dependencies.json');
  }

  function getVotesFile(branchName = 'main') {
    return getScopedBranchFile(branchName, votesFile, 'votes.json');
  }

  function getRulesFile(branchName = 'main') {
    return getScopedBranchFile(branchName, rulesFile, 'rules.json');
  }

  function getProgressFile(branchName = 'main') {
    return getScopedBranchFile(branchName, progressFile, 'progress.json');
  }

  function getWorkspacesDir(branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    return branch === 'main'
      ? workspacesDir
      : path.join(dataDir, `branch-${branch}-workspaces`);
  }

  function getWorkspaceFile(agentName, branchName = 'main') {
    const agent = sanitizeScopedName(agentName, 'agent name', 20);
    return path.join(getWorkspacesDir(branchName), `${agent}.json`);
  }

  function getConsumedFile(agentName, branchName = 'main') {
    const agent = sanitizeScopedName(agentName, 'agent name');
    const branch = sanitizeBranchName(branchName);
    return branch === 'main'
      ? path.join(dataDir, `consumed-${agent}.json`)
      : path.join(dataDir, `branch-${branch}-consumed-${agent}.json`);
  }

  function getEvidenceFile(branchName = 'main') {
    return getScopedBranchFile(branchName, evidenceFile, 'evidence.json');
  }

  function getChannelMessagesFile(channelName, branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    if (!channelName || channelName === 'general') return getMessagesFile(branch);
    const channel = sanitizeScopedName(channelName, 'channel name');
    return branch === 'main'
      ? path.join(dataDir, `channel-${channel}-messages.jsonl`)
      : path.join(dataDir, `branch-${branch}-channel-${channel}-messages.jsonl`);
  }

  function getChannelHistoryFile(channelName, branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    if (!channelName || channelName === 'general') return getHistoryFile(branch);
    const channel = sanitizeScopedName(channelName, 'channel name');
    return branch === 'main'
      ? path.join(dataDir, `channel-${channel}-history.jsonl`)
      : path.join(dataDir, `branch-${branch}-channel-${channel}-history.jsonl`);
  }

  function getMessageTargets(branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    return {
      branch,
      messageFile: getMessagesFile(branch),
      historyFile: getHistoryFile(branch),
    };
  }

  function getRuntimeBranchDir(branchName = 'main') {
    return path.join(runtimeDir, 'branches', sanitizeBranchName(branchName));
  }

  function getBranchSessionsDir(branchName = 'main') {
    return path.join(getRuntimeBranchDir(branchName), 'sessions');
  }

  function getBranchSessionFile(sessionId, branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    const normalizedSessionId = sanitizeScopedName(sessionId, 'session id', 128);
    return path.join(getBranchSessionsDir(branch), `${normalizedSessionId}.json`);
  }

  function getSessionsIndexFile() {
    return path.join(runtimeProjectionsDir, 'sessions-index.json');
  }

  function getBranchDashboardProjectionFile(branchName = 'main') {
    return path.join(getRuntimeBranchDir(branchName), 'dashboard-query-projection.json');
  }

  return {
    messagesFile,
    historyFile,
    runtimeDir,
    runtimeProjectionsDir,
    agentsFile,
    acksFile,
    tasksFile,
    evidenceFile,
    profilesFile,
    workflowsFile,
    branchesFile,
    readReceiptsFile,
    permissionsFile,
    configFile,
    channelsFile,
    compressedFile,
    workspacesDir,
    decisionsFile,
    kbFile,
    reviewsFile,
    dependenciesFile,
    votesFile,
    rulesFile,
    progressFile,
    getMessagesFile,
    getHistoryFile,
    getAcksFile,
    getTasksFile,
    getWorkflowsFile,
    getReadReceiptsFile,
    getConfigFile,
    getChannelsFile,
    getCompressedFile,
    getDecisionsFile,
    getKnowledgeBaseFile,
    getReviewsFile,
    getDependenciesFile,
    getVotesFile,
    getRulesFile,
    getProgressFile,
    getWorkspacesDir,
    getWorkspaceFile,
    getConsumedFile,
    getEvidenceFile,
    getChannelMessagesFile,
    getChannelHistoryFile,
    getMessageTargets,
    getRuntimeBranchDir,
    getBranchSessionsDir,
    getBranchSessionFile,
    getSessionsIndexFile,
    getBranchDashboardProjectionFile,
  };
}

function createLockingFileHelper(processPid) {
  return function withFileLock(filePath, fn) {
    const lockPath = filePath + '.lock';
    const maxWait = 5000;
    const start = Date.now();
    let backoff = 1;
    let locked = false;

    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    while (Date.now() - start < maxWait) {
      try {
        fs.writeFileSync(lockPath, String(processPid), { flag: 'wx' });
        locked = true;
        break;
      } catch {}

      const waitStart = Date.now();
      while (Date.now() - waitStart < backoff) {}
      backoff = Math.min(backoff * 2, 500);
    }

    if (!locked) {
      let activeLockError = null;
      try {
        const lockPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (lockPid && lockPid !== processPid) {
          try {
            process.kill(lockPid, 0);
            throw new Error(`File is locked by active process ${lockPid}: ${filePath}`);
          } catch (error) {
            if (error.code !== 'ESRCH') activeLockError = error;
          }
        }
      } catch {}

      if (activeLockError) throw activeLockError;

      try { fs.unlinkSync(lockPath); } catch {}
      fs.writeFileSync(lockPath, String(processPid), { flag: 'wx' });
      locked = true;
    }

    try {
      return fn();
    } finally {
      if (locked) {
        try { fs.unlinkSync(lockPath); } catch {}
      }
    }
  };
}

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createEvidenceId() {
  return `evidence_${crypto.randomUUID()}`;
}

function createEvidenceReference(record, branch) {
  return {
    evidence_id: record.evidence_id,
    branch_id: branch,
    recorded_at: record.recorded_at,
    recorded_by_session: record.recorded_by_session,
  };
}

function buildVerificationProjection(record, evidenceRef) {
  return {
    evidence_ref: cloneJsonValue(evidenceRef),
    summary: record.summary,
    verification: record.verification,
    files_changed: Array.isArray(record.files_changed) ? [...record.files_changed] : [],
    confidence: record.confidence,
    learnings: record.learnings || null,
    verified_at: record.recorded_at,
    verified_by: record.recorded_by || null,
    recorded_by_session: record.recorded_by_session,
  };
}

function projectEvidenceRecord(record, evidenceRef) {
  return buildVerificationProjection(record, evidenceRef);
}

function findReadyWorkflowSteps(workflow) {
  return workflow.steps.filter((step) => {
    if (step.status !== 'pending') return false;
    if (!Array.isArray(step.depends_on) || step.depends_on.length === 0) return true;
    return step.depends_on.every((dependencyId) => {
      const dependency = workflow.steps.find((entry) => entry.id === dependencyId);
      return dependency && dependency.status === 'done';
    });
  });
}

function createCanonicalState(options = {}) {
  const {
    dataDir,
    processPid = process.pid,
    invalidateCache,
  } = options;

  const withFileLock = createLockingFileHelper(processPid);
  const io = createStateIo({ dataDir, invalidateCache, withFileLock });
  const branchPaths = createBranchPathResolvers(dataDir);
  const {
    messagesFile,
    historyFile,
    runtimeDir,
    agentsFile,
    acksFile,
    tasksFile,
    evidenceFile,
    profilesFile,
    workflowsFile,
    branchesFile,
    readReceiptsFile,
    permissionsFile,
    configFile,
    channelsFile,
    compressedFile,
    workspacesDir,
    decisionsFile,
    kbFile,
    reviewsFile,
    dependenciesFile,
    votesFile,
    rulesFile,
    progressFile,
    getMessagesFile,
    getHistoryFile,
    getConsumedFile,
    getEvidenceFile,
    getChannelMessagesFile,
    getChannelHistoryFile,
    getMessageTargets,
    getAcksFile,
    getTasksFile,
    getWorkflowsFile,
    getReadReceiptsFile,
    getConfigFile,
    getChannelsFile,
    getCompressedFile,
    getDecisionsFile,
    getKnowledgeBaseFile,
    getReviewsFile,
    getDependenciesFile,
    getVotesFile,
    getRulesFile,
    getProgressFile,
    getWorkspacesDir,
    getWorkspaceFile,
    getBranchSessionsDir,
    getSessionsIndexFile,
    getBranchDashboardProjectionFile,
  } = branchPaths;

  const messagesState = createMessagesState({ io });
  const canonicalHooks = createCanonicalHookState({
    dataDir,
    withLock: withFileLock,
    sanitizeBranchName,
  });
  const canonicalEventLog = createCanonicalEventLog({
    dataDir,
    withLock: withFileLock,
    onCommitted: (event) => canonicalHooks.projectCommittedEvent(event),
    sanitizeBranchName,
  });
  const agentsState = createAgentsState({
    io,
    agentsFile,
    profilesFile,
    heartbeatFile: (name) => path.join(dataDir, `heartbeat-${name}.json`),
    withAgentsFileLock: (fn) => withFileLock(agentsFile, fn),
    processPid,
  });
  const evidenceState = createEvidenceState({ io });
  const sessionsState = createSessionsState({
    io,
    branchPaths,
    canonicalEventLog,
  });
  const tasksWorkflowsState = createTasksWorkflowsState({
    io,
    tasksFile,
    workflowsFile,
    getTasksFile,
    getWorkflowsFile,
  });

  function readJson(filePath, fallback) {
    return io.readJsonFile(filePath, fallback);
  }

  function readArray(filePath) {
    const value = readJson(filePath, []);
    return Array.isArray(value) ? value : [];
  }

  function readObject(filePath) {
    const value = readJson(filePath, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  const dashboardQueries = createDashboardQueries({
    dataDir,
    readJson,
    agentsFile,
    profilesFile,
    getTasksFile,
    getWorkflowsFile,
    workspacesDir,
    getAcksFile,
    getHistoryFile,
    getChannelsFile,
    getChannelHistoryFile,
    getBranchDashboardProjectionFile,
    sanitizeBranchName,
  });

  function listAgents() {
    return dashboardQueries.listAgents();
  }

  function listProfiles() {
    return dashboardQueries.listProfiles();
  }

  function resolveBranchViewParam(params) {
    if (typeof params === 'string') {
      return sanitizeBranchName(params || 'main');
    }

    if (params && typeof params === 'object' && !Array.isArray(params)) {
      return sanitizeBranchName(params.branch || 'main');
    }

    return 'main';
  }

  function getBranchCacheKey(surface, branch) {
    return `${surface}:${sanitizeBranchName(branch || 'main')}`;
  }

  function readBranchArray(getFilePath, params = {}) {
    const branch = resolveBranchViewParam(params);
    return readArray(getFilePath(branch));
  }

  function readBranchObject(getFilePath, params = {}) {
    const branch = resolveBranchViewParam(params);
    return readObject(getFilePath(branch));
  }

  function listTasks(params = {}) {
    return dashboardQueries.listTasks(resolveBranchViewParam(params));
  }

  function listWorkflows(params = {}) {
    return dashboardQueries.listWorkflows(resolveBranchViewParam(params));
  }

  function getPlanStatusView(params = {}) {
    return dashboardQueries.getPlanStatusView({ branch: resolveBranchViewParam(params) });
  }

  function getPlanReportView(params = {}) {
    return dashboardQueries.getPlanReportView({ branch: resolveBranchViewParam(params) });
  }

  function getConversationConfigView(params = {}) {
    const branch = resolveBranchViewParam(params);
    return cloneJsonValue(readObject(getConfigFile(branch)));
  }

  function getLatestSessionSummaryForAgent(params = {}) {
    const branch = resolveBranchViewParam(params);
    const agentName = sanitizeScopedName(params.agentName || params.agent, 'agent name', 20);
    const summary = sessionsState.getLatestSessionSummaryForAgent(branch, agentName);
    return summary ? cloneJsonValue(summary) : null;
  }

  function upsertProfile(params = {}) {
    const name = sanitizeScopedName(params.name, 'agent name', 20);
    const updatedAt = params.updatedAt || new Date().toISOString();

    const profile = agentsState.updateProfile(name, (currentProfile) => {
      if (Object.keys(currentProfile).length === 0) {
        Object.assign(currentProfile, {
          display_name: name,
          bio: '',
          role: '',
          created_at: updatedAt,
        }, createDefaultContractMetadata());
      }

      if (params.displayName !== undefined) {
        currentProfile.display_name = String(params.displayName || name).substring(0, 30);
      }

      if (params.avatar !== undefined && params.avatar) {
        currentProfile.avatar = params.avatar;
      }

      if (params.bio !== undefined) {
        currentProfile.bio = String(params.bio || '').substring(0, 200);
      }

      if (params.role !== undefined) {
        currentProfile.role = String(params.role || '').substring(0, 30);
      }

      if (Object.prototype.hasOwnProperty.call(params, 'archetype')) {
        currentProfile.archetype = params.archetype || '';
      }

      if (Object.prototype.hasOwnProperty.call(params, 'skills')) {
        currentProfile.skills = Array.isArray(params.skills) ? cloneJsonValue(params.skills) : [];
      }

      if (Object.prototype.hasOwnProperty.call(params, 'contractMode')) {
        currentProfile.contract_mode = params.contractMode || '';
      }

      if (params.appearance && typeof params.appearance === 'object' && !Array.isArray(params.appearance)) {
        currentProfile.appearance = Object.assign(currentProfile.appearance || {}, cloneJsonValue(params.appearance));
      }

      currentProfile.updated_at = updatedAt;
    });

    if (profile) {
      appendCanonicalEvent({
        type: 'profile.updated',
        actorAgent: params.actorAgent || name,
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || name,
        payload: {
          agent_name: name,
          profile: cloneJsonValue(profile),
          updated_at: updatedAt,
        },
      });
    }

    return profile ? cloneJsonValue(profile) : null;
  }

  function listRules(params = {}) {
    return readBranchArray(getRulesFile, params);
  }

  function listDecisions(params = {}) {
    return readBranchArray(getDecisionsFile, params);
  }

  function readKnowledgeBase(params = {}) {
    return cloneJsonValue(readBranchObject(getKnowledgeBaseFile, params));
  }

  function listReviews(params = {}) {
    return readBranchArray(getReviewsFile, params);
  }

  function listDependencies(params = {}) {
    return readBranchArray(getDependenciesFile, params);
  }

  function listVotes(params = {}) {
    return readBranchArray(getVotesFile, params);
  }

  function readProgress(params = {}) {
    return cloneJsonValue(readBranchObject(getProgressFile, params));
  }

  function getProjectNotesView(params = {}) {
    const branch = resolveBranchViewParam(params);
    return {
      knowledge_base: readKnowledgeBase({ branch }),
      rules: listRules({ branch }),
      progress: readProgress({ branch }),
    };
  }

  function getTeamNotesView(params = {}) {
    const branch = resolveBranchViewParam(params);
    return {
      decisions: listDecisions({ branch }),
      reviews: listReviews({ branch }),
      dependencies: listDependencies({ branch }),
      votes: listVotes({ branch }),
    };
  }

  function mutateBranchArraySurface(getFilePath, surface, mutator, params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const filePath = getFilePath(branch);
    return io.withLock(filePath, () => {
      const entries = readArray(filePath);
      const result = mutator(entries, branch);
      io.writeJson(filePath, entries, {
        cacheKey: getBranchCacheKey(surface, branch),
        space: params.space === undefined ? 2 : params.space,
      });
      return result;
    });
  }

  function mutateReviews(mutator, params = {}) {
    return mutateBranchArraySurface(getReviewsFile, 'reviews', mutator, params);
  }

  function mutateDependencies(mutator, params = {}) {
    return mutateBranchArraySurface(getDependenciesFile, 'dependencies', mutator, params);
  }

  function readWorkspace(agentName, params = {}) {
    const agent = sanitizeScopedName(agentName, 'agent name', 20);
    const branch = resolveBranchViewParam(params);
    const filePath = getWorkspaceFile(agent, branch);
    const data = readJson(filePath, {});
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  }

  function listWorkspaces(params = {}) {
    const branch = resolveBranchViewParam(params);
    const directory = getWorkspacesDir(branch);
    if (!fs.existsSync(directory)) return [];

    return fs.readdirSync(directory)
      .filter((fileName) => fileName.endsWith('.json'))
      .map((fileName) => {
        const agent = fileName.replace(/\.json$/i, '');
        const data = readWorkspace(agent, { branch });
        return {
          agent,
          data,
          key_count: Object.keys(data).length,
        };
      })
      .sort((left, right) => left.agent.localeCompare(right.agent));
  }

  function addRule(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const rulesFilePath = getRulesFile(branch);
    const rule = cloneJsonValue(params.rule || null);
    if (!rule || typeof rule !== 'object' || !rule.id) {
      return { error: 'Rule payload is required.' };
    }

    let result = { error: 'Rule payload is required.' };
    io.withLock(rulesFilePath, () => {
      const rules = readArray(rulesFilePath);
      rules.push(rule);
      io.writeJson(rulesFilePath, rules, { cacheKey: getBranchCacheKey('rules', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'rule.added',
        branchId: branch,
        actorAgent: params.actor || rule.created_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || rule.id,
        payload: {
          rule_id: rule.id,
          text: rule.text || '',
          category: rule.category || 'custom',
          priority: rule.priority || 'normal',
          created_by: rule.created_by || null,
          created_at: rule.created_at || null,
          active: rule.active !== false,
        },
      });

      result = {
        success: true,
        rule: cloneJsonValue(rule),
        rule_event_id: event.event_id,
      };
    });

    return result;
  }

  function updateRule(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const rulesFilePath = getRulesFile(branch);
    let result = { error: 'Rule not found' };

    io.withLock(rulesFilePath, () => {
      const rules = readArray(rulesFilePath);
      const rule = rules.find((entry) => entry.id === params.ruleId);
      if (!rule) return;

      const previousActive = rule.active !== false;
      let changed = false;
      let activeChanged = false;

      if (Object.prototype.hasOwnProperty.call(params, 'text')) {
        rule.text = typeof params.text === 'string' ? params.text : rule.text;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'category')) {
        rule.category = params.category;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'priority')) {
        rule.priority = params.priority;
        changed = true;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'active')) {
        const nextActive = params.active !== false;
        activeChanged = previousActive !== nextActive;
        rule.active = nextActive;
        changed = true;
      }

      if (!changed) {
        result = { success: true, rule: cloneJsonValue(rule), rule_event_id: null };
        return;
      }

      const updatedAt = params.updatedAt || new Date().toISOString();
      rule.updated_at = updatedAt;
      io.writeJson(rulesFilePath, rules, { cacheKey: getBranchCacheKey('rules', branch), space: 2 });

      let event = null;
      if (activeChanged) {
        event = appendCanonicalEvent({
          type: 'rule.toggled',
          branchId: branch,
          actorAgent: params.actor || 'system',
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: params.causationId || null,
          correlationId: params.correlationId || rule.id,
          payload: {
            rule_id: rule.id,
            active: rule.active !== false,
            previous_active: previousActive,
            updated_at: updatedAt,
          },
        });
      }

      result = {
        success: true,
        rule: cloneJsonValue(rule),
        rule_event_id: event ? event.event_id : null,
      };
    });

    return result;
  }

  function toggleRule(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const rulesFilePath = getRulesFile(branch);
    let result = { error: 'Rule not found' };

    io.withLock(rulesFilePath, () => {
      const rules = readArray(rulesFilePath);
      const rule = rules.find((entry) => entry.id === params.ruleId);
      if (!rule) return;

      const previousActive = rule.active !== false;
      rule.active = !previousActive;
      rule.updated_at = params.updatedAt || new Date().toISOString();
      io.writeJson(rulesFilePath, rules, { cacheKey: getBranchCacheKey('rules', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'rule.toggled',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || rule.id,
        payload: {
          rule_id: rule.id,
          active: rule.active !== false,
          previous_active: previousActive,
          updated_at: rule.updated_at,
        },
      });

      result = {
        success: true,
        rule: cloneJsonValue(rule),
        rule_event_id: event.event_id,
      };
    });

    return result;
  }

  function removeRule(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const rulesFilePath = getRulesFile(branch);
    let result = { error: 'Rule not found' };

    io.withLock(rulesFilePath, () => {
      const rules = readArray(rulesFilePath);
      const index = rules.findIndex((entry) => entry.id === params.ruleId);
      if (index === -1) return;

      const removed = rules.splice(index, 1)[0];
      io.writeJson(rulesFilePath, rules, { cacheKey: getBranchCacheKey('rules', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'rule.removed',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || removed.id,
        payload: {
          rule_id: removed.id,
          text: removed.text || '',
          category: removed.category || 'custom',
          priority: removed.priority || 'normal',
          removed_by: params.actor || 'system',
          removed_at: params.removedAt || new Date().toISOString(),
        },
      });

      result = {
        success: true,
        rule: cloneJsonValue(removed),
        rule_event_id: event.event_id,
      };
    });

    return result;
  }

  function saveWorkspace(agentName, workspace, params = {}) {
    const agent = sanitizeScopedName(agentName, 'agent name', 20);
    const branch = sanitizeBranchName(params.branch || 'main');
    const nextWorkspace = workspace && typeof workspace === 'object' && !Array.isArray(workspace)
      ? cloneJsonValue(workspace)
      : {};
    const filePath = getWorkspaceFile(agent, branch);
    const updatedAt = params.updatedAt || new Date().toISOString();

    io.withLock(filePath, () => {
      fs.mkdirSync(getWorkspacesDir(branch), { recursive: true, mode: 0o700 });
      io.writeJson(filePath, nextWorkspace, { space: 2 });
    });

    const event = appendCanonicalEvent({
      type: 'workspace.written',
      branchId: branch,
      actorAgent: params.actor || agent,
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || agent,
      payload: {
        agent_name: agent,
        key: typeof params.key === 'string' ? params.key : null,
        keys: Array.isArray(params.keys) ? [...params.keys] : null,
        key_count: Object.keys(nextWorkspace).length,
        updated_at: updatedAt,
      },
    });

    return {
      workspace: cloneJsonValue(nextWorkspace),
      event,
    };
  }

  function logDecision(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const decisionsFilePath = getDecisionsFile(branch);
    const entry = cloneJsonValue(params.entry || null);
    if (!entry || typeof entry !== 'object' || !entry.id) {
      return { error: 'Decision payload is required.' };
    }

    let result = { error: 'Decision payload is required.' };
    io.withLock(decisionsFilePath, () => {
      const decisions = readArray(decisionsFilePath);
      decisions.push(entry);
      if (Number.isInteger(params.maxEntries) && params.maxEntries > 0 && decisions.length > params.maxEntries) {
        decisions.splice(0, decisions.length - params.maxEntries);
      }
      io.writeJson(decisionsFilePath, decisions, { cacheKey: getBranchCacheKey('decisions', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'decision.logged',
        branchId: branch,
        actorAgent: params.actor || entry.decided_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || entry.id,
        payload: {
          decision_id: entry.id,
          decision: entry.decision || '',
          topic: entry.topic || 'general',
          decided_by: entry.decided_by || null,
          decided_at: entry.decided_at || null,
        },
      });

      result = {
        success: true,
        entry: cloneJsonValue(entry),
        decision_event_id: event.event_id,
      };
    });

    return result;
  }

  function writeKnowledgeBaseEntry(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const kbFilePath = getKnowledgeBaseFile(branch);
    const key = typeof params.key === 'string' ? params.key : '';
    const value = cloneJsonValue(params.value || null);
    if (!key || !value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'Knowledge base entry is required.' };
    }

    let result = { error: 'Knowledge base entry is required.' };
    io.withLock(kbFilePath, () => {
      const kb = readObject(kbFilePath);
      kb[key] = value;
      if (Number.isInteger(params.maxEntries) && params.maxEntries > 0 && Object.keys(kb).length > params.maxEntries) {
        result = { error: `Knowledge base full (max ${params.maxEntries} keys)` };
        return;
      }

      io.writeJson(kbFilePath, kb, { cacheKey: getBranchCacheKey('kb', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'kb.written',
        branchId: branch,
        actorAgent: params.actor || value.updated_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || key,
        payload: {
          key,
          updated_by: value.updated_by || null,
          updated_at: value.updated_at || null,
          content_size: typeof value.content === 'string' ? Buffer.byteLength(value.content, 'utf8') : null,
        },
      });

      result = {
        success: true,
        key,
        entry: cloneJsonValue(value),
        total_keys: Object.keys(kb).length,
        kb_event_id: event.event_id,
      };
    });

    return result;
  }

  function updateProgressRecord(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const progressFilePath = getProgressFile(branch);
    const feature = typeof params.feature === 'string' ? params.feature : '';
    const value = cloneJsonValue(params.value || null);
    if (!feature || !value || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 'Progress payload is required.' };
    }

    let result = { error: 'Progress payload is required.' };
    io.withLock(progressFilePath, () => {
      const progress = readObject(progressFilePath);
      progress[feature] = value;
      io.writeJson(progressFilePath, progress, { cacheKey: getBranchCacheKey('progress', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'progress.updated',
        branchId: branch,
        actorAgent: params.actor || value.updated_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || feature,
        payload: {
          feature,
          percent: value.percent,
          notes: value.notes || '',
          updated_by: value.updated_by || null,
          updated_at: value.updated_at || null,
        },
      });

      result = {
        success: true,
        feature,
        entry: cloneJsonValue(value),
        progress_event_id: event.event_id,
      };
    });

    return result;
  }

  function createVote(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const votesFilePath = getVotesFile(branch);
    const vote = cloneJsonValue(params.vote || null);
    if (!vote || typeof vote !== 'object' || !vote.id) {
      return { error: 'Vote payload is required.' };
    }

    let result = { error: 'Vote payload is required.' };
    io.withLock(votesFilePath, () => {
      const votes = readArray(votesFilePath);
      if (Number.isInteger(params.maxEntries) && params.maxEntries > 0 && votes.length >= params.maxEntries) {
        result = { error: `Vote limit reached (max ${params.maxEntries}).` };
        return;
      }

      votes.push(vote);
      io.writeJson(votesFilePath, votes, { cacheKey: getBranchCacheKey('votes', branch), space: 2 });

      const event = appendCanonicalEvent({
        type: 'vote.called',
        branchId: branch,
        actorAgent: params.actor || vote.created_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || vote.id,
        payload: {
          vote_id: vote.id,
          question: vote.question || '',
          options: Array.isArray(vote.options) ? [...vote.options] : [],
          created_by: vote.created_by || null,
          created_at: vote.created_at || null,
          status: vote.status || null,
        },
      });

      result = {
        success: true,
        vote: cloneJsonValue(vote),
        vote_event_id: event.event_id,
      };
    });

    return result;
  }

  function castVote(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const votesFilePath = getVotesFile(branch);
    let result = { error: 'Vote not found' };

    io.withLock(votesFilePath, () => {
      const votes = readArray(votesFilePath);
      const vote = votes.find((entry) => entry.id === params.voteId);
      if (!vote) return;
      if (vote.status !== 'open') {
        result = { error: 'Vote is already closed.' };
        return;
      }
      if (!Array.isArray(vote.options) || !vote.options.includes(params.choice)) {
        result = { error: `Invalid choice. Options: ${(vote.options || []).join(', ')}` };
        return;
      }

      const votedAt = params.votedAt || new Date().toISOString();
      vote.votes = vote.votes && typeof vote.votes === 'object' && !Array.isArray(vote.votes) ? vote.votes : {};
      vote.votes[params.voter] = { choice: params.choice, voted_at: votedAt };

      const castEvent = appendCanonicalEvent({
        type: 'vote.cast',
        branchId: branch,
        actorAgent: params.actor || params.voter || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || vote.id,
        payload: {
          vote_id: vote.id,
          question: vote.question || '',
          voter: params.voter || null,
          choice: params.choice,
          voted_at: votedAt,
          votes_cast: Object.keys(vote.votes).length,
          status: vote.status,
        },
      });

      let resolvedEvent = null;
      const onlineAgents = Array.isArray(params.onlineAgents) ? params.onlineAgents : [];
      const allVoted = onlineAgents.length > 0 && onlineAgents.every((agentName) => vote.votes[agentName]);
      if (allVoted) {
        vote.status = 'closed';
        vote.closed_at = params.closedAt || new Date().toISOString();
        const results = {};
        for (const option of vote.options) results[option] = 0;
        for (const value of Object.values(vote.votes)) {
          if (value && Object.prototype.hasOwnProperty.call(results, value.choice)) results[value.choice] += 1;
        }
        vote.results = results;
        const winner = Object.entries(results).sort((left, right) => right[1] - left[1])[0] || null;
        resolvedEvent = appendCanonicalEvent({
          type: 'vote.resolved',
          branchId: branch,
          actorAgent: params.actor || params.voter || 'system',
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: castEvent.event_id,
          correlationId: params.correlationId || vote.id,
          payload: {
            vote_id: vote.id,
            question: vote.question || '',
            results,
            winner: winner ? { choice: winner[0], votes: winner[1] } : null,
            closed_at: vote.closed_at,
          },
        });
      }

      io.writeJson(votesFilePath, votes, { cacheKey: getBranchCacheKey('votes', branch), space: 2 });

      result = {
        success: true,
        vote: cloneJsonValue(vote),
        vote_cast_event_id: castEvent.event_id,
        vote_resolved_event_id: resolvedEvent ? resolvedEvent.event_id : null,
      };
    });

    return result;
  }

  function deleteFile(filePath) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  function deleteDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
      fs.rmSync(dirPath, { recursive: true, force: true });
    }
  }

  function clearConsumedFiles() {
    if (!fs.existsSync(dataDir)) return;
    for (const fileName of fs.readdirSync(dataDir)) {
      if ((fileName.startsWith('consumed-') || fileName.includes('-consumed-')) && fileName.endsWith('.json')) {
        deleteFile(path.join(dataDir, fileName));
      }
    }
  }

  function deleteConsumedFilesForAgent(agentName) {
    const suffix = `consumed-${sanitizeScopedName(agentName, 'agent name')}.json`;
    if (!fs.existsSync(dataDir)) return;
    for (const fileName of fs.readdirSync(dataDir)) {
      if (fileName === suffix || fileName.endsWith(`-${suffix}`)) {
        deleteFile(path.join(dataDir, fileName));
      }
    }
  }

  function readConsumedMessageIds(agentName, options = {}) {
    const branch = sanitizeBranchName(options.branch || 'main');
    const raw = readJson(getConsumedFile(agentName, branch), []);
    return new Set(
      (Array.isArray(raw) ? raw : [])
        .filter((value) => typeof value === 'string' && value.length > 0)
    );
  }

  function writeConsumedMessageIds(agentName, ids, options = {}) {
    const branch = sanitizeBranchName(options.branch || 'main');
    const filePath = getConsumedFile(agentName, branch);
    const normalized = [...new Set((ids instanceof Set ? [...ids] : (Array.isArray(ids) ? ids : []))
      .filter((value) => typeof value === 'string' && value.length > 0))];

    withFileLock(filePath, () => {
      if (normalized.length === 0) {
        deleteFile(filePath);
        return;
      }

      io.writeJson(filePath, normalized, { space: 2 });
    });

    return new Set(normalized);
  }

  function listMarkdownBranches() {
    const branchRegistry = readObject(branchesFile);
    const branchNames = new Set(['main']);
    const runtimeBranchesDir = path.join(runtimeDir, 'branches');

    for (const branchName of Object.keys(branchRegistry)) {
      try {
        branchNames.add(sanitizeBranchName(branchName));
      } catch {}
    }

    if (fs.existsSync(runtimeBranchesDir)) {
      for (const entry of fs.readdirSync(runtimeBranchesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        try {
          branchNames.add(sanitizeBranchName(entry.name));
        } catch {}
      }
    }

    return [...branchNames]
      .sort((left, right) => {
        if (left === right) return 0;
        if (left === 'main') return -1;
        if (right === 'main') return 1;
        return left.localeCompare(right);
      })
      .map((branchName) => {
        const registryEntry = branchRegistry[branchName] && typeof branchRegistry[branchName] === 'object'
          ? branchRegistry[branchName]
          : {};
        const runtimeBranchDir = path.join(runtimeDir, 'branches', branchName);
        return {
          branch: branchName,
          created_at: registryEntry.created_at || null,
          created_by: registryEntry.created_by || null,
          forked_from: registryEntry.forked_from || null,
          fork_point: registryEntry.fork_point || null,
          message_count: Number.isInteger(registryEntry.message_count) ? registryEntry.message_count : null,
          runtime_present: fs.existsSync(runtimeBranchDir),
          listed_in_registry: Object.prototype.hasOwnProperty.call(branchRegistry, branchName),
        };
      });
  }

  function getBranchEventSequence(branchName = 'main') {
    const branch = sanitizeBranchName(branchName);
    const head = canonicalEventLog.getEventsHead({
      stream: 'branch',
      branchId: branch,
    });
    return head && Number.isInteger(head.last_seq) && head.last_seq > 0 ? head.last_seq : null;
  }

  function listBranchSessions(branchName = 'main') {
    return sessionsState.listBranchSessions(branchName);
  }

  function getBranchSessionManifest(sessionId, branchName = 'main') {
    return sessionsState.readSessionManifest(sessionId, branchName);
  }

  function listCompatibilityDecisions() {
    return listDecisions({ branch: 'main' });
  }

  function listCompatibilityWorkspaces(params = {}) {
    return listWorkspaces(params);
  }

  function getCompatibilityProjectNotesView() {
    return getProjectNotesView({ branch: 'main' });
  }

  function getCompatibilityTeamNotesView() {
    return getTeamNotesView({ branch: 'main' });
  }

  function exportMarkdownWorkspaceFiles(options = {}) {
    const projectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : path.resolve(dataDir, '..');
    const outputRoot = options.outputRoot
      ? path.resolve(options.outputRoot)
      : path.join(projectRoot, DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME);
    const selectedBranches = Array.isArray(options.branches)
      ? listMarkdownBranches().filter((entry) => options.branches.includes(entry.branch))
      : null;

    return exportMarkdownWorkspace({
      projectRoot,
      outputRoot,
      generatedAt: options.generatedAt,
      branches: selectedBranches,
      runtimeDataDir: dataDir,
      readModel: {
        listBranches: listMarkdownBranches,
        getBranchEventSequence,
        getConversationMessages: dashboardQueries.getConversationMessages,
        getChannelsView: dashboardQueries.getChannelsView,
        listBranchSessions,
        getBranchSessionManifest,
        readEvidence,
        listDecisions,
        listWorkspaces,
        getPlanStatusView: dashboardQueries.getPlanStatusView,
        getPlanReportView: dashboardQueries.getPlanReportView,
        getProjectNotesView,
        getTeamNotesView,
      },
    });
  }

  function appendCanonicalEvent(params = {}) {
    return canonicalEventLog.appendEvent(params);
  }

  function readHooks(params = {}) {
    return canonicalHooks.readHooks(params);
  }

  function readBranchHooks(branchName = 'main', options = {}) {
    return canonicalHooks.readBranchHooks(branchName, options);
  }

  function readRuntimeHooks(options = {}) {
    return canonicalHooks.readRuntimeHooks(options);
  }

  function projectAgentRecord(name, agent) {
    if (!agent) return null;

    const projected = {
      name,
      provider: agent.provider || null,
      branch: agent.branch || 'main',
      status: agent.status || null,
      pid: agent.pid || null,
      registered_at: agent.timestamp || agent.started_at || null,
      started_at: agent.started_at || agent.timestamp || null,
      last_activity: agent.last_activity || agent.timestamp || null,
      listening_since: agent.listening_since || null,
      last_listened_at: agent.last_listened_at || null,
    };

    if (agent.runtime_descriptor && typeof agent.runtime_descriptor === 'object') {
      projected.runtime_descriptor = cloneJsonValue(agent.runtime_descriptor);
    }

    if (Array.isArray(agent.capabilities)) {
      projected.capabilities = [...agent.capabilities];
    }

    if (agent.bot_capability) {
      projected.bot_capability = agent.bot_capability;
    }

    return projected;
  }

  function appendCanonicalMessageSentEvent(message, options = {}) {
    return appendCanonicalEvent({
      type: 'message.sent',
      branchId: options.branch,
      actorAgent: options.actorAgent || message.from || 'system',
      sessionId: options.sessionId || null,
      commandId: options.commandId || null,
      causationId: options.causationId || null,
      correlationId: options.correlationId || null,
      payload: { message },
    });
  }

  function appendCanonicalMessageCorrectedEvent(params = {}) {
    return appendCanonicalEvent({
      type: 'message.corrected',
      branchId: params.branch,
      actorAgent: params.actorAgent || 'system',
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || params.messageId,
      payload: {
        message_id: params.messageId,
        content: params.content,
        edited_at: params.editedAt,
        max_edit_history: params.maxEditHistory,
      },
    });
  }

  function appendCanonicalMessageRedactedEvent(params = {}) {
    return appendCanonicalEvent({
      type: 'message.redacted',
      branchId: params.branch,
      actorAgent: params.actorAgent || 'system',
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || params.messageId,
      payload: {
        message_id: params.messageId,
        redacted_at: params.redactedAt,
      },
    });
  }

  function listBranchChannelProjectionNames(branchName = 'main') {
    const branch = sanitizeBranchName(branchName || 'main');
    if (!fs.existsSync(dataDir)) return [];

    const prefix = branch === 'main'
      ? 'channel-'
      : `branch-${branch}-channel-`;
    const names = new Set();

    for (const fileName of fs.readdirSync(dataDir)) {
      const suffix = fileName.endsWith('-messages.jsonl')
        ? '-messages.jsonl'
        : (fileName.endsWith('-history.jsonl') ? '-history.jsonl' : null);
      if (!suffix || !fileName.startsWith(prefix)) continue;

      const channelName = fileName.slice(prefix.length, -suffix.length);
      if (channelName) names.add(channelName);
    }

    return [...names].sort();
  }

  function getScopedMessageProjectionTargets(branchName = 'main') {
    const branch = sanitizeBranchName(branchName || 'main');
    const configuredChannels = Object.keys(readObject(getChannelsFile(branch)))
      .filter((channelName) => channelName && channelName !== 'general');
    const existingChannels = listBranchChannelProjectionNames(branch);
    const channelNames = [...new Set([...configuredChannels, ...existingChannels])].sort();

    return {
      branch: getMessageTargets(branch),
      channels: Object.fromEntries(
        channelNames.map((channelName) => [channelName, {
          messageFile: getChannelMessagesFile(channelName, branch),
          historyFile: getChannelHistoryFile(channelName, branch),
        }])
      ),
      getChannelTargets(channelName) {
        return {
          messageFile: getChannelMessagesFile(channelName, branch),
          historyFile: getChannelHistoryFile(channelName, branch),
        };
      },
    };
  }

  function readCanonicalMessageEvents(branchName = 'main') {
    const branch = sanitizeBranchName(branchName || 'main');
    return canonicalEventLog.readBranchEvents(branch, { typePrefix: 'message.' });
  }

  function appendMessage(message, options = {}) {
    const targets = getMessageTargets(options.branch);
    appendCanonicalMessageSentEvent(message, { ...options, branch: targets.branch });
    return messagesState.appendConversationMessage(message, {
      messageFile: targets.messageFile,
      historyFile: targets.historyFile,
    });
  }

  function appendScopedMessage(message, options = {}) {
    const branch = sanitizeBranchName(options.branch || 'main');
    const rawChannel = typeof options.channel === 'string' ? options.channel : (message && message.channel);
    const channel = rawChannel && rawChannel !== 'general'
      ? sanitizeScopedName(rawChannel, 'channel name')
      : null;
    const targets = channel
      ? {
          messageFile: getChannelMessagesFile(channel, branch),
          historyFile: getChannelHistoryFile(channel, branch),
        }
      : getMessageTargets(branch);

    appendCanonicalMessageSentEvent(message, { ...options, branch });
    return messagesState.appendConversationMessage(message, {
      messageFile: targets.messageFile,
      historyFile: targets.historyFile,
    });
  }

  function appendMessages(messages, options = {}) {
    return messages.map((message) => appendMessage(message, options));
  }

  function assertMessageProjectionRebuildAuthority(branch, targets) {
    const eventFile = canonicalEventLog.getBranchEventsFile(branch);
    const branchTargets = targets && targets.branch ? targets.branch : targets;
    const channelTargets = targets && targets.channels && typeof targets.channels === 'object' && !Array.isArray(targets.channels)
      ? Object.values(targets.channels)
      : [];
    const existingProjectionFiles = [
      branchTargets.messageFile,
      branchTargets.historyFile,
      ...channelTargets.flatMap((channelTarget) => [channelTarget.messageFile, channelTarget.historyFile]),
    ].filter((filePath) => filePath && fs.existsSync(filePath));

    if (existingProjectionFiles.length > 0 && !fs.existsSync(eventFile)) {
      throw createCanonicalReplayError(
        CANONICAL_REPLAY_ERROR_CODES.MISSING_CANONICAL_STREAM,
        `Canonical message projection rebuild refused legacy-only recovery for branch ${branch}: missing canonical stream ${eventFile} while compatibility projections still exist.`,
        {
          branch_id: branch,
          event_file: eventFile,
          projection_files: existingProjectionFiles,
        }
      );
    }
  }

  function rebuildMessageProjections(options = {}) {
    const targets = getScopedMessageProjectionTargets(options.branch);
    assertMessageProjectionRebuildAuthority(targets.branch.branch, targets);
    const events = readCanonicalMessageEvents(targets.branch.branch);
    return messagesState.rebuildConversationProjectionsFromEvents(events, targets);
  }

  function editMessage(params) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const current = messagesState.getConversationMessageFromEvents(readCanonicalMessageEvents(branch), params.id);
    if (!current || !current.message) return null;

    const editedAt = params.editedAt || new Date().toISOString();
    const event = appendCanonicalMessageCorrectedEvent({
      branch,
      actorAgent: params.actorAgent || params.actor || 'system',
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || params.id,
      messageId: params.id,
      content: params.content,
      editedAt,
      maxEditHistory: params.maxEditHistory,
    });

    rebuildMessageProjections({ branch });
    return { id: params.id, edited_at: editedAt, event_id: event.event_id };
  }

  function deleteMessage(params) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const current = messagesState.getConversationMessageFromEvents(readCanonicalMessageEvents(branch), params.id);
    if (!current || !current.message) {
      return { found: false, denied: false, from: null };
    }

    const allowedFrom = Array.isArray(params.allowedFrom) ? params.allowedFrom : null;
    const messageFrom = current.message.from || null;
    if (allowedFrom && !allowedFrom.includes(messageFrom)) {
      return { found: true, denied: true, from: messageFrom };
    }

    const redactedAt = params.redactedAt || new Date().toISOString();
    const event = appendCanonicalMessageRedactedEvent({
      branch,
      actorAgent: params.actorAgent || params.actor || 'system',
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || params.id,
      messageId: params.id,
      redactedAt,
    });

    rebuildMessageProjections({ branch });
    return { found: true, deleted: true, from: messageFrom, redacted_at: redactedAt, event_id: event.event_id };
  }

  function registerApiAgent(params) {
    const { name, agent, profile, createProfileIfMissing = false } = params;
    const savedAgent = agentsState.setAgent(name, agent);
    let savedProfile = null;

    if (profile) {
      savedProfile = agentsState.updateProfile(name, (currentProfile) => {
        if (createProfileIfMissing && Object.keys(currentProfile).length > 0) {
          return;
        }
        Object.assign(currentProfile, profile);
      });
    }

    const event = appendCanonicalEvent({
      type: 'agent.registered',
      actorAgent: params.actorAgent || name,
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || name,
      payload: {
        agent_name: name,
        agent: projectAgentRecord(name, savedAgent),
        reason: params.reason || 'api_register',
      },
    });

    return { agent: savedAgent, profile: savedProfile, event };
  }

  function unregisterApiAgent(name, options = {}) {
    const { removeConsumed = true, removeProfile = true } = options;
    const removed = agentsState.removeAgent(name);
    if (removeProfile) agentsState.deleteProfile(name);
    if (removeConsumed) deleteConsumedFilesForAgent(name);

    const event = removed
      ? appendCanonicalEvent({
          type: 'agent.unregistered',
          actorAgent: options.actorAgent || name,
          sessionId: options.sessionId || null,
          commandId: options.commandId || null,
          causationId: options.causationId || null,
          correlationId: options.correlationId || name,
          payload: {
            agent_name: name,
            agent: projectAgentRecord(name, removed),
            reason: options.reason || 'api_unregister',
          },
        })
      : null;

    return { removed, event };
  }

  function recordAgentHeartbeat(name, options = {}) {
    const updated = agentsState.readAgent(name);
    if (!updated) return null;

    const heartbeat = agentsState.touchHeartbeat(name, options.at);
    const event = appendCanonicalEvent({
      type: 'agent.heartbeat_recorded',
      actorAgent: options.actorAgent || name,
      sessionId: options.sessionId || null,
      commandId: options.commandId || null,
      causationId: options.causationId || null,
      correlationId: options.correlationId || name,
      payload: {
        agent_name: name,
        agent: projectAgentRecord(name, {
          ...updated,
          last_activity: heartbeat && heartbeat.last_activity ? heartbeat.last_activity : (updated.last_activity || null),
          pid: heartbeat && heartbeat.pid ? heartbeat.pid : (updated.pid || null),
        }),
        heartbeat_at: heartbeat && heartbeat.last_activity ? heartbeat.last_activity : null,
        reason: options.reason || 'heartbeat',
      },
    });

    return { agent: updated, heartbeat, event };
  }

  function updateAgentHeartbeat(name) {
    const options = arguments[1] || {};
    const updated = agentsState.updateAgent(name, (agent) => {
      agent.last_activity = new Date().toISOString();
      agent.pid = processPid;
    });

    if (updated) agentsState.touchHeartbeat(name);
    const event = updated
      ? appendCanonicalEvent({
          type: 'agent.heartbeat_recorded',
          actorAgent: options.actorAgent || name,
          sessionId: options.sessionId || null,
          commandId: options.commandId || null,
          causationId: options.causationId || null,
          correlationId: options.correlationId || name,
          payload: {
            agent_name: name,
            agent: projectAgentRecord(name, updated),
            heartbeat_at: updated.last_activity || null,
            reason: options.reason || 'heartbeat',
          },
        })
      : null;

    return { agent: updated, event };
  }

  function updateAgentStatus(name, status) {
    const options = arguments[2] || {};
    const previous = agentsState.readAgent(name);
    const updated = agentsState.updateAgent(name, (agent) => {
      agent.status = status;
      agent.last_activity = new Date().toISOString();
      agent.pid = processPid;
    });

    if (updated) agentsState.touchHeartbeat(name);
    const event = updated && (!previous || previous.status !== updated.status)
      ? appendCanonicalEvent({
          type: 'agent.status_updated',
          actorAgent: options.actorAgent || name,
          sessionId: options.sessionId || null,
          commandId: options.commandId || null,
          causationId: options.causationId || null,
          correlationId: options.correlationId || name,
          payload: {
            agent_name: name,
            agent: projectAgentRecord(name, updated),
            previous_status: previous ? previous.status || null : null,
            status: updated.status || null,
            reason: options.reason || 'status_update',
          },
        })
      : null;

    return { agent: updated, event };
  }

  function updateAgentBranch(name, branchName = 'main', options = {}) {
    const nextBranch = sanitizeBranchName(branchName);
    const previous = agentsState.readAgent(name);
    const updated = agentsState.setBranch(name, nextBranch, options.at);
    const event = updated && (!previous || previous.branch !== nextBranch || options.forceEvent)
      ? appendCanonicalEvent({
          type: 'agent.branch_assigned',
          actorAgent: options.actorAgent || name,
          sessionId: options.sessionId || null,
          commandId: options.commandId || null,
          causationId: options.causationId || null,
          correlationId: options.correlationId || name,
          payload: {
            agent_name: name,
            agent: projectAgentRecord(name, updated),
            previous_branch: previous ? previous.branch || null : null,
            branch: nextBranch,
            reason: options.reason || 'branch_assign',
          },
        })
      : null;

    return { agent: updated, event };
  }

  function setAgentListeningState(name, isListening, options = {}) {
    const previous = agentsState.readAgent(name);
    const updated = agentsState.setListeningState(name, isListening, options.at);
    const previousListening = !!(previous && previous.listening_since);
    const currentListening = !!(updated && updated.listening_since);
    const event = updated && (previousListening !== currentListening || options.forceEvent)
      ? appendCanonicalEvent({
          type: 'agent.listening_updated',
          actorAgent: options.actorAgent || name,
          sessionId: options.sessionId || null,
          commandId: options.commandId || null,
          causationId: options.causationId || null,
          correlationId: options.correlationId || name,
          payload: {
            agent_name: name,
            agent: projectAgentRecord(name, updated),
            is_listening: currentListening,
            previous_is_listening: previousListening,
            reason: options.reason || 'listening_update',
          },
        })
      : null;

    return { agent: updated, event };
  }

  function ensureAgentSession(params = {}) {
    const branchName = sanitizeBranchName(params.branchName || params.branch || 'main');
    const agentName = params.agentName;
    if (!agentName) throw new Error('ensureAgentSession requires agentName');

    const existingSummary = params.sessionId
      ? sessionsState.getSessionSummary(params.sessionId, branchName)
      : sessionsState.getLatestSessionSummaryForAgent(branchName, agentName);

    if (existingSummary && existingSummary.session_id && existingSummary.state === 'active') {
      const touched = sessionsState.touchSession({
        sessionId: existingSummary.session_id,
        branchName,
        at: params.at,
        heartbeat: !!params.heartbeat,
      });
      const session = touched && touched.session
        ? touched.session
        : sessionsState.readSessionManifest(existingSummary.session_id, branchName);
      return {
        session,
        created: false,
        resumed: false,
        touched: !!(touched && touched.updated),
        previous_state: null,
      };
    }

    return sessionsState.activateSession({
      agentName,
      branchName,
      at: params.at,
      reason: params.reason,
      provider: params.provider,
      sessionId: params.sessionId,
      orphanedReason: params.orphanedReason,
    });
  }

  function touchSession(params = {}) {
    return sessionsState.touchSession({
      sessionId: params.sessionId,
      branchName: sanitizeBranchName(params.branchName || params.branch || 'main'),
      at: params.at,
      heartbeat: !!params.heartbeat,
    });
  }

  function transitionSession(params = {}) {
    return sessionsState.transitionSession({
      sessionId: params.sessionId,
      branchName: sanitizeBranchName(params.branchName || params.branch || 'main'),
      state: params.state,
      reason: params.reason,
      at: params.at,
      recoverySnapshotFile: params.recoverySnapshotFile,
    });
  }

  function transitionLatestSessionForAgent(params = {}) {
    return sessionsState.transitionLatestSessionForAgent({
      agentName: params.agentName,
      branchName: sanitizeBranchName(params.branchName || params.branch || 'main'),
      state: params.state,
      reason: params.reason,
      at: params.at,
      recoverySnapshotFile: params.recoverySnapshotFile,
    });
  }

  function readEvidence(branchName = 'main') {
    return evidenceState.readEvidenceStore(getEvidenceFile(branchName));
  }

  function findEvidence(branchName = 'main', evidenceId) {
    return evidenceState.findEvidenceRecord(getEvidenceFile(branchName), evidenceId);
  }

  function projectEvidence(branchName = 'main', evidenceRef) {
    if (!evidenceRef || !evidenceRef.evidence_id) return null;
    const branch = sanitizeBranchName(evidenceRef.branch_id || branchName || 'main');
    const record = findEvidence(branch, evidenceRef.evidence_id);
    if (!record) return null;
    return projectEvidenceRecord(record, createEvidenceReference(record, branch));
  }

  function recordEvidence(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const summary = typeof params.summary === 'string' ? params.summary.trim() : '';
    const verification = typeof params.verification === 'string' ? params.verification.trim() : '';
    const filesChanged = Array.isArray(params.files_changed)
      ? params.files_changed.filter((entry) => typeof entry === 'string' && entry.trim()).map((entry) => entry.trim())
      : [];
    const confidence = params.confidence;

    if (!summary) return { error: 'Evidence summary is required.' };
    if (!verification) return { error: 'Evidence verification is required.' };
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
      return { error: 'Evidence confidence must be a number between 0 and 100.' };
    }

    const recordedAt = params.recordedAt || new Date().toISOString();
    const record = {
      evidence_id: createEvidenceId(),
      subject_kind: params.subjectKind || 'completion',
      branch_id: branch,
      task_id: params.taskId || null,
      task_title: params.taskTitle || null,
      workflow_id: params.workflowId || null,
      workflow_name: params.workflowName || null,
      step_id: params.stepId || null,
      step_description: params.stepDescription || null,
      notes: params.notes || null,
      summary,
      verification,
      files_changed: filesChanged,
      confidence,
      learnings: params.learnings || null,
      flagged: !!params.flagged,
      flag_reason: params.flagReason || null,
      recorded_at: recordedAt,
      recorded_by: params.actor || 'system',
      recorded_by_session: params.sessionId || null,
      source_tool: params.sourceTool || null,
    };

    evidenceState.mutateEvidence(getEvidenceFile(branch), (store) => {
      store.updated_at = recordedAt;
      store.records.push(record);
    }, { space: 2 });

    const event = canonicalEventLog.appendEvent({
      type: 'evidence.recorded',
      branchId: branch,
      actorAgent: params.actor || 'system',
      sessionId: params.sessionId || null,
      commandId: params.commandId || null,
      causationId: params.causationId || null,
      correlationId: params.correlationId || null,
      payload: {
        evidence: record,
      },
    });

    return {
      event,
      record,
      reference: createEvidenceReference(record, branch),
    };
  }

  function createTask(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const task = cloneJsonValue(params.task || null);
    let result = { error: 'Task payload is required.' };

    if (!task || typeof task !== 'object' || !task.id) {
      return result;
    }

    tasksWorkflowsState.mutateTasks((tasks) => {
      if (tasks.length >= 1000) {
        result = { error: 'Task limit reached (max 1000). Complete or remove existing tasks first.' };
        return;
      }

      tasks.push(task);

      const event = appendCanonicalEvent({
        type: 'task.created',
        branchId: branch,
        actorAgent: params.actor || task.created_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || task.id,
        payload: {
          task_id: task.id,
          title: task.title,
          status: task.status,
          assignee: task.assignee || null,
          created_at: task.created_at || null,
        },
      });

      result = {
        success: true,
        task: cloneJsonValue(task),
        task_event_id: event.event_id,
      };
    }, { branch, space: 2 });

    return result;
  }

  function updateTaskStatus(params) {
    const now = params.at || new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'Task not found' };

    tasksWorkflowsState.mutateTasks((tasks) => {
      const task = tasks.find((entry) => entry.id === params.taskId);
      if (!task) return;

      if (params.requireUnassigned && task.assignee) {
        result = { error: 'Task already claimed.' };
        return;
      }

      if (Object.prototype.hasOwnProperty.call(params, 'expectedAssignee')) {
        const expectedAssignee = params.expectedAssignee || null;
        const actualAssignee = task.assignee || null;
        if (expectedAssignee !== actualAssignee) {
          result = { error: 'Task assignee changed.' };
          return;
        }
      }

      if (Array.isArray(params.expectedStatuses) && params.expectedStatuses.length > 0 && !params.expectedStatuses.includes(task.status)) {
        result = { error: 'Task status changed.' };
        return;
      }

      if (params.status === 'done') {
        const evidence = recordEvidence({
          ...(params.evidence || {}),
          actor: params.actor || 'system',
          branch,
          commandId: params.commandId || null,
          correlationId: params.correlationId || params.taskId || null,
          recordedAt: now,
          sessionId: params.sessionId || null,
          subjectKind: 'task',
          sourceTool: params.sourceTool || 'update_task',
          taskId: task.id,
          taskTitle: task.title,
        });
        if (evidence.error) {
          result = evidence;
          return;
        }

        task.status = params.status;
        task.updated_at = now;
        task.completed_at = now;
        task.completed_by = params.actor || null;
        task.completed_by_session = params.sessionId || null;
        task.evidence_ref = cloneJsonValue(evidence.reference);
        task.completion = buildVerificationProjection(evidence.record, evidence.reference);
        if (params.notes) {
          if (!Array.isArray(task.notes)) task.notes = [];
          task.notes.push({ by: params.actor || 'system', text: params.notes, at: now });
        }

        const completionEvent = canonicalEventLog.appendEvent({
          type: 'task.completed',
          branchId: branch,
          actorAgent: params.actor || 'system',
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: evidence.event.event_id,
          correlationId: params.correlationId || params.taskId || null,
          payload: {
            task_id: task.id,
            status: task.status,
            title: task.title,
            notes: params.notes || null,
            evidence_ref: cloneJsonValue(evidence.reference),
            completed_at: now,
          },
        });

        result = {
          success: true,
          task_id: task.id,
          status: task.status,
          title: task.title,
          evidence_event_id: evidence.event.event_id,
          evidence_ref: cloneJsonValue(evidence.reference),
          task_event_id: completionEvent.event_id,
        };
        return;
      }

      const previousStatus = task.status;
      const previousAssignee = task.assignee || null;
      task.status = params.status;
      task.updated_at = now;
      if (Object.prototype.hasOwnProperty.call(params, 'assignee')) {
        task.assignee = params.assignee || null;
      }
      if (params.trackAttemptAgent && params.actor) {
        if (!Array.isArray(task.attempt_agents)) task.attempt_agents = [];
        if (!task.attempt_agents.includes(params.actor)) task.attempt_agents.push(params.actor);
      }
      if (params.clearPolicySignal && task.policy_signal) {
        delete task.policy_signal;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'policySignal')) {
        if (params.policySignal) {
          task.policy_signal = cloneJsonValue(params.policySignal);
        } else {
          delete task.policy_signal;
        }
      }
      if (params.clearEscalatedAt && task.escalated_at) {
        delete task.escalated_at;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'escalatedAt')) {
        if (params.escalatedAt) {
          task.escalated_at = params.escalatedAt;
        } else {
          delete task.escalated_at;
        }
      }
      if (Object.prototype.hasOwnProperty.call(params, 'blockReason')) {
        if (params.blockReason) {
          task.block_reason = params.blockReason;
        } else {
          delete task.block_reason;
        }
      }
      if (params.notes) {
        if (!Array.isArray(task.notes)) task.notes = [];
        task.notes.push({ by: params.actor || 'Dashboard', text: params.notes, at: now });
      }

      const eventType = task.status === 'in_progress'
        && task.assignee
        && task.assignee !== previousAssignee
        ? 'task.claimed'
        : 'task.updated';
      const event = appendCanonicalEvent({
        type: eventType,
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || params.taskId || null,
        payload: {
          task_id: task.id,
          title: task.title,
          status: task.status,
          previous_status: previousStatus,
          assignee: task.assignee || null,
          previous_assignee: previousAssignee,
          notes: params.notes || null,
          block_reason: task.block_reason || null,
          escalated_at: task.escalated_at || null,
          policy_signal: task.policy_signal || null,
          updated_at: now,
        },
      });

      result = {
        success: true,
        task_id: task.id,
        status: task.status,
        title: task.title,
        task: cloneJsonValue(task),
        task_event_id: event.event_id,
      };
    }, { branch, space: 2 });

    return result;
  }

  function createWorkflow(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const workflow = cloneJsonValue(params.workflow || null);
    let result = { error: 'Workflow payload is required.' };

    if (!workflow || typeof workflow !== 'object' || !workflow.id) {
      return result;
    }

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      if (workflows.length >= 500) {
        result = { error: 'Workflow limit reached (max 500).' };
        return;
      }

      if (!workflow.branch_id) {
        workflow.branch_id = branch;
      }

      workflows.push(workflow);

      const createdEvent = appendCanonicalEvent({
        type: 'workflow.created',
        branchId: branch,
        actorAgent: params.actor || workflow.created_by || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || workflow.id,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          status: workflow.status,
          autonomous: !!workflow.autonomous,
          parallel: !!workflow.parallel,
          created_at: workflow.created_at || null,
          started_step_ids: workflow.steps.filter((step) => step.status === 'in_progress').map((step) => step.id),
        },
      });

      const startedStepEvents = workflow.steps
        .filter((step) => step.status === 'in_progress')
        .map((step) => appendCanonicalEvent({
          type: 'workflow.step_started',
          branchId: branch,
          actorAgent: params.actor || workflow.created_by || 'system',
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: createdEvent.event_id,
          correlationId: params.correlationId || workflow.id,
          payload: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            step_id: step.id,
            assignee: step.assignee || null,
            started_at: step.started_at || null,
          },
        }));

      result = {
        success: true,
        workflow: cloneJsonValue(workflow),
        workflow_event_id: createdEvent.event_id,
        started_step_event_ids: startedStepEvents.map((event) => event.event_id),
      };
    }, { branch, space: 2 });

    return result;
  }

  function advanceWorkflow(params) {
    const now = params.at || new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'Workflow not found' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.id === params.workflowId);
      if (!workflow) return;

      const currentStep = workflow.steps.find((step) => step.status === 'in_progress');
      if (!currentStep) {
        result = { error: 'No step currently in progress' };
        return;
      }

      if (params.expectedAssignee && currentStep.assignee !== params.expectedAssignee) {
        result = { error: 'No active step assigned to you in this workflow.' };
        return;
      }

      const evidence = recordEvidence({
        ...(params.evidence || {}),
        actor: params.actor || 'system',
        branch,
        commandId: params.commandId || null,
        correlationId: params.correlationId || params.workflowId || null,
        flagged: !!params.flagged,
        flagReason: params.flagReason || null,
        notes: params.notes || null,
        recordedAt: now,
        sessionId: params.sessionId || null,
        sourceTool: params.sourceTool || 'advance_workflow',
        stepDescription: currentStep.description || null,
        stepId: currentStep.id,
        subjectKind: 'workflow_step',
        workflowId: workflow.id,
        workflowName: workflow.name,
      });
      if (evidence.error) {
        result = evidence;
        return;
      }

      currentStep.status = 'done';
      currentStep.completed_at = now;
      currentStep.completed_by = params.actor || null;
      currentStep.completed_by_session = params.sessionId || null;
      currentStep.evidence_ref = cloneJsonValue(evidence.reference);
      currentStep.verification = buildVerificationProjection(evidence.record, evidence.reference);
      if (params.notes) currentStep.notes = params.notes;
      if (params.flagged) {
        currentStep.flagged = true;
        currentStep.flag_reason = params.flagReason || null;
      } else {
        delete currentStep.flagged;
        delete currentStep.flag_reason;
      }

      const nextSteps = findReadyWorkflowSteps(workflow);
      if (nextSteps.length > 0) {
        for (const nextStep of nextSteps) {
          nextStep.status = 'in_progress';
          nextStep.started_at = now;
        }
      } else if (!workflow.steps.find((step) => step.status === 'pending' || step.status === 'in_progress')) {
        workflow.status = 'completed';
        workflow.completed_at = now;
      }

      workflow.updated_at = now;

      const stepCompletedEvent = canonicalEventLog.appendEvent({
        type: 'workflow.step_completed',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: evidence.event.event_id,
        correlationId: params.correlationId || params.workflowId || null,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          step_id: currentStep.id,
          notes: params.notes || null,
          flagged: !!params.flagged,
          flag_reason: params.flagReason || null,
          evidence_ref: cloneJsonValue(evidence.reference),
          next_step_ids: nextSteps.map((step) => step.id),
          workflow_status: workflow.status,
          completed_at: now,
        },
      });

      let workflowCompletedEvent = null;
      if (workflow.status === 'completed') {
        workflowCompletedEvent = canonicalEventLog.appendEvent({
          type: 'workflow.completed',
          branchId: branch,
          actorAgent: params.actor || 'system',
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: stepCompletedEvent.event_id,
          correlationId: params.correlationId || params.workflowId || null,
          payload: {
            workflow_id: workflow.id,
            workflow_name: workflow.name,
            evidence_ref: cloneJsonValue(evidence.reference),
            completed_at: now,
          },
        });
      }

      const stepStartedEvents = nextSteps.map((step) => appendCanonicalEvent({
        type: 'workflow.step_started',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: stepCompletedEvent.event_id,
        correlationId: params.correlationId || params.workflowId || null,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          step_id: step.id,
          assignee: step.assignee || null,
          started_at: step.started_at || now,
        },
      }));

      const doneCount = workflow.steps.filter((step) => step.status === 'done').length;
      const pct = workflow.steps.length > 0 ? Math.round((doneCount / workflow.steps.length) * 100) : 100;

      result = {
        success: true,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
        completed_step: currentStep.id,
        completed_step_description: currentStep.description || null,
        evidence_event_id: evidence.event.event_id,
        evidence_ref: cloneJsonValue(evidence.reference),
        flagged: !!params.flagged,
        flag_reason: params.flagReason || null,
        next_steps: nextSteps.map((step) => ({
          id: step.id,
          description: step.description,
          assignee: step.assignee || null,
        })),
        progress: `${doneCount}/${workflow.steps.length} (${pct}%)`,
        step_event_id: stepCompletedEvent.event_id,
        started_step_event_ids: stepStartedEvents.map((event) => event.event_id),
        workflow_event_id: workflowCompletedEvent ? workflowCompletedEvent.event_id : null,
        workflow_status: workflow.status,
      };
    }, { branch, space: 2 });

    return result;
  }

  function skipWorkflowStep(params) {
    const now = new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'Workflow not found' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.id === params.workflowId);
      if (!workflow) return;

      const step = workflow.steps.find((entry) => entry.id === params.stepId);
      if (!step) {
        result = { error: 'Step not found' };
        return;
      }

      step.status = 'done';
      if (params.appendNote && params.note) {
        step.notes = (step.notes || '') + params.note;
      } else {
        step.notes = params.note || step.notes || 'Skipped from dashboard';
      }
      step.completed_at = now;
      if (params.markSkipped) step.skipped = true;

      let readySteps = [];
      if (params.dependencyAware) {
        readySteps = workflow.steps.filter((candidate) => {
          if (candidate.status !== 'pending') return false;
          if (!candidate.depends_on || candidate.depends_on.length === 0) return true;
          return candidate.depends_on.every((dependencyId) => {
            const dependency = workflow.steps.find((entry) => entry.id === dependencyId);
            return dependency && dependency.status === 'done';
          });
        });
        for (const readyStep of readySteps) {
          readyStep.status = 'in_progress';
          readyStep.started_at = now;
        }
      } else {
        const nextStep = workflow.steps.find((candidate) => candidate.status === 'pending');
        if (nextStep && !workflow.steps.find((candidate) => candidate.status === 'in_progress')) {
          nextStep.status = 'in_progress';
          nextStep.started_at = now;
          readySteps = [nextStep];
        }
      }

      if (!workflow.steps.find((candidate) => candidate.status === 'pending' || candidate.status === 'in_progress')) {
        workflow.status = 'completed';
      }
      workflow.updated_at = now;

      result = {
        success: true,
        workflow_id: workflow.id,
        step_id: step.id,
        ready_steps: readySteps.map((readyStep) => readyStep.id),
      };
    }, { branch, space: 2 });

    return result;
  }

  function reassignWorkflowStep(params) {
    const now = params.at || new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'Workflow not found' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.id === params.workflowId);
      if (!workflow) return;

      const step = workflow.steps.find((entry) => entry.id === params.stepId);
      if (!step) {
        result = { error: 'Step not found' };
        return;
      }

      if (Object.prototype.hasOwnProperty.call(params, 'expectedAssignee')) {
        const expectedAssignee = params.expectedAssignee || null;
        const actualAssignee = step.assignee || null;
        if (expectedAssignee !== actualAssignee) {
          result = { error: 'Step assignee changed.' };
          return;
        }
      }

      const oldAssignee = step.assignee || null;
      step.assignee = params.newAssignee;
      if (params.clearPolicySignal && step.policy_signal) {
        delete step.policy_signal;
      }
      if (Array.isArray(params.clearSignalFields)) {
        for (const fieldName of params.clearSignalFields) {
          if (typeof fieldName !== 'string' || !fieldName) continue;
          if (Object.prototype.hasOwnProperty.call(step, fieldName)) {
            delete step[fieldName];
          }
        }
      }
      if (params.restartStartedAt && step.status === 'in_progress') {
        step.started_at = params.restartStartedAt;
      }
      workflow.updated_at = now;

      const event = appendCanonicalEvent({
        type: 'workflow.step_reassigned',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        causationId: params.causationId || null,
        correlationId: params.correlationId || params.workflowId || null,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          step_id: step.id,
          old_assignee: oldAssignee,
          new_assignee: params.newAssignee,
          reassigned_at: now,
        },
      });

      result = {
        success: true,
        workflow_id: workflow.id,
        step_id: step.id,
        old_assignee: oldAssignee,
        new_assignee: params.newAssignee,
        step: cloneJsonValue(step),
        step_event_id: event.event_id,
      };
    }, { branch, space: 2 });

    return result;
  }

  function setWorkflowStepPolicySignal(params = {}) {
    const now = params.at || new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'Workflow not found' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.id === params.workflowId);
      if (!workflow) return;

      const step = workflow.steps.find((entry) => entry.id === params.stepId);
      if (!step) {
        result = { error: 'Step not found' };
        return;
      }

      if (Object.prototype.hasOwnProperty.call(params, 'expectedAssignee')) {
        const expectedAssignee = params.expectedAssignee || null;
        const actualAssignee = step.assignee || null;
        if (expectedAssignee !== actualAssignee) {
          result = { error: 'Step assignee changed.' };
          return;
        }
      }

      if (params.clearPolicySignal && step.policy_signal) {
        delete step.policy_signal;
      }
      if (Object.prototype.hasOwnProperty.call(params, 'policySignal')) {
        if (params.policySignal) {
          step.policy_signal = cloneJsonValue(params.policySignal);
        } else {
          delete step.policy_signal;
        }
      }

      if (params.signalAtField) {
        step[params.signalAtField] = now;
      }

      workflow.updated_at = now;
      result = {
        success: true,
        workflow_id: workflow.id,
        step_id: step.id,
        step: cloneJsonValue(step),
      };
    }, { branch, space: 2 });

    return result;
  }

  function pausePlan() {
    const params = arguments[0] || {};
    const now = new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'No active autonomous plan' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.status === 'active' && entry.autonomous);
      if (!workflow) return;

      workflow.paused = true;
      workflow.paused_at = now;
      workflow.updated_at = now;
      const event = appendCanonicalEvent({
        type: 'workflow.paused',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        correlationId: params.correlationId || workflow.id,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          paused_at: now,
        },
      });
      result = { success: true, workflow_id: workflow.id, name: workflow.name, workflow_event_id: event.event_id };
    }, { branch, space: 2 });

    return result;
  }

  function resumePlan() {
    const params = arguments[0] || {};
    const now = new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'No paused plan' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.status === 'active' && entry.paused);
      if (!workflow) return;

      workflow.paused = false;
      delete workflow.paused_at;
      workflow.updated_at = now;
      const event = appendCanonicalEvent({
        type: 'workflow.resumed',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        correlationId: params.correlationId || workflow.id,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          resumed_at: now,
        },
      });
      result = { success: true, workflow_id: workflow.id, name: workflow.name, workflow_event_id: event.event_id };
    }, { branch, space: 2 });

    return result;
  }

  function stopPlan() {
    const params = arguments[0] || {};
    const now = new Date().toISOString();
    const branch = sanitizeBranchName(params.branch || 'main');
    let result = { error: 'No active plan' };

    tasksWorkflowsState.mutateWorkflows((workflows) => {
      const workflow = workflows.find((entry) => entry.status === 'active');
      if (!workflow) return;

      workflow.status = 'stopped';
      workflow.stopped_at = now;
      workflow.updated_at = now;
      const event = appendCanonicalEvent({
        type: 'workflow.stopped',
        branchId: branch,
        actorAgent: params.actor || 'system',
        sessionId: params.sessionId || null,
        commandId: params.commandId || null,
        correlationId: params.correlationId || workflow.id,
        payload: {
          workflow_id: workflow.id,
          workflow_name: workflow.name,
          stopped_at: now,
        },
      });
      result = { success: true, workflow_id: workflow.id, name: workflow.name, workflow_event_id: event.event_id };
    }, { branch, space: 2 });

    return result;
  }

  function archiveFiles(params = {}) {
    const { fileNames = [], destinationDir } = params;
    if (!destinationDir) throw new Error('archiveFiles requires destinationDir');

    io.ensureDataDir();
    fs.mkdirSync(destinationDir, { recursive: true });

    let archived = 0;
    for (const fileName of fileNames) {
      const sourcePath = path.join(dataDir, fileName);
      if (!fs.existsSync(sourcePath)) continue;
      fs.copyFileSync(sourcePath, path.join(destinationDir, fileName));
      archived++;
    }

    return { archived, destination: destinationDir };
  }

  function failClosedConversationMutation(operation, reason) {
    return {
      error: `${operation} is unavailable while canonical events are authoritative: ${reason}`,
      fail_closed: true,
    };
  }

  function clearBranchMessageAuxiliaryState(branch) {
    const auxiliaryFiles = [
      getAcksFile(branch),
      getReadReceiptsFile(branch),
      getCompressedFile(branch),
      getBranchDashboardProjectionFile(branch),
    ];

    for (const filePath of auxiliaryFiles) {
      withFileLock(filePath, () => deleteFile(filePath));
    }
  }

  function clearMessages(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const targets = getScopedMessageProjectionTargets(branch);
    const actorAgent = params.actorAgent || params.actor || 'system';

    try {
      assertMessageProjectionRebuildAuthority(branch, targets);

      const currentMessages = dashboardQueries.getConversationMessages({ branch });
      const redactedAt = params.redactedAt || new Date().toISOString();
      const clearedMessageIds = [];

      // Only redact messages that actually have a canonical message.sent event
      // in this branch's log. Redacting a message that was never "sent" in
      // canonical terms (e.g. a legacy projection-only message left over from
      // pre-canonical clear cycles) would create an orphan redaction that
      // breaks future replay — the rebuild fails with "cannot apply
      // message.redacted because message X does not exist".
      const canonicalSentIds = new Set();
      for (const event of readCanonicalMessageEvents(branch)) {
        if (event && event.type === 'message.sent' && event.payload && event.payload.message && typeof event.payload.message.id === 'string') {
          canonicalSentIds.add(event.payload.message.id);
        }
      }

      for (const message of Array.isArray(currentMessages) ? currentMessages : []) {
        if (!message || typeof message.id !== 'string' || !message.id) continue;
        if (!canonicalSentIds.has(message.id)) continue; // skip projection-only / orphan
        appendCanonicalMessageRedactedEvent({
          branch,
          actorAgent,
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: params.causationId || null,
          correlationId: params.correlationId || message.id,
          messageId: message.id,
          redactedAt,
        });
        clearedMessageIds.push(message.id);
      }

      if (clearedMessageIds.length > 0 || fs.existsSync(canonicalEventLog.getBranchEventsFile(branch))) {
        rebuildMessageProjections({ branch });
      }
      clearBranchMessageAuxiliaryState(branch);

      return {
        success: true,
        branch,
        cleared_messages: clearedMessageIds.length,
        redacted_at: redactedAt,
      };
    } catch (error) {
      return {
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : null,
      };
    }
  }

  function clearTasks(params = {}) {
    const branch = sanitizeBranchName(params.branch || 'main');
    const actorAgent = params.actorAgent || params.actor || 'system';
    const clearedAt = params.clearedAt || new Date().toISOString();
    const clearedTaskIds = [];

    try {
      tasksWorkflowsState.mutateTasks((tasks) => {
        for (const task of tasks) {
          if (task && typeof task.id === 'string' && task.id) {
            clearedTaskIds.push(task.id);
          }
        }
        if (clearedTaskIds.length === 0) return;

        appendCanonicalEvent({
          type: 'tasks.cleared',
          branchId: branch,
          actorAgent,
          sessionId: params.sessionId || null,
          commandId: params.commandId || null,
          causationId: params.causationId || null,
          correlationId: params.correlationId || null,
          payload: {
            cleared_task_ids: [...clearedTaskIds],
            cleared_count: clearedTaskIds.length,
            cleared_at: clearedAt,
          },
        });

        tasks.length = 0;
      }, { branch, space: 2 });

      return {
        success: true,
        branch,
        cleared_tasks: clearedTaskIds.length,
        cleared_at: clearedAt,
      };
    } catch (error) {
      return {
        error: error && error.message ? error.message : String(error),
        code: error && error.code ? error.code : null,
      };
    }
  }

  function archiveCurrentConversation() {
    return failClosedConversationMutation(
      'archiveCurrentConversation',
      'archiving or rotating projection-only conversation snapshots is not yet modeled in canonical events.'
    );
  }

  function loadConversation(name) {
    const conversationsDir = path.join(dataDir, 'conversations');
    const sourceMessages = path.join(conversationsDir, name + '.jsonl');
    if (!fs.existsSync(sourceMessages)) {
      return { error: 'Conversation not found' };
    }

    return failClosedConversationMutation(
      'loadConversation',
      'loading archived projection snapshots back into canonical event history is not supported safely.'
    );
  }

  function resetRuntime(params = {}) {
    const baseFixedFileNames = [
      'messages.jsonl',
      'history.jsonl',
      'agents.json',
      'acks.json',
      'tasks.json',
      'evidence.json',
      'profiles.json',
      'workflows.json',
      'branches.json',
      'read_receipts.json',
      'permissions.json',
      'config.json',
      'channels.json',
      'compressed.json',
      'decisions.json',
      'kb.json',
      'progress.json',
      'votes.json',
      'rules.json',
      'reviews.json',
      'dependencies.json',
      'locks.json',
      'reputation.json',
      'assistant-replies.jsonl',
    ];
    const fixedFileNames = Array.from(new Set([...(params.fixedFileNames || []), ...baseFixedFileNames]));

    for (const fileName of fixedFileNames) {
      const filePath = path.join(dataDir, fileName);
      withFileLock(filePath, () => deleteFile(filePath));
    }

    clearConsumedFiles();

    if (fs.existsSync(dataDir)) {
      for (const fileName of fs.readdirSync(dataDir)) {
        const isBranchScopedP0File = fileName.startsWith('branch-') && (
          fileName.endsWith('-messages.jsonl') ||
          fileName.endsWith('-history.jsonl') ||
          fileName.endsWith('-acks.json') ||
          fileName.endsWith('-tasks.json') ||
          fileName.endsWith('-evidence.json') ||
          fileName.endsWith('-workflows.json') ||
          fileName.endsWith('-read_receipts.json') ||
          fileName.endsWith('-config.json') ||
          fileName.endsWith('-channels.json') ||
          fileName.endsWith('-compressed.json') ||
          fileName.endsWith('-decisions.json') ||
          fileName.endsWith('-kb.json') ||
          fileName.endsWith('-reviews.json') ||
          fileName.endsWith('-dependencies.json') ||
          fileName.endsWith('-votes.json') ||
          fileName.endsWith('-rules.json') ||
          fileName.endsWith('-progress.json') ||
          fileName.includes('-consumed-') ||
          (fileName.includes('-channel-') && (fileName.endsWith('-messages.jsonl') || fileName.endsWith('-history.jsonl')))
        );
        const isGlobalChannelProjection = fileName.startsWith('channel-') && (fileName.endsWith('-messages.jsonl') || fileName.endsWith('-history.jsonl'));
        if (isBranchScopedP0File || isGlobalChannelProjection) {
          const filePath = path.join(dataDir, fileName);
          withFileLock(filePath, () => deleteFile(filePath));
        }
      }
    }

    withFileLock(getSessionsIndexFile(), () => deleteFile(getSessionsIndexFile()));
    deleteDirectory(runtimeDir);

    const runtimeBranchesDir = path.join(runtimeDir, 'branches');
    if (fs.existsSync(runtimeBranchesDir)) {
      for (const entry of fs.readdirSync(runtimeBranchesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        deleteDirectory(getBranchSessionsDir(entry.name));
      }
    }

    if (fs.existsSync(workspacesDir)) {
      for (const fileName of fs.readdirSync(workspacesDir)) {
        deleteFile(path.join(workspacesDir, fileName));
      }
      try { fs.rmdirSync(workspacesDir); } catch {}
    }

    if (fs.existsSync(dataDir)) {
      for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (!/^branch-[a-zA-Z0-9_-]+-workspaces$/.test(entry.name)) continue;
        deleteDirectory(path.join(dataDir, entry.name));
      }
    }

    return { success: true };
  }

  return {
    readJson,
    appendCanonicalEvent,
    readHooks,
    readBranchHooks,
    readRuntimeHooks,
    appendMessage,
    appendScopedMessage,
    appendMessages,
    rebuildMessageProjections,
    editMessage,
    deleteMessage,
    registerApiAgent,
    unregisterApiAgent,
    recordAgentHeartbeat,
    updateAgentHeartbeat,
    updateAgentStatus,
    updateAgentBranch,
    setAgentListeningState,
    listAgents,
    listProfiles,
    upsertProfile,
    listDecisions,
    readKnowledgeBase,
    listReviews,
    listDependencies,
    listVotes,
    listRules,
    readProgress,
    getProjectNotesView,
    getTeamNotesView,
    readWorkspace,
    listWorkspaces,
    mutateReviews,
    mutateDependencies,
    addRule,
    updateRule,
    toggleRule,
    removeRule,
    saveWorkspace,
    logDecision,
    writeKnowledgeBaseEntry,
    updateProgressRecord,
    createVote,
    castVote,
    listTasks,
    listWorkflows,
    getConversationConfigView,
    getHistoryView: dashboardQueries.getHistoryView,
    getChannelsView: dashboardQueries.getChannelsView,
    getConversationMessages: dashboardQueries.getConversationMessages,
    getSearchResultsView: dashboardQueries.getSearchResultsView,
    getPlanStatusView,
    getPlanReportView,
    listMarkdownBranches,
    getBranchEventSequence,
    listBranchSessions,
    getBranchSessionManifest,
    getLatestSessionSummaryForAgent,
    ensureAgentSession,
    touchSession,
    transitionSession,
    transitionLatestSessionForAgent,
    findEvidence,
    projectEvidence,
    readEvidence,
    listCompatibilityDecisions,
    listCompatibilityWorkspaces,
    getCompatibilityProjectNotesView,
    getCompatibilityTeamNotesView,
    readConsumedMessageIds,
    writeConsumedMessageIds,
    exportMarkdownWorkspace: exportMarkdownWorkspaceFiles,
    createTask,
    updateTaskStatus,
    createWorkflow,
    advanceWorkflow,
    skipWorkflowStep,
    reassignWorkflowStep,
    setWorkflowStepPolicySignal,
    pausePlan,
    resumePlan,
    stopPlan,
    archiveFiles,
    clearMessages,
    clearTasks,
    archiveCurrentConversation,
    loadConversation,
    resetRuntime,
  };
}

module.exports = {
  buildVerificationProjection,
  createCanonicalState,
  createBranchPathResolvers,
  projectEvidenceRecord,
  sanitizeBranchName,
};
