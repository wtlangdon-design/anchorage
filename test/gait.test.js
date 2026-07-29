// gait.test.js — the walk cycle. Run: node test/gait.test.js
// A rigid limb reads as a robot; this is the test that prevents regressing to it.
// Knees only ever flex forward (>= 0). Elbows always hold at least the base bend.
// Every angle stays bounded at every speed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initGait, poseFor } from "../src/player/gait.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
initGait(config.gait);

let failures = 0;
function fail(msg) { failures++; console.error("  FAIL:", msg); }

const base = config.gait.elbowBaseBend; // 0.30 rad
const BOUND = 3; // no joint should ever swing past this many radians
let checked = 0;

// Sweep every speed from standing to well past sprint, across a full phase cycle,
// in both walk and run states.
for (let speed = 0; speed <= 12; speed += 0.25) {
  const running = speed > config.gait.runThreshold;
  for (let phase = 0; phase < Math.PI * 2; phase += Math.PI / 32) {
    const p = poseFor(phase, speed, running);
    checked++;

    // knees never hyperextend
    if (!(p.kneeL >= 0)) fail(`kneeL < 0 at speed=${speed} phase=${phase.toFixed(2)} (${p.kneeL})`);
    if (!(p.kneeR >= 0)) fail(`kneeR < 0 at speed=${speed} phase=${phase.toFixed(2)} (${p.kneeR})`);

    // elbows always keep at least the base bend
    if (!(Math.abs(p.elbowL) >= base - 1e-9)) fail(`elbowL under base bend at speed=${speed} (${p.elbowL})`);
    if (!(Math.abs(p.elbowR) >= base - 1e-9)) fail(`elbowR under base bend at speed=${speed} (${p.elbowR})`);

    // every angle finite and bounded
    for (const [k, v] of Object.entries(p)) {
      if (!Number.isFinite(v)) fail(`${k} not finite at speed=${speed} phase=${phase.toFixed(2)}`);
      if (Math.abs(v) > BOUND) fail(`${k} out of bounds (${v}) at speed=${speed} phase=${phase.toFixed(2)}`);
    }
    if (failures > 4) break;
  }
  if (failures > 4) break;
}

// Standing still produces a still pose (k = 0 -> everything zero except the fixed elbow bend).
const still = poseFor(1.0, 0, false);
if (!(still.thighL === 0 && still.kneeL === 0 && still.torsoLift === 0)) fail("standing pose is not still");
if (!(Math.abs(still.elbowL) === base)) fail(`standing elbow is not exactly the base bend (${still.elbowL})`);

if (failures) { console.error(`\ngait.test.js: ${failures} failure(s) over ${checked} poses`); process.exit(1); }
console.log(`gait.test.js: all passed (${checked} poses checked)`);
