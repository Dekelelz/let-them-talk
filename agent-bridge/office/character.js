import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { resolveAppearance } from './appearance.js';
import { buildHair } from './hair.js';
import { buildFaceSprite } from './face.js';
import { buildGlasses, buildHeadwear, buildNeckwear } from './accessories.js';
import { buildOutfit } from './outfits.js';

// Body type scale multipliers (all keep the chibi oversized head)
var BODY_TYPES = {
  default: { torsoW: 1, torsoH: 1, torsoD: 1, legW: 1, legH: 1, armW: 1, armH: 1, legSpread: 1, armSpread: 1, headY: 0 },
  stocky:  { torsoW: 1.3, torsoH: 0.95, torsoD: 1.25, legW: 1.25, legH: 0.9, armW: 1.2, armH: 0.95, legSpread: 1.2, armSpread: 1.15, headY: -0.02 },
  slim:    { torsoW: 0.82, torsoH: 1.1, torsoD: 0.85, legW: 0.8, legH: 1.08, armW: 0.8, armH: 1.05, legSpread: 0.85, armSpread: 0.9, headY: 0.04 },
};

export function createCharacter(name, appearance) {
  var a = resolveAppearance(name, appearance);
  var bt = BODY_TYPES[a.body_type] || BODY_TYPES.default;
  var group = new THREE.Group();
  group.userData.agentName = name;

  // Shadow
  var shadowGeo = new THREE.PlaneGeometry(0.5, 0.5);
  var shadowMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 });
  var shadow = new THREE.Mesh(shadowGeo, shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  shadow.userData.isShadow = true;
  group.add(shadow);

  // Materials
  var bodyMat = new THREE.MeshStandardMaterial({ color: a.shirt_hex, roughness: 0.7 });
  var legMat = new THREE.MeshStandardMaterial({ color: a.pants_hex, roughness: 0.7 });
  var shoeMat = new THREE.MeshStandardMaterial({ color: a.shoe_hex, roughness: 0.6 });
  var armMat = new THREE.MeshStandardMaterial({ color: a.shirt_hex, roughness: 0.7 });
  var handMat = new THREE.MeshStandardMaterial({ color: a.head_hex, roughness: 0.7 });

  // Torso (scaled by body type)
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.3 * bt.torsoW, 0.32 * bt.torsoH, 0.18 * bt.torsoD), bodyMat);
  body.position.y = 0.58; body.castShadow = true;
  group.add(body);

  // Left Leg
  var legXOffset = 0.08 * bt.legSpread;
  var leftLeg = new THREE.Group();
  leftLeg.position.set(-legXOffset, 0.42, 0);
  group.add(leftLeg);
  var leftUpperLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1 * bt.legW, 0.18 * bt.legH, 0.1 * bt.legW), legMat);
  leftUpperLeg.position.y = -0.09 * bt.legH; leftUpperLeg.castShadow = true;
  leftLeg.add(leftUpperLeg);
  var leftLowerLeg = new THREE.Group();
  leftLowerLeg.position.set(0, -0.18 * bt.legH, 0);
  leftLeg.add(leftLowerLeg);
  var leftShin = new THREE.Mesh(new THREE.BoxGeometry(0.09 * bt.legW, 0.16 * bt.legH, 0.09 * bt.legW), legMat);
  leftShin.position.y = -0.08 * bt.legH; leftShin.castShadow = true;
  leftLowerLeg.add(leftShin);
  var leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * bt.legW, 0.05, 0.14), shoeMat);
  leftShoe.position.set(0, -0.18 * bt.legH, 0.02); leftShoe.castShadow = true;
  leftLowerLeg.add(leftShoe);

  // Right Leg
  var rightLeg = new THREE.Group();
  rightLeg.position.set(legXOffset, 0.42, 0);
  group.add(rightLeg);
  var rightUpperLeg = new THREE.Mesh(new THREE.BoxGeometry(0.1 * bt.legW, 0.18 * bt.legH, 0.1 * bt.legW), legMat);
  rightUpperLeg.position.y = -0.09 * bt.legH; rightUpperLeg.castShadow = true;
  rightLeg.add(rightUpperLeg);
  var rightLowerLeg = new THREE.Group();
  rightLowerLeg.position.set(0, -0.18 * bt.legH, 0);
  rightLeg.add(rightLowerLeg);
  var rightShin = new THREE.Mesh(new THREE.BoxGeometry(0.09 * bt.legW, 0.16 * bt.legH, 0.09 * bt.legW), legMat);
  rightShin.position.y = -0.08 * bt.legH; rightShin.castShadow = true;
  rightLowerLeg.add(rightShin);
  var rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.1 * bt.legW, 0.05, 0.14), shoeMat);
  rightShoe.position.set(0, -0.18 * bt.legH, 0.02); rightShoe.castShadow = true;
  rightLowerLeg.add(rightShoe);

  // Left Arm
  var armXOffset = 0.21 * bt.armSpread;
  var leftArm = new THREE.Group();
  leftArm.position.set(-armXOffset, 0.7, 0);
  group.add(leftArm);
  var leftUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.08 * bt.armW, 0.16 * bt.armH, 0.08 * bt.armW), armMat);
  leftUpperArm.position.y = -0.08 * bt.armH; leftUpperArm.castShadow = true;
  leftArm.add(leftUpperArm);
  var leftForearm = new THREE.Group();
  leftForearm.position.set(0, -0.16 * bt.armH, 0);
  leftArm.add(leftForearm);
  var leftForearmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07 * bt.armW, 0.14 * bt.armH, 0.07 * bt.armW), armMat);
  leftForearmMesh.position.y = -0.07 * bt.armH; leftForearmMesh.castShadow = true;
  leftForearm.add(leftForearmMesh);
  var leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), handMat);
  leftHand.position.y = -0.16 * bt.armH;
  leftForearm.add(leftHand);

  // Right Arm
  var rightArm = new THREE.Group();
  rightArm.position.set(armXOffset, 0.7, 0);
  group.add(rightArm);
  var rightUpperArm = new THREE.Mesh(new THREE.BoxGeometry(0.08 * bt.armW, 0.16 * bt.armH, 0.08 * bt.armW), armMat);
  rightUpperArm.position.y = -0.08 * bt.armH; rightUpperArm.castShadow = true;
  rightArm.add(rightUpperArm);
  var rightForearm = new THREE.Group();
  rightForearm.position.set(0, -0.16 * bt.armH, 0);
  rightArm.add(rightForearm);
  var rightForearmMesh = new THREE.Mesh(new THREE.BoxGeometry(0.07 * bt.armW, 0.14 * bt.armH, 0.07 * bt.armW), armMat);
  rightForearmMesh.position.y = -0.07 * bt.armH; rightForearmMesh.castShadow = true;
  rightForearm.add(rightForearmMesh);
  var rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), handMat);
  rightHand.position.y = -0.16 * bt.armH;
  rightForearm.add(rightHand);

  // Head (always same chibi size regardless of body type)
  var headGeo = new THREE.SphereGeometry(0.25, 20, 16);
  var headMat = new THREE.MeshStandardMaterial({ color: a.head_hex, roughness: 0.6 });
  var head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.05 + bt.headY; head.castShadow = true;
  group.add(head);

  // Hair
  var hairGroup = buildHair(a.hair_style, a.hair_hex);
  hairGroup.position.y = 1.05 + bt.headY;
  group.add(hairGroup);

  // Face
  var faceSprite = buildFaceSprite(a.eye_style, a.mouth_style, false);
  faceSprite.position.set(0, 0, 0.251);
  head.add(faceSprite);

  // Outfit (layered on top of body)
  var outfitGroup = null;
  if (a.outfit) {
    outfitGroup = buildOutfit(a.outfit, { shirt_color: a.shirt_color, pants_color: a.pants_color }, group);
  }

  // Accessories
  if (a.glasses) buildGlasses(a.glasses, a.glasses_color || '#555555', head);
  if (a.headwear) buildHeadwear(a.headwear, a.headwear_color || '#333333', head);
  if (a.neckwear && !a.outfit) buildNeckwear(a.neckwear, a.neckwear_color || '#c0392b', group);

  // Name label
  var labelDiv = document.createElement('div');
  labelDiv.className = 'office3d-label';
  labelDiv.innerHTML = '<span class="office3d-label-name"></span><span class="office3d-label-dot"></span>';
  var label = new CSS2DObject(labelDiv);
  label.position.set(0, 1.55, 0);
  group.add(label);

  // Bubble
  var bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'office3d-bubble';
  bubbleDiv.style.display = 'none';
  var bubble = new CSS2DObject(bubbleDiv);
  bubble.position.set(0, 1.8, 0);
  group.add(bubble);

  // ZZZ sprites
  var zzzObjects = [];
  ['z', 'Z', 'Z'].forEach(function(letter, i) {
    var zDiv = document.createElement('div');
    zDiv.className = 'office3d-zzz';
    zDiv.textContent = letter;
    zDiv.style.fontSize = (10 + i * 4) + 'px';
    var zObj = new CSS2DObject(zDiv);
    zObj.position.set(0.15 + i * 0.1, 1.4 + i * 0.15, 0);
    zObj.visible = false;
    group.add(zObj);
    zzzObjects.push({ obj: zObj, div: zDiv, baseY: 1.4 + i * 0.15, index: i });
  });

  // Task indicator
  var taskDiv = document.createElement('div');
  taskDiv.className = 'office3d-task-indicator working';
  var taskLabel = new CSS2DObject(taskDiv);
  taskLabel.position.set(0, 1.7, 0);
  taskLabel.visible = false;
  group.add(taskLabel);

  // Typing dots
  var typingDiv = document.createElement('div');
  typingDiv.className = 'office3d-typing';
  typingDiv.innerHTML = '<span class="office3d-typing-dot"></span><span class="office3d-typing-dot"></span><span class="office3d-typing-dot"></span>';
  var typingLabel = new CSS2DObject(typingDiv);
  typingLabel.position.set(0, 1.65, 0);
  typingLabel.visible = false;
  group.add(typingLabel);

  return {
    group: group,
    body: body, head: head,
    leftLeg: leftLeg, rightLeg: rightLeg,
    leftLowerLeg: leftLowerLeg, rightLowerLeg: rightLowerLeg,
    leftArm: leftArm, rightArm: rightArm,
    leftForearm: leftForearm, rightForearm: rightForearm,
    leftHand: leftHand, rightHand: rightHand,
    leftShoe: leftShoe, rightShoe: rightShoe,
    faceSprite: faceSprite, hairGroup: hairGroup,
    outfitGroup: outfitGroup,
    label: label, labelDiv: labelDiv,
    bubble: bubble, bubbleDiv: bubbleDiv,
    shadow: shadow,
    bodyMat: bodyMat, legMat: legMat, headMat: headMat,
    armMat: armMat, handMat: handMat, shoeMat: shoeMat,
    zzzObjects: zzzObjects,
    taskDiv: taskDiv, taskLabel: taskLabel,
    typingDiv: typingDiv, typingLabel: typingLabel
  };
}
