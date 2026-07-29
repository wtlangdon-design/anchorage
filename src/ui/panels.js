// ui/panels.js — the overlay panels: the opening briefing, the naming input,
// the logbook, and the generic message/panel overlays other modules fill.
//
// Ported verbatim from the reference: closeOv (697-698), the tab listener
// (690-695), brief (710-755), transmission (756-767), finishSurvey (790-798),
// commit (799-810), panel (812-818), the nm-ok/nm-input wiring (809-810),
// openLog (846-859), and the survey start/interrupt/tick (784, 1112, 1127).
// Numbers come from config, prose/UI strings from story. Zero behaviour change.

let config, story, S, manifest, storyMod;
let toast, esc, mmss, renderManifest, rand, lostAtT, startAudio;

let bstep = 0, bs = null, pending = null;

export function initPanels(cfg, storyArg, deps){
  config = cfg; story = storyArg;
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  toast = deps.toast; esc = deps.esc; mmss = deps.mmss;
  renderManifest = deps.renderManifest; rand = deps.rand; lostAtT = deps.lostAtT;
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
export function showPanel(kicker, title, sub, body, extra){
  document.getElementById("msheet").innerHTML = `
    <div class="lab">${kicker}</div><h1 style="font-size:21px">${title}</h1><h2>${sub}</h2>
    <p class="body">${body}</p>${extra || ""}
    <button onclick="document.getElementById('msg').classList.remove('on')">${story.ui.closeButton}</button>`;
  document.getElementById("msg").classList.add("on");
}
export function showMsg(html){
  document.getElementById("msheet").innerHTML = html;
  document.getElementById("msg").classList.add("on");
}
export function closeOverlay(){ document.querySelectorAll(".overlay.on").forEach(o => {
  if(o.id !== "briefing" && o.id !== "naming") o.classList.remove("on"); }); }

/* ---------- briefing ---------- */
export function brief(){
  if(bstep === 0){
    const st = story.briefing.step1;
    bs.innerHTML = `<h1>${st.title}</h1><h2>${st.subtitle}</h2>
    ${st.body.map(p => `<p class="body">${p}</p>`).join("\n")}
    <div class="rule"></div>
    <label class="lab">${st.surveyorLabel}</label><input type="text" id="i-n" placeholder="${st.surveyorPlaceholder}">
    <div style="height:16px"></div>
    <label class="lab">${st.vesselLabel}</label><input type="text" id="i-s" placeholder="${st.vesselPlaceholder}">
    <button id="bnx">${st.button}</button>`;
    const go = () => { S.name = document.getElementById("i-n").value.trim() || st.defaultSurveyorName;
      S.ship = document.getElementById("i-s").value.trim() || st.defaultShipName; bstep = 1; brief(); };
    document.getElementById("bnx").onclick = go;
    bs.querySelectorAll("input").forEach(i => i.addEventListener("keydown", e => { if(e.key === "Enter") go(); }));
    document.getElementById("i-n").focus();
  } else if(bstep === 1){
    const st = story.briefing.step2;
    bs.innerHTML = `<h1>${st.title}</h1><h2>${st.subtitle}</h2>
    <p class="body">${st.intro}</p>
    <p class="tiny">${manifest.list().map(c => {
      const t = c.band ? null : lostAtT(c.x);
      return `${c.n.toUpperCase().padEnd(20, "·")} ${t === null ? st.neverLostLabel : st.lostAtPrefix + mmss(t)}`;
    }).join("<br>")}</p>
    <p class="body">${st.body[0]}</p>
    <div class="rule"></div>
    <p class="body">${st.body[1]}</p>
    <p class="body">${st.body[2]}</p>
    <button id="bnx">${st.button}</button>`;
    document.getElementById("bnx").onclick = () => { bstep = 2; brief(); };
  } else {
    const st = story.briefing.step3;
    bs.innerHTML = `<h1>${st.title}</h1><h2>${st.subtitle}</h2>
    <p class="body">${st.body}</p>
    <input type="text" id="i-p" placeholder="${st.placeholder}">
    <div class="hint">${st.hint}</div>
    <button id="bnx">${st.button}</button>`;
    const go = () => { S.planet = document.getElementById("i-p").value.trim() || st.defaultPlanetName;
      // the audio context has to be created inside the gesture that starts the
      // game, or the browser refuses it. it fails silently if it fails at all.
      if(startAudio) startAudio();
      document.getElementById("briefing").classList.remove("on"); S.started = true;
      toast(story.toasts.viewHint, 6000);
      setTimeout(transmission, config.timing.fleetTransmissionDelayMs); };
    document.getElementById("bnx").onclick = go;
    document.getElementById("i-p").focus();
    bs.querySelector("input").addEventListener("keydown", e => { if(e.key === "Enter") go(); });
  }
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
