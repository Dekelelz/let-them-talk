import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'filing-cabinet',
  name: 'Filing Cabinet',
  category: 'office',
  icon: 'FC',
  gridW: 1, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    // Main body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.2, 0.5),
      mat(0x1e2128, { roughness: 0.55, metalness: 0.20 })
    );
    body.position.y = 0.6;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Top cap
    var topCap = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.02, 0.52),
      mat(0x252830, { roughness: 0.4, metalness: 0.25 })
    );
    topCap.position.y = 1.21;
    topCap.castShadow = true;
    g.add(topCap);

    // 3 drawer faces
    var drawerMat = mat(0x252830, { roughness: 0.45, metalness: 0.22 });
    var handleMat = PAL.chrome();
    var drawerHeights = [0.22, 0.62, 1.02];

    drawerHeights.forEach(function(y) {
      // Drawer face panel
      var drawer = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.34, 0.01),
        drawerMat
      );
      drawer.position.set(0, y, 0.256);
      g.add(drawer);

      // Drawer inset shadow line (top)
      var topLine = new THREE.Mesh(
        new THREE.BoxGeometry(0.46, 0.008, 0.012),
        mat(0x111318, { roughness: 0.8 })
      );
      topLine.position.set(0, y + 0.171, 0.257);
      g.add(topLine);

      // Drawer inset shadow line (bottom)
      var botLine = topLine.clone();
      botLine.position.y = y - 0.171;
      g.add(botLine);

      // Handle bar
      var handle = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.022, 0.022),
        handleMat
      );
      handle.position.set(0, y, 0.268);
      handle.castShadow = true;
      g.add(handle);

      // Handle end brackets
      var bracket = new THREE.Mesh(
        new THREE.BoxGeometry(0.022, 0.04, 0.025),
        handleMat
      );
      bracket.position.set(-0.11, y - 0.01, 0.266);
      g.add(bracket);
      var bracketR = bracket.clone();
      bracketR.position.x = 0.11;
      g.add(bracketR);
    });

    // Lock cylinder on top drawer
    var lock = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.015, 12),
      mat(0xb8860b, { roughness: 0.3, metalness: 0.8 })
    );
    lock.rotation.x = Math.PI / 2;
    lock.position.set(0.14, 1.02, 0.258);
    g.add(lock);

    // Side ventilation slots (decorative lines)
    var slotMat = mat(0x17191f, { roughness: 0.8 });
    [0.2, 0.6, 1.0].forEach(function(y) {
      var slot = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.04, 0.42), slotMat);
      slot.position.set(-0.252, y, 0);
      g.add(slot);
      var slotR = slot.clone();
      slotR.position.x = 0.252;
      g.add(slotR);
    });

    // Small base feet
    var footMat = mat(0x111111, { roughness: 0.9 });
    var footGeo = new THREE.BoxGeometry(0.08, 0.04, 0.08);
    [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]].forEach(function(p) {
      var foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(p[0], 0.02, p[1]);
      g.add(foot);
    });

    return g;
  }
};
