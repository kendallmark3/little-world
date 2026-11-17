// Canvas renderer. Reads simulation state; never mutates it.
// Display positions are kept here, separate from simulation positions, so that accelerating
// the simulation shows a smooth time-lapse instead of inhabitants teleporting at silly speeds.
import { T } from '../sim/world.js';
import { hash2 } from '../sim/rng.js';
import { minuteOf, homeOf, RULES } from '../sim/sim.js';
import { SIM_MINUTES_PER_SECOND } from '../sim/clock.js';

export const TILE = 20;

const OCC_COLORS = {
  Farmer: '#4f9a45',
  Gatherer: '#8a63c4',
  Builder: '#e0852f',
  Laborer: '#6f7f8f',
  Leader: '#d23f3a',
  Merchant: '#1f9a9a',
};
const SKIN = ['#f3d2b3', '#e2b48c', '#c68a5e', '#9a643f', '#6f452a'];
const ROOF = ['#b5523b', '#4f6d8f', '#5f8a4f', '#8f5f8a'];
const STAR_NAMES = new Set(['Rook', 'Doctor', 'Jenny']);

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  const r = {
    canvas, ctx,
    terrain: null, terrainKey: null,
    disp: new Map(),
    floats: [],
    hover: null,
    tool: 'inspect',
    selectedId: null,
    time: 0,
    width: 0, height: 0,
  };
  return r;
}

