// ui/chart.js — the chart overlay canvas and the fog-of-war reveal that feeds it.
//
// Ported verbatim from the reference: markSeen (896-903) and openChart (904-961).
// The reveal radius and a couple of chart tunables move to config; every canvas
// drawing number stays inline as art. Title/subtitle/coverage strings come from
// story. Zero behaviour change.
//
// The reference read a global S.t inside dawnX(); climate.js now takes an
// explicit t, so callers here pass S.t. LETHAL/K are imported live from climate.

import { LETHAL, K } from "../world/climate.js";

let config, story, S, manifest, storyMod, heightAt, dawnX;
let CELL, SIZE, GW;

export function initChart(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  heightAt = deps.heightAt; dawnX = deps.dawnX;
  CELL = config.world.chartCell; SIZE = config.world.size; GW = Math.ceil(SIZE / CELL);
}

export function markSeen(){
  const gy = heightAt(S.px, S.pz),
        R = config.chart.revealBaseRadius + Math.max(0, gy - config.chart.revealElevationThreshold) * config.chart.revealPerMetreElevation;
  const ci = ((S.px + SIZE / 2) / CELL) | 0, cj = ((S.pz + SIZE / 2) / CELL) | 0, rad = Math.ceil(R / CELL);
  for(let j = cj - rad; j <= cj + rad; j++){ if(j < 0 || j >= GW) continue;
    for(let i = ci - rad; i <= ci + rad; i++){ if(i < 0 || i >= GW) continue;
      const wx = (i + .5) * CELL - SIZE / 2, wz = (j + .5) * CELL - SIZE / 2;
      if(Math.hypot(wx - S.px, wz - S.pz) <= R){ const k = j * GW + i; if(!S.seen[k]){ S.seen[k] = 1; S.seenCount++; } } } }
}

export function openChart(){
  document.getElementById("chart").classList.add("on");
  document.getElementById("c-title").textContent = S.planet || "CS 4-9 b";   // TODO(lead): chart-title fallback "CS 4-9 b" kept inline — no matching story.ui.chart* key (equals story.briefing.step3.title)
  document.getElementById("c-sub").textContent =
    story.ui.chartSubtitleTemplate.replace("{surveyor}", () => S.name).replace("{ship}", () => S.ship);
  document.getElementById("c-cov").textContent =
    story.ui.chartCoverageTemplate.replace("{percent}", (100 * S.seenCount / S.seen.length).toFixed(1)).replace("{count}", S.log.length);
  const c = document.getElementById("chartcv");
  const w = c.clientWidth, h = c.clientHeight, dpr = Math.min(devicePixelRatio, 2);
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#070A10"; g.fillRect(0, 0, w, h);
  const s = Math.min(w, h) / SIZE, ox = (w - SIZE * s) / 2, oy = (h - SIZE * s) / 2;
  g.strokeStyle = "rgba(143,198,212,.08)"; g.lineWidth = 1;
  for(let v = 0; v <= SIZE; v += config.chart.gridSpacing){
    g.beginPath(); g.moveTo(ox + v * s, oy); g.lineTo(ox + v * s, oy + SIZE * s); g.stroke();
    g.beginPath(); g.moveTo(ox, oy + v * s); g.lineTo(ox + SIZE * s, oy + v * s); g.stroke(); }
  for(let j = 0; j < GW; j++) for(let i = 0; i < GW; i++){
    if(!S.seen[j * GW + i]) continue;
    const wx = (i + .5) * CELL - SIZE / 2, wz = (j + .5) * CELL - SIZE / 2, e = heightAt(wx, wz);
    const px = ox + i * CELL * s, py = oy + j * CELL * s, sz = CELL * s + .7;
    g.fillStyle = `rgba(200,212,220,${.045 + Math.min(.30, Math.max(0, e) / 210)})`;
    g.fillRect(px, py, sz, sz);
    if(e > config.chart.contourThreshold){ g.strokeStyle = `rgba(200,212,220,${.10 + (e - config.chart.contourThreshold) / 220})`; g.lineWidth = .65; g.beginPath();
      for(let k = 0; k < 3; k++){ const yy = py + sz * (k + .5) / 3; g.moveTo(px, yy); g.lineTo(px + sz, yy - sz * .3); } g.stroke(); } }
  const dl = ox + (dawnX(S.t) + SIZE / 2) * s;
  g.strokeStyle = "rgba(255,233,192,.55)"; g.lineWidth = 1.4; g.setLineDash([5, 5]);
  g.beginPath(); g.moveTo(dl, oy); g.lineTo(dl, oy + SIZE * s); g.stroke(); g.setLineDash([]);
  const le = ox + (dawnX(S.t) - (LETHAL + config.climate.lethalMargin) / K + SIZE / 2) * s;
  g.fillStyle = "rgba(217,72,74,.13)"; g.fillRect(ox, oy, Math.max(0, le - ox), SIZE * s);
  g.strokeStyle = "rgba(217,72,74,.6)"; g.beginPath(); g.moveTo(le, oy); g.lineTo(le, oy + SIZE * s); g.stroke();
  // unfound manifest sites, hollow — you were given these from orbit
  g.font = "10px monospace";
  const list = manifest.list();
  list.forEach(c => { if(c.done || c.lost) return;
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    const px = ox + (tx + SIZE / 2) * s, py = oy + (c.z + SIZE / 2) * s;
    g.strokeStyle = "rgba(255,233,192,.7)"; g.lineWidth = 1.1;
    g.beginPath(); g.arc(px, py, 4.5, 0, 6.29); g.stroke();
    g.fillStyle = "rgba(255,233,192,.6)"; g.fillText(c.n, px + 8, py + 3); });
  const CAMPS = storyMod.CAMPS, GRAVES = storyMod.GRAVES, LAST = storyMod.LAST;
  CAMPS.forEach(cp => { if(cp.read) return;
    const px = ox + (cp.x + SIZE / 2) * s, py = oy + (cp.z + SIZE / 2) * s;
    g.strokeStyle = "rgba(143,198,212,.55)"; g.lineWidth = 1;
    g.strokeRect(px - 3, py - 3, 6, 6);
    g.fillStyle = "rgba(143,198,212,.5)"; g.fillText(cp.n, px + 8, py + 3); });
  g.font = "italic 14px Georgia, serif";
  list.forEach(c => { if(!c.done && !c.lost) return;
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    const px = ox + (tx + SIZE / 2) * s, py = oy + (c.z + SIZE / 2) * s;
    g.fillStyle = c.done ? "#FFE9C0" : "rgba(217,72,74,.8)";
    g.beginPath(); g.arc(px, py, 2.6, 0, 6.29); g.fill();
    if(c.name && c.by === "you") g.fillText(c.name, px + 7, py + 4); });
  const marks = CAMPS.filter(c => c.read).concat(GRAVES.filter(g2 => g2.read)).concat(LAST.read ? [LAST] : []);
  marks.forEach(m => { const px = ox + (m.x + SIZE / 2) * s, py = oy + (m.z + SIZE / 2) * s;
    g.fillStyle = "rgba(143,198,212,.85)"; g.fillRect(px - 2, py - 2, 4, 4); });
  const sx = ox + (S.px + SIZE / 2) * s, sy = oy + (S.pz + SIZE / 2) * s;
  g.strokeStyle = "#8FC6D4"; g.lineWidth = 1.3;
  g.beginPath(); g.arc(sx, sy, 6, 0, 6.29); g.stroke();
  g.beginPath(); g.moveTo(sx - 9, sy); g.lineTo(sx + 9, sy); g.moveTo(sx, sy - 9); g.lineTo(sx, sy + 9); g.stroke();
}
