// Asset Registry — auto-imports all individual asset files
// Each asset is a separate file for maintainability
import * as THREE from 'three';

// Categories
export var ASSET_CATEGORIES = [
  { id: 'structural',  label: 'Structural',  icon: 'ST' },
  { id: 'furniture',   label: 'Furniture',   icon: 'FN' },
  { id: 'office',      label: 'Office',      icon: 'OF' },
  { id: 'decor',       label: 'Decor',       icon: 'DC' },
  { id: 'nature',      label: 'Nature',      icon: 'NT' },
  { id: 'tech',        label: 'Tech',        icon: 'TC' },
  { id: 'lighting',    label: 'Lighting',    icon: 'LT' },
  { id: 'kitchen',     label: 'Kitchen',     icon: 'KT' },
  { id: 'recreation',  label: 'Recreation',  icon: 'RC' },
  { id: 'exterior',    label: 'Exterior',    icon: 'EX' },
];

// Import all asset modules
import wall from './wall.js';
import glass_wall from './glass-wall.js';
import half_wall from './half-wall.js';
import floor_tile from './floor-tile.js';
import marble_floor from './marble-floor.js';
import carpet_tile from './carpet-tile.js';
import door from './door.js';
import glass_door from './glass-door.js';
import archway from './archway.js';
import column from './column.js';

import desk from './desk.js';
import gaming_desk from './gaming-desk.js';
import chair from './chair.js';
import gaming_chair from './gaming-chair.js';
import sofa from './sofa.js';
import l_sofa from './l-sofa.js';
import coffee_table from './coffee-table.js';
import dining_table from './dining-table.js';

import filing_cabinet from './filing-cabinet.js';
import whiteboard from './whiteboard.js';
import meeting_table from './meeting-table.js';
import reception_desk from './reception-desk.js';
import printer from './printer.js';
import water_cooler from './water-cooler.js';

import painting from './painting.js';
import sculpture from './sculpture.js';
import rug from './rug.js';
import vase from './vase.js';
import trophy from './trophy.js';
import wall_clock from './wall-clock.js';

import plant from './plant.js';
import indoor_tree from './indoor-tree.js';
import palm_tree from './palm-tree.js';
import flower_pot from './flower-pot.js';
import hanging_plant from './hanging-plant.js';
import cactus from './cactus.js';

import monitor from './monitor.js';
import dual_monitor from './dual-monitor.js';
import pc_tower from './pc-tower.js';
import server_rack from './server-rack.js';
import tv_screen from './tv-screen.js';
import speaker from './speaker.js';

import floor_lamp from './floor-lamp.js';
import pendant_light from './pendant-light.js';
import desk_lamp from './desk-lamp.js';
import spotlight from './spotlight.js';
import neon_strip from './neon-strip.js';
import chandelier from './chandelier.js';

import bar_counter from './bar-counter.js';
import bar_stool from './bar-stool.js';
import coffee_machine from './coffee-machine.js';
import fridge from './fridge.js';
import sink from './sink.js';
import microwave from './microwave.js';

import pool_table from './pool-table.js';
import foosball from './foosball.js';
import arcade_cabinet from './arcade-cabinet.js';
import treadmill from './treadmill.js';
import beanbag from './beanbag.js';
import ping_pong from './ping-pong.js';

import bench from './bench.js';
import street_lamp from './street-lamp.js';
import trash_can from './trash-can.js';
import planter_box from './planter-box.js';
import fence from './fence.js';
import bollard from './bollard.js';

// Master asset list
export var ASSETS = [
  // Structural
  wall, glass_wall, half_wall, floor_tile, marble_floor, carpet_tile, door, glass_door, archway, column,
  // Furniture
  desk, gaming_desk, chair, gaming_chair, sofa, l_sofa, coffee_table, dining_table,
  // Office
  filing_cabinet, whiteboard, meeting_table, reception_desk, printer, water_cooler,
  // Decor
  painting, sculpture, rug, vase, trophy, wall_clock,
  // Nature
  plant, indoor_tree, palm_tree, flower_pot, hanging_plant, cactus,
  // Tech
  monitor, dual_monitor, pc_tower, server_rack, tv_screen, speaker,
  // Lighting
  floor_lamp, pendant_light, desk_lamp, spotlight, neon_strip, chandelier,
  // Kitchen
  bar_counter, bar_stool, coffee_machine, fridge, sink, microwave,
  // Recreation
  pool_table, foosball, arcade_cabinet, treadmill, beanbag, ping_pong,
  // Exterior
  bench, street_lamp, trash_can, planter_box, fence, bollard,
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
