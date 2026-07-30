// briefing.test.js — the opening as an ordered list of beats.
// Run: node test/briefing.test.js
//
// The briefing is now a sequence of screens defined in content/story.json, not three
// hard-coded steps, so the writer can add, cut, reorder or rewrite beats without
// touching a .js file. This drives the real machinery, screen by screen, against a
// DOM stub, and pins the four things that would break it:
//
//   * the LEGACY SHIM still produces a working opening from the step1/step2/step3
//     keys that are in story.json today, invents no text, and no longer prints the
//     orbital manifest listing — the manifest is not issued from orbit any more.
//   * an authored briefing.beats array takes over completely.
//   * beats can be REORDERED, including the naming beat, because the machinery
//     keys off a beat's kind and never off its index.
//   * an array with no naming beat WARNS and falls back, instead of leaving the
//     player on a briefing screen with no way into the game.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
const storyData = JSON.parse(readFileSync(join(here, "../content/story.json"), "utf8"));

let failures = 0;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

/* ---- the smallest DOM that panels.js will accept ------------------------- */
function makeDom() {
  const els = new Map();
  const mk = id => {
    const e = {
      id, style: {}, textContent: "", innerHTML: "", value: "", placeholder: "",
      dataset: {}, onclick: null, _listeners: {},
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      addEventListener(k, f) { (e._listeners[k] = e._listeners[k] || []).push(f); },
      focus() {}, querySelector: sel => mk(sel),
      // panels.js does bs.querySelectorAll("input") to wire Enter; give it the
      // inputs it just wrote into innerHTML
      querySelectorAll(sel) {
        if (sel !== "input") return [];
        return [...String(e.innerHTML).matchAll(/id="(i-[a-z])"/g)]
          .map(m => { const i = m[1]; if (!els.has(i)) els.set(i, mk(i)); return els.get(i); });
      }
    };
    return e;
  };
  return {
    getElementById: id => { if (!els.has(id)) els.set(id, mk(id)); return els.get(id); },
    querySelector: sel => { if (!els.has(sel)) els.set(sel, mk(sel)); return els.get(sel); },
    querySelectorAll: () => [], createElement: () => mk("created"), body: { appendChild() {} }
  };
}

// Each run needs a fresh copy of panels.js, because bstep is module state.
let runN = 0;
async function run(story) {
  globalThis.document = makeDom();
  const S = { name: "", ship: "", planet: "", started: false, log: [] };
  let audioStarted = 0;
  const panels = await import(`../src/ui/panels.js?run=${++runN}`);
  panels.initPanels(config, story, {
    S, manifest: { list: () => [], crit: () => null }, storyMod: {},
    toast: () => {}, esc: s => String(s), mmss: () => "0:00",
    renderManifest: () => {}, rand: () => 0.5, lostAtT: () => 1000,
    startAudio: () => audioStarted++
  });
  const sheet = () => document.getElementById("bsheet").innerHTML;
  const screens = [];
  for (let i = 0; i < 16; i++) {
    screens.push(sheet());
    if (/id="i-n"/.test(sheet())) {
      document.getElementById("i-n").value = "Wren";
      document.getElementById("i-s").value = "Petrel";
    }
    if (/id="i-p"/.test(sheet())) document.getElementById("i-p").value = "Ninepin";
    const b = document.getElementById("bnx");
    if (!b || !b.onclick) break;
    b.onclick();
    if (S.started) break;
  }
  return { screens, S, audioStarted };
}

/* ---- 1. the legacy shim: story.json exactly as it ships ------------------ */
console.log("THE LEGACY SHIM (no story.briefing.beats yet)");
{
  const r = await run(storyData);
  ok("five beats, not three", r.screens.length === 5, `${r.screens.length} screens`);
  ok("beat 1 is the commission: its title and both fields, and no prose of its own",
     /id="i-n"/.test(r.screens[0]) && /id="i-s"/.test(r.screens[0]) && !/Nine ships/.test(r.screens[0]));
  ok("beat 2 is the fleet, both paragraphs, still in the right order",
     /Nine ships/.test(r.screens[1]) && /gamble that has to work/.test(r.screens[1])
     && r.screens[1].indexOf("Nine ships") < r.screens[1].indexOf("gamble that has to work"));
  ok("beat 3 is the Meridian",
     /two hundred years ago/.test(r.screens[2]) && /camps run north/.test(r.screens[2]));
  // This used to assert the descent beat was an unwritten marker. It is written
  // now, so the assertion that matters is the opposite one: the beat carries real
  // prose and no marker is showing. The marker machinery is still tested below,
  // against a synthetic beat, so it cannot rot.
  ok("beat 4 is the descent, and it is written",
     /the ground splits/.test(r.screens[3]) && !/not written yet/.test(r.screens[3]));
  ok("no beat in the authored opening is an unwritten slot",
     !r.screens.some(s => /not written yet/.test(s)));
  ok("beat 5 is the naming beat", /id="i-p"/.test(r.screens[4]));
  // the whole point of phase 2: the manifest is not issued from orbit any more, so
  // nothing in the opening may claim it is
  ok("no screen lists the six findings or a countdown",
     !r.screens.some(s => /Bearings to all six|follows the herd|lost at |LOST IN/.test(s)));
  ok("the player's own names survive the sequence",
     r.S.name === "Wren" && r.S.ship === "Petrel" && r.S.planet === "Ninepin");
  ok("the game starts on the naming beat and not before", r.S.started === true);
  ok("the audio context is created inside that one gesture, exactly once", r.audioStarted === 1);
  ok("every screen is advanced by the player", r.screens.every(s => /id="bnx"/.test(s)));
  ok("every screen shows how far through the sequence it is",
     r.screens.every(s => (s.match(/border-radius:50%/g) || []).length === 5));
}

