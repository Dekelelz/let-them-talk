import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'half-wall',
  name: 'Half Wall',
  category: 'structural',
  icon: 'HW',
  gridW: 2, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    // Main body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2, 1.2, 0.25),
      PAL.concrete()
    );
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Top cap — chrome rail
    var cap = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.07, 0.32),
      PAL.chrome()
    );
    cap.position.y = 0.635;
    cap.castShadow = true;
    g.add(cap);

    // Base strip
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.09, 0.28),
      mat(0x1e2128, { roughness: 0.7 })
    );
    base.position.y = -0.555;
    g.add(base);

    // Front face subtle recess panel
    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.85, 0.02),
      mat(0x24272f, { roughness: 0.9 })
    );
    panel.position.z = 0.13;
    g.add(panel);

    return g;
  }
};
