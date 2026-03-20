#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const command = process.argv[2];

function printUsage() {
  console.log(`
  Let Them Talk — Agent Bridge v5.2.5
  MCP message broker for inter-agent communication
  Supports: Claude Code, Gemini CLI, Codex CLI, Ollama

  Usage:
    npx let-them-talk init              Auto-detect CLI and configure MCP
    npx let-them-talk init --claude     Configure for Claude Code
    npx let-them-talk init --gemini     Configure for Gemini CLI
    npx let-them-talk init --codex      Configure for Codex CLI
    npx let-them-talk init --all        Configure for all supported CLIs
    npx let-them-talk init --ollama    Setup Ollama agent bridge (local LLM)
    npx let-them-talk init --template T  Initialize with a team template (pair, team, review, debate, ollama)
    npx let-them-talk templates         List available agent templates
    npx let-them-talk dashboard         Launch the web dashboard (http://localhost:3000)
    npx let-them-talk dashboard --lan   Launch dashboard accessible on LAN (phone/tablet)
    npx let-them-talk reset             Clear all conversation data
    npx let-them-talk msg <agent> <text> Send a message to an agent
    npx let-them-talk run "prompt" [--agents N] [--timeout M]  Autonomous execution with N agents, auto-stop after M minutes
    npx let-them-talk status             Show active agents and message count
    npx let-them-talk uninstall          Remove agent-bridge from all CLI configs
    npx let-them-talk help               Show this help message

  v5.0 — True Autonomy Engine (61 tools):
    New tools: get_work, verify_and_advance, start_plan, retry_with_improvement
    Proactive work loop: get_work → do work → verify_and_advance → get_work
    Parallel workflow steps with dependency graphs (depends_on)
    Auto-retry with skill accumulation (3 attempts then team escalation)
    Watchdog engine: idle nudge, stuck detection, auto-reassign
    100ms handoff cooldowns in autonomous mode
    Plan dashboard: live progress, pause/stop/skip/reassign controls
  `);
}

// Detect which CLIs are installed
function detectCLIs() {
  const detected = [];
  const home = os.homedir();

  // Claude Code: ~/.claude/ directory exists
  if (fs.existsSync(path.join(home, '.claude'))) {
    detected.push('claude');
  }

  // Gemini CLI: ~/.gemini/ or GEMINI_API_KEY set
  if (fs.existsSync(path.join(home, '.gemini')) || process.env.GEMINI_API_KEY) {
    detected.push('gemini');
  }

  // Codex CLI: ~/.codex/ directory exists
  if (fs.existsSync(path.join(home, '.codex'))) {
    detected.push('codex');
  }

  return detected;
}

// Detect Ollama installation
function detectOllama() {
  try {
    const version = execSync('ollama --version', { encoding: 'utf8', timeout: 5000 }).trim();
    return { installed: true, version };
  } catch {
    return { installed: false };
  }
}

// The data directory where all agents read/write — must be the same for server + dashboard
function dataDir(cwd) {
  return path.join(cwd, '.agent-bridge');
}

// Configure for Claude Code (.mcp.json in project root)
function setupClaude(serverPath, cwd) {
  const mcpConfigPath = path.join(cwd, '.mcp.json');
  let mcpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpConfigPath)) {
    try {
      mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf8'));
      if (!mcpConfig.mcpServers) mcpConfig.mcpServers = {};
    } catch {
      // Backup corrupted file before overwriting
      const backup = mcpConfigPath + '.backup';
      fs.copyFileSync(mcpConfigPath, backup);
      console.log('  [warn] Existing .mcp.json was invalid — backed up to .mcp.json.backup');
    }
  }

  mcpConfig.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
    timeout: 300,
  };

  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  console.log('  [ok] Claude Code: .mcp.json updated');
}

// Configure for Gemini CLI (.gemini/settings.json or GEMINI.md with MCP config)
function setupGemini(serverPath, cwd) {
  // Gemini CLI uses .gemini/settings.json for MCP configuration
  const geminiDir = path.join(cwd, '.gemini');
  const settingsPath = path.join(geminiDir, 'settings.json');

  if (!fs.existsSync(geminiDir)) {
    fs.mkdirSync(geminiDir, { recursive: true });
  }

  let settings = { mcpServers: {} };
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (!settings.mcpServers) settings.mcpServers = {};
    } catch {
      const backup = settingsPath + '.backup';
      fs.copyFileSync(settingsPath, backup);
      console.log('  [warn] Existing settings.json was invalid — backed up to settings.json.backup');
    }
  }

  settings.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
    timeout: 300,
    trust: true,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  console.log('  [ok] Gemini CLI: .gemini/settings.json updated');
}

