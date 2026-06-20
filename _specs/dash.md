# Дашборд (Обзор) + глобальные отступы + премиум-лоадер — спека

Участок: `renderDash` (owner + manager), `statBar`, `dirsCard`/`geoCard`, новый **блок задач**,
новый **dashboard-скелетон** (шиммеры), глобальные `.content` / `.chead` / `.grid` отступы,
переиспользуемый класс `.shim`. Файлы: `crm/app.js`, `crm/style.css`.

НЕ трогаю: модалку, списки (`fillTable`/`fillKanban`), финанс/оплаты. Статус-пилюли — стиль агента LIST
(использую существующие `.sev.s-*`).

---

## 1. Решения и логика

### 1.1 Вертикальный ритм / отступы (глобально)
Сейчас `.content` = `30px 30px 48px`, `.chead` = `padding:2px 2px 24px`, `.grid gap:18px`,
а внутри `renderDash` ряды грида разведены инлайном `margin-top:18px` — ритм рваный (полоса KPI,
потом grid с произвольными отступами). Решение — **единый шаг 20px**:
- `.content` → `34px 34px 52px` (больше воздуха сверху и по бокам, премиальнее).
- `.chead` → `padding:0 2px 26px`, заголовок и verdict выравниваются по базовой линии, фикс gap.
- `.grid` → `gap:20px`. Полосу KPI и грид разделяю **не инлайном**, а классом-обёрткой
  `.dash` с `display:flex; flex-direction:column; gap:20px`. Убираю все инлайновые `margin-top:18px`
  у `.grid` в `renderDash` (заменяю на обёртку `.dash`). Так все вертикальные интервалы = 20px.
- `.chead h2` чуть уменьшаю межбуквенный прыжок: оставляю 28px, но добавляю `line-height:1.1`,
  чтобы verdict не «отплывал».

### 1.2 Период метрик (новый фильтр дашборда)
Добавляю `state.dashPeriod` ('' | 'today' | 'week' | 'month'), сохраняю в `saveUi`.
Сегмент-контрол живёт в топбаре на странице `dash` (там сейчас только `freshchip`).
Период влияет на:
- KPI-полосу (через новую `dashCounts(period)` — period-aware `counts`);
- «Динамика 14 дней» оставляю всегда 14 дней (это отдельный таймлайн, период не трогает —
  подпись поясняет), но конверсии в KPI считаются по периоду;
- блок задач и «Воронка продаж» — НЕ фильтрую по периоду (задачи/воронка — это «состояние сейчас»,
  не временной срез; фильтровать их датой создания лида вредно). Период влияет только на
  входящий поток (сессии/заявки/клиенты/конверсии).

Быстрый срез убрал из скоупа избыточный — период покрывает «больше фильтров удобнее».

### 1.3 Отдельный блок задач
Сейчас задачи размазаны внутри «Сегодня — к действию» вперемешку с заявками и рисками.
Делаю **отдельную карточку «Задачи»** с тремя группами (через `groupTasks()`):
- **Просрочено** (due < сегодня) — благородный красный акцент слева (3px бар `r-crit`, без плашек);
- **Сегодня** (due == сегодня);
- **Ближайшие** (due в пределах +7 дней).
Каждая строка: имя лида, текст задачи, дата (`fmtDue`), стрелка. Клик → `openDrawer` (как в acts).
Пустое состояние — спокойное. Карточка идёт в дашборде owner и manager.
«Сегодня — к действию» остаётся, но из него убираю задачи (чтобы не было дублей) — теперь он про
горячие заявки + риски статусов, а задачи — в своей карточке.

### 1.4 Премиум-лоадер (шиммеры)
Ввожу единый класс `.shim` (keyframe `shimmer` — бегущий блик слева направо, не пульс).
Функция `dashSkeleton()` рисует layout будущего дашборда: полоса из 4 KPI-плиток + 2 крупные карточки.
`renderView()` при `!state.loaded` на странице dash зовёт `dashSkeleton()`, иначе — generic shimmer-каркас
(полоса + пара карточек). Старые `.loadwrap`/`.loaddot` удаляю из `renderView` (CSS-классы оставляю
в style.css неиспользуемыми — их больше никто не зовёт; можно удалить, но не обязательно).
`.shim` — переиспользуемый: списки/модалка смогут на него ссылаться (`.sk` уже есть как пульс —
`.shim` это новый, более премиальный блик; не конфликтует).

