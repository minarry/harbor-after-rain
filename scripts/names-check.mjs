// Player-relative names, real map occlusion, and restart ownership regression.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const arg=(k,d)=>{const i=process.argv.indexOf(k);return i<0?d:process.argv[i+1];};
const out=path.resolve(arg('--out','artifacts/v147')),source=path.resolve(arg('--source','dist/index.html'));
await fs.mkdir(out,{recursive:true});
const report={source,sourceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex'),cases:[],errors:[]};
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await page.addInitScript(()=>{localStorage.setItem('harbor_after_rain_opts_v1',JSON.stringify({mode:'tdm',team:'BL',primary:'m4a1',size:5,diff:'normal',goal:50,tod:'dusk',quality:'high',fov:78,vol:0}));});
 const url=new URL(pathToFileURL(source));url.search='?nolock=1&q=high';await page.goto(url.href);await page.waitForFunction(()=>window.__game?.nav,null,{timeout:90000});
 await page.evaluate(()=>{requestAnimationFrame=()=>0;});await page.waitForTimeout(120);
 for(const mode of ['tdm','relay'])for(const team of ['BL','GR']){
  const result=await page.evaluate(({mode,team})=>{
   const g=__game;Object.assign(g.opts,{mode,team});
   const old=g.tags.slice(),disposed={textures:0,materials:0};
   for(const t of old){t.sprite.material.map.addEventListener('dispose',()=>disposed.textures++);t.sprite.material.addEventListener('dispose',()=>disposed.materials++);}
   g.startMatch();g.realTime=2;g.env.apply('dusk');g.env.atmosphere.setWeather({rain:0,wetness:.2,immediate:true});
   const p=g.player,friend=g.actors.find(a=>a!==p&&a.team===team),enemy=g.actors.find(a=>a.team!==team);
   for(const a of g.actors){a.alive=[p,friend,enemy].includes(a);a.protectT=0;a.soldier.root.visible=a!==p&&a.alive;}
   p.pos.set(-34,0,-6.5);p.yaw=-Math.PI/2;p.pitch=0;
   const place=(a,x,y,z)=>{a.pos.set(x,y,z);a.soldier.root.position.copy(a.pos);a.soldier.root.rotation.y=Math.PI/2;a.soldier.update(0,{speed:0,fwd:0,pitch:0,crouch:false,onGround:true});a.soldier.root.updateMatrixWorld(true);};
   place(friend,-30,0,-7.8);place(enemy,-30,0,-5.2);
   const cam=g.renderer.camera;cam.position.set(-34,1.65,-6.5);cam.lookAt(-30,1.4,-6.5);cam.fov=78;cam.updateProjectionMatrix();
   g.renderFrame(0);g.vm.setVisible(false);g.renderer.render();
   const tag=a=>g.tags.find(t=>t.actor===a),f=tag(friend),e=tag(enemy);
   const dominant=t=>{const c=t.sprite.material.map.image,d=c.getContext('2d').getImageData(0,0,c.width,c.height).data,counts=new Map();for(let i=0;i<d.length;i+=4)if(d[i+3]>240&&Math.max(d[i],d[i+1],d[i+2])>100){const k=[d[i],d[i+1],d[i+2]].join(',');counts.set(k,(counts.get(k)||0)+1);}return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0];};
   const projected=t=>{const v=t.sprite.position.clone().project(cam);return {x:(v.x+1)*innerWidth/2,y:(1-v.y)*innerHeight/2};};
   window.__namesFixture={friend,enemy,place,tag};
   return {mode,team,actors:g.actors.length,tags:g.tags.length,oldCount:old.length,disposed,oldRemoved:old.every(t=>t.sprite.parent===null),open:{friend:{name:friend.name,team:friend.team,visible:f.sprite.visible,color:dominant(f),depthTest:f.sprite.material.depthTest,screen:projected(f)},enemy:{name:enemy.name,team:enemy.team,visible:e.sprite.visible,color:dominant(e),depthTest:e.sprite.material.depthTest,depthWrite:e.sprite.material.depthWrite,screen:projected(e)}}};
  },{mode,team});
  assert.equal(result.tags,result.actors-1);assert.equal(result.disposed.textures,result.oldCount);assert.equal(result.disposed.materials,result.oldCount);assert.equal(result.oldRemoved,true);
  assert.equal(result.open.friend.color,'140,200,255');assert.equal(result.open.enemy.color,'255,98,98');
  assert.equal(result.open.friend.visible,true);assert.equal(result.open.enemy.visible,true);assert.equal(result.open.friend.depthTest,false);assert.equal(result.open.enemy.depthTest,true);assert.equal(result.open.enemy.depthWrite,false);
  const file=`names-${mode}-${team}.png`,png=await page.screenshot({path:path.join(out,file)});result.screenshot=file;
  result.renderedPixels=await page.evaluate(async({png,points})=>{
   const image=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
   const counts={};for(const [side,p] of Object.entries(points)){const data=ctx.getImageData(Math.floor(p.x)-75,Math.floor(p.y)-15,150,30).data;let blue=0,red=0;for(let i=0;i<data.length;i+=4){const [r,g,b]=[data[i],data[i+1],data[i+2]];if(b>r*1.2&&b>g*1.05&&b>90)blue++;if(r>g*1.35&&r>b*1.35&&r>90)red++;}counts[side]={blue,red};}return counts;
  },{png:png.toString('base64'),points:{friend:result.open.friend.screen,enemy:result.open.enemy.screen}});
  assert.ok(result.renderedPixels.friend.blue>15,'Visible blue friend glyphs');assert.ok(result.renderedPixels.enemy.red>15,'Visible red enemy glyphs');
  result.lifecycle=await page.evaluate(()=>{
   const g=__game,{friend,enemy,place,tag}=__namesFixture,states={};
   enemy.alive=false;g.renderFrame(0);states.deadHidden=!tag(enemy).sprite.visible;
   enemy.alive=true;place(enemy,12,0,-5.2);g.renderFrame(0);states.beyond45Hidden=!tag(enemy).sprite.visible;
   place(enemy,-30,0,-5.2);g.renderFrame(0);states.respawnVisible=tag(enemy).sprite.visible;
   return states;
  });assert.deepEqual(result.lifecycle,{deadHidden:true,beyond45Hidden:true,respawnVisible:true});
  result.hud=await page.evaluate(()=>{
   const g=__game,p=g.player,{friend,enemy}=__namesFixture,cam=g.renderer.camera,out={};
   for(const [side,a] of [['friend',friend],['enemy',enemy]]){cam.lookAt(a.soldier.chestWorld(cam.position.clone()));g.frame=4;g.updateHUD(0);out[side]={name:g.hud.el.nameTip.textContent,color:getComputedStyle(g.hud.el.nameTip).color};}
   g.hud.killFeed(enemy,friend,'m4a1',false,false,false);out.killFeed=[...g.hud.el.feed.firstElementChild.querySelectorAll('.k,.v')].map(e=>getComputedStyle(e).color);
   g.hud.scoreboard(true,g.actors,p.id,g.score);out.board=[...g.hud.el.boardBody.querySelectorAll('td:first-child')].map(e=>({name:e.textContent,color:getComputedStyle(e).color}));
   g.hud.endScreen(null,g.score,g.actors,p.id);out.end=[...g.hud.el.endTable.querySelectorAll('td:first-child')].map(e=>({name:e.textContent,color:getComputedStyle(e).color}));
   g.hud.show(null);g.hud.scoreboard(false,g.actors,p.id,g.score);return out;
  });
  assert.equal(result.hud.friend.name,result.open.friend.name);assert.equal(result.hud.enemy.name,result.open.enemy.name);
  assert.equal(result.hud.friend.color,'rgb(140, 200, 255)');assert.equal(result.hud.enemy.color,'rgb(255, 98, 98)');assert.deepEqual(result.hud.killFeed,['rgb(255, 98, 98)','rgb(140, 200, 255)']);
  for(const list of [result.hud.board,result.hud.end]){assert.equal(list.find(r=>r.name===result.open.friend.name).color,'rgb(140, 200, 255)');assert.equal(list.find(r=>r.name===result.open.enemy.name).color,'rgb(255, 98, 98)');}
  result.occlusion=await page.evaluate(()=>{
   const g=__game,{friend,enemy,place,tag}=__namesFixture,cam=g.renderer.camera;
   // Use an existing solid container. Raise the fixture slightly so the label
   // clears its roof while the head remains hidden: depth testing alone is insufficient.
   const c=g.world.colliders.find(c=>c.tag==='container'&&c.bottom<.1&&c.x<0),side=c.hz+2;
   const point=(z)=>({x:c.x+c.s*z,z:c.z+c.c*z});
   place(enemy,0,0,0);const headOffset=enemy.soldier.headWorld(cam.position.clone()).y;
   const target=point(side),origin=point(-side),y=c.top-.2-headOffset;
   place(enemy,target.x,y,target.z);place(friend,target.x+.25,y,target.z+.25);
   cam.position.set(origin.x,c.top+.2,origin.z);cam.lookAt(enemy.soldier.headWorld(cam.position.clone()));
   // The fixture teleports the camera. Run the normal throttled aim-name refresh
   // before capturing, so a previous target is not mistaken for an occluded tag.
   g.frame=3;g.renderFrame(0);g.vm.setVisible(false);g.renderer.render();
   const blocked=end=>{const d=end.clone().sub(cam.position),len=d.length();d.divideScalar(len);return !!g.world.raycast(cam.position.x,cam.position.y,cam.position.z,d.x,d.y,d.z,len,'sight');};
   return {collider:{tag:c.tag,x:c.x,z:c.z,top:c.top},headBlocked:blocked(enemy.soldier.headWorld(cam.position.clone())),labelRayClear:!blocked(tag(enemy).sprite.position),enemyHidden:!tag(enemy).sprite.visible,friendVisible:tag(friend).sprite.visible,aimName:g.hud.el.nameTip.textContent};
  });
  assert.equal(result.occlusion.headBlocked,true);assert.equal(result.occlusion.labelRayClear,true);assert.equal(result.occlusion.enemyHidden,true);assert.equal(result.occlusion.friendVisible,true);assert.equal(result.occlusion.aimName,'');
  if(mode==='tdm'&&team==='BL'){result.occlusion.screenshot='names-occluded.png';await page.screenshot({path:path.join(out,result.occlusion.screenshot)});}
  report.cases.push(result);console.log(JSON.stringify({mode,team,tags:result.tags,pixels:result.renderedPixels,occlusion:result.occlusion}));
 }
 report.finalDisposal=await page.evaluate(()=>{const g=__game,old=g.tags.slice(),disposed={textures:0,materials:0};for(const t of old){t.sprite.material.map.addEventListener('dispose',()=>disposed.textures++);t.sprite.material.addEventListener('dispose',()=>disposed.materials++);}g.clearMatchObjects();return {count:old.length,...disposed,removed:old.every(t=>t.sprite.parent===null)};});
 assert.equal(report.finalDisposal.textures,report.finalDisposal.count);assert.equal(report.finalDisposal.materials,report.finalDisposal.count);assert.equal(report.finalDisposal.removed,true);assert.deepEqual(report.errors,[]);
 report.passed=true;
}finally{await fs.writeFile(path.join(out,'names-check.json'),JSON.stringify(report,null,2));await browser.close();}
