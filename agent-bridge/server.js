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

// In-memory state for this process
let registeredName = null;
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
let heartbeatInterval = null; // heartbeat timer reference
let messageSeq = 0; // monotonic sequence counter for message ordering

// --- Helpers ---

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function sanitizeName(name) {
  if (typeof name !== 'string' || !/^[a-zA-Z0-9_-]{1,20}$/.test(name)) {
    throw new Error(`Invalid name "${name}": must be 1-20 alphanumeric/underscore/hyphen chars`);
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

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
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
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Read new lines from messages.jsonl starting at a byte offset
function readNewMessages(fromOffset) {
  if (!fs.existsSync(MESSAGES_FILE)) return { messages: [], newOffset: 0 };
  const stat = fs.statSync(MESSAGES_FILE);
  if (stat.size < fromOffset) return { messages: [], newOffset: 0 }; // file was truncated/replaced — reset offset
  if (stat.size === fromOffset) return { messages: [], newOffset: fromOffset };

  const fd = fs.openSync(MESSAGES_FILE, 'r');
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
    if (fs.existsSync(MESSAGES_FILE)) {
      const { messages: tail } = readNewMessages(lastReadOffset);
      pendingCount = tail.filter(m => m.to === registeredName && m.id !== msg.id && !consumedIds.has(m.id)).length;
    }
  } catch {}

  // Count online agents
  const agents = getAgents();
  const agentsOnline = Object.entries(agents).filter(([, info]) => isPidAlive(info.pid)).length;

  // Count total messages for context window management
  let totalMessages = 0;
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const content = fs.readFileSync(HISTORY_FILE, 'utf8').trim();
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
  if (!fs.existsSync(MESSAGES_FILE)) return;
  try {
    const content = fs.readFileSync(MESSAGES_FILE, 'utf8').trim();
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

    // Rewrite messages.jsonl with only active messages
    const newContent = active.map(m => JSON.stringify(m)).join('\n') + (active.length ? '\n' : '');
    fs.writeFileSync(MESSAGES_FILE, newContent);
    lastReadOffset = Buffer.byteLength(newContent, 'utf8');
  } catch {}
}

// Get unconsumed messages for an agent (full scan — used by check_messages and initial load)
function getUnconsumedMessages(agentName, fromFilter = null) {
  const messages = readJsonl(MESSAGES_FILE);
  const consumed = getConsumedIds(agentName);
  return messages.filter(m => {
    if (m.to !== agentName) return false;
    if (consumed.has(m.id)) return false;
    if (fromFilter && m.from !== fromFilter) return false;
    return true;
  });
}

// --- Tool implementations ---

function toolRegister(name) {
  ensureDataDir();
  sanitizeName(name);

  const agents = getAgents();
  if (agents[name] && agents[name].pid !== process.pid && isPidAlive(agents[name].pid)) {
    return { error: `Agent "${name}" is already registered by a live process (PID ${agents[name].pid})` };
  }

  // Clean up old registration if re-registering with a different name
  if (registeredName && registeredName !== name && agents[registeredName] && agents[registeredName].pid === process.pid) {
    delete agents[registeredName];
  }

  const now = new Date().toISOString();
  agents[name] = { pid: process.pid, timestamp: now, last_activity: now };
  saveAgents(agents);
  registeredName = name;

  // Start heartbeat — updates last_activity every 10s so dashboard knows we're alive
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = setInterval(() => {
    try {
      const agents = getAgents();
      if (agents[registeredName]) {
        agents[registeredName].last_activity = new Date().toISOString();
        saveAgents(agents);
      }
    } catch {}
  }, 10000);
  heartbeatInterval.unref(); // Don't prevent process exit

  return { success: true, message: `Registered as Agent ${name} (PID ${process.pid})` };
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
  const result = {};
  for (const [name, info] of Object.entries(agents)) {
    const alive = isPidAlive(info.pid);
    const lastActivity = info.last_activity || info.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    result[name] = {
      pid: info.pid,
      alive,
      registered_at: info.timestamp,
      last_activity: lastActivity,
      idle_seconds: alive ? idleSeconds : null,
      status: !alive ? 'dead' : idleSeconds > 60 ? 'sleeping' : 'active',
      listening_since: info.listening_since || null,
      is_listening: !!(info.listening_since && alive),
    };
  }
  return { agents: result };
}

function toolSendMessage(content, to = null, reply_to = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
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

  const sizeErr = validateContentSize(content);
  if (sizeErr) return sizeErr;

  // Check if recipient is alive — warn if dead
  const recipientAlive = isPidAlive(agents[to].pid);

  // Resolve threading
  let thread_id = null;
  if (reply_to) {
    const allMsgs = readJsonl(MESSAGES_FILE);
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
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(msg) + '\n');
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(msg) + '\n');
  touchActivity();

  const result = { success: true, messageId: msg.id, from: msg.from, to: msg.to };
  if (!recipientAlive) {
    result.warning = `Agent "${to}" appears offline (PID not running). Message queued but may not be received until they reconnect.`;
  }
  return result;
}

