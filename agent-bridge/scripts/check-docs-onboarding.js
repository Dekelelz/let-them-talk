#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  VALID_CAPABILITIES,
} = require(path.resolve(__dirname, '..', 'runtime-descriptor.js'));

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PACKAGE_ROOT = path.resolve(__dirname, '..');
const CLI_PATH = path.join(PACKAGE_ROOT, 'cli.js');
const AGENT_TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates');
const CONVERSATION_TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'conversation-templates');
const PACKAGE_JSON_PATH = path.join(PACKAGE_ROOT, 'package.json');
const ROOT_PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

const DOCS = Object.freeze({
  rootReadme: Object.freeze({
    display: 'README.md',
    path: path.join(REPO_ROOT, 'README.md'),
    expectedVerificationCommands: Object.freeze([
      'npm test',
      'npm --prefix agent-bridge run verify',
      'npm --prefix agent-bridge run verify:contracts',
      'npm --prefix agent-bridge run verify:replay',
      'npm --prefix agent-bridge run verify:invariants',
      'npm --prefix agent-bridge run verify:smoke',
    ]),
    checkTemplateInventory: true,
  }),
  packageReadme: Object.freeze({
    display: 'agent-bridge/README.md',
    path: path.join(PACKAGE_ROOT, 'README.md'),
    expectedVerificationCommands: Object.freeze([
      'npm test',
      'npm run verify',
      'npm run verify:contracts',
      'npm run verify:replay',
      'npm run verify:invariants',
      'npm run verify:smoke',
    ]),
    checkTemplateInventory: true,
  }),
  usage: Object.freeze({
    display: 'USAGE.md',
    path: path.join(REPO_ROOT, 'USAGE.md'),
    expectedVerificationCommands: Object.freeze([
      'npm test',
      'npm --prefix agent-bridge run verify',
      'npm --prefix agent-bridge run verify:contracts',
      'npm --prefix agent-bridge run verify:replay',
      'npm --prefix agent-bridge run verify:invariants',
      'npm --prefix agent-bridge run verify:smoke',
    ]),
    checkTemplateInventory: true,
  }),
  claude: Object.freeze({
    display: 'CLAUDE.md',
    path: path.join(REPO_ROOT, 'CLAUDE.md'),
    expectedVerificationCommands: Object.freeze([
      'npm test',
      'npm --prefix agent-bridge run verify',
      'npm --prefix agent-bridge run verify:contracts',
      'npm --prefix agent-bridge run verify:replay',
      'npm --prefix agent-bridge run verify:invariants',
      'npm --prefix agent-bridge run verify:smoke',
    ]),
    checkTemplateInventory: false,
  }),
});

const REQUIRED_HELP_COMMANDS = Object.freeze([
  'npx let-them-talk init',
  'npx let-them-talk init --claude',
  'npx let-them-talk init --gemini',
  'npx let-them-talk init --codex',
  'npx let-them-talk init --all',
  'npx let-them-talk init --ollama',
  'npx let-them-talk init --template <name>',
  'node .agent-bridge/launch.js',
  'node .agent-bridge/launch.js --lan',
  'node .agent-bridge/launch.js status',
  'node .agent-bridge/launch.js msg <agent> <text>',
  'node .agent-bridge/launch.js reset',
  'npx let-them-talk dashboard',
  'npx let-them-talk status',
  'npx let-them-talk templates',
  'npx let-them-talk uninstall',
  'npx let-them-talk help',
]);

const REQUIRED_PACKAGE_SCRIPTS = Object.freeze([
  'test',
  'verify',
  'verify:docs-onboarding',
  'verify:contracts',
  'verify:replay',
  'verify:invariants',
  'verify:smoke',
]);

const SUPPORTED_STALE_KEYS = Object.freeze([
  'launcher_lan',
  'agent_templates',
  'conversation_templates',
  'runtime_descriptor',
  'verification_surface',
]);

const USAGE = `Usage: node agent-bridge/scripts/check-docs-onboarding.js [--simulate-stale <${SUPPORTED_STALE_KEYS.join('|')}>]`;

function fail(lines, exitCode = 1) {
  process.stderr.write(lines.join('\n') + '\n');
  process.exit(exitCode);
}

function assert(condition, message, problems) {
  if (!condition) problems.push(message);
}

