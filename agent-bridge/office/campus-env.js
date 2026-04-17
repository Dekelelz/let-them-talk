import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';

// ============================================================
// TECH HQ — Premium 2-floor environment
// Inspired by Apple Park / Bloomberg London
// ============================================================

var CAMPUS_W  = 90;   // total interior width  (X axis)
var CAMPUS_D  = 60;   // total interior depth  (Z axis)
var WALL_H    = 6;    // interior wall height
var MEZZ_H    = 3.2;  // mezzanine floor height
var MEZZ_DEPTH = 12;  // mezzanine depth from back wall

// ── 5×4 grid: X in [-8,-4,0,4,8], Z in [6,10,14,18]
// ── Manager office at world (30, 10)
var CAMPUS_DESKS = [
  // Row Z=6
  { x: -8, z: 6 }, { x: -4, z: 6 }, { x: 0, z: 6 }, { x: 4, z: 6 }, { x: 8, z: 6 },
  // Row Z=10
  { x: -8, z: 10 }, { x: -4, z: 10 }, { x: 0, z: 10 }, { x: 4, z: 10 }, { x: 8, z: 10 },
  // Row Z=14
  { x: -8, z: 14 }, { x: -4, z: 14 }, { x: 0, z: 14 }, { x: 4, z: 14 }, { x: 8, z: 14 },
  // Row Z=18
  { x: -8, z: 18 }, { x: -4, z: 18 }, { x: 0, z: 18 }, { x: 4, z: 18 }, { x: 8, z: 18 },
  // Manager office desk (index 20) — chair at world Z=12.7, agent walks to z+0.7
  { x: 30, z: 12.0 },
];

export function getCampusDeskPositions() {
  return CAMPUS_DESKS;
}

// ============================================================
// MAIN BUILD ENTRY
// ============================================================
export function buildCampusEnvironment() {
  S.deskMeshes = [];

  // ── Material palette (defined once, reused everywhere) ──────────
  var matBlack     = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.12, metalness: 0.05 });
  var matWhite     = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.15, metalness: 0.05 });
  var matWalnutDk  = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.55 });
  var matWalnutLt  = new THREE.MeshStandardMaterial({ color: 0x8B5E3C, roughness: 0.50 });
  var matChrPol    = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.08, metalness: 0.85 });
  var matChrBr     = new THREE.MeshStandardMaterial({ color: 0x999999, roughness: 0.25, metalness: 0.70 });
  var matGlassCl   = new THREE.MeshStandardMaterial({ color: 0xaaccee, roughness: 0.05, metalness: 0.10, transparent: true, opacity: 0.20, side: THREE.DoubleSide });
  var matGlassFr   = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, roughness: 0.40, transparent: true, opacity: 0.50, side: THREE.DoubleSide });
  var matConcrete  = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.85 });
  var matLeathBk   = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.70 });
  var matLeathCog  = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.65 });
  var matGold      = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.30, metalness: 0.70 });
  var matNeonBl    = new THREE.MeshStandardMaterial({ color: 0x58a6ff, emissive: new THREE.Color(0x58a6ff), emissiveIntensity: 0.60, roughness: 0.20 });
  var matNeonPu    = new THREE.MeshStandardMaterial({ color: 0xa855f7, emissive: new THREE.Color(0xa855f7), emissiveIntensity: 0.50, roughness: 0.20 });
  var matNeonGr    = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: new THREE.Color(0x22c55e), emissiveIntensity: 0.50, roughness: 0.20 });
  var matFabric    = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.95 });

  // ── Sub-builders ────────────────────────────────────────────────
  buildCampusFloor(matBlack, matWhite, matFabric);
  buildCampusWalls(matConcrete, matGlassCl, matChrBr, matGold, matWhite);
  buildCampusCeiling(matConcrete, matGlassCl);
  buildStructuralColumns(matWhite, matGold, matChrPol);
  buildMezzanine(matConcrete, matChrPol, matGlassCl, matWalnutDk, matFabric);
  buildStaircase(matWhite, matChrPol, matGlassCl);
  buildLobby(matWhite, matChrPol, matGold, matWalnutDk, matNeonBl);
  buildMainCorridor(matBlack, matGold);
  buildCrossCorridor(matBlack, matGold);

  // ── Gaming desks (skip manager desk at index 20) ────────────────
  var mgrIdx = CAMPUS_DESKS.length - 1;
  CAMPUS_DESKS.forEach(function(pos, i) {
    if (i === mgrIdx) return;
    buildGamingDesk(pos.x, pos.z, i);
  });

  // ── Manager's glass office ──────────────────────────────────────
  buildManagerOffice(30, 10, matGlassCl, matGlassFr, matChrBr, matWalnutDk, matLeathCog, matChrPol);

  // ── Zones ───────────────────────────────────────────────────────
  buildDesignerStudio(-28, 0, matWalnutLt, matChrPol);
  buildBar(-28, -18, matWalnutDk, matChrPol, matNeonBl, matNeonPu);
  buildJukebox(-18, -22);
  buildRecCenter(0, -18, matWalnutDk, matChrPol, matFabric);
  buildGym(22, -18, matChrPol, matConcrete);
  buildCampusPlants();
  buildPendantLights();
  buildGlassPartitions(matGlassCl, matChrBr);
  buildNeonSign('INNOVATE', -12, 4.5, -CAMPUS_D / 2 + 0.3, matNeonBl);
  buildNeonSign('CREATE',    12, 4.5, -CAMPUS_D / 2 + 0.3, matNeonPu);
  buildNeonSign('BUILD',      0, MEZZ_H + 2.2, -CAMPUS_D / 2 + MEZZ_DEPTH + 0.3, matNeonGr);
}

