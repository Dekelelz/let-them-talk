import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';

// ============================================================
// HQ BUILDING — premium headquarters where agents work
// Each agent gets a named workstation with executive desk
// Glass walls, marble floors, visible from outside
// ============================================================

var HQ_W = 18;
var HQ_D = 14;
var HQ_FLOORS = 2;
var FLOOR_H = 3.5;
var hqGroup = null;
var agentDesks = {};  // { agentName: { x, y, z } } — world coordinates

// Premium materials
var mats = {};
function initMats() {
  mats.marble = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.15, metalness: 0.05 });
  mats.darkMarble = new THREE.MeshStandardMaterial({ color: 0x2a2a35, roughness: 0.2, metalness: 0.1 });
  mats.glass = new THREE.MeshStandardMaterial({ color: 0x99ccee, transparent: true, opacity: 0.18, roughness: 0.0, metalness: 0.3, side: THREE.DoubleSide, depthWrite: false });
  mats.walnut = new THREE.MeshStandardMaterial({ color: 0x5c3a1e, roughness: 0.5 });
  mats.walnutLight = new THREE.MeshStandardMaterial({ color: 0x8B6840, roughness: 0.45 });
  mats.chrome = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.05, metalness: 0.9 });
  mats.leather = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.6 });
  mats.leatherBrown = new THREE.MeshStandardMaterial({ color: 0x4a2a1a, roughness: 0.55 });
  mats.screen = new THREE.MeshStandardMaterial({ color: 0x112244, emissive: 0x1133aa, emissiveIntensity: 1.0, roughness: 0.05 });
  mats.screenFrame = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.5 });
  mats.gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.25, metalness: 0.7 });
  mats.ceiling = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.8, side: THREE.DoubleSide });
  mats.ceilingLight = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeeeeff, emissiveIntensity: 0.8 });
  mats.plant = new THREE.MeshStandardMaterial({ color: 0x2a7a2a, roughness: 0.8 });
  mats.pot = new THREE.MeshStandardMaterial({ color: 0x6a4a2a, roughness: 0.6 });
  mats.nameplate = new THREE.MeshStandardMaterial({ color: 0xd4af37, roughness: 0.2, metalness: 0.6 });
  mats.wall = new THREE.MeshStandardMaterial({ color: 0xddd8cc, roughness: 0.6, side: THREE.DoubleSide });
  mats.accent = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.4 });
}

// Build one executive workstation
function buildWorkstation(group, x, y, z, agentName, facing) {
  // Executive L-shaped desk
  var deskW = 2.0, deskD = 0.8, deskH = 0.75;
  var top = new THREE.Mesh(new THREE.BoxGeometry(deskW, 0.05, deskD), mats.walnut);
  top.position.set(x, y + deskH, z);
  group.add(top);

  // Side extension (L-shape)
  var sideTop = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 1.2), mats.walnut);
  sideTop.position.set(x + deskW / 2 + 0.35, y + deskH, z + 0.2);
  group.add(sideTop);

  // Desk legs (chrome)
  [[-0.9, -0.35], [0.9, -0.35], [0.9, 0.35], [-0.9, 0.35]].forEach(function(lp) {
    var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, deskH, 6), mats.chrome);
    leg.position.set(x + lp[0], y + deskH / 2, z + lp[1]);
    group.add(leg);
  });

  // Desk panel (front modesty panel — walnut)
  var panel = new THREE.Mesh(new THREE.BoxGeometry(deskW - 0.2, deskH * 0.6, 0.03), mats.walnutLight);
  panel.position.set(x, y + deskH * 0.35, z - deskD / 2 + 0.02);
  group.add(panel);

  // Dual monitors
  [-0.35, 0.35].forEach(function(mx) {
    // Screen frame
    var frame = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.025), mats.screenFrame);
    frame.position.set(x + mx, y + deskH + 0.25, z - 0.15);
    group.add(frame);
    // Screen (emissive)
    var scr = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.33), mats.screen);
    scr.position.set(x + mx, y + deskH + 0.25, z - 0.16);
    scr.rotation.y = Math.PI;
    group.add(scr);
    // Stand
    var stand = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.08), mats.chrome);
    stand.position.set(x + mx, y + deskH + 0.06, z - 0.15);
    group.add(stand);
  });

  // Keyboard
  var kb = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.015, 0.15), mats.darkMarble);
  kb.position.set(x, y + deskH + 0.01, z + 0.1);
  group.add(kb);

  // Executive chair (leather + chrome)
  var chairBase = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 0.05, 8), mats.chrome);
  chairBase.position.set(x, y + 0.15, z + 0.6);
  group.add(chairBase);
  var chairPole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.3, 6), mats.chrome);
  chairPole.position.set(x, y + 0.32, z + 0.6);
  group.add(chairPole);
  var chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.06, 0.45), mats.leatherBrown);
  chairSeat.position.set(x, y + 0.48, z + 0.6);
  group.add(chairSeat);
  var chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.06), mats.leatherBrown);
  chairBack.position.set(x, y + 0.73, z + 0.85);
  group.add(chairBack);
  // Armrests
  [-0.22, 0.22].forEach(function(ax) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.3), mats.chrome);
    arm.position.set(x + ax, y + 0.58, z + 0.7);
    group.add(arm);
  });

  // Gold nameplate on desk
  var plateMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.02), mats.nameplate);
  plateMesh.position.set(x, y + deskH + 0.04, z - deskD / 2 + 0.01);
  group.add(plateMesh);

  // Nameplate text (CSS2D)
  var nameDiv = document.createElement('div');
  nameDiv.textContent = agentName;
  nameDiv.style.cssText = 'color:#d4af37;font-size:8px;font-weight:bold;font-family:serif;letter-spacing:1px;text-shadow:0 0 4px rgba(212,175,55,0.5);';
  var nameLabel = new CSS2DObject(nameDiv);
  nameLabel.position.set(x, y + deskH + 0.15, z - deskD / 2 - 0.05);
  group.add(nameLabel);

  // Coffee mug
  var mug = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 0.08, 8), new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 }));
  mug.position.set(x + 0.7, y + deskH + 0.04, z + 0.2);
  group.add(mug);

  // Store desk position for agent assignment (world coords)
  agentDesks[agentName] = { x: x, y: y, z: z + 0.6 }; // chair position
}

