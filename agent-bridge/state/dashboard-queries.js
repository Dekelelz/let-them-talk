const fs = require('fs');
const path = require('path');

const DASHBOARD_QUERY_PROJECTION_SCHEMA_VERSION = 1;

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readJsonlObjects(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];

  return raw
    .split(/\r?\n/)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
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

function normalizeFileFingerprint(fingerprint) {
  return {
    exists: !!(fingerprint && fingerprint.exists),
    size: fingerprint && Number.isInteger(fingerprint.size) ? fingerprint.size : 0,
    mtime_ms: fingerprint && Number.isFinite(fingerprint.mtime_ms) ? fingerprint.mtime_ms : 0,
  };
}

function compareMessagesByTime(left, right) {
  const leftTime = Date.parse(left && left.timestamp || '');
  const rightTime = Date.parse(right && right.timestamp || '');

  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return (left && Number.isInteger(left._sort_index) ? left._sort_index : 0)
    - (right && Number.isInteger(right._sort_index) ? right._sort_index : 0);
}

function normalizeProjectionMessage(message) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  return {
    ...message,
    channel: typeof message.channel === 'string' && message.channel ? message.channel : 'general',
    acked: !!message.acked,
  };
}

function normalizeProjectionChannels(channels) {
  const source = channels && typeof channels === 'object' && !Array.isArray(channels) ? channels : {};
  return Object.fromEntries(Object.entries(source).map(([channelName, channel]) => {
    const normalized = channel && typeof channel === 'object' && !Array.isArray(channel) ? channel : {};
    const count = Number.isInteger(normalized.message_count)
      ? normalized.message_count
      : (Number.isInteger(normalized.count) ? normalized.count : 0);

    return [channelName, {
      name: channelName,
      ...normalized,
      count,
      message_count: count,
    }];
  }));
}

function normalizeProjection(projection) {
  const source = projection && projection.source && typeof projection.source === 'object' && !Array.isArray(projection.source)
    ? projection.source
    : {};
  const channelHistories = source.channel_histories && typeof source.channel_histories === 'object' && !Array.isArray(source.channel_histories)
    ? source.channel_histories
    : {};

  return {
    schema_version: DASHBOARD_QUERY_PROJECTION_SCHEMA_VERSION,
    branch_id: projection && typeof projection.branch_id === 'string' ? projection.branch_id : 'main',
    updated_at: projection && typeof projection.updated_at === 'string' ? projection.updated_at : null,
    source: {
      history: normalizeFileFingerprint(source.history),
      acks: normalizeFileFingerprint(source.acks),
      channels: normalizeFileFingerprint(source.channels),
      channel_histories: Object.fromEntries(
        Object.entries(channelHistories).map(([channelName, fingerprint]) => [channelName, normalizeFileFingerprint(fingerprint)])
      ),
    },
    messages: Array.isArray(projection && projection.messages)
      ? projection.messages.map(normalizeProjectionMessage).filter(Boolean)
      : [],
    channels: normalizeProjectionChannels(projection && projection.channels),
  };
}

function projectPlanWorkflow(workflow) {
  if (!workflow || typeof workflow !== 'object' || Array.isArray(workflow)) return null;
  return {
    ...workflow,
    status: workflow.status === 'active' && workflow.paused ? 'paused' : workflow.status,
  };
}

