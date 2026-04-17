import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// ============================================================
// ROBOT CHARACTER — Boxy/mechanical design for API agents
// Distinct from chibi characters: metallic, glowing eyes, antenna
// ============================================================

export function createRobotCharacter(name, providerColor) {
  var group = new THREE.Group();
  var color = new THREE.Color(providerColor || '#0ea5e9');
  var colorHex = color.getHex();

  // Materials
  var bodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2d3a, roughness: 0.3, metalness: 0.7 });
  var chromeMat = new THREE.MeshStandardMaterial({ color: 0xaaaaaa, roughness: 0.1, metalness: 0.9 });
  var darkMat = new THREE.MeshStandardMaterial({ color: 0x111118, roughness: 0.4, metalness: 0.5 });
  var glowMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 0.8, roughness: 0.2 });
  var eyeGlowMat = new THREE.MeshStandardMaterial({ color: colorHex, emissive: colorHex, emissiveIntensity: 1.2, roughness: 0.1 });
  var screenMat = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x333333, emissiveIntensity: 0.1, roughness: 0.2 });

  // Shadow
  var shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.6),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  shadow.userData.isShadow = true;
  group.add(shadow);

  // ===== BODY (boxy torso) =====
  var body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.35, 0.25), bodyMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  // Chest panel (darker inset)
  var chestPanel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.01), darkMat);
  chestPanel.position.set(0, 0.55, 0.131);
  group.add(chestPanel);

  // Status LED on chest
  var statusLed = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), glowMat);
  statusLed.position.set(0, 0.6, 0.14);
  group.add(statusLed);

  // Accent stripes on body
  var stripe1 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.01), glowMat);
  stripe1.position.set(0, 0.68, 0.131);
  group.add(stripe1);
  var stripe2 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.015, 0.01), glowMat);
  stripe2.position.set(0, 0.42, 0.131);
  group.add(stripe2);

  // ===== LEGS (cylindrical, mechanical) =====
  var legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.35, 8);
  var leftLeg = new THREE.Mesh(legGeo, chromeMat);
  leftLeg.position.set(-0.1, 0.2, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  var rightLeg = new THREE.Mesh(legGeo, chromeMat);
  rightLeg.position.set(0.1, 0.2, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // Joint rings
  var jointGeo = new THREE.TorusGeometry(0.065, 0.01, 8, 12);
  [-0.1, 0.1].forEach(function(lx) {
    var joint = new THREE.Mesh(jointGeo, glowMat);
    joint.position.set(lx, 0.37, 0);
    joint.rotation.x = Math.PI / 2;
    group.add(joint);
  });

  // Feet (flat boxes)
  [-0.1, 0.1].forEach(function(fx) {
    var foot = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.12), darkMat);
    foot.position.set(fx, 0.02, 0.01);
    group.add(foot);
  });

  // ===== ARMS (jointed, mechanical) =====
  var armGeo = new THREE.CylinderGeometry(0.04, 0.035, 0.25, 8);

  var leftArm = new THREE.Mesh(armGeo, chromeMat);
  leftArm.position.set(-0.28, 0.55, 0);
  leftArm.rotation.z = 0.15;
  leftArm.castShadow = true;
  group.add(leftArm);

  var rightArm = new THREE.Mesh(armGeo, chromeMat);
  rightArm.position.set(0.28, 0.55, 0);
  rightArm.rotation.z = -0.15;
  rightArm.castShadow = true;
  group.add(rightArm);

  // Hands (sphere clamps)
  var handGeo = new THREE.SphereGeometry(0.04, 8, 8);
  var leftHand = new THREE.Mesh(handGeo, bodyMat);
  leftHand.position.set(-0.3, 0.42, 0);
  group.add(leftHand);

  var rightHand = new THREE.Mesh(handGeo, bodyMat);
  rightHand.position.set(0.3, 0.42, 0);
  group.add(rightHand);

  // ===== HEAD (boxy with rounded edges) =====
  var headGeo = new THREE.BoxGeometry(0.3, 0.25, 0.22);
  var head = new THREE.Mesh(headGeo, bodyMat);
  head.position.y = 0.87;
  head.castShadow = true;
  group.add(head);

  // Face plate (visor)
  var visor = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.12, 0.01), darkMat);
  visor.position.set(0, 0.88, 0.115);
  group.add(visor);

  // Glowing eyes (2 dots on visor)
  var eyeGeo = new THREE.SphereGeometry(0.025, 8, 8);
  var leftEye = new THREE.Mesh(eyeGeo, eyeGlowMat);
  leftEye.position.set(-0.06, 0.89, 0.12);
  group.add(leftEye);

  var rightEye = new THREE.Mesh(eyeGeo, eyeGlowMat);
  rightEye.position.set(0.06, 0.89, 0.12);
  group.add(rightEye);

  // Mouth (small LED strip)
  var mouthStrip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.015, 0.01), glowMat);
  mouthStrip.position.set(0, 0.84, 0.12);
  group.add(mouthStrip);

  // ===== ANTENNA (satellite dish style) =====
  var antennaBase = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), chromeMat);
  antennaBase.position.set(0.08, 1.06, 0);
  group.add(antennaBase);

  var antennaDish = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), glowMat);
  antennaDish.position.set(0.08, 1.12, 0);
  antennaDish.rotation.x = Math.PI;
  group.add(antennaDish);

  var antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 6, 6), eyeGlowMat);
  antennaTip.position.set(0.08, 1.14, 0);
  group.add(antennaTip);

  // ===== LABELS =====
  // Name label
  var labelDiv = document.createElement('div');
  labelDiv.className = 'office3d-label';
  labelDiv.innerHTML = '<span class="office3d-label-dot" style="background:#4ade80"></span><span class="office3d-label-name">' + name + '</span><span class="office3d-robot-badge" style="background:' + providerColor + ';color:#fff;font-size:7px;padding:1px 4px;border-radius:3px;margin-left:4px">BOT</span>';
  labelDiv.style.cssText = 'display:flex;align-items:center;gap:4px;background:rgba(0,0,0,0.65);padding:3px 8px;border-radius:6px;font-size:10px;font-family:monospace;color:#c9d1d9;white-space:nowrap;pointer-events:none;border:1px solid ' + providerColor + '44;';
  var label = new CSS2DObject(labelDiv);
  label.position.set(0, 1.35, 0);
  group.add(label);

  // Speech bubble
  var bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'office3d-bubble';
  bubbleDiv.style.cssText = 'display:none;opacity:0;background:rgba(10,10,20,0.85);color:#e0e0e0;padding:6px 12px;border-radius:10px;font-size:11px;max-width:220px;white-space:pre-wrap;word-wrap:break-word;font-family:monospace;pointer-events:none;border:1px solid ' + providerColor + '66;box-shadow:0 0 10px ' + providerColor + '33;';
  var bubble = new CSS2DObject(bubbleDiv);
  bubble.position.set(0, 1.55, 0);
  group.add(bubble);

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

  // ZZZ sprites
  var zzzObjects = [];
  for (var zi = 0; zi < 3; zi++) {
    var zDiv = document.createElement('div');
    zDiv.textContent = 'Z';
    zDiv.style.cssText = 'color:#facc15;font-size:' + (10 + zi * 4) + 'px;font-weight:bold;font-family:monospace;opacity:0;pointer-events:none;';
    var zObj = new CSS2DObject(zDiv);
    zObj.position.set(0.2 + zi * 0.1, 1.2 + zi * 0.15, 0);
    group.add(zObj);
    zzzObjects.push({ obj: zObj, div: zDiv });
  }

  return {
    group: group,
    body: body,
    head: head,
    leftLeg: leftLeg,
    rightLeg: rightLeg,
    leftArm: leftArm,
    rightArm: rightArm,
    leftHand: leftHand,
    rightHand: rightHand,
    statusLed: statusLed,
    antennaTip: antennaTip,
    leftEye: leftEye,
    rightEye: rightEye,
    mouthStrip: mouthStrip,
    label: label,
    labelDiv: labelDiv,
    bubble: bubble,
    bubbleDiv: bubbleDiv,
    zzzObjects: zzzObjects,
    taskDiv: taskDiv, taskLabel: taskLabel,
    typingDiv: typingDiv, typingLabel: typingLabel,
    bodyMat: bodyMat,
    glowMat: glowMat,
    eyeGlowMat: eyeGlowMat,
    screenMat: screenMat,
    isRobot: true,
    // Compatibility with chibi character parts for animation system
    // These dummy objects prevent crashes in animation.js which expects chibi parts
    leftLowerLeg: new THREE.Object3D(),
    rightLowerLeg: new THREE.Object3D(),
    leftForearm: new THREE.Object3D(),
    rightForearm: new THREE.Object3D(),
    faceSprite: null,
    hairGroup: new THREE.Group(),
    headMat: bodyMat,
    legMat: chromeMat,
    shoeMat: darkMat,
    armMat: chromeMat,
    handMat: bodyMat,
    outfitGroup: null,
  };
}

