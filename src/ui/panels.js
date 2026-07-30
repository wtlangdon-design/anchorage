// ui/panels.js — the overlay panels: the opening briefing, the naming input,
// the logbook, and the generic message/panel overlays other modules fill.
//
// Ported verbatim from the reference: closeOv (697-698), the tab listener
// (690-695), brief (710-755), transmission (756-767), finishSurvey (790-798),
// commit (799-810), panel (812-818), the nm-ok/nm-input wiring (809-810),
// openLog (846-859), and the survey start/interrupt/tick (784, 1112, 1127).
// Numbers come from config, prose/UI strings from story. Zero behaviour change.

let config, story, S, manifest, storyMod;
// mmss and lostAtT used to be here for the old briefing's countdown listing. That
// listing is gone — the manifest is not issued from orbit any more — so they are
// deliberately not taken from deps. main.js still passes them; harmless.
let toast, esc, renderManifest, rand, startAudio;

let bstep = 0, bs = null, pending = null;

export function initPanels(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  toast = deps.toast; esc = deps.esc;
  renderManifest = deps.renderManifest; rand = deps.rand;
  startAudio = deps.startAudio;

  bs = document.getElementById("bsheet");

  // logbook tabs (ref 690-695)
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(x => x.classList.remove("on"));
    t.classList.add("on");
    const crew = t.dataset.t === "crew";
    document.getElementById("log-list").style.display = crew ? "none" : "block";
    document.getElementById("crew-list").style.display = crew ? "block" : "none";
  }));

  // naming commit wiring (ref 809-810)
  document.getElementById("nm-ok").onclick = commit;
  document.getElementById("nm-input").addEventListener("keydown", e => { if(e.key === "Enter") commit(); });

  brief();   // ref 755: show step 0 at load
}

/* ---------- generic overlays ---------- */
export function showPanel(kicker, title, sub, body, extra, onClose){
  document.getElementById("msheet").innerHTML = `
    <div class="lab">${kicker}</div><h1 style="font-size:21px">${title}</h1><h2>${sub}</h2>
    <p class="body">${body}</p>${extra || ""}
    <button id="panel-close">${story.ui.closeButton}</button>`;
  const btn = document.getElementById("panel-close");
  btn.onclick = () => {
    document.getElementById("msg").classList.remove("on");
    if(onClose) onClose();
  };
  document.getElementById("msg").classList.add("on");
}

// Open the logbook straight onto the crew sheet. Used once, by the marker you
// land beside: you close the plate and the sheet is simply there, one row filled
// and five empty. Nothing explains it, because one filled row against five blank
// ones already says everything there is to say.
export function openCrewSheet(){
  openLog();
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.t === "crew"));
  document.getElementById("log-list").style.display = "none";
  document.getElementById("crew-list").style.display = "block";
}
export function showMsg(html){
  document.getElementById("msheet").innerHTML = html;
  document.getElementById("msg").classList.add("on");
}
export function closeOverlay(){ document.querySelectorAll(".overlay.on").forEach(o => {
  if(o.id !== "briefing" && o.id !== "naming") o.classList.remove("on"); }); }

/* ---------- the briefing: an ordered list of BEATS ----------

   The opening is a sequence of screens, one beat each, advanced by the player. The
   sequence itself lives in story.json under `briefing.beats` — an ordered array —
   so beats can be added, reordered, cut or rewritten without anyone touching a .js
   file. Nothing below knows how many there are or what they say.

   THREE KINDS, and a beat is identified by its kind and never by its index, so the
   order in story.json is genuinely free:

     "commission"  the two name fields. Sets S.name and S.ship.
     "text"        a title, a subtitle, any number of paragraphs, and a button.
     "naming"      the planet field. This is the beat that ENDS the briefing and
                   starts the game, wherever in the array it happens to sit.

   Every field is optional except kind. A beat with no title renders without one; a
   beat with no button falls back to the next beat's, then to a bare marker. A beat
   flagged `"unwritten": true` renders a visible, marked empty slot — the same
   convention as the fleet transmission's placeholder marker. It is deliberately not
   silently skipped: an unwritten beat should be impossible to forget about.

   Shape:
     { "kind": "commission", "title": "", "subtitle": "", "body": [],
       "surveyorLabel": "", "surveyorPlaceholder": "", "defaultSurveyorName": "",
       "vesselLabel": "", "vesselPlaceholder": "", "defaultShipName": "",
       "button": "" }
     { "kind": "text", "title": "", "subtitle": "", "body": ["", ""], "button": "" }
     { "kind": "text", "unwritten": true, "button": "" }
     { "kind": "naming", "title": "", "subtitle": "", "body": "",
       "placeholder": "", "hint": "", "defaultPlanetName": "", "button": "" }
*/

