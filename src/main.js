// 入口
import { Game } from './game.js';
import { startLab } from './lab/runtime.js';

const query=new URLSearchParams(location.search);
const task=query.has('lab')||query.has('show')?startLab():new Game().init();
task.catch((e) => {
  console.error(e);
  const el = document.getElementById('loadTxt');
  if (el) el.textContent = '加载失败：' + (e && e.message ? e.message : e) + '（请使用最新版 Chrome / Edge / Safari）';
  else {const message=document.createElement('p');message.style.cssText='position:fixed;bottom:20px;left:20px;z-index:999;background:#211;color:#fff;padding:20px';message.textContent='展示场加载失败：'+e.message;document.body.append(message);}
});
