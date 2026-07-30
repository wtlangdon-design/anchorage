import * as tex from "./textures.js?v=15";

// world/jungle.js — what fills the trail.
//
// The habitable band is 300 km of twilight sweeping west. Water arrives at dawn and
// growth here is explosive and brief: the jungle comes up in the hours after the
// dawn line passes, grows violently for one local day, and burns as the heat
// arrives. The player is walking inside that one day. Ahead of them it is still
// coming up; behind them it is burning.
//
// FIVE LAYERS, FIVE DRAW CALLS. Everything is a THREE.InstancedMesh — one geometry,
// one material, one draw call per layer, however many thousand plants are in it.
// Nothing here creates a mesh per object; that is the whole reason a jungle this
// dense can cost less than the rock corridor it replaced.
//
//   canopy      the roof, and the shade mechanic
//   trunk       what holds it up
//   understory  the WALL — the dense mid-height mass on the bank at the trail's edge
//   fern        knee-to-chest growth spilling onto the trail
//   litter      fallen fronds flat on the ground
//   water       standing water in the low ground, since dawn just passed
//
// GROWTH STATE IS NOT BAKED. Each layer's vertex shader is handed the dawn line's
// position once a frame and scales and tints every instance by how far behind that
// line it stands. One uniform per layer per frame and the GPU does the rest — which
// is the only way this can be per-plant without being per-object.
//
// THE CANOPY IS THE SHADE. A rock wall cannot shade a corridor whose sun sits at +x
// along it; a roof can. canopyAt() is what terrain.shadeAt folds into its occlusion,
// and climate.js never learns about any of it — it takes occlusion as a parameter
// and always did.
//
// PRNG: every draw comes off the one shared stream in the order buildJungle() runs,
// exactly like every other world module. Do not reorder the layers.

let THREE, scene, rand, heightAt, fbm, config, plan;
let J, LX, LZ;
const layers = [];          // every InstancedMesh, so the downgrade can thin them
const shaders = [];         // every compiled shader, so the dawn uniform can be set

export function initJungle(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  heightAt = deps.heightAt; fbm = deps.fbm; plan = deps.pathPlan;
  config = cfg;
  J = config.jungle;
  LX = config.world.lengthX || config.world.size;
  // The z half-width. This was missing, and the out-of-bounds test below compared a
  // z coordinate against LX — the world's LENGTH, 2800 — so it never fired and the
  // vegetation was scattered past the terrain edge and over the tops of the walls,
  // outside the corridor the player walks in. That is why the trail looked bare.
  LZ = (config.world.widthZ || config.world.size) / 2;
}

/* ---------------------------------------------------------------- canopy ---
   How much of the sky is closed over this point, 0..1. The segment's own canopy
   value, punched through by a gap field so a nominally closed stretch still has
   sun coming through in places. Two noise samples, and shadeAt calls it once per
   march step, so it stays cheap. */
export function canopyAt(x, z){
  if(!plan) return 0;
  const p = plan(x);
  // THE TRAIL IS WHERE THE ROOF IS THINNEST, and that is not a detail — it is why
  // the trail is a trail. The herd breaks the growth down along it every ninety days,
  // so the canopy over it is torn and the sun gets in. Step off it, into growth
  // nothing has walked through, and the roof closes over your head. Which means the
  // detours are the SHADED places and the main line is the exposed one: the safe
  // forward progress is the hot progress. offBoost is that gradient.
  const off = Math.abs(z - p.centre) - p.halfWidth;
  const deep = off <= 0 ? 0 : off >= J.offFull ? 1 : off / J.offFull;
  let base = p.canopy + J.offBoost * deep;
  if(base <= 0) return 0;
  if(base > 1) base = 1;
  const g = fbm(x * J.gapFrequency, z * J.gapFrequency, J.gapOctaves) * J.gapGain;
  const gap = g > 1 ? 1 : g < -1 ? -1 : g;
  const c = base - J.gapDepth * (gap * 0.5 + 0.5);
  return c < 0 ? 0 : c > 1 ? 1 : c;
}

/* ------------------------------------------------------------- what you hear ---
   Two more pure queries, for the soundfield. They are here rather than in the
   audio module because they are facts about the planet, not about the mix, and
   because growthAt has to agree with the growth shader below to the decimal — if
   the insects are loud where the plants are drawn black, the world is lying. */

