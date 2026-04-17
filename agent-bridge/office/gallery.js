import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';

// ============================================================
// GALLERY WING — Premium art gallery inside the campus
// Far-left upper zone, open east side facing workspace
// Houses API agent robot + premium display screens
// ============================================================

// Position: inside campus, upper-left area
var GALLERY_X = -36;       // gallery center X
var GALLERY_Z = 10;        // gallery center Z
var GALLERY_W = 14;        // gallery width (X axis)
var GALLERY_D = 12;        // gallery depth (Z axis)
var GALLERY_H = 5.5;       // gallery height (taller for drama)
var SCREEN_W = 4.5;        // large premium screens
var SCREEN_H = 2.8;

// Robot desk — 3 seats, one per monitor (image/video/texture)
var _deskCenter = { x: GALLERY_X - 2, z: GALLERY_Z + 2 };
export var GALLERY_DESK_POS = _deskCenter; // legacy compat
export var GALLERY_SEATS = {
  image:   { x: _deskCenter.x - 0.9, z: _deskCenter.z + 0.8 },  // left monitor
  video:   { x: _deskCenter.x,       z: _deskCenter.z + 0.8 },  // center monitor
  texture: { x: _deskCenter.x + 0.9, z: _deskCenter.z + 0.8 },  // right monitor
};

