#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { ApiAgentEngine } = require('./api-agents');
const { init: initProject } = require('./cli');
const {
  DEFAULT_DATA_DIR_NAME,
  DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME,
  resolveDataDir: resolveSharedDataDir,
  resolveDefaultDataRoot,
} = require('./data-dir');
const {
  buildRuntimeContractMetadata,
  resolveAgentContract,
  sanitizeContractProfilePatch,
} = require('./agent-contracts');
const { resolveAgentRuntimeMetadata } = require('./runtime-descriptor');
const { createCanonicalState } = require('./state/canonical');

// --- File-level mutex for serializing read-then-write operations ---
const lockMap = new Map();
function withFileLock(filePath, fn) {
  const prev = lockMap.get(filePath) || Promise.resolve();
  const next = prev.then(fn, fn);
  lockMap.set(filePath, next.then(() => {}, () => {}));
  return next;
}

const PORT = parseInt(process.env.AGENT_BRIDGE_PORT || '3000', 10);

function generateLanToken() {
  const crypto = require('crypto');
  LAN_TOKEN = crypto.randomBytes(16).toString('hex');
  try { fs.writeFileSync(LAN_TOKEN_FILE, LAN_TOKEN, { mode: 0o600 }); } catch {}
  return LAN_TOKEN;
}

function loadLanToken() {
  if (fs.existsSync(LAN_TOKEN_FILE)) {
    try { LAN_TOKEN = fs.readFileSync(LAN_TOKEN_FILE, 'utf8').trim(); } catch {}
  }
  if (!LAN_TOKEN) generateLanToken();
}

// Token loaded after DEFAULT_DATA_DIR is set (see below)

function persistLanMode() {
  try { fs.writeFileSync(LAN_STATE_FILE, LAN_MODE ? 'true' : 'false'); } catch {}
}

function getLanIP() {
  const interfaces = os.networkInterfaces();
  let fallback = null;
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        // Prefer real LAN IPs (192.168.x, 10.x, 172.16-31.x) over link-local (169.254.x)
        if (!iface.address.startsWith('169.254.')) return iface.address;
        if (!fallback) fallback = iface.address;
      }
    }
  }
  return fallback;
}
const DEFAULT_PROJECT_ROOT = resolveDefaultDataRoot();
const DEFAULT_DATA_DIR = resolveSharedDataDir();
const HTML_FILE = path.join(__dirname, 'dashboard.html');
const LOGO_FILE = path.join(__dirname, 'logo.png');
const PROJECTS_FILE = path.join(DEFAULT_DATA_DIR, 'projects.json');
const LAN_STATE_FILE = path.join(DEFAULT_DATA_DIR, '.lan-mode');
let LAN_MODE = process.env.AGENT_BRIDGE_LAN === 'true' || (fs.existsSync(LAN_STATE_FILE) && fs.readFileSync(LAN_STATE_FILE, 'utf8').trim() === 'true');
const LAN_TOKEN_FILE = path.join(DEFAULT_DATA_DIR, '.lan-token');
let LAN_TOKEN = null;
loadLanToken();
const DASHBOARD_INIT_FLAG = '--all';

// --- Multi-project support ---

function getProjects() {
  if (!fs.existsSync(PROJECTS_FILE)) return [];
  try { return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf8')); } catch { return []; }
}

function saveProjects(projects) {
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// Check if a directory has actual data files (not just an empty dir)
function hasDataFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  try {
    const files = fs.readdirSync(dir);
    return files.some(f => f.endsWith('.jsonl') || f === 'agents.json');
  } catch { return false; }
}

// Resolve data dir: explicit project path > env var > cwd > legacy fallback
// Prefers directories with actual data files over empty ones
function resolveDataDir(projectPath) {
  if (projectPath) {
    return path.join(projectPath, DEFAULT_DATA_DIR_NAME);
  }
  return DEFAULT_DATA_DIR;
}

const canonicalStateCache = new Map();
function getCanonicalState(projectPath) {
  const dataDir = resolveDataDir(projectPath);
  if (!canonicalStateCache.has(dataDir)) {
    canonicalStateCache.set(dataDir, createCanonicalState({ dataDir, processPid: process.pid }));
  }
  return canonicalStateCache.get(dataDir);
}

function filePath(name, projectPath) {
  return path.join(resolveDataDir(projectPath), name);
}

// Validate project path is registered or is the default
function validateProjectPath(projectPath) {
  if (!projectPath) return true;
  const absPath = path.resolve(projectPath);
  const projects = getProjects();
  const cwd = path.resolve(process.cwd());
  const scriptDir = path.resolve(__dirname);
  if (absPath === DEFAULT_PROJECT_ROOT || absPath === cwd || absPath === scriptDir) return true;
  return projects.some(p => path.resolve(p.path) === absPath);
}

function htmlEscape(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const BRANCH_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

function getValidatedBranch(query) {
  const branchParam = query.get('branch') || null;
  if (branchParam && !BRANCH_NAME_RE.test(branchParam)) {
    return { error: 'Invalid branch name' };
  }
  return { branch: branchParam || 'main' };
}

function getRouteErrorStatus(result) {
  return result && result.error ? 400 : 200;
}

// --- Shared helpers ---

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split(/\r?\n/).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// Economy helpers
function getEconomyLedger(projectPath) {
  const ledgerFile = filePath('economy.jsonl', projectPath);
  if (!fs.existsSync(ledgerFile)) return [];
  try {
    return fs.readFileSync(ledgerFile, 'utf8').trim().split(/\r?\n/)
      .filter(l => l.trim()).map(l => JSON.parse(l));
  } catch { return []; }
}

function getBalances(projectPath) {
  const ledger = getEconomyLedger(projectPath);
  const balances = {};
  for (const entry of ledger) {
    if (!balances[entry.agent]) balances[entry.agent] = 0;
    balances[entry.agent] += entry.amount;
  }
  return balances;
}

function appendEconomyEntry(projectPath, entry) {
  const ledgerFile = filePath('economy.jsonl', projectPath);
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + '\n';
  fs.appendFileSync(ledgerFile, line);
}

// Listening gets a 30s recency grace window so the UI doesn't flicker every
// time an agent briefly returns from listen_group() to process a batch.
const LISTEN_RECENCY_GRACE_MS = 30000;
function isRecentlyListening(info) {
  if (!info) return false;
  if (info.listening_since) return true;
  if (!info.last_listened_at) return false;
  const last = Date.parse(info.last_listened_at);
  if (!Number.isFinite(last)) return false;
  return Date.now() - last < LISTEN_RECENCY_GRACE_MS;
}

// Virtual-agent helpers. "Dashboard" and "Owner" represent the operator UI,
// not a real CLI process. Writing them to agents.json lets list_agents and
// list_channels show them as first-class recipients, so agents can DM the
// operator via send_message(to="Dashboard") without confusion.
const VIRTUAL_AGENT_NAMES = ['Dashboard', 'Owner'];
function ensureVirtualAgents(projectPath) {
  try {
    const dataDir = resolveDataDir(projectPath);
    if (!fs.existsSync(dataDir)) return;
    const agentsFile = path.join(dataDir, 'agents.json');
    let agents = {};
    if (fs.existsSync(agentsFile)) {
      try { agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8')); } catch {}
    }
    const now = new Date().toISOString();
    let changed = false;
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
          branch: 'main',
        };
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2) + '\n');
    }
  } catch {} // best-effort — if agents.json is locked, we'll try again next request
}

function isPidAlive(pid, lastActivity) {
  if (pid === -1) return true; // virtual agents (Dashboard, Owner) — always alive
  const STALE_THRESHOLD = 60000; // 60s — if heartbeat updated within this, agent is alive

  // PRIORITY 1: Trust heartbeat freshness over PID status
  // Heartbeats are written by the actual running process — if fresh, agent is alive
  // regardless of whether process.kill can see the PID
  if (lastActivity) {
    const stale = Date.now() - new Date(lastActivity).getTime();
    if (stale < STALE_THRESHOLD) return true;
  }

  // PRIORITY 2: If heartbeat is stale, check PID as fallback
  try {
    process.kill(pid, 0);
    return true; // PID exists — alive even with stale heartbeat
  } catch {
    return false; // PID dead AND heartbeat stale — truly dead
  }
}

// --- Default avatar helpers ---
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

// --- API handlers ---

function apiHistory(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  const limit = Math.min(parseInt(query.get('limit') || '500', 10), 1000);
  const page = parseInt(query.get('page') || '0', 10);
  const threadId = query.get('thread_id');

  return getCanonicalState(projectPath).getHistoryView({ branch: branchResult.branch, limit, page, threadId });
}

function apiChannels(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).getChannelsView({ branch: branchResult.branch });
}

function apiAgents(query) {
  const projectPath = query.get('project') || null;
  // Make sure the operator virtual agents (Dashboard, Owner) exist so agents
  // querying list_agents over MCP see them as valid DM recipients.
  ensureVirtualAgents(projectPath);
  const canonicalState = getCanonicalState(projectPath);
  const agents = canonicalState.listAgents();
  const profiles = canonicalState.listProfiles();
  const history = readJsonl(filePath('history.jsonl', projectPath));

  // Merge per-agent heartbeat files — agents write these during listen loops
  // Without this merge, agents show as dead because agents.json has stale last_activity
  const dataDir = resolveDataDir(projectPath);
  try {
    const hbFiles = fs.readdirSync(dataDir).filter(f => f.startsWith('heartbeat-') && f.endsWith('.json'));
    for (const f of hbFiles) {
      const name = f.slice(10, -5); // 'heartbeat-Backend.json' → 'Backend'
      if (agents[name]) {
        try {
          const hb = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
          if (hb.last_activity) agents[name].last_activity = hb.last_activity;
          if (hb.pid) agents[name].pid = hb.pid;
        } catch {}
      }
    }
  } catch {}
  const result = {};

  // Build last message timestamp per agent from history
  const lastMessageTime = {};
  for (const m of history) {
    lastMessageTime[m.from] = m.timestamp;
  }

  for (const [name, info] of Object.entries(agents)) {
    // API agents: alive = status is 'active' (they share dashboard PID, so PID check is meaningless)
    const alive = info.is_api_agent ? (info.status === 'active') : isPidAlive(info.pid, info.last_activity);
    const lastActivity = info.last_activity || info.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    const profile = profiles[name] || {};
    const contract = resolveAgentContract(profile);
    const isLocal = (() => { try { process.kill(info.pid, 0); return true; } catch { return false; } })();
    const runtimeMetadata = resolveAgentRuntimeMetadata({
      name,
      is_api_agent: !!(info.is_api_agent),
      runtime_type: info.runtime_type,
      provider_id: info.provider_id,
      model_id: info.model_id,
      capabilities: info.capabilities,
      provider: info.provider,
      provider_color: info.provider_color,
      bot_capability: info.bot_capability,
    });
    result[name] = {
      pid: info.pid,
      alive,
      registered_at: info.timestamp,
      last_activity: lastActivity,
      last_message: lastMessageTime[name] || null,
      idle_seconds: alive ? idleSeconds : null,
      status: info.is_api_agent ? (info.status || 'sleeping') : (!alive ? 'dead' : idleSeconds > 60 ? 'sleeping' : 'active'),
      listening_since: info.listening_since || null,
      last_listened_at: info.last_listened_at || null,
      is_listening: alive && isRecentlyListening(info),
      runtime_type: runtimeMetadata.runtime_type,
      provider_id: runtimeMetadata.provider_id,
      model_id: runtimeMetadata.model_id,
      capabilities: runtimeMetadata.capabilities,
      provider: runtimeMetadata.provider || 'unknown',
      branch: info.branch || 'main',
      display_name: profile.display_name || name,
      avatar: profile.avatar || getDefaultAvatar(name),
      role: profile.role || '',
      bio: profile.bio || '',
      ...buildRuntimeContractMetadata(contract),
      appearance: profile.appearance || {},
      hostname: info.hostname || null,
      is_remote: !isLocal && alive,
      is_api_agent: !!(info.is_api_agent),
      provider_color: runtimeMetadata.provider_color || null,
      bot_capability: runtimeMetadata.bot_capability,
    };
    // Include workspace status for agent intent board
    try {
      const workspace = canonicalState.readWorkspace(name, { branch: info.branch || 'main' });
      if (workspace && workspace._status) result[name].current_status = workspace._status;
    } catch {}
  }
  return result;
}

function apiStatus(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const agents = readJson(filePath('agents.json', projectPath));
  const threads = new Set();
  history.forEach(m => { if (m.thread_id) threads.add(m.thread_id); });

  const agentEntries = Object.entries(agents);
  const aliveCount = agentEntries.filter(([, a]) => isPidAlive(a.pid, a.last_activity)).length;
  const sleepingCount = agentEntries.filter(([, a]) => {
    if (!isPidAlive(a.pid, a.last_activity)) return false;
    const lastActivity = a.last_activity || a.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    return idleSeconds > 60;
  }).length;

  // Include managed mode status if active
  const config = readJson(filePath('config.json', projectPath));
  const result = {
    messageCount: history.length,
    agentCount: agentEntries.length,
    aliveCount,
    sleepingCount,
    threadCount: threads.size,
    conversation_mode: config.conversation_mode || 'direct',
  };

  if (config.conversation_mode === 'managed' && config.managed) {
    result.managed = {
      manager: config.managed.manager,
      phase: config.managed.phase,
      floor: config.managed.floor,
      turn_current: config.managed.turn_current,
    };
  }

  return result;
}

function apiPlanStatus(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).getPlanStatusView({ branch: branchResult.branch });
}

function apiPlanReport(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).getPlanReportView({ branch: branchResult.branch });
}

function apiStats(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const agents = readJson(filePath('agents.json', projectPath));

  // Per-agent stats — only count messages from agents still in agents.json
  const perAgent = {};
  const knownAgentNames = new Set(Object.keys(agents));
  knownAgentNames.add('__system__');
  knownAgentNames.add('Dashboard');
  let totalMessages = 0;
  const hourBuckets = new Array(24).fill(0);

  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const from = m.from || 'unknown';
    if (!knownAgentNames.has(from)) continue; // skip removed agents
    if (!perAgent[from]) {
      perAgent[from] = { messages: 0, responseTimes: [], hours: new Array(24).fill(0) };
    }
    totalMessages++;
    perAgent[from].messages++;
    const ts = new Date(m.timestamp);
    const hour = ts.getHours();
    perAgent[from].hours[hour]++;
    hourBuckets[hour]++;

    // Compute response time if this is a reply
    if (m.reply_to) {
      for (let j = i - 1; j >= Math.max(0, i - 50); j--) {
        if (history[j].id === m.reply_to) {
          const delta = ts.getTime() - new Date(history[j].timestamp).getTime();
          if (delta > 0 && delta < 3600000) perAgent[from].responseTimes.push(delta);
          break;
        }
      }
    }
  }

  // Build per-agent summary — only include agents currently in agents.json
  const agentStats = {};
  let busiestAgent = null;
  let busiestCount = 0;
  for (const [name, data] of Object.entries(perAgent)) {
    const avgResponseMs = data.responseTimes.length
      ? Math.round(data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length)
      : null;
    const peakHour = data.hours.indexOf(Math.max(...data.hours));
    agentStats[name] = {
      messages: data.messages,
      avg_response_ms: avgResponseMs,
      peak_hour: peakHour,
    };
    if (data.messages > busiestCount) {
      busiestCount = data.messages;
      busiestAgent = name;
    }
  }

  // Conversation velocity (messages per minute over last 10 minutes)
  const tenMinAgo = Date.now() - 600000;
  const recentCount = history.filter(m => new Date(m.timestamp).getTime() > tenMinAgo).length;
  const velocity = Math.round((recentCount / 10) * 10) / 10;

  return {
    total_messages: totalMessages,
    busiest_agent: busiestAgent,
    velocity_per_min: velocity,
    hour_distribution: hourBuckets,
    agents: agentStats,
  };
}

