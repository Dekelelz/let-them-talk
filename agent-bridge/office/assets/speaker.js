import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'speaker',
  name: 'Bluetooth Speaker',
  category: 'tech',
  icon: 'Sp',
  gridW: 1, gridD: 1, height: 0.25,
  factory: function() {
    var g = new THREE.Group();

    var R = 0.075;   // radius
    var LEN = 0.15;  // cylinder length (axis = Z)

    // Main body — anodised dark cylinder
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(R, R, LEN, 32),
      mat(0x1a1c20, { roughness: 0.38, metalness: 0.30 })
    );
    body.rotation.x = Math.PI / 2;
    body.position.y = R;
    body.castShadow = true;
    g.add(body);

    // Woven fabric grille band (slightly lighter, rough)
    var grille = new THREE.Mesh(
      new THREE.CylinderGeometry(R + 0.001, R + 0.001, LEN * 0.70, 32),
      mat(0x2a2d32, { roughness: 0.92 })
    );
    grille.rotation.x = Math.PI / 2;
    grille.position.y = R;
    g.add(grille);

    // Driver cone (front face)
    var cone = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.035, 0.010, 32),
      mat(0x0e0f10, { roughness: 0.50, metalness: 0.20 })
    );
    cone.rotation.x = Math.PI / 2;
    cone.position.set(0, R, LEN / 2 + 0.004);
    g.add(cone);

    // Dust cap center of driver
    var dustCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      mat(0x080808, { roughness: 0.60 })
    );
    dustCap.rotation.x = Math.PI / 2;
    dustCap.position.set(0, R, LEN / 2 + 0.014);
    g.add(dustCap);

    // LED ring (around driver, glowing cyan)
    var ledRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.048, 0.005, 8, 32),
      mat(0x00e5ff, { emissive: 0x00c8e0, emissiveIntensity: 0.85 })
    );
    ledRing.rotation.x = Math.PI / 2;
    ledRing.position.set(0, R, LEN / 2 + 0.006);
    g.add(ledRing);

    // End caps (chrome rings each side)
    [-1, 1].forEach(function(side) {
      var cap = new THREE.Mesh(
        new THREE.CylinderGeometry(R, R, 0.012, 32),
        PAL.chrome()
      );
      cap.rotation.x = Math.PI / 2;
      cap.position.set(0, R, side * (LEN / 2 + 0.004));
      g.add(cap);
    });

    // Volume button strip on top of body
    var volStrip = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.009, 0.014),
      mat(0x888888, { roughness: 0.25, metalness: 0.70 })
    );
    volStrip.position.set(0, R * 2 - 0.005, 0.02);
    g.add(volStrip);

    return g;
  }
};
