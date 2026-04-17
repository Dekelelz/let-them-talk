import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'wall',
  name: 'Wall',
  category: 'structural',
  icon: 'Wa',
  gridW: 2, gridD: 1, height: 3,
  factory: function() {
    var g = new THREE.Group();

    // Main body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 0.3),
      PAL.concrete()
    );
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Top trim strip
    var trim = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.06, 0.32),
      mat(0x1e2128, { roughness: 0.7 })
    );
    trim.position.y = 1.47;
    trim.castShadow = true;
    g.add(trim);

    // Bottom base strip
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.1, 0.34),
      mat(0x1e2128, { roughness: 0.7 })
    );
    base.position.y = -1.45;
    g.add(base);

    // Subtle vertical score lines (decoration)
    var score1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 2.8, 0.31),
      mat(0x22252e, { roughness: 0.9 })
    );
    score1.position.x = -0.5;
    g.add(score1);

    var score2 = score1.clone();
    score2.position.x = 0.5;
    g.add(score2);

    return g;
  }
};
