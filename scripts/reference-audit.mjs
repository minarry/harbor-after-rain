// Local, read-only audit of the supplied single-file reference.
// Usage: node scripts/reference-audit.mjs [--extract-only] [--only=fx,weapon] [--variants]
// Raw source and screenshots remain in artifacts/reference-audit; never publish them.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { transform, version as formatterVersion } from 'esbuild';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = process.env.REFERENCE_HTML || '/Users/bytedance/Downloads/几猫国产3A大作_V1.html';
const out = path.join(root, 'artifacts/reference-audit');
const args = new Set(process.argv.slice(2));
const only = process.argv.find(a => a.startsWith('--only='))?.slice(7).split(',');
const sha256 = data => crypto.createHash('sha256').update(data).digest('hex');
const definitions = [
  { key: 'mats', name: '程序化材质与贴花', start: '  var qg = {};', end: '  var u1 = 0.42,', showcase: '  function wA(i)', factory: '  async function Gg(i)',
    implementation: 'GPU MRT 生成 albedo、ORM、height，再从高度生成 normal；按材质配方缓存纹理，支持三平面、湿润、污损与中文贴花图集。',
    limitation: '默认展示是样板墙和球，不能证明同一材质在完整关卡中没有重复图案；test 的纹理档位是 256。',
    recommendation: '运输船保留可识别的涂装，按金属、木、橡胶、护甲区分粗糙度；通过相同照明下的样板对比验证。' },
  { key: 'level', name: '关卡与空间组织', start: '  var cv = {};', end: '  var mv = {};', showcase: '  async function mR(i)', factory: '  async function C1(i)',
    implementation: '门区、堆场、仓库、码头分区；三个中继、掩体点、敌人出生、楼梯与箱顶高位；静态几何合批与标签图集。',
    limitation: 'showcase 仅保留工厂返回值在闭包中，__G.level 仍是 stub；固定入口镜头不等于全图导航和战斗验证。',
    recommendation: '扩建必须同时验证玩家实走、机器人高度路径与中继可达；用分路、室内外过渡和高低位组织空间。' },
  { key: 'backdrop', name: '港区远景与大型道具', start: '  var mv = {};', end: '  var vv = {};', showcase: '  function MR(i)', factory: '  async function pv(i)',
    implementation: '程序化吊机、货轮、撤离艇、天际线和海鸥；吊具微摆、船体摇动、雷达旋转及灯光合批。',
    limitation: '默认镜头朝吊机；构建了其他物件不代表一张截图都能清晰展示。远景规模不能计作可玩面积。',
    recommendation: '围绕运输船提供可信港口尺度与分层轮廓，明确可玩边界；低频动画帮助环境有生命感。' },
  { key: 'ground', name: '湿地面、海水与降雨', start: '  var vv = {};', end: '  var Sv = {};', showcase: '  async function BR(i)', factory: '  async function O1(i)',
    implementation: '水洼深度和湿度遮罩、粗糙度差异、平面反射、雨滴与溅水、解析海浪高度及地面标记。',
    limitation: '反射为平面近似，非光线追踪；showcase 不加载真实关卡室内盒，不能单靠默认图验证屋顶遮雨。',
    recommendation: '甲板水膜、海水、室内干燥区分开处理；以实际碰撞屋顶遮雨，并将水面弹着高度与海浪采样统一。' },
  { key: 'fx', name: '弹着、烟火与弹壳', start: '  var Sv = {};', end: '  var vt = Math.PI * 2;', showcase: '  function JR(i)', factory: '  async function Cf(i)',
    implementation: '按 metal/concrete/wood/water/rubber/dirt/glass/enemy 分派；有界粒子、曳光、碎屑、弹孔、弹壳和爆炸；软粒子与烟雾近似光照。',
    limitation: '默认水击事件可强制把地面命中标成 water，不是独立验证真实海面射线；Math.random 未统一受 seed 参数控制。',
    recommendation: '材质响应必须由真实射线命中驱动；池容量、重开清理、弹壳碰撞时序与水面无弹孔应一起验证。' },
  { key: 'weapon', name: '第一人称武器与双手', start: '  var Xv = {};', end: '  var ex = {};', showcase: '  async function PC(i)', factory: '  async function dm(i)',
    implementation: '一把定制步枪的细分零件、双手与手指、瞄具、湿润材质、弹簧后坐力、换弹/检视/冲刺动作；双相机视图层。',
    limitation: '默认是静态持枪，不能证明动作切换正确；只有这把步枪，不能推断多枪切换、狙击拉栓或移动端体验。',
    recommendation: '分阶段核对持枪握持、换弹手指接触和抛壳；切枪、暂停与空仓动作要保留正确状态。' },
  { key: 'enemies', name: '机械敌人与交战节奏', start: '  var ex = {};', end: '  var tx = 4,', showcase: '  async function VC(i)', factory: '  async function Em(i)',
    implementation: '机械鸥、四足猎犬及骨骼动画；视线/视锥/听觉、最后已知位置、搜索状态和攻击令牌；有界敌人/残骸/弹体池。',
    limitation: '默认 both 为 passive 巡逻；eshow=fight 才运行主动进攻，且展示玩家的 damage 是空函数，不能当公平难度测试。',
    recommendation: '运输船机器人延续真实视线、掩体和攻击节奏，以实战验证分路、友军阻挡、压制重部署与中继站位。' },
  { key: 'props', name: '港区程序化道具库', start: '  var $g = {};', end: '  var cv = {};', showcase: '  function AA(i)', factory: '  function Yg(i)',
    implementation: '注册表构造集装箱、护栏、楼梯、叉车、线缆卷、油桶、货盘等道具，包含尺寸、材质、种子变体与碰撞元数据。',
    limitation: '默认所有道具按网格排列，低机位会遮挡后排；视觉存在不代表精细碰撞完全匹配。',
    recommendation: '可交互道具共享视觉尺寸和碰撞定义；细节分近中远预算，避免装饰堵住射线和导航。' },
  { key: 'render', name: '渲染与后处理', start: '  var Vg = {};', end: '  var qg = {};', showcase: '  function sA(i)', factory: '  async function Hg(i)',
    implementation: 'HDR 前向渲染、世界/武器双相机、环境探针、软阴影、半分辨率 AO 和体积散射、Bloom、曝光、调色与 FXAA；有降级回退。',
    limitation: '并非完整延迟渲染或路径追踪；show/shot 关闭动态分辨率，test 关闭运动模糊，单次 fps 不可当普适性能成绩。',
    recommendation: '以接触阴影、曝光和反射先建立层次，保留清晰敌人轮廓；展示效果开关并核对主流程未降级。' }
];