export function buildGalleryRoom() {
  var group = new THREE.Group();

  // === MATERIALS PALETTE (premium) ===
  var wallMat = new THREE.MeshStandardMaterial({ color: 0x12121e, roughness: 0.85 });
  var accentWallMat = new THREE.MeshStandardMaterial({ color: 0x0e0e1a, roughness: 0.8 });
  var glassMat = new THREE.MeshStandardMaterial({ color: 0xaaccee, transparent: true, opacity: 0.18, roughness: 0.05, metalness: 0.15 });
  var glassFrameMat = new THREE.MeshStandardMaterial({ color: 0x555566, roughness: 0.2, metalness: 0.6 });
  var chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.1, metalness: 0.85 });
  var goldMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.3, metalness: 0.7 });
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x0a0a14, roughness: 0.3, metalness: 0.1 });
  var neonCyanMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.7, roughness: 0.2 });
  var neonPinkMat = new THREE.MeshStandardMaterial({ color: 0xec4899, emissive: 0xec4899, emissiveIntensity: 0.6, roughness: 0.2 });
  var neonGreenMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, emissive: 0x22c55e, emissiveIntensity: 0.6, roughness: 0.2 });
  var leatherMat = new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.65 });

  // ============================================================
  // GALLERY ROOM (inside campus, open east side)
  // ============================================================
  var gx = GALLERY_X, gz = GALLERY_Z;
  var hw = GALLERY_W / 2, hd = GALLERY_D / 2;

  // --- FLOOR: Premium dark polished concrete with gold veins ---
  var floorSize = 512;
  var floorCvs = document.createElement('canvas');
  floorCvs.width = floorSize; floorCvs.height = floorSize;
  var floorCtx = floorCvs.getContext('2d');
  // Dark base
  floorCtx.fillStyle = '#0c0c16';
  floorCtx.fillRect(0, 0, floorSize, floorSize);
  // Subtle gold veins
  for (var vi = 0; vi < 40; vi++) {
    floorCtx.beginPath();
    floorCtx.strokeStyle = 'rgba(180,150,80,' + (0.03 + Math.random() * 0.06) + ')';
    floorCtx.lineWidth = 0.5 + Math.random() * 1.5;
    var sx = Math.random() * floorSize, sy = Math.random() * floorSize;
    floorCtx.moveTo(sx, sy);
    for (var vj = 0; vj < 5; vj++) {
      sx += (Math.random() - 0.5) * 100;
      sy += (Math.random() - 0.5) * 100;
      floorCtx.lineTo(sx, sy);
    }
    floorCtx.stroke();
  }
  // Tile grid
  var tileSize = floorSize / 8;
  floorCtx.strokeStyle = 'rgba(40,40,60,0.5)';
  floorCtx.lineWidth = 1;
  for (var tx = 0; tx <= 8; tx++) {
    floorCtx.beginPath(); floorCtx.moveTo(tx * tileSize, 0); floorCtx.lineTo(tx * tileSize, floorSize); floorCtx.stroke();
    floorCtx.beginPath(); floorCtx.moveTo(0, tx * tileSize); floorCtx.lineTo(floorSize, tx * tileSize); floorCtx.stroke();
  }

  var floorTex = new THREE.CanvasTexture(floorCvs);
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  var floor = new THREE.Mesh(new THREE.PlaneGeometry(GALLERY_W, GALLERY_D),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.1, metalness: 0.08 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(gx, 0.02, gz);
  floor.receiveShadow = true;
  group.add(floor);

  // --- WALLS ---
  // West wall — IMAGE GALLERY (main showcase, deepest wall)
  var westWall = new THREE.Mesh(new THREE.BoxGeometry(0.2, GALLERY_H, GALLERY_D), accentWallMat);
  westWall.position.set(gx - hw, GALLERY_H / 2, gz);
  westWall.castShadow = true;
  group.add(westWall);

  // South wall (VIDEO GALLERY)
  var southWall = new THREE.Mesh(new THREE.BoxGeometry(GALLERY_W, GALLERY_H, 0.2), wallMat);
  southWall.position.set(gx, GALLERY_H / 2, gz - hd);
  southWall.castShadow = true;
  group.add(southWall);

  // North wall (TEXTURE GALLERY)
  var northWall = new THREE.Mesh(new THREE.BoxGeometry(GALLERY_W, GALLERY_H, 0.2), wallMat);
  northWall.position.set(gx, GALLERY_H / 2, gz + hd);
  northWall.castShadow = true;
  group.add(northWall);

  // East side — glass facade with center entrance (faces workspace)
  var doorWidth = 2.5;
  var eastPanelD = (GALLERY_D - doorWidth) / 2;
  // South glass panel
  var egSouth = new THREE.Mesh(new THREE.BoxGeometry(0.08, GALLERY_H, eastPanelD), glassMat);
  egSouth.position.set(gx + hw, GALLERY_H / 2, gz - doorWidth / 2 - eastPanelD / 2);
  group.add(egSouth);
  // North glass panel
  var egNorth = new THREE.Mesh(new THREE.BoxGeometry(0.08, GALLERY_H, eastPanelD), glassMat);
  egNorth.position.set(gx + hw, GALLERY_H / 2, gz + doorWidth / 2 + eastPanelD / 2);
  group.add(egNorth);
  // Door header
  var doorHeader = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.12, doorWidth + 0.4), chromeMat);
  doorHeader.position.set(gx + hw, GALLERY_H - 0.4, gz);
  group.add(doorHeader);
  // Glass frame mullions (vertical chrome strips)
  [-eastPanelD, 0, eastPanelD].forEach(function(mz) {
    [-1, 1].forEach(function(side) {
      if (mz === 0 && side === -1) return;
      var mullion = new THREE.Mesh(new THREE.BoxGeometry(0.1, GALLERY_H, 0.03), glassFrameMat);
      mullion.position.set(gx + hw, GALLERY_H / 2, gz + mz * side);
      group.add(mullion);
    });
  });

  // Ceiling — dark with recessed lighting channels
  var ceiling = new THREE.Mesh(new THREE.PlaneGeometry(GALLERY_W, GALLERY_D), wallMat);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.set(gx, GALLERY_H, gz);
  group.add(ceiling);

  // --- GOLD ACCENT TRIM (baseboard + crown molding) ---
  // Baseboard: west, south, north walls
  [[-hw, 0.04, 0, 0.06, 0.08, GALLERY_D],
   [0, 0.04, -hd, GALLERY_W, 0.08, 0.06],
   [0, 0.04, hd, GALLERY_W, 0.08, 0.06]].forEach(function(t) {
    var trim = new THREE.Mesh(new THREE.BoxGeometry(t[3], t[4], t[5]), goldMat);
    trim.position.set(gx + t[0], t[1], gz + t[2]);
    group.add(trim);
  });
  // Crown molding: west, south, north walls
  [[-hw, GALLERY_H - 0.04, 0, 0.08, 0.06, GALLERY_D],
   [0, GALLERY_H - 0.04, -hd, GALLERY_W + 0.1, 0.06, 0.08],
   [0, GALLERY_H - 0.04, hd, GALLERY_W + 0.1, 0.06, 0.08]].forEach(function(t) {
    var crown = new THREE.Mesh(new THREE.BoxGeometry(t[3], t[4], t[5]), goldMat);
    crown.position.set(gx + t[0], t[1], gz + t[2]);
    group.add(crown);
  });

  // ============================================================
  // SCREENS — Large premium displays
  // ============================================================

  // IMAGE GALLERY (west wall — centerpiece, biggest screen)
  var imgScreen = buildScreen(SCREEN_W, SCREEN_H, 'IMAGE GALLERY', neonCyanMat, 0x06b6d4, 1280, 800);
  imgScreen.group.position.set(gx - hw + 0.15, GALLERY_H / 2 - 0.25, gz);
  imgScreen.group.rotation.y = Math.PI / 2;
  group.add(imgScreen.group);

  // VIDEO GALLERY (south wall)
  var vidScreen = buildScreen(SCREEN_W - 0.5, SCREEN_H - 0.3, 'VIDEO GALLERY', neonPinkMat, 0xec4899, 1280, 800);
  vidScreen.group.position.set(gx, GALLERY_H / 2 - 0.25, gz - hd + 0.15);
  group.add(vidScreen.group);

  // TEXTURE GALLERY (north wall)
  var texScreen = buildScreen(SCREEN_W - 0.5, SCREEN_H - 0.3, 'TEXTURE GALLERY', neonGreenMat, 0x22c55e, 1280, 800);
  texScreen.group.position.set(gx, GALLERY_H / 2 - 0.25, gz + hd - 0.15);
  texScreen.group.rotation.y = Math.PI;
  group.add(texScreen.group);

  // ============================================================
  // TRACK LIGHTING (museum-style spotlights)
  // ============================================================
  // West wall spots (illuminate image gallery — main showcase)
  [-2.5, 0, 2.5].forEach(function(lz) {
    var spot = new THREE.SpotLight(0xeeeeff, 0.6, 8, Math.PI / 6, 0.4);
    spot.position.set(gx - hw + 2.5, GALLERY_H - 0.3, gz + lz);
    spot.target.position.set(gx - hw + 0.2, GALLERY_H / 2, gz + lz);
    group.add(spot);
    group.add(spot.target);
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 0.04), chromeMat);
    rail.position.set(gx - hw + 2.5, GALLERY_H - 0.15, gz + lz);
    group.add(rail);
    var housing = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.04, 0.1, 8), darkMat);
    housing.position.set(gx - hw + 2.5, GALLERY_H - 0.25, gz + lz);
    group.add(housing);
  });

  // South + north wall spots
  [[gz - hd + 2, gz - hd + 0.2], [gz + hd - 2, gz + hd - 0.2]].forEach(function(sp) {
    var spot = new THREE.SpotLight(0xeeeeff, 0.4, 7, Math.PI / 6, 0.4);
    spot.position.set(gx, GALLERY_H - 0.3, sp[0]);
    spot.target.position.set(gx, GALLERY_H / 2, sp[1]);
    group.add(spot);
    group.add(spot.target);
  });

  // Main overhead track rail (chrome bar along Z axis near west wall)
  var mainRail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, GALLERY_D - 2), chromeMat);
  mainRail.position.set(gx - hw + 2.5, GALLERY_H - 0.08, gz);
  group.add(mainRail);

  // Ambient fill light
  var ambientFill = new THREE.PointLight(0x223344, 0.25, 14);
  ambientFill.position.set(gx, GALLERY_H - 0.5, gz);
  group.add(ambientFill);

  // ============================================================
  // VIEWING FURNITURE
  // ============================================================

  // Premium leather bench (center, facing back wall)
  var benchSeat = new THREE.Mesh(new THREE.BoxGeometry(3, 0.1, 0.7), leatherMat);
  benchSeat.position.set(gx, 0.48, gz + 0.5);
  benchSeat.castShadow = true;
  group.add(benchSeat);
  // Bench chrome legs
  [[-1.3, -0.25], [-1.3, 0.25], [1.3, -0.25], [1.3, 0.25]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.45, 8), chromeMat);
    leg.position.set(gx + p[0], 0.24, gz + 0.5 + p[1]);
    group.add(leg);
  });

  // Side tables (small chrome + glass)
  [-2.5, 2.5].forEach(function(stx) {
    var tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 12),
      new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.4 }));
    tableTop.position.set(gx + stx, 0.5, gz + 0.5);
    group.add(tableTop);
    var tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.48, 8), chromeMat);
    tableLeg.position.set(gx + stx, 0.26, gz + 0.5);
    group.add(tableLeg);
    var tableBase = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.02, 12), chromeMat);
    tableBase.position.set(gx + stx, 0.02, gz + 0.5);
    group.add(tableBase);
  });

  // ============================================================
  // ROBOT WORKSTATION (left-front area of gallery)
  // ============================================================
  var deskX = GALLERY_DESK_POS.x, deskZ = GALLERY_DESK_POS.z;

  // Server-style desk (wider, with multiple monitors)
  var deskMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.3, metalness: 0.15 });
  var deskTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.05, 1), deskMat);
  deskTop.position.set(deskX, 0.76, deskZ);
  deskTop.castShadow = true;
  group.add(deskTop);

  // RGB LED under desk edge (cyan for Ollama default)
  var deskLed = new THREE.Mesh(new THREE.BoxGeometry(3.1, 0.015, 0.015), neonCyanMat);
  deskLed.position.set(deskX, 0.74, deskZ + 0.49);
  group.add(deskLed);

  // Desk legs (chrome)
  [[-1.5, -0.4], [-1.5, 0.4], [1.5, -0.4], [1.5, 0.4]].forEach(function(p) {
    var leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.05), chromeMat);
    leg.position.set(deskX + p[0], 0.38, deskZ + p[1]);
    group.add(leg);
  });

  // Triple monitor setup — canvas-textured, mirroring wall screens
  var deskMonitorOffsets = [-0.9, 0, 0.9];
  var deskMonitorLabels  = ['IMAGE GALLERY', 'VIDEO GALLERY', 'TEXTURE GALLERY'];
  var deskMonitorColors  = [0x06b6d4, 0xec4899, 0x22c55e];
  var deskMonitorKeys    = ['image', 'video', 'texture'];
  S.galleryDeskScreens   = {};

  deskMonitorOffsets.forEach(function(mx, mi) {
    var monBody = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.32, 0.025),
      new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.2 }));
    monBody.position.set(deskX + mx, 1.15, deskZ - 0.3);
    if (mi === 0) monBody.rotation.y = 0.12;
    if (mi === 2) monBody.rotation.y = -0.12;
    monBody.castShadow = true;
    group.add(monBody);

    // Canvas-textured monitor screen
    var monCvs = document.createElement('canvas');
    var monCW = 640, monCH = 400;
    monCvs.width = monCW; monCvs.height = monCH;
    var monCtx = monCvs.getContext('2d');
    // Premium placeholder — same style as buildScreen()
    monCtx.fillStyle = '#08080f';
    monCtx.fillRect(0, 0, monCW, monCH);
    monCtx.strokeStyle = 'rgba(40,40,60,0.3)';
    monCtx.lineWidth = 0.5;
    for (var mgx = 0; mgx < monCW; mgx += 40) {
      monCtx.beginPath(); monCtx.moveTo(mgx, 0); monCtx.lineTo(mgx, monCH); monCtx.stroke();
    }
    for (var mgy = 0; mgy < monCH; mgy += 40) {
      monCtx.beginPath(); monCtx.moveTo(0, mgy); monCtx.lineTo(monCW, mgy); monCtx.stroke();
    }
    var monColorHex = '#' + deskMonitorColors[mi].toString(16).padStart(6, '0');
    monCtx.fillStyle = monColorHex;
    monCtx.globalAlpha = 0.4;
    monCtx.font = 'bold 28px monospace';
    monCtx.textAlign = 'center';
    monCtx.fillText(deskMonitorLabels[mi], monCW / 2, monCH / 2 - 10);
    monCtx.globalAlpha = 0.25;
    monCtx.font = '14px monospace';
    monCtx.fillText('Awaiting content...', monCW / 2, monCH / 2 + 22);
    monCtx.globalAlpha = 1;

    var monTex = new THREE.CanvasTexture(monCvs);
    monTex.minFilter = THREE.LinearFilter;
    var monScreenMat = new THREE.MeshStandardMaterial({
      map: monTex, emissive: 0xffffff, emissiveMap: monTex, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0,
    });
    var monScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.27), monScreenMat);
    monScreen.position.set(deskX + mx, 1.15, deskZ - 0.286);
    if (mi === 0) { monScreen.rotation.y = 0.12; monScreen.position.x += 0.01; monScreen.position.z += 0.005; }
    if (mi === 2) { monScreen.rotation.y = -0.12; monScreen.position.x -= 0.01; monScreen.position.z += 0.005; }
    group.add(monScreen);

    // Monitor stand
    var standArm = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), chromeMat);
    standArm.position.set(deskX + mx, 0.92, deskZ - 0.3);
    group.add(standArm);

    // Store reference in S.galleryDeskScreens
    S.galleryDeskScreens[deskMonitorKeys[mi]] = {
      canvas: monCvs, context: monCtx, texture: monTex, canvasW: monCW, canvasH: monCH,
    };
  });

  // Gaming keyboard
  var kbMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5, metalness: 0.2 });
  var keyboard = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.02, 0.12), kbMat);
  keyboard.position.set(deskX - 0.1, 0.78, deskZ + 0.15);
  keyboard.castShadow = true;
  group.add(keyboard);

  // Mousepad
  var padMat = new THREE.MeshStandardMaterial({ color: 0x0d0d0d, roughness: 0.9, metalness: 0.0 });
  var mousepad = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.005, 0.20), padMat);
  mousepad.position.set(deskX + 0.3, 0.765, deskZ + 0.15);
  group.add(mousepad);

  // Mouse
  var mouseMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2a, roughness: 0.4, metalness: 0.3 });
  var mouse = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.02, 0.07), mouseMat);
  mouse.position.set(deskX + 0.3, 0.78, deskZ + 0.15);
  mouse.castShadow = true;
  group.add(mouse);

  // Gaming PC tower
  var towerMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.35, metalness: 0.25 });
  var tower = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.45), towerMat);
  tower.position.set(deskX + 1.0, 0.23, deskZ);
  tower.castShadow = true;
  group.add(tower);
  // RGB glass side panel (cyan glow)
  var rgbGlassMat = new THREE.MeshStandardMaterial({
    color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.45,
    transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.1,
  });
  var rgbPanel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), rgbGlassMat);
  rgbPanel.rotation.y = -Math.PI / 2;
  rgbPanel.position.set(deskX + 1.0 + 0.111, 0.23, deskZ);
  group.add(rgbPanel);

  // Server rack (behind desk, small decorative)
  var rackMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.4, metalness: 0.3 });
  var rack = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.2, 0.4), rackMat);
  rack.position.set(deskX + 1.5, 0.6, deskZ - 0.3);
  rack.castShadow = true;
  group.add(rack);
  // Rack LED indicators
  for (var ri = 0; ri < 4; ri++) {
    var ledColor = [0x22c55e, 0x06b6d4, 0x22c55e, 0xeab308][ri];
    var rackLed = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6),
      new THREE.MeshStandardMaterial({ color: ledColor, emissive: ledColor, emissiveIntensity: 0.8 }));
    rackLed.position.set(deskX + 1.5 + 0.31, 0.35 + ri * 0.22, deskZ - 0.1);
    group.add(rackLed);
  }

  // 3 Gaming chairs — one per monitor seat (image/video/texture)
  buildGalleryChair(group, deskX - 0.9, deskZ + 0.8, 0x06b6d4);  // left = image (cyan)
  buildGalleryChair(group, deskX,       deskZ + 0.8, 0xec4899);  // center = video (pink)
  buildGalleryChair(group, deskX + 0.9, deskZ + 0.8, 0x22c55e);  // right = texture (green)

  // ============================================================
  // NEON ACCENTS & SIGNS
  // ============================================================

  // "GALLERY" sign (above entrance, exterior facing)
  var signDiv = document.createElement('div');
  signDiv.textContent = 'G A L L E R Y';
  signDiv.style.cssText = 'color:#06b6d4;font-size:16px;font-weight:900;font-family:Inter,sans-serif;letter-spacing:8px;text-shadow:0 0 20px rgba(6,182,212,0.7),0 0 40px rgba(6,182,212,0.3);';
  var signLabel = new CSS2DObject(signDiv);
  signLabel.position.set(gx + hw + 0.3, GALLERY_H + 0.3, gz);
  group.add(signLabel);

  // Interior neon accent strips along ceiling edges
  [[-hw + 0.1, GALLERY_H - 0.06, 0, 0.02, 0.02, GALLERY_D - 0.4, neonCyanMat],
   [0, GALLERY_H - 0.06, -hd + 0.1, GALLERY_W - 0.4, 0.02, 0.02, neonPinkMat],
   [0, GALLERY_H - 0.06, hd - 0.1, GALLERY_W - 0.4, 0.02, 0.02, neonGreenMat]].forEach(function(n) {
    var strip = new THREE.Mesh(new THREE.BoxGeometry(n[3], n[4], n[5]), n[6]);
    strip.position.set(gx + n[0], n[1], gz + n[2]);
    group.add(strip);
  });

  // Floor LED guide strips (leading to each screen)
  // West wall guide (to image gallery)
  var guideWest = new THREE.Mesh(new THREE.BoxGeometry(hw - 1, 0.01, 0.03), neonCyanMat);
  guideWest.position.set(gx - (hw - 1) / 2 - 0.5, 0.025, gz);
  group.add(guideWest);
  // South wall guide (to video gallery)
  var guideSouth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, hd - 2), neonPinkMat);
  guideSouth.position.set(gx, 0.025, gz - (hd - 2) / 2 - 1);
  group.add(guideSouth);
  // North wall guide (to texture gallery)
  var guideNorth = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, hd - 2), neonGreenMat);
  guideNorth.position.set(gx, 0.025, gz + (hd - 2) / 2 + 1);
  group.add(guideNorth);

  // ============================================================
  // DECORATIVE ELEMENTS
  // ============================================================

  // Sculptural pedestal with abstract art (near entrance)
  var pedestalMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3, metalness: 0.1 });
  var pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), pedestalMat);
  pedestal.position.set(gx + 3, 0.5, gz + 4);
  pedestal.castShadow = true;
  group.add(pedestal);
  // Gold top plate
  var pedTop = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.55), goldMat);
  pedTop.position.set(gx + 3, 1.015, gz + 4);
  group.add(pedTop);
  // Abstract sphere sculpture
  var sculptMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, roughness: 0.05, metalness: 0.9 });
  var sculpt = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 16), sculptMat);
  sculpt.position.set(gx + 3, 1.25, gz + 4);
  group.add(sculpt);

  // Second pedestal (left side)
  var pedestal2 = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.0, 0.5), pedestalMat);
  pedestal2.position.set(gx - 3, 0.5, gz + 4);
  pedestal2.castShadow = true;
  group.add(pedestal2);
  var pedTop2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.03, 0.55), goldMat);
  pedTop2.position.set(gx - 3, 1.015, gz + 4);
  group.add(pedTop2);
  // Abstract cube sculpture (rotated)
  var sculptMat2 = new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.05, metalness: 0.9 });
  var sculpt2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), sculptMat2);
  sculpt2.position.set(gx - 3, 1.2, gz + 4);
  sculpt2.rotation.y = Math.PI / 4;
  sculpt2.rotation.x = Math.PI / 6;
  group.add(sculpt2);

  // Luxury plant (near entrance right)
  var potMat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.5 });
  var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.35, 10), potMat);
  pot.position.set(gx + 5.5, 0.18, gz + 4.5);
  group.add(pot);
  var leafMat = new THREE.MeshStandardMaterial({ color: 0x2d5a27, roughness: 0.7 });
  var leaves = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8), leafMat);
  leaves.position.set(gx + 5.5, 0.6, gz + 4.5);
  leaves.scale.y = 1.3;
  group.add(leaves);

  S.furnitureGroup.add(group);

  // Store screen references for updates
  S.galleryScreens = {
    image: imgScreen,
    video: vidScreen,
    texture: texScreen,
  };
  // Tag screen meshes for raycast identification
  if (imgScreen.screenMesh) imgScreen.screenMesh.userData._galleryScreen = 'image';
  if (vidScreen.screenMesh) vidScreen.screenMesh.userData._galleryScreen = 'video';
  if (texScreen.screenMesh) texScreen.screenMesh.userData._galleryScreen = 'texture';
  // Collect all screen meshes for easy raycasting
  S._galleryScreenMeshes = [imgScreen.screenMesh, vidScreen.screenMesh, texScreen.screenMesh].filter(Boolean);
  S.cachedMedia = [];
  S._galleryDeskPos = GALLERY_DESK_POS;
  S._gallerySeats = GALLERY_SEATS;

  return group;
}