// ============================================================
// FLOOR — FBM dark marble, 90×60
// ============================================================
function buildCampusFloor(matBlack, matWhite, matFabric) {
  var size = 1024;
  var cvs = document.createElement('canvas');
  cvs.width = size; cvs.height = size;
  var ctx = cvs.getContext('2d');
  var tiles = 18;
  var ts = Math.floor(size / tiles);

  function noise(x, y) {
    var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  function smoothNoise(x, y) {
    var ix = Math.floor(x), iy = Math.floor(y);
    var fx = x - ix, fy = y - iy;
    var a = noise(ix, iy),     b = noise(ix + 1, iy);
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
      var isDark = (ti + tj) % 2 === 0;
      var bR = isDark ? 26 : 20, bG = isDark ? 28 : 22, bB = isDark ? 36 : 28;
      ctx.fillStyle = 'rgb(' + bR + ',' + bG + ',' + bB + ')';
      ctx.fillRect(tx, ty, ts, ts);
      var imgData = ctx.getImageData(tx, ty, ts, ts);
      var data = imgData.data;
      for (var py = 0; py < ts; py++) {
        for (var px = 0; px < ts; px++) {
          var wx = (ti * ts + px) / size * 7;
          var wy = (tj * ts + py) / size * 7;
          var vein  = Math.sin(wx * 3   + fbm(wx * 2,     wy * 2)     * 4)   * 0.5 + 0.5;
          var vein2 = Math.sin(wy * 2.5 + fbm(wx * 1.5+5, wy * 1.5+3) * 3.5) * 0.5 + 0.5;
          var combined = vein * 0.6 + vein2 * 0.4;
          var vs = Math.pow(combined, 3) * 0.38;
          var nv = smoothNoise(wx * 4, wy * 4) * 0.09;
          var idx = (py * ts + px) * 4;
          data[idx]     = Math.min(255, bR + vs * 130 + nv * 45);
          data[idx + 1] = Math.min(255, bG + vs * 110 + nv * 38);
          data[idx + 2] = Math.min(255, bB + vs * 65  + nv * 30);
          data[idx + 3] = 255;
        }
      }
      ctx.putImageData(imgData, tx, ty);
      ctx.strokeStyle = 'rgba(48,50,58,0.75)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx + 0.5, ty + 0.5, ts - 1, ts - 1);
    }
  }

  var floorTex = new THREE.CanvasTexture(cvs);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.anisotropy = 8;
  var floor = new THREE.Mesh(
    new THREE.PlaneGeometry(CAMPUS_W, CAMPUS_D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.10, metalness: 0.10 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  S.furnitureGroup.add(floor);

  // Carpet runner in workspace zone
  var carpet = new THREE.Mesh(new THREE.PlaneGeometry(26, 18), matFabric);
  carpet.rotation.x = -Math.PI / 2;
  carpet.position.set(0, 0.01, 12);
  carpet.receiveShadow = true;
  S.furnitureGroup.add(carpet);
}

// ============================================================
// WALLS — thick (0.4) BoxGeometry, recessed windows + frames
// ============================================================
function buildCampusWalls(matConcrete, matGlass, matFrame, matGold, matMarble) {
  var wallT = 0.4; // wall thickness
  var wallMat = new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.80 });
  var wSill = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.18, metalness: 0.06 });

  // Helper: build a recessed window into a wall segment
  function addWindow(wx, wy, wz, rotY, winW, winH) {
    var depth = wallT + 0.02;
    // Recess box (cut-out fill — dark interior)
    var recessMat = new THREE.MeshStandardMaterial({ color: 0x15171e, roughness: 0.9 });
    var recess = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.08, winH + 0.08, depth), recessMat);
    recess.position.set(wx, wy, wz);
    recess.rotation.y = rotY;
    S.furnitureGroup.add(recess);
    // Glass pane
    var glass = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), matGlass);
    glass.rotation.y = rotY;
    // Offset glass flush with inner face
    var nx = Math.sin(rotY) * (depth / 2 - 0.01);
    var nz = Math.cos(rotY) * (depth / 2 - 0.01);
    glass.position.set(wx - nx, wy, wz - nz);
    S.furnitureGroup.add(glass);
    // Chrome frame (4 sides)
    var ft = 0.05; // frame thickness
    var frameMat2 = matFrame;
    // horizontal top/bottom bars
    [wy + winH / 2 + ft / 2, wy - winH / 2 - ft / 2].forEach(function(fy) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(winW + ft * 2, ft, ft), frameMat2);
      bar.rotation.y = rotY;
      bar.position.set(wx - nx, fy, wz - nz);
      S.furnitureGroup.add(bar);
    });
    // vertical left/right bars
    [-winW / 2 - ft / 2, winW / 2 + ft / 2].forEach(function(dx) {
      var cos = Math.cos(rotY), sin = Math.sin(rotY);
      var vx = wx - nx + cos * dx;
      var vz = wz - nz - sin * dx;
      var bar = new THREE.Mesh(new THREE.BoxGeometry(ft, winH + ft * 2, ft), frameMat2);
      bar.position.set(vx, wy, vz);
      S.furnitureGroup.add(bar);
    });
    // Marble sill
    var sill = new THREE.Mesh(new THREE.BoxGeometry(winW + 0.12, 0.06, 0.20), wSill);
    sill.rotation.y = rotY;
    var sx = wx - nx + Math.sin(rotY) * 0.08;
    var sz = wz - nz + Math.cos(rotY) * 0.08;
    sill.position.set(sx, wy - winH / 2 - 0.01, sz);
    S.furnitureGroup.add(sill);
  }

  // ── BACK WALL (Z = -CAMPUS_D/2) ─────────────────────────────────
  var bwZ = -CAMPUS_D / 2;
  var bw = new THREE.Mesh(new THREE.BoxGeometry(CAMPUS_W, WALL_H, wallT), wallMat);
  bw.position.set(0, WALL_H / 2, bwZ);
  S.furnitureGroup.add(bw);
  // 5 back-wall windows above mezzanine
  [-32, -16, 0, 16, 32].forEach(function(wx) {
    addWindow(wx, MEZZ_H + 1.2, bwZ, 0, 5, 1.8);
  });

  // ── LEFT WALL (X = -CAMPUS_W/2) ─────────────────────────────────
  var lwX = -CAMPUS_W / 2;
  var lw = new THREE.Mesh(new THREE.BoxGeometry(wallT, WALL_H, CAMPUS_D), wallMat);
  lw.position.set(lwX, WALL_H / 2, 0);
  S.furnitureGroup.add(lw);
  // 5 windows at Z = -20,-10,0,10,20
  [-20, -10, 0, 10, 20].forEach(function(wz) {
    addWindow(lwX, 2.8, wz, Math.PI / 2, 4, 3.2);
  });

  // ── RIGHT WALL (X = +CAMPUS_W/2) — solid (gallery is now inside campus)
  var rwX = CAMPUS_W / 2;
  var rwFull = new THREE.Mesh(new THREE.BoxGeometry(wallT, WALL_H, CAMPUS_D), wallMat);
  rwFull.position.set(rwX, WALL_H / 2, 0);
  S.furnitureGroup.add(rwFull);

  // Right-wall windows
  [-20, -10, 0, 10, 20].forEach(function(wz) {
    addWindow(rwX, 2.8, wz, -Math.PI / 2, 4, 3.2);
  });

  // ── FRONT WALL (Z = +CAMPUS_D/2) — split with 6-unit entrance at center
  var fwZ = CAMPUS_D / 2;
  var entHalf = 3; // entrance half-width
  var fwSideLen = (CAMPUS_W - entHalf * 2) / 2;

  var fwLeft = new THREE.Mesh(new THREE.BoxGeometry(fwSideLen, WALL_H, wallT), wallMat);
  fwLeft.position.set(-(entHalf + fwSideLen / 2), WALL_H / 2, fwZ);
  S.furnitureGroup.add(fwLeft);

  var fwRight = new THREE.Mesh(new THREE.BoxGeometry(fwSideLen, WALL_H, wallT), wallMat);
  fwRight.position.set(entHalf + fwSideLen / 2, WALL_H / 2, fwZ);
  S.furnitureGroup.add(fwRight);

  // Gold entrance lintel above opening
  var lintel = new THREE.Mesh(new THREE.BoxGeometry(entHalf * 2 + 0.4, 0.18, wallT + 0.02), matGold);
  lintel.position.set(0, WALL_H - 0.09, fwZ);
  S.furnitureGroup.add(lintel);

  // Gold threshold strip at floor
  var thresh = new THREE.Mesh(new THREE.BoxGeometry(entHalf * 2, 0.04, 0.30), matGold);
  thresh.position.set(0, 0.02, fwZ - 0.15);
  S.furnitureGroup.add(thresh);
}

// ============================================================
// CEILING — coffered grid (6 X-beams + 10 Z-beams), 5 skylights
// ============================================================
function buildCampusCeiling(matConcrete, matGlass) {
  S._roofGroup = new THREE.Group();

  var ceilMat = new THREE.MeshStandardMaterial({ color: 0x1c1f28, roughness: 0.88, side: THREE.DoubleSide });
  // Main ceiling slab
  var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, CAMPUS_D), ceilMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = WALL_H;
  S._roofGroup.add(ceiling);

  // Coffered beams — X-direction (run along X axis)
  var beamMat = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.82 });
  var xBeamZPositions = [-25, -15, -5, 5, 15, 25];
  xBeamZPositions.forEach(function(bz) {
    var bm = new THREE.Mesh(new THREE.BoxGeometry(CAMPUS_W, 0.22, 0.30), beamMat);
    bm.position.set(0, WALL_H - 0.11, bz);
    S._roofGroup.add(bm);
  });
  // Z-direction beams (run along Z axis)
  var zBeamXPositions = [-40, -32, -24, -16, -8, 0, 8, 16, 24, 32, 40];
  zBeamXPositions.forEach(function(bx) {
    var bm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.22, CAMPUS_D), beamMat);
    bm.position.set(bx, WALL_H - 0.11, 0);
    S._roofGroup.add(bm);
  });

  // 5 skylights in cross pattern
  var skylightMat = new THREE.MeshStandardMaterial({
    color: 0xaaddff, emissive: new THREE.Color(0xaaddff), emissiveIntensity: 0.35,
    transparent: true, opacity: 0.45, side: THREE.DoubleSide
  });
  var skylightPositions = [
    [0,  0],
    [-16, -12], [16, -12],
    [-16,  12], [16,  12],
  ];
  skylightPositions.forEach(function(pos) {
    var sk = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.5), skylightMat);
    sk.rotation.x = Math.PI / 2;
    sk.position.set(pos[0], WALL_H - 0.04, pos[1]);
    S._roofGroup.add(sk);
    // Chrome skylight frame
    var sfMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.10, metalness: 0.85 });
    var sfH = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.06, 0.06), sfMat);
    sfH.position.set(pos[0], WALL_H - 0.01, pos[1] - 2.28);
    S._roofGroup.add(sfH.clone());
    sfH.position.z = pos[1] + 2.28;
    S._roofGroup.add(sfH);
    var sfV = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 4.62), sfMat);
    sfV.position.set(pos[0] - 3.6, WALL_H - 0.01, pos[1]);
    S._roofGroup.add(sfV.clone());
    sfV.position.x = pos[0] + 3.6;
    S._roofGroup.add(sfV);
  });

  S.furnitureGroup.add(S._roofGroup);
}

// ============================================================
// STRUCTURAL COLUMNS — 2 rows at X=±20, every ~10 units on Z
// Marble base shaft + gold TorusGeometry capital ring
// ============================================================
function buildStructuralColumns(matMarble, matGold, matChrome) {
  var colZPositions = [-25, -15, -5, 5, 15, 25];
  var colXPositions = [-20, 20];

  colXPositions.forEach(function(cx) {
    colZPositions.forEach(function(cz) {
      // Base plinth
      var plinth = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.18, 0.70), matMarble);
      plinth.position.set(cx, 0.09, cz);
      S.furnitureGroup.add(plinth);
      // Shaft (octagonal — approximated with CylinderGeometry, 8 sides)
      var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, WALL_H - 0.28, 8), matMarble);
      shaft.position.set(cx, WALL_H / 2 + 0.09, cz);
      S.furnitureGroup.add(shaft);
      // Gold capital ring (torus)
      var capital = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.055, 8, 24), matGold);
      capital.rotation.x = Math.PI / 2;
      capital.position.set(cx, WALL_H - 0.22, cz);
      S.furnitureGroup.add(capital);
      // Capital top plate
      var capTop = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.12, 0.60), matMarble);
      capTop.position.set(cx, WALL_H - 0.06, cz);
      S.furnitureGroup.add(capTop);
    });
  });
}