---

## 2. CSS — добавить / заменить

### 2.1 ЗАМЕНИТЬ `.content` и `.chead` (style.css ~строки 99–106)
```css
/* ════ КОНТЕНТ — единый вертикальный ритм (шаг 20px) ════ */
.content { padding: 34px 34px 52px; }
.chead { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px;
  padding: 0 2px 26px; flex-wrap: wrap; }
.chead h2 { font-size: 28px; font-weight: 700; letter-spacing: -.03em; line-height: 1.1; }
.verdict { font-size: 14px; color: var(--ink-2); margin-top: 12px; display: flex; align-items: flex-start;
  gap: 10px; line-height: 1.55; max-width: 92ch; }
.verdict .vspark { width: 24px; height: 24px; border-radius: 7px; background: var(--blue-tint);
  display: grid; place-items: center; color: var(--blue); flex: none; margin-top: 1px; }
.verdict b { color: var(--ink); font-weight: 600; }
```

### 2.2 ЗАМЕНИТЬ `.grid` (style.css ~строка 161)
```css
.grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 20px; align-items: stretch; }
```

### 2.3 ДОБАВИТЬ — обёртка дашборда + период-сегмент + блок задач + шиммер
Вставить блоком после секции `.statbar` (после style.css ~строки 220), до `.sp8`:
```css
/* ════ ДАШБОРД — вертикальный стек с единым ритмом ════ */
.dash { display: flex; flex-direction: column; gap: 20px; }

/* период-сегмент в топбаре (Обзор) */
.dperiod { display: inline-flex; gap: 3px; background: var(--fill); border-radius: var(--r-pill); padding: 4px; }
.dperiod button { padding: 8px 15px; border-radius: var(--r-pill); font: 600 12.5px 'Manrope', sans-serif;
  color: var(--ink-2); transition: .14s; white-space: nowrap; }
.dperiod button:hover { color: var(--ink); }
.dperiod button.on { background: #fff; color: var(--blue); box-shadow: 0 1px 2px rgba(15,19,32,.12); }

/* ════ БЛОК ЗАДАЧ (отдельная карточка) ════ */
.tasks-card .tk-group + .tk-group { border-top: 1px solid var(--line); }
.tk-glabel { display: flex; align-items: center; gap: 9px; padding: 14px 24px 6px;
  font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.tk-glabel .gn { font-size: 11px; font-weight: 700; color: var(--ink-2);
  background: var(--fill); border-radius: var(--r-pill); padding: 2px 9px; letter-spacing: 0; }
.tk-glabel.over { color: var(--red-ink); }
.tk-glabel.over .gn { color: var(--red-ink); background: var(--red-soft); }
.tk-row { display: grid; grid-template-columns: 1fr 96px 30px; gap: 14px; align-items: center;
  padding: 0 24px; height: 54px; cursor: pointer; transition: .14s; position: relative; }
.tk-row::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; opacity: 0; transition: .14s; }
.tk-row.over::before { background: var(--red); opacity: 1; }
.tk-row:hover { background: #FBFBFC; }
.tk-row:hover::before { opacity: 1; background: var(--blue); }
.tk-row.over:hover::before { background: var(--red); }
.tk-main { min-width: 0; }
.tk-txt { font-size: 14px; font-weight: 600; color: var(--ink); white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.tk-who { font-size: 12px; color: var(--ink-3); margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tk-due { font-size: 12.5px; font-weight: 600; color: var(--ink-2); text-align: right; white-space: nowrap; }
.tk-due.over { color: var(--red-ink); }
.tk-due.soon { color: var(--ink-3); font-weight: 500; }
.tk-go { width: 30px; height: 30px; border-radius: 9px; background: var(--fill);
  display: grid; place-items: center; color: var(--ink-3); transition: .15s; flex: none; }
.tk-row:hover .tk-go { background: var(--blue); color: #fff; }
.tasks-empty { display: flex; align-items: center; gap: 12px; padding: 26px 24px; color: var(--ink-2); font-size: 13.5px; }
.tasks-empty .te-ic { width: 34px; height: 34px; border-radius: 10px; background: var(--green-soft);
  color: var(--green); display: grid; place-items: center; flex: none; }

/* ════ ШИММЕР (единый премиум-лоадер) ════ */
.shim { position: relative; overflow: hidden; background: var(--fill); border-radius: 8px; }
.shim::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.85) 50%, transparent);
  animation: shimmer 1.5s var(--ease) infinite; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) { .shim::after { animation: none; } }

/* dashboard-скелетон: повторяет layout (полоса KPI + карточки) */
.sk-statbar { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; padding: 8px;
  background: var(--card); border: 1px solid var(--line); border-radius: var(--r-xl); }
.sk-stat { padding: 18px 22px; border-left: 1px solid var(--line); }
.sk-stat:first-child { border-left: 0; }
.sk-stat .shim { height: 12px; }
.sk-stat .shim.l { width: 60%; }
.sk-stat .shim.b { height: 34px; width: 46%; margin-top: 16px; border-radius: 10px; }
.sk-stat .shim.s { width: 38%; margin-top: 16px; }
.sk-card { background: var(--card); border: 1px solid var(--line); border-radius: var(--r-xl); padding: 22px 26px; }
.sk-card .sk-h { display: flex; align-items: center; gap: 12px; margin-bottom: 22px; }
.sk-card .sk-h .shim.ic { width: 30px; height: 30px; border-radius: 9px; flex: none; }
.sk-card .sk-h .shim.tt { height: 14px; width: 160px; }
.sk-line { display: flex; align-items: center; gap: 14px; padding: 13px 0; border-top: 1px solid var(--line); }
.sk-line:first-of-type { border-top: 0; }
.sk-line .shim.a { height: 12px; flex: 1; }
.sk-line .shim.c { height: 12px; width: 44px; }

@media (max-width: 960px) {
  .sk-statbar { grid-template-columns: repeat(2, 1fr); }
  .sk-stat:nth-child(-n+2) { border-left: 0; }
  .tk-row { grid-template-columns: 1fr 80px; padding: 0 14px; }
  .tk-row .tk-go { display: none; }
  .tk-glabel { padding: 12px 14px 6px; }
}
```

