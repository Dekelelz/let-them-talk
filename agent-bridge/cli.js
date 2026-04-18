#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { resolveDataDir: resolveSharedDataDir } = require('./data-dir');
const { createCanonicalState } = require('./state/canonical');

function printUsage() {
  console.log(`
  Let Them Talk — Agent Bridge v5.5.1
  MCP message broker for inter-agent communication
  Supports: Claude Code, Gemini CLI, Codex CLI, Ollama

  Setup (one-time):
    npx let-them-talk init              Auto-detect CLI and configure MCP
    npx let-them-talk init --claude     Configure for Claude Code
    npx let-them-talk init --gemini     Configure for Gemini CLI
    npx let-them-talk init --codex      Configure for Codex CLI
    npx let-them-talk init --all        Configure for all supported CLIs
    npx let-them-talk init --ollama      Setup Ollama agent bridge (local LLM)
    npx let-them-talk init --template <name>  Initialize and print an agent template

  After init, use the local launcher (no re-download):
    node .agent-bridge/launch.js              Dashboard (http://localhost:3000)
    node .agent-bridge/launch.js --lan        Dashboard on LAN (phone/tablet)
    node .agent-bridge/launch.js status       Show active agents and message count
    node .agent-bridge/launch.js msg <agent> <text>  Send a message to an agent
    node .agent-bridge/launch.js reset        Clear all conversation data
    node .agent-bridge/launch.js migrate      Backfill canonical event stream from legacy projections
    node .agent-bridge/launch.js migrate --dry-run    Preview what migrate would do

  Or via npx (re-downloads each time):
    npx let-them-talk dashboard
    npx let-them-talk status
    npx let-them-talk templates         List available agent templates
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
  return resolveSharedDataDir({ cwd });
}

// Configure for Claude Code (.mcp.json in project root)
function setupClaude(serverPath, cwd, log = console.log) {
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
      log('  [warn] Existing .mcp.json was invalid — backed up to .mcp.json.backup');
    }
  }

  mcpConfig.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
    timeout: 300,
  };

  fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig, null, 2) + '\n');
  log('  [ok] Claude Code: .mcp.json updated');
}

// Configure for Gemini CLI (.gemini/settings.json or GEMINI.md with MCP config)
function setupGemini(serverPath, cwd, log = console.log) {
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
      log('  [warn] Existing settings.json was invalid — backed up to settings.json.backup');
    }
  }

  settings.mcpServers['agent-bridge'] = {
    command: 'node',
    args: [serverPath],
    timeout: 300,
    trust: true,
  };

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
  log('  [ok] Gemini CLI: .gemini/settings.json updated');
}

// Configure for Codex CLI (uses .codex/config.toml)
function setupCodex(serverPath, cwd, log = console.log) {
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

  log('  [ok] Codex CLI: .codex/config.toml updated');
}

// Setup Ollama agent bridge script
function setupOllama(serverPath, cwd, log = console.log) {
  const dir = dataDir(cwd);
  const scriptPath = path.join(dir, 'ollama-agent.js');

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
  log('  [ok] Ollama agent script created: .agent-bridge/ollama-agent.js');
  log('');
  log('  Launch an Ollama agent with:');
  log('    node .agent-bridge/ollama-agent.js <name> <model>');
  log('');
  log('  Examples:');
  log('    node .agent-bridge/ollama-agent.js Ollama llama3');
  log('    node .agent-bridge/ollama-agent.js Coder codellama');
  log('    node .agent-bridge/ollama-agent.js Writer mistral');
}

// Merge-safe AGENTS.md / CLAUDE.md updater. Writes a marker block with the
// background-worker rules so any agent cd'd into this folder gets them every
// session. Re-running replaces only the marked block, leaving user content alone.
function setupAgentsMarkdown(cwd, log = console.log) {
  const BEGIN = '<!-- BEGIN let-them-talk (auto-managed — do not edit between markers) -->';
  const END = '<!-- END let-them-talk -->';
  const block = [
    BEGIN,
    '',
    '## Let Them Talk — Background-Worker Mode',
    '',
    'This project uses the `agent-bridge` MCP server for multi-agent coordination.',
    'When you run in this folder, you are a **background worker on a team**, not an',
    'interactive chat assistant. Follow these rules strictly:',
    '',
    '1. **Your CLI terminal output is invisible** to the owner and to every other',
    '   agent. If you want anyone to see something, it MUST go through',
    '   `send_message(to="...", content="...")` or `broadcast(content="...")`.',
    '',
    '2. **No narration in terminal.** Do not "reply" to messages in your terminal',
    '   window. Do not summarize your progress in terminal. Do not print status',
    '   updates in terminal. Those are invisible. Talk like a human on a team chat',
    '   — announce starts, finishes, blockers, and questions via `send_message`.',
    '',
    '3. **Stay in the listen loop.** After every action, call `listen_group()` (or',
    '   `listen()` in direct mode). When it returns an empty batch, that is NORMAL',
    '   — call it again immediately. If it returns a tool error like',
    '   `"timed out awaiting tools/call"`, that is a Codex-level transport hiccup',
    '   — immediately call it again. Never stop looping, never treat an empty',
    '   return or tool error as "done".',
    '',
    '4. **Reply to Dashboard/Owner via `send_message(to="Dashboard")`.** The owner',
    '   reads replies in the dashboard Messages tab, not your terminal.',
    '',
    '5. **Do not answer on another agent\'s behalf.** If a message targets a',
    '   specific agent (`msg.to`), only that agent should reply.',
    '',
    '6. **Self-reliance.** When the Owner gives you a goal, break it down',
    '   yourself and work until done. NEVER stop to ask "should I do X?" or',
    '   "do you want me to Y?" for decisions the team can make. Decide,',
    '   `log_decision()` to record the choice, continue.',
    '',
    '7. **Team-first escalation.** Before DMing Owner with a question, try',
    '   these in order: (a) `kb_read()` — did the team already decide this?',
    '   (b) DM a teammate with the relevant skill (use `list_agents()`).',
    '   (c) `call_vote()` if the team genuinely disagrees. (d) `log_decision()`',
    '   to lock in your choice and move forward. Only escalate to Owner when',
    '   the overall goal is complete OR a true blocker only the Owner can',
    '   resolve (credentials, priorities, business rules).',
    '',
    '8. **Done-when-done.** "Done" means the Owner\'s original GOAL is',
    '   achieved, not the current step. After `verify_and_advance()`, call',
    '   `get_work()` again. If nothing is queued and the goal is not yet',
    '   done, synthesize new tasks with `create_task()` and keep going.',
    '',
    '9. **Write like you are publishing.** The Messages tab renders',
    '   GFM markdown with tables, fenced code + syntax highlighting,',
    '   Obsidian-style callouts, Mermaid diagrams, KaTeX math, and',
    '   clickable images. Use tables for structured data, callouts for',
    '   status (`> [!SUCCESS]`, `> [!WARNING]`, `> [!DANGER]`,',
    '   `> [!SUMMARY]-` for collapsible long reports), ```mermaid for',
    '   architecture/flow diagrams, and fenced code with language tags.',
    '   A terse structured report beats a wall of text.',
    '',
    '10. The loop only ends when the goal is achieved with evidence OR the',
    '    Owner sends a message telling you to stop.',
    '',
    END,
  ].join('\n');

  const targets = [
    { file: 'AGENTS.md', label: 'Codex / oh-my-codex' },
    { file: 'CLAUDE.md', label: 'Claude Code' },
  ];

  for (const { file, label } of targets) {
    const fp = path.join(cwd, file);
    let existing = '';
    let existed = false;
    if (fs.existsSync(fp)) {
      existing = fs.readFileSync(fp, 'utf8');
      existed = true;
    }

    const markerRegex = new RegExp(
      BEGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
        '[\\s\\S]*?' +
        END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      'g'
    );

    let next;
    if (markerRegex.test(existing)) {
      // Replace only the managed block
      next = existing.replace(markerRegex, block);
      log('  [ok] ' + file + ': refreshed Let Them Talk block (' + label + ')');
    } else if (existed) {
      // Append below user content
      const separator = existing.endsWith('\n') ? '\n' : '\n\n';
      next = existing + separator + block + '\n';
      log('  [ok] ' + file + ': appended Let Them Talk block (' + label + ')');
    } else {
      // New file — minimal content so only our block is present
      next = '# ' + path.basename(cwd) + ' — Agent Instructions\n\n' + block + '\n';
      log('  [ok] ' + file + ': created with Let Them Talk block (' + label + ')');
    }
    fs.writeFileSync(fp, next);
  }
}

