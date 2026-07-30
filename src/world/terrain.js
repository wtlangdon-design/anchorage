// world/terrain.js — the ground: heightfield, terrain mesh, far hills.
//
// Ported from the reference (lines 186-198, 398-420, 452-457). heightAt(x,z) is
// the single source of ground elevation; every other world module imports it
// (via deps) rather than recomputing. heightAt, the mesh, the vertex colours and
// the PRNG draw order are all exactly as ported — the visual pass added surface
// maps to the two materials and nothing else.
//
// Why the ground needs maps at all: the mesh is world.size across world.segments,
// so vertices sit several metres apart. Geometrically it is a smooth sheet, and up
// close it has no surface of its own. Everything you feel underfoot is the normal
// map, raked by the low fixed sun.
//
// Two r128 facts this file is built around, both verified against the r128 build
// and both easy to trip over later:
//
//  1. ONE uv transform per material. r128 has a single `uvTransform` uniform for
//     map/normalMap/roughnessMap/etc, taken from the first map present in a fixed
//     priority list (map, specularMap, displacementMap, normalMap, bumpMap,
//     roughnessMap, ...). Two maps on one material CANNOT have different repeats.
//     Every map here is therefore set to the same repeat. Only aoMap/lightMap get
//     their own transform, and those need a uv2 attribute.
//  2. A bumpMap is ignored whenever a tangent-space normalMap is present — the
//     shader chunk is `#elif defined( USE_BUMPMAP )`. So there is no second normal
//     slot to put a larger-scale relief in. See the note above buildTerrain.

import * as tex from "./textures.js?v=14";

// TODO(lead): lift into config.json (suggested home: terrain.surface).
// Nothing here touches the world PRNG: `seed` below is the texture hash's seed,
// unrelated to terrain.noiseSeed, and changing it cannot move a rock.
const TUNING = {
  tileMetres: 20,        // one texture tile per 20 m of ground

  // --- normal map: three bands of relief inside one tile, plus scour lines.
  // Periods are whole cells across the tile, so 4 = 5 m features, 56 = 36 cm.
  dustPeriod: 4, dustOctaves: 3, dustGain: 0.50,        // shallow ash hollows
  bedPeriod: 16, bedOctaves: 2, bedGain: 0.26,          // gravel beds
  gritPeriod: 56, gritOctaves: 2, gritGain: 0.20,       // grit, ~4 texels wide
  scourPeriod: 24, scourGain: 0.10, scourSmear: 0.5,    // grooves, smeared along +x
  // The sun sits 7.9 deg above the horizon (main.js puts it at +520 x, +72 y), so
  // this ground is unusually sensitive to these two: any texel tilted more than
  // ~8 deg away from +x falls out of the key light entirely and is carried by the
  // cool fills alone. At these values about a fifth of them do, which is what a
  // raking light does to grit. normalScale is the dial to reach for — it is a
  // uniform, so it costs no repaint; normalStrength is baked into the pixels.
  normalStrength: 5.0,   // height gradient -> normal tilt, baked into the pixels
  normalScale: 0.85,     // runtime dial on top of it

  // --- roughness map: wind-packed ground vs loose dust.
  patchPeriod: 3, patchOctaves: 2, patchBreakPeriod: 14,
  exposureLow: 0.30, exposureSpan: 0.45,
  roughMin: 0.74, roughMax: 1.0,
  groundRoughness: 0.98, // material value the map multiplies

  // --- far hills: 18 cones sharing one material, 2100-3700 m out and 82-99% fog.
  hillColour: 0x443c34,  // was a literal in buildFarHills
  hillRoughness: 1.0,

  seed: 20817            // texture noise only
};

const clamp01 = t => t < 0 ? 0 : t > 1 ? 1 : t;
const ease = t => t * t * (3 - 2 * t);

