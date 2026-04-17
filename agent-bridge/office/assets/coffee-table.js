import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'coffee-table',
  name: 'Coffee Table',
  category: 'furniture',
  icon: 'CT',
  gridW: 1, gridD: 1, height: 0.45,
  factory: function() {
    var g = new THREE.Group();

    // Glass top
    var glassTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.012, 0.5),
      mat(0xaaccee, { transparent: true, opacity: 0.35, roughness: 0.04, metalness: 0.08 })
    );
    glassTop.position.y = 0.45;
    glassTop.receiveShadow = true;
    g.add(glassTop);

    // Chrome frame around glass top
    var frameMat = PAL.chrome();
    var frontBar = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.018, 0.018), frameMat);
    frontBar.position.set(0, 0.444, 0.241);
    frontBar.castShadow = true;
    g.add(frontBar);

    var backBar = frontBar.clone();
    backBar.position.z = -0.241;
    g.add(backBar);

    var leftBar = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.018, 0.5), frameMat);
    leftBar.position.set(-0.491, 0.444, 0);
    leftBar.castShadow = true;
    g.add(leftBar);

    var rightBar = leftBar.clone();
    rightBar.position.x = 0.491;
    g.add(rightBar);

    // Lower shelf (smoked glass)
    var shelf = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.010, 0.40),
      mat(0x445566, { transparent: true, opacity: 0.55, roughness: 0.12 })
    );
    shelf.position.y = 0.18;
    shelf.receiveShadow = true;
    g.add(shelf);

    // 4 chrome legs — slim round
    var legMat = PAL.chrome();
    var legGeo = new THREE.CylinderGeometry(0.018, 0.014, 0.44, 10);
    [[-0.44, 0.22], [0.44, 0.22], [-0.44, -0.22], [0.44, -0.22]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], 0.22, p[1]);
      leg.castShadow = true;
      g.add(leg);
    });

    // Horizontal stretcher bars connecting legs (lower)
    var stretcherMat = PAL.chromeBrushed();
    var hStretch1 = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.015, 0.015), stretcherMat);
    hStretch1.position.set(0, 0.12, 0.22);
    g.add(hStretch1);

    var hStretch2 = hStretch1.clone();
    hStretch2.position.z = -0.22;
    g.add(hStretch2);

    var vStretch1 = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.44), stretcherMat);
    vStretch1.position.set(-0.44, 0.12, 0);
    g.add(vStretch1);

    var vStretch2 = vStretch1.clone();
    vStretch2.position.x = 0.44;
    g.add(vStretch2);

    return g;
  }
};