let BEATS = [];

// Strings the machinery itself needs. Same pattern as the worksheet's T() below:
// story.json wins the moment the key exists, and until then the fallback is plainly
// developer text rather than something pretending to be prose.
const B = (key, fallback) => (story.briefing && story.briefing[key]) || fallback;

function buildBeats(){
  const br = story.briefing || {};
  let beats = Array.isArray(br.beats) && br.beats.length ? br.beats.slice() : legacyBeats(br);
  // The naming beat is what starts the game. Without one the briefing would have no
  // exit, so rather than hang, put the legacy one back and say so in the console.
  if(!beats.some(b => b.kind === "naming")){
    console.warn("briefing: no beat of kind \"naming\" — appending the legacy naming screen, " +
                 "or the game can never start. Add one to story.briefing.beats.");
    beats = beats.concat(legacyBeats(br).filter(b => b.kind === "naming"));
  }
  return beats;
}

// LEGACY SHIM — delete this the day story.briefing.beats exists.
//
// It builds the beat array out of the step1/step2/step3 keys that are still in
// story.json, in the order the opening now wants, and it invents no text. Two
// consequences worth knowing about, both reported rather than papered over:
//
//   * step1's two paragraphs are the FLEET beat, not the commission beat, because
//     "You are the part of that gamble that has to work" only means anything
//     directly after the sentences that describe the gamble. So the commission
//     screen is the two fields and its own title, with no prose of its own.
//   * step2.intro, step2.body[0], step2.neverLostLabel and step2.lostAtPrefix are
//     NOT used any more and cannot be: they describe an orbital manifest that is no
//     longer issued from orbit. Only step2's two Meridian paragraphs survive.
function legacyBeats(br){
  const s1 = br.step1 || {}, s2 = br.step2 || {}, s3 = br.step3 || {};
  const s2body = Array.isArray(s2.body) ? s2.body : [];
  return [
    { kind: "commission", title: s1.title, subtitle: s1.subtitle, body: [],
      surveyorLabel: s1.surveyorLabel, surveyorPlaceholder: s1.surveyorPlaceholder,
      defaultSurveyorName: s1.defaultSurveyorName,
      vesselLabel: s1.vesselLabel, vesselPlaceholder: s1.vesselPlaceholder,
      defaultShipName: s1.defaultShipName, button: s1.button },
    // the fleet
    { kind: "text", body: Array.isArray(s1.body) ? s1.body : [], button: s2.button },
    // the Meridian — s2.body[1] and [2]; [0] was about the orbital manifest
    { kind: "text", subtitle: s2.subtitle, body: s2body.slice(1), button: s2.button },
    // the descent: nothing written for this yet
    { kind: "text", unwritten: true, button: s2.button },
    { kind: "naming", title: s3.title, subtitle: s3.subtitle, body: s3.body,
      placeholder: s3.placeholder, hint: s3.hint,
      defaultPlanetName: s3.defaultPlanetName, button: s3.button }
  ];
}

// wordless, so it adds no prose: one dot per beat, the current one filled
function dots(i, n){
  let out = "";
  for(let k = 0; k < n; k++)
    out += `<span style="display:inline-block;width:5px;height:5px;border-radius:50%;margin-right:6px;` +
           `background:var(--dawnlight);opacity:${k === i ? ".75" : ".2"}"></span>`;
  return `<div style="margin-top:18px">${out}</div>`;
}

