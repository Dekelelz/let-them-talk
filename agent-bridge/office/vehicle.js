import * as THREE from 'three';
import { S } from './state.js';

// ============================================================
// VEHICLE SYSTEM — Drivable cars in AI City
// Phase 2: Enter/exit, WASD driving, camera follow, collision
// ============================================================

var CAR_SPEED = 0.3;
var CAR_TURN_SPEED = 0.035;
var CAR_BRAKE = 0.92;        // friction multiplier per frame
var CAR_ACCEL = 0.012;
var CAR_MAX_SPEED = 0.6;
var CAM_DISTANCE = 10;
var CAM_HEIGHT = 4;
var CAM_SMOOTH = 0.06;
var firstPersonMode = false;

var vehicles = [];
var activeVehicle = null;    // currently driven vehicle
var driving = false;
var keys = { w: false, a: false, s: false, d: false, space: false };
var velocity = 0;
var steerAngle = 0;

// ============================================================
// CAR MESH — low-poly stylized car
// ============================================================

function createCarMesh(color) {
  var group = new THREE.Group();
  var paintMat = new THREE.MeshStandardMaterial({ color: color, roughness: 0.25, metalness: 0.5 });
  var chromeMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.05, metalness: 0.95 });
  var glassMat = new THREE.MeshStandardMaterial({
    color: 0x99ccff, transparent: true, opacity: 0.18,
    roughness: 0.0, metalness: 0.3, side: THREE.DoubleSide,
    depthWrite: false,
  });
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });
  var tireMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.95 });
  var rimMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.15, metalness: 0.8 });
  var interiorMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });

  // === SEDAN BODY — two boxes for performance ===
  // Lower body
  var bodyGeo = new THREE.BoxGeometry(1.5, 0.45, 3.8);
  var body = new THREE.Mesh(bodyGeo, paintMat);
  body.position.set(0, 0.42, 0);
  group.add(body);

  // Cabin (narrower, shorter)
  var cabinGeo = new THREE.BoxGeometry(1.3, 0.42, 1.7);
  var cabin = new THREE.Mesh(cabinGeo, paintMat);
  cabin.position.set(0, 0.86, -0.1);
  group.add(cabin);

  // Interior floor (visible through glass)
  var intFloor = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 1.5), interiorMat);
  intFloor.position.set(0, 0.68, 0.15);
  group.add(intFloor);

  // Steering wheel
  var steeringGeo = new THREE.TorusGeometry(0.12, 0.015, 8, 16);
  var steering = new THREE.Mesh(steeringGeo, darkMat);
  steering.position.set(-0.3, 0.85, 0.5);
  steering.rotation.x = -0.5;
  group.add(steering);

  // Seats (2 front)
  [-0.3, 0.3].forEach(function(x) {
    var seatBase = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.08, 0.4), interiorMat);
    seatBase.position.set(x, 0.74, 0.25);
    group.add(seatBase);
    var seatBack = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.08), interiorMat);
    seatBack.position.set(x, 0.9, 0.03);
    seatBack.rotation.x = 0.1;
    group.add(seatBack);
  });

  // === GLASS PANELS (truly transparent) ===
  // Windshield (angled)
  var wsGeo = new THREE.PlaneGeometry(1.1, 0.5);
  var ws = new THREE.Mesh(wsGeo, glassMat);
  ws.position.set(0, 0.9, 0.78);
  ws.rotation.x = -0.45;
  group.add(ws);

  // Rear window
  var rwGeo = new THREE.PlaneGeometry(1.0, 0.4);
  var rw = new THREE.Mesh(rwGeo, glassMat);
  rw.position.set(0, 0.9, -0.82);
  rw.rotation.x = 0.4;
  rw.rotation.y = Math.PI;
  group.add(rw);

  // Side windows
  [1, -1].forEach(function(side) {
    var swGeo = new THREE.PlaneGeometry(1.4, 0.32);
    var sw = new THREE.Mesh(swGeo, glassMat);
    sw.position.set(side * 0.59, 0.88, 0.0);
    sw.rotation.y = side * Math.PI / 2;
    group.add(sw);
  });

  // === WHEELS (realistic proportions) ===
  var wheelPositions = [
    { x: -0.68, y: 0.24, z: 1.1 },
    { x: 0.68, y: 0.24, z: 1.1 },
    { x: -0.68, y: 0.24, z: -1.1 },
    { x: 0.68, y: 0.24, z: -1.1 },
  ];
  var wheelMeshes = [];
  wheelPositions.forEach(function(wp) {
    var wheelGroup = new THREE.Group();
    // Tire (simple cylinder for performance)
    var tireGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.16, 8);
    var tire = new THREE.Mesh(tireGeo, tireMat);
    tire.rotation.z = Math.PI / 2;
    wheelGroup.add(tire);
    // Rim
    var rimGeo = new THREE.CylinderGeometry(0.14, 0.14, 0.17, 6);
    var rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.z = Math.PI / 2;
    wheelGroup.add(rim);

    wheelGroup.position.set(wp.x, wp.y, wp.z);
    group.add(wheelGroup);
    wheelMeshes.push(wheelGroup);
  });

  // === FRONT GRILLE ===
  var grilleGeo = new THREE.BoxGeometry(0.9, 0.2, 0.05);
  var grilleMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3, metalness: 0.6 });
  var grille = new THREE.Mesh(grilleGeo, grilleMat);
  grille.position.set(0, 0.42, 1.93);
  group.add(grille);

  // === BUMPERS (body-colored, integrated) ===
  var fBumper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), paintMat);
  fBumper.position.set(0, 0.28, 1.94);
  group.add(fBumper);
  var rBumper = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.12, 0.12), paintMat);
  rBumper.position.set(0, 0.28, -1.94);
  group.add(rBumper);

  // === HEADLIGHTS (modern LED style) ===
  var hlMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffee, emissiveIntensity: 1.5 });
  [-0.5, 0.5].forEach(function(x) {
    var hl = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.05), hlMat);
    hl.position.set(x, 0.48, 1.94);
    group.add(hl);
  });

  // === TAILLIGHTS (LED strip) ===
  var tlMat = new THREE.MeshStandardMaterial({ color: 0xff1111, emissive: 0xff0000, emissiveIntensity: 1.0 });
  [-0.5, 0.5].forEach(function(x) {
    var tl = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.06, 0.05), tlMat);
    tl.position.set(x, 0.48, -1.94);
    group.add(tl);
  });

  // === SIDE MIRRORS ===
  [-1, 1].forEach(function(side) {
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.03, 0.04), darkMat);
    arm.position.set(side * 0.78, 0.78, 0.55);
    group.add(arm);
    var head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.1), darkMat);
    head.position.set(side * 0.86, 0.78, 0.55);
    group.add(head);
  });

  // === EXHAUST ===
  var exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.04, 0.15, 8), chromeMat);
  exhaust.position.set(0.4, 0.2, -1.98);
  exhaust.rotation.x = Math.PI / 2;
  group.add(exhaust);

  // === LICENSE PLATES ===
  var plateMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4 });
  var plateGeo = new THREE.BoxGeometry(0.4, 0.1, 0.015);
  var fPlate = new THREE.Mesh(plateGeo, plateMat);
  fPlate.position.set(0, 0.32, 1.95);
  group.add(fPlate);
  var rPlate = new THREE.Mesh(plateGeo, plateMat);
  rPlate.position.set(0, 0.32, -1.95);
  group.add(rPlate);

  group.userData.isVehicle = true;
  group.userData.velocity = 0;
  group.userData.wheels = wheelMeshes;

  return group;
}

