// ui/chart.js — the chart, and the fog-of-war reveal that feeds it.
//
// This is meant to read as something a person drew in the field over eighty-eight
// days, not as a minimap. So there are no filled cells anywhere in here: elevation
// is carried by contour lines and by hachures — the short downhill strokes a
// surveyor rules across a slope — and the edge of what has been walked is a torn,
// broken line rather than a tidy boundary. Everything beyond it is left blank on
// purpose. The blank is the invitation.
//
// Two rules hold the whole thing together:
//
//  1. NOTHING HERE IS RANDOM. Every wobble in every stroke comes from hash2(), a
//     pure integer hash of the thing being drawn. The chart therefore looks
//     identical every time it is opened, and the PNG you export is the chart you
//     were looking at. Math.random() would make it flicker on every redraw.
//  2. ONE RENDERER. drawChart() takes a context and a size and knows nothing about
//     where it is drawing. The screen calls it at panel size; the export calls it
//     at print size on an off-screen canvas. There is no second code path to drift.

import { LETHAL, K } from "../world/climate.js";
import { hash2 } from "../world/textures.js";

let config, story, S, manifest, storyMod, heightAt, dawnX;
// The world is a STRIP now, so the chart's grid is rectangular: GWX cells along the
// journey, GWZ across it. Every index is ix*GWZ + iz — the same order main.js uses
// when it allocates S.seen, and the two must not drift apart.
let CELL, LX, LZ, GWX, GWZ;
let heights = null;            // corner heights, built once — heightAt is not cheap
let CH = null;                 // config.chart, cached

// story.json owns every word. Until the keys exist these carry the text, and the
// moment they are added they take over.
const T = (key, fallback) => (story && story.ui && story.ui[key]) || fallback;

export function initChart(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  heightAt = deps.heightAt; dawnX = deps.dawnX;
  CELL = config.world.chartCell;
  LX = config.world.lengthX || config.world.size;
  LZ = config.world.widthZ || config.world.size;
  GWX = Math.ceil(LX / CELL); GWZ = Math.ceil(LZ / CELL);
  CH = config.chart;
  heights = null;

  const btn = document.getElementById("c-export");
  if(btn){ btn.textContent = T("chartExportButton", "Export chart"); btn.onclick = exportChart; }
}

export function markSeen(){
  const gy = heightAt(S.px, S.pz),
        R = CH.revealBaseRadius + Math.max(0, gy - CH.revealElevationThreshold) * CH.revealPerMetreElevation;
  const ci = ((S.px + LX / 2) / CELL) | 0, cj = ((S.pz + LZ / 2) / CELL) | 0, rad = Math.ceil(R / CELL);
  for(let j = cj - rad; j <= cj + rad; j++){ if(j < 0 || j >= GWZ) continue;
    for(let i = ci - rad; i <= ci + rad; i++){ if(i < 0 || i >= GWX) continue;
      const wx = (i + .5) * CELL - LX / 2, wz = (j + .5) * CELL - LZ / 2;
      if(Math.hypot(wx - S.px, wz - S.pz) <= R){ const k = i * GWZ + j; if(!S.seen[k]){ S.seen[k] = 1; S.seenCount++; } } } }
}

/* ---------- the surveyor's unsteady hand ---------- */
// Pure, seeded by whatever is being drawn, so a given stroke always wobbles the
// same way. Returns roughly -1..1.
const wob = (a, b, salt) => hash2(a | 0, b | 0, salt) * 2 - 1;

// A line drawn by a person: it bows slightly, and it does not quite start or stop
// where it should. Broken into segments so long lines bow rather than kink.
// Appends one wobbling line as its own subpath. Disjoint subpaths stroke exactly
// as separate strokes do, so batching many of these into one path is free detail:
// a whole contour level, or a whole cell of hachures, costs one stroke() instead
// of hundreds. On a fully walked chart that is the difference between opening
// instantly and visibly hitching.
function inkedPath(g, x1, y1, x2, y2, amp, salt, segs){
  const n = segs || Math.max(1, Math.min(6, Math.round(Math.hypot(x2 - x1, y2 - y1) / 14)));
  for(let i = 0; i <= n; i++){
    const t = i / n;
    const nx = -(y2 - y1), ny = (x2 - x1);
    const len = Math.hypot(nx, ny) || 1;
    // bow out in the middle, settle at the ends
    const bow = Math.sin(t * Math.PI) * amp * wob(salt, i, 917);
    const x = x1 + (x2 - x1) * t + (nx / len) * bow;
    const y = y1 + (y2 - y1) * t + (ny / len) * bow;
    if(i === 0) g.moveTo(x, y); else g.lineTo(x, y);
  }
}

