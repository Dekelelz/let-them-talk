import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'cactus',
  name: 'Cactus',
  category: 'nature',
  icon: 'Ca',
  gridW: 1, gridD: 1, height: 0.5,
  factory: function() {
    var g = new THREE.Group();

    // Terracotta pot — warm dark tone
    var pot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.072, 0.165, 16),
      mat(0x3d1f10, { roughness: 0.85 })
    );
    pot.position.y = 0.083;
    pot.castShadow = true;
    pot.receiveShadow = true;
    g.add(pot);

    // Pot rim detail
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.098, 0.013, 8, 20),
      mat(0x2a1208, { roughness: 0.80 })
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.163;
    g.add(rim);

    // Gravel / soil surface
    var soil = new THREE.Mesh(
      new THREE.CylinderGeometry(0.083, 0.083, 0.014, 16),
      mat(0x1e1c18, { roughness: 0.99 })
    );
    soil.position.y = 0.175;
    g.add(soil);

    // Cactus main body — fat cylinder, green
    var cactusMat = mat(0x2a6030, { roughness: 0.70 });
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.065, 0.30, 10),
      cactusMat
    );
    body.position.y = 0.33;
    body.castShadow = true;
    g.add(body);

    // Cactus rib lines (darker vertical strips)
    var ribMat = mat(0x1e4a22, { roughness: 0.75 });
    for (var i = 0; i < 5; i++) {
      var ribAngle = (i / 5) * Math.PI * 2;
      var rib = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.28, 0.014),
        ribMat
      );
      rib.position.set(
        Math.sin(ribAngle) * 0.048,
        0.33,
        Math.cos(ribAngle) * 0.048
      );
      rib.rotation.y = -ribAngle;
      g.add(rib);
    }

    // Spines — small white/cream cones
    var spineMat = mat(0xe8e0cc, { roughness: 0.60 });
    var spineRows = [{ y: 0.22, r: 0.062 }, { y: 0.32, r: 0.060 }, { y: 0.42, r: 0.056 }];
    spineRows.forEach(function(row) {
      for (var s = 0; s < 8; s++) {
        var sa = (s / 8) * Math.PI * 2;
        var spine = new THREE.Mesh(
          new THREE.ConeGeometry(0.004, 0.025, 4),
          spineMat
        );
        spine.position.set(
          Math.sin(sa) * row.r,
          row.y,
          Math.cos(sa) * row.r
        );
        spine.rotation.z = Math.PI / 2 - 0.2;
        spine.rotation.y = -sa;
        g.add(spine);
      }
    });

    // Top of cactus — slightly rounded cap
    var cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 10, 8),
      cactusMat
    );
    cap.scale.y = 0.55;
    cap.position.y = 0.480;
    cap.castShadow = true;
    g.add(cap);

    return g;
  }
};
