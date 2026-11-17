// Agent World — browser entry point. Wires the simulation, the shared clock, the rendering
// adapter, the inspectors, the activity feed, the dashboard, and the experiment controls.
import { createAgentSim, step, metrics, formatSimTime } from '../agentworld/sim.js';
import { CONFIGS, ROLES, ROLE_ORDER, SIGNALS, STRUCTURES, ACTIONS, AW_CLOCK_RATE, TICKS_PER_MINUTE, TICK_SECONDS } from '../agentworld/rules.js';
import { structById, agentById, domainById, effectiveReliability, linkedIds, isComplete } from '../agentworld/world.js';
import { createClock, advanceClock, SPEEDS } from '../sim/clock.js';
import { createAgentRenderer, renderAgentWorld, agentAt, structureAt } from './agentworld-render.js';
import { createAmbience, startAmbience, setAmbienceMode, updateAmbience } from './ambience.js';
import { MODES } from './score.js';

const PREFS_KEY = 'agent-world.prefs.v1';
const EXPERIMENT_TICKS = 10 * TICKS_PER_MINUTE;
const $ = (id) => document.getElementById(id);
const canvas = $('world');
const renderer = createAgentRenderer(canvas);
const clock = createClock(AW_CLOCK_RATE);
const ambience = createAmbience();

let started = false;
let config = 'mixed';
let seed = 42;
let sim;
let lastFrame = performance.now();
let lastPanel = 0;
let lastLogLength = 0;

function storage() { try { return window.localStorage; } catch { return null; } }

function loadPrefs() {
  try {
    const p = JSON.parse(storage()?.getItem(PREFS_KEY) || '{}');
    if (CONFIGS[p.config]) config = p.config;
    if (Number.isFinite(p.seed)) seed = p.seed;
    if (SPEEDS.includes(p.speed)) clock.speed = p.speed; else clock.speed = 3;
    if (MODES.includes(p.sound)) ambience.mode = p.sound;
  } catch { clock.speed = 3; }
  const q = new URLSearchParams(location.search);
  if (q.has('seed')) seed = Number(q.get('seed')) >>> 0;
  if (CONFIGS[q.get('config')]) config = q.get('config');
}

function savePrefs() {
  try { storage()?.setItem(PREFS_KEY, JSON.stringify({ config, seed, speed: clock.speed, sound: ambience.mode })); } catch { /* ignore */ }
}

function newExperiment() {
  sim = createAgentSim(seed, config);
  renderer.disp.clear();
  renderer.floats = [];
  renderer.selectedAgentId = null;
  renderer.selectedStructId = null;
  lastLogLength = 0;
  $('log')._key = null;
  started = false;
  clock.paused = true;
  clock.acc = 0;
  $('seed').value = String(seed);
  for (const b of document.querySelectorAll('#configs button')) b.classList.toggle('on', b.dataset.config === config);
  showPlay();
  updatePanel();
}

// ---------------------------------------------------------------------------
// Loop
// ---------------------------------------------------------------------------

function frame(now) {
  const dt = Math.min(now - lastFrame, 250);
  lastFrame = now;
  const ticks = advanceClock(clock, dt);
  for (let i = 0; i < ticks; i++) step(sim);
  renderAgentWorld(renderer, sim, clock, dt);
  updateAmbience(ambience, { paused: clock.paused, night: false });
  if (now - lastPanel > 300) { updatePanel(); lastPanel = now; }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function showPlay() {
  const b = $('play');
  b.textContent = !started ? '▶ Start' : clock.paused ? '▶ Resume' : '⏸ Pause';
  b.classList.toggle('start', !started);
}

function togglePlay() {
  if (!started) {
    started = true; clock.paused = false;
    hint('Tap an agent to see what it perceives, the options it scored, and why it chose. Tap a building or link to inspect it.');
  }
  else clock.paused = !clock.paused;
  showPlay();
  updatePanel();
}

function setSpeed(speed) {
  clock.speed = speed;
  for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === speed);
  savePrefs();
}

