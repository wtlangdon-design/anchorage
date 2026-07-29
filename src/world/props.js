// world/props.js — the placed things: site markers, Meridian camps, graves,
// the shelter, and the scattered rocks.
//
// Ported verbatim from the reference (lines 533-592). The den meshes at 593-596
// belong to fauna.js and are NOT here. Every mesh dimension and position is art
// and stays inline. The visual pass changed materials, the maps behind them, and
// the shape noise inside roughRock — no mesh was added, removed or moved, and
// buildPlaces() still makes exactly the same 1904 rand() draws in the same order.
//
// Three facts this file is built around:
//
//  1. DodecahedronGeometry is PolyhedronGeometry, which is NON-INDEXED. So the
//     computeVertexNormals() at the end of roughRock already produces per-face
//     normals — the rocks are flat-shaded whether or not you ask for it, and
//     setting flatShading would change nothing. All the surface therefore has to
//     come from a normal map, which is the cheap way anyway: 44 + 25 + 250 = 319
//     rock meshes share two materials and two maps between them.
//  2. Those same rocks have a spherical UV unwrap with a seam and two poles. Any
//     map on them is stretched at the poles and meets itself at the seam, so the
//     rock normal map is DELIBERATELY fine-grained and low-contrast: nothing in
//     it is large enough or dark enough for the eye to trace the seam by. Big
//     shapes go in the geometry, not the map.
//  3. r128 gives one uv transform per material (shared by map/normalMap/
//     roughnessMap/metalnessMap), so every map on a material here has the same
//     repeat. aoMap is the exception — it reads uv2 and has its own transform,
//     which is why the grave plates get a uv2 and nothing else does.
//
// The grave plates are the story, so they are the one place the texture budget
// is spent per-object: five plates, five engraving maps. See TUNING.plate.grave.

import * as tex from "./textures.js";

