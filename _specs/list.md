# Спек: страница «Клиенты» + статус-пилюли (глобально) + UX тулбара/таблицы/канбана

Агент LIST. Файлы: `crm/app.js`, `crm/style.css`. No-build vanilla JS, светлая Botamin-админка, Manrope.
Все токены уже в `:root`. Иконки только через `ic()`. Без эмодзи, без точек-индикаторов, без кринж-красного.

---

## 1. Решения и логика (кратко)

**A. Статус-пилюли (`.sev`) — глобальный передизайн без точек.**
- Дословная претензия: «точки это кринжатина». Убираю `.d`-точку из всех 7 мест, где рендерятся `.sev`.
- Подход: (1) в CSS прячу `.sev .d { display:none }` — это страхует ВСЕ существующие пилюли (в т.ч. инлайновые в дашборде и оплатах, которые я не переписываю), чтобы нигде не осталось точки; (2) в `sevPill` убираю `<span class="d">` из разметки, чтобы новый код был чистым.
- Новый вид `.sev`: мягкий тонированный фон + цветной текст, вес 600, чуть плотнее по горизонтали, аккуратный радиус (не капсула-таблетка, а r8 — премиальнее в плотной таблице), без обводки. Регистр обычный (не CAPS — CAPS на коротком русском выглядит крикливо). Цвета берём из палитры дозированно: «ждет связи»/hot — единственный по-настоящему акцентный (красный благородный), остальные приглушённые.
- Пилюля живёт в таблице, канбане (там сейчас своя точка в `kb-head` — её НЕ трогаю, это заголовок колонки, не пилюля), модалке (`m-kicker`), `#smenu`, дашборде, оплатах. Стиль один на всех.

**B. `openSmenu` — премиальный пикер статуса без точек.**
- Сейчас рисует цветные `.dt`-кружки слева. Меняю на мини-пилюли `.sev` прямо в пунктах меню — то, что человек выбирает, выглядит ровно как то, что он получит в таблице. Текущий статус — галочка справа (как в `openDropdown`), без отдельного фона-выделения цветным кружком.
- `openDropdown`/`ddButton` не переписываю по разметке (они и так хороши), только причёсываю CSS меню под общий вид и добавляю мелочи (см. ниже).

**C. Тулбар «Клиенты» — UX-апгрейд.**
- Умный поиск: оставляю текущее поведение (ищет по имени/контакту/заметке/направлению/классу — уже есть в `segLeads`), но добавляю **кнопку очистки** (×) внутри поля и **счётчик найденного** в правом крае тулбара.
- **Быстрые срезы (saved filters / quick chips)**: ряд чипов сразу под основным рядом тулбара — «Все», «Горячие» (booking+new), «Назначен созвон», «Без контакта», «С задачами». Это пресеты поверх текущего сегмента — дешёвый прирост UX без новых сущностей. Состояние в `state.quick` (расширяю значения; сейчас там только `''`/`'attention'`). «Внимание» переезжает в этот ряд чипов, из основного ряда убираю дубль-кнопку (чтобы не было двух «вниманий»).
- **Сортировки**: уже есть клик по `th`. Усиливаю индикатор — заменяю текстовые `↑/↓` на аккуратную svg-стрелку через `ic`, активный столбец подсвечивается (фон + синий текст), добавляю title-подсказку.
- **Счётчик результатов**: `N из M` в правой части тулбара (найдено из всего сегмента) — даёт чувство контроля при фильтрации/поиске.
- **Пустые состояния**: премиальные — иконка + заголовок + подсказка + (для поиска) кнопка «Сбросить поиск». Сейчас просто текст.
- **Кастом-дропдауны**: остаются `f-funnel`/`f-period`, причёсан CSS, единый вид с пилюлями.

**D. Скелетон списка.**
- Сейчас при первой загрузке весь `view` показывает три прыгающих точки (`.loadwrap`). Для страницы «Клиенты» делаю **премиум-скелетон таблицы** (строки-плейсхолдеры с `.shim`-блоками) внутри карточки списка — структура уже видна, ощущается быстрее. `.shim` — общий шиммер от агента DASH (см. зависимости); если его ещё нет, ниже дан фолбэк-CSS, помеченный как временный.

**E. Шапка «Клиенты».**
- Отступы `.chead`/`.content` — глобальные, это участок DASH. Я НЕ переопределяю их. Единственная специфика списка: верт. ритм между шапкой и карточкой списка уже задаётся `.chead { padding-bottom }` (DASH). Оставляю как есть, согласовано — см. секцию «Пересечения».

