// game/story.js — the Meridian narrative. Owns CREW, CAMPS, GRAVES, LAST, CONFESSION.
//
// Ported verbatim from the reference: CREW (208-217), CAMPS (244-290),
// GRAVES (293-316), LAST/CONFESSION (318-334), target()'s readable branch
// (774-778), and readGrave/readCamp/readLast (819-845). Pure logic/state — no
// THREE. Numbers come from config, prose/UI strings from story. Zero behaviour
// change: the reference's DOM writes (panel(), renderManifest()) become calls to
// the ui functions handed in via deps.

let S, manifest, showPanel, renderManifest, esc, toast, ui, shadeAt, openWorksheet, grantSurvey;
let giftTemplate = "", giftAlreadyTemplate = "";

export let CREW = [], CAMPS = [], GRAVES = [], LAST = null, CONFESSION = null;
let afterReadToast = "";

// What is actually in this world is whatever config places. The Meridian moved
// across the planet for forty years, so most of their camps and two of their
// graves are somewhere else on it — they exist in the record and not underfoot.
const placed = o => Object.keys(o || {}).filter(k => !k.startsWith("_")).sort();

export function initStory(config, story, deps){
  S = deps.S; manifest = deps.manifest;
  showPanel = deps.showPanel; renderManifest = deps.renderManifest; esc = deps.esc;
  // readLast schedules a toast; the reference used the global toast().
  toast = deps.toast;
  shadeAt = deps.shadeAt || (() => 0);
  openWorksheet = deps.openWorksheet || null;
  // Reading the camp that carries Vantaa's final entry is what hands the survey
  // over. main.js wires this to "put the six findings on the manifest and start
  // the clock"; story.js only knows that a record can give you one.
  grantSurvey = deps.grantSurvey || null;
  ui = story.ui;
  giftTemplate = story.toasts.giftTemplate;
  giftAlreadyTemplate = story.toasts.giftAlreadyHaveTemplate;

  // Names and roles come off the orbital manifest, so they were never the mystery.
  // What happened to each of them is: that is the worksheet, and the game never
  // fills it in for the player.
  CREW = story.crew.map(c => ({ id: c.id, n: c.name, r: c.role }));

  CAMPS = placed(config.camps).map(id => {
    const cc = config.camps[id], sc = story.camps[id];
    return {
      id, n: sc.name,
      x: cc.x, z: cc.z, r: cc.radius, gives: cc.gives,
      grants: !!cc.grantsSurvey,
      t: sc.title, b: sc.body, gift: sc.gift,
      rev: sc.reveals.map(rv => [rv.crew, rv.note]),
      shade: shadeAt(cc.x, cc.z),   // how long this ground stays under the lethal line
      read: false
    };
  });

  GRAVES = placed(config.graves).map(id => {
    const cg = config.graves[id], sg = story.graves[id];
    return {
      id, x: cg.x, z: cg.z, r: cg.radius, who: sg.crew,
      t: sg.title, l: sg.label, b: sg.body,
      rev: [sg.crew, sg.reveal],
      read: false
    };
  });

  LAST = {
    id: "last", n: story.shelter.name,
    x: config.shelter.x, z: config.shelter.z, r: config.shelter.radius,
    t: story.shelter.title, b: story.shelter.body,
    read: false
  };

  CONFESSION = {
    t: story.shelter.confession.title,
    b: story.shelter.confession.body,
    // The confession reveals the physician (Lindqvist); story.json has no crew id
    // on the confession block, so the "lind" id stays inline.
    rev: ["lind", story.shelter.confession.reveal]  // TODO(lead): crew id not in story
  };
  afterReadToast = story.shelter.afterReadToast;
  archive = (config.shelter && config.shelter.archive) || [];
  archiveStory = story.camps;
  graveRecords = story.graves || {};
  datesFromRecord = (config.deduction && config.deduction.datesFromRecord) || [];

  // The answer key comes from the RECORD, not from what happens to be buried here.
  // story.json still holds all five grave entries; config only places three of
  // them. So the truth is complete — okonkwo died in year 9 whether or not the
  // player can ever stand at that plate — and the one crew member with no grave
  // record at all is the one who was still walking.
  //
  // Deriving this from the placed graves instead would have quietly declared
  // okonkwo and demir survivors, because they have no marker in this crevice.
  TRUTH = {};
  for(const id of Object.keys(story.graves || {})){
    if(id.startsWith("_")) continue;
    const sg = story.graves[id];
    const year = parseInt(String(sg.label).replace(/[^0-9]/g, ""), 10);
    if(sg.crew && isFinite(year)) TRUTH[sg.crew] = { fate: "died", year, label: sg.label };
  }
  for(const c of CREW) if(!TRUTH[c.id]) TRUTH[c.id] = { fate: "survived", year: null, label: "" };

  CONCLUSIONS = {}; LOCKED = {};
  minPerCommit = (config.deduction && config.deduction.minPerCommit) || 3;
  openingGrave = (config.deduction && config.deduction.openingGrave) || null;
}

