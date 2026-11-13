// Build the arm comparison only from existing, matching capture reports.
// Run after final capture: node scripts/arm-review.mjs --out artifacts/v144
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';

const arg=(key,fallback)=>{const i=process.argv.indexOf(key);return i<0?fallback:process.argv[i+1];};
const out=path.resolve(arg('--out','artifacts/v144'));
const edition=arg('--edition',path.basename(out)==='v143'?'v143':'v144');
const editions={
  v143:{before:'1.4.2',after:'1.4.3',beforeLabel:'黑色长袖前臂',afterLabel:'挽袖露出前臂',title:'手臂与袖口：前后对照',description:'从黑色长袖前臂，改为挽起袖口、露出自然前臂。先看实际游戏中的轮廓，再看持枪与换弹时的腕部过渡。两侧使用相同视角、日照和动作阶段。'},
  v144:{before:'1.4.3',after:'1.4.4',beforeLabel:'原支撑握姿',afterLabel:'掌心托枪与独立旋腕',title:'掌心托枪与旋腕：前后对照',description:'比较支撑手从侧握改为掌心向上托住护木后的变化，观察手腕转动与前臂的衔接。先看实际游戏，再看瞄准与换弹的固定姿态。两侧使用相同视角、日照和动作阶段。'},
};
assert.ok(editions[edition],`Unknown --edition ${edition}`);
const copy={...editions[edition],before:arg('--before-version',editions[edition].before),after:arg('--after-version',editions[edition].after)};
const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const href=file=>encodeURIComponent(path.basename(file));
const read=async file=>({file,data:JSON.parse(await fs.readFile(path.join(out,file),'utf8'))});
const verifyErrors=(report,label)=>assert.deepEqual(report.errors||[],[],`${label}: capture reported errors`);
const game={before:await read('game-arm-before.json'),after:await read('game-arm-after.json')};
for(const phase of ['before','after']){
  const r=game[phase].data;verifyErrors(r,game[phase].file);
  assert.equal(r.phase,phase,`${game[phase].file}: wrong phase`);
  assert.match(r.sourceSha256||'',/^[a-f0-9]{64}$/i,`${game[phase].file}: source hash missing`);
  // If a new build has replaced dist, stale screenshots must not be presented as
  // the final build. Compare the recorded source file, not a guessed package path.
  const bytes=await fs.readFile(r.source);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),r.sourceSha256,
    `${phase}: source changed since capture; recapture ${game[phase].file}`);
}
assert.deepEqual(game.before.data.setup,game.after.data.setup,'Game capture setups differ');
for(const key of ['camera','viewCamera','rig','light','weather']){
  assert.deepEqual(game.before.data.state[key],game.after.data.state[key],`Game ${key} differs; this is not a matched comparison`);
}

const specs=[
  {id:'m4-hip',title:'M4 · 自然持枪',type:'展示场 · 原生持枪姿态',note:edition==='v144'?'观察掌心是否从下方托住护木，以及手腕与前臂是否自然衔接。':'观察前臂从肌腹到手腕的收细，以及袖口、皮肤、手套之间的连接。'},
  ...(edition==='v144'?[{id:'m4-ads',title:'M4 · 举枪瞄准',type:'展示场 · 原生瞄准姿态',note:'瞄准时观察支撑手掌心方向、腕臂夹角以及瞄具对齐。'}]:[]),
  {id:'m4-reload45',title:'M4 · 抓取弹匣',type:'展示场 · 换弹 45%',note:'完成抽枪后再定格换弹，观察抓匣时腕部和袖口的过渡。'},
  {id:'m4-reload80',title:'M4 · 拉机柄',type:'展示场 · 换弹 80%',note:'抬臂动作更容易看清前臂轮廓、腕部弯转及卷袖边缘。'},
  {id:'ak-grip-close',title:'AK · 握持近景',type:'固定诊断近景 · 非游戏镜头',note:'整体移动枪械与双臂，以便检查手腕和护木的握持关系；未单独移动手或改变光照。'},
  {id:'deagle-grip-close',title:'手枪 · 双手握持近景',type:'固定诊断近景 · 非游戏镜头',note:'查看双手握持时的腕部、手套收口及前臂，采用与旧版一致的近景设置。'},
];
const files=(await fs.readdir(out)).filter(name=>/^hand-comparison-(before|after)(?:-.*)?\.json$/.test(name)&&!name.includes('invalid'));
const reports=await Promise.all(files.map(async file=>({...await read(file),mtime:(await fs.stat(path.join(out,file))).mtimeMs})));
function findCase(phase,id){
  const expected=game[phase].data.sourceSha256;
  const matching=reports.filter(r=>r.data.phase===phase&&r.data.sourceSha256===expected&&Array.isArray(r.data.cases)&&r.data.cases.some(c=>c.id===id)).sort((a,b)=>b.mtime-a.mtime);
  assert.ok(matching.length,`Missing ${phase} ${id} report from the same build as ${game[phase].file}`);
  const report=matching[0],item=report.data.cases.find(c=>c.id===id);
  verifyErrors(report.data,report.file);verifyErrors(item.snapshot||{},`${report.file}/${id}`);
  assert.equal(item.drawT,1,`${id}: unfinished weapon draw contaminates the pose`);
  return {report,item};
}
async function imageFile(record){
  assert.equal(typeof record.screenshot,'string','Screenshot path missing');
  const file=path.basename(record.screenshot);
  assert.match(file,/\.png$/i,'Expected an original PNG capture');
  await fs.access(path.join(out,file));
  return file;
}
const items=[{id:'game',title:'实际游戏 · M4 持枪',type:'完整游戏画面 · 默认视野',
  note:'真实对局渲染，固定人物位置、黄昏日照和默认视野；机器人已排除，避免干扰观察。没有移动手臂或枪械模型。',
  before:await imageFile(game.before.data),after:await imageFile(game.after.data),
  beforeReport:game.before.file,afterReport:game.after.file,
  detail:`${game.after.data.setup.viewport.width} × ${game.after.data.setup.viewport.height} · 游戏视野 ${game.after.data.state.camera.fov}° · 武器视野 ${game.after.data.state.viewCamera.fov}° · 固定 ${game.after.data.setup.frames} 帧`}];
