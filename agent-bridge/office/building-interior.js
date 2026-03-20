import * as THREE from 'three';
import { S } from './state.js';

// ============================================================
// BUILDING INTERIORS — enterable buildings with floors, desks
// Agents sit at desks INSIDE buildings, visible through windows
// ============================================================

var FLOOR_HEIGHT = 3.0;
var WALL_THICKNESS = 0.15;

// Shared materials (created once)
var intMats = null;

function getIntMats() {
  if (intMats) return intMats;
  intMats = {
    floor: new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.6, side: THREE.DoubleSide }),
    carpet: new THREE.MeshStandardMaterial({ color: 0x3a3d4a, roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 0.7, side: THREE.DoubleSide }),
    wallAccent: new THREE.MeshStandardMaterial({ color: 0x6a7a8a, roughness: 0.5 }),
    desk: new THREE.MeshStandardMaterial({ color: 0x5a4a3a, roughness: 0.5 }),
    deskTop: new THREE.MeshStandardMaterial({ color: 0x7a6a5a, roughness: 0.4 }),
    chair: new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.6 }),
    monitor: new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x2244aa, emissive: 0x1133aa, emissiveIntensity: 0.8, roughness: 0.1 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.8, side: THREE.DoubleSide }),
    column: new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.4, metalness: 0.2 }),
    elevator: new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.3, metalness: 0.5 }),
    plant: new THREE.MeshStandardMaterial({ color: 0x2a6a2a, roughness: 0.8 }),
  };
  return intMats;
}

// ============================================================
// BUILD FLOOR INTERIOR — desks, chairs, monitors per floor
// ============================================================

function buildFloorInterior(group, floorY, w, d, floorNum, seed) {
  var m = getIntMats();
  var innerW = w - WALL_THICKNESS * 2;
  var innerD = d - WALL_THICKNESS * 2;

  // Floor slab
  var floorGeo = new THREE.BoxGeometry(innerW, 0.08, innerD);
  var floor = new THREE.Mesh(floorGeo, floorNum === 0 ? m.floor : m.carpet);
  floor.position.y = floorY + 0.04;
  floor.receiveShadow = true;
  group.add(floor);

  // Ceiling
  var ceilGeo = new THREE.BoxGeometry(innerW, 0.06, innerD);
  var ceil = new THREE.Mesh(ceilGeo, m.ceiling);
  ceil.position.y = floorY + FLOOR_HEIGHT - 0.03;
  group.add(ceil);

  // Ceiling light (fluorescent strip)
  var lightGeo = new THREE.BoxGeometry(innerW * 0.6, 0.04, 0.15);
  var lightMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xeeeeff, emissiveIntensity: 0.6 });
  var ceilLight = new THREE.Mesh(lightGeo, lightMat);
  ceilLight.position.y = floorY + FLOOR_HEIGHT - 0.08;
  group.add(ceilLight);

  // Columns removed for performance

  // Desks — limited count for performance
  var deskCount = Math.min(3, Math.floor(innerW / 3));
  var deskSpacing = innerW / (deskCount + 1);
  var deskPositions = [];

  for (var di = 0; di < deskCount; di++) {
    var dx = -innerW / 2 + deskSpacing * (di + 1);
    var dz = ((seed + di) % 2 === 0) ? -innerD * 0.2 : innerD * 0.2;

    // Desk (table top + legs)
    var topGeo = new THREE.BoxGeometry(1.2, 0.06, 0.6);
    var top = new THREE.Mesh(topGeo, m.deskTop);
    top.position.set(dx, floorY + 0.72, dz);
    group.add(top);

    // Desk legs
    var legGeo = new THREE.BoxGeometry(0.05, 0.7, 0.05);
    [[-0.55,-0.25],[0.55,-0.25],[0.55,0.25],[-0.55,0.25]].forEach(function(lp) {
      var leg = new THREE.Mesh(legGeo, m.desk);
      leg.position.set(dx + lp[0], floorY + 0.35, dz + lp[1]);
      group.add(leg);
    });

    // Monitor
    var monGeo = new THREE.BoxGeometry(0.5, 0.35, 0.03);
    var mon = new THREE.Mesh(monGeo, m.monitor);
    mon.position.set(dx, floorY + 1.0, dz - 0.15);
    group.add(mon);

    // Monitor screen (emissive — glows through windows)
    var scrGeo = new THREE.PlaneGeometry(0.45, 0.3);
    var scr = new THREE.Mesh(scrGeo, m.screen);
    scr.position.set(dx, floorY + 1.0, dz - 0.16);
    scr.rotation.y = Math.PI;
    group.add(scr);

    // Chair
    var chairSeat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.06, 0.4), m.chair);
    chairSeat.position.set(dx, floorY + 0.45, dz + 0.45);
    group.add(chairSeat);
    var chairBack = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.05), m.chair);
    chairBack.position.set(dx, floorY + 0.65, dz + 0.65);
    group.add(chairBack);

    deskPositions.push({ x: dx, y: floorY, z: dz + 0.45, floor: floorNum });
  }

  // Plants removed for performance

  return deskPositions;
}

// ============================================================
// BUILD COMPLETE BUILDING — shell + interior per floor
// ============================================================

