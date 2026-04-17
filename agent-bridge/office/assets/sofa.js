import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'sofa',
  name: 'Sofa',
  category: 'furniture',
  icon: 'Sf',
  gridW: 3, gridD: 1, height: 0.9,
  factory: function() {
    var g = new THREE.Group();

    // Base platform (structural frame)
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.18, 0.9),
      mat(0x17191f, { roughness: 0.6, metalness: 0.05 })
    );
    base.position.y = 0.09;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Seat cushion surface (3 visible cushions merged as one pad, split by seams)
    var seatPad = new THREE.Mesh(
      new THREE.BoxGeometry(2.88, 0.16, 0.76),
      PAL.fabric()
    );
    seatPad.position.y = 0.26;
    seatPad.castShadow = true;
    seatPad.receiveShadow = true;
    g.add(seatPad);

    // 3 cushion seams (thin dark lines on top of seat pad)
    var seamMat = mat(0x1a1c22, { roughness: 0.9 });
    [-0.96, 0.96].forEach(function(x) {
      var seam = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.162, 0.76), seamMat);
      seam.position.set(x, 0.26, 0);
      g.add(seam);
    });

    // Backrest (full width)
    var back = new THREE.Mesh(
      new THREE.BoxGeometry(2.88, 0.56, 0.18),
      PAL.fabric()
    );
    back.position.set(0, 0.62, -0.35);
    back.castShadow = true;
    g.add(back);

    // Back top cap (slightly overhanging)
    var backCap = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 0.20),
      mat(0x1e2028, { roughness: 0.5 })
    );
    backCap.position.set(0, 0.92, -0.34);
    backCap.castShadow = true;
    g.add(backCap);

    // Left arm
    var armMat = PAL.fabric();
    var leftArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.46, 0.9),
      armMat
    );
    leftArm.position.set(-1.41, 0.41, 0);
    leftArm.castShadow = true;
    g.add(leftArm);

    // Right arm
    var rightArm = leftArm.clone();
    rightArm.position.x = 1.41;
    g.add(rightArm);

    // Arm top caps
    var armCapMat = mat(0x1e2028, { roughness: 0.45 });
    var leftArmCap = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.92), armCapMat);
    leftArmCap.position.set(-1.41, 0.65, 0);
    g.add(leftArmCap);
    var rightArmCap = leftArmCap.clone();
    rightArmCap.position.x = 1.41;
    g.add(rightArmCap);

    // 3 seat cushions (individual, sitting on the pad)
    var cushionMat = mat(0x252830, { roughness: 0.92 });
    [-0.96, 0, 0.96].forEach(function(x) {
      var cushion = new THREE.Mesh(
        new THREE.BoxGeometry(0.88, 0.10, 0.72),
        cushionMat
      );
      cushion.position.set(x, 0.37, 0.01);
      cushion.castShadow = true;
      g.add(cushion);
    });

    // 4 low chrome legs
    var legMat = PAL.chrome();
    var legGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.09, 8);
    [[-1.35, -0.35], [1.35, -0.35], [-1.35, 0.38], [1.35, 0.38]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], 0.045, p[1]);
      g.add(leg);
    });

    return g;
  }
};
