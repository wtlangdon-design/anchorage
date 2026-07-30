// world/fauna.js — the striders (the herd that walks the corridor) and the dens.
//
// Ported from the reference (lines 345-346, 505-532, 593-596). buildDens is
// draw-set #2: main calls it right after initNoise, before any build. Geometry,
// materials and offsets are art and stay inline.
//
// THE HERD IS ON THE ROUTE. It used to be a band at a fixed z, laid across a square
// world; in a corridor that put every animal inside the rock or off the map. They
// now walk the corridor itself: their x is pinned to the dawn line, exactly as it
// always was, and their z is the corridor's centreline AT that x plus a lateral
// spread. The striders migrate to stay ahead of the heat and so does the player —
// they are going the same way for the same reason, and the biosphere is surveyed by
// catching up to them rather than by crossing their path.

import * as terrainPath from "./terrain.js";

let THREE, scene, rand, heightAt, dawnX, tempAt, config;
const DENS=[];
const strider=[];

export function initFauna(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  heightAt = deps.heightAt; dawnX = deps.dawnX; tempAt = deps.tempAt;
  config = cfg;
}

export function buildDens(){
  for(let i=0;i<config.ashwaiters.denCount;i++)
    DENS.push({x:config.ashwaiters.denSpreadX.min+rand()*config.ashwaiters.denSpreadX.range,
               z:config.ashwaiters.denSpreadZ.min+rand()*config.ashwaiters.denSpreadZ.range});
}

export function getDens(){return DENS;}

export function buildStriders(){
  const N=config.striders.count,mat=new THREE.MeshStandardMaterial({color:0x2a241c,roughness:.85});
  const parts=[
    {g:new THREE.SphereGeometry(3.0,10,7),sc:[1.7,.72,.78],off:[0,8.6,0]},
    {g:new THREE.CylinderGeometry(.40,.26,8.6,6),sc:[1,1,1],off:[3.4,4.3,1.6]},
    {g:new THREE.CylinderGeometry(.40,.26,8.6,6),sc:[1,1,1],off:[3.4,4.3,-1.6]},
    {g:new THREE.CylinderGeometry(.40,.26,8.6,6),sc:[1,1,1],off:[-3.4,4.3,1.6]},
    {g:new THREE.CylinderGeometry(.40,.26,8.6,6),sc:[1,1,1],off:[-3.4,4.3,-1.6]},
    {g:new THREE.CylinderGeometry(.55,.95,6.4,6),sc:[1,1,1],off:[5.6,12.0,0]},
    {g:new THREE.SphereGeometry(.85,8,6),sc:[1.5,.8,.8],off:[6.6,15.0,0]}];
  // `lat` is a fraction of the corridor's half-width, not an absolute z: the herd
  // has to fit whatever the corridor is doing where it happens to be standing.
  const data=[];
  for(let i=0;i<N;i++)data.push({dx:(rand()-.5)*config.striders.spreadX,
    lat:(rand()-.5)*2*config.striders.lateralFraction,ph:rand()*6.28,sp:.8+rand()*.5});
  parts.forEach(p=>{const im=new THREE.InstancedMesh(p.g,mat,N);
    im.userData={off:p.off,sc:p.sc,data};im.frustumCulled=false;strider.push(im);scene.add(im)});
  updateStriders(0);
}

// Two clocks, and the herd needs both. Where the band IS is pinned to the dawn
// line, which is mission time — so before the clock starts the herd holds its
// ground instead of drifting west. Whether the herd is MOVING is animation, so the
// bob rides the wall clock and they keep walking on the spot through the grace
// period. animT defaults to t so a caller that only has one clock still works.
export function updateStriders(t, animT){
  if(animT === undefined) animT = t;
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),
        v=new THREE.Vector3(),sc=new THREE.Vector3();
  const cx=dawnX(t)+config.striders.bandOffset;
  strider.forEach(im=>{const {off,sc:sk,data}=im.userData;
    for(let i=0;i<data.length;i++){const d=data[i];
      const x=cx+d.dx,bob=Math.sin(animT*config.striders.bobRate*d.sp+d.ph)*config.striders.bobAmplitude;
      // where the corridor is at THIS animal's x, this frame
      const p=terrainPath.pathPlan(x);
      const z=p.centre+d.lat*p.halfWidth;
      v.set(x+off[0],heightAt(x,z)+off[1]+bob,z+off[2]);
      // they face along the corridor, which is +x, which is the way the player is going
      q.setFromAxisAngle(new THREE.Vector3(0,1,0),-Math.PI/2);
      sc.set(sk[0],sk[1],sk[2]);m.compose(v,q,sc);im.setMatrixAt(i,m)}
    im.instanceMatrix.needsUpdate=true});
}

// Render-only, as with the grass: every strider was generated and still walks in
// the simulation, the herd is just drawn thinner.
export function applyDowngrade(mult){
  const n = Math.max(1, Math.floor(config.striders.count * mult));
  strider.forEach(im => { im.count = n; });
}

export function buildDenMeshes(){
  DENS.forEach(d=>{const y=heightAt(d.x,d.z);
    const m=new THREE.Mesh(new THREE.SphereGeometry(2.6,10,6),
      new THREE.MeshStandardMaterial({color:0x3b352d,roughness:.98}));
    m.scale.set(1.5,.36,1.2);m.position.set(d.x,y+.3,d.z);m.castShadow=true;m.receiveShadow=true;scene.add(m)});
}
