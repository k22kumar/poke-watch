// Writes tools/camframescenes.json: the third-person composition scenes (docs/THIRD_PERSON.md "Composition"), for
// `node tools/cap.mjs <private build> tools/camframescenes.json <out>`. usage: node tools/camframescenes.gen.mjs
//
// Every shot is followed by an `eval` of camtest.box(): the on-screen box of the sprite frame actually drawn
// (Renderer.subjectBox(): screen fractions, depth inside the keep-out in degrees, the dissolve) and the rig's arm.
//   open-<species>   open ground: idle, strafing both ways, reversing, firing, hurt, looking 30° up and 30 / 60 / 89° down
//   hd-<species>     open ground at 1280 x 720 (the HUD is laid out in fixed pixels, so the 640 x 360 scenes show its
//                    move bar twice as large against the picture as a real window does), with camtest.hud(): the move
//                    bar's box as screen fractions
//   wall-<species>   solid rock right behind, on the right, and both (a corner), then under a deck
//   forest / cave    walking through trees and through Mt. Moon
//   steps-<species>  frame strips walking forward over a 0.5 m tile step, up and then down (the stair smoothing)
//   shot-<species>   a target on the crosshair, fired at (frame strip)
import fs from 'node:fs';

// the page-side helpers, installed by each scene's first eval
const HELPERS = `(()=>{window.camtest={
box(){const r=pokewatch.renderer,b=r.subjectBox(),g=r.rig;return b&&{st:b.state,row:b.row,L:+b.screen.left.toFixed(3),R:+b.screen.right.toFixed(3),T:+b.screen.top.toFixed(3),B:+b.screen.bottom.toFixed(3),depth:+b.depth.toFixed(1),fade:+b.fade.toFixed(2),boom:+g.boomUsed.toFixed(2),gap:+g.lensGap.toFixed(2),eyeY:+(g.eye[1]-pokewatch.ctx.player.y).toFixed(2)}},
yaw(y){const r=pokewatch.renderer;r.look(r.rig.yaw-y,0);return +r.rig.yaw.toFixed(3)},
pitch(deg){const r=pokewatch.renderer,g=r.rig;r.look(0,(deg-(pokewatch.chase.aimPitch.neutral+g.userPitch))*Math.PI/180);return +(pokewatch.chase.aimPitch.neutral+g.userPitch).toFixed(1)},
put(i,j){const c=pokewatch.ctx,W=c.world,P=c.player;P.x=P.px=i-W.half+0.5;P.z=P.pz=j-W.half+0.5;P.y=P.py=W.height(P.x,P.z);P.vx=P.vz=P.vy=0;pokewatch.renderer.snapCamera(c);return [i,j,+P.y.toFixed(2)]},
rock(k,q){const c=pokewatch.ctx,W=c.world,M=W.map;if(q<0||q>=M.w*M.h)return true;return (M.wall[q]===1&&(!W.wallTop||W.wallTop[q]===Infinity))||(!M.wall[q]&&!M.stairs[q]&&M.elev[q]-M.elev[k]>=2)},
open(k,q){const M=pokewatch.ctx.world.map;return q>=0&&q<M.w*M.h&&!M.wall[q]&&!M.stairs[q]&&M.terrain[q]===M.terrain[k]&&Math.abs(M.elev[q]-M.elev[k])<0.1&&!(M.over&&M.over[q]>0)},
find(dirs,gap,room){const c=pokewatch.ctx,W=c.world,M=W.map,w=M.w,sx=M.spawn[0],sy=M.spawn[1];let best=-1,bd=1e9;
for(let j=8;j<M.h-8;j++)for(let i=8;i<w-8;i++){const k=j*w+i;if(M.wall[k]||M.stairs[k]||M.terrain[k]!==M.terrain[sy*w+sx]||(M.over&&M.over[k]>0))continue;let ok=true;
for(const[dx,dy]of dirs){for(let s=1;s<gap&&ok;s++)if(!this.open(k,(j+dy*s)*w+i+dx*s))ok=false;if(ok&&!this.rock(k,(j+dy*gap)*w+i+dx*gap))ok=false;for(let s=1;s<=room&&ok;s++)if(!this.open(k,(j-dy*s)*w+i-dx*s))ok=false;if(!ok)break}
if(!ok)continue;const d=(i-sx)**2+(j-sy)**2;if(d<bd){bd=d;best=k}}
return best<0?null:[best%w,(best/w)|0]},
wallBehind(gap){const t=this.find([[0,1]],gap,5);if(!t)return 'no spot';this.put(t[0],t[1]);return {tile:t,yaw:this.yaw(Math.PI)}},
wallRight(gap){const t=this.find([[1,0]],gap,5);if(!t)return 'no spot';this.put(t[0],t[1]);return {tile:t,yaw:this.yaw(Math.PI)}},
corner(gap){const t=this.find([[0,1],[1,0]],gap,4);if(!t)return 'no spot';this.put(t[0],t[1]);return {tile:t,yaw:this.yaw(Math.PI)}},
deck(){const c=pokewatch.ctx,W=c.world,M=W.map;let best=-1;for(let k=0;k<M.w*M.h;k++){if(M.over&&M.over[k]>0&&!M.wall[k]&&M.terrain[k]!==6){const i=k%M.w,j=(k/M.w)|0;let open=0;for(const[dx,dy]of[[0,1],[0,-1],[1,0],[-1,0]]){const q=(j+dy)*M.w+i+dx;if(!M.wall[q])open++}if(open>=3){best=k;break}}}if(best<0)return 'no deck';const P=c.player;P.x=P.px=best%M.w-W.half+0.5;P.z=P.pz=((best/M.w)|0)-W.half+0.5;P.y=P.py=W.height(P.x,P.z,0);pokewatch.renderer.snapCamera(c);return {deck:best,over:M.over[best],y:P.y}},
step(rise,down){const c=pokewatch.ctx,W=c.world,M=W.map,w=M.w;const lvl=(k,q)=>q>=0&&!M.wall[q]&&!M.stairs[q]&&Math.abs(M.elev[q]-M.elev[k])<0.02&&!(M.over&&M.over[q]>0);
for(let j=8;j<M.h-8;j++)for(let i=8;i<w-8;i++){const k=j*w+i,q=k+1;if(M.wall[k]||M.wall[q]||M.stairs[k]||M.stairs[q])continue;if(Math.abs(M.elev[q]-M.elev[k]-rise)>0.01)continue;if(!lvl(k,k-1)||!lvl(k,k-2)||!lvl(k,k-3)||!lvl(q,q+1)||!lvl(q,q+2)||!lvl(q,q+3))continue;if(!lvl(k,k-w)||!lvl(k,k+w)||!lvl(q,q-w)||!lvl(q,q+w))continue;this.put(down?i+1:i,j);return {tile:[i,j],lo:M.elev[k],hi:M.elev[q],yaw:this.yaw(down?-Math.PI/2:Math.PI/2)}}return 'no step'},
target(id,dist){const c=pokewatch.ctx,P=c.player,v=pokewatch.renderer.viewSample();let t=dist;if(v.dir[1]<0){const tg=(v.eye[1]-P.y-0.6)/-v.dir[1];if(tg<t)t=tg}const x=v.eye[0]+v.dir[0]*t,z=v.eye[2]+v.dir[2]*t;const e=pokewatch.spawn(id,x-P.x,z-P.z);return {e,at:[+(x-P.x).toFixed(1),+(z-P.z).toFixed(1)],t:+t.toFixed(1)}},
aim(){const a=pokewatch.ctx.aim;return a&&{on:a.on,blocked:a.blocked,kind:a.hitKind,dist:+(a.dist||0).toFixed(1)}},
hud(){const b=document.querySelector('.hud-bottom').getBoundingClientRect();return {l:+(b.left/innerWidth).toFixed(3),r:+(b.right/innerWidth).toFixed(3),t:+(b.top/innerHeight).toFixed(3),b:+(b.bottom/innerHeight).toFixed(3),w:innerWidth,h:innerHeight}}
};return 1})()`;

