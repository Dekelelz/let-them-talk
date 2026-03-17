// Asset registry for the World Builder
// Each asset is a factory function that returns a THREE.Group
import * as THREE from 'three';

// ===================== ASSET DEFINITIONS =====================
// Each asset: { name, category, icon, width, depth, height, factory }
// width/depth are footprint in grid units (for snap), height is visual

export const ASSET_CATEGORIES = [
  { id: 'structural', label: 'Structural', icon: 'S' },
  { id: 'furniture',  label: 'Furniture',  icon: 'F' },
  { id: 'decor',      label: 'Decor',      icon: 'D' },
  { id: 'tech',       label: 'Tech',       icon: 'T' },
  { id: 'lighting',   label: 'Lighting',   icon: 'L' },
];

var _matCache = {};
function mat(color, opts) {
  var key = color + JSON.stringify(opts || {});
  if (!_matCache[key]) {
    _matCache[key] = new THREE.MeshStandardMaterial(Object.assign({ color: color }, opts || {}));
  }
  return _matCache[key];
}

export const ASSETS = [
  // ===== STRUCTURAL =====
  {
    id: 'wall',
    name: 'Wall',
    category: 'structural',
    icon: 'W',
    gridW: 2, gridD: 1, height: 3,
    factory: function() {
      var g = new THREE.Group();
      var wall = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.12), mat(0x2a2d35, { roughness: 0.8 }));
      wall.position.y = 1.5;
      wall.castShadow = true; wall.receiveShadow = true;
      g.add(wall);
      return g;
    }
  },
  {
    id: 'glass_wall',
    name: 'Glass Wall',
    category: 'structural',
    icon: 'G',
    gridW: 2, gridD: 1, height: 3,
    factory: function() {
      var g = new THREE.Group();
      var glass = new THREE.Mesh(new THREE.BoxGeometry(2, 3, 0.06), mat(0xaaccee, { transparent: true, opacity: 0.25, roughness: 0.05 }));
      glass.position.y = 1.5;
      g.add(glass);
      // Chrome frame top
      var frame = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.04, 0.08), mat(0xcccccc, { metalness: 0.8, roughness: 0.2 }));
      frame.position.y = 3;
      g.add(frame);
      return g;
    }
  },
  {
    id: 'floor_tile',
    name: 'Floor Tile',
    category: 'structural',
    icon: '\u2B1B',
    gridW: 2, gridD: 2, height: 0.02,
    factory: function() {
      var g = new THREE.Group();
      var tile = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 2), mat(0x3a3d45, { roughness: 0.85 }));
      tile.position.y = 0.01;
      tile.receiveShadow = true;
      g.add(tile);
      return g;
    }
  },
  {
    id: 'window',
    name: 'Window',
    category: 'structural',
    icon: 'G',
    gridW: 2, gridD: 1, height: 2,
    factory: function() {
      var g = new THREE.Group();
      var glass = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 2), mat(0x87CEEB, { emissive: 0x87CEEB, emissiveIntensity: 0.15, transparent: true, opacity: 0.6 }));
      glass.position.y = 2;
      g.add(glass);
      // Frame
      var frameM = mat(0xcccccc, { metalness: 0.8, roughness: 0.2 });
      var top = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.04), frameM);
      top.position.y = 3; g.add(top);
      var bot = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.04), frameM);
      bot.position.y = 1; g.add(bot);
      return g;
    }
  },
  {
    id: 'door',
    name: 'Door',
    category: 'structural',
    icon: 'Dr',
    gridW: 1, gridD: 1, height: 2.5,
    factory: function() {
      var g = new THREE.Group();
      var door = new THREE.Mesh(new THREE.BoxGeometry(1, 2.5, 0.08), mat(0x5c3a1e, { roughness: 0.6 }));
      door.position.y = 1.25;
      door.castShadow = true;
      g.add(door);
      // Handle
      var handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.06), mat(0xcccccc, { metalness: 0.8 }));
      handle.position.set(0.35, 1.1, 0.06);
      g.add(handle);
      return g;
    }
  },

  // ===== FURNITURE =====
  {
    id: 'desk',
    name: 'Desk',
    category: 'furniture',
    icon: 'Dk',
    gridW: 2, gridD: 1, height: 0.8,
    factory: function() {
      var g = new THREE.Group();
      var deskMat = mat(0x1a1a2e, { roughness: 0.3, metalness: 0.1 });
      var legMat = mat(0x111111, { roughness: 0.4, metalness: 0.2 });
      // Top
      var top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.05, 0.9), deskMat);
      top.position.y = 0.76; top.castShadow = true;
      g.add(top);
      // Legs
      var positions = [[-0.85, -0.35], [-0.85, 0.35], [0.85, -0.35], [0.85, 0.35]];
      for (var i = 0; i < 4; i++) {
        var leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.76, 0.06), legMat);
        leg.position.set(positions[i][0], 0.38, positions[i][1]);
        g.add(leg);
      }
      return g;
    }
  },
  {
    id: 'chair',
    name: 'Chair',
    category: 'furniture',
    icon: 'Ch',
    gridW: 1, gridD: 1, height: 1.1,
    factory: function() {
      var g = new THREE.Group();
      var seatM = mat(0x333340, { roughness: 0.65 });
      var chromeM = mat(0x888888, { metalness: 0.6, roughness: 0.3 });
      // Seat
      var seat = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.4), seatM);
      seat.position.y = 0.45; g.add(seat);
      // Back
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.4, 0.04), seatM);
      back.position.set(0, 0.7, 0.18); g.add(back);
      // Post
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.4, 6), chromeM);
      post.position.y = 0.22; g.add(post);
      // Base
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.03, 12), chromeM);
      base.position.y = 0.02; g.add(base);
      return g;
    }
  },
  {
    id: 'sofa',
    name: 'Sofa',
    category: 'furniture',
    icon: 'So',
    gridW: 3, gridD: 1, height: 0.9,
    factory: function() {
      var g = new THREE.Group();
      var sofaM = mat(0x2a2a3e, { roughness: 0.75 });
      // Base
      var base = new THREE.Mesh(new THREE.BoxGeometry(3, 0.35, 0.9), sofaM);
      base.position.y = 0.2; g.add(base);
      // Back
      var back = new THREE.Mesh(new THREE.BoxGeometry(3, 0.5, 0.2), sofaM);
      back.position.set(0, 0.55, -0.35); g.add(back);
      // Arms
      var armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.9), sofaM);
      armL.position.set(-1.4, 0.4, 0); g.add(armL);
      var armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.3, 0.9), sofaM);
      armR.position.set(1.4, 0.4, 0); g.add(armR);
      return g;
    }
  },
  {
    id: 'bookshelf',
    name: 'Bookshelf',
    category: 'furniture',
    icon: 'Bk',
    gridW: 1, gridD: 1, height: 2.2,
    factory: function() {
      var g = new THREE.Group();
      var woodM = mat(0x5a3e28, { roughness: 0.7 });
      // Back
      var back = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.2, 1.2), woodM);
      back.position.y = 1.1; g.add(back);
      // Sides
      var sideL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.04), woodM);
      sideL.position.set(0.14, 1.1, -0.58); g.add(sideL);
      var sideR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 2.2, 0.04), woodM);
      sideR.position.set(0.14, 1.1, 0.58); g.add(sideR);
      // Shelves
      for (var i = 0; i < 5; i++) {
        var shelf = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.04, 1.2), woodM);
        shelf.position.set(0.14, 0.05 + i * 0.55, 0);
        g.add(shelf);
      }
      return g;
    }
  },
  {
    id: 'coffee_table',
    name: 'Coffee Table',
    category: 'furniture',
    icon: '\u2615',
    gridW: 1, gridD: 1, height: 0.45,
    factory: function() {
      var g = new THREE.Group();
      var glassM = mat(0xccddee, { transparent: true, opacity: 0.35, roughness: 0.05 });
      var chromeM = mat(0xcccccc, { metalness: 0.8, roughness: 0.2 });
      var top = new THREE.Mesh(new THREE.BoxGeometry(1, 0.03, 0.5), glassM);
      top.position.y = 0.45; g.add(top);
      for (var i = 0; i < 4; i++) {
        var leg = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.42, 6), chromeM);
        leg.position.set(((i & 1) ? 0.4 : -0.4), 0.21, ((i & 2) ? 0.2 : -0.2));
        g.add(leg);
      }
      return g;
    }
  },
  {
    id: 'bar_stool',
    name: 'Bar Stool',
    category: 'furniture',
    icon: 'Ch',
    gridW: 1, gridD: 1, height: 0.8,
    factory: function() {
      var g = new THREE.Group();
      var seatM = mat(0x333340, { roughness: 0.65 });
      var chromeM = mat(0x888888, { metalness: 0.6, roughness: 0.3 });
      var seat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.06, 12), seatM);
      seat.position.y = 0.75; g.add(seat);
      var post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.7, 8), chromeM);
      post.position.y = 0.38; g.add(post);
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.04, 12), chromeM);
      base.position.y = 0.04; g.add(base);
      return g;
    }
  },

  // ===== DECOR =====
  {
    id: 'plant',
    name: 'Plant',
    category: 'decor',
    icon: 'Pl',
    gridW: 1, gridD: 1, height: 0.8,
    factory: function() {
      var g = new THREE.Group();
      var potM = mat(0x4a4a5a, { roughness: 0.8 });
      var leafM = mat(0x2d8a4e, { roughness: 0.8 });
      var pot = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.2, 0.5, 12), potM);
      pot.position.y = 0.25; g.add(pot);
      for (var i = 0; i < 5; i++) {
        var angle = (i / 5) * Math.PI * 2;
        var leaf = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), leafM);
        leaf.position.set(Math.cos(angle) * 0.12, 0.6, Math.sin(angle) * 0.12);
        leaf.scale.set(1, 0.7, 1);
        g.add(leaf);
      }
      var topLeaf = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), leafM);
      topLeaf.position.y = 0.75; g.add(topLeaf);
      return g;
    }
  },
  {
    id: 'indoor_tree',
    name: 'Indoor Tree',
    category: 'decor',
    icon: 'Tr',
    gridW: 1, gridD: 1, height: 3.5,
    factory: function() {
      var g = new THREE.Group();
      var planterM = mat(0x3a3a4a, { roughness: 0.8 });
      var trunkM = mat(0x5c3a1e, { roughness: 0.8 });
      var leafM = mat(0x228B22, { roughness: 0.7 });
      var planter = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.35, 0.6, 12), planterM);
      planter.position.y = 0.3; g.add(planter);
      var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 2.5, 8), trunkM);
      trunk.position.y = 1.85; g.add(trunk);
      var sizes = [0.6, 0.5, 0.35];
      var ys = [2.8, 3.2, 3.5];
      for (var i = 0; i < 3; i++) {
        var canopy = new THREE.Mesh(new THREE.SphereGeometry(sizes[i], 12, 10), leafM);
        canopy.position.y = ys[i]; g.add(canopy);
      }
      return g;
    }
  },
  {
    id: 'beanbag',
    name: 'Beanbag',
    category: 'decor',
    icon: 'So',
    gridW: 1, gridD: 1, height: 0.5,
    factory: function() {
      var g = new THREE.Group();
      var colors = [0xe53e3e, 0x3b82f6, 0x22c55e, 0xa855f7];
      var color = colors[Math.floor(Math.random() * colors.length)];
      var botM = mat(color, { roughness: 0.9 });
      var bot = new THREE.Mesh(new THREE.SphereGeometry(0.4, 16, 12), botM);
      bot.position.y = 0.2; bot.scale.set(1, 0.5, 1); g.add(bot);
      var darkColor = (color & 0xfefefe) >> 1; // darken
      var topM = new THREE.MeshStandardMaterial({ color: darkColor, roughness: 0.9 });
      var topBag = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 12), topM);
      topBag.position.set(-0.05, 0.4, 0); topBag.scale.set(1, 0.6, 1); g.add(topBag);
      return g;
    }
  },

  // ===== TECH =====
  {
    id: 'monitor',
    name: 'Monitor',
    category: 'tech',
    icon: 'Mo',
    gridW: 1, gridD: 1, height: 0.5,
    factory: function() {
      var g = new THREE.Group();
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.04), mat(0x1a1a2e, { roughness: 0.3 }));
      body.position.y = 0.35; g.add(body);
      var screen = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.28), mat(0x333333, { emissive: 0x111122, emissiveIntensity: 0.3 }));
      screen.position.set(0, 0.35, 0.025); g.add(screen);
      var stand = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, 0.06), mat(0x4a5568, { roughness: 0.7 }));
      stand.position.y = 0.09; g.add(stand);
      return g;
    }
  },
  {
    id: 'pc_tower',
    name: 'PC Tower',
    category: 'tech',
    icon: 'PC',
    gridW: 1, gridD: 1, height: 0.45,
    factory: function() {
      var g = new THREE.Group();
      var caseMesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.45, 0.45), mat(0x111111, { roughness: 0.4 }));
      caseMesh.position.y = 0.23; g.add(caseMesh);
      var panel = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 0.4), mat(0x58a6ff, { emissive: 0x58a6ff, emissiveIntensity: 0.3, transparent: true, opacity: 0.4 }));
      panel.position.set(0.115, 0.23, 0); panel.rotation.y = Math.PI / 2; g.add(panel);
      return g;
    }
  },

  // ===== LIGHTING =====
  {
    id: 'floor_lamp',
    name: 'Floor Lamp',
    category: 'lighting',
    icon: 'Lt',
    gridW: 1, gridD: 1, height: 1.8,
    factory: function() {
      var g = new THREE.Group();
      var metalM = mat(0x333333, { metalness: 0.3, roughness: 0.5 });
      var base = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.18, 0.04, 12), metalM);
      base.position.y = 0.02; g.add(base);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), metalM);
      pole.position.y = 0.84; g.add(pole);
      var shade = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.25, 12, 1, true), mat(0xddd5c0, { roughness: 0.8, side: THREE.DoubleSide }));
      shade.position.y = 1.72; shade.rotation.x = Math.PI; g.add(shade);
      var light = new THREE.PointLight(0xffeedd, 0.3, 4);
      light.position.y = 1.6; g.add(light);
      return g;
    }
  },
  {
    id: 'pendant_light',
    name: 'Pendant Light',
    category: 'lighting',
    icon: 'Lt',
    gridW: 1, gridD: 1, height: 2,
    factory: function() {
      var g = new THREE.Group();
      var wire = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.5, 4), mat(0x333333, { roughness: 0.5 }));
      wire.position.y = 2.25; g.add(wire);
      var shade = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), mat(0xffeedd, { emissive: 0xffeedd, emissiveIntensity: 0.4, transparent: true, opacity: 0.8 }));
      shade.position.y = 1.5; g.add(shade);
      var light = new THREE.PointLight(0xffeedd, 0.25, 6);
      light.position.y = 1.4; g.add(light);
      return g;
    }
  },
];

// Get asset by ID
export function getAsset(id) {
  for (var i = 0; i < ASSETS.length; i++) {
    if (ASSETS[i].id === id) return ASSETS[i];
  }
  return null;
}

// Get assets by category
export function getAssetsByCategory(cat) {
  return ASSETS.filter(function(a) { return a.category === cat; });
}

// Create a ghost (transparent preview) of an asset
export function createGhost(assetId) {
  var asset = getAsset(assetId);
  if (!asset) return null;
  var group = asset.factory();
  // Make all children transparent green
  group.traverse(function(child) {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0x44ff88,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
      });
    }
  });
  group.userData.isGhost = true;
  group.userData.assetId = assetId;
  return group;
}
