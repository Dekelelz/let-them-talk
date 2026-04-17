// builder.js — World Builder for the 3D Hub
// B = toggle builder | Click = place | R = rotate | Right-click = delete
// Ctrl+Z = undo | Ctrl+Shift+Z = redo | G = grab/move selected | Escape = deselect
// Snaps objects on top of surfaces (desks, tables, etc.) not just the floor
import * as THREE from 'three';
import { S } from './state.js';
import { ASSETS, ASSET_CATEGORIES, getAsset, getAssetsByCategory, createGhost } from './assets.js';
import { addPlacement, removePlacement, restorePlacement, loadWorld, getPlacements } from './world-save.js';
import { isPlayerMode } from './player.js';

var _active = false;
var _panel = null;
var _selectedAsset = null;      // asset ID for placement mode
var _ghostMesh = null;
var _rotation = 0;
var _placedMeshes = {};         // placementId → THREE.Group
var _gridHelper = null;
var _raycaster = new THREE.Raycaster();
var _mouse = new THREE.Vector2();
var _floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
var GRID_SIZE = 0.5;

// Undo / Redo
var _undoStack = [];            // { action, data }
var _redoStack = [];

// Campus edit
var _selectedCampusObj = null;  // currently selected campus furniture group
var _selectionBox = null;       // wireframe highlight around selected
var _grabMode = false;          // G key — moving selected object
var _campusBackedUp = false;

// Locked types — these campus objects cannot be moved or deleted
var LOCKED_TYPES = ['floor', 'wall', 'ceiling', 'roof', 'skylight', 'column', 'beam', 'corridor'];

// ===================== PUBLIC API =====================

export function isBuilderActive() { return _active; }

export function toggleBuilder() {
  if (_active) exitBuilder(); else enterBuilder();
}

export function enterBuilder() {
  if (_active) return;
  _active = true;
  window._builderActive = true;
  // Release pointer lock so mouse cursor is available for builder UI
  if (document.pointerLockElement) document.exitPointerLock();
  _tagCampusFurniture();
  showPanel();
  showGrid();
  addListeners();
}

export function exitBuilder() {
  if (!_active) return;
  _active = false;
  window._builderActive = false;
  hidePanel();
  hideGrid();
  removeGhost();
  _deselectCampus();
  removeListeners();
  _selectedAsset = null;
  _grabMode = false;
}

export function loadSavedWorld() {
  loadWorld().then(function(placements) {
    _clearRenderedPlacements();
    if (!placements || !Array.isArray(placements)) return;
    for (var i = 0; i < placements.length; i++) {
      renderPlacement(placements[i]);
    }
  });
}

// ===================== CAMPUS FURNITURE TAGGING =====================
// Tag all furniture in S.furnitureGroup so they can be selected/moved
// Skip structural elements (walls, floors, ceiling, columns)

function _tagCampusFurniture() {
  if (!S.furnitureGroup) return;
  var id = 0;
  S.furnitureGroup.children.forEach(function(child) {
    if (!child.userData._campusId) {
      child.userData._campusId = 'campus_' + (id++);
      // Determine if this is a locked structural element by checking geometry
      var isLocked = _isStructural(child);
      child.userData._campusLocked = isLocked;
      child.userData._campusOrigPos = child.position.clone();
      child.userData._campusOrigRot = child.rotation.clone();
    }
  });
}

function _isStructural(obj) {
  // Check if object is structural by name or geometry characteristics
  // Floor: very flat, large, at Y~0 | Wall: tall thin | Ceiling: flat at Y~6
  var box = new THREE.Box3().setFromObject(obj);
  var size = box.getSize(new THREE.Vector3());
  var center = box.getCenter(new THREE.Vector3());

  // Floor plane (very thin, very wide)
  if (size.y < 0.1 && size.x > 20 && size.z > 20 && center.y < 0.5) return true;
  // Ceiling (at height ~6)
  if (center.y > 5 && size.y < 0.5 && size.x > 10) return true;
  // Full-height walls (tall + thin in one axis)
  if (size.y > 4 && (size.x < 0.5 || size.z < 0.5) && (size.x > 10 || size.z > 10)) return true;
  // Roof group
  if (obj === S._roofGroup) return true;

  return false;
}

// ===================== BACKUP SYSTEM =====================

