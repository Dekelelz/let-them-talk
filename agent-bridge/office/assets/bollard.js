import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'bollard',
  name: 'Bollard',
  category: 'exterior',
  icon: 'Bo',
  gridW: 1, gridD: 1, height: 0.8,
  factory: function() {
    var g = new THREE.Group();

    // Main concrete cylindrical body (slightly tapered at bottom)
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.095, 0.110, 0.72, 16),
      PAL.concrete()
    );
    body.position.y = 0.38;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Domed cap (rounded top)
    var cap = new THREE.Mesh(
      new THREE.SphereGeometry(0.098, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5),
      mat(0x222530, { roughness: 0.75 })
    );
    cap.position.y = 0.740;
    cap.castShadow = true;
    g.add(cap);

    // Reflective yellow safety band (wide stripe near top)
    var yellowBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.097, 0.097, 0.065, 16),
      mat(0xffcc00, { roughness: 0.35, metalness: 0.10, emissive: 0xffcc00, emissiveIntensity: 0.15 })
    );
    yellowBand.position.y = 0.62;
    g.add(yellowBand);

    // Narrow black divider bands above and below yellow
    var divMat = mat(0x0a0a0a, { roughness: 0.75 });
    var divGeo = new THREE.CylinderGeometry(0.098, 0.098, 0.014, 16);
    [0.587, 0.657].forEach(function(y) {
      var div = new THREE.Mesh(divGeo, divMat);
      div.position.y = y;
      g.add(div);
    });

    // Secondary narrow grey band mid-body
    var greyBand = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1015, 0.1015, 0.022, 16),
      mat(0x3a3d45, { roughness: 0.55 })
    );
    greyBand.position.y = 0.30;
    g.add(greyBand);

    // Embedded anchor ring at base (chrome)
    var anchor = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.010, 6, 14),
      PAL.chromeBrushed()
    );
    anchor.rotation.x = Math.PI / 2;
    anchor.position.y = 0.055;
    g.add(anchor);

    // Ground base plate (flush with floor, dark concrete)
    var plate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.130, 0.130, 0.028, 16),
      mat(0x1a1d24, { roughness: 0.90 })
    );
    plate.position.y = 0.014;
    plate.receiveShadow = true;
    g.add(plate);

    // 4 small anchor bolts around base plate
    var boltMat = PAL.chromeBrushed();
    var boltGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.030, 6);
    [0, 1, 2, 3].forEach(function(i) {
      var angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      var bolt = new THREE.Mesh(boltGeo, boltMat);
      bolt.position.set(Math.cos(angle) * 0.108, 0.015, Math.sin(angle) * 0.108);
      g.add(bolt);
    });

    return g;
  }
};
