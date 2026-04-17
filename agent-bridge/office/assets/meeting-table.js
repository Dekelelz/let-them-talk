import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'meeting-table',
  name: 'Meeting Table',
  category: 'office',
  icon: 'MT',
  gridW: 3, gridD: 2, height: 0.78,
  factory: function() {
    var g = new THREE.Group();

    // Oval tabletop approximated with scaled cylinder
    var topGeo = new THREE.CylinderGeometry(1.0, 1.0, 0.055, 32);
    var top = new THREE.Mesh(topGeo, mat(0x1a1c22, { roughness: 0.25, metalness: 0.08 }));
    top.scale.set(2.5, 1, 1.5);
    top.position.y = 0.78;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // Top surface inlay (lighter tone center oval)
    var inlayGeo = new THREE.CylinderGeometry(0.88, 0.88, 0.008, 32);
    var inlay = new THREE.Mesh(inlayGeo, mat(0x252830, { roughness: 0.30 }));
    inlay.scale.set(2.3, 1, 1.3);
    inlay.position.y = 0.81;
    g.add(inlay);

    // Gold edge ring band
    var ringGeo = new THREE.TorusGeometry(1.0, 0.012, 8, 32);
    var ring = new THREE.Mesh(ringGeo, PAL.gold());
    ring.scale.set(2.5, 1.5, 1);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.808;
    g.add(ring);

    // Central pedestal column
    var column = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.10, 0.52, 14),
      PAL.chromeBrushed()
    );
    column.position.y = 0.52;
    column.castShadow = true;
    g.add(column);

    // Upper column flare
    var flareTop = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.08, 0.08, 14),
      PAL.chrome()
    );
    flareTop.position.y = 0.80;
    flareTop.castShadow = true;
    g.add(flareTop);

    // Lower column base flare
    var flareBot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.22, 0.08, 14),
      PAL.chrome()
    );
    flareBot.position.y = 0.26;
    flareBot.castShadow = true;
    g.add(flareBot);

    // Cross base (4-arm spider base)
    var baseMat = PAL.chrome();
    var armGeo = new THREE.BoxGeometry(1.4, 0.04, 0.08);
    var armH = new THREE.Mesh(armGeo, baseMat);
    armH.position.y = 0.05;
    armH.castShadow = true;
    g.add(armH);

    var armV = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.04, 1.4), baseMat);
    armV.position.y = 0.05;
    armV.castShadow = true;
    g.add(armV);

    // 4 glide feet at base arm ends
    var glideMat = mat(0x111111, { roughness: 0.9 });
    var glideGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.018, 8);
    [[0.68, 0], [-0.68, 0], [0, 0.68], [0, -0.68]].forEach(function(p) {
      var glide = new THREE.Mesh(glideGeo, glideMat);
      glide.position.set(p[0], 0.009, p[1]);
      g.add(glide);
    });

    return g;
  }
};
