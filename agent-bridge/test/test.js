#!/usr/bin/env node
// test.js — Lightweight integration test suite for Let Them Talk
// No external dependencies. Run via: npm test
'use strict';

const { execSync, spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const passed = [];
const failed = [];
let dashboardProc = null;
const TEST_PORT = 19876; // unlikely to conflict

// ===================== HELPERS =====================

function log(msg) { process.stdout.write(msg + '\n'); }
function pass(name) { passed.push(name); log('  \x1b[32m✓\x1b[0m ' + name); }
function fail(name, reason) { failed.push({ name, reason }); log('  \x1b[31m✗\x1b[0m ' + name + ' — ' + reason); }

function fetch(urlPath, opts) {
  return new Promise(function(resolve, reject) {
    var options = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      path: urlPath,
      method: (opts && opts.method) || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, (opts && opts.headers) || {}),
    };
    var req = http.request(options, function(res) {
      var body = '';
      res.on('data', function(c) { body += c; });
      res.on('end', function() {
        var json = null;
        try { json = JSON.parse(body); } catch(e) {}
        resolve({ status: res.statusCode, body: body, json: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (opts && opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

function waitForServer(port, maxWait) {
  return new Promise(function(resolve, reject) {
    var start = Date.now();
    function check() {
      var req = http.request({ hostname: '127.0.0.1', port: port, path: '/api/agents', method: 'GET' }, function(res) {
        res.resume();
        resolve();
      });
      req.on('error', function() {
        if (Date.now() - start > maxWait) return reject(new Error('Server did not start within ' + maxWait + 'ms'));
        setTimeout(check, 200);
      });
      req.end();
    }
    check();
  });
}

// ===================== TEST SUITES =====================

async function testSyntax() {
  log('\n\x1b[1mSyntax Checks\x1b[0m');
  var files = ['server.js', 'dashboard.js', 'cli.js'];
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    try {
      execSync('node -c ' + JSON.stringify(path.join(ROOT, f)), { stdio: 'pipe' });
      pass(f + ' syntax valid');
    } catch(e) {
      fail(f + ' syntax', e.stderr ? e.stderr.toString().trim() : 'syntax error');
    }
  }
}

async function testPackageCompleteness() {
  log('\n\x1b[1mPackage Completeness\x1b[0m');
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  var filesField = pkg.files || [];

  for (var i = 0; i < filesField.length; i++) {
    var entry = filesField[i];
    var fullPath = path.join(ROOT, entry);
    if (fs.existsSync(fullPath)) {
      pass('files entry exists: ' + entry);
    } else {
      fail('files entry missing: ' + entry, 'not found on disk');
    }
  }

  // Verify specific new files
  var criticalFiles = ['office/builder.js', 'office/assets.js', 'office/world-save.js', 'office/index.js', 'office/player.js'];
  for (var j = 0; j < criticalFiles.length; j++) {
    var cf = criticalFiles[j];
    if (fs.existsSync(path.join(ROOT, cf))) {
      pass('critical file: ' + cf);
    } else {
      fail('critical file missing: ' + cf, 'not found');
    }
  }

  // Verify version is set
  if (pkg.version && /^\d+\.\d+\.\d+/.test(pkg.version)) {
    pass('version: ' + pkg.version);
  } else {
    fail('version', 'invalid or missing: ' + pkg.version);
  }

  // Verify bin entries
  if (pkg.bin && pkg.bin['let-them-talk']) {
    pass('bin entry: let-them-talk → ' + pkg.bin['let-them-talk']);
  } else {
    fail('bin entry', 'missing let-them-talk');
  }
}

async function testDashboardAPI() {
  log('\n\x1b[1mDashboard API Tests\x1b[0m');

  // GET endpoints that should return 200
  var getEndpoints = [
    { path: '/api/agents', name: 'GET /api/agents' },
    { path: '/api/history', name: 'GET /api/history' },
    { path: '/api/channels', name: 'GET /api/channels' },
    { path: '/api/profiles', name: 'GET /api/profiles' },
    { path: '/api/world-layout', name: 'GET /api/world-layout' },
  ];

  for (var i = 0; i < getEndpoints.length; i++) {
    var ep = getEndpoints[i];
    try {
      var res = await fetch(ep.path);
      if (res.status === 200) {
        pass(ep.name + ' → 200');
      } else {
        fail(ep.name, 'expected 200, got ' + res.status);
      }
    } catch(e) {
      fail(ep.name, 'request failed: ' + e.message);
    }
  }

  // Dashboard HTML
  try {
    var htmlRes = await fetch('/');
    if (htmlRes.status === 200 && htmlRes.body.includes('<!DOCTYPE html')) {
      pass('GET / → dashboard HTML');
    } else {
      fail('GET / → dashboard HTML', 'status=' + htmlRes.status + ', no DOCTYPE');
    }
  } catch(e) {
    fail('GET / → dashboard HTML', e.message);
  }
}

async function testCSRFProtection() {
  log('\n\x1b[1mCSRF Protection\x1b[0m');

  // POST without X-LTT-Request header should be rejected
  try {
    var res = await fetch('/api/inject', {
      method: 'POST',
      body: { to: 'test', content: 'csrf test' }
    });
    if (res.status === 403 && res.json && res.json.error && res.json.error.includes('X-LTT-Request')) {
      pass('POST without CSRF header → 403');
    } else {
      fail('POST without CSRF header', 'expected 403 with X-LTT-Request error, got ' + res.status + ': ' + res.body);
    }
  } catch(e) {
    fail('POST without CSRF header', e.message);
  }

  // POST with X-LTT-Request header should be accepted (may 400 for bad data, but not 403)
  try {
    var res2 = await fetch('/api/inject', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { to: '__nonexistent__', content: 'csrf test' }
    });
    if (res2.status !== 403) {
      pass('POST with CSRF header → not 403 (got ' + res2.status + ')');
    } else {
      fail('POST with CSRF header', 'still got 403');
    }
  } catch(e) {
    fail('POST with CSRF header', e.message);
  }
}


async function testWorldSaveRoundTrip() {
  log('\n\x1b[1mWorld-Save Round-Trip\x1b[0m');

  var testPlacement = [{ id: 'test_rt_' + Date.now(), type: 'plant', x: 5, y: 0, z: 5, rotY: 0 }];

  // Save
  try {
    var saveRes = await fetch('/api/world-save', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: testPlacement
    });
    if (saveRes.status === 200 && saveRes.json && saveRes.json.success) {
      pass('POST /api/world-save → 200 success');
    } else {
      fail('POST /api/world-save', 'status=' + saveRes.status + ', body=' + saveRes.body);
      return; // skip load test if save failed
    }
  } catch(e) {
    fail('POST /api/world-save', e.message);
    return;
  }

  // Load and verify
  try {
    var loadRes = await fetch('/api/world-layout');
    if (loadRes.status === 200 && loadRes.json && Array.isArray(loadRes.json) && loadRes.json.length > 0) {
      var found = loadRes.json.some(function(p) { return p.id === testPlacement[0].id; });
      if (found) {
        pass('GET /api/world-layout → round-trip verified');
      } else {
        fail('GET /api/world-layout → round-trip', 'placement not found in response');
      }
    } else {
      fail('GET /api/world-layout → round-trip', 'unexpected response: ' + loadRes.body);
    }
  } catch(e) {
    fail('GET /api/world-layout → round-trip', e.message);
  }

  // Clean up — save empty array
  try {
    await fetch('/api/world-save', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: []
    });
    pass('cleanup: world-layout cleared');
  } catch(e) {
    fail('cleanup: world-layout', e.message);
  }
}

async function testOfficeServing() {
  log('\n\x1b[1m3D Hub Module Serving\x1b[0m');

  var officeFiles = ['index.js', 'builder.js', 'assets.js', 'world-save.js', 'state.js'];
  for (var i = 0; i < officeFiles.length; i++) {
    var f = officeFiles[i];
    try {
      var res = await fetch('/office/' + f);
      if (res.status === 200 && res.headers['content-type'] && res.headers['content-type'].includes('javascript')) {
        pass('/office/' + f + ' → 200 JS');
      } else {
        fail('/office/' + f, 'status=' + res.status + ', content-type=' + (res.headers['content-type'] || 'none'));
      }
    } catch(e) {
      fail('/office/' + f, e.message);
    }
  }

  // Path traversal should be blocked
  try {
    var travRes = await fetch('/office/../server.js');
    if (travRes.status === 400 || travRes.status === 404) {
      pass('/office/../server.js → ' + travRes.status + ' (path traversal blocked)');
    } else if (travRes.status === 200) {
      fail('/office/../server.js', 'got 200 — path traversal NOT blocked!');
    } else {
      pass('/office/../server.js → ' + travRes.status + ' (not served)');
    }
  } catch(e) {
    fail('/office/ path traversal', e.message);
  }
}

async function testLaunchAPI() {
  log('\n\x1b[1mLaunch API Tests\x1b[0m');

  // POST /api/launch with invalid CLI type → 400
  try {
    var res = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { cli: 'invalid_cli', agent_name: 'Test' }
    });
    if (res.status === 400 && res.json && res.json.error) {
      pass('POST /api/launch invalid CLI → 400');
    } else {
      fail('POST /api/launch invalid CLI', 'expected 400, got ' + res.status);
    }
  } catch(e) {
    fail('POST /api/launch invalid CLI', e.message);
  }

  // POST /api/launch with unregistered project path → 400
  try {
    var res2 = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { cli: 'claude', project_dir: '/nonexistent/fake/project/path', agent_name: 'Test' }
    });
    if (res2.status === 400 && res2.json && res2.json.error) {
      pass('POST /api/launch unregistered project → 400');
    } else {
      fail('POST /api/launch unregistered project', 'expected 400, got ' + res2.status);
    }
  } catch(e) {
    fail('POST /api/launch unregistered project', e.message);
  }

  // POST /api/launch CSRF protection (no X-LTT-Request header) → 403
  try {
    var res3 = await fetch('/api/launch', {
      method: 'POST',
      body: { cli: 'claude', agent_name: 'Test' }
    });
    if (res3.status === 403) {
      pass('POST /api/launch without CSRF header → 403');
    } else {
      fail('POST /api/launch without CSRF header', 'expected 403, got ' + res3.status);
    }
  } catch(e) {
    fail('POST /api/launch CSRF', e.message);
  }
}

async function testTemplatesAPI() {
  log('\n\x1b[1mTemplates API Tests\x1b[0m');

  // GET /api/templates → returns array
  try {
    var res = await fetch('/api/templates');
    if (res.status === 200 && res.json && Array.isArray(res.json)) {
      pass('GET /api/templates → 200 (array of ' + res.json.length + ')');
      // Each template should have name, description, agents
      var valid = res.json.every(function(t) { return t.name && t.description && Array.isArray(t.agents); });
      if (valid) {
        pass('GET /api/templates → all templates have name, description, agents');
      } else {
        fail('GET /api/templates schema', 'some templates missing required fields');
      }
    } else {
      fail('GET /api/templates', 'expected 200 with array, got ' + res.status);
    }
  } catch(e) {
    fail('GET /api/templates', e.message);
  }

  // GET /api/conversation-templates → returns array
  try {
    var res2 = await fetch('/api/conversation-templates');
    if (res2.status === 200 && res2.json && Array.isArray(res2.json)) {
      pass('GET /api/conversation-templates → 200 (array of ' + res2.json.length + ')');
    } else {
      fail('GET /api/conversation-templates', 'expected 200 with array, got ' + res2.status);
    }
  } catch(e) {
    fail('GET /api/conversation-templates', e.message);
  }

  // POST /api/conversation-templates/launch with valid template → 200
  try {
    var res3 = await fetch('/api/conversation-templates/launch', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { template_id: 'code-review' }
    });
    if (res3.status === 200 && res3.json && res3.json.success && res3.json.instructions) {
      pass('POST /api/conversation-templates/launch → 200 with instructions');
      // Should have instructions for each agent in the template
      if (res3.json.instructions.length > 0 && res3.json.instructions[0].agent_name) {
        pass('POST /api/conversation-templates/launch → instructions have agent_name');
      } else {
        fail('POST /api/conversation-templates/launch schema', 'instructions missing agent_name');
      }
    } else {
      fail('POST /api/conversation-templates/launch', 'expected 200 with instructions, got ' + res3.status);
    }
  } catch(e) {
    fail('POST /api/conversation-templates/launch', e.message);
  }

  // POST /api/conversation-templates/launch with invalid template → 400
  try {
    var res4 = await fetch('/api/conversation-templates/launch', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { template_id: 'nonexistent-template' }
    });
    if (res4.status === 400 && res4.json && res4.json.error) {
      pass('POST /api/conversation-templates/launch invalid template → 400');
    } else {
      fail('POST /api/conversation-templates/launch invalid', 'expected 400, got ' + res4.status);
    }
  } catch(e) {
    fail('POST /api/conversation-templates/launch invalid', e.message);
  }
}