export function buildDetailedBuilding(cx, cz, w, d, floors, buildingType, color) {
  var m = getIntMats();
  var group = new THREE.Group();
  var height = floors * FLOOR_HEIGHT;
  var allDesks = [];

  // === EXTERIOR WALLS (hollow shell, not solid box) ===
  var wallMat = new THREE.MeshStandardMaterial({
    color: color, roughness: 0.5, metalness: 0.15,
  });

  // Front wall (with window cutouts represented by glass)
  var glassMat = new THREE.MeshStandardMaterial({
    color: 0x99bbdd, transparent: true, opacity: 0.2,
    roughness: 0.0, metalness: 0.3, side: THREE.DoubleSide,
    depthWrite: false,
  });

  // Position group at building center — all children use local coords
  group.position.set(cx, 0, cz);

  // 4 walls as thin boxes (local coords, relative to group)
  var wallParts = [
    { sx: w, sy: height, sz: WALL_THICKNESS, px: 0, pz: d / 2 },       // front
    { sx: w, sy: height, sz: WALL_THICKNESS, px: 0, pz: -d / 2 },      // back
    { sx: WALL_THICKNESS, sy: height, sz: d, px: -w / 2, pz: 0 },      // left
    { sx: WALL_THICKNESS, sy: height, sz: d, px: w / 2, pz: 0 },       // right
  ];

  wallParts.forEach(function(wp) {
    var wallGeo = new THREE.BoxGeometry(wp.sx, wp.sy, wp.sz);
    var wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.set(wp.px, height / 2, wp.pz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    group.add(wall);
  });

  // Glass window panels on front and back (per floor)
  for (var fi = 0; fi < floors; fi++) {
    var winY = fi * FLOOR_HEIGHT + FLOOR_HEIGHT * 0.55;
    var winH = FLOOR_HEIGHT * 0.5;

    // Front windows
    var fwGeo = new THREE.PlaneGeometry(w * 0.85, winH);
    var fw = new THREE.Mesh(fwGeo, glassMat);
    fw.position.set(0, winY, d / 2 + 0.01);
    group.add(fw);

    // Back windows
    var bwGeo = new THREE.PlaneGeometry(w * 0.85, winH);
    var bw = new THREE.Mesh(bwGeo, glassMat);
    bw.position.set(0, winY, -d / 2 - 0.01);
    bw.rotation.y = Math.PI;
    group.add(bw);

    // Side windows
    [1, -1].forEach(function(side) {
      var swGeo = new THREE.PlaneGeometry(d * 0.85, winH);
      var sw = new THREE.Mesh(swGeo, glassMat);
      sw.position.set(side * (w / 2 + 0.01), winY, 0);
      sw.rotation.y = side * Math.PI / 2;
      group.add(sw);
    });
  }

  // Roof
  var roofGeo = new THREE.BoxGeometry(w + 0.3, 0.2, d + 0.3);
  var roof = new THREE.Mesh(roofGeo, wallMat);
  roof.position.set(0, height + 0.1, 0);
  roof.castShadow = true;
  group.add(roof);

  // Roof ledge (decorative)
  var ledgeGeo = new THREE.BoxGeometry(w + 0.5, 0.4, 0.15);
  var ledgeMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.4, metalness: 0.3 });
  [1, -1].forEach(function(side) {
    var ledge = new THREE.Mesh(ledgeGeo, ledgeMat);
    ledge.position.set(0, height + 0.2, side * (d / 2 + 0.07));
    group.add(ledge);
  });

  // === ENTRANCE (ground floor door) ===
  var doorGeo = new THREE.BoxGeometry(1.5, 2.5, 0.1);
  var doorMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.5 });
  var door = new THREE.Mesh(doorGeo, doorMat);
  door.position.set(0, 1.25, d / 2 + 0.08);
  group.add(door);

  // Glass door panels
  var doorGlass = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 1.8),
    glassMat
  );
  doorGlass.position.set(-0.3, 1.1, d / 2 + 0.09);
  group.add(doorGlass);
  var doorGlass2 = new THREE.Mesh(
    new THREE.PlaneGeometry(0.55, 1.8),
    glassMat
  );
  doorGlass2.position.set(0.3, 1.1, d / 2 + 0.09);
  group.add(doorGlass2);

  // Entrance canopy
  var canopyGeo = new THREE.BoxGeometry(2.5, 0.1, 1.2);
  var canopyMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.4, metalness: 0.3 });
  var canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.set(0, 2.7, d / 2 + 0.6);
  canopy.castShadow = true;
  group.add(canopy);

  // === FLOOR INTERIORS ===
  for (var floor = 0; floor < floors; floor++) {
    var floorY = floor * FLOOR_HEIGHT;
    var seed = Math.floor(cx * 7 + cz * 13 + floor * 31);
    var desks = buildFloorInterior(group, floorY, w, d, floor, seed);

    // Offset desk positions to world coords
    desks.forEach(function(dp) {
      allDesks.push({
        x: cx + dp.x,
        y: dp.y,
        z: cz + dp.z,
        floor: dp.floor,
        building: buildingType,
      });
    });
  }

  // No point lights — use emissive ceiling lights instead (zero GPU cost)

  S.furnitureGroup.add(group);

  return {
    group: group,
    desks: allDesks,
    height: height,
    entrance: { x: cx, z: cz + d / 2 + 1 },  // world coords for external use
  };
}
