export const FLOOR_W = 28;
export const FLOOR_D = 16;

export const DESK_POSITIONS = [
  { x: -4.5, z: 1.5 }, { x: -1.5, z: 1.5 }, { x: 1.5, z: 1.5 }, { x: 4.5, z: 1.5 },
  { x: -4.5, z: -1 },  { x: -1.5, z: -1 },  { x: 1.5, z: -1 },  { x: 4.5, z: -1 },
  { x: -4.5, z: -3.5 },{ x: -1.5, z: -3.5 },{ x: 1.5, z: -3.5 },{ x: 4.5, z: -3.5 },
];

export const RECEPTION_POS = { x: 0, z: 6 };
export const SPAWN_POS = { x: 0, z: 7.5 };

export const ENVS = {
  modern: {
    floor1: 0x2a2d35, floor2: 0x323640,
    wall: 0x1e2028,
    desk: 0x5a6a80, deskLegs: 0x4a5568,
    chair: 0x374151, chairSeat: 0x2d3748,
    accent: 0x58a6ff,
  },
  startup: {
    floor1: 0x2c2520, floor2: 0x362f28,
    wall: 0x1a1512,
    desk: 0xA67B1D, deskLegs: 0x8B6914,
    chair: 0x5a3e28, chairSeat: 0x3d2b1f,
    accent: 0xf97316,
  }
};

export const HEAD_R = 0.25;

// Dressing room — right wing
export const DRESSING_ROOM_POS = { x: 10, z: -1.5 }; // platform center
export const DRESSING_ROOM_ENTRANCE = { x: 7.5, z: -1.5 }; // walk target

// Rest area — right wing, further back
export const REST_AREA_POS = { x: 10, z: -5.5 }; // beanbag center
export const REST_AREA_ENTRANCE = { x: 7.5, z: -5.5 }; // walk target

export const DEFAULT_APPEARANCE = {
  head_color: '#FFD5B8',
  hair_style: 'short',
  hair_color: '#4A3728',
  eye_style: 'dots',
  mouth_style: 'smile',
  shirt_color: '#58a6ff',
  pants_color: '#2d3748',
  shoe_color: '#1a1a2e',
  outfit: null,
  body_type: 'default',
};

export const AGENT_PALETTES = [
  { shirt_color: '#58a6ff', pants_color: '#2d3748', hair_color: '#4A3728' },
  { shirt_color: '#f97316', pants_color: '#3d2b1f', hair_color: '#1a1a1a' },
  { shirt_color: '#a855f7', pants_color: '#1e1b2e', hair_color: '#8B4513' },
  { shirt_color: '#22c55e', pants_color: '#1a2e1a', hair_color: '#D4A574' },
  { shirt_color: '#ef4444', pants_color: '#2e1a1a', hair_color: '#333' },
  { shirt_color: '#eab308', pants_color: '#2e2a1a', hair_color: '#8B0000' },
  { shirt_color: '#06b6d4', pants_color: '#1a2e2e', hair_color: '#F5DEB3' },
  { shirt_color: '#ec4899', pants_color: '#2e1a28', hair_color: '#FFD700' },
];
