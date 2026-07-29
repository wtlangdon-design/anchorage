// manifest.test.js — the survey manifest + Meridian gift interaction.
// Run: node test/manifest.test.js
// Catches the two bugs that actually happened: a site being surveyable after it
// was lost, and a Meridian archive gift overwriting the player's own finding (and
// with it, the player-given name that has to survive into the ending).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, tempAt, lostAtT } from "../src/world/climate.js";
import { applyWorldScale } from "../src/world/scale.js";
import * as manifest from "../src/game/manifest.js";
import * as story from "../src/game/story.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
applyWorldScale(config);   // measure the world as it ships
const storyData = JSON.parse(readFileSync(join(here, "../content/story.json"), "utf8"));
initClimate(config.climate);

let failures = 0;
function ok(name, cond, detail = "") { if (!cond) { failures++; console.error("  FAIL:", name, detail); } else console.log("  ok:", name); }

// Fresh game state + wiring. story renders through injected no-op ui functions.
function fresh() {
  const S = { t: 0, px: 0, pz: 0, knowTruth: false, log: [] };
  manifest.initManifest(config, storyData, { S, dawnX, tempAt, lostAtT });
  story.initStory(config, storyData, {
    S, manifest,
    showPanel: () => {}, renderManifest: () => {}, esc: (s) => String(s), toast: () => {}
  });
  return S;
}

// 1. A site cannot be surveyed after it is lost.
{
  const S = fresh();
  const soil = config.sites.soil;
  S.px = soil.x; S.pz = soil.z;               // stand exactly on it
  S.t = 0;
  ok("site is targetable before it is lost", manifest.targetCrit()?.id === "soil");
  S.t = 5000;                                  // long after the dawn line has passed it
  manifest.updateLost();
  ok("site is marked lost once its ground passes LETHAL", manifest.crit("soil").lost === true);
  ok("a lost site is not targetable even while standing on it", manifest.targetCrit() === null,
     `got ${manifest.targetCrit()?.id}`);
}

// 2. A Meridian gift never overwrites a player's own finding — and the player-given
//    name survives. (Camp c1 gives "soil".)
{
  const S = fresh();
  manifest.complete("soil", "you", "Long Ash");           // player surveys and names it
  const camp = story.CAMPS.find(c => c.id === "c1");
  story.readCamp(camp);                                    // then reads the camp that offers soil
  const soil = manifest.crit("soil");
  ok("player's authorship survives the gift", soil.by === "you");
  ok("player-given name survives the gift", soil.name === "Long Ash", `got ${soil.name}`);
}

// 3. A Meridian gift DOES answer a criterion the player has not reached.
{
  const S = fresh();
  ok("soil starts unanswered", manifest.crit("soil").done === false);
  const camp = story.CAMPS.find(c => c.id === "c1");
  story.readCamp(camp);
  const soil = manifest.crit("soil");
  ok("gift completes an unreached criterion", soil.done === true && soil.by === "meridian");
}

// 4. Player-given names persist into the end-state payload (state() snapshot).
{
  const S = fresh();
  manifest.complete("water", "you", "Kettle");
  story.readCamp(story.CAMPS.find(c => c.id === "c2")); // c2 gives "season", unrelated to water
  const row = manifest.state().find(r => r.id === "water");
  ok("named finding is intact in the end-state payload", row.name === "Kettle" && row.by === "you");
}

if (failures) { console.error(`\nmanifest.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nmanifest.test.js: all passed");
