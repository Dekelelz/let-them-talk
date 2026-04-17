import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'door',
  name: 'Door',
  category: 'structural',
  icon: 'Dr',
  gridW: 1, gridD: 1, height: 2.5,
  factory: function() {
    var g = new THREE.Group();

    // Door slab — walnut
    var slab = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2.5, 0.08),
      PAL.walnutDark()
    );
    slab.castShadow = true;
    slab.receiveShadow = true;
    g.add(slab);

    // Recessed panel (upper)
    var panelU = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 1.0, 0.01),
      PAL.walnutLight()
    );
    panelU.position.y = 0.6;
    panelU.position.z = 0.045;
    g.add(panelU);

    // Recessed panel (lower)
    var panelL = new THREE.Mesh(
      new THREE.BoxGeometry(0.75, 0.75, 0.01),
      PAL.walnutLight()
    );
    panelL.position.y = -0.6;
    panelL.position.z = 0.045;
    g.add(panelL);

    // Chrome handle bar
    var handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.12, 8),
      PAL.chrome()
    );
    handle.rotation.z = Math.PI / 2;
    handle.position.set(0.38, 0, 0.07);
    handle.castShadow = true;
    g.add(handle);

    // Handle back plate
    var plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.18, 0.015),
      PAL.chromeBrushed()
    );
    plate.position.set(0.38, 0, 0.048);
    g.add(plate);

    // Door frame surround
    var frameMat = mat(0x1a1c22, { roughness: 0.6 });
    var frameTop = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.07, 0.1), frameMat);
    frameTop.position.y = 1.285;
    g.add(frameTop);
    var frameL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 2.5, 0.1), frameMat);
    frameL.position.x = -0.535;
    g.add(frameL);
    var frameR = frameL.clone(); frameR.position.x = 0.535; g.add(frameR);

    return g;
  }
};
