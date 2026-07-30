# Strings the jungle broke

Nothing in `content/story.json` has been edited. This is the list, with the exact
path to each string and the exact text as it stands, so you can work straight down
it. Paths are the nesting in `story.json`: `sites.soil.place` is the `"place"` key
inside `"soil"` inside `"sites"`. `[0]` means the first item of a list.

Three groups, and the difference matters:

* **A — the jungle broke these.** They describe ash, rock, a crevice, or a view,
  and the world no longer has any of those.
* **B — the one-way trail broke these**, in the pass before this one. Still wrong,
  and worth knowing they are a different problem than the jungle.
* **C — weakened rather than broken.** They still parse. They used to land harder.

Then **D**, strings the new work wants that do not exist yet, and **E**, the ones
I read carefully and believe are still exactly right, so you do not have to.

---

## A — the jungle broke these

### A1. `briefing.beats[3].body[0]` — the descent
This is the worst one. Every physical noun in it is now wrong, and one of the
numbers is wrong too.

> You come in low over the ash. For two hundred kilometres it is flat and pale and
> the same, and then the ground splits — a crevice, six hundred metres end to end,
> walls steep enough to hold shadow on the floor while the sun crosses. It is the
> only shade on this hemisphere. It is why you are landing here and not anywhere
> else.

What is true now, if it helps: the route is **2,510 m** end to end, not 600. There
is no crevice and there are no walls — containment is a 2.2 m bank with impassable
undergrowth standing on it. The shade is the **canopy**, and it is not rare: 51% of
the trail floor is shaded, and where the roof breaks is where the ground cooks. So
"the only shade on this hemisphere" is no longer the reason to land here. Whatever
the new reason is, it is a story decision, not a terrain one.

The second paragraph of the same beat is fine and needs nothing:
> There is a light in it. Small, steady, and two hundred years old. Nothing in the
> *Meridian*'s filed record accounts for a light.

### A2. `sites.soil.place`
> Ash field

### A3. `sites.soil.finding`
> Ash-derived, mineral-rich, poor in fixed nitrogen. Crops would need help for a
> generation and then they would not.

Soil under a jungle that grows and burns every ninety days is not ash-derived. The
shape of the finding — good minerals, no fixed nitrogen, one generation of help —
can survive if you want it to; the derivation cannot.

### A4. `sites.soil.suggestions[0]` and `[1]`
> "The Grey", "Long Ash"

These are the names the player is offered for the soil site. `[2]` is "Tillage",
which still works.

### A5. `camps.c1.body` — the same ash claim, in Ruiz's hand
Third paragraph from the end:
> Soil series complete and filed. Ash-derived, mineral-rich, poor in fixed
> nitrogen. A generation of work and then none.

Whatever A3 becomes, this has to say the same thing in Ruiz's voice, because the
camp record is what hands you the finding if the clock took it.

### A6. `toasts.ashwaiterStrike`
> `<span style='color:var(--bad)'>Something came out of the ash.</span>`

### A7. `camps.c5.body` — the species name, and the reason it is good
> Something I never put in a report: the ashwaiters do not migrate. They burrow in
> behind the herd and wait out the whole ninety days in the dark, and when the grass
> comes round again they are exactly where they were.

**The creature is called an ashwaiter and there is no ash.** This is the one entry
on the list that is not only prose, and you should know what it costs before you
pick a new name:

* The word **inside this paragraph** is prose. Change it freely.
* The **key** `toasts.ashwaiterStrike` is read by code (`src/player/suit.js`), and
  `config.ashwaiters` is read by `src/world/fauna.js`, `src/ui/compass.js`,
  `src/player/suit.js`, `src/world/scale.js` and two tests. Renaming those is a
  code change, not a `story.json` change. Pick the name and I will do that side.

"when the grass comes round again" is also now "when the growth comes round again"
— that is C-grade on its own, but it is in the same paragraph, so it may as well be
one edit.

### A8. `sites.rad.place` and `sites.rad.suggestions`
> place: "Vantage" — suggestions: "The Spine", "First Sight", "Long Look"