---

## 2. CSS — добавить / заменить

### 2.1 ЗАМЕНИТЬ блок `.sev … .sev.s-rejected` (style.css строки 254–264) целиком

```css
/* ════ СТАТУС-ПИЛЮЛЯ (.sev) — единый премиальный стиль, БЕЗ точек-индикаторов ════ */
/* Используется в таблице, канбане, модалке, #smenu, дашборде, оплатах. */
.sev { display: inline-flex; align-items: center; justify-content: center;
  font-size: 11.5px; font-weight: 600; letter-spacing: -.005em; line-height: 1;
  padding: 6px 11px; border-radius: 8px; white-space: nowrap;
  color: var(--ink-2); background: var(--fill); }
/* точка-индикатор убрана глобально — страхует все инлайновые пилюли */
.sev .d { display: none; }

.sev.s-hot           { color: var(--red-ink);   background: var(--red-soft); }
.sev.s-new           { color: var(--ink-2);     background: var(--fill); }
.sev.s-contacted     { color: var(--amber-ink); background: var(--amber-soft); }
.sev.s-call_scheduled{ color: var(--blue);      background: var(--blue-tint); }
.sev.s-call_done     { color: var(--navy);      background: var(--blue-tint); }
.sev.s-offer_sent    { color: var(--amber-ink); background: var(--amber-soft); }
.sev.s-client        { color: var(--green-ink); background: var(--green-soft); }
.sev.s-rejected      { color: var(--ink-3);     background: var(--fill); }
```

Примечание: `s-call_done` отличаю от `s-call_scheduled` цветом текста (navy vs blue) на одном фоне — пилюли визуально различимы, но в одной «синей семье». `s-hot` — единственная красная, и она благородная (red-ink на red-soft, без заливки чистым красным).

### 2.2 ЗАМЕНИТЬ блок `#smenu button .dt` (style.css строка 770)

Старое (удалить):
```css
#smenu button .dt { width: 8px; height: 8px; border-radius: 50%; background: var(--ink-3); flex: none; }
```
Новое (вставить на его место) — пункты статус-меню теперь несут мини-пилюлю `.sev`, плюс галочку текущего:
```css
/* статус-меню: пункт = пилюля статуса (без точек), текущий помечен галочкой */
#smenu.smenu-status button { gap: 10px; padding: 8px 10px; }
#smenu.smenu-status button .sev { pointer-events: none; }
#smenu.smenu-status button .chk { margin-left: auto; color: var(--blue); opacity: 0; flex: none; }
#smenu.smenu-status button.cur { background: var(--fill); }
#smenu.smenu-status button.cur .chk { opacity: 1; }
```
(Старый селектор `#smenu button .dt` больше не используется — `openSmenu` его не рендерит. `openDropdown` свои `.dt` тоже не использует для статусов; если где-то ещё остаётся `.dt` в ddmenu — он безвреден, но в новом коде не нужен.)

### 2.3 ДОБАВИТЬ — тулбар «Клиенты»: ряд быстрых срезов + счётчик + кнопка очистки поиска

Вставить после блока `.list-tools` (после style.css строки 158, рядом с контейнером списка):

```css
/* кнопка очистки внутри поля поиска */
.searchwrap .s-clear { width: 22px; height: 22px; border-radius: 50%; flex: none; display: none;
  place-items: center; color: var(--ink-3); transition: .15s; }
.searchwrap .s-clear svg { width: 12px; height: 12px; }
.searchwrap.has-val .s-clear { display: grid; }
.searchwrap .s-clear:hover { color: var(--ink); background: #E7E9EE; }

/* счётчик результатов в тулбаре */
.list-count { margin-left: auto; font-size: 12.5px; font-weight: 600; color: var(--ink-3);
  white-space: nowrap; padding-right: 2px; }
.list-count b { color: var(--ink-2); font-weight: 700; }
/* когда есть счётчик, переключатель вида не должен прыгать вправо сам */
.list-tools .vseg { margin-left: 12px; }

/* второй ряд тулбара — быстрые срезы (чипы) */
.list-quick { display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  padding: 11px 16px; border-bottom: 1px solid var(--line); }
.qchip { display: inline-flex; align-items: center; gap: 7px; font: 600 12.5px 'Manrope', sans-serif;
  color: var(--ink-2); background: var(--fill); border: 1px solid transparent;
  border-radius: var(--r-pill); padding: 7px 13px; cursor: pointer; transition: .15s; white-space: nowrap; }
.qchip svg { width: 13px; height: 13px; color: var(--ink-3); }
.qchip:hover { color: var(--ink); background: #EDEFF3; }
.qchip .qn { font-size: 11px; font-weight: 700; color: var(--ink-3); }
.qchip.on { background: var(--navy); color: #fff; border-color: var(--navy); }
.qchip.on svg, .qchip.on .qn { color: rgba(255,255,255,.75); }
/* «горячий» срез — благородный красный акцент в активном виде */
.qchip.hot.on { background: var(--red); border-color: var(--red); }
.qchip.hot .qn { color: var(--red-ink); }
.qchip.hot.on .qn { color: rgba(255,255,255,.85); }
```

