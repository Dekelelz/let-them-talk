/**
 * Multiplayer HUD — Connected players, ping, connection status, join dialog.
 * HTML overlay for Phase 5 multiplayer system.
 * Security-first: token-based auth, whitelist display.
 * Target: zero canvas impact (pure HTML/CSS).
 */

let hudEl = null;
let joinDialogEl = null;
let visible = false;
let connected = false;
let players = [];
let pingMs = 0;
let updateInterval = null;

const MP_STYLES = `
  .mp-hud {
    position: fixed;
    top: 60px;
    left: 12px;
    z-index: 100;
    pointer-events: auto;
    font-family: 'Segoe UI', sans-serif;
    opacity: 0;
    transition: opacity 0.3s ease;
    width: 200px;
  }
  .mp-hud.visible { opacity: 1; }

  .mp-status {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 12px;
    margin-bottom: 6px;
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .mp-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 8px;
    flex-shrink: 0;
  }
  .mp-status-dot.connected { background: #3fb950; box-shadow: 0 0 4px rgba(63,185,80,0.6); }
  .mp-status-dot.disconnected { background: #f85149; }
  .mp-status-dot.connecting { background: #d29922; animation: pulse 1s infinite; }
  .mp-status-label {
    font-size: 11px;
    color: #ccc;
    flex: 1;
  }
  .mp-ping {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: #888;
  }
  .mp-ping.good { color: #3fb950; }
  .mp-ping.medium { color: #d29922; }
  .mp-ping.bad { color: #f85149; }

  .mp-players {
    background: rgba(0,0,0,0.7);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    padding: 8px 12px;
    backdrop-filter: blur(6px);
    max-height: 200px;
    overflow-y: auto;
  }
  .mp-players-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 1px;
    color: #D4AF37;
    margin-bottom: 6px;
  }
  .mp-player {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 0;
    font-size: 12px;
    color: #ddd;
  }
  .mp-player-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .mp-player-you {
    font-size: 9px;
    color: #D4AF37;
    margin-left: 4px;
  }

  .mp-join-btn {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 6px;
    background: linear-gradient(135deg, #D4AF37, #B8860B);
    border: none;
    border-radius: 6px;
    color: #000;
    font-weight: 700;
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }
  .mp-join-btn:hover { filter: brightness(1.2); }
  .mp-join-btn.disconnect { background: linear-gradient(135deg, #f85149, #b33a3a); color: #fff; }

  .mp-join-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(20,20,20,0.95);
    border: 1px solid rgba(212,175,55,0.5);
    border-radius: 12px;
    padding: 24px;
    min-width: 320px;
    z-index: 200;
    pointer-events: auto;
    backdrop-filter: blur(12px);
    font-family: 'Segoe UI', sans-serif;
    color: #fff;
    display: none;
  }
  .mp-join-dialog.open { display: block; }
  .mp-join-dialog-title {
    font-size: 16px;
    font-weight: 700;
    color: #FFD700;
    margin-bottom: 16px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .mp-join-dialog-close {
    cursor: pointer;
    font-size: 18px;
    color: #888;
    background: none;
    border: none;
    padding: 4px 8px;
  }
  .mp-join-dialog-close:hover { color: #fff; }
  .mp-join-input {
    width: 100%;
    padding: 8px 12px;
    background: rgba(255,255,255,0.08);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    margin-bottom: 8px;
    box-sizing: border-box;
  }
  .mp-join-input::placeholder { color: #666; }
  .mp-join-input:focus { outline: none; border-color: #D4AF37; }
  .mp-join-hint {
    font-size: 11px;
    color: #888;
    margin-bottom: 12px;
  }
  .mp-lan-list {
    margin-bottom: 12px;
  }
  .mp-lan-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 8px;
    background: rgba(255,255,255,0.05);
    border-radius: 4px;
    margin-bottom: 4px;
    cursor: pointer;
  }
  .mp-lan-item:hover { background: rgba(212,175,55,0.15); }
  .mp-lan-name { font-size: 12px; color: #ddd; }
  .mp-lan-ip { font-size: 10px; color: #888; }
  .mp-connect-btn {
    width: 100%;
    padding: 8px;
    background: linear-gradient(135deg, #D4AF37, #B8860B);
    border: none;
    border-radius: 6px;
    color: #000;
    font-weight: 700;
    font-size: 13px;
    cursor: pointer;
  }
  .mp-connect-btn:hover { filter: brightness(1.2); }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
`;

/**
 * Initialize the multiplayer HUD. Call once.
 */
export function initMultiplayerHUD() {
  if (hudEl) return;

  const style = document.createElement('style');
  style.textContent = MP_STYLES;
  document.head.appendChild(style);

  hudEl = document.createElement('div');
  hudEl.className = 'mp-hud';
  hudEl.innerHTML = `
    <div class="mp-status">
      <div class="mp-status-dot disconnected" id="mp-status-dot"></div>
      <span class="mp-status-label" id="mp-status-label">Offline</span>
      <span class="mp-ping" id="mp-ping"></span>
    </div>
    <div class="mp-players" id="mp-players">
      <div class="mp-players-title">Players</div>
      <div id="mp-player-list">
        <div style="color:#666;font-size:11px">Not connected</div>
      </div>
    </div>
    <button class="mp-join-btn" id="mp-join-btn" onclick="window._mpJoinClick()">Join Server</button>
  `;
  document.body.appendChild(hudEl);

  // Join dialog
  joinDialogEl = document.createElement('div');
  joinDialogEl.className = 'mp-join-dialog';
  joinDialogEl.id = 'mp-join-dialog';
  joinDialogEl.innerHTML = `
    <div class="mp-join-dialog-title">
      <span>Join City Server</span>
      <button class="mp-join-dialog-close" id="mp-join-close">&times;</button>
    </div>
    <div class="mp-lan-list" id="mp-lan-list">
      <div style="color:#666;font-size:11px">Scanning LAN...</div>
    </div>
    <input class="mp-join-input" id="mp-join-ip" placeholder="Server IP (e.g. 192.168.1.100:3000)" />
    <div class="mp-join-hint">Enter server IP or select from LAN discovery above</div>
    <button class="mp-connect-btn" id="mp-connect-btn" onclick="window._mpConnect()">Connect</button>
  `;
  document.body.appendChild(joinDialogEl);

  document.getElementById('mp-join-close').addEventListener('click', closeJoinDialog);
}