function init(options) {
  const opts = options || {};
  const cwd = opts.cwd || process.cwd();
  const serverPath = path.join(__dirname, 'server.js').replace(/\\/g, '/');
  const gitignorePath = path.join(cwd, '.gitignore');
  const argv = Array.isArray(opts.argv) ? opts.argv : process.argv;
  const flag = opts.flag !== undefined ? opts.flag : argv[3];
  const log = typeof opts.log === 'function' ? opts.log : console.log;

  log('');
  log('  Let Them Talk — Initializing Agent Bridge');
  log('  ==========================================');
  log('');

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
      log('  Ollama not found. Install it from: https://ollama.com/download');
      log('  After installing, run: ollama pull llama3');
      log('');
    } else {
      log('  Ollama detected: ' + ollama.version);
      setupOllama(serverPath, cwd, log);
    }
    targets = detectCLIs();
    if (targets.length === 0) targets = ['claude'];
  } else {
    // Auto-detect
    targets = detectCLIs();
    if (targets.length === 0) {
      // Default to claude if nothing detected
      targets = ['claude'];
      log('  No CLI detected, defaulting to Claude Code config.');
    } else {
      log(`  Detected CLI(s): ${targets.join(', ')}`);
    }
  }

  log('');

  for (const target of targets) {
    switch (target) {
      case 'claude': setupClaude(serverPath, cwd, log); break;
      case 'gemini': setupGemini(serverPath, cwd, log); break;
      case 'codex':  setupCodex(serverPath, cwd, log);  break;
    }
  }

  // Persistent system-level directive for any agent that starts in this folder.
  // Codex (via oh-my-codex's developer_instructions) and Claude Code both read
  // AGENTS.md / CLAUDE.md automatically on startup. A marker block lets us merge
  // in/out cleanly without clobbering whatever else the user has written.
  setupAgentsMarkdown(cwd, log);

  // Add .agent-bridge/ and MCP config files to .gitignore
  const gitignoreEntries = ['.agent-bridge/', '.mcp.json', '.codex/', '.gemini/'];
  if (fs.existsSync(gitignorePath)) {
    let content = fs.readFileSync(gitignorePath, 'utf8');
    const missing = gitignoreEntries.filter(e => !content.includes(e));
    if (missing.length) {
      content += '\n# Agent Bridge (auto-added by let-them-talk init)\n' + missing.join('\n') + '\n';
      fs.writeFileSync(gitignorePath, content);
      log('  [ok] Added to .gitignore: ' + missing.join(', '));
    } else {
      log('  [ok] .gitignore already configured');
    }
  } else {
    fs.writeFileSync(gitignorePath, '# Agent Bridge (auto-added by let-them-talk init)\n' + gitignoreEntries.join('\n') + '\n');
    log('  [ok] .gitignore created');
  }

  // Save local launcher scripts so users never need to re-download
  const bridgeDir = dataDir(cwd);
  if (!fs.existsSync(bridgeDir)) {
    fs.mkdirSync(bridgeDir, { recursive: true });
  }

  const cliPath = path.join(__dirname, 'cli.js').replace(/\\/g, '/');

  // Dashboard launcher - run with: node .agent-bridge/launch.js
  const launcherScript = `#!/usr/bin/env node
// Auto-generated by let-them-talk init - launch dashboard without re-downloading
// Usage: node .agent-bridge/launch.js [--lan|dashboard|status|reset|msg]

const firstArg = process.argv[2] || 'dashboard';
const cliPath = ${JSON.stringify(cliPath)};

try {
  require('fs').accessSync(cliPath);
} catch {
  console.error('  Let Them Talk CLI not found at: ' + cliPath);
  console.error('  The npx cache may have been cleaned. Fix with either:');
  console.error('    npx let-them-talk init          (re-creates launcher)');
  console.error('    npm i -g let-them-talk          (permanent global install)');
  process.exit(1);
}

// Forward to cli.js with the command
const forwardedArgs = firstArg === '--lan'
  ? ['dashboard', '--lan', ...process.argv.slice(3)]
  : [firstArg, ...process.argv.slice(3)];
process.argv = [process.argv[0], cliPath, ...forwardedArgs];
require(cliPath);
`;

  fs.writeFileSync(path.join(bridgeDir, 'launch.js'), launcherScript);
  const launcherPath = path.join(bridgeDir, 'launch.js');
  log('  [ok] Local launcher saved to .agent-bridge/launch.js');

  log('');
  log('  Agent Bridge is ready! Restart your CLI to pick up the MCP tools.');
  log('');

  // Show template if --template was provided
  var templateFlag = null;
  for (var i = 3; i < argv.length; i++) {
    if (argv[i] === '--template' && argv[i + 1]) {
      templateFlag = argv[i + 1];
      break;
    }
  }

  if (templateFlag) {
    showTemplate(templateFlag);
  } else {
    log('  Open two terminals and start a conversation between agents.');
    log('  Tip: Use "npx let-them-talk init --template pair" for ready-made prompts.');
    log('');
    log('  \x1b[1m  Monitor:\x1b[0m');
    log('    node .agent-bridge/launch.js              (dashboard)');
    log('    node .agent-bridge/launch.js status       (agent status)');
    log('    node .agent-bridge/launch.js reset        (clear data)');
    log('');
    log('  Or use npx (re-downloads each time):');
    log('    npx let-them-talk dashboard');
    log('');
  }

  return {
    cwd,
    flag: flag || null,
    targets,
    bridgeDir,
    launcherPath,
  };
}

