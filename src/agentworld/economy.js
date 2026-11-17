// Resource model + metrics. Compute is the one shared, finite resource: construction spends
// it, running inefficient structures costs it, and healthy, used structures earn it back.
// Latent defects surface as production incidents under load. Balances never go negative.
import { AW_RULES, REWARD, TICKS_PER_SECOND } from './rules.js';
import { rand } from '../sim/rng.js';
import { computeUsage, effectiveReliability, isComplete, agentById, round2, exploredFraction, touch } from './world.js';
import { logEvent } from './events.js';

/** Runs once per simulated second. */
export function economySecond(sim) {
  const state = sim.state;
  let value = 0;
  let running = 0;
  for (const s of state.structures) {
    if (!isComplete(s)) continue;
    s.usage = round2(computeUsage(state, s));
    value += s.usage * effectiveReliability(s);
    running += s.usage * (1 - s.efficiency) * AW_RULES.runningCostFactor;
    const owner = agentById(state, s.ownerId);
    if (owner && s.usage > 0) owner.stats.credit = round2(owner.stats.credit + REWARD.royaltyPerUsage * s.usage);
  }
  const income = AW_RULES.computeBaseIncome + AW_RULES.computeValueIncome * value;
  const paid = Math.min(running, state.compute + income);
  state.compute = Math.max(0, state.compute + income - paid);
  state.counters.computeEarned = state.counters.computeEarned + income;
  state.counters.computeSpent = state.counters.computeSpent + paid;
  state.lastValue = round2(value);
  state.lastIncome = round2(income);
  state.lastRunning = round2(running);

  // Incidents: latent defects in used structures eventually fail in production.
  for (const s of state.structures) {
    if (!isComplete(s) || s.latent <= 0 || s.usage <= 0) continue;
    if (rand(state) >= s.latent * s.usage * 0.0012) continue;
    s.latent -= 1;
    s.known += 1;
    s.lastIncident = state.tick;
    s.reliability = round2(Math.max(0.2, s.reliability - 0.08));
    const penalty = Math.min(state.compute, AW_RULES.incidentPenalty);
    state.compute = state.compute - penalty;
    state.counters.incidentLoss = state.counters.incidentLoss + penalty;
    state.counters.defectsSurfaced++;
    touch(state, s, 'failed in production');
    logEvent(state, `${s.name} failed in production — a latent defect surfaced (${penalty} compute lost).`, 'incident', { structId: s.id });
    sim.events.push({ type: 'float', x: s.x + 0.5, y: s.y - 0.4, text: '⚠️ incident' });
  }
}

/** Live dashboard numbers, all derived from simulation state. */
export function metrics(state) {
  const live = state.structures.filter((s) => s.status !== 'abandoned');
  const complete = live.filter((s) => isComplete(s) && s.type !== 'connection');
  let wsum = 0;
  let rsum = 0;
  for (const s of complete) {
    const w = Math.max(0.5, s.usage);
    wsum += w;
    rsum += w * effectiveReliability(s);
  }
  const c = state.counters;
  return {
    activeAgents: state.agents.filter((a) => a.task && a.task.action !== 'rest' && a.task.action !== 'wander').length,
    resting: state.agents.filter((a) => a.task?.action === 'rest').length,
    completed: complete.length,
    connections: live.filter((s) => s.type === 'connection' && isComplete(s)).length,
    underConstruction: live.filter((s) => s.status === 'construction').length,
    reliability: wsum ? round2(rsum / wsum) : 0,
    usefulWork: Math.round(c.usefulWork),
    wastedWork: Math.round(c.wastedWork),
    computeSpent: Math.round(c.computeSpent),
    compute: Math.floor(state.compute),
    cooperation: c.cooperation,
    competition: c.competition,
    defectsFound: c.defectsFound,
    defectsSurfaced: c.defectsSurfaced,
    defectsDiscovered: c.defectsFound + c.defectsSurfaced,
    defectsRepaired: c.defectsRepaired,
    repairsVerified: c.repairsVerified,
    openDefects: live.reduce((n, s) => n + s.known, 0),
    reuses: c.reuses,
    domainsKnown: state.domains.filter((d) => d.discovered).length,
    explored: round2(exploredFraction(state)),
    decisions: c.decisions,
    contests: c.contests,
    handoffs: c.handoffs,
    abandoned: c.abandoned,
    value: state.lastValue || 0,
  };
}

/** A sample every 15 simulated seconds for the trend lines. */
export function sampleHistory(state) {
  if (state.tick % (15 * TICKS_PER_SECOND) !== 0) return;
  const m = metrics(state);
  state.history.push({ t: state.tick, completed: m.completed, reliability: m.reliability, compute: m.compute, coop: m.cooperation, comp: m.competition, open: m.openDefects, value: m.value });
  if (state.history.length > 480) state.history.shift();
}
