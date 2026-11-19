/* Проверка фильтра по направлению на доске «Сопровождение».
   Гоняет НАСТОЯЩИЙ код app.js в vm (как это делают проверки платформы) и дергает
   pbTracks/pbFilter/pbStudent на выдуманных учениках: в CRM нет ни сборки, ни
   тестов, а ошибиться тут легко — чипы считают людей, и неверный счетчик врет
   руководителю. Запуск: node tools/points-track-check.mjs
*/
import fs from 'fs';
import vm from 'vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
// Открываем наружу только то, что проверяем. Файл на диске не трогаем.
const marker = '  function pbTrack() { return state.ptTrack || \'\'; }';
if (!src.includes(marker)) { console.log('НЕ НАШЕЛ якорь pbTrack'); process.exit(1); }
const patched = src.replace(marker, marker + '\n  globalThis.__T = { tracks: function (s) { return pbTracks(s); }, filter: function (s) { return pbFilter(s); }, student: function (s) { return pbStudent(s); }, state: state };');

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

const T = ctx.__T;
if (!T) { console.log('функции не выставились'); process.exit(3); }

const PT = () => [{ key: 'p1', title: 'Точка 1', items: [{key:'i1', title:'Шаг', done:false}], left: 1, closedAt: null, amount: 3000, planDate: null }];
const students = [
  { sessionId: 'a', name: 'Аня', track: 'bachelor', trackName: 'Бакалавриат', points: PT(), money: {earned:0, ahead:0}, next: null },
  { sessionId: 'b', name: 'Боря', track: 'bachelor', trackName: 'Бакалавриат', points: PT(), money: {earned:0, ahead:0}, next: null },
  { sessionId: 'c', name: 'Вера', track: 'lang_grant', trackName: 'Языковой год по гранту', points: PT(), money: {earned:0, ahead:0}, next: null },
  { sessionId: 'd', name: 'Гена', track: '', trackName: '', points: PT(), money: {earned:0, ahead:0}, next: null },
];

let bad = 0;
function check(name, cond, got) { console.log((cond ? '  ок   ' : '  ПЛОХО') + ' ' + name + (cond ? '' : ' -> ' + got)); if (!cond) bad++; }

const html = T.tracks(students);
check('чип «Все» со счетчиком 4', /Все<span class="qn">4<\/span>/.test(html), html.slice(0, 200));
check('чип «Бакалавриат» со счетчиком 2', /Бакалавриат<span class="qn">2<\/span>/.test(html), '');
check('чип «Языковой год по гранту» со счетчиком 1', /Языковой год по гранту<span class="qn">1<\/span>/.test(html), '');
check('чип «Без направления» со счетчиком 1', /Без направления<span class="qn">1<\/span>/.test(html), '');
check('языковой год стоит перед бакалавриатом', html.indexOf('Языковой год по гранту') < html.indexOf('Бакалавриат'), '');
check('пустых направлений в ряду нет', !/Магистратура/.test(html), '');

ctx.__T.state.ptTrack = 'bachelor';
check('фильтр «Бакалавриат» дает двоих', T.filter(students).map(s => s.name).join(',') === 'Аня,Боря', T.filter(students).map(s => s.name).join(','));
ctx.__T.state.ptTrack = 'none';
check('фильтр «Без направления» дает одного', T.filter(students).map(s => s.name).join(',') === 'Гена', T.filter(students).map(s => s.name).join(','));
ctx.__T.state.ptTrack = '';
check('без фильтра видны все четверо', T.filter(students).length === 4, '');

const row = T.student(students[0]);
check('в строке ученика стоит плашка направления', /class="pb-trk">Бакалавриат</.test(row), row.slice(0, 300));
const rowNone = T.student(students[3]);
check('без направления плашки нет', !/pb-trk/.test(rowNone), '');

console.log(bad ? ('\nпровалено проверок: ' + bad) : '\nвсе проверки прошли');
process.exit(bad ? 1 : 0);
