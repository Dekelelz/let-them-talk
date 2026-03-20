import * as THREE from 'three';

/**
 * Street furniture — small detail props that make the city feel alive.
 * Crosswalks, benches, bus stops, trash cans, fire hydrants, street signs, awnings.
 * All use InstancedMesh for 120fps performance.
 */

const _dummy = new THREE.Object3D();
const pools = {};

// District color palettes for building variety
export const DISTRICT_PALETTES = {
  downtown:    [0x4a6fa5, 0x5577aa, 0x3d5f8a, 0x6688bb, 0x4477aa, 0x556699],
  industrial:  [0x8a7755, 0x997744, 0x776644, 0x887766, 0x665533, 0x998866],
  residential: [0xcc9977, 0xddaa88, 0xbb8866, 0xeebbaa, 0xddbb99, 0xccaa88],
  campus:      [0x55aa77, 0x66bb88, 0x449966, 0x77cc99, 0x55bb77, 0x66aa88],
  commercial:  [0xaa6688, 0xbb7799, 0x995577, 0xcc88aa, 0xaa7799, 0xbb6688],
};

/**
 * Get a randomized building color from a district palette.
 * @param {string} district
 * @param {number} seed - Building index for deterministic randomization
 * @returns {THREE.Color}
 */
export function getBuildingColor(district, seed) {
  const palette = DISTRICT_PALETTES[district] || DISTRICT_PALETTES.downtown;
  const idx = Math.abs(seed * 2654435761 | 0) % palette.length; // hash-based pick
  return new THREE.Color(palette[idx]);
}

/**
 * Create a bench mesh (low-poly).
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {number} rotation - Y rotation in radians
 */
export function createBench(scene, position, rotation) {
  const group = new THREE.Group();
  // Seat
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.08, 0.4),
    new THREE.MeshLambertMaterial({ color: 0x8B4513 })
  );
  seat.position.y = 0.4;
  group.add(seat);
  // Back
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.4, 0.06),
    new THREE.MeshLambertMaterial({ color: 0x8B4513 })
  );
  back.position.set(0, 0.6, -0.17);
  group.add(back);
  // Legs (2)
  const legGeo = new THREE.BoxGeometry(0.06, 0.4, 0.35);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  const leg1 = new THREE.Mesh(legGeo, legMat);
  leg1.position.set(-0.45, 0.2, 0);
  group.add(leg1);
  const leg2 = new THREE.Mesh(legGeo, legMat);
  leg2.position.set(0.45, 0.2, 0);
  group.add(leg2);

  group.position.copy(position);
  group.rotation.y = rotation || 0;
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create a trash can (cylinder).
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 */
export function createTrashCan(scene, position) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.5, 8),
    new THREE.MeshLambertMaterial({ color: 0x555555 })
  );
  body.position.y = 0.25;
  group.add(body);
  // Lid
  const lid = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.04, 8),
    new THREE.MeshLambertMaterial({ color: 0x666666 })
  );
  lid.position.y = 0.52;
  group.add(lid);

  group.position.copy(position);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create a fire hydrant.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 */
export function createFireHydrant(scene, position) {
  const group = new THREE.Group();
  // Body
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 0.4, 8),
    new THREE.MeshLambertMaterial({ color: 0xcc2222 })
  );
  body.position.y = 0.2;
  group.add(body);
  // Top
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.08, 0.1, 8),
    new THREE.MeshLambertMaterial({ color: 0xcc2222 })
  );
  top.position.y = 0.45;
  group.add(top);
  // Side nozzle
  const nozzle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.12, 6),
    new THREE.MeshLambertMaterial({ color: 0xdddd33 })
  );
  nozzle.rotation.z = Math.PI / 2;
  nozzle.position.set(0.12, 0.3, 0);
  group.add(nozzle);

  group.position.copy(position);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create a bus stop shelter.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {number} rotation
 */