// Configure for Codex CLI (uses .codex/config.toml)
function setupCodex(serverPath, cwd) {
  const codexDir = path.join(cwd, '.codex');
  const configPath = path.join(codexDir, 'config.toml');

  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true });
  }

  // Read existing config or start fresh
  let config = '';
  if (fs.existsSync(configPath)) {
    config = fs.readFileSync(configPath, 'utf8');
  }

  // Backup existing config before modifying
  if (fs.existsSync(configPath)) {
    fs.copyFileSync(configPath, configPath + '.backup');
  }

  // Only add if not already present
  if (!config.includes('[mcp_servers.agent-bridge]')) {
    const tomlBlock = `
[mcp_servers.agent-bridge]
command = "node"
args = [${JSON.stringify(serverPath)}]
timeout = 300
`;
    config += tomlBlock;
    fs.writeFileSync(configPath, config);
  }

  console.log('  [ok] Codex CLI: .codex/config.toml updated');
}

// Setup Ollama agent bridge script
function setupOllama(serverPath, cwd) {
  const dir = dataDir(cwd);
  const scriptPath = path.join(cwd, '.agent-bridge', 'ollama-agent.js');

  if (!fs.existsSync(path.join(cwd, '.agent-bridge'))) {
    fs.mkdirSync(path.join(cwd, '.agent-bridge'), { recursive: true });
  }

  const script = `#!/usr/bin/env node
// ollama-agent.js - bridges Ollama to Let Them Talk
// Usage: node .agent-bridge/ollama-agent.js [agent-name] [model]
const fs = require('fs'), path = require('path'), http = require('http');
const DATA_DIR = path.join(__dirname);
const name = process.argv[2] || 'Ollama';
if (!/^[a-zA-Z0-9_-]{1,20}$/.test(name)) throw new Error('Invalid agent name');
const model = process.argv[3] || 'llama3';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function readJsonl(f) { if (!fs.existsSync(f)) return []; return fs.readFileSync(f, 'utf8').split(/\\r?\\n/).filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

// Register agent
function register() {
  const agentsFile = path.join(DATA_DIR, 'agents.json');
  const agents = readJson(agentsFile);
  agents[name] = { pid: process.pid, timestamp: new Date().toISOString(), last_activity: new Date().toISOString(), provider: 'Ollama (' + model + ')' };
  fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
  console.log('[' + name + '] Registered (PID ' + process.pid + ', model: ' + model + ')');
}

// Update heartbeat
function heartbeat() {
  const agentsFile = path.join(DATA_DIR, 'agents.json');
  const agents = readJson(agentsFile);
  if (agents[name]) {
    agents[name].last_activity = new Date().toISOString();
    agents[name].pid = process.pid;
    fs.writeFileSync(agentsFile, JSON.stringify(agents, null, 2));
  }
}

// Call Ollama API
function callOllama(prompt) {
  return new Promise(function(resolve, reject) {
    const url = new URL(OLLAMA_URL + '/api/chat');
    const body = JSON.stringify({ model: model, messages: [{ role: 'user', content: prompt }], stream: false });
    const req = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, function(res) {
      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try { const j = JSON.parse(data); resolve(j.message ? j.message.content : data); }
        catch { resolve(data); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Send a message
function sendMessage(to, content) {
  const msgId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const msg = { id: msgId, from: name, to: to, content: content, timestamp: new Date().toISOString() };
  fs.appendFileSync(path.join(DATA_DIR, 'messages.jsonl'), JSON.stringify(msg) + '\\n');
  fs.appendFileSync(path.join(DATA_DIR, 'history.jsonl'), JSON.stringify(msg) + '\\n');
  console.log('[' + name + '] -> ' + to + ': ' + content.substring(0, 80) + (content.length > 80 ? '...' : ''));
}

// Listen for messages
let lastOffset = 0;
function checkMessages() {
  const consumedFile = path.join(DATA_DIR, 'consumed-' + name + '.json');
  const consumed = readJson(consumedFile);
  lastOffset = consumed.offset || 0;

  const messages = readJsonl(path.join(DATA_DIR, 'messages.jsonl'));
  const newMsgs = messages.slice(lastOffset).filter(function(m) {
    return m.to === name || (m.to === 'all' && m.from !== name);
  });

  if (newMsgs.length > 0) {
    consumed.offset = messages.length;
    fs.writeFileSync(consumedFile, JSON.stringify(consumed));
  }

  return newMsgs;
}

async function processMessages() {
  const msgs = checkMessages();
  for (const m of msgs) {
    console.log('[' + name + '] <- ' + m.from + ': ' + m.content.substring(0, 80));
    try {
      const response = await callOllama(m.content);
      sendMessage(m.from, response);
    } catch (e) {
      sendMessage(m.from, 'Error calling Ollama: ' + e.message);
    }
  }
}

// Main loop
register();
const hb = setInterval(heartbeat, 10000);
hb.unref();
console.log('[' + name + '] Listening for messages... (Ctrl+C to stop)');
setInterval(processMessages, 2000);

// Cleanup on exit
process.on('SIGINT', function() { console.log('\\n[' + name + '] Shutting down.'); process.exit(0); });
`;

  const tmpPath = scriptPath + '.tmp.' + process.pid;
  fs.writeFileSync(tmpPath, script);
  fs.renameSync(tmpPath, scriptPath);
  console.log('  [ok] Ollama agent script created: .agent-bridge/ollama-agent.js');
  console.log('');
  console.log('  Launch an Ollama agent with:');
  console.log('    node .agent-bridge/ollama-agent.js <name> <model>');
  console.log('');
  console.log('  Examples:');
  console.log('    node .agent-bridge/ollama-agent.js Ollama llama3');
  console.log('    node .agent-bridge/ollama-agent.js Coder codellama');
  console.log('    node .agent-bridge/ollama-agent.js Writer mistral');
}