// TODO(lead): lift into config.json (suggested homes: props.rock, props.metal,
// props.plate). `seed` is the texture hash seed and has nothing to do with
// terrain.noiseSeed — changing it cannot move a rock. Nothing in this object is
// read by anything outside this file.
const TUNING = {
  seed: 41203,

  rock: {
    // --- shape (geometry, not a map). See roughRock for why this is in unit space.
    lumpFreq: 1.6, lumpGain: 0.55,      // was fbm(x*1.7...)*.55 in world space
    grainFreq: 2.6, grainGain: 0.30,    // was fbm(y*2.3...)*.30
    squash: 0.82,                       // unchanged: rocks sit wider than they are tall
    shapeSpread: 97.3, shapeWrap: 13,   // per-rock noise offset derived from its own scale

    // --- normal map. Periods are whole cells across one tile so they wrap.
    // Nothing coarser than 5 cells: coarse relief here would draw the UV seam.
    repeat: [3, 2],
    bedPeriod: 5, bedOctaves: 2, bedGain: 0.16,      // faint bedding
    grainPeriod: 14, grainOctaves: 3, grainGain: 0.20,
    gritPeriod: 34, gritOctaves: 2, gritGain: 0.15,
    pitPeriod: 20, pitSharp: 5, pitGain: 0.13,       // sparse pockmarks
    // Strength is set so the per-texel slope lands just above the ground's own
    // normal map (terrain.js: 5.5 at 512 over gains ~1.06). Stone should read a
    // little coarser than packed ash, not dramatically so.
    normalStrength: 6.0,   // baked into the pixels
    normalScale: 0.95,     // runtime dial on top; costs no repaint

    // --- roughness map: stone is matte everywhere, wind-polished faces a little less
    roughPeriod: 4, roughOctaves: 2, roughMin: 0.84, roughMax: 1.0, roughBias: 1.15,
    roughness: 1.0, metalness: 0.02,
    colour: 0x4d453b,      // was inline: cairn + scatter rock
    soilColour: 0x726757   // was inline: the 44 sample rocks at the soil site
  },

  metal: {
    // Hull stock cut and bolted by hand, then left out for two centuries.
    repeat: [2, 2],
    // Powers of two, so the panel grid falls on exact texel boundaries at 256 AND
    // at the 128 the downgrade redraws it to. With repeat 2 that is 0.8 m panels
    // on a hut wall — about what two people can carry and bolt up by hand.
    panelsU: 4, panelsV: 2,
    lineWidth: 0.022, lineDepth: 0.10, panelStep: 0.030, panelTone: 0.16,
    rivetsPerEdge: 4, rivetRadius: 0.016, rivetHeight: 0.075, rivetMissing: 0.22,
    dentPeriod: 4, dentOctaves: 2, dentGain: 0.13,
    scratchPeriod: 38, scratchGain: 0.05,
    streakSteps: 5, streakLength: 0.26, streakPeriod: 9, streakGain: 0.30,
    corrPeriod: 6, corrOctaves: 3, corrLow: 0.18, corrSpan: 0.68,
    corrBlotMix: 0.62,                // blotches vs downward streaks, the rest
    lineCorr: 0.18,                   // seams hold water, so they corrode first
    toneBase: 0.92, lineDarken: 0.30, rivetLift: 0.10, linePolish: 0.25,
    normalStrength: 4.4, normalScale: 0.85,
    base: 0x6b6f74, oxide: 0x4d443a,  // base was inline 0x686c72
    roughness: 0.98, metalness: 0.62, // the maps scale these DOWN, never up
    roughClean: 0.60, roughCorroded: 1.0,
    metalClean: 1.0, metalCorroded: 0.22,
    // The albedo lives in metalColour, so these are TINTS multiplying it, not
    // absolute colours — near white, or the object goes black. The huts take the
    // map untinted; the dish is thin bright reflector stock, the shelter is the
    // structure that stood the longest and is browner and darker for it.
    dishTint: 0xc6ccd2, dishNormalScale: 0.6,
    dishSegments: [20, 12],           // was 14, 10 — the rim is pure silhouette
    shelterTint: 0x8c8378,
    shelterRoughness: 1.0, shelterMetalness: 0.42
  },

  plate: {
    // The five markers. `cut` is groove depth, `steady` is how even the hand was,
    // `breaks` is how often the cut stops and starts again, `age` is how long the
    // plate has stood (g1 was cut 32 years before g5, and has weathered that much
    // longer). Read the `steady` column downward: it falls away for four markers
    // and then goes to 1. Nothing else in this file says anything about it.
    grave: [
      { cut: 0.80, steady: 0.86, breaks: 0.03, age: 1.00 },  // 0  okonkwo  year 9
      { cut: 0.70, steady: 0.66, breaks: 0.09, age: 0.75 },  // 1  demir    year 17
      { cut: 0.52, steady: 0.42, breaks: 0.24, age: 0.53 },  // 2  raman    year 24
      { cut: 0.34, steady: 0.20, breaks: 0.58, age: 0.31 },  // 3  ruiz     year 31
      { cut: 1.00, steady: 1.00, breaks: 0.00, age: 0.00 }   // 4  vantaa   year 41
    ],
    aspect: 1.258,          // 0.78 / 0.62 — the BoxGeometry below, so strokes are
                            // measured in metres and not in stretched uv
    margin: 0.135,          // engraved block inset from the cut edge
    strokeSoft: 0.006,
    jitterX: 0.55, jitterY: 0.85, jitterH: 0.35, jitterW: 0.55, jitterLean: 0.42,
    breakSegments: 5, breakDepth: 0.22,
    cutGain: 0.30,
    rollPeriod: 5, rollGain: 0.045,        // mill waviness in the sheet
    pitPeriod: 22, pitSharp: 4, pitGain: 0.26,
    edgeInset: 0.014, edgeSoft: 0.024, edgeRagged: 0.030, edgePeriod: 26,
    normalStrength: 5.0, normalScale: 1.0,
    corrPeriod: 7, corrFloor: 0.34, corrSpan: 0.52,
    corrBlotLow: 0.45, corrBlotSpan: 0.55, corrEdge: 0.10, corrEdgeGain: 0.45,
    grooveRough: 0.18, grooveMetal: 0.25, grooveAO: 0.55, corrAO: 0.12,
    roughFloor: 0.52, roughSpan: 0.48, metalLoss: 0.78,
    rowBand: 1.9,           // how far outside a row the stroke search still runs
    crossChance: 0.42, crossLeft: 0.30, crossRight: 0.28,
    edgeFloor: 0.45,        // how far the chamfer drops the height at the very edge
    aoIntensity: 0.9,
    roughness: 1.0, metalness: 0.86,
    clean: 0xa9afb5, oxide: 0x7d7468,      // clean was inline 0xa4aab0
    warpMax: 0.018,        // metres of bend across the plate, scaled by (1 - steady)
    tiltMax: 0.075,        // radians off level, scaled by (1 - steady)
    segments: [2, 3]       // so the plate can bend instead of being a perfect sheet
  }
};