// The same line, drawn on its own.
function inked(g, x1, y1, x2, y2, amp, salt, segs){
  g.beginPath(); inkedPath(g, x1, y1, x2, y2, amp, salt, segs); g.stroke();
}

function heightGrid(){
  if(heights) return heights;
  const nx = GWX + 1, nz = GWZ + 1;
  heights = new Float32Array(nx * nz);
  for(let i = 0; i < nx; i++) for(let j = 0; j < nz; j++)
    heights[i * nz + j] = heightAt(i * CELL - LX / 2, j * CELL - LZ / 2);
  return heights;
}

// Marching squares, clipped to ground the player has actually walked.
function contourSegments(hg, level){
  const nz = GWZ + 1, out = [];
  const ix = (a, b, t) => a + (b - a) * t;
  for(let i = 0; i < GWX; i++) for(let j = 0; j < GWZ; j++){
    if(!S.seen[i * GWZ + j]) continue;
    const a = hg[i * nz + j], b = hg[(i + 1) * nz + j], c = hg[(i + 1) * nz + j + 1], d = hg[i * nz + j + 1];
    const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
    if(idx === 0 || idx === 15) continue;
    const top = () => [i + (level - a) / (b - a), j];
    const right = () => [i + 1, j + (level - b) / (c - b)];
    const bot = () => [i + (level - d) / (c - d), j + 1];
    const left = () => [i, j + (level - a) / (d - a)];
    const push = (p, q) => { if(isFinite(p[0]) && isFinite(p[1]) && isFinite(q[0]) && isFinite(q[1])) out.push([p, q, i, j]); };
    switch(idx){
      case 1: case 14: push(left(), bot()); break;
      case 2: case 13: push(bot(), right()); break;
      case 3: case 12: push(left(), right()); break;
      case 4: case 11: push(top(), right()); break;
      case 6: case 9:  push(top(), bot()); break;
      case 7: case 8:  push(left(), top()); break;
      case 5:          push(left(), top()); push(bot(), right()); break;
      case 10:         push(top(), right()); push(left(), bot()); break;
    }
  }
  return out;
}