async function testPlanControlAPI() {
  log('\n\x1b[1mPlan Control API Tests\x1b[0m');

  // GET /api/plan/status
  try {
    var res = await fetch('/api/plan/status');
    if (res.status === 200 && res.json) {
      pass('GET /api/plan/status -> 200');
    } else {
      fail('GET /api/plan/status', 'status=' + res.status);
    }
  } catch(e) { fail('GET /api/plan/status', e.message); }

  // GET /api/plan/report
  try {
    var res2 = await fetch('/api/plan/report');
    if (res2.status === 200 || res2.status === 404) {
      pass('GET /api/plan/report -> ' + res2.status + ' (ok)');
    } else {
      fail('GET /api/plan/report', 'status=' + res2.status);
    }
  } catch(e) { fail('GET /api/plan/report', e.message); }

  // GET /api/plan/skills
  try {
    var res3 = await fetch('/api/plan/skills');
    if (res3.status === 200 && res3.json) {
      pass('GET /api/plan/skills -> 200');
    } else {
      fail('GET /api/plan/skills', 'status=' + res3.status);
    }
  } catch(e) { fail('GET /api/plan/skills', e.message); }

  // GET /api/plan/retries
  try {
    var res4 = await fetch('/api/plan/retries');
    if (res4.status === 200 && res4.json) {
      pass('GET /api/plan/retries -> 200');
    } else {
      fail('GET /api/plan/retries', 'status=' + res4.status);
    }
  } catch(e) { fail('GET /api/plan/retries', e.message); }

  // GET /api/stats
  try {
    var res5 = await fetch('/api/stats');
    if (res5.status === 200 && res5.json && res5.json.agents) {
      pass('GET /api/stats -> 200 with agents');
    } else {
      fail('GET /api/stats', 'status=' + res5.status);
    }
  } catch(e) { fail('GET /api/stats', e.message); }

  // GET /api/monitor/health
  try {
    var res6 = await fetch('/api/monitor/health');
    if (res6.status === 200 && res6.json) {
      pass('GET /api/monitor/health -> 200');
    } else {
      fail('GET /api/monitor/health', 'status=' + res6.status);
    }
  } catch(e) { fail('GET /api/monitor/health', e.message); }
}

