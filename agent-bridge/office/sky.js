import * as THREE from 'three';

/**
 * Sky system for AI City day/night cycle.
 * - Sky dome with gradient color lerp (dawn/day/dusk/night)
 * - Star field particle system (visible at night)
 * - Time-of-day HUD indicator
 * - Exports getTimeOfDay() for other modules (lights, windows, agents)
 * Target: minimal GPU cost — single sphere + point cloud, no shaders.
 */

let skyDome = null;
let starField = null;
let timeHudEl = null;
let gameTime = 0.5; // 0-1, 0=midnight, 0.25=dawn, 0.5=noon, 0.75=dusk
let timeSpeed = 1 / 600; // Full cycle in 600s (10 min) by default
let paused = false;

// Sky color presets (interpolated based on gameTime)
const SKY_COLORS = {
  midnight: new THREE.Color(0x0a0a1a),
  dawn:     new THREE.Color(0xff7744),
  morning:  new THREE.Color(0x87CEEB),
  noon:     new THREE.Color(0x4a90d9),
  afternoon:new THREE.Color(0x6bb3e0),
  dusk:     new THREE.Color(0xff6633),
  evening:  new THREE.Color(0x1a1a3a),
};

// Fog color follows sky
const FOG_COLORS = {
  midnight: new THREE.Color(0x050510),
  dawn:     new THREE.Color(0xcc8866),
  noon:     new THREE.Color(0x8899aa),
  dusk:     new THREE.Color(0xcc6644),
  evening:  new THREE.Color(0x101020),
};

const TIME_LABELS = [
  { t: 0,    label: '12:00 AM', icon: '🌙' },
  { t: 0.125,label: '3:00 AM',  icon: '🌙' },
  { t: 0.25, label: '6:00 AM',  icon: '🌅' },
  { t: 0.375,label: '9:00 AM',  icon: '☀️' },
  { t: 0.5,  label: '12:00 PM', icon: '☀️' },
  { t: 0.625,label: '3:00 PM',  icon: '☀️' },
  { t: 0.75, label: '6:00 PM',  icon: '🌅' },
  { t: 0.875,label: '9:00 PM',  icon: '🌙' },
];

const TIME_HUD_STYLES = `
  .sky-time-hud {
    position: fixed;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 90;
    pointer-events: none;
    font-family: 'Segoe UI', sans-serif;
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(0,0,0,0.5);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 20px;
    padding: 4px 14px;
    backdrop-filter: blur(6px);
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  .sky-time-hud.visible { opacity: 1; }
  .sky-time-icon { font-size: 16px; }
  .sky-time-label {
    font-size: 12px;
    color: #ddd;
    font-variant-numeric: tabular-nums;
    min-width: 60px;
    text-align: center;
  }
  .sky-time-bar {
    width: 80px;
    height: 4px;
    background: rgba(255,255,255,0.15);
    border-radius: 2px;
    overflow: hidden;
  }
  .sky-time-fill {
    height: 100%;
    background: linear-gradient(90deg, #1a1a3a 0%, #ff7744 25%, #4a90d9 50%, #ff6633 75%, #1a1a3a 100%);
    border-radius: 2px;
    transition: width 0.5s linear;
  }
`;

/**
 * Create the sky dome and star field. Call once during city init.
 * @param {THREE.Scene} scene
 * @param {number} radius - Sky dome radius (default 500)
 * @returns {{ skyDome: THREE.Mesh, starField: THREE.Points }}
 */
export function createSky(scene, radius) {
  const r = radius || 500;

  // Sky dome — large inverted sphere
  const skyGeo = new THREE.SphereGeometry(r, 32, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: SKY_COLORS.noon,
    side: THREE.BackSide,
    fog: false,
  });
  skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.name = 'sky-dome';
  skyDome.renderOrder = -1;
  scene.add(skyDome);

  // Star field — point cloud (only visible at night)
  const starCount = 500;
  const starGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(Math.random() * 0.8 + 0.2); // Upper hemisphere only
    const sr = r * 0.95;
    positions[i * 3]     = sr * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = sr * Math.cos(phi);
    positions[i * 3 + 2] = sr * Math.sin(phi) * Math.sin(theta);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const starMat = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 1.5,
    transparent: true,
    opacity: 0,
    fog: false,
    sizeAttenuation: false,
  });
  starField = new THREE.Points(starGeo, starMat);
  starField.name = 'star-field';
  scene.add(starField);

  // Time HUD
  initTimeHUD();

  return { skyDome, starField };
}

/**
 * Update sky colors and stars based on current game time.
 * Call once per frame (or at 10Hz for performance).
 * @param {number} dt - Delta time in seconds
 * @param {THREE.Scene} scene - For fog color updates
 */
export function updateSky(dt, scene) {
  if (paused) return;
  gameTime = (gameTime + timeSpeed * dt) % 1;

  // Interpolate sky color
  const skyColor = getSkyColorAtTime(gameTime);
  if (skyDome) skyDome.material.color.copy(skyColor);

  // Fog
  if (scene && scene.fog) {
    const fogColor = getFogColorAtTime(gameTime);
    scene.fog.color.copy(fogColor);
  }

  // Stars: fade in at night (0.8-1.0 and 0.0-0.2)
  if (starField) {
    const nightness = getNightness(gameTime);
    starField.material.opacity = nightness;
    starField.visible = nightness > 0.01;
  }

  // Update HUD
  updateTimeHUD();
}

/**
 * Get current time of day (0-1). 0=midnight, 0.5=noon.
 * @returns {number}
 */
export function getTimeOfDay() {
  return gameTime;
}