// Ground relief, u/v in [0,1) across one tile. Pure, tileable, no PRNG.
// u runs along world +x, v along world -z (the plane is rotated -90deg about x),
// so smearing in u lays the scour lines down the sun/wind axis.
function groundHeight(u, v) {
  const dust = tex.fbmTile(u, v, TUNING.dustPeriod, TUNING.dustOctaves, TUNING.seed);
  const bed = tex.fbmTile(u, v, TUNING.bedPeriod, TUNING.bedOctaves, TUNING.seed + 37);
  const grit = tex.fbmTile(u, v, TUNING.gritPeriod, TUNING.gritOctaves, TUNING.seed + 71);
  const d = TUNING.scourSmear / TUNING.scourPeriod;
  const ridge = 0.5 * (tex.ridgeTile(u - d, v, TUNING.scourPeriod, 1, TUNING.seed + 91)
                     + tex.ridgeTile(u + d, v, TUNING.scourPeriod, 1, TUNING.seed + 91));
  return dust * TUNING.dustGain + bed * TUNING.bedGain + grit * TUNING.gritGain
       + (1 - ridge) * TUNING.scourGain;
}

// Roughness, 0..1, multiplying the material's own roughness. Deliberately shares
// the dust field with the height above: the ground that stands proud is the ground
// the wind has packed, so the highs go smoother and the hollows stay dead matte.
function groundRoughness(u, v) {
  const dust = tex.fbmTile(u, v, TUNING.dustPeriod, 2, TUNING.seed);
  const patch = 0.66 * tex.fbmTile(u, v, TUNING.patchPeriod, TUNING.patchOctaves, TUNING.seed + 11)
              + 0.34 * tex.fbmTile(u, v, TUNING.patchBreakPeriod, 2, TUNING.seed + 29);
  const exposure = 0.62 * dust + 0.38 * patch;
  const t = ease(clamp01((exposure - TUNING.exposureLow) / TUNING.exposureSpan));
  return TUNING.roughMax - (TUNING.roughMax - TUNING.roughMin) * t;
}

let THREE, scene, rand, fbm, config;
let LX, LZ, SEGX, SEGZ, P, SH;

/* ---------------------------------------------------------------- the plan ---
   THE PATH IS BAKED. Everything that varies along the journey — the centreline,
   the floor's half-width, how high the rock beside it stands, the floor's own
   elevation, how broken the ground is — is a function of x alone, and it is
   sampled into flat typed arrays once at load. heightAt then does ONE index and
   ONE lerp to get all five, instead of the four noise samples the crevice needed.
   A 2560 m path therefore costs less per call than the 600 m crevice did.

   The tables are the reason the chain can be an ordered list in config.json with
   any number of segments in it: nothing at runtime loops over segments, because
   at runtime there are no segments, only arrays. */
let TX0 = 0, TSTEP = 1, TINV = 1, TN = 0;
let CZ, HW, RT, BS, FR;      // centre z, half-width, ridge top, floor base, floor relief
// THE DETOURS. A pocket hangs off ONE side of the corridor, so it cannot live in the
// symmetric half-width: PD carries its depth SIGNED BY SIDE (positive reaches into
// +z, negative into -z, zero means no pocket here) and PR carries how many metres
// the pocket's floor climbs per metre of depth, which is what makes one of them a
// climb rather than a walk. Two more flat arrays, no extra work per call beyond one
// compare and one multiply.
let PD, PR;
// CN is how much of the sky this stretch of trail has closed over, 0..1. It is the
// SHADE MECHANIC's new source: rock walls do not shade a corridor whose sun is at
// +x, but a canopy does, and where the canopy breaks the ground cooks. Baked here so
// shadeAt costs one lookup rather than a survey of the vegetation.
let CN;

const lerp = (a, b, t) => a + (b - a) * t;

// Where each segment sits once the chain is laid end to end, and what the floor
// does inside it. Exported shape is what the report and the tests read.
function layout(pcfg){
  const out = [];
  let x = pcfg.startX, base = 0;
  for(const s of pcfg.segments){
    const sill = s.sill || 0, drop = s.drop || 0;
    const sillRun = Math.min(s.sillRun || 0, s.length * 0.5);
    const dropRun = Math.min(s.dropRun || 0, s.length * 0.5);
    out.push({
      kind: s.kind, id: s.id, character: s.character || "",
      x0: x, x1: x + s.length, length: s.length,
      halfWidth: s.halfWidth, centre: s.centre, ridgeTop: s.ridgeTop,
      canopy: typeof s.canopy === "number" ? s.canopy : 0,
      pocket: s.pocket || null,
      relief: typeof s.floorRelief === "number" ? s.floorRelief : 1,
      baseIn: base, sill, sillRun, drop, dropRun, dropTail: s.dropTail || 0,
      baseOut: base + sill - drop,
      // a smoothstep's steepest slope is 1.5 * rise / run
      upGrade: sillRun > 0 ? 1.5 * sill / sillRun : Infinity,
      downGrade: dropRun > 0 ? 1.5 * drop / dropRun : (drop > 0 ? Infinity : 0)
    });
    x += s.length;
    base += sill - drop;
  }
  return out;
}

