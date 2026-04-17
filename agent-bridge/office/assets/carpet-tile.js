import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'carpet-tile',
  name: 'Carpet Tile',
  category: 'structural',
  icon: 'CT',
  gridW: 2, gridD: 2, height: 0.03,
  factory: function() {
    var g = new THREE.Group();

    // Carpet base — charcoal fabric
    var carpet = new THREE.Mesh(
      new THREE.BoxGeometry(1.98, 0.03, 1.98),
      mat(0x2e3040, { roughness: 0.98 })
    );
    carpet.receiveShadow = true;
    g.add(carpet);

    // Subtle pattern — directional nap lines (darker strips)
    var napMat = mat(0x272938, { roughness: 1.0 });
    var i;
    for (i = -3; i <= 3; i++) {
      var nap = new THREE.Mesh(
        new THREE.BoxGeometry(1.96, 0.031, 0.04),
        napMat
      );
      nap.position.z = i * 0.28;
      g.add(nap);
    }

    // Thin border edge reveal (slightly lighter)
    var edgeMat = mat(0x3a3d50, { roughness: 0.95 });
    var edgeN = new THREE.Mesh(new THREE.BoxGeometry(2, 0.032, 0.04), edgeMat);
    edgeN.position.z = -0.98;
    g.add(edgeN);
    var edgeS = edgeN.clone(); edgeS.position.z = 0.98; g.add(edgeS);
    var edgeW = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.032, 2), edgeMat);
    edgeW.position.x = -0.98;
    g.add(edgeW);
    var edgeE = edgeW.clone(); edgeE.position.x = 0.98; g.add(edgeE);

    return g;
  }
};
