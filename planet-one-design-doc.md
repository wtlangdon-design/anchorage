# Design Document — v2

**Working title:** *The Anchorage*
**Platform:** browser, self-contained
**Structure:** 4 authored planets, procedural space between them. This document covers the mission frame and Planet One in full.

---

## PART ONE — THE MISSION

### Why he's out there

Two hundred years ago the survey ship *Meridian* found a habitable world, transmitted its recommendation to Earth, and waited for the colony fleet.

The recommendation was received, filed, and deferred. No one came.

A later generation learned the wrong lesson from that — or the right one, depending on who you ask. They understood that a colony program which waits for a destination will be cancelled by some committee before it ever launches. So they inverted it.

**They launched first.**

The colony fleet **Anchorage** — nine ships, roughly forty thousand sleepers — is in flight *right now*, on a provisional heading, with no confirmed destination. It left before the destination existed, specifically so that no one could call it off. It was a gamble made by people who are now dead, and the bill has come to him.

His job is to find them somewhere to go.

### The clock

The *Anchorage* is under continuous acceleration. There is a point past which its fuel geometry no longer permits a course change of any meaningful magnitude — **the lock**. After the lock, the fleet goes where it is already pointed, which is nowhere in particular.

Two squeezes make this bite:

1. **The lock is fixed.** He has fuel and life support for a limited number of systems before it. Every day spent on a planet is a day not spent finding a better one.
2. **Signal lag.** His transmission takes years to cross the distance. He cannot decide at the deadline — he must decide *early enough that the message arrives* before it. The real deadline is well ahead of the visible one, and the game should let him work that out himself rather than telling him.

If he sends nothing, forty thousand people arrive at empty space with no fuel to go elsewhere.

### Why send a human

Probes have catalogued thousands of worlds. Instruments return data — pressure, spectra, gravity, biosignatures — and data cannot answer the only question that matters, which is *whether people could be alright here.*

That judgment is the entire job. He is not out there to gather numbers. He is out there to decide something no sensor can, and to put his name on it.

There's a second reason, unstated in the briefing and discoverable later: a probe's recommendation is easy to defer. A human's is harder to ignore. They sent a person partly so that the thing that happened to Vantaa could not happen again.

### The personal stake

**Someone he loves is aboard the *Anchorage*. Asleep.**

This is the heart of the whole design and it is the reason the game is a gift rather than a game. He is not selecting a planet for humanity in the abstract. He is choosing the sky a specific person will open her eyes under.

Every survey quietly reframes. It stops being *is this world habitable* and becomes *would she be alright here.* Gravity stops being a number and becomes what her body will live in for sixty years. The length of the day becomes the rhythm of her life. The question of whether the biosphere is safe becomes a question about someone with a name.

And time dilation stops being a theme and becomes a wound: their clocks are running at different rates. He can do the arithmetic on who will be older when they meet. The game should let him, and should never comment on the result.

> **Note to the author:** the person aboard should be *you*, and the transmissions from the fleet should be written by you. That's the gift inside the gift, and it's the one part of this document that cannot be generated.

---

## PART TWO — PLANET ONE

**Designation:** CS 4-9 b — unnamed until he names it. Naming is the first thing the game asks of him.

### The central idea

The planet rotates once every 88 Earth days.

Everything follows from that. The day side reaches roughly 70°C by late afternoon; the night side falls to -60°C. Life exists only in the twilight band between them — a survivable ring about 300 km wide that sweeps continuously around the world.

The band moves. Nothing alive here can ever stop moving.

The thematic rhyme is exact — he can't go home either — but **the elegy is the last layer, not the first.** This has to work as an adventure before it works as anything else.

### Physics

| Property | Value | Consequence in play |
|---|---|---|
| Rotation period | 88 Earth days | Terminator sweeps continuously |
| Gravity | 1.3 g | Heavy, deliberate movement; falls are serious |
| Atmosphere | ~1.8 bar, high CO₂ | Breathable with filter; **sound carries enormous distances** |
| Surface water | Only within the band | Rivers appear at dawn, boil off by afternoon |

### The latitude mechanic

The best system in the design, and it falls straight out of geometry.

The terminator sweeps at roughly **19 km/h at the equator** — faster than a person can walk, indefinitely. Near the poles, where the circumference is small, it crawls.

- **Equator** — the light outruns you. Requires the rover, requires planning, kills the careless. Richest biology, because it gets the most energy.
- **Mid-latitudes** — manageable on foot with discipline. The main play space.
- **Poles** — the sun barely moves. Safe. Nearly dead.

Latitude is a risk dial he controls. He'll learn it by nearly dying of it.

### Ecology

Placeholder names below — **he renames each species on discovery,** and his name is what appears in the logbook and the final report from then on.

**Wickgrass.** Sprouts in the twenty hours after dawn, photosynthesizes violently, dies in the afternoon heat. From orbit, a green stripe 40 km wide chasing the dawn line around the planet. Behind it, ash.

**Striders.** Large grazing animals following the wickgrass line. They doze while walking; they never truly stop. An injured strider falls behind and dies in the heat, and the herd does not wait. He will watch this happen. It should be quiet and awful and nothing should comment on it.

**Ashwaiters.** Predators that don't migrate. They burrow into the ash and lie in torpor for ninety days until the band comes around again. The only creatures on this planet that experience stillness.