// ============================================================
// MEZZANINE — 86W × 12D platform at y=MEZZ_H, glass railing
// ============================================================
function buildMezzanine(matConcrete, matChrome, matGlass, matWalnut, matFabric) {
  var mw = CAMPUS_W - 4;   // 86
  var md = MEZZ_DEPTH;      // 12
  var mz = -CAMPUS_D / 2 + md / 2;

  // Platform slab
  var slab = new THREE.Mesh(new THREE.BoxGeometry(mw, 0.24, md), matConcrete);
  slab.position.set(0, MEZZ_H - 0.12, mz);
  slab.receiveShadow = true;
  S.furnitureGroup.add(slab);

  // Walnut surface
  var surface = new THREE.Mesh(new THREE.PlaneGeometry(mw, md), matWalnut);
  surface.rotation.x = -Math.PI / 2;
  surface.position.set(0, MEZZ_H + 0.01, mz);
  surface.receiveShadow = true;
  S.furnitureGroup.add(surface);

  // Support columns (every 14.3 units along X)
  var supportXs = [-36, -25, -14, -3, 3, 14, 25, 36];
  supportXs.forEach(function(sx) {
    var col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, MEZZ_H, 8), matChrome);
    col.position.set(sx, MEZZ_H / 2, -CAMPUS_D / 2 + md);
    S.furnitureGroup.add(col);
  });

  // Glass railing front edge
  var railGlass = new THREE.Mesh(new THREE.PlaneGeometry(mw - 4, 1.1), matGlass);
  railGlass.position.set(0, MEZZ_H + 0.66, -CAMPUS_D / 2 + md + 0.02);
  S.furnitureGroup.add(railGlass);

  // Chrome top handrail bar
  var topBar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, mw - 4, 8), matChrome);
  topBar.rotation.z = Math.PI / 2;
  topBar.position.set(0, MEZZ_H + 1.22, -CAMPUS_D / 2 + md);
  S.furnitureGroup.add(topBar);

  // Railing vertical posts (every ~7 units)
  for (var rx = -(mw / 2 - 3); rx <= mw / 2 - 3; rx += 7) {
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.22, 6), matChrome);
    post.position.set(rx, MEZZ_H + 0.61, -CAMPUS_D / 2 + md);
    S.furnitureGroup.add(post);
  }

  // Meeting pods (2 round tables with chairs)
  [-22, 22].forEach(function(mx2) {
    var table = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.06, 24), matWalnut);
    table.position.set(mx2, MEZZ_H + 0.78, -CAMPUS_D / 2 + 5);
    S.furnitureGroup.add(table);
    var tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.14, 0.72, 8), matChrome);
    tableLeg.position.set(mx2, MEZZ_H + 0.40, -CAMPUS_D / 2 + 5);
    S.furnitureGroup.add(tableLeg);
    // 4 chairs
    for (var ci = 0; ci < 4; ci++) {
      var ca = (ci / 4) * Math.PI * 2;
      buildModernChair(mx2 + Math.cos(ca) * 1.4, MEZZ_H + 0.01, -CAMPUS_D / 2 + 5 + Math.sin(ca) * 1.4, ca + Math.PI, matChrome);
    }
  });

  // Lounge area
  buildSofa(0, MEZZ_H + 0.01, -CAMPUS_D / 2 + 3);

  // Upper Deck label
  var udDiv = document.createElement('div');
  udDiv.textContent = 'UPPER DECK';
  udDiv.style.cssText = 'color:#d4af37;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;';
  var udLabel = new CSS2DObject(udDiv);
  udLabel.position.set(0, MEZZ_H + 1.8, -CAMPUS_D / 2 + md);
  S.furnitureGroup.add(udLabel);
}

// ============================================================
// STAIRCASE — switchback at X=35
// Lower 8 steps going -Z, landing at half height, upper 8 steps -Z
// ============================================================
function buildStaircase(matMarble, matChrome, matGlass) {
  var stairX   = 35;
  var stairW   = 3.0;
  var steps    = 8;
  var stepH    = MEZZ_H / (steps * 2);
  var stepD    = 0.55;
  var startZ   = -14; // ground level bottom of stairs, going -Z toward mezzanine at Z=-18

  // ── Lower flight (going in -Z direction) ────────────────────────
  for (var i = 0; i < steps; i++) {
    var step = new THREE.Mesh(new THREE.BoxGeometry(stairW, stepH, stepD), matMarble);
    step.position.set(stairX, stepH / 2 + i * stepH, startZ - i * stepD);
    step.receiveShadow = true;
    S.furnitureGroup.add(step);
  }

  // ── Landing platform at mid-height ──────────────────────────────
  var landingY = steps * stepH;
  var landingZ = startZ - steps * stepD;
  var landing = new THREE.Mesh(new THREE.BoxGeometry(stairW, 0.10, stairW), matMarble);
  landing.position.set(stairX, landingY + 0.05, landingZ - stairW / 2);
  landing.receiveShadow = true;
  S.furnitureGroup.add(landing);

  // ── Upper flight (continuing -Z from landing) ────────────────────
  var upperStartZ = landingZ - stairW;
  for (var j = 0; j < steps; j++) {
    var stepU = new THREE.Mesh(new THREE.BoxGeometry(stairW, stepH, stepD), matMarble);
    stepU.position.set(stairX, landingY + stepH / 2 + j * stepH, upperStartZ - j * stepD);
    stepU.receiveShadow = true;
    S.furnitureGroup.add(stepU);
  }

  // ── Glass side panels ────────────────────────────────────────────
  var totalFlightD = steps * stepD;
  var panelH = MEZZ_H + 0.8;

  // Lower flight panel (right side)
  var lpLower = new THREE.Mesh(new THREE.PlaneGeometry(totalFlightD + 0.2, panelH), matGlass);
  lpLower.position.set(stairX + stairW / 2 + 0.04, panelH / 2, startZ - totalFlightD / 2);
  lpLower.rotation.y = Math.PI / 2;
  S.furnitureGroup.add(lpLower);

  // Upper flight panel (right side)
  var lpUpper = new THREE.Mesh(new THREE.PlaneGeometry(totalFlightD + 0.2, panelH), matGlass);
  lpUpper.position.set(stairX + stairW / 2 + 0.04, panelH / 2, upperStartZ - totalFlightD / 2);
  lpUpper.rotation.y = Math.PI / 2;
  S.furnitureGroup.add(lpUpper);

  // ── Chrome handrails (diagonal) ──────────────────────────────────
  function addHandrail(sx, sy, sz, len, slope) {
    var railLen = Math.sqrt(len * len + (slope * len) * (slope * len));
    var rail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, railLen, 6), matChrome);
    rail.position.set(sx, sy, sz);
    rail.rotation.x = Math.atan2(slope * len, len);
    S.furnitureGroup.add(rail);
  }
  addHandrail(stairX + stairW / 2 + 0.08, panelH * 0.6, startZ - totalFlightD / 2, totalFlightD, -stepH / stepD);
  addHandrail(stairX + stairW / 2 + 0.08, panelH * 0.6, upperStartZ - totalFlightD / 2, totalFlightD, -stepH / stepD);
}

