import { S } from './state.js';

// ============================================================
// NAVIGATION SYSTEM — Waypoint graph pathfinding
// Agents walk along connected waypoints to avoid walls/objects
// ============================================================

// Campus geometry reference (90W x 60D):
// Outer walls: X = ±45, Z = ±30
// Workspace: 5x4 desk grid at X=[-8,-4,0,4,8], Z=[6,10,14,18]
// Manager office at (30, 10), size 10x10:
//   Left wall:  X = 25,  Right wall: X = 35
//   Front wall: Z = 5 (door at center X=30)
//   Back wall:  Z = 15
//   Path must approach from south (Z<5) and enter through door
// Main corridor: Z=0, runs full campus width (-2 to +2)
// Cross corridors: X=±20, connect north-south (3 units wide)
// Lobby/Entrance: Z=22-30, front wall gap at center
// Designer Studio: center (-28, 0), 12x10
// Bar & Café: center (-28, -18), 12x10
// Rec Center: center (0, -18), 12x10
// Gym: center (22, -18), 12x10
// Staircase: X=35, Z=-14 to -22, connects to mezzanine (Z=-18 to -30)
// Gallery Wing: inside campus at (-36, 10), 14x12, open east side at X=-29

var CAMPUS_WAYPOINTS = [
  // === LOBBY / ENTRANCE (Z=22-30, front wall gap at center) ===
  { id: 'spawn',         x: 0,     z: 28 },   // entrance area (between door and reception)
  { id: 'lobby',         x: 0,     z: 24 },   // inside lobby center
  { id: 'lobby_left',    x: -10,   z: 24 },   // lobby left side
  { id: 'lobby_right',   x: 10,    z: 24 },   // lobby right side

  // === WORKSPACE (5x4 desk grid, X=[-8,-4,0,4,8], Z=[6,10,14,18]) ===
  { id: 'work_N',        x: 0,     z: 18 },   // northernmost row center
  { id: 'work_NW',       x: -8,    z: 18 },   // north-west desk
  { id: 'work_NE',       x: 8,     z: 18 },   // north-east desk
  { id: 'work_W',        x: -8,    z: 14 },   // west mid desk
  { id: 'work_C',        x: 0,     z: 14 },   // center desk
  { id: 'work_E',        x: 8,     z: 14 },   // east mid desk
  { id: 'work_SW',       x: -8,    z: 10 },   // south-west desk
  { id: 'work_S',        x: 0,     z: 10 },   // south row center
  { id: 'work_SE',       x: 8,     z: 10 },   // south-east desk

  // === MAIN CORRIDOR (Z=0, runs full width) ===
  { id: 'corr_L',        x: -20,   z: 0 },    // left end (at cross corridor)
  { id: 'corr_CL',       x: -8,    z: 0 },    // center-left
  { id: 'corr_C',        x: 0,     z: 0 },    // center
  { id: 'corr_CR',       x: 8,     z: 0 },    // center-right
  { id: 'corr_R',        x: 20,    z: 0 },    // right end (at cross corridor)
  { id: 'corr_RR',       x: 30,    z: 0 },    // far right (toward manager approach)

  // === CROSS CORRIDORS (X=±20, connect north-south) ===
  { id: 'cross_NL',      x: -20,   z: 12 },   // north-left cross corridor
  { id: 'cross_SL',      x: -20,   z: -12 },  // south-left cross corridor
  { id: 'cross_NR',      x: 20,    z: 12 },   // north-right cross corridor
  { id: 'cross_SR',      x: 20,    z: -12 },  // south-right cross corridor

  // === MANAGER OFFICE (center at (30,10), walls: left X=25, right X=35, front Z=5, back Z=15) ===
  // Door at front wall center (X=30, Z=5). Path approaches from south (Z<5).
  { id: 'mgr_hallway',   x: 30,    z: 3 },    // south of office, in main corridor area
  { id: 'mgr_outside',   x: 30,    z: 4 },    // directly outside front wall
  { id: 'mgr_doorstep',  x: 30,    z: 5,  triggerDoor: 'open' },  // at door threshold
  { id: 'mgr_entry',     x: 30,    z: 7 },    // just inside the door
  { id: 'mgr_desk',      x: 30,    z: 12 },   // at the manager desk

  // === DESIGNER STUDIO (center (-28, 0), 12x10) ===
  { id: 'design_entry',  x: -22,   z: 0 },    // entry from cross corridor
  { id: 'design_center', x: -28,   z: 0 },    // studio center

  // === BAR & CAFÉ (center (-28, -18), 12x10) ===
  { id: 'bar_entry',     x: -22,   z: -14 },  // entry from south cross corridor
  { id: 'bar_center',    x: -28,   z: -18 },  // bar center

  // === REC CENTER (center (0, -18), 12x10) ===
  { id: 'rec_entry',     x: 0,     z: -14 },  // entry from south corridor
  { id: 'rec_center',    x: 0,     z: -18 },  // rec center

  // === GYM (center (22, -18), 12x10) ===
  { id: 'gym_entry',     x: 14,    z: -14 },  // entry from south cross corridor
  { id: 'gym_center',    x: 22,    z: -18 },  // gym center

  // === STAIRCASE (X=35, Z=-14 to -22) ===
  { id: 'stairs_bot',    x: 35,    z: -14 },  // bottom of stairs
  { id: 'stairs_top',    x: 35,    z: -20 },  // top of stairs (mezzanine level)

  // === MEZZANINE (Z=-18 to -30) ===
  { id: 'mezz_C',        x: 0,     z: -24 },  // mezzanine center

  // === GALLERY WING (inside campus, center at -36, 10, entry from east at X=-29) ===
  { id: 'gallery_entry', x: -28,   z: 10 },   // just outside east glass entrance
  { id: 'gallery_center',x: -36,   z: 10 },   // gallery center
];

