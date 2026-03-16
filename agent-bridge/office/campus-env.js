import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';

// ============================================================
// TECH CAMPUS — Premium 2-floor environment
// Inspired by Google/Apple HQ: marble, glass, wood, RGB gaming
// ============================================================

var CAMPUS_W = 50;
var CAMPUS_D = 35;
var WALL_H = 6;
var MEZZ_H = 3.2;
var MEZZ_DEPTH = 12; // how far mezzanine extends from back wall

// Campus desk positions (gaming desk layout)
var CAMPUS_DESKS = [
  // Main coder zone (center, 3 rows of 4)
  { x: -4.5, z: 2 }, { x: -1.5, z: 2 }, { x: 1.5, z: 2 }, { x: 4.5, z: 2 },
  { x: -4.5, z: -1 }, { x: -1.5, z: -1 }, { x: 1.5, z: -1 }, { x: 4.5, z: -1 },
  { x: -4.5, z: -4 }, { x: -1.5, z: -4 }, { x: 1.5, z: -4 }, { x: 4.5, z: -4 },
  // Designer wing (left, 2 rows of 2)
  { x: -14, z: 1 }, { x: -11, z: 1 },
  { x: -14, z: -2 }, { x: -11, z: -2 },
  // Manager's private office desk (last position — assigned to first "Manager" role agent)
  // Office at (12,5), desk at relative (0,1.5)=world(12,6.5), chair at relative (0,2.4)=world(12,7.4)
  // Agent sits at deskPos.z + 0.7, so set z to 6.7 → agent at 7.4 (chair pos)
  { x: 12, z: 6.7 },
];

export function getCampusDeskPositions() {
  return CAMPUS_DESKS;
}

export function buildCampusEnvironment() {
  S.deskMeshes = [];

  // Materials palette
  var marbleMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.15, metalness: 0.05 });
  var marbleDarkMat = new THREE.MeshStandardMaterial({ color: 0xd4cfc7, roughness: 0.2 });
  var walnutMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.6 });
  var walnutLightMat = new THREE.MeshStandardMaterial({ color: 0x8B5E3C, roughness: 0.55 });
  var chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.1, metalness: 0.8 });
  var glassMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.1 });
  var glassFrameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.2, metalness: 0.6 });
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.4 });
  var carpetMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.95 });
  var neonBlueMat = new THREE.MeshStandardMaterial({ color: 0x58a6ff, emissive: 0x58a6ff, emissiveIntensity: 0.6, roughness: 0.2 });
  var neonPurpleMat = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: 0xa855f7, emissiveIntensity: 0.5, roughness: 0.2 });
  var neonGreenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.5, roughness: 0.2 });
  var concreteMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.85 });
  var leatherBlackMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.7 });
  var leatherBrownMat = new THREE.MeshStandardMaterial({ color: 0x6b3e26, roughness: 0.65 });
  var goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.7 });

  // ========== FLOOR ==========
  buildCampusFloor(marbleMat, marbleDarkMat, carpetMat);

  // ========== WALLS & WINDOWS ==========
  buildCampusWalls(concreteMat, glassMat, glassFrameMat);

  // ========== CEILING & SKYLIGHTS ==========
  buildCampusCeiling(concreteMat, glassMat);

  // ========== MEZZANINE (2nd floor) ==========
  buildMezzanine(concreteMat, chromeMat, glassMat, walnutMat);

  // ========== STAIRCASE ==========
  buildStaircase(marbleMat, chromeMat, glassMat);

  // ========== GRAND LOBBY ==========
  buildLobby(marbleMat, chromeMat, goldMat, walnutMat);

  // ========== GAMING DESKS (main workspace, skip last = manager office) ==========
  var managerDeskIdx = CAMPUS_DESKS.length - 1;
  CAMPUS_DESKS.forEach(function(pos, i) {
    if (i === managerDeskIdx) return; // manager office has its own built-in desk
    buildGamingDesk(pos.x, pos.z, i);
  });

  // ========== MANAGER'S OFFICE (glass room, front right) ==========
  buildManagerOffice(12, 5, glassMat, glassFrameMat, walnutMat, leatherBrownMat, chromeMat);

  // ========== DESIGNER STUDIO (left wing) ==========
  buildDesignerStudio(-12.5, 0, walnutLightMat, chromeMat);

  // ========== BAR & CAFÉ (back left) ==========
  buildBar(-14, -12, walnutMat, chromeMat, neonBlueMat, neonPurpleMat);

  // ========== RECREATION CENTER (back center) ==========
  buildRecCenter(0, -12, walnutMat, chromeMat, carpetMat);

  // ========== GYM (back right) ==========
  buildGym(14, -12, chromeMat, darkMat);

  // ========== PLANTS & GREENERY ==========
  buildCampusPlants();

  // ========== PENDANT LIGHTS ==========
  buildPendantLights();

  // ========== GLASS PARTITIONS ==========
  buildGlassPartitions(glassMat, glassFrameMat);

  // ========== NEON SIGNS ==========
  buildNeonSign('INNOVATE', -7, 4.5, -CAMPUS_D / 2 + 0.2, neonBlueMat);
  buildNeonSign('CREATE', 7, 4.5, -CAMPUS_D / 2 + 0.2, neonPurpleMat);
  buildNeonSign('BUILD', 0, MEZZ_H + 2, -CAMPUS_D / 2 + MEZZ_DEPTH + 0.2, neonGreenMat);
}

// ==================== FLOOR ====================
function buildCampusFloor(marbleMat, marbleDarkMat, carpetMat) {
  // High-quality procedural dark marble tile floor
  var size = 1024;
  var cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  var ctx = cvs.getContext('2d');
  var tiles = 12;
  var ts = size / tiles;

  // Simple 2D noise function for marble veining
  function noise(x, y) {
    var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  function smoothNoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var a = noise(ix, iy), b = noise(ix + 1, iy);
    var c = noise(ix, iy + 1), d = noise(ix + 1, iy + 1);
    var u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y) {
    var val = 0, amp = 0.5;
    for (var o = 0; o < 5; o++) {
      val += smoothNoise(x, y) * amp;
      x *= 2.1; y *= 2.1; amp *= 0.48;
    }
    return val;
  }

  for (var ti = 0; ti < tiles; ti++) {
    for (var tj = 0; tj < tiles; tj++) {
      var tx = ti * ts, ty = tj * ts;

      // Alternating dark/darker marble tiles
      var isDark = (ti + tj) % 2 === 0;
      var baseR = isDark ? 28 : 22;
      var baseG = isDark ? 30 : 24;
      var baseB = isDark ? 38 : 30;

      // Fill base tile color
      ctx.fillStyle = 'rgb(' + baseR + ',' + baseG + ',' + baseB + ')';
      ctx.fillRect(tx, ty, ts, ts);

      // Marble veining (per-pixel noise)
      var imgData = ctx.getImageData(tx, ty, ts, ts);
      var data = imgData.data;
      for (var py = 0; py < ts; py++) {
        for (var px = 0; px < ts; px++) {
          var wx = (ti * ts + px) / size * 6;
          var wy = (tj * ts + py) / size * 6;

          // Marble pattern: distorted sine wave + noise
          var vein = Math.sin(wx * 3 + fbm(wx * 2, wy * 2) * 4) * 0.5 + 0.5;
          var vein2 = Math.sin(wy * 2.5 + fbm(wx * 1.5 + 5, wy * 1.5 + 3) * 3.5) * 0.5 + 0.5;
          var combined = vein * 0.6 + vein2 * 0.4;

          // Color the veins — gold/white streaks on dark base
          var veinStrength = Math.pow(combined, 3) * 0.35;
          var nv = smoothNoise(wx * 4, wy * 4) * 0.08;

          var idx = (py * ts + px) * 4;
          // Base dark marble + gold/gray veins
          data[idx] = Math.min(255, baseR + veinStrength * 120 + nv * 40);      // R
          data[idx + 1] = Math.min(255, baseG + veinStrength * 100 + nv * 35);  // G
          data[idx + 2] = Math.min(255, baseB + veinStrength * 60 + nv * 30);   // B
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, tx, ty);

      // Tile grout line (very thin, slightly lighter)
      ctx.strokeStyle = 'rgba(50,52,60,0.8)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx + 0.5, ty + 0.5, ts - 1, ts - 1);
    }
  }

  var floorTex = new THREE.CanvasTexture(cvs);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.anisotropy = 4;
  var floorGeo = new THREE.PlaneGeometry(CAMPUS_W, CAMPUS_D);
  var floorMeshMat = new THREE.MeshStandardMaterial({
    map: floorTex, roughness: 0.12, metalness: 0.08
  });
  var floor = new THREE.Mesh(floorGeo, floorMeshMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  S.furnitureGroup.add(floor);

  // Carpet runner in workspace zone (dark charcoal)
  var carpet = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), carpetMat);
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.01, -1);
  carpet.receiveShadow = true;
  S.furnitureGroup.add(carpet);
}

