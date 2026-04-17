import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'sink',
  name: 'Kitchen Sink',
  category: 'kitchen',
  icon: 'Sk',
  gridW: 1, gridD: 1, height: 0.9,
  factory: function() {
    var g = new THREE.Group();

    // Cabinet base body
    var cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(0.80, 0.82, 0.60),
      mat(0x16181d, { roughness: 0.50 })
    );
    cabinet.position.y = 0.41;
    cabinet.castShadow = true;
    cabinet.receiveShadow = true;
    g.add(cabinet);

    // Cabinet door face
    var door = new THREE.Mesh(
      new THREE.BoxGeometry(0.74, 0.70, 0.012),
      mat(0x1c1f26, { roughness: 0.45, metalness: 0.10 })
    );
    door.position.set(0, 0.42, 0.306);
    g.add(door);

    // Door handle (small chrome bar)
    var doorHandle = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.022, 0.022),
      PAL.chrome()
    );
    doorHandle.position.set(0, 0.60, 0.320);
    g.add(doorHandle);

    // Countertop surface
    var countertop = new THREE.Mesh(
      new THREE.BoxGeometry(0.80, 0.04, 0.60),
      mat(0x1e2128, { roughness: 0.25, metalness: 0.15 })
    );
    countertop.position.y = 0.86;
    countertop.castShadow = true;
    g.add(countertop);

    // Basin recess (dark stainless interior)
    var basin = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.16, 0.36),
      mat(0x888888, { roughness: 0.20, metalness: 0.75 })
    );
    basin.position.set(0, 0.80, -0.02);
    basin.castShadow = true;
    g.add(basin);

    // Basin inner bottom
    var basinBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.012, 0.34),
      mat(0x9a9a9a, { roughness: 0.18, metalness: 0.80 })
    );
    basinBase.position.set(0, 0.722, -0.02);
    g.add(basinBase);

    // Basin drain dot
    var drain = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.01, 12),
      mat(0x444444, { roughness: 0.30, metalness: 0.60 })
    );
    drain.position.set(0.12, 0.716, 0.06);
    g.add(drain);

    // Chrome faucet base
    var faucetBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.030, 0.035, 0.04, 12),
      PAL.chrome()
    );
    faucetBase.position.set(0, 0.892, -0.20);
    g.add(faucetBase);

    // Faucet neck (vertical rise)
    var neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.014, 0.014, 0.18, 10),
      PAL.chrome()
    );
    neck.position.set(0, 0.98, -0.20);
    g.add(neck);

    // Faucet arc (horizontal spout)
    var spout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.22, 10),
      PAL.chrome()
    );
    spout.rotation.x = Math.PI / 2;
    spout.position.set(0, 1.07, -0.09);
    spout.castShadow = true;
    g.add(spout);

    // Faucet spout tip (pointing down)
    var tip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.012, 0.04, 8),
      PAL.chrome()
    );
    tip.position.set(0, 1.055, 0.02);
    g.add(tip);

    return g;
  }
};