function buildGalleryChair(parent, cx, cz, accentColor) {
  // Chair faces -Z (toward monitors at deskZ - 0.3)
  // Backrest goes behind the bot at +Z side
  var baseMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4, metalness: 0.3 });
  var seatMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.65 });
  var accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.5 });

  // Base hub
  var baseHub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.04, 12), baseMat);
  baseHub.position.set(cx, 0.05, cz);
  parent.add(baseHub);
  // Star base arms + wheels
  for (var i = 0; i < 5; i++) {
    var a = (i / 5) * Math.PI * 2;
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.03), baseMat);
    arm.position.set(cx + Math.cos(a) * 0.15, 0.04, cz + Math.sin(a) * 0.15);
    arm.rotation.y = -a;
    parent.add(arm);
    var wheel = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), baseMat);
    wheel.position.set(cx + Math.cos(a) * 0.28, 0.02, cz + Math.sin(a) * 0.28);
    parent.add(wheel);
  }
  // Stem
  var stem = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.35, 8), baseMat);
  stem.position.set(cx, 0.22, cz);
  parent.add(stem);
  // Seat (matches campus chair height Y=0.46)
  var seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.08, 0.42), seatMat);
  seat.position.set(cx, 0.46, cz);
  seat.castShadow = true;
  parent.add(seat);
  // Backrest — BEHIND the bot (+Z side, bot faces -Z toward monitors)
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.06), seatMat);
  back.position.set(cx, 0.78, cz + 0.20);
  back.castShadow = true;
  parent.add(back);
  // Headrest
  var headrest = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.10, 0.06), seatMat);
  headrest.position.set(cx, 1.10, cz + 0.20);
  parent.add(headrest);
  // Accent stripes on backrest (face -Z, visible side)
  var s1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.005), accentMat);
  s1.position.set(cx - 0.12, 0.78, cz + 0.17);
  parent.add(s1);
  var s2 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.50, 0.005), accentMat);
  s2.position.set(cx + 0.12, 0.78, cz + 0.17);
  parent.add(s2);
  // Armrests
  [-0.22, 0.22].forEach(function(ax) {
    var ap = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.20, 0.03), baseMat);
    ap.position.set(cx + ax, 0.55, cz + 0.05);
    parent.add(ap);
    var apd = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.02, 0.20), seatMat);
    apd.position.set(cx + ax, 0.66, cz + 0.05);
    parent.add(apd);
  });
}