### 2.4 ЗАМЕНИТЬ индикатор сортировки `.th .dir` (style.css строка 252)

Старое:
```css
.th .dir { color: var(--blue); margin-left: 3px; }
```
Новое (активный столбец подсвечен, стрелка — svg):
```css
.th.sortable { display: inline-flex; align-items: center; gap: 5px; padding: 4px 8px;
  margin: -4px -8px; border-radius: 7px; transition: .12s; }
.th.sortable:hover { color: var(--ink-2); background: rgba(15,19,32,.03); }
.th.sortable.act { color: var(--blue); }
.th .dir { display: inline-flex; color: var(--blue); transition: transform .18s var(--ease); }
.th .dir.up { transform: rotate(180deg); }
/* в правой колонке («Пришел») стрелка слева от текста — чтобы не уезжала за край */
.th.r.sortable { justify-content: flex-end; }
```

### 2.5 ДОБАВИТЬ — премиальные пустые состояния списка

```css
.list-empty { display: flex; flex-direction: column; align-items: center; text-align: center;
  padding: 64px 24px; }
.list-empty .le-ic { width: 52px; height: 52px; border-radius: 15px; background: var(--fill);
  display: grid; place-items: center; color: var(--ink-3); margin-bottom: 16px; }
.list-empty .le-t { font-size: 15px; font-weight: 600; color: var(--ink); }
.list-empty .le-s { font-size: 13px; color: var(--ink-2); margin-top: 6px; max-width: 340px; line-height: 1.5; }
.list-empty .le-btn { margin-top: 16px; display: inline-flex; align-items: center; gap: 7px;
  font: 600 13px 'Manrope', sans-serif; color: var(--blue); background: var(--blue-tint);
  border-radius: var(--r-pill); padding: 9px 16px; transition: .15s; }
.list-empty .le-btn:hover { background: #DBE6FF; }
```

### 2.6 ДОБАВИТЬ — скелетон таблицы списка

`.shim` — общий шиммер (агент DASH). Если он уже определён — НЕ дублировать первый блок ниже, использовать только `.sk-row`/`.sk-cell`.

```css
/* ── ВРЕМЕННЫЙ ФОЛБЭК: удалить, если .shim уже задан агентом DASH ── */
.shim { position: relative; overflow: hidden; background: var(--fill); border-radius: 7px; }
.shim::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.65), transparent);
  animation: shimmer 1.3s infinite; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
/* ── конец фолбэка ── */

.sk-list { padding: 0; }
.sk-row { display: grid; align-items: center; gap: 16px; padding: 0 24px; height: 58px;
  border-bottom: 1px solid var(--line); grid-template-columns: 138px 1.4fr 130px 170px 110px 30px; }
.sk-row:last-child { border-bottom: none; }
.sk-cell { height: 12px; }
.sk-cell.pill { height: 26px; width: 96px; border-radius: 8px; }
.sk-cell.w60 { width: 60%; } .sk-cell.w40 { width: 40%; } .sk-cell.w80 { width: 80%; }
@media (max-width: 960px) {
  .sk-row { grid-template-columns: 100px 1fr 80px !important; gap: 10px; padding: 0 14px; }
  .sk-row .hidem { display: none; }
}
```

---

## 3. JS — полные функции (что заменяют / где вставляются)

### 3.1 ЗАМЕНЯЕТ `sevPill` (app.js строки 468–473)

```js
/* статус-пилюля (sev) — без точки-индикатора, единый вид везде */
function sevPill(l) {
  if (l.booking && l.crm.status === 'new') {
    return '<span class="sev s-hot">ждет связи</span>';
  }
  return '<span class="sev s-' + l.crm.status + '">' + CRM[l.crm.status].label + '</span>';
}
```

