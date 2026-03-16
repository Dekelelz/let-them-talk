import * as THREE from 'three';

export function buildHair(style, colorHex) {
  var group = new THREE.Group();
  var mat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.8 });
  switch (style) {
    case 'short': {
      var geo = new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      var hair = new THREE.Mesh(geo, mat);
      hair.position.y = 0.02; hair.castShadow = true;
      group.add(hair);
      break;
    }
    case 'spiky': {
      for (var i = 0; i < 6; i++) {
        var angle = (i / 6) * Math.PI * 2;
        var spike = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.2, 6), mat);
        spike.position.set(Math.cos(angle) * 0.18, 0.2, Math.sin(angle) * 0.18);
        spike.rotation.x = Math.sin(angle) * 0.4;
        spike.rotation.z = -Math.cos(angle) * 0.4;
        spike.castShadow = true;
        group.add(spike);
      }
      var topSpike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 6), mat);
      topSpike.position.y = 0.3; topSpike.castShadow = true;
      group.add(topSpike);
      break;
    }
    case 'long': {
      var capGeo = new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      var cap = new THREE.Mesh(capGeo, mat);
      cap.position.y = 0.02; cap.castShadow = true;
      group.add(cap);
      [-0.22, 0.22].forEach(function(x) {
        var panel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.35, 0.12), mat);
        panel.position.set(x, -0.1, 0);
        panel.castShadow = true;
        group.add(panel);
      });
      break;
    }
    case 'ponytail': {
      var capGeo2 = new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2);
      var cap2 = new THREE.Mesh(capGeo2, mat);
      cap2.position.y = 0.02; cap2.castShadow = true;
      group.add(cap2);
      var ptGeo = new THREE.CapsuleGeometry(0.06, 0.2, 4, 8);
      var pt = new THREE.Mesh(ptGeo, mat);
      pt.position.set(0, 0.05, -0.25);
      pt.rotation.x = 0.4; pt.castShadow = true;
      group.add(pt);
      break;
    }
    case 'bob': {
      var capGeo3 = new THREE.SphereGeometry(0.28, 16, 12);
      var cap3 = new THREE.Mesh(capGeo3, mat);
      cap3.position.y = 0.02;
      cap3.scale.set(1, 0.7, 1);
      cap3.castShadow = true;
      group.add(cap3);
      break;
    }
    case 'curly': {
      // Clustered spheres for curly volume
      var curlPositions = [
        [0, 0.18, 0.08], [0.15, 0.15, 0.05], [-0.15, 0.15, 0.05],
        [0.1, 0.22, 0], [-0.1, 0.22, 0], [0, 0.26, -0.02],
        [0.18, 0.08, -0.05], [-0.18, 0.08, -0.05],
        [0.12, 0.05, -0.15], [-0.12, 0.05, -0.15], [0, 0.1, -0.18],
        [0.08, 0.2, -0.1], [-0.08, 0.2, -0.1],
      ];
      curlPositions.forEach(function(p) {
        var curl = new THREE.Mesh(new THREE.SphereGeometry(0.07 + Math.random() * 0.03, 8, 6), mat);
        curl.position.set(p[0], p[1], p[2]);
        curl.castShadow = true;
        group.add(curl);
      });
      break;
    }
    case 'afro': {
      // Large round afro — big sphere with smaller detail spheres
      var afroMain = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 14), mat);
      afroMain.position.y = 0.1;
      afroMain.scale.set(1, 0.85, 1);
      afroMain.castShadow = true;
      group.add(afroMain);
      // Texture bumps around the perimeter
      for (var ai = 0; ai < 10; ai++) {
        var aa = (ai / 10) * Math.PI * 2;
        var bump = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 5), mat);
        bump.position.set(Math.cos(aa) * 0.32, 0.1 + Math.sin(aa * 0.5) * 0.08, Math.sin(aa) * 0.32);
        bump.castShadow = true;
        group.add(bump);
      }
      break;
    }
    case 'bun': {
      // Smooth cap + bun on top
      var bunCap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      bunCap.position.y = 0.02; bunCap.castShadow = true;
      group.add(bunCap);
      var bunBall = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat);
      bunBall.position.set(0, 0.28, -0.06);
      bunBall.castShadow = true;
      group.add(bunBall);
      // Hair band around bun
      var bandMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
      var band = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 16), bandMat);
      band.position.set(0, 0.28, -0.06);
      band.rotation.x = Math.PI / 6;
      group.add(band);
      break;
    }
    case 'braids': {
      // Cap + two braided strands (capsule chains) hanging down sides
      var braidCap = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      braidCap.position.y = 0.02; braidCap.castShadow = true;
      group.add(braidCap);
      [-0.2, 0.2].forEach(function(sx) {
        for (var bi = 0; bi < 5; bi++) {
          var seg = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 5), mat);
          var zigzag = (bi % 2 === 0 ? 0.02 : -0.02);
          seg.position.set(sx + zigzag, -0.05 - bi * 0.07, 0);
          seg.castShadow = true;
          group.add(seg);
        }
        // Braid tie at bottom
        var tieMat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
        var tie = new THREE.Mesh(new THREE.SphereGeometry(0.025, 6, 5), tieMat);
        tie.position.set(sx, -0.05 - 5 * 0.07, 0);
        group.add(tie);
      });
      break;
    }
    case 'mohawk': {
      // Central ridge of fin-like shapes along the top
      for (var mi = 0; mi < 7; mi++) {
        var mz = 0.15 - mi * 0.05;
        var mh = 0.14 + Math.sin(mi / 6 * Math.PI) * 0.1;
        var fin = new THREE.Mesh(new THREE.BoxGeometry(0.04, mh, 0.04), mat);
        fin.position.set(0, 0.2 + mh / 2, mz);
        fin.castShadow = true;
        group.add(fin);
      }
      // Shaved sides (darker material, thin caps)
      var sideMat = new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.9 });
      sideMat.color.multiplyScalar(0.4);
      [-1, 1].forEach(function(side) {
        var sideHair = new THREE.Mesh(new THREE.SphereGeometry(0.255, 12, 8, 0, Math.PI, 0, Math.PI / 2.5), sideMat);
        sideHair.position.y = 0.01;
        sideHair.rotation.y = side > 0 ? 0 : Math.PI;
        sideHair.castShadow = true;
        group.add(sideHair);
      });
      break;
    }
    case 'wavy': {
      // Flowing wavy hair — cap + wavy side panels using sine-displaced boxes
      var wavyCap = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      wavyCap.position.y = 0.02; wavyCap.castShadow = true;
      group.add(wavyCap);
      [-0.2, 0.2].forEach(function(wx) {
        for (var wi = 0; wi < 6; wi++) {
          var waveX = wx + Math.sin(wi * 1.2) * 0.04;
          var seg2 = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.05, 0.1), mat);
          seg2.position.set(waveX, -0.02 - wi * 0.055, -0.02);
          seg2.rotation.z = Math.sin(wi * 1.2) * 0.15;
          seg2.castShadow = true;
          group.add(seg2);
        }
      });
      // Back flow
      for (var bwi = 0; bwi < 4; bwi++) {
        var backSeg = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 0.06), mat);
        backSeg.position.set(0, -0.02 - bwi * 0.06, -0.22 - bwi * 0.02);
        backSeg.castShadow = true;
        group.add(backSeg);
      }
      break;
    }
  }
  return group;
}
