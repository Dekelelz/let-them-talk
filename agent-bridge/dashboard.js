#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.AGENT_BRIDGE_PORT || '3000', 10);
const DEFAULT_DATA_DIR = process.env.AGENT_BRIDGE_DATA || path.join(process.cwd(), '.agent-bridge');
const HTML_FILE = path.join(__dirname, 'dashboard.html');
const PROJECTS_FILE = path.join(__dirname, 'projects.json');

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
    const dir = path.join(projectPath, '.agent-bridge');
    const dataDir = path.join(projectPath, 'data');
    // Prefer whichever has data
    if (hasDataFiles(dir)) return dir;
    if (hasDataFiles(dataDir)) return dataDir;
    if (fs.existsSync(dir)) return dir;
    if (fs.existsSync(dataDir)) return dataDir;
    return dir;
  }
  const legacyDir = path.join(__dirname, 'data');
  // Prefer dir with actual data files
  if (hasDataFiles(DEFAULT_DATA_DIR)) return DEFAULT_DATA_DIR;
  if (hasDataFiles(legacyDir)) return legacyDir;
  if (fs.existsSync(DEFAULT_DATA_DIR)) return DEFAULT_DATA_DIR;
  if (fs.existsSync(legacyDir)) return legacyDir;
  return DEFAULT_DATA_DIR;
}

function filePath(name, projectPath) {
  return path.join(resolveDataDir(projectPath), name);
}

// --- Shared helpers ---

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  const content = fs.readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
}

function readJson(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function isPidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

// --- API handlers ---

function apiHistory(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const acks = readJson(filePath('acks.json', projectPath));
  const limit = parseInt(query.get('limit') || '500', 10);
  const threadId = query.get('thread_id');

  let messages = history;
  if (threadId) {
    messages = messages.filter(m => m.thread_id === threadId || m.id === threadId);
  }
  messages = messages.slice(-limit);
  messages.forEach(m => { m.acked = !!acks[m.id]; });
  return messages;
}

function apiAgents(query) {
  const projectPath = query.get('project') || null;
  const agents = readJson(filePath('agents.json', projectPath));
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const result = {};

  // Build last message timestamp per agent from history
  const lastMessageTime = {};
  for (const m of history) {
    lastMessageTime[m.from] = m.timestamp;
  }

  for (const [name, info] of Object.entries(agents)) {
    const alive = isPidAlive(info.pid);
    const lastActivity = info.last_activity || info.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    result[name] = {
      pid: info.pid,
      alive,
      registered_at: info.timestamp,
      last_activity: lastActivity,
      last_message: lastMessageTime[name] || null,
      idle_seconds: alive ? idleSeconds : null,
      status: !alive ? 'dead' : idleSeconds > 60 ? 'sleeping' : 'active',
      listening_since: info.listening_since || null,
      is_listening: !!(info.listening_since && alive),
    };
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
  const aliveCount = agentEntries.filter(([, a]) => isPidAlive(a.pid)).length;
  const sleepingCount = agentEntries.filter(([, a]) => {
    if (!isPidAlive(a.pid)) return false;
    const lastActivity = a.last_activity || a.timestamp;
    const idleSeconds = Math.floor((Date.now() - new Date(lastActivity).getTime()) / 1000);
    return idleSeconds > 60;
  }).length;

  return {
    messageCount: history.length,
    agentCount: agentEntries.length,
    aliveCount,
    sleepingCount,
    threadCount: threads.size,
  };
}

function apiReset(query) {
  const projectPath = query.get('project') || null;
  const dataDir = resolveDataDir(projectPath);
  const fixedFiles = ['messages.jsonl', 'history.jsonl', 'agents.json', 'acks.json'];
  for (const f of fixedFiles) {
    const p = path.join(dataDir, f);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  if (fs.existsSync(dataDir)) {
    for (const f of fs.readdirSync(dataDir)) {
      if (f.startsWith('consumed-') && f.endsWith('.json')) {
        fs.unlinkSync(path.join(dataDir, f));
      }
    }
  }
  return { success: true };
}

// Inject a message from the dashboard (system message or nudge to an agent)
function apiInjectMessage(body, query) {
  const projectPath = query.get('project') || null;
  const dataDir = resolveDataDir(projectPath);
  const messagesFile = path.join(dataDir, 'messages.jsonl');
  const historyFile = path.join(dataDir, 'history.jsonl');

  if (!body.to || !body.content) {
    return { error: 'Missing "to" and/or "content" fields' };
  }

  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const fromName = body.from || 'Dashboard';
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
        content: body.content,
        timestamp: now,
        system: true,
      };
      fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
      fs.appendFileSync(historyFile, JSON.stringify(msg) + '\n');
      ids.push(msg.id);
    }
    return { success: true, messageIds: ids, broadcast: true };
  }

  const msg = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    from: fromName,
    to: body.to,
    content: body.content,
    timestamp: now,
    system: true,
  };

  fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
  fs.appendFileSync(historyFile, JSON.stringify(msg) + '\n');

  return { success: true, messageId: msg.id };
}

