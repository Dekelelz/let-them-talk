import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'foosball',
  name: 'Foosball Table',
  category: 'recreation',
  icon: 'FB',
  gridW: 2, gridD: 1, height: 0.85,
  factory: function() {
    var g = new THREE.Group();

    // Main body box
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(1.40, 0.22, 0.75),
      mat(0x111318, { roughness: 0.50, metalness: 0.10 })
    );
    body.position.y = 0.74;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Playing field (green felt base)
    var field = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.010, 0.60),
      PAL.greenFelt()
    );
    field.position.y = 0.856;
    field.receiveShadow = true;
    g.add(field);

    // White center circle
    var circle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.055, 0.012, 18),
      mat(0xffffff, { roughness: 0.80 })
    );
    circle.position.y = 0.864;
    g.add(circle);

    // Goals at each end (small cut-out feel — dark recess boxes)
    var goalMat = mat(0x0a0a0a, { roughness: 0.70 });
    [-0.62, 0.62].forEach(function(x) {
      var goal = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.10, 0.22),
        goalMat
      );
      goal.position.set(x, 0.83, 0);
      g.add(goal);
    });

    // Top rails (sides of the table)
    var topRailMat = mat(0x1c1f26, { roughness: 0.45 });
    var topRailGeo = new THREE.BoxGeometry(1.40, 0.06, 0.04);
    [0.375, -0.375].forEach(function(z) {
      var rail = new THREE.Mesh(topRailGeo, topRailMat);
      rail.position.set(0, 0.875, z);
      g.add(rail);
    });

    // 3 chrome rods through the table (horizontal, side to side)
    var rodMat = PAL.chrome();
    var rodGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.92, 12);
    [-0.45, 0, 0.45].forEach(function(x) {
      var rod = new THREE.Mesh(rodGeo, rodMat);
      rod.rotation.z = Math.PI / 2;
      rod.position.set(x, 0.855, 0);
      rod.castShadow = true;
      g.add(rod);
    });

    // Player figures on rods (small dark cylinders)
    var playerMat = mat(0x222222, { roughness: 0.60 });
    var playerGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.09, 8);
    [-0.45, 0, 0.45].forEach(function(x) {
      [-0.18, 0, 0.18].forEach(function(z) {
        var player = new THREE.Mesh(playerGeo, playerMat);
        player.rotation.z = Math.PI / 2;
        player.position.set(x, 0.855, z);
        g.add(player);
      });
    });

    // 4 legs
    var legGeo = new THREE.BoxGeometry(0.08, 0.68, 0.08);
    var legMat = mat(0x16181d, { roughness: 0.55 });
    [[-0.62, 0.34, 0.31], [0.62, 0.34, 0.31], [-0.62, 0.34, -0.31], [0.62, 0.34, -0.31]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    return g;
  }
};
