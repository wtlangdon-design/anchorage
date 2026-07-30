// clock.test.js — mission time must not advance before the clock starts.
// Run: node test/clock.test.js
//
// This exists because the split between mission time and wall-clock time has now
// been lost TWICE, both times the same way: `S.t += dt` in main.js's loop with
// nothing in front of it. The failure is silent — the game still runs, it just
// starts expiring the six sites in the opening seconds, which is the one thing the
// opening is built not to do. So there are two kinds of check below:
//
//   BEHAVIOURAL — drive clock.tick() and assert S.t stays at zero, that the world
//     clock keeps running anyway, and that nothing on the manifest can be lost
//     while it does.
//   STATIC — scan every .js file in src/ and fail if `S.t +=` (or any other
//     assignment that moves mission time) appears outside game/clock.js. This is
//     the one that actually catches the regression, because the regression has
//     never been a wrong number, it has been a line in the wrong file.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as clock from "../src/game/clock.js";
import { initClimate, dawnX, tempAt, lostAtT, LETHAL } from "../src/world/climate.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name);
};
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const fresh = (grace) => {
  const c = JSON.parse(JSON.stringify(config));
  if (grace !== undefined) c.climate.grace = { backstopSeconds: grace };
  const S = {};
  clock.initClock(c, {}, { S });
  return S;
};

/* ---- 1. the whole point ------------------------------------------------- */
{
  const S = fresh(0);                 // no backstop, so only an explicit start can fire
  let wall = 0;
  for (let i = 0; i < 4000; i++) { const dt = 1 / 60; clock.tick(dt, true); wall += dt; }
  ok("S.t does not advance before the clock starts", S.t === 0, `S.t reached ${S.t}`);
  ok("S.animT advances anyway — the world is not frozen, only the clock",
     near(S.animT, wall, 1e-6), `animT ${S.animT} vs ${wall}`);
  ok("clockStarted stays false without a trigger", S.clockStarted === false);
}

/* ---- 2. and it does advance once started ------------------------------- */
{
  const S = fresh(0);
  for (let i = 0; i < 600; i++) clock.tick(1 / 60, true);
  ok("still zero after ten seconds of play", S.t === 0);
  ok("start() reports that it did something", clock.start("test") === true);
  ok("start() is idempotent", clock.start("test again") === false);
  ok("the reason is kept", S.clockStartReason === "test");
  for (let i = 0; i < 600; i++) clock.tick(1 / 60, true);
  ok("mission time runs after the clock starts", near(S.t, 10, 1e-6), `S.t ${S.t}`);
  ok("the wall clock is now ahead of mission time by the grace it spent",
     S.animT > S.t + 9, `animT ${S.animT.toFixed(2)} vs t ${S.t.toFixed(2)}`);
}

/* ---- 3. the backstop ---------------------------------------------------- */
{
  const S = fresh(30);
  for (let i = 0; i < 29 * 60; i++) clock.tick(1 / 60, true);
  ok("the backstop has not fired early", S.clockStarted === false, `fired at ${clock.graceElapsed()}s`);
  for (let i = 0; i < 2 * 60; i++) clock.tick(1 / 60, true);
  ok("the backstop fires at its configured time", S.clockStarted === true);
  ok("and says so", S.clockStartReason === "backstop", S.clockStartReason);
}
{
  // pausing on an overlay must not burn the grace period
  const S = fresh(30);
  for (let i = 0; i < 120 * 60; i++) clock.tick(1 / 60, false);
  ok("a paused game does not burn the grace period", S.clockStarted === false);
  ok("but the world still animates while paused", S.animT > 100, `animT ${S.animT}`);
  ok("and mission time is still zero", S.t === 0);
}
{
  const S = fresh(30);
  clock.start("story");
  for (let i = 0; i < 120 * 60; i++) clock.tick(1 / 60, true);
  ok("a story start is not overwritten by the backstop", S.clockStartReason === "story");
}

/* ---- 4. what a frozen clock means for the planet ------------------------ */
// climate.js is untouched by any of this: it is handed a t that is not moving.
{
  initClimate(config.climate);
  const S = fresh(0);
  for (let i = 0; i < 6000; i++) clock.tick(1 / 60, true);
  ok("the dawn line has not moved", near(dawnX(S.t), config.climate.dawn0));
  const real = o => Object.keys(o || {}).filter(k => !k.startsWith("_"));
  const hottest = Math.max(...real(config.sites).map(id => tempAt(config.sites[id].x, S.t, 0)));
  ok("no site's ground is anywhere near lethal", hottest < LETHAL,
     `hottest site ground is ${hottest.toFixed(1)} C against a lethal ${LETHAL}`);
  const soonest = Math.min(...real(config.sites)
    .filter(id => !config.sites[id].followsBand)
    .map(id => lostAtT(config.sites[id].x, 0)));
  ok("every deadline is still in the future", soonest - S.t > 0,
     `soonest deadline ${(soonest - S.t).toFixed(0)}s away`);
}

/* ---- 5. THE STATIC GUARD ------------------------------------------------ */
// Nothing but clock.js may move mission time. This is the check that would have
// caught both previous regressions, and it catches them at the line, not the
// symptom. If you are here because this failed: the fix is to call
// clock.start(reason) or to use S.animT, not to add an exception below.
{
  const walk = dir => readdirSync(dir).flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".js") ? [p] : [];
  });
  const src = join(here, "../src");
  const OWNER = join(src, "game", "clock.js");
  // any assignment that moves S.t: `S.t +=`, `S.t = S.t +`, `S.t++`, destructured
  // writes through another name are not reachable here because S.t is a property
  const MOVES = /S\s*\.\s*t\s*(\+=|-=|\*=|\/=|\+\+|--)|S\s*\.\s*t\s*=(?!=)/;
  const offenders = [];
  for (const file of walk(src)) {
    if (file === OWNER) continue;
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, "");
      if (MOVES.test(code)) offenders.push(`${file.slice(src.length + 1)}:${i + 1}  ${line.trim()}`);
    });
  }
  ok("only game/clock.js moves mission time", offenders.length === 0,
     "\n      " + offenders.join("\n      "));

  // and the loop must actually be calling it, or the split is decorative
  const main = readFileSync(join(src, "main.js"), "utf8");
  ok("main.js's loop calls clock.tick", /clock\s*\.\s*tick\s*\(/.test(main));
  ok("main.js hands the wall clock to the grass shader", /setWind\(\s*S\.animT/.test(main));
  ok("main.js hands the wall clock to the dust", /updateDust\([^)]*S\.animT/.test(main));
  ok("main.js hands BOTH clocks to the striders", /updateStriders\(\s*S\.t\s*,\s*S\.animT\s*\)/.test(main));
  // climate.js must stay a pure function of t — it may not learn about any of this
  const climate = readFileSync(join(src, "world", "climate.js"), "utf8");
  ok("climate.js knows nothing about the grace period",
     !/clockStarted|animT|grace/i.test(climate));
}

if (failures) { console.error(`\nclock.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nclock.test.js: all passed");
