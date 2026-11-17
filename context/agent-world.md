# Agent World — how it works

INTENT-002 ([intent/agent-world.md](../intent/agent-world.md)). Ten autonomous engineering agents build a software ecosystem through local decisions, environmental signals (stigmergy), and strategy-weighted utility (game theory). No agent is assigned work; there is no coordinator. Runs entirely in the browser, deterministic from a seed.

Generated evidence from real runs: [docs/agent-world-evidence.md](../docs/agent-world-evidence.md).

## Reused from Little World

| Little World component | How Agent World uses it |
| --- | --- |
| `src/sim/world.js` `generateWorld` | The same river, road, bridge and woods, generated from the seed; Agent World then clears lots for its domains and the Hub. |
| `src/sim/rng.js` | The same seeded mulberry32 stream, stored in `state.rng`, so save/restore and replays are exact. |
| `src/sim/path.js` | BFS pathfinding for every agent trip (only water blocks movement). |
| `src/sim/clock.js` | The same clock; it now takes a tick rate (`createClock(rate)`, default unchanged at 24 for Little World). Agent World runs 2 ticks per real second at 1×. |
| `src/ui/render.js` | Terrain, river animation, trees, people (`drawPerson` now accepts a `color`), floating labels, `roundRect`, `glow` — exported, otherwise unchanged. |
| `src/ui/ambience.js`, `score.js` | The same synthesized waves + piano soundtrack and sound button. |
| `styles.css` | The whole LTM visual system (top bar, segmented controls, cards, stats, bars, feed). `agentworld.css` only adds what is new. |

Little World's simulation behavior did not change. Its 25 rule tests and the Playwright browser check pass unchanged (the page moved from `index.html` to `little-world.html`; `index.html` is now **Choose Your World**).

## New modules (`src/agentworld/`, pure and deterministic — no DOM, no `Math.random`, no `Date`)

| Logical module | File |
| --- | --- |
| World state, structures, helpers | `world.js` |
| Agent model, roles, strategies, every tunable number | `rules.js` |
| Perception engine | `perception.js` |
| Decision engine (candidates, utility, seeded choice) | `decision.js` |
| Action executor, reservations, learning | `actions.js` |
| Environmental signal system | `signals.js` |
| Resource model + simulation metrics | `economy.js` |
| Event history | `events.js` |
| Facade: step / run / serialize | `sim.js` |
| Rendering adapter | `src/ui/agentworld-render.js` |
| Inspector UI, feed, dashboard, controls | `src/ui/agentworld-main.js`, `agent-world.html`, `agentworld.css` |

One tick is half a simulated second. Every agent runs its own cycle each tick: **Observe → Evaluate → Decide → Act → Learn**. Turn order rotates every tick so nobody always moves first.

## The world

- **Domains** (Identity, Payments, Search, Catalog, Messaging, Analytics, Orders, Media) sit at seeded sites. Only Identity is known at the start; the rest are under fog until an agent walks close enough. Explorers see furthest.
- **Structure types**: Repository, Data Store, Service, API (per domain, with prerequisites: a repository before a data store or service, a service before an API), Shared Library (in the commons near the Hub), Integration Connection (a link between two finished structures in different domains).
- **Every structure has** construction progress, reliability, complexity, resource cost, usage, dependencies, efficiency, known defects, *latent* defects (hidden from agents), pending verifications, owner, contributors and a modification history.
- **Compute** is the one shared resource. Construction spends it (`cost` per second of work; rushing doubles it). Running inefficient structures costs `usage × (1 − efficiency)`. Healthy, used structures earn it back (`0.05 × usage × reliability` per second, plus a base allocation). Balances can never go negative; a builder who finds the pool empty stalls and eventually gives up.
- **Defects**: a finished structure gets latent defects from its complexity, its builders' skill and how much of it was rushed (`floor(complexity × (1.8 − skill) × rush factor + rand)`). Testers find each one with probability `0.8 × skill`. Undiscovered defects in used structures surface as **production incidents** (reliability −0.08, compute lost).

## Signals (stigmergy)

Signals are computed once per simulated second from real state — never placed by hand:

| Signal | Comes from | Strength |
| --- | --- | --- |
| Demand | a discovered domain whose next structure's prerequisites are complete | domain demand × (0.55 → 1.0 as it waits) |
| Construction | an unfinished structure | 0.45 + 0.45 × progress (nearly-done work pulls harder) |
| Failure | known defects, unverified repairs, recent incidents | 0.45 + 0.2 × defects + 0.15 × unverified (+0.2 after an incident) |
| Verification | a finished structure nobody has tested | 0.45 + 0.08 × usage |
| Integration | a finished API/service with no links, when a partner exists | 0.3 + 0.12 × usage |
| Complexity | a finished structure with complexity > 0.55 | 1.6 × (complexity − 0.4) |
| Optimization | heavy usage × inefficiency | waste / 3 |
| Reuse | a finished shared library | 0.5 + 0.15 × adopters (popularity attracts more) |
| Duplication | more finished services than libraries can serve | 0.4 + 0.15 × excess |
| Stale | unfinished work untouched for 150 s | grows with idle time |

**Propagation and decay.** A live signal's strength rises toward its target by 0.12/s; once its cause is resolved the target is 0 and it decays 10%/s until it disappears. An agent at distance *d* perceives `strength × (1 − 0.6·d/range)` where `range = perception radius + 14 × strength`: strong signals are noticed from further away, weak ones only up close. Explorers can **flag** a signal they see, adding a pheromone-like boost (+0.35, max 0.6) that fades by 1.5%/s on its own. Agents may ignore any signal.