export function brief(){
  if(!BEATS.length) BEATS = buildBeats();
  if(bstep < 0) bstep = 0;
  if(bstep >= BEATS.length) bstep = BEATS.length - 1;
  const beat = BEATS[bstep] || {};
  const nextBeat = BEATS[bstep + 1];

  const head = (beat.title ? `<h1>${beat.title}</h1>` : "")
             + (beat.subtitle ? `<h2>${beat.subtitle}</h2>` : "");
  const paras = Array.isArray(beat.body) ? beat.body : beat.body ? [beat.body] : [];
  const body = paras.map(p => `<p class="body">${p}</p>`).join("\n");
  // a beat with nothing in it says so, in the same voice as the fleet transmission's
  // marker: visible, unmistakably not finished prose, and impossible to overlook
  const slot = beat.unwritten
    ? `<p class="body" style="opacity:.5;font-style:italic;font-size:13px">${
        B("unwrittenMarker", "[ this beat is not written yet — see story.briefing.beats ]")}</p>`
    : "";
  const label = beat.button || (nextBeat && nextBeat.button) || B("continueButton", "Continue");
  const advance = () => { bstep++; brief(); };

  if(beat.kind === "commission"){
    bs.innerHTML = `${head}${body}${slot}
    <div class="rule"></div>
    <label class="lab">${beat.surveyorLabel || ""}</label>
    <input type="text" id="i-n" placeholder="${beat.surveyorPlaceholder || ""}">
    <div style="height:16px"></div>
    <label class="lab">${beat.vesselLabel || ""}</label>
    <input type="text" id="i-s" placeholder="${beat.vesselPlaceholder || ""}">
    <button id="bnx">${label}</button>${dots(bstep, BEATS.length)}`;
    const go = () => {
      S.name = document.getElementById("i-n").value.trim() || beat.defaultSurveyorName || "Surveyor";
      S.ship = document.getElementById("i-s").value.trim() || beat.defaultShipName || "";
      advance();
    };
    document.getElementById("bnx").onclick = go;
    bs.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if(e.key === "Enter") go(); }));
    document.getElementById("i-n").focus();

  } else if(beat.kind === "naming"){
    bs.innerHTML = `${head}${body}${slot}
    <input type="text" id="i-p" placeholder="${beat.placeholder || ""}">
    ${beat.hint ? `<div class="hint">${beat.hint}</div>` : ""}
    <button id="bnx">${label}</button>${dots(bstep, BEATS.length)}`;
    const go = () => {
      S.planet = document.getElementById("i-p").value.trim() || beat.defaultPlanetName || "";
      startGame();
    };
    document.getElementById("bnx").onclick = go;
    document.getElementById("i-p").focus();
    bs.querySelector("input").addEventListener("keydown", e => { if(e.key === "Enter") go(); });

  } else {
    bs.innerHTML = `${head}${body}${slot}
    <button id="bnx">${label}</button>${dots(bstep, BEATS.length)}`;
    document.getElementById("bnx").onclick = advance;
  }
}

// Leaving the briefing. Unchanged from what step 3 used to do, lifted out so the
// naming beat can sit anywhere in the array.
function startGame(){
  // the audio context has to be created inside the gesture that starts the game, or
  // the browser refuses it. it fails silently if it fails at all.
  if(startAudio) startAudio();
  document.getElementById("briefing").classList.remove("on");
  S.started = true;
  toast(story.toasts.viewHint, 6000);
  setTimeout(transmission, config.timing.fleetTransmissionDelayMs);
}

// The fleet transmission is a protected placeholder block — its text is reproduced
// verbatim from story.fleetTransmission and must not be rewritten (ref 756-767).
function transmission(){
  if(S.dead || S.ended) return;
  const ft = story.fleetTransmission;
  document.getElementById("msheet").innerHTML = `
  <div class="lab">${ft.kicker}</div>
  <h1 style="font-size:22px">${ft.titleTemplate.replace("{surveyor}", () => esc(S.name))}</h1><h2>${ft.subtitle}</h2>
  <p class="body" style="opacity:.5;font-style:italic;font-size:13px">${ft.marker}</p>
  ${ft.body.map(p => `<p class="body">${p}</p>`).join("\n")}
  <button onclick="document.getElementById('msg').classList.remove('on')">${ft.button}</button>`;
  document.getElementById("msg").classList.add("on");
}

/* ---------- survey completion / naming ---------- */
export function finishSurvey(c){
  S.surveying = null; S.progress = 0; pending = c;
  document.getElementById("nm-title").textContent = c.place;
  document.getElementById("nm-sub").textContent = story.ui.namingSubtitleTemplate.replace("{name}", () => c.n);
  document.getElementById("nm-find").innerHTML = `<em>${c.find}</em>`;
  const i = document.getElementById("nm-input");
  i.value = ""; i.placeholder = c.sugg[(rand() * c.sugg.length) | 0];
  document.getElementById("naming").classList.add("on"); setTimeout(() => i.focus(), 40);
}
function commit(){
  if(!pending) return;
  const i = document.getElementById("nm-input");
  const nm = i.value.trim() || i.placeholder;
  manifest.complete(pending.id, "you", nm);
  S.log.push({ name: nm, kind: pending.place, desc: pending.find, h: S.t / 60 });
  document.getElementById("naming").classList.remove("on");
  toast(story.toasts.siteAnsweredTemplate.replace("{name}", () => esc(nm)).replace("{finding}", () => esc(pending.n.toLowerCase())));
  pending = null; renderManifest();
}

/* ---------- logbook ---------- */
// Strings the worksheet needs. Each one reads out of story.json when it is there
// and falls back to the text below until then, so the writer owns every word the
// moment she adds the keys and nothing here has to change.
const T = (key, fallback) => (story.ui && story.ui[key]) || fallback;

let commitNote = "";

