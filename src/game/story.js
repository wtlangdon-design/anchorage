// game/story.js — the Meridian narrative. Owns CREW, CAMPS, GRAVES, LAST, CONFESSION.
//
// Ported verbatim from the reference: CREW (208-217), CAMPS (244-290),
// GRAVES (293-316), LAST/CONFESSION (318-334), target()'s readable branch
// (774-778), and readGrave/readCamp/readLast (819-845). Pure logic/state — no
// THREE. Numbers come from config, prose/UI strings from story. Zero behaviour
// change: the reference's DOM writes (panel(), renderManifest()) become calls to
// the ui functions handed in via deps.

let S, manifest, showPanel, renderManifest, esc, toast, ui;
let giftTemplate = "", giftAlreadyTemplate = "";

export let CREW = [], CAMPS = [], GRAVES = [], LAST = null, CONFESSION = null;
let afterReadToast = "";

const CAMP_ORDER  = ["c1", "c2", "c3", "c4", "c5"];
const GRAVE_ORDER = ["g1", "g2", "g3", "g4", "g5"];

export function initStory(config, story, deps){
  S = deps.S; manifest = deps.manifest;
  showPanel = deps.showPanel; renderManifest = deps.renderManifest; esc = deps.esc;
  // readLast schedules a toast; the reference used the global toast().
  toast = deps.toast;
  ui = story.ui;
  giftTemplate = story.toasts.giftTemplate;
  giftAlreadyTemplate = story.toasts.giftAlreadyHaveTemplate;

  CREW = story.crew.map(c => ({ id: c.id, n: c.name, r: c.role, known: false, note: "" }));

  CAMPS = CAMP_ORDER.map(id => {
    const cc = config.camps[id], sc = story.camps[id];
    return {
      id, n: sc.name,
      x: cc.x, z: cc.z, r: cc.radius, gives: cc.gives,
      t: sc.title, b: sc.body, gift: sc.gift,
      rev: sc.reveals.map(rv => [rv.crew, rv.note]),
      read: false
    };
  });

  GRAVES = GRAVE_ORDER.map(id => {
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

// ref 217
export function reveal(id, note){
  const c = CREW.find(c => c.id === id);
  c.known = true; if(note) c.note = note;
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

// ref 819-823
export function readGrave(g){
  g.read = true; reveal(g.rev[0], g.rev[1]);
  showPanel(ui.kickerGraveMarker, `${g.t} — ${g.l}`, ui.subtitleNotYourSurvey, g.b);
  S.log.push({ name: g.t, kind: ui.logKindGrave, desc: g.b.replace(/<[^>]+>/g, " "), h: S.t / 60 });
  renderManifest();
}

// ref 825-835
export function readCamp(cp){
  cp.read = true; (cp.rev || []).forEach(r => reveal(r[0], r[1]));
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
  S.log.push({ name: cp.t, kind: ui.logKindRecord, desc: cp.b.replace(/<[^>]+>/g, " "), h: S.t / 60 });
  renderManifest();
}

// ref 837-844
export function readLast(){
  LAST.read = true; S.knowTruth = true; reveal(CONFESSION.rev[0], CONFESSION.rev[1]);
  showPanel(ui.kickerShelter, LAST.t, ui.subtitleNotOnManifest, LAST.b,
    `<div class="rule"></div><h1 style="font-size:19px">${CONFESSION.t}</h1>
     <p class="body">${CONFESSION.b}</p>`);
  S.log.push({ name: CONFESSION.t, kind: ui.logKindConfession, desc: CONFESSION.b.replace(/<[^>]+>/g, " "), h: S.t / 60 });
  renderManifest();
  setTimeout(() => toast(afterReadToast, 13000), 900);
}
