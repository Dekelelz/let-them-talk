#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const command = process.argv[2];

function printUsage() {
  console.log(`
  Let Them Talk — Agent Bridge v3.5.1
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
    npx let-them-talk status             Show active agents and message count
    npx let-them-talk help               Show this help message
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
  return path.join(cwd, '.agent-bridge').replace(/\\/g, '/');
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
    env: { AGENT_BRIDGE_DATA_DIR: dataDir(cwd) },
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
    env: { AGENT_BRIDGE_DATA_DIR: dataDir(cwd) },
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

  // Only add if not already present
  if (!config.includes('[mcp_servers.agent-bridge]')) {
    const tomlBlock = `
[mcp_servers.agent-bridge]
command = "node"
args = [${JSON.stringify(serverPath)}]
timeout = 300

[mcp_servers.agent-bridge.env]
AGENT_BRIDGE_DATA_DIR = ${JSON.stringify(dataDir(cwd))}
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
const model = process.argv[3] || 'llama3';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';

function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } }
function readJsonl(f) { if (!fs.existsSync(f)) return []; return fs.readFileSync(f, 'utf8').split('\\n').filter(l => l.trim()).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); }

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

  fs.writeFileSync(scriptPath, script);
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
    console.log('  Optional: Run "npx let-them-talk dashboard" to monitor conversations.');
    console.log('');
  }
}

function reset() {
  const dataDir = process.env.AGENT_BRIDGE_DATA_DIR || path.join(process.cwd(), '.agent-bridge');
  // Also check legacy data/ dir
  const legacyDir = path.join(process.cwd(), 'data');
  const targetDir = fs.existsSync(dataDir) ? dataDir : fs.existsSync(legacyDir) ? legacyDir : dataDir;

  if (!fs.existsSync(targetDir)) {
    console.log('  No data directory found. Nothing to reset.');
    return;
  }
  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(targetDir, { recursive: true });
  console.log(`  Cleared all data from ${targetDir}`);
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
    .split('\n')
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

  console.log('');
  console.log('  Agent Bridge Status');
  console.log('  ===================');
  console.log('  Messages: ' + history.length);
  console.log('');

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
      const msgCount = history.filter(m => m.from === name).length;
      console.log('    ' + name.padEnd(16) + ' ' + status + '  msgs: ' + msgCount + '  last: ' + (lastActivity ? new Date(lastActivity).toLocaleTimeString() : '-'));
    }
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
  case 'msg':
  case 'message':
  case 'send':
    cliMsg();
    break;
  case 'status':
    cliStatus();
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
