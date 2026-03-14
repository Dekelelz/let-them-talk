#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');

const command = process.argv[2];

function printUsage() {
  console.log(`
  Let Them Talk — Agent Bridge v2.5.0
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
    npx let-them-talk reset             Clear all conversation data
    npx let-them-talk help              Show this help message
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

// Configure for Codex CLI (codex uses .mcp.json same as Claude)
function setupCodex(serverPath, cwd) {
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
  console.log('  [ok] Codex CLI: .mcp.json updated');
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
  const files = fs.readdirSync(targetDir);
  let count = 0;
  for (const f of files) {
    fs.unlinkSync(path.join(targetDir, f));
    count++;
  }
  console.log(`  Cleared ${count} file(s) from ${targetDir}`);
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
  require('./dashboard.js');
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
