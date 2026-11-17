// Decision engine: Observe → Evaluate → Decide. Each agent turns its own perception into
// candidate actions its role is capable of, scores each with a strategy-weighted utility,
// and makes a seeded probabilistic choice. The factors that produced each score are kept
// and shown in the inspector verbatim — explanations are never written after the fact.
import { AW_RULES, ACTIONS, ROLES, REWARD, STRUCTURES } from './rules.js';
import { rand } from '../sim/rng.js';
import { integrationPartner } from './signals.js';
import {
  structById, domainById, isComplete, linkedIds, dependents, clamp, round2, HUB, isExplored, agentById,
} from './world.js';
import { walkable } from '../sim/path.js';

export function can(agent, action) {
  return ROLES[agent.role].actions.includes(action);
}

/** Every action the agent could take, given only what it perceives and remembers. */
export function generateCandidates(state, agent, perception) {
  const out = [];
  const add = (c) => {
    if (!can(agent, c.action)) return;
    if (out.some((o) => o.action === c.action && o.key === c.key && o.libId === c.libId)) return;
    out.push(c);
  };
  const sigs = [...perception.signals, ...perception.remembered];
  for (const sig of sigs) {
    const base = { signalKey: sig.key, signalKind: sig.kind, signal: sig.perceived, fromMemory: !!sig.fromMemory, flaggedBy: sig.flaggedBy ?? null };
    const s = sig.sourceId ? structById(state, sig.sourceId) : null;
    switch (sig.kind) {
      case 'demand': {
        const d = domainById(state, sig.domainId);
        const slot = d.slots[sig.slotType];
        add({ ...base, action: 'build', key: `slot:${d.id}:${sig.slotType}`, domainId: d.id, slotType: sig.slotType, x: slot.x, y: slot.y, target: `${d.name} ${STRUCTURES[sig.slotType].label}` });
        // Reuse signal: a finished shared library this agent can sense makes "build on it" an option.
        if (sig.slotType === 'service' || sig.slotType === 'api') {
          for (const r of sigs.filter((o) => o.kind === 'reuse')) {
            const lib = structById(state, r.sourceId);
            if (!lib || !isComplete(lib)) continue;
            add({ ...base, action: 'build', key: `slot:${d.id}:${sig.slotType}`, domainId: d.id, slotType: sig.slotType, x: slot.x, y: slot.y, libId: lib.id, reuseSignal: r.perceived, target: `${d.name} ${STRUCTURES[sig.slotType].label} on ${lib.name}` });
          }
        }
        break;
      }
      case 'construction':
        if (s) add({ ...base, action: 'construct', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'stale':
        if (s) add({ ...base, action: 'abandon', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'failure':
        if (!s) break;
        if (s.known > 0) add({ ...base, action: 'repair', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        if (s.known > 0 && !s.diagnosed) add({ ...base, action: 'review', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        if (s.pendingVerify > 0) add({ ...base, action: 'verify', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'complexity':
        if (s) add({ ...base, action: 'review', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'verification':
        if (s) add({ ...base, action: 'test', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'integration': {
        if (!s) break;
        const partner = integrationPartner(state, s);
        if (partner) add({ ...base, action: 'connect', key: `link:${s.id}`, targetId: s.id, partnerId: partner.id, x: s.x, y: s.y, target: `${s.name} ↔ ${partner.name}` });
        break;
      }
      case 'optimization':
        if (s) add({ ...base, action: 'optimize', key: `s:${s.id}`, targetId: s.id, x: s.x, y: s.y, target: s.name });
        break;
      case 'reuse': {
        if (!s || !can(agent, 'reuse')) break;
        // Adopt the library in the nearest finished service this agent knows of that lacks it.
        let best = null;
        let bd = Infinity;
        for (const id of agent.knownStructs || []) {
          const svc = structById(state, id);
          if (!svc || svc.type !== 'service' || !isComplete(svc) || svc.deps.includes(s.id)) continue;
          const d = Math.hypot(svc.x - agent.x, svc.y - agent.y);
          if (d < bd) { bd = d; best = svc; }
        }
        if (best) add({ ...base, action: 'reuse', key: `s:${best.id}`, targetId: best.id, libId: s.id, x: best.x, y: best.y, target: `${s.name} → ${best.name}` });
        break;
      }
      case 'duplication': {
        const c = state.commons.find((o) => o.id === sig.commonsId);
        if (c) add({ ...base, action: 'design', key: `commons:${c.id}`, commonsId: c.id, x: c.x, y: c.y, target: 'a shared library in the commons' });
        break;
      }
      default:
    }
    // Explorers can amplify any opportunity they can currently see, for others to find.
    if (can(agent, 'flag') && !sig.fromMemory && ['demand', 'construction', 'failure', 'integration', 'stale', 'verification'].includes(sig.kind) && sig.boost < 0.15 && sig.flaggedBy !== agent.id) {
      add({ ...base, action: 'flag', key: `flag:${sig.key}`, x: sig.x, y: sig.y, target: sig.label, nonExclusive: true });
    }
  }

  if (can(agent, 'explore')) for (const c of frontierTargets(state, agent)) add(c);
  add({ action: 'rest', key: `rest:${agent.id}`, x: HUB.x, y: HUB.y, target: 'the Hub', signal: 0, nonExclusive: true });
  const w = wanderTarget(state, agent);
  add({ action: 'wander', key: `wander:${agent.id}`, x: w.x, y: w.y, target: `(${w.x}, ${w.y})`, signal: 0, nonExclusive: true });
  return out;
}

function frontierTargets(state, agent) {
  const picks = [];
  for (let i = 0; i < 4; i++) {
    let x = 0; let y = 0; let ok = false;
    for (let tries = 0; tries < 30 && !ok; tries++) {
      x = Math.floor(rand(state) * state.w);
      y = Math.floor(rand(state) * state.h);
      ok = walkable(state, x, y) && !isExplored(state, x, y);
    }
    if (!ok) continue;
    let unexplored = 0;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const tx = x + dx; const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= state.w || ty >= state.h) continue;
      if (!state.explored[ty * state.w + tx]) unexplored++;
    }
    picks.push({ action: 'explore', key: `explore:${x}:${y}`, x, y, target: `frontier (${x}, ${y})`, signal: round2(unexplored / 81), unexplored, nonExclusive: true });
  }
  return picks;
}

function wanderTarget(state, agent) {
  for (let tries = 0; tries < 20; tries++) {
    const x = clamp(Math.round(agent.x + (rand(state) - 0.5) * 14), 1, state.w - 2);
    const y = clamp(Math.round(agent.y + (rand(state) - 0.5) * 10), 1, state.h - 2);
    if (walkable(state, x, y)) return { x, y };
  }
  return { x: HUB.x, y: HUB.y + 1 };
}

// ---------------------------------------------------------------------------
// Evaluate
// ---------------------------------------------------------------------------

function skillFor(agent, action) {
  return agent.skills[action] ?? (action === 'construct' ? agent.skills.build : null) ?? 0.5;
}

function successRate(agent, action) {
  return agent.learned.success[action] ?? 0.85;
}

/** Expected personal credit and shared ecosystem value of a candidate, from current state. */
function payoff(state, agent, c) {
  const s = c.targetId ? structById(state, c.targetId) : null;
  switch (c.action) {
    case 'build': {
      const spec = STRUCTURES[c.slotType];
      const base = { personal: REWARD.completion + spec.work * REWARD.workPerSecond + spec.usage * 1.5, shared: spec.usage * 1.0 };
      if (c.libId) {
        // Building on a shared library: cheaper, fewer defects, and it strengthens the commons.
        const lib = structById(state, c.libId);
        base.personal += REWARD.reuse * 0.5;
        base.shared += 1.2 + dependents(state, lib) * 0.3;
      }
      return base;
    }
    case 'construct': {
      const spec = STRUCTURES[s.type];
      const remaining = (1 - s.progress) * spec.work;
      const usage = s.type === 'connection' ? 2 : s.type === 'library' ? 2.5 : spec.usage;
      return { personal: REWARD.completion + remaining * REWARD.workPerSecond, shared: usage * (0.5 + s.progress) };
    }
    case 'repair': return { personal: REWARD.repair, shared: 1 + s.usage * 0.5 };
    case 'review': return { personal: REWARD.review, shared: s.complexity * 2 + s.known * 0.5 };
    case 'verify': return { personal: REWARD.verify, shared: 0.8 + s.usage * 0.3 };
    case 'test': return { personal: REWARD.testedClean + REWARD.defectFound * s.complexity, shared: 0.8 + s.usage * 0.4 };
    case 'connect': {
      const p = structById(state, c.partnerId);
      return { personal: REWARD.connect, shared: (s.usage + (p?.usage || 0)) * 0.35 + 1 };
    }
    case 'reuse': {
      const lib = structById(state, c.libId);
      return { personal: REWARD.reuse, shared: 3 + dependents(state, lib) * 0.3 + s.latent * 0.5 };
    }
    case 'design': return { personal: REWARD.design, shared: 2.5 };
    case 'abandon': return { personal: REWARD.abandon, shared: 1.2 };
    case 'optimize': return { personal: REWARD.optimize, shared: s.usage * (1 - s.efficiency) * 1.5 };
    case 'flag': return { personal: REWARD.flag, shared: 1.2 * c.signal + 0.4 };
    case 'explore': return { personal: REWARD.discover * 0.5, shared: 2 };
    default: return { personal: 0, shared: 0 };
  }
}

/**
 * Utility of one candidate. Returns the score plus the exact factors that produced it.
 * benefit = (wPersonal·personal + wShared·shared) × (0.35 + signal) × skill
 * utility = benefit + strategy terms − travel − energy − risk − crowding − scarcity
 */
export function evaluate(state, agent, c) {
  const act = ACTIONS[c.action];
  const dist = Math.hypot(c.x - agent.x, c.y - agent.y);
  const terms = [];
  const result = { utility: 0, terms, valid: true, contest: false, dist: Math.round(dist * 10) / 10 };

  if (agent.energy < act.minEnergy) {
    result.valid = false;
    result.invalid = `needs ${act.minEnergy} energy, has ${Math.floor(agent.energy)}`;
    return result;
  }
  const holder = c.nonExclusive ? null : state.reservations[c.key];
  if (holder && holder !== agent.id) {
    const who = agentById(state, holder)?.name || 'someone';
    if (agent.lean >= 0.5) {
      result.valid = false;
      result.invalid = `${who} is already on it`;
      return result;
    }
    result.contest = true;
    result.holder = who;
  }

  if (c.action === 'rest') {
    const tired = 1 - agent.energy / AW_RULES.maxEnergy;
    const u = 7 * tired * tired + (agent.energy < 20 ? 3 : 0);
    terms.push(['fatigue', round2(u)], ['travel', round2(-dist * AW_RULES.travelCost * 0.4)]);
    result.utility = round2(u - dist * AW_RULES.travelCost * 0.4);
    return result;
  }
  if (c.action === 'wander') {
    terms.push(['baseline', 0.15]);
    result.utility = 0.15;
    return result;
  }

  const lean = agent.lean;
  const wShared = 0.3 + 0.9 * lean;
  const wPersonal = 1.2 - 0.8 * lean;
  const skill = skillFor(agent, c.action);
  const { personal, shared } = payoff(state, agent, c);
  const benefit = (wPersonal * personal + wShared * shared) * (0.35 + c.signal) * skill;
  result.inputs = { signal: c.signal, skill: round2(skill), personal: round2(personal), shared: round2(shared), wPersonal: round2(wPersonal), wShared: round2(wShared) };
  terms.push(['benefit', round2(benefit)]);

  const s = c.targetId ? structById(state, c.targetId) : null;
  // Strategy terms: cooperators like finishing and fixing others' work; competitors like owning new work.
  const othersWork = s && ((s.ownerId && s.ownerId !== agent.id) || Object.keys(s.contributors).some((id) => Number(id) !== agent.id));
  let style = act.style;
  if (c.action === 'construct' && othersWork) { terms.push(['finish others’ work', round2(lean * 1.2)]); style = 'coop'; }
  if (c.action === 'construct' && !othersWork) style = 'comp';
  if (c.action === 'build') terms.push(['ownership', round2((1 - lean) * 1.6)]);
  if (c.libId) { terms.push(['reuse signal', round2(c.reuseSignal * 0.8)]); style = 'coop'; }
  if (c.flaggedBy && c.flaggedBy !== agent.id) terms.push(['flagged by explorer', round2(0.25 + lean * 0.35)]);
  if (result.contest) { terms.push(['contest ' + result.holder, round2(-1 + (1 - lean) * 0.4)]); style = 'comp'; }
  terms.push(['travel', round2(-dist * AW_RULES.travelCost)]);
  if (act.energy > 0) terms.push(['energy', round2(-(1 - agent.energy / AW_RULES.maxEnergy) * 1.2 * act.energy)]);
  const risk = (1 - successRate(agent, c.action)) * 2;
  if (risk > 0.05) terms.push(['learned risk', round2(-risk)]);
  if (c.fromMemory) terms.push(['remembered, unconfirmed', -0.3]);
  // Compute is shared and finite. Cooperators hold back on construction when the pool is low.
  if (['build', 'construct', 'connect'].includes(c.action) && state.compute < 150) {
    terms.push(['scarce compute', round2(-(1 - state.compute / 150) * 2.5 * lean)]);
  }
  result.style = style;
  result.utility = round2(terms.reduce((sum, [, v]) => sum + v, 0));
  return result;
}

// ---------------------------------------------------------------------------
// Decide
// ---------------------------------------------------------------------------

const MAX_SHOWN = 7;

export function decide(state, agent, perception) {
  const candidates = generateCandidates(state, agent, perception).map((c) => ({ ...c, ...evaluate(state, agent, c) }));
  const valid = candidates.filter((c) => c.valid).sort((a, b) => b.utility - a.utility);
  const pool = valid.slice(0, 6);
  const top = pool[0].utility;
  const weights = pool.map((c) => Math.exp((c.utility - top) / AW_RULES.temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  pool.forEach((c, i) => { c.prob = round2(weights[i] / total); });
  let roll = rand(state) * total;
  let chosen = pool[pool.length - 1];
  for (let i = 0; i < pool.length; i++) {
    roll -= weights[i];
    if (roll <= 0) { chosen = pool[i]; break; }
  }
  const shown = [...valid.slice(0, MAX_SHOWN), ...candidates.filter((c) => !c.valid).slice(0, 3)];
  const decision = {
    tick: state.tick,
    strategy: agent.strategy,
    lean: round2(agent.lean),
    candidates: shown.map((c) => ({
      action: c.action, label: ACTIONS[c.action].label, target: c.target, utility: c.utility, prob: c.prob ?? 0,
      valid: c.valid, invalid: c.invalid || null, terms: c.terms, inputs: c.inputs || null, contest: c.contest,
      chosen: c === chosen, signalKind: c.signalKind || null, dist: c.dist, fromMemory: !!c.fromMemory,
    })),
    considered: candidates.length,
    chosen: { action: chosen.action, label: ACTIONS[chosen.action].label, target: chosen.target, utility: chosen.utility, prob: chosen.prob },
    reason: explain(chosen, pool),
  };
  return { chosen, decision };
}

/** The reason is assembled from the same terms that produced the score. */
function explain(c, pool) {
  const parts = [];
  if (c.inputs) {
    const kind = c.signalKind ? `${c.signalKind} signal ${c.inputs.signal.toFixed(2)}` : c.action === 'explore' ? `${Math.round(c.inputs.signal * 100)}% unexplored around target` : 'no signal';
    parts.push(`${kind}${c.fromMemory ? ' (remembered)' : ''}, skill ${c.inputs.skill}`);
    parts.push(`weighted personal ${c.inputs.personal}×${c.inputs.wPersonal} + shared ${c.inputs.shared}×${c.inputs.wShared}`);
  }
  const extras = c.terms.filter(([k]) => k !== 'benefit').sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 3);
  for (const [k, v] of extras) if (Math.abs(v) >= 0.05) parts.push(`${k} ${v > 0 ? '+' : ''}${v}`);
  const runner = pool.find((o) => o !== c);
  const rank = pool.indexOf(c);
  let tail = `utility ${c.utility}, chosen with p=${c.prob}`;
  if (rank > 0) tail += ` (ranked #${rank + 1}; seeded exploration over ${pool[0].action} ${pool[0].utility})`;
  else if (runner) tail += `; next best ${ACTIONS[runner.action].label.toLowerCase()} ${runner.utility}`;
  parts.push(tail);
  return parts.join('; ') + '.';
}