function buildScreen(w, h, label, neonMat, neonColor, canvasW, canvasH) {
  var group = new THREE.Group();
  canvasW = canvasW || 1280;
  canvasH = canvasH || 800;

  // Outer frame (thick, premium)
  var frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, h + 0.2, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x080810, roughness: 0.15, metalness: 0.3 }));
  group.add(frame);

  // Inner bezel (thin chrome)
  var bezel = new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x444455, roughness: 0.1, metalness: 0.7 }));
  bezel.position.z = 0.02;
  group.add(bezel);

  // Canvas screen
  var cvs = document.createElement('canvas');
  cvs.width = canvasW;
  cvs.height = canvasH;
  var ctx = cvs.getContext('2d');

  // Premium placeholder
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, canvasW, canvasH);
  // Subtle grid pattern
  ctx.strokeStyle = 'rgba(40,40,60,0.3)';
  ctx.lineWidth = 0.5;
  for (var gx = 0; gx < canvasW; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, canvasH); ctx.stroke();
  }
  for (var gy = 0; gy < canvasH; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(canvasW, gy); ctx.stroke();
  }
  // Label
  var colorHex = '#' + neonColor.toString(16).padStart(6, '0');
  ctx.fillStyle = colorHex;
  ctx.globalAlpha = 0.4;
  ctx.font = 'bold 48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(label, canvasW / 2, canvasH / 2 - 15);
  ctx.globalAlpha = 0.25;
  ctx.font = '20px monospace';
  ctx.fillText('Awaiting content...', canvasW / 2, canvasH / 2 + 30);
  ctx.globalAlpha = 1;

  var tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  var screenMat = new THREE.MeshStandardMaterial({
    map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.9, roughness: 0.3, metalness: 0,
  });
  var screen = new THREE.Mesh(new THREE.PlaneGeometry(w, h), screenMat);
  screen.position.z = 0.035;
  group.add(screen);

  // Neon glow strips (top + bottom of screen)
  var glowBottom = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.025, 0.02), neonMat);
  glowBottom.position.set(0, -(h / 2) - 0.12, 0.03);
  group.add(glowBottom);
  var glowTop = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.025, 0.02), neonMat);
  glowTop.position.set(0, (h / 2) + 0.12, 0.03);
  group.add(glowTop);

  // Label above screen (CSS2D)
  var labelDiv = document.createElement('div');
  labelDiv.textContent = label;
  labelDiv.style.cssText = 'color:' + colorHex + ';font-size:9px;font-weight:bold;font-family:monospace;letter-spacing:3px;text-shadow:0 0 10px ' + colorHex + ',0 0 20px ' + colorHex + '44;';
  var labelObj = new CSS2DObject(labelDiv);
  labelObj.position.set(0, h / 2 + 0.35, 0);
  group.add(labelObj);

  return { group: group, canvas: cvs, context: ctx, texture: tex, screenMat: screenMat, screenMesh: screen, label: label, canvasW: canvasW, canvasH: canvasH };
}

