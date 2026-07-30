// player/rig.js — the surveyor rig: third-person body, first-person hands, and
// the per-frame pose application. applyPose assigns the angles gait.js already
// computed (ref 1162-1173); no gait math lives here.
//
// The skeleton is FIXED and the animation depends on it: legL/legR/armL/armR are
// Groups that rotate at the hip/shoulder, each holds .userData.lower as a Group
// that rotates at the knee/elbow and sits at y = -upperLength, and
// player.userData.torso is the torso pivot. Segment lengths (.42/.40 legs,
// .32/.30 arms) and the attach points (hips ±.135 at y .86, shoulders ±.335 at
// y 1.46) are load-bearing numbers — the form hung on them can change, they
// cannot.
//
// Neither buildPlayer nor buildHands draws from the world PRNG. They did not
// before and they must not now: main.js consumes one seeded stream in a fixed
// order and one extra draw here moves every rock in the world. All the variation
// on the suit comes from the texture library's own integer hash instead.

import * as tex from "../world/textures.js";

let THREE, scene, cam, heightAt, S;
let CFG = null;
let armR_fp = null, armL_fp = null, lastYaw = null, sway = 0, raiseNow = 0;
let player, hands, legL, legR, armL, armR;
let MATS = null;

// TODO(lead): lift into config.json. Everything here is a look, not a shape:
// colours, surface response, how hard the generated maps push, and the four
// silhouette depths. The lathe profiles below are geometry definition and stay
// in code.
const TUNING = {
  // --- colours -------------------------------------------------------------
  shellTint:      0xf0ede6,   // hard suit shell (multiplies the shell colour map)
  shellWornTint:  0xa9a396,   // same maps, grimier: knees, elbows, the pack
  fabricTint:     0x9aa0a4,   // soft limb sections
  fittingTint:    0x3a3f46,   // dark hardware: collar, belt, boots, hoses, straps
  visorTint:      0x1b222b,
  accentTint:     0xe0793f,
  displayTint:    0x8fc6d4,   // the scanner face in first person

  // --- surface response ----------------------------------------------------
  shellRoughness:   0.85, shellMetalness:   0.10,
  wornRoughness:    1.00,
  fabricRoughness:  1.00, fabricMetalness:  0.00,
  fittingRoughness: 0.44, fittingMetalness: 0.55,
  visorRoughness:   0.07, visorMetalness:   0.95,
  accentRoughness:  0.72, accentMetalness:  0.05,

  // --- the generated horizon the suit reflects -----------------------------
  visorEnvIntensity:   1.55,
  fittingEnvIntensity: 0.55,
  shellEnvIntensity:   0.30,
  fabricEnvIntensity:  0.12,
  visorSunWidth:       0.20,  // how wide the warm band is, in turns of azimuth
  visorBandHeight:     0.22,  // how far up from the horizon it reaches

  // --- generated maps ------------------------------------------------------
  shellRepeat:   [2, 2],
  fabricRepeat:  [4, 4],
  fittingRepeat: [3, 3],
  panelNormalStrength:   3.4,
  fabricNormalStrength:  0.9,
  fittingNormalStrength: 2.2,
  panelSeamWidth: 0.010,   // in uv
  panelSeamDepth: 0.60,
  panelPlateStep: 0.10,    // how far neighbouring plates sit off each other
  bootUvScale:    6,       // ExtrudeGeometry uvs are in model units; scale to tile

  // --- silhouette ----------------------------------------------------------
  torsoDepth:    0.80,   // front-to-back squash of the torso lathe
  hipDepth:      0.88,
  packDepth:     0.60,
  shoulderX:     0.296,
  shoulderY:     1.455,
  shoulderScale: [1.20, 0.92, 1.10],
  hoseRadius:    0.021,
  strapRadius:   0.019,
  bootWidth:     0.148,
  bootBevel:     0.012,
  bootLift:      0.023   // keeps the sole at the reference foot's -0.055 below the origin
};

export function initRig(config, story, deps){
  CFG = config;
  THREE = deps.THREE;
  scene = deps.scene;
  cam = deps.cam;
  heightAt = deps.heightAt;
  S = deps.S;
}

/* ------------------------------------------------------------------ *
 *  Generated maps. Nothing here touches the world PRNG — the variation
 *  is tex.hash2 / tex.fbmTile, which have their own constant seed.
 * ------------------------------------------------------------------ */

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const mix = (a, b, t) => a + (b - a) * t;

