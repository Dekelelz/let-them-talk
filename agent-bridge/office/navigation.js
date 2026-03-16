import { S } from './state.js';

// ============================================================
// NAVIGATION SYSTEM — Waypoint graph pathfinding
// Agents walk along connected waypoints to avoid walls/objects
// ============================================================

// Manager office geometry reference:
// Office group at (12, 5), size 8x7, walls at:
//   Front (door): z = 5 - 3.5 = 1.5   (door at center x=12)
//   Back:         z = 5 + 3.5 = 8.5
//   Left:         x = 12 - 4  = 8
//   Right:        x = 12 + 4  = 16
// Glass partition at z = -7 (between workspace and rec)
// Glass partition at x = -8 (between designer and main)

var CAMPUS_WAYPOINTS = [
  // === LOBBY / ENTRANCE ===
  { id: 'spawn',         x: 0,     z: 14 },
  { id: 'lobby',         x: 0,     z: 10 },
  { id: 'lobby_left',    x: -6,    z: 10 },
  { id: 'lobby_right',   x: 6,     z: 10 },

  // === MAIN CORRIDOR (runs along z=6, above workspace) ===
  { id: 'corr_L',        x: -8,    z: 7 },
  { id: 'corr_CL',       x: -3,    z: 7 },
  { id: 'corr_C',        x: 0,     z: 7 },
  { id: 'corr_CR',       x: 3,     z: 7 },
  { id: 'corr_R',        x: 7,     z: 7 },

  // === WORKSPACE ZONE (center area, between glass partitions) ===
  { id: 'work_N',        x: 0,     z: 4 },    // north end
  { id: 'work_NW',       x: -5,    z: 4 },
  { id: 'work_NE',       x: 5,     z: 4 },
  { id: 'work_W',        x: -5,    z: 0 },
  { id: 'work_C',        x: 0,     z: 0 },
  { id: 'work_E',        x: 5,     z: 0 },
  { id: 'work_SW',       x: -5,    z: -3 },
  { id: 'work_S',        x: 0,     z: -5 },
  { id: 'work_SE',       x: 5,     z: -3 },

  // === DESIGNER WING (left of glass partition x=-8) ===
  { id: 'design_gate',   x: -8,    z: 3 },   // gap in partition
  { id: 'design_N',      x: -12,   z: 3 },
  { id: 'design_C',      x: -12.5, z: 0 },
  { id: 'design_S',      x: -12,   z: -3 },

  // === MANAGER OFFICE (right side, enclosed glass room) ===
  // Office walls: left x=8, right x=16, front z=1.5, back z=8.5
  // Door at front wall center (x=12, z=1.5)
  // Path must go AROUND the left-front corner, then to door from outside
  { id: 'mgr_hallway',   x: 7,     z: 3 },    // south of corridor, OUTSIDE left wall (x<8)
  { id: 'mgr_corner',    x: 7,     z: 0 },    // past the front-left corner (x<8, z<1.5)
  { id: 'mgr_outside',   x: 12,    z: 0 },    // in front of door, OUTSIDE front wall (z<1.5)
  { id: 'mgr_doorstep',  x: 12,    z: 1.5 },  // at the door threshold (triggers door open)
  { id: 'mgr_entry',     x: 12,    z: 3 },    // just inside the door
  { id: 'mgr_center',    x: 12,    z: 5 },    // middle of office
  { id: 'mgr_desk',      x: 12,    z: 7 },    // at the desk/chair

  // === BACK ZONE CORRIDOR (runs along z=-7 to z=-8, south of glass partition) ===
  { id: 'back_gate',     x: 0,     z: -6.5 },  // gap in glass partition
  { id: 'back_L',        x: -8,    z: -8 },
  { id: 'back_C',        x: 0,     z: -8 },
  { id: 'back_R',        x: 8,     z: -8 },

  // === BAR (back left) ===
  { id: 'bar_entry',     x: -10,   z: -10 },
  { id: 'bar_center',    x: -14,   z: -12 },

  // === REC CENTER (back center) ===
  { id: 'rec_entry',     x: 0,     z: -10 },
  { id: 'rec_center',    x: 0,     z: -12 },

  // === GYM (back right) ===
  { id: 'gym_entry',     x: 10,    z: -10 },
  { id: 'gym_center',    x: 14,    z: -12 },

  // === MEZZANINE / STAIRS ===
  { id: 'stairs_bot',    x: 20,    z: -5 },
  { id: 'stairs_top',    x: 20,    z: -8 },
  { id: 'mezz_C',        x: 0,     z: -13 },

  // === REST / DRESSING (right wing, for old office compat) ===
  { id: 'rest_entry',    x: 7.5,   z: -5.5 },
  { id: 'dress_entry',   x: 7.5,   z: -1.5 },
];

