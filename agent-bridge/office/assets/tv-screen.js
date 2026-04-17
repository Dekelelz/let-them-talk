import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'tv_screen',
  name: 'TV Screen',
  category: 'tech',
  icon: 'TV',
  gridW: 2, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    var W = 2.0;
    var H = 1.2;
    var bezelThick = 0.028;

    // Outer bezel — ultra-thin glossy black
    var bezel = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, bezelThick),
      mat(0x080808, { roughness: 0.15, metalness: 0.25 })
    );
    bezel.position.y = H / 2 + 0.05;
    bezel.castShadow = true;
    g.add(bezel);

    // Screen panel — large emissive dark blue
    var screen = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.04, H - 0.04, 0.008),
      mat(0x040c1a, { emissive: 0x051530, emissiveIntensity: 0.65, roughness: 0.02 })
    );
    screen.position.set(0, H / 2 + 0.05, bezelThick / 2 + 0.001);
    g.add(screen);

    // Subtle scan-line overlay strip (lower third highlight)
    var scanStrip = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.06, H * 0.28, 0.002),
      mat(0x0a1f3a, { transparent: true, opacity: 0.18, roughness: 0.0 })
    );
    scanStrip.position.set(0, 0.22, bezelThick / 2 + 0.009);
    g.add(scanStrip);

    // Logo dot center-bottom bezel
    var logo = new THREE.Mesh(
      new THREE.SphereGeometry(0.009, 10, 10),
      mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.2 })
    );
    logo.position.set(0, 0.022, bezelThick / 2 + 0.012);
    g.add(logo);

    // Wall-mount bracket plate (rear center)
    var mountPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.22, 0.015),
      PAL.chromeBrushed()
    );
    mountPlate.position.set(0, H / 2 + 0.05, -bezelThick / 2 - 0.006);
    g.add(mountPlate);

    // Mount screw knobs (4 corners of bracket)
    [[-0.06, 0.07], [0.06, 0.07], [-0.06, -0.07], [0.06, -0.07]].forEach(function(pos) {
      var screw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.014, 8),
        PAL.chrome()
      );
      screw.rotation.x = Math.PI / 2;
      screw.position.set(pos[0], H / 2 + 0.05 + pos[1], -bezelThick / 2 - 0.015);
      g.add(screw);
    });

    // Thin chrome edge trim (bottom edge)
    var trim = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.01, 0.010, bezelThick + 0.005),
      PAL.chrome()
    );
    trim.position.y = 0.042;
    g.add(trim);

    return g;
  }
};
