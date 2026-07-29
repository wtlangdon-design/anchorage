// world/noise.js — seeded PRNG + value-noise fbm.  [pure: no THREE]
//
// The whole world is generated from ONE mulberry generator, seeded once. Every
// module that needs randomness draws from rand() here — nothing gets its own
// generator. See HANDOFF's "THE TRAP": the order those draws happen in is what
// keeps the world stable, and that order is orchestrated by main.js.

export function mulberry(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
  t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}

let rnd=null;
const perm=new Uint8Array(512);

// Draw-set #1. Creates the single generator and immediately draws the 255-swap
// permutation shuffle — the two adjacent statements from the reference build,
// kept adjacent. Nothing may draw from rand() before this runs.
export function initNoise(seed){
  rnd=mulberry(seed);
  const p=[...Array(256).keys()];
  for(let i=255;i>0;i--){const j=(rnd()*(i+1))|0;[p[i],p[j]]=[p[j],p[i]];}
  for(let i=0;i<512;i++)perm[i]=p[i&255];
}

// The one shared draw. World generation, grass refills and the naming placeholder
// all route through this so they consume the same stream in the same order.
export function rand(){return rnd();}

function fade(t){return t*t*t*(t*(t*6-15)+10);}
function grd(h,x,y){const u=(h&1)?-x:x,v=(h&2)?-y:y;return u+v;}
export function noise2(x,y){const X=Math.floor(x)&255,Y=Math.floor(y)&255;x-=Math.floor(x);y-=Math.floor(y);
  const u=fade(x),v=fade(y),A=perm[X]+Y,B=perm[X+1]+Y,l=(a,b,t)=>a+t*(b-a);
  return l(l(grd(perm[A],x,y),grd(perm[B],x-1,y),u),
           l(grd(perm[A+1],x,y-1),grd(perm[B+1],x-1,y-1),u),v);}
export function fbm(x,y,o=5){let s=0,a=.5,f=1;for(let i=0;i<o;i++){s+=a*noise2(x*f,y*f);a*=.5;f*=2;}return s;}