// 1 at the seam, 0 by `w` away from it, smooth in between.
const groove = (d, w) => { if (d >= w) return 0; const t = d / w; return 1 - t * t * (3 - 2 * t); };

// The plate layout, shared by the shell's colour, normal and wear maps so their
// seams land on top of each other. It tiles: the row count is whole, the column
// count per row is whole, and the per-row phase only slides a whole period along.
const PANEL_ROWS = 4;
function panelAt(u, v){
  const fy = v * PANEL_ROWS, iy = Math.floor(fy), ty = fy - iy;
  const dy = Math.min(ty, 1 - ty) / PANEL_ROWS;
  const cols = 2 + Math.floor(tex.hash2(iy, 3, 1301) * 3);        // 2..4 plates across
  const fx = u * cols + tex.hash2(iy, 9, 1301);
  const ix = Math.floor(fx), tx = fx - ix;
  const dx = Math.min(tx, 1 - tx) / cols;
  const ic = ((ix % cols) + cols) % cols;
  return {
    seam: Math.max(groove(dx, TUNING.panelSeamWidth), groove(dy, TUNING.panelSeamWidth)),
    plate: tex.hash2(ic, iy, 77) - 0.5
  };
}

// Height for the shell normal map: plates that sit slightly off each other,
// a recessed seam between them, then grain and a pass of fine scratches.
function shellHeight(u, v){
  const p = panelAt(u, v);
  return 0.5
    + p.plate * TUNING.panelPlateStep
    - p.seam * TUNING.panelSeamDepth
    + (tex.fbmTile(u, v, 16, 3, 211) - 0.5) * 0.10
    + (tex.ridgeTile(u, v, 40, 2, 617) - 0.5) * 0.05;
}

const paintShell = size => tex.fillPixels(size, (x, y, px, i) => {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  const p = panelAt(u, v);
  const dust = clamp01((tex.fbmTile(u, v, 3, 4, 733) - 0.42) * 1.9);
  const g = 0.82 + p.plate * 0.055 + (tex.fbmTile(u, v, 9, 3, 311) - 0.5) * 0.09
          - p.seam * 0.22 - dust * 0.10;
  px[i]     = (g + dust * 0.055) * 255;   // dust reads warm against the shell
  px[i + 1] = (g + dust * 0.012) * 255;
  px[i + 2] = (g - dust * 0.060) * 255;
  px[i + 3] = 255;
});

// Roughness: dust catches in the seams and the low ground, and the places a
// hand or the ground has rubbed come back smoother.
const paintWear = size => tex.greyPixels(size, (u, v) => {
  const p = panelAt(u, v);
  const dust = clamp01((tex.fbmTile(u, v, 3, 4, 733) - 0.42) * 1.9);
  const rub  = clamp01((tex.fbmTile(u, v, 5, 2, 977) - 0.54) * 2.4);
  return 0.60 + dust * 0.26 - rub * 0.24 + p.seam * 0.14
       + (tex.fbmTile(u, v, 14, 3, 401) - 0.5) * 0.10;
});

// A woven cloth: a warp thread runs down every column, a weft across every row,
// and which one is on top alternates at each crossing. WEAVE is whole, so both
// thread sets close on themselves at the tile edge.
const WEAVE = 24;
function weaveAt(u, v){
  const fu = u * WEAVE, fv = v * WEAVE;
  const iu = Math.floor(fu), iv = Math.floor(fv);
  const tu = fu - iu, tv = fv - iv;
  const warp = Math.sin(Math.PI * tu);       // cross-section of the vertical thread
  const weft = Math.sin(Math.PI * tv);       // cross-section of the horizontal one
  const over = ((iu + iv) & 1) === 0;
  return over ? warp * 0.85 + weft * 0.28 : weft * 0.85 + warp * 0.28;
}

function fabricHeight(u, v){
  return weaveAt(u, v) * 0.55
    + (tex.fbmTile(u, v, 10, 3, 55) - 0.5) * 0.16      // slack in the cloth
    + (tex.ridgeTile(u, v, 20, 2, 89) - 0.5) * 0.08;   // fibre
}

const paintFabric = size => tex.fillPixels(size, (x, y, px, i) => {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  const w = weaveAt(u, v);
  const dust = clamp01((tex.fbmTile(u, v, 4, 3, 619) - 0.44) * 1.8);
  const g = 0.70 + w * 0.13 + (tex.fbmTile(u, v, 7, 3, 143) - 0.5) * 0.08 - dust * 0.13;
  px[i]     = (g + dust * 0.050) * 255;
  px[i + 1] = (g + dust * 0.010) * 255;
  px[i + 2] = (g - dust * 0.048) * 255;
  px[i + 3] = 255;
});

