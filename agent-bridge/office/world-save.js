// world-save.js — Persistence layer for the World Builder
// Saves/loads placed objects to .agent-bridge/world-layout.json via dashboard API

var _placements = [];     // in-memory placement array
var _saveTimeout = null;  // debounce timer
var _loaded = false;

// Generate unique placement ID
function generatePlacementId() {
  return 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Get project query string for API calls
function getProjectParam() {
  return window.activeProject ? '?project=' + encodeURIComponent(window.activeProject) : '';
}

function getScopedWorldUrl(path) {
  if (typeof window.scopedApiUrl === 'function') {
    return window.scopedApiUrl(path, null, { includeBranch: false });
  }
  return path + getProjectParam();
}

function clonePlacementEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.type) return null;
  return {
    id: entry.id || generatePlacementId(),
    type: entry.type,
    x: entry.x,
    y: entry.y || 0,
    z: entry.z,
    rotY: entry.rotY || 0,
    placed_by: entry.placed_by || 'user',
    timestamp: entry.timestamp || new Date().toISOString()
  };
}

// --- Load world layout from server ---
export async function loadWorld() {
  try {
    var res = await fetch(getScopedWorldUrl('/api/world-layout'));
    if (res.ok) {
      var data = await res.json();
      _placements = Array.isArray(data) ? data : [];
      _loaded = true;
      return _placements;
    }
  } catch (e) {
    console.warn('[world-save] Load failed:', e.message);
  }
  _placements = [];
  _loaded = true;
  return _placements;
}

// --- Save full world layout to server (debounced) ---
function scheduleSave() {
  if (_saveTimeout) clearTimeout(_saveTimeout);
  _saveTimeout = setTimeout(function() {
    _saveTimeout = null;
    fetch(getScopedWorldUrl('/api/world-save'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-LTT-Request': '1' },
      body: JSON.stringify(_placements)
    }).catch(function(e) {
      console.warn('[world-save] Save failed:', e.message);
    });
  }, 500); // debounce 500ms — batches rapid placements
}

// --- Add a single placement ---
export function addPlacement(type, x, y, z, rotY, placedBy) {
  var entry = clonePlacementEntry({
    id: generatePlacementId(),
    type: type,
    x: x,
    y: y || 0,
    z: z,
    rotY: rotY || 0,
    placed_by: placedBy || 'user',
    timestamp: new Date().toISOString()
  });
  _placements.push(entry);
  scheduleSave();
  return entry;
}

export function restorePlacement(entry) {
  var restored = clonePlacementEntry(entry);
  if (!restored) return null;
  var idx = _placements.findIndex(function(p) { return p.id === restored.id; });
  if (idx === -1) _placements.push(restored);
  else _placements[idx] = restored;
  scheduleSave();
  return restored;
}

// --- Remove a placement by ID ---
export function removePlacement(id) {
  var idx = _placements.findIndex(function(p) { return p.id === id; });
  if (idx === -1) return null;
  var removed = _placements.splice(idx, 1)[0];
  scheduleSave();
  return removed;
}

// --- Get all placements (read-only copy) ---
export function getPlacements() {
  return _placements.slice();
}

// --- Clear all placements ---
export function clearWorld() {
  _placements = [];
  scheduleSave();
}

// --- Check if world has been loaded ---
export function isLoaded() {
  return _loaded;
}