/* ---------- the renderer ---------- */
// g: a 2D context already transformed so that one unit is one CSS pixel.
// w,h: the drawing surface in those units. Everything else is derived.
export function drawChart(g, w, h){
  const P = CH.palette, hg = heightGrid();
  // The world is 2800 x 460, so fitting it as a square would waste four fifths of
  // the sheet. One scale for both axes — the chart has to stay a MAP, and a chart
  // with different scales in x and z would read as a lie about the ground.
  const s = Math.min(w / LX, h / LZ), ox = (w - LX * s) / 2, oy = (h - LZ * s) / 2;
  const px = wx => ox + (wx + LX / 2) * s, py = wz => oy + (wz + LZ / 2) * s;
  const gx = i => ox + i * CELL * s, gy = j => oy + j * CELL * s;
  const seen = (i, j) => i >= 0 && j >= 0 && i < GWX && j < GWZ && S.seen[i * GWZ + j];

  g.fillStyle = P.ground; g.fillRect(0, 0, w, h);
  g.lineCap = "round"; g.lineJoin = "round";

  // --- the ruled grid the chart was drawn on: faint, and drawn by hand too
  g.strokeStyle = P.grid; g.lineWidth = CH.gridWidth;
  for(let v = 0; v <= LX; v += CH.gridSpacing){
    if(v <= LX) inked(g, ox + v * s, oy, ox + v * s, oy + LZ * s, CH.gridWobble, v, 8);
    if(v <= LZ) inked(g, ox, oy + v * s, ox + LX * s, oy + v * s, CH.gridWobble, v + 7919, 8);
  }

  // --- hachures: short downhill strokes, denser and longer where it is steep.
  // This is what carries relief on a hand-drawn chart, and it only exists where
  // someone has been to see it.
  g.strokeStyle = P.ink; g.lineWidth = CH.hachureWidth;
  const nz = GWZ + 1;
  for(let i = 0; i < GWX; i++) for(let j = 0; j < GWZ; j++){
    if(!seen(i, j)) continue;
    const a = hg[i * nz + j], b = hg[(i + 1) * nz + j], c = hg[(i + 1) * nz + j + 1], d = hg[i * nz + j + 1];
    const dzdx = ((b + c) - (a + d)) / 2, dzdy = ((d + c) - (a + b)) / 2;
    const slope = Math.hypot(dzdx, dzdy) / CELL;
    if(slope < CH.hachureMinSlope) continue;
    const strength = Math.min(1, (slope - CH.hachureMinSlope) / CH.hachureSlopeSpan);
    const count = 1 + Math.floor(strength * CH.hachureMax);
    const len = CELL * s * (CH.hachureShort + strength * CH.hachureLong);
    const dl = Math.hypot(dzdx, dzdy) || 1;
    const ux = dzdx / dl, uy = dzdy / dl;         // downhill
    g.globalAlpha = CH.hachureAlpha * (.45 + .55 * strength);
    g.beginPath();
    for(let k = 0; k < count; k++){
      const jx = wob(i * 31 + k, j, 101), jy = wob(i, j * 31 + k, 233);
      const cx = gx(i) + CELL * s * (.5 + jx * .35), cy = gy(j) + CELL * s * (.5 + jy * .35);
      inkedPath(g, cx - ux * len / 2, cy - uy * len / 2, cx + ux * len / 2, cy + uy * len / 2,
            CH.strokeWobble * .5, i * 7 + j * 13 + k, 2);
    }
    g.stroke();
  }
  g.globalAlpha = 1;

  // --- contour lines, every CH.contourInterval metres of elevation
  g.strokeStyle = P.contour; g.lineWidth = CH.contourWidth;
  let lo = Infinity, hi = -Infinity;
  for(let k = 0; k < hg.length; k++){ if(hg[k] < lo) lo = hg[k]; if(hg[k] > hi) hi = hg[k]; }
  const first = Math.ceil(lo / CH.contourInterval) * CH.contourInterval;
  for(let level = first; level <= hi; level += CH.contourInterval){
    const major = Math.abs(level % (CH.contourInterval * CH.contourMajorEvery)) < 1e-6;
    g.lineWidth = major ? CH.contourWidth * 1.9 : CH.contourWidth;
    g.globalAlpha = major ? 1 : .62;
    g.beginPath();
    for(const [p, q, ci, cj] of contourSegments(hg, level))
      inkedPath(g, gx(p[0]), gy(p[1]), gx(q[0]), gy(q[1]), CH.strokeWobble, ci * 131 + cj + level, 2);
    g.stroke();
  }
  g.globalAlpha = 1;

  // --- the torn edge of what has been walked. Drawn as broken strokes along the
  // boundary, with gaps, so the chart stops rather than ends.
  g.strokeStyle = P.edge; g.lineWidth = CH.edgeWidth;
  for(let i = 0; i < GWX; i++) for(let j = 0; j < GWZ; j++){
    if(!seen(i, j)) continue;
    const x0 = gx(i), y0 = gy(j), x1 = gx(i + 1), y1 = gy(j + 1);
    const sides = [[!seen(i, j - 1), x0, y0, x1, y0], [!seen(i, j + 1), x0, y1, x1, y1],
                   [!seen(i - 1, j), x0, y0, x0, y1], [!seen(i + 1, j), x1, y0, x1, y1]];
    for(let k = 0; k < 4; k++){
      const sd = sides[k];
      if(!sd[0]) continue;
      if(hash2(i, j * 4 + k, 613) < CH.edgeGapChance) continue;   // a torn edge has holes in it
      g.globalAlpha = CH.edgeAlpha * (.55 + .45 * hash2(i + k, j, 71));
      inked(g, sd[1], sd[2], sd[3], sd[4], CH.edgeWobble, i * 17 + j * 5 + k, 2);
    }
  }
  g.globalAlpha = 1;

  // --- the clock: the dawn line, and the ground already too hot to reach
  const le = px(dawnX(S.t) - (LETHAL + config.climate.lethalMargin) / K);
  g.fillStyle = P.lethalWash; g.fillRect(ox, oy, Math.max(0, le - ox), LZ * s);
  g.strokeStyle = P.lethal; g.lineWidth = CH.contourWidth * 1.6;
  inked(g, le, oy, le, oy + LZ * s, CH.strokeWobble, 4242, 10);
  const dl = px(dawnX(S.t));
  g.strokeStyle = P.dawn; g.lineWidth = CH.contourWidth * 1.6;
  g.setLineDash([7 * CH.dashScale, 6 * CH.dashScale]);
  inked(g, dl, oy, dl, oy + LZ * s, CH.strokeWobble, 1717, 10);
  g.setLineDash([]);

  // --- what orbit gave you, and what you have made of it
  const serif = px2 => `italic ${px2}px "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif`;
  const mono = px2 => `${px2}px "SF Mono",Menlo,Consolas,monospace`;
  const F = CH.labelSize * Math.max(1, s * LX / 900);

  g.font = mono(F * .82);
  g.textAlign = "left";
  const list = manifest.list();
  for(const c of list){
    if(c.done || c.lost) continue;
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    const tz = c.band ? manifest.bandTargetZ(S.t) : c.z;
    const X = px(tx), Y = py(tz);
    g.strokeStyle = P.pending; g.lineWidth = CH.contourWidth * 1.3;
    g.beginPath(); g.arc(X, Y, F * .5, 0, 6.29); g.stroke();
    g.fillStyle = P.pendingText; g.fillText(c.n, X + F * .8, Y + F * .3);
  }
  for(const cp of storyMod.CAMPS){
    if(cp.read) continue;
    const X = px(cp.x), Y = py(cp.z);
    g.strokeStyle = P.camp; g.lineWidth = CH.contourWidth * 1.2;
    inked(g, X - F * .4, Y - F * .4, X + F * .4, Y - F * .4, .4, cp.x, 1);
    inked(g, X + F * .4, Y - F * .4, X + F * .4, Y + F * .4, .4, cp.z, 1);
    inked(g, X + F * .4, Y + F * .4, X - F * .4, Y + F * .4, .4, cp.x + 1, 1);
    inked(g, X - F * .4, Y + F * .4, X - F * .4, Y - F * .4, .4, cp.z + 1, 1);
    g.fillStyle = P.campText; g.fillText(cp.n, X + F, Y + F * .3);
  }

  // Everything the player named, in the serif face. This is the part of the chart
  // that is theirs, and it is the reason the thing is worth keeping.
  g.font = serif(F * 1.15);
  for(const c of list){
    if(!c.done && !c.lost) continue;
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    const tz = c.band ? manifest.bandTargetZ(S.t) : c.z;
    const X = px(tx), Y = py(tz);
    g.fillStyle = c.done ? P.named : P.lost;
    g.beginPath(); g.arc(X, Y, F * .28, 0, 6.29); g.fill();
    if(c.name && c.by === "you"){
      g.fillStyle = P.named;
      g.fillText(c.name, X + F * .75, Y + F * .42);
    }
  }

  // Meridian ground: read camps, found graves, the shelter. Small, unlabelled.
  g.fillStyle = P.meridian;
  const marks = storyMod.CAMPS.filter(c => c.read)
    .concat(storyMod.GRAVES.filter(gg => gg.read))
    .concat(storyMod.LAST.read ? [storyMod.LAST] : []);
  for(const m of marks){
    const X = px(m.x), Y = py(m.z);
    inked(g, X - F * .3, Y - F * .3, X + F * .3, Y + F * .3, .3, m.x, 1);
    inked(g, X + F * .3, Y - F * .3, X - F * .3, Y + F * .3, .3, m.z, 1);
  }
  g.strokeStyle = P.meridian; g.lineWidth = CH.contourWidth;

  // --- you
  const sx = px(S.px), sy = py(S.pz);
  g.strokeStyle = P.player; g.lineWidth = CH.contourWidth * 1.7;
  g.beginPath(); g.arc(sx, sy, F * .62, 0, 6.29); g.stroke();
  inked(g, sx - F, sy, sx + F, sy, .5, 21, 2);
  inked(g, sx, sy - F, sx, sy + F, .5, 22, 2);
}

