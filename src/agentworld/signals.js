// Environmental signal system — the stigmergy at the heart of Agent World.
// Every signal is derived from real world state (an unfinished build, a known defect, an
// isolated service...). Each has a measurable strength that rises while its cause persists,
// decays once the cause is resolved, and spreads further the stronger it is. Explorers can
// add a "pheromone" boost on top, which fades on its own. Agents are free to ignore any of it.
import { AW_RULES, STRUCTURES, DOMAIN_SLOTS } from './rules.js';
import {
  isComplete, isLive, effectiveReliability, structById, linkedIds, dependents, clamp,
} from './world.js';

const RISE_PER_SECOND = 0.12;
const DECAY_PER_SECOND = 0.9;   // a resolved signal loses 10% a second
const BOOST_DECAY = 0.985;      // explorer flags fade over about a minute

/** What the environment is "saying" right now: target strengths keyed by source. */
export function signalTargets(state) {
  const out = new Map();
  const add = (kind, key, x, y, strength, ref) => {
    out.set(`${kind}:${key}`, { kind, x, y, strength: clamp(strength, 0, 1), ...ref });
  };
  const tick = state.tick;

  // Demand: a discovered domain wants the next structure its prerequisites allow.
  for (const d of state.domains) {
    if (!d.discovered) continue;
    for (const type of DOMAIN_SLOTS) {
      const slot = d.slots[type];
      if (slot.structId) continue;
      const ready = STRUCTURES[type].requires.every((req) => isComplete(structById(state, d.slots[req].structId)));
      if (!ready) { slot.openTick = null; continue; }
      if (slot.openTick === null) slot.openTick = tick;
      const ageSec = (tick - slot.openTick) / 2;
      add('demand', `${d.id}:${type}`, slot.x, slot.y, d.demand * (0.55 + 0.45 * Math.min(1, ageSec / 120)), { domainId: d.id, slotType: type });
    }
  }

  const completeServices = [];
  let libraries = 0;
  for (const s of state.structures) {
    if (!isLive(s)) continue;
    if (s.type === 'library') libraries++;
    if (s.status === 'construction') {
      add('construction', s.id, s.x, s.y, 0.45 + 0.45 * s.progress, { sourceId: s.id });
      const idle = tick - s.lastWorkTick;
      if (idle > AW_RULES.staleTicks && s.progress < 0.5 && !state.reservations[`s:${s.id}`]) {
        add('stale', s.id, s.x, s.y, 0.35 + Math.min(0.5, (idle - AW_RULES.staleTicks) / 600), { sourceId: s.id });
      }
      continue;
    }
    if (s.type === 'connection') continue;
    if (s.known > 0 || s.pendingVerify > 0) {
      const recent = s.lastIncident !== null && tick - s.lastIncident < 120 ? 0.2 : 0;
      add('failure', s.id, s.x, s.y, 0.45 + 0.2 * s.known + 0.15 * s.pendingVerify + recent, { sourceId: s.id });
    }
    if (!s.tested) add('verification', s.id, s.x, s.y, 0.45 + 0.08 * s.usage, { sourceId: s.id });
    if ((s.type === 'api' || s.type === 'service') && linkedIds(state, s).size === 0 && hasPartner(state, s)) {
      add('integration', s.id, s.x, s.y, 0.3 + 0.12 * s.usage, { sourceId: s.id });
    }
    if (s.complexity > 0.55 && s.type !== 'library') add('complexity', s.id, s.x, s.y, (s.complexity - 0.4) * 1.6, { sourceId: s.id });
    const waste = s.usage * (1 - s.efficiency);
    if (waste > 0.6) add('optimization', s.id, s.x, s.y, waste / 3, { sourceId: s.id });
    if (s.type === 'library') add('reuse', s.id, s.x, s.y, 0.5 + 0.15 * dependents(state, s), { sourceId: s.id });
    if (s.type === 'service') completeServices.push(s);
  }

  // Duplication: several services, too few shared libraries to hold their common code.
  const wanted = Math.floor(completeServices.length / 2);
  if (libraries < wanted) {
    const spot = state.commons.find((c) => !c.structId);
    if (spot) add('duplication', `commons:${spot.id}`, spot.x, spot.y, 0.4 + 0.15 * (completeServices.length - 2 * libraries), { commonsId: spot.id });
  }
  return out;
}

/** A partner for integration: a finished API, service or library in another domain, not yet linked. */
export function hasPartner(state, s) {
  return !!integrationPartner(state, s);
}

export function integrationPartner(state, s) {
  const linked = linkedIds(state, s);
  let best = null;
  let bd = Infinity;
  for (const o of state.structures) {
    if (o === s || !isComplete(o) || linked.has(o.id)) continue;
    if (!['api', 'service', 'library'].includes(o.type)) continue;
    if (o.domainId === s.domainId && o.type !== 'library') continue;
    const d = Math.hypot(o.x - s.x, o.y - s.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Called once per simulated second. Strengths chase their targets; resolved signals decay away. */
export function updateSignals(state) {
  const targets = signalTargets(state);
  const byKey = new Map(state.signals.map((s) => [s.key, s]));
  for (const [key, t] of targets) {
    let sig = byKey.get(key);
    if (!sig) {
      sig = { key, ...t, base: 0, boost: 0, strength: 0, born: state.tick, flaggedBy: null };
      state.signals.push(sig);
      byKey.set(key, sig);
    }
    sig.x = t.x; sig.y = t.y;
    sig.target = t.strength;
    if (sig.base < t.strength) sig.base = Math.min(t.strength, sig.base + RISE_PER_SECOND);
    else sig.base = Math.max(t.strength, sig.base * DECAY_PER_SECOND);
  }
  for (const sig of state.signals) {
    if (!targets.has(sig.key)) { sig.target = 0; sig.base *= DECAY_PER_SECOND; }
    sig.boost *= BOOST_DECAY;
    if (sig.boost < 0.02) sig.boost = 0;
    sig.strength = Math.round((sig.base + sig.boost) * 1000) / 1000;
  }
  state.signals = state.signals.filter((s) => s.target > 0 || s.base + s.boost > 0.03);
}

/** How far a signal of a given strength carries: strong signals are noticed from further away. */
export function signalRange(strength, perceptionRadius) {
  return perceptionRadius + 14 * strength;
}

/** The strength an agent at (x,y) actually perceives. */
export function perceivedStrength(sig, x, y, perceptionRadius) {
  if (sig.target === 0) return 0; // resolved: the cause is gone even if the glow lingers
  const d = Math.hypot(sig.x - x, sig.y - y);
  const range = signalRange(sig.strength, perceptionRadius);
  return d >= range ? 0 : sig.strength * (1 - (d / range) * 0.6);
}

export { effectiveReliability };