// Multi-project management
function apiProjects() {
  return getProjects();
}

function apiAddProject(body) {
  if (!body.path) return { error: 'Missing "path" field' };
  const absPath = path.resolve(body.path);
  if (!fs.existsSync(absPath)) return { error: `Path does not exist: ${absPath}` };

  const projects = getProjects();
  const name = body.name || path.basename(absPath);
  if (projects.find(p => p.path === absPath)) return { error: 'Project already added' };

  projects.push({ name, path: absPath, added_at: new Date().toISOString() });
  saveProjects(projects);
  return { success: true, project: { name, path: absPath } };
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
function apiExportHtml(query) {
  const projectPath = query.get('project') || null;
  const history = readJsonl(filePath('history.jsonl', projectPath));
  const acks = readJson(filePath('acks.json', projectPath));
  const agents = readJson(filePath('agents.json', projectPath));
  history.forEach(m => { m.acked = !!acks[m.id]; });

  const agentNames = [...new Set(history.map(m => m.from))];
  const exportDate = new Date().toLocaleString();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Let Them Talk — Conversation Export</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0d1117;color:#e6edf3;padding:24px;max-width:900px;margin:0 auto}
.header{border-bottom:1px solid #30363d;padding-bottom:16px;margin-bottom:20px}
.logo{font-size:20px;font-weight:700;background:linear-gradient(135deg,#58a6ff,#bc8cff);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
.meta{font-size:12px;color:#8b949e;margin-top:6px}
.msg{display:flex;gap:10px;padding:10px 14px;border-radius:8px;margin-bottom:2px}
.msg:hover{background:#161b22}
.avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;color:#fff;flex-shrink:0}
.msg-body{flex:1;min-width:0}
.msg-header{display:flex;gap:6px;align-items:baseline;margin-bottom:3px;flex-wrap:wrap}
.msg-from{font-weight:600;font-size:13px}
.msg-arrow{color:#656d76;font-size:11px}
.msg-to{font-size:12px;color:#8b949e}
.msg-time{font-size:10px;color:#656d76}
.msg-content{font-size:13px;line-height:1.6;word-break:break-word}
.msg-content strong{font-weight:700}
.msg-content code{background:#21262d;padding:1px 5px;border-radius:4px;font-size:12px;font-family:Consolas,monospace;color:#d29922}
.msg-content pre{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:12px;margin:6px 0;overflow-x:auto;font-size:12px;font-family:Consolas,monospace}
.msg-content pre code{background:none;color:#e6edf3;padding:0}
.badge{font-size:9px;padding:1px 5px;border-radius:8px;font-weight:600}
.badge-ack{background:rgba(63,185,80,0.15);color:#3fb950}
.footer{border-top:1px solid #30363d;padding-top:12px;margin-top:20px;font-size:11px;color:#656d76;text-align:center}
</style></head><body>
<div class="header">
<div class="logo">Let Them Talk</div>
<div class="meta">Exported: ${exportDate} · ${history.length} messages · Agents: ${agentNames.join(', ')}</div>
</div>
<div id="messages"></div>
<div class="footer">Generated by Let Them Talk · github.com/Dekelelz/let-them-talk</div>
<script>
var COLORS=['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#f778ba','#79c0ff','#7ee787','#e3b341','#ffa198'];
var colorMap={},ci=0;
var data=${JSON.stringify(history)};
function esc(t){var d=document.createElement('div');d.textContent=t;return d.innerHTML}
function fmt(t){var h=esc(t);h=h.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g,function(_,l,c){return '<pre><code>'+c+'</code></pre>'});h=h.replace(/\`([^\`]+)\`/g,'<code>$1</code>');h=h.replace(/\\*\\*(.+?)\\*\\*/g,'<strong>$1</strong>');h=h.replace(/\\*(.+?)\\*/g,'<em>$1</em>');return h}
function color(n){if(!colorMap[n]){colorMap[n]=COLORS[ci%COLORS.length];ci++}return colorMap[n]}
var html='';
for(var i=0;i<data.length;i++){var m=data[i];var c=color(m.from);var badges='';if(m.acked)badges+='<span class="badge badge-ack">ACK</span>';
html+='<div class="msg"><div class="avatar" style="background:'+c+'">'+m.from.charAt(0).toUpperCase()+'</div><div class="msg-body"><div class="msg-header"><span class="msg-from" style="color:'+c+'">'+esc(m.from)+'</span><span class="msg-arrow">→</span><span class="msg-to">'+esc(m.to)+'</span><span class="msg-time">'+new Date(m.timestamp).toLocaleTimeString()+'</span>'+badges+'</div><div class="msg-content">'+fmt(m.content)+'</div></div></div>'}
document.getElementById('messages').innerHTML=html;
</script></body></html>`;
}

// Tasks API
function apiTasks(query) {
  const projectPath = query.get('project') || null;
  const tasksFile = filePath('tasks.json', projectPath);
  if (!fs.existsSync(tasksFile)) return [];
  try { return JSON.parse(fs.readFileSync(tasksFile, 'utf8')); } catch { return []; }
}

function apiUpdateTask(body, query) {
  const projectPath = query.get('project') || null;
  const tasksFile = filePath('tasks.json', projectPath);
  if (!body.task_id || !body.status) return { error: 'Missing task_id or status' };

  let tasks = [];
  if (fs.existsSync(tasksFile)) {
    try { tasks = JSON.parse(fs.readFileSync(tasksFile, 'utf8')); } catch {}
  }

  const task = tasks.find(t => t.id === body.task_id);
  if (!task) return { error: 'Task not found' };

  task.status = body.status;
  task.updated_at = new Date().toISOString();
  if (body.notes) {
    task.notes.push({ by: 'Dashboard', text: body.notes, at: new Date().toISOString() });
  }

  fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
  return { success: true, task_id: task.id, status: task.status };
}

// Auto-discover .agent-bridge directories nearby
function apiDiscover() {
  const found = [];
  const checked = new Set();
  const existing = new Set(getProjects().map(p => p.path));

  function scanDir(dir, depth) {
    if (depth > 2 || checked.has(dir)) return;
    checked.add(dir);
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') && entry.name !== '.agent-bridge') continue;
        if (entry.name === 'node_modules') continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.name === '.agent-bridge' && hasDataFiles(fullPath)) {
          const projectPath = dir;
          if (!existing.has(projectPath)) {
            found.push({ name: path.basename(projectPath), path: projectPath, dataDir: fullPath });
          }
        } else if (depth < 2) {
          scanDir(fullPath, depth + 1);
        }
      }
    } catch {}
  }

  // Scan from cwd, parent, and home
  const cwd = process.cwd();
  scanDir(cwd, 0);
  scanDir(path.dirname(cwd), 1);

  return found;
}

// --- HTTP Server ---

// Load HTML at startup (re-read on each request in dev for hot-reload)
let htmlContent = fs.readFileSync(HTML_FILE, 'utf8');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Serve dashboard HTML (re-read in dev mode for hot reload)
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = process.env.NODE_ENV === 'development'
        ? fs.readFileSync(HTML_FILE, 'utf8')
        : htmlContent;
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
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
    else if (url.pathname === '/api/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiStatus(url.searchParams)));
    }
    else if (url.pathname === '/api/reset' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiReset(url.searchParams)));
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
    else if (url.pathname === '/api/tasks' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiTasks(url.searchParams)));
    }
    else if (url.pathname === '/api/tasks' && req.method === 'POST') {
      const body = await parseBody(req);
      const result = apiUpdateTask(body, url.searchParams);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    else if (url.pathname === '/api/export' && req.method === 'GET') {
      const html = apiExportHtml(url.searchParams);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': 'attachment; filename="conversation-' + new Date().toISOString().slice(0, 10) + '.html"',
      });
      res.end(html);
    }
    else if (url.pathname === '/api/discover' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(apiDiscover()));
    }
    else if (url.pathname === '/api/projects' && req.method === 'DELETE') {
      const body = await parseBody(req);
      const result = apiRemoveProject(body);
      res.writeHead(result.error ? 400 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    }
    // Server-Sent Events endpoint for real-time updates
    else if (url.pathname === '/api/events' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      res.write(`data: connected\n\n`);
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
    }
    else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

// --- Server-Sent Events for real-time updates ---
// Watches data files and pushes updates to connected clients instantly
const sseClients = new Set();

function sseNotifyAll() {
  for (const res of sseClients) {
    try {
      res.write(`data: update\n\n`);
    } catch {
      sseClients.delete(res);
    }
  }
}

// Watch data directory for changes and push SSE notifications
let fsWatcher = null;
let sseDebounceTimer = null;

function startFileWatcher() {
  const dataDir = resolveDataDir();
  if (!fs.existsSync(dataDir)) return;
  try {
    fsWatcher = fs.watch(dataDir, { persistent: false }, () => {
      // Debounce — multiple file changes may fire rapidly
      if (sseDebounceTimer) clearTimeout(sseDebounceTimer);
      sseDebounceTimer = setTimeout(() => sseNotifyAll(), 200);
    });
    fsWatcher.on('error', () => {}); // ignore watch errors
  } catch {}
}

startFileWatcher();

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Error: Port ${PORT} is already in use.`);
    console.error(`  Another dashboard may be running. Try:`);
    console.error(`    - Kill it: npx kill-port ${PORT}`);
    console.error(`    - Or use a different port: AGENT_BRIDGE_PORT=3001 npx let-them-talk dashboard\n`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  const dataDir = resolveDataDir();
  console.log('');
  console.log('  Let Them Talk - Agent Bridge Dashboard v2.5');
  console.log('  ============================================');
  console.log('  Dashboard:  http://localhost:' + PORT);
  console.log('  Data dir:   ' + dataDir);
  console.log('  Projects:   ' + getProjects().length + ' registered');
  console.log('  Updates:    SSE (real-time) + polling fallback (2s)');
  console.log('');
});