// ============================================================
// GRAND LOBBY — Z = 22 to 30 (inside front zone)
// ============================================================
function buildLobby(matMarble, matChrome, matGold, matWalnut, matNeonBlue) {
  var lz = CAMPUS_D / 2 - 5; // approx Z=25 from center
  var group = new THREE.Group();

  // ── Entrance archway ─────────────────────────────────────────────
  // Two thick columns flanking entrance (outside main walls, decorative)
  [-6, 6].forEach(function(ax) {
    var archCol = new THREE.Mesh(new THREE.BoxGeometry(1.0, 5.0, 0.8), matMarble);
    archCol.position.set(ax, 2.5, lz + 4.0);
    group.add(archCol);
    // Gold capital
    var cap = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.07, 8, 20), matGold);
    cap.rotation.x = Math.PI / 2;
    cap.position.set(ax, 5.1, lz + 4.0);
    group.add(cap);
  });
  // Header beam across arch
  var headerBeam = new THREE.Mesh(new THREE.BoxGeometry(13.2, 0.35, 0.80), matMarble);
  headerBeam.position.set(0, 5.18, lz + 4.0);
  group.add(headerBeam);
  // Gold trim strip on beam underside
  var beamTrim = new THREE.Mesh(new THREE.BoxGeometry(13.0, 0.06, 0.75), matGold);
  beamTrim.position.set(0, 5.00, lz + 4.0);
  group.add(beamTrim);

  // ── Lower lobby ceiling (4.5 units) ─────────────────────────────
  var lobbyCeilMat = new THREE.MeshStandardMaterial({ color: 0x1e2128, roughness: 0.80 });
  var lobbyCeil = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, 10), lobbyCeilMat);
  lobbyCeil.rotation.x = Math.PI / 2;
  lobbyCeil.position.set(0, 4.5, CAMPUS_D / 2 - 5);
  group.add(lobbyCeil);

  // ── Column arcade — 4 pairs of decorative columns ────────────────
  [-18, -9, 9, 18].forEach(function(ax) {
    [-2, 2].forEach(function(az) {
      var dcol = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 4.5, 12), matMarble);
      dcol.position.set(ax, 2.25, lz + az);
      group.add(dcol);
      var dring = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.04, 6, 18), matGold);
      dring.rotation.x = Math.PI / 2;
      dring.position.set(ax, 4.44, lz + az);
      group.add(dring);
    });
  });

  // ── Reception desk — symmetric L-shaped (marble top, walnut body) ─
  // Left wing
  var deskBodyL = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.10, 1.0), matWalnut);
  deskBodyL.position.set(-4, 0.55, lz + 0.5);
  group.add(deskBodyL);
  // Right wing
  var deskBodyR = new THREE.Mesh(new THREE.BoxGeometry(5.5, 1.10, 1.0), matWalnut);
  deskBodyR.position.set(4, 0.55, lz + 0.5);
  group.add(deskBodyR);
  // Center connector (back panel)
  var deskCenter = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.10, 0.90), matWalnut);
  deskCenter.position.set(0, 0.55, lz - 0.65);
  group.add(deskCenter);
  // Marble countertop spanning whole desk
  var counterL = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.06, 1.22), matMarble);
  counterL.position.set(-4, 1.16, lz + 0.5);
  group.add(counterL);
  var counterR = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.06, 1.22), matMarble);
  counterR.position.set(4, 1.16, lz + 0.5);
  group.add(counterR);
  var counterC = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.06, 1.12), matMarble);
  counterC.position.set(0, 1.16, lz - 0.65);
  group.add(counterC);
  // Blue LED strip under countertop
  var ledStrip = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.02, 0.02), matNeonBlue);
  ledStrip.position.set(0, 1.04, lz + 1.07);
  group.add(ledStrip);
  // Gold accent strip on front panel
  var goldAccent = new THREE.Mesh(new THREE.BoxGeometry(13.8, 0.04, 0.005), matGold);
  goldAccent.position.set(0, 0.92, lz + 1.0);
  group.add(goldAccent);

  // Reception monitor + keyboard
  var monBez = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var mon = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.025), monBez);
  mon.position.set(-2.5, 1.47, lz + 0.0);
  group.add(mon);
  var monScr = new THREE.Mesh(new THREE.PlaneGeometry(0.50, 0.34),
    new THREE.MeshStandardMaterial({ color: 0x1a2a4a, emissive: new THREE.Color(0x58a6ff), emissiveIntensity: 0.28, roughness: 0.1 }));
  monScr.position.set(-2.5, 1.47, lz - 0.01);
  group.add(monScr);
  var monStand = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), matChrome);
  monStand.position.set(-2.5, 1.30, lz + 0.0);
  group.add(monStand);
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.012, 0.11),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
  kb.position.set(-2.5, 1.185, lz + 0.45);
  group.add(kb);

  // ── Feature wall (10W, walnut paneled, Z behind desk) ────────────
  var fwMat = new THREE.MeshStandardMaterial({ color: 0x2a1e10, roughness: 0.65 });
  var featureWall = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 0.18), fwMat);
  featureWall.position.set(0, 2.2, lz + 2.0);
  group.add(featureWall);
  // Walnut vertical panel strips
  var stripMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.58 });
  for (var pi = -4; pi <= 4; pi++) {
    var strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 4.0, 0.02), stripMat);
    strip.position.set(pi * 1.1, 2.2, lz + 2.10);
    group.add(strip);
  }
  // Gold divider line at top of feature wall
  var fwGold = new THREE.Mesh(new THREE.BoxGeometry(10.2, 0.07, 0.02), matGold);
  fwGold.position.set(0, 4.23, lz + 2.10);
  group.add(fwGold);

  // ── TV canvas (PRESERVED: S._tvScreen contract) ───────────────────
  var tvW = 960, tvH = 560;
  var tvFrame = new THREE.Mesh(new THREE.BoxGeometry(5.2, 2.9, 0.07),
    new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.2 }));
  tvFrame.position.set(0, 2.1, lz + 1.9);
  group.add(tvFrame);
  var tvCvs = document.createElement('canvas');
  tvCvs.width = tvW; tvCvs.height = tvH;
  var tvTex = new THREE.CanvasTexture(tvCvs);
  tvTex.minFilter = THREE.LinearFilter;
  var tvScreenMat = new THREE.MeshStandardMaterial({
    map: tvTex, emissive: new THREE.Color(0x58a6ff), emissiveIntensity: 0.18, roughness: 0.08
  });
  var tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(4.9, 2.65), tvScreenMat);
  tvScreen.position.set(0, 2.1, lz + 1.86);
  tvScreen.rotation.y = Math.PI;
  group.add(tvScreen);
  S._tvScreen = { canvas: tvCvs, texture: tvTex, tickerOffset: 0 };
  // TV accent light
  var tvLight = new THREE.PointLight(0x58a6ff, 0.45, 7);
  tvLight.castShadow = false;
  tvLight.position.set(0, 4.0, lz + 1.5);
  group.add(tvLight);

  // ── LET THEM TALK logo above feature wall ────────────────────────
  var logoDiv = document.createElement('div');
  logoDiv.textContent = 'LET THEM TALK';
  logoDiv.style.cssText = 'color:#ffffff;font-size:14px;font-weight:900;font-family:Inter,sans-serif;letter-spacing:6px;text-shadow:0 0 20px rgba(88,166,255,0.6),0 0 40px rgba(88,166,255,0.3);';
  var logoLabel = new CSS2DObject(logoDiv);
  logoLabel.position.set(0, 4.6, lz + 2.1);
  group.add(logoLabel);

  // ── Water feature (5×2 pool, center lobby) ───────────────────────
  var poolRimMat = new THREE.MeshStandardMaterial({ color: 0x22252e, roughness: 0.42 });
  var poolRim = new THREE.Mesh(new THREE.BoxGeometry(5.2, 0.22, 2.2), poolRimMat);
  poolRim.position.set(0, 0.11, lz - 5.0);
  group.add(poolRim);
  var waterMat = new THREE.MeshStandardMaterial({
    color: 0x1e5a8a, roughness: 0.04, metalness: 0.28, transparent: true, opacity: 0.75
  });
  var water = new THREE.Mesh(new THREE.PlaneGeometry(4.8, 1.8), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0.23, lz - 5.0);
  group.add(water);
  // Decorative smooth stones
  var stoneMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.7 });
  [[-1.2, -0.4], [0.6, 0.3], [-0.3, 0.2], [1.3, -0.3], [-0.8, -0.1], [0.0, 0.5]].forEach(function(sp) {
    var stone = new THREE.Mesh(new THREE.SphereGeometry(0.055 + Math.random() * 0.04, 6, 4), stoneMat);
    stone.position.set(sp[0], 0.21, lz - 5.0 + sp[1]);
    stone.scale.y = 0.5;
    group.add(stone);
  });

  // ── Pendant lights above reception (3 clusters) ──────────────────
  [-5, 0, 5].forEach(function(px) {
    var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 2.2, 4),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
    wire.position.set(px, 4.5 - 1.1, lz + 0.3);
    group.add(wire);
    var shade = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10),
      new THREE.MeshStandardMaterial({ color: 0xffeedd, emissive: new THREE.Color(0xffeedd), emissiveIntensity: 0.40, transparent: true, opacity: 0.80 }));
    shade.position.set(px, 4.5 - 2.55, lz + 0.3);
    group.add(shade);
    // Gold ring
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.012, 6, 18), matGold);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(px, 4.5 - 2.68, lz + 0.3);
    group.add(ring);
  });
  var recLight = new THREE.PointLight(0xffeedd, 0.38, 10);
  recLight.castShadow = false;
  recLight.position.set(0, 3.8, lz + 0.3);
  group.add(recLight);

  // ── RECEPTION gold sign ──────────────────────────────────────────
  var signDiv = document.createElement('div');
  signDiv.textContent = 'RECEPTION';
  signDiv.style.cssText = 'color:#d4af37;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:3px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, 4.8, lz + 0.3);
  group.add(sign);

  S.furnitureGroup.add(group);
}

// ============================================================
// MAIN CORRIDOR — Z=0, 4 units wide (-2 to +2)
// Polished dark floor + gold inlay lines
// ============================================================
function buildMainCorridor(matDark, matGold) {
  // Dark polished floor strip
  var corrFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(CAMPUS_W, 4),
    new THREE.MeshStandardMaterial({ color: 0x12141a, roughness: 0.08, metalness: 0.12 })
  );
  corrFloor.rotation.x = -Math.PI / 2;
  corrFloor.position.set(0, 0.015, 0);
  S.furnitureGroup.add(corrFloor);

  // Gold inlay centre line
  var inlayCtr = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, 0.06), matGold);
  inlayCtr.rotation.x = -Math.PI / 2;
  inlayCtr.position.set(0, 0.018, 0);
  S.furnitureGroup.add(inlayCtr);

  // Gold inlay edge lines
  [-1.8, 1.8].forEach(function(ez) {
    var inlay = new THREE.Mesh(new THREE.PlaneGeometry(CAMPUS_W, 0.03), matGold);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(0, 0.018, ez);
    S.furnitureGroup.add(inlay);
  });
}

