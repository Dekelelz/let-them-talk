import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'sculpture',
  name: 'Sculpture',
  category: 'decor',
  icon: 'Sc',
  gridW: 1, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    // Pedestal base — dark slab
    var pedBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.55),
      PAL.marbleBlack()
    );
    pedBase.position.y = 0.03;
    pedBase.castShadow = true;
    pedBase.receiveShadow = true;
    g.add(pedBase);

    // Pedestal body
    var pedBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.0, 0.5),
      mat(0x15171e, { roughness: 0.25, metalness: 0.05 })
    );
    pedBody.position.y = 0.56;
    pedBody.castShadow = true;
    pedBody.receiveShadow = true;
    g.add(pedBody);

    // Pedestal top cap
    var pedTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.05, 0.55),
      PAL.marbleBlack()
    );
    pedTop.position.y = 1.085;
    pedTop.castShadow = true;
    g.add(pedTop);

    // Chrome sphere (abstract sculpture)
    var sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 32, 32),
      PAL.chrome()
    );
    sphere.position.y = 1.31;
    sphere.castShadow = true;
    g.add(sphere);

    // Small accent ring around base of sphere
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.21, 0.015, 12, 40),
      PAL.gold()
    );
    ring.position.y = 1.11;
    ring.rotation.x = Math.PI / 2;
    ring.castShadow = true;
    g.add(ring);

    // Abstract protruding spike (artistic detail)
    var spike = new THREE.Mesh(
      new THREE.ConeGeometry(0.03, 0.25, 8),
      PAL.chromeBrushed()
    );
    spike.position.set(0.12, 1.48, 0.08);
    spike.rotation.z = -0.5;
    spike.rotation.x = 0.3;
    spike.castShadow = true;
    g.add(spike);

    // Second smaller spike
    var spike2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.02, 0.18, 8),
      PAL.chromeBrushed()
    );
    spike2.position.set(-0.14, 1.44, -0.06);
    spike2.rotation.z = 0.6;
    spike2.rotation.x = -0.2;
    spike2.castShadow = true;
    g.add(spike2);

    return g;
  }
};
