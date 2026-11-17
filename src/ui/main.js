// Browser entry point: wires the simulation, the clock, the renderer, input, and persistence.
import {
  createSim, deserialize, serialize, step, stats, plantTree, placeHouse, tillField, addFood,
  homeOf, formatTime, dayOf, TASKS,
} from '../sim/sim.js';
import { canPlantAt, canBuildAt, canTillAt } from '../sim/world.js';
import { TRAITS } from '../sim/names.js';
import { createClock, advanceClock, SPEEDS } from '../sim/clock.js';
import { createRenderer, render, TILE } from './render.js';

const SAVE_KEY = 'little-world.save.v1';
const PREFS_KEY = 'little-world.prefs.v1';
const OCC_COLORS = { Farmer: '#4f9a45', Gatherer: '#8a63c4', Builder: '#e0852f', Laborer: '#6f7f8f', Leader: '#d23f3a', Merchant: '#1f9a9a' };

const $ = (id) => document.getElementById(id);
const canvas = $('world');
const renderer = createRenderer(canvas);
const clock = createClock();

let sim = loadOrCreate();
let lastFrame = performance.now();
let lastPanel = 0;
let lastSave = performance.now();
let lastLogLength = 0;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function storage() {
  try { return window.localStorage; } catch { return null; }
}

function loadOrCreate() {
  const params = new URLSearchParams(location.search);
  const seedParam = params.get('seed');
  if (!params.has('fresh')) {
    try {
      const raw = storage()?.getItem(SAVE_KEY);
      if (raw) return deserialize(raw);
    } catch (err) {
      console.warn('Could not restore saved world; starting fresh.', err);
    }
  }
  const seed = seedParam ? Number(seedParam) : Math.floor(Math.random() * 2 ** 31);
  return createSim(seed);
}

function save() {
  try { storage()?.setItem(SAVE_KEY, serialize(sim)); } catch { /* storage full or unavailable */ }
  try { storage()?.setItem(PREFS_KEY, JSON.stringify({ speed: clock.speed })); } catch { /* ignore */ }
}

try {
  const prefs = JSON.parse(storage()?.getItem(PREFS_KEY) || '{}');
  if (SPEEDS.includes(prefs.speed)) clock.speed = prefs.speed;
} catch { /* ignore */ }

addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

function frame(now) {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  const ticks = advanceClock(clock, dt);
  for (let i = 0; i < ticks; i++) step(sim);
  render(renderer, sim, clock, dt);
  if (now - lastPanel > 250) { updatePanel(); lastPanel = now; }
  if (now - lastSave > 5000) { save(); lastSave = now; }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function setPaused(paused) {
  clock.paused = paused;
  $('play').textContent = paused ? '▶' : '⏸';
  $('play').setAttribute('aria-label', paused ? 'Resume' : 'Pause');
  updatePanel();
}

function setSpeed(speed) {
  clock.speed = speed;
  for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
  if (clock.paused) setPaused(false);
}

function setTool(tool) {
  renderer.tool = tool;
  for (const b of document.querySelectorAll('#tools button')) b.classList.toggle('on', b.dataset.tool === tool);
  canvas.classList.toggle('placing', tool !== 'inspect');
  const hints = {
    inspect: 'Tap an inhabitant to see what they are doing.',
    tree: 'Tap open ground to plant a sapling. Trees grow in about two days, cheer up nearby homes, and become lumber.',
    house: 'Tap clear ground to mark out a house. Builders haul 16 wood to it and raise the walls.',
    till: 'Tap a patch of grass to till a 2×2 field. A farmer will come and sow it.',
  };
  hint(hints[tool]);
}

function hint(text, warn = false) {
  const el = $('hint');
  el.textContent = text;
  el.classList.toggle('warn', warn);
}

$('play').addEventListener('click', () => setPaused(!clock.paused));
for (const b of document.querySelectorAll('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
for (const b of document.querySelectorAll('#tools button')) b.addEventListener('click', () => setTool(b.dataset.tool));
$('food').addEventListener('click', () => { addFood(sim); updatePanel(); });
$('reset').addEventListener('click', () => {
  if (!confirm('Start a brand-new civilization? New Beginnings will be lost.')) return;
  sim = createSim(Math.floor(Math.random() * 2 ** 31));
  renderer.selectedId = null;
  renderer.disp.clear();
  lastLogLength = 0;
  save();
  updatePanel();
});

addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); setPaused(!clock.paused); }
  const speedKey = { Digit1: 1, Digit2: 3, Digit3: 10, Digit4: 30 }[e.code];
  if (speedKey) setSpeed(speedKey);
  const toolKey = { KeyI: 'inspect', KeyT: 'tree', KeyH: 'house', KeyF: 'till', Escape: 'inspect' }[e.code];
  if (toolKey) setTool(toolKey);
});