All three suggested names, and the place label, promise a **view**. The sightline on
the trail is 20–40 m and there is no sky except where the canopy breaks. There is
nowhere on this route you can see anything from. The finding itself is fine:
> Magnetosphere weak but sufficient. Surface dose survivable unshielded; a roof
> solves the rest.

"a roof solves the rest" reads differently now that there is literally a roof, which
you may want to lean into or may want to avoid.

### A9. `sites.site.place` and `sites.site.suggestions[0]`
> place: "Basin" — suggestions[0]: "The Bowl"

Left over from the bowl world. The settlement site now sits in the `meadow`
clearing: low growth, standing water, the herd feeds through it, and the sky is
half open. `suggestions[1]` and `[2]` — "Harbour", "Anchorage" — are untouched and
still the best two names in the file.

The finding needs nothing; it already describes the new world better than the old
one:
> A basin, sheltered, with a floor that holds water eleven days after each dawn. If
> it is anywhere, it is here.

(Only the word "basin" in it, if you retire that word entirely.)

### A10. `shelter.body`
> One shelter, out past the last of the grass, on ground that has not been warm in a
> hundred and eighty years.

"grass" is the only wrong word, and it is nearly right — the shelter stands in the
`end` clearing, where the growth has not come up yet, so "out past the last of the
growth" is true to the metre. Listing it because "grass" is the old world's word.

---

## B — the one-way trail broke these, one pass earlier

These were already wrong before the jungle. They are here because you asked for
every string that is wrong, and because they are the deepest ones in the file.

### B1. `briefing.beats[2].body[1]` — the direction the Meridian went
> Their camps run north. So does everything else they left.

**They do not run north any more.** The route is a single line along +x, which is
west, following the band. Every Meridian thing on the ground — camp five, the three
graves, the unlogged shelter — is strung out along that line, ahead of you. Their
chain runs *the way you are walking*, which is arguably a better story than north
(you are following them, and following the herd, and following the dawn, all at
once) — but the sentence as written contradicts the map.

`CLAUDE.md` says "Their camps run north" too. I have not touched it. When you
decide, that line should change with this one.

### B2. `camps.c4.body` — and the reason they went north
> Ruiz worked out that at fifty-five degrees the line moves slower than a person
> walks, and once you know a thing like that you cannot un-know it. We came north.
> Then further north. The grass is thin and the light never really changes and
> nobody has proposed going back.

This is the best piece of worldbuilding in the file and the route now contradicts
it. Going poleward to slow the line down is a real, beautiful, *knowledge-gated*
idea; the trail runs along the band instead, at a constant latitude. Two ways out
and they are both yours: rewrite the reason they moved, or move the route. If the
answer is "move the route", say so and I will do it — but it changes the balance
result, and I would want you to know that before rather than after.

Also in this entry: "The grass is thin" (see A10), and "the valley below the camp"
in the Raman paragraph — there is no valley on the route now.

### B3. `graves.g3.body`
> She drew everything. At the end she drew the same valley eleven times.

Same valley as B2. The line is doing real work — eleven near-identical drawings is
the decline, stated once and never explained — so it wants a landform that exists.
"the same clearing eleven times" would carry it, if a clearing is what she drew.

---

## C — weakened, not broken

### C1. `camps.c2.body`
> strike at hour six, walk until the grass thins, make camp in the green again

"the green" is better in a jungle than it was on ash. "the grass" is the weak word.

### C2. `sites.water.place` / `suggestions[2]`
> place: "Hydrology" — suggestions[2]: "Kettle"

