// End-to-end smoke check in a real browser (optional; needs Playwright + Chrome installed).
// Usage: node scripts/browser-check.mjs [outDir] [soakSeconds]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'tmp/screens';
const soakSeconds = Number(process.argv[3] || 20);
mkdirSync(out, { recursive: true });
const port = 5199;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`http://localhost:${port}/?fresh&seed=42`);
  await page.waitForTimeout(1500);
  const t0 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  await page.waitForTimeout(2000);
  const t1 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  check('simulation time advances at 1x (~24 min/s)', t1 - t0 >= 35 && t1 - t0 <= 60, `${t1 - t0} ticks in 2s`);
  const people = await page.evaluate(() => window.littleWorld.sim.state.people.length);
  check('ten inhabitants on screen', people === 10, String(people));
  await page.screenshot({ path: `${out}/01-morning.png` });

  // Inspect Jenny via the inhabitants list
  await page.click('#people li:has-text("Jenny")');
  await page.waitForTimeout(400);
  const inspector = await page.textContent('#inspector');
  check('inspector shows Jenny with activity and reason', /Jenny/.test(inspector) && /Why:/.test(inspector) && /Farmer/.test(inspector));

  // Pause
  await page.click('#play');
  const p0 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  await page.waitForTimeout(1000);
  const p1 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  check('pause stops simulation time', p0 === p1);
  await page.click('#play');

  // Speed up
  await page.click('#speeds button[data-speed="10"]');
  const s0 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  await page.waitForTimeout(1000);
  const s1 = await page.evaluate(() => window.littleWorld.sim.state.tick);
  check('10x speed advances ~240 min/s', s1 - s0 > 150, `${s1 - s0} ticks in 1s`);

  // Add food
  const f0 = await page.evaluate(() => window.littleWorld.sim.state.food);
  await page.click('#food');
  const f1 = await page.evaluate(() => window.littleWorld.sim.state.food);
  check('Add food increases the granary by 20 (plus or minus a meal)', f1 - f0 >= 18, `${f0} → ${f1}`);

  // Plant a tree by clicking the canvas
  await page.click('#tools button[data-tool="tree"]');
  const spot = await page.evaluate(() => {
    const s = window.littleWorld.sim.state;
    for (let y = 3; y < s.h - 3; y++) for (let x = 3; x < 26; x++) {
      const t = s.tiles[y * s.w + x];
      if (t === 0 && !s.trees.some((o) => o.x === x && o.y === y) && !s.bushes.some((o) => o.x === x && o.y === y)
        && !s.fields.some((f) => x >= f.x && x <= f.x + 1 && y >= f.y && y <= f.y + 1)
        && !s.buildings.some((b) => Math.abs(b.x - x) <= 1 && Math.abs(b.y - y) <= 1)) return { x, y };
    }
    return null;
  });
  const box = await page.locator('#world').boundingBox();
  const before = await page.evaluate(() => window.littleWorld.sim.state.trees.length);
  await page.mouse.click(box.x + ((spot.x + 0.5) / 48) * box.width, box.y + ((spot.y + 0.5) / 32) * box.height);
  const after = await page.evaluate(() => window.littleWorld.sim.state.trees.length);
  check('clicking the world with Plant tree adds a sapling', after === before + 1);
  await page.click('#tools button[data-tool="inspect"]');

  // Run to evening and night for screenshots
  await page.click('#speeds button[data-speed="30"]');
  await page.waitForFunction(() => { const m = window.littleWorld.sim.state.tick % 1440; return m > 19 * 60 && m < 19 * 60 + 60; }, null, { timeout: 60000 });
  await page.click('#speeds button[data-speed="1"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/02-evening.png` });
  await page.click('#speeds button[data-speed="30"]');
  await page.waitForFunction(() => { const m = window.littleWorld.sim.state.tick % 1440; return m > 22 * 60 + 30 && m < 23 * 60 + 30; }, null, { timeout: 60000 });
  await page.click('#speeds button[data-speed="1"]');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/03-night.png` });

  // Soak at 30x and watch frame rate
  await page.click('#speeds button[data-speed="30"]');
  const fps = await page.evaluate((secs) => new Promise((resolve) => {
    let frames = 0; const start = performance.now();
    function f(now) { frames++; if (now - start < secs * 1000) requestAnimationFrame(f); else resolve(frames / secs); }
    requestAnimationFrame(f);
  }), soakSeconds);
  const day = await page.evaluate(() => Math.floor(window.littleWorld.sim.state.tick / 1440) + 1);
  check(`stays responsive during a ${soakSeconds}s soak at 30x`, fps > 20, `${fps.toFixed(0)} fps, reached day ${day}`);
  await page.click('#speeds button[data-speed="1"]');
  await page.waitForFunction(() => { const m = window.littleWorld.sim.state.tick % 1440; return m > 10 * 60 && m < 16 * 60; }, null, { timeout: 60000 }).catch(() => {});
  await page.click('#people li:has-text("Rook")');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/04-later.png` });

  // Save and reload
  const saved = await page.evaluate(() => { window.littleWorld.save(); const s = window.littleWorld.sim.state; return { tick: s.tick, pop: s.people.length, seed: s.seed }; });
  await page.goto(`http://localhost:${port}/`);
  await page.waitForTimeout(800);
  const restored = await page.evaluate(() => { const s = window.littleWorld.sim.state; return { tick: s.tick, pop: s.people.length, seed: s.seed }; });
  check('reload restores the same civilization', restored.seed === saved.seed && restored.tick >= saved.tick && restored.tick - saved.tick < 200 && restored.pop === saved.pop, `${JSON.stringify(saved)} → ${JSON.stringify(restored)}`);

  // Mobile layout
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(`http://localhost:${port}/?fresh&seed=42`);
  await mobile.waitForTimeout(2500);
  await mobile.screenshot({ path: `${out}/05-mobile.png` });

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed` : 'all browser checks passed');
process.exit(failed ? 1 : 0);
