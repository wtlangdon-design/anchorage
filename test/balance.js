// balance.js — the solvability check, for a ONE-WAY JOURNEY.
// Run: node test/balance.js  (or npm run balance)
//
// THE SHAPE OF THE PROBLEM CHANGED, so this file did too. The world used to be a
// room, and the question was "which of these waypoints can you reach before the
// ground under them cooks". It is now a 2510 m corridor walked in one direction:
// the main line is safe forward progress, the six findings hang off it as detours,
// and the only currency is time. So the questions are:
//
//   * How far off the main line is each finding, and what does that detour cost?
//   * Does the dawn take a finding while the player is somewhere else?
//   * HOW MANY OF THE SIX CAN BE TAKEN IN ONE PASS? The design says not all of
//     them, and this is where that becomes a measured fact instead of a number we
//     keep failing to tune. CLAUDE.md invariant 1 is now geometry: you walk past a
//     detour's mouth and it is gone, because you cannot go back.
//
// WHY A DETOUR CANNOT BE RETURNED TO: three of the passes are one-way by terrain
// (terrain.path.segments — a smoothstep drop steeper than player.maxClimbGrade),
// and the lethal edge follows you up the corridor at dawnVelocity. Nothing else
// enforces it. No timer, no flag, no script.
//
// The search below is exact rather than greedy. The player only ever moves forward
// and may enter any subset of the pockets in path order, so the reachable subsets
// are exactly the subsets of an ordered list, and one sweep carrying "earliest time
// I can be here having taken k of them" gets the true maximum.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, lostAtT, tempAt, LETHAL } from "../src/world/climate.js";
import { applyWorldScale } from "../src/world/scale.js";
import { initNoise, fbm } from "../src/world/noise.js";
import * as terrain from "../src/world/terrain.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
applyWorldScale(config);   // measure the world as it ships
initClimate(config.climate);
// the corridor decides which ground is shaded, and shaded ground survives the dawn
// far longer, so balance has to measure the world with its shadow in place
terrain.initTerrain(config, {}, { THREE: {}, scene: { add(){} }, rand: () => 0.5, fbm });
initNoise(config.terrain.noiseSeed);
const shadeAt = terrain.shadeAt;
const segs = terrain.pathSegments();
const plan = terrain.pathPlan;

const spawn = config.player.spawn;
const walk = config.player.walkSpeed;
const sprint = config.player.sprintSpeed;
const suit = config.suit;
const notMeta = k => !k.startsWith("_");
const X0 = segs[0].x0, X1 = segs[segs.length - 1].x1;

let failures = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name); };

/* ---- where the clock starts ---------------------------------------------- */
const grantKey = Object.keys(config.camps).filter(notMeta).find(k => config.camps[k].grantsSurvey);
const grant = grantKey ? config.camps[grantKey] : spawn;
const grantName = grantKey ? `camp ${grantKey}` : "spawn";

console.log(`THE PROLOGUE, untimed: spawn (${spawn.x}, ${spawn.z}) to ${grantName} (${grant.x}, ${grant.z})`);
{
  const d = Math.abs(grant.x - spawn.x);
  console.log(`  ${d.toFixed(0)} m of corridor — ${(d / walk).toFixed(0)}s at a walk.`);
  console.log(`  Mission time does not advance and nothing expires. Reading Vantaa's last`);
  console.log(`  entry there is what starts the clock and hands over the six findings.`);
  console.log(`  Backstop if the player never gets there: ${config.climate.grace.backstopSeconds}s of play.`);
  const hot = tempAt(spawn.x, 0, shadeAt(spawn.x, spawn.z));
  console.log(`  Ground at spawn during the prologue: ${hot.toFixed(0)} C (the suit hurts above ${suit.heatDamageThreshold}).`);
  ok("the prologue is survivable at t=0 all the way to the handover", hot < suit.heatDamageThreshold,
     `${hot.toFixed(0)} C at spawn`);
}

/* ---- the detours --------------------------------------------------------- */
// Each static finding sits at the head of a pocket. Its detour is the real walk:
// off the corridor's centreline out to the site and back.
const sites = Object.keys(config.sites).filter(notMeta).map(id => {
  const s = config.sites[id];
  const p = plan(s.x);
  const off = Math.abs(s.z - p.centre);
  const detour = 2 * off;
  return {
    id, x: s.x, z: s.z, dur: s.duration, band: !!s.followsBand,
    offset: off, detour, cost: detour / walk + s.duration,
    shade: s.followsBand ? 0 : shadeAt(s.x, s.z),
    deadline: s.followsBand ? Infinity : lostAtT(s.x, shadeAt(s.x, s.z)),
    seg: (segs.find(g => s.x >= g.x0 && s.x <= g.x1) || {}).id || "?"
  };
}).sort((a, b) => a.x - b.x);