function init() {
  const cwd = process.cwd();
  const serverPath = path.join(__dirname, 'server.js').replace(/\\/g, '/');
  const gitignorePath = path.join(cwd, '.gitignore');
  const flag = process.argv[3];

  console.log('');
  console.log('  Let Them Talk — Initializing Agent Bridge');
  console.log('  ==========================================');
  console.log('');

  let targets = [];

  if (flag === '--claude') {
    targets = ['claude'];
  } else if (flag === '--gemini') {
    targets = ['gemini'];
  } else if (flag === '--codex') {
    targets = ['codex'];
  } else if (flag === '--all') {
    targets = ['claude', 'gemini', 'codex'];
  } else if (flag === '--ollama') {
    const ollama = detectOllama();
    if (!ollama.installed) {
      console.log('  Ollama not found. Install it from: https://ollama.com/download');
      console.log('  After installing, run: ollama pull llama3');
      console.log('');
    } else {
      console.log('  Ollama detected: ' + ollama.version);
      setupOllama(serverPath, cwd);
    }
    targets = detectCLIs();
    if (targets.length === 0) targets = ['claude'];
  } else {
    // Auto-detect
    targets = detectCLIs();
    if (targets.length === 0) {
      // Default to claude if nothing detected
      targets = ['claude'];
      console.log('  No CLI detected, defaulting to Claude Code config.');
    } else {
      console.log(`  Detected CLI(s): ${targets.join(', ')}`);
    }
  }

  console.log('');

  for (const target of targets) {
    switch (target) {
      case 'claude': setupClaude(serverPath, cwd); break;
      case 'gemini': setupGemini(serverPath, cwd); break;
      case 'codex':  setupCodex(serverPath, cwd);  break;
    }
  }

  // Add .agent-bridge/ and MCP config files to .gitignore
  const gitignoreEntries = ['.agent-bridge/', '.mcp.json', '.codex/', '.gemini/'];
  if (fs.existsSync(gitignorePath)) {
    let content = fs.readFileSync(gitignorePath, 'utf8');
    const missing = gitignoreEntries.filter(e => !content.includes(e));
    if (missing.length) {
      content += '\n# Agent Bridge (auto-added by let-them-talk init)\n' + missing.join('\n') + '\n';
      fs.writeFileSync(gitignorePath, content);
      console.log('  [ok] Added to .gitignore: ' + missing.join(', '));
    } else {
      console.log('  [ok] .gitignore already configured');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Agent Bridge (auto-added by let-them-talk init)\n' + gitignoreEntries.join('\n') + '\n');
    console.log('  [ok] .gitignore created');
  }

  console.log('');
  console.log('  Agent Bridge is ready! Restart your CLI to pick up the MCP tools.');
  console.log('');

  // Show template if --template was provided
  var templateFlag = null;
  for (var i = 3; i < process.argv.length; i++) {
    if (process.argv[i] === '--template' && process.argv[i + 1]) {
      templateFlag = process.argv[i + 1];
      break;
    }
  }

  if (templateFlag) {
    showTemplate(templateFlag);
  } else {
    console.log('  Open two terminals and start a conversation between agents.');
    console.log('  Tip: Use "npx let-them-talk init --template pair" for ready-made prompts.');
    console.log('');
    console.log('  \x1b[1m  Try autonomous mode:\x1b[0m');
    console.log('    npx let-them-talk run "build a REST API" --agents 3');
    console.log('');
    console.log('  \x1b[1m  Monitor:\x1b[0m');
    console.log('    npx let-them-talk dashboard');
    console.log('    npx let-them-talk status');
    console.log('    npx let-them-talk doctor');
    console.log('');
  }
}

function reset() {
  const targetDir = process.env.AGENT_BRIDGE_DATA_DIR || path.join(process.cwd(), '.agent-bridge');

  if (!fs.existsSync(targetDir)) {
    console.log('  No .agent-bridge/ directory found. Nothing to reset.');
    return;
  }

  // Safety: count messages to show user what they're about to delete
  const historyFile = path.join(targetDir, 'history.jsonl');
  let msgCount = 0;
  if (fs.existsSync(historyFile)) {
    msgCount = fs.readFileSync(historyFile, 'utf8').split(/\r?\n/).filter(l => l.trim()).length;
  }

  // Require --force flag, otherwise warn and exit
  if (!process.argv.includes('--force')) {
    console.log('');
    console.log('  ⚠  This will permanently delete all conversation data in:');
    console.log('     ' + targetDir);
    if (msgCount > 0) console.log('     (' + msgCount + ' messages in history)');
    console.log('');
    console.log('  To confirm, run:  npx let-them-talk reset --force');
    console.log('');
    return;
  }

  // Auto-archive before deleting
  const archiveDir = path.join(targetDir, '..', '.agent-bridge-archive');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivePath = path.join(archiveDir, timestamp);
  try {
    fs.mkdirSync(archivePath, { recursive: true });
    const filesToArchive = ['history.jsonl', 'messages.jsonl', 'agents.json', 'decisions.json', 'tasks.json'];
    let archived = 0;
    for (const f of filesToArchive) {
      const src = path.join(targetDir, f);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(archivePath, f));
        archived++;
      }
    }
    if (archived > 0) {
      console.log('  [ok] Archived ' + archived + ' files to .agent-bridge-archive/' + timestamp + '/');
    }
  } catch (e) {
    console.log('  [warn] Could not archive: ' + e.message + ' — proceeding with reset anyway.');
  }

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('  Cleared all data from ' + targetDir);
}

