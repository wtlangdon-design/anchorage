// world/sky.js — sky dome, sun disc, drifting dust, and sun glare sprites.
//
// Ported from the reference (lines 380-397, 421-451, 1195-1196). The shader
// mechanism, the object budget and the PRNG draw order are exactly as they were
// in that port. What changed is that the sun, the glare and the dust now carry
// maps drawn by world/textures.js instead of a flat colour, a hand-rolled
// CanvasTexture and default square points.
//
// Two budgets are fixed and must stay fixed:
//   objects — one sky dome, one sun disc, three glare sprites, one Points cloud.
//             nothing in this file may add anything else to the scene.
//   rand()  — buildDust() draws 3 per particle (x, y, z) and nothing else here
//             draws at all. Texture noise uses textures.js's own integer hash,
//             which never touches the world PRNG, so the maps below cannot move
//             a single rock.

import * as tex from "./textures.js";

let THREE, scene, rand, config;
let SUNDIR;
let dust;

// TODO(lead): lift into config.json. Everything here is art, not gameplay —
// nothing in this block affects distance, speed or the dawn line.
const TUNING = {
  // --- sun disc -------------------------------------------------------------
  sunEdge: 0.88,            // photosphere radius in map units; beyond it, feather to nothing
  sunLimb: 0.45,            // limb darkening: rim brightness is 1 - this
  sunCentre255: [255, 253, 247],   // multiplied by the material colour, so it stays near white
  sunRim255: [255, 212, 162],

  // --- glare ----------------------------------------------------------------
  glareWide: 1.00,          // falloff scale across the map: wider than tall, so the
  glareTall: 1.26,          // halo is an ellipse. a low sun is not a circle.
  glareCore: 0.10,          // gaussian radius of the white core
  glareHalo: 0.20,          // exponential scale of the warm halo
  glareHaloAmount: 0.42,
  glareBroadFalloff: 2.00,  // the wide, almost-flat outer wash
  glareBroadAmount: 0.34,
  glareRim: 0.28,           // outermost fraction of the map that fades to nothing,
                            // so the sprite can never show its own square edge
  glareStreakWidth: 0.055,  // sideways smear through thick air near the horizon
  glareStreakAmount: 0.07,  // keep low. this is scatter, not a lens flare — 0 turns it off
  glareMidAt: 0.16,         // radius where the core colour has become the halo colour
  glareEdgeAt: 0.72,        // radius where the halo colour has become the outer colour
  glareCore255: [255, 247, 232],
  glareMid255: [255, 206, 142],
  glareEdge255: [240, 138, 74],
  glareSprites: [[1500, .62], [900, .34], [420, .22]],   // scale, opacity — three, always

  // --- dust -----------------------------------------------------------------
  dustSize: 0.30,           // bigger than the old square, because a round mote with a
  dustOpacity: 0.68,        // soft edge carries roughly a sixth of a square's light
  dustFalloff: 2.00,        // exponent on the mote's alpha shoulder
  dustMote255: [255, 250, 242],   // near white; the warmth comes from the material colour

  // --- high dust band in the sky shader -------------------------------------
  bandAt: 0.22,             // centre, in the shader's `up` units (~6 degrees elevation)
  bandWidth: 0.14,          // gaussian width in the same units
  bandAmount: 0.012,        // how much of it is lit away from the sun
  bandSunAmount: 0.045,     // how much more of it is lit toward the sun
  bandColour: [0.60, 0.45, 0.32]
};

export function initSky(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  config = cfg;
  SUNDIR = { x:config.world.sunDirection.x, z:config.world.sunDirection.z };
}

// GLSL wants "1.0", never "1" — every number that goes into a shader string is
// formatted through these, so a whole number in config.json cannot break the build.
const f = n => Number(n).toFixed(5);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

/* ---------- small pure helpers, shared by the paint functions ---------- */

