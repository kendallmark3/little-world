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
