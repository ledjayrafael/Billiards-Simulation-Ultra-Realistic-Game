// Screenshot headless (Chrome + GPU) untuk memeriksa rendering WebGL.
//   node tools/shot.mjs <url> <out.png> [--wait ms] [--eval "js"] [--size 1280x720] [--fps]
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args[0];
const out = args[1];
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const [w, h] = opt('--size', '1280x720').split('x').map(Number);
const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required', `--window-size=${w},${h}`],
});
const page = await browser.newPage({ viewport: { width: w, height: h } });
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(Number(opt('--wait', '4000')));
const evals = [];
for (let i = 0; i < args.length; i++) if (args[i] === '--eval') evals.push(args[i + 1]);
for (const js of evals) {
  const r = await page.evaluate(js);
  if (r !== undefined) console.log('eval →', JSON.stringify(r));
  await page.waitForTimeout(Number(opt('--after', '1500')));
}
if (args.includes('--fps')) {
  const fps = await page.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 3000) res((n * 1000) / (performance.now() - t0)); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  console.log('fps ≈', fps.toFixed(1));
}
const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); if (!g) return 'no webgl2'; const e = g.getExtension('WEBGL_debug_renderer_info'); return e ? g.getParameter(e.UNMASKED_RENDERER_WEBGL) : 'webgl2'; });
console.log('renderer:', gl);
if (out) await page.screenshot({ path: out });
for (const l of logs.slice(0, 25)) console.log(l);
await browser.close();
