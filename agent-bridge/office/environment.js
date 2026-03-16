import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';
import { FLOOR_W, FLOOR_D, DESK_POSITIONS, RECEPTION_POS, ENVS, DRESSING_ROOM_POS, REST_AREA_POS } from './constants.js';

export function buildEnvironment() {
  if (S.furnitureGroup) {
    var css2dElements = [];
    S.furnitureGroup.traverse(function(child) {
      if (child.isCSS2DObject) css2dElements.push(child);
    });
    S.scene.remove(S.furnitureGroup);
    if (S.cssRenderer) S.cssRenderer.render(S.scene, S.camera);
    css2dElements.forEach(function(obj) {
      if (obj.element && obj.element.parentElement) obj.element.remove();
    });
    S.furnitureGroup.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(function(m) { m.dispose(); });
        else {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      }
    });
  }
  S.furnitureGroup = new THREE.Group();
  S.deskMeshes = [];
  var env = ENVS[S.currentEnv] || ENVS.modern;

  buildFloor(env);
  buildWalls(env);
  buildReception(env);
  DESK_POSITIONS.forEach(function(pos, i) { buildDesk(pos.x, pos.z, i, env); });
  buildDecorations(env);
  buildDressingRoom(env);
  buildRestArea(env);
  buildWingDivider(env);

  S.scene.add(S.furnitureGroup);
}

function buildFloor(env) {
  var size = 512;
  var canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  var ctx = canvas.getContext('2d');
  var tiles = 16;
  var ts = size / tiles;
  var c1 = '#' + env.floor1.toString(16).padStart(6, '0');
  var c2 = '#' + env.floor2.toString(16).padStart(6, '0');
  for (var i = 0; i < tiles; i++) {
    for (var j = 0; j < tiles; j++) {
      ctx.fillStyle = (i + j) % 2 === 0 ? c1 : c2;
      ctx.fillRect(i * ts, j * ts, ts, ts);
    }
  }
  var tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  var geo = new THREE.PlaneGeometry(FLOOR_W, FLOOR_D);
  var mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 });
  var floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  S.furnitureGroup.add(floor);
}

function buildWalls(env) {
  var wallMat = new THREE.MeshStandardMaterial({ color: env.wall, roughness: 0.9, side: THREE.DoubleSide });

  var backWall = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_W, 5), wallMat);
  backWall.position.set(0, 2.5, -FLOOR_D / 2);
  backWall.receiveShadow = true;
  S.furnitureGroup.add(backWall);

  var leftWall = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_D, 5), wallMat);
  leftWall.position.set(-FLOOR_W / 2, 2.5, 0);
  leftWall.rotation.y = Math.PI / 2;
  leftWall.receiveShadow = true;
  S.furnitureGroup.add(leftWall);

  var rightWall = new THREE.Mesh(new THREE.PlaneGeometry(FLOOR_D, 5), wallMat);
  rightWall.position.set(FLOOR_W / 2, 2.5, 0);
  rightWall.rotation.y = -Math.PI / 2;
  rightWall.receiveShadow = true;
  S.furnitureGroup.add(rightWall);

  var windowMat = new THREE.MeshStandardMaterial({
    color: 0x87CEEB, emissive: 0x87CEEB, emissiveIntensity: 0.3, roughness: 0.1
  });
  [-2, -1, 1, 2].forEach(function(i) {
    var win = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2), windowMat);
    win.position.set(i * 3.5, 3, -FLOOR_D / 2 + 0.01);
    S.furnitureGroup.add(win);
  });
  [-1, 0, 1].forEach(function(i) {
    var win = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.8), windowMat);
    win.position.set(-FLOOR_W / 2 + 0.01, 3, i * 3.5);
    win.rotation.y = Math.PI / 2;
    S.furnitureGroup.add(win);
  });
}