// The engraved block: a row of tall marks (the name), a scored rule, a row of
// short ones (the year). Abstract cut marks, not letterforms — a bad letterform
// reads as a bug, an uneven cut reads as a hand.
const ROWS = [
  { v: 0.615, half: 0.075, cells: 9, w: 0.0090 },
  { v: 0.350, half: 0.042, cells: 6, w: 0.0072 }
];
const RULE_V = 0.487, RULE_HALF = 0.0035;

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const ease = t => t * t * (3 - 2 * t);

// main.js sets renderer.outputEncoding = sRGBEncoding. In r128 a material's plain
// `color` is fed to the shader as LINEAR albedo, but a map tagged srgb is decoded
// from sRGB first — so the same hex written straight into a colour map's canvas
// comes out roughly four times darker than it does as a material colour. Anything
// painted into a srgb:true texture goes through here first. Written out rather
// than taken from THREE.Color so it cannot depend on a method being present.
function linearToSRGB(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

let THREE, scene, rand, heightAt, fbm, config, record;

export function initProps(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  heightAt = deps.heightAt; fbm = deps.fbm;
  config = cfg; record = story;
}

/* ---------------------------------------------------------------- rock ----- */

// The shape noise used to be sampled at the raw vertex coordinates, which are in
// metres — so a 0.2 m pebble sampled a patch of noise 0.4 m across, got an almost
// constant multiplier, and came out a clean dodecahedron, while a 3.5 m boulder
// came out lumpy. Sampling in the rock's own space (x/s) makes the AMOUNT of
// shape independent of size. That alone would make every rock the same shape, so
// the noise domain is offset by a value derived from `s` — which is a different
// float for nearly every rock and has already been drawn, so this costs no PRNG
// call and cannot move anything.
function roughRock(s){
  const R=TUNING.rock;
  const g=new THREE.DodecahedronGeometry(s,1);
  const p=g.attributes.position;
  const o=(s*R.shapeSpread)%R.shapeWrap;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const ux=x/s,uy=y/s,uz=z/s;
    const n=1+fbm(ux*R.lumpFreq+o+11,uz*R.lumpFreq-o-4,3)*R.lumpGain
             +fbm(uy*R.grainFreq+o,ux*R.grainFreq-o,2)*R.grainGain;
    p.setXYZ(i,x*n,y*n*R.squash,z*n);
  }
  g.computeVertexNormals();return g;
}

// Stone relief, u/v in [0,1) across one tile. Pure and tileable. Everything here
// is small and shallow on purpose — see note 2 in the file header.
function rockHeight(u, v) {
  const R = TUNING.rock, s = TUNING.seed;
  const bed = tex.fbmTile(u, v, R.bedPeriod, R.bedOctaves, s);
  const grain = tex.fbmTile(u, v, R.grainPeriod, R.grainOctaves, s + 17);
  const grit = tex.fbmTile(u, v, R.gritPeriod, R.gritOctaves, s + 53);
  const pit = Math.pow(tex.fbmTile(u, v, R.pitPeriod, 1, s + 89), R.pitSharp);
  return bed * R.bedGain + grain * R.grainGain + grit * R.gritGain - pit * R.pitGain;
}

// Stone is matte all over. The only variation is that the faces standing proud
// have been polished a little by two centuries of ash moving west across them,
// so the roughness map shares the bedding field with the height above.
function rockRough(u, v) {
  const R = TUNING.rock;
  const b = tex.fbmTile(u, v, R.roughPeriod, R.roughOctaves, TUNING.seed);
  return R.roughMax - (R.roughMax - R.roughMin) * ease(clamp01(b * R.roughBias));
}

/* --------------------------------------------------------------- metal ----- */

// Panel lattice. Cell indices are integers mod panelsU/panelsV, so every feature
// derived from them wraps and the map tiles.
function panelAt(u, v) {
  const M = TUNING.metal;
  const fu = u * M.panelsU, fv = v * M.panelsV;
  const cx = Math.floor(fu) % M.panelsU, cy = Math.floor(fv) % M.panelsV;
  const lu = fu - Math.floor(fu), lv = fv - Math.floor(fv);
  const dU = Math.min(lu, 1 - lu), dV = Math.min(lv, 1 - lv);
  const line = 1 - ease(clamp01(Math.min(dU, dV) / M.lineWidth));
  // rivets march along the horizontal seams of each panel, some of them gone
  let riv = 0;
  const step = 1 / M.rivetsPerEdge;
  const j = Math.floor(lu / step), ru = (j + 0.5) * step;
  if (tex.hash2(cx * 31 + j, cy, TUNING.seed + 5) > M.rivetMissing) {
    const du = (lu - ru) / M.panelsU, dv = dV / M.panelsV;
    riv = 1 - ease(clamp01(Math.sqrt(du * du + dv * dv) / M.rivetRadius));
  }
  return { cx, cy, line, riv, tone: tex.hash2(cx, cy, TUNING.seed + 11) };
}

