import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'wall_clock',
  name: 'Wall Clock',
  category: 'decor',
  icon: 'Wc',
  gridW: 1, gridD: 1, height: 2.5,
  factory: function() {
    var g = new THREE.Group();

    // Clock face (dark dial)
    var face = new THREE.Mesh(
      new THREE.CylinderGeometry(0.195, 0.195, 0.018, 40),
      mat(0x18191f, { roughness: 0.60 })
    );
    face.position.set(0, 2.5, 0);
    face.rotation.x = Math.PI / 2;
    face.receiveShadow = true;
    g.add(face);

    // Chrome rim ring
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.2, 0.018, 12, 48),
      PAL.chrome()
    );
    rim.position.set(0, 2.5, 0.008);
    rim.castShadow = true;
    g.add(rim);

    // Hour markers (12 small gold dots)
    var markerMat = PAL.gold();
    for (var i = 0; i < 12; i++) {
      var angle = (i / 12) * Math.PI * 2;
      var mx = Math.sin(angle) * 0.155;
      var my = Math.cos(angle) * 0.155;
      var marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.008, 0.008, 0.012, 8),
        markerMat
      );
      marker.position.set(mx, 2.5 + my, 0.016);
      marker.rotation.x = Math.PI / 2;
      g.add(marker);
    }

    // Hour hand (short, gold)
    var hourHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.016, 0.09, 0.010),
      PAL.gold()
    );
    hourHand.position.set(0.028, 2.535, 0.022);
    hourHand.rotation.z = -0.9;
    g.add(hourHand);

    // Minute hand (long, chrome)
    var minHand = new THREE.Mesh(
      new THREE.BoxGeometry(0.011, 0.135, 0.010),
      PAL.chrome()
    );
    minHand.position.set(-0.04, 2.562, 0.024);
    minHand.rotation.z = 0.7;
    g.add(minHand);

    // Center cap
    var cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.014, 12),
      PAL.gold()
    );
    cap.position.set(0, 2.5, 0.022);
    cap.rotation.x = Math.PI / 2;
    g.add(cap);

    // Wall bracket (small block behind)
    var bracket = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.10, 0.04),
      mat(0x111111, { roughness: 0.6, metalness: 0.4 })
    );
    bracket.position.set(0, 2.5, -0.03);
    g.add(bracket);

    return g;
  }
};
