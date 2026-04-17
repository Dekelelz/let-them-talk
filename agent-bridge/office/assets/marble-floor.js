import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'marble-floor',
  name: 'Marble Floor',
  category: 'structural',
  icon: 'MF',
  gridW: 2, gridD: 2, height: 0.02,
  factory: function() {
    var g = new THREE.Group();

    // White marble slab
    var slab = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.02, 2),
      PAL.marbleWhite()
    );
    slab.receiveShadow = true;
    g.add(slab);

    // Gold border inlay — all 4 sides
    var goldMat = PAL.gold();
    var borderThick = 0.04;
    var borderH = 0.022;

    var borderN = new THREE.Mesh(
      new THREE.BoxGeometry(2, borderH, borderThick),
      goldMat
    );
    borderN.position.z = -(1 - borderThick / 2);
    g.add(borderN);

    var borderS = borderN.clone();
    borderS.position.z = 1 - borderThick / 2;
    g.add(borderS);

    var borderW = new THREE.Mesh(
      new THREE.BoxGeometry(borderThick, borderH, 2),
      goldMat
    );
    borderW.position.x = -(1 - borderThick / 2);
    g.add(borderW);

    var borderE = borderW.clone();
    borderE.position.x = 1 - borderThick / 2;
    g.add(borderE);

    // Inner gold diamond accent lines
    var innerMat = mat(0xc9a227, { roughness: 0.35, metalness: 0.65 });
    var accentH = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, borderH, 0.015),
      innerMat
    );
    g.add(accentH);

    var accentV = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, borderH, 1.5),
      innerMat
    );
    g.add(accentV);

    return g;
  }
};
