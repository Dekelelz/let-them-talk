import * as THREE from 'three';
import { HEAD_R } from './constants.js';

function headSurfaceZ(x, y) {
  return Math.sqrt(Math.max(0, HEAD_R * HEAD_R - x * x - y * y));
}

export function buildGlasses(style, color, headMesh) {
  var glassesGroup = new THREE.Group();
  glassesGroup.userData.isAccessories = true;
  var frameColor = new THREE.Color(color).getHex();
  var frameMat = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.3, metalness: 0.4 });

  var eyeX = 0.042;
  var eyeY = -0.018;

  if (style === 'round') {
    var lensRadius = 0.04;
    var tubeRadius = 0.006;
    var leftLens = new THREE.Mesh(new THREE.TorusGeometry(lensRadius, tubeRadius, 8, 24), frameMat);
    var lz = headSurfaceZ(eyeX, eyeY) + 0.008;
    leftLens.position.set(-eyeX, eyeY, lz);
    glassesGroup.add(leftLens);
    var rightLens = new THREE.Mesh(new THREE.TorusGeometry(lensRadius, tubeRadius, 8, 24), frameMat);
    rightLens.position.set(eyeX, eyeY, lz);
    glassesGroup.add(rightLens);
    var lensTintMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    var lensTintGeo = new THREE.CircleGeometry(lensRadius - 0.002, 16);
    var leftTint = new THREE.Mesh(lensTintGeo, lensTintMat);
    leftTint.position.set(-eyeX, eyeY, lz - 0.001);
    glassesGroup.add(leftTint);
    var rightTint = new THREE.Mesh(lensTintGeo, lensTintMat);
    rightTint.position.set(eyeX, eyeY, lz - 0.001);
    glassesGroup.add(rightTint);
    var bridgeGeo = new THREE.CylinderGeometry(tubeRadius, tubeRadius, eyeX * 2 - lensRadius * 2, 6);
    var bridge = new THREE.Mesh(bridgeGeo, frameMat);
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, eyeY, lz + 0.003);
    glassesGroup.add(bridge);
    var armMat2 = new THREE.MeshStandardMaterial({ color: frameColor, roughness: 0.4 });
    [-1, 1].forEach(function(side) {
      var armGroup = new THREE.Group();
      var segCount = 5;
      for (var s = 0; s < segCount; s++) {
        var t0 = s / segCount;
        var t1 = (s + 1) / segCount;
        var angle0 = Math.asin(Math.min(1, (eyeX + lensRadius) / HEAD_R)) + t0 * 0.6;
        var angle1 = Math.asin(Math.min(1, (eyeX + lensRadius) / HEAD_R)) + t1 * 0.6;
        var x0 = side * Math.sin(angle0) * (HEAD_R + 0.008);
        var z0 = Math.cos(angle0) * (HEAD_R + 0.008);
        var x1 = side * Math.sin(angle1) * (HEAD_R + 0.008);
        var z1 = Math.cos(angle1) * (HEAD_R + 0.008);
        var segLen = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
        var seg = new THREE.Mesh(new THREE.BoxGeometry(segLen, 0.008, 0.008), armMat2);
        seg.position.set((x0 + x1) / 2, eyeY, (z0 + z1) / 2);
        seg.rotation.y = -Math.atan2(z1 - z0, x1 - x0) + Math.PI / 2;
        if (side < 0) seg.rotation.y = Math.atan2(z1 - z0, x1 - x0) - Math.PI / 2;
        armGroup.add(seg);
      }
      glassesGroup.add(armGroup);
    });
  } else if (style === 'square') {
    var lensW = 0.07, lensH = 0.05;
    var lz2 = headSurfaceZ(eyeX, eyeY) + 0.008;
    var t2 = 0.006;
    [-eyeX, eyeX].forEach(function(ex) {
      var top = new THREE.Mesh(new THREE.BoxGeometry(lensW, t2, t2), frameMat);
      top.position.set(ex, eyeY + lensH / 2, lz2); glassesGroup.add(top);
      var bot = new THREE.Mesh(new THREE.BoxGeometry(lensW, t2, t2), frameMat);
      bot.position.set(ex, eyeY - lensH / 2, lz2); glassesGroup.add(bot);
      var left = new THREE.Mesh(new THREE.BoxGeometry(t2, lensH, t2), frameMat);
      left.position.set(ex - lensW / 2, eyeY, lz2); glassesGroup.add(left);
      var right = new THREE.Mesh(new THREE.BoxGeometry(t2, lensH, t2), frameMat);
      right.position.set(ex + lensW / 2, eyeY, lz2); glassesGroup.add(right);
      var tintMat = new THREE.MeshBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.12, side: THREE.DoubleSide });
      var tint = new THREE.Mesh(new THREE.PlaneGeometry(lensW - t2, lensH - t2), tintMat);
      tint.position.set(ex, eyeY, lz2 - 0.001); glassesGroup.add(tint);
    });
    var bridgeLen = eyeX * 2 - lensW;
    var br2 = new THREE.Mesh(new THREE.BoxGeometry(bridgeLen, t2, t2), frameMat);
    br2.position.set(0, eyeY + lensH / 2 - t2, lz2); glassesGroup.add(br2);
    [-1, 1].forEach(function(side) {
      var armLen = 0.15;
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, armLen), frameMat);
      var sx = side * (eyeX + lensW / 2);
      arm.position.set(sx, eyeY, lz2 - armLen / 2);
      glassesGroup.add(arm);
    });
  } else if (style === 'sunglasses') {
    var lz3 = headSurfaceZ(eyeX, eyeY) + 0.008;
    var sgW = 0.055, sgH = 0.04;
    var darkMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.2, metalness: 0.3 });
    [-eyeX, eyeX].forEach(function(ex) {
      var lens = new THREE.Mesh(new THREE.PlaneGeometry(sgW, sgH), darkMat);
      lens.position.set(ex, eyeY, lz3); glassesGroup.add(lens);
      var chromeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.1, metalness: 0.8 });
      var ft = 0.005;
      var frameTop = new THREE.Mesh(new THREE.BoxGeometry(sgW + ft * 2, ft, ft), chromeMat);
      frameTop.position.set(ex, eyeY + sgH / 2, lz3 + 0.002); glassesGroup.add(frameTop);
      var frameBot = new THREE.Mesh(new THREE.BoxGeometry(sgW + ft * 2, ft, ft), chromeMat);
      frameBot.position.set(ex, eyeY - sgH / 2, lz3 + 0.002); glassesGroup.add(frameBot);
    });
    var sgBridge = new THREE.Mesh(new THREE.BoxGeometry(eyeX * 2 - sgW, 0.005, 0.005), frameMat);
    sgBridge.position.set(0, eyeY + sgH / 2, lz3 + 0.002); glassesGroup.add(sgBridge);
    [-1, 1].forEach(function(side) {
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.008, 0.15), frameMat);
      arm.position.set(side * (eyeX + sgW / 2), eyeY, lz3 - 0.07);
      glassesGroup.add(arm);
    });
  }

  headMesh.add(glassesGroup);
  return glassesGroup;
}