function reset() {
  const targetDir = resolveDataDirCli();

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
    const archiveResult = getCanonicalStateCli().archiveFiles({
      fileNames: ['history.jsonl', 'messages.jsonl', 'agents.json', 'decisions.json', 'tasks.json'],
      destinationDir: archivePath,
    });
    if (archiveResult.archived > 0) {
      console.log('  [ok] Archived ' + archiveResult.archived + ' files to .agent-bridge-archive/' + timestamp + '/');
    }
  } catch (e) {
    console.log('  [warn] Could not archive: ' + e.message + ' — proceeding with reset anyway.');
  }

  getCanonicalStateCli().resetRuntime({
    fixedFileNames: [
      'messages.jsonl',
      'history.jsonl',
      'agents.json',
      'acks.json',
      'tasks.json',
      'profiles.json',
      'workflows.json',
      'branches.json',
      'read_receipts.json',
      'permissions.json',
      'config.json',
      'decisions.json',
    ],
  });
  console.log('  Cleared all data from ' + targetDir);
}

function getTemplates() {
  var all = [];

  // 1. Built-in templates (shipped with the package)
  var builtinDir = path.join(__dirname, 'templates');
  if (fs.existsSync(builtinDir)) {
    fs.readdirSync(builtinDir).filter(f => f.endsWith('.json')).forEach(f => {
      try { var t = JSON.parse(fs.readFileSync(path.join(builtinDir, f), 'utf8')); t._source = 'built-in'; all.push(t); }
      catch {}
    });
  }

  // 2. Project-local templates: .agent-bridge/templates/ in current working directory
  var localDir = path.join(resolveDataDirCli(), 'templates');
  if (fs.existsSync(localDir)) {
    fs.readdirSync(localDir).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        var t = JSON.parse(fs.readFileSync(path.join(localDir, f), 'utf8'));
        t._source = 'local';
        // Don't add duplicates (local overrides built-in with same name)
        var existing = all.findIndex(e => e.name === t.name);
        if (existing >= 0) all[existing] = t;
        else all.push(t);
      } catch {}
    });
  }

  // 3. User-global templates: ~/.let-them-talk/templates/
  var homeDir = process.env.HOME || process.env.USERPROFILE || '';
  var globalDir = path.join(homeDir, '.let-them-talk', 'templates');
  if (fs.existsSync(globalDir)) {
    fs.readdirSync(globalDir).filter(f => f.endsWith('.json')).forEach(f => {
      try {
        var t = JSON.parse(fs.readFileSync(path.join(globalDir, f), 'utf8'));
        t._source = 'global';
        var existing = all.findIndex(e => e.name === t.name);
        if (existing >= 0) all[existing] = t;
        else all.push(t);
      } catch {}
    });
  }

  return all;
}

