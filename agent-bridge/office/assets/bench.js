import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'bench',
  name: 'Park Bench',
  category: 'exterior',
  icon: 'Bn',
  gridW: 2, gridD: 1, height: 0.8,
  factory: function() {
    var g = new THREE.Group();

    var walnut = PAL.walnutLight();
    var chrome = PAL.chrome();

    // 3 seat slats
    var slatGeo = new THREE.BoxGeometry(1.50, 0.038, 0.10);
    [-0.14, 0, 0.14].forEach(function(z) {
      var slat = new THREE.Mesh(slatGeo, walnut);
      slat.position.set(0, 0.48, z);
      slat.castShadow = true;
      slat.receiveShadow = true;
      g.add(slat);
    });

    // 3 back slats (angled slightly)
    var backSlatGeo = new THREE.BoxGeometry(1.50, 0.038, 0.10);
    [0, 0.12, 0.24].forEach(function(i, idx) {
      var slat = new THREE.Mesh(backSlatGeo, walnut);
      slat.rotation.x = -0.18;
      slat.position.set(0, 0.57 + idx * 0.12, -0.24 + idx * 0.03);
      slat.castShadow = true;
      g.add(slat);
    });

    // Left chrome leg frame (L-shape: vertical + diagonal brace)
    var legGeo = new THREE.BoxGeometry(0.025, 0.48, 0.025);
    var leftLegF = new THREE.Mesh(legGeo, chrome);
    leftLegF.position.set(-0.64, 0.24, 0.16);
    leftLegF.castShadow = true;
    g.add(leftLegF);

    var leftLegB = new THREE.Mesh(legGeo, chrome);
    leftLegB.position.set(-0.64, 0.24, -0.16);
    leftLegB.castShadow = true;
    g.add(leftLegB);

    // Right legs
    var rightLegF = leftLegF.clone();
    rightLegF.position.x = 0.64;
    g.add(rightLegF);

    var rightLegB = leftLegB.clone();
    rightLegB.position.x = 0.64;
    g.add(rightLegB);

    // Horizontal chrome stretcher bars
    var stretcherGeo = new THREE.BoxGeometry(1.50, 0.020, 0.020);
    var frontStr = new THREE.Mesh(stretcherGeo, chrome);
    frontStr.position.set(0, 0.22, 0.16);
    g.add(frontStr);

    var backStr = new THREE.Mesh(stretcherGeo, chrome);
    backStr.position.set(0, 0.22, -0.16);
    g.add(backStr);

    // Back support verticals (angled)
    var backVertGeo = new THREE.BoxGeometry(0.025, 0.44, 0.025);
    var leftBV = new THREE.Mesh(backVertGeo, chrome);
    leftBV.rotation.x = -0.18;
    leftBV.position.set(-0.64, 0.68, -0.22);
    leftBV.castShadow = true;
    g.add(leftBV);

    var rightBV = leftBV.clone();
    rightBV.position.x = 0.64;
    g.add(rightBV);

    // Chrome armrests
    var armGeo = new THREE.BoxGeometry(0.025, 0.025, 0.38);
    var leftArm = new THREE.Mesh(armGeo, chrome);
    leftArm.position.set(-0.64, 0.52, -0.01);
    g.add(leftArm);
    var rightArm = leftArm.clone();
    rightArm.position.x = 0.64;
    g.add(rightArm);

    // Rubber floor pads
    var padMat = mat(0x0a0a0a, { roughness: 0.92 });
    var padGeo = new THREE.CylinderGeometry(0.020, 0.020, 0.012, 8);
    [[-0.64, 0.006, 0.16], [0.64, 0.006, 0.16], [-0.64, 0.006, -0.16], [0.64, 0.006, -0.16]].forEach(function(p) {
      var pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(p[0], p[1], p[2]);
      g.add(pad);
    });

    return g;
  }
};
