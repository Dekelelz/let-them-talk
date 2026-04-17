import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'fence',
  name: 'Metal Fence',
  category: 'exterior',
  icon: 'Fn',
  gridW: 2, gridD: 1, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    var chrome = PAL.chrome();
    var darkMetal = PAL.darkMetal();

    // Left post
    var postGeo = new THREE.BoxGeometry(0.048, 1.20, 0.048);
    var leftPost = new THREE.Mesh(postGeo, chrome);
    leftPost.position.set(-0.97, 0.60, 0);
    leftPost.castShadow = true;
    g.add(leftPost);

    // Right post
    var rightPost = leftPost.clone();
    rightPost.position.x = 0.97;
    g.add(rightPost);

    // Post caps (small pyramidal tops)
    var capGeo = new THREE.CylinderGeometry(0.0, 0.034, 0.055, 4);
    var capMat = PAL.chromeBrushed();
    [-0.97, 0.97].forEach(function(x) {
      var cap = new THREE.Mesh(capGeo, capMat);
      cap.position.set(x, 1.228, 0);
      g.add(cap);
    });

    // 4 horizontal bars at varying heights
    var barGeo = new THREE.BoxGeometry(1.94, 0.030, 0.030);
    [0.16, 0.52, 0.88, 1.14].forEach(function(y) {
      var bar = new THREE.Mesh(barGeo, darkMetal);
      bar.position.y = y;
      g.add(bar);
    });

    // Vertical pickets (7 between posts)
    var picketMat = darkMetal;
    var picketGeo = new THREE.BoxGeometry(0.022, 0.98, 0.022);
    var picketCount = 7;
    for (var i = 0; i < picketCount; i++) {
      var x = -0.84 + (i / (picketCount - 1)) * 1.68;
      var picket = new THREE.Mesh(picketGeo, picketMat);
      picket.position.set(x, 0.60, 0);
      picket.castShadow = true;
      g.add(picket);
    }

    // Picket spear tips (sharp top points)
    var spearGeo = new THREE.CylinderGeometry(0.0, 0.016, 0.055, 4);
    for (var j = 0; j < picketCount; j++) {
      var sx = -0.84 + (j / (picketCount - 1)) * 1.68;
      var spear = new THREE.Mesh(spearGeo, PAL.chrome());
      spear.position.set(sx, 1.12, 0);
      g.add(spear);
    }

    // Base footer (ground anchor bar)
    var footer = new THREE.Mesh(
      new THREE.BoxGeometry(1.98, 0.040, 0.06),
      mat(0x0e1014, { roughness: 0.60 })
    );
    footer.position.y = 0.020;
    g.add(footer);

    return g;
  }
};
