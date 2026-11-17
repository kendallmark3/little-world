// End-to-end check of the world chooser and Agent World in a real browser (needs Playwright + Chrome).
// Usage: node scripts/agent-world-check.mjs [outDir] [soakSeconds]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2] || 'tmp/agent-world';
const soakSeconds = Number(process.argv[3] || 20);
mkdirSync(out, { recursive: true });
const port = 5198;
const server = spawn(process.execPath, ['scripts/serve.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };
const browser = await chromium.launch({ channel: 'chrome', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  // Chooser → Little World still works on its own page.
  await page.goto(`http://localhost:${port}/`);
  check('chooser offers both worlds', (await page.textContent('body')).includes('Little World') && (await page.textContent('body')).includes('Agent World'));
  await page.click('#go-little');
  await page.waitForTimeout(1200);
  check('Little World opens from the chooser', await page.evaluate(() => window.littleWorld?.sim.state.people.length === 10 || window.littleWorld?.sim.state.people.length > 0));
  await page.goto(`http://localhost:${port}/?seed=42`);
  await page.click('#go-agent');
  await page.waitForTimeout(1000);
  check('Agent World opens from the chooser with the seed carried through', await page.evaluate(() => window.agentWorld?.sim.state.seed === 42));
  await page.evaluate(() => localStorage.clear());
  await page.goto(`http://localhost:${port}/agent-world.html?seed=42&config=mixed`);
  await page.waitForTimeout(800);
  const t0 = await page.evaluate(() => window.agentWorld.sim.state.tick);
  await page.waitForTimeout(600);
  check('waits for Start', t0 === 0 && (await page.evaluate(() => window.agentWorld.sim.state.tick)) === 0);
  check('ten agents populate the world', (await page.evaluate(() => window.agentWorld.sim.state.agents.length)) === 10);

  await page.click('#play');
  check('sound starts with the first tap and the button says so', (await page.evaluate(() => window.agentWorld.ambience.ctx?.state)) === 'running' && (await page.textContent('#sound')).includes('Sound on'));
  await page.click('#sound');
  const off = await page.evaluate(() => window.agentWorld.ambience.mode);
  check('one tap turns sound off', off === 'off' && (await page.textContent('#sound')).includes('Sound off'));
  await page.click('#sound');
  check('another tap turns it back on', (await page.evaluate(() => window.agentWorld.ambience.mode)) !== 'off' && (await page.textContent('#sound')).includes('Sound on'));
  await page.click('#speeds button[data-speed="1"]');
  const a0 = await page.evaluate(() => window.agentWorld.sim.state.tick);
  await page.waitForTimeout(2000);
  const a1 = await page.evaluate(() => window.agentWorld.sim.state.tick);
  check('1x runs in real time (2 ticks per second)', a1 - a0 >= 3 && a1 - a0 <= 6, `${a1 - a0} ticks in 2s`);
  await page.click('#speeds button[data-speed="30"]');
  await page.waitForTimeout(4000);
  const moved = await page.evaluate(() => window.agentWorld.sim.state.agents.filter((a) => Math.hypot(a.x - 14, a.y - 20) > 3).length);
  check('agents leave the Hub toward objectives', moved >= 5, `${moved} agents away from the Hub`);
  await page.screenshot({ path: `${out}/01-early.png` });

  // Pause
  await page.click('#play');
  const p0 = await page.evaluate(() => window.agentWorld.sim.state.tick);
  await page.waitForTimeout(800);
  check('pause stops simulation time', p0 === (await page.evaluate(() => window.agentWorld.sim.state.tick)));
  await page.click('#play');

  // Soak to past ten simulated minutes at 30x and measure frame rate.
  const fps = await page.evaluate((sec) => new Promise((res) => {
    let n = 0; const t = performance.now();
    const f = () => { n++; if (performance.now() - t < sec * 1000) requestAnimationFrame(f); else res(n / sec); };
    requestAnimationFrame(f);
  }), soakSeconds);
  const tick = await page.evaluate(() => window.agentWorld.sim.state.tick);
  check(`stays responsive at 30x (${soakSeconds}s)`, fps > 20, `${fps.toFixed(0)} fps, sim at ${Math.floor(tick / 120)}:${String(Math.floor(tick / 2) % 60).padStart(2, '0')}`);
  await page.waitForFunction(() => window.agentWorld.sim.state.tick >= 1200, null, { timeout: 60000 }).catch(() => {});
  await page.click('#speeds button[data-speed="1"]');

  // Inspect an Architect.
  await page.click('#agents li:has-text("Architect-001")');
  await page.waitForTimeout(700);
  const insp = await page.textContent('#inspector');
  check('agent inspector shows identity, perception, scored decision and reason', /Architect-001/.test(insp) && /Perception/.test(insp) && /Environmental signals/.test(insp) && /Decision/.test(insp) && /Why:/.test(insp), insp.slice(0, 120));
  await page.screenshot({ path: `${out}/02-architect.png` });
  const inspEl = await page.$('#inspector');
  await inspEl.screenshot({ path: `${out}/02b-architect-inspector.png` });

  // Inspect a structure from the list.
  const first = page.locator('#structures .chip.complete').first();
  if (await first.count()) {
    await first.click();
    await page.waitForTimeout(500);
    const st = await page.textContent('#inspector');
    check('structure inspector shows real state', /Reliability/.test(st) && /Dependencies/.test(st) && /Recent modifications/.test(st));
    await (await page.$('#inspector')).screenshot({ path: `${out}/03-structure.png` });
  } else check('structure inspector shows real state', false, 'no completed structure');

  const feed = await page.$$eval('#log li', (li) => li.length);
  check('activity feed lists real events', feed > 10, `${feed} events`);
  const m = await page.evaluate(() => { const s = window.agentWorld.sim.state; return { done: s.structures.filter((x) => x.status === 'complete').length, decisions: s.counters.decisions }; });
  check('the ecosystem grew', m.done >= 8, JSON.stringify(m));

  // Determinism through the UI: Reset with the same seed reproduces the same history.
  const runTo = async (tick) => {
    await page.fill('#seed', '42');
    await page.click('#reset');
    await page.click('#play');
    await page.click('#speeds button[data-speed="30"]');
    await page.waitForFunction((t) => window.agentWorld.sim.state.tick >= t, tick);
    await page.click('#play');
    return page.evaluate((t) => window.agentWorld.sim.state.log.filter((e) => e.tick <= t).map((e) => `${e.tick} ${e.text}`), tick);
  };
  const h1 = await runTo(400);
  const h2 = await runTo(400);
  check('Reset with the same seed reproduces the same history', h1.length > 5 && JSON.stringify(h1) === JSON.stringify(h2), `${h1.length} events`);

  // Compare worlds
  await page.click('#compare');
  await page.waitForSelector('table.cmp', { timeout: 30000 });
  const cmp = await page.textContent('#compare-out');
  check('compare runs all three worlds', /Mixed/.test(cmp) && /Cooperative/.test(cmp) && /Competitive/.test(cmp));
  await (await page.$('#compare-card')).screenshot({ path: `${out}/04-compare.png` });

  // Mobile
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  mobile.on('pageerror', (e) => errors.push(e.message));
  await mobile.goto(`http://localhost:${port}/agent-world.html?seed=42`);
  await mobile.tap('#play');
  await mobile.tap('#speeds button[data-speed="30"]');
  await mobile.waitForTimeout(6000);
  await mobile.screenshot({ path: `${out}/05-mobile.png` });
  await mobile.goto(`http://localhost:${port}/`);
  await mobile.screenshot({ path: `${out}/06-chooser-mobile.png`, fullPage: true });

  check('no console or page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.kill();
}
const failed = results.filter((r) => !r.ok).length;
console.log(failed ? `${failed} check(s) failed` : 'all Agent World browser checks passed');
process.exit(failed ? 1 : 0);
