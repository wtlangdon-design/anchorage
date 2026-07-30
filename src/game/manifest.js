// game/manifest.js — the six survey criteria. Owns CRIT.
//
// Ported verbatim from the reference: CRIT array (220-241), target()'s crit
// branch (770-773), lost-detection (1129-1131), and the band target expression
// `dawnX()-230` used throughout. Pure logic/state — no THREE. Numbers come from
// config, prose from story. Zero behaviour change.
//
// The reference read a global S.t inside dawnX()/tempAt(); climate.js now takes
// an explicit t, so callers here pass S.t.

import { LETHAL } from "../world/climate.js";

let S, dawnX, tempAt, lostAtT, shadeAt, config;
let CRIT = [];
let lostCb = null, completeCb = null, grantCb = null;

// THE MANIFEST IS EARNED, NOT ISSUED.
//
// Orbital survey did not find these six places. Vantaa did, over forty years, and
// the only copy is in her last entry at camp five. So until that entry is read
// there is no manifest at all: no findings on the panel, no bearings on the
// compass, no sites on the chart, nothing to survey and nothing counting down.
// The player lands with one grave and one bearing.
//
// list() returning nothing is deliberately the ONLY lever, because list() is what
// every display already reads — the hud, the compass, the chart and the ending
// summary all go quiet together without any of them learning that this mechanism
// exists. crit(id) stays ungated on purpose: the camp gifts and the shelter's relay
// archive look findings up by id, and they have to keep working.
let granted = false;
const NONE = [];

// Preserve this exact order when merging config.sites + story.sites.
const SITE_ORDER = ["soil", "water", "rad", "bio", "site", "season"];

export function initManifest(config_, story, deps){
  S = deps.S; dawnX = deps.dawnX; tempAt = deps.tempAt; lostAtT = deps.lostAtT;
  shadeAt = deps.shadeAt || (() => 0);
  config = config_;
  granted = false;
  CRIT = SITE_ORDER.map(id => {
    const cs = config.sites[id], ss = story.sites[id];
    return {
      id,
      n: ss.name,
      x: cs.x, z: cs.z, r: cs.radius, dur: cs.duration,
      band: !!cs.followsBand,
      find: ss.finding,
      place: ss.place,
      sugg: ss.suggestions,
      done: false, by: null, lost: false, name: null,
      // static ground, so its shade is worked out once and never again
      shade: cs.followsBand ? 0 : shadeAt(cs.x, cs.z)
    };
  });
}

export function list(){ return granted ? CRIT : NONE; }
// The record, whether or not the player has been given it. Nothing that draws a
// display should use this.
export function all(){ return CRIT; }
export function crit(id){ return CRIT.find(c => c.id === id); }

export function isGranted(){ return granted; }
// Idempotent, and returns whether it did anything, so the caller can decide
// whether this is the moment to start the clock.
export function grant(){
  if(granted) return false;
  granted = true;
  if(grantCb) grantCb();
  return true;
}
export function onGrant(cb){ grantCb = cb; }

// Reproduces the reference's `dawnX()-230` (config.striders.bandOffset === -230).
export function bandTargetX(t){ return dawnX(t) + config.striders.bandOffset; }

export function complete(id, by, name){
  const c = crit(id);
  c.done = true; c.by = by; c.name = name;
  if(completeCb) completeCb(c);
  return c;
}

// ref 770-773: first crit not done and not lost whose distance from the player
// is within its radius. Band crits track the dawn line.
export function targetCrit(){
  if(!granted) return null;         // you cannot survey what you have not been told to look for
  for(const c of CRIT){
    if(c.done || c.lost) continue;
    const tx = c.band ? bandTargetX(S.t) : c.x;
    if(Math.hypot(tx - S.px, c.z - S.pz) <= c.r) return c;
  }
  return null;
}

// ref 1129-1131: a crit (not done, not lost, not band) whose ground has passed
// LETHAL is lost forever. Fires the registered onLost callback; rendering/toast
// is the callback's job.
export function updateLost(){
  if(!granted) return;              // nothing is expiring before the manifest exists
  CRIT.forEach(c => {
    if(c.done || c.lost || c.band) return;
    if(tempAt(c.x, S.t, c.shade) > LETHAL){
      c.lost = true;
      if(lostCb) lostCb(c);
    }
  });
}

export function onLost(cb){ lostCb = cb; }
export function onComplete(cb){ completeCb = cb; }

export function state(){
  return CRIT.map(c => ({
    id: c.id, name: c.name, done: c.done, by: c.by, lost: c.lost,
    x: c.x, z: c.z,
    timeLeft: c.band ? Infinity : lostAtT(c.x, c.shade) - S.t
  }));
}