### 3.2 ЗАМЕНЯЕТ `openSmenu` (app.js строки 481–501)

Пункты меню теперь — мини-пилюли статуса + галочка текущего (без цветных кружков `.dt`).

```js
function openSmenu(lead, anchor) {
  closeSmenu();
  smenu = document.createElement('div');
  smenu.id = 'smenu'; smenu.className = 'smenu-status';
  smenu.innerHTML = Object.keys(CRM).map(function (k) {
    return '<button data-s="' + k + '" class="' + (lead.crm.status === k ? 'cur' : '') + '">' +
      '<span class="sev s-' + k + '">' + CRM[k].label + '</span>' +
      '<span class="chk">' + ic('check', 14) + '</span></button>';
  }).join('');
  document.body.appendChild(smenu);
  var r = anchor.getBoundingClientRect();
  smenu.style.top = Math.min(r.bottom + 6, window.innerHeight - smenu.offsetHeight - 8) + 'px';
  smenu.style.left = Math.min(r.left, window.innerWidth - smenu.offsetWidth - 8) + 'px';
  Array.prototype.forEach.call(smenu.children, function (b) {
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      var s = b.getAttribute('data-s');
      closeSmenu();
      if (s !== lead.crm.status) patch(lead.id, { status: s });
    });
  });
}
```

### 3.3 ДОБАВИТЬ хелпер `quickPred` (новый; вставить рядом с `segLeads`, перед ним — app.js ~строка 355). Вызывается из `segLeads`.

Возвращает предикат быстрого среза. Срезы — поверх сегмента.

```js
/* быстрые срезы тулбара (quick chips) — предикаты поверх сегмента */
var QUICK = {
  '':            { label: 'Все',              icon: 'rows' },
  hot:           { label: 'Горячие',          icon: 'flame', pred: function (l) { return l.booking && l.crm.status === 'new'; } },
  scheduled:     { label: 'Назначен созвон',  icon: 'cal',   pred: function (l) { return l.crm.status === 'call_scheduled'; } },
  nocontact:     { label: 'Без контакта',     icon: 'phone', pred: function (l) { return !((l.booking || {}).contact); } },
  tasks:         { label: 'С задачами',       icon: 'task',  pred: function (l) { return (l.crm.tasks || []).some(function (t) { return !t.done; }); } },
  attention:     { label: 'Внимание',         icon: 'flame', pred: function (l) { return leadRisks(l).length; } },
};
function quickPred() {
  var q = QUICK[state.quick];
  return (q && q.pred) ? q.pred : function () { return true; };
}
```

### 3.4 ЗАМЕНЯЕТ `segLeads` (app.js строки 355–391)

Меняется только строка фильтра quick — вместо хардкода `attention` используется `quickPred()`. Остальное идентично оригиналу (сохранены сортировки и поиск).

```js
function segLeads(seg) {
  var qp = quickPred();
  var arr = segBase(seg).filter(function (l) {
    if (state.filters.funnel && l.status !== state.filters.funnel) return false;
    if (!inPeriod(l, state.filters.period)) return false;
    if (!qp(l)) return false;
    return true;
  });
  if (state.sort) {
    var s = state.sort;
    arr.sort(function (a, b) {
      var av, bv;
      if (s.col === 'score') { av = a.score == null ? -1 : a.score; bv = b.score == null ? -1 : b.score; }
      else if (s.col === 'name') {
        av = (a.name || 'яяя').toLowerCase(); bv = (b.name || 'яяя').toLowerCase();
        return av.localeCompare(bv, 'ru') * s.dir;
      }
      else if (s.col === 'crm') { av = CRM[a.crm.status].order; bv = CRM[b.crm.status].order; }
      else { av = new Date(a.created_at || 0).getTime(); bv = new Date(b.created_at || 0).getTime(); }
      return (av - bv) * s.dir;
    });
  } else if (seg === 'queue') {
    arr.sort(function (a, b) {
      var d = CRM[a.crm.status].order - CRM[b.crm.status].order;
      if (d) return d;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  }
  if (state.q) {
    arr = arr.filter(function (l) {
      var dirs = Array.isArray(l.directions) ? l.directions.join(' ') : (l.directions || '');
      var hay = ((l.name || '') + ' ' + (l.email || '') + ' ' + ((l.booking || {}).contact || '') + ' ' +
        (l.crm.note || '') + ' ' + dirs + ' ' + (l.grade || '')).toLowerCase();
      return hay.indexOf(state.q) !== -1;
    });
  }
  return arr;
}
```