**The soundfield.** In 1.8 bar, sound carries. He can hear a herd from 40 km away — the ecology is audible before it's visible, and audio becomes his primary navigation tool.

Ashwaiters are silent. Silence means something is wrong.

---

## PART THREE — THE EXPLORER'S LAYER

Exploration is *exciting*. This section is what makes the rest worth building.

### The map is the artifact

The planet begins as a blank sphere.

Every kilometre he crosses inks itself in behind him — hand-drawn cartography, his handwriting, his names on every feature. The unexplored regions stay conspicuously, temptingly blank.

The map is not a UI element. It's the thing he is making, it's the score, and it should be **exportable as a printable chart** at the end — a map of a world, drawn by him, with his names on it. A physical object he can frame.

Highest build priority. Cheap to implement, and it's the core pleasure.

### Vantage and the long sightline

Terrain needs high ground, and from it he needs to see 30–40 km. Something unidentified should always be out there, and reaching it should cost fuel or time he'd rather spend elsewhere.

Better, the soundfield gives him things before sight: an unexplained sound, at range, on a bearing. A direction and no explanation.

*What is that. Do I go.* If he's asking that every ten minutes, it's working.

### The first wow, in hour one

He crests a ridge and sees the migration from height — striders to both horizons, a column forty kilometres wide, walking west, as they have without stopping for four billion years.

Spend this early. Awe recruits; it doesn't need to be earned first.

### Specimens and the hold

He collects. The hold has hard limits. A full hold on a world he will never return to means choosing what to abandon forever — an explorer's actual historical agony, and a better inventory system than any encumbrance meter because every choice is a small grief.

### Outrunning the dawn

The terminator is also a chase. Rover at full throttle across the ash, cabin temperature climbing, forty kilometres to the safe band with the sun coming up behind him. A real action setpiece that falls out of physics already in the design.

### Sequencing

**Wonder → jeopardy → elegy.** In that order. Hours 1–2 are discovery and awe. The middle is competence under pressure. The *Meridian* story lands late, once the planet is somewhere he's grown attached to.

### Who he is

Not a fantasy hero. A professional with instruments, procedures, and a checklist, whose excitement comes from competence meeting genuine unknown. That's what the real ones were, and it's more flattering than a power fantasy.

---

## PART FOUR — THE BURIED STORY

The *Meridian* made planetfall here two hundred years ago. Crew of six. Commander Ilse Vantaa. They surveyed the planet, recommended it, and waited for a fleet that was never sent.

Their camps are still here, and **each successive camp is closer to the pole.** Camp One sits nearly on the equator: mobile, ambitious, built to move with the band. Camp Two at 20°. Camp Four at 55°. The last is almost polar, where the sun hangs nearly motionless and nothing grows at all.

They stopped moving. On a world where stopping is death, they chose it anyway, degree by degree, over forty years.

The logs drift with them: mission discipline, then improvisation, then domesticity, then something closer to peace. Vantaa's final entry is the last thing he finds, and it should not be despairing. She writes that she has finally understood the ashwaiters. And she addresses it to whoever comes next — which is him.

### What it means now

In the old draft this was a futility twist. It isn't anymore. It's two things:

**A warning with teeth.** Vantaa is what failure looks like at exactly the job he is doing right now. She found a world and no one came. His fleet is already in flight. He does not get to be wrong.

**A gift.** Forty years of ground truth on this planet — climate records, ecology, failure modes, things no orbital scan could produce. She did the work. He can finish it. Her data measurably improves his recommendation, and the game should make that concrete: her survey is the single most valuable thing on the planet.

She spent her life on a world nobody came to. He can make it the world they come to.

---

## PART FIVE — PROGRESSION AND THE DECISION

### Knowledge gates, not gear

He never finds a better suit. He finds out how the world works.

1. **Terminator speed varies by latitude** → he can plan routes instead of fleeing
2. **Silence means ashwaiter** → the ash flats become crossable
3. **Wickgrass bloom timing** → he can predict the herd and use it
4. **The camps run poleward** → the *Meridian* chain unlocks in order
5. **Vantaa's archive** → forty years of data, and the warning attached to it
6. **The signal-lag arithmetic** → he works out that his real deadline is years earlier than the one on the wall

A player who knew all six could finish in an hour. Correct and intentional.

### The decision

He transmits one set of coordinates. There is no takeback and no confirmation prompt beyond a single plain one.

The epilogue plays fifty years on: arrival, first landing, the settlement under the name he gave it. **Outcomes vary by the quality of his survey, not by luck** — if he under-surveyed, the epilogue reveals the flaw he'd have caught with another week on the ground. Thoroughness pays without there ever being a fail screen.

And there is a shot of her waking up.

---

## PART SIX — FIRST PLAYABLE

Not all of the above. Build this slice and confirm the loop is fun:

- One 50 km × 50 km region at 35° north
- **The inking map** — highest priority
- One ridge with a genuine long sightline, and the migration visible from it
- The moving terminator, temperature model, death by exposure
- One rover chase against the dawn
- Wickgrass bloom cycle, one strider herd, one ashwaiter
- The soundfield and the silence mechanic
- Camp One only, two logs — enough to hint there's a story here
- The mission briefing and one transmission from the fleet
- Naming and logbook fully working

**The test:** twenty minutes in, does he drive toward a blank spot on the map because he wants to know what's there?