function _backupCampus() {
  if (_campusBackedUp) return;
  _campusBackedUp = true;
  // Save original positions of all campus furniture to localStorage
  var backup = {};
  if (!S.furnitureGroup) return;
  S.furnitureGroup.children.forEach(function(child) {
    if (child.userData._campusId) {
      backup[child.userData._campusId] = {
        x: child.position.x, y: child.position.y, z: child.position.z,
        rx: child.rotation.x, ry: child.rotation.y, rz: child.rotation.z,
        visible: child.visible
      };
    }
  });
  try {
    localStorage.setItem('ltt_campus_backup', JSON.stringify(backup));
  } catch (e) {}
}

export function restoreCampus() {
  try {
    var data = localStorage.getItem('ltt_campus_backup');
    if (!data) return false;
    var backup = JSON.parse(data);
    if (!S.furnitureGroup) return false;
    S.furnitureGroup.children.forEach(function(child) {
      var id = child.userData._campusId;
      if (id && backup[id]) {
        child.position.set(backup[id].x, backup[id].y, backup[id].z);
        child.rotation.set(backup[id].rx, backup[id].ry, backup[id].rz);
        child.visible = backup[id].visible !== false;
      }
    });
    return true;
  } catch (e) { return false; }
}

// ===================== GRID =====================

function showGrid() {
  if (_gridHelper) return;
  _gridHelper = new THREE.GridHelper(90, 180, 0x444466, 0x333355);
  _gridHelper.position.y = 0.005;
  _gridHelper.material.transparent = true;
  _gridHelper.material.opacity = 0.25;
  S.scene.add(_gridHelper);
}

function hideGrid() {
  if (_gridHelper) {
    S.scene.remove(_gridHelper);
    _gridHelper.geometry.dispose();
    if (Array.isArray(_gridHelper.material)) {
      _gridHelper.material.forEach(function(m) { m.dispose(); });
    } else {
      _gridHelper.material.dispose();
    }
    _gridHelper = null;
  }
}

// ===================== GHOST PREVIEW =====================

function setGhost(assetId) {
  removeGhost();
  _deselectCampus();
  if (!assetId) return;
  _ghostMesh = createGhost(assetId);
  if (_ghostMesh) S.scene.add(_ghostMesh);
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

// ===================== SURFACE SNAPPING =====================
// Raycast downward from above to find the surface to place on

function updateGhostPosition(event) {
  if (!_ghostMesh || !S.renderer || !S.camera) return;
  var rect = S.renderer.domElement.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, S.camera);

  // Step 1: find where cursor ray hits the floor plane (for X/Z)
  var floorHit = new THREE.Vector3();
  _raycaster.ray.intersectPlane(_floorPlane, floorHit);
  if (!floorHit) return;

  // Snap X/Z to grid
  var snapX = Math.round(floorHit.x / GRID_SIZE) * GRID_SIZE;
  var snapZ = Math.round(floorHit.z / GRID_SIZE) * GRID_SIZE;

  // Step 2: find the highest surface at this XZ by casting down from above
  var surfaceY = _findSurfaceY(snapX, snapZ);

  _ghostMesh.position.set(snapX, surfaceY, snapZ);
  _ghostMesh.rotation.y = _rotation;
}

function _findSurfaceY(x, z) {
  // Cast a ray straight down from high up at the given XZ
  var downRay = new THREE.Raycaster(
    new THREE.Vector3(x, 10, z),
    new THREE.Vector3(0, -1, 0),
    0, 12
  );

  // Collect all meshes in the furniture group + placed objects (skip ghosts)
  var targets = [];
  if (S.furnitureGroup) {
    S.furnitureGroup.traverse(function(c) {
      if (c.isMesh && !c.userData.isGhost) targets.push(c);
    });
  }
  for (var id in _placedMeshes) {
    _placedMeshes[id].traverse(function(c) {
      if (c.isMesh) targets.push(c);
    });
  }

  var hits = downRay.intersectObjects(targets, false);

  // Find the highest horizontal surface (normal pointing up)
  for (var i = 0; i < hits.length; i++) {
    var normal = hits[i].face ? hits[i].face.normal : null;
    if (normal) {
      // Transform normal to world space
      var worldNormal = normal.clone().transformDirection(hits[i].object.matrixWorld);
      // Accept surfaces that face upward (Y component > 0.7)
      if (worldNormal.y > 0.7 && hits[i].point.y > 0.02) {
        return hits[i].point.y;
      }
    }
  }

  return 0; // default to floor
}