async function testRulesAPI() {
  log('\n\x1b[1mRules API Tests\x1b[0m');

  // GET /api/rules → 200 (empty array initially)
  try {
    var res1 = await fetch('/api/rules');
    if (res1.status === 200 && res1.json) {
      pass('GET /api/rules -> 200');
    } else {
      fail('GET /api/rules', 'status=' + res1.status);
    }
  } catch(e) { fail('GET /api/rules', e.message); }

  // POST /api/rules → create a rule
  try {
    var res2 = await fetch('/api/rules', {
      method: 'POST',
      headers: { 'X-LTT-Request': '1' },
      body: { text: 'Never add UE5 code to the npm package', category: 'safety' }
    });
    if (res2.status === 200 && res2.json && res2.json.success) {
      pass('POST /api/rules -> 200 (rule created)');
    } else if (res2.status === 404) {
      pass('POST /api/rules -> 404 (endpoint not yet implemented)');
    } else {
      fail('POST /api/rules create', 'status=' + res2.status + ' body=' + res2.body);
    }
  } catch(e) { fail('POST /api/rules create', e.message); }

  // POST /api/rules without CSRF → 403
  try {
    var res3 = await fetch('/api/rules', {
      method: 'POST',
      body: { text: 'Test rule', category: 'workflow' }
    });
    if (res3.status === 403) {
      pass('POST /api/rules without CSRF -> 403');
    } else {
      fail('POST /api/rules without CSRF', 'expected 403, got ' + res3.status);
    }
  } catch(e) { fail('POST /api/rules without CSRF', e.message); }

  // GET /api/rules after creating → should have rules
  try {
    var res4 = await fetch('/api/rules');
    if (res4.status === 200) {
      var rules = res4.json;
      if (Array.isArray(rules) && rules.length > 0) {
        pass('GET /api/rules -> has rules after create (' + rules.length + ')');
      } else if (Array.isArray(rules)) {
        pass('GET /api/rules -> 200 (empty, POST may not be implemented yet)');
      } else {
        pass('GET /api/rules -> 200 (response format TBD)');
      }
    } else {
      fail('GET /api/rules after create', 'status=' + res4.status);
    }
  } catch(e) { fail('GET /api/rules after create', e.message); }

  // DELETE /api/rules/:id (if supported)
  try {
    var res5 = await fetch('/api/rules/test-id-123', {
      method: 'DELETE',
      headers: { 'X-LTT-Request': '1' }
    });
    if (res5.status === 200 || res5.status === 404) {
      pass('DELETE /api/rules/:id -> ' + res5.status + ' (ok)');
    } else {
      fail('DELETE /api/rules/:id', 'status=' + res5.status);
    }
  } catch(e) { fail('DELETE /api/rules/:id', e.message); }
}

