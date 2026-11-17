// The Little World simulation core.
// One tick = one simulated minute. Everything here is deterministic for a given seed and
// has no knowledge of the DOM, the canvas, or real time.
import { rand, randInt, pick, chance } from './rng.js';
import { findPath, walkable } from './path.js';
import {
  generateWorld, canPlantAt, canBuildAt, canTillAt, VILLAGE, CAMPFIRE, ROAD_Y,
} from './world.js';
import { FIRST_NAMES, NUMBER_WORDS } from './names.js';

export const SAVE_VERSION = 1;
export const MINUTES_PER_DAY = 1440;
export const DAWN = 6 * 60;
export const WORK_END = 18 * 60;
export const NIGHT = 21 * 60 + 30;
export const GROW_START = 6 * 60;
export const GROW_END = 20 * 60;

export const RULES = {
  walkSpeed: 0.12, // tiles per minute
  hungerAwake: 0.11,
  hungerAsleep: 0.04,
  eatAt: 55,
  mealHunger: 60,
  forageHunger: 40,
  energyWork: 0.09,
  energyIdle: 0.05,
  sleepHome: 0.21,
  sleepRough: 0.1,
  fieldGrowMinutes: 1000,
  tendBoost: 1.6,
  tendMinutes: 240,
  harvestYield: 3,
  greenThumbBonus: 2,
  woodPerTree: 4,
  houseWood: 16,
  houseBuildMinutes: 240,
  saplingMinutes: 2400,
  berryRegrowMinutes: 720,
  foodShipment: 20,
  mealPrice: 1,
  marketDayPurse: 30,
};

const TASKS = {
  eat: { walk: 'Heading to the granary to eat', work: 'Eating a meal', icon: '🍞', dur: 20 },
  forage: { walk: 'Looking for berries to eat', work: 'Eating berries off the bush', icon: '🫐', dur: 20 },
  sleep: { walk: 'Going home to sleep', work: 'Sleeping', icon: '💤', dur: 0 },
  socialize: { walk: 'Heading to the campfire', work: 'Relaxing by the fire', icon: '🔥', dur: 90 },
  explore: { walk: 'Exploring the countryside', work: 'Watching the river', icon: '🧭', dur: 40 },
  plant: { walk: 'Walking to a fallow field', work: 'Sowing seeds', icon: '🌱', dur: 40 },
  tend: { walk: 'Walking to the fields', work: 'Tending crops', icon: '🌿', dur: 60 },
  harvest: { walk: 'Heading to a ripe field', work: 'Harvesting crops', icon: '🌾', dur: 50 },
  pick: { walk: 'Walking to a berry bush', work: 'Picking berries', icon: '🫐', dur: 30 },
  chop: { walk: 'Heading to the woods', work: 'Chopping wood', icon: '🪓', dur: 80 },
  deliver: { walk: 'Carrying goods to the granary', work: 'Storing goods', icon: '📦', dur: 5 },
  fetchWood: { walk: 'Fetching wood from the stockpile', work: 'Loading wood', icon: '🪵', dur: 5 },
  haulWood: { walk: 'Hauling wood to the building site', work: 'Stacking lumber', icon: '🪵', dur: 5 },
  build: { walk: 'Walking to the building site', work: 'Building a house', icon: '🔨', dur: 90 },
  organize: { walk: 'Checking on the workers', work: 'Organizing everybody', icon: '📣', dur: 30 },
  trade: { walk: 'Opening the market stall', work: 'Haggling at the market stall', icon: '💰', dur: 120 },
  appraise: { walk: 'Inspecting the fields', work: 'Appraising the crops (and the prices)', icon: '🧐', dur: 30 },
  wander: { walk: 'Taking a stroll', work: 'Taking a breather', icon: '🚶', dur: 30 },
  arrive: { walk: 'Arriving at New Beginnings', work: 'Looking around', icon: '🎒', dur: 20 },
  leave: { walk: 'Leaving New Beginnings for good', work: 'Leaving', icon: '👋', dur: 1 },
};

// Tasks that may be dropped when night falls or a need becomes urgent.
const INTERRUPTIBLE = new Set(['socialize', 'explore', 'plant', 'tend', 'harvest', 'pick', 'chop', 'build', 'organize', 'trade', 'appraise', 'wander', 'fetchWood']);
const WORK_KINDS = new Set(['plant', 'tend', 'harvest', 'pick', 'chop', 'build', 'organize', 'trade', 'appraise', 'fetchWood', 'haulWood', 'deliver']);

// ---------------------------------------------------------------------------
// Creation, save, restore
// ---------------------------------------------------------------------------

export function createSim(seed = 1) {
  const state = {
    version: SAVE_VERSION,
    seed: seed >>> 0,
    rng: seed >>> 0,
    settlement: 'New Beginnings',
    tick: DAWN,
    nextId: 1,
    food: 25,
    wood: 10,
    people: [],
    log: [],
    marketDay: 0,
    flags: { foodLow: false, foodEmpty: false, rally: false, firstHarvest: false, firstHouse: false, doctorJoke: false },
    peakPopulation: 0,
    totals: { harvests: 0, foodProduced: 0, woodChopped: 0, meals: 0, housesBuilt: 0, arrivals: 0, departures: 0, deaths: 0 },
    dayStart: { food: 25, wood: 10 },
    usedNames: [],
  };
  generateWorld(state);
  populate(state);
  const sim = { state, events: [] };
  addLog(sim, `${state.settlement} was founded by ten settlers.`);
  state.peakPopulation = state.people.length;
  return sim;
}