// ===================== PLACEMENT =====================

function placeAsset(event) {
  if (!_selectedAsset || !_ghostMesh) return;
  var pos = _ghostMesh.position.clone();
  var entry = addPlacement(_selectedAsset, pos.x, pos.y, pos.z, _rotation, 'user');
  renderPlacement(entry);
  _pushUndo({ action: 'place', id: entry.id });
}

function _disposePlacementMaterial(material) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (var i = 0; i < material.length; i++) {
      if (material[i] && !material[i]._shared) material[i].dispose();
    }
    return;
  }
  if (!material._shared) material.dispose();
}

function _removeRenderedPlacement(id) {
  var group = _placedMeshes[id];
  if (!group) return;
  S.scene.remove(group);
  group.traverse(function(c) {
    if (c.geometry) c.geometry.dispose();
    _disposePlacementMaterial(c.material);
  });
  delete _placedMeshes[id];
}

function _clearRenderedPlacements() {
  for (var id in _placedMeshes) {
    _removeRenderedPlacement(id);
  }
}

function renderPlacement(entry) {
  if (!entry || !entry.id) return;
  _removeRenderedPlacement(entry.id);
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

// ===================== DELETION =====================

function deleteAtCursor(event) {
  if (!S.renderer || !S.camera) return;
  var rect = S.renderer.domElement.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, S.camera);

  // Check user-placed objects first
  var placedMeshes = [];
  for (var id in _placedMeshes) {
    _placedMeshes[id].traverse(function(c) {
      if (c.isMesh) { c.userData._placementId = id; placedMeshes.push(c); }
    });
  }

  var hits = _raycaster.intersectObjects(placedMeshes, false);
  if (hits.length > 0) {
    var hitId = hits[0].object.userData._placementId;
    if (hitId && _placedMeshes[hitId]) {
      _deletePlacedObject(hitId);
      return;
    }
  }

  // Check campus furniture (non-locked only)
  if (S.furnitureGroup) {
    var campusMeshes = [];
    S.furnitureGroup.children.forEach(function(child) {
      if (child.userData._campusId && !child.userData._campusLocked && child.visible) {
        child.traverse(function(c) {
          if (c.isMesh) { c.userData._campusRef = child; campusMeshes.push(c); }
        });
      }
    });

    var campusHits = _raycaster.intersectObjects(campusMeshes, false);
    if (campusHits.length > 0) {
      var campusObj = campusHits[0].object.userData._campusRef;
      if (campusObj && campusObj.userData._campusId) {
        _deleteCampusObject(campusObj);
      }
    }
  }
}

function _deletePlacedObject(id) {
  if (!_placedMeshes[id]) return;
  var placement = getPlacements().find(function(p) { return p.id === id; });
  _removeRenderedPlacement(id);
  removePlacement(id);
  _pushUndo({ action: 'delete_placed', id: id, placement: placement });
}

function _deleteCampusObject(obj) {
  _backupCampus();
  var campusId = obj.userData._campusId;
  var prevPos = obj.position.clone();
  var prevRot = obj.rotation.clone();
  obj.visible = false;
  _pushUndo({ action: 'delete_campus', campusId: campusId, prevPos: prevPos, prevRot: prevRot });
  _deselectCampus();
}

// ===================== CAMPUS SELECTION & MOVE =====================

function _selectCampusAt(event) {
  if (_selectedAsset) return; // in placement mode, don't select
  if (!S.renderer || !S.camera || !S.furnitureGroup) return;

  var rect = S.renderer.domElement.getBoundingClientRect();
  _mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  _raycaster.setFromCamera(_mouse, S.camera);

  // Also check placed objects
  var allMeshes = [];
  for (var id in _placedMeshes) {
    _placedMeshes[id].traverse(function(c) {
      if (c.isMesh) { c.userData._selectRef = _placedMeshes[id]; c.userData._selectType = 'placed'; allMeshes.push(c); }
    });
  }

  S.furnitureGroup.children.forEach(function(child) {
    if (child.userData._campusId && !child.userData._campusLocked && child.visible) {
      child.traverse(function(c) {
        if (c.isMesh) { c.userData._selectRef = child; c.userData._selectType = 'campus'; allMeshes.push(c); }
      });
    }
  });

  var hits = _raycaster.intersectObjects(allMeshes, false);
  if (hits.length > 0) {
    var ref = hits[0].object.userData._selectRef;
    if (ref) {
      _deselectCampus();
      _selectedCampusObj = ref;
      _showSelectionBox(ref);
      return true;
    }
  }

  _deselectCampus();
  return false;
}

