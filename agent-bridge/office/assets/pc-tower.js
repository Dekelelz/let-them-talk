import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'pc_tower',
  name: 'PC Tower',
  category: 'tech',
  icon: 'PC',
  gridW: 1, gridD: 1, height: 0.45,
  factory: function() {
    var g = new THREE.Group();

    var H = 0.45;
    var W = 0.22;
    var D = 0.40;

    // Main case body — matte black
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(W, H, D),
      mat(0x0d0d0f, { roughness: 0.50, metalness: 0.18 })
    );
    body.position.y = H / 2;
    body.castShadow = true;
    g.add(body);

    // RGB tempered glass side panel (right side)
    var glass = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, H - 0.02, D - 0.02),
      mat(0x0a1a3a, { transparent: true, opacity: 0.55, roughness: 0.02, emissive: 0x1144cc, emissiveIntensity: 0.45 })
    );
    glass.position.set(W / 2 + 0.003, H / 2, 0);
    g.add(glass);

    // Internal RGB strip glow bar (seen through glass)
    var rgbStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, H * 0.80, 0.018),
      mat(0x3355ff, { emissive: 0x2244ff, emissiveIntensity: 1.2 })
    );
    rgbStrip.position.set(W / 2 - 0.025, H / 2, 0);
    g.add(rgbStrip);

    // Front panel — slightly different texture
    var front = new THREE.Mesh(
      new THREE.BoxGeometry(W - 0.01, H - 0.01, 0.012),
      mat(0x141418, { roughness: 0.38, metalness: 0.22 })
    );
    front.position.set(0, H / 2, D / 2 + 0.001);
    front.castShadow = true;
    g.add(front);

    // Power button (front top)
    var pwrBtn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.006, 16),
      mat(0x555577, { roughness: 0.30, metalness: 0.60 })
    );
    pwrBtn.rotation.x = Math.PI / 2;
    pwrBtn.position.set(-0.04, H - 0.055, D / 2 + 0.007);
    g.add(pwrBtn);

    // Power LED ring around button
    var pwrLED = new THREE.Mesh(
      new THREE.TorusGeometry(0.013, 0.003, 8, 16),
      mat(0x00aaff, { emissive: 0x0088ff, emissiveIntensity: 0.9 })
    );
    pwrLED.rotation.x = Math.PI / 2;
    pwrLED.position.set(-0.04, H - 0.055, D / 2 + 0.009);
    g.add(pwrLED);

    // USB ports strip (front)
    var usbBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.018, 0.005),
      mat(0x222222, { roughness: 0.70 })
    );
    usbBar.position.set(0.03, H - 0.065, D / 2 + 0.008);
    g.add(usbBar);

    // Bottom feet
    [-W * 0.35, W * 0.35].forEach(function(xOff) {
      [-D * 0.38, D * 0.38].forEach(function(zOff) {
        var foot = new THREE.Mesh(
          new THREE.BoxGeometry(0.025, 0.012, 0.025),
          PAL.rubber()
        );
        foot.position.set(xOff, 0.006, zOff);
        g.add(foot);
      });
    });

    return g;
  }
};
