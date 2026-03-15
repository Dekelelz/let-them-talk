// Mod loader — loads and validates GLB/GLTF community mods + built-in procedural items.
// GLB files contain ONLY geometry/textures/animations — NO executable code.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Type limits for validation
const TYPE_LIMITS = {
  accessory:   { maxPolys: 500,   maxBytes: 200 * 1024 },
  hairstyle:   { maxPolys: 800,   maxBytes: 300 * 1024 },
  outfit:      { maxPolys: 1500,  maxBytes: 500 * 1024 },
  character:   { maxPolys: 3000,  maxBytes: 1024 * 1024 },
  environment: { maxPolys: 10000, maxBytes: 2 * 1024 * 1024 },
};

// Manifest schema validation
const REQUIRED_FIELDS = ['id', 'name', 'version', 'author', 'type', 'category'];
const VALID_TYPES = ['accessory', 'hairstyle', 'outfit', 'character', 'environment'];
const ID_PATTERN = /^[a-z0-9_-]{1,40}$/;

// GLB magic bytes: 0x46546C67 ("glTF" in ASCII)
const GLB_MAGIC = 0x46546C67;

const modRegistry = {};
const loadedModels = {};
let builtInItems = [];

// Load built-in procedural item manifests
export async function loadBuiltInManifests() {
  try {
    var resp = await fetch('/mods/built-in-accessories.json');
    if (resp.ok) {
      builtInItems = await resp.json();
      builtInItems.forEach(function(item) {
        modRegistry[item.id] = item;
      });
    }
  } catch (e) {
    console.warn('Could not load built-in mod manifests:', e);
  }
}

export function getInstalledMods() {
  return Object.values(modRegistry);
}

export function getModsByCategory(category) {
  return Object.values(modRegistry).filter(function(m) { return m.category === category; });
}

export function getModsByType(type) {
  return Object.values(modRegistry).filter(function(m) { return m.type === type; });
}

export function isModInstalled(id) {
  return !!modRegistry[id];
}

export function getMod(id) {
  return modRegistry[id] || null;
}

// Validate manifest JSON
export function validateManifest(manifest) {
  var errors = [];

  // Required fields
  for (var i = 0; i < REQUIRED_FIELDS.length; i++) {
    if (!manifest[REQUIRED_FIELDS[i]]) {
      errors.push('Missing required field: ' + REQUIRED_FIELDS[i]);
    }
  }

  // ID format
  if (manifest.id && !ID_PATTERN.test(manifest.id)) {
    errors.push('Invalid id format: must be 1-40 chars of a-z, 0-9, _, -');
  }

  // Type
  if (manifest.type && !VALID_TYPES.includes(manifest.type)) {
    errors.push('Invalid type: must be one of ' + VALID_TYPES.join(', '));
  }

  // ID collision
  if (manifest.id && modRegistry[manifest.id]) {
    errors.push('ID collision: "' + manifest.id + '" already exists');
  }

  // Asset definition
  if (!manifest.asset || !manifest.asset.format) {
    errors.push('Missing asset definition');
  } else if (!['glb', 'gltf', 'procedural'].includes(manifest.asset.format)) {
    errors.push('Invalid asset format: must be glb, gltf, or procedural');
  }

  return { valid: errors.length === 0, errors: errors };
}

// Validate GLB binary data (client-side, called after loading)
export function validateGLBBytes(arrayBuffer) {
  if (arrayBuffer.byteLength < 12) {
    return { valid: false, error: 'File too small to be a valid GLB' };
  }

  var view = new DataView(arrayBuffer);
  var magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    return { valid: false, error: 'Invalid GLB magic bytes (not a GLB file)' };
  }

  var version = view.getUint32(4, true);
  if (version !== 2) {
    return { valid: false, error: 'Unsupported GLB version: ' + version + ' (expected 2)' };
  }

  return { valid: true };
}

// Count polygons in a loaded GLTF scene
export function countPolygons(gltfScene) {
  var totalPolys = 0;
  gltfScene.traverse(function(child) {
    if (child.isMesh && child.geometry) {
      var geo = child.geometry;
      if (geo.index) {
        totalPolys += geo.index.count / 3;
      } else if (geo.attributes.position) {
        totalPolys += geo.attributes.position.count / 3;
      }
    }
  });
  return Math.floor(totalPolys);
}

