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

let failures = 0;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

function fresh() {
  const S = { t: 0, px: 0, pz: 0, knowTruth: false, log: [] };
  manifest.initManifest(config, storyData, { S, dawnX, tempAt, lostAtT });
  story.initStory(config, storyData, {
    S, manifest, showPanel: () => {}, renderManifest: () => {}, esc: s => String(s), toast: () => {}
  });
  return S;
}
const readAllGraves = () => story.GRAVES.forEach(g => story.readGrave(g));

// The five markers, straight out of story.json. Not an answer key — the fixture
// this test measures the code against.
const DEAD = { okonkwo: 9, demir: 17, raman: 24, ruiz: 31, vantaa: 41 };
const SURVIVOR = "lind";

console.log("READING TELLS YOU NOTHING");
{
  const S = fresh();
  ok("no crew member starts with a fate", story.crew().every(c => !story.conclusionFor(c.id)));
  ok("names and roles are known from the manifest",
     story.crew().every(c => c.n && c.r) && story.crew().length === 6);
  readAllGraves();
  story.CAMPS.forEach(c => story.readCamp(c));
  ok("reading every grave and camp still concludes nothing",
     story.crew().every(c => !story.conclusionFor(c.id)) && story.lockedCount() === 0);
  ok("reading the shelter still concludes nothing",
     (story.readLast(), story.crew().every(c => !story.conclusionFor(c.id)) && story.lockedCount() === 0));
  ok("reading files evidence instead: 11 entries with place and time",
     S.log.length === 11 && S.log.every(e => typeof e.x === "number" && typeof e.h === "number"),
     `${S.log.length} entries`);
  ok("the code exports no reveal() any more", typeof story.reveal === "undefined");
}

console.log("\nTHE DATES ARE EARNED, NOT GIVEN");
{
  fresh();
  ok("no dates offered before any marker is read", story.fateOptions().length === 0);
  story.readGrave(story.GRAVES[0]);
  ok("one marker read offers exactly one date", story.fateOptions().length === 1);
  ok("and it is the date on that marker", story.fateOptions()[0].year === 9);
  readAllGraves();
  ok("all five markers offer five dates", story.fateOptions().length === 5,
     story.fateOptions().map(o => o.year).join(","));
  ok("five dates against six names is the contradiction, stated by the sheet itself",
     story.fateOptions().length === 5 && story.crew().length === 6);
}

console.log("\nCOMMITTING: ALL OR NOTHING, AND MUTE ABOUT WHICH");
{
  fresh(); readAllGraves();
  story.setConclusion("okonkwo", "died:9");
  let r = story.commitConclusions();
  ok("one conclusion is refused", !r.ok && r.reason === "few");
  story.setConclusion("demir", "died:17");
  r = story.commitConclusions();
  ok("two are refused — no walking the answer out one at a time", !r.ok && r.reason === "few");
  ok("nothing locked while refused", story.lockedCount() === 0);

  story.setConclusion("raman", "died:31");         // wrong: raman is 24
  r = story.commitConclusions();
  ok("a set containing one error is rejected", !r.ok && r.reason === "wrong");
  ok("a rejected set locks NOTHING, including the two that were right", story.lockedCount() === 0);
  ok("the rejection names no crew member and no field",
     !("who" in r) && !("wrong" in r) && !("id" in r) && Object.keys(r).join(",") === "ok,reason,have",
     Object.keys(r).join(","));

  story.setConclusion("raman", "died:24");
  r = story.commitConclusions();
  ok("the corrected set is accepted", r.ok && r.locked === 3);
  ok("accepted conclusions lock", ["okonkwo", "demir", "raman"].every(id => story.isLocked(id)));
  ok("locked conclusions cannot be edited afterwards",
     (story.setConclusion("okonkwo", "survived"), story.conclusionFor("okonkwo").year === 9));
}

console.log("\nTHE POINT: LINDQVIST IS SOLVABLE BEFORE THE SHELTER");
{
  const S = fresh();
  readAllGraves();                       // five markers for six names
  ok("the shelter has not been found", !S.knowTruth && !story.LAST.read);
  story.setConclusion(SURVIVOR, "survived");
  for (const id of ["vantaa", "ruiz"]) story.setConclusion(id, "died:" + DEAD[id]);
  const r = story.commitConclusions();
  ok("a player who reasoned it from the graves alone is accepted", r.ok && r.locked === 3);
  ok("Lindqvist's survival locks without ever entering the shelter",
     story.isLocked(SURVIVOR) && !S.knowTruth);
}

console.log("\nTHE FULL SIX, AND WHAT THE ENDING REPORTS");
{
  fresh(); readAllGraves();
  for (const [id, y] of Object.entries(DEAD)) story.setConclusion(id, "died:" + y);
  story.setConclusion(SURVIVOR, "survived");
  const r = story.commitConclusions();
  ok("all six correct at once is accepted", r.ok && r.locked === 6);
  ok("the ending will report 6 of 6", story.lockedCount() === 6);
  ok("a wrong survivor is rejected even with five right",
     (fresh(), readAllGraves(),
      Object.entries(DEAD).forEach(([id, y]) => story.setConclusion(id, "died:" + y)),
      story.setConclusion(SURVIVOR, "died:41"),
      !story.commitConclusions().ok && story.lockedCount() === 0));
}

console.log("\nTHE SHELTER STILL READS AS WRITTEN");
{
  const S = fresh();
  story.readLast();
  ok("the confession is unchanged and still sets knowTruth",
     S.knowTruth === true && story.CONFESSION.b === storyData.shelter.confession.body);
  ok("but it hands over no conclusions", story.lockedCount() === 0);
}

if (failures) { console.error(`\ndeduction.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\ndeduction.test.js: all passed");
