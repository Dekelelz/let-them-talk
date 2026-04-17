import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'planter_box',
  name: 'Planter Box',
  category: 'exterior',
  icon: 'PB',
  gridW: 1, gridD: 1, height: 0.6,
  factory: function() {
    var g = new THREE.Group();

    var concrete = PAL.concrete();

    // Main concrete box body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(1.00, 0.50, 0.50),
      concrete
    );
    body.position.y = 0.25;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Inner soil recess (dark soil color, sits inside top)
    var soil = new THREE.Mesh(
      new THREE.BoxGeometry(0.88, 0.12, 0.38),
      mat(0x1a1206, { roughness: 0.95 })
    );
    soil.position.y = 0.50;
    g.add(soil);

    // Chamfered top edge detail (thin cap strip)
    var cap = new THREE.Mesh(
      new THREE.BoxGeometry(1.00, 0.030, 0.50),
      mat(0x343740, { roughness: 0.80 })
    );
    cap.position.y = 0.515;
    g.add(cap);

    // Horizontal groove lines on body (2 decorative channels)
    var grooveMat = mat(0x1e2028, { roughness: 0.90 });
    var grooveGeo = new THREE.BoxGeometry(1.002, 0.018, 0.502);
    [0.18, 0.32].forEach(function(y) {
      var groove = new THREE.Mesh(grooveGeo, grooveMat);
      groove.position.y = y;
      g.add(groove);
    });

    // Greenery — cluster of rounded bush shapes
    var leafMat = PAL.leaf();
    var leafMat2 = mat(0x1d6e3a, { roughness: 0.82 });

    var bushPositions = [
      { x: -0.26, s: 0.18, h: 0.14 },
      { x: 0, s: 0.22, h: 0.18 },
      { x: 0.26, s: 0.17, h: 0.13 }
    ];

    bushPositions.forEach(function(b, idx) {
      var bush = new THREE.Mesh(
        new THREE.SphereGeometry(b.s, 10, 8),
        idx % 2 === 0 ? leafMat : leafMat2
      );
      bush.scale.set(1.0, b.h / b.s, 1.0);
      bush.position.set(b.x, 0.54 + b.h, 0);
      bush.castShadow = true;
      g.add(bush);
    });

    // Small accent sprigs between bushes
    var sprigMat = mat(0x3aaa5e, { roughness: 0.78 });
    [-0.13, 0.13].forEach(function(x) {
      var sprig = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6),
        sprigMat
      );
      sprig.scale.set(0.7, 0.9, 0.7);
      sprig.position.set(x, 0.66, 0.04);
      sprig.castShadow = true;
      g.add(sprig);
    });

    // Drainage detail (small holes on bottom face)
    var drainMat = mat(0x111111, { roughness: 0.80 });
    var drainGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.012, 8);
    [-0.22, 0, 0.22].forEach(function(x) {
      var drain = new THREE.Mesh(drainGeo, drainMat);
      drain.position.set(x, 0.004, 0);
      g.add(drain);
    });

    return g;
  }
};