// ==================== WALLS & WINDOWS ====================
function buildCampusWalls(concreteMat, glassMat, frameMat) {
  // Back wall (concrete with large windows)
  var wallMat = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.8, side: THREE.DoubleSide });

  var backWall = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, WALL_H), wallMat);
  backWall.position.set(0, WALL_H / 2, -CAMPUS_D / 2);
  backWall.receiveShadow = true;
  S.furnitureGroup.add(backWall);

  var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_D, WALL_H), wallMat);
  leftWall.position.set(-CAMPUS_W / 2, WALL_H / 2, 0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  S.furnitureGroup.add(leftWall);

  var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_D, WALL_H), wallMat);
  rightWall.position.set(CAMPUS_W / 2, WALL_H / 2, 0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  S.furnitureGroup.add(rightWall);

  // Front wall with entrance gap
  var frontLeftWall = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W / 2 - 4, WALL_H), wallMat);
  frontLeftWall.position.set(-CAMPUS_W / 4 - 2, WALL_H / 2, CAMPUS_D / 2);
  frontLeftWall.rotation.y = Math.PI;
  S.furnitureGroup.add(frontLeftWall);

  var frontRightWall = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W / 2 - 4, WALL_H), wallMat);
  frontRightWall.position.set(CAMPUS_W / 4 + 2, WALL_H / 2, CAMPUS_D / 2);
  frontRightWall.rotation.y = Math.PI;
  S.furnitureGroup.add(frontRightWall);

  // Floor-to-ceiling windows (left and right walls)
  var windowMat = new THREE.MeshStandardMaterial({
    color: 0x87CEEB, emissive: 0x87CEEB, emissiveIntensity: 0.15, roughness: 0.05, transparent: true, opacity: 0.6
  });
  // Left wall windows
  [-10, -5, 0, 5, 10].forEach(function(wz) {
    var win = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.5), windowMat);
    win.position.set(-CAMPUS_W / 2 + 0.05, 3, wz);
    win.rotation.y = Math.PI / 2;
    S.furnitureGroup.add(win);
    // Chrome frame
    var frame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 4.6, 3.1), frameMat);
    frame.position.set(-CAMPUS_W / 2 + 0.02, 3, wz);
    S.furnitureGroup.add(frame);
  });
  // Right wall windows
  [-10, -5, 0, 5, 10].forEach(function(wz) {
    var win = new THREE.Mesh(new THREE.PlaneGeometry(3, 4.5), windowMat);
    win.position.set(CAMPUS_W / 2 - 0.05, 3, wz);
    win.rotation.y = -Math.PI / 2;
    S.furnitureGroup.add(win);
  });
  // Back wall windows (above mezzanine level)
  [-15, -8, 0, 8, 15].forEach(function(wx) {
    var win = new THREE.Mesh(new THREE.PlaneGeometry(4, 2), windowMat);
    win.position.set(wx, 4.5, -CAMPUS_D / 2 + 0.05);
    S.furnitureGroup.add(win);
  });
}

// ==================== CEILING & SKYLIGHTS ====================
function buildCampusCeiling(concreteMat, glassMat) {
  // Group for everything that should hide when camera is above roof
  S._roofGroup = new THREE.Group();

  // Main ceiling
  var ceilingMat = new THREE.MeshStandardMaterial({ color: 0x1e2028, roughness: 0.9, side: THREE.DoubleSide });
  var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, CAMPUS_D), ceilingMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_H;
  S._roofGroup.add(ceiling);

  // Skylights (glass rectangles in ceiling)
  var skylightMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff, emissive: 0xaaddff, emissiveIntensity: 0.3, transparent: true, opacity: 0.4, side: THREE.DoubleSide
  });
  [[-6, 4], [6, 4], [-6, -4], [6, -4], [0, 0]].forEach(function(pos) {
    var skylight = new THREE.Mesh(new THREE.PlaneGeometry(5, 3), skylightMat);
    skylight.rotation.x = Math.PI / 2;
    skylight.position.set(pos[0], WALL_H - 0.05, pos[1]);
    S._roofGroup.add(skylight);
  });

  S.furnitureGroup.add(S._roofGroup);
}

// ==================== MEZZANINE ====================
function buildMezzanine(concreteMat, chromeMat, glassMat, walnutMat) {
  // Platform
  var mezzFloor = new THREE.Mesh(new THREE.BoxGeometry(CAMPUS_W - 2, 0.2, MEZZ_DEPTH), concreteMat);
  mezzFloor.position.set(0, MEZZ_H, -CAMPUS_D / 2 + MEZZ_DEPTH / 2);
  mezzFloor.castShadow = true; mezzFloor.receiveShadow = true;
  S.furnitureGroup.add(mezzFloor);

  // Floor surface (walnut)
  var mezzTop = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W - 2, MEZZ_DEPTH), walnutMat);
  mezzTop.rotation.x = -Math.PI / 2;
  mezzTop.position.set(0, MEZZ_H + 0.11, -CAMPUS_D / 2 + MEZZ_DEPTH / 2);
  mezzTop.receiveShadow = true;
  S.furnitureGroup.add(mezzTop);

  // Glass railing along front edge
  var railGlass = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W - 6, 1.1), glassMat);
  railGlass.position.set(0, MEZZ_H + 0.65, -CAMPUS_D / 2 + MEZZ_DEPTH);
  S.furnitureGroup.add(railGlass);
  // Chrome rail bar on top
  var railBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, CAMPUS_W - 6, 8), chromeMat);
  railBar.rotation.z = Math.PI / 2;
  railBar.position.set(0, MEZZ_H + 1.2, -CAMPUS_D / 2 + MEZZ_DEPTH);
  S.furnitureGroup.add(railBar);

  // Support columns
  [-18, -9, 0, 9, 18].forEach(function(cx) {
    var col = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, MEZZ_H, 12), chromeMat);
    col.position.set(cx, MEZZ_H / 2, -CAMPUS_D / 2 + MEZZ_DEPTH);
    col.castShadow = true;
    S.furnitureGroup.add(col);
  });

  // Meeting pods on mezzanine (2 round tables with chairs)
  [-10, 10].forEach(function(mx) {
    // Round table
    var table = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.06, 24), walnutMat);
    table.position.set(mx, MEZZ_H + 0.85, -CAMPUS_D / 2 + 5);
    table.castShadow = true;
    S.furnitureGroup.add(table);
    var tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.7, 8), chromeMat);
    tableLeg.position.set(mx, MEZZ_H + 0.46, -CAMPUS_D / 2 + 5);
    S.furnitureGroup.add(tableLeg);
    // 4 chairs around
    for (var ci = 0; ci < 4; ci++) {
      var ca = (ci / 4) * Math.PI * 2;
      var cx2 = mx + Math.cos(ca) * 1.5;
      var cz2 = -CAMPUS_D / 2 + 5 + Math.sin(ca) * 1.5;
      buildModernChair(cx2, MEZZ_H + 0.11, cz2, ca + Math.PI, chromeMat);
    }
  });

  // Lounge sofa on mezzanine
  buildSofa(0, MEZZ_H + 0.11, -CAMPUS_D / 2 + 3);

  // "UPPER DECK" sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'UPPER DECK';
  signDiv.style.cssText = 'color:#d4af37;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, MEZZ_H + 2, -CAMPUS_D / 2 + MEZZ_DEPTH);
  S.furnitureGroup.add(sign);
}

