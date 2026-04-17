import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'neon_strip',
  name: 'LED Neon Strip',
  category: 'lighting',
  icon: 'NS',
  gridW: 2, gridD: 1, height: 0.03,
  factory: function() {
    var g = new THREE.Group();

    var W = 2.0;
    var barH = 0.030;
    var barD = 0.030;

    // Aluminium channel body (housing for strip)
    var channel = new THREE.Mesh(
      new THREE.BoxGeometry(W, barH, barD),
      mat(0x888888, { roughness: 0.20, metalness: 0.75 })
    );
    channel.position.y = barH / 2;
    channel.castShadow = true;
    g.add(channel);

    // Neon diffuser bar (glowing blue, slightly protruding)
    var strip = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.02, barH * 0.45, barD * 0.55),
      mat(0x58a6ff, { emissive: 0x58a6ff, emissiveIntensity: 1.4, transparent: true, opacity: 0.92, roughness: 0.0 })
    );
    strip.position.set(0, barH * 0.7, barD * 0.25);
    g.add(strip);

    // End caps (chrome)
    [-W / 2, W / 2].forEach(function(x) {
      var cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, barH + 0.002, barD + 0.002),
        PAL.chrome()
      );
      cap.position.set(x, barH / 2, 0);
      g.add(cap);
    });

    // Mounting clip pair (evenly spaced, mid-strip)
    [-W * 0.30, W * 0.30].forEach(function(x) {
      var clipBody = new THREE.Mesh(
        new THREE.BoxGeometry(0.020, 0.025, 0.012),
        mat(0x555555, { roughness: 0.45, metalness: 0.50 })
      );
      clipBody.position.set(x, -0.008, -barD / 2 - 0.005);
      g.add(clipBody);

      // Screw hole indicator
      var screw = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.013, 8),
        mat(0x222222, { roughness: 0.50 })
      );
      screw.rotation.x = Math.PI / 2;
      screw.position.set(x, -0.008, -barD / 2 - 0.012);
      g.add(screw);
    });

    // Soft ambient glow blob (behind strip for wall bleed effect)
    var glow = new THREE.Mesh(
      new THREE.BoxGeometry(W + 0.10, barH * 2.5, 0.004),
      mat(0x3388ff, { transparent: true, opacity: 0.12, emissive: 0x3388ff, emissiveIntensity: 0.30, roughness: 0.0 })
    );
    glow.position.set(0, barH / 2, -barD / 2 - 0.002);
    g.add(glow);

    return g;
  }
};
