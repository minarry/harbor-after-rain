import fs from 'node:fs/promises';

const root = 'artifacts/v142';
const before = JSON.parse(await fs.readFile(`${root}/hand-comparison-before.json`, 'utf8'));
const after = JSON.parse(await fs.readFile(`${root}/hand-comparison-after.json`, 'utf8'));
const names = { 'm4-hip': 'M4 · 自然持枪', 'm4-ads': 'M4 · 举枪瞄准', 'm4-reload45': 'M4 · 抓取弹匣',
  'm4-reload80': 'M4 · 拉机柄', 'm4-inspect': 'M4 · 侧向检视', 'm4-inspect-top': 'M4 · 上方检视',
  'm4-grip-close': 'M4 · 握持近照', 'ak-grip-close': 'AK · 握持近照', 'deagle-grip-close': '手枪 · 双手握持',
  'hands-open-back': '手背 · 展开检查', 'hands-open-palm': '掌面 · 展开检查' };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const items = after.cases.map(item => {
  const old = before.cases.find(c => c.id === item.id);
  if (!old) throw new Error(`Missing baseline: ${item.id}`);
  return { id: item.id, name: names[item.id], before: old.screenshot.split('/').pop(), after: item.screenshot.split('/').pop(), diagnostic: item.kind !== 'native laboratory first-person viewpoint' };
});
const markup = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>运输船 · 手部效果对照</title>
<style>*{box-sizing:border-box}body{margin:0;background:#101a1f;color:#eee9de;font:15px/1.7 system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:32px 24px}small{color:#dbb077;letter-spacing:.15em}h1{margin:10px 0;font-size:clamp(24px,3vw,42px)}p{color:#aeb9b9;max-width:900px}a{color:#dfbc87}label{display:block;color:#aeb9b9;font-size:12px}select,button{font:inherit;background:#1d3037;color:#eee9de;border:1px solid #536469;padding:9px 14px;min-height:44px}nav{display:flex;gap:14px;flex-wrap:wrap;align-items:end;margin:24px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:18px}figure{margin:0}figcaption{padding:9px 0;color:#dfbc87}img{width:100%;display:block;border:1px solid #374b51}.single .pair{grid-template-columns:1fr}.single figure:first-child{display:none}footer{margin-top:22px;font-size:12px;color:#aeb9b9}@media(max-width:700px){main{padding:24px 14px}.pair{grid-template-columns:1fr}}</style>
<main><small>HARBOR / HANDS · 1.4.2</small><h1>半指手套与自然手型</h1><p>同一镜头、光照、种子和动作阶段，比较手掌轮廓、露出的手指、袖口与握姿。原版换弹基线已先完成抽枪，避免把未完成的抽枪动作叠加到换弹定格上。</p>
<nav><div><label for="pose">查看姿态</label><select id="pose">${items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select></div><button id="single">只看新版大图</button><a href="../../dist/index.html?lab=weapon&shot=1&t=2">打开可操作展示场 ↗</a></nav>
<p id="note"></p><div class="pair"><figure><figcaption>改动前 · 完整硬质手套</figcaption><a id="oldLink" target="_blank"><img id="old" alt="相同姿态改动前"></a></figure><figure><figcaption>改动后 · 半指战术手套</figcaption><a id="newLink" target="_blank"><img id="new" alt="相同姿态改动后"></a></figure></div>
<footer>近照与展开检查采用明确记录的诊断姿态，不是游戏镜头。皮肤与指甲为程序化近似，并非扫描模型。完整参数：<a href="hand-comparison-before.json">改动前</a> · <a href="hand-comparison-after.json">改动后</a>。</footer></main>
<script>const items=${JSON.stringify(items).replaceAll('<','\\u003c')};const select=document.querySelector('#pose');function show(){const i=items.find(i=>i.id===select.value);document.querySelector('#old').src=document.querySelector('#oldLink').href=i.before;document.querySelector('#new').src=document.querySelector('#newLink').href=i.after;document.querySelector('#note').textContent=i.diagnostic?'诊断视角：放大握持或展开双手，以便检查轮廓、指缝和材质。':'原生第一视角：武器展示场中的实际持枪或动作姿态。'}select.onchange=show;document.querySelector('#single').onclick=e=>{const single=document.body.classList.toggle('single');e.target.textContent=single?'恢复左右对照':'只看新版大图'};show();</script></html>`;
await fs.writeFile(`${root}/review.html`, markup);
console.log(`Wrote ${root}/review.html (${items.length} hand comparisons)`);