const sat = v => v < 0 ? 0 : v > 1 ? 1 : v;
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (e0, e1, x) => { const t = sat((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };

/* ---------- maps (pure: no rand, no Math.random, no clock) ---------- */

// The sun. Limb darkening plus a feathered rim, so it reads as a body with an
// edge the air is eating rather than a circle pasted on the sky. The centre is
// left near white because the material colour supplies the warmth — with maps
// switched off the disc falls back to exactly the flat colour it had before.
function sunDiscPixels(size){
  const T = TUNING, C0 = T.sunCentre255, C1 = T.sunRim255;
  return tex.fillPixels(size, (x, y, px, i) => {
    const dx = ((x + .5) / size - .5) * 2, dy = ((y + .5) / size - .5) * 2;
    const r = Math.hypot(dx, dy);
    const rn = sat(r / T.sunEdge);
    const mu = Math.sqrt(Math.max(0, 1 - rn * rn));   // cosine to the surface at that radius
    const limb = 1 - T.sunLimb * (1 - mu);
    const t = sstep(0, 1, 1 - mu);
    px[i]     = mix(C0[0], C1[0], t) * limb;
    px[i + 1] = mix(C0[1], C1[1], t) * limb;
    px[i + 2] = mix(C0[2], C1[2], t) * limb;
    px[i + 3] = (1 - sstep(T.sunEdge, 1, r)) * 255;
  });
}

// The glare. A warm core, a wide soft falloff, an ellipse rather than a circle,
// and a faint sideways smear — light travelling a long way through low air does
// not arrive round. Alpha reaches zero before the border in every direction, so
// the sprite has no edge to show.
function glarePixels(size){
  const T = TUNING, C0 = T.glareCore255, C1 = T.glareMid255, C2 = T.glareEdge255;
  return tex.fillPixels(size, (x, y, px, i) => {
    const dx = ((x + .5) / size - .5) * 2, dy = ((y + .5) / size - .5) * 2;
    const r = Math.hypot(dx * T.glareWide, dy * T.glareTall);
    const w = 1 - r;
    if (w <= 0) { px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0; return; }
    const core = Math.exp(-(r * r) / (T.glareCore * T.glareCore));
    const halo = Math.exp(-r / T.glareHalo) * T.glareHaloAmount;
    const broad = Math.pow(w, T.glareBroadFalloff) * T.glareBroadAmount;
    const streak = Math.exp(-(dy * dy) / (T.glareStreakWidth * T.glareStreakWidth))
                 * Math.max(0, 1 - Math.abs(dx)) * T.glareStreakAmount;
    const a = sat(core + halo + broad + streak) * sstep(0, T.glareRim, w);
    const t1 = sstep(0, T.glareMidAt, r), t2 = sstep(T.glareMidAt, T.glareEdgeAt, r);
    px[i]     = mix(mix(C0[0], C1[0], t1), C2[0], t2);
    px[i + 1] = mix(mix(C0[1], C1[1], t1), C2[1], t2);
    px[i + 2] = mix(mix(C0[2], C1[2], t1), C2[2], t2);
    px[i + 3] = a * 255;
  });
}

// One dust mote. Square points are the loudest default-engine tell in the scene;
// all this does is make them round, with a shoulder soft enough that they read as
// out-of-focus grit rather than pixels.
function dustMotePixels(size){
  const C = TUNING.dustMote255;
  return tex.fillPixels(size, (x, y, px, i) => {
    const dx = ((x + .5) / size - .5) * 2, dy = ((y + .5) / size - .5) * 2;
    const w = 1 - Math.hypot(dx, dy);
    const a = w <= 0 ? 0 : Math.pow(w * w * (3 - 2 * w), TUNING.dustFalloff);
    px[i] = C[0]; px[i + 1] = C[1]; px[i + 2] = C[2]; px[i + 3] = a * 255;
  });
}

export function buildSky(){
  const K = config.sky, T = TUNING;
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{sd:{value:new THREE.Vector3(SUNDIR.x,.055,SUNDIR.z).normalize()}},
    vertexShader:`varying vec3 vP;void main(){vP=normalize(position);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vP;uniform vec3 sd;
      void main(){
      vec3 dir=normalize(vP);
      float up=clamp(dir.y*${f(K.upScale)}+${f(K.upBias)},0.,1.);
      float s=clamp(dot(dir,sd),0.,1.);
      vec3 c=mix(mix(${v3(K.horizon)},${v3(K.mid)},smoothstep(0.,.30,up)),
                 ${v3(K.zenith)},smoothstep(.26,.92,up));
      // the air thickens toward the horizon. this colour is the fog colour, which
      // is what makes the ground fade into the sky instead of ending at a line.
      c=mix(c,${v3(K.haze)},pow(1.-up,${f(K.hazePower)})*${f(K.hazeAmount)});
      c+=${v3(K.sunCore)}*pow(s,5.)*(1.-up*.70);
      c+=${v3(K.sunWash)}*pow(s,1.5)*.46*(1.-up*.86);
      // a layer of high dust sits just above the twilight band and catches the
      // sun. one quiet gaussian in altitude, brighter sunward. it is air, not
      // weather — if it ever reads as a cloud, take bandSunAmount down.
      float b=(up-${f(T.bandAt)})/${f(T.bandWidth)};
      c+=${v3(T.bandColour)}*exp(-b*b)*(${f(T.bandAmount)}+${f(T.bandSunAmount)}*s*s);
      // a gradient this smooth bands on 8-bit displays; one pixel of noise hides it
      c+=(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)-.5)*${f(K.dither)};
      gl_FragColor=vec4(c,1.);}`});
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(4800,32,20),mat));
  // transparent so the feathered rim of the map can eat the polygon edge; the
  // colour is unchanged, so with textures disabled this is the old flat disc.
  const disc=new THREE.Mesh(new THREE.CircleGeometry(78,36),
    new THREE.MeshBasicMaterial({color:0xfff2d6,fog:false,
      map:tex.texture("sunDisc",tex.sizeFor("sunDisc",128),sunDiscPixels,{srgb:true}),
      transparent:true,depthWrite:false}));
  disc.position.set(4200,200,0);disc.lookAt(0,200,0);scene.add(disc);
}