var CAMPUS_CONNECTIONS = [
  // === LOBBY ===
  ['spawn',        'lobby'],
  ['lobby',        'lobby_left'],
  ['lobby',        'lobby_right'],
  ['lobby',        'work_N'],         // lobby → northernmost workspace row
  ['lobby_left',   'work_NW'],
  ['lobby_right',  'work_NE'],

  // === WORKSPACE GRID (rows N→S, Z: 18→10) ===
  // North row (Z=18)
  ['work_N',       'work_NW'],
  ['work_N',       'work_NE'],
  // Mid row (Z=14) — connected to north
  ['work_NW',      'work_W'],
  ['work_N',       'work_C'],
  ['work_NE',      'work_E'],
  // Horizontal mid
  ['work_W',       'work_C'],
  ['work_C',       'work_E'],
  // South row (Z=10) — connected to mid
  ['work_W',       'work_SW'],
  ['work_C',       'work_S'],
  ['work_E',       'work_SE'],
  // Horizontal south
  ['work_SW',      'work_S'],
  ['work_S',       'work_SE'],

  // === WORKSPACE → MAIN CORRIDOR (Z=0) ===
  ['work_SW',      'corr_CL'],        // south-west desk down to corridor
  ['work_S',       'corr_C'],         // south center down to corridor
  ['work_SE',      'corr_CR'],        // south-east desk down to corridor

  // === MAIN CORRIDOR (horizontal, Z=0) ===
  ['corr_L',       'corr_CL'],
  ['corr_CL',      'corr_C'],
  ['corr_C',       'corr_CR'],
  ['corr_CR',      'corr_R'],
  ['corr_R',       'corr_RR'],        // extend east toward manager side

  // === CROSS CORRIDORS (X=±20, north-south) ===
  // Left cross corridor (X=-20): lobby-side north → main corridor → south zone
  ['cross_NL',     'work_NW'],        // north end connects to workspace
  ['cross_NL',     'corr_L'],         // meets main corridor
  ['corr_L',       'cross_SL'],       // south through left cross corridor
  ['cross_SL',     'cross_NL'],       // bidirectional shortcut label
  // Right cross corridor (X=20): lobby-side north → main corridor → south zone
  ['cross_NR',     'work_NE'],        // north end connects to workspace
  ['cross_NR',     'corr_R'],         // meets main corridor
  ['corr_R',       'cross_SR'],       // south through right cross corridor
  ['cross_SR',     'cross_NR'],       // bidirectional shortcut label

  // === MANAGER OFFICE ===
  // Approach: corr_RR(30,0) → mgr_hallway(30,3) → mgr_outside(30,4) → door → inside
  ['corr_RR',      'mgr_hallway'],    // walk north along X=30 toward office
  ['mgr_hallway',  'mgr_outside'],    // step closer to front wall
  ['mgr_outside',  'mgr_doorstep'],   // step to door threshold (triggers door open)
  ['mgr_doorstep', 'mgr_entry'],      // walk through open door
  ['mgr_entry',    'mgr_desk'],       // walk to manager desk

  // === DESIGNER STUDIO (center -28, 0) — enter from left cross corridor ===
  ['corr_L',       'design_entry'],   // branch off main corridor at X=-20 level
  ['design_entry', 'design_center'],  // walk into studio

  // === SOUTH ZONES — accessed via cross corridors reaching south ===
  // Left south: cross_SL(-20,-12) → bar_entry(-22,-14) → bar_center(-28,-18)
  ['cross_SL',     'bar_entry'],
  ['bar_entry',    'bar_center'],

  // Center south: corr_C(0,0) drops to rec via south cross node
  ['corr_C',       'rec_entry'],      // direct south from main corridor center
  ['rec_entry',    'rec_center'],

  // Right south: cross_SR(20,-12) → gym_entry(14,-14) → gym_center(22,-18)
  ['cross_SR',     'gym_entry'],
  ['gym_entry',    'gym_center'],

  // Cross-south interconnect (bar ↔ rec ↔ gym at Z≈-14)
  ['bar_entry',    'rec_entry'],
  ['rec_entry',    'gym_entry'],

  // === STAIRCASE & MEZZANINE ===
  // Stairs bot at (35,-14): reachable from cross_SR and gym side
  ['cross_SR',     'stairs_bot'],
  ['gym_center',   'stairs_bot'],
  ['stairs_bot',   'stairs_top'],
  ['stairs_top',   'mezz_C'],

  // === GALLERY WING (inside campus, upper-left area) ===
  ['cross_NL',     'gallery_entry'],   // north from left cross corridor
  ['design_entry', 'gallery_entry'],   // from designer studio area
  ['gallery_entry','gallery_center'],  // enter gallery
];

