// mobile.test.js — the phone profile. Run: node test/mobile.test.js
//
// The property that matters: a phone and a desktop must walk the SAME canyon.
// Every mobile reduction is render-only — applied after generation — so the seeded
// world is byte-identical and only the number of things drawn changes. Reducing
// grass.maxBlades or striders.count in config instead would shift the PRNG stream
// and put the rocks somewhere else on phones.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
const src = f => readFileSync(join(here, "../src/", f), "utf8");

let failures = 0;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

console.log("THE PHONE PROFILE IS RENDER-ONLY");
{
  const m = config.mobile;
  ok("a mobile block exists", !!m);
  for (const k of ["maxPixelRatio", "grassMultiplier", "striderMultiplier", "dustMultiplier",
                   "textureScale", "shadowMapSize", "stick", "lookSensitivity"])
    ok(`mobile.${k} is tunable from config`, m[k] !== undefined);
  ok("the device pixel ratio is capped hard", m.maxPixelRatio <= 2, `${m.maxPixelRatio}`);
  ok("every quality multiplier actually reduces something",
     m.grassMultiplier < 1 && m.striderMultiplier < 1 && m.dustMultiplier < 1 && m.textureScale < 1);

  // the reductions must NOT touch anything the generator reads
  const main = src("main.js");
  const mobileBlock = main.slice(main.indexOf("if (onMobile) {", main.indexOf("after every build")));
  ok("mobile reduction happens after the world is built",
     main.indexOf("sky.buildGlare()") < main.indexOf("grass.applyDowngrade(m.grassMultiplier)"));
  for (const bad of ["maxBlades", "striders.count", "dustCount", "noiseSeed", "denCount"])
    ok(`the mobile path never rewrites ${bad}`, !new RegExp(`${bad.replace(".", "\\\\.")}\\\\s*=`).test(mobileBlock));
}

console.log("\nONE CODE PATH FOR MOUSE, TOUCH AND STYLUS");
{
  const t = src("ui/touch.js"), c = src("player/controller.js");
  ok("touch uses Pointer Events, not touch events, for input",
     /pointerdown/.test(t) && /pointermove/.test(t) && !/addEventListener\("touchstart"/.test(t));
  ok("touchmove is prevented so the page cannot scroll or rubber-band",
     /touchmove[\s\S]{0,200}preventDefault/.test(t));
  ok("but overlays are exempted so the logbook still scrolls",
     /overlay\.on[\s\S]{0,120}return/.test(t));
  ok("the keyboard bindings are untouched",
     /keys\.w\|\|keys\.arrowup/.test(c) && /keys\.shift/.test(c));
  ok("the stick can sprint without a shift key", /sprintAt/.test(t) && /stick\.sprint/.test(c));
  ok("look is one shared function for both input paths",
     /export function applyLook/.test(c) && /controller\.applyLook/.test(t));
  ok("the stick has a dead zone", /deadZone/.test(t) && config.mobile.stick.deadZone > 0);
  ok("sprint is a push past most of the travel",
     config.mobile.stick.sprintAt > 0.5 && config.mobile.stick.sprintAt < 1);
}

console.log("\nTHE LAYOUT CAN SURVIVE A SMALL SCREEN");
{
  const html = readFileSync(join(here, "../index.html"), "utf8");
  ok("no HUD panel is a fixed pixel width any more",
     !/#task\{[^}]*width:268px/.test(html) && !/#top\{[^}]*width:430px/.test(html));
  ok("the manifest panel is viewport-relative", /#task\{[^}]*min\(268px,42vw\)/.test(html));
  ok("the compass strip is viewport-relative", /#top\{[^}]*min\(430px,72vw\)/.test(html));
  ok("there is a small-screen breakpoint", /@media \(max-width:820px\)/.test(html));
  ok("there is a short-screen breakpoint for landscape phones", /@media \(max-height:460px\)/.test(html));
  ok("overlays scroll", /\.overlay\{[^}]*overflow-y:auto/.test(html) && /\.sheet\{[^}]*overflow-y:auto/.test(html));
  ok("overlays are exempt from the global touch-action lock", /\.sheet,\.overlay\{touch-action:auto\}/.test(html));
  ok("the page cannot bounce", /overscroll-behavior:none/.test(html));
  ok("portrait is caught and the player is asked to rotate",
     /@media \(orientation:portrait\)/.test(html) && /id="rotate"/.test(html));
  ok("the touch controls exist and are hidden by default",
     /id="touch-surface"/.test(html) && /#touch\{[^}]*display:none/.test(html));
  ok("the buttons are large enough to hit", /\.tb[^}]*width:60px;height:60px/.test(html));
  ok("the context button is the biggest one", /#btn-act\{width:76px/.test(html));
}

console.log("\nAUDIO STILL UNLOCKS FROM A TAP (iOS needs a real gesture)");
{
  // The briefing is a list of beats now, and leaving it goes through startGame().
  // The property has not changed: the audio context must be created in the SAME
  // CALL STACK as the tap, so nothing between the click handler and startAudio()
  // may await or defer. briefing.test.js separately drives a real click and counts
  // the call; this checks the shape that makes that possible.
  const p = src("ui/panels.js");
  const start = p.slice(p.indexOf("function startGame()"));
  ok("leaving the briefing goes through startGame()", p.includes("function startGame()"));
  ok("startAudio is called synchronously inside it, before the game is marked started",
     start.indexOf("startAudio()") >= 0 && start.indexOf("startAudio()") < start.indexOf("S.started = true"),
     "must be in the same call stack as the gesture");
  const naming = p.slice(p.indexOf('beat.kind === "naming"'));
  const go = naming.slice(naming.indexOf("const go = () =>"), naming.indexOf("document.getElementById(\"bnx\").onclick = go"));
  ok("and the naming beat's handler calls it without deferring",
     /startGame\(\)/.test(go) && !/await|setTimeout|requestAnimationFrame|Promise/.test(go), go.trim());
  ok("the handler is a click handler, which a tap fires", /bnx"\)\.onclick = go/.test(p));
  ok("the audio module was not modified for this",
     /createAudioContext|unlock|touchstart/.test(src("world/sound.js")) === false);
}

if (failures) { console.error(`\nmobile.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nmobile.test.js: all passed");
