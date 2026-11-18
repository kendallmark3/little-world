# Copilot Instructions for Little World

This project uses **Intent-Driven Engineering**: Repository State + Next Intent = Next Repository State. Read `.claude/CLAUDE.md` and `intent/current-feature.md` first (including any deltas appended to it).

## Build, Test, Lint

```bash
npm start                          # Serve at http://localhost:5173
npm test                           # Run all tests (deterministic rules + intent gate)
npm run soak 10 42 --log           # 10 simulated days, seed 42, with logging
node scripts/browser-check.mjs     # Playwright smoke test (optional, requires Chrome)
node scripts/agent-experiment.mjs  # Rerun Agent World experiment
```

**Single tests:**
```bash
node --test tests/sim.test.js      # Little World deterministic rules
node --test tests/score.test.js    # Soundtrack rules
node --test tests/agentworld.test.js  # Agent World decisions & signals
```

## High-Level Architecture

**Static browser app** — no backend, no build step, no npm dependencies at runtime. Two worlds share one engine:

### Little World (INTENT-001)
- **Intent:** `intent/current-feature.md` (versioned + deltas appended here, never rewritten)
- **Rules:** `context/business-rules.md` (every number and behavior)
- **Simulation:** Pure deterministic JavaScript in `src/sim/` — seeded RNG, one tick per simulated minute, full JSON serialization
- **Rendering:** Canvas in `src/ui/render.js` — reads state, never writes it. Display positions are transient and regenerable

### Agent World (INTENT-002)
- **Simulation:** `src/agentworld/` — autonomous agents (3 Developers, 2 Architects, 2 Testers, 2 Explorers, 1 Optimizer) make decisions via utility scoring and stigmergy
- **Rendering:** `src/ui/agentworld-render.js` reuses `render.js` for terrain and people; adds agents, signals, buildings, and decision inspection
- **Decision system:** Each agent perceives nearby agents, structures, and signals, scores options (structures, agents, locations to explore), selects highest probability action, and broadcasts signals about work
- **Evidence:** `docs/agent-world-evidence.md` (actual experiment traces)

### Shared Core Modules
- `src/sim/rng.js` — Seeded Mulberry32; state lives in `state.rng` for reproducibility
- `src/sim/clock.js` — Time acceleration logic (1x/3x/10x/30x); real time → sim ticks
- `src/sim/path.js` — BFS pathfinding on 48×32 grid (water blocks movement)
- `src/sim/world.js` — Map generation and terrain placement rules
- `src/sim/sim.js` — Core inhabitants, occupations, economy, construction, event log, save/restore

## Key Conventions

### Purity and Determinism
- **`src/sim/` is pure:** No DOM, no `Math.random()`, no `Date`. All randomness goes through `src/sim/rng.js`.
- **Same seed + same inputs = same history.** Tests rely on this. The soak test is deterministic headless.
- **`src/ui/` does not mutate sim state.** Transient visual events (floating "+3 🍞") go through `sim.events` (not saved).
- **State is one JSON-serializable object:** `sim.state`. Save = `JSON.stringify`, restore = `JSON.parse`.

### Time Model
- **One tick = one simulated minute.** A day is 1,440 ticks.
- **At 1× speed:** Clock runs 24 ticks/sec, so a day takes ~1 real minute. Ten minutes of watching ≈ ten simulated days.
- **Render time ≠ sim time:** Sim advances in fixed ticks; renderer keeps its own display position per inhabitant and visually chases the sim position at a capped speed. At 10× and 30×, you see smooth time-lapse, not teleporting.

### Decision and Task Rules
- Each inhabitant, when idle, picks a task by priority: **hunger → sleep → evening leisure → occupation work → stroll**
- Every task records a `reason` (shown in the inspector as "Why")
- **Decisions are rules, not animations:** No hardcoded behavior trees; all logic is data-driven and rule-based

### Balance Tuning
- All numbers and rules live in `RULES` at the top of `src/sim/sim.js` and `context/business-rules.md`
- After touching balance: `npm run soak` to verify no unintended cascade effects
- **Run `npm test` after every change** (pre-implement hook also enforces this)

### Extending Mechanics
- **New mechanics → `src/sim/`** with a test in `tests/`
- **New visuals → `src/ui/render.js`** (or `agentworld-render.js` for Agent World only)
- **Don't expand into future-version scope** (economics, physics, weather, genetics, etc.) without a new intent or delta

### Shared Components Protection
Shared components (rng, path, clock, terrain, people rendering) must not change Little World behavior, even when updating Agent World features.

### Pre-Implementation Hook
Before implementing, run `hooks/pre-implement.sh` to validate that `intent/current-feature.md` has an **Outcome** and **Success / Evidence** section. The hook blocks code edits until this passes. *(Markdown files are never blocked.)*

## Repository Structure

```
index.html, little-world.html         Chooser and Little World page
agent-world.html, agentworld.css      Agent World page
src/sim/                              Deterministic simulation (no DOM, no Math.random)
  rng.js, clock.js, path.js, world.js, sim.js
src/ui/                               Canvas rendering and interaction
  render.js, main.js, score.js, ambience.js
  agentworld-render.js, agentworld-main.js
src/agentworld/                       Agent World simulation modules
tests/                                Unit tests (node:test) + intent gate + Playwright
context/                              Shared documentation (architecture, rules, glossary, security)
intent/                               Living intent (never rewritten; deltas appended)
  current-feature.md                  INTENT-001 + accumulated deltas
  agent-world.md                      INTENT-002
agents/, skills/, templates/, hooks/  Intent-Driven Engineering infrastructure
```

## Development Workflow

1. **Watch the world** at `npm start` and understand current behavior
2. **Read the intent** (`intent/current-feature.md` and any deltas) and the rules (`context/business-rules.md`)
3. **Run `hooks/pre-implement.sh`** to ensure the intent is ready
4. **Build the smallest useful delta,** then stop and let the human observe and decide
5. **Always write tests** (rule tests in `tests/sim.test.js`, visual smoke tests with Playwright in `scripts/browser-check.mjs`)
6. **Run `npm test` after every change** to verify determinism and rule correctness
7. **If you touched balance, run `npm run soak`** to check for cascade effects over simulated days

## Tips

- **Inspect any inhabitant** in the UI (press I, then tap) to see their state, current task, reason, and history
- **Inspect any Agent World structure or link** to see real state (reliability, complexity, usage, defects, dependencies, history)
- **Chronicle is ground truth:** Every stat in the game's chronicle is real simulation state; logs show what actually happened
- **The world saves to localStorage** every few seconds; reload and you're back in the same state (unless you use `?fresh`)
- **Seed a reproducible world** with `?seed=42` or run soak with a specific seed
- **Score rules are auditable:** Look at `src/ui/score.js` to see exactly why the piano plays when it does
- **Agent decisions are auditable:** Tap an agent to see every option it scored with exact utility terms, probabilities, and why it chose

## Agent Infrastructure (Intent-Driven Engineering)

This starter includes:

- **`.claude/CLAUDE.md`** — Repository rules (read first before any work)
- **`hooks/pre-implement.sh`** — Intent quality gate (blocks code until intent is sufficient)
- **`skills/progressive-intent/`** — Turns feedback ("keep this, change that") into delta appended to intent
- **`agents/`** — Planner, Developer, QA, Reviewer role definitions

Workflow: **Write intent, observe output, write delta, repeat.** No commit to code without a guiding intent.
