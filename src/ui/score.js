// The ambient score: pure, deterministic composition rules for the soundtrack.
// No Web Audio here — ambience.js turns these notes and levels into sound.
// Music runs in real time, independent of simulation speed (like rendering time).

export const MODES = ['both', 'waves', 'piano', 'off'];
export const MODE_LABELS = { both: 'Waves + piano', waves: 'Waves', piano: 'Piano', off: 'Sound off' };

export function nextMode(mode) {
  const i = MODES.indexOf(mode);
  return MODES[(i + 1) % MODES.length];
}

export const BAR_SECONDS = 4.8; // slow and unhurried (~50 bpm in 4/4)

// A gentle, unresolved loop in C major: Cmaj9 – Am9 – Fmaj7#11 – G6sus.
// Tones are MIDI note numbers; bass is the low root.
export const PROGRESSION = [
  { name: 'Cmaj9', bass: 36, tones: [60, 64, 67, 71, 74] },
  { name: 'Am9', bass: 45, tones: [57, 60, 64, 67, 71] },
  { name: 'Fmaj7#11', bass: 41, tones: [57, 60, 64, 65, 71] },
  { name: 'G6sus', bass: 43, tones: [62, 64, 67, 72, 74] },
];

// Every pitch the piano may play (C major scale).
export const SCALE = new Set([0, 2, 4, 5, 7, 9, 11]);

export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Notes for one bar: [{ t (seconds from bar start), midi, vel (0..1), dur (seconds) }].
// Same bar index always yields the same phrase.
export function pianoBar(barIndex, seed = 7) {
  const rnd = mulberry32(seed * 100003 + barIndex);
  const chord = PROGRESSION[barIndex % PROGRESSION.length];
  const notes = [];
  // Low root, sometimes doubled by its fifth.
  notes.push({ t: 0, midi: chord.bass, vel: 0.42, dur: BAR_SECONDS * 1.4 });
  if (rnd() < 0.5) notes.push({ t: 0.05, midi: chord.bass + 7, vel: 0.26, dur: BAR_SECONDS * 1.2 });
  // A sparse, rolled arpeggio over eight slots, with a little rubato. Some bars rest more.
  const density = rnd() < 0.25 ? 0.25 : 0.5;
  const slot = BAR_SECONDS / 8;
  let last = -1;
  for (let i = 1; i < 8; i++) {
    if (rnd() > density) continue;
    let idx = Math.floor(rnd() * chord.tones.length);
    if (idx === last) idx = (idx + 1) % chord.tones.length;
    last = idx;
    const lift = rnd() < 0.2 ? 12 : 0; // occasional high, bell-like note
    notes.push({
      t: i * slot + (rnd() - 0.5) * 0.08,
      midi: chord.tones[idx] + lift,
      vel: 0.18 + rnd() * 0.16,
      dur: 2.5 + rnd() * 2,
    });
  }
  return notes;
}

// Target levels for each layer given what the world is doing.
// The piano plays while the world is running and rests when it is paused;
// nights are hushed piano with a little more sea.
export function ambienceMix({ mode, paused = false, night = false }) {
  const wavesOn = mode === 'both' || mode === 'waves';
  const pianoOn = mode === 'both' || mode === 'piano';
  return {
    waves: wavesOn ? (paused ? 0.35 : night ? 0.85 : 0.7) : 0,
    piano: pianoOn && !paused ? (night ? 0.55 : 0.8) : 0,
  };
}
