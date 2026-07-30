// main.js — bootstrap, wiring, and the game loop. This is the ONLY place the
// modules are assembled, and the ONLY place that decides the order the seeded PRNG
// is consumed in. See HANDOFF's "THE TRAP": the whole world is one mulberry stream,
// and if these build calls happen in any other order every rock, hill, den, grass
// blade and strider lands somewhere else. The order below is the reference's order,
// exactly.
//
// Load-time draw order (must not change):
//   initNoise(seed)      -> draw-set #1: the 255-swap permutation table
//   fauna.buildDens()    -> draw-set #2: 52 draws (26 dens x, then z)
//   then init(), in this sequence, each drawing exactly what the reference did:
//     buildSky, buildTerrain, buildFarHills, buildGrass(->refill),
//     buildStriders, buildPlaces, buildPlayer, buildHands, buildDust, buildGlare
// Runtime draws (grass refills, the naming placeholder) come off the SAME stream,
// so preserving the load order preserves them too.

import { initNoise, rand, fbm } from "./world/noise.js?v=16";
import { initClimate, dawnX, tempAt, lostAtT } from "./world/climate.js?v=16";
import * as terrain from "./world/terrain.js?v=16";
import * as sky from "./world/sky.js?v=16";
import * as grass from "./world/grass.js?v=16";
import * as jungle from "./world/jungle.js?v=16";
import * as debug from "./ui/debug.js?v=16";
import * as fauna from "./world/fauna.js?v=16";
import * as props from "./world/props.js?v=16";
import * as sound from "./world/sound.js?v=16";
import * as textures from "./world/textures.js?v=16";
import { applyWorldScale } from "./world/scale.js?v=16";
import { initGait, poseFor } from "./player/gait.js?v=16";
import * as rig from "./player/rig.js?v=16";
import * as controller from "./player/controller.js?v=16";
import * as suit from "./player/suit.js?v=16";
import * as clock from "./game/clock.js?v=16";
import * as manifest from "./game/manifest.js?v=16";
import * as story from "./game/story.js?v=16";
import * as endings from "./game/endings.js?v=16";
import * as hud from "./ui/hud.js?v=16";
import * as compass from "./ui/compass.js?v=16";
import * as chart from "./ui/chart.js?v=16";
import * as panels from "./ui/panels.js?v=16";
import * as touch from "./ui/touch.js?v=16";

const THREE = window.THREE;

let renderer, scene, cam, sun;
let config, story_data, S, SUNDIR;
let SUN_COS = 1, SUN_SIN = 0;
let onMobile = false;
const SUN_D = 520;

boot();

async function boot() {
  if (!THREE) return; // the inline fallback in index.html already handled this
  [config, story_data] = await Promise.all([
    fetch("content/config.json?v=16").then(r => r.json()),
    fetch("content/story.json?v=16").then(r => r.json())
  ]);
  // resize the world before anything reads a number out of the config. every
  // module below goes on reading plain values and never learns this happened.
  applyWorldScale(config);
  init();
}

