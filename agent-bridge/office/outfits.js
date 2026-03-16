import * as THREE from 'three';

// Build outfit overlays on top of the base character body.
// Returns a group that gets added to the character group.
// Outfit replaces/covers the base torso visually.
export function buildOutfit(style, colors, charGroup) {
  var outfitGroup = new THREE.Group();
  outfitGroup.userData.isOutfit = true;
  var shirtHex = new THREE.Color(colors.shirt_color || '#58a6ff').getHex();
  var pantsHex = new THREE.Color(colors.pants_color || '#2d3748').getHex();
  var mat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.7 });
  var mat2 = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.65 });

  switch (style) {
    case 'hoodie': {
      // Hoodie body — slightly larger than torso, covers it
      var hoodieMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.85 });
      var hoodieBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.21), hoodieMat);
      hoodieBody.position.y = 0.58; hoodieBody.castShadow = true;
      outfitGroup.add(hoodieBody);
      // Hood (behind head)
      var hood = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8, 0, Math.PI * 2, Math.PI * 0.3, Math.PI * 0.5), hoodieMat);
      hood.position.set(0, 0.82, -0.08); hood.castShadow = true;
      outfitGroup.add(hood);
      // Kangaroo pocket
      var pocketMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.9 });
      pocketMat.color.multiplyScalar(0.85);
      var pocket = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.1, 0.01), pocketMat);
      pocket.position.set(0, 0.48, 0.11); pocket.castShadow = true;
      outfitGroup.add(pocket);
      // Drawstrings
      var stringMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, roughness: 0.5 });
      [-0.04, 0.04].forEach(function(sx) {
        var str = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.12, 4), stringMat);
        str.position.set(sx, 0.7, 0.11);
        outfitGroup.add(str);
      });
      // Arm sleeves (wider)
      var sleeveMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.85 });
      [-0.21, 0.21].forEach(function(sx) {
        var sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.14, 0.11), sleeveMat);
        sleeve.position.set(sx, 0.65, 0); sleeve.castShadow = true;
        outfitGroup.add(sleeve);
      });
      break;
    }
    case 'suit': {
      // Suit jacket — structured, slightly wider shoulders
      var suitMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.5, metalness: 0.05 });
      var jacket = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.34, 0.2), suitMat);
      jacket.position.y = 0.58; jacket.castShadow = true;
      outfitGroup.add(jacket);
      // Lapels (v-shape on front)
      var lapelMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.4 });
      lapelMat.color.multiplyScalar(0.8);
      var lapelGeo = new THREE.BufferGeometry();
      var lv = new Float32Array([
        -0.06, 0.08, 0.005,  0, -0.02, 0.005,  0, 0.08, 0.005,
      ]);
      lapelGeo.setAttribute('position', new THREE.BufferAttribute(lv, 3));
      lapelGeo.computeVertexNormals();
      var leftLapel = new THREE.Mesh(lapelGeo, lapelMat);
      leftLapel.position.set(-0.05, 0.64, 0.1);
      outfitGroup.add(leftLapel);
      var rv = new Float32Array([
        0.06, 0.08, 0.005,  0, -0.02, 0.005,  0, 0.08, 0.005,
      ]);
      var rLapelGeo = new THREE.BufferGeometry();
      rLapelGeo.setAttribute('position', new THREE.BufferAttribute(rv, 3));
      rLapelGeo.computeVertexNormals();
      var rightLapel = new THREE.Mesh(rLapelGeo, lapelMat);
      rightLapel.position.set(0.05, 0.64, 0.1);
      outfitGroup.add(rightLapel);
      // White shirt underneath (visible strip)
      var shirtStrip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.005), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4 }));
      shirtStrip.position.set(0, 0.56, 0.103);
      outfitGroup.add(shirtStrip);
      // Buttons
      var btnMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3, metalness: 0.2 });
      [0.6, 0.52].forEach(function(by) {
        var btn = new THREE.Mesh(new THREE.SphereGeometry(0.01, 6, 4), btnMat);
        btn.position.set(0, by, 0.105);
        outfitGroup.add(btn);
      });
      // Shoulder pads
      [-0.18, 0.18].forEach(function(sx) {
        var pad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.16), suitMat);
        pad.position.set(sx, 0.74, 0); pad.castShadow = true;
        outfitGroup.add(pad);
      });
      break;
    }
    case 'dress': {
      // Dress top (fitted torso)
      var dressMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.6 });
      var dressTop = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.19), dressMat);
      dressTop.position.y = 0.59; dressTop.castShadow = true;
      outfitGroup.add(dressTop);
      // Skirt (flared cylinder below torso)
      var skirtGeo = new THREE.CylinderGeometry(0.12, 0.22, 0.22, 12);
      var skirt = new THREE.Mesh(skirtGeo, dressMat);
      skirt.position.y = 0.34; skirt.castShadow = true;
      outfitGroup.add(skirt);
      // Belt/waist band
      var beltMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.4 });
      beltMat.color.multiplyScalar(0.7);
      var belt = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.03, 0.2), beltMat);
      belt.position.y = 0.44; belt.castShadow = true;
      outfitGroup.add(belt);
      // Small bow at neckline
      var bowMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.5 });
      bowMat.color.multiplyScalar(0.75);
      var bow = new THREE.Mesh(new THREE.SphereGeometry(0.02, 6, 4), bowMat);
      bow.position.set(0, 0.74, 0.1);
      outfitGroup.add(bow);
      break;
    }
    case 'labcoat': {
      // White lab coat over shirt
      var coatMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f0, roughness: 0.4 });
      var coat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.38, 0.21), coatMat);
      coat.position.y = 0.56; coat.castShadow = true;
      outfitGroup.add(coat);
      // Coat extends lower (skirt portion)
      var coatSkirt = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.12, 0.19), coatMat);
      coatSkirt.position.y = 0.34; coatSkirt.castShadow = true;
      outfitGroup.add(coatSkirt);
      // Colored shirt underneath visible at collar
      var underShirt = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.06, 0.005), new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.6 }));
      underShirt.position.set(0, 0.72, 0.108);
      outfitGroup.add(underShirt);
      // Pocket (left breast)
      var pocketMat2 = new THREE.MeshStandardMaterial({ color: 0xe8e8e0, roughness: 0.5 });
      var pocket2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.005), pocketMat2);
      pocket2.position.set(-0.1, 0.62, 0.108);
      outfitGroup.add(pocket2);
      // Pen in pocket
      var pen = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 4), new THREE.MeshStandardMaterial({ color: 0x2244aa, roughness: 0.3 }));
      pen.position.set(-0.08, 0.66, 0.112);
      outfitGroup.add(pen);
      // Coat sleeves (white, over arms)
      [-0.22, 0.22].forEach(function(sx) {
        var sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.1), coatMat);
        sleeve.position.set(sx, 0.64, 0); sleeve.castShadow = true;
        outfitGroup.add(sleeve);
      });
      break;
    }
    case 'vest': {
      // Sleeveless vest over shirt
      var vestMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.55 });
      var vestBody = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.33, 0.19), vestMat);
      vestBody.position.y = 0.58; vestBody.castShadow = true;
      outfitGroup.add(vestBody);
      // V-neck opening showing shirt
      var vShirt = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.005), new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.5 }));
      vShirt.position.set(0, 0.66, 0.098);
      outfitGroup.add(vShirt);
      // Buttons
      var vBtnMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.3 });
      [0.62, 0.56, 0.50].forEach(function(by) {
        var btn = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), vBtnMat);
        btn.position.set(0.04, by, 0.1);
        outfitGroup.add(btn);
      });
      break;
    }
    case 'jacket': {
      // Casual zip-up jacket
      var jacketMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.7 });
      var jacketBody = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.2), jacketMat);
      jacketBody.position.y = 0.58; jacketBody.castShadow = true;
      outfitGroup.add(jacketBody);
      // Zipper (metallic line down center)
      var zipMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.2, metalness: 0.6 });
      var zip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.28, 0.005), zipMat);
      zip.position.set(0, 0.58, 0.105);
      outfitGroup.add(zip);
      // Zip pull tab
      var tab = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.02, 0.008), zipMat);
      tab.position.set(0, 0.66, 0.11);
      outfitGroup.add(tab);
      // Collar (standing)
      var collarMat = new THREE.MeshStandardMaterial({ color: shirtHex, roughness: 0.65 });
      collarMat.color.multiplyScalar(0.9);
      var collar = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.16), collarMat);
      collar.position.set(0, 0.78, 0); collar.castShadow = true;
      outfitGroup.add(collar);
      // Sleeves
      [-0.22, 0.22].forEach(function(sx) {
        var sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), jacketMat);
        sleeve.position.set(sx, 0.65, 0); sleeve.castShadow = true;
        outfitGroup.add(sleeve);
      });
      break;
    }
  }

  charGroup.add(outfitGroup);
  return outfitGroup;
}

export function removeOutfit(charGroup) {
  var toRemove = [];
  charGroup.children.forEach(function(c) {
    if (c.userData && c.userData.isOutfit) toRemove.push(c);
  });
  toRemove.forEach(function(c) {
    charGroup.remove(c);
    c.traverse(function(ch) { if (ch.geometry) ch.geometry.dispose(); if (ch.material) ch.material.dispose(); });
  });
}