const paintFabricRough = size => tex.greyPixels(size, (u, v) =>
  0.88 + (tex.fbmTile(u, v, 8, 3, 131) - 0.5) * 0.14 - weaveAt(u, v) * 0.07);

// Dark hardware: brushed one way (constant in v, so the streaks run along the
// thread of the part) with three machined rings across the tile. The two stream
// periods stay coarse enough to be resolved at half size too — noise finer than
// about four pixels per cell is just static, and it aliases when it mips.
function fittingHeight(u, v){
  const fv = v * 3, tv = fv - Math.floor(fv);
  const dv = Math.min(tv, 1 - tv) / 3;
  return 0.5
    + (tex.valueNoise(u, 0.5, 20, 313) - 0.5) * 0.30
    + (tex.valueNoise(u, 0.5, 48, 917) - 0.5) * 0.16
    + (tex.fbmTile(u, v, 8, 2, 451) - 0.5) * 0.10
    - groove(dv, 0.010) * 0.35;
}

// The environment the visor reflects. There is no cube map in this project and
// there will not be one: r128 converts an equirectangular texture to a cube on
// first use, so a 256px canvas is enough to give the visor a horizon.
// Layout: canvas top row is the zenith, and the sun sits dead centre because the
// key light is fixed at world +x, which equirect sampling puts at u = 0.5.
const paintVisorEnv = size => tex.fillPixels(size, (x, y, px, i) => {
  const u = (x + 0.5) / size;
  const up = 1 - (y + 0.5) / size;              // 0 nadir .. 1 zenith
  const el = (up - 0.5) * 2;
  let da = Math.abs(u - 0.5); if (da > 0.5) da = 1 - da;
  const az = Math.max(0, 1 - da / TUNING.visorSunWidth);
  let r, g, b;
  if (el >= 0) {
    const k = Math.pow(el, 0.55);               // sky falls off fast above the haze
    r = mix(0.46, 0.030, k); g = mix(0.40, 0.045, k); b = mix(0.34, 0.078, k);
    const band = Math.max(0, 1 - el / TUNING.visorBandHeight) * az;
    r += band * 0.80; g += band * 0.42; b += band * 0.17;
    const core = Math.pow(Math.max(0, 1 - da / 0.030), 2) * Math.max(0, 1 - el / 0.045);
    r += core * 1.30; g += core * 0.95; b += core * 0.55;
  } else {
    const k = Math.min(1, -el / 0.55);          // ground, warm and much darker
    r = mix(0.22, 0.045, k); g = mix(0.182, 0.038, k); b = mix(0.150, 0.033, k);
    const w = az * (1 - k) * 0.9;
    r += w * 0.20; g += w * 0.11; b += w * 0.05;
  }
  const n = (tex.fbmTile(u, up, 5, 3, 61) - 0.5) * 0.05;
  px[i] = (r + n) * 255; px[i + 1] = (g + n) * 255; px[i + 2] = (b + n) * 255; px[i + 3] = 255;
});

const paintScanner = size => tex.fillPixels(size, (x, y, px, i) => {
  const u = (x + 0.5) / size, v = (y + 0.5) / size;
  const rows = 0.55 + 0.45 * (Math.floor(v * 14) % 2);
  const trace = Math.max(0, 1 - Math.abs(v - (0.34 + 0.14 * tex.valueNoise(u, 0.5, 8, 5))) / 0.05);
  const k = (0.30 * rows + 0.75 * trace) * (0.9 + 0.1 * tex.valueNoise(u, v, 24, 41));
  px[i] = k * 90; px[i + 1] = k * 200; px[i + 2] = k * 215; px[i + 3] = 255;
});

/* ------------------------------------------------------------------ *
 *  Six materials for the whole suit. Both views share them, because it
 *  is the same suit. Built on first use — the texture library is only
 *  ready after main.js calls initTextures.
 * ------------------------------------------------------------------ */

