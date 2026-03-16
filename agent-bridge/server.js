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
// Plugins removed in v3.4.3 — unnecessary attack surface, CLIs have their own extension systems

// In-memory state for this process
let registeredName = null;
let registeredToken = null; // auth token for re-registration
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
let heartbeatInterval = null; // heartbeat timer reference
let messageSeq = 0; // monotonic sequence counter for message ordering
let currentBranch = 'main'; // which branch this agent is on
let lastSentAt = 0; // timestamp of last sent message (for group cooldown)

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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

function isGroupMode() {
  const mode = getConfig().conversation_mode;
  return mode === 'group';
}

function getGroupCooldown() {
  return getConfig().group_cooldown || 3000; // default 3s
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
  if (!fs.existsSync(AGENTS_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(AGENTS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveAgents(agents) {
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(agents, null, 2));
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

    // Collect ALL consumed IDs across all agents
    const allConsumed = new Set();
    if (fs.existsSync(DATA_DIR)) {
      for (const f of fs.readdirSync(DATA_DIR)) {
        if (f.startsWith('consumed-') && f.endsWith('.json')) {
          try {
            const ids = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
            ids.forEach(id => allConsumed.add(id));
          } catch {}
        }
      }
    }

    // Keep only unconsumed messages (for direct messages, only the recipient consumes)
    const active = messages.filter(m => {
      if (!allConsumed.has(m.id)) return true;
      return false;
    });

    // Rewrite messages.jsonl atomically — write to temp file then rename
    const newContent = active.map(m => JSON.stringify(m)).join('\n') + (active.length ? '\n' : '');
    const tmpFile = msgFile + '.tmp';
    fs.writeFileSync(tmpFile, newContent);
    fs.renameSync(tmpFile, msgFile);
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
  fs.writeFileSync(READ_RECEIPTS_FILE, JSON.stringify(receipts, null, 2));
}

// Get unconsumed messages for an agent (full scan — used by check_messages and initial load)
function getUnconsumedMessages(agentName, fromFilter = null) {
  const messages = readJsonl(getMessagesFile(currentBranch));
  const consumed = getConsumedIds(agentName);
  const perms = getPermissions();
  return messages.filter(m => {
    if (m.to !== agentName) return false;
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
  fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
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
  fs.writeFileSync(path.join(WORKSPACES_DIR, `${sanitizeName(agentName)}.json`), JSON.stringify(data, null, 2));
}

// --- Workflow helpers ---

function getWorkflows() {
  if (!fs.existsSync(WORKFLOWS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(WORKFLOWS_FILE, 'utf8')); } catch { return []; }
}

function saveWorkflows(workflows) {
  fs.writeFileSync(WORKFLOWS_FILE, JSON.stringify(workflows, null, 2));
}

// --- Branch helpers ---

function getBranches() {
  if (!fs.existsSync(BRANCHES_FILE)) return { main: { created_at: new Date().toISOString(), created_by: 'system', forked_from: null, fork_point: null } };
  try { return JSON.parse(fs.readFileSync(BRANCHES_FILE, 'utf8')); } catch { return { main: { created_at: new Date().toISOString(), created_by: 'system', forked_from: null, fork_point: null } }; }
}

function saveBranches(branches) {
  fs.writeFileSync(BRANCHES_FILE, JSON.stringify(branches, null, 2));
}

function getMessagesFile(branch) {
  if (!branch || branch === 'main') return MESSAGES_FILE;
  return path.join(DATA_DIR, `branch-${sanitizeName(branch)}-messages.jsonl`);
}

function getHistoryFile(branch) {
  if (!branch || branch === 'main') return HISTORY_FILE;
  return path.join(DATA_DIR, `branch-${sanitizeName(branch)}-history.jsonl`);
}

// --- Tool implementations ---

function toolRegister(name, provider = null) {
  ensureDataDir();
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
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    try {
      const agents = getAgents();
      if (agents[registeredName]) {
        agents[registeredName].last_activity = new Date().toISOString();
        saveAgents(agents);
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
    } catch {}
  }, 10000);
  heartbeatInterval.unref(); // Don't prevent process exit

    return { success: true, message: `Registered as Agent ${name} (PID ${process.pid})` };
  } finally {
    unlockAgentsFile();
  }
}

// Update last_activity timestamp for this agent
function touchActivity() {
  if (!registeredName) return;
  try {
    const agents = getAgents();
    if (agents[registeredName]) {
      agents[registeredName].last_activity = new Date().toISOString();
      saveAgents(agents);
    }
  } catch {}
}

// Set or clear the listening_since flag
function setListening(isListening) {
  if (!registeredName) return;
  try {
    const agents = getAgents();
    if (agents[registeredName]) {
      agents[registeredName].listening_since = isListening ? new Date().toISOString() : null;
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
      provider: info.provider || 'unknown',
      branch: info.branch || 'main',
      display_name: profile.display_name || name,
      avatar: profile.avatar || getDefaultAvatar(name),
      role: profile.role || '',
      bio: profile.bio || '',
    };
  }
  return { agents: result };
}

async function toolSendMessage(content, to = null, reply_to = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  const rateErr = checkRateLimit();
  if (rateErr) return rateErr;

  // Group mode cooldown — prevent agents from responding too fast
  if (isGroupMode()) {
    const cooldown = getGroupCooldown();
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

  // Resolve threading
  let thread_id = null;
  if (reply_to) {
    const allMsgs = readJsonl(getMessagesFile(currentBranch));
    const referencedMsg = allMsgs.find(m => m.id === reply_to);
    if (referencedMsg) {
      thread_id = referencedMsg.thread_id || referencedMsg.id;
    } else {
      thread_id = reply_to; // referenced msg may be purged, use ID anyway
    }
  }

  messageSeq++;
  const msg = {
    id: generateId(),
    seq: messageSeq,
    from: registeredName,
    to,
    content,
    timestamp: new Date().toISOString(),
    ...(reply_to && { reply_to }),
    ...(thread_id && { thread_id }),
  };

  ensureDataDir();
  fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(msg) + '\n');
  fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(msg) + '\n');
  touchActivity();
  lastSentAt = Date.now();

  // In group mode, auto-broadcast: also write to all other agents' queues
  // Skip if this message is already a response to a broadcast (prevents cascade)
  // NEVER auto-broadcast in managed mode — manager controls communication flow
  if (isGroupMode() && !isManagedMode() && !reply_to && !msg.broadcast) {
    const otherRecipients = Object.keys(getAgents()).filter(n => n !== registeredName && n !== to);
    for (const other of otherRecipients) {
      if (!canSendTo(registeredName, other)) continue; // respect permissions
      const broadcastMsg = { ...msg, id: generateId(), to: other, broadcast: true, original_to: to };
      fs.appendFileSync(getMessagesFile(currentBranch), JSON.stringify(broadcastMsg) + '\n');
      fs.appendFileSync(getHistoryFile(currentBranch), JSON.stringify(broadcastMsg) + '\n');
    }
  }

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

  const result = { success: true, messageId: msg.id, from: msg.from, to: msg.to };
  if (currentBranch !== 'main') result.branch = currentBranch;
  if (!recipientAlive) {
    result.warning = `Agent "${to}" appears offline (PID not running). Message queued but may not be received until they reconnect.`;
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
  return {
    count: unconsumed.length,
    messages: unconsumed.map(m => ({
      id: m.id,
      from: m.from,
      content: m.content,
      timestamp: m.timestamp,
      ...(m.reply_to && { reply_to: m.reply_to }),
      ...(m.thread_id && { thread_id: m.thread_id }),
    })),
  };
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
  fs.writeFileSync(ACKS_FILE, JSON.stringify(acks, null, 2));
  touchActivity();

  return { success: true, message: `Message ${messageId} acknowledged` };
}

// Listen indefinitely — loops wait_for_reply in 5-min chunks until a message arrives
async function toolListen(from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
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

async function toolListenGroup(timeout_seconds = 300) {
  if (!registeredName) return { error: 'You must call register() first' };
  const timeoutMs = Math.min(Math.max(1, timeout_seconds || 300), 3600) * 1000;

  setListening(true);

  // Random stagger to prevent all agents from responding simultaneously (1-3s)
  const stagger = 1000 + Math.random() * 2000;
  await new Promise(r => setTimeout(r, stagger));

  const deadline = Date.now() + timeoutMs;
  const consumed = getConsumedIds(registeredName);

  while (Date.now() < deadline) {
    // Collect ALL unconsumed messages addressed to us or broadcast
    const messages = readJsonl(getMessagesFile(currentBranch));
    const batch = [];
    for (const msg of messages) {
      if (consumed.has(msg.id)) continue;
      if (msg.to !== registeredName && msg.to !== '__all__') continue;
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

      // Get recent history for context
      const history = readJsonl(getHistoryFile(currentBranch));
      const recentHistory = history.slice(-20).map(m => ({
        from: m.from, to: m.to, content: m.content.substring(0, 500),
        timestamp: m.timestamp, id: m.id,
      }));

      // Count agents and who hasn't spoken recently
      const agents = getAgents();
      const agentNames = Object.keys(agents).filter(n => isPidAlive(agents[n].pid, agents[n].last_activity));
      const recentSpeakers = new Set(history.slice(-10).map(m => m.from));
      const silent = agentNames.filter(n => !recentSpeakers.has(n) && n !== registeredName);

      const result = {
        messages: batch.map(m => ({
          id: m.id, from: m.from, to: m.to, content: m.content,
          timestamp: m.timestamp,
          ...(m.reply_to && { reply_to: m.reply_to }),
          ...(m.thread_id && { thread_id: m.thread_id }),
        })),
        message_count: batch.length,
        context: recentHistory,
        agents_online: agentNames.length,
        agents_silent: silent,
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

      result.next_action = 'After processing these messages and sending your response, call listen_group() again immediately. Never stop listening.';
      return result;
    }

    await adaptiveSleep(0);
  }

  setListening(false);
  return {
    timeout: true,
    retry: true,
    message: 'No messages yet. Call listen_group() again immediately to keep listening. Do NOT stop — you must stay in the conversation.',
    messages: [],
    message_count: 0,
  };
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
  if (!fs.existsSync(TASKS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch { return []; }
}

function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
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
  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
  touchActivity();

  return { success: true, task_id: task.id, assignee: task.assignee };
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

  task.status = status;
  task.updated_at = new Date().toISOString();
  if (notes) {
    task.notes.push({ by: registeredName, text: notes, at: new Date().toISOString() });
  }

  saveTasks(tasks);
  touchActivity();

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
  // Remove profiles, workflows, branches, permissions, read receipts
  for (const f of [PROFILES_FILE, WORKFLOWS_FILE, BRANCHES_FILE, PERMISSIONS_FILE, READ_RECEIPTS_FILE, CONFIG_FILE]) {
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

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '3.6.1' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'register',
        description: 'Register this agent\'s identity (any name, e.g. "A", "Coder", "Reviewer"). Must be called before any other tool.',
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
        description: 'Listen for messages indefinitely. Unlike wait_for_reply, this never times out — it blocks until a message arrives. The agent should call listen() after finishing any task to stay available. After receiving a message, process it, respond, then call listen() again.',
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
        description: 'Listen for messages in group or managed conversation mode. Returns ALL unconsumed messages as a batch, plus conversation context and hints. IMPORTANT: After processing messages and responding, you MUST call listen_group() again immediately. If it times out with retry:true, call it again. Never stop listening — this is how you stay in the conversation.',
        inputSchema: {
          type: 'object',
          properties: {
            timeout_seconds: { type: 'number', description: 'Max seconds to wait for messages (default 300)' },
          },
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
        result = await toolSendMessage(args.content, args?.to, args?.reply_to);
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
        result = await toolListenGroup(args?.timeout_seconds);
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
      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        isError: true,
      };
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
  console.error('Agent Bridge MCP server v3.6.1 running (32 tools)');
}

main().catch(console.error);
