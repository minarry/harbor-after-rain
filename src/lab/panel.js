import { LAB_MODULES, LAB_ITERATION_CONTRACT } from './catalog.js';

let serial=0;
const text=(element,value)=>{const next=String(value??'');if(element.textContent!==next)element.textContent=next;};
const node=(tag,className,value)=>{const el=document.createElement(tag);if(className)el.className=className;if(value!==undefined)el.textContent=String(value);return el;};
const stringify=value=>{try{return JSON.stringify(value);}catch{return String(value);}};
const metricNames={fps:'帧率',calls:'绘制调用',drawCalls:'绘制调用',triangles:'三角形',geometries:'几何资源',textures:'纹理资源',meshes:'网格',particles:'粒子',shaderErrors:'着色器错误',objects:'场景对象',seed:'随机种子',frameMs:'帧耗时',activeShells:'活动弹壳',activeDebris:'活动碎片',activeRipples:'活动波纹',activeSparks:'活动火花',activeDroplets:'活动水滴',particleCount:'活动粒子',tracerCount:'弹道轨迹',decalCount:'命中贴花',effectCapacity:'池容量',shells:'弹壳',debris:'碎片',ripples:'波纹',sparks:'火花',droplets:'水滴',tracers:'轨迹'};
function metricRows(metrics,prefix=''){
  const rows=[];
  for(const [key,raw] of Object.entries(metrics)){
    const label=prefix+(metricNames[key]||key);
    if(raw&&typeof raw==='object'&&!Array.isArray(raw)&&!Object.hasOwn(raw,'value'))rows.push(...metricRows(raw,label+' / '));
    else rows.push({label,...(raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{value:Array.isArray(raw)?raw.join(' · '):raw})});
  }
  return rows;
}
function number(value,step){
  if(!Number.isFinite(Number(value)))return String(value??'—');
  const places=step?Math.min(4,(String(step).split('.')[1]||'').length):2;
  return Number(value).toLocaleString('en-US',{maximumFractionDigits:places});
}
function evidenceList(value){
  if(typeof value==='string')return [{name:'参考依据',detail:value}];
  if(Array.isArray(value))return value.map(item=>typeof item==='string'?{detail:item}:item||{});
  if(value&&typeof value==='object')return Object.entries(value).map(([name,item])=>typeof item==='object'?{name,...item}:{name,detail:item});
  return [];
}

/**
 * Callback contract: onSelect(id), onControl(key,value), onAction(id),
 * onCamera(id), onPause(nextPaused), onReset(), onCopy(), onExport().
 * Callbacks may return a Promise. update() accepts a partial state. The returned
 * viewport is the renderer's canvas host; its bounding rect is the render size.
 */