// ============================================================
// SCREEN UPDATE LOGIC
// 3 screens, each shows ONLY its own media type:
//   IMAGE GALLERY (west)  — type:'image' — concept art, photos, illustrations
//   VIDEO GALLERY (south) — type:'video' — videos, animations, mp4
//   TEXTURE GALLERY (north) — type:'texture' — seamless textures, materials, PBR
// ============================================================

var _loadedImages = {};
var _screenStates = {
  image:   { index: 0, timer: 0, interval: 6,  items: [], page: 0 },
  video:   { index: 0, timer: 3, interval: 8,  items: [], page: 0 },
  texture: { index: 0, timer: 0, interval: 10, items: [], page: 0 },
};

function _mediaUrl(mediaId) {
  var path = '/api/media/' + mediaId + '/file';
  if (typeof window.scopedApiUrl === 'function') {
    return window.scopedApiUrl(path, null, { includeBranch: false });
  }
  return path + (window.currentProjectPath ? '?project=' + encodeURIComponent(window.currentProjectPath) : '');
}

export function updateGalleryScreens(mediaItems) {
  if (!S.galleryScreens || !mediaItems || mediaItems.length === 0) return;
  S.cachedMedia = mediaItems;

  // Split by type — each screen gets ONLY its own category
  var images = mediaItems.filter(function(m) { return m.type === 'image'; });
  var videos = mediaItems.filter(function(m) { return m.type === 'video'; });
  var textures = mediaItems.filter(function(m) { return m.type === 'texture'; });

  // IMAGE GALLERY — single image slideshow
  _screenStates.image.items = images;
  if (S.galleryScreens.image) {
    if (images.length > 0) {
      _showSingleImage(S.galleryScreens.image, images[0], _screenStates.image, 0x06b6d4);
    } else {
      _drawEmptyScreen(S.galleryScreens.image, 'IMAGE GALLERY', 0x06b6d4, 'Generate images to display here');
    }
  }

  // VIDEO GALLERY — single video/still slideshow (shows thumbnail for videos)
  _screenStates.video.items = videos;
  if (S.galleryScreens.video) {
    if (videos.length > 0) {
      _showSingleImage(S.galleryScreens.video, videos[0], _screenStates.video, 0xec4899);
    } else {
      _drawEmptyScreen(S.galleryScreens.video, 'VIDEO GALLERY', 0xec4899, 'Use "video" or "animation" in prompt');
    }
  }

  // TEXTURE GALLERY — 3x2 grid view
  _screenStates.texture.items = textures;
  if (S.galleryScreens.texture) {
    if (textures.length > 0) {
      _drawTextureGrid(S.galleryScreens.texture, textures, 0);
    } else {
      _drawEmptyScreen(S.galleryScreens.texture, 'TEXTURE GALLERY', 0x22c55e, 'Use "texture" or "seamless" in prompt');
    }
  }

  // Update robot desk monitors (mirror wall screens)
  if (S.galleryDeskScreens) {
    if (images.length > 0 && S.galleryDeskScreens.image) {
      _showSingleImage(S.galleryDeskScreens.image, images[0], _screenStates.image, 0x06b6d4);
    }
    if (videos.length > 0 && S.galleryDeskScreens.video) {
      _showSingleImage(S.galleryDeskScreens.video, videos[0], _screenStates.video, 0xec4899);
    }
    if (textures.length > 0 && S.galleryDeskScreens.texture) {
      _showSingleImage(S.galleryDeskScreens.texture, textures[0], _screenStates.texture, 0x22c55e);
    }
  }
}

