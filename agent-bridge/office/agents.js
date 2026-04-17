import { S } from './state.js';
import { DESK_POSITIONS, SPAWN_POS, REST_AREA_POS, REST_AREA_ENTRANCE } from './constants.js';
import { createCharacter } from './character.js';
import { createRobotCharacter, updateRobotAnimation } from './robot-character.js';
import { resolveAppearance } from './appearance.js';
import { buildHair } from './hair.js';
import { buildFaceSprite, setEmotion } from './face.js';
import { buildOutfit, removeOutfit } from './outfits.js';
import { getNavigationPath } from './navigation.js';
import { GALLERY_SEATS } from './gallery.js';

// Track which gallery seats are occupied (prevents overlapping bots)
var _gallerySeatsOccupied = { image: null, video: null, texture: null };

// Map bot capability to gallery seat
// image_gen → image seat (left monitor), video_gen → video seat (center), texture_gen → texture seat (right)
// vision/chat bots → null (go to regular desk)
function _getGallerySeat(capability) {
  var seatMap = { image_gen: 'image', video_gen: 'video', texture_gen: 'texture' };
  var seatKey = seatMap[capability];
  if (!seatKey || !GALLERY_SEATS || !GALLERY_SEATS[seatKey]) return null;
  if (_gallerySeatsOccupied[seatKey]) return null; // seat taken
  return GALLERY_SEATS[seatKey];
}

function _claimGallerySeat(capability, agentName) {
  var seatMap = { image_gen: 'image', video_gen: 'video', texture_gen: 'texture' };
  var seatKey = seatMap[capability];
  if (seatKey) _gallerySeatsOccupied[seatKey] = agentName;
}

function _releaseGallerySeat(agentName) {
  for (var key in _gallerySeatsOccupied) {
    if (_gallerySeatsOccupied[key] === agentName) _gallerySeatsOccupied[key] = null;
  }
}

// Get the Z position an agent should walk to when going to their desk
function _agentDeskZ(agent) {
  return agent.isGallerySeat ? agent.deskPos.z : agent.deskPos.z + 0.7;
}

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
  var base = typeof window.scopedApiUrl === 'function'
    ? window.scopedApiUrl('/api/tasks')
    : (window.currentProjectPath ? '/api/tasks?project=' + encodeURIComponent(window.currentProjectPath) : '/api/tasks');
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

function shouldRenderAgent(info) {
  var isApiAgent = !!(info && (info.is_api_agent || (info.role && info.role === 'api-agent')));
  return !(isApiAgent && info.status !== 'active');
}

function retireAgent(agentName, agent, status) {
  if (!agent) return;
  agent.prevState = agent.state;
  agent.state = status || 'dead';
  agent.isListening = false;
  agent.target = null;
  agent.walkQueue = [];
  agent.walkProgress = 0;
  agent.walkDuration = 0;
  agent.isSitting = false;
  agent.location = 'desk';
  if (agent.deskIdx >= 0) updateDeskScreen(agent.deskIdx, agent.state, false);
  updateLabel(agent);
  agent.registered = false;
  if (!agent.dying) {
    agent.dying = true;
    agent.deathOpacity = 1;
  }
  _releaseGallerySeat(agentName);
}

