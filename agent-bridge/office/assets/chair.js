import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'chair',
  name: 'Office Chair',
  category: 'furniture',
  icon: 'Ch',
  gridW: 1, gridD: 1, height: 1.1,
  factory: function() {
    var g = new THREE.Group();

    // 5-star base — chrome disc
    var baseDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.28, 0.28, 0.025, 5),
      PAL.chrome()
    );
    baseDisc.position.y = 0.02;
    baseDisc.castShadow = true;
    g.add(baseDisc);

    // 5 arms radiating outward
    var armMat = PAL.chrome();
    for (var i = 0; i < 5; i++) {
      var arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.025, 0.045),
        armMat
      );
      arm.position.y = 0.02;
      arm.rotation.y = (i / 5) * Math.PI * 2;
      arm.castShadow = true;
      g.add(arm);

      // Wheel at each arm tip
      var wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 0.04, 10),
        mat(0x1a1a1a, { roughness: 0.9 })
      );
      var angle = (i / 5) * Math.PI * 2;
      wheel.position.set(Math.sin(angle) * 0.26, 0.018, Math.cos(angle) * 0.26);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
    }

    // Central post (pneumatic cylinder)
    var post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.05, 0.46, 12),
      PAL.chromeBrushed()
    );
    post.position.y = 0.26;
    post.castShadow = true;
    g.add(post);

    // Seat cushion
    var seat = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.48),
      PAL.leatherBlack()
    );
    seat.position.y = 0.52;
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat);

    // Seat shell (underside)
    var seatShell = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.03, 0.50),
      mat(0x1e2128, { roughness: 0.6 })
    );
    seatShell.position.y = 0.475;
    g.add(seatShell);

    // Back lower cushion
    var backLow = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.34, 0.07),
      PAL.leatherBlack()
    );
    backLow.position.set(0, 0.77, -0.21);
    backLow.castShadow = true;
    g.add(backLow);

    // Back upper cushion
    var backUp = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.28, 0.07),
      PAL.leatherBlack()
    );
    backUp.position.set(0, 1.03, -0.19);
    backUp.castShadow = true;
    g.add(backUp);

    // Back frame
    var backFrame = new THREE.Mesh(
      new THREE.BoxGeometry(0.52, 0.66, 0.04),
      mat(0x17191f, { roughness: 0.5, metalness: 0.1 })
    );
    backFrame.position.set(0, 0.89, -0.25);
    g.add(backFrame);

    // Left armrest
    var armrestMat = mat(0x1a1a1a, { roughness: 0.75 });
    var leftArm = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.04, 0.22),
      armrestMat
    );
    leftArm.position.set(-0.26, 0.72, -0.05);
    leftArm.castShadow = true;
    g.add(leftArm);

    var rightArm = leftArm.clone();
    rightArm.position.x = 0.26;
    g.add(rightArm);

    // Armrest posts
    var postMat = PAL.chromeBrushed();
    var leftPost = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.2, 0.025), postMat);
    leftPost.position.set(-0.26, 0.62, -0.05);
    g.add(leftPost);
    var rightPost = leftPost.clone();
    rightPost.position.x = 0.26;
    g.add(rightPost);

    return g;
  }
};