/**
 * Set game time directly.
 * @param {number} t - 0-1
 */
export function setTimeOfDay(t) {
  gameTime = ((t % 1) + 1) % 1;
}

/**
 * Set the speed of the day/night cycle.
 * @param {number} cycleDurationSeconds - Full cycle duration (default 600)
 */
export function setCycleSpeed(cycleDurationSeconds) {
  timeSpeed = 1 / (cycleDurationSeconds || 600);
}

/**
 * Pause/resume the cycle.
 * @param {boolean} p
 */
export function setPaused(p) {
  paused = p;
}

/**
 * Is it currently night? (for street lights, windows, agent behavior)
 * @returns {boolean}
 */
export function isNight() {
  return gameTime < 0.22 || gameTime > 0.78;
}

/**
 * Get nightness factor (0 = full day, 1 = full night).
 * Smooth transition during dawn/dusk.
 * @param {number} t
 * @returns {number}
 */
function getNightness(t) {
  // Night: 0.85-1.0 and 0.0-0.15 = full night
  // Dawn: 0.15-0.3, Dusk: 0.7-0.85 = transition
  if (t < 0.15) return 1;
  if (t < 0.3) return 1 - (t - 0.15) / 0.15;
  if (t < 0.7) return 0;
  if (t < 0.85) return (t - 0.7) / 0.15;
  return 1;
}

function getSkyColorAtTime(t) {
  const c = new THREE.Color();
  if (t < 0.2)       c.lerpColors(SKY_COLORS.midnight, SKY_COLORS.dawn, t / 0.2);
  else if (t < 0.35) c.lerpColors(SKY_COLORS.dawn, SKY_COLORS.morning, (t - 0.2) / 0.15);
  else if (t < 0.5)  c.lerpColors(SKY_COLORS.morning, SKY_COLORS.noon, (t - 0.35) / 0.15);
  else if (t < 0.65) c.lerpColors(SKY_COLORS.noon, SKY_COLORS.afternoon, (t - 0.5) / 0.15);
  else if (t < 0.8)  c.lerpColors(SKY_COLORS.afternoon, SKY_COLORS.dusk, (t - 0.65) / 0.15);
  else if (t < 0.9)  c.lerpColors(SKY_COLORS.dusk, SKY_COLORS.evening, (t - 0.8) / 0.1);
  else               c.lerpColors(SKY_COLORS.evening, SKY_COLORS.midnight, (t - 0.9) / 0.1);
  return c;
}

function getFogColorAtTime(t) {
  const c = new THREE.Color();
  if (t < 0.25)      c.lerpColors(FOG_COLORS.midnight, FOG_COLORS.dawn, t / 0.25);
  else if (t < 0.5)  c.lerpColors(FOG_COLORS.dawn, FOG_COLORS.noon, (t - 0.25) / 0.25);
  else if (t < 0.75) c.lerpColors(FOG_COLORS.noon, FOG_COLORS.dusk, (t - 0.5) / 0.25);
  else               c.lerpColors(FOG_COLORS.dusk, FOG_COLORS.midnight, (t - 0.75) / 0.25);
  return c;
}

function getTimeLabel(t) {
  const hours = Math.floor(t * 24);
  const minutes = Math.floor((t * 24 - hours) * 60);
  const h12 = hours % 12 || 12;
  const ampm = hours < 12 ? 'AM' : 'PM';
  return h12 + ':' + (minutes < 10 ? '0' : '') + minutes + ' ' + ampm;
}

function getTimeIcon(t) {
  if (t < 0.22 || t > 0.78) return '\u{1F319}'; // crescent moon
  if (t < 0.3 || t > 0.7) return '\u{1F305}';   // sunrise/sunset
  return '\u{2600}';                              // sun
}

function initTimeHUD() {
  if (timeHudEl) return;
  const style = document.createElement('style');
  style.textContent = TIME_HUD_STYLES;
  document.head.appendChild(style);

  timeHudEl = document.createElement('div');
  timeHudEl.className = 'sky-time-hud';
  timeHudEl.innerHTML = `
    <span class="sky-time-icon" id="sky-time-icon"></span>
    <span class="sky-time-label" id="sky-time-label">12:00 PM</span>
    <div class="sky-time-bar">
      <div class="sky-time-fill" id="sky-time-fill" style="width:50%"></div>
    </div>
  `;
  document.body.appendChild(timeHudEl);
}

function updateTimeHUD() {
  if (!timeHudEl) return;
  const iconEl = document.getElementById('sky-time-icon');
  const labelEl = document.getElementById('sky-time-label');
  const fillEl = document.getElementById('sky-time-fill');
  if (iconEl) iconEl.textContent = getTimeIcon(gameTime);
  if (labelEl) labelEl.textContent = getTimeLabel(gameTime);
  if (fillEl) fillEl.style.width = (gameTime * 100) + '%';
}

/**
 * Show the time HUD.
 */
export function showTimeHUD() {
  if (!timeHudEl) initTimeHUD();
  timeHudEl.classList.add('visible');
}

/**
 * Hide the time HUD.
 */
export function hideTimeHUD() {
  if (timeHudEl) timeHudEl.classList.remove('visible');
}

/**
 * Dispose sky system.
 * @param {THREE.Scene} scene
 */
export function disposeSky(scene) {
  if (skyDome) { scene.remove(skyDome); skyDome.geometry.dispose(); skyDome.material.dispose(); skyDome = null; }
  if (starField) { scene.remove(starField); starField.geometry.dispose(); starField.material.dispose(); starField = null; }
  if (timeHudEl) { timeHudEl.remove(); timeHudEl = null; }
}
