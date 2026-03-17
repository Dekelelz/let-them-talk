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
// Plugins removed in v3.4.3 — unnecessary attack surface, CLIs have their own extension systems

// In-memory state for this process
let registeredName = null;
let registeredToken = null; // auth token for re-registration
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
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
  // Adaptive cooldown: scales with online agent count — max(500, N * 500)
  // 2 agents = 1s, 3 = 1.5s, 4 = 2s, 6 = 3s, 10 = 5s
  const configured = getConfig().group_cooldown;
  if (configured) return configured; // respect explicit config
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  return Math.max(500, aliveCount * 500);
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
  const agents = getAgents();
  for (const name of Object.keys(agents)) {
    if (name === excludeAgent) continue;
    sendSystemMessage(name, content);
  }
}

// Rate limiting — prevent broadcast storms and message flooding
const rateLimitWindow = 60000; // 1 minute window
const rateLimitMax = 30; // max 30 messages per minute per agent
let rateLimitMessages = []; // timestamps of recent messages

// Stuck detector — tracks recent error tool calls to detect loops
let recentErrorCalls = []; // { tool, argsHash, timestamp }

function checkRateLimit() {
  const now = Date.now();
  rateLimitMessages = rateLimitMessages.filter(t => now - t < rateLimitWindow);
  if (rateLimitMessages.length >= rateLimitMax) {
    return { error: `Rate limit exceeded: max ${rateLimitMax} messages per minute. Wait before sending more.` };
  }
  rateLimitMessages.push(now);
  return null;
}

// --- Helpers ---

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

const RESERVED_NAMES = ['__system__', '__all__', '__open__', '__close__', 'system'];

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
  fs.writeFileSync(consumedFile(agentName), JSON.stringify([...ids]));
}

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

// File-based lock for agents.json (prevents registration race conditions)
const AGENTS_LOCK = AGENTS_FILE + '.lock';
function lockAgentsFile() {
  const maxWait = 5000; const start = Date.now();
  while (Date.now() - start < maxWait) {
    try { fs.writeFileSync(AGENTS_LOCK, String(process.pid), { flag: 'wx' }); return true; }
    catch { /* lock exists, wait */ }
    const wait = Date.now(); while (Date.now() - wait < 50) {} // busy-wait 50ms
  }
  // Force-break stale lock after timeout
  try { fs.unlinkSync(AGENTS_LOCK); } catch {}
  try { fs.writeFileSync(AGENTS_LOCK, String(process.pid), { flag: 'wx' }); return true; } catch {}
  return false;
}
function unlockAgentsFile() { try { fs.unlinkSync(AGENTS_LOCK); } catch {} }

function getAgents() {
  return cachedRead('agents', () => {
    if (!fs.existsSync(AGENTS_FILE)) return {};
    try { return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8')); } catch { return {}; }
  }, 1500);
}

function saveAgents(agents) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents));
  invalidateCache('agents');
}