/* ---- 2. an authored beats array takes over ------------------------------- */
console.log("\nTHE UNWRITTEN MARKER (synthetic beat, so the machinery cannot rot)");
{
  const s2 = JSON.parse(JSON.stringify(storyData));
  s2.briefing.beats = [
    { id:"x", kind:"text", unwritten:true, button:"On" },
    { id:"n", kind:"naming", title:"T", placeholder:"p", defaultPlanetName:"D", button:"Go" }
  ];
  const r = await run(s2);
  ok("a beat flagged unwritten still shows the marker", /not written yet/.test(r.screens[0]));
}

console.log("\nAN AUTHORED story.briefing.beats");
{
  const s = JSON.parse(JSON.stringify(storyData));
  s.briefing.beats = [
    { kind: "commission", title: "T1", surveyorLabel: "A", vesselLabel: "B",
      defaultSurveyorName: "D1", defaultShipName: "D2", button: "one" },
    { kind: "text", title: "T2", body: ["fleet para"], button: "two" },
    { kind: "text", title: "T3", body: ["meridian para"], button: "three" },
    { kind: "text", title: "T4", subtitle: "the descent", body: ["still under power"], button: "four" },
    { kind: "naming", title: "T5", placeholder: "nm", hint: "h", defaultPlanetName: "D3", button: "five" }
  ];
  const r = await run(s);
  ok("the array drives the sequence", r.screens.length === 5, `${r.screens.length}`);
  ok("titles come from the array", ["T1", "T2", "T3", "T4", "T5"].every((t, i) => r.screens[i].includes(t)));
  ok("each beat's own button label is used",
     ["one", "two", "three", "four", "five"].every((b, i) => r.screens[i].includes(b)));
  ok("a beat with text shows no unwritten marker", !/not written yet/.test(r.screens[3]));
  ok("the step1/2/3 keys are ignored entirely once beats exists",
     !r.screens.some(x => /Nine ships|two hundred years ago/.test(x)));
  ok("the game still starts", r.S.started === true);
}

/* ---- 3. reordered, and a different number of beats ---------------------- */
console.log("\nREORDERED (commission third, six beats)");
{
  const s = JSON.parse(JSON.stringify(storyData));
  s.briefing.beats = [
    { kind: "text", title: "X1", body: ["first"], button: "a" },
    { kind: "text", title: "X2", body: ["second"], button: "b" },
    { kind: "commission", title: "X3", surveyorLabel: "A", vesselLabel: "B", button: "c" },
    { kind: "text", title: "X4", body: ["fourth"], button: "d" },
    { kind: "text", title: "X5", body: ["fifth"], button: "e" },
    { kind: "naming", title: "X6", placeholder: "p", button: "f" }
  ];
  const r = await run(s);
  ok("six screens in the authored order", r.screens.length === 6
     && ["X1", "X2", "X3", "X4", "X5", "X6"].every((t, i) => r.screens[i].includes(t)));
  ok("the commission works from the middle of the sequence",
     r.S.name === "Wren" && r.S.ship === "Petrel");
  ok("the naming beat ends the briefing wherever it sits", r.S.started === true);
  ok("the dots count the real number of beats",
     (r.screens[0].match(/border-radius:50%/g) || []).length === 6);
}

/* ---- 4. a beats array with no way out ----------------------------------- */
console.log("\nBROKEN (a beats array with no naming beat)");
{
  const s = JSON.parse(JSON.stringify(storyData));
  s.briefing.beats = [{ kind: "text", title: "Y1", body: ["only"], button: "a" }];
  const warns = [];
  const realWarn = console.warn;
  console.warn = m => warns.push(String(m));
  const r = await run(s);
  console.warn = realWarn;
  ok("it warns instead of hanging", warns.some(w => /naming/.test(w)), warns.join(" | "));
  ok("and appends the legacy naming screen so the game can still be reached",
     r.S.started === true, `started=${r.S.started} after ${r.screens.length} screens`);
}

/* ---- 5. the protected block is still protected -------------------------- */
console.log("\nTHE FLEET TRANSMISSION");
{
  const ft = storyData.fleetTransmission;
  ok("it still carries its placeholder marker", typeof ft.marker === "string" && ft.marker.length > 0);
  const src = readFileSync(join(here, "../src/ui/panels.js"), "utf8");
  ok("panels.js still renders that marker verbatim rather than dropping it",
     /ft\.marker/.test(src));
  ok("it is still fired on a delay from config, not from a beat",
     /config\.timing\.fleetTransmissionDelayMs/.test(src)
     && typeof config.timing.fleetTransmissionDelayMs === "number");
}

if (failures) { console.error(`\nbriefing.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nbriefing.test.js: all passed");
// Reaching the naming beat arms the real fleet-transmission timer, which is two
// minutes long and would hold the event loop open that whole time. Nothing is
// pending that matters, so say so out loud rather than letting the run look hung.
process.exit(0);
