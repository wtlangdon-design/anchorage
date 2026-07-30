// ui/touch.js — playing this with thumbs.
//
// One build, two ways in. Everything here goes through Pointer Events, so a
// mouse, a finger and a stylus travel the same code path and the keyboard
// bindings in player/controller.js are untouched and still work. On a desktop
// none of this is shown and none of it fires.
//
// The shape of it:
//   left of mobile.stick.sideFraction   a thumb stick that appears where you put
//                                       your thumb down, not at a fixed spot
//   anywhere right of that              drag to look
//   the buttons                         the context action, and the three panels
//
// There is no shift key on a phone, so sprinting is pushing the stick past
// mobile.stick.sprintAt of its travel. That is the only control that has no
// keyboard equivalent, and it is why the stick reports its own speed rather than
// pretending to be a key.

let config, S, actions, controller;
let ST = null;                       // config.mobile.stick
let mobile = false;
let root = null, stickEl = null, knobEl = null, homeEl;

// which pointer is doing what — a thumb each, at most
let moveId = null, lookId = null;
let originX = 0, originY = 0, lastLX = 0, lastLY = 0;

export function isMobile(){ return mobile; }

// Coarse pointer OR no hover OR a touch stack with a small screen. Checked once.
// mobile.force in config overrides it either way, for testing on a desktop.
function detect(cfg){
  const forced = cfg.mobile ? cfg.mobile.force : null;
  if(forced === true || forced === false) return forced;
  const coarse = typeof matchMedia === "function" &&
    (matchMedia("(pointer: coarse)").matches || matchMedia("(hover: none)").matches);
  const touch = ("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0;
  return !!(coarse && touch);
}

export function initTouch(cfg, story, deps){
  config = cfg; S = deps.S; actions = deps.actions; controller = deps.controller;
  ST = (cfg.mobile && cfg.mobile.stick) || { radius: 68, deadZone: 0.14, sprintAt: 0.8, sideFraction: 0.45 };
  mobile = detect(cfg);

  root = document.getElementById("touch");
  stickEl = document.getElementById("stick");
  homeEl = document.getElementById("stick-home");
  knobEl = document.getElementById("stick-knob");
  if(!root) return mobile;

  root.style.display = mobile ? "block" : "none";
  document.body.classList.toggle("touch", mobile);
  if(!mobile) return mobile;

  // The page must never scroll, bounce or zoom under the game. touch-action in
  // the stylesheet does most of it; this catches the rest, but ONLY over the
  // world — the overlays have to stay scrollable or the logbook is unreadable.
  document.addEventListener("touchmove", e => {
    if(document.querySelector(".overlay.on")) return;      // let panels scroll
    if(e.target && e.target.closest && e.target.closest(".sheet")) return;
    e.preventDefault();
  }, { passive: false });

  const surface = document.getElementById("touch-surface");
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onMove);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointercancel", onUp);
  surface.addEventListener("pointerleave", onUp);

  // the buttons. Kept few and large; everything rarely used lives behind "···".
  // The on-screen keyboard eats the viewport in landscape. visualViewport is
  // the only reliable way to know it opened — window.innerHeight does not move.
  if(typeof visualViewport !== "undefined" && visualViewport){
    const check = () => {
      const shrunk = visualViewport.height < innerHeight * 0.75;
      document.body.classList.toggle("kbd", shrunk);
      if(shrunk){
        const el = document.activeElement;
        if(el && el.scrollIntoView) el.scrollIntoView({ block: "center" });
      }
    };
    visualViewport.addEventListener("resize", check);
    visualViewport.addEventListener("scroll", check);
  }

  // the manifest is a tap-to-expand panel on a phone
  const task = document.getElementById("task");
  if(task) task.addEventListener("pointerdown", e => {
    e.stopPropagation(); task.classList.toggle("open");
  });

  bind("btn-act", () => actions.interact());
  bind("btn-chart", () => actions.openChart());
  bind("btn-log", () => actions.openLog());
  bind("btn-send", () => actions.transmit());
  bind("btn-more", () => {
    const m = document.getElementById("more-panel");
    m.style.display = m.style.display === "flex" ? "none" : "flex";
  });
  bind("btn-mute", () => actions.toggleMute());
  bind("btn-fps", () => actions.toggleFps());
  bind("btn-dbg", () => actions.toggleDebug && actions.toggleDebug());
  return mobile;
}

// Buttons respond on pointerdown, not click: a click waits to find out whether
// you meant a double-tap, and that delay is felt.
function bind(id, fn){
  const el = document.getElementById(id);
  if(!el) return;
  el.addEventListener("pointerdown", e => { e.preventDefault(); e.stopPropagation(); fn(); });
}

function onDown(e){
  if(document.querySelector(".overlay.on")) return;
  const leftSide = e.clientX < innerWidth * ST.sideFraction;
  if(leftSide && moveId === null){
    moveId = e.pointerId;
    originX = e.clientX; originY = e.clientY;
    // the stick appears under the thumb rather than at a spot you have to find
    stickEl.style.left = originX + "px";
    stickEl.style.top = originY + "px";
    stickEl.style.display = "block";
    if(homeEl) homeEl.style.opacity = "0";
    knob(0, 0);
  } else if(lookId === null){
    lookId = e.pointerId;
    lastLX = e.clientX; lastLY = e.clientY;
  }
}

function onMove(e){
  if(e.pointerId === moveId){
    let dx = e.clientX - originX, dy = e.clientY - originY;
    const d = Math.hypot(dx, dy);
    if(d > ST.radius){ dx *= ST.radius / d; dy *= ST.radius / d; }
    knob(dx, dy);
    const mag = Math.min(1, d / ST.radius);
    if(mag < ST.deadZone){ controller.setStick(0, 0, false); return; }
    // screen up is forward; screen right is right
    const nx = dx / ST.radius, ny = dy / ST.radius;
    controller.setStick(nx, -ny, mag >= ST.sprintAt);
  } else if(e.pointerId === lookId){
    controller.applyLook(e.clientX - lastLX, e.clientY - lastLY,
      config.mobile.lookSensitivity, config.mobile.pitchSensitivity);
    lastLX = e.clientX; lastLY = e.clientY;
  }
}

function onUp(e){
  if(e.pointerId === moveId){
    moveId = null;
    if(homeEl) homeEl.style.opacity = "1";
    controller.setStick(0, 0, false);
    stickEl.style.display = "none";
  } else if(e.pointerId === lookId){
    lookId = null;
  }
}

function knob(dx, dy){ knobEl.style.transform = `translate(${dx}px, ${dy}px)`; }

// The context button only makes sense when there is something to do, so it is
// dimmed when there is not. Called from the frame loop with the current target.
export function updateTouchPrompt(target){
  if(!mobile || !root) return;
  const b = document.getElementById("btn-act");
  if(b) b.classList.toggle("idle", !target && !S.surveying);
}
