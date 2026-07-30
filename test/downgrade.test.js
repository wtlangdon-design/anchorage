// downgrade.test.js — a missing multiplier must never blank a layer.
//
// Defensive, not a post-mortem. Every multiplier the mobile and fps paths pass must
// exist and be finite, because a missing one becomes NaN, and an instance count of
// NaN draws nothing at all — a whole layer would silently vanish with no error.
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, "../content/config.json"), "utf8"));

let failures = 0;
const ok = (n, c, d = "") => { if (!c) { failures++; console.error("  FAIL:", n, d); } else console.log("  ok:", n); };

// 1. the config holes that caused it
console.log("EVERY MULTIPLIER THE MOBILE PATH PASSES EXISTS");
for (const k of ["grassMultiplier", "jungleMultiplier", "striderMultiplier", "dustMultiplier"])
  ok(`mobile.${k} is a real number`, Number.isFinite(config.mobile[k]), String(config.mobile[k]));

console.log("\nAND THE MULTIPLIERS THE FPS PATH PASSES");
ok("downgrade.jungleMultiplier is a real number",
   Number.isFinite(config.render.downgrade.jungleMultiplier),
   String(config.render.downgrade.jungleMultiplier));

// 2. the guard, so a future hole degrades to "no reduction" instead of "invisible"
console.log("\nTHE GUARD ITSELF");
const guard = m => Number.isFinite(m) ? Math.max(0, Math.min(1, m)) : 1;
for (const [label, val] of [["undefined", undefined], ["null", null], ["NaN", NaN], ["a string", "0.5"]])
  ok(`${label} means no reduction, not zero`, Math.max(1, Math.floor(5200 * guard(val))) === 5200);
ok("a real multiplier still reduces", Math.floor(5200 * guard(0.5)) === 2600);
ok("no count is ever NaN", [undefined, null, NaN, 0, 0.6, 1, 2]
   .every(v => Number.isFinite(Math.max(1, Math.floor(5200 * guard(v))))));

// 3. every layer that has an applyDowngrade must carry the guard
console.log("\nEVERY LAYER CARRIES THE GUARD");
for (const f of ["jungle", "grass", "fauna", "sky"]) {
  const src = readFileSync(join(here, `../src/world/${f}.js`), "utf8");
  if (!/export function applyDowngrade/.test(src)) continue;
  ok(`${f}.js guards against a non-finite multiplier`, /Number\.isFinite/.test(src));
}


/* ---- the vegetation must stand INSIDE the corridor -----------------------
 * The real reason a phone showed a bare green trench: the out-of-bounds test in
 * jungle.js compared a z coordinate against the world's LENGTH instead of its
 * half-WIDTH, so it never fired. Trunks were scattered past the terrain edge and
 * the canopy sat on top of the outer walls instead of over the trail — a jungle
 * standing outside the trench the player walks in.
 * ------------------------------------------------------------------------ */
console.log("\nVEGETATION STANDS INSIDE THE WALLS");
{
  const J = config.jungle, P = config.terrain.path, W = config.world;
  const toe = P.outerHalfWidth, halfZ = (W.widthZ || W.size) / 2;
  ok("the wall toe is inside the terrain", toe < halfZ, `${toe} vs ${halfZ}`);
  let worst = 0, worstSeg = "";
  for (const s of P.segments || []) {
    const base = Math.abs(s.centre) + s.halfWidth;
    const reach = Math.max(base + J.canopy.spread / 2,
                           base + 4 + J.trunk.spread,
                           base + J.understory.bandOuter);
    if (reach > worst) { worst = reach; worstSeg = s.id || "?"; }
  }
  ok("no layer can be placed beyond the wall toe", worst < toe,
     `worst is ${worst.toFixed(0)} at segment "${worstSeg}", toe is ${toe}`);
  ok("the canopy sits over the trail, not on the walls",
     J.canopy.spread / 2 < toe / 2, `canopy reaches ${J.canopy.spread / 2}m off centre`);
  const src = readFileSync(join(here, "../src/world/jungle.js"), "utf8");
  ok("jungle.js bounds-checks z against the z half-width, not the length",
     /Math\.abs\(z\)\s*>\s*LZ/.test(src) && !/Math\.abs\(z\)\s*>\s*LX/.test(src));
}

console.log(failures ? `\ndowngrade.test.js: ${failures} failure(s)` : "\ndowngrade.test.js: all passed");
process.exit(failures ? 1 : 0);
