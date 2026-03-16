import { S } from './state.js';
import { DESK_POSITIONS, SPAWN_POS } from './constants.js';
import { createCharacter } from './character.js';
import { resolveAppearance } from './appearance.js';
import { buildHair } from './hair.js';
import { buildFaceSprite } from './face.js';
import { buildOutfit, removeOutfit } from './outfits.js';
import { getNavigationPath } from './navigation.js';

// Navigate agent using waypoint pathfinding (campus) or direct walk (other envs)
export function navigateTo(agent, tx, tz, callback) {
  var path = getNavigationPath(agent.pos.x, agent.pos.z, tx, tz);
  if (!path || path.length === 0) {
    walkTo(agent, tx, tz, callback);
    return;
  }
  // Queue all waypoints, put callback on the last one
  agent.walkQueue = [];
  for (var i = 1; i < path.length; i++) {
    agent.walkQueue.push({ x: path[i].x, z: path[i].z, cb: null, triggerDoor: path[i].triggerDoor });
  }
  // Attach callback to last queued point (or first walk if only 1 point)
  if (agent.walkQueue.length > 0) {
    agent.walkQueue[agent.walkQueue.length - 1].cb = callback;
  }
  // Start walking to first point
  var first = path[0];
  walkTo(agent, first.x, first.z, first.triggerDoor ? function() { triggerManagerDoor(true); } : (path.length === 1 ? callback : null));
}

function triggerManagerDoor(open) {
  if (S._managerDoor) {
    S._managerDoorOpen = open ? 1 : 0;
  }
}

export function walkTo(agent, tx, tz, callback) {
  var dx = tx - agent.pos.x;
  var dz = tz - agent.pos.z;
  var dist = Math.sqrt(dx * dx + dz * dz);
  agent.walkStart = { x: agent.pos.x, z: agent.pos.z };
  agent.target = { x: tx, z: tz, cb: callback || null };
  agent.walkProgress = 0;
  agent.walkDuration = Math.max(dist * 0.4, 0.3);
}

export function showBubble(agent, text) {
  var display = text.length > 80 ? text.substring(0, 77) + '...' : text;
  agent.parts.bubbleDiv.textContent = display;
  agent.parts.bubbleDiv.style.display = 'block';
  agent.parts.bubbleDiv.style.opacity = '1';
  agent.bubbleTimer = 4;
  agent.bubbleText = display;
}

function getDeskPositions() {
  return S._campusDeskPositions || DESK_POSITIONS;
}

function assignDesk(agentName) {
  var desks = getDeskPositions();
  var used = {};
  for (var n in S.agents3d) used[S.agents3d[n].deskIdx] = true;

  // If campus mode, check if agent has "Manager" role or name — assign last desk (manager office)
  if (S.currentEnv === 'campus' && desks.length > 0) {
    var info = (window.cachedAgents || {})[agentName] || {};
    var role = (info.role || '').toLowerCase();
    var dname = (info.display_name || agentName).toLowerCase();
    var regName = agentName.toLowerCase();
    var isManager = role === 'manager' || role === 'project lead' || role === 'ceo' || role === 'director' ||
                    role.indexOf('project manager') >= 0 || role.indexOf('team lead') >= 0 ||
                    dname === 'manager' || regName === 'manager';
    var managerIdx = desks.length - 1; // last desk is manager office
    if (isManager && !used[managerIdx]) {
      return managerIdx;
    }
    // Non-manager agents skip the manager desk
    for (var i = 0; i < desks.length - 1; i++) {
      if (!used[i]) return i;
    }
    return Object.keys(S.agents3d).length % (desks.length - 1);
  }

  for (var j = 0; j < desks.length; j++) {
    if (!used[j]) return j;
  }
  return Object.keys(S.agents3d).length % desks.length;
}

function fetchTasks() {
  var base = window.currentProjectPath ? '/api/tasks?project=' + encodeURIComponent(window.currentProjectPath) : '/api/tasks';
  fetch(base).then(function(r) { return r.json(); }).then(function(data) {
    S.cachedTasks = Array.isArray(data) ? data : (data.tasks || []);
  }).catch(function() {});
}

function getAgentTask(agentName) {
  for (var i = 0; i < S.cachedTasks.length; i++) {
    var t = S.cachedTasks[i];
    if (t.assignee === agentName || t.assigned_to === agentName) return t;
  }
  return null;
}