// Weather runs one way down a wall. fbmTile has a single period per call, so the
// smear is made by averaging several samples walked along v — the same trick
// terrain.js uses for its scour lines, just longer.
function streak(u, v, period, octaves, seed) {
  const M = TUNING.metal, n = M.streakSteps;
  let s = 0;
  for (let k = 0; k < n; k++) s += tex.fbmTile(u, v - (k / (n - 1)) * M.streakLength, period, octaves, seed);
  return s / n;
}

// `p` is the caller's panelAt result — every caller already has one, and panelAt
// is the most-called function in this file at load time.
function metalCorrosion(u, v, p) {
  const M = TUNING.metal;
  const blot = tex.fbmTile(u, v, M.corrPeriod, M.corrOctaves, TUNING.seed + 29);
  const run = streak(u, v, M.streakPeriod, 2, TUNING.seed + 71);
  const w = M.corrBlotMix;
  return clamp01(M.corrLow + M.corrSpan * (w * blot + (1 - w) * run) + p.line * M.lineCorr);
}

function metalHeight(u, v) {
  const M = TUNING.metal;
  const p = panelAt(u, v);
  const dent = tex.fbmTile(u, v, M.dentPeriod, M.dentOctaves, TUNING.seed + 3);
  const scratch = tex.ridgeTile(u, v, M.scratchPeriod, 1, TUNING.seed + 47);
  return 0.5
    + (p.tone - 0.5) * M.panelStep      // panels do not sit quite flush
    + dent * M.dentGain
    - p.line * M.lineDepth
    + p.riv * M.rivetHeight
    - (1 - scratch) * M.scratchGain;
}

/* --------------------------------------------------------------- plate ----- */

let _t = 0;   // parametric position of the closest point, set by segDist

// Distance from (px,py) to the segment a-b, measured with v scaled so that one
// unit of u and one unit of v are the same number of millimetres of plate.
function segDist(px, py, ax, ay, bx, by) {
  const A = TUNING.plate.aspect;
  const Py = py * A, Ay = ay * A, By = by * A;
  const vx = bx - ax, vy = By - Ay, wx = px - ax, wy = Py - Ay;
  const L = vx * vx + vy * vy;
  let t = L > 0 ? (wx * vx + wy * vy) / L : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  _t = t;
  const dx = px - (ax + vx * t), dy = Py - (Ay + vy * t);
  return Math.sqrt(dx * dx + dy * dy);   // Math.hypot is ~4x slower and this runs ~2M times
}

function groove(d, w) { return ease(clamp01(1 - d / w)); }

// One cut mark. `breaks` chews the groove into stop-start segments — a chisel
// put down and picked up again.
function mark(px, py, ax, ay, bx, by, w, key, sd, breaks) {
  const d = segDist(px, py, ax, ay, bx, by);
  let g = groove(d, w);
  if (g > 0 && breaks > 0) {
    const seg = Math.floor(_t * TUNING.plate.breakSegments);
    if (tex.hash2(seg, key, sd + 7) < breaks) g *= TUNING.plate.breakDepth;
  }
  return g;
}

