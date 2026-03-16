import { S } from './state.js';
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { updateMonitorScreen, setMonitorDim } from './monitors.js';

export function easeInOutQuad(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function updateAgent(agent, dt, time) {
  var isWalking = agent.target !== null;
  var isSleeping = agent.state === 'sleeping';
  var isDead = agent.state === 'dead';

  // Death removal
  if (agent.dying) {
    agent.deathOpacity = Math.max(0, agent.deathOpacity - dt * 2);
    var s = Math.max(0.01, agent.deathOpacity);
    agent.parts.group.scale.set(s, s, s);
    if (agent.deathOpacity <= 0) {
      S.scene.remove(agent.parts.group);
      disposeAgent(agent);
      delete S.agents3d[agent.name];
      return;
    }
  }

  // Walk
  if (agent.target && agent.walkDuration > 0) {
    var speedMult = S.conversationVelocity === 1 ? 1.5 : (S.conversationVelocity === -1 ? 0.8 : 1);
    agent.walkProgress += (dt / agent.walkDuration) * speedMult;
    if (agent.walkProgress >= 1) {
      agent.pos.x = agent.target.x;
      agent.pos.z = agent.target.z;
      var cb = agent.target.cb;
      agent.target = null;
      agent.walkProgress = 0;
      if (agent.walkQueue && agent.walkQueue.length > 0) {
        var next = agent.walkQueue.shift();
        // Trigger door animation if waypoint requires it
        if (next.triggerDoor && S._managerDoor) {
          S._managerDoorOpen = 1;
        }
        walkTo(agent, next.x, next.z, next.cb);
      } else if (cb) {
        cb();
      }
    } else {
      var t = easeInOutQuad(agent.walkProgress);
      agent.pos.x = agent.walkStart.x + (agent.target.x - agent.walkStart.x) * t;
      agent.pos.z = agent.walkStart.z + (agent.target.z - agent.walkStart.z) * t;
    }
  }

  agent.parts.group.position.x = agent.pos.x;
  agent.parts.group.position.z = agent.pos.z;

  if (isDead && !agent.dying) {
    agent.parts.group.visible = false;
    return;
  }
  agent.parts.group.visible = true;

  // Hand-raise gesture
  if (agent.handRaiseTimer > 0) {
    agent.handRaiseTimer -= dt;
    var raiseT = agent.handRaiseTimer / 0.4;
    agent.parts.rightArm.rotation.z = -Math.sin(raiseT * Math.PI) * 1.2;
    agent.parts.rightArm.rotation.x = -Math.sin(raiseT * Math.PI) * 0.3;
  }

  // Wave gesture (both arms up, friendly wave)
  if (agent.waveTimer > 0) {
    agent.waveTimer -= dt;
    var wT = agent.waveTimer / 0.8;
    agent.parts.rightArm.rotation.z = -Math.sin(wT * Math.PI) * 1.4;
    agent.parts.rightArm.rotation.x = Math.sin(time * 12) * 0.3 * wT;
    agent.parts.leftArm.rotation.z = Math.sin(wT * Math.PI) * 0.3;
  }

  // Thinking gesture (hand on chin, head tilted)
  if (agent.thinkTimer > 0) {
    agent.thinkTimer -= dt;
    var thT = Math.min(1, agent.thinkTimer / 1.5);
    agent.parts.rightArm.rotation.x = -1.0 * thT;
    agent.parts.rightForearm.rotation.x = -1.5 * thT;
    agent.parts.head.rotation.z = 0.1 * thT;
    agent.parts.head.rotation.x = -0.08 * thT;
  }

  // Pointing gesture (right arm extended forward)
  if (agent.pointTimer > 0) {
    agent.pointTimer -= dt;
    var ptT = agent.pointTimer / 0.6;
    agent.parts.rightArm.rotation.x = -Math.sin(ptT * Math.PI) * 1.4;
    agent.parts.rightForearm.rotation.x = -0.1 * Math.sin(ptT * Math.PI);
  }

  // Celebrate gesture (both arms up, bounce)
  if (agent.celebrateTimer > 0) {
    agent.celebrateTimer -= dt;
    var celT = agent.celebrateTimer / 1.5;
    agent.parts.leftArm.rotation.z = Math.sin(celT * Math.PI) * 1.6;
    agent.parts.rightArm.rotation.z = -Math.sin(celT * Math.PI) * 1.6;
    agent.parts.leftArm.rotation.x = -0.2 * celT;
    agent.parts.rightArm.rotation.x = -0.2 * celT;
    agent.parts.group.position.y += Math.abs(Math.sin(time * 10)) * 0.04 * celT;
  }

  // Stretch gesture (arms wide, body arches back)
  if (agent.stretchTimer > 0) {
    agent.stretchTimer -= dt;
    var stT = agent.stretchTimer / 2;
    var stPhase = Math.sin(stT * Math.PI);
    agent.parts.leftArm.rotation.z = stPhase * 1.3;
    agent.parts.rightArm.rotation.z = -stPhase * 1.3;
    agent.parts.leftArm.rotation.x = -stPhase * 0.5;
    agent.parts.rightArm.rotation.x = -stPhase * 0.5;
    agent.parts.body.rotation.x = -stPhase * 0.15;
    agent.parts.head.rotation.x = -stPhase * 0.2;
  }

  // Idle gesture system — random gestures when sitting and idle
  if (!agent.idleGestureTimer) agent.idleGestureTimer = 5 + Math.random() * 10;
  if (agent.isSitting && agent.state === 'active' && !isWalking && !agent.isListening) {
    agent.idleGestureTimer -= dt;
    if (agent.idleGestureTimer <= 0) {
      agent.idleGestureTimer = 8 + Math.random() * 15;
      var gestures = ['stretch', 'think', 'none', 'none', 'none'];
      var gesture = gestures[Math.floor(Math.random() * gestures.length)];
      if (gesture === 'stretch') agent.stretchTimer = 2;
      else if (gesture === 'think') agent.thinkTimer = 1.5;
    }
  }

  // Face walk direction
  if (isWalking && agent.target) {
    var dx = agent.target.x - agent.pos.x;
    var dz = agent.target.z - agent.pos.z;
    if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
      agent.facingTarget = Math.atan2(dx, dz);
    }
  }

  // Sitting logic
  var atDesk = !agent.location || agent.location === 'desk';
  var shouldSit = !isWalking && agent.registered && !isSleeping && !isDead && agent.handRaiseTimer <= 0 && atDesk;
  if (shouldSit && !agent.isSitting) {
    agent.isSitting = true;
  } else if (!shouldSit && agent.isSitting) {
    agent.isSitting = false;
  }

  var sittingTarget = agent.isSitting ? 1 : 0;
  agent.sittingLerp += (sittingTarget - agent.sittingLerp) * Math.min(1, dt * 5);

  agent.parts.group.position.y = agent.sittingLerp * 0.06;
  var sitHip = -1.5 * agent.sittingLerp;
  agent.parts.leftLeg.rotation.x = agent.parts.leftLeg.rotation.x * (1 - agent.sittingLerp) + sitHip * agent.sittingLerp;
  agent.parts.rightLeg.rotation.x = agent.parts.rightLeg.rotation.x * (1 - agent.sittingLerp) + sitHip * agent.sittingLerp;
  var sitKnee = 1.5 * agent.sittingLerp;
  agent.parts.leftLowerLeg.rotation.x = sitKnee;
  agent.parts.rightLowerLeg.rotation.x = sitKnee;
  agent.parts.leftForearm.rotation.x = -0.4 * agent.sittingLerp;
  agent.parts.rightForearm.rotation.x = -0.4 * agent.sittingLerp;

  // Facing at desk
  if (agent.isSitting && agent.sittingLerp > 0.5) {
    agent.facingTarget = Math.PI;
  }

  // Idle look-around
  if (!isWalking && !agent.isSitting && !isSleeping && agent.registered) {
    agent.facingTarget = Math.sin(time * 0.3 + agent.name.length) * 0.4;
  }

  // Smooth rotation
  var currentRot = agent.parts.group.rotation.y;
  var diff = agent.facingTarget - currentRot;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  agent.parts.group.rotation.y += diff * Math.min(1, dt * 4);

  // Leg/arm swing
  if (isWalking) {
    var swingSpeed = S.conversationVelocity === 1 ? 14 : (S.conversationVelocity === -1 ? 7 : 10);
    var swingAmplitude = S.conversationVelocity === 1 ? 0.7 : (S.conversationVelocity === -1 ? 0.35 : 0.5);
    var swing = Math.sin(time * swingSpeed) * swingAmplitude;
    agent.parts.leftLeg.rotation.x = swing;
    agent.parts.rightLeg.rotation.x = -swing;
    agent.parts.leftLowerLeg.rotation.x = Math.max(0, -swing) * 0.8;
    agent.parts.rightLowerLeg.rotation.x = Math.max(0, swing) * 0.8;
    agent.parts.leftArm.rotation.x = -swing * 0.7;
    agent.parts.rightArm.rotation.x = swing * 0.7;
    agent.parts.leftForearm.rotation.x = -0.3 - Math.abs(swing) * 0.3;
    agent.parts.rightForearm.rotation.x = -0.3 - Math.abs(swing) * 0.3;
  } else if (!agent.isSitting) {
    agent.parts.leftLeg.rotation.x *= 0.9;
    agent.parts.rightLeg.rotation.x *= 0.9;
    agent.parts.leftArm.rotation.x *= 0.9;
    agent.parts.rightArm.rotation.x *= 0.9;
    agent.parts.leftLowerLeg.rotation.x *= 0.9;
    agent.parts.rightLowerLeg.rotation.x *= 0.9;
    agent.parts.leftForearm.rotation.x *= 0.9;
    agent.parts.rightForearm.rotation.x *= 0.9;
  }

  // Idle breathing
  if (!isWalking && !isSleeping) {
    var breatheSpeed = S.conversationVelocity === -1 ? 1.2 : 2;
    var breathe = 1 + Math.sin(time * breatheSpeed) * 0.02;
    agent.parts.body.scale.y = breathe;
    if (!agent.isSitting) {
      agent.parts.head.rotation.z = Math.sin(time * 0.5) * 0.03;
    }
  }

  // Sleep transition
  var sleepTarget = isSleeping ? 1 : 0;
  agent.sleepTransition += (sleepTarget - agent.sleepTransition) * Math.min(1, dt * (isSleeping ? 1 : 4));
  agent.parts.head.rotation.x = agent.sleepTransition * 0.35;
  agent.parts.body.rotation.x = agent.sleepTransition * 0.18;

  // Wake-up bounce
  if (agent.prevState === 'sleeping' && agent.state === 'active') {
    if (agent.sleepTransition < 0.05) {
      agent.prevState = null;
      agent.parts.group.position.y = 0.08;
    }
  }

  // ZZZ floating sprites
  if (isSleeping && agent.sleepTransition > 0.5) {
    if (!agent.zzzActive) {
      agent.zzzActive = true;
      agent.parts.zzzObjects.forEach(function(z) { z.obj.visible = true; });
    }
    agent.parts.zzzObjects.forEach(function(z) {
      var phase = time * 1.5 + z.index * 1.2;
      var cycleT = (phase % 3) / 3;
      var yOff = cycleT * 0.5;
      var xOff = Math.sin(phase * 2) * 0.08;
      z.obj.position.set(0.2 + z.index * 0.1 + xOff, z.baseY + yOff, 0);
      var opacity = cycleT < 0.2 ? cycleT / 0.2 : (cycleT > 0.7 ? (1 - cycleT) / 0.3 : 1);
      z.div.style.opacity = String(Math.max(0, opacity));
    });
  } else if (agent.zzzActive) {
    agent.zzzActive = false;
    agent.parts.zzzObjects.forEach(function(z) {
      z.obj.visible = false;
      z.div.style.opacity = '0';
    });
  }

  // Listening head-tilt
  if (agent.isListening && !isWalking && !isSleeping) {
    agent.parts.head.rotation.z = Math.sin(time * 1.5) * 0.08;
  }

  // Listen-lost alert (head shake + warning indicator)
  if (agent.listenLostTimer > 0) {
    agent.listenLostTimer -= dt;
    // Head shake animation (rapid left-right)
    var shakeT = agent.listenLostTimer;
    if (shakeT > 1.5) {
      agent.parts.head.rotation.y = Math.sin(time * 20) * 0.15;
    }
    // Show warning indicator above head
    if (!agent._listenLostDiv) {
      agent._listenLostDiv = document.createElement('div');
      agent._listenLostDiv.className = 'office3d-listen-lost';
      agent._listenLostDiv.innerHTML = '<span style="color:#ef4444;font-size:14px;font-weight:bold;text-shadow:0 0 6px rgba(239,68,68,0.6);animation:office3d-pulse 0.5s infinite">&#x26A0; NOT LISTENING</span>';
      agent._listenLostLabel = new CSS2DObject(agent._listenLostDiv);
      agent._listenLostLabel.position.set(0, 1.9, 0);
      agent.parts.group.add(agent._listenLostLabel);
    }
    agent._listenLostDiv.style.display = 'block';
    agent._listenLostDiv.style.opacity = String(Math.min(1, agent.listenLostTimer));
    if (agent.listenLostTimer <= 0) {
      agent._listenLostDiv.style.display = 'none';
      agent.listenLostTimer = 0;
      agent.parts.head.rotation.y = 0;
    }
  } else if (agent._listenLostDiv) {
    agent._listenLostDiv.style.display = 'none';
  }

  // Typing dots
  var showTyping = agent.state === 'active' && !agent.isListening && !isWalking && !isSleeping && agent.registered && agent.isSitting;
  agent.parts.typingLabel.visible = showTyping;

  // Task indicator
  var task = agent.currentTask;
  if (agent.taskCelebration > 0) {
    agent.taskCelebration -= dt;
    agent.parts.taskLabel.visible = true;
    agent.parts.taskDiv.className = 'office3d-task-indicator done';
    agent.parts.taskDiv.textContent = '\u2714 Done!';
    var bounceT = agent.taskCelebration / 2;
    agent.parts.group.position.y += Math.abs(Math.sin(bounceT * Math.PI * 4)) * 0.05;
    if (agent.taskCelebration <= 0) {
      agent.parts.taskLabel.visible = false;
      agent.taskCelebration = 0;
    }
  } else if (task) {
    var taskStatus = task.status || '';
    if (taskStatus === 'in_progress' || taskStatus === 'in-progress') {
      agent.parts.taskLabel.visible = true;
      agent.parts.taskDiv.className = 'office3d-task-indicator working';
      agent.parts.taskDiv.textContent = '\u2699 Working';
    } else if (taskStatus === 'blocked') {
      agent.parts.taskLabel.visible = true;
      agent.parts.taskDiv.className = 'office3d-task-indicator blocked';
      agent.parts.taskDiv.textContent = '\u2757 Blocked';
    } else {
      agent.parts.taskLabel.visible = false;
    }
  } else {
    agent.parts.taskLabel.visible = false;
  }

  // Monitor screen content
  if (agent.registered && agent.isSitting && agent.state === 'active') {
    agent.monitorTimer += dt;
    if (agent.monitorTimer >= 0.5) {
      agent.monitorTimer = 0;
      updateMonitorScreen(agent.deskIdx, agent.name, time);
    }
  } else if (agent.registered && isSleeping) {
    setMonitorDim(agent.deskIdx);
  }

  // Bubble timer
  if (agent.bubbleTimer > 0) {
    agent.bubbleTimer -= dt;
    if (agent.bubbleTimer <= 1) {
      agent.parts.bubbleDiv.style.opacity = String(Math.max(0, agent.bubbleTimer));
    }
    if (agent.bubbleTimer <= 0) {
      agent.parts.bubbleDiv.style.display = 'none';
      agent.bubbleTimer = 0;
    }
  }
}

function walkTo(agent, tx, tz, callback) {
  var dx = tx - agent.pos.x;
  var dz = tz - agent.pos.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  agent.walkStart = { x: agent.pos.x, z: agent.pos.z };
  agent.target = { x: tx, z: tz, cb: callback || null };
  agent.walkProgress = 0;
  agent.walkDuration = Math.max(dist * 0.4, 0.3);
}

function disposeAgent(agent) {
  agent.parts.group.traverse(function(child) {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.map) child.material.map.dispose();
      child.material.dispose();
    }
  });
  if (agent.parts.labelDiv.parentElement) agent.parts.labelDiv.remove();
  if (agent.parts.bubbleDiv.parentElement) agent.parts.bubbleDiv.remove();
  if (agent.parts.taskDiv && agent.parts.taskDiv.parentElement) agent.parts.taskDiv.remove();
  if (agent.parts.typingDiv && agent.parts.typingDiv.parentElement) agent.parts.typingDiv.remove();
  if (agent.parts.zzzObjects) {
    agent.parts.zzzObjects.forEach(function(z) { if (z.div.parentElement) z.div.remove(); });
  }
}