### 3.5 ЗАМЕНЯЕТ `leadsToolbar` (app.js строки 533–547)

Основной ряд: поиск (с кнопкой-очисткой) + фильтры + счётчик + переключатель вида.
Второй ряд: быстрые срезы (чипы) с живыми счётчиками.

```js
/* панель инструментов «Клиенты»: поиск + фильтры + срезы + вид */
function leadsToolbar() {
  var funnelLabel = state.filters.funnel ? FUNNEL[state.filters.funnel] : 'Этап: все';
  var periodLabels = { '': 'За все время', today: 'Сегодня', week: '7 дней', month: '30 дней' };

  /* счётчики срезов считаем по текущему сегменту (без учёта самого среза) */
  var segArr = segBase(state.seg).filter(function (l) {
    if (state.filters.funnel && l.status !== state.filters.funnel) return false;
    return inPeriod(l, state.filters.period);
  });
  var total = segArr.length;
  var shown = segLeads(state.seg).length;

  var order = ['', 'hot', 'scheduled', 'nocontact', 'tasks', 'attention'];
  var chips = order.map(function (k) {
    var q = QUICK[k];
    var n = q.pred ? segArr.filter(q.pred).length : total;
    if (k && !n) return ''; // пустые срезы не показываем (кроме «Все»)
    var on = (state.quick || '') === k;
    return '<button class="qchip' + (k === 'hot' ? ' hot' : '') + (on ? ' on' : '') + '" data-q="' + k + '">' +
      ic(q.icon, 13) + q.label + '<span class="qn num">' + n + '</span></button>';
  }).join('');

  var countTxt = (shown === total)
    ? '<b>' + total + '</b> ' + plural(total, 'клиент', 'клиента', 'клиентов')
    : '<b>' + shown + '</b> из ' + total;

  return '<div class="list-tools">' +
      '<div class="searchwrap' + (state.q ? ' has-val' : '') + '">' + ic('leads', 15) +
        '<input id="search" class="search" type="search" placeholder="Имя, контакт, заметка, направление — клавиша /" autocomplete="off">' +
        '<button class="s-clear" id="s-clear" title="Очистить">' + ic('x', 12) + '</button></div>' +
      (state.seg === 'all' ? ddButton('f-funnel', funnelLabel, !!state.filters.funnel) : '') +
      ddButton('f-period', periodLabels[state.filters.period] || 'За все время', !!state.filters.period) +
      '<span class="list-count num" id="list-count">' + countTxt + '</span>' +
      '<div class="vseg">' +
        '<button data-v="table" class="' + (state.viewMode === 'table' ? 'on' : '') + '" title="Таблица">' + ic('rows', 14) + '</button>' +
        '<button data-v="kanban" class="' + (state.viewMode === 'kanban' ? 'on' : '') + '" title="Канбан">' + ic('kanban', 14) + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="list-quick">' + chips + '</div>';
}
```

### 3.6 ЗАМЕНЯЕТ `attachToolbarHandlers` (app.js строки 548–575)

Добавлены: очистка поиска (×), чипы срезов, обновление счётчика без пересборки тулбара. Дропдауны и переключатель вида — как раньше.

