/* Проверка фильтров вкладки «Сопровождение» в «Контактах»: направление, класс,
   тьютор. Гоняет НАСТОЯЩИЙ код app.js в vm (как points-track-check.mjs): сборки и
   тестов в CRM нет, а пункты считают людей — неверный счетчик врет руководителю.
   Запуск: node tools/leads-track-check.mjs
*/
import fs from 'fs';
import vm from 'vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const marker = '  function leadTrack(l) { return ((l.crm && l.crm.overrides) || {}).track || \'\'; }';
if (!src.includes(marker)) { console.log('НЕ НАШЕЛ якорь leadTrack'); process.exit(1); }
const patched = src.replace(marker, marker +
  '\n  globalThis.__L = { opts: function (a) { return trackOptions(a); },' +
  ' label: function () { return trackLabel(); },' +
  ' ownOpts: function (a) { return ownerOptions(a); },' +
  ' ownLabel: function (a) { return ownerLabel(a); },' +
  ' ownHit: function (l, seg) { return ownerHit(l, seg); },' +
  ' stCell: function (l) { return stageCell(l); },' +
  ' hit: function (l, seg) { return trackHit(l, seg); },' +
  ' keys: function (seg) { return quickKeys(seg); },' +
  ' clsHit: function (l, seg) { return classHit(l, seg); },' +
  ' tutorCol: function () { return tutorCol(); },' +
  ' klassy: function () { return qlClasses(); },' +
  ' klassLabel: function (y) { return qlClassLabel(y); },' +
  ' owner: function (l) { return ownerName(l); },' +
  ' tone: function (n) { return tutorTone(n); },' +
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
L.state.trk = '';
L.state.cls = 0;
const o = (list, label) => list.filter(x => x.label === label)[0];
const list1 = L.opts(arr);
check('пункт «Все направления» со счетчиком 5', (o(list1, 'Все направления') || {}).n === 5, JSON.stringify(list1[0]));
check('название берется с бэкенда, а не ключ', (o(list1, 'Бакалавриат') || {}).n === 2 && !list1.some(x => x.label === 'bachelor'),
  list1.map(x => x.label).join(','));
check('пункт «Языковой год по гранту» со счетчиком 1', (o(list1, 'Языковой год по гранту') || {}).n === 1, '');
check('пункт «Без направления» со счетчиком 1', (o(list1, 'Без направления') || {}).n === 1, '');
check('языковой год стоит перед бакалавриатом',
  list1.findIndex(x => x.label === 'Языковой год по гранту') < list1.findIndex(x => x.label === 'Бакалавриат'), '');
check('пустых направлений в списке нет', !list1.some(x => x.label === 'Магистратура'), list1.map(x => x.label).join(','));
check('подпись кнопки без фильтра — «Все направления»', L.label() === 'Все направления', L.label());

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
check('незнакомое направление попадает в список', (o(L.opts(extra), 'newtrack') || {}).n === 1,
  L.opts(extra).map(x => x.label).join(','));

/* Ряд срезов воронки: на «Сопровождении» короче (Мария 19.11.2026). */
check('на «Сопровождении» ровно три среза', L.keys('support').join(',') === ',tasks,attention', L.keys('support').join(','));
check('квал-лидов и «без контакта» там нет', ['mql', 'sql', 'nocontact'].every(function (k) { return L.keys('support').indexOf(k) < 0; }), '');
check('на «Клиентах» ряд прежний', L.keys('clients').indexOf('mql') > 0 && L.keys('clients').indexOf('nocontact') > 0, L.keys('clients').join(','));
L.state.quick = 'mql';
check('чужой срез не режет «Сопровождение»', L.pred('support')({ crm: {} }) === true, '');
check('тот же срез на «Клиентах» работает', L.pred('clients')({ crm: {} }) === false, '');
L.state.quick = '';

/* Класс школьника: чипы стоят в том же ряду, что направления, и работают вместе
   с ними. Сам класс считает сервер (school_class), CRM только раскладывает. */
const klassy = [
  lead('Аня', 'bachelor'), lead('Боря', 'bachelor'),
  lead('Вера', 'lang_grant'), lead('Гена', 'master_direct'), lead('Дина', ''),
];
klassy[0].school_class = 9;
klassy[1].school_class = 10;
klassy[2].school_class = 9;
klassy[3].school_class = null;
klassy[4].school_class = 8;

L.state.seg = 'support';
L.state.trk = '';
L.state.cls = 0;
const hk = L.opts(klassy);
check('в списке есть «9 класс» со счетчиком 2', (o(hk, '9 класс') || {}).n === 2, JSON.stringify(hk));
check('классы отделены от направлений волоском', hk.some(x => x.sep), JSON.stringify(hk));
check('класс без людей не пропадает, а стоит с нулем',
  hk.some(x => x.label === '8 класс') && hk.some(x => x.label === '9 класс') && hk.some(x => x.label === '10 класс'),
  hk.map(x => x.label).join(','));
check('лишних классов в списке нет', !hk.some(x => x.label === '11 класс'), '');
check('направления в том же списке остались', hk.some(x => x.label === 'Бакалавриат'), '');
check('волосок стоит после направлений, а не в начале',
  hk.findIndex(x => x.sep) > hk.findIndex(x => x.label === 'Бакалавриат'), '');
L.state.trk = 'bachelor';
check('подпись кнопки называет выбранное направление', L.label() === 'Бакалавриат', L.label());
L.state.cls = 9;
check('направление и класс стоят в подписи вместе', L.label() === 'Бакалавриат · 9 класс', L.label());
L.state.trk = '';
L.state.cls = 0;

L.state.cls = 9;
check('фильтр «9 класс» дает двоих', klassy.filter(l => L.clsHit(l, 'support')).map(l => l.id).join(',') === 'Аня,Вера',
  klassy.filter(l => L.clsHit(l, 'support')).map(l => l.id).join(','));
check('класс складывается с направлением, а не спорит с ним',
  klassy.filter(l => L.hit(l, 'support') && L.clsHit(l, 'support')).map(l => l.id).join(',') === 'Аня,Вера', '');
L.state.trk = 'bachelor';
check('«Бакалавриат» и «9 класс» вместе дают одного',
  klassy.filter(l => L.hit(l, 'support') && L.clsHit(l, 'support')).map(l => l.id).join(',') === 'Аня', '');
check('на чужой вкладке класс не режет список', klassy.filter(l => L.clsHit(l, 'clients')).length === 5, '');
L.state.trk = '';
L.state.cls = 0;

/* Колонка «Тьютор» вместо «Статуса» — только в «Сопровождении». */
L.state.seg = 'support';
check('в «Сопровождении» колонка отдана тьютору', L.tutorCol() === true, '');
L.state.seg = 'clients';
check('в «Клиентах» остается статус', L.tutorCol() === false, '');
check('имя ведущего берется из карточки',
  L.owner({ crm: { owner: { id: 1, name: 'Элиза Аюпова' } } }) === 'Элиза Аюпова', '');
check('без ответственного имени нет, а не «undefined»', L.owner({ crm: {} }) === '', JSON.stringify(L.owner({ crm: {} })));
L.state.seg = 'support';

/* Поле «Класс» в карточке пишет ГОД окончания школы, а не класс. */
const opts = L.klassy();
const god = (n) => (opts.filter(o => o[1] === n + ' класс')[0] || [])[0];
const now = new Date();
const konec = now.getMonth() + 1 >= 9 ? now.getFullYear() + 1 : now.getFullYear();
check('в списке семь классов, с 5 по 11', opts.length === 7 && opts[0][1] === '5 класс' && opts[6][1] === '11 класс',
  opts.map(o => o[1]).join(','));
check('одиннадцатый выпускается в этом учебном году', god(11) === String(konec), String(god(11)));
check('восьмой выпускается через три года', god(8) === String(konec + 3), String(god(8)));
check('прошлый год выпуска подписан отдельно, а не теряется',
  L.klassLabel(konec - 2) === 'выпуск ' + (konec - 2), L.klassLabel(konec - 2));

/* Цвет тьютора: четверых Мария назвала поименно, ключ — фамилия. */
check('Саше желтый', L.tone('Александр Сердотецков') === 'amber', L.tone('Александр Сердотецков'));
check('Насте зеленый', L.tone('Анастасия Мишина') === 'green', L.tone('Анастасия Мишина'));
check('Алене розовый', L.tone('Алена Малахова') === 'pink', L.tone('Алена Малахова'));
check('Элизе голубой в любом порядке слов',
  L.tone('Аюпова Элиза') === 'blue' && L.tone('Элиза Аюпова') === 'blue', L.tone('Элиза Аюпова'));
check('Марии фиолетовый', L.tone('Мария Шустова') === 'violet', L.tone('Мария Шустова'));
check('буква е вместо ё не ломает цвет', L.tone('Алёна Малахова') === 'pink', L.tone('Алёна Малахова'));
check('остальным цвет из спокойной части палитры и всегда тот же',
  L.tone('Светлана Рошенская') === L.tone('Светлана Рошенская') &&
  ['amber', 'green', 'pink', 'blue'].indexOf(L.tone('Светлана Рошенская')) < 0, L.tone('Светлана Рошенская'));

/* Выпадашка по тьюторам (Мария 19.11.2026): список ведущих со счетчиком учеников,
   фильтр по id, имя в своем цвете. */
const tut = (id, name) => ({ id: 'l' + Math.random(), crm: { overrides: {}, owner: id ? { id: id, name: name } : null } });
const kom = [
  tut(1, 'Александр Сердотецков'), tut(1, 'Александр Сердотецков'), tut(1, 'Александр Сердотецков'),
  tut(2, 'Анастасия Мишина'), tut(2, 'Анастасия Мишина'),
  tut(3, 'Аюпова Элиза'), tut(0, ''),
];
L.state.seg = 'support';
L.state.own = '';
const tl = L.ownOpts(kom);
check('первым пунктом «Все тьюторы» со счетчиком 7', tl[0].label === 'Все тьюторы' && tl[0].n === 7, JSON.stringify(tl[0]));
check('у Саши трое учеников', (o(tl, 'Александр Сердотецков') || {}).n === 3, JSON.stringify(tl));
check('тьюторы идут по числу учеников', tl[1].label === 'Александр Сердотецков' && tl[2].label === 'Анастасия Мишина',
  tl.map(x => x.label).join(','));
check('имя в списке стоит в своем цвете', (o(tl, 'Анастасия Мишина') || {}).tone === 'green', JSON.stringify(o(tl, 'Анастасия Мишина')));
check('ученик без тьютора считается отдельно', (o(tl, 'Без тьютора') || {}).n === 1, '');
check('подпись кнопки без фильтра — «Все тьюторы»', L.ownLabel(kom) === 'Все тьюторы', L.ownLabel(kom));

L.state.own = '2';
check('фильтр по тьютору дает только его учеников', kom.filter(l => L.ownHit(l, 'support')).length === 2,
  String(kom.filter(l => L.ownHit(l, 'support')).length));
check('подпись кнопки называет выбранного', L.ownLabel(kom) === 'Анастасия Мишина', L.ownLabel(kom));
check('на чужой вкладке тьютор не режет список', kom.filter(l => L.ownHit(l, 'clients')).length === 7, '');
L.state.own = 'none';
check('«Без тьютора» дает одного', kom.filter(l => L.ownHit(l, 'support')).length === 1, '');
L.state.own = '';
check('без фильтра видны все семеро', kom.filter(l => L.ownHit(l, 'support')).length === 7, '');

/* Колонка «Этап» вместо балла (Мария 20.11.2026). Состояния считает сервер, браузер
   рисует: проверяем, что рисует он ровно то, что приехало. */
const steps = [
  { k: 'access', n: 'Доступ', s: 'done', d: 2, t: 2 },
  { k: 'diag', n: 'Диагностика', s: 'done', d: 3, t: 3 },
  { k: 'pick', n: 'Подбор', s: 'now', d: 4, t: 9 },
  { k: 'docs', n: 'Документы', s: 'open', d: 0, t: 2 },
  { k: 'lang', n: 'Язык', s: 'none', d: 0, t: 0 },
];
const withStage = { id: 'x', crm: { overrides: {} },
  stage: { key: 'pick', short: 'Подбор', title: 'Подбор', pos: 3, total: 5, steps: steps } };
const cell = L.stCell(withStage);
check('в строке только название этапа и место в маршруте, без полоски',
  cell.indexOf('Подбор') > 0 && cell.indexOf('3/5') > 0 && !/class="sg/.test(cell), cell);
check('по ячейке можно нажать — открывается карточка на «Поступлении»',
  /data-stid="x"/.test(cell) && /data-stop="1"/.test(cell) &&
  /role="button"/.test(cell) && /aria-label="Поступление/.test(cell), cell);
const noPlan = L.stCell({ id: 'y', crm: { overrides: {} }, stage: null });
check('плана нет — так и написано, а не первый этап',
  noPlan.indexOf('план не собран') > 0, noPlan);
/* Собирают план на той же вкладке карточки, куда ведет ячейка, — мертвой строки
   из нее делать незачем. */
check('«план не собран» тоже открывает карточку',
  /data-stid="y"/.test(noPlan) && /role="button"/.test(noPlan), noPlan);
/* Старый ответ сервера (поля stage нет вовсе) — это не «плана нет»: звать собирать
   план, пока бэкенд не выкачен, значит врать всей вкладке разом. */
check('сервер еще не умеет этапы — молчим, а не зовем собирать план',
  L.stCell({ id: 'z', crm: { overrides: {} } }).indexOf('план не собран') < 0,
  L.stCell({ id: 'z', crm: { overrides: {} } }));
/* Старый ответ сервера (поля stage нет) ячейкой-кнопкой быть не должен: вести
   человека в план, которого сервер еще не умеет считать, незачем. */
check('без поля stage ячейка не кнопка',
  !/role="button"/.test(L.stCell({ id: 'z', crm: { overrides: {} } })),
  L.stCell({ id: 'z', crm: { overrides: {} } }));

console.log(bad ? ('\nпровалено проверок: ' + bad) : '\nвсе проверки прошли');
process.exit(bad ? 1 : 0);
