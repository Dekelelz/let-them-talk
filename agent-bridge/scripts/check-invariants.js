#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const AGENT_BRIDGE_ROOT = path.resolve(__dirname, '..');
const USAGE = 'Usage: node agent-bridge/scripts/check-invariants.js --suite authority [--simulate-legacy-write]';

const FILES = {
  io: {
    path: path.join(AGENT_BRIDGE_ROOT, 'state', 'io.js'),
    display: 'agent-bridge/state/io.js',
  },
  messages: {
    path: path.join(AGENT_BRIDGE_ROOT, 'state', 'messages.js'),
    display: 'agent-bridge/state/messages.js',
  },
  agents: {
    path: path.join(AGENT_BRIDGE_ROOT, 'state', 'agents.js'),
    display: 'agent-bridge/state/agents.js',
  },
  tasksWorkflows: {
    path: path.join(AGENT_BRIDGE_ROOT, 'state', 'tasks-workflows.js'),
    display: 'agent-bridge/state/tasks-workflows.js',
  },
  server: {
    path: path.join(AGENT_BRIDGE_ROOT, 'server.js'),
    display: 'agent-bridge/server.js',
  },
  canonical: {
    path: path.join(AGENT_BRIDGE_ROOT, 'state', 'canonical.js'),
    display: 'agent-bridge/state/canonical.js',
  },
  dashboard: {
    path: path.join(AGENT_BRIDGE_ROOT, 'dashboard.js'),
    display: 'agent-bridge/dashboard.js',
  },
  cli: {
    path: path.join(AGENT_BRIDGE_ROOT, 'cli.js'),
    display: 'agent-bridge/cli.js',
  },
  apiAgents: {
    path: path.join(AGENT_BRIDGE_ROOT, 'api-agents.js'),
    display: 'agent-bridge/api-agents.js',
  },
  runtimeContract: {
    path: path.join(REPO_ROOT, 'docs', 'architecture', 'runtime-contract.md'),
    display: 'docs/architecture/runtime-contract.md',
  },
};

function fail(message, exitCode) {
  console.error(message);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let suite = null;
  let simulateLegacyWrite = false;

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--suite') {
      if (suite || index + 1 >= argv.length) fail(USAGE, 2);
      suite = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === '--simulate-legacy-write') {
      simulateLegacyWrite = true;
      continue;
    }

    fail(USAGE, 2);
  }

  if (suite !== 'authority') {
    if (!suite) fail(USAGE, 2);
    fail([`Unknown suite: ${suite}`, 'Supported suites: authority', USAGE].join('\n'), 2);
  }

  return { suite, simulateLegacyWrite };
}

function readFile(spec) {
  if (!fs.existsSync(spec.path)) {
    fail(`Authority invariant check failed.\nMissing file: ${spec.display}`, 1);
  }

  return fs.readFileSync(spec.path, 'utf8');
}

function extractBlock(source, fileDisplayPath, label, startAnchor, endAnchor) {
  const startIndex = source.indexOf(startAnchor);
  if (startIndex === -1) {
    return {
      text: '',
      problems: [`${fileDisplayPath} is missing the expected start anchor for ${label}: ${startAnchor}`],
    };
  }

  let endIndex = source.length;
  if (endAnchor) {
    endIndex = source.indexOf(endAnchor, startIndex + startAnchor.length);
    if (endIndex === -1) {
      return {
        text: '',
        problems: [`${fileDisplayPath} is missing the expected end anchor for ${label}: ${endAnchor}`],
      };
    }
  }

  return {
    text: source.slice(startIndex, endIndex),
    problems: [],
  };
}

function normalizeSnippet(snippet) {
  return snippet.replace(/\s+/g, ' ').trim().slice(0, 180);
}

function requireSnippet(problems, source, message, snippet) {
  if (!source.includes(snippet)) {
    problems.push(`${message} Missing snippet: ${snippet}`);
  }
}

function forbidPattern(problems, source, message, pattern) {
  const match = source.match(pattern);
  if (match) {
    problems.push(`${message} Matched: ${normalizeSnippet(match[0])}`);
  }
}

function addBlockProblems(problems, block) {
  if (block && Array.isArray(block.problems) && block.problems.length > 0) {
    problems.push(...block.problems);
  }
}