function suitMaterials(){
  if (MATS) return MATS;
  const T = TUNING;

  const shellMap = tex.texture("suitShell", tex.sizeFor("suitShell", 256), paintShell,
    { repeat: T.shellRepeat, srgb: true });
  const shellNrm = tex.normalTexture("suitPanelNormal", tex.sizeFor("suitPanel", 512),
    shellHeight, T.panelNormalStrength, { repeat: T.shellRepeat });
  const shellRgh = tex.texture("suitWear", tex.sizeFor("suitWear", 256), paintWear,
    { repeat: T.shellRepeat });

  const fabMap = tex.texture("suitFabric", tex.sizeFor("suitFabric", 256), paintFabric,
    { repeat: T.fabricRepeat, srgb: true });
  const fabNrm = tex.normalTexture("suitFabricNormal", tex.sizeFor("suitFabric", 256),
    fabricHeight, T.fabricNormalStrength, { repeat: T.fabricRepeat });
  const fabRgh = tex.texture("suitFabricRough", tex.sizeFor("suitFabric", 256), paintFabricRough,
    { repeat: T.fabricRepeat });

  const fitNrm = tex.normalTexture("suitFittingNormal", tex.sizeFor("metalNormal", 256),
    fittingHeight, T.fittingNormalStrength, { repeat: T.fittingRepeat });

  const env = tex.texture("visorEnv", tex.sizeFor("visor", 256), paintVisorEnv, { srgb: true });
  if (env) {
    env.mapping = THREE.EquirectangularReflectionMapping;
    env.wrapT = THREE.ClampToEdgeWrapping;   // an equirect must not wrap over the poles
  }

  const scanMap = tex.texture("suitScanner", tex.sizeFor("scanner", 128), paintScanner, { srgb: true });

  const shell = new THREE.MeshStandardMaterial({
    color: T.shellTint, roughness: T.shellRoughness, metalness: T.shellMetalness,
    map: shellMap, normalMap: shellNrm, roughnessMap: shellRgh,
    envMap: env, envMapIntensity: T.shellEnvIntensity
  });
  // same maps, dirtier scalars — the knees, the elbows and the pack
  const worn = new THREE.MeshStandardMaterial({
    color: T.shellWornTint, roughness: T.wornRoughness, metalness: T.shellMetalness,
    map: shellMap, normalMap: shellNrm, roughnessMap: shellRgh,
    envMap: env, envMapIntensity: T.shellEnvIntensity * 0.6
  });
  const fabric = new THREE.MeshStandardMaterial({
    color: T.fabricTint, roughness: T.fabricRoughness, metalness: T.fabricMetalness,
    map: fabMap, normalMap: fabNrm, roughnessMap: fabRgh,
    envMap: env, envMapIntensity: T.fabricEnvIntensity
  });
  const fitting = new THREE.MeshStandardMaterial({
    color: T.fittingTint, roughness: T.fittingRoughness, metalness: T.fittingMetalness,
    normalMap: fitNrm, envMap: env, envMapIntensity: T.fittingEnvIntensity
  });
  const visor = new THREE.MeshStandardMaterial({
    color: T.visorTint, roughness: T.visorRoughness, metalness: T.visorMetalness,
    envMap: env, envMapIntensity: T.visorEnvIntensity
  });
  const accent = new THREE.MeshStandardMaterial({
    color: T.accentTint, roughness: T.accentRoughness, metalness: T.accentMetalness,
    roughnessMap: shellRgh
  });
  const display = new THREE.MeshBasicMaterial({ color: T.displayTint, map: scanMap });

  MATS = { shell, worn, fabric, fitting, visor, accent, display };
  return MATS;
}

/* ------------------------------------------------------------------ *
 *  Geometry helpers
 * ------------------------------------------------------------------ */

const V2 = (x, y) => new THREE.Vector2(x, y);

// LatheGeometry winds its faces assuming the profile runs bottom to top. Every
// point list below is ordered that way; reversing one turns the part inside out.

// One limb segment: w1 at the joint above, w2 at the joint below, spanning
// y = 0 down to y = -L exactly, with a little muscle high up where a limb has it.
function segProfile(w1, w2, L){
  return [
    V2(w2 * 0.88, -L),
    V2(w2 * 1.02, -L * 0.945),
    V2(w2 * 1.08, -L * 0.870),
    V2(w2 * 1.10, -L * 0.740),
    V2(w1 * 0.62 + w2 * 0.38, -L * 0.500),
    V2(w1 * 1.00, -L * 0.290),
    V2(w1 * 1.06, -L * 0.155),
    V2(w1 * 1.00, -L * 0.050),
    V2(w1 * 0.86, 0)
  ];
}