## Perception

Each agent sees only what is within its perception radius (Developer 9, Architect 11, Tester 9, Explorer 13, Optimizer 10 tiles): structures, other agents, and perceivable signals. It remembers up to six recent signals (remembered strength fades over three minutes and may be stale — it finds out on arrival) and the last 24 structures it walked past. The inspector's plain-language observations ("Sees 3 finished services; connected: …; isolated: Service-003") are computed from this perception at the moment it was taken.

## Decision calculation

The agent turns each perceived (or remembered) signal into the actions its role can take — roles are capability lists, not scripts:

- Developer: build, construct, repair, connect, reuse · Architect: review, design, connect, abandon · Tester: test, verify · Explorer: explore, flag · Optimizer: optimize, review · everyone: rest, patrol

Each candidate is scored:

```
lean      = strategy (cooperative 0.85, competitive 0.15, adaptive starts 0.5 and learns)
wShared   = 0.3 + 0.9 × lean        wPersonal = 1.2 − 0.8 × lean
benefit   = (wPersonal × personal credit + wShared × shared value) × (0.35 + perceived signal) × skill
utility   = benefit
          + finish others' work   (+1.2 × lean, when the target was started by someone else)
          + ownership             (+1.6 × (1 − lean), when starting something new)
          + flagged by explorer   (+0.25 … +0.6)
          + reuse signal          (building on a shared library)
          − contest               (when the target is reserved and the agent chooses to contest it)
          − travel                (0.055 per tile)
          − energy                (tiredness × action effort)
          − learned risk          (2 × (1 − this agent's success rate for this action))
          − scarce compute        (cooperators hold back on construction when the pool is low)
```

Personal credit and shared value are estimated from current state (remaining work, usage, defects, efficiency…). Invalid options (too tired; reserved by someone else for a cooperator) are kept in the trace with the reason. The choice is a **seeded softmax** over the top six (temperature 0.45), so the best option usually wins but not always. The inspector shows every scored option, its terms, its probability, and a reason assembled from the same terms; the utility is exactly the sum of the terms shown (tested).

## Strategies (evolutionary game theory)

- **Cooperative** agents weigh shared value and finishing others' work, never contest a reservation, and conserve compute when it is scarce.
- **Competitive** agents weigh personal credit and ownership of new work, may contest a reserved target (a skill × energy + luck contest; the loser's action fails), and **rush** construction: 1.45× speed, 2× compute, 1.3× energy, 1.7× defects.
- **Adaptive** agents track the credit per second they earned from cooperative-style versus competitive-style actions and shift their lean 0.07 toward whichever is paying better; the feed announces when one crosses over.

Nothing guarantees cooperation wins. In the five-seed experiment, competitive worlds finish less useful work and leave less compute, but competitors individually often earn more credit, and adaptive agents sometimes learn to compete.

## Integrity

- Exclusive work holds a **reservation** (`state.reservations`); no two agents ever work the same structure at once (checked every tick in tests). Targets are re-validated while travelling, on arrival, and every five seconds of work.
- Agents can only generate actions in their role's capability list (checked on every decision in tests).
- Energy stays within 0–100; compute never goes negative; the compute ledger (start + earned + refunds − spent − incident losses) closes exactly.
- Status only moves construction → complete or construction → abandoned.
- Same seed + configuration + inputs = identical state, including after save/restore mid-run. Rendering never touches simulation state; frame rate never changes outcomes (a slow frame skips ticks, it does not replay them).

## Running it

```bash
npm start                                   # http://localhost:5173 → Choose Your World
npm test                                    # Little World + Agent World tests
node scripts/agent-experiment.mjs --write   # rerun the experiment, rewrite docs/agent-world-evidence.md
node scripts/agent-world-check.mjs          # Playwright: chooser, Agent World, inspectors, compare, mobile
node scripts/browser-check.mjs              # Playwright: Little World regression
```

`agent-world.html?seed=42&config=competitive` opens a specific experiment. Controls: Start / Pause / Resume (Space), 1× 3× 10× 30× (keys 1–4), Mixed / Cooperative / Competitive, Seed + Reset, Compare worlds (runs all three for ten simulated minutes on the current seed), tap any agent or structure (or a line in the feed) to inspect it.

## Known limitations

- **Small world, short horizon.** Eight domains, four slots each. After roughly 12–15 simulated minutes most building is done and the colony shifts to testing, repair, optimization and patrol; there is no new demand after that.
- **Repairs lag.** Developers usually prefer building to repairing while there is demand, so open defects accumulate mid-run (a recognizable form of technical debt). This is an outcome of the weights, not a rule.
- **Contests are coarse.** A contest is a single skill/energy/luck comparison; there is no negotiation or bargaining.
- **Learning is shallow by design.** Every agent learns per-action success rates; only adaptive agents re-weigh strategy. No reinforcement-learning framework.
- **Agent World is not saved between visits.** It restarts from its seed (which reproduces it exactly). Little World still saves itself.
- **Cooperation counts are a definition.** A cooperation event is recorded when an agent completes, repairs, verifies, connects or reuses work another agent created, or is the first to act on an Explorer's flag. A competition event is a contested reservation or a rush that drains compute while it is scarce.
