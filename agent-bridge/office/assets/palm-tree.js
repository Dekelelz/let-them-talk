import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'palm_tree',
  name: 'Palm Tree',
  category: 'nature',
  icon: 'PT',
  gridW: 1, gridD: 1, height: 3.0,
  factory: function() {
    var g = new THREE.Group();

    // Planter — dark round pot
    var planter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.22, 0.36, 18),
      mat(0x1e2028, { roughness: 0.90 })
    );
    planter.position.y = 0.18;
    planter.castShadow = true;
    planter.receiveShadow = true;
    g.add(planter);

    // Rim
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.285, 0.022, 8, 28),
      mat(0x13151a, { roughness: 0.85 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.357;
    g.add(rim);

    // Soil
    var soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.26, 0.26, 0.018, 18),
      mat(0x1a1510, { roughness: 0.99 })
    );
    soil.position.y = 0.370;
    g.add(soil);

    // Trunk — slim, slight taper
    var trunkMat = mat(0x5a4020, { roughness: 0.85 });
    var trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.060, 2.55, 10),
      trunkMat
    );
    trunk.position.y = 1.655;
    trunk.rotation.z = 0.05; // slight lean
    trunk.castShadow = true;
    g.add(trunk);

    // Trunk ring details (bark texture rings)
    for (var i = 0; i < 5; i++) {
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.052 - i * 0.002, 0.008, 6, 16),
        mat(0x3d2a10, { roughness: 0.90 })
      );
      ring.position.y = 0.55 + i * 0.45;
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
    }

    // Palm frond fan — 6 elongated leaves fanning out
    var leafMat = mat(0x2a7a40, { roughness: 0.78, side: THREE.DoubleSide });
    var frondCount = 6;
    for (var j = 0; j < frondCount; j++) {
      var angle = (j / frondCount) * Math.PI * 2;
      var frond = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.60, 0.018),
        leafMat
      );
      frond.position.set(
        Math.sin(angle) * 0.38,
        2.88,
        Math.cos(angle) * 0.38
      );
      frond.rotation.y = -angle;
      frond.rotation.z = 0.55; // droop outward
      frond.castShadow = true;
      g.add(frond);

      // Frond tip (narrower end piece)
      var tip = new THREE.Mesh(
        new THREE.ConeGeometry(0.025, 0.22, 6),
        leafMat
      );
      tip.position.set(
        Math.sin(angle) * 0.68,
        2.72,
        Math.cos(angle) * 0.68
      );
      tip.rotation.y = -angle;
      tip.rotation.z = Math.PI / 2 - 0.2;
      tip.castShadow = true;
      g.add(tip);
    }

    // Crown center sphere
    var crown = new THREE.Mesh(
      new THREE.SphereGeometry(0.09, 12, 10),
      mat(0x1e5c30, { roughness: 0.80 })
    );
    crown.position.y = 2.93;
    crown.castShadow = true;
    g.add(crown);

    return g;
  }
};
