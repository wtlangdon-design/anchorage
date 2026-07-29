// world/textures.js — every texture in the game, drawn in code at load time.
//
// There are no image files in this project and there will not be any. Each map
// is painted into a canvas and wrapped in THREE.CanvasTexture — the same trick
// sky.js already used for the sun glare, applied everywhere it earns its cost.
//
// Three rules make this safe to use from anywhere:
//
//  1. NOTHING HERE TOUCHES THE WORLD PRNG. Texture noise is its own integer
//     hash with its own constant seed. The world's seeded stream is consumed in
//     a fixed order (see the header of main.js) and drawing from it here would
//     move every rock and grass blade. Adding or deleting a texture can never
//     change the world.
//  2. Every texture is registered. The quality downgrade redraws all of them at
//     a smaller size into the SAME canvas and the same texture object, so no
//     material has to be rewired and nothing leaks.
//  3. The noise is tileable by construction. It is a lattice with a whole-number
//     period, and the period wraps, so the left edge always meets the right.
//
// Painting happens in `paint(size) -> Uint8ClampedArray`, a pure function of the
// size. That keeps the pixel work out of the canvas and testable off-browser.

let THREE = null, config = null;
let quality = 1, aniso = 1;
const registry = [];

export function initTextures(three, cfg, opts = {}) {
  THREE = three; config = cfg;
  quality = 1;
  aniso = Math.max(1, Math.min(opts.maxAnisotropy || 1, (cfg.textures && cfg.textures.anisotropy) || 1));
}

/* ---------- noise: integer hash, whole-number period, wraps ---------- */