// --- v3.4: Notification Tracking ---
let notificationHistory = [];
let prevAgentState = {};

function generateNotifications(currentAgents) {
  const crypto = require('crypto');
  const now = new Date().toISOString();

  for (const [name, agent] of Object.entries(currentAgents)) {
    const prev = prevAgentState[name];
    const isAlive = agent.pid ? isPidAlive(agent.pid, agent.last_activity) : false;
    const isListening = !!agent.listening;

    if (prev) {
      if (!prev.alive && isAlive) {
        notificationHistory.push({ id: crypto.randomBytes(8).toString('hex'), type: 'agent_online', agent: name, message: `${name} came online`, timestamp: now });
      }
      if (prev.alive && !isAlive) {
        notificationHistory.push({ id: crypto.randomBytes(8).toString('hex'), type: 'agent_offline', agent: name, message: `${name} went offline`, timestamp: now });
      }
      if (!prev.listening && isListening) {
        notificationHistory.push({ id: crypto.randomBytes(8).toString('hex'), type: 'agent_listening', agent: name, message: `${name} started listening`, timestamp: now });
      }
      if (prev.listening && !isListening) {
        notificationHistory.push({ id: crypto.randomBytes(8).toString('hex'), type: 'agent_busy', agent: name, message: `${name} stopped listening`, timestamp: now });
      }
    } else if (isAlive) {
      notificationHistory.push({ id: crypto.randomBytes(8).toString('hex'), type: 'agent_online', agent: name, message: `${name} came online`, timestamp: now });
    }

    prevAgentState[name] = { alive: isAlive, listening: isListening };
  }

  // Trim to max 50
  if (notificationHistory.length > 50) {
    notificationHistory = notificationHistory.slice(-50);
  }
}

function apiNotifications() {
  return notificationHistory;
}

// --- v3.4: Performance Scoring ---
function apiScores(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const agents = readJson(filePath('agents.json', projectPath));

  const perAgent = {};
  const totalMessages = history.length;
  const allAgentNames = new Set();

  // Gather per-agent data
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    const from = m.from || 'unknown';
    allAgentNames.add(from);
    if (m.to) allAgentNames.add(m.to);
    if (!perAgent[from]) perAgent[from] = { messages: 0, responseTimes: [], peers: new Set() };
    perAgent[from].messages++;
    if (m.to) perAgent[from].peers.add(m.to);

    if (m.reply_to) {
      for (let j = i - 1; j >= Math.max(0, i - 50); j--) {
        if (history[j].id === m.reply_to) {
          const delta = new Date(m.timestamp).getTime() - new Date(history[j].timestamp).getTime();
          if (delta > 0 && delta < 3600000) perAgent[from].responseTimes.push(delta / 1000);
          break;
        }
      }
    }
  }

  const totalAgents = allAgentNames.size;
  const maxMessages = Math.max(1, ...Object.values(perAgent).map(d => d.messages));

  const result = {};
  const scores = [];

  for (const [name, data] of Object.entries(perAgent)) {
    const avgResponseSec = data.responseTimes.length
      ? data.responseTimes.reduce((a, b) => a + b, 0) / data.responseTimes.length
      : Infinity;

    // Responsiveness (30 pts)
    let responsiveness;
    if (avgResponseSec < 10) responsiveness = 30;
    else if (avgResponseSec < 30) responsiveness = 25;
    else if (avgResponseSec < 60) responsiveness = 20;
    else if (avgResponseSec < 120) responsiveness = 15;
    else responsiveness = 10;

    // Activity (30 pts) — linear scale relative to top agent
    const activity = Math.round((data.messages / maxMessages) * 30);

    // Reliability (20 pts) — uptime based on agent registration
    let reliability = 10;
    const agentInfo = agents[name];
    if (agentInfo) {
      const isAlive = agentInfo.pid ? isPidAlive(agentInfo.pid, agentInfo.last_activity) : false;
      const registered = new Date(agentInfo.registered_at || agentInfo.last_activity).getTime();
      const totalTime = Date.now() - registered;
      if (totalTime > 0 && isAlive) {
        const lastAct = new Date(agentInfo.last_activity).getTime();
        const activeTime = lastAct - registered;
        const uptime = Math.min(1, activeTime / totalTime);
        if (uptime > 0.95) reliability = 20;
        else if (uptime > 0.80) reliability = 15;
        else if (uptime > 0.50) reliability = 10;
        else reliability = 5;
      } else if (!isAlive) {
        reliability = 5;
      }
    }

    // Collaboration (20 pts)
    const collaboration = totalAgents > 1
      ? Math.round((data.peers.size / (totalAgents - 1)) * 20)
      : 20;

    const score = responsiveness + activity + reliability + collaboration;
    result[name] = { score, responsiveness, activity, reliability, collaboration };
    scores.push({ name, score });
  }

  // Add ranks
  scores.sort((a, b) => b.score - a.score);
  scores.forEach((s, i) => { result[s.name].rank = i + 1; });

  return { agents: result };
}

// --- v3.4: Cross-Project Search ---
function apiSearchAll(query) {
  const q = (query.get('q') || '').toLowerCase();
  const limit = Math.min(parseInt(query.get('limit') || '50', 10), 200);
  if (!q) return { error: 'Missing "q" parameter' };

  const projects = getProjects();
  // Add default project
  const allProjects = [{ name: path.basename(process.cwd()), path: null }];
  for (const p of projects) allProjects.push(p);

  const results = [];
  let total = 0;

  for (const proj of allProjects) {
    if (proj.path && !validateProjectPath(proj.path)) continue;
    const history = readJsonl(filePath('history.jsonl', proj.path));
    const matches = [];
    for (const m of history) {
      if (matches.length >= limit) break;
      const content = (m.content || '').toLowerCase();
      const from = (m.from || '').toLowerCase();
      const to = (m.to || '').toLowerCase();
      if (content.includes(q) || from.includes(q) || to.includes(q)) {
        matches.push({ id: m.id, from: m.from, to: m.to, content: m.content, timestamp: m.timestamp });
      }
    }
    if (matches.length > 0) {
      results.push({ project: proj.name, path: proj.path || process.cwd(), messages: matches });
      total += matches.length;
    }
  }

  return { results, total };
}

