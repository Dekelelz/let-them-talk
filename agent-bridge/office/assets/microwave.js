import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'microwave',
  name: 'Microwave',
  category: 'kitchen',
  icon: 'MW',
  gridW: 1, gridD: 1, height: 0.3,
  factory: function() {
    var g = new THREE.Group();

    // Main body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.30, 0.35),
      mat(0x111318, { roughness: 0.42, metalness: 0.18 })
    );
    body.position.y = 0.15;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Glass door panel (left portion of front)
    var glassDoor = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.24, 0.012),
      mat(0x1a2530, { transparent: true, opacity: 0.75, roughness: 0.12, metalness: 0.05 })
    );
    glassDoor.position.set(-0.07, 0.15, 0.182);
    g.add(glassDoor);

    // Glass door inner grill pattern (emissive dark mesh feel)
    var grill = new THREE.Mesh(
      new THREE.BoxGeometry(0.26, 0.20, 0.004),
      mat(0x0d1015, { roughness: 0.80 })
    );
    grill.position.set(-0.07, 0.15, 0.188);
    g.add(grill);

    // Door frame around glass
    var doorFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.26, 0.016),
      mat(0x1c1f26, { roughness: 0.50, metalness: 0.12 })
    );
    doorFrame.position.set(-0.07, 0.15, 0.179);
    g.add(doorFrame);

    // Control panel section (right side)
    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.26, 0.01),
      mat(0x16181e, { roughness: 0.50 })
    );
    panel.position.set(0.18, 0.15, 0.181);
    g.add(panel);

    // Small display screen
    var display = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.055, 0.008),
      mat(0x001a0a, { emissive: 0x00cc44, emissiveIntensity: 0.85, roughness: 0.1 })
    );
    display.position.set(0.175, 0.22, 0.189);
    g.add(display);

    // Control buttons (small grid — 3 rows x 2 cols)
    var btnMat = mat(0x2a2d35, { roughness: 0.60 });
    var btnGeo = new THREE.BoxGeometry(0.030, 0.024, 0.010);
    [0, 1, 2].forEach(function(row) {
      [0, 1].forEach(function(col) {
        var btn = new THREE.Mesh(btnGeo, btnMat);
        btn.position.set(0.155 + col * 0.038, 0.16 - row * 0.032, 0.189);
        g.add(btn);
      });
    });

    // Chrome side vent strips
    var ventMat = PAL.chromeBrushed();
    var ventGeo = new THREE.BoxGeometry(0.006, 0.22, 0.025);
    [-0.248, 0.248].forEach(function(x) {
      var vent = new THREE.Mesh(ventGeo, ventMat);
      vent.position.set(x, 0.15, 0);
      g.add(vent);
    });

    // Bottom feet
    var feetMat = mat(0x0a0a0a, { roughness: 0.90 });
    var feetGeo = new THREE.BoxGeometry(0.04, 0.014, 0.04);
    [[-0.20, 0.007, 0.14], [0.20, 0.007, 0.14], [-0.20, 0.007, -0.14], [0.20, 0.007, -0.14]].forEach(function(p) {
      var foot = new THREE.Mesh(feetGeo, feetMat);
      foot.position.set(p[0], p[1], p[2]);
      g.add(foot);
    });

    return g;
  }
};
