import * as THREE from 'three';

/**
 * InstancedMesh pool manager for city-scale rendering.
 * Groups identical geometries into single draw calls.
 * Target: 120fps with 500+ buildings via minimal draw calls.
 */

const pools = new Map(); // key -> { mesh, count, maxCount, dummy }

const _dummy = new THREE.Object3D();

/**
 * Create or get an instanced mesh pool.
 * @param {string} key - Unique pool identifier (e.g. 'building-office', 'tree-pine')
 * @param {THREE.BufferGeometry} geometry - Shared geometry for all instances
 * @param {THREE.Material} material - Shared material for all instances
 * @param {number} maxCount - Maximum number of instances in pool
 * @param {THREE.Scene} scene - Scene to add the mesh to
 * @returns {{ mesh: THREE.InstancedMesh, key: string }}
 */
export function createPool(key, geometry, material, maxCount, scene) {
  if (pools.has(key)) return pools.get(key);

  const mesh = new THREE.InstancedMesh(geometry, material, maxCount);
  mesh.count = 0; // Start with 0 visible instances
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = true;
  mesh.name = 'pool-' + key;

  // Enable per-instance colors
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(maxCount * 3), 3
  );

  scene.add(mesh);
  const pool = { mesh, count: 0, maxCount, key };
  pools.set(key, pool);
  return pool;
}

/**
 * Add an instance to a pool.
 * @param {string} key - Pool identifier
 * @param {THREE.Vector3} position - World position
 * @param {THREE.Euler|null} rotation - Rotation (optional)
 * @param {THREE.Vector3|null} scale - Scale (optional, defaults to 1,1,1)
 * @param {THREE.Color|null} color - Per-instance color (optional)
 * @returns {number} Instance index, or -1 if pool is full
 */
export function addInstance(key, position, rotation, scale, color) {
  const pool = pools.get(key);
  if (!pool) return -1;
  if (pool.count >= pool.maxCount) return -1;

  const idx = pool.count;

  _dummy.position.copy(position);
  if (rotation) _dummy.rotation.copy(rotation);
  else _dummy.rotation.set(0, 0, 0);
  if (scale) _dummy.scale.copy(scale);
  else _dummy.scale.set(1, 1, 1);
  _dummy.updateMatrix();

  pool.mesh.setMatrixAt(idx, _dummy.matrix);
  if (color) pool.mesh.setColorAt(idx, color);

  pool.count++;
  pool.mesh.count = pool.count;
  pool.mesh.instanceMatrix.needsUpdate = true;
  if (color) pool.mesh.instanceColor.needsUpdate = true;

  return idx;
}

/**
 * Update an existing instance's transform.
 * @param {string} key - Pool identifier
 * @param {number} index - Instance index
 * @param {THREE.Vector3} position
 * @param {THREE.Euler|null} rotation
 * @param {THREE.Vector3|null} scale
 */
export function updateInstance(key, index, position, rotation, scale) {
  const pool = pools.get(key);
  if (!pool || index < 0 || index >= pool.count) return;

  _dummy.position.copy(position);
  if (rotation) _dummy.rotation.copy(rotation);
  else _dummy.rotation.set(0, 0, 0);
  if (scale) _dummy.scale.copy(scale);
  else _dummy.scale.set(1, 1, 1);
  _dummy.updateMatrix();

  pool.mesh.setMatrixAt(index, _dummy.matrix);
  pool.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Update an instance's color.
 * @param {string} key - Pool identifier
 * @param {number} index - Instance index
 * @param {THREE.Color} color
 */
export function updateInstanceColor(key, index, color) {
  const pool = pools.get(key);
  if (!pool || index < 0 || index >= pool.count) return;
  pool.mesh.setColorAt(index, color);
  pool.mesh.instanceColor.needsUpdate = true;
}

/**
 * Clear all instances in a pool (reset count to 0).
 * @param {string} key - Pool identifier
 */
export function clearPool(key) {
  const pool = pools.get(key);
  if (!pool) return;
  pool.count = 0;
  pool.mesh.count = 0;
  pool.mesh.instanceMatrix.needsUpdate = true;
}

/**
 * Remove a pool entirely, disposing geometry/material.
 * @param {string} key - Pool identifier
 * @param {THREE.Scene} scene - Scene to remove from
 */
export function disposePool(key, scene) {
  const pool = pools.get(key);
  if (!pool) return;
  scene.remove(pool.mesh);
  pool.mesh.geometry.dispose();
  if (pool.mesh.material.dispose) pool.mesh.material.dispose();
  pool.mesh.dispose();
  pools.delete(key);
}

/**
 * Get pool stats for performance monitoring.
 * @returns {Array<{ key: string, count: number, maxCount: number }>}
 */
export function getPoolStats() {
  const stats = [];
  for (const [key, pool] of pools) {
    stats.push({ key, count: pool.count, maxCount: pool.maxCount });
  }
  return stats;
}

/**
 * Dispose all pools.
 * @param {THREE.Scene} scene
 */
export function disposeAllPools(scene) {
  for (const key of pools.keys()) {
    disposePool(key, scene);
  }
}