export function renderPanel({catalog=LAB_MODULES,selected=catalog[0]?.id,onSelect,onControl,onAction,onCamera,onPause,onReset,onCopy,onExport}={}){
  const uid=`lab-${++serial}`,root=node('div');root.id='lab-root';root.dataset.drawer='';
  const previousBodyClass=document.body.classList.contains('lab-mode');document.body.classList.add('lab-mode');
  root.innerHTML=`
    <header class="lab-header">
      <div class="lab-brand"><div class="lab-brand-mark" aria-hidden="true"><span>H</span></div><div><b>暮雨 · 模块实验室</b><small>HARBOR / ENGINEERING LAB</small></div></div>
      <div class="lab-header-right"><span class="lab-live"><i></i><span>LIVE SCENE</span></span><a class="lab-back" href="?">返回游戏 ↗</a><button type="button" class="lab-mobile-toggle" data-drawer-toggle="nav" aria-expanded="false">模块</button><button type="button" class="lab-mobile-toggle" data-drawer-toggle="inspector" aria-expanded="false">参数</button></div>
    </header>
    <nav class="lab-side lab-nav" aria-label="展示模块"><div class="lab-nav-heading"><p class="lab-section-label">MODULE INDEX</p><span>09</span><button class="lab-close" type="button" aria-label="关闭模块导航">×</button></div><div class="lab-modules"></div><p class="lab-nav-note"><strong>真实三维 · 独立验证</strong><br>九个入口对应原作的展示注册表，文章的文件分组另有职责划分。玩家、声音和 UI 作为相关模块的子测试。</p><div class="lab-nav-foot">PARAMETER → OBSERVE → VERIFY</div></nav>
    <main id="lab-stage" aria-label="实时三维展示场"><div class="lab-stage-overlay"><div class="lab-stage-heading"><p class="lab-stage-kicker"></p><h1></h1><p class="lab-stage-description"></p><div class="lab-camera-strip" aria-label="相机预设"></div></div><div class="lab-stage-bottom"><div><div class="lab-playbar"><button id="lab-pause" type="button" aria-pressed="false">Ⅱ 暂停</button><button id="lab-reset" type="button">↻ 重置</button><span class="lab-clock">00:00.0</span></div><p class="lab-stage-hint">拖拽旋转 · 滚轮缩放 · 切换预设视角</p></div><div class="lab-stage-stats" aria-label="实时渲染指标"><div class="lab-stat"><b data-stat="fps">—</b><span>FPS</span></div><div class="lab-stat"><b data-stat="calls">—</b><span>DRAW CALLS</span></div></div></div></div></main>
    <aside class="lab-side lab-inspector" aria-label="场景控制与检查"><div class="lab-inspector-head"><div class="lab-inspector-title"><h2>参数台</h2><span class="lab-check-count">等待检查</span><button class="lab-close" type="button" aria-label="关闭参数台">×</button></div><div class="lab-tabs" role="tablist" aria-label="参数与审计"><button class="lab-tab" role="tab" data-tab="controls" aria-selected="true" type="button">参数</button><button class="lab-tab" role="tab" data-tab="checks" aria-selected="false" type="button">验证</button><button class="lab-tab" role="tab" data-tab="evidence" aria-selected="false" type="button">依据</button></div></div>
      <section class="lab-tabpanel" data-panel="controls" role="tabpanel"><p class="lab-description">调整当前场景参数，直接观察三维结果。</p><div class="lab-actions"></div><div id="lab-controls" class="lab-controls"></div><h3 class="lab-subhead">LIVE METRICS</h3><dl class="lab-metrics"></dl></section>
      <section class="lab-tabpanel" data-panel="checks" role="tabpanel" hidden><p class="lab-description">检查由运行中的场景返回。尚未执行的项目保持待验证，不计为通过。</p><ul class="lab-checks"></ul></section>
      <section class="lab-tabpanel" data-panel="evidence" role="tabpanel" hidden><div class="lab-evidence-list"></div><div class="lab-sources"><p class="lab-section-label">LOCAL SOURCE</p><div></div></div><h3 class="lab-subhead">REVIEW LOOP / v1</h3><details class="lab-contract"><summary>查看迭代与导出约定</summary><ol></ol><p>导出应保留当前参数、指标、检查状态与错误。待验证与失败均不得被写成通过。</p></details></section>
      <div class="lab-errorbox" role="alert" hidden></div><footer class="lab-inspector-foot"><button id="lab-copy" type="button">复制配置</button><button id="lab-export" type="button">导出 JSON ↗</button></footer>
    </aside>
    <button class="lab-scrim" type="button" aria-label="收起面板" tabindex="-1"></button><div class="lab-toast" role="status" aria-live="polite" hidden></div>`;
  document.body.append(root);
  const $=selector=>root.querySelector(selector),$$=selector=>[...root.querySelectorAll(selector)];
  const viewport=$('#lab-stage'),nav=$('.lab-modules'),controlsHost=$('#lab-controls'),actionsHost=$('.lab-actions'),cameraHost=$('.lab-camera-strip');
  const fields=new Map(),moduleButtons=new Map(),cache={},localErrors=[];let state={selected,controls:[],actions:[],metrics:{},checks:[],cameraPresets:[],paused:false,time:0,errors:[]};
  let disposed=false,toastTimer=null,lastMetrics=-Infinity,currentTab='controls',lastDrawerButton=null;
  const media=window.matchMedia('(max-width:920px)');
  const eventController=new AbortController(),events={signal:eventController.signal};
  let controlEvents=new AbortController(),actionEvents=new AbortController(),cameraEvents=new AbortController();
  $('.lab-nav').id=`${uid}-navigation`;$('.lab-inspector').id=`${uid}-inspector`;
  $('[data-drawer-toggle="nav"]').setAttribute('aria-controls',`${uid}-navigation`);
  $('[data-drawer-toggle="inspector"]').setAttribute('aria-controls',`${uid}-inspector`);
  const current=()=>catalog.find(item=>item.id===state.selected)||catalog[0]||{};
  function toast(message){if(disposed)return;text($('.lab-toast'),message);$('.lab-toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{$('.lab-toast').hidden=true;},2600);}
  async function invoke(callback,args=[],button=null,message=null){
    if(typeof callback!=='function'||disposed)return;
    const wasDisabled=button?.disabled;if(button)button.disabled=true;
    try{const result=await callback(...args);if(result!==false&&message)toast(result?.message||message);}
    catch(error){localErrors.push(error?.message||String(error));renderErrors();toast('操作未完成，详情见错误记录');}
    finally{if(button&&!disposed)button.disabled=!!wasDisabled;}
  }
  function drawer(name,restore=false){
    root.dataset.drawer=name;
    $$('.lab-mobile-toggle').forEach(button=>button.setAttribute('aria-expanded',String(button.dataset.drawerToggle===name)));
    const narrow=media.matches;
    $('.lab-nav').inert=narrow&&name!=='nav';$('.lab-inspector').inert=narrow&&name!=='inspector';
    if(restore&&lastDrawerButton)lastDrawerButton.focus();
  }
  for(const button of $$('.lab-mobile-toggle'))button.addEventListener('click',()=>{lastDrawerButton=button;const name=root.dataset.drawer===button.dataset.drawerToggle?'':button.dataset.drawerToggle;drawer(name);if(name)(name==='nav'?nav.querySelector('[aria-current="page"]'):$('.lab-tab[aria-selected="true"]'))?.focus();},events);
  for(const button of $$('.lab-close,.lab-scrim'))button.addEventListener('click',()=>drawer('',true),events);
  const onMedia=()=>drawer(media.matches?'':root.dataset.drawer);media.addEventListener('change',onMedia);
  root.addEventListener('keydown',event=>{if(event.key==='Escape'&&root.dataset.drawer){event.preventDefault();drawer('',true);}},events);
  function selectTab(name,focus=false){
    if(currentTab!==name)$('.lab-inspector').scrollTop=0;
    currentTab=name;for(const tab of $$('.lab-tab')){const active=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus)tab.focus();}
    for(const panel of $$('.lab-tabpanel'))panel.hidden=panel.dataset.panel!==name;
  }
  for(const tab of $$('.lab-tab')){
    tab.id=`${uid}-tab-${tab.dataset.tab}`;tab.setAttribute('aria-controls',`${uid}-panel-${tab.dataset.tab}`);
    const panel=$(`[data-panel="${tab.dataset.tab}"]`);panel.id=`${uid}-panel-${tab.dataset.tab}`;panel.setAttribute('aria-labelledby',tab.id);
    tab.addEventListener('click',()=>selectTab(tab.dataset.tab),events);
    tab.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const tabs=$$('.lab-tab'),index=tabs.indexOf(tab);const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;selectTab(tabs[next].dataset.tab,true);},events);
  }
  catalog.forEach((module,index)=>{
    const button=node('button','lab-module');button.type='button';button.dataset.labModule=module.id;
    const info=node('span');info.append(node('span','lab-module-title',module.title),node('span','lab-module-key',module.referenceKey||module.id));
    button.append(node('span','lab-module-index',String(index+1).padStart(2,'0')),info,node('i','lab-module-status'));
    button.addEventListener('click',()=>{if(state.selected===module.id){drawer('',true);return;}invoke(onSelect,[module.id]);drawer('',true);},events);
    button.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...moduleButtons.values()];const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[next]?.focus();},events);
    moduleButtons.set(module.id,button);nav.append(button);
  });
  text($('.lab-nav-heading>span'),String(catalog.length).padStart(2,'0'));
  LAB_ITERATION_CONTRACT.steps.forEach(step=>$('.lab-contract ol').append(node('li','',step)));
  $('#lab-pause').addEventListener('click',()=>invoke(onPause,[!state.paused]),events);
  $('#lab-reset').addEventListener('click',()=>invoke(onReset,[],$('#lab-reset'),'场景已重置'),events);
  $('#lab-copy').addEventListener('click',()=>invoke(onCopy,[],$('#lab-copy'),'配置已复制'),events);
  $('#lab-export').addEventListener('click',()=>invoke(onExport,[],$('#lab-export'),'报告已导出'),events);
  $('#lab-copy').disabled=!onCopy;$('#lab-export').disabled=!onExport;$('#lab-reset').disabled=!onReset;$('#lab-pause').disabled=!onPause;
  function changed(key,value,render){const signature=stringify(value);if(cache[key]===signature)return;cache[key]=signature;render();}
  function renderControls(){
    const controls=state.controls||[];
    changed('controlShape',controls.map(({key,label,type,min,max,step,options})=>({key,label,type,min,max,step,options})),()=>{
      controlEvents.abort();controlEvents=new AbortController();
      fields.clear();controlsHost.replaceChildren();
      if(!controls.length){controlsHost.append(node('p','lab-empty','当前模块没有可调参数。可使用场景操作或预设视角。'));return;}
      controls.forEach((control,index)=>{
        const block=node('div',`lab-control${control.type==='toggle'?' lab-control-toggle':''}`),label=node('label');
        const id=`${uid}-control-${index}`;label.htmlFor=id;label.append(node('span','',control.label||control.key));
        let input,output;
        if(control.type==='select'){
          input=node('select');for(const option of control.options||[]){const item=typeof option==='object'?option:{value:option,label:option};const el=node('option','',item.label??item.value);el.value=String(item.value);input.append(el);}block.append(label,input);
        }else if(control.type==='toggle'){
          input=node('input');input.type='checkbox';const wrap=node('span','lab-switch-wrap');wrap.append(input,node('span','lab-switch'));label.append(wrap);block.append(label);
        }else{
          input=node('input');input.type='range';input.min=control.min??0;input.max=control.max??1;input.step=control.step??.01;
          output=node('output');output.htmlFor=id;label.append(output);const bounds=node('div','lab-range-bounds');bounds.append(node('span','',number(input.min,control.step)),node('span','',number(input.max,control.step)));block.append(label,input,bounds);
        }
        input.id=id;input.dataset.control=control.key;
        const field={input,output,descriptor:control};fields.set(control.key,field);
        input.addEventListener(control.type==='range'?'input':'change',()=>{
          const value=control.type==='toggle'?input.checked:control.type==='range'?Number(input.value):input.value;
          if(output)text(output,number(value,field.descriptor.step));invoke(onControl,[control.key,value]);
        },{signal:controlEvents.signal});
        controlsHost.append(block);
      });
    });
    for(const control of controls){const field=fields.get(control.key);if(!field)continue;field.descriptor=control;const {input,output}=field;
      input.disabled=!!control.disabled||!!state.loading;
      if(control.type==='toggle')input.checked=!!control.value;
      else if(input.value!==String(control.value??''))input.value=String(control.value??'');
      if(output)text(output,number(control.value,control.step));
    }
  }
  function renderActions(){changed('actions',state.actions||[],()=>{
    actionEvents.abort();actionEvents=new AbortController();
    actionsHost.replaceChildren();for(const action of state.actions||[]){const button=node('button','lab-action',action.label||action.id);button.type='button';button.dataset.action=action.id;button.disabled=!!action.disabled;button.addEventListener('click',()=>invoke(onAction,[action.id],button),{signal:actionEvents.signal});actionsHost.append(button);}
  });}
  function renderCameras(){changed('cameras',state.cameraPresets||[],()=>{
    cameraEvents.abort();cameraEvents=new AbortController();
    cameraHost.replaceChildren();for(const preset of state.cameraPresets||[]){const button=node('button','lab-camera',preset.label||preset.id);button.type='button';button.dataset.camera=preset.id;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>invoke(onCamera,[preset.id]),{signal:cameraEvents.signal});cameraHost.append(button);}
  });for(const button of cameraHost.children)button.setAttribute('aria-pressed',String(button.dataset.camera===(state.camera||state.cameraPreset)));}
  function renderMetrics(){
    const metrics=state.metrics||{},now=performance.now();
    const aliases={fps:['fps','帧率'],calls:['calls','drawCalls','绘制调用'],drawCalls:['drawCalls','calls','绘制调用']};
    const value=key=>{const name=(aliases[key]||[key]).find(name=>metrics[name]!==undefined);const raw=metrics[name];return typeof raw==='object'?raw?.value:raw;};
    $('[data-stat="fps"]').parentElement.hidden=value('fps')==null;
    $('.lab-stage-stats').dataset.hasFps=String(value('fps')!=null);
    text($('[data-stat="fps"]'),value('fps')==null?'—':number(value('fps'),1));
    text($('[data-stat="calls"]'),value('calls')==null&&value('drawCalls')==null?'—':number(value('calls')??value('drawCalls'),1));
    if(now-lastMetrics<200)return;lastMetrics=now;
    changed('metrics',metrics,()=>{const host=$('.lab-metrics');host.replaceChildren();if(!Object.keys(metrics).length){host.append(node('dt','','等待场景指标'),node('dd','','—'));return;}
      for(const object of metricRows(metrics)){const value=typeof object.value==='number'?number(object.value):typeof object.value==='boolean'?(object.value?'是':'否'):String(object.value??'—');host.append(node('dt','',object.label),node('dd','',`${value}${object.unit?' '+object.unit:''}`));}
    });
  }
  function renderChecks(){
    const checks=state.checks?.length?state.checks:(current().checks||[]).map(name=>({name,pass:null,detail:'等待场景执行检查'}));
    const passed=checks.filter(check=>check.pass===true).length,failed=checks.filter(check=>check.pass===false).length;
    text($('.lab-check-count'),`${passed} / ${checks.length} 通过`);
    const button=moduleButtons.get(state.selected);if(button)button.dataset.status=failed?'fail':passed===checks.length&&passed?'pass':'pending';
    changed('checks',checks,()=>{const host=$('.lab-checks');host.replaceChildren();
      if(!checks.length){host.append(node('li','lab-empty','尚无检查项目。'));return;}
      for(const check of checks){const status=check.pass===true?'pass':check.pass===false?'fail':'pending',item=node('li','lab-check');item.dataset.status=status;const symbol=node('span','lab-check-symbol',status==='pass'?'✓':status==='fail'?'!':'·');symbol.setAttribute('aria-label',status==='pass'?'通过':status==='fail'?'失败':'待验证');item.append(symbol,node('b','',check.name||'未命名检查'));if(check.detail)item.append(node('p','',check.detail));host.append(item);}
    });
  }
  function renderEvidence(){
    const module=current(),items=evidenceList(state.referenceEvidence??module.referenceEvidence);
    changed('evidence',[items,module.sourceFiles],()=>{
      const host=$('.lab-evidence-list');host.replaceChildren();
      if(!items.length)host.append(node('p','lab-empty','此模块尚未提供参考证据。'));
      for(const item of items){const article=node('article','lab-evidence');if(item.name||item.title)article.append(node('h3','',item.name||item.title));article.append(node('p','',item.detail??item.description??item.text??stringify(item)));if(item.source||item.location)article.append(node('code','',item.source||item.location));host.append(article);}
      const files=$('.lab-sources>div');files.replaceChildren();for(const file of module.sourceFiles||[])files.append(node('code','',file));
    });
  }
  function renderErrors(){
    const errors=[...(Array.isArray(state.errors)?state.errors:state.errors?[state.errors]:[]),...localErrors].map(error=>error?.message||String(error));
    changed('errors',errors,()=>{const host=$('.lab-errorbox');host.hidden=!errors.length;host.replaceChildren();if(errors.length){host.append(node('strong','',`${errors.length} 条错误记录`));for(const error of errors.slice(-5))host.append(node('p','lab-error',error));}});
  }
  function update(patch={}){
    if(disposed)return;
    const next=patch.selected??patch.moduleId??patch.id;
    if(next&&next!==state.selected){state={selected:next,controls:[],actions:[],metrics:{},checks:[],cameraPresets:[],paused:false,time:0,errors:[]};localErrors.length=0;lastMetrics=-Infinity;}
    state={...state,...patch};if(next)state.selected=next;
    const module=current();root.dataset.module=state.selected||'';
    for(const [id,button]of moduleButtons){if(id===state.selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}
    text($('.lab-stage-kicker'),`${String(catalog.indexOf(module)+1).padStart(2,'0')} / ${module.kicker||module.referenceKey||'MODULE'}`);
    text($('.lab-stage-heading h1'),state.title||module.title||'模块展示');text($('.lab-stage-description'),state.description||module.description||'');
    text($('#lab-pause'),state.paused?'▶ 继续':'Ⅱ 暂停');$('#lab-pause').setAttribute('aria-pressed',String(!!state.paused));$('.lab-live').classList.toggle('is-paused',!!state.paused);text($('.lab-live span'),state.paused?'PAUSED':'LIVE SCENE');
    const t=Math.max(0,Number(state.time)||0);text($('.lab-clock'),`${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(1).padStart(4,'0')}`);
    renderControls();renderActions();renderCameras();renderMetrics();renderChecks();renderEvidence();renderErrors();
  }
  selectTab(currentTab);drawer('');update(state);
  return {viewport,element:root,update,dispose(){if(disposed)return;disposed=true;eventController.abort();controlEvents.abort();actionEvents.abort();cameraEvents.abort();media.removeEventListener('change',onMedia);clearTimeout(toastTimer);root.remove();if(!previousBodyClass)document.body.classList.remove('lab-mode');}};
}
