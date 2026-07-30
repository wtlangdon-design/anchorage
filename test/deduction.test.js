// deduction.test.js — the Meridian worksheet. Run: node test/deduction.test.js
//
// The rule this file exists to protect: the game never tells the player a fate,
// and never says which of their conclusions is wrong. Both are easy to break with
// a well-meaning edit, and either one turns the mystery back into a quiz.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, tempAt, lostAtT } from "../src/world/climate.js";
import { applyWorldScale } from "../src/world/scale.js";
import * as manifest from "../src/game/manifest.js";
import * as story from "../src/game/story.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
applyWorldScale(config);
const storyData = JSON.parse(readFileSync(join(here, "../content/story.json"), "utf8"));
initClimate(config.climate);

let failures = 0, opened = 0, lastOnClose = null;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

function fresh() {
  const S = { t: 0, px: 0, pz: 0, knowTruth: false, log: [] };
  manifest.initManifest(config, storyData, { S, dawnX, tempAt, lostAtT });
  opened = 0; lastOnClose = null;
  story.initStory(config, storyData, {
    S, manifest,
    showPanel: (k, t, sub, b, extra, onClose) => { lastOnClose = onClose || null; },
    renderManifest: () => {}, esc: s => String(s), toast: () => {},
    openWorksheet: () => { opened++; },
    // wired exactly as main.js wires it: reading camp five is what puts the six
    // findings on the manifest, so the archive tests below see a real manifest
    grantSurvey: () => { manifest.grant(); }
  });
  return S;
}
const readAllGraves = () => story.GRAVES.forEach(g => story.readGrave(g));

// The record, straight out of story.json — all five deaths, wherever they are
// buried. Not an answer key: the fixture this test measures the code against.
const DEAD = { okonkwo: 9, demir: 17, raman: 24, ruiz: 31, vantaa: 41 };
const SURVIVOR = "lind";
// Only three of those five are buried in this crevice. The other two died while
// the Meridian was still travelling and are somewhere the player never goes.
const BURIED_HERE = ["raman", "ruiz", "vantaa"];
const ELSEWHERE = ["okonkwo", "demir"];

console.log("READING TELLS YOU NOTHING");
{
  const S = fresh();
  ok("no crew member starts with a fate", story.crew().every(c => !story.conclusionFor(c.id)));
  ok("nothing is locked before anything is read", story.lockedCount() === 0);
  ok("names and roles are known from the manifest",
     story.crew().every(c => c.n && c.r) && story.crew().length === 6);
  readAllGraves();
  story.CAMPS.forEach(c => story.readCamp(c));
  // the marker you land beside is the one exception, and it is deliberate (phase 3)
  const OPENING = config.deduction.openingGrave;
  ok("reading every grave and camp concludes nothing beyond the one you are given",
     story.lockedCount() === 1 && story.isLocked(storyData.graves[OPENING].crew),
     `${story.lockedCount()} locked`);
  ok("reading the shelter still concludes nothing",
     (story.readLast(), story.lockedCount() === 1));
  ok("reading files evidence instead: one entry per readable thing, with place and time",
     S.log.length === story.GRAVES.length + story.CAMPS.length + 1
     && S.log.every(e => typeof e.x === "number" && typeof e.h === "number"),
     `${S.log.length} entries`);
  ok("the code exports no reveal() any more", typeof story.reveal === "undefined");
}

console.log("\nTHE DATES ARE EARNED, NOT GIVEN");
{
  fresh();
  ok("no dates offered before any marker is read", story.fateOptions().length === 0);
  story.readGrave(story.GRAVES[0]);
  ok("one marker read offers exactly one date", story.fateOptions().length === 1);
  ok("and it is the date on that marker", story.fateOptions()[0].year === DEAD[story.GRAVES[0].who]);
  readAllGraves();
  ok("the markers that are here offer their three dates", story.fateOptions().length === 3,
     story.fateOptions().map(o => o.year).join(","));
  ok("three dates against six names is the contradiction, stated by the sheet itself",
     story.fateOptions().length === 3 && story.crew().length === 6);
}

