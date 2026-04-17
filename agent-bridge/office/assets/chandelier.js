import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'chandelier',
  name: 'Chandelier',
  category: 'lighting',
  icon: 'CH',
  gridW: 1, gridD: 1, height: 3.0,
  factory: function() {
    var g = new THREE.Group();

    var ringY     = 2.50;
    var ringR     = 0.40;
    var armCount  = 6;
    var chromeMat = PAL.chrome();

    // Ceiling canopy (mount disk)
    var canopy = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.022, 24), chromeMat);
    canopy.position.y = 3.0;
    g.add(canopy);

    // Main drop rod from ceiling to ring
    var rod = new THREE.Mesh(
      new THREE.CylinderGeometry(0.010, 0.010, 3.0 - ringY - 0.011, 12),
      chromeMat
    );
    rod.position.y = ringY + (3.0 - ringY - 0.011) / 2 + 0.011;
    g.add(rod);

    // Chrome ring
    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(ringR, 0.012, 10, 64),
      chromeMat
    );
    ring.position.y = ringY;
    g.add(ring);

    // Ring center hub
    var hub = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.040, 16), chromeMat);
    hub.position.y = ringY;
    g.add(hub);

    // 6 pendant arms radiating from ring
    for (var i = 0; i < armCount; i++) {
      var angle = (i / armCount) * Math.PI * 2;
      var ax = Math.sin(angle) * ringR;
      var az = Math.cos(angle) * ringR;

      // Arm spoke (from hub to ring)
      var spokeLen = ringR - 0.026;
      var spoke = new THREE.Mesh(
        new THREE.CylinderGeometry(0.006, 0.006, spokeLen, 8),
        chromeMat
      );
      spoke.position.set(Math.sin(angle) * (ringR / 2), ringY, Math.cos(angle) * (ringR / 2));
      spoke.rotation.z = Math.PI / 2;
      spoke.rotation.y = angle;
      g.add(spoke);

      // Pendant drop wire
      var dropLen = 0.18;
      var wire = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, dropLen, 8),
        mat(0x999999, { roughness: 0.30, metalness: 0.70 })
      );
      wire.position.set(ax, ringY - dropLen / 2, az);
      g.add(wire);

      // Globe bulb shade
      var globe = new THREE.Mesh(
        new THREE.SphereGeometry(0.040, 18, 12),
        mat(0xfff5e0, { transparent: true, opacity: 0.55, roughness: 0.05, side: THREE.DoubleSide })
      );
      globe.position.set(ax, ringY - dropLen - 0.040, az);
      g.add(globe);

      // Warm filament glow inside globe
      var filament = new THREE.Mesh(
        new THREE.SphereGeometry(0.016, 10, 8),
        mat(0xffe8a0, { emissive: 0xffdd80, emissiveIntensity: 1.5, transparent: true, opacity: 0.95 })
      );
      filament.position.set(ax, ringY - dropLen - 0.040, az);
      g.add(filament);

      // Globe chrome neck fitting
      var globeNeck = new THREE.Mesh(
        new THREE.CylinderGeometry(0.010, 0.010, 0.015, 10),
        chromeMat
      );
      globeNeck.position.set(ax, ringY - dropLen - 0.004, az);
      g.add(globeNeck);

      // Per-arm warm point light (low intensity, many = soft fill)
      var armLight = new THREE.PointLight(0xffe8a0, 0.09, 3.5);
      armLight.position.set(ax, ringY - dropLen - 0.040, az);
      g.add(armLight);
    }

    // Centre ambient fill light at ring level
    var fillLight = new THREE.PointLight(0xfff0cc, 0.18, 5);
    fillLight.position.y = ringY;
    g.add(fillLight);

    return g;
  }
};