function init() {
  // ---- renderer / scene / camera (ref 353-364) ----
  renderer = new THREE.WebGLRenderer({ antialias: true });
  // A phone reports 3x and will melt trying to honour it, so the cap is hard and
  // it is decided before anything is drawn rather than after a stutter.
  renderer.setPixelRatio(Math.min(devicePixelRatio, config.render.maxPixelRatio));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = config.render.toneMappingExposure;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  renderer.domElement.style.position = "fixed"; renderer.domElement.style.inset = "0";
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(Number(config.render.fogColour), config.render.fogDensity);
  const camCfg = config.player.camera;
  // far follows the fog down. Under FogExp2 at 0.055 nothing past ~40 m contributes a
  // pixel, so a 9 km far plane was 9 km of depth precision and frustum spent on
  // geometry the fog had already eaten.
  cam = new THREE.PerspectiveCamera(camCfg.fov, innerWidth / innerHeight, camCfg.near, camCfg.far);
  SUNDIR = config.world.sunDirection;
  const elev = (config.world.sunElevationDeg || 0) * Math.PI / 180;
  SUN_COS = Math.cos(elev); SUN_SIN = Math.sin(elev);

  // ---- game state S (ref 337-346), seeded from config ----
  // The chart's seen-grid is rectangular now, because the world is a strip. Index
  // order is ix*GWZ + iz, and ui/chart.js must agree — it does, in one place each.
  const CELL = config.world.chartCell;
  const GWX = Math.ceil((config.world.lengthX || config.world.size) / CELL);
  const GWZ = Math.ceil((config.world.widthZ || config.world.size) / CELL);
  const sp = config.player.spawn;
  S = {
    // t is MISSION time and does not advance until the clock starts; animT is the
    // wall clock and always does. game/clock.js owns both — nothing else in the
    // codebase may add to S.t, and clock.test.js fails if anything tries.
    t: 0, animT: 0, clockStarted: false, clockStartReason: null,
    integrity: 100, water: 100, oxy: 100,
    px: sp.x, pz: sp.z, heading: Math.PI, speed: 0,
    camYaw: camCfg.startYaw, camPitch: camCfg.startPitch, fp: true,
    name: "", ship: "", planet: "",
    log: [], started: false, dead: false, mouse: false, ended: false,
    seen: new Uint8Array(GWX * GWZ), seenCount: 0,
    surveying: null, progress: 0, null_: 0, bob: 0, grassAt: -9999, knowTruth: false, shade: 0
  };

  // Work out what we are running on before anything is sized or built. The
  // controls are the same code either way — Pointer Events — so this only decides
  // what is shown and how much of the world is drawn.
  onMobile = touch.initTouch(config, story_data, {
    S, controller,
    actions: {
      interact, openChart: chart.openChart, openLog: panels.openLog,
      transmit: endings.transmit, toggleMute: sound.toggleMute, toggleFps: hud.toggleFps,
      toggleDebug: () => debug.toggleDebug()
    }
  });
  if (onMobile) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, config.mobile.maxPixelRatio));
    if (config.mobile.disableShadows) renderer.shadowMap.enabled = false;
    scene.fog.density *= config.mobile.fogDensityMultiplier;
  }

  // ---- pure cores ----
  initClimate(config.climate);
  clock.initClock(config, story_data, { S });
  initGait(config.gait);
  // must come before any build: the modules paint their maps as they build.
  // Textures use their own hash, never the world PRNG, so this cannot disturb
  // the draw order below.
  textures.initTextures(THREE, config, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() });

  // ---- module init (no PRNG draws happen here; each just stashes what it needs) ----
  const worldDeps = { THREE, scene, cam, S, rand, fbm, heightAt: terrain.heightAt, dawnX, tempAt };
  terrain.initTerrain(config, story_data, worldDeps);
  sky.initSky(config, story_data, worldDeps);
  grass.initGrass(config, story_data, worldDeps);
  jungle.initJungle(config, story_data, { ...worldDeps, pathPlan: terrain.pathPlan });
  // the canopy becomes the shade term's occlusion source. Injected, not imported, so
  // terrain.js still works with no jungle in front of it.
  terrain.setCanopySource(jungle.canopyAt);
  fauna.initFauna(config, story_data, worldDeps);
  props.initProps(config, story_data, worldDeps);

  rig.initRig(config, story_data, { THREE, scene, cam, heightAt: terrain.heightAt, S });

  manifest.initManifest(config, story_data, { S, dawnX, tempAt, lostAtT, shadeAt: terrain.shadeAt });

  hud.initHud(config, story_data, { S, manifest, storyMod: story, dawnX, tempAt, lostAtT });

  story.initStory(config, story_data, {
    S, manifest,
    showPanel: panels.showPanel, renderManifest: hud.renderManifest, esc: hud.esc, toast: hud.toast,
    shadeAt: terrain.shadeAt, openWorksheet: panels.openCrewSheet,
    // Reading the camp flagged grantsSurvey starts the clock, and the clock
    // starting is what grants the manifest — see the wiring below.
    grantSurvey: () => clock.start("meridian")
  });

  endings.initEndings(config, story_data, {
    S, manifest, storyMod: story, showMsg: panels.showMsg, toast: hud.toast, esc: hud.esc
  });

  compass.initCompass(config, story_data, {
    S, manifest, storyMod: story, dawnX, tempAt, lostAtT, getDens: fauna.getDens,
    // the soundfield strip reads the jungle directly; world/sound.js then reads the
    // strip, so the bars and the ears cannot drift apart
    canopyAt: jungle.canopyAt, growthAt: jungle.growthAt, wetnessAt: jungle.wetnessAt
  });

  chart.initChart(config, story_data, { S, manifest, storyMod: story, heightAt: terrain.heightAt, dawnX });

  panels.initPanels(config, story_data, {
    S, manifest, storyMod: story,
    toast: hud.toast, esc: hud.esc, mmss: hud.mmss, renderManifest: hud.renderManifest, rand, lostAtT,
    // built from inside the "Step outside" click — browsers only allow it there
    startAudio: () => sound.initAudio(config, {
      heightAt: terrain.heightAt, tempAt, getSoundfield: compass.soundfield
    })
  });

  // oxygen refills at any camp or the shelter (ref 1140: CAMPS.concat([LAST]))
  const oxyPositions = Object.keys(config.camps).filter(k => !k.startsWith("_"))
    .map(k => config.camps[k]).concat([config.shelter])
    .map(o => ({ x: o.x, z: o.z }));
  suit.initSuit(config, story_data, {
    S, tempAt, toast: hud.toast, fail: endings.fail, getDens: fauna.getDens,
    waterPos: config.sites.water, oxyPositions
  });

  controller.initController(config, story_data, {
    THREE, S, cam, getPlayer: rig.getPlayer, getHands: rig.getHands,
    setHandPose: rig.setHandPose, heightAt: terrain.heightAt,
    toast: hud.toast, visorEl: document.getElementById("visor"),
    actions: {
      interact,
      openLog: panels.openLog,
      openChart: chart.openChart,
      transmit: endings.transmit,
      closeOverlay: panels.closeOverlay,
      cancelSurvey: panels.cancelSurvey,
      toggleFps: hud.toggleFps,
      toggleDebug: () => debug.toggleDebug(),
      toggleMute: sound.toggleMute
    }
  });

  // THE CLOCK STARTING AND THE MANIFEST ARRIVING ARE ONE EVENT. Vantaa's last entry
  // is where both come from, and routing the backstop through the same path is the
  // point: a player who never reaches camp five must not end up with a running
  // clock and nothing to spend it on.
  clock.onClockStart(() => manifest.grant());
  manifest.onGrant(() => hud.renderManifest());

  // a lost site fires this; the reference redrew the manifest and toasted (ref 1130-1131)
  manifest.onLost(c => {
    hud.renderManifest();
    hud.toast(story_data.toasts.siteLostTemplate.replace("{name}", () => hud.esc(c.n)), 6500);
  });

  // ---- world generation, in the one order that keeps the world stable ----
  initNoise(config.terrain.noiseSeed);   // draw-set #1: permutation table (255 draws)
  fauna.buildDens();                      // draw-set #2: den positions (52 draws)
  // init() sequence (ref 365-366):
  sky.buildSky();                         // no draws
  terrain.buildTerrain();                 // no draws
  terrain.buildFarHills();                // draws
  grass.buildGrass();                     // draws (via refill)
  jungle.buildJungle();

  // an on-screen readout, because the only person who can see this game cannot open
  // a browser console on a phone. G, or the "?" button.
  debug.initDebug(config, story_data, {
    renderer, scene, S, THREE, heightAt: terrain.heightAt, jungleStats: jungle.stats
  });                   // draws — five instanced layers plus the water
  fauna.buildStriders();                  // draws
  props.buildPlaces();                    // draws
  fauna.buildDenMeshes();                 // no draws (the reference built these at the tail of buildPlaces)
  rig.buildPlayer();                      // no draws
  rig.buildHands();                       // no draws
  sky.buildDust();                        // draws
  sky.buildGlare();                       // no draws

  // ---- lights (ref 367-375) ----
  // one warm key (the fixed low sun) against two cool fills — that separation is
  // what gives the ground shape; matching their colour flattens it.
  sun = new THREE.DirectionalLight(Number(config.render.sunColour), config.render.sunIntensity);
  sun.castShadow = true;
  const shadowSize = onMobile ? config.mobile.shadowMapSize : config.render.shadowMapSize;
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  const d = config.render.shadowCameraExtent;
  sun.shadow.camera.left = -d; sun.shadow.camera.right = d;
  sun.shadow.camera.top = d; sun.shadow.camera.bottom = -d;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 1500; sun.shadow.bias = config.render.shadowBias;
  scene.add(sun); scene.add(sun.target);
  scene.add(new THREE.HemisphereLight(Number(config.render.hemisphereSky), Number(config.render.hemisphereGround),
    config.render.hemisphereIntensity));
  const bounce = new THREE.DirectionalLight(Number(config.render.bounceColour), config.render.bounceIntensity);
  bounce.position.set(-600, 300, 300); scene.add(bounce);

  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix();
  });

  // The phone profile is applied here, after every build, and it only ever
  // reduces what is DRAWN — never what was generated. A phone and a desktop
  // therefore walk the same canyon with the same rocks in the same places.
  if (onMobile) {
    const m = config.mobile;
    grass.applyDowngrade(m.grassMultiplier);
    jungle.applyDowngrade(m.jungleMultiplier);
    fauna.applyDowngrade(m.striderMultiplier);
    sky.applyDowngrade(m.dustMultiplier);
    textures.setQuality(m.textureScale);
  }

  // there is no other view: the visor is always on and the gloves are always up
  document.getElementById("visor").style.display = "block";
  rig.getHands().visible = true;
  rig.getPlayer().visible = false;

  hud.renderManifest();
  animate();
}

