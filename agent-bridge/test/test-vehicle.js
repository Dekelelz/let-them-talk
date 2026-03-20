/**
 * Vehicle System Tests — Phase 2 AI City
 *
 * Tests vehicle state machine, collision logic, and enter/exit transitions.
 * These tests validate pure logic (no WebGL required).
 *
 * Usage: node test/test-vehicle.js
 */

'use strict';

var passed = 0;
var failed = 0;
var failedTests = [];

function log(msg) { console.log(msg); }
function pass(name) { passed++; log('  \x1b[32m✓\x1b[0m ' + name); }
function fail(name, reason) {
  failed++;
  var msg = name + (reason ? ' — ' + reason : '');
  failedTests.push(msg);
  log('  \x1b[31m✗\x1b[0m ' + msg);
}

// ==========================================
// Vehicle State Machine Tests
// ==========================================

log('\n\x1b[1mVehicle State Machine\x1b[0m');

// State definitions
var STATES = {
  WALKING: 'walking',
  ENTERING: 'entering',
  DRIVING: 'driving',
  EXITING: 'exiting'
};

// Valid transitions
var VALID_TRANSITIONS = {
  walking: ['entering'],
  entering: ['driving'],
  driving: ['exiting'],
  exiting: ['walking']
};

function canTransition(from, to) {
  return VALID_TRANSITIONS[from] && VALID_TRANSITIONS[from].indexOf(to) !== -1;
}

// Test: Valid transitions
if (canTransition('walking', 'entering')) pass('walking → entering (E key press)');
else fail('walking → entering');

if (canTransition('entering', 'driving')) pass('entering → driving (animation complete)');
else fail('entering → driving');

if (canTransition('driving', 'exiting')) pass('driving → exiting (E key press)');
else fail('driving → exiting');

if (canTransition('exiting', 'walking')) pass('exiting → walking (animation complete)');
else fail('exiting → walking');

// Test: Invalid transitions (should be blocked)
if (!canTransition('walking', 'driving')) pass('walking → driving blocked (must enter first)');
else fail('walking → driving should be blocked');

if (!canTransition('walking', 'exiting')) pass('walking → exiting blocked');
else fail('walking → exiting should be blocked');

if (!canTransition('driving', 'walking')) pass('driving → walking blocked (must exit first)');
else fail('driving → walking should be blocked');

if (!canTransition('driving', 'entering')) pass('driving → entering blocked');
else fail('driving → entering should be blocked');

if (!canTransition('entering', 'walking')) pass('entering → walking blocked (can\'t cancel mid-enter)');
else fail('entering → walking should be blocked');

if (!canTransition('exiting', 'driving')) pass('exiting → driving blocked (can\'t cancel mid-exit)');
else fail('exiting → driving should be blocked');

// ==========================================
// AABB Collision Tests
// ==========================================

log('\n\x1b[1mVehicle-Building Collision (AABB)\x1b[0m');

function aabbOverlap(a, b) {
  // Each box: { x, z, hw, hd } (center x, center z, half-width, half-depth)
  return Math.abs(a.x - b.x) < (a.hw + b.hw) &&
         Math.abs(a.z - b.z) < (a.hd + b.hd);
}

// Test: No collision (car far from building)
var car1 = { x: 0, z: 0, hw: 0.8, hd: 2 }; // 1.6u wide, 4u deep sedan
var building1 = { x: 50, z: 50, hw: 5, hd: 5 };
if (!aabbOverlap(car1, building1)) pass('no collision: car far from building');
else fail('no collision: car far from building');

// Test: Direct collision (car inside building)
var car2 = { x: 50, z: 50, hw: 0.8, hd: 2 };
if (aabbOverlap(car2, building1)) pass('collision: car overlapping building');
else fail('collision: car overlapping building');

// Test: Edge touching (gap = 0, no overlap — not a collision)
var car3 = { x: 44, z: 50, hw: 0.8, hd: 2 }; // right edge at 44.8, building left edge at 45.0 — 0.2u gap
if (!aabbOverlap(car3, building1)) pass('no collision: car 0.2u from building edge');
else fail('no collision: car near building edge');

// Test: Slight overlap (0.1u into building)
var car3b = { x: 44.3, z: 50, hw: 0.8, hd: 2 };
if (aabbOverlap(car3b, building1)) pass('collision: car 0.1u into building');
else fail('collision: car 0.1u into building');

