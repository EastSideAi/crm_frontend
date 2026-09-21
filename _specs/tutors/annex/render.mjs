import { chromium } from '/app/node_modules/playwright-core/index.mjs';
const [src, out] = process.argv.slice(2);
const b = await chromium.launch({ args: ['--no-sandbox'] });
const p = await b.newPage();
await p.goto('file://' + src);
await p.waitForTimeout(500);
await p.pdf({ path: out, format: 'A4', printBackground: true });
await b.close(); console.log('pdf', out);