function _deselectCampus() {
  _selectedCampusObj = null;
  _grabMode = false;
  if (_selectionBox) {
    S.scene.remove(_selectionBox);
    _selectionBox.geometry.dispose();
    _selectionBox.material.dispose();
    _selectionBox = null;
  }
}

function _showSelectionBox(obj) {
  if (_selectionBox) {
    S.scene.remove(_selectionBox);
    _selectionBox.geometry.dispose();
    _selectionBox.material.dispose();
  }
  var box = new THREE.Box3().setFromObject(obj);
  var size = box.getSize(new THREE.Vector3());
  var center = box.getCenter(new THREE.Vector3());

  var geo = new THREE.BoxGeometry(size.x + 0.1, size.y + 0.1, size.z + 0.1);
  var edges = new THREE.EdgesGeometry(geo);
  _selectionBox = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x58a6ff, linewidth: 2 }));
  _selectionBox.position.copy(center);
  S.scene.add(_selectionBox);
}

function _moveSelected(dx, dz) {
  if (!_selectedCampusObj) return;
  _backupCampus();
  var prevPos = _selectedCampusObj.position.clone();
  _selectedCampusObj.position.x += dx;
  _selectedCampusObj.position.z += dz;
  _pushUndo({
    action: 'move_campus',
    campusId: _selectedCampusObj.userData._campusId,
    prevPos: prevPos,
    newPos: _selectedCampusObj.position.clone()
  });
  _showSelectionBox(_selectedCampusObj);
}

function _rotateSelected() {
  if (!_selectedCampusObj) return;
  _backupCampus();
  var prevRot = _selectedCampusObj.rotation.y;
  _selectedCampusObj.rotation.y += Math.PI / 2;
  _pushUndo({
    action: 'rotate_campus',
    campusId: _selectedCampusObj.userData._campusId,
    prevRot: prevRot,
    newRot: _selectedCampusObj.rotation.y
  });
  _showSelectionBox(_selectedCampusObj);
}

// ===================== UNDO / REDO =====================

function _pushUndo(entry) {
  _undoStack.push(entry);
  _redoStack = []; // clear redo on new action
  if (_undoStack.length > 100) _undoStack.shift();
}

function _findCampusObj(campusId) {
  if (!S.furnitureGroup) return null;
  for (var i = 0; i < S.furnitureGroup.children.length; i++) {
    if (S.furnitureGroup.children[i].userData._campusId === campusId) return S.furnitureGroup.children[i];
  }
  return null;
}

function doUndo() {
  if (_undoStack.length === 0) return;
  var entry = _undoStack.pop();

  if (entry.action === 'place') {
    // Undo placement — remove object
    if (_placedMeshes[entry.id]) {
      _removeRenderedPlacement(entry.id);
      var p = getPlacements().find(function(pp) { return pp.id === entry.id; });
      removePlacement(entry.id);
      entry._undoneData = p; // save for redo
    }
  } else if (entry.action === 'delete_placed') {
    // Undo deletion — re-add
    if (entry.placement) {
      var restoredPlacement = restorePlacement(entry.placement);
      if (restoredPlacement) renderPlacement(restoredPlacement);
    }
  } else if (entry.action === 'delete_campus') {
    var obj = _findCampusObj(entry.campusId);
    if (obj) { obj.visible = true; obj.position.copy(entry.prevPos); obj.rotation.copy(entry.prevRot); }
  } else if (entry.action === 'move_campus') {
    var obj2 = _findCampusObj(entry.campusId);
    if (obj2) { obj2.position.copy(entry.prevPos); _showSelectionBox(obj2); }
  } else if (entry.action === 'rotate_campus') {
    var obj3 = _findCampusObj(entry.campusId);
    if (obj3) { obj3.rotation.y = entry.prevRot; _showSelectionBox(obj3); }
  }

  _redoStack.push(entry);
}

