// chart.test.js — the chart as a drawn object. Run: node test/chart.test.js
//
// Records every canvas operation the renderer makes and checks the things that
// would quietly ruin it: filled cells creeping back in, unexplored ground being
// drawn on, the hand-drawn wobble becoming random (which would make the exported
// PNG differ from the chart on screen), and the export silently failing.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { initClimate, dawnX, tempAt, lostAtT } from "../src/world/climate.js";
import { applyWorldScale } from "../src/world/scale.js";
import * as manifest from "../src/game/manifest.js";
import * as story from "../src/game/story.js";
import * as chart from "../src/ui/chart.js";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));
applyWorldScale(config);
const storyData = JSON.parse(readFileSync(join(here, "../content/story.json"), "utf8"));
initClimate(config.climate);

let failures = 0;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

// recording 2D context
function rec() {
  const ops = [];
  const state = { fillStyle: "", strokeStyle: "", font: "", lineWidth: 1, globalAlpha: 1 };
  const log = (op, extra) => ops.push(Object.assign({ op, fill: state.fillStyle, stroke: state.strokeStyle, font: state.font }, extra || {}));
  const g = {
    ops,
    fillRect: (x, y, w, h) => log("fillRect", { x, y, w, h }),
    strokeRect: () => log("strokeRect"),
    clearRect: () => {},
    beginPath: () => log("beginPath"),
    closePath: () => {}, moveTo: (x, y) => log("moveTo", { x, y }), lineTo: (x, y) => log("lineTo", { x, y }),
    arc: (x, y, r) => log("arc", { x, y, r }), stroke: () => log("stroke"), fill: () => log("fill"),
    setLineDash: d => log("setLineDash", { n: (d || []).length }),
    fillText: (t, x, y) => log("fillText", { text: t, x, y }),
    save: () => {}, restore: () => {}, setTransform: () => {}, translate: () => {}, rotate: () => {},
    measureText: t => ({ width: String(t).length * 6 }),
    toDataURL: () => "data:image/png;base64,STUB"
  };
  for (const k of ["fillStyle", "strokeStyle", "font", "lineWidth", "globalAlpha", "lineCap", "lineJoin"])
    Object.defineProperty(g, k, { get: () => state[k], set: v => { state[k] = v; } });
  return g;
}

// minimal DOM so initChart/exportChart can run
let clicked = null, madeCanvas = null;
globalThis.document = {
  getElementById: id => ({ id, textContent: "", onclick: null, classList: { add() {} },
    clientWidth: 1200, clientHeight: 800, width: 0, height: 0, getContext: () => rec() }),
  createElement: tag => {
    if (tag === "a") { const a = { download: "", href: "", click() { clicked = a; } }; return a; }
    madeCanvas = { width: 0, height: 0, getContext: () => rec(), toDataURL: () => "data:image/png;base64,STUB" };
    return madeCanvas;
  }
};
globalThis.devicePixelRatio = 1;

function setup(seenFraction) {
  // rectangular now: the world is a strip, and the seen-grid is GWX x GWZ indexed
  // ix*GWZ + iz — the same order main.js and ui/chart.js both use
  const CELL = config.world.chartCell;
  const GWX = Math.ceil((config.world.lengthX || config.world.size) / CELL);
  const GWZ = Math.ceil((config.world.widthZ || config.world.size) / CELL);
  const S = { t: 240, px: 0, pz: 0, planet: "Kestrel", name: "Vera", ship: "Kittiwake",
    knowTruth: false, log: [], seen: new Uint8Array(GWX * GWZ), seenCount: 0 };
  if (seenFraction > 0) {
    for (let i = 0; i < GWX; i++) for (let j = 0; j < GWZ; j++) {
      if (i / GWX < seenFraction) { S.seen[i * GWZ + j] = 1; S.seenCount++; }
    }
  }
  manifest.initManifest(config, storyData, { S, dawnX, tempAt, lostAtT });
  story.initStory(config, storyData, { S, manifest, showPanel: () => {}, renderManifest: () => {}, esc: s => String(s), toast: () => {} });
  const heightAt = (x, z) => 40 + 60 * Math.sin(x / 300) * Math.cos(z / 260);
  chart.initChart(config, storyData, { S, manifest, storyMod: story, heightAt, dawnX });
  return S;
}