export function openLog(){
  document.getElementById("log-sub").textContent = `${S.name} · ${S.ship} · ${S.planet}`;
  const l = document.getElementById("log-list");
  // evidence, newest first: what it said, where it was standing, when it was found
  l.innerHTML = S.log.length ? S.log.slice().reverse().map(d => {
    const where = (typeof d.x === "number" && typeof d.z === "number")
      ? ` · ${(d.x / 1000).toFixed(1)}k, ${(d.z / 1000).toFixed(1)}k` : "";
    return `<div class="entry"><div class="nm">${esc(d.name)}</div>
    <div class="meta">${esc(d.kind)}${where} · ${d.h.toFixed(0)} min</div>
    <div class="desc">${esc(d.desc).slice(0, 700)}</div></div>`;
  }).join("") : `<p class="body" style="opacity:.5">${story.ui.logbookEmpty}</p>`;
  renderCrew();
  document.getElementById("logbook").classList.add("on");
}

function renderCrew(){
  const years = storyMod.fateOptions();
  const rows = storyMod.crew().map(c => {
    const locked = storyMod.isLocked(c.id), got = storyMod.conclusionFor(c.id);
    const value = !got ? "unknown" : got.fate === "survived" ? "survived" : "died:" + got.year;
    if(locked){
      const said = got.fate === "survived" ? T("crewFateSurvived", "outlived the others")
        : T("crewFateDiedTemplate", "died in {label}").replace("{label}", () => yearLabel(got.year, years));
      return `<div class="crewrow locked">
        <div><div class="cn">${esc(c.n)}</div>
        <div style="font-size:9px;letter-spacing:.14em;opacity:.55;text-transform:uppercase">${esc(c.r)}</div></div>
        <div class="cx"><span class="fate-locked">${esc(said)}</span></div></div>`;
    }
    const opts = [`<option value="unknown"${value === "unknown" ? " selected" : ""}>${esc(T("crewFateUnknown", "— not established —"))}</option>`,
      `<option value="survived"${value === "survived" ? " selected" : ""}>${esc(T("crewFateSurvived", "outlived the others"))}</option>`]
      .concat(years.map(y => {
        const v = "died:" + y.year;
        const label = T("crewFateDiedTemplate", "died in {label}").replace("{label}", () => y.label);
        return `<option value="${v}"${value === v ? " selected" : ""}>${esc(label)}</option>`;
      }));
    return `<div class="crewrow">
      <div><div class="cn">${esc(c.n)}</div>
      <div style="font-size:9px;letter-spacing:.14em;opacity:.55;text-transform:uppercase">${esc(c.r)}</div></div>
      <div class="cx"><select class="fate" data-crew="${c.id}">${opts.join("")}</select></div></div>`;
  }).join("");

  const need = storyMod.minConclusions();
  document.getElementById("crew-list").innerHTML =
    `<p class="hint" style="margin-bottom:12px">${T("crewWorksheetIntro",
      "The manifest gives you six names. What became of them is not on it. Set down only what the evidence will carry.")}</p>`
    + rows
    + `<div id="crew-commit"><button id="crew-ok">${esc(T("crewCommitButton", "Enter these into the record"))}</button>
       <span id="crew-note" class="hint">${commitNote}</span></div>`
    + `<p class="hint">${story.ui.crewFooter}</p>`
    + (years.length ? "" : `<p class="hint" style="opacity:.45">${T("crewNoYearsYet",
        "No dates yet. The markers carry them.")}</p>`);

  document.querySelectorAll("#crew-list select.fate").forEach(sel =>
    sel.addEventListener("change", () => { storyMod.setConclusion(sel.dataset.crew, sel.value); commitNote = ""; }));
  const btn = document.getElementById("crew-ok");
  if(btn) btn.onclick = () => {
    const r = storyMod.commitConclusions();
    // never say WHICH one is wrong — that is the whole rule
    commitNote = r.ok
      ? T("crewCommitAccepted", "Entered. They stand.")
      : r.reason === "few"
        ? T("crewCommitNeedMore", "Not enough to be sure of. Set down at least {n}.").replace("{n}", () => r.need)
        : T("crewCommitWrong", "Something in this set does not hold. Nothing has been entered.");
    renderCrew();
  };
}

function yearLabel(year, years){
  const hit = years.find(y => y.year === year);
  return hit ? hit.label : String(year);
}

/* ---------- survey start / interrupt / tick ---------- */
export function startSurvey(c){ S.surveying = c; S.progress = 0; }                 // ref 784
export function cancelSurvey(){ S.surveying = null; S.progress = 0; toast(story.toasts.surveyInterrupted, 1500); }   // ref 1112
export function tickSurvey(dt){ if(S.surveying){ S.progress += dt; if(S.progress >= S.surveying.dur) finishSurvey(S.surveying); } }   // ref 1127
