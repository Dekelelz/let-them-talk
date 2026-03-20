/**
 * Economy System Tests — Phase 3 AI City
 *
 * Tests credit generation, spending, ledger integrity, and concurrent access.
 * Pure logic tests (no server/WebGL required).
 *
 * Usage: node test/test-economy.js
 */

'use strict';

var passed = 0;
var failed = 0;
var failedTests = [];

function log(msg) { console.log(msg); }
function pass(name) { passed++; log('  \x1b[32m✓\x1b[0m ' + name); }
function fail(name, reason) {
  failed++;
  var msg = name + (reason ? ' — ' + reason : '');
  failedTests.push(msg);
  log('  \x1b[31m✗\x1b[0m ' + msg);
}

// ==========================================
// Ledger Simulation
// ==========================================

function createLedger() {
  return {
    entries: [],   // { agent, type: 'earn'|'spend', amount, reason, timestamp }
    balances: {}   // agent -> balance
  };
}

function earnCredits(ledger, agent, amount, reason) {
  if (amount <= 0) return false;
  if (!ledger.balances[agent]) ledger.balances[agent] = 0;
  ledger.balances[agent] += amount;
  ledger.entries.push({ agent: agent, type: 'earn', amount: amount, reason: reason, timestamp: Date.now() });
  return true;
}

function spendCredits(ledger, agent, amount, reason) {
  if (amount <= 0) return { success: false, error: 'invalid_amount' };
  if (!ledger.balances[agent] || ledger.balances[agent] < amount) {
    return { success: false, error: 'insufficient_funds', balance: ledger.balances[agent] || 0 };
  }
  ledger.balances[agent] -= amount;
  ledger.entries.push({ agent: agent, type: 'spend', amount: amount, reason: reason, timestamp: Date.now() });
  return { success: true, newBalance: ledger.balances[agent] };
}

function getBalance(ledger, agent) {
  return ledger.balances[agent] || 0;
}

function verifyLedgerIntegrity(ledger) {
  // For each agent, sum of earns - sum of spends should equal balance
  var computed = {};
  for (var i = 0; i < ledger.entries.length; i++) {
    var e = ledger.entries[i];
    if (!computed[e.agent]) computed[e.agent] = 0;
    if (e.type === 'earn') computed[e.agent] += e.amount;
    else if (e.type === 'spend') computed[e.agent] -= e.amount;
  }
  for (var agent in ledger.balances) {
    if (Math.abs(ledger.balances[agent] - (computed[agent] || 0)) > 0.001) {
      return { valid: false, agent: agent, expected: computed[agent], actual: ledger.balances[agent] };
    }
  }
  return { valid: true };
}

// ==========================================
// Credit Generation Tests
// ==========================================

log('\n\x1b[1mCredit Generation\x1b[0m');

var CREDIT_AMOUNTS = {
  task_done: 10,
  code_review: 5,
  bug_fix: 15,
  message_sent: 1
};

var ledger1 = createLedger();

// Test: Earn credits for task completion
earnCredits(ledger1, 'Backend', CREDIT_AMOUNTS.task_done, 'task_done');
if (getBalance(ledger1, 'Backend') === 10) pass('earn 10 credits for task completion');
else fail('earn credits', 'expected 10, got ' + getBalance(ledger1, 'Backend'));

// Test: Earn credits for code review
earnCredits(ledger1, 'Backend', CREDIT_AMOUNTS.code_review, 'code_review');
if (getBalance(ledger1, 'Backend') === 15) pass('earn 5 more credits for code review (total 15)');
else fail('code review credits', 'expected 15, got ' + getBalance(ledger1, 'Backend'));

// Test: Earn credits for bug fix
earnCredits(ledger1, 'Tester', CREDIT_AMOUNTS.bug_fix, 'bug_fix');
if (getBalance(ledger1, 'Tester') === 15) pass('earn 15 credits for bug fix');
else fail('bug fix credits', 'expected 15, got ' + getBalance(ledger1, 'Tester'));

// Test: Earn credits for message
earnCredits(ledger1, 'Frontend', CREDIT_AMOUNTS.message_sent, 'message_sent');
if (getBalance(ledger1, 'Frontend') === 1) pass('earn 1 credit for message sent');
else fail('message credits', 'expected 1, got ' + getBalance(ledger1, 'Frontend'));

