import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'vase',
  name: 'Vase',
  category: 'decor',
  icon: 'Vs',
  gridW: 1, gridD: 1, height: 1.0,
  factory: function() {
    var g = new THREE.Group();

    // Small side table — dark walnut legs
    var tableLeg = mat(0x2a1808, { roughness: 0.60 });

    var legFL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.035), tableLeg);
    legFL.position.set(-0.13, 0.29, -0.13);
    legFL.castShadow = true;
    g.add(legFL);

    var legFR = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.035), tableLeg);
    legFR.position.set(0.13, 0.29, -0.13);
    legFR.castShadow = true;
    g.add(legFR);

    var legBL = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.035), tableLeg);
    legBL.position.set(-0.13, 0.29, 0.13);
    legBL.castShadow = true;
    g.add(legBL);

    var legBR = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.58, 0.035), tableLeg);
    legBR.position.set(0.13, 0.29, 0.13);
    legBR.castShadow = true;
    g.add(legBR);

    // Table top
    var tabletop = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.025, 0.32),
      PAL.walnutDark()
    );
    tabletop.position.y = 0.6;
    tabletop.castShadow = true;
    tabletop.receiveShadow = true;
    g.add(tabletop);

    // Vase base (flared bottom)
    var vaseBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.07, 0.08, 20),
      mat(0x1a1a24, { roughness: 0.18, metalness: 0.08 })
    );
    vaseBase.position.y = 0.665;
    vaseBase.castShadow = true;
    g.add(vaseBase);

    // Vase body (tapered cylinder — dark glaze)
    var vaseBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.10, 0.28, 20),
      mat(0x12121a, { roughness: 0.14, metalness: 0.10 })
    );
    vaseBody.position.y = 0.85;
    vaseBody.castShadow = true;
    g.add(vaseBody);

    // Vase neck (narrow)
    var vaseNeck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.085, 0.10, 20),
      mat(0x12121a, { roughness: 0.14, metalness: 0.10 })
    );
    vaseNeck.position.y = 1.04;
    vaseNeck.castShadow = true;
    g.add(vaseNeck);

    // Vase lip (slight flare at top)
    var vaseLip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.052, 0.042, 0.03, 20),
      mat(0x1e1e2a, { roughness: 0.12, metalness: 0.12 })
    );
    vaseLip.position.y = 1.105;
    vaseLip.castShadow = true;
    g.add(vaseLip);

    return g;
  }
};
