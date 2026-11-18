// The world chooser (index.html) must only reference images that exist and that get deployed.
// Deployed paths are the root *.html/*.css, src/ and assets/; docs/ is never shipped.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const images = [...html.matchAll(/<img[^>]*\ssrc="([^"]+)"[^>]*>/g)].map((m) => ({ tag: m[0], src: m[1] }));

test('chooser shows one image per world', () => {
  assert.equal(images.length, 2);
});

test('chooser images exist and live in the deployed assets/ folder', () => {
  for (const { src } of images) {
    assert.match(src, /^assets\//, `${src} is outside assets/, so it would not be deployed`);
    assert.ok(existsSync(new URL(`../${src}`, import.meta.url)), `${src} is missing`);
  }
});

test('chooser images have alt text', () => {
  for (const { tag, src } of images) assert.match(tag, /\salt="[^"]+"/, `${src} has no alt text`);
});

test('chooser SVGs are self-contained, with a 3:2 viewBox matching the card', () => {
  for (const { src } of images.filter((i) => i.src.endsWith('.svg'))) {
    const svg = readFileSync(new URL(`../${src}`, import.meta.url), 'utf8');
    assert.match(svg, /^<svg[^>]*viewBox="0 0 600 400"/, `${src} should be a 600x400 SVG`);
    assert.match(svg, /<\/svg>\s*$/, `${src} is truncated`);
    const external = [...svg.matchAll(/(?:href|src)="(?!#)([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(external, [], `${src} loads external resources`);
  }
});