// How alive the growth is at this x, 0..1. Exactly what the vertex shader computes:
// nothing ahead of growthRise, rising to full at the dawn line, browning after
// growthFull, gone by growthBurn. `behind` is metres BEHIND the dawn line, so it is
// negative ahead of it.
export function growthAt(x, dawnLineX){
  if(!J) return 0;
  const behind = dawnLineX - x;
  const rise = clamp01((behind - J.growthRise) / Math.max(0.001, -J.growthRise));
  const age = clamp01((behind - J.growthFull) / Math.max(1, J.growthBurn - J.growthFull));
  return rise * (1 - age);
}

// How wet the ground is here, 0..1. The SAME test the water layer places ponds by —
// how far this ground dips below the trail's own floor line — so the sound of water
// and the sight of it cannot disagree. Off the trail the bank rises, so it dries out.
export function wetnessAt(x, z){
  if(!J || !plan) return 0;
  const p = plan(x);
  const depth = (p.floor - J.water.pondBelow) - heightAt(x, z);
  return clamp01(depth / J.water.wetDepth);
}

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

/* ---------------------------------------------------------------- shaders ---
   GLSL wants "1.0", never "1" — config numbers go through these. */
const f = n => Number(n).toFixed(5);
const hex = v => { const n = Number(v);
  return `vec3(${f(((n >> 16) & 255) / 255)},${f(((n >> 8) & 255) / 255)},${f((n & 255) / 255)})`; };

// The growth shader, shared by every standing layer. `age` runs 0 at the dawn line
// to 1 deep in the burn; `rise` runs 0 ahead of the line to 1 at it.
//
// One subtlety worth knowing: instanceMatrix[3] is the instance's translation, so
// instanceMatrix[3][0] is its world x. That is how each plant knows where it stands
// without a per-instance attribute of its own.
/* The growth shader is gone.
 *
 * It injected hand-written GLSL into three's Lambert shader to do three things:
 * a base-to-tip colour gradient, browning and burning behind the dawn line, and a
 * per-vertex growth scale. It was written blind, nobody ever saw it render, and it
 * made every plant invisible for thirteen builds. All three effects are achievable
 * with stock three.js features that are far harder to get wrong:
 *
 *   base-to-tip gradient -> baked into the geometry as vertex colours, once
 *   browning and burning -> per-instance colour, refreshed when the band moves
 *   growth scale         -> dropped; it was never visible and it cost us the module
 *
 * If you want the shader back, it is in git history at build #13.
 */
function tintByHeight(geo, baseHex, tipHex){
  const pos = geo.getAttribute("position");
  let lo = Infinity, hi = -Infinity;
  for(let i = 0; i < pos.count; i++){ const y = pos.getY(i); if(y < lo) lo = y; if(y > hi) hi = y; }
  const span = Math.max(1e-6, hi - lo);
  const base = new THREE.Color(Number(baseHex)), tip = new THREE.Color(Number(tipHex));
  const c = new THREE.Color(), arr = [];
  for(let i = 0; i < pos.count; i++){
    c.copy(base).lerp(tip, Math.pow((pos.getY(i) - lo) / span, 0.85));
    arr.push(c.r, c.g, c.b);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(arr, 3));
  return geo;
}

// Flat quads read as pale cardboard slabs. An alpha mask cut into the quad is what
// turns a rectangle into a leaf, and it is the single technique that separates
// "green blocks" from "foliage". Painted in code, no asset files.
function addPlanarUVs(geo){
  if(geo.getAttribute("uv")) return geo;
  const p = geo.getAttribute("position");
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for(let i = 0; i < p.count; i++){
    const x = p.getX(i), y = p.getY(i);
    if(x < x0) x0 = x; if(x > x1) x1 = x;
    if(y < y0) y0 = y; if(y > y1) y1 = y;
  }
  const sx = Math.max(1e-6, x1 - x0), sy = Math.max(1e-6, y1 - y0), uv = [];
  for(let i = 0; i < p.count; i++)
    uv.push((p.getX(i) - x0) / sx, (p.getY(i) - y0) / sy);
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  return geo;
}

