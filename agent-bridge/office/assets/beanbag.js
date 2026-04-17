import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'beanbag',
  name: 'Beanbag Chair',
  category: 'recreation',
  icon: 'BB',
  gridW: 1, gridD: 1, height: 0.4,
  factory: function() {
    var g = new THREE.Group();

    // Pick a random color from 4 options
    var colorOptions = [0x2a1f5e, 0x5e1f2a, 0x1f4a2a, 0x4a3a1f];
    var color = colorOptions[Math.floor(Math.random() * colorOptions.length)];
    var trimColors = [0x4433aa, 0xaa3344, 0x338855, 0x887744];
    var trimIdx = colorOptions.indexOf(color);
    var trimColor = trimColors[trimIdx >= 0 ? trimIdx : 0];

    // Main squashed sphere body
    var body = new THREE.Mesh(
      new THREE.SphereGeometry(0.40, 22, 16),
      mat(color, { roughness: 0.88 })
    );
    body.scale.set(1.0, 0.55, 1.0);
    body.position.y = 0.22;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // Slightly lighter top section (highlight)
    var top = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 12),
      mat(trimColor, { roughness: 0.85 })
    );
    top.scale.set(1.0, 0.45, 1.0);
    top.position.y = 0.32;
    g.add(top);

    // Seam lines (thin dark strips around middle)
    var seamMat = mat(0x111111, { roughness: 0.90 });
    var seamGeo = new THREE.TorusGeometry(0.38, 0.012, 6, 28);
    var seamH = new THREE.Mesh(seamGeo, seamMat);
    seamH.position.y = 0.20;
    g.add(seamH);

    // Cross seam (vertical ring)
    var seamV = new THREE.Mesh(seamGeo, seamMat);
    seamV.rotation.y = Math.PI / 2;
    seamV.scale.set(0.7, 0.5, 0.7);
    seamV.position.y = 0.22;
    g.add(seamV);

    // Small logo tag (tiny contrast strip on front)
    var tag = new THREE.Mesh(
      new THREE.BoxGeometry(0.055, 0.025, 0.008),
      mat(0xffffff, { roughness: 0.80 })
    );
    tag.position.set(0, 0.22, 0.40);
    g.add(tag);

    return g;
  }
};