/* drifting dust — cheap, and it does more for atmosphere than anything else here */
export function buildDust(){
  const N=config.render.dustCount,pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){pos[i*3]=(rand()-.5)*180;pos[i*3+1]=rand()*26;pos[i*3+2]=(rand()-.5)*180}
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));
  // a round mote carries about a sixth of the light of the square it replaces, so
  // size and opacity are up to compensate. total brightness is roughly unchanged.
  dust=new THREE.Points(g,new THREE.PointsMaterial({
    color:0xffd9a8,size:TUNING.dustSize,transparent:true,opacity:TUNING.dustOpacity,
    map:tex.texture("dustMote",tex.sizeFor("dustMote",64),dustMotePixels,{srgb:true}),
    blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  dust.frustumCulled=false;scene.add(dust);
}

/* glare around the low sun, sold with a couple of additive sprites */
export function buildGlare(){
  const map=tex.texture("glare",tex.sizeFor("glare",256),glarePixels,{srgb:true});
  TUNING.glareSprites.forEach(([s,o])=>{
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map,transparent:true,opacity:o,
      blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false,fog:false}));
    sp.scale.set(s,s,1);sp.position.set(4200,200,0);
    // an unmapped sprite is a solid white square 1500 units across. if the map
    // could not be made, the sprite stays in the scene but stays out of the frame.
    if(!map)sp.visible=false;
    scene.add(sp);
  });
}

export function updateDust(px, pz, gy, t){
  if(dust){dust.position.set(Math.round(px/40)*40,gy,Math.round(pz/40)*40);
    dust.rotation.y=t*.02}
}