function parseArgs(argv) {
  if (argv.length === 0) {
    return { simulateStaleKey: null };
  }

  if (argv.length === 2 && argv[0] === '--simulate-stale') {
    const simulateStaleKey = argv[1];
    if (!SUPPORTED_STALE_KEYS.includes(simulateStaleKey)) {
      fail([
        `Unknown key for --simulate-stale: ${simulateStaleKey}`,
        `Supported keys: ${SUPPORTED_STALE_KEYS.join(', ')}`,
        USAGE,
      ], 2);
    }

    return { simulateStaleKey };
  }

  fail([USAGE], 2);
}

function readText(filePath, display) {
  if (!fs.existsSync(filePath)) {
    fail(['Docs/onboarding validation failed.', `Missing file: ${display}`], 1);
  }

  return fs.readFileSync(filePath, 'utf8');
}

function readJson(filePath, display) {
  if (!fs.existsSync(filePath)) {
    fail(['Docs/onboarding validation failed.', `Missing file: ${display}`], 1);
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    fail(['Docs/onboarding validation failed.', `Could not parse JSON: ${display}`, error.message], 1);
  }
}

function normalizeCommand(line) {
  return line
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/--template\s+T\b/g, '--template <name>')
    .replace(/--template\s+<[^>]+>/g, '--template <name>')
    .replace(/msg\s+<[^>]+>\s+<[^>]+>/g, 'msg <agent> <text>');
}

function extractKnownCommand(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const patterns = [
    /^npx let-them-talk init(?: --(?:claude|gemini|codex|all|ollama))?(?: --template (?:<[^>]+>|T))?/,
    /^node \.agent-bridge\/launch\.js(?: --lan| status| reset| msg <[^>]+> <[^>]+>)?/,
    /^npx let-them-talk (?:dashboard|status|templates|uninstall|help)/,
    /^npm test$/,
    /^npm(?: --prefix agent-bridge run| run) verify(?:[:\w-]+)?$/,
  ];

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return normalizeCommand(match[0]);
  }

  return null;
}

function extractCommandSet(text) {
  const commands = new Set();

  for (const line of text.split(/\r?\n/)) {
    const command = extractKnownCommand(line);
    if (command) commands.add(command);
  }

  return commands;
}

function describeProcessFailure(label, result) {
  const lines = [`${label} failed.`];
  if (typeof result.status === 'number') lines.push(`Exit code: ${result.status}`);
  if (result.error) lines.push(`Process error: ${result.error.message}`);
  if (result.stdout && result.stdout.trim()) {
    lines.push('stdout:');
    lines.push(...result.stdout.trimEnd().split(/\r?\n/).map((line) => `  ${line}`));
  }
  if (result.stderr && result.stderr.trim()) {
    lines.push('stderr:');
    lines.push(...result.stderr.trimEnd().split(/\r?\n/).map((line) => `  ${line}`));
  }
  return lines.join('\n');
}

function runNode(args, cwd) {
  return spawnSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
  });
}

function listTemplateEntries(dirPath, idKey, display) {
  if (!fs.existsSync(dirPath)) {
    fail(['Docs/onboarding validation failed.', `Missing directory: ${display}`], 1);
  }

  return fs.readdirSync(dirPath)
    .filter((fileName) => fileName.endsWith('.json'))
    .sort((left, right) => left.localeCompare(right))
    .map((fileName) => {
      const filePath = path.join(dirPath, fileName);
      const raw = fs.readFileSync(filePath, 'utf8');
      const json = JSON.parse(raw);
      return {
        fileName,
        raw,
        json,
        id: json[idKey],
      };
    });
}

function docHasToken(docText, token) {
  return docText.includes(`\`${token}\``) || docText.includes(token);
}

function checkDocCommandSurface(docSpec, docText, requiredCommands, problems) {
  const commandSet = extractCommandSet(docText);

  for (const command of requiredCommands) {
    if (!commandSet.has(command)) {
      problems.push(`${docSpec.display} is missing the current command reference: ${command}`);
    }
  }

  for (const command of docSpec.expectedVerificationCommands) {
    if (!commandSet.has(command)) {
      problems.push(`${docSpec.display} is missing the current verification command: ${command}`);
    }
  }
}

