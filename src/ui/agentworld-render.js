// Agent World rendering adapter. Reuses Little World's terrain, river, trees, people and
// floating labels; adds digital structures, integration links, signals, fog, and the
// selected agent's perception. Reads simulation state; never mutates it.
import { TILE, buildTerrain, drawWater, drawTree, drawPerson, drawFloats, glow, roundRect } from './render.js';
import { ROLES, SIGNALS, STRUCTURES, AW_CLOCK_RATE, AW_RULES } from '../agentworld/rules.js';
import { structById, effectiveReliability, isComplete } from '../agentworld/world.js';
import { hash2 } from '../sim/rng.js';

export { TILE };

const STRAT_RING = { cooperative: 'rgba(52,199,89,0.85)', competitive: 'rgba(255,59,48,0.85)', adaptive: 'rgba(175,82,222,0.85)' };
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif';
const EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

export function createAgentRenderer(canvas) {
  return {
    canvas, ctx: canvas.getContext('2d'),
    terrain: null, terrainKey: null, fog: null, fogKey: -1,
    disp: new Map(), floats: [], time: 0,
    selectedAgentId: null, selectedStructId: null, hoverAgentId: null, hoverStructId: null,
    width: 0, height: 0, dpr: 1,
  };
}

function resize(r, s) {
  const w = s.w * TILE;
  const h = s.h * TILE;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (r.width !== w || r.height !== h || r.dpr !== dpr) {
    r.canvas.width = w * dpr; r.canvas.height = h * dpr;
    r.width = w; r.height = h; r.dpr = dpr;
  }
  r.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function renderAgentWorld(r, sim, clock, dtMs) {
  const s = sim.state;
  const ctx = r.ctx;
  r.time += dtMs / 1000;
  resize(r, s);
  if (r.terrainKey !== s.seed) buildTerrain(r, s);
  for (const e of sim.events.splice(0)) if (e.type === 'float') r.floats.push({ ...e, age: 0 });
  updateDisplay(r, s, clock, dtMs);

  ctx.drawImage(r.terrain, 0, 0, r.width, r.height);
  drawWater(r, s);
  drawPlots(r, s);
  drawLinks(r, s);
  drawSignals(r, s);

  const items = [];
  for (const t of s.trees) items.push({ y: t.y + 0.9, draw: () => drawTree(ctx, t, r.time, s.seed) });
  items.push({ y: s.hub.y + 0.9, draw: () => drawHub(r, s) });
  for (const st of s.structures) if (st.type !== 'connection') items.push({ y: st.y + 0.95, draw: () => drawStructure(r, s, st) });
  for (const a of s.agents) {
    const d = r.disp.get(a.id);
    items.push({ y: d.y + 0.2, draw: () => drawAgent(r, a, d) });
  }
  items.sort((a, b) => a.y - b.y);
  for (const it of items) it.draw();

  drawFog(r, s);
  drawSelection(r, s);
  for (const a of s.agents) drawAgentOverlay(r, a, r.disp.get(a.id));
  drawFloats(r, dtMs);
}

// ---------------------------------------------------------------------------

function updateDisplay(r, s, clock, dtMs) {
  const dt = Math.min(dtMs, 100) / 1000;
  const walk = AW_RULES.walkSpeed * AW_CLOCK_RATE;
  const speed = clock.paused ? 0 : clock.speed;
  const cap = Math.max(walk * 1.2, Math.min(14, walk * speed * 1.15));
  for (const a of s.agents) {
    let d = r.disp.get(a.id);
    if (!d) { d = { x: a.x, y: a.y, moving: false, facing: 1, phase: hash2(a.id, 5) * 6, alpha: 1 }; r.disp.set(a.id, d); }
    const dx = a.x - d.x;
    const dy = a.y - d.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 12) { d.x = a.x; d.y = a.y; d.moving = false; }
    else if (dist > 0.001) {
      const stepLen = Math.min(dist, cap * dt);
      d.x += (dx / dist) * stepLen; d.y += (dy / dist) * stepLen;
      d.moving = stepLen > 0.002;
      if (Math.abs(dx) > 0.01) d.facing = dx > 0 ? 1 : -1;
    } else d.moving = false;
    if (d.moving) d.phase += dt * 10;
    d.working = a.task?.phase === 'work' && a.task.action !== 'rest';
    d.alpha = a.task?.action === 'rest' && a.task.phase === 'work' ? 0.55 : 1;
  }
}

