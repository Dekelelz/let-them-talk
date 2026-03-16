import * as THREE from 'three';
import { DEFAULT_APPEARANCE, AGENT_PALETTES } from './constants.js';

// Deterministic appearance resolution from agent name + stored appearance
export function resolveAppearance(name, appearance) {
  var app = appearance || {};
  var h = 0;
  for (var i = 0; i < name.length; i++) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
  h = Math.abs(h);
  var palette = AGENT_PALETTES[h % AGENT_PALETTES.length];

  // Accessory pools — deterministic based on name hash
  var glassesPool = [null, null, null, 'round', 'square', 'sunglasses', null, null];
  var headwearPool = [null, null, null, null, 'headphones', 'beanie', 'cap', null, null, 'headband'];
  var neckwearPool = [null, null, null, 'tie', 'bowtie', 'lanyard', null, null];
  var accColorPool = ['#555555', '#8B4513', '#333333', '#c0392b', '#1a5276', '#7d3c98', '#2e4053'];

  // Outfit and body type pools
  var outfitPool = [null, null, null, null, 'hoodie', 'suit', 'jacket', 'vest', null, null, 'labcoat', null];
  var bodyTypePool = ['default', 'default', 'default', 'stocky', 'slim', 'default', 'default'];
  var eyePool = ['dots', 'dots', 'anime', 'confident', 'happy', 'dots', 'wink', 'dots'];
  var mouthPool = ['smile', 'smile', 'neutral', 'grin', 'smile', 'smirk', 'smile'];

  var resolved = {
    head_color: app.head_color || DEFAULT_APPEARANCE.head_color,
    hair_style: app.hair_style || ['short', 'spiky', 'bob', 'ponytail', 'curly', 'afro', 'bun', 'braids', 'mohawk', 'wavy', 'long'][h % 11],
    hair_color: app.hair_color || palette.hair_color,
    eye_style: app.eye_style || eyePool[h % eyePool.length],
    mouth_style: app.mouth_style || mouthPool[(h >> 2) % mouthPool.length],
    shirt_color: app.shirt_color || palette.shirt_color,
    pants_color: app.pants_color || palette.pants_color,
    shoe_color: app.shoe_color || DEFAULT_APPEARANCE.shoe_color,
    glasses: app.glasses !== undefined ? app.glasses : glassesPool[(h >> 3) % glassesPool.length],
    glasses_color: app.glasses_color || accColorPool[(h >> 4) % accColorPool.length],
    headwear: app.headwear !== undefined ? app.headwear : headwearPool[(h >> 5) % headwearPool.length],
    headwear_color: app.headwear_color || accColorPool[(h >> 6) % accColorPool.length],
    neckwear: app.neckwear !== undefined ? app.neckwear : neckwearPool[(h >> 7) % neckwearPool.length],
    neckwear_color: app.neckwear_color || accColorPool[(h >> 8) % accColorPool.length],
    outfit: app.outfit !== undefined ? app.outfit : outfitPool[(h >> 9) % outfitPool.length],
    body_type: app.body_type || bodyTypePool[(h >> 10) % bodyTypePool.length],
  };

  // Add Three.js hex values
  resolved.head_hex = new THREE.Color(resolved.head_color).getHex();
  resolved.shirt_hex = new THREE.Color(resolved.shirt_color).getHex();
  resolved.pants_hex = new THREE.Color(resolved.pants_color).getHex();
  resolved.shoe_hex = new THREE.Color(resolved.shoe_color).getHex();
  resolved.hair_hex = new THREE.Color(resolved.hair_color).getHex();

  return resolved;
}

// Expose for legacy callers (profile editor, 2D compat)
window.officeGetAppearance = function(agent) {
  return resolveAppearance(agent.displayName || 'agent', agent.appearance || {});
};
