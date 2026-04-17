import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'dual_monitor',
  name: 'Dual Monitor',
  category: 'tech',
  icon: 'DM',
  gridW: 1, gridD: 1, height: 0.5,
  factory: function() {
    var g = new THREE.Group();

    var chromeMat = PAL.chrome();
    var bezelMat  = mat(0x111214, { roughness: 0.45, metalness: 0.10 });
    var screenMat = mat(0x0a1628, { emissive: 0x1a4a8a, emissiveIntensity: 0.55, roughness: 0.05 });

    // Build one monitor panel (reused twice)
    function makePanel(xOffset) {
      var grp = new THREE.Group();

      var bezel = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.30, 0.025), bezelMat);
      bezel.position.y = 0.38;
      bezel.castShadow = true;
      grp.add(bezel);

      var screen = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.25, 0.010), screenMat);
      screen.position.set(0, 0.38, 0.013);
      grp.add(screen);

      // thin side border accent
      var accent = new THREE.Mesh(new THREE.BoxGeometry(0.005, 0.30, 0.026), chromeMat);
      accent.position.set(0.22, 0.38, 0);
      grp.add(accent);

      grp.position.x = xOffset;
      return grp;
    }

    g.add(makePanel(-0.235));
    g.add(makePanel( 0.235));

    // Shared horizontal arm bar
    var arm = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.022, 0.022), chromeMat);
    arm.position.y = 0.22;
    arm.castShadow = true;
    g.add(arm);

    // Vertical pole from arm to base
    var pole = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.22, 0.025), chromeMat);
    pole.position.y = 0.11;
    pole.castShadow = true;
    g.add(pole);

    // Heavy weighted base
    var base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.028, 0.18), chromeMat);
    base.position.y = 0.014;
    base.castShadow = true;
    g.add(base);

    // Two LED dots (one per screen)
    [-0.235, 0.235].forEach(function(x) {
      var led = new THREE.Mesh(
        new THREE.SphereGeometry(0.007, 8, 8),
        mat(0x00e5ff, { emissive: 0x00e5ff, emissiveIntensity: 1.0 })
      );
      led.position.set(x + 0.16, 0.215, 0.014);
      g.add(led);
    });

    return g;
  }
};