---

## 3. JS — полные функции

### 3.1 ЗАМЕНИТЬ инициализацию `state` (app.js ~строки 15–27)
Добавлено поле `dashPeriod` + загрузка из `savedUi`.
```js
  var state = {
    role: 'owner', userName: '', loaded: false,
    leads: [], page: 'dash', seg: 'queue', viewMode: 'table',
    q: '', sort: null, filters: { funnel: '', period: '' }, quick: '',
    dashPeriod: '',
    pathSel: null, pathPeriod: '',
    drawerId: null, drawerList: [], modalSection: 'now',
    details: {}, inflight: {}, seenBefore: 0, updatedAt: null, timer: null,
  };
  try {
    var savedUi = JSON.parse(localStorage.getItem(UI_LS) || '{}');
    ['page', 'seg', 'viewMode', 'dashPeriod'].forEach(function (k) { if (savedUi[k]) state[k] = savedUi[k]; });
    if (savedUi.filters) state.filters = { funnel: savedUi.filters.funnel || '', period: savedUi.filters.period || '' };
  } catch (e) {}
```

### 3.2 ЗАМЕНИТЬ `saveUi` (app.js ~строки 28–34)
Добавлен `dashPeriod` в сохранение.
```js
  function saveUi() {
    try {
      localStorage.setItem(UI_LS, JSON.stringify({
        page: state.page, seg: state.seg, viewMode: state.viewMode, filters: state.filters,
        dashPeriod: state.dashPeriod,
      }));
    } catch (e) {}
  }
```

### 3.3 НОВАЯ `dashCounts(period)` — period-aware счётчики
Вставить **сразу после** существующей `counts()` (app.js ~после строки 407).
Зовётся из `renderDash`. Не заменяет `counts()` (её используют сайдбар/топбар без периода).
```js
  /* period-aware счётчики для дашборда; period: '' | today | week | month */
  function dashCounts(period) {
    var base = period ? state.leads.filter(function (l) { return inPeriod(l, period); }) : state.leads;
    var c = { all: base.length, today: 0, week: 0, clients: 0, rejected: 0, hot: 0,
              queue: 0, anketa: 0, booked: 0 };
    var weekAgo = Date.now() - 7 * 86400000;
    base.forEach(function (l) {
      if (inQueue(l)) c.queue++;
      if (l.booking && l.crm.status === 'new') c.hot++;
      if (l.crm.status === 'client') c.clients++;
      if (l.crm.status === 'rejected') c.rejected++;
      if (l.created_at && new Date(l.created_at) > weekAgo) c.week++;
      if (isToday(l.created_at)) c.today++;
      if (l.status !== 'visited') c.anketa++;
      if (l.booking) c.booked++;
    });
    return c;
  }
  var DPERIOD_LABEL = { '': 'за всё время', today: 'сегодня', week: 'за 7 дней', month: 'за 30 дней' };
```