function eventTile(e) {
  const rect = canvas.getBoundingClientRect();
  const fx = ((e.clientX - rect.left) / rect.width) * sim.state.w;
  const fy = ((e.clientY - rect.top) / rect.height) * sim.state.h;
  return { fx, fy, x: Math.floor(fx), y: Math.floor(fy) };
}

function personAt(fx, fy) {
  let best = null;
  let bd = 1.1;
  for (const p of sim.state.people) {
    const d = renderer.disp.get(p.id);
    if (!d || d.alpha < 0.5) continue;
    const dist = Math.hypot(d.x - fx, d.y - 0.35 - fy);
    if (dist < bd) { bd = dist; best = p; }
  }
  return best;
}

canvas.addEventListener('pointermove', (e) => {
  const t = eventTile(e);
  const s = sim.state;
  if (renderer.tool === 'inspect') {
    renderer.hover = null;
    renderer.hoverPersonId = personAt(t.fx, t.fy)?.id ?? null;
    return;
  }
  const ok = renderer.tool === 'tree' ? canPlantAt(s, t.x, t.y) : renderer.tool === 'house' ? canBuildAt(s, t.x, t.y) : canTillAt(s, t.x, t.y);
  renderer.hover = { x: t.x, y: t.y, ok };
});
canvas.addEventListener('pointerleave', () => { renderer.hover = null; renderer.hoverPersonId = null; });