// ==================== STAIRCASE ====================
function buildStaircase(marbleMat, chromeMat, glassMat) {
  var stairX = 20;
  var stairZ = -CAMPUS_D / 2 + MEZZ_DEPTH + 2;
  var steps = 12;
  var stepW = 2.5;
  var stepH = MEZZ_H / steps;
  var stepD = 0.5;

  for (var i = 0; i < steps; i++) {
    var step = new THREE.Mesh(new THREE.BoxGeometry(stepW, stepH, stepD), marbleMat);
    step.position.set(stairX, stepH / 2 + i * stepH, stairZ - i * stepD);
    step.castShadow = true; step.receiveShadow = true;
    S.furnitureGroup.add(step);
  }

  // Glass side panels
  var panelH = MEZZ_H + 1;
  var panelD = steps * stepD;
  var sidePanel = new THREE.Mesh(new THREE.PlaneGeometry(panelD, panelH), glassMat);
  sidePanel.position.set(stairX + stepW / 2 + 0.05, panelH / 2, stairZ - panelD / 2);
  sidePanel.rotation.y = Math.PI / 2;
  S.furnitureGroup.add(sidePanel);

  // Chrome handrail
  var railLen = Math.sqrt(panelD * panelD + MEZZ_H * MEZZ_H);
  var rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, railLen, 6), chromeMat);
  rail.position.set(stairX + stepW / 2 + 0.08, MEZZ_H / 2 + 0.5, stairZ - panelD / 2);
  rail.rotation.x = Math.atan2(MEZZ_H, panelD);
  S.furnitureGroup.add(rail);
}

// ==================== GRAND LOBBY ====================
function buildLobby(marbleMat, chromeMat, goldMat, walnutMat) {
  var lz = CAMPUS_D / 2 - 3;
  var group = new THREE.Group();

  // --- Modern reception desk (sleek angular shape) ---
  var deskBodyMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3, metalness: 0.15 });
  // Front panel (angled, facing visitors)
  var frontPanel = new THREE.Mesh(new THREE.BoxGeometry(4, 1.15, 0.12), deskBodyMat);
  frontPanel.position.set(0, 0.58, lz + 0.5);
  frontPanel.castShadow = true;
  group.add(frontPanel);
  // Side panels
  [-2, 2].forEach(function(sx) {
    var side = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.15, 1.2), deskBodyMat);
    side.position.set(sx, 0.58, lz - 0.05);
    side.castShadow = true;
    group.add(side);
  });
  // Marble countertop
  var counterTop = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.06, 1.4), marbleMat);
  counterTop.position.set(0, 1.17, lz - 0.05);
  counterTop.castShadow = true;
  group.add(counterTop);
  // Gold accent strip on front
  var accentStrip = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.04, 0.005), goldMat);
  accentStrip.position.set(0, 1.0, lz + 0.57);
  group.add(accentStrip);
  // LED underglow (blue)
  var ledMat = new THREE.MeshStandardMaterial({ color: 0x58a6ff, emissive: 0x58a6ff, emissiveIntensity: 0.6, roughness: 0.2 });
  var ledStrip = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.02, 0.02), ledMat);
  ledStrip.position.set(0, 0.03, lz + 0.55);
  group.add(ledStrip);

  // Reception monitor (thin, on desk)
  var monMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var mon = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.02), monMat);
  mon.position.set(-0.8, 1.45, lz - 0.1);
  group.add(mon);
  var monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3),
    new THREE.MeshStandardMaterial({ color: 0x1a2a4a, emissive: 0x58a6ff, emissiveIntensity: 0.25, roughness: 0.1 }));
  monScreen.position.set(-0.8, 1.45, lz - 0.088);
  group.add(monScreen);
  var monStand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6), chromeMat);
  monStand.position.set(-0.8, 1.28, lz - 0.1);
  group.add(monStand);

  // Keyboard on desk
  var kbMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.01, 0.1), kbMat);
  kb.position.set(-0.8, 1.2, lz - 0.4);
  group.add(kb);

  // --- Feature wall with big TV monitor (behind reception) ---
  var logoWallMat = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.7 });
  var logoWall = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.15), logoWallMat);
  logoWall.position.set(0, 2.5, lz + 1.5);
  logoWall.castShadow = true;
  group.add(logoWall);

  // "LET THEM TALK" logo text above the TV
  var logoDiv = document.createElement('div');
  logoDiv.textContent = 'LET THEM TALK';
  logoDiv.style.cssText = 'color:#ffffff;font-size:14px;font-weight:900;font-family:Inter,sans-serif;letter-spacing:6px;text-shadow:0 0 20px rgba(88,166,255,0.6),0 0 40px rgba(88,166,255,0.3);';
  var logoLabel = new CSS2DObject(logoDiv);
  logoLabel.position.set(0, 4.3, lz + 1.6);
  group.add(logoLabel);

  // Big TV screen (dynamic canvas dashboard) — facing INTO the room (-z)
  var tvFrame = new THREE.Mesh(new THREE.BoxGeometry(5, 2.8, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 }));
  tvFrame.position.set(0, 2.2, lz + 1.4);
  tvFrame.castShadow = true;
  group.add(tvFrame);
  // Animated canvas
  var tvW = 480, tvH = 300;
  var tvCvs = document.createElement('canvas');
  tvCvs.width = tvW; tvCvs.height = tvH;
  var tvTex = new THREE.CanvasTexture(tvCvs);
  tvTex.minFilter = THREE.LinearFilter;
  var tvScreenMat = new THREE.MeshStandardMaterial({
    map: tvTex, emissive: 0x58a6ff, emissiveIntensity: 0.2, roughness: 0.1
  });
  var tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.5), tvScreenMat);
  tvScreen.position.set(0, 2.2, lz + 1.36);
  tvScreen.rotation.y = Math.PI;
  group.add(tvScreen);
  S._tvScreen = { canvas: tvCvs, texture: tvTex, tickerOffset: 0 };

  // Accent light on the wall
  var logoSpot = new THREE.PointLight(0x58a6ff, 0.5, 6);
  logoSpot.position.set(0, 4.2, lz + 1);
  group.add(logoSpot);

  // --- Water feature (low rectangular pool) ---
  var poolFrame = new THREE.Mesh(new THREE.BoxGeometry(3, 0.2, 1.5),
    new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.4 }));
  poolFrame.position.set(0, 0.1, lz - 4);
  poolFrame.castShadow = true;
  group.add(poolFrame);
  var waterMat = new THREE.MeshStandardMaterial({ color: 0x2a6090, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.7 });
  var water = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.2), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.22, lz - 4);
  group.add(water);
  // Decorative stones in water
  var stoneMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
  [[-0.8, -0.3], [0.5, 0.2], [-0.2, 0.1], [0.9, -0.2], [-0.5, -0.1]].forEach(function(sp) {
    var stone = new THREE.Mesh(new THREE.SphereGeometry(0.06 + Math.random() * 0.04, 6, 5), stoneMat);
    stone.position.set(sp[0], 0.2, lz - 4 + sp[1]);
    stone.scale.y = 0.5;
    group.add(stone);
  });

  // --- Waiting area (2 modern benches) ---
  var benchMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.6 });
  [-5, 5].forEach(function(bx) {
    var benchSeat = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.08, 0.6), benchMat);
    benchSeat.position.set(bx, 0.45, lz - 2);
    benchSeat.castShadow = true;
    group.add(benchSeat);
    // Chrome legs
    [-1, 1].forEach(function(lx) {
      var benchLeg = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 0.5), chromeMat);
      benchLeg.position.set(bx + lx, 0.22, lz - 2);
      group.add(benchLeg);
    });
  });

  // --- Pendant lights above reception ---
  [-1.2, 0, 1.2].forEach(function(px) {
    var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 2.5, 4),
      new THREE.MeshStandardMaterial({ color: 0x333333 }));
    wire.position.set(px, WALL_H - 1.25, lz);
    group.add(wire);
    var shade = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: 0xffeedd, emissiveIntensity: 0.4, transparent: true, opacity: 0.8 }));
    shade.position.set(px, WALL_H - 2.6, lz);
    group.add(shade);
  });
  // Warm light for reception area
  var receptionLight = new THREE.PointLight(0xffeedd, 0.4, 8);
  receptionLight.position.set(0, 4, lz);
  group.add(receptionLight);

  // RECEPTION sign (gold, above logo wall)
  var signDiv = document.createElement('div');
  signDiv.textContent = 'RECEPTION';
  signDiv.style.cssText = 'color:#d4af37;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:3px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, 4.5, lz);
  group.add(sign);

  S.furnitureGroup.add(group);
}