// The floor's elevation inside one segment: up over the sill, flat, down the drop,
// then flat again for dropTail metres.
//
// dropTail is not cosmetic. The plan's other channels — width, centreline, ridge
// height — are BLENDED across each segment boundary over `blend` metres, and a
// blend is a place where the corridor is changing shape. A drop inside that window
// is a drop with a moving wall beside it, and a moving wall is a ramp. Keeping the
// drop finished before the blend begins is what makes the one-way transitions
// provable rather than lucky.
function floorOf(g, x){
  if(g.sill > 0 && g.sillRun > 0 && x < g.x0 + g.sillRun)
    return g.baseIn + g.sill * smooth((x - g.x0) / g.sillRun);
  if(g.drop > 0 && g.dropRun > 0){
    const dEnd = g.x1 - g.dropTail, dStart = dEnd - g.dropRun;
    if(x >= dEnd) return g.baseIn + g.sill - g.drop;
    if(x > dStart) return g.baseIn + g.sill - g.drop * smooth((x - dStart) / g.dropRun);
  }
  return g.baseIn + g.sill;
}

function bake(pcfg, segs){
  const half = pcfg.blend * 0.5, open = pcfg.openNearEnd || 0;
  const first = segs[0], last = segs[segs.length - 1];
  TX0 = first.x0 - open - pcfg.blend;
  const x1 = last.x1 + pcfg.blend;
  TSTEP = pcfg.step; TINV = 1 / TSTEP;
  TN = Math.ceil((x1 - TX0) / TSTEP) + 2;
  CZ = new Float32Array(TN); HW = new Float32Array(TN); RT = new Float32Array(TN);
  BS = new Float32Array(TN); FR = new Float32Array(TN);
  PD = new Float32Array(TN); PR = new Float32Array(TN); CN = new Float32Array(TN);

  // The near end opens out to the ash: the floor widens all the way to the
  // containment toe, so the corridor has a mouth rather than a wall and the heat
  // can come in behind you.
  //
  // ridgeTop is DELIBERATELY NOT ramped to zero here, and that is not cosmetic. Let
  // the ridge die away at the mouth and the mouth becomes an on-ramp: the flat
  // ground outside joins the bench that lies between every ridge and the outer
  // wall, and a flood fill walked from the mouth up onto that bench and then along
  // it for two kilometres, over the top of every one-way drop on the path. Keeping
  // the ridge at full height through the mouth means the only thing that changes
  // there is the width, and the width changes fast enough (116 m over `blend`) that
  // the ridge sweeping in is far too steep to ride.
  const mouth = { halfWidth: pcfg.outerHalfWidth, centre: first.centre,
                  ridgeTop: first.ridgeTop, relief: first.relief, canopy: 0 };

  let k = 0;
  for(let i = 0; i < TN; i++){
    const x = TX0 + i * TSTEP;
    while(k < segs.length - 1 && x >= segs[k].x1) k++;
    const g = segs[k];
    // blend across each boundary so nothing in the plan is a step in x — a step
    // would be a vertical wall in the FLOOR line, and the floor line has to stay
    // gentle enough that the ridge beside it is the only thing stopping you
    let a = g, bseg = g, f = 0;
    // A blend factor OUTSIDE 0..1 does not interpolate, it extrapolates. Before the
    // first segment (x - g.x0) is negative and unbounded, which drove f far negative
    // and made lerp() return absurd values: halfWidth came out as -12388 at the head
    // of the table, and every jungle instance placed there landed 12 km sideways.
    const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
    if(x < g.x0 + half){
      a = k > 0 ? segs[k - 1] : mouth; bseg = g;
      f = clamp01(smooth(clamp01(0.5 + (x - g.x0) / pcfg.blend)));
    } else if(x > g.x1 - half){
      a = g; bseg = k < segs.length - 1 ? segs[k + 1] : g;
      f = clamp01(smooth(clamp01((x - (g.x1 - half)) / pcfg.blend)));
    }
    CZ[i] = lerp(a.centre, bseg.centre, f);
    CN[i] = lerp(a.canopy === undefined ? 0 : a.canopy, bseg.canopy === undefined ? 0 : bseg.canopy, f);
    HW[i] = lerp(a.halfWidth, bseg.halfWidth, f);
    RT[i] = lerp(a.ridgeTop, bseg.ridgeTop, f);
    FR[i] = lerp(a.relief, bseg.relief, f);
    // The floor is NOT blended: floorOf is already continuous across boundaries by
    // construction (baseOut of one equals baseIn of the next), and blending it
    // would soften exactly the drops that make the journey one-way.
    BS[i] = x < first.x0 ? floorOf(first, first.x0)
          : x > last.x1  ? floorOf(last, last.x1)
          : floorOf(g, x);
    // The pocket, if this segment has one. Shoulders of `blend` so it has a mouth
    // rather than appearing as a rectangle, and a plateau between them so its head
    // is a flat dead end you can stand in.
    PD[i] = 0; PR[i] = 0;
    const pkt = g.pocket;
    if(pkt){
      const cx = g.x0 + g.length * pkt.at, halfLen = pkt.length * 0.5;
      const off = Math.abs(x - cx);
      if(off < halfLen){
        const sh = Math.min(pcfg.blend, halfLen);
        const t = off > halfLen - sh ? (halfLen - off) / sh : 1;
        PD[i] = (pkt.side < 0 ? -1 : 1) * pkt.depth * smooth(t);
        PR[i] = pkt.rise || 0;
      }
    }
  }
  return segs;
}