console.log("\nTHE SIX FINDINGS, in the order the journey meets them");
console.log("  finding   at x   in            off the line  detour   walk   lost@");
for (const s of sites) {
  console.log(`  ${s.id.padEnd(8)} ${String(Math.round(s.x)).padStart(6)}  ${s.seg.padEnd(12)}` +
    `  ${s.offset.toFixed(0).padStart(5)} m     ${s.detour.toFixed(0).padStart(4)} m  ` +
    `${s.cost.toFixed(0).padStart(4)}s  ${s.deadline === Infinity ? "  never" : s.deadline.toFixed(0).padStart(6) + "s"}` +
    (s.band ? "   (follows the band — see phase 3)" : ""));
}
{
  const past = sites.filter(s => s.x < grant.x);
  ok("no finding sits behind the handover — one there could never be surveyed",
     past.length === 0, past.map(s => s.id).join(", "));
  const flat = sites.filter(s => !s.band && s.offset < 30);
  ok("every static finding is a real detour, not a step off the path",
     flat.length === 0, flat.map(s => `${s.id} only ${s.offset.toFixed(0)} m off`).join(", "));
  // and no two of them in one place — the complaint being fixed is that everything
  // was revealed in one small area
  let worst = Infinity, pair = "";
  for (let i = 0; i < sites.length; i++) for (let j = i + 1; j < sites.length; j++) {
    const d = Math.hypot(sites[i].x - sites[j].x, sites[i].z - sites[j].z);
    if (d < worst) { worst = d; pair = `${sites[i].id}/${sites[j].id}`; }
  }
  console.log(`  closest two findings: ${pair} at ${worst.toFixed(0)} m apart`);
  ok("no two findings within 150 m of each other", worst >= 150, `${pair} at ${worst.toFixed(0)} m`);
  // Band-followers are excluded: a moving objective is not "in" a chamber at all,
  // and bio is one until phase 3 puts it on the herd.
  const bySeg = {};
  for (const s of sites) if (!s.band) bySeg[s.seg] = (bySeg[s.seg] || 0) + 1;
  const shared = Object.entries(bySeg).filter(([, n]) => n > 1);
  console.log(`  spread over ${Object.keys(bySeg).length} segments of the chain: ${Object.keys(bySeg).join(", ")}`);
  ok("no two findings in the same segment of the chain", shared.length === 0,
     shared.map(([k, n]) => `${k} has ${n}`).join(", "));
}

/* ---- the sweep: how many can be taken in one forward pass? -------------- */
function maxTakeable(speed) {
  const n = sites.length;
  let best = new Array(n + 1).fill(Infinity);
  let taken = new Array(n + 1).fill(null).map(() => []);
  best[0] = 0;
  let atX = grant.x;
  for (const s of sites) {
    const leg = Math.abs(s.x - atX) / speed;
    const next = new Array(n + 1).fill(Infinity);
    const nextTaken = new Array(n + 1).fill(null).map(() => []);
    for (let k = 0; k <= n; k++) {
      if (!isFinite(best[k])) continue;
      const arrive = best[k] + leg;
      if (arrive < next[k]) { next[k] = arrive; nextTaken[k] = taken[k]; }
      // take it: half the detour to reach the head, survey, half back
      const reach = arrive + s.detour / (2 * speed);
      const alive = s.deadline === Infinity || reach + s.dur <= s.deadline;
      const done = arrive + s.detour / speed + s.dur;
      if (alive && done < next[k + 1]) { next[k + 1] = done; nextTaken[k + 1] = taken[k].concat(s.id); }
    }
    best = next; taken = nextTaken;
    atX = s.x;
  }
  // and the player has to get clear of the lethal edge at the far end
  const runOut = lostAtT(X1, 0);
  for (let k = sites.length; k >= 0; k--) {
    if (!isFinite(best[k])) continue;
    const finish = best[k] + Math.abs(X1 - atX) / speed;
    if (finish <= runOut) return { n: k, set: taken[k], total: sites.length, runOut, finish };
  }
  return { n: 0, set: [], total: sites.length, runOut, finish: Infinity };
}

console.log("\nHOW MANY OF THE SIX CAN BE TAKEN IN ONE PASS");
const atWalk = maxTakeable(walk);
const atSprint = maxTakeable(sprint);
const mainLine = Math.abs(X1 - grant.x);
const allDetours = sites.reduce((a, s) => a + s.detour, 0);
const allSurvey = sites.reduce((a, s) => a + s.dur, 0);
console.log(`  the lethal edge reaches the far end at t=${atWalk.runOut.toFixed(0)}s — that is the whole run`);
console.log(`  main line from ${grantName} to the far end: ${mainLine.toFixed(0)} m, ${(mainLine / walk).toFixed(0)}s at a walk`);
console.log(`  every detour as well: +${allDetours.toFixed(0)} m and +${allSurvey.toFixed(0)}s of survey` +
            ` = ${((mainLine + allDetours) / walk + allSurvey).toFixed(0)}s at a walk,` +
            ` ${((mainLine + allDetours) / sprint + allSurvey).toFixed(0)}s at a sprint`);