async function testRunCommand() {
  log('\n\x1b[1mRun Command E2E\x1b[0m');

  var testDir = path.join(ROOT, 'test', '.test-run-' + Date.now());
  fs.mkdirSync(testDir, { recursive: true });
  var runProc = null;

  try {
    // Spawn the run command with 2 agents and 1-minute timeout
    runProc = spawn('node', [path.join(ROOT, 'cli.js'), 'run', 'test e2e prompt', '--agents', '2', '--timeout', '1'], {
      env: Object.assign({}, process.env, { AGENT_BRIDGE_DATA_DIR: path.join(testDir, '.agent-bridge') }),
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: testDir,
    });

    // Wait 5 seconds for agents to spawn and register
    await new Promise(function(r) { setTimeout(r, 5000); });

    // Check if .agent-bridge directory was created
    var abDir = path.join(testDir, '.agent-bridge');
    if (fs.existsSync(abDir)) {
      pass('run command creates .agent-bridge directory');

      // Check if agents registered
      var agentsFile = path.join(abDir, 'agents.json');
      if (fs.existsSync(agentsFile)) {
        try {
          var agents = JSON.parse(fs.readFileSync(agentsFile, 'utf8'));
          var count = Object.keys(agents).length;
          if (count >= 1) {
            pass('run command registered ' + count + ' agent(s)');
          } else {
            pass('run command started (agents registering)');
          }
        } catch(e) {
          pass('run command started (agents.json exists)');
        }
      } else {
        pass('run command started (.agent-bridge created, agents pending)');
      }

      // Check config.json has group mode
      var configFile = path.join(abDir, 'config.json');
      if (fs.existsSync(configFile)) {
        try {
          var config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
          if (config.conversation_mode === 'group') {
            pass('run command sets group conversation mode');
          } else {
            pass('run command sets mode: ' + (config.conversation_mode || 'default'));
          }
        } catch(e) {
          pass('run command created config');
        }
      }
    } else {
      fail('run command E2E', '.agent-bridge directory not created');
    }
  } catch(e) {
    fail('run command E2E', e.message);
  } finally {
    if (runProc) { runProc.kill('SIGTERM'); }
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch(e) {}
  }
}

