// Deterministic checks of the simulation rules. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSim, run, step, serialize, deserialize, stats, plantTree, placeHouse, tillField, addFood,
  RULES, DAWN, NIGHT, MINUTES_PER_DAY, dayOf, minuteOf, housingCapacity, homeOf,
} from '../src/sim/sim.js';
import { canPlantAt, canBuildAt, canTillAt } from '../src/sim/world.js';
import { createClock, advanceClock, SIM_MINUTES_PER_SECOND, MAX_TICKS_PER_FRAME } from '../src/sim/clock.js';

const DAY = MINUTES_PER_DAY;

function findSpot(sim, ok) {
  const s = sim.state;
  for (let y = 2; y < s.h - 2; y++) for (let x = 2; x < s.w - 2; x++) if (ok(s, x, y)) return { x, y };
  throw new Error('no spot');
}

test('a new world matches the intent: ten inhabitants, five houses, Rook, Doctor and Jenny', () => {
  const sim = createSim(42);
  const s = sim.state;
  assert.equal(s.people.length, 10);
  assert.equal(s.buildings.filter((b) => b.type === 'house').length, 5);
  assert.equal(housingCapacity(s), 10);
  for (const name of ['Rook', 'Doctor', 'Jenny']) assert.ok(s.people.some((p) => p.name === name), name);
  assert.ok(s.tiles.includes(1), 'has a river');
  assert.ok(s.trees.length > 50, 'has woods');
  assert.equal(new Set(s.people.map((p) => p.name)).size, 10, 'names are unique');
  assert.equal(s.settlement, 'New Beginnings');
});

test('simulation time advances one minute per tick, starting at dawn on day 1', () => {
  const sim = createSim(1);
  assert.equal(dayOf(sim.state.tick), 1);
  assert.equal(minuteOf(sim.state.tick), DAWN);
  run(sim, 60);
  assert.equal(stats(sim).time, '07:00');
  run(sim, DAY);
  assert.equal(stats(sim).day, 2);
  assert.equal(stats(sim).time, '07:00');
});

test('the same seed produces the same world history (determinism)', () => {
  const a = createSim(2026);
  const b = createSim(2026);
  run(a, 3 * DAY);
  run(b, 3 * DAY);
  assert.equal(serialize(a), serialize(b));
  const c = createSim(2027);
  run(c, 3 * DAY);
  assert.notEqual(serialize(a), serialize(c));
});

test('saving and restoring preserves the world exactly, including what happens next', () => {
  const a = createSim(7);
  run(a, 2 * DAY + 333);
  const b = deserialize(serialize(a));
  run(a, DAY);
  run(b, DAY);
  assert.equal(serialize(a), serialize(b));
});

test('restoring rejects data that is not a Little World save', () => {
  assert.throws(() => deserialize('{"hello":1}'));
  assert.throws(() => deserialize('not json'));
});

test('hunger rises over time and eating a meal consumes one food from the granary', () => {
  const sim = createSim(3);
  const s = sim.state;
  const p = s.people.find((o) => o.name === 'Jenny');
  const h0 = p.hunger;
  step(sim);
  assert.ok(p.hunger > h0, 'hunger rises');
  // Make Jenny hungry and watch the granary.
  p.hunger = 70;
  p.task = null;
  const before = s.food;
  let ate = false;
  for (let i = 0; i < 400 && !ate; i++) {
    step(sim);
    if (p.stats.meals > 0) ate = true;
  }
  assert.ok(ate, 'Jenny went and ate');
  assert.ok(p.hunger < 40, `hunger dropped (${p.hunger})`);
  assert.ok(s.totals.meals >= 1);
  // food consumed = meals eaten minus food delivered during the window
  assert.equal(s.food, before - s.totals.meals + s.totals.foodProduced - (s.totals.spoiled || 0));
});

test('food changes only through production and consumption', () => {
  const sim = createSim(11);
  const s = sim.state;
  const start = s.food;
  run(sim, 4 * DAY);
  assert.equal(s.food, start + s.totals.foodProduced - s.totals.meals - (s.totals.spoiled || 0));
});

test('a farmer harvests ripe crops and carries the food to the granary', () => {
  const sim = createSim(5);
  const s = sim.state;
  for (const f of s.fields) { f.state = 'ripe'; f.growth = 1; }
  run(sim, 6 * 60);
  const farmers = s.people.filter((p) => p.occupation === 'Farmer');
  assert.ok(farmers.some((p) => p.stats.harvests > 0), 'some farmer harvested');
  assert.ok(s.totals.foodProduced >= RULES.harvestYield, 'food was delivered');
  assert.ok(s.log.some((e) => /harvested the first crop/.test(e.text)));
});

test('fields grow only in daylight and ripen after enough growing time', () => {
  const sim = createSim(5);
  const s = sim.state;
  const f = s.fields[0];
  f.state = 'growing'; f.growth = 0; f.claimedBy = 999999; // nobody touches it
  s.tick = 22 * 60; // night
  run(sim, 6 * 60);
  assert.equal(f.growth, 0, 'no growth at night');
  run(sim, 2 * DAY);
  assert.equal(f.state, 'ripe');
});

