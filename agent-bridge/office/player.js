import * as THREE from 'three';
import { S } from './state.js';
import { createCharacter } from './character.js';
import { resolveAppearance } from './appearance.js';
// ============================================================
// PLAYER AVATAR — Walk around the 3D world as a character
// Not an agent — no MCP, no messages — just visual presence
// ============================================================

var PLAYER_SPEED = 3;
var CAMERA_OFFSET = new THREE.Vector3(0, 3, 5); // behind + above
var CAMERA_LOOK_OFFSET = new THREE.Vector3(0, 1.2, 0); // look at chest height
var PLAYER_RADIUS = 0.35; // collision radius

// Reusable Vector3s (avoid per-frame allocation)
var _tmpForward = new THREE.Vector3();
var _tmpRight = new THREE.Vector3();
var _tmpDir = new THREE.Vector3();
var _tmpCamTarget = new THREE.Vector3();
var _tmpLookAt = new THREE.Vector3();
var _tmpTargetPos = new THREE.Vector3();

// ==================== COLLISION SYSTEM ====================
// AABB boxes: { minX, maxX, minZ, maxZ }
// Thin walls as boxes with small thickness

function getCampusColliders() {
  var W = 50, D = 35;
  var colliders = [
    // Building walls (0.3 thick)
    { minX: -W/2 - 0.3, maxX: -W/2,     minZ: -D/2, maxZ: D/2 },  // left wall
    { minX:  W/2,       maxX:  W/2 + 0.3, minZ: -D/2, maxZ: D/2 },  // right wall
    { minX: -W/2,       maxX:  W/2,       minZ: -D/2 - 0.3, maxZ: -D/2 }, // back wall
    // Front wall with entrance gap (gap at x: -4 to 4)
    { minX: -W/2,       maxX: -4,         minZ: D/2,  maxZ: D/2 + 0.3 },
    { minX:  4,          maxX: W/2,        minZ: D/2,  maxZ: D/2 + 0.3 },

    // Manager office walls: group at (12,5), offW=8, offD=7
    // Left wall (x=8): z from 1.5 to 8.5
    { minX: 7.85, maxX: 8.15, minZ: 1.5, maxZ: 8.5 },
    // Right wall (x=16): z from 1.5 to 8.5
    { minX: 15.85, maxX: 16.15, minZ: 1.5, maxZ: 8.5 },
    // Back wall (z=8.5): x from 8 to 16
    { minX: 8, maxX: 16, minZ: 8.35, maxZ: 8.65 },
    // Front wall left of door (z=1.5, x from 8 to ~11.4)
    { minX: 8, maxX: 11.4, minZ: 1.35, maxZ: 1.65 },
    // Front wall right of door (z=1.5, x from ~12.6 to 16)
    { minX: 12.6, maxX: 16, minZ: 1.35, maxZ: 1.65 },
    // Door collider (only active when closed) — handled dynamically below

    // Glass partition between workspace and rec (z=-7, gap at x=-1 to 1)
    { minX: -7, maxX: -1, minZ: -7.15, maxZ: -6.85 },
    { minX:  1, maxX:  7, minZ: -7.15, maxZ: -6.85 },

    // Glass partition designer/main (x=-8, gap at z=2 to 4)
    { minX: -8.15, maxX: -7.85, minZ: -5, maxZ: 2 },
    { minX: -8.15, maxX: -7.85, minZ: 4, maxZ: 7 },

    // Reception desk (ground floor)
    { minX: -2.2, maxX: 2.2, minZ: 13.5, maxZ: 15, floor: 'ground' },
    // Reception logo wall
    { minX: -3, maxX: 3, minZ: 15.5, maxZ: 16, floor: 'ground' },
    // Water feature
    { minX: -1.5, maxX: 1.5, minZ: 9.5, maxZ: 10.5, floor: 'ground' },

    // Bar counter (ground floor)
    { minX: -17, maxX: -11, minZ: -12.7, maxZ: -11.3, floor: 'ground' },

    // Pool table (ground floor)
    { minX: -3.3, maxX: -0.7, minZ: -12.7, maxZ: -11.3, floor: 'ground' },
    // Foosball (ground floor)
    { minX: 1.8, maxX: 3.2, minZ: -12.4, maxZ: -11.6, floor: 'ground' },

    // Mezzanine support columns (thin cylinders, approximate as small boxes)
    // Columns at x: -18,-9,0,9,18  z: -CAMPUS_D/2 + MEZZ_DEPTH = -17.5+12 = -5.5
  ];

  // Desk colliders (gaming desks)
  var CAMPUS_DESKS = [
    { x: -4.5, z: 2 }, { x: -1.5, z: 2 }, { x: 1.5, z: 2 }, { x: 4.5, z: 2 },
    { x: -4.5, z: -1 }, { x: -1.5, z: -1 }, { x: 1.5, z: -1 }, { x: 4.5, z: -1 },
    { x: -4.5, z: -4 }, { x: -1.5, z: -4 }, { x: 1.5, z: -4 }, { x: 4.5, z: -4 },
    { x: -14, z: 1 }, { x: -11, z: 1 },
    { x: -14, z: -2 }, { x: -11, z: -2 },
  ];
  CAMPUS_DESKS.forEach(function(d) {
    // Desk body + chair: box around the desk area (ground floor)
    colliders.push({ minX: d.x - 1.1, maxX: d.x + 1.1, minZ: d.z - 0.5, maxZ: d.z + 1, floor: 'ground' });
  });

  // Manager's desk inside office (ground floor)
  colliders.push({ minX: 10.5, maxX: 14.5, minZ: 5.5, maxZ: 7.5, floor: 'ground' });

  // Bar counter (ground floor)
  // Pool table, foosball (ground floor) — already added above without tag, let me not duplicate

  // Reception area (ground floor)
  // Already added above

  return colliders;
}