function updateConversationVelocity() {
  var history = window.cachedHistory;
  if (!history || history.length === 0) { S.conversationVelocity = 0; return; }
  var now = Date.now();
  var cutoff30s = now - 30000;
  var cutoff2m = now - 120000;
  var recent30 = 0, recent2m = 0;
  for (var i = history.length - 1; i >= 0; i--) {
    var ts = new Date(history[i].timestamp).getTime();
    if (ts > cutoff30s) recent30++;
    if (ts > cutoff2m) recent2m++;
    if (ts <= cutoff2m) break;
  }
  S.conversationVelocity = recent30 >= 3 ? 1 : (recent2m === 0 ? -1 : 0);
}

function updateLabel(agent) {
  var nameEl = agent.parts.labelDiv.querySelector('.office3d-label-name');
  var dotEl = agent.parts.labelDiv.querySelector('.office3d-label-dot');
  if (nameEl) nameEl.textContent = agent.displayName;
  if (dotEl) {
    var colors = { active: '#4ade80', sleeping: '#facc15', dead: '#f87171' };
    dotEl.style.background = colors[agent.state] || '#f87171';
  }
}

function updateDeskScreen(deskIdx, status, isListening) {
  var desk = S.deskMeshes[deskIdx];
  if (!desk) return;
  if (status === 'active' && isListening) {
    // Listening — green screen
    desk.screenMat.emissive.setHex(0x22c55e);
    desk.screenMat.emissiveIntensity = 0.5;
    desk.screenMat.color.setHex(0x22c55e);
  } else if (status === 'active' && !isListening) {
    // Active but NOT listening — red screen
    desk.screenMat.emissive.setHex(0xef4444);
    desk.screenMat.emissiveIntensity = 0.6;
    desk.screenMat.color.setHex(0xef4444);
  } else if (status === 'sleeping') {
    desk.screenMat.emissive.setHex(0x1a2744);
    desk.screenMat.emissiveIntensity = 0.15;
    desk.screenMat.color.setHex(0x1a2744);
  } else {
    desk.screenMat.emissive.setHex(0x333333);
    desk.screenMat.emissiveIntensity = 0.1;
    desk.screenMat.color.setHex(0x333333);
  }
}

function flashDeskScreen(deskIdx) {
  var desk = S.deskMeshes[deskIdx];
  if (!desk) return;
  // Flash white briefly — the next syncAgents call (every 2s) will set the correct persistent color via updateDeskScreen
  desk.screenMat.emissive.setHex(0xffffff);
  desk.screenMat.emissiveIntensity = 1.5;
  setTimeout(function() {
    // Force immediate red until next sync corrects it
    desk.screenMat.emissive.setHex(0xef4444);
    desk.screenMat.emissiveIntensity = 0.6;
    desk.screenMat.color.setHex(0xef4444);
  }, 300);
}

function rebuildCharacterAppearance(agent) {
  var a = resolveAppearance(agent.displayName, agent.appearance);
  agent.parts.bodyMat.color.setHex(a.shirt_hex);
  agent.parts.armMat.color.setHex(a.shirt_hex);
  agent.parts.legMat.color.setHex(a.pants_hex);
  agent.parts.headMat.color.setHex(a.head_hex);
  agent.parts.handMat.color.setHex(a.head_hex);
  agent.parts.shoeMat.color.setHex(a.shoe_hex);

  // Rebuild hair
  var oldHair = agent.parts.hairGroup;
  agent.parts.group.remove(oldHair);
  oldHair.traverse(function(c) { if (c.geometry) c.geometry.dispose(); if (c.material) c.material.dispose(); });
  var newHair = buildHair(a.hair_style, a.hair_hex);
  newHair.position.y = 1.05;
  agent.parts.group.add(newHair);
  agent.parts.hairGroup = newHair;

  // Rebuild face
  var oldFace = agent.parts.faceSprite;
  agent.parts.head.remove(oldFace);
  if (oldFace.material.map) oldFace.material.map.dispose();
  oldFace.material.dispose();
  var newFace = buildFaceSprite(a.eye_style, a.mouth_style, agent.state === 'sleeping');
  newFace.position.set(0, 0, 0.251);
  agent.parts.head.add(newFace);
  agent.parts.faceSprite = newFace;

  // Rebuild outfit
  removeOutfit(agent.parts.group);
  if (a.outfit) {
    agent.parts.outfitGroup = buildOutfit(a.outfit, { shirt_color: a.shirt_color, pants_color: a.pants_color }, agent.parts.group);
  } else {
    agent.parts.outfitGroup = null;
  }
}

