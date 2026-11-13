// HUD 与菜单（DOM）
import { WEAPONS, PRIMARIES } from './weapons.js';

const TEAM_CN = { BL: '潜伏者', GR: '保卫者' };
const $ = (s, r = document) => r.querySelector(s);
export const NAME_COLORS = Object.freeze({ ally: '#8cc8ff', enemy: '#ff6262' });
export const nameClass = (team, myTeam) => team === myTeam ? 'name-ally' : 'name-enemy';

// A second thumb may not produce a compatibility click while the first stays
// on the game surface. Only these modal buttons need the touch-up fallback.
function bindModalButton(button, action) {
  const pressed = new Set();
  let fallback = null;
  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'touch' && !event.isPrimary) pressed.add(event.pointerId);
  });
  button.addEventListener('pointerup', event => {
    if (!pressed.delete(event.pointerId) || event.pointerType !== 'touch' || event.isPrimary) return;
    const box = button.getBoundingClientRect();
    if (!box.width || !box.height || button.disabled || event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return;
    if (event.cancelable) event.preventDefault();
    fallback = { id: event.pointerId, time: performance.now() };
    action();
  });
  for (const type of ['pointercancel', 'lostpointercapture']) button.addEventListener(type, event => pressed.delete(event.pointerId));
  button.addEventListener('click', event => {
    // Some browsers also dispatch click after non-primary touch. Suppress only
    // that gesture; keyboard activation and other primary clicks still work.
    const age = fallback ? performance.now() - fallback.time : Infinity;
    if (event.detail !== 0 && age < 600 && (event.pointerId === fallback?.id || (event.pointerId === undefined && age < 50))) {
      fallback = null; return;
    }
    fallback = null; action();
  });
  window.addEventListener('blur', () => pressed.clear());
}

const HS_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><g fill="none" stroke="#ff4030" stroke-width="3"><circle cx="20" cy="20" r="11"/><path d="M20 2v10M20 28v10M2 20h10M28 20h10"/></g><circle cx="20" cy="20" r="3.5" fill="#ff4030"/></svg>`);
const WB_ICON = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="15" y="4" width="10" height="32" fill="#bbb"/><path d="M2 20h36" stroke="#ffd24a" stroke-width="3"/></svg>`);
const BADGE_SVG = (color, inner) => `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="bg" cx="50%" cy="45%"><stop offset="0" stop-color="${color}" stop-opacity=".95"/><stop offset="1" stop-color="#1a0a00" stop-opacity=".9"/></radialGradient></defs><polygon points="50,3 93,27 93,73 50,97 7,73 7,27" fill="url(#bg)" stroke="#ffd24a" stroke-width="3"/>${inner}</svg>`;
const SKULL = `<g fill="#fff"><path d="M50 22c-14 0-24 9-24 22 0 8 4 13 9 16v9h30v-9c5-3 9-8 9-16 0-13-10-22-24-22z"/><rect x="40" y="66" width="4" height="8"/><rect x="48" y="66" width="4" height="8"/><rect x="56" y="66" width="4" height="8"/></g><circle cx="41" cy="45" r="6" fill="#3a1500"/><circle cx="59" cy="45" r="6" fill="#3a1500"/>`;
const CROSSHAIR_B = `<g fill="none" stroke="#fff" stroke-width="4"><circle cx="50" cy="50" r="20"/><path d="M50 18v14M50 68v14M18 50h14M68 50h14"/></g><circle cx="50" cy="50" r="5" fill="#ff3020"/>`;

export class HUD {
  constructor(game) {
    this.g = game;
    this.root = $('#ui');
    this.root.innerHTML = TEMPLATE;
    for (const [relation, color] of Object.entries(NAME_COLORS)) this.root.style.setProperty(`--name-${relation}`, color);
    this.el = {};
    for (const n of this.root.querySelectorAll('[id]')) this.el[n.id] = n;
    this.icons = {};
    this.feedItems = [];
    this.dmgDirs = [];
    this.hitT = 0; this.toastT = 0;
    this.slotsT = 0;
    this.radarCtx = this.el.radar.getContext('2d');
    const touch = matchMedia('(pointer:coarse)').matches || new URLSearchParams(location.search).has('touch');
    this.touchUI = touch;
    this.root.classList.toggle('touch-ui', touch);
    this.opts = { mode: 'tdm', team: 'BL', primary: 'm4a1', size: 5, diff: 'normal', goal: 50, tod: 'dusk', quality: touch ? 'low' : 'high', sens: 1.0, fov: 78, vol: 0.8 };
    try { Object.assign(this.opts, JSON.parse(localStorage.getItem('harbor_after_rain_opts_v1') || '{}')); } catch (e) { /* 忽略 */ }
    if (!['tdm', 'relay'].includes(this.opts.mode)) this.opts.mode = 'tdm';
    this.buildMenu();
  }
  saveOpts() { try { localStorage.setItem('harbor_after_rain_opts_v1', JSON.stringify(this.opts)); } catch (e) { /* 忽略 */ } }

