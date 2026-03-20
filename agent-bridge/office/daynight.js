import * as THREE from 'three';
import { S } from './state.js';

// ============================================================
// DAY/NIGHT CYCLE — dynamic lighting, sky colors, atmosphere
// Phase 4: Persistent city feels alive 24/7
// Target: minimal performance impact, 120fps compatible
// ============================================================

var GAME_HOUR_SECONDS = 60;   // 1 game hour = 60 real seconds (24 min full cycle)
var gameTime = 8.0;            // start at 8 AM

var sunLight = null;
var moonLight = null;
var ambientLight = null;
var streetLights = [];
var windowMeshes = [];

// Sky color palette (lerp between these based on time)
var SKY_COLORS = {
  dawn:    new THREE.Color(0x2a1a3a),  // 5-7
  morning: new THREE.Color(0x4488cc),  // 7-10
  midday:  new THREE.Color(0x5599dd),  // 10-14
  afternoon: new THREE.Color(0x6688bb), // 14-17
  sunset:  new THREE.Color(0xcc6633),  // 17-19
  dusk:    new THREE.Color(0x1a1a3a),  // 19-21
  night:   new THREE.Color(0x0a0e14),  // 21-5
};

var FOG_COLORS = {
  day:   new THREE.Color(0x88aacc),
  night: new THREE.Color(0x0a0e14),
};

// ============================================================
// INITIALIZATION
// ============================================================

export function initDayNight(options) {
  options = options || {};
  GAME_HOUR_SECONDS = options.hourSeconds || 60;
  gameTime = options.startHour || 8.0;

  // Find or create sun directional light
  S.furnitureGroup.traverse(function(child) {
    if (child.isDirectionalLight && child.castShadow && !sunLight) {
      sunLight = child;
    }
    if (child.isDirectionalLight && !child.castShadow && !moonLight) {
      moonLight = child;
    }
    if (child.isAmbientLight && !ambientLight) {
      ambientLight = child;
    }
    // Collect street light bulbs (emissive meshes near light poles)
    if (child.isPointLight) {
      streetLights.push(child);
    }
    // Collect window meshes (identified by window material color)
    if (child.isMesh && child.material && child.material.emissive &&
        child.material.color && child.material.color.getHex() === 0x88bbee) {
      windowMeshes.push(child);
    }
  });
}

// ============================================================
// TIME HELPERS
// ============================================================

export function getGameTime() { return gameTime; }
export function getGameHour() { return Math.floor(gameTime) % 24; }

export function getTimeOfDay() {
  var h = gameTime % 24;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 10) return 'morning';
  if (h >= 10 && h < 14) return 'midday';
  if (h >= 14 && h < 17) return 'afternoon';
  if (h >= 17 && h < 19) return 'sunset';
  if (h >= 19 && h < 21) return 'dusk';
  return 'night';
}

export function isNightTime() {
  var h = gameTime % 24;
  return h >= 21 || h < 5;
}

function getTimeFactor() {
  // Returns 0.0 (midnight) to 1.0 (noon) for smooth interpolation
  var h = gameTime % 24;
  if (h <= 12) return h / 12;
  return (24 - h) / 12;
}

// ============================================================
// SKY COLOR INTERPOLATION
// ============================================================

function getSkyColor() {
  var tod = getTimeOfDay();
  return SKY_COLORS[tod] || SKY_COLORS.night;
}

function getFogColor() {
  var factor = getTimeFactor();
  var color = new THREE.Color();
  color.lerpColors(FOG_COLORS.night, FOG_COLORS.day, factor);
  return color;
}

// ============================================================
// MAIN UPDATE — called every frame
// ============================================================

export function updateDayNight(dt) {
  // Advance game time
  gameTime += dt / GAME_HOUR_SECONDS;
  if (gameTime >= 24) gameTime -= 24;

  var factor = getTimeFactor();      // 0=midnight, 1=noon
  var night = isNightTime();
  var h = gameTime % 24;

  // === SKY COLOR ===
  var skyColor = getSkyColor();
  if (S.scene.background) {
    S.scene.background.lerp(skyColor, 0.02);
  }

  // === FOG ===
  if (S.scene.fog) {
    var fogColor = getFogColor();
    S.scene.fog.color.lerp(fogColor, 0.02);
    // Fog distance: closer at night (atmospheric), farther at day
    S.scene.fog.near = THREE.MathUtils.lerp(30, 60, factor);
    S.scene.fog.far = THREE.MathUtils.lerp(120, 250, factor);
  }

  // === SUN POSITION (orbits overhead) ===
  if (sunLight) {
    var sunAngle = ((h - 6) / 12) * Math.PI; // 6AM=horizon, 12PM=zenith, 6PM=horizon
    sunLight.position.set(
      Math.cos(sunAngle) * 80,
      Math.max(Math.sin(sunAngle) * 60, -10),
      50
    );
    // Sun intensity: bright during day, off at night
    sunLight.intensity = Math.max(0, Math.sin(sunAngle)) * 0.8;
    // Warm sunrise/sunset color
    if (h >= 5 && h < 8) {
      sunLight.color.setHex(0xffaa66); // warm sunrise
    } else if (h >= 16 && h < 19) {
      sunLight.color.setHex(0xff8844); // warm sunset
    } else {
      sunLight.color.setHex(0xffeedd); // neutral day
    }
  }

  // === MOON ===
  if (moonLight) {
    moonLight.intensity = night ? 0.2 : 0;
  }

  // === AMBIENT LIGHT ===
  if (ambientLight) {
    ambientLight.intensity = THREE.MathUtils.lerp(0.15, 0.5, factor);
    if (night) {
      ambientLight.color.setHex(0x334466); // cool blue ambient at night
    } else {
      ambientLight.color.setHex(0xffffff);
    }
  }

  // === STREET LIGHTS (on at night) ===
  var targetIntensity = night ? 0.6 : 0;
  streetLights.forEach(function(light) {
    light.intensity = THREE.MathUtils.lerp(light.intensity, targetIntensity, 0.05);
  });

  // === WINDOW GLOW (emissive at night — boosted for bloom) ===
  var windowEmissive = night ? 1.5 : 0.2;
  windowMeshes.forEach(function(mesh) {
    if (mesh.material.emissiveIntensity !== undefined) {
      mesh.material.emissiveIntensity = THREE.MathUtils.lerp(
        mesh.material.emissiveIntensity, windowEmissive, 0.03
      );
    }
  });

  // Bloom disabled for performance
}

// ============================================================
// TIME CONTROL — manual set / speed adjustment
// ============================================================

export function setGameTime(hour) {
  gameTime = hour % 24;
}

export function setTimeSpeed(hourSeconds) {
  GAME_HOUR_SECONDS = Math.max(1, hourSeconds);
}

export function getTimeSpeed() {
  return GAME_HOUR_SECONDS;
}

// ============================================================
// CLEANUP
// ============================================================

export function disposeDayNight() {
  sunLight = null;
  moonLight = null;
  ambientLight = null;
  streetLights = [];
  windowMeshes = [];
}
