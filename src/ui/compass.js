// ui/compass.js — the compass strip and the soundfield strip at the top of the HUD.
//
// Ported verbatim from the reference: canvas setup + fit() (963-967),
// drawCompass (968-1006), drawSound (1007-1028). All the projection and art
// numbers stay inline; only the tunables the port spec names move to config.
// Notes text comes from story. Zero behaviour change.
//
// The reference read a global S.t inside dawnX()/tempAt(); climate.js now takes
// an explicit t, so callers here pass S.t.

let config, story, S, manifest, storyMod, dawnX, tempAt, lostAtT, getDens;
let cmp, cx, sfc, s2;

export function initCompass(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  dawnX = deps.dawnX; tempAt = deps.tempAt; lostAtT = deps.lostAtT; getDens = deps.getDens;

  cmp = document.getElementById("cmp"); cx = cmp.getContext("2d");
  sfc = document.getElementById("sf");  s2 = sfc.getContext("2d");
}

function fit(c){ const w = c.clientWidth, h = c.clientHeight, d = Math.min(devicePixelRatio, 2);
  if(c.width !== w * d){ c.width = w * d; c.height = h * d; } return [w, h, d]; }

export function drawCompass(){
  const arc = config.compass.visibleArc;
  const [w, h, d] = fit(cmp); cx.setTransform(d, 0, 0, d, 0, 0); cx.clearRect(0, 0, w, h);
  cx.font = "9px monospace"; cx.textAlign = "center";
  for(let deg = 0; deg < 360; deg += config.compass.tickSpacingDegrees){ const a = deg * Math.PI / 180;
    let dd = ((a - S.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if(Math.abs(dd) > arc) continue;
    const x = w / 2 + dd * (w / 2.5), major = deg % 90 === 0;
    cx.fillStyle = major ? "rgba(143,198,212,.55)" : "rgba(143,198,212,.20)";
    cx.fillRect(x - .5, h - (major ? 9 : 4), 1, major ? 9 : 4);
    if(major){ cx.fillStyle = deg === 0 ? "rgba(255,233,192,.7)" : "rgba(143,198,212,.5)";
      cx.fillText({ 0: "W ☀", 90: "N", 180: "E", 270: "S" }[deg], x, h - 12); } }   // TODO(lead): cardinal labels {0:"W ☀",90:"N",180:"E",270:"S"} not in config
  // orbital survey gave you the six sites and the camp positions. it did not give you
  // the graves or the shelter — those stay unmarked, and finding them is the discovery.
  const marks = [];
  manifest.list().forEach(c => { if(c.done || c.lost) return;
    const tx = c.band ? manifest.bandTargetX(S.t) : c.x;
    marks.push({ x: tx, z: c.z, label: c.n.split(" ")[0].toUpperCase(), col: "255,233,192", pri: 1 }); });
  const CAMPS = storyMod.CAMPS, LAST = storyMod.LAST;
  CAMPS.forEach(cp => { if(cp.read) return;
    if(lostAtT(cp.x) - S.t <= 0) return;
    marks.push({ x: cp.x, z: cp.z, label: cp.n.replace("Camp ", "C").toUpperCase(), col: "143,198,212", pri: 0 }); });
  if(CAMPS.length && CAMPS[CAMPS.length-1].read && !LAST.read)
    marks.push({ x: LAST.x, z: LAST.z, label: "?", col: "143,198,212", pri: 0 });
  // Labels collide badly when several sites sit on a similar bearing — on a
  // phone strip they overlap into mush. Draw the arrow for every mark, but
  // give the text to the nearest one in each cluster and let the rest go.
  const drawn = [];
  const labelGap = (config.compass && config.compass.labelGapPx) || 46;
  marks.sort((a, b) => Math.hypot(a.x - S.px, a.z - S.pz) - Math.hypot(b.x - S.px, b.z - S.pz));
  marks.forEach(m => {
    const a = Math.atan2(-(m.z - S.pz), m.x - S.px);
    let dd = ((a - S.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    const edge = Math.abs(dd) > arc;
    const x = edge ? (dd > 0 ? w - 6 : 6) : w / 2 + dd * (w / 2.5);
    const dist = Math.hypot(m.x - S.px, m.z - S.pz);
    cx.globalAlpha = edge ? .35 : 1;
    cx.fillStyle = `rgba(${m.col},.95)`;
    cx.beginPath(); cx.moveTo(x, 3); cx.lineTo(x + 4, 9); cx.lineTo(x - 4, 9); cx.closePath(); cx.fill();
    const crowded = drawn.some(d => Math.abs(d.x - x) < labelGap && d.dist <= dist);
    if(!edge && !crowded){ drawn.push({ x, dist });
      cx.font = "8px monospace"; cx.fillStyle = `rgba(${m.col},.85)`;
      cx.fillText(m.label, x, 18);
      cx.fillStyle = `rgba(${m.col},.5)`;
      cx.fillText((dist / 1000).toFixed(1) + "k", x, 26); }
    cx.globalAlpha = 1;
  });
  cx.strokeStyle = "rgba(255,233,192,.55)"; cx.beginPath(); cx.moveTo(w / 2, 0); cx.lineTo(w / 2, h); cx.stroke();
}

// What drawSound() worked out this frame, kept so world/sound.js can hear exactly
// what the strip drew rather than computing the herd a second time and drifting.
const field = { herdAngle: 0, herdAmp: 0, herdDistance: Infinity };
export function soundfield(){ return field; }

export function drawSound(){
  const [w, h, d] = fit(sfc); s2.setTransform(d, 0, 0, d, 0, 0); s2.clearRect(0, 0, w, h);
  const src = [];
  const hx = dawnX(S.t) + config.striders.bandOffset, hz = config.striders.herdZ, hd = Math.hypot(hx - S.px, hz - S.pz);
  src.push({ a: Math.atan2(-(hz - S.pz), hx - S.px), amp: Math.max(0, 1 - hd / config.striders.audibleRange) * .95 });
  field.herdAngle = src[0].a; field.herdAmp = src[0].amp; field.herdDistance = hd;
  let nul = 0;
  getDens().forEach(dn => { if(tempAt(dn.x, S.t) < config.ashwaiters.activeAboveTemp) return;
    const dd = Math.hypot(dn.x - S.px, dn.z - S.pz);
    if(dd < config.ashwaiters.soundNullRadius) nul = Math.max(nul, 1 - dd / config.ashwaiters.soundNullRadius); });
  S.null_ = nul; const amb = 1 - nul;
  // the bars are animation, so they ride the wall clock and keep breathing through
  // the grace period; where the herd and the dens ARE is mission time, above
  const at = S.animT === undefined ? S.t : S.animT;
  for(let i = 0; i < 70; i++){ const x = i / 70 * w, a = (.13 + .08 * Math.sin(at * .9 + i * .7)) * amb;
    s2.fillStyle = `rgba(143,198,212,${.16 * amb + .02})`; s2.fillRect(x, h / 2 - a * h / 2, w / 70 - 1, a * h); }
  src.forEach(sc => { let dd = ((sc.a - S.camYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    if(Math.abs(dd) > config.compass.visibleArc) return;
    const x = w / 2 + dd * (w / 2.5), a = sc.amp * amb;
    s2.fillStyle = `rgba(143,198,212,${.28 + a * .6})`;
    const bw = 7 + a * 24; s2.fillRect(x - bw / 2, h / 2 - a * h * .46, bw, a * h * .92); });
  s2.fillStyle = "rgba(255,233,192,.35)"; s2.fillRect(w / 2 - .5, 0, 1, h);
  const note = document.getElementById("sfnote");
  if(nul > config.ashwaiters.soundNullThreshold){ note.textContent = story.soundfield.null; note.className = "null"; }
  else if(hd < config.striders.closeRange){ note.textContent = story.soundfield.herd; note.className = ""; }
  else { note.textContent = ""; note.className = ""; }
}
