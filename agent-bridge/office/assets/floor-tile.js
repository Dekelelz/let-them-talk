import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'floor-tile',
  name: 'Floor Tile',
  category: 'structural',
  icon: 'FT',
  gridW: 2, gridD: 2, height: 0.02,
  factory: function() {
    var g = new THREE.Group();

    // Main tile slab
    var tile = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.02, 2),
      PAL.marbleBlack()
    );
    tile.receiveShadow = true;
    g.add(tile);

    // Thin grout lines — cross pattern
    var groutMat = mat(0x0e1015, { roughness: 1.0 });

    var groutH = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.021, 0.025),
      groutMat
    );
    g.add(groutH);

    var groutV = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.021, 2),
      groutMat
    );
    g.add(groutV);

    // Edge bevel strip (front)
    var edgeF = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.018, 0.015),
      mat(0x0e1015, { roughness: 0.8 })
    );
    edgeF.position.z = 0.993;
    g.add(edgeF);

    // Edge bevel strip (right)
    var edgeR = new THREE.Mesh(
      new THREE.BoxGeometry(0.015, 0.018, 2),
      mat(0x0e1015, { roughness: 0.8 })
    );
    edgeR.position.x = 0.993;
    g.add(edgeR);

    return g;
  }
};