export function pathSegments(){ return P ? P.segs : []; }
// Guarded because manifest.js, props.js and fauna.js all read the plan, and a pure
// test can construct any of them without ever building a world. Un-baked, the
// answer is "a corridor of nothing at zero", which is exactly what a caller that
// has no terrain should see.
const NOPLAN = { centre: 0, halfWidth: 0, ridgeTop: 0, floor: 0, relief: 0, canopy: 0,
                 pocketDepth: 0, pocketRise: 0, edgePlus: 0, edgeMinus: 0 };
export function pathPlan(x){
  if(!TN) return NOPLAN;
  let u = (x - TX0) * TINV;
  if(u < 0) u = 0; else if(u > TN - 1) u = TN - 1;
  const i = u | 0, j = i < TN - 1 ? i + 1 : i, f = u - i;
  const pd = lerp(PD[i], PD[j], f), hw = lerp(HW[i], HW[j], f);
  return { centre: lerp(CZ[i], CZ[j], f), halfWidth: hw,
           ridgeTop: lerp(RT[i], RT[j], f), floor: lerp(BS[i], BS[j], f),
           relief: lerp(FR[i], FR[j], f),
           canopy: lerp(CN[i], CN[j], f),
           pocketDepth: pd, pocketRise: lerp(PR[i], PR[j], f),
           // the floor's edge on each side, pocket included
           edgePlus: lerp(CZ[i], CZ[j], f) + hw + (pd > 0 ? pd : 0),
           edgeMinus: lerp(CZ[i], CZ[j], f) - hw + (pd < 0 ? pd : 0) };
}