// ==================== GAMING DESK ====================
function buildGamingDesk(x, z, index) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);

  // L-shaped desk (main + side wing)
  var deskColor = 0x1a1a2e;
  var deskMat = new THREE.MeshStandardMaterial({ color: deskColor, roughness: 0.3, metalness: 0.1 });

  // Main desktop
  var mainTop = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.9), deskMat);
  mainTop.position.y = 0.76; mainTop.castShadow = true; mainTop.receiveShadow = true;
  group.add(mainTop);

  // RGB LED strip under desk edge (front)
  var rgbColors = [0x58a6ff, 0xa855f7, 0x22c55e, 0xef4444, 0x06b6d4, 0xec4899];
  var rgbColor = rgbColors[index % rgbColors.length];
  var rgbMat = new THREE.MeshStandardMaterial({ color: rgbColor, emissive: rgbColor, emissiveIntensity: 0.8, roughness: 0.2 });
  var rgbStrip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.015, 0.015), rgbMat);
  rgbStrip.position.set(0, 0.74, 0.44);
  group.add(rgbStrip);

  // Carbon fiber legs (angular, gaming style)
  var legMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.2 });
  [[-0.85, -0.35], [-0.85, 0.35], [0.85, -0.35], [0.85, 0.35]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), legMat);
    leg.position.set(p[0], 0.38, p[1]);
    leg.castShadow = true;
    group.add(leg);
  });

  // Curved ultrawide monitor (wider, thinner)
  var monBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.35, 0.03), new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 }));
  monBody.position.set(0, 1.15, -0.25);
  monBody.castShadow = true;
  group.add(monBody);

  // Monitor screen
  var screenGeo = new THREE.PlaneGeometry(0.64, 0.3);
  var screenMat = new THREE.MeshStandardMaterial({
    color: 0x333333, emissive: 0x333333, emissiveIntensity: 0.1, roughness: 0.2
  });
  var screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 1.15, -0.234);
  group.add(screen);

  // Monitor stand (V-shaped, chrome)
  var standMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.15, metalness: 0.7 });
  var standArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.04), standMat);
  standArm.position.set(0, 0.92, -0.25);
  group.add(standArm);
  var standBase = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.15), standMat);
  standBase.position.set(0, 0.78, -0.25);
  group.add(standBase);

  // PC tower under desk (with RGB glow)
  var pcMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });
  var pcCase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.45), pcMat);
  pcCase.position.set(0.7, 0.23, 0);
  pcCase.castShadow = true;
  group.add(pcCase);
  // RGB glass panel on PC
  var pcGlowMat = new THREE.MeshStandardMaterial({ color: rgbColor, emissive: rgbColor, emissiveIntensity: 0.4, transparent: true, opacity: 0.5 });
  var pcGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.4), pcGlowMat);
  pcGlow.position.set(0.7 + 0.115, 0.23, 0);
  pcGlow.rotation.y = Math.PI / 2;
  group.add(pcGlow);

  // Keyboard
  var kbMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.12), kbMat);
  kb.position.set(-0.1, 0.78, 0.15);
  group.add(kb);

  // Mouse + mousepad
  var padMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });
  var pad = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.005, 0.2), padMat);
  pad.position.set(0.3, 0.765, 0.15);
  group.add(pad);
  var mouseMat2 = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
  var mouse = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.07), mouseMat2);
  mouse.position.set(0.3, 0.78, 0.15);
  group.add(mouse);

  // Gaming chair (racing style)
  buildGamingChair(group, 0, 0.7, rgbColor);

  S.furnitureGroup.add(group);
  S.deskMeshes.push({ group: group, screen: screen, screenMat: screenMat, index: index, x: x, z: z });
}

// ==================== GAMING CHAIR ====================
function buildGamingChair(parent, cx, cz, accentColor) {
  var chairGroup = new THREE.Group();
  chairGroup.position.set(cx, 0, cz);

  var baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
  var seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.65 });
  var accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });

  // 5-star base
  var baseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), baseMat);
  baseHub.position.y = 0.05;
  chairGroup.add(baseHub);
  for (var i = 0; i < 5; i++) {
    var a = (i / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.03), baseMat);
    arm.position.set(Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15);
    arm.rotation.y = -a;
    chairGroup.add(arm);
    // Wheel
    var wheel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), baseMat);
    wheel.position.set(Math.cos(a) * 0.28, 0.025, Math.sin(a) * 0.28);
    chairGroup.add(wheel);
  }

  // Gas cylinder
  var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8), baseMat);
  cyl.position.y = 0.25;
  chairGroup.add(cyl);

  // Seat
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.42), seatMat);
  seat.position.y = 0.46;
  seat.castShadow = true;
  chairGroup.add(seat);

  // Backrest (tall, racing-style with wings)
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.06), seatMat);
  back.position.set(0, 0.78, 0.2);
  back.castShadow = true;
  chairGroup.add(back);

  // Headrest
  var headrest = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.06), seatMat);
  headrest.position.set(0, 1.1, 0.2);
  chairGroup.add(headrest);

  // Accent stripes on backrest
  var stripe1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.005), accentMat);
  stripe1.position.set(-0.12, 0.78, 0.17);
  chairGroup.add(stripe1);
  var stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.005), accentMat);
  stripe2.position.set(0.12, 0.78, 0.17);
  chairGroup.add(stripe2);

  // Armrests
  [-0.22, 0.22].forEach(function(ax) {
    var armPost = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), baseMat);
    armPost.position.set(ax, 0.55, 0.05);
    chairGroup.add(armPost);
    var armPad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.2), seatMat);
    armPad.position.set(ax, 0.66, 0.05);
    chairGroup.add(armPad);
  });

  parent.add(chairGroup);
}

// ==================== MODERN CHAIR (for meeting rooms) ====================
function buildModernChair(x, y, z, rotation, chromeMat) {
  var group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotation;

  var seatMat = new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.7 });
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), seatMat);
  seat.position.y = 0.45; seat.castShadow = true;
  group.add(seat);
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.04), seatMat);
  back.position.set(0, 0.7, 0.18); back.castShadow = true;
  group.add(back);
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), chromeMat);
  post.position.y = 0.22;
  group.add(post);

  S.furnitureGroup.add(group);
}

// ==================== SOFA ====================
function buildSofa(x, y, z) {
  var group = new THREE.Group();
  group.position.set(x, y, z);

  var sofaMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3e, roughness: 0.75 });
  // Base
  var base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.35, 0.9), sofaMat);
  base.position.y = 0.2; base.castShadow = true;
  group.add(base);
  // Backrest
  var backrest = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.2), sofaMat);
  backrest.position.set(0, 0.55, -0.35); backrest.castShadow = true;
  group.add(backrest);
  // Armrests
  [-1.4, 1.4].forEach(function(ax) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.9), sofaMat);
    arm.position.set(ax, 0.4, 0); arm.castShadow = true;
    group.add(arm);
  });
  // Cushions
  var cushionMat = new THREE.MeshStandardMaterial({ color: 0x3a3a5e, roughness: 0.8 });
  [-0.8, 0, 0.8].forEach(function(cx2) {
    var cushion = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.1, 0.7), cushionMat);
    cushion.position.set(cx2, 0.42, 0.05);
    group.add(cushion);
  });

  S.furnitureGroup.add(group);
}

