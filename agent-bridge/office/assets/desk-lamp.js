import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'desk_lamp',
  name: 'Desk Lamp',
  category: 'lighting',
  icon: 'DL',
  gridW: 1, gridD: 1, height: 0.5,
  factory: function() {
    var g = new THREE.Group();

    var chromeMat = PAL.chrome();
    var darkMat   = PAL.darkMetal();
    var shadeMat  = mat(0xe8dcc8, { transparent: true, opacity: 0.75, roughness: 0.45, side: THREE.DoubleSide });

    // Clamp/weighted base block
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(0.10, 0.035, 0.10),
      darkMat
    );
    base.position.y = 0.018;
    base.castShadow = true;
    g.add(base);

    // Base chrome collar
    var baseCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.030, 12),
      chromeMat
    );
    baseCollar.position.y = 0.050;
    g.add(baseCollar);

    // Lower arm (angled backward at ~70 deg)
    var armLow = new THREE.Mesh(
      new THREE.BoxGeometry(0.012, 0.22, 0.012),
      chromeMat
    );
    armLow.position.set(0, 0.165, -0.06);
    armLow.rotation.x = -0.35;
    armLow.castShadow = true;
    g.add(armLow);

    // Elbow joint knuckle
    var elbow = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 14, 10),
      chromeMat
    );
    elbow.position.set(0, 0.300, -0.11);
    g.add(elbow);

    // Upper arm (angled forward and up)
    var armUp = new THREE.Mesh(
      new THREE.BoxGeometry(0.010, 0.20, 0.010),
      chromeMat
    );
    armUp.position.set(0, 0.415, -0.045);
    armUp.rotation.x = 0.55;
    armUp.castShadow = true;
    g.add(armUp);

    // Head joint
    var headJoint = new THREE.Mesh(
      new THREE.SphereGeometry(0.015, 12, 8),
      chromeMat
    );
    headJoint.position.set(0, 0.500, 0.030);
    g.add(headJoint);

    // Shade (small cone, opening downward)
    var shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.080, 0.095, 28, 1, true),
      shadeMat
    );
    shade.position.set(0, 0.465, 0.030);
    shade.rotation.x = Math.PI;
    g.add(shade);

    // Shade chrome rim
    var shadeRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.078, 0.004, 8, 28),
      chromeMat
    );
    shadeRim.position.set(0, 0.422, 0.030);
    g.add(shadeRim);

    // Warm bulb inside shade
    var bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 12, 8),
      mat(0xfff0cc, { emissive: 0xfff0cc, emissiveIntensity: 1.3, transparent: true, opacity: 0.90 })
    );
    bulb.position.set(0, 0.455, 0.030);
    g.add(bulb);

    // Point light
    var light = new THREE.PointLight(0xffeedd, 0.2, 3);
    light.position.set(0, 0.42, 0.030);
    g.add(light);

    return g;
  }
};
