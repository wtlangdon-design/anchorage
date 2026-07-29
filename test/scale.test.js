// scale.test.js — world.scale. Run: node test/scale.test.js
//
// The whole point of world.scale is that it is safe to retune from config.json
// without touching code, so this pins the two things that would make it unsafe:
// that scale 1 is a true no-op, and that scaling is uniform enough that the clock
// does not move underneath the player.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { applyWorldScale, SCALED_PATHS, INVERSE_PATHS } from "../src/world/scale.js";
import { initClimate, dawnX, tempAt, lostAtT, LETHAL } from "../src/world/climate.js";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = readFileSync(join(here, "../content/config.json"), "utf8");
const load = () => JSON.parse(RAW);

let failures = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name); };
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// 1. scale 1 must reproduce the original build exactly.
{
  const a = load(); a.world.scale = 1; applyWorldScale(a);
  const b = load(); delete b.world.scale; // compare against a config that never had it
  const aa = load(); aa.world.scale = 1; applyWorldScale(aa); delete aa.world.scale;
  ok("scale 1 is a byte-exact no-op", JSON.stringify(aa) === JSON.stringify(b));
}
// A missing or nonsense scale must also leave everything alone.
for (const bad of [undefined, 0, -1, NaN, "0.5"]) {
  const a = load(); a.world.scale = bad; applyWorldScale(a); delete a.world.scale;
  const b = load(); delete b.world.scale;
  ok(`scale=${String(bad)} leaves the world untouched`, JSON.stringify(a) === JSON.stringify(b));
}

// 2. every path in the table actually exists in config.json — a typo here would
//    silently fail to scale part of the world.
{
  const c = load();
  const get = p => p.split(".").reduce((v, k) => (v == null ? v : v[k]), c);
  const missing = [...SCALED_PATHS, ...INVERSE_PATHS].filter(p => typeof get(p) !== "number");
  ok("every scaled path exists and is a number", missing.length === 0, missing.join(", "));
}

// 3. the actual scaling maths
{
  const s = 0.55;
  const base = load(), c = load(); c.world.scale = s; applyWorldScale(c);
  ok("world.size scales", near(c.world.size, base.world.size * s));
  ok("site positions scale", near(c.sites.soil.x, base.sites.soil.x * s) && near(c.sites.soil.z, base.sites.soil.z * s));
  ok("site radius does NOT scale (the surveyor is unchanged)", c.sites.soil.radius === base.sites.soil.radius);
  ok("camp/grave/shelter positions scale",
     near(c.camps.c1.x, base.camps.c1.x * s) && near(c.graves.g5.z, base.graves.g5.z * s) && near(c.shelter.x, base.shelter.x * s));
  ok("spawn scales", near(c.player.spawn.x, base.player.spawn.x * s));
  ok("ridge and basin scale in position and extent",
     near(c.terrain.ridge.x, base.terrain.ridge.x * s) && near(c.terrain.ridge.length, base.terrain.ridge.length * s)
     && near(c.terrain.basin.radius, base.terrain.basin.radius * s));
  ok("den spread scales", near(c.ashwaiters.denSpreadX.range, base.ashwaiters.denSpreadX.range * s));
  ok("strider spread and herd z scale",
     near(c.striders.spreadX, base.striders.spreadX * s) && near(c.striders.herdZ, base.striders.herdZ * s));
  ok("far hills scale", near(c.terrain.farHills.minDistance, base.terrain.farHills.minDistance * s));
  ok("terrain frequencies scale INVERSELY", near(c.terrain.baseFrequency, base.terrain.baseFrequency / s));
  ok("palette frequencies scale INVERSELY", near(c.terrain.palette.dustFrequency, base.terrain.palette.dustFrequency / s));
  ok("dawn0 and dawnVelocity scale", near(c.climate.dawn0, base.climate.dawn0 * s) && near(c.climate.dawnVelocity, base.climate.dawnVelocity * s));
  ok("climate.k scales INVERSELY", near(c.climate.k, base.climate.k / s));
  ok("LETHAL is untouched", c.climate.lethal === base.climate.lethal);
  ok("lethalMargin is untouched", c.climate.lethalMargin === base.climate.lethalMargin);
  ok("walk and sprint speed are untouched",
     c.player.walkSpeed === base.player.walkSpeed && c.player.sprintSpeed === base.player.sprintSpeed);
  ok("survey durations are untouched", c.sites.soil.duration === base.sites.soil.duration);
  ok("vertical scale is untouched",
     c.terrain.baseAmplitude === base.terrain.baseAmplitude && c.terrain.ridge.height === base.terrain.ridge.height);
}

// 4. THE INVARIANT THAT MATTERS: because dawn0 and dawnVelocity scale with the
//    world while k scales inversely, the clock is completely unmoved. A place at
//    the same relative position is the same temperature at the same moment, and
//    is lost at the same second. Shrinking the map buys travel time and nothing else.
{
  const s = 0.55;
  const base = load(), c = load(); c.world.scale = s; applyWorldScale(c);

  initClimate(base.climate);
  const beforeTemp = [], beforeLost = [];
  for (const x of [-1700, -900, -300, 0, 430, 900, 1700])
    for (const t of [0, 120, 600, 1200]) beforeTemp.push(tempAt(x, t));
  for (const x of [-1700, -900, 0, 900, 1700]) beforeLost.push(lostAtT(x));

  initClimate(c.climate);
  const afterTemp = [], afterLost = [];
  for (const x of [-1700, -900, -300, 0, 430, 900, 1700])
    for (const t of [0, 120, 600, 1200]) afterTemp.push(tempAt(x * s, t));
  for (const x of [-1700, -900, 0, 900, 1700]) afterLost.push(lostAtT(x * s));

  ok("temperature at the same relative place and time is identical",
     beforeTemp.every((v, i) => near(v, afterTemp[i], 1e-9)),
     `max delta ${Math.max(...beforeTemp.map((v, i) => Math.abs(v - afterTemp[i]))).toExponential(2)}`);
  ok("every place is lost at exactly the same second as before",
     beforeLost.every((v, i) => near(v, afterLost[i], 1e-6)),
     `max delta ${Math.max(...beforeLost.map((v, i) => Math.abs(v - afterLost[i]))).toExponential(2)}`);
  ok("the lethal band still covers the same fraction of the map",
     near((LETHAL + c.climate.lethalMargin) / c.climate.k / c.world.size,
          (LETHAL + base.climate.lethalMargin) / base.climate.k / base.world.size, 1e-12));
}

// 5. the grass rejection loop must stay scale-invariant, or the PRNG draw count
//    moves and with it every rock in the world.
{
  const s = 0.55;
  const base = load(), c = load(); c.world.scale = s; applyWorldScale(c);
  const ratio = k => k(c) / k(base);
  ok("grass band scales with the world (keeps refillGrass draw-invariant)",
     near(ratio(x => x.grass.spawnWidth), s) && near(ratio(x => x.grass.falloffSigma), s)
     && near(ratio(x => x.grass.bandOffset), s) && near(ratio(x => x.world.size), s));
}

if (failures) { console.error(`\nscale.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nscale.test.js: all passed");
