import * as THREE from 'three';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { SpectatorCamera } from './spectator-camera.js';
import { S } from './state.js';

export function initScene() {
  S.container = document.getElementById('office-3d-container');
  if (!S.container) return false;

  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0x0d1117);
  S.scene.fog = new THREE.Fog(0x0d1117, 25, 55);

  S.camera = new THREE.PerspectiveCamera(50, S.container.clientWidth / S.container.clientHeight, 0.1, 200);
  S.camera.position.set(0, 12, 16);
  S.camera.lookAt(0, 0, 0);

  S.renderer = new THREE.WebGLRenderer({ antialias: true });
  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  S.renderer.setSize(S.container.clientWidth, S.container.clientHeight);
  S.renderer.shadowMap.enabled = true;
  S.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  S.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  S.renderer.toneMappingExposure = 1.2;
  S.container.appendChild(S.renderer.domElement);

  S.cssRenderer = new CSS2DRenderer();
  S.cssRenderer.setSize(S.container.clientWidth, S.container.clientHeight);
  S.cssRenderer.domElement.style.position = 'absolute';
  S.cssRenderer.domElement.style.top = '0';
  S.cssRenderer.domElement.style.left = '0';
  S.cssRenderer.domElement.style.pointerEvents = 'none';
  S.container.appendChild(S.cssRenderer.domElement);

  // Spectator camera — free movement, no limits
  S.controls = new SpectatorCamera(S.camera, S.renderer.domElement);

  // Lighting
  var ambient = new THREE.AmbientLight(0xffffff, 0.5);
  S.scene.add(ambient);

  var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
  dirLight.position.set(8, 12, 8);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 2048;
  dirLight.shadow.mapSize.height = 2048;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 30;
  dirLight.shadow.bias = -0.001;
  S.scene.add(dirLight);

  var fillLight = new THREE.DirectionalLight(0x6c8aff, 0.15);
  fillLight.position.set(-5, 8, -5);
  S.scene.add(fillLight);

  S.clock = new THREE.Clock();

  S.resizeObserver = new ResizeObserver(function() {
    if (!S.container || !S.running) return;
    var w = S.container.clientWidth;
    var h = S.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
    S.cssRenderer.setSize(w, h);
  });
  S.resizeObserver.observe(S.container);

  return true;
}