function buildReception(env) {
  var rx = RECEPTION_POS.x, rz = RECEPTION_POS.z;
  var deskGeo = new THREE.BoxGeometry(3, 1, 1.2);
  var deskMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.6 });
  var desk = new THREE.Mesh(deskGeo, deskMat);
  desk.position.set(rx, 0.5, rz);
  desk.castShadow = true; desk.receiveShadow = true;
  S.furnitureGroup.add(desk);

  var topGeo = new THREE.BoxGeometry(3.2, 0.08, 1.4);
  var topMat = new THREE.MeshStandardMaterial({ color: 0x7a5a3e, roughness: 0.4 });
  var top = new THREE.Mesh(topGeo, topMat);
  top.position.set(rx, 1.04, rz); top.castShadow = true;
  S.furnitureGroup.add(top);

  var bellGeo = new THREE.SphereGeometry(0.08, 16, 12);
  var bellMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.2 });
  var bell = new THREE.Mesh(bellGeo, bellMat);
  bell.position.set(rx + 0.8, 1.12, rz);
  S.furnitureGroup.add(bell);

  var signDiv = document.createElement('div');
  signDiv.textContent = 'RECEPTION';
  signDiv.style.cssText = 'color:#d4af37;font-size:11px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:1px;';
  var signLabel = new CSS2DObject(signDiv);
  signLabel.position.set(rx, 1.5, rz);
  S.furnitureGroup.add(signLabel);
}

function buildDesk(x, z, index, env) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);

  var topGeo = new THREE.BoxGeometry(1.8, 0.08, 0.9);
  var topMat = new THREE.MeshStandardMaterial({ color: env.desk, roughness: 0.5 });
  var top = new THREE.Mesh(topGeo, topMat);
  top.position.y = 0.75; top.castShadow = true; top.receiveShadow = true;
  group.add(top);

  var legGeo = new THREE.BoxGeometry(0.06, 0.75, 0.06);
  var legMat = new THREE.MeshStandardMaterial({ color: env.deskLegs, roughness: 0.7 });
  [[-0.8, -0.35], [-0.8, 0.35], [0.8, -0.35], [0.8, 0.35]].forEach(function(pos) {
    var leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(pos[0], 0.375, pos[1]); leg.castShadow = true;
    group.add(leg);
  });

  var monGeo = new THREE.BoxGeometry(0.5, 0.35, 0.04);
  var monMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3 });
  var monitor = new THREE.Mesh(monGeo, monMat);
  monitor.position.set(0, 1.1, -0.2); monitor.castShadow = true;
  group.add(monitor);

  var screenGeo = new THREE.PlaneGeometry(0.44, 0.28);
  var screenMat = new THREE.MeshStandardMaterial({
    color: 0x333333, emissive: 0x333333, emissiveIntensity: 0.1, roughness: 0.2
  });
  var screen = new THREE.Mesh(screenGeo, screenMat);
  screen.position.set(0, 1.1, -0.179);
  group.add(screen);

  var standGeo = new THREE.BoxGeometry(0.06, 0.2, 0.06);
  var stand = new THREE.Mesh(standGeo, legMat);
  stand.position.set(0, 0.88, -0.2);
  group.add(stand);

  // Chair
  var chairGroup = new THREE.Group();
  chairGroup.position.set(0, 0, 0.7);
  var seatGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.06, 16);
  var seatMat = new THREE.MeshStandardMaterial({ color: env.chairSeat, roughness: 0.7 });
  var seat = new THREE.Mesh(seatGeo, seatMat);
  seat.position.y = 0.45; seat.castShadow = true;
  chairGroup.add(seat);
  var postGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.45, 8);
  var post = new THREE.Mesh(postGeo, legMat);
  post.position.y = 0.225;
  chairGroup.add(post);
  var backGeo = new THREE.BoxGeometry(0.45, 0.35, 0.04);
  var backMat = new THREE.MeshStandardMaterial({ color: env.chair, roughness: 0.6 });
  var back = new THREE.Mesh(backGeo, backMat);
  back.position.set(0, 0.7, 0.2); back.castShadow = true;
  chairGroup.add(back);
  group.add(chairGroup);

  S.furnitureGroup.add(group);
  S.deskMeshes.push({ group: group, screen: screen, screenMat: screenMat, index: index, x: x, z: z });
}

function buildDecorations(env) {
  var isStartup = S.currentEnv === 'startup';
  buildPlant(-9, -6.5);
  buildPlant(9, -6.5);
  buildPlant(-9, -2);
  buildPlant(9, -2);
  buildWhiteboard(-9.5, 1);
  buildBookshelf(-9.5, -4.5);
  buildFloorLamp(-8.5, 4.5);
  buildFloorLamp(6, 5);
  buildAreaRug(0, -1);
  if (isStartup) {
    buildPizzaBox(9, 1);
    buildBeanbag(9, -6);
    buildBeanbag(-9, 3);
    buildArcadeMachine(-8.5, -6);
    buildTV(0, -7.5);
  } else {
    buildCoffeeMachine(9, 1);
    buildWatercooler(9, -4);
    buildTV(0, -7.5);
    buildBookshelf(-9.5, 3);
  }
}

