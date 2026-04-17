import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'ping_pong',
  name: 'Ping Pong Table',
  category: 'recreation',
  icon: 'PP',
  gridW: 3, gridD: 2, height: 0.76,
  factory: function() {
    var g = new THREE.Group();

    // Table top — green with dark edge
    var top = new THREE.Mesh(
      new THREE.BoxGeometry(2.74, 0.04, 1.52),
      mat(0x115522, { roughness: 0.75 })
    );
    top.position.y = 0.74;
    top.castShadow = true;
    top.receiveShadow = true;
    g.add(top);

    // White edge border (thin frame around top surface)
    var edgeMat = mat(0xffffff, { roughness: 0.70 });
    var edgeLong = new THREE.BoxGeometry(2.74, 0.042, 0.018);
    var edgeShort = new THREE.BoxGeometry(0.018, 0.042, 1.52);
    [0.761, -0.761].forEach(function(z) {
      var e = new THREE.Mesh(edgeLong, edgeMat);
      e.position.set(0, 0.74, z);
      g.add(e);
    });
    [-1.371, 1.371].forEach(function(x) {
      var e = new THREE.Mesh(edgeShort, edgeMat);
      e.position.set(x, 0.74, 0);
      g.add(e);
    });

    // White center line (lengthwise)
    var centerLine = new THREE.Mesh(
      new THREE.BoxGeometry(2.74, 0.045, 0.022),
      edgeMat
    );
    centerLine.position.set(0, 0.74, 0);
    g.add(centerLine);

    // White half-court line (across middle)
    var halfLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.022, 0.045, 1.52),
      edgeMat
    );
    halfLine.position.set(0, 0.74, 0);
    g.add(halfLine);

    // Net post — left
    var postMat = PAL.chrome();
    var postGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.20, 8);
    var leftPost = new THREE.Mesh(postGeo, postMat);
    leftPost.position.set(0, 0.85, 0.78);
    leftPost.castShadow = true;
    g.add(leftPost);

    // Net post — right
    var rightPost = leftPost.clone();
    rightPost.position.z = -0.78;
    g.add(rightPost);

    // Net top bar
    var netBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 1.56, 8),
      postMat
    );
    netBar.rotation.x = Math.PI / 2;
    netBar.position.set(0, 0.945, 0);
    g.add(netBar);

    // Net mesh (semi-transparent white)
    var net = new THREE.Mesh(
      new THREE.BoxGeometry(0.008, 0.16, 1.52),
      mat(0xffffff, { transparent: true, opacity: 0.55, roughness: 0.70, side: THREE.DoubleSide })
    );
    net.position.set(0, 0.865, 0);
    g.add(net);

    // Chrome folding legs (angled X-frame style) — 4 corner assemblies
    var legMat = PAL.chromeBrushed();
    var legGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.78, 8);
    [[-1.18, 0.37, 0.58], [1.18, 0.37, 0.58], [-1.18, 0.37, -0.58], [1.18, 0.37, -0.58]].forEach(function(p) {
      var leg = new THREE.Mesh(legGeo, legMat);
      leg.position.set(p[0], p[1], p[2]);
      leg.castShadow = true;
      g.add(leg);
    });

    // Horizontal leg brace (side spreader bars)
    var braceGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.16, 8);
    [[0.58], [-0.58]].forEach(function(arr) {
      var brace = new THREE.Mesh(braceGeo, legMat);
      brace.rotation.z = Math.PI / 2;
      brace.position.set(0, 0.16, arr[0]);
      g.add(brace);
    });

    // Small rubber feet
    var feetMat = mat(0x0a0a0a, { roughness: 0.92 });
    var feetGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.016, 8);
    [[-1.18, 0.008, 0.58], [1.18, 0.008, 0.58], [-1.18, 0.008, -0.58], [1.18, 0.008, -0.58]].forEach(function(p) {
      var foot = new THREE.Mesh(feetGeo, feetMat);
      foot.position.set(p[0], p[1], p[2]);
      g.add(foot);
    });

    return g;
  }
};