function buildContext(simulateLegacyWrite) {
  const sources = {
    io: readFile(FILES.io),
    messages: readFile(FILES.messages),
    agents: readFile(FILES.agents),
    tasksWorkflows: readFile(FILES.tasksWorkflows),
    server: readFile(FILES.server),
    canonical: readFile(FILES.canonical),
    dashboard: readFile(FILES.dashboard),
    cli: readFile(FILES.cli),
    apiAgents: readFile(FILES.apiAgents),
    runtimeContract: readFile(FILES.runtimeContract),
  };

  const blocks = {
    cliMsg: extractBlock(
      sources.cli,
      FILES.cli.display,
      'cli message send path',
      'function cliMsg() {',
      'function cliStatus() {'
    ),
    dashboardInject: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard inject path',
      'function apiInjectMessage(body, query) {',
      '// Multi-project management'
    ),
    dashboardAgents: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard agents query path',
      'function apiAgents(query) {',
      'function apiStatus(query) {'
    ),
    dashboardTasksGet: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard tasks query path',
      'function apiTasks(query) {',
      'function apiSearch(query) {'
    ),
    dashboardDecisionsRoute: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard decisions route',
      "else if (url.pathname === '/api/decisions' && req.method === 'GET') {",
      "else if (url.pathname === '/api/agents' && req.method === 'DELETE') {"
    ),
    dashboardUpdateTask: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard task mutation path',
      'function apiUpdateTask(body, query) {',
      '// Rules API'
    ),
    dashboardRulesApi: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard rules api helpers',
      'function apiRules(query) {',
      '// Auto-discover .agent-bridge directories nearby'
    ),
    dashboardEditMessage: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard message edit path',
      'async function apiEditMessage(body, query) {',
      '// --- v3.4: Message Delete ---'
    ),
    dashboardDeleteMessage: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard message delete path',
      'async function apiDeleteMessage(body, query) {',
      '// --- v3.4: Conversation Templates ---'
    ),
    dashboardWorkflowsPost: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard workflow mutation route',
      "else if (url.pathname === '/api/workflows' && req.method === 'POST') {",
      '// ========== Plan Control API (v5.0 Autonomy Engine) =========='
    ),
    dashboardPlanPause: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan pause route',
      "else if (url.pathname === '/api/plan/pause' && req.method === 'POST') {",
      "else if (url.pathname === '/api/plan/resume' && req.method === 'POST') {"
    ),
    dashboardPlanResume: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan resume route',
      "else if (url.pathname === '/api/plan/resume' && req.method === 'POST') {",
      "else if (url.pathname === '/api/plan/stop' && req.method === 'POST') {"
    ),
    dashboardPlanStop: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan stop route',
      "else if (url.pathname === '/api/plan/stop' && req.method === 'POST') {",
      "else if (url.pathname.startsWith('/api/plan/skip/') && req.method === 'POST') {"
    ),
    dashboardPlanSkip: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan step skip route',
      "else if (url.pathname.startsWith('/api/plan/skip/') && req.method === 'POST') {",
      "else if (url.pathname.startsWith('/api/plan/reassign/') && req.method === 'POST') {"
    ),
    dashboardPlanReassign: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan step reassign route',
      "else if (url.pathname.startsWith('/api/plan/reassign/') && req.method === 'POST') {",
      "else if (url.pathname === '/api/plan/inject' && req.method === 'POST') {"
    ),
    dashboardRulesRoutes: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard rules runtime routes',
      '// ========== Rules API ==========',
      '// ========== End Rules API =========='
    ),
    dashboardExportJson: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard export-json route',
      "else if (url.pathname === '/api/export-json' && req.method === 'GET') {",
      "else if (url.pathname === '/api/export' && req.method === 'GET') {"
    ),
    dashboardPlanSkillsRoute: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard plan skills route',
      "else if (url.pathname === '/api/plan/skills' && req.method === 'GET') {",
      "else if (url.pathname === '/api/plan/retries' && req.method === 'GET') {"
    ),
    dashboardProfilesGet: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard profiles GET route',
      "else if (url.pathname === '/api/profiles' && req.method === 'GET') {",
      "else if (url.pathname === '/api/profiles' && req.method === 'POST') {"
    ),
    dashboardProfilesPost: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard profiles POST route',
      "else if (url.pathname === '/api/profiles' && req.method === 'POST') {",
      "else if (url.pathname === '/api/workspaces' && req.method === 'GET') {"
    ),
    dashboardWorkflowsGet: extractBlock(
      sources.dashboard,
      FILES.dashboard.display,
      'dashboard workflows GET route',
      "else if (url.pathname === '/api/workflows' && req.method === 'GET') {",
      "else if (url.pathname === '/api/workflows' && req.method === 'POST') {"
    ),
    apiAgentsConstructor: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent canonical state setup',
      '  constructor(dataDir) {',
      '  _loadConfigs() {'
    ),
    apiRegister: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent register path',
      '  _registerInAgentsJson(name, provider) {',
      '  // Remove API agent from agents.json'
    ),
    apiUnregister: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent unregister path',
      '  _unregisterFromAgentsJson(name) {',
      '  // Delete an API agent'
    ),
    apiSendMessage: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent send message path',
      '  _sendMessage(from, to, content, replyTo) {',
      '  // Update heartbeat in agents.json'
    ),
    apiHeartbeat: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent heartbeat path',
      '  _updateHeartbeat(name) {',
      '  _updateAgentStatus(name, status) {'
    ),
    apiStatusUpdate: extractBlock(
      sources.apiAgents,
      FILES.apiAgents.display,
      'api-agent status path',
      '  _updateAgentStatus(name, status) {',
      '  _getMessageCount() {'
    ),
    workspaceSaveHelper: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'server workspace save helper',
      'function saveWorkspace(agentName, data, options = {}) {',
      '// --- Workflow helpers ---'
    ),
    toolLogDecision: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'decision logging tool',
      'function toolLogDecision(decision, reasoning, topic) {',
      'function toolGetDecisions(topic) {'
    ),
    toolKBWrite: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'knowledge base write tool',
      'function toolKBWrite(key, content) {',
      'function toolKBRead(key) {'
    ),
    toolUpdateProgress: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'progress update tool',
      'function toolUpdateProgress(feature, percent, notes) {',
      'function toolGetProgress() {'
    ),
    toolCallVote: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'vote creation tool',
      'function toolCallVote(question, options) {',
      'function toolCastVote(voteId, choice) {'
    ),
    toolCastVote: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'vote cast tool',
      'function toolCastVote(voteId, choice) {',
      'function toolVoteStatus(voteId) {'
    ),
    toolAddRule: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'rule add tool',
      'function toolAddRule(text, category = \'custom\') {',
      'function toolListRules() {'
    ),
    toolRemoveRule: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'rule remove tool',
      'function toolRemoveRule(ruleId) {',
      'function toolToggleRule(ruleId) {'
    ),
    toolToggleRule: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'rule toggle tool',
      'function toolToggleRule(ruleId) {',
      '// --- MCP Server setup ---'
    ),
    toolRequestReview: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'review request tool',
      'function toolRequestReview(filePath, description) {',
      'function toolSubmitReview(reviewId, status, feedback) {'
    ),
    toolSubmitReview: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'review submit tool',
      'function toolSubmitReview(reviewId, status, feedback) {',
      'function toolDeclareDependency(taskId, dependsOnTaskId) {'
    ),
    toolDeclareDependency: extractBlock(
      sources.server,
      'agent-bridge/server.js',
      'dependency declare tool',
      'function toolDeclareDependency(taskId, dependsOnTaskId) {',
      'function toolCheckDependencies(taskId) {'
    ),
  };

  if (simulateLegacyWrite) {
    blocks.cliMsg.text += [
      '',
      "fs.appendFileSync(path.join(resolveDataDirCli(), 'messages.jsonl'), JSON.stringify(msg) + '\\n');",
      "fs.appendFileSync(path.join(resolveDataDirCli(), 'history.jsonl'), JSON.stringify(msg) + '\\n');",
    ].join('\n');

    blocks.dashboardInject.text += [
      '',
      "fs.appendFileSync(path.join(resolveDataDir(projectPath), 'messages.jsonl'), JSON.stringify(msg) + '\\n');",
      "fs.appendFileSync(path.join(resolveDataDir(projectPath), 'history.jsonl'), JSON.stringify(msg) + '\\n');",
    ].join('\n');

    blocks.dashboardAgents.text += [
      '',
      "const agents = readJson(filePath('agents.json', projectPath));",
      "const profiles = readJson(filePath('profiles.json', projectPath));",
    ].join('\n');

    blocks.dashboardTasksGet.text += [
      '',
      "const tasks = readJson(filePath('tasks.json', projectPath));",
    ].join('\n');

    blocks.dashboardDeleteMessage.text += [
      '',
      "fs.writeFileSync(path.join(resolveDataDir(projectPath), 'messages.jsonl'), rewrittenMessages.join('\\n') + '\\n');",
      "fs.writeFileSync(path.join(resolveDataDir(projectPath), 'history.jsonl'), rewrittenHistory.join('\\n') + '\\n');",
    ].join('\n');

    blocks.dashboardUpdateTask.text += [
      '',
      "fs.writeFileSync(filePath('tasks.json', projectPath), JSON.stringify(tasks, null, 2));",
    ].join('\n');

    blocks.dashboardPlanPause.text += [
      '',
      "fs.writeFileSync(filePath('workflows.json', projectPath), JSON.stringify(workflows, null, 2));",
    ].join('\n');

    blocks.dashboardExportJson.text += [
      '',
      "const tasksRaw = readJson(filePath('tasks.json', projectPath));",
    ].join('\n');

    blocks.dashboardProfilesGet.text += [
      '',
      "res.end(JSON.stringify(readJson(filePath('profiles.json', projectPath))));",
    ].join('\n');

    blocks.dashboardProfilesPost.text += [
      '',
      "const profilesFile = filePath('profiles.json', projectPath);",
      "const profiles = readJson(profilesFile);",
      "fs.writeFileSync(profilesFile, JSON.stringify(profiles, null, 2));",
    ].join('\n');

    blocks.dashboardWorkflowsGet.text += [
      '',
      "const workflowData = readJson(filePath('workflows.json', projectPath), []);",
    ].join('\n');

    blocks.dashboardPlanSkip.text += [
      '',
      "const workflowData = readJson(filePath('workflows.json', projectPath), []);",
    ].join('\n');

    blocks.dashboardPlanReassign.text += [
      '',
      "const workflowData = readJson(filePath('workflows.json', projectPath), []);",
    ].join('\n');

    blocks.apiRegister.text += [
      '',
      "fs.writeFileSync(path.join(this.dataDir, 'agents.json'), JSON.stringify({ [name]: this.agents[name] }, null, 2));",
      "fs.writeFileSync(path.join(this.dataDir, 'profiles.json'), JSON.stringify({ [name]: { display_name: name } }, null, 2));",
    ].join('\n');

    blocks.apiHeartbeat.text += [
      '',
      "fs.writeFileSync(path.join(this.dataDir, 'heartbeat-' + name + '.json'), JSON.stringify({ last_activity: new Date().toISOString(), pid: process.pid }));",
    ].join('\n');

    blocks.dashboardRulesApi.text += [
      '',
      "fs.writeFileSync(rulesFile, JSON.stringify(rules, null, 2));",
    ].join('\n');

    blocks.dashboardRulesRoutes.text += [
      '',
      "fs.writeFileSync(rulesFile, JSON.stringify(rules));",
    ].join('\n');

    blocks.workspaceSaveHelper.text += [
      '',
      "fs.writeFileSync(path.join(WORKSPACES_DIR, `${sanitizeName(agentName)}.json`), JSON.stringify(data));",
    ].join('\n');

    blocks.toolLogDecision.text += [
      '',
      'writeJsonFile(DECISIONS_FILE, decisions);',
    ].join('\n');

    blocks.toolKBWrite.text += [
      '',
      'writeJsonFile(KB_FILE, kb);',
    ].join('\n');

    blocks.toolUpdateProgress.text += [
      '',
      'writeJsonFile(PROGRESS_FILE, progress);',
    ].join('\n');

    blocks.toolCallVote.text += [
      '',
      'writeJsonFile(VOTES_FILE, votes);',
    ].join('\n');

    blocks.toolCastVote.text += [
      '',
      'writeJsonFile(VOTES_FILE, votes);',
    ].join('\n');

    blocks.toolAddRule.text += [
      '',
      'writeJsonFile(RULES_FILE, rules);',
    ].join('\n');

    blocks.toolRemoveRule.text += [
      '',
      'writeJsonFile(RULES_FILE, rules);',
    ].join('\n');

    blocks.toolToggleRule.text += [
      '',
      'writeJsonFile(RULES_FILE, rules);',
    ].join('\n');
  }

  return { sources, blocks, simulateLegacyWrite };
}