canvas.addEventListener('click', (e) => {
  const t = eventTile(e);
  if (renderer.tool === 'inspect') {
    const p = personAt(t.fx, t.fy);
    renderer.selectedId = p ? p.id : null;
    updatePanel();
    return;
  }
  const action = { tree: plantTree, house: placeHouse, till: tillField }[renderer.tool];
  const result = action(sim, t.x, t.y);
  if (!result.ok) hint(result.reason, true);
  else { setTool(renderer.tool); updatePanel(); }
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

function esc(text) {
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function delta(n) {
  if (!n) return '<span class="d">±0 today</span>';
  return `<span class="d ${n > 0 ? 'up' : 'down'}">${n > 0 ? '+' : ''}${n} today</span>`;
}

function updatePanel() {
  const st = stats(sim);
  const s = sim.state;
  $('subtitle').textContent = `${st.settlement} — Population ${st.population}`;
  $('clock').textContent = `Day ${st.day} · ${st.time}${clock.paused ? ' · Paused' : clock.speed > 1 ? ` · ${clock.speed}×` : ''}`;
  document.title = `${st.settlement} · Day ${st.day} — The Little World`;

  const banners = [];
  if (st.marketDay) banners.push('🎉 Market day — Doctor is giving meals away.');
  if (s.flags.rally) banners.push('📣 Rook has rallied everyone to bring in food.');
  if (st.population === 0) banners.push('The settlement is empty. Start a new world to try again.');
  $('stats').innerHTML = `
    <div class="stat"><div class="k">Population</div><div class="v">${st.population}</div><span class="d">peak ${s.peakPopulation}</span></div>
    <div class="stat"><div class="k">Food</div><div class="v">${st.food}</div>${delta(st.foodToday)}</div>
    <div class="stat"><div class="k">Wood</div><div class="v">${st.wood}</div>${delta(st.woodToday)}</div>
    <div class="stat"><div class="k">Housing</div><div class="v">${st.housed}/${st.housing}</div><span class="d">${st.building ? 'building…' : `${st.housing - st.housed} free beds`}</span></div>
    <div class="stat"><div class="k">Happiness</div><div class="v">${st.happiness}%</div><span class="d">average</span></div>
    <div class="stat"><div class="k">Day</div><div class="v">${st.day}</div><span class="d">${st.time}</span></div>
    <div class="stat"><div class="k">Fields</div><div class="v">${st.fields}</div><span class="d">${st.ripe} ripe</span></div>
    <div class="stat"><div class="k">Trees</div><div class="v">${st.trees}</div><span class="d">${st.saplings} saplings</span></div>
    <div class="stat"><div class="k">Berries</div><div class="v">${st.berries}</div><span class="d">on bushes</span></div>
    ${banners.map((b) => `<div class="banner">${esc(b)}</div>`).join('')}
  `;

  renderInspector();
  renderLog();
  renderPeople();
}

function bar(label, value, color) {
  const v = Math.round(value);
  return `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${v}%;background:${color}"></div></div><span class="num">${v}%</span></div>`;
}

function renderInspector() {
  const el = $('inspector');
  const s = sim.state;
  const p = s.people.find((o) => o.id === renderer.selectedId);
  if (!p) {
    el.innerHTML = `<h2>Inhabitant</h2><p class="inspector-empty">Tap someone in the world, or pick a name below, to follow what they are doing and why.</p>`;
    return;
  }
  const home = homeOf(s, p);
  const housemates = home ? home.residents.filter((id) => id !== p.id).map((id) => s.people.find((o) => o.id === id)?.name).filter(Boolean) : [];
  const carrying = p.carrying ? `${p.carrying.amount} ${p.carrying.type}` : 'nothing';
  el.innerHTML = `
    <div class="who"><h3>${esc(p.name)}</h3><span>Age ${p.age}</span></div>
    <p class="tagline"><span style="color:${OCC_COLORS[p.occupation]}">●</span> ${esc(p.occupation)} · ${esc(p.trait)} — ${esc(TRAITS[p.trait] || '')}</p>
    <div class="doing">
      <div class="now">${esc(p.icon || '')} ${esc(p.activity)}</div>
      <div class="why">Why: ${esc(p.reason || '—')}</div>
    </div>
    <div class="bars">
      ${bar('Health', p.health, '#34c759')}
      ${bar('Happiness', p.happiness, '#ff9f0a')}
      ${bar('Fullness', 100 - p.hunger, '#d2691e')}
      ${bar('Energy', p.energy, '#0a84ff')}
    </div>
    <div class="facts">
      <div>Home <b>${home ? (housemates.length ? `with ${esc(housemates.join(', '))}` : 'own house') : 'none — sleeps by the fire'}</b></div>
      <div>Carrying <b>${esc(carrying)}</b></div>
      <div>Coins <b>${p.coins}${p.debt ? ` (owes ${p.debt})` : ''}</b></div>
      <div>Meals eaten <b>${p.stats.meals}</b></div>
      <div>Food brought in <b>${p.stats.food}</b></div>
      <div>Wood brought in <b>${p.stats.wood}</b></div>
    </div>
  `;
}

function renderLog() {
  const s = sim.state;
  const el = $('log');
  const entries = s.log.slice(-80).reverse();
  const fresh = s.log.length - lastLogLength;
  el.innerHTML = entries.map((e, i) => `<li class="${i < fresh && lastLogLength ? 'fresh' : ''}"><span class="when">Day ${e.day} · ${e.time}</span>${esc(e.text)}</li>`).join('');
  lastLogLength = s.log.length;
}

function renderPeople() {
  const s = sim.state;
  const el = $('people');
  el.innerHTML = s.people.map((p) => `
    <li data-id="${p.id}" class="${p.id === renderer.selectedId ? 'on' : ''}">
      <span class="dot" style="background:${OCC_COLORS[p.occupation]}"></span>
      <span>${esc(p.name)} <span style="color:var(--ink-3)">· ${esc(p.occupation)}</span></span>
      <span class="act">${esc(p.icon || '')} ${esc(p.activity)}</span>
    </li>`).join('');
}

$('people').addEventListener('click', (e) => {
  const li = e.target.closest('li[data-id]');
  if (!li) return;
  renderer.selectedId = Number(li.dataset.id);
  setTool('inspect');
  updatePanel();
});

// ---------------------------------------------------------------------------

setSpeed(clock.speed);
setTool('inspect');
updatePanel();
requestAnimationFrame(frame);

// Handy for debugging in the console.
window.littleWorld = { get sim() { return sim; }, clock, renderer, save, TILE, formatTime, dayOf, TASKS };
