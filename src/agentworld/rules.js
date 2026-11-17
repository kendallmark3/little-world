// Agent World — every tunable number and every capability table lives here.
// The simulation reads these; nothing in src/agentworld/ hardcodes a workflow.

export const TICK_SECONDS = 0.5;                 // one tick is half a simulated second
export const TICKS_PER_SECOND = 1 / TICK_SECONDS;
export const TICKS_PER_MINUTE = 60 * TICKS_PER_SECOND;
export const AW_CLOCK_RATE = TICKS_PER_SECOND;   // at 1x, simulated time runs in real time

export const AW_RULES = {
  walkSpeed: 0.75,          // tiles per tick (1.5 tiles per simulated second)
  maxEnergy: 100,
  energyWalk: 0.03,         // per tick while travelling
  energyWork: 0.22,         // per tick while working (scaled by action)
  energyRest: 2.2,          // regained per tick at the Hub
  minEnergyToWork: 14,      // a worker stops a session below this
  thinkTicks: 2,            // observe + decide take one simulated second
  perceptionRadius: { Developer: 9, Architect: 11, Tester: 9, Explorer: 13, Optimizer: 10 },
  revealRadius: { Developer: 2, Architect: 2, Tester: 2, Explorer: 3.5, Optimizer: 2 },
  memorySize: 6,
  recheckTicks: 20,         // a traveller re-checks its target every 10 simulated seconds

  // Shared resource: compute. Construction and operation consume it; healthy structures earn it.
  computeStart: 260,
  computeBaseIncome: 1.5,  // per simulated second
  computeValueIncome: 0.05, // per second per unit of usage x effective reliability
  runningCostFactor: 0.03,  // per second per unit of usage x (1 - efficiency)
  incidentPenalty: 8,

  // Decisions
  temperature: 0.45,        // softmax temperature for seeded choice
  travelCost: 0.055,        // utility lost per tile of travel
  staleTicks: 150 * 2,      // unfinished work untouched this long is considered stale

  // Strategy lean: 1 = fully cooperative, 0 = fully competitive
  lean: { cooperative: 0.85, competitive: 0.15, adaptive: 0.5 },
  adaptiveStep: 0.07,
  rushSpeed: 1.45, rushCost: 2, rushDefects: 1.7, rushEnergy: 1.3,
  scarceCompute: 90,        // below this a rush counts as grabbing a scarce shared resource
};

/** Software structure types. work = skill-1 seconds of effort; cost = compute per second of work. */
export const STRUCTURES = {
  repository: { label: 'Repository', prefix: 'Repo', work: 36, cost: 0.8, complexity: [0.2, 0.35], usage: 1, requires: [] },
  datastore: { label: 'Data Store', prefix: 'Store', work: 46, cost: 1.0, complexity: [0.35, 0.55], usage: 2, requires: ['repository'] },
  service: { label: 'Service', prefix: 'Service', work: 60, cost: 1.1, complexity: [0.5, 0.8], usage: 3, requires: ['repository'] },
  api: { label: 'API', prefix: 'API', work: 44, cost: 0.9, complexity: [0.3, 0.5], usage: 4, requires: ['service'] },
  library: { label: 'Shared Library', prefix: 'Lib', work: 64, cost: 1.0, complexity: [0.3, 0.45], usage: 1, requires: [] },
  connection: { label: 'Integration Connection', prefix: 'Link', work: 26, cost: 0.6, complexity: [0.2, 0.35], usage: 0, requires: [] },
};
export const DOMAIN_SLOTS = ['repository', 'datastore', 'service', 'api'];
export const SLOT_OFFSETS = { repository: [0, 0], datastore: [-3, 2], service: [3, 2], api: [0, 4] };
export const DOMAIN_NAMES = ['Identity', 'Payments', 'Search', 'Catalog', 'Messaging', 'Analytics', 'Orders', 'Media'];

/** Roles define capabilities, never scripts. */
export const ROLES = {
  Developer: { count: 3, actions: ['build', 'construct', 'repair', 'connect', 'reuse', 'rest', 'wander'], color: '#0a84ff', skills: { build: 0.85, repair: 0.75, connect: 0.6, reuse: 0.7 } },
  Architect: { count: 2, actions: ['review', 'design', 'connect', 'abandon', 'rest', 'wander'], color: '#af52de', skills: { review: 0.85, design: 0.85, connect: 0.85, abandon: 0.8 } },
  Tester: { count: 2, actions: ['test', 'verify', 'rest', 'wander'], color: '#28a745', skills: { test: 0.85, verify: 0.85 } },
  Explorer: { count: 2, actions: ['explore', 'flag', 'rest', 'wander'], color: '#ff8a00', skills: { explore: 0.9, flag: 0.8 } },
  Optimizer: { count: 1, actions: ['optimize', 'review', 'rest', 'wander'], color: '#14a3a3', skills: { optimize: 0.9, review: 0.55 } },
};
export const ROLE_ORDER = ['Developer', 'Architect', 'Tester', 'Explorer', 'Optimizer'];

