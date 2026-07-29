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
     near(c.camps.c5.x, base.camps.c5.x * s) && near(c.graves.g5.z, base.graves.g5.z * s) && near(c.shelter.x, base.shelter.x * s));
  ok("spawn scales", near(c.player.spawn.x, base.player.spawn.x * s));
  ok("the canyon scales in every horizontal dimension",
     near(c.terrain.canyon.length, base.terrain.canyon.length * s)
     && near(c.terrain.canyon.width, base.terrain.canyon.width * s)
     && near(c.terrain.canyon.west.toe, base.terrain.canyon.west.toe * s)
     && near(c.terrain.canyon.west.run, base.terrain.canyon.west.run * s)
     && near(c.terrain.canyon.east.buttress.run, base.terrain.canyon.east.buttress.run * s));
  ok("canyon wall HEIGHT scales too, so the room stays a room",
     near(c.terrain.canyon.west.height, base.terrain.canyon.west.height * s)
     && near(c.terrain.canyon.west.buttress.height, base.terrain.canyon.west.buttress.height * s)
     && near(c.terrain.canyon.northEnd.height, base.terrain.canyon.northEnd.height * s));
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
     c.terrain.baseAmplitude === base.terrain.baseAmplitude);
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

// 6. THE ROOM. The crevice has to stay a room at every scale, and after the
//    reshaping there are exactly two properties that make it one. Both are
//    checked here because both have already been broken once.
//
//    (a) AT THE OUTER TOE — the fixed line in x where the containment face
//        starts — the ground must never stand higher than the buttress cap.
//        Anything higher is a shelf, and a shelf lets the player begin the face
//        part-way up it instead of at its foot. An earlier version let the
//        buttress plateau run out past the toe and a flood fill walked out over
//        it at the south end. This is measured against heightAt, not assumed.
//
//    (b) FROM THAT CAP, the face above must still have a band the player cannot
//        cross: steeper than the climb limit over a realistic step, and wider
//        than one step so it cannot be jumped in a single frame. The face is a
//        square root, so the sampled grade falls as the step grows — the check
//        uses a sprint stride, the largest step the controller ever takes.
{
  const STRIDE = 0.5;                       // sprint 9 m/s at a bad 18 fps
  for (const scale of [1, 0.55, 2]) {
    const c = load(); c.world.scale = scale; applyWorldScale(c);
    const cy = c.terrain.canyon, limit = c.player.maxClimbGrade;
    for (const side of ["west", "east"]) {
      const W = cy[side], B = W.buttress;
      const cap = B.height * (1 + B.crestVary);              // tallest the buttress gets
      const drop = W.height * (1 - W.crestVary) - cap;       // shortest face above it
      const A = (1 - W.talusHeight) / (2 * (1 - W.talusFraction));
      const toeGrade = drop * (1 - W.talusHeight)
                     * Math.sqrt(STRIDE / (W.run * (1 - W.talusFraction))) / STRIDE;
      const bandWide = W.run * (1 - W.talusFraction)
                     * Math.pow(A * drop / (limit * W.run), 2);
      ok(`scale ${scale} ${side}: the face above the buttress is unclimbable`,
         toeGrade > limit * 1.5,
         `sampled grade ${toeGrade.toFixed(2)} over a ${STRIDE} m stride vs limit ${limit}`);
      ok(`scale ${scale} ${side}: the unclimbable band is wider than one stride`,
         bandWide > STRIDE * 3,
         `band is ${bandWide.toFixed(1)} m wide`);
    }
  }
}

// 6b. and the toe line itself, measured. This is the property every irregular
//     thing in the crevice is allowed to exist because of: the buttress in front
//     may wander as much as it likes, but at x = toe the rock is never higher
//     than the cap the buttress is allowed to reach.
{
  globalThis.document = globalThis.document || { createElement: () => ({
    width: 0, height: 0,
    getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
                         putImageData() {} }) }) };
  const noise = await import("../src/world/noise.js");
  const terrain = await import("../src/world/terrain.js");
  const c = load();
  noise.initNoise(c.terrain.noiseSeed);
  terrain.initTerrain(c, {}, { THREE: null, scene: null, rand: noise.rand, fbm: noise.fbm });
  const cy = c.terrain.canyon, halfL = cy.length / 2;
  for (const side of ["west", "east"]) {
    const W = cy[side], B = W.buttress, sgn = side === "west" ? 1 : -1;
    // the cap, plus what the floor's own relief and cross-fall can add on top
    const allowed = B.height * (1 + B.crestVary) + cy.floorRelief + 4;
    let worst = -Infinity, worstZ = 0;
    for (let z = -halfL; z <= halfL; z += 3) {
      const y = terrain.heightAt(sgn * W.toe, z);
      if (y > worst) { worst = y; worstZ = z; }
    }
    ok(`no shelf at the ${side} toe: ground there stays under the buttress cap`,
       worst <= allowed, `${worst.toFixed(1)} m at z=${worstZ}, cap+slack is ${allowed.toFixed(1)} m`);
  }
}

if (failures) { console.error(`\nscale.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nscale.test.js: all passed");
