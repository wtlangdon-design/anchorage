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
// `granted` defaults to true because most of the tests below are about what the
// manifest does once the player HAS it; the earned-manifest tests pass false.
function fresh(granted = true) {
  const S = { t: 0, animT: 0, px: 0, pz: 0, knowTruth: false, log: [] };
  const grants = [];
  manifest.initManifest(config, storyData, { S, dawnX, tempAt, lostAtT });
  story.initStory(config, storyData, {
    S, manifest,
    showPanel: () => {}, renderManifest: () => {}, esc: (s) => String(s), toast: () => {},
    grantSurvey: cp => { grants.push(cp.id); manifest.grant(); }
  });
  if (granted) manifest.grant();
  S.grants = grants;
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
//    name survives. The archive moved to the shelter when camps one to four left
//    this world, so the shelter is what hands the findings over now.
{
  const S = fresh();
  manifest.complete("soil", "you", "Long Ash");           // player surveys and names it
  story.readLast();                                        // then finds the relay archive
  const soil = manifest.crit("soil");
  ok("player's authorship survives the gift", soil.by === "you");
  ok("player-given name survives the gift", soil.name === "Long Ash", `got ${soil.name}`);
}

// 3. A Meridian gift DOES answer a criterion the player has not reached.
{
  const S = fresh();
  ok("soil starts unanswered", manifest.crit("soil").done === false);
  story.readLast();
  const soil = manifest.crit("soil");
  ok("the archive completes an unreached criterion", soil.done === true && soil.by === "meridian");
}

// 4. Player-given names persist into the end-state payload (state() snapshot).
{
  const S = fresh();
  manifest.complete("water", "you", "Kettle");
  story.readLast();                                    // the archive also carries water
  const row = manifest.state().find(r => r.id === "water");
  ok("named finding is intact in the end-state payload", row.name === "Kettle" && row.by === "you");
}

// 5. THE MANIFEST IS EARNED. On landing there is nothing on it: the six findings
//    are Vantaa's and the only copy is in her last entry. Every display in the game
//    reads list(), so an empty list() is what makes the hud, the compass, the chart
//    and the ending summary all go quiet together.
{
  const S = fresh(false);
  ok("the manifest is not granted on landing", manifest.isGranted() === false);
  ok("nothing is on it", manifest.list().length === 0, `${manifest.list().length} rows`);
  ok("but the six findings exist in the record", manifest.all().length === 6);
  const soil = config.sites.soil;
  S.px = soil.x; S.pz = soil.z;
  ok("you cannot survey a site you have not been told to look for",
     manifest.targetCrit() === null, `got ${manifest.targetCrit()?.id}`);
  S.t = 5000;
  manifest.updateLost();
  ok("and nothing can be lost while the manifest does not exist",
     manifest.all().every(c => !c.lost));
}

// 6. Exactly ONE bearing is available before the grant, and it is the camp that
//    carries the handover. The compass draws manifest.list() plus the unread camps,
//    so this is the whole content of the compass at that moment.
{
  fresh(false);
  const unread = story.CAMPS.filter(c => !c.read);
  ok("exactly one camp bearing is on offer", unread.length === 1, `${unread.length}`);
  ok("and it is the one that grants the survey", unread[0] && unread[0].grants === true);
  ok("the shelter is not a camp and carries no bearing of its own",
     story.LAST && story.LAST.read === false);
  ok("no grave is ever on the compass — the compass only draws sites and camps",
     story.GRAVES.length > 0);
}

// 7. Reading that camp is what hands the survey over.
{
  const S = fresh(false);
  const camp = story.CAMPS.find(c => c.grants);
  ok("still no manifest right up to the moment it is read", manifest.list().length === 0);
  story.readCamp(camp);
  ok("readCamp fired the handover", S.grants.length === 1 && S.grants[0] === camp.id);
  ok("the six findings are now on the manifest", manifest.list().length === 6);
  ok("granting is idempotent", manifest.grant() === false);
  S.t = 0;
  const soil = config.sites.soil;
  S.px = soil.x; S.pz = soil.z;
  ok("and now they can be surveyed", manifest.targetCrit()?.id === "soil");
}

// 8. Every deadline is measured from the grant, so it has to be reachable FROM the
//    granting camp — not from spawn. balance.js asserts the full search; this pins
//    the premise that the search now starts in the right place.
{
  const grantCamp = Object.keys(config.camps).filter(k => !k.startsWith("_"))
    .map(k => config.camps[k]).find(c => c.grantsSurvey);
  ok("exactly one camp grants the survey",
     Object.keys(config.camps).filter(k => !k.startsWith("_"))
       .filter(k => config.camps[k].grantsSurvey).length === 1);
  const sprint = config.player.sprintSpeed;
  const unreachable = Object.keys(config.sites).filter(k => !k.startsWith("_")).filter(id => {
    const s = config.sites[id];
    if (s.followsBand) return false;
    const d = Math.hypot(s.x - grantCamp.x, s.z - grantCamp.z);
    return d / sprint + s.duration > lostAtT(s.x, 0);
  });
  ok("every finding is still reachable from where the clock starts", unreachable.length === 0,
     unreachable.join(", "));
}

if (failures) { console.error(`\nmanifest.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nmanifest.test.js: all passed");