### 3.4 НОВАЯ `groupTasks()` — задачи по группам
Вставить после `dueTasks()` (app.js ~после строки 439).
```js
  /* задачи для дашборда: просроченные / сегодня / ближайшие 7 дней */
  function groupTasks() {
    var t = todayISO(0), in7 = todayISO(7);
    var over = [], today = [], soon = [];
    state.leads.forEach(function (l) {
      (l.crm.tasks || []).forEach(function (task) {
        if (task.done || !task.due) return;
        if (task.due < t) over.push({ lead: l, task: task });
        else if (task.due === t) today.push({ lead: l, task: task });
        else if (task.due <= in7) soon.push({ lead: l, task: task });
      });
    });
    var byDue = function (a, b) { return a.task.due < b.task.due ? -1 : a.task.due > b.task.due ? 1 : 0; };
    over.sort(byDue); today.sort(byDue); soon.sort(byDue);
    return { over: over, today: today, soon: soon, total: over.length + today.length + soon.length };
  }
```

### 3.5 НОВАЯ `tasksCard()` — рендер карточки задач
Вставить рядом с `statBar` (app.js ~после строки 908). Зовётся из `renderDash` (обе ветки).
Клик по строке навешивается в `renderDash` (общий обработчик `.tk-row[data-id]`).
```js
  /* отдельный блок задач: просрочено / сегодня / ближайшие */
  function tasksCard() {
    var g = groupTasks();
    var groups = [
      { key: 'over',  label: 'Просрочено', cls: 'over', rows: g.over },
      { key: 'today', label: 'Сегодня',    cls: '',     rows: g.today },
      { key: 'soon',  label: 'Ближайшие',  cls: '',     rows: g.soon },
    ].filter(function (gr) { return gr.rows.length; });

    var body;
    if (!g.total) {
      body = '<div class="tasks-empty"><span class="te-ic">' + ic('check', 16) + '</span>' +
        '<span>Открытых задач со сроком нет. Поставить задачу можно в карточке клиента.</span></div>';
    } else {
      body = groups.map(function (gr) {
        var rows = gr.rows.slice(0, 6).map(function (it) {
          var over = gr.key === 'over';
          return '<div class="tk-row' + (over ? ' over' : '') + '" data-id="' + it.lead.id + '">' +
            '<div class="tk-main"><div class="tk-txt">' + esc(it.task.text) + '</div>' +
            '<div class="tk-who">' + esc(leadName(it.lead)) + '</div></div>' +
            '<div class="tk-due ' + (over ? 'over' : gr.key === 'soon' ? 'soon' : '') + ' num">' + esc(fmtDue(it.task.due)) + '</div>' +
            '<div class="tk-go">' + ic('go', 13) + '</div></div>';
        }).join('');
        var more = gr.rows.length > 6 ? '<div class="tk-row" style="cursor:default;color:var(--ink-3)"><div class="tk-main tk-txt" style="font-weight:500;color:var(--ink-3)">+ ещё ' + (gr.rows.length - 6) + '</div></div>' : '';
        return '<div class="tk-group"><div class="tk-glabel ' + gr.cls + '">' + gr.label +
          '<span class="gn num">' + gr.rows.length + '</span></div>' + rows + more + '</div>';
      }).join('');
    }
    return '<div class="card tasks-card" style="overflow:hidden">' +
      '<div class="sec-head" style="padding:20px 24px 8px">' +
        '<span class="ic">' + ic('task', 14) + '</span>' +
        '<div><div class="t">Задачи</div><div class="s">что запланировано по клиентам — со сроками</div></div>' +
        (g.total ? '<span class="cnt num">' + g.total + '</span>' : '') + '</div>' +
      '<div' + (g.total ? ' style="border-top:1px solid var(--line);margin-top:6px"' : '') + '>' + body + '</div></div>';
  }
```