const before = await fs.readFile(source);
const rawBlocks = [...before.toString('utf8').matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m => m[1]);
const raw = rawBlocks.sort((a, b) => b.length - a.length)[0];
if (!raw?.includes('window.__ready')) throw new Error('No expected reference inline bundle found');
const readable = (await transform(raw, { loader: 'js', minify: false })).code;
const lines = readable.split('\n');
const lineOf = marker => {
  const i = lines.findIndex(line => line.startsWith(marker));
  if (i < 0) throw new Error(`Source marker missing: ${marker}`);
  return i + 1;
};
const oldReadable = await fs.readFile(path.join(root, 'artifacts/reference-readable.js'), 'utf8').catch(() => null);
if (oldReadable !== null && oldReadable !== readable) throw new Error('Readable reference changed: review new line numbering before audit');
const previous = await fs.readFile(path.join(out, 'manifest.json'), 'utf8').then(JSON.parse).catch(() => null);
const keepRuntime = (only || args.has('--extract-only')) && previous?.source?.sha256 === sha256(before);
await fs.mkdir(path.join(out, 'split'), { recursive: true });
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: { path: source, bytes: before.length, sha256: sha256(before), access: 'read-only', inlineScriptCount: rawBlocks.length, inlineSha256: sha256(raw), readableSha256: sha256(readable), readablePath: 'artifacts/reference-readable.js', formatter: `esbuild ${formatterVersion}` },
  scope: 'Local audit of the actual supplied HTML. No source or reference screenshots are uploaded or published.',
  registry: { line: lineOf('  var gM = '), keys: definitions.map(d => d.key) },
  fragmentContract: 'split/*.fragment.js are dependency-bearing excerpts from one IIFE, NOT independent modules and NOT runnable ES module source. They retain aliases to bundled THREE, helpers and other excerpts. Line numbers refer to the unmodified esbuild-formatted reference-readable.js, not to the one-line original bundle.',
  sharedDependencies: ['Bundled THREE (lines 1–17145)', 'Shared constants/helpers (17146–17378)', 'Physics (19554–19795)', 'Audio (25339–26649)', 'Input/player/combat (26650–27036)', 'UI/game/bootstrap (28838 onward)'],
  qualifications: ['The article itself and generation transcript are not supplied to this audit. Model identity, token counts, development time and authorship claims cannot be verified from these executable bytes.', 'seed=4207 does not seed every Math.random call, so dynamic pixels are not bit-for-bit deterministic.', 'All nine showcase branches use an audio stub and a non-damageable player stub. Silent screenshots do not verify sound or fair combat.', 'q=test is a reduced quality preset. Reported fps is a short, environment-specific sample; it is not a sustained or comparative benchmark.'],
  modules: []
};
for (const [index, def] of definitions.entries()) {
  const startLine = lineOf(def.start), endLine = lineOf(def.end) - 1;
  const filename = `${String(index + 1).padStart(2, '0')}-${def.key}.fragment.js`;
  const excerpt = lines.slice(startLine - 1, endLine).join('\n') + '\n';
  const banner = `// READ-ONLY REFERENCE EXCERPT — NOT A STANDALONE MODULE.\n// Original SHA256: ${manifest.source.sha256}\n// reference-readable.js lines ${startLine}–${endLine}. Shared IIFE aliases and dependencies required.\n`;
  await fs.writeFile(path.join(out, 'split', filename), banner + excerpt);
  const prior = keepRuntime && previous.modules.find(m => m.key === def.key);
  manifest.modules.push({ key: def.key, name: def.name, startLine, endLine, factoryLine: lineOf(def.factory), showcaseLine: lineOf(def.showcase), fragment: `split/${filename}`, fragmentSha256: sha256(banner + excerpt), implementation: def.implementation, limitation: def.limitation, recommendation: def.recommendation, ...(prior?.runtime ? { runtime: prior.runtime } : {}), ...(prior?.visualReview ? { visualReview: prior.visualReview } : {}) });
}
if (keepRuntime && previous.browser) manifest.browser = previous.browser;

