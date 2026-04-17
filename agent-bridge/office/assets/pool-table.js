import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'pool_table',
  name: 'Pool Table',
  category: 'recreation',
  icon: 'PT',
  gridW: 3, gridD: 2, height: 0.85,
  factory: function() {
    var g = new THREE.Group();

    // Walnut outer frame
    var frame = new THREE.Mesh(
      new THREE.BoxGeometry(2.50, 0.16, 1.40),
      PAL.walnutDark()
    );
    frame.position.y = 0.82;
    frame.castShadow = true;
    frame.receiveShadow = true;
    g.add(frame);

    // Green felt playing surface
    var felt = new THREE.Mesh(
      new THREE.BoxGeometry(2.28, 0.012, 1.18),
      PAL.greenFelt()
    );
    felt.position.y = 0.914;
    felt.receiveShadow = true;
    g.add(felt);

    // White center line
    var centerLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.015, 1.18),
      mat(0xffffff, { roughness: 0.80 })
    );
    centerLine.position.y = 0.922;
    g.add(centerLine);

    // Baulk line (1/4 from end)
    var baulkLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.015, 1.18),
      mat(0xffffff, { roughness: 0.80 })
    );
    baulkLine.position.set(-0.57, 0.922, 0);
    g.add(baulkLine);

    // 4 thick legs
    var legMat = PAL.walnutDark();
    var legGeo = new THREE.BoxGeometry(0.12, 0.78, 0.12);
    [[-1.10, 0.39, 0.55], [1.10, 0.39, 0.55], [-1.10, 0.39, -0.55], [1.10, 0.39, -0.55]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    // 6 pockets — small dark spheres
    var pocketMat = mat(0x0a0a0a, { roughness: 0.70 });
    var pocketGeo = new THREE.SphereGeometry(0.055, 10, 8);
    var pocketPositions = [
      [-1.11, 0.920, 0.56],  // corners
      [1.11, 0.920, 0.56],
      [-1.11, 0.920, -0.56],
      [1.11, 0.920, -0.56],
      [0, 0.920, 0.60],      // side midpoints
      [0, 0.920, -0.60]
    ];
    pocketPositions.forEach(function(p) {
      var pocket = new THREE.Mesh(pocketGeo, pocketMat);
      pocket.position.set(p[0], p[1], p[2]);
      g.add(pocket);
    });

    // Rail cushions (dark rubber strips around the inside edge)
    var railMat = mat(0x1a1a0a, { roughness: 0.85 });
    // Long rails
    var longRailGeo = new THREE.BoxGeometry(2.26, 0.08, 0.04);
    [0.565, -0.565].forEach(function(z) {
      var rail = new THREE.Mesh(longRailGeo, railMat);
      rail.position.set(0, 0.89, z);
      g.add(rail);
    });
    // Short rails
    var shortRailGeo = new THREE.BoxGeometry(0.04, 0.08, 1.10);
    [-1.11, 1.11].forEach(function(x) {
      var rail = new THREE.Mesh(shortRailGeo, railMat);
      rail.position.set(x, 0.89, 0);
      g.add(rail);
    });

    return g;
  }
};