// The combined interaction target (ref 770-780): a surveyable criterion first,
// then a readable Meridian grave / camp / shelter.
function currentTarget() {
  const c = manifest.targetCrit();
  if (c) return { k: "crit", o: c, label: story_data.ui.promptSurveyTemplate.replace("{name}", () => c.n) };
  return story.targetReadable();
}
// ref 781-788
function interact() {
  const t = currentTarget();
  if (!t) { hud.toast(story_data.toasts.nothingHere, 1500); return; }
  if (t.k === "crit") { panels.startSurvey(t.o); return; }
  if (t.k === "grave") return story.readGrave(t.o);
  if (t.k === "camp") return story.readCamp(t.o);
  if (t.k === "last") return story.readLast();
}

// ---- the loop (ref 1092-1220) ----
let last = performance.now(), fA = 0, fN = 0, tuned = false, manT = 0;
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now(), dt = Math.min(.05, (now - last) / 1000); last = now;
  const paused = !!document.querySelector(".overlay.on");
  if (paused) controller.clearKeys();

  // automatic quality downgrade if the first ~140 frames run below target fps (ref 1098-1101)
  const dg = config.render.downgrade;
  if (!tuned && S.started) {
    fA += 1 / Math.max(dt, .001); fN++;
    if (fN > dg.sampleFrames) {
      tuned = true;
      if (fA / fN < dg.fpsThreshold) {
        if (dg.disableShadows) renderer.shadowMap.enabled = false;
        grass.applyDowngrade();
        jungle.applyDowngrade(dg.jungleMultiplier);
        renderer.setPixelRatio(dg.pixelRatio);
        // redraw every generated map at half size, in place
        textures.setQuality(dg.textureScale);
      }
    }
  }

  // The wall clock always advances; mission time only advances once the clock has
  // started, and the grace countdown only runs while the sim is actually running.
  // One call, so there is exactly one place in the codebase that moves either.
  const running = S.started && !paused && !S.dead && !S.ended;
  clock.tick(dt, running);

  if (running) {
    controller.updateMovement(dt);          // ref 1105-1123
    // how much of the sun the rock is taking off this patch of ground. Everything
    // that asks for a temperature this frame is handed it.
    S.shade = terrain.shadeAt(S.px, S.pz);
    chart.markSeen();                        // ref 1125
    grass.maybeRefill(S.t);                  // ref 1126
    panels.tickSurvey(dt);                   // ref 1127
    manifest.updateLost();                   // ref 1129-1131 (fires onLost)
    suit.update(dt, now);                    // ref 1133-1147
    manT += dt; if (manT > config.timing.manifestRefreshInterval) { manT = 0; hud.renderManifest(); } // ref 1149
  }

  // everything below runs every frame, even while an overlay is up (ref 1152-1219)
  const gy = terrain.heightAt(S.px, S.pz);
  const player = rig.getPlayer();
  player.position.set(S.px, gy, S.pz);
  let hd = ((S.heading - player.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  player.rotation.y += hd * Math.min(1, dt * config.gait.bodyTurnRate);

  // gait: pure poseFor computes the angles, rig applies them (ref 1159-1173)
  rig.applyPose(poseFor(S.bob, S.speed, S.speed > config.gait.runThreshold));

  // sun follows the player (ref 1175-1176)
  sun.target.position.set(S.px, gy, S.pz); sun.target.updateMatrixWorld();
  // one elevation drives the light, the sky and the shade march, so the shadow you
  // can see on the rock is the shadow that is keeping you alive
  sun.position.set(S.px + SUNDIR.x * SUN_D * SUN_COS, gy + SUN_D * SUN_SIN, S.pz + SUNDIR.z * SUN_D * SUN_COS);

  // animation only, so these ride the wall clock and keep running through the
  // grace period: the world has to be alive before the clock is.
  // the dawn line's position is what turns the jungle from a model into one day of
  // growth: still coming up ahead of it, full at it, browning and then burning behind
  jungle.setGrowth(dawnX(S.t), S.animT);
  grass.setWind(S.animT);                    // ref 1177
  controller.updateCamera(dt);               // ref 1179-1194
  sky.updateDust(S.px, S.pz, gy, S.animT);   // ref 1195-1196
  // the herd's band is pinned to the dawn line (mission time, so it holds still
  // during the grace period); their gait is animation (wall clock, so they walk)
  fauna.updateStriders(S.t, S.animT);        // ref 1197

  hud.updateFps(dt);                         // measuring tool, toggled with F
  hud.updateGauges();                        // ref 1199
  hud.updateReadouts(gy);                    // ref 1200-1207
  hud.updateHeat();                          // ref 1208
  const tgt = currentTarget();
  hud.updatePrompt(tgt);                     // ref 1210-1216
  touch.updateTouchPrompt(tgt);

  compass.drawCompass();                     // ref 1218
  compass.drawSound();                       // ref 1218
  // after drawSound, so the ears use the herd bearing and the null it just wrote
  sound.updateAudio(S, dt);
  renderer.render(scene, cam);               // ref 1219
}