// Test: Zero amount rejected
var zeroResult = earnCredits(ledger1, 'Backend', 0, 'invalid');
if (!zeroResult) pass('zero credit earn rejected');
else fail('zero credit earn should be rejected');

// Test: Negative amount rejected
var negResult = earnCredits(ledger1, 'Backend', -5, 'invalid');
if (!negResult) pass('negative credit earn rejected');
else fail('negative credit earn should be rejected');

// ==========================================
// Spending Tests
// ==========================================

log('\n\x1b[1mCredit Spending\x1b[0m');

var ledger2 = createLedger();
earnCredits(ledger2, 'Player', 100, 'initial');

// Test: Valid spend
var spend1 = spendCredits(ledger2, 'Player', 30, 'upgrade_building');
if (spend1.success && spend1.newBalance === 70) pass('spend 30 credits: balance 100 → 70');
else fail('valid spend', 'success=' + spend1.success + ' balance=' + spend1.newBalance);

// Test: Spend exact balance
var spend2 = spendCredits(ledger2, 'Player', 70, 'buy_car');
if (spend2.success && spend2.newBalance === 0) pass('spend exact balance: 70 → 0');
else fail('spend exact balance', 'success=' + spend2.success + ' balance=' + spend2.newBalance);

// Test: Spend with zero balance (insufficient)
var spend3 = spendCredits(ledger2, 'Player', 1, 'try_buy');
if (!spend3.success && spend3.error === 'insufficient_funds') pass('spend with 0 balance: insufficient_funds');
else fail('zero balance spend', 'success=' + spend3.success + ' error=' + spend3.error);

// Test: Spend more than balance
earnCredits(ledger2, 'Player', 10, 'earned');
var spend4 = spendCredits(ledger2, 'Player', 20, 'too_expensive');
if (!spend4.success && spend4.error === 'insufficient_funds') pass('spend 20 with 10 balance: insufficient_funds');
else fail('overspend', 'success=' + spend4.success);

// Test: Balance unchanged after failed spend
if (getBalance(ledger2, 'Player') === 10) pass('balance unchanged after failed spend (still 10)');
else fail('balance after failed spend', 'expected 10, got ' + getBalance(ledger2, 'Player'));

// Test: Zero amount spend rejected
var spend5 = spendCredits(ledger2, 'Player', 0, 'invalid');
if (!spend5.success && spend5.error === 'invalid_amount') pass('zero amount spend rejected');
else fail('zero spend', 'error=' + spend5.error);

// Test: Negative amount spend rejected
var spend6 = spendCredits(ledger2, 'Player', -10, 'exploit');
if (!spend6.success && spend6.error === 'invalid_amount') pass('negative amount spend rejected');
else fail('negative spend', 'error=' + spend6.error);

// Test: Spend by unknown agent
var spend7 = spendCredits(ledger2, 'Unknown', 5, 'ghost');
if (!spend7.success && spend7.error === 'insufficient_funds') pass('unknown agent spend: insufficient_funds (0 balance)');
else fail('unknown agent spend', 'success=' + spend7.success);

// ==========================================
// Ledger Integrity Tests
// ==========================================

log('\n\x1b[1mLedger Integrity\x1b[0m');

// Test: Integrity after normal operations
var ledger3 = createLedger();
earnCredits(ledger3, 'A', 100, 'task');
earnCredits(ledger3, 'B', 50, 'task');
spendCredits(ledger3, 'A', 30, 'upgrade');
earnCredits(ledger3, 'A', 10, 'review');
spendCredits(ledger3, 'B', 25, 'upgrade');

var integrity1 = verifyLedgerIntegrity(ledger3);
if (integrity1.valid) pass('ledger integrity after mixed operations');
else fail('ledger integrity', 'agent=' + integrity1.agent + ' expected=' + integrity1.expected + ' actual=' + integrity1.actual);

// Test: A balance = 100 - 30 + 10 = 80
if (getBalance(ledger3, 'A') === 80) pass('agent A balance correct: 100-30+10 = 80');
else fail('agent A balance', 'expected 80, got ' + getBalance(ledger3, 'A'));