function listTemplates() {
  const templates = getTemplates();
  console.log('');
  console.log('  Available Agent Templates');
  console.log('  ========================');
  console.log('');
  for (const t of templates) {
    const agentNames = t.agents.map(a => a.name).join(', ');
    const sourceTag = t._source === 'local' ? ' [local]' : t._source === 'global' ? ' [global]' : '';
    console.log('  ' + t.name.padEnd(12) + ' ' + t.description + sourceTag);
    console.log('  ' + ''.padEnd(12) + ' Agents: ' + agentNames);
    console.log('');
  }
  console.log('  Usage: npx let-them-talk init --template <name>');
  console.log('  Note: this command lists agent templates only. Conversation workflow templates ship separately in agent-bridge/conversation-templates/*.json.');
  console.log('');
  console.log('  Custom templates:');
  console.log('    Project-local:  .agent-bridge/templates/*.json');
  console.log('    User-global:    ~/.let-them-talk/templates/*.json');
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
  console.log('  Copy these agent prompts into each terminal:');
  console.log('  ======================================');
  console.log('  These prompts assume current onboarding: register, get_briefing(), then get_guide() when you need the current rules.');

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
  return resolveSharedDataDir();
}

function getCanonicalStateCli() {
  return createCanonicalState({ dataDir: resolveDataDirCli(), processPid: process.pid });
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

  getCanonicalStateCli().appendMessage(msg);

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

function cliMigrate() {
  const args = process.argv.slice(3);
  const dryRun = args.includes('--dry-run') || args.includes('-n');
  const positional = args.filter((a) => !a.startsWith('-'));
  const projectArg = positional[0] || process.cwd();
  const { migrate } = require('./scripts/migrate-legacy-to-canonical');
  migrate(projectArg, { dryRun });
}

// v5.0: Diagnostic health check
function cliDoctor() {
  console.log('');
  console.log('  \x1b[1mLet Them Talk — Doctor\x1b[0m');
  console.log('  ======================');
  let issues = 0;

  // Check data directory
  const dir = resolveDataDirCli();
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

function runCli() {
  const command = process.argv[2];

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
    case 'migrate':
    case 'migrate-legacy':
      cliMigrate();
      break;
    case 'msg':
    case 'message':
    case 'send':
      cliMsg();
      break;
    case 'status':
      cliStatus();
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
}

function shouldAutoRunCli() {
  if (require.main === module) return true;
  const argvPath = process.argv[1];
  if (!argvPath) return false;
  const normalizedArgvPath = path.resolve(argvPath).replace(/\\/g, '/');
  const normalizedFilePath = path.resolve(__filename).replace(/\\/g, '/');
  return process.platform === 'win32'
    ? normalizedArgvPath.toLowerCase() === normalizedFilePath.toLowerCase()
    : normalizedArgvPath === normalizedFilePath;
}

module.exports = {
  init,
  runCli,
};

if (shouldAutoRunCli()) {
  runCli();
}
