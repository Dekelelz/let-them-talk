import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'glass-door',
  name: 'Glass Door',
  category: 'structural',
  icon: 'GD',
  gridW: 2, gridD: 1, height: 2.5,
  factory: function() {
    var g = new THREE.Group();

    // Frameless glass panel
    var glass = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 2.5, 0.015),
      PAL.glass()
    );
    glass.receiveShadow = true;
    g.add(glass);

    // Chrome header bar
    var header = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.07, 0.06),
      PAL.chrome()
    );
    header.position.y = 1.285;
    header.castShadow = true;
    g.add(header);

    // Chrome floor threshold
    var threshold = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.04, 0.06),
      PAL.chromeBrushed()
    );
    threshold.position.y = -1.23;
    g.add(threshold);

    // Chrome pull handle (horizontal bar, both sides)
    var handleMat = PAL.chrome();
    var pullBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.35, 10),
      handleMat
    );
    pullBar.rotation.z = Math.PI / 2;
    pullBar.position.set(0, 0.1, 0.05);
    pullBar.castShadow = true;
    g.add(pullBar);

    var pullBarBack = pullBar.clone();
    pullBarBack.position.z = -0.05;
    g.add(pullBarBack);

    // Handle end caps
    var capGeo = new THREE.SphereGeometry(0.022, 8, 6);
    var capL = new THREE.Mesh(capGeo, handleMat);
    capL.position.set(-0.175, 0.1, 0.05);
    g.add(capL);
    var capR = new THREE.Mesh(capGeo, handleMat);
    capR.position.set(0.175, 0.1, 0.05);
    g.add(capR);

    // Subtle tint line at mid height
    var tintLine = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.02, 0.016),
      mat(0x88aacc, { transparent: true, opacity: 0.4 })
    );
    tintLine.position.y = -0.3;
    g.add(tintLine);

    return g;
  }
};
