// world/props.js — the placed things: site markers, Meridian camps, graves,
// the shelter, and the scattered rocks.
//
// Ported verbatim from the reference (lines 533-592). The den meshes at 593-596
// belong to fauna.js and are NOT here. Every mesh dimension, colour and position
// is art and stays inline. Zero behaviour change.

let THREE, scene, rand, heightAt, fbm, config;

export function initProps(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  heightAt = deps.heightAt; fbm = deps.fbm;
  config = cfg;
}

function roughRock(s){
  const g=new THREE.DodecahedronGeometry(s,1);
  const p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const x=p.getX(i),y=p.getY(i),z=p.getZ(i);
    const n=1+fbm(x*1.7+11,z*1.7-4,3)*.55+fbm(y*2.3,x*2.3,2)*.30;
    p.setXYZ(i,x*n,y*n*.82,z*n);
  }
  g.computeVertexNormals();return g;
}

export function buildPlaces(){
  const SIZE=config.world.size;
  const CAMPS=[config.camps.c1,config.camps.c2,config.camps.c3,config.camps.c4,config.camps.c5];
  const GRAVES=[config.graves.g1,config.graves.g2,config.graves.g3,config.graves.g4,config.graves.g5];
  const LAST=config.shelter;
  const rockM=new THREE.MeshStandardMaterial({color:0x4d453b,roughness:.92,metalness:.02});
  const metal=new THREE.MeshStandardMaterial({color:0x686c72,roughness:.55,metalness:.55});
  const plate=new THREE.MeshStandardMaterial({color:0xa4aab0,roughness:.42,metalness:.7});
  const put=o=>{o.castShadow=true;o.receiveShadow=true;scene.add(o);return o};
  {const c=config.sites.water,y=heightAt(c.x,c.z);
   const w=new THREE.Mesh(new THREE.CircleGeometry(14,30),
     new THREE.MeshBasicMaterial({color:0xbcd8e0,transparent:true,opacity:.55}));
   w.rotation.x=-Math.PI/2;w.position.set(c.x,y+.4,c.z);scene.add(w)}
  {const c=config.sites.season,y=heightAt(c.x,c.z);
   const f=new THREE.Mesh(new THREE.CircleGeometry(78,30),
     new THREE.MeshLambertMaterial({color:0xdfe9ef,transparent:true,opacity:.72}));
   f.rotation.x=-Math.PI/2;f.position.set(c.x,y+.25,c.z);scene.add(f)}
  {const c=config.sites.soil;
   for(let i=0;i<44;i++){const a=rand()*6.28,d=rand()*76,s=.5+rand()*1.2;   // TODO(lead): soil rock count 44 and 76/.5/1.2 not in config
     const b=new THREE.Mesh(roughRock(s),
       new THREE.MeshStandardMaterial({color:0x726757,roughness:.95}));
     const x=c.x+Math.cos(a)*d,z=c.z+Math.sin(a)*d;
     b.position.set(x,heightAt(x,z)+s*.3,z);b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}}
  CAMPS.forEach((cp,i)=>{
    const y=heightAt(cp.x,cp.z),n=Math.max(1,4-Math.floor(i*.7));   // TODO(lead): hut-count formula max(1,4-floor(i*.7)) not in config
    for(let k=0;k<n;k++){const h=new THREE.Mesh(new THREE.BoxGeometry(6.5,3.2,4.8),metal);
      h.position.set(cp.x+k*8-8,y+1.35,cp.z+(k%2)*4.2);h.rotation.y=(rand()-.5)*.5;put(h)}
    const mast=new THREE.Mesh(new THREE.CylinderGeometry(.16,.30,20+i*2.5,7),metal);
    mast.position.set(cp.x+5,y+10+i*1.25,cp.z-7);put(mast);
    const dish=new THREE.Mesh(new THREE.SphereGeometry(1.9,14,10,0,6.28,0,1.1),
      new THREE.MeshLambertMaterial({color:0x7e838a,side:THREE.DoubleSide}));
    dish.position.set(cp.x+5,y+20+i*2.5,cp.z-7);dish.rotation.x=-.85;put(dish)});
  GRAVES.forEach(g=>{const y=heightAt(g.x,g.z);
    for(let i=0;i<5;i++){const s=.9-i*.13;   // TODO(lead): 5 cairn rocks per grave and .9-i*.13 not in config
      const b=new THREE.Mesh(roughRock(s*.4),rockM);
      b.position.set(g.x+(rand()-.5)*.5,y+.2+i*.3,g.z+(rand()-.5)*.5);
      b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}
    const p=new THREE.Mesh(new THREE.BoxGeometry(.62,.78,.05),plate);
    p.position.set(g.x,y+1.75,g.z);p.rotation.y=.3;put(p);
    const post=new THREE.Mesh(new THREE.CylinderGeometry(.05,.05,2.1,6),metal);
    post.position.set(g.x,y+1.05,g.z);put(post)});
  {const y=heightAt(LAST.x,LAST.z);
   const h=new THREE.Mesh(new THREE.BoxGeometry(6,3.4,5),metal);
   h.position.set(LAST.x,y+1.5,LAST.z);put(h);
   const mast=new THREE.Mesh(new THREE.CylinderGeometry(.14,.26,15,7),metal);
   mast.position.set(LAST.x+4,y+7.5,LAST.z-5);put(mast);
   const lamp=new THREE.PointLight(0x8FC6D4,1.5,60);
   lamp.position.set(LAST.x,y+3.4,LAST.z);scene.add(lamp);
   const bulb=new THREE.Mesh(new THREE.SphereGeometry(.28,10,8),
     new THREE.MeshBasicMaterial({color:0x8FC6D4}));
   bulb.position.set(LAST.x,y+3.4,LAST.z);scene.add(bulb)}
  for(let i=0;i<config.terrain.scatterRocks.count;i++){const x=(rand()-.5)*SIZE*config.terrain.scatterRocks.spreadFraction,z=(rand()-.5)*SIZE*config.terrain.scatterRocks.spreadFraction,s=config.terrain.scatterRocks.minScale+rand()*config.terrain.scatterRocks.scaleRange;
    const b=new THREE.Mesh(roughRock(s),rockM);
    b.position.set(x,heightAt(x,z)+s*.4,z);b.rotation.set(rand()*3,rand()*3,rand()*3);put(b)}
}