function populate(state) {
  const houses = state.buildings.filter((b) => b.type === 'house');
  const roster = [
    { name: 'Rook', occupation: 'Leader', trait: 'bossy', age: 41 },
    { name: 'Doctor', occupation: 'Merchant', trait: 'shrewd', age: 56, coins: 20 },
    { name: 'Jenny', occupation: 'Farmer', trait: 'green thumb', age: 32 },
  ];
  const jobs = ['Farmer', 'Farmer', 'Gatherer', 'Gatherer', 'Builder', 'Laborer', 'Laborer'];
  for (const occupation of jobs) {
    roster.push({ name: newName(state), occupation, trait: pick(state, ['diligent', 'cheerful', 'sleepy', 'curious', 'steady']), age: randInt(state, 18, 62) });
  }
  roster.forEach((r, i) => {
    const home = houses[Math.floor(i / 2)];
    const p = makePerson(state, r, home.x, home.y + 1);
    p.home = home.id;
    home.residents.push(p.id);
  });
}

function newName(state) {
  const available = FIRST_NAMES.filter((n) => !state.usedNames.includes(n));
  const name = available.length ? pick(state, available) : `${pick(state, FIRST_NAMES)} ${state.usedNames.length}`;
  state.usedNames.push(name);
  return name;
}

function makePerson(state, r, x, y) {
  const p = {
    id: state.nextId++,
    name: r.name,
    age: r.age,
    occupation: r.occupation,
    trait: r.trait,
    x: x + 0.5,
    y: y + 0.5,
    hunger: randInt(state, 10, 35),
    energy: randInt(state, 75, 95),
    health: 100,
    happiness: 65,
    targetHappiness: 65,
    coins: r.coins ?? 3,
    home: null,
    task: null,
    path: [],
    activity: 'Waking up',
    icon: '',
    reason: 'A new day',
    carrying: null,
    unhappyMinutes: 0,
    socialBoost: 0,
    encouraged: 0,
    treeBonus: 0,
    debt: 0,
    chatWith: null,
    skin: randInt(state, 0, 4),
    stats: { harvests: 0, food: 0, wood: 0, built: 0, meals: 0 },
  };
  state.people.push(p);
  return p;
}

export function serialize(sim) {
  return JSON.stringify(sim.state);
}

export function deserialize(json) {
  const state = typeof json === 'string' ? JSON.parse(json) : json;
  if (!state || state.version !== SAVE_VERSION || !Array.isArray(state.people) || !Array.isArray(state.tiles)) {
    throw new Error('Unrecognized save data');
  }
  return { state, events: [] };
}

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

export const dayOf = (tick) => Math.floor(tick / MINUTES_PER_DAY) + 1;
export const minuteOf = (tick) => tick % MINUTES_PER_DAY;
export const isNight = (m) => m < DAWN || m >= NIGHT;
export const isWorkHours = (m) => m >= DAWN && m < WORK_END;
export const isEvening = (m) => m >= WORK_END && m < NIGHT;