function createDashboardQueries(options = {}) {
  const {
    dataDir,
    readJson,
    agentsFile,
    profilesFile,
    getTasksFile,
    getWorkflowsFile,
    getAcksFile,
    getHistoryFile,
    getChannelsFile,
    getChannelHistoryFile,
    getBranchDashboardProjectionFile,
    sanitizeBranchName,
  } = options;

  const projectionCache = new Map();

  function readObject(filePath) {
    const value = readJson(filePath, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function readArray(filePath) {
    const value = readJson(filePath, []);
    return Array.isArray(value) ? value : [];
  }

  function resolveBranch(branchName = 'main') {
    return sanitizeBranchName(branchName || 'main');
  }

  function getProjectionFile(branchName = 'main') {
    const branch = resolveBranch(branchName);
    if (typeof getBranchDashboardProjectionFile === 'function') {
      return getBranchDashboardProjectionFile(branch);
    }
    return path.join(dataDir, 'runtime', 'branches', branch, 'dashboard-query-projection.json');
  }

  function listProjectionChannelNames(branchName, channels) {
    return Object.keys(channels || {})
      .filter((channelName) => channelName && channelName !== 'general')
      .sort();
  }

  function readProjectionFile(filePath) {
    const projection = readJson(filePath, null);
    if (!projection || typeof projection !== 'object' || Array.isArray(projection)) return null;
    return normalizeProjection(projection);
  }

  function persistProjection(branchName, projection) {
    const projectionFile = getProjectionFile(branchName);
    fs.mkdirSync(path.dirname(projectionFile), { recursive: true });
    fs.writeFileSync(projectionFile, JSON.stringify(projection));
    return projection;
  }

  function isProjectionFresh(branchName, projection, channels) {
    const branch = resolveBranch(branchName);
    const channelNames = listProjectionChannelNames(branch, channels);
    const projectionChannelNames = Object.keys(projection.source.channel_histories || {}).sort();

    if (channelNames.length !== projectionChannelNames.length) return false;
    for (let index = 0; index < channelNames.length; index += 1) {
      if (channelNames[index] !== projectionChannelNames[index]) return false;
    }

    if (!sameFileFingerprint(projection.source.history, readFileFingerprint(getHistoryFile(branch)))) return false;
    if (!sameFileFingerprint(projection.source.acks, readFileFingerprint(getAcksFile(branch)))) return false;
    if (!sameFileFingerprint(projection.source.channels, readFileFingerprint(getChannelsFile(branch)))) return false;

    for (const channelName of channelNames) {
      if (!sameFileFingerprint(
        projection.source.channel_histories[channelName],
        readFileFingerprint(getChannelHistoryFile(channelName, branch))
      )) {
        return false;
      }
    }

    return true;
  }

  function cacheProjection(branchName, projection) {
    const normalized = normalizeProjection(projection);
    projectionCache.set(resolveBranch(branchName), normalized);
    return normalized;
  }

  function buildBranchConversationProjection(branchName = 'main') {
    const branch = resolveBranch(branchName);
    const acks = readObject(getAcksFile(branch));
    const channels = readObject(getChannelsFile(branch));
    const channelNames = listProjectionChannelNames(branch, channels);
    const projectionMessages = [];
    let sortIndex = 0;

    for (const message of readJsonlObjects(getHistoryFile(branch))) {
      projectionMessages.push({
        ...message,
        channel: typeof message.channel === 'string' && message.channel ? message.channel : 'general',
        acked: !!acks[message.id],
        _sort_index: sortIndex,
      });
      sortIndex += 1;
    }

    for (const channelName of channelNames) {
      for (const message of readJsonlObjects(getChannelHistoryFile(channelName, branch))) {
        projectionMessages.push({
          ...message,
          channel: typeof message.channel === 'string' && message.channel ? message.channel : channelName,
          acked: !!acks[message.id],
          _sort_index: sortIndex,
        });
        sortIndex += 1;
      }
    }

    projectionMessages.sort(compareMessagesByTime);

    const channelCounts = {};
    for (const message of projectionMessages) {
      const channelName = typeof message.channel === 'string' && message.channel ? message.channel : 'general';
      channelCounts[channelName] = (channelCounts[channelName] || 0) + 1;
    }

    const projectionChannels = {};
    const channelNamesInProjection = new Set(['general', ...Object.keys(channels || {}), ...Object.keys(channelCounts)]);
    for (const channelName of [...channelNamesInProjection].sort()) {
      const metadata = channels && channels[channelName] && typeof channels[channelName] === 'object' && !Array.isArray(channels[channelName])
        ? channels[channelName]
        : {};
      const count = channelCounts[channelName] || 0;
      projectionChannels[channelName] = {
        name: channelName,
        ...metadata,
        count,
        message_count: count,
      };
    }

    const projection = {
      schema_version: DASHBOARD_QUERY_PROJECTION_SCHEMA_VERSION,
      branch_id: branch,
      updated_at: new Date().toISOString(),
      source: {
        history: readFileFingerprint(getHistoryFile(branch)),
        acks: readFileFingerprint(getAcksFile(branch)),
        channels: readFileFingerprint(getChannelsFile(branch)),
        channel_histories: Object.fromEntries(
          channelNames.map((channelName) => [channelName, readFileFingerprint(getChannelHistoryFile(channelName, branch))])
        ),
      },
      messages: projectionMessages.map((message) => {
        const normalized = { ...message };
        delete normalized._sort_index;
        return normalized;
      }),
      channels: projectionChannels,
    };

    persistProjection(branch, projection);
    return cacheProjection(branch, projection);
  }

  function loadBranchConversationProjection(branchName = 'main') {
    const branch = resolveBranch(branchName);
    const projectionFile = getProjectionFile(branch);
    const channels = readObject(getChannelsFile(branch));
    const cachedProjection = projectionCache.get(branch);
    if (cachedProjection && isProjectionFresh(branch, cachedProjection, channels)) {
      if (!fs.existsSync(projectionFile)) {
        persistProjection(branch, cachedProjection);
      }
      return cachedProjection;
    }

    const persistedProjection = readProjectionFile(projectionFile);
    if (persistedProjection && isProjectionFresh(branch, persistedProjection, channels)) {
      return cacheProjection(branch, persistedProjection);
    }

    return buildBranchConversationProjection(branch);
  }

  function getConversationMessages(params = {}) {
    const projection = loadBranchConversationProjection(params.branch || 'main');
    return cloneJsonValue(projection.messages);
  }

  function getHistoryView(params = {}) {
    const projection = loadBranchConversationProjection(params.branch || 'main');
    const limit = Math.min(Math.max(parseInt(params.limit || '500', 10), 1), 1000);
    const page = Math.max(parseInt(params.page || '0', 10), 0);
    const threadId = params.threadId || params.thread_id || null;

    const history = threadId
      ? projection.messages.filter((message) => message.id === threadId || message.thread_id === threadId || message.reply_to === threadId)
      : projection.messages;

    if (page > 0) {
      const pages = history.length > 0 ? Math.ceil(history.length / limit) : 0;
      const boundedPage = pages > 0 ? Math.min(page, pages) : 1;
      const endIndex = Math.max(0, history.length - ((boundedPage - 1) * limit));
      const startIndex = Math.max(0, endIndex - limit);
      return {
        messages: cloneJsonValue(history.slice(startIndex, endIndex)),
        page: boundedPage,
        pages,
        total_messages: history.length,
      };
    }

    return cloneJsonValue(history.slice(-limit));
  }

  function getChannelsView(params = {}) {
    const projection = loadBranchConversationProjection(params.branch || 'main');
    return cloneJsonValue(projection.channels);
  }

  function getSearchResultsView(params = {}) {
    const projection = loadBranchConversationProjection(params.branch || 'main');
    const query = String(params.query || '').trim().toLowerCase();
    const from = params.from ? String(params.from).trim().toLowerCase() : null;
    const limit = Math.min(Math.max(parseInt(params.limit || '50', 10), 1), 200);
    const matches = [];

    for (let index = projection.messages.length - 1; index >= 0 && matches.length < limit; index -= 1) {
      const message = projection.messages[index];
      if (!message || typeof message !== 'object') continue;
      if (from && String(message.from || '').trim().toLowerCase() !== from) continue;

      const haystacks = [message.content, message.from, message.to, message.channel, message.id];
      if (haystacks.some((value) => String(value || '').toLowerCase().includes(query))) {
        matches.push(cloneJsonValue(message));
      }
    }

    return matches.reverse();
  }

  function listAgents() {
    return readObject(agentsFile);
  }

  function listProfiles() {
    return readObject(profilesFile);
  }

  function listTasks(branchName = 'main') {
    return readArray(getTasksFile(resolveBranch(branchName)));
  }

  function listWorkflows(branchName = 'main') {
    return readArray(getWorkflowsFile(resolveBranch(branchName)));
  }

  function getPlanStatusView(params = {}) {
    const branch = resolveBranch(params.branch || 'main');
    return {
      workflows: listWorkflows(branch)
        .map(projectPlanWorkflow)
        .filter((workflow) => workflow && (workflow.status === 'active' || workflow.status === 'paused') && Array.isArray(workflow.steps)),
    };
  }

  function getPlanReportView(params = {}) {
    const branch = resolveBranch(params.branch || 'main');
    const workflows = listWorkflows(branch).map(projectPlanWorkflow).filter(Boolean);
    if (workflows.length === 0) return null;

    const activeWorkflows = workflows.filter((workflow) => workflow.status === 'active');
    const completedWorkflows = workflows.filter((workflow) => workflow.status === 'completed');
    const pausedWorkflows = workflows.filter((workflow) => workflow.status === 'paused');

    return {
      generated_at: new Date().toISOString(),
      totals: {
        workflows: workflows.length,
        active_workflows: activeWorkflows.length,
        completed_workflows: completedWorkflows.length,
        paused_workflows: pausedWorkflows.length,
      },
      workflows: cloneJsonValue(workflows),
    };
  }

  return {
    getChannelsView,
    getConversationMessages,
    getHistoryView,
    getPlanReportView,
    getPlanStatusView,
    getSearchResultsView,
    listAgents,
    listProfiles,
    listTasks,
    listWorkflows,
  };
}

module.exports = {
  createDashboardQueries,
  DASHBOARD_QUERY_PROJECTION_SCHEMA_VERSION,
};
