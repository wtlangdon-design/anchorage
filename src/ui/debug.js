// debug.js — an on-screen readout, because the person who can see the game and the
// person who can read the code are not the same person and cannot share a console.
//
// Toggle with G, or the "?" button in the touch overlay. Everything here is read at
// the moment you open it; nothing runs per-frame while it is closed.

let config, deps, el, on = false;
const errors = [];

export function initDebug(cfg, story, d){
  config = cfg; deps = d;

  // capture anything the page complains about, including shader link failures,
  // which otherwise only ever appear in a console nobody can open on a phone
  const ce = console.error.bind(console);
  console.error = (...a) => { errors.push(a.map(String).join(" ").slice(0, 300)); ce(...a); };
  const cw = console.warn.bind(console);
  console.warn = (...a) => { errors.push("WARN " + a.map(String).join(" ").slice(0, 300)); cw(...a); };
  addEventListener("error", e => errors.push("ERR " + (e.message || "") + " @" + (e.filename || "").split("/").pop() + ":" + (e.lineno || "")));
  addEventListener("unhandledrejection", e => errors.push("REJECT " + String(e.reason).slice(0, 200)));

  el = document.createElement("div");
  el.id = "dbg";
  el.style.cssText = "position:fixed;left:8px;top:8px;z-index:30;max-width:min(560px,94vw);" +
    "max-height:88vh;overflow:auto;background:rgba(4,7,12,.94);border:1px solid rgba(143,198,212,.4);" +
    "color:#C8D4DC;font:10px/1.5 monospace;padding:10px 12px;display:none;white-space:pre-wrap;" +
    "-webkit-user-select:text;user-select:text";
  document.body.appendChild(el);
  addEventListener("keydown", e => {
    const tag = (e.target && e.target.tagName || "").toLowerCase();
    if(tag === "input" || tag === "textarea") return;
    if(e.key.toLowerCase() === "g") toggleDebug();
  });
}

export function toggleDebug(){ on = !on; el.style.display = on ? "block" : "none"; if(on) render(); }

function render(){
  const L = [];
  const push = (k, v) => L.push(k.padEnd(22) + v);

  L.push("=== " + (config.buildStamp || "no build stamp") + " ===", "");

  const r = deps.renderer;
  if(r && r.info){
    push("draw calls", r.info.render.calls);
    push("triangles", r.info.render.triangles.toLocaleString());
    push("programs", (r.info.programs || []).length);
    push("geometries", r.info.memory.geometries);
    push("textures", r.info.memory.textures);
  }
  L.push("");

  const S = deps.S;
  push("player x,z", Math.round(S.px) + ", " + Math.round(S.pz));
  push("ground y", (deps.heightAt ? deps.heightAt(S.px, S.pz) : 0).toFixed(1));
  push("mission t", S.t.toFixed(0) + "s   clock " + (S.clockStarted ? "RUNNING" : "not started"));
  L.push("");

  // the jungle, layer by layer: what is on the GPU and where the nearest one is
  const st = deps.jungleStats && deps.jungleStats();
  const meshes = [];
  if(deps.scene) deps.scene.traverse(o => { if(o.isInstancedMesh) meshes.push(o); });
  L.push("INSTANCED LAYERS IN THE SCENE");
  const m4 = deps.THREE ? new deps.THREE.Matrix4() : null;
  const v3 = deps.THREE ? new deps.THREE.Vector3() : null;
  meshes.forEach((o, i) => {
    const g = o.geometry, pos = g.getAttribute && g.getAttribute("position");
    let near = "-", nearY = "";
    if(m4 && o.count > 0){
      let best = Infinity, by = 0;
      const step = Math.max(1, Math.floor(o.count / 400));
      for(let k = 0; k < o.count; k += step){
        o.getMatrixAt(k, m4); v3.setFromMatrixPosition(m4);
        const d = Math.hypot(v3.x - S.px, v3.z - S.pz);
        if(d < best){ best = d; by = v3.y; }
      }
      near = isFinite(best) ? best.toFixed(0) + "m" : "-";
      nearY = "  y=" + by.toFixed(1);
    }
    const name = (st && st.layers[i] && st.layers[i].name) || ("mesh" + i);
    L.push("  " + name.padEnd(11) +
      " n=" + String(o.count).padStart(5) +
      " v=" + String(pos ? pos.count : 0).padStart(3) +
      " vis=" + (o.visible ? "y" : "N") +
      " nearest=" + near + nearY);
  });
  L.push("");

  // did the shaders actually compile and link?
  L.push("PROGRAMS");
  if(r && r.info && r.info.programs){
    r.info.programs.forEach(p => {
      const d = p.getUniforms ? "" : "";
      L.push("  " + String(p.name || "?").padEnd(18) + " used=" + p.usedTimes + d);
    });
  }
  L.push("");

  L.push("ERRORS AND WARNINGS  (" + errors.length + ")");
  if(!errors.length) L.push("  none");
  else errors.slice(-12).forEach(e => L.push("  " + e));

  el.textContent = L.join("\n");
}