export function initTerrain(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand; fbm = deps.fbm;
  config = cfg;
  const w = config.world;
  LX = w.lengthX || w.size; LZ = w.widthZ || w.size;
  SEGX = w.segmentsX || w.segments; SEGZ = w.segmentsZ || w.segments;
  const c = config.terrain.path;
  const inv = v => 1 / Math.max(1e-6, v);
  const segs = layout(c);
  bake(c, segs);
  P = {
    segs,
    startX: segs[0].x0, endX: segs[segs.length - 1].x1,
    invRidgeRun: inv(c.ridgeRun), ridgeLip: c.ridgeLip,
    outerToe: c.outerHalfWidth, invOuterRun: inv(c.outerRun),
    outerY: c.outerCrestY, outerVary: c.outerCrestVary,
    outerF: c.outerCrestFrequency, outerGain: c.outerCrestGain,
    outerTF: c.outerTalusFraction, outerTH: c.outerTalusHeight,
    endInvRun: inv(c.farEnd.run), endY: c.farEnd.crestY,
    endTF: c.farEnd.talusFraction, endTH: c.farEnd.talusHeight, endRough: c.farEnd.roughness,
    floorF: c.floorFrequency, floorRelief: c.floorRelief, floorOct: c.floorOctaves,
    crossFall: c.crossFall, benchSteps: c.benchSteps, invBenchEdge: inv(c.benchEdge)
  };
  const cl = config.climate;
  SH = {
    samples: cl.shadeSamples, step: cl.shadeStepMetres,
    soft: Math.max(0.001, cl.shadeSoftnessMetres),
    // the sun sits at +x at this elevation, so a ray toward it climbs by
    // tan(elevation) for every metre travelled in +x
    tan: Math.tan((config.world.sunElevationDeg || 0) * Math.PI / 180)
  };
}

// How much of the sun this patch of ground has lost to the rock, 0..1.
//
// The sun is at +x, low. So the ray toward it marches WEST and climbs; anything
// standing higher than the ray blocks it. In this canyon that is always the west
// wall — the east wall is the lit face and the floor is what falls into shadow.
// The lethal edge arrives from the east, so the last survivable ground and the
// deepest shade are the same place, at the foot of the west wall.
//
// Twelve heightAt calls at worst, and it exits early once fully blocked. Called
// once a frame for the player and once at load for each site.
export function shadeAt(x, z){
  // THE CANOPY IS THE OCCLUSION NOW, and the terrain is what is left of the old
  // mechanism. A rock wall cannot shade a corridor whose sun sits at +x ALONG it —
  // only the pass shoulders ever did, and the trail's banks are two metres tall. A
  // roof can. So this returns the greater of the two: the ground's own shadow, and
  // how much of the sky the jungle has closed over.
  //
  // climate.js is untouched by any of this. It takes occlusion as a parameter and
  // always did; all that changed is where the number comes from.
  const canopy = canopySource ? canopySource(x, z) : 0;
  if(canopy >= 1) return 1;
  const y = heightAt(x, z);
  let s = canopy;
  for(let i = 1; i <= SH.samples; i++){
    const d = i * SH.step;
    const over = (heightAt(x + d, z) - (y + d * SH.tan)) / SH.soft;
    if(over > s){ s = over; if(s >= 1) return 1; }   // fully blocked, stop marching
  }
  return s < 0 ? 0 : s;
}

// world/jungle.js hands its canopyAt in here. Injected rather than imported so
// terrain.js does not depend on the jungle — a world with no vegetation still has a
// working shade term, and the tests can build terrain alone.
let canopySource = null;
export function setCanopySource(fn){ canopySource = fn; }

const smooth = t => t * t * (3 - 2 * t);
const sat = t => t < 0 ? 0 : t > 1 ? 1 : t;
// fbm() is the WORLD generator's noise: SIGNED and roughly -1..1, but only
// roughly. Every term below is clamped before it is used, so each one has a
// guaranteed worst case and the wall's containment is a property of the
// arithmetic rather than of how far the noise happened to swing.
const clampS = t => t < -1 ? -1 : t > 1 ? 1 : t;

// The wall of a crevice, as a fraction of its full height across the run.
//
// A smoothstep is the wrong shape here and it is what made this read as a bowl:
// it leaves the floor curving gently upward for the first third of the run, so
// the flat ground appears to narrow and the walls appear to lean in. Real split
// rock does the opposite — a short apron of fallen scree at the foot, and then
// the face. So: a straight ramp for talusFraction of the run rising talusHeight
// of the wall, then a square root, which is near-vertical where it meets the
// apron and eases off only at the crest.
//
// That shape is also much harder to climb than the smoothstep was. The gradient
// immediately above the apron is several hundred percent, against a climb limit
// of 0.8, so the player is stopped at the foot of the wall rather than partway up
// it. Math.sqrt, not Math.pow — this runs thousands of times a frame.
function face(t, talusF, talusH){
  if(t <= 0) return 0;
  if(t >= 1) return 1;
  if(t < talusF) return talusH * (t / talusF);
  return talusH + (1 - talusH) * Math.sqrt((t - talusF) / (1 - talusF));
}