```js
function attachToolbarHandlers() {
  var search = el('search'), wrap = search && search.closest('.searchwrap');
  if (search) {
    search.value = state.q;
    search.addEventListener('input', function () {
      state.q = this.value.trim().toLowerCase();
      if (wrap) wrap.classList.toggle('has-val', !!this.value);
      rerenderListBody();
      updateListCount();
    });
  }
  var clr = el('s-clear');
  if (clr) clr.addEventListener('click', function () {
    state.q = '';
    if (search) { search.value = ''; search.focus(); }
    if (wrap) wrap.classList.remove('has-val');
    rerenderListBody(); updateListCount();
  });

  var ff = el('f-funnel');
  if (ff) ff.addEventListener('click', function (e) {
    e.stopPropagation();
    if (ff.classList.contains('open')) { closeSmenu(); ff.classList.remove('open'); return; }
    openDropdown(ff, [{ v: '', label: 'Этап: все' }].concat(Object.keys(FUNNEL).map(function (k) { return { v: k, label: FUNNEL[k] }; })),
      state.filters.funnel || '', function (v) { state.filters.funnel = v; saveUi(); renderView(); });
  });
  var fp = el('f-period');
  if (fp) fp.addEventListener('click', function (e) {
    e.stopPropagation();
    if (fp.classList.contains('open')) { closeSmenu(); fp.classList.remove('open'); return; }
    openDropdown(fp, [{ v: '', label: 'За все время' }, { v: 'today', label: 'Сегодня' }, { v: 'week', label: '7 дней' }, { v: 'month', label: '30 дней' }],
      state.filters.period || '', function (v) { state.filters.period = v; saveUi(); renderView(); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.list-quick .qchip'), function (b) {
    b.addEventListener('click', function () {
      var k = b.getAttribute('data-q');
      state.quick = (state.quick || '') === k ? '' : k;
      renderView();
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.list-tools .vseg button'), function (b) {
    b.addEventListener('click', function () { state.viewMode = b.getAttribute('data-v'); saveUi(); renderView(); });
  });
}

/* обновить счётчик результатов без пересборки тулбара (чтобы не терять фокус поиска) */
function updateListCount() {
  var node = el('list-count');
  if (!node) return;
  var segArr = segBase(state.seg).filter(function (l) {
    if (state.filters.funnel && l.status !== state.filters.funnel) return false;
    return inPeriod(l, state.filters.period);
  });
  var total = segArr.length, shown = segLeads(state.seg).length;
  node.innerHTML = (shown === total)
    ? '<b>' + total + '</b> ' + plural(total, 'клиент', 'клиента', 'клиентов')
    : '<b>' + shown + '</b> из ' + total;
}
```

> Примечание: старый код в `renderHead` (app.js строки 835–873) вешает дубль-обработчики на `#search`/`#f-funnel`/`#f-period`/`.vseg`/`#f-attn` через `.addEventListener('change')` для НАТИВНОГО select. Эти контролы давно кастомные (дивы/кнопки), и в шапке их больше нет — блок мёртвый и при двойном навешивании может конфликтовать с моими хендлерами. **Удалить из `renderHead` хвост со строки 835 (`var search = el('search');`) до конца строки 873** (перед закрывающей `}` функции). Это участок DASH (`renderHead` общий) — согласовать с агентом DASH; если он не успеет, я могу взять удаление на себя, но трогаю только эти мёртвые строки.

### 3.7 ЗАМЕНЯЕТ `renderListBody` (app.js строки 1137–1142) — добавлен скелетон

```js
function renderListBody() {
  var host = el('list-body');
  if (!host) return;
  if (!state.loaded) return fillSkeleton(host);
  if (state.viewMode === 'kanban' && !mqMobile.matches) return fillKanban(host);
  fillTable(host);
}

/* премиум-скелетон таблицы на время загрузки */
function fillSkeleton(host) {
  var widths = ['w60', 'w80', 'w40', 'w60', 'w80', 'w40', 'w60', 'w80'];
  host.innerHTML = '<div class="sk-list">' + widths.map(function (w) {
    return '<div class="sk-row">' +
      '<span class="shim sk-cell pill"></span>' +
      '<span class="shim sk-cell ' + w + '"></span>' +
      '<span class="shim sk-cell hidem w40"></span>' +
      '<span class="shim sk-cell hidem w60"></span>' +
      '<span class="shim sk-cell hidem w40"></span>' +
      '<span class="shim sk-cell hidem w40"></span></div>';
  }).join('') + '</div>';
}
```

> Зависимость: `renderLeads` (строка 1132) рендерит карточку списка с тулбаром и `#list-body`, затем зовёт `renderListBody`. Сейчас при `!state.loaded` глобальный `renderView` (строка 886) перехватывает и показывает `.loadwrap` ДО `renderLeads`. Чтобы скелетон списка сработал, нужно, чтобы для страницы `leads` не срабатывал ранний `.loadwrap`. Минимальная правка в `renderView` (см. 3.9).

### 3.8 ЗАМЕНЯЕТ `fillTable` пустые состояния + хедер сортировки (app.js строки 1144–1192, части)

Меняю только (а) ветку пустого состояния и (б) шапку с сортировкой + (в) `sortMark`. Тело строк (`rows`) и обработчики ниже — без изменений (строки 1155–1183 и 1194–1221 оставить как есть).

Заменить блок пустого состояния (строки 1146–1154):
```js
  if (!arr.length) {
    host.innerHTML = emptyState();
    return;
  }
```