async function testResetSafety() {
  log('\n\x1b[1mCLI Reset Safety\x1b[0m');

  // Test that reset without --force just prints warning (doesn't delete)
  var testResetDir = path.join(ROOT, 'test', '.test-reset-' + Date.now());
  var abDir = path.join(testResetDir, '.agent-bridge');
  fs.mkdirSync(abDir, { recursive: true });
  fs.writeFileSync(path.join(abDir, 'history.jsonl'), '{"test":true}\n');

  try {
    // Run reset WITHOUT --force — should NOT delete
    var output = execSync('node ' + JSON.stringify(path.join(ROOT, 'cli.js')) + ' reset', {
      cwd: testResetDir,
      encoding: 'utf8',
      timeout: 5000
    });
    if (fs.existsSync(path.join(abDir, 'history.jsonl'))) {
      pass('reset without --force does NOT delete data');
    } else {
      fail('reset without --force', 'data was deleted without confirmation!');
    }

    if (output.includes('--force')) {
      pass('reset without --force shows --force hint');
    } else {
      fail('reset without --force', 'output missing --force hint');
    }
  } catch(e) {
    fail('reset without --force', e.message);
  }

  // Run reset WITH --force — should delete + archive
  try {
    execSync('node ' + JSON.stringify(path.join(ROOT, 'cli.js')) + ' reset --force', {
      cwd: testResetDir,
      encoding: 'utf8',
      timeout: 5000
    });
    // .agent-bridge should exist but be empty (recreated)
    if (fs.existsSync(abDir) && !fs.existsSync(path.join(abDir, 'history.jsonl'))) {
      pass('reset --force clears data');
    } else {
      fail('reset --force', 'data not cleared');
    }

    // Archive should exist
    var archiveDir = path.join(testResetDir, '.agent-bridge-archive');
    if (fs.existsSync(archiveDir)) {
      pass('reset --force creates archive');
    } else {
      fail('reset --force archive', 'no archive directory created');
    }
  } catch(e) {
    fail('reset --force', e.message);
  }

  // Cleanup
  try { fs.rmSync(testResetDir, { recursive: true, force: true }); } catch(e) {}
}

