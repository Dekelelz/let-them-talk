import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'l-sofa',
  name: 'L-Sofa',
  category: 'furniture',
  icon: 'LS',
  gridW: 4, gridD: 2, height: 0.9,
  factory: function() {
    var g = new THREE.Group();
    var fabricMat = PAL.fabric();
    var frameMat = mat(0x17191f, { roughness: 0.6 });
    var capMat = mat(0x1e2028, { roughness: 0.45 });
    var cushionMat = mat(0x252830, { roughness: 0.92 });

    // === MAIN SECTION (3W, along X axis) ===
    var mainBase = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.18, 0.9),
      frameMat
    );
    mainBase.position.set(0, 0.09, 0);
    mainBase.castShadow = true;
    mainBase.receiveShadow = true;
    g.add(mainBase);

    var mainSeat = new THREE.Mesh(
      new THREE.BoxGeometry(2.88, 0.16, 0.76),
      fabricMat
    );
    mainSeat.position.set(0, 0.26, 0);
    mainSeat.castShadow = true;
    g.add(mainSeat);

    var mainBack = new THREE.Mesh(
      new THREE.BoxGeometry(2.88, 0.56, 0.18),
      fabricMat
    );
    mainBack.position.set(0, 0.62, -0.35);
    mainBack.castShadow = true;
    g.add(mainBack);

    var mainBackCap = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 0.20),
      capMat
    );
    mainBackCap.position.set(0, 0.92, -0.34);
    g.add(mainBackCap);

    // 3 seat cushions main
    [-0.96, 0, 0.96].forEach(function(x) {
      var c = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.10, 0.72), cushionMat);
      c.position.set(x, 0.37, 0.01);
      c.castShadow = true;
      g.add(c);
    });

    // Left arm (main section)
    var leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.46, 0.9), fabricMat);
    leftArm.position.set(-1.41, 0.41, 0);
    leftArm.castShadow = true;
    g.add(leftArm);

    var leftArmCap = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.92), capMat);
    leftArmCap.position.set(-1.41, 0.65, 0);
    g.add(leftArmCap);

    // === WING SECTION (1.5W, along Z axis, attached to right side) ===
    // Offset so it attaches at right end of main section
    var wingBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.18, 0.9),
      frameMat
    );
    wingBase.position.set(2.0, 0.09, 0.85);
    wingBase.rotation.y = Math.PI / 2;
    wingBase.castShadow = true;
    wingBase.receiveShadow = true;
    g.add(wingBase);

    var wingSeat = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 0.16, 0.76),
      fabricMat
    );
    wingSeat.position.set(2.0, 0.26, 0.85);
    wingSeat.rotation.y = Math.PI / 2;
    wingSeat.castShadow = true;
    g.add(wingSeat);

    var wingBack = new THREE.Mesh(
      new THREE.BoxGeometry(1.38, 0.56, 0.18),
      fabricMat
    );
    wingBack.position.set(2.35, 0.62, 0.85);
    wingBack.rotation.y = Math.PI / 2;
    wingBack.castShadow = true;
    g.add(wingBack);

    var wingBackCap = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.06, 0.20),
      capMat
    );
    wingBackCap.position.set(2.35, 0.92, 0.85);
    wingBackCap.rotation.y = Math.PI / 2;
    g.add(wingBackCap);

    // 2 seat cushions on wing
    [-0.38, 0.38].forEach(function(offset) {
      var c = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.10, 0.72), cushionMat);
      c.position.set(2.0, 0.37, 0.85 + offset);
      c.castShadow = true;
      g.add(c);
    });

    // Wing end arm
    var wingArm = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.46, 0.9), fabricMat);
    wingArm.position.set(2.0, 0.41, 1.63);
    wingArm.rotation.y = Math.PI / 2;
    wingArm.castShadow = true;
    g.add(wingArm);

    var wingArmCap = new THREE.Mesh(new THREE.BoxGeometry(0.20, 0.04, 0.92), capMat);
    wingArmCap.position.set(2.0, 0.65, 1.63);
    wingArmCap.rotation.y = Math.PI / 2;
    g.add(wingArmCap);

    // Corner connector piece
    var corner = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.18, 0.9),
      frameMat
    );
    corner.position.set(1.5, 0.09, 0.45);
    corner.castShadow = true;
    g.add(corner);

    var cornerSeat = new THREE.Mesh(
      new THREE.BoxGeometry(0.78, 0.16, 0.78),
      fabricMat
    );
    cornerSeat.position.set(1.5, 0.26, 0.45);
    g.add(cornerSeat);

    // 6 chrome legs
    var legMat = PAL.chrome();
    var legGeo = new THREE.CylinderGeometry(0.025, 0.02, 0.09, 8);
    [[-1.35, -0.35], [-1.35, 0.38], [0.5, -0.35], [1.5, 1.25], [2.0, 1.25], [1.5, -0.35]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], 0.045, p[1]);
      g.add(leg);
    });

    return g;
  }
};