function buildPlant(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var potGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.4, 12);
  var potMat = new THREE.MeshStandardMaterial({ color: 0x8B4513, roughness: 0.8 });
  var pot = new THREE.Mesh(potGeo, potMat);
  pot.position.y = 0.2; pot.castShadow = true;
  group.add(pot);
  var leafColors = [0x2d8a4e, 0x34a853, 0x28a745];
  for (var i = 0; i < 5; i++) {
    var angle = (i / 5) * Math.PI * 2;
    var leafGeo = new THREE.SphereGeometry(0.15, 8, 6);
    var leafMat = new THREE.MeshStandardMaterial({ color: leafColors[i % 3], roughness: 0.8 });
    var leaf = new THREE.Mesh(leafGeo, leafMat);
    leaf.position.set(Math.cos(angle) * 0.15, 0.55, Math.sin(angle) * 0.15);
    leaf.scale.set(1, 0.7, 1); leaf.castShadow = true;
    group.add(leaf);
  }
  var topLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0x34a853, roughness: 0.8 }));
  topLeaf.position.y = 0.7; topLeaf.castShadow = true;
  group.add(topLeaf);
  S.furnitureGroup.add(group);
}

function buildWhiteboard(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var boardGeo = new THREE.BoxGeometry(0.08, 1.5, 2);
  var boardMat = new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.3 });
  var board = new THREE.Mesh(boardGeo, boardMat);
  board.position.y = 1.8; board.castShadow = true;
  group.add(board);
  var frameMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  [2.55, 1.05].forEach(function(y) {
    var frame = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 2.1), frameMat);
    frame.position.y = y; group.add(frame);
  });
  var legGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 8);
  var legMat2 = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5 });
  [-0.8, 0.8].forEach(function(lz) {
    var leg = new THREE.Mesh(legGeo, legMat2);
    leg.position.set(0, 0.5, lz); group.add(leg);
  });
  S.furnitureGroup.add(group);
}

function buildCoffeeMachine(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var bodyGeo = new THREE.BoxGeometry(0.5, 0.8, 0.4);
  var bodyMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5 });
  var body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.8; body.castShadow = true;
  group.add(body);
  var tableGeo = new THREE.BoxGeometry(0.7, 0.04, 0.5);
  var tableMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.6 });
  var table = new THREE.Mesh(tableGeo, tableMat);
  table.position.y = 0.4; table.castShadow = true;
  group.add(table);
  var cupGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.08, 12);
  var cupMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
  var cup = new THREE.Mesh(cupGeo, cupMat);
  cup.position.set(0.2, 0.46, 0);
  group.add(cup);
  S.furnitureGroup.add(group);
}

function buildPizzaBox(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var tableGeo = new THREE.BoxGeometry(0.7, 0.04, 0.5);
  var tableMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.6 });
  var table = new THREE.Mesh(tableGeo, tableMat);
  table.position.y = 0.4; table.castShadow = true;
  group.add(table);
  var boxGeo = new THREE.BoxGeometry(0.5, 0.06, 0.5);
  var boxMat = new THREE.MeshStandardMaterial({ color: 0xd4a24e, roughness: 0.8 });
  var box = new THREE.Mesh(boxGeo, boxMat);
  box.position.y = 0.46; box.castShadow = true;
  group.add(box);
  var lidGeo = new THREE.BoxGeometry(0.5, 0.03, 0.5);
  var lidMat = new THREE.MeshStandardMaterial({ color: 0xe8c06a, roughness: 0.8 });
  var lid = new THREE.Mesh(lidGeo, lidMat);
  lid.position.set(0, 0.5, -0.22); lid.rotation.x = -0.6;
  group.add(lid);
  S.furnitureGroup.add(group);
}

function buildBeanbag(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var botGeo = new THREE.SphereGeometry(0.4, 16, 12);
  var botMat = new THREE.MeshStandardMaterial({ color: 0xe53e3e, roughness: 0.9 });
  var bottom = new THREE.Mesh(botGeo, botMat);
  bottom.position.y = 0.2; bottom.scale.set(1, 0.5, 1); bottom.castShadow = true;
  group.add(bottom);
  var topGeo = new THREE.SphereGeometry(0.35, 16, 12);
  var topMat = new THREE.MeshStandardMaterial({ color: 0xc53030, roughness: 0.9 });
  var topPart = new THREE.Mesh(topGeo, topMat);
  topPart.position.set(-0.05, 0.4, 0); topPart.scale.set(1, 0.6, 1); topPart.castShadow = true;
  group.add(topPart);
  S.furnitureGroup.add(group);
}