function getTemplates() {
  const templatesDir = path.join(__dirname, 'templates');
  if (!fs.existsSync(templatesDir)) return [];
  return fs.readdirSync(templatesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(templatesDir, f), 'utf8')); }
      catch { return null; }
    })
    .filter(Boolean);
}

function listTemplates() {
  const templates = getTemplates();
  console.log('');
  console.log('  Available Agent Templates');
  console.log('  ========================');
  console.log('');
  for (const t of templates) {
    const agentNames = t.agents.map(a => a.name).join(', ');
    console.log('  ' + t.name.padEnd(12) + ' ' + t.description);
    console.log('  ' + ''.padEnd(12) + ' Agents: ' + agentNames);
    console.log('');
  }
  console.log('  Usage: npx let-them-talk init --template <name>');
  console.log('');
}

function showTemplate(templateName) {
  const templates = getTemplates();
  const template = templates.find(t => t.name === templateName);
  if (!template) {
    console.error('  Unknown template: ' + templateName);
    console.error('  Available: ' + templates.map(t => t.name).join(', '));
    process.exit(1);
  }

  console.log('');
  console.log('  Template: ' + template.name);
  console.log('  ' + template.description);
  console.log('');
  console.log('  Copy these prompts into each terminal:');
  console.log('  ======================================');

  for (var i = 0; i < template.agents.length; i++) {
    var a = template.agents[i];
    console.log('');
    console.log('  --- Terminal ' + (i + 1) + ': ' + a.name + ' (' + a.role + ') ---');
    console.log('');
    console.log('  ' + a.prompt.replace(/\n/g, '\n  '));
    console.log('');
  }
}

function dashboard() {
  if (process.argv.includes('--lan')) {
    process.env.AGENT_BRIDGE_LAN = 'true';
  }
  require('./dashboard.js');
}

function resolveDataDirCli() {
  return process.env.AGENT_BRIDGE_DATA_DIR || path.join(process.cwd(), '.agent-bridge');
}

function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(l => l.trim())
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return {}; }
}

function isPidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function cliMsg() {
  const recipient = process.argv[3];
  const textParts = process.argv.slice(4);
  if (!recipient || !textParts.length) {
    console.error('  Usage: npx let-them-talk msg <agent> <text>');
    process.exit(1);
  }
  if (!/^[a-zA-Z0-9_-]{1,20}$/.test(recipient)) {
    console.error('  Agent name must be 1-20 alphanumeric characters (with _ or -).');
    process.exit(1);
  }
  const text = textParts.join(' ');
  const dir = resolveDataDirCli();
  if (!fs.existsSync(dir)) {
    console.error('  No .agent-bridge/ directory found. Run "npx let-them-talk init" first.');
    process.exit(1);
  }

  const msgId = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const msg = {
    id: msgId,
    from: 'CLI',
    to: recipient,
    content: text,
    timestamp: new Date().toISOString(),
  };

  const messagesFile = path.join(dir, 'messages.jsonl');
  const historyFile = path.join(dir, 'history.jsonl');
  fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
  fs.appendFileSync(historyFile, JSON.stringify(msg) + '\n');

  console.log('  Message sent to ' + recipient + ': ' + text);
}

