import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'bar_stool',
  name: 'Bar Stool',
  category: 'kitchen',
  icon: 'BS',
  gridW: 1, gridD: 1, height: 0.75,
  factory: function() {
    var g = new THREE.Group();

    // Round seat (dark leather pad)
    var seat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.17, 0.06, 20),
      PAL.leatherBlack()
    );
    seat.position.y = 0.75;
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat);

    // Seat chrome rim
    var seatRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.18, 0.012, 8, 24),
      PAL.chrome()
    );
    seatRim.rotation.x = Math.PI / 2;
    seatRim.position.y = 0.722;
    g.add(seatRim);

    // Main chrome post
    var post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.60, 12),
      PAL.chrome()
    );
    post.position.y = 0.42;
    post.castShadow = true;
    g.add(post);

    // Pneumatic sleeve (mid-post, slightly wider)
    var sleeve = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.036, 0.18, 12),
      PAL.chromeBrushed()
    );
    sleeve.position.y = 0.54;
    g.add(sleeve);

    // Circular base (flat disc)
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.30, 0.04, 24),
      PAL.chromeBrushed()
    );
    base.position.y = 0.02;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // 4 floor glide feet around base rim
    var glideMat = mat(0x111111, { roughness: 0.9 });
    var glideGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.018, 8);
    [0, 1, 2, 3].forEach(function(i) {
      var angle = (i / 4) * Math.PI * 2;
      var glide = new THREE.Mesh(glideGeo, glideMat);
      glide.position.set(Math.cos(angle) * 0.26, 0.009, Math.sin(angle) * 0.26);
      g.add(glide);
    });

    return g;
  }
};