function checkDocRuntimeSurface(docSpec, docText, runtimeFields, capabilityTokens, problems) {
  for (const field of runtimeFields) {
    if (!docHasToken(docText, field)) {
      problems.push(`${docSpec.display} is missing runtime descriptor field guidance for ${field}.`);
    }
  }

  for (const capability of capabilityTokens) {
    if (!docHasToken(docText, capability)) {
      problems.push(`${docSpec.display} is missing capability guidance for ${capability}.`);
    }
  }
}

function checkDocTemplateInventory(docSpec, docText, agentTemplateNames, conversationTemplateIds, problems) {
  if (!docSpec.checkTemplateInventory) return;

  for (const templateName of agentTemplateNames) {
    if (!docHasToken(docText, templateName)) {
      problems.push(`${docSpec.display} is missing agent template inventory item ${templateName}.`);
    }
  }

  for (const templateId of conversationTemplateIds) {
    if (!docHasToken(docText, templateId)) {
      problems.push(`${docSpec.display} is missing conversation template inventory item ${templateId}.`);
    }
  }
}

function launchScriptSupportsLanShortcut(launchScriptText) {
  return launchScriptText.includes("firstArg === '--lan'")
    && launchScriptText.includes("['dashboard', '--lan'")
    && launchScriptText.includes('const forwardedArgs =');
}