### 3.6 ЗАМЕНИТЬ `renderDash` (app.js ~строки 910–1064)
Ключевые изменения: использует `dashCounts(state.dashPeriod)`; «Сегодня — к действию» больше НЕ
включает задачи (они в `tasksCard`); добавлена `tasksCard()` в обе ветки; всё обёрнуто в `.dash`
(вместо инлайн `margin-top`); добавлен обработчик клика `.tk-row[data-id]`; KPI-подписи отражают период.
```js
  function renderDash(view) {
    var P = state.dashPeriod;
    var c = dashCounts(P);
    var cAll = counts(); // для блоков «состояние сейчас» (задачи/риски/воронка — без периода)
    var risks = allRisks();
    var convA = c.anketa ? Math.round(c.booked / c.anketa * 100) : 0;
    var convClient = c.booked ? Math.round(c.clients / c.booked * 100) : 0;
    var perSuf = P ? ' · ' + DPERIOD_LABEL[P] : '';

    /* «Сегодня — к действию» — горячие заявки + риски статусов (задачи теперь в своей карточке) */
    var acts = [];
    state.leads.forEach(function (l) {
      if (l.booking && l.crm.status === 'new') {
        acts.push({ sev: 3, cls: 'r-crit', pill: '<span class="sev s-hot"><span class="d"></span>горячий</span>',
          lead: l, text: esc(leadName(l)), sub: 'заявка ждет связи' + ((l.booking || {}).slot ? ' · разбор: ' + esc(l.booking.slot) : ''),
          when: ago(l.booking.at || l.created_at) });
      }
    });
    risks.forEach(function (r) {
      if (r.label.indexOf('задача') !== -1 || (r.lead.booking && r.lead.crm.status === 'new')) return;
      acts.push({ sev: r.sev, cls: r.sev >= 2 ? 'r-crit' : 'r-mid',
        pill: '<span class="sev ' + (r.sev >= 2 ? 's-hot' : 's-contacted') + '"><span class="d"></span>риск</span>',
        lead: r.lead, text: esc(leadName(r.lead)), sub: esc(r.label), when: '' });
    });
    acts.sort(function (a, b) { return b.sev - a.sev; });
    var actRows = acts.length ? acts.slice(0, 8).map(function (a) {
      return '<div class="trow ar-grid ' + a.cls + '" data-id="' + a.lead.id + '">' + a.pill +
        '<div class="t-cell"><div class="t-ttl">' + a.text + '</div><div class="t-sub">' + a.sub + '</div></div>' +
        '<div class="t-when num">' + esc(a.when) + '</div><div class="t-go">' + ic('go', 13) + '</div></div>';
    }).join('') : '<div class="empty">Горячих заявок и рисков нет. Спокойно.</div>';
    var actCard = '<div class="card" style="overflow:hidden">' +
      '<div class="sec-head" style="padding:20px 24px 14px">' +
        '<span class="ic">' + ic('flame', 14) + '</span><div><div class="t">Сегодня — к действию</div>' +
        '<div class="s">с чего начать: горячие заявки и риски по лидам в работе</div></div>' +
        '<span class="cnt num">' + acts.length + '</span></div>' +
      '<div style="border-top:1px solid var(--line)">' + actRows + '</div></div>';

    /* воронка продаж — состояние всех заявок (без периода) */
    var booked = state.leads.filter(function (l) { return l.booking; });
    var saleSteps = ['new', 'contacted', 'call_scheduled', 'call_done', 'offer_sent', 'client'];
    var saleCounts = saleSteps.map(function (s, i) {
      return booked.filter(function (l) { return l.crm.status !== 'rejected' && CRM[l.crm.status].order >= i; }).length;
    });
    var weakest = -1, weakRatio = 1;
    for (var j = 1; j < saleCounts.length; j++) {
      if (!saleCounts[j - 1]) continue;
      var ratio = saleCounts[j] / saleCounts[j - 1];
      if (ratio < weakRatio && saleCounts[j - 1] >= 2) { weakRatio = ratio; weakest = j; }
    }
    var convSale = saleCounts[0] ? Math.round(saleCounts[saleCounts.length - 1] / saleCounts[0] * 100) : 0;
    var saleRows = saleSteps.map(function (s, i) {
      var n = saleCounts[i];
      var w = saleCounts[0] ? Math.round(n / saleCounts[0] * 100) : 0;
      var conv = i && saleCounts[i - 1] ? Math.round(n / saleCounts[i - 1] * 100) + '%' : '';
      return '<div class="cvc-row' + (i === weakest ? ' weak' : '') + '">' +
        '<div class="cvc-nm">' + (i === 0 ? 'Заявки' : CRM[s].label) + '</div>' +
        '<div class="cvc-track"><div class="cvc-fill" style="width:' + Math.max(w, n ? 5 : 0) + '%"></div></div>' +
        '<div class="cvc-c num">' + n + '</div><div class="cvc-p num">' + conv + '</div></div>';
    }).join('');
    var funnelCard = '<div class="card" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('target', 14) + '</span><div class="t">Воронка продаж</div>' +
      '<span class="cnt num">' + convSale + '% в клиента</span></div>' +
      '<div class="cvc-rows" style="margin-top:12px">' + saleRows + '</div></div>';

    if (state.role !== 'owner') {
      /* ── МЕНЕДЖЕР ── */
      view.innerHTML = '<div class="dash">' +
        statBar([
          { tint: c.hot ? 'red' : '', label: 'Ждут связи', value: c.hot, go: 'queue', delta: c.hot ? 'написать сегодня' : '', deltaCls: 'bad', sub: c.hot ? '' : 'всё разобрано' },
          { tint: 'blue', label: 'Сессии' + (P ? '' : ' сегодня'), value: P ? c.all : c.today, sub: P ? DPERIOD_LABEL[P] : c.week + ' за неделю' },
          { tint: 'navy', label: 'В работе', value: c.queue, go: 'queue', sub: 'заявок веду' },
          { tint: 'green', label: 'Клиенты', value: c.clients, go: 'clients', sub: convClient ? convClient + '% из заявок' : '' },
        ]) +
        '<div class="grid">' +
          '<div class="sp7 vstack">' + actCard + tasksCard() + '</div>' +
          '<div class="sp5 vstack">' + funnelCard + '</div>' +
        '</div>' +
      '</div>';
    } else {
      /* ── ВЛАДЕЛЕЦ ── */
      var days = [];
      for (var i = 13; i >= 0; i--) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i); days.push({ d: d, sessions: 0, booked: 0 }); }
      var total14 = 0;
      state.leads.forEach(function (l) {
        if (!l.created_at) return;
        var t = new Date(l.created_at); t.setHours(0, 0, 0, 0);
        days.forEach(function (day) { if (day.d.getTime() === t.getTime()) { day.sessions++; total14++; if (l.booking) day.booked++; } });
      });
      var maxS = Math.max(1, Math.max.apply(null, days.map(function (x) { return x.sessions; })));
      var chart = '<div class="chart">' + days.map(function (day) {
        var h1 = Math.round(day.sessions / maxS * 100), h2 = Math.round(day.booked / maxS * 100);
        return '<div class="ch-day" title="' + pad(day.d.getDate()) + '.' + pad(day.d.getMonth() + 1) + ': сессий ' + day.sessions + ', заявок ' + day.booked + '">' +
          (h2 ? '<div class="b2" style="height:' + h2 + '%"></div>' : '') +
          '<div class="b1" style="height:' + Math.max(3, h1 - h2) + '%"></div></div>';
      }).join('') + '</div>' +
      '<div class="ch-labels">' + days.map(function (day, idx) { return '<span class="num">' + (idx % 2 === 1 ? pad(day.d.getDate()) : '') + '</span>'; }).join('') + '</div>' +
      '<div class="ch-legend"><span><i style="background:#1C2B4A"></i>сессии</span><span><i style="background:#2F6BFF"></i>заявки</span></div>';
      var chartCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span><div><div class="t">Динамика 14 дней</div>' +
        '<div class="s">' + total14 + ' сессий · сколько дошло до заявки</div></div></div>' + chart + '</div>';

      var steps = funnelData('');
      var worst = worstStep(steps);
      var loseCard;
      if (worst) {
        var dropped = worst.step.dropped;
        var withC = dropped.filter(function (l) { return (l.booking || {}).contact || l.email; }).length;
        loseCard = '<div class="card sp5 clickcard" id="go-path" style="padding:22px 26px">' +
          '<div class="sec-head"><span class="ic warn">' + ic('path', 14) + '</span><div class="t">Где теряем людей</div>' +
          '<span class="lnk">Путь ' + ic('go', 13) + '</span></div>' +
          '<div class="lose-body">' +
            '<div class="lose-big"><b class="num">−' + Math.round(worst.pct * 100) + '%</b><span>на шаге «' + esc(worst.step.label) + '»</span></div>' +
            '<div class="lose-sub">' + dropped.length + ' ' + plural(dropped.length, 'человек', 'человека', 'человек') + ' ушли здесь' +
            (withC ? ' · у ' + withC + ' есть контакт — можно догнать' : '') + '</div></div></div>';
      } else {
        loseCard = '<div class="card sp5 clickcard" id="go-path" style="padding:22px 26px">' +
          '<div class="sec-head"><span class="ic">' + ic('path', 14) + '</span><div class="t">Путь по платформе</div>' +
          '<span class="lnk">Открыть ' + ic('go', 13) + '</span></div>' +
          '<div class="lose-body"><div class="lose-sub">Заметных дыр в воронке нет. В разделе «Путь» — путь людей по шагам платформы.</div></div></div>';
      }

      var geoHasData = state.leads.some(function (l) { return (l.geo || {}).city; });
      var dirs = dirsCard(geoHasData ? 7 : 12);
      var bottomRow = dirs + (geoHasData ? geoCard() : '');

      view.innerHTML = '<div class="dash">' +
        statBar([
          { tint: 'blue', label: 'Сессии' + (P ? '' : ' сегодня'), value: P ? c.all : c.today, sub: P ? DPERIOD_LABEL[P] : c.week + ' за 7 дней' },
          { tint: 'navy', label: 'Заявки на разбор', value: c.booked, delta: convA + '% из анкеты', deltaCls: convA >= 10 ? 'good' : 'mid' },
          { tint: 'green', label: 'Клиенты', value: c.clients, delta: convClient + '% из заявок', deltaCls: convClient > 0 ? 'good' : 'mid' },
          { tint: (cAll.hot + risks.length) ? 'red' : '', label: 'Требуют внимания', value: cAll.hot + risks.length, go: 'queue', sub: (cAll.hot + risks.length) ? 'разобрать' : 'чисто' },
        ]) +
        '<div class="grid">' +
          '<div class="sp7 vstack">' + actCard + '</div>' +
          '<div class="sp5 vstack">' + tasksCard() + '</div>' +
          '<div class="sp7 vstack">' + chartCard + '</div>' +
          '<div class="sp5 vstack">' + funnelCard + '</div>' +
          loseCard + bottomRow +
        '</div>' +
      '</div>';
    }

    Array.prototype.forEach.call(view.querySelectorAll('.trow[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id'), acts.map(function (a) { return a.lead.id; })); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.tk-row[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id')); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    Array.prototype.forEach.call(view.querySelectorAll('.stat[data-go]'), function (b) {
      b.addEventListener('click', function () { var g = b.getAttribute('data-go'); if (g === 'clients') { state.seg = 'clients'; saveUi(); } setPage(g === 'clients' ? 'leads' : g); });
    });
    var gp = el('go-path');
    if (gp) gp.addEventListener('click', function () { setPage('path'); });
    animBars(view);
  }
```
> Примечание про сетку владельца: `chartCard`/`loseCard`/`dirs`/`geoCard` уже несут свои `sp*`-классы.
> Я обернул `chartCard` в `.sp7 .vstack` и `funnelCard` в `.sp5 .vstack` — поэтому из строк
> определения `chartCard` (`...card sp7...`) и `funnelCard` остаются как есть (внутренняя карточка
> внутри vstack тянется по высоте — поведение `.grid > .vstack > .card { flex:1 }` уже в CSS).
> `loseCard`(sp5), `dirs`(sp7/sp12), `geoCard`(sp5) идут прямыми грид-чайлдами как раньше.

