import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'reception-desk',
  name: 'Reception Desk',
  category: 'office',
  icon: 'RD',
  gridW: 4, gridD: 2, height: 1.1,
  factory: function() {
    var g = new THREE.Group();

    var bodyMat = mat(0x17191f, { roughness: 0.55, metalness: 0.10 });
    var marbleMat = PAL.marbleBlack();
    var ledMat = mat(0x58a6ff, { emissive: 0x58a6ff, emissiveIntensity: 0.7, roughness: 0.2 });

    // === MAIN COUNTER (long front section) ===
    // Counter body
    var mainBody = new THREE.Mesh(
      new THREE.BoxGeometry(4.0, 1.0, 0.65),
      bodyMat
    );
    mainBody.position.set(0, 0.5, 0);
    mainBody.castShadow = true;
    mainBody.receiveShadow = true;
    g.add(mainBody);

    // Marble top — main
    var mainTop = new THREE.Mesh(
      new THREE.BoxGeometry(4.04, 0.06, 0.69),
      marbleMat
    );
    mainTop.position.set(0, 1.03, 0);
    mainTop.castShadow = true;
    g.add(mainTop);

    // Front panel fascia (slightly raised detail strip)
    var fascia = new THREE.Mesh(
      new THREE.BoxGeometry(3.96, 0.55, 0.02),
      mat(0x1e2128, { roughness: 0.4, metalness: 0.18 })
    );
    fascia.position.set(0, 0.52, 0.335);
    g.add(fascia);

    // LED underglow strip — main front
    var ledStrip = new THREE.Mesh(
      new THREE.BoxGeometry(3.96, 0.018, 0.025),
      ledMat
    );
    ledStrip.position.set(0, 0.065, 0.332);
    g.add(ledStrip);

    // Vertical divider panels on fascia (3 evenly spaced)
    var divMat = mat(0x252830, { roughness: 0.5, metalness: 0.15 });
    [-1.32, 0, 1.32].forEach(function(x) {
      var div = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.52, 0.022), divMat);
      div.position.set(x, 0.52, 0.336);
      g.add(div);
    });

    // === WING SECTION (shorter right-angle return) ===
    var wingBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.0, 0.65),
      bodyMat
    );
    wingBody.position.set(2.0, 0.5, 0.925);
    wingBody.rotation.y = Math.PI / 2;
    wingBody.castShadow = true;
    wingBody.receiveShadow = true;
    g.add(wingBody);

    // Wing marble top
    var wingTop = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.06, 0.69),
      marbleMat
    );
    wingTop.position.set(2.0, 1.03, 0.925);
    wingTop.rotation.y = Math.PI / 2;
    wingTop.castShadow = true;
    g.add(wingTop);

    // Wing front fascia
    var wingFascia = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.55, 1.16),
      mat(0x1e2128, { roughness: 0.4, metalness: 0.18 })
    );
    wingFascia.position.set(2.335, 0.52, 0.925);
    g.add(wingFascia);

    // Wing LED underglow
    var wingLed = new THREE.Mesh(
      new THREE.BoxGeometry(0.025, 0.018, 1.16),
      ledMat
    );
    wingLed.position.set(2.333, 0.065, 0.925);
    g.add(wingLed);

    // Corner connector piece (fills the gap)
    var corner = new THREE.Mesh(
      new THREE.BoxGeometry(0.65, 1.0, 0.65),
      bodyMat
    );
    corner.position.set(2.0, 0.5, 0.325);
    corner.castShadow = true;
    g.add(corner);

    // Corner marble top
    var cornerTop = new THREE.Mesh(
      new THREE.BoxGeometry(0.69, 0.06, 0.69),
      marbleMat
    );
    cornerTop.position.set(2.0, 1.03, 0.325);
    g.add(cornerTop);

    // Inside rear shelf (staff side) — main
    var innerShelf = new THREE.Mesh(
      new THREE.BoxGeometry(3.8, 0.03, 0.42),
      mat(0x1e2128, { roughness: 0.5 })
    );
    innerShelf.position.set(0, 0.72, -0.1);
    g.add(innerShelf);

    // Monitor mount riser on inner shelf
    var riser = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.06, 0.30),
      mat(0x252830, { roughness: 0.45 })
    );
    riser.position.set(-0.8, 0.755, -0.1);
    g.add(riser);

    return g;
  }
};
