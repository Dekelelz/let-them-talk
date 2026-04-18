const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');
const { resolveDataDir: resolveSharedDataDir } = require('./data-dir');
const { createCanonicalEventLog } = require('./events/log');
const { createCanonicalHookState } = require('./events/hooks');
const { createStateIo } = require('./state/io');
const { createMessagesState } = require('./state/messages');
const { createAgentsState } = require('./state/agents');
const { createTasksWorkflowsState } = require('./state/tasks-workflows');
const { createCanonicalState, createBranchPathResolvers, sanitizeBranchName } = require('./state/canonical');
const { createSessionsState } = require('./state/sessions');
const {
  analyzeContractFit,
  buildGuideContractAdvisory,
  buildRuntimeContractMetadata,
  createDefaultContractMetadata,
  resolveAgentContract,
  sanitizeContractProfilePatch,
} = require('./agent-contracts');
const {
  evaluateAutonomyCandidate,
  rankClaimableTasks,
  resolveAgentDecisionContext,
  selectAutonomyDecisionCandidate,
} = require('./autonomy/decision-v2');
const {
  classifyRetryPolicy,
  planStalledStepOwnershipChange,
  planWatchdogActions,
} = require('./autonomy/watchdog-policy');
const {
  buildManagedTeamContractContext,
  readManagedTeamHookDigest,
} = require('./managed-team-integration');

// Data dir lives in the active project; local repo package-dir runs resolve back to repo root.
const DATA_DIR = resolveSharedDataDir();
const branchPaths = createBranchPathResolvers(DATA_DIR);
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const TASKS_FILE = branchPaths.getTasksFile('main');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const WORKFLOWS_FILE = branchPaths.getWorkflowsFile('main');
const WORKSPACES_DIR = branchPaths.getWorkspacesDir('main');
const BRANCHES_FILE = path.join(DATA_DIR, 'branches.json');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
const KB_FILE = path.join(DATA_DIR, 'kb.json');
const LOCKS_FILE = path.join(DATA_DIR, 'locks.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const DEPS_FILE = path.join(DATA_DIR, 'dependencies.json');
const REPUTATION_FILE = path.join(DATA_DIR, 'reputation.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
const ASSISTANT_REPLIES_FILE = path.join(DATA_DIR, 'assistant-replies.jsonl');
// Plugins removed in v3.4.3 — unnecessary attack surface, CLIs have their own extension systems

// In-memory state for this process
let registeredName = process.env.FORCE_REGISTER_NAME ? process.env.FORCE_REGISTER_NAME : null;
let registeredToken = null; // auth token for re-registration
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
const channelOffsets = new Map(); // per-channel byte offsets for efficient reads
let heartbeatInterval = null; // heartbeat timer reference
let messageSeq = 0; // monotonic sequence counter for message ordering
let currentBranch = 'main'; // which branch this agent is on
let currentSessionId = null; // branch-local execution session for this process
let lastSentAt = 0; // timestamp of last sent message (for group cooldown)
let sendsSinceLastListen = 0; // enforced: must listen between sends in group mode
let sendLimit = 10; // default: 10 sends per listen cycle (relaxed for better flow)
let unaddressedSends = 0; // response budget: unaddressed sends counter
let budgetResetTime = Date.now(); // resets every 60s
let _channelSendTimes = {}; // per-channel rate limit sliding window

function getChannelOffsetKey(channelName, branch = currentBranch) {
  return `${branch}:${channelName}`;
}

function resetBranchRuntimeOffsets() {
  lastReadOffset = 0;
  channelOffsets.clear();
}

// --- Read cache (eliminates 70%+ redundant disk I/O) ---
const _cache = {};
function cachedRead(key, readFn, ttlMs = 2000) {
  const now = Date.now();
  const entry = _cache[key];
  if (entry && now - entry.ts < ttlMs) return entry.val;
  const val = readFn();
  _cache[key] = { val, ts: now };
  return val;
}
function invalidateCache(key) { delete _cache[key]; }

const stateIo = createStateIo({
  dataDir: DATA_DIR,
  invalidateCache,
  withFileLock,
});

function resolveProjectionFallback(fallback) {
  return typeof fallback === 'function' ? fallback() : fallback;
}

function readJsonProjection(filePath, fallback) {
  return stateIo.readJsonFile(filePath, resolveProjectionFallback(fallback));
}

function writeJsonProjection(filePath, data, options = {}) {
  return stateIo.withLock(filePath, () => stateIo.writeJson(filePath, data, options));
}

function writeJsonlProjection(filePath, rows) {
  return stateIo.withLock(filePath, () => stateIo.writeJsonl(filePath, rows));
}

const messagesState = createMessagesState({ io: stateIo });

const canonicalHooks = createCanonicalHookState({
  dataDir: DATA_DIR,
  withLock: withFileLock,
  sanitizeBranchName,
});

const canonicalEventLog = createCanonicalEventLog({
  dataDir: DATA_DIR,
  withLock: withFileLock,
  onCommitted: (event) => canonicalHooks.projectCommittedEvent(event),
  sanitizeBranchName,
});

const agentsState = createAgentsState({
  io: stateIo,
  agentsFile: AGENTS_FILE,
  heartbeatFile,
  lockAgentsFile,
  unlockAgentsFile,
  processPid: process.pid,
});

const tasksWorkflowsState = createTasksWorkflowsState({
  io: stateIo,
  tasksFile: TASKS_FILE,
  workflowsFile: WORKFLOWS_FILE,
  getTasksFile: branchPaths.getTasksFile,
  getWorkflowsFile: branchPaths.getWorkflowsFile,
});

const sessionsState = createSessionsState({
  io: stateIo,
  branchPaths,
  canonicalEventLog,
});

const canonicalState = createCanonicalState({
  dataDir: DATA_DIR,
  processPid: process.pid,
  invalidateCache,
});

// --- Group conversation mode ---
function getConfigFile(branch = currentBranch) {
  return branchPaths.getConfigFile(branch);
}

function getAcksFile(branch = currentBranch) {
  return branchPaths.getAcksFile(branch);
}

function getReadReceiptsFile(branch = currentBranch) {
  return branchPaths.getReadReceiptsFile(branch);
}

function getChannelsFile(branch = currentBranch) {
  return branchPaths.getChannelsFile(branch);
}

function getCompressedFile(branch = currentBranch) {
  return branchPaths.getCompressedFile(branch);
}

function getConfig(branch = currentBranch) {
  return readJsonProjection(getConfigFile(branch), {});
}

// File-based lock for config.json (prevents managed state race conditions)
function getConfigLock(branch = currentBranch) {
  return getConfigFile(branch) + '.lock';
}

function lockConfigFile(branch = currentBranch) {
  const configLock = getConfigLock(branch);
  const maxWait = 5000; const start = Date.now();
  while (Date.now() - start < maxWait) {
    try { fs.writeFileSync(configLock, String(process.pid), { flag: 'wx' }); return true; }
    catch { /* lock exists, wait */ }
    const wait = Date.now(); while (Date.now() - wait < 50) {} // busy-wait 50ms
  }
  try { fs.unlinkSync(configLock); } catch {}
  try { fs.writeFileSync(configLock, String(process.pid), { flag: 'wx' }); return true; } catch {}
  return false;
}

function unlockConfigFile(branch = currentBranch) {
  try { fs.unlinkSync(getConfigLock(branch)); } catch {}
}

function saveConfig(config, branch = currentBranch) {
  writeJsonProjection(getConfigFile(branch), config);
}

function isGroupMode() {
  const mode = getConfig().conversation_mode;
  return mode === 'group';
}

function getGroupCooldown() {
  // Adaptive cooldown: scales with agent count, CAPPED at 3s for 100-agent scalability
  // 2 agents = 1s, 3 = 1.5s, 6 = 3s, 100 = still 3s (capped)
  const configured = getConfig().group_cooldown;
  if (configured) return configured; // respect explicit config
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  return Math.max(500, Math.min(aliveCount * 500, 3000));
}

// --- Managed conversation mode ---

function isManagedMode() {
  return getConfig().conversation_mode === 'managed';
}

function getManagedConfig(branch = currentBranch) {
  const config = getConfig(branch);
  return config.managed || {
    manager: null,
    phase: 'discussion',
    floor: 'closed',
    turn_queue: [],
    turn_current: null,
    phase_history: [],
  };
}

function saveManagedConfig(managed, branch = currentBranch) {
  lockConfigFile(branch);
  try {
    const config = getConfig(branch);
    config.managed = managed;
    saveConfig(config, branch);
  } finally {
    unlockConfigFile(branch);
  }
}

function cloneManagedState(managed) {
  return managed == null ? managed : JSON.parse(JSON.stringify(managed));
}

// Send a system message to a specific agent (written to messages + history)
// Uses the recipient agent's branch so multi-branch agents get the message
function sendSystemMessage(toAgent, content) {
  messageSeq++;
  const agents = getAgents();
  const recipientBranch = (agents[toAgent] && agents[toAgent].branch) || currentBranch;
  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: '__system__',
    to: toAgent,
    content,
    timestamp: new Date().toISOString(),
    system: true,
  };
  appendBranchConversationMessage(msg, recipientBranch);
}

// Send a system message to all registered agents
function broadcastSystemMessage(content, excludeAgent = null) {
  // O(1) write: single __group__ system message instead of N individual writes
  messageSeq++;
  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: '__system__',
    to: '__group__',
    content,
    timestamp: new Date().toISOString(),
    system: true,
  };
  if (excludeAgent) msg.exclude_agent = excludeAgent;
  appendBranchConversationMessage(msg);
}

// Rate limiting — prevent broadcast storms and message flooding
const rateLimitWindow = 60000; // 1 minute window
const rateLimitMax = 30; // max 30 messages per minute per agent
let rateLimitMessages = []; // timestamps of recent messages
let recentSentMessages = []; // { content, to, timestamp } for duplicate detection

// Stuck detector — tracks recent error tool calls to detect loops
let recentErrorCalls = []; // { tool, argsHash, timestamp }

function checkRateLimit(content, to) {
  const now = Date.now();
  rateLimitMessages = rateLimitMessages.filter(t => now - t < rateLimitWindow);
  if (rateLimitMessages.length >= rateLimitMax) {
    return { error: `Rate limit exceeded: max ${rateLimitMax} messages per minute. Wait before sending more.` };
  }
  // Duplicate content detection — block same message to same recipient within 30s
  recentSentMessages = recentSentMessages.filter(m => now - m.timestamp < 30000);
  if (content && typeof content === 'string' && to) {
    const contentKey = content.substring(0, 200); // compare first 200 chars
    const dup = recentSentMessages.find(m => m.to === to && m.content === contentKey);
    if (dup) {
      return { error: `Duplicate message detected — you already sent this to ${to} ${Math.round((now - dup.timestamp) / 1000)}s ago. Send a different message.` };
    }
    recentSentMessages.push({ content: contentKey, to, timestamp: now });
    if (recentSentMessages.length > 50) recentSentMessages = recentSentMessages.slice(-30);
  }
  rateLimitMessages.push(now);
  return null;
}

// --- Helpers ---

function ensureDataDir() {
  stateIo.ensureDataDir();
}

// Data version tracking — enables safe migrations between releases
const DATA_VERSION_FILE = path.join(DATA_DIR, '.version');
const CURRENT_DATA_VERSION = 1; // bump when data format changes require migration
let _migrationDone = false;

function migrateIfNeeded() {
  if (_migrationDone) return;
  _migrationDone = true;
  ensureDataDir();
  let dataVersion = 0;
  try {
    if (fs.existsSync(DATA_VERSION_FILE)) {
      dataVersion = parseInt(fs.readFileSync(DATA_VERSION_FILE, 'utf8').trim()) || 0;
    }
  } catch {}
  if (dataVersion >= CURRENT_DATA_VERSION) return;

  // Run migrations in order
  // v0 → v1: stamp initial version (no data changes needed, all fields are additive)
  // Future migrations go here:
  // if (dataVersion < 2) { /* migrate v1 → v2 */ }

  // Stamp current version
  try { fs.writeFileSync(DATA_VERSION_FILE, String(CURRENT_DATA_VERSION)); } catch {}
}

const RESERVED_NAMES = ['__system__', '__all__', '__open__', '__close__', 'system', 'dashboard', 'Dashboard'];

function sanitizeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,20}$/.test(name)) {
    throw new Error(`Invalid name "${name}": must be 1-20 alphanumeric/underscore/hyphen chars`);
  }
  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    throw new Error(`Name "${name}" is reserved and cannot be used`);
  }
  return name;
}

function consumedFile(agentName, branch = currentBranch) {
  sanitizeName(agentName);
  return branchPaths.getConsumedFile(agentName, branch);
}

function listConsumedFiles(branch = currentBranch) {
  if (!fs.existsSync(DATA_DIR)) return [];
  const prefix = branch === 'main' ? 'consumed-' : `branch-${branch}-consumed-`;
  return fs.readdirSync(DATA_DIR)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith('.json'))
    .map((fileName) => ({
      fileName,
      filePath: path.join(DATA_DIR, fileName),
      agentName: fileName.slice(prefix.length, -'.json'.length),
    }));
}

function getConsumedIds(agentName, branch = currentBranch) {
  return canonicalState.readConsumedMessageIds(agentName, { branch });
}

function saveConsumedIds(agentName, ids, branch = currentBranch) {
  // Auto-prune when consumed set exceeds 500 entries to prevent unbounded growth
  if (ids.size > 500) {
    trimConsumedIds(agentName, ids, branch);
  }
  canonicalState.writeConsumedMessageIds(agentName, ids, { branch });
}

// Prune consumed IDs: remove IDs no longer present in messages.jsonl
// At 100 agents with 5000+ messages, this prevents 500KB+ JSON per agent
function trimConsumedIds(agentName, ids, branch = currentBranch) {
  try {
    const msgFile = getMessagesFile(branch);
    if (!fs.existsSync(msgFile)) { ids.clear(); return; }
    const content = fs.readFileSync(msgFile, 'utf8').trim();
    if (!content) { ids.clear(); return; }
    // Build set of current message IDs (fast: just extract IDs, don't parse full objects)
    const currentIds = new Set();
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/"id"\s*:\s*"([^"]+)"/);
      if (match) currentIds.add(match[1]);
    }
    // Remove consumed IDs that no longer exist in messages
    for (const id of ids) {
      if (!currentIds.has(id)) ids.delete(id);
    }
  } catch {}
}

function defaultChannelsData() {
  return {
    general: {
      description: 'General channel — all agents',
      members: ['*'],
      created_by: 'system',
      created_at: new Date().toISOString(),
    },
  };
}

function normalizeChannelsData(data) {
  const normalized = data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  if (!normalized.general) normalized.general = defaultChannelsData().general;
  return normalized;
}

function readJsonFileSafe(filePath, fallback) {
  return readJsonProjection(filePath, fallback);
}

function writeJsonFileRaw(filePath, data) {
  writeJsonProjection(filePath, data);
}

function writeJsonlFileRaw(filePath, rows) {
  writeJsonlProjection(filePath, rows);
}

function copyScopedFileIfPresent(sourcePath, targetPath) {
  if (!sourcePath || sourcePath === targetPath || !fs.existsSync(sourcePath)) return false;
  ensureDataDir();
  withFileLock(targetPath, () => {
    if (fs.existsSync(sourcePath)) fs.copyFileSync(sourcePath, targetPath);
  });
  return true;
}

function ensureJsonProjection(filePath, sourcePath, fallbackValue) {
  if (fs.existsSync(filePath)) return;
  if (copyScopedFileIfPresent(sourcePath, filePath)) return;
  writeJsonFileRaw(filePath, typeof fallbackValue === 'function' ? fallbackValue() : fallbackValue);
}

function filterMessagesUpToTimestamp(messages, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return messages.slice();
  return messages.filter((message) => {
    const messageTime = new Date(message.timestamp || 0).getTime();
    return !Number.isFinite(messageTime) || messageTime <= cutoffMs;
  });
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// Optimized: read only NEW lines from a JSONL file starting at byte offset
// Returns { messages, newOffset } — caller tracks offset between calls
function readJsonlFromOffset(file, offset) {
  if (!fs.existsSync(file)) return { messages: [], newOffset: 0 };
  const stat = fs.statSync(file);
  if (stat.size <= offset) return { messages: [], newOffset: offset };
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(stat.size - offset);
  fs.readSync(fd, buf, 0, buf.length, offset);
  fs.closeSync(fd);
  const content = buf.toString('utf8').trim();
  if (!content) return { messages: [], newOffset: stat.size };
  const messages = content.split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return { messages, newOffset: stat.size };
}

// Scale fix: read only last N lines of a JSONL file (for history context)
// Seeks near end of file instead of parsing entire file — O(N) instead of O(all)
function tailReadJsonl(file, lineCount = 100) {
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  if (stat.size === 0) return [];
  // Estimate ~300 bytes per line, read enough from the end
  const readSize = Math.min(stat.size, lineCount * 300);
  const offset = Math.max(0, stat.size - readSize);
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(readSize);
  fs.readSync(fd, buf, 0, readSize, offset);
  fs.closeSync(fd);
  const content = buf.toString('utf8');
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  // If we started mid-file, first line may be partial — skip it
  if (offset > 0 && lines.length > 0) lines.shift();
  const messages = lines.map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return messages.slice(-lineCount);
}

// File-based lock for agents.json (prevents registration race conditions)
const AGENTS_LOCK = AGENTS_FILE + '.lock';
function lockAgentsFile() {
  const maxWait = 5000; const start = Date.now();
  let backoff = 1; // exponential backoff: 1ms → 2ms → 4ms → ... → 500ms max
  while (Date.now() - start < maxWait) {
    try { fs.writeFileSync(AGENTS_LOCK, String(process.pid), { flag: 'wx' }); return true; }
    catch { /* lock exists, wait with exponential backoff */ }
    const wait = Date.now(); while (Date.now() - wait < backoff) {}
    backoff = Math.min(backoff * 2, 500);
  }
  // Force-break stale lock after timeout
  try { fs.unlinkSync(AGENTS_LOCK); } catch {}
  try { fs.writeFileSync(AGENTS_LOCK, String(process.pid), { flag: 'wx' }); return true; } catch {}
  return false;
}
function unlockAgentsFile() { try { fs.unlinkSync(AGENTS_LOCK); } catch {} }

// Generic file lock for any JSON file (tasks, workflows, channels, etc.)
function withFileLock(filePath, fn) {
  const lockPath = filePath + '.lock';
  const maxWait = 5000; const start = Date.now();
  let backoff = 1;
  while (Date.now() - start < maxWait) {
    try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); break; }
    catch { /* lock exists, wait with exponential backoff */ }
    const wait = Date.now(); while (Date.now() - wait < backoff) {}
    backoff = Math.min(backoff * 2, 500);
    if (Date.now() - start >= maxWait) {
      // Force-break stale lock — only if holding PID is dead
      try {
        const lockPid = parseInt(fs.readFileSync(lockPath, 'utf8').trim(), 10);
        if (lockPid && lockPid !== process.pid) {
          try { process.kill(lockPid, 0); /* PID alive — skip, don't corrupt */ return null; } catch { /* PID dead — safe to break */ }
        }
      } catch {}
      try { fs.unlinkSync(lockPath); } catch {}
      try { fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx' }); } catch { return fn(); }
      break;
    }
  }
  try { return fn(); } finally { try { fs.unlinkSync(lockPath); } catch {} }
}

// Virtual operator agents. "Dashboard" and "Owner" represent the operator UI,
// not a CLI process. Surfacing them here ensures list_agents, broadcast filters,
// and DM-routing in the broker all agree the operator is a real recipient.
const VIRTUAL_AGENT_NAMES = ['Dashboard', 'Owner'];
function _mergeVirtualAgents(agents) {
  const now = new Date().toISOString();
  for (const name of VIRTUAL_AGENT_NAMES) {
    if (!agents[name] || !agents[name].is_virtual) {
      agents[name] = {
        pid: -1,
        is_virtual: true,
        virtual_type: 'owner',
        timestamp: (agents[name] && agents[name].timestamp) || now,
        last_activity: now,
        last_listened_at: now,
        provider: 'Dashboard',
        branch: (agents[name] && agents[name].branch) || 'main',
      };
    }
  }
  return agents;
}

function getAgents() {
  return cachedRead('agents', () => {
    if (!fs.existsSync(AGENTS_FILE)) return _mergeVirtualAgents({});
    let agents;
    try { agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch { return _mergeVirtualAgents({}); }
    // Scale fix: merge per-agent heartbeat files for live activity data
    try {
      const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('heartbeat-') && f.endsWith('.json'));
      for (const f of files) {
        const name = f.slice(10, -5); // extract name from 'heartbeat-{name}.json'
        if (agents[name]) {
          try {
            const hb = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
            if (hb.last_activity) agents[name].last_activity = hb.last_activity;
            if (hb.pid) agents[name].pid = hb.pid;
          } catch {}
        }
      }
    } catch {}
    return _mergeVirtualAgents(agents);
  }, 1500);
}

function saveAgents(agents) {
  return agentsState.saveAgents(agents);
}

// --- Per-agent heartbeat files (scale fix: eliminates agents.json write contention at 100+ agents) ---
function heartbeatFile(name) { return path.join(DATA_DIR, `heartbeat-${name}.json`); }

function touchHeartbeat(name, options = {}) {
  try {
    return canonicalState.recordAgentHeartbeat(name, {
      actorAgent: options.actorAgent || name,
      sessionId: options.sessionId || (name === registeredName ? currentSessionId : null),
      at: options.at,
      reason: options.reason || 'heartbeat',
    });
  } catch {}
}


function getAcks(branch = currentBranch) {
  return readJsonProjection(getAcksFile(branch), {});
}

// Cache for isPidAlive results — avoids redundant process.kill calls at 100-agent scale
const _pidAliveCache = {};
function isPidAlive(pid, lastActivity) {
  // Virtual agents (Dashboard, Owner) use pid === -1 and are always alive.
  // They represent the operator UI; liveness is implicit while the broker runs.
  if (pid === -1) return true;

  // Cache with 5s TTL — PID status doesn't change faster than heartbeats
  const cacheKey = `${pid}_${lastActivity}`;
  const cached = _pidAliveCache[cacheKey];
  if (cached && Date.now() - cached.ts < 5000) return cached.alive;

  // Faster stale detection in autonomous mode (30s vs 60s) for quicker dead agent recovery
  const STALE_THRESHOLD = isAutonomousMode() ? 30000 : 60000;
  let alive = false;

  // PRIORITY 1: Trust heartbeat freshness over PID status
  // Heartbeat files are written by the actual running process — if fresh, agent is alive
  // regardless of whether process.kill can see the PID (cross-process PID visibility issues)
  if (lastActivity) {
    const stale = Date.now() - new Date(lastActivity).getTime();
    if (stale < STALE_THRESHOLD) {
      alive = true;
    }
  }

  // PRIORITY 2: If heartbeat is stale, verify PID is actually dead
  if (!alive) {
    try {
      process.kill(pid, 0);
      alive = true; // PID exists — agent is alive even with stale heartbeat
    } catch {
      // PID dead AND heartbeat stale — agent is truly dead
      alive = false;
    }
  }
  _pidAliveCache[cacheKey] = { alive, ts: Date.now() };
  // Evict old entries (keep cache small)
  const keys = Object.keys(_pidAliveCache);
  if (keys.length > 200) {
    const cutoff = Date.now() - 10000;
    for (const k of keys) { if (_pidAliveCache[k].ts < cutoff) delete _pidAliveCache[k]; }
  }
  return alive;
}

const MAX_CONTENT_BYTES = 1000000; // 1 MB max message size

function validateContentSize(content) {
  if (typeof content !== 'string') return { error: 'content must be a string' };
  if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
    return { error: 'Message content exceeds maximum size (1 MB)' };
  }
  return null;
}

function generateId() {
  try { return Date.now().toString(36) + require('crypto').randomBytes(6).toString('hex'); }
  catch { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
}

function generateToken() {
  try { return require('crypto').randomBytes(16).toString('hex'); }
  catch { return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Adaptive poll interval — starts fast, slows down when idle
function adaptiveSleep(pollCount) {
  if (pollCount < 10) return sleep(500);    // first 5s: fast
  if (pollCount < 30) return sleep(1000);   // next 20s: medium
  return sleep(2000);                        // after that: slow
}

// Read new lines from messages.jsonl starting at a byte offset
function readNewMessages(fromOffset, branch) {
  const msgFile = getMessagesFile(branch || currentBranch);
  return readNewMessagesFromFile(fromOffset, msgFile);
}

// Read new messages from a specific file path (used for channels)
function readNewMessagesFromFile(fromOffset, filePath) {
  if (!fs.existsSync(filePath)) return { messages: [], newOffset: 0 };
  const stat = fs.statSync(filePath);
  if (stat.size < fromOffset) return { messages: [], newOffset: 0 }; // file was truncated/replaced — reset offset
  if (stat.size === fromOffset) return { messages: [], newOffset: fromOffset };

  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(stat.size - fromOffset);
  fs.readSync(fd, buf, 0, buf.length, fromOffset);
  fs.closeSync(fd);

  const chunk = buf.toString('utf8').trim();
  if (!chunk) return { messages: [], newOffset: stat.size };

  const messages = chunk.split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);

  return { messages, newOffset: stat.size };
}

// Build a standard message delivery response with context
function buildMessageResponse(msg, consumedIds) {
  // Count remaining unconsumed messages — use lightweight read from current offset
  // instead of full file scan to avoid performance issues in busy conversations
  let pendingCount = 0;
  try {
    const msgFile = getMessagesFile(currentBranch);
    if (fs.existsSync(msgFile)) {
      const { messages: tail } = readNewMessages(lastReadOffset);
      pendingCount = tail.filter(m => m.to === registeredName && m.id !== msg.id && !consumedIds.has(m.id)).length;
    }
  } catch {}

  // Count online agents
  const agents = getAgents();
  const agentsOnline = Object.entries(agents).filter(([, info]) => isPidAlive(info.pid, info.last_activity)).length;

  // Scale fix: estimate total messages from file size instead of reading entire file
  let totalMessages = 0;
  try {
    const histFile = getHistoryFile(currentBranch);
    if (fs.existsSync(histFile)) {
      const size = fs.statSync(histFile).size;
      totalMessages = Math.round(size / 300); // ~300 bytes per message average
    }
  } catch {}

  return {
    success: true,
    message: {
      id: msg.id,
      from: msg.from,
      content: msg.content,
      timestamp: msg.timestamp,
      ...(msg.reply_to && { reply_to: msg.reply_to }),
      ...(msg.thread_id && { thread_id: msg.thread_id }),
    },
    pending_count: pendingCount,
    agents_online: agentsOnline,
  };
}

// Auto-compact messages.jsonl when it gets too large
// Keeps only unconsumed messages, moves everything else to history-only
function autoCompact() {
  const msgFile = getMessagesFile(currentBranch);
  if (!fs.existsSync(msgFile)) return;
  try {
    const content = fs.readFileSync(msgFile, 'utf8').trim();
    if (!content) return;
    const lines = content.split(/\r?\n/);
    if (lines.length < 500) return; // only compact when large

    const messages = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

    // Collect consumed IDs — for __group__ messages, only check ALIVE agents
    const agents = getAgents();
    const aliveAgentNames = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
    const allConsumed = new Set();
    const perAgentConsumed = {};
    for (const consumedEntry of listConsumedFiles(currentBranch)) {
      try {
        const ids = readJsonProjection(consumedEntry.filePath, []);
        if (!Array.isArray(ids)) continue;
        perAgentConsumed[consumedEntry.agentName] = new Set(ids);
        ids.forEach(id => allConsumed.add(id));
      } catch {}
    }

    // Keep messages that are NOT fully consumed
    // For __group__ messages: consumed when ALL ALIVE agents have consumed it (dead agents don't block)
    // For direct messages: consumed when the recipient has consumed it
    const active = messages.filter(m => {
      if (m.to === '__group__') {
        // __group__: check if all alive agents (except sender) have consumed
        return !aliveAgentNames.every(n => n === m.from || (perAgentConsumed[n] && perAgentConsumed[n].has(m.id)));
      }
      // Direct: standard check
      if (!allConsumed.has(m.id)) return true;
      return false;
    });

    // Scale fix: archive consumed messages to date-based files before removing
    const archived = messages.filter(m => !active.includes(m));
    if (archived.length > 0) {
      const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const archiveFile = path.join(DATA_DIR, `archive-${dateStr}.jsonl`);
      const archiveContent = archived.map(m => JSON.stringify(m)).join('\n') + '\n';
      try { fs.appendFileSync(archiveFile, archiveContent); } catch {}
    }

    // Rewrite messages.jsonl atomically — write to temp file then rename
    const newContent = active.map(m => JSON.stringify(m)).join('\n') + (active.length ? '\n' : '');
    const tmpFile = msgFile + '.tmp';
    fs.writeFileSync(tmpFile, newContent);
    try {
      fs.renameSync(tmpFile, msgFile);
    } catch {
      // Rename can fail on Windows if another process has the file open
      // Clean up temp file and abort compaction — will retry next cycle
      try { fs.unlinkSync(tmpFile); } catch {}
      return;
    }
    lastReadOffset = Buffer.byteLength(newContent, 'utf8');

    // Trim consumed ID files — keep only IDs still in active messages
    const activeIds = new Set(active.map(m => m.id));
    for (const consumedEntry of listConsumedFiles(currentBranch)) {
      try {
        const ids = readJsonProjection(consumedEntry.filePath, []);
        if (!Array.isArray(ids)) continue;
        const trimmed = ids.filter(id => activeIds.has(id));
        writeJsonProjection(consumedEntry.filePath, trimmed);
      } catch {}
    }
  } catch {}
}

// --- Permissions helpers ---
const PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions.json');

function getPermissions() {
  return readJsonProjection(PERMISSIONS_FILE, {});
}

function canSendTo(sender, recipient) {
  const perms = getPermissions();
  // If no permissions set, allow everything (backward compatible)
  if (!perms[sender] && !perms[recipient]) return true;
  // Check sender's write permissions
  if (perms[sender] && perms[sender].can_write_to) {
    const allowed = perms[sender].can_write_to;
    if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(recipient)) return false;
  }
  // Check recipient's read permissions
  if (perms[recipient] && perms[recipient].can_read) {
    const allowed = perms[recipient].can_read;
    if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(sender)) return false;
  }
  return true;
}

// --- Read receipts helpers ---
function getReadReceipts(branch = currentBranch) {
  return readJsonProjection(getReadReceiptsFile(branch), {});
}

function markAsRead(agentName, messageId, branch = currentBranch) {
  const file = getReadReceiptsFile(branch);
  stateIo.withLock(file, () => {
    const receipts = readJsonProjection(file, {});
    if (!receipts[messageId]) receipts[messageId] = {};
    receipts[messageId][agentName] = new Date().toISOString();
    stateIo.writeJson(file, receipts);
  });
}

// Get unconsumed messages for an agent (full scan — used by check_messages and initial load)
function getUnconsumedMessages(agentName, fromFilter = null) {
  // Optimization: read only new bytes since last offset for scalability (100+ agents)
  const msgFile = getMessagesFile(currentBranch);
  const { messages: newMessages, newOffset } = readJsonlFromOffset(msgFile, lastReadOffset);

  // If we have new messages, filter them; also check any previously unread messages
  // For correctness, on first call (offset=0), this reads the full file
  let messages;
  if (lastReadOffset === 0) {
    messages = newMessages; // Full read on first call
  } else if (newMessages.length > 0) {
    messages = newMessages; // Only new messages since last offset
  } else {
    return []; // No new data — nothing to filter
  }
  // Don't update lastReadOffset here — let listen/listen_group handle it
  // to avoid skipping messages that arrive between get_work checks

  const consumed = getConsumedIds(agentName);
  const perms = getPermissions();

  // Relevance filtering: at 20+ agents, skip group messages not relevant to this agent
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  const useRelevanceFilter = aliveCount >= 20;
  const myChannels = useRelevanceFilter ? new Set(getAgentChannels(agentName)) : null;
  const myTaskIds = useRelevanceFilter ? new Set(getTasks().filter(t => t.assignee === agentName && t.status === 'in_progress').map(t => t.id)) : null;

  return messages.filter(m => {
    // PRIORITY: Owner/Dashboard messages are ALWAYS delivered (never filtered)
    const isOwnerMessage = m.from === 'Dashboard' || m.from === 'Owner' || m.from === 'dashboard' || m.from === 'owner';
    if (!isOwnerMessage) {
      if (m.to !== agentName && m.to !== '__group__' && m.to !== '__all__') return false;
    }
    if (m.to === '__group__' && m.from === agentName) return false;
    if (m.exclude_agent && m.exclude_agent === agentName) return false;
    if (consumed.has(m.id)) return false;
    if (fromFilter && m.from !== fromFilter && !m.system && !isOwnerMessage) return false;
    if (!isOwnerMessage && perms[agentName] && perms[agentName].can_read) {
      const allowed = perms[agentName].can_read;
      if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(m.from) && !m.system) return false;
    }

    // Relevance filter for group messages at scale (20+ agents)
    if (useRelevanceFilter && m.to === '__group__') {
      // Always show: system messages, broadcasts, messages addressed to this agent
      if (m.system) return true;
      if (m.addressed_to && m.addressed_to.includes(agentName)) return true;
      // Show messages on agent's subscribed channels
      if (m.channel && myChannels.has(m.channel)) return true;
      // Show messages mentioning agent's active task IDs
      if (myTaskIds.size > 0 && m.content) {
        for (const taskId of myTaskIds) {
          if (m.content.includes(taskId)) return true;
        }
      }
      // Show handoffs and workflow messages (always relevant)
      if (m.type === 'handoff') return true;
      if (m.content && (m.content.includes('[Workflow') || m.content.includes('[PLAN') || m.content.includes('[AUTO-PLAN'))) return true;
      // Skip unaddressed group messages at scale — too much noise
      return false;
    }

    return true;
  });
}

// --- Profile helpers ---

function getProfiles() {
  return cachedRead('profiles', () => {
    if (!fs.existsSync(PROFILES_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch { return {}; }
  }, 2000);
}

function saveProfiles(profiles) {
  invalidateCache('profiles');
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles));
}

// Built-in avatar SVGs — hash-based assignment
const BUILT_IN_AVATARS = [
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%2358a6ff'/%3E%3Ccircle cx='22' cy='26' r='4' fill='%23fff'/%3E%3Ccircle cx='42' cy='26' r='4' fill='%23fff'/%3E%3Crect x='20' y='38' width='24' height='4' rx='2' fill='%23fff'/%3E%3Crect x='14' y='12' width='6' height='10' rx='3' fill='%2358a6ff' stroke='%23fff' stroke-width='1.5'/%3E%3Crect x='44' y='12' width='6' height='10' rx='3' fill='%2358a6ff' stroke='%23fff' stroke-width='1.5'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%233fb950'/%3E%3Ccircle cx='22' cy='26' r='5' fill='%23fff'/%3E%3Ccircle cx='42' cy='26' r='5' fill='%23fff'/%3E%3Ccircle cx='22' cy='26' r='2' fill='%23333'/%3E%3Ccircle cx='42' cy='26' r='2' fill='%23333'/%3E%3Cpath d='M20 38 Q32 46 44 38' stroke='%23fff' fill='none' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23d29922'/%3E%3Crect x='16' y='22' width='12' height='8' rx='2' fill='%23fff'/%3E%3Crect x='36' y='22' width='12' height='8' rx='2' fill='%23fff'/%3E%3Ccircle cx='22' cy='26' r='2' fill='%23333'/%3E%3Ccircle cx='42' cy='26' r='2' fill='%23333'/%3E%3Cpath d='M24 40 H40' stroke='%23fff' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23f85149'/%3E%3Ccircle cx='22' cy='26' r='4' fill='%23fff'/%3E%3Ccircle cx='42' cy='26' r='4' fill='%23fff'/%3E%3Ccircle cx='22' cy='26' r='2' fill='%23333'/%3E%3Ccircle cx='42' cy='26' r='2' fill='%23333'/%3E%3Cpath d='M22 40 Q32 34 42 40' stroke='%23fff' fill='none' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23bc8cff'/%3E%3Ccircle cx='22' cy='28' r='4' fill='%23fff'/%3E%3Ccircle cx='42' cy='28' r='4' fill='%23fff'/%3E%3Cpath d='M16 18 L22 24' stroke='%23fff' stroke-width='2' stroke-linecap='round'/%3E%3Cpath d='M48 18 L42 24' stroke='%23fff' stroke-width='2' stroke-linecap='round'/%3E%3Cellipse cx='32' cy='42' rx='8' ry='4' fill='%23fff'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23f778ba'/%3E%3Ccircle cx='24' cy='26' r='6' fill='%23fff'/%3E%3Ccircle cx='40' cy='26' r='6' fill='%23fff'/%3E%3Ccircle cx='24' cy='26' r='3' fill='%23333'/%3E%3Ccircle cx='40' cy='26' r='3' fill='%23333'/%3E%3Cpath d='M26 40 Q32 46 38 40' stroke='%23fff' fill='none' stroke-width='2' stroke-linecap='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%2379c0ff'/%3E%3Crect x='17' y='23' width='10' height='6' rx='3' fill='%23fff'/%3E%3Crect x='37' y='23' width='10' height='6' rx='3' fill='%23fff'/%3E%3Cpath d='M22 38 L32 44 L42 38' stroke='%23fff' fill='none' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%237ee787'/%3E%3Ccircle cx='22' cy='26' r='4' fill='%23fff'/%3E%3Ccircle cx='42' cy='26' r='4' fill='%23fff'/%3E%3Ccircle cx='23' cy='25' r='2' fill='%23333'/%3E%3Ccircle cx='43' cy='25' r='2' fill='%23333'/%3E%3Cpath d='M20 38 Q32 48 44 38' stroke='%23fff' fill='none' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23e3b341'/%3E%3Cpath d='M18 22 L26 30 L18 30Z' fill='%23fff'/%3E%3Cpath d='M46 22 L38 30 L46 30Z' fill='%23fff'/%3E%3Crect x='24' y='38' width='16' height='6' rx='3' fill='%23fff'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%23ffa198'/%3E%3Ccircle cx='22' cy='26' r='5' fill='%23fff'/%3E%3Ccircle cx='42' cy='26' r='5' fill='%23fff'/%3E%3Ccircle cx='22' cy='27' r='2.5' fill='%23333'/%3E%3Ccircle cx='42' cy='27' r='2.5' fill='%23333'/%3E%3Cellipse cx='32' cy='42' rx='6' ry='3' fill='%23fff'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%230969da'/%3E%3Crect x='16' y='20' width='14' height='10' rx='2' fill='%23fff'/%3E%3Crect x='34' y='20' width='14' height='10' rx='2' fill='%23fff'/%3E%3Ccircle cx='23' cy='25' r='2' fill='%230969da'/%3E%3Ccircle cx='41' cy='25' r='2' fill='%230969da'/%3E%3Crect x='26' y='38' width='12' height='4' rx='2' fill='%23fff'/%3E%3C/svg%3E",
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='32' fill='%238250df'/%3E%3Ccircle cx='24' cy='24' r='5' fill='%23fff'/%3E%3Ccircle cx='40' cy='24' r='5' fill='%23fff'/%3E%3Ccircle cx='24' cy='24' r='2' fill='%238250df'/%3E%3Ccircle cx='40' cy='24' r='2' fill='%238250df'/%3E%3Cpath d='M20 38 Q32 50 44 38' stroke='%23fff' fill='none' stroke-width='3' stroke-linecap='round'/%3E%3Ccircle cx='32' cy='10' r='4' fill='%23fff'/%3E%3C/svg%3E",
];

function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function getDefaultAvatar(name) {
  return BUILT_IN_AVATARS[hashName(name) % BUILT_IN_AVATARS.length];
}

function createDefaultProfileRecord(name, createdAt = new Date().toISOString()) {
  return Object.assign({
    display_name: name,
    avatar: getDefaultAvatar(name),
    bio: '',
    role: '',
    created_at: createdAt,
  }, createDefaultContractMetadata());
}

// --- Workspace helpers ---

function ensureWorkspacesDir() {
  if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true, mode: 0o700 });
}

function getWorkspace(agentName, branch = currentBranch) {
  return canonicalState.readWorkspace(sanitizeName(agentName), { branch });
}

function saveWorkspace(agentName, data, options = {}) {
  const actor = options.actor || registeredName || agentName;
  const sessionId = options.sessionId !== undefined
    ? options.sessionId
    : (actor === registeredName ? currentSessionId : null);
  const result = canonicalState.saveWorkspace(agentName, data, {
    actor,
    sessionId,
    branch: options.branch || currentBranch,
    commandId: options.commandId || null,
    causationId: options.causationId || null,
    correlationId: options.correlationId || `workspace:${agentName}`,
    key: options.key,
    keys: options.keys,
    updatedAt: options.updatedAt,
  });
  return result && result.workspace ? result.workspace : data;
}

// --- Workflow helpers ---

function getWorkflows(branchName = currentBranch) {
  const branch = sanitizeBranchName(branchName || 'main');
  return cachedRead(`workflows:${branch}`, () => canonicalState.listWorkflows({ branch }), 2000);
}

function saveWorkflows(workflows, branchName = currentBranch) {
  const branch = sanitizeBranchName(branchName || 'main');
  return tasksWorkflowsState.saveWorkflows(workflows, { branch });
}

// --- Autonomous mode detection ---
function isAutonomousMode() {
  const workflows = getWorkflows();
  return workflows.some(wf => wf.status === 'active' && wf.autonomous === true);
}

function hasActiveWorkflowStep(agentName) {
  const workflows = getWorkflows();
  return workflows.some(wf =>
    workflowMatchesActiveBranch(wf) &&
    wf.status === 'active' &&
    wf.steps.some(s => s.assignee === agentName && s.status === 'in_progress')
  );
}

// --- Autonomous work loop helpers (get_work / verify_and_advance support) ---

function workflowMatchesActiveBranch(workflow, branchName = currentBranch) {
  return sanitizeBranchName((workflow && workflow.branch_id) || 'main') === sanitizeBranchName(branchName || 'main');
}

function findMyActiveWorkflowStep() {
  if (!registeredName) return null;
  const workflows = getWorkflows();
  for (const wf of workflows) {
    if (!workflowMatchesActiveBranch(wf)) continue;
    if (wf.status !== 'active') continue;
    const step = wf.steps.find(s => s.assignee === registeredName && s.status === 'in_progress');
    if (step) return { ...step, workflow_id: wf.id, workflow_name: wf.name };
  }
  return null;
}

function findReadySteps(workflow) {
  return workflow.steps.filter(step => {
    if (step.status !== 'pending') return false;
    if (!step.depends_on || step.depends_on.length === 0) return true;
    return step.depends_on.every(depId => {
      const dep = workflow.steps.find(s => s.id === depId);
      return dep && dep.status === 'done';
    });
  });
}

function findUnassignedTasks(skills) {
  const tasks = getTasks();
  // Exclude blocked_permanent tasks and tasks this agent already failed
  const pending = tasks.filter(t => {
    if (t.status !== 'pending' || t.assignee) return false;
    if (t.status === 'blocked_permanent') return false;
    if (t.attempt_agents && t.attempt_agents.includes(registeredName)) return false;
    return true;
  });
  if (pending.length === 0) return pending;

  // Skill-based routing: score by explicit skills + completed task history + KB skills
  const allTasks = tasks;
  const myDone = allTasks.filter(t => t.assignee === registeredName && t.status === 'done');
  const historyKeywords = new Set();
  for (const t of myDone) {
    const words = ((t.title || '') + ' ' + (t.description || '')).toLowerCase().split(/\W+/).filter(w => w.length > 3);
    words.forEach(w => historyKeywords.add(w));
  }
  // Add explicit skills
  if (skills) skills.forEach(s => historyKeywords.add(s.toLowerCase()));

  // Score each task by affinity (keyword overlap with agent's history + skills)
  // Scale fix: cache task keyword sets to avoid O(N*M) recomputation at 100 agents
  return pending.sort((a, b) => {
    const aKey = 'taskwords_' + a.id;
    const bKey = 'taskwords_' + b.id;
    const aWords = cachedRead(aKey, () => ((a.title || '') + ' ' + (a.description || '')).toLowerCase().split(/\W+/).filter(w => w.length > 3), 30000);
    const bWords = cachedRead(bKey, () => ((b.title || '') + ' ' + (b.description || '')).toLowerCase().split(/\W+/).filter(w => w.length > 3), 30000);
    const aScore = aWords.filter(w => historyKeywords.has(w)).length;
    const bScore = bWords.filter(w => historyKeywords.has(w)).length;
    return bScore - aScore;
  });
}

// Work stealing: find tasks from overloaded agents that can be split
function findStealableWork() {
  if (!registeredName) return null;
  const tasks = getTasks();
  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name);

  // Count in-progress tasks per agent
  const agentLoad = {};
  for (const name of aliveNames) {
    agentLoad[name] = tasks.filter(t => t.assignee === name && t.status === 'in_progress').length;
  }

  const myLoad = agentLoad[registeredName] || 0;
  if (myLoad > 0) return null; // Only steal if idle

  // Find agents with 2+ in-progress tasks — steal their oldest pending task
  for (const [name, load] of Object.entries(agentLoad)) {
    if (name === registeredName) continue;
    if (load < 2) continue;
    // Find a pending task assigned to this overloaded agent
    const stealable = tasks.find(t => t.assignee === name && t.status === 'pending');
    if (stealable) {
      return {
        task: stealable,
        from_agent: name,
        their_load: load,
        message: `${name} has ${load} tasks in progress. Stealing their pending task "${stealable.title}" to help.`,
      };
    }
  }
  return null;
}

function findHelpRequests() {
  // Scale fix: only read last 50 messages — help requests are always recent
  const messages = tailReadJsonl(getMessagesFile(currentBranch), 50);
  const recentCutoff = Date.now() - 300000;
  return messages.filter(m => {
    if (new Date(m.timestamp).getTime() < recentCutoff) return false;
    if (m.from === registeredName) return false;
    if (m.system && (m.content.includes('[HELP NEEDED]') || m.content.includes('[ESCALATION]'))) return true;
    return false;
  }).map(m => ({ id: m.id, from: m.from, content: m.content, timestamp: m.timestamp }));
}

function findPendingReviews() {
  const reviews = getReviews();
  return reviews.filter(r => r.status === 'pending' && r.requested_by !== registeredName);
}

function findBlockedTasks() {
  const tasks = getTasks();
  return tasks.filter(t => t.status === 'blocked');
}

function findUpcomingStepsForMe() {
  if (!registeredName) return null;
  const workflows = getWorkflows();
  for (const wf of workflows) {
    if (!workflowMatchesActiveBranch(wf)) continue;
    if (wf.status !== 'active') continue;
    const step = wf.steps.find(s => s.assignee === registeredName && s.status === 'pending');
    if (step) return { ...step, workflow_id: wf.id, workflow_name: wf.name };
  }
  return null;
}

async function listenWithTimeout(timeoutMs) {
  // Check immediately first
  const immediate = getUnconsumedMessages(registeredName);
  if (immediate.length > 0) return immediate;

  // Use fs.watch for instant wake on new messages (falls back to polling)
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { if (watcher) watcher.close(); } catch {}
      clearTimeout(timer);
      resolve(result);
    };

    let watcher;
    try {
      const msgFile = getMessagesFile(currentBranch);
      watcher = fs.watch(msgFile, () => {
        const batch = getUnconsumedMessages(registeredName);
        if (batch.length > 0) done(batch);
      });
      watcher.on('error', () => {}); // ignore watch errors
    } catch {
      // fs.watch not available — fall back to polling
      const pollInterval = setInterval(() => {
        const batch = getUnconsumedMessages(registeredName);
        if (batch.length > 0) {
          clearInterval(pollInterval);
          done(batch);
        }
      }, 1000);
      setTimeout(() => { clearInterval(pollInterval); done([]); }, timeoutMs);
      return;
    }

    // Timeout: don't wait forever
    const timer = setTimeout(() => done([]), timeoutMs);
  });
}

// --- Branch helpers ---

function getBranches() {
  if (!fs.existsSync(BRANCHES_FILE)) return { main: { created_at: new Date().toISOString(), created_by: 'system', forked_from: null, fork_point: null } };
  try { return JSON.parse(fs.readFileSync(BRANCHES_FILE, 'utf8')); } catch { return { main: { created_at: new Date().toISOString(), created_by: 'system', forked_from: null, fork_point: null } }; }
}

function saveBranches(branches) {
  fs.writeFileSync(BRANCHES_FILE, JSON.stringify(branches));
}

function getMessagesFile(branch = currentBranch) {
  return branchPaths.getMessagesFile(branch);
}

function getHistoryFile(branch = currentBranch) {
  return branchPaths.getHistoryFile(branch);
}

function getChannelMessagesFile(channelName, branch = currentBranch) {
  return branchPaths.getChannelMessagesFile(channelName, branch);
}

function getChannelHistoryFile(channelName, branch = currentBranch) {
  return branchPaths.getChannelHistoryFile(channelName, branch);
}

function appendConversationMessage(message, messageFile, historyFile) {
  return messagesState.appendConversationMessage(message, { messageFile, historyFile });
}

function appendBranchConversationMessage(message, branch = currentBranch) {
  return appendConversationMessage(message, getMessagesFile(branch), getHistoryFile(branch));
}

function appendChannelConversationMessage(message, channel, branch = currentBranch) {
  return appendConversationMessage(message, getChannelMessagesFile(channel, branch), getChannelHistoryFile(channel, branch));
}

function appendAssistantReplyMessage(message) {
  return messagesState.appendAuxiliaryMessage(message, ASSISTANT_REPLIES_FILE);
}

function emptyCompressedState() {
  return { segments: [], last_compressed_at: null };
}

function seedBranchChannelProjection(channelName, branch, sourceBranch = 'main', copyMessages = true) {
  const targetHistoryFile = getChannelHistoryFile(channelName, branch);
  const targetMessagesFile = getChannelMessagesFile(channelName, branch);
  const sourceHistoryFile = sourceBranch ? getChannelHistoryFile(channelName, sourceBranch) : null;
  const sourceMessagesFile = sourceBranch ? getChannelMessagesFile(channelName, sourceBranch) : null;

  if (!fs.existsSync(targetHistoryFile)) {
    if (!copyScopedFileIfPresent(sourceHistoryFile, targetHistoryFile)) writeJsonlFileRaw(targetHistoryFile, []);
  }

  if (!fs.existsSync(targetMessagesFile)) {
    if (copyMessages && !copyScopedFileIfPresent(sourceMessagesFile, targetMessagesFile)) {
      writeJsonlFileRaw(targetMessagesFile, []);
    }
    if (!copyMessages) {
      writeJsonlFileRaw(targetMessagesFile, []);
    }
  }
}

function ensureBranchLocalP0State(branch) {
  if (!branch || branch === 'main') return;

  ensureJsonProjection(getAcksFile(branch), getAcksFile('main'), {});
  ensureJsonProjection(getReadReceiptsFile(branch), getReadReceiptsFile('main'), {});
  ensureJsonProjection(getConfigFile(branch), getConfigFile('main'), {});
  ensureJsonProjection(getCompressedFile(branch), getCompressedFile('main'), emptyCompressedState);
  ensureJsonProjection(getChannelsFile(branch), getChannelsFile('main'), defaultChannelsData);

  if (listConsumedFiles(branch).length === 0) {
    for (const consumedEntry of listConsumedFiles('main')) {
      ensureJsonProjection(consumedFile(consumedEntry.agentName, branch), consumedEntry.filePath, []);
    }
  }

  invalidateCache(`channels:${branch}`);
  const channels = getChannelsData(branch);
  for (const channelName of Object.keys(channels)) {
    if (channelName === 'general') continue;
    seedBranchChannelProjection(channelName, branch, 'main', true);
  }
}

function filterAckLikeMapByMessageIds(sourceMap, allowedIds) {
  const filtered = {};
  for (const [messageId, value] of Object.entries(sourceMap || {})) {
    if (allowedIds.has(messageId)) filtered[messageId] = value;
  }
  return filtered;
}

function filterCompressedForFork(compressed, forkTimestampMs) {
  const segments = Array.isArray(compressed && compressed.segments) ? compressed.segments : [];
  return {
    ...(compressed && typeof compressed === 'object' ? compressed : emptyCompressedState()),
    segments: segments.filter((segment) => {
      const segmentTime = new Date(segment.to_time || 0).getTime();
      return !Number.isFinite(forkTimestampMs) || !Number.isFinite(segmentTime) || segmentTime <= forkTimestampMs;
    }),
  };
}

function remapBranchIdsForFork(value, sourceBranch, targetBranch) {
  if (Array.isArray(value)) {
    return value.map((entry) => remapBranchIdsForFork(entry, sourceBranch, targetBranch));
  }

  if (!value || typeof value !== 'object') return value;

  const cloned = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'branch_id' && entry === sourceBranch) {
      cloned[key] = targetBranch;
      continue;
    }
    cloned[key] = remapBranchIdsForFork(entry, sourceBranch, targetBranch);
  }
  return cloned;
}

function copyBranchLocalP0StateForFork(sourceBranch, targetBranch, snapshot) {
  const {
    visibleMessageIds,
    forkTimestampMs,
    sourceChannels,
    forkedChannelHistories,
  } = snapshot;

  const sourceConfig = getConfig(sourceBranch);
  writeJsonFileRaw(getConfigFile(targetBranch), sourceConfig);
  writeJsonFileRaw(getAcksFile(targetBranch), filterAckLikeMapByMessageIds(getAcks(sourceBranch), visibleMessageIds));
  writeJsonFileRaw(getReadReceiptsFile(targetBranch), filterAckLikeMapByMessageIds(getReadReceipts(sourceBranch), visibleMessageIds));
  writeJsonFileRaw(getCompressedFile(targetBranch), filterCompressedForFork(getCompressed(sourceBranch), forkTimestampMs));
  writeJsonFileRaw(getChannelsFile(targetBranch), normalizeChannelsData(sourceChannels));
  writeJsonFileRaw(
    branchPaths.getTasksFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getTasksFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getWorkflowsFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getWorkflowsFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  if (fs.existsSync(branchPaths.getEvidenceFile(sourceBranch))) {
    writeJsonFileRaw(
      branchPaths.getEvidenceFile(targetBranch),
      remapBranchIdsForFork(readJsonFileSafe(branchPaths.getEvidenceFile(sourceBranch), null), sourceBranch, targetBranch)
    );
  }
  writeJsonFileRaw(
    branchPaths.getDecisionsFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getDecisionsFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getKnowledgeBaseFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getKnowledgeBaseFile(sourceBranch), {}), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getReviewsFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getReviewsFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getDependenciesFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getDependenciesFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getVotesFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getVotesFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getRulesFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getRulesFile(sourceBranch), []), sourceBranch, targetBranch)
  );
  writeJsonFileRaw(
    branchPaths.getProgressFile(targetBranch),
    remapBranchIdsForFork(readJsonFileSafe(branchPaths.getProgressFile(sourceBranch), {}), sourceBranch, targetBranch)
  );
  invalidateCache(`channels:${targetBranch}`);
  invalidateCache(`tasks:${targetBranch}`);
  invalidateCache(`workflows:${targetBranch}`);
  invalidateCache(`decisions:${targetBranch}`);
  invalidateCache(`kb:${targetBranch}`);
  invalidateCache(`reviews:${targetBranch}`);
  invalidateCache(`deps:${targetBranch}`);
  invalidateCache(`votes:${targetBranch}`);
  invalidateCache(`rules:${targetBranch}`);
  invalidateCache(`progress:${targetBranch}`);

  for (const consumedEntry of listConsumedFiles(sourceBranch)) {
    const ids = readJsonFileSafe(consumedEntry.filePath, []);
    const filteredIds = Array.isArray(ids) ? ids.filter((id) => visibleMessageIds.has(id)) : [];
    writeJsonFileRaw(consumedFile(consumedEntry.agentName, targetBranch), filteredIds);
  }

  for (const channelName of Object.keys(sourceChannels)) {
    if (channelName === 'general') continue;
    writeJsonlFileRaw(getChannelHistoryFile(channelName, targetBranch), forkedChannelHistories[channelName] || []);
    writeJsonlFileRaw(getChannelMessagesFile(channelName, targetBranch), []);
  }
}

function copyBranchLocalWorkspaceStateForFork(sourceBranch, targetBranch) {
  const sourceDir = branchPaths.getWorkspacesDir(sourceBranch);
  if (!fs.existsSync(sourceDir)) return;

  const targetDir = branchPaths.getWorkspacesDir(targetBranch);
  fs.mkdirSync(targetDir, { recursive: true, mode: 0o700 });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const sourceFile = path.join(sourceDir, entry.name);
    const targetFile = path.join(targetDir, entry.name);
    writeJsonFileRaw(targetFile, readJsonFileSafe(sourceFile, {}));
  }
}

function getRegisteredProvider() {
  if (!registeredName) return null;
  try {
    const agents = getAgents();
    return (agents[registeredName] && agents[registeredName].provider) || null;
  } catch {
    return null;
  }
}

function ensureActiveBranchSession(branchName, options = {}) {
  if (!registeredName) return null;
  try {
    const activation = sessionsState.activateSession({
      agentName: registeredName,
      branchName,
      at: options.at,
      reason: options.reason || 'branch_activate',
      provider: options.provider || getRegisteredProvider(),
    });
    currentSessionId = activation && activation.session ? activation.session.session_id : null;
    return activation;
  } catch {
    return null;
  }
}

function touchCurrentSession(options = {}) {
  if (!registeredName || !currentSessionId) return null;
  try {
    return sessionsState.touchSession({
      sessionId: currentSessionId,
      branchName: currentBranch,
      at: options.at,
      heartbeat: !!options.heartbeat,
    });
  } catch {
    return null;
  }
}

function activateBranch(branchName, options = {}) {
  const previousBranch = currentBranch;
  const shouldRotateSession = !!registeredName && !!currentSessionId && (options.force || previousBranch !== branchName);

  if (shouldRotateSession) {
    try {
      sessionsState.transitionSession({
        sessionId: currentSessionId,
        branchName: previousBranch,
        state: 'interrupted',
        reason: options.previousReason || 'branch_switch',
        at: options.at,
      });
    } catch {}
    currentSessionId = null;
  }

  currentBranch = branchName;
  resetBranchRuntimeOffsets();

  if (!options.skipAgentBranchPersist) {
    try {
      canonicalState.updateAgentBranch(registeredName, branchName, {
        actorAgent: registeredName,
        sessionId: currentSessionId,
        at: options.at,
        reason: options.reason || 'branch_activate',
      });
    } catch {}
  }

  return ensureActiveBranchSession(branchName, {
    at: options.at,
    reason: options.reason || 'branch_activate',
    provider: options.provider,
  });
}

function getAuthoritativeSessionSummary(agentName = registeredName, branchName = currentBranch, sessionId = currentSessionId) {
  if (!agentName) return null;

  const index = typeof sessionsState.loadIndex === 'function' ? sessionsState.loadIndex() : null;
  const indexedAt = index && index.updated_at ? index.updated_at : new Date().toISOString();
  let resolvedSessionId = sessionId || null;

  if (!resolvedSessionId && index && index.by_agent && index.by_agent[agentName]) {
    const agentIndex = index.by_agent[agentName];
    if (agentIndex.active_branch_id === branchName && agentIndex.active_session_id) {
      resolvedSessionId = agentIndex.active_session_id;
    }
  }

  if (resolvedSessionId && typeof sessionsState.getSessionSummary === 'function') {
    const summary = sessionsState.getSessionSummary(resolvedSessionId, branchName, { indexedAt });
    if (summary) return summary;
  }

  if (typeof sessionsState.getLatestSessionSummaryForAgent === 'function') {
    const summary = sessionsState.getLatestSessionSummaryForAgent(branchName, agentName, { indexedAt });
    if (summary) return summary;
  }

  const latest = sessionsState.getLatestSessionForAgent(branchName, agentName);
  if (!latest) return null;
  if (typeof sessionsState.summarizeSession === 'function') {
    return sessionsState.summarizeSession(latest, { indexedAt });
  }
  return latest;
}

function projectEvidenceReference(evidenceRef, branchName = currentBranch) {
  if (!evidenceRef || !evidenceRef.evidence_id) return null;
  try {
    return canonicalState.projectEvidence(evidenceRef.branch_id || branchName, evidenceRef);
  } catch {
    return null;
  }
}

function listCheckpointFallbacks(agentName = registeredName, options = {}) {
  if (!agentName) return [];
  const workspace = getWorkspace(agentName);
  const checkpointEntries = workspace && workspace._checkpoints && typeof workspace._checkpoints === 'object'
    ? Object.values(workspace._checkpoints)
    : [];

  return checkpointEntries
    .filter((entry) => {
      if (!entry || typeof entry !== 'object') return false;
      if (options.workflowId && entry.workflow_id !== options.workflowId) return false;
      if (options.stepId && entry.step_id !== options.stepId) return false;
      return true;
    })
    .sort((left, right) => Date.parse(right.saved_at || '') - Date.parse(left.saved_at || ''))
    .map((entry) => ({
      saved_at: entry.saved_at || null,
      workflow_id: entry.workflow_id || null,
      step_id: entry.step_id || null,
      progress: entry.progress,
    }));
}

function collectRecentEvidenceContext(options = {}) {
  const agentName = options.agentName || registeredName;
  const branchName = options.branchName || currentBranch;
  const sessionSummary = options.sessionSummary || null;
  const workflowId = options.workflowId || null;
  const stepId = Object.prototype.hasOwnProperty.call(options, 'stepId') ? options.stepId : null;
  const limit = Number.isFinite(options.limit) ? options.limit : 3;
  const excludeEvidenceIds = new Set(Array.isArray(options.excludeEvidenceIds) ? options.excludeEvidenceIds.filter(Boolean) : []);

  let store = { records: [] };
  try {
    store = canonicalState.readEvidence(branchName) || store;
  } catch {}

  return (Array.isArray(store.records) ? store.records : [])
    .filter((record) => {
      if (!record || !record.evidence_id || excludeEvidenceIds.has(record.evidence_id)) return false;
      if (stepId != null && record.step_id === stepId) return true;
      if (workflowId && record.workflow_id === workflowId) return true;
      if (sessionSummary && sessionSummary.session_id && record.recorded_by_session === sessionSummary.session_id) return true;
      return record.recorded_by === agentName;
    })
    .sort((left, right) => Date.parse(right.recorded_at || '') - Date.parse(left.recorded_at || ''))
    .slice(0, limit)
    .map((record) => {
      const evidence = projectEvidenceReference({
        evidence_id: record.evidence_id,
        branch_id: record.branch_id || branchName,
        recorded_at: record.recorded_at,
        recorded_by_session: record.recorded_by_session,
      }, branchName);
      if (!evidence) return null;
      return {
        subject_kind: record.subject_kind || 'completion',
        task_id: record.task_id || null,
        task_title: record.task_title || null,
        workflow_id: record.workflow_id || null,
        workflow_name: record.workflow_name || null,
        step_id: record.step_id || null,
        step_description: record.step_description || null,
        flagged: !!record.flagged,
        flag_reason: record.flag_reason || null,
        evidence,
      };
    })
    .filter(Boolean);
}

function collectWorkflowDependencyEvidence(step, branchName = currentBranch) {
  if (!step || !step.workflow_id || !Array.isArray(step.depends_on) || step.depends_on.length === 0) return [];

  const workflow = getWorkflows().find((entry) => entry.id === step.workflow_id);
  if (!workflow) return [];

  return step.depends_on
    .map((dependencyId) => workflow.steps.find((entry) => entry.id === dependencyId))
    .filter(Boolean)
    .map((dependencyStep) => {
      const evidence = dependencyStep.verification || projectEvidenceReference(dependencyStep.evidence_ref, branchName);
      if (!evidence) return null;
      return {
        step_id: dependencyStep.id,
        step_description: dependencyStep.description || null,
        completed_by: dependencyStep.completed_by || dependencyStep.assignee || null,
        completed_at: dependencyStep.completed_at || null,
        flagged: !!dependencyStep.flagged,
        flag_reason: dependencyStep.flag_reason || null,
        evidence,
      };
    })
    .filter(Boolean);
}

function collectMessageHandoffContext(messages, branchName = currentBranch) {
  return messages
    .map((message) => {
      const evidence = projectEvidenceReference(message.evidence_ref, branchName);
      if (!evidence && !message.workflow_id && !message.step_id && !message.session_id) return null;
      return {
        message_id: message.id,
        from: message.from,
        type: message.type || null,
        workflow_id: message.workflow_id || null,
        workflow_name: message.workflow_name || null,
        step_id: message.step_id || null,
        session_id: message.session_id || null,
        timestamp: message.timestamp,
        preview: typeof message.content === 'string' ? message.content.substring(0, 200) : '',
        evidence,
      };
    })
    .filter(Boolean)
    .slice(0, 5);
}

function buildAuthoritativeResumeContext(options = {}) {
  const agentName = options.agentName || registeredName;
  const branchName = options.branchName || currentBranch;
  const sessionSummary = options.sessionSummary || getAuthoritativeSessionSummary(agentName, branchName, options.sessionId || currentSessionId);
  const activeStep = Object.prototype.hasOwnProperty.call(options, 'activeStep')
    ? options.activeStep
    : (agentName === registeredName ? findMyActiveWorkflowStep() : null);
  const upcomingStep = Object.prototype.hasOwnProperty.call(options, 'upcomingStep')
    ? options.upcomingStep
    : (activeStep ? null : (agentName === registeredName ? findUpcomingStepsForMe() : null));
  const focalStep = activeStep || upcomingStep;
  const dependencyEvidence = focalStep ? collectWorkflowDependencyEvidence(focalStep, branchName) : [];
  const recentEvidence = collectRecentEvidenceContext({
    agentName,
    branchName,
    sessionSummary,
    workflowId: focalStep && focalStep.workflow_id ? focalStep.workflow_id : null,
    stepId: activeStep ? activeStep.id : null,
    limit: Number.isFinite(options.evidenceLimit) ? options.evidenceLimit : 3,
    excludeEvidenceIds: dependencyEvidence.map((entry) => entry && entry.evidence && entry.evidence.evidence_ref ? entry.evidence.evidence_ref.evidence_id : null),
  });

  return {
    session_summary: sessionSummary || null,
    active_step: activeStep || null,
    upcoming_step: upcomingStep || null,
    dependency_evidence: dependencyEvidence,
    recent_evidence: recentEvidence,
  };
}

// --- Dynamic Guide (progressive disclosure) ---

// Cache guide output — only rebuild when rules.json or agent count changes
let _guideCache = { key: null, result: null };
function buildGuide(level = 'standard') {
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  const mode = getConfig().conversation_mode || 'direct';

  // Cache check: reuse cached guide if nothing changed (saves rebuilding 20-50 rules)
  let rulesMtime = 0;
  try {
    const rulesFile = branchPaths.getRulesFile(currentBranch);
    rulesMtime = fs.existsSync(rulesFile) ? fs.statSync(rulesFile).mtimeMs : 0;
  } catch {}
  let profilesMtime = 0;
  try { profilesMtime = fs.existsSync(PROFILES_FILE) ? fs.statSync(PROFILES_FILE).mtimeMs : 0; } catch {}
  const cacheKey = `${level}:${currentBranch}:${aliveCount}:${mode}:${registeredName}:${rulesMtime}:${profilesMtime}`;
  if (_guideCache.key === cacheKey && _guideCache.result) return _guideCache.result;

  const channels = getChannelsData();
  const hasChannels = Object.keys(channels).length > 1; // more than just #general
  const autonomousActive = isAutonomousMode();

  // --- Team Intelligence: detect agent role from profiles ---
  const profiles = getProfiles();
  const myContract = resolveAgentContract(profiles[registeredName] || {});
  const myRole = myContract.role_token || '';
  const myRoleLabel = myContract.role || '';
  const myRoleDisplay = myRoleLabel ? myRoleLabel.toLowerCase() : myRole;
  const contractGuidance = buildGuideContractAdvisory(myContract);
  const contractMetadata = buildRuntimeContractMetadata(myContract);
  const guideContractAdvisory = contractGuidance
    ? Object.assign({
      archetype: contractMetadata.contract ? contractMetadata.contract.archetype : null,
      declared_archetype: contractMetadata.archetype || null,
      role: myRoleLabel || '',
      role_token: myRole || null,
      skills: contractMetadata.skills,
      effective_skills: contractMetadata.contract ? contractMetadata.contract.effective_skills : [],
      contract_mode: contractMetadata.contract_mode,
    }, contractGuidance)
    : null;
  const isQualityLead = myRole === 'quality';
  const isMonitor = myRole === 'monitor';
  const isAdvisor = myRole === 'advisor';
  let qualityLeadName = null;
  for (const [pName, prof] of Object.entries(profiles)) {
    if (resolveAgentContract(prof).role_token === 'quality' && pName !== registeredName) { qualityLeadName = pName; break; }
  }

  const rules = [];

  if (guideContractAdvisory) {
    rules.push(`CONTRACT (${guideContractAdvisory.contract_mode.toUpperCase()}): ${guideContractAdvisory.summary}`);
    if (guideContractAdvisory.recommendation) {
      rules.push(`CONTRACT FOCUS: ${guideContractAdvisory.recommendation}`);
    }
    if (guideContractAdvisory.migration_note) {
      rules.push(`CONTRACT NOTE: ${guideContractAdvisory.migration_note}`);
    }
  }

  // === MANAGED MODE: agents wait for manager's floor control ===
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const isManager = managed.manager === registeredName;
    if (isManager) {
      rules.push('YOU ARE THE MANAGER. You control the conversation flow, assign work, and track progress.');
      rules.push('TASK MANAGEMENT: Use create_task(title, description, assignee) to assign work to agents. Use create_workflow(name, steps) to create multi-step plans. These show up in the Tasks and Plan tabs of the dashboard.');
      rules.push('YOUR MANAGER LOOP: 1) Plan the work — create tasks and workflows for the team. 2) Use yield_floor(agent) to give each agent their turn to speak. 3) Call listen() to wait for responses. 4) When agents report completion, use update_task(id, status="done") to mark tasks done and advance_workflow() to move the plan forward. 5) Assign next tasks and repeat.');
      rules.push('PHASES: Use set_phase("discussion") for brainstorming, set_phase("planning") to assign tasks, set_phase("execution") for agents to work, set_phase("review") to collect results.');
      rules.push('Use send_message() to give instructions. Use broadcast() for team announcements.');
      rules.push('STRICT RULE: After EVERY action, call listen() to wait for responses. NEVER use sleep(). Your loop is: act → listen() → act → listen(). This loop NEVER ends.');
    } else {
      rules.push('YOU ARE IN MANAGED MODE. The manager controls who speaks. Call listen() to wait for your turn.');
      rules.push('TASK TRACKING: When the manager assigns you a task, call update_task(id, status="in_progress") to claim it. When you finish, call update_task(id, status="done") and report back to the manager. If your task is a workflow step, call advance_workflow() after completing it.');
      rules.push('YOUR LOOP: 1) Call listen() — wait for messages and floor assignments. 2) When you receive work, update the task to "in_progress", do the work, update to "done", respond to the manager. 3) Call listen() again immediately. This loop NEVER ends.');
      rules.push('STRICT RULES: NEVER use sleep(). NEVER use check_messages() in a loop. NEVER call get_work() in managed mode. Your ONLY loop is: listen() → work → update task → respond → listen(). If listen() times out, call listen() again immediately.');
    }
    rules.push('Keep messages to 2-3 paragraphs max.');
    rules.push('When you finish work, report what you did and what files you changed.');
  }
  // === AUTONOMOUS MODE: completely different guide ===
  else if (autonomousActive) {
    if (isAdvisor) {
      // Advisor Agent: strategic thinker — reads everything, suggests improvements
      rules.push('YOU ARE THE ADVISOR. You do NOT write code. You READ all messages and completed work, then give strategic ideas, suggestions, and improvements to the team.');
      rules.push('YOUR ADVISOR LOOP: 1) Call get_work() — it returns recent messages, completed tasks, active workflows, KB lessons, and decisions. 2) THINK DEEPLY about what you see: Are there better approaches? Missing features? Architectural issues? Assumptions that should be challenged? 3) Send your insights to the team via send_message. Be specific and actionable. 4) Call get_work() again. NEVER stop thinking.');
      rules.push('WHAT TO LOOK FOR: Patterns the team is missing. Better approaches to current problems. Connections between different agents\' work. Assumptions that need challenging. Missing edge cases. Architectural improvements. Features the team should build next.');
      rules.push('HOW TO ADVISE: Send suggestions via send_message to specific agents or broadcast to the team. Be concise and actionable. Explain WHY your suggestion is better, not just WHAT to do differently. Reference specific code or messages when possible.');
      rules.push('NEVER ask the user what to do. You generate ideas from observing the team. The team decides whether to follow your advice.');
      } else if (isMonitor) {
        // Monitor Agent: system overseer — watches the team, not the code
        rules.push('YOU ARE THE SYSTEM MONITOR. You do NOT write code. You do NOT do regular work. You watch the TEAM and keep it functioning.');
        rules.push('YOUR MONITOR LOOP: 1) Call get_work() — it returns a health check report instead of a work assignment. 2) Analyze the report: who is idle? Who is stuck? Are tasks bouncing between agents? Is the queue growing? 3) INTERVENE WITH BOUNDED SIGNALS: nudge idle agents via send_message, surface explicit escalation context, and only allow ownership moves when the watchdog policy explicitly authorizes the recovery. 4) Log every intervention to your workspace via workspace_write(key="_monitor_log"). 5) Call get_work() again. NEVER stop monitoring.');
        rules.push('WHAT TO WATCH FOR: Idle agents (>2 minutes without activity). Circular escalations (same task rejected by 3+ agents). Queue buildup (more pending tasks than agents can handle). Stuck workflow steps (>15 minutes in progress). Agents with high rejection rates.');
        rules.push('HOW TO INTERVENE: Use send_message to nudge idle agents. Use broadcast for team-wide alerts and explicit escalation context. If ownership needs to move, use only the explicit policy-approved recovery path for unavailable owners; do not improvise broader reassignment.');
        rules.push('NEVER ask the user what to do. You ARE the system intelligence. The team relies on you to keep them productive.');
      } else if (isQualityLead) {
      rules.push('YOU ARE THE QUALITY LEAD. Your job is to review ALL work from the team, find bugs, suggest improvements, and keep the team iterating until the work is genuinely excellent. Never approve without checking. Never let mediocre work pass.');
      rules.push('YOUR QUALITY LOOP: 1) Call get_work() — prioritize review requests and completed steps. 2) Review the work thoroughly — read the code, check for bugs, verify correctness. 3) If good: approve via submit_review() and call verify_and_advance(). 4) If needs improvement: use submit_review(status="changes_requested") with specific feedback. The author will fix and re-submit automatically. 5) Call get_work() again. NEVER stop reviewing.');
      rules.push('QUALITY STANDARDS: Check for bugs, edge cases, security issues, code style, and correctness. Read the actual files — do not trust summaries. If something looks wrong, flag it.');
      rules.push('NEVER ask the user what to do. NEVER wait for human approval. You ARE the approval gate. The team works, you review, they improve, you re-review. This cycle continues until the work is excellent.');
    } else {
      rules.push('YOUR WORK LOOP (follow this ALWAYS): 1) Call get_work() — it gives you your next assignment. 2) Do the work — write code, run tests, implement features. 3) Call verify_and_advance() — verify your work, auto-advance the workflow. 4) Call get_work() again — get your next assignment. 5) NEVER stop. NEVER wait for approval. NEVER call listen_group() in autonomous mode — use get_work() instead.');
      rules.push(qualityLeadName
        ? 'SELF-CONTINUATION: After completing work, report results to ' + qualityLeadName + ' (Quality Lead) via send_message. After Quality Lead approves, find next work via get_work(). NEVER ask the user what to do next — the system assigns work automatically.'
        : 'SELF-CONTINUATION: After completing work, call get_work() to find your next task. NEVER ask the user what to do next — the system assigns work automatically. NEVER stop working.');
    }
    rules.push('IF STUCK: Try a different approach (max 3 attempts). Ask the team for help via send_message. If still stuck after help, move to next available task. NEVER wait silently. ALWAYS be working on something.');
    rules.push('IF YOUR WORK FAILS: Analyze WHY it failed. Record the learning via verify_and_advance(learnings: "..."). Retry with improvements. After 3 retries, escalate to team and move to other work.');
    rules.push('IF NOTHING TO DO: get_work() handles this — it checks workflows, tasks, reviews, and help requests. It will find you something. Trust the loop.');
    rules.push('Keep messages to 2-3 paragraphs max.');
    rules.push('When you finish work, report what you did and what files you changed.');
    rules.push('Lock files before editing shared code (lock_file / unlock_file).');
    // UE5 safety rules — prevent concurrent editor operations
    rules.push('UE5 SAFETY: BEFORE any Unreal Engine editor operation (spawning, modifying scene, placing assets): call lock_file("ue5-editor"). BEFORE compiling/building: call lock_file("ue5-compile"). Unlock immediately after. Only ONE agent can hold each lock — others must wait.');
    rules.push('Log team decisions with log_decision() so they are not re-debated.');

    // User-customizable project-specific rules
    const guideFile = path.join(DATA_DIR, 'guide.md');
    let projectRules = [];
    if (fs.existsSync(guideFile)) {
      try {
        const content = fs.readFileSync(guideFile, 'utf8').trim();
        if (content) projectRules = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
      } catch {}
    }

    // Inject dashboard-managed rules into guide
    const dashboardRules = getRules().filter(r => r.active);
    if (dashboardRules.length > 0) {
      for (const r of dashboardRules) {
        rules.push(`[${r.category.toUpperCase()}] ${r.text}`);
      }
    }

    return {
      rules,
      project_rules: projectRules.length > 0 ? projectRules : undefined,
      tier_info: `${rules.length} rules (AUTONOMOUS MODE, ${aliveCount} agents, role: ${myRoleDisplay || 'unassigned'})`,
      first_steps: isAdvisor
        ? '1. Call get_work() to get team context (messages, tasks, decisions). 2. Think deeply about patterns, improvements, missing features. 3. Send insights to team. 4. Call get_work() again. Never stop thinking.'
        : isMonitor
        ? '1. Call get_work() to get system health report. 2. Analyze: idle agents, stuck tasks, circular escalations. 3. Intervene: reassign, nudge, rebalance. 4. Call get_work() again. Never stop monitoring.'
        : isQualityLead
        ? '1. Call get_work() to find work to review. 2. Review thoroughly. 3. Approve or request changes. 4. Call get_work() again. Never stop.'
        : '1. Call get_work() to get your assignment. 2. Do the work. 3. Call verify_and_advance(). 4. Call get_work() again. Never stop.',
      autonomous_mode: true,
      your_role: myRoleDisplay || undefined,
      ...(guideContractAdvisory ? { contract_advisory: guideContractAdvisory } : {}),
      quality_lead: qualityLeadName || undefined,
      tool_categories: {
        'WORK LOOP': 'get_work, verify_and_advance, retry_with_improvement',
        'MESSAGING': 'send_message, broadcast, check_messages, get_history, handoff, share_file',
        'COORDINATION': 'get_briefing, log_decision, get_decisions, kb_write, kb_read, kb_list',
        'TASKS': 'create_task, update_task, list_tasks, suggest_task',
        'QUALITY': 'request_review, submit_review',
        'SAFETY': 'lock_file, unlock_file',
      },
    };
  }

  // === STANDARD MODE (non-autonomous) ===
  // Self-continuation rules apply in standard mode too (for 2+ agent teams)
  if (aliveCount >= 2 && (mode === 'group' || mode === 'managed')) {
    if (isQualityLead) {
      rules.push('YOU ARE THE QUALITY LEAD. Review all work from teammates. Use submit_review() to approve or request changes. Never let mediocre work pass. Never ask the user what to do — you are the approval gate.');
    } else if (qualityLeadName) {
      rules.push('SELF-CONTINUATION: After completing work, report to ' + qualityLeadName + ' (Quality Lead). After approval, find next work. NEVER ask the user what to do next.');
    }
  }

  // Tier 0 — THE one rule (always included at every level)
  const listenCmd = isManagedMode() ? 'listen()' : (mode === 'group' ? 'listen_group()' : 'listen()');
  rules.push(`AFTER EVERY ACTION, call ${listenCmd}. This is how you receive messages. NEVER skip this. NEVER use sleep(). NEVER poll with check_messages(). ${listenCmd} is your ONLY way to receive messages.`);
  rules.push(`EMPTY-RETURN RULE: When ${listenCmd} returns no messages, that is NORMAL — it means "no messages yet", NOT a failure. Call ${listenCmd} again immediately. Codex CLI may terminate the call near 120s due to its own tool-call timeout; that is the host's limit, not an error. The loop never ends.`);
  rules.push('DASHBOARD IS YOUR VOICE: Your CLI terminal is invisible to the owner and to other agents. EVERYTHING you want anyone to see — replies to Dashboard/Owner, status updates, questions for teammates, progress reports, "starting work", "done", "blocked on X" — MUST go through send_message() or broadcast(). Talk like humans on a team chat: announce when you start, when you finish, when you need help. Never just narrate in terminal and assume anyone will read it — they cannot.');
  rules.push('DASHBOARD REPLY RULE: When a message arrives from "Dashboard" or "Owner", reply via send_message(to="Dashboard", content=...). Do NOT narrate the reply in your terminal. If a message targets a different agent (msg.to is not you), do not answer on their behalf — let the addressed agent reply. After send_message, call ' + listenCmd + ' again immediately.');
  rules.push('TOOL ERROR RECOVERY: If ' + listenCmd + ' itself returns a tool error (e.g. "timed out awaiting tools/call"), that is a transport hiccup — IMMEDIATELY call ' + listenCmd + ' again. Do NOT summarize in terminal, do NOT stop the loop, do NOT treat it as "done". The loop only ends when the owner tells you to stop via send_message.');
  rules.push('SELF-RELIANCE RULE: When the Owner gives you a goal, treat it as a goal — NOT a checklist of approval gates. Break it down yourself, pick tasks via get_work(), and work until done. NEVER stop to ask "should I do X?" or "do you want me to Y?" for decisions you and the team can make. Your default answer to uncertainty is: decide, log_decision() to record the choice, continue. Asking the Owner for permission on small decisions is the failure mode — deciding and moving is the success mode.');
  rules.push('TEAM-FIRST ESCALATION RULE: Before DMing Dashboard/Owner with a question, try these in order: (1) kb_read() — did the team already decide this? (2) DM a teammate with the relevant skill (use list_agents() to find them). (3) call_vote() if the team genuinely disagrees. (4) log_decision() to lock in your choice and move forward. Only escalate to Owner when: (a) the overall goal is complete and the next strategic direction genuinely needs a human call, or (b) you hit a true blocker only the Owner can resolve (credentials, priorities, business rules, access). "I am not sure which design to pick" is NOT an Owner question — it is a team_decision() question.');
  rules.push('DONE-WHEN-DONE RULE: "Done" means the Owner\'s original GOAL is achieved, not "I finished my current step". After verify_and_advance(), immediately call get_work() again to find the next piece of the goal. The loop ends when the goal is complete and evidence is recorded — not when the current step ends. If get_work() returns nothing and the goal still is not done, synthesize: break the remaining work into new tasks with create_task() and keep going.');

  // Minimal level: Tier 0 only — for experienced agents refreshing rules
  if (level === 'minimal') {
    rules.push('Call get_briefing() when joining a project or after being away.');
    rules.push('Lock files before editing shared code (lock_file / unlock_file).');
    if (mode === 'group' || mode === 'managed') {
      rules.push('Use reply_to when responding — you get faster cooldown (500ms vs default).');
      rules.push('Messages not addressed to you show should_respond: false. Only respond if you have something new to add.');
    }
    return {
      rules,
      tier_info: `${rules.length} rules (minimal level, ${aliveCount} agents)`,
      ...(guideContractAdvisory ? { contract_advisory: guideContractAdvisory } : {}),
      first_steps: mode === 'direct'
        ? '1. Call list_agents() to see who is online. 2. Send a message or call listen() to wait.'
        : mode === 'managed'
        ? `1. Call get_briefing() for project context. 2. Call listen() to wait for the manager. 3. Respond when given the floor, then listen() again.`
        : `1. Call get_briefing() for project context. 2. Call listen_group() to join. 3. Respond and listen_group() again.`,
    };
  }

  // Tier 1 — core behavior (standard + full)
  rules.push('Call get_briefing() when joining a project or after being away.');
  rules.push('Keep messages to 2-3 paragraphs max.');
  rules.push('When you finish work, report what you did and what files you changed.');
  rules.push('Lock files before editing shared code (lock_file / unlock_file).');
  // UE5 safety rules — prevent concurrent editor operations
  rules.push('UE5 SAFETY: BEFORE any Unreal Engine editor operation (spawning, modifying scene, placing assets): call lock_file("ue5-editor"). BEFORE compiling/building: call lock_file("ue5-compile"). Unlock immediately after. Only ONE agent can hold each lock — others must wait.');

  // Tier 2 — group mode features (shown when group or managed mode)
  if (mode === 'group' || mode === 'managed') {
    rules.push('Use reply_to when responding — you get faster cooldown (500ms vs default).');
    rules.push('Messages not addressed to you show should_respond: false. Only respond if you have something new to add.');
    rules.push('Log team decisions with log_decision() so they are not re-debated.');
  }

  // Tier 2b — channels (shown when channels exist beyond #general)
  if (hasChannels) {
    rules.push('Join relevant channels with join_channel(). You only see messages from channels you joined.');
    rules.push('Use channel parameter on send_message to keep discussions focused.');
  }

  // Tier 3 — large teams (shown when 5+ agents)
  if (aliveCount >= 5) {
    rules.push(`${listenCmd} blocks until messages arrive. NEVER stop listening. NEVER use sleep() or check_messages() loops.`);
    rules.push('Tasks auto-create channels (#task-xxx). Use them for focused discussion instead of #general.');
    rules.push('Use channels to split into sub-teams. Do not discuss everything in #general.');
  }

  // User-customizable project-specific rules from .agent-bridge/guide.md
  const guideFile = path.join(DATA_DIR, 'guide.md');
  let projectRules = [];
  if (fs.existsSync(guideFile)) {
    try {
      const content = fs.readFileSync(guideFile, 'utf8').trim();
      if (content) projectRules = content.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#')).map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    } catch {}
  }

  // Inject dashboard-managed rules into guide
  const dashboardRules = getRules().filter(r => r.active);
  if (dashboardRules.length > 0) {
    for (const r of dashboardRules) {
      rules.push(`[${r.category.toUpperCase()}] ${r.text}`);
    }
  }

  const result = {
    rules,
    project_rules: projectRules.length > 0 ? projectRules : undefined,
    tier_info: `${rules.length} rules (${aliveCount} agents, ${mode} mode${hasChannels ? ', channels active' : ''})`,
    ...(guideContractAdvisory ? { contract_advisory: guideContractAdvisory } : {}),
    first_steps: mode === 'direct'
      ? '1. Call list_agents() to see who is online. 2. Send a message or call listen() to wait.'
      : '1. Call get_briefing() for project context. 2. Call listen_group() to join. 3. Respond and listen_group() again.',
    tool_categories: {
      'MESSAGING': 'send_message, broadcast, listen_group, listen, check_messages, get_history, get_summary, search_messages, handoff, share_file',
      'COORDINATION': 'get_briefing, log_decision, get_decisions, kb_write, kb_read, kb_list, call_vote, cast_vote, vote_status',
      'TASKS': 'create_task, update_task, list_tasks, declare_dependency, check_dependencies, suggest_task',
      'QUALITY': 'update_progress, get_progress, request_review, submit_review, get_reputation',
      'SAFETY': 'lock_file, unlock_file',
      'CHANNELS': 'join_channel, leave_channel, list_channels',
      ...(mode === 'managed' ? { 'MANAGED MODE': 'claim_manager, yield_floor, set_phase' } : {}),
    },
  };

  // Full level: add tool descriptions for complete reference
  if (level === 'full') {
    result.tool_details = {
      'listen_group': 'Blocks until messages arrive. Returns batch with priorities, context, agent statuses.',
      'send_message': 'Send to agent (to param). reply_to for threading. channel for sub-channels.',
      'lock_file / unlock_file': 'Exclusive file locking. Auto-releases on disconnect.',
      'log_decision': 'Persist decisions to prevent re-debating. Visible in get_briefing().',
      'create_task / update_task': 'Structured task management. Auto-creates channels at 5+ agents.',
      'kb_write / kb_read': 'Shared knowledge base. Any agent can read/write.',
      'suggest_task': 'AI-suggested next task based on your strengths and pending work.',
      'request_review / submit_review': 'Structured code review workflow with notifications.',
      'declare_dependency': 'Block a task until another completes. Auto-notifies on resolution.',
      'get_compressed_history': 'Summarized history for catching up without context overflow.',
    };
  }

  // Cache the result for subsequent calls with same params
  _guideCache = { key: cacheKey, result };
  return result;
}

const COMPLETION_EVIDENCE_INPUT_SCHEMA = {
  type: 'object',
  description: 'Structured completion evidence backing terminal or advancement claims.',
  properties: {
    summary: { type: 'string', description: 'What you accomplished' },
    verification: { type: 'string', description: 'How you verified it works (tests run, files checked, etc.)' },
    files_changed: { type: 'array', items: { type: 'string' }, description: 'Files created or modified' },
    confidence: { type: 'number', description: '0-100 confidence the work is correct' },
    learnings: { type: 'string', description: 'What you learned that could help future work' },
  },
  required: ['summary', 'verification', 'confidence'],
};

function emitWorkflowHandoffMessages(options = {}) {
  const {
    workflowId,
    workflowName,
    completedStepId,
    nextSteps = [],
    summary = null,
    flagged = false,
    confidence = null,
    evidenceRef = null,
    commandId = null,
    correlationId = null,
  } = options;

  const agents = getAgents();

  for (const step of nextSteps) {
    if (!step || !step.assignee || step.assignee === registeredName) continue;
    if (!agents[step.assignee] || !canSendTo(registeredName, step.assignee)) continue;

    const handoffContent = summary
      ? `[Workflow "${workflowName}"] Your turn - Step ${step.id}: ${step.description}. Previous step completed by ${registeredName}${flagged && typeof confidence === 'number' ? ` (flagged: ${confidence}% confidence)` : ''}: ${summary}`
      : `[Workflow "${workflowName}"] Step ${step.id} assigned to you: ${step.description}`;

    messageSeq++;
    const msg = {
      id: generateId(),
      seq: messageSeq,
      from: registeredName,
      to: step.assignee,
      content: handoffContent,
      timestamp: new Date().toISOString(),
      type: 'handoff',
      workflow_id: workflowId,
      workflow_name: workflowName,
      step_id: step.id,
      previous_step_id: completedStepId,
      evidence_ref: evidenceRef || null,
      session_id: currentSessionId || null,
      command_id: commandId || null,
      causation_id: evidenceRef && evidenceRef.evidence_id ? evidenceRef.evidence_id : null,
      correlation_id: correlationId || workflowId,
    };

    canonicalState.appendMessage(msg, {
      branch: currentBranch,
      actorAgent: registeredName,
      sessionId: currentSessionId || null,
      commandId: commandId || null,
      causationId: evidenceRef && evidenceRef.evidence_id ? evidenceRef.evidence_id : null,
      correlationId: correlationId || workflowId,
    });
  }
}

// --- Tool implementations ---

function toolRegister(name, provider = null) {
  ensureDataDir();
  migrateIfNeeded(); // run data migrations on first register
  sanitizeName(name);
  lockAgentsFile();

  try {
    const agents = getAgents();
    if (agents[name] && agents[name].pid !== process.pid && isPidAlive(agents[name].pid, agents[name].last_activity)) {
      return { error: `Agent "${name}" is already registered by a live process. Choose a different name.` };
    }

    // If name was previously registered by a dead process, verify token to prevent impersonation
    if (agents[name] && agents[name].token && !isPidAlive(agents[name].pid, agents[name].last_activity)) {
      // Dead agent — only allow re-registration from the same process (same token)
      if (registeredToken && registeredToken !== agents[name].token) {
        return { error: `Agent "${name}" was previously registered by another process. Choose a different name.` };
      }
    }

    // Prevent re-registration under a different name from the same process
    // EXCEPTION: Allow transition to "Assistant" for setup/reset — force clear old registration
    if (registeredName && registeredName !== name) {
      if (name === 'Assistant') {
        registeredName = null; // Force clear for Assistant registration
        registeredToken = null;
      } else {
        unlockAgentsFile();
        return { error: `Already registered as "${registeredName}". Cannot change name mid-session.`, current_name: registeredName };
      }
    }

    const now = new Date().toISOString();
    const token = (agents[name] && agents[name].token) || generateToken();
    agents[name] = { pid: process.pid, timestamp: now, last_activity: now, provider: provider || 'unknown', branch: currentBranch, token, started_at: now };
    saveAgents(agents);
    registeredName = name;
    registeredToken = token;

    const sessionActivation = ensureActiveBranchSession(currentBranch, {
      at: now,
      reason: 'register',
      provider: provider || 'unknown',
    });

    // Auto-create profile if not exists
    const profiles = getProfiles();
    if (!profiles[name]) {
      profiles[name] = createDefaultProfileRecord(name, now);
      saveProfiles(profiles);
    }

    canonicalState.appendCanonicalEvent({
      type: 'agent.registered',
      actorAgent: name,
      sessionId: currentSessionId,
      correlationId: name,
      payload: {
        agent_name: name,
        agent: {
          name,
          provider: provider || 'unknown',
          branch: currentBranch,
          pid: process.pid,
          registered_at: now,
          started_at: now,
          last_activity: now,
        },
        reason: 'register',
      },
    });

    // Start heartbeat — updates last_activity every 10s so dashboard knows we're alive
    // Deterministic jitter per agent to spread writes across the interval (prevents lock storms at 10 agents)
    const heartbeatJitter = name.split('').reduce((h, c) => h + c.charCodeAt(0), 0) % 2000;
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
      try {
        // Scale fix: write per-agent heartbeat file instead of lock+read+write agents.json
        // Eliminates write contention — each agent writes only its own file, no locking needed
        touchHeartbeat(registeredName);
        touchCurrentSession({ heartbeat: true });
        const agents = getAgents(); // cached + merges heartbeat files automatically
        // Managed mode: detect dead manager and dead turn holder
        if (isManagedMode()) {
          const managed = getManagedConfig();
          let managedChanged = false;

        // Dead manager detection
        if (managed.manager && managed.manager !== registeredName) {
          if (agents[managed.manager] && !isPidAlive(agents[managed.manager].pid, agents[managed.manager].last_activity)) {
            managed.manager = null;
            managed.floor = 'closed';
            managed.turn_current = null;
            managed.turn_queue = [];
            managedChanged = true;
            saveManagedConfig(managed);
            broadcastSystemMessage(`[SYSTEM] Manager disconnected. Call claim_manager() to take over as the new manager.`);
          }
        }

        // Dead turn holder detection — unstick the floor
        if (!managedChanged && managed.turn_current && managed.turn_current !== registeredName && managed.manager) {
          if (agents[managed.turn_current] && !isPidAlive(agents[managed.turn_current].pid, agents[managed.turn_current].last_activity)) {
            const deadAgent = managed.turn_current;
            managed.turn_current = null;
            managed.floor = 'closed';
            managed.turn_queue = [];
            saveManagedConfig(managed);
            if (managed.manager !== registeredName) {
              sendSystemMessage(managed.manager, `[FLOOR] ${deadAgent} disconnected while holding the floor. Floor returned to you.`);
            }
          }
        }
        }
        // Snapshot dead agents BEFORE cleanup (for auto-recovery)
        snapshotDeadAgents(agents);
        // Clean up file locks held by dead agents
        cleanStaleLocks();
        cleanStaleChannelMembers();
        // Stand-up meetings: periodic team check-ins
        triggerStandupIfDue();
        // Watchdog: classify stale work and emit bounded recovery signals (autonomous/group mode)
        watchdogCheck();
      } catch {}
    }, 10000 + heartbeatJitter);
    heartbeatInterval.unref(); // Don't prevent process exit

    // Fire join event + recovery data for returning agents
    const config = getConfig();
    const mode = config.conversation_mode || 'direct';
    const otherAgents = Object.keys(getAgents()).filter(n => n !== name);

    const result = {
      success: true,
      message: `Registered as Agent ${name} (PID ${process.pid})`,
      conversation_mode: mode,
      agents_online: otherAgents,
      guide: buildGuide(),
    };

    if (sessionActivation && sessionActivation.session) {
      result.session = {
        id: sessionActivation.session.session_id,
        branch: sessionActivation.session.branch_id,
        state: sessionActivation.session.state,
        resumed: !!sessionActivation.resumed,
      };
    }

    const recoveryContext = buildAuthoritativeResumeContext({
      agentName: name,
      branchName: currentBranch,
      sessionId: sessionActivation && sessionActivation.session ? sessionActivation.session.session_id : currentSessionId,
      evidenceLimit: 5,
    });

    // Recovery: if this agent has prior data, include it
    const myTasks = getTasks().filter(t => t.assignee === name && t.status !== 'done');
    const myWorkspace = getWorkspace(name);
    const myWorkspaceKeys = Object.keys(myWorkspace).filter((key) => key !== '_checkpoints');
    const checkpointFallbacks = listCheckpointFallbacks(name, {
      workflowId: recoveryContext.active_step ? recoveryContext.active_step.workflow_id : (recoveryContext.upcoming_step ? recoveryContext.upcoming_step.workflow_id : null),
      stepId: recoveryContext.active_step ? recoveryContext.active_step.id : null,
    });
    // Scale fix: tail-read last 30 messages instead of entire history
    const recentHistory = tailReadJsonl(getHistoryFile(currentBranch), 30);
    const myRecentMsgs = recentHistory.filter(m => m.to === name || m.from === name).slice(-5);

    const hasAuthoritativeRecovery = !!(
      (sessionActivation && sessionActivation.resumed && recoveryContext.session_summary)
      || recoveryContext.active_step
      || recoveryContext.upcoming_step
      || recoveryContext.dependency_evidence.length > 0
      || recoveryContext.recent_evidence.length > 0
      || myTasks.length > 0
      || checkpointFallbacks.length > 0
    );

    if (hasAuthoritativeRecovery) {
      result.recovery = {};
      if (recoveryContext.session_summary) result.recovery.session_summary = recoveryContext.session_summary;
      if (recoveryContext.active_step) result.recovery.active_step = recoveryContext.active_step;
      if (recoveryContext.upcoming_step) result.recovery.upcoming_step = recoveryContext.upcoming_step;
      if (recoveryContext.dependency_evidence.length > 0) result.recovery.dependency_evidence = recoveryContext.dependency_evidence;
      if (recoveryContext.recent_evidence.length > 0) result.recovery.recent_evidence = recoveryContext.recent_evidence;
      if (myTasks.length > 0) result.recovery.your_active_tasks = myTasks.map(t => ({ id: t.id, title: t.title, status: t.status }));
      if (checkpointFallbacks.length > 0) result.recovery.checkpoint_fallbacks = checkpointFallbacks;
      result.recovery.hint = (sessionActivation && sessionActivation.resumed)
        ? 'Authoritative resume context from your branch session and recent evidence is attached below. Use it first; compatibility snapshots and checkpoints are fallback only.'
        : 'Authoritative branch session context is attached below. Use session/evidence context first; compatibility snapshots and checkpoints are fallback only.';
    }

    if (myWorkspaceKeys.length > 0 || myRecentMsgs.length > 0) {
      if (!result.recovery) result.recovery = {};
      if (myWorkspaceKeys.length > 0) result.recovery.your_workspace_keys = myWorkspaceKeys;
      if (myRecentMsgs.length > 0) result.recovery.recent_messages = myRecentMsgs.map(m => ({ from: m.from, to: m.to, preview: m.content.substring(0, 100), timestamp: m.timestamp }));
      if (!result.recovery.hint) {
        result.recovery.hint = 'You have prior context from a previous session. Call get_briefing() for a full project summary.';
      }
    }

    // Auto-recovery: load crash snapshot if it exists (TTL: 1 hour)
    const recoveryFile = path.join(DATA_DIR, `recovery-${name}.json`);
    if (fs.existsSync(recoveryFile)) {
      try {
        const snapshot = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
        const snapshotAge = Date.now() - new Date(snapshot.died_at).getTime();
        if (snapshotAge > 3600000) {
          // Stale snapshot (>1 hour) — discard
          try { fs.unlinkSync(recoveryFile); } catch {}
        } else {
          if (!result.recovery) result.recovery = {};
          result.recovery.previous_session = true;
          result.recovery.died_at = snapshot.died_at;
          result.recovery.crashed_ago = Math.round(snapshotAge / 1000) + 's';
          if (!result.recovery.your_active_tasks && snapshot.active_tasks && snapshot.active_tasks.length > 0) result.recovery.your_active_tasks = snapshot.active_tasks;
          if (snapshot.locked_files && snapshot.locked_files.length > 0) {
            result.recovery.locked_files_released = snapshot.locked_files;
            result.recovery.lock_note = 'These files were locked by your previous session. Locks have been auto-released. Re-lock them with lock_file() before editing.';
          }
          if (snapshot.channels && snapshot.channels.length > 0) result.recovery.your_channels = snapshot.channels;
          if (!result.recovery.last_messages_sent && snapshot.last_messages_sent) result.recovery.last_messages_sent = snapshot.last_messages_sent;
          // Agent memory fields
          if (snapshot.decisions_made && snapshot.decisions_made.length > 0) result.recovery.decisions_made = snapshot.decisions_made;
          if (snapshot.tasks_completed && snapshot.tasks_completed.length > 0) result.recovery.tasks_completed = snapshot.tasks_completed;
          if (snapshot.kb_entries_written && snapshot.kb_entries_written.length > 0) result.recovery.kb_entries_written = snapshot.kb_entries_written;
          if (snapshot.graceful) result.recovery.was_graceful = true;
          const compatibilityHint = snapshot.graceful
            ? 'Compatibility snapshot loaded from a previous graceful session. The session/evidence summary above is authoritative; use these legacy memory fields only as fallback context.'
            : 'Compatibility crash snapshot loaded. Review the fallback task/lock details below if needed, but use the attached session/evidence summary as the source of truth.';
          if (result.recovery.hint) {
            result.recovery.compatibility_hint = compatibilityHint;
          } else {
            result.recovery.hint = compatibilityHint;
          }
          // Clean up snapshot after loading
          try { fs.unlinkSync(recoveryFile); } catch {}
        }
      } catch {}
    }

    // Notify other agents
    fireEvent('agent_join', { agent: name });

    // Auto-assign roles when 2+ agents are online
    const aliveCount = Object.values(getAgents()).filter(a => isPidAlive(a.pid, a.last_activity)).length;
    if (aliveCount >= 2) {
      try {
        const roleAssignments = autoAssignRoles();
        if (roleAssignments && roleAssignments[name]) {
          result.your_role = roleAssignments[name];
        }
      } catch {}
    }

    return result;
  } finally {
    unlockAgentsFile();
  }
}

// Update last_activity timestamp for this agent
// Uses file lock to prevent race with heartbeat writes
function touchActivity() {
  if (!registeredName) return;
  // Scale fix: write per-agent heartbeat file instead of lock+write agents.json
  touchHeartbeat(registeredName);
  touchCurrentSession();
}

// "Listening" for dashboard purposes includes a recency grace window: once an
// agent's listen call returns, they flip to "working" briefly while processing
// messages or sending replies, then call listen again. Treating that sub-second
// gap as "not listening" makes the dashboard flicker. A 30-second grace matches
// what operators expect to see on a healthy team.
const LISTEN_RECENCY_GRACE_MS = 30000;
function isRecentlyListening(info) {
  if (!info) return false;
  if (info.listening_since) return true;
  if (!info.last_listened_at) return false;
  const last = Date.parse(info.last_listened_at);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < LISTEN_RECENCY_GRACE_MS;
}

// Set or clear the listening_since flag
function setListening(isListening) {
  if (!registeredName) return;
  try {
    canonicalState.setAgentListeningState(registeredName, isListening, {
      actorAgent: registeredName,
      sessionId: currentSessionId,
      reason: isListening ? 'listen_start' : 'listen_stop',
    });
  } catch {}
}

function toolListAgents() {
  const agents = getAgents();
  const profiles = getProfiles();
  const result = {};
  for (const [name, info] of Object.entries(agents)) {
    const alive = isPidAlive(info.pid, info.last_activity);
    const lastActivity = info.last_activity || info.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    const profile = profiles[name] || {};
    const contract = resolveAgentContract(profile);
    result[name] = {
      alive,
      registered_at: info.timestamp,
      last_activity: lastActivity,
      idle_seconds: alive ? idleSeconds : null,
      status: !alive ? 'dead' : idleSeconds > 60 ? 'sleeping' : 'active',
      listening_since: info.listening_since || null,
      is_listening: alive && isRecentlyListening(info),
      last_listened_at: info.last_listened_at || null,
      provider: info.provider || 'unknown',
      branch: info.branch || 'main',
      display_name: profile.display_name || name,
      avatar: profile.avatar || getDefaultAvatar(name),
      role: profile.role || '',
      bio: profile.bio || '',
      ...buildRuntimeContractMetadata(contract),
    };
    // Include workspace status if set (agent intent board)
    try {
      const ws = getWorkspace(name);
      if (ws._status) result[name].current_status = ws._status;
    } catch {}
  }
  return { agents: result };
}

async function toolSendMessage(content, to = null, reply_to = null, channel = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Type validation for optional params
  if (reply_to && typeof reply_to !== 'string') return { error: 'reply_to must be a string' };
  if (channel && typeof channel !== 'string') return { error: 'channel must be a string' };

  // Early check: is this a Dashboard (owner) reply?
  const isDashboardTarget = to && to.toLowerCase() === 'dashboard';

  const rateErr = checkRateLimit(content, to || '__broadcast__');
  if (rateErr) return rateErr;

  // Send-after-listen enforcement: must call listen_group between sends in group mode
  // Autonomous mode: relaxed to 5 sends per listen cycle
  // Assistant mode: skip enforcement when replying to Dashboard (owner)
  const effectiveSendLimit = isAutonomousMode() ? 5 : sendLimit;
  if (isGroupMode() && sendsSinceLastListen >= effectiveSendLimit && !isDashboardTarget) {
    return { error: `You must call listen_group() before sending again. You've sent ${sendsSinceLastListen} message(s) without listening (limit: ${effectiveSendLimit}). This prevents message storms.` };
  }

  // Response budget: track unaddressed sends, hint when depleted
  if (isGroupMode()) {
    // Reset budget every 60 seconds
    if (Date.now() - budgetResetTime > 60000) { unaddressedSends = 0; budgetResetTime = Date.now(); }
  }

  // Group mode cooldown — per-channel aware + split by addressing (fast/slow lane)
  let _cooldownApplied = 0;
  if (isGroupMode()) {
    // Per-channel rate limit: check if channel has custom rate_limit config
    const agentsNow = getAgents();
    if (channel && channel !== 'general') {
      const channels = getChannelsData();
      const ch = channels[channel];
      if (ch && ch.rate_limit && ch.rate_limit.max_sends_per_minute) {
        // Custom per-channel rate limit — check sliding window
        if (!_channelSendTimes[channel]) _channelSendTimes[channel] = [];
        const now = Date.now();
        _channelSendTimes[channel] = _channelSendTimes[channel].filter(t => now - t < 60000);
        if (_channelSendTimes[channel].length >= ch.rate_limit.max_sends_per_minute) {
          return { error: `Rate limit for #${channel}: max ${ch.rate_limit.max_sends_per_minute} messages/minute. Wait before sending.` };
        }
        _channelSendTimes[channel].push(now);
      }
    }

    // Per-channel cooldown: use channel member count, not total agents
    let memberCount;
    if (channel && channel !== 'general') {
      const channels = getChannelsData();
      const ch = channels[channel];
      memberCount = ch ? ch.members.filter(m => { const a = agentsNow[m]; return a && isPidAlive(a.pid, a.last_activity); }).length : 1;
    } else {
      memberCount = Object.values(agentsNow).filter(a => isPidAlive(a.pid, a.last_activity)).length;
    }
    let cooldown;
    if (isAutonomousMode()) {
      // Autonomous mode: zero cooldown for structured communication, minimal for general
      const isHandoff = content && (content.includes('[Workflow') || content.includes('[HANDOFF]'));
      const isChannelMsg = channel && channel !== 'general';
      if (isHandoff || isChannelMsg) {
        // Micro-cooldown circuit breaker: 50ms for same-agent-same-channel to prevent runaway spam
        const channelKey = `${registeredName}:${channel || 'general'}`;
        const lastChannelSend = _channelSendTimes[channelKey] || 0;
        cooldown = (Date.now() - lastChannelSend < 1000) ? 50 : 0; // 50ms if sent to same channel within 1s
        _channelSendTimes[channelKey] = Date.now();
      }
      else if (reply_to) cooldown = 100;           // fast replies
      else cooldown = 300;                         // general broadcasts only
    } else {
      cooldown = Math.max(500, memberCount * 500); // base: per-channel adaptive
      // Split cooldown: reply_to addressed = fast lane, unaddressed = slow lane
      if (reply_to) {
        const allMsgs = tailReadJsonl(channel ? getChannelMessagesFile(channel) : getMessagesFile(currentBranch), 100);
        const refMsg = allMsgs.find(m => m.id === reply_to);
        if (refMsg && refMsg.addressed_to && refMsg.addressed_to.includes(registeredName)) {
          cooldown = 500; // fast lane: I was addressed
        } else {
          cooldown = Math.max(2000, memberCount * 1000); // slow lane
        }
      }
    }
    _cooldownApplied = cooldown;
    const elapsed = Date.now() - lastSentAt;
    if (elapsed < cooldown) {
      await sleep(cooldown - elapsed);
    }
  }

  // Managed mode floor enforcement
  if (isManagedMode()) {
    let managed = getManagedConfig();

    // Auto-elect manager: first agent to send a message becomes manager if none claimed
    // Uses config lock to prevent two agents both becoming manager simultaneously
    if (!managed.manager) {
      lockConfigFile();
      try {
        const freshManaged = getManagedConfig();
        if (!freshManaged.manager) {
          freshManaged.manager = registeredName;
          freshManaged.floor = 'closed';
          const config = getConfig();
          config.managed = freshManaged;
          saveConfig(config);
          broadcastSystemMessage(`[SYSTEM] ${registeredName} is now the manager (auto-elected). Wait to be addressed.`, registeredName);
          managed = freshManaged;
        } else {
          managed = freshManaged; // another process won the race
        }
      } finally {
        unlockConfigFile();
      }
    }

    const isManager = managed.manager === registeredName;

    // Manager can always send
    if (!isManager) {
      if (managed.floor === 'closed') {
        return { error: `Floor is closed. Only the manager (${managed.manager || 'unassigned'}) can speak. Call listen() to wait for your turn.` };
      }
      if (managed.floor === 'directed' && managed.turn_current !== registeredName) {
        return { error: `${managed.turn_current} has the floor right now. Wait for your turn. Call listen() to wait.` };
      }
      if (managed.floor === 'open' && managed.turn_current !== registeredName) {
        return { error: `It's ${managed.turn_current}'s turn in the round-robin. Wait for your turn. Call listen() to wait.` };
      }
      if (managed.floor === 'execution') {
        // During execution, agents can only message the manager
        if (to && to !== managed.manager) {
          return { error: `During execution phase, you can only message the manager (${managed.manager}). Focus on your tasks.` };
        }
      }
    }
  }

  const agents = getAgents();
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName);

  if (otherAgents.length === 0 && !isDashboardTarget) {
    return { error: 'No other agents registered' };
  }

  // Auto-route when exactly 1 other agent, otherwise require explicit `to`
  if (!to) {
    if (otherAgents.length === 1) {
      to = otherAgents[0];
    } else {
      return { error: `Multiple agents online (${otherAgents.join(', ')}). Specify 'to' parameter.` };
    }
  }

  if (!agents[to] && !isDashboardTarget) {
    return { error: `Agent "${to}" is not registered` };
  }

  if (to === registeredName) {
    return { error: 'Cannot send a message to yourself' };
  }

  // Permission check (skip for Dashboard — owner always reachable)
  if (!isDashboardTarget && !canSendTo(registeredName, to)) {
    return { error: `Permission denied: you are not allowed to send messages to "${to}"` };
  }

  const sizeErr = validateContentSize(content);
  if (sizeErr) return sizeErr;

  // Check if recipient is alive — warn if dead (skip for Dashboard)
  const recipientAlive = isDashboardTarget ? true : isPidAlive(agents[to].pid, agents[to].last_activity);

  // Resolve threading — search main messages + channel files
  let thread_id = null;
  if (reply_to) {
    let referencedMsg = null;
    // Search channel file first if channel specified, then main messages
    if (channel && channel !== 'general') {
      const chMsgs = tailReadJsonl(getChannelMessagesFile(channel), 100);
      referencedMsg = chMsgs.find(m => m.id === reply_to);
    }
    if (!referencedMsg) {
      // Scale fix: tail-read last 100 messages for thread lookup instead of entire file
      const allMsgs = tailReadJsonl(getMessagesFile(currentBranch), 100);
      referencedMsg = allMsgs.find(m => m.id === reply_to);
    }
    if (referencedMsg) {
      thread_id = referencedMsg.thread_id || referencedMsg.id;
    } else {
      thread_id = reply_to; // referenced msg may be purged, use ID anyway
    }
  }

  messageSeq++;
  // In group mode: rewrite to → __group__, original to becomes addressed_to
  const isGroup = isGroupMode() && !isManagedMode();
  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: registeredName,
    to: isGroup ? '__group__' : to,
    content,
    timestamp: new Date().toISOString(),
    ...(isGroup && to && { addressed_to: [to] }),
    ...(channel && { channel }),
    ...(reply_to && { reply_to }),
    ...(thread_id && { thread_id }),
  };

  // Validate channel exists (prevents orphan files from typos)
  if (channel && channel !== 'general') {
    const channels = getChannelsData();
    if (!channels[channel]) {
      return { error: `Channel "#${channel}" does not exist. Use join_channel("${channel}") to create it first.` };
    }
  }

  ensureDataDir();
  // Messages involving Dashboard: route to private assistant-messages.jsonl
  // Only Dashboard→Agent messages go to the assistant file (so assistant() can pick them up)
  // Agent→Dashboard replies go to a separate file (so they don't trigger fs.watch loops)
  if (isDashboardTarget) {
    msg.to = 'Dashboard';
    delete msg.addressed_to;
    appendAssistantReplyMessage(msg);
  } else {
    appendChannelConversationMessage(msg, channel);
  }
  touchActivity();
  lastSentAt = Date.now();

  // Group mode: O(N) auto-broadcast REMOVED. Messages now use __group__ single-write.
  // The to→__group__ rewrite happens above when the message is created.

  // Managed mode: auto-advance turns after non-manager sends
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const isManager = managed.manager === registeredName;

    if (!isManager && managed.turn_current === registeredName) {
      if (managed.floor === 'directed') {
        // Directed floor: return floor to manager after agent speaks
        managed.floor = 'closed';
        managed.turn_current = null;
        managed.turn_queue = [];
        saveManagedConfig(managed);
        sendSystemMessage(managed.manager, `[FLOOR] ${registeredName} has responded. The floor is back to you.`);
      } else if (managed.floor === 'open') {
        // Round-robin: advance to next alive agent (skip dead ones)
        const agents = getAgents();
        const idx = managed.turn_queue.indexOf(registeredName);
        let nextAgent = null;
        for (let i = idx + 1; i < managed.turn_queue.length; i++) {
          const candidate = managed.turn_queue[i];
          if (agents[candidate] && isPidAlive(agents[candidate].pid, agents[candidate].last_activity)) {
            nextAgent = candidate;
            break;
          }
        }
        if (nextAgent) {
          managed.turn_current = nextAgent;
          saveManagedConfig(managed);
          sendSystemMessage(nextAgent, `[FLOOR] It is YOUR TURN to speak. You have the floor.`);
        } else {
          // All remaining agents have spoken (or are dead) — close floor
          managed.floor = 'closed';
          managed.turn_current = null;
          managed.turn_queue = [];
          saveManagedConfig(managed);
          sendSystemMessage(managed.manager, `[FLOOR] All agents have spoken. The floor is yours. Use yield_floor() to continue or set_phase() to advance.`);
        }
      }
    }
  }

  // Update send counters
  sendsSinceLastListen++;
  if (isGroupMode() && !msg.addressed_to) { unaddressedSends++; }

  const result = { success: true, messageId: msg.id, from: msg.from, to: msg.to };

  // Decision overlap hint: warn if message content overlaps with existing decisions
  if (isGroupMode()) {
    try {
      const decisions = (readJsonFile(path.join(DATA_DIR, 'decisions.json')) || []).slice(-100);
      if (decisions.length > 0) {
        const contentLower = content.toLowerCase();
        const overlap = decisions.find(d => {
          const topic = (d.topic || '').toLowerCase();
          const decision = (d.decision || '').toLowerCase();
          return topic && contentLower.includes(topic) || decision.split(' ').filter(w => w.length > 4).some(w => contentLower.includes(w));
        });
        if (overlap) {
          result._decision_hint = `Related decision exists: "${overlap.decision}" (topic: ${overlap.topic || 'general'}). Check get_decisions() before re-debating.`;
        }
      }
    } catch {}
  }
  if (_cooldownApplied > 0) result.cooldown_applied_ms = _cooldownApplied;
  if (channel) result.channel = channel;
  if (currentBranch !== 'main') result.branch = currentBranch;
  // Response budget hint — relaxed in autonomous mode
  if (isGroupMode() && !msg.addressed_to) {
    if (isAutonomousMode() && hasActiveWorkflowStep(registeredName)) {
      // No budget limit when actively working on a workflow step — unlimited sends
    } else if (isAutonomousMode() && unaddressedSends >= 10) {
      result._budget_hint = 'Response budget depleted (10 unaddressed sends in 60s, autonomous mode). Wait briefly or get addressed.';
    } else if (!isAutonomousMode() && unaddressedSends >= 2) {
      result._budget_hint = 'Response budget depleted (2 unaddressed sends in 60s). Wait to be addressed or wait for budget reset.';
    }
  }
  if (!recipientAlive) {
    result.warning = `Agent "${to}" appears offline (PID not running). Message queued but may not be received until they reconnect.`;
  } else if (agents[to] && !agents[to].listening_since) {
    result.note = `Agent "${to}" is currently working (not in listen mode). Message queued — they'll see it when they finish their current task and call listen_group().`;
  }

  // Mode awareness hint: warn if agent seems to be in wrong mode
  const currentMode = getConfig().conversation_mode || 'direct';
  if (currentMode === 'group' || currentMode === 'managed') {
    result.mode_hint = `You're in ${currentMode} mode. Use listen_group() (or listen() — both auto-detect) to stay in the conversation.`;
  }

  // Nudge: check if THIS agent has unread messages waiting
  const myPending = getUnconsumedMessages(registeredName);
  if (myPending.length > 0) {
    result.you_have_messages = myPending.length;
    result.urgent = `You have ${myPending.length} unread message(s) waiting. Call listen_group() after this to read them.`;
  }
  return result;
}

function toolBroadcast(content) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Managed mode: only manager can broadcast
  if (isManagedMode()) {
    const managed = getManagedConfig();
    if (managed.manager !== registeredName) {
      return { error: `Only the manager (${managed.manager || 'unassigned'}) can broadcast in managed mode. Use send_message() to message the manager.` };
    }
  }

  // Send-after-listen enforcement applies to broadcast too
  const effectiveSendLimitBcast = isAutonomousMode() ? 5 : sendLimit;
  if (isGroupMode() && sendsSinceLastListen >= effectiveSendLimitBcast) {
    return { error: `You must call listen_group() before broadcasting again. You've sent ${sendsSinceLastListen} message(s) without listening (limit: ${effectiveSendLimitBcast}).` };
  }

  const rateErr = checkRateLimit(content, '__broadcast__');
  if (rateErr) return rateErr;

  const sizeErr = validateContentSize(content);
  if (sizeErr) return sizeErr;

  const agents = getAgents();
  // Exclude self and virtual agents (Dashboard, Owner) from broadcast recipients.
  // Virtual agents represent the operator UI and read from the shared message log
  // directly; they don't need per-recipient DM copies. Group-mode __group__ writes
  // are still visible to the UI via /api/history.
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName && !agents[n].is_virtual);

  if (otherAgents.length === 0) {
    return { error: 'No other agents registered' };
  }

  ensureDataDir();

  // In group mode: single __group__ write instead of per-agent copies
  if (isGroupMode() && !isManagedMode()) {
    messageSeq++;
    const msg = {
      id: generateId(),
      seq: messageSeq,
      from: registeredName,
      to: '__group__',
      content,
      timestamp: new Date().toISOString(),
      broadcast: true,
    };
    appendBranchConversationMessage(msg);
    touchActivity();
    lastSentAt = Date.now();
    sendsSinceLastListen++;
    unaddressedSends++; // broadcasts are always unaddressed
    const aliveOthers = otherAgents.filter(n => { const a = agents[n]; return isPidAlive(a.pid, a.last_activity); });
    const result = { success: true, messageId: msg.id, recipient_count: aliveOthers.length, sent_to: aliveOthers.map(n => ({ to: n, messageId: msg.id })) };
    // Nudge for own unread messages
    const myPending = getUnconsumedMessages(registeredName);
    if (myPending.length > 0) { result.you_have_messages = myPending.length; result.urgent = `You have ${myPending.length} unread message(s). Call listen_group() soon.`; }
    return result;
  }

  // Direct/managed mode: per-agent writes (original behavior)
  const ids = [];
  const skipped = [];
  for (const to of otherAgents) {
    if (!canSendTo(registeredName, to)) { skipped.push(to); continue; }
    messageSeq++;
    const msg = {
      id: generateId(),
      seq: messageSeq,
      from: registeredName,
      to,
      content,
      timestamp: new Date().toISOString(),
      broadcast: true,
    };
    appendBranchConversationMessage(msg);
    ids.push({ to, messageId: msg.id });
  }
  touchActivity();
  lastSentAt = Date.now();

  const result = { success: true, sent_to: ids, recipient_count: ids.length };
  if (skipped.length > 0) result.skipped = skipped;
  // Show which recipients are busy vs listening
  const agentsNow = getAgents();
  const busy = ids.filter(function(i) { return agentsNow[i.to] && !agentsNow[i.to].listening_since; }).map(function(i) { return i.to; });
  if (busy.length > 0) {
    result.busy_agents = busy;
    result.note = busy.join(', ') + (busy.length === 1 ? ' is' : ' are') + ' currently working (not listening). Messages queued.';
  }
  // Nudge for own unread messages
  const myPending = getUnconsumedMessages(registeredName);
  if (myPending.length > 0) {
    result.you_have_messages = myPending.length;
    result.urgent = `You have ${myPending.length} unread message(s). Call listen_group() soon.`;
  }
  return result;
}

async function toolWaitForReply(timeoutSeconds = 300, from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }
  // Cap at 120s to prevent MCP connection drops (was 3600s)
  timeoutSeconds = Math.min(Math.max(1, timeoutSeconds || 120), 120);

  setListening(true);

  // First check any already-existing unconsumed messages (handles startup/catch-up)
  const existing = getUnconsumedMessages(registeredName, from);
  if (existing.length > 0) {
    const msg = existing[0];
    const consumed = getConsumedIds(registeredName);
    consumed.add(msg.id);
    saveConsumedIds(registeredName, consumed);
    markAsRead(registeredName, msg.id);
    const _mf1 = getMessagesFile(currentBranch);
    if (fs.existsSync(_mf1)) {
      lastReadOffset = fs.statSync(_mf1).size;
    }
    touchActivity();
    setListening(false);
    return buildMessageResponse(msg, consumed);
  }

  // Set offset to current file end before polling for new messages
  const _mf2 = getMessagesFile(currentBranch);
  if (fs.existsSync(_mf2)) {
    lastReadOffset = fs.statSync(_mf2).size;
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  const consumed = getConsumedIds(registeredName);
  let pollCount = 0;

  while (Date.now() < deadline) {
    const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset);
    lastReadOffset = newOffset;

    for (const msg of newMsgs) {
      if (msg.to !== registeredName || consumed.has(msg.id)) continue;
      if (from && msg.from !== from && !msg.system) continue;

      consumed.add(msg.id);
      saveConsumedIds(registeredName, consumed);
      markAsRead(registeredName, msg.id);
      touchActivity();
      setListening(false);
      return buildMessageResponse(msg, consumed);
    }
    touchHeartbeat(registeredName); // stay alive while polling
    await adaptiveSleep(pollCount++);
  }

  setListening(false);
  autoCompact(); // compact on timeout boundaries
  return {
    timeout: true,
    message: `No reply received within ${timeoutSeconds}s. Call wait_for_reply() again to keep waiting.`,
  };
}

function toolCheckMessages(from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  const unconsumed = getUnconsumedMessages(registeredName, from);

  // Rich summary: senders, addressed count, urgency — same as enhanced nudge
  const senders = {};
  let addressedCount = 0;
  for (const m of unconsumed) {
    senders[m.from] = (senders[m.from] || 0) + 1;
    if (m.addressed_to && m.addressed_to.includes(registeredName)) addressedCount++;
  }

  const result = {
    count: unconsumed.length,
    // Scale fix: return previews not full content — agent gets full content via listen_group()
    messages: unconsumed.map(m => ({
      id: m.id,
      from: m.from,
      preview: m.content.substring(0, 120),
      timestamp: m.timestamp,
      ...(m.addressed_to && { addressed_to: m.addressed_to }),
    })),
  };

  if (unconsumed.length > 0) {
    result.senders = senders;
    result.addressed_to_you = addressedCount;
    const latest = unconsumed[unconsumed.length - 1];
    result.preview = `${latest.from}: "${latest.content.substring(0, 80).replace(/\n/g, ' ')}..."`;
    const oldestAge = Math.round((Date.now() - new Date(unconsumed[0].timestamp).getTime()) / 1000);
    result.urgency = oldestAge > 120 ? 'critical' : oldestAge > 30 ? 'urgent' : 'normal';
    result.action_required = 'You have unread messages. Call listen() to receive and process them. Do NOT call check_messages() again — it does not consume messages and you will see the same messages repeatedly.';
  }

  return result;
}

function toolAckMessage(messageId) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  const history = tailReadJsonl(getHistoryFile(currentBranch), 100);
  const msg = history.find(m => m.id === messageId);
  if (msg && msg.to !== registeredName) {
    return { error: 'Can only acknowledge messages addressed to you' };
  }

  const acks = getAcks();
  acks[messageId] = {
    acked_by: registeredName,
    acked_at: new Date().toISOString(),
  };
  writeJsonProjection(getAcksFile(currentBranch), acks);
  touchActivity();

  return { success: true, message: `Message ${messageId} acknowledged` };
}

// Listen indefinitely — loops wait_for_reply in 5-min chunks until a message arrives
async function toolListen(from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Auto-detect group/managed mode and delegate to toolListenGroup
  // This prevents agents from calling the "wrong" listen function
  if (isGroupMode() || isManagedMode()) {
    return toolListenGroup();
  }

  setListening(true);

  // Check for existing unconsumed messages first
  const existing = getUnconsumedMessages(registeredName, from);
  if (existing.length > 0) {
    const msg = existing[0];
    const consumed = getConsumedIds(registeredName);
    consumed.add(msg.id);
    saveConsumedIds(registeredName, consumed);
    markAsRead(registeredName, msg.id);
    const _mfL1 = getMessagesFile(currentBranch);
    if (fs.existsSync(_mfL1)) {
      lastReadOffset = fs.statSync(_mfL1).size;
    }
    touchActivity();
    setListening(false);
    return buildMessageResponse(msg, consumed);
  }

  // Set offset to current file end
  const _mfL2 = getMessagesFile(currentBranch);
  if (fs.existsSync(_mfL2)) {
    lastReadOffset = fs.statSync(_mfL2).size;
  }

  const consumed = getConsumedIds(registeredName);

  // Use fs.watch for instant wake — no polling, zero CPU while waiting
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { if (watcher) watcher.close(); } catch {}
      clearTimeout(timer);
      clearTimeout(heartbeatTimer);
      if (fallbackInterval) clearInterval(fallbackInterval);
      resolve(result);
    };

    let watcher;
    let fallbackInterval;

    // Helper: check for new messages
    const checkMessages = () => {
      const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset);
      lastReadOffset = newOffset;
      for (const msg of newMsgs) {
        if (msg.to !== registeredName || consumed.has(msg.id)) continue;
        if (from && msg.from !== from && !msg.system) continue;
        consumed.add(msg.id);
        saveConsumedIds(registeredName, consumed);
        markAsRead(registeredName, msg.id);
        touchActivity();
        setListening(false);
        done(buildMessageResponse(msg, consumed));
        return true;
      }
      return false;
    };

    try {
      const msgFile = getMessagesFile(currentBranch);
      watcher = fs.watch(msgFile, () => { checkMessages(); });
      watcher.on('error', () => {});
    } catch {
      // Fallback: adaptive polling
      let pollCount = 0;
      fallbackInterval = setInterval(() => {
        if (checkMessages()) { clearInterval(fallbackInterval); return; }
        pollCount++;
        if (pollCount === 10) {
          clearInterval(fallbackInterval);
          fallbackInterval = setInterval(() => {
            if (checkMessages()) clearInterval(fallbackInterval);
          }, 2000);
        }
      }, 500);
    }

    // Heartbeat every 15s
    const heartbeatTimer = setInterval(() => { touchHeartbeat(registeredName); }, 15000);

    // 5 min timeout — MCP has no tool timeout, heartbeat keeps agent alive
    const timer = setTimeout(() => {
      setListening(false);
      touchActivity();
      done({ retry: true, message: 'No direct messages in 5 minutes. Call listen() again to keep waiting.' });
    }, 300000);
  });
}

// Codex-compatible listen — returns after 90s (under Codex's 120s tool timeout)
// with retry:true so the agent knows to call again immediately
async function toolListenCodex(from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  setListening(true);

  // Check existing unconsumed messages first
  const existing = getUnconsumedMessages(registeredName, from);
  if (existing.length > 0) {
    const msg = existing[0];
    const consumed = getConsumedIds(registeredName);
    consumed.add(msg.id);
    saveConsumedIds(registeredName, consumed);
    markAsRead(registeredName, msg.id);
    const _mfC1 = getMessagesFile(currentBranch);
    if (fs.existsSync(_mfC1)) {
      lastReadOffset = fs.statSync(_mfC1).size;
    }
    touchActivity();
    setListening(false);
    return buildMessageResponse(msg, consumed);
  }

  const _mfC2 = getMessagesFile(currentBranch);
  if (fs.existsSync(_mfC2)) {
    lastReadOffset = fs.statSync(_mfC2).size;
  }

  const consumed = getConsumedIds(registeredName);

  // Use fs.watch — same as toolListen, with 45s cap for Codex
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { if (watcher) watcher.close(); } catch {}
      clearTimeout(timer);
      if (fallbackInterval) clearInterval(fallbackInterval);
      resolve(result);
    };

    let watcher;
    let fallbackInterval;

    const checkMessages = () => {
      const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset);
      lastReadOffset = newOffset;
      for (const msg of newMsgs) {
        if (msg.to !== registeredName || consumed.has(msg.id)) continue;
        if (from && msg.from !== from && !msg.system) continue;
        consumed.add(msg.id);
        saveConsumedIds(registeredName, consumed);
        markAsRead(registeredName, msg.id);
        touchActivity();
        setListening(false);
        done(buildMessageResponse(msg, consumed));
        return true;
      }
      return false;
    };

    try {
      const msgFile = getMessagesFile(currentBranch);
      watcher = fs.watch(msgFile, () => { checkMessages(); });
      watcher.on('error', () => {});
    } catch {
      let pollCount = 0;
      fallbackInterval = setInterval(() => {
        if (checkMessages()) { clearInterval(fallbackInterval); return; }
        pollCount++;
        if (pollCount === 10) {
          clearInterval(fallbackInterval);
          fallbackInterval = setInterval(() => {
            if (checkMessages()) clearInterval(fallbackInterval);
          }, 2000);
        }
      }, 500);
    }

    const timer = setTimeout(() => {
      setListening(false);
      done({ retry: true, message: 'No messages yet. Call listen_codex() again to keep waiting.' });
    }, 45000);
  });
}

// --- Assistant mode ---
// Personal assistant listen loop — only receives Dashboard messages,
// reads personality + safety files, returns safety-checked context with each message

// Track how many messages processed — full context on first + every 15th message
let assistantMsgCount = 0;
const ASSISTANT_REFRESH_INTERVAL = 15;

async function toolAssistant() {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  setListening(true);

  // Private assistant message file — separate from main messages.jsonl
  const assistantMsgFile = path.join(DATA_DIR, 'assistant-messages.jsonl');
  ensureDataDir();

  // Read assistant personality and safety files
  const assistantDir = path.join(DATA_DIR, 'assistant');
  const readFile = (name) => {
    const p = path.join(assistantDir, name);
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  };

  const soul = readFile('Soul.md');
  const identity = readFile('Identity.md');
  const memory = readFile('Memory.md');
  const skills = readFile('Skills.md');
  const tools = readFile('Tools.md');
  const safetyRules = readFile('SafetyRules.md');

  if (!safetyRules) {
    setListening(false);
    return {
      error: 'SafetyRules.md not found in .agent-bridge/assistant/. Run assistant init first.',
    };
  }

  // Read unconsumed messages from private assistant file
  const assistantConsumedFile = path.join(DATA_DIR, 'consumed-assistant-private.json');
  let aConsumed = new Set();
  try {
    const raw = fs.readFileSync(assistantConsumedFile, 'utf8');
    aConsumed = new Set(JSON.parse(raw));
  } catch {}

  const readAssistantMessages = (offset) => {
    if (!fs.existsSync(assistantMsgFile)) return { messages: [], newOffset: 0 };
    const stat = fs.statSync(assistantMsgFile);
    if (stat.size <= offset) return { messages: [], newOffset: offset };
    const fd = fs.openSync(assistantMsgFile, 'r');
    const buf = Buffer.alloc(stat.size - offset);
    fs.readSync(fd, buf, 0, buf.length, offset);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n').filter(l => l.trim());
    const messages = [];
    for (const line of lines) {
      try { messages.push(JSON.parse(line)); } catch {}
    }
    return { messages, newOffset: stat.size };
  };

  const saveAConsumed = () => {
    fs.writeFileSync(assistantConsumedFile, JSON.stringify([...aConsumed]));
  };

  // Check for existing unconsumed messages
  let aOffset = 0;
  if (fs.existsSync(assistantMsgFile)) {
    const { messages: allMsgs } = readAssistantMessages(0);
    for (const msg of allMsgs) {
      if (aConsumed.has(msg.id)) continue;
      if (msg.from !== 'Dashboard') continue;
      aConsumed.add(msg.id);
      saveAConsumed();
      aOffset = fs.statSync(assistantMsgFile).size;
      touchActivity();
      setListening(false);
      const fullRefresh = assistantMsgCount === 0 || assistantMsgCount % ASSISTANT_REFRESH_INTERVAL === 0;
      assistantMsgCount++;
      return buildAssistantResponse(msg, { soul, identity, memory, skills, tools, safetyRules }, fullRefresh);
    }
    aOffset = fs.statSync(assistantMsgFile).size;
  }

  // Wait for new messages using fs.watch on assistant-messages.jsonl
  return new Promise((resolve) => {
    let resolved = false;
    const done = (result) => {
      if (resolved) return;
      resolved = true;
      try { if (watcher) watcher.close(); } catch {}
      clearTimeout(timer);
      clearInterval(heartbeatTimer);
      if (fallbackInterval) clearInterval(fallbackInterval);
      resolve(result);
    };

    let watcher;
    let fallbackInterval;

    const checkMessages = () => {
      const { messages: newMsgs, newOffset } = readAssistantMessages(aOffset);
      aOffset = newOffset;
      for (const msg of newMsgs) {
        if (aConsumed.has(msg.id)) continue;
        if (msg.from !== 'Dashboard') continue;
        aConsumed.add(msg.id);
        saveAConsumed();
        touchActivity();
        setListening(false);
        const fullRefresh = assistantMsgCount === 0 || assistantMsgCount % ASSISTANT_REFRESH_INTERVAL === 0;
        assistantMsgCount++;
        if (fullRefresh) {
          // Re-read all files on refresh cycles (user may edit them)
          const freshSoul = readFile('Soul.md');
          const freshIdentity = readFile('Identity.md');
          const freshMemory = readFile('Memory.md');
          const freshSkills = readFile('Skills.md');
          const freshTools = readFile('Tools.md');
          const freshSafety = readFile('SafetyRules.md');
          done(buildAssistantResponse(msg, {
            soul: freshSoul, identity: freshIdentity, memory: freshMemory,
            skills: freshSkills, tools: freshTools, safetyRules: freshSafety,
          }, true));
        } else {
          // Lightweight — only re-read safety rules (always enforced)
          const freshSafety = readFile('SafetyRules.md');
          done(buildAssistantResponse(msg, { safetyRules: freshSafety }, false));
        }
        return true;
      }
      return false;
    };

    // Create file if it doesn't exist so fs.watch works
    if (!fs.existsSync(assistantMsgFile)) {
      fs.writeFileSync(assistantMsgFile, '');
    }

    try {
      watcher = fs.watch(assistantMsgFile, () => { checkMessages(); });
      watcher.on('error', () => {});
    } catch {
      let pollCount = 0;
      fallbackInterval = setInterval(() => {
        if (checkMessages()) { clearInterval(fallbackInterval); return; }
        pollCount++;
        if (pollCount === 10) {
          clearInterval(fallbackInterval);
          fallbackInterval = setInterval(() => {
            if (checkMessages()) clearInterval(fallbackInterval);
          }, 2000);
        }
      }, 500);
    }

    // Heartbeat every 15s
    const heartbeatTimer = setInterval(() => { touchHeartbeat(registeredName); }, 15000);

    // 5 min timeout
    const timer = setTimeout(() => {
      setListening(false);
      touchActivity();
      done({ retry: true, message: 'No messages from owner in 5 minutes. Call assistant() again to keep waiting.' });
    }, 300000);
  });
}

function buildAssistantResponse(msg, files, fullRefresh) {
  const response = {
    message: {
      id: msg.id,
      from: msg.from,
      content: msg.content,
      timestamp: msg.timestamp,
    },
    context_refreshed: fullRefresh,
  };

  if (fullRefresh) {
    // Full context — first message + every 15th message
    response.assistant_context = {
      soul: files.soul,
      identity: files.identity,
      memory: files.memory,
      skills: files.skills,
      tools: files.tools,
      safety_rules: files.safetyRules,
    };
    response.instructions = [
      'You are in Assistant mode. Read your Soul.md and Identity.md to know your personality.',
      'BEFORE executing ANY action, check the request against safety_rules. If it matches a CRITICAL rule, REFUSE. If it needs confirmation, ASK FIRST.',
      'Check your Memory.md for context from previous conversations.',
      'Check Skills.md and Tools.md to know what you are allowed to do.',
      'Keep responses short (2-3 sentences) since the user is on their phone.',
      'After responding, call assistant() again immediately to keep listening.',
      'To reply, use send_message(to: "Dashboard", content: "your reply").',
      'If the voice transcription looks garbled or unclear, ask the user to repeat.',
    ];
  } else {
    // Lightweight — only safety rules (always needed) + reminder
    response.assistant_context = {
      safety_rules: files.safetyRules,
    };
    response.instructions = [
      'Continue in Assistant mode — your personality files are already in context from earlier.',
      'BEFORE executing ANY action, check the request against safety_rules. If it matches a CRITICAL rule, REFUSE. If it needs confirmation, ASK FIRST.',
      'Keep responses short (2-3 sentences) since the user is on their phone.',
      'After responding, call assistant() again immediately to keep listening.',
      'To reply, use send_message(to: "Dashboard", content: "your reply").',
    ];
  }

  response.next_action = 'Process this message following your personality and safety rules, then call assistant() again.';
  return response;
}

// --- Group conversation tools ---

function toolSetConversationMode(mode) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!['group', 'direct', 'managed'].includes(mode)) return { error: 'Mode must be "group", "direct", or "managed"' };

  // Prevent non-manager agents from destroying a managed session
  if (isManagedMode() && mode !== 'managed') {
    const managed = getManagedConfig();
    if (managed.manager && managed.manager !== registeredName) {
      return { error: `Only the manager (${managed.manager}) can change the conversation mode.` };
    }
  }

  const config = getConfig();
  const previousMode = config.conversation_mode || 'direct';
  config.conversation_mode = mode;
  if (mode === 'group' && !config.group_cooldown) config.group_cooldown = 3000;
  if (mode === 'managed') {
    config.managed = {
      manager: null,
      phase: 'discussion',
      floor: 'closed',
      turn_queue: [],
      turn_current: null,
      phase_history: [{ phase: 'discussion', set_at: new Date().toISOString(), set_by: registeredName }],
    };
    broadcastSystemMessage(`[SYSTEM] Managed conversation mode activated by ${registeredName}. Wait for a manager to be assigned.`, registeredName);
  }
  saveConfig(config);
  canonicalState.appendCanonicalEvent({
    type: 'conversation.mode_updated',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: currentBranch,
    payload: {
      mode,
      previous_mode: previousMode,
      managed: mode === 'managed' ? cloneManagedState(config.managed) : null,
      updated_at: new Date().toISOString(),
    },
  });

  // Notify all agents about mode change (managed mode already broadcasts above)
  if (mode !== 'managed') {
    broadcastSystemMessage(`[MODE] Conversation switched to ${mode} mode by ${registeredName}. ${mode === 'group' ? 'All messages are now shared with everyone.' : 'Messages are now point-to-point.'}`, registeredName);
  }

  const messages = {
    group: 'Group mode enabled. Use listen_group() to receive batched messages. All messages are shared with everyone.',
    direct: 'Direct mode enabled. Use listen() for point-to-point messaging.',
    managed: 'Managed mode enabled. Call claim_manager() to become the manager, or wait for the manager to give you the floor via yield_floor(). Use listen() or listen_group() to receive messages.',
  };
  return { success: true, mode, message: messages[mode] };
}

// --- Managed mode tools ---

function toolClaimManager() {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!isManagedMode()) return { error: 'Not in managed mode. Call set_conversation_mode("managed") first.' };

  const profiles = getProfiles();
  const contract = resolveAgentContract(profiles[registeredName] || {});

  lockConfigFile();
  try {
    const managed = getManagedConfig();
    const previousManager = managed.manager || null;

    // Check if manager already exists and is alive
    if (managed.manager && managed.manager !== registeredName) {
      const agents = getAgents();
      if (agents[managed.manager] && isPidAlive(agents[managed.manager].pid, agents[managed.manager].last_activity)) {
        return { error: `Manager "${managed.manager}" is already active. Only one manager at a time.` };
      }
      // Previous manager is dead — allow takeover
    }

    const claimManagerContract = buildManagedTeamContractContext(contract, 'claim_manager');
    if (claimManagerContract && claimManagerContract.contract_violation && claimManagerContract.contract_violation.status === 'blocked') {
      return {
        error: claimManagerContract.contract_violation.message,
        code: 'contract_violation',
        contract_advisory: claimManagerContract.contract_advisory,
        contract_violation: claimManagerContract.contract_violation,
      };
    }

    managed.manager = registeredName;
    managed.floor = 'closed'; // manager controls the floor
    const config = getConfig();
    config.managed = managed;
    saveConfig(config);
    canonicalState.appendCanonicalEvent({
      type: 'conversation.manager_claimed',
      branchId: currentBranch,
      actorAgent: registeredName,
      sessionId: currentSessionId,
      correlationId: currentBranch,
      payload: {
        manager: registeredName,
        previous_manager: previousManager,
        phase: managed.phase,
        floor: managed.floor,
        claimed_at: new Date().toISOString(),
      },
    });

    broadcastSystemMessage(
      `[SYSTEM] ${registeredName} is now the manager. Wait to be addressed. Do NOT send messages until given the floor.`,
      registeredName
    );

    return attachManagedTeamSurfaceSignals({
      success: true,
      message: `You are now the manager. Use yield_floor() to give agents turns, set_phase() to move through phases, and broadcast() for announcements.`,
      phase: managed.phase,
      floor: managed.floor,
    }, {
      surface: 'claim_manager',
      branchName: currentBranch,
      contract,
      profiles,
      includeContractViolation: true,
      hookLimit: 4,
    });
  } finally {
    unlockConfigFile();
  }
}

function toolYieldFloor(to, prompt = null) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!isManagedMode()) return { error: 'Not in managed mode.' };

  const managed = getManagedConfig();
  if (managed.manager !== registeredName) return { error: 'Only the manager can yield the floor.' };
  const profiles = getProfiles();
  const contract = resolveAgentContract(profiles[registeredName] || {});

  const agents = getAgents();
  const aliveAgents = Object.keys(agents).filter(n => n !== registeredName && isPidAlive(agents[n].pid, agents[n].last_activity));

  if (to === '__close__') {
    // Close the floor — only manager can speak
    managed.floor = 'closed';
    managed.turn_current = null;
    managed.turn_queue = [];
    saveManagedConfig(managed);
    canonicalState.appendCanonicalEvent({
      type: 'conversation.floor_yielded',
      branchId: currentBranch,
      actorAgent: registeredName,
      sessionId: currentSessionId,
      correlationId: currentBranch,
      payload: {
        floor: 'closed',
        to: null,
        turn_queue: [],
        prompt: prompt || null,
        yielded_at: new Date().toISOString(),
      },
    });
    broadcastSystemMessage('[FLOOR] Floor is now closed. Wait for the manager to address you.', registeredName);
    return attachManagedTeamSurfaceSignals({ success: true, floor: 'closed', message: 'Floor closed. Only you can speak.' }, {
      surface: 'yield_floor',
      branchName: currentBranch,
      contract,
      profiles,
      includeContractViolation: true,
      hookLimit: 4,
    });
  }

  if (to === '__open__') {
    // Open floor — round-robin through all alive agents
    managed.floor = 'open';
    managed.turn_queue = aliveAgents;
    managed.turn_current = aliveAgents.length > 0 ? aliveAgents[0] : null;
    saveManagedConfig(managed);
    canonicalState.appendCanonicalEvent({
      type: 'conversation.floor_yielded',
      branchId: currentBranch,
      actorAgent: registeredName,
      sessionId: currentSessionId,
      correlationId: currentBranch,
      payload: {
        floor: 'open',
        to: managed.turn_current,
        turn_queue: [...aliveAgents],
        prompt: prompt || null,
        yielded_at: new Date().toISOString(),
      },
    });

    if (managed.turn_current) {
      const promptText = prompt ? `\n\nTopic: ${prompt}` : '';
      sendSystemMessage(managed.turn_current, `[FLOOR] It is YOUR TURN to speak. You have the floor.${promptText}\nAfter you send your message, the floor will pass to the next agent.`);
      const waiting = aliveAgents.filter(n => n !== managed.turn_current);
      for (const w of waiting) {
        sendSystemMessage(w, `[FLOOR] Open discussion started. ${managed.turn_current} goes first. Wait for your turn.${promptText}`);
      }
    }

    return attachManagedTeamSurfaceSignals({ success: true, floor: 'open', turn_order: aliveAgents, current_turn: managed.turn_current, message: `Open floor: agents will speak in order: ${aliveAgents.join(' → ')}` }, {
      surface: 'yield_floor',
      branchName: currentBranch,
      contract,
      profiles,
      includeContractViolation: true,
      hookLimit: 4,
    });
  }

  // Directed floor — give it to a specific agent
  sanitizeName(to);
  if (!agents[to]) return { error: `Agent "${to}" is not registered.` };
  if (to === registeredName) return { error: 'Cannot yield floor to yourself (you are the manager).' };

  managed.floor = 'directed';
  managed.turn_current = to;
  managed.turn_queue = [to];
  saveManagedConfig(managed);
  canonicalState.appendCanonicalEvent({
    type: 'conversation.floor_yielded',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: currentBranch,
    payload: {
      floor: 'directed',
      to,
      turn_queue: [to],
      prompt: prompt || null,
      yielded_at: new Date().toISOString(),
    },
  });

  const promptText = prompt ? `\n\nManager asks: ${prompt}` : '';
  sendSystemMessage(to, `[FLOOR] The manager has given you the floor. It is YOUR TURN to speak. Respond now.${promptText}`);

  // Tell others to wait
  const waiting = aliveAgents.filter(n => n !== to);
  for (const w of waiting) {
    sendSystemMessage(w, `[FLOOR] ${to} has the floor. Do NOT respond. Wait for your turn.`);
  }

  return attachManagedTeamSurfaceSignals({ success: true, floor: 'directed', agent: to, prompt: prompt || null, message: `Floor given to ${to}. They can now respond.` }, {
    surface: 'yield_floor',
    branchName: currentBranch,
    contract,
    profiles,
    includeContractViolation: true,
    hookLimit: 4,
  });
}

function toolSetPhase(phase) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!isManagedMode()) return { error: 'Not in managed mode.' };

  const managed = getManagedConfig();
  if (managed.manager !== registeredName) return { error: 'Only the manager can set the phase.' };
  const profiles = getProfiles();
  const contract = resolveAgentContract(profiles[registeredName] || {});

  const validPhases = ['discussion', 'planning', 'execution', 'review'];
  if (!validPhases.includes(phase)) return { error: `Invalid phase. Must be one of: ${validPhases.join(', ')}` };

  const previousPhase = managed.phase;
  managed.phase = phase;
  managed.phase_history.push({ phase, set_at: new Date().toISOString(), set_by: registeredName, from: previousPhase });
  if (managed.phase_history.length > 50) managed.phase_history = managed.phase_history.slice(-50);

  const phaseInstructions = {
    discussion: `[PHASE: DISCUSSION] The manager will call on you to share ideas. Do NOT send messages until given the floor.`,
    planning: `[PHASE: PLANNING] The manager will assign tasks. Wait for your assignment. Do NOT send messages until addressed.`,
    execution: `[PHASE: EXECUTION] Work on your assigned tasks. Only message the manager when you need guidance or to report completion. Do NOT message other agents directly.`,
    review: `[PHASE: REVIEW] The manager will call on each agent to report results. Wait for your turn to present.`,
  };

  // During execution, open the floor for task-related messaging to manager
  if (phase === 'execution') {
    managed.floor = 'execution';
    managed.turn_current = null;
  }

  saveManagedConfig(managed);
  canonicalState.appendCanonicalEvent({
    type: 'conversation.phase_updated',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: currentBranch,
    payload: {
      phase,
      previous_phase: previousPhase,
      floor: managed.floor,
      updated_at: new Date().toISOString(),
    },
  });
  broadcastSystemMessage(phaseInstructions[phase], registeredName);

  return attachManagedTeamSurfaceSignals({
    success: true,
    phase,
    previous_phase: previousPhase,
    message: `Phase set to "${phase}". All agents have been notified.`,
  }, {
    surface: 'set_phase',
    branchName: currentBranch,
    contract,
    profiles,
    includeContractViolation: true,
    hookLimit: 4,
  });
}

// Deterministic stagger delay based on agent name (500-1500ms)
// Same agent always gets the same delay, making response ordering predictable
function hashStagger(name) {
  const hash = name.split('').reduce((h, c) => h + c.charCodeAt(0), 0);
  return 500 + (hash * 137) % 1000; // 0.5-1.5s range
}

async function toolListenGroup() {
  if (!registeredName) return { error: 'You must call register() first' };

  // Auto-detect direct mode and delegate to toolListen (prevents wrong-function bugs)
  if (!isGroupMode() && !isManagedMode()) {
    return toolListen();
  }

  setListening(true);

  const consumed = getConsumedIds(registeredName);

  // Autonomous mode: cap listen at 30s — agents should use get_work() instead
  const autonomousTimeout = isAutonomousMode() ? 30000 : null;
  // Default safe cap: 90s. Codex CLI kills tool calls at ~120s; other MCP
  // clients may have similar limits. Landing at 90s universally guarantees a
  // clean empty-batch return for every client. The cost is one extra tool
  // call per 90s of idle — trivial with fs.watch (zero CPU while waiting).
  // Users who know their client can block longer can override via env.
  const envOverride = parseInt(process.env.AGENT_BRIDGE_LISTEN_TIMEOUT_MS || '', 10);
  const DEFAULT_LISTEN_MS = Number.isFinite(envOverride) && envOverride > 0 ? envOverride : 90000;
  const MAX_LISTEN_MS = 300000; // hard ceiling (5 min) — env override is clamped below this
  const clientSafeTimeout = Math.min(DEFAULT_LISTEN_MS, MAX_LISTEN_MS);
  const listenStart = Date.now();

  // Helper: collect unconsumed messages from all sources (general + channels)
  // Uses byte-offset reads for O(new_messages) instead of O(all_messages)
  function collectBatch() {
    const myChannels = getAgentChannels(registeredName);
    const mainFile = getMessagesFile(currentBranch);
    let messages = [];

    // Read new messages from main file using byte offset (efficient)
    if (fs.existsSync(mainFile)) {
      const { messages: newMsgs, newOffset } = readNewMessagesFromFile(lastReadOffset, mainFile);
      messages = newMsgs;
      lastReadOffset = newOffset;
    }

    // Read new messages from channels using per-channel offsets
    for (const ch of myChannels) {
      if (ch === 'general') continue;
      const chFile = getChannelMessagesFile(ch);
      if (fs.existsSync(chFile)) {
        const offsetKey = getChannelOffsetKey(ch, currentBranch);
        const chOffset = channelOffsets.get(offsetKey) || 0;
        const { messages: chMsgs, newOffset } = readNewMessagesFromFile(chOffset, chFile);
        messages = messages.concat(chMsgs);
        channelOffsets.set(offsetKey, newOffset);
      }
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const batch = [];
    const perms = getPermissions();
    for (const msg of messages) {
      if (consumed.has(msg.id)) continue;
      if (msg.to === '__group__' && msg.from === registeredName) { consumed.add(msg.id); continue; }
      // PRIORITY: Owner/Dashboard messages are ALWAYS delivered (never filtered)
      const isOwnerMessage = msg.from === 'Dashboard' || msg.from === 'Owner' || msg.from === 'dashboard' || msg.from === 'owner';
      if (!isOwnerMessage) {
        if (msg.to !== registeredName && msg.to !== '__all__' && msg.to !== '__group__') continue;
        if (perms[registeredName] && perms[registeredName].can_read) {
          const allowed = perms[registeredName].can_read;
          if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(msg.from) && !msg.system) continue;
        }
      }
      batch.push(msg);
      consumed.add(msg.id);
      markAsRead(registeredName, msg.id);
    }
    return batch;
  }

  // Check immediately first — no need to wait if messages are already pending
  const immediateBatch = collectBatch();
  if (immediateBatch.length > 0) {
    return buildListenGroupResponse(immediateBatch, consumed, registeredName, listenStart);
  }

  // Use fs.watch for instant wake on new messages (no polling — zero CPU while waiting)
  // Falls back to adaptive polling if fs.watch is unavailable
  return new Promise((resolve) => {
    let resolved = false;
    const done = (batch) => {
      if (resolved) return;
      resolved = true;
      try { if (watcher) watcher.close(); } catch {}
      try { if (channelWatchers) channelWatchers.forEach(w => { try { w.close(); } catch {} }); } catch {}
      clearTimeout(timer);
      clearTimeout(heartbeatTimer);
      if (fallbackInterval) clearInterval(fallbackInterval);
      if (batch && batch.length > 0) {
        resolve(buildListenGroupResponse(batch, consumed, registeredName, listenStart));
      } else {
        // Timeout — return minimal empty response
        setListening(false);
        sendsSinceLastListen = 0;
        sendLimit = 10;
        touchHeartbeat(registeredName);
        resolve({
          messages: [],
          message_count: 0,
          retry: true,
          batch_summary: isManagedMode()
            ? 'No new messages — this is NORMAL, not an error. Call listen() again immediately to keep waiting. Codex CLI may end the call near 120s; that is the host limit, not a failure.'
            : 'No new messages — this is NORMAL, not an error. Call listen_group() again immediately to keep listening. Codex CLI may end the call near 120s; that is the host limit, not a failure.',
        });
      }
    };

    let watcher;
    let channelWatchers = [];
    let fallbackInterval;

    try {
      // Watch main messages file for changes
      const msgFile = getMessagesFile(currentBranch);
      watcher = fs.watch(msgFile, () => {
        const batch = collectBatch();
        if (batch.length > 0) done(batch);
      });
      watcher.on('error', () => {});

      // Also watch channel files
      const myChannels = getAgentChannels(registeredName);
      for (const ch of myChannels) {
        if (ch === 'general') continue;
        const chFile = getChannelMessagesFile(ch);
        if (fs.existsSync(chFile)) {
          try {
            const chWatcher = fs.watch(chFile, () => {
              const batch = collectBatch();
              if (batch.length > 0) done(batch);
            });
            chWatcher.on('error', () => {});
            channelWatchers.push(chWatcher);
          } catch {}
        }
      }
    } catch {
      // fs.watch not available — fall back to adaptive polling
      let pollCount = 0;
      fallbackInterval = setInterval(() => {
        const batch = collectBatch();
        if (batch.length > 0) {
          clearInterval(fallbackInterval);
          done(batch);
        }
        pollCount++;
        // Adaptive: slow down after initial fast checks
        if (pollCount === 10) {
          clearInterval(fallbackInterval);
          fallbackInterval = setInterval(() => {
            const batch = collectBatch();
            if (batch.length > 0) { clearInterval(fallbackInterval); done(batch); }
          }, 2000); // slow poll every 2s
        }
      }, 500); // fast poll first 5s
    }

    // Heartbeat every 15s while waiting — prevents dashboard from showing agent as dead
    const heartbeatTimer = setInterval(() => {
      touchHeartbeat(registeredName);
    }, 15000);

    // Pick the tightest applicable cap: autonomous (30s) > client-safe default
    // (90s, configurable via AGENT_BRIDGE_LISTEN_TIMEOUT_MS) > hard ceiling (5min).
    const candidateTimeouts = [MAX_LISTEN_MS, clientSafeTimeout];
    if (autonomousTimeout) candidateTimeouts.push(autonomousTimeout);
    const effectiveTimeout = Math.min(...candidateTimeouts);

    // Timeout: don't block forever
    const timer = setTimeout(() => done([]), effectiveTimeout);
  });
}

// Build the response for listen_group — kept lean to reduce context accumulation
// Context/history removed: agents should call get_history() when they need it
function buildListenGroupResponse(batch, consumed, agentName, listenStart) {
  saveConsumedIds(agentName, consumed);
  touchActivity();
  setListening(false);
  sendsSinceLastListen = 0;
  const wasAddressed = batch.some(m => m.addressed_to && m.addressed_to.includes(agentName));
  sendLimit = wasAddressed ? 10 : 5;

  // Sort batch by priority: system > threaded replies > direct > broadcast
  function messagePriority(m) {
    if (m.system || m.from === '__system__') return 0;
    if (m.reply_to || m.thread_id) return 1;
    if (!m.broadcast) return 2;
    return 3;
  }
  batch.sort((a, b) => {
    const pa = messagePriority(a), pb = messagePriority(b);
    if (pa !== pb) return pa - pb;
    return new Date(a.timestamp) - new Date(b.timestamp);
  });

  // Build batch summary for triage
  const summaryCounts = {};
  for (const m of batch) {
    const type = m.system || m.from === '__system__' ? 'system'
      : m.broadcast ? 'broadcast' : (m.reply_to || m.thread_id) ? 'thread' : 'direct';
    const key = `${m.from}:${type}`;
    summaryCounts[key] = (summaryCounts[key] || 0) + 1;
  }
  const summaryParts = [];
  for (const [key, count] of Object.entries(summaryCounts)) {
    const [from, type] = key.split(':');
    summaryParts.push(`${count} ${type} from ${from}`);
  }
  const batchSummary = `${batch.length} messages: ${summaryParts.join(', ')}`;

  // Agent statuses — lightweight, no history reads. Uses the recency grace
  // so peers that just briefly returned from listen_group() to process a
  // batch still read as "listening", not "working".
  const agents = getAgents();
  const agentNames = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
  const agentStatus = {};
  for (const n of agentNames) {
    if (isRecentlyListening(agents[n])) {
      agentStatus[n] = 'listening';
    } else {
      const lastListened = agents[n].last_listened_at;
      const sinceLastListen = lastListened ? Date.now() - new Date(lastListened).getTime() : Infinity;
      agentStatus[n] = sinceLastListen > 120000 ? 'unresponsive' : 'working';
    }
  }

  const now = Date.now();
  const result = {
    messages: batch.map(m => {
      const ageSec = Math.round((now - new Date(m.timestamp).getTime()) / 1000);
      const isOwnerMsg = m.from === 'Dashboard' || m.from === 'Owner' || m.from === 'dashboard' || m.from === 'owner';
      return {
        id: m.id, from: m.from, to: m.to, content: m.content,
        timestamp: m.timestamp,
        age_seconds: ageSec,
        ...(ageSec > 30 && { delayed: true }),
        ...(m.reply_to && { reply_to: m.reply_to }),
        ...(m.thread_id && { thread_id: m.thread_id }),
        ...(m.addressed_to && { addressed_to: m.addressed_to }),
        ...(m.to === '__group__' && {
          addressed_to_you: !m.addressed_to || m.addressed_to.includes(agentName),
          should_respond: !m.addressed_to || m.addressed_to.includes(agentName),
        }),
        ...(isOwnerMsg && {
          from_owner: true,
          system_instruction: 'OWNER MESSAGE. You MUST reply by calling send_message(to="Dashboard", content="your reply") — the owner reads replies ONLY in the dashboard Messages tab. Any text you write in your CLI terminal is INVISIBLE to the owner and does not count as a reply. After send_message, call listen_group() again immediately.',
        }),
      };
    }),
    message_count: batch.length,
    batch_summary: batchSummary,
    agents_online: agentNames.length,
    agents_status: agentStatus,
  };

  // Managed mode: add context so agents know whether to respond
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const youHaveFloor = managed.turn_current === agentName;
    const youAreManager = managed.manager === agentName;

    result.managed_context = {
      phase: managed.phase, floor: managed.floor, manager: managed.manager,
      you_have_floor: youHaveFloor, you_are_manager: youAreManager,
      turn_current: managed.turn_current,
    };

    if (youAreManager) {
      result.should_respond = true;
      result.instructions = 'You are the MANAGER. Decide who speaks next using yield_floor(), or advance the phase using set_phase().';
    } else if (youHaveFloor) {
      result.should_respond = true;
      result.instructions = 'It is YOUR TURN to speak. Respond now, then the floor will return to the manager.';
    } else if (managed.floor === 'execution') {
      result.should_respond = false;
      result.instructions = `EXECUTION PHASE: Focus on your assigned tasks. Only message the manager (${managed.manager}) if you need help or to report completion.`;
    } else {
      result.should_respond = false;
      result.instructions = 'DO NOT RESPOND. Wait for the manager to give you the floor. Call listen() again to wait.';
    }
  }

  const fromDashboard = Array.isArray(batch) && batch.some(m => m && (m.from === 'Dashboard' || m.from === 'Owner' || m.from === 'dashboard' || m.from === 'owner'));
  const dashboardReplyHint = fromDashboard
    ? ' One of these messages is from Dashboard/Owner — reply via send_message(to="Dashboard") so the owner sees your reply in the dashboard Messages tab. Do NOT narrate the reply in your CLI terminal; terminal output is invisible to the owner.'
    : '';
  result.next_action = (isAutonomousMode()
    ? 'Process these messages, then call get_work() to continue the proactive work loop. Do NOT call listen_group() — use get_work() instead.'
    : 'After processing these messages and sending your response, call listen_group() again immediately. Never stop listening.') + dashboardReplyHint;

  const listenSurface = isManagedMode() && result.managed_context && result.managed_context.you_are_manager
    ? 'manager_listen'
    : (isManagedMode() ? 'participant_listen' : 'team_listen');

  return attachManagedTeamSurfaceSignals(result, {
    surface: listenSurface,
    agentName,
    branchName: currentBranch,
    includeContractViolation: !!(result.managed_context && result.managed_context.you_are_manager),
    hookLimit: isManagedMode() ? 3 : 2,
  });
}

function toolGetHistory(limit = 50, thread_id = null) {
  limit = Math.min(Math.max(1, limit || 50), 500);
  // Tail-read with 2x buffer to account for filtering reducing results
  let history = tailReadJsonl(getHistoryFile(currentBranch), limit * 2);
  if (thread_id) {
    history = history.filter(m => m.thread_id === thread_id || m.id === thread_id);
  }
  // Filter by permissions — only show messages involving this agent or permitted senders
  if (registeredName) {
    const perms = getPermissions();
    if (perms[registeredName] && perms[registeredName].can_read) {
      const allowed = perms[registeredName].can_read;
      if (allowed !== '*' && Array.isArray(allowed)) {
        history = history.filter(m => m.from === registeredName || m.to === registeredName || allowed.includes(m.from));
      }
    }
  }
  const recent = history.slice(-limit);
  const acks = getAcks();

  return {
    count: recent.length,
    total: history.length,
    messages: recent.map(m => ({
      id: m.id,
      from: m.from,
      to: m.to,
      content: m.content,
      timestamp: m.timestamp,
      acked: !!acks[m.id],
      ...(m.reply_to && { reply_to: m.reply_to }),
      ...(m.thread_id && { thread_id: m.thread_id }),
    })),
  };
}

function toolHandoff(to, context) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Managed mode: enforce floor control (same as send_message)
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const isManager = managed.manager === registeredName;
    if (!isManager) {
      if (managed.floor === 'closed' || (managed.floor === 'directed' && managed.turn_current !== registeredName) || (managed.floor === 'open' && managed.turn_current !== registeredName)) {
        return { error: `Floor control active. You cannot hand off until you have the floor. Call listen() to wait.` };
      }
      if (managed.floor === 'execution' && to !== managed.manager) {
        return { error: `During execution phase, you can only hand off to the manager (${managed.manager}).` };
      }
    }
  }

  const sizeErr = validateContentSize(context);
  if (sizeErr) return sizeErr;

  // Permission check
  if (!canSendTo(registeredName, to)) {
    return { error: `Permission denied: you are not allowed to hand off to "${to}"` };
  }

  const agents = getAgents();
  if (!agents[to]) {
    return { error: `Agent "${to}" is not registered` };
  }
  if (to === registeredName) {
    return { error: 'Cannot hand off to yourself' };
  }

  messageSeq++;
  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: registeredName,
    to,
    content: context,
    timestamp: new Date().toISOString(),
    type: 'handoff',
  };

  appendBranchConversationMessage(msg);
  touchActivity();

  return {
    success: true,
    messageId: msg.id,
    message: `Handed off to ${to}. They will receive your context and continue the work.`,
  };
}

function toolShareFile(filePath, to = null, summary = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Managed mode: enforce floor control
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const isManager = managed.manager === registeredName;
    if (!isManager) {
      if (managed.floor === 'closed' || (managed.floor === 'directed' && managed.turn_current !== registeredName) || (managed.floor === 'open' && managed.turn_current !== registeredName)) {
        return { error: `Floor control active. You cannot share files until you have the floor. Call listen() to wait.` };
      }
      if (managed.floor === 'execution' && to && to !== managed.manager) {
        return { error: `During execution phase, you can only share files with the manager (${managed.manager}).` };
      }
    }
  }

  // Resolve the file path — restrict to project directory (follow symlinks)
  const resolved = path.resolve(filePath);
  const allowedRoot = path.resolve(process.cwd());
  let realPath;
  try { realPath = fs.realpathSync(resolved); } catch { return { error: 'File not found' }; }
  if (!realPath.startsWith(allowedRoot + path.sep) && realPath !== allowedRoot) {
    return { error: 'File path must be within the project directory' };
  }

  // Deny sensitive files
  const basename = path.basename(realPath).toLowerCase();
  const sensitivePatterns = ['.env', '.env.local', '.env.production', '.env.development', 'mcp.json', '.mcp.json', '.lan-token'];
  const sensitiveExtensions = ['.pem', '.key', '.p12', '.pfx', '.keystore'];
  if (sensitivePatterns.some(p => basename === p || basename.startsWith('.env'))) {
    return { error: 'Cannot share sensitive files (.env, credentials, keys)' };
  }
  if (sensitiveExtensions.some(ext => basename.endsWith(ext))) {
    return { error: 'Cannot share sensitive files (.pem, .key, certificates)' };
  }
  // Also block sharing files from the data directory itself
  const dataDir = path.resolve(DATA_DIR);
  if (realPath.startsWith(dataDir + path.sep) || realPath === dataDir) {
    return { error: 'Cannot share agent bridge data files' };
  }

  const stat = fs.statSync(realPath);
  if (stat.size > 100000) {
    return { error: `File too large (${Math.round(stat.size / 1024)}KB). Maximum 100KB for sharing.` };
  }

  const agents = getAgents();
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName);

  if (!to) {
    if (otherAgents.length === 1) {
      to = otherAgents[0];
    } else if (otherAgents.length === 0) {
      return { error: 'No other agents registered' };
    } else {
      return { error: `Multiple agents online (${otherAgents.join(', ')}). Specify 'to' parameter.` };
    }
  }

  if (!agents[to]) {
    return { error: `Agent "${to}" is not registered` };
  }

  const fileContent = fs.readFileSync(realPath, 'utf8');
  const fileName = path.basename(realPath);

  messageSeq++;
  const content = summary
    ? `**Shared file: \`${fileName}\`**\n${summary}\n\n\`\`\`\n${fileContent}\n\`\`\``
    : `**Shared file: \`${fileName}\`**\n\n\`\`\`\n${fileContent}\n\`\`\``;

  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: registeredName,
    to,
    content,
    timestamp: new Date().toISOString(),
    type: 'file_share',
    file: { name: fileName, size: stat.size },
  };

  appendBranchConversationMessage(msg);
  touchActivity();

  return {
    success: true,
    messageId: msg.id,
    file: fileName,
    size: stat.size,
    to,
  };
}

// --- Task management ---

function getTasks(branchName = currentBranch) {
  const branch = sanitizeBranchName(branchName || 'main');
  return cachedRead(`tasks:${branch}`, () => canonicalState.listTasks({ branch }), 2000);
}

function saveTasks(tasks, branchName = currentBranch) {
  const branch = sanitizeBranchName(branchName || 'main');
  return tasksWorkflowsState.saveTasks(tasks, { branch });
}

function toolCreateTask(title, description = '', assignee = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  if (!title || !title.trim()) {
    return { error: 'Task title cannot be empty' };
  }
  if (title.length > 200) {
    return { error: 'Task title too long (max 200 characters)' };
  }
  if (description.length > 5000) {
    return { error: 'Task description too long (max 5000 characters)' };
  }

  const agents = getAgents();
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName);

  if (!assignee && otherAgents.length === 1) {
    assignee = otherAgents[0];
  }

  const task = {
    id: 'task_' + generateId(),
    title,
    description,
    status: 'pending',
    assignee: assignee || null,
    created_by: registeredName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: [],
  };

  ensureDataDir();

  // Task-channel auto-binding: with 5+ agents and an assignee, auto-create a task channel
  // This naturally splits 10-agent noise into focused sub-teams
  let taskChannel = null;
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  if (assignee && aliveCount >= 5 && isGroupMode()) {
    const shortId = task.id.replace('task_', '').substring(0, 6);
    taskChannel = `task-${shortId}`;
    const channels = getChannelsData();
    if (!channels[taskChannel]) {
      channels[taskChannel] = {
        description: `Task: ${title.substring(0, 100)}`,
        members: [registeredName],
        created_by: '__system__',
        created_at: new Date().toISOString(),
        task_id: task.id,
      };
      if (assignee && assignee !== registeredName) channels[taskChannel].members.push(assignee);
      saveChannelsData(channels);
    }
    task.channel = taskChannel;
  }

  const createdTask = canonicalState.createTask({
    task,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: task.id,
  });
  if (createdTask.error) return createdTask;
  touchActivity();

  const result = { success: true, task_id: task.id, assignee: task.assignee };
  if (taskChannel) result.channel = taskChannel;
  return result;
}

function toolUpdateTask(taskId, status, notes = null, evidence = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  const validStatuses = ['pending', 'in_progress', 'in_review', 'done', 'blocked', 'blocked_permanent'];
  if (!validStatuses.includes(status)) {
    return { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` };
  }

  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) {
    return { error: `Task not found: ${taskId}` };
  }
  const agents = getAgents();
  const profiles = getProfiles();
  const ownerAgentName = task.assignee || registeredName;
  const ownerAgentRecord = ownerAgentName ? agents[ownerAgentName] : null;
  const ownerAlive = ownerAgentName === registeredName
    ? true
    : !!(ownerAgentRecord && isPidAlive(ownerAgentRecord.pid, ownerAgentRecord.last_activity));
  const ownerIdleMs = ownerAgentRecord && ownerAgentRecord.last_activity
    ? Math.max(0, Date.now() - new Date(ownerAgentRecord.last_activity).getTime())
    : 0;
  const taskPolicyContext = buildAutonomyPolicyContext(
    ownerAgentName,
    (ownerAgentRecord && ownerAgentRecord.branch) || currentBranch,
    ownerAgentName === registeredName ? currentSessionId : null,
    agents,
    profiles
  );
  const retryPolicy = status === 'pending'
    ? classifyRetryPolicy({
        target: buildTaskPolicyTarget(task),
        context: taskPolicyContext,
        attemptCount: Array.isArray(task.attempt_agents) ? task.attempt_agents.length : 0,
        ownerAlive,
        idleMs: ownerIdleMs,
      })
    : null;

  // Prevent race condition: can't claim a task already in_progress by another agent
  if (status === 'in_progress' && task.status === 'in_progress' && task.assignee && task.assignee !== registeredName) {
    return { error: `Task already claimed by ${task.assignee}. Use suggest_task() to find another task.` };
  }
  // Auto-assign on claim
  if (status === 'in_progress' && !task.assignee) {
    task.assignee = registeredName;
  }
  // Track attempt agents on claim
  if (status === 'in_progress') {
    if (!task.attempt_agents) task.attempt_agents = [];
    if (!task.attempt_agents.includes(registeredName)) task.attempt_agents.push(registeredName);
  }

  // Circuit breaker: explicit bounded retry policy blocks permanently at the canonical limit.
  if (status === 'pending' && retryPolicy && retryPolicy.state === 'blocked_permanent') {
    const blockedAt = new Date().toISOString();
    const completion = canonicalState.updateTaskStatus({
      taskId,
      status: 'blocked_permanent',
      notes,
      actor: registeredName,
      branch: currentBranch,
      sessionId: currentSessionId,
      correlationId: taskId,
      sourceTool: 'update_task',
      assignee: task.assignee || null,
      blockReason: retryPolicy.summary,
      escalatedAt: blockedAt,
      policySignal: buildPersistedPolicySignal('retry', retryPolicy, { at: blockedAt }),
    });
    if (completion.error) return completion;
    const updatedTask = getTasks().find((entry) => entry.id === taskId) || task;
    broadcastSystemMessage(`[CIRCUIT BREAKER] Task "${updatedTask.title}" permanently blocked by explicit retry policy after ${retryPolicy.attempt_count}/${retryPolicy.max_attempts} attempts. Needs human review.`);
    touchActivity();
    return {
      success: true,
      task_id: updatedTask.id,
      status: updatedTask.status,
      circuit_breaker: true,
      retry_policy: retryPolicy,
      message: 'Task permanently blocked — bounded retry policy requires human review.',
    };
  }

  if (status === 'done') {
    const commandId = `cmd_${generateId()}`;
    const completion = canonicalState.updateTaskStatus({
      taskId,
      status,
      notes,
      actor: registeredName,
      branch: currentBranch,
      sessionId: currentSessionId,
      commandId,
      correlationId: taskId,
      evidence,
      sourceTool: 'update_task',
    });
    if (completion.error) return completion;

    const updatedTask = getTasks().find((entry) => entry.id === taskId) || task;
    touchActivity();

    try {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), {
        _status: `Completed: ${updatedTask.title}`,
        _status_since: new Date().toISOString(),
      }));
    } catch {}

    fireEvent('task_complete', { title: updatedTask.title, created_by: updatedTask.created_by });

    try {
      const economyFile = path.join(DATA_DIR, 'economy.jsonl');
      const creditEntry = JSON.stringify({ agent: registeredName, amount: 10, reason: 'task_completed', type: 'earn', task: updatedTask.title, timestamp: new Date().toISOString() }) + '\n';
      fs.appendFileSync(economyFile, creditEntry);
    } catch {}

    const resolvedDependencies = canonicalState.mutateDependencies((deps) => {
      const resolved = [];
      for (const dep of deps) {
        if (dep.depends_on === taskId && !dep.resolved) {
          dep.resolved = true;
          dep.resolved_at = updatedTask.completed_at || new Date().toISOString();
          dep.resolved_by = registeredName;
          resolved.push(dep);
          const blockedTask = getTasks().find(t => t.id === dep.task_id);
          if (blockedTask && blockedTask.assignee) {
            fireEvent('dependency_met', { task_title: updatedTask.title, notify: blockedTask.assignee });
          }
        }
      }
      return resolved;
    }, { branch: currentBranch });

    for (const dep of resolvedDependencies) {
      canonicalState.appendCanonicalEvent({
        type: 'dependency.resolved',
        branchId: currentBranch,
        actorAgent: registeredName,
        sessionId: currentSessionId,
        causationId: completion.task_event_id || completion.evidence_event_id || null,
        correlationId: dep.id,
        payload: {
          dependency_id: dep.id,
          task_id: dep.task_id,
          depends_on: dep.depends_on,
          resolved_at: dep.resolved_at,
          resolved_by: registeredName,
          resolved_by_task_id: updatedTask.id,
          reason: 'dependency_target_completed',
        },
      });
    }

    if (updatedTask.channel) {
      const channels = getChannelsData();
      if (channels[updatedTask.channel]) {
        delete channels[updatedTask.channel];
        saveChannelsData(channels);
      }
    }

    const agents = getAgents();
    const aliveOthers = Object.keys(agents).filter(n => n !== registeredName && isPidAlive(agents[n].pid, agents[n].last_activity));
    if (aliveOthers.length > 0) {
      broadcastSystemMessage(`[REVIEW NEEDED] ${registeredName} completed task "${updatedTask.title}". Team: please review the work and call submit_review() if applicable.`, registeredName);
    }

    return {
      success: true,
      task_id: updatedTask.id,
      status: updatedTask.status,
      title: updatedTask.title,
      evidence_ref: completion.evidence_ref || null,
    };
  }

  const nonTerminalUpdate = canonicalState.updateTaskStatus({
    taskId,
    status,
    notes,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: taskId,
    sourceTool: 'update_task',
    assignee: status === 'in_progress' ? (task.assignee || registeredName) : task.assignee,
    trackAttemptAgent: status === 'in_progress',
    clearEscalatedAt: status !== 'blocked' && !(status === 'pending' && retryPolicy && retryPolicy.state === 'escalate'),
    escalatedAt: status === 'pending' && retryPolicy && retryPolicy.state === 'escalate' && !task.escalated_at
      ? new Date().toISOString()
      : undefined,
    policySignal: status === 'pending' && retryPolicy && retryPolicy.state === 'escalate'
      ? buildPersistedPolicySignal('retry', retryPolicy)
      : undefined,
    clearPolicySignal: status === 'in_progress' || (status === 'pending' && (!retryPolicy || retryPolicy.state === 'continue')),
  });
  if (nonTerminalUpdate.error) return nonTerminalUpdate;

  const updatedTask = getTasks().find((entry) => entry.id === taskId) || task;
  touchActivity();

  if (status === 'pending' && retryPolicy && retryPolicy.state === 'escalate' && !task.escalated_at) {
    broadcastSystemMessage(
      `[RETRY ESCALATION] Task "${updatedTask.title}" now has ${retryPolicy.attempt_count}/${retryPolicy.max_attempts} recorded retry attempts. ${retryPolicy.summary}`,
      registeredName
    );
  }

  // Auto-status: update agent's workspace status on task state changes
  try {
    if (status === 'in_progress') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `Working on: ${updatedTask.title}`, _status_since: new Date().toISOString() }));
    } else if (status === 'done') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `Completed: ${updatedTask.title}`, _status_since: new Date().toISOString() }));
    } else if (status === 'blocked') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `BLOCKED on: ${updatedTask.title}`, _status_since: new Date().toISOString() }));
    }
  } catch {}

  // Task-channel auto-join: when claiming a task that has a channel, auto-join it
  if (status === 'in_progress' && updatedTask.channel) {
    const channels = getChannelsData();
    if (channels[updatedTask.channel] && !channels[updatedTask.channel].members.includes(registeredName)) {
      channels[updatedTask.channel].members.push(registeredName);
      saveChannelsData(channels);
    }
  }

  return {
    success: true,
    task_id: updatedTask.id,
    status: updatedTask.status,
    title: updatedTask.title,
    ...(retryPolicy ? { retry_policy: retryPolicy } : {}),
  };
}

function toolListTasks(status = null, assignee = null) {
  let tasks = getTasks();
  if (status) tasks = tasks.filter(t => t.status === status);
  if (assignee) tasks = tasks.filter(t => t.assignee === assignee);

  return {
    count: tasks.length,
    tasks: tasks.map(t => ({
      id: t.id,
      title: t.title,
      description: t.description,
      status: t.status,
      assignee: t.assignee,
      created_by: t.created_by,
      created_at: t.created_at,
      updated_at: t.updated_at,
      notes_count: t.notes.length,
    })),
  };
}

function toolGetSummary(lastN = 20) {
  lastN = Math.min(Math.max(1, lastN || 20), 500);
  const recent = tailReadJsonl(getHistoryFile(currentBranch), lastN);
  if (recent.length === 0) {
    return { summary: 'No messages in conversation yet.', message_count: 0 };
  }

  // Use agents.json for agent list instead of scanning entire history
  const agentsData = getAgents();
  const agents = Object.keys(agentsData);
  const threads = [...new Set(recent.filter(m => m.thread_id).map(m => m.thread_id))];

  // Build condensed summary
  const lines = recent.map(m => {
    const preview = m.content.length > 150 ? m.content.substring(0, 150) + '...' : m.content;
    return `[${m.from} → ${m.to}]: ${preview}`;
  });

  return {
    total_messages: recent.length,
    showing_last: recent.length,
    agents_involved: agents,
    thread_count: threads.length,
    first_message: recent[0].timestamp,
    last_message: recent[recent.length - 1].timestamp,
    summary: lines.join('\n'),
  };
}

function toolSearchMessages(query, from = null, limit = 20) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof query !== 'string' || query.length < 2) return { error: 'Query must be at least 2 characters' };
  if (query.length > 100) return { error: 'Query too long (max 100 chars)' };
  limit = Math.min(Math.max(1, limit || 20), 50);

  // Search general history + all channel history files
  // Tail-read with limit*10 buffer first for performance; fall back to full read if needed
  const tailBuffer = limit * 10;
  let allMessages = tailReadJsonl(getHistoryFile(currentBranch), tailBuffer);
  try {
    const myChannels = getAgentChannels(registeredName);
    for (const ch of myChannels) {
      if (ch === 'general') continue;
      const chFile = getChannelHistoryFile(ch);
      if (fs.existsSync(chFile)) {
        const chMsgs = tailReadJsonl(chFile, tailBuffer);
        allMessages = allMessages.concat(chMsgs);
      }
    }
  } catch {}
  // Sort by timestamp descending for newest-first results
  allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const queryLower = query.toLowerCase();
  let results = [];
  for (let i = 0; i < allMessages.length && results.length < limit; i++) {
    const m = allMessages[i];
    if (from && m.from !== from) continue;
    if (m.content && m.content.toLowerCase().includes(queryLower)) {
      results.push({
        id: m.id, from: m.from, to: m.to,
        preview: m.content.substring(0, 200),
        timestamp: m.timestamp,
        ...(m.channel && { channel: m.channel }),
      });
    }
  }
  // Fall back to full read if tail search found nothing
  if (results.length === 0) {
    allMessages = readJsonl(getHistoryFile(currentBranch));
    try {
      const myChannels = getAgentChannels(registeredName);
      for (const ch of myChannels) {
        if (ch === 'general') continue;
        const chFile = getChannelHistoryFile(ch);
        if (fs.existsSync(chFile)) {
          allMessages = allMessages.concat(readJsonl(chFile));
        }
      }
    } catch {}
    allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    for (let i = 0; i < allMessages.length && results.length < limit; i++) {
      const m = allMessages[i];
      if (from && m.from !== from) continue;
      if (m.content && m.content.toLowerCase().includes(queryLower)) {
        results.push({
          id: m.id, from: m.from, to: m.to,
          preview: m.content.substring(0, 200),
          timestamp: m.timestamp,
          ...(m.channel && { channel: m.channel }),
        });
      }
    }
  }
  return { query, results_count: results.length, results, searched: allMessages.length };
}

function toolReset() {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Auto-archive before clearing — never lose conversations
  // Check file size instead of reading entire file to determine if non-empty
  if (fs.existsSync(getHistoryFile('main'))) {
    const histStat = fs.statSync(getHistoryFile('main'));
    if (histStat.size > 0) {
      const archiveDir = path.join(DATA_DIR, 'archives');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true, mode: 0o700 });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(archiveDir, `conversation-${timestamp}.jsonl`);
      fs.copyFileSync(getHistoryFile('main'), archivePath);
    }
  }

  // Remove known fixed files
  for (const f of [MESSAGES_FILE, HISTORY_FILE, AGENTS_FILE, ACKS_FILE, TASKS_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // Glob for all consumed-*.json files (dynamic agent names)
  if (fs.existsSync(DATA_DIR)) {
    const files = fs.readdirSync(DATA_DIR);
    for (const f of files) {
      if (f.startsWith('consumed-') && f.endsWith('.json')) {
        fs.unlinkSync(path.join(DATA_DIR, f));
      }
    }
  }
  // Remove profiles, workflows, branches, permissions, read receipts, and new ecosystem files
  for (const f of [PROFILES_FILE, WORKFLOWS_FILE, BRANCHES_FILE, PERMISSIONS_FILE, READ_RECEIPTS_FILE, CONFIG_FILE, DECISIONS_FILE, KB_FILE, LOCKS_FILE, PROGRESS_FILE, VOTES_FILE, REVIEWS_FILE, DEPS_FILE, REPUTATION_FILE, COMPRESSED_FILE]) {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // Remove workspaces dir
  if (fs.existsSync(WORKSPACES_DIR)) {
    for (const f of fs.readdirSync(WORKSPACES_DIR)) fs.unlinkSync(path.join(WORKSPACES_DIR, f));
    fs.rmdirSync(WORKSPACES_DIR);
  }
  if (fs.existsSync(DATA_DIR)) {
    for (const entry of fs.readdirSync(DATA_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (!/^branch-[a-zA-Z0-9_-]+-workspaces$/.test(entry.name)) continue;
      fs.rmSync(path.join(DATA_DIR, entry.name), { recursive: true, force: true });
    }
  }
  // Remove branch files
  if (fs.existsSync(DATA_DIR)) {
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.startsWith('branch-') && (f.endsWith('-messages.jsonl') || f.endsWith('-history.jsonl'))) {
        fs.unlinkSync(path.join(DATA_DIR, f));
      }
    }
  }
  registeredName = null;
  lastReadOffset = 0;
  messageSeq = 0;
  currentBranch = 'main';
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  return { success: true, message: 'All data cleared. Conversation archived before reset.' };
}

// --- Phase 1: Profile tool ---

function toolUpdateProfile(displayName, avatar, bio, role, appearance, archetype, skills, contractMode) {
  if (!registeredName) return { error: 'You must call register() first' };

  const profiles = getProfiles();
  if (!profiles[registeredName]) {
    profiles[registeredName] = createDefaultProfileRecord(registeredName);
  }
  const p = profiles[registeredName];
  if (displayName !== undefined && displayName !== null) {
    if (typeof displayName !== 'string' || displayName.length > 30) return { error: 'display_name must be <= 30 chars' };
    p.display_name = displayName;
  }
  if (avatar !== undefined && avatar !== null) {
    if (typeof avatar !== 'string' || avatar.length > 65536) return { error: 'avatar too large (max 64KB)' };
    p.avatar = avatar;
  }
  if (bio !== undefined && bio !== null) {
    if (typeof bio !== 'string' || bio.length > 200) return { error: 'bio must be <= 200 chars' };
    p.bio = bio;
  }
  if (role !== undefined && role !== null) {
    if (typeof role !== 'string' || role.length > 30) return { error: 'role must be <= 30 chars' };
    p.role = role;
  }
  if (appearance !== undefined && appearance !== null) {
    if (typeof appearance !== 'object') return { error: 'appearance must be an object' };
    const validKeys = ['head_color', 'hair_style', 'hair_color', 'eye_style', 'mouth_style', 'shirt_color', 'pants_color', 'shoe_color', 'glasses', 'glasses_color', 'headwear', 'headwear_color', 'neckwear', 'neckwear_color'];
    const validHairStyles = ['none', 'short', 'spiky', 'long', 'ponytail', 'bob'];
    const validEyeStyles = ['dots', 'anime', 'glasses', 'sleepy'];
    const validMouthStyles = ['smile', 'neutral', 'open'];
    const validGlasses = ['none', 'round', 'square', 'sunglasses'];
    const validHeadwear = ['none', 'beanie', 'cap', 'headphones', 'headband'];
    const validNeckwear = ['none', 'tie', 'bowtie', 'lanyard'];
    const cleaned = {};
    for (const [k, v] of Object.entries(appearance)) {
      if (!validKeys.includes(k)) continue;
      if (typeof v !== 'string' || v.length > 20) continue;
      if (k === 'hair_style' && !validHairStyles.includes(v)) continue;
      if (k === 'eye_style' && !validEyeStyles.includes(v)) continue;
      if (k === 'mouth_style' && !validMouthStyles.includes(v)) continue;
      if (k === 'glasses' && !validGlasses.includes(v)) continue;
      if (k === 'headwear' && !validHeadwear.includes(v)) continue;
      if (k === 'neckwear' && !validNeckwear.includes(v)) continue;
      cleaned[k] = v;
    }
    p.appearance = Object.assign(p.appearance || {}, cleaned);
  }
  const contractPatch = sanitizeContractProfilePatch({
    archetype,
    skills,
    contract_mode: contractMode,
  });
  if (!contractPatch.valid) {
    return { error: contractPatch.errors.join('; ') };
  }
  if (Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'archetype')) {
    p.archetype = contractPatch.normalized.archetype || '';
  }
  if (Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'skills')) {
    p.skills = contractPatch.normalized.skills;
  }
  if (Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'contract_mode')) {
    p.contract_mode = contractPatch.normalized.contract_mode;
  }
  p.updated_at = new Date().toISOString();
  saveProfiles(profiles);
  return { success: true, profile: p };
}

// --- Phase 2: Workspace tools ---

function toolWorkspaceWrite(key, content) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof key !== 'string' || key.length < 1 || key.length > 50) return { error: 'key must be 1-50 chars' };
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(key)) return { error: 'key must be alphanumeric/underscore/hyphen/dot' };
  if (typeof content !== 'string') return { error: 'content must be a string' };
  if (Buffer.byteLength(content, 'utf8') > 102400) return { error: 'content exceeds 100KB limit' };

  ensureDataDir();
  const ws = getWorkspace(registeredName);
  if (!ws[key] && Object.keys(ws).length >= 50) return { error: 'Maximum 50 keys per workspace' };
  ws[key] = { content, updated_at: new Date().toISOString() };
  saveWorkspace(registeredName, ws, { key, keys: [key] });
  touchActivity();
  return { success: true, key, size: content.length, total_keys: Object.keys(ws).length };
}

function toolWorkspaceRead(key, agent) {
  if (!registeredName) return { error: 'You must call register() first' };
  const targetAgent = agent || registeredName;
  if (targetAgent !== registeredName && !/^[a-zA-Z0-9_-]{1,20}$/.test(targetAgent)) {
    return { error: 'Invalid agent name' };
  }

  const ws = getWorkspace(targetAgent);
  if (key) {
    if (!ws[key]) return { error: `Key "${key}" not found in ${targetAgent}'s workspace` };
    return { agent: targetAgent, key, content: ws[key].content, updated_at: ws[key].updated_at };
  }
  // Return all keys with content
  const entries = {};
  for (const [k, v] of Object.entries(ws)) {
    entries[k] = { content: v.content, updated_at: v.updated_at };
  }
  return { agent: targetAgent, entries, total_keys: Object.keys(ws).length };
}

function toolWorkspaceList(agent) {
  const agents = getAgents();
  if (agent) {
    if (!/^[a-zA-Z0-9_-]{1,20}$/.test(agent)) return { error: 'Invalid agent name' };
    const ws = getWorkspace(agent);
    return { agent, keys: Object.keys(ws).map(k => ({ key: k, size: ws[k].content.length, updated_at: ws[k].updated_at })) };
  }
  // List all agents' workspace summaries
  const result = {};
  for (const name of Object.keys(agents)) {
    const ws = getWorkspace(name);
    result[name] = { key_count: Object.keys(ws).length, keys: Object.keys(ws) };
  }
  return { workspaces: result };
}

// --- Phase 3: Workflow tools ---

function toolCreateWorkflow(name, steps, autonomous = false, parallel = false) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!name || typeof name !== 'string' || name.length > 50) return { error: 'name must be 1-50 chars' };
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 30) return { error: 'steps must be array of 2-30 items' };

  const agents = getAgents();
  const workflowId = 'wf_' + generateId();

  const parsedSteps = steps.map((s, i) => {
    const step = typeof s === 'string' ? { description: s } : s;
    if (!step.description) return null;
    return {
      id: i + 1,
      description: step.description.substring(0, 200),
      assignee: step.assignee || null,
      depends_on: Array.isArray(step.depends_on) ? step.depends_on : [],
      status: 'pending', // all start pending; we'll activate ready ones below
      started_at: null,
      completed_at: null,
      notes: '',
    };
  });
  if (parsedSteps.includes(null)) return { error: 'Each step must have a description' };

  // Validate depends_on references
  const stepIds = parsedSteps.map(s => s.id);
  for (const step of parsedSteps) {
    for (const depId of step.depends_on) {
      if (!stepIds.includes(depId)) return { error: `Step ${step.id} depends_on non-existent step ${depId}` };
      if (depId >= step.id) return { error: `Step ${step.id} cannot depend on step ${depId} (must depend on earlier steps)` };
    }
  }

  // Find initially ready steps (no dependencies)
  const readySteps = parsedSteps.filter(s => s.depends_on.length === 0);
  if (parallel) {
    // In parallel mode, start ALL steps with no dependencies
    for (const s of readySteps) {
      s.status = 'in_progress';
      s.started_at = new Date().toISOString();
    }
  } else {
    // Sequential: only start the first step
    readySteps[0].status = 'in_progress';
    readySteps[0].started_at = new Date().toISOString();
  }

  const workflow = {
    id: workflowId,
    name,
    steps: parsedSteps,
    status: 'active',
    autonomous: !!autonomous,
    parallel: !!parallel,
    created_by: registeredName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const createdWorkflow = canonicalState.createWorkflow({
    workflow,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: workflowId,
  });
  if (createdWorkflow.error) return createdWorkflow;

  // Auto-handoff to all in_progress steps' assignees
  const startedSteps = parsedSteps.filter(s => s.status === 'in_progress');
  for (const step of startedSteps) {
    if (step.assignee && agents[step.assignee] && step.assignee !== registeredName) {
      const handoffContent = `[Workflow "${name}"] Step ${step.id} assigned to you: ${step.description}` +
        (autonomous ? '\n\nThis is an AUTONOMOUS workflow. Call get_work() to enter the proactive work loop. Do NOT wait for approval.' : '');
      messageSeq++;
      const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: step.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
      appendBranchConversationMessage(msg);
    }
  }
  touchActivity();

  return {
    success: true,
    workflow_id: workflowId,
    name,
    step_count: parsedSteps.length,
    autonomous: !!autonomous,
    parallel: !!parallel,
    started_steps: startedSteps.map(s => ({ id: s.id, description: s.description, assignee: s.assignee })),
    message: autonomous ? 'Autonomous workflow created. All agents should call get_work() to enter the proactive work loop.' : undefined,
  };
}

function toolAdvanceWorkflow(workflowId, notes, evidence = null) {
  if (!registeredName) return { error: 'You must call register() first' };

  const existingWorkflow = getWorkflows().find((entry) => entry.id === workflowId);
  if (!existingWorkflow) return { error: `Workflow not found: ${workflowId}` };
  if (!workflowMatchesActiveBranch(existingWorkflow)) return { error: 'Workflow is not active on the current branch.' };

  const commandId = `cmd_${generateId()}`;
  const completion = canonicalState.advanceWorkflow({
    workflowId,
    notes: notes ? notes.substring(0, 500) : null,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    commandId,
    correlationId: workflowId,
    evidence,
    sourceTool: 'advance_workflow',
  });
  if (completion.error) return completion;

  emitWorkflowHandoffMessages({
    workflowId: completion.workflow_id,
    workflowName: completion.workflow_name,
    completedStepId: completion.completed_step,
    nextSteps: completion.next_steps,
    summary: evidence && evidence.summary ? evidence.summary : null,
    confidence: evidence && typeof evidence.confidence === 'number' ? evidence.confidence : null,
    evidenceRef: completion.evidence_ref || null,
    commandId,
    correlationId: workflowId,
  });

  touchActivity();

  return {
    success: true,
    workflow_id: completion.workflow_id,
    completed_step: completion.completed_step,
    next_steps: completion.next_steps.length > 0 ? completion.next_steps : null,
    progress: completion.progress,
    workflow_status: completion.workflow_status,
    evidence_ref: completion.evidence_ref || null,
  };
}

function toolWorkflowStatus(workflowId) {
  const workflows = getWorkflows();
  if (workflowId) {
    const wf = workflows.find(w => w.id === workflowId);
    if (!wf) return { error: `Workflow not found: ${workflowId}` };
    const doneCount = wf.steps.filter(s => s.status === 'done').length;
    const pct = Math.round((doneCount / wf.steps.length) * 100);
    const result = { workflow: wf, progress: `${doneCount}/${wf.steps.length} (${pct}%)` };
    if (wf.status === 'completed') result.report = generateCompletionReport(wf);
    return result;
  }
  return {
    count: workflows.length,
    workflows: workflows.map(w => {
      const doneCount = w.steps.filter(s => s.status === 'done').length;
      return { id: w.id, name: w.name, status: w.status, steps: w.steps.length, done: doneCount, progress: Math.round((doneCount / w.steps.length) * 100) + '%' };
    }),
  };
}

// --- Context refresh (provides summary when conversation is long) ---

function maybeRefreshContext(agentName) {
  const consumed = getConsumedIds(agentName);
  const consumedCount = consumed.size;

  // Every 50 messages consumed, provide a context refresh
  if (consumedCount > 50 && consumedCount % 50 < 5) { // window of 5 to avoid missing the boundary
    const workflows = getWorkflows();
    const activeWorkflows = workflows.filter(w => w.status === 'active');
    const mySteps = [];
    for (const wf of activeWorkflows) {
      for (const s of wf.steps) {
        if (s.assignee === agentName) mySteps.push({ workflow: wf.name, step: s.description, status: s.status });
      }
    }

    const tasks = getTasks();
    const myTasks = tasks.filter(t => t.assignee === agentName && t.status !== 'done');
    const decisions = getDecisions();
    const recentDecisions = decisions.slice(-5);

    return {
      context_refresh: true,
      messages_consumed: consumedCount,
      summary: {
        active_workflows: activeWorkflows.map(w => ({ name: w.name, status: w.status, autonomous: w.autonomous, progress: `${w.steps.filter(s => s.status === 'done').length}/${w.steps.length}` })),
        your_assignments: mySteps,
        your_tasks: myTasks.map(t => ({ title: t.title, status: t.status })),
        recent_decisions: recentDecisions.map(d => d.decision),
      },
      instruction: 'CONTEXT REFRESH: Your conversation is long. Here is a summary of the current state. Use this as your ground truth.',
    };
  }
  return null;
}

// --- Skill search for get_work (section 2.2) ---

function searchKBForTask(taskDescription) {
  const kb = getKB();
  if (!kb || Object.keys(kb).length === 0) return [];
  const keywords = taskDescription.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const results = [];
  for (const [key, entry] of Object.entries(kb)) {
    if (!key.startsWith('skill_') && !key.startsWith('lesson_')) continue;
    const content = (typeof entry === 'string' ? entry : entry.content || '').toLowerCase();
    const matchCount = keywords.filter(kw => content.includes(kw)).length;
    if (matchCount > 0) results.push({ key, content: typeof entry === 'string' ? entry : entry.content, relevance: matchCount });
  }
  return results.sort((a, b) => b.relevance - a.relevance).slice(0, 3);
}

// Backpressure signal: warn when tasks are created faster than consumed
function computeBackpressure() {
  const tasks = getTasks();
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in_progress');
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  const queueDepth = pendingTasks.length;
  const activeWork = inProgressTasks.length;
  const capacity = Math.max(1, aliveCount);
  const pressure = queueDepth / capacity;
  if (pressure <= 2) return null; // normal load
  return {
    backpressure: true, queue_depth: queueDepth, active_work: activeWork,
    agent_count: aliveCount, pressure_ratio: Math.round(pressure * 10) / 10,
    warning: `High task load: ${queueDepth} pending tasks for ${aliveCount} agent(s) (${Math.round(pressure)}x capacity). Focus on completing current work.`
  };
}

function attachContractAdvisory(result, contract, target = {}, advisoryOverride = null) {
  const advisory = advisoryOverride || analyzeContractFit(contract, target);
  if (!advisory) return result;

  const metadata = buildRuntimeContractMetadata(contract);
  result.contract_advisory = Object.assign({
    archetype: metadata.contract ? metadata.contract.archetype : null,
    declared_archetype: metadata.archetype || null,
    role: contract.role || '',
    role_token: contract.role_token || null,
    skills: metadata.skills,
    effective_skills: metadata.contract ? metadata.contract.effective_skills : [],
    contract_mode: metadata.contract_mode,
  }, advisory);

  const instructionField = typeof result.instruction === 'string'
    ? 'instruction'
    : (typeof result.instructions === 'string' ? 'instructions' : null);

  if (instructionField && (advisory.status === 'mismatch' || advisory.status === 'partial')) {
    result[instructionField] += `\n\nCONTRACT ADVISORY: ${advisory.summary}`;
    if (advisory.migration_note) {
      result[instructionField] += ` ${advisory.migration_note}`;
    }
  }

  return result;
}

function attachCapabilityAdvisory(result, capabilityAdvisory) {
  if (!capabilityAdvisory) return result;

  const hasExplicitCapabilitySignal = (Array.isArray(capabilityAdvisory.required_capabilities) && capabilityAdvisory.required_capabilities.length > 0)
    || (Array.isArray(capabilityAdvisory.preferred_capabilities) && capabilityAdvisory.preferred_capabilities.length > 0)
    || capabilityAdvisory.status === 'mismatch'
    || capabilityAdvisory.status === 'partial'
    || capabilityAdvisory.status === 'blocked';
  if (!hasExplicitCapabilitySignal) return result;

  result.capability_advisory = capabilityAdvisory;

  const instructionField = typeof result.instruction === 'string'
    ? 'instruction'
    : (typeof result.instructions === 'string' ? 'instructions' : null);
  if (instructionField && (capabilityAdvisory.status === 'mismatch' || capabilityAdvisory.status === 'partial')) {
    result[instructionField] += `\n\nCAPABILITY ADVISORY: ${capabilityAdvisory.summary}`;
  }

  return result;
}

function buildAutonomyDecisionContext(contract, skills = [], agents = null) {
  const allAgents = agents || getAgents();
  return resolveAgentDecisionContext({
    agentName: registeredName,
    branchId: currentBranch,
    sessionSummary: getAuthoritativeSessionSummary(registeredName, currentBranch, currentSessionId),
    contract,
    agentRecord: allAgents[registeredName] || {},
    availableSkills: Array.isArray(skills) ? skills : [],
  });
}

function buildAutonomyPolicyContext(agentName = registeredName, branchName = currentBranch, sessionId = null, agents = null, profiles = null) {
  const allAgents = agents || getAgents();
  const allProfiles = profiles || getProfiles();
  return resolveAgentDecisionContext({
    agentName,
    branchId: branchName,
    sessionSummary: getAuthoritativeSessionSummary(agentName, branchName, sessionId),
    contract: resolveAgentContract(allProfiles[agentName] || {}),
    agentRecord: allAgents[agentName] || {},
  });
}

function buildTaskPolicyTarget(task = {}) {
  return {
    work_type: 'task',
    title: task.title || '',
    description: task.description || '',
    assigned: !!task.assignee,
    required_capabilities: task.required_capabilities || null,
    preferred_capabilities: task.preferred_capabilities || null,
  };
}

function buildWorkflowStepPolicyTarget(step = {}, workflow = {}) {
  return {
    work_type: 'workflow_step',
    title: step.description || '',
    description: workflow.name || '',
    assigned: !!step.assignee,
    required_capabilities: step.required_capabilities || null,
    preferred_capabilities: step.preferred_capabilities || null,
  };
}

function buildPersistedPolicySignal(source, policy, extras = {}) {
  if (!policy || typeof policy !== 'object') return null;
  return {
    source,
    classification: policy.classification || null,
    state: policy.state || null,
    owner_state: policy.owner_state || null,
    summary: policy.summary || null,
    reasons: Array.isArray(policy.reasons) ? [...policy.reasons] : [],
    session_id: policy.session_summary && policy.session_summary.session_id ? policy.session_summary.session_id : null,
    session_state: policy.session_summary && policy.session_summary.state ? policy.session_summary.state : null,
    session_stale: !!(policy.session_summary && policy.session_summary.stale),
    contract_status: policy.contract_advisory && policy.contract_advisory.status ? policy.contract_advisory.status : null,
    capability_status: policy.capability_advisory && policy.capability_advisory.status ? policy.capability_advisory.status : null,
    attempt_count: Number.isFinite(policy.attempt_count) ? policy.attempt_count : null,
    max_attempts: Number.isFinite(policy.max_attempts) ? policy.max_attempts : null,
    blocked_minutes: Number.isFinite(policy.blocked_minutes) ? policy.blocked_minutes : null,
    step_minutes: Number.isFinite(policy.step_minutes) ? policy.step_minutes : null,
    dependency_evidence_count: Number.isFinite(policy.dependency_evidence_count) ? policy.dependency_evidence_count : null,
    recent_evidence_count: Number.isFinite(policy.recent_evidence_count) ? policy.recent_evidence_count : null,
    signaled_at: extras.at || new Date().toISOString(),
    ...extras,
  };
}

function resolveRetryPolicySubject(taskOrStep) {
  const activeStep = registeredName ? findMyActiveWorkflowStep() : null;
  if (activeStep && (activeStep.id === taskOrStep || activeStep.description === taskOrStep)) {
    return {
      kind: 'workflow_step',
      target: buildWorkflowStepPolicyTarget(activeStep, { name: activeStep.workflow_name || '' }),
    };
  }

  const activeTask = registeredName
    ? getTasks().find((task) => task.assignee === registeredName && task.status !== 'done' && (task.id === taskOrStep || task.title === taskOrStep))
    : null;
  if (activeTask) {
    return {
      kind: 'task',
      target: buildTaskPolicyTarget(activeTask),
    };
  }

  return {
    kind: 'freeform',
    target: {
      work_type: 'task',
      title: taskOrStep || 'retry context',
      description: taskOrStep || 'retry context',
      assigned: true,
    },
  };
}

function summarizeWatchdogActionForHealth(action) {
  if (!action || typeof action !== 'object') return null;
  if (action.kind === 'nudge_idle' || action.kind === 'nudge_idle_hard') {
    return {
      type: action.kind,
      agent: action.agentName,
      idle_minutes: Math.round((action.idleMs || 0) / 60000),
      classification: action.policy && action.policy.classification ? action.policy.classification : null,
      summary: action.policy && action.policy.summary ? action.policy.summary : null,
    };
  }
  if (action.kind === 'release_task_claim') {
    return {
      type: action.kind,
      task_id: action.taskId,
      title: action.taskTitle,
      assignee: action.assignee,
      classification: action.policy && action.policy.classification ? action.policy.classification : null,
      summary: action.policy && action.policy.summary ? action.policy.summary : null,
    };
  }
  if (action.kind === 'escalate_blocked_task') {
    return {
      type: action.kind,
      task_id: action.taskId,
      title: action.taskTitle,
      assignee: action.assignee,
      blocked_minutes: Math.round((action.blockedAgeMs || 0) / 60000),
      classification: action.policy && action.policy.classification ? action.policy.classification : null,
      summary: action.policy && action.policy.summary ? action.policy.summary : null,
    };
  }
  if (action.kind === 'signal_stalled_step') {
    return {
      type: `${action.kind}:${action.signal}`,
      workflow_id: action.workflowId,
      workflow_name: action.workflowName,
      step_id: action.stepId,
      assignee: action.assignee,
      step_minutes: Math.round((action.stepAgeMs || 0) / 60000),
      classification: action.policy && action.policy.classification ? action.policy.classification : null,
      summary: action.policy && action.policy.summary ? action.policy.summary : null,
    };
  }
  return null;
}

function attachManagedTeamSurfaceSignals(result, options = {}) {
  const surface = options.surface || 'team_listen';
  const branchName = options.branchName || currentBranch;
  const profiles = options.profiles || getProfiles();
  const agentName = options.agentName || registeredName;
  const contract = options.contract || resolveAgentContract(profiles[agentName] || {});
  const contractContext = buildManagedTeamContractContext(contract, surface, options);

  if (contractContext && contractContext.advisory) {
    attachContractAdvisory(result, contract, contractContext.target, contractContext.advisory);
    if (result.contract_advisory) {
      result.contract_advisory.surface = surface;
    }
  }

  if (options.includeContractViolation && contractContext && contractContext.contract_violation) {
    result.contract_violation = contractContext.contract_violation;
  }

  if (options.includeHooks !== false) {
    const coordinationHooks = readManagedTeamHookDigest(
      canonicalState.readBranchHooks,
      branchName,
      {
        limit: options.hookLimit,
        topics: options.hookTopics,
      }
    );
    if (coordinationHooks) {
      result.coordination_hooks = coordinationHooks;
    }
  }

  return result;
}

// --- Autonomy Engine tools ---

async function toolGetWork(params = {}) {
  if (!registeredName) return { error: 'You must call register() first' };

  // Special roles run their own loops instead of regular work
  const profiles = getProfiles();
  const contract = resolveAgentContract(profiles[registeredName] || {});
  if (contract.role_token === 'monitor') {
    return attachContractAdvisory(monitorHealthCheck(), contract, {
      work_type: 'monitor_report',
      title: 'Monitor loop',
    });
  }
  if (contract.role_token === 'advisor') {
    return attachContractAdvisory(advisorAnalysis(), contract, {
      work_type: 'advisor_context',
      title: 'Advisor loop',
    });
  }

  // Context refresh check
  const refresh = maybeRefreshContext(registeredName);

  // Backpressure check
  const backpressure = computeBackpressure();

  const skills = Array.isArray(params.available_skills) ? params.available_skills : [];
  const agents = getAgents();
  const decisionContext = buildAutonomyDecisionContext(contract, skills, agents);

  const myStep = findMyActiveWorkflowStep();
  const activeContext = myStep
    ? buildAuthoritativeResumeContext({
        agentName: registeredName,
        branchName: currentBranch,
        sessionId: currentSessionId,
        activeStep: myStep,
        upcomingStep: null,
        evidenceLimit: 5,
      })
    : null;

  const pending = getUnconsumedMessages(registeredName);
  const pendingMessageBatch = pending.slice(0, 10);
  const pendingMessageContext = pending.length > 0
    ? collectMessageHandoffContext(pendingMessageBatch, currentBranch)
    : [];
  const pendingMessageSessionSummary = pending.length > 0
    ? getAuthoritativeSessionSummary(registeredName, currentBranch, currentSessionId)
    : decisionContext.session_summary;

  const tasks = getTasks();
  const rankedUnassignedTasks = rankClaimableTasks(
    tasks.filter((task) => {
      if (task.status !== 'pending' || task.assignee) return false;
      if (task.status === 'blocked_permanent') return false;
      if (task.attempt_agents && task.attempt_agents.includes(registeredName)) return false;
      return true;
    }),
    decisionContext,
    {
      allTasks: tasks,
      availableSkills: skills,
      orderOffset: 30,
    }
  ).slice(0, 5);

  const helpReqs = findHelpRequests().slice(0, 3);
  const reviews = findPendingReviews().slice(0, 3);
  const blocked = findBlockedTasks().slice(0, 3);
  const stealable = findStealableWork();

  let prelistenCandidates = [];

  if (myStep) {
    const activeResumeContext = {};
    if (activeContext && activeContext.dependency_evidence.length > 0) activeResumeContext.dependency_evidence = activeContext.dependency_evidence;
    if (activeContext && activeContext.recent_evidence.length > 0) activeResumeContext.recent_evidence = activeContext.recent_evidence;
    prelistenCandidates.push({
      id: `workflow_step_${myStep.workflow_id}_${myStep.id}`,
      order: 10,
      kind: 'workflow_step',
      step: myStep,
      resumeContext: activeContext,
      target: {
        work_type: 'workflow_step',
        title: myStep.description,
        description: myStep.workflow_name,
        assigned: true,
        assignment_priority: 'active',
        required_capabilities: myStep.required_capabilities || null,
        preferred_capabilities: myStep.preferred_capabilities || null,
        session_summary: activeContext ? activeContext.session_summary : null,
        resume_context: Object.keys(activeResumeContext).length > 0 ? activeResumeContext : null,
      },
    });
  }

  if (pending.length > 0) {
    prelistenCandidates.push({
      id: `pending_messages_${pending.length}`,
      order: 20,
      kind: 'messages',
      messages: pendingMessageBatch,
      total: pending.length,
      sessionSummary: pendingMessageSessionSummary,
      messageContext: pendingMessageContext,
      target: {
        work_type: 'messages',
        title: pendingMessageBatch[0] ? `${pendingMessageBatch[0].from || 'message'} handoff` : 'Pending messages',
        description: `${pending.length} pending messages`,
        session_summary: pendingMessageSessionSummary,
        resume_context: pendingMessageContext.length > 0 ? { message_handoffs: pendingMessageContext } : null,
      },
    });
  }

  rankedUnassignedTasks.forEach((entry, index) => {
    prelistenCandidates.push({
      id: `claim_task_${entry.task.id || index}`,
      order: 30 + index,
      kind: 'claim_task',
      taskEntry: entry,
      target: entry.target,
    });
  });

  helpReqs.forEach((request, index) => {
    prelistenCandidates.push({
      id: `help_${request.id || index}`,
      order: 50 + index,
      kind: 'help_teammate',
      request,
      target: {
        work_type: 'help_teammate',
        title: request.from || 'Teammate help request',
        description: request.content,
      },
    });
  });

  reviews.forEach((review, index) => {
    prelistenCandidates.push({
      id: `review_${review.id || index}`,
      order: 60 + index,
      kind: 'review',
      review,
      target: {
        work_type: 'review',
        title: review.file,
        description: review.description || '',
      },
    });
  });

  blocked.forEach((task, index) => {
    prelistenCandidates.push({
      id: `blocked_${task.id || index}`,
      order: 70 + index,
      kind: 'unblock',
      task,
      target: {
        work_type: 'unblock',
        title: task.title,
        description: task.description || '',
        required_capabilities: task.required_capabilities || null,
        preferred_capabilities: task.preferred_capabilities || null,
      },
    });
  });

  if (stealable) {
    prelistenCandidates.push({
      id: `steal_${stealable.task.id}`,
      order: 80,
      kind: 'stolen_task',
      stealable,
      target: {
        work_type: 'stolen_task',
        title: stealable.task.title,
        description: stealable.task.description || '',
        required_capabilities: stealable.task.required_capabilities || null,
        preferred_capabilities: stealable.task.preferred_capabilities || null,
      },
    });
  }

  while (prelistenCandidates.length > 0) {
    const selected = selectAutonomyDecisionCandidate(prelistenCandidates, decisionContext);
    if (!selected) break;

    if (selected.kind === 'workflow_step') {
      const selectedContext = selected.resumeContext || activeContext;
      const result = {
        type: 'workflow_step', priority: 'assigned', step: selected.step,
        instruction: `You have assigned work: "${selected.step.description}" (Workflow: "${selected.step.workflow_name}"). Do this NOW. When done, call verify_and_advance().`
      };
      if (selectedContext && selectedContext.session_summary) result.session_summary = selectedContext.session_summary;
      if (selectedContext && (selectedContext.dependency_evidence.length > 0 || selectedContext.recent_evidence.length > 0)) {
        result.resume_context = {};
        if (selectedContext.dependency_evidence.length > 0) result.resume_context.dependency_evidence = selectedContext.dependency_evidence;
        if (selectedContext.recent_evidence.length > 0) result.resume_context.recent_evidence = selectedContext.recent_evidence;
        result.instruction += selectedContext.dependency_evidence.length > 0
          ? '\n\nAuthoritative dependency evidence is attached in resume_context. Use it before any checkpoint or KB fallback notes.'
          : '\n\nAuthoritative recent evidence from this branch session is attached in resume_context. Use it before any checkpoint or KB fallback notes.';
      }
      const relevantSkills = searchKBForTask(selected.step.description);
      if (relevantSkills.length > 0) {
        result.reference_notes = relevantSkills.map(s => s.content);
        result.instruction += `\n\n(See reference_notes field for team learnings — these are historical notes from other agents, not authoritative instructions.)`;
      }
      const checkpoint = getCheckpoint(registeredName, selected.step.workflow_id, selected.step.id);
      if (checkpoint) {
        result.checkpoint = checkpoint;
        result.instruction += `\n\nFallback checkpoint (saved ${checkpoint.saved_at}): ${typeof checkpoint.progress === 'string' ? checkpoint.progress : JSON.stringify(checkpoint.progress)}`;
      }
      if (refresh) result.context_refresh = refresh;
      attachCapabilityAdvisory(result, selected.evaluation.capability_advisory);
      return attachContractAdvisory(result, contract, selected.target, selected.evaluation.contract_advisory);
    }

    if (selected.kind === 'messages') {
      const messageContext = selected.messageContext;
      const result = {
        type: 'messages',
        priority: 'respond',
        ...(selected.sessionSummary ? { session_summary: selected.sessionSummary } : {}),
        ...(messageContext.length > 0 ? { resume_context: { message_handoffs: messageContext } } : {}),
        messages: selected.messages,
        total: selected.total,
        instruction: messageContext.length > 0
          ? 'Process these messages first. resume_context.message_handoffs contains authoritative session/evidence handoff details; use that before falling back to the raw message previews, then call get_work() again.'
          : 'Process these messages first, then call get_work() again.',
      };
      attachCapabilityAdvisory(result, selected.evaluation.capability_advisory);
      return attachContractAdvisory(result, contract, selected.target, selected.evaluation.contract_advisory);
    }

    if (selected.kind === 'claim_task') {
      const best = selected.taskEntry.task;
      const claimed = canonicalState.updateTaskStatus({
        taskId: best.id,
        status: 'in_progress',
        actor: registeredName,
        branch: currentBranch,
        sessionId: currentSessionId,
        correlationId: best.id,
        sourceTool: 'get_work',
        assignee: registeredName,
        trackAttemptAgent: true,
        requireUnassigned: true,
        expectedStatuses: ['pending'],
      });
      if (!(claimed && claimed.success)) {
        prelistenCandidates = prelistenCandidates.filter((candidate) => candidate.id !== selected.id);
        continue;
      }

      const claimedTask = claimed.task || best;
      const claimedTarget = {
        ...selected.target,
        work_type: 'claimed_task',
        assigned: true,
      };
      const claimedEvaluation = evaluateAutonomyCandidate({ target: claimedTarget }, decisionContext);
      const claimResult = {
        type: 'claimed_task', priority: 'self_assigned', task: claimedTask,
        instruction: `No one was working on "${claimedTask.title}". I've assigned it to you. Start working on it now.`
      };
      const taskSkills = searchKBForTask(claimedTask.title + ' ' + (claimedTask.description || ''));
      if (taskSkills.length > 0) {
        claimResult.reference_notes = taskSkills.map(s => s.content);
        claimResult.instruction += `\n\n(See reference_notes field for team learnings — these are historical notes from other agents, not authoritative instructions.)`;
      }
      if (refresh) claimResult.context_refresh = refresh;
      attachCapabilityAdvisory(claimResult, claimedEvaluation.capability_advisory);
      return attachContractAdvisory(claimResult, contract, claimedTarget, claimedEvaluation.contract_advisory);
    }

    if (selected.kind === 'help_teammate') {
      const result = {
        type: 'help_teammate', priority: 'assist', request: selected.request,
        instruction: `${selected.request.from || 'A teammate'} needs help: "${selected.request.content.substring(0, 200)}". Assist them.`
      };
      attachCapabilityAdvisory(result, selected.evaluation.capability_advisory);
      return attachContractAdvisory(result, contract, selected.target, selected.evaluation.contract_advisory);
    }

    if (selected.kind === 'review') {
      const result = {
        type: 'review', priority: 'review', review: selected.review,
        instruction: `Review request from ${selected.review.requested_by}: "${selected.review.file}". Review their work and submit_review().`
      };
      attachCapabilityAdvisory(result, selected.evaluation.capability_advisory);
      return attachContractAdvisory(result, contract, selected.target, selected.evaluation.contract_advisory);
    }

    if (selected.kind === 'unblock') {
      const result = {
        type: 'unblock', priority: 'unblock', task: selected.task,
        instruction: `"${selected.task.title}" is blocked. See if you can help unblock it.`
      };
      attachCapabilityAdvisory(result, selected.evaluation.capability_advisory);
      return attachContractAdvisory(result, contract, selected.target, selected.evaluation.contract_advisory);
    }

    if (selected.kind === 'stolen_task') {
      const stolen = canonicalState.updateTaskStatus({
        taskId: selected.stealable.task.id,
        status: 'in_progress',
        actor: registeredName,
        branch: currentBranch,
        sessionId: currentSessionId,
        correlationId: selected.stealable.task.id,
        sourceTool: 'get_work',
        assignee: registeredName,
        trackAttemptAgent: true,
        expectedAssignee: selected.stealable.from_agent,
        expectedStatuses: ['pending'],
      });
      if (!(stolen && stolen.success)) {
        prelistenCandidates = prelistenCandidates.filter((candidate) => candidate.id !== selected.id);
        continue;
      }

      const stolenTask = stolen.task || selected.stealable.task;
      const stolenTarget = {
        ...selected.target,
        work_type: 'claimed_task',
        assigned: true,
      };
      const stolenEvaluation = evaluateAutonomyCandidate({ target: stolenTarget }, decisionContext);
      const result = {
        type: 'stolen_task', priority: 'work_steal', task: stolenTask,
        from_agent: selected.stealable.from_agent,
        instruction: selected.stealable.message + ' Start working on it now.',
      };
      attachCapabilityAdvisory(result, stolenEvaluation.capability_advisory);
      return attachContractAdvisory(result, contract, stolenTarget, stolenEvaluation.contract_advisory);
    }

    prelistenCandidates = prelistenCandidates.filter((candidate) => candidate.id !== selected.id);
  }

  const listenTimeout = parseInt(process.env.AGENT_BRIDGE_LISTEN_TIMEOUT) || 30000;
  const newMsgs = await listenWithTimeout(listenTimeout);
  const upcoming = findUpcomingStepsForMe();
  const upcomingContext = upcoming
    ? buildAuthoritativeResumeContext({
        agentName: registeredName,
        branchName: currentBranch,
        sessionId: currentSessionId,
        activeStep: null,
        upcomingStep: upcoming,
        evidenceLimit: 5,
      })
    : null;
  const checkpointFallbacks = upcoming
    ? listCheckpointFallbacks(registeredName, { workflowId: upcoming.workflow_id }).slice(0, 3)
    : [];
  const newMessageBatch = newMsgs.slice(0, 10);
  const newMessageContext = newMsgs.length > 0
    ? collectMessageHandoffContext(newMessageBatch, currentBranch)
    : [];
  const postlistenMessageSessionSummary = newMsgs.length > 0
    ? getAuthoritativeSessionSummary(registeredName, currentBranch, currentSessionId)
    : decisionContext.session_summary;

  const postlistenCandidates = [];

  if (newMsgs.length > 0) {
    postlistenCandidates.push({
      id: `new_messages_${newMsgs.length}`,
      order: 10,
      kind: 'messages_after_listen',
      messages: newMessageBatch,
      total: newMsgs.length,
      sessionSummary: postlistenMessageSessionSummary,
      messageContext: newMessageContext,
      target: {
        work_type: 'messages',
        title: newMessageBatch[0] ? `${newMessageBatch[0].from || 'message'} handoff` : 'New messages',
        description: `${newMsgs.length} newly arrived messages`,
        session_summary: postlistenMessageSessionSummary,
        resume_context: newMessageContext.length > 0 ? { message_handoffs: newMessageContext } : null,
      },
    });
  }

  if (upcoming) {
    const upcomingResumeContext = {};
    if (upcomingContext && upcomingContext.dependency_evidence.length > 0) upcomingResumeContext.dependency_evidence = upcomingContext.dependency_evidence;
    if (upcomingContext && upcomingContext.recent_evidence.length > 0) upcomingResumeContext.recent_evidence = upcomingContext.recent_evidence;
    postlistenCandidates.push({
      id: `prep_work_${upcoming.workflow_id}_${upcoming.id}`,
      order: 20,
      kind: 'prep_work',
      step: upcoming,
      resumeContext: upcomingContext,
      checkpointFallbacks,
      target: {
        work_type: 'prep_work',
        title: upcoming.description,
        description: upcoming.workflow_name,
        assigned: true,
        assignment_priority: 'assigned',
        required_capabilities: upcoming.required_capabilities || null,
        preferred_capabilities: upcoming.preferred_capabilities || null,
        session_summary: upcomingContext ? upcomingContext.session_summary : null,
        resume_context: Object.keys(upcomingResumeContext).length > 0 ? upcomingResumeContext : null,
      },
    });
  }

  postlistenCandidates.push({
    id: 'idle',
    order: 30,
    kind: 'idle',
    target: {
      work_type: 'idle',
      title: 'No current assignment',
    },
  });

  const selectedPostlistenCandidate = selectAutonomyDecisionCandidate(postlistenCandidates, decisionContext);

  if (selectedPostlistenCandidate && selectedPostlistenCandidate.kind === 'messages_after_listen') {
    const messageContext = selectedPostlistenCandidate.messageContext;
    const result = {
      type: 'messages', priority: 'respond',
      ...(selectedPostlistenCandidate.sessionSummary ? { session_summary: selectedPostlistenCandidate.sessionSummary } : {}),
      ...(messageContext.length > 0 ? { resume_context: { message_handoffs: messageContext } } : {}),
      messages: selectedPostlistenCandidate.messages, total: selectedPostlistenCandidate.total,
      instruction: messageContext.length > 0
        ? 'New messages arrived. resume_context.message_handoffs contains authoritative session/evidence handoff details; use that before falling back to the raw message previews, then call get_work() again.'
        : 'New messages arrived. Process them, then call get_work() again.'
    };
    attachCapabilityAdvisory(result, selectedPostlistenCandidate.evaluation.capability_advisory);
    return attachContractAdvisory(result, contract, selectedPostlistenCandidate.target, selectedPostlistenCandidate.evaluation.contract_advisory);
  }

  if (selectedPostlistenCandidate && selectedPostlistenCandidate.kind === 'prep_work') {
    const result = {
      type: 'prep_work', priority: 'proactive', step: selectedPostlistenCandidate.step,
      instruction: `Your next workflow step "${selectedPostlistenCandidate.step.description}" is coming up (Workflow: "${selectedPostlistenCandidate.step.workflow_name}"). Prepare for it: read relevant files, understand the dependencies, plan your approach.`
    };
    if (selectedPostlistenCandidate.resumeContext && selectedPostlistenCandidate.resumeContext.session_summary) {
      result.session_summary = selectedPostlistenCandidate.resumeContext.session_summary;
    }
    if (selectedPostlistenCandidate.resumeContext && (selectedPostlistenCandidate.resumeContext.dependency_evidence.length > 0 || selectedPostlistenCandidate.resumeContext.recent_evidence.length > 0)) {
      result.resume_context = {};
      if (selectedPostlistenCandidate.resumeContext.dependency_evidence.length > 0) {
        result.resume_context.dependency_evidence = selectedPostlistenCandidate.resumeContext.dependency_evidence;
      }
      if (selectedPostlistenCandidate.resumeContext.recent_evidence.length > 0) {
        result.resume_context.recent_evidence = selectedPostlistenCandidate.resumeContext.recent_evidence;
      }
      result.instruction += selectedPostlistenCandidate.resumeContext.dependency_evidence.length > 0
        ? '\n\nAuthoritative dependency evidence is attached in resume_context so you can prep from completed upstream work before using fallback checkpoints.'
        : '\n\nAuthoritative recent evidence from this branch session is attached in resume_context so you can prep from the latest verified work first.';
    }
    if (selectedPostlistenCandidate.checkpointFallbacks.length > 0) {
      result.checkpoint_fallbacks = selectedPostlistenCandidate.checkpointFallbacks;
      result.instruction += '\n\ncheckpoint_fallbacks contains older workspace WIP notes for this workflow if you need compatibility context.';
    }
    attachCapabilityAdvisory(result, selectedPostlistenCandidate.evaluation.capability_advisory);
    return attachContractAdvisory(result, contract, selectedPostlistenCandidate.target, selectedPostlistenCandidate.evaluation.contract_advisory);
  }

  rebalanceRoles();
  touchActivity();
  const idleResult = {
    type: 'idle',
    instruction: isManagedMode()
      ? 'No work available right now. Call listen() to wait for the manager to assign work or give you the floor.'
      : 'No work available right now. Call get_work() again in 30 seconds. Do NOT call listen_group() — use get_work() to stay in the proactive loop.'
  };
  const agentRep = getReputation();
  if (agentRep[registeredName] && agentRep[registeredName].demoted) {
    idleResult.agent_warning = `You have ${agentRep[registeredName].consecutive_rejections} consecutive rejections. Focus on smaller, well-tested changes. Your next approval will reset this.`;
  }
  if (refresh) idleResult.context_refresh = refresh;
  if (backpressure) idleResult.backpressure = backpressure;
  attachCapabilityAdvisory(idleResult, selectedPostlistenCandidate ? selectedPostlistenCandidate.evaluation.capability_advisory : null);
  return attachContractAdvisory(idleResult, contract, {
    work_type: 'idle',
    title: 'No current assignment',
  }, selectedPostlistenCandidate ? selectedPostlistenCandidate.evaluation.contract_advisory : null);
}

async function toolVerifyAndAdvance(params) {
  if (!registeredName) return { error: 'You must call register() first' };

  const { workflow_id, summary, verification, files_changed, confidence, learnings } = params;

  if (!workflow_id) return { error: 'workflow_id is required' };
  if (!summary) return { error: 'summary is required' };
  if (!verification) return { error: 'verification is required' };
  if (typeof confidence !== 'number' || confidence < 0 || confidence > 100) return { error: 'confidence must be 0-100' };

  const workflows = getWorkflows();
  const wf = workflows.find(w => w.id === workflow_id);
  if (!wf) return { error: `Workflow not found: ${workflow_id}` };
  if (!workflowMatchesActiveBranch(wf)) return { error: 'Workflow is not active on the current branch.' };
  if (wf.status !== 'active') return { error: 'Workflow is not active' };

  const currentStep = wf.steps.find(s => s.assignee === registeredName && s.status === 'in_progress');
  if (!currentStep) return { error: 'No active step assigned to you in this workflow.' };

  // Save learnings to KB
  if (learnings) {
    const key = `skill_${registeredName}_${Date.now().toString(36)}`;
    canonicalState.writeKnowledgeBaseEntry({
      key,
      value: { content: learnings, updated_by: registeredName, updated_at: new Date().toISOString() },
      actor: registeredName,
      branch: currentBranch,
      sessionId: currentSessionId,
      correlationId: workflow_id,
      maxEntries: 100,
    });
  }

  const evidence = {
    summary,
    verification,
    files_changed: Array.isArray(files_changed) ? files_changed : [],
    confidence,
    learnings: learnings || null,
  };

  async function advanceWithEvidence(flagged) {
    const commandId = `cmd_${generateId()}`;
    const completion = canonicalState.advanceWorkflow({
      workflowId: workflow_id,
      actor: registeredName,
      branch: currentBranch,
      sessionId: currentSessionId,
      commandId,
      correlationId: workflow_id,
      evidence,
      expectedAssignee: registeredName,
      flagged,
      flagReason: flagged ? `Low confidence (${confidence}%). May need review later.` : null,
      sourceTool: 'verify_and_advance',
    });
    if (completion.error) return completion;

    clearCheckpoint(registeredName, workflow_id, currentStep.id);

    emitWorkflowHandoffMessages({
      workflowId: completion.workflow_id,
      workflowName: completion.workflow_name,
      completedStepId: completion.completed_step,
      nextSteps: completion.next_steps,
      summary,
      flagged,
      confidence,
      evidenceRef: completion.evidence_ref || null,
      commandId,
      correlationId: workflow_id,
    });

    const updatedWorkflow = getWorkflows().find((entry) => entry.id === workflow_id) || wf;

    if (completion.workflow_status === 'completed') {
      broadcastSystemMessage(`[WORKFLOW COMPLETE] "${updatedWorkflow.name}" finished${flagged ? ' (with flagged steps)' : ''}! All ${updatedWorkflow.steps.length} steps done.`);
      const report = generateCompletionReport(updatedWorkflow);
      const retrospective = logRetrospective(updatedWorkflow.id);
      touchActivity();
      return {
        status: flagged ? 'workflow_complete_flagged' : 'workflow_complete',
        workflow_id: updatedWorkflow.id,
        evidence_ref: completion.evidence_ref || null,
        report,
        retrospective,
        message: `Workflow "${updatedWorkflow.name}" finished! Call get_work() for your next assignment.`,
      };
    }

    touchActivity();
    return {
      status: flagged ? 'advanced_with_flag' : 'advanced',
      workflow_id: completion.workflow_id,
      completed_step: completion.completed_step,
      next_steps: completion.next_steps,
      evidence_ref: completion.evidence_ref || null,
      message: flagged ? 'Advanced but flagged for later review. Call get_work().' : 'Step complete. Next step(s) kicked off. Call get_work() for your next assignment.',
    };
  }

  if (confidence >= 70) {
    return advanceWithEvidence(false);
  }

  if (confidence >= 40) {
    return advanceWithEvidence(true);
  }

  // LOW CONFIDENCE — ask for help
  broadcastSystemMessage(`[HELP NEEDED] ${registeredName} completed step "${currentStep.description}" but has low confidence (${confidence}%). Team: can someone review?`);
  touchActivity();
  return {
    status: 'needs_help', workflow_id: wf.id,
    message: 'Low confidence. Help request broadcast to team. Call get_work() — you may get a review assignment or other work while waiting.'
  };
}

function toolRetryWithImprovement(params) {
  if (!registeredName) return { error: 'You must call register() first' };

  const { task_or_step, what_failed, why_it_failed, new_approach } = params;
  if (!task_or_step) return { error: 'task_or_step is required' };
  if (!what_failed) return { error: 'what_failed is required' };
  if (!why_it_failed) return { error: 'why_it_failed is required' };
  if (!new_approach) return { error: 'new_approach is required' };

  const attempt = params.attempt_number || 1;
  const retrySubject = resolveRetryPolicySubject(task_or_step);
  const retryPolicyContext = buildAutonomyPolicyContext(registeredName, currentBranch, currentSessionId);
  const retryPolicy = classifyRetryPolicy({
    target: retrySubject.target,
    context: retryPolicyContext,
    attemptCount: attempt,
    ownerAlive: true,
    idleMs: 0,
  });

  const learning = {
    task: task_or_step, failure: what_failed,
    root_cause: why_it_failed, new_approach,
    attempt, agent: registeredName,
    timestamp: new Date().toISOString(),
  };

  // Store in agent's workspace for future reference
  const ws = getWorkspace(registeredName);
  if (!ws.retry_history) ws.retry_history = [];
  ws.retry_history.push(learning);
  if (ws.retry_history.length > 50) ws.retry_history = ws.retry_history.slice(-50);
  saveWorkspace(registeredName, ws);

  // Store as KB skill for all agents to learn from
  const key = `lesson_${registeredName}_${Date.now().toString(36)}`;
  const lessonContent = JSON.stringify({
    context: task_or_step,
    lesson: `Approach "${what_failed}" failed because: ${why_it_failed}. Better approach: ${new_approach}`,
    learned_by: registeredName,
  });
  canonicalState.writeKnowledgeBaseEntry({
    key,
    value: { content: lessonContent, updated_by: registeredName, updated_at: new Date().toISOString() },
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: task_or_step,
    maxEntries: 100,
  });

  trackReputation(registeredName, 'retry');
  touchActivity();

  if (retryPolicy.state === 'blocked_permanent') {
    // Max retries — escalate with FULL context so next agent doesn't start blind.
    const allAttempts = ws.retry_history.filter(r => r.task === task_or_step);
    const attemptSummary = allAttempts.map((a, i) =>
      `  Attempt ${a.attempt || i + 1} (${a.agent}): Tried "${a.new_approach || 'initial'}" → Failed: ${a.failure}. Root cause: ${a.root_cause}`
    ).join('\n');

    const rateErr = checkRateLimit('__escalation__', '__broadcast__');
    if (rateErr) return rateErr;

    broadcastSystemMessage(
      `[ESCALATION] ${registeredName} has tried "${task_or_step}" ${attempt} times and is still stuck.\n\n` +
      `FULL FAILURE CONTEXT (read this before attempting):\n${attemptSummary}\n\n` +
      `Last failure: ${what_failed}\n` +
      `Root cause: ${why_it_failed}\n` +
      `Policy: ${retryPolicy.summary}\n\n` +
      `Team: someone with DIFFERENT expertise should take over. DO NOT repeat the same approaches. Use suggest_task() or claim the task.`
    );

    // Store full context in KB so get_work can attach it
    const escKey = `escalation_${Date.now().toString(36)}`;
    canonicalState.writeKnowledgeBaseEntry({
      key: escKey,
      value: {
        content: JSON.stringify({ task: task_or_step, attempts: allAttempts, escalated_by: registeredName }),
        updated_by: registeredName,
        updated_at: new Date().toISOString(),
      },
      actor: registeredName,
      branch: currentBranch,
      sessionId: currentSessionId,
      correlationId: task_or_step,
      maxEntries: 100,
    });

    return {
      status: 'escalated', attempt_number: attempt,
      message: 'Escalated to team with full failure context. Call get_work() to pick up other work while someone else handles this.',
      attempts: allAttempts,
      failure_context: attemptSummary,
      retry_policy: retryPolicy,
    };
  }

  // Check if any other agent has solved a similar problem before
  const keywords = task_or_step.toLowerCase().split(/\W+/).filter(w => w.length > 3);
  const allKB = getKB();
  const relatedLessons = [];
  for (const [k, v] of Object.entries(allKB)) {
    if (!k.startsWith('lesson_') && !k.startsWith('skill_')) continue;
    const content = (v.content || '').toLowerCase();
    const matchCount = keywords.filter(kw => content.includes(kw)).length;
    if (matchCount >= 2) relatedLessons.push(v.content);
  }

  return {
    status: 'retry_approved', attempt_number: attempt,
    message: `Retry ${attempt}/3 recorded. Proceed with your new approach: "${new_approach}". If this fails too, call retry_with_improvement() again.`,
    related_lessons: relatedLessons.length > 0 ? relatedLessons.slice(0, 3) : null,
    retry_policy: retryPolicy,
  };
}

// --- Watchdog Engine (autonomous mode only) ---

function amIWatchdog() {
  if (!registeredName) return false;
  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name)
    .sort();
  // Manager gets priority, otherwise alphabetically first alive agent
  const config = getConfig();
  if (config.manager && aliveNames.includes(config.manager)) {
    return registeredName === config.manager;
  }
  return aliveNames.length > 0 && aliveNames[0] === registeredName;
}

function watchdogCheck() {
  // Policy-bounded watchdog: classify stale work from canonical/session/evidence/provider/contract context,
  // then emit nudges, releases, escalation signals, or owner-unavailable step recovery without broad silent reassignment.
  if (!isAutonomousMode() && !isGroupMode()) return;
  if (!amIWatchdog()) return;

  const agents = getAgents();
  const profiles = getProfiles();
  const tasks = getTasks();
  const workflows = getWorkflows();
  const now = Date.now();
  let agentsChanged = false;

  const watchdogActions = planWatchdogActions({
    watchdogAgentName: registeredName,
    branchId: currentBranch,
    nowMs: now,
    agents,
    tasks,
    workflows,
    resolveContext: (agentName, branchId) => buildAutonomyPolicyContext(agentName, branchId, null, agents, profiles),
    resolveStepResumeContext: (workflow, step, branchId, assignee) => buildAuthoritativeResumeContext({
      agentName: assignee,
      branchName: branchId,
      sessionSummary: getAuthoritativeSessionSummary(assignee, branchId),
      activeStep: {
        ...step,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
      },
      upcomingStep: null,
      evidenceLimit: 5,
    }),
    isAgentAlive: (agentName, agentRecord) => !!(agentRecord && isPidAlive(agentRecord.pid, agentRecord.last_activity)),
  });

  for (const action of watchdogActions) {
    if (action.kind === 'nudge_idle' || action.kind === 'nudge_idle_hard') {
      const agent = agents[action.agentName];
      if (!agent) continue;
      sendSystemMessage(
        action.agentName,
        action.kind === 'nudge_idle_hard'
          ? `[WATCHDOG] You've been idle for ${Math.round((action.idleMs || 0) / 60000)} minutes. Call get_work() now and report explicit progress — ownership stays unchanged until a deliberate reassignment decision is made.`
          : `[WATCHDOG] You've been idle for ${Math.round((action.idleMs || 0) / 60000)} minutes. Call get_work() to refresh your explicit assignment context.`
      );
      if (action.kind === 'nudge_idle') {
        trackReputation(action.agentName, 'watchdog_nudge');
        agent.watchdog_nudged = now;
      } else {
        agent.watchdog_hard_nudged = now;
      }
      agentsChanged = true;
      continue;
    }

    if (action.kind === 'release_task_claim') {
      const releasedAt = new Date().toISOString();
      const released = canonicalState.updateTaskStatus({
        taskId: action.taskId,
        status: 'pending',
        actor: registeredName,
        branch: action.branchId || currentBranch,
        sessionId: currentSessionId,
        correlationId: action.taskId,
        sourceTool: 'watchdog_policy',
        assignee: null,
        expectedAssignee: action.assignee || null,
        expectedStatuses: ['in_progress'],
        notes: action.policy.summary,
        policySignal: buildPersistedPolicySignal('watchdog', action.policy, { at: releasedAt }),
      });
      if (!released.error) {
        broadcastSystemMessage(
          `[WATCHDOG] Released task "${action.taskTitle}" from ${action.assignee} back to pending. ${action.policy.summary}`,
          registeredName
        );
      }
      continue;
    }

    if (action.kind === 'escalate_blocked_task') {
      const escalatedAt = new Date().toISOString();
      const escalated = canonicalState.updateTaskStatus({
        taskId: action.taskId,
        status: 'blocked',
        actor: registeredName,
        branch: action.branchId || currentBranch,
        sessionId: currentSessionId,
        correlationId: action.taskId,
        sourceTool: 'watchdog_policy',
        assignee: action.assignee || null,
        expectedStatuses: ['blocked'],
        escalatedAt,
        notes: action.policy.summary,
        policySignal: buildPersistedPolicySignal('watchdog', action.policy, { at: escalatedAt }),
      });
      if (!escalated.error) {
        broadcastSystemMessage(
          `[ESCALATION] Task "${action.taskTitle}" (assigned to ${action.assignee || 'unassigned'}) needs help. ${action.policy.summary}`,
          registeredName
        );
      }
      continue;
    }

    if (action.kind === 'signal_stalled_step') {
      const signaledAt = new Date().toISOString();
      const signalField = action.signal === 'checkin' ? 'watchdog_pinged_at' : 'watchdog_escalated_at';
      const signaled = canonicalState.setWorkflowStepPolicySignal({
        workflowId: action.workflowId,
        stepId: action.stepId,
        expectedAssignee: action.assignee || null,
        signalAtField: signalField,
        policySignal: buildPersistedPolicySignal('watchdog', action.policy, {
          at: signaledAt,
          signal: action.signal,
        }),
      });
      if (signaled.error) continue;

      if (action.signal === 'escalate') {
        const workflowRecord = workflows.find((entry) => entry.id === action.workflowId) || null;
        const stepRecord = workflowRecord && Array.isArray(workflowRecord.steps)
          ? workflowRecord.steps.find((entry) => entry.id === action.stepId) || null
          : null;
        const ownershipChange = planStalledStepOwnershipChange({
          branchId: action.branchId || currentBranch,
          currentAssignee: action.assignee || null,
          watchdogAgentName: registeredName,
          policy: action.policy,
          target: buildWorkflowStepPolicyTarget(
            stepRecord || { description: action.stepDescription },
            workflowRecord || { name: action.workflowName }
          ),
          agents,
          resolveContext: (agentName, branchId) => buildAutonomyPolicyContext(agentName, branchId, null, agents, profiles),
          isAgentAlive: (agentName, agentRecord) => !!(agentRecord && isPidAlive(agentRecord.pid, agentRecord.last_activity)),
        });

        if (ownershipChange.allowed) {
          const reassignedAt = new Date().toISOString();
          const reassigned = canonicalState.reassignWorkflowStep({
            workflowId: action.workflowId,
            stepId: action.stepId,
            newAssignee: ownershipChange.new_assignee,
            actor: registeredName,
            branch: action.branchId || currentBranch,
            sessionId: currentSessionId,
            correlationId: action.workflowId,
            expectedAssignee: action.assignee || null,
            clearPolicySignal: true,
            clearSignalFields: ['watchdog_pinged_at', 'watchdog_escalated_at'],
            restartStartedAt: reassignedAt,
            at: reassignedAt,
          });

          if (reassigned && reassigned.success) {
            sendSystemMessage(
              ownershipChange.new_assignee,
              `[WATCHDOG REASSIGNMENT] Step "${action.stepDescription}" has been reassigned to you from ${action.assignee || 'an unavailable owner'}. ${ownershipChange.summary}`
            );
            broadcastSystemMessage(
              `[WATCHDOG OWNERSHIP CHANGE] Step "${action.stepDescription}" moved from ${action.assignee || 'unassigned'} to ${ownershipChange.new_assignee}. ${ownershipChange.summary}`,
              registeredName
            );
            continue;
          }
        }
      }

      if (action.signal === 'checkin' && action.assignee) {
        sendSystemMessage(
          action.assignee,
          `[WATCHDOG] Step "${action.stepDescription}" has been running for ${Math.round((action.stepAgeMs || 0) / 60000)} minutes. Report explicit status and blockers; watchdog is only surfacing a bounded check-in signal.`
        );
      } else {
        broadcastSystemMessage(
          `[WATCHDOG ESCALATION] Step "${action.stepDescription}" (${action.assignee || 'unassigned'}) needs attention. ${action.policy.summary}`,
          registeredName
        );
      }
    }
  }

  // UE5 safety: detect stale UE5 locks (ue5-editor, ue5-compile)
  try {
    const locks = getLocks();
    let locksChanged = false;
    for (const [lockPath, lock] of Object.entries(locks)) {
      if (!lockPath.startsWith('ue5-')) continue;
      const lockAge = now - new Date(lock.since).getTime();
      // >5 minutes: nudge the holder
      if (lockAge > 300000 && !lock.watchdog_nudged) {
        sendSystemMessage(lock.agent,
          `[WATCHDOG] You've held the ${lockPath} lock for ${Math.round(lockAge / 60000)} minutes. Unlock it immediately if you're done. UE5 locks block other agents.`
        );
        lock.watchdog_nudged = true;
        locksChanged = true;
      }
      // >15 minutes: force-release + notify team
      if (lockAge > 900000 && !lock.watchdog_released) {
        delete locks[lockPath];
        broadcastSystemMessage(`[WATCHDOG] Force-released stale ${lockPath} lock held by ${lock.agent} for ${Math.round(lockAge / 60000)} minutes. Lock is now available.`);
        locksChanged = true;
      }
    }
    if (locksChanged) writeJsonFile(LOCKS_FILE, locks);
  } catch {}

  if (agentsChanged) saveAgents(agents);
}

// --- Monitor Agent: system health check ---

function monitorHealthCheck() {
  if (!registeredName) return { error: 'You must call register() first' };

  const agents = getAgents();
  const profiles = getProfiles();
  const now = Date.now();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name);

  const health = {
    timestamp: new Date().toISOString(),
    agents_total: aliveNames.length,
    agents_idle: [],
    agents_stuck: [],
    circular_escalations: [],
    queue_pressure: 0,
    workflows_active: 0,
    workflows_stuck: [],
    interventions: [],
  };

  // 1. Detect idle agents (>2min no activity)
  for (const [name, agent] of Object.entries(agents)) {
    if (!isPidAlive(agent.pid, agent.last_activity)) continue;
    const idleTime = now - new Date(agent.last_activity).getTime();
    if (idleTime > 120000) {
      health.agents_idle.push({ name, idle_minutes: Math.round(idleTime / 60000) });
    }
  }

  // 2. Detect circular escalations (same task attempted by 2+ agents)
  const tasks = getTasks();
  for (const task of tasks) {
    if (task.attempt_agents && task.attempt_agents.length >= 2 && task.status !== 'done' && task.status !== 'blocked_permanent') {
      const ownerName = task.assignee || null;
      const ownerRecord = ownerName ? agents[ownerName] : null;
      const retryPolicy = classifyRetryPolicy({
        target: buildTaskPolicyTarget(task),
        context: ownerName
          ? buildAutonomyPolicyContext(ownerName, (ownerRecord && ownerRecord.branch) || currentBranch, null, agents, profiles)
          : {},
        attemptCount: Array.isArray(task.attempt_agents) ? task.attempt_agents.length : 0,
        ownerAlive: ownerName ? !!(ownerRecord && isPidAlive(ownerRecord.pid, ownerRecord.last_activity)) : true,
        idleMs: ownerRecord && ownerRecord.last_activity
          ? Math.max(0, now - new Date(ownerRecord.last_activity).getTime())
          : 0,
      });
      health.circular_escalations.push({
        task_id: task.id, title: task.title,
        agents_tried: task.attempt_agents, attempts: task.attempt_agents.length,
        retry_policy: retryPolicy,
      });
    }
  }

  // 3. Queue pressure (pending tasks per alive agent)
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  health.queue_pressure = aliveNames.length > 0 ? Math.round((pendingTasks.length / aliveNames.length) * 10) / 10 : 0;

  // 4. Stuck workflows (in_progress steps >15min)
  const workflows = getWorkflows();
  for (const wf of workflows) {
    if (wf.status !== 'active') continue;
    health.workflows_active++;
    for (const step of wf.steps) {
      if (step.status !== 'in_progress' || !step.started_at) continue;
      const stepAge = now - new Date(step.started_at).getTime();
      if (stepAge > 900000) {
        health.workflows_stuck.push({
          workflow: wf.name, step_id: step.id,
          description: step.description, assignee: step.assignee,
          stuck_minutes: Math.round(stepAge / 60000),
        });
      }
    }
  }

  // 5. Recommended watchdog-policy actions (report-only in this slice)
  const watchdogActions = planWatchdogActions({
    watchdogAgentName: registeredName,
    branchId: currentBranch,
    nowMs: now,
    agents,
    tasks,
    workflows,
    resolveContext: (agentName, branchId) => buildAutonomyPolicyContext(agentName, branchId, null, agents, profiles),
    resolveStepResumeContext: (workflow, step, branchId, assignee) => buildAuthoritativeResumeContext({
      agentName: assignee,
      branchName: branchId,
      sessionSummary: getAuthoritativeSessionSummary(assignee, branchId),
      activeStep: {
        ...step,
        workflow_id: workflow.id,
        workflow_name: workflow.name,
      },
      upcomingStep: null,
      evidenceLimit: 5,
    }),
    isAgentAlive: (agentName, agentRecord) => !!(agentRecord && isPidAlive(agentRecord.pid, agentRecord.last_activity)),
  });
  health.interventions = watchdogActions
    .map((action) => summarizeWatchdogActionForHealth(action))
    .filter(Boolean);

  // Store health log in workspace
  const ws = getWorkspace(registeredName);
  if (!ws._monitor_log) ws._monitor_log = [];
  // Cap health entry: if too large, store summary only
  const healthStr = JSON.stringify(health);
  const cappedHealth = healthStr.length > 10240 ? { summary: `${health.agents_alive || 0} alive, ${health.agents_idle || 0} idle, ${(health.interventions || []).length} interventions`, ts: health.timestamp || new Date().toISOString() } : health;
  ws._monitor_log.push(cappedHealth);
  if (ws._monitor_log.length > 50) ws._monitor_log = ws._monitor_log.slice(-50);
  saveWorkspace(registeredName, ws);

  touchActivity();

  return {
    type: 'health_report', priority: 'monitor',
    health,
    instruction: health.interventions.length > 0
      ? `Health report includes ${health.interventions.length} recommended watchdog policy signal(s). Send bounded nudges or escalation messages if appropriate, and keep any ownership move limited to the explicit policy-approved unavailable-owner recovery path.`
      : `System healthy. ${health.agents_total} agents, ${health.workflows_active} active workflows. Call monitorHealthCheck() again in 30 seconds.`,
  };
}

// --- Advisor Agent: strategic analysis ---

function advisorAnalysis() {
  if (!registeredName) return { error: 'You must call register() first' };

  // Gather context for the advisor to analyze
  // Scale fix: tail-read only last 50 lines instead of entire history file
  const history = tailReadJsonl(getHistoryFile(currentBranch), 50);
  const recentMessages = history.slice(-30).map(m => ({
    from: m.from, to: m.to,
    content: m.content.substring(0, 300),
    timestamp: m.timestamp,
  }));

  // Completed work summaries
  const tasks = getTasks();
  const completedTasks = tasks.filter(t => t.status === 'done').slice(-10).map(t => ({
    title: t.title, assignee: t.assignee,
    description: (t.description || '').substring(0, 200),
  }));

  // Active workflows
  const workflows = getWorkflows();
  const activeWorkflows = workflows.filter(w => w.status === 'active').map(w => ({
    name: w.name,
    progress: `${w.steps.filter(s => s.status === 'done').length}/${w.steps.length}`,
    current_steps: w.steps.filter(s => s.status === 'in_progress').map(s => s.description),
  }));

  // KB skills and lessons
  const kb = getKB();
  const lessons = Object.entries(kb)
    .filter(([k]) => k.startsWith('lesson_') || k.startsWith('skill_'))
    .slice(-10)
    .map(([k, v]) => ({ key: k, content: v.content.substring(0, 200) }));

  // Decisions made
  const decisions = getDecisions().slice(-5);

  touchActivity();

  return {
    type: 'advisor_context', priority: 'advisor',
    recent_messages: recentMessages,
    completed_work: completedTasks,
    active_workflows: activeWorkflows,
    team_lessons: lessons,
    recent_decisions: decisions,
    instruction: 'Review this context. Spot patterns, suggest improvements, challenge assumptions, propose next steps. Share your insights with the team via send_message. Then call get_work() again in 30 seconds.',
  };
}

// --- Auto-generated completion report ---

function generateCompletionReport(workflow) {
  const steps = workflow.steps || [];
  const createdAt = new Date(workflow.created_at);
  const completedAt = workflow.completed_at ? new Date(workflow.completed_at) : new Date();
  const durationMs = completedAt - createdAt;
  const durationMin = Math.round(durationMs / 60000);

  // Step results
  const stepResults = steps.map(s => {
    const startedAt = s.started_at ? new Date(s.started_at) : null;
    const completedStepAt = s.completed_at ? new Date(s.completed_at) : null;
    const stepDurationMin = (startedAt && completedStepAt) ? Math.round((completedStepAt - startedAt) / 60000) : null;
    const confidence = s.verification ? s.verification.confidence : null;
    return {
      id: s.id, description: s.description, assignee: s.assignee,
      status: s.status, duration_min: stepDurationMin,
      confidence, flagged: s.flagged || false,
      flag_reason: s.flag_reason || null,
      verification_summary: s.verification ? s.verification.summary : null,
    };
  });

  // Confidence stats
  const confidences = stepResults.filter(s => s.confidence !== null).map(s => s.confidence);
  const avgConfidence = confidences.length > 0 ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null;

  // Flagged steps
  const flaggedSteps = stepResults.filter(s => s.flagged);

  // Skills learned during this workflow (KB entries created after workflow started)
  const kb = getKB();
  const skillsLearned = [];
  for (const [key, val] of Object.entries(kb)) {
    if ((!key.startsWith('skill_') && !key.startsWith('lesson_')) || !val.updated_at) continue;
    if (new Date(val.updated_at) >= createdAt) {
      skillsLearned.push({ key, content: val.content, by: val.updated_by });
    }
  }

  // Retry history from workspaces
  const agents = getAgents();
  let totalRetries = 0;
  const retryDetails = [];
  for (const name of Object.keys(agents)) {
    try {
      const ws = getWorkspace(name);
      if (ws.retry_history) {
        const relevant = ws.retry_history.filter(r => new Date(r.timestamp) >= createdAt);
        totalRetries += relevant.length;
        for (const r of relevant) retryDetails.push({ agent: name, task: r.task, attempt: r.attempt });
      }
    } catch {}
  }

  const report = {
    plan_name: workflow.name,
    workflow_id: workflow.id,
    status: workflow.status,
    duration_minutes: durationMin,
    steps_total: steps.length,
    steps_done: steps.filter(s => s.status === 'done').length,
    step_results: stepResults,
    avg_confidence: avgConfidence,
    flagged_count: flaggedSteps.length,
    flagged_steps: flaggedSteps,
    retries: totalRetries,
    retry_details: retryDetails.slice(0, 10),
    skills_learned: skillsLearned.length,
    skill_entries: skillsLearned.slice(0, 20),
    created_at: workflow.created_at,
    completed_at: workflow.completed_at,
  };

  // Store report in KB for dashboard retrieval
  const reportKey = `report_${workflow.id}`;
  canonicalState.writeKnowledgeBaseEntry({
    key: reportKey,
    value: { content: JSON.stringify(report), updated_by: '__system__', updated_at: new Date().toISOString() },
    actor: '__system__',
    branch: currentBranch,
    correlationId: workflow.id,
    maxEntries: 100,
  });

  return report;
}

// --- Team Intelligence Layer: auto-role assignment + prompt distribution ---

const ROLE_CONFIGS = {
  1: [{ role: 'lead', description: 'You handle everything: planning, implementation, testing, and quality.' }],
  2: [
    { role: 'lead', description: 'You plan, implement, and coordinate. Report work to Quality Lead for review.' },
    { role: 'quality', description: 'You review ALL work, find bugs, suggest improvements, and keep the team iterating. Never approve without checking. You are the last gate before anything is done.' },
  ],
  3: [
    { role: 'lead', description: 'You plan the approach and coordinate the team. Break work into tasks and assign them.' },
    { role: 'implementer', description: 'You write code and implement features. Report completed work to Quality Lead.' },
    { role: 'quality', description: 'You review ALL work, find bugs, suggest improvements, and keep the team iterating. Never approve without checking.' },
  ],
  4: [
    { role: 'lead', description: 'You plan the approach, design architecture, and coordinate the team.' },
    { role: 'backend', description: 'You implement backend logic, APIs, and server-side code.' },
    { role: 'frontend', description: 'You implement UI, frontend code, and user-facing features.' },
    { role: 'quality', description: 'You review ALL work, find bugs, run tests, suggest improvements. Never approve without checking.' },
  ],
};

function autoAssignRoles() {
  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name)
    .sort();

  if (aliveNames.length < 2) return null;

  // Sticky roles: if critical roles (lead, quality, monitor, advisor) are held by alive agents, skip reassignment
  const currentProfiles = getProfiles();
  const criticalRoles = ['lead', 'quality', 'monitor', 'advisor'];
  const existingCritical = {};
  for (const name of aliveNames) {
    if (currentProfiles[name] && criticalRoles.includes(currentProfiles[name].role)) {
      existingCritical[currentProfiles[name].role] = name;
    }
  }
  // If lead AND quality are both alive and assigned, skip full reassignment
  if (existingCritical.lead && existingCritical.quality) {
    const assignments = {};
    for (const name of aliveNames) {
      if (currentProfiles[name] && currentProfiles[name].role) {
        assignments[name] = { role: currentProfiles[name].role, description: currentProfiles[name].role_description || '' };
      }
    }
    // Only assign roles to agents that don't have one yet
    const unassigned = aliveNames.filter(n => !currentProfiles[n] || !currentProfiles[n].role);
    for (const name of unassigned) {
      if (!currentProfiles[name]) currentProfiles[name] = createDefaultProfileRecord(name);
      currentProfiles[name].role = 'implementer';
      currentProfiles[name].role_description = 'You implement features and tasks assigned by the Lead. Report completed work to Quality Lead.';
      assignments[name] = { role: 'implementer', description: currentProfiles[name].role_description };
      saveProfiles(currentProfiles);
      sendSystemMessage(name, `[ROLE ASSIGNED] You are the **implementer**. ${currentProfiles[name].role_description}`);
    }
    if (unassigned.length > 0) return assignments;
    return null; // No changes needed
  }

  // Pick role config — use exact match or largest available
  const teamSize = aliveNames.length;
  const configSize = Math.min(teamSize, Math.max(...Object.keys(ROLE_CONFIGS).map(Number)));
  const roles = ROLE_CONFIGS[configSize] || ROLE_CONFIGS[4];

  // Assign roles round-robin: first agent = Lead, last agent = Quality (always)
  const profiles = getProfiles();
  const assignments = {};

  for (let i = 0; i < aliveNames.length; i++) {
    const agentName = aliveNames[i];
    let roleConfig;

    if (i === aliveNames.length - 1) {
      // Last agent is always Quality Lead
      roleConfig = roles.find(r => r.role === 'quality') || roles[roles.length - 1];
    } else if (i === 0) {
      // First agent is always Lead
      roleConfig = roles.find(r => r.role === 'lead') || roles[0];
    } else if (i === 1 && teamSize >= 10) {
      // Second agent becomes Monitor at 10+ agents — the system's brain
      roleConfig = { role: 'monitor', description: 'You are the MONITOR AGENT — the system\'s brain. You do NOT do regular work. Your job: watch all agents continuously, detect stuck/idle/failing agents, detect circular escalations and queue buildup, intervene by reassigning work and rebalancing roles, report system health metrics. Run monitorHealthCheck() instead of get_work().' };
    } else if (i === 1 && teamSize >= 5) {
      // Second agent becomes Advisor at 5-9 agents — strategic thinker
      roleConfig = { role: 'advisor', description: 'You are the ADVISOR. You do NOT write code. You read all messages and completed work, spot patterns, suggest better approaches, challenge assumptions, and connect dots across the team. Your ideas go to the team as suggestions. Think deeply before speaking.' };
    } else if (i === 2 && teamSize >= 10) {
      // Third agent becomes Advisor at 10+ agents (Monitor is at position 1)
      roleConfig = { role: 'advisor', description: 'You are the ADVISOR. You do NOT write code. You read all messages and completed work, spot patterns, suggest better approaches, challenge assumptions, and connect dots across the team. Your ideas go to the team as suggestions. Think deeply before speaking.' };
    } else if (teamSize > 4) {
      // Extra agents beyond 4 — assign as Implementer with index
      roleConfig = { role: `implementer-${i}`, description: 'You implement features and tasks assigned by the Lead. Report completed work to Quality Lead.' };
    } else {
      // Middle agents get middle roles
      const middleRoles = roles.filter(r => r.role !== 'lead' && r.role !== 'quality');
      roleConfig = middleRoles[(i - 1) % middleRoles.length] || { role: 'Implementer', description: 'Implement assigned tasks.' };
    }

    // Update profile with role
    if (!profiles[agentName]) {
      profiles[agentName] = createDefaultProfileRecord(agentName);
    }
    profiles[agentName].role = roleConfig.role;
    profiles[agentName].role_description = roleConfig.description;
    assignments[agentName] = roleConfig;
  }

  saveProfiles(profiles);

  // Notify all agents of their roles
  for (const [agentName, roleConfig] of Object.entries(assignments)) {
    sendSystemMessage(agentName,
      `[ROLE ASSIGNED] You are the **${roleConfig.role}**. ${roleConfig.description}`
    );
  }

  // Auto-team channels at 10+ agents: create #team-1, #team-2 etc. with 5-8 agents each
  if (teamSize >= 10) {
    try {
      const channels = getChannelsData();
      const workers = aliveNames.filter(n => {
        const role = profiles[n] && profiles[n].role;
        return role !== 'lead' && role !== 'quality' && role !== 'monitor' && role !== 'advisor';
      });
      const teamSize2 = Math.min(8, Math.max(5, Math.ceil(workers.length / Math.ceil(workers.length / 6))));
      const teamCount = Math.ceil(workers.length / teamSize2);

      for (let t = 0; t < teamCount; t++) {
        const teamName = `team-${t + 1}`;
        const teamMembers = workers.slice(t * teamSize2, (t + 1) * teamSize2);
        // Add team lead (first member) and find/assign team quality (last member)
        if (!channels[teamName]) {
          channels[teamName] = {
            description: `Team ${t + 1} (${teamMembers.length} members)`,
            members: teamMembers,
            created_by: '__system__',
            created_at: new Date().toISOString(),
            auto_team: true,
          };
          // Also add the global lead to all team channels for cross-team coordination
          const globalLead = aliveNames.find(n => profiles[n] && profiles[n].role === 'lead');
          if (globalLead && !teamMembers.includes(globalLead)) {
            channels[teamName].members.push(globalLead);
          }
        }
      }
      saveChannelsData(channels);
    } catch {}
  }

  return assignments;
}

// Item 5: Dynamic role fluidity — rebalance roles based on workload
function rebalanceRoles() {
  const profiles = getProfiles();
  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name);

  if (aliveNames.length < 3) return null; // Need 3+ agents for rebalancing

  // Count pending work by type
  const reviews = getReviews();
  const pendingReviews = reviews.filter(r => r.status === 'pending').length;
  const tasks = getTasks();
  const pendingTasks = tasks.filter(t => t.status === 'pending' && !t.assignee).length;

  // Count agents by role
  const qualityAgents = aliveNames.filter(n => profiles[n] && profiles[n].role === 'quality');
  const implementerAgents = aliveNames.filter(n => profiles[n] && (profiles[n].role === 'implementer' || (profiles[n].role || '').startsWith('implementer')));

  let rebalanced = false;

  // If review queue is deep (3+ pending) and we have idle implementers, promote one to quality
  if (pendingReviews >= 3 && qualityAgents.length < 2 && implementerAgents.length >= 2) {
    // Find the implementer with highest review reputation
    const rep = getReputation();
    const bestReviewer = implementerAgents
      .sort((a, b) => ((rep[b] || {}).reviews_done || 0) - ((rep[a] || {}).reviews_done || 0))[0];
    if (bestReviewer && profiles[bestReviewer]) {
      profiles[bestReviewer].role = 'quality';
      profiles[bestReviewer].role_description = 'Promoted to second Quality Lead due to review backlog. Review pending work.';
      sendSystemMessage(bestReviewer, `[ROLE CHANGE] You have been promoted to second Quality Lead. There are ${pendingReviews} pending reviews. Start reviewing now.`);
      rebalanced = true;
    }
  }

  // If task queue is deep (5+ pending) and we have multiple quality agents, demote one back
  if (pendingTasks >= 5 && qualityAgents.length >= 2 && implementerAgents.length < 2) {
    const demoteAgent = qualityAgents[qualityAgents.length - 1]; // demote the most recently promoted
    if (demoteAgent && profiles[demoteAgent]) {
      profiles[demoteAgent].role = 'implementer';
      profiles[demoteAgent].role_description = 'Returned to implementer role due to task backlog. Implement pending tasks.';
      sendSystemMessage(demoteAgent, `[ROLE CHANGE] You have been returned to implementer role. There are ${pendingTasks} pending tasks. Start implementing.`);
      rebalanced = true;
    }
  }

  if (rebalanced) saveProfiles(profiles);
  return rebalanced;
}

// Item 9: Retrospective learning — analyze retry patterns and log aggregate insights
function logRetrospective(workflowId) {
  const kb = getKB();
  // Gather all lesson_* entries created during this workflow
  const lessons = [];
  for (const [key, entry] of Object.entries(kb)) {
    if (!key.startsWith('lesson_')) continue;
    try {
      const content = typeof entry === 'string' ? entry : entry.content || '';
      const parsed = JSON.parse(content);
      if (parsed && parsed.lesson) lessons.push(parsed);
    } catch {
      if (typeof entry === 'string' || (entry && entry.content)) lessons.push({ lesson: typeof entry === 'string' ? entry : entry.content });
    }
  }

  if (lessons.length < 2) return null; // not enough data for patterns

  // Group by failure keywords to find recurring patterns
  const patterns = {};
  for (const lesson of lessons) {
    const text = (lesson.lesson || '').toLowerCase();
    // Extract failure type keywords
    const keywords = text.match(/\b(timeout|crash|null|undefined|syntax|import|permission|race|deadlock|overflow|memory|validation)\b/g);
    if (keywords) {
      for (const kw of keywords) {
        if (!patterns[kw]) patterns[kw] = { count: 0, examples: [] };
        patterns[kw].count++;
        if (patterns[kw].examples.length < 3) patterns[kw].examples.push(lesson.lesson.substring(0, 100));
      }
    }
  }

  // Log patterns that appear 2+ times
  const insights = Object.entries(patterns)
    .filter(([, p]) => p.count >= 2)
    .map(([keyword, p]) => `"${keyword}" errors appeared ${p.count} times. Examples: ${p.examples.join('; ')}`);

  if (insights.length > 0) {
    const retroKey = `retrospective_${workflowId || Date.now().toString(36)}`;
    canonicalState.writeKnowledgeBaseEntry({
      key: retroKey,
      value: {
        content: `RETROSPECTIVE INSIGHTS: ${insights.join(' | ')}`,
        updated_by: 'system',
        updated_at: new Date().toISOString(),
      },
      actor: 'system',
      branch: currentBranch,
      correlationId: workflowId || retroKey,
      maxEntries: 200,
    });
  }

  return insights.length > 0 ? insights : null;
}

// Item 8: Checkpointing — periodic progress snapshots for resumable work
function saveCheckpoint(agentName, workflowId, stepId, progress) {
  const ws = getWorkspace(agentName);
  if (!ws._checkpoints) ws._checkpoints = {};
  ws._checkpoints[`${workflowId}_${stepId}`] = {
    progress,
    saved_at: new Date().toISOString(),
    workflow_id: workflowId,
    step_id: stepId,
  };
  saveWorkspace(agentName, ws);
}

function getCheckpoint(agentName, workflowId, stepId) {
  const ws = getWorkspace(agentName);
  if (!ws._checkpoints) return null;
  return ws._checkpoints[`${workflowId}_${stepId}`] || null;
}

function clearCheckpoint(agentName, workflowId, stepId) {
  const ws = getWorkspace(agentName);
  if (ws._checkpoints) {
    delete ws._checkpoints[`${workflowId}_${stepId}`];
    saveWorkspace(agentName, ws);
  }
}

// Workflow pattern templates for common request types
const WORKFLOW_PATTERNS = {
  feature: {
    match: /build|create|add|implement|make|develop|design/i,
    steps: (prompt, workers, quality) => {
      const steps = [
        { description: `Design architecture and plan approach for: ${prompt.substring(0, 150)}`, assignee: null },
      ];
      if (workers.length >= 2) {
        steps.push({ description: `Implement backend/core logic for: ${prompt.substring(0, 100)}`, assignee: workers[0], depends_on: [1] });
        steps.push({ description: `Implement frontend/UI for: ${prompt.substring(0, 100)}`, assignee: workers[1], depends_on: [1] });
        steps.push({ description: `Integration testing and verification`, assignee: quality, depends_on: [2, 3] });
      } else if (workers.length === 1) {
        steps.push({ description: `Implement: ${prompt.substring(0, 150)}`, assignee: workers[0], depends_on: [1] });
        steps.push({ description: `Test and verify implementation`, assignee: quality, depends_on: [2] });
      } else {
        steps.push({ description: `Implement: ${prompt.substring(0, 150)}`, depends_on: [1] });
        steps.push({ description: `Review and verify`, assignee: quality, depends_on: [2] });
      }
      return steps;
    },
  },
  fix: {
    match: /fix|bug|debug|repair|broken|error|crash|issue/i,
    steps: (prompt, workers, quality) => [
      { description: `Reproduce and diagnose: ${prompt.substring(0, 150)}` },
      { description: `Implement fix`, assignee: workers[0] || null, depends_on: [1] },
      { description: `Write regression test`, assignee: workers[1] || quality, depends_on: [2] },
      { description: `Verify fix and test pass`, assignee: quality, depends_on: [2, 3] },
    ],
  },
  refactor: {
    match: /refactor|clean|reorganize|restructure|improve|optimize/i,
    steps: (prompt, workers, quality) => [
      { description: `Analyze current code and plan refactor: ${prompt.substring(0, 150)}` },
      { description: `Execute refactor`, assignee: workers[0] || null, depends_on: [1] },
      { description: `Verify no regressions — run all tests`, assignee: quality, depends_on: [2] },
    ],
  },
};

function distributePrompt(content, fromAgent) {
  if (!registeredName) return { error: 'You must call register() first' };

  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([, a]) => isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name);

  if (aliveNames.length < 2) return { error: 'Need 2+ agents for prompt distribution' };

  // Find lead and quality agents
  const profiles = getProfiles();
  const lead = aliveNames.find(n => profiles[n] && profiles[n].role === 'lead') || aliveNames[0];
  const quality = aliveNames.find(n => profiles[n] && profiles[n].role === 'quality') || aliveNames[aliveNames.length - 1];
  const workers = aliveNames.filter(n => n !== lead && n !== quality);

  // Match prompt to a workflow pattern
  let pattern = null;
  for (const [, p] of Object.entries(WORKFLOW_PATTERNS)) {
    if (p.match.test(content)) { pattern = p; break; }
  }

  // Auto-generate workflow if pattern matches
  if (pattern) {
    const steps = pattern.steps(content, workers, quality);
    // Assign lead to step 1 if no assignee set
    if (!steps[0].assignee) steps[0].assignee = lead;

    // Smart plan generation: enrich step descriptions with KB skills/lessons
    const kb = getKB();
    const kbEntries = Object.entries(kb).filter(([k]) => k.startsWith('skill_') || k.startsWith('lesson_'));
    if (kbEntries.length > 0) {
      for (const step of steps) {
        const stepWords = (step.description || '').toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const relevant = kbEntries.filter(([, v]) => {
          const c = (typeof v === 'string' ? v : v.content || '').toLowerCase();
          return stepWords.some(w => c.includes(w));
        }).slice(0, 2);
        if (relevant.length > 0) {
          step.description += ' [Team learned: ' + relevant.map(([, v]) => (typeof v === 'string' ? v : v.content || '').substring(0, 80)).join('; ') + ']';
        }
      }
    }

    const wfResult = toolCreateWorkflow(`Auto: ${content.substring(0, 40)}`, steps, true, true);
    if (wfResult.error) return wfResult;

    // Broadcast plan launch
    broadcastSystemMessage(
      `[AUTO-PLAN] "${content.substring(0, 100)}" → ${steps.length}-step autonomous workflow created.\n` +
      `Lead: ${lead} | Quality: ${quality} | Workers: ${workers.join(', ') || 'none'}\n` +
      `All agents: call get_work() to enter the autonomous work loop.`
    );
    touchActivity();

    return {
      success: true, auto_plan: true,
      workflow_id: wfResult.workflow_id,
      steps: steps.length,
      lead, quality, workers,
      message: `Auto-generated ${steps.length}-step workflow from prompt. All agents should call get_work().`,
    };
  }

  // Fallback: create planning task for lead (generic/unrecognized prompts)
  const planTask = {
    id: 'task_' + generateId(),
    title: `Plan and distribute: ${content.substring(0, 100)}`,
    description: `Break this request into subtasks and assign to team members (${workers.join(', ')}). Then create a workflow with start_plan().\n\nOriginal request: ${content.substring(0, 2000)}`,
    status: 'pending',
    assignee: lead,
    created_by: fromAgent || '__system__',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    notes: [],
  };
  const createdPlanTask = canonicalState.createTask({
    task: planTask,
    actor: fromAgent || registeredName || '__system__',
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: planTask.id,
  });
  if (createdPlanTask.error) return createdPlanTask;

  sendSystemMessage(lead,
    `[PROMPT DISTRIBUTED] New work request: "${content.substring(0, 200)}"\n\n` +
    `You are the Lead. Break this into tasks, create a workflow with start_plan(), and assign steps to: ${workers.concat([quality]).join(', ')}.\n` +
    `The Quality Lead (${quality}) will review all work. Do NOT ask the user — plan and execute autonomously.`
  );
  sendSystemMessage(quality,
    `[PROMPT DISTRIBUTED] New work incoming: "${content.substring(0, 200)}"\n\n` +
    `${lead} is planning the approach. Your job: review ALL completed work, find bugs, suggest improvements.`
  );
  touchActivity();

  return {
    success: true, auto_plan: false,
    task_id: planTask.id,
    lead, quality, workers,
    message: `Prompt distributed to ${lead} for planning. ${quality} is quality gate, ${workers.length} worker(s) ready.`,
  };
}

// --- start_plan: one-click autonomous plan launch ---

function toolStartPlan(params) {
  if (!registeredName) return { error: 'You must call register() first' };

  const { name, steps, parallel } = params;
  if (!name || typeof name !== 'string' || name.length > 50) return { error: 'name must be 1-50 chars' };
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 30) return { error: 'steps must be array of 2-30 items' };

  // Delegate to create_workflow with autonomous=true
  const useParallel = parallel !== false; // default true
  const result = toolCreateWorkflow(name, steps, true, useParallel);
  if (result.error) return result;

  // Broadcast plan launch
  const startedSteps = result.started_steps || [];
  const assignees = startedSteps.map(s => s.assignee).filter(Boolean);
  broadcastSystemMessage(
    `[PLAN LAUNCHED] "${name}" — ${steps.length} steps, autonomous mode, ${useParallel ? 'parallel' : 'sequential'}. ` +
    `${startedSteps.length} step(s) started. ` +
    `All agents: call get_work() to enter the autonomous work loop. Do NOT call listen_group().`
  );

  touchActivity();

  return {
    success: true,
    workflow_id: result.workflow_id,
    name, step_count: steps.length,
    autonomous: true, parallel: useParallel,
    started_steps: startedSteps,
    message: 'Plan launched. All agents should call get_work() to enter the autonomous work loop.',
  };
}

// --- Phase 4: Branching tools ---

function toolForkConversation(fromMessageId, branchName) {
  if (!registeredName) return { error: 'You must call register() first' };
  sanitizeName(branchName);
  const sourceBranch = currentBranch;

  ensureBranchLocalP0State(sourceBranch);

  const branches = getBranches();
  if (Object.keys(branches).length >= 100) return { error: 'Branch limit reached (max 100).' };
  if (branches[branchName]) return { error: `Branch "${branchName}" already exists` };

  // Full read required when forking from a specific message (need index into full history).
  // When forking from end (no fromMessageId), use tailReadJsonl for performance.
  const readFullHistory = !!fromMessageId;
  const history = readFullHistory ? readJsonl(getHistoryFile(sourceBranch)) : tailReadJsonl(getHistoryFile(sourceBranch), 500);
  const forkIdx = fromMessageId ? history.findIndex(m => m.id === fromMessageId) : history.length - 1;
  if (forkIdx === -1) return { error: `Message ${fromMessageId} not found in current branch` };

  // Copy history up to fork point into new branch
  const forkedHistory = history.slice(0, forkIdx + 1);
  const forkPoint = history[forkIdx] || null;
  const forkTimestampMs = forkPoint ? new Date(forkPoint.timestamp || 0).getTime() : Date.now();
  const sourceChannels = getChannelsData(sourceBranch);
  const forkedChannelHistories = {};
  const visibleMessageIds = new Set(forkedHistory.map((message) => message.id));

  for (const channelName of Object.keys(sourceChannels)) {
    if (channelName === 'general') continue;
    const sourceChannelHistoryFile = getChannelHistoryFile(channelName, sourceBranch);
    const channelHistory = readFullHistory ? readJsonl(sourceChannelHistoryFile) : tailReadJsonl(sourceChannelHistoryFile, 500);
    const filteredHistory = filterMessagesUpToTimestamp(channelHistory, forkTimestampMs);
    forkedChannelHistories[channelName] = filteredHistory;
    for (const message of filteredHistory) {
      if (message && message.id) visibleMessageIds.add(message.id);
    }
  }

  ensureDataDir();
  const newHistFile = getHistoryFile(branchName);
  const newMsgFile = getMessagesFile(branchName);
  writeJsonlFileRaw(newHistFile, forkedHistory);
  writeJsonlFileRaw(newMsgFile, []); // empty messages for new branch
  copyBranchLocalP0StateForFork(sourceBranch, branchName, {
    visibleMessageIds,
    forkTimestampMs,
    sourceChannels,
    forkedChannelHistories,
  });
  copyBranchLocalWorkspaceStateForFork(sourceBranch, branchName);

  branches[branchName] = {
    created_at: new Date().toISOString(),
    created_by: registeredName,
    forked_from: sourceBranch,
    fork_point: fromMessageId || (forkPoint ? forkPoint.id : null),
    message_count: forkedHistory.length,
  };
  saveBranches(branches);

  // Switch this agent to the new branch
  const sessionActivation = activateBranch(branchName, { reason: 'branch_activate' });

  const result = { success: true, branch: branchName, forked_from: branches[branchName].forked_from, messages_copied: forkedHistory.length };
  if (sessionActivation && sessionActivation.session) {
    result.session = {
      id: sessionActivation.session.session_id,
      branch: sessionActivation.session.branch_id,
      state: sessionActivation.session.state,
      resumed: !!sessionActivation.resumed,
    };
  }

  return result;
}

function toolSwitchBranch(branchName) {
  if (!registeredName) return { error: 'You must call register() first' };
  try { sanitizeName(branchName); } catch (e) { return { error: e.message }; }

  const branches = getBranches();
  if (!branches[branchName]) return { error: `Branch "${branchName}" does not exist. Use list_branches to see available branches.` };

  ensureBranchLocalP0State(branchName);
  const sessionActivation = activateBranch(branchName, { reason: 'branch_activate' });

  const result = { success: true, branch: branchName, message: `Switched to branch "${branchName}". Branch-local read, control, and channel state reloaded.` };
  if (sessionActivation && sessionActivation.session) {
    result.session = {
      id: sessionActivation.session.session_id,
      branch: sessionActivation.session.branch_id,
      state: sessionActivation.session.state,
      resumed: !!sessionActivation.resumed,
    };
  }

  return result;
}

function toolListBranches() {
  const branches = getBranches();
  const result = {};
  for (const [name, info] of Object.entries(branches)) {
    const histFile = getHistoryFile(name);
    let msgCount = 0;
    if (fs.existsSync(histFile)) {
      const content = fs.readFileSync(histFile, 'utf8').trim();
      if (content) msgCount = content.split(/\r?\n/).filter(l => l.trim()).length;
    }
    result[name] = { ...info, message_count: msgCount, is_current: name === currentBranch };
  }
  return { branches: result, current: currentBranch };
}

// --- Tier 1: Briefing, File Locking, Decisions, Recovery ---

// Helpers for new data files
function readJsonFile(file) { return stateIo.readJsonFile(file, null); }
// File-to-cache-key map: writeJsonFile auto-invalidates the right cache entry
const _fileCacheKeys = {};
_fileCacheKeys[DECISIONS_FILE] = 'decisions';
_fileCacheKeys[KB_FILE] = 'kb';
_fileCacheKeys[LOCKS_FILE] = 'locks';
_fileCacheKeys[PROGRESS_FILE] = 'progress';
_fileCacheKeys[VOTES_FILE] = 'votes';
_fileCacheKeys[REVIEWS_FILE] = 'reviews';
_fileCacheKeys[DEPS_FILE] = 'deps';
_fileCacheKeys[REPUTATION_FILE] = 'reputation';
_fileCacheKeys[RULES_FILE] = 'rules';

function writeJsonFile(file, data) {
  const str = JSON.stringify(data);
  if (str && str.length > 0) {
    const cacheKey = _fileCacheKeys[file];
    stateIo.writeJson(file, data, { cacheKey });
  }
}

function getDecisions(branch = currentBranch) { return cachedRead(`decisions:${branch}`, () => canonicalState.listDecisions({ branch }), 2000); }
function getKB(branch = currentBranch) { return cachedRead(`kb:${branch}`, () => canonicalState.readKnowledgeBase({ branch }), 2000); }
function getLocks() { return cachedRead('locks', () => readJsonFile(LOCKS_FILE) || {}, 2000); }
function getProgressData(branch = currentBranch) { return cachedRead(`progress:${branch}`, () => canonicalState.readProgress({ branch }), 2000); }
function getVotes(branch = currentBranch) { return cachedRead(`votes:${branch}`, () => canonicalState.listVotes({ branch }), 2000); }
function getReviews(branch = currentBranch) { return cachedRead(`reviews:${branch}`, () => canonicalState.listReviews({ branch }), 2000); }
function getDeps(branch = currentBranch) { return cachedRead(`deps:${branch}`, () => canonicalState.listDependencies({ branch }), 2000); }
function getRules(branch = currentBranch) { return cachedRead(`rules:${branch}`, () => canonicalState.listRules({ branch }), 2000); }

// --- Channel helpers ---
function getChannelsData(branch = currentBranch) {
  return cachedRead(`channels:${branch}`, () => {
    const data = readJsonFile(getChannelsFile(branch));
    return normalizeChannelsData(data);
  }, 3000);
}

function saveChannelsData(channels, branch = currentBranch) {
  const file = getChannelsFile(branch);
  withFileLock(file, () => {
    writeJsonFile(file, normalizeChannelsData(channels));
    invalidateCache(`channels:${branch}`);
  });
}

function isChannelMember(channelName, agentName, branch = currentBranch) {
  const channels = getChannelsData(branch);
  if (!channels[channelName]) return false;
  return channels[channelName].members.includes('*') || channels[channelName].members.includes(agentName);
}

function getAgentChannels(agentName, branch = currentBranch) {
  const channels = getChannelsData(branch);
  return Object.keys(channels).filter(ch => channels[ch].members.includes('*') || channels[ch].members.includes(agentName));
}

// Cleanup dead agents from channel membership (called from heartbeat)
function cleanStaleChannelMembers() {
  const channels = getChannelsData(currentBranch);
  const agents = getAgents();
  let changed = false;
  for (const [name, ch] of Object.entries(channels)) {
    if (name === 'general') continue; // general uses '*', no cleanup needed
    const before = ch.members.length;
    ch.members = ch.members.filter(m => m === '*' || (agents[m] && isPidAlive(agents[m].pid, agents[m].last_activity)));
    if (ch.members.length !== before) changed = true;
  }
  if (changed) saveChannelsData(channels, currentBranch);
}

function toolJoinChannel(channelName, description, rateLimit) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof channelName !== 'string' || channelName.length < 1 || channelName.length > 20) return { error: 'Channel name must be 1-20 chars' };
  sanitizeName(channelName);

  const channels = getChannelsData();
  if (!channels[channelName]) {
    if (Object.keys(channels).length >= 100) return { error: 'Channel limit reached (max 100).' };
    // Create new channel
    channels[channelName] = {
      description: (description || '').substring(0, 200),
      members: [registeredName],
      created_by: registeredName,
      created_at: new Date().toISOString(),
    };
  } else if (!isChannelMember(channelName, registeredName)) {
    channels[channelName].members.push(registeredName);
  } else if (!rateLimit) {
    return { success: true, channel: channelName, message: 'Already a member of #' + channelName };
  }
  // Per-channel rate limit config — any member can set/update
  if (rateLimit && typeof rateLimit === 'object' && rateLimit.max_sends_per_minute) {
    const max = Math.min(Math.max(1, parseInt(rateLimit.max_sends_per_minute) || 10), 60);
    channels[channelName].rate_limit = { max_sends_per_minute: max };
  }
  saveChannelsData(channels);
  touchActivity();
  const result = { success: true, channel: channelName, members: channels[channelName].members, message: 'Joined #' + channelName };
  if (channels[channelName].rate_limit) result.rate_limit = channels[channelName].rate_limit;
  return result;
}

function toolLeaveChannel(channelName) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (channelName === 'general') return { error: 'Cannot leave #general' };

  const channels = getChannelsData();
  if (!channels[channelName]) return { error: 'Channel not found: #' + channelName };
  channels[channelName].members = channels[channelName].members.filter(m => m !== registeredName);
  // Auto-delete empty channels (except general)
  if (channels[channelName].members.length === 0) delete channels[channelName];
  saveChannelsData(channels);
  touchActivity();
  return { success: true, channel: channelName, message: 'Left #' + channelName };
}

function toolListChannels() {
  const channels = getChannelsData();
  const result = {};
  for (const [name, ch] of Object.entries(channels)) {
    const msgFile = getChannelMessagesFile(name);
    let msgCount = 0;
    if (fs.existsSync(msgFile)) {
      const content = fs.readFileSync(msgFile, 'utf8').trim();
      if (content) msgCount = content.split(/\r?\n/).filter(l => l.trim()).length;
    }
    result[name] = {
      description: ch.description || '',
      members: ch.members,
      member_count: ch.members.includes('*') ? 'all' : ch.members.length,
      created_by: ch.created_by,
      message_count: msgCount,
      you_are_member: isChannelMember(name, registeredName),
    };
  }
  return { channels: result, your_channels: getAgentChannels(registeredName) };
}

// Stand-up meetings: periodic team check-ins triggered by heartbeat
let _lastStandupTime = 0;
function triggerStandupIfDue() {
  try {
    const config = getConfig();
    const intervalHours = config.standup_interval_hours || 0; // 0 = disabled
    if (intervalHours <= 0) return;
    const intervalMs = intervalHours * 3600000;
    const now = Date.now();

    // Only one process should trigger (the first to notice it's due)
    const standupFile = path.join(DATA_DIR, '.last-standup');
    let lastStandup = 0;
    if (fs.existsSync(standupFile)) {
      try { lastStandup = parseInt(fs.readFileSync(standupFile, 'utf8').trim()) || 0; } catch {}
    }
    if (now - lastStandup < intervalMs) return;

    // Write timestamp first to prevent other processes from also triggering
    fs.writeFileSync(standupFile, String(now));

    const agents = getAgents();
    const aliveAgents = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
    if (aliveAgents.length < 5) return; // stand-ups only for large teams (5+)

    // Build standup context: tasks in progress, blocked, recently completed
    const tasks = getTasks();
    const inProgress = tasks.filter(t => t.status === 'in_progress');
    const blocked = tasks.filter(t => t.status === 'blocked');
    const recentDone = tasks.filter(t => t.status === 'done' && (now - new Date(t.updated_at).getTime()) < intervalMs);

    let summary = `[STANDUP] Team check-in (${aliveAgents.length} agents online).`;
    if (inProgress.length > 0) summary += ` In progress: ${inProgress.map(t => `"${t.title}" (${t.assignee || '?'})`).join(', ')}.`;
    if (blocked.length > 0) summary += ` BLOCKED: ${blocked.map(t => `"${t.title}" (${t.assignee || '?'})`).join(', ')}.`;
    if (recentDone.length > 0) summary += ` Recently done: ${recentDone.length} task(s).`;
    summary += ' Each agent: report what you did, what\'s blocked, what\'s next. Then call listen_group().';

    broadcastSystemMessage(summary, registeredName);
  } catch {}
}

// Auto-recovery: snapshot dead agent state before cleanup
// Creates recovery-{name}.json so replacement agent can resume
function snapshotDeadAgents(agents) {
  for (const [name, info] of Object.entries(agents)) {
    if (name === registeredName) continue; // skip self
    if (isPidAlive(info.pid, info.last_activity)) continue; // skip alive
    const agentBranch = info.branch || 'main';
    const recoveryFile = path.join(DATA_DIR, `recovery-${name}.json`);
    let interruptedSession = null;

    try {
      interruptedSession = sessionsState.transitionLatestSessionForAgent({
        agentName: name,
        branchName: agentBranch,
        state: 'interrupted',
        reason: 'dead_agent_snapshot',
        recoverySnapshotFile: path.basename(recoveryFile),
      }).session;
    } catch {}

    if (fs.existsSync(recoveryFile)) continue; // already snapshotted
    try {
      const allTasks = getTasks();
      const tasks = allTasks.filter(t => t.assignee === name && (t.status === 'in_progress' || t.status === 'pending'));
      const locks = getLocks();
      const lockedFiles = Object.entries(locks).filter(([, l]) => l.agent === name).map(([f]) => f);
      const channels = getAgentChannels(name, agentBranch);
      const workspace = getWorkspace(name, agentBranch);
      // Scale fix: tail-read last 50 messages instead of entire history
      const history = tailReadJsonl(getHistoryFile(agentBranch), 50);
      const lastSent = history.filter(m => m.from === name).slice(-5).map(m => ({ to: m.to, content: m.content.substring(0, 200), timestamp: m.timestamp }));
      // Agent memory: decisions made, tasks completed, KB keys written
      const decisions = getDecisions(agentBranch);
      const myDecisions = decisions.filter(d => d.decided_by === name).slice(-10).map(d => ({ decision: d.decision, reasoning: (d.reasoning || '').substring(0, 150), decided_at: d.decided_at }));
      const completedTasks = allTasks.filter(t => t.assignee === name && t.status === 'done').slice(-10).map(t => ({ id: t.id, title: t.title }));
      const kb = getKB(agentBranch);
      const kbKeysWritten = Object.keys(kb).filter(k => kb[k] && kb[k].updated_by === name);
      // Only snapshot if there's meaningful state to recover
      if (tasks.length > 0 || lockedFiles.length > 0 || Object.keys(workspace).length > 0 || myDecisions.length > 0 || completedTasks.length > 0 || interruptedSession) {
        writeJsonFile(recoveryFile, {
          agent: name,
          branch: agentBranch,
          session_id: interruptedSession ? interruptedSession.session_id : null,
          session_state: interruptedSession ? interruptedSession.state : null,
          died_at: new Date().toISOString(),
          active_tasks: tasks.map(t => ({ id: t.id, title: t.title, status: t.status, description: (t.description || '').substring(0, 300) })),
          locked_files: lockedFiles,
          channels: channels.filter(c => c !== 'general'),
          workspace_keys: Object.keys(workspace),
          last_messages_sent: lastSent,
          decisions_made: myDecisions,
          tasks_completed: completedTasks,
          kb_entries_written: kbKeysWritten,
        });
      }
    } catch {}

    // Quality Lead instant failover: if dead agent was Quality Lead, promote replacement immediately
    try {
      const profiles = getProfiles();
      if (profiles[name] && profiles[name].role === 'quality') {
        // Find best replacement: highest reputation score among alive agents
        const rep = readJsonFile(REPUTATION_FILE) || {};
        const aliveNames = Object.entries(agents)
          .filter(([n, a]) => n !== name && isPidAlive(a.pid, a.last_activity))
          .map(([n]) => n);

        if (aliveNames.length > 0) {
          // Sort by reputation (tasks completed), pick best
          const scored = aliveNames.map(n => ({
            name: n,
            score: rep[n] ? (rep[n].tasks_completed || 0) + (rep[n].reviews_submitted || 0) : 0,
          })).sort((a, b) => b.score - a.score);
          const newQuality = scored[0].name;

          profiles[newQuality].role = 'quality';
          profiles[newQuality].role_description = 'You review ALL work, find bugs, suggest improvements, and keep the team iterating. Never approve without checking. (Auto-promoted after previous Quality Lead disconnected.)';
          profiles[name].role = ''; // Clear dead agent's role
          saveProfiles(profiles);

          sendSystemMessage(newQuality,
            `[QUALITY LEAD FAILOVER] ${name} went offline. You have been auto-promoted to Quality Lead. Review ALL work, find bugs, suggest improvements. You are now the approval gate.`
          );
          broadcastSystemMessage(`[QUALITY LEAD FAILOVER] ${name} (Quality Lead) went offline. ${newQuality} has been auto-promoted to Quality Lead.`, newQuality);
        }
      }

      // Monitor Agent failover: if dead agent was Monitor, promote replacement
      if (profiles[name] && profiles[name].role === 'monitor') {
        const aliveNames2 = Object.entries(agents)
          .filter(([n, a]) => n !== name && isPidAlive(a.pid, a.last_activity))
          .map(([n]) => n);
        if (aliveNames2.length > 0) {
          const rep2 = readJsonFile(REPUTATION_FILE) || {};
          const scored2 = aliveNames2.map(n => ({
            name: n,
            score: rep2[n] ? (rep2[n].tasks_completed || 0) : 0,
          })).sort((a, b) => b.score - a.score);
          const newMonitor = scored2[0].name;
          profiles[newMonitor].role = 'monitor';
          profiles[newMonitor].role_description = 'You are the MONITOR AGENT (auto-promoted after previous Monitor disconnected). Watch all agents, detect problems, intervene.';
          profiles[name].role = '';
          saveProfiles(profiles);
          sendSystemMessage(newMonitor, `[MONITOR FAILOVER] ${name} went offline. You are now the Monitor Agent. Run health checks continuously.`);
          broadcastSystemMessage(`[MONITOR FAILOVER] ${name} (Monitor) went offline. ${newMonitor} has been auto-promoted.`, newMonitor);
        }
      }
    } catch {}
  }
}

// Auto-cleanup dead agent locks (called from heartbeat)
function cleanStaleLocks() {
  const locks = getLocks();
  const agents = getAgents();
  let changed = false;
  for (const [filePath, lock] of Object.entries(locks)) {
    if (!agents[lock.agent] || !isPidAlive(agents[lock.agent].pid, agents[lock.agent].last_activity)) {
      delete locks[filePath];
      changed = true;
    }
  }
  if (changed) writeJsonFile(LOCKS_FILE, locks);
}

// Event hook: fire system messages based on events
function fireEvent(eventName, data) {
  const agents = getAgents();
  const aliveAgents = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));

  switch (eventName) {
    case 'agent_join': {
      // Notify existing agents
      for (const name of aliveAgents) {
        if (name === data.agent) continue;
        sendSystemMessage(name, `[EVENT] ${data.agent} has joined the team. They are now online.`);
      }
      break;
    }
    case 'task_complete': {
      // Notify task creator
      if (data.created_by && data.created_by !== registeredName && agents[data.created_by]) {
        sendSystemMessage(data.created_by, `[EVENT] Task "${data.title}" completed by ${registeredName}.`);
      }
      // Check if all tasks done
      const allTasks = getTasks();
      const pending = allTasks.filter(t => t.status !== 'done');
      if (pending.length === 0 && allTasks.length > 0) {
        broadcastSystemMessage(`[EVENT] All ${allTasks.length} tasks are complete! Consider starting a review phase.`);
      }
      break;
    }
    case 'dependency_met': {
      if (data.notify && agents[data.notify]) {
        sendSystemMessage(data.notify, `[EVENT] Dependency resolved: "${data.task_title}" is done. You can now proceed with your blocked task.`);
      }
      break;
    }
  }
}

function toolGetGuide(level = 'standard') {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!['minimal', 'standard', 'full'].includes(level)) return { error: 'Level must be "minimal", "standard", or "full"' };
  const guide = buildGuide(level);
  guide.your_name = registeredName;
  if (level !== 'minimal') {
    guide.workflow = '1. get_briefing → 2. list_tasks/suggest_task → 3. claim task → 4. lock_file → 5. work → 6. unlock_file → 7. update_task done → 8. listen_group';
  }
  return guide;
}

function toolGetBriefing() {
  if (!registeredName) return { error: 'You must call register() first' };

  const agents = getAgents();
  const profiles = getProfiles();
  const tasks = getTasks();
  const decisions = getDecisions();
  const kb = getKB();
  const progress = getProgressData();
  // Scale fix: tail-read only last 30 messages instead of entire history file
  const history = tailReadJsonl(getHistoryFile(currentBranch), 30);
  const locks = getLocks();
  const config = getConfig();
  const briefingContext = buildAuthoritativeResumeContext({
    agentName: registeredName,
    branchName: currentBranch,
    sessionId: currentSessionId,
    evidenceLimit: 5,
  });
  const checkpointFallbacks = listCheckpointFallbacks(registeredName).slice(0, 5);

  // Agent roster
  const roster = {};
  for (const [name, info] of Object.entries(agents)) {
    const alive = isPidAlive(info.pid, info.last_activity);
    const profile = profiles[name] || {};
    roster[name] = {
      status: !alive ? 'offline' : info.listening_since ? 'listening' : 'working',
      role: profile.role || '',
      provider: info.provider || 'unknown',
    };
  }

  // Recent messages summary (last 15)
  const recentMsgs = history.slice(-15).map(m => ({
    from: m.from, to: m.to,
    preview: m.content.substring(0, 150),
    timestamp: m.timestamp,
  }));

  // Active tasks
  const activeTasks = tasks.filter(t => t.status !== 'done').map(t => ({
    id: t.id, title: t.title, status: t.status, assignee: t.assignee, created_by: t.created_by,
  }));
  const doneTasks = tasks.filter(t => t.status === 'done').length;

  // Locked files
  const lockedFiles = {};
  for (const [fp, lock] of Object.entries(locks)) {
    lockedFiles[fp] = { locked_by: lock.agent, since: lock.since };
  }

  // Session memory: lightweight — only task counts from task system, no history scan
  const myActiveTasks = tasks.filter(t => t.status !== 'done' && t.assignee === registeredName);
  const myCompletedCount = tasks.filter(t => t.status === 'done' && t.assignee === registeredName).length;
  const resumeContext = {};
  if (briefingContext.active_step) resumeContext.active_step = briefingContext.active_step;
  if (briefingContext.upcoming_step) resumeContext.upcoming_step = briefingContext.upcoming_step;
  if (briefingContext.dependency_evidence.length > 0) resumeContext.dependency_evidence = briefingContext.dependency_evidence;
  if (briefingContext.recent_evidence.length > 0) resumeContext.recent_evidence = briefingContext.recent_evidence;

  let hint = 'You are now briefed. Check active tasks and start contributing.';
  if (briefingContext.active_step) {
    hint = `Session ${briefingContext.session_summary ? briefingContext.session_summary.session_id : currentSessionId || 'unknown'} has an active workflow step assigned to you. Resume that work first.`;
  } else if (myActiveTasks.length > 0) {
    hint = `You have ${myActiveTasks.length} active task(s). Continue working.`;
  }
  if (checkpointFallbacks.length > 0) {
    hint += ' Checkpoint fallbacks are attached if you need older WIP notes.';
  }

  const result = {
    briefing: true,
    conversation_mode: config.conversation_mode || 'direct',
    ...(briefingContext.session_summary ? { session_summary: briefingContext.session_summary } : {}),
    ...(Object.keys(resumeContext).length > 0 ? { resume_context: resumeContext } : {}),
    agents: roster,
    your_name: registeredName,
    recent_messages: recentMsgs,
    tasks: { active: activeTasks, completed_count: doneTasks, total: tasks.length },
    decisions: decisions.slice(-5).map(d => ({ decision: d.decision, topic: d.topic })),
    knowledge_base_keys: Object.keys(kb),
    locked_files: lockedFiles,
    progress,
    ...(checkpointFallbacks.length > 0 ? { checkpoint_fallbacks: checkpointFallbacks } : {}),
    your_tasks: myActiveTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
    your_completed: myCompletedCount,
    hint,
  };

  if (config.conversation_mode === 'managed') {
    const managed = getManagedConfig();
    result.managed_context = {
      manager: managed.manager,
      phase: managed.phase,
      floor: managed.floor,
      turn_current: managed.turn_current,
      you_are_manager: managed.manager === registeredName,
      you_have_floor: managed.turn_current === registeredName,
    };
  }

  if (config.conversation_mode === 'managed' || config.conversation_mode === 'group') {
    const briefingSurface = config.conversation_mode === 'managed' && result.managed_context && result.managed_context.you_are_manager
      ? 'manager_briefing'
      : (config.conversation_mode === 'managed' ? 'participant_briefing' : 'team_briefing');
    return attachManagedTeamSurfaceSignals(result, {
      surface: briefingSurface,
      agentName: registeredName,
      branchName: currentBranch,
      includeContractViolation: !!(result.managed_context && result.managed_context.you_are_manager),
      hookLimit: 5,
    });
  }

  return result;
}

function toolLockFile(filePath) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof filePath !== 'string' || filePath.length < 1 || filePath.length > 200) return { error: 'Invalid file path' };

  const normalized = filePath.replace(/\\/g, '/');
  const locks = getLocks();

  if (locks[normalized]) {
    const holder = locks[normalized].agent;
    if (holder === registeredName) return { success: true, message: 'You already hold this lock.', file: normalized };
    // Check if holder is still alive
    const agents = getAgents();
    if (agents[holder] && isPidAlive(agents[holder].pid, agents[holder].last_activity)) {
      return { error: `File "${normalized}" is locked by ${holder} since ${locks[normalized].since}. Wait for them to unlock it or message them.` };
    }
    // Dead holder — take over
  }

  locks[normalized] = { agent: registeredName, since: new Date().toISOString() };
  writeJsonFile(LOCKS_FILE, locks);
  touchActivity();
  return { success: true, file: normalized, message: `File locked. Other agents cannot edit "${normalized}" until you call unlock_file().` };
}

function toolUnlockFile(filePath) {
  if (!registeredName) return { error: 'You must call register() first' };
  const normalized = (filePath || '').replace(/\\/g, '/');
  const locks = getLocks();

  if (!filePath) {
    // Unlock ALL files held by this agent
    let count = 0;
    for (const [fp, lock] of Object.entries(locks)) {
      if (lock.agent === registeredName) { delete locks[fp]; count++; }
    }
    writeJsonFile(LOCKS_FILE, locks);
    return { success: true, unlocked: count, message: `Unlocked ${count} file(s).` };
  }

  if (!locks[normalized]) return { success: true, message: 'File was not locked.' };
  if (locks[normalized].agent !== registeredName) return { error: `File is locked by ${locks[normalized].agent}, not you.` };

  delete locks[normalized];
  writeJsonFile(LOCKS_FILE, locks);
  return { success: true, file: normalized, message: 'File unlocked.' };
}

function toolLogDecision(decision, reasoning, topic) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof decision !== 'string' || decision.length < 1 || decision.length > 500) return { error: 'Decision must be 1-500 chars' };

  const entry = {
    id: 'dec_' + generateId(),
    decision,
    reasoning: (reasoning || '').substring(0, 1000),
    topic: (topic || 'general').substring(0, 50),
    decided_by: registeredName,
    decided_at: new Date().toISOString(),
  };
  const logged = canonicalState.logDecision({
    entry,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: entry.id,
    maxEntries: 200,
  });
  if (logged.error) return logged;
  touchActivity();
  return { success: true, decision_id: entry.id, message: 'Decision logged. Other agents can see it via get_decisions() or get_briefing().' };
}

function toolGetDecisions(topic) {
  let decisions = getDecisions();
  if (topic) decisions = decisions.filter(d => d.topic === topic);
  return { count: decisions.length, decisions: decisions.slice(-30) };
}

// --- Tier 2: Knowledge Base, Progress, Event hooks ---

function toolKBWrite(key, content) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof key !== 'string' || key.length < 1 || key.length > 50) return { error: 'Key must be 1-50 chars' };
  if (!/^[a-zA-Z0-9_\-\.]+$/.test(key)) return { error: 'Key must be alphanumeric/underscore/hyphen/dot' };
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 102400) return { error: 'Content exceeds 100KB' };

  const written = canonicalState.writeKnowledgeBaseEntry({
    key,
    value: { content, updated_by: registeredName, updated_at: new Date().toISOString() },
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: key,
    maxEntries: 100,
  });
  if (written.error) return { error: written.error };
  touchActivity();
  return { success: true, key, size: content.length, total_keys: written.total_keys };
}

function toolKBRead(key) {
  const kb = getKB();
  if (key) {
    if (!kb[key]) return { error: `Key "${key}" not found in knowledge base` };
    return { key, content: kb[key].content, updated_by: kb[key].updated_by, updated_at: kb[key].updated_at };
  }
  // Return all entries
  const entries = {};
  for (const [k, v] of Object.entries(kb)) {
    entries[k] = { content: v.content, updated_by: v.updated_by, updated_at: v.updated_at };
  }
  return { entries, total_keys: Object.keys(kb).length };
}

function toolKBList() {
  const kb = getKB();
  return {
    keys: Object.keys(kb).map(k => ({ key: k, updated_by: kb[k].updated_by, updated_at: kb[k].updated_at, size: kb[k].content.length })),
    total: Object.keys(kb).length,
  };
}

function toolUpdateProgress(feature, percent, notes) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof feature !== 'string' || feature.length < 1 || feature.length > 100) return { error: 'Feature name must be 1-100 chars' };
  if (typeof percent !== 'number' || percent < 0 || percent > 100) return { error: 'Percent must be 0-100' };

  const updated = canonicalState.updateProgressRecord({
    feature,
    value: {
      percent,
      notes: (notes || '').substring(0, 500),
      updated_by: registeredName,
      updated_at: new Date().toISOString(),
    },
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: feature,
  });
  if (updated.error) return updated;
  touchActivity();
  return { success: true, feature, percent, message: `Progress updated: ${feature} is ${percent}% complete.` };
}

function toolGetProgress() {
  const progress = getProgressData();
  const features = Object.entries(progress).map(([name, p]) => ({
    feature: name, percent: p.percent, notes: p.notes, updated_by: p.updated_by, updated_at: p.updated_at,
  }));
  const avg = features.length > 0 ? Math.round(features.reduce((s, f) => s + f.percent, 0) / features.length) : 0;
  return { features, overall_percent: avg, feature_count: features.length };
}

// --- Tier 3: Voting, Code Review, Dependencies ---

function toolCallVote(question, options) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof question !== 'string' || question.length < 1 || question.length > 200) return { error: 'Question must be 1-200 chars' };
  if (!Array.isArray(options) || options.length < 2 || options.length > 10) return { error: 'Need 2-10 options' };

  const vote = {
    id: 'vote_' + generateId(),
    question,
    options: options.map(o => String(o).substring(0, 50)),
    votes: {},
    status: 'open',
    created_by: registeredName,
    created_at: new Date().toISOString(),
  };
  const created = canonicalState.createVote({
    vote,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: vote.id,
    maxEntries: 500,
  });
  if (created.error) return created;

  // Notify all agents
  broadcastSystemMessage(`[VOTE] ${registeredName} started a vote: "${question}" — Options: ${vote.options.join(', ')}. Call cast_vote("${vote.id}", "your_choice") to vote.`, registeredName);
  touchActivity();
  return { success: true, vote_id: vote.id, question, options: vote.options, message: 'Vote created. All agents have been notified.' };
}

function toolCastVote(voteId, choice) {
  if (!registeredName) return { error: 'You must call register() first' };

  const agents = getAgents();
  const onlineAgents = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
  const cast = canonicalState.castVote({
    voteId,
    voter: registeredName,
    choice,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: voteId,
    onlineAgents,
  });
  if (cast.error) return cast;

  const vote = cast.vote || {};
  if (vote.status === 'closed' && vote.results) {
    const winner = Object.entries(vote.results).sort((a, b) => b[1] - a[1])[0];
    if (winner) {
      broadcastSystemMessage(`[VOTE RESULT] "${vote.question}" — Winner: ${winner[0]} (${winner[1]} votes). Full results: ${JSON.stringify(vote.results)}`);
    }
  }

  touchActivity();
  return { success: true, vote_id: voteId, your_vote: choice, status: vote.status, votes_cast: Object.keys(vote.votes).length, agents_online: onlineAgents.length };
}

function toolVoteStatus(voteId) {
  const votes = getVotes();
  if (voteId) {
    const vote = votes.find(v => v.id === voteId);
    if (!vote) return { error: `Vote not found: ${voteId}` };
    return { vote };
  }
  return { votes: votes.map(v => ({ id: v.id, question: v.question, status: v.status, votes_cast: Object.keys(v.votes).length, results: v.results || null })) };
}

function toolRequestReview(filePath, description) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof filePath !== 'string' || filePath.length < 1) return { error: 'File path required' };

  const review = {
    id: 'rev_' + generateId(),
    file: filePath.replace(/\\/g, '/'),
    description: (description || '').substring(0, 500),
    status: 'pending',
    requested_by: registeredName,
    requested_at: new Date().toISOString(),
    reviewer: null,
    feedback: null,
  };
  const reviewWrite = canonicalState.mutateReviews((reviews) => {
    if (reviews.length >= 500) return { error: 'Review limit reached (max 500).' };
    reviews.push(review);
    return { success: true, review };
  }, { branch: currentBranch });
  if (reviewWrite && reviewWrite.error) return reviewWrite;

  canonicalState.appendCanonicalEvent({
    type: 'review.requested',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: review.id,
    payload: {
      review_id: review.id,
      file: review.file,
      description: review.description,
      requested_by: review.requested_by,
      requested_at: review.requested_at,
      status: review.status,
    },
  });

  // Notify all other agents
  broadcastSystemMessage(`[REVIEW] ${registeredName} requests review of "${review.file}": ${review.description || 'No description'}. Call submit_review("${review.id}", "approved"/"changes_requested", "your feedback") to review.`, registeredName);
  touchActivity();
  return { success: true, review_id: review.id, file: review.file, message: 'Review requested. Team has been notified.' };
}

function toolSubmitReview(reviewId, status, feedback) {
  if (!registeredName) return { error: 'You must call register() first' };

  const validStatuses = ['approved', 'changes_requested'];
  if (!validStatuses.includes(status)) return { error: `Status must be: ${validStatuses.join(' or ')}` };

  const reviewUpdate = canonicalState.mutateReviews((reviews) => {
    const review = reviews.find(r => r.id === reviewId);
    if (!review) return { error: `Review not found: ${reviewId}` };
    if (review.requested_by === registeredName) return { error: 'Cannot review your own code.' };

    review.status = status;
    review.reviewer = registeredName;
    review.feedback = (feedback || '').substring(0, 2000);
    review.reviewed_at = new Date().toISOString();

    if (status === 'changes_requested') {
      review.review_round = (review.review_round || 0) + 1;
      if (review.review_round > 2) {
        review.status = 'approved';
        review.auto_approved = true;
        review.auto_approve_reason = `Auto-approved after ${review.review_round} review rounds (max 2 rounds exceeded).`;
      }
    }

    return { success: true, review };
  }, { branch: currentBranch });
  if (reviewUpdate && reviewUpdate.error) return reviewUpdate;

  const review = reviewUpdate.review;

  // Review → retry loop: track review rounds, auto-route feedback, auto-approve after 2 rounds
  if (status === 'changes_requested') {
    // Item 4: Agent circuit breaker — track consecutive rejections in reputation
    const rep = getReputation();
    if (!rep[review.requested_by]) rep[review.requested_by] = { tasks_completed: 0, reviews_done: 0, messages_sent: 0, consecutive_rejections: 0, first_seen: new Date().toISOString(), last_active: new Date().toISOString(), strengths: [], task_times: [], response_times: [] };
    rep[review.requested_by].consecutive_rejections = (rep[review.requested_by].consecutive_rejections || 0) + 1;
    if (rep[review.requested_by].consecutive_rejections >= 3) {
      rep[review.requested_by].demoted = true;
      rep[review.requested_by].demoted_at = new Date().toISOString();
      sendSystemMessage(review.requested_by, `[CIRCUIT BREAKER] You have ${rep[review.requested_by].consecutive_rejections} consecutive rejections. You are being assigned simpler tasks until your next approval. Focus on smaller, well-tested changes.`);
    }
    writeJsonFile(REPUTATION_FILE, rep);

    // Find associated task (if any) and set retry_expected
    const tasks = getTasks();
    const relatedTask = tasks.find(t => t.title && review.file && t.title.includes(review.file)) ||
                        tasks.find(t => t.assignee === review.requested_by && t.status === 'in_progress');
    if (relatedTask) {
      relatedTask.retry_expected = true;
      relatedTask.review_feedback = review.feedback;
      relatedTask.review_round = review.review_round;
      if (review.review_round >= 2) {
        relatedTask.auto_approve_next = true; // 3rd submission auto-approves
      }
      saveTasks(tasks);
    }

    // Auto-route feedback to author with round info
    const roundMsg = `[REVIEW FEEDBACK] ${registeredName} requested changes on "${review.file}": ${review.feedback}. Fix and re-submit. This is review round ${review.review_round}/2.` +
      (review.review_round >= 2 ? ' FINAL ROUND — next submission will be auto-approved.' : '');
    sendSystemMessage(review.requested_by, roundMsg);
  } else {
    // Approved — reset consecutive rejections (Item 4: circuit breaker reset)
    const rep = getReputation();
    if (rep[review.requested_by]) {
      rep[review.requested_by].consecutive_rejections = 0;
      rep[review.requested_by].demoted = false;
      writeJsonFile(REPUTATION_FILE, rep);
    }
    // Notify requester
    const agents = getAgents();
    if (agents[review.requested_by]) {
      sendSystemMessage(review.requested_by, `[REVIEW] ${registeredName} approved "${review.file}": ${review.feedback || 'Looks good!'}`);
    }
  }

  // Auto-approve check: if this is a re-submission and auto_approve_next is set
  if (status === 'changes_requested' && review.auto_approved) {
    sendSystemMessage(review.requested_by, `[REVIEW] "${review.file}" auto-approved after ${review.review_round} review rounds. Flagged for later human review.`);
  }

  canonicalState.appendCanonicalEvent({
    type: 'review.submitted',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: review.id,
    payload: {
      review_id: review.id,
      file: review.file,
      requested_by: review.requested_by,
      reviewer: review.reviewer,
      status: review.status,
      feedback: review.feedback,
      review_round: review.review_round || 0,
      auto_approved: !!review.auto_approved,
      reviewed_at: review.reviewed_at || null,
    },
  });
  touchActivity();

  const result = { success: true, review_id: reviewId, status: review.status, message: `Review submitted: ${review.status}` };
  if (review.review_round) result.review_round = review.review_round;
  if (review.auto_approved) result.auto_approved = true;
  return result;
}

function toolDeclareDependency(taskId, dependsOnTaskId) {
  if (!registeredName) return { error: 'You must call register() first' };

  const tasks = getTasks();
  const task = tasks.find(t => t.id === taskId);
  const depTask = tasks.find(t => t.id === dependsOnTaskId);
  if (!task) return { error: `Task not found: ${taskId}` };
  if (!depTask) return { error: `Dependency task not found: ${dependsOnTaskId}` };

  const dependency = {
    id: 'dep_' + generateId(),
    task_id: taskId,
    depends_on: dependsOnTaskId,
    declared_by: registeredName,
    declared_at: new Date().toISOString(),
    resolved: depTask.status === 'done',
    resolved_at: depTask.status === 'done' ? new Date().toISOString() : null,
    resolved_by: depTask.status === 'done' ? registeredName : null,
  };
  const dependencyWrite = canonicalState.mutateDependencies((deps) => {
    if (deps.length >= 1000) return { error: 'Dependency limit reached (max 1000).' };
    deps.push(dependency);
    return { success: true, dependency };
  }, { branch: currentBranch });
  if (dependencyWrite && dependencyWrite.error) return dependencyWrite;

  const declaredEvent = canonicalState.appendCanonicalEvent({
    type: 'dependency.declared',
    branchId: currentBranch,
    actorAgent: registeredName,
    sessionId: currentSessionId,
    correlationId: dependency.id,
    payload: {
      dependency_id: dependency.id,
      task_id: dependency.task_id,
      depends_on: dependency.depends_on,
      declared_by: dependency.declared_by,
      declared_at: dependency.declared_at,
      resolved: dependency.resolved,
    },
  });
  if (dependency.resolved) {
    canonicalState.appendCanonicalEvent({
      type: 'dependency.resolved',
      branchId: currentBranch,
      actorAgent: registeredName,
      sessionId: currentSessionId,
      causationId: declaredEvent.event_id,
      correlationId: dependency.id,
      payload: {
        dependency_id: dependency.id,
        task_id: dependency.task_id,
        depends_on: dependency.depends_on,
        resolved_at: dependency.resolved_at,
        resolved_by: dependency.resolved_by,
        resolved_by_task_id: depTask.id,
        reason: 'dependency_already_satisfied',
      },
    });
  }
  touchActivity();

  if (depTask.status === 'done') {
    return { success: true, message: `Dependency declared but already resolved — "${depTask.title}" is done. You can proceed.` };
  }
  return { success: true, message: `Dependency declared: "${task.title}" is blocked until "${depTask.title}" is done. You'll be notified when it completes.` };
}

function toolCheckDependencies(taskId) {
  const deps = getDeps();
  const tasks = getTasks();

  if (taskId) {
    const taskDeps = deps.filter(d => d.task_id === taskId);
    return {
      task_id: taskId,
      dependencies: taskDeps.map(d => {
        const t = tasks.find(t2 => t2.id === d.depends_on);
        return { depends_on: d.depends_on, title: t ? t.title : 'unknown', status: t ? t.status : 'unknown', resolved: t ? t.status === 'done' : false };
      }),
    };
  }
  // All unresolved deps
  const unresolved = deps.filter(d => {
    const t = tasks.find(t2 => t2.id === d.depends_on);
    return t && t.status !== 'done';
  });
  return { unresolved_count: unresolved.length, unresolved: unresolved.map(d => ({ task_id: d.task_id, blocked_by: d.depends_on })) };
}

// --- Conversation Compression ---

function getCompressed(branch = currentBranch) {
  return readJsonFile(getCompressedFile(branch)) || { segments: [], last_compressed_at: null };
}

// Compress old messages into summary segments
// Keeps last 20 verbatim, groups older messages into topic summaries
function autoCompress() {
  // Quick size check: skip reading small files (~300 bytes/msg * 50 msgs = ~15KB)
  const histFile = getHistoryFile(currentBranch);
  if (!fs.existsSync(histFile)) return;
  const histStat = fs.statSync(histFile);
  if (histStat.size < 15000) return; // too small to need compression
  const history = readJsonl(histFile);
  if (history.length <= 50) return; // only compress when conversation is long

  const compressed = getCompressed(currentBranch);
  const cutoff = history.length - 20; // keep last 20 verbatim
  const toCompress = history.slice(compressed.segments.length > 0 ? compressed.segments.reduce((s, seg) => s + seg.message_count, 0) : 0, cutoff);
  if (toCompress.length < 10) return; // not enough new messages to compress

  // Group messages into chunks of ~10 and create summaries
  const chunkSize = 10;
  for (let i = 0; i < toCompress.length; i += chunkSize) {
    const chunk = toCompress.slice(i, i + chunkSize);
    const speakers = [...new Set(chunk.map(m => m.from))];
    const topics = chunk.map(m => {
      const preview = m.content.substring(0, 80).replace(/\n/g, ' ');
      return `${m.from}: ${preview}`;
    });
    const segment = {
      id: 'seg_' + generateId(),
      from_time: chunk[0].timestamp,
      to_time: chunk[chunk.length - 1].timestamp,
      message_count: chunk.length,
      speakers,
      summary: topics.join(' | '),
      first_msg_id: chunk[0].id,
      last_msg_id: chunk[chunk.length - 1].id,
    };
    compressed.segments.push(segment);
  }

  // Cap segments at 100
  if (compressed.segments.length > 100) compressed.segments = compressed.segments.slice(-100);
  compressed.last_compressed_at = new Date().toISOString();
  compressed.total_original_messages = history.length;
  writeJsonFile(getCompressedFile(currentBranch), compressed);
}

function toolGetCompressedHistory() {
  if (!registeredName) return { error: 'You must call register() first' };

  const compressed = getCompressed(currentBranch);
  const recent = tailReadJsonl(getHistoryFile(currentBranch), 20);

  return {
    compressed_segments: compressed.segments.slice(-20).map(s => ({
      time_range: s.from_time + ' to ' + s.to_time,
      speakers: s.speakers,
      message_count: s.message_count,
      summary: s.summary,
    })),
    recent_messages: recent.map(m => ({
      id: m.id, from: m.from, to: m.to,
      content: m.content.substring(0, 300),
      timestamp: m.timestamp,
    })),
    total_messages: compressed.segments.reduce((s, seg) => s + seg.message_count, 0) + recent.length,
    compressed_count: compressed.segments.reduce((s, seg) => s + seg.message_count, 0),
    recent_count: recent.length,
    hint: 'Compressed segments summarize older messages. Recent messages are shown verbatim.',
  };
}

// --- Agent Reputation ---

function getReputation() { return cachedRead('reputation', () => readJsonFile(REPUTATION_FILE) || {}, 2000); }

function trackReputation(agent, action) {
  const rep = getReputation();
  if (!rep[agent]) {
    rep[agent] = {
      tasks_completed: 0, tasks_created: 0, reviews_done: 0, reviews_requested: 0,
      bugs_found: 0, messages_sent: 0, decisions_made: 0, votes_cast: 0,
      kb_contributions: 0, files_shared: 0, first_seen: new Date().toISOString(),
      last_active: new Date().toISOString(), strengths: [],
      task_times: [], // completion times in seconds for avg calculation
      response_times: [], // time between being addressed and responding
    };
  }
  const r = rep[agent];
  r.last_active = new Date().toISOString();

  switch (action) {
    case 'task_complete': r.tasks_completed++; break;
    case 'task_create': r.tasks_created++; break;
    case 'review_submit': r.reviews_done++; break;
    case 'review_request': r.reviews_requested++; break;
    case 'message_send': r.messages_sent++; break;
    case 'decision_log': r.decisions_made++; break;
    case 'vote_cast': r.votes_cast++; break;
    case 'kb_write': r.kb_contributions++; break;
    case 'file_share': r.files_shared++; break;
    case 'bug_found': r.bugs_found++; break;
    case 'retry': r.retries = (r.retries || 0) + 1; break;
    case 'watchdog_nudge': r.watchdog_nudges = (r.watchdog_nudges || 0) + 1; break;
    case 'help_given': r.help_given = (r.help_given || 0) + 1; break;
  }

  // Track task completion time if metadata provided
  if (action === 'task_complete' && arguments[2]) {
    const taskTime = arguments[2]; // seconds
    if (!r.task_times) r.task_times = [];
    r.task_times.push(taskTime);
    if (r.task_times.length > 50) r.task_times = r.task_times.slice(-50); // keep last 50
  }

  // Auto-detect strengths based on stats
  r.strengths = [];
  if (r.tasks_completed >= 3) r.strengths.push('productive');
  if (r.reviews_done >= 2) r.strengths.push('reviewer');
  if (r.decisions_made >= 2) r.strengths.push('decision-maker');
  if (r.kb_contributions >= 3) r.strengths.push('documenter');
  if (r.tasks_created >= 3) r.strengths.push('organizer');
  if (r.bugs_found >= 2) r.strengths.push('bug-hunter');

  writeJsonFile(REPUTATION_FILE, rep);
}

// Reputation score: higher = more trusted agent, used for task assignment priority
function getReputationScore(agentName) {
  const rep = getReputation();
  const r = rep[agentName];
  if (!r) return 0;
  return (r.tasks_completed || 0) * 2
    + (r.reviews_done || 0) * 1
    + (r.help_given || 0) * 3
    + (r.kb_contributions || 0) * 1
    - (r.retries || 0) * 1
    - (r.watchdog_nudges || 0) * 2;
}

function toolGetReputation(agent) {
  const rep = getReputation();

  if (agent) {
    if (!rep[agent]) return { agent, message: 'No reputation data yet for this agent.' };
    return { agent, reputation: rep[agent] };
  }

  // All agents with ranking
  const leaderboard = Object.entries(rep).map(([name, r]) => {
    const avgTaskTime = r.task_times && r.task_times.length > 0
      ? Math.round(r.task_times.reduce((a, b) => a + b, 0) / r.task_times.length) : null;
    return {
      agent: name,
      score: r.tasks_completed * 10 + r.reviews_done * 5 + r.decisions_made * 3 + r.kb_contributions * 2 + r.bugs_found * 8,
      tasks_completed: r.tasks_completed,
      reviews_done: r.reviews_done,
      strengths: r.strengths,
      avg_task_time_sec: avgTaskTime,
      messages_sent: r.messages_sent,
      last_active: r.last_active,
    };
  }).sort((a, b) => b.score - a.score);

  return { leaderboard, total_agents: leaderboard.length };
}

function toolSuggestTask() {
  if (!registeredName) return { error: 'You must call register() first' };

  const rep = getReputation();
  const myRep = rep[registeredName];
  const profiles = getProfiles();
  const contract = resolveAgentContract(profiles[registeredName] || {});
  const tasks = getTasks();
  const reviews = getReviews();
  const pendingReviews = reviews.filter(r => r.status === 'pending' && r.requested_by !== registeredName);
  const pendingTasks = tasks.filter(t => t.status === 'pending' && !t.assignee);
  const unassignedTasks = tasks.filter(t => t.status === 'pending');

  if (pendingTasks.length === 0 && unassignedTasks.length === 0) {
    if (pendingReviews.length > 0) {
      return attachContractAdvisory({ suggestion: 'review', review_id: pendingReviews[0].id, file: pendingReviews[0].file, message: `No pending tasks, but there's a code review waiting: "${pendingReviews[0].file}". Call submit_review() to review it.` }, contract, {
        work_type: 'review',
        title: pendingReviews[0].file,
        description: pendingReviews[0].description || '',
      });
    }
    // Check deps
    const deps = getDeps();
    const unresolved = deps.filter(d => !d.resolved);
    if (unresolved.length > 0) {
      return attachContractAdvisory({ suggestion: 'unblock', message: `No tasks available, but ${unresolved.length} task(s) are blocked by dependencies. Check if you can help resolve them.` }, contract, {
        work_type: 'unblock',
        title: 'Blocked dependency work',
        description: `${unresolved.length} unresolved dependency records`,
      });
    }
    return attachContractAdvisory({ suggestion: 'none', message: 'No pending tasks, reviews, or blocked items. Ask the team what needs doing next.' }, contract, {
      work_type: 'idle',
      title: 'No pending work',
    });
  }

  // Check current workload — don't suggest new tasks if already overloaded
  const myActiveTasks = tasks.filter(t => t.assignee === registeredName && t.status === 'in_progress');
  if (myActiveTasks.length >= 3) {
    return attachContractAdvisory({ suggestion: 'finish_first', your_active_tasks: myActiveTasks.map(t => ({ id: t.id, title: t.title })), message: `You already have ${myActiveTasks.length} tasks in progress. Finish one before taking more.` }, contract, {
      work_type: 'task',
      title: myActiveTasks[0] ? myActiveTasks[0].title : 'Active task load',
      description: `${myActiveTasks.length} tasks already in progress`,
      assigned: true,
    });
  }

  // Suggest based on reputation strengths
  if (myRep && myRep.strengths.includes('reviewer')) {
    if (pendingReviews.length > 0) {
      return attachContractAdvisory({ suggestion: 'review', review_id: pendingReviews[0].id, file: pendingReviews[0].file, message: `Based on your strengths (reviewer), review "${pendingReviews[0].file}".` }, contract, {
        work_type: 'review',
        title: pendingReviews[0].file,
        description: pendingReviews[0].description || '',
      });
    }
  }

  // Smart matching: score tasks by keyword overlap with agent's completed task history
  const myDoneTasks = tasks.filter(t => t.assignee === registeredName && t.status === 'done');
  const myKeywords = new Set();
  for (const t of myDoneTasks) {
    const words = (t.title + ' ' + (t.description || '')).toLowerCase().split(/\W+/).filter(w => w.length > 3);
    words.forEach(w => myKeywords.add(w));
  }

  let suggested = pendingTasks[0] || unassignedTasks[0];
  if (myKeywords.size > 0 && pendingTasks.length > 1) {
    // Score each pending task by keyword overlap
    let bestScore = 0;
    for (const task of pendingTasks) {
      const taskWords = (task.title + ' ' + (task.description || '')).toLowerCase().split(/\W+/).filter(w => w.length > 3);
      const score = taskWords.filter(w => myKeywords.has(w)).length;
      if (score > bestScore) { bestScore = score; suggested = task; }
    }
  }

  // Check for blocked tasks that might be unblockable
  const blockedTasks = tasks.filter(t => t.status === 'blocked');
  if (blockedTasks.length > 0 && pendingTasks.length === 0) {
    return attachContractAdvisory({ suggestion: 'unblock_task', task: { id: blockedTasks[0].id, title: blockedTasks[0].title }, message: `No pending tasks, but "${blockedTasks[0].title}" is blocked. Can you help unblock it?` }, contract, {
      work_type: 'unblock',
      title: blockedTasks[0].title,
      description: blockedTasks[0].description || '',
    });
  }

  return attachContractAdvisory({
    suggestion: 'task',
    task_id: suggested.id,
    title: suggested.title,
    description: suggested.description,
    message: `Suggested: "${suggested.title}". Call update_task("${suggested.id}", "in_progress") to claim it.`,
    ...(myKeywords.size > 0 && { match_reason: 'Based on your completed task history' }),
  }, contract, {
    work_type: 'task',
    title: suggested.title,
    description: suggested.description || '',
  });
}

// --- Rules system: project-level rules visible in dashboard and injected into agent guides ---

function toolAddRule(text, category = 'custom') {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!text || !text.trim()) return { error: 'Rule text cannot be empty' };
  const validCategories = ['safety', 'workflow', 'code-style', 'communication', 'custom'];
  if (!validCategories.includes(category)) return { error: `Category must be one of: ${validCategories.join(', ')}` };

  const rule = {
    id: 'rule_' + generateId(),
    text: text.trim(),
    category,
    created_by: registeredName,
    created_at: new Date().toISOString(),
    active: true,
  };
  const created = canonicalState.addRule({
    rule,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: rule.id,
  });
  if (created.error) return created;
  return { success: true, rule_id: rule.id, message: `Rule added: "${text.substring(0, 80)}". All agents will see this in their guide.` };
}

function toolListRules() {
  const rules = getRules();
  const active = rules.filter(r => r.active);
  const inactive = rules.filter(r => !r.active);
  return {
    rules: active,
    inactive_count: inactive.length,
    total: rules.length,
    categories: [...new Set(active.map(r => r.category))],
  };
}

function toolRemoveRule(ruleId) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!ruleId) return { error: 'rule_id is required' };
  const removed = canonicalState.removeRule({
    ruleId,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: ruleId,
  });
  if (removed.error) return removed;
  return { success: true, removed: removed.rule && removed.rule.text ? removed.rule.text.substring(0, 80) : '', message: 'Rule removed.' };
}

function toolToggleRule(ruleId) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!ruleId) return { error: 'rule_id is required' };
  const toggled = canonicalState.toggleRule({
    ruleId,
    actor: registeredName,
    branch: currentBranch,
    sessionId: currentSessionId,
    correlationId: ruleId,
  });
  if (toggled.error) return toggled;
  return { success: true, rule_id: ruleId, active: toggled.rule.active, message: `Rule ${toggled.rule.active ? 'activated' : 'deactivated'}.` };
}

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '5.4.2' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'register',
        description: 'Register this agent\'s identity. Must be called first. Returns a collaboration guide with all tool categories, critical rules, and workflow patterns — READ IT CAREFULLY before doing anything else. Then call get_briefing() for project context, then listen_group() to join the conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Agent name (1-20 alphanumeric/underscore/hyphen chars)',
            },
            provider: {
              type: 'string',
              description: 'AI provider/CLI name (e.g. "Claude", "OpenAI", "Gemini"). Shown in dashboard.',
            },
          },
          required: ['name'],
        },
      },
      {
        name: 'list_agents',
        description: 'List all registered agents with their status (alive/dead).',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'send_message',
        description: 'Send a message to another agent. Auto-routes when only 2 agents are online; otherwise specify recipient.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The message content to send',
            },
            to: {
              type: 'string',
              description: 'Recipient agent name (optional if only 2 agents online)',
            },
            reply_to: {
              type: 'string',
              description: 'ID of a previous message to thread this reply under (optional)',
            },
            channel: {
              type: 'string',
              description: 'Channel to send to (optional — omit for #general). Use join_channel() first to create channels.',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'wait_for_reply',
        description: 'Block and poll for a message addressed to you. Returns when a message arrives or on timeout. Call again if it times out.',
        inputSchema: {
          type: 'object',
          properties: {
            timeout_seconds: {
              type: 'number',
              description: 'How long to wait in seconds (default: 300)',
            },
            from: {
              type: 'string',
              description: 'Only return messages from this specific agent (optional)',
            },
          },
        },
      },
      {
        name: 'broadcast',
        description: 'Send a message to ALL other registered agents at once. Useful for announcements or coordinating multiple agents.',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The message content to broadcast',
            },
          },
          required: ['content'],
        },
      },
      {
        name: 'listen',
        description: 'Listen for messages indefinitely. Auto-detects conversation mode: in group/managed mode, behaves like listen_group() (returns batched messages with agent statuses). In direct mode, returns one message at a time. Either listen() or listen_group() works in any mode — they auto-delegate to the correct behavior.',
        inputSchema: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Only listen for messages from this specific agent (optional)',
            },
          },
        },
      },
      {
        name: 'listen_codex',
        description: 'ONLY for Codex CLI agents — do NOT use if you are Claude Code or Gemini CLI. Same as listen() but returns after 90 seconds due to Codex tool timeout limits. Claude and Gemini agents must use listen() instead.',
        inputSchema: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Only listen for messages from this specific agent (optional)',
            },
          },
        },
      },
      {
        name: 'assistant',
        description: 'Assistant mode — personal assistant listen loop. Only receives messages from Dashboard (the owner). Returns message with safety context. Full personality files (Soul, Identity, Memory, Skills, Tools, SafetyRules) included on first call and every 15th message (context_refreshed: true). In between, only SafetyRules are sent to save tokens — your earlier context still applies. Use this instead of listen() when registered as an Assistant agent.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'check_messages',
        description: 'Non-blocking PEEK at your inbox — shows message previews but does NOT consume them. Use listen() to actually receive and process messages. Do NOT call this in a loop — it wastes tokens returning the same messages repeatedly. Use listen() instead which blocks efficiently and consumes messages.',
        inputSchema: {
          type: 'object',
          properties: {
            from: {
              type: 'string',
              description: 'Only show messages from this specific agent (optional)',
            },
          },
        },
      },
      {
        name: 'ack_message',
        description: 'Acknowledge that you have processed a message. Lets the sender verify delivery via get_history.',
        inputSchema: {
          type: 'object',
          properties: {
            message_id: {
              type: 'string',
              description: 'ID of the message to acknowledge',
            },
          },
          required: ['message_id'],
        },
      },
      {
        name: 'get_history',
        description: 'Get conversation history. Optionally filter by thread.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Number of recent messages to return (default: 50)',
            },
            thread_id: {
              type: 'string',
              description: 'Filter to only messages in this thread (optional)',
            },
          },
        },
      },
      {
        name: 'handoff',
        description: 'Hand off work to another agent with context. Creates a structured handoff message so the recipient knows they are taking over a task. Use when you are done with your part and another agent should continue.',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Agent to hand off to',
            },
            context: {
              type: 'string',
              description: 'Summary of what was done and what needs to happen next',
            },
          },
          required: ['to', 'context'],
        },
      },
      {
        name: 'share_file',
        description: 'Share a file with another agent. Reads the file and sends its content as a message. Max 100KB.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: {
              type: 'string',
              description: 'Path to the file to share',
            },
            to: {
              type: 'string',
              description: 'Recipient agent (optional if only 2 agents)',
            },
            summary: {
              type: 'string',
              description: 'Optional summary of what the file is and why you are sharing it',
            },
          },
          required: ['file_path'],
        },
      },
      {
        name: 'create_task',
        description: 'Create a task and optionally assign it to another agent. Use for structured work delegation in multi-agent teams.',
        inputSchema: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Short task title' },
            description: { type: 'string', description: 'Detailed task description' },
            assignee: { type: 'string', description: 'Agent to assign to (optional, auto-assigns with 2 agents)' },
          },
          required: ['title'],
        },
      },
      {
        name: 'update_task',
        description: 'Update a task status. Statuses: pending, in_progress, in_review, done, blocked.',
        inputSchema: {
          type: 'object',
          properties: {
            task_id: { type: 'string', description: 'Task ID to update' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'], description: 'New status' },
            notes: { type: 'string', description: 'Optional progress note' },
            evidence: COMPLETION_EVIDENCE_INPUT_SCHEMA,
          },
          required: ['task_id', 'status'],
        },
      },
      {
        name: 'list_tasks',
        description: 'List all tasks, optionally filtered by status or assignee.',
        inputSchema: {
          type: 'object',
          properties: {
            status: { type: 'string', enum: ['pending', 'in_progress', 'done', 'blocked'], description: 'Filter by status' },
            assignee: { type: 'string', description: 'Filter by assignee agent name' },
          },
        },
      },
      {
        name: 'get_summary',
        description: 'Get a condensed summary of the conversation so far. Useful when context is getting long and you need a quick recap of what was discussed.',
        inputSchema: {
          type: 'object',
          properties: {
            last_n: {
              type: 'number',
              description: 'Number of recent messages to summarize (default: 20)',
            },
          },
        },
      },
      {
        name: 'search_messages',
        description: 'Search conversation history by keyword. Returns matching messages with previews. Useful for finding past discussions, decisions, or code references.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search term (min 2 chars)' },
            from: { type: 'string', description: 'Filter by sender agent name (optional)' },
            limit: { type: 'number', description: 'Max results (default: 20, max: 50)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'reset',
        description: 'Clear all data files and start fresh. Automatically archives the conversation before clearing.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // --- Phase 1: Profiles ---
      {
        name: 'update_profile',
        description: 'Update your agent profile (display name, avatar, bio, role, appearance, and optional advisory contract metadata). Profile data is shown in the dashboard and virtual office.',
        inputSchema: {
          type: 'object',
          properties: {
            display_name: { type: 'string', description: 'Display name (max 30 chars)' },
            avatar: { type: 'string', description: 'Avatar URL or data URI (max 64KB)' },
            bio: { type: 'string', description: 'Short bio (max 200 chars)' },
            role: { type: 'string', description: 'Role/title (max 30 chars, e.g. "Architect", "Reviewer")' },
            archetype: { type: 'string', enum: ['generalist', 'coordinator', 'implementer', 'reviewer', 'advisor', 'monitor'], description: 'Optional advisory contract archetype' },
            skills: { type: 'array', items: { type: 'string' }, description: 'Optional advisory contract skills list' },
            contract_mode: { type: 'string', enum: ['advisory', 'strict'], description: 'Contract mode for advisory guidance (default: advisory)' },
            appearance: {
              type: 'object',
              description: 'Character appearance for virtual office visualization',
              properties: {
                head_color: { type: 'string', description: 'Skin/head color hex (e.g. "#FFD5B8")' },
                hair_style: { type: 'string', enum: ['none', 'short', 'spiky', 'long', 'ponytail', 'bob'], description: 'Hair style' },
                hair_color: { type: 'string', description: 'Hair color hex (e.g. "#4A3728")' },
                eye_style: { type: 'string', enum: ['dots', 'anime', 'glasses', 'sleepy'], description: 'Eye style' },
                mouth_style: { type: 'string', enum: ['smile', 'neutral', 'open'], description: 'Mouth style' },
                shirt_color: { type: 'string', description: 'Shirt color hex' },
                pants_color: { type: 'string', description: 'Pants color hex' },
                shoe_color: { type: 'string', description: 'Shoe color hex' },
                glasses: { type: 'string', enum: ['none', 'round', 'square', 'sunglasses'], description: 'Glasses style' },
                glasses_color: { type: 'string', description: 'Glasses frame color hex' },
                headwear: { type: 'string', enum: ['none', 'beanie', 'cap', 'headphones', 'headband'], description: 'Headwear style' },
                headwear_color: { type: 'string', description: 'Headwear color hex' },
                neckwear: { type: 'string', enum: ['none', 'tie', 'bowtie', 'lanyard'], description: 'Neckwear style' },
                neckwear_color: { type: 'string', description: 'Neckwear color hex' },
              },
            },
          },
        },
      },
      // --- Phase 2: Workspaces ---
      {
        name: 'workspace_write',
        description: 'Write a key-value entry to your workspace. Other agents can read your workspace but only you can write to it. Max 50 keys, 100KB per value.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Key name (1-50 alphanumeric/underscore/hyphen/dot chars)' },
            content: { type: 'string', description: 'Content to store (max 100KB)' },
          },
          required: ['key', 'content'],
        },
      },
      {
        name: 'workspace_read',
        description: 'Read workspace entries. Read your own or another agent\'s workspace. Omit key to read all entries.',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Specific key to read (optional — omit for all keys)' },
            agent: { type: 'string', description: 'Agent whose workspace to read (optional — defaults to yourself)' },
          },
        },
      },
      {
        name: 'workspace_list',
        description: 'List workspace keys. Specify agent for one workspace, or omit for all agents\' workspace summaries.',
        inputSchema: {
          type: 'object',
          properties: {
            agent: { type: 'string', description: 'Agent name (optional — omit for all)' },
          },
        },
      },
      // --- Phase 3: Workflows ---
      {
        name: 'create_workflow',
        description: 'Create a multi-step workflow pipeline. Each step can have a description, assignee, and depends_on (step IDs). Set autonomous=true for proactive work loop (agents auto-advance, no human gates). Set parallel=true to run independent steps simultaneously.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Workflow name (max 50 chars)' },
            steps: {
              type: 'array',
              description: 'Array of steps. Each step is a string (description) or {description, assignee, depends_on: [stepIds]}.',
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'object', properties: { description: { type: 'string' }, assignee: { type: 'string' }, depends_on: { type: 'array', items: { type: 'number' }, description: 'Step IDs this step depends on (must complete first)' } }, required: ['description'] },
                ],
              },
            },
            autonomous: { type: 'boolean', default: false, description: 'If true, agents auto-advance through steps without waiting for approval. Enables proactive work loop, relaxed send limits, fast cooldowns, and 30s listen cap.' },
            parallel: { type: 'boolean', default: false, description: 'If true, steps with met dependencies run in parallel (multiple agents work simultaneously)' },
          },
          required: ['name', 'steps'],
        },
      },
      {
        name: 'advance_workflow',
        description: 'Mark the current step as done with structured evidence and start the next step. Auto-sends a handoff message to the next assignee.',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID' },
            notes: { type: 'string', description: 'Optional completion notes (max 500 chars)' },
            evidence: COMPLETION_EVIDENCE_INPUT_SCHEMA,
          },
          required: ['workflow_id'],
        },
      },
      {
        name: 'workflow_status',
        description: 'Get status of a specific workflow or all workflows. Shows step progress and completion percentage.',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID (optional — omit for all workflows)' },
          },
        },
      },
      // --- Phase 4: Branching ---
      {
        name: 'fork_conversation',
        description: 'Fork the conversation at a specific message, creating a new branch. History up to that point is copied. You are automatically switched to the new branch.',
        inputSchema: {
          type: 'object',
          properties: {
            from_message_id: { type: 'string', description: 'Message ID to fork from (copies history up to this point)' },
            branch_name: { type: 'string', description: 'Name for the new branch (1-20 alphanumeric chars)' },
          },
          required: ['branch_name'],
        },
      },
      {
        name: 'switch_branch',
        description: 'Switch to a different conversation branch. Your read offset is reset.',
        inputSchema: {
          type: 'object',
          properties: {
            branch_name: { type: 'string', description: 'Branch to switch to' },
          },
          required: ['branch_name'],
        },
      },
      {
        name: 'list_branches',
        description: 'List all conversation branches with message counts and metadata.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'set_conversation_mode',
        description: 'Switch between "direct" (point-to-point), "group" (free multi-agent chat with auto-broadcast), or "managed" (structured turn-taking with a manager who controls who speaks). Use managed mode for 3+ agent teams to prevent chaos.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', description: '"direct" (default), "group" for free chat, or "managed" for structured turn-taking', enum: ['group', 'direct', 'managed'] },
          },
          required: ['mode'],
        },
      },
      {
        name: 'listen_group',
        description: 'Listen for messages in group or managed conversation mode. Auto-detects mode: in direct mode, behaves like listen(). Returns ALL unconsumed messages as a sorted batch (system > threaded > direct > broadcast), plus batch_summary, agent statuses, and hints. Either listen() or listen_group() works in any mode — they auto-delegate. Call again immediately after responding.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      // --- Channels ---
      {
        name: 'join_channel',
        description: 'Join or create a channel. Channels let sub-teams communicate without flooding the main conversation. Auto-joined to #general on register. Use channels when team size > 4.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Channel name (1-20 chars, e.g. "backend", "testing")' }, description: { type: 'string', description: 'Channel description (optional, max 200 chars)' }, rate_limit: { type: 'object', description: 'Optional rate limit config: { max_sends_per_minute: 10 }. Any member can update.', properties: { max_sends_per_minute: { type: 'number' } } } }, required: ['name'] },
      },
      {
        name: 'leave_channel',
        description: 'Leave a channel. You will stop receiving messages from it. Cannot leave #general.',
        inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Channel to leave' } }, required: ['name'] },
      },
      {
        name: 'list_channels',
        description: 'List all channels with members, message counts, and your membership status.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- Briefing & Recovery ---
      {
        name: 'get_guide',
        description: 'Get the collaboration guide — all tool categories, critical rules, and workflow patterns. Call this if you are unsure how to use the tools or need a refresher on best practices. Use level="minimal" for a compact refresher (saves context tokens), "full" for complete reference with tool details.',
        inputSchema: { type: 'object', properties: { level: { type: 'string', enum: ['minimal', 'standard', 'full'], description: 'Guide detail level: "minimal" (~5 rules, saves tokens), "standard" (default, progressive disclosure), "full" (all rules + tool details)' } } },
      },
      {
        name: 'get_briefing',
        description: 'Get a full project briefing: who is online, active tasks, recent decisions, knowledge base, locked files, progress, and project files. Call this when joining a project or after being away. One call = fully onboarded.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- File Locking ---
      {
        name: 'lock_file',
        description: 'Lock a file for exclusive editing. Other agents will be warned if they try to edit it. Call unlock_file() when done. Locks auto-release if you disconnect.',
        inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'Relative path to the file to lock' } }, required: ['file_path'] },
      },
      {
        name: 'unlock_file',
        description: 'Unlock a file you previously locked. Omit file_path to unlock all your files.',
        inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'File to unlock (optional — omit to unlock all)' } } },
      },
      // --- Decision Log ---
      {
        name: 'log_decision',
        description: 'Log a team decision so it persists and other agents can reference it. Prevents re-debating the same choices.',
        inputSchema: { type: 'object', properties: { decision: { type: 'string', description: 'The decision made (max 500 chars)' }, reasoning: { type: 'string', description: 'Why this was decided (optional, max 1000 chars)' }, topic: { type: 'string', description: 'Category like "architecture", "tech-stack", "design" (optional)' } }, required: ['decision'] },
      },
      {
        name: 'get_decisions',
        description: 'Get all logged decisions, optionally filtered by topic.',
        inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'Filter by topic (optional)' } } },
      },
      // --- Knowledge Base ---
      {
        name: 'kb_write',
        description: 'Write to the shared team knowledge base. Any agent can read, any agent can write. Use for API specs, conventions, shared data.',
        inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Key name (1-50 alphanumeric chars)' }, content: { type: 'string', description: 'Content (max 100KB)' } }, required: ['key', 'content'] },
      },
      {
        name: 'kb_read',
        description: 'Read from the shared knowledge base. Omit key to read all entries.',
        inputSchema: { type: 'object', properties: { key: { type: 'string', description: 'Key to read (optional — omit for all)' } } },
      },
      {
        name: 'kb_list',
        description: 'List all keys in the shared knowledge base with metadata.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- Progress Tracking ---
      {
        name: 'update_progress',
        description: 'Update feature-level progress. Higher level than tasks — tracks overall feature completion percentage.',
        inputSchema: { type: 'object', properties: { feature: { type: 'string', description: 'Feature name (max 100 chars)' }, percent: { type: 'number', description: 'Completion percentage 0-100' }, notes: { type: 'string', description: 'Progress notes (optional)' } }, required: ['feature', 'percent'] },
      },
      {
        name: 'get_progress',
        description: 'Get progress on all features with completion percentages and overall project progress.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- Voting ---
      {
        name: 'call_vote',
        description: 'Start a vote for the team to decide something. All online agents are notified and can cast their vote.',
        inputSchema: { type: 'object', properties: { question: { type: 'string', description: 'The question to vote on' }, options: { type: 'array', items: { type: 'string' }, description: 'Array of 2-10 options to choose from' } }, required: ['question', 'options'] },
      },
      {
        name: 'cast_vote',
        description: 'Cast your vote on an open vote. Vote auto-resolves when all online agents have voted.',
        inputSchema: { type: 'object', properties: { vote_id: { type: 'string', description: 'Vote ID' }, choice: { type: 'string', description: 'Your choice (must match one of the options)' } }, required: ['vote_id', 'choice'] },
      },
      {
        name: 'vote_status',
        description: 'Check status of a specific vote or all votes.',
        inputSchema: { type: 'object', properties: { vote_id: { type: 'string', description: 'Vote ID (optional — omit for all)' } } },
      },
      // --- Code Review ---
      {
        name: 'request_review',
        description: 'Request a code review from the team. Creates a review request and notifies all agents.',
        inputSchema: { type: 'object', properties: { file_path: { type: 'string', description: 'File to review' }, description: { type: 'string', description: 'What to focus on in the review' } }, required: ['file_path'] },
      },
      {
        name: 'submit_review',
        description: 'Submit a code review — approve or request changes with feedback.',
        inputSchema: { type: 'object', properties: { review_id: { type: 'string', description: 'Review ID' }, status: { type: 'string', enum: ['approved', 'changes_requested'], description: 'Review result' }, feedback: { type: 'string', description: 'Your review feedback (max 2000 chars)' } }, required: ['review_id', 'status'] },
      },
      // --- Dependencies ---
      {
        name: 'declare_dependency',
        description: 'Declare that a task depends on another task. You will be notified when the dependency is complete.',
        inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'Your task that is blocked' }, depends_on: { type: 'string', description: 'Task ID that must complete first' } }, required: ['task_id', 'depends_on'] },
      },
      {
        name: 'check_dependencies',
        description: 'Check dependency status for a task or all unresolved dependencies.',
        inputSchema: { type: 'object', properties: { task_id: { type: 'string', description: 'Task ID to check (optional — omit for all unresolved)' } } },
      },
      // --- Conversation Compression ---
      {
        name: 'get_compressed_history',
        description: 'Get conversation history with automatic compression. Old messages are summarized into segments, recent messages shown verbatim. Use this when the conversation is long and you need to catch up without overflowing your context.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- Reputation ---
      {
        name: 'get_reputation',
        description: 'View agent reputation — tasks completed, reviews done, bugs found, strengths. Shows leaderboard when called without agent name.',
        inputSchema: { type: 'object', properties: { agent: { type: 'string', description: 'Agent name (optional — omit for leaderboard)' } } },
      },
      {
        name: 'suggest_task',
        description: 'Get a task suggestion based on your strengths, pending tasks, open reviews, and blocked dependencies. Helps you find the most useful thing to do next.',
        inputSchema: { type: 'object', properties: {} },
      },
      // --- Rules tools ---
      {
        name: 'add_rule',
        description: 'Add a project rule that all agents must follow. Rules appear in every agent\'s guide and briefing. Categories: safety, workflow, code-style, communication, custom.',
        inputSchema: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'The rule text' },
            category: { type: 'string', description: 'Rule category: safety, workflow, code-style, communication, custom' },
          },
          required: ['text'],
        },
      },
      {
        name: 'list_rules',
        description: 'List all project rules (active and inactive count).',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'remove_rule',
        description: 'Remove a project rule by ID.',
        inputSchema: {
          type: 'object',
          properties: { rule_id: { type: 'string', description: 'The rule ID to remove' } },
          required: ['rule_id'],
        },
      },
      {
        name: 'toggle_rule',
        description: 'Toggle a rule active/inactive without deleting it.',
        inputSchema: {
          type: 'object',
          properties: { rule_id: { type: 'string', description: 'The rule ID to toggle' } },
          required: ['rule_id'],
        },
      },
      // --- Autonomy Engine tools ---
      {
        name: 'get_work',
        description: 'Get your next work assignment. Call this after completing any task. Returns your highest-priority work item — a workflow step, unassigned task, review request, or help request. If nothing is available, briefly listens for messages (30s max) then checks again. You should NEVER be idle.',
        inputSchema: {
          type: 'object',
          properties: {
            just_completed: { type: 'string', description: 'What you just finished (for context continuity)' },
            available_skills: { type: 'array', items: { type: 'string' }, description: 'What you are good at (e.g., "backend", "testing", "frontend")' },
          },
        },
      },
      {
        name: 'verify_and_advance',
        description: 'Verify your completed work and advance to the next workflow step. You MUST call this when you finish a workflow step — do NOT wait for approval. Self-verify, then auto-advance. Confidence >= 70 auto-advances, 40-69 advances with flag, < 40 broadcasts help request.',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID' },
            summary: { type: 'string', description: 'What you accomplished' },
            verification: { type: 'string', description: 'How you verified it works (tests run, files checked, etc.)' },
            files_changed: { type: 'array', items: { type: 'string' }, description: 'Files created or modified' },
            confidence: { type: 'number', description: '0-100 confidence the work is correct' },
            learnings: { type: 'string', description: 'What you learned that could help future work' },
          },
          required: ['workflow_id', 'summary', 'verification', 'confidence'],
        },
      },
      {
        name: 'retry_with_improvement',
        description: 'When your work failed or was rejected, use this to retry with a different approach. The system tracks your attempts and helps you improve. After 3 failed retries, it auto-escalates to the team. Stores learnings in KB for all agents.',
        inputSchema: {
          type: 'object',
          properties: {
            task_or_step: { type: 'string', description: 'What you were working on' },
            what_failed: { type: 'string', description: 'What went wrong' },
            why_it_failed: { type: 'string', description: 'Your analysis of the root cause' },
            new_approach: { type: 'string', description: 'How you will try differently this time' },
            attempt_number: { type: 'number', description: 'Which retry this is (1, 2, or 3)' },
          },
          required: ['task_or_step', 'what_failed', 'why_it_failed', 'new_approach'],
        },
      },
      {
        name: 'start_plan',
        description: 'Launch a full autonomous plan. Creates the workflow with autonomous mode, assigns agents, and kicks off the first step(s). After calling this, all agents should call get_work() to enter the work loop. This is the one-click way to start a fully autonomous multi-agent plan.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Plan name' },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  description: { type: 'string' },
                  assignee: { type: 'string' },
                  depends_on: { type: 'array', items: { type: 'number' } },
                  timeout_minutes: { type: 'number' },
                },
                required: ['description'],
              },
              description: 'Plan steps (2-30 steps)',
            },
            parallel: { type: 'boolean', description: 'Allow parallel execution of independent steps (default: true)' },
          },
          required: ['name', 'steps'],
        },
      },
      {
        name: 'distribute_prompt',
        description: 'Distribute a user request to the team. The Lead agent breaks it into tasks and creates a workflow. The Quality Lead reviews all work. Use this when a user/dashboard sends a complex request that should be handled by the full team.',
        inputSchema: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The user request or prompt to distribute' },
          },
          required: ['content'],
        },
      },
      // --- Managed mode tools ---
      {
        name: 'claim_manager',
        description: 'Claim the manager role in managed conversation mode. The manager controls who speaks (via yield_floor), sets phases, and can broadcast. Only one manager at a time. If the previous manager disconnected, any agent can claim.',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'yield_floor',
        description: 'Manager-only: give the floor to an agent so they can speak. Use a specific agent name for directed questions, "__open__" for round-robin (each agent takes a turn), or "__close__" to silence everyone. The floor auto-returns to manager after the agent responds.',
        inputSchema: {
          type: 'object',
          properties: {
            to: { type: 'string', description: 'Agent name, "__open__" for round-robin, or "__close__" to close the floor' },
            prompt: { type: 'string', description: 'Optional question or topic for the agent to respond to' },
          },
          required: ['to'],
        },
      },
      {
        name: 'set_phase',
        description: 'Manager-only: set the conversation phase. Phases: "discussion" (manager calls on agents), "planning" (manager assigns tasks), "execution" (agents work independently, only message manager), "review" (agents report results when called on). Each phase sends behavioral instructions to all agents.',
        inputSchema: {
          type: 'object',
          properties: {
            phase: { type: 'string', description: 'Phase name', enum: ['discussion', 'planning', 'execution', 'review'] },
          },
          required: ['phase'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'register':
        result = toolRegister(args.name, args?.provider);
        break;
      case 'list_agents':
        result = toolListAgents();
        break;
      case 'send_message':
        result = await toolSendMessage(args.content, args?.to, args?.reply_to, args?.channel);
        break;
      case 'wait_for_reply':
        result = await toolWaitForReply(args?.timeout_seconds, args?.from);
        break;
      case 'broadcast':
        result = toolBroadcast(args.content);
        break;
      case 'listen':
        result = await toolListen(args?.from);
        break;
      case 'listen_codex':
        result = await toolListenCodex(args?.from);
        break;
      case 'assistant':
        result = await toolAssistant();
        break;
      case 'check_messages':
        result = toolCheckMessages(args?.from);
        break;
      case 'ack_message':
        result = toolAckMessage(args.message_id);
        break;
      case 'get_history':
        result = toolGetHistory(args?.limit, args?.thread_id);
        break;
      case 'create_task':
        result = toolCreateTask(args.title, args?.description, args?.assignee);
        break;
      case 'update_task':
        result = toolUpdateTask(args.task_id, args.status, args?.notes, args?.evidence);
        break;
      case 'list_tasks':
        result = toolListTasks(args?.status, args?.assignee);
        break;
      case 'handoff':
        result = toolHandoff(args.to, args.context);
        break;
      case 'share_file':
        result = toolShareFile(args.file_path, args?.to, args?.summary);
        break;
      case 'get_summary':
        result = toolGetSummary(args?.last_n);
        break;
      case 'search_messages':
        result = toolSearchMessages(args.query, args?.from, args?.limit);
        break;
      case 'reset':
        result = toolReset();
        break;
      case 'update_profile':
        result = toolUpdateProfile(args?.display_name, args?.avatar, args?.bio, args?.role, args?.appearance, args?.archetype, args?.skills, args?.contract_mode);
        break;
      case 'workspace_write':
        result = toolWorkspaceWrite(args.key, args.content);
        break;
      case 'workspace_read':
        result = toolWorkspaceRead(args?.key, args?.agent);
        break;
      case 'workspace_list':
        result = toolWorkspaceList(args?.agent);
        break;
      case 'create_workflow':
        result = toolCreateWorkflow(args.name, args.steps, args?.autonomous, args?.parallel);
        break;
      case 'advance_workflow':
        result = toolAdvanceWorkflow(args.workflow_id, args?.notes, args?.evidence);
        break;
      case 'workflow_status':
        result = toolWorkflowStatus(args?.workflow_id);
        break;
      case 'fork_conversation':
        result = toolForkConversation(args?.from_message_id, args.branch_name);
        break;
      case 'switch_branch':
        result = toolSwitchBranch(args.branch_name);
        break;
      case 'list_branches':
        result = toolListBranches();
        break;
      case 'set_conversation_mode':
        result = toolSetConversationMode(args.mode);
        break;
      case 'listen_group':
        result = await toolListenGroup();
        break;
      case 'join_channel':
        result = toolJoinChannel(args.name, args?.description, args?.rate_limit);
        break;
      case 'leave_channel':
        result = toolLeaveChannel(args.name);
        break;
      case 'list_channels':
        result = toolListChannels();
        break;
      case 'get_guide':
        result = toolGetGuide(args?.level);
        break;
      case 'get_briefing':
        result = toolGetBriefing();
        break;
      case 'lock_file':
        result = toolLockFile(args.file_path);
        break;
      case 'unlock_file':
        result = toolUnlockFile(args?.file_path);
        break;
      case 'log_decision':
        result = toolLogDecision(args.decision, args?.reasoning, args?.topic);
        break;
      case 'get_decisions':
        result = toolGetDecisions(args?.topic);
        break;
      case 'kb_write':
        result = toolKBWrite(args.key, args.content);
        break;
      case 'kb_read':
        result = toolKBRead(args?.key);
        break;
      case 'kb_list':
        result = toolKBList();
        break;
      case 'update_progress':
        result = toolUpdateProgress(args.feature, args.percent, args?.notes);
        break;
      case 'get_progress':
        result = toolGetProgress();
        break;
      case 'call_vote':
        result = toolCallVote(args.question, args.options);
        break;
      case 'cast_vote':
        result = toolCastVote(args.vote_id, args.choice);
        break;
      case 'vote_status':
        result = toolVoteStatus(args?.vote_id);
        break;
      case 'request_review':
        result = toolRequestReview(args.file_path, args?.description);
        break;
      case 'submit_review':
        result = toolSubmitReview(args.review_id, args.status, args?.feedback);
        break;
      case 'declare_dependency':
        result = toolDeclareDependency(args.task_id, args.depends_on);
        break;
      case 'check_dependencies':
        result = toolCheckDependencies(args?.task_id);
        break;
      case 'get_compressed_history':
        result = toolGetCompressedHistory();
        break;
      case 'get_reputation':
        result = toolGetReputation(args?.agent);
        break;
      case 'suggest_task':
        result = toolSuggestTask();
        break;
      case 'add_rule':
        result = toolAddRule(args.text, args.category);
        break;
      case 'list_rules':
        result = toolListRules();
        break;
      case 'remove_rule':
        result = toolRemoveRule(args.rule_id);
        break;
      case 'toggle_rule':
        result = toolToggleRule(args.rule_id);
        break;
      case 'get_work':
        result = await toolGetWork(args || {});
        break;
      case 'verify_and_advance':
        result = await toolVerifyAndAdvance(args);
        break;
      case 'retry_with_improvement':
        result = toolRetryWithImprovement(args);
        break;
      case 'start_plan':
        result = toolStartPlan(args);
        break;
      case 'distribute_prompt':
        result = distributePrompt(args.content, registeredName);
        break;
      case 'claim_manager':
        result = toolClaimManager();
        break;
      case 'yield_floor':
        result = toolYieldFloor(args.to, args?.prompt);
        break;
      case 'set_phase':
        result = toolSetPhase(args.phase);
        break;
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }

    if (result.error) {
      // Stuck detector: track repeated error calls
      const argsHash = JSON.stringify(args || {}).substring(0, 100);
      recentErrorCalls.push({ tool: name, argsHash, timestamp: Date.now() });
      // Keep only last 10 entries, last 60 seconds
      const cutoff = Date.now() - 60000;
      recentErrorCalls = recentErrorCalls.filter(c => c.timestamp > cutoff).slice(-10);
      // Check if last 3 calls are same tool with same args
      const last3 = recentErrorCalls.slice(-3);
      if (last3.length >= 3 && last3.every(c => c.tool === name && c.argsHash === argsHash)) {
        result._stuck_hint = `You have called ${name} 3 times with the same error. Consider: broadcasting for help, trying a different approach, or calling suggest_task() to find other work.`;
      }
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
    }

    // Global hook: on non-listen tools, check for pending messages and nudge with escalating urgency
    // Enhanced nudge: includes sender names, addressed count, and message preview
    const listenTools = ['listen', 'listen_group', 'listen_codex', 'wait_for_reply', 'check_messages'];
    if (registeredName && !listenTools.includes(name) && (isGroupMode() || isManagedMode())) {
      try {
        const pending = getUnconsumedMessages(registeredName);
        if (pending.length > 0 && !result.you_have_messages) {
          // Build rich nudge: WHO sent, WHETHER addressed, WHAT preview
          const senders = {};
          let addressedCount = 0;
          for (const m of pending) {
            senders[m.from] = (senders[m.from] || 0) + 1;
            if (m.addressed_to && m.addressed_to.includes(registeredName)) addressedCount++;
          }
          const senderSummary = Object.entries(senders).map(([n, c]) => `${c} from ${n}`).join(', ');
          const latest = pending[pending.length - 1];
          const preview = latest.content.substring(0, 80).replace(/\n/g, ' ');

          result._pending_messages = pending.length;
          result._senders = senders;
          result._addressed_to_you = addressedCount;
          result._preview = `${latest.from}: "${preview}..."`;

          // Escalate urgency based on oldest pending message age
          const oldestAge = pending.reduce((max, m) => {
            const age = Date.now() - new Date(m.timestamp).getTime();
            return age > max ? age : max;
          }, 0);
          const ageSec = Math.round(oldestAge / 1000);
          const addressedHint = addressedCount > 0 ? ` (${addressedCount} addressed to you)` : '';
          if (ageSec > 120) {
            result._nudge = `CRITICAL: ${pending.length} messages waiting ${Math.round(ageSec / 60)}+ min${addressedHint}: ${senderSummary}. Latest: "${preview}...". Call listen_group() NOW.`;
          } else if (ageSec > 30) {
            result._nudge = `URGENT: ${pending.length} messages waiting ${ageSec}s${addressedHint}: ${senderSummary}. Latest: "${preview}...". Call listen_group() soon.`;
          } else {
            result._nudge = `${pending.length} messages waiting${addressedHint}: ${senderSummary}. Latest: "${preview}...". Call listen_group().`;
          }
        }
      } catch {}
    }

    // Global hook: reputation tracking
    if (registeredName && result.success) {
      try {
        const repMap = {
          'send_message': 'message_send', 'broadcast': 'message_send',
          'create_task': 'task_create', 'share_file': 'file_share',
          'log_decision': 'decision_log', 'cast_vote': 'vote_cast',
          'kb_write': 'kb_write', 'request_review': 'review_request',
          'submit_review': 'review_submit',
        };
        if (repMap[name]) trackReputation(registeredName, repMap[name]);
        // Track task completion specifically
        if (name === 'update_task' && args?.status === 'done') {
          // Calculate task completion time
          const tasks = getTasks();
          const doneTask = tasks.find(t => t.id === args.task_id);
          const taskTimeSec = doneTask ? Math.round((Date.now() - new Date(doneTask.created_at).getTime()) / 1000) : 0;
          trackReputation(registeredName, 'task_complete', taskTimeSec);
        }
      } catch {}
    }

    // Global hook: auto-compress conversation periodically
    if (name === 'send_message' || name === 'broadcast') {
      try { autoCompress(); } catch {}
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// Clean up agent registration on exit for instant status updates
process.on('exit', () => {
  unlockAgentsFile(); // Clean up any held lock
  unlockConfigFile();
  if (registeredName) {
    try {
      // Save final status to workspace before exit
      const ws = getWorkspace(registeredName);
      ws._status = 'Offline (graceful exit)';
      ws._status_since = new Date().toISOString();
      saveWorkspace(registeredName, ws);
    } catch {}
    try {
      // Agent memory: save recovery snapshot with decisions/tasks/KB on graceful exit
      const recoveryFile = path.join(DATA_DIR, `recovery-${registeredName}.json`);
      const allTasks = getTasks();
      const activeTasks = allTasks.filter(t => t.assignee === registeredName && (t.status === 'in_progress' || t.status === 'pending'));
      const completedTasks = allTasks.filter(t => t.assignee === registeredName && t.status === 'done').slice(-10).map(t => ({ id: t.id, title: t.title }));
      const decisions = getDecisions(currentBranch);
      const myDecisions = decisions.filter(d => d.decided_by === registeredName).slice(-10).map(d => ({ decision: d.decision, reasoning: (d.reasoning || '').substring(0, 150), decided_at: d.decided_at }));
      const kb = getKB(currentBranch);
      const kbKeysWritten = Object.keys(kb).filter(k => kb[k] && kb[k].updated_by === registeredName);
      const recentHistory = tailReadJsonl(getHistoryFile(currentBranch), 50);
      const lastSent = recentHistory.filter(m => m.from === registeredName).slice(-5).map(m => ({ to: m.to, content: m.content.substring(0, 200), timestamp: m.timestamp }));
      fs.writeFileSync(recoveryFile, JSON.stringify({
        agent: registeredName,
        branch: currentBranch,
        session_id: currentSessionId,
        session_state: 'completed',
        died_at: new Date().toISOString(),
        graceful: true,
        active_tasks: activeTasks.map(t => ({ id: t.id, title: t.title, status: t.status, description: (t.description || '').substring(0, 300) })),
        channels: getAgentChannels(registeredName).filter(c => c !== 'general'),
        last_messages_sent: lastSent,
        decisions_made: myDecisions,
        tasks_completed: completedTasks,
        kb_entries_written: kbKeysWritten,
      }));
    } catch {}
    try {
      if (currentSessionId) {
        sessionsState.transitionSession({
          sessionId: currentSessionId,
          branchName: currentBranch,
          state: 'completed',
          reason: 'graceful_exit',
          recoverySnapshotFile: `recovery-${registeredName}.json`,
        });
        currentSessionId = null;
      }
    } catch {}
    try {
      const agents = getAgents();
      if (agents[registeredName]) {
        const removedAgent = agents[registeredName];
        delete agents[registeredName];
        saveAgents(agents);
        canonicalState.appendCanonicalEvent({
          type: 'agent.unregistered',
          actorAgent: registeredName,
          correlationId: registeredName,
          payload: {
            agent_name: registeredName,
            agent: {
              name: registeredName,
              provider: removedAgent.provider || null,
              branch: removedAgent.branch || currentBranch,
              status: removedAgent.status || null,
              pid: removedAgent.pid || null,
              registered_at: removedAgent.timestamp || removedAgent.started_at || null,
              started_at: removedAgent.started_at || removedAgent.timestamp || null,
              last_activity: removedAgent.last_activity || null,
              listening_since: removedAgent.listening_since || null,
              last_listened_at: removedAgent.last_listened_at || null,
            },
            reason: 'graceful_exit',
          },
        });
      }
    } catch {}
  }
});
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

async function main() {
  try {
    ensureDataDir();
  } catch (e) {
    console.error('ERROR: Cannot create .agent-bridge/ directory: ' + e.message);
    console.error('Fix: Run "npx let-them-talk doctor" to diagnose the issue.');
    process.exit(1);
  }
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Agent Bridge MCP server v5.4.2 running (66 tools)');
  } catch (e) {
    console.error('ERROR: MCP server failed to start: ' + e.message);
    console.error('Fix: Run "npx let-them-talk doctor" to check your setup.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('FATAL: ' + e.message);
  console.error('Run "npx let-them-talk doctor" for diagnostics.');
  process.exit(1);
});