// A boot, drawn as a side profile and extruded across. Shape x is forward (+z),
// shape y is up; the mesh is turned a quarter turn so the extrusion runs across
// the foot. Origin is the ankle, so it hangs off the bottom of the shin.
function bootGeometry(){
  const s = new THREE.Shape();
  s.moveTo(-0.098, -0.052);
  s.lineTo(-0.092, -0.098);
  s.lineTo( 0.146, -0.106);
  s.lineTo( 0.202, -0.090);
  s.lineTo( 0.220, -0.052);
  s.lineTo( 0.202, -0.014);
  s.lineTo( 0.118,  0.020);
  s.lineTo( 0.040,  0.038);
  s.lineTo(-0.042,  0.040);
  s.lineTo(-0.090,  0.012);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, {
    depth: TUNING.bootWidth, steps: 1, curveSegments: 1, bevelEnabled: true,
    bevelThickness: TUNING.bootBevel, bevelSize: TUNING.bootBevel, bevelSegments: 2
  });
  // ExtrudeGeometry's uvs are in model units (~0.3 across), which would stretch
  // one texel over the whole boot. Scale them up so the maps tile on it.
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TUNING.bootUvScale, uv.getY(i) * TUNING.bootUvScale);
  return g;
}

// A hose or a strap: a tube through a handful of points, mirrored by sign.
function tubeThrough(pts, radius, radial, segs){
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs, radius, radial, false);
}

/* ------------------------------------------------------------------ *
 *  buildPlayer — the third-person figure. ZERO rand() draws, as before.
 * ------------------------------------------------------------------ */