export function buildHeadwear(style, color, headMesh) {
  var hwGroup = new THREE.Group();
  hwGroup.userData.isAccessories = true;
  var hwColor = new THREE.Color(color).getHex();
  var mat = new THREE.MeshStandardMaterial({ color: hwColor, roughness: 0.8 });

  if (style === 'beanie') {
    var beanieGeo = new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.45);
    var beanie = new THREE.Mesh(beanieGeo, mat);
    beanie.position.y = 0.04; beanie.castShadow = true;
    hwGroup.add(beanie);
    var rimGeo = new THREE.TorusGeometry(0.23, 0.02, 8, 24);
    var rimMat = new THREE.MeshStandardMaterial({ color: hwColor, roughness: 0.9 });
    var rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2; rim.position.y = 0.04;
    hwGroup.add(rim);
    var pomGeo = new THREE.SphereGeometry(0.04, 8, 6);
    var pom = new THREE.Mesh(pomGeo, mat);
    pom.position.y = 0.28;
    hwGroup.add(pom);
  } else if (style === 'cap') {
    var crownGeo = new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.4);
    var crown = new THREE.Mesh(crownGeo, mat);
    crown.position.y = 0.03; crown.castShadow = true;
    hwGroup.add(crown);
    var brimGeo = new THREE.CylinderGeometry(0.18, 0.2, 0.015, 16, 1, false, -Math.PI / 2, Math.PI);
    var brimMat = new THREE.MeshStandardMaterial({ color: hwColor, roughness: 0.7 });
    var brim = new THREE.Mesh(brimGeo, brimMat);
    brim.rotation.x = Math.PI / 2; brim.rotation.z = Math.PI;
    brim.position.set(0, 0.04, 0.16); brim.castShadow = true;
    hwGroup.add(brim);
  } else if (style === 'headphones') {
    var hpMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.4, metalness: 0.3 });
    var bandGeo = new THREE.TorusGeometry(0.24, 0.015, 8, 24, Math.PI);
    var band = new THREE.Mesh(bandGeo, hpMat);
    band.rotation.z = Math.PI / 2; band.rotation.y = Math.PI / 2;
    band.position.y = 0.06;
    hwGroup.add(band);
    var padGeo = new THREE.TorusGeometry(0.24, 0.025, 6, 20, Math.PI * 0.6);
    var padMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.8 });
    var pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.z = Math.PI / 2; pad.rotation.y = Math.PI / 2;
    pad.position.y = 0.08;
    hwGroup.add(pad);
    [-1, 1].forEach(function(side) {
      var cupOuter = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16), hpMat);
      cupOuter.rotation.z = Math.PI / 2;
      cupOuter.position.set(side * 0.26, 0, 0); cupOuter.castShadow = true;
      hwGroup.add(cupOuter);
      var cushionMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
      var cushion = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 16), cushionMat);
      cushion.rotation.z = Math.PI / 2;
      cushion.position.set(side * 0.25, 0, 0);
      hwGroup.add(cushion);
    });
  } else if (style === 'headband') {
    var hbMat = new THREE.MeshStandardMaterial({ color: hwColor, roughness: 0.7 });
    var hbGeo = new THREE.TorusGeometry(0.252, 0.015, 6, 24, Math.PI);
    var hb = new THREE.Mesh(hbGeo, hbMat);
    hb.rotation.z = Math.PI / 2; hb.rotation.y = Math.PI / 2;
    hb.position.y = 0.06;
    hwGroup.add(hb);
  }

  headMesh.add(hwGroup);
  return hwGroup;
}