/* ---------------- the worksheet ----------------
   Reading something records evidence. It never records a conclusion. The player
   sets a fate against each name themselves and commits a set of them; the game
   answers only "all of these are right" or "something here is wrong", and never
   which one. That refusal is the whole mechanism — told which entry was wrong,
   a player would binary-search the answer instead of reading the graves. */

let TRUTH = {}, CONCLUSIONS = {}, LOCKED = {}, minPerCommit = 3, openingGrave = null;
let archive = [], archiveStory = {};
let datesFromRecord = [], graveRecords = {};

// Fate options are earned, not given: a year only becomes selectable once the
// player has stood at the marker that states it.
//
// Two of the six are buried somewhere this game never goes, and nothing readable
// in this crevice states the year either of them died. Rather than offer dates the
// player has no evidence for, those two stay unavailable — config.deduction
// .datesFromRecord is the switch, and it is deliberately empty. Fill it in only
// when a log the player can actually reach carries the year, and the date then
// becomes selectable at the point that log is read (the shelter). The label comes
// from the grave record in story.json, so turning it on invents no text either.
export function fateOptions(){
  const out = GRAVES.filter(g => g.read)
    .map(g => ({ year: parseInt(String(g.l).replace(/[^0-9]/g, ""), 10), label: g.l }));
  if(LAST && LAST.read){
    for(const id of datesFromRecord){
      const rec = graveRecords[id];
      if(!rec) continue;
      out.push({ year: parseInt(String(rec.label).replace(/[^0-9]/g, ""), 10), label: rec.label });
    }
  }
  const seen = new Set();
  return out.filter(o => isFinite(o.year)).sort((a, b) => a.year - b.year)
            .filter(o => !seen.has(o.year) && seen.add(o.year));
}

export function conclusionFor(id){ return CONCLUSIONS[id] || null; }
export function isLocked(id){ return !!LOCKED[id]; }
export function lockedCount(){ return Object.keys(LOCKED).length; }
export function minConclusions(){ return minPerCommit; }

// value is "unknown" | "survived" | "died:<year>"
export function setConclusion(id, value){
  if(LOCKED[id]) return;
  if(value === "unknown"){ delete CONCLUSIONS[id]; return; }
  if(value === "survived"){ CONCLUSIONS[id] = { fate: "survived", year: null }; return; }
  const year = parseInt(String(value).split(":")[1], 10);
  if(isFinite(year)) CONCLUSIONS[id] = { fate: "died", year };
}

// All-or-nothing, and deliberately mute about which entry failed.
export function commitConclusions(){
  const pending = Object.keys(CONCLUSIONS).filter(id => !LOCKED[id]);
  if(pending.length < minPerCommit) return { ok: false, reason: "few", need: minPerCommit, have: pending.length };
  const allRight = pending.every(id => {
    const c = CONCLUSIONS[id], t = TRUTH[id];
    return t && c.fate === t.fate && (c.fate !== "died" || c.year === t.year);
  });
  if(!allRight) return { ok: false, reason: "wrong", have: pending.length };
  for(const id of pending) LOCKED[id] = true;
  return { ok: true, locked: pending.length, total: lockedCount() };
}

// HANDOFF interface: look up the readable text/gift for a camp/grave/shelter id.
export function read(id){
  const o = CAMPS.find(c => c.id === id) || GRAVES.find(g => g.id === id) ||
            (LAST && LAST.id === id ? LAST : null);
  if(!o) return null;
  return { title: o.t, body: o.b, gift: o.gift };
}

export function crew(){ return CREW; }
export function knowsTruth(){ return S.knowTruth; }

// Reading something files it as evidence: what it said, where it was standing,
// and how far into the descent it was found. It does not conclude anything.
function file(name, kind, body, x, z){
  S.log.push({ name, kind, desc: String(body).replace(/<[^>]+>/g, " "), h: S.t / 60, x, z });
}