export function buildPlayer(){
  player = new THREE.Group();
  const M = suitMaterials();
  const cast = o => { o.castShadow = true; return o };

  const torsoPivot = new THREE.Group(); player.add(torsoPivot);

  // --- torso: one lathe from the hip tuck to the neck opening, squashed
  //     front-to-back so it reads as a chest and not a barrel.
  const torso = cast(new THREE.Mesh(new THREE.LatheGeometry([
    V2(0.150, 0.845), V2(0.205, 0.868), V2(0.248, 0.900), V2(0.268, 0.945),
    V2(0.271, 0.995), V2(0.262, 1.055), V2(0.257, 1.115), V2(0.266, 1.190),
    V2(0.283, 1.262), V2(0.298, 1.342), V2(0.301, 1.410), V2(0.292, 1.466),
    V2(0.262, 1.512), V2(0.215, 1.548), V2(0.150, 1.575)
  ], 22), M.shell));
  torso.scale.z = TUNING.torsoDepth; torsoPivot.add(torso);

  // --- shoulders: the single biggest thing the silhouette was missing. These
  //     stay on the chest rather than the arm so they do not swing with it.
  const capGeo = new THREE.SphereGeometry(0.118, 14, 10);
  const sc = TUNING.shoulderScale;
  for (const sx of [1, -1]) {
    const cap = cast(new THREE.Mesh(capGeo, M.shell));
    cap.scale.set(sc[0], sc[1], sc[2]);
    cap.position.set(sx * TUNING.shoulderX, TUNING.shoulderY, 0);
    torsoPivot.add(cap);
  }

  // --- collar: a thick ring the helmet locks into, plus its seal above it
  const collar = cast(new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.042, 8, 24), M.fitting));
  collar.rotation.x = Math.PI / 2; collar.position.y = 1.600; torsoPivot.add(collar);
  const seal = new THREE.Mesh(new THREE.TorusGeometry(0.172, 0.017, 6, 24), M.fitting);
  seal.rotation.x = Math.PI / 2; seal.position.y = 1.648; torsoPivot.add(seal);

  // --- helmet: spherical across the whole visor band so the visor stays proud
  //     of it, then a tapered neck below and a slight crown flare above that
  //     overhangs the visor like a hood.
  const HR = 0.232, HY = 1.79;
  const helm = [V2(0.150, 1.575), V2(0.155, 1.596), V2(0.166, 1.626), V2(0.186, 1.658), V2(0.208, 1.690)];
  for (let i = 0; i <= 12; i++) {
    const yr = -0.060 + 0.256 * i / 12;
    helm.push(V2(Math.sqrt(Math.max(0, HR * HR - yr * yr)), HY + yr));
  }
  helm.push(V2(0.128, HY + 0.206), V2(0.120, HY + 0.212), V2(0.097, HY + 0.219),
            V2(0.058, HY + 0.225), V2(0.000, HY + 0.230));
  torsoPivot.add(cast(new THREE.Mesh(new THREE.LatheGeometry(helm, 22), M.shell)));

  // --- visor. Centred on +z, which is the direction the figure walks: the
  //     reference had it centred on -x, i.e. on the back of the head.
  const vs = new THREE.Mesh(
    new THREE.SphereGeometry(0.238, 24, 14, Math.PI / 2 - 0.95, 1.90, 0.60, 1.02), M.visor);
  vs.position.y = HY; torsoPivot.add(vs);

  // --- the housing the head lamp comes out of
  const lampCase = new THREE.Mesh(new THREE.CylinderGeometry(0.030, 0.038, 0.090, 10), M.fitting);
  lampCase.rotation.x = Math.PI / 2; lampCase.position.set(0.112, 1.918, 0.150); torsoPivot.add(lampCase);

  // --- pack: closed at both ends, squashed to a slab, worn material
  const pack = cast(new THREE.Mesh(new THREE.LatheGeometry([
    V2(0.000, 0.968), V2(0.098, 0.976), V2(0.152, 0.996), V2(0.186, 1.032),
    V2(0.204, 1.090), V2(0.213, 1.180), V2(0.216, 1.300), V2(0.214, 1.420),
    V2(0.205, 1.468), V2(0.180, 1.505), V2(0.136, 1.530), V2(0.076, 1.542),
    V2(0.000, 1.546)
  ], 18), M.worn));
  pack.position.z = -0.30; pack.scale.z = TUNING.packDepth; torsoPivot.add(pack);
  const valve = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.056, 0.055, 10), M.fitting);
  valve.position.set(0, 1.560, -0.30); torsoPivot.add(valve);

  // --- two hoses off the top of the pack into the sides of the collar
  for (const sx of [1, -1]) {
    torsoPivot.add(new THREE.Mesh(tubeThrough([
      new THREE.Vector3(sx * 0.100, 1.495, -0.395),
      new THREE.Vector3(sx * 0.190, 1.540, -0.360),
      new THREE.Vector3(sx * 0.225, 1.588, -0.265),
      new THREE.Vector3(sx * 0.205, 1.606, -0.160),
      new THREE.Vector3(sx * 0.150, 1.602, -0.098)
    ], TUNING.hoseRadius, 6, 24), M.fitting));
  }

  // --- chest harness: webbing over each shoulder down to a buckle
  for (const sx of [1, -1]) {
    torsoPivot.add(new THREE.Mesh(tubeThrough([
      new THREE.Vector3(sx * 0.235, 1.500, -0.075),
      new THREE.Vector3(sx * 0.262, 1.482,  0.100),
      new THREE.Vector3(sx * 0.222, 1.430,  0.196),
      new THREE.Vector3(sx * 0.132, 1.352,  0.232),
      new THREE.Vector3(sx * 0.048, 1.300,  0.228)
    ], TUNING.strapRadius, 4, 20), M.fitting));
  }
  const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.086, 0.030), M.fitting);
  buckle.position.set(0, 1.292, 0.238); buckle.rotation.x = -0.10; torsoPivot.add(buckle);

  // --- the one piece of colour on the whole figure
  const tag = new THREE.Mesh(new THREE.BoxGeometry(0.086, 0.115, 0.016), M.accent);
  tag.position.set(0.196, 1.392, 0.186); tag.rotation.set(-0.06, 0.42, 0); torsoPivot.add(tag);

  // --- hips: dark, closed, with a belt. Sits on `player`, not the torso pivot,
  //     so it does not sway — same as the reference.
  const hips = cast(new THREE.Mesh(new THREE.LatheGeometry([
    V2(0.000, 0.726), V2(0.105, 0.734), V2(0.175, 0.752), V2(0.228, 0.782),
    V2(0.256, 0.818), V2(0.264, 0.852), V2(0.252, 0.884), V2(0.215, 0.906),
    V2(0.140, 0.920), V2(0.000, 0.926)
  ], 18), M.fitting));
  hips.scale.z = TUNING.hipDepth; player.add(hips);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.252, 0.026, 8, 24), M.fitting);
  belt.rotation.x = Math.PI / 2; belt.scale.y = TUNING.hipDepth;   // local y is world z after the turn
  belt.position.y = 0.856; player.add(belt);

  // --- two-segment limbs. The Group structure and every length and attach
  //     point is exactly what applyPose and gait.js expect.
  const limbKit = (uW1, uW2, uLen, lW1, lW2, lLen, jr, foot) => ({
    uLen, lLen, foot,
    ball: new THREE.SphereGeometry(jr, 14, 10),
    up:   new THREE.LatheGeometry(segProfile(uW1, uW2, uLen), 12),
    knee: new THREE.SphereGeometry(uW2 * 1.12, 14, 10),
    lo:   new THREE.LatheGeometry(segProfile(lW1, lW2, lLen), 12),
    end:  new THREE.SphereGeometry(lW2 * 1.1, 12, 10),
    boot: foot ? bootGeometry() : null
  });

  const makeLimb = k => {
    const hip = new THREE.Group();
    const ball = cast(new THREE.Mesh(k.ball, M.shell));
    ball.scale.set(1.00, 0.92, 1.05); hip.add(ball);

    hip.add(cast(new THREE.Mesh(k.up, M.fabric)));            // spans y 0 -> -uLen

    const knee = cast(new THREE.Mesh(k.knee, M.worn));        // takes the ground
    knee.scale.set(1.08, 0.94, 1.22); knee.position.set(0, -k.uLen, 0.012); hip.add(knee);

    const lower = new THREE.Group(); lower.position.y = -k.uLen; hip.add(lower);
    lower.add(cast(new THREE.Mesh(k.lo, M.fabric)));          // spans y 0 -> -lLen

    const end = cast(new THREE.Mesh(k.end, k.foot ? M.fitting : M.shell));
    if (k.foot) { end.scale.set(1.10, 0.72, 1.05); }          // ankle cuff
    else { end.scale.set(1.02, 0.94, 1.30); end.position.z = 0.012; }   // glove
    end.position.y = -k.lLen; lower.add(end);

    if (k.foot) {
      const b = cast(new THREE.Mesh(k.boot, M.fitting));
      b.rotation.y = -Math.PI / 2;                            // extrusion runs across the foot
      b.position.set(TUNING.bootWidth / 2, -k.lLen + TUNING.bootLift, 0);
      lower.add(b);
    }
    hip.userData.lower = lower;
    return hip;
  };

  const legKit = limbKit(.118, .100, .42, .098, .084, .40, .128, true);
  const armKit = limbKit(.086, .072, .32, .070, .060, .30, .098, false);
  legL = makeLimb(legKit); legL.position.set(.135, .86, 0); player.add(legL);
  legR = makeLimb(legKit); legR.position.set(-.135, .86, 0); player.add(legR);
  armL = makeLimb(armKit); armL.position.set(.335, 1.46, 0); torsoPivot.add(armL);
  armR = makeLimb(armKit); armR.position.set(-.335, 1.46, 0); torsoPivot.add(armR);
  player.userData.torso = torsoPivot;

  const lamp = new THREE.PointLight(0xffe4bc, .7, 20); lamp.position.set(0, 1.72, .42); player.add(lamp);
  player.position.set(S.px, heightAt(S.px, S.pz), S.pz); scene.add(player);
}