// Quantise 0..1 into `n` flat levels joined by soft risers — the low benches of
// harder rock the erosion left standing. invEdge is 1/benchEdge: the riser
// occupies benchEdge of a level, so its slope is the underlying slope times
// 1.5*invEdge and the floor stops being walkable somewhere below benchEdge 0.5.
// Math.floor and a smoothstep; no branch the CPU cannot predict.
function terrace(t, n, invEdge){
  const s = t * n, i = Math.floor(s);
  const f = (s - i - 0.5) * invEdge + 0.5;
  if(f <= 0) return i / n;
  if(f >= 1) return (i + 1) / n;
  return (i + f * f * (3 - 2 * f)) / n;
}

// THE PATH.
//
// A corridor along x, walked in +x, because that is the only direction that stays
// ahead of the heat: dawnX rises with t, tempAt puts the heat behind the dawn line
// at low x, and lostAtT(x) buys fifty seconds for every hundred metres of +x.
//
// TWO LAYERS, and the split between them is load-bearing.
//
//   the OUTER wall contains you. Its toe is a straight line at |z| = outerToe and
//   NOTHING may make it depend on x. A wall line that moves in the direction of
//   travel is a diagonal ramp: stand still on the face while the line slides under
//   you and the grade you feel is the wall's own grade times how fast the line
//   moves, and about 0.03 m of drift per metre is already a walkable 0.2. That was
//   measured, twice, by a flood fill walking out of two earlier worlds. Its crest
//   is an ABSOLUTE elevation, so as the floor steps down the wall gets taller.
//
//   the INNER RIDGE is everything you see: the chamber walls, the pass throats,
//   the lateral offsets that stop you seeing the next chamber. Its plan wanders
//   freely and it is capped in height, so the worst a player can do by riding it
//   is stand on top of a ridge inside the box.
//
// ONE-WAY BY GROUND, and by nothing else. The floor's elevation is part of the
// baked plan, and where a segment's drop is steep enough that 1.5*drop/dropRun
// exceeds player.maxClimbGrade, that transition can be walked down and not back
// up. No script, no animation, no invisible wall. The sill in front of each drop
// does the other half of the job: it hides the next chamber's floor from this one.
//
// Called thousands of times a frame, and it is CHEAPER than the crevice was: one
// table index and one lerp give the centreline, the width, the ridge height, the
// floor and the local roughness. The only noise on the floor is the floor's own
// relief; the outer wall's crest costs a second sample, and only within its run.
export function heightAt(x, z){
  // ---- the plan, straight out of the baked tables --------------------------
  let u = (x - TX0) * TINV;
  if(u < 0) u = 0; else if(u > TN - 1) u = TN - 1;
  const i = u | 0, j = i < TN - 1 ? i + 1 : i, f = u - i;
  const cz   = CZ[i] + (CZ[j] - CZ[i]) * f;
  const hw   = HW[i] + (HW[j] - HW[i]) * f;
  const rt   = RT[i] + (RT[j] - RT[i]) * f;
  const base = BS[i] + (BS[j] - BS[i]) * f;

  // ---- the inner ridge: the wall of whatever chamber or pass this is -------
  // THE LIP is the whole containment argument, so it is worth being clear about.
  // Everything else in the plan drifts along the journey — the width, the
  // centreline, the ridge's own height — and a drifting wall beside a floor is a
  // staircase: whatever slope the wall has, the grade the player feels while
  // standing still is that slope times how fast the wall moves, and there is always
  // somewhere the product falls under maxClimbGrade. A flood fill found three
  // separate versions of that route. The lip closes it by being a DISCONTINUITY:
  // the ground jumps by ridgeLip the instant you pass the floor's edge, so the
  // grade of that step is ridgeLip/stride whatever the stride is, and the smaller
  // the step the more steeply it is refused. Nothing that drifts can soften it.
  const side = z >= cz ? 1 : -1;
  const az = side > 0 ? z - cz : cz - z;
  // A detour reaches off one side only, so it widens this side's floor and nobody
  // else's. Inside it the floor may climb with depth — that is what turns one of the
  // six into a climb rather than a walk.
  const pd = PD[i] + (PD[j] - PD[i]) * f;
  let hwSide = hw, floorY = base;
  if(pd !== 0 && (pd > 0) === (side > 0)){
    const depth = pd > 0 ? pd : -pd;
    hwSide = hw + depth;
    if(az > hw){
      const pr = PR[i] + (PR[j] - PR[i]) * f;
      if(pr !== 0) floorY += pr * (az - hw);
    }
  }
  const rt2 = (az - hwSide) * P.invRidgeRun;
  const rf = rt2 > 0 ? (rt2 >= 1 ? 1 : Math.sqrt(rt2)) : 0;
  let h = floorY + (rt2 > 0 ? P.ridgeLip + rf * rt : 0);

  // ---- the outer wall: fixed toe, absolute crest, stacked on the ridge -----
  // Stacked and not maxed, for the reason the crevice learned the hard way: a max
  // leaves the ridge's top standing proud past the outer toe as a flat shelf, and
  // a shelf lets the face above it be started part-way up.
  const azo = z >= 0 ? z : -z;
  const ot = sat((azo - P.outerToe) * P.invOuterRun);
  if(ot > 0){
    const crest = P.outerY * (1 + P.outerVary *
      clampS(fbm(x * P.outerF, 0.31, 2) * P.outerGain));
    const top = floorY + rt;
    if(crest > top) h += face(ot, P.outerTF, P.outerTH) * (crest - top);
  }

  // ---- the far end: closed. The near end is open to the ash. --------------
  const et = sat((x - P.endX) * P.endInvRun);
  if(et > 0){
    const lump = 1 + P.endRough * fbm(z * 0.02, 7.3, 2);
    const top = P.endY * lump;
    if(top > h) h += (top - h) * face(et, P.endTF, P.endTH);
  }

  // ---- the floor ----------------------------------------------------------
  // Nothing but the floor gets floor detail. Letting it bleed up the ridge would
  // put a couple of metres of relief right where the lip is trying to be exactly
  // ridgeLip tall, and a metre of favourable relief is a metre off the lip.
  const fm = rt2 > 0 ? 0 : (FR[i] + (FR[j] - FR[i]) * f);
  if(fm > 0.001){
    // never level across the corridor, and which way it tips follows the plan's
    // own wander, so it costs nothing
    h += P.crossFall * (z - cz) * fm;
    const fr = fbm(x * P.floorF, z * P.floorF, P.floorOct);
    h += (terrace(fr * 0.5 + 0.5, P.benchSteps, P.invBenchEdge) * 2 - 1) * P.floorRelief * fm;
  }
  return h;
}