// ==================== MANAGER'S OFFICE ====================
function buildManagerOffice(x, z, glassMat, frameMat, walnutMat, leatherMat, chromeMat) {
  var offW = 8, offD = 7, wallH = 4;
  var group = new THREE.Group();
  group.position.set(x, 0, z);

  // --- Raised floor (dark walnut) ---
  var floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5 });
  var floor = new THREE.Mesh(new THREE.BoxGeometry(offW, 0.06, offD), floorMat);
  floor.position.y = 0.03; floor.receiveShadow = true;
  group.add(floor);

  // --- Glass walls with frosted privacy strip ---
  var clearGlass = new THREE.MeshStandardMaterial({ color: 0xaaccee, transparent: true, opacity: 0.2, roughness: 0.05, metalness: 0.1, side: THREE.DoubleSide });
  var frostedGlass = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, transparent: true, opacity: 0.5, roughness: 0.4, side: THREE.DoubleSide });

  // Front wall (with door gap in center)
  var doorW = 1.2;
  // Left section of front wall
  var fwLeft = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, wallH), clearGlass);
  fwLeft.position.set(-(offW + doorW) / 4, wallH / 2, -offD / 2);
  group.add(fwLeft);
  // Right section of front wall
  var fwRight = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, wallH), clearGlass);
  fwRight.position.set((offW + doorW) / 4, wallH / 2, -offD / 2);
  group.add(fwRight);
  // Frosted strip on front walls (waist-height privacy)
  var frostLeft = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, 0.8), frostedGlass);
  frostLeft.position.set(-(offW + doorW) / 4, 1.2, -offD / 2 + 0.01);
  group.add(frostLeft);
  var frostRight = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, 0.8), frostedGlass);
  frostRight.position.set((offW + doorW) / 4, 1.2, -offD / 2 + 0.01);
  group.add(frostRight);

  // Glass sliding door (animated)
  var doorGlass = new THREE.MeshStandardMaterial({ color: 0xbbddff, transparent: true, opacity: 0.3, roughness: 0.05, side: THREE.DoubleSide });
  var door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, wallH - 0.2), doorGlass);
  door.position.set(0, wallH / 2, -offD / 2);
  group.add(door);
  // Door handle (chrome bar)
  var handleMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.1, metalness: 0.8 });
  var handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.3, 0.04), handleMat);
  handle.position.set(doorW / 2 - 0.1, 1.1, -offD / 2 + 0.03);
  group.add(handle);
  // Store door ref for animation
  S._managerDoor = door;
  S._managerDoorOpen = 0; // 0=closed, 1=open (lerp target)
  S._managerDoorLerp = 0;
  S._managerDoorClosedZ = -offD / 2;

  // Left glass wall
  var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(offD, wallH), clearGlass);
  leftWall.position.set(-offW / 2, wallH / 2, 0);
  leftWall.rotation.y = Math.PI / 2;
  group.add(leftWall);
  var frostLeftW = new THREE.Mesh(new THREE.PlaneGeometry(offD, 0.8), frostedGlass);
  frostLeftW.position.set(-offW / 2 + 0.01, 1.2, 0);
  frostLeftW.rotation.y = Math.PI / 2;
  group.add(frostLeftW);

  // Right glass wall
  var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(offD, wallH), clearGlass);
  rightWall.position.set(offW / 2, wallH / 2, 0);
  rightWall.rotation.y = -Math.PI / 2;
  group.add(rightWall);
  var frostRightW = new THREE.Mesh(new THREE.PlaneGeometry(offD, 0.8), frostedGlass);
  frostRightW.position.set(offW / 2 - 0.01, 1.2, 0);
  frostRightW.rotation.y = -Math.PI / 2;
  group.add(frostRightW);

  // Back glass wall
  var backWall = new THREE.Mesh(new THREE.PlaneGeometry(offW, wallH), clearGlass);
  backWall.position.set(0, wallH / 2, offD / 2);
  backWall.rotation.y = Math.PI;
  group.add(backWall);
  var frostBackW = new THREE.Mesh(new THREE.PlaneGeometry(offW, 0.8), frostedGlass);
  frostBackW.position.set(0, 1.2, offD / 2 - 0.01);
  frostBackW.rotation.y = Math.PI;
  group.add(frostBackW);

  // --- Chrome frame structure ---
  // Top beams (all 4 sides)
  // Front beam
  var beamFront = new THREE.Mesh(new THREE.BoxGeometry(offW, 0.06, 0.06), frameMat);
  beamFront.position.set(0, wallH, -offD / 2); group.add(beamFront);
  // Back beam
  var beamBack = new THREE.Mesh(new THREE.BoxGeometry(offW, 0.06, 0.06), frameMat);
  beamBack.position.set(0, wallH, offD / 2); group.add(beamBack);
  // Left beam
  var beamLeft = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, offD), frameMat);
  beamLeft.position.set(-offW / 2, wallH, 0); group.add(beamLeft);
  // Right beam
  var beamRight = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, offD), frameMat);
  beamRight.position.set(offW / 2, wallH, 0); group.add(beamRight);
  // Vertical corner posts (all 4 corners)
  [[-offW / 2, -offD / 2], [-offW / 2, offD / 2], [offW / 2, -offD / 2], [offW / 2, offD / 2]].forEach(function(p) {
    var post = new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 0.06), frameMat);
    post.position.set(p[0], wallH / 2, p[1]);
    group.add(post);
  });
  // Door frame posts
  [-doorW / 2 - 0.03, doorW / 2 + 0.03].forEach(function(dx) {
    var doorPost = new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 0.06), frameMat);
    doorPost.position.set(dx, wallH / 2, -offD / 2);
    group.add(doorPost);
  });
  // Door top beam
  var doorTopBeam = new THREE.Mesh(new THREE.BoxGeometry(doorW + 0.12, 0.06, 0.06), frameMat);
  doorTopBeam.position.set(0, wallH, -offD / 2);
  group.add(doorTopBeam);

  // --- L-shaped executive desk (walnut + marble top) ---
  var marbleTopMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.12, metalness: 0.05 });
  // Main section
  var deskMain = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.06, 1.2), walnutMat);
  deskMain.position.set(0, 0.78, 1.5); deskMain.castShadow = true;
  group.add(deskMain);
  var marbleTop1 = new THREE.Mesh(new THREE.BoxGeometry(2.82, 0.015, 1.22), marbleTopMat);
  marbleTop1.position.set(0, 0.82, 1.5);
  group.add(marbleTop1);
  // Side wing
  var deskWing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.8), walnutMat);
  deskWing.position.set(1.6, 0.78, 0.7); deskWing.castShadow = true;
  group.add(deskWing);
  var marbleTop2 = new THREE.Mesh(new THREE.BoxGeometry(1.22, 0.015, 0.82), marbleTopMat);
  marbleTop2.position.set(1.6, 0.82, 0.7);
  group.add(marbleTop2);
  // Desk legs (chrome, elegant)
  [[-1.2, 1], [-1.2, 2], [1.2, 2], [1.2, 1], [2.1, 0.4], [2.1, 1]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.78, 8), chromeMat);
    leg.position.set(p[0], 0.39, p[1]);
    group.add(leg);
  });
  // Cable management panel (dark, under desk back)
  var cablePanelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.5 });
  var cablePanel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 0.04), cablePanelMat);
  cablePanel.position.set(0, 0.5, 0.9);
  group.add(cablePanel);

  // --- Dual ultrawide monitors ---
  var monMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  [-0.45, 0.45].forEach(function(mx) {
    var mon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.35, 0.025), monMat);
    mon.position.set(mx, 1.15, 1.05); mon.castShadow = true;
    group.add(mon);
    // Screen
    var scrMat = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, emissive: 0x58a6ff, emissiveIntensity: 0.3, roughness: 0.1 });
    var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.3), scrMat);
    scr.position.set(mx, 1.15, 1.037);
    group.add(scr);
    // Stand
    var stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.22, 6), chromeMat);
    stand.position.set(mx, 0.95, 1.05);
    group.add(stand);
  });
  // Monitor arm (chrome, connecting both)
  var monArm = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.03, 0.03), chromeMat);
  monArm.position.set(0, 1.0, 1.05);
  group.add(monArm);

  // --- Keyboard + mouse ---
  var kbMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.015, 0.12), kbMat);
  kb.position.set(-0.15, 0.835, 1.8);
  group.add(kb);
  var mouse = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.015, 0.06), kbMat);
  mouse.position.set(0.35, 0.835, 1.8);
  group.add(mouse);

  // --- Premium leather executive chair ---
  var chairG = new THREE.Group();
  chairG.position.set(0, 0, 2.4);
  // 5-star base
  var baseMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.4 });
  for (var ci = 0; ci < 5; ci++) {
    var ca = (ci / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.035), baseMat);
    arm.position.set(Math.cos(ca) * 0.16, 0.04, Math.sin(ca) * 0.16);
    arm.rotation.y = -ca;
    chairG.add(arm);
  }
  var cylM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), chromeMat);
  cylM.position.y = 0.26; chairG.add(cylM);
  // Wide seat
  var seatM = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), leatherMat);
  seatM.position.y = 0.5; seatM.castShadow = true; chairG.add(seatM);
  // Tall padded backrest
  var backM = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.7, 0.08), leatherMat);
  backM.position.set(0, 0.9, 0.24); backM.castShadow = true; chairG.add(backM);
  // Headrest
  var headM = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), leatherMat);
  headM.position.set(0, 1.3, 0.24); chairG.add(headM);
  // Armrests
  [-0.27, 0.27].forEach(function(ax) {
    var armPost = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.04), baseMat);
    armPost.position.set(ax, 0.6, 0.08); chairG.add(armPost);
    var armPad = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.25), leatherMat);
    armPad.position.set(ax, 0.73, 0.08); chairG.add(armPad);
  });
  group.add(chairG);

  // --- Bookshelf (right wall, walnut) ---
  var shelfGroup = new THREE.Group();
  shelfGroup.position.set(3.2, 0, 0.5);
  var shelfBack = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 1.4), walnutMat);
  shelfBack.position.y = 1.1; shelfBack.castShadow = true;
  shelfGroup.add(shelfBack);
  [0.05, 0.55, 1.1, 1.65, 2.15].forEach(function(sy) {
    var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 1.4), walnutMat);
    shelf.position.set(0.12, sy, 0); shelf.receiveShadow = true;
    shelfGroup.add(shelf);
  });
  // Books
  var bookColors = [0xc0392b, 0x2980b9, 0x8e44ad, 0xd4a24e, 0x1abc9c, 0x2c3e50];
  [0.09, 0.59, 1.14, 1.69].forEach(function(sy, si) {
    var startZ = -0.55;
    for (var bi2 = 0; bi2 < 5; bi2++) {
      var bh = 0.32 + Math.sin(si + bi2) * 0.08;
      var bw = 0.04 + Math.sin(si * 3 + bi2) * 0.015;
      var bMat = new THREE.MeshStandardMaterial({ color: bookColors[(si * 3 + bi2) % bookColors.length], roughness: 0.8 });
      var book = new THREE.Mesh(new THREE.BoxGeometry(0.18, bh, bw), bMat);
      book.position.set(0.16, sy + bh / 2, startZ);
      shelfGroup.add(book);
      startZ += bw + 0.02;
    }
  });
  group.add(shelfGroup);

  // --- Small sofa + coffee table ---
  var sofaMat = new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.7 });
  var sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2, 0.3, 0.7), sofaMat);
  sofaBase.position.set(-2.5, 0.18, -0.5); sofaBase.castShadow = true;
  group.add(sofaBase);
  var sofaBack = new THREE.Mesh(new THREE.BoxGeometry(2, 0.4, 0.15), sofaMat);
  sofaBack.position.set(-2.5, 0.45, -0.85); sofaBack.castShadow = true;
  group.add(sofaBack);
  // Cushions
  var cushionMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.8 });
  [-3.1, -2.5, -1.9].forEach(function(cx) {
    var cushion = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.55), cushionMat);
    cushion.position.set(cx, 0.36, -0.5);
    group.add(cushion);
  });
  // Coffee table (glass top, chrome legs)
  var coffeeGlassMat = new THREE.MeshStandardMaterial({ color: 0xccddee, transparent: true, opacity: 0.35, roughness: 0.05 });
  var coffeeTop = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.5), coffeeGlassMat);
  coffeeTop.position.set(-2.5, 0.45, 0.2);
  group.add(coffeeTop);
  [-0.4, 0.4].forEach(function(lx) {
    [-0.18, 0.18].forEach(function(lz) {
      var cLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), chromeMat);
      cLeg.position.set(-2.5 + lx, 0.22, 0.2 + lz);
      group.add(cLeg);
    });
  });

  // --- Luxury plant ---
  var planterMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.5 });
  var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.5, 12), planterMat);
  planter.position.set(3, 0.25, -2.5); planter.castShadow = true;
  group.add(planter);
  var leafMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.8 });
  for (var pi = 0; pi < 6; pi++) {
    var pa = (pi / 6) * Math.PI * 2;
    var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), leafMat);
    leaf.position.set(3 + Math.cos(pa) * 0.15, 0.6, -2.5 + Math.sin(pa) * 0.15);
    group.add(leaf);
  }
  var topL = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), leafMat);
  topL.position.set(3, 0.75, -2.5); group.add(topL);

  // --- Gold accent artwork frame on back wall ---
  var goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.7 });
  // Frame
  var artFrameTop = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.06), goldMat);
  artFrameTop.position.set(0, 3.2, offD / 2 - 0.08); group.add(artFrameTop);
  var artFrameBot = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.06), goldMat);
  artFrameBot.position.set(0, 2.0, offD / 2 - 0.08); group.add(artFrameBot);
  var artFrameL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.26, 0.06), goldMat);
  artFrameL.position.set(-0.8, 2.6, offD / 2 - 0.08); group.add(artFrameL);
  var artFrameR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.26, 0.06), goldMat);
  artFrameR.position.set(0.8, 2.6, offD / 2 - 0.08); group.add(artFrameR);
  // Canvas inside frame (dark elegant)
  var artMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.8 });
  var art = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), artMat);
  art.position.set(0, 2.6, offD / 2 - 0.06);
  art.rotation.y = Math.PI;
  group.add(art);

  // --- Warm ambient lighting ---
  var warmLight1 = new THREE.PointLight(0xffeedd, 0.4, 8);
  warmLight1.position.set(0, 3.5, 1.5);
  group.add(warmLight1);
  var warmLight2 = new THREE.PointLight(0xffeedd, 0.2, 5);
  warmLight2.position.set(-2, 2, 0);
  group.add(warmLight2);

  // --- Pendant light (premium, gold accent) ---
  var pendWire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2), new THREE.MeshStandardMaterial({ color: 0x333333 }));
  pendWire.position.set(0, wallH - 1, 1.5);
  group.add(pendWire);
  var pendShade = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.2, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
  pendShade.position.set(0, wallH - 2.1, 1.5);
  group.add(pendShade);
  var pendRim = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.01, 6, 24), goldMat);
  pendRim.position.set(0, wallH - 2.2, 1.5);
  pendRim.rotation.x = Math.PI / 2;
  group.add(pendRim);

  // --- "MANAGER" gold sign above door ---
  var signDiv = document.createElement('div');
  signDiv.textContent = 'MANAGER';
  signDiv.style.cssText = 'color:#d4af37;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:3px;text-shadow:0 0 6px rgba(212,175,55,0.4);';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, wallH + 0.3, -offD / 2);
  group.add(sign);

  S.furnitureGroup.add(group);
  S._managerOfficeGroup = group;
  S._managerOfficePos = { x: x, z: z };

  // Register manager desk in deskMeshes so monitor screen system works
  var mgrDeskIdx = CAMPUS_DESKS.length - 1;
  var mgrScreenMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x333333, emissiveIntensity: 0.1, roughness: 0.2 });
  S.deskMeshes[mgrDeskIdx] = { group: group, screen: null, screenMat: mgrScreenMat, index: mgrDeskIdx, x: x, z: z + 1.7 };
}