  // ---------- 菜单 ----------
  buildMenu() {
    const o = this.opts;
    const segs = this.root.querySelectorAll('.seg[data-k]');
    for (const s of segs) {
      const k = s.dataset.k;
      for (const b of s.querySelectorAll('button')) {
        if (String(o[k]) === b.dataset.v) b.classList.add('on');
        b.setAttribute('aria-pressed', String(String(o[k]) === b.dataset.v));
        b.addEventListener('click', () => {
          for (const x of s.querySelectorAll('button')) { x.classList.remove('on'); x.setAttribute('aria-pressed', 'false'); }
          b.classList.add('on'); b.setAttribute('aria-pressed', 'true');
          o[k] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
          this.saveOpts();
          if (k === 'goal') this.syncMode();
          this.g.onOption?.(k, o[k]);
          this.g.audio?.playUI('click');
        });
      }
    }
    for (const sl of this.root.querySelectorAll('.slider[data-k]')) {
      const k = sl.dataset.k, inp = sl.querySelector('input'), sp = sl.querySelector('span');
      inp.value = o[k]; sp.textContent = (+o[k]).toFixed(k === 'fov' ? 0 : 2);
      inp.addEventListener('input', () => {
        o[k] = +inp.value; sp.textContent = (+inp.value).toFixed(k === 'fov' ? 0 : 2); this.saveOpts();
        this.g.onOption?.(k, o[k]);
      });
    }
    for (const button of this.root.querySelectorAll('[data-start-mode]')) button.addEventListener('click', () => {
      o.mode = button.dataset.startMode; this.saveOpts(); this.syncMode();
      this.g.onOption?.('mode', o.mode); this.g.audio?.playUI('click');
      this.g.startMatch();
      if (this.touchUI) this.toast('左拇指拖动移动 · 右拇指滑动转向<br>按住开火并拖动，可边射击边瞄准', 4.5);
    });
    this.syncMode();
    bindModalButton($('#btnResume'), () => this.g.resume());
    bindModalButton($('#btnQuit'), () => this.g.quitToMenu());
    bindModalButton($('#btnAgain'), () => this.g.startMatch());
    bindModalButton($('#btnMenu'), () => this.g.quitToMenu());
    for (const c of this.root.querySelectorAll('#loadCards .card')) {
      c.addEventListener('click', () => {
        this.g.chooseLoadout(c.dataset.w);
        for (const x of this.root.querySelectorAll('#loadCards .card')) x.classList.toggle('on', x === c);
      });
    }
    bindModalButton($('#btnLoadClose'), () => this.g.closeLoadout());
    if (this.touchUI) for (const note of this.root.querySelectorAll('.touch-instructions')) note.classList.remove('hidden');
    for (const a of this.root.querySelectorAll('#clinks a, .mlinks a'))
      a.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  }
  setIcons(icons) {
    this.icons = icons;
    for (const c of this.root.querySelectorAll('#loadCards .card')) c.querySelector('img').src = icons[c.dataset.w] || '';
  }
  syncMode() {
    const goal = Number(this.opts.goal) || 50;
    this.el.tdmTarget.textContent = goal;
    this.el.relayTarget.textContent = goal;
    this.el.goalLabel.textContent = '提前结束目标';
    this.el.modeHint.textContent = `团队竞技 ${goal} 次击杀 · 中继争夺 ${goal} 积分`;
  }
  syncControls() {
    const o = this.opts;
    this.syncMode();
    for (const s of this.root.querySelectorAll('.seg[data-k]')) for (const b of s.querySelectorAll('button')) {
      const active = String(o[s.dataset.k]) === b.dataset.v; b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active));
    }
    for (const sl of this.root.querySelectorAll('.slider[data-k]')) {
      const k = sl.dataset.k; sl.querySelector('input').value = o[k]; sl.querySelector('span').textContent = (+o[k]).toFixed(k === 'fov' ? 0 : 2);
    }
  }
  show(name) {
    if (name === 'menu' || name === 'pause') this.syncControls();
    for (const n of ['menu', 'pause', 'end', 'loadout', 'loading']) this.el[n].classList.toggle('hidden', n !== name);
    this.el.hud.classList.toggle('hidden', name === 'menu' || name === 'loading' || name === 'end');
  }
  loading(p, text) { this.el.loadBar.style.width = (p * 100).toFixed(0) + '%'; if (text) this.el.loadTxt.textContent = text; }

  // ---------- 局内 ----------
  update(dt, s) {
    const e = this.el;
    // 比分与时间
    e.sBL.textContent = s.score.BL; e.sGR.textContent = s.score.GR;
    const tl = Math.max(0, Math.ceil(s.timeLeft)), mm = (tl / 60) | 0, ss = tl % 60;
    e.sTime.textContent = `${mm}:${ss < 10 ? '0' : ''}${ss}`;
    e.sGoal.textContent = `${this.opts.mode === 'relay' ? '中继争夺' : '团队竞技'} · ${s.goal} 分`;
    e.boardMode.textContent = this.opts.mode === 'relay' ? '中继争夺' : '团队竞技';
    e.tBL.classList.toggle('mine', s.myTeam === 'BL'); e.tGR.classList.toggle('mine', s.myTeam === 'GR');
    // 生命护甲
    e.hpVal.textContent = Math.max(0, Math.ceil(s.hp));
    e.arVal.textContent = Math.max(0, Math.ceil(s.armor));
    e.hpBox.classList.toggle('low', s.hp <= 30 && s.alive);
    // 弹药
    const w = s.weapon;
    if (w) {
      const d = w.def;
      e.wName.textContent = d.hudName; e.wIcon.alt = d.name;
      if (d.type === 'melee') { e.aMag.textContent = '∞'; e.aRes.textContent = ''; }
      else if (d.type === 'grenade') { e.aMag.textContent = w.mag; e.aRes.textContent = ''; }
      else { e.aMag.textContent = w.mag; e.aRes.textContent = '/ ' + w.reserve; }
      e.aMag.classList.toggle('low', d.mag > 1 && w.mag <= Math.ceil(d.mag * 0.2));
      if (this.icons[d.id] && e.wIcon.dataset.id !== d.id) { e.wIcon.src = this.icons[d.id]; e.wIcon.dataset.id = d.id; }
      e.aHint.textContent = w.reloading ? '换弹中…' : (d.mag > 1 && w.mag === 0 && w.reserve === 0 ? '弹药耗尽' : (d.mag > 1 && w.mag === 0 ? '按 R 换弹' : ''));
    }
    // 准星
    const showX = s.alive && !s.scoped && (s.ads || 0) < 0.65 && w && w.def.type !== 'sniper';
    e.cross.style.display = showX ? '' : 'none';
    if (showX) {
      const gap = 4 + s.spreadPx;
      e.cT.style.top = -(gap + 9) + 'px'; e.cB.style.top = gap + 'px';
      e.cL.style.left = -(gap + 9) + 'px'; e.cR.style.left = gap + 'px';
    }
    e.scope.classList.toggle('on', !!s.scoped && s.alive);
    // 命中标记
    if (this.hitT > 0) { this.hitT -= dt; e.hit.style.opacity = Math.min(1, this.hitT * 5); } else e.hit.style.opacity = 0;
    // 受击方向
    for (const d of this.dmgDirs) {
      d.t -= dt;
      const rel = d.ang - s.yaw;
      d.el.style.transform = `rotate(${-rel}rad)`;
      d.el.style.opacity = Math.max(0, Math.min(1, d.t));
      if (d.t <= 0) d.el.remove();
    }
    this.dmgDirs = this.dmgDirs.filter((d) => d.t > 0);
    // 击杀信息淡出
    const now = performance.now();
    this.feedItems = this.feedItems.filter((f) => { if (now - f.t > 7000) { f.el.remove(); return false; } return true; });
    // 提示
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) e.toast.style.opacity = 0; }
    // 中央信息
    if (!s.alive && s.respawnIn > 0) {
      e.center.classList.remove('hidden');
      e.cBig.innerHTML = s.killedBy || '你阵亡了';
      e.cSmall.textContent = `${s.respawnIn.toFixed(1)} 秒后复活 · 按 B 更换武器`;
    } else e.center.classList.add('hidden');
    e.protect.textContent = s.protect > 0 && s.alive ? `出生保护 ${s.protect.toFixed(1)}s（开火即解除）` : '';
    e.nameTip.textContent = s.aimName || ''; e.nameTip.className = s.aimTeam ? nameClass(s.aimTeam, s.myTeam) : '';
    if (this.slotsT > 0) { this.slotsT -= dt; e.slots.style.opacity = Math.min(1, this.slotsT * 2); } else e.slots.style.opacity = 0;
  }
  updateObjective(data) {
    const e = this.el;
    const visible = !!data && data.visible !== false;
    e.objective.classList.toggle('hidden', !visible);
    if (!visible) return;
    const progress = Math.max(-1, Math.min(1, Number(data.progress) || 0));
    const bl = data.progressBL == null ? Math.max(0, -progress) : Math.max(0, Math.min(1, data.progressBL));
    const gr = data.progressGR == null ? Math.max(0, progress) : Math.max(0, Math.min(1, data.progressGR));
    e.objBL.style.width = (bl * 50) + '%'; e.objGR.style.width = (gr * 50) + '%';
    e.objective.dataset.owner = data.owner || 'neutral';
    e.objective.classList.toggle('contested', !!data.contested);
    e.objLabel.textContent = data.label || '中继节点';
    e.objState.textContent = data.contested ? '交火争夺' : data.owner ? TEAM_CN[data.owner] + '控制' : '等待占领';
    e.objHint.textContent = data.hint || (data.contested ? '清除区域内敌人以继续计分' : '进入标记区域，夺取中继控制权');
  }
  slots(inv, cur) {
    const e = this.el.slots;
    e.innerHTML = '';
    ['主武器', '副武器', '近身', '投掷'].forEach((lab, i) => {
      const w = inv[i];
      if (!w) return;
      const d = document.createElement('div');
      d.className = 's' + (i === cur ? ' on' : '');
      d.innerHTML = `<span>${w.def.name}</span><img src="${this.icons[w.id] || ''}"><b>${i + 1}</b>`;
      e.appendChild(d);
    });
    this.slotsT = 2.2;
  }
  killFeed(k, v, wid, hs, wb, mine) {
    const d = document.createElement('div');
    d.className = 'kf' + (mine ? ' me' : '');
    const icon = this.icons[wid] ? `<img src="${this.icons[wid]}">` : `<span>[${WEAPONS[wid]?.name || wid}]</span>`;
    const myTeam = this.g.player?.team || this.opts.team;
    d.innerHTML = (k ? `<span class="k ${nameClass(k.team, myTeam)}">${esc(k.name)}</span>` : '') + icon + (wb ? `<img class="hs" src="${WB_ICON}">` : '') + (hs ? `<img class="hs" src="${HS_ICON}">` : '') + `<span class="v ${nameClass(v.team, myTeam)}">${esc(v.name)}</span>`;
    this.el.feed.prepend(d);
    this.feedItems.push({ el: d, t: performance.now() });
    while (this.feedItems.length > 6) { const f = this.feedItems.shift(); f.el.remove(); }
  }
  hitmarker(hs, kill) {
    this.el.hit.className = kill ? 'kill' : hs ? 'hs' : '';
    this.hitT = kill ? 0.45 : 0.22;
  }
  damageFrom(ang) {
    const d = document.createElement('div'); d.className = 'dd';
    this.el.dmgDirs.appendChild(d);
    this.dmgDirs.push({ el: d, ang, t: 1.4 });
  }
  badge(text, sub, headshot) {
    const b = this.el.badge;
    b.classList.remove('show'); void b.offsetWidth;
    b.querySelector('.ico').innerHTML = BADGE_SVG(headshot ? '#c0301a' : '#b8860b', headshot ? CROSSHAIR_B : SKULL);
    b.querySelector('.txt').textContent = text;
    b.querySelector('.sub').textContent = sub || '';
    b.classList.add('show');
  }
  toast(text, dur = 2.5) { const t = this.el.toast; t.innerHTML = text; t.style.opacity = 1; this.toastT = dur; }
  scoreboard(show, actors, myId, score) {
    this.el.board.classList.toggle('hidden', !show);
    if (!show) return;
    const myTeam = actors.find(a => a.id === myId)?.team || this.opts.team;
    const rows = (team) => actors.filter((a) => a.team === team).sort((a, b) => b.stats.k - a.stats.k || a.stats.d - b.stats.d)
      .map((a) => `<tr class="${a.id === myId ? 'me' : ''} ${a.alive ? '' : 'dead'}"><td class="${nameClass(a.team, myTeam)}">${esc(a.name)}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.hs}</td><td>${a.alive ? '作战' : '重整'}</td></tr>`).join('');
    const tbl = (team) => `<table class="t${team}"><tr><th class="team">${TEAM_CN[team]} · ${score[team]}</th><th>击杀</th><th>死亡</th><th>爆头</th><th>状态</th></tr>${rows(team)}</table>`;
    this.el.boardBody.innerHTML = `<div class="cols">${tbl('BL')}${tbl('GR')}</div>`;
  }
  endScreen(win, score, actors, myId) {
    this.show('end');
    const r = this.el.endRes;
    r.textContent = win === null ? '平局' : win ? '胜利' : '失败';
    r.className = 'res ' + (win ? 'win' : 'lose');
    this.el.endSc.textContent = `潜伏者 ${score.BL} : ${score.GR} 保卫者`;
    const mvp = [...actors].sort((a, b) => (b.stats.k * 2 - b.stats.d + b.stats.hs) - (a.stats.k * 2 - a.stats.d + a.stats.hs))[0];
    const me = actors.find((a) => a.id === myId);
    const myTeam = me?.team || this.opts.team;
    this.el.endMvp.innerHTML = mvp ? `MVP：<span class="${nameClass(mvp.team, myTeam)}">${esc(mvp.name)}</span>（${mvp.stats.k} 杀 / ${mvp.stats.hs} 爆头）` : '';
    const acc = me && me.stats.shots ? ((me.stats.hits / me.stats.shots) * 100).toFixed(1) : '0';
    this.el.endMe.textContent = me ? `你的战绩：${me.stats.k} 击杀 · ${me.stats.d} 死亡 · ${me.stats.hs} 爆头 · 命中率 ${acc}%` : '';
    const rows = (team) => actors.filter((a) => a.team === team).sort((a, b) => b.stats.k - a.stats.k)
      .map((a) => `<tr class="${a.id === myId ? 'me' : ''}"><td class="${nameClass(a.team, myTeam)}">${esc(a.name)}</td><td>${a.stats.k}</td><td>${a.stats.d}</td><td>${a.stats.hs}</td></tr>`).join('');
    const tbl = (team) => `<table class="t${team}"><tr><th class="team">${TEAM_CN[team]}</th><th>击杀</th><th>死亡</th><th>爆头</th></tr>${rows(team)}</table>`;
    this.el.endTable.innerHTML = `<div class="cols">${tbl('BL')}${tbl('GR')}</div>`;
  }
  // ---------- 小地图 ----------
  buildRadar(world, bounds) {
    const S = 8; // px/m
    this.radarBounds = bounds;
    const ox = -bounds.minX, oz = -bounds.minZ;
    const W = (bounds.maxX - bounds.minX) * S, H = (bounds.maxZ - bounds.minZ) * S;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = 'rgba(70,80,84,0.95)'; x.fillRect(0, 0, W, H);
    const cols = [...world.colliders].filter((k) => k.solid && k.top > 0.3 && k.bottom < 2 && k.hx < 30 && k.tag !== 'deck').sort((a, b) => a.top - b.top);
    for (const k of cols) {
      if (k.bullet === 'pass' && k.mat !== 'mesh') continue;
      x.save();
      x.translate((k.x + ox) * S, (k.z + oz) * S);
      x.rotate(-k.yaw);
      const hgt = k.top;
      x.fillStyle = k.mat === 'mesh' ? 'rgba(200,200,190,.5)' : hgt > 4 ? '#1d2327' : hgt > 2 ? '#2d353a' : hgt > 1.3 ? '#3b454b' : '#56616a';
      x.fillRect(-k.hx * S, -k.hz * S, k.hx * 2 * S, k.hz * 2 * S);
      x.strokeStyle = 'rgba(0,0,0,.5)'; x.lineWidth = 1;
      x.strokeRect(-k.hx * S, -k.hz * S, k.hx * 2 * S, k.hz * 2 * S);
      x.restore();
    }
    // 管道顶棚（二楼）用虚线表示
    x.strokeStyle = 'rgba(245,179,33,.35)'; x.setLineDash([6, 4]);
    for (const k of world.colliders) {
      if (!k.solid || k.top < 2 || k.top > 4 || k.bottom < 2 || k.hx < 1) continue;
      x.save(); x.translate((k.x + ox) * S, (k.z + oz) * S); x.rotate(-k.yaw);
      x.strokeRect(-k.hx * S, -k.hz * S, k.hx * 2 * S, k.hz * 2 * S); x.restore();
    }
    this.radarImg = c; this.radarS = S;
  }
  drawRadar(me, actors, t) {
    const ctx = this.radarCtx, cv = this.el.radar;
    const W = cv.width = cv.clientWidth * 1.5 | 0, H = cv.height = cv.clientHeight * 1.5 | 0;
    ctx.clearRect(0, 0, W, H);
    if (!this.radarImg) return;
    const S = this.radarS, zoom = 0.55 * (W / 294);
    const ox = -this.radarBounds.minX, oz = -this.radarBounds.minZ;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.rotate(me.yaw);
    ctx.scale(zoom, zoom);
    ctx.translate(-(me.pos.x + ox) * S, -(me.pos.z + oz) * S);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.radarImg, 0, 0);
    ctx.globalAlpha = 1;
    const relay = this.g.objective;
    const relayColor = relay?.contested ? '#ff6554' : relay?.owner === 'BL' ? '#ffb163' : relay?.owner === 'GR' ? '#70c6d6' : '#d7dfd5';
    if (relay?.active) {
      const rx = (relay.position.x + ox) * S, rz = (relay.position.z + oz) * S;
      const radius = relay.radius * S;
      ctx.save(); ctx.strokeStyle = relayColor; ctx.fillStyle = relayColor;
      ctx.globalAlpha = 0.1; ctx.beginPath(); ctx.arc(rx, rz, radius, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = relay.contested ? 0.6 + Math.sin(t * 6) * 0.25 : 0.65;
      ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]); ctx.stroke(); ctx.restore();
    }
    for (const a of actors) {
      if (a === me) continue;
      const seen = a.team === me.team || (a.radarT > 0);
      if (!seen) continue;
      const px = (a.pos.x + ox) * S, pz = (a.pos.z + oz) * S;
      if (!a.alive) {
        if (a.team !== me.team || a.deadT > 5) continue;
        ctx.strokeStyle = '#9aa'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(px - 8, pz - 8); ctx.lineTo(px + 8, pz + 8); ctx.moveTo(px + 8, pz - 8); ctx.lineTo(px - 8, pz + 8); ctx.stroke();
        continue;
      }
      ctx.fillStyle = a.team === me.team ? '#4fb0ff' : '#ff4a3a';
      if (a.team === me.team) {
        ctx.save(); ctx.translate(px, pz); ctx.rotate(-a.yaw);
        ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(0, 4); ctx.lineTo(-8, 9); ctx.closePath(); ctx.fill();
        ctx.restore();
      } else {
        ctx.globalAlpha = Math.min(1, a.radarT);
        ctx.beginPath(); ctx.arc(px, pz, 9, 0, 7); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    // The objective is a fixed-size diamond, distinct from enemy dots. When outside
    // the radar crop, keep it on the edge so the active relay remains discoverable.
    if (relay?.active) {
      const dx = (relay.position.x - me.pos.x) * S * zoom;
      const dz = (relay.position.z - me.pos.z) * S * zoom;
      const c = Math.cos(me.yaw), sn = Math.sin(me.yaw);
      let rx = dx * c - dz * sn, rz = dx * sn + dz * c;
      const edge = Math.max(Math.abs(rx) / Math.max(1, W / 2 - 19), Math.abs(rz) / Math.max(1, H / 2 - 23), 1);
      rx /= edge; rz /= edge;
      ctx.save(); ctx.translate(W / 2 + rx, H / 2 + rz);
      ctx.fillStyle = 'rgba(10,22,27,.95)'; ctx.strokeStyle = relayColor; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -12); ctx.lineTo(12, 0); ctx.lineTo(0, 12); ctx.lineTo(-12, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = relayColor; ctx.font = '600 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('R', 0, 0.5);
      if (edge > 1) {
        ctx.rotate(Math.atan2(dz * c + dx * sn, dx * c - dz * sn));
        ctx.beginPath(); ctx.moveTo(19, 0); ctx.lineTo(15, -4); ctx.lineTo(15, 4); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
    }
    // 自己
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath(); ctx.moveTo(W / 2, H / 2 - 10); ctx.lineTo(W / 2 + 7, H / 2 + 8); ctx.lineTo(W / 2, H / 2 + 4); ctx.lineTo(W / 2 - 7, H / 2 + 8); ctx.closePath(); ctx.fill();
    // 视野扇形
    const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.45);
    g.addColorStop(0, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(W / 2, H / 2); ctx.arc(W / 2, H / 2, W * 0.45, -Math.PI / 2 - 0.6, -Math.PI / 2 + 0.6); ctx.closePath(); ctx.fill();
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

const PRIM_CARDS = PRIMARIES.map((id) => {
  const d = WEAPONS[id];
  const sub = { ak47: '潜伏者经典 · 伤害高', m4a1: '保卫者经典 · 稳定', awm: '一枪致命 · 需开镜', mp5: '射速快 · 移动灵活' }[id];
  return `<button type="button" class="card" data-w="${id}"><img alt="${d.name}"><b>${d.name}</b><small>${sub}</small></button>`;
}).join('');

const TEMPLATE = `
<div id="landscapeGate" class="hidden" hidden role="dialog" aria-modal="true" aria-labelledby="landscapeTitle" aria-describedby="landscapeCopy landscapeHint">
  <div class="landscape-panel">
    <div class="dialog-eyebrow">HARBOR / AFTER RAIN</div>
    <svg class="landscape-phone" viewBox="0 0 200 124" aria-hidden="true" focusable="false">
      <rect class="phone-portrait" x="73" y="9" width="54" height="98" rx="9"/>
      <path class="phone-turn" d="M137 19A55 55 0 0 1 164 58M155 51L164 58 171 49"/>
      <rect class="phone-landscape" x="32" y="37" width="136" height="74" rx="11"/>
      <path class="phone-speaker" d="M44 63V85"/>
      <circle class="phone-stick" cx="70" cy="83" r="10"/>
      <circle class="phone-stick" cx="137" cy="77" r="10"/>
      <path class="phone-cross" d="M100 65V79M93 72H107"/>
    </svg>
    <h2 id="landscapeTitle">横屏游玩</h2>
    <p id="landscapeCopy">移动端仅支持横屏。请将手机横放后开始行动。</p>
    <button type="button" class="go" id="btnLandscape">进入横屏</button>
    <p id="landscapeHint" aria-live="polite">浏览器未自动旋转时，请手动横放手机。对局中转回横屏后，点击「继续」。</p>
  </div>
</div>
<div id="hud" class="hidden">
  <div id="score">
    <div class="team bl" id="tBL"><span class="nm">潜伏者</span><span class="pts" id="sBL">0</span></div>
    <div class="mid"><div class="time" id="sTime">3:00</div><div class="goal" id="sGoal"></div></div>
    <div class="team gr" id="tGR"><span class="pts" id="sGR">0</span><span class="nm">保卫者</span></div>
  </div>
  <div id="radarWrap"><canvas id="radar"></canvas><div class="lbl">运输船</div></div>
  <div id="clinks" aria-hidden="true"><span>HARBOR / 01</span></div>
  <div id="objective" class="hidden"><div class="obj-top"><span id="objLabel">中继节点</span><b id="objState">等待占领</b></div><div class="obj-track"><i id="objBL"></i><i id="objGR"></i></div><div id="objHint"></div></div>
  <div id="feed"></div>
  <div id="vitals">
    <div class="vbox" id="hpBox"><div class="ic">HP</div><div class="val" id="hpVal">100</div></div>
    <div class="vbox" id="arBox"><div class="ic">AP</div><div class="val" id="arVal">100</div></div>
  </div>
  <div id="slots"></div>
  <div id="ammo"><div class="wname" id="wName"></div><div class="row"><img class="wicon" id="wIcon" alt=""><span class="mag" id="aMag">30</span><span class="res" id="aRes">/ 90</span></div><div class="hint" id="aHint"></div></div>
  <div id="cross"><i class="t" id="cT"></i><i class="b" id="cB"></i><i class="l" id="cL"></i><i class="r" id="cR"></i></div>
  <div id="hit"><i></i><i></i><i></i><i></i></div>
  <div id="dmgDirs"></div>
  <div id="scope"><div class="ring"></div><div class="h"></div><div class="v"></div><div class="h2 l"></div><div class="h2 r"></div><div class="v2"></div><div class="dot"></div></div>
  <div id="badge"><div class="ico"></div><div class="txt"></div><div class="sub"></div></div>
  <div id="center" class="hidden"><div class="big" id="cBig"></div><div class="small" id="cSmall"></div></div>
  <div id="toast"></div>
  <div id="protect"></div>
  <div id="nameTip"></div>
  <div id="board" class="hidden tbl"><h3><span>运输船 · <b id="boardMode">团队竞技</b></span><span>Tab</span></h3><div id="boardBody"></div></div>
  <div id="touch" class="hidden"></div>
</div>

<div id="loading" class="screen"><div class="load-mark">HARBOR / AFTER RAIN</div><div class="t">运输船<span>暮雨行动</span></div><div class="s" id="loadTxt">正在准备行动</div><div class="bar"><i id="loadBar"></i></div><div class="tip">留意脚步与枪声。换弹时退回掩体，与队友交替推进。</div></div>

<div id="menu" class="screen hidden">
  <div class="menu-top"><span>HARBOR / AFTER RAIN</span><span><i></i> 港区行动 · 01</span></div>
  <div class="menuBox">
    <div class="operation-select">
    <div class="title">
      <div class="logo"><i></i> AFTER THE RAIN, INTO THE FIRE.</div>
      <div class="brand-line"><h1>运输船</h1><div class="en">暮雨行动</div></div>
      <p class="premise">穿行雨后甲板，与小队一起推进。选择玩法，即刻开始一场三分钟的行动。</p>
    </div>
    <div class="note touch-instructions hidden" id="touchNote"><b>双拇指操作</b> 左侧拖动移动，右侧滑动转向；按住开火并拖动瞄准。<span>移动端仅支持横屏。</span></div>
    <div class="mode-grid" aria-label="选择玩法并开始行动">
      <article class="mode-card mode-tdm" aria-labelledby="tdmTitle">
        <div class="mode-meta"><span>01 / TEAM DEATHMATCH</span><b>3 分钟</b></div>
        <svg class="mode-diagram" viewBox="0 0 320 116" role="img" aria-label="两支小队利用货箱掩体交战，击败对手累计击杀">
          <g class="diagram-deck"><path d="M24 15H296V101H24Z"/><path d="M24 58H296" stroke-dasharray="3 6"/><path d="M55 15V101M265 15V101"/></g>
          <g class="diagram-cover"><path d="M91 28H130V46H91ZM91 70H130V88H91ZM190 28H229V46H190ZM190 70H229V88H190Z"/><path d="M101 29V45M111 29V45M121 29V45M101 71V87M111 71V87M121 71V87M200 29V45M210 29V45M220 29V45M200 71V87M210 71V87M220 71V87"/></g>
          <g class="diagram-bl"><circle cx="46" cy="46" r="4"/><circle cx="46" cy="70" r="4"/><path d="M59 46H75V58H143M137 52L143 58 137 64"/></g>
          <g class="diagram-gr"><circle cx="274" cy="46" r="4"/><circle cx="274" cy="70" r="4"/><path d="M261 70H245V58H177M183 52L177 58 183 64"/></g>
          <g class="diagram-focus"><path d="M155 51L165 65M165 51L155 65"/><circle cx="160" cy="58" r="16" stroke-dasharray="2 5"/></g>
        </svg>
        <div class="mode-copy"><h2 id="tdmTitle">团队竞技</h2><p>利用掩体与队友推进，击败对手，为队伍累计击杀。</p></div>
        <div class="mode-target"><span>提前获胜</span><b><strong id="tdmTarget">50</strong> 次击杀</b></div>
        <button class="mode-start" id="btnStartTdm" data-start-mode="tdm"><span>进入团队竞技</span><span aria-hidden="true">↗</span></button>
      </article>
      <article class="mode-card mode-relay" aria-labelledby="relayTitle">
        <div class="mode-meta"><span>02 / RELAY CONTROL</span><b>3 分钟</b></div>
        <svg class="mode-diagram" viewBox="0 0 320 116" role="img" aria-label="小队前往当前中继据点，控制区域持续得分，据点随后轮换">
          <g class="diagram-deck"><path d="M24 15H296V101H24Z"/><path d="M55 15V101M265 15V101"/></g>
          <g class="diagram-cover"><path d="M87 27H124V45H87ZM196 71H233V89H196Z"/><path d="M96 28V44M106 28V44M116 28V44M205 72V88M215 72V88M225 72V88"/></g>
          <path class="diagram-route" d="M82 82L160 58 238 34" stroke-dasharray="3 5"/>
          <g class="diagram-inactive"><circle cx="82" cy="82" r="10"/><circle cx="238" cy="34" r="10"/><path d="M78 82H86M234 34H242"/></g>
          <g class="diagram-bl"><circle cx="47" cy="57" r="4"/><circle cx="58" cy="72" r="4"/><path d="M66 58H122M116 52L122 58 116 64"/></g>
          <g class="diagram-gr"><circle cx="273" cy="57" r="4"/><circle cx="262" cy="42" r="4"/><path d="M254 58H198M204 52L198 58 204 64"/></g>
          <g class="diagram-focus"><circle cx="160" cy="58" r="26"/><circle cx="160" cy="58" r="18" stroke-dasharray="2 4"/><path d="M160 46L170 58 160 70 150 58Z"/><path d="M179 23A40 40 0 0 1 199 45M193 42L199 45 202 38"/></g>
        </svg>
        <div class="mode-copy"><h2 id="relayTitle">中继争夺</h2><p>占领中继区持续得分；每 75 秒轮换据点，争夺时暂停计分。</p></div>
        <div class="mode-target"><span>提前获胜</span><b><strong id="relayTarget">50</strong> 积分</b></div>
        <button class="mode-start" id="btnStartRelay" data-start-mode="relay"><span>进入中继争夺</span><span aria-hidden="true">↗</span></button>
      </article>
    </div>
    <p class="match-rule"><b>03:00</b><span>3 分钟到时，高分队伍获胜；先达到目标可提前结束。同分则平局。</span></p>
    <div class="briefing-tools">
      <details class="controls"><summary>操作指南 <span>⌨</span></summary><div class="keys">
        <kbd>W A S D</kbd><span>移动　<kbd>Shift</kbd> 静步　<kbd>空格</kbd> 跳跃　<kbd>C</kbd> 蹲下</span>
        <kbd>鼠标</kbd><span>左键开火 · 按住右键瞄准 / 狙击开镜 / 刀重击</span>
        <kbd>1 2 3 4</kbd><span>切换装备　<kbd>Q</kbd> 快切　<kbd>滚轮</kbd> 切换</span>
        <kbd>R / F / B</kbd><span>换弹 / 检视武器 / 更换主武器</span>
        <kbd>Tab / Esc</kbd><span>计分板 / 暂停与设置</span>
      </div></details>
      <a class="lab-entry" href="?lab=render">九模块展示场 <span aria-hidden="true">↗</span></a>
    </div>
    </div>
    <div class="opts">
      <div class="deploy-heading"><span>共享部署</span><b>LOADOUT / BOTH MODES</b></div>
      <div class="opt"><div class="lab">选择阵营</div><div class="seg team" data-k="team"><button data-v="BL">潜伏者<small>BLACK LIST</small></button><button data-v="GR">保卫者<small>GLOBAL RISK</small></button></div></div>
      <div class="opt"><div class="lab">主武器</div><div class="seg" data-k="primary"><button data-v="ak47">AK-47</button><button data-v="m4a1">M4A1</button><button data-v="awm">AWM</button><button data-v="mp5">MP5</button></div></div>
      <div class="row2">
        <div class="opt"><div class="lab">小队规模</div><div class="seg" data-k="size"><button data-v="4">4v4</button><button data-v="5">5v5</button><button data-v="8">8v8</button></div></div>
        <div class="opt"><div class="lab" id="goalLabel">提前结束目标</div><div class="seg" data-k="goal"><button data-v="30">30</button><button data-v="50">50</button><button data-v="100">100</button></div></div>
      </div>
      <p id="modeHint" class="mode-hint"></p>
      <div class="opt"><div class="lab">对手难度</div><div class="seg" data-k="diff"><button data-v="easy">新兵</button><button data-v="normal">常规</button><button data-v="hard">老练</button><button data-v="hell">精锐</button></div></div>
      <details class="advanced"><summary>画面与操作设置 <span>＋</span></summary><div class="advanced-body">
        <div class="row2">
          <div class="opt"><div class="lab">光照</div><div class="seg" data-k="tod"><button data-v="day">阴晴</button><button data-v="dusk">暮光</button></div></div>
          <div class="opt"><div class="lab">画质</div><div class="seg" data-k="quality"><button data-v="low">流畅</button><button data-v="medium">均衡</button><button data-v="high">精细</button></div></div>
        </div>
        <div class="row3">
          <div class="opt"><div class="lab">视角灵敏度</div><div class="slider" data-k="sens"><input aria-label="视角灵敏度" type="range" min="0.2" max="3" step="0.05"><span></span></div></div>
          <div class="opt"><div class="lab">视野</div><div class="slider" data-k="fov"><input aria-label="视野范围" type="range" min="65" max="100" step="1"><span></span></div></div>
          <div class="opt"><div class="lab">音量</div><div class="slider" data-k="vol"><input aria-label="音量" type="range" min="0" max="1" step="0.05"><span></span></div></div>
        </div>
      </div></details>
      <div class="start-note">两种玩法共用以上设置。<span class="desktop-hint">进入后按 <kbd>Esc</kbd> 暂停。</span><span class="touch-hint">进入后点右上角「暂停」。</span></div>
    </div>
  </div>
  <div class="menu-bottom"><span>TRANSPORT SHIP · TACTICAL COMBAT</span><a href="https://github.com/riba2534/claude-opus-5-5-demo" target="_blank" rel="noopener noreferrer">基于公开演示改编 · 非官方致敬作品 ↗</a></div>
</div>

<div id="pause" class="screen hidden"><div class="pauseBox"><div class="dialog-eyebrow">OPERATION PAUSED</div><h2>行动暂停</h2>
  <div class="note touch-instructions hidden" id="touchPauseNote"><b>左手移动，右手瞄准</b> 左侧按下定位摇杆，松手停止；右侧滑动转向，按住开火可同时拖动瞄准。<span>「瞄准」「蹲」点按切换状态；移动端仅支持横屏。</span></div>
  <div class="opt"><div class="lab">视角灵敏度</div><div class="slider" data-k="sens"><input aria-label="视角灵敏度" type="range" min="0.2" max="3" step="0.05"><span></span></div></div>
  <div class="opt"><div class="lab">视野 FOV</div><div class="slider" data-k="fov"><input type="range" min="65" max="100" step="1"><span></span></div></div>
  <div class="opt"><div class="lab">音量</div><div class="slider" data-k="vol"><input type="range" min="0" max="1" step="0.05"><span></span></div></div>
  <div class="opt"><div class="lab">时间</div><div class="seg" data-k="tod"><button data-v="day">阴晴</button><button data-v="dusk">暮光</button></div></div>
  <button class="go" id="btnResume">继 续</button><button class="go sec" id="btnQuit" style="margin-top:10px">退出到主菜单</button>
</div></div>

<div id="loadout" class="screen hidden"><div class="loadBox"><h2>更换主武器</h2><div class="sub">复活时生效；在出生点内立即生效。副武器沙漠之鹰、军刀、手雷自动配备。</div>
  <div class="cards" id="loadCards">${PRIM_CARDS}</div>
  <button class="go sec" id="btnLoadClose" style="margin-top:14px">确 定（B）</button>
</div></div>

<div id="end" class="screen hidden"><div class="endBox">
  <div class="res" id="endRes">胜利</div><div class="sc" id="endSc"></div><div class="mvp" id="endMvp"></div><div class="mvp" id="endMe" style="color:#dfe4e8"></div>
  <div id="endTable" class="tbl"></div>
  <div style="display:flex;gap:10px;margin-top:16px"><button class="go" id="btnAgain">再 来 一 局</button><button class="go sec" id="btnMenu">主菜单</button></div>
</div></div>
`;
