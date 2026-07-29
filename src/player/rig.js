// player/rig.js — the surveyor rig: third-person body, first-person hands, and
// the per-frame pose application. Geometry lifted verbatim from the reference
// (ref 598-663); applyPose assigns the angles gait.js already computed (ref 1162-1173).

let THREE, scene, cam, heightAt, S;
let player, hands, legL, legR, armL, armR;

export function initRig(config, story, deps){
  THREE = deps.THREE;
  scene = deps.scene;
  cam = deps.cam;
  heightAt = deps.heightAt;
  S = deps.S;
}

export function buildPlayer(){
  player=new THREE.Group();
  const suit=new THREE.MeshStandardMaterial({color:0xd7dbde,roughness:.62,metalness:.06});
  const dark=new THREE.MeshStandardMaterial({color:0x33383f,roughness:.55,metalness:.30});
  const visor=new THREE.MeshStandardMaterial({color:0x0b1017,roughness:.08,metalness:.85});
  const acc=new THREE.MeshStandardMaterial({color:0xE0793F,roughness:.6});
  const cast=o=>{o.castShadow=true;return o};

  const torsoPivot=new THREE.Group();player.add(torsoPivot);
  const t=cast(new THREE.Mesh(new THREE.CylinderGeometry(.29,.245,.62,16),suit));t.position.y=1.24;torsoPivot.add(t);
  const be=cast(new THREE.Mesh(new THREE.SphereGeometry(.265,16,12),suit));be.scale.set(1,.78,.86);be.position.y=.99;torsoPivot.add(be);
  const cl=cast(new THREE.Mesh(new THREE.CylinderGeometry(.155,.185,.12,14),dark));cl.position.y=1.60;torsoPivot.add(cl);
  const pk=cast(new THREE.Mesh(new THREE.CylinderGeometry(.21,.19,.56,12),dark));pk.scale.set(1,1,.62);pk.position.set(0,1.26,-.30);torsoPivot.add(pk);
  const st=new THREE.Mesh(new THREE.BoxGeometry(.075,.20,.02),acc);st.position.set(.20,1.34,.24);torsoPivot.add(st);
  const hm=cast(new THREE.Mesh(new THREE.SphereGeometry(.235,20,16),suit));hm.position.y=1.79;torsoPivot.add(hm);
  const vs=new THREE.Mesh(new THREE.SphereGeometry(.238,20,16,-1.0,2.0,.62,1.05),visor);vs.position.y=1.79;torsoPivot.add(vs);
  const hipBlock=cast(new THREE.Mesh(new THREE.SphereGeometry(.245,14,10),dark));
  hipBlock.scale.set(1,.72,.9);hipBlock.position.y=.83;player.add(hipBlock);

  // two-segment limb: upper rotates at the joint, lower rotates at knee/elbow
  const makeLimb=(uW1,uW2,uLen,lW1,lW2,lLen,jr,foot)=>{
    const hip=new THREE.Group();
    hip.add(cast(new THREE.Mesh(new THREE.SphereGeometry(jr,12,10),suit)));
    const up=cast(new THREE.Mesh(new THREE.CylinderGeometry(uW1,uW2,uLen,10),suit));
    up.position.y=-uLen/2;hip.add(up);
    const joint=cast(new THREE.Mesh(new THREE.SphereGeometry(uW2*1.12,12,10),suit));
    joint.position.y=-uLen;hip.add(joint);
    const lower=new THREE.Group();lower.position.y=-uLen;hip.add(lower);
    const lo=cast(new THREE.Mesh(new THREE.CylinderGeometry(lW1,lW2,lLen,10),suit));
    lo.position.y=-lLen/2;lower.add(lo);
    const end=cast(new THREE.Mesh(new THREE.SphereGeometry(lW2*1.1,10,8),suit));
    end.position.y=-lLen;lower.add(end);
    if(foot){const b=cast(new THREE.Mesh(new THREE.BoxGeometry(.17,.11,.31),dark));
      b.position.set(0,-lLen-.04,.06);lower.add(b)}
    hip.userData.lower=lower;
    return hip;
  };
  legL=makeLimb(.118,.100,.42,.098,.084,.40,.128,true);legL.position.set(.135,.86,0);player.add(legL);
  legR=makeLimb(.118,.100,.42,.098,.084,.40,.128,true);legR.position.set(-.135,.86,0);player.add(legR);
  armL=makeLimb(.086,.072,.32,.070,.060,.30,.098,false);armL.position.set(.335,1.46,0);torsoPivot.add(armL);
  armR=makeLimb(.086,.072,.32,.070,.060,.30,.098,false);armR.position.set(-.335,1.46,0);torsoPivot.add(armR);
  player.userData.torso=torsoPivot;

  const lamp=new THREE.PointLight(0xffe4bc,.7,20);lamp.position.set(0,1.72,.42);player.add(lamp);
  player.position.set(S.px,heightAt(S.px,S.pz),S.pz);scene.add(player);
}

export function buildHands(){
  hands=new THREE.Group();
  const suit=new THREE.MeshStandardMaterial({color:0xd6dade,roughness:.6,metalness:.05});
  const dark=new THREE.MeshStandardMaterial({color:0x2e333a,roughness:.5,metalness:.4});
  const lit=new THREE.MeshBasicMaterial({color:0x8FC6D4});
  const mkArm=sx=>{const g=new THREE.Group();
    const f=new THREE.Mesh(new THREE.CylinderGeometry(.042,.052,.30,10),suit);
    f.rotation.x=Math.PI/2.15;f.position.set(0,0,-.13);g.add(f);
    const c2=new THREE.Mesh(new THREE.CylinderGeometry(.055,.055,.035,12),dark);
    c2.rotation.x=Math.PI/2;c2.position.set(0,.01,-.27);g.add(c2);
    const gl=new THREE.Mesh(new THREE.SphereGeometry(.048,12,10),suit);
    gl.scale.set(1,.85,1.15);gl.position.set(0,-.01,.01);g.add(gl);
    g.position.set(sx,-.14,-.30);return g};
  const R=mkArm(.16),L=mkArm(-.17);
  const scan=new THREE.Mesh(new THREE.BoxGeometry(.10,.055,.15),dark);
  scan.position.set(0,.01,.05);R.add(scan);
  const face=new THREE.Mesh(new THREE.PlaneGeometry(.072,.032),lit);
  face.position.set(0,.030,.05);face.rotation.x=-Math.PI/2.4;R.add(face);
  hands.add(R);hands.add(L);hands.visible=false;cam.add(hands);scene.add(cam);
}

// Assign the joint angles gait.js already computed. No gait math lives here.
// (ref 1162-1173, values now read from `pose` instead of recomputed)
export function applyPose(pose){
  legL.rotation.x=pose.thighL; legR.rotation.x=pose.thighR;
  legL.userData.lower.rotation.x=pose.kneeL; legR.userData.lower.rotation.x=pose.kneeR;
  armL.rotation.x=pose.shoulderL; armR.rotation.x=pose.shoulderR;
  armL.userData.lower.rotation.x=pose.elbowL; armR.userData.lower.rotation.x=pose.elbowR;
  const torso=player.userData.torso;
  torso.rotation.y=pose.torsoYaw; torso.rotation.x=pose.torsoPitch; torso.position.y=pose.torsoLift;
}

export function getPlayer(){ return player; }
export function getHands(){ return hands; }
