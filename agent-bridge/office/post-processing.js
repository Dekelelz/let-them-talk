import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { S } from './state.js';

// ============================================================
// POST-PROCESSING — bloom, tone mapping for cinematic visuals
// Makes neon signs glow, street lights bloom, windows shine
// ============================================================

var composer = null;
var bloomPass = null;

export function initPostProcessing() {
  if (!S.renderer || !S.scene || !S.camera) return null;

  var w = S.container.clientWidth;
  var h = S.container.clientHeight;

  composer = new EffectComposer(S.renderer);

  // Base render
  var renderPass = new RenderPass(S.scene, S.camera);
  composer.addPass(renderPass);

  // Bloom — makes emissive materials glow
  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    0.4,    // strength (subtle, not overpowering)
    0.6,    // radius (spread of glow)
    0.85    // threshold (only bright things bloom)
  );
  composer.addPass(bloomPass);

  // Output — handles tone mapping + color space
  var outputPass = new OutputPass();
  composer.addPass(outputPass);

  // Boost tone mapping for cinematic look
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 1.0;

  // Store reference
  S._composer = composer;
  S._bloomPass = bloomPass;

  return composer;
}

export function renderWithPostProcessing() {
  if (composer) {
    composer.render();
  } else {
    S.renderer.render(S.scene, S.camera);
  }
}

export function setBloomStrength(strength) {
  if (bloomPass) bloomPass.strength = strength;
}

export function setBloomThreshold(threshold) {
  if (bloomPass) bloomPass.threshold = threshold;
}

export function resizePostProcessing(w, h) {
  if (composer) composer.setSize(w, h);
}

export function disposePostProcessing() {
  if (composer) {
    composer.dispose();
    composer = null;
    bloomPass = null;
    S._composer = null;
    S._bloomPass = null;
  }
}

export function getComposer() { return composer; }
