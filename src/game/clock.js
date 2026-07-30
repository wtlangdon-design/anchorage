// game/clock.js — mission time and wall-clock time are not the same thing.
//
// THIS FILE EXISTS BECAUSE THE SPLIT HAS BEEN LOST TWICE. Both times the symptom
// was the same: `S.t += dt` sitting in main.js's loop with nothing in front of it,
// so the dawn line started sweeping and sites started expiring the instant the
// player stepped outside — before they had been given a reason to care. The fix is
// small and the regression is silent, which is exactly the combination that needs
// a test rather than a comment. clock.test.js owns that, including a static scan
// that fails if `S.t +=` ever appears anywhere but here.
//
// TWO CLOCKS:
//
//   S.t      MISSION time. Zero until the clock starts, then real seconds. This
//            is the only thing climate.js is ever handed: dawnX(t), tempAt(x,t),
//            lostAtT(x). While it is frozen the dawn line does not move, no
//            ground heats, and nothing can be lost. climate.js needs no knowledge
//            of any of this — its functions are pure functions of t, and we
//            simply pass a t that is not going anywhere yet.
//
//   S.animT  WALL-CLOCK time. Always advancing, from the first frame, including
//            while an overlay is up. Everything that makes the world look and
//            sound alive rides this: the grass shader, the wind's gusting, the
//            striders' gait, the dust drift, the soundfield bars. The world is
//            emphatically NOT frozen during the grace period — only the clock is.
//
// The rule for deciding which one a caller wants: if the answer changes what the
// planet DOES to you, it is S.t. If it only changes what the frame looks like, it
// is S.animT.

let S, backstopSeconds = 0, onStart = null;
let waited = 0;

export function initClock(config, story, deps){
  S = deps.S;
  const g = (config.climate && config.climate.grace) || {};
  backstopSeconds = typeof g.backstopSeconds === "number" ? g.backstopSeconds : 0;
  waited = 0;
  S.t = 0; S.animT = 0; S.clockStarted = false; S.clockStartReason = null;
}

// Called once a frame. `running` is false while an overlay is up, or the player is
// dead, or the run has ended, or the briefing has not been dismissed — the wall
// clock ignores it, mission time and the grace countdown both respect it. Pausing
// on the briefing therefore does not burn the grace period.
export function tick(dt, running){
  S.animT += dt;
  if(!running) return;
  if(S.clockStarted){ S.t += dt; return; }
  waited += dt;
  if(backstopSeconds > 0 && waited >= backstopSeconds) start("backstop");
}

// Starts mission time. Idempotent — returns false if it was already running, so a
// caller can use the return value to decide whether to announce it.
export function start(reason){
  if(S.clockStarted) return false;
  S.clockStarted = true;
  S.clockStartReason = reason || "unknown";
  if(onStart) onStart(S.clockStartReason);
  return true;
}

export function started(){ return !!S.clockStarted; }
export function graceElapsed(){ return waited; }
export function graceRemaining(){
  return backstopSeconds > 0 ? Math.max(0, backstopSeconds - waited) : Infinity;
}
export function onClockStart(cb){ onStart = cb; }
