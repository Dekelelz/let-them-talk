const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');

// Data dir lives in the project where Claude Code runs, not where the package is installed
const DATA_DIR = process.env.AGENT_BRIDGE_DATA_DIR || path.join(process.cwd(), '.agent-bridge');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.jsonl');
const HISTORY_FILE = path.join(DATA_DIR, 'history.jsonl');
const AGENTS_FILE = path.join(DATA_DIR, 'agents.json');
const ACKS_FILE = path.join(DATA_DIR, 'acks.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');
const WORKFLOWS_FILE = path.join(DATA_DIR, 'workflows.json');
const WORKSPACES_DIR = path.join(DATA_DIR, 'workspaces');
const BRANCHES_FILE = path.join(DATA_DIR, 'branches.json');
const DECISIONS_FILE = path.join(DATA_DIR, 'decisions.json');
const KB_FILE = path.join(DATA_DIR, 'kb.json');
const LOCKS_FILE = path.join(DATA_DIR, 'locks.json');
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const VOTES_FILE = path.join(DATA_DIR, 'votes.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const DEPS_FILE = path.join(DATA_DIR, 'dependencies.json');
const REPUTATION_FILE = path.join(DATA_DIR, 'reputation.json');
const COMPRESSED_FILE = path.join(DATA_DIR, 'compressed.json');
const RULES_FILE = path.join(DATA_DIR, 'rules.json');
// Plugins removed in v3.4.3 — unnecessary attack surface, CLIs have their own extension systems

// In-memory state for this process
let registeredName = null;
let registeredToken = null; // auth token for re-registration
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
const channelOffsets = new Map(); // per-channel byte offsets for efficient reads
let heartbeatInterval = null; // heartbeat timer reference
let messageSeq = 0; // monotonic sequence counter for message ordering
let currentBranch = 'main'; // which branch this agent is on
let lastSentAt = 0; // timestamp of last sent message (for group cooldown)
let sendsSinceLastListen = 0; // enforced: must listen between sends in group mode
let sendLimit = 1; // default: 1 send per listen cycle (2 if addressed)
let unaddressedSends = 0; // response budget: unaddressed sends counter
let budgetResetTime = Date.now(); // resets every 60s
let _channelSendTimes = {}; // per-channel rate limit sliding window

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

// --- Group conversation mode ---
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

function getConfig() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

// File-based lock for config.json (prevents managed state race conditions)
const CONFIG_LOCK = CONFIG_FILE + '.lock';
function lockConfigFile() {
  const maxWait = 5000; const start = Date.now();
  while (Date.now() - start < maxWait) {
    try { fs.writeFileSync(CONFIG_LOCK, String(process.pid), { flag: 'wx' }); return true; }
    catch { /* lock exists, wait */ }
    const wait = Date.now(); while (Date.now() - wait < 50) {} // busy-wait 50ms
  }
  try { fs.unlinkSync(CONFIG_LOCK); } catch {}
  try { fs.writeFileSync(CONFIG_LOCK, String(process.pid), { flag: 'wx' }); return true; } catch {}
  return false;
}
function unlockConfigFile() { try { fs.unlinkSync(CONFIG_LOCK); } catch {} }

function saveConfig(config) {
  ensureDataDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
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

function getManagedConfig() {
  const config = getConfig();
  return config.managed || {
    manager: null,
    phase: 'discussion',
    floor: 'closed',
    turn_queue: [],
    turn_current: null,
    phase_history: [],
  };
}

function saveManagedConfig(managed) {
  lockConfigFile();
  try {
    const config = getConfig();
    config.managed = managed;
    saveConfig(config);
  } finally {
    unlockConfigFile();
  }
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
  ensureDataDir();
  fs.appendFileSync(getMessagesFile(recipientBranch), JSON.stringify(msg) + '\n');
  fs.appendFileSync(getHistoryFile(recipientBranch), JSON.stringify(msg) + '\n');
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
  ensureDataDir();
  fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
  fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
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

function consumedFile(agentName) {
  sanitizeName(agentName);
  return path.join(DATA_DIR, `consumed-${agentName}.json`);
}

function getConsumedIds(agentName) {
  const file = consumedFile(agentName);
  if (!fs.existsSync(file)) return new Set();
  try {
    return new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return new Set();
  }
}

function saveConsumedIds(agentName, ids) {
  // Auto-prune when consumed set exceeds 500 entries to prevent unbounded growth
  if (ids.size > 500) {
    trimConsumedIds(agentName, ids);
  }
  fs.writeFileSync(consumedFile(agentName), JSON.stringify([...ids]));
}

// Prune consumed IDs: remove IDs no longer present in messages.jsonl
// At 100 agents with 5000+ messages, this prevents 500KB+ JSON per agent
function trimConsumedIds(agentName, ids) {
  try {
    const msgFile = getMessagesFile(currentBranch);
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

function getAgents() {
  return cachedRead('agents', () => {
    if (!fs.existsSync(AGENTS_FILE)) return {};
    let agents;
    try { agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch { return {}; }
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
    return agents;
  }, 1500);
}

function saveAgents(agents) {
  // Safe write: serialize first, then write complete string
  // This minimizes the window where the file could be truncated
  const data = JSON.stringify(agents);
  if (data && data.length > 2) {
    fs.writeFileSync(AGENTS_FILE, data);
  }
  invalidateCache('agents');
}

// --- Per-agent heartbeat files (scale fix: eliminates agents.json write contention at 100+ agents) ---
function heartbeatFile(name) { return path.join(DATA_DIR, `heartbeat-${name}.json`); }

function touchHeartbeat(name) {
  if (!name) return;
  try {
    fs.writeFileSync(heartbeatFile(name), JSON.stringify({
      last_activity: new Date().toISOString(),
      pid: process.pid,
    }));
  } catch {}
}


function getAcks() {
  if (!fs.existsSync(ACKS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACKS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

// Cache for isPidAlive results — avoids redundant process.kill calls at 100-agent scale
const _pidAliveCache = {};
function isPidAlive(pid, lastActivity) {
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
    if (fs.existsSync(DATA_DIR)) {
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith('consumed-') && f.endsWith('.json')) {
          const agentName = f.replace('consumed-', '').replace('.json', '');
          try {
            const ids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
            perAgentConsumed[agentName] = new Set(ids);
            ids.forEach(id => allConsumed.add(id));
          } catch {}
        }
      }
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
    for (const f of fs.readdirSync(DATA_DIR)) {
      if (f.startsWith('consumed-') && f.endsWith('.json')) {
        try {
          const ids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
          const trimmed = ids.filter(id => activeIds.has(id));
          fs.writeFileSync(path.join(DATA_DIR, f), JSON.stringify(trimmed));
        } catch {}
      }
    }
  } catch {}
}

// --- Permissions helpers ---
const PERMISSIONS_FILE = path.join(DATA_DIR, 'permissions.json');

function getPermissions() {
  if (!fs.existsSync(PERMISSIONS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PERMISSIONS_FILE, 'utf8')); } catch { return {}; }
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
const READ_RECEIPTS_FILE = path.join(DATA_DIR, 'read_receipts.json');

function getReadReceipts() {
  if (!fs.existsSync(READ_RECEIPTS_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(READ_RECEIPTS_FILE, 'utf8')); } catch { return {}; }
}

function markAsRead(agentName, messageId) {
  ensureDataDir();
  const receipts = getReadReceipts();
  if (!receipts[messageId]) receipts[messageId] = {};
  receipts[messageId][agentName] = new Date().toISOString();
  fs.writeFileSync(READ_RECEIPTS_FILE, JSON.stringify(receipts));
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
    if (m.to !== agentName && m.to !== '__group__' && m.to !== '__all__') return false;
    if (m.to === '__group__' && m.from === agentName) return false;
    if (m.exclude_agent && m.exclude_agent === agentName) return false;
    if (consumed.has(m.id)) return false;
    if (fromFilter && m.from !== fromFilter && !m.system) return false;
    if (perms[agentName] && perms[agentName].can_read) {
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

// --- Workspace helpers ---

function ensureWorkspacesDir() {
  if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true, mode: 0o700 });
}

function getWorkspace(agentName) {
  const file = path.join(WORKSPACES_DIR, `${sanitizeName(agentName)}.json`);
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function saveWorkspace(agentName, data) {
  ensureWorkspacesDir();
  fs.writeFileSync(path.join(WORKSPACES_DIR, `${sanitizeName(agentName)}.json`), JSON.stringify(data));
}

// --- Workflow helpers ---

function getWorkflows() {
  return cachedRead('workflows', () => {
    if (!fs.existsSync(WORKFLOWS_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8')); } catch { return []; }
  }, 2000);
}

function saveWorkflows(workflows) {
  withFileLock(WORKFLOWS_FILE, () => {
    invalidateCache('workflows');
    fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows));
  });
}

// --- Autonomous mode detection ---
function isAutonomousMode() {
  const workflows = getWorkflows();
  return workflows.some(wf => wf.status === 'active' && wf.autonomous === true);
}

function hasActiveWorkflowStep(agentName) {
  const workflows = getWorkflows();
  return workflows.some(wf =>
    wf.status === 'active' &&
    wf.steps.some(s => s.assignee === agentName && s.status === 'in_progress')
  );
}

// --- Autonomous work loop helpers (get_work / verify_and_advance support) ---

function findMyActiveWorkflowStep() {
  if (!registeredName) return null;
  const workflows = getWorkflows();
  for (const wf of workflows) {
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

function getMessagesFile(branch) {
  if (!branch || branch === 'main') return MESSAGES_FILE;
  return path.join(DATA_DIR, `branch-${sanitizeName(branch)}-messages.jsonl`);
}

function getHistoryFile(branch) {
  if (!branch || branch === 'main') return HISTORY_FILE;
  return path.join(DATA_DIR, `branch-${sanitizeName(branch)}-history.jsonl`);
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
  try { rulesMtime = fs.existsSync(RULES_FILE) ? fs.statSync(RULES_FILE).mtimeMs : 0; } catch {}
  const cacheKey = `${level}:${aliveCount}:${mode}:${registeredName}:${rulesMtime}`;
  if (_guideCache.key === cacheKey && _guideCache.result) return _guideCache.result;

  const channels = getChannelsData();
  const hasChannels = Object.keys(channels).length > 1; // more than just #general
  const autonomousActive = isAutonomousMode();

  // --- Team Intelligence: detect agent role from profiles ---
  const profiles = getProfiles();
  const myRole = (profiles[registeredName] && profiles[registeredName].role) ? profiles[registeredName].role.toLowerCase() : '';
  const isQualityLead = myRole === 'quality';
  const isMonitor = myRole === 'monitor';
  const isAdvisor = myRole === 'advisor';
  let qualityLeadName = null;
  for (const [pName, prof] of Object.entries(profiles)) {
    if (prof.role && prof.role.toLowerCase() === 'quality' && pName !== registeredName) { qualityLeadName = pName; break; }
  }

  const rules = [];

  // === MANAGED MODE: agents wait for manager's floor control ===
  if (isManagedMode()) {
    const managed = getManagedConfig();
    const isManager = managed.manager === registeredName;
    if (isManager) {
      rules.push('YOU ARE THE MANAGER. You control the conversation. Use yield_floor(agent) to let agents speak. Use set_phase() to change team phase (discussion/planning/execution/review).');
      rules.push('YOUR MANAGER LOOP: 1) Plan the work and assign tasks. 2) Use yield_floor() to give each agent their turn to speak. 3) Call listen() to wait for agent responses. 4) Review responses and decide next steps. 5) Use create_task() and create_workflow() to structure work.');
      rules.push('Use send_message() to give instructions. Use broadcast() for team announcements. Agents cannot speak unless you give them the floor.');
    } else {
      rules.push('YOU ARE IN MANAGED MODE. The manager controls who speaks. Call listen() to wait for your turn. When the manager gives you the floor via yield_floor(), respond with your work.');
      rules.push('YOUR LOOP: 1) Call listen() — wait for messages and floor assignments. 2) When you receive a message or get the floor, do the work and respond. 3) Call listen() again. NEVER use sleep(). NEVER poll with check_messages(). listen() handles everything automatically.');
      rules.push('If you have an active task during execution phase, do the work, then report back to the manager via send_message(). Then call listen() again.');
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
      rules.push('YOUR MONITOR LOOP: 1) Call get_work() — it returns a health check report instead of a work assignment. 2) Analyze the report: who is idle? Who is stuck? Are tasks bouncing between agents? Is the queue growing? 3) INTERVENE: reassign stuck tasks, nudge idle agents via send_message, rebalance roles if workload is uneven. 4) Log every intervention to your workspace via workspace_write(key="_monitor_log"). 5) Call get_work() again. NEVER stop monitoring.');
      rules.push('WHAT TO WATCH FOR: Idle agents (>2 minutes without activity). Circular escalations (same task rejected by 3+ agents). Queue buildup (more pending tasks than agents can handle). Stuck workflow steps (>15 minutes in progress). Agents with high rejection rates.');
      rules.push('HOW TO INTERVENE: Use send_message to nudge idle agents. Use update_task to reassign stuck tasks. Call rebalanceRoles() via the system to shift workload. Use broadcast for team-wide alerts.');
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
      tier_info: `${rules.length} rules (AUTONOMOUS MODE, ${aliveCount} agents, role: ${myRole || 'unassigned'})`,
      first_steps: isAdvisor
        ? '1. Call get_work() to get team context (messages, tasks, decisions). 2. Think deeply about patterns, improvements, missing features. 3. Send insights to team. 4. Call get_work() again. Never stop thinking.'
        : isMonitor
        ? '1. Call get_work() to get system health report. 2. Analyze: idle agents, stuck tasks, circular escalations. 3. Intervene: reassign, nudge, rebalance. 4. Call get_work() again. Never stop monitoring.'
        : isQualityLead
        ? '1. Call get_work() to find work to review. 2. Review thoroughly. 3. Approve or request changes. 4. Call get_work() again. Never stop.'
        : '1. Call get_work() to get your assignment. 2. Do the work. 3. Call verify_and_advance(). 4. Call get_work() again. Never stop.',
      autonomous_mode: true,
      your_role: myRole || undefined,
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
  rules.push('AFTER EVERY ACTION, call listen_group(). This is how you receive messages. Never skip this.');

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
      first_steps: mode === 'direct'
        ? '1. Call list_agents() to see who is online. 2. Send a message or call listen() to wait.'
        : '1. Call get_briefing() for project context. 2. Call listen_group() to join. 3. Respond and listen_group() again.',
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
    rules.push('listen_group blocks until messages arrive. Do not stop listening.');
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
    if (registeredName && registeredName !== name) {
      unlockAgentsFile();
      return { error: `Already registered as "${registeredName}". Cannot change name mid-session.`, current_name: registeredName };
    }

    const now = new Date().toISOString();
    const token = (agents[name] && agents[name].token) || generateToken();
    agents[name] = { pid: process.pid, timestamp: now, last_activity: now, provider: provider || 'unknown', branch: currentBranch, token, started_at: now };
    saveAgents(agents);
    registeredName = name;
  registeredToken = token;

  // Auto-create profile if not exists
  const profiles = getProfiles();
  if (!profiles[name]) {
    profiles[name] = { display_name: name, avatar: getDefaultAvatar(name), bio: '', role: '', created_at: now };
    saveProfiles(profiles);
  }

  // Start heartbeat — updates last_activity every 10s so dashboard knows we're alive
  // Deterministic jitter per agent to spread writes across the interval (prevents lock storms at 10 agents)
  const heartbeatJitter = name.split('').reduce((h, c) => h + c.charCodeAt(0), 0) % 2000;
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    try {
      // Scale fix: write per-agent heartbeat file instead of lock+read+write agents.json
      // Eliminates write contention — each agent writes only its own file, no locking needed
      touchHeartbeat(registeredName);
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
      // Auto-escalation: notify team about long-blocked tasks
      escalateBlockedTasks();
      // Stand-up meetings: periodic team check-ins
      triggerStandupIfDue();
      // Watchdog: nudge idle agents, reassign stuck work (autonomous mode only)
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

    // Recovery: if this agent has prior data, include it
    const myTasks = getTasks().filter(t => t.assignee === name && t.status !== 'done');
    const myWorkspace = getWorkspace(name);
    // Scale fix: tail-read last 30 messages instead of entire history
    const recentHistory = tailReadJsonl(getHistoryFile(currentBranch), 30);
    const myRecentMsgs = recentHistory.filter(m => m.to === name || m.from === name).slice(-5);

    if (myTasks.length > 0 || Object.keys(myWorkspace).length > 0 || myRecentMsgs.length > 0) {
      result.recovery = {};
      if (myTasks.length > 0) result.recovery.your_active_tasks = myTasks.map(t => ({ id: t.id, title: t.title, status: t.status }));
      if (Object.keys(myWorkspace).length > 0) result.recovery.your_workspace_keys = Object.keys(myWorkspace);
      if (myRecentMsgs.length > 0) result.recovery.recent_messages = myRecentMsgs.map(m => ({ from: m.from, to: m.to, preview: m.content.substring(0, 100), timestamp: m.timestamp }));
      result.recovery.hint = 'You have prior context from a previous session. Call get_briefing() for a full project summary.';
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
          if (snapshot.active_tasks && snapshot.active_tasks.length > 0) result.recovery.your_active_tasks = snapshot.active_tasks;
          if (snapshot.locked_files && snapshot.locked_files.length > 0) {
            result.recovery.locked_files_released = snapshot.locked_files;
            result.recovery.lock_note = 'These files were locked by your previous session. Locks have been auto-released. Re-lock them with lock_file() before editing.';
          }
          if (snapshot.channels && snapshot.channels.length > 0) result.recovery.your_channels = snapshot.channels;
          if (snapshot.last_messages_sent) result.recovery.last_messages_sent = snapshot.last_messages_sent;
          // Agent memory fields
          if (snapshot.decisions_made && snapshot.decisions_made.length > 0) result.recovery.decisions_made = snapshot.decisions_made;
          if (snapshot.tasks_completed && snapshot.tasks_completed.length > 0) result.recovery.tasks_completed = snapshot.tasks_completed;
          if (snapshot.kb_entries_written && snapshot.kb_entries_written.length > 0) result.recovery.kb_entries_written = snapshot.kb_entries_written;
          if (snapshot.graceful) result.recovery.was_graceful = true;
          result.recovery.hint = snapshot.graceful
            ? 'You are RESUMING from a previous session that exited gracefully. Your memory (decisions, completed tasks, KB entries) is below. Continue where you left off.'
            : 'You are RESUMING a previous session that crashed. Review your active tasks and locked files below, then continue where you left off. Do NOT restart work from scratch.';
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
}

// Set or clear the listening_since flag
function setListening(isListening) {
  if (!registeredName) return;
  try {
    lockAgentsFile();
    try {
      const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      if (agents[registeredName]) {
        agents[registeredName].listening_since = isListening ? new Date().toISOString() : null;
        if (isListening) {
          agents[registeredName].last_listened_at = new Date().toISOString();
        }
        saveAgents(agents);
      }
    } finally { unlockAgentsFile(); }
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
    result[name] = {
      alive,
      registered_at: info.timestamp,
      last_activity: lastActivity,
      idle_seconds: alive ? idleSeconds : null,
      status: !alive ? 'dead' : idleSeconds > 60 ? 'sleeping' : 'active',
      listening_since: info.listening_since || null,
      is_listening: !!(info.listening_since && alive),
      last_listened_at: info.last_listened_at || null,
      provider: info.provider || 'unknown',
      branch: info.branch || 'main',
      display_name: profile.display_name || name,
      avatar: profile.avatar || getDefaultAvatar(name),
      role: profile.role || '',
      bio: profile.bio || '',
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

  const rateErr = checkRateLimit(content, to || '__broadcast__');
  if (rateErr) return rateErr;

  // Send-after-listen enforcement: must call listen_group between sends in group mode
  // Autonomous mode: relaxed to 5 sends per listen cycle
  const effectiveSendLimit = isAutonomousMode() ? 5 : sendLimit;
  if (isGroupMode() && sendsSinceLastListen >= effectiveSendLimit) {
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

  if (otherAgents.length === 0) {
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

  if (!agents[to]) {
    return { error: `Agent "${to}" is not registered` };
  }

  if (to === registeredName) {
    return { error: 'Cannot send a message to yourself' };
  }

  // Permission check
  if (!canSendTo(registeredName, to)) {
    return { error: `Permission denied: you are not allowed to send messages to "${to}"` };
  }

  const sizeErr = validateContentSize(content);
  if (sizeErr) return sizeErr;

  // Check if recipient is alive — warn if dead
  const recipientAlive = isPidAlive(agents[to].pid, agents[to].last_activity);

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
  // Write to channel-specific file if channel specified, otherwise default
  const msgFile = channel ? getChannelMessagesFile(channel) : getMessagesFile(currentBranch);
  const histFile = channel ? getChannelHistoryFile(channel) : getHistoryFile(currentBranch);
  fs.appendFileSync(msgFile, JSON.stringify(msg) + '\n');
  fs.appendFileSync(histFile, JSON.stringify(msg) + '\n');
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
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName);

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
    fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
    fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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
    fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
    fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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
  fs.writeFileSync(ACKS_FILE, JSON.stringify(acks));
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

    // 45s timeout — prevents MCP connection drops
    const timer = setTimeout(() => {
      setListening(false);
      touchActivity();
      done({ retry: true, message: 'No direct messages in 45s. Call listen() again to keep waiting.' });
    }, 45000);
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

  lockConfigFile();
  try {
    const managed = getManagedConfig();

    // Check if manager already exists and is alive
    if (managed.manager && managed.manager !== registeredName) {
      const agents = getAgents();
      if (agents[managed.manager] && isPidAlive(agents[managed.manager].pid, agents[managed.manager].last_activity)) {
        return { error: `Manager "${managed.manager}" is already active. Only one manager at a time.` };
      }
      // Previous manager is dead — allow takeover
    }

    managed.manager = registeredName;
    managed.floor = 'closed'; // manager controls the floor
    const config = getConfig();
    config.managed = managed;
    saveConfig(config);

    broadcastSystemMessage(
      `[SYSTEM] ${registeredName} is now the manager. Wait to be addressed. Do NOT send messages until given the floor.`,
      registeredName
    );

    return {
      success: true,
      message: `You are now the manager. Use yield_floor() to give agents turns, set_phase() to move through phases, and broadcast() for announcements.`,
      phase: managed.phase,
      floor: managed.floor,
    };
  } finally {
    unlockConfigFile();
  }
}

function toolYieldFloor(to, prompt = null) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!isManagedMode()) return { error: 'Not in managed mode.' };

  const managed = getManagedConfig();
  if (managed.manager !== registeredName) return { error: 'Only the manager can yield the floor.' };

  const agents = getAgents();
  const aliveAgents = Object.keys(agents).filter(n => n !== registeredName && isPidAlive(agents[n].pid, agents[n].last_activity));

  if (to === '__close__') {
    // Close the floor — only manager can speak
    managed.floor = 'closed';
    managed.turn_current = null;
    managed.turn_queue = [];
    saveManagedConfig(managed);
    broadcastSystemMessage('[FLOOR] Floor is now closed. Wait for the manager to address you.', registeredName);
    return { success: true, floor: 'closed', message: 'Floor closed. Only you can speak.' };
  }

  if (to === '__open__') {
    // Open floor — round-robin through all alive agents
    managed.floor = 'open';
    managed.turn_queue = aliveAgents;
    managed.turn_current = aliveAgents.length > 0 ? aliveAgents[0] : null;
    saveManagedConfig(managed);

    if (managed.turn_current) {
      const promptText = prompt ? `\n\nTopic: ${prompt}` : '';
      sendSystemMessage(managed.turn_current, `[FLOOR] It is YOUR TURN to speak. You have the floor.${promptText}\nAfter you send your message, the floor will pass to the next agent.`);
      const waiting = aliveAgents.filter(n => n !== managed.turn_current);
      for (const w of waiting) {
        sendSystemMessage(w, `[FLOOR] Open discussion started. ${managed.turn_current} goes first. Wait for your turn.${promptText}`);
      }
    }

    return { success: true, floor: 'open', turn_order: aliveAgents, current_turn: managed.turn_current, message: `Open floor: agents will speak in order: ${aliveAgents.join(' → ')}` };
  }

  // Directed floor — give it to a specific agent
  sanitizeName(to);
  if (!agents[to]) return { error: `Agent "${to}" is not registered.` };
  if (to === registeredName) return { error: 'Cannot yield floor to yourself (you are the manager).' };

  managed.floor = 'directed';
  managed.turn_current = to;
  managed.turn_queue = [to];
  saveManagedConfig(managed);

  const promptText = prompt ? `\n\nManager asks: ${prompt}` : '';
  sendSystemMessage(to, `[FLOOR] The manager has given you the floor. It is YOUR TURN to speak. Respond now.${promptText}`);

  // Tell others to wait
  const waiting = aliveAgents.filter(n => n !== to);
  for (const w of waiting) {
    sendSystemMessage(w, `[FLOOR] ${to} has the floor. Do NOT respond. Wait for your turn.`);
  }

  return { success: true, floor: 'directed', agent: to, prompt: prompt || null, message: `Floor given to ${to}. They can now respond.` };
}

function toolSetPhase(phase) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!isManagedMode()) return { error: 'Not in managed mode.' };

  const managed = getManagedConfig();
  if (managed.manager !== registeredName) return { error: 'Only the manager can set the phase.' };

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
  broadcastSystemMessage(phaseInstructions[phase], registeredName);

  return {
    success: true,
    phase,
    previous_phase: previousPhase,
    message: `Phase set to "${phase}". All agents have been notified.`,
  };
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
  const MAX_LISTEN_MS = 45000; // 45s — short enough to prevent MCP connection drops
  const listenStart = Date.now();

  // Helper: collect unconsumed messages from all sources (general + channels)
  // Uses byte-offset reads for O(new_messages) instead of O(all_messages)
  function collectBatch() {
    const myChannels = getAgentChannels(registeredName);
    const mainFile = getMessagesFile(currentBranch);
    let messages = [];

    // Read new messages from main file using byte offset (efficient)
    if (fs.existsSync(mainFile)) {
      const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset, mainFile);
      messages = newMsgs;
      lastReadOffset = newOffset;
    }

    // Read new messages from channels using per-channel offsets
    for (const ch of myChannels) {
      if (ch === 'general') continue;
      const chFile = getChannelMessagesFile(ch);
      if (fs.existsSync(chFile)) {
        const chOffset = channelOffsets.get(ch) || 0;
        const { messages: chMsgs, newOffset } = readNewMessagesFromFile(chOffset, chFile);
        messages = messages.concat(chMsgs);
        channelOffsets.set(ch, newOffset);
      }
    }

    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const batch = [];
    const perms = getPermissions();
    for (const msg of messages) {
      if (consumed.has(msg.id)) continue;
      if (msg.to === '__group__' && msg.from === registeredName) { consumed.add(msg.id); continue; }
      if (msg.to !== registeredName && msg.to !== '__all__' && msg.to !== '__group__') continue;
      if (perms[registeredName] && perms[registeredName].can_read) {
        const allowed = perms[registeredName].can_read;
        if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(msg.from) && !msg.system) continue;
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
        sendLimit = 2;
        touchHeartbeat(registeredName);
        resolve({
          messages: [],
          message_count: 0,
          retry: true,
          batch_summary: 'No new messages — call listen_group() again to keep listening.',
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

    // Autonomous mode: shorter timeout
    const effectiveTimeout = autonomousTimeout
      ? Math.min(autonomousTimeout, MAX_LISTEN_MS)
      : MAX_LISTEN_MS;

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
  sendLimit = wasAddressed ? 2 : 1;

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

  // Agent statuses — lightweight, no history reads
  const agents = getAgents();
  const agentNames = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
  const agentStatus = {};
  for (const n of agentNames) {
    if (agents[n].listening_since) {
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
      result.instructions = 'DO NOT RESPOND. Wait for the manager to give you the floor. Call listen() or listen_group() to wait.';
    }
  }

  result.next_action = isAutonomousMode()
    ? 'Process these messages, then call get_work() to continue the proactive work loop. Do NOT call listen_group() — use get_work() instead.'
    : 'After processing these messages and sending your response, call listen_group() again immediately. Never stop listening.';
  return result;
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

  ensureDataDir();
  fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
  fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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

  ensureDataDir();
  fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
  fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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

function getTasks() {
  return cachedRead('tasks', () => {
    if (!fs.existsSync(TASKS_FILE)) return [];
    try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return []; }
  }, 2000);
}

function saveTasks(tasks) {
  withFileLock(TASKS_FILE, () => {
    invalidateCache('tasks');
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks));
  });
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

  const tasks = getTasks();
  if (tasks.length >= 1000) return { error: 'Task limit reached (max 1000). Complete or remove existing tasks first.' };
  tasks.push(task);
  saveTasks(tasks);
  touchActivity();

  const result = { success: true, task_id: task.id, assignee: task.assignee };
  if (taskChannel) result.channel = taskChannel;
  return result;
}

function toolUpdateTask(taskId, status, notes = null) {
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

  // Circuit breaker: if task goes back to pending and 3+ agents have failed, block permanently
  if (status === 'pending' && task.attempt_agents && task.attempt_agents.length >= 3) {
    task.status = 'blocked_permanent';
    task.updated_at = new Date().toISOString();
    task.block_reason = `Circuit breaker: ${task.attempt_agents.length} agents attempted and failed (${task.attempt_agents.join(', ')})`;
    saveTasks(tasks);
    broadcastSystemMessage(`[CIRCUIT BREAKER] Task "${task.title}" permanently blocked after ${task.attempt_agents.length} agents failed. Needs human review.`);
    touchActivity();
    return { success: true, task_id: task.id, status: 'blocked_permanent', circuit_breaker: true, message: 'Task permanently blocked — too many agents failed. Needs human review.' };
  }

  task.status = status;
  task.updated_at = new Date().toISOString();
  // Clear escalation flag when task is unblocked
  if (status !== 'blocked' && task.escalated_at) delete task.escalated_at;
  if (notes) {
    task.notes.push({ by: registeredName, text: notes, at: new Date().toISOString() });
  }

  saveTasks(tasks);
  touchActivity();

  // Auto-status: update agent's workspace status on task state changes
  try {
    if (status === 'in_progress') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `Working on: ${task.title}`, _status_since: new Date().toISOString() }));
    } else if (status === 'done') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `Completed: ${task.title}`, _status_since: new Date().toISOString() }));
    } else if (status === 'blocked') {
      saveWorkspace(registeredName, Object.assign(getWorkspace(registeredName), { _status: `BLOCKED on: ${task.title}`, _status_since: new Date().toISOString() }));
    }
  } catch {}

  // Task-channel auto-join: when claiming a task that has a channel, auto-join it
  if (status === 'in_progress' && task.channel) {
    const channels = getChannelsData();
    if (channels[task.channel] && !channels[task.channel].members.includes(registeredName)) {
      channels[task.channel].members.push(registeredName);
      saveChannelsData(channels);
    }
  }

  // Event hooks: task completion
  if (status === 'done') {
    fireEvent('task_complete', { title: task.title, created_by: task.created_by });
    // Economy: award credits for task completion
    try {
      const economyFile = path.join(DATA_DIR, 'economy.jsonl');
      const creditEntry = JSON.stringify({ agent: registeredName, amount: 10, reason: 'task_completed', type: 'earn', task: task.title, timestamp: new Date().toISOString() }) + '\n';
      fs.appendFileSync(economyFile, creditEntry);
    } catch {}
    // Check if this resolves any dependencies
    const deps = getDeps();
    for (const dep of deps) {
      if (dep.depends_on === taskId && !dep.resolved) {
        dep.resolved = true;
        const blockedTask = tasks.find(t => t.id === dep.task_id);
        if (blockedTask && blockedTask.assignee) {
          fireEvent('dependency_met', { task_title: task.title, notify: blockedTask.assignee });
        }
      }
    }
    writeJsonFile(DEPS_FILE, deps);

    // Task-channel auto-cleanup: archive task channel when task is done
    if (task.channel) {
      const channels = getChannelsData();
      if (channels[task.channel]) {
        delete channels[task.channel];
        saveChannelsData(channels);
      }
    }

    // Quality gate: auto-request review when task is completed
    const agents = getAgents();
    const aliveOthers = Object.keys(agents).filter(n => n !== registeredName && isPidAlive(agents[n].pid, agents[n].last_activity));
    if (aliveOthers.length > 0) {
      broadcastSystemMessage(`[REVIEW NEEDED] ${registeredName} completed task "${task.title}". Team: please review the work and call submit_review() if applicable.`, registeredName);
    }
  }

  return { success: true, task_id: task.id, status: task.status, title: task.title };
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

function toolUpdateProfile(displayName, avatar, bio, role, appearance) {
  if (!registeredName) return { error: 'You must call register() first' };

  const profiles = getProfiles();
  if (!profiles[registeredName]) {
    profiles[registeredName] = { display_name: registeredName, avatar: getDefaultAvatar(registeredName), bio: '', role: '', created_at: new Date().toISOString() };
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
  saveWorkspace(registeredName, ws);
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
  const workflows = getWorkflows();
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

  if (workflows.length >= 500) return { error: 'Workflow limit reached (max 500).' };
  workflows.push(workflow);
  ensureDataDir();
  saveWorkflows(workflows);

  // Auto-handoff to all in_progress steps' assignees
  const startedSteps = parsedSteps.filter(s => s.status === 'in_progress');
  for (const step of startedSteps) {
    if (step.assignee && agents[step.assignee] && step.assignee !== registeredName) {
      const handoffContent = `[Workflow "${name}"] Step ${step.id} assigned to you: ${step.description}` +
        (autonomous ? '\n\nThis is an AUTONOMOUS workflow. Call get_work() to enter the proactive work loop. Do NOT wait for approval.' : '');
      messageSeq++;
      const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: step.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
      fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
      fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
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

function toolAdvanceWorkflow(workflowId, notes) {
  if (!registeredName) return { error: 'You must call register() first' };

  const workflows = getWorkflows();
  const wf = workflows.find(w => w.id === workflowId);
  if (!wf) return { error: `Workflow not found: ${workflowId}` };
  if (wf.status !== 'active') return { error: 'Workflow is not active' };

  const currentStep = wf.steps.find(s => s.status === 'in_progress');
  if (!currentStep) return { error: 'No step currently in progress' };

  currentStep.status = 'done';
  currentStep.completed_at = new Date().toISOString();
  if (notes) currentStep.notes = notes.substring(0, 500);

  // Find all ready steps (supports parallel via depends_on)
  const nextSteps = findReadySteps(wf);
  if (nextSteps.length > 0) {
    const agents = getAgents();
    for (const step of nextSteps) {
      step.status = 'in_progress';
      step.started_at = new Date().toISOString();
      if (step.assignee && agents[step.assignee] && step.assignee !== registeredName && canSendTo(registeredName, step.assignee)) {
        const handoffContent = `[Workflow "${wf.name}"] Step ${step.id} assigned to you: ${step.description}`;
        messageSeq++;
        const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: step.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
        fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
        fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
      }
    }
  } else if (wf.steps.every(s => s.status === 'done')) {
    wf.status = 'completed';
  }
  wf.updated_at = new Date().toISOString();
  saveWorkflows(workflows);
  touchActivity();

  const doneCount = wf.steps.filter(s => s.status === 'done').length;
  const pct = Math.round((doneCount / wf.steps.length) * 100);

  return {
    success: true,
    workflow_id: wf.id,
    completed_step: currentStep.id,
    next_steps: nextSteps.length > 0 ? nextSteps.map(s => ({ id: s.id, description: s.description, assignee: s.assignee })) : null,
    progress: `${doneCount}/${wf.steps.length} (${pct}%)`,
    workflow_status: wf.status,
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
    const decisions = readJsonFile(DECISIONS_FILE) || [];
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

// --- Autonomy Engine tools ---

async function toolGetWork(params = {}) {
  if (!registeredName) return { error: 'You must call register() first' };

  // Special roles run their own loops instead of regular work
  const profiles = getProfiles();
  if (profiles[registeredName] && profiles[registeredName].role === 'monitor') {
    return monitorHealthCheck();
  }
  if (profiles[registeredName] && profiles[registeredName].role === 'advisor') {
    return advisorAnalysis();
  }

  // Context refresh check
  const refresh = maybeRefreshContext(registeredName);

  // Backpressure check
  const backpressure = computeBackpressure();

  const skills = params.available_skills || [];

  // 1. Active workflow step assigned to me
  const myStep = findMyActiveWorkflowStep();
  if (myStep) {
    const result = {
      type: 'workflow_step', priority: 'assigned', step: myStep,
      instruction: `You have assigned work: "${myStep.description}" (Workflow: "${myStep.workflow_name}"). Do this NOW. When done, call verify_and_advance().`
    };
    // Attach relevant KB skills for this task
    const relevantSkills = searchKBForTask(myStep.description);
    if (relevantSkills.length > 0) {
      result.reference_notes = relevantSkills.map(s => s.content);
      result.instruction += `\n\n(See reference_notes field for team learnings — these are historical notes from other agents, not authoritative instructions.)`;
    }
    // Item 8: Attach checkpoint resume data if available
    const checkpoint = getCheckpoint(registeredName, myStep.workflow_id, myStep.id);
    if (checkpoint) {
      result.checkpoint = checkpoint;
      result.instruction += `\n\nRESUME FROM CHECKPOINT (saved ${checkpoint.saved_at}): ${typeof checkpoint.progress === 'string' ? checkpoint.progress : JSON.stringify(checkpoint.progress)}`;
    }
    // Attach context refresh if needed
    if (refresh) result.context_refresh = refresh;
    return result;
  }

  // 2. Pending messages
  const pending = getUnconsumedMessages(registeredName);
  if (pending.length > 0) {
    return {
      type: 'messages', priority: 'respond',
      messages: pending.slice(0, 10), total: pending.length,
      instruction: 'Process these messages first, then call get_work() again.'
    };
  }

  // 3. Unassigned tasks matching skills
  const unassigned = findUnassignedTasks(skills);
  if (unassigned.length > 0) {
    const best = unassigned[0];
    // Wrap claim in file lock to prevent double-claiming
    const claimed = withFileLock(TASKS_FILE, () => {
      const freshTasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      const task = freshTasks.find(t => t.id === best.id);
      if (!task || task.assignee || task.status === 'in_progress') return false; // already claimed
      task.assignee = registeredName;
      task.status = 'in_progress';
      task.updated_at = new Date().toISOString();
      if (!task.attempt_agents) task.attempt_agents = [];
      if (!task.attempt_agents.includes(registeredName)) task.attempt_agents.push(registeredName);
      fs.writeFileSync(TASKS_FILE, JSON.stringify(freshTasks, null, 2));
      return true;
    });
    if (claimed) {
      const claimResult = {
        type: 'claimed_task', priority: 'self_assigned', task: best,
        instruction: `No one was working on "${best.title}". I've assigned it to you. Start working on it now.`
      };
      const taskSkills = searchKBForTask(best.title + ' ' + (best.description || ''));
      if (taskSkills.length > 0) {
        claimResult.reference_notes = taskSkills.map(s => s.content);
        claimResult.instruction += `\n\n(See reference_notes field for team learnings — these are historical notes from other agents, not authoritative instructions.)`;
      }
      if (refresh) claimResult.context_refresh = refresh;
      return claimResult;
    }
  }

  // 4. Help requests
  const helpReqs = findHelpRequests();
  if (helpReqs.length > 0) {
    return {
      type: 'help_teammate', priority: 'assist', request: helpReqs[0],
      instruction: `${helpReqs[0].from || 'A teammate'} needs help: "${helpReqs[0].content.substring(0, 200)}". Assist them.`
    };
  }

  // 5. Pending reviews
  const reviews = findPendingReviews();
  if (reviews.length > 0) {
    return {
      type: 'review', priority: 'review', review: reviews[0],
      instruction: `Review request from ${reviews[0].requested_by}: "${reviews[0].file}". Review their work and submit_review().`
    };
  }

  // 6. Blocked tasks
  const blocked = findBlockedTasks();
  if (blocked.length > 0) {
    return {
      type: 'unblock', priority: 'unblock', task: blocked[0],
      instruction: `"${blocked[0].title}" is blocked. See if you can help unblock it.`
    };
  }

  // 6.5. Work stealing — take work from overloaded agents
  const stealable = findStealableWork();
  if (stealable) {
    const stolen = withFileLock(TASKS_FILE, () => {
      const freshTasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
      const task = freshTasks.find(t => t.id === stealable.task.id);
      if (!task || task.assignee !== stealable.from_agent || task.status !== 'pending') return false;
      task.assignee = registeredName;
      task.status = 'in_progress';
      task.updated_at = new Date().toISOString();
      if (!task.attempt_agents) task.attempt_agents = [];
      if (!task.attempt_agents.includes(registeredName)) task.attempt_agents.push(registeredName);
      fs.writeFileSync(TASKS_FILE, JSON.stringify(freshTasks, null, 2));
      return true;
    });
    if (stolen) {
      return {
        type: 'stolen_task', priority: 'work_steal', task: stealable.task,
        from_agent: stealable.from_agent,
        instruction: stealable.message + ' Start working on it now.',
      };
    }
  }

  // 7. Short listen (30s max, NOT infinite) — configurable via env for testing
  const listenTimeout = parseInt(process.env.AGENT_BRIDGE_LISTEN_TIMEOUT) || 30000;
  const newMsgs = await listenWithTimeout(listenTimeout);
  if (newMsgs.length > 0) {
    return {
      type: 'messages', priority: 'respond',
      messages: newMsgs.slice(0, 10), total: newMsgs.length,
      instruction: 'New messages arrived. Process them, then call get_work() again.'
    };
  }

  // 8. Upcoming steps to prep for
  const upcoming = findUpcomingStepsForMe();
  if (upcoming) {
    return {
      type: 'prep_work', priority: 'proactive', step: upcoming,
      instruction: `Your next workflow step "${upcoming.description}" is coming up (Workflow: "${upcoming.workflow_name}"). Prepare for it: read relevant files, understand the dependencies, plan your approach.`
    };
  }

  // 9. Truly idle — try role rebalancing before returning
  rebalanceRoles(); // Item 5: check if workload requires role changes
  touchActivity();
  const idleResult = {
    type: 'idle',
    instruction: isManagedMode()
      ? 'No work available right now. Call listen() to wait for the manager to assign work or give you the floor.'
      : 'No work available right now. Call get_work() again in 30 seconds. Do NOT call listen_group() — use get_work() to stay in the proactive loop.'
  };
  // Item 4: warn demoted agents
  const agentRep = getReputation();
  if (agentRep[registeredName] && agentRep[registeredName].demoted) {
    idleResult.agent_warning = `You have ${agentRep[registeredName].consecutive_rejections} consecutive rejections. Focus on smaller, well-tested changes. Your next approval will reset this.`;
  }
  if (refresh) idleResult.context_refresh = refresh;
  if (backpressure) idleResult.backpressure = backpressure;
  return idleResult;
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
  if (wf.status !== 'active') return { error: 'Workflow is not active' };

  const currentStep = wf.steps.find(s => s.assignee === registeredName && s.status === 'in_progress');
  if (!currentStep) return { error: 'No active step assigned to you in this workflow.' };

  // Record verification on the step
  currentStep.verification = {
    summary, verification, files_changed: files_changed || [],
    confidence, learnings: learnings || null,
    verified_at: new Date().toISOString(), verified_by: registeredName,
  };

  // Save learnings to KB
  if (learnings) {
    const kb = getKB();
    const key = `skill_${registeredName}_${Date.now().toString(36)}`;
    kb[key] = { content: learnings, updated_by: registeredName, updated_at: new Date().toISOString() };
    if (Object.keys(kb).length <= 100) writeJsonFile(KB_FILE, kb);
  }

  // Helper: advance to next steps and send handoffs
  function advanceToNextSteps(flagged) {
    const nextSteps = findReadySteps(wf);
    if (nextSteps.length === 0 && wf.steps.every(s => s.status === 'done')) {
      wf.status = 'completed';
      wf.completed_at = new Date().toISOString();
      wf.updated_at = new Date().toISOString();
      saveWorkflows(workflows);
      broadcastSystemMessage(`[WORKFLOW COMPLETE] "${wf.name}" finished${flagged ? ' (with flagged steps)' : ''}! All ${wf.steps.length} steps done.`);
      const report = generateCompletionReport(wf);
      const retrospective = logRetrospective(wf.id); // Item 9: analyze retry patterns
      touchActivity();
      return { status: flagged ? 'workflow_complete_flagged' : 'workflow_complete', workflow_id: wf.id, report, retrospective, message: `Workflow "${wf.name}" finished! Call get_work() for your next assignment.` };
    }

    const agents = getAgents();
    for (const step of nextSteps) {
      step.status = 'in_progress';
      step.started_at = new Date().toISOString();
      if (step.assignee && agents[step.assignee] && step.assignee !== registeredName) {
        const handoffContent = `[Workflow "${wf.name}"] Your turn — Step ${step.id}: ${step.description}. Previous step completed by ${registeredName}${flagged ? ` (flagged: ${confidence}% confidence)` : ''}: ${summary}`;
        messageSeq++;
        const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: step.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
        fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
        fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
      }
    }
    wf.updated_at = new Date().toISOString();
    saveWorkflows(workflows);
    touchActivity();
    return {
      status: flagged ? 'advanced_with_flag' : 'advanced', workflow_id: wf.id,
      completed_step: currentStep.id,
      next_steps: nextSteps.map(s => ({ id: s.id, description: s.description, assignee: s.assignee })),
      message: flagged ? 'Advanced but flagged for later review. Call get_work().' : 'Step complete. Next step(s) kicked off. Call get_work() for your next assignment.'
    };
  }

  if (confidence >= 70) {
    // AUTO-ADVANCE
    currentStep.status = 'done';
    currentStep.completed_at = new Date().toISOString();
    clearCheckpoint(registeredName, workflow_id, currentStep.id); // Item 8: clear checkpoint on completion
    return advanceToNextSteps(false);
  }

  if (confidence >= 40) {
    // ADVANCE BUT FLAG
    currentStep.status = 'done';
    currentStep.completed_at = new Date().toISOString();
    currentStep.flagged = true;
    currentStep.flag_reason = `Low confidence (${confidence}%). May need review later.`;
    clearCheckpoint(registeredName, workflow_id, currentStep.id); // Item 8: clear checkpoint
    return advanceToNextSteps(true);
  }

  // LOW CONFIDENCE — ask for help
  wf.updated_at = new Date().toISOString();
  saveWorkflows(workflows);
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
  const kb = getKB();
  const key = `lesson_${registeredName}_${Date.now().toString(36)}`;
  const lessonContent = JSON.stringify({
    context: task_or_step,
    lesson: `Approach "${what_failed}" failed because: ${why_it_failed}. Better approach: ${new_approach}`,
    learned_by: registeredName,
  });
  kb[key] = { content: lessonContent, updated_by: registeredName, updated_at: new Date().toISOString() };
  if (Object.keys(kb).length <= 100) writeJsonFile(KB_FILE, kb);

  trackReputation(registeredName, 'retry');
  touchActivity();

  if (attempt >= 3) {
    // Max retries — escalate with FULL context so next agent doesn't start blind
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
      `Root cause: ${why_it_failed}\n\n` +
      `Team: someone with DIFFERENT expertise should take over. DO NOT repeat the same approaches. Use suggest_task() or claim the task.`
    );

    // Store full context in KB so get_work can attach it
    const kb2 = getKB();
    const escKey = `escalation_${Date.now().toString(36)}`;
    kb2[escKey] = {
      content: JSON.stringify({ task: task_or_step, attempts: allAttempts, escalated_by: registeredName }),
      updated_by: registeredName, updated_at: new Date().toISOString(),
    };
    if (Object.keys(kb2).length <= 100) writeJsonFile(KB_FILE, kb2);

    return {
      status: 'escalated', attempt_number: attempt,
      message: 'Escalated to team with full failure context. Call get_work() to pick up other work while someone else handles this.',
      attempts: allAttempts,
      failure_context: attemptSummary,
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

function reassignWorkFrom(deadAgentName) {
  const workflows = getWorkflows();
  let reassignCount = 0;
  const agents = getAgents();
  const aliveNames = Object.entries(agents)
    .filter(([name, a]) => name !== deadAgentName && isPidAlive(a.pid, a.last_activity))
    .map(([name]) => name);

  for (const wf of workflows) {
    if (wf.status !== 'active') continue;
    for (const step of wf.steps) {
      if (step.assignee !== deadAgentName || step.status !== 'in_progress') continue;
      // Find replacement — round-robin through alive agents
      if (aliveNames.length > 0) {
        const replacement = aliveNames[reassignCount % aliveNames.length];
        step.assignee = replacement;
        reassignCount++;
        // Send handoff to replacement
        const handoffContent = `[AUTO-REASSIGN] ${deadAgentName} went offline. Their step "${step.description}" has been reassigned to you.`;
        messageSeq++;
        const msg = { id: generateId(), seq: messageSeq, from: '__system__', to: replacement, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff', system: true };
        fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
        fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
      }
    }
  }

  // Also reassign tasks
  const tasks = getTasks();
  for (const task of tasks) {
    if (task.assignee !== deadAgentName || task.status !== 'in_progress') continue;
    task.assignee = null; // Unassign so get_work can claim it
    task.status = 'pending';
    task.updated_at = new Date().toISOString();
    reassignCount++;
  }
  if (reassignCount > 0) {
    saveWorkflows(workflows);
    saveTasks(tasks);
  }
  return reassignCount;
}

function watchdogCheck() {
  // Run in autonomous mode always, AND in group mode when agents are idle 5+ min
  if (!isAutonomousMode() && !isGroupMode()) return;
  if (!amIWatchdog()) return;

  const agents = getAgents();
  const now = Date.now();
  let agentsChanged = false;

  for (const [name, agent] of Object.entries(agents)) {
    if (name === registeredName) continue;
    if (!isPidAlive(agent.pid, agent.last_activity)) continue;

    const idleTime = now - new Date(agent.last_activity).getTime();

    // IDLE > 2 minutes: nudge
    if (idleTime > 120000 && !agent.watchdog_nudged) {
      sendSystemMessage(name,
        `[WATCHDOG] You've been idle for ${Math.round(idleTime / 60000)} minutes. Call get_work() to find your next task. Never be idle.`
      );
      trackReputation(name, 'watchdog_nudge');
      agent.watchdog_nudged = now;
      agentsChanged = true;
    }

    // IDLE > 5 minutes: stronger nudge
    if (idleTime > 300000 && !agent.watchdog_hard_nudged) {
      sendSystemMessage(name,
        `[WATCHDOG] You've been idle for ${Math.round(idleTime / 60000)} minutes. Call get_work() NOW or your work will be reassigned.`
      );
      agent.watchdog_hard_nudged = now;
      agentsChanged = true;
    }

    // IDLE > 10 minutes: reassign their work
    if (idleTime > 600000 && !agent.watchdog_reassigned) {
      const count = reassignWorkFrom(name);
      broadcastSystemMessage(`[WATCHDOG] ${name} has been unresponsive for 10+ minutes. ${count} task(s) reassigned.`);
      agent.watchdog_reassigned = now;
      agentsChanged = true;
    }
  }

  // Check for stuck workflow steps
  const workflows = getWorkflows();
  let workflowsChanged = false;
  for (const wf of workflows) {
    if (wf.status !== 'active') continue;
    for (const step of wf.steps) {
      if (step.status !== 'in_progress' || !step.started_at) continue;
      const stepAge = now - new Date(step.started_at).getTime();

      // Step > 15 minutes: ping assignee
      if (stepAge > 900000 && !step.watchdog_pinged) {
        if (step.assignee) {
          sendSystemMessage(step.assignee,
            `[WATCHDOG] Step "${step.description}" has been in progress for ${Math.round(stepAge / 60000)} minutes. Report status: are you stuck? Do you need help?`
          );
        }
        step.watchdog_pinged = true;
        workflowsChanged = true;
      }

      // Step > 30 minutes: escalate
      if (stepAge > 1800000 && !step.watchdog_escalated) {
        broadcastSystemMessage(
          `[WATCHDOG ESCALATION] Step "${step.description}" (${step.assignee}) has been running for ${Math.round(stepAge / 60000)} minutes. ` +
          `Team: someone check if ${step.assignee} needs help or if the step should be reassigned.`
        );
        step.watchdog_escalated = true;
        workflowsChanged = true;
      }
    }
  }

  // Dynamic team rebalancing: move idle workers from quiet teams to busy teams
  try {
    const channels = getChannelsData();
    const teamChannels = Object.entries(channels).filter(([, c]) => c.auto_team);
    if (teamChannels.length >= 2) {
      const tasks = getTasks();
      const teamLoad = teamChannels.map(([name, ch]) => {
        const memberTasks = tasks.filter(t => t.status === 'pending' && ch.members && ch.members.includes(t.assignee));
        const idleMembers = (ch.members || []).filter(m => {
          const a = agents[m];
          if (!a || !isPidAlive(a.pid, a.last_activity)) return false;
          return (now - new Date(a.last_activity).getTime()) > 120000; // idle 2+ min
        });
        return { name, members: ch.members || [], pendingTasks: memberTasks.length, idleMembers };
      });
      const busyTeam = teamLoad.find(t => t.pendingTasks >= 5);
      const quietTeam = teamLoad.find(t => t.pendingTasks === 0 && t.idleMembers.length > 0);
      if (busyTeam && quietTeam && quietTeam.idleMembers.length > 0) {
        const worker = quietTeam.idleMembers[0];
        // Move worker to busy team
        const quietCh = channels[quietTeam.name];
        const busyCh = channels[busyTeam.name];
        if (quietCh.members) quietCh.members = quietCh.members.filter(m => m !== worker);
        if (busyCh.members && !busyCh.members.includes(worker)) busyCh.members.push(worker);
        saveChannelsData(channels);
        sendSystemMessage(worker, `[REBALANCE] You've been moved from ${quietTeam.name} to ${busyTeam.name} — they have ${busyTeam.pendingTasks} pending tasks and need help.`);
      }
    }
  } catch {}

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
  if (workflowsChanged) saveWorkflows(workflows);
}

// --- Monitor Agent: system health check ---

function monitorHealthCheck() {
  if (!registeredName) return { error: 'You must call register() first' };

  const agents = getAgents();
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
      health.circular_escalations.push({
        task_id: task.id, title: task.title,
        agents_tried: task.attempt_agents, attempts: task.attempt_agents.length,
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

  // 5. Auto-interventions
  // Reassign circular escalations to fresh agents
  for (const circ of health.circular_escalations) {
    const freshAgents = aliveNames.filter(n => !circ.agents_tried.includes(n));
    if (freshAgents.length > 0) {
      const task = tasks.find(t => t.id === circ.task_id);
      if (task && task.status === 'pending') {
        task.assignee = freshAgents[0];
        task.status = 'in_progress';
        task.updated_at = new Date().toISOString();
        health.interventions.push({ type: 'reassign_circular', task: circ.title, to: freshAgents[0] });
      }
    }
  }

  // Nudge idle agents
  for (const idle of health.agents_idle) {
    if (idle.idle_minutes >= 5) {
      sendSystemMessage(idle.name, `[MONITOR] You've been idle for ${idle.idle_minutes} minutes. Call get_work() immediately.`);
      health.interventions.push({ type: 'nudge_idle', agent: idle.name, idle_minutes: idle.idle_minutes });
    }
  }

  if (health.interventions.length > 0) saveTasks(tasks);

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
      ? `Performed ${health.interventions.length} intervention(s). Call monitorHealthCheck() again in 30 seconds.`
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
  const decisions = (readJsonFile(DECISIONS_FILE) || []).slice(-5);

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
  const kb2 = getKB();
  kb2[reportKey] = { content: JSON.stringify(report), updated_by: '__system__', updated_at: new Date().toISOString() };
  if (Object.keys(kb2).length <= 100) writeJsonFile(KB_FILE, kb2);

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
      if (!currentProfiles[name]) currentProfiles[name] = { display_name: name, avatar: getDefaultAvatar(name), bio: '', role: '', created_at: new Date().toISOString() };
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
      profiles[agentName] = { display_name: agentName, avatar: getDefaultAvatar(agentName), bio: '', role: '', created_at: new Date().toISOString() };
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
  const reviews = readJsonFile(REVIEWS_FILE) || [];
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
    kb[retroKey] = {
      content: `RETROSPECTIVE INSIGHTS: ${insights.join(' | ')}`,
      updated_by: 'system',
      updated_at: new Date().toISOString(),
    };
    if (Object.keys(kb).length <= 200) writeJsonFile(KB_FILE, kb);
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
  const tasks = getTasks();
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
  tasks.push(planTask);
  saveTasks(tasks);

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

  const branches = getBranches();
  if (Object.keys(branches).length >= 100) return { error: 'Branch limit reached (max 100).' };
  if (branches[branchName]) return { error: `Branch "${branchName}" already exists` };

  // Full read required when forking from a specific message (need index into full history).
  // When forking from end (no fromMessageId), use tailReadJsonl for performance.
  const history = fromMessageId ? readJsonl(getHistoryFile(currentBranch)) : tailReadJsonl(getHistoryFile(currentBranch), 500);
  const forkIdx = fromMessageId ? history.findIndex(m => m.id === fromMessageId) : history.length - 1;
  if (forkIdx === -1) return { error: `Message ${fromMessageId} not found in current branch` };

  // Copy history up to fork point into new branch
  const forkedHistory = history.slice(0, forkIdx + 1);
  ensureDataDir();
  const newHistFile = getHistoryFile(branchName);
  const newMsgFile = getMessagesFile(branchName);
  fs.writeFileSync(newHistFile, forkedHistory.map(m => JSON.stringify(m)).join('\n') + (forkedHistory.length ? '\n' : ''));
  fs.writeFileSync(newMsgFile, ''); // empty messages for new branch

  branches[branchName] = {
    created_at: new Date().toISOString(),
    created_by: registeredName,
    forked_from: currentBranch,
    fork_point: fromMessageId || (history[forkIdx] ? history[forkIdx].id : null),
    message_count: forkedHistory.length,
  };
  saveBranches(branches);

  // Switch this agent to the new branch
  currentBranch = branchName;
  lastReadOffset = 0;
  try {
    lockAgentsFile();
    try {
      const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      if (agents[registeredName]) {
        agents[registeredName].branch = branchName;
        agents[registeredName].last_activity = new Date().toISOString();
        saveAgents(agents);
      }
    } finally { unlockAgentsFile(); }
  } catch {}

  return { success: true, branch: branchName, forked_from: branches[branchName].forked_from, messages_copied: forkedHistory.length };
}

function toolSwitchBranch(branchName) {
  if (!registeredName) return { error: 'You must call register() first' };
  try { sanitizeName(branchName); } catch (e) { return { error: e.message }; }

  const branches = getBranches();
  if (!branches[branchName]) return { error: `Branch "${branchName}" does not exist. Use list_branches to see available branches.` };

  currentBranch = branchName;
  lastReadOffset = 0;
  try {
    lockAgentsFile();
    try {
      const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      if (agents[registeredName]) {
        agents[registeredName].branch = branchName;
        agents[registeredName].last_activity = new Date().toISOString();
        saveAgents(agents);
      }
    } finally { unlockAgentsFile(); }
  } catch {}

  return { success: true, branch: branchName, message: `Switched to branch "${branchName}". Read offset reset.` };
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
function readJsonFile(file) { if (!fs.existsSync(file)) return null; try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
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
  ensureDataDir();
  const str = JSON.stringify(data);
  if (str && str.length > 0) {
    fs.writeFileSync(file, str);
    // Auto-invalidate cache for this file
    const cacheKey = _fileCacheKeys[file];
    if (cacheKey) invalidateCache(cacheKey);
  }
}

function getDecisions() { return cachedRead('decisions', () => readJsonFile(DECISIONS_FILE) || [], 2000); }
function getKB() { return cachedRead('kb', () => readJsonFile(KB_FILE) || {}, 2000); }
function getLocks() { return cachedRead('locks', () => readJsonFile(LOCKS_FILE) || {}, 2000); }
function getProgressData() { return cachedRead('progress', () => readJsonFile(PROGRESS_FILE) || {}, 2000); }
function getVotes() { return cachedRead('votes', () => readJsonFile(VOTES_FILE) || [], 2000); }
function getReviews() { return cachedRead('reviews', () => readJsonFile(REVIEWS_FILE) || [], 2000); }
function getDeps() { return cachedRead('deps', () => readJsonFile(DEPS_FILE) || [], 2000); }
function getRules() { return cachedRead('rules', () => readJsonFile(RULES_FILE) || [], 2000); }

// --- Channel helpers ---
const CHANNELS_FILE_PATH = path.join(DATA_DIR, 'channels.json');

function getChannelsData() {
  return cachedRead('channels', () => {
    const data = readJsonFile(CHANNELS_FILE_PATH);
    if (!data) return { general: { description: 'General channel — all agents', members: ['*'], created_by: 'system', created_at: new Date().toISOString() } };
    return data;
  }, 3000);
}

function saveChannelsData(channels) { withFileLock(CHANNELS_FILE_PATH, () => { writeJsonFile(CHANNELS_FILE_PATH, channels); invalidateCache('channels'); }); }

function getChannelMessagesFile(channelName) {
  if (!channelName || channelName === 'general') return getMessagesFile(currentBranch);
  return path.join(DATA_DIR, 'channel-' + sanitizeName(channelName) + '-messages.jsonl');
}

function getChannelHistoryFile(channelName) {
  if (!channelName || channelName === 'general') return getHistoryFile(currentBranch);
  return path.join(DATA_DIR, 'channel-' + sanitizeName(channelName) + '-history.jsonl');
}

function isChannelMember(channelName, agentName) {
  const channels = getChannelsData();
  if (!channels[channelName]) return false;
  return channels[channelName].members.includes('*') || channels[channelName].members.includes(agentName);
}

function getAgentChannels(agentName) {
  const channels = getChannelsData();
  return Object.keys(channels).filter(ch => channels[ch].members.includes('*') || channels[ch].members.includes(agentName));
}

// Cleanup dead agents from channel membership (called from heartbeat)
function cleanStaleChannelMembers() {
  const channels = getChannelsData();
  const agents = getAgents();
  let changed = false;
  for (const [name, ch] of Object.entries(channels)) {
    if (name === 'general') continue; // general uses '*', no cleanup needed
    const before = ch.members.length;
    ch.members = ch.members.filter(m => m === '*' || (agents[m] && isPidAlive(agents[m].pid, agents[m].last_activity)));
    if (ch.members.length !== before) changed = true;
  }
  if (changed) saveChannelsData(channels);
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

// Auto-escalation: notify team about tasks blocked for >5 minutes
// Uses task.escalated_at field for cross-process dedup (file-based, not in-memory)
function escalateBlockedTasks() {
  try {
    const tasks = getTasks();
    const now = Date.now();
    let changed = false;
    for (const task of tasks) {
      if (task.status !== 'blocked') continue;
      if (task.escalated_at) continue; // already escalated (cross-process safe)
      const blockedSince = new Date(task.updated_at).getTime();
      if (now - blockedSince > 300000) { // 5 minutes
        task.escalated_at = new Date().toISOString();
        changed = true;
        broadcastSystemMessage(
          `[ESCALATION] Task "${task.title}" (assigned to ${task.assignee || 'unassigned'}) has been blocked for ${Math.round((now - blockedSince) / 60000)} minutes. Team: can anyone help unblock it?`,
          registeredName
        );
      }
    }
    if (changed) saveTasks(tasks);
  } catch {}
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
    const recoveryFile = path.join(DATA_DIR, `recovery-${name}.json`);
    if (fs.existsSync(recoveryFile)) continue; // already snapshotted
    try {
      const allTasks = getTasks();
      const tasks = allTasks.filter(t => t.assignee === name && (t.status === 'in_progress' || t.status === 'pending'));
      const locks = getLocks();
      const lockedFiles = Object.entries(locks).filter(([, l]) => l.agent === name).map(([f]) => f);
      const channels = getAgentChannels(name);
      const workspace = getWorkspace(name);
      // Scale fix: tail-read last 50 messages instead of entire history
      const history = tailReadJsonl(getHistoryFile(currentBranch), 50);
      const lastSent = history.filter(m => m.from === name).slice(-5).map(m => ({ to: m.to, content: m.content.substring(0, 200), timestamp: m.timestamp }));
      // Agent memory: decisions made, tasks completed, KB keys written
      const decisions = readJsonFile(DECISIONS_FILE) || [];
      const myDecisions = decisions.filter(d => d.decided_by === name).slice(-10).map(d => ({ decision: d.decision, reasoning: (d.reasoning || '').substring(0, 150), decided_at: d.decided_at }));
      const completedTasks = allTasks.filter(t => t.assignee === name && t.status === 'done').slice(-10).map(t => ({ id: t.id, title: t.title }));
      const kb = readJsonFile(KB_FILE) || {};
      const kbKeysWritten = Object.keys(kb).filter(k => kb[k] && kb[k].updated_by === name);
      // Only snapshot if there's meaningful state to recover
      if (tasks.length > 0 || lockedFiles.length > 0 || Object.keys(workspace).length > 0 || myDecisions.length > 0 || completedTasks.length > 0) {
        writeJsonFile(recoveryFile, {
          agent: name,
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

  return {
    briefing: true,
    conversation_mode: config.conversation_mode || 'direct',
    agents: roster,
    your_name: registeredName,
    recent_messages: recentMsgs,
    tasks: { active: activeTasks, completed_count: doneTasks, total: tasks.length },
    decisions: decisions.slice(-5).map(d => ({ decision: d.decision, topic: d.topic })),
    knowledge_base_keys: Object.keys(kb),
    locked_files: lockedFiles,
    progress,
    your_tasks: myActiveTasks.map(t => ({ id: t.id, title: t.title, status: t.status })),
    your_completed: myCompletedCount,
    hint: myActiveTasks.length > 0
      ? `You have ${myActiveTasks.length} active task(s). Continue working.`
      : 'You are now briefed. Check active tasks and start contributing.',
  };
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

  const decisions = getDecisions();
  const entry = {
    id: 'dec_' + generateId(),
    decision,
    reasoning: (reasoning || '').substring(0, 1000),
    topic: (topic || 'general').substring(0, 50),
    decided_by: registeredName,
    decided_at: new Date().toISOString(),
  };
  decisions.push(entry);
  if (decisions.length > 200) decisions.splice(0, decisions.length - 200); // cap
  writeJsonFile(DECISIONS_FILE, decisions);
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

  const kb = getKB();
  kb[key] = { content, updated_by: registeredName, updated_at: new Date().toISOString() };
  if (Object.keys(kb).length > 100) return { error: 'Knowledge base full (max 100 keys)' };
  writeJsonFile(KB_FILE, kb);
  touchActivity();
  return { success: true, key, size: content.length, total_keys: Object.keys(kb).length };
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

  const progress = getProgressData();
  progress[feature] = {
    percent,
    notes: (notes || '').substring(0, 500),
    updated_by: registeredName,
    updated_at: new Date().toISOString(),
  };
  writeJsonFile(PROGRESS_FILE, progress);
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

  const votes = getVotes();
  if (votes.length >= 500) return { error: 'Vote limit reached (max 500).' };
  const vote = {
    id: 'vote_' + generateId(),
    question,
    options: options.map(o => String(o).substring(0, 50)),
    votes: {},
    status: 'open',
    created_by: registeredName,
    created_at: new Date().toISOString(),
  };
  votes.push(vote);
  writeJsonFile(VOTES_FILE, votes);

  // Notify all agents
  broadcastSystemMessage(`[VOTE] ${registeredName} started a vote: "${question}" — Options: ${vote.options.join(', ')}. Call cast_vote("${vote.id}", "your_choice") to vote.`, registeredName);
  touchActivity();
  return { success: true, vote_id: vote.id, question, options: vote.options, message: 'Vote created. All agents have been notified.' };
}

function toolCastVote(voteId, choice) {
  if (!registeredName) return { error: 'You must call register() first' };

  const votes = getVotes();
  const vote = votes.find(v => v.id === voteId);
  if (!vote) return { error: `Vote not found: ${voteId}` };
  if (vote.status !== 'open') return { error: 'Vote is already closed.' };
  if (!vote.options.includes(choice)) return { error: `Invalid choice. Options: ${vote.options.join(', ')}` };

  vote.votes[registeredName] = { choice, voted_at: new Date().toISOString() };

  // Check if all online agents have voted
  const agents = getAgents();
  const onlineAgents = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
  const allVoted = onlineAgents.every(n => vote.votes[n]);

  if (allVoted) {
    vote.status = 'closed';
    vote.closed_at = new Date().toISOString();
    // Count results
    const results = {};
    for (const opt of vote.options) results[opt] = 0;
    for (const v of Object.values(vote.votes)) results[v.choice]++;
    vote.results = results;
    const winner = Object.entries(results).sort((a, b) => b[1] - a[1])[0];
    broadcastSystemMessage(`[VOTE RESULT] "${vote.question}" — Winner: ${winner[0]} (${winner[1]} votes). Full results: ${JSON.stringify(results)}`);
  }

  writeJsonFile(VOTES_FILE, votes);
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

  const reviews = getReviews();
  if (reviews.length >= 500) return { error: 'Review limit reached (max 500).' };
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
  reviews.push(review);
  writeJsonFile(REVIEWS_FILE, reviews);

  // Notify all other agents
  broadcastSystemMessage(`[REVIEW] ${registeredName} requests review of "${review.file}": ${review.description || 'No description'}. Call submit_review("${review.id}", "approved"/"changes_requested", "your feedback") to review.`, registeredName);
  touchActivity();
  return { success: true, review_id: review.id, file: review.file, message: 'Review requested. Team has been notified.' };
}

function toolSubmitReview(reviewId, status, feedback) {
  if (!registeredName) return { error: 'You must call register() first' };

  const validStatuses = ['approved', 'changes_requested'];
  if (!validStatuses.includes(status)) return { error: `Status must be: ${validStatuses.join(' or ')}` };

  const reviews = getReviews();
  const review = reviews.find(r => r.id === reviewId);
  if (!review) return { error: `Review not found: ${reviewId}` };
  if (review.requested_by === registeredName) return { error: 'Cannot review your own code.' };

  review.status = status;
  review.reviewer = registeredName;
  review.feedback = (feedback || '').substring(0, 2000);
  review.reviewed_at = new Date().toISOString();

  // Review → retry loop: track review rounds, auto-route feedback, auto-approve after 2 rounds
  if (status === 'changes_requested') {
    review.review_round = (review.review_round || 0) + 1;

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
  if (status === 'changes_requested' && review.review_round > 2) {
    review.status = 'approved';
    review.auto_approved = true;
    review.auto_approve_reason = `Auto-approved after ${review.review_round} review rounds (max 2 rounds exceeded).`;
    sendSystemMessage(review.requested_by, `[REVIEW] "${review.file}" auto-approved after ${review.review_round} review rounds. Flagged for later human review.`);
  }

  writeJsonFile(REVIEWS_FILE, reviews);
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

  const deps = getDeps();
  if (deps.length >= 1000) return { error: 'Dependency limit reached (max 1000).' };
  deps.push({
    id: 'dep_' + generateId(),
    task_id: taskId,
    depends_on: dependsOnTaskId,
    declared_by: registeredName,
    declared_at: new Date().toISOString(),
    resolved: depTask.status === 'done',
  });
  writeJsonFile(DEPS_FILE, deps);
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

function getCompressed() { return readJsonFile(COMPRESSED_FILE) || { segments: [], last_compressed_at: null }; }

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

  const compressed = getCompressed();
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
  writeJsonFile(COMPRESSED_FILE, compressed);
}

function toolGetCompressedHistory() {
  if (!registeredName) return { error: 'You must call register() first' };

  const compressed = getCompressed();
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
  const tasks = getTasks();
  const pendingTasks = tasks.filter(t => t.status === 'pending' && !t.assignee);
  const unassignedTasks = tasks.filter(t => t.status === 'pending');

  if (pendingTasks.length === 0 && unassignedTasks.length === 0) {
    // Check reviews
    const reviews = getReviews();
    const pendingReviews = reviews.filter(r => r.status === 'pending' && r.requested_by !== registeredName);
    if (pendingReviews.length > 0) {
      return { suggestion: 'review', review_id: pendingReviews[0].id, file: pendingReviews[0].file, message: `No pending tasks, but there's a code review waiting: "${pendingReviews[0].file}". Call submit_review() to review it.` };
    }
    // Check deps
    const deps = getDeps();
    const unresolved = deps.filter(d => !d.resolved);
    if (unresolved.length > 0) {
      return { suggestion: 'unblock', message: `No tasks available, but ${unresolved.length} task(s) are blocked by dependencies. Check if you can help resolve them.` };
    }
    return { suggestion: 'none', message: 'No pending tasks, reviews, or blocked items. Ask the team what needs doing next.' };
  }

  // Check current workload — don't suggest new tasks if already overloaded
  const myActiveTasks = tasks.filter(t => t.assignee === registeredName && t.status === 'in_progress');
  if (myActiveTasks.length >= 3) {
    return { suggestion: 'finish_first', your_active_tasks: myActiveTasks.map(t => ({ id: t.id, title: t.title })), message: `You already have ${myActiveTasks.length} tasks in progress. Finish one before taking more.` };
  }

  // Suggest based on reputation strengths
  if (myRep && myRep.strengths.includes('reviewer')) {
    const reviews = getReviews().filter(r => r.status === 'pending' && r.requested_by !== registeredName);
    if (reviews.length > 0) return { suggestion: 'review', review_id: reviews[0].id, file: reviews[0].file, message: `Based on your strengths (reviewer), review "${reviews[0].file}".` };
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
    return { suggestion: 'unblock_task', task: { id: blockedTasks[0].id, title: blockedTasks[0].title }, message: `No pending tasks, but "${blockedTasks[0].title}" is blocked. Can you help unblock it?` };
  }

  return {
    suggestion: 'task',
    task_id: suggested.id,
    title: suggested.title,
    description: suggested.description,
    message: `Suggested: "${suggested.title}". Call update_task("${suggested.id}", "in_progress") to claim it.`,
    ...(myKeywords.size > 0 && { match_reason: 'Based on your completed task history' }),
  };
}

// --- Rules system: project-level rules visible in dashboard and injected into agent guides ---

function toolAddRule(text, category = 'custom') {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!text || !text.trim()) return { error: 'Rule text cannot be empty' };
  const validCategories = ['safety', 'workflow', 'code-style', 'communication', 'custom'];
  if (!validCategories.includes(category)) return { error: `Category must be one of: ${validCategories.join(', ')}` };

  const rules = getRules();
  const rule = {
    id: 'rule_' + generateId(),
    text: text.trim(),
    category,
    created_by: registeredName,
    created_at: new Date().toISOString(),
    active: true,
  };
  rules.push(rule);
  writeJsonFile(RULES_FILE, rules);
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
  const rules = getRules();
  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx === -1) return { error: `Rule not found: ${ruleId}` };
  const removed = rules.splice(idx, 1)[0];
  writeJsonFile(RULES_FILE, rules);
  return { success: true, removed: removed.text.substring(0, 80), message: 'Rule removed.' };
}

function toolToggleRule(ruleId) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!ruleId) return { error: 'rule_id is required' };
  const rules = getRules();
  const rule = rules.find(r => r.id === ruleId);
  if (!rule) return { error: `Rule not found: ${ruleId}` };
  rule.active = !rule.active;
  writeJsonFile(RULES_FILE, rules);
  return { success: true, rule_id: ruleId, active: rule.active, message: `Rule ${rule.active ? 'activated' : 'deactivated'}.` };
}

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '5.2.2' },
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
        description: 'Listen for messages (Codex CLI compatible). Same as listen() but returns after 90 seconds if no message arrives, with retry:true. Codex agents should call this in a loop instead of listen(). When you get retry:true, immediately call listen_codex() again.',
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
        name: 'check_messages',
        description: 'Non-blocking peek at unconsumed messages addressed to you. Does not mark them as read.',
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
        description: 'Update your agent profile (display name, avatar, bio, role, appearance). Profile data is shown in the dashboard and virtual office.',
        inputSchema: {
          type: 'object',
          properties: {
            display_name: { type: 'string', description: 'Display name (max 30 chars)' },
            avatar: { type: 'string', description: 'Avatar URL or data URI (max 64KB)' },
            bio: { type: 'string', description: 'Short bio (max 200 chars)' },
            role: { type: 'string', description: 'Role/title (max 30 chars, e.g. "Architect", "Reviewer")' },
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
        description: 'Mark the current step as done and start the next step. Auto-sends a handoff message to the next assignee.',
        inputSchema: {
          type: 'object',
          properties: {
            workflow_id: { type: 'string', description: 'Workflow ID' },
            notes: { type: 'string', description: 'Optional completion notes (max 500 chars)' },
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
        result = toolUpdateTask(args.task_id, args.status, args?.notes);
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
        result = toolUpdateProfile(args?.display_name, args?.avatar, args?.bio, args?.role, args?.appearance);
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
        result = toolAdvanceWorkflow(args.workflow_id, args?.notes);
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
      const decisions = readJsonFile(DECISIONS_FILE) || [];
      const myDecisions = decisions.filter(d => d.decided_by === registeredName).slice(-10).map(d => ({ decision: d.decision, reasoning: (d.reasoning || '').substring(0, 150), decided_at: d.decided_at }));
      const kb = readJsonFile(KB_FILE) || {};
      const kbKeysWritten = Object.keys(kb).filter(k => kb[k] && kb[k].updated_by === registeredName);
      const recentHistory = tailReadJsonl(getHistoryFile(currentBranch), 50);
      const lastSent = recentHistory.filter(m => m.from === registeredName).slice(-5).map(m => ({ to: m.to, content: m.content.substring(0, 200), timestamp: m.timestamp }));
      fs.writeFileSync(recoveryFile, JSON.stringify({
        agent: registeredName,
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
      const agents = getAgents();
      if (agents[registeredName]) {
        delete agents[registeredName];
        saveAgents(agents);
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
    console.error('Agent Bridge MCP server v5.2.2 running (66 tools)');
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
