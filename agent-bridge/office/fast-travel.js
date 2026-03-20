/**
 * Fast Travel — Teleport between city districts.
 * HTML overlay menu triggered by T key or HUD button.
 * Moves player to district center with a brief transition effect.
 */

let menuEl = null;
let visible = false;
let onTeleport = null; // callback(districtName, x, z)

const DISTRICTS = [
  { name: 'Downtown',    icon: '\u{1F3D9}', desc: 'Business center — tall offices, active agents', x: 0, z: 0, color: '#4a90d9' },
  { name: 'Industrial',  icon: '\u{1F3ED}', desc: 'Factories — heavy compute, smoke effects', x: 80, z: 0, color: '#8a7755' },
  { name: 'Residential', icon: '\u{1F3E0}', desc: 'Quiet homes — agents rest here off-duty', x: 0, z: 80, color: '#cc9977' },
  { name: 'Campus',      icon: '\u{1F3EB}', desc: 'Research labs — agent training ground', x: -80, z: 0, color: '#55aa77' },
  { name: 'Commercial',  icon: '\u{1F6CD}', desc: 'Shops & cafes — upgrade store, social area', x: 0, z: -80, color: '#aa6688' },
];

const FT_STYLES = `
  .ft-menu {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(15,15,20,0.95);
    border: 1px solid rgba(212,175,55,0.5);
    border-radius: 14px;
    padding: 20px 24px;
    min-width: 340px;
    z-index: 200;
    pointer-events: auto;
    backdrop-filter: blur(14px);
    font-family: 'Segoe UI', sans-serif;
    color: #fff;
    display: none;
  }
  .ft-menu.open { display: block; }
  .ft-title {
    font-size: 16px;
    font-weight: 700;
    color: #FFD700;
    margin-bottom: 14px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .ft-close {
    cursor: pointer;
    font-size: 18px;
    color: #888;
    background: none;
    border: none;
    padding: 4px 8px;
  }
  .ft-close:hover { color: #fff; }
  .ft-hint {
    font-size: 10px;
    color: #888;
    margin-bottom: 12px;
  }
  .ft-district {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border-radius: 8px;
    cursor: pointer;
    margin-bottom: 4px;
    transition: background 0.15s ease;
  }
  .ft-district:hover { background: rgba(212,175,55,0.15); }
  .ft-district-icon {
    font-size: 24px;
    min-width: 32px;
    text-align: center;
  }
  .ft-district-info { flex: 1; }
  .ft-district-name {
    font-size: 14px;
    font-weight: 600;
    color: #eee;
  }
  .ft-district-desc {
    font-size: 11px;
    color: #888;
    margin-top: 2px;
  }
  .ft-district-badge {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .ft-flash {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    z-index: 250;
    pointer-events: none;
    animation: ftFlash 0.6s ease-out forwards;
  }
  @keyframes ftFlash {
    0% { opacity: 0.8; }
    100% { opacity: 0; }
  }
`;

/**
 * Initialize fast travel UI.
 * @param {Function} teleportCallback - Called with (districtName, x, z) when user selects a district
 */
export function initFastTravel(teleportCallback) {
  if (menuEl) return;
  onTeleport = teleportCallback;

  const style = document.createElement('style');
  style.textContent = FT_STYLES;
  document.head.appendChild(style);

  menuEl = document.createElement('div');
  menuEl.className = 'ft-menu';
  menuEl.innerHTML = `
    <div class="ft-title">
      <span>Fast Travel</span>
      <button class="ft-close" id="ft-close">&times;</button>
    </div>
    <div class="ft-hint">Press <kbd style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);border-radius:3px;padding:1px 5px;font-family:monospace;color:#ccc">T</kbd> to toggle &bull; Select a district to teleport</div>
    <div id="ft-list"></div>
  `;
  document.body.appendChild(menuEl);

  document.getElementById('ft-close').addEventListener('click', closeFastTravel);
  renderDistricts();
}

function renderDistricts() {
  const list = document.getElementById('ft-list');
  if (!list) return;
  list.innerHTML = DISTRICTS.map(function(d) {
    return '<div class="ft-district" onclick="window._ftTeleport(\'' + d.name + '\',' + d.x + ',' + d.z + ')">' +
      '<span class="ft-district-icon">' + d.icon + '</span>' +
      '<div class="ft-district-info">' +
        '<div class="ft-district-name">' + d.name + '</div>' +
        '<div class="ft-district-desc">' + d.desc + '</div>' +
      '</div>' +
      '<div class="ft-district-badge" style="background:' + d.color + '"></div>' +
    '</div>';
  }).join('');
}

window._ftTeleport = function(name, x, z) {
  closeFastTravel();
  showFlash();
  if (onTeleport) onTeleport(name, x, z);
};

function showFlash() {
  const flash = document.createElement('div');
  flash.className = 'ft-flash';
  document.body.appendChild(flash);
  setTimeout(function() { flash.remove(); }, 600);
}

/**
 * Open the fast travel menu.
 */
export function openFastTravel() {
  if (!menuEl) return;
  menuEl.classList.add('open');
  visible = true;
}

/**
 * Close the fast travel menu.
 */
export function closeFastTravel() {
  if (menuEl) menuEl.classList.remove('open');
  visible = false;
}

/**
 * Toggle the fast travel menu.
 */
export function toggleFastTravel() {
  if (visible) closeFastTravel();
  else openFastTravel();
}

/**
 * Is the fast travel menu currently open?
 * @returns {boolean}
 */
export function isFastTravelOpen() {
  return visible;
}

/**
 * Get district list (for other modules).
 * @returns {Array<{ name: string, x: number, z: number }>}
 */
export function getDistricts() {
  return DISTRICTS.map(d => ({ name: d.name, x: d.x, z: d.z }));
}

/**
 * Dispose fast travel UI.
 */
export function disposeFastTravel() {
  closeFastTravel();
  if (menuEl) { menuEl.remove(); menuEl = null; }
  delete window._ftTeleport;
}
