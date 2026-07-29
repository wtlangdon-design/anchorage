// player/gait.js — the walk cycle.  [pure: no THREE, no game state]
//
// poseFor(phase, speed, running) -> a pose of joint angles (radians):
//   { thighL, thighR, kneeL, kneeR, shoulderL, shoulderR, elbowL, elbowR,
//     torsoYaw, torsoPitch, torsoLift }
//
// This is the gait math lifted verbatim out of the reference animate loop, with
// the tunables read from config.gait. Two properties are load-bearing and pinned
// by gait.test.js: knees only ever flex forward (kneeL/kneeR >= 0), and the elbow
// keeps a permanent base bend (elbowBaseBend) so the arm never reads as a robot.

let G = null;
export function initGait(cfg){ G = cfg; }

export function poseFor(phase, speed, running){
  const k = Math.min(1, speed / G.speedNormaliser);
  const thigh = running ? G.thighRun : G.thighWalk;
  const knee = running ? G.kneeRun : G.kneeWalk;
  const shldr = running ? G.shoulderRun : G.shoulderWalk;
  const elbowSwing = running ? G.elbowSwingRun : G.elbowSwingWalk;
  return {
    thighL: Math.sin(phase) * thigh * k,
    thighR: Math.sin(phase + Math.PI) * thigh * k,
    kneeL: Math.max(0, Math.sin(phase + G.kneePhaseOffset)) * knee * k,
    kneeR: Math.max(0, Math.sin(phase + Math.PI + G.kneePhaseOffset)) * knee * k,
    shoulderL: -Math.sin(phase) * shldr * k,
    shoulderR: -Math.sin(phase + Math.PI) * shldr * k,
    elbowL: -(G.elbowBaseBend + Math.max(0, Math.sin(phase + G.elbowPhaseOffset)) * elbowSwing * k),
    elbowR: -(G.elbowBaseBend + Math.max(0, Math.sin(phase + Math.PI + G.elbowPhaseOffset)) * elbowSwing * k),
    torsoYaw: Math.sin(phase) * G.torsoYawAmount * k,
    torsoPitch: k * (running ? G.torsoPitchRun : G.torsoPitchWalk),
    torsoLift: Math.abs(Math.sin(phase)) * G.torsoLiftAmount * k
  };
}