export function syncAgents() {
  if (!window.cachedAgents) return;

  fetchTasks();
  updateConversationVelocity();

  for (var name in window.cachedAgents) {
    var info = window.cachedAgents[name];
    if (!S.agents3d[name]) {
      var deskIdx = assignDesk(name);
      var allDesks = getDeskPositions();
      var deskPos = allDesks[deskIdx] || allDesks[0];
      var parts = createCharacter(info.display_name || name, info.appearance || {});
      var agent = {
        name: name,
        displayName: info.display_name || name,
        appearance: info.appearance || {},
        parts: parts,
        deskIdx: deskIdx,
        deskPos: { x: deskPos.x, z: deskPos.z },
        pos: { x: SPAWN_POS.x, z: SPAWN_POS.z },
        target: null,
        walkQueue: [],
        walkProgress: 0,
        walkDuration: 0,
        walkStart: null,
        state: info.status || 'active',
        prevState: null,
        registered: false,
        bubbleTimer: 0,
        bubbleText: '',
        isSitting: false,
        sittingLerp: 0,
        facingTarget: 0,
        zzzActive: false,
        sleepTransition: 0,
        spawnOpacity: 1,
        deathOpacity: 1,
        dying: false,
        currentTask: null,
        taskCelebration: 0,
        isListening: !!(info.is_listening),
        handRaiseTimer: 0,
        waveTimer: 0,
        thinkTimer: 0,
        pointTimer: 0,
        celebrateTimer: 0,
        stretchTimer: 0,
        idleGestureTimer: 5 + Math.random() * 10,
        listenLostTimer: 0,
        lastMessageTime: 0,
        monitorTimer: 0,
        location: 'desk', // 'desk', 'dressing_room', 'rest', 'walking'
      };

      parts.group.position.set(SPAWN_POS.x, 0, SPAWN_POS.z);
      S.scene.add(parts.group);
      updateLabel(agent);
      S.agents3d[name] = agent;

      // Registration animation
      showBubble(agent, 'Checking in...');
      (function(a) {
        setTimeout(function() {
          navigateTo(a, a.deskPos.x, a.deskPos.z + 0.7, function() {
            a.registered = true;
            showBubble(a, 'Ready to work!');
            updateDeskScreen(a.deskIdx, a.state, a.isListening);
          });
        }, 800);
      })(agent);
    } else {
      var existing = S.agents3d[name];
      var newState = info.status || 'active';
      var oldState = existing.state;

      // Don't override local state changes (rest area sleeping, dressing room)
      var isLocalOverride = existing.location === 'rest' || existing.location === 'dressing_room' || existing.location === 'walking';
      if (newState !== oldState && !isLocalOverride) {
        existing.prevState = oldState;
        existing.state = newState;
        if (newState === 'dead' && !existing.dying) {
          existing.dying = true;
          existing.deathOpacity = 1;
        }
      }

      existing.displayName = info.display_name || name;
      var wasListening = existing.isListening;
      existing.isListening = !!(info.is_listening);

      // Detect listen mode change — update screen color persistently
      if (wasListening && !existing.isListening) {
        // Left listen mode — flash then stay red until next sync sets updateDeskScreen
        existing.listenLostTimer = 3;
        flashDeskScreen(existing.deskIdx);
      }
      if (!wasListening && existing.isListening) {
        // Entered listen mode — next updateDeskScreen will set green
        existing.listenLostTimer = 0;
      }

      var task = getAgentTask(name);
      if (task) {
        var prevTask = existing.currentTask;
        existing.currentTask = task;
        if (prevTask && prevTask.status !== 'done' && task.status === 'done') {
          existing.taskCelebration = 2;
          existing.celebrateTimer = 1.5;
        }
      } else {
        existing.currentTask = null;
      }

      var newApp = info.appearance || {};
      if (JSON.stringify(newApp) !== JSON.stringify(existing.appearance)) {
        existing.appearance = newApp;
        rebuildCharacterAppearance(existing);
      }

      updateLabel(existing);
      if (existing.registered) updateDeskScreen(existing.deskIdx, existing.state, existing.isListening);
    }
  }

  for (var n in S.agents3d) {
    if (!window.cachedAgents[n]) {
      var deadAgent = S.agents3d[n];
      if (!deadAgent.dying) {
        deadAgent.dying = true;
        deadAgent.deathOpacity = 1;
        deadAgent.state = 'dead';
      }
    }
  }
}