// A frond: central rib, leaflets stepping out and shortening toward the tip.
function frondMask(){
  return tex.texture("frond", tex.sizeFor("frond", 128), (size) => tex.fillPixels(size, (x, y, a, i) => {
      const u = x / size, v = y / size;            // v=0 base, v=1 tip
      const dx = Math.abs(u - 0.5);
      const taper = Math.pow(1 - v, 0.55);          // narrows toward the tip
      const rib = dx < 0.035 * taper + 0.008;
      // leaflets: a comb along the rib, alternating, shrinking with height
      const comb = Math.abs(Math.sin((v * 26 + (u > 0.5 ? 0.5 : 0)) * Math.PI));
      const reach = 0.42 * taper * (0.45 + 0.55 * comb);
      const leaf = dx < reach && v < 0.985;
      const on = rib || leaf;
      a[i] = a[i + 1] = a[i + 2] = 255;
      a[i + 3] = on ? 255 : 0;
    }), { srgb: false });
}

// A canopy crown seen from below: dense in the middle, ragged at the rim.
function crownMask(){
  return tex.texture("crown", tex.sizeFor("crown", 128), (size) => tex.fillPixels(size, (x, y, a, i) => {
      const u = x / size, v = y / size;
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const ang = Math.atan2(dy, dx);
      const ragged = 0.78 + 0.20 * Math.sin(ang * 7) + 0.10 * Math.sin(ang * 17 + 1.3);
      const gap = tex.fbmTile(u * 6, v * 6, 6, 3, 21) > 0.72;   // holes to see sky through
      a[i] = a[i + 1] = a[i + 2] = 255;
      a[i + 3] = (r < ragged && !gap) ? 255 : 0;
    }), { srgb: false });
}

// Scattered fallen leaves, so the ground decals are not solid plates.
function litterMask(){
  return tex.texture("litterleaves", tex.sizeFor("litterleaves", 128), (size) => tex.fillPixels(size, (x, y, a, i) => {
      const u = x / size, v = y / size;
      const n = tex.fbmTile(u * 5, v * 5, 5, 3, 7);
      a[i] = a[i + 1] = a[i + 2] = 255;
      a[i + 3] = n > 0.52 ? 255 : 0;
    }), { srgb: false });
}

function foliageMaterial(baseHex, mask){
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  // alphaTest, not transparent: no sorting cost, no blend order bugs, and it cuts a
  // leaf silhouette out of the quad instead of leaving a solid slab.
  if(mask){ m.map = mask; m.alphaTest = 0.45; }
  // Foliage is flat planes with one horizontal normal; under a raking sun they take
  // almost no diffuse light. A little self-illumination is what makes a jungle read,
  // and it is also how leaves behave.
  if(J.emissiveStrength > 0)
    m.emissive = new THREE.Color(Number(baseHex)).multiplyScalar(J.emissiveStrength);
  return m;
}


/* -------------------------------------------------------------- geometry ---
   Low-poly and cheap. Every one of these is built ONCE and instanced, so the
   vertex count here is paid once no matter how many thousands stand on the trail. */