async function snapshot(page) {
  return page.evaluate(() => {
    const g = window.__G;
    if (!g) return { ready: window.__ready, fatal: window.__fatal, errors: window.__errors };
    const safeStats = module => { try { return typeof module?.stats === 'function' ? module.stats() : module?.stats ?? null; } catch (error) { return { error: String(error) }; } };
    const meshes = [], materialNames = new Set(), sceneRoots = [];
    g.scene.traverse(o => { if (o.isMesh) { meshes.push(o); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m?.name) materialNames.add(m.name); } });
    for (const o of g.scene.children) sceneRoots.push({ name: o.name, type: o.type, children: o.children.length });
    let gpu = null;
    try { const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); } catch {}
    const ctx = g.enemies?.debug?.ctx;
    return { ready: window.__ready, fatal: window.__fatal, errors: window.__errors, frame: window.__frames, time: g.time, key: g.showcase, params: g.params, quality: g.quality, stats: window.__stats?.(), gpu,
      camera: { position: g.camera.position.toArray(), fov: g.camera.fov, target: g.showcaseInfo?.target },
      modules: Object.fromEntries(['mats', 'level', 'backdrop', 'ground', 'fx', 'weapon', 'enemies', 'props', 'render', 'audio', 'player'].map(k => [k, { stub: !!g[k]?.stub, available: !!g[k], stats: safeStats(g[k]) }])),
      scene: { meshCount: meshes.length, instancedMeshCount: meshes.filter(m => m.isInstancedMesh).length, skinnedMeshCount: meshes.filter(m => m.isSkinnedMesh).length, materialNames: [...materialNames], roots: sceneRoots },
      materialCount: g.mats.names?.length, propNames: g.props.names?.(), colliderCount: g.physics.boxes?.length,
      weapon: { name: g.weapon.name, state: g.weapon.state, ammo: g.weapon.ammo, ads: g.weapon.ads, info: g.weapon.info, debug: g.weapon.debug ? { freeze: g.weapon.debug.freeze, reloadT: g.weapon.debug.reloadT, empty: g.weapon.debug.empty, flash: g.weapon.debug.flash } : null },
      enemies: ctx ? { tokens: ctx.tokens, time: ctx.t, activeBolts: g.enemies.debug.bolts.filter(b => b.on).length, wrecks: g.enemies.debug.wrecks.length, list: ctx.list.map(e => ({ type: e.type, passive: e.passive, alive: e.alive, mode: e.mode, pos: e.pos.toArray(), los: e.los })) } : null,
      ground: { rainLevel: g.ground.rainLevel, reflectionEnabled: g.ground.planar?.enabled, reflectionSize: g.ground.reflectionTarget ? [g.ground.reflectionTarget.width, g.ground.reflectionTarget.height] : null }
    };
  });
}

