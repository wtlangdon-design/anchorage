// ui/hud.js — the heads-up display: manifest panel, gauges, readouts, prompt,
// the toast, and the shared text helpers every other ui/game module reuses.
//
// Ported verbatim from the reference: toast (700), esc (702), mmss (703),
// PTS + bearingTo (704-708), renderManifest (861-893), bar() (1090-1091),
// and the gauge/readout/prompt/heat writes from animate() (1199-1216). Numbers
// come from config, prose/UI strings from story. Zero behaviour change.
//
// The reference read a global S.t inside dawnX()/tempAt(); climate.js now takes
// an explicit t, so callers here pass S.t.

let config, story, S, manifest, storyMod, dawnX, tempAt, lostAtT;
let fpsEl = null;

export function initHud(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  dawnX = deps.dawnX; tempAt = deps.tempAt; lostAtT = deps.lostAtT;

  document.getElementById("keys").innerHTML = story.ui.keyHints;
  document.querySelector("#task .hdr span").textContent = story.ui.manifestHeader;
  fpsEl = document.getElementById("fps");
}

/* ---------- fps readout (F) ----------
   A measuring tool, not part of the game: off by default, and it reports the
   worst frame in each sample window as well as the average, because a steady 58
   with a 22 in it is a stutter you would otherwise not see. */
let fpsOn = false, fpsFrames = 0, fpsElapsed = 0, fpsWorst = Infinity;
export function toggleFps(){
  fpsOn = !fpsOn;
  fpsEl.style.display = fpsOn ? "block" : "none";
  fpsFrames = 0; fpsElapsed = 0; fpsWorst = Infinity;
  if(!fpsOn) fpsEl.textContent = "";
}
export function updateFps(dt){
  if(!fpsOn) return;
  fpsFrames++; fpsElapsed += dt;
  if(dt > 0) fpsWorst = Math.min(fpsWorst, 1 / dt);
  const window_ = config.render.fpsSampleMs / 1000;
  if(fpsElapsed >= window_){
    const avg = fpsFrames / fpsElapsed;
    fpsEl.textContent = `${avg.toFixed(0)} fps · min ${isFinite(fpsWorst) ? fpsWorst.toFixed(0) : "—"}`;
    fpsFrames = 0; fpsElapsed = 0; fpsWorst = Infinity;
  }
}

