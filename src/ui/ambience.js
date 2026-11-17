// Ambient soundtrack: ocean waves and soft generative piano, synthesized live with Web Audio.
// No audio files, no network, nothing to license. Composition rules live in score.js.
import { BAR_SECONDS, pianoBar, ambienceMix, midiToHz } from './score.js';

const LOOKAHEAD = 1.5; // seconds of audio scheduled ahead of the playhead
const SEAM = 0.25; // crossfaded loop seam, seconds
const FADE = 1.6; // time constant for layer fades, seconds

export function createAmbience() {
  const amb = {
    ctx: null, mode: 'both', paused: false, night: false, volume: 0.7,
    bus: {}, nextBar: 0, bar: 0, nextWave: 0, timer: null,
  };
  return amb;
}

// Must be called from a user gesture (browser autoplay rules).
// An OfflineAudioContext may be passed to render a preview of the soundtrack.
export function startAmbience(amb, offline = null) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx && !offline) return false;
  if (amb.ctx) { amb.ctx.resume(); return true; }
  const ctx = offline || new Ctx();
  amb.ctx = ctx;

  const master = ctx.createGain();
  master.gain.value = amb.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);

  amb.bus.waves = ctx.createGain(); amb.bus.waves.gain.value = 0;
  amb.bus.piano = ctx.createGain(); amb.bus.piano.gain.value = 0;
  amb.bus.waves.connect(master);

  // Piano: warm low-pass, dry signal plus a long, soft room.
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass'; tone.frequency.value = 2600; tone.Q.value = 0.3;
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 3.8, 2.6);
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  amb.bus.piano.connect(tone);
  tone.connect(master);
  tone.connect(reverb).connect(wet).connect(master);

  buildSea(amb);
  amb.nextBar = ctx.currentTime + 0.6;
  amb.nextWave = ctx.currentTime + 0.1;
  applyMix(amb);
  if (offline) { schedule(amb, offline.length / offline.sampleRate); return true; }
  amb.timer = setInterval(() => schedule(amb), 250);
  ctx.resume();
  return true;
}

export function setAmbienceMode(amb, mode) {
  amb.mode = mode;
  if (amb.ctx) applyMix(amb);
}

export function updateAmbience(amb, { paused, night }) {
  if (paused === amb.paused && night === amb.night) return;
  amb.paused = paused; amb.night = night;
  if (amb.ctx) applyMix(amb);
}

function applyMix(amb) {
  const { waves, piano } = ambienceMix(amb);
  const now = amb.ctx.currentTime;
  amb.bus.waves.gain.setTargetAtTime(waves, now, FADE);
  amb.bus.piano.gain.setTargetAtTime(piano * 0.9, now, FADE * 0.6);
}

// ---------------------------------------------------------------------------
// The sea: a constant low rumble, plus swells that build, crest, and wash out.
// ---------------------------------------------------------------------------

function buildSea(amb) {
  const { ctx } = amb;
  const noise = brownNoise(ctx, 8);
  const hiss = whiteNoise(ctx, 5);

  const bedSrc = loop(ctx, noise, 0);
  const bedLp = ctx.createBiquadFilter(); bedLp.type = 'lowpass'; bedLp.frequency.value = 320;
  const bedGain = ctx.createGain(); bedGain.gain.value = 0.32;
  bedSrc.connect(bedLp).connect(bedGain).connect(amb.bus.waves);

  const swellSrc = loop(ctx, noise, 3.1);
  const swellLp = ctx.createBiquadFilter(); swellLp.type = 'lowpass'; swellLp.frequency.value = 300; swellLp.Q.value = 0.6;
  const swellGain = ctx.createGain(); swellGain.gain.value = 0.05;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  swellSrc.connect(swellLp).connect(swellGain);
  if (pan) swellGain.connect(pan).connect(amb.bus.waves); else swellGain.connect(amb.bus.waves);

  const foamSrc = loop(ctx, hiss, 1.7);
  const foamHp = ctx.createBiquadFilter(); foamHp.type = 'highpass'; foamHp.frequency.value = 2200;
  const foamLp = ctx.createBiquadFilter(); foamLp.type = 'lowpass'; foamLp.frequency.value = 7000;
  const foamGain = ctx.createGain(); foamGain.gain.value = 0.0001;
  foamSrc.connect(foamHp).connect(foamLp).connect(foamGain);
  if (pan) foamGain.connect(pan); else foamGain.connect(amb.bus.waves);

  amb.sea = { swellLp, swellGain, foamGain, pan };
}

