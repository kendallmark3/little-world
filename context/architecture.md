# Architecture

Static browser app. No backend, no build step, no runtime dependencies.

```
index.html, styles.css      page shell (LTM design: white, quiet grays, one blue accent)
src/sim/                    the simulation — pure, deterministic, no DOM
  rng.js                    seeded mulberry32; generator state lives in state.rng
  world.js                  map generation and placement rules (trees, houses, fields)
  path.js                   BFS pathfinding on the 48x32 grid (only water blocks)
  sim.js                    inhabitants, occupations, economy, construction, log, save/restore
  clock.js                  real time -> simulation ticks (pause, 1x/3x/10x/30x)
src/ui/
  render.js                 canvas renderer; reads state, never writes it
  main.js                   loop, input, panel, localStorage persistence
  score.js                  pure soundtrack rules: piano phrases, sound modes, pause/night mix
  ambience.js               Web Audio engine: synthesized waves + piano (real time, ignores sim speed)
tests/sim.test.js           deterministic rule tests (node:test)
tests/score.test.js         soundtrack rule tests
scripts/                    serve.mjs (local server), soak.mjs (headless days), browser-check.mjs (Playwright smoke)
```

## Key decisions

- **One tick = one simulated minute.** A day is 1,440 ticks. At 1x the clock runs 24 ticks per real second, so a day takes one real minute and ten minutes of watching is roughly ten days.
- **Simulation time is separate from render time.** The sim advances in fixed ticks; the renderer keeps its own display position per inhabitant and chases the sim position at a capped visual speed. At 10x and 30x you see a smooth time-lapse instead of people teleporting. A slow frame skips sim time rather than replaying it (`MAX_TICKS_PER_FRAME`).
- **All state is one JSON-serializable object** (`sim.state`), including the RNG state. Save = `JSON.stringify`, restore = `JSON.parse`. Same seed + same inputs = same history (tested).
- **Decisions are rules, not animations.** Each inhabitant, when idle, picks a task by priority: hunger → sleep (night or exhausted) → evening leisure → occupation work → stroll. Every task records a human-readable `reason`, which the inspector shows as "Why".
- **The renderer may not mutate sim state.** Transient visual events (floating "+3 🍞") go through `sim.events`, which is not saved.

## Extending

New mechanics belong in `src/sim/` with a test in `tests/`. New visuals belong in `src/ui/render.js`. Tune balance in `RULES` at the top of `sim.js` and check with `npm run soak`.