/* ------------------------------------------------------------------ *
 *  buildHands — first person. Same materials, because it is the same
 *  suit. ZERO rand() draws, as before.
 * ------------------------------------------------------------------ */

export function buildHands(){
  hands = new THREE.Group();
  const M = suitMaterials();
  const H = (CFG.player && CFG.player.hands) || {};

  // A limb segment that hangs from its own origin down -y, so a parent group's
  // rotation.x swings it forward (toward -z, which is where the camera looks).
  const limb = (rTop, rBot, len) => {
    const pts = [];
    for(let i = 0; i <= 6; i++){
      const t = i / 6;
      pts.push(new THREE.Vector2(Math.max(.002, rTop + (rBot - rTop) * t), -len * t));
    }
    pts.push(new THREE.Vector2(.002, -len));
    return new THREE.LatheGeometry(pts, 12);
  };

  const upperGeo = limb(H.upperTopR, H.upperBotR, H.upperLen);
  const foreGeo  = limb(H.foreTopR,  H.foreBotR,  H.foreLen);
  const cuffGeo  = new THREE.TorusGeometry(H.foreBotR + .006, .014, 6, 14);
  const gloveGeo = new THREE.SphereGeometry(H.gloveR, 12, 10);

  // shoulder -> upper arm -> elbow -> forearm -> glove.
  // Before this there was no shoulder and no elbow: one forearm rotated 84
  // degrees, so both arms pointed straight out of the chest, permanently.
  const mkArm = side => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * H.shoulderX, H.shoulderY, H.shoulderZ);

    const up = new THREE.Mesh(upperGeo, M.fabric);
    shoulder.add(up);

    const elbow = new THREE.Group();
    elbow.position.y = -H.upperLen;
    shoulder.add(elbow);

    const el = new THREE.Mesh(new THREE.SphereGeometry(H.upperBotR * 1.15, 10, 8), M.fabricWorn || M.fabric);
    elbow.add(el);

    const f = new THREE.Mesh(foreGeo, M.fabric);
    elbow.add(f);

    const cuff = new THREE.Mesh(cuffGeo, M.fitting);
    cuff.rotation.x = Math.PI / 2; cuff.position.y = -H.foreLen + .02; elbow.add(cuff);

    const gl = new THREE.Mesh(gloveGeo, M.shell);
    gl.scale.set(1, 1.08, .92);
    gl.position.y = -H.foreLen - H.gloveR * .5;
    elbow.add(gl);

    shoulder.userData = { elbow, glove: gl, side };
    return shoulder;
  };

  armR_fp = mkArm(1); armL_fp = mkArm(-1);

  // the scanner rides the right glove, so it moves with the hand
  const scan = new THREE.Mesh(new THREE.BoxGeometry(.10, .055, .15), M.fitting);
  scan.position.set(0, .01, -.06); armR_fp.userData.glove.add(scan);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(.072, .032), M.display);
  face.position.set(0, .032, -.06); face.rotation.x = -Math.PI / 2.4;
  armR_fp.userData.glove.add(face);

  hands.add(armR_fp); hands.add(armL_fp);
  hands.visible = true; cam.add(hands); scene.add(cam);
  setHandPose(0, 0, 0, 0);
}