export function tickGallery(dt) {
  // No auto-advance — user navigates with E/Q while looking at a screen
}

// Navigate a specific screen forward/backward (called from player E/Q raycast)
export function galleryNavigate(screenName, direction) {
  if (!S.galleryScreens || !S.galleryScreens[screenName]) return;
  var st = _screenStates[screenName];
  if (!st || st.items.length === 0) return;

  var colors = { image: 0x06b6d4, video: 0xec4899, texture: 0x22c55e };

  if (screenName === 'texture') {
    var maxPage = Math.ceil(st.items.length / 6) - 1;
    st.page = direction > 0 ? Math.min(st.page + 1, maxPage) : Math.max(st.page - 1, 0);
    _drawTextureGrid(S.galleryScreens.texture, st.items, st.page);
  } else {
    st.index = st.index + direction;
    if (st.index < 0) st.index = st.items.length - 1;
    if (st.index >= st.items.length) st.index = 0;
    _showSingleImage(S.galleryScreens[screenName], st.items[st.index], st, colors[screenName]);
  }

  // Sync desk monitor
  if (S.galleryDeskScreens && S.galleryDeskScreens[screenName] && st.items.length > 0) {
    var idx = screenName === 'texture' ? Math.min(st.page * 6, st.items.length - 1) : st.index;
    _showSingleImage(S.galleryDeskScreens[screenName], st.items[idx], st, colors[screenName]);
  }
}