function projectBotCapability(capabilities, legacyBotCapability) {
  if (Array.isArray(capabilities)) {
    if (capabilities.indexOf('video_generation') !== -1) return 'video_gen';
    if (capabilities.indexOf('texture_generation') !== -1) return 'texture_gen';
    if (capabilities.indexOf('image_generation') !== -1) return 'image_gen';
    if (capabilities.indexOf('vision') !== -1) return 'vision';
    if (capabilities.indexOf('chat') !== -1) return 'chat';
  }
  return legacyBotCapability || '';
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

  // Reset gallery seats if environment was switched
  if (window._gallerySeatsReset) {
    _gallerySeatsOccupied = { image: null, video: null, texture: null };
    window._gallerySeatsReset = false;
  }

  fetchTasks();
  updateConversationVelocity();

  for (var name in window.cachedAgents) {
    var info = window.cachedAgents[name];
    // Skip API agents that aren't actively running (user hasn't clicked Start)
    var isApiAgent = !!(info.is_api_agent || (info.role && info.role === 'api-agent'));
    if (!shouldRenderAgent(info)) {
      if (S.agents3d[name]) retireAgent(name, S.agents3d[name], info.status || 'dead');
      continue;
    }

    if (!S.agents3d[name]) {
      var providerColor = info.provider_color || '#0ea5e9';
      var botCap = projectBotCapability(info.capabilities, info.bot_capability);
      var deskIdx, deskPos;

      if (isApiAgent && _getGallerySeat(botCap)) {
        // Creative bots (image/video/texture generators) sit at gallery desk
        deskIdx = -1;
        deskPos = _getGallerySeat(botCap);
      } else if (isApiAgent && !_getGallerySeat(botCap)) {
        // Non-creative bots (vision, chat) get a regular workspace desk
        deskIdx = assignDesk(name);
        var allDesks2 = getDeskPositions();
        deskPos = allDesks2[deskIdx] || allDesks2[0];
      } else {
        deskIdx = assignDesk(name);
        var allDesks = getDeskPositions();
        deskPos = allDesks[deskIdx] || allDesks[0];
      }
      // Gallery bots (image/video/texture) get robot character, chat/vision bots get chibi
      var isGalleryBot = isApiAgent && deskIdx === -1;
      var parts = isGalleryBot
        ? createRobotCharacter(info.display_name || name, providerColor)
        : createCharacter(info.display_name || name, info.appearance || {});
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
        isApiAgent: isApiAgent,
        botCapability: botCap,
        isGallerySeat: !!(isApiAgent && deskIdx === -1),
        _processing: false,
      };

      // Claim gallery seat if applicable
      if (isApiAgent && deskIdx === -1) _claimGallerySeat(botCap, name);

      parts.group.position.set(SPAWN_POS.x, 0, SPAWN_POS.z);
      S.scene.add(parts.group);
      updateLabel(agent);
      S.agents3d[name] = agent;

      // Gallery bots walk directly to seat pos, others walk to desk + 0.7 (chair offset)
      var walkTargetZ = agent.isGallerySeat ? deskPos.z : deskPos.z + 0.7;
      showBubble(agent, 'Checking in...');
      (function(a, wz) {
        setTimeout(function() {
          navigateTo(a, a.deskPos.x, wz, function() {
            a.registered = true;
            showBubble(a, a.isApiAgent ? 'Systems online.' : 'Ready to work!');
            if (a.deskIdx >= 0) updateDeskScreen(a.deskIdx, a.state, a.isListening);
          });
        }, 800);
      })(agent, walkTargetZ);
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

      // --- Autonomous behaviors: sleeping → rest area, waking → back to desk ---
      if (newState === 'sleeping' && oldState === 'active' && existing.location === 'desk' && existing.registered && !existing.dying) {
        // Agent fell asleep — walk to rest area after a short delay
        existing.location = 'walking';
        (function(a) {
          setTimeout(function() {
            showBubble(a, 'Need a break...');
            a.isSitting = false;
            navigateTo(a, REST_AREA_ENTRANCE.x, REST_AREA_ENTRANCE.z, function() {
              navigateTo(a, REST_AREA_POS.x, REST_AREA_POS.z, function() {
                a.location = 'rest';
                a.state = 'sleeping';
                showBubble(a, 'zzz...');
              });
            });
          }, 1000 + Math.random() * 2000);
        })(existing);
      }
      if (newState === 'active' && (oldState === 'sleeping' || existing.location === 'rest') && existing.location !== 'desk' && existing.registered && !existing.dying) {
        // Agent woke up — walk back to desk
        existing.location = 'walking';
        existing.state = 'active';
        (function(a) {
          showBubble(a, 'Back to work!');
          navigateTo(a, a.deskPos.x, _agentDeskZ(a), function() {
            a.location = 'desk';
          });
        })(existing);
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
          setEmotion(existing, 'happy', 6);
        }
        // Blocked task → frustrated face
        if (task.status === 'blocked' && (!prevTask || prevTask.status !== 'blocked')) {
          setEmotion(existing, 'frustrated', 8);
        }
      } else {
        existing.currentTask = null;
      }

      // Listening agents look focused
      if (existing.isListening && !wasListening) {
        setEmotion(existing, 'focused', 10);
      }

      var newApp = info.appearance || {};
      if (JSON.stringify(newApp) !== JSON.stringify(existing.appearance)) {
        existing.appearance = newApp;
        rebuildCharacterAppearance(existing);
      }

      updateLabel(existing);
      if (existing.registered && existing.deskIdx >= 0) updateDeskScreen(existing.deskIdx, existing.state, existing.isListening);
    }
  }

  // --- Random social behavior: idle agents occasionally stretch or look around ---
  // Limit concurrent social walks to prevent traffic jams (max 2 walking at once)
  var walkingCount = 0;
  for (var wn in S.agents3d) { if (S.agents3d[wn].location === 'walking') walkingCount++; }

  for (var sn in S.agents3d) {
    var sa = S.agents3d[sn];
    if (!sa.registered || sa.state !== 'active' || sa.location !== 'desk' || sa.target) continue;
    if (!sa._socialTimer) sa._socialTimer = 30 + Math.random() * 60;
    sa._socialTimer -= 2; // syncAgents runs every ~2s
    if (sa._socialTimer <= 0) {
      sa._socialTimer = 40 + Math.random() * 80; // next social event in 40-120s
      // Pick a random behavior: stretch, look around, or visit another agent
      var roll = Math.random();
      if (roll < 0.4) {
        // Stretch at desk
        sa.stretchTimer = 2;
      } else if (roll < 0.7) {
        // Look around curiously
        sa.thinkTimer = 1.5;
      } else if (walkingCount < 2) {
        // Walk to a random nearby agent's desk to "chat" then return (max 2 concurrent)
        var others = [];
        for (var on in S.agents3d) {
          if (on !== sn && S.agents3d[on].registered && S.agents3d[on].state === 'active' && S.agents3d[on].location === 'desk') {
            others.push(S.agents3d[on]);
          }
        }
        if (others.length > 0) {
          var buddy = others[Math.floor(Math.random() * others.length)];
          (function(a, b) {
            a.location = 'walking';
            a.isSitting = false;
            showBubble(a, 'Hey ' + b.displayName + '!');
            setEmotion(a, 'playful', 6);
            var stopX = b.deskPos.x + 1.5;
            var stopZ = _agentDeskZ(b);
            navigateTo(a, stopX, stopZ, function() {
              // Face buddy
              var dx = b.pos.x - a.pos.x;
              var dz = b.pos.z - a.pos.z;
              a.facingTarget = Math.atan2(dx, dz);
              a.waveTimer = 0.8;
              // Buddy turns toward visitor
              b.facingTarget = Math.atan2(-dx, -dz);
              setTimeout(function() {
                showBubble(a, 'Back to it!');
                navigateTo(a, a.deskPos.x, _agentDeskZ(a), function() {
                  a.location = 'desk';
                });
                // Buddy turns back to desk
                setTimeout(function() { b.facingTarget = Math.PI; }, 1500);
              }, 3000 + Math.random() * 2000);
            });
          })(sa, buddy);
        }
      }
    }
  }

  for (var n in S.agents3d) {
    if (!window.cachedAgents[n]) {
      retireAgent(n, S.agents3d[n], 'dead');
    }
  }
}

