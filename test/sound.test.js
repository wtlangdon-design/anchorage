// sound.test.js — the soundfield. No browser, no AudioContext, no speakers.
//
// TWO THINGS ARE BEING PROTECTED HERE, and they are different in kind.
//
// The first is the ashwaiter silence, which is the oldest mechanic in the game and
// the one the jungle makes more valuable rather than less: near a den the world
// does not get a warning sound, it goes actually silent. That is implemented as ONE
// gain node that everything audible passes through, so it survives only as long as
// nobody hangs a new bed off `master` instead of `duck`. Three beds were added in
// the jungle pass. This scans the module and fails if any of them bypassed the
// duck, if `master` gained a second input, or if the null curve stopped driving it.
//
// The second is that the levels are TRUE — that what you hear agrees with what the
// world is. growthAt and wetnessAt are pure and testable, so they are tested: the
// insects must be silent ahead of the growth and silent in the burn, and the water
// must be audible only where the ponds are actually placed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX } from "../src/world/climate.js";
import { initNoise, fbm } from "../src/world/noise.js";
import * as terrain from "../src/world/terrain.js";
import * as jungle from "../src/world/jungle.js";

const here = dirname(fileURLToPath(import.meta.url));
const R = join(here, "..");
const config = JSON.parse(readFileSync(join(R, "content/config.json"), "utf8"));
const sound = readFileSync(join(R, "src/world/sound.js"), "utf8");
const compass = readFileSync(join(R, "src/ui/compass.js"), "utf8");

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) { failures++; console.error("  FAIL:", name, detail ? ":: " + detail : ""); }
  else console.log("  ok:", name);
};

initClimate(config.climate);
initNoise(config.terrain.noiseSeed);
terrain.initTerrain(config, {}, { THREE: {}, scene: { add(){} }, rand: () => 0.5, fbm });
jungle.initJungle(config, {}, {
  THREE: {}, scene: { add(){} }, rand: () => 0.5,
  fbm, heightAt: terrain.heightAt, pathPlan: terrain.pathPlan,
});
terrain.setCanopySource(jungle.canopyAt);
const segs = terrain.pathSegments();
const X0 = segs[0].x0, X1 = segs[segs.length - 1].x1;

/* ---- 1. the null still owns everything ----------------------------------- */
console.log("THE ASHWAITER SILENCE (one duck, and everything goes through it)");
{
  // every gain node that carries a bed, found in the source rather than listed here,
  // so a bed added tomorrow is caught too
  const beds = [...sound.matchAll(/(\w+Gain)\s*=\s*ctx\.createGain\(\)/g)].map(m => m[1])
    .filter(n => n !== "master" && n !== "duck");
  console.log(`  beds found in the module: ${beds.join(", ")}`);
  ok("there is more than one bed — a jungle is not one noise", beds.length >= 4, `${beds.length}`);
  for (const b of beds) {
    // either straight into the duck, or into a node that goes into the duck (the
    // herd goes through its panner first)
    const direct = new RegExp(`${b}\\.connect\\(duck\\)`).test(sound);
    const viaPan = b === "herdGain" && /herdPan\.connect\(duck\)/.test(sound);
    ok(`${b} passes through the duck`, direct || viaPan);
  }
  const toMaster = [...sound.matchAll(/(\w+)\.connect\(master\)/g)].map(m => m[1]);
  ok("the duck is the ONLY thing connected to master", toMaster.length === 1 && toMaster[0] === "duck",
     toMaster.join(", "));
  ok("the duck is still driven by the null out of S", /S\.null_/.test(sound) && /duck\.gain\.value = sm\.duck/.test(sound));
  ok("and still through the null curve, so it bites early", /Math\.pow\(1 - nul, A\.null\.curve\)/.test(sound));
  ok("full null is exact zero, not a quiet mix",
     Math.pow(1 - 1, config.audio.null.curve) === 0);
  ok("the mute path is untouched and separate from the duck",
     /master\.gain\.value = A\.masterGain \* sm\.mute/.test(sound));
  // and the strip's own bars must die with it
  ok("the soundfield strip's bars are multiplied by amb, so the null flattens them",
     /\* amb;/.test(compass) && /const amb = 1 - nul/.test(compass));
}