// ============================================================
// CROSS CORRIDORS — at X=±20, 3 units wide
// ============================================================
function buildCrossCorridor(matDark, matGold) {
  [-20, 20].forEach(function(cx) {
    var cFloor = new THREE.Mesh(
      new THREE.PlaneGeometry(3, CAMPUS_D),
      new THREE.MeshStandardMaterial({ color: 0x13151c, roughness: 0.10, metalness: 0.10 })
    );
    cFloor.rotation.x = -Math.PI / 2;
    cFloor.position.set(cx, 0.012, 0);
    S.furnitureGroup.add(cFloor);

    // Gold inlay centre
    var inlay = new THREE.Mesh(new THREE.PlaneGeometry(0.04, CAMPUS_D), matGold);
    inlay.rotation.x = -Math.PI / 2;
    inlay.position.set(cx, 0.016, 0);
    S.furnitureGroup.add(inlay);
  });
}

// === PHASE 3-5 FUNCTIONS FOLLOW ===

// ============================================================
// GAMING DESK
// ============================================================
function buildGamingDesk(x, z, index) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);

  var deskMat = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.28, metalness: 0.12 });
  // Main top
  var mainTop = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.05, 0.90), deskMat);
  mainTop.position.y = 0.76; mainTop.castShadow = true; mainTop.receiveShadow = true;
  group.add(mainTop);
  // RGB LED strip
  var rgbColors = [0x58a6ff, 0xa855f7, 0x22c55e, 0xef4444, 0x06b6d4, 0xec4899];
  var rgbColor = rgbColors[index % rgbColors.length];
  var rgbMat = new THREE.MeshStandardMaterial({ color: rgbColor, emissive: new THREE.Color(rgbColor), emissiveIntensity: 0.8, roughness: 0.2 });
  var rgbStrip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.015, 0.015), rgbMat);
  rgbStrip.position.set(0, 0.74, 0.44);
  group.add(rgbStrip);
  // Legs
  var legMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.40, metalness: 0.22 });
  [[-0.85, -0.35], [-0.85, 0.35], [0.85, -0.35], [0.85, 0.35]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), legMat);
    leg.position.set(p[0], 0.38, p[1]);
    group.add(leg);
  });
  // Monitor body
  var monMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var monBody = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.38, 0.03), monMat);
  monBody.position.set(0, 1.14, -0.25);
  group.add(monBody);
  // Monitor screen
  var screenMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(0x333333), emissiveIntensity: 0.1, roughness: 0.2 });
  var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.65, 0.32), screenMat);
  screen.position.set(0, 1.14, -0.234);
  group.add(screen);
  // Monitor stand
  var standMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.15, metalness: 0.7 });
  var standArm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.24, 0.04), standMat);
  standArm.position.set(0, 0.91, -0.27);
  group.add(standArm);
  var standBase = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.02, 0.15), standMat);
  standBase.position.set(0, 0.78, -0.27);
  group.add(standBase);
  // PC tower with RGB glow
  var pcMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.30 });
  var pcCase = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.45), pcMat);
  pcCase.position.set(0.72, 0.23, 0);
  group.add(pcCase);
  var pcGlowMat = new THREE.MeshStandardMaterial({ color: rgbColor, emissive: new THREE.Color(rgbColor), emissiveIntensity: 0.4, transparent: true, opacity: 0.5 });
  var pcGlow = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.40), pcGlowMat);
  pcGlow.position.set(0.72 + 0.115, 0.23, 0);
  pcGlow.rotation.y = Math.PI / 2;
  group.add(pcGlow);
  // Keyboard + mousepad
  var kbMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 });
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.12), kbMat);
  kb.position.set(-0.1, 0.78, 0.15);
  group.add(kb);
  var padMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.8 });
  var pad = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.005, 0.20), padMat);
  pad.position.set(0.30, 0.765, 0.15);
  group.add(pad);
  var mouse = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.07), kbMat);
  mouse.position.set(0.30, 0.78, 0.15);
  group.add(mouse);
  // Chair
  buildGamingChair(group, 0, 0.70, rgbColor);

  S.furnitureGroup.add(group);
  S.deskMeshes.push({ group: group, screen: screen, screenMat: screenMat, index: index, x: x, z: z });
}

// ============================================================
// GAMING CHAIR
// ============================================================
function buildGamingChair(parent, cx, cz, accentColor) {
  var chairGroup = new THREE.Group();
  chairGroup.position.set(cx, 0, cz);
  var baseMat   = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
  var seatMat   = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.65 });
  var accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });
  // 5-star base
  var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), baseMat);
  hub.position.y = 0.05; chairGroup.add(hub);
  for (var i = 0; i < 5; i++) {
    var a = (i / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.02, 0.03), baseMat);
    arm.position.set(Math.cos(a) * 0.15, 0.04, Math.sin(a) * 0.15);
    arm.rotation.y = -a; chairGroup.add(arm);
    var wheel = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 4), baseMat);
    wheel.position.set(Math.cos(a) * 0.28, 0.025, Math.sin(a) * 0.28);
    chairGroup.add(wheel);
  }
  var cyl = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8), baseMat);
  cyl.position.y = 0.25; chairGroup.add(cyl);
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.08, 0.42), seatMat);
  seat.position.y = 0.46; chairGroup.add(seat);
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.06), seatMat);
  back.position.set(0, 0.78, 0.20); chairGroup.add(back);
  var headrest = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.06), seatMat);
  headrest.position.set(0, 1.10, 0.20); chairGroup.add(headrest);
  var s1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.005), accentMat);
  s1.position.set(-0.12, 0.78, 0.17); chairGroup.add(s1);
  var s2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.005), accentMat);
  s2.position.set(0.12, 0.78, 0.17); chairGroup.add(s2);
  [-0.22, 0.22].forEach(function(ax) {
    var ap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.20, 0.03), baseMat);
    ap.position.set(ax, 0.55, 0.05); chairGroup.add(ap);
    var apd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.20), seatMat);
    apd.position.set(ax, 0.66, 0.05); chairGroup.add(apd);
  });
  parent.add(chairGroup);
}

// ============================================================
// MODERN CHAIR (meeting rooms / mezzanine)
// ============================================================
function buildModernChair(x, y, z, rotation, matChrome) {
  var group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotation;
  var seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.75 });
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.05, 0.40), seatMat);
  seat.position.y = 0.45; group.add(seat);
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.40, 0.04), seatMat);
  back.position.set(0, 0.70, 0.18); group.add(back);
  var post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.40, 6), matChrome);
  post.position.y = 0.22; group.add(post);
  S.furnitureGroup.add(group);
}

// ============================================================
// SOFA
// ============================================================
function buildSofa(x, y, z) {
  var group = new THREE.Group();
  group.position.set(x, y, z);
  var sofaMat    = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.78 });
  var cushionMat = new THREE.MeshStandardMaterial({ color: 0x1e2030, roughness: 0.82 });
  var base = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.35, 0.9), sofaMat);
  base.position.y = 0.20; group.add(base);
  var backrest = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.50, 0.20), sofaMat);
  backrest.position.set(0, 0.56, -0.36); group.add(backrest);
  [-1.5, 1.5].forEach(function(ax) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.30, 0.90), sofaMat);
    arm.position.set(ax, 0.40, 0); group.add(arm);
  });
  [-0.9, 0, 0.9].forEach(function(cx2) {
    var cushion = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.10, 0.72), cushionMat);
    cushion.position.set(cx2, 0.43, 0.05); group.add(cushion);
  });
  S.furnitureGroup.add(group);
}