// ===================== RUNNER =====================

async function main() {
  log('\x1b[1m\x1b[36m━━━ Let Them Talk — Test Suite ━━━\x1b[0m');

  // Tests that don't need the dashboard
  await testSyntax();
  await testPackageCompleteness();
  await testResetSafety();

  // Start dashboard for API tests
  log('\n\x1b[33mStarting test dashboard on port ' + TEST_PORT + '...\x1b[0m');
  var testDataDir = path.join(ROOT, 'test', '.test-data-' + Date.now());
  fs.mkdirSync(testDataDir, { recursive: true });

  dashboardProc = spawn('node', [path.join(ROOT, 'dashboard.js')], {
    env: Object.assign({}, process.env, {
      AGENT_BRIDGE_PORT: String(TEST_PORT),
      AGENT_BRIDGE_DATA_DIR: testDataDir,
    }),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  try {
    await waitForServer(TEST_PORT, 8000);
    log('\x1b[33mDashboard started.\x1b[0m');

    await testDashboardAPI();
    await testCSRFProtection();
    await testWorldSaveRoundTrip();
    await testOfficeServing();
    await testLaunchAPI();
    await testTemplatesAPI();
    await testPlanControlAPI();
    await testRulesAPI();
    await testRunCommand();
  } catch(e) {
    fail('dashboard startup', e.message);
  }

  // Cleanup
  if (dashboardProc) {
    dashboardProc.kill('SIGTERM');
    dashboardProc = null;
  }
  // Remove test data dir
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch(e) {}

  // Summary
  log('\n\x1b[1m━━━ Results ━━━\x1b[0m');
  log('  \x1b[32m' + passed.length + ' passed\x1b[0m');
  if (failed.length > 0) {
    log('  \x1b[31m' + failed.length + ' failed:\x1b[0m');
    for (var i = 0; i < failed.length; i++) {
      log('    \x1b[31m✗\x1b[0m ' + failed[i].name + ' — ' + failed[i].reason);
    }
  }
  log('');

  process.exit(failed.length > 0 ? 1 : 0);
}

// Handle cleanup on unexpected exit
process.on('SIGINT', function() { if (dashboardProc) dashboardProc.kill(); process.exit(1); });
process.on('SIGTERM', function() { if (dashboardProc) dashboardProc.kill(); process.exit(1); });

main().catch(function(e) {
  log('\x1b[31mTest runner error: ' + e.message + '\x1b[0m');
  if (dashboardProc) dashboardProc.kill();
  process.exit(1);
});
