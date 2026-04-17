import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'monitor',
  name: 'Monitor',
  category: 'tech',
  icon: 'Mo',
  gridW: 1, gridD: 1, height: 0.5,
  factory: function() {
    var g = new THREE.Group();

    // Bezel outer frame
    var bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.50, 0.35, 0.03),
      mat(0x111214, { roughness: 0.45, metalness: 0.10 })
    );
    bezel.position.y = 0.38;
    bezel.castShadow = true;
    g.add(bezel);

    // Screen inner panel (emissive glow)
    var screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.29, 0.012),
      mat(0x0a1628, { emissive: 0x1a4a8a, emissiveIntensity: 0.55, roughness: 0.05 })
    );
    screen.position.y = 0.38;
    screen.position.z = 0.012;
    g.add(screen);

    // Screen glare strip (top highlight)
    var glare = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.04, 0.001),
      mat(0xaaccff, { transparent: true, opacity: 0.08, roughness: 0.0 })
    );
    glare.position.set(0, 0.505, 0.019);
    g.add(glare);

    // Chrome neck / stem
    var neck = new THREE.Mesh(
      new THREE.BoxGeometry(0.035, 0.12, 0.035),
      PAL.chrome()
    );
    neck.position.y = 0.175;
    neck.castShadow = true;
    g.add(neck);

    // Chrome base disk
    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.14, 0.025, 24),
      PAL.chrome()
    );
    base.position.y = 0.013;
    base.castShadow = true;
    g.add(base);

    // Power LED dot
    var led = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 8, 8),
      mat(0x00e5ff, { emissive: 0x00e5ff, emissiveIntensity: 1.0 })
    );
    led.position.set(0.18, 0.215, 0.016);
    g.add(led);

    return g;
  }
};
