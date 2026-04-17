import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'floor_lamp',
  name: 'Floor Lamp',
  category: 'lighting',
  icon: 'FL',
  gridW: 1, gridD: 1, height: 1.8,
  factory: function() {
    var g = new THREE.Group();

    var poleMat  = PAL.chromeBrushed();
    var shadeMat = mat(0xf5e8d0, { transparent: true, opacity: 0.70, roughness: 0.50, side: THREE.DoubleSide });
    var baseMat  = mat(0x1a1c22, { roughness: 0.40, metalness: 0.55 });

    // Round weighted base disk
    var base = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.22, 0.04, 32), baseMat);
    base.position.y = 0.020;
    base.castShadow = true;
    g.add(base);

    // Base rim chrome ring
    var rim = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.010, 8, 32), PAL.chrome());
    rim.position.y = 0.040;
    g.add(rim);

    // Tall pole (two sections for realism)
    var poleBot = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.05, 16), poleMat);
    poleBot.position.y = 0.065 + 0.525;
    poleBot.castShadow = true;
    g.add(poleBot);

    var poleTop = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.65, 16), poleMat);
    poleTop.position.y = 0.065 + 1.05 + 0.325;
    poleTop.castShadow = true;
    g.add(poleTop);

    // Pole join collar
    var collar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.030, 16), PAL.chrome());
    collar.position.y = 0.065 + 1.05;
    g.add(collar);

    // Cone shade
    var shade = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.28, 32, 1, true), shadeMat);
    shade.position.y = 1.65;
    g.add(shade);

    // Shade top cap
    var topCap = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.025, 16), poleMat);
    topCap.position.y = 1.80;
    g.add(topCap);

    // Warm bulb glow sphere
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.030, 16, 12),
      mat(0xffeedd, { emissive: 0xffeedd, emissiveIntensity: 1.2, transparent: true, opacity: 0.90 })
    );
    bulb.position.y = 1.68;
    g.add(bulb);

    // Point light
    var light = new THREE.PointLight(0xffeedd, 0.3, 4);
    light.position.y = 1.65;
    g.add(light);

    return g;
  }
};
