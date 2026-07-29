// world/terrain.js — the ground: heightfield, terrain mesh, far hills.
//
// Ported verbatim from the reference (lines 186-198, 398-420, 452-457).
// heightAt(x,z) is the single source of ground elevation; every other world
// module imports it (via deps) rather than recomputing. Zero behaviour change.

let THREE, scene, rand, fbm, config;
let SIZE, SEG, RIDGE, BASIN;

export function initTerrain(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand; fbm = deps.fbm;
  config = cfg;
  SIZE = config.world.size; SEG = config.world.segments;
  const r = config.terrain.ridge;
  RIDGE = { x:r.x, z:r.z, len:r.length, ang:r.angle, h:r.height, w:r.width, falloffPower:r.falloffPower };
  const b = config.terrain.basin;
  BASIN = { x:b.x, z:b.z, r:b.radius, d:b.depth };
}

function ridgeH(x,z){const dx=x-RIDGE.x,dz=z-RIDGE.z,ca=Math.cos(RIDGE.ang),sa=Math.sin(RIDGE.ang);
  const al=dx*ca+dz*sa,ac=-dx*sa+dz*ca;
  return RIDGE.h*Math.max(0,1-Math.pow(Math.abs(al)/RIDGE.len,RIDGE.falloffPower))*Math.exp(-(ac*ac)/(2*RIDGE.w*RIDGE.w))}

export function heightAt(x,z){
  let h=fbm(x*config.terrain.baseFrequency,z*config.terrain.baseFrequency,config.terrain.octaves)*config.terrain.baseAmplitude
    +fbm(x*config.terrain.detailFrequency+config.terrain.detailOffset.x,z*config.terrain.detailFrequency+config.terrain.detailOffset.z,config.terrain.detailOctaves)*config.terrain.detailAmplitude
    +ridgeH(x,z);
  const bd=Math.hypot(x-BASIN.x,z-BASIN.z);
  h-=BASIN.d*Math.exp(-(bd*bd)/(2*BASIN.r*BASIN.r));
  return h;
}

// The ground colour is baked into the mesh here, once, at load. It costs nothing
// per frame — all of it is vertex data by the time the game is running.
export function buildTerrain(){
  const P=config.terrain.palette, D=P.slopeSampleDistance;
  const geo=new THREE.PlaneGeometry(SIZE,SIZE,SEG,SEG);geo.rotateX(-Math.PI/2);
  const pos=geo.attributes.position,col=[];
  for(let i=0;i<pos.count;i++){
    const x=pos.getX(i),z=pos.getZ(i),y=heightAt(x,z);pos.setY(i,y);
    // slope: steep ground shows rock, flat ground holds ash
    const gx=heightAt(x+D,z)-heightAt(x-D,z), gz=heightAt(x,z+D)-heightAt(x,z-D);
    const slope=Math.min(1,Math.hypot(gx,gz)/P.slopeScale);
    const dust=fbm(x*P.dustFrequency,z*P.dustFrequency,2)*.5+.5;
    const fine=fbm(x*P.fineFrequency,z*P.fineFrequency,2)*.5+.5;
    // one very slow drift across the whole map, so a wide view is not one flat tone
    const broad=fbm(x*P.broadFrequency+7,z*P.broadFrequency-3,P.broadOctaves)*.5+.5;
    let r=P.ash[0]+dust*P.dustGain[0]+fine*P.fineGain[0]+broad*P.broadWarm[0];
    let g=P.ash[1]+dust*P.dustGain[1]+fine*P.fineGain[1]+broad*P.broadWarm[1];
    let b=P.ash[2]+dust*P.dustGain[2]+fine*P.fineGain[2]+broad*P.broadWarm[2];
    // exposed rock, cooler and darker
    r=r*(1-slope*P.rockBlend)+P.rock[0]*slope;
    g=g*(1-slope*P.rockBlend)+P.rock[1]*slope;
    b=b*(1-slope*P.rockBlend)+P.rock[2]*slope;
    const hi=Math.min(1,Math.max(0,(y-P.highStart)/P.highRange));
    r+=hi*P.highLift[0];g+=hi*P.highLift[1];b+=hi*P.highLift[2];
    col.push(r,g,b);
  }
  geo.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
  geo.computeVertexNormals();
  const m=new THREE.Mesh(geo,new THREE.MeshStandardMaterial(
    {vertexColors:true,roughness:.96,metalness:.0}));
  m.receiveShadow=true;scene.add(m);
}

export function buildFarHills(){
  const fh=config.terrain.farHills;
  const mat=new THREE.MeshStandardMaterial({color:0x443c34,roughness:1});
  for(let i=0;i<fh.count;i++){const a=rand()*6.28,d=fh.minDistance+rand()*fh.distanceRange,h=fh.minHeight+rand()*fh.heightRange,r=fh.minRadius+rand()*fh.radiusRange;
    const c=new THREE.Mesh(new THREE.ConeGeometry(r,h,7+((rand()*4)|0)),mat);
    c.position.set(Math.cos(a)*d,h*.34,Math.sin(a)*d);c.rotation.y=rand()*3;scene.add(c)}
}