### 3.7 ЗАМЕНИТЬ блок загрузки в `renderView` (app.js ~строки 886–889)
```js
    if (!state.loaded) {
      if (state.page === 'dash') view.innerHTML = dashSkeleton();
      else view.innerHTML = listSkeleton();
      return;
    }
```

### 3.8 НОВЫЕ `dashSkeleton()` / `listSkeleton()`
Вставить перед `renderDash` (app.js ~перед строкой 910). `dashSkeleton` повторяет layout дашборда
(полоса KPI + крупные карточки), `listSkeleton` — каркас списка строк (для страниц leads/path).
```js
  /* ── премиум-скелетоны (шиммер) ── */
  function shimStat() {
    return '<div class="sk-stat"><div class="shim l"></div><div class="shim b"></div><div class="shim s"></div></div>';
  }
  function shimCard(lines) {
    var rows = '';
    for (var i = 0; i < (lines || 5); i++) rows += '<div class="sk-line"><div class="shim a"></div><div class="shim c"></div></div>';
    return '<div class="sk-card"><div class="sk-h"><div class="shim ic"></div><div class="shim tt"></div></div>' + rows + '</div>';
  }
  function dashSkeleton() {
    return '<div class="dash">' +
      '<div class="sk-statbar">' + shimStat() + shimStat() + shimStat() + shimStat() + '</div>' +
      '<div class="grid">' +
        '<div class="sp7">' + shimCard(6) + '</div>' +
        '<div class="sp5">' + shimCard(6) + '</div>' +
      '</div></div>';
  }
  function listSkeleton() {
    return '<div class="card" style="overflow:hidden;padding:8px 0">' +
      shimCard(8).replace('sk-card', 'sk-card" style="border:0;border-radius:0') + '</div>';
  }
```
> `listSkeleton` — лёгкий generic для leads/path; агент LIST может позже заменить на свой каркас строк,
> класс `.shim` общий.