function buildWatercooler(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var baseGeo = new THREE.BoxGeometry(0.3, 0.6, 0.3);
  var baseMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
  var base = new THREE.Mesh(baseGeo, baseMat);
  base.position.y = 0.3; base.castShadow = true;
  group.add(base);
  var bottleGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 16);
  var bottleMat = new THREE.MeshStandardMaterial({ color: 0x64b4ff, transparent: true, opacity: 0.5, roughness: 0.1 });
  var bottle = new THREE.Mesh(bottleGeo, bottleMat);
  bottle.position.y = 0.8;
  group.add(bottle);
  S.furnitureGroup.add(group);
}

// ===================== BOOKSHELF =====================
function buildBookshelf(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var frameMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.7 });
  // Main frame
  var back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 1.2), frameMat);
  back.position.y = 1.1; back.castShadow = true;
  group.add(back);
  // Shelves (4 levels)
  [0.05, 0.55, 1.1, 1.65, 2.15].forEach(function(sy) {
    var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 1.2), frameMat);
    shelf.position.set(0.13, sy, 0); shelf.castShadow = true; shelf.receiveShadow = true;
    group.add(shelf);
  });
  // Side panels
  [-0.58, 0.58].forEach(function(sz) {
    var side = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.04), frameMat);
    side.position.set(0.13, 1.1, sz); side.castShadow = true;
    group.add(side);
  });
  // Books (colored blocks on shelves)
  var bookColors = [0xc0392b, 0x2980b9, 0x27ae60, 0x8e44ad, 0xe67e22, 0x2c3e50, 0xd4a24e, 0x1abc9c];
  var shelfYs = [0.09, 0.59, 1.14, 1.69];
  shelfYs.forEach(function(sy, si) {
    var numBooks = 4 + Math.floor(Math.random() * 4);
    var startZ = -0.45;
    for (var bi = 0; bi < numBooks; bi++) {
      var bh = 0.3 + Math.random() * 0.15;
      var bw = 0.04 + Math.random() * 0.03;
      var bookMat = new THREE.MeshStandardMaterial({ color: bookColors[(si * 5 + bi) % bookColors.length], roughness: 0.8 });
      var book = new THREE.Mesh(new THREE.BoxGeometry(0.2, bh, bw), bookMat);
      book.position.set(0.18, sy + bh / 2, startZ);
      book.castShadow = true;
      group.add(book);
      startZ += bw + 0.02;
    }
  });
  S.furnitureGroup.add(group);
}

// ===================== TV / MONITOR =====================
function buildTV(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  // Wall mount bracket
  var bracketMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.3 });
  var bracket = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.3, 0.06), bracketMat);
  bracket.position.y = 2.2;
  group.add(bracket);
  // TV body — wide on X, thin on Z (mounted on back wall, facing +Z into room)
  var tvMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.3 });
  var tvBody = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1, 0.08), tvMat);
  tvBody.position.y = 2.2; tvBody.castShadow = true;
  group.add(tvBody);
  // Animated screen canvas
  var W = 320, H = 200;
  var cvs = document.createElement('canvas');
  cvs.width = W; cvs.height = H;
  var tex = new THREE.CanvasTexture(cvs);
  tex.minFilter = THREE.LinearFilter;
  var screenMat = new THREE.MeshStandardMaterial({
    map: tex, emissive: 0x58a6ff, emissiveIntensity: 0.25, roughness: 0.1
  });
  var screen = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), screenMat);
  screen.position.set(0, 2.2, 0.045);
  group.add(screen);
  // Store for animation updates
  S._tvScreen = { canvas: cvs, texture: tex, tickerOffset: 0 };
  S.furnitureGroup.add(group);
}