function main() {
  const { simulateStaleKey } = parseArgs(process.argv.slice(2));
  const problems = [];

  const packageJson = readJson(PACKAGE_JSON_PATH, 'agent-bridge/package.json');
  const rootPackageJson = readJson(ROOT_PACKAGE_JSON_PATH, 'package.json');

  for (const scriptName of REQUIRED_PACKAGE_SCRIPTS) {
    assert(
      packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string',
      `agent-bridge/package.json must define script ${scriptName}.`,
      problems
    );
  }

  assert(
    rootPackageJson && rootPackageJson.scripts && rootPackageJson.scripts.test === 'npm --prefix agent-bridge test',
    'package.json must keep npm test wired to the grouped agent-bridge verification surface.',
    problems
  );

  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ltt-docs-onboarding-'));
  const fixtureProject = path.join(fixtureRoot, 'project');
  fs.mkdirSync(fixtureProject, { recursive: true });

  try {
    const helpResult = runNode([CLI_PATH, 'help'], fixtureProject);
    if (helpResult.error || helpResult.status !== 0) {
      problems.push(describeProcessFailure('CLI help surface', helpResult));
    }

    const helpCommands = extractCommandSet(helpResult.stdout || '');
    for (const command of REQUIRED_HELP_COMMANDS) {
      assert(helpCommands.has(command), `CLI help output must include current command: ${command}`, problems);
    }

    const templatesResult = runNode([CLI_PATH, 'templates'], fixtureProject);
    if (templatesResult.error || templatesResult.status !== 0) {
      problems.push(describeProcessFailure('CLI template listing', templatesResult));
    }

    assert((templatesResult.stdout || '').includes('Available Agent Templates'), 'CLI templates output must show the agent template inventory header.', problems);
    assert((templatesResult.stdout || '').includes('Usage: npx let-them-talk init --template <name>'), 'CLI templates output must point users at init --template <name>.', problems);
    assert((templatesResult.stdout || '').includes('agent-bridge/conversation-templates/*.json'), 'CLI templates output must explain where conversation templates live.', problems);

    const initResult = runNode([CLI_PATH, 'init', '--claude', '--template', 'pair'], fixtureProject);
    if (initResult.error || initResult.status !== 0) {
      problems.push(describeProcessFailure('CLI init onboarding fixture', initResult));
    }

    const initOutput = initResult.stdout || '';
    const fixtureMcpPath = path.join(fixtureProject, '.mcp.json');
    const fixtureGitignorePath = path.join(fixtureProject, '.gitignore');
    const fixtureLaunchPath = path.join(fixtureProject, '.agent-bridge', 'launch.js');

    assert(initOutput.includes('Local launcher saved to .agent-bridge/launch.js'), 'init output must confirm the local launcher path.', problems);
    assert(initOutput.includes('Template: pair'), 'init --template pair must print the requested agent template.', problems);
    assert(initOutput.includes('These prompts assume current onboarding: register, get_briefing(), then get_guide() when you need the current rules.'), 'init --template output must explain the current onboarding order.', problems);
    assert(fs.existsSync(fixtureMcpPath), 'init must write .mcp.json for the fresh local onboarding path.', problems);
    assert(fs.existsSync(fixtureGitignorePath), 'init must write or update .gitignore for the fresh local onboarding path.', problems);
    assert(fs.existsSync(fixtureLaunchPath), 'init must write .agent-bridge/launch.js for the fresh local onboarding path.', problems);

    if (fs.existsSync(fixtureMcpPath)) {
      const fixtureMcp = readJson(fixtureMcpPath, '.mcp.json fixture');
      const serverEntry = fixtureMcp && fixtureMcp.mcpServers ? fixtureMcp.mcpServers['agent-bridge'] : null;
      assert(serverEntry && serverEntry.command === 'node', 'init must write the agent-bridge MCP server command into .mcp.json.', problems);
      assert(serverEntry && Array.isArray(serverEntry.args) && serverEntry.args.some((entry) => String(entry).endsWith('/server.js')), 'init must point .mcp.json at agent-bridge/server.js.', problems);
    }

    const launchScriptText = fs.existsSync(fixtureLaunchPath)
      ? fs.readFileSync(fixtureLaunchPath, 'utf8')
      : '';

    const launcherStatusResult = fs.existsSync(fixtureLaunchPath)
      ? runNode([fixtureLaunchPath, 'status'], fixtureProject)
      : { status: 1, stdout: '', stderr: 'launch.js missing', error: null };
    if (launcherStatusResult.error || launcherStatusResult.status !== 0) {
      problems.push(describeProcessFailure('Generated local launcher status command', launcherStatusResult));
    }

    const agentTemplateEntries = listTemplateEntries(AGENT_TEMPLATE_DIR, 'name', 'agent-bridge/templates');
    const conversationTemplateEntries = listTemplateEntries(CONVERSATION_TEMPLATE_DIR, 'id', 'agent-bridge/conversation-templates');

    const runtimeFields = ['runtime_type', 'provider_id', 'model_id', 'capabilities'];
    const capabilityTokens = [...VALID_CAPABILITIES];
    const agentTemplateNames = agentTemplateEntries.map((entry) => entry.id);
    const conversationTemplateIds = conversationTemplateEntries.map((entry) => entry.id);

    let lanShortcutSupported = launchScriptSupportsLanShortcut(launchScriptText);

    if (simulateStaleKey === 'launcher_lan') {
      lanShortcutSupported = false;
    }
    if (simulateStaleKey === 'agent_templates') {
      agentTemplateNames.push('stale-template');
    }
    if (simulateStaleKey === 'conversation_templates') {
      conversationTemplateIds.push('stale-conversation');
    }
    if (simulateStaleKey === 'runtime_descriptor') {
      runtimeFields.push('provider');
    }
    if (simulateStaleKey === 'verification_surface') {
      REQUIRED_PACKAGE_SCRIPTS.concat(['verify:stale-reference']).forEach((scriptName) => {
        assert(
          packageJson && packageJson.scripts && typeof packageJson.scripts[scriptName] === 'string',
          `agent-bridge/package.json must define script ${scriptName}.`,
          problems
        );
      });
    }

    assert(lanShortcutSupported, 'Generated .agent-bridge/launch.js must preserve the documented --lan onboarding shortcut.', problems);

    for (const templateName of agentTemplateNames) {
      assert((templatesResult.stdout || '').includes(templateName), `CLI templates output must list built-in agent template ${templateName}.`, problems);
    }

    for (const entry of agentTemplateEntries) {
      const agents = Array.isArray(entry.json.agents) ? entry.json.agents : [];
      assert(typeof entry.id === 'string' && entry.id.length > 0, `${entry.fileName} must define a template name.`, problems);
      assert(agents.length > 0, `${entry.fileName} must contain at least one agent prompt.`, problems);

      for (const agent of agents) {
        const prompt = agent && typeof agent.prompt === 'string' ? agent.prompt : '';
        assert(/register/i.test(prompt), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must still tell the agent to register.`, problems);
        assert(prompt.includes('get_briefing()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include get_briefing().`, problems);
        assert(prompt.includes('get_guide()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include get_guide().`, problems);
      }
    }

    const pairTemplate = agentTemplateEntries.find((entry) => entry.id === 'pair');
    const teamTemplate = agentTemplateEntries.find((entry) => entry.id === 'team');
    const reviewTemplate = agentTemplateEntries.find((entry) => entry.id === 'review');
    const managedTemplate = agentTemplateEntries.find((entry) => entry.id === 'managed');

    assert(pairTemplate && pairTemplate.raw.includes('summary') && pairTemplate.raw.includes('verification') && pairTemplate.raw.includes('files_changed') && pairTemplate.raw.includes('confidence'), 'pair.json must keep evidence-backed handoff guidance.', problems);
    assert(teamTemplate && teamTemplate.raw.includes('summary') && teamTemplate.raw.includes('verification') && teamTemplate.raw.includes('files_changed') && teamTemplate.raw.includes('confidence'), 'team.json must keep evidence-backed report guidance.', problems);
    assert(reviewTemplate && reviewTemplate.raw.includes('summary') && reviewTemplate.raw.includes('verification') && reviewTemplate.raw.includes('files_changed') && reviewTemplate.raw.includes('confidence'), 'review.json must keep evidence-backed review handoff guidance.', problems);
    assert(teamTemplate && teamTemplate.raw.includes('specific capabilities'), 'team.json must keep capability-aware coordination guidance.', problems);
    assert(managedTemplate && managedTemplate.raw.includes('update_task(..., evidence={') && managedTemplate.raw.includes('advance_workflow(..., evidence={') && managedTemplate.raw.includes('required_capabilities') && managedTemplate.raw.includes('preferred_capabilities'), 'managed.json must keep evidence-backed completion and capability-aware assignment guidance.', problems);

    for (const entry of conversationTemplateEntries) {
      const agents = Array.isArray(entry.json.agents) ? entry.json.agents : [];
      assert(typeof entry.id === 'string' && entry.id.length > 0, `${entry.fileName} must define a conversation template id.`, problems);
      assert(agents.length > 0, `${entry.fileName} must contain at least one autonomous agent prompt.`, problems);

      for (const agent of agents) {
        const prompt = agent && typeof agent.prompt === 'string' ? agent.prompt : '';
        assert(/register/i.test(prompt), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must still tell the agent to register.`, problems);
        assert(prompt.includes('get_briefing()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include get_briefing().`, problems);
        assert(prompt.includes('get_guide()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include get_guide().`, problems);
        assert(prompt.includes('get_work()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include get_work().`, problems);
        assert(prompt.includes('verify_and_advance()'), `${entry.fileName} prompt for ${agent.name || '<unknown>'} must include verify_and_advance().`, problems);
      }

      assert(entry.raw.includes('required_capabilities') && entry.raw.includes('preferred_capabilities'), `${entry.fileName} must keep capability-aware work guidance.`, problems);
    }

    for (const docSpec of Object.values(DOCS)) {
      const docText = readText(docSpec.path, docSpec.display);
      checkDocCommandSurface(docSpec, docText, REQUIRED_HELP_COMMANDS, problems);
      checkDocRuntimeSurface(docSpec, docText, runtimeFields, capabilityTokens, problems);
      checkDocTemplateInventory(docSpec, docText, agentTemplateNames, conversationTemplateIds, problems);
    }
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    const lines = ['Docs/onboarding validation failed.'];
    if (simulateStaleKey) lines.push(`Simulated stale key: ${simulateStaleKey}`);
    lines.push(...problems.map((problem) => `- ${problem}`));
    fail(lines, 1);
  }

  console.log([
    'Docs/onboarding validation passed.',
    '- CLI help exposes the current init, launcher, and helper commands.',
    '- init writes the local launcher and MCP config, and the generated launcher preserves the documented --lan shortcut.',
    '- Template listing still points users at init --template <name> and the separate conversation-templates surface.',
    '- Built-in agent and conversation templates still carry the current register, get_briefing, get_guide, get_work, verify_and_advance, evidence, and capability-aware guidance.',
    '- README.md, agent-bridge/README.md, USAGE.md, and CLAUDE.md still match the shipped launcher, template inventory, runtime descriptor, and grouped verification surface.',
  ].join('\n'));
}

main();
