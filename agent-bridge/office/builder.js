// builder.js — Real-time World Builder for the 3D Hub
// Press B to toggle builder mode. Click to place assets. R to rotate. Right-click to delete.
import * as THREE from 'three';
import { S } from './state.js';
import { ASSETS, ASSET_CATEGORIES, getAsset, getAssetsByCategory, createGhost } from './assets.js';
import { addPlacement, removePlacement, loadWorld, getPlacements } from './world-save.js';
import { isPlayerMode } from './player.js';

var _active = false;          // builder mode on/off
var _panel = null;             // UI panel element
var _selectedAsset = null;     // currently selected asset ID
var _ghostMesh = null;         // preview mesh following cursor
var _rotation = 0;             // current placement rotation (0, PI/2, PI, 3PI/2)
var _placedMeshes = {};        // id → THREE.Group map for deletion
var _gridHelper = null;        // grid overlay
var _raycaster = new THREE.Raycaster();
var _mouse = new THREE.Vector2();
var _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0); // Y=0 plane
var GRID_SIZE = 0.5;           // snap grid in world units
var _undoStack = [];           // for undo (Ctrl+Z)

// ===================== PUBLIC API =====================

export function isBuilderActive() { return _active; }

export function toggleBuilder() {
  if (_active) exitBuilder();
  else enterBuilder();
}

export function enterBuilder() {
  if (_active) return;
  _active = true;
  showPanel();
  showGrid();
  addListeners();
}

export function exitBuilder() {
  if (!_active) return;
  _active = false;
  hidePanel();
  hideGrid();
  removeGhost();
  removeListeners();
  _selectedAsset = null;
}

// Load saved placements and render them in the scene
export function loadSavedWorld() {
  loadWorld().then(function(placements) {
    if (!placements || !Array.isArray(placements)) return;
    for (var i = 0; i < placements.length; i++) {
      renderPlacement(placements[i]);
    }
  });
}

// ===================== GRID =====================

function showGrid() {
  if (_gridHelper) return;
  _gridHelper = new THREE.GridHelper(50, 100, 0x444466, 0x333355); // 50 units, 0.5 unit cells
  _gridHelper.position.y = 0.005;
  _gridHelper.material.transparent = true;
  _gridHelper.material.opacity = 0.3;
  S.scene.add(_gridHelper);
}

function hideGrid() {
  if (_gridHelper) {
    S.scene.remove(_gridHelper);
    _gridHelper.geometry.dispose();
    _gridHelper.material.dispose();
    _gridHelper = null;
  }
}

// ===================== GHOST PREVIEW =====================

function setGhost(assetId) {
  removeGhost();
  if (!assetId) return;
  _ghostMesh = createGhost(assetId);
  if (_ghostMesh) {
    S.scene.add(_ghostMesh);
  }
}

function removeGhost() {
  if (_ghostMesh) {
    S.scene.remove(_ghostMesh);
    _ghostMesh.traverse(function(c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    _ghostMesh = null;
  }
}

function updateGhostPosition(event) {
  if (!_ghostMesh || !S.renderer || !S.camera) return;
  var rect = S.renderer.domElement.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, S.camera);

  var intersect = new THREE.Vector3();
  _raycaster.ray.intersectPlane(_floorPlane, intersect);
  if (intersect) {
    // Snap to grid
    intersect.x = Math.round(intersect.x / GRID_SIZE) * GRID_SIZE;
    intersect.z = Math.round(intersect.z / GRID_SIZE) * GRID_SIZE;
    intersect.y = 0;
    _ghostMesh.position.copy(intersect);
    _ghostMesh.rotation.y = _rotation;
  }
}

// ===================== PLACEMENT =====================

function placeAsset(event) {
  if (!_selectedAsset || !_ghostMesh) return;

  var pos = _ghostMesh.position.clone();
  var entry = addPlacement(_selectedAsset, pos.x, pos.y, pos.z, _rotation, 'user');
  renderPlacement(entry);
  _undoStack.push(entry.id);
}

function renderPlacement(entry) {
  var asset = getAsset(entry.type);
  if (!asset) return;
  var group = asset.factory();
  group.position.set(entry.x, entry.y || 0, entry.z);
  group.rotation.y = entry.rotY || 0;
  group.userData.placementId = entry.id;
  group.userData.isPlaced = true;
  S.scene.add(group);
  _placedMeshes[entry.id] = group;
}

function deleteNearestPlacement(event) {
  if (!S.renderer || !S.camera) return;
  var rect = S.renderer.domElement.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, S.camera);

  // Collect all placed meshes
  var meshes = [];
  for (var id in _placedMeshes) {
    _placedMeshes[id].traverse(function(c) {
      if (c.isMesh) { c.userData._placementId = id; meshes.push(c); }
    });
  }

  var hits = _raycaster.intersectObjects(meshes, false);
  if (hits.length > 0) {
    var hitId = hits[0].object.userData._placementId;
    if (hitId && _placedMeshes[hitId]) {
      // Remove from scene
      var group = _placedMeshes[hitId];
      S.scene.remove(group);
      group.traverse(function(c) {
        if (c.geometry) c.geometry.dispose();
        if (c.material && !c.material._shared) c.material.dispose();
      });
      delete _placedMeshes[hitId];
      // Remove from save data
      removePlacement(hitId);
    }
  }
}