export function hash2(ix, iy, seed) {
  let h = Math.imul(ix | 0, 374761393) ^ Math.imul(iy | 0, 668265263) ^ Math.imul(seed | 0, 362437);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// x,y in [0,1). `period` must be a whole number — that is what makes it tile.
export function valueNoise(x, y, period, seed) {
  const p = Math.max(1, Math.round(period));
  const fx = x * p, fy = y * p;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = smooth(fx - x0), ty = smooth(fy - y0);
  const X0 = ((x0 % p) + p) % p, Y0 = ((y0 % p) + p) % p;
  const X1 = (X0 + 1) % p, Y1 = (Y0 + 1) % p;
  return lerp(
    lerp(hash2(X0, Y0, seed), hash2(X1, Y0, seed), tx),
    lerp(hash2(X0, Y1, seed), hash2(X1, Y1, seed), tx), ty);
}

// Octaves of the above. Returns 0..1. Still tiles: every period stays whole.
export function fbmTile(x, y, period, octaves, seed) {
  let sum = 0, amp = 0.5, per = Math.max(1, Math.round(period)), norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x, y, per, seed + i * 101);
    norm += amp; amp *= 0.5; per *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

// Ridged variant — good for cloth weave, scratches, strata.
export function ridgeTile(x, y, period, octaves, seed) {
  return 1 - Math.abs(fbmTile(x, y, period, octaves, seed) * 2 - 1);
}

/* ---------- pixel helpers (pure: no canvas, so they can be tested) ---------- */

// cb(x, y, px, i) writes 4 bytes at i.
export function fillPixels(size, cb) {
  const px = new Uint8ClampedArray(size * size * 4);
  for (let y = 0, i = 0; y < size; y++)
    for (let x = 0; x < size; x++, i += 4) cb(x, y, px, i);
  return px;
}

// fn(u, v) -> height, u/v in [0,1). Returns a Float32Array.
export function heightField(size, fn) {
  const h = new Float32Array(size * size);
  for (let y = 0, i = 0; y < size; y++)
    for (let x = 0; x < size; x++, i++) h[i] = fn(x / size, y / size);
  return h;
}

// Height field -> tangent-space normal pixels, sampled with wrap so it tiles.
// If relief ever reads inverted (pits where you wanted bumps), negate strength.
export function normalPixels(h, size, strength) {
  const at = (x, y) => h[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  return fillPixels(size, (x, y, px, i) => {
    const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
    const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
    const len = Math.hypot(nx, ny, 1) || 1;
    px[i] = (nx / len * 0.5 + 0.5) * 255;
    px[i + 1] = (ny / len * 0.5 + 0.5) * 255;
    px[i + 2] = (1 / len * 0.5 + 0.5) * 255;
    px[i + 3] = 255;
  });
}

// Single channel (roughness / metalness / alpha) written to all of rgb.
export function greyPixels(size, fn) {
  return fillPixels(size, (x, y, px, i) => {
    const v = Math.max(0, Math.min(1, fn(x / size, y / size))) * 255;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  });
}

/* ---------- registration ---------- */

// Look a size up by name so a module can ask for a knob that does not exist yet
// without producing a NaN-sized canvas.
export function sizeFor(key, fallback) {
  const s = config && config.textures && config.textures.sizes;
  const v = s && s[key];
  return typeof v === "number" && v > 0 ? v : fallback;
}

function paintInto(entry, scale) {
  const size = Math.max(16, Math.round(entry.baseSize * scale));
  const c = entry.canvas;
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  img.data.set(entry.paint(size));
  ctx.putImageData(img, 0, 0);
  entry.size = size;
}

// paint(size) -> Uint8ClampedArray of size*size*4.
// opts: { repeat:[u,v], srgb:true for colour maps, name }
export function texture(name, baseSize, paint, opts = {}) {
  if (!THREE || !config || (config.textures && config.textures.enabled === false)) return null;
  try {
    const entry = { name, baseSize, paint, canvas: document.createElement("canvas"), opts };
    paintInto(entry, quality);
    const t = new THREE.CanvasTexture(entry.canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    // colour maps are authored in sRGB; normal/rough/metal maps must stay linear
    if (opts.srgb && THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    entry.texture = t;
    registry.push(entry);
    return t;
  } catch (e) {
    return null;   // a missing texture must never stop the world from building
  }
}

// Convenience: height function straight to a normal map.
export function normalTexture(name, baseSize, heightFn, strength, opts = {}) {
  return texture(name, baseSize,
    size => normalPixels(heightField(size, heightFn), size, strength), opts);
}

// Some things are far easier drawn than computed — gradients, engraved strokes,
// panel lines. draw(ctx, size) gets the 2D context directly. Same rules apply:
// it must be pure (no Math.random, no clock), because the downgrade re-runs it.
// Coordinates must scale with `size`, never be hard-coded pixels, or the map
// will not survive being redrawn smaller.
export function drawTexture(name, baseSize, draw, opts = {}) {
  if (!THREE || !config || (config.textures && config.textures.enabled === false)) return null;
  try {
    const entry = { name, baseSize, draw, canvas: document.createElement("canvas"), opts };
    drawInto(entry, quality);
    const t = new THREE.CanvasTexture(entry.canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
    if (opts.srgb && THREE.sRGBEncoding !== undefined) t.encoding = THREE.sRGBEncoding;
    t.anisotropy = aniso;
    t.needsUpdate = true;
    entry.texture = t;
    registry.push(entry);
    return t;
  } catch (e) {
    return null;
  }
}

function drawInto(entry, scale) {
  const size = Math.max(16, Math.round(entry.baseSize * scale));
  const c = entry.canvas;
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, size, size);
  entry.draw(ctx, size);
  entry.size = size;
}

/* ---------- quality + accounting ---------- */

// Called by the downgrade path in main.js. Redraws every map smaller into the
// same canvas and the same texture object — no rewiring, nothing orphaned.
export function setQuality(scale) {
  if (!registry.length) return;
  quality = Math.max(0.125, Math.min(1, scale));
  for (const e of registry) {
    try { (e.draw ? drawInto : paintInto)(e, quality); e.texture.needsUpdate = true; } catch (err) {}
  }
}

export function stats() {
  let bytes = 0;
  const list = registry.map(e => {
    // mipmaps add a third again on top of the base level
    const b = e.size * e.size * 4 * 4 / 3;
    bytes += b;
    return { name: e.name, size: e.size, kb: Math.round(b / 1024) };
  });
  return { count: registry.length, bytes, mb: +(bytes / 1048576).toFixed(2), quality, list };
}

export function disposeAll() {
  for (const e of registry) { try { e.texture.dispose(); } catch (err) {} }
  registry.length = 0;
}