// ============================================================
// MANAGER'S GLASS OFFICE
// ============================================================
function buildManagerOffice(x, z, matGlassCl, matGlassFr, matFrame, matWalnut, matLeather, matChrome) {
  var offW = 14, offD = 10, wallH = 4.5;
  var group = new THREE.Group();
  group.position.set(x, 0, z);

  // Raised walnut floor
  var floorMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.52 });
  var offFloor = new THREE.Mesh(new THREE.BoxGeometry(offW, 0.07, offD), floorMat);
  offFloor.position.y = 0.035; group.add(offFloor);

  // Glass walls (front with door, sides, back)
  var doorW = 1.2;
  var fwLeft = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, wallH), matGlassCl);
  fwLeft.position.set(-(offW + doorW) / 4, wallH / 2, -offD / 2);
  group.add(fwLeft);
  var fwRight = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, wallH), matGlassCl);
  fwRight.position.set((offW + doorW) / 4, wallH / 2, -offD / 2);
  group.add(fwRight);
  // Frosted privacy strips
  [-(offW + doorW) / 4, (offW + doorW) / 4].forEach(function(fx) {
    var frost = new THREE.Mesh(new THREE.PlaneGeometry((offW - doorW) / 2, 0.85), matGlassFr);
    frost.position.set(fx, 1.25, -offD / 2 + 0.01);
    group.add(frost);
  });
  // Sliding door
  var doorGlassMat = new THREE.MeshStandardMaterial({ color: 0xbbddff, transparent: true, opacity: 0.28, roughness: 0.05, side: THREE.DoubleSide });
  var door = new THREE.Mesh(new THREE.PlaneGeometry(doorW, wallH - 0.2), doorGlassMat);
  door.position.set(0, wallH / 2, -offD / 2);
  group.add(door);
  var handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.30, 0.04), matChrome);
  handle.position.set(doorW / 2 - 0.1, 1.1, -offD / 2 + 0.03);
  group.add(handle);
  S._managerDoor     = door;
  S._managerDoorOpen = 0;
  S._managerDoorLerp = 0;
  S._managerDoorClosedZ = -offD / 2;
  // Side walls
  var leftW = new THREE.Mesh(new THREE.PlaneGeometry(offD, wallH), matGlassCl);
  leftW.position.set(-offW / 2, wallH / 2, 0); leftW.rotation.y = Math.PI / 2;
  group.add(leftW);
  var rightW = new THREE.Mesh(new THREE.PlaneGeometry(offD, wallH), matGlassCl);
  rightW.position.set(offW / 2, wallH / 2, 0); rightW.rotation.y = -Math.PI / 2;
  group.add(rightW);
  var backW = new THREE.Mesh(new THREE.PlaneGeometry(offW, wallH), matGlassCl);
  backW.position.set(0, wallH / 2, offD / 2); backW.rotation.y = Math.PI;
  group.add(backW);

  // Chrome frame structure
  [[offW, 0.06, 0.06, 0, wallH, -offD / 2], [offW, 0.06, 0.06, 0, wallH, offD / 2],
   [0.06, 0.06, offD, -offW / 2, wallH, 0], [0.06, 0.06, offD, offW / 2, wallH, 0]].forEach(function(b) {
    var beam = new THREE.Mesh(new THREE.BoxGeometry(b[0], b[1], b[2]), matFrame);
    beam.position.set(b[3], b[4], b[5]); group.add(beam);
  });
  [[-offW/2,-offD/2],[-offW/2,offD/2],[offW/2,-offD/2],[offW/2,offD/2]].forEach(function(p) {
    var post = new THREE.Mesh(new THREE.BoxGeometry(0.06, wallH, 0.06), matFrame);
    post.position.set(p[0], wallH / 2, p[1]); group.add(post);
  });

  // Executive L-desk
  var marbleTopMat = new THREE.MeshStandardMaterial({ color: 0xf0ece4, roughness: 0.12, metalness: 0.05 });
  var deskMain = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.07, 1.3), matWalnut);
  deskMain.position.set(0, 0.79, 1.8); group.add(deskMain);
  var marbMain = new THREE.Mesh(new THREE.BoxGeometry(3.22, 0.016, 1.32), marbleTopMat);
  marbMain.position.set(0, 0.835, 1.8); group.add(marbMain);
  var deskWing = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.07, 1.0), matWalnut);
  deskWing.position.set(1.8, 0.79, 0.9); group.add(deskWing);
  var marbWing = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.016, 1.02), marbleTopMat);
  marbWing.position.set(1.8, 0.835, 0.9); group.add(marbWing);
  // Desk legs
  [[-1.45,1.1],[-1.45,2.5],[1.45,2.5],[1.45,1.1],[2.35,0.5],[2.35,1.3]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.79, 8), matChrome);
    leg.position.set(p[0], 0.395, p[1]); group.add(leg);
  });

  // 47" monitor
  var monMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var bigMon = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.67, 0.025), monMat);
  bigMon.position.set(0, 1.22, 1.25); group.add(bigMon);
  var scrMat2 = new THREE.MeshStandardMaterial({ color: 0x1a2a4a, emissive: new THREE.Color(0x58a6ff), emissiveIntensity: 0.3, roughness: 0.1 });
  var bigScr = new THREE.Mesh(new THREE.PlaneGeometry(1.14, 0.61), scrMat2);
  bigScr.position.set(0, 1.22, 1.263); group.add(bigScr);
  var monStand = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.29, 8), matChrome);
  monStand.position.set(0, 0.94, 1.27); group.add(monStand);
  var monBase = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.02, 0.20), matChrome);
  monBase.position.set(0, 0.795, 1.27); group.add(monBase);

  // Executive chair (leather)
  var chairG = new THREE.Group();
  chairG.position.set(0, 0, 2.7);
  var baseMat2 = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.4 });
  for (var ci = 0; ci < 5; ci++) {
    var ca = (ci / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.035), baseMat2);
    arm.position.set(Math.cos(ca) * 0.16, 0.04, Math.sin(ca) * 0.16);
    arm.rotation.y = -ca; chairG.add(arm);
  }
  var cylM = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.40, 8), matChrome);
  cylM.position.y = 0.26; chairG.add(cylM);
  var seatM = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.10, 0.50), matLeather);
  seatM.position.y = 0.50; chairG.add(seatM);
  var backM = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.70, 0.08), matLeather);
  backM.position.set(0, 0.92, 0.25); chairG.add(backM);
  var headM = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.12, 0.08), matLeather);
  headM.position.set(0, 1.32, 0.25); chairG.add(headM);
  [-0.27, 0.27].forEach(function(ax) {
    var ap = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.25, 0.04), baseMat2);
    ap.position.set(ax, 0.60, 0.08); chairG.add(ap);
    var apd = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.25), matLeather);
    apd.position.set(ax, 0.73, 0.08); chairG.add(apd);
  });
  group.add(chairG);

  // Gold accent art frame on back wall
  var goldMat2 = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.30, metalness: 0.70 });
  var artW = 2.0, artH = 1.3;
  [[artW + 0.08, 0.06, 0.06, 0, 3.4, offD/2-0.1],
   [artW + 0.08, 0.06, 0.06, 0, 2.1, offD/2-0.1],
   [0.06, (artH+0.12), 0.06, -(artW/2+0.04), 2.75, offD/2-0.1],
   [0.06, (artH+0.12), 0.06,  (artW/2+0.04), 2.75, offD/2-0.1]].forEach(function(b) {
    var bar = new THREE.Mesh(new THREE.BoxGeometry(b[0], b[1], b[2]), goldMat2);
    bar.position.set(b[3], b[4], b[5]); group.add(bar);
  });
  var artMat = new THREE.MeshStandardMaterial({ color: 0x1a2a3a, roughness: 0.8 });
  var art = new THREE.Mesh(new THREE.PlaneGeometry(artW, artH), artMat);
  art.position.set(0, 2.75, offD / 2 - 0.08);
  art.rotation.y = Math.PI; group.add(art);

  // Warm lighting
  var wl = new THREE.PointLight(0xffeedd, 0.40, 10);
  wl.castShadow = false; wl.position.set(0, 3.8, 1.8); group.add(wl);
  // Pendant
  var pendWire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 2.2, 4),
    new THREE.MeshStandardMaterial({ color: 0x2a2a2a }));
  pendWire.position.set(0, wallH - 1.1, 1.8); group.add(pendWire);
  var pendShade = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.32, 0.22, 12, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }));
  pendShade.position.set(0, wallH - 2.3, 1.8); group.add(pendShade);
  var pendRim = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.012, 6, 24), goldMat2);
  pendRim.rotation.x = Math.PI / 2;
  pendRim.position.set(0, wallH - 2.42, 1.8); group.add(pendRim);

  // MANAGER sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'MANAGER';
  signDiv.style.cssText = 'color:#d4af37;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:3px;text-shadow:0 0 6px rgba(212,175,55,0.4);';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, wallH + 0.35, -offD / 2);
  group.add(sign);

  S.furnitureGroup.add(group);
  S._managerOfficeGroup = group;
  S._managerOfficePos = { x: x, z: z };

  // Register manager desk in deskMeshes
  var mgrDeskIdx = CAMPUS_DESKS.length - 1;
  var mgrScreenMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: new THREE.Color(0x333333), emissiveIntensity: 0.1, roughness: 0.2 });
  S.deskMeshes[mgrDeskIdx] = { group: group, screen: bigScr, screenMat: mgrScreenMat, index: mgrDeskIdx, x: x, z: z + 1.9 };
}

// ============================================================
// DESIGNER STUDIO (left wing)
// ============================================================
function buildDesignerStudio(x, z, matWalnut, matChrome) {
  var boardMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.5 });
  var board = new THREE.Mesh(new THREE.BoxGeometry(0.10, 2.2, 5), boardMat);
  board.position.set(x - 8, 1.6, z);
  board.castShadow = true;
  S.furnitureGroup.add(board);
  var noteColors = [0xfbbf24, 0xf87171, 0x34d399, 0x60a5fa, 0xa78bfa, 0xfb923c];
  for (var ni = 0; ni < 16; ni++) {
    var noteMat = new THREE.MeshStandardMaterial({ color: noteColors[ni % noteColors.length], roughness: 0.9 });
    var note = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30), noteMat);
    note.position.set(x - 7.94, 0.8 + Math.floor(ni / 4) * 0.55, z - 2.0 + (ni % 4) * 1.0);
    note.rotation.y = Math.PI / 2;
    S.furnitureGroup.add(note);
  }
  // Standing desk
  var standDesk = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.9), matWalnut);
  standDesk.position.set(x - 3, 1.05, z + 4);
  standDesk.castShadow = true;
  S.furnitureGroup.add(standDesk);
  [-0.8, 0.8].forEach(function(lx) {
    var standLeg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.05, 0.06), matChrome);
    standLeg.position.set(x - 3 + lx, 0.525, z + 4);
    S.furnitureGroup.add(standLeg);
  });
  var signDiv = document.createElement('div');
  signDiv.textContent = 'DESIGN LAB';
  signDiv.style.cssText = 'color:#a855f7;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4.0, z);
  S.furnitureGroup.add(sign);
}

