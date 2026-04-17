import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'painting',
  name: 'Painting',
  category: 'decor',
  icon: 'Pa',
  gridW: 1, gridD: 1, height: 1.5,
  factory: function() {
    var g = new THREE.Group();

    // Canvas (dark abstract)
    var canvas = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.8, 0.04),
      mat(0x1a1522, { roughness: 0.95 })
    );
    canvas.position.set(0, 2, 0);
    canvas.castShadow = true;
    g.add(canvas);

    // Abstract color block 1 (deep teal)
    var block1 = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.6, 0.045),
      mat(0x0d3d3a, { roughness: 0.90 })
    );
    block1.position.set(-0.22, 2, 0.001);
    g.add(block1);

    // Abstract color block 2 (dark burgundy)
    var block2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.4, 0.045),
      mat(0x3a0d1a, { roughness: 0.90 })
    );
    block2.position.set(0.22, 2.1, 0.001);
    g.add(block2);

    // Gold frame — top bar
    var frameTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.06, 0.07),
      PAL.gold()
    );
    frameTop.position.set(0, 2.43, 0);
    frameTop.castShadow = true;
    g.add(frameTop);

    // Gold frame — bottom bar
    var frameBot = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.06, 0.07),
      PAL.gold()
    );
    frameBot.position.set(0, 1.57, 0);
    frameBot.castShadow = true;
    g.add(frameBot);

    // Gold frame — left bar
    var frameLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.92, 0.07),
      PAL.gold()
    );
    frameLeft.position.set(-0.63, 2, 0);
    frameLeft.castShadow = true;
    g.add(frameLeft);

    // Gold frame — right bar
    var frameRight = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.92, 0.07),
      PAL.gold()
    );
    frameRight.position.set(0.63, 2, 0);
    frameRight.castShadow = true;
    g.add(frameRight);

    // Wall-mount bracket (small dark rectangle behind)
    var bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.12, 0.04),
      mat(0x111111, { roughness: 0.6, metalness: 0.4 })
    );
    bracket.position.set(0, 2, -0.04);
    g.add(bracket);

    return g;
  }
};
