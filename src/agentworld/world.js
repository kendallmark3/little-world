// Agent World — world state. Reuses Little World's terrain generator (river, road, woods),
// then lays out the Hub, the commons, and the domains that explorers can discover.
// Pure and deterministic: no DOM, no Math.random, no Date.
import { generateWorld, T, W, H } from '../sim/world.js';
import { rand, randInt, shuffle } from '../sim/rng.js';
import {
  AW_RULES, STRUCTURES, DOMAIN_SLOTS, SLOT_OFFSETS, DOMAIN_NAMES, ROLES, ROLE_ORDER, CONFIGS,
} from './rules.js';

export const HUB = { x: 14, y: 19 };
const COMMONS = [[9, 21], [19, 21], [14, 24], [5, 19], [23, 19]];
const DOMAIN_SITES = [
  [14, 9], [5, 2], [14, 2], [23, 2], [5, 9], [23, 9], [5, 24], [23, 24], [43, 2], [43, 9], [43, 19], [43, 25],
];

export function createWorldState(seed, configKey = 'mixed') {
  const config = CONFIGS[configKey] ? configKey : 'mixed';
  const state = {
    version: 1,
    seed: seed >>> 0,
    config,
    rng: seed >>> 0,
    tick: 0,
    nextId: 1,
    compute: AW_RULES.computeStart,
    structures: [],
    agents: [],
    signals: [],
    reservations: {},
    log: [],
    counters: {
      seq: { Repo: 0, Store: 0, Service: 0, API: 0, Lib: 0, Link: 0 },
      decisions: 0, completed: 0, usefulWork: 0, wastedWork: 0, computeSpent: 0, computeEarned: 0,
      cooperation: 0, competition: 0, defectsFound: 0, defectsSurfaced: 0, defectsRepaired: 0,
      repairsVerified: 0, reuses: 0, connections: 0, failedActions: 0, successfulActions: 0,
      abandoned: 0, incidentLoss: 0, refunds: 0, discoveries: 0, flags: 0, rushes: 0, contests: 0, handoffs: 0,
    },
    history: [],
  };

  // Terrain: exactly Little World's generator, run on its own seeded stream.
  const terrain = { rng: state.rng, nextId: 1 };
  generateWorld(terrain);
  state.rng = terrain.rng;
  state.w = terrain.w;
  state.h = terrain.h;
  state.tiles = terrain.tiles;
  state.riverX = terrain.riverX;
  state.hub = { ...HUB };

  // Domains: eight discoverable sites. Identity, nearest the Hub, is known from the start.
  const sites = DOMAIN_SITES.filter(([cx, cy]) => DOMAIN_SLOTS.every((t) => {
    const [dx, dy] = SLOT_OFFSETS[t];
    return isOpen(state, cx + dx, cy + dy) && isOpen(state, cx + dx, cy + dy + 1);
  }));
  const first = sites.shift();
  const chosen = [first, ...shuffle(state, sites).slice(0, DOMAIN_NAMES.length - 1)];
  state.domains = chosen.map(([cx, cy], i) => ({
    id: i + 1,
    name: DOMAIN_NAMES[i],
    cx, cy,
    demand: i === 0 ? 0.9 : 0.6 + rand(state) * 0.4,
    discovered: i === 0,
    discoveredBy: null,
    discoveredTick: i === 0 ? 0 : null,
    slots: Object.fromEntries(DOMAIN_SLOTS.map((t) => [t, {
      x: cx + SLOT_OFFSETS[t][0], y: cy + SLOT_OFFSETS[t][1], structId: null, openTick: null,
    }])),
  }));
  state.commons = COMMONS.filter(([x, y]) => isOpen(state, x, y) && isOpen(state, x, y + 1))
    .map(([x, y], i) => ({ id: i + 1, x, y, structId: null }));

  // Scenery: Little World's trees, cleared around every lot so buildings have room.
  const lots = [[HUB.x, HUB.y], ...state.commons.map((c) => [c.x, c.y]),
    ...state.domains.flatMap((d) => DOMAIN_SLOTS.map((t) => [d.slots[t].x, d.slots[t].y]))];
  state.trees = terrain.trees
    .filter((t) => lots.every(([x, y]) => Math.abs(t.x - x) > 2 || Math.abs(t.y - y) > 2))
    .map((t) => ({ x: t.x, y: t.y, growth: 1 }));

  // Fog: the map starts unexplored except around the Hub and the Identity domain.
  state.explored = new Array(state.w * state.h).fill(0);
  reveal(state, HUB.x, HUB.y, 7);
  reveal(state, first[0], first[1] + 2, 5);

  createAgents(state);
  return state;
}

function isOpen(state, x, y) {
  if (x < 1 || y < 1 || x >= state.w - 1 || y >= state.h - 1) return false;
  const t = state.tiles[y * state.w + x];
  return t === T.GRASS;
}

