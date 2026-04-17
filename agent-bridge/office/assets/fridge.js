import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'fridge',
  name: 'Fridge',
  category: 'kitchen',
  icon: 'Fr',
  gridW: 1, gridD: 1, height: 1.8,
  factory: function() {
    var g = new THREE.Group();

    // Main body — dark brushed metallic
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 1.80, 0.60),
      mat(0x16181d, { roughness: 0.30, metalness: 0.45 })
    );
    body.position.y = 0.90;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Door seam line (horizontal divide — top fridge / bottom freezer)
    var seam = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.008, 0.012),
      mat(0x333333, { roughness: 0.60 })
    );
    seam.position.set(0, 1.10, 0.305);
    g.add(seam);

    // Top section door face (slightly lighter)
    var topDoor = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.68, 0.01),
      mat(0x1c1f26, { roughness: 0.28, metalness: 0.40 })
    );
    topDoor.position.set(0, 1.45, 0.305);
    g.add(topDoor);

    // Bottom freezer door face
    var botDoor = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.40, 0.01),
      mat(0x1c1f26, { roughness: 0.28, metalness: 0.40 })
    );
    botDoor.position.set(0, 0.62, 0.305);
    g.add(botDoor);

    // Chrome handle — top door
    var handleMat = PAL.chrome();
    var handleGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.42, 10);
    var handleTop = new THREE.Mesh(handleGeo, handleMat);
    handleTop.position.set(0.28, 1.50, 0.322);
    handleTop.castShadow = true;
    g.add(handleTop);

    // Handle mounts (top)
    var mountGeo = new THREE.BoxGeometry(0.022, 0.022, 0.025);
    [1.29, 1.71].forEach(function(y) {
      var mount = new THREE.Mesh(mountGeo, PAL.chromeBrushed());
      mount.position.set(0.28, y, 0.32);
      g.add(mount);
    });

    // Chrome handle — bottom freezer door
    var handleBot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.28, 10),
      handleMat
    );
    handleBot.position.set(0.28, 0.62, 0.322);
    handleBot.castShadow = true;
    g.add(handleBot);

    // Small LED status dot (green)
    var led = new THREE.Mesh(
      new THREE.SphereGeometry(0.012, 8, 8),
      mat(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 1.0 })
    );
    led.position.set(-0.24, 1.74, 0.308);
    g.add(led);

    // Thin ventilation grill at top back
    var vent = new THREE.Mesh(
      new THREE.BoxGeometry(0.60, 0.06, 0.50),
      mat(0x0e1014, { roughness: 0.70 })
    );
    vent.position.set(0, 1.78, -0.02);
    g.add(vent);

    // Small black feet
    var feetMat = mat(0x0a0a0a, { roughness: 0.90 });
    var feetGeo = new THREE.BoxGeometry(0.06, 0.03, 0.06);
    [[-0.28, 0.015, 0.24], [0.28, 0.015, 0.24], [-0.28, 0.015, -0.24], [0.28, 0.015, -0.24]].forEach(function(p) {
      var foot = new THREE.Mesh(feetGeo, feetMat);
      foot.position.set(p[0], p[1], p[2]);
      g.add(foot);
    });

    return g;
  }
};