// Test: Near miss (car just outside building)
var car4 = { x: 44.1, z: 50, hw: 0.8, hd: 2 };
if (!aabbOverlap(car4, building1)) pass('no collision: car just outside building');
else fail('no collision: car just outside building');

// Test: Corner case (diagonal approach)
var car5 = { x: 45, z: 44, hw: 0.8, hd: 2 };
if (aabbOverlap(car5, building1)) pass('collision: diagonal approach within bounds');
else fail('collision: diagonal approach within bounds');

// ==========================================
// Boundary Collision Tests
// ==========================================

log('\n\x1b[1mVehicle-Boundary Collision\x1b[0m');

function isInsideBoundary(pos, boundarySize) {
  // City boundary: -boundarySize/2 to +boundarySize/2
  var half = boundarySize / 2;
  return pos.x > -half && pos.x < half && pos.z > -half && pos.z < half;
}

function clampToBoundary(pos, boundarySize, margin) {
  var half = boundarySize / 2 - (margin || 0);
  return {
    x: Math.max(-half, Math.min(half, pos.x)),
    z: Math.max(-half, Math.min(half, pos.z))
  };
}

var CITY_SIZE = 400; // 8x8 grid * 50 units

// Test: Car inside boundary
if (isInsideBoundary({ x: 0, z: 0 }, CITY_SIZE)) pass('car at center: inside boundary');
else fail('car at center: inside boundary');

if (isInsideBoundary({ x: 190, z: 190 }, CITY_SIZE)) pass('car near edge: inside boundary');
else fail('car near edge: inside boundary');

// Test: Car outside boundary
if (!isInsideBoundary({ x: 201, z: 0 }, CITY_SIZE)) pass('car past east edge: outside boundary');
else fail('car past east edge: outside boundary');

if (!isInsideBoundary({ x: 0, z: -201 }, CITY_SIZE)) pass('car past south edge: outside boundary');
else fail('car past south edge: outside boundary');

// Test: Clamp to boundary
var clamped = clampToBoundary({ x: 300, z: -300 }, CITY_SIZE, 5);
if (clamped.x === 195 && clamped.z === -195) pass('clamp to boundary with 5u margin');
else fail('clamp to boundary with 5u margin', 'got x=' + clamped.x + ' z=' + clamped.z);

var clampedInside = clampToBoundary({ x: 50, z: -30 }, CITY_SIZE, 5);
if (clampedInside.x === 50 && clampedInside.z === -30) pass('clamp: car already inside, no change');
else fail('clamp: car already inside', 'got x=' + clampedInside.x + ' z=' + clampedInside.z);

// ==========================================
// Speed & Physics Tests
// ==========================================

log('\n\x1b[1mVehicle Speed & Physics\x1b[0m');

var MAX_SPEED = 60; // units/sec
var ACCELERATION = 40; // units/sec^2
var BRAKE_DECEL = 80; // units/sec^2
var FRICTION = 20; // units/sec^2

function updateSpeed(speed, accelerating, braking, dt) {
  if (accelerating) speed += ACCELERATION * dt;
  else if (braking) speed -= BRAKE_DECEL * dt;
  else speed -= FRICTION * dt; // natural deceleration

  speed = Math.max(0, Math.min(MAX_SPEED, speed));
  return speed;
}

// Test: Acceleration
var s1 = updateSpeed(0, true, false, 0.5);
if (s1 === 20) pass('acceleration: 0 + 40*0.5 = 20');
else fail('acceleration', 'expected 20, got ' + s1);

// Test: Speed cap
var s2 = updateSpeed(55, true, false, 0.5);
if (s2 === MAX_SPEED) pass('speed capped at ' + MAX_SPEED);
else fail('speed cap', 'expected ' + MAX_SPEED + ', got ' + s2);

// Test: Braking
var s3 = updateSpeed(40, false, true, 0.25);
if (s3 === 20) pass('braking: 40 - 80*0.25 = 20');
else fail('braking', 'expected 20, got ' + s3);

// Test: Braking doesn't go negative
var s4 = updateSpeed(5, false, true, 1);
if (s4 === 0) pass('braking clamps to 0 (no reverse)');
else fail('braking clamp', 'expected 0, got ' + s4);