// A crown: one squashed cone of leaf mass. Six sides is plenty under this fog.
function crownGeometry(){
  return new THREE.ConeGeometry(1, 1, 6, 1, true);
}
// A tapered column. Five sides, open-ended — nobody sees the top of a trunk under a canopy.
function trunkGeometry(){
  return new THREE.CylinderGeometry(0.55, 1, 1, 5, 1, true);
}
// A frond: two crossed quads, so it has mass from every angle for four triangles.
function frondGeometry(){
  const p = [], idx = [];
  const quad = (ax, az) => {
    const b = p.length / 3;
    p.push(-ax, 0, -az, ax, 0, az, ax, 1, az, -ax, 1, -az);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(0.5, 0); quad(0, 0.5);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
// Flat on the ground, so one quad is the whole thing.
function litterGeometry(){
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(
    [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, -0.5, 0, 0.5], 3));
  // Wound the other way this produced a normal of (0,-1,0) — a flat decal lying on
  // the ground with its face pointing INTO it, so it took no light from above and
  // rendered black. Reversed, the normal is (0,+1,0).
  g.setIndex([0, 2, 1, 0, 3, 2]); g.computeVertexNormals();
  return g;
}

/* ----------------------------------------------------------------- build ---
   The draw order is the PRNG order. Every layer takes exactly the same number of
   draws per candidate whether or not the candidate is used, so retuning a count
   moves that layer and nothing before it. */

let PLACED = null;   // counts, for the report and the tests

function place(count, pick){
  // pick(x, z, p) returns a Matrix4-ready {pos, rotY, scale} or null to skip. The
  // draws happen before the decision, so the count is fixed.
  const out = [];
  const x0 = -LX / 2 + 20, x1 = LX / 2 - 20;
  for(let i = 0; i < count; i++){
    const x = x0 + rand() * (x1 - x0);
    const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
    const p = plan(x);
    const o = pick(x, p, r1, r2, r3, r4);
    if(o) out.push(o);
  }
  return out;
}

function build(name, geo, mat, list, cast){
  // One central bound for every layer. Previously only the trunk layer checked its
  // z at all, and it checked against the world's LENGTH instead of its half-width,
  // so four of the six layers could be placed outside the walls the player stands
  // between — or off the terrain entirely. Anything non-finite is dropped too: a NaN
  // in an instance matrix silently kills the whole draw call, not just that instance.
  const limit = LZ;
  list = list.filter(o => o
    && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z)
    && Number.isFinite(o.sx) && Number.isFinite(o.sy)
    && Math.abs(o.z) <= limit);
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
        v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  list.forEach((o, i) => {
    q.setFromAxisAngle(up, o.rotY);
    v.set(o.x, o.y, o.z); sc.set(o.sx, o.sy, o.sx);
    m.compose(v, q, sc); im.setMatrixAt(i, m);
  });
  im.count = list.length;
  im.instanceMatrix.needsUpdate = true;
  im.frustumCulled = false;      // the instances span the whole trail; one bounds test would keep them all
  im.castShadow = !!cast; im.receiveShadow = true;
  scene.add(im);
  layers.push({ name, mesh: im, full: list.length });
  return im;
}