// ============================================================
// SPAWN VEHICLES — place cars at parking spots
// ============================================================

export function spawnVehicles(parkingSpots) {
  var colors = [0x3366cc, 0xcc3333, 0x33cc66, 0xcccc33, 0x9933cc, 0xcc6633];

  // Default parking spots if none provided (along main roads)
  if (!parkingSpots || parkingSpots.length === 0) {
    parkingSpots = [
      { x: 26, z: 2, rot: 0 },
      { x: 50, z: 2, rot: 0 },
      { x: 74, z: 2, rot: 0 },
      { x: 98, z: 2, rot: 0 },
      { x: 122, z: 2, rot: 0 },
      { x: 146, z: 2, rot: 0 },
      { x: 2, z: 50, rot: Math.PI / 2 },
      { x: 2, z: 98, rot: Math.PI / 2 },
    ];
  }

  parkingSpots.forEach(function(spot, i) {
    var color = colors[i % colors.length];
    var car = createCarMesh(color);
    car.position.set(spot.x, 0, spot.z);
    car.rotation.y = spot.rot || 0;
    car.userData.parkingSpot = spot;
    car.userData.carIndex = i;
    S.scene.add(car);
    vehicles.push(car);
  });

  return vehicles;
}

// ============================================================
// ENTER / EXIT — E key to toggle
// ============================================================