// ---------------------------------------------------------------------------
// Ground: domain plots, the commons, demand outlines
// ---------------------------------------------------------------------------

function drawPlots(r, s) {
  const ctx = r.ctx;
  for (const d of s.domains) {
    if (!d.discovered) continue;
    const x0 = (d.cx - 3.7) * TILE;
    const y0 = (d.cy - 0.9) * TILE;
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(ctx, x0, y0, 8.4 * TILE, 6.6 * TILE, 14); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]);
    label(ctx, d.name.toUpperCase(), (d.cx + 0.5) * TILE, y0 + 9, '600 8.5px', 'rgba(29,29,31,0.62)', 0.9);
  }
  for (const c of s.commons) {
    if (c.structId) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.setLineDash([2, 3]);
    roundRect(ctx, c.x * TILE + 1, c.y * TILE + 1, TILE - 2, TILE - 2, 5); ctx.stroke();
    ctx.setLineDash([]);
  }
  // Wanted structures: faint outlines where a demand signal is live.
  for (const sig of s.signals) {
    if (sig.kind !== 'demand' || sig.target === 0) continue;
    const a = 0.25 + 0.35 * sig.strength + Math.sin(r.time * 2 + sig.x) * 0.08;
    ctx.strokeStyle = `rgba(255,159,10,${a})`;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    roundRect(ctx, sig.x * TILE - 3, sig.y * TILE - 4, TILE + 6, TILE + 6, 6); ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  }
}