// The engraved block, 0..1. Everything that varies between the five plates comes
// through TUNING.plate.grave[gi]: an unsteady hand wanders off the baseline, cuts
// uneven widths, spaces the marks wrong and leans them; a steady one does not.
function engraving(u, v, gi) {
  const P = TUNING.plate, G = P.grave[gi], jit = 1 - G.steady, sd = TUNING.seed + gi * 131;
  let best = 0;
  // The rule between the rows was cut against a straight edge rather than
  // freehand, so it is the one mark that is straight on all five plates.
  if (u > P.margin && u < 1 - P.margin) {
    const dv = Math.max(0, Math.abs(v - RULE_V) - RULE_HALF) * P.aspect;
    best = groove(dv, P.strokeSoft);
  }
  for (let r = 0; r < ROWS.length; r++) {
    const R = ROWS[r];
    if (Math.abs(v - R.v) > R.half * P.rowBand) continue;
    const cw = (1 - P.margin * 2) / R.cells;
    const c0 = Math.floor((u - P.margin) / cw);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= R.cells) continue;
      const h0 = tex.hash2(c, r * 7 + 1, sd), h1 = tex.hash2(c, r * 7 + 2, sd),
            h2 = tex.hash2(c, r * 7 + 3, sd), h3 = tex.hash2(c, r * 7 + 4, sd);
      const cx = P.margin + (c + 0.5) * cw + (h0 - 0.5) * cw * P.jitterX * jit;
      const cy = R.v + (h1 - 0.5) * R.half * P.jitterY * jit;
      const hh = R.half * (1 - h2 * P.jitterH * jit);
      const lean = (h3 - 0.5) * P.jitterLean * jit;
      const w = R.w * (1 + (h1 - 0.5) * P.jitterW * jit);
      const up = mark(u, v, cx - lean * hh, cy - hh, cx + lean * hh, cy + hh, w, c * 13 + r, sd, G.breaks);
      if (up > best) best = up;
      if (h2 > P.crossChance) {
        const y = cy + (h3 - 0.5) * hh;
        const cr = mark(u, v, cx - cw * P.crossLeft, y, cx + cw * P.crossRight, y, w * 0.9, c * 13 + r + 64, sd, G.breaks);
        if (cr > best) best = cr;
      }
    }
  }
  return best;
}

// Corrosion creeps in from the cut edge and pools in blotches. Driven by `age`,
// not by `steady` — the oldest plate is the most weathered whatever the hand was.
function plateCorrosion(u, v, gi) {
  const P = TUNING.plate, G = P.grave[gi];
  const blot = tex.fbmTile(u, v, P.corrPeriod, 3, TUNING.seed + gi * 131 + 23);
  const em = Math.min(u, 1 - u, v, 1 - v);
  const edge = 1 - clamp01(em / P.corrEdge);
  const base = P.corrFloor + G.age * P.corrSpan;
  return clamp01(base * (P.corrBlotLow + P.corrBlotSpan * blot) + edge * P.corrEdgeGain * base);
}

function plateHeight(u, v, gi) {
  const P = TUNING.plate, G = P.grave[gi], sd = TUNING.seed + gi * 131;
  // The cut edge: square and even on a steady plate, ragged on an unsteady one.
  // Sampled first, and only inside the band where it can have any effect —
  // this is ten maps' worth of pixels and the noise is not free.
  const em = Math.min(u, 1 - u, v, 1 - v);
  let e = 1;
  if (em < P.edgeInset + P.edgeSoft + P.edgeRagged) {
    const rag = (tex.fbmTile(u, v, P.edgePeriod, 2, sd + 7) - 0.5) * (1 - G.steady) * P.edgeRagged;
    e = ease(clamp01((em - P.edgeInset - rag) / P.edgeSoft));
  }
  let h = 0.62;
  h += (tex.fbmTile(u, v, P.rollPeriod, 2, sd + 11) - 0.5) * P.rollGain;
  // pitting deepens with age; the blotch FIELD lives in the wear map, where
  // corrosion mostly shows, so the relief only needs the scalar
  h -= Math.pow(tex.fbmTile(u, v, P.pitPeriod, 2, sd + 3), P.pitSharp)
     * (P.corrFloor + G.age * P.corrSpan) * P.pitGain;
  h -= engraving(u, v, gi) * G.cut * P.cutGain;
  return h * (P.edgeFloor + (1 - P.edgeFloor) * e);
}

/* -------------------------------------------------------------- build ------ */

// Real keys of an object, in id order, ignoring the "_note" documentation keys.
const realKeys=o=>Object.keys(o||{}).filter(k=>!k.startsWith("_")).sort();

// The entries config actually places, each tagged with `i`: its index in the
// full story.json record for that group. Falls back to the placed order only if
// the record is missing the id entirely.
function placedFromRecord(group,rec){
  const ord={}; realKeys(rec).forEach((id,i)=>{ord[id]=i});
  return realKeys(group).map((id,n)=>({...group[id],id,i:id in ord?ord[id]:n}));
}

