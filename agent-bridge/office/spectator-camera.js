import * as THREE from 'three';

// Reusable Vector3s for onMouseMove (avoid per-frame allocation)
var _panRight = new THREE.Vector3();
var _panUp = new THREE.Vector3();

// Spectator / fly camera — Unreal Engine style free movement
// Left-drag: look around (rotate)
// Right-drag: pan (strafe)
// WASD: move forward/back/left/right
// Q/E: down/up
// Scroll: dolly forward/back
// Shift: fast move
// Middle-drag: also pan

export function SpectatorCamera(camera, domElement) {
  var self = this;
  self.camera = camera;
  self.domElement = domElement;
  self.enabled = true;

  // Movement
  self.moveSpeed = 4;
  self.fastMultiplier = 3;
  self.scrollSpeed = 2;
  self.lookSpeed = 0.003;
  self.panSpeed = 0.01;
  self.damping = 0.88;

  // Internal state
  var euler = new THREE.Euler(0, 0, 0, 'YXZ');
  var velocity = new THREE.Vector3();
  var moveDir = new THREE.Vector3();
  var keys = {};
  self.keys = keys; // expose for player mode
  var isLeftDrag = false;
  var isRightDrag = false;
  var isMiddleDrag = false;
  var lastMouse = { x: 0, y: 0 };

  // Initialize euler from camera
  euler.setFromQuaternion(camera.quaternion, 'YXZ');
  self._euler = euler; // expose for player mode camera orbit

  // --- Event handlers ---
  function onMouseDown(e) {
    // Allow mouse input in both spectator and player modes
    if (e.target !== domElement) return;
    // Take focus away from any text input so WASD works
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    if (e.button === 0) isLeftDrag = true;
    if (e.button === 2) isRightDrag = true;
    if (e.button === 1) isMiddleDrag = true;
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;
    e.preventDefault();
  }

  function onMouseUp(e) {
    if (e.button === 0) isLeftDrag = false;
    if (e.button === 2) isRightDrag = false;
    if (e.button === 1) isMiddleDrag = false;
  }

  function onMouseMove(e) {
    var dx = e.clientX - lastMouse.x;
    var dy = e.clientY - lastMouse.y;
    lastMouse.x = e.clientX;
    lastMouse.y = e.clientY;

    if (isRightDrag) {
      // Look around (rotate) — always update euler, but only apply to camera in spectator mode
      euler.y -= dx * self.lookSpeed;
      euler.x -= dy * self.lookSpeed;
      euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, euler.x));
      if (self.enabled) {
        camera.quaternion.setFromEuler(euler);
      }
      // In player mode, euler is read by player.js for orbit camera
    }

    if ((isLeftDrag || isMiddleDrag) && self.enabled) {
      // Pan (strafe) — only in spectator mode
      _panRight.setFromMatrixColumn(camera.matrixWorld, 0);
      _panUp.setFromMatrixColumn(camera.matrixWorld, 1);
      camera.position.addScaledVector(_panRight, -dx * self.panSpeed);
      camera.position.addScaledVector(_panUp, dy * self.panSpeed);
    }
  }

  function onWheel(e) {
    var rect = domElement.getBoundingClientRect();
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) return;
    e.preventDefault();
    if (self.enabled) {
      // Spectator mode: dolly forward/back
      var forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      var amount = -e.deltaY * 0.01 * self.scrollSpeed;
      camera.position.addScaledVector(forward, amount);
    } else if (self._playerZoomCb) {
      // Player mode: adjust orbit distance
      self._playerZoomCb(e.deltaY);
    }
  }

  function isTyping() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  function onKeyDown(e) {
    // Always track keys (player mode reads them) — only block when typing in inputs
    if (isTyping()) return;
    keys[e.code] = true;
  }

  function onKeyUp(e) {
    keys[e.code] = false;
  }

  function onContextMenu(e) {
    if (e.target === domElement) e.preventDefault();
  }

  // --- Public methods ---
  self.update = function(dt) {
    if (!self.enabled) return;

    var speed = self.moveSpeed * (keys['ShiftLeft'] || keys['ShiftRight'] ? self.fastMultiplier : 1);

    // Build movement direction in camera space
    moveDir.set(0, 0, 0);
    if (keys['KeyW'] || keys['ArrowUp']) moveDir.z -= 1;
    if (keys['KeyS'] || keys['ArrowDown']) moveDir.z += 1;
    if (keys['KeyA'] || keys['ArrowLeft']) moveDir.x -= 1;
    if (keys['KeyD'] || keys['ArrowRight']) moveDir.x += 1;
    if (keys['KeyE'] || keys['Space']) moveDir.y += 1;
    if (keys['KeyQ']) moveDir.y -= 1;

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      // Transform to world space using camera orientation
      var forward = new THREE.Vector3();
      var right = new THREE.Vector3();
      camera.getWorldDirection(forward);
      right.crossVectors(forward, camera.up).normalize();
      var worldUp = new THREE.Vector3(0, 1, 0);

      // Forward/back along camera look direction (projected on XZ for ground feel, or full 3D)
      velocity.addScaledVector(forward, -moveDir.z * speed * dt);
      velocity.addScaledVector(right, moveDir.x * speed * dt);
      velocity.addScaledVector(worldUp, moveDir.y * speed * dt);
    }

    // Apply velocity with damping
    camera.position.add(velocity);
    velocity.multiplyScalar(self.damping);

    // Kill tiny velocities
    if (velocity.lengthSq() < 0.0001) velocity.set(0, 0, 0);
  };

  self.dispose = function() {
    domElement.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('mousemove', onMouseMove);
    domElement.removeEventListener('wheel', onWheel);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    domElement.removeEventListener('contextmenu', onContextMenu);
  };

  // --- Bind events ---
  domElement.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('mousemove', onMouseMove);
  domElement.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  domElement.addEventListener('contextmenu', onContextMenu);
}