function undoLast() {
  if (_undoStack.length === 0) return;
  var lastId = _undoStack.pop();
  if (_placedMeshes[lastId]) {
    var group = _placedMeshes[lastId];
    S.scene.remove(group);
    group.traverse(function(c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
    delete _placedMeshes[lastId];
    removePlacement(lastId);
  }
}

// ===================== UI PANEL =====================

function showPanel() {
  if (_panel) return;
  _panel = document.createElement('div');
  _panel.id = 'builder-panel';
  _panel.style.cssText = 'position:fixed;right:12px;top:80px;z-index:999999;width:180px;max-height:70vh;overflow-y:auto;background:rgba(22,27,34,0.95);border:1px solid #30363d;border-radius:10px;padding:0 8px 8px;font-family:system-ui;color:#e6edf3;backdrop-filter:blur(8px);';

  // Drag handle header
  var header = document.createElement('div');
  header.style.cssText = 'text-align:center;font-size:13px;font-weight:bold;color:#58a6ff;padding:8px 0;border-bottom:1px solid #30363d;margin-bottom:8px;cursor:grab;user-select:none;';
  header.textContent = '\u2630 World Builder';
  header.title = 'Drag to move';
  _panel.appendChild(header);

  // Drag logic — store refs for cleanup in hidePanel()
  var dragOffX = 0, dragOffY = 0, dragging = false;
  header.addEventListener('mousedown', function(e) {
    dragging = true;
    dragOffX = e.clientX - _panel.getBoundingClientRect().left;
    dragOffY = e.clientY - _panel.getBoundingClientRect().top;
    header.style.cursor = 'grabbing';
    e.preventDefault();
  });
  _panel._dragMove = function(e) {
    if (!dragging || !_panel) return;
    _panel.style.left = (e.clientX - dragOffX) + 'px';
    _panel.style.top = (e.clientY - dragOffY) + 'px';
    _panel.style.right = 'auto';
    _panel.style.transform = 'none';
  };
  _panel._dragUp = function() {
    if (dragging) { dragging = false; if (header) header.style.cursor = 'grab'; }
  };
  document.addEventListener('mousemove', _panel._dragMove);
  document.addEventListener('mouseup', _panel._dragUp);

  // Hint
  var hint = document.createElement('div');
  hint.style.cssText = 'font-size:9px;color:#8b949e;text-align:center;margin-bottom:8px;';
  hint.textContent = 'Click=Place | R=Rotate | Right-click=Delete | Ctrl+Z=Undo | B=Close';
  _panel.appendChild(hint);

  // Categories + assets
  for (var ci = 0; ci < ASSET_CATEGORIES.length; ci++) {
    var cat = ASSET_CATEGORIES[ci];
    var catAssets = getAssetsByCategory(cat.id);
    if (catAssets.length === 0) continue;

    var catLabel = document.createElement('div');
    catLabel.style.cssText = 'font-size:10px;color:#8b949e;padding:4px 0 2px;text-transform:uppercase;letter-spacing:1px;';
    catLabel.textContent = cat.icon + ' ' + cat.label;
    _panel.appendChild(catLabel);

    for (var ai = 0; ai < catAssets.length; ai++) {
      var asset = catAssets[ai];
      var btn = document.createElement('button');
      btn.style.cssText = 'display:block;width:100%;padding:6px 8px;margin:2px 0;background:rgba(48,54,61,0.6);border:1px solid transparent;border-radius:6px;color:#c9d1d9;font-size:11px;cursor:pointer;text-align:left;transition:all 0.15s;';
      btn.textContent = asset.icon + ' ' + asset.name;
      btn.dataset.assetId = asset.id;
      btn.addEventListener('mouseenter', function() { this.style.background = 'rgba(88,166,255,0.2)'; this.style.borderColor = '#58a6ff'; });
      btn.addEventListener('mouseleave', function() {
        if (this.dataset.assetId !== _selectedAsset) {
          this.style.background = 'rgba(48,54,61,0.6)'; this.style.borderColor = 'transparent';
        }
      });
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        var id = this.dataset.assetId;
        _selectedAsset = id;
        _rotation = 0;
        setGhost(id);
        // Highlight selected
        var btns = _panel.querySelectorAll('button');
        for (var b = 0; b < btns.length; b++) {
          btns[b].style.background = 'rgba(48,54,61,0.6)'; btns[b].style.borderColor = 'transparent';
        }
        this.style.background = 'rgba(88,166,255,0.3)'; this.style.borderColor = '#58a6ff';
      });
      _panel.appendChild(btn);
    }
  }

  // Append to fullscreen element if active, otherwise document.body
  // This ensures the builder panel is visible when the 3D container is fullscreened
  var target = document.fullscreenElement || document.body;
  target.appendChild(_panel);
}

