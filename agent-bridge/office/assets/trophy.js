import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'trophy',
  name: 'Trophy',
  category: 'decor',
  icon: 'Tr',
  gridW: 1, gridD: 1, height: 0.35,
  factory: function() {
    var g = new THREE.Group();

    // Walnut base slab
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.055, 0.12),
      PAL.walnutDark()
    );
    base.position.y = 0.028;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    // Base nameplate strip
    var plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.018, 0.005),
      PAL.gold()
    );
    plate.position.set(0, 0.032, 0.062);
    g.add(plate);

    // Trophy stem lower (narrow rod)
    var stemLow = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.022, 0.07, 12),
      PAL.gold()
    );
    stemLow.position.y = 0.09;
    stemLow.castShadow = true;
    g.add(stemLow);

    // Trophy stem mid (wider knob)
    var knob = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 14, 14),
      PAL.gold()
    );
    knob.position.y = 0.145;
    knob.castShadow = true;
    g.add(knob);

    // Trophy stem upper (narrow rod)
    var stemUp = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.015, 0.055, 12),
      PAL.gold()
    );
    stemUp.position.y = 0.195;
    stemUp.castShadow = true;
    g.add(stemUp);

    // Cup body (wide at top, narrow at base)
    var cup = new THREE.Mesh(
      new THREE.CylinderGeometry(0.065, 0.025, 0.10, 18),
      PAL.gold()
    );
    cup.position.y = 0.27;
    cup.castShadow = true;
    g.add(cup);

    // Left handle
    var handleL = new THREE.Mesh(
      new THREE.TorusGeometry(0.025, 0.007, 8, 14, Math.PI),
      PAL.gold()
    );
    handleL.position.set(-0.078, 0.275, 0);
    handleL.rotation.y = Math.PI / 2;
    handleL.castShadow = true;
    g.add(handleL);

    // Right handle
    var handleR = new THREE.Mesh(
      new THREE.TorusGeometry(0.025, 0.007, 8, 14, Math.PI),
      PAL.gold()
    );
    handleR.position.set(0.078, 0.275, 0);
    handleR.rotation.y = -Math.PI / 2;
    handleR.castShadow = true;
    g.add(handleR);

    return g;
  }
};