/**
 * Show the multiplayer HUD.
 */
export function showMultiplayerHUD() {
  if (!hudEl) initMultiplayerHUD();
  hudEl.classList.add('visible');
  visible = true;
}

/**
 * Hide the multiplayer HUD.
 */
export function hideMultiplayerHUD() {
  if (hudEl) hudEl.classList.remove('visible');
  closeJoinDialog();
  visible = false;
}

/**
 * Update connection status display.
 * @param {'connected'|'disconnected'|'connecting'} status
 * @param {string} label - Status text
 */
export function setConnectionStatus(status, label) {
  connected = status === 'connected';
  const dot = document.getElementById('mp-status-dot');
  const lbl = document.getElementById('mp-status-label');
  const btn = document.getElementById('mp-join-btn');
  if (dot) {
    dot.className = 'mp-status-dot ' + status;
  }
  if (lbl) lbl.textContent = label || status;
  if (btn) {
    if (connected) {
      btn.textContent = 'Disconnect';
      btn.className = 'mp-join-btn disconnect';
    } else {
      btn.textContent = 'Join Server';
      btn.className = 'mp-join-btn';
    }
  }
}

/**
 * Update ping display.
 * @param {number} ms - Ping in milliseconds
 */
export function updatePing(ms) {
  pingMs = ms;
  const el = document.getElementById('mp-ping');
  if (!el) return;
  el.textContent = ms + 'ms';
  el.className = 'mp-ping ' + (ms < 50 ? 'good' : ms < 150 ? 'medium' : 'bad');
}

/**
 * Update the player list.
 * @param {Array<{ name: string, color: string, isYou: boolean }>} playerList
 */
export function updatePlayerList(playerList) {
  players = playerList;
  const list = document.getElementById('mp-player-list');
  if (!list) return;
  if (!playerList.length) {
    list.innerHTML = '<div style="color:#666;font-size:11px">No players connected</div>';
    return;
  }
  list.innerHTML = playerList.map(function(p) {
    return '<div class="mp-player">' +
      '<div class="mp-player-dot" style="background:' + escapeHtml(p.color || '#58a6ff') + '"></div>' +
      escapeHtml(p.name) +
      (p.isYou ? '<span class="mp-player-you">(you)</span>' : '') +
    '</div>';
  }).join('');
}

/**
 * Update LAN discovery results in join dialog.
 * @param {Array<{ name: string, ip: string, players: number }>} servers
 */
export function updateLANServers(servers) {
  const list = document.getElementById('mp-lan-list');
  if (!list) return;
  if (!servers.length) {
    list.innerHTML = '<div style="color:#666;font-size:11px">No LAN servers found</div>';
    return;
  }
  list.innerHTML = servers.map(function(s) {
    return '<div class="mp-lan-item" onclick="document.getElementById(\'mp-join-ip\').value=\'' + escapeHtml(s.ip) + '\'">' +
      '<span class="mp-lan-name">' + escapeHtml(s.name) + ' (' + s.players + ' players)</span>' +
      '<span class="mp-lan-ip">' + escapeHtml(s.ip) + '</span>' +
    '</div>';
  }).join('');
}

/**
 * Open the join dialog.
 */
export function openJoinDialog() {
  if (!joinDialogEl) return;
  joinDialogEl.classList.add('open');
  scanLAN();
}

/**
 * Close the join dialog.
 */
export function closeJoinDialog() {
  if (joinDialogEl) joinDialogEl.classList.remove('open');
}

// Button handlers
window._mpJoinClick = function() {
  if (connected) {
    if (window._mpDisconnect) window._mpDisconnect();
  } else {
    openJoinDialog();
  }
};

window._mpConnect = function() {
  const ip = document.getElementById('mp-join-ip');
  if (!ip || !ip.value.trim()) return;
  closeJoinDialog();
  setConnectionStatus('connecting', 'Connecting...');
  if (window._mpDoConnect) window._mpDoConnect(ip.value.trim());
};

function scanLAN() {
  fetch('/api/discover')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(servers) {
      if (Array.isArray(servers)) updateLANServers(servers);
    })
    .catch(function() {
      updateLANServers([]);
    });
}

/**
 * Get current player count.
 * @returns {number}
 */
export function getPlayerCount() {
  return players.length;
}

/**
 * Is currently connected to a server?
 * @returns {boolean}
 */
export function isConnected() {
  return connected;
}

/**
 * Dispose the multiplayer HUD.
 */
export function disposeMultiplayerHUD() {
  hideMultiplayerHUD();
  if (hudEl) { hudEl.remove(); hudEl = null; }
  if (joinDialogEl) { joinDialogEl.remove(); joinDialogEl = null; }
  delete window._mpJoinClick;
  delete window._mpConnect;
  delete window._mpDisconnect;
  delete window._mpDoConnect;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
