import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';
import { DESK_POSITIONS, DRESSING_ROOM_POS, DRESSING_ROOM_ENTRANCE, REST_AREA_POS, REST_AREA_ENTRANCE } from './constants.js';
import { initScene } from './scene.js';
import { buildEnvironment, updateTVScreen } from './environment.js';
import { updateAgent } from './animation.js';
import { syncAgents, processMessages, walkTo, showBubble } from './agents.js';
// Side-effect: registers window.officeGetAppearance
import './appearance.js';

// Expose createCharacter + resolveAppearance for the character designer (Phase 3)
export { createCharacter } from './character.js';
export { resolveAppearance } from './appearance.js';
export { buildHair } from './hair.js';
export { buildFaceSprite } from './face.js';
export { buildGlasses, buildHeadwear, buildNeckwear } from './accessories.js';
export { buildOutfit, removeOutfit } from './outfits.js';

// ===================== RAYCASTER + COMMAND MENU =====================
var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();
var activeMenu = null;       // { agentName, css2dObj, div, timeout }
var clickHandlerBound = null;

function setupClickHandler() {
  if (clickHandlerBound) return;
  // Track mouse-down position to distinguish clicks from camera drags
  var downPos = { x: 0, y: 0 };
  S.renderer.domElement.addEventListener('mousedown', function(e) {
    downPos.x = e.clientX; downPos.y = e.clientY;
  });
  clickHandlerBound = function(event) {
    if (!S.running || !S.renderer) return;
    // Ignore if mouse moved more than 5px (it was a drag, not a click)
    var dx = event.clientX - downPos.x, dy = event.clientY - downPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return;

    var rect = S.renderer.domElement.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, S.camera);

    // Test all agent body meshes
    var agentMeshes = [];
    for (var name in S.agents3d) {
      var agent = S.agents3d[name];
      if (agent.dying) continue;
      // Collect body-part meshes for intersection
      agent.parts.group.traverse(function(child) {
        if (child.isMesh && !child.userData.isShadow) {
          child.userData._agentName = name;
          agentMeshes.push(child);
        }
      });
    }

    var intersects = raycaster.intersectObjects(agentMeshes, false);
    if (intersects.length > 0) {
      var hitAgent = intersects[0].object.userData._agentName;
      if (hitAgent && S.agents3d[hitAgent]) {
        event.stopPropagation();
        showCommandMenu(hitAgent);
        return;
      }
    }

    // Clicked nothing — dismiss menu
    dismissCommandMenu();
  };
  S.renderer.domElement.addEventListener('click', clickHandlerBound);
}

function showCommandMenu(agentName) {
  dismissCommandMenu();
  var agent = S.agents3d[agentName];
  if (!agent) return;

  var loc = agent.location || 'desk';
  var isWalking = agent.target !== null;

  var div = document.createElement('div');
  div.className = 'office3d-cmd-menu';

  var commands = [
    { icon: '\uD83D\uDC57', label: 'Dressing Room', action: 'dressing_room', disabled: loc === 'dressing_room' || isWalking },
    { icon: '\uD83D\uDCA4', label: 'Go Rest', action: 'rest', disabled: loc === 'rest' || isWalking },
    { icon: '\uD83D\uDCBB', label: 'Back to Work', action: 'desk', disabled: loc === 'desk' || isWalking },
    { divider: true },
    { icon: '\u270F\uFE0F', label: 'Edit Profile', action: 'edit_profile', disabled: false },
  ];

  commands.forEach(function(cmd) {
    if (cmd.divider) {
      var d = document.createElement('div');
      d.className = 'office3d-cmd-divider';
      div.appendChild(d);
      return;
    }
    var btn = document.createElement('button');
    btn.className = 'office3d-cmd-btn' + (cmd.disabled ? ' disabled' : '');
    btn.innerHTML = '<span class="office3d-cmd-icon">' + cmd.icon + '</span>' + cmd.label;
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      dismissCommandMenu();
      executeCommand(agentName, cmd.action);
    });
    div.appendChild(btn);
  });

  var menuObj = new CSS2DObject(div);
  menuObj.position.set(0, 2.1, 0);
  agent.parts.group.add(menuObj);

  activeMenu = {
    agentName: agentName,
    css2dObj: menuObj,
    div: div,
    timeout: setTimeout(dismissCommandMenu, 5000),
  };
}

function dismissCommandMenu() {
  if (!activeMenu) return;
  var agent = S.agents3d[activeMenu.agentName];
  if (agent) {
    agent.parts.group.remove(activeMenu.css2dObj);
  }
  if (activeMenu.div.parentElement) activeMenu.div.remove();
  clearTimeout(activeMenu.timeout);
  activeMenu = null;
}

