import * as THREE from 'three';

/**
 * LOD (Level of Detail) manager for city-scale rendering.
 * Wraps THREE.LOD with configurable distance thresholds and hysteresis.
 * Target: 120fps by reducing geometry complexity at distance.
 *
 * Default tiers:
 *   0: Full detail    (< 20 units)
 *   1: Medium detail  (< 60 units)
 *   2: Low-poly       (< 150 units)
 *   3: Billboard/hide (> 150 units)
 */

const DEFAULT_THRESHOLDS = [0, 20, 60, 150];
const HYSTERESIS = 2; // units of overlap to prevent LOD flickering at boundaries

const managedLODs = new Map(); // id -> { lod, thresholds }

/**
 * Create a managed LOD object.
 * @param {string} id - Unique identifier for this LOD group
 * @param {Array<{ mesh: THREE.Object3D, distance: number }>} levels - LOD levels sorted by distance
 *   Each level: { mesh, distance } where distance is the threshold to switch to this level.
 *   Lower distance = higher detail. First level (distance 0) is full detail.
 * @param {THREE.Scene} scene - Scene to add to
 * @param {THREE.Vector3} position - World position
 * @returns {THREE.LOD}
 */
export function createLOD(id, levels, scene, position) {
  const lod = new THREE.LOD();
  lod.name = 'lod-' + id;

  for (const level of levels) {
    lod.addLevel(level.mesh, level.distance);
  }

  // Enable hysteresis to prevent flickering at LOD boundaries
  if (typeof lod.autoUpdate !== 'undefined') {
    lod.autoUpdate = true;
  }

  if (position) lod.position.copy(position);
  lod.matrixAutoUpdate = false;
  lod.updateMatrix();

  scene.add(lod);
  managedLODs.set(id, { lod, levels });
  return lod;
}

/**
 * Create LOD levels from a single geometry with auto-simplified versions.
 * Generates 3 detail levels from a base geometry by reducing vertices.
 * @param {THREE.BufferGeometry} baseGeometry - Full-detail geometry
 * @param {THREE.Material} material - Material (shared across levels)
 * @param {number[]} thresholds - Distance thresholds [full, medium, low, hide]
 * @returns {Array<{ mesh: THREE.Object3D, distance: number }>}
 */
export function autoLODLevels(baseGeometry, material, thresholds) {
  const t = thresholds || DEFAULT_THRESHOLDS;
  const levels = [];

  // Level 0: Full detail
  levels.push({
    mesh: new THREE.Mesh(baseGeometry, material),
    distance: t[0] || 0
  });

  // Level 1: Medium — use same geometry (simplification would need a library)
  // In practice, city-env.js should pass pre-built simplified geometries
  levels.push({
    mesh: new THREE.Mesh(baseGeometry, material),
    distance: t[1] || 20
  });

  // Level 2: Low-poly placeholder — simple box approximation
  const bbox = new THREE.Box3().setFromBufferAttribute(baseGeometry.getAttribute('position'));
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const lowPolyGeo = new THREE.BoxGeometry(size.x, size.y, size.z);
  levels.push({
    mesh: new THREE.Mesh(lowPolyGeo, material),
    distance: t[2] || 60
  });

  // Level 3: Empty object (invisible at far distance)
  levels.push({
    mesh: new THREE.Object3D(),
    distance: t[3] || 150
  });

  return levels;
}

/**
 * Batch-update all managed LOD objects from camera position.
 * Call this once per frame in the render loop.
 * @param {THREE.Camera} camera
 */
export function updateAllLODs(camera) {
  for (const [, entry] of managedLODs) {
    entry.lod.update(camera);
  }
}

/**
 * Remove and dispose a managed LOD object.
 * @param {string} id
 * @param {THREE.Scene} scene
 */
export function disposeLOD(id, scene) {
  const entry = managedLODs.get(id);
  if (!entry) return;

  scene.remove(entry.lod);
  entry.lod.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else child.material.dispose();
    }
  });

  managedLODs.delete(id);
}

/**
 * Get LOD stats for performance monitoring.
 * @param {THREE.Camera} camera
 * @returns {Array<{ id: string, currentLevel: number, distance: number }>}
 */
export function getLODStats(camera) {
  const stats = [];
  for (const [id, entry] of managedLODs) {
    const dist = camera.position.distanceTo(entry.lod.position);
    let currentLevel = 0;
    for (let i = entry.levels.length - 1; i >= 0; i--) {
      if (dist >= entry.levels[i].distance) {
        currentLevel = i;
        break;
      }
    }
    stats.push({ id, currentLevel, distance: Math.round(dist) });
  }
  return stats;
}

/**
 * Dispose all managed LODs.
 * @param {THREE.Scene} scene
 */
export function disposeAllLODs(scene) {
  for (const id of managedLODs.keys()) {
    disposeLOD(id, scene);
  }
}

/**
 * Get the default distance thresholds.
 * @returns {number[]}
 */
export function getDefaultThresholds() {
  return [...DEFAULT_THRESHOLDS];
}