function cliStatus() {
  const dir = resolveDataDirCli();
  if (!fs.existsSync(dir)) {
    console.error('  No .agent-bridge/ directory found. Run "npx let-them-talk init" first.');
    process.exit(1);
  }

  const agents = readJson(path.join(dir, 'agents.json'));
  const history = readJsonl(path.join(dir, 'history.jsonl'));
  const profiles = readJson(path.join(dir, 'profiles.json'));
  const workflows = readJson(path.join(dir, 'workflows.json'));
  const tasks = readJson(path.join(dir, 'tasks.json'));

  // Merge heartbeat files for live activity data
  try {
    const files = fs.readdirSync(dir).filter(f => f.startsWith('heartbeat-') && f.endsWith('.json'));
    for (const f of files) {
      const name = f.slice(10, -5);
      if (agents[name]) {
        try {
          const hb = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
          if (hb.last_activity) agents[name].last_activity = hb.last_activity;
          if (hb.pid) agents[name].pid = hb.pid;
        } catch {}
      }
    }
  } catch {}

  const onlineCount = Object.values(agents).filter(a => isPidAlive(a.pid)).length;

  console.log('');
  console.log('  Let Them Talk — Status');
  console.log('  =======================');
  console.log('  Messages: ' + history.length + '  |  Agents: ' + onlineCount + '/' + Object.keys(agents).length + ' online');
  console.log('');

  // Agents with roles
  const names = Object.keys(agents);
  if (!names.length) {
    console.log('  No agents registered.');
  } else {
    console.log('  Agents:');
    for (const name of names) {
      const info = agents[name];
      const alive = isPidAlive(info.pid);
      const status = alive ? '\x1b[32monline\x1b[0m' : '\x1b[31moffline\x1b[0m';
      const lastActivity = info.last_activity || info.timestamp || '';
      const role = (profiles && profiles[name] && profiles[name].role) ? ' [' + profiles[name].role + ']' : '';
      const msgCount = history.filter(m => m.from === name).length;
      console.log('    ' + name.padEnd(16) + ' ' + status + role.padEnd(16) + '  msgs: ' + msgCount + '  last: ' + (lastActivity ? new Date(lastActivity).toLocaleTimeString() : '-'));
    }
  }

  // Active workflows
  const activeWfs = Array.isArray(workflows) ? workflows.filter(w => w.status === 'active') : [];
  if (activeWfs.length > 0) {
    console.log('');
    console.log('  Workflows:');
    for (const wf of activeWfs) {
      const done = wf.steps.filter(s => s.status === 'done').length;
      const total = wf.steps.length;
      const pct = Math.round((done / total) * 100);
      const mode = wf.autonomous ? ' (autonomous)' : '';
      console.log('    ' + wf.name.padEnd(24) + ' ' + done + '/' + total + ' (' + pct + '%)' + mode);
    }
  }

  // Active tasks
  const activeTasks = Array.isArray(tasks) ? tasks.filter(t => t.status === 'in_progress') : [];
  if (activeTasks.length > 0) {
    console.log('');
    console.log('  Tasks in progress:');
    for (const t of activeTasks.slice(0, 5)) {
      console.log('    ' + (t.title || 'Untitled').padEnd(30) + ' -> ' + (t.assignee || 'unassigned'));
    }
    if (activeTasks.length > 5) console.log('    ... and ' + (activeTasks.length - 5) + ' more');
  }

  console.log('');
}