function executeCommand(agentName, action) {
  var agent = S.agents3d[agentName];
  if (!agent) return;

  switch (action) {
    case 'dressing_room':
      agent.location = 'walking';
      agent.isSitting = false;
      showBubble(agent, 'Going to change!');
      walkTo(agent, DRESSING_ROOM_ENTRANCE.x, DRESSING_ROOM_ENTRANCE.z, function() {
        walkTo(agent, DRESSING_ROOM_POS.x, DRESSING_ROOM_POS.z, function() {
          agent.location = 'dressing_room';
          agent.isSitting = false;
          showBubble(agent, 'Time for a new look!');
          // Open character editor for this agent
          window.editingAgent = agentName;
          if (typeof window.openProfileEditor === 'function') {
            window.openProfileEditor();
          }
          // Listen for editor close to return to desk
          waitForEditorClose(agent);
        });
      });
      break;

    case 'rest':
      agent.location = 'walking';
      agent.isSitting = false;
      showBubble(agent, 'Need a break...');
      walkTo(agent, REST_AREA_ENTRANCE.x, REST_AREA_ENTRANCE.z, function() {
        walkTo(agent, REST_AREA_POS.x, REST_AREA_POS.z, function() {
          agent.location = 'rest';
          agent.state = 'sleeping';
          agent.isSitting = false;
          showBubble(agent, 'Zzz...');
        });
      });
      break;

    case 'desk':
      agent.location = 'walking';
      agent.state = 'active';
      agent.isSitting = false;
      showBubble(agent, 'Back to work!');
      walkTo(agent, agent.deskPos.x, agent.deskPos.z + 0.7, function() {
        agent.location = 'desk';
        agent.registered = true;
      });
      break;

    case 'edit_profile':
      window.editingAgent = agentName;
      if (typeof window.openProfileEditor === 'function') {
        window.openProfileEditor();
      }
      break;
  }
}

function waitForEditorClose(agent) {
  // Poll for the character designer panel closing
  var checkInterval = setInterval(function() {
    var panel = document.getElementById('char-designer');
    if (!panel || !panel.classList.contains('open')) {
      clearInterval(checkInterval);
      // Agent walks back to desk after editor closes
      if (agent.location === 'dressing_room') {
        agent.location = 'walking';
        showBubble(agent, 'Looking good!');
        walkTo(agent, DRESSING_ROOM_ENTRANCE.x, DRESSING_ROOM_ENTRANCE.z, function() {
          walkTo(agent, agent.deskPos.x, agent.deskPos.z + 0.7, function() {
            agent.location = 'desk';
            agent.registered = true;
          });
        });
      }
    }
  }, 500);
  // Safety: stop checking after 2 minutes
  setTimeout(function() { clearInterval(checkInterval); }, 120000);
}

// ===================== ANIMATION LOOP =====================
function animate() {
  if (!S.running) return;
  S.animationId = requestAnimationFrame(animate);

  var dt = Math.min(S.clock.getDelta(), 0.1);
  var time = S.clock.getElapsedTime();

  for (var name in S.agents3d) {
    updateAgent(S.agents3d[name], dt, time);
  }

  // Update TV screen every ~0.5s for smooth ticker
  if (!S._tvTimer) S._tvTimer = 0;
  S._tvTimer += dt;
  if (S._tvTimer >= 0.15) {
    S._tvTimer = 0;
    updateTVScreen(time);
  }

  S.controls.update(dt);
  S.renderer.render(S.scene, S.camera);
  S.cssRenderer.render(S.scene, S.camera);

  // FPS
  S.fpsCounter++;
  var now = performance.now();
  if (now - S.fpsTime > 1000) {
    var fpsEl = document.getElementById('office-fps');
    if (fpsEl && window.activeView === 'office') fpsEl.textContent = S.fpsCounter + ' fps';
    S.fpsCounter = 0;
    S.fpsTime = now;
  }
}

// ===================== PUBLIC API =====================
window.office3dStart = function() {
  if (S.running) return;
  S.container = document.getElementById('office-3d-container');
  if (!S.container) return;

  if (!S.scene) {
    if (!initScene()) return;
    buildEnvironment();
  }

  if (!S.container.contains(S.renderer.domElement)) {
    S.container.appendChild(S.renderer.domElement);
    S.container.appendChild(S.cssRenderer.domElement);
  }

  var w = S.container.clientWidth;
  var h = S.container.clientHeight;
  if (w > 0 && h > 0) {
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
    S.cssRenderer.setSize(w, h);
  }

  S.running = true;
  S.clock.start();
  S.lastProcessedMsg = 0;
  syncAgents();
  processMessages();
  setupClickHandler();
  animate();

  if (S.syncInterval) clearInterval(S.syncInterval);
  S.syncInterval = setInterval(function() {
    if (S.running && window.activeView === 'office') {
      syncAgents();
      processMessages();
      updateTVScreen(S.clock.getElapsedTime());
    }
  }, 2000);
};

window.office3dStop = function() {
  S.running = false;
  if (S.animationId) {
    cancelAnimationFrame(S.animationId);
    S.animationId = null;
  }
  if (S.syncInterval) {
    clearInterval(S.syncInterval);
    S.syncInterval = null;
  }
  dismissCommandMenu();
};

window.office3dSetEnvironment = function(env) {
  if (env === S.currentEnv) return;
  S.currentEnv = env;
  if (S.scene) {
    buildEnvironment();
    var i = 0;
    for (var name in S.agents3d) {
      var agent = S.agents3d[name];
      if (i < DESK_POSITIONS.length) {
        agent.deskIdx = i;
        agent.deskPos = { x: DESK_POSITIONS[i].x, z: DESK_POSITIONS[i].z };
        walkTo(agent, agent.deskPos.x, agent.deskPos.z + 0.7);
      }
      i++;
    }
  }
};

window.office3dSetCamSpeed = function(speed) {
  if (S.controls) S.controls.moveSpeed = speed;
};

// Handle visibility change for 3D mode
document.addEventListener('visibilitychange', function() {
  if (document.hidden && S.running) {
    window.office3dStop();
  } else if (!document.hidden && window.activeView === 'office' && window.officeMode === '3d') {
    window.office3dStart();
  }
});
