// Shared material cache for all assets — prevents duplicate materials
import * as THREE from 'three';

var _cache = {};

export function mat(color, opts) {
  var key = color + JSON.stringify(opts || {});
  if (!_cache[key]) {
    _cache[key] = new THREE.MeshStandardMaterial(Object.assign({ color: color }, opts || {}));
  }
  return _cache[key];
}

// Pre-defined palette shortcuts
export var PAL = {
  marbleBlack:    function() { return mat(0x1a1c22, { roughness: 0.12, metalness: 0.05 }); },
  marbleWhite:    function() { return mat(0xf0ece4, { roughness: 0.15, metalness: 0.05 }); },
  walnutDark:     function() { return mat(0x3a2210, { roughness: 0.55 }); },
  walnutLight:    function() { return mat(0x8B5E3C, { roughness: 0.50 }); },
  chrome:         function() { return mat(0xd0d0d0, { roughness: 0.08, metalness: 0.85 }); },
  chromeBrushed:  function() { return mat(0x999999, { roughness: 0.25, metalness: 0.70 }); },
  glass:          function() { return mat(0xaaccee, { transparent: true, opacity: 0.25, roughness: 0.05, side: THREE.DoubleSide }); },
  glassFrosted:   function() { return mat(0xd0d8e8, { transparent: true, opacity: 0.50, roughness: 0.40, side: THREE.DoubleSide }); },
  concrete:       function() { return mat(0x2a2d35, { roughness: 0.85 }); },
  leatherBlack:   function() { return mat(0x1a1a1a, { roughness: 0.70 }); },
  leatherCognac:  function() { return mat(0x8B4513, { roughness: 0.65 }); },
  gold:           function() { return mat(0xd4af37, { roughness: 0.30, metalness: 0.70 }); },
  darkMetal:      function() { return mat(0x111111, { roughness: 0.40, metalness: 0.20 }); },
  fabric:         function() { return mat(0x2a2d3a, { roughness: 0.95 }); },
  rubber:         function() { return mat(0x2a2a2a, { roughness: 0.95 }); },
  greenFelt:      function() { return mat(0x006633, { roughness: 0.90 }); },
  leaf:           function() { return mat(0x2d8a4e, { roughness: 0.80 }); },
  neonBlue:       function() { return mat(0x58a6ff, { emissive: 0x58a6ff, emissiveIntensity: 0.6 }); },
  neonPurple:     function() { return mat(0xa855f7, { emissive: 0xa855f7, emissiveIntensity: 0.5 }); },
  neonGreen:      function() { return mat(0x22c55e, { emissive: 0x22c55e, emissiveIntensity: 0.5 }); },
  neonRed:        function() { return mat(0xef4444, { emissive: 0xef4444, emissiveIntensity: 0.5 }); },
  neonCyan:       function() { return mat(0x06b6d4, { emissive: 0x06b6d4, emissiveIntensity: 0.6 }); },
  warmLight:      function() { return mat(0xffeedd, { emissive: 0xffeedd, emissiveIntensity: 0.4, transparent: true, opacity: 0.8 }); },
  screen:         function() { return mat(0x333333, { emissive: 0x111122, emissiveIntensity: 0.3 }); },
};