test('inhabitants perform their occupations', () => {
  const sim = createSim(42);
  const s = sim.state;
  const seen = new Map();
  for (let i = 0; i < 2 * DAY; i++) {
    step(sim);
    for (const p of s.people) {
      if (!p.task) continue;
      const set = seen.get(p.occupation) || new Set();
      set.add(p.task.kind);
      seen.set(p.occupation, set);
    }
  }
  const has = (occ, kinds) => kinds.some((k) => seen.get(occ)?.has(k));
  assert.ok(has('Farmer', ['plant', 'tend', 'harvest']), 'farmers farm');
  assert.ok(has('Gatherer', ['pick', 'chop']), 'gatherers gather');
  assert.ok(has('Builder', ['build', 'fetchWood', 'chop']), 'builders build');
  assert.ok(has('Leader', ['organize']), 'Rook organizes');
  assert.ok(has('Merchant', ['trade']), 'Doctor trades');
  for (const occ of seen.keys()) {
    assert.ok(seen.get(occ).has('sleep'), `${occ} sleeps`);
    assert.ok(seen.get(occ).has('eat') || occ === 'Merchant' || seen.get(occ).has('forage'), `${occ} eats`);
  }
});

test('at night everyone heads to bed; housed inhabitants sleep at home', () => {
  const sim = createSim(9);
  const s = sim.state;
  run(sim, NIGHT - DAWN + 120); // 23:30 on day 1
  const asleep = s.people.filter((p) => p.task?.kind === 'sleep');
  assert.ok(asleep.length >= s.people.length - 2, `${asleep.length} of ${s.people.length} in bed`);
  for (const p of asleep) assert.ok(homeOf(s, p), `${p.name} has a home`);
});

test('the player can add food, and it lands in the granary', () => {
  const sim = createSim(4);
  const before = sim.state.food;
  assert.ok(addFood(sim).ok);
  assert.equal(sim.state.food, before + RULES.foodShipment);
  assert.match(sim.state.log.at(-1).text, /shipment/);
});

test('a planted sapling grows into a mature tree', () => {
  const sim = createSim(4);
  const spot = findSpot(sim, canPlantAt);
  assert.ok(plantTree(sim, spot.x, spot.y).ok);
  const tree = sim.state.trees.at(-1);
  assert.ok(tree.growth < 1);
  assert.equal(plantTree(sim, spot.x, spot.y).ok, false, 'cannot plant twice on one tile');
  run(sim, RULES.saplingMinutes + 10);
  assert.equal(tree.growth, 1);
  assert.ok(sim.state.log.some((e) => /grown into a tree/.test(e.text)));
});

test('builders turn a marked-out house into housing using wood', () => {
  const sim = createSim(8);
  const s = sim.state;
  s.wood = 40;
  const spot = findSpot(sim, canBuildAt);
  assert.ok(placeHouse(sim, spot.x, spot.y).ok);
  const capacity = housingCapacity(s);
  const site = s.buildings.at(-1);
  let done = false;
  for (let i = 0; i < 4 * DAY && !done; i++) {
    step(sim);
    done = site.type === 'house';
  }
  assert.ok(done, 'house completed');
  assert.ok(housingCapacity(s) >= capacity + 2);
  assert.ok(s.totals.housesBuilt >= 1);
});

test('a tilled field gets sown by a farmer', () => {
  const sim = createSim(12);
  const spot = findSpot(sim, canTillAt);
  assert.ok(tillField(sim, spot.x, spot.y).ok);
  const field = sim.state.fields.at(-1);
  assert.equal(field.state, 'fallow');
  for (const f of sim.state.fields) if (f !== field) { f.state = 'growing'; f.tended = 9999; f.growth = 0.1; }
  run(sim, DAY);
  assert.notEqual(field.state, 'fallow');
});

test('without food, inhabitants go hungry and their health suffers', () => {
  const sim = createSim(13);
  const s = sim.state;
  s.food = 0;
  for (const f of s.fields) { f.state = 'fallow'; f.growth = 0; }
  for (const b of s.bushes) b.berries = 0;
  run(sim, 2 * DAY);
  const avgHealth = s.people.reduce((n, p) => n + p.health, 0) / Math.max(1, s.people.length);
  assert.ok(avgHealth < 100);
  assert.ok(s.log.some((e) => /running low|granary is empty/.test(e.text)));
});

test('the clock pauses, resumes and accelerates', () => {
  const c = createClock();
  assert.equal(advanceClock(c, 1000), SIM_MINUTES_PER_SECOND);
  c.paused = true;
  assert.equal(advanceClock(c, 1000), 0);
  c.paused = false;
  c.speed = 10;
  assert.equal(advanceClock(c, 1000), SIM_MINUTES_PER_SECOND * 10);
  c.speed = 30;
  assert.equal(advanceClock(c, 5000), MAX_TICKS_PER_FRAME, 'a long stall is capped, not replayed');
});

test('stability: thirty simulated days run without errors and the world stays coherent', () => {
  for (const seed of [1, 42, 777]) {
    const sim = createSim(seed);
    run(sim, 30 * DAY);
    const s = sim.state;
    assert.ok(s.people.length > 0, `seed ${seed}: settlement survived`);
    assert.ok(s.food >= 0 && Number.isFinite(s.food));
    assert.ok(s.wood >= 0 && Number.isFinite(s.wood));
    for (const p of s.people) {
      for (const k of ['hunger', 'energy', 'health', 'happiness', 'x', 'y']) assert.ok(Number.isFinite(p[k]), `${p.name}.${k}`);
      assert.ok(p.x >= 0 && p.y >= 0 && p.x <= s.w && p.y <= s.h);
    }
    const coins = s.people.reduce((n, p) => n + p.coins, 0);
    assert.ok(coins >= 0);
  }
});
