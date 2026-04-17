import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'trash_can',
  name: 'Trash Can',
  category: 'exterior',
  icon: 'TC',
  gridW: 1, gridD: 1, height: 0.7,
  factory: function() {
    var g = new THREE.Group();

    // Main cylindrical body — dark metal, slightly tapered (wider at top)
    var body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.120, 0.62, 18),
      mat(0x1a1c22, { roughness: 0.50, metalness: 0.30 })
    );
    body.position.y = 0.34;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Chrome top rim ring
    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.148, 0.016, 8, 22),
      PAL.chrome()
    );
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.656;
    g.add(rim);

    // Chrome bottom rim ring
    var bottomRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.124, 0.012, 8, 22),
      PAL.chrome()
    );
    bottomRim.rotation.x = Math.PI / 2;
    bottomRim.position.y = 0.032;
    g.add(bottomRim);

    // Lid (slightly domed cap)
    var lid = new THREE.Mesh(
      new THREE.CylinderGeometry(0.148, 0.148, 0.040, 18),
      mat(0x111318, { roughness: 0.45, metalness: 0.25 })
    );
    lid.position.y = 0.680;
    lid.castShadow = true;
    g.add(lid);

    // Lid handle (small chrome knob)
    var knob = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.022, 0.032, 10),
      PAL.chrome()
    );
    knob.position.y = 0.716;
    g.add(knob);

    // Vertical embossed ribs on body (8 ribs)
    var ribMat = mat(0x0e1014, { roughness: 0.55 });
    var ribGeo = new THREE.BoxGeometry(0.012, 0.58, 0.014);
    for (var i = 0; i < 8; i++) {
      var angle = (i / 8) * Math.PI * 2;
      var rib = new THREE.Mesh(ribGeo, ribMat);
      rib.position.set(Math.cos(angle) * 0.138, 0.34, Math.sin(angle) * 0.138);
      rib.rotation.y = -angle;
      g.add(rib);
    }

    // Perforated pattern dots (small recessed circles on front face — 3x4 grid)
    var holeMat = mat(0x0a0c10, { roughness: 0.70 });
    var holeGeo = new THREE.CylinderGeometry(0.010, 0.010, 0.008, 8);
    [-1, 0, 1].forEach(function(col) {
      [0.55, 0.42, 0.30, 0.18].forEach(function(y) {
        var hole = new THREE.Mesh(holeGeo, holeMat);
        hole.rotation.x = Math.PI / 2;
        hole.position.set(col * 0.038, y, 0.142);
        g.add(hole);
      });
    });

    return g;
  }
};
