import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'gaming-desk',
  name: 'Gaming Desk',
  category: 'furniture',
  icon: 'GD',
  gridW: 3, gridD: 1, height: 0.76,
  factory: function() {
    var g = new THREE.Group();

    // Main top surface (wide section)
    var mainTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.04, 1.0),
      mat(0x111318, { roughness: 0.28, metalness: 0.08 })
    );
    mainTop.position.y = 0.76;
    mainTop.castShadow = true;
    mainTop.receiveShadow = true;
    g.add(mainTop);

    // L-wing (right extension)
    var wing = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.04, 0.7),
      mat(0x111318, { roughness: 0.28, metalness: 0.08 })
    );
    wing.position.set(1.1, 0.76, -0.15);
    wing.castShadow = true;
    wing.receiveShadow = true;
    g.add(wing);

    // Monitor riser platform
    var riser = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.28),
      mat(0x1a1c22, { roughness: 0.45, metalness: 0.12 })
    );
    riser.position.set(-0.2, 0.82, -0.28);
    riser.castShadow = true;
    g.add(riser);

    // Riser legs (2 small supports)
    var riserLegMat = mat(0x2a2d35, { roughness: 0.5 });
    var riserLeg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.06), riserLegMat);
    riserLeg.position.set(-0.85, 0.78, -0.28);
    g.add(riserLeg);
    var riserLeg2 = riserLeg.clone();
    riserLeg2.position.x = 0.45;
    g.add(riserLeg2);

    // RGB LED strip along front edge (emissive cyan)
    var led = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.012, 0.015),
      mat(0x06b6d4, { emissive: 0x06b6d4, emissiveIntensity: 0.9, roughness: 0.3 })
    );
    led.position.set(0, 0.742, 0.508);
    g.add(led);

    // LED strip on wing front edge
    var ledWing = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.012, 0.015),
      mat(0x06b6d4, { emissive: 0x06b6d4, emissiveIntensity: 0.9, roughness: 0.3 })
    );
    ledWing.position.set(1.1, 0.742, 0.157);
    g.add(ledWing);

    // Cable channel tray (under desk, rear)
    var cableTray = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.04, 0.08),
      mat(0x1a1c22, { roughness: 0.8 })
    );
    cableTray.position.set(0, 0.58, -0.44);
    g.add(cableTray);

    // 4 legs (angular, steel-look)
    var legMat = mat(0x1e2128, { roughness: 0.3, metalness: 0.55 });
    var legGeo = new THREE.BoxGeometry(0.07, 0.74, 0.07);
    var mainLegs = [[-0.97, 0.37, 0.44], [0.77, 0.37, 0.44], [-0.97, 0.37, -0.44]];
    mainLegs.forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    // Wing leg
    var wingLeg = new THREE.Mesh(
      new THREE.BoxGeometry(0.07, 0.74, 0.07),
      legMat
    );
    wingLeg.position.set(1.55, 0.37, -0.28);
    wingLeg.castShadow = true;
    g.add(wingLeg);

    // Connecting crossbar
    var crossbar = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.04, 0.9),
      legMat
    );
    crossbar.position.set(-0.97, 0.28, 0);
    g.add(crossbar);

    return g;
  }
};
