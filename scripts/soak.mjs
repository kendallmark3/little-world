// Runs the simulation headless for N days and prints the chronicle and daily stats.
import { createSim, run, stats } from '../src/sim/sim.js';
const days = Number(process.argv[2] || 10);
const seed = Number(process.argv[3] || 42);
const sim = createSim(seed);
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  run(sim, 1440);
  const s = stats(sim);
  console.log(`day ${s.day} ${s.time} pop=${s.population} food=${s.food} wood=${s.wood} housing=${s.housed}/${s.housing} happy=${s.happiness} trees=${s.trees} doctor=${s.doctorPurse}`);
}
console.log(`ran ${days} days in ${(performance.now() - t0).toFixed(0)}ms`);
if (process.argv.includes('--log')) for (const e of sim.state.log) console.log(`  Day ${e.day} ${e.time}  ${e.text}`);