// === BUILD GRAPH ===
var adjacency = {};
var waypointMap = {};

function buildGraph() {
  adjacency = {};
  waypointMap = {};
  CAMPUS_WAYPOINTS.forEach(function(wp) {
    adjacency[wp.id] = [];
    waypointMap[wp.id] = wp;
  });
  CAMPUS_CONNECTIONS.forEach(function(conn) {
    if (adjacency[conn[0]] && adjacency[conn[1]]) {
      adjacency[conn[0]].push(conn[1]);
      adjacency[conn[1]].push(conn[0]);
    }
  });
}
buildGraph();

// Find nearest waypoint to a world position
function nearestWaypoint(x, z) {
  var best = null, bestDist = Infinity;
  CAMPUS_WAYPOINTS.forEach(function(wp) {
    var dx = wp.x - x, dz = wp.z - z;
    var d = dx * dx + dz * dz;
    if (d < bestDist) { bestDist = d; best = wp.id; }
  });
  return best;
}

// BFS shortest path
function findPath(startId, endId) {
  if (startId === endId) return [startId];
  var visited = {};
  var queue = [[startId]];
  visited[startId] = true;
  while (queue.length > 0) {
    var path = queue.shift();
    var current = path[path.length - 1];
    var neighbors = adjacency[current] || [];
    for (var i = 0; i < neighbors.length; i++) {
      var next = neighbors[i];
      if (visited[next]) continue;
      var newPath = path.concat([next]);
      if (next === endId) return newPath;
      visited[next] = true;
      queue.push(newPath);
    }
  }
  return null;
}

// ==================== PUBLIC API ====================

export function getNavigationPath(fromX, fromZ, toX, toZ) {
  if (S.currentEnv !== 'campus') {
    return [{ x: toX, z: toZ }];
  }

  var startWP = nearestWaypoint(fromX, fromZ);
  var endWP = nearestWaypoint(toX, toZ);

  if (!startWP || !endWP || startWP === endWP) {
    return [{ x: toX, z: toZ }];
  }

  var wpPath = findPath(startWP, endWP);
  if (!wpPath || wpPath.length === 0) {
    return [{ x: toX, z: toZ }];
  }

  var result = [];
  // Skip first waypoint if very close to current position
  var firstWP = waypointMap[wpPath[0]];
  var dx0 = firstWP.x - fromX, dz0 = firstWP.z - fromZ;
  var startIdx = (dx0 * dx0 + dz0 * dz0 < 4) ? 1 : 0;

  for (var i = startIdx; i < wpPath.length; i++) {
    var wp = waypointMap[wpPath[i]];
    var point = { x: wp.x, z: wp.z };
    // Flag door waypoint
    if (wpPath[i] === 'mgr_doorstep') {
      point.triggerDoor = 'open';
    }
    result.push(point);
  }

  // Add final walk to exact destination if far from last waypoint
  var lastWP = waypointMap[wpPath[wpPath.length - 1]];
  var dxEnd = lastWP.x - toX, dzEnd = lastWP.z - toZ;
  if (dxEnd * dxEnd + dzEnd * dzEnd > 1) {
    result.push({ x: toX, z: toZ });
  }

  return result;
}
