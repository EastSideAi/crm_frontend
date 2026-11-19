/* Картинка фильтра по направлению для показа оператору.
   Гоняет НАСТОЯЩИЙ код app.js в vm (как points-track-check.mjs) и собирает
   страницу из реальной разметки чипов и строк ученика поверх реального style.css.
   Ученики выдуманные: настоящие данные детей живут только в проде.
   Запуск: node tools/points-track-demo.mjs [путь.html]
*/
import fs from 'fs';
import vm from 'vm';

const src = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const marker = '  function pbTrack() { return state.ptTrack || \'\'; }';
if (!src.includes(marker)) { console.log('НЕ НАШЕЛ якорь pbTrack'); process.exit(1); }
const patched = src.replace(marker, marker +
  '\n  globalThis.__T = { tracks: function (s) { return pbTracks(s); }, filter: function (s) { return pbFilter(s); }, student: function (s) { return pbStudent(s); }, state: state };');

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
vm.runInContext(patched, ctx, { filename: 'app.js' });
const T = ctx.__T;

function pts(doneCount, left) {
  const keys = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const titles = ['Консультация и подбор', 'Документы собраны', 'Подача в вузы',
    'Приглашение и виза', 'Заезд и заселение'];
  return keys.map((k, i) => ({
    key: k, title: titles[i],
    items: [{ key: 'a', title: 'Шаг', done: i < doneCount }],
    left: i < doneCount ? 0 : left, amount: [3000, 7000, 9000, 9000, 12000][i],
    closedAt: i < doneCount ? '2026-11-05' : null, planDate: null, payDay: null,
  }));
}
const S = (name, track, trackName, done) => ({
  sessionId: name, name: name, track: track, trackName: trackName,
  points: pts(done, 1), money: { earned: done * 5000, ahead: 4000 },
  next: { key: 'p' + (done + 1), title: pts(0, 1)[Math.min(done, 4)].title, left: 1 },
  ownerName: 'Тьютор Елена', kvovl: 1,
});
const students = [
  S('Анна Светлова', 'bachelor_after_lang', 'Бакалавриат после языкового года', 2),
  S('Борис Ильин', 'bachelor', 'Бакалавриат', 3),
  S('Вера Каримова', 'bachelor', 'Бакалавриат', 1),
  S('Глеб Нестеров', 'lang_grant', 'Языковой год по гранту', 4),
  S('Дина Полянская', 'lang_paid', 'Платный языковой год', 0),
  S('Егор Мальцев', 'master', 'Магистратура', 2),
  S('Жанна Ковтун', 'master_after_lang', 'Магистратура после языкового года', 1),
  S('Игорь Трошин', 'master_direct', 'Магистратура, подача напрямую в вуз', 3),
  S('Зоя Радченко', '', '', 0),
];

function screen(active, title) {
  T.state.ptTrack = active;
  const rows = T.filter(students).map(T.student).join('');
  return '<section class="demo-sec"><div class="demo-cap">' + title + '</div>' +
    '<div class="content"><div id="view">' + T.tracks(students) + rows + '</div></div></section>';
}

const html = '<!doctype html><html lang="ru"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<title>Сопровождение: фильтр по направлению</title>' +
  '<link rel="stylesheet" href="../style.css">' +
  '<style>body{margin:0;padding:28px;background:#03081C}' +
  '.demo-sec{max-width:1080px;margin:0 auto 34px}' +
  '.demo-cap{color:#8aa0c8;font:600 13px/1.4 system-ui,sans-serif;margin:0 0 10px;letter-spacing:.01em}' +
  '.demo-note{max-width:1080px;margin:0 auto 26px;color:#6f84ab;font:400 12px/1.6 system-ui,sans-serif}' +
  '</style></head><body>' +
  '<div class="demo-note">Ученики выдуманные. Экран собран настоящим кодом CRM.</div>' +
  screen('', 'Все ученики — ряд направлений со счетчиками') +
  screen('bachelor', 'Нажали «Бакалавриат» — остались только они') +
  screen('none', 'Нажали «Без направления» — кого надо разобрать') +
  '</body></html>';

const out = process.argv[2] || new URL('../.tmp/pb-demo.html', import.meta.url).pathname;
fs.mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true });
fs.writeFileSync(out, html);
console.log('готово:', out);