export function processMessages() {
  var history = window.cachedHistory;
  if (!history || history.length === 0) return;

  var newMsgs = history.slice(S.lastProcessedMsg);
  S.lastProcessedMsg = history.length;

  for (var i = 0; i < newMsgs.length; i++) {
    var msg = newMsgs[i];
    var from = S.agents3d[msg.from];
    if (!from || !from.registered) continue;
    var text = msg.content || msg.message || '';

    from.lastMessageTime = Date.now();
    flashDeskScreen(from.deskIdx);

    // Contextual gesture based on message type
    var isBC = !msg.to || msg.to === 'all';
    if (isBC) {
      from.waveTimer = 0.8;
    } else {
      from.pointTimer = 0.6;
    }

    if (msg.to && msg.to !== 'all' && S.agents3d[msg.to]) {
      var target = S.agents3d[msg.to];
      (function(f, t, txt) {
        setTimeout(function() {
          f.walkQueue = [];
          // Calculate a stop point ~1.8m away from the target, facing them
          var tx = t.pos.x, tz = t.pos.z;
          var fx = f.pos.x, fz = f.pos.z;
          var adx = tx - fx, adz = tz - fz;
          var dist = Math.sqrt(adx * adx + adz * adz);
          var stopDist = 1.8;
          var stopX, stopZ;
          if (dist > stopDist + 0.5) {
            // Approach from sender's direction, stop 1.8m away
            stopX = tx - (adx / dist) * stopDist;
            stopZ = tz - (adz / dist) * stopDist;
          } else {
            // Already close — just step to the side of target's desk
            stopX = tx + 1.5;
            stopZ = tz;
          }
          navigateTo(f, stopX, stopZ, function() {
            // Sender faces target
            var dx2 = t.pos.x - f.pos.x;
            var dz2 = t.pos.z - f.pos.z;
            f.facingTarget = Math.atan2(dx2, dz2);
            showBubble(f, txt);

            // Target turns toward sender (listener reaction)
            var rdx = f.pos.x - t.pos.x;
            var rdz = f.pos.z - t.pos.z;
            t.facingTarget = Math.atan2(rdx, rdz);
            t.isListening = true;
            t._listeningTo = f.name;

            setTimeout(function() {
              // Sender walks back to desk
              navigateTo(f, f.deskPos.x, f.deskPos.z + 0.7);
              // Target turns back to desk after a short delay
              setTimeout(function() {
                if (t._listeningTo === f.name) {
                  t.isListening = false;
                  t._listeningTo = null;
                  t.facingTarget = Math.PI; // face desk
                }
              }, 1500);
            }, 4200);
          });
        }, 400);
      })(from, target, text);
    } else {
      (function(f, txt) {
        setTimeout(function() {
          f.walkQueue = [];
          navigateTo(f, 0, 0, function() {
            showBubble(f, txt);
            // All nearby agents turn toward the broadcaster
            for (var an in S.agents3d) {
              var a = S.agents3d[an];
              if (a.name === f.name || !a.registered || a.state !== 'active') continue;
              var bdx = f.pos.x - a.pos.x;
              var bdz = f.pos.z - a.pos.z;
              a.facingTarget = Math.atan2(bdx, bdz);
              a.isListening = true;
              a._listeningTo = f.name;
            }
            setTimeout(function() {
              navigateTo(f, f.deskPos.x, f.deskPos.z + 0.7);
              // All listeners turn back
              setTimeout(function() {
                for (var an2 in S.agents3d) {
                  var a2 = S.agents3d[an2];
                  if (a2._listeningTo === f.name) {
                    a2.isListening = false;
                    a2._listeningTo = null;
                    a2.facingTarget = Math.PI;
                  }
                }
              }, 1500);
            }, 4200);
          });
        }, 400);
      })(from, text);
    }
  }
}