console.log("\nCOMMITTING: ALL OR NOTHING, AND MUTE ABOUT WHICH");
{
  fresh(); readAllGraves();
  // the opening marker has already entered one row, so the sets below are the
  // player's own work
  // only conclusions this world can actually establish are used here
  story.setConclusion("lind", "survived");
  let r = story.commitConclusions();
  ok("one conclusion is refused", !r.ok && r.reason === "few");
  story.setConclusion("vantaa", "died:41");
  r = story.commitConclusions();
  ok("two are refused — no walking the answer out one at a time", !r.ok && r.reason === "few");
  ok("nothing new locked while refused", story.lockedCount() === 1);

  story.setConclusion("ruiz", "died:41");          // wrong: 41 is vantaa's year, ruiz is 31
  r = story.commitConclusions();
  ok("a set containing one error is rejected", !r.ok && r.reason === "wrong");
  ok("a rejected set locks NOTHING, including the ones that were right", story.lockedCount() === 1);
  ok("the rejection names no crew member and no field",
     !("who" in r) && !("wrong" in r) && !("id" in r) && Object.keys(r).join(",") === "ok,reason,have",
     Object.keys(r).join(","));

  story.setConclusion("ruiz", "died:31");
  r = story.commitConclusions();
  ok("the corrected set is accepted", r.ok && r.locked === 3);
  ok("accepted conclusions lock", ["lind", "vantaa", "ruiz"].every(id => story.isLocked(id)));
  ok("locked conclusions cannot be edited afterwards",
     (story.setConclusion("ruiz", "survived"), story.conclusionFor("ruiz").year === 31));
}

console.log("\nTHE POINT: LINDQVIST IS SOLVABLE BEFORE THE SHELTER");
{
  const S = fresh();
  readAllGraves();                       // five markers for six names
  ok("the shelter has not been found", !S.knowTruth && !story.LAST.read);
  story.setConclusion(SURVIVOR, "survived");
  for (const id of ["vantaa", "ruiz"]) story.setConclusion(id, "died:" + DEAD[id]);   // both buried here
  const r = story.commitConclusions();
  ok("a player who reasoned it from the graves alone is accepted", r.ok && r.locked >= 2);
  ok("Lindqvist's survival locks without ever entering the shelter",
     story.isLocked(SURVIVOR) && !S.knowTruth);
}

console.log("\nTHE FULL SIX, AND WHAT THE ENDING REPORTS");
{
  fresh(); readAllGraves();
  for (const [id, y] of Object.entries(DEAD)) story.setConclusion(id, "died:" + y);
  story.setConclusion(SURVIVOR, "survived");
  const r = story.commitConclusions();
  ok("the rest, correct at once, are accepted", r.ok && r.locked === 5);
  ok("the ending will report 6 of 6", story.lockedCount() === 6);
  ok("a wrong survivor is rejected even with the rest right",
     (fresh(), readAllGraves(),
      Object.entries(DEAD).forEach(([id, y]) => story.setConclusion(id, "died:" + y)),
      story.setConclusion(SURVIVOR, "died:41"),
      !story.commitConclusions().ok && story.lockedCount() === 1));
}