function scheduleWave(amb, t) {
  const { swellLp, swellGain, foamGain, pan } = amb.sea;
  const period = 7 + Math.random() * 5;
  const rise = period * (0.38 + Math.random() * 0.12);
  const crest = t + rise;
  const size = 0.65 + Math.random() * 0.35;
  swellGain.gain.setValueAtTime(0.06, t);
  swellGain.gain.linearRampToValueAtTime(0.95 * size, crest);
  swellGain.gain.exponentialRampToValueAtTime(0.06, t + period);
  swellLp.frequency.setValueAtTime(260, t);
  swellLp.frequency.exponentialRampToValueAtTime(900 + 900 * size, crest);
  swellLp.frequency.exponentialRampToValueAtTime(260, t + period);
  foamGain.gain.setValueAtTime(0.0001, crest - 0.3);
  foamGain.gain.linearRampToValueAtTime(0.16 * size, crest + 0.35);
  foamGain.gain.exponentialRampToValueAtTime(0.0001, crest + 3.6);
  if (pan) pan.pan.setTargetAtTime((Math.random() - 0.5) * 0.7, t, period / 3);
  return t + period;
}

// ---------------------------------------------------------------------------
// The piano: each note is a few slightly stretched partials with a soft strike.
// ---------------------------------------------------------------------------

const PARTIALS = [[1, 1], [2, 0.42], [3, 0.2], [4, 0.1], [5, 0.05]];

function playNote(amb, when, midi, vel, dur) {
  const { ctx } = amb;
  const f0 = midiToHz(midi);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(vel * 0.32, when + 0.008);
  const decay = Math.max(0.5, (dur / 3) * (midi < 50 ? 1.4 : 1));
  env.gain.setTargetAtTime(0, when + 0.008, decay);
  env.connect(amb.bus.piano);
  const stop = when + dur * 2.2 + 0.5;
  for (const [k, a] of PARTIALS) {
    const freq = f0 * k * (1 + 0.0004 * k * k);
    if (freq > 9000) break;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = a;
    osc.connect(g).connect(env);
    osc.start(when);
    osc.stop(stop);
  }
}

function schedule(amb, lookahead = LOOKAHEAD) {
  const { ctx } = amb;
  if (!ctx || (ctx.state !== 'running' && lookahead === LOOKAHEAD)) return;
  const now = ctx.currentTime;
  // After a throttled background tab, don't try to catch up on missed bars.
  if (amb.nextBar < now - 1) amb.nextBar = now + 0.2;
  if (amb.nextWave < now - 1) amb.nextWave = now + 0.2;
  const { waves, piano } = ambienceMix(amb);
  while (amb.nextWave < now + lookahead) {
    amb.nextWave = waves > 0 ? scheduleWave(amb, amb.nextWave) : amb.nextWave + 2;
  }
  while (amb.nextBar < now + lookahead) {
    if (piano > 0) {
      for (const n of pianoBar(amb.bar)) playNote(amb, amb.nextBar + Math.max(0, n.t), n.midi, n.vel, n.dur);
    }
    amb.bar++;
    amb.nextBar += BAR_SECONDS;
  }
}

// ---------------------------------------------------------------------------
// Buffers
// ---------------------------------------------------------------------------

function loop(ctx, buffer, offset) {
  const src = ctx.createBufferSource();
  src.buffer = buffer; src.loop = true;
  src.loopStart = 0; src.loopEnd = buffer.duration - SEAM;
  src.start(0, offset % buffer.duration);
  return src;
}

function brownNoise(ctx, seconds) {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    crossfadeEnds(d, ctx.sampleRate);
  }
  return buf;
}

function whiteNoise(ctx, seconds) {
  const buf = ctx.createBuffer(2, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return buf;
}

// Blend the tail into the head; looping stops SEAM seconds before the end, so playback
// wraps from the sample just before the tail to a head that begins as that tail — no click.
function crossfadeEnds(d, rate) {
  const n = Math.floor(rate * SEAM);
  for (let i = 0; i < n; i++) {
    const a = i / n;
    d[i] = d[i] * a + d[d.length - n + i] * (1 - a);
  }
}

function impulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
  }
  return buf;
}