// ==================== SINGLE IMAGE RENDERER ====================

// ==================== EMPTY SCREEN PLACEHOLDER ====================

function _drawEmptyScreen(screen, title, accentColor, hint) {
  if (!screen) return;
  var ctx = screen.context;
  var cw = screen.canvasW, ch = screen.canvasH;
  var hex = '#' + accentColor.toString(16).padStart(6, '0');

  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, cw, ch);

  // Subtle grid
  ctx.strokeStyle = 'rgba(40,40,60,0.2)';
  ctx.lineWidth = 0.5;
  for (var gx = 0; gx < cw; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, ch); ctx.stroke();
  }
  for (var gy = 0; gy < ch; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(cw, gy); ctx.stroke();
  }

  // Title
  ctx.fillStyle = hex;
  ctx.globalAlpha = 0.5;
  ctx.font = 'bold 42px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title, cw / 2, ch / 2 - 20);

  // Hint
  ctx.globalAlpha = 0.3;
  ctx.font = '18px monospace';
  ctx.fillText(hint || 'Awaiting content...', cw / 2, ch / 2 + 25);
  ctx.globalAlpha = 1;

  screen.texture.needsUpdate = true;
}

// ==================== SINGLE IMAGE RENDERER ====================

function _showSingleImage(screen, mediaItem, state, accentColor) {
  if (!screen || !mediaItem) return;
  var imgUrl = _mediaUrl(mediaItem.id);

  if (_loadedImages[mediaItem.id]) {
    _drawFittedImage(screen, _loadedImages[mediaItem.id], mediaItem, state, accentColor);
    return;
  }

  // Show loading state
  var ctx = screen.context;
  var cw = screen.canvasW, ch = screen.canvasH;
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, cw, ch);
  var hex = '#' + accentColor.toString(16).padStart(6, '0');
  ctx.fillStyle = hex + '66';
  ctx.font = '24px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Loading...', cw / 2, ch / 2);
  screen.texture.needsUpdate = true;

  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function() {
    _loadedImages[mediaItem.id] = img;
    _drawFittedImage(screen, img, mediaItem, state, accentColor);
  };
  img.onerror = function() {
    ctx.fillStyle = '#0a0a10';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#ef4444';
    ctx.font = '22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('Failed to load', cw / 2, ch / 2);
    screen.texture.needsUpdate = true;
  };
  img.src = imgUrl;
}