// --- v3.4: Replay Export ---
function apiExportReplay(query, branchName = 'main') {
  const projectPath = query.get('project') || null;
  const history = getCanonicalState(projectPath).getConversationMessages({ branch: branchName });

  const colors = ['#58a6ff','#3fb950','#d29922','#bc8cff','#f778ba','#ff7b72','#79c0ff','#7ee787'];
  const agentColors = {};
  let colorIdx = 0;
  for (const m of history) {
    if (!agentColors[m.from]) agentColors[m.from] = colors[colorIdx++ % colors.length];
  }

  const messagesJson = JSON.stringify(history.map(m => ({
    from: m.from, to: m.to, content: m.content, timestamp: m.timestamp, color: agentColors[m.from] || '#58a6ff'
  })));

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Let Them Talk — Replay</title>
<style>
:root{--bg:#0d1117;--surface:#161b22;--surface-2:#21262d;--border:#30363d;--text:#e6edf3;--dim:#8b949e}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
.header{background:var(--surface);border-bottom:1px solid var(--border);padding:12px 20px;display:flex;align-items:center;justify-content:space-between}
.title{font-size:16px;font-weight:700;color:var(--text)}
.controls{display:flex;gap:8px;align-items:center}
.controls button{background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:6px 14px;cursor:pointer;font-size:13px}
.controls button:hover{background:var(--border)}
.controls select{background:var(--surface-2);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-size:13px}
.messages{max-width:800px;margin:20px auto;padding:0 16px}
.msg{opacity:0;transform:translateY(8px);transition:opacity 0.3s,transform 0.3s;margin-bottom:12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px}
.msg.visible{opacity:1;transform:translateY(0)}
.msg-header{display:flex;gap:8px;align-items:baseline;margin-bottom:4px;font-size:13px}
.msg-from{font-weight:700}
.msg-to{color:var(--dim)}
.msg-time{color:var(--dim);margin-left:auto;font-size:11px}
.msg-content{font-size:14px;white-space:pre-wrap;word-break:break-word}
.msg-content code{background:var(--surface-2);padding:1px 5px;border-radius:3px;font-size:0.9em}
.msg-content strong{font-weight:700}
.progress{font-size:12px;color:var(--dim)}
</style></head><body>
<div class="header">
<span class="title">Let Them Talk — Replay</span>
<div class="controls">
<button id="btn" onclick="toggle()">Pause</button>
<label><span style="color:var(--dim);font-size:12px">Speed:</span>
<select id="speed" onchange="setSpeed(this.value)">
<option value="2000">Slow</option><option value="1000" selected>Normal</option><option value="500">Fast</option><option value="200">Very Fast</option>
</select></label>
<span class="progress" id="progress">0 / 0</span>
</div></div>
<div class="messages" id="messages"></div>
<script>
var msgs=${messagesJson.replace(/<\//g, '<\\/')};
var idx=0,playing=true,timer=null,speed=1000;
function md(s){return s.replace(/\`\`\`[\\s\\S]*?\`\`\`/g,function(m){return '<pre><code>'+m.slice(3,-3).replace(/^\\w*\\n/,'')+'</code></pre>'}).replace(/\`([^\`]+)\`/g,'<code>$1</code>').replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>').replace(/^### (.+)$/gm,'<h4 style="margin:8px 0 4px;font-size:14px">$1</h4>').replace(/^## (.+)$/gm,'<h3 style="margin:8px 0 4px;font-size:15px">$1</h3>').replace(/^# (.+)$/gm,'<h2 style="margin:8px 0 4px;font-size:16px">$1</h2>')}
function esc(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
function showNext(){if(idx>=msgs.length){playing=false;document.getElementById('btn').textContent='Done';return}
var m=msgs[idx],el=document.createElement('div');el.className='msg';
var t=new Date(m.timestamp);var time=t.toLocaleTimeString();
el.innerHTML='<div class="msg-header"><span class="msg-from" style="color:'+m.color+'">'+esc(m.from)+'</span><span class="msg-to">→ '+esc(m.to||'all')+'</span><span class="msg-time">'+time+'</span></div><div class="msg-content">'+md(esc(m.content))+'</div>';
document.getElementById('messages').appendChild(el);
requestAnimationFrame(function(){el.classList.add('visible')});
el.scrollIntoView({behavior:'smooth',block:'end'});
idx++;document.getElementById('progress').textContent=idx+' / '+msgs.length;
if(playing)timer=setTimeout(showNext,speed)}
function toggle(){if(idx>=msgs.length){idx=0;document.getElementById('messages').innerHTML='';playing=true;document.getElementById('btn').textContent='Pause';showNext();return}
playing=!playing;document.getElementById('btn').textContent=playing?'Pause':'Play';if(playing)showNext();else clearTimeout(timer)}
function setSpeed(v){speed=parseInt(v)}
showNext();
</script></body></html>`;
}

function apiReset(query) {
  const projectPath = query.get('project') || null;
  return getCanonicalState(projectPath).resetRuntime();
}

function apiClearMessages(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).clearMessages({ branch: branchResult.branch, actor: 'Dashboard' });
}

function apiClearTasks(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).clearTasks({ branch: branchResult.branch, actor: 'Dashboard' });
}

function apiNewConversation(query) {
  const projectPath = query.get('project') || null;
  return getCanonicalState(projectPath).archiveCurrentConversation();
}

function apiListConversations(query) {
  const projectPath = query.get('project') || null;
  const dataDir = resolveDataDir(projectPath);
  const convDir = path.join(dataDir, 'conversations');
  if (!fs.existsSync(convDir)) return { conversations: [] };
  const files = fs.readdirSync(convDir).filter(f => f.startsWith('conversation-') && f.endsWith('.jsonl') && !f.endsWith('-history.jsonl'));
  const conversations = files.map(f => {
    const name = f.replace('.jsonl', '');
    const dateStr = name.replace('conversation-', '').replace(/-/g, function(m, i) {
      // First 2 dashes are date separators, 3rd is T separator, rest are time separators
      return m;
    });
    // Parse date from stamp: YYYY-MM-DDTHH-MM-SS
    const parts = name.replace('conversation-', '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})$/);
    let date = '';
    if (parts) {
      date = parts[1] + '-' + parts[2] + '-' + parts[3] + 'T' + parts[4] + ':' + parts[5] + ':' + parts[6];
    }
    let messageCount = 0;
    try {
      const content = fs.readFileSync(path.join(convDir, f), 'utf8').trim();
      if (content) messageCount = content.split(/\r?\n/).filter(l => l.trim()).length;
    } catch {}
    return { name, date, messageCount };
  });
  conversations.sort((a, b) => b.date.localeCompare(a.date));
  return { conversations };
}

function apiLoadConversation(query) {
  const projectPath = query.get('project') || null;
  const name = query.get('name');
  if (!name || /[^a-zA-Z0-9_-]/.test(name) || name.length > 100) {
    return { error: 'Invalid conversation name' };
  }
  return getCanonicalState(projectPath).loadConversation(name);
}

// Inject a message from the dashboard (system message or nudge to an agent)
function apiInjectMessage(body, query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  const branch = branchResult.branch;
  const dataDir = resolveDataDir(projectPath);
  const canonicalState = getCanonicalState(projectPath);

  if (!body.to || (!body.content && (!body.attachments || body.attachments.length === 0))) {
    return { error: 'Missing "to" and/or "content" fields' };
  }
  if (body.content && (typeof body.content !== 'string' || body.content.length > 100000)) {
    return { error: 'Message content too long (max 100KB)' };
  }
  if (body.to !== '__all__' && !/^[a-zA-Z0-9_-]{1,20}$/.test(body.to)) {
    return { error: 'Invalid agent name' };
  }
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  // Allow sending as 'Owner' or 'Dashboard' (both are treated as high-priority by agents)
  const fromName = (body.from === 'Owner' || body.from === 'owner') ? 'Owner' : 'Dashboard';
  const now = new Date().toISOString();

  // Broadcast to all agents
  if (body.to === '__all__') {
    const agents = readJson(path.join(dataDir, 'agents.json'));
    const ids = [];
    for (const name of Object.keys(agents)) {
      const msg = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
        from: fromName,
        to: name,
        content: body.content || '',
        timestamp: now,
        system: true,
      };
      if (body.attachments && body.attachments.length > 0) msg.attachments = body.attachments;
      canonicalState.appendMessage(msg, { branch });
      ids.push(msg.id);
    }
    return { success: true, messageIds: ids, broadcast: true };
  }

  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    from: fromName,
    to: body.to,
    content: body.content || '',
    timestamp: now,
    system: true,
  };
  if (body.attachments && body.attachments.length > 0) msg.attachments = body.attachments;

  // Route to private assistant channel if targeting Assistant
  if (body.to === 'Assistant' && body.assistant_private === true) {
    const assistantMsgFile = path.join(dataDir, 'assistant-messages.jsonl');
    fs.appendFileSync(assistantMsgFile, JSON.stringify(msg) + '\n');
  } else {
    canonicalState.appendMessage(msg, { branch });
  }

  return { success: true, messageId: msg.id };
}

// Multi-project management
function apiProjects() {
  return getProjects();
}

function apiAddProject(body) {
  if (!body.path) return { error: 'Missing "path" field' };
  const absPath = path.resolve(body.path);

  // Reject root directories and system paths
  const normalized = absPath.replace(/\\/g, '/');
  if (normalized === '/' || normalized === 'C:/' || /^[A-Z]:\/$/i.test(normalized) || /^[A-Z]:\/Windows/i.test(normalized) || normalized.startsWith('/etc') || normalized.startsWith('/usr') || normalized.startsWith('/sys')) {
    return { error: 'Cannot monitor system directories' };
  }

  if (!fs.existsSync(absPath)) return { error: `Path does not exist: ${absPath}` };

  // Any existing directory can be added as a project — user explicitly chose it

  const projects = getProjects();
  const name = body.name || path.basename(absPath);
  if (projects.find(p => p.path === absPath)) return { error: 'Project already added' };

  const initLogs = [];
  let initResult;
  try {
    initResult = initProject({
      cwd: absPath,
      flag: DASHBOARD_INIT_FLAG,
      argv: [process.execPath, path.join(__dirname, 'cli.js'), 'init', DASHBOARD_INIT_FLAG],
      log: (line) => initLogs.push(typeof line === 'string' ? line : String(line || '')),
    });
  } catch (error) {
    return {
      error: 'Project initialization failed: ' + error.message,
      init_failed: true,
      project: { name, path: absPath },
      initialization: {
        mode: DASHBOARD_INIT_FLAG,
        logs: initLogs,
      },
    };
  }

  const launcherPath = initResult && initResult.launcherPath
    ? initResult.launcherPath
    : path.join(absPath, DEFAULT_DATA_DIR_NAME, 'launch.js');
  if (!fs.existsSync(launcherPath)) {
    return {
      error: 'Project initialization failed: expected launcher missing at ' + launcherPath,
      init_failed: true,
      project: { name, path: absPath },
      initialization: {
        mode: DASHBOARD_INIT_FLAG,
        targets: initResult && Array.isArray(initResult.targets) ? initResult.targets : [],
        launcher_path: launcherPath,
        logs: initLogs,
      },
    };
  }

  try {
    projects.push({ name, path: absPath, added_at: new Date().toISOString() });
    saveProjects(projects);
  } catch (error) {
    return {
      error: 'Project registration failed after initialization: ' + error.message + '. The folder was initialized but not added to projects.json.',
      project: { name, path: absPath },
      initialization: {
        mode: DASHBOARD_INIT_FLAG,
        targets: initResult && Array.isArray(initResult.targets) ? initResult.targets : [],
        launcher_path: launcherPath,
        logs: initLogs,
      },
    };
  }

  return {
    success: true,
    project: { name, path: absPath },
    initialization: {
      mode: DASHBOARD_INIT_FLAG,
      targets: initResult && Array.isArray(initResult.targets) ? initResult.targets : [],
      launcher_path: launcherPath,
      logs: initLogs,
    },
  };
}

function apiReinitProject(body) {
  const targetPath = body && body.path ? body.path : null;
  if (!targetPath) return { error: 'Missing "path" field' };
  const absPath = path.resolve(targetPath);
  if (!fs.existsSync(absPath)) return { error: `Path does not exist: ${absPath}` };

  const projects = getProjects();
  const known = projects.find((p) => p.path === absPath);
  if (!known) {
    return { error: 'Project is not registered. Use Add Project first.' };
  }

  const initLogs = [];
  let initResult;
  try {
    initResult = initProject({
      cwd: absPath,
      flag: DASHBOARD_INIT_FLAG,
      argv: [process.execPath, path.join(__dirname, 'cli.js'), 'init', DASHBOARD_INIT_FLAG],
      log: (line) => initLogs.push(typeof line === 'string' ? line : String(line || '')),
    });
  } catch (error) {
    return {
      error: 'Reinstall failed: ' + error.message,
      project: { name: known.name, path: absPath },
      initialization: { mode: DASHBOARD_INIT_FLAG, logs: initLogs },
    };
  }

  return {
    success: true,
    project: { name: known.name, path: absPath },
    initialization: {
      mode: DASHBOARD_INIT_FLAG,
      targets: initResult && Array.isArray(initResult.targets) ? initResult.targets : [],
      launcher_path: initResult && initResult.launcherPath ? initResult.launcherPath : null,
      logs: initLogs,
    },
  };
}

function apiRemoveProject(body) {
  if (!body.path) return { error: 'Missing "path" field' };
  const absPath = path.resolve(body.path);
  let projects = getProjects();
  const before = projects.length;
  projects = projects.filter(p => p.path !== absPath);
  if (projects.length === before) return { error: 'Project not found' };
  saveProjects(projects);
  return { success: true };
}

// Export conversation as self-contained HTML
function apiExportHtml(query, branchName = 'main') {
  const projectPath = query.get('project') || null;
  const history = getCanonicalState(projectPath).getConversationMessages({ branch: branchName });

  const agentNames = [...new Set(history.map(m => m.from))];
  const exportDate = new Date().toLocaleString();

  const startTime = history.length > 0 ? new Date(history[0].timestamp).toLocaleString() : '';
  const endTime = history.length > 0 ? new Date(history[history.length - 1].timestamp).toLocaleString() : '';
  const duration = history.length > 1 ? Math.round((new Date(history[history.length-1].timestamp) - new Date(history[0].timestamp)) / 60000) : 0;
  const durationStr = duration > 60 ? Math.floor(duration/60) + 'h ' + (duration%60) + 'm' : duration + ' minutes';

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Let Them Talk — Conversation Export</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect rx='20' width='100' height='100' fill='%230d1117'/><path d='M20 30 Q20 20 30 20 H70 Q80 20 80 30 V55 Q80 65 70 65 H55 L40 80 V65 H30 Q20 65 20 55Z' fill='%2358a6ff'/><circle cx='38' cy='42' r='5' fill='%230d1117'/><circle cx='55' cy='42' r='5' fill='%230d1117'/></svg>">
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0f;color:#e6edf3;min-height:100vh}
.export-header{background:linear-gradient(180deg,#0f0f18 0%,#0a0a0f 100%);padding:40px 24px 32px;text-align:center;border-bottom:1px solid #1e1e2e}
.logo{font-size:28px;font-weight:800;background:linear-gradient(135deg,#58a6ff,#bc8cff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;letter-spacing:-1px}
.export-meta{margin-top:12px;display:flex;justify-content:center;gap:20px;flex-wrap:wrap}
.meta-item{font-size:12px;color:#8888a0}
.meta-val{color:#58a6ff;font-weight:600}
.agent-chips{display:flex;gap:8px;justify-content:center;margin-top:16px;flex-wrap:wrap}
.agent-chip{display:flex;align-items:center;gap:6px;background:#161622;border:1px solid #1e1e2e;border-radius:20px;padding:4px 12px 4px 4px;font-size:12px}
.agent-chip .dot{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff}
.messages{max-width:860px;margin:0 auto;padding:20px 24px}
.msg{display:flex;gap:10px;padding:10px 14px;border-radius:8px;margin-bottom:2px}
.msg:hover{background:#161622}
.avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0}
.msg-body{flex:1;min-width:0}
.msg-header{display:flex;gap:6px;align-items:baseline;margin-bottom:3px;flex-wrap:wrap}
.msg-from{font-weight:600;font-size:13px}
.msg-arrow{color:#555568;font-size:11px}
.msg-to{font-size:12px;color:#8888a0}
.msg-time{font-size:10px;color:#555568}
.msg-content{font-size:13px;line-height:1.6;word-break:break-word}
.msg-content strong{font-weight:700}
.msg-content em{font-style:italic;color:#8888a0}
.msg-content code{background:#1e1e2e;padding:1px 5px;border-radius:4px;font-size:12px;font-family:Consolas,monospace;color:#d29922}
.msg-content pre{background:#0f0f18;border:1px solid #1e1e2e;border-radius:6px;padding:12px;margin:6px 0;overflow-x:auto;font-size:12px;font-family:Consolas,monospace}
.msg-content pre code{background:none;color:#e6edf3;padding:0}
.msg-content h1,.msg-content h2,.msg-content h3{margin:8px 0 4px;font-weight:700}
.msg-content h1{font-size:18px;border-bottom:1px solid #1e1e2e;padding-bottom:4px}
.msg-content h2{font-size:16px}
.msg-content h3{font-size:14px}
.msg-content ul,.msg-content ol{padding-left:20px;margin:4px 0}
.msg-content table{border-collapse:collapse;margin:6px 0;font-size:12px}
.msg-content th,.msg-content td{border:1px solid #1e1e2e;padding:4px 8px;text-align:left}
.msg-content th{background:#161622}
.badge{font-size:9px;padding:1px 5px;border-radius:8px;font-weight:600}
.badge-ack{background:rgba(63,185,80,0.15);color:#3fb950}
.date-sep{display:flex;align-items:center;gap:12px;padding:12px 14px 6px;color:#555568;font-size:11px;font-weight:600}
.date-sep::before,.date-sep::after{content:'';flex:1;height:1px;background:#1e1e2e}
.footer{border-top:1px solid #1e1e2e;padding:24px;text-align:center;font-size:11px;color:#555568}
.footer a{color:#8888a0;text-decoration:none}
.footer a:hover{color:#58a6ff}
</style></head><body>
<div class="export-header">
<div class="logo">Let Them Talk</div>
<div class="export-meta">
<span class="meta-item"><span class="meta-val">${history.length}</span> messages</span>
<span class="meta-item"><span class="meta-val">${agentNames.length}</span> agents</span>
<span class="meta-item"><span class="meta-val">${durationStr}</span> duration</span>
<span class="meta-item">Exported ${htmlEscape(exportDate)}</span>
</div>
<div class="agent-chips" id="agent-chips"></div>
</div>
<div class="messages" id="messages"></div>
<div class="footer">Generated by <a href="https://github.com/Dekelelz/let-them-talk" target="_blank">Let Them Talk</a> &middot; BSL 1.1</div>
<script>
var COLORS=['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#f778ba','#79c0ff','#7ee787','#e3b341','#ffa198'];
var colorMap={},ci=0;
var data=${JSON.stringify(history).replace(/<\//g, '<\\/')};
function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function fmt(t){
var h=esc(t);
h=h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,function(_,l,c){return '<pre><code>'+c+'</code></pre>'});
h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>');
h=h.replace(/\\*\\*\\*(.+?)\\*\\*\\*/g,'<strong><em>$1</em></strong>');
h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');
h=h.replace(/\\*(.+?)\\*/g,'<em>$1</em>');
h=h.replace(/^### (.+)/gm,'<h3>$1</h3>');
h=h.replace(/^## (.+)/gm,'<h2>$1</h2>');
h=h.replace(/^# (.+)/gm,'<h1>$1</h1>');
h=h.replace(/^[\\-\\*] (.+)/gm,'<li>$1</li>');
return h}
function color(n){if(!colorMap[n]){colorMap[n]=COLORS[ci%COLORS.length];ci++}return colorMap[n]}
var chips='';
var seen={};
for(var a=0;a<data.length;a++){var f=data[a].from;if(!seen[f]){seen[f]=true;var c=color(f);chips+='<div class="agent-chip"><div class="dot" style="background:'+c+'">'+f.charAt(0).toUpperCase()+'</div>'+esc(f)+'</div>'}}
document.getElementById('agent-chips').innerHTML=chips;
var html='';var lastDate='';
for(var i=0;i<data.length;i++){var m=data[i];var c=color(m.from);
var msgDate=new Date(m.timestamp).toLocaleDateString();
if(msgDate!==lastDate){var today=new Date().toLocaleDateString();var label=msgDate===today?'Today':msgDate;html+='<div class="date-sep">'+label+'</div>';lastDate=msgDate}
var badges='';if(m.acked)badges+='<span class="badge badge-ack">ACK</span>';
html+='<div class="msg"><div class="avatar" style="background:'+c+'">'+m.from.charAt(0).toUpperCase()+'</div><div class="msg-body"><div class="msg-header"><span class="msg-from" style="color:'+c+'">'+esc(m.from)+'</span><span class="msg-arrow">&rarr;</span><span class="msg-to">'+esc(m.to)+'</span><span class="msg-time">'+new Date(m.timestamp).toLocaleTimeString()+'</span>'+badges+'</div><div class="msg-content">'+fmt(m.content)+'</div></div></div>'}
document.getElementById('messages').innerHTML=html;
</script></body></html>`;
}

// Timeline API — agent activity over time for heatmap visualization
function apiTimeline(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  if (history.length === 0) return { agents: {}, duration_seconds: 0 };

  const agents = {};
  const startTime = new Date(history[0].timestamp).getTime();
  const endTime = new Date(history[history.length - 1].timestamp).getTime();
  const durationSeconds = Math.floor((endTime - startTime) / 1000);

  // Build activity windows per agent — each message marks a 30s "active" window
  for (const m of history) {
    if (!agents[m.from]) {
      agents[m.from] = { message_count: 0, active_seconds: 0, gaps: [], timestamps: [] };
    }
    agents[m.from].message_count++;
    agents[m.from].timestamps.push(m.timestamp);
  }

  // Calculate activity percentage and response gaps
  for (const [name, data] of Object.entries(agents)) {
    const ts = data.timestamps.map(t => new Date(t).getTime());
    let activeSeconds = 0;
    for (let i = 0; i < ts.length; i++) {
      activeSeconds += 30; // each message = ~30s of activity
      if (i > 0) {
        const gap = Math.floor((ts[i] - ts[i - 1]) / 1000);
        if (gap > 60) {
          data.gaps.push({ after_message: i, gap_seconds: gap });
        }
      }
    }
    data.active_seconds = Math.min(activeSeconds, durationSeconds || 1);
    data.activity_pct = durationSeconds > 0 ? Math.round((data.active_seconds / durationSeconds) * 100) : 100;
    delete data.timestamps; // don't send raw timestamps
  }

  return {
    agents,
    duration_seconds: durationSeconds,
    start_time: history[0].timestamp,
    end_time: history[history.length - 1].timestamp,
    total_messages: history.length,
  };
}

// Tasks API
function apiTasks(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).listTasks({ branch: branchResult.branch });
}

function apiSearch(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;

  const searchQuery = (query.get('q') || '').trim();
  const from = query.get('from') || null;
  const limit = Math.min(Math.max(1, parseInt(query.get('limit') || '50', 10)), 100);

  if (searchQuery.length < 2) {
    return { error: 'Query must be at least 2 characters' };
  }

  const results = getCanonicalState(projectPath).getSearchResultsView({
    branch: branchResult.branch,
    query: searchQuery,
    from,
    limit,
  });

  return {
    query: searchQuery,
    results_count: results.length,
    results,
  };
}

function apiUpdateTask(body, query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  if (!body.task_id || !body.status) return { error: 'Missing task_id or status' };

  const validStatuses = ['pending', 'in_progress', 'in_review', 'done', 'blocked'];
  if (!validStatuses.includes(body.status)) return { error: 'Invalid status. Must be: ' + validStatuses.join(', ') };

  let evidence = null;
  if (body.status === 'done') {
    const provided = body.evidence && typeof body.evidence === 'object' ? body.evidence : {};
    evidence = {
      summary: (typeof provided.summary === 'string' && provided.summary.trim())
        || (typeof body.notes === 'string' && body.notes.trim())
        || 'Marked complete by operator from dashboard.',
      verification: (typeof provided.verification === 'string' && provided.verification.trim())
        || 'operator_marked',
      files_changed: Array.isArray(provided.files_changed) ? provided.files_changed : [],
      confidence: Number.isFinite(provided.confidence) ? provided.confidence : 100,
    };
  }

  return getCanonicalState(projectPath).updateTaskStatus({
    taskId: body.task_id,
    status: body.status,
    notes: body.notes,
    actor: 'Dashboard',
    branch: branchResult.branch,
    sourceTool: 'dashboard_update_task',
    correlationId: body.task_id,
    ...(evidence && { evidence }),
  });
}

// Rules API
function apiRules(query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  return getCanonicalState(projectPath).listRules({ branch: branchResult.branch });
}

function apiAddRule(body, query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  if (!body.text || !body.text.trim()) return { error: 'Rule text is required' };

  const crypto = require('crypto');
  const rule = {
    id: 'rule_' + crypto.randomBytes(6).toString('hex'),
    text: body.text.trim(),
    category: body.category || 'general',
    priority: body.priority || 'normal',
    created_by: body.created_by || 'Dashboard',
    created_at: new Date().toISOString(),
    active: true
  };
  const created = getCanonicalState(projectPath).addRule({
    rule,
    actor: body.created_by || 'Dashboard',
    branch: branchResult.branch,
    correlationId: rule.id,
  });
  if (created.error) return created;
  return { success: true, rule: created.rule };
}

function apiUpdateRule(body, query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  if (!body.rule_id) return { error: 'Missing rule_id' };

  const updated = getCanonicalState(projectPath).updateRule({
    ruleId: body.rule_id,
    text: body.text !== undefined ? body.text.trim() : undefined,
    category: body.category,
    priority: body.priority,
    active: body.active,
    actor: body.updated_by || 'Dashboard',
    branch: branchResult.branch,
    correlationId: body.rule_id,
  });
  if (updated.error) return updated;
  return { success: true, rule: updated.rule };
}

function apiDeleteRule(body, query) {
  const projectPath = query.get('project') || null;
  const branchResult = getValidatedBranch(query);
  if (branchResult.error) return branchResult;
  if (!body.rule_id) return { error: 'Missing rule_id' };

  const removed = getCanonicalState(projectPath).removeRule({
    ruleId: body.rule_id,
    actor: body.deleted_by || 'Dashboard',
    branch: branchResult.branch,
    correlationId: body.rule_id,
  });
  if (removed.error) return removed;
  return { success: true };
}

// Auto-discover .agent-bridge directories nearby
function apiDiscover() {
  const found = [];
  const checked = new Set();
  const existing = new Set(getProjects().map(p => p.path));

  function scanDir(dir, depth, maxDepth) {
    maxDepth = maxDepth || 3;
    if (depth > maxDepth || checked.has(dir)) return;
    checked.add(dir);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === DEFAULT_MARKDOWN_WORKSPACE_DIR_NAME) continue;
        if (entry.name.startsWith('.') && entry.name !== '.agent-bridge') continue;
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.agent-bridge' && hasDataFiles(fullPath)) {
          const projectPath = dir;
          if (!existing.has(projectPath)) {
            found.push({ name: path.basename(projectPath), path: projectPath, dataDir: fullPath });
          }
        } else if (depth < maxDepth) {
          scanDir(fullPath, depth + 1, maxDepth);
        }
      }
    } catch {}
  }

  // Scan from cwd, parent, home, Desktop, and common project locations
  const cwd = process.cwd();
  const home = process.env.HOME || process.env.USERPROFILE || '';
  scanDir(cwd, 0);
  scanDir(path.dirname(cwd), 1);
  if (home) {
    scanDir(home, 0);
    scanDir(path.join(home, 'Desktop'), 0);
    scanDir(path.join(home, 'Documents'), 0);
    scanDir(path.join(home, 'Projects'), 0);
    scanDir(path.join(home, 'Desktop', 'Projects'), 0);
  }

  return found;
}

// --- Agent Launcher ---

function ensureMCPConfig(cli, serverPath, projectDir) {
  const abDir = path.join(projectDir, '.agent-bridge').replace(/\\/g, '/');
  if (cli === 'claude') {
    const mcpConfigPath = path.join(projectDir, '.mcp.json');
    let mcpConfig = { mcpServers: {} };
    if (fs.existsSync(mcpConfigPath)) {
      try { mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8')); if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {}; } catch {}
    }
    if (!mcpConfig.mcpServers['agent-bridge']) {
      mcpConfig.mcpServers['agent-bridge'] = { command: 'node', args: [serverPath], env: { AGENT_BRIDGE_DATA_DIR: abDir } };
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n');
    }
  } else if (cli === 'gemini') {
    const geminiDir = path.join(projectDir, '.gemini');
    const settingsPath = path.join(geminiDir, 'settings.json');
    if (!fs.existsSync(geminiDir)) fs.mkdirSync(geminiDir, { recursive: true });
    let settings = { mcpServers: {} };
    if (fs.existsSync(settingsPath)) {
      try { settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8')); if (!settings.mcpServers) settings.mcpServers = {}; } catch {}
    }
    if (!settings.mcpServers['agent-bridge']) {
      settings.mcpServers['agent-bridge'] = { command: 'node', args: [serverPath], env: { AGENT_BRIDGE_DATA_DIR: abDir } };
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    }
  } else if (cli === 'codex') {
    const codexDir = path.join(projectDir, '.codex');
    const configPath = path.join(codexDir, 'config.toml');
    if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true });
    let config = '';
    if (fs.existsSync(configPath)) config = fs.readFileSync(configPath, 'utf8');
    if (!config.includes('[mcp_servers.agent-bridge]')) {
      config += `\n[mcp_servers.agent-bridge]\ncommand = "node"\nargs = [${JSON.stringify(serverPath)}]\n\n[mcp_servers.agent-bridge.env]\nAGENT_BRIDGE_DATA_DIR = ${JSON.stringify(abDir)}\n`;
      fs.writeFileSync(configPath, config);
    }
  }
}

function apiLaunchAgent(body) {
  const { cli, project_dir, agent_name, prompt } = body;
  if (!cli || !['claude', 'gemini', 'codex'].includes(cli)) {
    return { error: 'Invalid cli type. Must be: claude, gemini, or codex' };
  }
  if (project_dir && !validateProjectPath(project_dir)) {
    return { error: 'Project directory not registered. Add it via the dashboard first.' };
  }
  const projectDir = project_dir || process.cwd();
  if (!fs.existsSync(projectDir)) {
    return { error: 'Project directory does not exist: ' + projectDir };
  }

  const serverPath = path.join(__dirname, 'server.js').replace(/\\/g, '/');
  ensureMCPConfig(cli, serverPath, projectDir);

  const cliCommands = { claude: 'claude', gemini: 'gemini', codex: 'codex' };
  const cliCmd = cliCommands[cli];
  const safeName = (agent_name || '').replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
  const launchPrompt = prompt || (safeName ? `You are agent "${safeName}". Use the register tool to register as "${safeName}", then use listen to wait for messages.` : `Register with the agent-bridge MCP tools and use listen to wait for messages.`);

  // Try to launch terminal — user pastes prompt from clipboard after CLI loads
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', 'cmd', '/k', cliCmd], { cwd: projectDir, shell: false, detached: true, stdio: 'ignore' });
    return { success: true, launched: true, cli, project_dir: projectDir, prompt: launchPrompt };
  }

  // Non-Windows: return command for manual execution
  return {
    success: true, launched: false, cli, project_dir: projectDir,
    command: `cd "${projectDir}" && ${cliCmd}`,
    prompt: launchPrompt,
    message: 'Run the command in a terminal, then paste the prompt.'
  };
}

// --- v3.4: Message Edit ---
async function apiEditMessage(body, query) {
  const projectPath = query.get('project') || null;
  const { id, content } = body;
  const branch = query.get('branch') || null;
  if (!id || !content) return { error: 'Missing "id" and/or "content" fields' };
  if (content.length > 50000) return { error: 'Content too long (max 50000 chars)' };

  if (branch && !/^[a-zA-Z0-9_-]{1,64}$/.test(branch)) return { error: 'Invalid branch name' };

  const result = getCanonicalState(projectPath).editMessage({
    id,
    content,
    branch,
    actor: 'Dashboard',
    maxEditHistory: 10,
  });

  if (!result) return { error: 'Message not found' };
  return { success: true, id, edited_at: result.edited_at };
}

// --- v3.4: Message Delete ---
async function apiDeleteMessage(body, query) {
  const projectPath = query.get('project') || null;
  const { id } = body;
  const branch = query.get('branch') || null;
  if (!id) return { error: 'Missing "id" field' };

  if (branch && !/^[a-zA-Z0-9_-]{1,64}$/.test(branch)) return { error: 'Invalid branch name' };

  const result = getCanonicalState(projectPath).deleteMessage({
    id,
    branch,
    actor: 'Dashboard',
    allowedFrom: ['Dashboard', 'dashboard', 'system', '__system__'],
  });

  if (!result.found) return { error: 'Message not found' };
  if (result.denied) return { error: 'Can only delete messages sent from Dashboard or system' };
  return { success: true, id };
}

// --- v3.4: Conversation Templates ---
function apiGetConversationTemplates() {
  const templatesDir = path.join(__dirname, 'conversation-templates');
  if (!fs.existsSync(templatesDir)) {
    // Return built-in templates
    return getBuiltInConversationTemplates();
  }
  const custom = fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => { try { return JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
  return [...getBuiltInConversationTemplates(), ...custom];
}

function getBuiltInConversationTemplates() {
  return [
    {
      id: 'code-review',
      name: 'Code Review Pipeline',
      description: 'Developer writes code, Reviewer checks it, Tester validates',
      agents: [
        { name: 'Developer', role: 'Developer', prompt: 'You are a developer. Write code as instructed. After completing, send your code to Reviewer for review.' },
        { name: 'Reviewer', role: 'Code Reviewer', prompt: 'You are a code reviewer. Wait for code from Developer. Review it for bugs, style, and best practices. Send feedback back to Developer or approve and forward to Tester.' },
        { name: 'Tester', role: 'QA Tester', prompt: 'You are a QA tester. Wait for approved code from Reviewer. Write and run tests. Report results back to the team.' }
      ],
      workflow: { name: 'Code Review', steps: ['Write Code', 'Review', 'Test', 'Approve'] }
    },
    {
      id: 'debug-squad',
      name: 'Debug Squad',
      description: 'Investigator finds the bug, Fixer patches it, Verifier confirms the fix',
      agents: [
        { name: 'Investigator', role: 'Bug Investigator', prompt: 'You investigate bugs. Analyze error logs, trace code paths, and identify root causes. Send findings to Fixer.' },
        { name: 'Fixer', role: 'Bug Fixer', prompt: 'You fix bugs. Wait for findings from Investigator. Implement fixes and send to Verifier for confirmation.' },
        { name: 'Verifier', role: 'Fix Verifier', prompt: 'You verify bug fixes. Wait for patches from Fixer. Test the fix and confirm resolution or send back for more work.' }
      ],
      workflow: { name: 'Bug Fix', steps: ['Investigate', 'Fix', 'Verify', 'Close'] }
    },
    {
      id: 'feature-build',
      name: 'Feature Development',
      description: 'Architect designs, Builder implements, Reviewer approves',
      agents: [
        { name: 'Architect', role: 'Software Architect', prompt: 'You are a software architect. Design the feature architecture, define interfaces, and create the implementation plan. Send the plan to Builder.' },
        { name: 'Builder', role: 'Developer', prompt: 'You are a developer. Wait for architecture plans from Architect. Implement the feature following the design. Send completed code to Reviewer.' },
        { name: 'Reviewer', role: 'Senior Reviewer', prompt: 'You are a senior reviewer. Review implementations from Builder against the architecture from Architect. Approve or request changes.' }
      ],
      workflow: { name: 'Feature Dev', steps: ['Design', 'Implement', 'Review', 'Ship'] }
    },
    {
      id: 'research-write',
      name: 'Research & Write',
      description: 'Researcher gathers info, Writer creates content, Editor polishes',
      agents: [
        { name: 'Researcher', role: 'Researcher', prompt: 'You are a researcher. Gather information on the given topic. Organize findings and send a research brief to Writer.' },
        { name: 'Writer', role: 'Writer', prompt: 'You are a writer. Wait for research from Researcher. Write clear, well-structured content based on the findings. Send to Editor.' },
        { name: 'Editor', role: 'Editor', prompt: 'You are an editor. Review and polish content from Writer. Check for clarity, accuracy, and style. Send back final version or request revisions.' }
      ],
      workflow: { name: 'Content Pipeline', steps: ['Research', 'Draft', 'Edit', 'Publish'] }
    }
  ];
}

function apiLaunchConversationTemplate(body, query) {
  const projectPath = query.get('project') || null;
  const { template_id } = body;
  if (!template_id) return { error: 'Missing template_id' };

  const templates = apiGetConversationTemplates();
  const template = templates.find(t => t.id === template_id);
  if (!template) return { error: 'Template not found: ' + template_id };

  // Return the template config for the frontend to display launch instructions
  return {
    success: true,
    template,
    instructions: template.agents.map(a => ({
      agent_name: a.name,
      role: a.role,
      prompt: `You are "${a.name}" with role "${a.role}". ${a.prompt}\n\nFirst register yourself with: register(name="${a.name}"), then update_profile(role="${a.role}"). Then enter listen mode.`
    }))
  };
}

// --- v3.4: Agent Permissions ---
function apiUpdatePermissions(body, query) {
  const projectPath = query.get('project') || null;
  const dataDir = resolveDataDir(projectPath);
  const permFile = path.join(dataDir, 'permissions.json');

  const { agent, permissions } = body;
  if (!agent || !permissions) return { error: 'Missing "agent" and/or "permissions" fields' };

  let perms = {};
  if (fs.existsSync(permFile)) {
    try { perms = JSON.parse(fs.readFileSync(permFile, 'utf8')); } catch {}
  }

  // permissions: { can_read: [agents...] or "*", can_write_to: [agents...] or "*", is_admin: bool }
  const allowed = {};
  if (permissions.can_read !== undefined) allowed.can_read = permissions.can_read;
  if (permissions.can_write_to !== undefined) allowed.can_write_to = permissions.can_write_to;
  if (permissions.is_admin !== undefined) allowed.is_admin = !!permissions.is_admin;
  perms[agent] = {
    ...perms[agent],
    ...allowed,
    updated_at: new Date().toISOString()
  };

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(permFile, JSON.stringify(perms, null, 2));
  return { success: true, agent, permissions: perms[agent] };
}

// --- HTTP Server ---

// Load HTML at startup (re-read on each request in dev for hot-reload)
let htmlContent = fs.readFileSync(HTML_FILE, 'utf8');

const MAX_BODY = 15 * 1024 * 1024; // 15 MB (supports base64 image attachments)

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > MAX_BODY) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// --- Rate limiting ---
const apiRateLimits = new Map();
function checkRateLimit(ip, limit = 60, windowMs = 60000) {
  const now = Date.now();
  const key = ip;
  if (!apiRateLimits.has(key)) apiRateLimits.set(key, []);
  const timestamps = apiRateLimits.get(key).filter(t => now - t < windowMs);
  apiRateLimits.set(key, timestamps);
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}
// Periodic cleanup to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of apiRateLimits) {
    const filtered = timestamps.filter(t => now - t < 60000);
    if (filtered.length === 0) apiRateLimits.delete(key);
    else apiRateLimits.set(key, filtered);
  }
}, 300000).unref(); // Clean every 5 minutes, .unref() prevents zombie process

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  const allowedOrigin = `http://localhost:${PORT}`;
  const reqOrigin = req.headers.origin;
  const lanIP = getLanIP();
  const lanOrigin = lanIP ? `http://${lanIP}:${PORT}` : null;
  const trustedOrigins = [allowedOrigin, `http://127.0.0.1:${PORT}`];
  if (LAN_MODE && lanOrigin) trustedOrigins.push(lanOrigin);
  if (reqOrigin && trustedOrigins.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-LTT-Request, X-LTT-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // LAN auth token — required for non-localhost requests when LAN mode is active
  if (LAN_MODE) {
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    const isLocalhost = host === 'localhost' || host === '127.0.0.1';
    if (!isLocalhost) {
      const tokenFromQuery = url.searchParams.get('token');
      const tokenFromHeader = req.headers['x-ltt-token'];
      const providedToken = tokenFromHeader || tokenFromQuery;
      const crypto = require('crypto');
      if (!providedToken || providedToken.length !== LAN_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(providedToken), Buffer.from(LAN_TOKEN))) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing LAN token' }));
        return;
      }
    }
  }

  // CSRF + DNS rebinding protection: validate Host, Origin, and custom header on mutating requests
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') {
    // Check Host header to block DNS rebinding attacks
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    const validHosts = ['localhost', '127.0.0.1'];
    if (LAN_MODE && getLanIP()) validHosts.push(getLanIP());
    if (!validHosts.includes(host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid host' }));
      return;
    }
    // Require custom header — browsers block cross-origin custom headers without preflight,
    // which our CORS policy won't approve for foreign origins. This closes the no-Origin gap.
    if (!req.headers['x-ltt-request']) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: missing X-LTT-Request header' }));
      return;
    }
    // Check Origin header to block cross-site requests
    // Empty origin is NOT trusted — requires at least the custom header (checked above)
    const origin = req.headers.origin || '';
    const referer = req.headers.referer || '';
    const source = origin || referer;
    if (!source) {
      // No origin/referer — non-browser client (curl, scripts, etc.)
      // Custom header check above is the only protection layer here — allow through
      // since local CLI tools (like our own `msg` command) need to work
    }
    const allowedSources = [`http://localhost:${PORT}`, `http://127.0.0.1:${PORT}`];
    if (LAN_MODE && getLanIP()) allowedSources.push(`http://${getLanIP()}:${PORT}`);
    let sourceOrigin = '';
    try { sourceOrigin = source ? new URL(source).origin : ''; } catch { sourceOrigin = ''; }
    const isLocal = allowedSources.includes(sourceOrigin);
    const isLan = isLocal;
    if (source && !isLocal && !isLan) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid origin' }));
      return;
    }
  }

  // Rate limit API endpoints (only for non-localhost in LAN mode)
  const clientIP = req.socket.remoteAddress || 'unknown';
  const isLocalhost = clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === '::ffff:127.0.0.1';
  if (url.pathname.startsWith('/api/') && !isLocalhost && !checkRateLimit(clientIP, 300, 60000)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }));
    return;
  }

  try {
    // Validate project parameter on all API endpoints
    const projectParam = url.searchParams.get('project');
    if (projectParam && url.pathname.startsWith('/api/') && !validateProjectPath(projectParam)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Project path not registered. Add it via /api/projects first.' }));
      return;
    }

    // Serve logo image
    if (url.pathname === '/logo.png') {
      if (fs.existsSync(LOGO_FILE)) {
        const logo = fs.readFileSync(LOGO_FILE);
        res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' });
        res.end(logo);
      } else {
        res.writeHead(404);
        res.end('Logo not found');
      }
      return;
    }

    // Serve static library files from node_modules (Three.js etc.)
    if (url.pathname.startsWith('/lib/')) {
      const libPath = url.pathname.replace('/lib/', '');
      // Sanitize: prevent path traversal
      if (libPath.includes('..') || libPath.includes('\\')) {
        res.writeHead(400); res.end('Bad path'); return;
      }
      // Search multiple node_modules locations (handles npx, local dev, monorepo, global)
      const searchPaths = [
        path.join(__dirname, 'node_modules', libPath),       // inside package (nested deps)
        path.join(__dirname, '..', 'node_modules', libPath), // repo root (local dev)
        path.join(__dirname, '..', libPath),                  // npx sibling packages (three/ is next to let-them-talk/)
      ];
      // Also try require.resolve for robust npm path resolution (works with hoisted deps, npx cache, etc.)
      // Note: use require.resolve(pkg) not require.resolve(pkg/package.json) — modern packages
      // with "exports" fields block resolving package.json directly (ERR_PACKAGE_PATH_NOT_EXPORTED)
      try {
        const parts = libPath.split('/');
        const pkgName = parts[0];
        const subPath = parts.slice(1).join('/');
        // Try resolving the package's main entry, then navigate to subPath
        const resolved = require.resolve(pkgName);
        const pkgDir = path.dirname(resolved);
        // Walk up from the resolved entry to the package root (handle nested build/ dirs)
        let pkgRoot = pkgDir;
        while (pkgRoot !== path.dirname(pkgRoot)) {
          if (fs.existsSync(path.join(pkgRoot, 'package.json'))) {
            try {
              const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8'));
              if (pkg.name === pkgName) break;
            } catch {}
          }
          pkgRoot = path.dirname(pkgRoot);
        }
        searchPaths.push(path.join(pkgRoot, subPath));
      } catch {}
      const filePath = searchPaths.find(p => fs.existsSync(p));
      if (filePath) {
        // Verify resolved path is within an allowed directory
        const resolvedFile = path.resolve(filePath);
        const allowedDirs = searchPaths.map(p => path.resolve(path.dirname(p)));
        const isAllowed = allowedDirs.some(dir => resolvedFile.startsWith(dir + path.sep) || resolvedFile === dir);
        if (!isAllowed) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        const ext = path.extname(filePath);
        const mimeTypes = { '.js': 'application/javascript', '.mjs': 'application/javascript', '.json': 'application/json', '.wasm': 'application/wasm' };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=604800' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404); res.end('Not found: ' + libPath);
      }
      return;
    }

    // Serve 3D office modules from agent-bridge/office/
    if (url.pathname.startsWith('/office/')) {
      const officePath = url.pathname.replace('/office/', '');
      if (officePath.includes('..') || officePath.includes('\\')) {
        res.writeHead(400); res.end('Bad path'); return;
      }
      const filePath = path.join(__dirname, 'office', officePath);
      const resolvedOffice = path.resolve(filePath);
      const allowedOfficeDir = path.resolve(path.join(__dirname, 'office'));
      if (!resolvedOffice.startsWith(allowedOfficeDir + path.sep) && resolvedOffice !== allowedOfficeDir) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const mimeTypes = { '.js': 'application/javascript', '.json': 'application/json' };
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404); res.end('Not found');
      }
      return;
    }

    // Serve mod assets from agent-bridge/mods/
    if (url.pathname.startsWith('/mods/')) {
      const modPath = url.pathname.replace('/mods/', '');
      if (modPath.includes('..') || modPath.includes('\\')) {
        res.writeHead(400); res.end('Bad path'); return;
      }
      const filePath = path.join(__dirname, 'mods', modPath);
      const resolvedMod = path.resolve(filePath);
      const allowedModDir = path.resolve(path.join(__dirname, 'mods'));
      if (!resolvedMod.startsWith(allowedModDir + path.sep) && resolvedMod !== allowedModDir) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      if (fs.existsSync(filePath)) {
        const ext = path.extname(filePath);
        const allowedMime = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.png': 'image/png' };
        const contentType = allowedMime[ext];
        if (!contentType) {
          res.writeHead(403); res.end('File type not allowed'); return;
        }
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=86400' });
        res.end(fs.readFileSync(filePath));
      } else {
        res.writeHead(404); res.end('Not found');
      }
      return;
    }

    // Serve dashboard HTML (always re-read for hot reload)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = fs.readFileSync(HTML_FILE, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'self'",
        'X-Frame-Options': 'SAMEORIGIN',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      });
      res.end(html);
    }
    // --- Assistant private messages API ---
    else if (url.pathname === '/api/assistant/messages' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const dataDir = resolveDataDir(projectPath);
      const assistantMsgFile = path.join(dataDir, 'assistant-messages.jsonl');
      const assistantRepliesFile = path.join(dataDir, 'assistant-replies.jsonl');
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);
      let messages = [];
      // Read Dashboard→Assistant messages
      if (fs.existsSync(assistantMsgFile)) {
        const lines = fs.readFileSync(assistantMsgFile, 'utf8').split('\n').filter(l => l.trim());
        for (const line of lines) {
          try { messages.push(JSON.parse(line)); } catch {}
        }
      }
      // Read Assistant→Dashboard replies
      if (fs.existsSync(assistantRepliesFile)) {
        const lines = fs.readFileSync(assistantRepliesFile, 'utf8').split('\n').filter(l => l.trim());
        for (const line of lines) {
          try { messages.push(JSON.parse(line)); } catch {}
        }
      }
      // Sort by timestamp and return last N
      messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      if (messages.length > limit) messages = messages.slice(-limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ messages, total: messages.length }));
    }
    // Clear assistant chat
    else if (url.pathname === '/api/assistant/clear' && req.method === 'POST') {
      const projectPath = url.searchParams.get('project') || null;
      const dataDir = resolveDataDir(projectPath);
      const assistantMsgFile = path.join(dataDir, 'assistant-messages.jsonl');
      const assistantRepliesFile = path.join(dataDir, 'assistant-replies.jsonl');
      const consumedFile = path.join(dataDir, 'consumed-assistant-private.json');
      try { fs.writeFileSync(assistantMsgFile, ''); } catch {}
      try { fs.writeFileSync(assistantRepliesFile, ''); } catch {}
      try { fs.writeFileSync(consumedFile, '[]'); } catch {}
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
    // Existing APIs (now with ?project= param support)
    else if (url.pathname === '/api/history' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiHistory(url.searchParams)));
    }
    else if (url.pathname === '/api/agents' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiAgents(url.searchParams)));
    }
    else if (url.pathname === '/api/channels' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiChannels(url.searchParams)));
    }
    else if (url.pathname === '/api/decisions' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const decisions = getCanonicalState(projectPath).listDecisions({ branch: branchResult.branch });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(decisions || []));
    }
    else if (url.pathname === '/api/agents' && req.method === 'DELETE') {
      const body = await parseBody(req);
      if (!body.name) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing agent name' }));
        return;
      }
      const agentName = body.name;
      const dataDir = resolveDataDir(url.searchParams.get('project'));
      const agentsFile = path.join(dataDir, 'agents.json');
      const profilesFile = path.join(dataDir, 'profiles.json');
      await withFileLock(agentsFile, () => {
        // Remove from agents.json
        if (fs.existsSync(agentsFile)) {
          const agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
          if (!agents[agentName]) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Agent not found: ' + agentName }));
            return;
          }
          delete agents[agentName];
          fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
        }
        // Remove from profiles.json
        if (fs.existsSync(profilesFile)) {
          const profiles = JSON.parse(fs.readFileSync(profilesFile, 'utf8'));
          delete profiles[agentName];
          fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));
        }
        // Remove consumed file
        const consumedFile = path.join(dataDir, 'consumed-' + agentName + '.json');
        if (fs.existsSync(consumedFile)) fs.unlinkSync(consumedFile);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, removed: agentName }));
      });
    }
    // Respawn prompt generator — creates copy-paste prompt to revive a dead agent
    else if (url.pathname.startsWith('/api/agents/') && url.pathname.endsWith('/respawn-prompt') && req.method === 'GET') {
      const agentName = decodeURIComponent(url.pathname.split('/')[3]);
      // Validate agent name (prevent path traversal)
      if (!agentName || /[^a-zA-Z0-9_-]/.test(agentName) || agentName.length > 20) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid agent name' }));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const branch = branchResult.branch;
      const dataDir = resolveDataDir(projectPath);
      const canonicalState = getCanonicalState(projectPath);
      const agents = canonicalState.listAgents();
      const profiles = canonicalState.listProfiles();
      const tasks = canonicalState.listTasks({ branch });
      const config = canonicalState.getConversationConfigView({ branch });

      if (!agents[agentName]) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Agent not found: ' + agentName }));
        return;
      }

      // Gather recovery snapshot if it belongs to the selected branch
      let recovery = null;
      const latestSessionSummary = canonicalState.getLatestSessionSummaryForAgent({ agentName, branch });
      const recoveryCandidates = [
        latestSessionSummary && latestSessionSummary.recovery_snapshot_file,
        `recovery-${agentName}.json`,
      ].filter((value, index, values) => typeof value === 'string' && value && values.indexOf(value) === index);

      for (const recoveryCandidate of recoveryCandidates) {
        const recoveryPath = path.join(dataDir, path.basename(recoveryCandidate));
        const snapshot = canonicalState.readJson(recoveryPath, null);
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) continue;
        const snapshotBranch = typeof snapshot.branch === 'string' && BRANCH_NAME_RE.test(snapshot.branch)
          ? snapshot.branch
          : 'main';
        if (snapshotBranch !== branch) continue;
        recovery = snapshot;
        break;
      }

      // Gather profile
      const profile = profiles[agentName] || {};

      // Gather active tasks assigned to this agent
      const taskList = Array.isArray(tasks) ? tasks : [];
      const activeTasks = taskList.filter(t => t.assignee === agentName && (t.status === 'in_progress' || t.status === 'pending'));
      const completedTasks = taskList.filter(t => t.assignee === agentName && t.status === 'done').slice(-5);

      // Gather recent history context (last 15 messages)
      const historyView = canonicalState.getHistoryView({ branch, limit: 15 });
      const history = Array.isArray(historyView)
        ? historyView
        : (historyView && Array.isArray(historyView.messages) ? historyView.messages : []);
      const recentHistory = history.slice(-15).map(m => `[${m.from}→${m.to}]: ${(m.content || '').substring(0, 150)}`).join('\n');

      // Gather who's online
      const onlineAgents = Object.entries(agents)
        .filter(([n, a]) => isPidAlive(a.pid, a.last_activity) && n !== agentName)
        .map(([n]) => n);

      // Gather workspace status
      const workspace = canonicalState.readWorkspace(agentName, { branch });
      const workspaceStatus = workspace && typeof workspace._status === 'string' ? workspace._status : '';

      // Build the respawn prompt
      const mode = config.conversation_mode || 'group';
      let prompt = `You are resuming as agent "${agentName}" in a multi-agent team using Let Them Talk (MCP agent bridge).\n\n`;

      if (profile.role) prompt += `**Your role:** ${profile.role}\n`;
      if (profile.bio) prompt += `**Your bio:** ${profile.bio}\n`;
      prompt += '\n';

      prompt += `**Conversation mode:** ${mode}\n`;
      prompt += `**Agents currently online:** ${onlineAgents.length > 0 ? onlineAgents.join(', ') : 'none'}\n\n`;

      if (activeTasks.length > 0) {
        prompt += `**Your active tasks:**\n`;
        for (const t of activeTasks) {
          prompt += `- [${t.status}] ${t.title}${t.description ? ' — ' + t.description.substring(0, 200) : ''}\n`;
        }
        prompt += '\n';
      }

      if (completedTasks.length > 0) {
        prompt += `**Tasks you completed before disconnect:**\n`;
        for (const t of completedTasks) {
          prompt += `- ${t.title}\n`;
        }
        prompt += '\n';
      }

      if (recovery) {
        if (recovery.locked_files && recovery.locked_files.length > 0) {
          prompt += `**Files you had locked:** ${recovery.locked_files.join(', ')} — unlock these or continue editing them.\n\n`;
        }
        if (recovery.channels && recovery.channels.length > 0) {
          prompt += `**Channels you were in:** ${recovery.channels.join(', ')}\n\n`;
        }
        if (recovery.decisions_made && recovery.decisions_made.length > 0) {
          prompt += `**Decisions you made:**\n`;
          for (const d of recovery.decisions_made) {
            prompt += `- ${d.decision}${d.reasoning ? ' (reason: ' + d.reasoning + ')' : ''}\n`;
          }
          prompt += '\n';
        }
        if (recovery.last_messages_sent && recovery.last_messages_sent.length > 0) {
          prompt += `**Your last messages before disconnect:**\n`;
          for (const m of recovery.last_messages_sent) {
            prompt += `- [→${m.to}]: ${m.content}\n`;
          }
          prompt += '\n';
        }
      }

      if (workspaceStatus) {
        prompt += `**Your last status:** ${workspaceStatus}\n\n`;
      }

      prompt += `**Recent team conversation:**\n${recentHistory}\n\n`;

      prompt += `**Instructions:**\n`;
      prompt += `1. Register as "${agentName}" using the register tool\n`;
      prompt += `2. Call get_briefing() for full project context\n`;
      prompt += `3. Call listen_group() to rejoin the conversation\n`;
      prompt += `4. Announce you're back and pick up your active tasks\n`;
      prompt += `5. Stay in listen_group() loop — never stop listening\n`;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agent: agentName,
        status: isPidAlive(agents[agentName].pid, agents[agentName].last_activity) ? 'alive' : 'dead',
        prompt,
        prompt_length: prompt.length,
        has_recovery: !!recovery,
        active_tasks: activeTasks.length,
        online_agents: onlineAgents,
      }));
    }
    else if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiStatus(url.searchParams)));
    }
    else if (url.pathname === '/api/stats' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiStats(url.searchParams)));
    }
    else if (url.pathname === '/api/reset' && req.method === 'POST') {
      const body = await parseBody(req).catch(() => ({}));
      if (!body.confirm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Destructive action requires { "confirm": true } in request body' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiReset(url.searchParams)));
    }
    else if (url.pathname === '/api/clear-messages' && req.method === 'POST') {
      const body = await parseBody(req).catch(() => ({}));
      if (!body.confirm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Destructive action requires { "confirm": true } in request body' }));
        return;
      }
      const result = apiClearMessages(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/clear-tasks' && req.method === 'POST') {
      const body = await parseBody(req).catch(() => ({}));
      if (!body.confirm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Destructive action requires { "confirm": true } in request body' }));
        return;
      }
      const result = apiClearTasks(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/new-conversation' && req.method === 'POST') {
      const body = await parseBody(req).catch(() => ({}));
      if (!body.confirm) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Destructive action requires { "confirm": true } in request body' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiNewConversation(url.searchParams)));
    }
    else if (url.pathname === '/api/conversations' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiListConversations(url.searchParams)));
    }
    else if (url.pathname === '/api/load-conversation' && req.method === 'POST') {
      const result = apiLoadConversation(url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // Message injection
    else if (url.pathname === '/api/inject' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiInjectMessage(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // Multi-project management
    else if (url.pathname === '/api/projects' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiProjects()));
    }
    else if (url.pathname === '/api/projects' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiAddProject(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/projects/reinit' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiReinitProject(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/timeline' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiTimeline(url.searchParams)));
    }
    else if (url.pathname === '/api/tasks' && req.method === 'GET') {
      const result = apiTasks(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiUpdateTask(body, url.searchParams);
      res.writeHead(result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/rules' && req.method === 'GET') {
      const result = apiRules(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/rules' && req.method === 'POST') {
      const body = await parseBody(req);
      const action = body.action || 'add';
      let result;
      if (action === 'add') result = apiAddRule(body, url.searchParams);
      else if (action === 'update') result = apiUpdateRule(body, url.searchParams);
      else if (action === 'delete') result = apiDeleteRule(body, url.searchParams);
      else result = { error: 'Unknown action. Use: add, update, delete' };
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/search' && req.method === 'GET') {
      const result = apiSearch(url.searchParams);
      res.writeHead(result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/export-json' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const canonicalState = getCanonicalState(projectPath);
      const history = canonicalState.getConversationMessages({ branch: branchResult.branch });
      const agents = apiAgents(url.searchParams);
      const decisions = canonicalState.listDecisions({ branch: branchResult.branch });
      const tasks = canonicalState.listTasks({ branch: branchResult.branch });
      const channels = canonicalState.getChannelsView({ branch: branchResult.branch });
      const pkg = readJson(path.join(__dirname, 'package.json')) || {};
      const result = {
        export_version: 1,
        exported_at: new Date().toISOString(),
        project: projectPath || DEFAULT_PROJECT_ROOT,
        branch: branchResult.branch,
        version: pkg.version || 'unknown',
        summary: {
          message_count: history.length,
          agent_count: Object.keys(agents).length,
          decision_count: decisions.length,
          task_count: tasks.length,
          channel_count: Object.keys(channels).length,
          time_range: history.length > 0 ? {
            start: history[0].timestamp,
            end: history[history.length - 1].timestamp,
          } : null,
        },
        agents,
        channels,
        decisions,
        tasks,
        messages: history,
      };
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="conversation-' + new Date().toISOString().slice(0, 10) + '-full.json"',
      });
      res.end(JSON.stringify(result, null, 2));
    }
    else if (url.pathname === '/api/export' && req.method === 'GET') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const html = apiExportHtml(url.searchParams, branchResult.branch);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="conversation-' + new Date().toISOString().slice(0, 10) + '.html"',
      });
      res.end(html);
    }
    else if (url.pathname === '/api/discover' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiDiscover()));
    }
    // --- World Builder: load/save world layout ---
    else if (url.pathname === '/api/world-layout' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const worldFile = filePath('world-layout.json', projectPath);
      if (fs.existsSync(worldFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end('[]');
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('[]');
      }
    }
    else if (url.pathname === '/api/world-save' && req.method === 'POST') {
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      const worldFile = filePath('world-layout.json', projectPath);
      if (!Array.isArray(body)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Expected array of placements' }));
        return;
      }
      // Limit to 1000 placements for safety
      const placements = body.slice(0, 1000);
      fs.writeFileSync(worldFile, JSON.stringify(placements, null, 2));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: placements.length }));
    }
    // --- v3.0 API endpoints ---
    else if (url.pathname === '/api/profiles' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getCanonicalState(projectPath).listProfiles()));
    }
    else if (url.pathname === '/api/profiles' && req.method === 'POST') {
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      if (!body.agent || !/^[a-zA-Z0-9_-]{1,20}$/.test(body.agent)) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid agent name' })); return; }
      if (body.display_name !== undefined) {
        if (body.display_name !== null && typeof body.display_name !== 'string') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'display_name must be a string' })); return; }
      }
      if (body.avatar !== undefined) {
        if (body.avatar !== null && typeof body.avatar !== 'string') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'avatar must be a string' })); return; }
        if (body.avatar && body.avatar.length > 65536) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Avatar too large (max 64KB)' })); return; }
      }
      if (body.bio !== undefined) {
        if (body.bio !== null && typeof body.bio !== 'string') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'bio must be a string' })); return; }
      }
      if (body.role !== undefined) {
        if (body.role !== null && typeof body.role !== 'string') { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'role must be a string' })); return; }
      }
      const contractPatch = sanitizeContractProfilePatch({
        archetype: body.archetype,
        skills: body.skills,
        contract_mode: body.contract_mode,
      });
      if (!contractPatch.valid) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: contractPatch.errors.join('; ') }));
        return;
      }
      let cleanedAppearance;
      if (body.appearance && typeof body.appearance === 'object') {
        const validKeys = ['head_color', 'hair_style', 'hair_color', 'eye_style', 'mouth_style', 'shirt_color', 'pants_color', 'shoe_color', 'glasses', 'glasses_color', 'headwear', 'headwear_color', 'neckwear', 'neckwear_color'];
        const enumValidation = {
          hair_style: ['none', 'short', 'spiky', 'long', 'ponytail', 'bob'],
          eye_style: ['dots', 'anime', 'glasses', 'sleepy'],
          mouth_style: ['smile', 'neutral', 'open'],
          glasses: ['none', 'round', 'square', 'sunglasses'],
          headwear: ['none', 'beanie', 'cap', 'headphones', 'headband'],
          neckwear: ['none', 'tie', 'bowtie', 'lanyard'],
        };
        cleanedAppearance = {};
        for (const [k, v] of Object.entries(body.appearance)) {
          if (!validKeys.includes(k) || typeof v !== 'string' || v.length > 20) continue;
          if (enumValidation[k] && !enumValidation[k].includes(v)) continue;
          cleanedAppearance[k] = v;
        }
      }
      const canonicalState = getCanonicalState(projectPath);
      canonicalState.upsertProfile({
        name: body.agent,
        displayName: body.display_name,
        avatar: body.avatar,
        bio: body.bio,
        role: body.role,
        appearance: cleanedAppearance,
        ...(Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'archetype') ? { archetype: contractPatch.normalized.archetype } : {}),
        ...(Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'skills') ? { skills: contractPatch.normalized.skills } : {}),
        ...(Object.prototype.hasOwnProperty.call(contractPatch.normalized, 'contract_mode') ? { contractMode: contractPatch.normalized.contract_mode } : {}),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
    else if (url.pathname === '/api/workspaces' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const agentParam = url.searchParams.get('agent');
      if (agentParam && !/^[a-zA-Z0-9_-]{1,20}$/.test(agentParam)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid agent name' }));
        return;
      }
      const canonicalState = getCanonicalState(projectPath);
      const result = {};
      if (agentParam) {
        result[agentParam] = canonicalState.readWorkspace(agentParam, { branch: branchResult.branch });
      } else {
        for (const workspace of canonicalState.listWorkspaces({ branch: branchResult.branch })) {
          result[workspace.agent] = workspace.data;
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/workflows' && req.method === 'GET') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getCanonicalState(projectPath).listWorkflows({ branch: branchResult.branch })));
    }
    else if (url.pathname === '/api/workflows' && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      const canonicalState = getCanonicalState(projectPath);
      if (body.action === 'advance' && body.workflow_id) {
        const result = canonicalState.advanceWorkflow({ workflowId: body.workflow_id, notes: body.notes, branch: branchResult.branch });
        if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      } else if (body.action === 'skip' && body.workflow_id && body.step_id) {
        const result = canonicalState.skipWorkflowStep({
          workflowId: body.workflow_id,
          stepId: body.step_id,
          note: 'Skipped from dashboard',
          branch: branchResult.branch,
        });
        if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      } else {
        res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Invalid action' })); return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    }
    // ========== Plan Control API (v5.0 Autonomy Engine) ==========

    else if (url.pathname === '/api/plan/status' && req.method === 'GET') {
      const result = apiPlanStatus(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }

    else if (url.pathname === '/api/plan/pause' && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const result = getCanonicalState(projectPath).pausePlan({ branch: branchResult.branch });
      if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      // Notify agents
      apiInjectMessage({ to: '__all__', content: `[PLAN PAUSED] "${result.name}" has been paused by the dashboard. Finish your current step, then wait for resume.` }, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Plan paused', workflow_id: result.workflow_id }));
    }

    else if (url.pathname === '/api/plan/resume' && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const result = getCanonicalState(projectPath).resumePlan({ branch: branchResult.branch });
      if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      apiInjectMessage({ to: '__all__', content: `[PLAN RESUMED] "${result.name}" has been resumed. Call get_work() to continue.` }, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Plan resumed', workflow_id: result.workflow_id }));
    }

    else if (url.pathname === '/api/plan/stop' && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const result = getCanonicalState(projectPath).stopPlan({ branch: branchResult.branch });
      if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      apiInjectMessage({ to: '__all__', content: `[PLAN STOPPED] "${result.name}" has been stopped by the dashboard. All work on this plan should cease.` }, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, message: 'Plan stopped', workflow_id: result.workflow_id }));
    }

    else if (url.pathname.startsWith('/api/plan/skip/') && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const stepId = parseInt(url.pathname.split('/').pop(), 10);
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      const canonicalState = getCanonicalState(projectPath);
      const workflows = canonicalState.listWorkflows({ branch: branchResult.branch });
      const wfId = body.workflow_id || ((workflows.find(w => w.status === 'active') || {}).id);
      const result = canonicalState.skipWorkflowStep({
        workflowId: wfId,
        stepId,
        note: ' [Skipped from dashboard]',
        appendNote: true,
        markSkipped: true,
        dependencyAware: true,
        branch: branchResult.branch,
      });
      if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: result.error === 'Step not found' ? `Step not found: ${stepId}` : result.error })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, skipped_step: stepId, ready_steps: result.ready_steps }));
    }

    else if (url.pathname.startsWith('/api/plan/reassign/') && req.method === 'POST') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const stepId = parseInt(url.pathname.split('/').pop(), 10);
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      if (!body.new_assignee) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'new_assignee required' })); return; }
      const canonicalState = getCanonicalState(projectPath);
      const wfId = body.workflow_id;
      const workflows = canonicalState.listWorkflows({ branch: branchResult.branch });
      const workflow = wfId ? workflows.find(w => w.id === wfId) : workflows.find(w => w.status === 'active');
      if (!workflow) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Workflow not found' })); return; }
      const result = canonicalState.reassignWorkflowStep({
        workflowId: workflow.id,
        stepId,
        newAssignee: body.new_assignee,
        branch: branchResult.branch,
      });
      if (result.error) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: result.error === 'Step not found' ? `Step not found: ${stepId}` : result.error })); return; }
      const updatedStep = result.step || {};
      apiInjectMessage({ to: body.new_assignee, content: `[REASSIGNED] Step ${stepId} "${updatedStep.description || 'Unknown step'}" has been reassigned from ${result.old_assignee || 'unassigned'} to you. ${updatedStep.status === 'in_progress' ? 'This step is IN PROGRESS — pick it up now.' : 'This step is ' + (updatedStep.status || 'pending') + '.'}` }, url.searchParams);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, step_id: stepId, old_assignee: result.old_assignee, new_assignee: body.new_assignee }));
    }

    else if (url.pathname === '/api/plan/inject' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.content) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'content required' })); return; }
      const result = apiInjectMessage({ to: body.to || '__all__', content: body.content }, url.searchParams);
      res.writeHead(result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }

    else if (url.pathname === '/api/plan/report' && req.method === 'GET') {
      const result = apiPlanReport(url.searchParams);
      if (result && result.error) { res.writeHead(getRouteErrorStatus(result), { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result)); return; }
      if (!result) { res.writeHead(404, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'No plan found' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }

    else if (url.pathname === '/api/plan/skills' && req.method === 'GET') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const kb = getCanonicalState(projectPath).readKnowledgeBase({ branch: branchResult.branch });
      let skills = [];
      for (const [key, val] of Object.entries(kb || {})) {
        if (key.startsWith('skill_') || key.startsWith('lesson_')) {
          skills.push({ key, content: val.content, learned_by: val.updated_by, learned_at: val.updated_at });
        }
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: skills.length, skills }));
    }

    else if (url.pathname === '/api/plan/retries' && req.method === 'GET') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const projectPath = url.searchParams.get('project') || null;
      const canonicalState = getCanonicalState(projectPath);
      let retries = [];
      for (const workspace of canonicalState.listWorkspaces({ branch: branchResult.branch })) {
        try {
          if (workspace.data && workspace.data.retry_history) {
            const history = typeof workspace.data.retry_history === 'string'
              ? JSON.parse(workspace.data.retry_history)
              : workspace.data.retry_history;
            if (Array.isArray(history)) {
              for (const entry of history) { retries.push({ agent: workspace.agent, ...entry }); }
            }
          }
        } catch {}
      }
      retries.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: retries.length, retries }));
    }

    // ========== Monitor Agent API ==========

    else if (url.pathname === '/api/monitor/health' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const dataDir = resolveDataDir(projectPath);
      const agentsFile = filePath('agents.json', projectPath);
      const wfFile = filePath('workflows.json', projectPath);
      const profilesFile = filePath('profiles.json', projectPath);
      const tasksFile = filePath('tasks.json', projectPath);

      const agents = fs.existsSync(agentsFile) ? readJson(agentsFile) : {};
      const profiles = fs.existsSync(profilesFile) ? readJson(profilesFile) : {};
      let workflows = [];
      if (fs.existsSync(wfFile)) try { workflows = JSON.parse(fs.readFileSync(wfFile, 'utf8')); } catch {}
      let tasks = [];
      if (fs.existsSync(tasksFile)) try { tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8')); } catch {}

      // Find monitor agent
      const monitorName = Object.entries(profiles).find(([, p]) => p.role === 'monitor');
      const now = Date.now();

      // Agent health summary
      const agentHealth = Object.entries(agents).map(([name, a]) => {
        const idle = now - new Date(a.last_activity || 0).getTime();
        return { name, idle_ms: idle, idle_human: Math.round(idle / 1000) + 's', status: idle > 120000 ? 'idle' : idle > 600000 ? 'stuck' : 'active', role: profiles[name] ? profiles[name].role : null };
      });

      const idleAgents = agentHealth.filter(a => a.status === 'idle').length;
      const stuckAgents = agentHealth.filter(a => a.status === 'stuck').length;
      const activeWorkflows = workflows.filter(w => w.status === 'active').length;
      const pendingTasks = tasks.filter(t => t.status === 'pending').length;
      const blockedTasks = tasks.filter(t => t.status === 'blocked' || t.status === 'blocked_permanent').length;

      // Monitor intervention log from workspace
      let interventions = [];
      if (monitorName) {
        try {
          const canonicalState = getCanonicalState(projectPath);
          const monitorBranch = (agents[monitorName[0]] && agents[monitorName[0]].branch) || 'main';
          const ws = canonicalState.readWorkspace(monitorName[0], { branch: monitorBranch });
          if (ws._monitor_log) interventions = typeof ws._monitor_log === 'string' ? JSON.parse(ws._monitor_log) : ws._monitor_log;
        } catch {}
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        monitor: monitorName ? { name: monitorName[0], active: true } : { active: false },
        health: {
          total_agents: Object.keys(agents).length,
          active: agentHealth.filter(a => a.status === 'active').length,
          idle: idleAgents,
          stuck: stuckAgents,
          active_workflows: activeWorkflows,
          pending_tasks: pendingTasks,
          blocked_tasks: blockedTasks,
        },
        agents: agentHealth,
        interventions: interventions.slice(-20),
        timestamp: new Date().toISOString(),
      }));
    }

    // ========== Reputation API ==========

    else if (url.pathname === '/api/reputation' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const repFile = filePath('reputation.json', projectPath);
      const rep = fs.existsSync(repFile) ? readJson(repFile) : {};

      // Calculate scores and build leaderboard
      const leaderboard = Object.entries(rep).map(([name, r]) => {
        const score = (r.tasks_completed || 0) * 2
          + (r.reviews_done || 0) * 1
          + (r.help_given || 0) * 3
          + (r.kb_contributions || 0) * 1
          - (r.retries || 0) * 1
          - (r.watchdog_nudges || 0) * 2;
        return {
          name, score,
          tasks_completed: r.tasks_completed || 0,
          reviews_done: r.reviews_done || 0,
          retries: r.retries || 0,
          watchdog_nudges: r.watchdog_nudges || 0,
          help_given: r.help_given || 0,
          strengths: r.strengths || [],
        };
      }).sort((a, b) => b.score - a.score);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ leaderboard, timestamp: new Date().toISOString() }));
    }

    // ========== System Stats API ==========

    else if (url.pathname === '/api/stats' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const dataDir = resolveDataDir(projectPath);
      const agentsFile = filePath('agents.json', projectPath);
      const canonicalState = getCanonicalState(projectPath);

      const agents = fs.existsSync(agentsFile) ? readJson(agentsFile) : {};
      const workflows = canonicalState.listWorkflows({ branch: branchResult.branch });
      const tasks = canonicalState.listTasks({ branch: branchResult.branch });
      const msgCount = canonicalState.getConversationMessages({ branch: branchResult.branch }).length;
      const kbKeys = Object.keys(canonicalState.readKnowledgeBase({ branch: branchResult.branch }) || {}).length;

      const aliveCount = Object.values(agents).filter(a => { const idle = Date.now() - new Date(a.last_activity || 0).getTime(); return idle < 120000; }).length;
      const activeWf = workflows.filter(w => w.status === 'active');
      const completedWf = workflows.filter(w => w.status === 'completed');
      const tasksDone = tasks.filter(t => t.status === 'done').length;
      const tasksActive = tasks.filter(t => t.status === 'in_progress').length;

      // Heartbeat files count
      let hbCount = 0;
      try { hbCount = fs.readdirSync(dataDir).filter(f => f.startsWith('heartbeat-')).length; } catch {}

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        agents: { total: Math.max(Object.keys(agents).length, hbCount), alive: aliveCount },
        messages: { total: msgCount },
        tasks: { total: tasks.length, done: tasksDone, active: tasksActive, pending: tasks.length - tasksDone - tasksActive },
        workflows: { total: workflows.length, active: activeWf.length, completed: completedWf.length },
        active_plan: activeWf.length > 0 ? { name: activeWf[0].name, progress: activeWf[0].steps.filter(s => s.status === 'done').length + '/' + activeWf[0].steps.length } : null,
        knowledge_base: { entries: kbKeys },
        timestamp: new Date().toISOString(),
      }));
    }

    // ========== Rules API ==========

    else if (url.pathname === '/api/rules' && req.method === 'GET') {
      const result = apiRules(url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }

    else if (url.pathname === '/api/rules' && req.method === 'POST') {
      try {
        const body = await parseBody(req);
        const result = apiAddRule(body, url.searchParams);
        res.writeHead(result && result.error ? getRouteErrorStatus(result) : 201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result && result.rule ? result.rule : result));
      } catch (e) { res.writeHead(400); res.end(JSON.stringify({ error: e.message })); }
    }

    else if (url.pathname.startsWith('/api/rules/') && req.method === 'DELETE') {
      const ruleId = url.pathname.split('/api/rules/')[1];
      const result = apiDeleteRule({ rule_id: ruleId }, url.searchParams);
      res.writeHead(result && result.error ? getRouteErrorStatus(result) : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }

    else if (url.pathname.startsWith('/api/rules/') && url.pathname.endsWith('/toggle') && req.method === 'POST') {
      const projectPath = url.searchParams.get('project') || null;
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const ruleId = url.pathname.split('/api/rules/')[1].replace('/toggle', '');
      const toggled = getCanonicalState(projectPath).toggleRule({
        ruleId,
        actor: 'Dashboard',
        branch: branchResult.branch,
        correlationId: ruleId,
      });
      if (toggled.error) { res.writeHead(404); res.end(JSON.stringify({ error: toggled.error })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(toggled.rule));
    }

    // ========== End Rules API ==========

    else if (url.pathname === '/api/branches' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const branchesFile = filePath('branches.json', projectPath);
      const dataDir = resolveDataDir(projectPath);
      let branches = fs.existsSync(branchesFile) ? readJson(branchesFile) : {};
      // Add message counts
      for (const [name, info] of Object.entries(branches)) {
        const histFile = name === 'main' ? path.join(dataDir, 'history.jsonl') : path.join(dataDir, `branch-${name}-history.jsonl`);
        let msgCount = 0;
        if (fs.existsSync(histFile)) {
          const content = fs.readFileSync(histFile, 'utf8').trim();
          if (content) msgCount = content.split(/\r?\n/).filter(l => l.trim()).length;
        }
        branches[name].message_count = msgCount;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(branches));
    }
    else if (url.pathname === '/api/projects' && req.method === 'DELETE') {
      const body = await parseBody(req);
      const result = apiRemoveProject(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Message Edit ---
    else if (url.pathname === '/api/message' && req.method === 'PUT') {
      const body = await parseBody(req);
      const result = await apiEditMessage(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Message Delete ---
    else if (url.pathname === '/api/message' && req.method === 'DELETE') {
      const body = await parseBody(req);
      const result = await apiDeleteMessage(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Conversation Templates ---
    else if (url.pathname === '/api/conversation-templates' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiGetConversationTemplates()));
    }
    else if (url.pathname === '/api/conversation-templates/launch' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiLaunchConversationTemplate(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Agent Permissions ---
    else if (url.pathname === '/api/permissions' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readJson(filePath('permissions.json', projectPath))));
    }
    else if (url.pathname === '/api/permissions' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiUpdatePermissions(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Read Receipts ---
    else if (url.pathname === '/api/read-receipts' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(readJson(filePath('read_receipts.json', projectPath))));
    }
    // Server info (LAN mode detection for frontend)
    else if (url.pathname === '/api/server-info' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lan_mode: LAN_MODE, lan_ip: getLanIP(), port: PORT }));
    }
    // Toggle LAN mode (re-bind server live)
    else if (url.pathname === '/api/toggle-lan' && req.method === 'POST') {
      const newMode = !LAN_MODE;
      const lanIP = getLanIP();
      LAN_MODE = newMode;
      persistLanMode();
      // Regenerate token when enabling LAN mode
      if (newMode) generateLanToken();
      // Send response first
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lan_mode: newMode, lan_ip: lanIP, port: PORT }));
      // Re-bind by stopping the listener and immediately re-listening
      // Use setImmediate to let the response flush first
      setImmediate(() => {
        // Drop SSE clients
        for (const client of sseClients) { try { client.end(); } catch {} }
        sseClients.clear();
        // Stop listening (don't use server.close which waits for all connections)
        server.listening = false;
        if (server._handle) {
          server._handle.close();
          server._handle = null;
        }
        server.listen(PORT, newMode ? '0.0.0.0' : '127.0.0.1', () => {
          console.log(newMode
            ? `  LAN mode enabled — http://${lanIP}:${PORT}`
            : '  LAN mode disabled — localhost only');
          startFileWatcher(); // restart file watcher
        });
      });
    }
    // Templates API
    else if (url.pathname === '/api/templates' && req.method === 'GET') {
      const templatesDir = path.join(__dirname, 'templates');
      let templates = [];
      if (fs.existsSync(templatesDir)) {
        templates = fs.readdirSync(templatesDir)
          .filter(f => f.endsWith('.json'))
          .map(f => { try { return JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8')); } catch { return null; } })
          .filter(Boolean);
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(templates));
    }
    // Agent launcher
    else if (url.pathname === '/api/launch' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiLaunchAgent(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Notifications ---
    else if (url.pathname === '/api/notifications' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiNotifications()));
    }
    // --- v3.4: Performance Scores ---
    else if (url.pathname === '/api/scores' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiScores(url.searchParams)));
    }
    // --- v3.4: Cross-Project Search ---
    else if (url.pathname === '/api/search-all' && req.method === 'GET') {
      const result = apiSearchAll(url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // --- v3.4: Replay Export ---
    else if (url.pathname === '/api/export-replay' && req.method === 'GET') {
      const branchResult = getValidatedBranch(url.searchParams);
      if (branchResult.error) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(branchResult));
        return;
      }
      const html = apiExportReplay(url.searchParams, branchResult.branch);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="replay-' + new Date().toISOString().slice(0, 10) + '.html"',
      });
      res.end(html);
    }
    // (World Builder API endpoints are handled earlier in the route chain by Architect's implementation)
    // Server-Sent Events endpoint for real-time updates
    else if (url.pathname === '/api/events' && req.method === 'GET') {
      if (sseClients.size >= 100) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many SSE connections' }));
        return;
      }
      // Per-IP SSE limit (max 5 connections per IP)
      const sseIP = req.socket.remoteAddress || 'unknown';
      const sseIPCount = [...sseClients].filter(c => c._sseIP === sseIP).length;
      if (sseIPCount >= 5) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Too many SSE connections from this IP (max 5)' }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: connected\n\n`);
      res._sseIP = sseIP;
      sseClients.add(res);
      // Heartbeat every 30s to detect dead connections and prevent proxy timeouts
      const heartbeat = setInterval(() => {
        try { res.write(`:heartbeat\n\n`); } catch { clearInterval(heartbeat); sseClients.delete(res); }
      }, 30000);
      heartbeat.unref();
      req.on('close', () => { clearInterval(heartbeat); sseClients.delete(res); });
    }
    // --- Mod system API ---
    else if (url.pathname === '/api/mods' && req.method === 'GET') {
      const registryFile = path.join(__dirname, 'mods', 'registry.json');
      const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { version: 1, mods: {} };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(registry));
    }
    else if (url.pathname === '/api/mods' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body.manifest) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing manifest' }));
        return;
      }
      const manifest = body.manifest;
      // Validate manifest
      const requiredFields = ['id', 'name', 'version', 'author', 'type', 'category'];
      const validTypes = ['accessory', 'hairstyle', 'outfit', 'character', 'environment'];
      const idPattern = /^[a-z0-9_-]{1,40}$/;
      const errors = [];
      for (const f of requiredFields) { if (!manifest[f]) errors.push('Missing: ' + f); }
      if (manifest.id && !idPattern.test(manifest.id)) errors.push('Invalid id format');
      if (manifest.type && !validTypes.includes(manifest.type)) errors.push('Invalid type');
      if (!manifest.asset || !manifest.asset.format) errors.push('Missing asset definition');
      if (manifest.asset && !['glb', 'gltf', 'procedural'].includes(manifest.asset.format)) errors.push('Invalid asset format');
      if (errors.length > 0) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Validation failed', errors }));
        return;
      }
      // Check for file if GLB mod (must be uploaded separately)
      if (manifest.asset.format === 'glb' || manifest.asset.format === 'gltf') {
        const modDir = path.join(__dirname, 'mods', manifest.id);
        if (!fs.existsSync(modDir)) fs.mkdirSync(modDir, { recursive: true });
        // If glbData is provided as base64, write it
        if (body.glbData) {
          const allowedExts = ['.glb', '.gltf', '.json', '.png'];
          const assetFile = manifest.asset.file || (manifest.id + '.glb');
          const ext = path.extname(assetFile);
          if (!allowedExts.includes(ext)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File type not allowed: ' + ext }));
            return;
          }
          // Size check
          const typeLimits = { accessory: 200*1024, hairstyle: 300*1024, outfit: 500*1024, character: 1024*1024, environment: 2*1024*1024 };
          const maxSize = typeLimits[manifest.type] || 200*1024;
          const buf = Buffer.from(body.glbData, 'base64');
          if (buf.length > maxSize) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'File too large: ' + (buf.length/1024).toFixed(0) + 'KB > ' + (maxSize/1024) + 'KB limit' }));
            return;
          }
          // GLB magic bytes check
          if (ext === '.glb' && buf.length >= 4) {
            const magic = buf.readUInt32LE(0);
            if (magic !== 0x46546C67) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Invalid GLB file (bad magic bytes)' }));
              return;
            }
          }
          const resolvedAsset = path.resolve(path.join(modDir, assetFile));
          if (!resolvedAsset.startsWith(path.resolve(modDir) + path.sep)) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid asset file path' }));
            return;
          }
          fs.writeFileSync(resolvedAsset, buf);
          manifest.asset.file = assetFile;
        }
        // Write manifest
        fs.writeFileSync(path.join(modDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
      }
      // Add to registry
      await withFileLock(path.join(__dirname, 'mods', 'registry.json'), () => {
        const registryFile = path.join(__dirname, 'mods', 'registry.json');
        const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { version: 1, mods: {} };
        if (registry.mods[manifest.id]) {
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mod ID already exists: ' + manifest.id }));
          return;
        }
        registry.mods[manifest.id] = manifest;
        fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, id: manifest.id }));
      });
    }
    else if (url.pathname === '/api/mods' && req.method === 'DELETE') {
      const body = await parseBody(req);
      if (!body.id) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing mod id' }));
        return;
      }
      const modId = body.id;
      if (!/^[a-z0-9_-]{1,40}$/.test(modId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid mod id' }));
        return;
      }
      // Don't allow deleting built-in mods
      if (modId.startsWith('builtin-')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Cannot delete built-in mods' }));
        return;
      }
      await withFileLock(path.join(__dirname, 'mods', 'registry.json'), () => {
        const registryFile = path.join(__dirname, 'mods', 'registry.json');
        const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { version: 1, mods: {} };
        if (!registry.mods[modId]) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Mod not found: ' + modId }));
          return;
        }
        delete registry.mods[modId];
        fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
        // Clean up mod directory if it exists
        const modDir = path.join(__dirname, 'mods', modId);
        if (fs.existsSync(modDir)) {
          try { fs.rmSync(modDir, { recursive: true }); } catch (e) { /* best effort */ }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      });
    }
    // --- City API endpoints (AI City Phase 1) ---
    else if (url.pathname === '/api/city/layout' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const cityMapFile = filePath('city-map.json', projectPath);
      if (fs.existsSync(cityMapFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(cityMapFile, 'utf8'));
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(data));
        } catch {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ districts: {}, buildings: {} }));
        }
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ districts: {}, buildings: {} }));
      }
    }
    else if (url.pathname === '/api/city/agents' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const agents = readJson(filePath('agents.json', projectPath));
      const tasksRaw = readJson(filePath('tasks.json', projectPath));
      const tasks = Array.isArray(tasksRaw) ? tasksRaw : (tasksRaw && tasksRaw.tasks ? tasksRaw.tasks : []);
      const cityAgents = {};
      for (const [name, info] of Object.entries(agents)) {
        const alive = isPidAlive(info.pid, info.last_activity);
        const lastActivity = info.last_activity || info.timestamp;
        const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
        const isListening = alive && isRecentlyListening(info);
        const activeTasks = tasks.filter(t => t.assignee === name && t.status !== 'done');
        let behavior = 'dead';
        let location = null;
        if (alive) {
          if (activeTasks.length > 0) { behavior = 'working'; location = 'office'; }
          else if (isListening) { behavior = 'listening'; location = 'office'; }
          else if (idleSeconds > 900) { behavior = 'off_duty'; location = 'residential'; }
          else if (idleSeconds > 300) { behavior = 'off_duty'; location = 'cafe'; }
          else { behavior = 'idle'; location = 'office'; }
        }
        cityAgents[name] = {
          alive,
          behavior,
          location,
          branch: info.branch || 'main',
          idle_seconds: alive ? idleSeconds : null,
          provider: info.provider || 'unknown',
        };
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(cityAgents));
    }
    // Phase 2: Agent activity radio feed for car HUD
    else if (url.pathname === '/api/city/radio' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50);
      const history = readJsonl(filePath('history.jsonl', projectPath));
      const agents = readJson(filePath('agents.json', projectPath));
      const feed = [];
      // Recent messages (skip system messages, truncate content)
      const recentMsgs = history.slice(-limit * 2).filter(m => m.from !== '__system__');
      for (const m of recentMsgs.slice(-limit)) {
        feed.push({
          type: 'message',
          from: m.from,
          to: m.to === '__group__' ? 'everyone' : m.to,
          preview: (m.content || '').slice(0, 120),
          timestamp: m.timestamp,
        });
      }
      // Agent status updates (who's alive, who just joined/died)
      const statuses = [];
      for (const [name, info] of Object.entries(agents)) {
        const alive = isPidAlive(info.pid, info.last_activity);
        statuses.push({ name, alive, last_activity: info.last_activity });
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ feed, agents_status: statuses, total_messages: history.length }));
    }
    // Phase 3: Economy system
    else if (url.pathname === '/api/city/economy' && req.method === 'GET') {
      const projectPath = url.searchParams.get('project') || null;
      const balances = getBalances(projectPath);
      const ledger = getEconomyLedger(projectPath);
      const recent = ledger.slice(-20);
      const totalCredits = Object.values(balances).reduce((s, v) => s + v, 0);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ balances, recent_transactions: recent, total_credits: totalCredits, ledger_entries: ledger.length }));
    }
    else if (url.pathname === '/api/city/economy' && req.method === 'POST') {
      const body = await parseBody(req);
      const projectPath = url.searchParams.get('project') || null;
      if (!body.agent || !body.amount || !body.reason) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing agent, amount, or reason' }));
        return;
      }
      const amount = parseInt(body.amount, 10);
      if (isNaN(amount)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid amount' }));
        return;
      }
      // Prevent negative balances on spend
      if (amount < 0) {
        const balances = getBalances(projectPath);
        const current = balances[body.agent] || 0;
        if (current + amount < 0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Insufficient credits', balance: current, requested: Math.abs(amount) }));
          return;
        }
      }
      appendEconomyEntry(projectPath, { agent: body.agent, amount, reason: body.reason, type: amount > 0 ? 'earn' : 'spend' });
      const balances = getBalances(projectPath);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, balance: balances[body.agent] || 0 }));
    }
    // Phase 4: Game time endpoint
    else if (url.pathname === '/api/city/time' && req.method === 'GET') {
      const speed = parseInt(url.searchParams.get('speed') || '60', 10) || 60;
      const now = Date.now();
      const gameMinutes = Math.floor((now / 1000) * speed / 60) % 1440;
      const hours = Math.floor(gameMinutes / 60);
      const minutes = gameMinutes % 60;
      const period = hours < 6 ? 'night' : hours < 8 ? 'dawn' : hours < 18 ? 'day' : hours < 20 ? 'dusk' : 'night';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ hours, minutes, period, game_minutes: gameMinutes, speed, formatted: `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}` }));
    }
    // ==================== API AGENTS ====================
    else if (url.pathname === '/api/api-agents' && req.method === 'GET') {
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(engine.list()));
    }
    else if (url.pathname === '/api/api-agents' && req.method === 'POST') {
      const body = await parseBody(req);
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const result = engine.create(body.name, body.provider, {
        model: body.model,
        endpoint: body.endpoint,
        apiKey: body.apiKey,
        providerOptions: body.options,
      });
      sseNotifyAll('agents');
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname.match(/^\/api\/api-agents\/[^/]+$/) && req.method === 'DELETE') {
      const name = decodeURIComponent(url.pathname.split('/').pop());
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const result = engine.remove(name);
      sseNotifyAll('agents');
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname.match(/^\/api\/api-agents\/[^/]+\/start$/) && req.method === 'POST') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const result = engine.start(name);
      sseNotifyAll('agents');
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname.match(/^\/api\/api-agents\/[^/]+\/stop$/) && req.method === 'POST') {
      const name = decodeURIComponent(url.pathname.split('/')[3]);
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const result = engine.stop(name);
      sseNotifyAll('agents');
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // ==================== MEDIA ====================
    else if (url.pathname === '/api/media' && req.method === 'GET') {
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const media = engine.getMedia({
        type: url.searchParams.get('type'),
        agent: url.searchParams.get('agent'),
        page: parseInt(url.searchParams.get('page') || '1', 10),
        limit: parseInt(url.searchParams.get('limit') || '20', 10),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(media));
    }
    else if (url.pathname.match(/^\/api\/media\/[^/]+\/file$/) && req.method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/')[3]);
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const filep = engine.getMediaFilePath(id);
      if (filep) {
        const ext = path.extname(filep).toLowerCase();
        const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.mp4': 'video/mp4' };
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream', 'Cache-Control': 'public, max-age=3600' });
        fs.createReadStream(filep).pipe(res);
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Media not found' }));
      }
    }
    else if (url.pathname.match(/^\/api\/media\/[^/]+$/) && req.method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').pop());
      const engine = getApiAgentEngine(url.searchParams.get('project'));
      const result = engine.deleteMedia(id);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    console.error('Server error:', err.message);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// --- Server-Sent Events for real-time updates ---
// Watches data files and pushes updates to connected clients instantly
const sseClients = new Set();

function sseNotifyAll(changeType) {
  // Generate notifications from agent state changes
  try {
    const agents = readJson(filePath('agents.json'));
    generateNotifications(agents);
  } catch {}

  // Send typed change event so client can do targeted fetches
  const eventData = changeType || 'update';
  const dead = [];
  for (const res of Array.from(sseClients)) {
    try {
      res.write(`data: ${(eventData || '').replace(/[\r\n]/g, '')}\n\n`);
    } catch {
      dead.push(res);
    }
  }
  for (const res of dead) sseClients.delete(res);
}

// Watch data directory for changes and push SSE notifications
let fsWatcher = null;
let sseDebounceTimer = null;

function startFileWatcher() {
  // Clean up previous watcher to prevent memory leaks on LAN toggle
  if (fsWatcher) { try { fsWatcher.close(); } catch {} fsWatcher = null; }
  if (sseDebounceTimer) { clearTimeout(sseDebounceTimer); sseDebounceTimer = null; }

  const dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) return;
  try {
    // Track pending change types for diff-based SSE
    let pendingChangeTypes = new Set();
    fsWatcher = fs.watch(dataDir, { persistent: false }, (eventType, filename) => {
      // Filter: only react to data files, not temp/lock files
      if (filename && !filename.endsWith('.json') && !filename.endsWith('.jsonl')) return;
      if (filename && filename.endsWith('.lock')) return;
      // Scale fix: skip heartbeat file changes — they fire 100x/10s at scale
      // Dashboard already polls agents via /api/agents on its own interval
      if (filename && filename.startsWith('heartbeat-')) return;

      // Classify change type for targeted client fetches
      if (filename === 'messages.jsonl' || filename === 'history.jsonl' || (filename && filename.includes('-messages.jsonl'))) {
        pendingChangeTypes.add('messages');
      } else if (filename === 'agents.json' || filename === 'profiles.json') {
        pendingChangeTypes.add('agents');
      } else if (filename === 'tasks.json') {
        pendingChangeTypes.add('tasks');
      } else if (filename === 'workflows.json') {
        pendingChangeTypes.add('workflows');
      } else {
        pendingChangeTypes.add('update');
      }

      // Debounce — multiple file changes may fire rapidly
      // Increased from 200ms to 2000ms for 100-agent scale (prevents SSE flood)
      if (sseDebounceTimer) clearTimeout(sseDebounceTimer);
      sseDebounceTimer = setTimeout(() => {
        // Send combined change types: "messages,agents" or just "messages"
        const changeType = Array.from(pendingChangeTypes).join(',');
        pendingChangeTypes.clear();
        sseNotifyAll(changeType);
      }, 2000);
    });
    fsWatcher.on('error', () => {}); // ignore watch errors
  } catch {}
}

startFileWatcher();

// Initialize API Agent Engine
let apiAgentEngine = null;
function getApiAgentEngine(projectPath) {
  const dataDir = resolveDataDir(projectPath);
  if (!apiAgentEngine || apiAgentEngine.dataDir !== dataDir) {
    if (apiAgentEngine) apiAgentEngine.stopAll();
    apiAgentEngine = new ApiAgentEngine(dataDir);
  }
  return apiAgentEngine;
}

// Clean up on exit
process.on('exit', () => { if (apiAgentEngine) apiAgentEngine.stopAll(); });
process.on('SIGINT', () => { if (apiAgentEngine) apiAgentEngine.stopAll(); process.exit(); });
process.on('SIGTERM', () => { if (apiAgentEngine) apiAgentEngine.stopAll(); process.exit(); });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Error: Port ${PORT} is already in use.`);
    console.error(`  Another dashboard may be running. Try:`);
    console.error(`    - Kill it: npx kill-port ${PORT}`);
    console.error(`    - Or use a different port: AGENT_BRIDGE_PORT=3001 node .agent-bridge/launch.js\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, LAN_MODE ? '0.0.0.0' : '127.0.0.1', () => {
  const dataDir = resolveDataDir();
  const lanIP = getLanIP();
  console.log('');
  console.log('  Let Them Talk - Agent Bridge Dashboard v5.4.1');
  console.log('  ============================================');
  console.log('  Dashboard:  http://localhost:' + PORT);
  if (LAN_MODE && lanIP) {
    console.log('  LAN access: http://' + lanIP + ':' + PORT);
    console.log('  WARNING:    LAN mode enabled — accessible to anyone on your network');
  }
  console.log('  Data dir:   ' + dataDir);
  console.log('  Projects:   ' + getProjects().length + ' registered');
  console.log('  Updates:    SSE (real-time) + polling fallback (2s)');
  console.log('');
});
