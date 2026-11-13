// Fixed seed, time, camera and viewport comparisons. Pixel differences document
// changes; they do not by themselves prove aesthetic improvement.
import {chromium} from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const out='artifacts/v14',baseline=path.resolve(process.env.BASELINE_HTML||`${out}/baseline-v1.3.html`);
const afterOnly=process.argv.includes('--after-only');
const prior=afterOnly?JSON.parse(await fs.readFile(`${out}/comparison.json`,'utf8')):null;
const cases=[
  {id:'cargo',module:'props',camera:'cargo'},
  {id:'barrel',module:'props',camera:'barrel'},
  {id:'material',module:'mats',camera:'close'},
  {id:'contact-light',module:'render',camera:'detail'},
  {id:'weapon',module:'weapon',camera:'overview'},
  {id:'wet-deck',module:'ground',camera:'ground'},
  {id:'battlefield',module:'level',camera:'lane'},
];
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const report={viewport:{width:1600,height:1000},seed:4207,time:2,cases:[],errors:[],notes:'Fixed screenshots compare complete builds. GPU timings are not a cross-device benchmark.'};
try{
  const page=await browser.newPage({viewport:report.viewport,deviceScaleFactor:1});
  page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const phases=afterOnly?['after']:process.argv.includes('--baseline-only')?['before']:['before','after'];
  for(const item of cases){
    const record={...item};
    if(afterOnly){record.before=prior.cases.find(c=>c.id===item.id)?.before;assert.ok(record.before,`Missing baseline ${item.id}`);}
    for(const phase of phases){
      const file=phase==='before'?baseline:path.resolve('dist/index.html'),url=new URL(pathToFileURL(file));
      url.search=new URLSearchParams({lab:item.module,cam:item.camera,seed:'4207',t:'2',shot:'1',q:'high'});
      const started=performance.now();await page.goto(url.href);await page.waitForFunction(()=>window.__lab?.ready,null,{timeout:90000});
      const readyMs=Math.round(performance.now()-started);
      await page.evaluate(()=>__lab.pause(true));await page.waitForTimeout(220);
      const screenshot=`${out}/${item.id}-${phase}.png`;await page.locator('#c').screenshot({path:screenshot});
      record[phase]={screenshot,readyMs,state:await page.evaluate(()=>__lab.snapshot())};
    }
    report.cases.push(record);console.log(`Captured ${item.id}`);
  }
  assert.equal(report.errors.length,0,report.errors.join('\n'));
}finally{await fs.writeFile(`${out}/comparison${process.argv.includes('--baseline-only')?'-baseline':''}.json`,JSON.stringify(report,null,2));await browser.close();}
