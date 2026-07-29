// player/controller.js — input listeners, movement integration, and camera follow.
// Ported from the reference input block (ref 665-689, EXCLUDING the .tab click
// listener at 690-695 which belongs to ui/panels), movement (ref 1105-1123) and
// camera (ref 1179-1194). Zero behaviour change.

let config, story;
let THREE, S, cam, getPlayer, getHands, heightAt, toast, visorEl, actions;

const keys={};
let drag=false,lx=0,ly=0;

// The thumb stick, when there is one. It reports its own speed because there is
// no shift key on a phone: pushing past mobile.stick.sprintAt is the sprint.
const stick={x:0,z:0,on:false,sprint:false};
export function setStick(x,z,sprint){
  stick.x=x; stick.z=z; stick.sprint=!!sprint;
  stick.on=(x!==0||z!==0);
}
// Looking, from whatever is doing the looking. The mouse path passes its own
// sensitivities; touch passes the mobile ones, which are a little higher because
// a thumb travels less than a mouse.
export function applyLook(dx,dy,lookSens,pitchSens){
  const c=config.player.camera;
  S.mouse=true;
  S.camYaw-=dx*(lookSens||c.lookSensitivity);
  S.camPitch=Math.max(c.minPitch,Math.min(c.maxPitch,S.camPitch+dy*(pitchSens||c.pitchSensitivity)));
}

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
  });
  addEventListener("keyup",e=>{keys[e.key.toLowerCase()]=false});
  addEventListener("mousedown",e=>{if(e.target.tagName==="CANVAS"&&!document.querySelector(".overlay.on")){drag=true;lx=e.clientX;ly=e.clientY}});
  addEventListener("mouseup",()=>drag=false);
  addEventListener("mousemove",e=>{if(!drag)return;
    applyLook(e.clientX-lx,e.clientY-ly);
    lx=e.clientX;ly=e.clientY});
}

export function getKeys(){ return keys; }
export function clearKeys(){ for(const k in keys)keys[k]=false; }

// Movement. There is no boundary clamp anywhere any more: the canyon holds you
// because rock is genuinely in the way. A step onto ground steeper than
// player.maxClimbGrade is refused, and then retried on each axis alone so that
// walking into a wall at an angle slides you along it instead of stopping you
// dead. Worst case that is three heightAt calls a frame.
export function updateMovement(dt){
  const p=config.player;
  let fx=0,fz=0,running=keys.shift;
  if(stick.on){ fx=stick.x; fz=stick.z; running=stick.sprint; }
  else{
    if(keys.w||keys.arrowup)fz+=1;
    if(keys.s||keys.arrowdown)fz-=1;
    if(keys.a||keys.arrowleft)fx-=1;
    if(keys.d||keys.arrowright)fx+=1;
  }
  const mag=Math.hypot(fx,fz),spd=running?p.sprintSpeed:p.walkSpeed;
  if(mag>0){
    if(S.surveying){actions.cancelSurvey()}
    fx/=mag;fz/=mag;
    const cy=Math.cos(S.camYaw),sy=Math.sin(S.camYaw);
    const wx=cy*fz+sy*fx,wz=-sy*fz+cy*fx;
    const dx=wx*spd*dt, dz=wz*spd*dt;
    const y0=heightAt(S.px,S.pz);
    const walkable=(nx,nz)=>{
      const run=Math.hypot(nx-S.px,nz-S.pz);
      if(run<1e-6)return true;
      return (heightAt(nx,nz)-y0)/run <= p.maxClimbGrade;
    };
    if(walkable(S.px+dx,S.pz+dz)){S.px+=dx;S.pz+=dz}
    else if(walkable(S.px+dx,S.pz)){S.px+=dx}          // slide along the wall
    else if(walkable(S.px,S.pz+dz)){S.pz+=dz}
    S.heading=Math.atan2(wx,wz);S.speed+=(spd-S.speed)*p.acceleration;
    S.bob+=dt*(running?p.bobRateRun:p.bobRateWalk);
    if(!S.mouse){const want=Math.atan2(-wz,wx);
      let dd=((want-S.camYaw+Math.PI*3)%(Math.PI*2))-Math.PI;
      S.camYaw+=dd*Math.min(1,dt*config.player.camera.autoTurnRate)}
  }else S.speed+=(0-S.speed)*p.deceleration;
}

// The camera. There is only one now: you are inside the helmet, and the visor
// vignette and the gloves are the only body you get. rig.js still builds the
// figure and gait.js still drives it — S.bob times the footfalls and the head
// bob — the body simply never renders.
export function updateCamera(dt){
  const camCfg=config.player.camera;
  const gy=heightAt(S.px,S.pz);
  getPlayer().visible=false;
  const k=Math.min(1,S.speed/config.gait.speedNormaliser);
  cam.position.set(S.px+Math.cos(S.bob*.5)*.02*k,gy+camCfg.firstPersonEyeHeight+Math.sin(S.bob)*.035*k,S.pz);
  const dir=new THREE.Vector3(Math.cos(S.camYaw),Math.sin(-S.camPitch)*1.25,-Math.sin(S.camYaw)); // TODO(lead): 1.25 pitch-look multiplier not in config
  cam.lookAt(cam.position.clone().add(dir));
  const hands=getHands();
  hands.rotation.x=Math.sin(S.bob*.5)*.05*k;
  hands.position.y=-Math.abs(Math.sin(S.bob))*.012*k;
}