---

### 3.9 ЗАМЕНИТЬ dash-ветку `renderTopbar` (app.js ~строки 795–799)
Сейчас в dash-ветке только `freshchip`. Добавляю слева период-сегмент, справа — компактный freshchip.
```js
    } else {
      var risks = allRisks();
      var pers = [['', 'Всё время'], ['today', 'Сегодня'], ['week', '7 дней'], ['month', '30 дней']];
      tb.innerHTML = '<div class="dperiod" id="d-period">' + pers.map(function (o) {
        return '<button data-per="' + o[0] + '" class="' + (state.dashPeriod === o[0] ? 'on' : '') + '">' + o[1] + '</button>';
      }).join('') + '</div>';
      Array.prototype.forEach.call(tb.querySelectorAll('#d-period button'), function (b) {
        b.addEventListener('click', function () {
          state.dashPeriod = b.getAttribute('data-per');
          saveUi(); renderTopbar(); renderView();
        });
      });
    }
```
> `freshchip` («данные живые») переезжает: можно либо убрать (период-сегмент важнее в топбаре),
> либо оставить в `renderHead` dash-ветке как мелкую подпись. РЕШЕНИЕ: убираю freshchip из топбара
> (период информативнее). Строку про «рисков: N» уже несут KPI «Требуют внимания» и verdict в chead —
> дублей нет.

