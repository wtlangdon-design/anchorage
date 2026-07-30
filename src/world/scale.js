// world/scale.js — one number that resizes the whole world.
//
// `world.scale` in config.json multiplies every horizontal world-space quantity
// once, at load, before any module reads the config. Nothing else in the codebase
// knows this exists: every module goes on reading plain config values, and the
// world is simply smaller. Set it back to 1 and you get the original build back
// exactly — multiplying by 1 is lossless in floating point, and scale.test.js
// asserts a deep-equality round trip.
//
// THREE GROUPS, and the reasoning matters if you ever edit this table:
//
//  SCALED (x scale) — anything measured in metres across the ground: positions,
//    spreads, band widths, the dawn line and its speed. Shrinking these together
//    keeps the map's proportions and keeps every distance ratio identical.
//
//  INVERSE (/ scale) — spatial *frequencies*, which are 1/metres. Terrain noise
//    and the colour palette have to get finer at the same rate the world gets
//    smaller, or the same hills would span a bigger fraction of a smaller map.
//    Fog density is 1/metres too. climate.k is degrees per metre, so it steepens
//    to keep the thermal gradient covering the same fraction of the world.
//
//  DELIBERATELY UNSCALED — the player. Walk and sprint speed (asked for), and
//    every radius the player interacts through: survey radii, refill radii, the
//    ashwaiter damage radius, the null radius. The surveyor does not shrink, so
//    the distances at which they can touch things should not either. Vertical
//    scale is also untouched: terrain amplitudes, ridge height, basin depth. A
//    shorter world with the same hills reads as steeper ground, which is a look
//    to judge in the browser rather than a number to guess at here.
//
// WHY GRASS IS IN THE TABLE even though it is not a landmark: refillGrass()
// rejection-samples against world.size, grass.spawnWidth, grass.falloffSigma and
// grass.bandOffset. Scale those together and every comparison in that loop is
// scale-invariant, so it consumes exactly the same number of PRNG draws and the
// world downstream of it is untouched. Leave any one of them out and the draw
// count moves, which moves every rock and blade in the world.

// Multiplied by scale.
const SCALED = [
  "world.lengthX", "world.widthZ", "world.size", "world.chartCell",

  "player.spawn.x", "player.spawn.z",

  // the six findings — positions only. Their radii are how close you must stand,
  // which is a property of the surveyor, not of the map.
  "sites.soil.x", "sites.soil.z", "sites.water.x", "sites.water.z",
  "sites.rad.x", "sites.rad.z", "sites.bio.x", "sites.bio.z",
  "sites.site.x", "sites.site.z", "sites.season.x", "sites.season.z",

  // only what is actually in this world. Camps one to four and graves one and two
  // are elsewhere on the planet and exist only in story.json's record.
  "camps.c5.x", "camps.c5.z",

  "graves.g3.x", "graves.g3.z", "graves.g4.x", "graves.g4.z", "graves.g5.x", "graves.g5.z",

  "shelter.x", "shelter.z",

  // THE PATH. Every horizontal dimension of the journey, so scale 1 is the nominal
  // 2560 m chain and any other scale is the same journey at a different size.
  //
  // The path scales as a unit — HEIGHT INCLUDED for the walls, which is the one
  // deliberate exception to "vertical never scales". A wall's steepest sustained
  // grade is proportional to height/run, so scaling the run without the height
  // flattens it and the room stops being a room.
  //
  // The FLOOR PROFILE — every segment's sill, sillRun, drop and dropRun — scales
  // too, and it has to scale TOGETHER or the one-way transitions stop being
  // one-way: their whole guarantee is 1.5*drop/dropRun > maxClimbGrade, and that
  // ratio is only preserved if both terms move. The per-segment entries are added
  // by hand below because scale.js walks fixed paths, not arrays; pathScaledKeys()
  // is what keeps them in step with however many segments config actually has.
  "terrain.path.startX", "terrain.path.step", "terrain.path.blend",
  "terrain.path.openNearEnd",
  "terrain.path.ridgeRun", "terrain.path.ridgeLip",
  "terrain.path.outerHalfWidth", "terrain.path.outerRun", "terrain.path.outerCrestY",
  "terrain.path.farEnd.run", "terrain.path.farEnd.crestY",
  "terrain.path.scree.reach",

  // backdrop hills sit outside the strip and must stay outside it
  "terrain.farHills.minDistance", "terrain.farHills.distanceRange",
  "terrain.farHills.minRadius", "terrain.farHills.radiusRange",

  "ashwaiters.denSpreadX.min", "ashwaiters.denSpreadX.range",
  "ashwaiters.denSpreadZ.min", "ashwaiters.denSpreadZ.range",

  "striders.bandOffset", "striders.herdZ", "striders.spreadX",
  "striders.zStart", "striders.zRange", "striders.audibleRange", "striders.closeRange",

  // see the note above: these four keep refillGrass's draw count invariant
  "grass.bandOffset", "grass.spawnWidth", "grass.falloffSigma", "grass.refillThreshold",

  "chart.revealBaseRadius", "chart.gridSpacing",

  "climate.dawn0", "climate.dawnVelocity"
];