// ==================== DESIGNER STUDIO ====================
function buildDesignerStudio(x, z, walnutMat, chromeMat) {
  // Mood board wall
  var boardMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.5 });
  var board = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2, 4), boardMat);
  board.position.set(x - 5.5, 1.5, z);
  board.castShadow = true;
  S.furnitureGroup.add(board);
  // Colorful sticky notes on board
  var noteColors = [0xfbbf24, 0xf87171, 0x34d399, 0x60a5fa, 0xa78bfa, 0xfb923c];
  for (var ni = 0; ni < 12; ni++) {
    var noteMat = new THREE.MeshStandardMaterial({ color: noteColors[ni % noteColors.length], roughness: 0.9 });
    var note = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.3), noteMat);
    note.position.set(x - 5.44, 0.8 + Math.floor(ni / 4) * 0.5, z - 1.5 + (ni % 4) * 0.8);
    note.rotation.y = Math.PI / 2;
    S.furnitureGroup.add(note);
  }

  // Standing desk
  var standDesk = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.8), walnutMat);
  standDesk.position.set(x - 2, 1.1, z + 3);
  standDesk.castShadow = true;
  S.furnitureGroup.add(standDesk);
  // Adjustable legs
  [-0.7, 0.7].forEach(function(lx) {
    var standLeg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.1, 0.06), chromeMat);
    standLeg.position.set(x - 2 + lx, 0.55, z + 3);
    S.furnitureGroup.add(standLeg);
  });

  // "DESIGN LAB" sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'DESIGN LAB';
  signDiv.style.cssText = 'color:#a855f7;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 3.5, z);
  S.furnitureGroup.add(sign);
}

