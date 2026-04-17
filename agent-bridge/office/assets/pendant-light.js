import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'pendant_light',
  name: 'Pendant Light',
  category: 'lighting',
  icon: 'PL',
  gridW: 1, gridD: 1, height: 3.0,
  factory: function() {
    var g = new THREE.Group();

    var wireY    = 3.0;   // wire top anchor
    var shadeY   = 2.10;  // bottom of shade
    var R        = 0.12;  // globe radius

    var chromeMat = PAL.chrome();
    var cordMat   = mat(0x1a1a1a, { roughness: 0.90 });

    // Ceiling rose (mount disk)
    var rose = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.018, 20), chromeMat);
    rose.position.y = wireY;
    g.add(rose);

    // Pendant cord (thin cylinder)
    var cordLen = wireY - shadeY - R - 0.01;
    var cord = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, cordLen, 8),
      cordMat
    );
    cord.position.y = shadeY + R + 0.01 + cordLen / 2;
    g.add(cord);

    // Globe shade (hollow sphere shell — DoubleSide)
    var globeOuter = new THREE.Mesh(
      new THREE.SphereGeometry(R, 28, 20),
      mat(0xeae0d0, { transparent: true, opacity: 0.55, roughness: 0.10, side: THREE.DoubleSide })
    );
    globeOuter.position.y = shadeY + R;
    g.add(globeOuter);

    // Internal warm bulb glow
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 14, 10),
      mat(0xfff0cc, { emissive: 0xfff0cc, emissiveIntensity: 1.4, transparent: true, opacity: 0.95 })
    );
    bulb.position.y = shadeY + R;
    g.add(bulb);

    // Chrome neck fitting (top of globe)
    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.025, 14), chromeMat);
    neck.position.y = shadeY + R * 2 - 0.005;
    g.add(neck);

    // Chrome bottom vent ring (open bottom)
    var botRing = new THREE.Mesh(new THREE.TorusGeometry(R - 0.005, 0.005, 8, 28), chromeMat);
    botRing.position.y = shadeY + 0.008;
    g.add(botRing);

    // Point light — hangs at bulb position
    var light = new THREE.PointLight(0xfff0cc, 0.45, 5);
    light.position.y = shadeY + R;
    g.add(light);

    return g;
  }
};