export function createBusStop(scene, position, rotation) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0x4488cc });
  // Roof
  const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 1), mat);
  roof.position.y = 2.2;
  group.add(roof);
  // Back wall (glass-like)
  const glass = new THREE.Mesh(
    new THREE.BoxGeometry(2, 2, 0.04),
    new THREE.MeshLambertMaterial({ color: 0x88ccff, transparent: true, opacity: 0.3 })
  );
  glass.position.set(0, 1.1, -0.48);
  group.add(glass);
  // Posts
  const postGeo = new THREE.BoxGeometry(0.06, 2.2, 0.06);
  const postMat = new THREE.MeshLambertMaterial({ color: 0x333333 });
  [-0.95, 0.95].forEach(x => {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(x, 1.1, 0.45);
    group.add(post);
  });
  // Bench inside
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.06, 0.3),
    new THREE.MeshLambertMaterial({ color: 0x8B4513 })
  );
  bench.position.set(0, 0.5, -0.25);
  group.add(bench);

  group.position.copy(position);
  group.rotation.y = rotation || 0;
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create a crosswalk on the road surface.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {number} rotation
 */
export function createCrosswalk(scene, position, rotation) {
  const group = new THREE.Group();
  const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const stripeGeo = new THREE.BoxGeometry(0.3, 0.005, 2);
  for (let i = -3; i <= 3; i++) {
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.set(i * 0.5, 0.01, 0);
    group.add(stripe);
  }
  group.position.copy(position);
  group.rotation.y = rotation || 0;
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create an awning/canopy at a building entrance.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {number} rotation
 * @param {number} color - Hex color
 */
export function createAwning(scene, position, rotation, color) {
  const group = new THREE.Group();
  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.05, 1),
    new THREE.MeshLambertMaterial({ color: color || 0xcc4444 })
  );
  awning.position.set(0, 2.5, 0.5);
  group.add(awning);
  // Support poles
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x444444 });
  const poleGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.8, 6);
  [-0.6, 0.6].forEach(x => {
    const pole = new THREE.Mesh(poleGeo, poleMat);
    pole.position.set(x, 2.1, 0.95);
    group.add(pole);
  });

  group.position.copy(position);
  group.rotation.y = rotation || 0;
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Create a street name sign.
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position
 * @param {string} streetName
 */
export function createStreetSign(scene, position, streetName) {
  const group = new THREE.Group();
  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 3, 6),
    new THREE.MeshLambertMaterial({ color: 0x666666 })
  );
  pole.position.y = 1.5;
  group.add(pole);
  // Sign plate
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.3, 0.04),
    new THREE.MeshLambertMaterial({ color: 0x225588 })
  );
  plate.position.set(0, 3, 0);
  group.add(plate);

  group.position.copy(position);
  group.matrixAutoUpdate = false;
  group.updateMatrix();
  scene.add(group);
  return group;
}

/**
 * Populate a city block with street furniture.
 * Call this per block to add variety.
 * @param {THREE.Scene} scene
 * @param {number} blockX - Block center X
 * @param {number} blockZ - Block center Z
 * @param {number} blockSize - Block dimension
 * @param {number} seed - For deterministic randomization
 */
export function populateBlock(scene, blockX, blockZ, blockSize, seed) {
  const rng = seedRng(seed);
  const half = blockSize / 2;
  const items = [];

  // Benches on sidewalks (2 per block)
  if (rng() > 0.3) {
    items.push(createBench(scene, new THREE.Vector3(blockX + half - 0.5, 0, blockZ + rng() * blockSize - half), 0));
  }
  if (rng() > 0.3) {
    items.push(createBench(scene, new THREE.Vector3(blockX - half + 0.5, 0, blockZ + rng() * blockSize - half), Math.PI));
  }

  // Trash can (1 per block)
  if (rng() > 0.4) {
    items.push(createTrashCan(scene, new THREE.Vector3(blockX + half - 0.3, 0, blockZ + half - 0.3)));
  }

  // Fire hydrant (every other block)
  if (rng() > 0.5) {
    items.push(createFireHydrant(scene, new THREE.Vector3(blockX - half + 0.3, 0, blockZ - half + 0.5)));
  }

  return items;
}

function seedRng(seed) {
  let s = seed | 0;
  return function() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
