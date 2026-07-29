// climate.test.js — the clock. Run: node test/climate.test.js
// Pins the two bugs that actually mattered: lostAtT must agree with tempAt, the
// lethal edge must advance at exactly DAWN_V, and nothing may be lethal before t=0.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, tempAt, lostAtT, LETHAL, K, DAWN_V, DAWN0 } from "../src/world/climate.js";
import { applyWorldScale } from "../src/world/scale.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
applyWorldScale(config);   // measure the world as it ships
initClimate(config.climate);

let failures = 0;
const EPS = 1e-6;
function ok(name, cond, detail = "") { if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name); }
function near(a, b, eps = EPS) { return Math.abs(a - b) <= eps; }

const SIZE = config.world.size;

// 1. lostAtT agrees with tempAt: at t = lostAtT(x), x is exactly at the lethal temperature.
for (const x of [-1700, -1300, -1000, -620, 0, 150, 430, 1200]) {
  const t = lostAtT(x);
  ok(`tempAt(x=${x}, lostAtT(x)) == LETHAL`, near(tempAt(x, t), LETHAL, 1e-4), `got ${tempAt(x, t)}`);
}

// 2. The lethal edge moves at exactly DAWN_V m/s: a point DAWN_V metres east is lost
//    exactly one second later, so the edge advances DAWN_V metres per second.
for (const x of [-1500, -800, 0, 600]) {
  ok(`lost-edge speed at x=${x} is DAWN_V`, near(lostAtT(x + DAWN_V) - lostAtT(x), 1));
}
// And directly: dawnX advances at DAWN_V.
ok("dawnX advances at DAWN_V", near(dawnX(100) - dawnX(0), 100 * DAWN_V));
ok("dawnX(0) == DAWN0", near(dawnX(0), DAWN0));

// 3. Nothing becomes lethal before t=0: across the whole map, no in-bounds ground
//    is already lethal at t=0, i.e. every x is lost strictly after the start.
let minLost = Infinity, hotAtStart = 0;
for (let x = -SIZE / 2; x <= SIZE / 2; x += 5) {
  if (tempAt(x, 0) > LETHAL + EPS) hotAtStart++;
  minLost = Math.min(minLost, lostAtT(x));
}
ok("nothing in-bounds is lethal at t=0", hotAtStart === 0, `${hotAtStart} hot cells`);
ok("earliest in-bounds loss is after t=0", minLost >= 0, `minLost=${minLost.toFixed(1)}s`);

// tempAt is clamped to the configured envelope.
ok("tempAt never exceeds maxTemp", tempAt(-1e6, 0) <= config.climate.maxTemp + EPS);
ok("tempAt never drops below minTemp", tempAt(1e6, 0) >= config.climate.minTemp - EPS);

if (failures) { console.error(`\nclimate.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nclimate.test.js: all passed");
