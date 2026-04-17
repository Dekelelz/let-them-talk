import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'street_lamp',
  name: 'Street Lamp',
  category: 'exterior',
  icon: 'SL',
  gridW: 1, gridD: 1, height: 3.5,
  factory: function() {
    var g = new THREE.Group();

    // Main pole — dark metal, slight taper
    var pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.040, 0.060, 3.20, 12),
      PAL.darkMetal()
    );
    pole.position.y = 1.60;
    pole.castShadow = true;
    g.add(pole);

    // Pole base collar (decorative flared ring)
    var collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.110, 0.130, 0.10, 16),
      mat(0x1a1c22, { roughness: 0.45, metalness: 0.25 })
    );
    collar.position.y = 0.05;
    collar.castShadow = true;
    g.add(collar);

    // Base plate
    var basePlate = new THREE.Mesh(
      new THREE.CylinderGeometry(0.130, 0.130, 0.045, 16),
      PAL.darkMetal()
    );
    basePlate.position.y = 0.022;
    g.add(basePlate);

    // Decorative ring mid-pole
    var midRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.014, 8, 18),
      mat(0x2a2d35, { roughness: 0.40, metalness: 0.30 })
    );
    midRing.position.y = 1.80;
    g.add(midRing);

    // Curved arm / goose-neck extending from top
    var arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.022, 0.030, 0.50, 10),
      PAL.darkMetal()
    );
    arm.rotation.z = Math.PI / 4;
    arm.position.set(0.18, 3.28, 0);
    arm.castShadow = true;
    g.add(arm);

    // Lantern head housing
    var lanternBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.090, 0.110, 0.20, 10),
      mat(0x111318, { roughness: 0.40, metalness: 0.25 })
    );
    lanternBody.position.set(0.32, 3.44, 0);
    lanternBody.castShadow = true;
    g.add(lanternBody);

    // Lantern top cap
    var lanternCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.095, 0.06, 10),
      PAL.darkMetal()
    );
    lanternCap.position.set(0.32, 3.57, 0);
    g.add(lanternCap);

    // Lantern glass (warm glowing panel)
    var glass = new THREE.Mesh(
      new THREE.CylinderGeometry(0.085, 0.085, 0.15, 10),
      mat(0xfff0cc, { transparent: true, opacity: 0.65, emissive: 0xffcc66, emissiveIntensity: 0.70, roughness: 0.10 })
    );
    glass.position.set(0.32, 3.44, 0);
    g.add(glass);

    // Lantern bottom diffuser disc
    var diffuser = new THREE.Mesh(
      new THREE.CylinderGeometry(0.082, 0.082, 0.010, 10),
      mat(0xffeedd, { transparent: true, opacity: 0.80, emissive: 0xffcc55, emissiveIntensity: 0.60 })
    );
    diffuser.position.set(0.32, 3.34, 0);
    g.add(diffuser);

    // PointLight — warm street glow
    var light = new THREE.PointLight(0xffcc66, 1.2, 6.0);
    light.position.set(0.32, 3.35, 0);
    g.add(light);

    return g;
  }
};
