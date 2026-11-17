// Grid pathfinding. Only water blocks movement; bridges cross the river.
// Breadth-first search over 8 neighbours is plenty for a 48x32 world.
import { T } from './world.js';

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

let prev = null;
let queue = null;

export function walkable(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return false;
  return state.tiles[y * state.w + x] !== T.WATER;
}

/** Returns a list of tile coordinates [[x,y],...] from (sx,sy) exclusive to (tx,ty) inclusive, or null. */
export function findPath(state, sx, sy, tx, ty) {
  const w = state.w;
  const n = w * state.h;
  if (!prev || prev.length !== n) {
    prev = new Int32Array(n);
    queue = new Int32Array(n);
  }
  if (!walkable(state, tx, ty) || !walkable(state, sx, sy)) return null;
  const s = sy * w + sx;
  const t = ty * w + tx;
  if (s === t) return [];
  prev.fill(-1);
  let head = 0;
  let tail = 0;
  queue[tail++] = s;
  prev[s] = s;
  while (head < tail) {
    const c = queue[head++];
    if (c === t) break;
    const cx = c % w;
    const cy = (c / w) | 0;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!walkable(state, nx, ny)) continue;
      if (dx && dy && (!walkable(state, cx + dx, cy) || !walkable(state, cx, cy + dy))) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1) continue;
      prev[ni] = c;
      queue[tail++] = ni;
    }
  }
  if (prev[t] === -1) return null;
  const path = [];
  for (let c = t; c !== s; c = prev[c]) path.push([c % w, (c / w) | 0]);
  return path.reverse();
}
