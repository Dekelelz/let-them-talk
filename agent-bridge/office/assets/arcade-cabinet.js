import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'arcade_cabinet',
  name: 'Arcade Cabinet',
  category: 'recreation',
  icon: 'AC',
  gridW: 1, gridD: 1, height: 1.7,
  factory: function() {
    var g = new THREE.Group();

    // Main cabinet body
    var body = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 1.50, 0.60),
      mat(0x0e1014, { roughness: 0.50, metalness: 0.15 })
    );
    body.position.y = 0.75;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Top angled marquee section
    var marquee = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.26, 0.38),
      mat(0x111318, { roughness: 0.45 })
    );
    marquee.position.set(0, 1.63, -0.11);
    marquee.castShadow = true;
    g.add(marquee);

    // Marquee light (emissive panel)
    var marqueeLit = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.18, 0.01),
      mat(0x220022, { emissive: 0xaa00ff, emissiveIntensity: 1.0, roughness: 0.1 })
    );
    marqueeLit.position.set(0, 1.64, 0.19);
    g.add(marqueeLit);

    // Marquee glow light
    var marqueeLight = new THREE.PointLight(0xaa00ff, 0.5, 1.2);
    marqueeLight.position.set(0, 1.72, 0.30);
    g.add(marqueeLight);

    // Angled monitor bezel
    var bezel = new THREE.Mesh(
      new THREE.BoxGeometry(0.54, 0.42, 0.025),
      mat(0x080808, { roughness: 0.70 })
    );
    bezel.rotation.x = -0.30;
    bezel.position.set(0, 1.22, 0.265);
    g.add(bezel);

    // Screen (emissive display)
    var screen = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.34, 0.010),
      mat(0x000a22, { emissive: 0x0044ff, emissiveIntensity: 0.80, roughness: 0.1 })
    );
    screen.rotation.x = -0.30;
    screen.position.set(0, 1.225, 0.273);
    g.add(screen);

    // Screen glow
    var screenGlow = new THREE.PointLight(0x0044ff, 0.35, 0.9);
    screenGlow.position.set(0, 1.22, 0.38);
    g.add(screenGlow);

    // Control panel (angled surface below screen)
    var controlPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.66, 0.06, 0.32),
      mat(0x111318, { roughness: 0.45 })
    );
    controlPanel.rotation.x = -0.45;
    controlPanel.position.set(0, 0.90, 0.24);
    g.add(controlPanel);

    // Joystick base
    var joystickBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.038, 0.038, 0.018, 10),
      mat(0x222222, { roughness: 0.60 })
    );
    joystickBase.position.set(-0.14, 0.96, 0.25);
    g.add(joystickBase);

    // Joystick stick
    var joystick = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.065, 8),
      mat(0x333333, { roughness: 0.50 })
    );
    joystick.position.set(-0.14, 1.01, 0.25);
    g.add(joystick);

    // Joystick ball top
    var ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 10, 8),
      mat(0xcc0000, { roughness: 0.40 })
    );
    ball.position.set(-0.14, 1.04, 0.25);
    g.add(ball);

    // Action buttons (4 colored circles)
    var btnColors = [0xee2211, 0x2288ee, 0x22cc44, 0xeecc00];
    btnColors.forEach(function(color, i) {
      var btn = new THREE.Mesh(
        new THREE.CylinderGeometry(0.022, 0.022, 0.018, 10),
        mat(color, { roughness: 0.45 })
      );
      var bx = 0.06 + (i % 2) * 0.055;
      var bz = 0.22 + Math.floor(i / 2) * 0.055;
      btn.position.set(bx, 0.962, bz);
      g.add(btn);
    });

    // Side panel decorative stripe (neon line)
    var stripe = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 1.10, 0.012),
      mat(0xff00cc, { emissive: 0xff00cc, emissiveIntensity: 0.80 })
    );
    stripe.position.set(0.352, 0.80, 0);
    g.add(stripe);

    // Coin slot
    var coinSlot = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.010, 0.022),
      mat(0x333333, { roughness: 0.60, metalness: 0.40 })
    );
    coinSlot.position.set(0, 0.70, 0.305);
    g.add(coinSlot);

    // Base kick panel
    var kick = new THREE.Mesh(
      new THREE.BoxGeometry(0.70, 0.20, 0.60),
      mat(0x0a0c10, { roughness: 0.60 })
    );
    kick.position.y = 0.10;
    kick.castShadow = true;
    g.add(kick);

    return g;
  }
};