// Called every ~1s from the sync interval to update the TV screen
export function updateTVScreen(time) {
  var tv = S._tvScreen;
  if (!tv) return;
  var cvs = tv.canvas, ctx = cvs.getContext('2d');
  var W = cvs.width, H = cvs.height;

  // Background gradient
  ctx.fillStyle = '#0a0e1a';
  ctx.fillRect(0, 0, W, H);

  // Top bar
  ctx.fillStyle = '#111830';
  ctx.fillRect(0, 0, W, 24);
  ctx.fillStyle = '#58a6ff';
  ctx.font = 'bold 11px monospace';
  ctx.fillText('OFFICE DASHBOARD', 8, 16);
  // Clock
  var now = new Date();
  var timeStr = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0') + ':' + now.getSeconds().toString().padStart(2, '0');
  ctx.fillStyle = '#7ee787';
  ctx.textAlign = 'right';
  ctx.fillText(timeStr, W - 8, 16);
  ctx.textAlign = 'left';

  // Agent count + message stats
  var agents = window.cachedAgents || {};
  var history = window.cachedHistory || [];
  var agentNames = Object.keys(agents);
  var activeCount = 0, sleepCount = 0;
  agentNames.forEach(function(n) {
    var st = agents[n].status || 'dead';
    if (st === 'active') activeCount++;
    else if (st === 'sleeping') sleepCount++;
  });

  ctx.font = '10px monospace';
  var y = 42;

  // Stats section
  ctx.fillStyle = '#546178';
  ctx.fillText('AGENTS', 8, y);
  ctx.fillStyle = '#d2a8ff';
  ctx.fillText(String(agentNames.length), 70, y);
  ctx.fillStyle = '#4ade80';
  ctx.fillText(activeCount + ' active', 90, y);
  ctx.fillStyle = '#facc15';
  ctx.fillText(sleepCount + ' idle', 160, y);
  y += 18;

  ctx.fillStyle = '#546178';
  ctx.fillText('MESSAGES', 8, y);
  ctx.fillStyle = '#79c0ff';
  ctx.fillText(String(history.length), 80, y);
  y += 18;

  // Separator line
  ctx.strokeStyle = '#1a2744';
  ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(W - 8, y); ctx.stroke();
  y += 14;

  // Recent activity feed (last 5 messages)
  ctx.fillStyle = '#546178';
  ctx.font = '9px monospace';
  ctx.fillText('RECENT ACTIVITY', 8, y);
  y += 14;

  var recentMsgs = history.slice(-5);
  for (var i = 0; i < recentMsgs.length; i++) {
    var msg = recentMsgs[i];
    var from = msg.from || '?';
    var to = msg.to || 'all';
    var snippet = (msg.content || msg.message || '').substring(0, 30);
    if ((msg.content || msg.message || '').length > 30) snippet += '..';
    ctx.fillStyle = '#7ee787';
    ctx.fillText(from, 8, y);
    ctx.fillStyle = '#546178';
    ctx.fillText(' > ', 8 + from.length * 5.5, y);
    ctx.fillStyle = '#d2a8ff';
    ctx.fillText(to, 8 + from.length * 5.5 + 18, y);
    y += 12;
    ctx.fillStyle = '#8892b0';
    ctx.fillText('  ' + snippet, 8, y);
    y += 14;
    if (y > H - 30) break;
  }
  if (recentMsgs.length === 0) {
    ctx.fillStyle = '#3d4663';
    ctx.fillText('  Waiting for messages...', 8, y);
  }

  // Bottom ticker bar
  ctx.fillStyle = '#111830';
  ctx.fillRect(0, H - 20, W, 20);
  // Scrolling ticker
  var tickerParts = [];
  agentNames.forEach(function(n) {
    var info = agents[n];
    var st = info.status === 'active' ? '\u25CF' : '\u25CB';
    tickerParts.push(st + ' ' + (info.display_name || n));
  });
  var tickerText = tickerParts.length > 0 ? tickerParts.join('    \u2022    ') + '    \u2022    ' : 'No agents online';
  tv.tickerOffset = (tv.tickerOffset + 1) % (tickerText.length * 6);
  ctx.fillStyle = '#58a6ff';
  ctx.font = '10px monospace';
  // Draw twice for seamless loop
  var fullW = tickerText.length * 6;
  ctx.fillText(tickerText, -tv.tickerOffset, H - 6);
  ctx.fillText(tickerText, -tv.tickerOffset + fullW, H - 6);

  // Scanline overlay
  ctx.fillStyle = 'rgba(0,0,0,0.04)';
  for (var sl = 0; sl < H; sl += 2) {
    ctx.fillRect(0, sl, W, 1);
  }

  tv.texture.needsUpdate = true;
}