function getAuthorityChecks() {
  const directMessageWrite = /fs\.(?:appendFileSync|writeFileSync)\(\s*(?:path\.join\([^)]*['"]messages\.jsonl['"]|messagesFile\b)/;
  const directHistoryWrite = /fs\.(?:appendFileSync|writeFileSync)\(\s*(?:path\.join\([^)]*['"]history\.jsonl['"]|historyFile\b)/;
  const directAgentsRead = /readJson\(\s*(?:filePath\(['"]agents\.json['"]|path\.join\([^)]*['"]agents\.json['"]|agentsFile\b)|JSON\.parse\(fs\.readFileSync\(\s*(?:filePath\(['"]agents\.json['"]|path\.join\([^)]*['"]agents\.json['"]|agentsFile\b)/;
  const directProfilesRead = /readJson\(\s*(?:filePath\(['"]profiles\.json['"]|path\.join\([^)]*['"]profiles\.json['"]|profilesFile\b)|JSON\.parse\(fs\.readFileSync\(\s*(?:filePath\(['"]profiles\.json['"]|path\.join\([^)]*['"]profiles\.json['"]|profilesFile\b)/;
  const directTasksRead = /readJson\(\s*(?:filePath\(['"]tasks\.json['"]|path\.join\([^)]*['"]tasks\.json['"]|tasksFile\b)|JSON\.parse\(fs\.readFileSync\(\s*(?:filePath\(['"]tasks\.json['"]|path\.join\([^)]*['"]tasks\.json['"]|tasksFile\b)/;
  const directWorkflowsRead = /readJson\(\s*(?:filePath\(['"]workflows\.json['"]|path\.join\([^)]*['"]workflows\.json['"]|workflowsFile\b|wfFile\b)|JSON\.parse\(fs\.readFileSync\(\s*(?:filePath\(['"]workflows\.json['"]|path\.join\([^)]*['"]workflows\.json['"]|workflowsFile\b|wfFile\b)/;
  const directAgentsWrite = /fs\.writeFileSync\(\s*(?:path\.join\([^)]*['"]agents\.json['"]|agentsFile\b)/;
  const directProfilesWrite = /fs\.writeFileSync\(\s*(?:path\.join\([^)]*['"]profiles\.json['"]|profilesFile\b)/;
  const directHeartbeatWrite = /fs\.writeFileSync\(\s*(?:path\.join\([^)]*heartbeat-|heartbeatFile\b)/;
  const directTasksWrite = /fs\.writeFileSync\(\s*(?:filePath\(['"]tasks\.json['"]|tasksFile\b)/;
  const directWorkflowsWrite = /fs\.writeFileSync\(\s*(?:filePath\(['"]workflows\.json['"]|workflowsFile\b)/;
  const directRulesWrite = /fs\.writeFileSync\(\s*(?:rulesFile\b|RULES_FILE\b|filePath\(['"]rules\.json['"])/;
  const directWorkspaceWrite = /fs\.writeFileSync\(\s*path\.join\(WORKSPACES_DIR/;
  const directGovernanceWrite = /writeJsonFile\((?:DECISIONS_FILE|KB_FILE|PROGRESS_FILE|VOTES_FILE|RULES_FILE|REVIEWS_FILE|DEPS_FILE)\b/;
  const directDecisionsRead = /readJson\(\s*filePath\(['"]decisions\.json['"]|JSON\.parse\(fs\.readFileSync\(\s*filePath\(['"]decisions\.json['"]/;
  const directKnowledgeRead = /readJson\(\s*filePath\(['"]kb\.json['"]|JSON\.parse\(fs\.readFileSync\(\s*filePath\(['"]kb\.json['"]/;

  return [
    {
      key: 'broker_surface',
      success: 'Broker-owned mutators still exist in the extracted state layer and canonical composition helper.',
      run(context) {
        const problems = [];
        requireSnippet(problems, context.sources.io, `${FILES.io.display} must expose appendJsonl().`, 'function appendJsonl(filePath, value) {');
        requireSnippet(problems, context.sources.io, `${FILES.io.display} must expose writeJson().`, 'function writeJson(filePath, data, options = {}) {');
        requireSnippet(problems, context.sources.io, `${FILES.io.display} must expose withLock().`, 'function withLock(filePath, fn) {');

        requireSnippet(problems, context.sources.messages, `${FILES.messages.display} must expose appendConversationMessage().`, 'function appendConversationMessage(message, targets) {');
        requireSnippet(problems, context.sources.messages, `${FILES.messages.display} must append to message projections via io.appendJsonl().`, 'io.appendJsonl(targets.messageFile, message);');
        requireSnippet(problems, context.sources.messages, `${FILES.messages.display} must append to history projections via io.appendJsonl().`, 'io.appendJsonl(targets.historyFile, message);');
        requireSnippet(problems, context.sources.messages, `${FILES.messages.display} must lock history rewrites through io.withLock().`, 'io.withLock(targets.historyFile, () => {');
        requireSnippet(problems, context.sources.messages, `${FILES.messages.display} must lock message rewrites through io.withLock().`, 'io.withLock(targets.messageFile, () => {');

        requireSnippet(problems, context.sources.agents, `${FILES.agents.display} must persist agents through io.writeJson().`, "io.writeJson(agentsFile, agents, { cacheKey: 'agents' });");
        requireSnippet(problems, context.sources.agents, `${FILES.agents.display} must persist profiles through io.writeJson().`, "io.writeJson(profilesFile, profiles, { cacheKey: 'profiles', space: 2 });");
        requireSnippet(problems, context.sources.agents, `${FILES.agents.display} must persist heartbeat overlays through io.writeJson().`, 'io.writeJson(heartbeatFile(name), {');
        requireSnippet(problems, context.sources.agents, `${FILES.agents.display} must guard agent mutations behind withAgentsLock().`, 'function withAgentsLock(fn) {');

        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must expose mutateTasks().`, 'function mutateTasks(mutator, writeOptions = {}) {');
        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must expose mutateWorkflows().`, 'function mutateWorkflows(mutator, writeOptions = {}) {');
        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must resolve branch-aware task files.`, 'function resolveTasksFile(branchName = \'main\') {');
        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must resolve branch-aware workflow files.`, 'function resolveWorkflowsFile(branchName = \'main\') {');
        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must persist tasks through io.writeJson().`, 'io.writeJson(filePath, tasks, {');
        requireSnippet(problems, context.sources.tasksWorkflows, `${FILES.tasksWorkflows.display} must persist workflows through io.writeJson().`, 'io.writeJson(filePath, workflows, {');

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must compose createMessagesState().`, "const { createMessagesState } = require('./messages');");
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must compose createAgentsState().`, "const { createAgentsState } = require('./agents');");
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must compose createTasksWorkflowsState().`, "const { createTasksWorkflowsState } = require('./tasks-workflows');");
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must build the message mutator.`, 'const messagesState = createMessagesState({ io });');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must build the agent mutator.`, 'const agentsState = createAgentsState({');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must build the task/workflow mutator.`, 'const tasksWorkflowsState = createTasksWorkflowsState({');

        return problems;
      },
    },
    {
      key: 'message_history_authority',
      success: 'Dashboard, CLI, and API-agent message/history mutations still route through the canonical broker path.',
      run(context) {
        const problems = [];
        addBlockProblems(problems, context.blocks.cliMsg);
        addBlockProblems(problems, context.blocks.dashboardInject);
        addBlockProblems(problems, context.blocks.dashboardEditMessage);
        addBlockProblems(problems, context.blocks.dashboardDeleteMessage);
        addBlockProblems(problems, context.blocks.apiSendMessage);

        requireSnippet(problems, context.sources.dashboard, `${FILES.dashboard.display} must import the canonical helper for message authority.`, "const { createCanonicalState } = require('./state/canonical');");
        requireSnippet(problems, context.sources.cli, `${FILES.cli.display} must import the canonical helper for CLI message authority.`, "const { createCanonicalState } = require('./state/canonical');");
        requireSnippet(problems, context.sources.apiAgents, `${FILES.apiAgents.display} must import the canonical helper for API-agent message authority.`, "const { createCanonicalState } = require('./state/canonical');");

        requireSnippet(problems, context.blocks.dashboardInject.text, `${FILES.dashboard.display} apiInjectMessage must use canonicalState.appendMessage(...).`, 'canonicalState.appendMessage(msg, { branch });');
        requireSnippet(problems, context.blocks.dashboardEditMessage.text, `${FILES.dashboard.display} apiEditMessage must use getCanonicalState(projectPath).editMessage(...).`, 'getCanonicalState(projectPath).editMessage({');
        requireSnippet(problems, context.blocks.dashboardDeleteMessage.text, `${FILES.dashboard.display} apiDeleteMessage must use getCanonicalState(projectPath).deleteMessage(...).`, 'getCanonicalState(projectPath).deleteMessage({');
        requireSnippet(problems, context.blocks.cliMsg.text, `${FILES.cli.display} cliMsg must use getCanonicalStateCli().appendMessage(msg).`, 'getCanonicalStateCli().appendMessage(msg);');
        requireSnippet(problems, context.blocks.apiSendMessage.text, `${FILES.apiAgents.display} _sendMessage must use this._canonicalState.appendMessage(msg).`, 'this._canonicalState.appendMessage(msg);');

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose appendMessage().`, 'function appendMessage(message, options = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} appendMessage() must delegate to messagesState.appendConversationMessage().`, 'return messagesState.appendConversationMessage(');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose editMessage().`, 'function editMessage(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} editMessage() must resolve the current message from canonical events.`, 'messagesState.getConversationMessageFromEvents(readCanonicalMessageEvents(branch), params.id)');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} editMessage() must append canonical correction events.`, 'appendCanonicalMessageCorrectedEvent({');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} editMessage() must rebuild projections from canonical events after correction.`, 'rebuildMessageProjections({ branch });');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose deleteMessage().`, 'function deleteMessage(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} deleteMessage() must resolve the current message from canonical events.`, 'messagesState.getConversationMessageFromEvents(readCanonicalMessageEvents(branch), params.id)');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} deleteMessage() must append canonical redaction events.`, 'appendCanonicalMessageRedactedEvent({');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} deleteMessage() must rebuild projections from canonical events after redaction.`, 'rebuildMessageProjections({ branch });');

        for (const target of [
          { label: `${FILES.cli.display} cliMsg`, text: context.blocks.cliMsg.text },
          { label: `${FILES.dashboard.display} apiInjectMessage`, text: context.blocks.dashboardInject.text },
          { label: `${FILES.dashboard.display} apiEditMessage`, text: context.blocks.dashboardEditMessage.text },
          { label: `${FILES.dashboard.display} apiDeleteMessage`, text: context.blocks.dashboardDeleteMessage.text },
          { label: `${FILES.apiAgents.display} _sendMessage`, text: context.blocks.apiSendMessage.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly append or rewrite messages.jsonl.`, directMessageWrite);
          forbidPattern(problems, target.text, `${target.label} must not directly append or rewrite history.jsonl.`, directHistoryWrite);
        }

        return problems;
      },
    },
    {
      key: 'dashboard_read_authority',
      success: 'Dashboard read-side task/workflow/profile/agent paths now route through canonical or shared query helpers instead of raw authority files.',
      run(context) {
        const problems = [];
        addBlockProblems(problems, context.blocks.dashboardAgents);
        addBlockProblems(problems, context.blocks.dashboardTasksGet);
        addBlockProblems(problems, context.blocks.dashboardExportJson);
        addBlockProblems(problems, context.blocks.dashboardProfilesGet);
        addBlockProblems(problems, context.blocks.dashboardProfilesPost);
        addBlockProblems(problems, context.blocks.dashboardWorkflowsGet);
        addBlockProblems(problems, context.blocks.dashboardPlanSkip);
        addBlockProblems(problems, context.blocks.dashboardPlanReassign);

        requireSnippet(problems, context.blocks.dashboardAgents.text, `${FILES.dashboard.display} apiAgents must fetch the canonical state helper once.`, 'const canonicalState = getCanonicalState(projectPath);');
        requireSnippet(problems, context.blocks.dashboardAgents.text, `${FILES.dashboard.display} apiAgents must read agents through canonicalState.listAgents().`, 'const agents = canonicalState.listAgents();');
        requireSnippet(problems, context.blocks.dashboardAgents.text, `${FILES.dashboard.display} apiAgents must read profiles through canonicalState.listProfiles().`, 'const profiles = canonicalState.listProfiles();');
        requireSnippet(problems, context.blocks.dashboardTasksGet.text, `${FILES.dashboard.display} apiTasks must validate and pass branch-aware task reads through getCanonicalState(projectPath).listTasks(...).`, 'return getCanonicalState(projectPath).listTasks({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardExportJson.text, `${FILES.dashboard.display} /api/export-json must fetch the canonical state helper once.`, 'const canonicalState = getCanonicalState(projectPath);');
        requireSnippet(problems, context.blocks.dashboardExportJson.text, `${FILES.dashboard.display} /api/export-json must read tasks through canonicalState.listTasks(...) with the requested branch.`, 'const tasks = canonicalState.listTasks({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardProfilesGet.text, `${FILES.dashboard.display} /api/profiles GET must read profiles through getCanonicalState(projectPath).listProfiles().`, 'res.end(JSON.stringify(getCanonicalState(projectPath).listProfiles()));');
        requireSnippet(problems, context.blocks.dashboardProfilesPost.text, `${FILES.dashboard.display} /api/profiles POST must still validate advisory contract metadata via sanitizeContractProfilePatch().`, 'const contractPatch = sanitizeContractProfilePatch({');
        requireSnippet(problems, context.blocks.dashboardProfilesPost.text, `${FILES.dashboard.display} /api/profiles POST must fetch the canonical state helper once.`, 'const canonicalState = getCanonicalState(projectPath);');
        requireSnippet(problems, context.blocks.dashboardProfilesPost.text, `${FILES.dashboard.display} /api/profiles POST must persist through canonicalState.upsertProfile(...).`, 'canonicalState.upsertProfile({');
        requireSnippet(problems, context.blocks.dashboardWorkflowsGet.text, `${FILES.dashboard.display} /api/workflows GET must read workflows through getCanonicalState(projectPath).listWorkflows(...) with the requested branch.`, 'res.end(JSON.stringify(getCanonicalState(projectPath).listWorkflows({ branch: branchResult.branch })));');
        requireSnippet(problems, context.blocks.dashboardPlanSkip.text, `${FILES.dashboard.display} /api/plan/skip/:id must derive workflow selection through canonicalState.listWorkflows(...) with the requested branch.`, 'const workflows = canonicalState.listWorkflows({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardPlanReassign.text, `${FILES.dashboard.display} /api/plan/reassign/:id must derive workflow selection through canonicalState.listWorkflows(...) with the requested branch.`, 'const workflows = canonicalState.listWorkflows({ branch: branchResult.branch });');

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listAgents().`, 'function listAgents() {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listProfiles().`, 'function listProfiles() {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose branch-aware listTasks().`, 'function listTasks(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose branch-aware listWorkflows().`, 'function listWorkflows(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose upsertProfile().`, 'function upsertProfile(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} upsertProfile() must persist via agentsState.updateProfile().`, 'const profile = agentsState.updateProfile(name, (currentProfile) => {');

        forbidPattern(problems, context.blocks.dashboardAgents.text, `${FILES.dashboard.display} apiAgents must not directly read agents.json.`, /const\s+agents\s*=\s*readJson\(\s*filePath\(['"]agents\.json['"]/);
        forbidPattern(problems, context.blocks.dashboardAgents.text, `${FILES.dashboard.display} apiAgents must not directly read profiles.json.`, /const\s+profiles\s*=\s*readJson\(\s*filePath\(['"]profiles\.json['"]/);

        for (const target of [
          { label: `${FILES.dashboard.display} apiTasks`, text: context.blocks.dashboardTasksGet.text },
          { label: `${FILES.dashboard.display} /api/export-json`, text: context.blocks.dashboardExportJson.text },
          { label: `${FILES.dashboard.display} /api/profiles GET`, text: context.blocks.dashboardProfilesGet.text },
          { label: `${FILES.dashboard.display} /api/profiles POST`, text: context.blocks.dashboardProfilesPost.text },
          { label: `${FILES.dashboard.display} /api/workflows GET`, text: context.blocks.dashboardWorkflowsGet.text },
          { label: `${FILES.dashboard.display} /api/plan/skip/:id`, text: context.blocks.dashboardPlanSkip.text },
          { label: `${FILES.dashboard.display} /api/plan/reassign/:id`, text: context.blocks.dashboardPlanReassign.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly read agents.json.`, directAgentsRead);
          forbidPattern(problems, target.text, `${target.label} must not directly read profiles.json.`, directProfilesRead);
          forbidPattern(problems, target.text, `${target.label} must not directly read tasks.json.`, directTasksRead);
          forbidPattern(problems, target.text, `${target.label} must not directly read workflows.json.`, directWorkflowsRead);
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite profiles.json.`, directProfilesWrite);
        }

        return problems;
      },
    },
    {
      key: 'api_agent_authority',
      success: 'API-agent registration, profile seeding, heartbeat, and status updates still route through canonical agent helpers.',
      run(context) {
        const problems = [];
        addBlockProblems(problems, context.blocks.apiAgentsConstructor);
        addBlockProblems(problems, context.blocks.apiRegister);
        addBlockProblems(problems, context.blocks.apiUnregister);
        addBlockProblems(problems, context.blocks.apiHeartbeat);
        addBlockProblems(problems, context.blocks.apiStatusUpdate);

        requireSnippet(problems, context.blocks.apiAgentsConstructor.text, `${FILES.apiAgents.display} constructor must create the canonical state helper.`, 'this._canonicalState = createCanonicalState({ dataDir, processPid: process.pid });');
        requireSnippet(problems, context.blocks.apiRegister.text, `${FILES.apiAgents.display} _registerInAgentsJson must use this._canonicalState.registerApiAgent(...).`, 'this._canonicalState.registerApiAgent({');
        requireSnippet(problems, context.blocks.apiUnregister.text, `${FILES.apiAgents.display} _unregisterFromAgentsJson must use this._canonicalState.unregisterApiAgent(name).`, 'this._canonicalState.unregisterApiAgent(name);');
        requireSnippet(problems, context.blocks.apiHeartbeat.text, `${FILES.apiAgents.display} _updateHeartbeat must use this._canonicalState.updateAgentHeartbeat(name).`, 'this._canonicalState.updateAgentHeartbeat(name);');
        requireSnippet(problems, context.blocks.apiStatusUpdate.text, `${FILES.apiAgents.display} _updateAgentStatus must use this._canonicalState.updateAgentStatus(name, status).`, 'this._canonicalState.updateAgentStatus(name, status);');

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose registerApiAgent().`, 'function registerApiAgent(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} registerApiAgent() must write agents through agentsState.setAgent().`, 'const savedAgent = agentsState.setAgent(name, agent);');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} registerApiAgent() must seed profiles through agentsState.updateProfile().`, 'savedProfile = agentsState.updateProfile(name, (currentProfile) => {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose unregisterApiAgent().`, 'function unregisterApiAgent(name, options = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} unregisterApiAgent() must remove agents through agentsState.removeAgent().`, 'const removed = agentsState.removeAgent(name);');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} unregisterApiAgent() must remove profiles through agentsState.deleteProfile().`, 'if (removeProfile) agentsState.deleteProfile(name);');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose updateAgentHeartbeat().`, 'function updateAgentHeartbeat(name) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} updateAgentHeartbeat() must touch heartbeat overlays through agentsState.touchHeartbeat().`, 'if (updated) agentsState.touchHeartbeat(name);');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose updateAgentStatus().`, 'function updateAgentStatus(name, status) {');

        for (const target of [
          { label: `${FILES.apiAgents.display} _registerInAgentsJson`, text: context.blocks.apiRegister.text },
          { label: `${FILES.apiAgents.display} _unregisterFromAgentsJson`, text: context.blocks.apiUnregister.text },
          { label: `${FILES.apiAgents.display} _updateHeartbeat`, text: context.blocks.apiHeartbeat.text },
          { label: `${FILES.apiAgents.display} _updateAgentStatus`, text: context.blocks.apiStatusUpdate.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite agents.json.`, directAgentsWrite);
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite profiles.json.`, directProfilesWrite);
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite heartbeat overlays.`, directHeartbeatWrite);
        }

        return problems;
      },
    },
    {
      key: 'dashboard_task_workflow_authority',
      success: 'Dashboard task, workflow, and plan-control mutations still route through canonical task/workflow helpers.',
      run(context) {
        const problems = [];
        addBlockProblems(problems, context.blocks.dashboardUpdateTask);
        addBlockProblems(problems, context.blocks.dashboardWorkflowsPost);
        addBlockProblems(problems, context.blocks.dashboardPlanPause);
        addBlockProblems(problems, context.blocks.dashboardPlanResume);
        addBlockProblems(problems, context.blocks.dashboardPlanStop);
        addBlockProblems(problems, context.blocks.dashboardPlanSkip);
        addBlockProblems(problems, context.blocks.dashboardPlanReassign);

        requireSnippet(problems, context.blocks.dashboardUpdateTask.text, `${FILES.dashboard.display} apiUpdateTask must use getCanonicalState(projectPath).updateTaskStatus(...) with the requested branch.`, 'return getCanonicalState(projectPath).updateTaskStatus({');
        requireSnippet(problems, context.blocks.dashboardUpdateTask.text, `${FILES.dashboard.display} apiUpdateTask must pass branch through to canonicalState.updateTaskStatus(...).`, 'branch: branchResult.branch,');
        requireSnippet(problems, context.blocks.dashboardWorkflowsPost.text, `${FILES.dashboard.display} /api/workflows POST must fetch the canonical state helper once.`, 'const canonicalState = getCanonicalState(projectPath);');
        requireSnippet(problems, context.blocks.dashboardWorkflowsPost.text, `${FILES.dashboard.display} /api/workflows POST must use canonicalState.advanceWorkflow(...) with the requested branch.`, 'const result = canonicalState.advanceWorkflow({ workflowId: body.workflow_id, notes: body.notes, branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardWorkflowsPost.text, `${FILES.dashboard.display} /api/workflows POST must use canonicalState.skipWorkflowStep(...).`, 'const result = canonicalState.skipWorkflowStep({');
        requireSnippet(problems, context.blocks.dashboardWorkflowsPost.text, `${FILES.dashboard.display} /api/workflows POST skip must pass branch through to canonicalState.skipWorkflowStep(...).`, 'branch: branchResult.branch,');
        requireSnippet(problems, context.blocks.dashboardPlanPause.text, `${FILES.dashboard.display} /api/plan/pause must use getCanonicalState(projectPath).pausePlan(...) with the requested branch.`, 'const result = getCanonicalState(projectPath).pausePlan({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardPlanResume.text, `${FILES.dashboard.display} /api/plan/resume must use getCanonicalState(projectPath).resumePlan(...) with the requested branch.`, 'const result = getCanonicalState(projectPath).resumePlan({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardPlanStop.text, `${FILES.dashboard.display} /api/plan/stop must use getCanonicalState(projectPath).stopPlan(...) with the requested branch.`, 'const result = getCanonicalState(projectPath).stopPlan({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardPlanSkip.text, `${FILES.dashboard.display} /api/plan/skip/:id must use canonicalState.skipWorkflowStep(...).`, 'const result = canonicalState.skipWorkflowStep({');
        requireSnippet(problems, context.blocks.dashboardPlanSkip.text, `${FILES.dashboard.display} /api/plan/skip/:id must pass branch through to canonicalState.skipWorkflowStep(...).`, 'branch: branchResult.branch,');
        requireSnippet(problems, context.blocks.dashboardPlanReassign.text, `${FILES.dashboard.display} /api/plan/reassign/:id must use canonicalState.reassignWorkflowStep(...).`, 'const result = canonicalState.reassignWorkflowStep({');
        requireSnippet(problems, context.blocks.dashboardPlanReassign.text, `${FILES.dashboard.display} /api/plan/reassign/:id must pass branch through to canonicalState.reassignWorkflowStep(...).`, 'branch: branchResult.branch,');

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose updateTaskStatus().`, 'function updateTaskStatus(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} updateTaskStatus() must delegate to tasksWorkflowsState.mutateTasks(...).`, 'tasksWorkflowsState.mutateTasks((tasks) => {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose advanceWorkflow().`, 'function advanceWorkflow(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} advanceWorkflow() must delegate to tasksWorkflowsState.mutateWorkflows(...).`, 'tasksWorkflowsState.mutateWorkflows((workflows) => {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose skipWorkflowStep().`, 'function skipWorkflowStep(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose reassignWorkflowStep().`, 'function reassignWorkflowStep(params) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose pausePlan().`, 'function pausePlan() {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose resumePlan().`, 'function resumePlan() {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose stopPlan().`, 'function stopPlan() {');

        for (const target of [
          { label: `${FILES.dashboard.display} apiUpdateTask`, text: context.blocks.dashboardUpdateTask.text },
          { label: `${FILES.dashboard.display} /api/workflows POST`, text: context.blocks.dashboardWorkflowsPost.text },
          { label: `${FILES.dashboard.display} /api/plan/pause`, text: context.blocks.dashboardPlanPause.text },
          { label: `${FILES.dashboard.display} /api/plan/resume`, text: context.blocks.dashboardPlanResume.text },
          { label: `${FILES.dashboard.display} /api/plan/stop`, text: context.blocks.dashboardPlanStop.text },
          { label: `${FILES.dashboard.display} /api/plan/skip/:id`, text: context.blocks.dashboardPlanSkip.text },
          { label: `${FILES.dashboard.display} /api/plan/reassign/:id`, text: context.blocks.dashboardPlanReassign.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite tasks.json.`, directTasksWrite);
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite workflows.json.`, directWorkflowsWrite);
        }

        return problems;
      },
    },
    {
      key: 'collaboration_state_authority',
      success: 'Rules, workspace, decision, knowledge, review, dependency, progress, and vote governance surfaces route through canonical helpers instead of raw projection writes.',
      run(context) {
        const problems = [];
        addBlockProblems(problems, context.blocks.dashboardRulesApi);
        addBlockProblems(problems, context.blocks.dashboardRulesRoutes);
        addBlockProblems(problems, context.blocks.workspaceSaveHelper);
        addBlockProblems(problems, context.blocks.toolLogDecision);
        addBlockProblems(problems, context.blocks.toolKBWrite);
        addBlockProblems(problems, context.blocks.toolUpdateProgress);
        addBlockProblems(problems, context.blocks.toolCallVote);
        addBlockProblems(problems, context.blocks.toolCastVote);
        addBlockProblems(problems, context.blocks.toolAddRule);
        addBlockProblems(problems, context.blocks.toolRemoveRule);
        addBlockProblems(problems, context.blocks.toolToggleRule);
        addBlockProblems(problems, context.blocks.dashboardDecisionsRoute);
        addBlockProblems(problems, context.blocks.dashboardPlanSkillsRoute);
        addBlockProblems(problems, context.blocks.toolRequestReview);
        addBlockProblems(problems, context.blocks.toolSubmitReview);
        addBlockProblems(problems, context.blocks.toolDeclareDependency);

        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listDecisions().`, 'function listDecisions(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose readKnowledgeBase().`, 'function readKnowledgeBase(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listReviews().`, 'function listReviews(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listDependencies().`, 'function listDependencies(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listVotes().`, 'function listVotes(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose listRules().`, 'function listRules(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose readProgress().`, 'function readProgress(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose mutateReviews().`, 'function mutateReviews(mutator, params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose mutateDependencies().`, 'function mutateDependencies(mutator, params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose addRule().`, 'function addRule(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose updateRule().`, 'function updateRule(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose toggleRule().`, 'function toggleRule(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose removeRule().`, 'function removeRule(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose saveWorkspace().`, 'function saveWorkspace(agentName, workspace, params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose logDecision().`, 'function logDecision(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose writeKnowledgeBaseEntry().`, 'function writeKnowledgeBaseEntry(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose updateProgressRecord().`, 'function updateProgressRecord(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose createVote().`, 'function createVote(params = {}) {');
        requireSnippet(problems, context.sources.canonical, `${FILES.canonical.display} must expose castVote().`, 'function castVote(params = {}) {');

        requireSnippet(problems, context.blocks.dashboardRulesApi.text, `${FILES.dashboard.display} apiRules must read rules through canonicalState.listRules(...).`, 'return getCanonicalState(projectPath).listRules({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardRulesApi.text, `${FILES.dashboard.display} apiAddRule must use canonical addRule().`, 'const created = getCanonicalState(projectPath).addRule({');
        requireSnippet(problems, context.blocks.dashboardRulesApi.text, `${FILES.dashboard.display} apiUpdateRule must use canonical updateRule().`, 'const updated = getCanonicalState(projectPath).updateRule({');
        requireSnippet(problems, context.blocks.dashboardRulesApi.text, `${FILES.dashboard.display} apiDeleteRule must use canonical removeRule().`, 'const removed = getCanonicalState(projectPath).removeRule({');
        requireSnippet(problems, context.blocks.dashboardRulesRoutes.text, `${FILES.dashboard.display} rules routes must delegate GET to apiRules().`, 'const result = apiRules(url.searchParams);');
        requireSnippet(problems, context.blocks.dashboardRulesRoutes.text, `${FILES.dashboard.display} rules routes must delegate POST to apiAddRule().`, 'const result = apiAddRule(body, url.searchParams);');
        requireSnippet(problems, context.blocks.dashboardRulesRoutes.text, `${FILES.dashboard.display} rules routes must delegate DELETE to apiDeleteRule().`, 'const result = apiDeleteRule({ rule_id: ruleId }, url.searchParams);');
        requireSnippet(problems, context.blocks.dashboardRulesRoutes.text, `${FILES.dashboard.display} rules toggle route must use canonical toggleRule().`, 'const toggled = getCanonicalState(projectPath).toggleRule({');
        requireSnippet(problems, context.blocks.dashboardDecisionsRoute.text, `${FILES.dashboard.display} /api/decisions must read decisions through canonicalState.listDecisions(...).`, 'getCanonicalState(projectPath).listDecisions({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardExportJson.text, `${FILES.dashboard.display} /api/export-json must read decisions through canonicalState.listDecisions(...).`, 'const decisions = canonicalState.listDecisions({ branch: branchResult.branch });');
        requireSnippet(problems, context.blocks.dashboardPlanSkillsRoute.text, `${FILES.dashboard.display} /api/plan/skills must read the KB through canonicalState.readKnowledgeBase(...).`, 'const kb = getCanonicalState(projectPath).readKnowledgeBase({ branch: branchResult.branch });');

        requireSnippet(problems, context.blocks.workspaceSaveHelper.text, 'agent-bridge/server.js workspace helper must use canonical saveWorkspace().', 'const result = canonicalState.saveWorkspace(agentName, data, {');
        requireSnippet(problems, context.blocks.toolLogDecision.text, 'toolLogDecision must use canonical logDecision().', 'const logged = canonicalState.logDecision({');
        requireSnippet(problems, context.blocks.toolKBWrite.text, 'toolKBWrite must use canonical writeKnowledgeBaseEntry().', 'const written = canonicalState.writeKnowledgeBaseEntry({');
        requireSnippet(problems, context.blocks.toolUpdateProgress.text, 'toolUpdateProgress must use canonical updateProgressRecord().', 'const updated = canonicalState.updateProgressRecord({');
        requireSnippet(problems, context.blocks.toolCallVote.text, 'toolCallVote must use canonical createVote().', 'const created = canonicalState.createVote({');
        requireSnippet(problems, context.blocks.toolCastVote.text, 'toolCastVote must use canonical castVote().', 'const cast = canonicalState.castVote({');
        requireSnippet(problems, context.blocks.toolAddRule.text, 'toolAddRule must use canonical addRule().', 'const created = canonicalState.addRule({');
        requireSnippet(problems, context.blocks.toolRemoveRule.text, 'toolRemoveRule must use canonical removeRule().', 'const removed = canonicalState.removeRule({');
        requireSnippet(problems, context.blocks.toolToggleRule.text, 'toolToggleRule must use canonical toggleRule().', 'const toggled = canonicalState.toggleRule({');
        requireSnippet(problems, context.blocks.toolRequestReview.text, 'toolRequestReview must use canonical mutateReviews().', 'const reviewWrite = canonicalState.mutateReviews((reviews) => {');
        requireSnippet(problems, context.blocks.toolSubmitReview.text, 'toolSubmitReview must use canonical mutateReviews().', 'const reviewUpdate = canonicalState.mutateReviews((reviews) => {');
        requireSnippet(problems, context.blocks.toolDeclareDependency.text, 'toolDeclareDependency must use canonical mutateDependencies().', 'const dependencyWrite = canonicalState.mutateDependencies((deps) => {');
        requireSnippet(problems, context.sources.server, 'Dependency resolution on task completion must use canonical mutateDependencies().', 'const resolvedDependencies = canonicalState.mutateDependencies((deps) => {');

        for (const target of [
          { label: `${FILES.dashboard.display} rules api helpers`, text: context.blocks.dashboardRulesApi.text },
          { label: `${FILES.dashboard.display} rules routes`, text: context.blocks.dashboardRulesRoutes.text },
          { label: 'toolAddRule', text: context.blocks.toolAddRule.text },
          { label: 'toolRemoveRule', text: context.blocks.toolRemoveRule.text },
          { label: 'toolToggleRule', text: context.blocks.toolToggleRule.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly rewrite rules.json.`, directRulesWrite);
          forbidPattern(problems, target.text, `${target.label} must not use legacy writeJsonFile(RULES_FILE, ...).`, /writeJsonFile\(RULES_FILE/);
        }

        for (const target of [
          { label: `${FILES.dashboard.display} /api/decisions`, text: context.blocks.dashboardDecisionsRoute.text },
          { label: `${FILES.dashboard.display} /api/export-json`, text: context.blocks.dashboardExportJson.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly read decisions.json.`, directDecisionsRead);
        }
        forbidPattern(problems, context.blocks.dashboardPlanSkillsRoute.text, `${FILES.dashboard.display} /api/plan/skills must not directly read kb.json.`, directKnowledgeRead);

        forbidPattern(problems, context.blocks.workspaceSaveHelper.text, 'saveWorkspace() must not directly write workspace files with fs.writeFileSync.', directWorkspaceWrite);

        for (const target of [
          { label: 'toolLogDecision', text: context.blocks.toolLogDecision.text },
          { label: 'toolKBWrite', text: context.blocks.toolKBWrite.text },
          { label: 'toolUpdateProgress', text: context.blocks.toolUpdateProgress.text },
          { label: 'toolCallVote', text: context.blocks.toolCallVote.text },
          { label: 'toolCastVote', text: context.blocks.toolCastVote.text },
          { label: 'toolRequestReview', text: context.blocks.toolRequestReview.text },
          { label: 'toolSubmitReview', text: context.blocks.toolSubmitReview.text },
          { label: 'toolDeclareDependency', text: context.blocks.toolDeclareDependency.text },
        ]) {
          forbidPattern(problems, target.text, `${target.label} must not directly write legacy governance projections.`, directGovernanceWrite);
        }

        return problems;
      },
    },
  ];
}

function runAuthoritySuite(context) {
  const checks = getAuthorityChecks();
  const failures = [];
  const successes = [];

  for (const check of checks) {
    const problems = check.run(context);
    if (problems.length > 0) {
      failures.push({ key: check.key, problems });
      continue;
    }
    successes.push({ key: check.key, message: check.success });
  }

  return { failures, successes };
}

function main() {
  const { simulateLegacyWrite } = parseArgs(process.argv.slice(2));
  const context = buildContext(simulateLegacyWrite);
  const result = runAuthoritySuite(context);

  if (result.failures.length > 0) {
    const lines = [
      'Authority invariant suite failed.',
      'Suite: authority',
      `Simulated legacy write: ${simulateLegacyWrite ? 'enabled' : 'disabled'}`,
      'Violations:',
    ];

    for (const failure of result.failures) {
      lines.push(`- ${failure.key}`);
      for (const problem of failure.problems) {
        lines.push(`  - ${problem}`);
      }
    }

    fail(lines.join('\n'), 1);
  }

  const lines = [
    'Authority invariant suite passed.',
    'Suite: authority',
    `Simulated legacy write: ${simulateLegacyWrite ? 'enabled' : 'disabled'}`,
    `Validated ${result.successes.length} authority invariants across ${Object.keys(FILES).length} checked files.`,
  ];

  for (const success of result.successes) {
    lines.push(`- ${success.key}: ${success.message}`);
  }

  console.log(lines.join('\n'));
}

main();