/** Which strategy each agent (in ROLE_ORDER, then index) gets in each experiment configuration. */
export const CONFIGS = {
  mixed: { label: 'Mixed World', strategies: ['cooperative', 'competitive', 'adaptive', 'competitive', 'cooperative', 'adaptive', 'cooperative', 'competitive', 'adaptive', 'cooperative'] },
  cooperative: { label: 'Cooperative World', strategies: ['cooperative', 'cooperative', 'adaptive', 'cooperative', 'cooperative', 'cooperative', 'cooperative', 'competitive', 'cooperative', 'cooperative'] },
  competitive: { label: 'Competitive World', strategies: ['competitive', 'competitive', 'adaptive', 'competitive', 'competitive', 'competitive', 'cooperative', 'competitive', 'competitive', 'competitive'] },
};

/** Per-action parameters. dur = seconds of work at skill 1. energy multiplies energyWork. */
export const ACTIONS = {
  build: { label: 'Start construction', icon: '🔨', energy: 1, style: 'comp', minEnergy: 30 },
  construct: { label: 'Continue construction', icon: '🔨', energy: 1, style: 'coop', minEnergy: 25 },
  repair: { label: 'Repair defect', icon: '🔧', dur: 18, energy: 1, style: 'coop', minEnergy: 20 },
  connect: { label: 'Build integration', icon: '🔗', energy: 1, style: 'coop', minEnergy: 25 },
  reuse: { label: 'Adopt shared library', icon: '♻️', dur: 12, energy: 0.8, style: 'coop', minEnergy: 15 },
  review: { label: 'Architecture review', icon: '📐', dur: 14, energy: 0.6, style: 'coop', minEnergy: 15 },
  design: { label: 'Design shared library', icon: '📐', dur: 12, energy: 0.6, style: 'coop', minEnergy: 15 },
  abandon: { label: 'Decommission stale work', icon: '🧹', dur: 8, energy: 0.5, style: 'coop', minEnergy: 10 },
  test: { label: 'Test structure', icon: '🧪', dur: 12, energy: 0.7, style: 'coop', minEnergy: 15 },
  verify: { label: 'Verify repair', icon: '✅', dur: 8, energy: 0.6, style: 'coop', minEnergy: 10 },
  explore: { label: 'Explore', icon: '🧭', energy: 0, style: 'comp', minEnergy: 10 },
  flag: { label: 'Flag opportunity', icon: '🚩', dur: 3, energy: 0.3, style: 'coop', minEnergy: 5 },
  optimize: { label: 'Optimize efficiency', icon: '⚡', dur: 16, energy: 0.8, style: 'coop', minEnergy: 15 },
  rest: { label: 'Recharge at the Hub', icon: '💤', energy: 0, style: 'none', minEnergy: 0 },
  wander: { label: 'Patrol', icon: '👀', energy: 0, style: 'none', minEnergy: 0 },
};

/** Personal credit an agent earns. */
export const REWARD = {
  workPerSecond: 0.1, completion: 6, royaltyPerUsage: 0.012, defectFound: 3, testedClean: 0.6,
  repair: 4, verify: 2, review: 2, design: 3, connect: 5, reuse: 3, optimize: 3, discover: 6, flag: 1, abandon: 1,
};

/** Signal kinds and the roles whose actions answer them. */
export const SIGNALS = {
  demand: { label: 'Demand', color: '#ff9f0a', hint: 'An explored domain needs a structure' },
  construction: { label: 'Construction', color: '#0a84ff', hint: 'Unfinished work waiting for a builder' },
  failure: { label: 'Failure', color: '#ff3b30', hint: 'Known defects or an unverified repair' },
  verification: { label: 'Verification', color: '#34c759', hint: 'Completed but never tested' },
  integration: { label: 'Integration', color: '#af52de', hint: 'A useful structure with no cross-domain connection' },
  optimization: { label: 'Optimization', color: '#14a3a3', hint: 'Heavily used but inefficient' },
  reuse: { label: 'Reuse', color: '#5ac8fa', hint: 'A shared library others can adopt' },
  duplication: { label: 'Duplication', color: '#8e8e93', hint: 'Services repeating work a shared library could hold' },
  complexity: { label: 'Complexity', color: '#5e5ce6', hint: 'A finished structure that has grown too complex' },
  stale: { label: 'Stale work', color: '#a2845e', hint: 'Unfinished work nobody has touched in a while' },
};
