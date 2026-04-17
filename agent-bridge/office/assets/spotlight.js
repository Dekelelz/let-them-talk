import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'spotlight',
  name: 'Track Spotlight',
  category: 'lighting',
  icon: 'SL',
  gridW: 1, gridD: 1, height: 2.5,
  factory: function() {
    var g = new THREE.Group();

    var mountY  = 2.50;   // ceiling mount height
    var headY   = mountY - 0.08;
    var chromeMat = PAL.chrome();
    var bodyMat   = mat(0x1c1e24, { roughness: 0.35, metalness: 0.55 });

    // Track rail segment (short, ceiling-mounted)
    var track = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.028, 0.038),
      mat(0x888888, { roughness: 0.28, metalness: 0.70 })
    );
    track.position.y = mountY;
    g.add(track);

    // Mount clip connecting housing to track
    var clip = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, 0.050, 0.028),
      chromeMat
    );
    clip.position.y = mountY - 0.025;
    g.add(clip);

    // Main spotlight housing (tapered cylinder)
    var housing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.040, 0.055, 0.110, 20),
      bodyMat
    );
    housing.position.y = headY - 0.055;
    housing.castShadow = true;
    g.add(housing);

    // Chrome housing ring (top)
    var topRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.042, 0.005, 8, 20),
      chromeMat
    );
    topRing.position.y = headY;
    g.add(topRing);

    // Inner reflector bowl
    var reflector = new THREE.Mesh(
      new THREE.CylinderGeometry(0.030, 0.048, 0.070, 20, 1, true),
      mat(0xc8c8c8, { roughness: 0.05, metalness: 0.95, side: THREE.BackSide })
    );
    reflector.position.y = headY - 0.060;
    g.add(reflector);

    // Lens glass (front of housing)
    var lens = new THREE.Mesh(
      new THREE.CircleGeometry(0.038, 24),
      mat(0xdde8ff, { transparent: true, opacity: 0.35, roughness: 0.02, emissive: 0xffffff, emissiveIntensity: 0.25 })
    );
    lens.position.y = headY - 0.112;
    lens.rotation.x = Math.PI / 2;
    g.add(lens);

    // Focus ring (chrome band around lens end)
    var focusRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.040, 0.006, 8, 20),
      chromeMat
    );
    focusRing.position.y = headY - 0.113;
    g.add(focusRing);

    // Focused point light (aimed downward)
    var light = new THREE.PointLight(0xffffff, 0.4, 6);
    light.position.y = headY - 0.12;
    g.add(light);

    return g;
  }
};
