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
  "world.size", "world.chartCell",

  "player.spawn.x", "player.spawn.z",

  // the six findings — positions only. Their radii are how close you must stand,
  // which is a property of the surveyor, not of the map.
  "sites.soil.x", "sites.soil.z", "sites.water.x", "sites.water.z",
  "sites.rad.x", "sites.rad.z", "sites.bio.x", "sites.bio.z",
  "sites.site.x", "sites.site.z", "sites.season.x", "sites.season.z",

  "camps.c1.x", "camps.c1.z", "camps.c2.x", "camps.c2.z", "camps.c3.x", "camps.c3.z",
  "camps.c4.x", "camps.c4.z", "camps.c5.x", "camps.c5.z",

  "graves.g1.x", "graves.g1.z", "graves.g2.x", "graves.g2.z", "graves.g3.x", "graves.g3.z",
  "graves.g4.x", "graves.g4.z", "graves.g5.x", "graves.g5.z",

  "shelter.x", "shelter.z",

  // The canyon: every horizontal dimension of it, so scale 1 is the nominal
  // 600 x 250 and any other scale is the same room at a different size. Wall and
  // end HEIGHT are vertical and stay put, so a smaller canyon is a deeper one.
  // The canyon scales as a unit — HEIGHT INCLUDED, which is the one deliberate
  // exception to "vertical never scales". The wall's steepest grade is
  // 1.5*crest/wallRun, so scaling the run without the height flattens it: at
  // scale 2 the walls fell to grade 0.52 against a 0.8 climb limit and the room
  // stopped being a room. Scaling both keeps that ratio, and therefore the
  // containment, identical at every scale.
  "terrain.canyon.length", "terrain.canyon.width",
  "terrain.canyon.wallRun", "terrain.canyon.wallHeight",
  "terrain.canyon.endRun", "terrain.canyon.endHeight",
  "terrain.canyon.meanderAmp",

  // backdrop hills sit outside the map and must stay outside it
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

// Divided by scale (these are per-metre quantities).
const INVERSE = [
  "terrain.baseFrequency", "terrain.detailFrequency",
  "terrain.palette.dustFrequency", "terrain.palette.fineFrequency", "terrain.palette.broadFrequency",
  "terrain.canyon.meanderFrequency", "terrain.canyon.crestFrequency", "terrain.canyon.floorFrequency",
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
  return config;
}

export const SCALED_PATHS = SCALED;
export const INVERSE_PATHS = INVERSE;
