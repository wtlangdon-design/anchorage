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

import * as tex from "./textures.js";

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
let SIZE, SEG, CY, SH;

export function initTerrain(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand; fbm = deps.fbm;
  config = cfg;
  SIZE = config.world.size; SEG = config.world.segments;
  const c = config.terrain.canyon;
  const inv = v => 1 / Math.max(1e-6, v);
  const wall = s => ({
    toe: s.toe, invRun: inv(s.run), height: s.height,
    talusF: s.talusFraction, talusH: s.talusHeight,
    crestVary: s.crestVary, share: s.widthShare, notchLevel: s.notchLevel,
    bRun: s.buttress.run, bHeight: s.buttress.height,
    bTalusF: s.buttress.talusFraction, bTalusH: s.buttress.talusHeight,
    bCrestVary: s.buttress.crestVary,
    // the thickness the choke drives this buttress to: everything but `leave`
    chokeTo: s.toe - c.choke.leave
  });
  const end = s => ({
    invRun: inv(s.run), height: s.height,
    talusF: s.talusFraction, talusH: s.talusHeight, rough: s.roughness
  });
  // precomputed once so heightAt does no config lookups, no divisions and no
  // property walks. Every reciprocal in here is a division heightAt does not do.
  CY = {
    halfL: c.length / 2,
    widthF: c.widthFrequency, widthOct: c.widthOctaves,
    widthVary: c.widthVary, widthGain: c.widthGain,
    axisWander: c.axisWander,
    crestF: c.crestFrequency, crestGain: c.crestGain,
    notchF: c.notch.frequency, notchGain: c.notch.gain,
    invNotchHalf: inv(c.notch.halfWidth), notchDepth: c.notch.depth,
    chokeStart: c.choke.start, invChokeRun: inv(c.choke.run),
    wallW: wall(c.west), wallE: wall(c.east),
    endN: end(c.northEnd), endS: end(c.southEnd),
    floorF: c.floorFrequency, floorRelief: c.floorRelief, floorOct: c.floorOctaves,
    crossFall: c.crossFall, benchSteps: c.benchSteps, invBenchEdge: inv(c.benchEdge),
    chanAmp: c.channel.amplitude, invChanW: inv(c.channel.width),
    chanDepth: c.channel.depth, chanSplit: c.channel.splitOffset,
    invChanW2: inv(c.channel.secondWidth), chanDepth2: c.channel.depth * c.channel.secondDepth
  };
  const cl = config.climate;
  SH = {
    samples: cl.shadeSamples, step: cl.shadeStepMetres,
    soft: Math.max(0.001, cl.shadeSoftnessMetres),
    // the sun sits at +x (west) at this elevation, so a ray toward it climbs by
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
  const y = heightAt(x, z);
  let s = 0;
  for(let i = 1; i <= SH.samples; i++){
    const d = i * SH.step;
    const over = (heightAt(x + d, z) - (y + d * SH.tan)) / SH.soft;
    if(over > s){ s = over; if(s >= 1) return 1; }   // fully blocked, stop marching
  }
  return s < 0 ? 0 : s;
}

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

// The canyon.
//
// It runs north-south — along z — because the dawn line sweeps west along x, so
// this way the heat crosses the crevice's width (nominally 250 m, in practice
// anywhere from about 130 to 350) instead of running the length of it. That is
// the whole reason for the orientation: it makes the west wall the last cover on
// the map, since the lethal edge arrives from the east (low x) and the sun sits
// at +x, throwing that wall's shadow back across the floor.
//
// TWO LAYERS, and the split between them is the whole design.
//
//   the OUTER wall keeps you in. Its toe line is a STRAIGHT LINE IN X — west.toe
//   and east.toe — and nothing is allowed to make it depend on z. Its crest
//   height varies freely, because height variation along a fixed line cannot
//   change where the steep part starts.
//
//   the BUTTRESS in front of it carries every irregular thing: the pinching and
//   opening, the notches, the wandering axis, the choke at the south end. It is
//   capped in height, and its OUTER edge is pinned to the outer wall's toe, so
//   riding it up gets you a ledge and never a way past the face behind it.
//
// WHY, because it is not obvious and it was measured. A wall line that moves in
// x as you walk along z is a diagonal ramp, and the square-root face does NOT
// stop it. Stand still on the wall while the line slides sideways under you and
// the grade you feel is the wall's own grade times how fast the line moves —
// about 0.03 m of drift per metre of length is enough to make that a walkable
// 0.2. A flood fill under the controller's own walkable() test walked straight
// out of an earlier version of this crevice on exactly that route: onto the east
// scree at 15 m, a hundred metres north at a fixed x while the wall swept under
// it, and over the crest at 48 m without ever climbing anything. The toe pin is
// what buys the irregularity back.
//
// Called thousands of times a frame. FOUR noise samples on the floor, five under
// an end. Everything else is arithmetic, and every field below is a function of
// z alone and read once, which is why three separate features can ride each one.
export function heightAt(x, z){
  // ---- the three fields ---------------------------------------------------
  //   wv  width: 3 octaves, so the crevice pinches and opens on several scales
  //       at once and never settles into a period the eye can follow.
  //   cv  the slow field: the west crest line, the axis wander and the channel's
  //       course all ride it. One sample, three jobs.
  //   nv  notches: one octave, read at a different LEVEL on each wall so the two
  //       sides never notch at the same z, and so there is no list to loop over.
  // The gains are there because this fbm swings about +/-0.28, not +/-1; they
  // bring each field up to full range so the clamps below are real bounds.
  const wv = clampS(fbm(z * CY.widthF, 5.1, CY.widthOct) * CY.widthGain);
  const cv = clampS(fbm(0.37, z * CY.crestF, 2) * CY.crestGain);
  const nv = clampS(fbm(z * CY.notchF, 71.3, 1) * CY.notchGain);

  const W = x >= 0 ? CY.wallW : CY.wallE;        // +x is west: the wall that shades
  const ax = x >= 0 ? x : -x;

  // ---- the buttress: everything irregular, capped in height ----------------
  // Its thickness is what the width field actually swings. A notch is simply the
  // buttress going missing, so the floor runs back to the foot of the main cliff
  // and dead-ends against it. The choke is the buttresses swelling until they
  // nearly meet.
  const nr = sat(1 - Math.abs(nv - W.notchLevel) * CY.invNotchHalf);
  const notch = nr * nr * (3 - 2 * nr);
  const ck = sat((z - CY.chokeStart) * CY.invChokeRun);
  let thick = W.bRun * (1 + CY.widthVary * wv * W.share) * (1 - CY.notchDepth * notch);
  // the choke LERPS the thickness to "everything but `leave` metres of floor",
  // rather than adding to it — added, a wide place at the south end would close
  // past the axis and the floor would come out negative
  thick += (W.chokeTo - thick) * ck * ck * (3 - 2 * ck);
  if(thick < 4) thick = 4;                       // never divide by nothing
  // the axis wander slides the buttress bodily, inner and outer edge together
  const axb = ax - (x >= 0 ? CY.axisWander * cv : -CY.axisWander * cv);
  const bf = face(1 - (W.toe - axb) / thick, W.bTalusF, W.bTalusH);
  const bh = W.bHeight * (1 + W.bCrestVary * (W === CY.wallW ? wv : cv));

  // ---- the outer wall: fixed toe, free crest, and it rises FROM the buttress -
  // Not max(buttress, wall) — STACKED. Taking the max leaves the buttress's top
  // standing proud past the outer toe as a flat shelf, and a shelf is a way to
  // start the face above it from twenty-nine metres up instead of from the
  // floor. The flood fill found exactly that at the south end and walked out
  // over it. Stacked, the outer face begins at whatever the buttress left and
  // ends at the crest, so there is no shelf anywhere and no height the player
  // can bring to the face that the face did not already account for.
  const ot = sat((ax - W.toe) * W.invRun);
  // The crest is not level — it rises and falls along the crevice, which is what
  // gives the shadow it throws a shape instead of a straight edge. The two walls
  // read different combinations of the two slow fields, so they do not rise and
  // fall together. Clamped above, so the lowest possible crest is
  // height*(1-crestVary) and the wall is unclimbable by construction rather than
  // by luck.
  const crest = W.height * (1 + W.crestVary * (W === CY.wallW ? cv : (wv - cv) * 0.5));
  let h = bf * bh + face(ot, W.talusF, W.talusH) * (crest - bh);
  const w = bf;                                  // how far into rock we are, 0..1

  // ---- the ends, which do not match ---------------------------------------
  // North is the collapse: a lumpy heap, and props.js piles boulders on it.
  // South is the smooth narrowing the choke above has already begun. Same
  // result, different cause. The face underneath is what actually stops you.
  //
  // Stacked for the same reason the outer wall is: the end LIFTS whatever is
  // already here up towards its own crest rather than replacing it, so arriving
  // at the end along the top of a buttress does not skip the part of the face
  // that does the blocking. Where the wall is already higher than the end, the
  // end does nothing.
  const E = z < 0 ? CY.endN : CY.endS;
  const et = sat((Math.abs(z) - CY.halfL) * E.invRun);
  if(et > 0){
    const lump = E.rough > 0 ? 1 + E.rough * fbm(x * 0.02, 4.7, 2) : 1;
    const top = E.height * lump;
    if(top > h) h += (top - h) * face(et, E.talusF, E.talusH);
  }

  // ---- the floor ----------------------------------------------------------
  const fm = 1 - w * 0.75;                       // all of it fades into the wall
  // cross-fall: never level across its width, and the direction it tips reverses
  // along the length. Rides the width field, so it costs nothing.
  h += CY.crossFall * x * wv * fm;
  // a braided channel, two threads, wandering on the slow field. Parabolic, not
  // a cusp: flat along its own bed, steepest on the banks, nowhere steep enough
  // to be an obstacle.
  const chx = CY.chanAmp * cv;
  const u1 = (x - chx) * CY.invChanW, q1 = 1 - u1 * u1;
  const u2 = (x + chx * CY.chanSplit) * CY.invChanW2, q2 = 1 - u2 * u2;
  let cut = q1 > 0 ? q1 * q1 * CY.chanDepth : 0;
  if(q2 > 0){ const c2 = q2 * q2 * CY.chanDepth2; if(c2 > cut) cut = c2; }
  h -= cut * fm;
  // relief, terraced into low benches — the harder beds left standing
  const fr = fbm(x * CY.floorF, z * CY.floorF, CY.floorOct);
  h += (terrace(fr * 0.5 + 0.5, CY.benchSteps, CY.invBenchEdge) * 2 - 1) * CY.floorRelief * fm;
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
  const geo=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG);geo.rotateX(-Math.PI/2);
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

  // PlaneGeometry UVs run 0..1 across the whole SIZE, so the repeat count is the
  // number of tiles across the map: world.size / tileMetres.
  const rep = SIZE / TUNING.tileMetres;
  const normalMap = tex.normalTexture("groundNormal", tex.sizeFor("groundNormal", 512),
    groundHeight, TUNING.normalStrength, { repeat: [rep, rep] });
  const roughnessMap = tex.texture("groundRough", tex.sizeFor("groundRough", 256),
    size => tex.greyPixels(size, groundRoughness), { repeat: [rep, rep] });

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
