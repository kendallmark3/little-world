// Perception engine: what one agent can actually see from where it stands, plus what it
// remembers. Agents never read the whole world — only this.
import { AW_RULES, STRUCTURES, SIGNALS } from './rules.js';
import { perceivedStrength } from './signals.js';
import { structById, isComplete, linkedIds, round2 } from './world.js';
import { logEvent } from './events.js';

export function observe(state, agent) {
  const radius = AW_RULES.perceptionRadius[agent.role];
  const structures = [];
  for (const s of state.structures) {
    if (s.status === 'abandoned') continue;
    const d = Math.hypot(s.x - agent.x, s.y - agent.y);
    if (d > radius) continue;
    structures.push({ id: s.id, name: s.name, type: s.type, status: s.status, dist: round1(d) });
  }
  structures.sort((a, b) => a.dist - b.dist);
  // Limited spatial memory: the structures this agent has walked past, most recent first.
  const knownIds = [...structures.map((p) => p.id), ...(agent.knownStructs || []).filter((id) => !structures.some((p) => p.id === id))];
  agent.knownStructs = knownIds.filter((id) => structById(state, id)).slice(0, 24);

  const agents = [];
  for (const o of state.agents) {
    if (o === agent) continue;
    const d = Math.hypot(o.x - agent.x, o.y - agent.y);
    if (d > radius) continue;
    agents.push({ id: o.id, name: o.name, role: o.role, dist: round1(d), activity: o.task ? o.task.label : o.objective });
  }
  agents.sort((a, b) => a.dist - b.dist);

  const signals = [];
  for (const sig of state.signals) {
    const p = perceivedStrength(sig, agent.x, agent.y, radius);
    if (p < 0.05) continue;
    signals.push(snapshot(sig, p, Math.hypot(sig.x - agent.x, sig.y - agent.y), false, state));
  }
  signals.sort((a, b) => b.perceived - a.perceived);

  // Memory: what was noticed before but is out of sight now. Remembered strength fades.
  const seen = new Set(signals.map((s) => s.key));
  const remembered = [];
  for (const m of agent.memory) {
    if (seen.has(m.key)) continue;
    const live = state.signals.find((s) => s.key === m.key);
    const ageSec = (state.tick - m.tick) / 2;
    const p = m.strength * 0.6 * Math.max(0, 1 - ageSec / 180);
    if (p < 0.05) continue;
    // A memory can be wrong: the agent only learns the cause is gone when it gets there.
    remembered.push({ ...m, perceived: round2(p), dist: round1(Math.hypot(m.x - agent.x, m.y - agent.y)), fromMemory: true, stillThere: !!live && live.target > 0 });
  }

  // Update memory: keep the strongest recent things, a handful at most.
  const fresh = signals.slice(0, AW_RULES.memorySize).map((s) => ({ key: s.key, kind: s.kind, x: s.x, y: s.y, strength: s.perceived, sourceId: s.sourceId ?? null, domainId: s.domainId ?? null, slotType: s.slotType ?? null, commonsId: s.commonsId ?? null, label: s.label, tick: state.tick }));
  const merged = [...fresh, ...agent.memory.filter((m) => !fresh.some((f) => f.key === m.key))];
  agent.memory = merged.slice(0, AW_RULES.memorySize);

  // Explorers report opportunities they come across for the first time.
  if (agent.role === 'Explorer') {
    agent.seen = agent.seen || [];
    for (const sig of signals) {
      if (!['construction', 'failure', 'stale'].includes(sig.kind) || agent.seen.includes(sig.key)) continue;
      agent.seen.push(sig.key);
      if (agent.seen.length > 60) agent.seen.shift();
      const s = structById(state, sig.sourceId);
      if (!s) continue;
      const what = sig.kind === 'failure' ? `a defective ${STRUCTURES[s.type].label.toLowerCase()}` : sig.kind === 'stale' ? `stale, abandoned-looking work` : `an unfinished ${STRUCTURES[s.type].label.toLowerCase()}`;
      logEvent(state, `${agent.name} discovered ${what} (${s.name}).`, 'discover', { agentId: agent.id, structId: s.id });
    }
  }

  return {
    tick: state.tick,
    radius,
    structures,
    agents,
    signals,
    remembered,
    observations: describe(state, agent, structures, signals),
  };
}

function snapshot(sig, perceived, dist, fromMemory, state) {
  const s = sig.sourceId ? structById(state, sig.sourceId) : null;
  const d = sig.domainId ? state.domains.find((o) => o.id === sig.domainId) : null;
  let label = SIGNALS[sig.kind].label;
  if (s) label += ` · ${s.name}`;
  else if (d) label += ` · ${d.name} ${STRUCTURES[sig.slotType].label}`;
  else if (sig.commonsId) label += ' · commons';
  return {
    key: sig.key, kind: sig.kind, x: sig.x, y: sig.y,
    perceived: round2(perceived), raw: round2(sig.strength), boost: round2(sig.boost), flaggedBy: sig.flaggedBy,
    dist: round1(dist), sourceId: sig.sourceId ?? null, domainId: sig.domainId ?? null, slotType: sig.slotType ?? null,
    commonsId: sig.commonsId ?? null, label, fromMemory,
  };
}

/** Plain-language facts about what the agent sees, computed from real state at observation time. */
function describe(state, agent, structures, signals) {
  const out = [];
  const byType = {};
  for (const p of structures) (byType[p.type] = byType[p.type] || []).push(structById(state, p.id));
  const svc = [...(byType.service || []), ...(byType.api || [])].filter(isComplete);
  if (svc.length) {
    const linked = svc.filter((s) => linkedIds(state, s).size > 0).map((s) => s.name);
    const isolated = svc.filter((s) => linkedIds(state, s).size === 0).map((s) => s.name);
    let line = `Sees ${svc.length} finished service${svc.length > 1 ? 's/APIs' : '/API'}`;
    if (linked.length) line += `; connected: ${linked.join(', ')}`;
    if (isolated.length) line += `; isolated: ${isolated.join(', ')}`;
    out.push(line + '.');
  }
  for (const s of structures.map((p) => structById(state, p.id))) {
    if (s.status === 'construction') {
      const idle = Math.round((state.tick - s.lastWorkTick) / 2);
      const who = state.reservations[`s:${s.id}`];
      const holder = who ? state.agents.find((a) => a.id === who)?.name : null;
      out.push(`${s.name} is ${Math.round(s.progress * 100)}% built${holder ? `, ${holder} is on it` : idle > 20 ? `, untouched for ${idle}s` : ''}.`);
    } else if (s.known > 0) out.push(`${s.name} has ${s.known} known defect${s.known > 1 ? 's' : ''}.`);
    else if (s.pendingVerify > 0) out.push(`${s.name} has a repair nobody has verified.`);
    else if (isComplete(s) && !s.tested && s.type !== 'connection') out.push(`${s.name} has never been tested.`);
  }
  const unexplored = state.domains.filter((d) => d.discovered).length;
  if (agent.role === 'Explorer') out.push(`${unexplored} of ${state.domains.length} domains are known.`);
  if (!signals.length) out.push('No signals within range.');
  return out.slice(0, 7);
}

function round1(v) { return Math.round(v * 10) / 10; }
