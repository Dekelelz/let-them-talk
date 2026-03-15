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
  }
  return group;
}