// ============================================================
// BAR & CAFÉ
// ============================================================
function buildBar(x, z, matWalnut, matChrome, matNeonBlue, matNeonPurple) {
  var barTop = new THREE.Mesh(new THREE.BoxGeometry(8, 0.09, 1.4), matWalnut);
  barTop.position.set(x, 1.12, z); barTop.castShadow = true;
  S.furnitureGroup.add(barTop);
  var barFront = new THREE.Mesh(new THREE.BoxGeometry(8, 1.12, 0.12),
    new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.38 }));
  barFront.position.set(x, 0.56, z + 0.65); barFront.castShadow = true;
  S.furnitureGroup.add(barFront);
  var barLed = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.022, 0.022), matNeonBlue);
  barLed.position.set(x, 1.03, z + 0.68);
  S.furnitureGroup.add(barLed);
  // Stools
  for (var si = 0; si < 6; si++) {
    var stoolGroup = new THREE.Group();
    stoolGroup.position.set(x - 3 + si * 1.1, 0, z + 1.4);
    var stoolSeat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12),
      new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.6 }));
    stoolSeat.position.y = 0.76; stoolGroup.add(stoolSeat);
    var stoolPost = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.72, 8), matChrome);
    stoolPost.position.y = 0.38; stoolGroup.add(stoolPost);
    var stoolBase = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.20, 0.04, 12), matChrome);
    stoolBase.position.y = 0.04; stoolGroup.add(stoolBase);
    S.furnitureGroup.add(stoolGroup);
  }
  // Shelves + bottles
  var shelfMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.58 });
  [1.5, 2.2, 2.9].forEach(function(sy) {
    var shelf = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.04, 0.32), shelfMat);
    shelf.position.set(x, sy, z - 1.0);
    S.furnitureGroup.add(shelf);
  });
  var bottleColors = [0x2d8a4e, 0x8B4513, 0xd4af37, 0xcc3333, 0x1a5276, 0xf0f0f0];
  for (var bi = 0; bi < 18; bi++) {
    var bx = x - 3.5 + (bi % 6) * 1.2;
    var by = 1.55 + Math.floor(bi / 6) * 0.7;
    var bottleMat = new THREE.MeshStandardMaterial({ color: bottleColors[bi % bottleColors.length], roughness: 0.3, metalness: 0.1 });
    var bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.26, 8), bottleMat);
    bottle.position.set(bx, by + 0.13, z - 0.94);
    S.furnitureGroup.add(bottle);
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.10, 6), bottleMat);
    neck.position.set(bx, by + 0.31, z - 0.94);
    S.furnitureGroup.add(neck);
  }
  // Coffee machine
  var coffee = new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.50, 0.30),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.28, metalness: 0.22 }));
  coffee.position.set(x + 3.5, 1.38, z - 0.12);
  S.furnitureGroup.add(coffee);
  // Sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'BAR & CAFÉ';
  signDiv.style.cssText = 'color:#a855f7;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #a855f7;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4.0, z - 1.2);
  S.furnitureGroup.add(sign);
}

// ============================================================
// JUKEBOX (Wurlitzer 1015 style)
// ============================================================
function buildJukebox(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var bodyMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.50, metalness: 0.05 });
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.90, 1.50, 0.50), bodyMat);
  body.position.y = 0.75; body.castShadow = true; group.add(body);
  var chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.10, metalness: 0.80 });
  var topArch = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.06, 16, 1, false, 0, Math.PI), chromeMat);
  topArch.position.set(0, 1.53, 0); topArch.rotation.z = Math.PI; topArch.rotation.y = Math.PI / 2;
  group.add(topArch);
  var glassMat2 = new THREE.MeshStandardMaterial({ color: 0xaaddff, transparent: true, opacity: 0.40, roughness: 0.05 });
  var glassPanel = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.40, 0.08), glassMat2);
  glassPanel.position.set(0, 1.35, 0.22); group.add(glassPanel);
  var neonColors = [0xff4488, 0xff8844, 0xffdd44, 0x44ff88, 0x4488ff, 0xaa44ff];
  var neonMat = new THREE.MeshStandardMaterial({ color: 0xff4488, emissive: new THREE.Color(0xff4488), emissiveIntensity: 0.80, roughness: 0.20 });
  var neonL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.20, 0.04), neonMat);
  neonL.position.set(-0.42, 0.75, 0.23); group.add(neonL);
  var neonR = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.20, 0.04), neonMat);
  neonR.position.set(0.42, 0.75, 0.23); group.add(neonR);
  var neonTop = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.04, 0.04), neonMat);
  neonTop.position.set(0, 1.50, 0.23); group.add(neonTop);
  var bubbleMat = new THREE.MeshStandardMaterial({ color: 0x66ccff, transparent: true, opacity: 0.50, emissive: new THREE.Color(0x66ccff), emissiveIntensity: 0.30 });
  var bubbleL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.30, 8), bubbleMat);
  bubbleL.position.set(-0.38, 0.75, 0.18); group.add(bubbleL);
  var bubbleR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.30, 8), bubbleMat);
  bubbleR.position.set(0.38, 0.75, 0.18); group.add(bubbleR);
  var base = new THREE.Mesh(new THREE.BoxGeometry(1.00, 0.08, 0.55), chromeMat);
  base.position.y = 0.04; group.add(base);
  for (var gi = 0; gi < 6; gi++) {
    var grille = new THREE.Mesh(new THREE.BoxGeometry(0.60, 0.01, 0.01), chromeMat);
    grille.position.set(0, 0.15 + gi * 0.06, 0.26); group.add(grille);
  }
  var buttonMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.3, metalness: 0.5 });
  for (var bi2 = 0; bi2 < 3; bi2++) {
    var btn = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.02, 8), buttonMat);
    btn.position.set(-0.15 + bi2 * 0.15, 0.85, 0.26); btn.rotation.x = Math.PI / 2;
    group.add(btn);
  }
  var labelDiv = document.createElement('div');
  labelDiv.className = 'jukebox-label';
  labelDiv.style.cssText = 'color:#ff4488;font-size:8px;font-weight:bold;font-family:monospace;text-shadow:0 0 6px #ff4488;text-align:center;pointer-events:none;opacity:0.9;';
  labelDiv.innerHTML = '<div style="color:#ffdd44;font-size:10px">JUKEBOX</div><div style="font-size:7px;color:#aaa">Press E to play</div>';
  var label = new CSS2DObject(labelDiv);
  label.position.set(0, 1.80, 0);
  group.add(label);
  S._jukebox = { group: group, neonMat: neonMat, neonColors: neonColors, neonIndex: 0, label: labelDiv, pos: { x: x, z: z }, playing: false };
  S.furnitureGroup.add(group);
}

// ============================================================
// RECREATION CENTER
// ============================================================
function buildRecCenter(x, z, matWalnut, matChrome, matFabric) {
  var recCarpet = new THREE.Mesh(new THREE.PlaneGeometry(16, 14), matFabric);
  recCarpet.rotation.x = -Math.PI / 2;
  recCarpet.position.set(x, 0.01, z);
  recCarpet.receiveShadow = true;
  S.furnitureGroup.add(recCarpet);
  // Pool table
  var ptGroup = new THREE.Group();
  ptGroup.position.set(x - 3, 0, z - 1);
  var ptTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.10, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x006633, roughness: 0.9 }));
  ptTop.position.y = 0.85; ptGroup.add(ptTop);
  var ptFrame = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.15, 1.45), matWalnut);
  ptFrame.position.y = 0.78; ptGroup.add(ptFrame);
  [[-1.1,-0.55],[-1.1,0.55],[1.1,-0.55],[1.1,0.55]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.70, 8), matWalnut);
    leg.position.set(p[0], 0.35, p[1]); ptGroup.add(leg);
  });
  S.furnitureGroup.add(ptGroup);
  // Foosball table
  var fbGroup = new THREE.Group();
  fbGroup.position.set(x + 3, 0, z - 1);
  var fbBody = new THREE.Mesh(new THREE.BoxGeometry(1.40, 0.20, 0.75),
    new THREE.MeshStandardMaterial({ color: 0x2a1a0a, roughness: 0.6 }));
  fbBody.position.y = 0.85; fbGroup.add(fbBody);
  var fbField = new THREE.Mesh(new THREE.BoxGeometry(1.20, 0.02, 0.60),
    new THREE.MeshStandardMaterial({ color: 0x006633, roughness: 0.8 }));
  fbField.position.y = 0.96; fbGroup.add(fbField);
  [[-0.6,-0.3],[-0.6,0.3],[0.6,-0.3],[0.6,0.3]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.75, 6), matChrome);
    leg.position.set(p[0], 0.38, p[1]); fbGroup.add(leg);
  });
  [-0.3, 0, 0.3].forEach(function(rz) {
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.90, 6), matChrome);
    rod.position.set(0, 0.98, rz); rod.rotation.z = Math.PI / 2; fbGroup.add(rod);
  });
  S.furnitureGroup.add(fbGroup);
  // Beanbags
  var bbColors = [0xe53e3e, 0x3b82f6, 0x22c55e, 0xa855f7];
  [{ x: -1, z: 4 }, { x: 2, z: 4.5 }, { x: 4, z: 3.5 }, { x: -3, z: 4.5 }].forEach(function(bp, bi) {
    var bbMat = new THREE.MeshStandardMaterial({ color: bbColors[bi], roughness: 0.9 });
    var bot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 16, 12), bbMat);
    bot.position.set(x + bp.x, 0.22, z + bp.z);
    bot.scale.set(1, 0.5, 1);
    S.furnitureGroup.add(bot);
  });
  // Decorative TV
  var tvMat2 = new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.2 });
  var tvBody = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.5, 0.08), tvMat2);
  tvBody.position.set(x, 2.3, z - 6.5);
  S.furnitureGroup.add(tvBody);
  var tvScr = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.3),
    new THREE.MeshStandardMaterial({ color: 0x0a1520, emissive: new THREE.Color(0x22c55e), emissiveIntensity: 0.15, roughness: 0.1 }));
  tvScr.position.set(x, 2.3, z - 6.42);
  S.furnitureGroup.add(tvScr);
  var signDiv = document.createElement('div');
  signDiv.textContent = 'REC ZONE';
  signDiv.style.cssText = 'color:#22c55e;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #22c55e;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4.5, z);
  S.furnitureGroup.add(sign);
}

