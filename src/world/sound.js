// world/sound.js — everything you hear, made at run time. No files, no library.
//
// Three permanent beds and one one-shot, all built from a single loop of noise:
//   wind    filtered noise, always there, louder high up and in the heat
//   herd    the same noise pushed through a low-pass and panned by bearing
//   foot    short noise bursts fired off the gait phase
// Everything routes through one duck gain, which the ashwaiter null drives to
// zero. That is the point of the whole module: near a den the world does not get
// a warning sound, it goes actually silent.
//
// The audio graph is fixed size — eight nodes, built once. Only footfalls create
// nodes, three at a time for about a fifth of a second, and they disconnect
// themselves. Nothing here allocates per frame.
//
// Math.random() is used for the noise buffer and for footfall variation. That is
// deliberate and it must stay that way: the world's seeded generator is consumed
// in a fixed order (see main.js) and drawing from it here would move every grass
// blade on the next refill.

let A = null, cfg = null, deps = null;
let ctx = null, dead = false, muted = false;
let master, duck, windGain, windLow, windHigh, herdGain, herdLow, herdPan, noiseBuf, noiseSrc;

// smoothed values, so nothing jumps between frames
const sm = { wind: 0, windHz: 0, herd: 0, herdHz: 0, pan: 0, duck: 1, mute: 1 };
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
    noiseSrc.start();

    sm.windHz = A.wind.lowpassHz;
    sm.herdHz = A.herd.lowpassHz;
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
  for (const n of [windHigh, windLow, windGain, herdLow, herdGain, herdPan, duck, master]) {
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

    // --- wind: the floor. Higher ground and hotter ground both thicken it. ---
    const gy = deps.heightAt(S.px, S.pz);
    const T = deps.tempAt(S.px, S.t);
    const W = A.wind;
    const lift = clamp01((gy - W.elevationStart) / W.elevationRange);
    const heat = clamp01((T - W.heatStart) / W.heatRange);
    // the wall clock, not mission time: the wind has to be gusting before the
    // clock starts, or the grace period sounds like a held breath
    const wt = S.animT === undefined ? S.t : S.animT;
    const gust = 1 + W.gustDepth * (0.6 * Math.sin(wt * W.gustRate * 6.28318) +
                                    0.4 * Math.sin(wt * W.gustRate * 10.7 + 1.3));
    const windTarget = (W.gain + W.elevationGain * lift + W.heatGain * heat) * gust;
    sm.wind = approach(sm.wind, Math.max(0, windTarget), step, A.smoothing.wind);
    sm.windHz = approach(sm.windHz, W.lowpassHz + W.elevationLowpassAdd * lift, step, A.smoothing.wind);
    windGain.gain.value = sm.wind;
    windLow.frequency.value = sm.windHz;

    // --- herd: the same bearing and amplitude the soundfield strip drew ---
    const field = deps.getSoundfield ? deps.getSoundfield() : null;
    const amp = field ? clamp01(field.herdAmp) : 0;
    sm.herd = approach(sm.herd, A.herd.gain * Math.pow(amp, A.herd.curve), step, A.smoothing.herd);
    sm.herdHz = approach(sm.herdHz, A.herd.lowpassHz + A.herd.lowpassSpreadHz * amp, step, A.smoothing.herd);
    herdGain.gain.value = sm.herd;
    herdLow.frequency.value = sm.herdHz;
    if (herdPan && field) {
      // same convention as the compass: positive is to the right of where you look
      sm.pan = approach(sm.pan, Math.sin(wrapPi(field.herdAngle - S.camYaw)), step, A.smoothing.pan);
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