/* ---------- shared text helpers (imported by the other ui/game modules) ---------- */
let tt = null;
export function toast(h, ms = config.timing.toastDefaultMs){
  const t = document.getElementById("toast");
  t.innerHTML = h; t.style.opacity = 1; clearTimeout(tt); tt = setTimeout(() => t.style.opacity = 0, ms);
}
export function esc(s){ return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
export function mmss(s){ if(s < 0) s = 0; const m = Math.floor(s / 60); return m + ":" + String(Math.floor(s % 60)).padStart(2, "0"); }

const PTS = ["W", "NW", "N", "NE", "E", "SE", "S", "SW"];
export function bearingTo(x, z){
  let a = Math.atan2(-(z - S.pz), x - S.px); a = (a + Math.PI * 2) % (Math.PI * 2);
  return PTS[Math.round(a / (Math.PI / 4)) % 8];
}

/* ---------- manifest ---------- */
export function renderManifest(){
  const list = manifest.list();
  const cl = document.getElementById("critlist");
  cl.innerHTML = list.map(c => {
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    const dist = Math.hypot(tx - S.px, c.z - S.pz);
    const cls = c.done ? (c.by === "meridian" ? "mer" : "done") : (c.lost ? "lost" : "");
    let tcell, tcls = "";
    if(c.done) tcell = "✓";
    else if(c.lost) tcell = "—";
    else if(c.band) tcell = "∞";
    else { const rem = lostAtT(c.x, c.shade) - S.t; tcell = mmss(rem);
      tcls = rem < 75 ? "urgent" : rem < 180 ? "soon" : ""; }   // TODO(lead): urgency thresholds 75/180 not in config
    const dcell = c.done || c.lost ? "" : `${bearingTo(tx, c.z)} ${(dist / 1000).toFixed(1)}k`;
    return `<div class="row ${cls}"><div class="nm2">${c.n}</div>
      <div class="dd">${dcell}</div><div class="tt ${tcls}">${tcell}</div></div>`;
  }).join("");

  const CAMPS = storyMod.CAMPS, LAST = storyMod.LAST;
  const camps = document.getElementById("camplist");
  const items = CAMPS.map(cp => ({ n: cp.n, x: cp.x, z: cp.z, read: cp.read, shade: cp.shade || 0 }));
  if(LAST.read || CAMPS[4].read) items.push({ n: LAST.n, x: LAST.x, z: LAST.z, read: LAST.read, shade: 0 });
  camps.innerHTML = items.map(cp => {
    const dist = Math.hypot(cp.x - S.px, cp.z - S.pz);
    const rem = lostAtT(cp.x, cp.shade) - S.t;
    const lost = rem <= 0 && !cp.read;
    return `<div class="row ${cp.read ? "mer" : lost ? "lost" : ""}">
      <div class="nm2">${cp.n}</div>
      <div class="dd">${cp.read ? "" : bearingTo(cp.x, cp.z) + " " + (dist / 1000).toFixed(1) + "k"}</div>
      <div class="tt ${!cp.read && rem < 75 ? "urgent" : !cp.read && rem < 180 ? "soon" : ""}">${cp.read ? "✓" : lost ? "—" : mmss(rem)}</div></div>`;   // TODO(lead): urgency thresholds 75/180 not in config
  }).join("");

  const got = list.filter(c => c.done).length, lost = list.filter(c => c.lost && !c.done).length;
  const lostStr = lost ? story.ui.manifestLostTemplate.replace("{n}", lost) : "";
  document.getElementById("tasknote").innerHTML =
    story.ui.manifestNoteTemplate.replace("{done}", got).replace("{lost}", lostStr);
}

/* ---------- gauges ---------- */
function bar(id, v){ const e = document.getElementById(id); e.querySelector("i").style.width = v + "%";
  e.className = "bar" + (v < config.suit.gaugeBadBelow ? " bad" : v < config.suit.gaugeWarnBelow ? " warn" : ""); }
export function updateGauges(){
  bar("b-int", S.integrity); bar("b-wat", S.water); bar("b-oxy", S.oxy);
}

/* ---------- readouts ---------- */
export function updateReadouts(gy){
  const T = tempAt(S.px, S.t, S.shade), tv = document.getElementById("v-temp");
  tv.textContent = `${T > 0 ? "+" : ""}${T.toFixed(0)} °C`;
  tv.style.color = T > 40 ? "var(--bad)" : T > 28 ? "var(--warn)" : T < -30 ? "#79A6D8" : "var(--ink)";   // TODO(lead): temp colour thresholds 40/28/-30 (and colours) not in config
  const behind = dawnX(S.t) - S.px;
  document.getElementById("v-dawn").textContent =
    behind >= 0 ? story.ui.dawnBehindTemplate.replace("{km}", (behind / 1000).toFixed(2))
                : story.ui.dawnAheadTemplate.replace("{km}", (-behind / 1000).toFixed(2));
  document.getElementById("v-elev").textContent = `${gy.toFixed(0)} m`;
  document.getElementById("clockv").textContent = mmss(S.t);
}

/* ---------- heat overlay ---------- */
export function updateHeat(){
  const T = tempAt(S.px, S.t, S.shade);
  document.getElementById("heat").style.opacity = T > 42 ? Math.min(.9, (T - 42) / 20) : 0;   // TODO(lead): heat overlay 42/.9/20 not in config
}

/* ---------- interaction prompt ---------- */
export function updatePrompt(target){
  const p = document.getElementById("prompt"), pb = document.getElementById("pbar");
  if(S.surveying){ p.style.display = "block"; pb.style.display = "block";
    document.getElementById("ptext").innerHTML = story.ui.promptSurveying;
    pb.querySelector("i").style.width = (100 * S.progress / S.surveying.dur) + "%"; }
  else if(target){ p.style.display = "block"; pb.style.display = "none";
    document.getElementById("ptext").innerHTML = `<b>E</b> — ${esc(target.label)}`; }
  else p.style.display = "none";
}
