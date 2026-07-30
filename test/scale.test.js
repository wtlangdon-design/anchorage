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
  ok("the path scales in every horizontal dimension",
     near(c.terrain.path.startX, base.terrain.path.startX * s)
     && near(c.terrain.path.outerHalfWidth, base.terrain.path.outerHalfWidth * s)
     && near(c.terrain.path.ridgeRun, base.terrain.path.ridgeRun * s)
     && near(c.terrain.path.blend, base.terrain.path.blend * s));
  ok("wall HEIGHT scales too, so the corridor stays a corridor",
     near(c.terrain.path.outerCrestY, base.terrain.path.outerCrestY * s)
     && near(c.terrain.path.farEnd.crestY, base.terrain.path.farEnd.crestY * s));
  ok("every segment of the chain scales, including its floor profile",
     c.terrain.path.segments.every((sg, i) => {
       const b = base.terrain.path.segments[i];
       return ["length","halfWidth","centre","ridgeTop","sill","sillRun","drop","dropRun","dropTail"]
         .every(k => near(sg[k], b[k] * s, 1e-6));
     }));
  ok("and so the one-way transitions stay one-way at every scale",
     c.terrain.path.segments.every((sg, i) => {
       const b = base.terrain.path.segments[i];
       if (!b.drop || !b.dropRun) return true;
       return near(1.5 * sg.drop / sg.dropRun, 1.5 * b.drop / b.dropRun, 1e-9);
     }));
  ok("den spread scales", near(c.ashwaiters.denSpreadX.range, base.ashwaiters.denSpreadX.range * s));
  ok("strider spread scales, and its lateral fraction does NOT (it is a fraction)",
     near(c.striders.spreadX, base.striders.spreadX * s)
     && c.striders.lateralFraction === base.striders.lateralFraction);
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

// 6. THE CORRIDOR. Two properties keep the journey a journey at any scale, and
//    both have already been broken once during this rebuild.
//
//    (a) THE LIP. The ridge beside the floor starts with a vertical step of
//        path.ridgeLip. Everything else in the plan drifts along the journey —
//        width, centreline, ridge height — and a drifting wall beside a floor is a
//        staircase whose grade is the wall's slope times the drift rate; there is
//        always somewhere that product falls under the climb limit. A flood fill
//        found three separate versions of that route. A discontinuity is the only
//        thing a drift cannot soften, so the lip must stay a lip: no talus
//        fractions, no apron, no smoothing.
//
//    (b) THE ONE-WAY DROPS. A smoothstep drop's steepest grade is
//        1.5*drop/dropRun; above player.maxClimbGrade it can be walked down and
//        not back up, and that is the whole mechanism by which a site walked past
//        is gone. Checked here, per segment, at every scale.
{
  for (const scale of [1, 0.55, 2]) {
    const c = load(); c.world.scale = scale; applyWorldScale(c);
    const p = c.terrain.path, limit = c.player.maxClimbGrade;
    ok(`scale ${scale}: the ridge still starts with a lip, not a slope`,
       typeof p.ridgeLip === "number" && p.ridgeLip > 0
       && p.ridgeTalusFraction === undefined && p.ridgeTalusHeight === undefined,
       `ridgeLip ${p.ridgeLip}`);
    // A lip of L is refused at any stride shorter than L/limit metres. The
    // controller's longest possible stride is one sprint frame at main.js's dt cap,
    // and that is NOT scaled — the surveyor keeps walking at 9 m/s in a half-size
    // world — so a shrunk world has a proportionally weaker lip and this is the
    // check that says how far that can go.
    const longestStride = c.player.sprintSpeed * 0.05;   // main.js clamps dt to 0.05
    ok(`scale ${scale}: the lip is refused even at the longest stride the loop allows`,
       p.ridgeLip / longestStride > limit,
       `${(p.ridgeLip / longestStride).toFixed(2)} vs ${limit} at a ${longestStride} m stride`);
    const oneWay = p.segments.filter(sg => sg.drop > 0 && sg.dropRun > 0
                                     && 1.5 * sg.drop / sg.dropRun > limit);
    ok(`scale ${scale}: at least two transitions cannot be walked back up`,
       oneWay.length >= 2, `${oneWay.length}: ${oneWay.map(s => s.id).join(", ")}`);
    for (const sg of oneWay)
      ok(`scale ${scale}: ${sg.id} clears the drop before the plan starts blending`,
         sg.dropTail >= p.blend * 0.5,
         `dropTail ${sg.dropTail} vs half-blend ${p.blend * 0.5}`);
  }
}

// 6b. and the chain itself, measured against the terrain rather than the config.
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
  const segs = terrain.pathSegments();
  const chambers = segs.filter(g => g.kind === "chamber");
  ok("five to seven chambers", chambers.length >= 5 && chambers.length <= 7, `${chambers.length}`);
  const len = segs[segs.length - 1].x1 - segs[0].x0;
  ok("roughly 2500 m long", len > 2300 && len < 2800, `${len} m`);
  const w = segs.map(g => g.halfWidth * 2);
  ok("28 to 80 m wide throughout", Math.min(...w) >= 28 && Math.max(...w) <= 80,
     `${Math.min(...w)}-${Math.max(...w)} m`);
  // the lip, measured: one step off the floor's edge must be a wall at any stride
  const limit = c.player.maxClimbGrade;
  // Measured at the REAL floor edge on both sides, which is pocket-aware: a detour
  // widens one side only, and stepping into a pocket is stepping onto floor.
  let worst = Infinity, worstAt = null;
  for (const g of chambers) {
    for (const frac of [0.25, 0.5, 0.75]) {
      const x = g.x0 + g.length * frac, p = terrain.pathPlan(x);
      for (const [edge, dir] of [[p.edgePlus, 1], [p.edgeMinus, -1]])
        for (const stride of [0.07, 0.35, 0.5]) {
          const on = terrain.heightAt(x, edge - dir * 0.01);
          const off = terrain.heightAt(x, edge + dir * stride);
          const grade = (off - on) / stride;
          if (grade < worst) { worst = grade; worstAt = `${g.id} ${dir > 0 ? "+z" : "-z"} at a ${stride} m stride`; }
        }
    }
  }
  ok("stepping off the floor onto the ridge is refused everywhere",
     worst > limit * 2, `weakest is ${worst.toFixed(1)} in ${worstAt}`);
}

if (failures) { console.error(`\nscale.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nscale.test.js: all passed");