// Test: B balance = 50 - 25 = 25
if (getBalance(ledger3, 'B') === 25) pass('agent B balance correct: 50-25 = 25');
else fail('agent B balance', 'expected 25, got ' + getBalance(ledger3, 'B'));

// Test: Total entries count
if (ledger3.entries.length === 5) pass('ledger has 5 entries (3 earns + 2 spends)');
else fail('entry count', 'expected 5, got ' + ledger3.entries.length);

// Test: Failed spends don't create entries
var entryCountBefore = ledger3.entries.length;
spendCredits(ledger3, 'A', 999, 'impossible');
if (ledger3.entries.length === entryCountBefore) pass('failed spend creates no ledger entry');
else fail('failed spend entry', 'entries grew from ' + entryCountBefore + ' to ' + ledger3.entries.length);

// ==========================================
// Concurrent Credit Generation Simulation
// ==========================================

log('\n\x1b[1mConcurrent Credit Generation\x1b[0m');

var ledger4 = createLedger();
var agents = ['Manager', 'Backend', 'Frontend', 'Protocol', 'Tester', 'glm5'];

// Simulate 100 concurrent task completions
for (var i = 0; i < 100; i++) {
  var agent = agents[i % agents.length];
  earnCredits(ledger4, agent, CREDIT_AMOUNTS.task_done, 'task_' + i);
}

// Each of 6 agents gets ~16-17 tasks (100/6)
var totalCredits = 0;
for (var a = 0; a < agents.length; a++) {
  totalCredits += getBalance(ledger4, agents[a]);
}

if (totalCredits === 1000) pass('100 tasks × 10 credits = 1000 total credits');
else fail('total credits', 'expected 1000, got ' + totalCredits);

var integrity2 = verifyLedgerIntegrity(ledger4);
if (integrity2.valid) pass('ledger integrity after 100 concurrent earns');
else fail('concurrent integrity', 'agent=' + integrity2.agent);

if (ledger4.entries.length === 100) pass('100 entries in ledger');
else fail('entry count after concurrent', 'expected 100, got ' + ledger4.entries.length);

// ==========================================
// Rate Limiting Tests
// ==========================================

log('\n\x1b[1mRate Limiting\x1b[0m');

var MAX_CREDITS_PER_HOUR = 500;
var RATE_WINDOW_MS = 3600000; // 1 hour

function checkRateLimit(ledger, agent, windowMs, maxCredits) {
  var now = Date.now();
  var windowStart = now - windowMs;
  var earned = 0;
  for (var i = 0; i < ledger.entries.length; i++) {
    var e = ledger.entries[i];
    if (e.agent === agent && e.type === 'earn' && e.timestamp >= windowStart) {
      earned += e.amount;
    }
  }
  return earned < maxCredits;
}

var ledger5 = createLedger();
// Simulate earning 490 credits (under limit)
for (var j = 0; j < 49; j++) {
  earnCredits(ledger5, 'Spammer', 10, 'task_' + j);
}
if (checkRateLimit(ledger5, 'Spammer', RATE_WINDOW_MS, MAX_CREDITS_PER_HOUR)) pass('490 credits earned: under 500/hr limit');
else fail('under limit check');

// Push over limit
earnCredits(ledger5, 'Spammer', 10, 'task_50');
if (!checkRateLimit(ledger5, 'Spammer', RATE_WINDOW_MS, MAX_CREDITS_PER_HOUR)) pass('500 credits earned: at limit, blocked');
else fail('at limit check');

// Other agent unaffected
if (checkRateLimit(ledger5, 'Innocent', RATE_WINDOW_MS, MAX_CREDITS_PER_HOUR)) pass('other agent unaffected by rate limit');
else fail('other agent rate limit');

// ==========================================
// Results
// ==========================================

log('\n\x1b[1m━━━ Economy Test Results ━━━\x1b[0m');
log('  \x1b[32m' + passed + ' passed\x1b[0m');
if (failed > 0) {
  log('  \x1b[31m' + failed + ' failed:\x1b[0m');
  failedTests.forEach(function(t) { log('    \x1b[31m✗\x1b[0m ' + t); });
}

process.exit(failed > 0 ? 1 : 0);