// ==================== BAR & CAFÉ ====================
function buildBar(x, z, walnutMat, chromeMat, neonBlueMat, neonPurpleMat) {
  // Long bar counter
  var barTop = new THREE.Mesh(new THREE.BoxGeometry(6, 0.08, 1.2), walnutMat);
  barTop.position.set(x, 1.1, z); barTop.castShadow = true;
  S.furnitureGroup.add(barTop);
  var barFront = new THREE.Mesh(new THREE.BoxGeometry(6, 1.1, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.4 }));
  barFront.position.set(x, 0.55, z + 0.55);
  barFront.castShadow = true;
  S.furnitureGroup.add(barFront);

  // LED strip under bar counter
  var barLed = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.02, 0.02), neonBlueMat);
  barLed.position.set(x, 1.02, z + 0.58);
  S.furnitureGroup.add(barLed);

  // Bar stools (5)
  for (var si = 0; si < 5; si++) {
    var sx = x - 2 + si * 1;
    var stoolGroup = new THREE.Group();
    stoolGroup.position.set(sx, 0, z + 1.2);
    var stoolSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.6 }));
    stoolSeat.position.y = 0.75;
    stoolGroup.add(stoolSeat);
    var stoolPost = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), chromeMat);
    stoolPost.position.y = 0.38;
    stoolGroup.add(stoolPost);
    var stoolBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 12), chromeMat);
    stoolBase.position.y = 0.04;
    stoolGroup.add(stoolBase);
    S.furnitureGroup.add(stoolGroup);
  }

  // Bottle shelf behind bar
  var shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.6 });
  [1.5, 2.2, 2.9].forEach(function(sy) {
    var shelf = new THREE.Mesh(new THREE.BoxGeometry(5.5, 0.04, 0.3), shelfMat);
    shelf.position.set(x, sy, z - 0.9);
    S.furnitureGroup.add(shelf);
  });

  // Bottles on shelves
  var bottleColors = [0x2d8a4e, 0x8B4513, 0xd4af37, 0xcc3333, 0x1a5276, 0xf0f0f0];
  for (var bi = 0; bi < 15; bi++) {
    var bx = x - 2.5 + (bi % 5) * 1;
    var by = 1.55 + Math.floor(bi / 5) * 0.7;
    var bottleMat = new THREE.MeshStandardMaterial({ color: bottleColors[bi % bottleColors.length], roughness: 0.3, metalness: 0.1 });
    var bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.25, 8), bottleMat);
    bottle.position.set(bx, by + 0.12, z - 0.85);
    S.furnitureGroup.add(bottle);
    var bottleNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.1, 6), bottleMat);
    bottleNeck.position.set(bx, by + 0.3, z - 0.85);
    S.furnitureGroup.add(bottleNeck);
  }

  // Coffee machine
  var coffeeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.2 });
  var coffee = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.3), coffeeMat);
  coffee.position.set(x + 2.5, 1.4, z - 0.1);
  coffee.castShadow = true;
  S.furnitureGroup.add(coffee);

  // "BAR" neon sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'BAR & CAFÉ';
  signDiv.style.cssText = 'color:#a855f7;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #a855f7;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 3.5, z - 1);
  S.furnitureGroup.add(sign);
}

// ==================== RECREATION CENTER ====================
function buildRecCenter(x, z, walnutMat, chromeMat, carpetMat) {
  // Carpet area
  var recCarpet = new THREE.Mesh(new THREE.PlaneGeometry(10, 8), carpetMat);
  recCarpet.rotation.x = -Math.PI / 2;
  recCarpet.position.set(x, 0.01, z);
  recCarpet.receiveShadow = true;
  S.furnitureGroup.add(recCarpet);

  // Pool table
  var ptGroup = new THREE.Group();
  ptGroup.position.set(x - 2, 0, z);
  var ptTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.1, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x006633, roughness: 0.9 }));
  ptTop.position.y = 0.85; ptTop.castShadow = true;
  ptGroup.add(ptTop);
  var ptFrame = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.15, 1.4), walnutMat);
  ptFrame.position.y = 0.78; ptFrame.castShadow = true;
  ptGroup.add(ptFrame);
  // Legs
  [[-1.1, -0.55], [-1.1, 0.55], [1.1, -0.55], [1.1, 0.55]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 8), walnutMat);
    leg.position.set(p[0], 0.35, p[1]);
    ptGroup.add(leg);
  });
  S.furnitureGroup.add(ptGroup);

  // Foosball table
  var fbGroup = new THREE.Group();
  fbGroup.position.set(x + 2.5, 0, z);
  var fbBody = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.2, 0.75),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.6 }));
  fbBody.position.y = 0.85; fbBody.castShadow = true;
  fbGroup.add(fbBody);
  var fbField = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.02, 0.6),
    new THREE.MeshStandardMaterial({ color: 0x006633, roughness: 0.8 }));
  fbField.position.y = 0.96;
  fbGroup.add(fbField);
  // Legs
  [[-0.6, -0.3], [-0.6, 0.3], [0.6, -0.3], [0.6, 0.3]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), chromeMat);
    leg.position.set(p[0], 0.38, p[1]);
    fbGroup.add(leg);
  });
  // Rods
  [-0.3, 0, 0.3].forEach(function(rz) {
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.9, 6), chromeMat);
    rod.position.set(0, 0.98, rz);
    rod.rotation.z = Math.PI / 2;
    fbGroup.add(rod);
  });
  S.furnitureGroup.add(fbGroup);

  // Beanbags
  var bbColors = [0xe53e3e, 0x3b82f6, 0x22c55e, 0xa855f7];
  [{ x: -1, z: 3 }, { x: 1.5, z: 3.5 }, { x: 3, z: 2.5 }, { x: -2.5, z: 3.5 }].forEach(function(bp, bi) {
    var bbMat = new THREE.MeshStandardMaterial({ color: bbColors[bi], roughness: 0.9 });
    var bot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), bbMat);
    bot.position.set(x + bp.x, 0.22, z + bp.z);
    bot.scale.set(1, 0.5, 1);
    bot.castShadow = true;
    S.furnitureGroup.add(bot);
  });

  // Static decorative TV (smaller, no dashboard — main TV is at reception)
  var tvMat2 = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var tvBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.08), tvMat2);
  tvBody.position.set(x, 2.3, z - 3.8);
  tvBody.castShadow = true;
  S.furnitureGroup.add(tvBody);
  var tvScr = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x0a1520, emissive: 0x22c55e, emissiveIntensity: 0.15, roughness: 0.1 }));
  tvScr.position.set(x, 2.3, z - 3.75);
  S.furnitureGroup.add(tvScr);

  // "REC ZONE" sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'REC ZONE';
  signDiv.style.cssText = 'color:#22c55e;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #22c55e;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4.5, z);
  S.furnitureGroup.add(sign);
}

