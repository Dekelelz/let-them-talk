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

// In-memory state for this process
let registeredName = null;
let lastReadOffset = 0; // byte offset into messages.jsonl for efficient polling
let heartbeatInterval = null; // heartbeat timer reference

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

  const msg = {
    id: generateId(),
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

  return { success: true, messageId: msg.id, from: msg.from, to: msg.to };
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
    };
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
      };
    }
    await sleep(500);
  }

  setListening(false);
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
    };
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
        };
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

function toolReset() {
  // Remove known fixed files
  for (const f of [MESSAGES_FILE, HISTORY_FILE, AGENTS_FILE, ACKS_FILE]) {
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
  if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
  return { success: true, message: 'All data cleared. Ready for a fresh session.' };
}

// --- MCP Server setup ---

const server = new Server(
  { name: 'agent-bridge', version: '2.0.0' },
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
        name: 'reset',
        description: 'Clear all data files (messages, history, agents, acks) and start fresh.',
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
  console.error('Agent Bridge MCP server v2.0.0 running');
}

main().catch(console.error);