// Test: Friction (coasting)
var s5 = updateSpeed(30, false, false, 0.5);
if (s5 === 20) pass('friction: 30 - 20*0.5 = 20');
else fail('friction', 'expected 20, got ' + s5);

// ==========================================
// Camera Mode Tests
// ==========================================

log('\n\x1b[1mCamera Mode Transitions\x1b[0m');

var CAMERA_MODES = { PLAYER: 'player', THIRD_PERSON: 'third_person', SPECTATOR: 'spectator' };

function getCameraMode(vehicleState) {
  if (vehicleState === 'driving' || vehicleState === 'entering' || vehicleState === 'exiting') {
    return CAMERA_MODES.THIRD_PERSON;
  }
  return CAMERA_MODES.PLAYER;
}

if (getCameraMode('walking') === 'player') pass('walking: player camera');
else fail('walking: player camera');

if (getCameraMode('entering') === 'third_person') pass('entering: third-person camera');
else fail('entering: third-person camera');

if (getCameraMode('driving') === 'third_person') pass('driving: third-person camera');
else fail('driving: third-person camera');

if (getCameraMode('exiting') === 'third_person') pass('exiting: third-person camera');
else fail('exiting: third-person camera');

// ==========================================
// Parking Spot Tests
// ==========================================

log('\n\x1b[1mParking Spot Logic\x1b[0m');

function findNearestParkingSpot(carPos, spots) {
  var nearest = null;
  var nearestDist = Infinity;
  for (var i = 0; i < spots.length; i++) {
    var s = spots[i];
    if (s.occupied) continue;
    var dx = carPos.x - s.x;
    var dz = carPos.z - s.z;
    var dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = s;
    }
  }
  return nearest;
}

var spots = [
  { x: 10, z: 10, occupied: false },
  { x: 20, z: 20, occupied: true },
  { x: 30, z: 30, occupied: false }
];

var nearest = findNearestParkingSpot({ x: 18, z: 18 }, spots);
if (nearest && nearest.x === 10) pass('nearest unoccupied spot found (skips occupied)');
else fail('nearest spot', 'expected x=10, got ' + (nearest ? nearest.x : 'null'));

var nearest2 = findNearestParkingSpot({ x: 28, z: 28 }, spots);
if (nearest2 && nearest2.x === 30) pass('nearest spot changes with car position');
else fail('nearest spot by position', 'expected x=30, got ' + (nearest2 ? nearest2.x : 'null'));

var allOccupied = [{ x: 10, z: 10, occupied: true }];
var nearest3 = findNearestParkingSpot({ x: 10, z: 10 }, allOccupied);
if (nearest3 === null) pass('no spot available when all occupied');
else fail('all occupied should return null');

// ==========================================
// First-Person & Drift Mode
// ==========================================

log('\n\x1b[1mFirst-Person & Drift Mode\x1b[0m');

var VIEW_MODES = { THIRD_PERSON: 'third_person', FIRST_PERSON: 'first_person' };

function toggleViewMode(current) {
  return current === VIEW_MODES.THIRD_PERSON ? VIEW_MODES.FIRST_PERSON : VIEW_MODES.THIRD_PERSON;
}

if (toggleViewMode('third_person') === 'first_person') pass('F key: third_person → first_person');
else fail('toggle to first person');

if (toggleViewMode('first_person') === 'third_person') pass('F key: first_person → third_person');
else fail('toggle to third person');

function getDriftFactor(braking, steering) {
  if (!braking || Math.abs(steering) < 0.1) return 0;
  return Math.min(1, Math.abs(steering) * 2); // 0-1 drift intensity
}

if (getDriftFactor(true, 0.8) > 0.5) pass('drift active: braking + turning');
else fail('drift active');

if (getDriftFactor(false, 0.8) === 0) pass('no drift: not braking');
else fail('no drift without brake');

if (getDriftFactor(true, 0.05) === 0) pass('no drift: turning too slight');
else fail('no drift slight turn');

// ==========================================
// Results
// ==========================================

log('\n\x1b[1m━━━ Vehicle Test Results ━━━\x1b[0m');
log('  \x1b[32m' + passed + ' passed\x1b[0m');
if (failed > 0) {
  log('  \x1b[31m' + failed + ' failed:\x1b[0m');
  failedTests.forEach(function(t) { log('    \x1b[31m✗\x1b[0m ' + t); });
}

process.exit(failed > 0 ? 1 : 0);