function getModernColliders() {
  // Simple colliders for the old modern/startup office
  var colliders = [
    { minX: -14.3, maxX: -14, minZ: -8, maxZ: 8 },   // left wall
    { minX: 14, maxX: 14.3, minZ: -8, maxZ: 8 },      // right wall
    { minX: -14, maxX: 14, minZ: -8.3, maxZ: -8 },    // back wall
    { minX: -14, maxX: 14, minZ: 8, maxZ: 8.3 },      // front wall
  ];
  return colliders;
}

var _cachedColliders = null;
var _cachedCollidersEnv = null;

function getColliders() {
  if (_cachedCollidersEnv === S.currentEnv && _cachedColliders) return _cachedColliders;
  _cachedCollidersEnv = S.currentEnv;
  if (S.currentEnv === 'campus') {
    _cachedColliders = getCampusColliders();
  } else {
    _cachedColliders = getModernColliders();
  }
  return _cachedColliders;
}

// Check if a circle (player) at (x,z) with radius r collides with any AABB
function checkCollision(x, z, r) {
  var playerY = S._player ? S._player.pos.y : 0;
  var onMezzanine = playerY > MEZZ_HEIGHT * 0.4;
  var onStairs = S._player && x >= STAIR_X_MIN && x <= STAIR_X_MAX && z <= STAIR_Z_BOTTOM && z >= STAIR_Z_TOP;

  var colliders = getColliders();
  for (var i = 0; i < colliders.length; i++) {
    var c = colliders[i];
    // Skip ground-floor furniture colliders when on mezzanine (desks etc)
    if (onMezzanine && c.floor === 'ground') continue;
    // Skip mezzanine colliders when on ground floor
    if (!onMezzanine && !onStairs && c.floor === 'upper') continue;
    var cx = Math.max(c.minX, Math.min(x, c.maxX));
    var cz = Math.max(c.minZ, Math.min(z, c.maxZ));
    var dx = x - cx, dz = z - cz;
    if (dx * dx + dz * dz < r * r) return true;
  }

  // Mezzanine railing — blocks walking off the edge (only when on mezzanine)
  if (onMezzanine && !onStairs) {
    // Front edge of mezzanine at z = -5.5 (except staircase gap at x 18.75-21.25)
    if (z > -5.7 && z < -5.3 && !(x >= STAIR_X_MIN - 0.5 && x <= STAIR_X_MAX + 0.5)) {
      return true;
    }
  }

  // Dynamic: manager door (closed = collider, open = passable)
  if (S.currentEnv === 'campus' && S._managerDoorLerp < 0.5 && !onMezzanine) {
    var doorBox = { minX: 11.4, maxX: 12.6, minZ: 1.35, maxZ: 1.65 };
    var dcx = Math.max(doorBox.minX, Math.min(x, doorBox.maxX));
    var dcz = Math.max(doorBox.minZ, Math.min(z, doorBox.maxZ));
    var ddx = x - dcx, ddz = z - dcz;
    if (ddx * ddx + ddz * ddz < r * r) return true;
  }
  return false;
}

