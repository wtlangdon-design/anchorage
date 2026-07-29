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

export function initClimate(c){
  LETHAL = c.lethal; K = c.k; DAWN_V = c.dawnVelocity; DAWN0 = c.dawn0;
  baseTemp = c.baseTemp; nightSlope = c.nightSlope;
  minTemp = c.minTemp; maxTemp = c.maxTemp; lethalMargin = c.lethalMargin;
}

export function dawnX(t){ return DAWN0 + t * DAWN_V; }
export function tempAt(x, t){ const b = dawnX(t) - x;
  return b < 0 ? Math.max(minTemp, baseTemp + b * nightSlope)
               : Math.min(maxTemp, baseTemp + b * K); }
export function lostAtT(x){ return (x + (LETHAL + lethalMargin) / K - DAWN0) / DAWN_V; }
