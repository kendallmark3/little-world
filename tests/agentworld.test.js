// Agent World: deterministic checks of decisions, signals, resources, and state transitions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSim, step, run, runMinutes, serialize, deserialize, metrics } from '../src/agentworld/sim.js';
import { ROLES, ROLE_ORDER, STRUCTURES, CONFIGS, AW_RULES, TICKS_PER_MINUTE } from '../src/agentworld/rules.js';
import { evaluate, generateCandidates, decide, can } from '../src/agentworld/decision.js';
import { observe } from '../src/agentworld/perception.js';
import { updateSignals, perceivedStrength } from '../src/agentworld/signals.js';
import { newStructure, structById, HUB } from '../src/agentworld/world.js';

const TEN_MIN = 10 * TICKS_PER_MINUTE;

function dev(sim, n = 1) {
  return sim.state.agents.find((a) => a.name === `Developer-00${n}`);
}

/** Put an unfinished structure in a domain slot, as if someone had started it. */
function plantUnfinished(sim, ownerId, progress = 0.4) {
  const s = sim.state;
  const d = s.domains[0];
  const slot = d.slots.repository;
  const st = newStructure(s, 'repository', slot.x, slot.y, ownerId, { domainId: d.id });
  st.progress = progress;
  st.contributors[ownerId] = 10;
  slot.structId = st.id;
  return st;
}

test('a new Agent World has ten agents with the intended roles and every required attribute', () => {
  const sim = createAgentSim(42);
  const agents = sim.state.agents;
  assert.equal(agents.length, 10);
  for (const role of ROLE_ORDER) assert.equal(agents.filter((a) => a.role === role).length, ROLES[role].count, role);
  assert.equal(new Set(agents.map((a) => a.name)).size, 10, 'unique identities');
  for (const a of agents) {
    for (const k of ['id', 'name', 'role', 'strategy', 'lean', 'skills', 'energy', 'objective', 'memory', 'history', 'phase']) assert.ok(k in a, `${a.name} has ${k}`);
    assert.ok(Object.keys(a.skills).length > 0);
  }
  assert.deepEqual(Object.keys(STRUCTURES).sort(), ['api', 'connection', 'datastore', 'library', 'repository', 'service']);
  assert.equal(sim.state.domains.filter((d) => d.discovered).length, 1, 'only Identity is known at the start');
  assert.ok(sim.state.tiles.includes(1), 'reuses the Little World river terrain');
});

test('configurations set the strategy mix: cooperative, competitive, and mixed worlds', () => {
  const count = (cfg, strat) => createAgentSim(1, cfg).state.agents.filter((a) => a.strategy === strat).length;
  assert.ok(count('cooperative', 'cooperative') >= 7);
  assert.ok(count('competitive', 'competitive') >= 7);
  const mixed = createAgentSim(1, 'mixed').state.agents;
  for (const s of ['cooperative', 'competitive', 'adaptive']) assert.ok(mixed.some((a) => a.strategy === s), s);
});

test('same seed and configuration reproduce the same world; save/restore continues identically', () => {
  const a = createAgentSim(123, 'mixed');
  const b = createAgentSim(123, 'mixed');
  run(a, 900); run(b, 900);
  assert.equal(serialize(a), serialize(b));
  const c = createAgentSim(123, 'competitive');
  run(c, 900);
  assert.notEqual(serialize(a), serialize(c));
  const d = deserialize(serialize(a));
  run(a, 300); run(d, 300);
  assert.equal(serialize(a), serialize(d));
});

test('ten simulated minutes keep the world consistent: no negative balances, no conflicting work, only capable actions', () => {
  for (const cfg of Object.keys(CONFIGS)) {
    const sim = createAgentSim(42, cfg);
    const bad = [];
    sim.onDecision = (agent, decision) => {
      if (!can(agent, decision.chosen.action)) bad.push(`${agent.name} chose ${decision.chosen.action}`);
    };
    const statusOf = new Map();
    for (let i = 0; i < TEN_MIN; i++) {
      step(sim);
      const s = sim.state;
      assert.ok(s.compute >= 0, `compute ${s.compute}`);
      const working = new Map();
      for (const a of s.agents) {
        assert.ok(a.energy >= 0 && a.energy <= AW_RULES.maxEnergy, `${a.name} energy ${a.energy}`);
        if (a.task && a.task.phase === 'work' && !a.task.nonExclusive) {
          assert.ok(!working.has(a.task.key), `${a.name} and ${working.get(a.task.key)} both working ${a.task.key}`);
          working.set(a.task.key, a.name);
          assert.equal(s.reservations[a.task.key], a.id, `${a.name} works without holding ${a.task.key}`);
        }
      }
      for (const [key, id] of Object.entries(s.reservations)) {
        const holder = s.agents.find((a) => a.id === id);
        assert.ok(holder?.task && (holder.task.key === key || holder.task.linkKey === key), `stale reservation ${key}`);
      }
      for (const st of s.structures) {
        assert.ok(st.progress >= 0 && st.progress <= 1);
        assert.ok(st.known >= 0 && st.latent >= 0 && st.pendingVerify >= 0);
        const prev = statusOf.get(st.id);
        if (prev && prev !== st.status) assert.equal(prev, 'construction', `${st.name}: ${prev} → ${st.status}`);
        statusOf.set(st.id, st.status);
      }
    }
    assert.deepEqual(bad, [], cfg);
    // Resource accounting closes: start + earned + refunds − spent − incident losses = balance.
    const c = sim.state.counters;
    const expected = AW_RULES.computeStart + c.computeEarned + c.refunds - c.computeSpent - c.incidentLoss;
    assert.ok(Math.abs(expected - sim.state.compute) < 0.01, `${cfg}: ledger ${expected.toFixed(2)} vs pool ${sim.state.compute}`);
  }
});