// v5.0: One-command autonomous execution
function cliRun() {
  const prompt = process.argv[3];
  if (!prompt) {
    console.error('  Usage: npx let-them-talk run "build a login system" [--agents N] [--timeout M]');
    console.error('  Spawns N agent processes, auto-assigns roles, creates autonomous workflow, and starts execution.');
    process.exit(1);
  }

  // Parse --agents flag (default: 3)
  let agentCount = 3;
  const agentsIdx = process.argv.indexOf('--agents');
  if (agentsIdx !== -1 && process.argv[agentsIdx + 1]) {
    agentCount = Math.max(2, Math.min(10, parseInt(process.argv[agentsIdx + 1]) || 3));
  }

  // Parse --timeout flag (default: no timeout, in minutes)
  let timeoutMin = 0;
  const timeoutIdx = process.argv.indexOf('--timeout');
  if (timeoutIdx !== -1 && process.argv[timeoutIdx + 1]) {
    timeoutMin = Math.max(1, parseInt(process.argv[timeoutIdx + 1]) || 0);
  }

  const cwd = process.cwd();
  const dir = path.join(cwd, '.agent-bridge');
  const serverPath = path.join(__dirname, 'server.js');

  // Ensure data directory exists
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Set group conversation mode
  const configPath = path.join(dir, 'config.json');
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  config.conversation_mode = 'group';
  fs.writeFileSync(configPath, JSON.stringify(config));

  // Agent names based on count
  const AGENT_NAMES = ['Lead', 'Builder', 'Reviewer', 'Architect', 'Frontend', 'Backend', 'Tester', 'Designer', 'DevOps', 'Security'];
  const names = AGENT_NAMES.slice(0, agentCount);

  console.log('');
  console.log('  Let Them Talk — Autonomous Run');
  console.log('  ===============================');
  console.log('  Prompt: ' + prompt);
  console.log('  Agents: ' + agentCount + ' (' + names.join(', ') + ')');
  console.log('  Mode: Autonomous (proactive work loop)');
  console.log('');

  const { spawn } = require('child_process');
  const children = [];

  // Spawn agent processes
  for (let i = 0; i < agentCount; i++) {
    const agentName = names[i];
    console.log('  Spawning agent: ' + agentName + '...');

    const child = spawn('node', [serverPath], {
      env: {
        ...process.env,
        AGENT_BRIDGE_DATA_DIR: dir,
        AGENT_BRIDGE_AUTO_REGISTER: agentName,
        AGENT_BRIDGE_AUTO_PROMPT: i === 0 ? prompt : '', // only first agent gets the prompt
      },
      stdio: 'pipe',
      cwd: cwd,
    });

    child.on('error', (err) => {
      console.error('  [' + agentName + '] Error: ' + err.message);
    });

    child.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.log('  \x1b[33m[' + agentName + '] Crashed (code ' + code + '). Auto-restarting...\x1b[0m');
        const restart = spawn('node', [serverPath], {
          env: { ...process.env, AGENT_BRIDGE_DATA_DIR: dir, AGENT_BRIDGE_AUTO_REGISTER: agentName },
          stdio: 'pipe', cwd: cwd,
        });
        const entry = children.find(c => c.name === agentName);
        if (entry) entry.process = restart;
      } else {
        console.log('  [' + agentName + '] Exited.');
      }
    });

    children.push({ name: agentName, process: child });
  }

  console.log('');
  console.log('  All ' + agentCount + ' agents spawned. They will auto-register and start working.');
  console.log('  Open the dashboard to monitor: npx let-them-talk dashboard');
  console.log('');
  console.log('  Press Ctrl+C to stop all agents.');
  console.log('');

  // Inject the prompt as a dashboard message after agents register
  setTimeout(() => {
    try {
      const messagesFile = path.join(dir, 'messages.jsonl');
      const msg = {
        id: 'run_' + Date.now().toString(36),
        from: 'Dashboard',
        to: '__group__',
        content: prompt,
        timestamp: new Date().toISOString(),
        broadcast: true,
      };
      fs.appendFileSync(messagesFile, JSON.stringify(msg) + '\n');
      const historyFile = path.join(dir, 'history.jsonl');
      fs.appendFileSync(historyFile, JSON.stringify(msg) + '\n');
      console.log('  Prompt injected to team. Agents will pick it up via get_work().');
    } catch (e) {
      console.error('  Failed to inject prompt: ' + e.message);
    }
  }, 3000); // 3s delay for agents to register

  // Clean shutdown on Ctrl+C
  process.on('SIGINT', () => {
    console.log('\n  Stopping all agents...');
    for (const c of children) {
      try { c.process.kill(); } catch {}
    }
    process.exit(0);
  });

  // Auto-stop after --timeout minutes
  if (timeoutMin > 0) {
    console.log('  Auto-stop in ' + timeoutMin + ' minute(s).');
    setTimeout(() => {
      console.log('\n  Timeout reached (' + timeoutMin + 'min). Stopping all agents...');
      for (const c of children) { try { c.process.kill(); } catch {} }
      process.exit(0);
    }, timeoutMin * 60000);
  }

  // Periodic progress updates every 30s
  setInterval(() => {
    try {
      const agentsData = fs.existsSync(path.join(dir, 'agents.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'agents.json'), 'utf8')) : {};
      const online = Object.values(agentsData).filter(a => {
        try { process.kill(a.pid, 0); return true; } catch { return false; }
      }).length;
      const history = fs.existsSync(path.join(dir, 'history.jsonl')) ? fs.readFileSync(path.join(dir, 'history.jsonl'), 'utf8').trim().split(/\r?\n/).filter(l => l.trim()).length : 0;
      const tasksData = fs.existsSync(path.join(dir, 'tasks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')) : [];
      const done = Array.isArray(tasksData) ? tasksData.filter(t => t.status === 'done').length : 0;
      const active = Array.isArray(tasksData) ? tasksData.filter(t => t.status === 'in_progress').length : 0;
      console.log(`  \x1b[90m[${new Date().toLocaleTimeString()}]\x1b[0m ${online} agents | ${history} msgs | ${done} done, ${active} active`);
    } catch {}
  }, 30000);
}

// v5.0: Diagnostic health check
function cliDoctor() {
  console.log('');
  console.log('  \x1b[1mLet Them Talk — Doctor\x1b[0m');
  console.log('  ======================');
  let issues = 0;

  // Check data directory
  const dir = path.join(process.cwd(), '.agent-bridge');
  if (fs.existsSync(dir)) {
    console.log('  \x1b[32m✓\x1b[0m .agent-bridge/ directory exists');
    try { fs.accessSync(dir, fs.constants.W_OK); console.log('  \x1b[32m✓\x1b[0m .agent-bridge/ is writable'); }
    catch { console.log('  \x1b[31m✗\x1b[0m .agent-bridge/ is NOT writable'); issues++; }
  } else {
    console.log('  \x1b[33m!\x1b[0m .agent-bridge/ not found. Run "npx let-them-talk init" first.');
    issues++;
  }

  // Check server.js
  const serverPath = path.join(__dirname, 'server.js');
  if (fs.existsSync(serverPath)) {
    console.log('  \x1b[32m✓\x1b[0m server.js found');
  } else {
    console.log('  \x1b[31m✗\x1b[0m server.js MISSING'); issues++;
  }

  // Check agents online
  if (fs.existsSync(dir)) {
    const agentsFile = path.join(dir, 'agents.json');
    if (fs.existsSync(agentsFile)) {
      const agents = readJson(agentsFile);
      const online = Object.entries(agents).filter(([, a]) => isPidAlive(a.pid)).length;
      const total = Object.keys(agents).length;
      if (online > 0) {
        console.log('  \x1b[32m✓\x1b[0m ' + online + '/' + total + ' agents online');
      } else if (total > 0) {
        console.log('  \x1b[33m!\x1b[0m ' + total + ' agents registered but none online');
      } else {
        console.log('  \x1b[33m!\x1b[0m No agents registered yet');
      }
    }

    // Check config
    const configFile = path.join(dir, 'config.json');
    if (fs.existsSync(configFile)) {
      const config = readJson(configFile);
      console.log('  \x1b[32m✓\x1b[0m Conversation mode: ' + (config.conversation_mode || 'direct'));
    }

    // Check guide file
    const guideFile = path.join(dir, 'guide.md');
    if (fs.existsSync(guideFile)) {
      console.log('  \x1b[32m✓\x1b[0m Custom guide.md found');
    }
  }

  // Check Node version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 18) {
    console.log('  \x1b[32m✓\x1b[0m Node.js ' + nodeVersion + ' (OK)');
  } else {
    console.log('  \x1b[31m✗\x1b[0m Node.js ' + nodeVersion + ' — v18+ recommended'); issues++;
  }

  console.log('');
  if (issues === 0) {
    console.log('  \x1b[32mAll checks passed. System is healthy.\x1b[0m');
  } else {
    console.log('  \x1b[31m' + issues + ' issue(s) found. Fix them and run doctor again.\x1b[0m');
  }
  console.log('');
}

