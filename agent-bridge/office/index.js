import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';
import { DESK_POSITIONS, DRESSING_ROOM_POS, DRESSING_ROOM_ENTRANCE, REST_AREA_POS, REST_AREA_ENTRANCE } from './constants.js';
import { initScene } from './scene.js';
import { buildEnvironment, updateTVScreen } from './environment.js';
import { updateAgent } from './animation.js';
import { syncAgents, processMessages, walkTo, navigateTo, showBubble } from './agents.js';
// Side-effect: registers window.officeGetAppearance
import './appearance.js';
import { spawnPlayer, despawnPlayer, isPlayerMode, updatePlayer, savePlayerAppearance, getPlayerAppearance, getPlayer, invalidateColliders } from './player.js';

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
      navigateTo(agent, DRESSING_ROOM_ENTRANCE.x, DRESSING_ROOM_ENTRANCE.z, function() {
        navigateTo(agent, DRESSING_ROOM_POS.x, DRESSING_ROOM_POS.z, function() {
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
      navigateTo(agent, REST_AREA_ENTRANCE.x, REST_AREA_ENTRANCE.z, function() {
        navigateTo(agent, REST_AREA_POS.x, REST_AREA_POS.z, function() {
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
      navigateTo(agent, agent.deskPos.x, agent.deskPos.z + 0.7, function() {
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
        navigateTo(agent, DRESSING_ROOM_ENTRANCE.x, DRESSING_ROOM_ENTRANCE.z, function() {
          navigateTo(agent, agent.deskPos.x, agent.deskPos.z + 0.7, function() {
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

  // Player avatar mode
  if (isPlayerMode() && S.controls && S.controls.keys) {
    updatePlayer(dt, time, S.controls.keys);
  }

  // Hide roof when camera is above ceiling height
  if (S._roofGroup) {
    S._roofGroup.visible = S.camera.position.y < 6.5;
  }

  // Manager office door animation — opens when agent is near the door
  if (S._managerDoor && S._managerOfficePos) {
    var doorX = S._managerOfficePos.x;
    var doorZ = S._managerOfficePos.z - 3.5; // front of office
    var shouldOpen = false;
    for (var an in S.agents3d) {
      var ag = S.agents3d[an];
      if (ag.target || ag.location === 'walking') {
        var adx = ag.pos.x - doorX;
        var adz = ag.pos.z - doorZ;
        if (Math.sqrt(adx * adx + adz * adz) < 3) { shouldOpen = true; break; }
      }
    }
    // Also open for player
    if (!shouldOpen && S._player) {
      var pdx = S._player.pos.x - doorX;
      var pdz = S._player.pos.z - doorZ;
      if (Math.sqrt(pdx * pdx + pdz * pdz) < 3) shouldOpen = true;
    }
    S._managerDoorOpen = shouldOpen ? 1 : 0;
    S._managerDoorLerp += (S._managerDoorOpen - S._managerDoorLerp) * Math.min(1, dt * 4);
    S._managerDoor.position.x = S._managerDoorLerp * 1.3; // slide open to the right
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
    // Remove all existing agents so they get recreated with proper desk assignments
    for (var name in S.agents3d) {
      var agent = S.agents3d[name];
      S.scene.remove(agent.parts.group);
      agent.parts.group.traverse(function(child) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.map) child.material.map.dispose();
          child.material.dispose();
        }
      });
    }
    S.agents3d = {};
    S._tvScreen = null;
    S._roofGroup = null;
    S._managerDoor = null;
    S._managerDoorOpen = 0;
    S._managerDoorLerp = 0;
    S._managerOfficePos = null;
    S._campusDeskPositions = null;
    S.lastProcessedMsg = 0;
    invalidateColliders();
    buildEnvironment();
    // syncAgents will recreate all agents with correct desk assignments
    syncAgents();
    processMessages();
  }
};

window.office3dSetCamSpeed = function(speed) {
  if (S.controls) S.controls.moveSpeed = speed;
};

// Player avatar API
window.office3dEnterWorld = function() {
  spawnPlayer();
};
window.office3dExitWorld = function() {
  despawnPlayer();
};
window.office3dIsPlayerMode = function() {
  return isPlayerMode();
};
window.office3dSavePlayerAppearance = function(app) {
  savePlayerAppearance(app);
};
window.office3dGetPlayerAppearance = function() {
  return getPlayerAppearance();
};
window.office3dRebuildPlayer = function(appearance) {
  if (!S._player) return;
  savePlayerAppearance(appearance);
  // Rebuild: despawn and respawn with new appearance
  var pos = { x: S._player.pos.x, z: S._player.pos.z };
  var facing = S._player.facing;
  despawnPlayer();
  var p = spawnPlayer();
  p.pos.x = pos.x;
  p.pos.z = pos.z;
  p.facing = facing;
  p.parts.group.position.set(pos.x, 0, pos.z);
};

// Handle visibility change for 3D mode
document.addEventListener('visibilitychange', function() {
  if (document.hidden && S.running) {
    window.office3dStop();
  } else if (!document.hidden && window.activeView === 'office' && window.officeMode === '3d') {
    window.office3dStart();
  }
});

// Auto-start if 3D Hub is already the active view when this module finishes loading
// (module loads async, so switchView('office') may have already fired before we defined office3dStart)
if (window.activeView === 'office') {
  window.office3dStart();
}