for(const spec of specs){
  const b=findCase('before',spec.id),a=findCase('after',spec.id);
  for(const key of ['weapon','setup','animation','kind','canvasBounds']){
    assert.deepEqual(b.item[key],a.item[key],`${spec.id}: ${key} differs`);
  }
  for(const key of ['viewport','deviceScaleFactor','seed','initialTime','quality']){
    assert.deepEqual(b.report.data[key],a.report.data[key],`${spec.id}: ${key} differs`);
  }
  assert.deepEqual(b.item.snapshot.controls,a.item.snapshot.controls,`${spec.id}: controls differ`);
  assert.deepEqual(b.item.view,a.item.view,`${spec.id}: camera/rig differs`);
  const bounds=a.item.canvasBounds,offset=a.item.rigOffset||a.item.setup?.rigOffset;
  items.push({...spec,before:await imageFile(b.item),after:await imageFile(a.item),beforeReport:b.report.file,afterReport:a.report.file,
    detail:`${Math.round(bounds.width)} × ${Math.round(bounds.height)} 展示画布 · 固定种子 ${a.report.data.seed}${offset?` · 整体位移 [${offset.join(', ')}] m`:''}`});
}
assert.equal(items.length,specs.length+1);
const reportLinks=[...new Set(items.flatMap(i=>[i.beforeReport,i.afterReport]))];
const sections=items.map((i,n)=>`<section id="${esc(i.id)}" aria-labelledby="title-${esc(i.id)}">
<div class="section-top"><span class="ordinal">0${n+1}</span><div><p class="type">${esc(i.type)}</p><h2 id="title-${esc(i.id)}">${esc(i.title)}</h2></div></div>
<p class="note">${esc(i.note)}</p>
<div class="pair"><figure class="before"><figcaption><span>改动前</span>${esc(copy.before)} · ${esc(copy.beforeLabel)}</figcaption><a href="${href(i.before)}" target="_blank" rel="noopener" aria-label="打开${esc(i.title)}改动前原图"><img src="${href(i.before)}" alt="${esc(i.title)}，${esc(copy.before)} ${esc(copy.beforeLabel)}" loading="${n?'lazy':'eager'}"></a></figure>
<figure class="after"><figcaption><span>改动后</span>${esc(copy.after)} · ${esc(copy.afterLabel)}</figcaption><a href="${href(i.after)}" target="_blank" rel="noopener" aria-label="打开${esc(i.title)}改动后原图"><img src="${href(i.after)}" alt="${esc(i.title)}，${esc(copy.after)} ${esc(copy.afterLabel)}" loading="${n?'lazy':'eager'}"></a></figure></div>
<div class="image-foot"><span>${esc(i.detail)}</span><span><a href="${href(i.beforeReport)}">旧版参数</a> · <a href="${href(i.afterReport)}">新版参数</a> · 点击图片查看原尺寸</span></div></section>`).join('\n');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>运输船 · ${esc(copy.title)}</title>
<style>
:root{color-scheme:dark;--bg:#101b20;--panel:#15252b;--line:#354b52;--ink:#eee9dd;--muted:#acb9b9;--accent:#e1b77c}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:20px}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.7 system-ui,-apple-system,sans-serif}main{max-width:1800px;margin:auto;padding:40px 28px 56px}header{max-width:1000px}.kicker,.type{color:var(--accent);font-size:12px;letter-spacing:.11em}.kicker{margin:0}h1{font-size:clamp(27px,3.2vw,48px);line-height:1.25;margin:12px 0 18px}h2{font-size:clamp(21px,2.2vw,29px);line-height:1.3;margin:1px 0 0}p{margin:0 0 14px}header>p:last-child,.note{color:var(--muted)}nav{display:flex;align-items:center;flex-wrap:wrap;gap:9px;margin:25px 0 12px}a{color:var(--accent);text-underline-offset:4px}nav a,button{border:1px solid var(--line);background:var(--panel);color:var(--ink);padding:9px 14px;min-height:44px;font:inherit;text-decoration:none;border-radius:3px}button{cursor:pointer;margin:10px 0 0}button[aria-pressed=true]{border-color:var(--accent)}a:hover,button:hover{color:#ffe0b0}a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:4px}.toolbar{display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:var(--muted);font-size:13px}section{padding:37px 0 31px;border-bottom:1px solid var(--line)}.section-top{display:flex;align-items:center;gap:14px}.ordinal{font-size:28px;color:#72858b;font-variant-numeric:tabular-nums}.type{margin:0}.note{max-width:1000px;margin:13px 0 18px}.pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:18px}figure{margin:0;min-width:0}figcaption{padding:10px 0;color:var(--muted);font-size:13px}figcaption span{display:inline-block;color:var(--ink);font-weight:650;margin-right:12px}.after figcaption span{color:var(--accent)}img{display:block;width:100%;height:auto;background:#081216;border:1px solid var(--line)}.image-foot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;color:var(--muted);font-size:12px;margin-top:13px}.only-new .pair{grid-template-columns:minmax(0,1fr)}.only-new figure.before{display:none}footer{margin-top:28px;max-width:1100px;color:var(--muted);font-size:13px}details{padding:15px 0}summary{cursor:pointer;color:var(--ink)}code{overflow-wrap:anywhere;word-break:break-all;font-size:12px}.reports{display:flex;flex-direction:column;gap:7px;margin-top:10px}@media(max-width:820px){main{padding:25px 14px 36px}.pair{grid-template-columns:minmax(0,1fr);gap:20px}nav{gap:7px}nav a{font-size:13px;padding:8px 10px}.image-foot{display:block}.image-foot>span{display:block;margin:4px 0}section{padding:28px 0}}@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body><main><header><p class="kicker">HARBOR / AFTER RAIN · ${esc(copy.before)} → ${esc(copy.after)}</p><h1>${esc(copy.title)}</h1><p>${esc(copy.description)}</p></header>
<nav aria-label="${items.length}组对照">${items.map((i,n)=>`<a href="#${esc(i.id)}">0${n+1} ${esc(i.title)}</a>`).join('')}</nav>
<div class="toolbar"><button type="button" id="view-mode" aria-pressed="false">只看新版大图</button><span>原图未裁切；点击任意图片打开完整尺寸。</span></div>
${sections}
<footer><p>实际游戏画面使用默认视野。展示场图片用于固定动作观察；AK 与手枪近景统一移动了整组枪械和双臂，已单独标记为诊断视角。截图用于比较可见效果，不能替代对动作连贯性和整体游玩体验的判断。</p>
<details><summary>查看固定设置与截图来源</summary><p>${items.length}组新版截图均来自同一个构建文件；生成此页时已校验报告中的来源哈希与实际文件一致，并核对前后视角、光照及动作设置。</p><p>旧版 SHA-256<br><code>${esc(game.before.data.sourceSha256)}</code></p><p>新版 SHA-256<br><code>${esc(game.after.data.sourceSha256)}</code></p><div class="reports">${reportLinks.map(f=>`<a href="${href(f)}">${esc(f)}</a>`).join('')}</div></details></footer></main>
<script>document.querySelector('#view-mode').addEventListener('click',event=>{const active=document.body.classList.toggle('only-new');event.currentTarget.setAttribute('aria-pressed',String(active));event.currentTarget.textContent=active?'恢复前后对照':'只看新版大图';});</script></body></html>`;
await fs.writeFile(path.join(out,'review.html'),html);
console.log(`Wrote ${path.join(out,'review.html')} (${items.length} matched comparisons; after ${game.after.data.sourceSha256.slice(0,12)})`);