export function buildNeckwear(style, color, charGroup) {
  var nwGroup = new THREE.Group();
  var nwColor = new THREE.Color(color).getHex();
  var mat = new THREE.MeshStandardMaterial({ color: nwColor, roughness: 0.7 });
  nwGroup.userData.isNeckwear = true;

  if (style === 'tie') {
    var knot = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.03, 0.02), mat);
    knot.position.set(0, 0.76, 0.1);
    nwGroup.add(knot);
    var tieGeo = new THREE.BufferGeometry();
    var verts = new Float32Array([
      -0.025, 0, 0.01,   0.025, 0, 0.01,   0.018, -0.18, 0.01,
      -0.025, 0, 0.01,   0.018, -0.18, 0.01, -0.018, -0.18, 0.01,
      -0.018, -0.18, 0.01, 0.018, -0.18, 0.01, 0, -0.22, 0.01,
    ]);
    tieGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    tieGeo.computeVertexNormals();
    var tieMesh = new THREE.Mesh(tieGeo, mat);
    tieMesh.position.set(0, 0.73, 0);
    nwGroup.add(tieMesh);
  } else if (style === 'bowtie') {
    var btMat = new THREE.MeshStandardMaterial({ color: nwColor, roughness: 0.6 });
    var btKnot = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.025, 0.02), btMat);
    btKnot.position.set(0, 0.76, 0.1);
    nwGroup.add(btKnot);
    var wingGeo = new THREE.BufferGeometry();
    var wv = new Float32Array([
      0, 0.012, 0.01,  -0.05, 0.02, 0.005,  -0.05, -0.02, 0.005,
      0, 0.012, 0.01,  -0.05, -0.02, 0.005,  0, -0.012, 0.01,
    ]);
    wingGeo.setAttribute('position', new THREE.BufferAttribute(wv, 3));
    wingGeo.computeVertexNormals();
    var leftWing = new THREE.Mesh(wingGeo, btMat);
    leftWing.position.set(-0.01, 0.76, 0.09);
    nwGroup.add(leftWing);
    var rwv = new Float32Array([
      0, 0.012, 0.01,  0.05, 0.02, 0.005,  0.05, -0.02, 0.005,
      0, 0.012, 0.01,  0.05, -0.02, 0.005,  0, -0.012, 0.01,
    ]);
    var rwGeo = new THREE.BufferGeometry();
    rwGeo.setAttribute('position', new THREE.BufferAttribute(rwv, 3));
    rwGeo.computeVertexNormals();
    var rightWing = new THREE.Mesh(rwGeo, btMat);
    rightWing.position.set(0.01, 0.76, 0.09);
    nwGroup.add(rightWing);
  } else if (style === 'lanyard') {
    var lanyardMat = new THREE.MeshStandardMaterial({ color: nwColor, roughness: 0.8 });
    var cordGeo = new THREE.TorusGeometry(0.12, 0.005, 6, 16, Math.PI);
    var cord = new THREE.Mesh(cordGeo, lanyardMat);
    cord.rotation.x = Math.PI; cord.position.set(0, 0.72, 0.06);
    nwGroup.add(cord);
    var badge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.005), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
    badge.position.set(0, 0.58, 0.08);
    nwGroup.add(badge);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.006), new THREE.MeshStandardMaterial({ color: nwColor, roughness: 0.5 }));
    stripe.position.set(0, 0.6, 0.083);
    nwGroup.add(stripe);
  }

  charGroup.add(nwGroup);
  return nwGroup;
}

export function removeAccessories(headMesh, charGroup) {
  var toRemoveHead = [];
  headMesh.children.forEach(function(c) {
    if (c.userData && c.userData.isAccessories) toRemoveHead.push(c);
  });
  toRemoveHead.forEach(function(c) {
    headMesh.remove(c);
    c.traverse(function(ch) { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
  });
  var toRemoveGroup = [];
  charGroup.children.forEach(function(c) {
    if (c.userData && c.userData.isNeckwear) toRemoveGroup.push(c);
  });
  toRemoveGroup.forEach(function(c) {
    charGroup.remove(c);
    c.traverse(function(ch) { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
  });
}