// ============================================================
// BUILD HQ — main headquarters building
// ============================================================

export function buildHQ(cx, cz, agentNames) {
  initMats();
  hqGroup = new THREE.Group();
  hqGroup.position.set(cx, 0, cz);
  agentDesks = {};

  var height = HQ_FLOORS * FLOOR_H;

  // === EXTERIOR SHELL ===
  // Glass curtain walls (all 4 sides)
  var wallThick = 0.12;
  [
    { w: HQ_W, d: wallThick, px: 0, pz: HQ_D / 2 },    // front
    { w: HQ_W, d: wallThick, px: 0, pz: -HQ_D / 2 },   // back
    { w: wallThick, d: HQ_D, px: -HQ_W / 2, pz: 0 },   // left
    { w: wallThick, d: HQ_D, px: HQ_W / 2, pz: 0 },    // right
  ].forEach(function(wp) {
    // Structural frame (dark accent)
    var frame = new THREE.Mesh(new THREE.BoxGeometry(wp.w, height, wp.d), mats.accent);
    frame.position.set(wp.px, height / 2, wp.pz);
    hqGroup.add(frame);
    // Glass panels per floor
    for (var f = 0; f < HQ_FLOORS; f++) {
      var gw = wp.w > wallThick ? wp.w * 0.88 : wp.d * 0.88;
      var gh = FLOOR_H * 0.65;
      var gy = f * FLOOR_H + FLOOR_H * 0.55;
      var glassGeo = new THREE.PlaneGeometry(gw, gh);
      var glass = new THREE.Mesh(glassGeo, mats.glass);
      if (wp.w > wallThick) {
        glass.position.set(wp.px, gy, wp.pz + (wp.pz > 0 ? 0.01 : -0.01));
        if (wp.pz < 0) glass.rotation.y = Math.PI;
      } else {
        glass.position.set(wp.px + (wp.px > 0 ? 0.01 : -0.01), gy, wp.pz);
        glass.rotation.y = wp.px > 0 ? Math.PI / 2 : -Math.PI / 2;
      }
      hqGroup.add(glass);
    }
  });

  // Roof
  var roof = new THREE.Mesh(new THREE.BoxGeometry(HQ_W + 0.5, 0.2, HQ_D + 0.5), mats.accent);
  roof.position.set(0, height + 0.1, 0);
  hqGroup.add(roof);

  // Gold "LET THEM TALK" sign on roof
  var signDiv = document.createElement('div');
  signDiv.textContent = 'LET THEM TALK HQ';
  signDiv.style.cssText = 'color:#ffd700;font-size:12px;font-weight:bold;text-shadow:0 0 10px rgba(255,215,0,0.6);font-family:monospace;letter-spacing:3px;';
  var sign = new CSS2DObject(signDiv);
  sign.position.set(0, height + 1.5, 0);
  hqGroup.add(sign);

  // Entrance door
  var door = new THREE.Mesh(new THREE.BoxGeometry(2.0, 2.8, 0.08), mats.walnut);
  door.position.set(0, 1.4, HQ_D / 2 + 0.05);
  hqGroup.add(door);
  // Door glass
  var doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.2), mats.glass);
  doorGlass.position.set(-0.4, 1.3, HQ_D / 2 + 0.07);
  hqGroup.add(doorGlass);
  var doorGlass2 = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 2.2), mats.glass);
  doorGlass2.position.set(0.4, 1.3, HQ_D / 2 + 0.07);
  hqGroup.add(doorGlass2);

  // Entrance canopy
  var canopy = new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 1.5), mats.accent);
  canopy.position.set(0, 3.0, HQ_D / 2 + 0.7);
  hqGroup.add(canopy);

  // === FLOOR INTERIORS ===
  for (var floor = 0; floor < HQ_FLOORS; floor++) {
    var fy = floor * FLOOR_H;

    // Floor slab (marble)
    var floorMat = floor === 0 ? mats.marble : mats.darkMarble;
    var floorMesh = new THREE.Mesh(new THREE.BoxGeometry(HQ_W - 0.3, 0.08, HQ_D - 0.3), floorMat);
    floorMesh.position.set(0, fy + 0.04, 0);
    hqGroup.add(floorMesh);

    // Ceiling
    var ceil = new THREE.Mesh(new THREE.BoxGeometry(HQ_W - 0.3, 0.06, HQ_D - 0.3), mats.ceiling);
    ceil.position.set(0, fy + FLOOR_H - 0.03, 0);
    hqGroup.add(ceil);

    // Ceiling light strips
    [-3, 0, 3].forEach(function(lx) {
      var light = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.04, HQ_D * 0.7), mats.ceilingLight);
      light.position.set(lx, fy + FLOOR_H - 0.08, 0);
      hqGroup.add(light);
    });

    // Gold accent strip along front wall
    var accentStrip = new THREE.Mesh(new THREE.BoxGeometry(HQ_W * 0.9, 0.05, 0.03), mats.gold);
    accentStrip.position.set(0, fy + 1.0, -HQ_D / 2 + 0.15);
    hqGroup.add(accentStrip);
  }

  // === AGENT WORKSTATIONS ===
  var desksPerFloor = Math.ceil(agentNames.length / HQ_FLOORS);
  var deskSpacing = (HQ_W - 4) / Math.max(desksPerFloor, 1);

  for (var i = 0; i < agentNames.length; i++) {
    var floorIdx = Math.floor(i / desksPerFloor);
    var deskOnFloor = i % desksPerFloor;
    var fy2 = floorIdx * FLOOR_H;
    var dx = -HQ_W / 2 + 2.5 + deskOnFloor * deskSpacing;
    var dz = -1.5; // facing back wall (screens away from windows)

    buildWorkstation(hqGroup, dx, fy2, dz, agentNames[i], 0);
  }

  // === DECORATIONS ===
  // Potted plants at corners
  [[HQ_W/2 - 1, 0, HQ_D/2 - 1], [-HQ_W/2 + 1, 0, HQ_D/2 - 1], [HQ_W/2 - 1, 0, -HQ_D/2 + 1], [-HQ_W/2 + 1, 0, -HQ_D/2 + 1]].forEach(function(p) {
    var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.3, 8), mats.pot);
    pot.position.set(p[0], p[1] + 0.15, p[2]);
    hqGroup.add(pot);
    var plant = new THREE.Mesh(new THREE.SphereGeometry(0.4, 8, 6), mats.plant);
    plant.position.set(p[0], p[1] + 0.55, p[2]);
    hqGroup.add(plant);
  });

  // Reception desk (ground floor, near entrance)
  var recDesk = new THREE.Mesh(new THREE.BoxGeometry(3, 1.0, 0.6), mats.walnut);
  recDesk.position.set(0, 0.5, HQ_D / 2 - 2);
  hqGroup.add(recDesk);
  var recTop = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.04, 0.7), mats.marble);
  recTop.position.set(0, 1.02, HQ_D / 2 - 2);
  hqGroup.add(recTop);

  // Water cooler
  var cooler = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 8), new THREE.MeshStandardMaterial({ color: 0x88bbcc, roughness: 0.2 }));
  cooler.position.set(HQ_W / 2 - 1.5, 0.45, 0);
  hqGroup.add(cooler);

  S.furnitureGroup.add(hqGroup);

  return {
    group: hqGroup,
    desks: agentDesks,
    position: { x: cx, z: cz },
    width: HQ_W,
    depth: HQ_D,
    height: height,
  };
}

export function getAgentDeskPosition(agentName) {
  var desk = agentDesks[agentName];
  if (!desk) return null;
  // Convert local to world (group is at cx, cz)
  if (hqGroup) {
    return {
      x: hqGroup.position.x + desk.x,
      y: desk.y,
      z: hqGroup.position.z + desk.z,
    };
  }
  return desk;
}

export function getAllDeskPositions() { return agentDesks; }
