// Смоук платформы после правок трекинга: страница грузится без ошибок,
// welcome → анкета → шаги переключаются, anketa_step события уходят.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCALAPPDATA + '/npm-cache/_npx/b234c773f454f454/node_modules/playwright');
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
// глушим Supabase-гейт: authConfigured всегда false → обычный welcome-флоу
await page.addInitScript(() => {
  Object.defineProperty(window, 'authConfigured', { get: () => () => false, set: () => {} });
});
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text().slice(0, 200)); });
const events = [];
page.on('request', (r) => {
  if (r.url().includes('/api/sessions') && r.method() === 'POST') events.push(r.method() + ' ' + r.url().replace(/^.*\/api/, '/api').slice(0, 80));
});
await page.goto('http://localhost:5175/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const phase1 = await page.evaluate(() => document.body.innerText.slice(0, 200).replace(/\n/g, ' | '));
console.log('SCREEN1:', phase1);
// интро/welcome: жмем главную кнопку, вводим имя если есть инпут
for (let i = 0; i < 3; i++) {
  const typed = await page.evaluate(() => {
    const inp = document.querySelector('input[type="text"], input:not([type])');
    if (inp) { inp.focus(); return true; }
    return false;
  });
  if (typed) { await page.keyboard.type('Смоук Тест'); }
  const clicked = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const b = btns.find((x) => /начать|поехали|дальше|узнать|вперед|продолжить/i.test(x.textContent)) || btns[btns.length - 1];
    if (b) { b.click(); return b.textContent.trim().slice(0, 30); }
    return null;
  });
  console.log('CLICK', i, ':', clicked);
  await page.waitForTimeout(1500);
}
const phase2 = await page.evaluate(() => document.body.innerText.slice(0, 160).replace(/\n/g, ' | '));
console.log('SCREEN2:', phase2);
console.log('POSTS:', JSON.stringify(events, null, 0));
console.log('ERRORS:', errors.length ? errors.join(' || ') : 'none');
await browser.close();