function resize(r, s) {
  const w = s.w * TILE;
  const h = s.h * TILE;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (r.width !== w || r.height !== h || r.dpr !== dpr) {
    r.canvas.width = w * dpr;
    r.canvas.height = h * dpr;
    r.width = w; r.height = h; r.dpr = dpr;
  }
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

// ---------------------------------------------------------------------------

export function render(r, sim, clock, dtMs) {
  const s = sim.state;
  const ctx = r.ctx;
  r.time += dtMs / 1000;
  resize(r, s);
  if (r.terrainKey !== s.seed) buildTerrain(r, s);

  for (const e of sim.events.splice(0)) if (e.type === 'float') r.floats.push({ ...e, age: 0 });
  updateDisplayPositions(r, s, clock, dtMs);

  r.lit = new Set();
  ctx.drawImage(r.terrain, 0, 0, r.width, r.height);
  drawWater(r, s);
  for (const f of s.fields) drawField(ctx, f, r.time);

  // y-sorted drawables
  const items = [];
  for (const t of s.trees) items.push({ y: t.y + 0.9, draw: () => drawTree(ctx, t, r.time, s.seed) });
  for (const b of s.bushes) items.push({ y: b.y + 0.7, draw: () => drawBush(ctx, b) });
  for (const b of s.buildings) items.push({ y: b.y + 0.95, draw: () => drawBuilding(r, s, b) });
  const visible = [];
  for (const p of s.people) {
    const d = r.disp.get(p.id);
    if (!d || d.alpha <= 0.02) continue;
    visible.push(p);
    items.push({ y: d.y + 0.2, draw: () => drawPerson(r, p, d) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  drawLighting(r, s);

  // Overlays that should stay readable at night
  for (const p of visible) drawPersonOverlay(r, p, r.disp.get(p.id));
  drawSites(r, s);
  drawFloats(r, dtMs);
  drawHover(r, s);
}

// ---------------------------------------------------------------------------
// Display positions (render time vs simulation time)
// ---------------------------------------------------------------------------

function updateDisplayPositions(r, s, clock, dtMs) {
  const dt = Math.min(dtMs, 100) / 1000;
  const walkTilesPerSec = RULES.walkSpeed * SIM_MINUTES_PER_SECOND;
  const speed = clock.paused ? 0 : clock.speed;
  const cap = Math.max(walkTilesPerSec * 1.2, Math.min(12, walkTilesPerSec * speed * 1.1));
  const alive = new Set();
  for (const p of s.people) {
    alive.add(p.id);
    let d = r.disp.get(p.id);
    const hidden = p.task?.kind === 'sleep' && p.task.phase === 'work' && homeOf(s, p);
    if (!d) {
      d = { x: p.x, y: p.y, alpha: hidden ? 0 : 1, moving: false, facing: 1, phase: hash2(p.id, 3) * 6 };
      r.disp.set(p.id, d);
    }
    const dx = p.x - d.x;
    const dy = p.y - d.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 10) {
      d.x = p.x; d.y = p.y; d.moving = false;
    } else if (dist > 0.001) {
      const stepLen = Math.min(dist, cap * dt);
      d.x += (dx / dist) * stepLen;
      d.y += (dy / dist) * stepLen;
      d.moving = stepLen > 0.002;
      if (Math.abs(dx) > 0.01) d.facing = dx > 0 ? 1 : -1;
    } else {
      d.moving = false;
    }
    const targetAlpha = hidden && dist < 0.3 ? 0 : 1;
    d.alpha += (targetAlpha - d.alpha) * Math.min(1, dt * 4);
    if (d.moving) d.phase += dt * 10;
  }
  for (const id of r.disp.keys()) if (!alive.has(id)) r.disp.delete(id);
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function buildTerrain(r, s) {
  const c = document.createElement('canvas');
  c.width = s.w * TILE * 2;
  c.height = s.h * TILE * 2;
  const g = c.getContext('2d');
  g.scale(2, 2);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const t = s.tiles[y * s.w + x];
      const n = hash2(x, y, s.seed);
      const px = x * TILE;
      const py = y * TILE;
      if (t === T.GRASS || t === T.PATH || t === T.SAND) {
        const l = 52 + n * 2.2;
        g.fillStyle = `hsl(${98 + n * 4}, 42%, ${l}%)`;
        g.fillRect(px, py, TILE, TILE);
        if (t === T.GRASS && n > 0.55) {
          g.strokeStyle = `hsla(100, 45%, ${l - 12}%, 0.7)`;
          g.lineWidth = 1;
          const gx = px + 4 + n * 10;
          const gy = py + 6 + (1 - n) * 8;
          g.beginPath();
          g.moveTo(gx, gy + 4); g.lineTo(gx - 2, gy);
          g.moveTo(gx + 2, gy + 4); g.lineTo(gx + 3, gy - 1);
          g.stroke();
        }
        if (t === T.GRASS && n < 0.05) {
          g.fillStyle = ['#fff6a8', '#ffffff', '#f6b8d8'][Math.floor(n * 60) % 3];
          g.beginPath(); g.arc(px + 10, py + 10, 1.6, 0, Math.PI * 2); g.fill();
        }
      }
      if (t === T.SAND) {
        g.fillStyle = `hsl(42, 45%, ${74 + n * 5}%)`;
        g.fillRect(px, py, TILE, TILE);
      }
      if (t === T.PATH) {
        g.fillStyle = `hsl(35, 32%, ${66 + n * 6}%)`;
        g.fillRect(px, py + 3, TILE, TILE - 6);
        g.fillStyle = 'rgba(120,90,60,0.18)';
        g.fillRect(px + n * 14, py + 8, 3, 2);
      }
      if (t === T.WATER || t === T.BRIDGE) {
        g.fillStyle = `hsl(204, 62%, ${50 + n * 4}%)`;
        g.fillRect(px, py, TILE, TILE);
      }
      if (t === T.BRIDGE) {
        g.fillStyle = '#9b6b43';
        g.fillRect(px - 1, py + 2, TILE + 2, TILE - 4);
        g.strokeStyle = '#7a5232';
        g.lineWidth = 1;
        for (let i = 0; i < TILE; i += 4) { g.beginPath(); g.moveTo(px + i + 0.5, py + 2); g.lineTo(px + i + 0.5, py + TILE - 2); g.stroke(); }
        g.fillStyle = '#6b4529';
        g.fillRect(px - 1, py + 1, TILE + 2, 2);
        g.fillRect(px - 1, py + TILE - 3, TILE + 2, 2);
      }
    }
  }
  r.terrain = c;
  r.terrainKey = s.seed;
}

function drawWater(r, s) {
  const ctx = r.ctx;
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  for (let y = 0; y < s.h; y++) {
    const x = s.riverX[y];
    if (s.tiles[y * s.w + x] !== T.WATER) continue;
    const off = ((r.time * 8 + y * 7) % TILE);
    const px = x * TILE + 6 + Math.sin(r.time * 1.5 + y) * 3;
    ctx.beginPath();
    ctx.moveTo(px, y * TILE + off);
    ctx.lineTo(px + 5, y * TILE + off);
    ctx.moveTo(px + 20, y * TILE + ((off + 10) % TILE));
    ctx.lineTo(px + 26, y * TILE + ((off + 10) % TILE));
    ctx.stroke();
  }
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

function drawField(ctx, f, time) {
  const px = f.x * TILE;
  const py = f.y * TILE;
  const size = TILE * 2;
  ctx.fillStyle = '#8a6a48';
  roundRect(ctx, px + 1, py + 1, size - 2, size - 2, 3);
  ctx.fill();
  ctx.strokeStyle = 'rgba(60,40,20,0.35)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(px + 3, py + i * 8 + 0.5);
    ctx.lineTo(px + size - 3, py + i * 8 + 0.5);
    ctx.stroke();
  }
  if (f.state === 'fallow') return;
  const ripe = f.state === 'ripe';
  const g = f.growth;
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 6; col++) {
      const cx = px + 5 + col * 6;
      const cy = py + 7 + row * 8;
      const sway = ripe ? Math.sin(time * 2 + col + row) * 0.8 : 0;
      if (ripe) {
        ctx.strokeStyle = '#b98a1f';
        ctx.beginPath(); ctx.moveTo(cx, cy + 1); ctx.lineTo(cx + sway, cy - 5); ctx.stroke();
        ctx.fillStyle = '#efc145';
        ctx.beginPath(); ctx.ellipse(cx + sway, cy - 5, 1.6, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      } else {
        const h = 1 + g * 5;
        ctx.strokeStyle = g > 0.6 ? '#6aa63a' : '#82c04f';
        ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(cx, cy + 1); ctx.lineTo(cx, cy + 1 - h); ctx.stroke();
        ctx.lineWidth = 1;
      }
    }
  }
  if (f.tended > 0 && !ripe) {
    ctx.fillStyle = 'rgba(120,190,255,0.25)';
    roundRect(ctx, px + 1, py + 1, size - 2, size - 2, 3);
    ctx.fill();
  }
}

function drawTree(ctx, t, time, seed) {
  const cx = t.x * TILE + TILE / 2;
  const by = t.y * TILE + TILE - 3;
  const g = Math.max(0.25, t.growth);
  const n = hash2(t.x, t.y, seed + 9);
  const rad = (7 + n * 3) * g;
  const sway = Math.sin(time * 1.2 + t.x * 0.7 + t.y) * 0.8 * g;
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.beginPath(); ctx.ellipse(cx + 2, by, rad * 0.9, rad * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#7b5332';
  ctx.fillRect(cx - 1.5 * g, by - 7 * g, 3 * g, 7 * g);
  const hue = 118 + n * 22;
  ctx.fillStyle = `hsl(${hue}, 38%, ${30 + n * 6}%)`;
  ctx.beginPath(); ctx.arc(cx + sway, by - 7 * g - rad * 0.6, rad, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = `hsl(${hue}, 40%, ${38 + n * 6}%)`;
  ctx.beginPath(); ctx.arc(cx + sway - rad * 0.3, by - 7 * g - rad * 0.9, rad * 0.6, 0, Math.PI * 2); ctx.fill();
  if (t.growth < 1 && t.planted) {
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, by + 2, 4, -Math.PI / 2, -Math.PI / 2 + t.growth * Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
}

function drawBush(ctx, b) {
  const cx = b.x * TILE + TILE / 2;
  const cy = b.y * TILE + TILE / 2 + 2;
  ctx.fillStyle = 'rgba(0,0,0,0.15)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 5, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#3f7d3a';
  ctx.beginPath(); ctx.arc(cx - 3, cy, 5, 0, Math.PI * 2); ctx.arc(cx + 3, cy, 5, 0, Math.PI * 2); ctx.arc(cx, cy - 3, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#d83a5a';
  const spots = [[-4, -1], [3, -3], [1, 2], [-1, -5], [5, 1], [-3, 3], [0, -1], [4, -6], [-5, -4]];
  for (let i = 0; i < b.berries * 3; i++) {
    const [dx, dy] = spots[i];
    ctx.beginPath(); ctx.arc(cx + dx, cy + dy, 1.4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawBuilding(r, s, b) {
  const ctx = r.ctx;
  const cx = b.x * TILE + TILE / 2;
  const base = b.y * TILE + TILE;
  const m = minuteOf(s.tick);
  const dark = darkness(m);
  if (b.type === 'house') {
    const w = 30; const h = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(cx - w / 2 + 3, base - 2, w, 5);
    ctx.fillStyle = '#ecdfc6';
    ctx.fillRect(cx - w / 2, base - h, w, h);
    ctx.fillStyle = ROOF[b.style % ROOF.length];
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 3, base - h + 2);
    ctx.lineTo(cx - w / 2 + 4, base - h - 11);
    ctx.lineTo(cx + w / 2 - 4, base - h - 11);
    ctx.lineTo(cx + w / 2 + 3, base - h + 2);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(cx - w / 2 + 4, base - h - 11, w - 8, 3);
    ctx.fillStyle = '#6b4529';
    ctx.fillRect(cx - 3, base - 10, 6, 10);
    const occupied = b.residents.some((id) => {
      const p = s.people.find((o) => o.id === id);
      return p && p.task?.kind === 'sleep' && p.task.phase === 'work';
    });
    const lit = dark > 0.15 && (occupied || (m > 17 * 60 && m < 23 * 60 && b.residents.length));
    ctx.fillStyle = lit ? '#ffd76a' : '#9fc2d8';
    ctx.fillRect(cx - 12, base - 13, 5, 5);
    ctx.fillRect(cx + 7, base - 13, 5, 5);
    if (lit) r.lit.add(b.id);
  } else if (b.type === 'granary') {
    const w = 40; const h = 22;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(cx - w / 2 + 3, base - 2, w, 5);
    ctx.fillStyle = '#b5523b';
    ctx.fillRect(cx - w / 2, base - h, w, h);
    ctx.fillStyle = '#8e3d2b';
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 - 2, base - h + 1);
    ctx.lineTo(cx, base - h - 13);
    ctx.lineTo(cx + w / 2 + 2, base - h + 1);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#f4eadb'; ctx.lineWidth = 1.5;
    ctx.strokeRect(cx - 7, base - 14, 14, 14);
    ctx.beginPath(); ctx.moveTo(cx - 7, base - 14); ctx.lineTo(cx + 7, base); ctx.moveTo(cx + 7, base - 14); ctx.lineTo(cx - 7, base); ctx.stroke();
    ctx.lineWidth = 1;
    // sacks of grain beside the door show the food store
    const sacks = Math.min(8, Math.ceil(s.food / 15));
    for (let i = 0; i < sacks; i++) {
      const sx = cx - w / 2 - 6 + (i % 4) * 5 - (i >= 4 ? 2 : 0);
      const sy = base + 1 - (i >= 4 ? 5 : 0);
      ctx.fillStyle = '#e8d3a3';
      ctx.beginPath(); ctx.ellipse(sx, sy, 3, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    }
    // wood pile on the other side
    const logs = Math.min(9, Math.ceil(s.wood / 8));
    for (let i = 0; i < logs; i++) {
      const lx = cx + w / 2 + 2 + (i % 3) * 5;
      const ly = base + 1 - Math.floor(i / 3) * 4;
      ctx.fillStyle = '#8b5a33';
      ctx.fillRect(lx - 2, ly - 3, 5, 3.5);
      ctx.fillStyle = '#d7b07a';
      ctx.beginPath(); ctx.arc(lx + 3, ly - 1.2, 1.6, 0, Math.PI * 2); ctx.fill();
    }
  } else if (b.type === 'market') {
    const w = 30;
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(cx - w / 2 + 3, base - 2, w, 4);
    ctx.fillStyle = '#9b6b43';
    ctx.fillRect(cx - w / 2, base - 9, w, 9);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#1f9a9a';
      ctx.fillRect(cx - w / 2 - 2 + i * ((w + 4) / 6), base - 20, (w + 4) / 6 + 0.5, 8);
    }
    ctx.fillStyle = '#6b4529';
    ctx.fillRect(cx - w / 2, base - 12, 2, 12);
    ctx.fillRect(cx + w / 2 - 2, base - 12, 2, 12);
    ctx.fillStyle = '#efc145';
    ctx.beginPath(); ctx.arc(cx - 6, base - 10, 2.2, 0, Math.PI * 2); ctx.arc(cx, base - 10, 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#d83a5a';
    ctx.beginPath(); ctx.arc(cx + 6, base - 10, 2.2, 0, Math.PI * 2); ctx.fill();
  } else if (b.type === 'campfire') {
    const cy = b.y * TILE + TILE / 2;
    ctx.fillStyle = '#8f8f8f';
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * 7, cy + Math.sin(a) * 5, 2, 0, Math.PI * 2); ctx.fill();
    }
    const lit = m >= 17 * 60 || m < DAWN_LIGHT;
    if (lit) {
      const f = Math.sin(r.time * 14) * 1.2;
      ctx.fillStyle = '#ff8c2a';
      ctx.beginPath(); ctx.moveTo(cx - 4, cy + 2); ctx.quadraticCurveTo(cx, cy - 12 - f, cx + 4, cy + 2); ctx.fill();
      ctx.fillStyle = '#ffd34a';
      ctx.beginPath(); ctx.moveTo(cx - 2, cy + 2); ctx.quadraticCurveTo(cx, cy - 6 + f, cx + 2, cy + 2); ctx.fill();
    } else {
      ctx.fillStyle = '#5a4030';
      ctx.fillRect(cx - 4, cy - 1, 8, 2);
    }
  } else if (b.type === 'site') {
    const w = 30; const h = 18;
    const prog = b.progress;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = b.byPlayer ? 'rgba(0,113,227,0.8)' : 'rgba(80,60,40,0.7)';
    ctx.strokeRect(cx - w / 2, base - h, w, h);
    ctx.setLineDash([]);
    if (prog > 0) {
      const hh = h * prog;
      ctx.fillStyle = '#ecdfc6';
      ctx.fillRect(cx - w / 2, base - hh, w, hh);
      ctx.strokeStyle = '#9b6b43';
      ctx.lineWidth = 1.5;
      for (let i = 0; i <= 3; i++) {
        const x = cx - w / 2 + (i * w) / 3;
        ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x, base - Math.min(h + 6, hh + 6)); ctx.stroke();
      }
      ctx.lineWidth = 1;
    }
    const logs = Math.min(8, Math.round((b.woodDelivered / b.woodNeeded) * 8 * (1 - prog)));
    for (let i = 0; i < logs; i++) {
      ctx.fillStyle = '#8b5a33';
      ctx.fillRect(cx + w / 2 + 2, base - 3 - i * 3, 8, 2.5);
    }
  }
}

const DAWN_LIGHT = 6 * 60;

function drawSites(r, s) {
  const ctx = r.ctx;
  for (const b of s.buildings) {
    if (b.type !== 'site') continue;
    const cx = b.x * TILE + TILE / 2;
    const top = b.y * TILE - 16;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(ctx, cx - 18, top - 4, 36, 6, 3); ctx.fill();
    ctx.fillStyle = '#e0852f';
    roundRect(ctx, cx - 17, top - 3, 34 * b.progress, 4, 2); ctx.fill();
    ctx.fillStyle = 'rgba(139,90,51,0.9)';
    roundRect(ctx, cx - 17, top + 3, 34 * (b.woodDelivered / b.woodNeeded), 2, 1); ctx.fill();
  }
}

function drawPerson(r, p, d) {
  const ctx = r.ctx;
  const x = d.x * TILE;
  const y = d.y * TILE;
  const bob = d.moving ? Math.abs(Math.sin(d.phase)) * 1.8 : 0;
  ctx.globalAlpha = d.alpha;
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.beginPath(); ctx.ellipse(x, y + 4, 5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
  // legs
  if (d.moving) {
    const sw = Math.sin(d.phase) * 2;
    ctx.strokeStyle = '#4a3b30'; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(x - 1.5, y - 1 - bob); ctx.lineTo(x - 1.5 + sw, y + 3); ctx.moveTo(x + 1.5, y - 1 - bob); ctx.lineTo(x + 1.5 - sw, y + 3); ctx.stroke();
    ctx.lineWidth = 1;
  }
  ctx.fillStyle = OCC_COLORS[p.occupation] || '#777';
  roundRect(ctx, x - 4.5, y - 8 - bob, 9, 9, 3.5); ctx.fill();
  ctx.fillStyle = SKIN[p.skin % SKIN.length];
  ctx.beginPath(); ctx.arc(x, y - 11 - bob, 3.8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(60,40,30,0.85)';
  ctx.beginPath(); ctx.arc(x, y - 12.2 - bob, 3.8, Math.PI, Math.PI * 2); ctx.fill();
  if (p.occupation === 'Farmer') { // straw hat
    ctx.fillStyle = '#e8c870';
    ctx.beginPath(); ctx.ellipse(x, y - 13.5 - bob, 5.5, 1.6, 0, 0, Math.PI * 2); ctx.fill();
  }
  if (p.occupation === 'Merchant') { // top hat
    ctx.fillStyle = '#2b2b2b';
    ctx.fillRect(x - 3, y - 19 - bob, 6, 5); ctx.fillRect(x - 4.5, y - 14.5 - bob, 9, 1.5);
  }
  if (p.occupation === 'Leader') { // red band
    ctx.fillStyle = '#ffd34a';
    ctx.fillRect(x - 3.8, y - 13.5 - bob, 7.6, 1.6);
  }
  if (p.carrying) {
    ctx.fillStyle = p.carrying.type === 'wood' ? '#8b5a33' : '#e8d3a3';
    roundRect(ctx, x + 3 * d.facing - 3, y - 9 - bob, 6, 5, 1.5); ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPersonOverlay(r, p, d) {
  const ctx = r.ctx;
  const x = d.x * TILE;
  const y = d.y * TILE;
  const selected = p.id === r.selectedId;
  ctx.globalAlpha = d.alpha;
  if (selected) {
    const pulse = 1 + Math.sin(r.time * 4) * 0.12;
    ctx.strokeStyle = '#0071e3';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 4, 9 * pulse, 4 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
  if (p.icon) {
    ctx.font = '10px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(p.icon, x + 8, y - 15);
  }
  if (STAR_NAMES.has(p.name) || selected || r.hoverPersonId === p.id) {
    ctx.font = '600 9px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(p.name, x, y + 13);
    ctx.fillStyle = '#1d1d1f';
    ctx.fillText(p.name, x, y + 13);
    ctx.lineWidth = 1;
  }
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------------------
// Day and night
// ---------------------------------------------------------------------------

export function darkness(m) {
  const h = m / 60;
  if (h < 5) return 0.6;
  if (h < 7) return 0.6 * (1 - (h - 5) / 2);
  if (h < 18.5) return 0;
  if (h < 21.5) return 0.6 * ((h - 18.5) / 3);
  return 0.6;
}

function drawLighting(r, s) {
  const ctx = r.ctx;
  const m = minuteOf(s.tick);
  const h = m / 60;
  const dark = darkness(m);
  if (h > 17 && h < 20) {
    const warm = Math.sin(((h - 17) / 3) * Math.PI) * 0.16;
    ctx.fillStyle = `rgba(255,140,60,${warm})`;
    ctx.fillRect(0, 0, r.width, r.height);
  }
  if (h > 5 && h < 7.5) {
    const warm = Math.sin(((h - 5) / 2.5) * Math.PI) * 0.12;
    ctx.fillStyle = `rgba(255,170,120,${warm})`;
    ctx.fillRect(0, 0, r.width, r.height);
  }
  if (dark <= 0.01) return;
  ctx.fillStyle = `rgba(16,24,64,${dark})`;
  ctx.fillRect(0, 0, r.width, r.height);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const b of s.buildings) {
    if (b.type === 'campfire' && (m >= 17 * 60 || m < DAWN_LIGHT)) {
      const flick = 1 + Math.sin(r.time * 9) * 0.05 + Math.sin(r.time * 23) * 0.03;
      const rad = (m >= 17 * 60 && m < 23 * 60 ? 80 : 45) * flick;
      glow(ctx, b.x * TILE + TILE / 2, b.y * TILE + TILE / 2, rad, `rgba(255,150,60,${0.45 * dark / 0.6})`);
    }
    if (b.type === 'house' && r.lit.has(b.id)) {
      glow(ctx, b.x * TILE + TILE / 2, b.y * TILE + TILE - 10, 26, `rgba(255,200,90,${0.35 * dark / 0.6})`);
    }
  }
  ctx.restore();
}

function glow(ctx, x, y, rad, color) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

function drawFloats(r, dtMs) {
  const ctx = r.ctx;
  ctx.font = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  r.floats = r.floats.filter((f) => (f.age += dtMs / 1000) < 1.6);
  for (const f of r.floats) {
    const a = 1 - f.age / 1.6;
    ctx.globalAlpha = a;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    const y = f.y * TILE - f.age * 22;
    ctx.strokeText(f.text, f.x * TILE, y);
    ctx.fillStyle = '#1d1d1f';
    ctx.fillText(f.text, f.x * TILE, y);
  }
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
}

function drawHover(r, s) {
  if (!r.hover || r.tool === 'inspect') return;
  const ctx = r.ctx;
  const { x, y, ok } = r.hover;
  ctx.fillStyle = ok ? 'rgba(0,113,227,0.25)' : 'rgba(220,50,50,0.25)';
  ctx.strokeStyle = ok ? 'rgba(0,113,227,0.9)' : 'rgba(220,50,50,0.9)';
  const size = r.tool === 'till' ? 2 : 1;
  const ox = r.tool === 'house' ? -1 : 0;
  const oy = r.tool === 'house' ? -1 : 0;
  const span = r.tool === 'house' ? 3 : size;
  ctx.fillRect((x + ox) * TILE, (y + oy) * TILE, span * TILE, span * TILE);
  ctx.strokeRect((x + ox) * TILE + 0.5, (y + oy) * TILE + 0.5, span * TILE - 1, span * TILE - 1);
}

function roundRect(ctx, x, y, w, h, rad) {
  ctx.beginPath();
  if (w <= 0 || h <= 0) return;
  const rr = Math.min(rad, w / 2, h / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
