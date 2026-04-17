import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'desk',
  name: 'Desk',
  category: 'furniture',
  icon: 'Dk',
  gridW: 2, gridD: 1, height: 0.76,
  factory: function() {
    var g = new THREE.Group();

    // Tabletop
    var top = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.05, 0.9),
      mat(0x1e2128, { roughness: 0.35, metalness: 0.05 })
    );
    top.position.y = 0.755;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // Thin edge trim on front
    var edgeTrim = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.03, 0.02),
      mat(0xd4af37, { roughness: 0.25, metalness: 0.75 })
    );
    edgeTrim.position.y = 0.73;
    edgeTrim.position.z = 0.46;
    g.add(edgeTrim);

    // Left side panel (apron)
    var leftApron = new THREE.Mesh(
      new THREE.BoxGeometry(0.03, 0.12, 0.86),
      mat(0x17191f, { roughness: 0.5 })
    );
    leftApron.position.set(-0.975, 0.665, 0);
    leftApron.castShadow = true;
    g.add(leftApron);

    // Right side panel
    var rightApron = leftApron.clone();
    rightApron.position.x = 0.975;
    g.add(rightApron);

    // Back apron
    var backApron = new THREE.Mesh(
      new THREE.BoxGeometry(1.94, 0.12, 0.03),
      mat(0x17191f, { roughness: 0.5 })
    );
    backApron.position.set(0, 0.665, -0.44);
    g.add(backApron);

    // 4 legs — dark metal, tapered feel via scale
    var legMat = mat(0x2a2d35, { roughness: 0.4, metalness: 0.15 });
    var legGeo = new THREE.BoxGeometry(0.07, 0.73, 0.07);
    var positions = [[-0.92, 0.365, 0.38], [0.92, 0.365, 0.38], [-0.92, 0.365, -0.38], [0.92, 0.365, -0.38]];
    positions.forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    // Floor glides (small feet pads)
    var glideMat = mat(0x111111, { roughness: 0.9 });
    var glideGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.015, 8);
    positions.forEach(function(p) {
      var glide = new THREE.Mesh(glideGeo, glideMat);
      glide.position.set(p[0], 0.008, p[2]);
      g.add(glide);
    });

    return g;
  }
};