function doRedo() {
  if (_redoStack.length === 0) return;
  var entry = _redoStack.pop();

  if (entry.action === 'place') {
    if (entry._undoneData) {
      var redonePlacement = restorePlacement(entry._undoneData);
      if (redonePlacement) renderPlacement(redonePlacement);
    }
  } else if (entry.action === 'delete_placed') {
    if (entry.id && _placedMeshes[entry.id]) {
      _deletePlacedObject(entry.id);
      _undoStack.pop(); // _deletePlacedObject pushes undo — remove it
    }
  } else if (entry.action === 'delete_campus') {
    var obj = _findCampusObj(entry.campusId);
    if (obj) obj.visible = false;
  } else if (entry.action === 'move_campus') {
    var obj2 = _findCampusObj(entry.campusId);
    if (obj2) { obj2.position.copy(entry.newPos); _showSelectionBox(obj2); }
  } else if (entry.action === 'rotate_campus') {
    var obj3 = _findCampusObj(entry.campusId);
    if (obj3) { obj3.rotation.y = entry.newRot; _showSelectionBox(obj3); }
  }

  _undoStack.push(entry);
}

// ===================== UI PANEL =====================

function showPanel() {
  if (_panel) return;
  _panel = document.createElement('div');
  _panel.id = 'builder-panel';
  _panel.style.cssText = 'position:fixed;right:12px;top:80px;z-index:999999;width:190px;max-height:70vh;overflow-y:auto;background:rgba(22,27,34,0.95);border:1px solid #30363d;border-radius:10px;padding:0 8px 8px;font-family:system-ui;color:#e6edf3;backdrop-filter:blur(8px);';

  // Drag handle header
  var header = document.createElement('div');
  header.style.cssText = 'text-align:center;font-size:13px;font-weight:bold;color:#58a6ff;padding:8px 0;border-bottom:1px solid #30363d;margin-bottom:6px;cursor:grab;user-select:none;';
  header.textContent = 'World Builder';
  _panel.appendChild(header);

  // Drag logic
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
  };
  _panel._dragUp = function() { if (dragging) { dragging = false; if (header) header.style.cursor = 'grab'; } };
  document.addEventListener('mousemove', _panel._dragMove);
  document.addEventListener('mouseup', _panel._dragUp);

  // Controls hint
  var hint = document.createElement('div');
  hint.style.cssText = 'font-size:8px;color:#8b949e;text-align:center;margin-bottom:6px;line-height:1.4;';
  hint.innerHTML = 'Click=Place/Select | R=Rotate | RightClick=Delete<br>G=Grab | Arrows=Move | Ctrl+Z/Y=Undo/Redo<br>Esc=Deselect | B=Close';
  _panel.appendChild(hint);

  // Restore campus button
  var restoreBtn = document.createElement('button');
  restoreBtn.style.cssText = 'display:block;width:100%;padding:5px;margin-bottom:6px;background:rgba(239,68,68,0.15);border:1px solid #ef4444;border-radius:6px;color:#ef4444;font-size:10px;cursor:pointer;';
  restoreBtn.textContent = 'Restore Original Campus';
  restoreBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (confirm('Restore campus to original layout? User-placed objects will remain.')) {
      restoreCampus();
    }
  });
  _panel.appendChild(restoreBtn);

  // Deselect button (asset)
  var deselectBtn = document.createElement('button');
  deselectBtn.style.cssText = 'display:block;width:100%;padding:5px;margin-bottom:8px;background:rgba(48,54,61,0.6);border:1px solid #30363d;border-radius:6px;color:#8b949e;font-size:10px;cursor:pointer;';
  deselectBtn.textContent = 'Deselect Tool (click to select objects)';
  deselectBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    _selectedAsset = null;
    removeGhost();
    // Un-highlight all buttons
    var btns = _panel.querySelectorAll('button[data-asset-id]');
    for (var b = 0; b < btns.length; b++) {
      btns[b].style.background = 'rgba(48,54,61,0.6)'; btns[b].style.borderColor = 'transparent';
    }
  });
  _panel.appendChild(deselectBtn);

  // Categories + assets
  for (var ci = 0; ci < ASSET_CATEGORIES.length; ci++) {
    var cat = ASSET_CATEGORIES[ci];
    var catAssets = getAssetsByCategory(cat.id);
    if (catAssets.length === 0) continue;

    var catLabel = document.createElement('div');
    catLabel.style.cssText = 'font-size:10px;color:#8b949e;padding:4px 0 2px;text-transform:uppercase;letter-spacing:1px;cursor:pointer;';
    catLabel.textContent = cat.icon + ' ' + cat.label + ' (' + catAssets.length + ')';
    catLabel.dataset.catId = cat.id;

    // Collapsible
    var catBody = document.createElement('div');
    catBody.dataset.catBody = cat.id;
    catBody.style.display = ci > 2 ? 'none' : 'block'; // collapse all after first 3

    catLabel.addEventListener('click', function() {
      var body = _panel.querySelector('[data-cat-body="' + this.dataset.catId + '"]');
      if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
    });

    _panel.appendChild(catLabel);

    for (var ai = 0; ai < catAssets.length; ai++) {
      var asset = catAssets[ai];
      var btn = document.createElement('button');
      btn.style.cssText = 'display:block;width:100%;padding:5px 8px;margin:1px 0;background:rgba(48,54,61,0.6);border:1px solid transparent;border-radius:5px;color:#c9d1d9;font-size:11px;cursor:pointer;text-align:left;transition:all 0.15s;';
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
        var btns = _panel.querySelectorAll('button[data-asset-id]');
        for (var b = 0; b < btns.length; b++) {
          btns[b].style.background = 'rgba(48,54,61,0.6)'; btns[b].style.borderColor = 'transparent';
        }
        this.style.background = 'rgba(88,166,255,0.3)'; this.style.borderColor = '#58a6ff';
      });
      catBody.appendChild(btn);
    }
    _panel.appendChild(catBody);
  }

  var target = document.fullscreenElement || document.body;
  target.appendChild(_panel);
}