function getAcks() {
  if (!fs.existsSync(ACKS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(ACKS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function isPidAlive(pid, lastActivity) {
  try {
    process.kill(pid, 0);
    // On Windows, PIDs get reused. If the heartbeat stopped (no activity for 30s = 3 missed
    // heartbeats), treat as stale even if PID exists (it's likely a different process now)
    if (lastActivity) {
      const stale = Date.now() - new Date(lastActivity).getTime();
      if (stale > 30000) return false; // 30s = 3 missed heartbeats
    }
    return true;
  } catch {
    return false;
  }
}

const MAX_CONTENT_BYTES = 1000000; // 1 MB max message size

function validateContentSize(content) {
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
  if (!fs.existsSync(msgFile)) return { messages: [], newOffset: 0 };
  const stat = fs.statSync(msgFile);
  if (stat.size < fromOffset) return { messages: [], newOffset: 0 }; // file was truncated/replaced — reset offset
  if (stat.size === fromOffset) return { messages: [], newOffset: fromOffset };

  const fd = fs.openSync(msgFile, 'r');
  const buf = Buffer.alloc(stat.size - fromOffset);
  fs.readSync(fd, buf, 0, buf.length, fromOffset);
  fs.closeSync(fd);

  const chunk = buf.toString('utf8').trim();
  if (!chunk) return { messages: [], newOffset: stat.size };

  const messages = chunk.split('\n').map(line => {
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

  // Count total messages for context window management
  let totalMessages = 0;
  try {
    const histFile = getHistoryFile(currentBranch);
    if (fs.existsSync(histFile)) {
      const content = fs.readFileSync(histFile, 'utf8').trim();
      if (content) totalMessages = content.split('\n').length;
    }
  } catch {}

  const result = {
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
    message_count: totalMessages,
  };

  if (totalMessages > 50) {
    result.hint = 'Conversation is getting long (' + totalMessages + ' messages). Consider calling get_summary() to refresh your context.';
  }

  return result;
}

// Auto-compact messages.jsonl when it gets too large
// Keeps only unconsumed messages, moves everything else to history-only
function autoCompact() {
  const msgFile = getMessagesFile(currentBranch);
  if (!fs.existsSync(msgFile)) return;
  try {
    const content = fs.readFileSync(msgFile, 'utf8').trim();
    if (!content) return;
    const lines = content.split('\n');
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
  const messages = readJsonl(getMessagesFile(currentBranch));
  const consumed = getConsumedIds(agentName);
  const perms = getPermissions();
  return messages.filter(m => {
    if (m.to !== agentName && m.to !== '__group__' && m.to !== '__all__') return false;
    // Skip own group messages
    if (m.to === '__group__' && m.from === agentName) return false;
    if (consumed.has(m.id)) return false;
    if (fromFilter && m.from !== fromFilter && !m.system) return false;
    // Permission check: skip messages from senders this agent can't read
    if (perms[agentName] && perms[agentName].can_read) {
      const allowed = perms[agentName].can_read;
      if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(m.from) && !m.system) return false;
    }
    return true;
  });
}

// --- Profile helpers ---

function getProfiles() {
  if (!fs.existsSync(PROFILES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PROFILES_FILE, 'utf8')); } catch { return {}; }
}

function saveProfiles(profiles) {
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
  if (!fs.existsSync(WORKSPACES_DIR)) fs.mkdirSync(WORKSPACES_DIR, { recursive: true });
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
  if (!fs.existsSync(WORKFLOWS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8')); } catch { return []; }
}

function saveWorkflows(workflows) {
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows));
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

function buildGuide(level = 'standard') {
  const agents = getAgents();
  const aliveCount = Object.values(agents).filter(a => isPidAlive(a.pid, a.last_activity)).length;
  const mode = getConfig().conversation_mode || 'direct';
  const channels = getChannelsData();
  const hasChannels = Object.keys(channels).length > 1; // more than just #general

  const rules = [];

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
      if (content) projectRules = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(l => l.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    } catch {}
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

    // Clean up old registration if re-registering with a different name
    if (registeredName && registeredName !== name && agents[registeredName] && agents[registeredName].pid === process.pid) {
      delete agents[registeredName];
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
      const agents = getAgents();
      if (agents[registeredName]) {
        lockAgentsFile();
        try {
          const freshAgents = getAgents(); // re-read inside lock
          if (freshAgents[registeredName]) {
            freshAgents[registeredName].last_activity = new Date().toISOString();
            saveAgents(freshAgents);
          }
        } finally { unlockAgentsFile(); }
      }
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
    const recentHistory = readJsonl(getHistoryFile(currentBranch));
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

    return result;
  } finally {
    unlockAgentsFile();
  }
}

// Update last_activity timestamp for this agent
// Uses file lock to prevent race with heartbeat writes
function touchActivity() {
  if (!registeredName) return;
  try {
    lockAgentsFile();
    try {
      const agents = JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
      if (agents[registeredName]) {
        agents[registeredName].last_activity = new Date().toISOString();
        saveAgents(agents);
      }
    } finally { unlockAgentsFile(); }
  } catch {}
}

// Set or clear the listening_since flag
function setListening(isListening) {
  if (!registeredName) return;
  try {
    const agents = getAgents();
    if (agents[registeredName]) {
      agents[registeredName].listening_since = isListening ? new Date().toISOString() : null;
      // Persist last_listened_at so other agents can detect unresponsive agents
      if (isListening) {
        agents[registeredName].last_listened_at = new Date().toISOString();
      }
      saveAgents(agents);
    }
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

  const rateErr = checkRateLimit();
  if (rateErr) return rateErr;

  // Send-after-listen enforcement: must call listen_group between sends in group mode
  if (isGroupMode() && sendsSinceLastListen >= sendLimit) {
    return { error: `You must call listen_group() before sending again. You've sent ${sendsSinceLastListen} message(s) without listening. This prevents message storms.` };
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
    let cooldown = Math.max(500, memberCount * 500); // base: per-channel adaptive
    // Split cooldown: reply_to addressed = fast lane, unaddressed = slow lane
    if (reply_to) {
      const allMsgs = readJsonl(channel ? getChannelMessagesFile(channel) : getMessagesFile(currentBranch));
      const refMsg = allMsgs.find(m => m.id === reply_to);
      if (refMsg && refMsg.addressed_to && refMsg.addressed_to.includes(registeredName)) {
        cooldown = 500; // fast lane: I was addressed
      } else {
        cooldown = Math.max(2000, memberCount * 1000); // slow lane
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
      const chMsgs = readJsonl(getChannelMessagesFile(channel));
      referencedMsg = chMsgs.find(m => m.id === reply_to);
    }
    if (!referencedMsg) {
      const allMsgs = readJsonl(getMessagesFile(currentBranch));
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
      const decisions = readJsonFile(path.join(DATA_DIR, 'decisions.json')) || [];
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
  // Response budget hint
  if (isGroupMode() && unaddressedSends >= 2 && !msg.addressed_to) {
    result._budget_hint = 'Response budget depleted (2 unaddressed sends in 60s). Wait to be addressed or wait for budget reset.';
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
  if (isGroupMode() && sendsSinceLastListen >= sendLimit) {
    return { error: `You must call listen_group() before broadcasting again. You've sent ${sendsSinceLastListen} message(s) without listening.` };
  }

  const rateErr = checkRateLimit();
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
  timeoutSeconds = Math.min(Math.max(1, timeoutSeconds || 300), 3600);

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
    messages: unconsumed.map(m => ({
      id: m.id,
      from: m.from,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.reply_to && { reply_to: m.reply_to }),
      ...(m.thread_id && { thread_id: m.thread_id }),
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

  const history = readJsonl(getHistoryFile(currentBranch));
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

  // Poll indefinitely (in 5-min chunks to stay within any MCP limits)
  while (true) {
    const chunkDeadline = Date.now() + 300000; // 5 minutes
    let pollCount = 0;

    while (Date.now() < chunkDeadline) {
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
      await adaptiveSleep(pollCount++);
    }
    // No message in this 5-min chunk — loop again (stay listening)
  }
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
  const deadline = Date.now() + 90000; // 90 seconds — safely under Codex's 120s limit
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
    await adaptiveSleep(pollCount++);
  }

  // Still listening — tell agent to call again
  return {
    retry: true,
    message: 'No messages yet. Call listen_codex() again to keep waiting. You are still registered and listening.',
  };
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
  saveManagedConfig(managed);

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

  // Poll indefinitely (in 5-min chunks to stay within any MCP limits, same as listen())
  while (true) {
    const chunkDeadline = Date.now() + 300000;

  while (Date.now() < chunkDeadline) {
    // Collect ALL unconsumed messages from general + all subscribed channels
    const myChannels = getAgentChannels(registeredName);
    let messages = readJsonl(getMessagesFile(currentBranch));
    // Also read from channel-specific files
    for (const ch of myChannels) {
      if (ch === 'general') continue; // general uses the main messages file
      const chFile = getChannelMessagesFile(ch);
      if (fs.existsSync(chFile)) {
        const chMsgs = readJsonl(chFile);
        messages = messages.concat(chMsgs);
      }
    }
    // Sort by timestamp for consistent ordering
    messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const batch = [];
    for (const msg of messages) {
      if (consumed.has(msg.id)) continue;
      // Skip own messages in group mode (agent already knows what it sent)
      if (msg.to === '__group__' && msg.from === registeredName) { consumed.add(msg.id); continue; }
      if (msg.to !== registeredName && msg.to !== '__all__' && msg.to !== '__group__') continue;
      // Permission check
      const perms = getPermissions();
      if (perms[registeredName] && perms[registeredName].can_read) {
        const allowed = perms[registeredName].can_read;
        if (allowed !== '*' && Array.isArray(allowed) && !allowed.includes(msg.from) && !msg.system) continue;
      }
      batch.push(msg);
      consumed.add(msg.id);
      markAsRead(registeredName, msg.id);
    }

    if (batch.length > 0) {
      saveConsumedIds(registeredName, consumed);
      touchActivity();
      setListening(false);

      // Reset send counters: listening resets the send-after-listen enforcement
      sendsSinceLastListen = 0;
      // Set send limit based on whether any message addresses this agent
      const wasAddressed = batch.some(m => m.addressed_to && m.addressed_to.includes(registeredName));
      sendLimit = wasAddressed ? 2 : 1; // addressed = 2 sends (response + follow-up), otherwise 1

      // Post-receive stagger: deterministic delay based on agent name
      // Prevents all agents from responding simultaneously to the same batch
      const staggerMs = hashStagger(registeredName);
      if (staggerMs > 0) {
        await new Promise(r => setTimeout(r, staggerMs));
      }

      // Sort batch by priority: system > threaded replies > direct > broadcast
      // Within each category, maintain chronological order
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

      // Count agents first (needed by smart context sizing)
      const agents = getAgents();
      const agentNames = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));

      // Smart context — priority partitions instead of dumb chronological
      const history = readJsonl(getHistoryFile(currentBranch));
      const contextSize = Math.min(50, Math.max(20, agentNames.length * 5));
      const myChannels = getAgentChannels(registeredName);
      const seen = new Set();

      // Bucket A: messages addressed to me (sacred — always included, up to 10)
      const bucketA = history.filter(m => m.addressed_to && m.addressed_to.includes(registeredName)).slice(-10);
      bucketA.forEach(m => seen.add(m.id));

      // Bucket B: messages from my channels (capped to fit after A)
      const maxB = Math.min(15, contextSize - bucketA.length);
      const bucketB = maxB > 0 ? history.filter(m => m.channel && myChannels.includes(m.channel) && !seen.has(m.id)).slice(-maxB) : [];
      bucketB.forEach(m => seen.add(m.id));

      // Bucket C: recent chronological (fill remaining after A+B)
      const remaining = contextSize - bucketA.length - bucketB.length;
      const bucketC = remaining > 0 ? history.filter(m => !seen.has(m.id)).slice(-remaining) : [];

      // Merge and sort — total guaranteed <= contextSize, A always survives
      const smartHistory = [...bucketA, ...bucketB, ...bucketC].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      const recentHistory = smartHistory.map(m => ({
        from: m.from, to: m.to, content: m.content.substring(0, 500),
        timestamp: m.timestamp, id: m.id,
        ...(m.channel && { channel: m.channel }),
        ...(m.addressed_to && { addressed_to: m.addressed_to }),
      }));

      // Who hasn't spoken recently (agents/agentNames already declared above)
      const recentSpeakers = new Set(history.slice(-10).map(m => m.from));
      const silent = agentNames.filter(n => !recentSpeakers.has(n) && n !== registeredName);

      // KB hints: check if batch messages mention KB topics
      let kbHints = [];
      try {
        const kb = getKB();
        const kbKeys = Object.keys(kb);
        if (kbKeys.length > 0) {
          const batchText = batch.map(m => m.content).join(' ').toLowerCase();
          kbHints = kbKeys.filter(k => batchText.includes(k.toLowerCase().replace(/[-_.]/g, ' '))).slice(0, 3);
        }
      } catch {}

      const now = Date.now();
      const result = {
        messages: batch.map(m => {
          const ageMs = now - new Date(m.timestamp).getTime();
          const ageSec = Math.round(ageMs / 1000);
          return {
            id: m.id, from: m.from, to: m.to, content: m.content,
            timestamp: m.timestamp,
            age_seconds: ageSec,
            ...(ageSec > 30 && { delayed: true }),
            ...(m.reply_to && {
              reply_to: m.reply_to,
              // Thread context: include parent message preview so recipients have context
              _reply_context: (() => {
                const parent = history.find(h => h.id === m.reply_to);
                return parent ? `${parent.from}: "${parent.content.substring(0, 100)}..."` : null;
              })(),
            }),
            ...(m.thread_id && { thread_id: m.thread_id }),
            // addressed_to hint for group messages
            ...(m.addressed_to && { addressed_to: m.addressed_to }),
            ...(m.to === '__group__' && {
              addressed_to_you: !m.addressed_to || m.addressed_to.includes(registeredName),
              should_respond: !m.addressed_to || m.addressed_to.includes(registeredName),
            }),
          };
        }),
        message_count: batch.length,
        batch_summary: batchSummary,
        context: recentHistory,
        agents_online: agentNames.length,
        agents_silent: silent,
        agents_status: agentNames.reduce(function(acc, n) {
          if (agents[n].listening_since) {
            acc[n] = 'listening';
          } else {
            // Check for unresponsive: not listening, >2min since last listen
            const lastListened = agents[n].last_listened_at;
            const sinceLastListen = lastListened ? Date.now() - new Date(lastListened).getTime() : Infinity;
            if (sinceLastListen > 120000) {
              acc[n] = 'unresponsive';
            } else {
              acc[n] = 'working';
            }
          }
          return acc;
        }, {}),
        hint: silent.length > 0
          ? `${silent.join(', ')} haven't spoken recently. Consider addressing them.`
          : 'All agents are active in the conversation.',
      };

      // Managed mode: add context so agents know whether to respond
      if (isManagedMode()) {
        const managed = getManagedConfig();
        const youHaveFloor = managed.turn_current === registeredName;
        const youAreManager = managed.manager === registeredName;

        result.managed_context = {
          phase: managed.phase,
          floor: managed.floor,
          manager: managed.manager,
          you_have_floor: youHaveFloor,
          you_are_manager: youAreManager,
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

      if (kbHints.length > 0) {
        result.kb_hints = kbHints.map(k => `Relevant KB entry: "${k}" — call kb_read("${k}") for context`);
      }
      result.next_action = 'After processing these messages and sending your response, call listen_group() again immediately. Never stop listening.';
      return result;
    }

    // Note: NO idle timeout here. listen_group blocks indefinitely until messages arrive.
    // Work suggestions are delivered via enhanced nudge on other tool calls, not by breaking listen.

    await adaptiveSleep(0);
  }
    // No message in this 5-min chunk — loop again (stay listening forever)
  }
}

function toolGetHistory(limit = 50, thread_id = null) {
  limit = Math.min(Math.max(1, limit || 50), 500);
  let history = readJsonl(getHistoryFile(currentBranch));
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
  invalidateCache('tasks');
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks));
}

function toolCreateTask(title, description = '', assignee = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
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

  const validStatuses = ['pending', 'in_progress', 'done', 'blocked'];
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
  const history = readJsonl(getHistoryFile(currentBranch));
  if (history.length === 0) {
    return { summary: 'No messages in conversation yet.', message_count: 0 };
  }

  const recent = history.slice(-lastN);
  const agents = [...new Set(history.map(m => m.from))];
  const threads = [...new Set(history.filter(m => m.thread_id).map(m => m.thread_id))];

  // Build condensed summary
  const lines = recent.map(m => {
    const preview = m.content.length > 150 ? m.content.substring(0, 150) + '...' : m.content;
    return `[${m.from} → ${m.to}]: ${preview}`;
  });

  return {
    total_messages: history.length,
    showing_last: recent.length,
    agents_involved: agents,
    thread_count: threads.length,
    first_message: history[0].timestamp,
    last_message: history[history.length - 1].timestamp,
    summary: lines.join('\n'),
  };
}

function toolSearchMessages(query, from = null, limit = 20) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (typeof query !== 'string' || query.length < 2) return { error: 'Query must be at least 2 characters' };
  if (query.length > 100) return { error: 'Query too long (max 100 chars)' };
  limit = Math.min(Math.max(1, limit || 20), 50);

  // Search general history + all channel history files
  let allMessages = readJsonl(getHistoryFile(currentBranch));
  try {
    const myChannels = getAgentChannels(registeredName);
    for (const ch of myChannels) {
      if (ch === 'general') continue;
      const chFile = getChannelHistoryFile(ch);
      if (fs.existsSync(chFile)) {
        const chMsgs = readJsonl(chFile);
        allMessages = allMessages.concat(chMsgs);
      }
    }
  } catch {}
  // Sort by timestamp descending for newest-first results
  allMessages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const queryLower = query.toLowerCase();
  const results = [];
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
  return { query, results_count: results.length, results, searched: allMessages.length };
}

function toolReset() {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  // Auto-archive before clearing — never lose conversations
  if (fs.existsSync(getHistoryFile('main'))) {
    const history = readJsonl(getHistoryFile('main'));
    if (history.length > 0) {
      const archiveDir = path.join(DATA_DIR, 'archives');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
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

function toolCreateWorkflow(name, steps) {
  if (!registeredName) return { error: 'You must call register() first' };
  if (!name || typeof name !== 'string' || name.length > 50) return { error: 'name must be 1-50 chars' };
  if (!Array.isArray(steps) || steps.length < 2 || steps.length > 20) return { error: 'steps must be array of 2-20 items' };

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
      status: i === 0 ? 'in_progress' : 'pending',
      started_at: i === 0 ? new Date().toISOString() : null,
      completed_at: null,
      notes: '',
    };
  });
  if (parsedSteps.includes(null)) return { error: 'Each step must have a description' };

  const workflow = {
    id: workflowId,
    name,
    steps: parsedSteps,
    status: 'active',
    created_by: registeredName,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  if (workflows.length >= 500) return { error: 'Workflow limit reached (max 500).' };
  workflows.push(workflow);
  ensureDataDir();
  saveWorkflows(workflows);

  // Auto-handoff to first step's assignee if set
  const firstStep = parsedSteps[0];
  if (firstStep.assignee && agents[firstStep.assignee] && firstStep.assignee !== registeredName) {
    const handoffContent = `[Workflow "${name}"] Step 1 assigned to you: ${firstStep.description}`;
    messageSeq++;
    const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: firstStep.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
    fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
    fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
  }
  touchActivity();

  return { success: true, workflow_id: workflowId, name, step_count: parsedSteps.length, current_step: 1 };
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

  // Find next pending step
  const nextStep = wf.steps.find(s => s.status === 'pending');
  if (nextStep) {
    nextStep.status = 'in_progress';
    nextStep.started_at = new Date().toISOString();

    // Auto-handoff to next assignee (respecting permissions)
    const agents = getAgents();
    if (nextStep.assignee && agents[nextStep.assignee] && nextStep.assignee !== registeredName && canSendTo(registeredName, nextStep.assignee)) {
      const handoffContent = `[Workflow "${wf.name}"] Step ${nextStep.id} assigned to you: ${nextStep.description}`;
      messageSeq++;
      const msg = { id: generateId(), seq: messageSeq, from: registeredName, to: nextStep.assignee, content: handoffContent, timestamp: new Date().toISOString(), type: 'handoff' };
      fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
      fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
    }
  } else {
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
    next_step: nextStep ? { id: nextStep.id, description: nextStep.description, assignee: nextStep.assignee } : null,
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
    return { workflow: wf, progress: `${doneCount}/${wf.steps.length} (${pct}%)` };
  }
  return {
    count: workflows.length,
    workflows: workflows.map(w => {
      const doneCount = w.steps.filter(s => s.status === 'done').length;
      return { id: w.id, name: w.name, status: w.status, steps: w.steps.length, done: doneCount, progress: Math.round((doneCount / w.steps.length) * 100) + '%' };
    }),
  };
}

// --- Phase 4: Branching tools ---

function toolForkConversation(fromMessageId, branchName) {
  if (!registeredName) return { error: 'You must call register() first' };
  sanitizeName(branchName);

  const branches = getBranches();
  if (Object.keys(branches).length >= 100) return { error: 'Branch limit reached (max 100).' };
  if (branches[branchName]) return { error: `Branch "${branchName}" already exists` };

  const history = readJsonl(getHistoryFile(currentBranch));
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
  const agents = getAgents();
  if (agents[registeredName]) {
    agents[registeredName].branch = branchName;
    saveAgents(agents);
  }
  touchActivity();

  return { success: true, branch: branchName, forked_from: branches[branchName].forked_from, messages_copied: forkedHistory.length };
}

function toolSwitchBranch(branchName) {
  if (!registeredName) return { error: 'You must call register() first' };

  const branches = getBranches();
  if (!branches[branchName]) return { error: `Branch "${branchName}" does not exist. Use list_branches to see available branches.` };

  currentBranch = branchName;
  lastReadOffset = 0;
  const agents = getAgents();
  if (agents[registeredName]) {
    agents[registeredName].branch = branchName;
    saveAgents(agents);
  }
  touchActivity();

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
      if (content) msgCount = content.split('\n').length;
    }
    result[name] = { ...info, message_count: msgCount, is_current: name === currentBranch };
  }
  return { branches: result, current: currentBranch };
}

// --- Tier 1: Briefing, File Locking, Decisions, Recovery ---

// Helpers for new data files
function readJsonFile(file) { if (!fs.existsSync(file)) return null; try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function writeJsonFile(file, data) { ensureDataDir(); fs.writeFileSync(file, JSON.stringify(data)); }

function getDecisions() { return readJsonFile(DECISIONS_FILE) || []; }
function getKB() { return readJsonFile(KB_FILE) || {}; }
function getLocks() { return readJsonFile(LOCKS_FILE) || {}; }
function getProgressData() { return readJsonFile(PROGRESS_FILE) || {}; }
function getVotes() { return readJsonFile(VOTES_FILE) || []; }
function getReviews() { return readJsonFile(REVIEWS_FILE) || []; }
function getDeps() { return readJsonFile(DEPS_FILE) || []; }

// --- Channel helpers ---
const CHANNELS_FILE_PATH = path.join(DATA_DIR, 'channels.json');

function getChannelsData() {
  return cachedRead('channels', () => {
    const data = readJsonFile(CHANNELS_FILE_PATH);
    if (!data) return { general: { description: 'General channel — all agents', members: ['*'], created_by: 'system', created_at: new Date().toISOString() } };
    return data;
  }, 3000);
}

function saveChannelsData(channels) { writeJsonFile(CHANNELS_FILE_PATH, channels); invalidateCache('channels'); }

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
      if (content) msgCount = content.split('\n').length;
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
      const history = readJsonl(getHistoryFile(currentBranch));
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
  const history = readJsonl(getHistoryFile(currentBranch));
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

  // Project files summary (scan cwd for key files)
  const projectFiles = [];
  try {
    const cwd = process.cwd();
    const scan = function(dir, depth) {
      if (depth > 2) return;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const rel = path.relative(cwd, path.join(dir, e.name));
        if (e.isDirectory()) { projectFiles.push(rel + '/'); scan(path.join(dir, e.name), depth + 1); }
        else if (e.isFile()) projectFiles.push(rel);
      }
    };
    scan(cwd, 0);
  } catch {}

  return {
    briefing: true,
    conversation_mode: config.conversation_mode || 'direct',
    agents: roster,
    your_name: registeredName,
    total_messages: history.length,
    recent_messages: recentMsgs,
    tasks: { active: activeTasks, completed_count: doneTasks, total: tasks.length },
    decisions: decisions.slice(-10),
    knowledge_base_keys: Object.keys(kb),
    locked_files: lockedFiles,
    progress,
    project_files: projectFiles.slice(0, 80),
    hint: 'You are now fully briefed. Check active tasks, read recent messages for context, and start contributing.',
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
  writeJsonFile(REVIEWS_FILE, reviews);

  // Notify requester
  const agents = getAgents();
  if (agents[review.requested_by]) {
    sendSystemMessage(review.requested_by, `[REVIEW] ${registeredName} ${status === 'approved' ? 'approved' : 'requested changes on'} "${review.file}": ${review.feedback || 'No feedback'}`);
  }
  touchActivity();
  return { success: true, review_id: reviewId, status, message: `Review submitted: ${status}` };
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
  const history = readJsonl(getHistoryFile(currentBranch));
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
  const history = readJsonl(getHistoryFile(currentBranch));
  const recent = history.slice(-20);

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
    total_messages: history.length,
    compressed_count: compressed.segments.reduce((s, seg) => s + seg.message_count, 0),
    recent_count: recent.length,
    hint: 'Compressed segments summarize older messages. Recent messages are shown verbatim.',
  };
}

// --- Agent Reputation ---

function getReputation() { return readJsonFile(REPUTATION_FILE) || {}; }

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

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '4.2.0' },
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
        description: 'Update a task status. Statuses: pending, in_progress, done, blocked.',
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
        description: 'Create a multi-step workflow pipeline. Each step can have a description and assignee. The first step auto-starts and the assignee receives a handoff message.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Workflow name (max 50 chars)' },
            steps: {
              type: 'array',
              description: 'Array of steps. Each step is a string (description) or {description, assignee}.',
              items: {
                oneOf: [
                  { type: 'string' },
                  { type: 'object', properties: { description: { type: 'string' }, assignee: { type: 'string' } }, required: ['description'] },
                ],
              },
            },
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
        result = toolCreateWorkflow(args.name, args.steps);
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
      const history = readJsonl(getHistoryFile(currentBranch));
      const lastSent = history.filter(m => m.from === registeredName).slice(-5).map(m => ({ to: m.to, content: m.content.substring(0, 200), timestamp: m.timestamp }));
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
  ensureDataDir();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Agent Bridge MCP server v4.1.0 running (57 tools)');
}

main().catch(console.error);
