import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'hanging_plant',
  name: 'Hanging Plant',
  category: 'nature',
  icon: 'Hp',
  gridW: 1, gridD: 1, height: 3.0,
  factory: function() {
    var g = new THREE.Group();

    // Ceiling mount bracket
    var mount = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.06, 0.06),
      mat(0x111111, { roughness: 0.5, metalness: 0.6 })
    );
    mount.position.y = 3.0;
    g.add(mount);

    // Chain links (vertical rod segments)
    var chainMat = PAL.chromeBrushed();
    var chainSegments = 6;
    for (var i = 0; i < chainSegments; i++) {
      var link = new THREE.Mesh(
        new THREE.TorusGeometry(0.018, 0.006, 6, 10),
        chainMat
      );
      link.position.y = 2.92 - i * 0.145;
      link.rotation.x = (i % 2 === 0) ? 0 : Math.PI / 2;
      g.add(link);
    }

    // Hanging pot (round, dark clay)
    var pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.11, 0.22, 18),
      mat(0x1a1822, { roughness: 0.82 })
    );
    pot.position.y = 2.04;
    pot.castShadow = true;
    g.add(pot);

    // Pot rim
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.165, 0.016, 8, 24),
      mat(0x111018, { roughness: 0.78 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 2.148;
    g.add(rim);

    // Support wires (3 wires from rim to chain)
    var wireMat = mat(0x666666, { roughness: 0.40, metalness: 0.60 });
    for (var w = 0; w < 3; w++) {
      var wireAngle = (w / 3) * Math.PI * 2;
      var wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.76, 4),
        wireMat
      );
      wire.position.set(
        Math.sin(wireAngle) * 0.13,
        2.53,
        Math.cos(wireAngle) * 0.13
      );
      wire.rotation.z = Math.atan2(Math.sin(wireAngle) * 0.13, 0.38);
      wire.rotation.x = Math.atan2(Math.cos(wireAngle) * 0.13, 0.38);
      g.add(wire);
    }

    // Soil
    var soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.148, 0.148, 0.014, 18),
      mat(0x1a1510, { roughness: 0.99 })
    );
    soil.position.y = 2.155;
    g.add(soil);

    // Trailing leaf clusters (draping down)
    var leafColors = [0x2d8a4e, 0x226638, 0x1e5c30, 0x358050];
    var trailCount = 7;
    for (var t = 0; t < trailCount; t++) {
      var tAngle = (t / trailCount) * Math.PI * 2;
      var tRadius = 0.10 + (t % 3) * 0.04;
      var tDrop = t * 0.10;

      var leaf = new THREE.Mesh(
        new THREE.SphereGeometry(0.062, 8, 7),
        mat(leafColors[t % leafColors.length], { roughness: 0.82 })
      );
      leaf.scale.set(0.7, 0.5, 1.2);
      leaf.position.set(
        Math.sin(tAngle) * (tRadius + 0.05),
        1.95 - tDrop,
        Math.cos(tAngle) * (tRadius + 0.05)
      );
      leaf.castShadow = true;
      g.add(leaf);
    }

    // Main foliage cluster in pot
    var mainLeaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 12, 10),
      mat(0x2d8a4e, { roughness: 0.80 })
    );
    mainLeaf.scale.set(1, 0.65, 1);
    mainLeaf.position.y = 2.22;
    mainLeaf.castShadow = true;
    g.add(mainLeaf);

    return g;
  }
};
