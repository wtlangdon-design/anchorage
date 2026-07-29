// game/endings.js — transmit + the three endings + the failure screen.
//
// Ported verbatim from the reference: transmit() (1031-1049), sendIt() (1050-1079),
// fail() (1080-1087). Pure logic/state — no THREE. Prose comes from story; the
// reference's DOM writes become showMsg() calls handed in via deps. showMsg(html)
// sets the #msg overlay content and opens it. Zero behaviour change.

let S, manifest, storyMod, showMsg, toast, esc, story;

export function initEndings(config, story_, deps){
  S = deps.S; manifest = deps.manifest; storyMod = deps.storyMod;
  showMsg = deps.showMsg; toast = deps.toast; esc = deps.esc;
  story = story_;
}

// ref 1031-1049
export function transmit(){
  if(S.ended || S.dead) return;
  const got = manifest.list().filter(c => c.done);
  if(!got.length){ toast(story.toasts.nothingToSend, 2000); return; }
  if(!S.knowTruth){ return sendIt("clean", got); }
  const p = story.endings.prompt;
  showMsg(`
    <h1>${p.title}</h1><h2>${p.subtitle}</h2>
    <p class="body">${p.body[0]}</p>
    <p class="body" style="opacity:.75;font-size:14px">${p.body[1]}</p>
    <div class="rule"></div>
    <button id="e1">${p.optionClean}</button>
    <button id="e2">${p.optionCaveat}</button>
    <button id="e3" class="danger">${p.optionWithdraw}</button>
    <div class="hint">${p.hint}</div>`);
  document.getElementById("e1").onclick = () => sendIt("clean", got);
  document.getElementById("e2").onclick = () => sendIt("caveat", got);
  document.getElementById("e3").onclick = () => sendIt("withdraw", got);
}

// ref 1050-1079
export function sendIt(mode, got){
  S.ended = true;
  const mine = got.filter(c => c.by === "you").length,
        hers = got.filter(c => c.by === "meridian").length;
  const lost = manifest.list().filter(c => !c.done);

  const em = story.endings[mode];
  // withdraw's first paragraph carries {planet}; the others have no placeholder.
  const end = em.body.map(pp =>
    `<p class="body">${pp.replace("{planet}", esc(S.planet))}</p>`).join("\n    ");

  const sum = story.endings.summary;
  const recovered = hers ? sum.recoveredTemplate.replace("{hers}", hers) : "";
  const findings = sum.findingsTemplate
    .replace("{count}", got.length).replace("{mine}", mine).replace("{recovered}", recovered);
  const unanswered = lost.length
    ? sum.unansweredTemplate.replace("{list}", lost.map(c => esc(c.n)).join(", ")) : "";
  // what the player worked out and committed, not what the game handed them
  const crewLine = sum.crewTemplate.replace("{known}", storyMod.lockedCount());
  const neverFound = S.knowTruth ? "" : "<br>" + sum.neverFoundSixth;

  showMsg(`
    <h1>${em.heading}</h1>
    <h2>${esc(S.name)} · ${esc(S.ship)} · ${esc(S.planet)}</h2>
    <p class="body">${findings}
    ${unanswered}</p>
    <p class="body" style="font-size:14px;opacity:.8">${crewLine}
    ${neverFound}</p>
    <div class="rule"></div>${end}<div class="rule"></div>
    <p class="body" style="opacity:.5;font-size:14px">${sum.sliceNote}</p>
    <button onclick="location.reload()">${sum.restartButton}</button>`);
}

// ref 1080-1087
export function fail(msg){
  if(S.dead || S.ended) return; S.dead = true;
  showMsg(`<h1>${story.failure.title}</h1>
    <h2>${esc(S.ship)} · ${esc(S.planet)}</h2><p class="body">${msg}</p>
    <p class="body" style="opacity:.6;font-size:14px">${story.failure.coda}</p>
    <button onclick="location.reload()">${story.failure.restartButton}</button>`);
}
