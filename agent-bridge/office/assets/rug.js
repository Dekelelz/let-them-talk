import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'rug',
  name: 'Rug',
  category: 'decor',
  icon: 'Rg',
  gridW: 3, gridD: 2, height: 0.02,
  factory: function() {
    var g = new THREE.Group();

    // Main rug body — dark burgundy
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.012, 2.0),
      mat(0x4a0a18, { roughness: 0.98 })
    );
    body.position.y = 0.006;
    body.receiveShadow = true;
    g.add(body);

    // Gold outer border (4 strips)
    var borderMat = mat(0xc9a227, { roughness: 0.60, metalness: 0.15 });

    var borderN = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.013, 0.12),
      borderMat
    );
    borderN.position.set(0, 0.007, -0.94);
    borderN.receiveShadow = true;
    g.add(borderN);

    var borderS = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.013, 0.12),
      borderMat
    );
    borderS.position.set(0, 0.007, 0.94);
    borderS.receiveShadow = true;
    g.add(borderS);

    var borderW = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.013, 2.0),
      borderMat
    );
    borderW.position.set(-1.44, 0.007, 0);
    borderW.receiveShadow = true;
    g.add(borderW);

    var borderE = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.013, 2.0),
      borderMat
    );
    borderE.position.set(1.44, 0.007, 0);
    borderE.receiveShadow = true;
    g.add(borderE);

    // Inner accent border (thin dark line)
    var innerMat = mat(0x2a0510, { roughness: 0.98 });

    var inN = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.014, 0.04), innerMat);
    inN.position.set(0, 0.008, -0.78);
    g.add(inN);

    var inS = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.014, 0.04), innerMat);
    inS.position.set(0, 0.008, 0.78);
    g.add(inS);

    var inW = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 1.6), innerMat);
    inW.position.set(-1.28, 0.008, 0);
    g.add(inW);

    var inE = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.014, 1.6), innerMat);
    inE.position.set(1.28, 0.008, 0);
    g.add(inE);

    return g;
  }
};