---

## 4. BACKEND
Бэкенд не требуется. Всё считается на клиенте из уже загруженных `state.leads` (поля `crm.tasks`
[{text, due, done}], `booking`, `created_at`, `status`, `geo.city`, `directions`). Период — чистый
клиентский фильтр по `created_at` (helper `inPeriod` уже есть). Никаких новых эндпоинтов/полей.

---

## Сжатый итог
- Спроектировал: глобальный ритм (`.content` 34px, `.chead` 26px-низ, `.grid`/`.dash` gap 20px,
  убрал инлайн margin-top в дашборде); период-сегмент метрик (today/7/30/всё) в топбаре Обзора с
  сохранением в `saveUi` и period-aware `dashCounts`; отдельную карточку **Задачи** (просрочено/сегодня/
  ближайшие, клик в карточку), а из «Сегодня — к действию» задачи убрал, чтобы не дублировать;
  единый шиммер `.shim` + `dashSkeleton()`/`listSkeleton()` вместо точек-лоадера.
- Ключевые решения: период влияет только на входящий поток (KPI/конверсии), а не на задачи/воронку
  (это «состояние сейчас»); красный — дозированно (3px бар + soft-плашка счётчика, без кричащих блоков);
  иконки только через `ic()`; статус-пилюли остаются от агента LIST (`.sev.s-*`).
- Зависимости от бэкенда: нет (всё на клиенте).
- Пересечения с чужими участками: `.content`/`.chead`/`.grid` — глобальные (заденут страницы LIST/Путь,
  но только увеличивают воздух, layout не ломают); класс `.shim` — общий, заложен под списки/модалку
  (агент LIST/модалки может ссылаться); `listSkeleton()` — временный generic, агент LIST вправе заменить.
  `counts()` не трогал (его зовут сайдбар/топбар) — добавил отдельную `dashCounts()`.
```