function createAgents(state) {
  const strategies = CONFIGS[state.config].strategies;
  let i = 0;
  for (const role of ROLE_ORDER) {
    const spec = ROLES[role];
    for (let n = 1; n <= spec.count; n++) {
      const strategy = strategies[i];
      const angle = (i / 10) * Math.PI * 2;
      const skills = {};
      for (const [k, v] of Object.entries(spec.skills)) skills[k] = clamp(v + (rand(state) - 0.5) * 0.2, 0.4, 0.98);
      state.agents.push({
        id: state.nextId++,
        name: `${role}-${String(n).padStart(3, '0')}`,
        role,
        strategy,
        lean: AW_RULES.lean[strategy],
        skills,
        skin: randInt(state, 0, 4),
        energy: 70 + Math.floor(rand(state) * 30),
        x: HUB.x + Math.round(Math.cos(angle) * 2.5),
        y: HUB.y + 1 + Math.round(Math.sin(angle) * 1.5),
        phase: 'observe',
        phaseTicks: (i % 4),   // stagger first decisions so the colony does not move in lockstep
        task: null,
        objective: 'Getting oriented at the Hub',
        perception: null,
        decision: null,
        memory: [],
        history: [],
        learned: { success: {}, styleReward: { coop: null, comp: null } },
        stats: { success: 0, failed: 0, paused: 0, credit: 0, cooperation: 0, competition: 0 },
      });
      i++;
    }
  }
}

export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export function reveal(state, cx, cy, r) {
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(state.w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(state.h - 1, Math.ceil(cy + r));
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const i = y * state.w + x;
      if (!state.explored[i]) { state.explored[i] = 1; n++; }
    }
  }
  return n;
}

export function isExplored(state, x, y) {
  return state.explored[Math.round(y) * state.w + Math.round(x)] === 1;
}

export function exploredFraction(state) {
  let n = 0;
  for (const v of state.explored) n += v;
  return n / state.explored.length;
}

// ---------------------------------------------------------------------------
// Structure helpers
// ---------------------------------------------------------------------------

export function structById(state, id) {
  return state.structures.find((s) => s.id === id) || null;
}

export function agentById(state, id) {
  return state.agents.find((a) => a.id === id) || null;
}

export function domainById(state, id) {
  return state.domains.find((d) => d.id === id) || null;
}

export function isLive(s) { return s && s.status !== 'abandoned'; }
export function isComplete(s) { return s && s.status === 'complete'; }

/** Reliability as users experience it: known defects and unverified repairs drag it down. */
export function effectiveReliability(s) {
  if (!isComplete(s)) return 0;
  return clamp(s.reliability * 0.85 ** s.known * (s.pendingVerify ? 0.96 : 1), 0, 1);
}

/** Cross-domain connections that are finished. */
export function crossLinks(state, s) {
  return state.structures.filter((c) => c.type === 'connection' && isComplete(c) && (c.a === s.id || c.b === s.id));
}

export function linkedIds(state, s) {
  const out = new Set();
  for (const c of state.structures) {
    if (c.type !== 'connection' || !isLive(c)) continue;
    if (c.a === s.id) out.add(c.b);
    if (c.b === s.id) out.add(c.a);
  }
  return out;
}

export function dependents(state, lib) {
  return state.structures.filter((s) => isLive(s) && s.deps.includes(lib.id) && lib.type === 'library').length;
}

export function computeUsage(state, s) {
  if (!isComplete(s)) return 0;
  const spec = STRUCTURES[s.type];
  if (s.type === 'connection') return 0;
  if (s.type === 'library') return 0.6 + dependents(state, s) * 1.4;
  return spec.usage * (1 + 0.5 * crossLinks(state, s).length);
}

export function newStructure(state, type, x, y, ownerId, extra = {}) {
  const spec = STRUCTURES[type];
  state.counters.seq[spec.prefix] += 1;
  const n = state.counters.seq[spec.prefix];
  const [c0, c1] = spec.complexity;
  const s = {
    id: state.nextId++,
    name: `${spec.prefix === 'Repo' ? 'Repository' : spec.prefix === 'Store' ? 'DataStore' : spec.prefix === 'Lib' ? 'Library' : spec.prefix === 'Link' ? 'Link' : spec.prefix}-${String(n).padStart(3, '0')}`,
    type,
    domainId: null,
    x, y,
    a: null, b: null,
    status: 'construction',
    progress: 0,
    workDone: 0,
    complexity: round2(c0 + rand(state) * (c1 - c0)),
    reliability: 0,
    efficiency: 0,
    usage: 0,
    deps: [],
    latent: 0,
    known: 0,
    pendingVerify: 0,
    diagnosed: false,
    tested: false,
    lastTested: null,
    lastIncident: null,
    ownerId,
    contributors: {},
    lastWorkTick: state.tick,
    createdTick: state.tick,
    completedTick: null,
    computeSpent: 0,
    rushWork: 0,
    history: [],
    ...extra,
  };
  state.structures.push(s);
  return s;
}

export function touch(state, s, text) {
  s.history.push({ tick: state.tick, text });
  if (s.history.length > 8) s.history.shift();
}

export function round2(v) { return Math.round(v * 100) / 100; }

/** The tile an agent stands on to work on something. */
export function standTile(state, x, y) {
  const cands = [[x, y + 1], [x + 1, y + 1], [x - 1, y + 1], [x + 1, y], [x - 1, y], [x, y - 1]];
  for (const [cx, cy] of cands) {
    if (cx < 0 || cy < 0 || cx >= state.w || cy >= state.h) continue;
    const t = state.tiles[cy * state.w + cx];
    if (t !== T.WATER) return { x: cx, y: cy };
  }
  return { x, y };
}

export { W, H, T };
