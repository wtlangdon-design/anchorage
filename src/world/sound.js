// world/sound.js — everything you hear, made at run time. No files, no library.
//
// A JUNGLE IS A LOUD PLACE, and that is now the point of this module. Four
// permanent beds and one one-shot, all built from a single loop of noise:
//   wind      the canopy moving over your head, thickest under a closed roof
//   insects   the stridulating mass in the growth — the bed that tells you where
//             in the day you are, since it is silent ahead of the growth and goes
//             out as the growth browns
//   water     what is standing in the hollows, because water arrives at dawn
//   herd      the animals AHEAD of you on the trail, low-passed and panned; level,
//             brightness and pulse are all distance, and muffling is direction
//   foot      short noise bursts fired off the gait phase
//
// Everything routes through one duck gain, which the ashwaiter null drives to
// zero. That is the point of the whole module, and it is worth more now than it
// ever was on the ash: near a den a world this loud does not get a warning sound,
// it goes actually silent. The null path is untouched by the jungle work.
//
// The audio graph is fixed size — fourteen nodes, built once. Only footfalls
// create nodes, three at a time for about a fifth of a second, and they
// disconnect themselves. Nothing here allocates per frame.
//
// Math.random() is used for the noise buffer and for footfall variation. That is
// deliberate and it must stay that way: the world's seeded generator is consumed
// in a fixed order (see main.js) and drawing from it here would move every grass
// blade on the next refill.

let A = null, cfg = null, deps = null;
let ctx = null, dead = false, muted = false;
let master, duck, windGain, windLow, windHigh, herdGain, herdLow, herdPan, noiseBuf, noiseSrc;
let bugGain, bugBand, bugHigh, watGain, watLow, watHigh;

// smoothed values, so nothing jumps between frames
const sm = { wind: 0, windHz: 0, herd: 0, herdHz: 0, pan: 0, duck: 1, mute: 1,
             bug: 0, bugHz: 0, wat: 0, watHz: 0 };
let lastStep = null;

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const wrapPi = a => ((a + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
// exponential approach: tau is roughly the time to cover most of the distance
const approach = (now, target, dt, tau) => now + (target - now) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));

/* ---------- build ----------
   Must be called from inside a user gesture (the "Step outside" button) or
   Chrome refuses to start the context. Any failure at all leaves the game
   running silently: `dead` latches and every entry point becomes a no-op. */
export function initAudio(config, d) {
  if (ctx || dead) return;
  try {
    cfg = config; A = config.audio; deps = d;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { dead = true; return; }
    ctx = new AC();
    if (ctx.state === "suspended" && ctx.resume) ctx.resume().catch(() => {});

    noiseBuf = buildNoise(ctx, A.noiseSeconds);

    master = ctx.createGain(); master.gain.value = A.masterGain;
    master.connect(ctx.destination);

    // one gain for the null to pull down; everything audible passes through it
    duck = ctx.createGain(); duck.gain.value = 1;
    duck.connect(master);

    windHigh = ctx.createBiquadFilter(); windHigh.type = "highpass";
    windHigh.frequency.value = A.wind.highpassHz;
    windLow = ctx.createBiquadFilter(); windLow.type = "lowpass";
    windLow.frequency.value = A.wind.lowpassHz; windLow.Q.value = A.wind.lowpassQ;
    windGain = ctx.createGain(); windGain.gain.value = 0;
    windHigh.connect(windLow); windLow.connect(windGain); windGain.connect(duck);

    // insects: narrow and high. The band-pass is what makes noise read as animals
    // rather than as hiss, and the tremolo is applied to the gain per frame rather
    // than with an oscillator, the same way the wind's gust is.
    bugHigh = ctx.createBiquadFilter(); bugHigh.type = "highpass";
    bugHigh.frequency.value = A.insects.highpassHz;
    bugBand = ctx.createBiquadFilter(); bugBand.type = "bandpass";
    bugBand.frequency.value = A.insects.bandHz; bugBand.Q.value = A.insects.bandQ;
    bugGain = ctx.createGain(); bugGain.gain.value = 0;
    bugHigh.connect(bugBand); bugBand.connect(bugGain); bugGain.connect(duck);

    // water: mid-high, with the filter drifting so it moves rather than sits
    watHigh = ctx.createBiquadFilter(); watHigh.type = "highpass";
    watHigh.frequency.value = A.water.highpassHz;
    watLow = ctx.createBiquadFilter(); watLow.type = "lowpass";
    watLow.frequency.value = A.water.lowpassHz; watLow.Q.value = A.water.lowpassQ;
    watGain = ctx.createGain(); watGain.gain.value = 0;
    watHigh.connect(watLow); watLow.connect(watGain); watGain.connect(duck);

    herdLow = ctx.createBiquadFilter(); herdLow.type = "lowpass";
    herdLow.frequency.value = A.herd.lowpassHz; herdLow.Q.value = A.herd.lowpassQ;
    herdGain = ctx.createGain(); herdGain.gain.value = 0;
    herdLow.connect(herdGain);
    herdPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (herdPan) { herdGain.connect(herdPan); herdPan.connect(duck); }
    else herdGain.connect(duck);   // old Safari: no panner, still audible

    // a single looping source feeds both beds
    noiseSrc = ctx.createBufferSource();
    noiseSrc.buffer = noiseBuf; noiseSrc.loop = true;
    noiseSrc.connect(windHigh); noiseSrc.connect(herdLow);
    noiseSrc.connect(bugHigh); noiseSrc.connect(watHigh);
    noiseSrc.start();

    sm.windHz = A.wind.lowpassHz;
    sm.herdHz = A.herd.lowpassHz;
    sm.bugHz = A.insects.bandHz;
    sm.watHz = A.water.lowpassHz;
  } catch (e) {
    dead = true;
    teardown();
  }
}