function _drawFittedImage(screen, img, mediaItem, state, accentColor) {
  var ctx = screen.context;
  var cw = screen.canvasW, ch = screen.canvasH;
  var hex = '#' + accentColor.toString(16).padStart(6, '0');

  // Dark background
  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, cw, ch);

  // Fit image preserving aspect ratio, with bottom bar for prompt
  var barH = 60;
  var padX = 16, padY = 10;
  var availW = cw - padX * 2;
  var availH = ch - barH - padY * 2;
  var scale = Math.min(availW / img.width, availH / img.height);
  var dw = img.width * scale;
  var dh = img.height * scale;
  var dx = (cw - dw) / 2;
  var dy = padY + (availH - dh) / 2;

  // Subtle shadow behind image
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(dx + 3, dy + 3, dw, dh);

  // Draw image
  ctx.drawImage(img, dx, dy, dw, dh);

  // Thin accent border around image
  ctx.strokeStyle = hex + '44';
  ctx.lineWidth = 1;
  ctx.strokeRect(dx - 1, dy - 1, dw + 2, dh + 2);

  // Bottom info bar
  ctx.fillStyle = 'rgba(0,0,0,0.80)';
  ctx.fillRect(0, ch - barH, cw, barH);
  // Accent line at top of bar
  ctx.fillStyle = hex + '88';
  ctx.fillRect(0, ch - barH, cw, 2);

  // Prompt text (truncated, wrapped to 2 lines)
  var prompt = mediaItem.prompt || '';
  ctx.fillStyle = '#ccc';
  ctx.font = '14px monospace';
  ctx.textAlign = 'left';
  var maxChars = Math.floor((cw - 140) / 8.4);
  var line1 = prompt.substring(0, maxChars);
  var line2 = prompt.length > maxChars ? prompt.substring(maxChars, maxChars * 2) : '';
  if (prompt.length > maxChars * 2) line2 = line2.substring(0, line2.length - 3) + '...';
  ctx.fillText(line1, 12, ch - barH + 22);
  if (line2) ctx.fillText(line2, 12, ch - barH + 40);

  // Counter + model badge (right side)
  var total = state.items.length;
  var current = state.index + 1;
  ctx.fillStyle = hex;
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'right';
  ctx.fillText(current + ' / ' + total, cw - 12, ch - barH + 22);

  // Model name
  ctx.fillStyle = '#666';
  ctx.font = '11px monospace';
  ctx.fillText(mediaItem.model || mediaItem.provider || '', cw - 12, ch - barH + 40);

  // Agent who requested
  if (mediaItem.requestedBy) {
    ctx.fillText('by ' + mediaItem.requestedBy, cw - 12, ch - barH + 54);
  }

  screen.texture.needsUpdate = true;
}

// ==================== TEXTURE GRID RENDERER ====================

function _drawTextureGrid(screen, items, page) {
  if (!screen) return;
  var ctx = screen.context;
  var cw = screen.canvasW, ch = screen.canvasH;

  ctx.fillStyle = '#08080f';
  ctx.fillRect(0, 0, cw, ch);

  var cols = 3, rows = 2;
  var perPage = cols * rows;
  var startIdx = page * perPage;
  var pageItems = items.slice(startIdx, startIdx + perPage);
  var totalPages = Math.ceil(items.length / perPage);

  if (pageItems.length === 0) {
    ctx.fillStyle = '#22c55e44';
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('TEXTURE GALLERY', cw / 2, ch / 2 - 10);
    ctx.font = '16px monospace';
    ctx.fillText('Awaiting content...', cw / 2, ch / 2 + 20);
    screen.texture.needsUpdate = true;
    return;
  }

  var pad = 6;
  var headerH = 30;
  var cellW = (cw - pad) / cols;
  var cellH = (ch - headerH - pad) / rows;

  // Header bar
  ctx.fillStyle = 'rgba(34,197,94,0.12)';
  ctx.fillRect(0, 0, cw, headerH);
  ctx.fillStyle = '#22c55e';
  ctx.font = 'bold 12px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('TEXTURE GALLERY', 10, 19);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#22c55e88';
  ctx.font = '11px monospace';
  ctx.fillText('Page ' + (page + 1) + '/' + totalPages + '  (' + items.length + ' items)', cw - 10, 19);

  // Grid cells
  pageItems.forEach(function(item, i) {
    var col = i % cols;
    var row = Math.floor(i / cols);
    var x = pad / 2 + col * cellW;
    var y = headerH + pad / 2 + row * cellH;
    var innerW = cellW - pad;
    var innerH = cellH - pad;

    // Cell background
    ctx.fillStyle = '#0c0c14';
    ctx.fillRect(x, y, innerW, innerH);

    // Cell border
    ctx.strokeStyle = '#22c55e22';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, innerW, innerH);

    var labelH = 28;

    if (_loadedImages[item.id]) {
      var loadedImg = _loadedImages[item.id];
      var imgAvailH = innerH - labelH;
      var sc = Math.min((innerW - 8) / loadedImg.width, (imgAvailH - 8) / loadedImg.height);
      var dw = loadedImg.width * sc;
      var dh = loadedImg.height * sc;
      var dx = x + (innerW - dw) / 2;
      var dy = y + 4 + (imgAvailH - dh) / 2;
      ctx.drawImage(loadedImg, dx, dy, dw, dh);

      // Label
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(x, y + innerH - labelH, innerW, labelH);
      ctx.fillStyle = '#999';
      ctx.font = '10px monospace';
      ctx.textAlign = 'center';
      var shortPrompt = (item.prompt || '').substring(0, 30);
      if ((item.prompt || '').length > 30) shortPrompt += '...';
      ctx.fillText(shortPrompt, x + innerW / 2, y + innerH - 10);
    } else {
      // Loading placeholder
      ctx.fillStyle = '#22c55e33';
      ctx.font = '12px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Loading...', x + innerW / 2, y + innerH / 2);

      // Start loading
      var tImg = new Image();
      tImg.crossOrigin = 'anonymous';
      (function(id, tImg2, screenRef, allItems, pg) {
        tImg2.onload = function() {
          _loadedImages[id] = tImg2;
          _drawTextureGrid(screenRef, allItems, pg);
        };
      })(item.id, tImg, screen, items, page);
      tImg.src = _mediaUrl(item.id);
    }
  });

  screen.texture.needsUpdate = true;
}

export function getGalleryPosition() {
  return { x: GALLERY_X, z: GALLERY_Z };
}

export function getGalleryDeskPosition() {
  return GALLERY_DESK_POS;
}
