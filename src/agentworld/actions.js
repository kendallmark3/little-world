// Action executor + learning. Turns a chosen candidate into movement and work, validates it
// against the world at every step (targets change while agents travel), enforces reservations
// so no two agents modify the same thing at once, applies effects, and records outcomes.
import { AW_RULES, ACTIONS, STRUCTURES, REWARD, TICK_SECONDS } from './rules.js';
import { rand } from '../sim/rng.js';
import { findPath, walkable } from '../sim/path.js';
import {
  structById, domainById, agentById, isComplete, isLive, linkedIds, clamp, round2, standTile, newStructure,
  touch, reveal, HUB,
} from './world.js';
import { integrationPartner } from './signals.js';
import { logEvent } from './events.js';
import { can } from './decision.js';

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

export function startTask(sim, agent, c) {
  const state = sim.state;
  const stand = c.action === 'explore' || c.action === 'wander' ? { x: c.x, y: c.y } : c.action === 'rest' ? { x: HUB.x, y: HUB.y + 1 } : standTile(state, c.x, c.y);
  const path = findPath(state, Math.round(agent.x), Math.round(agent.y), stand.x, stand.y);
  agent.task = {
    action: c.action, label: ACTIONS[c.action].label, icon: ACTIONS[c.action].icon, key: c.key, target: c.target,
    targetId: c.targetId ?? null, partnerId: c.partnerId ?? null, libId: c.libId ?? null, buildOnLib: c.action === 'build' && !!c.libId, domainId: c.domainId ?? null,
    slotType: c.slotType ?? null, commonsId: c.commonsId ?? null, signalKey: c.signalKey ?? null, flaggedBy: c.flaggedBy ?? null,
    contest: !!c.contest, style: c.style || ACTIONS[c.action].style, nonExclusive: !!c.nonExclusive,
    tx: c.x, ty: c.y, dest: stand, path: path || [], phase: 'travel', startTick: state.tick, workTicks: 0, needTicks: 0,
    credit: 0, sinceCheck: 0, stall: 0,
  };
  agent.objective = `${ACTIONS[c.action].label}: ${c.target}`;
  agent.phase = 'act';
  if (!path) return finish(sim, agent, 'failed', 'no route to the target');
  if (!c.nonExclusive && !c.contest) state.reservations[c.key] = agent.id;
  return null;
}

// ---------------------------------------------------------------------------
// Validation (runs while travelling and again on arrival)
// ---------------------------------------------------------------------------

