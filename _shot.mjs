// _shot.mjs — скриншоты CRM для итераций. Запуск: node _shot.mjs [page] [label] [mobile]
// Нужен статик-сервер на :5173 из crm/. Ключ берется из EASTSIDE_CRM_KEY.
import { createRequire } from 'module';
import { mkdirSync } from 'fs';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCALAPPDATA + '/npm-cache/_npx/b234c773f454f454/node_modules/playwright');
const pageId = process.argv[2] || 'dash';
const label = process.argv[3] || pageId;
const mobile = process.argv.includes('mobile');
const KEY = process.env.EASTSIDE_CRM_KEY || '';
const OUT = './_screens'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: mobile ? { width: 390, height: 844 } : { width: 1536, height: 864 },
  deviceScaleFactor: 2,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('PAGEERROR:', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
await page.goto(`http://localhost:5173/?k=${encodeURIComponent(KEY)}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1400);
if (pageId !== 'dash') {
  await page.evaluate((p) => {
    const btn = document.querySelector(`[data-p="${p}"]`);
    if (btn) btn.click();
  }, pageId);
  await page.waitForTimeout(1400);
}
if (process.argv.includes('--select-first')) {
  await page.evaluate(() => {
    const row = document.querySelector('.trow[data-id], .kb-card[data-id]');
    if (row) row.click();
  });
  await page.waitForTimeout(2500);
}
if (process.argv.includes('--open-first')) {
  await page.evaluate(() => {
    const row = document.querySelector('tbody tr[data-id], .act-row[data-id], .kb-card[data-id]');
    if (row) row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await page.waitForTimeout(1800);
}
const openN = process.argv.find((a) => a.startsWith('--open-n='));
if (openN) {
  const n = parseInt(openN.split('=')[1], 10) || 0;
  await page.evaluate((i) => {
    const rows = document.querySelectorAll('tbody tr[data-id]');
    if (rows[i]) rows[i].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  }, n);
  await page.waitForTimeout(4500);
}
if (process.argv.includes('--click-step')) {
  await page.evaluate(() => {
    const steps = document.querySelectorAll('.lstep');
    if (steps[3]) steps[3].click();
  });
  await page.waitForTimeout(900);
}
await page.screenshot({ path: `${OUT}/${label}.png` });
await ctx.close();
await browser.close();
console.log(`done ${OUT}/${label}.png`);