let browser;
try {
  if (!args.has('--extract-only')) {
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
    manifest.browser = { version: browser.version(), viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, network: 'offline + explicit HTTP(S) request blocking', quality: 'test', seed: 4207 };
    for (const [index, module] of manifest.modules.entries()) {
      if (only && !only.includes(module.key)) continue;
      const context = await browser.newContext({ viewport: manifest.browser.viewport, deviceScaleFactor: 1, offline: true });
      const page = await context.newPage();
      const logs = [], pageErrors = [], externalRequests = [];
      page.on('console', message => logs.push({ type: message.type(), text: message.text().slice(0, 1500) }));
      page.on('pageerror', error => pageErrors.push(String(error)));
      await page.route('**/*', route => { const url = route.request().url(); if (/^https?:/.test(url)) { externalRequests.push(url); return route.abort(); } return route.continue(); });
      const url = pathToFileURL(source);
      url.search = new URLSearchParams({ show: module.key, shot: '1', q: 'test', seed: '4207' }).toString();
      const started = Date.now();
      console.log(`Auditing ${module.key} offline…`);
      delete module.visualReview;
      module.runtime = { capturedAt: new Date().toISOString(), url: url.href, logs, pageErrors, externalRequests };
      try {
        await page.goto(url.href, { waitUntil: 'load', timeout: 90000 });
        await page.waitForFunction(() => window.__ready || window.__fatal, { timeout: 90000 });
        await page.waitForTimeout(1500);
        module.runtime.first = await snapshot(page);
        await page.waitForTimeout(1500);
        module.runtime.last = await snapshot(page);
        const screenshot = `${String(index + 1).padStart(2, '0')}-${module.key}.png`;
        await page.screenshot({ path: path.join(out, screenshot), animations: 'allow' });
        module.runtime.screenshot = screenshot;
        module.runtime.framesAdvanced = module.runtime.last.frame > module.runtime.first.frame;
        module.runtime.passed = !!module.runtime.last.ready && !module.runtime.last.fatal && !module.runtime.last.errors?.length && !pageErrors.length && module.runtime.framesAdvanced && module.runtime.last.stats?.advanced === true;
        console.log(`${module.key}: ${module.runtime.passed ? 'PASS' : 'CHECK'} frames=${module.runtime.last.frame} calls=${module.runtime.last.stats?.calls} errors=${module.runtime.last.errors?.length || 0}`);
        if (args.has('--variants') && ['weapon', 'enemies'].includes(module.key)) {
          await fs.mkdir(path.join(out, 'variants'), { recursive: true });
          const variants = module.key === 'weapon'
            ? [{ name: 'ads', shot: { wpose: 'ads' } }, { name: 'reload-mag-out', shot: { wpose: 'reload', wt: 0.62 } }, { name: 'empty-bolt-back', shot: { wpose: 'empty', wt: 2.14 } }]
            : [{ name: 'fight', query: { eshow: 'fight' } }, { name: 'dead', query: { eshow: 'dead' } }];
          module.runtime.variants = [];
          for (const variant of variants) {
            if (variant.query) {
              const next = new URL(url);
              for (const [key, value] of Object.entries(variant.query)) next.searchParams.set(key, value);
              await page.goto(next.href, { waitUntil: 'load', timeout: 90000 });
              await page.waitForFunction(() => window.__ready || window.__fatal, { timeout: 90000 });
            } else await page.evaluate(shot => window.__setShot(shot), variant.shot);
            await page.waitForTimeout(1500);
            const first = await snapshot(page);
            await page.waitForTimeout(1500);
            const last = await snapshot(page);
            const screenshot = `variants/${module.key}-${variant.name}.png`;
            await page.screenshot({ path: path.join(out, screenshot), animations: 'allow' });
            const passed = !!last.ready && !last.fatal && !last.errors?.length && last.frame > first.frame && last.stats?.advanced === true;
            module.runtime.variants.push({ ...variant, screenshot, first, last, passed });
            console.log(`${module.key}/${variant.name}: ${passed ? 'PASS' : 'CHECK'}`);
          }
        }
      } catch (error) { module.runtime.failure = String(error); module.runtime.passed = false; console.error(`${module.key}: ${error.message}`); }
      finally { module.runtime.elapsedMs = Date.now() - started; await context.close(); await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); }
    }
  }
} finally {
  await browser?.close();
  const after = await fs.readFile(source);
  manifest.source.sha256After = sha256(after);
  manifest.source.unchanged = before.equals(after);
  await fs.writeFile(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (!manifest.source.unchanged) throw new Error('Original reference bytes changed during audit');
}
console.log(`Audit written to ${out}; original bytes unchanged=${manifest.source.unchanged}`);
if (manifest.modules.some(m => m.runtime?.passed === false || m.runtime?.variants?.some(v => !v.passed))) process.exitCode = 1;