function stillValid(state, agent, t) {
  const s = t.targetId ? structById(state, t.targetId) : null;
  switch (t.action) {
    case 'build': {
      const d = domainById(state, t.domainId);
      const slot = d.slots[t.slotType];
      if (slot.structId) return 'someone already started it';
      const ready = STRUCTURES[t.slotType].requires.every((r) => isComplete(structById(state, d.slots[r].structId)));
      return ready ? null : 'its prerequisites are gone';
    }
    case 'construct': return s && s.status === 'construction' ? null : 'it is no longer under construction';
    case 'repair': return s && isComplete(s) && s.known > 0 ? null : 'the defect was already dealt with';
    case 'review': return s && isComplete(s) && ((s.known > 0 && !s.diagnosed) || s.complexity > 0.55) ? null : 'nothing left to review';
    case 'verify': return s && isComplete(s) && s.pendingVerify > 0 ? null : 'nothing left to verify';
    case 'test': return s && isComplete(s) && !s.tested ? null : 'it was already tested';
    case 'optimize': return s && isComplete(s) && s.efficiency < 0.95 ? null : 'it is already efficient';
    case 'connect': {
      const p = structById(state, t.partnerId);
      if (!s || !isComplete(s) || !p || !isComplete(p)) return 'an endpoint is not ready';
      if (linkedIds(state, s).size > 0) return 'it was connected by someone else';
      return null;
    }
    case 'reuse': {
      const lib = structById(state, t.libId);
      if (!s || !isComplete(s) || !lib || !isComplete(lib)) return 'library or service unavailable';
      return s.deps.includes(lib.id) ? 'it already uses the library' : null;
    }
    case 'design': return state.commons.find((c) => c.id === t.commonsId)?.structId ? 'the commons spot was taken' : null;
    case 'abandon': {
      if (!s || s.status !== 'construction') return 'it is no longer unfinished';
      if (state.tick - s.lastWorkTick < AW_RULES.staleTicks / 2) return 'someone resumed the work';
      return null;
    }
    case 'flag': {
      const sig = state.signals.find((o) => o.key === t.signalKey);
      return sig && sig.target > 0 ? null : 'the signal faded';
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Per-tick execution
// ---------------------------------------------------------------------------

export function runTask(sim, agent) {
  const state = sim.state;
  const t = agent.task;
  if (!t) { agent.phase = 'observe'; return; }

  if (t.phase === 'travel') {
    if (agent.energy <= 0.5 && t.action !== 'rest') return finish(sim, agent, 'failed', 'ran out of energy on the way');
    move(state, agent, t);
    if (++t.sinceCheck >= AW_RULES.recheckTicks) {
      t.sinceCheck = 0;
      const why = stillValid(state, agent, t);
      if (why) return finish(sim, agent, 'failed', `changed course: ${why}`);
    }
    if (t.path.length === 0) arrive(sim, agent, t);
    return;
  }
  work(sim, agent, t);
}

function move(state, agent, t) {
  let budget = AW_RULES.walkSpeed;
  while (budget > 0 && t.path.length) {
    const [nx, ny] = t.path[0];
    const dx = nx - agent.x;
    const dy = ny - agent.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      agent.x = nx; agent.y = ny; t.path.shift(); budget -= d;
    } else {
      agent.x += (dx / d) * budget; agent.y += (dy / d) * budget; budget = 0;
    }
  }
  agent.energy = Math.max(0, agent.energy - AW_RULES.energyWalk);
  if (state.tick % 2 === 0) discover(state, agent, reveal(state, agent.x, agent.y, AW_RULES.revealRadius[agent.role]));
}

/** Walking reveals the map; a domain is discovered when its site comes into view. */
function discover(state, agent, revealed) {
  if (agent.task) agent.task.revealed = (agent.task.revealed || 0) + revealed;
  for (const d of state.domains) {
    if (d.discovered) continue;
    if (!state.explored[d.cy * state.w + d.cx]) continue;
    d.discovered = true;
    d.discoveredBy = agent.id;
    d.discoveredTick = state.tick;
    state.counters.discoveries++;
    credit(agent, REWARD.discover);
    logEvent(state, `${agent.name} discovered the ${d.name} domain — it needs a repository.`, 'discover', { agentId: agent.id });
  }
}

function arrive(sim, agent, t) {
  const state = sim.state;
  const why = stillValid(state, agent, t);
  if (why) return finish(sim, agent, 'failed', why);

  if (!t.nonExclusive) {
    const holder = state.reservations[t.key];
    if (holder && holder !== agent.id) {
      const other = agentById(state, holder);
      if (!t.contest) return finish(sim, agent, 'failed', `${other?.name || 'someone'} got there first`);
      if (!contest(sim, agent, other, t)) return null;
    }
    state.reservations[t.key] = agent.id;
  }

  switch (t.action) {
    case 'build': {
      const d = domainById(state, t.domainId);
      const slot = d.slots[t.slotType];
      const s = newStructure(state, t.slotType, slot.x, slot.y, agent.id, { domainId: d.id });
      slot.structId = s.id;
      delete state.reservations[t.key];
      t.key = `s:${s.id}`;
      t.targetId = s.id;
      state.reservations[t.key] = agent.id;
      t.action = 'construct';
      t.label = 'Construct';
      touch(state, s, `${agent.name} broke ground`);
      const lib = t.buildOnLib ? structById(state, t.libId) : null;
      if (lib && isComplete(lib)) {
        s.deps.push(lib.id);
        s.complexity = round2(Math.max(0.15, s.complexity - 0.1));
        state.counters.reuses++;
        touch(state, lib, `reused by ${s.name}`);
      }
      logEvent(state, `${agent.name} started constructing ${s.name} (${d.name} ${STRUCTURES[s.type].label})${lib ? ` on shared ${lib.name}` : ''}.`, 'build', { agentId: agent.id, structId: s.id });
      if (lib && lib.ownerId !== agent.id) coop(state, agent, `${agent.name} reused ${lib.name} (designed by ${agentById(state, lib.ownerId)?.name || 'another agent'}) instead of writing it again.`, s);
      sim.events.push({ type: 'float', x: s.x + 0.5, y: s.y, text: '🔨 new' });
      break;
    }
    case 'connect': {
      const a = structById(state, t.targetId);
      const b = structById(state, t.partnerId);
      const link = newStructure(state, 'connection', a.x, a.y, agent.id, { a: a.id, b: b.id, domainId: a.domainId });
      state.reservations[`s:${link.id}`] = agent.id;
      t.linkKey = t.key;
      t.key = `s:${link.id}`;
      t.targetId = link.id;
      touch(state, link, `${agent.name} began linking ${a.name} and ${b.name}`);
      touch(state, a, `${agent.name} began a link to ${b.name}`);
      logEvent(state, `${agent.name} began an integration between ${a.name} and ${b.name}.`, 'connect', { agentId: agent.id, structId: link.id });
      delete state.reservations[t.linkKey];
      t.action = 'construct';
      t.label = 'Build integration';
      break;
    }
    case 'construct': {
      const s = structById(state, t.targetId);
      const others = Object.keys(s.contributors).filter((id) => Number(id) !== agent.id);
      if (!t.contest && (others.length || (s.ownerId && s.ownerId !== agent.id))) {
        t.handoff = true;
        const prev = agentById(state, s.ownerId);
        coop(state, agent, `${agent.name} picked up ${s.name} where ${prev && prev.id !== agent.id ? prev.name : 'others'} left it (${Math.round(s.progress * 100)}% built).`, s);
        state.counters.handoffs++;
      }
      break;
    }
    case 'rest': case 'wander': case 'explore': break;
    default: break;
  }
  const flagSig = t.signalKey && state.signals.find((o) => o.key === t.signalKey);
  if (t.flaggedBy && t.flaggedBy !== agent.id && t.action !== 'flag' && flagSig && !flagSig.answered) {
    flagSig.answered = true; // the first agent to act on a flag closes the loop
    const ex = agentById(state, t.flaggedBy);
    coop(state, agent, `${agent.name} answered ${ex?.name || 'an explorer'}'s flag on ${t.target}.`, t.targetId ? structById(state, t.targetId) : null);
  }

  if (t.action === 'wander') return finish(sim, agent, 'success', 'patrolled');
  if (t.action === 'explore') {
    credit(agent, (t.revealed || 0) * 0.02);
    return finish(sim, agent, (t.revealed || 0) > 0 ? 'success' : 'failed', (t.revealed || 0) > 0 ? `revealed ${t.revealed} tiles` : 'nothing new here');
  }
  t.phase = 'work';
  const dur = ACTIONS[t.action].dur;
  if (dur) t.needTicks = Math.ceil(dur / Math.max(0.3, skill(agent, t.action)) / TICK_SECONDS);
  return null;
}

function contest(sim, agent, other, t) {
  const state = sim.state;
  state.counters.competition++;
  state.counters.contests++;
  agent.stats.competition++;
  const otherWorking = other?.task && other.task.key === t.key && other.task.phase === 'work';
  if (!otherWorking) {
    // The holder is still on its way: whoever is standing here takes it.
    logEvent(state, `${agent.name} claimed ${t.target} ahead of ${other?.name || 'another agent'}.`, 'compete', { agentId: agent.id, structId: t.targetId });
    if (other) other.stats.competition++;
    return true;
  }
  const mine = skill(agent, t.action) * (0.5 + agent.energy / 200) + rand(state) * 0.35;
  const theirs = skill(other, t.action) * (0.5 + other.energy / 200) + rand(state) * 0.35;
  other.stats.competition++;
  if (mine > theirs) {
    logEvent(state, `${agent.name} contested ${t.target} and displaced ${other.name}.`, 'compete', { agentId: agent.id, structId: t.targetId });
    finish(sim, other, 'failed', `displaced by ${agent.name}`);
    return true;
  }
  logEvent(state, `${agent.name} contested ${t.target} but ${other.name} held on.`, 'compete', { agentId: agent.id, structId: t.targetId });
  finish(sim, agent, 'failed', `lost a contest to ${other.name}`);
  return false;
}

function skill(agent, action) {
  return agent.skills[action] ?? (action === 'construct' ? agent.skills.build : null) ?? 0.5;
}

function credit(agent, amount) {
  agent.stats.credit = round2(agent.stats.credit + amount);
  if (agent.task) agent.task.credit += amount;
}

function coop(state, agent, text, s) {
  state.counters.cooperation++;
  agent.stats.cooperation++;
  logEvent(state, text, 'coop', { agentId: agent.id, structId: s?.id ?? null });
}

// ---------------------------------------------------------------------------
// Work
// ---------------------------------------------------------------------------

function work(sim, agent, t) {
  const state = sim.state;
  const act = ACTIONS[t.action];
  // Validity can change under a worker's feet (an incident, a decommission...).
  if (t.workTicks % 10 === 0) {
    const why = stillValid(state, agent, t);
    if (why && t.action !== 'rest') return finish(sim, agent, 'failed', why);
  }
  t.workTicks++;

  if (t.action === 'rest') {
    agent.energy = Math.min(AW_RULES.maxEnergy, agent.energy + AW_RULES.energyRest);
    if (agent.energy >= 95) return finish(sim, agent, 'success', 'recharged');
    return null;
  }

  if (agent.energy < AW_RULES.minEnergyToWork) {
    return finish(sim, agent, t.action === 'construct' ? 'paused' : 'failed', 'ran out of energy mid-task');
  }
  const rush = agent.lean < 0.5 && t.action === 'construct';
  agent.energy = Math.max(0, agent.energy - AW_RULES.energyWork * act.energy * (rush ? AW_RULES.rushEnergy : 1));

  if (t.action === 'construct') return construct(sim, agent, t, rush);
  if (t.workTicks < t.needTicks) return null;
  return complete(sim, agent, t);
}

function construct(sim, agent, t, rush) {
  const state = sim.state;
  const s = structById(state, t.targetId);
  const spec = STRUCTURES[s.type];
  const onLib = s.deps.some((id) => structById(state, id)?.type === 'library');
  const cost = spec.cost * TICK_SECONDS * (rush ? AW_RULES.rushCost : 1) * (onLib ? 0.75 : 1);
  if (state.compute < cost) {
    if (++t.stall > 12) return finish(sim, agent, 'failed', 'shared compute ran dry');
    return null;
  }
  t.stall = 0;
  if (rush && state.compute < AW_RULES.scarceCompute && !t.rushCounted) {
    t.rushCounted = true;
    state.counters.competition++;
    state.counters.rushes++;
    agent.stats.competition++;
    logEvent(state, `${agent.name} rushed ${s.name}, spending double compute while the pool was low (${Math.floor(state.compute)}).`, 'compete', { agentId: agent.id, structId: s.id });
  }
  state.compute = state.compute - cost;
  state.counters.computeSpent = state.counters.computeSpent + cost;
  s.computeSpent = round2(s.computeSpent + cost);
  const sk = skill(agent, 'construct');
  const seconds = TICK_SECONDS * sk * (rush ? AW_RULES.rushSpeed : 1) * (onLib ? 1.25 : 1);
  s.progress = Math.min(1, s.progress + seconds / spec.work);
  s.workDone = round2(s.workDone + TICK_SECONDS);
  if (rush) s.rushWork = round2(s.rushWork + TICK_SECONDS);
  s.contributors[agent.id] = round2((s.contributors[agent.id] || 0) + TICK_SECONDS);
  s.lastWorkTick = state.tick;
  credit(agent, REWARD.workPerSecond * TICK_SECONDS);
  if (s.progress < 1) return null;

  // Finished.
  const rushFrac = s.workDone ? s.rushWork / s.workDone : 0;
  const builders = Object.keys(s.contributors).map((id) => agentById(state, Number(id))).filter(Boolean);
  const avgSkill = builders.reduce((a, b) => a + skill(b, 'construct'), 0) / Math.max(1, builders.length);
  const usesLib = s.deps.some((id) => structById(state, id)?.type === 'library');
  const lambda = s.complexity * (1.8 - avgSkill) * (1 + rushFrac * (AW_RULES.rushDefects - 1)) * (usesLib ? 0.7 : 1);
  s.latent = Math.min(3, Math.floor(lambda + rand(state)));
  s.reliability = round2(clamp(0.72 + 0.22 * avgSkill - rushFrac * 0.1, 0.3, 0.98));
  s.efficiency = round2(clamp(0.45 + 0.35 * avgSkill - rushFrac * 0.15, 0.2, 0.95));
  s.status = 'complete';
  s.completedTick = state.tick;
  s.progress = 1;
  if (s.domainId && s.type !== 'connection') {
    const d = domainById(state, s.domainId);
    for (const req of STRUCTURES[s.type].requires) if (d.slots[req].structId) s.deps.push(d.slots[req].structId);
    if (s.type === 'api' && d.slots.datastore.structId) s.deps.push(d.slots.datastore.structId);
  }
  state.counters.completed++;
  state.counters.usefulWork = round2(state.counters.usefulWork + s.workDone);
  credit(agent, REWARD.completion);
  touch(state, s, `${agent.name} completed it`);
  if (s.type === 'connection') {
    const a = structById(state, s.a);
    const b = structById(state, s.b);
    state.counters.connections++;
    logEvent(state, `Integration established: ${a.name} ↔ ${b.name} (by ${agent.name}).`, 'connect', { agentId: agent.id, structId: s.id });
    if (a.ownerId !== agent.id || b.ownerId !== agent.id) coop(state, agent, `${agent.name} connected work built by ${[a, b].map((o) => agentById(state, o.ownerId)?.name).filter((n, i, arr) => n && n !== agent.name && arr.indexOf(n) === i).join(' and ') || 'others'}.`, s);
    touch(state, a, `linked to ${b.name}`);
    touch(state, b, `linked to ${a.name}`);
  } else {
    logEvent(state, `${agent.name} completed ${s.name}${builders.length > 1 ? ` (built by ${builders.map((b) => b.name).join(', ')})` : ''}.`, 'complete', { agentId: agent.id, structId: s.id });
  }
  sim.events.push({ type: 'float', x: s.x + 0.5, y: s.y - 0.4, text: `✓ ${s.name}` });
  return finish(sim, agent, 'success', `completed ${s.name}`);
}

function complete(sim, agent, t) {
  const state = sim.state;
  const s = t.targetId ? structById(state, t.targetId) : null;
  const sk = skill(agent, t.action);
  const ownerName = s ? agentById(state, s.ownerId)?.name : null;
  const others = s && s.ownerId !== agent.id;
  switch (t.action) {
    case 'test': {
      let found = 0;
      for (let i = 0; i < s.latent; i++) if (rand(state) < sk * 0.8) found++;
      s.latent -= found;
      s.known += found;
      s.tested = true;
      s.lastTested = state.tick;
      state.counters.defectsFound += found;
      credit(agent, found ? REWARD.defectFound * found : REWARD.testedClean);
      touch(state, s, found ? `${agent.name} found ${found} defect${found > 1 ? 's' : ''}` : `${agent.name} tested it clean`);
      if (found) {
        logEvent(state, `${agent.name} identified ${found} defect${found > 1 ? 's' : ''} in ${s.name}.`, 'defect', { agentId: agent.id, structId: s.id });
        sim.events.push({ type: 'float', x: s.x + 0.5, y: s.y - 0.4, text: `🐞 ×${found}` });
      } else {
        logEvent(state, `${agent.name} tested ${s.name}: no defects found.`, 'test', { agentId: agent.id, structId: s.id });
      }
      return finish(sim, agent, 'success', found ? `found ${found} defect(s)` : 'tested clean');
    }
    case 'repair': {
      const p = clamp(0.72 + 0.25 * sk + (s.diagnosed ? 0.12 : 0), 0, 0.98);
      if (rand(state) > p) {
        touch(state, s, `${agent.name}'s repair did not hold`);
        logEvent(state, `${agent.name}'s repair of ${s.name} did not hold.`, 'fail', { agentId: agent.id, structId: s.id });
        return finish(sim, agent, 'failed', 'the repair did not hold');
      }
      s.known -= 1;
      s.pendingVerify += 1;
      s.repairedBy = agent.id;
      s.reliability = round2(Math.min(0.99, s.reliability + 0.06));
      state.counters.defectsRepaired++;
      credit(agent, REWARD.repair);
      touch(state, s, `${agent.name} repaired a defect`);
      logEvent(state, `${agent.name} repaired ${s.name}${s.diagnosed ? ' (using the architecture review)' : ''}.`, 'repair', { agentId: agent.id, structId: s.id });
      if (others) coop(state, agent, `${agent.name} fixed a defect in ${ownerName}'s ${s.name}.`, s);
      sim.events.push({ type: 'float', x: s.x + 0.5, y: s.y - 0.4, text: '🔧 fixed' });
      return finish(sim, agent, 'success', `repaired ${s.name}`);
    }
    case 'verify': {
      s.pendingVerify -= 1;
      s.reliability = round2(Math.min(0.99, s.reliability + 0.04));
      state.counters.repairsVerified++;
      credit(agent, REWARD.verify);
      touch(state, s, `${agent.name} verified the repair`);
      const fixer = agentById(state, s.repairedBy);
      logEvent(state, `${agent.name} verified ${fixer && fixer.id !== agent.id ? `${fixer.name}'s` : 'the'} repair of ${s.name}.`, 'verify', { agentId: agent.id, structId: s.id });
      if (fixer && fixer.id !== agent.id) { state.counters.cooperation++; agent.stats.cooperation++; }
      return finish(sim, agent, 'success', `verified ${s.name}`);
    }
    case 'review': {
      const before = s.complexity;
      s.complexity = round2(Math.max(0.15, s.complexity - 0.12 * sk));
      if (s.known > 0) s.diagnosed = true;
      s.reliability = round2(Math.min(0.99, s.reliability + 0.03));
      credit(agent, REWARD.review);
      touch(state, s, `${agent.name} reviewed it`);
      logEvent(state, `${agent.name} reviewed ${s.name}: complexity ${before.toFixed(2)} → ${s.complexity.toFixed(2)}${s.diagnosed ? ', root cause diagnosed' : ''}.`, 'review', { agentId: agent.id, structId: s.id });
      return finish(sim, agent, 'success', `reviewed ${s.name}`);
    }
    case 'optimize': {
      const before = s.efficiency;
      s.efficiency = round2(Math.min(0.97, s.efficiency + 0.2 * sk));
      credit(agent, REWARD.optimize);
      touch(state, s, `${agent.name} optimized it`);
      logEvent(state, `${agent.name} improved ${s.name} efficiency ${Math.round(before * 100)}% → ${Math.round(s.efficiency * 100)}%.`, 'optimize', { agentId: agent.id, structId: s.id });
      return finish(sim, agent, 'success', `optimized ${s.name}`);
    }
    case 'reuse': {
      const lib = structById(state, t.libId);
      s.deps.push(lib.id);
      if (s.latent > 0 && rand(state) < 0.5) s.latent -= 1; // shared, already-tested code replaces a buggy copy
      s.complexity = round2(Math.max(0.15, s.complexity - 0.1));
      s.reliability = round2(Math.min(0.99, s.reliability + 0.04));
      state.counters.reuses++;
      credit(agent, REWARD.reuse);
      touch(state, s, `${agent.name} adopted ${lib.name}`);
      touch(state, lib, `adopted by ${s.name}`);
      logEvent(state, `${agent.name} moved ${s.name} onto ${lib.name} (shared capability reused).`, 'reuse', { agentId: agent.id, structId: s.id });
      if (lib.ownerId !== agent.id || others) coop(state, agent, `${agent.name} reused ${lib.name}, built by others, in ${s.name}.`, s);
      return finish(sim, agent, 'success', `reused ${lib.name}`);
    }
    case 'design': {
      const c = state.commons.find((o) => o.id === t.commonsId);
      const lib = newStructure(state, 'library', c.x, c.y, agent.id);
      lib.progress = 0.04;
      c.structId = lib.id;
      credit(agent, REWARD.design);
      touch(state, lib, `${agent.name} designed it`);
      logEvent(state, `${agent.name} designed ${lib.name} in the commons to hold code the services were duplicating.`, 'design', { agentId: agent.id, structId: lib.id });
      return finish(sim, agent, 'success', `designed ${lib.name}`);
    }
    case 'abandon': {
      const refund = round2(s.computeSpent * 0.3);
      s.status = 'abandoned';
      state.compute = state.compute + refund;
      state.counters.refunds = state.counters.refunds + refund;
      state.counters.abandoned++;
      state.counters.wastedWork = round2(state.counters.wastedWork + s.workDone);
      for (const d of state.domains) for (const slot of Object.values(d.slots)) if (slot.structId === s.id) slot.structId = null;
      for (const c of state.commons) if (c.structId === s.id) c.structId = null;
      credit(agent, REWARD.abandon);
      touch(state, s, `${agent.name} decommissioned it`);
      logEvent(state, `${agent.name} decommissioned stale ${s.name} (${Math.round(s.progress * 100)}% built), recovering ${refund} compute.`, 'abandon', { agentId: agent.id, structId: s.id });
      return finish(sim, agent, 'success', `decommissioned ${s.name}`);
    }
    case 'flag': {
      const sig = state.signals.find((o) => o.key === t.signalKey);
      sig.boost = Math.min(0.6, sig.boost + 0.35);
      sig.flaggedBy = agent.id;
      sig.answered = false;
      state.counters.flags++;
      credit(agent, REWARD.flag);
      logEvent(state, `${agent.name} flagged ${t.target} (signal ${sig.base.toFixed(2)} → ${(sig.base + sig.boost).toFixed(2)}).`, 'flag', { agentId: agent.id, structId: sig.sourceId ?? null });
      return finish(sim, agent, 'success', 'flagged it');
    }
    default:
      return finish(sim, agent, 'success', 'done');
  }
}

// ---------------------------------------------------------------------------
// Finish + Learn
// ---------------------------------------------------------------------------

export function finish(sim, agent, result, reason) {
  const state = sim.state;
  const t = agent.task;
  if (t) {
    for (const k of [t.key, t.linkKey]) if (k && state.reservations[k] === agent.id) delete state.reservations[k];
    const seconds = Math.max(1, (state.tick - t.startTick) / 2);
    const entry = { tick: state.tick, action: t.action, label: t.label, target: t.target, result, reason, credit: round2(t.credit), seconds: Math.round(seconds) };
    agent.history.unshift(entry);
    if (agent.history.length > 12) agent.history.pop();
    if (result === 'success') { agent.stats.success++; state.counters.successfulActions++; }
    else if (result === 'failed') { agent.stats.failed++; state.counters.failedActions++; }
    else agent.stats.paused++;
    learn(state, agent, t, result, t.credit / seconds);
  }
  agent.task = null;
  agent.phase = 'learn';
  agent.phaseTicks = 1;
  agent.objective = result === 'success' ? `Done: ${reason}` : `Rethinking — ${reason}`;
  return null;
}

/** Learn: success rate per action for everyone; adaptive agents also re-weigh their strategy. */
function learn(state, agent, t, result, rate) {
  if (t.action === 'rest' || t.action === 'wander') return;
  const prev = agent.learned.success[t.action] ?? 0.85;
  const outcome = result === 'failed' ? 0 : 1;
  agent.learned.success[t.action] = round2(prev + (outcome - prev) * 0.25);
  if (agent.strategy !== 'adaptive' || (t.style !== 'coop' && t.style !== 'comp')) return;
  const sr = agent.learned.styleReward;
  sr[t.style] = sr[t.style] === null ? round2(rate) : round2(sr[t.style] + (rate - sr[t.style]) * 0.3);
  if (sr.coop === null || sr.comp === null) return;
  const before = agent.lean;
  const dir = sr.coop > sr.comp ? 1 : sr.coop < sr.comp ? -1 : 0;
  agent.lean = round2(clamp(agent.lean + dir * AW_RULES.adaptiveStep, 0.1, 0.9));
  if ((before >= 0.5) !== (agent.lean >= 0.5)) {
    logEvent(state, `${agent.name} (adaptive) now leans ${agent.lean >= 0.5 ? 'cooperative' : 'competitive'}: cooperative work earned ${sr.coop}/s vs competitive ${sr.comp}/s.`, 'adapt', { agentId: agent.id });
  }
}

export { can, walkable, isLive };