// ===================== ARCADE MACHINE =====================
function buildArcadeMachine(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  var cabinetMat = new THREE.MeshStandardMaterial({ color: 0x2c1654, roughness: 0.7 });
  // Main cabinet body
  var cabinet = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.7), cabinetMat);
  cabinet.position.y = 0.9; cabinet.castShadow = true;
  group.add(cabinet);
  // Top section (angled screen housing)
  var topMat = new THREE.MeshStandardMaterial({ color: 0x3a1f6e, roughness: 0.6 });
  var top = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.5, 0.6), topMat);
  top.position.set(0, 2.05, -0.05); top.castShadow = true;
  group.add(top);
  // Screen
  var scrMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0x00ff88, emissiveIntensity: 0.5, roughness: 0.1 });
  var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.35, 0.35), scrMat);
  scr.position.set(0.31, 2.0, -0.05);
  scr.rotation.y = Math.PI / 2;
  group.add(scr);
  // Control panel
  var panelMat = new THREE.MeshStandardMaterial({ color: 0x1a1a2e, roughness: 0.5 });
  var panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.1, 0.4), panelMat);
  panel.position.set(0, 1.5, 0.2); panel.rotation.x = -0.3;
  group.add(panel);
  // Joystick
  var joyMat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.4 });
  var joyBase = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 8), panelMat);
  joyBase.position.set(0.1, 1.56, 0.15);
  group.add(joyBase);
  var joyStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 6), joyMat);
  joyStick.position.set(0.1, 1.6, 0.15);
  group.add(joyStick);
  var joyBall = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), joyMat);
  joyBall.position.set(0.1, 1.65, 0.15);
  group.add(joyBall);
  // Buttons
  var btnColors = [0xff4444, 0x44ff44, 0x4444ff];
  btnColors.forEach(function(col, bi) {
    var btn = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.015, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.3 }));
    btn.position.set(-0.05 - bi * 0.06, 1.56, 0.15);
    group.add(btn);
  });
  // Marquee sign
  var marqueeDiv = document.createElement('div');
  marqueeDiv.textContent = 'ARCADE';
  marqueeDiv.style.cssText = 'color:#ff00ff;font-size:8px;font-weight:bold;font-family:monospace;letter-spacing:2px;text-shadow:0 0 4px #ff00ff;';
  var marquee = new CSS2DObject(marqueeDiv);
  marquee.position.set(0, 2.45, 0);
  group.add(marquee);
  S.furnitureGroup.add(group);
}

// ===================== FLOOR LAMP =====================
function buildFloorLamp(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0, z);
  // Base
  var baseMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.5, metalness: 0.3 });
  var base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 12), baseMat);
  base.position.y = 0.02; base.castShadow = true;
  group.add(base);
  // Pole
  var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), baseMat);
  pole.position.y = 0.84;
  group.add(pole);
  // Shade (cone)
  var shadeMat = new THREE.MeshStandardMaterial({ color: 0xddd5c0, roughness: 0.8, side: THREE.DoubleSide });
  var shade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.25, 12, 1, true), shadeMat);
  shade.position.y = 1.72; shade.castShadow = true;
  group.add(shade);
  // Light inside
  var light = new THREE.PointLight(0xffeedd, 0.3, 4);
  light.position.set(0, 1.6, 0);
  group.add(light);
  S.furnitureGroup.add(group);
}

// ===================== AREA RUG =====================
function buildAreaRug(x, z) {
  var group = new THREE.Group();
  group.position.set(x, 0.005, z);
  var isStartup = S.currentEnv === 'startup';
  var rugColor = isStartup ? 0x3d2b1f : 0x232a35;
  var borderColor = isStartup ? 0x4a3525 : 0x2a3340;
  // Main rug
  var rugMat = new THREE.MeshStandardMaterial({ color: rugColor, roughness: 0.95 });
  var rug = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), rugMat);
  rug.rotation.x = -Math.PI / 2; rug.receiveShadow = true;
  group.add(rug);
  // Subtle border stripe (slightly lighter than rug, not bright)
  var borderMat = new THREE.MeshStandardMaterial({ color: borderColor, roughness: 0.9 });
  // Top/bottom borders
  [-1.9, 1.9].forEach(function(bz) {
    var stripe = new THREE.Mesh(new THREE.PlaneGeometry(5.8, 0.08), borderMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(0, 0.001, bz);
    group.add(stripe);
  });
  // Left/right borders
  [-2.9, 2.9].forEach(function(bx) {
    var stripe = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 3.8), borderMat);
    stripe.rotation.x = -Math.PI / 2;
    stripe.position.set(bx, 0.001, 0);
    group.add(stripe);
  });
  S.furnitureGroup.add(group);
}