export function processMessages() {
  var history = window.cachedHistory;
  if (!history || history.length === 0) return;

  // Use window-level counter so it persists across 3D stop/start cycles (tab switches)
  // This prevents message replay when user switches from Messages tab back to 3D Hub
  if (typeof window._lastProcessedMsg === 'undefined') window._lastProcessedMsg = 0;
  var newMsgs = history.slice(window._lastProcessedMsg);
  window._lastProcessedMsg = history.length;

  for (var i = 0; i < newMsgs.length; i++) {
    var msg = newMsgs[i];
    var from = S.agents3d[msg.from];
    if (!from || !from.registered) continue;
    var text = msg.content || msg.message || '';

    from.lastMessageTime = Date.now();
    flashDeskScreen(from.deskIdx);

    // Instant preview bubble — show short text immediately before walk animation
    // Gives users instant visual feedback that the agent is about to speak
    var preview = text.length > 30 ? text.substring(0, 27) + '...' : text;
    showBubble(from, preview);

    // Auto-celebrate on task completion events
    if (text.indexOf('[EVENT] Task') >= 0 && text.indexOf('completed') >= 0) {
      from.celebrateTimer = 1.5;
      from.taskCelebration = 2;
    }

    // Emotion detection from message content
    var textLower = text.toLowerCase();
    if (textLower.indexOf('done') >= 0 || textLower.indexOf('pass') >= 0 || textLower.indexOf('success') >= 0 || textLower.indexOf('great') >= 0 || textLower.indexOf('shipped') >= 0) {
      setEmotion(from, 'happy', 5);
    } else if (textLower.indexOf('error') >= 0 || textLower.indexOf('fail') >= 0 || textLower.indexOf('bug') >= 0 || textLower.indexOf('broken') >= 0) {
      setEmotion(from, 'frustrated', 5);
    } else if (textLower.indexOf('?') >= 0 && (textLower.indexOf('how') >= 0 || textLower.indexOf('why') >= 0 || textLower.indexOf('what if') >= 0)) {
      setEmotion(from, 'thinking', 4);
    } else if (textLower.indexOf('!') >= 0 && (textLower.indexOf('wow') >= 0 || textLower.indexOf('amazing') >= 0 || textLower.indexOf('awesome') >= 0)) {
      setEmotion(from, 'excited', 4);
    }

    // Target agent gets surprised when directly addressed
    if (msg.to && msg.to !== 'all' && S.agents3d[msg.to]) {
      var targetAgent = S.agents3d[msg.to];
      if (targetAgent.registered && targetAgent.isSitting) {
        setEmotion(targetAgent, 'surprised', 2);
      }
    }

    // Contextual gesture based on message type
    var isBC = !msg.to || msg.to === 'all';
    if (isBC) {
      from.waveTimer = 0.8;
    } else {
      from.pointTimer = 0.6;
    }

    // Glance reaction — nearby sitting agents glance toward the speaker
    for (var gn in S.agents3d) {
      var ga = S.agents3d[gn];
      if (gn === msg.from || gn === msg.to || !ga.registered || ga.state !== 'active' || !ga.isSitting) continue;
      var gdx = from.pos.x - ga.pos.x;
      ga._glanceTarget = from.name;
      ga._glanceDirection = gdx > 0 ? 1 : -1; // left or right glance
      ga._glanceTimer = 0;
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
              navigateTo(f, f.deskPos.x, _agentDeskZ(f));
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
              navigateTo(f, f.deskPos.x, _agentDeskZ(f));
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
