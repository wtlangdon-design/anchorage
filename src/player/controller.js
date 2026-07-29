// player/controller.js — input listeners, movement integration, and camera follow.
// Ported from the reference input block (ref 665-689, EXCLUDING the .tab click
// listener at 690-695 which belongs to ui/panels), movement (ref 1105-1123) and
// camera (ref 1179-1194). Zero behaviour change.

let config, story;
let THREE, S, cam, getPlayer, getHands, heightAt, toast, visorEl, actions;

const keys={};
let drag=false,lx=0,ly=0;

export function initController(cfg, st, deps){
  config = cfg;
  story = st;
  THREE = deps.THREE;
  S = deps.S;
  cam = deps.cam;
  getPlayer = deps.getPlayer;
  getHands = deps.getHands;
  heightAt = deps.heightAt;
  toast = deps.toast;
  visorEl = deps.visorEl;
  actions = deps.actions;

  const camCfg = config.player.camera;

  addEventListener("keydown",e=>{
    const tag=(e.target&&e.target.tagName||"").toLowerCase();
    if(tag==="input"||tag==="textarea"||e.target.isContentEditable)return;
    const k=e.key.toLowerCase();
    if(["w","a","s","d"," ","arrowup","arrowdown","arrowleft","arrowright"].includes(k))e.preventDefault();
    keys[k]=true;
    // fps and mute are controls, not actions in the world: they work with an
    // overlay up and they do not fall through to anything else
    if(k==="f"){actions.toggleFps();return}
    if(k==="v"){actions.toggleMute();return}
    if(document.querySelector(".overlay.on")){if(k==="escape")actions.closeOverlay();return}
    if(k==="e")actions.interact();
    if(k==="l")actions.openLog();
    if(k==="m")actions.openChart();
    if(k==="t")actions.transmit();
    if(k==="c"){S.fp=!S.fp;visorEl.style.display=S.fp?"block":"none";
      getHands().visible=S.fp;toast(S.fp?story.toasts.visorOn:story.toasts.visorOff,1600)}
  });
  addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false});
  addEventListener("mousedown",e=>{if(e.target.tagName==="CANVAS"&&!document.querySelector(".overlay.on")){drag=true;lx=e.clientX;ly=e.clientY}});
  addEventListener("mouseup",()=>drag=false);
  addEventListener("mousemove",e=>{if(!drag)return;S.mouse=true;
    S.camYaw-=(e.clientX-lx)*camCfg.lookSensitivity;
    S.camPitch=Math.max(camCfg.minPitch,Math.min(camCfg.maxPitch,S.camPitch+(e.clientY-ly)*camCfg.pitchSensitivity));
    lx=e.clientX;ly=e.clientY});
  addEventListener("wheel",e=>{if(!S.fp)S.camDist=Math.max(camCfg.minDistance,Math.min(camCfg.maxDistance,S.camDist+e.deltaY*camCfg.zoomSensitivity))},{passive:true});
}

export function getKeys(){ return keys; }
export function clearKeys(){ for(const k in keys)keys[k]=false; }

// ref 1105-1123
export function updateMovement(dt){
  const p=config.player;
  const SIZE=config.world.size, margin=p.boundaryMargin;
  let fx=0,fz=0;
  if(keys.w||keys.arrowup)fz+=1;
  if(keys.s||keys.arrowdown)fz-=1;
  if(keys.a||keys.arrowleft)fx-=1;
  if(keys.d||keys.arrowright)fx+=1;
  const mag=Math.hypot(fx,fz),spd=keys.shift?p.sprintSpeed:p.walkSpeed;
  if(mag>0){
    if(S.surveying){actions.cancelSurvey()}
    fx/=mag;fz/=mag;
    const cy=Math.cos(S.camYaw),sy=Math.sin(S.camYaw);
    const wx=cy*fz+sy*fx,wz=-sy*fz+cy*fx;
    S.px=Math.max(-SIZE/2+margin,Math.min(SIZE/2-margin,S.px+wx*spd*dt));
    S.pz=Math.max(-SIZE/2+margin,Math.min(SIZE/2-margin,S.pz+wz*spd*dt));
    S.heading=Math.atan2(wx,wz);S.speed+=(spd-S.speed)*p.acceleration;
    S.bob+=dt*(keys.shift?p.bobRateRun:p.bobRateWalk);
    if(!S.mouse){const want=Math.atan2(-wz,wx);
      let dd=((want-S.camYaw+Math.PI*3)%(Math.PI*2))-Math.PI;
      S.camYaw+=dd*Math.min(1,dt*config.player.camera.autoTurnRate)}
  }else S.speed+=(0-S.speed)*p.deceleration;
}

// ref 1179-1194
export function updateCamera(dt){
  const camCfg=config.player.camera;
  const gy=heightAt(S.px,S.pz);
  const player=getPlayer(), hands=getHands();
  if(S.fp){
    player.visible=false;
    const k=Math.min(1,S.speed/config.gait.speedNormaliser);
    cam.position.set(S.px+Math.cos(S.bob*.5)*.02*k,gy+camCfg.firstPersonEyeHeight+Math.sin(S.bob)*.035*k,S.pz);
    const dir=new THREE.Vector3(Math.cos(S.camYaw),Math.sin(-S.camPitch)*1.25,-Math.sin(S.camYaw)); // TODO(lead): 1.25 pitch-look multiplier not in config
    cam.lookAt(cam.position.clone().add(dir));
    hands.rotation.x=Math.sin(S.bob*.5)*.05*k;
    hands.position.y=-Math.abs(Math.sin(S.bob))*.012*k;
  }else{
    player.visible=true;
    const d2=S.camDist,ph=S.camPitch;
    const ox=Math.cos(S.camYaw)*Math.cos(ph)*d2,oz=-Math.sin(S.camYaw)*Math.cos(ph)*d2;
    const tx=S.px-ox,tz=S.pz-oz,ty=gy+Math.sin(ph)*d2+camCfg.thirdPersonHeightOffset;
    cam.position.set(tx,Math.max(ty,heightAt(tx,tz)+camCfg.thirdPersonMinClearance),tz);
    cam.lookAt(S.px,gy+camCfg.thirdPersonLookHeight,S.pz);
  }
}