function drawHub(r, s) {
  const ctx = r.ctx;
  const cx = s.hub.x * TILE + TILE / 2;
  const cy = s.hub.y * TILE + TILE / 2;
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath(); ctx.ellipse(cx + 1, cy + 6, 21, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f2f2f5';
  ctx.beginPath(); ctx.ellipse(cx, cy + 3, 20, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d1d1d6'; ctx.stroke();
  const pulse = 0.5 + Math.sin(r.time * 2) * 0.2;
  ctx.fillStyle = `rgba(10,132,255,${0.25 + pulse * 0.25})`;
  ctx.beginPath(); ctx.ellipse(cx, cy + 3, 9, 3.6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, cx - 6, cy - 14, 12, 15, 3); ctx.fill();
  ctx.strokeStyle = '#c7c7cc'; ctx.stroke();
  ctx.fillStyle = '#34c759';
  ctx.fillRect(cx - 3, cy - 10, 6, 2); ctx.fillRect(cx - 3, cy - 6.5, 6, 2); ctx.fillRect(cx - 3, cy - 3, 4, 2);
  label(ctx, 'HUB', cx, cy + 19, '700 8px', 'rgba(29,29,31,0.6)', 0.9);
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

const PALETTE = {
  repository: { body: '#5b6b7f', roof: '#3f4c5c', glow: '#9fb3c8' },
  datastore: { body: '#2a9d8f', roof: '#1f7a6f', glow: '#7fe0d3' },
  service: { body: '#2f6fd6', roof: '#2457ab', glow: '#8ec5ff' },
  api: { body: '#8e5bd6', roof: '#6c43a8', glow: '#d3b6ff' },
  library: { body: '#c9853a', roof: '#a36a2a', glow: '#ffd59a' },
};

function drawStructure(r, s, st) {
  const ctx = r.ctx;
  const cx = st.x * TILE + TILE / 2;
  const by = st.y * TILE + TILE - 2;
  const p = PALETTE[st.type];
  if (st.status === 'abandoned') {
    if (s.tick - (st.history.at(-1)?.tick ?? 0) > 240) return;
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#9a8b78';
    for (let i = 0; i < 4; i++) ctx.fillRect(cx - 9 + i * 5, by - 4 - (i % 2) * 3, 4, 4);
    ctx.globalAlpha = 1;
    return;
  }
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.beginPath(); ctx.ellipse(cx + 2, by, 13, 4.5, 0, 0, Math.PI * 2); ctx.fill();

  if (st.status === 'construction') {
    drawScaffold(ctx, cx, by, st, p, r.time);
    return;
  }
  const rel = effectiveReliability(st);
  const health = rel > 0.82 ? 1 : rel > 0.6 ? 0.75 : 0.5;
  switch (st.type) {
    case 'repository': {
      ctx.fillStyle = p.body; roundRect(ctx, cx - 11, by - 15, 22, 15, 3); ctx.fill();
      ctx.fillStyle = p.roof; roundRect(ctx, cx - 12, by - 19, 24, 6, 2); ctx.fill();
      // branch glyph
      ctx.strokeStyle = '#e8eef5'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(cx - 4, by - 3); ctx.lineTo(cx - 4, by - 12); ctx.moveTo(cx - 4, by - 7); ctx.quadraticCurveTo(cx + 4, by - 7, cx + 4, by - 11); ctx.stroke();
      ctx.fillStyle = '#e8eef5';
      for (const [dx, dy] of [[-4, -3], [-4, -12], [4, -11]]) { ctx.beginPath(); ctx.arc(cx + dx, by + dy, 1.6, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'datastore': {
      for (let i = 0; i < 3; i++) {
        const y = by - 4 - i * 5.5;
        ctx.fillStyle = i % 2 ? p.roof : p.body;
        ctx.fillRect(cx - 9, y - 5, 18, 5.5);
        ctx.beginPath(); ctx.ellipse(cx, y, 9, 3, 0, 0, Math.PI); ctx.fill();
      }
      ctx.fillStyle = p.glow;
      ctx.beginPath(); ctx.ellipse(cx, by - 20, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'service': {
      ctx.fillStyle = p.body; roundRect(ctx, cx - 12, by - 20, 24, 20, 4); ctx.fill();
      ctx.fillStyle = p.roof; roundRect(ctx, cx - 12, by - 20, 24, 5, 3); ctx.fill();
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          const on = hash2(st.id * 7 + col, row + Math.floor(r.time * 1.5 + st.id), 3) < 0.75 * health;
          ctx.fillStyle = on ? p.glow : 'rgba(255,255,255,0.18)';
          ctx.fillRect(cx - 8 + col * 6, by - 13 + row * 4, 4, 2.2);
        }
      }
      break;
    }
    case 'api': {
      ctx.fillStyle = p.body;
      ctx.beginPath();
      ctx.moveTo(cx - 12, by); ctx.lineTo(cx - 12, by - 12); ctx.quadraticCurveTo(cx, by - 25, cx + 12, by - 12); ctx.lineTo(cx + 12, by);
      ctx.lineTo(cx + 5, by); ctx.lineTo(cx + 5, by - 8); ctx.quadraticCurveTo(cx, by - 14, cx - 5, by - 8); ctx.lineTo(cx - 5, by);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = p.roof; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(cx, by - 19); ctx.lineTo(cx, by - 26); ctx.stroke();
      const blink = (Math.sin(r.time * 4 + st.id) + 1) / 2;
      ctx.fillStyle = `rgba(211,182,255,${0.5 + blink * 0.5})`;
      ctx.beginPath(); ctx.arc(cx, by - 27, 2.2, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'library': {
      ctx.fillStyle = '#f4ead9'; ctx.fillRect(cx - 12, by - 14, 24, 14);
      ctx.fillStyle = p.body;
      for (let i = 0; i < 4; i++) ctx.fillRect(cx - 10 + i * 6, by - 13, 3, 13);
      ctx.fillStyle = p.roof;
      ctx.beginPath(); ctx.moveTo(cx - 14, by - 14); ctx.lineTo(cx, by - 23); ctx.lineTo(cx + 14, by - 14); ctx.closePath(); ctx.fill();
      break;
    }
    default:
  }
  ctx.lineWidth = 1;
  // Status badges
  let bx = cx + 10;
  if (st.known > 0) { badge(ctx, bx, by - 22, `🐞${st.known > 1 ? st.known : ''}`); bx += 10; }
  if (st.pendingVerify > 0) { badge(ctx, bx, by - 22, '🔍'); bx += 10; }
  if (s.tick - (st.lastIncident ?? -9999) < 40 && Math.sin(r.time * 12) > 0) {
    ctx.strokeStyle = 'rgba(255,59,48,0.9)'; ctx.lineWidth = 2;
    roundRect(ctx, cx - 14, by - 26, 28, 28, 6); ctx.stroke(); ctx.lineWidth = 1;
  }
}

function drawScaffold(ctx, cx, by, st, p, time) {
  const h = 6 + 16 * st.progress;
  ctx.fillStyle = p.body;
  ctx.globalAlpha = 0.35 + 0.5 * st.progress;
  roundRect(ctx, cx - 10, by - h, 20, h, 3); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#c9a36a'; ctx.lineWidth = 1;
  for (const x of [-12, 12]) { ctx.beginPath(); ctx.moveTo(cx + x, by); ctx.lineTo(cx + x, by - 24); ctx.stroke(); }
  for (let y = 4; y < 24; y += 6) { ctx.beginPath(); ctx.moveTo(cx - 12, by - y); ctx.lineTo(cx + 12, by - y); ctx.stroke(); }
  // progress ring
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, by - 30, 5, -Math.PI / 2, -Math.PI / 2 + st.progress * Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(cx, by - 30, 5, -Math.PI / 2 + st.progress * Math.PI * 2, Math.PI * 1.5); ctx.stroke();
  ctx.lineWidth = 1;
  if (st.type === 'library' && st.progress < 0.1) label(ctx, 'blueprint', cx, by + 9, '600 7.5px', 'rgba(29,29,31,0.55)', 0.8);
  void time;
}

function badge(ctx, x, y, text) {
  ctx.font = `10px ${EMOJI}`;
  ctx.textAlign = 'center';
  ctx.fillText(text, x, y);
}

// ---------------------------------------------------------------------------
// Integration links and dependencies
// ---------------------------------------------------------------------------

function drawLinks(r, s) {
  const ctx = r.ctx;
  for (const c of s.structures) {
    if (c.type !== 'connection' || c.status === 'abandoned') continue;
    const a = structById(s, c.a);
    const b = structById(s, c.b);
    if (!a || !b) continue;
    const ax = a.x * TILE + TILE / 2; const ay = a.y * TILE + TILE / 2 + 4;
    const bx = b.x * TILE + TILE / 2; const by = b.y * TILE + TILE / 2 + 4;
    const sel = r.selectedStructId === c.id || r.selectedStructId === a.id || r.selectedStructId === b.id;
    if (c.status === 'construction') {
      const mx = ax + (bx - ax) * c.progress; const my = ay + (by - ay) * c.progress;
      ctx.strokeStyle = 'rgba(175,82,222,0.75)'; ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(mx, my); ctx.stroke();
      ctx.strokeStyle = 'rgba(175,82,222,0.2)'; ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(bx, by); ctx.stroke();
      ctx.setLineDash([]);
      continue;
    }
    ctx.strokeStyle = sel ? 'rgba(0,113,227,0.95)' : 'rgba(255,255,255,0.75)'; ctx.lineWidth = sel ? 3 : 2.2;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    ctx.strokeStyle = 'rgba(175,82,222,0.55)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    // packets travelling both ways
    const len = Math.hypot(bx - ax, by - ay);
    const n = Math.max(1, Math.floor(len / 60));
    for (let i = 0; i < n; i++) {
      for (const dir of [1, -1]) {
        let f = ((r.time * 40) / len + i / n + (dir < 0 ? 0.5 / n : 0)) % 1;
        if (dir < 0) f = 1 - f;
        ctx.fillStyle = dir > 0 ? '#ffffff' : '#e5d4ff';
        ctx.beginPath(); ctx.arc(ax + (bx - ax) * f, ay + (by - ay) * f, 1.8, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
  ctx.lineWidth = 1;
  // Library adoption: faint threads, so reuse is visible without clutter.
  for (const st of s.structures) {
    if (!isComplete(st)) continue;
    for (const id of st.deps) {
      const lib = structById(s, id);
      if (!lib || lib.type !== 'library') continue;
      const sel = r.selectedStructId === st.id || r.selectedStructId === lib.id;
      ctx.strokeStyle = sel ? 'rgba(201,133,58,0.9)' : 'rgba(201,133,58,0.28)';
      ctx.setLineDash([2, 4]); ctx.lineWidth = sel ? 1.6 : 1;
      ctx.beginPath(); ctx.moveTo(st.x * TILE + TILE / 2, st.y * TILE + TILE / 2); ctx.lineTo(lib.x * TILE + TILE / 2, lib.y * TILE + TILE / 2); ctx.stroke();
      ctx.setLineDash([]); ctx.lineWidth = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Signals: soft rings that breathe with strength
// ---------------------------------------------------------------------------

function drawSignals(r, s) {
  const ctx = r.ctx;
  for (const sig of s.signals) {
    if (sig.kind === 'demand' || sig.strength < 0.08) continue;
    if (!s.explored[Math.round(sig.y) * s.w + Math.round(sig.x)]) continue;
    const color = SIGNALS[sig.kind].color;
    const cx = sig.x * TILE + TILE / 2;
    const cy = sig.y * TILE + TILE / 2;
    const ph = (r.time * 0.6 + hash2(sig.x, sig.y, 1)) % 1;
    const rad = 10 + ph * (16 + 26 * sig.strength);
    ctx.globalAlpha = (1 - ph) * 0.45 * Math.min(1, sig.strength + 0.15);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy + 4, rad, rad * 0.55, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1;
    if (sig.boost > 0.05) {
      ctx.font = `10px ${EMOJI}`; ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, sig.boost * 2.5);
      ctx.fillText('🚩', cx - 11, cy - 12);
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------------------------------------------------------
// Fog of the unexplored
// ---------------------------------------------------------------------------

function drawFog(r, s) {
  // Rebuilt (and blurred) only when the explored area changes; a plain blit otherwise.
  let key = 0;
  for (let i = 0; i < s.explored.length; i += 1) key += s.explored[i];
  key = `${s.seed}:${key}`;
  if (r.fogKey !== key || !r.fog) {
    const small = document.createElement('canvas');
    small.width = s.w; small.height = s.h;
    const g = small.getContext('2d');
    const img = g.createImageData(s.w, s.h);
    for (let i = 0; i < s.explored.length; i++) {
      img.data[i * 4] = 236; img.data[i * 4 + 1] = 240; img.data[i * 4 + 2] = 246;
      img.data[i * 4 + 3] = s.explored[i] ? 0 : 190;
    }
    g.putImageData(img, 0, 0);
    const big = r.fog || document.createElement('canvas');
    big.width = r.width; big.height = r.height;
    const bg = big.getContext('2d');
    bg.clearRect(0, 0, big.width, big.height);
    bg.imageSmoothingEnabled = true;
    bg.filter = 'blur(6px)';
    bg.drawImage(small, 0, 0, big.width, big.height);
    r.fog = big; r.fogKey = key;
  }
  r.ctx.drawImage(r.fog, 0, 0, r.width, r.height);
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

function drawAgent(r, a, d) {
  const ctx = r.ctx;
  const x = d.x * TILE;
  const y = d.y * TILE;
  ctx.globalAlpha = d.alpha;
  ctx.strokeStyle = STRAT_RING[a.strategy]; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.ellipse(x, y + 4, 6.5, 2.8, 0, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1; ctx.globalAlpha = 1;
  drawPerson(r, { color: ROLES[a.role].color, skin: a.skin, occupation: a.role, carrying: null }, { ...d, moving: d.moving || (d.working && Math.sin(r.time * 6 + a.id) > 0.6) });
  if (a.role === 'Architect') { ctx.fillStyle = '#ffffff'; ctx.fillRect(x - 3.8, y - 14.6, 7.6, 1.5); }
  if (a.role === 'Tester') { ctx.fillStyle = '#1d1d1f'; ctx.fillRect(x - 3, y - 11.5, 6, 1.2); }
  if (a.role === 'Explorer') { ctx.fillStyle = '#7a5232'; ctx.beginPath(); ctx.ellipse(x, y - 14, 5.5, 1.6, 0, 0, Math.PI * 2); ctx.fill(); }
  if (d.working) {
    const k = (Math.sin(r.time * 9 + a.id) + 1) / 2;
    ctx.fillStyle = `rgba(255,255,255,${0.4 + k * 0.6})`;
    ctx.beginPath(); ctx.arc(x + 6 * d.facing, y - 6, 1.4, 0, Math.PI * 2); ctx.fill();
  }
}

function drawAgentOverlay(r, a, d) {
  const ctx = r.ctx;
  const x = d.x * TILE;
  const y = d.y * TILE;
  const selected = a.id === r.selectedAgentId;
  if (selected) {
    const pulse = 1 + Math.sin(r.time * 4) * 0.12;
    ctx.strokeStyle = '#0071e3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, y + 4, 10 * pulse, 4.5 * pulse, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1;
  }
  const icon = a.phase === 'act' && a.task ? a.task.icon : a.phase === 'learn' ? '✳️' : '💭';
  ctx.font = `10px ${EMOJI}`; ctx.textAlign = 'center';
  ctx.fillText(icon, x + 8, y - 15);
  if (selected || r.hoverAgentId === a.id) label(ctx, a.name, x, y + 14, '600 9px', '#1d1d1f', 1);
}

/** The selected agent's view of the world: its perception range, what it sees, and its options. */
function drawSelection(r, s) {
  const ctx = r.ctx;
  const a = s.agents.find((o) => o.id === r.selectedAgentId);
  if (a) {
    const d = r.disp.get(a.id);
    const ax = d.x * TILE; const ay = d.y * TILE;
    const rad = AW_RULES.perceptionRadius[a.role] * TILE;
    ctx.fillStyle = 'rgba(0,113,227,0.05)';
    ctx.beginPath(); ctx.arc(ax, ay, rad, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(0,113,227,0.45)'; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.arc(ax, ay, rad, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    const per = a.perception;
    if (per) {
      for (const p of per.structures) {
        const st = structById(s, p.id);
        if (!st) continue;
        ctx.strokeStyle = 'rgba(0,113,227,0.18)';
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(st.x * TILE + TILE / 2, st.y * TILE + TILE / 2); ctx.stroke();
      }
    }
    // Options considered at the last decision, scored; the chosen one in bold blue.
    const dec = a.decision;
    if (dec) {
      const seen = new Set();
      for (const c of dec.candidates) {
        if (!c.valid || c.action === 'wander' || c.action === 'rest') continue;
        const pt = candidatePoint(s, c);
        if (!pt) continue;
        const k = `${Math.round(pt.x)}:${Math.round(pt.y)}`;
        if (seen.has(k) && !c.chosen) continue;
        seen.add(k);
        const tx = pt.x * TILE + TILE / 2; const ty = pt.y * TILE + TILE / 2;
        ctx.strokeStyle = c.chosen ? 'rgba(0,113,227,0.95)' : 'rgba(110,110,115,0.45)';
        ctx.lineWidth = c.chosen ? 2.2 : 1;
        if (!c.chosen) ctx.setLineDash([3, 4]);
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(tx, ty); ctx.stroke(); ctx.setLineDash([]);
        pill(ctx, tx, ty - 26, `${c.chosen ? '✓ ' : ''}${c.label.split(' ')[0]} ${c.utility.toFixed(1)}`, c.chosen);
      }
      ctx.lineWidth = 1;
    }
    if (a.task?.path?.length) {
      ctx.strokeStyle = 'rgba(0,113,227,0.6)'; ctx.lineWidth = 2; ctx.setLineDash([1, 4]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ax, ay);
      for (const [px, py] of a.task.path) ctx.lineTo(px * TILE, py * TILE);
      ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; ctx.lineCap = 'butt';
    }
  }
  const st = s.structures.find((o) => o.id === r.selectedStructId);
  if (st) {
    const cx = st.x * TILE + TILE / 2;
    const by = st.y * TILE + TILE - 2;
    const pulse = 1 + Math.sin(r.time * 4) * 0.08;
    ctx.strokeStyle = '#0071e3'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(cx, by, 16 * pulse, 6 * pulse, 0, 0, Math.PI * 2); ctx.stroke(); ctx.lineWidth = 1;
    for (const ag of s.agents) {
      if (ag.task?.targetId !== st.id) continue;
      const d = r.disp.get(ag.id);
      ctx.strokeStyle = 'rgba(0,113,227,0.5)'; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(d.x * TILE, d.y * TILE); ctx.lineTo(cx, by - 8); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  if (r.hoverStructId && r.hoverStructId !== r.selectedStructId) {
    const h = s.structures.find((o) => o.id === r.hoverStructId);
    if (h) label(ctx, h.name, h.x * TILE + TILE / 2, h.y * TILE + TILE + 9, '600 9px', '#1d1d1f', 1);
  }
  if (st) label(ctx, st.name, st.x * TILE + TILE / 2, st.y * TILE + TILE + 9, '600 9px', '#0071e3', 1);
}

function candidatePoint(s, c) {
  // Candidate targets were recorded by name; find them on the map.
  const st = s.structures.find((o) => c.target && (c.target === o.name || c.target.startsWith(`${o.name} `)));
  if (st) return { x: st.x, y: st.y };
  if (c.action === 'build') {
    const d = s.domains.find((o) => c.target.startsWith(o.name));
    const type = Object.keys(STRUCTURES).find((t) => c.target.includes(STRUCTURES[t].label));
    if (d && type && d.slots[type]) return { x: d.slots[type].x, y: d.slots[type].y };
  }
  if (c.action === 'explore') {
    const m = /\((\d+), (\d+)\)/.exec(c.target);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };
  }
  if (c.action === 'design') {
    const free = s.commons.find((o) => !o.structId);
    if (free) return { x: free.x, y: free.y };
  }
  if (c.action === 'flag' && c.target) {
    const name = c.target.split(' · ')[1];
    const st2 = name && s.structures.find((o) => o.name === name);
    if (st2) return { x: st2.x, y: st2.y };
  }
  return null;
}

function pill(ctx, x, y, text, strong) {
  ctx.font = `${strong ? 700 : 600} 9px ${FONT}`;
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = strong ? 'rgba(0,113,227,0.95)' : 'rgba(255,255,255,0.92)';
  roundRect(ctx, x - w / 2, y - 7, w, 14, 7); ctx.fill();
  if (!strong) { ctx.strokeStyle = 'rgba(0,0,0,0.1)'; ctx.stroke(); }
  ctx.fillStyle = strong ? '#ffffff' : '#3a3a3c';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function label(ctx, text, x, y, weight, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.font = `${weight} ${FONT}`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
  ctx.lineWidth = 1; ctx.globalAlpha = 1;
}

export function agentAt(r, s, fx, fy) {
  let best = null; let bd = 1.1;
  for (const a of s.agents) {
    const d = r.disp.get(a.id);
    if (!d) continue;
    const dist = Math.hypot(d.x - fx, d.y - 0.35 - fy);
    if (dist < bd) { bd = dist; best = a; }
  }
  return best;
}

export function structureAt(s, fx, fy) {
  let best = null; let bd = 1.0;
  for (const st of s.structures) {
    if (st.status === 'abandoned' || st.type === 'connection') continue;
    const dist = Math.hypot(st.x + 0.5 - fx, st.y + 0.3 - fy);
    if (dist < bd) { bd = dist; best = st; }
  }
  if (best) return best;
  // Links: distance to segment
  for (const c of s.structures) {
    if (c.type !== 'connection' || c.status === 'abandoned') continue;
    const a = structById(s, c.a); const b = structById(s, c.b);
    if (!a || !b) continue;
    const ax = a.x + 0.5; const ay = a.y + 0.7; const bx = b.x + 0.5; const by = b.y + 0.7;
    const t = Math.max(0, Math.min(1, ((fx - ax) * (bx - ax) + (fy - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)));
    if (Math.hypot(ax + (bx - ax) * t - fx, ay + (by - ay) * t - fy) < 0.45) return c;
  }
  return null;
}

export { glow };