export function getNearestVehicle(playerPos, maxDist) {
  maxDist = maxDist || 5;
  var nearest = null;
  var nearestDist = maxDist;

  vehicles.forEach(function(car) {
    var dx = car.position.x - playerPos.x;
    var dz = car.position.z - playerPos.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = car;
    }
  });

  return nearest;
}

export function enterVehicle(car) {
  if (!car || driving) return false;
  activeVehicle = car;
  driving = true;
  velocity = 0;
  steerAngle = 0;
  firstPersonMode = false;

  // Disable spectator/player controls
  if (S.controls && S.controls.enabled !== undefined) {
    S.controls.enabled = false;
  }

  // Hide player character while in vehicle
  if (S._player && S._player.parts && S._player.parts.group) {
    S._player.parts.group.visible = false;
  }

  // Set up key listeners
  window.addEventListener('keydown', onDriveKeyDown);
  window.addEventListener('keyup', onDriveKeyUp);

  return true;
}

export function exitVehicle() {
  if (!driving || !activeVehicle) return false;
  driving = false;
  velocity = 0;
  firstPersonMode = false;

  // Re-enable spectator/player controls
  if (S.controls && S.controls.enabled !== undefined) {
    S.controls.enabled = true;
  }

  // Show player character again
  if (S._player && S._player.parts && S._player.parts.group) {
    S._player.parts.group.visible = true;
    // Move player to car exit position
    S._player.pos.x = activeVehicle.position.x + 3;
    S._player.pos.z = activeVehicle.position.z;
  }

  // Remove key listeners
  window.removeEventListener('keydown', onDriveKeyDown);
  window.removeEventListener('keyup', onDriveKeyUp);

  // Reset keys
  keys.w = keys.a = keys.s = keys.d = keys.space = false;

  var exitPos = activeVehicle.position.clone();
  exitPos.x += 3;
  activeVehicle = null;

  return exitPos;
}

function onDriveKeyDown(e) {
  var k = e.key.toLowerCase();
  if (k === 'w') keys.w = true;
  if (k === 'a') keys.a = true;
  if (k === 's') keys.s = true;
  if (k === 'd') keys.d = true;
  if (k === ' ') keys.space = true;
  if (k === 'f') {
    firstPersonMode = !firstPersonMode;
  }
  if (k === 'escape' || k === 'e') {
    var pos = exitVehicle();
    window.dispatchEvent(new CustomEvent('vehicle-exit', { detail: { position: pos } }));
  }
}

function onDriveKeyUp(e) {
  var k = e.key.toLowerCase();
  if (k === 'w') keys.w = false;
  if (k === 'a') keys.a = false;
  if (k === 's') keys.s = false;
  if (k === 'd') keys.d = false;
  if (k === ' ') keys.space = false;
}

// ============================================================
// DRIVING PHYSICS — simple arcade style
// ============================================================

function checkBuildingCollision(pos) {
  // Simple AABB collision against city buildings
  if (!S._cityBuildings) return false;
  for (var i = 0; i < S._cityBuildings.length; i++) {
    var b = S._cityBuildings[i];
    var halfW = b.width / 2 + 1.5;  // car half-width buffer
    var halfD = b.depth / 2 + 1.5;
    if (pos.x > b.x - halfW && pos.x < b.x + halfW &&
        pos.z > b.z - halfD && pos.z < b.z + halfD) {
      return true;
    }
  }
  return false;
}

