// world/climate.js — the clock.  [pure: no THREE, no rnd, no game state]
//
// dawnX(t) -> metres           the dawn line's x position at time t (seconds)
// tempAt(x, t) -> celsius      surface temperature at x at time t
// lostAtT(x) -> seconds        the time at which x becomes lethal
//
// Constants come from config.climate at init and are re-exported as live bindings
// (LETHAL, K, DAWN_V, DAWN0) for the chart and HUD. The clock takes ground away
// permanently — this module is where "permanently" is defined.

export let LETHAL = 0, K = 0, DAWN_V = 0, DAWN0 = 0;
let baseTemp = 0, nightSlope = 0, minTemp = 0, maxTemp = 0, lethalMargin = 0;
let shadeRelief = 0;

export function initClimate(c){
  LETHAL = c.lethal; K = c.k; DAWN_V = c.dawnVelocity; DAWN0 = c.dawn0;
  baseTemp = c.baseTemp; nightSlope = c.nightSlope;
  minTemp = c.minTemp; maxTemp = c.maxTemp; lethalMargin = c.lethalMargin;
  // clamped below 1 so fully shaded ground still heats, however slowly — at
  // exactly 1 the sun would never reach it and lostAtT would be infinite
  shadeRelief = Math.max(0, Math.min(0.95, c.shadeRelief || 0));
}

export function dawnX(t){ return DAWN0 + t * DAWN_V; }

// `shade` is 0..1 and comes from the caller — climate never imports terrain, so
// there is no cycle and these stay pure functions of their arguments.
//
// Shade only ever removes solar gain. On the night side there is no sun to block,
// so it does nothing there, and it can never make ground warmer than open ground.
const shaded = s => 1 - shadeRelief * (s > 0 ? (s > 1 ? 1 : s) : 0);

export function tempAt(x, t, shade){
  const b = dawnX(t) - x;
  return b < 0 ? Math.max(minTemp, baseTemp + b * nightSlope)
               : Math.min(maxTemp, baseTemp + b * K * shaded(shade));
}

// When ground at x becomes lethal. Shaded ground heats more slowly, so it is lost
// later — this is what makes the shadow the only ground worth being on.
export function lostAtT(x, shade){
  return (x + (LETHAL + lethalMargin) / (K * shaded(shade)) - DAWN0) / DAWN_V;
}
