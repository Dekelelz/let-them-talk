import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { S } from './state.js';

// ============================================================
// ECONOMY UI — 3D upgrade shop, credit display, visual upgrades
// Phase 3: In-world economy visualization
// ============================================================

var shopBuilding = null;
var creditDisplay = null;
var upgradeEffects = {};
var currentBalance = 0;

// ============================================================
// CREDIT BALANCE DISPLAY — always visible in city
// ============================================================

export function createCreditDisplay() {
  if (creditDisplay) return;

  var div = document.createElement('div');
  div.id = 'city-credits';
  div.style.cssText = 'position:absolute;top:12px;right:12px;z-index:1000;' +
    'background:linear-gradient(135deg,rgba(30,30,40,0.9),rgba(20,20,30,0.95));' +
    'border:1px solid rgba(212,175,55,0.4);border-radius:12px;padding:8px 16px;' +
    'font-family:monospace;color:#d4af37;font-size:16px;font-weight:bold;' +
    'display:flex;align-items:center;gap:8px;backdrop-filter:blur(8px);' +
    'box-shadow:0 4px 12px rgba(0,0,0,0.4);pointer-events:none;';

  var icon = document.createElement('span');
  icon.textContent = '\u26A1'; // lightning bolt as credit icon
  icon.style.fontSize = '20px';
  div.appendChild(icon);

  var amount = document.createElement('span');
  amount.id = 'city-credit-amount';
  amount.textContent = '0';
  amount.style.fontVariantNumeric = 'tabular-nums';
  div.appendChild(amount);

  var label = document.createElement('span');
  label.textContent = 'credits';
  label.style.cssText = 'color:rgba(212,175,55,0.6);font-size:10px;text-transform:uppercase;letter-spacing:1px;';
  div.appendChild(label);

  var container = S.container || document.getElementById('office-3d-container');
  if (container) container.appendChild(div);
  creditDisplay = div;
}

export function updateCreditBalance(balance) {
  currentBalance = balance;
  var el = document.getElementById('city-credit-amount');
  if (el) {
    // Animate count up/down
    var current = parseInt(el.textContent) || 0;
    if (current !== balance) {
      var diff = balance - current;
      var steps = Math.min(Math.abs(diff), 20);
      var step = diff / steps;
      var i = 0;
      var interval = setInterval(function() {
        i++;
        var val = Math.round(current + step * i);
        el.textContent = val.toLocaleString();
        if (i >= steps) {
          el.textContent = balance.toLocaleString();
          clearInterval(interval);
        }
      }, 30);
    }
  }
}

export function getCreditBalance() { return currentBalance; }

// ============================================================
// UPGRADE SHOP — 3D building in the city
// ============================================================

export function buildUpgradeShop(x, z) {
  var group = new THREE.Group();

  // Shop building (distinctive gold/glass)
  var shopGeo = new THREE.BoxGeometry(8, 5, 8);
  var shopMat = new THREE.MeshStandardMaterial({
    color: 0x2a2a3a, roughness: 0.3, metalness: 0.2,
    emissive: 0xd4af37, emissiveIntensity: 0.15
  });
  var shop = new THREE.Mesh(shopGeo, shopMat);
  shop.position.set(x, 2.5, z);
  shop.castShadow = true;
  shop.matrixAutoUpdate = false;
  shop.updateMatrix();
  group.add(shop);

  // Gold accent roof
  var roofGeo = new THREE.ConeGeometry(6, 2, 4);
  var roofMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37, roughness: 0.3, metalness: 0.6,
    emissive: 0xd4af37, emissiveIntensity: 0.3
  });
  var roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(x, 6, z);
  roof.rotation.y = Math.PI / 4;
  roof.castShadow = true;
  roof.matrixAutoUpdate = false;
  roof.updateMatrix();
  group.add(roof);

  // Neon sign
  var signDiv = document.createElement('div');
  signDiv.textContent = '\u26A1 UPGRADE SHOP';
  signDiv.style.cssText = 'color:#ffd700;font-size:12px;font-weight:bold;' +
    'text-shadow:0 0 10px rgba(255,215,0,0.8),0 0 20px rgba(255,215,0,0.4);' +
    'font-family:monospace;letter-spacing:2px;';
  var signObj = new CSS2DObject(signDiv);
  signObj.position.set(x, 8, z);
  group.add(signObj);

  // Rotating crystal above shop
  var crystalGeo = new THREE.OctahedronGeometry(0.8);
  var crystalMat = new THREE.MeshStandardMaterial({
    color: 0xffd700, emissive: 0xffd700, emissiveIntensity: 0.6,
    transparent: true, opacity: 0.8, roughness: 0.1, metalness: 0.5
  });
  var crystal = new THREE.Mesh(crystalGeo, crystalMat);
  crystal.position.set(x, 9, z);
  group.add(crystal);

  // Store reference for animation
  group.userData.crystal = crystal;
  group.userData.shopPos = { x: x, z: z };

  S.furnitureGroup.add(group);
  shopBuilding = group;

  return group;
}

// ============================================================
// BUILDING UPGRADE EFFECTS — glow when upgraded
// ============================================================

export function applyUpgradeEffect(buildingData, level) {
  var key = buildingData.gridX + '_' + buildingData.gridZ;

  // Find the building mesh in the scene
  S.furnitureGroup.traverse(function(child) {
    if (child.isMesh && child.position &&
        Math.abs(child.position.x - buildingData.x) < 1 &&
        Math.abs(child.position.z - buildingData.z) < 1 &&
        child.position.y > 0) {

      // Increase emissive glow based on upgrade level
      if (child.material && child.material.emissiveIntensity !== undefined) {
        child.material.emissiveIntensity = 0.1 + level * 0.15;
        child.material.needsUpdate = true;
      }

      // Scale up slightly
      var scaleBonus = 1 + level * 0.05;
      child.scale.set(scaleBonus, scaleBonus, scaleBonus);
      child.updateMatrix();

      upgradeEffects[key] = { mesh: child, level: level };
    }
  });
}

// ============================================================
// SHOP ANIMATION — crystal rotation
// ============================================================

export function updateEconomyUI(dt) {
  if (shopBuilding && shopBuilding.userData.crystal) {
    var crystal = shopBuilding.userData.crystal;
    crystal.rotation.y += dt * 1.5;
    crystal.rotation.x += dt * 0.5;
    crystal.position.y = 9 + Math.sin(Date.now() * 0.002) * 0.3;
  }
}

// ============================================================
// FETCH & SYNC BALANCE
// ============================================================

var _balancePollInterval = null;

export function startBalancePolling(intervalMs) {
  intervalMs = intervalMs || 5000;
  if (_balancePollInterval) clearInterval(_balancePollInterval);

  function fetchBalance() {
    fetch('/api/city/economy')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data && typeof data.balance === 'number') {
          updateCreditBalance(data.balance);
        }
      })
      .catch(function() {}); // silent fail
  }

  fetchBalance();
  _balancePollInterval = setInterval(fetchBalance, intervalMs);
}

export function stopBalancePolling() {
  if (_balancePollInterval) {
    clearInterval(_balancePollInterval);
    _balancePollInterval = null;
  }
}

// ============================================================
// CLEANUP
// ============================================================

export function disposeEconomyUI() {
  stopBalancePolling();

  if (creditDisplay && creditDisplay.parentElement) {
    creditDisplay.parentElement.removeChild(creditDisplay);
    creditDisplay = null;
  }

  if (shopBuilding) {
    shopBuilding.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });
    shopBuilding = null;
  }

  upgradeEffects = {};
}