// Check bounding box fits expected dimensions
export function checkBoundingBox(gltfScene, maxDim) {
  var box = new THREE.Box3().setFromObject(gltfScene);
  var size = box.getSize(new THREE.Vector3());
  var max = Math.max(size.x, size.y, size.z);
  if (max > maxDim) {
    return { valid: false, error: 'Model too large: ' + max.toFixed(2) + ' > ' + maxDim + ' max dimension' };
  }
  return { valid: true, size: size };
}

// Sanitize materials (cap emissive, force roughness minimum)
export function sanitizeMaterials(gltfScene) {
  gltfScene.traverse(function(child) {
    if (child.isMesh && child.material) {
      var mats = Array.isArray(child.material) ? child.material : [child.material];
      mats.forEach(function(mat) {
        if (mat.emissiveIntensity > 2) mat.emissiveIntensity = 2;
        if (mat.roughness !== undefined && mat.roughness < 0.1) mat.roughness = 0.1;
      });
    }
  });
}

// Load a GLB mod and validate it
export async function loadGLBMod(manifest) {
  if (manifest.asset.format !== 'glb' || !manifest.asset.file) {
    return { success: false, error: 'Not a GLB mod or missing file path' };
  }

  var limits = TYPE_LIMITS[manifest.type] || TYPE_LIMITS.accessory;
  var url = '/mods/' + manifest.id + '/' + manifest.asset.file;

  try {
    // Fetch raw bytes for magic check
    var resp = await fetch(url);
    if (!resp.ok) throw new Error('Failed to fetch: ' + resp.status);
    var buffer = await resp.arrayBuffer();

    // Size check
    if (buffer.byteLength > limits.maxBytes) {
      return { success: false, error: 'File too large: ' + (buffer.byteLength / 1024).toFixed(0) + 'KB > ' + (limits.maxBytes / 1024) + 'KB limit' };
    }

    // Magic bytes check
    var bytesCheck = validateGLBBytes(buffer);
    if (!bytesCheck.valid) return { success: false, error: bytesCheck.error };

    // Parse with Three.js GLTFLoader
    var loader = new GLTFLoader();
    var gltf = await new Promise(function(resolve, reject) {
      loader.parse(buffer, '', resolve, reject);
    });

    // Poly count check
    var polyCount = countPolygons(gltf.scene);
    if (polyCount > limits.maxPolys) {
      return { success: false, error: 'Too many polygons: ' + polyCount + ' > ' + limits.maxPolys + ' limit' };
    }

    // Bounding box check (max dimension based on type)
    var maxDims = { accessory: 1, hairstyle: 1, outfit: 2, character: 3, environment: 30 };
    var bbCheck = checkBoundingBox(gltf.scene, maxDims[manifest.type] || 1);
    if (!bbCheck.valid) return { success: false, error: bbCheck.error };

    // Sanitize materials
    sanitizeMaterials(gltf.scene);

    // Store loaded model
    loadedModels[manifest.id] = gltf;

    return { success: true, gltf: gltf, polyCount: polyCount, size: bbCheck.size };
  } catch (e) {
    return { success: false, error: 'Failed to load GLB: ' + e.message };
  }
}

// Get a loaded GLB model's scene (clone for instancing)
export function getModModel(id) {
  if (!loadedModels[id]) return null;
  return loadedModels[id].scene.clone();
}

// Register a mod into the registry
export function registerMod(manifest) {
  modRegistry[manifest.id] = manifest;
}

// Unregister a mod
export function unregisterMod(id) {
  delete modRegistry[id];
  if (loadedModels[id]) {
    // Dispose loaded model
    loadedModels[id].scene.traverse(function(child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach(function(m) { m.dispose(); });
        else child.material.dispose();
      }
    });
    delete loadedModels[id];
  }
}

// Initialize: load registry + built-in manifests
export async function initModSystem() {
  await loadBuiltInManifests();

  // Load community registry
  try {
    var resp = await fetch('/api/mods');
    if (resp.ok) {
      var data = await resp.json();
      var mods = data.mods || {};
      for (var id in mods) {
        if (!modRegistry[id]) {
          modRegistry[id] = mods[id];
        }
      }
    }
  } catch (e) {
    console.warn('Could not load mod registry:', e);
  }
}
