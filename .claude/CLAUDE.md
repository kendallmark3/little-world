# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Repository Rules
Read intent/current-feature.md first, including any deltas appended to it.
Run hooks/pre-implement.sh before implementing.
Build the smallest useful delta, then let the human observe it and decide: continue or stop.
Always write tests.
Respect architecture.

# This project
Two worlds on one engine (index.html lets you choose):
- The Little World — intent/current-feature.md (INTENT-001 + deltas); context/architecture.md and context/business-rules.md.
- Agent World — intent/agent-world.md (INTENT-002); context/agent-world.md. Keep src/agentworld/ pure and deterministic too.
Shared components (rng, path, clock, terrain, people rendering) must not change Little World behavior.
Keep src/sim/ pure and deterministic (no DOM, no Math.random, no Date). All randomness goes through src/sim/rng.js.
Run `npm test` after any change; run `npm run soak` after touching balance in RULES.
Do not expand into future-version scope (economics, physics, etc.) without a new intent or delta.

# Commands
Plain ES modules, Node >= 20. There is no build step, no linter, and no runtime dependencies.

```bash
npm start                                    # static server at http://localhost:5173 (scripts/serve.mjs)
npm test                                     # node --test tests/*.test.js + tests/pre-implement.test.sh (this is what CI runs)
node --test tests/sim.test.js                # a single test file
node --test --test-name-pattern="granary" tests/sim.test.js   # tests whose names match
npm run soak                                 # Little World: 10 headless days, seed 42, prints stats + chronicle
node scripts/soak.mjs <days> <seed> --log    # soak with other days/seed
hooks/pre-implement.sh [intent-file]         # gate: the intent must have Outcome and Success/Evidence sections
node scripts/agent-experiment.mjs --write    # rerun the Agent World experiment and rewrite docs/agent-world-evidence.md
node scripts/browser-check.mjs out 60        # Playwright smoke test of Little World (optional, needs Playwright)
node scripts/agent-world-check.mjs           # Playwright check of the chooser and Agent World
```

Reproducible worlds in the browser: `little-world.html?seed=42&fresh`, `agent-world.html?seed=42&config=mixed`.

# Architecture
Static browser app: canvas rendering and `localStorage` saves. Full map in context/architecture.md.

- **Sim / UI split.** `src/sim/` (Little World) and `src/agentworld/` (Agent World) hold all simulation state and rules. `src/ui/` reads that state and never writes to it. Transient visuals such as floating labels go through `sim.events`, which is not saved.
- **One serializable state object.** All of a world lives in `sim.state`, including the RNG state (`state.rng`). Save and restore are `JSON.stringify`/`JSON.parse`, and the same seed with the same inputs gives the same history. Tests depend on this, so don't hold sim state in module-level variables or closures.
- **Ticks.** Little World: 1 tick = 1 simulated minute (1,440 a day) at 24 ticks per real second at 1×. Agent World: 1 tick = half a simulated second, at 2 ticks per real second (`createClock(rate)`). The renderer interpolates display positions, so higher speeds look like a time-lapse.
- **Where tuning lives.** Little World numbers are in `RULES` at the top of `src/sim/sim.js`; context/business-rules.md documents every rule and number. Agent World roles, strategies and tunables are in `src/agentworld/rules.js`. Agent World's facade is `src/agentworld/sim.js` (`createAgentSim`, `step`, `run`, `serialize`).
- **Decisions explain themselves.** Little World inhabitants pick tasks by priority (hunger → sleep → evening → work → stroll), and each task stores a `reason` that the inspector shows. Agent World agents run Observe → Evaluate → Decide → Act → Learn every tick. Their choices come from scoring signals derived from world state (stigmergy), never from signals placed by hand. Keep reasons and utility terms inspectable when you change either one.
- **Reuse is one-way.** Agent World imports `src/sim/` (rng, path, clock, world generation) and the drawing helpers exported from `src/ui/render.js`. Changes to those shared files must keep Little World's tests and behavior unchanged.
- **Sound.** `src/ui/score.js` holds the pure, tested music rules. `src/ui/ambience.js` is the Web Audio engine, which runs on real time, not sim speed.

# Intent workflow
Changes start from an intent: INTENT-001 is intent/current-feature.md and INTENT-002 is intent/agent-world.md. New work is added as a delta appended to the intent file (template: templates/delta-template.md; the skills/progressive-intent skill writes these). Never rewrite the original intent. The agents/ folder holds the planner, developer, QA and reviewer role prompts.