function hint(text) { $('hint').textContent = text; }

$('play').addEventListener('click', togglePlay);
for (const b of document.querySelectorAll('#speeds button')) b.addEventListener('click', () => setSpeed(Number(b.dataset.speed)));
for (const b of document.querySelectorAll('#configs button')) {
  b.addEventListener('click', () => {
    config = b.dataset.config;
    savePrefs();
    newExperiment();
    hint(`${CONFIGS[config].label}, seed ${seed}. Press Start.`);
  });
}
$('reset').addEventListener('click', () => {
  const v = Number($('seed').value);
  seed = Number.isFinite(v) && $('seed').value !== '' ? Math.abs(Math.floor(v)) >>> 0 : Math.floor(Math.random() * 1e6);
  savePrefs();
  newExperiment();
  hint(`Reset: ${CONFIGS[config].label}, seed ${seed}. Same seed, same world, same decisions. Press Start.`);
});
$('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('reset').click(); });

addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea')) return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'KeyM') cycleSound();
  const speedKey = { Digit1: 1, Digit2: 3, Digit3: 10, Digit4: 30 }[e.code];
  if (speedKey) setSpeed(speedKey);
  if (e.code === 'Escape') { renderer.selectedAgentId = null; renderer.selectedStructId = null; updatePanel(); }
});

// Sound: the same synthesized soundtrack as Little World, as a simple on/off switch.
function showSound() {
  const b = $('sound');
  const on = ambience.mode !== 'off';
  b.textContent = on ? '🔊 Sound on' : '🔇 Sound off';
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', on ? 'Sound on — tap to turn off' : 'Sound off — tap to turn on');
  b.classList.toggle('muted', !on);
}
let soundJustStarted = false;
function cycleSound() {
  // If this tap is what first woke the audio, it simply starts the sound that is already on.
  if (soundJustStarted) { soundJustStarted = false; return; }
  setAmbienceMode(ambience, ambience.mode === 'off' ? 'both' : 'off');
  if (ambience.mode !== 'off') startAmbience(ambience);
  showSound();
  savePrefs();
}
function firstGesture(e) {
  soundJustStarted = ambience.mode !== 'off' && !!e.target.closest?.('#sound');
  removeEventListener('pointerdown', firstGesture, true);
  removeEventListener('keydown', firstGesture, true);
  if (ambience.mode !== 'off') startAmbience(ambience);
}
addEventListener('pointerdown', firstGesture, true);
addEventListener('keydown', firstGesture, true);
$('sound').addEventListener('click', cycleSound);

// Canvas selection
function eventTile(e) {
  const rect = canvas.getBoundingClientRect();
  return { fx: ((e.clientX - rect.left) / rect.width) * sim.state.w, fy: ((e.clientY - rect.top) / rect.height) * sim.state.h };
}
canvas.addEventListener('pointermove', (e) => {
  const t = eventTile(e);
  const a = agentAt(renderer, sim.state, t.fx, t.fy);
  renderer.hoverAgentId = a?.id ?? null;
  renderer.hoverStructId = a ? null : structureAt(sim.state, t.fx, t.fy)?.id ?? null;
});
canvas.addEventListener('pointerleave', () => { renderer.hoverAgentId = null; renderer.hoverStructId = null; });
canvas.addEventListener('click', (e) => {
  const t = eventTile(e);
  const a = agentAt(renderer, sim.state, t.fx, t.fy);
  if (a) select('agent', a.id);
  else {
    const st = structureAt(sim.state, t.fx, t.fy);
    if (st) select('struct', st.id);
    else { renderer.selectedAgentId = null; renderer.selectedStructId = null; updatePanel(); }
  }
});

