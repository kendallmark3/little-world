// World generation and placement rules. Pure data, seeded, no DOM.
import { rand, randInt, chance } from './rng.js';

export const W = 48;
export const H = 32;
export const T = { GRASS: 0, WATER: 1, BRIDGE: 2, SAND: 3, PATH: 4 };
export const ROAD_Y = 16;
export const VILLAGE = { x: 14, y: 17 };
export const CAMPFIRE = { x: 14, y: 19 };

export function tileAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return T.WATER;
  return state.tiles[y * state.w + x];
}

export function isLand(state, x, y) {
  const t = tileAt(state, x, y);
  return t === T.GRASS || t === T.SAND;
}

export function treeAt(state, x, y) {
  return state.trees.find((t) => t.x === x && t.y === y);
}

export function bushAt(state, x, y) {
  return state.bushes.find((b) => b.x === x && b.y === y);
}

export function fieldAt(state, x, y) {
  return state.fields.find((f) => x >= f.x && x <= f.x + 1 && y >= f.y && y <= f.y + 1);
}

export function buildingNear(state, x, y, radius) {
  return state.buildings.find((b) => Math.abs(b.x - x) <= radius && Math.abs(b.y - y) <= radius);
}

/** A single tile can take a tree or bush. */
export function canPlantAt(state, x, y) {
  return isLand(state, x, y) && !treeAt(state, x, y) && !bushAt(state, x, y) &&
    !fieldAt(state, x, y) && !buildingNear(state, x, y, 1);
}

/** A house needs its tile plus a margin: dry land, nothing growing on it, no neighbours too close. */
export function canBuildAt(state, x, y) {
  if (x < 2 || y < 2 || x > state.w - 3 || y > state.h - 3) return false;
  if (buildingNear(state, x, y, 2)) return false;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (!isLand(state, tx, ty)) return false;
      if (treeAt(state, tx, ty) || bushAt(state, tx, ty) || fieldAt(state, tx, ty)) return false;
    }
  }
  // keep the door tile walkable and clear
  return tileAt(state, x, y + 1) !== T.WATER;
}

/** A field is a 2x2 plot whose top-left corner is (x,y). */
export function canTillAt(state, x, y) {
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tileAt(state, tx, ty) !== T.GRASS) return false;
      if (treeAt(state, tx, ty) || bushAt(state, tx, ty) || fieldAt(state, tx, ty)) return false;
      if (buildingNear(state, tx, ty, 1)) return false;
    }
  }
  return true;
}

export function generateWorld(state) {
  const w = (state.w = W);
  const h = (state.h = H);
  const tiles = (state.tiles = new Array(w * h).fill(T.GRASS));
  const set = (x, y, t) => { if (x >= 0 && y >= 0 && x < w && y < h) tiles[y * w + x] = t; };

  // River: a meandering two-tile channel running north to south with sandy banks.
  let cx = 30 + randInt(state, 0, 3);
  const riverX = [];
  for (let y = 0; y < h; y++) {
    if (y % 3 === 0) cx = Math.max(28, Math.min(35, cx + randInt(state, -1, 1)));
    riverX.push(cx);
  }
  for (let y = 0; y < h; y++) {
    const x = riverX[y];
    set(x - 1, y, T.SAND);
    set(x + 2, y, T.SAND);
  }
  for (let y = 0; y < h; y++) {
    set(riverX[y], y, T.WATER);
    set(riverX[y] + 1, y, T.WATER);
  }
  state.riverX = riverX;

  // The road: in from the west, through the village, over the bridge, into the eastern woods.
  for (let x = 0; x < 42; x++) {
    const t = tiles[ROAD_Y * w + x];
    set(x, ROAD_Y, t === T.WATER ? T.BRIDGE : T.PATH);
  }

  state.buildings = [
    { id: state.nextId++, type: 'granary', x: 14, y: 14 },
    { id: state.nextId++, type: 'market', x: 18, y: 14 },
    { id: state.nextId++, type: 'campfire', x: CAMPFIRE.x, y: CAMPFIRE.y },
  ];
  for (const [x, y] of [[6, 13], [10, 13], [9, 19], [19, 19], [22, 14]]) {
    state.buildings.push({ id: state.nextId++, type: 'house', x, y, capacity: 2, residents: [], style: randInt(state, 0, 3) });
  }

  // Fields: eight 2x2 plots south-west of the village. Some are already sown.
  state.fields = [];
  for (const fy of [23, 26]) {
    for (const fx of [4, 7, 10, 13]) {
      const sown = chance(state, 0.7);
      state.fields.push({
        id: state.nextId++, x: fx, y: fy,
        state: sown ? 'growing' : 'fallow',
        growth: sown ? 0.35 + rand(state) * 0.55 : 0,
        tended: 0, claimedBy: null,
      });
    }
  }

  // Trees: dense woods east of the river, scattered groves to the north and west.
  state.trees = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== T.GRASS) continue;
      if (Math.abs(y - ROAD_Y) <= 1) continue;
      if (Math.hypot(x - VILLAGE.x, y - VILLAGE.y) < 9) continue;
      if (x >= 2 && x <= 17 && y >= 21 && y <= 29) continue;
      let p = 0.03;
      if (x > riverX[y] + 2) p = 0.32;
      else if (y < 7 || x < 3) p = 0.2;
      if (chance(state, p)) state.trees.push({ id: state.nextId++, x, y, growth: 1, claimedBy: null, planted: false });
    }
  }

  // Berry bushes along the western riverbank meadow and the woods' edge.
  state.bushes = [];
  let attempts = 0;
  while (state.bushes.length < 12 && attempts++ < 500) {
    const x = randInt(state, 20, 39);
    const y = randInt(state, 3, h - 4);
    if (!canPlantAt(state, x, y) || Math.abs(y - ROAD_Y) <= 1) continue;
    if (state.bushes.some((b) => Math.abs(b.x - x) + Math.abs(b.y - y) < 3)) continue;
    state.bushes.push({ id: state.nextId++, x, y, berries: 3, regrow: 0, claimedBy: null });
  }
}