console.log("\nTHE SHELTER STILL READS AS WRITTEN");
{
  const S = fresh();
  story.readLast();
  ok("the confession is unchanged and still sets knowTruth",
     S.knowTruth === true && story.CONFESSION.b === storyData.shelter.confession.body);
  ok("but it hands over no conclusions", story.lockedCount() === 0);

  // ---- the opening hook -------------------------------------------------
  console.log("\n  the marker you land beside:");
  const S2 = fresh();
  const OPENING = config.deduction.openingGrave;
  const og = story.GRAVES.find(g => g.id === OPENING);
  const spawn = config.player.spawn;
  ok("the player lands inside its read radius",
     Math.hypot(og.x - spawn.x, og.z - spawn.z) <= og.r,
     `${Math.hypot(og.x - spawn.x, og.z - spawn.z).toFixed(1)} m vs radius ${og.r}`);
  ok("nothing is filled in before it is read", story.lockedCount() === 0);
  story.readGrave(og);
  ok("reading it fills exactly one row", story.lockedCount() === 1);
  ok("and it is the crew member on that plate",
     story.isLocked(og.who) && story.conclusionFor(og.who).year === DEAD[og.who]);
  ok("the opening marker is one that is actually buried here", BURIED_HERE.includes(og.who));
  ok("the other five are left blank",
     story.crew().filter(c => !story.conclusionFor(c.id)).length === 5);
  ok("closing the plate opens the sheet", typeof lastOnClose === "function" && (lastOnClose(), opened === 1));
  const other = story.GRAVES.find(g => g.id !== OPENING);
  story.readGrave(other);
  ok("no other marker fills anything in", story.lockedCount() === 1);
  ok("and no other marker opens the sheet", opened === 1);
}

// ---- WHAT THIS WORLD CAN ACTUALLY ESTABLISH ------------------------------
// Only camp five, three graves and the shelter are here. Two of the six died
// before the Meridian stopped moving and are buried off this map, so nothing the
// player can reach states the year either of them died. The worksheet must not
// offer dates there is no evidence for, so it does not — and that means those two
// cannot be completed until a reachable log carries the year. This test pins the
// gap rather than papering over it, and it will start failing the moment
// config.deduction.datesFromRecord is filled in, which is the intended signal.
console.log("\nWHAT IS ESTABLISHABLE HERE");
{
  const S = fresh();
  readAllGraves();
  story.CAMPS.forEach(c => story.readCamp(c));
  story.readLast();
  const offered = story.fateOptions().map(o => o.year);

  ok("everything readable in this world has been read",
     story.GRAVES.every(g => g.read) && story.CAMPS.every(c => c.read) && story.LAST.read);

  for (const id of BURIED_HERE)
    ok(`${id}: the plate is here, so the date is offered`, offered.includes(DEAD[id]),
       `offered ${offered.join(",")}`);
  ok(`${SURVIVOR}: 'outlived the others' is always offered, so the survivor is establishable`, true);
  for (const id of ELSEWHERE)
    ok(`${id}: NOT establishable — nothing reachable states year ${DEAD[id]}`, !offered.includes(DEAD[id]),
       "if this fails, either a date is being offered without evidence or the prose now carries it");

  ok("so four of the six can be completed, and two cannot",
     BURIED_HERE.length + 1 === 4 && ELSEWHERE.length === 2);

  // and the switch that closes the gap is present, documented and OFF
  ok("the switch to close that gap exists and is deliberately empty",
     Array.isArray(config.deduction.datesFromRecord) && config.deduction.datesFromRecord.length === 0,
     `datesFromRecord = ${JSON.stringify(config.deduction.datesFromRecord)}`);
}

console.log("\nTHE ARCHIVE MOVED TO THE SHELTER");
{
  const S = fresh();
  const before = manifest.list().filter(c => c.done).length;
  story.CAMPS.forEach(c => story.readCamp(c));
  const afterCamps = manifest.list().filter(c => c.by === "meridian").length;
  ok("camp five gives no finding of its own", afterCamps === 0, `${afterCamps} recovered at camps`);
  story.readLast();
  const recovered = manifest.list().filter(c => c.by === "meridian").map(c => c.id);
  ok("the shelter recovers the four findings of the camps that are elsewhere",
     recovered.length === 4, recovered.join(","));
  ok("and they are the four the record names",
     config.shelter.archive.every(([site]) => recovered.includes(site)),
     config.shelter.archive.map(a => a[0]).join(","));
}

if (failures) { console.error(`\ndeduction.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\ndeduction.test.js: all passed");
