import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'server_rack',
  name: 'Server Rack',
  category: 'tech',
  icon: 'SR',
  gridW: 1, gridD: 1, height: 1.5,
  factory: function() {
    var g = new THREE.Group();

    var W  = 0.60;
    var H  = 1.50;
    var D  = 0.55;
    var halfH = H / 2;

    var cabinetMat = mat(0x0e1014, { roughness: 0.45, metalness: 0.30 });
    var frameMat   = PAL.chromeBrushed();
    var ventMat    = mat(0x1a1d22, { roughness: 0.60, metalness: 0.15 });

    // Main cabinet body
    var body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), cabinetMat);
    body.position.y = halfH;
    body.castShadow = true;
    g.add(body);

    // Front door frame
    var doorFrame = new THREE.Mesh(new THREE.BoxGeometry(W + 0.01, H + 0.01, 0.015), frameMat);
    doorFrame.position.set(0, halfH, D / 2 + 0.005);
    g.add(doorFrame);

    // Front perforated panel (dark inset)
    var frontPanel = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, H - 0.04, 0.010), ventMat);
    frontPanel.position.set(0, halfH, D / 2 + 0.006);
    g.add(frontPanel);

    // Ventilation grille rows (horizontal slits on front)
    var grilleMat = mat(0x090b0e, { roughness: 0.50 });
    var grillCount = 10;
    for (var i = 0; i < grillCount; i++) {
      var gy = 0.10 + i * (H - 0.18) / (grillCount - 1);
      var grille = new THREE.Mesh(
        new THREE.BoxGeometry(W - 0.08, 0.012, 0.015),
        grilleMat
      );
      grille.position.set(0, gy, D / 2 + 0.012);
      g.add(grille);
    }

    // 1U server unit rails (thin horizontal dividers)
    var railMat = mat(0x2a2e36, { roughness: 0.55, metalness: 0.25 });
    var railCount = 6;
    for (var r = 0; r < railCount; r++) {
      var ry = 0.15 + r * (H - 0.25) / railCount;
      var rail = new THREE.Mesh(new THREE.BoxGeometry(W - 0.02, 0.006, 0.008), railMat);
      rail.position.set(0, ry, D / 2 + 0.003);
      g.add(rail);
    }

    // LED indicator dots (4, stacked vertically on right side of front)
    var ledColors = [0x00ff88, 0x00aaff, 0xffcc00, 0xff3300];
    ledColors.forEach(function(col, idx) {
      var led = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 10, 10),
        mat(col, { emissive: col, emissiveIntensity: 1.0 })
      );
      led.position.set(W / 2 - 0.045, 0.95 + idx * 0.10, D / 2 + 0.018);
      g.add(led);
    });

    // Side vent strips (left and right faces)
    [-1, 1].forEach(function(side) {
      var sideVent = new THREE.Mesh(
        new THREE.BoxGeometry(0.008, H * 0.65, D - 0.08),
        ventMat
      );
      sideVent.position.set(side * (W / 2 + 0.001), halfH, 0);
      g.add(sideVent);
    });

    // Top exhaust panel
    var topVent = new THREE.Mesh(new THREE.BoxGeometry(W - 0.06, 0.010, D - 0.06), ventMat);
    topVent.position.y = H + 0.001;
    g.add(topVent);

    // Caster feet (4 corners)
    var casterMat = PAL.rubber();
    [[-W * 0.38, -D * 0.38], [W * 0.38, -D * 0.38],
     [-W * 0.38,  D * 0.38], [W * 0.38,  D * 0.38]].forEach(function(pos) {
      var caster = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.040, 12), casterMat);
      caster.position.set(pos[0], 0.020, pos[1]);
      g.add(caster);
    });

    return g;
  }
};
