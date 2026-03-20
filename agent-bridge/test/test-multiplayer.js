/**
 * Multiplayer Security & Sync Tests — Phase 5 AI City
 *
 * Tests auth, position sync, disconnect handling, anti-cheat, and limits.
 * Pure logic tests (no WebSocket server required).
 *
 * Usage: node test/test-multiplayer.js
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
// Auth Token Validation
// ==========================================

log('\n\x1b[1mAuth Token Validation\x1b[0m');

var VALID_TOKEN = 'b9168ef11e45099e7564d94813159b37';
var WHITELIST = ['192.168.1.10', '192.168.1.20', '127.0.0.1'];

function validateAuth(token, ip, whitelist) {
  if (!token || typeof token !== 'string') return { allowed: false, reason: 'missing_token' };
  if (token.length < 16) return { allowed: false, reason: 'invalid_token' };
  if (token !== VALID_TOKEN) return { allowed: false, reason: 'wrong_token' };
  if (whitelist && whitelist.length > 0 && whitelist.indexOf(ip) === -1) {
    return { allowed: false, reason: 'ip_not_whitelisted' };
  }
  return { allowed: true };
}

// Test: Valid token + whitelisted IP
var auth1 = validateAuth(VALID_TOKEN, '192.168.1.10', WHITELIST);
if (auth1.allowed) pass('valid token + whitelisted IP: allowed');
else fail('valid auth', 'reason=' + auth1.reason);

// Test: Missing token
var auth2 = validateAuth(null, '192.168.1.10', WHITELIST);
if (!auth2.allowed && auth2.reason === 'missing_token') pass('null token: rejected (missing_token)');
else fail('null token');

// Test: Empty string token
var auth3 = validateAuth('', '192.168.1.10', WHITELIST);
if (!auth3.allowed && auth3.reason === 'missing_token') pass('empty token: rejected (missing_token)');
else fail('empty token');

// Test: Short token
var auth4 = validateAuth('abc', '192.168.1.10', WHITELIST);
if (!auth4.allowed && auth4.reason === 'invalid_token') pass('short token: rejected (invalid_token)');
else fail('short token');

// Test: Wrong token
var auth5 = validateAuth('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '192.168.1.10', WHITELIST);
if (!auth5.allowed && auth5.reason === 'wrong_token') pass('wrong token: rejected (wrong_token)');
else fail('wrong token');

// Test: Valid token but IP not whitelisted
var auth6 = validateAuth(VALID_TOKEN, '10.0.0.99', WHITELIST);
if (!auth6.allowed && auth6.reason === 'ip_not_whitelisted') pass('valid token + non-whitelisted IP: rejected');
else fail('non-whitelisted IP');

// Test: No whitelist (open mode)
var auth7 = validateAuth(VALID_TOKEN, '10.0.0.99', []);
if (auth7.allowed) pass('valid token + empty whitelist (open mode): allowed');
else fail('open mode');

// Test: Localhost always works
var auth8 = validateAuth(VALID_TOKEN, '127.0.0.1', WHITELIST);
if (auth8.allowed) pass('localhost whitelisted: allowed');
else fail('localhost');

// ==========================================
// Position Validation (Anti-Cheat)
// ==========================================

log('\n\x1b[1mPosition Validation (Anti-Cheat)\x1b[0m');

var MAX_SPEED = 60; // units/sec
var MAX_POSITION = 200; // city boundary
var TICK_RATE = 50; // ms between ticks (20Hz)

function validatePosition(newPos, oldPos, dtMs) {
  // Boundary check
  if (Math.abs(newPos.x) > MAX_POSITION || Math.abs(newPos.z) > MAX_POSITION) {
    return { valid: false, reason: 'out_of_bounds' };
  }

  // Speed check
  if (oldPos) {
    var dx = newPos.x - oldPos.x;
    var dz = newPos.z - oldPos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    var dtSec = dtMs / 1000;
    var speed = dist / dtSec;
    if (speed > MAX_SPEED * 1.5) { // 1.5x tolerance for lag
      return { valid: false, reason: 'speed_hack', speed: Math.round(speed), maxAllowed: MAX_SPEED * 1.5 };
    }
  }

  return { valid: true };
}

// Test: Valid position within bounds
var pos1 = validatePosition({ x: 50, z: 30 }, null, TICK_RATE);
if (pos1.valid) pass('position within bounds: valid');
else fail('bounds check', pos1.reason);

// Test: Out of bounds
var pos2 = validatePosition({ x: 250, z: 0 }, null, TICK_RATE);
if (!pos2.valid && pos2.reason === 'out_of_bounds') pass('position x=250: out_of_bounds');
else fail('out of bounds');

// Test: Negative out of bounds
var pos3 = validatePosition({ x: 0, z: -210 }, null, TICK_RATE);
if (!pos3.valid && pos3.reason === 'out_of_bounds') pass('position z=-210: out_of_bounds');
else fail('negative bounds');

// Test: Normal movement (walking speed)
var pos4 = validatePosition({ x: 10, z: 0 }, { x: 9.5, z: 0 }, TICK_RATE);
if (pos4.valid) pass('normal walk speed (10 u/s): valid');
else fail('walk speed', pos4.reason);

// Test: Car speed (within limit)
var pos5 = validatePosition({ x: 13, z: 0 }, { x: 10, z: 0 }, TICK_RATE);
if (pos5.valid) pass('car speed 60 u/s: valid');
else fail('car speed', pos5.reason);

// Test: Teleport hack (instant move 100 units)
var pos6 = validatePosition({ x: 100, z: 0 }, { x: 0, z: 0 }, TICK_RATE);
if (!pos6.valid && pos6.reason === 'speed_hack') pass('teleport 100u in 50ms: speed_hack detected (speed=' + pos6.speed + ')');
else fail('teleport hack');

// Test: Subtle speed hack (just over limit)
var overSpeed = (MAX_SPEED * 1.5 + 10) * (TICK_RATE / 1000); // move just over 1.5x max
var pos7 = validatePosition({ x: overSpeed, z: 0 }, { x: 0, z: 0 }, TICK_RATE);
if (!pos7.valid && pos7.reason === 'speed_hack') pass('subtle speed hack (1.5x+ max): detected');
else fail('subtle speed hack');

// ==========================================
// Player Session Management
// ==========================================

log('\n\x1b[1mPlayer Session Management\x1b[0m');

var MAX_PLAYERS = 10;

function createServer() {
  return { players: {}, playerCount: 0 };
}

function playerJoin(server, id, token, ip) {
  if (server.playerCount >= MAX_PLAYERS) return { success: false, reason: 'server_full' };
  var auth = validateAuth(token, ip, WHITELIST);
  if (!auth.allowed) return { success: false, reason: auth.reason };
  server.players[id] = { id: id, ip: ip, position: { x: 0, z: 0 }, joinedAt: Date.now(), lastSeen: Date.now() };
  server.playerCount++;
  return { success: true, playerId: id };
}

function playerLeave(server, id) {
  if (!server.players[id]) return false;
  delete server.players[id];
  server.playerCount--;
  return true;
}

function isPlayerConnected(server, id) {
  return !!server.players[id];
}

var server = createServer();

// Test: Player join with valid auth
var join1 = playerJoin(server, 'player1', VALID_TOKEN, '192.168.1.10');
if (join1.success) pass('player1 joins: success');
else fail('player1 join', join1.reason);

// Test: Player is connected
if (isPlayerConnected(server, 'player1')) pass('player1 connected after join');
else fail('connected check');

// Test: Second player joins
var join2 = playerJoin(server, 'player2', VALID_TOKEN, '192.168.1.20');
if (join2.success && server.playerCount === 2) pass('player2 joins: count=2');
else fail('player2 join');

// Test: Join with bad token rejected
var join3 = playerJoin(server, 'hacker', 'badtoken1234567890', '192.168.1.10');
if (!join3.success && join3.reason === 'wrong_token') pass('bad token player rejected');
else fail('bad token join', join3.reason);

// Test: Player count unchanged after rejected join
if (server.playerCount === 2) pass('player count unchanged after rejected join (still 2)');
else fail('count after reject', 'got ' + server.playerCount);

// Test: Player disconnect
var left = playerLeave(server, 'player1');
if (left && server.playerCount === 1) pass('player1 disconnects: count=1');
else fail('disconnect');

// Test: Disconnected player no longer connected
if (!isPlayerConnected(server, 'player1')) pass('player1 not connected after disconnect');
else fail('disconnected check');

// Test: Max player limit
var testServer = createServer();
for (var i = 0; i < MAX_PLAYERS; i++) {
  playerJoin(testServer, 'p' + i, VALID_TOKEN, '127.0.0.1');
}
var joinFull = playerJoin(testServer, 'extra', VALID_TOKEN, '127.0.0.1');
if (!joinFull.success && joinFull.reason === 'server_full') pass('11th player rejected: server_full (max=' + MAX_PLAYERS + ')');
else fail('max players');

// Test: Player can rejoin after leaving
playerLeave(testServer, 'p0');
var rejoin = playerJoin(testServer, 'p0_new', VALID_TOKEN, '127.0.0.1');
if (rejoin.success) pass('player can rejoin after slot freed');
else fail('rejoin', rejoin.reason);

// ==========================================
// Position Sync (Two-Client Simulation)
// ==========================================

log('\n\x1b[1mTwo-Client Position Sync\x1b[0m');

function simulateSync(server, senderId, newPos, dtMs) {
  var player = server.players[senderId];
  if (!player) return { synced: false, reason: 'player_not_found' };

  var validation = validatePosition(newPos, player.position, dtMs);
  if (!validation.valid) return { synced: false, reason: validation.reason };

  player.position = newPos;
  player.lastSeen = Date.now();

  // Get positions visible to other players
  var positions = {};
  for (var id in server.players) {
    positions[id] = server.players[id].position;
  }
  return { synced: true, positions: positions };
}

var syncServer = createServer();
playerJoin(syncServer, 'alice', VALID_TOKEN, '127.0.0.1');
playerJoin(syncServer, 'bob', VALID_TOKEN, '127.0.0.1');

// Test: Alice moves, Bob sees her position (2u in 50ms = 40 u/s, under limit)
var sync1 = simulateSync(syncServer, 'alice', { x: 2, z: 1 }, TICK_RATE);
if (sync1.synced && sync1.positions.alice.x === 2 && sync1.positions.bob) pass('alice moves: bob sees her at (2,1)');
else fail('alice move sync', sync1.reason);

// Test: Bob moves, Alice sees his position
var sync2 = simulateSync(syncServer, 'bob', { x: -1, z: 3 }, TICK_RATE);
if (sync2.synced && sync2.positions.bob.x === -1) pass('bob moves: alice sees him at (-1,3)');
else fail('bob move sync', sync2.reason);

// Test: Both positions in sync result
if (sync2.positions.alice && sync2.positions.bob) pass('sync contains both player positions');
else fail('both positions');

// Test: Invalid move rejected, position unchanged
var oldAlicePos = syncServer.players.alice.position;
var sync3 = simulateSync(syncServer, 'alice', { x: 500, z: 0 }, TICK_RATE);
if (!sync3.synced && sync3.reason === 'out_of_bounds') pass('alice out-of-bounds move rejected');
else fail('invalid move rejection');

if (syncServer.players.alice.position === oldAlicePos) pass('alice position unchanged after rejected move');
else fail('position unchanged');

// ==========================================
// Disconnect Timeout
// ==========================================

log('\n\x1b[1mDisconnect Timeout\x1b[0m');

var DISCONNECT_TIMEOUT_MS = 10000; // 10 seconds

function checkTimeouts(server, now) {
  var disconnected = [];
  for (var id in server.players) {
    if (now - server.players[id].lastSeen > DISCONNECT_TIMEOUT_MS) {
      disconnected.push(id);
    }
  }
  return disconnected;
}

var timeoutServer = createServer();
playerJoin(timeoutServer, 'active', VALID_TOKEN, '127.0.0.1');
playerJoin(timeoutServer, 'stale', VALID_TOKEN, '127.0.0.1');
timeoutServer.players.stale.lastSeen = Date.now() - 15000; // 15s ago

var timedOut = checkTimeouts(timeoutServer, Date.now());
if (timedOut.length === 1 && timedOut[0] === 'stale') pass('stale player detected after 15s (timeout=10s)');
else fail('timeout detection', 'got ' + JSON.stringify(timedOut));

var activeOnly = checkTimeouts(timeoutServer, Date.now());
if (activeOnly.indexOf('active') === -1) pass('active player not timed out');
else fail('active timeout');

// ==========================================
// Results
// ==========================================

log('\n\x1b[1m━━━ Multiplayer Test Results ━━━\x1b[0m');
log('  \x1b[32m' + passed + ' passed\x1b[0m');
if (failed > 0) {
  log('  \x1b[31m' + failed + ' failed:\x1b[0m');
  failedTests.forEach(function(t) { log('    \x1b[31m✗\x1b[0m ' + t); });
}

process.exit(failed > 0 ? 1 : 0);
