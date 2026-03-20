import * as THREE from 'three';
import { S } from './state.js';
import { createCharacter } from './character.js';
import { resolveAppearance } from './appearance.js';

// ============================================================
// MULTIPLAYER CLIENT — WebSocket connection to city-server
// Phase 5: Sync players, render remote characters, auth
// Security: token-based auth, server-validated positions
// ============================================================

var ws = null;
var connected = false;
var playerId = null;
var remotePlayers = {};    // { id: { character, position, lastUpdate } }
var authToken = null;
var reconnectTimer = null;
var RECONNECT_DELAY = 3000;
var SEND_RATE = 50;        // send position every 50ms (20Hz)
var lastSendTime = 0;
var pingMs = 0;
var lastPingTime = 0;

// ============================================================
// CONNECTION
// ============================================================

export function connect(serverUrl, token) {
  if (ws && ws.readyState <= 1) return; // already connected/connecting

  authToken = token;

  try {
    ws = new WebSocket(serverUrl);
  } catch (e) {
    console.error('[net-client] WebSocket connect failed:', e.message);
    scheduleReconnect(serverUrl);
    return;
  }

  ws.onopen = function() {
    connected = true;
    // Authenticate immediately
    send({ type: 'auth', token: authToken });
    console.log('[net-client] Connected to city server');
    dispatchEvent('connected');
  };

  ws.onmessage = function(event) {
    try {
      var msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch (e) {
      console.warn('[net-client] Invalid message:', e.message);
    }
  };

  ws.onclose = function(event) {
    connected = false;
    playerId = null;
    console.log('[net-client] Disconnected:', event.code, event.reason);
    dispatchEvent('disconnected', { code: event.code, reason: event.reason });
    // Clean up remote players
    removeAllRemotePlayers();
    // Auto-reconnect unless intentional close
    if (event.code !== 1000) {
      scheduleReconnect(serverUrl);
    }
  };

  ws.onerror = function() {
    console.error('[net-client] WebSocket error');
  };
}

export function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close(1000, 'Client disconnect');
    ws = null;
  }
  connected = false;
  playerId = null;
  removeAllRemotePlayers();
}

function scheduleReconnect(serverUrl) {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(function() {
    reconnectTimer = null;
    console.log('[net-client] Attempting reconnect...');
    connect(serverUrl, authToken);
  }, RECONNECT_DELAY);
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ============================================================
// MESSAGE HANDLING
// ============================================================

function handleMessage(msg) {
  switch (msg.type) {
    case 'auth_ok':
      playerId = msg.playerId;
      console.log('[net-client] Authenticated as', playerId);
      dispatchEvent('authenticated', { playerId: playerId });
      break;

    case 'auth_fail':
      console.error('[net-client] Auth failed:', msg.reason);
      disconnect();
      dispatchEvent('auth_failed', { reason: msg.reason });
      break;

    case 'player_join':
      addRemotePlayer(msg.playerId, msg.appearance);
      dispatchEvent('player_join', { playerId: msg.playerId });
      break;

    case 'player_leave':
      removeRemotePlayer(msg.playerId);
      dispatchEvent('player_leave', { playerId: msg.playerId });
      break;

    case 'state':
      // Batch state update from server (positions of all players)
      if (msg.players) {
        msg.players.forEach(function(p) {
          if (p.id !== playerId) {
            updateRemotePlayer(p.id, p.x, p.y, p.z, p.rotY, p.appearance);
          }
        });
      }
      break;

    case 'pong':
      pingMs = Date.now() - lastPingTime;
      break;

    case 'chat':
      dispatchEvent('chat', { from: msg.from, text: msg.text });
      break;

    case 'kicked':
      console.warn('[net-client] Kicked:', msg.reason);
      disconnect();
      dispatchEvent('kicked', { reason: msg.reason });
      break;
  }
}

// ============================================================
// SEND POSITION — called from animation loop
// ============================================================

export function sendPosition(x, y, z, rotY) {
  if (!connected || !playerId) return;

  var now = Date.now();
  if (now - lastSendTime < SEND_RATE) return;
  lastSendTime = now;

  send({
    type: 'move',
    x: Math.round(x * 100) / 100,
    y: Math.round(y * 100) / 100,
    z: Math.round(z * 100) / 100,
    rotY: Math.round(rotY * 1000) / 1000
  });
}

export function sendPing() {
  if (!connected) return;
  lastPingTime = Date.now();
  send({ type: 'ping' });
}

export function sendChat(text) {
  if (!connected || !text) return;
  send({ type: 'chat', text: text.slice(0, 200) }); // cap at 200 chars
}

// ============================================================
// REMOTE PLAYER RENDERING
// ============================================================

function addRemotePlayer(id, appearance) {
  if (remotePlayers[id]) return;

  var app = resolveAppearance(appearance || {});
  var character = createCharacter(app);
  character.position.set(0, 0, 0);
  S.scene.add(character);

  remotePlayers[id] = {
    character: character,
    position: new THREE.Vector3(),
    targetPosition: new THREE.Vector3(),
    rotY: 0,
    targetRotY: 0,
    lastUpdate: Date.now()
  };
}

function updateRemotePlayer(id, x, y, z, rotY, appearance) {
  if (!remotePlayers[id]) {
    addRemotePlayer(id, appearance);
  }

  var rp = remotePlayers[id];
  rp.targetPosition.set(x, y, z);
  rp.targetRotY = rotY;
  rp.lastUpdate = Date.now();
}

function removeRemotePlayer(id) {
  var rp = remotePlayers[id];
  if (!rp) return;

  rp.character.traverse(function(child) {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(function(m) { m.dispose(); });
      else child.material.dispose();
    }
  });
  S.scene.remove(rp.character);
  delete remotePlayers[id];
}

function removeAllRemotePlayers() {
  for (var id in remotePlayers) {
    removeRemotePlayer(id);
  }
}

// ============================================================
// INTERPOLATION — smooth remote player movement
// ============================================================

export function updateNetClient(dt) {
  if (!connected) return;

  var LERP_SPEED = 0.15;
  var now = Date.now();

  for (var id in remotePlayers) {
    var rp = remotePlayers[id];

    // Remove stale players (no update in 10s)
    if (now - rp.lastUpdate > 10000) {
      removeRemotePlayer(id);
      continue;
    }

    // Interpolate position
    rp.position.lerp(rp.targetPosition, LERP_SPEED);
    rp.character.position.copy(rp.position);

    // Interpolate rotation
    rp.rotY += (rp.targetRotY - rp.rotY) * LERP_SPEED;
    rp.character.rotation.y = rp.rotY;
  }
}

// ============================================================
// EVENT SYSTEM
// ============================================================

function dispatchEvent(name, detail) {
  window.dispatchEvent(new CustomEvent('net-' + name, { detail: detail || {} }));
}

// ============================================================
// GETTERS
// ============================================================

export function isConnected() { return connected; }
export function getPlayerId() { return playerId; }
export function getPing() { return pingMs; }
export function getRemotePlayers() { return remotePlayers; }
export function getRemotePlayerCount() { return Object.keys(remotePlayers).length; }

// ============================================================
// CLEANUP
// ============================================================

export function disposeNetClient() {
  disconnect();
  remotePlayers = {};
}