// The ground colour is baked into the mesh here, once, at load. It costs nothing
// per frame — all of it is vertex data by the time the game is running.
//
// The vertex palette carries every scale above ~450 m (palette.broadFrequency),
// plus the slope and elevation blends. The maps below carry everything below one
// tile. There is deliberately NO colour map: a colour map would repeat dozens of
// times across the plain, and colour is the channel the eye picks a repeat out of
// fastest, so it would put a visible grid on the one surface that fills the
// screen. Grain comes from relief instead — the sun rakes in low from +x, which is
// the light a normal map reads best under, and it converts that relief into tone
// for free without touching the tuned palette.
//
// There is also no second, larger-scale relief map. r128 gives one uv transform
// per material and ignores bumpMap whenever a normalMap is bound (see the header),
// so a second scale would need either a shader edit, a uv2 set, or a second mesh —
// all three are out. The 20 m tile is the compromise: large enough that only ~4
// repeats are inside the ~80 m of ground that reads as detailed from eye height,
// small enough that a 512 map still gives ~4 cm texels.
export function buildTerrain(){
  const P=config.terrain.palette, D=P.slopeSampleDistance;
  // A STRIP, not a square: the world is 2800 x 460 now. PlaneGeometry's second
  // dimension becomes z after the rotateX, so widthZ is the height argument.
  const geo=new THREE.PlaneGeometry(LX,LZ,SEGX,SEGZ);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,col=[];
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i),y=heightAt(x,z);pos.setY(i,y);
    // slope: steep ground shows rock, flat ground holds ash
    const gx=heightAt(x+D,z)-heightAt(x-D,z), gz=heightAt(x,z+D)-heightAt(x,z-D);
    const slope=Math.min(1,Math.hypot(gx,gz)/P.slopeScale);
    const dust=fbm(x*P.dustFrequency,z*P.dustFrequency,2)*.5+.5;
    const fine=fbm(x*P.fineFrequency,z*P.fineFrequency,2)*.5+.5;
    // one very slow drift across the whole map, so a wide view is not one flat tone
    const broad=fbm(x*P.broadFrequency+7,z*P.broadFrequency-3,P.broadOctaves)*.5+.5;
    let r=P.ash[0]+dust*P.dustGain[0]+fine*P.fineGain[0]+broad*P.broadWarm[0];
    let g=P.ash[1]+dust*P.dustGain[1]+fine*P.fineGain[1]+broad*P.broadWarm[1];
    let b=P.ash[2]+dust*P.dustGain[2]+fine*P.fineGain[2]+broad*P.broadWarm[2];
    // exposed rock, cooler and darker
    r=r*(1-slope*P.rockBlend)+P.rock[0]*slope;
    g=g*(1-slope*P.rockBlend)+P.rock[1]*slope;
    b=b*(1-slope*P.rockBlend)+P.rock[2]*slope;
    const hi=Math.min(1,Math.max(0,(y-P.highStart)/P.highRange));
    r+=hi*P.highLift[0];g+=hi*P.highLift[1];b+=hi*P.highLift[2];
    col.push(r,g,b);
  }
  geo.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
  geo.computeVertexNormals();

  // PlaneGeometry UVs run 0..1 across each dimension, so on a strip the two repeat
  // counts differ — one tile per tileMetres in BOTH directions, or the ground's
  // grain would be stretched six times longer along the corridor than across it.
  const repX = LX / TUNING.tileMetres, repZ = LZ / TUNING.tileMetres;
  const normalMap = tex.normalTexture("groundNormal", tex.sizeFor("groundNormal", 512),
    groundHeight, TUNING.normalStrength, { repeat: [repX, repZ] });
  const roughnessMap = tex.texture("groundRough", tex.sizeFor("groundRough", 256),
    size => tex.greyPixels(size, groundRoughness), { repeat: [repX, repZ] });

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: TUNING.groundRoughness,   // the map scales this down, never up
    metalness: 0,
    normalMap, roughnessMap,
    dithering: true                      // the fog gradient bands badly without it
  });
  mat.normalScale.set(TUNING.normalScale, TUNING.normalScale);

  const m=new THREE.Mesh(geo,mat);
  m.receiveShadow=true;scene.add(m);
}

// The far hills sit 2100-3700 m out, where FogExp2 has already taken 82-99% of
// them. They are silhouette and nothing else, so they get no maps — texture
// budget spent here would be invisible. What they do get: the one shared material
// they already had (18 meshes, 1 material), flat shading so a 7-to-10-sided cone
// reads as a faceted landform instead of a smoothly shaded lump, and dithering,
// because a near-flat fogged mass is exactly where 8-bit banding shows.
export function buildFarHills(){
  const fh=config.terrain.farHills;
  const mat=new THREE.MeshStandardMaterial({
    color: TUNING.hillColour, roughness: TUNING.hillRoughness, metalness: 0,
    flatShading: true, dithering: true
  });
  for(let i=0;i<fh.count;i++){const a=rand()*6.28,d=fh.minDistance+rand()*fh.distanceRange,h=fh.minHeight+rand()*fh.heightRange,r=fh.minRadius+rand()*fh.radiusRange;
    const c=new THREE.Mesh(new THREE.ConeGeometry(r,h,7+((rand()*4)|0)),mat);
    c.position.set(Math.cos(a)*d,h*.34,Math.sin(a)*d);c.rotation.y=rand()*3;scene.add(c)}
}