function toolBroadcast(content) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  const sizeErr = validateContentSize(content);
  if (sizeErr) return sizeErr;

  const agents = getAgents();
  const otherAgents = Object.keys(agents).filter(n => n !== registeredName);

  if (otherAgents.length === 0) {
    return { error: 'No other agents registered' };
  }

  ensureDataDir();
  const ids = [];
  for (const to of otherAgents) {
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
    fs.appendFileSync(MESSAGES_FILE, JSON.stringify(msg) + '\n');
    fs.appendFileSync(HISTORY_FILE, JSON.stringify(msg) + '\n');
    ids.push({ to, messageId: msg.id });
  }
  touchActivity();

  return { success: true, sent_to: ids, recipient_count: otherAgents.length };
}

async function toolWaitForReply(timeoutSeconds = 300, from = null) {
  if (!registeredName) {
    return { error: 'You must call register() first' };
  }

  setListening(true);

  // First check any already-existing unconsumed messages (handles startup/catch-up)
  const existing = getUnconsumedMessages(registeredName, from);
  if (existing.length > 0) {
    const msg = existing[0];
    const consumed = getConsumedIds(registeredName);
    consumed.add(msg.id);
    saveConsumedIds(registeredName, consumed);
    if (fs.existsSync(MESSAGES_FILE)) {
      lastReadOffset = fs.statSync(MESSAGES_FILE).size;
    }
    touchActivity();
    setListening(false);
    return buildMessageResponse(msg, consumed);
  }

  // Set offset to current file end before polling for new messages
  if (fs.existsSync(MESSAGES_FILE)) {
    lastReadOffset = fs.statSync(MESSAGES_FILE).size;
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  const consumed = getConsumedIds(registeredName);

  while (Date.now() < deadline) {
    const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset);
    lastReadOffset = newOffset;

    for (const msg of newMsgs) {
      if (msg.to !== registeredName || consumed.has(msg.id)) continue;
      if (from && msg.from !== from) continue;

      consumed.add(msg.id);
      saveConsumedIds(registeredName, consumed);
      touchActivity();
      setListening(false);
      return buildMessageResponse(msg, consumed);
    }
    await sleep(500);
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
    if (fs.existsSync(MESSAGES_FILE)) {
      lastReadOffset = fs.statSync(MESSAGES_FILE).size;
    }
    touchActivity();
    setListening(false);
    return buildMessageResponse(msg, consumed);
  }

  // Set offset to current file end
  if (fs.existsSync(MESSAGES_FILE)) {
    lastReadOffset = fs.statSync(MESSAGES_FILE).size;
  }

  const consumed = getConsumedIds(registeredName);

  // Poll indefinitely (in 5-min chunks to stay within any MCP limits)
  while (true) {
    const chunkDeadline = Date.now() + 300000; // 5 minutes

    while (Date.now() < chunkDeadline) {
      const { messages: newMsgs, newOffset } = readNewMessages(lastReadOffset);
      lastReadOffset = newOffset;

      for (const msg of newMsgs) {
        if (msg.to !== registeredName || consumed.has(msg.id)) continue;
        if (from && msg.from !== from) continue;

        consumed.add(msg.id);
        saveConsumedIds(registeredName, consumed);
        touchActivity();
        setListening(false);
        return buildMessageResponse(msg, consumed);
      }
      await sleep(500);
    }
    // No message in this 5-min chunk — loop again (stay listening)
  }
}

function toolGetHistory(limit = 50, thread_id = null) {
  let history = readJsonl(HISTORY_FILE);
  if (thread_id) {
    history = history.filter(m => m.thread_id === thread_id || m.id === thread_id);
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

  const sizeErr = validateContentSize(context);
  if (sizeErr) return sizeErr;

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
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(msg) + '\n');
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(msg) + '\n');
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

  // Resolve the file path — restrict to project directory
  const resolved = path.resolve(filePath);
  const allowedRoot = path.resolve(process.cwd());
  if (!resolved.startsWith(allowedRoot + path.sep) && resolved !== allowedRoot) {
    return { error: 'File path must be within the project directory' };
  }
  if (!fs.existsSync(resolved)) {
    return { error: `File not found: ${path.basename(resolved)}` };
  }

  const stat = fs.statSync(resolved);
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

  const fileContent = fs.readFileSync(resolved, 'utf8');
  const fileName = path.basename(resolved);

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
  fs.appendFileSync(MESSAGES_FILE, JSON.stringify(msg) + '\n');
  fs.appendFileSync(HISTORY_FILE, JSON.stringify(msg) + '\n');
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
  const history = readJsonl(HISTORY_FILE);
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
  if (fs.existsSync(HISTORY_FILE)) {
    const history = readJsonl(HISTORY_FILE);
    if (history.length > 0) {
      const archiveDir = path.join(DATA_DIR, 'archives');
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const archivePath = path.join(archiveDir, `conversation-${timestamp}.jsonl`);
      fs.copyFileSync(HISTORY_FILE, archivePath);
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
  registeredName = null;
  lastReadOffset = 0;
  messageSeq = 0;
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  return { success: true, message: 'All data cleared. Conversation archived before reset.' };
}

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '2.5.0' },
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
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case 'register':
        result = toolRegister(args.name);
        break;
      case 'list_agents':
        result = toolListAgents();
        break;
      case 'send_message':
        result = toolSendMessage(args.content, args?.to, args?.reply_to);
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
  console.error('Agent Bridge MCP server v2.5.0 running');
}

main().catch(console.error);
