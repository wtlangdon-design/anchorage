// world/sky.js — sky dome, sun disc, drifting dust, and sun glare sprites.
//
// Ported verbatim from the reference (lines 380-397, 421-451, 1195-1196).
// Shader source and every literal that isn't the sun direction / dust count are
// art, and stay inline. Zero behaviour change.

let THREE, scene, rand, config;
let SUNDIR;
let dust;

export function initSky(cfg, story, deps){
  THREE = deps.THREE; scene = deps.scene; rand = deps.rand;
  config = cfg;
  SUNDIR = { x:config.world.sunDirection.x, z:config.world.sunDirection.z };
}

export function buildSky(){
  const mat=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,fog:false,
    uniforms:{sd:{value:new THREE.Vector3(SUNDIR.x,.055,SUNDIR.z).normalize()}},
    vertexShader:`varying vec3 vP;void main(){vP=normalize(position);
      gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`varying vec3 vP;uniform vec3 sd;
      void main(){float up=clamp(vP.y*1.55+.05,0.,1.);
      float s=clamp(dot(normalize(vP),sd),0.,1.);
      vec3 c=mix(mix(vec3(.42,.375,.33),vec3(.13,.148,.19),smoothstep(0.,.30,up)),
                 vec3(.028,.042,.072),smoothstep(.26,.92,up));
      c+=vec3(1.,.78,.44)*pow(s,5.)*(1.-up*.70);
      c+=vec3(.90,.52,.26)*pow(s,1.5)*.46*(1.-up*.86);
      gl_FragColor=vec4(c,1.);}`});
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(4800,32,20),mat));
  const disc=new THREE.Mesh(new THREE.CircleGeometry(78,36),
    new THREE.MeshBasicMaterial({color:0xfff2d6,fog:false}));
  disc.position.set(4200,200,0);disc.lookAt(0,200,0);scene.add(disc);
}

/* drifting dust — cheap, and it does more for atmosphere than anything else here */
export function buildDust(){
  const N=config.render.dustCount,pos=new Float32Array(N*3);
  for(let i=0;i<N;i++){pos[i*3]=(rand()-.5)*180;pos[i*3+1]=rand()*26;pos[i*3+2]=(rand()-.5)*180}
  const g=new THREE.BufferGeometry();
  g.setAttribute("position",new THREE.BufferAttribute(pos,3));
  dust=new THREE.Points(g,new THREE.PointsMaterial({
    color:0xffd9a8,size:.16,transparent:true,opacity:.42,
    blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
  dust.frustumCulled=false;scene.add(dust);
}

/* glare around the low sun, sold with a couple of additive sprites */
function glareTexture(){
  const c=document.createElement("canvas");c.width=c.height=256;
  const x=c.getContext("2d");
  const g=x.createRadialGradient(128,128,0,128,128,128);
  g.addColorStop(0,"rgba(255,240,214,1)");
  g.addColorStop(.25,"rgba(255,206,150,.45)");
  g.addColorStop(1,"rgba(255,180,120,0)");
  x.fillStyle=g;x.fillRect(0,0,256,256);
  return new THREE.CanvasTexture(c);
}
export function buildGlare(){
  const tex=glareTexture();
  [[1500,.62],[900,.34],[420,.22]].forEach(([s,o])=>{
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,opacity:o,
      blending:THREE.AdditiveBlending,depthWrite:false,depthTest:false,fog:false}));
    sp.scale.set(s,s,1);sp.position.set(4200,200,0);scene.add(sp);
  });
}

export function updateDust(px, pz, gy, t){
  if(dust){dust.position.set(Math.round(px/40)*40,gy,Math.round(pz/40)*40);
    dust.rotation.y=t*.02}
}