/* ---- 2. the module still allocates nothing per frame ---------------------- */
console.log("\nNO PER-FRAME ALLOCATION (the beds are built once)");
{
  const body = sound.slice(sound.indexOf("export function updateAudio"),
                           sound.indexOf("function footfall"));
  ok("updateAudio creates no audio nodes", !/ctx\.create/.test(body));
  ok("it only assigns to already-built nodes",
     /Gain\.gain\.value =/.test(body) && !/new \w+\(/.test(body));
  ok("Math.random() is never drawn from inside the frame loop", !/Math\.random/.test(body));
  ok("and the seeded world generator is never touched here", !/\brand\(/.test(sound));
}

/* ---- 3. every bed is tunable from config --------------------------------- */
console.log("\nEVERY BED IS TUNABLE FROM content/config.json");
{
  const A = config.audio;
  for (const bed of ["wind", "insects", "water", "herd", "foot", "null"])
    ok(`audio.${bed} exists`, !!A[bed]);
  ok("every bed has a note the writer can read", ["wind", "insects", "water", "herd", "foot", "null"]
     .every(b => typeof A[b]._note === "string" && A[b]._note.length > 40));
  for (const bed of ["insects", "water"])
    ok(`audio.smoothing.${bed} exists, so the new beds cannot snap`, typeof A.smoothing[bed] === "number");
  // no magic numbers: the mix reads its levels out of A, never out of a literal
  const mix = sound.slice(sound.indexOf("--- wind:"), sound.indexOf("--- footfalls"));
  const literals = [...mix.matchAll(/[-+*/(]\s*(\d+\.?\d*)\s*[)*+\-;,]/g)]
    .map(m => parseFloat(m[1])).filter(v => v !== 0 && v !== 1 && v !== 0.5 && v !== 6.28318 &&
                                            v !== 30 && v !== 40 && v !== 80 && v !== 0.4 && v !== 0.6);
  ok("no tunable number is hard-coded into the mix", literals.length === 0, literals.join(", "));
}

/* ---- 4. the insects tell the truth about the day ------------------------- */
console.log("\nTHE INSECTS ARE THE ONE DAY (silent ahead of the growth, out in the burn)");
{
  const J = config.jungle;
  // "ahead of the growth" is now measured off growthRise, not off a guess: the
  // growth front runs a kilometre in front of the dawn line, because that is the
  // band the player actually walks in.
  const ahead = jungle.growthAt(0, J.growthRise - 200);
  const atLine = jungle.growthAt(0, 0);
  const full = jungle.growthAt(0, J.growthFull);
  const browning = jungle.growthAt(0, (J.growthFull + J.growthBurn) / 2);
  const burnt = jungle.growthAt(0, J.growthBurn + 200);
  console.log(`  ${-J.growthRise + 200} m ahead of the dawn line       : ${ahead.toFixed(3)}`);
  console.log(`  at the line                         : ${atLine.toFixed(3)}`);
  console.log(`  ${J.growthFull} m behind it (full growth)        : ${full.toFixed(3)}`);
  console.log(`  browning                            : ${browning.toFixed(3)}`);
  console.log(`  in the burn                         : ${burnt.toFixed(3)}`);
  ok("nothing is alive ahead of the growth front", ahead === 0);
  ok("and the growth front runs well ahead of the dawn line, where the player is",
     J.growthRise <= -400, `growthRise ${J.growthRise}`);
  ok("it is fully up by the time the dawn line has passed", atLine > 0.9 && full > 0.9);
  ok("it is dying, not dead, while it browns", browning > 0.05 && browning < 0.8);
  ok("nothing is alive in the burn", burnt === 0);
  ok("so the insect bed is silent at both ends of the day",
     config.audio.insects.gain * Math.pow(ahead, config.audio.insects.curve) === 0 &&
     config.audio.insects.gain * Math.pow(burnt, config.audio.insects.curve) === 0);
  // AND IT MUST ACTUALLY VARY WHERE THE PLAYER STANDS. This is the check that
  // caught the staging being mis-centred: growthRise was -90, and because the
  // lethal edge trails the dawn line by ~550 m the player is never within 90 m of
  // that line, so every plant in the world sat at growthMinScale and the insects
  // were silent from the first step to the last. The band has to be measured
  // against the player's real range, not against the dawn line in the abstract.
  //  1.48 m/s is a walker who takes their findings; 4.2 is one who stops for
  // nothing. Both have to hear a world that changes.
  for (const [label, v] of [["surveying walker", 1.48], ["nonstop walker", config.player.walkSpeed]]) {
    let lo = 1, hi = 0;
    for (let t = 0; t <= 800; t += 20) {
      const px = -500 + v * t;
      if (px > X1) break;
      const g = jungle.growthAt(px, dawnX(t));
      lo = Math.min(lo, g); hi = Math.max(hi, g);
    }
    console.log(`  ${label.padEnd(17)}: insect level runs ${lo.toFixed(2)} to ${hi.toFixed(2)}`);
    ok(`the world changes around a ${label}`, hi - lo > 0.25, `${lo.toFixed(2)}..${hi.toFixed(2)}`);
    ok(`and a ${label} is never stuck in bare stubble`, hi > 0.5, `peak ${hi.toFixed(2)}`);
  }
}

/* ---- 5. the water is where the water is ---------------------------------- */
console.log("\nTHE WATER IS WHERE THE PONDS ARE");
{
  let wetPts = 0, tot = 0, maxWet = 0, dryButWet = 0;
  for (let x = X0 + 20; x <= X1 - 20; x += 7) {
    const p = terrain.pathPlan(x);
    for (let f = -0.9; f <= 0.9; f += 0.3) {
      const z = p.centre + f * p.halfWidth;
      const w = jungle.wetnessAt(x, z);
      tot++; if (w > 0.05) wetPts++;
      maxWet = Math.max(maxWet, w);
      // the placement test the water layer actually uses
      const isPond = terrain.heightAt(x, z) < p.floor - config.jungle.water.pondBelow;
      if (!isPond && w > 0) dryButWet++;
    }
  }
  console.log(`  ${(100 * wetPts / tot).toFixed(1)}% of ${tot} trail points are audibly wet, deepest ${maxWet.toFixed(2)}`);
  ok("water is audible somewhere on the trail", wetPts > 0);
  ok("but it is not everywhere — it is standing water, not a flood", wetPts / tot < 0.6,
     `${(100 * wetPts / tot).toFixed(0)}%`);
  ok("it never sounds wet where a pond would not be placed", dryButWet === 0, `${dryButWet} points`);
  ok("wetness is bounded 0..1", maxWet <= 1);
}

/* ---- 6. the herd is ahead, and how far is audible ------------------------ */
console.log("\nTHE HERD IS AHEAD OF YOU ON THE TRAIL");
{
  const BO = config.striders.bandOffset;
  console.log(`  striders.bandOffset = ${BO} m — positive is AHEAD of the dawn line`);
  ok("the herd walks ahead of the dawn line, not inside the burn", BO > 0, `${BO}`);
  // a walker who stops to survey: the herd overtakes them and then leads
  const W = config.player.walkSpeed, grant = -500;
  let ahead = 0, tot = 0;
  for (let t = 0; t <= 700; t += 5) {
    // 1.48 m/s is the measured effective pace of a walker who takes their findings
    // (test/balance.js: 1730 m of main line plus 900 m of detour and 544 s of survey)
    const px = grant + 1.48 * t;
    if (px > X1) break;
    tot++; if (dawnX(t) + BO > px) ahead++;
  }
  console.log(`  a surveying walker has them ahead for ${(100 * ahead / tot).toFixed(0)}% of the run`);
  ok("they are ahead for most of the journey", ahead / tot > 0.6, `${(100 * ahead / tot).toFixed(0)}%`);
  ok("the mix reads ahead-or-behind from the world, not from the camera",
     /field\.herdAhead = hx >= S\.px/.test(compass) && /field\.herdAhead === false/.test(sound));
  ok("distance is carried in three cues, not one",
     /lowpassSpreadHz \* amp/.test(sound) && /pulseFrom/.test(sound) && /Math\.pow\(amp, H\.curve\)/.test(sound));
  ok("turning your head pans them but does not move them",
     /sm\.pan = approach\(sm\.pan, Math\.sin\(dd\)/.test(sound));
}

/* ---- 7. the strip and the ears share one truth --------------------------- */
console.log("\nONE SOURCE OF TRUTH FOR THE STRIP AND THE EARS");
{
  ok("compass.drawSound writes the three jungle levels into the field",
     /field\.canopy =/.test(compass) && /field\.growth =/.test(compass) && /field\.wet =/.test(compass));
  ok("world/sound.js reads them out of the field rather than recomputing",
     /field \? clamp01\(field\.canopy\)/.test(sound) &&
     /field \? clamp01\(field\.growth\)/.test(sound) &&
     /field \? clamp01\(field\.wet\)/.test(sound));
  ok("sound.js never imports the jungle — it only ever hears what the strip drew",
     !/from ["'].*jungle/.test(sound) && !/canopyAt|growthAt|wetnessAt/.test(sound));
  ok("the bars are driven by those levels, not by a fixed shimmer",
     /config\.compass\.bedInsects \* field\.growth/.test(compass));
  ok("and the bed weights are in config", ["bedFloor", "bedCanopy", "bedInsects", "bedWater"]
     .every(k => typeof config.compass[k] === "number"));
}

console.log(failures ? `\nsound.test.js: ${failures} FAILURE(S)` : "\nsound.test.js: all passed");
process.exit(failures ? 1 : 0);