// Uninstall agent-bridge from all CLI configs
function uninstall() {
  const cwd = process.cwd();
  const home = os.homedir();
  const removed = [];
  const notFound = [];

  console.log('');
  console.log('  Let Them Talk — Uninstall');
  console.log('  =========================');
  console.log('');

  // 1. Remove from Claude Code project config (.mcp.json in cwd)
  const mcpLocalPath = path.join(cwd, '.mcp.json');
  if (fs.existsSync(mcpLocalPath)) {
    try {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpLocalPath, 'utf8'));
      if (mcpConfig.mcpServers && mcpConfig.mcpServers['agent-bridge']) {
        delete mcpConfig.mcpServers['agent-bridge'];
        fs.writeFileSync(mcpLocalPath, JSON.stringify(mcpConfig, null, 2) + '\n');
        removed.push('Claude Code (project): ' + mcpLocalPath);
      } else {
        notFound.push('Claude Code (project): no agent-bridge entry in .mcp.json');
      }
    } catch (e) {
      console.log('  [warn] Could not parse ' + mcpLocalPath + ': ' + e.message);
    }
  } else {
    notFound.push('Claude Code (project): .mcp.json not found');
  }

  // 2. Remove from Claude Code global config (~/.claude/mcp.json)
  const mcpGlobalPath = path.join(home, '.claude', 'mcp.json');
  if (fs.existsSync(mcpGlobalPath)) {
    try {
      const mcpConfig = JSON.parse(fs.readFileSync(mcpGlobalPath, 'utf8'));
      if (mcpConfig.mcpServers && mcpConfig.mcpServers['agent-bridge']) {
        delete mcpConfig.mcpServers['agent-bridge'];
        fs.writeFileSync(mcpGlobalPath, JSON.stringify(mcpConfig, null, 2) + '\n');
        removed.push('Claude Code (global): ' + mcpGlobalPath);
      } else {
        notFound.push('Claude Code (global): no agent-bridge entry');
      }
    } catch (e) {
      console.log('  [warn] Could not parse ' + mcpGlobalPath + ': ' + e.message);
    }
  } else {
    notFound.push('Claude Code (global): ~/.claude/mcp.json not found');
  }

  // 3. Remove from Gemini CLI config (~/.gemini/settings.json)
  const geminiSettingsPath = path.join(home, '.gemini', 'settings.json');
  if (fs.existsSync(geminiSettingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(geminiSettingsPath, 'utf8'));
      if (settings.mcpServers && settings.mcpServers['agent-bridge']) {
        delete settings.mcpServers['agent-bridge'];
        fs.writeFileSync(geminiSettingsPath, JSON.stringify(settings, null, 2) + '\n');
        removed.push('Gemini CLI: ' + geminiSettingsPath);
      } else {
        notFound.push('Gemini CLI: no agent-bridge entry');
      }
    } catch (e) {
      console.log('  [warn] Could not parse ' + geminiSettingsPath + ': ' + e.message);
    }
  } else {
    notFound.push('Gemini CLI: ~/.gemini/settings.json not found');
  }

  // 4. Remove from Gemini CLI project config (.gemini/settings.json in cwd)
  const geminiLocalPath = path.join(cwd, '.gemini', 'settings.json');
  if (fs.existsSync(geminiLocalPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(geminiLocalPath, 'utf8'));
      if (settings.mcpServers && settings.mcpServers['agent-bridge']) {
        delete settings.mcpServers['agent-bridge'];
        fs.writeFileSync(geminiLocalPath, JSON.stringify(settings, null, 2) + '\n');
        removed.push('Gemini CLI (project): ' + geminiLocalPath);
      } else {
        notFound.push('Gemini CLI (project): no agent-bridge entry');
      }
    } catch (e) {
      console.log('  [warn] Could not parse ' + geminiLocalPath + ': ' + e.message);
    }
  }

  // 5. Remove from Codex CLI config (~/.codex/config.toml)
  const codexConfigPath = path.join(home, '.codex', 'config.toml');
  if (fs.existsSync(codexConfigPath)) {
    try {
      let config = fs.readFileSync(codexConfigPath, 'utf8');
      if (config.includes('[mcp_servers.agent-bridge]')) {
        // Remove from [mcp_servers.agent-bridge] to the next [section] or end of file
        // This covers both [mcp_servers.agent-bridge] and [mcp_servers.agent-bridge.env]
        config = config.replace(/\n?\[mcp_servers\.agent-bridge[^\]]*\][^\[]*(?=\[|$)/g, '');
        // Clean up multiple blank lines left behind
        config = config.replace(/\n{3,}/g, '\n\n');
        fs.writeFileSync(codexConfigPath, config);
        removed.push('Codex CLI: ' + codexConfigPath);
      } else {
        notFound.push('Codex CLI: no agent-bridge section in config.toml');
      }
    } catch (e) {
      console.log('  [warn] Could not process ' + codexConfigPath + ': ' + e.message);
    }
  } else {
    notFound.push('Codex CLI: ~/.codex/config.toml not found');
  }

  // 6. Remove from Codex CLI project config (.codex/config.toml in cwd)
  const codexLocalPath = path.join(cwd, '.codex', 'config.toml');
  if (fs.existsSync(codexLocalPath)) {
    try {
      let config = fs.readFileSync(codexLocalPath, 'utf8');
      if (config.includes('[mcp_servers.agent-bridge]')) {
        config = config.replace(/\n?\[mcp_servers\.agent-bridge[^\]]*\][^\[]*(?=\[|$)/g, '');
        config = config.replace(/\n{3,}/g, '\n\n');
        fs.writeFileSync(codexLocalPath, config);
        removed.push('Codex CLI (project): ' + codexLocalPath);
      }
    } catch (e) {
      console.log('  [warn] Could not process ' + codexLocalPath + ': ' + e.message);
    }
  }

  // Print summary
  if (removed.length > 0) {
    console.log('  Removed agent-bridge from:');
    for (const r of removed) {
      console.log('    [ok] ' + r);
    }
  } else {
    console.log('  No agent-bridge configurations found to remove.');
  }

  if (notFound.length > 0) {
    console.log('');
    console.log('  Skipped (not found):');
    for (const n of notFound) {
      console.log('    [-] ' + n);
    }
  }

  // 7. Check for data directory
  const dataPath = path.join(cwd, '.agent-bridge');
  if (fs.existsSync(dataPath)) {
    console.log('');
    console.log('  Found .agent-bridge/ directory with conversation data.');
    console.log('  To remove it, manually delete: ' + dataPath);
  }

  console.log('');
  if (removed.length > 0) {
    console.log('  Restart your CLI terminals for changes to take effect.');
  }
  console.log('');
}

switch (command) {
  case 'init':
    init();
    break;
  case 'templates':
    listTemplates();
    break;
  case 'dashboard':
    dashboard();
    break;
  case 'reset':
    reset();
    break;
  case 'doctor':
    cliDoctor();
    break;
  case 'msg':
  case 'message':
  case 'send':
    cliMsg();
    break;
  case 'status':
    cliStatus();
    break;
  case 'run':
    cliRun();
    break;
  case 'uninstall':
  case 'remove':
    uninstall();
    break;
  case 'plugin':
  case 'plugins':
    console.log('  Plugins have been removed in v3.4.3. CLI terminals have their own extension systems.');
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    printUsage();
    break;
  default:
    console.error(`  Unknown command: ${command}`);
    printUsage();
    process.exit(1);
}