function hidePanel() {
  if (_panel) {
    // Remove drag listeners to prevent leaks
    if (_panel._dragMove) document.removeEventListener('mousemove', _panel._dragMove);
    if (_panel._dragUp) document.removeEventListener('mouseup', _panel._dragUp);
    if (_panel.parentElement) _panel.remove();
  }
  _panel = null;
}

// ===================== EVENT LISTENERS =====================

var _onMouseMove = null;
var _onMouseDown = null;
var _onContextMenu = null;
var _onKeyDown = null;

function addListeners() {
  _onMouseMove = function(e) { updateGhostPosition(e); };
  _onMouseDown = function(e) {
    if (!_active) return;
    if (e.button === 0 && _selectedAsset) { // left click
      // Don't place if clicking the panel
      if (_panel && _panel.contains(e.target)) return;
      placeAsset(e);
    }
  };
  _onContextMenu = function(e) {
    if (!_active) return;
    e.preventDefault();
    deleteNearestPlacement(e);
  };
  _onKeyDown = function(e) {
    if (!_active) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.code === 'KeyR') {
      // Rotate 90 degrees
      _rotation = (_rotation + Math.PI / 2) % (Math.PI * 2);
      if (_ghostMesh) _ghostMesh.rotation.y = _rotation;
    }
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      undoLast();
    }
  };

  window.addEventListener('mousemove', _onMouseMove);
  window.addEventListener('mousedown', _onMouseDown);
  window.addEventListener('contextmenu', _onContextMenu);
  window.addEventListener('keydown', _onKeyDown);
}

function removeListeners() {
  if (_onMouseMove) window.removeEventListener('mousemove', _onMouseMove);
  if (_onMouseDown) window.removeEventListener('mousedown', _onMouseDown);
  if (_onContextMenu) window.removeEventListener('contextmenu', _onContextMenu);
  if (_onKeyDown) window.removeEventListener('keydown', _onKeyDown);
  _onMouseMove = _onMouseDown = _onContextMenu = _onKeyDown = null;
}

// ===================== CLEANUP =====================

export function cleanupBuilder() {
  exitBuilder();
  // Remove all placed meshes from scene
  for (var id in _placedMeshes) {
    var group = _placedMeshes[id];
    S.scene.remove(group);
    group.traverse(function(c) {
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    });
  }
  _placedMeshes = {};
  _undoStack = [];
}
