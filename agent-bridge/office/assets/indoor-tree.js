import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'indoor_tree',
  name: 'Indoor Tree',
  category: 'nature',
  icon: 'IT',
  gridW: 1, gridD: 1, height: 3.5,
  factory: function() {
    var g = new THREE.Group();

    // Large planter (square, dark concrete)
    var planter = new THREE.Mesh(
      new THREE.BoxGeometry(0.72, 0.40, 0.72),
      mat(0x2e3038, { roughness: 0.88 })
    );
    planter.position.y = 0.20;
    planter.castShadow = true;
    planter.receiveShadow = true;
    g.add(planter);

    // Planter rim trim (gold strip)
    var rimTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.76, 0.03, 0.76),
      PAL.gold()
    );
    rimTop.position.y = 0.415;
    g.add(rimTop);

    // Soil
    var soil = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.025, 0.68),
      mat(0x1a1510, { roughness: 0.99 })
    );
    soil.position.y = 0.413;
    g.add(soil);

    // Trunk — lower
    var trunkMat = mat(0x3d2b12, { roughness: 0.80 });
    var trunkLow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.075, 0.095, 1.20, 10),
      trunkMat
    );
    trunkLow.position.y = 1.02;
    trunkLow.castShadow = true;
    g.add(trunkLow);

    // Trunk — upper (slims slightly)
    var trunkUp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.048, 0.075, 1.10, 10),
      trunkMat
    );
    trunkUp.position.y = 2.17;
    trunkUp.castShadow = true;
    g.add(trunkUp);

    // Canopy tier 1 — bottom, widest
    var canopy1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 14, 10),
      PAL.leaf()
    );
    canopy1.scale.set(1, 0.7, 1);
    canopy1.position.y = 2.65;
    canopy1.castShadow = true;
    g.add(canopy1);

    // Canopy tier 2 — middle
    var canopy2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.44, 14, 10),
      mat(0x226638, { roughness: 0.80 })
    );
    canopy2.scale.set(1, 0.75, 1);
    canopy2.position.y = 3.05;
    canopy2.castShadow = true;
    g.add(canopy2);

    // Canopy tier 3 — top, smallest, pointy
    var canopy3 = new THREE.Mesh(
      new THREE.SphereGeometry(0.28, 12, 10),
      mat(0x1e5c30, { roughness: 0.82 })
    );
    canopy3.scale.set(1, 1.2, 1);
    canopy3.position.y = 3.42;
    canopy3.castShadow = true;
    g.add(canopy3);

    return g;
  }
};
