/* Проверка чипов направления на вкладке «Сопровождение» в «Контактах».
   Гоняет НАСТОЯЩИЙ код app.js в vm (как points-track-check.mjs): сборки и тестов
   в CRM нет, а чипы считают людей — неверный счетчик врет руководителю.
   Запуск: node tools/leads-track-check.mjs
*/
import fs from 'fs';
import vm from 'vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const marker = '  function leadTrack(l) { return ((l.crm && l.crm.overrides) || {}).track || \'\'; }';
if (!src.includes(marker)) { console.log('НЕ НАШЕЛ якорь leadTrack'); process.exit(1); }
const patched = src.replace(marker, marker +
  '\n  globalThis.__L = { chips: function (a) { return trackChips(a); },' +
  ' hit: function (l, seg) { return trackHit(l, seg); },' +
  ' keys: function (seg) { return quickKeys(seg); },' +
  ' pred: function (seg) { return quickPred(seg); },' +
  ' setTracks: function (t) { DOC_TRACKS = t; }, state: state };');

function el(tag) {
  const node = { tagName: tag, style: {}, dataset: {}, children: [], classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    appendChild(c){ this.children.push(c); return c; }, setAttribute(){}, getAttribute(){ return null; }, removeAttribute(){},
    addEventListener(){}, removeEventListener(){}, querySelector(){ return null; }, querySelectorAll(){ return []; },
    insertAdjacentHTML(){}, focus(){}, remove(){}, contains(){ return false; }, closest(){ return null; }, click(){} };
  Object.defineProperty(node, 'innerHTML', { get(){ return this._h || ''; }, set(v){ this._h = v; } });
  return node;
}
const doc = el('document');
doc.body = el('body'); doc.documentElement = el('html'); doc.head = el('head');
doc.createElement = el; doc.getElementById = () => el('div');
doc.querySelector = () => el('div'); doc.querySelectorAll = () => [];
const store = {};
const ctx = {
  console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON, fetch: async () => ({ ok: true, json: async () => ({}) }),
  document: doc, navigator: { userAgent: 'node', clipboard: {} },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
  location: { hash: '', href: 'https://crm.test/', search: '', pathname: '/' },
  history: { replaceState(){}, pushState(){} },
  matchMedia: () => ({ matches: false, addEventListener(){}, addListener(){} }),
  requestAnimationFrame: f => setTimeout(f, 0),
};
ctx.window = ctx; ctx.globalThis = ctx; ctx.self = ctx;
ctx.window.addEventListener = () => {}; ctx.addEventListener = () => {};
vm.createContext(ctx);
try { vm.runInContext(patched, ctx, { filename: 'app.js' }); }
catch (e) { console.log('app.js не поднялся в vm:', e.message); process.exit(2); }

const L = ctx.__L;
if (!L) { console.log('функции не выставились'); process.exit(3); }

/* Названия направлений приезжают с бэкенда — подставляем ответ /admin/api/docs/kinds. */
L.setTracks([
  { key: 'lang_paid', name: 'Платный языковой год' },
  { key: 'lang_grant', name: 'Языковой год по гранту' },
  { key: 'bachelor', name: 'Бакалавриат' },
  { key: 'master', name: 'Магистратура' },
  { key: 'master_after_lang', name: 'Магистратура после языкового года' },
  { key: 'bachelor_after_lang', name: 'Бакалавриат после языкового года' },
  { key: 'master_direct', name: 'Магистратура, подача напрямую в вуз' },
]);

const lead = (name, track) => ({ id: name, crm: { overrides: track ? { track } : {} } });
const arr = [
  lead('Аня', 'bachelor'), lead('Боря', 'bachelor'),
  lead('Вера', 'lang_grant'), lead('Гена', 'master_direct'), lead('Дина', ''),
];

let bad = 0;
function check(name, cond, got) { console.log((cond ? '  ок   ' : '  ПЛОХО') + ' ' + name + (cond ? '' : ' -> ' + got)); if (!cond) bad++; }

L.state.seg = 'support';
const html = L.chips(arr);
check('чип «Все направления» со счетчиком 5', /Все направления<span class="qn num">5<\/span>/.test(html), html.slice(0, 200));
check('название берется с бэкенда, а не ключ', /Бакалавриат<span class="qn num">2<\/span>/.test(html) && !/>bachelor</.test(html), html.slice(0, 300));
check('чип «Языковой год по гранту» со счетчиком 1', /Языковой год по гранту<span class="qn num">1<\/span>/.test(html), '');
check('чип «Без направления» со счетчиком 1', /Без направления<span class="qn num">1<\/span>/.test(html), '');
check('языковой год стоит перед бакалавриатом', html.indexOf('Языковой год по гранту') < html.indexOf('Бакалавриат<'), '');
check('пустых направлений в ряду нет', !/Магистратура<span/.test(html), '');

L.state.seg = 'clients';
check('на чужой вкладке ряда нет', L.chips(arr) === '', JSON.stringify(L.chips(arr).slice(0, 80)));

L.state.seg = 'support';
L.state.trk = 'bachelor';
check('фильтр «Бакалавриат» дает двоих', arr.filter(l => L.hit(l, 'support')).map(l => l.id).join(',') === 'Аня,Боря',
  arr.filter(l => L.hit(l, 'support')).map(l => l.id).join(','));
check('выбранное направление не режет «Клиентов»', arr.filter(l => L.hit(l, 'clients')).length === 5,
  String(arr.filter(l => L.hit(l, 'clients')).length));
L.state.trk = 'none';
check('фильтр «Без направления» дает одного', arr.filter(l => L.hit(l, 'support')).map(l => l.id).join(',') === 'Дина',
  arr.filter(l => L.hit(l, 'support')).map(l => l.id).join(','));
L.state.trk = '';
check('без фильтра видны все пятеро', arr.filter(l => L.hit(l, 'support')).length === 5, '');

/* Направление, которого нет в порядке (завели новое на бэкенде) — не теряется. */
L.state.seg = 'support';
const extra = arr.concat([lead('Егор', 'newtrack')]);
check('незнакомое направление попадает в ряд', /newtrack<span class="qn num">1<\/span>/.test(L.chips(extra)), '');

/* Ряд срезов воронки: на «Сопровождении» короче (Мария 19.11.2026). */
check('на «Сопровождении» ровно три среза', L.keys('support').join(',') === ',tasks,attention', L.keys('support').join(','));
check('квал-лидов и «без контакта» там нет', ['mql', 'sql', 'nocontact'].every(function (k) { return L.keys('support').indexOf(k) < 0; }), '');
check('на «Клиентах» ряд прежний', L.keys('clients').indexOf('mql') > 0 && L.keys('clients').indexOf('nocontact') > 0, L.keys('clients').join(','));
L.state.quick = 'mql';
check('чужой срез не режет «Сопровождение»', L.pred('support')({ crm: {} }) === true, '');
check('тот же срез на «Клиентах» работает', L.pred('clients')({ crm: {} }) === false, '');
L.state.quick = '';

console.log(bad ? ('\nпровалено проверок: ' + bad) : '\nвсе проверки прошли');
process.exit(bad ? 1 : 0);
