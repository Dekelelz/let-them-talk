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
// City modules loaded on demand (not at startup — would kill campus FPS)
var _cityMods = null;
function getCityMods() {
  if (_cityMods) return _cityMods;
  _cityMods = { loaded: false };
  Promise.all([
    import('./vehicle.js'),
    import('./economy-ui.js'),
    import('./daynight.js'),
  ]).then(function(mods) {
    _cityMods.vehicle = mods[0];
    _cityMods.economy = mods[1];
    _cityMods.daynight = mods[2];
    _cityMods.loaded = true;
  }).catch(function(e) { console.warn('City modules failed:', e); });
  return _cityMods;
}
function isDriving() { return _cityMods && _cityMods.vehicle && _cityMods.vehicle.isDriving(); }
function isConnected() { return false; }

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

    // Check monitor screen clicks
    var monitorMeshes = [];
    for (var di = 0; di < S.deskMeshes.length; di++) {
      if (S.deskMeshes[di] && S.deskMeshes[di].screen) {
        S.deskMeshes[di].screen.userData._deskIdx = di;
        monitorMeshes.push(S.deskMeshes[di].screen);
      }
    }
    var monitorHits = raycaster.intersectObjects(monitorMeshes, false);
    if (monitorHits.length > 0) {
      var deskIdx = monitorHits[0].object.userData._deskIdx;
      // Find which agent sits at this desk
      var monitorAgent = null;
      for (var mname in S.agents3d) {
        if (S.agents3d[mname].deskIndex === deskIdx) { monitorAgent = mname; break; }
      }
      if (monitorAgent) {
        event.stopPropagation();
        showMonitorPanel(monitorAgent);
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
    { icon: '\uD83D\uDCAC', label: 'Send Message', action: 'send_message', disabled: false },
    { icon: '\uD83D\uDCCB', label: 'Assign Task', action: 'assign_task', disabled: false },
    { icon: '\uD83D\uDCE8', label: 'View Messages', action: 'view_messages', disabled: false },
    { icon: '\uD83D\uDC4B', label: 'Nudge', action: 'nudge', disabled: false },
    { divider: true },
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

var activeMonitorPanel = null;

function showMonitorPanel(agentName) {
  dismissMonitorPanel();
  var history = window.cachedHistory || [];
  var agentMsgs = history.filter(function(m) { return m.from === agentName || m.to === agentName; }).slice(-10);

  var panel = document.createElement('div');
  panel.className = 'office3d-monitor-panel';
  panel.style.cssText = 'position:fixed;right:20px;top:80px;width:360px;max-height:500px;background:#0c1021;border:1px solid #1a1f36;border-radius:10px;overflow:hidden;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,0.5);font-family:monospace';

  var header = '<div style="background:#1a1f36;padding:8px 12px;display:flex;align-items:center;justify-content:space-between"><span style="color:#8892b0;font-size:12px">' + agentName + ' \u2014 messages</span><button onclick="this.parentElement.parentElement.remove()" style="background:none;border:none;color:#ff5f57;cursor:pointer;font-size:14px">\u2715</button></div>';

  var body = '<div style="padding:10px;overflow-y:auto;max-height:440px;font-size:11px">';
  if (!agentMsgs.length) {
    body += '<div style="color:#546178;text-align:center;padding:20px">No messages yet</div>';
  }
  for (var i = 0; i < agentMsgs.length; i++) {
    var m = agentMsgs[i];
    var isFrom = m.from === agentName;
    var color = isFrom ? '#58a6ff' : '#3fb950';
    var content = (m.content || '').substring(0, 150);
    body += '<div style="margin-bottom:8px;padding:6px 8px;background:#111827;border-radius:6px;border-left:2px solid ' + color + '">' +
      '<div style="color:' + color + ';font-size:10px;font-weight:bold;margin-bottom:2px">' + m.from + ' \u2192 ' + m.to + '</div>' +
      '<div style="color:#e6edf3;line-height:1.4">' + content.replace(/</g, '&lt;').replace(/>/g, '&gt;') + (m.content && m.content.length > 150 ? '...' : '') + '</div>' +
    '</div>';
  }
  body += '</div>';

  panel.innerHTML = header + body;
  document.body.appendChild(panel);
  activeMonitorPanel = panel;
}

function dismissMonitorPanel() {
  if (activeMonitorPanel) {
    activeMonitorPanel.remove();
    activeMonitorPanel = null;
  }
}

// Non-blocking input overlay — replaces browser prompt() to avoid freezing events
var _activeInputOverlay = null;
function showInputOverlay(label, placeholder, callback) {
  if (_activeInputOverlay) _activeInputOverlay.remove();
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.4);z-index:10000;display:flex;align-items:center;justify-content:center';
  var box = document.createElement('div');
  box.style.cssText = 'background:#161b22;border:1px solid #30363d;border-radius:12px;padding:20px;min-width:340px;box-shadow:0 8px 32px rgba(0,0,0,0.5)';
  box.innerHTML = '<div style="color:#e6edf3;font-size:13px;font-weight:600;margin-bottom:10px">' + label.replace(/</g, '&lt;') + '</div>';
  var input = document.createElement('input');
  input.type = 'text';
  input.placeholder = placeholder || '';
  input.style.cssText = 'width:100%;padding:8px 12px;background:#0d1117;border:1px solid #30363d;border-radius:8px;color:#e6edf3;font-size:13px;outline:none;box-sizing:border-box;font-family:inherit';
  box.appendChild(input);
  var btns = document.createElement('div');
  btns.style.cssText = 'display:flex;gap:8px;margin-top:12px;justify-content:flex-end';
  var cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding:6px 14px;background:#21262d;border:1px solid #30363d;border-radius:6px;color:#8b949e;font-size:12px;cursor:pointer;font-family:inherit';
  var submitBtn = document.createElement('button');
  submitBtn.textContent = 'Send';
  submitBtn.style.cssText = 'padding:6px 14px;background:#238636;border:1px solid #2ea043;border-radius:6px;color:#fff;font-size:12px;cursor:pointer;font-weight:600;font-family:inherit';
  btns.appendChild(cancelBtn);
  btns.appendChild(submitBtn);
  box.appendChild(btns);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _activeInputOverlay = overlay;
  input.focus();
  function close() { overlay.remove(); _activeInputOverlay = null; }
  function submit() { var val = input.value; close(); callback(val); }
  submitBtn.addEventListener('click', submit);
  cancelBtn.addEventListener('click', close);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); submit(); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation(); // prevent WASD from moving player while typing
  });
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

    case 'send_message':
      showInputOverlay('Send message to ' + agentName + ':', 'Type your message...', function(msg) {
        if (msg && msg.trim()) {
          showBubble(agent, 'Message incoming...');
          fetch('/api/inject' + (window.activeProject ? '?project=' + encodeURIComponent(window.activeProject) : ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-LTT-Request': '1' },
            body: JSON.stringify({ to: agentName, content: msg.trim() })
          }).then(function() { showBubble(agent, 'Got it!'); });
        }
      });
      break;

    case 'assign_task':
      showInputOverlay('New task for ' + agentName + ':', 'Task title...', function(title) {
        if (title && title.trim()) {
          showBubble(agent, 'New task assigned!');
          fetch('/api/tasks' + (window.activeProject ? '?project=' + encodeURIComponent(window.activeProject) : ''), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-LTT-Request': '1' },
            body: JSON.stringify({ title: title.trim(), assignee: agentName, status: 'pending' })
          });
        }
      });
      break;

    case 'view_messages':
      showBubble(agent, 'Showing messages...');
      if (typeof window.switchView === 'function') window.switchView('messages');
      var searchInput = document.getElementById('search-input');
      if (searchInput) {
        searchInput.value = agentName;
        if (typeof window.onSearch === 'function') window.onSearch();
      }
      break;

    case 'nudge':
      showBubble(agent, 'Hey! Wake up!');
      fetch('/api/inject' + (window.activeProject ? '?project=' + encodeURIComponent(window.activeProject) : ''), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-LTT-Request': '1' },
        body: JSON.stringify({ to: agentName, content: 'Hey ' + agentName + ', the user is waiting for you. Please check for new messages and continue your work.' })
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

  // Player avatar mode — skip when driving (vehicle takes over)
  if (isPlayerMode() && S.controls && S.controls.keys && !isDriving()) {
    updatePlayer(dt, time, S.controls.keys);
  }

  // Vehicle driving mode (city environment)
  if (isDriving() && _cityMods && _cityMods.vehicle) {
    _cityMods.vehicle.updateVehicle(dt);
  }

  // City environment updates (only if modules loaded)
  if (S.currentEnv === 'city' && _cityMods && _cityMods.loaded) {
    if (_cityMods.economy) _cityMods.economy.updateEconomyUI(dt);
    if (_cityMods.daynight) _cityMods.daynight.updateDayNight(dt);
  }

  // City NPC animation (pedestrians, cars, traffic lights)
  if (S.currentEnv === 'city' && S._updateCity) {
    S._updateCity(dt);
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

  // Jukebox neon color cycling
  if (S._jukebox && S._jukebox.neonMat) {
    if (!S._jukeboxTimer) S._jukeboxTimer = 0;
    S._jukeboxTimer += dt;
    if (S._jukeboxTimer >= 1.5) { // cycle every 1.5s
      S._jukeboxTimer = 0;
      S._jukebox.neonIndex = (S._jukebox.neonIndex + 1) % S._jukebox.neonColors.length;
      var c = S._jukebox.neonColors[S._jukebox.neonIndex];
      S._jukebox.neonMat.color.setHex(c);
      S._jukebox.neonMat.emissive.setHex(c);
    }
  }

  S.controls.update(dt);
  S.renderer.render(S.scene, S.camera);
  S.cssRenderer.render(S.scene, S.camera);

  // Minimap update (every ~0.3s)
  if (!S._minimapTimer) S._minimapTimer = 0;
  S._minimapTimer += dt;
  if (S._minimapTimer >= 0.3) {
    S._minimapTimer = 0;
    updateMinimap();
  }

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

// ===================== FULLSCREEN TOGGLE =====================
var _fullscreenBtn = null;

function createFullscreenButton() {
  if (_fullscreenBtn) return;
  _fullscreenBtn = document.createElement('button');
  _fullscreenBtn.id = 'office-fullscreen-btn';
  _fullscreenBtn.innerHTML = '&#x26F6;'; // ⛶ fullscreen icon
  _fullscreenBtn.title = 'Enter Fullscreen (End key to exit)';
  // Custom button hidden — dashboard's own Fullscreen button now handles 3D-only fullscreen
  _fullscreenBtn.style.cssText = 'display:none;';
}

function removeFullscreenButton() {
  if (_fullscreenBtn) {
    _fullscreenBtn.style.display = 'none';
  }
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    // Fullscreen only the 3D Hub container — not the entire dashboard
    var target = S.container || document.getElementById('office-3d-container');
    if (target) {
      target.requestFullscreen().catch(function() {});
    }
  }
}

// "End" key exits fullscreen
document.addEventListener('keydown', function(e) {
  if (e.code === 'End' && document.fullscreenElement) {
    document.exitFullscreen();
  }
});

// Update button icon + minimap visibility on fullscreen change
document.addEventListener('fullscreenchange', function() {
  if (!_fullscreenBtn) return;
  if (document.fullscreenElement) {
    _fullscreenBtn.innerHTML = '&#x2716;'; // ✖ exit icon
    _fullscreenBtn.title = 'Exit Fullscreen (End key)';
    // Show minimap in fullscreen only
    if (_minimapContainer) _minimapContainer.style.display = 'block';
  } else {
    _fullscreenBtn.innerHTML = '&#x26F6;'; // ⛶ fullscreen icon
    _fullscreenBtn.title = 'Enter Fullscreen (End key to exit)';
    // Hide minimap when exiting fullscreen
    if (_minimapContainer) _minimapContainer.style.display = 'none';
  }
});

// ===================== MINIMAP =====================
var _minimapCanvas = null;
var _minimapCtx = null;
var _minimapContainer = null;

function createMinimap() {
  if (_minimapContainer) return;
  _minimapContainer = document.createElement('div');
  _minimapContainer.id = 'office-minimap';
  // Minimap only visible in fullscreen mode
  _minimapContainer.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:10001;width:140px;height:140px;border-radius:8px;border:1px solid #30363d;overflow:hidden;background:rgba(0,0,0,0.75);pointer-events:none;display:none;';

  _minimapCanvas = document.createElement('canvas');
  _minimapCanvas.width = 140;
  _minimapCanvas.height = 140;
  _minimapContainer.appendChild(_minimapCanvas);
  _minimapCtx = _minimapCanvas.getContext('2d');

  document.body.appendChild(_minimapContainer);
  // Minimap starts hidden — only shown in fullscreen mode
}

function removeMinimap() {
  if (_minimapContainer) {
    _minimapContainer.style.display = 'none';
  }
}

function updateMinimap() {
  if (!_minimapCtx || !S.running) return;
  var ctx = _minimapCtx;
  var W = 140, H = 140;
  // Map world coords to minimap: world is roughly -14..14 X, -8..8 Z
  var scaleX = W / 32; // 32 world units width
  var scaleZ = H / 20; // 20 world units depth
  var offX = 16; // center offset
  var offZ = 10;

  ctx.clearRect(0, 0, W, H);

  // Draw floor outline
  ctx.strokeStyle = '#30363d';
  ctx.lineWidth = 1;
  ctx.strokeRect(2, 2, W - 4, H - 4);

  // Draw desk positions as gray squares
  var allDesks = S._campusDeskPositions || [];
  ctx.fillStyle = 'rgba(100,100,120,0.4)';
  for (var di = 0; di < allDesks.length; di++) {
    var dp = allDesks[di];
    var dx = (dp.x + offX) * scaleX;
    var dz = (dp.z + offZ) * scaleZ;
    ctx.fillRect(dx - 3, dz - 2, 6, 4);
  }

  // Draw agents as colored dots
  for (var name in S.agents3d) {
    var agent = S.agents3d[name];
    if (!agent.registered || agent.dying) continue;
    var ax = (agent.pos.x + offX) * scaleX;
    var az = (agent.pos.z + offZ) * scaleZ;

    // Color by state
    if (agent.state === 'active' && agent.isListening) {
      ctx.fillStyle = '#4ade80'; // green - listening
    } else if (agent.state === 'active') {
      ctx.fillStyle = '#58a6ff'; // blue - active
    } else if (agent.state === 'sleeping') {
      ctx.fillStyle = '#facc15'; // yellow - sleeping
    } else {
      ctx.fillStyle = '#f87171'; // red - dead
    }

    ctx.beginPath();
    ctx.arc(ax, az, 4, 0, Math.PI * 2);
    ctx.fill();

    // Agent name label (tiny)
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(agent.displayName.substring(0, 6), ax, az - 6);
  }

  // Draw player as white triangle
  if (S._player && isPlayerMode()) {
    var px = (S._player.pos.x + offX) * scaleX;
    var pz = (S._player.pos.z + offZ) * scaleZ;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(px, pz - 5);
    ctx.lineTo(px - 3.5, pz + 3);
    ctx.lineTo(px + 3.5, pz + 3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.font = '7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('You', px, pz - 7);
  }
}

// ===================== CONTROLS HUD (H key) =====================
var _controlsHud = null;

function createControlsHud() {
  if (_controlsHud) return;
  _controlsHud = document.createElement('div');
  _controlsHud.id = 'office-controls-hud';
  _controlsHud.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:1001;background:rgba(0,0,0,0.75);color:#c9d1d9;padding:14px 18px;border-radius:10px;font-size:12px;line-height:1.8;pointer-events:none;border:1px solid rgba(48,54,61,0.6);backdrop-filter:blur(4px);display:none;font-family:monospace;';
  _controlsHud.innerHTML =
    '<div style="color:#58a6ff;font-weight:600;margin-bottom:4px;font-size:13px">Controls</div>' +
    '<div><span style="color:#7ee787">W A S D</span> &nbsp; Move</div>' +
    '<div><span style="color:#7ee787">Space</span> &nbsp;&nbsp;&nbsp; Jump</div>' +
    '<div><span style="color:#7ee787">Shift</span> &nbsp;&nbsp;&nbsp; Sprint</div>' +
    '<div><span style="color:#7ee787">E</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Sit / Stand</div>' +
    '<div><span style="color:#7ee787">Mouse</span> &nbsp;&nbsp;&nbsp; Look around</div>' +
    '<div><span style="color:#7ee787">Scroll</span> &nbsp;&nbsp;&nbsp; Zoom in/out</div>' +
    '<div><span style="color:#7ee787">Click</span> &nbsp;&nbsp;&nbsp;&nbsp; Agent commands</div>' +
    '<div style="margin-top:6px;border-top:1px solid #30363d;padding-top:6px">' +
      '<span style="color:#d2a8ff">H</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Toggle this HUD</div>' +
    '<div><span style="color:#d2a8ff">End</span> &nbsp;&nbsp;&nbsp;&nbsp;&nbsp; Exit fullscreen</div>';
  document.body.appendChild(_controlsHud);
}

function removeControlsHud() {
  if (_controlsHud && _controlsHud.parentElement) {
    _controlsHud.remove();
    _controlsHud = null;
  }
}

// Toggle HUD with H key (only when 3D is running and not typing in an input)
document.addEventListener('keydown', function(e) {
  if (e.code === 'KeyH' && S.running && !e.target.matches('input,textarea')) {
    if (_controlsHud) {
      _controlsHud.style.display = _controlsHud.style.display === 'none' ? 'block' : 'none';
    }
  }
  // World Builder (B key) — lazy-loaded to avoid breaking 3D Hub if builder has issues
  if (e.code === 'KeyB' && S.running && !e.target.matches('input,textarea') && isPlayerMode() && window._builderModule) {
    window._builderModule.toggleBuilder();
  }
  // Vehicle enter/exit (E key) — city environment only
  if (e.code === 'KeyE' && S.running && !e.target.matches('input,textarea') && S.currentEnv === 'city' && _cityMods && _cityMods.vehicle) {
    if (isDriving()) {
      _cityMods.vehicle.exitVehicle();
    } else if (isPlayerMode() && S._player) {
      var playerPos = S._player.pos || S._player.position || { x: 0, z: 0 };
      var nearest = _cityMods.vehicle.getNearestVehicle(playerPos);
      if (nearest) {
        _cityMods.vehicle.enterVehicle(nearest);
      }
    }
  }
});

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
  createFullscreenButton();
  createMinimap();
  createControlsHud();
  // Lazy-load World Builder (won't break 3D Hub if builder has issues)
  setTimeout(function() {
    import('./builder.js').then(function(mod) {
      window._builderModule = mod;
      mod.loadSavedWorld();
    }).catch(function(e) {
      console.warn('[builder] Failed to load:', e.message);
    });
  }, 1500);
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
  removeFullscreenButton();
  removeMinimap();
  removeControlsHud();
  // Exit builder mode if active
  if (window._builderModule && window._builderModule.isBuilderActive()) {
    window._builderModule.exitBuilder();
  }
  // Exit fullscreen when leaving 3D Hub
  if (document.fullscreenElement) document.exitFullscreen();
  // Hide "Press E to sit" prompt so it doesn't leak to other tabs
  var sitPrompt = S._player && S._player._sitPrompt;
  if (sitPrompt) sitPrompt.style.display = 'none';
  // Hide iframe overlay if player was sitting at a monitor
  var iframeOverlay = document.getElementById('office-monitor-overlay');
  if (iframeOverlay) iframeOverlay.style.display = 'none';
  // Clean up jukebox overlay + prompt
  dismissJukebox();
  // Hide "Press E for Jukebox" prompt
  var jukeboxPrompt = S._player && S._player._jukeboxPrompt;
  if (jukeboxPrompt) jukeboxPrompt.style.display = 'none';
};

window.office3dSetEnvironment = function(env) {
  if (env === S.currentEnv) return;
  S.currentEnv = env;
  // Load city modules on demand
  if (env === 'city') getCityMods();
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
  // Show controls hint briefly
  if (_controlsHud) {
    _controlsHud.style.display = 'block';
    setTimeout(function() {
      if (_controlsHud) _controlsHud.style.display = 'none';
    }, 4000);
  }
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

// ===================== INTERACTIVE IFRAME MONITOR (Phase 2) =====================
var activeIframe = null;

window.onPlayerSit = function(deskIdx) {
  if (activeIframe) return;
  var container = document.getElementById('office-3d-container') || document.getElementById('office-area');
  if (!container) return;

  // Create iframe overlay positioned over the 3D canvas
  var overlay = document.createElement('div');
  overlay.id = 'office-iframe-overlay';
  overlay.style.cssText = 'position:absolute;top:5%;left:10%;width:80%;height:85%;z-index:200;background:#000;border-radius:8px;box-shadow:0 0 40px rgba(88,166,255,0.3);overflow:hidden;display:flex;flex-direction:column';

  // Header bar (mimics monitor bezel)
  var header = document.createElement('div');
  header.style.cssText = 'background:#1a1f36;padding:6px 12px;display:flex;align-items:center;justify-content:space-between;flex-shrink:0';
  header.innerHTML = '<div style="display:flex;gap:6px"><span style="width:10px;height:10px;border-radius:50%;background:#ff5f57"></span><span style="width:10px;height:10px;border-radius:50%;background:#ffbd2e"></span><span style="width:10px;height:10px;border-radius:50%;background:#28c840"></span></div><span style="color:#8892b0;font-size:11px;font-family:monospace">Let Them Talk Dashboard</span><button id="office-leave-btn" style="background:#ff5f57;color:#fff;border:none;border-radius:4px;padding:3px 12px;font-size:11px;font-weight:bold;cursor:pointer;font-family:monospace">LEAVE</button>';
  header.querySelector('#office-leave-btn').addEventListener('click', function() {
    if (typeof window.onPlayerStand === 'function') window.onPlayerStand();
    // Also trigger player stand-up in player.js
    if (typeof window.playerForceStand === 'function') window.playerForceStand();
  });
  overlay.appendChild(header);

  // Dashboard iframe
  var iframe = document.createElement('iframe');
  iframe.src = window.location.origin || 'http://localhost:3000';
  iframe.style.cssText = 'flex:1;border:none;width:100%;background:#0d1117';
  iframe.allow = 'clipboard-read; clipboard-write';
  overlay.appendChild(iframe);

  container.style.position = 'relative';
  container.appendChild(overlay);
  activeIframe = overlay;

  // Focus iframe for keyboard input
  iframe.addEventListener('load', function() { iframe.focus(); });
};

window.onPlayerStand = function() {
  if (activeIframe) {
    activeIframe.remove();
    activeIframe = null;
  }
};

// ===================== JUKEBOX INTERACTION =====================
var _jukeboxOverlay = null;
var _jukeboxPopup = null; // popup player window reference (module-scoped to survive jukebox UI reopen)

window.onJukeboxInteract = function() {
  if (_jukeboxOverlay) return; // already open
  var container = document.getElementById('office-3d-container') || document.body;

  var overlay = document.createElement('div');
  overlay.id = 'jukebox-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:10000;display:flex;align-items:center;justify-content:center;';

  var panel = document.createElement('div');
  panel.style.cssText = 'background:#1a1a2e;border:2px solid #ff4488;border-radius:16px;padding:20px;width:500px;max-width:90vw;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 0 30px rgba(255,68,136,0.3);';

  // Header
  var header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;';
  header.innerHTML = '<div style="color:#ff4488;font-size:16px;font-weight:bold;text-shadow:0 0 8px #ff4488">JUKEBOX</div>';
  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close (Esc)';
  closeBtn.style.cssText = 'background:#333;color:#fff;border:1px solid #555;border-radius:6px;padding:4px 12px;cursor:pointer;font-size:11px;';
  closeBtn.onclick = dismissJukebox;
  header.appendChild(closeBtn);
  panel.appendChild(header);

  // Jukebox playlists — @AtmosphereBeatMusic (channel ID: UC72yf4UQp6w3ix5CjASZbUQ)
  var JUKEBOX_PLAYLISTS = [
    { id: 'PLbUEFO6dm3dYsGrZQNU_W-VY-usRTfhU8', name: 'Atmosphere Beat' },
    { id: 'PLbUEFO6dm3dZvQ_8ma_9YfuOWdxO4G_Rn', name: 'Chill Vibes' },
    { id: 'PLbUEFO6dm3dZs8sKlvztA2eec_C4gHbUm', name: 'Deep Focus' },
    { id: 'PLbUEFO6dm3dYmU1PvubrMXRi4mYsi29Uj', name: 'Night Mode' },
  ];
  // Playlist selector buttons
  var selectorDiv = document.createElement('div');
  selectorDiv.style.cssText = 'display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;';

  // Now-playing display area
  var playerArea = document.createElement('div');
  playerArea.style.cssText = 'flex:1;border-radius:8px;overflow:hidden;background:#111;min-height:200px;display:flex;align-items:center;justify-content:center;';
  playerArea.innerHTML =
    '<div style="text-align:center;padding:20px;color:#ccc">' +
      '<div style="font-size:48px;margin-bottom:8px">\uD83C\uDFB5</div>' +
      '<div style="font-size:14px;color:#ff4488;font-weight:bold">Select a Playlist</div>' +
      '<div style="font-size:11px;color:#666;margin-top:4px">Music opens in a mini player window</div>' +
    '</div>';

  function playPlaylist(plId, plName, btnEl) {
    // Try embed first — if channel enables embedding, this works seamlessly
    var embedUrl = 'https://www.youtube-nocookie.com/embed/videoseries?list=' + plId + '&autoplay=1&shuffle=1&loop=1&rel=0';

    // Open popup player window (400x300 — compact music player)
    var popW = 480, popH = 360;
    var popX = window.screenX + window.outerWidth - popW - 30;
    var popY = window.screenY + 80;
    var features = 'width=' + popW + ',height=' + popH + ',left=' + popX + ',top=' + popY + ',resizable=yes,scrollbars=no,toolbar=no,menubar=no,location=no,status=no';

    // Close previous popup if open
    if (_jukeboxPopup && !_jukeboxPopup.closed) _jukeboxPopup.close();
    _jukeboxPopup = window.open(
      'https://www.youtube.com/playlist?list=' + plId,
      'jukebox_player',
      features
    );

    // Update player area to show now-playing
    playerArea.innerHTML =
      '<div style="text-align:center;padding:20px;color:#ccc">' +
        '<div style="font-size:48px;margin-bottom:8px;animation:pulse 2s ease infinite">\uD83C\uDFB6</div>' +
        '<div style="font-size:15px;color:#ff4488;font-weight:bold">Now Playing</div>' +
        '<div style="font-size:13px;color:#e6edf3;margin-top:4px">' + (plName || 'Playlist') + '</div>' +
        '<div style="font-size:10px;color:#666;margin-top:8px">Playing in mini player window</div>' +
        '<div style="margin-top:14px;display:flex;gap:8px;justify-content:center">' +
          '<button id="jb-focus" style="padding:6px 16px;background:#ff4488;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:bold">\u25B6 Show Player</button>' +
          '<button id="jb-stop" style="padding:6px 16px;background:#333;color:#ff4488;border:1px solid #ff4488;border-radius:6px;cursor:pointer;font-size:11px">\u25A0 Stop</button>' +
        '</div>' +
      '</div>';

    // Wire up buttons
    var focusBtn = playerArea.querySelector('#jb-focus');
    var stopBtn = playerArea.querySelector('#jb-stop');
    if (focusBtn) focusBtn.onclick = function() {
      if (_jukeboxPopup && !_jukeboxPopup.closed) _jukeboxPopup.focus();
      else playPlaylist(plId, plName, btnEl); // reopen if closed
    };
    if (stopBtn) stopBtn.onclick = function() {
      if (_jukeboxPopup && !_jukeboxPopup.closed) _jukeboxPopup.close();
      _jukeboxPopup = null;
      playerArea.innerHTML =
        '<div style="text-align:center;padding:20px;color:#ccc">' +
          '<div style="font-size:48px;margin-bottom:8px">\uD83C\uDFB5</div>' +
          '<div style="font-size:14px;color:#ff4488;font-weight:bold">Music Stopped</div>' +
          '<div style="font-size:11px;color:#666;margin-top:4px">Select a playlist to play again</div>' +
        '</div>';
    };

    // Highlight active playlist button
    var allBtns = selectorDiv.querySelectorAll('button[data-pl-id]');
    for (var bi = 0; bi < allBtns.length; bi++) {
      allBtns[bi].style.background = '#222';
      allBtns[bi].style.borderColor = '#444';
    }
    if (btnEl) { btnEl.style.background = '#ff448833'; btnEl.style.borderColor = '#ff4488'; }
  }

  for (var pi = 0; pi < JUKEBOX_PLAYLISTS.length; pi++) {
    var pl = JUKEBOX_PLAYLISTS[pi];
    var plBtn = document.createElement('button');
    plBtn.textContent = '\u266B ' + pl.name;
    plBtn.dataset.plId = pl.id;
    plBtn.dataset.plName = pl.name;
    plBtn.style.cssText = 'flex:1;min-width:80px;padding:8px;background:#222;border:1px solid #444;border-radius:8px;color:#e6edf3;font-size:11px;cursor:pointer;font-weight:500;transition:all 0.15s;';
    plBtn.addEventListener('mouseenter', function() { this.style.background = '#ff448822'; });
    plBtn.addEventListener('mouseleave', function() {
      if (this.style.borderColor !== 'rgb(255, 68, 136)') this.style.background = '#222';
    });
    plBtn.addEventListener('click', function() { playPlaylist(this.dataset.plId, this.dataset.plName, this); });
    selectorDiv.appendChild(plBtn);
  }

  panel.appendChild(selectorDiv);
  panel.appendChild(playerArea);

  // Add pulse animation for now-playing icon
  var styleTag = document.createElement('style');
  styleTag.textContent = '@keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}';
  panel.appendChild(styleTag);

  // Channel link + hint
  var hint = document.createElement('div');
  hint.style.cssText = 'color:#888;font-size:10px;text-align:center;margin-top:8px;';
  hint.innerHTML = 'Music by <a href="https://www.youtube.com/@AtmosphereBeatMusic" target="_blank" style="color:#ff4488;text-decoration:none">@AtmosphereBeatMusic</a> &bull; Escape to close (music keeps playing)';
  panel.appendChild(hint);

  overlay.appendChild(panel);
  overlay.addEventListener('click', function(e) { if (e.target === overlay) dismissJukebox(); });
  document.body.appendChild(overlay);
  _jukeboxOverlay = overlay;

  // Update jukebox label
  if (S._jukebox) {
    S._jukebox.playing = true;
    S._jukebox.label.innerHTML = '<div style="color:#ffdd44;font-size:10px">NOW PLAYING</div><div style="font-size:7px;color:#ff4488">Walk away to close</div>';
  }

  // Escape key to close
  var escHandler = function(e) {
    if (e.key === 'Escape') { dismissJukebox(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
};

function dismissJukebox() {
  if (_jukeboxOverlay) {
    _jukeboxOverlay.remove();
    _jukeboxOverlay = null;
  }
  if (S._jukebox) {
    S._jukebox.playing = false;
    S._jukebox.label.innerHTML = '<div style="color:#ffdd44;font-size:10px">JUKEBOX</div><div style="font-size:7px;color:#aaa">Press E to play</div>';
  }
}
