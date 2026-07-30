# The Anchorage — project context

A browser game. Third-person and first-person, on foot, on an alien planet.
Built as a gift for one specific player, not a commercial product. Optimise for
that player's experience, not for genre convention or feature count.

## What the game is

You are a surveyor. A colony fleet of nine ships and forty thousand sleepers is
already in flight with no confirmed destination — it launched early, deliberately,
so no committee could cancel it. Your job is to answer six questions about a
planet and transmit a recommendation.

The planet rotates once every 88 days. The only survivable ground is a band of
twilight moving continuously west. **Ground behind the dawn line cooks, and sites
you have not reached become permanently unreachable.** You cannot answer all six
questions. Choosing which to abandon is the game.

Two hundred years ago the survey ship *Meridian* did this same job here. Their
camps run west along the trail, ahead of you, and following them is how you
recover findings the clock took from you. Their story is the spine: five graves for six crew, logs that show a
decline nobody in them noticed, and a reveal that recontextualises the ending.

## Design invariants — do not change these without being asked

1. **The clock takes things away permanently.** No grace periods, no second
   chances, no way to re-reach a lost site. The loss must be visible in advance
   (countdown on the manifest) and irreversible after.
2. **The player is told where the six sites are. The player is not told where the
   graves or the sixth camp are.** Orbital survey gave them the manifest; it did
   not give them the story. Never add markers for story content.
3. **Prose lives in `content/story.json`, never in code.** The person building
   this is the writer. She must be able to edit every word without touching a
   `.js` file.
4. **The fleet transmission from home is a placeholder** and is marked as such.
   It will be replaced with real personal writing. Do not polish it, do not
   expand it, do not remove the marker.
5. **Naming is the emotional engine.** The player names the planet and every site
   they survey, and those names persist into the logbook, the chart, and the
   ending text. Never replace a player-given name with a generated one.
6. **Knowledge gates, not gear gates.** The player never finds a better suit.
   Progress comes from learning how the world works.

## Code constraints

- Three.js r128 from CDN. `CapsuleGeometry`, `OrbitControls`, and
  `BufferGeometryUtils` are **not** available in this build — do not use them.
- No build step, no bundler, no transpiler. The project is a folder of static
  files that ship exactly as written. ES modules via `<script type="module">`
  are the module system.
- It will NOT run from `file://` — ES module imports and `fetch()` of the
  content JSON both require an http origin. It runs by being served. GitHub
  Pages serves `main` at root, so the live build is always
  https://wtlangdon-design.github.io/anchorage/ and every push redeploys it.
- No framework. No bundler. The person deploying this is non-technical and works
  from a Chromebook.
- Every tunable number lives in `content/config.json`. If you find yourself typing
  a magic number into a `.js` file, it belongs in config instead.
- Target 60 fps on integrated graphics. Keep the automatic quality-downgrade path
  (drop shadows, halve grass, drop pixel ratio) working.

## Tone

Restrained. Nothing in this game explains its own emotional content. When a
strider falls behind the herd and dies, no text comments on it. When the player
finds the fifth grave, the contradiction is stated once, flatly, and never
underlined. Trust the player.

Reference: *Outer Wilds* for knowledge-gated progression, *Return of the Obra
Dinn* for assembling a crew's fate from fragments. Not *No Man's Sky* — procedural
breadth is explicitly not the goal.

## Working agreement

- Change one module at a time. Run the tests before and after.
- If a change would alter the pacing (any number in `config.json` affecting
  distance, speed, or the dawn line), run `npm run balance` and paste the output
  in your summary.
- Do not refactor a module you were not asked to touch.
- When you finish a task, state plainly what you did not do.

## Structure and running

The game is a folder of static ES modules — no build step. `index.html` at the
repo root is the entry point; it loads Three.js r128 from the CDN and then
`src/main.js` as a module, which `fetch()`es the two content files. Because of
those imports and fetches it must be **served over http**, never opened from
`file://`. GitHub Pages serves `main` from root, so the live build is
https://wtlangdon-design.github.io/anchorage/ and every push redeploys it. To
run it locally, serve the folder with any static server and open `index.html`.

The single-file reference build is kept as `anchorage-reference.html` — it is the
canonical behaviour. The modules were ported from it with zero behaviour change.

```
src/
  main.js            bootstrap + game loop + wiring; owns the PRNG consumption order
  world/  noise climate terrain grass fauna props sky
  player/ rig gait controller suit
  game/   manifest story endings
  ui/     hud compass chart panels
content/  config.json (all numbers)   story.json (all prose)
test/     climate.test.js gait.test.js manifest.test.js balance.js
```

The whole world is generated from one seeded PRNG (`content/config.json` →
`terrain.noiseSeed`). It is consumed in a fixed order at load time, orchestrated
entirely by `main.js`; see the header comment there. Do not give a module its own
generator — that silently changes the world.

## Tests

- `npm test` — runs `climate`, `gait`, and `manifest` (pure logic, no browser).
- `npm run balance` — the solvability check; run it after any change to a number
  in `config.json` that affects distance, speed, or the dawn line, and paste the
  output in your summary.