// White noise. The filters do the shaping, so the buffer itself stays plain.
function buildNoise(context, seconds) {
  const n = Math.max(1, Math.floor(context.sampleRate * seconds));
  const buf = context.createBuffer(1, n, context.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function teardown() {
  try { if (noiseSrc) { noiseSrc.stop(); noiseSrc.disconnect(); } } catch (e) {}
  for (const n of [windHigh, windLow, windGain, herdLow, herdGain, herdPan,
                   bugHigh, bugBand, bugGain, watHigh, watLow, watGain, duck, master]) {
    try { if (n) n.disconnect(); } catch (e) {}
  }
  try { if (ctx && ctx.close) ctx.close(); } catch (e) {}
  ctx = null; noiseSrc = null;
}

/* ---------- per frame ---------- */
export function updateAudio(S, dt) {
  if (!ctx || dead) return;
  try {
    const step = Math.min(dt, 0.1);   // a long stall must not snap every level

    // --- the null. Read from S, where compass.drawSound() already put it, so the
    // strip on the HUD and the ears can never disagree. ---
    const nul = clamp01(S.null_ || 0);
    sm.duck = approach(sm.duck, Math.pow(1 - nul, A.null.curve), step, A.smoothing.null);
    sm.mute = approach(sm.mute, muted ? 0 : 1, step, A.smoothing.mute);
    duck.gain.value = sm.duck;
    master.gain.value = A.masterGain * sm.mute;

    // --- what the jungle around the player is doing. Read from the soundfield the
    // compass strip already computed, exactly as the herd is: the strip and the ears
    // are not allowed to disagree, and neither of them recomputes the world. ---
    const field = deps.getSoundfield ? deps.getSoundfield() : null;
    const canopy = field ? clamp01(field.canopy) : 0;
    const growth = field ? clamp01(field.growth) : 0;
    const wet = field ? clamp01(field.wet) : 0;

    // --- wind: THE CANOPY. A closed roof is the loudest thing you hear and it is
    // also the lowest — leaves, not open sky. Higher and hotter ground still add. ---
    const gy = deps.heightAt(S.px, S.pz);
    const T = deps.tempAt(S.px, S.t);
    const W = A.wind;
    const lift = clamp01((gy - W.elevationStart) / W.elevationRange);
    const heat = clamp01((T - W.heatStart) / W.heatRange);
    const roof = Math.pow(canopy, W.canopyCurve);
    // the wall clock, not mission time: the wind has to be gusting before the
    // clock starts, or the grace period sounds like a held breath
    const wt = S.animT === undefined ? S.t : S.animT;
    // two sines beating against each other, so the bed never loops audibly
    const gust = 1 + W.gustDepth * (0.6 * Math.sin(wt * W.gustRate * 6.28318) +
                                    0.4 * Math.sin(wt * W.gustRate * W.gustBeatRatio + W.gustBeatPhase));
    const windTarget = (W.gain + W.canopyGain * roof +
                        W.elevationGain * lift + W.heatGain * heat) * gust;
    sm.wind = approach(sm.wind, Math.max(0, windTarget), step, A.smoothing.wind);
    sm.windHz = approach(sm.windHz,
      W.lowpassHz + W.elevationLowpassAdd * lift + W.canopyLowpassAdd * roof,
      step, A.smoothing.wind);
    windGain.gain.value = sm.wind;
    windLow.frequency.value = Math.max(40, sm.windHz);

    // --- insects: where you are in the ONE DAY. Silent ahead of the growth, full in
    // it, out again as it browns, and quieter under a break in the roof. The tremolo
    // is a mass of animals rubbing rather than one, so it rides on top of the level
    // instead of gating it. ---
    const I = A.insects;
    const bugLevel = Math.pow(growth, I.curve) * (I.canopyFloor + I.canopyGain * canopy);
    sm.bug = approach(sm.bug, I.gain * bugLevel, step, A.smoothing.insects);
    sm.bugHz = approach(sm.bugHz, I.bandHz + I.bandSpreadHz * growth, step, A.smoothing.insects);
    const strid = 1 - I.stridulateDepth * (0.5 + 0.5 * Math.sin(wt * I.stridulateRate * 6.28318));
    bugGain.gain.value = Math.max(0, sm.bug * strid);
    bugBand.frequency.value = sm.bugHz;

    // --- water: standing in the hollows, since the dawn just went through. ---
    const WA = A.water;
    sm.wat = approach(sm.wat, WA.gain * Math.pow(wet, WA.curve), step, A.smoothing.water);
    sm.watHz = approach(sm.watHz,
      WA.lowpassHz + WA.moveHz * Math.sin(wt * WA.moveRate * 6.28318), step, A.smoothing.water);
    watGain.gain.value = sm.wat;
    watLow.frequency.value = Math.max(80, sm.watHz);

    // --- herd: the same bearing and amplitude the soundfield strip drew. THEY ARE
    // AHEAD OF YOU, and how far is the only thing the mix has to say. Level and
    // brightness are distance; inside pulseFrom the mass comes apart into animals;
    // and because a panner cannot tell dead-ahead from dead-behind, being behind you
    // muffles them instead. ---
    const H = A.herd;
    const amp = field ? clamp01(field.herdAmp) : 0;
    const dd = field ? wrapPi(field.herdAngle - S.camYaw) : 0;
    sm.herd = approach(sm.herd, H.gain * Math.pow(amp, H.curve), step, A.smoothing.herd);
    // ahead-or-behind is the herd's bearing along the trail, not where you are
    // looking: turning your head must not move the animals.
    const behind = field ? field.herdAhead === false : false;
    const bright = (H.lowpassHz + H.lowpassSpreadHz * amp) * (behind ? H.behindLowpassMul : 1);
    sm.herdHz = approach(sm.herdHz, bright, step, A.smoothing.herd);
    const near = field && isFinite(field.herdDistance)
      ? clamp01(1 - field.herdDistance / H.pulseFrom) : 0;
    const pulse = 1 - H.pulseDepth * near * (0.5 + 0.5 * Math.sin(wt * H.pulseRate * 6.28318));
    herdGain.gain.value = Math.max(0, sm.herd * pulse);
    herdLow.frequency.value = Math.max(30, sm.herdHz);
    if (herdPan && field) {
      // same convention as the compass: positive is to the right of where you look
      sm.pan = approach(sm.pan, Math.sin(dd), step, A.smoothing.pan);
      herdPan.pan.value = sm.pan;
    }

    // --- footfalls, off the gait phase: two per cycle, on the foot ---
    if (S.speed > A.foot.minSpeed) {
      const idx = Math.floor((S.bob - A.foot.phaseOffset) / Math.PI);
      if (lastStep === null) lastStep = idx;          // re-sync, never fire a backlog
      else if (idx > lastStep) { lastStep = idx; footfall(S); }
    } else lastStep = null;
  } catch (e) {
    dead = true;   // never let audio break the frame loop
  }
}

// A footfall is a filtered burst of the same noise, with a fast attack and a
// weighted decay. Sprinting is brighter and shorter; walking is lower and slower.
function footfall(S) {
  const F = A.foot;
  const p = S.speed > cfg.gait.runThreshold ? F.sprint : F.walk;
  const now = ctx.currentTime;
  const vary = 1 + (Math.random() * 2 - 1) * F.variation;
  const life = F.attack + p.decay * vary;

  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass"; filter.frequency.value = p.filterHz * vary; filter.Q.value = F.filterQ;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.gain * vary), now + F.attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + life);

  src.connect(filter); filter.connect(g); g.connect(duck);
  // start at a random point in the loop so no two steps are the same sample
  const offset = Math.random() * Math.max(0.01, noiseBuf.duration - F.burstSeconds - 0.01);
  src.start(now, offset);
  src.stop(now + life + 0.02);
  src.onended = () => {
    try { src.disconnect(); filter.disconnect(); g.disconnect(); } catch (e) {}
  };
}

export function toggleMute() {
  if (!ctx || dead) return;
  muted = !muted;
}

export function isMuted() { return muted; }
