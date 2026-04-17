import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'printer',
  name: 'Printer',
  category: 'office',
  icon: 'Pr',
  gridW: 1, gridD: 1, height: 0.4,
  factory: function() {
    var g = new THREE.Group();

    var bodyMat = mat(0x1e2128, { roughness: 0.50, metalness: 0.12 });
    var accentMat = mat(0x252830, { roughness: 0.45, metalness: 0.10 });

    // Main body block
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.32, 0.5),
      bodyMat
    );
    body.position.y = 0.2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Top scanner lid (slightly lighter)
    var lid = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.055, 0.5),
      accentMat
    );
    lid.position.y = 0.388;
    lid.castShadow = true;
    g.add(lid);

    // Scanner glass on top
    var scanGlass = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.01, 0.44),
      mat(0x445566, { transparent: true, opacity: 0.55, roughness: 0.10 })
    );
    scanGlass.position.y = 0.418;
    g.add(scanGlass);

    // Paper output tray (front, slanted slot)
    var outTray = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.012, 0.22),
      accentMat
    );
    outTray.rotation.x = -0.22;
    outTray.position.set(0, 0.305, 0.255);
    g.add(outTray);

    // Paper input tray (slightly open slot at back)
    var inTray = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.012, 0.18),
      accentMat
    );
    inTray.rotation.x = 0.2;
    inTray.position.set(0, 0.355, -0.23);
    g.add(inTray);

    // Front control panel strip
    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.055, 0.012),
      mat(0x111318, { roughness: 0.4 })
    );
    panel.position.set(0, 0.32, 0.256);
    g.add(panel);

    // Small LED indicator light (green)
    var led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 8),
      mat(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.8 })
    );
    led.position.set(0.22, 0.325, 0.258);
    g.add(led);

    // Power button
    var btn = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.01, 0.008, 10),
      mat(0x444444, { roughness: 0.6 })
    );
    btn.rotation.x = Math.PI / 2;
    btn.position.set(0.18, 0.322, 0.258);
    g.add(btn);

    // Brand label strip
    var label = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.025, 0.008),
      mat(0x111111, { roughness: 0.7 })
    );
    label.position.set(-0.12, 0.322, 0.257);
    g.add(label);

    // USB/port strip on right side
    var portStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.025, 0.05),
      mat(0x111111, { roughness: 0.7 })
    );
    portStrip.position.set(0.307, 0.20, 0.1);
    g.add(portStrip);

    // 4 rubber feet
    var footMat = mat(0x111111, { roughness: 0.95 });
    var footGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8);
    [[-0.24, -0.21], [0.24, -0.21], [-0.24, 0.21], [0.24, 0.21]].forEach(function(p) {
      var foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(p[0], 0.006, p[1]);
      g.add(foot);
    });

    return g;
  }
};
