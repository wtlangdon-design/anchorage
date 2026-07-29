// balance.js — solvability check. Run: node test/balance.js  (or npm run balance)
//
// Prints, for each site and camp: distance from spawn, sprint time, walk time, and
// time-until-lost. Then it decides reachability by an exhaustive bitmask search over
// every visiting order (Held-Karp), so the claims are real, not greedy artifacts.
//
// Asserts: (1) every objective is individually reachable; (2) the survey is solvable
// (all six findings answerable in one run); (3) the full manifest cannot be cleared
// at a sustainable pace — i.e. at least two objectives conflict.
//
// It also reports, without failing, whether that conflict survives at full sprint —
// a real balance signal for the author, since a design goal is "you cannot answer
// all six."
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, lostAtT } from "../src/world/climate.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
initClimate(config.climate);

const spawn = config.player.spawn;
const sprint = config.player.sprintSpeed;
const walk = config.player.walkSpeed;
const bandOffset = config.striders.bandOffset;
const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const notMeta = ([id]) => !id.startsWith("_");

const sites = Object.entries(config.sites).filter(notMeta).map(([id, s]) => ({
  id, x: s.x, z: s.z, dur: s.duration, band: !!s.followsBand,
  deadline: s.followsBand ? Infinity : lostAtT(s.x)
}));
const camps = Object.entries(config.camps).filter(notMeta).map(([id, c]) => ({
  id, x: c.x, z: c.z, dur: 0, band: false, deadline: lostAtT(c.x)
}));
const targetX = (o, t) => (o.band ? dawnX(t) + bandOffset : o.x);

// ---- table ----
function printRow(o) {
  const d = dist(spawn.x, spawn.z, targetX(o, 0), o.z);
  const lost = o.deadline === Infinity ? "  never" : o.deadline.toFixed(0).padStart(7);
  console.log(`  ${o.id.padEnd(8)} dist ${d.toFixed(0).padStart(5)}m   sprint ${(d / sprint).toFixed(0).padStart(4)}s` +
              `   walk ${(d / walk).toFixed(0).padStart(4)}s   lost@ ${lost}s`);
}
console.log("SITES");  sites.forEach(printRow);
console.log("CAMPS");  camps.forEach(printRow);
console.log("");

let failures = 0;
const ok = (name, cond, detail = "") => { if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name); };

// ---- (1) individual reachability, at sprint, including the survey hold ----
for (const o of [...sites, ...camps]) {
  const arrive = dist(spawn.x, spawn.z, targetX(o, 0), o.z) / sprint + o.dur;
  ok(`${o.id} individually reachable`, o.deadline === Infinity || arrive <= o.deadline,
     `arrive ${arrive.toFixed(0)}s vs lost ${o.deadline.toFixed(0)}s`);
}

// ---- exhaustive best-completable, respecting deadlines and moving band targets ----
// dp[mask][i] = earliest time to have completed exactly `mask`, ending at objective i.
function maxCompletable(objs, speed) {
  const n = objs.length, FULL = 1 << n;
  const dp = Array.from({ length: FULL }, () => new Array(n).fill(Infinity));
  for (let i = 0; i < n; i++) {
    const a = dist(spawn.x, spawn.z, targetX(objs[i], 0), objs[i].z) / speed;
    if (a <= objs[i].deadline) dp[1 << i][i] = a + objs[i].dur;
  }
  let best = 0, bestMask = 0;
  for (let mask = 1; mask < FULL; mask++) {
    for (let i = 0; i < n; i++) {
      const t = dp[mask][i];
      if (!isFinite(t)) continue;
      const pc = popcount(mask);
      if (pc > best) { best = pc; bestMask = mask; }
      for (let j = 0; j < n; j++) {
        if (mask & (1 << j)) continue;
        const a = t + dist(targetX(objs[i], t), objs[i].z, targetX(objs[j], t), objs[j].z) / speed;
        if (a <= objs[j].deadline) {
          const nt = a + objs[j].dur;
          if (nt < dp[mask | (1 << j)][j]) dp[mask | (1 << j)][j] = nt;
        }
      }
    }
  }
  return { best, total: n, missed: objs.filter((_, i) => !(bestMask & (1 << i))).map(o => o.id) };
}
function popcount(m) { let c = 0; while (m) { c += m & 1; m >>= 1; } return c; }

// ---- (2) the survey is solvable: all six findings answerable in a single run ----
const sitesSprint = maxCompletable(sites, sprint);
ok("all six findings are answerable in one run (survey is solvable)",
   sitesSprint.best === sites.length, `best ${sitesSprint.best}/${sites.length}`);

// ---- (3) the full manifest conflicts: it cannot be cleared at a sustainable pace ----
const all = [...sites, ...camps];
const allWalk = maxCompletable(all, walk);
const allSprint = maxCompletable(all, sprint);
console.log(`\n  full manifest (6 sites + 5 camps): sprint ${allSprint.best}/${all.length}, walk ${allWalk.best}/${all.length}` +
            (allWalk.missed.length ? `  (walk sacrifices: ${allWalk.missed.join(", ")})` : ""));
ok("the full manifest cannot be cleared at a sustainable pace (objectives conflict)",
   allWalk.best < all.length, `walk clears ${allWalk.best}/${all.length}`);

// ---- reported, not asserted: is the tension there at full sprint too? ----
if (allSprint.best === all.length) {
  console.log("\n  NOTE for the author: at continuous sprint every tracked objective (all six");
  console.log("  findings AND all five camps) is reachable. The 'you cannot answer all six'");
  console.log("  pressure is currently carried by pace and by the unmarked graves/shelter, not");
  console.log("  enforced by the site deadlines. Tightening dawnVelocity or the sunward site x");
  console.log("  positions would make the choice kinematic if that is the intent.");
} else {
  console.log(`\n  at sprint the manifest also cannot be fully cleared (sacrifices: ${allSprint.missed.join(", ")}).`);
}

if (failures) { console.error(`\nbalance.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nbalance.js: all checks passed");
