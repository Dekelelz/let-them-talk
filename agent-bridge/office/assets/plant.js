import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'plant',
  name: 'Plant',
  category: 'nature',
  icon: 'Pl',
  gridW: 1, gridD: 1, height: 0.8,
  factory: function() {
    var g = new THREE.Group();

    // Concrete planter — cylindrical
    var planter = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.17, 0.30, 20),
      mat(0x3a3d44, { roughness: 0.90 })
    );
    planter.position.y = 0.15;
    planter.castShadow = true;
    planter.receiveShadow = true;
    g.add(planter);

    // Planter rim
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.22, 0.018, 8, 28),
      mat(0x2a2d33, { roughness: 0.85 })
    );
    rim.position.y = 0.298;
    rim.rotation.x = Math.PI / 2;
    g.add(rim);

    // Soil surface
    var soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.20, 0.20, 0.02, 20),
      mat(0x1a1510, { roughness: 0.99 })
    );
    soil.position.y = 0.31;
    g.add(soil);

    // Leaf cluster 1 (center, taller)
    var leaf1 = new THREE.Mesh(
      new THREE.SphereGeometry(0.19, 12, 10),
      PAL.leaf()
    );
    leaf1.scale.set(1, 1.35, 1);
    leaf1.position.set(0, 0.62, 0);
    leaf1.castShadow = true;
    g.add(leaf1);

    // Leaf cluster 2 (left, lower)
    var leaf2 = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      mat(0x226638, { roughness: 0.82 })
    );
    leaf2.scale.set(1, 1.1, 1);
    leaf2.position.set(-0.16, 0.52, 0.05);
    leaf2.castShadow = true;
    g.add(leaf2);

    // Leaf cluster 3 (right)
    var leaf3 = new THREE.Mesh(
      new THREE.SphereGeometry(0.13, 10, 8),
      mat(0x1e5c30, { roughness: 0.84 })
    );
    leaf3.scale.set(1, 1.2, 1);
    leaf3.position.set(0.15, 0.55, -0.08);
    leaf3.castShadow = true;
    g.add(leaf3);

    return g;
  }
};