/* Pose the first-person arms.
 *   raise  0..1  — 0 is arms down and out of frame, 1 is scanner up and readable
 *   phase        — gait phase, for opposed sway
 *   k      0..1  — how fast the player is moving
 *   yaw          — current camera yaw, for the arms to lag behind a turn
 */
export function setHandPose(raise, phase, k, yaw){
  if(!armR_fp) return;
  const H = (CFG.player && CFG.player.hands) || {};

  raiseNow += (raise - raiseNow) * (H.raiseSmoothing || .12);
  const r = raiseNow;

  // arms lag a fast turn and settle back — this is most of what sells them
  if(lastYaw === null) lastYaw = yaw;
  let d = yaw - lastYaw;
  while(d >  Math.PI) d -= Math.PI * 2;
  while(d < -Math.PI) d += Math.PI * 2;
  lastYaw = yaw;
  sway += (d * (H.swayGain || 1.6) - sway) * (H.swaySmoothing || .18);
  sway *= (H.swayDecay || .90);
  hands.rotation.y = Math.max(-.5, Math.min(.5, sway));

  const lerp = (a, b, t) => a + (b - a) * t;
  [armR_fp, armL_fp].forEach(arm => {
    const isR = arm.userData.side > 0;
    const bias = isR ? 0 : (H.leftBias || .10);   // never symmetrical
    const rr = isR ? r : r * (H.leftRaiseShare || .45);

    // opposed gait swing, and the arms still swing a little when idle
    const sw = Math.sin(phase + (isR ? 0 : Math.PI)) * (H.gaitSwing || .16) * k * (1 - rr * .7);

    arm.rotation.x = lerp(H.restShoulder, H.raiseShoulder, rr) + bias + sw;
    arm.rotation.z = arm.userData.side * lerp(H.restShoulderOut, H.raiseShoulderOut, rr);
    arm.userData.elbow.rotation.x = lerp(H.restElbow, H.raiseElbow, rr) - sw * .5;
    arm.userData.elbow.rotation.y = arm.userData.side * lerp(H.restElbowTwist, H.raiseElbowTwist, rr);
  });

  hands.position.y = -Math.abs(Math.sin(phase)) * (H.bobY || .012) * k;
  hands.rotation.x = Math.sin(phase * .5) * (H.bobPitch || .03) * k;
}

// Assign the joint angles gait.js already computed. No gait math lives here.
// (ref 1162-1173, values now read from `pose` instead of recomputed)
export function applyPose(pose){
  legL.rotation.x=pose.thighL; legR.rotation.x=pose.thighR;
  legL.userData.lower.rotation.x=pose.kneeL; legR.userData.lower.rotation.x=pose.kneeR;
  armL.rotation.x=pose.shoulderL; armR.rotation.x=pose.shoulderR;
  armL.userData.lower.rotation.x=pose.elbowL; armR.userData.lower.rotation.x=pose.elbowR;
  const torso=player.userData.torso;
  torso.rotation.y=pose.torsoYaw; torso.rotation.x=pose.torsoPitch; torso.position.y=pose.torsoLift;
}

export function getPlayer(){ return player; }
export function getHands(){ return hands; }
