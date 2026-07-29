// world/terrain.js — the ground: heightfield, terrain mesh, far hills.
//
// Ported from the reference (lines 186-198, 398-420, 452-457). heightAt(x,z) is
// the single source of ground elevation; every other world module imports it
// (via deps) rather than recomputing. heightAt, the mesh, the vertex colours and
// the PRNG draw order are all exactly as ported — the visual pass added surface
// maps to the two materials and nothing else.
//
// Why the ground needs maps at all: the mesh is 3400 m across 210 segments, so
// vertices sit ~16 m apart. Geometrically it is a smooth sheet, and up close it
// has no surface of its own. Everything you feel underfoot is the normal map,
// raked by the low fixed sun.
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
  tileMetres: 20,        // one texture tile per 20 m of ground -> repeat 170

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
let SIZE, SEG, CY;

export function initTerrain(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand; fbm = deps.fbm;
  config = cfg;
  SIZE = config.world.size; SEG = config.world.segments;
  const c = config.terrain.canyon;
  // precomputed once so heightAt does no config lookups and no divisions
  CY = {
    halfW: c.width / 2, halfL: c.length / 2,
    wallRun: c.wallRun, invWallRun: 1 / Math.max(1e-6, c.wallRun),
    wallH: c.wallHeight, crestVary: c.crestVary, crestF: c.crestFrequency,
    meanderA: c.meanderAmp, meanderF: c.meanderFrequency,
    endRun: c.endRun, invEndRun: 1 / Math.max(1e-6, c.endRun), endH: c.endHeight,
    floorF: c.floorFrequency, floorRelief: c.floorRelief, floorOct: c.floorOctaves
  };
}

const smooth = t => t * t * (3 - 2 * t);
const sat = t => t < 0 ? 0 : t > 1 ? 1 : t;

// The canyon.
//
// It runs north-south — along z — because the dawn line sweeps west along x, so
// this way the heat crosses the canyon's 250 m width instead of running the length
// of it. That is the whole reason for the orientation: it makes the west wall the
// last cover on the map, since the lethal edge arrives from the east (low x) and
// the sun sits at +x, throwing that wall's shadow back across the floor.
//
// Called thousands of times a frame, so it is five noise samples and no more:
// three for the floor, two for the crest line. Everything else is arithmetic.
export function heightAt(x, z){
  // The wall line is STRAIGHT in x, and it has to be. A meandering wall is a ramp:
  // stand at a fixed x on the floor and walk along z, and the wall slides under you
  // and lifts you out of the canyon at a grade of about 0.25 — gentle enough to
  // walk. Blocking that would need a meander amplitude near 84 m in a 250 m
  // canyon. So the canyon gets its shape from the crest height instead, which can
  // vary freely because it never changes where the steep part starts.
  const cx = CY.meanderA * Math.sin(z * CY.meanderF);   // 0 by default; see config
  const ax = Math.abs(x - cx);

  // wall: flat floor out to halfW, then up over wallRun to the crest
  const w = smooth(sat((ax - CY.halfW) * CY.invWallRun));
  // The crest is not level — it rises and falls along the canyon, which is what
  // gives the shadow it throws a shape instead of a straight edge.
  //
  // fbm() here is the WORLD generator's fbm, which is SIGNED and roughly -1..1 —
  // not textures.js's fbmTile, which is 0..1. Treating it as 0..1 collapsed the
  // crest to about 6 m at z=72 and opened a walkable ramp straight out of the
  // canyon. It is clamped as well as centred so that the lowest possible crest is
  // wallHeight*(1-crestVary), which is what makes the wall unclimbable by
  // construction rather than by luck.
  const cv = fbm(0.37, z * CY.crestF, 2);
  const crest = CY.wallH * (1 + CY.crestVary * (cv < -1 ? -1 : cv > 1 ? 1 : cv));
  let h = w * crest;

  // both ends close, so the canyon is a room
  const e = smooth(sat((Math.abs(z) - CY.halfL) * CY.invEndRun));
  const end = e * CY.endH;
  if(end > h) h = end;

  // floor relief, fading out as the wall takes over
  h += fbm(x * CY.floorF, z * CY.floorF, CY.floorOct) * CY.floorRelief * (1 - w * 0.75);
  return h;
}

// The ground colour is baked into the mesh here, once, at load. It costs nothing
// per frame — all of it is vertex data by the time the game is running.
//
// The vertex palette carries every scale above ~450 m (palette.broadFrequency),
// plus the slope and elevation blends. The maps below carry everything below one
// tile. There is deliberately NO colour map: at repeat 170 a colour map repeats
// 170 times across the plain, and colour is the channel the eye picks a repeat out
// of fastest, so it would put a visible grid on the one surface that fills the
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
  // number of tiles across the map: 3400 / 20 = 170.
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
