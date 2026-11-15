// Jalankan urutan langkah di Chrome headless ber-GPU: node tools/seq.mjs <url> <script.json>
// langkah: {eval:"js"} | {wait:ms} | {shot:"file.png"} | {fps:ms} | {key:"KeyT"} | {size:[w,h]}
import { chromium } from 'playwright-core';
import { existsSync, readFileSync } from 'node:fs';
const [url, file] = process.argv.slice(2);
const steps = JSON.parse(readFileSync(file, 'utf8'));
const exe = ['/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--headless=new', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--enable-features=Vulkan', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || (m.type() === 'warning' && !/GPU stall|KHR_parallel/.test(m.text()))) logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
for (const s of steps) {
  if (s.wait) await page.waitForTimeout(s.wait);
  if (s.size) await page.setViewportSize({ width: s.size[0], height: s.size[1] });
  if (s.key) await page.keyboard.press(s.key);
  if (s.eval) { const r = await page.evaluate(s.eval); if (r !== undefined && r !== null) console.log('→', JSON.stringify(r)); }
  if (s.shot) await page.screenshot({ path: s.shot });
  if (s.fps) { const r = await page.evaluate((ms) => new Promise((res) => { let n = 0, worst = 0, prev = performance.now(); const t0 = prev; const f = (t) => { n++; worst = Math.max(worst, t - prev); prev = t; if (t - t0 > ms) res({ fps: +((n * 1000) / (t - t0)).toFixed(1), worstFrameMs: +worst.toFixed(1) }); else requestAnimationFrame(f); }; requestAnimationFrame(f); }), s.fps); console.log('fps', JSON.stringify(r)); }
}
for (const l of logs.slice(0, 20)) console.log(l);
await browser.close();
