import * as THREE from 'three';

/**
 * Particle effects for AI City.
 * Industrial smoke, chimney steam, ambient dust.
 * Uses THREE.Points for minimal draw calls (1 per effect).
 * Target: 120fps — max 200 particles per emitter.
 */

const emitters = [];

/**
 * Create a smoke emitter at a position (e.g., factory chimney).
 * @param {THREE.Scene} scene
 * @param {THREE.Vector3} position - World position of the emitter
 * @param {Object} options
 * @param {number} options.count - Particle count (default 80)
 * @param {number} options.spread - Horizontal spread (default 1)
 * @param {number} options.height - Max rise height (default 8)
 * @param {number} options.speed - Rise speed (default 0.5)
 * @param {number} options.size - Particle size (default 0.4)
 * @param {number} options.color - Hex color (default 0x888888)
 * @param {number} options.opacity - Max opacity (default 0.3)
 * @returns {Object} Emitter handle for update/dispose
 */
export function createSmokeEmitter(scene, position, options) {
  const opts = Object.assign({
    count: 80,
    spread: 1,
    height: 8,
    speed: 0.5,
    size: 0.4,
    color: 0x888888,
    opacity: 0.3,
  }, options);

  const count = opts.count;
  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const lifetimes = new Float32Array(count);
  const maxLifetimes = new Float32Array(count);

  // Initialize particles
  for (let i = 0; i < count; i++) {
    resetParticle(i, positions, velocities, lifetimes, maxLifetimes, position, opts);
    // Stagger initial lifetimes so particles don't all spawn at once
    lifetimes[i] = Math.random() * maxLifetimes[i];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: opts.color,
    size: opts.size,
    transparent: true,
    opacity: opts.opacity,
    depthWrite: false,
    sizeAttenuation: true,
    fog: true,
  });

  const points = new THREE.Points(geometry, material);
  points.name = 'smoke-emitter';
  points.frustumCulled = true;
  scene.add(points);

  const emitter = {
    points,
    positions,
    velocities,
    lifetimes,
    maxLifetimes,
    origin: position.clone(),
    opts,
    active: true,
  };
  emitters.push(emitter);
  return emitter;
}

function resetParticle(i, positions, velocities, lifetimes, maxLifetimes, origin, opts) {
  const i3 = i * 3;
  positions[i3]     = origin.x + (Math.random() - 0.5) * opts.spread * 0.3;
  positions[i3 + 1] = origin.y;
  positions[i3 + 2] = origin.z + (Math.random() - 0.5) * opts.spread * 0.3;

  velocities[i3]     = (Math.random() - 0.5) * opts.spread * 0.1;
  velocities[i3 + 1] = opts.speed * (0.7 + Math.random() * 0.6);
  velocities[i3 + 2] = (Math.random() - 0.5) * opts.spread * 0.1;

  maxLifetimes[i] = opts.height / opts.speed * (0.8 + Math.random() * 0.4);
  lifetimes[i] = 0;
}

/**
 * Update all active smoke emitters. Call once per frame.
 * @param {number} dt - Delta time in seconds
 */
export function updateParticles(dt) {
  for (const emitter of emitters) {
    if (!emitter.active) continue;
    const { positions, velocities, lifetimes, maxLifetimes, origin, opts, points } = emitter;
    const count = lifetimes.length;
    const posAttr = points.geometry.getAttribute('position');

    for (let i = 0; i < count; i++) {
      lifetimes[i] += dt;
      if (lifetimes[i] >= maxLifetimes[i]) {
        resetParticle(i, positions, velocities, lifetimes, maxLifetimes, origin, opts);
        continue;
      }

      const i3 = i * 3;
      // Wind drift + rise
      positions[i3]     += velocities[i3] * dt;
      positions[i3 + 1] += velocities[i3 + 1] * dt;
      positions[i3 + 2] += velocities[i3 + 2] * dt;

      // Slow horizontal drift increases with height
      velocities[i3]     += (Math.random() - 0.5) * 0.02;
      velocities[i3 + 2] += (Math.random() - 0.5) * 0.02;
    }

    posAttr.needsUpdate = true;

    // Fade opacity based on average lifetime progress
    const avgProgress = lifetimes.reduce((s, l, i) => s + l / maxLifetimes[i], 0) / count;
    points.material.opacity = opts.opacity * (1 - avgProgress * 0.5);
  }
}

/**
 * Set emitter active/inactive.
 * @param {Object} emitter
 * @param {boolean} active
 */
export function setEmitterActive(emitter, active) {
  emitter.active = active;
  emitter.points.visible = active;
}

/**
 * Dispose a single emitter.
 * @param {Object} emitter
 * @param {THREE.Scene} scene
 */
export function disposeEmitter(emitter, scene) {
  scene.remove(emitter.points);
  emitter.points.geometry.dispose();
  emitter.points.material.dispose();
  const idx = emitters.indexOf(emitter);
  if (idx >= 0) emitters.splice(idx, 1);
}

/**
 * Dispose all emitters.
 * @param {THREE.Scene} scene
 */
export function disposeAllEmitters(scene) {
  while (emitters.length > 0) {
    disposeEmitter(emitters[0], scene);
  }
}

/**
 * Get active emitter count (for performance monitoring).
 * @returns {number}
 */
export function getEmitterCount() {
  return emitters.filter(e => e.active).length;
}
