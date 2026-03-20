/**
 * Car HUD — In-vehicle dashboard overlay for AI City.
 * HTML overlay on top of the Three.js canvas.
 * Shows: speedometer, minimap, agent activity radio feed.
 * Target: zero impact on 120fps (pure HTML/CSS, no canvas rendering).
 */

let hudEl = null;
let radioInterval = null;
let visible = false;

const HUD_STYLES = `
  .car-hud {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 120px;
    pointer-events: none;
    z-index: 100;
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    padding: 0 20px 12px;
    background: linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 60%, transparent 100%);
    font-family: 'Segoe UI', sans-serif;
    color: #fff;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .car-hud.visible { opacity: 1; }

  .car-hud-speedo {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 100px;
  }
  .car-hud-speed-value {
    font-size: 36px;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-shadow: 0 0 8px rgba(212,175,55,0.6);
    color: #FFD700;
  }
  .car-hud-speed-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #aaa;
    margin-top: -2px;
  }
  .car-hud-gear {
    font-size: 14px;
    color: #D4AF37;
    margin-top: 4px;
  }

  .car-hud-radio {
    flex: 1;
    max-width: 400px;
    margin: 0 24px;
    overflow: hidden;
  }
  .car-hud-radio-title {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 2px;
    color: #D4AF37;
    margin-bottom: 4px;
  }
  .car-hud-radio-feed {
    font-size: 12px;
    line-height: 1.4;
    color: #ccc;
    max-height: 70px;
    overflow-y: hidden;
  }
  .car-hud-radio-item {
    padding: 2px 0;
    opacity: 0;
    animation: radioFadeIn 0.3s forwards;
  }
  .car-hud-radio-item .agent-name {
    color: #FFD700;
    font-weight: 600;
  }
  .car-hud-radio-item .action {
    color: #aaa;
  }

  .car-hud-minimap {
    width: 100px;
    height: 100px;
    border: 1px solid rgba(212,175,55,0.4);
    border-radius: 4px;
    background: rgba(0,0,0,0.5);
    position: relative;
    overflow: hidden;
  }
  .car-hud-minimap-dot {
    position: absolute;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #FFD700;
    transform: translate(-50%, -50%);
    box-shadow: 0 0 4px rgba(212,175,55,0.8);
  }
  .car-hud-minimap-dot.agent {
    width: 4px;
    height: 4px;
    background: #3fb950;
    box-shadow: 0 0 3px rgba(63,185,80,0.6);
  }
  .car-hud-minimap-dot.building {
    width: 8px;
    height: 8px;
    border-radius: 1px;
    background: rgba(255,255,255,0.15);
    box-shadow: none;
  }

  .car-hud-controls {
    position: fixed;
    bottom: 130px;
    left: 50%;
    transform: translateX(-50%);
    font-size: 11px;
    color: #888;
    text-align: center;
    pointer-events: none;
    z-index: 100;
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .car-hud-controls.visible { opacity: 1; }
  .car-hud-controls kbd {
    background: rgba(255,255,255,0.1);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 3px;
    padding: 1px 5px;
    font-family: monospace;
    color: #ccc;
  }

  @keyframes radioFadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

/**
 * Initialize the car HUD. Call once on page load.
 * Creates DOM elements but keeps them hidden until showHUD() is called.
 */
export function initCarHUD() {
  if (hudEl) return;

  // Inject styles
  const style = document.createElement('style');
  style.textContent = HUD_STYLES;
  document.head.appendChild(style);

  // Create HUD container
  hudEl = document.createElement('div');
  hudEl.className = 'car-hud';
  hudEl.innerHTML = `
    <div class="car-hud-speedo">
      <div class="car-hud-speed-value" id="car-speed">0</div>
      <div class="car-hud-speed-label">km/h</div>
      <div class="car-hud-gear" id="car-gear">P</div>
    </div>
    <div class="car-hud-radio">
      <div class="car-hud-radio-title">Agent Radio</div>
      <div class="car-hud-radio-feed" id="car-radio-feed"></div>
    </div>
    <div class="car-hud-minimap" id="car-minimap">
      <div class="car-hud-minimap-dot" id="car-minimap-player" style="left:50%;top:50%"></div>
    </div>
  `;
  document.body.appendChild(hudEl);

  // Controls hint
  const controls = document.createElement('div');
  controls.className = 'car-hud-controls';
  controls.id = 'car-hud-controls';
  controls.innerHTML = '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Drive &nbsp; <kbd>Space</kbd> Brake &nbsp; <kbd>E</kbd> Exit vehicle';
  document.body.appendChild(controls);
}

/**
 * Show the car HUD (when entering a vehicle).
 */
export function showHUD() {
  if (!hudEl) initCarHUD();
  hudEl.classList.add('visible');
  document.getElementById('car-hud-controls').classList.add('visible');
  visible = true;
  startRadioFeed();
}

/**
 * Hide the car HUD (when exiting a vehicle).
 */
export function hideHUD() {
  if (hudEl) hudEl.classList.remove('visible');
  const ctrl = document.getElementById('car-hud-controls');
  if (ctrl) ctrl.classList.remove('visible');
  visible = false;
  stopRadioFeed();
}

/**
 * Update speedometer display.
 * Call every frame from the vehicle update loop.
 * @param {number} speed - Current speed (units/sec)
 * @param {string} gear - Gear indicator ('D', 'R', 'P')
 */
export function updateSpeed(speed, gear) {
  if (!visible) return;
  const kmh = Math.round(speed * 3.6); // Convert units/s to km/h display
  const el = document.getElementById('car-speed');
  const gearEl = document.getElementById('car-gear');
  if (el) el.textContent = kmh;
  if (gearEl) gearEl.textContent = gear || 'D';
}

/**
 * Update minimap with player and agent positions.
 * Call at 1Hz (not every frame — DOM updates are expensive).
 * @param {Object} playerPos - { x, z } player world position
 * @param {Array<{ name: string, x: number, z: number, alive: boolean }>} agents - Agent positions
 * @param {Array<{ x: number, z: number, w: number, h: number }>} buildings - Building footprints
 * @param {number} mapScale - World units per minimap pixel (default 5)
 */
export function updateMinimap(playerPos, agents, buildings, mapScale) {
  if (!visible) return;
  const minimap = document.getElementById('car-minimap');
  if (!minimap) return;

  const scale = mapScale || 5;
  const mapW = 100;
  const mapH = 100;
  const cx = mapW / 2;
  const cy = mapH / 2;

  // Clear existing dots (except player)
  const existingDots = minimap.querySelectorAll('.agent, .building');
  existingDots.forEach(d => d.remove());

  // Buildings (static, relative to player)
  if (buildings) {
    for (const b of buildings) {
      const dx = (b.x - playerPos.x) / scale + cx;
      const dy = (b.z - playerPos.z) / scale + cy;
      if (dx < -5 || dx > mapW + 5 || dy < -5 || dy > mapH + 5) continue;
      const dot = document.createElement('div');
      dot.className = 'car-hud-minimap-dot building';
      dot.style.left = dx + 'px';
      dot.style.top = dy + 'px';
      minimap.appendChild(dot);
    }
  }

  // Agents
  if (agents) {
    for (const a of agents) {
      if (!a.alive) continue;
      const dx = (a.x - playerPos.x) / scale + cx;
      const dy = (a.z - playerPos.z) / scale + cy;
      if (dx < 0 || dx > mapW || dy < 0 || dy > mapH) continue;
      const dot = document.createElement('div');
      dot.className = 'car-hud-minimap-dot agent';
      dot.style.left = dx + 'px';
      dot.style.top = dy + 'px';
      dot.title = a.name;
      minimap.appendChild(dot);
    }
  }
}

/**
 * Add a radio feed item (agent activity announcement).
 * @param {string} agentName
 * @param {string} action - e.g. "completed task #12", "pushed code", "joined #general"
 */
export function addRadioItem(agentName, action) {
  if (!visible) return;
  const feed = document.getElementById('car-radio-feed');
  if (!feed) return;

  const item = document.createElement('div');
  item.className = 'car-hud-radio-item';
  item.innerHTML = '<span class="agent-name">' + escapeHtml(agentName) + '</span> <span class="action">' + escapeHtml(action) + '</span>';
  feed.insertBefore(item, feed.firstChild);

  // Keep max 5 items
  while (feed.children.length > 5) {
    feed.removeChild(feed.lastChild);
  }
}

/**
 * Start polling the radio feed API.
 */
function startRadioFeed() {
  if (radioInterval) return;
  fetchRadio(); // Initial fetch
  radioInterval = setInterval(fetchRadio, 5000); // Poll every 5s
}

/**
 * Stop polling the radio feed.
 */
function stopRadioFeed() {
  if (radioInterval) {
    clearInterval(radioInterval);
    radioInterval = null;
  }
}

/**
 * Fetch agent activity from the radio API.
 */
function fetchRadio() {
  fetch('/api/city/radio')
    .then(function(r) { return r.ok ? r.json() : null; })
    .then(function(data) {
      if (!data || !data.feed) return;
      const feedItems = data.feed;
      const feed = document.getElementById('car-radio-feed');
      if (!feed) return;
      // Only add new items
      for (let i = feedItems.length - 1; i >= 0; i--) {
        const item = feedItems[i];
        addRadioItem(item.from, item.preview || 'active');
      }
    })
    .catch(function() { /* silently fail — radio is non-critical */ });
}

/**
 * Check if the HUD is currently visible.
 * @returns {boolean}
 */
export function isHUDVisible() {
  return visible;
}

/**
 * Dispose the car HUD (cleanup).
 */
export function disposeCarHUD() {
  hideHUD();
  if (hudEl) {
    hudEl.remove();
    hudEl = null;
  }
  const ctrl = document.getElementById('car-hud-controls');
  if (ctrl) ctrl.remove();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
