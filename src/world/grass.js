// world/grass.js — the instanced grass band that follows the dawn line.
//
// Ported verbatim from the reference (lines 458-504, plus the downgrade at 1100,
// the refill check at 1126, and the wind uniform at 1177). The blade geometry and
// the wind shader are art and stay inline. Zero behaviour change.

let THREE, scene, rand, heightAt, dawnX, S, config;
let LX, LZ;
let grass, gShader=null;
let GRASS_MAX;

export function initGrass(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  heightAt = deps.heightAt; dawnX = deps.dawnX; S = deps.S;
  config = cfg;
  GRASS_MAX = config.grass.maxBlades;
  LX = config.world.lengthX || config.world.size;
  LZ = config.world.widthZ || config.world.size;
}

function bladeGeometry(){
  const ys=[0,.30,.60,.85,1],ws=[.048,.040,.030,.017,0],p=[],idx=[];
  for(let i=0;i<ys.length;i++)p.push(-ws[i],ys[i],0, ws[i],ys[i],0);
  for(let i=0;i<ys.length-1;i++){const a=i*2;idx.push(a,a+2,a+1, a+1,a+2,a+3)}
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  g.setIndex(idx);g.computeVertexNormals();return g;
}

// GLSL wants "1.0", never "1" — config numbers go into the shader through these.
const f = n => Number(n).toFixed(5);
const v3 = a => `vec3(${f(a[0])},${f(a[1])},${f(a[2])})`;

export function buildGrass(){
  const C=config.grass.colour;
  const mat=new THREE.MeshLambertMaterial({color:Number(C.material),side:THREE.DoubleSide});
  mat.onBeforeCompile=sh=>{sh.uniforms.uT={value:0};
    sh.vertexShader="uniform float uT;\nvarying float vBladeY;\n"+sh.vertexShader.replace("#include <begin_vertex>",
    `#include <begin_vertex>
     vBladeY=position.y;
     float bk=pow(max(transformed.y,0.0),2.0);
     #ifdef USE_INSTANCING
       float ph=instanceMatrix[3][0]*0.11+instanceMatrix[3][2]*0.083;
     #else
       float ph=0.0;
     #endif
     transformed.x+=sin(uT*1.9+ph)*0.16*bk;
     transformed.z+=cos(uT*1.3+ph*1.4)*0.10*bk;`);
    // root-to-tip shading. The bottom of a blade sits in the shade of the blades
    // around it; without this the band reads as flat green paper from a distance.
    sh.fragmentShader="varying float vBladeY;\n"+sh.fragmentShader.replace("#include <color_fragment>",
    `#include <color_fragment>
     diffuseColor.rgb*=mix(${v3(C.root)},vec3(1.0),clamp(vBladeY/max(${f(C.rootHeight)},0.001),0.0,1.0));`);
    gShader=sh};
  grass=new THREE.InstancedMesh(bladeGeometry(),mat,GRASS_MAX);
  grass.frustumCulled=false;scene.add(grass);refillGrass(S.t);
}

function refillGrass(t){
  const c=dawnX(t)+config.grass.bandOffset;S.grassAt=dawnX(t);
  const m=new THREE.Matrix4(),q=new THREE.Quaternion(),
        v=new THREE.Vector3(),sc=new THREE.Vector3(),col=new THREE.Color();
  let n=0;
  for(let i=0;i<GRASS_MAX*4&&n<GRASS_MAX;i++){                       // TODO(lead): *4 loop cap not in config
    // the world is a strip: the band's width is measured along the journey (x) and
    // the scatter across it (z), so these are two different world dimensions now
    const x=c+(rand()-.5)*config.grass.spawnWidth,z=(rand()-.5)*LZ*.97;   // TODO(lead): .97 z-fraction not in config
    if(x<-LX/2||x>LX/2)continue;
    if(rand()>Math.exp(-Math.pow((x-c)/config.grass.falloffSigma,2)))continue;
    v.set(x,heightAt(x,z)-.03,z);                                   // TODO(lead): -.03 y-offset not in config
    q.setFromAxisAngle(new THREE.Vector3(0,1,0),rand()*6.28);
    // knee height — a blade is a blade, not a tree
    const s=config.grass.minScale+rand()*config.grass.scaleRange;
    sc.set(s*(.85+rand()*.3),s*(.8+rand()*.55),s);                  // TODO(lead): scale-variance .85+rand*.3 / .8+rand*.55 not in config
    m.compose(v,q,sc);grass.setMatrixAt(n,m);
    // exactly one draw here, as in the reference — the blade tint jitter
    if(grass.setColorAt){const C=config.grass.colour,k=C.jitterBase+rand()*C.jitterRange;
      col.setRGB(C.tint[0]*k,C.tint[1]*k,C.tint[2]*k);grass.setColorAt(n,col)}
    n++;
  }
  grass.count=n;grass.instanceMatrix.needsUpdate=true;
  if(grass.instanceColor)grass.instanceColor.needsUpdate=true;
}

export function maybeRefill(t){
  if(Math.abs(dawnX(t)-S.grassAt)>config.grass.refillThreshold)refillGrass(t);
}

export function setWind(t){
  if(gShader)gShader.uniforms.uT.value=t;
}

// Render-only: the blades were all generated, we simply stop drawing some of
// them. Generation is untouched, so the world is identical on every device.
export function applyDowngrade(mult){
  const m = typeof mult === "number" ? mult : config.render.downgrade.grassMultiplier;
  grass.count=Math.max(1,Math.floor(grass.count*m));grass.instanceMatrix.needsUpdate=true;
}
