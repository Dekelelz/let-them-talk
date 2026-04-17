import * as THREE from 'three';
import { mat, PAL } from './materials.js';

export default {
  id: 'glass-wall',
  name: 'Glass Wall',
  category: 'structural',
  icon: 'GW',
  gridW: 2, gridD: 1, height: 3,
  factory: function() {
    var g = new THREE.Group();

    // Glass panel
    var panel = new THREE.Mesh(
      new THREE.BoxGeometry(2, 3, 0.06),
      PAL.glass()
    );
    panel.castShadow = false;
    panel.receiveShadow = true;
    g.add(panel);

    // Top chrome frame
    var topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.08, 0.1),
      PAL.chrome()
    );
    topFrame.position.y = 1.5;
    topFrame.castShadow = true;
    g.add(topFrame);

    // Bottom chrome frame
    var botFrame = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.08, 0.1),
      PAL.chrome()
    );
    botFrame.position.y = -1.5;
    botFrame.castShadow = true;
    g.add(botFrame);

    // Left vertical chrome post
    var leftPost = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 3, 0.1),
      PAL.chrome()
    );
    leftPost.position.x = -0.97;
    leftPost.castShadow = true;
    g.add(leftPost);

    // Right vertical chrome post
    var rightPost = leftPost.clone();
    rightPost.position.x = 0.97;
    g.add(rightPost);

    // Mid chrome rail (horizontal)
    var midRail = new THREE.Mesh(
      new THREE.BoxGeometry(2, 0.04, 0.08),
      PAL.chromeBrushed()
    );
    midRail.position.y = 0.5;
    g.add(midRail);

    return g;
  }
};
