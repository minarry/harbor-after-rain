// 构建：esbuild 打包 -> 内联到单个 HTML
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const dev = process.argv.includes('--dev');
const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'iife',
  minify: !dev,
  sourcemap: false,
  // Syntax target only; runtime rendering still requires WebGL 2.
  target: ['es2020', 'safari15'],
  write: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
});
const js = res.outputFiles[0].text;
// esbuild lowers syntax, not newer built-in APIs. Guard the reported failure
// in the complete bundle, including dependencies, before producing a release.
if (/\bObject\s*\.\s*hasOwn\s*\(/.test(js)) throw new Error('Bundle must use Object.prototype.hasOwnProperty.call instead of Object.hasOwn');
const tpl = fs.readFileSync('src/index.html', 'utf8');
// Use the logical game viewport even when a browser cannot rotate its screen.
// Native landscape and desktop retain their ordinary viewport dimensions.
const css = (fs.readFileSync('src/style.css', 'utf8')+'\n'+fs.readFileSync('src/lab/lab.css','utf8'))
  .replace(/(-?(?:\d*\.)?\d+)(dvh|svh|lvh|vmin|vmax|vw|vh)\b/g, (_,value,unit) => `calc(${value} * var(--game-${/^[dsl]vh$/.test(unit)?'vh':unit}, 1${unit}))`)
  .replace(/env\(safe-area-inset-(top|right|bottom|left)\)/g, (_,side) => `var(--game-safe-${side}, env(safe-area-inset-${side}))`);
const license = fs.readFileSync('node_modules/three/LICENSE', 'utf8');
const html = tpl.replace('<head>', () => '<head>\n<!-- Three.js license\n' + license.replace(/-->/g, '-- >') + '\n-->')
  .replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => js.replace(/<\/script>/g, '<\\/script>'));
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', html);
console.log('built dist/index.html', (html.length / 1024).toFixed(1) + ' KB');
