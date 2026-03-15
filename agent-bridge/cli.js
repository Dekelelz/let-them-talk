#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const command = process.argv[2];

function printUsage() {
  console.log(`
  Let Them Talk — Agent Bridge v3.4.1
  MCP message broker for inter-agent communication
  Supports: Claude Code, Gemini CLI, Codex CLI

  Usage:
    npx let-them-talk init              Auto-detect CLI and configure MCP
    npx let-them-talk init --claude     Configure for Claude Code
    npx let-them-talk init --gemini     Configure for Gemini CLI
    npx let-them-talk init --codex      Configure for Codex CLI
    npx let-them-talk init --all        Configure for all supported CLIs
    npx let-them-talk init --template T  Initialize with a team template (pair, team, review, debate)
    npx let-them-talk templates         List available agent templates
    npx let-them-talk dashboard         Launch the web dashboard (http://localhost:3000)
    npx let-them-talk dashboard --lan   Launch dashboard accessible on LAN (phone/tablet)
    npx let-them-talk reset             Clear all conversation data
    npx let-them-talk plugin list       List installed plugins
    npx let-them-talk plugin add <file> Install a plugin from a .js file
    npx let-them-talk plugin remove <n> Remove a plugin by name
    npx let-them-talk plugin enable <n> Enable a plugin
    npx let-them-talk plugin disable <n> Disable a plugin
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
    } catch {}
  }

  mcpConfig.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
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
    } catch {}
  }

  settings.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
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

[mcp_servers.agent-bridge.env]
AGENT_BRIDGE_DATA_DIR = ${JSON.stringify(dataDir(cwd))}
`;
    config += tomlBlock;
    fs.writeFileSync(configPath, config);
  }

  console.log('  [ok] Codex CLI: .codex/config.toml updated');
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

  // Add .agent-bridge/ to .gitignore
  if (fs.existsSync(gitignorePath)) {
    const content = fs.readFileSync(gitignorePath, 'utf8');
    if (!content.includes('.agent-bridge')) {
      fs.appendFileSync(gitignorePath, '\n# Agent Bridge conversation data\n.agent-bridge/\n');
      console.log('  [ok] .agent-bridge/ added to .gitignore');
    } else {
      console.log('  [ok] .agent-bridge/ already in .gitignore');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Agent Bridge conversation data\n.agent-bridge/\n');
    console.log('  [ok] .gitignore created with .agent-bridge/');
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

function pluginCmd() {
  const subCmd = process.argv[3];
  const dataDir = process.env.AGENT_BRIDGE_DATA_DIR || path.join(process.cwd(), '.agent-bridge');
  const pluginsDir = path.join(dataDir, 'plugins');
  const pluginsFile = path.join(dataDir, 'plugins.json');

  function getRegistry() {
    if (!fs.existsSync(pluginsFile)) return [];
    try { return JSON.parse(fs.readFileSync(pluginsFile, 'utf8')); } catch { return []; }
  }

  function saveRegistry(reg) {
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(pluginsFile, JSON.stringify(reg, null, 2));
  }

  switch (subCmd) {
    case 'list': {
      const plugins = getRegistry();
      if (!plugins.length) {
        console.log('  No plugins installed.');
        console.log('  Install with: npx let-them-talk plugin add <file.js>');
        return;
      }
      console.log('');
      console.log('  Installed Plugins');
      console.log('  =================');
      for (const p of plugins) {
        const status = p.enabled !== false ? 'enabled' : 'disabled';
        console.log('  ' + p.name.padEnd(20) + ' ' + status.padEnd(10) + ' ' + (p.description || ''));
      }
      console.log('');
      break;
    }
    case 'add': {
      const filePath = process.argv[4];
      if (!filePath) { console.error('  Usage: npx let-them-talk plugin add <file.js>'); process.exit(1); }
      const absPath = path.resolve(filePath);
      if (!fs.existsSync(absPath)) { console.error('  File not found: ' + absPath); process.exit(1); }

      // Validate plugin structure without executing it (no require — prevents RCE on install)
      try {
        const src = fs.readFileSync(absPath, 'utf8');
        if (!src.includes('module.exports') || !src.includes('name') || !src.includes('handler')) {
          console.error('  Plugin must export name, description, and handler (module.exports = { name, handler })');
          process.exit(1);
        }

        // Extract plugin name from source using regex (no eval)
        const nameMatch = src.match(/name\s*:\s*['"]([^'"]+)['"]/);
        const descMatch = src.match(/description\s*:\s*['"]([^'"]+)['"]/);
        const pluginName = nameMatch ? nameMatch[1] : path.basename(absPath, '.js');
        const pluginDesc = descMatch ? descMatch[1] : '';

        if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir, { recursive: true });
        const destFile = path.join(pluginsDir, path.basename(absPath));
        fs.copyFileSync(absPath, destFile);

        const reg = getRegistry();
        if (!reg.find(p => p.name === pluginName)) {
          reg.push({ name: pluginName, description: pluginDesc, file: path.basename(absPath), enabled: true, added_at: new Date().toISOString() });
          saveRegistry(reg);
        }
        console.log('  Plugin "' + pluginName + '" installed successfully.');
        console.log('  Restart CLI to load the new tool (runs sandboxed).');
      } catch (e) {
        console.error('  Failed to install plugin: ' + e.message);
        process.exit(1);
      }
      break;
    }
    case 'remove': {
      const name = process.argv[4];
      if (!name) { console.error('  Usage: npx let-them-talk plugin remove <name>'); process.exit(1); }
      const reg = getRegistry();
      const plugin = reg.find(p => p.name === name);
      if (!plugin) { console.error('  Plugin not found: ' + name); process.exit(1); }
      const newReg = reg.filter(p => p.name !== name);
      saveRegistry(newReg);
      if (plugin.file) {
        const pluginFile = path.resolve(pluginsDir, plugin.file);
        // Prevent path traversal — only delete files inside pluginsDir
        if (pluginFile.startsWith(path.resolve(pluginsDir) + path.sep) && fs.existsSync(pluginFile)) {
          fs.unlinkSync(pluginFile);
        }
      }
      console.log('  Plugin "' + name + '" removed.');
      break;
    }
    case 'enable': {
      const name = process.argv[4];
      if (!name) { console.error('  Usage: npx let-them-talk plugin enable <name>'); process.exit(1); }
      const reg = getRegistry();
      const plugin = reg.find(p => p.name === name);
      if (!plugin) { console.error('  Plugin not found: ' + name); process.exit(1); }
      plugin.enabled = true;
      saveRegistry(reg);
      console.log('  Plugin "' + name + '" enabled.');
      break;
    }
    case 'disable': {
      const name = process.argv[4];
      if (!name) { console.error('  Usage: npx let-them-talk plugin disable <name>'); process.exit(1); }
      const reg = getRegistry();
      const plugin = reg.find(p => p.name === name);
      if (!plugin) { console.error('  Plugin not found: ' + name); process.exit(1); }
      plugin.enabled = false;
      saveRegistry(reg);
      console.log('  Plugin "' + name + '" disabled.');
      break;
    }
    default:
      console.error('  Unknown plugin command: ' + (subCmd || ''));
      console.error('  Available: list, add, remove, enable, disable');
      process.exit(1);
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
    pluginCmd();
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
