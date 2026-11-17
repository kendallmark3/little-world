// Converts real (render) time into simulation ticks. Rendering runs at the display's frame
// rate; the simulation advances in fixed one-minute ticks at a rate set by the speed control.

export const SIM_MINUTES_PER_SECOND = 24; // 1x speed: one simulated day per real minute
export const SPEEDS = [1, 3, 10, 30];
export const MAX_TICKS_PER_FRAME = 600;

/** rate = simulation ticks per real second at 1x (Little World: 24 minutes per second). */
export function createClock(rate = SIM_MINUTES_PER_SECOND) {
  return { paused: false, speed: 1, acc: 0, rate };
}

/** Advance by realMs of wall-clock time; returns the number of simulation ticks to run. */
export function advanceClock(clock, realMs) {
  if (clock.paused || realMs <= 0) return 0;
  clock.acc += (realMs / 1000) * (clock.rate ?? SIM_MINUTES_PER_SECOND) * clock.speed;
  let ticks = Math.floor(clock.acc);
  clock.acc -= ticks;
  if (ticks > MAX_TICKS_PER_FRAME) {
    ticks = MAX_TICKS_PER_FRAME; // a slow device skips time rather than freezing
    clock.acc = 0;
  }
  return ticks;
}

/** Fraction of the way to the next tick, for interpolation. */
export function tickFraction(clock) {
  return clock.acc;
}