// Check collision with agents (circle vs circle)
function checkAgentCollision(x, z, r) {
  for (var name in S.agents3d) {
    var ag = S.agents3d[name];
    if (!ag.registered || ag.dying) continue;
    var dx = x - ag.pos.x, dz = z - ag.pos.z;
    if (dx * dx + dz * dz < (r + 0.3) * (r + 0.3)) return true;
  }
  return false;
}

// Resolve movement with sliding collision (try X and Z independently)
function resolveMovement(oldX, oldZ, newX, newZ, r) {
  // Try full movement
  if (!checkCollision(newX, newZ, r) && !checkAgentCollision(newX, newZ, r)) {
    return { x: newX, z: newZ };
  }
  // Try sliding along X
  if (!checkCollision(newX, oldZ, r) && !checkAgentCollision(newX, oldZ, r)) {
    return { x: newX, z: oldZ };
  }
  // Try sliding along Z
  if (!checkCollision(oldX, newZ, r) && !checkAgentCollision(oldX, newZ, r)) {
    return { x: oldX, z: newZ };
  }
  // Stuck — don't move
  return { x: oldX, z: oldZ };
}

// ==================== HEIGHT SYSTEM ====================
// Staircase: x 18.75-21.25, z -3.5 (bottom, y=0) to -9.5 (top, y=3.2)
// Mezzanine: y=3.2, z from -17.5 to -5.5, full width
var STAIR_X_MIN = 18.75, STAIR_X_MAX = 21.25;
var STAIR_Z_BOTTOM = -3.5, STAIR_Z_TOP = -9.5;
var MEZZ_HEIGHT = 3.2;
var MEZZ_Z_BACK = -17.5, MEZZ_Z_FRONT = -5.5;

function getGroundHeight(x, z, currentY) {
  if (S.currentEnv !== 'campus') return 0;

  // On the staircase?
  if (x >= STAIR_X_MIN && x <= STAIR_X_MAX && z <= STAIR_Z_BOTTOM && z >= STAIR_Z_TOP) {
    // Interpolate height: bottom (z=-3.5, y=0) to top (z=-9.5, y=3.2)
    var t = (STAIR_Z_BOTTOM - z) / (STAIR_Z_BOTTOM - STAIR_Z_TOP);
    t = Math.max(0, Math.min(1, t));
    return t * MEZZ_HEIGHT;
  }

  // On the mezzanine? (must have come from stairs — check if currentY > halfway)
  if (currentY > MEZZ_HEIGHT * 0.4 && z <= MEZZ_Z_FRONT && z >= MEZZ_Z_BACK) {
    return MEZZ_HEIGHT;
  }

  // Ground level
  return 0;
}

// Invalidate collider cache on env switch
export function invalidateColliders() {
  _cachedColliders = null;
  _cachedCollidersEnv = null;
}