Заменить блок шапки (строки 1185–1192) на:
```js
  host.innerHTML = '<div class="trow lr-grid thead">' +
      thCell('crm', 'Статус', '') +
      thCell('name', 'Лид', '') +
      thCell('score', 'Балл', ' hidem') +
      '<span class="th hidem">Контакт</span>' +
      thCell('created', 'Пришел', ' r') +
      '<span class="th hidem"></span>' +
    '</div>' + rows;
```

ДОБАВИТЬ (новые хелперы, рядом с `sortMark`, app.js ~строка 1381):
```js
/* ячейка-заголовок с сортировкой и svg-индикатором */
function thCell(col, label, extraCls) {
  var act = state.sort && state.sort.col === col;
  return '<span class="th sortable' + (extraCls || '') + (act ? ' act' : '') + '" data-sort="' + col + '" ' +
    'title="Сортировать по: ' + esc(label) + '">' + esc(label) + sortMark(col) + '</span>';
}
/* премиум пустое состояние списка */
function emptyState() {
  if (state.q) {
    return '<div class="list-empty"><span class="le-ic">' + ic('leads', 22) + '</span>' +
      '<div class="le-t">Ничего не нашлось</div>' +
      '<div class="le-s">По запросу «' + esc(state.q) + '» нет совпадений. Проверь написание или сбрось поиск.</div>' +
      '<button class="le-btn" id="le-clear">' + ic('x', 13) + 'Сбросить поиск</button></div>';
  }
  if (state.quick) {
    var ql = (QUICK[state.quick] || {}).label || 'срез';
    return '<div class="list-empty"><span class="le-ic">' + ic('filter', 22) + '</span>' +
      '<div class="le-t">В срезе «' + esc(ql) + '» пусто</div>' +
      '<div class="le-s">Сейчас сюда никто не попадает. Сними срез, чтобы увидеть всех.</div>' +
      '<button class="le-btn" id="le-clear">' + ic('x', 13) + 'Снять срез</button></div>';
  }
  var map = {
    queue: ['Очередь пуста', 'По всем заявкам есть движение — горячих на связь нет.', 'check'],
    clients: ['Клиентов пока нет', 'Будут — как только первая заявка дойдет до оплаты.', 'card'],
    rejected: ['Отказов нет', 'Никто пока не закрыт отказом. Так держать.', 'check'],
    all: ['Лидов пока нет', 'Появятся после первых прохождений диагностики на платформе.', 'leads'],
  };
  var m = map[state.seg] || map.all;
  return '<div class="list-empty"><span class="le-ic">' + ic(m[2], 22) + '</span>' +
    '<div class="le-t">' + m[0] + '</div><div class="le-s">' + m[1] + '</div></div>';
}
```

ЗАМЕНЯЕТ `sortMark` (app.js строки 1381–1384):
```js
function sortMark(col) {
  if (!state.sort || state.sort.col !== col) return '';
  return '<span class="dir' + (state.sort.dir > 0 ? ' up' : '') + '">' +
    '<svg width="11" height="11" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 4v11M5.5 10.5L10 15l4.5-4.5"/></svg></span>';
}
```
(стрелка по умолчанию вниз = убывание; класс `up` поворачивает на 180° = возрастание — совпадает с дефолтами `first` в обработчике сортировки.)

Кнопку сброса в пустом состоянии надо подвязать — ДОБАВИТЬ в конец `fillTable` (после существующего блока обработчиков, перед `arr.slice(0,8)...` или после него — порядок неважен, но при пустом `arr` строки-обработчики не выполнятся, так что добавляем до `return` не нужно; добавляем в самом начале после `host.innerHTML = emptyState()`):

В ветке пустого состояния заменить на:
```js
  if (!arr.length) {
    host.innerHTML = emptyState();
    var lc = el('le-clear');
    if (lc) lc.addEventListener('click', function () {
      state.q = ''; state.quick = '';
      renderView();
    });
    return;
  }
```

### 3.9 ЗАМЕНЯЕТ `renderView` ранний-загрузочный гард (app.js строки 886–889)

Чтобы на странице «Клиенты» показывался скелетон таблицы (с уже отрисованным тулбаром), а не общий `.loadwrap`:

