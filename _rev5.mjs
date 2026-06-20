import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LOCALAPPDATA + '/npm-cache/_npx/b234c773f454f454/node_modules/playwright');
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1536, height: 940 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
const errs = [];
p.on('pageerror', e => errs.push('PAGEERR: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await p.goto('http://localhost:5173/?k=eastside2026', { waitUntil: 'networkidle' });
await p.waitForTimeout(2200);
await p.screenshot({ path: './_screens/s-dash.png', fullPage: true });

async function nav(id){ await p.evaluate(i=>{const e=document.querySelector('[data-p="'+i+'"]'); if(e) e.click();}, id); await p.waitForTimeout(1100); }

await nav('leads');
await p.screenshot({ path: './_screens/s-clients.png', fullPage: true });

await nav('finance');
await p.waitForTimeout(1500);
await p.screenshot({ path: './_screens/s-finance.png', fullPage: true });

// open modal from clients
await nav('leads');
await p.evaluate(()=>{const r=document.querySelector('.trow[data-id]'); if(r) r.click();});
await p.waitForTimeout(2400);
await p.screenshot({ path: './_screens/s-modal-now.png' });
// path section
await p.evaluate(()=>{const e=document.querySelector('.m-ni[data-s="path"]'); if(e) e.click();});
await p.waitForTimeout(700);
await p.screenshot({ path: './_screens/s-modal-path.png' });
// notes
await p.evaluate(()=>{const e=document.querySelector('.m-ni[data-s="notes"]'); if(e) e.click();});
await p.waitForTimeout(500);
await p.screenshot({ path: './_screens/s-modal-notes.png' });
// pay
await p.evaluate(()=>{const e=document.querySelector('.m-ni[data-s="pay"]'); if(e) e.click();});
await p.waitForTimeout(900);
await p.screenshot({ path: './_screens/s-modal-pay.png' });
// ai
await p.evaluate(()=>{const e=document.querySelector('.m-ni[data-s="ai"]'); if(e) e.click();});
await p.waitForTimeout(1200);
await p.screenshot({ path: './_screens/s-modal-ai.png' });

console.log('ERRORS:', errs.length ? '\n' + errs.join('\n') : 'none');
await b.close();
