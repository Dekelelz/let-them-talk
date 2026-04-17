import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'gaming-chair',
  name: 'Gaming Chair',
  category: 'furniture',
  icon: 'GC',
  gridW: 1, gridD: 1, height: 1.35,
  factory: function() {
    var g = new THREE.Group();

    // 5-star base
    var baseDisc = new THREE.Mesh(
      new THREE.CylinderGeometry(0.30, 0.30, 0.025, 5),
      PAL.chrome()
    );
    baseDisc.position.y = 0.02;
    baseDisc.castShadow = true;
    g.add(baseDisc);

    for (var i = 0; i < 5; i++) {
      var arm = new THREE.Mesh(
        new THREE.BoxGeometry(0.28, 0.025, 0.05),
        PAL.chrome()
      );
      arm.position.y = 0.02;
      arm.rotation.y = (i / 5) * Math.PI * 2;
      arm.castShadow = true;
      g.add(arm);

      var wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.035, 0.045, 10),
        mat(0x1a1a1a, { roughness: 0.9 })
      );
      var angle = (i / 5) * Math.PI * 2;
      wheel.position.set(Math.sin(angle) * 0.28, 0.018, Math.cos(angle) * 0.28);
      wheel.rotation.z = Math.PI / 2;
      g.add(wheel);
    }

    // Pneumatic post
    var post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.055, 0.44, 12),
      PAL.chromeBrushed()
    );
    post.position.y = 0.255;
    post.castShadow = true;
    g.add(post);

    // Seat shell (bucket-style, wider than office chair)
    var seatShell = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.06, 0.54),
      mat(0x111318, { roughness: 0.5, metalness: 0.15 })
    );
    seatShell.position.y = 0.5;
    seatShell.castShadow = true;
    g.add(seatShell);

    // Seat cushion — black main with red stripe
    var seatCushion = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.08, 0.50),
      PAL.leatherBlack()
    );
    seatCushion.position.y = 0.545;
    seatCushion.castShadow = true;
    seatCushion.receiveShadow = true;
    g.add(seatCushion);

    // Center stripe on seat
    var seatStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.09, 0.50),
      mat(0xcc1111, { roughness: 0.65 })
    );
    seatStripe.position.y = 0.545;
    g.add(seatStripe);

    // Tall racing back (wider, taller than office chair)
    var backBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.76, 0.09),
      mat(0x111318, { roughness: 0.5, metalness: 0.12 })
    );
    backBody.position.set(0, 0.95, -0.24);
    backBody.castShadow = true;
    g.add(backBody);

    // Back cushion
    var backCushion = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.7, 0.07),
      PAL.leatherBlack()
    );
    backCushion.position.set(0, 0.95, -0.20);
    backCushion.castShadow = true;
    g.add(backCushion);

    // Back center accent stripe
    var backStripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.7, 0.08),
      mat(0xcc1111, { roughness: 0.65 })
    );
    backStripe.position.set(0, 0.95, -0.19);
    g.add(backStripe);

    // Headrest (attached top)
    var headrest = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.20, 0.09),
      PAL.leatherBlack()
    );
    headrest.position.set(0, 1.38, -0.24);
    headrest.castShadow = true;
    g.add(headrest);

    // Headrest pad
    var headPad = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.15, 0.06),
      mat(0xcc1111, { roughness: 0.65 })
    );
    headPad.position.set(0, 1.38, -0.20);
    g.add(headPad);

    // Lumbar support pillow
    var lumbar = new THREE.Mesh(
      new THREE.BoxGeometry(0.30, 0.16, 0.07),
      mat(0xcc1111, { roughness: 0.65 })
    );
    lumbar.position.set(0, 0.66, -0.17);
    lumbar.castShadow = true;
    g.add(lumbar);

    // Armrests (height-adjustable style)
    var armMat = mat(0x1a1a1a, { roughness: 0.7 });
    var leftArmRest = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.04, 0.24),
      armMat
    );
    leftArmRest.position.set(-0.30, 0.74, -0.06);
    leftArmRest.castShadow = true;
    g.add(leftArmRest);

    var rightArmRest = leftArmRest.clone();
    rightArmRest.position.x = 0.30;
    g.add(rightArmRest);

    // Armrest posts
    var lPost = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.03), PAL.chromeBrushed());
    lPost.position.set(-0.30, 0.63, -0.06);
    g.add(lPost);
    var rPost = lPost.clone();
    rPost.position.x = 0.30;
    g.add(rPost);

    return g;
  }
};