```js
    if (!state.loaded) {
      if (state.page === 'leads') return renderLeads(view); // покажет тулбар + скелетон строк
      view.innerHTML = '<div class="loadwrap"><div class="loaddot"></div><div class="loaddot"></div><div class="loaddot"></div></div>';
      return;
    }
```
(`renderLeads` → `renderListBody` → `fillSkeleton`, т.к. `state.loaded` ещё false. При `!loaded` счётчики в тулбаре покажут 0 — это ок на доли секунды; после `loadLeads` идёт `renderAll`, тулбар пересоберётся с реальными числами.)

### 3.10 МЕЛОЧЬ: `state.quick` начальное значение

В `state` (app.js строка 19) `quick: ''` уже есть — менять не нужно. Значения теперь: `''|hot|scheduled|nocontact|tasks|attention`. В `saveUi` quick не сохраняется (и не надо — это эфемерный срез). Ок.

### 3.11 МЕЛОЧЬ: `kanban` — пустое состояние (app.js строки 1230–1233)

Для единообразия заменить на премиум-вид:
```js
  if (!base.length) {
    host.innerHTML = '<div class="list-empty"><span class="le-ic">' + ic('kanban', 22) + '</span>' +
      '<div class="le-t">Канбан пуст</div>' +
      '<div class="le-s">Оживет с первой записью на разбор — карточки появятся в колонках.</div></div>';
    return;
  }
```

---

## 4. BACKEND

Бэкенд не требуется. Все срезы/поиск/сортировки/счётчики считаются на клиенте по уже загруженным `state.leads` и `l.crm`. Новых полей и эндпоинтов нет.

---

## Пересечения и зависимости (для координации)

- **Агент DASH** владеет: `.content`/`.chead`/`statBar`/дашборд-метрики/`renderDash`/`renderHead` (общий), и общим шиммером `.shim`.
  - Я использую `.shim` в скелетоне списка — если DASH его уже определил, **удалить мой временный фолбэк-блок** `.shim`/`@keyframes shimmer` (помечен в 2.6). Если нет — мой фолбэк рабочий.
  - Прошу DASH (или беру на себя по согласованию) **вырезать мёртвый хвост `renderHead` (строки 835–873)** — он навешивает `change`-хендлеры на несуществующие нативные select'ы и при моих кастом-контролах создаёт риск двойных обработчиков. Шапку «Клиенты» (`<h2>Клиенты</h2>` + verdict, строки 819–822) не трогаю — отступы её диктует `.chead` (DASH).
- **Дашборд** (`renderDash`) рендерит инлайн-пилюли `.sev s-hot/s-contacted` со своими `<span class="d">` (строки 920/928/934). Я их не переписываю, но глобальное `.sev .d { display:none }` уберёт точки и там — согласовано, выглядеть будет одинаково. Если DASH захочет — может убрать `<span class="d">` из своей разметки, не обязательно.
- **Оплаты** (`buildPaySection`, строка 1699) — инлайн-пилюля `.sev s-...` с `.d`; точка скроется глобально. Это участок MODAL-агента — конфликта нет, только выигрыш от единого стиля.
- `openDropdown`/`ddButton`/`#smenu` базовый — общие; мой `openSmenu` добавляет класс `smenu-status` к тому же `#smenu`-контейнеру, стили изолированы селектором `#smenu.smenu-status`.

---

## СЖАТО

- Передизайнил статус-пилюли `.sev` глобально: убрал точки-индикаторы (CSS `.sev .d{display:none}` + чистая разметка в `sevPill`), мягкий фон + цветной текст, r8, вес 600; благородный красный только для «ждет связи».
- `openSmenu` теперь показывает мини-пилюли статусов + галочку текущего вместо цветных кружков.
- Тулбар «Клиенты»: умный поиск с кнопкой-очисткой, второй ряд быстрых срезов (Все/Горячие/Назначен созвон/Без контакта/С задачами/Внимание) с живыми счётчиками, счётчик «N из M», svg-индикатор активной сортировки, премиум пустые состояния (поиск/срез/сегмент) с кнопкой сброса.
- Премиум-скелетон таблицы (`.shim` + `.sk-row`) вместо прыгающих точек на время загрузки списка.
- Зависимости: общий `.shim` от DASH (дан временный фолбэк); просьба к DASH вырезать мёртвый хвост `renderHead` 835–873 (двойные хендлеры). Пересечения с дашбордом/оплатами — только через глобальный `.sev` (точки исчезнут везде, стиль единый), их код не трогаю.
- Backend не нужен — всё на клиенте по `state.leads`.