export function formatTime(tick) {
  const m = minuteOf(tick);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------

export function addLog(sim, text, key = null) {
  const s = sim.state;
  const day = dayOf(s.tick);
  const last = s.log[s.log.length - 1];
  if (key && last && last.key === key && last.day === day) {
    last.count = (last.count || 1) + 1;
    last.text = typeof text === 'function' ? text(last.count) : text;
    last.time = formatTime(s.tick);
    return;
  }
  s.log.push({ day, time: formatTime(s.tick), text: typeof text === 'function' ? text(1) : text, key });
  if (s.log.length > 250) s.log.splice(0, s.log.length - 250);
}

function float(sim, x, y, text) {
  sim.events.push({ type: 'float', x, y, text });
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

export function step(sim) {
  const s = sim.state;
  s.tick++;
  const m = minuteOf(s.tick);

  updateWorld(sim, m);
  if (m === NIGHT) nightfall(sim);
  for (const p of s.people.slice()) updatePerson(sim, p, m);
  if (m % 60 === 0) hourly(sim, m);
  if (m === DAWN) dawn(sim);
  if (m === 8 * 60) morning(sim);
}

export function run(sim, ticks) {
  for (let i = 0; i < ticks; i++) step(sim);
}

function updateWorld(sim, m) {
  const s = sim.state;
  const growing = m >= GROW_START && m < GROW_END;
  if (growing) {
    for (const f of s.fields) {
      if (f.state !== 'growing') continue;
      f.growth += (f.tended > 0 ? RULES.tendBoost : 1) / RULES.fieldGrowMinutes;
      if (f.growth >= 1) { f.growth = 1; f.state = 'ripe'; }
    }
  }
  for (const f of s.fields) if (f.tended > 0) f.tended--;
  for (const t of s.trees) {
    if (t.growth >= 1) continue;
    t.growth = Math.min(1, t.growth + 1 / RULES.saplingMinutes);
    if (t.growth >= 1 && t.planted) addLog(sim, (n) => (n > 1 ? `${n} saplings you planted have grown into trees.` : 'A sapling you planted has grown into a tree.'), 'sapling-grown');
  }
  for (const b of s.bushes) {
    if (b.berries >= 3) continue;
    if (++b.regrow >= RULES.berryRegrowMinutes) { b.berries++; b.regrow = 0; }
  }
}

// ---------------------------------------------------------------------------
// Inhabitants
// ---------------------------------------------------------------------------

function updatePerson(sim, p, m) {
  const s = sim.state;
  const asleep = p.task?.kind === 'sleep' && p.task.phase === 'work';
  const working = p.task && WORK_KINDS.has(p.task.kind) && p.task.phase === 'work';
  const home = asleep ? homeOf(s, p) : null;

  p.hunger = clamp(p.hunger + (asleep ? RULES.hungerAsleep : RULES.hungerAwake));
  if (asleep) p.energy = clamp(p.energy + (home && atHome(p, home) ? RULES.sleepHome : RULES.sleepRough));
  else p.energy = clamp(p.energy - (working ? RULES.energyWork : RULES.energyIdle) * (p.trait === 'sleepy' ? 1.25 : 1));

  if (p.hunger >= 95) p.health -= 0.04;
  else if (p.energy <= 2) p.health -= 0.015;
  else if (p.hunger < 70 && p.energy > 15) p.health += 0.012;
  p.health = clamp(p.health);

  p.happiness = clamp(p.happiness + (p.targetHappiness - p.happiness) * 0.003);
  if (p.socialBoost > 0) p.socialBoost = Math.max(0, p.socialBoost - 10 / 720);
  if (p.encouraged > 0) p.encouraged--;
  p.unhappyMinutes = p.happiness < 15 ? p.unhappyMinutes + 1 : Math.max(0, p.unhappyMinutes - 2);

  if (p.health <= 0) return die(sim, p, p.hunger >= 95 ? 'hunger' : 'exhaustion');
  p.starvingMinutes = p.hunger >= 90 ? (p.starvingMinutes || 0) + 1 : 0;
  if (p.starvingMinutes >= 600 && p.health < 70 && p.task?.kind !== 'leave' && s.food <= 0) {
    cancelTask(s, p);
    p.carrying = null;
    addLog(sim, `${p.name} left ${s.settlement} in search of food.`);
    return startTask(sim, p, 'leave', { x: 0, y: ROAD_Y }, { reason: 'Starving — leaving to find food' });
  }
  if (p.unhappyMinutes >= MINUTES_PER_DAY && p.task?.kind !== 'leave') {
    cancelTask(s, p);
    addLog(sim, `${p.name} gave up on ${s.settlement} and set off down the west road.`);
    return startTask(sim, p, 'leave', { x: 0, y: ROAD_Y }, { reason: 'Too unhappy to stay' });
  }

  // Urgent needs interrupt ordinary work (but never drop goods in the dirt).
  if (p.task && INTERRUPTIBLE.has(p.task.kind) && !p.carrying) {
    if ((p.hunger >= 85 && hasFoodSource(s)) || p.energy < 8) cancelTask(s, p);
  }

  if (!p.task) decide(sim, p, m);
  if (p.task) progressTask(sim, p, m);
}

function hasFoodSource(s) {
  return s.food > 0 || s.bushes.some((b) => b.berries > 0);
}

function decide(sim, p, m) {
  const s = sim.state;
  const pop = s.people.length;

  // 1. Hunger
  if (p.hunger >= RULES.eatAt) {
    if (s.food > 0) return startTask(sim, p, 'eat', door(granary(s)), { reason: `Hungry (${Math.round(p.hunger)}%)` });
    const bush = nearest(s.bushes.filter((b) => b.berries > 0 && !b.claimedBy), p);
    if (bush) return startTask(sim, p, 'forage', bush, { ref: bush.id, claim: bush, reason: 'Hungry, and the granary is empty' });
  }

  // 2. Sleep
  if (isNight(m) || p.energy < 20) {
    const home = homeOf(s, p);
    const spot = home ? door(home) : campfireSpot(sim, p);
    return startTask(sim, p, 'sleep', spot, { reason: isNight(m) ? 'Night has fallen' : `Exhausted (energy ${Math.round(p.energy)}%)` });
  }

  // 3. Evening leisure
  if (isEvening(m) || !isWorkHours(m)) {
    if (p.trait === 'curious' && chance(s, 0.35)) {
      return startTask(sim, p, 'explore', riversideSpot(sim, p), { reason: 'Curious about what lies by the river' });
    }
    return startTask(sim, p, 'socialize', campfireSpot(sim, p), { reason: 'The workday is over' });
  }

  // 4. Work
  const foodLow = s.food < pop * 2.5 || s.flags.rally;
  const did = workFor(sim, p, foodLow);
  if (did) return;
  if (p.occupation === 'Farmer' && s.flags.idleFarmerDay !== dayOf(s.tick) && dayOf(s.tick) - (s.flags.idleFarmerDay || -9) >= 3) {
    s.flags.idleFarmerDay = dayOf(s.tick);
    addLog(sim, `${p.name} has no field to work. More fields would put idle hands to use.`);
  }
  return startTask(sim, p, 'wander', strollSpot(sim, p), { reason: 'Nothing urgent to do' });
}

function workFor(sim, p, foodLow) {
  switch (p.occupation) {
    case 'Farmer':
      return farm(sim, p) || pickBerries(sim, p, foodLow) || chop(sim, p);
    case 'Gatherer':
      if (foodLow) return pickBerries(sim, p, true) || harvestOnly(sim, p) || chop(sim, p);
      return (sim.state.wood < 30 ? chop(sim, p) : false) || pickBerries(sim, p, false) || chop(sim, p);
    case 'Builder':
      return build(sim, p) || (sim.state.wood < 60 && chop(sim, p)) || farm(sim, p) || pickBerries(sim, p, foodLow);
    case 'Laborer':
      if (foodLow) return harvestOnly(sim, p) || pickBerries(sim, p, true) || farm(sim, p) || chop(sim, p);
      if (siteNeedingWood(sim.state) && sim.state.wood < 5) return chop(sim, p) || farm(sim, p);
      return (chance(sim.state, 0.5) ? farm(sim, p) || chop(sim, p) : chop(sim, p) || farm(sim, p)) || build(sim, p) || pickBerries(sim, p, false);
    case 'Leader':
      if (foodLow && sim.state.flags.rally && chance(sim.state, 0.5)) return harvestOnly(sim, p) || pickBerries(sim, p, true) || organize(sim, p);
      if (activeSite(sim.state) && chance(sim.state, 0.6)) return build(sim, p) || organize(sim, p);
      return organize(sim, p) || farm(sim, p);
    case 'Merchant':
      if (chance(sim.state, 0.2)) return appraise(sim, p) || trade(sim, p);
      return trade(sim, p);
    default:
      return false;
  }
}

// ----- occupation actions --------------------------------------------------

function farm(sim, p) {
  const s = sim.state;
  const open = s.fields.filter((f) => !f.claimedBy);
  const ripe = nearest(open.filter((f) => f.state === 'ripe'), p);
  if (ripe) return startTask(sim, p, 'harvest', fieldSpot(ripe), { ref: ripe.id, claim: ripe, reason: 'The crops are ripe' });
  const fallow = nearest(open.filter((f) => f.state === 'fallow'), p);
  if (fallow) return startTask(sim, p, 'plant', fieldSpot(fallow), { ref: fallow.id, claim: fallow, reason: 'A field is lying empty' });
  const needsCare = nearest(open.filter((f) => f.state === 'growing' && f.tended <= 0 && f.growth < 0.85), p);
  if (needsCare) return startTask(sim, p, 'tend', fieldSpot(needsCare), { ref: needsCare.id, claim: needsCare, reason: 'The crops need water and weeding' });
  return false;
}

function harvestOnly(sim, p) {
  const s = sim.state;
  const ripe = nearest(s.fields.filter((f) => !f.claimedBy && f.state === 'ripe'), p);
  if (!ripe) return false;
  return startTask(sim, p, 'harvest', fieldSpot(ripe), { ref: ripe.id, claim: ripe, reason: 'Food is running low' });
}

function pickBerries(sim, p, urgent) {
  const s = sim.state;
  const bush = nearest(s.bushes.filter((b) => !b.claimedBy && b.berries >= (urgent ? 1 : 2)), p);
  if (!bush) return false;
  return startTask(sim, p, 'pick', bush, { ref: bush.id, claim: bush, reason: urgent ? 'Food is running low' : 'The berries are ready' });
}

function chop(sim, p) {
  const s = sim.state;
  const needy = siteNeedingWood(s);
  if (s.wood >= 50 || (needy && s.wood >= needy.woodNeeded - needy.woodDelivered - needy.incoming + 10)) return false;
  const tree = nearest(s.trees.filter((t) => !t.claimedBy && t.growth >= 1), p);
  if (!tree) return false;
  const reason = siteNeedingWood(s) ? 'The building site needs lumber' : 'The settlement needs wood';
  return startTask(sim, p, 'chop', besideSpot(sim, tree), { ref: tree.id, claim: tree, reason });
}

function build(sim, p) {
  const s = sim.state;
  const sites = s.buildings.filter((b) => b.type === 'site');
  const workable = sites.find((b) => b.progress < b.woodDelivered / b.woodNeeded - 0.001);
  if (workable) return startTask(sim, p, 'build', door(workable), { ref: workable.id, reason: 'There is a house to build' });
  const needy = siteNeedingWood(s);
  if (needy && s.wood > 0) return startTask(sim, p, 'fetchWood', door(granary(s)), { ref: needy.id, reason: 'The building site needs lumber' });
  if (needy) return chop(sim, p);
  return false;
}

function organize(sim, p) {
  const s = sim.state;
  const workers = s.people.filter((o) => o !== p && o.task && WORK_KINDS.has(o.task.kind) && o.encouraged <= 0);
  if (!workers.length) return false;
  const target = pick(s, workers);
  const spot = { x: Math.floor(target.x) + (chance(s, 0.5) ? 1 : -1), y: Math.floor(target.y) };
  const ok = startTask(sim, p, 'organize', walkable(s, spot.x, spot.y) ? spot : { x: Math.floor(target.x), y: Math.floor(target.y) },
    { ref: target.id, reason: `Making sure ${target.name} stays on task` });
  if (ok) p.task.label = `Checking on ${target.name}`;
  return ok;
}

function trade(sim, p) {
  const market = sim.state.buildings.find((b) => b.type === 'market');
  if (!market) return false;
  return startTask(sim, p, 'trade', door(market), { reason: 'Business hours' });
}

function appraise(sim, p) {
  const f = pick(sim.state, sim.state.fields);
  if (!f) return false;
  return startTask(sim, p, 'appraise', fieldSpot(f), { reason: 'Estimating what the harvest will be worth' });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

function startTask(sim, p, kind, target, opts = {}) {
  const s = sim.state;
  const sx = Math.floor(p.x);
  const sy = Math.floor(p.y);
  const tx = Math.floor(target.x);
  const ty = Math.floor(target.y);
  const tiles = findPath(s, sx, sy, tx, ty);
  if (!tiles) return false;
  const path = tiles.map(([x, y]) => [x + 0.5, y + 0.5]);
  if (target.fx !== undefined) path.push([target.fx, target.fy]);
  const spec = TASKS[kind];
  p.task = { kind, phase: 'walk', ref: opts.ref ?? null, timer: spec.dur, label: null };
  p.path = path;
  p.reason = opts.reason || '';
  p.icon = spec.icon;
  p.activity = spec.walk;
  p.chatWith = null;
  if (opts.claim) opts.claim.claimedBy = p.id;
  return true;
}

function cancelTask(s, p) {
  if (!p.task) return;
  releaseClaims(s, p);
  p.task = null;
  p.path = [];
}

function releaseClaims(s, p) {
  for (const list of [s.fields, s.trees, s.bushes]) {
    for (const o of list) if (o.claimedBy === p.id) o.claimedBy = null;
  }
}

function finishTask(s, p) {
  releaseClaims(s, p);
  p.task = null;
  p.path = [];
}

function moveAlong(p) {
  let budget = RULES.walkSpeed * (p.energy < 15 ? 0.7 : 1);
  while (budget > 0 && p.path.length) {
    const [tx, ty] = p.path[0];
    const dx = tx - p.x;
    const dy = ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d <= budget) {
      p.x = tx; p.y = ty;
      budget -= d;
      p.path.shift();
    } else {
      p.x += (dx / d) * budget;
      p.y += (dy / d) * budget;
      budget = 0;
    }
  }
  return p.path.length === 0;
}

function workRate(p) {
  let r = 1;
  if (p.trait === 'diligent') r *= 1.25;
  if (p.encouraged > 0) r *= 1.2;
  if (p.energy < 15) r *= 0.6;
  if (p.trait === 'green thumb' && ['plant', 'tend', 'harvest'].includes(p.task.kind)) r *= 1.3;
  return r;
}

function progressTask(sim, p, m) {
  const s = sim.state;
  const t = p.task;
  if (t.phase === 'walk') {
    if (!moveAlong(p)) return;
    t.phase = 'work';
    p.activity = t.label || TASKS[t.kind].work;
    if (t.kind === 'leave') return leave(sim, p);
    return;
  }

  switch (t.kind) {
    case 'sleep': {
      if (!isNight(m) && (p.energy >= 95 || p.hunger >= 75)) finishTask(s, p);
      return;
    }
    case 'socialize': {
      const friend = s.people.find((o) => o !== p && o.task?.kind === 'socialize' && o.task.phase === 'work' && Math.hypot(o.x - p.x, o.y - p.y) < 2.6);
      if (friend) {
        p.socialBoost = Math.min(12, p.socialBoost + 0.05);
        if (p.chatWith !== friend.name) {
          p.chatWith = friend.name;
          p.activity = `Chatting with ${friend.name} by the fire`;
          p.icon = '💬';
        }
      }
      if (--t.timer <= 0 || isNight(m)) finishTask(s, p);
      return;
    }
    case 'build': {
      const site = s.buildings.find((b) => b.id === t.ref && b.type === 'site');
      if (!site) return finishTask(s, p);
      const cap = site.woodDelivered / site.woodNeeded;
      site.progress = Math.min(cap, site.progress + workRate(p) / RULES.houseBuildMinutes);
      if (site.progress >= 0.9995) { site.progress = 1; p.stats.built++; payWage(sim, p, 2); completeSite(sim, site, p); return finishTask(s, p); }
      t.timer -= 1;
      if (t.timer <= 0 || site.progress >= cap - 1e-9) { payWage(sim, p, 1); finishTask(s, p); }
      return;
    }
    default:
      t.timer -= workRate(p);
      if (t.timer <= 0) complete(sim, p, m);
  }
}

function complete(sim, p, m) {
  const s = sim.state;
  const t = p.task;
  switch (t.kind) {
    case 'eat': {
      finishTask(s, p);
      if (s.food <= 0) {
        p.happiness = clamp(p.happiness - 5);
        p.reason = 'Found the granary empty';
        return;
      }
      s.food--;
      p.hunger = Math.max(0, p.hunger - RULES.mealHunger);
      p.stats.meals++;
      s.totals.meals++;
      payForMeal(sim, p);
      return;
    }
    case 'forage': {
      const bush = s.bushes.find((b) => b.id === t.ref);
      if (bush && bush.berries > 0) {
        bush.berries--;
        p.hunger = Math.max(0, p.hunger - RULES.forageHunger);
      }
      return finishTask(s, p);
    }
    case 'plant': {
      const f = s.fields.find((x) => x.id === t.ref);
      if (f && f.state === 'fallow') { f.state = 'growing'; f.growth = 0; }
      return finishTask(s, p);
    }
    case 'tend': {
      const f = s.fields.find((x) => x.id === t.ref);
      if (f && f.state === 'growing') f.tended = RULES.tendMinutes;
      return finishTask(s, p);
    }
    case 'harvest': {
      const f = s.fields.find((x) => x.id === t.ref);
      finishTask(s, p);
      if (!f || f.state !== 'ripe') return;
      const amount = RULES.harvestYield + (p.trait === 'green thumb' ? RULES.greenThumbBonus : 0);
      f.state = 'fallow';
      f.growth = 0;
      p.stats.harvests++;
      s.totals.harvests++;
      if (!s.flags.firstHarvest) {
        s.flags.firstHarvest = true;
        addLog(sim, `${p.name} harvested the first crop.`);
      }
      p.carrying = { type: 'food', amount };
      return startDeliver(sim, p);
    }
    case 'pick': {
      const bush = s.bushes.find((b) => b.id === t.ref);
      finishTask(s, p);
      if (!bush || bush.berries <= 0) return;
      const amount = bush.berries;
      bush.berries = 0;
      bush.regrow = 0;
      p.carrying = { type: 'food', amount };
      return startDeliver(sim, p);
    }
    case 'chop': {
      const idx = s.trees.findIndex((x) => x.id === t.ref);
      finishTask(s, p);
      if (idx < 0) return;
      s.trees.splice(idx, 1);
      s.totals.woodChopped += RULES.woodPerTree;
      p.carrying = { type: 'wood', amount: RULES.woodPerTree };
      return startDeliver(sim, p);
    }
    case 'deliver': {
      const c = p.carrying;
      finishTask(s, p);
      if (!c) return;
      s[c.type] += c.amount;
      if (c.type === 'food') { p.stats.food += c.amount; s.totals.foodProduced += c.amount; }
      else p.stats.wood += c.amount;
      p.carrying = null;
      const g = granary(s);
      float(sim, g.x + 0.5, g.y - 0.5, `+${c.amount} ${c.type === 'food' ? '🍞' : '🪵'}`);
      payForGoods(sim, p, c.amount);
      return;
    }
    case 'fetchWood': {
      const site = s.buildings.find((b) => b.id === t.ref && b.type === 'site');
      finishTask(s, p);
      if (!site) return;
      const want = site.woodNeeded - site.woodDelivered - site.incoming;
      const take = Math.min(s.wood, want, 6);
      if (take <= 0) return;
      s.wood -= take;
      site.incoming += take;
      p.carrying = { type: 'wood', amount: take, site: site.id };
      startTask(sim, p, 'haulWood', door(site), { ref: site.id, reason: 'The building site needs lumber' });
      return;
    }
    case 'haulWood': {
      const site = s.buildings.find((b) => b.id === t.ref && b.type === 'site');
      const c = p.carrying;
      finishTask(s, p);
      if (!c) return;
      if (site) {
        site.woodDelivered += c.amount;
        site.incoming = Math.max(0, site.incoming - c.amount);
        p.carrying = null;
        float(sim, site.x + 0.5, site.y - 0.3, `+${c.amount} 🪵`);
      } else {
        startDeliver(sim, p);
      }
      return;
    }
    case 'organize': {
      const target = s.people.find((o) => o.id === t.ref);
      if (target) {
        target.encouraged = 240;
        target.happiness = clamp(target.happiness + 2);
      }
      return finishTask(s, p);
    }
    case 'arrive':
    case 'trade':
    case 'appraise':
    case 'wander':
    case 'explore':
    default:
      return finishTask(s, p);
  }
}

function startDeliver(sim, p) {
  const ok = startTask(sim, p, 'deliver', door(granary(sim.state)), { reason: `Carrying ${p.carrying.amount} ${p.carrying.type} home` });
  if (ok) p.activity = `Carrying ${p.carrying.amount} ${p.carrying.type} to the granary`;
  return ok;
}

// ---------------------------------------------------------------------------
// The economy, according to Doctor
// ---------------------------------------------------------------------------

function doctor(s) {
  return s.people.find((o) => o.occupation === 'Merchant');
}

function payForMeal(sim, p) {
  const s = sim.state;
  const merchant = doctor(s);
  if (!merchant || merchant === p || s.marketDay === dayOf(s.tick)) return;
  if (p.coins >= RULES.mealPrice) {
    p.coins -= RULES.mealPrice;
    merchant.coins += RULES.mealPrice;
    if (p.debt > 0 && p.coins > 0) { const repay = Math.min(p.debt, p.coins); p.coins -= repay; merchant.coins += repay; p.debt -= repay; }
  } else {
    p.debt++;
    p.happiness = clamp(p.happiness - 3);
    const day = dayOf(s.tick);
    if (s.flags.creditDay !== day) {
      s.flags.creditDay = day;
      addLog(sim, `${p.name} couldn't afford Doctor's prices and ate on credit.`);
    }
  }
}

function payForGoods(sim, p, amount) {
  payWage(sim, p, Math.max(1, Math.floor(amount / 2)));
}

function payWage(sim, p, amount) {
  const merchant = doctor(sim.state);
  if (!merchant || merchant === p) return;
  const pay = Math.min(merchant.coins, amount);
  merchant.coins -= pay;
  p.coins += pay;
  if (p.debt > 0 && p.coins > 0) {
    const repay = Math.min(p.debt, p.coins);
    p.coins -= repay;
    merchant.coins += repay;
    p.debt -= repay;
  }
}

// ---------------------------------------------------------------------------
// Settlement-level rules
// ---------------------------------------------------------------------------

function hourly(sim, m) {
  const s = sim.state;
  const pop = s.people.length;
  if (!pop) return;
  const avg = averageHappiness(s);

  for (const p of s.people) {
    const home = homeOf(s, p);
    const anchor = home || CAMPFIRE;
    p.treeBonus = Math.min(6, s.trees.filter((t) => t.growth >= 1 && Math.hypot(t.x - anchor.x, t.y - anchor.y) <= 5).length);
    let target = 50 + (home ? 8 : -15) + p.treeBonus + p.socialBoost;
    if (p.trait === 'cheerful') target += 6;
    if (p.encouraged > 0) target += 4;
    if (s.marketDay === dayOf(s.tick)) target += 8;
    if (p.hunger > 75) target -= 15;
    if (p.energy < 20) target -= 8;
    if (p.health < 50) target -= 10;
    if (p.debt > 0) target -= Math.min(10, p.debt * 2);
    if (s.food < pop) target -= 6;
    p.targetHappiness = clamp(target);
  }

  // Food alarms and Rook's rally
  if (!s.flags.foodLow && s.food < pop * 1.5) {
    s.flags.foodLow = true;
    addLog(sim, 'Food supplies are running low.');
    const rook = s.people.find((o) => o.occupation === 'Leader');
    if (rook) {
      s.flags.rally = true;
      addLog(sim, `${rook.name} rallied everyone to bring in food.`);
    }
  } else if (s.flags.foodLow && s.food > pop * 3) {
    s.flags.foodLow = false;
    s.flags.rally = false;
    addLog(sim, 'The granary is comfortably stocked again.');
  }
  if (!s.flags.foodEmpty && s.food <= 0) {
    s.flags.foodEmpty = true;
    addLog(sim, 'The granary is empty! People are foraging for berries.');
  } else if (s.flags.foodEmpty && s.food >= pop) {
    s.flags.foodEmpty = false;
  }

  // Farmland: when food is short and every field is busy, Rook has a new field cleared.
  if (s.flags.foodLow && isWorkHours(m) && s.fields.length < pop / 1.4 && !s.fields.some((f) => f.state === 'fallow')) {
    const spot = findFieldSpot(s);
    if (spot) {
      s.fields.push({ id: s.nextId++, x: spot.x, y: spot.y, state: 'fallow', growth: 0, tended: 0, claimedBy: null });
      const lead = s.people.find((o) => o.occupation === 'Leader');
      addLog(sim, `${lead ? lead.name : 'The farmers'} had a new field cleared. Fields: ${s.fields.length}.`);
    }
  }

  // Housing: plan a new house when beds are running out.
  const free = freeBeds(s);
  if (!activeSite(s) && free <= 1 && pop < 40 && isWorkHours(m)) {
    const spot = findBuildSpot(s);
    if (spot) {
      s.buildings.push(newSite(s, spot.x, spot.y, false));
      const lead = s.people.find((o) => o.occupation === 'Leader') || s.people.find((o) => o.occupation === 'Builder');
      addLog(sim, `${lead ? lead.name : 'The villagers'} began construction of a house.`);
    }
  }
  assignHomes(sim);

  if (pop > s.peakPopulation) {
    s.peakPopulation = pop;
    if ([12, 15, 20, 25].includes(pop)) addLog(sim, `The settlement reached ${NUMBER_WORDS[pop] || pop} inhabitants.`);
  }
  void avg;
}

function nightfall(sim) {
  const s = sim.state;
  for (const p of s.people) {
    if (p.task && INTERRUPTIBLE.has(p.task.kind) && !p.carrying) cancelTask(s, p);
  }
}

function dawn(sim) {
  const s = sim.state;
  const day = dayOf(s.tick);
  // Grain keeps, but not forever: a big surplus slowly spoils.
  const surplus = s.food - s.people.length * 6;
  if (surplus > 10) {
    const spoiled = Math.floor(surplus * 0.15);
    s.food -= spoiled;
    s.totals.spoiled = (s.totals.spoiled || 0) + spoiled;
    if (spoiled >= 3) addLog(sim, `${spoiled} food spoiled in the overflowing granary.`);
  }
  s.dayStart = { food: s.food, wood: s.wood };
  if (day === 2 && !s.flags.doctorJoke) {
    s.flags.doctorJoke = true;
    addLog(sim, 'Doctor reminds everyone that he is not that kind of doctor.');
  }
}

function morning(sim) {
  const s = sim.state;
  const day = dayOf(s.tick);
  const merchant = doctor(s);
  if (merchant && merchant.coins >= RULES.marketDayPurse && day - (s.marketDay || -99) >= 5) {
    s.marketDay = day;
    addLog(sim, `${merchant.name} declared a market day — meals are free today!`);
  }

  // Newcomers arrive when the settlement looks like a good place to live.
  const pop = s.people.length;
  if (pop > 0 && freeBeds(s) >= 1 && s.food >= pop * 3 && !s.flags.foodLow && averageHappiness(s) >= 48) {
    const occupation = neededOccupation(s);
    const p = makePerson(s, { name: newName(s), occupation, trait: pick(s, ['diligent', 'cheerful', 'sleepy', 'curious', 'steady']), age: randInt(s, 17, 45) }, 0, ROAD_Y);
    p.happiness = 70;
    s.totals.arrivals++;
    startTask(sim, p, 'arrive', door(granary(s)), { reason: `Heard ${s.settlement} had room and food` });
    addLog(sim, `A traveler named ${p.name} arrived and became a ${occupation.toLowerCase()}.`);
    assignHomes(sim);
  }
}

function neededOccupation(s) {
  const pop = s.people.length + 1;
  const count = (o) => s.people.filter((p) => p.occupation === o).length;
  if (count('Farmer') < pop / 3.2) return 'Farmer';
  if (count('Gatherer') < pop / 5) return 'Gatherer';
  if (count('Builder') < pop / 7) return 'Builder';
  return 'Laborer';
}

function die(sim, p, cause) {
  const s = sim.state;
  cancelTask(s, p);
  removePerson(s, p);
  s.totals.deaths++;
  addLog(sim, `${p.name} passed away from ${cause}. The settlement mourns.`);
}

function leave(sim, p) {
  const s = sim.state;
  removePerson(s, p);
  s.totals.departures++;
}

function removePerson(s, p) {
  releaseClaims(s, p);
  s.people = s.people.filter((o) => o !== p);
  for (const b of s.buildings) if (b.residents) b.residents = b.residents.filter((id) => id !== p.id);
}

function assignHomes(sim) {
  const s = sim.state;
  const houses = s.buildings.filter((b) => b.type === 'house');
  for (const p of s.people) {
    if (p.home && houses.some((h) => h.id === p.home)) continue;
    if (p.task?.kind === 'leave') continue;
    const house = houses.find((h) => h.residents.length < h.capacity);
    if (!house) return;
    house.residents.push(p.id);
    p.home = house.id;
  }
}

function completeSite(sim, site, p) {
  const s = sim.state;
  site.type = 'house';
  site.capacity = 2;
  site.residents = [];
  delete site.woodNeeded; delete site.woodDelivered; delete site.incoming; delete site.progress;
  s.totals.housesBuilt++;
  assignHomes(sim);
  addLog(sim, `${p.name} finished a new house. Housing capacity is now ${housingCapacity(s)}.`);
}

function newSite(s, x, y, byPlayer) {
  return { id: s.nextId++, type: 'site', x, y, woodNeeded: RULES.houseWood, woodDelivered: 0, incoming: 0, progress: 0, byPlayer, style: randInt(s, 0, 3) };
}

function findFieldSpot(s) {
  const near = s.fields.length ? s.fields : [{ x: VILLAGE.x, y: VILLAGE.y + 6 }];
  let best = null;
  let bd = Infinity;
  for (let y = 2; y < s.h - 3; y++) {
    for (let x = 1; x < s.w - 3; x++) {
      if (Math.abs(y - ROAD_Y) <= 1 || Math.abs(y + 1 - ROAD_Y) <= 1) continue;
      if (!canTillAt(s, x, y)) continue;
      const d = Math.min(...near.map((f) => Math.abs(f.x - x) + Math.abs(f.y - y))) + Math.abs(x - VILLAGE.x) * 0.2;
      if (d < bd) { bd = d; best = { x, y }; }
    }
  }
  return best;
}

function findBuildSpot(s) {
  for (let r = 3; r <= 12; r++) {
    const candidates = [];
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = VILLAGE.x + dx;
        const y = VILLAGE.y + dy;
        if (Math.abs(y - ROAD_Y) <= 1) continue;
        if (canBuildAt(s, x, y)) candidates.push({ x, y });
      }
    }
    if (candidates.length) return pick(s, candidates);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Player interventions
// ---------------------------------------------------------------------------

export function plantTree(sim, x, y) {
  const s = sim.state;
  if (!canPlantAt(s, x, y)) return { ok: false, reason: 'Trees need open, dry ground.' };
  s.trees.push({ id: s.nextId++, x, y, growth: 0.05, claimedBy: null, planted: true });
  addLog(sim, (n) => (n > 1 ? `You planted ${n} saplings.` : 'You planted a sapling.'), 'plant-tree');
  return { ok: true };
}

export function placeHouse(sim, x, y) {
  const s = sim.state;
  if (!canBuildAt(s, x, y)) return { ok: false, reason: 'A house needs clear, dry ground away from other buildings.' };
  s.buildings.push(newSite(s, x, y, true));
  addLog(sim, `You marked out a new house. The builders will need ${RULES.houseWood} wood.`);
  return { ok: true };
}

export function tillField(sim, x, y) {
  const s = sim.state;
  if (!canTillAt(s, x, y)) return { ok: false, reason: 'A field needs a clear 2×2 patch of grass.' };
  s.fields.push({ id: s.nextId++, x, y, state: 'fallow', growth: 0, tended: 0, claimedBy: null });
  addLog(sim, (n) => (n > 1 ? `You tilled ${n} new fields.` : 'You tilled a new field. A farmer will sow it.'), 'till');
  return { ok: true };
}

export function addFood(sim, amount = RULES.foodShipment) {
  const s = sim.state;
  s.food += amount;
  const g = granary(s);
  float(sim, g.x + 0.5, g.y - 0.8, `+${amount} 🍞`);
  addLog(sim, (n) => (n > 1 ? `${n} food shipments arrived (${n * amount} food).` : `A shipment of ${amount} food arrived at the granary.`), 'add-food');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function granary(s) { return s.buildings.find((b) => b.type === 'granary'); }
export function homeOf(s, p) { return p.home ? s.buildings.find((b) => b.id === p.home && b.type === 'house') : null; }
export function activeSite(s) { return s.buildings.find((b) => b.type === 'site'); }
function siteNeedingWood(s) { return s.buildings.find((b) => b.type === 'site' && b.woodDelivered + b.incoming < b.woodNeeded); }
export function housingCapacity(s) { return s.buildings.filter((b) => b.type === 'house').reduce((n, b) => n + b.capacity, 0); }
export function freeBeds(s) { return housingCapacity(s) - s.buildings.filter((b) => b.type === 'house').reduce((n, b) => n + b.residents.length, 0); }
export function averageHappiness(s) { return s.people.length ? s.people.reduce((n, p) => n + p.happiness, 0) / s.people.length : 0; }

export function stats(sim) {
  const s = sim.state;
  return {
    settlement: s.settlement,
    day: dayOf(s.tick),
    time: formatTime(s.tick),
    minute: minuteOf(s.tick),
    population: s.people.length,
    food: s.food,
    wood: s.wood,
    foodToday: s.food - s.dayStart.food,
    woodToday: s.wood - s.dayStart.wood,
    housing: housingCapacity(s),
    housed: s.people.filter((p) => homeOf(s, p)).length,
    happiness: Math.round(averageHappiness(s)),
    trees: s.trees.filter((t) => t.growth >= 1).length,
    saplings: s.trees.filter((t) => t.growth < 1).length,
    fields: s.fields.length,
    ripe: s.fields.filter((f) => f.state === 'ripe').length,
    berries: s.bushes.reduce((n, b) => n + b.berries, 0),
    doctorPurse: doctor(s)?.coins ?? 0,
    marketDay: s.marketDay === dayOf(s.tick),
    building: !!activeSite(s),
  };
}

// ---------------------------------------------------------------------------
// Spatial helpers
// ---------------------------------------------------------------------------

function clamp(v, lo = 0, hi = 100) { return v < lo ? lo : v > hi ? hi : v; }
function atHome(p, home) { return Math.hypot(p.x - (home.x + 0.5), p.y - (home.y + 1.5)) < 0.8; }
function door(b) { return { x: b.x, y: b.y + 1 }; }
function fieldSpot(f) { return { x: f.x, y: f.y, fx: f.x + 1, fy: f.y + 1 }; }

function nearest(list, p) {
  let best = null;
  let bd = Infinity;
  for (const o of list) {
    const d = Math.abs(o.x - p.x) + Math.abs(o.y - p.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function besideSpot(sim, o) {
  const s = sim.state;
  for (const [dx, dy] of [[0, 1], [-1, 0], [1, 0], [0, -1]]) {
    if (walkable(s, o.x + dx, o.y + dy)) return { x: o.x + dx, y: o.y + dy, fx: o.x + 0.5 + dx * 0.55, fy: o.y + 0.5 + dy * 0.55 };
  }
  return { x: o.x, y: o.y };
}

function campfireSpot(sim, p) {
  const s = sim.state;
  const angle = ((p.id * 137) % 360) * (Math.PI / 180);
  const r = 1.4 + (p.id % 3) * 0.35;
  const fx = CAMPFIRE.x + 0.5 + Math.cos(angle) * r;
  const fy = CAMPFIRE.y + 0.5 + Math.sin(angle) * r;
  const x = Math.floor(fx);
  const y = Math.floor(fy);
  if (!walkable(s, x, y)) return { x: CAMPFIRE.x, y: CAMPFIRE.y + 1 };
  return { x, y, fx, fy };
}

function riversideSpot(sim, p) {
  const s = sim.state;
  const y = randInt(s, 4, s.h - 5);
  const x = s.riverX[y] - 1;
  return walkable(s, x, y) ? { x, y } : strollSpot(sim, p);
}

function strollSpot(sim, p) {
  const s = sim.state;
  for (let i = 0; i < 10; i++) {
    const x = Math.floor(p.x) + randInt(s, -4, 4);
    const y = Math.floor(p.y) + randInt(s, -4, 4);
    if (walkable(s, x, y)) return { x, y };
  }
  return { x: VILLAGE.x, y: VILLAGE.y };
}

export { TASKS };
