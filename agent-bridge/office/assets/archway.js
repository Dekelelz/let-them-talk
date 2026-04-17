import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'archway',
  name: 'Archway',
  category: 'structural',
  icon: 'Ar',
  gridW: 2, gridD: 1, height: 3,
  factory: function() {
    var g = new THREE.Group();

    var walnut = PAL.walnutDark();
    var chrome = PAL.chrome();

    // Left pillar
    var pillarL = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 3, 0.3),
      walnut
    );
    pillarL.position.x = -0.86;
    pillarL.castShadow = true;
    g.add(pillarL);

    // Right pillar
    var pillarR = pillarL.clone();
    pillarR.position.x = 0.86;
    g.add(pillarR);

    // Top lintel beam (horizontal span)
    var lintel = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.35, 0.3),
      walnut
    );
    lintel.position.y = 1.325;
    lintel.castShadow = true;
    g.add(lintel);

    // Chrome accent strip on lintel front face
    var lintelStrip = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.05, 0.01),
      chrome
    );
    lintelStrip.position.set(0, 1.325, 0.155);
    g.add(lintelStrip);

    // Chrome base caps on pillars
    var capGeo = new THREE.BoxGeometry(0.32, 0.07, 0.34);
    var capL = new THREE.Mesh(capGeo, chrome);
    capL.position.set(-0.86, -1.465, 0);
    g.add(capL);
    var capR = new THREE.Mesh(capGeo, chrome);
    capR.position.set(0.86, -1.465, 0);
    g.add(capR);

    // Chrome crown caps on pillars (top)
    var crownL = new THREE.Mesh(capGeo, chrome);
    crownL.position.set(-0.86, 1.465, 0);
    g.add(crownL);
    var crownR = new THREE.Mesh(capGeo, chrome);
    crownR.position.set(0.86, 1.465, 0);
    g.add(crownR);

    // Arch soffit — curved underside suggestion (thin curved strip)
    var archCurve = new THREE.Mesh(
      new THREE.TorusGeometry(0.72, 0.04, 6, 18, Math.PI),
      chrome
    );
    archCurve.rotation.y = Math.PI / 2;
    archCurve.rotation.z = Math.PI;
    archCurve.position.y = 0.65;
    archCurve.castShadow = true;
    g.add(archCurve);

    return g;
  }
};
