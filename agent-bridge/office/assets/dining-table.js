import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'dining-table',
  name: 'Dining Table',
  category: 'furniture',
  icon: 'DT',
  gridW: 3, gridD: 2, height: 0.78,
  factory: function() {
    var g = new THREE.Group();

    // Walnut tabletop
    var top = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 1.2),
      PAL.walnutDark()
    );
    top.position.y = 0.78;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // Thin edge band (darker walnut contrast)
    var edgeFront = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.055, 0.018),
      mat(0x2a1808, { roughness: 0.6 })
    );
    edgeFront.position.set(0, 0.778, 0.609);
    g.add(edgeFront);

    var edgeBack = edgeFront.clone();
    edgeBack.position.z = -0.609;
    g.add(edgeBack);

    // Apron/torsion box under top
    var apronFront = new THREE.Mesh(
      new THREE.BoxGeometry(2.86, 0.09, 0.04),
      PAL.walnutDark()
    );
    apronFront.position.set(0, 0.705, 0.54);
    apronFront.castShadow = true;
    g.add(apronFront);

    var apronBack = apronFront.clone();
    apronBack.position.z = -0.54;
    g.add(apronBack);

    var apronLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.09, 1.08),
      PAL.walnutDark()
    );
    apronLeft.position.set(-1.43, 0.705, 0);
    g.add(apronLeft);

    var apronRight = apronLeft.clone();
    apronRight.position.x = 1.43;
    g.add(apronRight);

    // 6 chrome legs in 3 pairs
    var legMat = PAL.chrome();
    var legGeo = new THREE.CylinderGeometry(0.038, 0.032, 0.75, 12);
    var legPositions = [
      [-1.32, -0.46], [-1.32, 0.46],
      [0, -0.46], [0, 0.46],
      [1.32, -0.46], [1.32, 0.46]
    ];
    legPositions.forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], 0.375, p[1]);
      leg.castShadow = true;
      g.add(leg);
    });

    // Horizontal stretcher bars connecting each pair
    var stretchMat = PAL.chromeBrushed();
    [[-1.32], [0], [1.32]].forEach(function(px) {
      var bar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.9), stretchMat);
      bar.position.set(px[0], 0.22, 0);
      g.add(bar);
    });

    // Longitudinal bars connecting front legs
    var longBarFront = new THREE.Mesh(
      new THREE.BoxGeometry(2.64, 0.025, 0.025),
      stretchMat
    );
    longBarFront.position.set(0, 0.22, -0.46);
    g.add(longBarFront);

    var longBarBack = longBarFront.clone();
    longBarBack.position.z = 0.46;
    g.add(longBarBack);

    // Floor glides
    var glideMat = mat(0x111111, { roughness: 0.9 });
    var glideGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.012, 8);
    legPositions.forEach(function(p) {
      var glide = new THREE.Mesh(glideGeo, glideMat);
      glide.position.set(p[0], 0.006, p[1]);
      g.add(glide);
    });

    return g;
  }
};
