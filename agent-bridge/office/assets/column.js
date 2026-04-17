import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'column',
  name: 'Column',
  category: 'structural',
  icon: 'Co',
  gridW: 1, gridD: 1, height: 4,
  factory: function() {
    var g = new THREE.Group();

    var marble = PAL.marbleWhite();
    var gold = PAL.gold();

    // Main shaft — cylinder
    var shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15, 0.17, 3.6, 16),
      marble
    );
    shaft.position.y = 0;
    shaft.castShadow = true;
    shaft.receiveShadow = true;
    g.add(shaft);

    // Base plinth (square)
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.2, 0.42),
      marble
    );
    base.position.y = -1.9;
    base.castShadow = true;
    g.add(base);

    // Base plinth bottom step
    var baseStep = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.1, 0.48),
      marble
    );
    baseStep.position.y = -2.0;
    g.add(baseStep);

    // Capital block (top)
    var capital = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.2, 0.44),
      marble
    );
    capital.position.y = 1.9;
    capital.castShadow = true;
    g.add(capital);

    // Capital abacus (wider flat top)
    var abacus = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.5),
      marble
    );
    abacus.position.y = 2.0;
    g.add(abacus);

    // Gold capital ring torus
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.165, 0.025, 8, 24),
      gold
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 1.72;
    ring.castShadow = true;
    g.add(ring);

    // Second gold ring (lower accent)
    var ringLow = new THREE.Mesh(
      new THREE.TorusGeometry(0.175, 0.018, 8, 24),
      gold
    );
    ringLow.rotation.x = Math.PI / 2;
    ringLow.position.y = -1.72;
    g.add(ringLow);

    // Subtle fluting grooves (flat vertical strips on shaft)
    var fluteMat = mat(0xddd8cc, { roughness: 0.2, metalness: 0.05 });
    var i;
    for (i = 0; i < 8; i++) {
      var angle = (i / 8) * Math.PI * 2;
      var flute = new THREE.Mesh(
        new THREE.BoxGeometry(0.018, 3.4, 0.018),
        fluteMat
      );
      flute.position.x = Math.cos(angle) * 0.15;
      flute.position.z = Math.sin(angle) * 0.15;
      g.add(flute);
    }

    return g;
  }
};
