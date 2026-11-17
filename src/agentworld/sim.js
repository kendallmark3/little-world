// Agent World — simulation facade. One tick = half a simulated second.
// Each agent runs its own cycle: Observe → Evaluate → Decide → Act → Learn.
// Pure and deterministic: same seed + same configuration + same inputs = same world.
import { createWorldState } from './world.js';
import { observe } from './perception.js';
import { decide } from './decision.js';
import { startTask, runTask } from './actions.js';
import { updateSignals } from './signals.js';
import { economySecond, sampleHistory, metrics } from './economy.js';
import { TICKS_PER_MINUTE } from './rules.js';
import { logEvent, formatSimTime } from './events.js';
import { CONFIGS } from './rules.js';

export function createAgentSim(seed, config = 'mixed') {
  const state = createWorldState(seed, config);
  const sim = { state, events: [], onDecision: null };
  updateSignals(state);
  logEvent(state, `${CONFIGS[state.config].label}, seed ${state.seed}: ten agents gather at the Hub. Identity is the only known domain.`, 'info');
  return sim;
}

export function step(sim) {
  const state = sim.state;
  state.tick++;
  const n = state.agents.length;
  const start = state.tick % n; // rotate turn order so nobody always moves first
  for (let i = 0; i < n; i++) cycle(sim, state.agents[(start + i) % n]);
  if (state.tick % 2 === 0) {
    economySecond(sim);
    updateSignals(state);
  }
  sampleHistory(state);
}

function cycle(sim, agent) {
  const state = sim.state;
  switch (agent.phase) {
    case 'learn':
      if (--agent.phaseTicks <= 0) { agent.phase = 'observe'; agent.phaseTicks = 0; }
      return;
    case 'observe':
      if (agent.phaseTicks > 0) { agent.phaseTicks--; return; }
      agent.perception = observe(state, agent);
      agent.phase = 'decide';
      return;
    case 'decide': {
      const { chosen, decision } = decide(state, agent, agent.perception);
      agent.decision = decision;
      state.counters.decisions++;
      if (sim.onDecision) sim.onDecision(agent, decision, agent.perception);
      startTask(sim, agent, chosen);
      return;
    }
    default:
      runTask(sim, agent);
  }
}

export function run(sim, ticks) {
  for (let i = 0; i < ticks; i++) step(sim);
  return sim;
}

export function runMinutes(sim, minutes) {
  return run(sim, Math.round(minutes * TICKS_PER_MINUTE));
}

export function serialize(sim) {
  return JSON.stringify(sim.state);
}

export function deserialize(text) {
  return { state: JSON.parse(text), events: [], onDecision: null };
}

export function simTime(sim) {
  return formatSimTime(sim.state.tick);
}

export { metrics, formatSimTime, CONFIGS };