export function openChart(){
  document.getElementById("chart").classList.add("on");
  document.getElementById("c-title").textContent = S.planet || T("chartUnnamedWorld", "CS 4-9 b");
  document.getElementById("c-sub").textContent =
    story.ui.chartSubtitleTemplate.replace("{surveyor}", () => S.name).replace("{ship}", () => S.ship);
  document.getElementById("c-cov").textContent =
    story.ui.chartCoverageTemplate.replace("{percent}", (100 * S.seenCount / S.seen.length).toFixed(1))
      .replace("{count}", S.log.length);
  const c = document.getElementById("chartcv");
  const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChart(g, w, h);
}

// The design doc asks for a thing that can be framed, so this is the whole of that
// feature: the same renderer, run at print resolution onto an off-screen canvas,
// handed to the browser as a download. No new dependency, no server.
export function exportChart(){
  try{
    const on = document.getElementById("chartcv");
    const w = on.clientWidth || 1200, h = on.clientHeight || 800;
    const scale = Math.max(1, Math.min(CH.exportScale, CH.exportMaxPixels / Math.max(w, h)));
    const c = document.createElement("canvas");
    c.width = Math.round(w * scale); c.height = Math.round(h * scale);
    const g = c.getContext("2d");
    g.setTransform(scale, 0, 0, scale, 0, 0);
    drawChart(g, w, h);
    const name = String(S.planet || "chart").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
    const a = document.createElement("a");
    a.download = `${name || "chart"}-${(100 * S.seenCount / S.seen.length).toFixed(0)}pc.png`;
    a.href = c.toDataURL("image/png");
    a.click();
  }catch(e){ /* a failed export must never take the chart down with it */ }
}
