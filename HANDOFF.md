# Handoff to Claude Code

**Input:** `anchorage-v6.html` — a single 1,600-line file that runs and is playable
end to end. It is the reference implementation. Everything in it works; nothing in
it is organised.

**Goal of the first phase:** move it into modules with *zero behaviour change*, then
build on it. Do not improve anything during the port. A port and a feature at the
same time is how you lose the ability to tell which one broke.

---

## Target structure

```
anchorage/
  CLAUDE.md
  index.html
  src/
    main.js               bootstrap + game loop + wiring ONLY
    world/
      noise.js            seeded PRNG, fbm            [pure]
      climate.js          dawnX, tempAt, lostAtT      [pure]
      terrain.js          heightAt, terrain mesh, slope colouring
      grass.js            wickgrass band, wind shader, refill on band move
      fauna.js            striders, ashwaiter dens
      props.js            rocks, camps, graves, shelter
      sky.js              sky shader, sun, glare, dust
    player/
      rig.js              suit model, two-segment limbs
      gait.js             walk cycle                  [pure]
      controller.js       input, movement, 1st/3rd person camera
      suit.js             water / oxygen / integrity / damage
    game/
      manifest.js         six criteria, survey progress, lost-detection
      story.js            camps, graves, crew roster, reveal logic
      endings.js          the three endings
    ui/
      hud.js              gauges, manifest panel, prompt
      compass.js          compass strip + soundfield
      chart.js            the chart canvas
      panels.js           briefing, naming, logbook, records
  content/
    story.json            ALL prose
    config.json           ALL tunable numbers
  test/
    climate.test.js
    gait.test.js
    manifest.test.js
    balance.js            solvability check
```

### The interfaces, fixed before anyone writes code

These are the only ways modules talk to each other. Agree them first; they are what
make parallel work possible.

```js
// world/climate.js — pure, no three.js import
dawnX(t) -> number                  // metres
tempAt(x, t) -> number              // celsius
lostAtT(x) -> number                // seconds at which x becomes lethal
LETHAL, K, DAWN_V, DAWN0            // from config

// world/terrain.js
heightAt(x, z) -> number            // metres. called thousands of times/frame — keep it cheap
build(scene) -> void

// player/gait.js — pure, no three.js import
poseFor(phase, speed, running) -> {
  thighL, thighR, kneeL, kneeR,
  shoulderL, shoulderR, elbowL, elbowR,
  torsoYaw, torsoPitch, torsoLift
}

// game/manifest.js
state() -> [{ id, name, done, by, lost, x, z, timeLeft }]
survey(id) / complete(id, playerName)
onLost(cb) / onComplete(cb)

// game/story.js
read(id) -> { title, body, gift }   // camp | grave | shelter
crew() -> [{ id, name, role, known, note }]
knowsTruth() -> bool
```

Everything else is private to its module.

---

## Subagent assignment

Four agents, one per directory, no overlap. `main.js`, `CLAUDE.md`, and the two
JSON files are owned by the lead and must not be edited by a subagent.

| Agent | Owns | Must not touch |
|---|---|---|
| A | `src/world/` | player, game, ui |
| B | `src/player/` | world, game, ui |
| C | `src/game/` | world, player, ui |
| D | `src/ui/` | world, player, game |

Each agent gets the same brief: *port the corresponding code out of
`anchorage-v6.html` into your directory, behind the interface above, changing no
behaviour.* Then the lead wires `main.js` and confirms the game plays identically.

This is the only phase where fanning out helps. After the port, changes are small
and sequential and a single agent is faster.

---

## Tests to write during the port

Not aspirational — these catch the two bugs that actually happened during
development.

- **`climate.test.js`** — `lostAtT` agrees with `tempAt`; the lethal edge moves at
  exactly `DAWN_V`; nothing becomes lethal before t=0.
- **`gait.test.js`** — knees never hyperextend (flexion >= 0 always); elbows always
  hold at least 0.3 rad of bend; all angles stay bounded at every speed. *A rigid
  limb reads as a robot and this is the test that prevents regressing to it.*
- **`manifest.test.js`** — a site cannot be surveyed after it is lost; a Meridian
  gift never overwrites a player's own finding; player-given names survive into the
  ending payload.
- **`balance.js`** — for each site and camp, print distance from spawn, sprint time,
  and time-until-lost. Assert every objective is individually reachable and that at
  least two conflict. Run this after any config change.

---

## Known issues, roughly in order of payoff

1. **No audio at all.** The soundfield is drawn but silent. Wind, footfalls,
   the herd as a low continuous rumble, and *actual silence* near ashwaiters.
   This is the largest single improvement available and it is not a graphics problem.
2. **Ashwaiters are a damage radius, not a creature.** They should emerge, be
   visible, be escapable.
3. **The vista is a line of text.** Cresting the ridge and seeing the migration
   should be a real moment — camera, timing, silence.
4. **Graphics headroom:** bloom, depth of field, animation blending between
   idle/walk/run, denser ground scatter.
5. **No save system.** Fine in an artifact, wrong in a real build.
6. **One planet.** The design calls for four. Do not start planet two until
   planet one is finished — the whole project fails by going wide early.

## Not to be built by an agent

The fleet transmissions from home. Those are written by hand, by the person this
is for. Leave the placeholder and its marker exactly where they are.

---

## First prompt to paste into Claude Code

> Read CLAUDE.md and HANDOFF.md. The file `anchorage-v6.html` is a working
> single-file version of this game. Port it into the module structure described in
> HANDOFF.md with zero behaviour change — do not improve, fix, or refactor anything
> beyond moving it. Start by writing `content/config.json` and `content/story.json`
> and extracting every magic number and every string of prose into them. Then fan
> out one subagent per `src/` subdirectory using the fixed interfaces, and wire
> `main.js` yourself. When the port is done, tell me what plays differently, if
> anything.