// The path's segments are an ordered array of any length, so their metre-valued
// keys cannot be listed statically. Every one of these is horizontal or is half of
// a grade ratio that must not change.
const SEGMENT_SCALED = ["length", "halfWidth", "centre", "ridgeTop",
                        "sill", "sillRun", "drop", "dropRun", "dropTail"];

// Divided by scale (these are per-metre quantities).
const INVERSE = [
  "terrain.baseFrequency", "terrain.detailFrequency",
  "terrain.palette.dustFrequency", "terrain.palette.fineFrequency", "terrain.palette.broadFrequency",
  "terrain.path.outerCrestFrequency", "terrain.path.floorFrequency",
  // k is the day-side gradient in degrees per metre. nightSlope is exactly the
  // same quantity on the cold side, so it has to steepen with it — otherwise a
  // shrunk world reads the same temperature in the light and 1/scale times colder
  // in the dark, which quietly changes when the suit starts taking cold damage.
  "climate.k", "climate.nightSlope",
  "render.fogDensity"
];

function get(o, path) { return path.split(".").reduce((v, k) => (v == null ? v : v[k]), o); }
function set(o, path, val) {
  const keys = path.split("."), last = keys.pop();
  const parent = keys.reduce((v, k) => (v == null ? v : v[k]), o);
  if (parent && typeof parent === "object") parent[last] = val;
}

// Mutates and returns the config. Call once, after loading it and before anything
// reads it. A missing or non-positive scale, or exactly 1, leaves it untouched.
export function applyWorldScale(config) {
  const s = config && config.world ? config.world.scale : undefined;
  if (typeof s !== "number" || !isFinite(s) || s <= 0 || s === 1) return config;
  for (const p of SCALED) { const v = get(config, p); if (typeof v === "number") set(config, p, v * s); }
  for (const p of INVERSE) { const v = get(config, p); if (typeof v === "number") set(config, p, v / s); }
  const segs = config.terrain && config.terrain.path && config.terrain.path.segments;
  if (Array.isArray(segs)) for (const seg of segs)
    for (const k of SEGMENT_SCALED) if (typeof seg[k] === "number") seg[k] *= s;
  return config;
}

// Every path key the table above touches, expanded over however many segments the
// config actually has — so scale.test.js can assert coverage without hard-coding
// the chain's length.
export function pathScaledKeys(config) {
  const segs = (config.terrain && config.terrain.path && config.terrain.path.segments) || [];
  const out = [];
  segs.forEach((_, i) => SEGMENT_SCALED.forEach(k => out.push(`terrain.path.segments.${i}.${k}`)));
  return out;
}

export const SCALED_PATHS = SCALED;
export const INVERSE_PATHS = INVERSE;
