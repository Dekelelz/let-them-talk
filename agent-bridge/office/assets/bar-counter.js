import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'bar_counter',
  name: 'Bar Counter',
  category: 'kitchen',
  icon: 'Ba',
  gridW: 3, gridD: 1, height: 1.1,
  factory: function() {
    var g = new THREE.Group();

    // Walnut countertop
    var top = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.06, 1.2),
      PAL.walnutDark()
    );
    top.position.y = 1.1;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // Countertop front overhang edge strip (gold trim)
    var edgeTrim = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.025, 0.02),
      PAL.gold()
    );
    edgeTrim.position.set(0, 1.075, 0.61);
    g.add(edgeTrim);

    // Main front panel (dark)
    var frontPanel = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.92, 0.06),
      mat(0x111318, { roughness: 0.45, metalness: 0.10 })
    );
    frontPanel.position.set(0, 0.59, 0.57);
    frontPanel.castShadow = true;
    g.add(frontPanel);

    // Cabinet body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(2.96, 0.90, 1.08),
      mat(0x16181e, { roughness: 0.50 })
    );
    body.position.set(0, 0.59, 0);
    body.castShadow = true;
    g.add(body);

    // LED underglow strip — neon blue emissive bar under front panel
    var led = new THREE.Mesh(
      new THREE.BoxGeometry(2.9, 0.015, 0.025),
      mat(0x58a6ff, { emissive: 0x58a6ff, emissiveIntensity: 1.2, roughness: 0.3 })
    );
    led.position.set(0, 0.085, 0.575);
    g.add(led);

    // PointLight for LED underglow
    var glow = new THREE.PointLight(0x58a6ff, 0.6, 1.8);
    glow.position.set(0, 0.06, 0.5);
    g.add(glow);

    // Base plinth (dark metal strip at floor)
    var plinth = new THREE.Mesh(
      new THREE.BoxGeometry(3.0, 0.08, 1.2),
      PAL.darkMetal()
    );
    plinth.position.y = 0.04;
    plinth.castShadow = true;
    g.add(plinth);

    // Vertical divider panels inside (3 sections)
    var dividerMat = mat(0x1e2128, { roughness: 0.55 });
    var dividerGeo = new THREE.BoxGeometry(0.04, 0.86, 1.04);
    [-1.0, 0, 1.0].forEach(function(x) {
      var d = new THREE.Mesh(dividerGeo, dividerMat);
      d.position.set(x, 0.59, 0);
      g.add(d);
    });

    // Chrome rail along bar top front edge
    var rail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 3.0, 10),
      PAL.chrome()
    );
    rail.rotation.z = Math.PI / 2;
    rail.position.set(0, 1.14, 0.58);
    g.add(rail);

    return g;
  }
};