// ===================== WING DIVIDER =====================
function buildWingDivider(env) {
  var wallMat = new THREE.MeshStandardMaterial({ color: (ENVS[S.currentEnv] || ENVS.modern).wall, roughness: 0.9, side: THREE.DoubleSide });
  // Partial wall separating main office from right wing (gap in middle for walking through)
  // Upper section (z: -8 to -3.5)
  var upper = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 5), wallMat);
  upper.position.set(7, 2.5, -5.75);
  upper.rotation.y = Math.PI / 2;
  upper.receiveShadow = true;
  S.furnitureGroup.add(upper);
  // Lower section (z: 0.5 to 4)
  var lower = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 5), wallMat);
  lower.position.set(7, 2.5, 2.25);
  lower.rotation.y = Math.PI / 2;
  lower.receiveShadow = true;
  S.furnitureGroup.add(lower);
  // Archway header (connecting the two sections above the gap)
  var header = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.5, 4), wallMat);
  header.position.set(7, 4.25, -1.5);
  S.furnitureGroup.add(header);
  // "LOUNGE" sign above archway
  var signDiv = document.createElement('div');
  signDiv.textContent = 'LOUNGE';
  signDiv.style.cssText = 'color:#6c8aff;font-size:10px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:2px;opacity:0.7;';
  var signLabel = new CSS2DObject(signDiv);
  signLabel.position.set(7, 4.2, -1.5);
  S.furnitureGroup.add(signLabel);
}

// ===================== DRESSING ROOM =====================
function buildDressingRoom(env) {
  var rx = DRESSING_ROOM_POS.x, rz = DRESSING_ROOM_POS.z;
  var group = new THREE.Group();
  group.position.set(rx, 0, rz);

  // Floor platform (raised circular disc)
  var platformGeo = new THREE.CylinderGeometry(0.6, 0.65, 0.06, 24);
  var platformMat = new THREE.MeshStandardMaterial({ color: 0x4a4a5a, roughness: 0.4, metalness: 0.2 });
  var platform = new THREE.Mesh(platformGeo, platformMat);
  platform.position.y = 0.03; platform.receiveShadow = true; platform.castShadow = true;
  group.add(platform);
  // Platform rim (subtle glow ring)
  var rimGeo = new THREE.TorusGeometry(0.62, 0.02, 8, 32);
  var rimMat = new THREE.MeshStandardMaterial({ color: 0x6c8aff, emissive: 0x6c8aff, emissiveIntensity: 0.4, roughness: 0.3 });
  var rim = new THREE.Mesh(rimGeo, rimMat);
  rim.rotation.x = -Math.PI / 2; rim.position.y = 0.07;
  group.add(rim);

  // Mirror on the right wall (tall reflective rectangle)
  var mirrorGeo = new THREE.PlaneGeometry(1.2, 2);
  var mirrorMat = new THREE.MeshStandardMaterial({ color: 0xd0d8e8, emissive: 0x8899bb, emissiveIntensity: 0.15, roughness: 0.05, metalness: 0.8 });
  var mirror = new THREE.Mesh(mirrorGeo, mirrorMat);
  mirror.position.set(1.5, 1.2, 0); mirror.rotation.y = -Math.PI / 2;
  group.add(mirror);
  // Mirror frame
  var frameMat = new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.4, metalness: 0.3 });
  var frameTop = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.3), frameMat);
  frameTop.position.set(1.52, 2.22, 0); group.add(frameTop);
  var frameBot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 1.3), frameMat);
  frameBot.position.set(1.52, 0.18, 0); group.add(frameBot);
  var frameL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.06), frameMat);
  frameL.position.set(1.52, 1.2, -0.65); group.add(frameL);
  var frameR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, 0.06), frameMat);
  frameR.position.set(1.52, 1.2, 0.65); group.add(frameR);

  // Left partition wall (half-height privacy screen)
  var partMat = new THREE.MeshStandardMaterial({ color: 0x3a4050, roughness: 0.8, side: THREE.DoubleSide });
  var partL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.2, 2.5), partMat);
  partL.position.set(-1.3, 1.1, 0);
  partL.castShadow = true;
  group.add(partL);
  // Back partition
  var partB = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.2, 0.06), partMat);
  partB.position.set(0.1, 1.1, -1.3);
  partB.castShadow = true;
  group.add(partB);

  // Coat hooks on back partition
  var hookMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.5 });
  [-0.4, 0.2, 0.8].forEach(function(hx) {
    var hook = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 8), hookMat);
    hook.position.set(hx, 1.6, -1.25); hook.rotation.x = Math.PI / 3;
    group.add(hook);
  });

  // Warm spotlight
  var spotLight = new THREE.PointLight(0xffeedd, 0.6, 5);
  spotLight.position.set(0, 3, 0);
  group.add(spotLight);

  // Sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'DRESSING ROOM';
  signDiv.style.cssText = 'color:#d4af37;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:1.5px;';
  var signLabel = new CSS2DObject(signDiv);
  signLabel.position.set(0, 2.6, 0);
  group.add(signLabel);

  S.furnitureGroup.add(group);
}