export function buildPlaces(){
  const SIZE=config.world.size;
  // Only some of the Meridian's camps and graves are on this ground; the rest
  // exist only in story.json's record. config places what is here, story.json
  // holds the full five and five — and each placed thing keeps its ORDINAL in
  // that full record, never its position in the placed list, because the
  // per-object art is indexed by it. Camp five's mast is the tall relay; grave
  // five's plate is the clean, level one the reveal turns on. Renumber them and
  // Vantaa inherits Okonkwo's hand.
  const CAMPS=placedFromRecord(config.camps,record&&record.camps);
  const GRAVES=placedFromRecord(config.graves,record&&record.graves);
  const LAST=config.shelter;
  const R=TUNING.rock, M=TUNING.metal, PL=TUNING.plate;

  // --- shared maps. 319 rocks share two of these; every metal object shares three.
  const rockRep = { repeat: R.repeat };
  const rockNormal = tex.normalTexture("rockNormal", tex.sizeFor("rockNormal", 256),
    rockHeight, R.normalStrength, rockRep);
  const rockRoughMap = tex.texture("rockRough", tex.sizeFor("rockRough", 128),
    size => tex.greyPixels(size, rockRough), rockRep);

  const metalRep = { repeat: M.repeat };
  // Encoded once, up front — see linearToSRGB above.
  const enc = h => { const c = new THREE.Color(h);
    return { r: linearToSRGB(c.r), g: linearToSRGB(c.g), b: linearToSRGB(c.b) }; };
  const base = enc(M.base), oxide = enc(M.oxide);
  const metalMap = tex.texture("metalColour", tex.sizeFor("metal", 256), size =>
    tex.fillPixels(size, (x, y, px, i) => {
      const u = x / size, v = y / size, p = panelAt(u, v), cor = metalCorrosion(u, v, p);
      const k = (M.toneBase + M.panelTone * (p.tone - 0.5) * 2) * (1 - p.line * M.lineDarken) * (1 + p.riv * M.rivetLift);
      px[i] = (base.r + (oxide.r - base.r) * cor) * k * 255;
      px[i + 1] = (base.g + (oxide.g - base.g) * cor) * k * 255;
      px[i + 2] = (base.b + (oxide.b - base.b) * cor) * k * 255;
      px[i + 3] = 255;
    }), { ...metalRep, srgb: true });
  const metalNormal = tex.normalTexture("metalNormal", tex.sizeFor("metalNormal", 256),
    metalHeight, M.normalStrength, metalRep);
  // packed: R unused (kept white), G roughness, B metalness — one texture doing
  // the work of two, bound to roughnessMap and metalnessMap on the same material.
  const metalWear = tex.texture("metalWear", tex.sizeFor("metalWear", 128), size =>
    tex.fillPixels(size, (x, y, px, i) => {
      const u = x / size, v = y / size, p = panelAt(u, v), cor = metalCorrosion(u, v, p);
      const rough = M.roughClean + (M.roughCorroded - M.roughClean) * cor;
      const metal = M.metalClean + (M.metalCorroded - M.metalClean) * cor;
      px[i] = 255;
      px[i + 1] = Math.min(1, rough) * 255;
      px[i + 2] = Math.max(0, metal * (1 - p.line * M.linePolish)) * 255;
      px[i + 3] = 255;
    }), metalRep);

  // --- shared materials. Every one of these used to be either a default-looking
  // material or, in two cases (the soil rocks and the dishes), a fresh material
  // built inside a loop.
  const rockM=new THREE.MeshStandardMaterial({color:R.colour,roughness:R.roughness,metalness:R.metalness,
    normalMap:rockNormal,roughnessMap:rockRoughMap,dithering:true});
  rockM.normalScale.set(R.normalScale,R.normalScale);
  const soilRockM=new THREE.MeshStandardMaterial({color:R.soilColour,roughness:R.roughness,metalness:R.metalness,
    normalMap:rockNormal,roughnessMap:rockRoughMap,dithering:true});
  soilRockM.normalScale.set(R.normalScale,R.normalScale);
  const metal=new THREE.MeshStandardMaterial({color:0xffffff,roughness:M.roughness,metalness:M.metalness,
    map:metalMap,normalMap:metalNormal,roughnessMap:metalWear,metalnessMap:metalWear,dithering:true});
  metal.normalScale.set(M.normalScale,M.normalScale);
  const dishM=new THREE.MeshStandardMaterial({color:M.dishTint,roughness:M.roughness,metalness:M.metalness,
    map:metalMap,normalMap:metalNormal,roughnessMap:metalWear,metalnessMap:metalWear,
    side:THREE.DoubleSide,dithering:true});
  dishM.normalScale.set(M.normalScale*M.dishNormalScale,M.normalScale*M.dishNormalScale);
  const shelterM=new THREE.MeshStandardMaterial({color:M.shelterTint,roughness:M.shelterRoughness,
    metalness:M.shelterMetalness,map:metalMap,normalMap:metalNormal,roughnessMap:metalWear,
    metalnessMap:metalWear,dithering:true});
  shelterM.normalScale.set(M.normalScale,M.normalScale);

  // --- one engraving map and one wear map per grave. The only per-object texture
  // spend in the file, and the reason is in TUNING.plate.grave.
  const plateClean=new THREE.Color(PL.clean), plateOxide=new THREE.Color(PL.oxide), plateMix=new THREE.Color();
  // Indexed by record ordinal, so plateMats[4] is always Vantaa's. A grave that
  // is only in the record costs no texture.
  const wanted=new Set(GRAVES.map(g=>g.i));
  const plateMats=PL.grave.map((G,gi)=>{
    if(!wanted.has(gi)) return null;
    const nrm=tex.normalTexture("plateNormal"+gi,tex.sizeFor("plateNormal",256),
      (u,v)=>plateHeight(u,v,gi),PL.normalStrength,{});
    const wear=tex.texture("plateWear"+gi,tex.sizeFor("plateWear",128),size=>
      tex.fillPixels(size,(x,y,px,i)=>{
        const u=x/size,v=y/size,cor=plateCorrosion(u,v,gi),gr=engraving(u,v,gi)*G.cut;
        px[i]=clamp01(1-gr*PL.grooveAO-cor*PL.corrAO)*255;
        px[i+1]=clamp01(PL.grooveRough*gr+(PL.roughFloor+PL.roughSpan*cor))*255;
        px[i+2]=clamp01((1-PL.metalLoss*cor)*(1-gr*PL.grooveMetal))*255;
        px[i+3]=255;
      }),{});
    plateMix.copy(plateClean).lerp(plateOxide,G.age);
    const m=new THREE.MeshStandardMaterial({color:plateMix.getHex(),roughness:PL.roughness,
      metalness:PL.metalness,normalMap:nrm,aoMap:wear,roughnessMap:wear,metalnessMap:wear,
      aoMapIntensity:PL.aoIntensity,dithering:true});
    m.normalScale.set(PL.normalScale,PL.normalScale);
    return m;
  });

  const put=o=>{o.castShadow=true;o.receiveShadow=true;scene.add(o);return o};
  {const c=config.sites.water,y=heightAt(c.x,c.z);
   const w=new THREE.Mesh(new THREE.CircleGeometry(14,30),
     new THREE.MeshBasicMaterial({color:0xbcd8e0,transparent:true,opacity:.55}));
   w.rotation.x=-Math.PI/2;w.position.set(c.x,y+.4,c.z);scene.add(w)}
  {const c=config.sites.season,y=heightAt(c.x,c.z);
   const f=new THREE.Mesh(new THREE.CircleGeometry(78,30),
     new THREE.MeshLambertMaterial({color:0xdfe9ef,transparent:true,opacity:.72}));
   f.rotation.x=-Math.PI/2;f.position.set(c.x,y+.25,c.z);scene.add(f)}
  {const c=config.sites.soil;
   for(let i=0;i<44;i++){const a=rand()*6.28,d=rand()*76,s=.5+rand()*1.2;   // TODO(lead): soil rock count 44 and 76/.5/1.2 not in config
     const b=new THREE.Mesh(roughRock(s),soilRockM);
     const x=c.x+Math.cos(a)*d,z=c.z+Math.sin(a)*d;
     b.position.set(x,heightAt(x,z)+s*.3,z);b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}}
  CAMPS.forEach(cp=>{
    const i=cp.i;
    const y=heightAt(cp.x,cp.z),n=Math.max(1,4-Math.floor(i*.7));   // TODO(lead): hut-count formula max(1,4-floor(i*.7)) not in config
    for(let k=0;k<n;k++){const h=new THREE.Mesh(new THREE.BoxGeometry(6.5,3.2,4.8),metal);
      h.position.set(cp.x+k*8-8,y+1.35,cp.z+(k%2)*4.2);h.rotation.y=(rand()-.5)*.5;put(h)}
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.16,.30,20+i*2.5,7),metal);
    mast.position.set(cp.x+5,y+10+i*1.25,cp.z-7);put(mast);
    const dish=new THREE.Mesh(new THREE.SphereGeometry(1.9,M.dishSegments[0],M.dishSegments[1],0,6.28,0,1.1),dishM);
    dish.position.set(cp.x+5,y+20+i*2.5,cp.z-7);dish.rotation.x=-.85;put(dish)});
  GRAVES.forEach(g=>{const gi=g.i,y=heightAt(g.x,g.z);
    const lean=(1-PL.grave[gi].steady);
    for(let i=0;i<5;i++){const s=.9-i*.13;   // TODO(lead): 5 cairn rocks per grave and .9-i*.13 not in config
      const b=new THREE.Mesh(roughRock(s*.4),rockM);
      b.position.set(g.x+(rand()-.5)*.5,y+.2+i*.3,g.z+(rand()-.5)*.5);
      b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}
    // The plate is bent and set off level by the same amount the lettering is
    // unsteady, so the fifth marker is the flattest and the only level one.
    const pg=new THREE.BoxGeometry(.62,.78,.05,PL.segments[0],PL.segments[1],1);
    const pp=pg.attributes.position, amp=PL.warpMax*lean;
    for(let i=0;i<pp.count;i++){
      const x=pp.getX(i),yy=pp.getY(i);
      pp.setZ(i,pp.getZ(i)+(tex.fbmTile(x/.62+.5,yy/.78+.5,2,2,TUNING.seed+gi*17)-.5)*amp);
    }
    pg.computeVertexNormals();
    pg.setAttribute("uv2",pg.attributes.uv);   // aoMap reads uv2 and nothing else here has one
    const p=new THREE.Mesh(pg,plateMats[gi]);
    p.position.set(g.x,y+1.75,g.z);p.rotation.y=.3;p.rotation.z=PL.tiltMax*lean;put(p);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.1,6),metal);
    post.position.set(g.x,y+1.05,g.z);post.rotation.z=PL.tiltMax*lean*.6;put(post)});
  {const y=heightAt(LAST.x,LAST.z);
   const h=new THREE.Mesh(new THREE.BoxGeometry(6,3.4,5),shelterM);
   h.position.set(LAST.x,y+1.5,LAST.z);put(h);
   const mast=new THREE.Mesh(new THREE.CylinderGeometry(.14,.26,15,7),shelterM);
   mast.position.set(LAST.x+4,y+7.5,LAST.z-5);put(mast);
   const lamp=new THREE.PointLight(0x8FC6D4,1.5,60);
   lamp.position.set(LAST.x,y+3.4,LAST.z);scene.add(lamp);
   const bulb=new THREE.Mesh(new THREE.SphereGeometry(.28,10,8),
     new THREE.MeshBasicMaterial({color:0x8FC6D4}));
   bulb.position.set(LAST.x,y+3.4,LAST.z);scene.add(bulb)}
  for(let i=0;i<config.terrain.scatterRocks.count;i++){const x=(rand()-.5)*SIZE*config.terrain.scatterRocks.spreadFraction,z=(rand()-.5)*SIZE*config.terrain.scatterRocks.spreadFraction,s=config.terrain.scatterRocks.minScale+rand()*config.terrain.scatterRocks.scaleRange;
    const b=new THREE.Mesh(roughRock(s),rockM);
    b.position.set(x,heightAt(x,z)+s*.4,z);b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}

  // The collapse at each end of the crevice.
  //
  // These are the same rough rocks as everywhere else, at boulder scale, sat on
  // the end slope so that the thing stopping you is a heap of fallen rock you can
  // see rather than a hillside that merely happens to be steep. They are only
  // decoration — nothing in this game has collision, so the terrain underneath is
  // what actually blocks, and it does (see the apron-then-face profile in
  // terrain.js). Drawn last so every rock, camp and grave placed above keeps the
  // exact position it had before this pile existed.
  {
    const RF = config.terrain.canyon.rockfall, CY = config.terrain.canyon;
    const halfL = CY.length / 2, halfW = CY.width / 2;
    const reach = (halfW + CY.wallRun) * RF.bandSpread;
    for(const side of [1, -1]){
      for(let i = 0; i < RF.count; i++){
        const x = (rand() - .5) * 2 * reach;
        // biased toward the outer part of the band, so the pile is deepest where
        // the ground is already climbing and thins out into the canyon
        const f = rand();
        const z = side * (halfL - RF.bandDepth * 0.35 + f * f * RF.bandDepth * 1.5);
        const sc = RF.minScale + rand() * RF.scaleRange;
        const b = new THREE.Mesh(roughRock(sc), rockM);
        b.position.set(x, heightAt(x, z) + sc * (1 - RF.sink), z);
        b.rotation.set(rand() * 3, rand() * 3, rand() * 3);
        put(b);
      }
    }
  }
}