console.log(`\n  at a WALK   : ${atWalk.n} of ${atWalk.total}` + (atWalk.set.length ? `  (${atWalk.set.join(", ")})` : ""));
console.log(`  at a SPRINT : ${atSprint.n} of ${atSprint.total}` + (atSprint.set.length ? `  (${atSprint.set.join(", ")})` : ""));

// THE INVARIANT, verified rather than assumed.
ok("the six findings CANNOT all be taken in one pass, even at a continuous sprint",
   atSprint.n < atSprint.total,
   `${atSprint.n}/${atSprint.total} taken — the clock is not charging enough for the detours`);
ok("but enough can be taken that the choice is a choice, not a formality",
   atWalk.n >= 2 && atSprint.n >= 3, `walk ${atWalk.n}, sprint ${atSprint.n}`);
ok("each finding is individually reachable if you go straight to it",
   sites.every(s => s.deadline === Infinity ||
     Math.abs(s.x - grant.x) / sprint + s.detour / (2 * sprint) + s.dur <= s.deadline),
   sites.filter(s => s.deadline !== Infinity &&
     Math.abs(s.x - grant.x) / sprint + s.detour / (2 * sprint) + s.dur > s.deadline)
     .map(s => s.id).join(", "));

/* ---- what the dawn takes while you are elsewhere ------------------------ */
console.log("\nWHAT THE DAWN TAKES, AND WHEN");
{
  let atX = grant.x, t = 0;
  const rows = [];
  for (const s of sites) {
    t += Math.abs(s.x - atX) / walk; atX = s.x;
    const head = t + s.detour / (2 * walk);
    rows.push([s.id, head, s.deadline, s.deadline === Infinity ? Infinity : s.deadline - head - s.dur]);
  }
  for (const [id, head, dead, margin] of rows)
    console.log(`  ${id.padEnd(8)} a walker who stops for nothing else reaches its head at t=${head.toFixed(0)}s` +
      (dead === Infinity ? ", and it never expires"
        : `, ground gone at t=${dead.toFixed(0)}s — ${margin.toFixed(0)}s of margin`));
  const doomed = rows.filter(r => r[3] !== Infinity && r[3] < 0);
  console.log(doomed.length
    ? `  the dawn takes ${doomed.length} of them before even a straight-line walker arrives: ${doomed.map(r => r[0]).join(", ")}`
    : `  none of the six is out of reach for a walker who takes no other detour`);
}

/* ---- the corridor as the heat crosses it -------------------------------- */
console.log("\nTHE CORRIDOR UNDER THE HEAT");
{
  const sample = [];
  for (let x = X0 + 10; x <= X1 - 10; x += 10) {
    const p = plan(x);
    for (let f = -0.85; f <= 0.85; f += 0.34) {
      const z = p.centre + f * p.halfWidth;
      sample.push([x, z, shadeAt(x, z)]);
    }
  }
  const shaded = sample.filter(p => p[2] > 0.5).length / sample.length;
  console.log(`  ${sample.length} points along the corridor, ${(100 * shaded).toFixed(0)}% of it shaded`);
  console.log(`  standable corridor over time (below ${suit.heatDamageThreshold} C = no suit damage; below ${LETHAL} C = not lost):`);
  for (let t = 0; t <= 1800; t += 200) {
    const safe = sample.filter(p => tempAt(p[0], t, p[2]) < suit.heatDamageThreshold).length / sample.length;
    const alive = sample.filter(p => tempAt(p[0], t, p[2]) < LETHAL).length / sample.length;
    const edge = dawnX(t) - (LETHAL + config.climate.lethalMargin) / config.climate.k;
    console.log(`     t=${String(t).padStart(4)}s   lethal edge at x=${edge.toFixed(0).padStart(6)}   ` +
      `${(100 * safe).toFixed(0).padStart(3)}% comfortable   ${(100 * alive).toFixed(0).padStart(3)}% standable`);
  }
  const hereNow = tempAt(grant.x, 0, shadeAt(grant.x, grant.z));
  ok("the ground where the clock starts is not already hurting you",
     hereNow < suit.heatDamageThreshold, `${hereNow.toFixed(0)} C`);
  ok("the heat eats the whole corridor from behind",
     lostAtT(X1, 0) > lostAtT(X0, 0) && isFinite(lostAtT(X1, 0)));
  ok("shaded ground outlasts open ground", lostAtT(0, 1) > lostAtT(0, 0) * 1.02,
     `open ${lostAtT(0, 0).toFixed(0)}s vs shaded ${lostAtT(0, 1).toFixed(0)}s`);
}

if (failures) { console.error(`\nbalance.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nbalance.js: all checks passed");
