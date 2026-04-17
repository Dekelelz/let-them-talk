import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'coffee_machine',
  name: 'Coffee Machine',
  category: 'kitchen',
  icon: 'CM',
  gridW: 1, gridD: 1, height: 0.5,
  factory: function() {
    var g = new THREE.Group();

    // Main body — dark boxy form
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.42, 0.36),
      mat(0x111318, { roughness: 0.40, metalness: 0.20 })
    );
    body.position.y = 0.21;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Chrome top cap
    var topCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.40, 0.035, 0.36),
      PAL.chrome()
    );
    topCap.position.y = 0.435;
    topCap.castShadow = true;
    g.add(topCap);

    // Front face plate (slightly recessed dark panel)
    var faceplate = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.30, 0.01),
      mat(0x1a1c22, { roughness: 0.55, metalness: 0.10 })
    );
    faceplate.position.set(0, 0.24, 0.185);
    g.add(faceplate);

    // Small display screen (emissive blue)
    var screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.07, 0.008),
      mat(0x002244, { emissive: 0x004488, emissiveIntensity: 0.9, roughness: 0.1 })
    );
    screen.position.set(0.06, 0.32, 0.19);
    g.add(screen);

    // Group of 3 control buttons
    var btnMat = PAL.chrome();
    var btnGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.015, 10);
    [-0.07, 0, 0.07].forEach(function(x) {
      var btn = new THREE.Mesh(btnGeo, btnMat);
      btn.rotation.x = Math.PI / 2;
      btn.position.set(x, 0.20, 0.192);
      g.add(btn);
    });

    // Steam nozzle (chrome tube angled out)
    var nozzle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.014, 0.14, 8),
      PAL.chrome()
    );
    nozzle.rotation.z = -0.35;
    nozzle.position.set(-0.16, 0.32, 0.10);
    nozzle.castShadow = true;
    g.add(nozzle);

    // Nozzle tip cap
    var nozzleTip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.012, 0.022, 8),
      PAL.chromeBrushed()
    );
    nozzleTip.position.set(-0.205, 0.36, 0.10);
    nozzleTip.rotation.z = -0.35;
    g.add(nozzleTip);

    // Drip tray (chrome grill plate)
    var tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.014, 0.18),
      PAL.chromeBrushed()
    );
    tray.position.set(0, 0.048, 0.04);
    g.add(tray);

    // Water reservoir at back (dark translucent)
    var reservoir = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.28, 0.10),
      mat(0x1a2030, { transparent: true, opacity: 0.80, roughness: 0.25 })
    );
    reservoir.position.set(0.13, 0.28, -0.14);
    g.add(reservoir);

    return g;
  }
};
