import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'whiteboard',
  name: 'Whiteboard',
  category: 'office',
  icon: 'WB',
  gridW: 2, gridD: 1, height: 1.5,
  factory: function() {
    var g = new THREE.Group();

    // White writing surface
    var surface = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 1.15, 0.025),
      mat(0xf5f5f0, { roughness: 0.85, metalness: 0.0 })
    );
    surface.position.y = 1.28;
    surface.castShadow = true;
    surface.receiveShadow = true;
    g.add(surface);

    // Aluminium frame — top
    var frameMat = PAL.chromeBrushed();
    var topFrame = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.04, 0.04), frameMat);
    topFrame.position.set(0, 1.875, 0);
    topFrame.castShadow = true;
    g.add(topFrame);

    // Bottom frame (also pen tray holder)
    var botFrame = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.04, 0.04), frameMat);
    botFrame.position.set(0, 0.705, 0);
    botFrame.castShadow = true;
    g.add(botFrame);

    // Left frame
    var leftFrame = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.23, 0.04), frameMat);
    leftFrame.position.set(-1.02, 1.28, 0);
    leftFrame.castShadow = true;
    g.add(leftFrame);

    // Right frame
    var rightFrame = leftFrame.clone();
    rightFrame.position.x = 1.02;
    g.add(rightFrame);

    // Pen/marker tray at bottom (extended outward)
    var tray = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 0.025, 0.07),
      frameMat
    );
    tray.position.set(0, 0.69, 0.045);
    g.add(tray);

    // Tray back lip
    var trayLip = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 0.035, 0.012),
      frameMat
    );
    trayLip.position.set(0, 0.707, 0.083);
    g.add(trayLip);

    // Two marker caps sitting in tray
    var markerMat = mat(0x111111, { roughness: 0.7 });
    [-0.3, 0.1].forEach(function(x) {
      var marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.12, 8),
        markerMat
      );
      marker.rotation.z = Math.PI / 2;
      marker.position.set(x, 0.71, 0.055);
      g.add(marker);
    });

    // Eraser block
    var eraser = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.025, 0.045),
      mat(0x888888, { roughness: 0.9 })
    );
    eraser.position.set(0.5, 0.71, 0.055);
    g.add(eraser);

    // Two vertical chrome stand legs
    var legMat = PAL.chrome();
    var legGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.72, 10);
    var leftLeg = new THREE.Mesh(legGeo, legMat);
    leftLeg.position.set(-0.75, 0.36, 0);
    leftLeg.castShadow = true;
    g.add(leftLeg);

    var rightLeg = leftLeg.clone();
    rightLeg.position.x = 0.75;
    g.add(rightLeg);

    // Horizontal crossbar
    var crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(1.5, 0.025, 0.025),
      legMat
    );
    crossbar.position.set(0, 0.42, 0);
    g.add(crossbar);

    // T-feet (horizontal base bars)
    var footMat = PAL.chrome();
    var leftFoot = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.022, 0.022), footMat);
    leftFoot.position.set(-0.75, 0.015, 0);
    g.add(leftFoot);

    var rightFoot = leftFoot.clone();
    rightFoot.position.x = 0.75;
    g.add(rightFoot);

    return g;
  }
};