test('agents construct a software ecosystem without central coordination', () => {
  const sim = createAgentSim(42, 'mixed');
  runMinutes(sim, 10);
  const m = metrics(sim.state);
  assert.ok(m.completed >= 10, `completed ${m.completed}`);
  assert.ok(m.connections >= 1, 'at least one integration');
  assert.ok(m.domainsKnown >= 4, 'explorers discovered domains');
  assert.ok(m.defectsDiscovered >= 1, 'defects were discovered');
  const types = new Set(sim.state.structures.filter((s) => s.status === 'complete').map((s) => s.type));
  for (const t of ['repository', 'service', 'api', 'connection']) assert.ok(types.has(t), t);
});

test('perception is local: a distant structure and its signal are invisible to an agent', () => {
  const sim = createAgentSim(42);
  const d = dev(sim);
  const st = plantUnfinished(sim, d.id);
  updateSignals(sim.state);
  d.x = st.x; d.y = st.y + 1;
  assert.ok(observe(sim.state, d).structures.some((p) => p.id === st.id));
  assert.ok(observe(sim.state, d).signals.some((s) => s.kind === 'construction' && s.sourceId === st.id));
  d.x = sim.state.w - 2; d.y = sim.state.h - 2; d.memory = [];
  const far = observe(sim.state, d);
  assert.ok(!far.structures.some((p) => p.id === st.id));
  assert.ok(!far.signals.some((s) => s.sourceId === st.id));
});

test('signals originate from real state, have strength, and decay once resolved', () => {
  const sim = createAgentSim(42);
  const st = plantUnfinished(sim, dev(sim).id, 0.5);
  for (let i = 0; i < 6; i++) updateSignals(sim.state);
  const sig = () => sim.state.signals.find((s) => s.key === `construction:${st.id}`);
  assert.ok(sig().strength > 0.5, 'construction signal grows while work is unfinished');
  st.status = 'complete'; st.progress = 1; st.reliability = 0.9; st.efficiency = 0.6; st.known = 2;
  updateSignals(sim.state);
  assert.equal(sig().target, 0, 'cause gone: target is zero');
  const before = sig().strength;
  updateSignals(sim.state);
  assert.ok(sig().strength < before, 'and the strength decays');
  for (let i = 0; i < 60; i++) updateSignals(sim.state);
  assert.equal(sig(), undefined, 'eventually it disappears');
  assert.ok(sim.state.signals.some((s) => s.key === `failure:${st.id}`), 'known defects raise a failure signal');
  assert.ok(sim.state.signals.some((s) => s.key === `verification:${st.id}`), 'an untested structure asks for verification');
  // Strong signals carry further than weak ones.
  const strong = { x: 0, y: 0, strength: 0.9, target: 0.9 };
  const weak = { x: 0, y: 0, strength: 0.2, target: 0.2 };
  assert.ok(perceivedStrength(strong, 18, 0, 9) > 0);
  assert.equal(perceivedStrength(weak, 18, 0, 9), 0);
});

test('an explorer flag boosts a signal and the boost fades on its own', () => {
  const sim = createAgentSim(42);
  const st = plantUnfinished(sim, dev(sim).id, 0.3);
  for (let i = 0; i < 6; i++) updateSignals(sim.state);
  const sig = sim.state.signals.find((s) => s.key === `construction:${st.id}`);
  sig.boost = 0.35;
  updateSignals(sim.state);
  const boosted = sig.strength;
  for (let i = 0; i < 120; i++) updateSignals(sim.state);
  assert.ok(sig.strength < boosted - 0.2, `boost faded: ${boosted} → ${sig.strength}`);
});

test('utility responds to signal strength, distance, and energy', () => {
  const sim = createAgentSim(42);
  const a = dev(sim);
  const st = plantUnfinished(sim, sim.state.agents[1].id, 0.4);
  a.x = st.x; a.y = st.y + 1;
  const cand = { action: 'construct', key: `s:${st.id}`, targetId: st.id, x: st.x, y: st.y, signal: 0.4 };
  const weak = evaluate(sim.state, a, cand).utility;
  const strong = evaluate(sim.state, a, { ...cand, signal: 0.9 }).utility;
  assert.ok(strong > weak, `${strong} > ${weak}`);
  a.x = st.x + 20;
  assert.ok(evaluate(sim.state, a, { ...cand, signal: 0.9 }).utility < strong, 'travel costs utility');
  a.energy = 5;
  assert.equal(evaluate(sim.state, a, cand).valid, false, 'too tired to construct');
});

