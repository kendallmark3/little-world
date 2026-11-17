import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODES, nextMode, pianoBar, ambienceMix, PROGRESSION, SCALE, BAR_SECONDS, midiToHz } from '../src/ui/score.js';

test('sound modes cycle through every option and wrap', () => {
  let m = 'both';
  const seen = [];
  for (let i = 0; i < MODES.length; i++) { seen.push(m); m = nextMode(m); }
  assert.deepEqual(seen, MODES);
  assert.equal(m, 'both');
});

test('piano phrases are deterministic per bar', () => {
  assert.deepEqual(pianoBar(5), pianoBar(5));
  assert.notDeepEqual(pianoBar(5), pianoBar(9));
});

test('piano stays in key, in a gentle range, inside its bar, and soft', () => {
  for (let bar = 0; bar < 200; bar++) {
    const notes = pianoBar(bar);
    assert.ok(notes.length >= 1);
    assert.equal(notes[0].midi, PROGRESSION[bar % PROGRESSION.length].bass, 'each bar opens on its root');
    for (const n of notes) {
      assert.ok(SCALE.has(n.midi % 12), `note ${n.midi} is in C major`);
      assert.ok(n.midi >= 36 && n.midi <= 88, `note ${n.midi} in range`);
      assert.ok(n.t >= 0 && n.t < BAR_SECONDS, 'note starts within its bar');
      assert.ok(n.vel > 0 && n.vel <= 0.5, 'quiet touch');
    }
  }
});

test('piano plays while the world runs and rests when it is paused', () => {
  assert.ok(ambienceMix({ mode: 'both' }).piano > 0);
  assert.equal(ambienceMix({ mode: 'both', paused: true }).piano, 0);
  assert.ok(ambienceMix({ mode: 'both', paused: true }).waves > 0, 'the sea keeps breathing when paused');
});

test('nights are hushed piano with a little more sea', () => {
  const day = ambienceMix({ mode: 'both' });
  const night = ambienceMix({ mode: 'both', night: true });
  assert.ok(night.piano < day.piano);
  assert.ok(night.waves > day.waves);
});

test('modes select their layers; off is silent', () => {
  assert.equal(ambienceMix({ mode: 'waves' }).piano, 0);
  assert.equal(ambienceMix({ mode: 'piano' }).waves, 0);
  assert.deepEqual(ambienceMix({ mode: 'off' }), { waves: 0, piano: 0 });
});

test('A4 is 440 Hz', () => {
  assert.equal(midiToHz(69), 440);
  assert.equal(Math.round(midiToHz(60)), 262);
});