// ==================== GYM ====================
function buildGym(x, z, chromeMat, darkMat) {
  // Rubber floor
  var rubberMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 });
  var gymFloor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), rubberMat);
  gymFloor.rotation.x = -Math.PI / 2;
  gymFloor.position.set(x, 0.01, z);
  gymFloor.receiveShadow = true;
  S.furnitureGroup.add(gymFloor);

  // Treadmill
  var tmGroup = new THREE.Group();
  tmGroup.position.set(x - 1.5, 0, z - 2);
  var tmBase = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.15, 1.6), darkMat);
  tmBase.position.y = 0.1; tmBase.castShadow = true;
  tmGroup.add(tmBase);
  var tmBelt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.02, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }));
  tmBelt.position.y = 0.19;
  tmGroup.add(tmBelt);
  // Handles
  [-0.3, 0.3].forEach(function(hx) {
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1, 6), chromeMat);
    handle.position.set(hx, 0.7, -0.6);
    tmGroup.add(handle);
  });
  var console2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.08), darkMat);
  console2.position.set(0, 1.1, -0.65);
  tmGroup.add(console2);
  S.furnitureGroup.add(tmGroup);

  // Dumbbell rack
  var rackBase = new THREE.Mesh(new THREE.BoxGeometry(2, 0.8, 0.4), chromeMat);
  rackBase.position.set(x + 1.5, 0.4, z - 3);
  rackBase.castShadow = true;
  S.furnitureGroup.add(rackBase);
  // Dumbbells on rack
  for (var di = 0; di < 5; di++) {
    var dbMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.4 });
    var db = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), dbMat);
    db.position.set(x + 0.7 + di * 0.35, 0.9, z - 3);
    db.rotation.z = Math.PI / 2;
    S.furnitureGroup.add(db);
  }

  // Yoga mat area
  var yogaMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.9 });
  var mat = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 1.8), yogaMat);
  mat.position.set(x + 2, 0.02, z + 1);
  S.furnitureGroup.add(mat);
  var mat2 = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.02, 1.8),
    new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.9 }));
  mat2.position.set(x + 3, 0.02, z + 1);
  S.furnitureGroup.add(mat2);

  // "FITNESS" sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'FITNESS';
  signDiv.style.cssText = 'color:#ef4444;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #ef4444;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4, z);
  S.furnitureGroup.add(sign);
}

// ==================== PLANTS ====================
function buildCampusPlants() {
  var plantPositions = [
    [-20, 8], [20, 8], [-20, -5], [20, -5],
    [-8, 10], [8, 10], [-8, -8], [8, -8],
    [0, 10], [-15, 5], [15, 5],
    [-6, -10], [6, -10],
  ];
  plantPositions.forEach(function(pos) {
    buildLuxuryPlant(pos[0], pos[1]);
  });

  // Indoor trees (taller, premium)
  [[-18, 0], [18, 0], [0, -7]].forEach(function(pos) {
    buildIndoorTree(pos[0], pos[1]);
  });
}

function buildLuxuryPlant(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  // Concrete planter
  var planterMat = new THREE.MeshStandardMaterial({ color: 0x4a4a5a, roughness: 0.6 });
  var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.5, 12), planterMat);
  planter.position.y = 0.25; planter.castShadow = true;
  group.add(planter);
  // Lush greenery
  var leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.8 });
  for (var i = 0; i < 6; i++) {
    var a = (i / 6) * Math.PI * 2;
    var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), leafMat);
    leaf.position.set(Math.cos(a) * 0.15, 0.6, Math.sin(a) * 0.15);
    leaf.castShadow = true;
    group.add(leaf);
  }
  var topLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), leafMat);
  topLeaf.position.y = 0.75;
  group.add(topLeaf);
  S.furnitureGroup.add(group);
}

function buildIndoorTree(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  // Large planter
  var planterMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.5 });
  var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 0.6, 12), planterMat);
  planter.position.y = 0.3; planter.castShadow = true;
  group.add(planter);
  // Trunk
  var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.8 });
  var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.5, 8), trunkMat);
  trunk.position.y = 1.85; trunk.castShadow = true;
  group.add(trunk);
  // Canopy (layered spheres)
  var canopyMat = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.85 });
  var canopyMat2 = new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.85 });
  [{ y: 2.8, r: 0.6 }, { y: 3.2, r: 0.5 }, { y: 3.5, r: 0.35 }].forEach(function(c, ci) {
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(c.r, 12, 10), ci % 2 === 0 ? canopyMat : canopyMat2);
    canopy.position.y = c.y;
    canopy.castShadow = true;
    group.add(canopy);
  });
  S.furnitureGroup.add(group);
}

// ==================== PENDANT LIGHTS ====================
function buildPendantLights() {
  var lightPositions = [
    [0, 2], [0, -1], [0, -4],
    [-4.5, 2], [-4.5, -1], [-4.5, -4],
    [4.5, 2], [4.5, -1], [4.5, -4],
    [-12, 1], [-12, -2],
    [12, 5],
    [-14, -12], [0, -12], [14, -12],
  ];
  lightPositions.forEach(function(pos) {
    buildPendantLight(pos[0], pos[1]);
  });
}

function buildPendantLight(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  // Wire
  var wireMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
  var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.5, 4), wireMat);
  wire.position.y = WALL_H - 0.75;
  group.add(wire);
  // Shade (industrial style)
  var shadeMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  var shade = new THREE.Mesh(new THREE.ConeGeometry(0.25, 0.2, 12, 1, true), shadeMat);
  shade.position.y = WALL_H - 1.55;
  group.add(shade);
  // Warm light
  var light = new THREE.PointLight(0xffeedd, 0.25, 6);
  light.position.set(0, WALL_H - 1.7, 0);
  light.castShadow = false; // performance
  group.add(light);
  S.furnitureGroup.add(group);
}

// ==================== GLASS PARTITIONS ====================
function buildGlassPartitions(glassMat, frameMat) {
  // Between coder zone and rec area
  var partition1 = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.5), glassMat);
  partition1.position.set(0, 1.25, -7);
  S.furnitureGroup.add(partition1);
  var frame1 = new THREE.Mesh(new THREE.BoxGeometry(14, 0.04, 0.04), frameMat);
  frame1.position.set(0, 2.5, -7);
  S.furnitureGroup.add(frame1);

  // Between designer area and main
  var partition2 = new THREE.Mesh(new THREE.PlaneGeometry(10, 2.5), glassMat);
  partition2.position.set(-8, 1.25, 0);
  partition2.rotation.y = Math.PI / 2;
  S.furnitureGroup.add(partition2);
}

// ==================== NEON SIGNS ====================
function buildNeonSign(text, x, y, z, neonMat) {
  // Glow bar behind text
  var glowBar = new THREE.Mesh(new THREE.BoxGeometry(text.length * 0.4, 0.4, 0.04), neonMat);
  glowBar.position.set(x, y, z);
  S.furnitureGroup.add(glowBar);
  // CSS label
  var color = '#' + neonMat.color.getHexString();
  var div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = 'color:' + color + ';font-size:12px;font-weight:900;font-family:Inter,sans-serif;letter-spacing:4px;text-shadow:0 0 12px ' + color + ',0 0 24px ' + color + ';';
  var label = new CSS2DObject(div);
  label.position.set(x, y, z + 0.05);
  S.furnitureGroup.add(label);
}