const BOX = 'camtest.box()';
const FIRE = { btn: 16, press: 16 };
const q = (species, extra = '') => `go=1&seed=1&species=${species}&calm=1&cam=chase${extra}`;
const shot = (name) => [{ shot: name }, { eval: BOX }];
const scenes = [];

for (const sp of ['pichu', 'cyndaquil', 'quilava', 'charizard', 'feraligatr', 'joltik', 'venusaur', 'lapras', 'onix', 'koffing']) {
  scenes.push({ name: `open-${sp}`, w: 640, h: 360, query: q(sp), steps: [
    { eval: HELPERS }, { advance: 1.5 }, ...shot('1idle'),
    { advance: 0.6, frames: 36, input: { mx: 1 } }, ...shot('2strafeR'),
    { advance: 0.6, frames: 36, input: { mx: -1 } }, ...shot('3strafeL'),
    { advance: 0.6, frames: 36, input: { mz: 1 } }, ...shot('4reverse'),
    { advance: 0.6, frames: 36, input: { mz: -1 } }, { advance: 0.4, frames: 24 },
    { advance: 0.1, frames: 6, input: FIRE }, ...shot('5fire'), { advance: 0.1, frames: 6, input: { btn: 16 } }, ...shot('6fire'),
    // (the hurt blink skips the sprite on alternate frames, where the box is null: two shots a frame apart)
    { advance: 0.8, frames: 48 }, { eval: 'pokewatch.damage(5)' }, { advance: 0.05, frames: 3 }, ...shot('7hurt'), { advance: 1 / 60, frames: 1 }, ...shot('7hurt2'),
    { advance: 1, frames: 60 }, { eval: 'camtest.pitch(-30)' }, { advance: 0.3, frames: 18 }, ...shot('8up30'),
    { eval: 'camtest.pitch(30)' }, { advance: 0.3, frames: 18 }, ...shot('9down30'),
    { eval: 'camtest.pitch(60)' }, { advance: 0.3, frames: 18 }, ...shot('adown60'),
    { eval: 'camtest.pitch(89)' }, { advance: 0.3, frames: 18 }, ...shot('bdown89'),
  ] });
}

