// player/suit.js — per-frame life-support drain, refill, ashwaiter damage, and the
// three failure checks. Ported verbatim from the reference animate loop (ref 1133-1147).

import { LETHAL } from "../world/climate.js?v=15";

let config, story;
let S, tempAt, toast, fail, getDens, waterPos, oxyPositions;

export function initSuit(cfg, st, deps){
  config = cfg;
  story = st;
  S = deps.S;
  tempAt = deps.tempAt;
  toast = deps.toast;
  fail = deps.fail;
  getDens = deps.getDens;
  waterPos = deps.waterPos;
  oxyPositions = deps.oxyPositions;
}

// ref 1133-1147
export function update(dt, now){
  const su=config.suit;
  const T=tempAt(S.px,S.t,S.shade);   // the rock is what is keeping you alive
  S.water=Math.max(0,S.water-dt*(su.waterDrainBase+Math.max(0,T-su.waterDrainThreshold)*su.waterDrainPerDegreeAbove));
  S.oxy=Math.max(0,S.oxy-dt*(su.oxygenDrainBase+S.speed*su.oxygenDrainPerSpeed));
  if(T>su.heatDamageThreshold)S.integrity=Math.max(0,S.integrity-dt*(T-su.heatDamageThreshold)*su.heatDamageRate);
  if(T<su.coldDamageThreshold)S.integrity=Math.max(0,S.integrity-dt*(su.coldDamageThreshold-T)*su.coldDamageRate);
  if(Math.hypot(waterPos.x-S.px,waterPos.z-S.pz)<su.waterRefillRadius&&tempAt(waterPos.x,S.t)<LETHAL)S.water=Math.min(100,S.water+dt*su.waterRefillRate); // TODO(lead): 100 water cap not in config
  oxyPositions.forEach(cp=>{if(Math.hypot(cp.x-S.px,cp.z-S.pz)<su.oxygenRefillRadius)S.oxy=Math.min(100,S.oxy+dt*su.oxygenRefillRate)}); // TODO(lead): 100 oxygen cap not in config
  const aw=config.ashwaiters;
  getDens().forEach(dn=>{if(tempAt(dn.x,S.t)<aw.activeAboveTemp)return;
    const dd=Math.hypot(dn.x-S.px,dn.z-S.pz);
    if(dd<aw.damageRadius){S.integrity=Math.max(0,S.integrity-dt*aw.damageRate);
      if(!dn.hit||now-dn.hit>aw.damageMessageCooldownMs){dn.hit=now;toast(story.toasts.ashwaiterStrike,3000)}}});
  if(S.water<=0)fail(story.failure.water);
  if(S.oxy<=0)fail(story.failure.oxygen);
  if(S.integrity<=0)fail(story.failure.integrity);
}