"Kettle" is a glacial landform. The finding ("Meltwater… It runs for a day in
ninety and then it is ice again") is exactly right for the new fiction and needs
nothing.

### C3. `sites.season.place`
> Frost margin

The frost margin is three hundred kilometres away; this label is on a spot in a
jungle tunnel at x=858. It was no more accurate before, so it is C and not A.

### C4. `endings.caveat.body[2]`
> They name the basin after you, and the settlement after her.

Two problems in one sentence. "the basin" is the old terrain (A9). And this is the
one place in the endings where **the player's own name for the settlement site is
not used** — the sentence hardcodes a landform where naming is supposed to be the
engine. Making it use her name needs a template placeholder, which is a code
change; tell me the wording and I will add it.

### C5. `ui.readoutElevation`
> Elevation

A readout that meant something in a 40 m crevice. The trail's banks are 2.2 m and
its ridges 6–10 m, so this number now barely moves. Not wrong — just no longer
worth the space it takes on the HUD.

### C6. `ui.dawnBehindTemplate` / `ui.dawnAheadTemplate`
> "{km} km behind" / "{km} km ahead"

The code prints game metres over 1000, so in play this always reads "0.38 km
ahead", "0.96 km ahead" — two decimal places of a number that never reaches 1,
about a band the briefing calls three hundred kilometres wide. The game's metres
are deliberately not the planet's metres (a 2,510 m route stands in for a 300 km
band), so nothing here is a bug; it just reads small. If you would rather it said
"380 m ahead", that is a one-line code change.

### C7. `soundfield.herd`
> HERD — HEAVY, CONTINUOUS

Still true, and it now fires about a herd that is **ahead** of you rather than
somewhere unspecified. If you want the strip to say which way, the text is yours;
the direction is already computed and the mix already uses it.

---

## D — strings the new work wants and does not have

Not wrong. Missing. Add them or don't; nothing breaks either way.

1. **The insects going out.** The insect bed is the loudest thing in the game and
   it dies as the growth browns. There is no line anywhere that marks it. The
   soundfield strip has room for one, next to `soundfield.null` and
   `soundfield.herd`.
2. **Walking into the burn.** The growth behind you goes black and there is no
   text on it. (Restraint may well be the right answer here — nothing in this game
   explains its own emotional content. Flagging the gap, not asking for it filled.)
3. **Outrunning the growth.** Sprint continuously and you pass the growth front
   into bare ground ahead of it. That is a real, reachable, unnarrated state.
4. **Chamber character strings.** The seven clearings have one-line characters —
   "close and dark; the undergrowth meets over the trail and you walk in green
   light" — and they live in `content/config.json` under
   `terrain.path.segments[].character`, not in `story.json`. They are prose in the
   wrong file. Say the word and I will move them across; they are read by the test
   harness, not by the game, so it is a small change.

---

## E — I read these and they are still right

Listed so you can skip them.

* `briefing.beats[0]` (the commission), `[1]` (the fleet), `[4]` (the naming) —
  the naming beat's "three hundred kilometres wide, moving west at fifteen and a
  half kilometres an hour, forever" is fiction-scale and does not need to match
  `dawnVelocity`; the game's metres are not the planet's metres.
* `fleetTransmission.*` — untouched, marker intact, and I did not read past the
  marker.
* `sites.bio.*` — "Six tonnes each, walking" is more true than it was; the herd is
  now genuinely on the trail ahead of you.
* `sites.water.finding`, `sites.rad.finding`, `sites.site.finding`,
  `sites.season.finding` — all four survive the reskin.
* `camps.c3.body` — no terrain in it at all. It is about a message from Earth.
* `graves.g1`, `g2`, `g4`, `g5` — "a cairn with a plate cut from hull stock" is
  still literally what is built (five cairn rocks and a plate per grave), and g5's
  reveal is untouched.
* `shelter.confession.*` — the whole Lindqvist record. No terrain in it.
* `endings.prompt`, `endings.clean`, `endings.withdraw`, `endings.summary` — clean.
* `failure.*` — "The band moved on without you, the way it moves on without
  everything" is still exactly the right sentence.
* `soundfield.null` — "SOUNDFIELD NULL — SOMETHING IS NOT MOVING". This one got
  **better**. Silence in a jungle this loud is a different kind of frightening than
  silence on an ash flat, and the line does not need to change to collect that.
* `ui.crewFooter` — "Manifest lists six. Three are buried here." Three graves are
  on this ground. The count is correct.
* `ui.chartHint` — "Everything left of the red edge is already too hot to reach"
  is still the right direction on the chart.
* All of `toasts.*` except `ashwaiterStrike`, and the rest of `ui.*`.
