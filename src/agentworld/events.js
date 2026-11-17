// Event history: every line in the activity feed comes from here, and every call site is an
// actual action or state transition. Transient visual effects go to sim.events (not saved).
const MAX_LOG = 600;

export function logEvent(state, text, kind = 'info', ref = {}) {
  state.logSeq = (state.logSeq || 0) + 1;
  state.log.push({ seq: state.logSeq, tick: state.tick, text, kind, agentId: ref.agentId ?? null, structId: ref.structId ?? null });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

export function formatSimTime(tick) {
  const sec = Math.floor(tick / 2);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