export function buildJungle(){
  const counts = {};

  // 1. the understory: the wall. Standing on the bank just outside the trail's edge,
  // on both sides, thickest right at the edge and thinning outward.
  {
    const U = J.understory;
    const list = place(U.count, (x, p, r1, r2, r3, r4) => {
      const side = r1 < 0.5 ? 1 : -1;
      const edge = side > 0 ? p.edgePlus : p.edgeMinus;
      // r2^2 biases toward the trail's edge: that is where the wall has to read
      const out = U.bandInner + r2 * r2 * (U.bandOuter - U.bandInner);
      const z = edge + side * out;
      const h = U.minHeight + r3 * U.heightRange;
      return { x, z, y: heightAt(x, z) - 0.2, rotY: r4 * 6.28,
               sx: U.minRadius + r3 * U.radiusRange, sy: h };
    });
    counts.understory = list.length;
    build("understory", addPlanarUVs(tintByHeight(frondGeometry(), U.colour, U.tipColour)),
      foliageMaterial(U.colour, frondMask()), list, false);
  }

  // 2. trunks, out in the growth beyond the understory
  {
    const Tk = J.trunk;
    const list = place(Tk.count, (x, p, r1, r2, r3, r4) => {
      const side = r1 < 0.5 ? 1 : -1;
      const edge = side > 0 ? p.edgePlus : p.edgeMinus;
      const z = edge + side * (4 + r2 * Tk.spread);
      if(Math.abs(z) > LZ) return null;
      const h = Tk.minHeight + r3 * Tk.heightRange;
      return { x, z, y: heightAt(x, z) - 0.5, rotY: r4 * 6.28,
               sx: Tk.minRadius + r3 * Tk.radiusRange, sy: h };
    });
    counts.trunk = list.length;
    build("trunk", tintByHeight(trunkGeometry(), Tk.colour, Tk.colour),
      foliageMaterial(Tk.colour, null), list, true);
  }

  // 3. the canopy. Its density follows the segment's own canopy value, so a clearing
  // is a clearing: this is the layer the shade term is a model of.
  {
    const C = J.canopy;
    const list = place(C.count, (x, p, r1, r2, r3, r4) => {
      const cover = p.canopy;
      if(r1 > cover) return null;              // a clearing gets no roof
      const side = r2 < 0.5 ? 1 : -1;
      const z = p.centre + side * (r3 * (p.halfWidth + C.spread * 0.5));
      const h = C.minHeight + r3 * C.heightRange;
      return { x, z, y: heightAt(x, z) + h, rotY: r4 * 6.28,
               sx: C.minRadius + r4 * C.radiusRange, sy: -(h * 0.42) };
    });
    counts.canopy = list.length;
    build("canopy", addPlanarUVs(tintByHeight(crownGeometry(), C.colour, C.tipColour)),
      foliageMaterial(C.colour, crownMask()), list, true);
  }

  // 4. ferns, on the trail itself — the only layer the player walks through
  {
    const F = J.fern;
    const list = place(F.count, (x, p, r1, r2, r3, r4) => {
      const z = p.centre + (r1 * 2 - 1) * (p.halfWidth + F.reach);
      const s = F.minScale + r2 * F.scaleRange;
      return { x, z, y: heightAt(x, z) - 0.05, rotY: r3 * 6.28, sx: s, sy: s * (1.3 + r4 * 0.9) };
    });
    counts.fern = list.length;
    build("fern", addPlanarUVs(tintByHeight(frondGeometry(), F.colour, F.tipColour)),
      foliageMaterial(F.colour, frondMask()), list, false);
  }

  // 5. litter, flat on the trail
  {
    const L = J.litter;
    const list = place(L.count, (x, p, r1, r2, r3, r4) => {
      const z = p.centre + (r1 * 2 - 1) * (p.halfWidth + L.reach);
      const s = L.minScale + r2 * L.scaleRange;
      return { x, z, y: heightAt(x, z) + 0.03, rotY: r3 * 6.28, sx: s * (1 + r4), sy: s };
    });
    counts.litter = list.length;
    build("litter", addPlanarUVs(tintByHeight(litterGeometry(), L.colour, L.colour)),
      foliageMaterial(L.colour, litterMask()), list, false);
  }

  // 6. standing water, in the low ground. Not growth, so it gets no growth shader —
  // the water was here before the jungle and will be here after it burns.
  {
    const W = J.water;
    const list = place(W.count, (x, p, r1, r2, r3, r4) => {
      const z = p.centre + (r1 * 2 - 1) * (p.halfWidth + W.reach);
      const y = heightAt(x, z);
      // is this a hollow? compare with the trail's own floor line, which the plan
      // knows, so a pond only appears where the ground actually dips below it
      if(y > p.floor - W.pondBelow) return null;
      return { x, z, y: y + W.lift, rotY: r3 * 6.28,
               sx: W.minRadius + r2 * W.radiusRange, sy: 1 };
    });
    counts.water = list.length;
    const im = new THREE.InstancedMesh(litterGeometry(),
      new THREE.MeshLambertMaterial({ color: Number(W.colour), transparent: true,
        opacity: W.opacity, side: THREE.DoubleSide }), Math.max(1, list.length));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(),
          v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    list.forEach((o, i) => { q.setFromAxisAngle(up, o.rotY);
      v.set(o.x, o.y, o.z); sc.set(o.sx, 1, o.sx); m.compose(v, q, sc); im.setMatrixAt(i, m); });
    im.count = list.length; im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false; im.receiveShadow = true;
    scene.add(im);
    layers.push({ name: "water", mesh: im, full: list.length });
  }

  PLACED = counts;
}

// Called once a frame. uDawn is where the dawn line is NOW, which is what turns the
// whole jungle from a static model into one day of growth. Mission time, not the wall
// clock: the growth state is a fact about the planet, not an animation.
export function setGrowth(dawnLineX, animT){
  // The per-frame growth/burn was a shader uniform. With the shader gone this is a
  // no-op; the burn is a per-instance colour question now, and is not wired yet.
  // Kept so main.js keeps its call site and the wiring stays obvious.
}

// Render-only, as with the grass: every plant was generated and still shades and
// still burns, we simply stop drawing some of them.
export function applyDowngrade(mult){
  // A missing multiplier used to become NaN, and an instance count of NaN draws
  // NOTHING. That blanked the whole jungle on phones. Absent means "no reduction".
  const _m = Number.isFinite(mult) ? Math.max(0, Math.min(1, mult)) : 1;

  for(const l of layers) l.mesh.count = Math.max(1, Math.floor(l.full * _m));
}

export function stats(){ return { layers: layers.map(l => ({ name: l.name, count: l.full, uuid: l.mesh.uuid })), placed: PLACED }; }