function select(kind, id) {
  renderer.selectedAgentId = kind === 'agent' ? id : null;
  renderer.selectedStructId = kind === 'struct' ? id : null;
  updatePanel();
  if (matchMedia('(max-width: 980px)').matches) $('inspector').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-agent],[data-struct]');
  if (!el || el.closest('canvas')) return;
  if (el.dataset.agent) select('agent', Number(el.dataset.agent));
  else select('struct', Number(el.dataset.struct));
});

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

/** Replace markup only when it actually changed, so taps are not lost to a redraw. */
function setHTML(el, html) {
  if (el._html !== html) { el.innerHTML = html; el._html = html; }
}
let pointerDown = false;
addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => setTimeout(() => { pointerDown = false; }, 120), true);

function esc(t) {
  return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
const pct = (v) => `${Math.round(v * 100)}%`;
const sign = (v) => (v > 0 ? `+${v}` : `${v}`.replace('-', '−'));

function updatePanel() {
  const s = sim.state;
  const m = metrics(s);
  const t = formatSimTime(s.tick);
  const done = s.tick >= EXPERIMENT_TICKS;
  $('subtitle').textContent = `${CONFIGS[s.config].label} · seed ${s.seed} · ${s.agents.length} agents`;
  $('clock').textContent = `${t}${done ? '' : ' / 10:00'}${!started ? ' · Ready' : clock.paused ? ' · Paused' : clock.speed > 1 ? ` · ${clock.speed}×` : ''}`;
  document.title = `${t} · ${CONFIGS[s.config].label} — Agent World`;
  if (done && !sim.announced) {
    sim.announced = true;
    hint(`Ten simulated minutes: ${m.completed} structures, reliability ${pct(m.reliability)}, ${m.cooperation} cooperation / ${m.competition} competition events. It keeps running — or try Compare worlds.`);
  }

  const tile = (k, v, d, cls = '') => `<div class="stat"><div class="k">${k}</div><div class="v ${cls}">${v}</div><span class="d">${d}</span></div>`;
  $('stats').innerHTML = [
    tile('Active agents', `${m.activeAgents}/${s.agents.length}`, `${m.resting} recharging`),
    tile('Structures', m.completed, `${m.underConstruction} building · ${m.connections} links`),
    tile('Reliability', pct(m.reliability), 'ecosystem, by usage'),
    tile('Useful work', `${m.usefulWork}s`, m.wastedWork ? `${m.wastedWork}s wasted` : 'none wasted'),
    tile('Compute', m.compute, `${m.computeSpent} spent`),
    tile('Reuse', m.reuses, 'library adoptions'),
    tile('Cooperation', m.cooperation, `${m.handoffs} handoffs`),
    tile('Competition', m.competition, `${m.contests} contests`),
    tile('Defects fixed', `${m.defectsRepaired}/${m.defectsDiscovered}`, `${m.defectsSurfaced} found in prod`),
  ].join('') + (done ? '<div class="banner">The ten-minute experiment is complete. The world keeps evolving.</div>' : '')
    + `<div class="banner subtle-b">${m.domainsKnown}/${s.domains.length} domains discovered · ${pct(m.explored)} explored · ${m.decisions} decisions made</div>`;

  $('trends').innerHTML = trends(s.history);
  if (pointerDown) return; // never swap out what someone is tapping
  renderInspector();
  renderFeed();
  renderAgents();
  renderStructures();
}

function spark(values, color, max) {
  if (values.length < 2) return '<svg viewBox="0 0 100 26"></svg>';
  const hi = max ?? Math.max(1, ...values);
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 100},${24 - (v / hi) * 22}`).join(' ');
  return `<svg viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function trends(h) {
  if (h.length < 2) return '<p class="muted-note">Trends appear after the first 30 simulated seconds.</p>';
  const recent = h.slice(-80);
  const coop = recent.map((x) => x.coop);
  const comp = recent.map((x) => x.comp);
  const hi = Math.max(1, ...coop, ...comp);
  return `
    <div class="trend"><span>Structures</span>${spark(recent.map((x) => x.completed), '#0a84ff')}</div>
    <div class="trend"><span>Reliability</span>${spark(recent.map((x) => x.reliability), '#34c759', 1)}</div>
    <div class="trend"><span>Compute</span>${spark(recent.map((x) => x.compute), '#14a3a3')}</div>
    <div class="trend"><span>Coop <i class="k-coop"></i> vs comp <i class="k-comp"></i></span><span class="dual">${spark(coop, '#34c759', hi)}${spark(comp, '#ff3b30', hi)}</span></div>`;
}

// ---------------------------------------------------------------------------
// Agent inspector — what it perceives, how it scored its options, what it is doing
// ---------------------------------------------------------------------------

const CYCLE = [['observe', 'Observe'], ['decide', 'Evaluate · Decide'], ['act', 'Act'], ['learn', 'Learn']];

function renderInspector() {
  const el = $('inspector');
  const s = sim.state;
  const a = agentById(s, renderer.selectedAgentId);
  if (a) { setHTML(el, agentCard(s, a)); return; }
  const st = structById(s, renderer.selectedStructId);
  if (st) { setHTML(el, structCard(s, st)); return; }
  setHTML(el, `<h2>Inspector</h2><p class="inspector-empty">Tap an agent to see what it perceives, every option it scored, and why it chose. Tap a building or a link to see its real state.</p>`);
}

function bar(label, v, color, text) {
  return `<div class="bar"><span>${label}</span><div class="track"><div class="fill" style="width:${Math.max(0, Math.min(100, v * 100))}%;background:${color}"></div></div><span class="num">${text ?? pct(v)}</span></div>`;
}

function agentCard(s, a) {
  const role = ROLES[a.role];
  const per = a.perception;
  const dec = a.decision;
  const t = a.task;
  const leanText = a.lean >= 0.5 ? 'leans cooperative' : 'leans competitive';
  const cycle = CYCLE.map(([k, l]) => `<span class="${a.phase === k ? 'on' : ''}">${l}</span>`).join('<i>→</i>');
  let progress = '';
  if (t) {
    if (t.phase === 'travel') progress = `walking · ${t.path.length} tiles to go`;
    else if (t.action === 'construct') { const st = structById(s, t.targetId); progress = st ? `building · ${Math.round(st.progress * 100)}% complete` : 'working'; }
    else if (t.action === 'rest') progress = `recharging · ${Math.round(a.energy)}%`;
    else if (t.needTicks) progress = `working · ${Math.min(100, Math.round((t.workTicks / t.needTicks) * 100))}%`;
  }
  const signals = per ? [...per.signals.slice(0, 7), ...per.remembered.slice(0, 3)] : [];
  return `
    <div class="who"><h3><span class="dot" style="background:${role.color}"></span>${esc(a.name)}</h3><span class="strat ${a.strategy}">${a.strategy}</span></div>
    <p class="tagline">${esc(a.role)} · ${leanText} (${a.lean.toFixed(2)}) · skills ${Object.entries(a.skills).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')}</p>
    <div class="cycle">${cycle}</div>
    <div class="doing">
      <div class="now">${esc(t ? `${t.icon} ${t.label}` : a.phase === 'learn' ? '✳️ Recording the outcome' : '💭 Looking around')}</div>
      <div class="why">${esc(t ? `→ ${t.target}${progress ? ` · ${progress}` : ''}` : a.objective)}</div>
    </div>
    <div class="bars">
      ${bar('Energy', a.energy / 100, '#0a84ff', `${Math.round(a.energy)}`)}
      ${bar('Lean', a.lean, a.lean >= 0.5 ? '#34c759' : '#ff3b30', a.lean.toFixed(2))}
    </div>
    <div class="facts">
      <div>Credit <b>${a.stats.credit.toFixed(1)}</b></div>
      <div>Succeeded / failed <b>${a.stats.success} / ${a.stats.failed}</b></div>
      <div>Cooperation <b>${a.stats.cooperation}</b></div>
      <div>Competition <b>${a.stats.competition}</b></div>
    </div>

    <h4>Perception <small>${per ? `at ${formatSimTime(per.tick)} · radius ${per.radius} tiles` : ''}</small></h4>
    ${per ? `
      <ul class="obs">${per.observations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>
      <div class="sub">Visible structures</div>
      <div class="chips small">${per.structures.length ? per.structures.slice(0, 12).map((p) => `<button data-struct="${p.id}" class="chip ${p.status}">${esc(p.name)} <small>${p.dist}</small></button>`).join('') : '<span class="muted-note">none</span>'}</div>
      <div class="sub">Nearby agents</div>
      <div class="chips small">${per.agents.length ? per.agents.slice(0, 8).map((o) => `<button data-agent="${o.id}" class="chip"><span class="dot" style="background:${ROLES[o.role].color}"></span>${esc(o.name)} <small>${o.dist}</small></button>`).join('') : '<span class="muted-note">none</span>'}</div>
      <div class="sub">Environmental signals</div>
      ${signals.length ? `<table class="sig">${signals.map((g) => `<tr${g.fromMemory ? ' class="mem"' : ''}><td><span class="dot" style="background:${SIGNALS[g.kind].color}"></span>${esc(g.label)}${g.fromMemory ? ' <small>remembered</small>' : ''}${g.flaggedBy ? ' <small>🚩</small>' : ''}</td><td class="meter"><i style="width:${Math.min(100, g.perceived * 100)}%;background:${SIGNALS[g.kind].color}"></i></td><td class="num">${g.perceived.toFixed(2)}</td><td class="num">${g.dist}</td></tr>`).join('')}</table>` : '<span class="muted-note">no signals within range</span>'}
    ` : '<p class="muted-note">Has not looked around yet.</p>'}

    <h4>Decision <small>${dec ? `at ${formatSimTime(dec.tick)} · ${dec.considered} options considered` : ''}</small></h4>
    ${dec ? `
      <table class="cands">${dec.candidates.map((c) => `
        <tr class="${c.chosen ? 'chosen' : ''}${c.valid ? '' : ' invalid'}">
          <td>${c.chosen ? '✓ ' : ''}<b>${esc(c.label)}</b><br><small>${esc(c.target || '')}${c.fromMemory ? ' · remembered' : ''}${c.contest ? ' · contested' : ''}</small>
            <div class="terms">${c.valid ? c.terms.map(([k, v]) => `<span class="${v < 0 ? 'neg' : ''}">${esc(k)} ${sign(v)}</span>`).join('') : `<span class="neg">not possible: ${esc(c.invalid)}</span>`}</div>
            ${c.inputs ? `<div class="inputs">signal ${c.inputs.signal} · skill ${c.inputs.skill} · personal ${c.inputs.personal}×${c.inputs.wPersonal} · shared ${c.inputs.shared}×${c.inputs.wShared}</div>` : ''}
          </td>
          <td class="num">${c.valid ? c.utility.toFixed(2) : '—'}</td>
          <td class="num">${c.valid ? `${Math.round(c.prob * 100)}%` : ''}</td>
        </tr>`).join('')}
      </table>
      <p class="reason"><b>Why:</b> ${esc(dec.reason)}</p>` : '<p class="muted-note">No decision yet.</p>'}

    <h4>Recent outcomes</h4>
    ${a.history.length ? `<ul class="hist">${a.history.slice(0, 8).map((h) => `<li class="${h.result}"><span class="when">${formatSimTime(h.tick)}</span>${esc(h.label)} → ${esc(h.target)} <small>${h.result}: ${esc(h.reason)}${h.credit ? ` · +${h.credit}` : ''}</small></li>`).join('')}</ul>` : '<p class="muted-note">Nothing finished yet.</p>'}
    ${a.strategy === 'adaptive' ? `<p class="muted-note">Adaptive learning: cooperative work earned ${a.learned.styleReward.coop ?? '—'} credit/s, competitive ${a.learned.styleReward.comp ?? '—'} credit/s.</p>` : ''}
  `;
}

// ---------------------------------------------------------------------------
// Structure inspector
// ---------------------------------------------------------------------------

function structCard(s, st) {
  const spec = STRUCTURES[st.type];
  const domain = st.domainId ? domainById(s, st.domainId) : null;
  const owner = agentById(s, st.ownerId);
  const interacting = s.agents.filter((a) => a.task && (a.task.targetId === st.id || a.task.libId === st.id || a.task.partnerId === st.id));
  const contributors = Object.entries(st.contributors).map(([id, sec]) => `${agentById(s, Number(id))?.name} ${Math.round(sec)}s`);
  const deps = st.deps.map((id) => structById(s, id)).filter(Boolean);
  const links = [...linkedIds(s, st)].map((id) => structById(s, id)).filter(Boolean);
  const users = s.structures.filter((o) => o.deps.includes(st.id) && o.status !== 'abandoned');
  const ends = st.type === 'connection' ? [structById(s, st.a), structById(s, st.b)].filter(Boolean) : [];
  const rel = effectiveReliability(st);
  const statusText = st.status === 'complete' ? 'Complete' : st.status === 'construction' ? `Under construction · ${Math.round(st.progress * 100)}%` : 'Decommissioned';
  const chip = (o) => `<button class="chip ${o.status}" data-struct="${o.id}">${esc(o.name)}</button>`;
  return `
    <div class="who"><h3>${esc(st.name)}</h3><span>${esc(spec.label)}${domain ? ` · ${esc(domain.name)}` : st.type === 'library' ? ' · commons' : ''}</span></div>
    <p class="tagline">${statusText} · created ${formatSimTime(st.createdTick)} by ${owner ? `<button class="link" data-agent="${owner.id}">${esc(owner.name)}</button>` : '—'}${st.completedTick ? ` · finished ${formatSimTime(st.completedTick)}` : ''}</p>
    <div class="bars">
      ${bar('Built', st.progress, '#0a84ff')}
      ${isComplete(st) && st.type !== 'connection' ? bar('Reliability', rel, rel > 0.82 ? '#34c759' : rel > 0.6 ? '#ff9f0a' : '#ff3b30') : ''}
      ${isComplete(st) && st.type !== 'connection' ? bar('Efficiency', st.efficiency, '#14a3a3') : ''}
      ${bar('Complexity', st.complexity, '#8e8e93', st.complexity.toFixed(2))}
    </div>
    <div class="facts">
      <div>Resource cost <b>${spec.cost} compute/s of work</b></div>
      <div>Compute spent <b>${Math.round(st.computeSpent)}</b></div>
      <div>Usage <b>${st.usage}</b></div>
      <div>Tested <b>${st.tested ? `yes, ${formatSimTime(st.lastTested)}` : 'not yet'}</b></div>
      <div>Known defects <b>${st.known}</b></div>
      <div>Awaiting verification <b>${st.pendingVerify}</b></div>
      <div>Hidden (latent) defects <b>${st.latent}</b></div>
      <div>Diagnosed <b>${st.diagnosed ? 'yes' : 'no'}</b></div>
    </div>
    <p class="muted-note">Latent defects are shown to you, not to the agents. They only learn of them by testing — or when one fails in production.</p>
    ${ends.length ? `<div class="sub">Connects</div><div class="chips small">${ends.map(chip).join('')}</div>` : ''}
    <div class="sub">Dependencies</div><div class="chips small">${deps.length ? deps.map(chip).join('') : '<span class="muted-note">none</span>'}</div>
    <div class="sub">Connected structures</div><div class="chips small">${links.length ? links.map(chip).join('') : '<span class="muted-note">isolated</span>'}</div>
    ${users.length ? `<div class="sub">Used by</div><div class="chips small">${users.map(chip).join('')}</div>` : ''}
    <div class="sub">Agents interacting now</div>
    <div class="chips small">${interacting.length ? interacting.map((a) => `<button class="chip" data-agent="${a.id}"><span class="dot" style="background:${ROLES[a.role].color}"></span>${esc(a.name)} <small>${esc(a.task.label)}</small></button>`).join('') : '<span class="muted-note">nobody</span>'}</div>
    <div class="sub">Built by</div><p class="muted-note">${contributors.length ? esc(contributors.join(' · ')) : '—'}</p>
    <h4>Recent modifications</h4>
    <ul class="hist">${st.history.slice().reverse().map((h) => `<li><span class="when">${formatSimTime(h.tick)}</span>${esc(h.text)}</li>`).join('')}</ul>
  `;
}

// ---------------------------------------------------------------------------
// Feed and lists
// ---------------------------------------------------------------------------

const KIND_COLOR = { build: '#0a84ff', complete: '#0a84ff', coop: '#34c759', compete: '#ff3b30', defect: '#ff3b30', incident: '#ff3b30', repair: '#34c759', verify: '#34c759', connect: '#af52de', reuse: '#5ac8fa', design: '#af52de', review: '#af52de', optimize: '#14a3a3', discover: '#ff9f0a', flag: '#ff9f0a', adapt: '#af52de', abandon: '#a2845e', test: '#28a745', fail: '#ff9f0a', info: '#8e8e93' };

function feedItem(e, fresh) {
  const data = e.agentId ? ` data-agent="${e.agentId}"` : e.structId ? ` data-struct="${e.structId}"` : '';
  return `<li class="${fresh ? 'fresh' : ''}"${data}><span class="when"><i class="kd" style="background:${KIND_COLOR[e.kind] || '#8e8e93'}"></i>${formatSimTime(e.tick)}</span>${esc(e.text)}</li>`;
}

function renderFeed() {
  const s = sim.state;
  const el = $('log');
  const key = `${s.seed}:${s.config}:${s.log[0]?.text}`;
  const seq = s.logSeq || 0;
  if (el._key !== key || seq < lastLogLength) {
    el.innerHTML = s.log.slice(-70).reverse().map((e) => feedItem(e, false)).join('');
    el._key = key;
  } else if (seq > lastLogLength) {
    // New events go on top; older lines stay where they are.
    const added = s.log.filter((e) => e.seq > lastLogLength).slice(-70);
    el.insertAdjacentHTML('afterbegin', added.reverse().map((e) => feedItem(e, true)).join(''));
    while (el.children.length > 70) el.lastElementChild.remove();
  }
  lastLogLength = seq;
}

function renderAgents() {
  const s = sim.state;
  const el = $('agents');
  const key = s.agents.map((a) => `${a.id}${a.strategy}`).join(',');
  if (el._key !== key) {
    el.innerHTML = s.agents.map((a) => `
      <li data-agent="${a.id}">
        <span class="dot" style="background:${ROLES[a.role].color}"></span>
        <span>${esc(a.name)} <i class="strat-dot ${a.strategy}" title="${a.strategy}"></i></span>
        <span class="act"></span>
      </li>`).join('');
    el._key = key;
  }
  // Update in place: the list items themselves never change while you tap them.
  s.agents.forEach((a, i) => {
    const li = el.children[i];
    li.classList.toggle('on', a.id === renderer.selectedAgentId);
    const text = a.task ? `${a.task.icon} ${a.task.label}` : a.phase === 'learn' ? '✳️ learning' : '💭 deciding';
    const act = li.querySelector('.act');
    if (act.textContent !== text) act.textContent = text;
  });
}

function renderStructures() {
  const s = sim.state;
  const live = s.structures.filter((o) => o.status !== 'abandoned' && o.type !== 'connection');
  const links = s.structures.filter((o) => o.type === 'connection' && o.status !== 'abandoned');
  setHTML($('structures'), live.length || links.length
    ? [...live, ...links].map((o) => `<button class="chip ${o.status}${o.id === renderer.selectedStructId ? ' on' : ''}${o.known ? ' bug' : ''}" data-struct="${o.id}">${esc(o.name)}${o.status === 'construction' ? ` <small>${Math.round(o.progress * 100)}%</small>` : ''}${o.known ? ' 🐞' : ''}</button>`).join('')
    : '<span class="muted-note">Nothing built yet.</span>');
}

function renderLegend() {
  const roles = ROLE_ORDER.map((r) => `<span><i class="dot" style="background:${ROLES[r].color}"></i>${r}</span>`).join('');
  const strats = ['cooperative', 'competitive', 'adaptive'].map((k) => `<span><i class="ring ${k}"></i>${k}</span>`).join('');
  const sigs = ['construction', 'failure', 'verification', 'integration', 'complexity', 'optimization', 'reuse'].map((k) => `<span><i class="dot ring-s" style="border-color:${SIGNALS[k].color}"></i>${SIGNALS[k].label.toLowerCase()}</span>`).join('');
  $('legend').innerHTML = `<div>${roles}</div><div>${strats}<span><i class="dash"></i>demand</span></div><div>${sigs}</div>`;
}

// ---------------------------------------------------------------------------
// Compare worlds: the same seed, three strategy mixes, ten simulated minutes each.
// ---------------------------------------------------------------------------

$('compare').addEventListener('click', () => {
  const card = $('compare-card');
  card.hidden = false;
  $('compare-out').innerHTML = '<p class="muted-note">Running three worlds…</p>';
  const runs = Object.keys(CONFIGS).map((k) => ({ key: k, sim: createAgentSim(seed, k) }));
  let i = 0;
  const chunk = () => {
    const until = Math.min(EXPERIMENT_TICKS, i + 200);
    for (const r of runs) for (let t = i; t < until; t++) step(r.sim);
    i = until;
    if (i < EXPERIMENT_TICKS) { $('compare-out').innerHTML = `<p class="muted-note">Running three worlds… ${Math.round((i / EXPERIMENT_TICKS) * 100)}%</p>`; setTimeout(chunk, 0); return; }
    const ms = runs.map((r) => ({ key: r.key, m: metrics(r.sim.state) }));
    const rows = [
      ['Structures completed', (m) => m.completed],
      ['Integrations', (m) => m.connections],
      ['Ecosystem reliability', (m) => pct(m.reliability)],
      ['Useful work (s)', (m) => m.usefulWork],
      ['Wasted work (s)', (m) => m.wastedWork],
      ['Compute spent', (m) => m.computeSpent],
      ['Compute left', (m) => m.compute],
      ['Cooperation events', (m) => m.cooperation],
      ['Competition events', (m) => m.competition],
      ['Defects found / in prod', (m) => `${m.defectsFound} / ${m.defectsSurfaced}`],
      ['Defects repaired', (m) => m.defectsRepaired],
      ['Reused capabilities', (m) => m.reuses],
    ];
    $('compare-out').innerHTML = `<table class="cmp"><tr><th>Seed ${seed}</th>${ms.map((x) => `<th>${CONFIGS[x.key].label.replace(' World', '')}</th>`).join('')}</tr>${rows.map(([label, f]) => `<tr><td>${label}</td>${ms.map((x) => `<td>${f(x.m)}</td>`).join('')}</tr>`).join('')}</table><p class="muted-note">Each column is a full, independent run of the same seed. Nothing is scripted; change the seed to see how much is luck.</p>`;
  };
  setTimeout(chunk, 0);
});

// ---------------------------------------------------------------------------

loadPrefs();
for (const b of document.querySelectorAll('#speeds button')) b.classList.toggle('on', Number(b.dataset.speed) === clock.speed);
showSound();
renderLegend();
newExperiment();
requestAnimationFrame(frame);

window.agentWorld = { get sim() { return sim; }, clock, renderer, ambience, select, TICK_SECONDS, ACTIONS };