export function updateVehicle(dt) {
  if (!driving || !activeVehicle) return;

  // Acceleration / braking
  if (keys.w) velocity = Math.min(velocity + CAR_ACCEL, CAR_MAX_SPEED);
  if (keys.s) velocity = Math.max(velocity - CAR_ACCEL, -CAR_MAX_SPEED * 0.5);
  if (keys.space) velocity *= 0.9; // handbrake
  if (!keys.w && !keys.s) velocity *= CAR_BRAKE; // friction

  // Steering (only when moving) — drift when space + turn
  var turnMultiplier = keys.space ? 2.2 : 1.0; // drift = sharper turns
  if (Math.abs(velocity) > 0.01) {
    if (keys.a) steerAngle += CAR_TURN_SPEED * turnMultiplier * (velocity > 0 ? 1 : -1);
    if (keys.d) steerAngle -= CAR_TURN_SPEED * turnMultiplier * (velocity > 0 ? 1 : -1);
  }

  // Apply movement
  var forward = new THREE.Vector3(0, 0, 1);
  forward.applyAxisAngle(new THREE.Vector3(0, 1, 0), steerAngle);

  var newPos = activeVehicle.position.clone();
  newPos.x += forward.x * velocity;
  newPos.z += forward.z * velocity;

  // Collision check
  if (!checkBuildingCollision(newPos)) {
    activeVehicle.position.copy(newPos);
  } else {
    velocity *= -0.3; // bounce back slightly
  }

  activeVehicle.rotation.y = steerAngle;

  // Spin wheels based on velocity
  if (activeVehicle.userData.wheels) {
    activeVehicle.userData.wheels.forEach(function(wheel) {
      wheel.children.forEach(function(child) {
        if (child.geometry && child.geometry.type === 'TorusGeometry') {
          child.rotation.x += velocity * 3; // spin tires
        }
      });
    });
  }

  // Camera: first-person or third-person
  if (firstPersonMode) {
    // First person — inside car, looking forward
    var fpPos = new THREE.Vector3();
    fpPos.x = activeVehicle.position.x + forward.x * 0.3;
    fpPos.y = activeVehicle.position.y + 1.1;
    fpPos.z = activeVehicle.position.z + forward.z * 0.3;
    S.camera.position.lerp(fpPos, 0.15);

    var lookTarget = new THREE.Vector3();
    lookTarget.x = activeVehicle.position.x + forward.x * 10;
    lookTarget.y = activeVehicle.position.y + 0.8;
    lookTarget.z = activeVehicle.position.z + forward.z * 10;
    S.camera.lookAt(lookTarget);
  } else {
    // Third person — behind and above
    var camTarget = new THREE.Vector3();
    camTarget.x = activeVehicle.position.x - forward.x * CAM_DISTANCE;
    camTarget.y = activeVehicle.position.y + CAM_HEIGHT;
    camTarget.z = activeVehicle.position.z - forward.z * CAM_DISTANCE;

    S.camera.position.lerp(camTarget, CAM_SMOOTH);
    S.camera.lookAt(activeVehicle.position.x, activeVehicle.position.y + 1, activeVehicle.position.z);
  }
}

// ============================================================
// GETTERS
// ============================================================

export function isDriving() { return driving; }
export function isFirstPerson() { return firstPersonMode; }
export function getActiveVehicle() { return activeVehicle; }
export function getVehicles() { return vehicles; }
export function getSpeed() { return Math.abs(velocity) * 100; } // km/h-ish
export function getSteerAngle() { return steerAngle; }
export function isDrifting() { return keys.space && Math.abs(velocity) > 0.1 && (keys.a || keys.d); }

// ============================================================
// CLEANUP
// ============================================================

export function disposeVehicles() {
  vehicles.forEach(function(car) {
    car.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(function(m) { m.dispose(); });
        else child.material.dispose();
      }
    });
    S.scene.remove(car);
  });
  vehicles = [];
  activeVehicle = null;
  driving = false;
  velocity = 0;
}