// Robot-specific animations
export function updateRobotAnimation(agent, dt, time) {
  if (!agent.parts || !agent.parts.isRobot) return;

  // Antenna tip pulse
  if (agent.parts.antennaTip) {
    var pulse = (Math.sin(time * 3) + 1) / 2;
    agent.parts.antennaTip.scale.setScalar(0.8 + pulse * 0.4);
  }

  // Eye glow pulse when processing
  if (agent._processing && agent.parts.leftEye) {
    var eyePulse = (Math.sin(time * 8) + 1) / 2;
    agent.parts.eyeGlowMat.emissiveIntensity = 0.6 + eyePulse * 0.8;
  }

  // Status LED blink when idle
  if (agent.parts.statusLed && !agent._processing) {
    var ledPulse = Math.sin(time * 2) > 0.7 ? 1 : 0.3;
    agent.parts.glowMat.emissiveIntensity = ledPulse;
  }

  // Idle head bob (subtle)
  if (agent.parts.head && agent.isSitting && !agent._processing) {
    agent.parts.head.rotation.y = Math.sin(time * 0.5) * 0.05;
  }

  // Processing spin — body slight rotation oscillation
  if (agent._processing && agent.parts.body) {
    agent.parts.body.rotation.y = Math.sin(time * 4) * 0.03;
  }
}