export function spawnPlayer() {
  if (S._player) despawnPlayer();

  // Load appearance from localStorage
  var appearance = {};
  try {
    var stored = localStorage.getItem('ltt_player_appearance');
    if (stored) appearance = JSON.parse(stored);
  } catch (e) {}

  var parts = createCharacter('Player', appearance);
  parts.group.position.set(0, 0, 12); // spawn at lobby

  // Remove typing dots and task indicator (player doesn't need them)
  parts.typingLabel.visible = false;
  parts.taskLabel.visible = false;

  // Update name label
  var nameEl = parts.labelDiv.querySelector('.office3d-label-name');
  var dotEl = parts.labelDiv.querySelector('.office3d-label-dot');
  if (nameEl) nameEl.textContent = 'You';
  if (dotEl) dotEl.style.background = '#58a6ff';

  S.scene.add(parts.group);

  S._player = {
    parts: parts,
    pos: { x: 0, y: 0, z: 12 },
    facing: 0, // radians, 0 = +z direction
    velocity: { x: 0, z: 0 },
    isMoving: false,
    appearance: appearance,
    camYaw: Math.PI,  // camera orbit angle around player (horizontal)
    camPitch: 0.4,    // camera pitch (vertical angle, 0=level, positive=looking down)
    camDist: 6,       // distance from player
  };

  // Disable spectator camera movement but keep key/mouse tracking alive
  if (S.controls) {
    S.controls.enabled = false;
    S.controls._playerZoomCb = function(deltaY) {
      if (S._player) {
        S._player.camDist = Math.max(2, Math.min(15, S._player.camDist + deltaY * 0.01));
      }
    };
  }

  return S._player;
}

export function despawnPlayer() {
  if (!S._player) return;
  S.scene.remove(S._player.parts.group);
  S._player.parts.group.traverse(function(child) {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.map) child.material.map.dispose();
      child.material.dispose();
    }
  });
  S._player = null;

  // Re-enable spectator camera
  if (S.controls) {
    S.controls.enabled = true;
    S.controls._playerZoomCb = null;
  }
}

export function isPlayerMode() {
  return !!S._player;
}

export function getPlayer() {
  return S._player;
}

export function savePlayerAppearance(appearance) {
  try {
    localStorage.setItem('ltt_player_appearance', JSON.stringify(appearance));
  } catch (e) {}
  if (S._player) S._player.appearance = appearance;
}

export function getPlayerAppearance() {
  try {
    var stored = localStorage.getItem('ltt_player_appearance');
    if (stored) return JSON.parse(stored);
  } catch (e) {}
  return {};
}

