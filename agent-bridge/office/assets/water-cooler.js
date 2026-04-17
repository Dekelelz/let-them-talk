import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'water-cooler',
  name: 'Water Cooler',
  category: 'office',
  icon: 'WC',
  gridW: 1, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    var bodyMat = mat(0x1e2128, { roughness: 0.45, metalness: 0.15 });

    // Base cabinet body
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.75, 0.3),
      bodyMat
    );
    base.position.y = 0.375;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Base door line (subtle seam)
    var doorSeam = new THREE.Mesh(
      new THREE.BoxGeometry(0.005, 0.44, 0.302),
      mat(0x111318, { roughness: 0.9 })
    );
    doorSeam.position.set(0, 0.34, 0);
    g.add(doorSeam);

    // Front door panel
    var door = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.42, 0.012),
      mat(0x252830, { roughness: 0.4, metalness: 0.14 })
    );
    door.position.set(0, 0.32, 0.156);
    g.add(door);

    // Door handle
    var handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.018, 0.018),
      PAL.chrome()
    );
    handle.position.set(0.09, 0.32, 0.165);
    g.add(handle);

    // Drip tray platform (top of cabinet)
    var tray = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.04, 0.30),
      mat(0x252830, { roughness: 0.5, metalness: 0.20 })
    );
    tray.position.y = 0.77;
    tray.castShadow = true;
    g.add(tray);

    // Drip tray grid (decorative)
    var gridMat = mat(0x333640, { roughness: 0.7, metalness: 0.3 });
    for (var i = -1; i <= 1; i++) {
      var gridLine = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.008, 0.005), gridMat);
      gridLine.position.set(0, 0.793, i * 0.08);
      g.add(gridLine);
    }

    // Dispenser housing (middle section)
    var dispenser = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.22, 0.28),
      bodyMat
    );
    dispenser.position.y = 0.90;
    dispenser.castShadow = true;
    g.add(dispenser);

    // Hot tap (red)
    var hotTap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.045, 10),
      mat(0xcc2222, { roughness: 0.4 })
    );
    hotTap.rotation.z = Math.PI / 2;
    hotTap.position.set(-0.1, 0.845, 0.14);
    g.add(hotTap);

    // Cold tap (blue)
    var coldTap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.045, 10),
      mat(0x2266cc, { roughness: 0.4 })
    );
    coldTap.rotation.z = Math.PI / 2;
    coldTap.position.set(0.1, 0.845, 0.14);
    g.add(coldTap);

    // Bottle collar ring (neck interface)
    var collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.09, 0.06, 16),
      mat(0x252830, { roughness: 0.5, metalness: 0.2 })
    );
    collar.position.y = 1.03;
    g.add(collar);

    // Water bottle (blue, translucent)
    var bottle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.10, 0.10, 0.40, 18),
      mat(0x3399cc, { transparent: true, opacity: 0.72, roughness: 0.08 })
    );
    bottle.position.y = 1.26;
    bottle.castShadow = true;
    g.add(bottle);

    // Bottle cap
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.025, 14),
      mat(0x1155aa, { roughness: 0.4 })
    );
    cap.position.y = 1.473;
    g.add(cap);

    // Bottle bottom dome
    var dome = new THREE.Mesh(
      new THREE.SphereGeometry(0.10, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0x3399cc, { transparent: true, opacity: 0.72, roughness: 0.08 })
    );
    dome.rotation.x = Math.PI;
    dome.position.y = 1.06;
    g.add(dome);

    // Water line visible inside bottle
    var waterLine = new THREE.Mesh(
      new THREE.CylinderGeometry(0.096, 0.096, 0.22, 18),
      mat(0x88ccee, { transparent: true, opacity: 0.5, roughness: 0.05 })
    );
    waterLine.position.y = 1.15;
    g.add(waterLine);

    // 4 base feet
    var footMat = mat(0x111111, { roughness: 0.9 });
    var footGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.02, 8);
    [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]].forEach(function(p) {
      var foot = new THREE.Mesh(footGeo, footMat);
      foot.position.set(p[0], 0.01, p[1]);
      g.add(foot);
    });

    return g;
  }
};