// ===================== REST AREA =====================
function buildRestArea(env) {
  var rx = REST_AREA_POS.x, rz = REST_AREA_POS.z;
  var group = new THREE.Group();
  group.position.set(rx, 0, rz);

  // Soft rug (circular, textured)
  var rugGeo = new THREE.CircleGeometry(1.8, 24);
  var rugMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.95 });
  var rug = new THREE.Mesh(rugGeo, rugMat);
  rug.rotation.x = -Math.PI / 2; rug.position.y = 0.01; rug.receiveShadow = true;
  group.add(rug);

  // Beanbags (3, arranged in a cozy cluster)
  var bbColors = [0xe53e3e, 0x3b82f6, 0x22c55e];
  var bbPositions = [{ x: -0.6, z: 0.3 }, { x: 0.6, z: 0.4 }, { x: 0, z: -0.5 }];
  bbPositions.forEach(function(pos, i) {
    var bbGroup = new THREE.Group();
    bbGroup.position.set(pos.x, 0, pos.z);
    var botGeo = new THREE.SphereGeometry(0.4, 16, 12);
    var botMat = new THREE.MeshStandardMaterial({ color: bbColors[i], roughness: 0.9 });
    var bottom = new THREE.Mesh(botGeo, botMat);
    bottom.position.y = 0.2; bottom.scale.set(1, 0.5, 1); bottom.castShadow = true;
    bbGroup.add(bottom);
    var topGeo = new THREE.SphereGeometry(0.35, 16, 12);
    var topMat = new THREE.MeshStandardMaterial({ color: bbColors[i], roughness: 0.9 });
    topMat.color.multiplyScalar(0.8);
    var topPart = new THREE.Mesh(topGeo, topMat);
    topPart.position.set(-0.05, 0.4, 0); topPart.scale.set(1, 0.6, 1); topPart.castShadow = true;
    bbGroup.add(topPart);
    bbGroup.rotation.y = (i / 3) * Math.PI * 2;
    group.add(bbGroup);
  });

  // Small side table
  var tableGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.04, 16);
  var tableMat = new THREE.MeshStandardMaterial({ color: 0x5a3e28, roughness: 0.6 });
  var table = new THREE.Mesh(tableGeo, tableMat);
  table.position.set(1.2, 0.35, 0); table.castShadow = true;
  group.add(table);
  var tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.35, 8), tableMat);
  tableLeg.position.set(1.2, 0.175, 0);
  group.add(tableLeg);

  // Coffee mug on table
  var mugGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.07, 12);
  var mugMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.3 });
  var mug = new THREE.Mesh(mugGeo, mugMat);
  mug.position.set(1.2, 0.405, 0);
  group.add(mug);

  // Warm dim point light (cozy orange glow)
  var warmLight = new THREE.PointLight(0xffaa55, 0.4, 6);
  warmLight.position.set(0, 2.5, 0);
  group.add(warmLight);

  // Sign
  var signDiv = document.createElement('div');
  signDiv.textContent = 'REST AREA';
  signDiv.style.cssText = 'color:#facc15;font-size:9px;font-weight:bold;font-family:Inter,sans-serif;letter-spacing:1.5px;';
  var signLabel = new CSS2DObject(signDiv);
  signLabel.position.set(0, 2.2, 0);
  group.add(signLabel);

  S.furnitureGroup.add(group);
}