// Called every frame from the animation loop
export function updatePlayer(dt, time, keys) {
  var player = S._player;
  if (!player) return;

  // --- Movement from keyboard ---
  var moveX = 0, moveZ = 0;
  if (keys['KeyW'] || keys['ArrowUp']) moveZ -= 1;
  if (keys['KeyS'] || keys['ArrowDown']) moveZ += 1;
  if (keys['KeyA'] || keys['ArrowLeft']) moveX -= 1;
  if (keys['KeyD'] || keys['ArrowRight']) moveX += 1;

  var isMoving = moveX !== 0 || moveZ !== 0;
  player.isMoving = isMoving;

  if (isMoving) {
    // Movement relative to camera yaw (orbit angle)
    var camYaw = S.controls && S.controls._euler ? S.controls._euler.y : 0;
    _tmpForward.set(-Math.sin(camYaw), 0, -Math.cos(camYaw)).normalize();
    _tmpRight.set(-_tmpForward.z, 0, _tmpForward.x);

    _tmpDir.set(0, 0, 0);
    _tmpDir.addScaledVector(_tmpForward, -moveZ);
    _tmpDir.addScaledVector(_tmpRight, moveX);
    _tmpDir.normalize();

    var speed = PLAYER_SPEED * (keys['ShiftLeft'] || keys['ShiftRight'] ? 2 : 1);
    var newX = player.pos.x + _tmpDir.x * speed * dt;
    var newZ = player.pos.z + _tmpDir.z * speed * dt;

    // Collision resolution (sliding)
    var resolved = resolveMovement(player.pos.x, player.pos.z, newX, newZ, PLAYER_RADIUS);
    player.pos.x = resolved.x;
    player.pos.z = resolved.z;

    // Face movement direction
    player.facing = Math.atan2(_tmpDir.x, _tmpDir.z);
  }

  // Update character position
  // Update height based on position (stairs/mezzanine)
  var targetY = getGroundHeight(player.pos.x, player.pos.z, player.pos.y);
  player.pos.y += (targetY - player.pos.y) * Math.min(1, dt * 8); // smooth height transition

  player.parts.group.position.x = player.pos.x;
  player.parts.group.position.y = player.pos.y;
  player.parts.group.position.z = player.pos.z;

  // Smooth rotation
  var currentRot = player.parts.group.rotation.y;
  var diff = player.facing - currentRot;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  player.parts.group.rotation.y += diff * Math.min(1, dt * 8);

  // --- Walking animation ---
  if (isMoving) {
    var swing = Math.sin(time * 10) * 0.5;
    player.parts.leftLeg.rotation.x = swing;
    player.parts.rightLeg.rotation.x = -swing;
    player.parts.leftLowerLeg.rotation.x = Math.max(0, -swing) * 0.8;
    player.parts.rightLowerLeg.rotation.x = Math.max(0, swing) * 0.8;
    player.parts.leftArm.rotation.x = -swing * 0.7;
    player.parts.rightArm.rotation.x = swing * 0.7;
    player.parts.leftForearm.rotation.x = -0.3 - Math.abs(swing) * 0.3;
    player.parts.rightForearm.rotation.x = -0.3 - Math.abs(swing) * 0.3;
  } else {
    // Idle — breathing + slight head bob
    player.parts.leftLeg.rotation.x *= 0.9;
    player.parts.rightLeg.rotation.x *= 0.9;
    player.parts.leftArm.rotation.x *= 0.9;
    player.parts.rightArm.rotation.x *= 0.9;
    player.parts.leftLowerLeg.rotation.x *= 0.9;
    player.parts.rightLowerLeg.rotation.x *= 0.9;
    player.parts.leftForearm.rotation.x *= 0.9;
    player.parts.rightForearm.rotation.x *= 0.9;
    var breathe = 1 + Math.sin(time * 2) * 0.02;
    player.parts.body.scale.y = breathe;
    player.parts.head.rotation.z = Math.sin(time * 0.5) * 0.03;
  }

  // --- Third-person camera follow ---
  updatePlayerCamera(dt);
}

function updatePlayerCamera(dt) {
  var player = S._player;
  if (!player) return;

  // Use spectator camera's euler for orbit angle (from mouse right-drag)
  var yaw = 0, pitch = 0.4;
  if (S.controls && S.controls._euler) {
    yaw = S.controls._euler.y;
    pitch = Math.max(0.05, Math.min(1.3, -S.controls._euler.x));
  }

  // Orbit camera around the player using yaw/pitch (+ player height)
  var dist = player.camDist;
  var baseY = player.pos.y;
  var camX = player.pos.x + Math.sin(yaw) * Math.cos(pitch) * dist;
  var camZ = player.pos.z + Math.cos(yaw) * Math.cos(pitch) * dist;
  var camY = baseY + 1 + Math.sin(pitch) * dist;

  _tmpCamTarget.set(camX, camY, camZ);

  // Smooth follow
  S.camera.position.lerp(_tmpCamTarget, Math.min(1, dt * 6));

  // Look at player chest (offset by player height)
  _tmpLookAt.set(
    player.pos.x,
    baseY + CAMERA_LOOK_OFFSET.y,
    player.pos.z + CAMERA_LOOK_OFFSET.z
  );
  S.camera.lookAt(_tmpLookAt);
}