// ref 774-778: unread grave, then unread camp, then the unlogged shelter.
export function targetReadable(){
  for(const g of GRAVES){ if(g.read) continue;
    if(Math.hypot(g.x - S.px, g.z - S.pz) <= g.r) return { k: "grave", o: g, label: ui.promptReadMarker }; }
  for(const cp of CAMPS){ if(cp.read) continue;
    if(Math.hypot(cp.x - S.px, cp.z - S.pz) <= cp.r) return { k: "camp", o: cp, label: ui.promptReadRecord }; }
  if(!LAST.read && Math.hypot(LAST.x - S.px, LAST.z - S.pz) <= LAST.r)
    return { k: "last", o: LAST, label: ui.promptEnterShelter };
  return null;
}

// ref 819-823.
//
// One marker behaves differently: the one the player lands beside. Reading it
// enters that single fate into the record and opens the sheet, so the first thing
// they ever see of the crew is one row filled and five blank. That hole is the
// hook and it points down the canyon, because that is where the rest of them are.
// Every other marker in the game still concludes nothing.
export function readGrave(g){
  const first = openingGrave && g.id === openingGrave && !LOCKED[g.who];
  g.read = true;
  if(first && TRUTH[g.who]){
    const t = TRUTH[g.who];
    CONCLUSIONS[g.who] = { fate: t.fate, year: t.year };
    LOCKED[g.who] = true;
  }
  showPanel(ui.kickerGraveMarker, `${g.t} — ${g.l}`, ui.subtitleNotYourSurvey, g.b, "",
            first ? openWorksheet : null);
  file(`${g.t} — ${g.l}`, ui.logKindGrave, g.b, g.x, g.z);
  renderManifest();
}

// ref 825-835
//
// One camp does more than fill in a finding. The camp flagged grantsSurvey in
// config carries the entry in which Vantaa hands over where to look — and that is
// the moment the six sites appear on the manifest and the clock starts running.
// Before it there is no manifest and nothing is expiring. Nothing here announces
// that: the panel is the reveal, and the display behind it has simply changed by
// the time the player closes it.
export function readCamp(cp){
  cp.read = true;
  if(cp.grants && grantSurvey) grantSurvey(cp);
  let gift = "";
  if(cp.gives){ const c = manifest.crit(cp.gives);
    if(!c.done){ manifest.complete(cp.gives, "meridian", c.name || "(Meridian archive)");
      // story.toasts.giftTemplate = "{name} — answered from their records. You did not have to reach it."
      gift = `<div class="rule"></div><p class="body"><em>${cp.gift}</em><br>
        <span style="font-size:13px;opacity:.8">${giftTemplate.replace("{name}", esc(c.n))}</span></p>`; }
    // story.toasts.giftAlreadyHaveTemplate = "Their {name} file is here too. You already have your own."
    else gift = `<div class="rule"></div><p class="body" style="opacity:.6;font-size:14px">${giftAlreadyTemplate.replace("{name}", esc(c.n.toLowerCase()))}</p>`;
  }
  showPanel(ui.kickerRecoveredRecord, cp.t, ui.subtitleNotYourSurvey, cp.b, gift);
  file(cp.t, ui.logKindRecord, cp.b, cp.x, cp.z);
  renderManifest();
}

// ref 837-844
export function readLast(){
  LAST.read = true; S.knowTruth = true;

  // The relay archive. Lindqvist ran the relay, so everything the survey ever
  // filed is on the terminal in here — including the findings from the four camps
  // that are somewhere else on this planet. The gift line for each is that camp's
  // own sentence out of story.json; nothing new is written to say it.
  let gifts = "";
  for(const [siteId, campId] of archive){
    const c = manifest.crit(siteId);
    if(!c || c.done) continue;
    manifest.complete(siteId, "meridian", c.name || "(Meridian archive)");
    const line = archiveStory[campId] && archiveStory[campId].gift;
    gifts += `<p class="body"><em>${line || ""}</em><br>
      <span style="font-size:13px;opacity:.8">${giftTemplate.replace("{name}", esc(c.n))}</span></p>`;
  }
  if(gifts) gifts = `<div class="rule"></div>${gifts}`;

  showPanel(ui.kickerShelter, LAST.t, ui.subtitleNotOnManifest, LAST.b,
    `${gifts}<div class="rule"></div><h1 style="font-size:19px">${CONFESSION.t}</h1>
     <p class="body">${CONFESSION.b}</p>`);
  file(CONFESSION.t, ui.logKindConfession, CONFESSION.b, LAST.x, LAST.z);
  renderManifest();
  setTimeout(() => toast(afterReadToast, 13000), 900);
}
