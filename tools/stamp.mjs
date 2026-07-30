// stamp.mjs — append ?v=<version> to every module URL so a new push can never be
// served from a stale browser cache.
//
// GitHub Pages sends Cache-Control: max-age=600. Within that window Chrome reuses
// cached module scripts WITHOUT revalidating, and on Android there is no hard
// refresh. So a push could be live on the server and invisible on the phone for ten
// minutes — which happened three times, and cost more time than every real bug here.
//
// This is not a build step for the person deploying: the repo always contains
// ready-to-serve files. Whoever pushes runs this first.
//
//   node tools/stamp.mjs <version>
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const v = process.argv[2] || String(Date.now());

const walk = d => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

let n = 0;
// every relative module import inside src/
for (const f of walk(join(root, "src")).filter(f => f.endsWith(".js"))) {
  const before = readFileSync(f, "utf8");
  const after = before.replace(
    /(from\s*["'])(\.[^"'?]+\.js)(\?v=[^"']*)?(["'])/g,
    (_, a, path, __, d) => `${a}${path}?v=${v}${d}`);
  if (after !== before) { writeFileSync(f, after); n++; }
}
// and the entry point in index.html
{
  const p = join(root, "index.html");
  const before = readFileSync(p, "utf8");
  const after = before.replace(
    /(<script[^>]*type="module"[^>]*src=")([^"?]+)(\?v=[^"]*)?(")/g,
    (_, a, path, __, d) => `${a}${path}?v=${v}${d}`);
  if (after !== before) { writeFileSync(p, after); n++; }
}
console.log(`stamped ${n} file(s) with ?v=${v}`);
