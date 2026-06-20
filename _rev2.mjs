import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCALAPPDATA + '/npm-cache/_npx/b234c773f454f454/node_modules/playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1536, height: 920 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
p.on('pageerror', e => console.error('ERR:', e.message));
p.on('console', m => { if (m.type() === 'error') console.error('CONSOLE:', m.text()); });
await p.goto('http://localhost:5173/?k=eastside2026', { waitUntil: 'networkidle' });
await p.waitForTimeout(2000);
await p.screenshot({ path: './_screens/r-owner-full.png', fullPage: true });

// Clients table
await p.evaluate(() => document.querySelector('[data-p="leads"]').click());
await p.waitForTimeout(900);
await p.screenshot({ path: './_screens/r-clients.png', fullPage: true });

// open a dropdown
const fp = await p.$('#f-period');
if (fp) { await fp.click(); await p.waitForTimeout(400); await p.screenshot({ path: './_screens/r-dropdown.png' }); await p.keyboard.press('Escape'); await p.mouse.click(5,5); }
await p.waitForTimeout(300);

// Kanban
const kb = await p.$('.vseg button[data-v="kanban"]');
if (kb) { await kb.click(); await p.waitForTimeout(700); await p.screenshot({ path: './_screens/r-kanban.png' }); }

// Modal now
const tbl = await p.$('.vseg button[data-v="table"]'); if (tbl) { await tbl.click(); await p.waitForTimeout(500); }
const row = await p.$('.trow[data-id]');
if (row) { await row.click(); await p.waitForTimeout(2200); await p.screenshot({ path: './_screens/r-modal-now.png' });
  await p.keyboard.press('Escape'); await p.waitForTimeout(400); }

// Path
await p.evaluate(() => { const e=document.querySelector('[data-p="path"]'); if(e) e.click(); });
await p.waitForTimeout(900);
await p.screenshot({ path: './_screens/r-path.png', fullPage: true });
await p.close();

// mobile owner
const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
await m.goto('http://localhost:5173/?k=eastside2026', { waitUntil: 'networkidle' });
await m.waitForTimeout(1800);
await m.screenshot({ path: './_screens/r-mob-dash.png', fullPage: true });
await b.close();
console.log('done');
