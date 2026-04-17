import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'treadmill',
  name: 'Treadmill',
  category: 'recreation',
  icon: 'TM',
  gridW: 1, gridD: 2, height: 1.2,
  factory: function() {
    var g = new THREE.Group();

    // Base frame
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.20, 1.60),
      mat(0x111318, { roughness: 0.45, metalness: 0.20 })
    );
    base.position.y = 0.10;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Running belt surface (dark rubber)
    var belt = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.018, 1.38),
      mat(0x1a1a1a, { roughness: 0.92 })
    );
    belt.position.y = 0.212;
    belt.receiveShadow = true;
    g.add(belt);

    // Belt edge stripes (yellow safety lines)
    var stripeMat = mat(0xeecc00, { roughness: 0.70 });
    var stripeGeo = new THREE.BoxGeometry(0.025, 0.020, 1.38);
    [-0.255, 0.255].forEach(function(x) {
      var stripe = new THREE.Mesh(stripeGeo, stripeMat);
      stripe.position.set(x, 0.222, 0);
      g.add(stripe);
    });

    // Front roller drum
    var rollerGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.54, 14);
    var rollerMat = PAL.chromeBrushed();
    var frontRoller = new THREE.Mesh(rollerGeo, rollerMat);
    frontRoller.rotation.z = Math.PI / 2;
    frontRoller.position.set(0, 0.21, -0.70);
    frontRoller.castShadow = true;
    g.add(frontRoller);

    // Rear roller
    var rearRoller = new THREE.Mesh(rollerGeo, rollerMat);
    rearRoller.rotation.z = Math.PI / 2;
    rearRoller.position.set(0, 0.21, 0.70);
    rearRoller.castShadow = true;
    g.add(rearRoller);

    // Left handlebar upright
    var upMat = mat(0x1e2128, { roughness: 0.40, metalness: 0.30 });
    var upGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.92, 10);
    var leftUp = new THREE.Mesh(upGeo, upMat);
    leftUp.position.set(-0.28, 0.66, -0.45);
    leftUp.castShadow = true;
    g.add(leftUp);

    // Right handlebar upright
    var rightUp = leftUp.clone();
    rightUp.position.x = 0.28;
    g.add(rightUp);

    // Crossbar connecting uprights
    var crossbar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.56, 10),
      upMat
    );
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.set(0, 1.08, -0.45);
    crossbar.castShadow = true;
    g.add(crossbar);

    // Handlebar grips (foam-style, slightly wider)
    var gripMat = mat(0x222222, { roughness: 0.90 });
    var gripGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.22, 10);
    var leftGrip = new THREE.Mesh(gripGeo, gripMat);
    leftGrip.rotation.z = Math.PI / 2;
    leftGrip.position.set(-0.19, 1.10, -0.45);
    g.add(leftGrip);
    var rightGrip = leftGrip.clone();
    rightGrip.position.x = 0.19;
    g.add(rightGrip);

    // Console display panel
    var consoleStem = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.12, 0.04),
      upMat
    );
    consoleStem.position.set(0, 1.16, -0.45);
    g.add(consoleStem);

    var console_ = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.18, 0.06),
      mat(0x111318, { roughness: 0.45 })
    );
    console_.position.set(0, 1.26, -0.46);
    console_.castShadow = true;
    g.add(console_);

    // Console screen (emissive blue)
    var consoleScreen = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.10, 0.008),
      mat(0x001128, { emissive: 0x0066cc, emissiveIntensity: 0.90, roughness: 0.1 })
    );
    consoleScreen.position.set(0, 1.27, -0.432);
    g.add(consoleScreen);

    // Feet (rubber pads)
    var feetMat = mat(0x0a0a0a, { roughness: 0.92 });
    var feetGeo = new THREE.BoxGeometry(0.10, 0.025, 0.10);
    [[-0.28, 0.012, 0.68], [0.28, 0.012, 0.68], [-0.28, 0.012, -0.68], [0.28, 0.012, -0.68]].forEach(function(p) {
      var foot = new THREE.Mesh(feetGeo, feetMat);
      foot.position.set(p[0], p[1], p[2]);
      g.add(foot);
    });

    return g;
  }
};