test('strategies change action selection: cooperators finish others’ work, competitors favor owning new work', () => {
  const sim = createAgentSim(42);
  const a = dev(sim);
  const st = plantUnfinished(sim, sim.state.agents[1].id, 0.4);
  const d = sim.state.domains[0];
  a.x = st.x; a.y = st.y + 1; a.energy = 90;
  const finishOthers = { action: 'construct', key: `s:${st.id}`, targetId: st.id, x: st.x, y: st.y, signal: 0.6 };
  const ownNew = { action: 'build', key: `slot:${d.id}:service`, domainId: d.id, slotType: 'service', x: d.slots.service.x, y: d.slots.service.y, signal: 0.6 };
  const margin = (lean) => { a.lean = lean; return evaluate(sim.state, a, finishOthers).utility - evaluate(sim.state, a, ownNew).utility; };
  assert.ok(margin(0.85) > margin(0.15), 'cooperators value finishing others’ work relatively more');
  // Reservations: a cooperator will not contest; a competitor may.
  sim.state.reservations[finishOthers.key] = sim.state.agents[2].id;
  a.lean = 0.85;
  assert.equal(evaluate(sim.state, a, finishOthers).valid, false);
  a.lean = 0.15;
  const r = evaluate(sim.state, a, finishOthers);
  assert.ok(r.valid && r.contest);
});

test('decisions are explainable: the recorded reason and terms come from the scoring', () => {
  const sim = createAgentSim(42);
  const a = dev(sim);
  const p = observe(sim.state, a);
  const { chosen, decision } = decide(sim.state, a, p);
  const shown = decision.candidates.find((c) => c.chosen);
  assert.ok(shown, 'the chosen candidate is in the trace');
  const sum = Math.round(shown.terms.reduce((s, [, v]) => s + v, 0) * 100) / 100;
  assert.ok(Math.abs(sum - shown.utility) < 0.02, 'utility is exactly the sum of its terms');
  assert.ok(decision.reason.includes(String(chosen.utility)));
  assert.ok(generateCandidates(sim.state, a, p).every((c) => can(a, c.action)), 'only capable actions are generated');
});

test('stigmergy: one agent’s unfinished work changes another agent’s independent decision', () => {
  const sim = createAgentSim(42);
  const s = sim.state;
  const a = dev(sim, 1);
  const b = dev(sim, 2);
  // Without the unfinished structure, B never considers constructing it.
  b.x = s.domains[0].cx; b.y = s.domains[0].cy + 1; b.energy = 90;
  const before = generateCandidates(s, b, observe(s, b));
  assert.ok(!before.some((c) => c.action === 'construct'));
  // A starts something and leaves (out of energy). The world now carries a construction signal.
  const st = plantUnfinished(sim, a.id, 0.6);
  for (let i = 0; i < 6; i++) updateSignals(s);
  b.memory = [];
  const after = generateCandidates(s, b, observe(s, b));
  const c = after.find((o) => o.action === 'construct' && o.targetId === st.id);
  assert.ok(c, 'B perceives the signal and generates a construct option');
  assert.equal(c.signalKind, 'construction');

  // And across a real run, agents do pick up work others left behind.
  const sim2 = createAgentSim(42, 'mixed');
  const handoffs = [];
  sim2.onDecision = (agent, decision) => {
    const ch = decision.candidates.find((o) => o.chosen);
    if (ch?.action === 'construct' && ch.terms.some(([k]) => k.startsWith('finish others'))) handoffs.push(`${agent.name}: ${ch.target}`);
  };
  runMinutes(sim2, 10);
  assert.ok(handoffs.length >= 1, 'at least one agent chose to finish another agent’s work');
  assert.ok(sim2.state.counters.handoffs >= 1);
});

test('rest restores energy at the Hub and exhaustion stops work instead of going negative', () => {
  const sim = createAgentSim(42);
  const a = dev(sim);
  a.energy = 8;
  const cands = generateCandidates(sim.state, a, observe(sim.state, a)).map((c) => ({ ...c, ...evaluate(sim.state, a, c) })).filter((c) => c.valid);
  const best = cands.sort((x, y) => y.utility - x.utility)[0];
  assert.equal(best.action, 'rest');
  assert.ok(Math.hypot(best.x - HUB.x, best.y - HUB.y) < 1);
});

test('ten simulated minutes in all three worlds run quickly enough for the browser', () => {
  const t0 = performance.now();
  for (const cfg of Object.keys(CONFIGS)) runMinutes(createAgentSim(7, cfg), 10);
  const ms = performance.now() - t0;
  assert.ok(ms < 3000, `${Math.round(ms)} ms`);
});

test('structure history records real modifications', () => {
  const sim = createAgentSim(42, 'mixed');
  runMinutes(sim, 6);
  const done = sim.state.structures.filter((s) => s.status === 'complete' && s.type !== 'connection');
  assert.ok(done.length > 0);
  for (const s of done) {
    assert.ok(s.history.length > 0, s.name);
    assert.ok(structById(sim.state, s.id) === s);
  }
});