var CAMPUS_CONNECTIONS = [
  // Lobby connections
  ['spawn', 'lobby'],
  ['lobby', 'lobby_left'],
  ['lobby', 'lobby_right'],
  ['lobby', 'corr_C'],
  ['lobby_left', 'corr_L'],
  ['lobby_right', 'corr_R'],

  // Main corridor (horizontal)
  ['corr_L', 'corr_CL'],
  ['corr_CL', 'corr_C'],
  ['corr_C', 'corr_CR'],
  ['corr_CR', 'corr_R'],

  // Corridor → workspace
  ['corr_C', 'work_N'],
  ['corr_CL', 'work_NW'],
  ['corr_CR', 'work_NE'],

  // Workspace grid
  ['work_N', 'work_NW'],
  ['work_N', 'work_NE'],
  ['work_N', 'work_C'],
  ['work_NW', 'work_W'],
  ['work_NE', 'work_E'],
  ['work_W', 'work_C'],
  ['work_C', 'work_E'],
  ['work_W', 'work_SW'],
  ['work_C', 'work_S'],
  ['work_E', 'work_SE'],
  ['work_SW', 'work_S'],
  ['work_S', 'work_SE'],

  // Designer wing (through gap in glass partition)
  ['work_NW', 'design_gate'],
  ['corr_L', 'design_gate'],
  ['design_gate', 'design_N'],
  ['design_N', 'design_C'],
  ['design_C', 'design_S'],

  // Manager office — path goes AROUND the corner then through door
  // corr_R(7,7) → mgr_hallway(7,3) → mgr_corner(7,0) → mgr_outside(12,0) → door → inside
  ['corr_R', 'mgr_hallway'],           // walk south, outside left wall (x=7 < wall x=8)
  ['mgr_hallway', 'mgr_corner'],       // walk further south past front-left corner (z=0 < wall z=1.5)
  ['mgr_corner', 'mgr_outside'],       // walk east to front of door (z=0, safely below front wall z=1.5)
  ['mgr_outside', 'mgr_doorstep'],     // step to door threshold (triggers open)
  ['mgr_doorstep', 'mgr_entry'],       // walk through open door into office
  ['mgr_entry', 'mgr_center'],         // walk deeper inside
  ['mgr_center', 'mgr_desk'],          // walk to desk

  // Workspace → back zone (through gap in glass partition at z=-7)
  ['work_S', 'back_gate'],
  ['back_gate', 'back_C'],

  // Back corridor
  ['back_L', 'back_C'],
  ['back_C', 'back_R'],
  ['work_SW', 'back_L'],
  ['work_SE', 'back_R'],

  // Back zones
  ['back_L', 'bar_entry'],
  ['bar_entry', 'bar_center'],
  ['back_C', 'rec_entry'],
  ['rec_entry', 'rec_center'],
  ['back_R', 'gym_entry'],
  ['gym_entry', 'gym_center'],

  // Stairs / mezzanine
  ['back_R', 'stairs_bot'],
  ['stairs_bot', 'stairs_top'],
  ['stairs_top', 'mezz_C'],

  // Rest/dressing (legacy)
  ['work_SE', 'rest_entry'],
  ['work_E', 'dress_entry'],
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