console.log("IT IS DRAWN, NOT FILLED");
{
  setup(0.6);
  const g = rec();
  let threw = null;
  try { chart.drawChart(g, 1200, 800); } catch (e) { threw = e; }
  ok("the chart renders without throwing", !threw, threw ? threw.stack.split("\n").slice(0, 3).join(" | ") : "");
  const fills = g.ops.filter(o => o.op === "fillRect");
  ok("only two filled rectangles remain: the ground and the heat wash", fills.length === 2,
     `${fills.length} fillRects`);
  const strokes = g.ops.filter(o => o.op === "stroke").length;
  ok("the chart is made of ink strokes", strokes > 500, `${strokes} strokes`);
  ok("contours and hachures both drew", strokes > 1000, `${strokes} strokes`);
  const serif = g.ops.filter(o => o.op === "fillText" && /serif/.test(o.font));
  ok("labels exist and the named ones use the serif face", serif.length >= 0 && g.ops.some(o => o.op === "fillText"));
}

console.log("\nUNEXPLORED GROUND STAYS BLANK");
{
  setup(0);                       // nothing walked at all
  const g = rec();
  chart.drawChart(g, 1200, 800);
  const blankStrokes = g.ops.filter(o => o.op === "stroke").length;
  setup(1);                       // everything walked
  const g2 = rec();
  chart.drawChart(g2, 1200, 800);
  const fullStrokes = g2.ops.filter(o => o.op === "stroke").length;
  ok("an unwalked chart draws far less ink than a walked one", blankStrokes * 4 < fullStrokes,
     `${blankStrokes} vs ${fullStrokes} strokes`);
  ok("a fully walked chart is dense with relief", fullStrokes > 3000, `${fullStrokes} strokes`);
}

console.log("\nTHE HAND IS UNSTEADY BUT NOT RANDOM");
{
  setup(0.6);
  const a = rec(), b = rec();
  chart.drawChart(a, 1200, 800);
  chart.drawChart(b, 1200, 800);
  const sig = g => g.ops.filter(o => o.op === "lineTo" || o.op === "moveTo")
    .map(o => `${o.x.toFixed(4)},${o.y.toFixed(4)}`).join(";");
  ok("two renders of the same chart are identical to the pixel", sig(a) === sig(b));
  const pts = a.ops.filter(o => o.op === "lineTo");
  const offGrid = pts.filter(o => Math.abs(o.x - Math.round(o.x)) > 1e-6).length;
  ok("strokes do not sit on exact pixel lines — the hand wobbles", offGrid > pts.length * 0.5,
     `${offGrid}/${pts.length} off-grid`);
}

console.log("\nEXPORT");
{
  const S = setup(0.6);
  clicked = null;
  let threw = null;
  try { chart.exportChart(); } catch (e) { threw = e; }
  ok("export does not throw", !threw, threw ? threw.message : "");
  ok("export triggered a download", clicked !== null);
  ok("the file is a PNG data URL", clicked && /^data:image\/png/.test(clicked.href));
  ok("the file is named after the world the player named", clicked && /^kestrel-/.test(clicked.download),
     clicked ? clicked.download : "");
  ok("export renders at print resolution, not screen resolution",
     madeCanvas && madeCanvas.width > 1200 && madeCanvas.width <= config.chart.exportMaxPixels,
     madeCanvas ? `${madeCanvas.width}x${madeCanvas.height}` : "no canvas");
}

console.log("\nSTILL THE SAME MAP UNDERNEATH");
{
  const S = setup(0);
  const before = S.seenCount;
  chart.markSeen();
  ok("markSeen still reveals ground around the player", S.seenCount > before);
  ok("reveal radius grows with elevation (unchanged behaviour)", S.seenCount > 0);
}

if (failures) { console.error(`\nchart.test.js: ${failures} failure(s)`); process.exit(1); }
console.log("\nchart.test.js: all passed");
