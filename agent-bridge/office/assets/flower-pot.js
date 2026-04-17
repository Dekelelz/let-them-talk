import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'flower_pot',
  name: 'Flower Pot',
  category: 'nature',
  icon: 'Fp',
  gridW: 1, gridD: 1, height: 0.35,
  factory: function() {
    var g = new THREE.Group();

    // Terracotta-style pot body (dark glaze version for premium look)
    var pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.060, 0.16, 16),
      mat(0x2a1a14, { roughness: 0.80 })
    );
    pot.position.y = 0.08;
    pot.castShadow = true;
    pot.receiveShadow = true;
    g.add(pot);

    // Pot rim
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.088, 0.012, 8, 20),
      mat(0x1a0f0a, { roughness: 0.75 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.158;
    g.add(rim);

    // Soil disc
    var soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.076, 0.076, 0.012, 16),
      mat(0x1a1510, { roughness: 0.99 })
    );
    soil.position.y = 0.168;
    g.add(soil);

    // Flower stems (3 stems)
    var stemMat = mat(0x1a4020, { roughness: 0.85 });
    var flowerColors = [0xd44080, 0xe8c030, 0x5888e0];

    for (var i = 0; i < 3; i++) {
      var spread = (i - 1) * 0.045;
      var stemHeight = 0.10 + i * 0.015;

      var stem = new THREE.Mesh(
        new THREE.CylinderGeometry(0.005, 0.007, stemHeight, 6),
        stemMat
      );
      stem.position.set(spread, 0.175 + stemHeight / 2, (i % 2) * 0.03 - 0.015);
      stem.castShadow = true;
      g.add(stem);

      // Flower head (small sphere)
      var flower = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 8),
        mat(flowerColors[i], { roughness: 0.75 })
      );
      flower.position.set(spread, 0.175 + stemHeight + 0.028, (i % 2) * 0.03 - 0.015);
      flower.castShadow = true;
      g.add(flower);

      // Flower center (yellow dot)
      var center = new THREE.Mesh(
        new THREE.SphereGeometry(0.011, 8, 8),
        mat(0xf0d040, { roughness: 0.70 })
      );
      center.position.set(spread, 0.175 + stemHeight + 0.048, (i % 2) * 0.03 - 0.015);
      g.add(center);
    }

    return g;
  }
};