function hidePanel() {
  if (_panel) {
    if (_panel._dragMove) document.removeEventListener('mousemove', _panel._dragMove);
    if (_panel._dragUp) document.removeEventListener('mouseup', _panel._dragUp);
    if (_panel.parentElement) _panel.remove();
  }
  _panel = null;
}

// ===================== EVENT LISTENERS =====================

var _onMouseMove = null, _onMouseDown = null, _onContextMenu = null, _onKeyDown = null;

function addListeners() {
  _onMouseMove = function(e) { updateGhostPosition(e); };

  _onMouseDown = function(e) {
    if (!_active) return;
    if (_panel && _panel.contains(e.target)) return;

    if (e.button === 0) {
      if (_selectedAsset && _ghostMesh) {
        placeAsset(e);
      } else {
        _selectCampusAt(e);
      }
    }
  };

  _onContextMenu = function(e) {
    if (!_active) return;
    e.preventDefault();
    deleteAtCursor(e);
  };

  _onKeyDown = function(e) {
    if (!_active) return;
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.code === 'KeyR') {
      if (_selectedCampusObj && !_selectedAsset) {
        _rotateSelected();
      } else {
        _rotation = (_rotation + Math.PI / 2) % (Math.PI * 2);
        if (_ghostMesh) _ghostMesh.rotation.y = _rotation;
      }
    }

    if (e.code === 'KeyG' && _selectedCampusObj) {
      _grabMode = !_grabMode;
    }

    if (e.code === 'Escape') {
      _deselectCampus();
      _selectedAsset = null;
      removeGhost();
    }

    if (e.code === 'Delete' && _selectedCampusObj) {
      if (_selectedCampusObj.userData._campusId) {
        _deleteCampusObject(_selectedCampusObj);
      } else if (_selectedCampusObj.userData.placementId) {
        _deletePlacedObject(_selectedCampusObj.userData.placementId);
      }
    }

    // Arrow keys: move selected object by grid
    if (_selectedCampusObj) {
      var step = GRID_SIZE;
      if (e.code === 'ArrowLeft')  { _moveSelected(-step, 0); e.preventDefault(); }
      if (e.code === 'ArrowRight') { _moveSelected(step, 0); e.preventDefault(); }
      if (e.code === 'ArrowUp')    { _moveSelected(0, -step); e.preventDefault(); }
      if (e.code === 'ArrowDown')  { _moveSelected(0, step); e.preventDefault(); }
    }

    // Undo: Ctrl+Z
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
      e.preventDefault();
      doUndo();
    }
    // Redo: Ctrl+Shift+Z or Ctrl+Y
    if ((e.code === 'KeyZ' && (e.ctrlKey || e.metaKey) && e.shiftKey) ||
        (e.code === 'KeyY' && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      doRedo();
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
  _clearRenderedPlacements();
  _undoStack = [];
  _redoStack = [];
}