// ============================================================
// GYM
// ============================================================
function buildGym(x, z, matChrome, matConcrete) {
  var rubberMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.95 });
  var gymFloor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), rubberMat);
  gymFloor.rotation.x = -Math.PI / 2;
  gymFloor.position.set(x, 0.01, z);
  gymFloor.receiveShadow = true;
  S.furnitureGroup.add(gymFloor);
  // Treadmill
  var tmGroup = new THREE.Group();
  tmGroup.position.set(x - 2, 0, z - 2);
  var tmBase = new THREE.Mesh(new THREE.BoxGeometry(0.70, 0.15, 1.60), matConcrete);
  tmBase.position.y = 0.10; tmGroup.add(tmBase);
  var tmBelt = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.02, 1.30),
    new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 }));
  tmBelt.position.y = 0.19; tmGroup.add(tmBelt);
  [-0.30, 0.30].forEach(function(hx) {
    var handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 1.00, 6), matChrome);
    handle.position.set(hx, 0.70, -0.60); tmGroup.add(handle);
  });
  var console2 = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.25, 0.08), matConcrete);
  console2.position.set(0, 1.10, -0.65); tmGroup.add(console2);
  S.furnitureGroup.add(tmGroup);
  // Dumbbell rack
  var rackBase = new THREE.Mesh(new THREE.BoxGeometry(2.80, 0.80, 0.42), matChrome);
  rackBase.position.set(x + 2, 0.40, z - 4);
  S.furnitureGroup.add(rackBase);
  for (var di = 0; di < 6; di++) {
    var dbMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.4 });
    var db = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.30, 8), dbMat);
    db.position.set(x + 0.8 + di * 0.40, 0.90, z - 4);
    db.rotation.z = Math.PI / 2;
    S.furnitureGroup.add(db);
  }
  // Yoga mats
  var yogaMat = new THREE.MeshStandardMaterial({ color: 0x7c3aed, roughness: 0.9 });
  var mat1 = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.02, 1.80), yogaMat);
  mat1.position.set(x + 3, 0.02, z + 2);
  S.furnitureGroup.add(mat1);
  var mat2 = new THREE.Mesh(new THREE.BoxGeometry(0.80, 0.02, 1.80),
    new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.9 }));
  mat2.position.set(x + 4.2, 0.02, z + 2);
  S.furnitureGroup.add(mat2);
  var signDiv = document.createElement('div');
  signDiv.textContent = 'FITNESS';
  signDiv.style.cssText = 'color:#ef4444;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;text-shadow:0 0 8px #ef4444;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(x, 4.0, z);
  S.furnitureGroup.add(sign);
}

// ============================================================
// PLANTS
// ============================================================
function buildCampusPlants() {
  var plantPositions = [
    [-38, 20], [38, 20], [-38, 0], [38, 0],
    [-12, 22], [12, 22], [-20, 10], [20, 10],
    [-20, -10], [20, -10], [0, 24],
    [-8, -20], [8, -20], [-28, -10], [28, -10],
  ];
  plantPositions.forEach(function(pos) {
    buildLuxuryPlant(pos[0], pos[1]);
  });
  [[-30, 5], [30, 5], [0, -12], [-15, 20], [15, 20]].forEach(function(pos) {
    buildIndoorTree(pos[0], pos[1]);
  });
}

function buildLuxuryPlant(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var planterMat = new THREE.MeshStandardMaterial({ color: 0x3a3a4a, roughness: 0.62 });
  var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.20, 0.52, 12), planterMat);
  planter.position.y = 0.26; group.add(planter);
  var leafMat = new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.80 });
  for (var i = 0; i < 7; i++) {
    var a = (i / 7) * Math.PI * 2;
    var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), leafMat);
    leaf.position.set(Math.cos(a) * 0.16, 0.62, Math.sin(a) * 0.16);
    group.add(leaf);
  }
  var topLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), leafMat);
  topLeaf.position.y = 0.77; group.add(topLeaf);
  S.furnitureGroup.add(group);
}

function buildIndoorTree(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var planterMat = new THREE.MeshStandardMaterial({ color: 0x2a2d35, roughness: 0.52 });
  var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.36, 0.64, 12), planterMat);
  planter.position.y = 0.32; group.add(planter);
  var trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.80 });
  var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.11, 2.6, 8), trunkMat);
  trunk.position.y = 1.92; group.add(trunk);
  var cm1 = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.85 });
  var cm2 = new THREE.MeshStandardMaterial({ color: 0x2d8a4e, roughness: 0.85 });
  [{ y: 2.9, r: 0.65 }, { y: 3.30, r: 0.52 }, { y: 3.60, r: 0.36 }].forEach(function(c, ci) {
    var canopy = new THREE.Mesh(new THREE.SphereGeometry(c.r, 12, 10), ci % 2 === 0 ? cm1 : cm2);
    canopy.position.y = c.y; group.add(canopy);
  });
  S.furnitureGroup.add(group);
}

// ============================================================
// PENDANT LIGHTS
// ============================================================
function buildPendantLights() {
  var positions = [
    [0, 6], [0, 10], [0, 14], [0, 18],
    [-8, 6], [-8, 14], [8, 6], [8, 14],
    [-28, 0], [28, 0],
    [-28, -18], [0, -18], [28, -18],
    [30, 10],
    [0, 24], [-10, 24], [10, 24],
  ];
  positions.forEach(function(pos) {
    buildPendantLight(pos[0], pos[1]);
  });
}

function buildPendantLight(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var wireMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 });
  var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.60, 4), wireMat);
  wire.position.y = WALL_H - 0.80; group.add(wire);
  var shadeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.3, side: THREE.DoubleSide });
  var shade = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.22, 12, 1, true), shadeMat);
  shade.position.y = WALL_H - 1.70; group.add(shade);
  var light = new THREE.PointLight(0xffeedd, 0.22, 6);
  light.position.y = WALL_H - 1.85;
  light.castShadow = false;
  group.add(light);
  S.furnitureGroup.add(group);
}

// ============================================================
// GLASS PARTITIONS
// ============================================================
function buildGlassPartitions(matGlass, matFrame) {
  // Between workspace and zone areas
  var p1 = new THREE.Mesh(new THREE.PlaneGeometry(26, 2.8), matGlass);
  p1.position.set(0, 1.40, 3.0);
  S.furnitureGroup.add(p1);
  var f1 = new THREE.Mesh(new THREE.BoxGeometry(26, 0.04, 0.04), matFrame);
  f1.position.set(0, 2.82, 3.0);
  S.furnitureGroup.add(f1);
  // Between manager office and workspace
  var p2 = new THREE.Mesh(new THREE.PlaneGeometry(14, 2.8), matGlass);
  p2.position.set(22, 1.40, 8);
  p2.rotation.y = Math.PI / 2;
  S.furnitureGroup.add(p2);
  var f2 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 14), matFrame);
  f2.position.set(22, 2.82, 8);
  S.furnitureGroup.add(f2);
}

// ============================================================
// NEON SIGNS
// ============================================================
function buildNeonSign(text, x, y, z, matNeon) {
  var glowBar = new THREE.Mesh(new THREE.BoxGeometry(text.length * 0.44, 0.40, 0.04), matNeon);
  glowBar.position.set(x, y, z);
  S.furnitureGroup.add(glowBar);
  var color = '#' + matNeon.color.getHexString();
  var div = document.createElement('div');
  div.textContent = text;
  div.style.cssText = 'color:' + color + ';font-size:13px;font-weight:900;font-family:Inter,sans-serif;letter-spacing:4px;text-shadow:0 0 14px ' + color + ',0 0 28px ' + color + ';';
  var label = new CSS2DObject(div);
  label.position.set(x, y, z + 0.05);
  S.furnitureGroup.add(label);
}