for (const sp of ['pichu', 'quilava', 'feraligatr', 'snorlax']) {
  scenes.push({ name: `hd-${sp}`, w: 1280, h: 720, query: q(sp), steps: [
    { eval: HELPERS }, { advance: 1.5 }, ...shot('1idle'), { eval: 'camtest.hud()' },
    { advance: 0.6, frames: 36, input: { mx: 1 } }, ...shot('2strafeR'),
    { advance: 0.6, frames: 36, input: { mz: 1 } }, ...shot('3reverse'),
  ] });
}

for (const sp of ['cyndaquil', 'quilava', 'feraligatr']) {
  scenes.push({ name: `wall-${sp}`, w: 640, h: 360, query: q(sp, '&stage=3'), steps: [
    { eval: HELPERS }, { advance: 0.5 },
    { eval: 'camtest.wallBehind(1)' }, { advance: 1.5, frames: 90 }, ...shot('1behind1'),
    { eval: 'camtest.wallBehind(2)' }, { advance: 1.5, frames: 90 }, ...shot('2behind2'),
    { eval: 'camtest.wallRight(1)' }, { advance: 1.5, frames: 90 }, ...shot('3right1'),
    { eval: 'camtest.corner(1)' }, { advance: 1.5, frames: 90 }, ...shot('4corner'),
    { eval: 'camtest.pitch(40)' }, { advance: 0.5, frames: 30 }, ...shot('5corner-down40'),
    { eval: 'camtest.pitch(-30)' }, { advance: 0.5, frames: 30 }, ...shot('6corner-up30'),
  ] });
}
for (const sp of ['cyndaquil', 'quilava']) {
  scenes.push({ name: `deck-${sp}`, w: 640, h: 360, query: q(sp), steps: [
    { eval: HELPERS }, { advance: 0.5 }, { eval: 'camtest.deck()' }, { advance: 1.5, frames: 90 }, ...shot('1under'),
    { eval: 'pokewatch.renderer.look(1.4,0)' }, { advance: 0.8, frames: 48 }, ...shot('2turned'),
    { eval: 'camtest.pitch(40)' }, { advance: 0.5, frames: 30 }, ...shot('3down40'),
  ] });
  scenes.push({ name: `forest-${sp}`, w: 640, h: 360, query: q(sp), steps: [
    { eval: HELPERS }, { advance: 1 }, { advance: 2.5, frames: 150, input: { mz: -1 } }, ...shot('1in'),
    { advance: 0.6, frames: 36, input: { mx: 1 } }, ...shot('2strafe'),
    { advance: 0.6, frames: 36, input: { mz: 1 } }, ...shot('3reverse'),
  ] });
}
for (const sp of ['cyndaquil', 'feraligatr']) {
  scenes.push({ name: `cave-${sp}`, w: 640, h: 360, query: `go=1&seed=3&stage=3&species=${sp}&calm=1&cam=chase`, steps: [
    { eval: HELPERS }, { advance: 2 }, ...shot('1start'),
    { advance: 4, frames: 240, input: { mz: -1 } }, ...shot('2walk'),
    { advance: 1, frames: 60, input: { mx: 1 } }, ...shot('3strafe'),
    { advance: 1, frames: 60, input: { mz: 1 } }, ...shot('4reverse'),
  ] });
}
for (const sp of ['pichu', 'feraligatr']) {
  scenes.push({ name: `steps-${sp}`, w: 640, h: 360, query: q(sp, '&stage=1'), steps: [
    // the Pokémon is put on the tile before the edge (0.5 m from it) with the camera behind it, and walks over it: up
    // the 0.5 m step (the step rises toward +x; a scene's input is in world axes), then down it from the other side
    { eval: HELPERS }, { advance: 0.5 }, { eval: 'camtest.step(0.5,0)' }, { advance: 1, frames: 60 }, ...shot('0before'),
    { strip: 'up', n: 20, dt: 1 / 60, input: { mx: 1 } }, { eval: BOX },
    { eval: 'camtest.step(0.5,1)' }, { advance: 1, frames: 60 },
    { strip: 'down', n: 20, dt: 1 / 60, input: { mx: -1 } }, { eval: BOX },
  ] });
}
for (const sp of ['cyndaquil', 'feraligatr']) {
  scenes.push({ name: `shot-${sp}`, w: 640, h: 360, query: q(sp), steps: [
    { eval: HELPERS }, { advance: 1.5 }, { eval: "camtest.target('snorlax',9)" }, { advance: 0.05, frames: 3 }, { eval: 'camtest.aim()' },
    ...shot('0target'), { strip: 'fire', n: 10, dt: 1 / 30, frames: 2, input: FIRE }, { eval: 'camtest.aim()' },
  ] });
}

fs.writeFileSync(new URL('./camframescenes.json', import.meta.url), JSON.stringify(scenes, null, 1));
console.log(`tools/camframescenes.json: ${scenes.length} scenes`);
