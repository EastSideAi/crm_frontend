# Финансы (owner) + переработка раздела «Оплаты» в карточке клиента

Спека для CRM (`crm/app.js` + `crm/style.css`). No-build vanilla JS, светлая Botamin-админка,
Manrope, токены из `:root`. Иконки только через `ic()`, без эмодзи, без точек-индикаторов в статусах,
красный дозированно. Голос на «ты», без «ё».

---

## 1. Решения и логика

### 1.1 Новая страница «Финансы» (только owner)
- Новый пункт навигации `finance` в `NAV_ALL` с ролью `['owner']` (рядом с «Путь»). Иконка `coins`.
- `renderFinance(view)` рисует финансовый дашборд в стиле страницы «Обзор»: `statBar` сверху +
  карточки в `.grid` (12 колонок). Состав:
  1. **statBar** (4 метрики): Выручка (оплачено) · Ожидается · Возвраты · Средний чек.
  2. **Деньги по статусам** — горизонтальный stacked-бар «оплачено vs ожидается vs возвраты»
     (sp5) + краткий легенд-список с суммами.
  3. **Динамика по месяцам** (sp7) — бары выручки по месяцам (как `chart` 14 дней, но по месяцам,
     только оплаченное), подпись «всего за период».
  4. **Выручка по продуктам/услугам** (sp7) — донат (как `dirsCard`) по `title` платежа: сумма и доля.
  5. **Топ-клиенты по сумме** (sp5) — список с прогресс-баром (как `cvc-rows`), сумма + кол-во платежей,
     клик открывает карточку клиента (`openDrawer`).
  6. **Конверсия в оплату** — встроена в statBar/верхний вердикт (доля заявок/клиентов, дошедших
     до оплаты). Считается из `state.leads` (booked → есть оплата).

- **Период**: переиспользуем механику топбара как у «Путь». В `renderTopbar` для `state.page==='finance'`
  рисуем те же табы периодов, пишем в `state.finPeriod` (новое поле). По смене периода — пере-агрегация.

### 1.2 Источник данных — РЕШЕНИЕ: агрегирующий бэкенд-эндпоинт `GET /admin/api/finance` (primary) + клиентский fallback
Платежи лежат только в детали лида (`d.payments` после `fetchDetail`). Тянуть детали по ВСЕМ лидам —
это N запросов на каждое открытие страницы (у «Обзор»/«Путь» данные уже в `/admin/api/leads`, а тут нет).
Это медленно и хрупко. Поэтому **основной путь — отдельный агрегирующий эндпоинт** (см. секцию BACKEND):
один запрос, сервер сам джойнит платежи с лидами и считает суммы/группировки. Аналитика финансов —
это именно агрегаты, считать их на сервере дешевле и точнее (исключаем удалённых, считаем по всем,
а не по подгруженным).

**Fallback (пока эндпоинта нет / 404 / сеть):** ленивая клиентская агрегация — подтягиваем `fetchDetail`
ТОЛЬКО для лидов, у кого статус `client` ИЛИ есть признак оплаты. Поскольку у `/admin/api/leads` нет
поля «есть платёж», в fallback берём кандидатов = `crm.status==='client'` (это и есть «кто дошёл до
оплаты» по словарю SEGS). Их обычно единицы-десятки — N запросов допустимо как запасной режим.
Собранные `d.payments` кэшируются (`state.details`), повторных запросов нет.页面 показывает баннер
«оценка по клиентам — точные цифры появятся с обновлением бэка», чтобы не выдавать fallback за правду.

`fetchFinance(force, cb)` сначала пробует эндпоинт; при ошибке — собирает fallback из деталей.
Нормализованная форма (одна и та же для обоих путей) кладётся в `state.finance`:

```
state.finance = {
  source: 'api' | 'local',        // для баннера
  period: '' | 'month' | 'year',  // под какой период собрано
  paid_total, pending_total, refunded_total, // целые ₽
  avg_check,                       // целое ₽ (paid_total / число оплаченных платежей)
  paid_count,                     // число оплаченных платежей
  by_status: [{key,label,amount}],
  by_month: [{ym:'2026-05', label:'май', amount}],   // только оплаченное, по возрастанию
  by_product: [{title, amount, count}],              // оплаченное, desc по amount
  top_clients: [{lead_id, name, amount, count}],     // оплаченное, desc, top 8
  pay_conv: { booked, paying, pct }  // конверсия заявка→оплата (из state.leads, локально всегда)
}
```

> `pay_conv` всегда считается локально из `state.leads` (booked = `l.booking`; paying — если эндпоинт
> вернул `paying_lead_ids`, иначе по `crm.status==='client'`). Это дешёвая клиентская метрика, не требует
> агрегата.

### 1.3 Раздел «Оплаты» в карточке клиента — переработка `buildPaySection`
Претензия «разбор оплат хуевый». Делаем премиально и в финансовом языке:
- **Итог-плашка сверху** не одной цифрой, а 3 цифрами в ряд (оплачено / ожидается / возвраты),
  главная — оплачено. Если есть ожидаемое — подсветка.
- **Список платежей**: статус — благородным `sev`-чипом (без точки-кружка убирать нельзя — это общий
  компонент `.sev .d`; оставляем как в проекте, это не «индикатор статуса в духе цветных точек», а
  принятый паттерн CRM). Сумма крупно справа, дата/заметка снизу, кнопка удаления. Возврат — зачёркнут.
- **Добавление платежа**: компактная форма с выбором статуса (оплачен / ожидается / возврат) через
  сегмент-переключатель (как `due-seg`), полем «за что», суммой и датой (по умолчанию сегодня).
  Кнопка «Добавить». Поведение POST/refresh — как было.
- Бэкенд для оплат уже есть (POST/DELETE), новых эндпоинтов раздел не требует. Используем существующие
  поля payment: `title, amount_rub, status('paid'|'pending'|'refunded'), paid_at, note`.

### 1.4 Что НЕ трогаем
Дашборд-метрики/списки/воронка/«Путь»/таблица/канбан/остальные разделы модалки (now/path/notes/docs/ai),
бэкенд кодом. Раздел «Документы» — зона агента MODAL, не трогаем.

---

## 2. CSS — добавить / заменить

### 2.1 ЗАМЕНИТЬ блок `/* оплаты */` (строки ~601–611 в style.css) на:

```css
/* ════ оплаты (карточка клиента) ════ */
.pay-board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 18px; }
.pay-cell { background: var(--fill); border-radius: 14px; padding: 14px 16px; }
.pay-cell.lead { background: var(--blue-tint); }
.pay-cell .pc-l { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--ink-3); }
.pay-cell.lead .pc-l { color: var(--blue); }
.pay-cell .pc-v { font-size: 23px; font-weight: 700; letter-spacing: -.03em; color: var(--ink); margin-top: 9px; line-height: 1; }
.pay-cell.lead .pc-v { color: var(--blue-d); }
.pay-cell.muted .pc-v { color: var(--ink-3); }

.pay-amt { font-size: 15px; font-weight: 700; flex: none; }
.pay-amt.refunded { color: var(--ink-3); text-decoration: line-through; }
.pay-amt.pending { color: var(--amber-ink); }

/* форма добавления платежа */
.pay-form { display: flex; flex-direction: column; gap: 10px; }
.pay-seg { display: inline-flex; gap: 3px; padding: 4px; border-radius: 11px; background: var(--fill); align-self: flex-start; }
.pay-seg button { color: var(--ink-2); font: 600 12px 'Manrope', sans-serif; padding: 7px 13px; border-radius: 8px; transition: .15s; }
.pay-seg button.on { background: #fff; color: var(--blue); box-shadow: 0 1px 2px rgba(15,19,32,.1); }
.pay-seg button[data-v="paid"].on { color: var(--green-ink); }
.pay-seg button[data-v="refunded"].on { color: var(--red-ink); }
.pay-grid { display: grid; grid-template-columns: 1fr 150px 150px; gap: 8px; }
.pay-grid input { outline: none; font: 500 13px 'Manrope', sans-serif; color: var(--ink);
  background: var(--fill); border: 1px solid transparent; border-radius: 10px; padding: 11px 13px; min-width: 0; }
.pay-grid input:focus { background: #fff; border-color: #DCE7FF; }
.pay-form .bp { align-self: flex-start; }

.field-empty { text-align: center; color: var(--ink-3); font-size: 13px; padding: 26px 10px; }
```

> Удаляются старые `.pay-sum`, `.pay-add` (заменены `.pay-board` / `.pay-form` + `.pay-grid`).
> Старое мобильное правило `.pay-add { grid-template-columns: 1fr; }` (строка ~833) — ЗАМЕНИТЬ
> на `.pay-grid { grid-template-columns: 1fr; }` (см. 2.3).

### 2.2 ДОБАВИТЬ в конец style.css (перед блоком `/* ════ МОБИЛА ════ */`), новый блок «Финансы»:

```css
/* ════ ФИНАНСЫ ════ */
.fin-money { color: var(--ink-2); font-weight: 500; }
.fin-money b { color: var(--ink); font-weight: 700; }

/* statbar tint для денег */
.stat .sdot.gold { background: var(--amber); }

/* верхняя плашка-вердикт финансов (источник/конверсия) */
.fin-banner { display: flex; align-items: center; gap: 10px; font-size: 12.5px; font-weight: 500;
  color: var(--ink-2); background: var(--amber-soft); border-radius: var(--r-pill);
  padding: 9px 14px; margin-bottom: 18px; }
.fin-banner svg { color: var(--amber-ink); flex: none; }
.fin-banner b { color: var(--amber-ink); font-weight: 700; }

/* stacked-бар по статусам денег */
.fin-stack { height: 16px; border-radius: 8px; background: var(--fill); overflow: hidden;
  display: flex; margin-top: 18px; }
.fin-stack i { display: block; height: 100%; min-width: 0; transition: width .9s var(--ease); }
.fin-stack i.paid { background: var(--green); }
.fin-stack i.pending { background: var(--amber); }
.fin-stack i.refunded { background: var(--red); }
.fin-leg { display: flex; flex-direction: column; margin-top: 16px; }
.fin-leg .r { display: flex; align-items: center; gap: 11px; padding: 12px 0; border-top: 1px solid var(--line); }
.fin-leg .r:first-child { border-top: none; padding-top: 4px; }
.fin-leg .r:last-child { padding-bottom: 0; }
.fin-leg .dd2 { width: 10px; height: 10px; border-radius: 3px; flex: none; }
.fin-leg .nm { flex: 1; font-size: 13.5px; color: var(--ink); font-weight: 500; }
.fin-leg .am { font-size: 14.5px; font-weight: 700; white-space: nowrap; }
.fin-leg .am.muted { color: var(--ink-3); }

/* динамика по месяцам (бары) */
.fin-months { display: flex; align-items: flex-end; gap: 10px; height: 150px; padding-top: 14px; }
.fin-mcol { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; gap: 8px; height: 100%; }
.fin-mcol .bar { background: var(--blue); border-radius: 7px; min-height: 3px; transition: height .2s; }
.fin-mcol .bar.peak { background: var(--navy); }
.fin-mlabels { display: flex; gap: 10px; margin-top: 10px; }
.fin-mlabels span { flex: 1; text-align: center; font-size: 11px; font-weight: 500; color: var(--ink-3); }

/* топ-клиенты — строки с баром (свой data-id для клика) */
.fin-client { display: grid; grid-template-columns: 1fr 90px; gap: 14px; align-items: center;
  padding: 12px 0; border-bottom: 1px solid var(--line); cursor: pointer; transition: .14s; }
.fin-client:last-child { border-bottom: none; }
.fin-client:hover { background: #FBFBFC; }
.fin-client .fc-l { min-width: 0; }
.fin-client .fc-nm { font-size: 13.5px; font-weight: 600; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.fin-client .fc-track { height: 7px; border-radius: 5px; background: var(--fill); overflow: hidden; margin-top: 7px; }
.fin-client .fc-track i { display: block; height: 100%; border-radius: 5px; background: var(--blue);
  min-width: 5px; transition: width .9s var(--ease); }
.fin-client .fc-am { text-align: right; }
.fin-client .fc-sum { font-size: 14.5px; font-weight: 700; }
.fin-client .fc-cnt { font-size: 11.5px; color: var(--ink-3); margin-top: 2px; }
```

### 2.3 МОБИЛА — внутри `@media (max-width: 960px)` ЗАМЕНИТЬ строку
`.pay-add { grid-template-columns: 1fr; }` на:

```css
  .pay-grid { grid-template-columns: 1fr; }
  .pay-board { grid-template-columns: 1fr; }
  .fin-months { gap: 5px; }
```

---

## 3. JS — полные функции

### 3.1 Иконка `coins` — ДОБАВИТЬ в объект `P` внутри `ic()` (рядом с `card`/`chart`)
```js
      coins: '<circle cx="7" cy="7" r="4"/><path d="M11 4.3a4 4 0 1 1 0 7.4"/><path d="M5.5 7h3M7 5.5v3"/>',
      wallet: '<rect x="3" y="5" width="14" height="11" rx="2.5"/><path d="M3 8.5h14"/><circle cx="13.5" cy="11.5" r="1.1" fill="currentColor" stroke="none"/>',
```
(нужна `coins` для навигации/заголовков; `wallet` — для карточки «по статусам». Если лень — можно
обойтись `card`, но `coins` чище под «деньги».)

### 3.2 ЗАМЕНИТЬ массив `NAV_ALL` (строки ~701–705)
```js
  var NAV_ALL = [
    { id: 'dash', label: 'Обзор', icon: 'dash', roles: ['owner', 'manager'] },
    { id: 'leads', label: 'Клиенты', icon: 'leads', roles: ['owner', 'manager'] },
    { id: 'path', label: 'Путь', icon: 'path', roles: ['owner'] },
    { id: 'finance', label: 'Финансы', icon: 'coins', roles: ['owner'] },
  ];
```

### 3.3 ЗАМЕНИТЬ `setPage` (строки ~756–764) — догружает финансы при заходе на страницу
```js
  function setPage(p) {
    if (state.page === p) return;
    state.page = p;
    state.sort = null;
    saveUi();
    renderAll();
    if (p === 'finance') fetchFinance(false, function () {
      if (state.page === 'finance') renderView();
    });
    window.scrollTo(0, 0);
    var m = document.querySelector('.main'); if (m) m.scrollTop = 0;
  }
```

### 3.4 ДОБАВИТЬ поля в `state` (объект на строках ~15–22)
Добавить в инициализацию `state`:
```js
    finPeriod: '', finance: null, finLoading: false,
```
(вставить в любую строку объекта `state`, напр. рядом с `pathPeriod`).

### 3.5 ЗАМЕНИТЬ `renderTopbar` (строки ~767–800) — добавлена ветка периодов для finance
```js
  function renderTopbar() {
    var tb = el('tb-left');
    if (!tb) return;
    var c = counts();
    if (state.page === 'leads') {
      tb.innerHTML = '<nav class="tabs">' + Object.keys(SEGS).map(function (s) {
        var n = s === 'queue' ? c.queue : s === 'all' ? c.all : s === 'clients' ? c.clients : c.rejected;
        return '<a class="tab' + (state.seg === s ? ' on' : '') + '" data-seg="' + s + '">' +
          SEGS[s].label + (n ? '<span class="n num">' + n + '</span>' : '') + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.seg = t.getAttribute('data-seg');
          state.sort = null;
          saveUi(); renderTopbar(); renderHead(); renderView();
        });
      });
    } else if (state.page === 'path') {
      var opts = [['', 'За все время'], ['month', '30 дней'], ['week', '7 дней']];
      tb.innerHTML = '<nav class="tabs">' + opts.map(function (o) {
        return '<a class="tab' + (state.pathPeriod === o[0] ? ' on' : '') + '" data-per="' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.pathPeriod = t.getAttribute('data-per');
          renderTopbar(); renderView(); renderSide();
        });
      });
    } else if (state.page === 'finance') {
      var fopts = [['', 'За все время'], ['year', '12 месяцев'], ['month', '30 дней']];
      tb.innerHTML = '<nav class="tabs">' + fopts.map(function (o) {
        return '<a class="tab' + (state.finPeriod === o[0] ? ' on' : '') + '" data-fper="' + o[0] + '">' + o[1] + '</a>';
      }).join('') + '</nav>';
      Array.prototype.forEach.call(tb.querySelectorAll('.tab'), function (t) {
        t.addEventListener('click', function () {
          state.finPeriod = t.getAttribute('data-fper');
          fetchFinance(true, function () { if (state.page === 'finance') renderView(); });
          renderTopbar(); renderHead(); renderView();
        });
      });
    } else {
      var risks = allRisks();
      tb.innerHTML = '<div class="freshchip"><span class="fok">' + ic('check', 11) + '</span>' +
        'данные живые · автообновление раз в минуту' + (risks.length ? ' · рисков: ' + risks.length : '') + '</div>';
    }
  }
```

### 3.6 В `renderHead` — ДОБАВИТЬ ветку для finance (вставить после блока `if (state.page === 'path') {...}` , перед строкой `ch.innerHTML = html;` ~833)
```js
    if (state.page === 'finance') {
      var f = state.finance;
      var phrase;
      if (!f) phrase = 'Считаю деньги…';
      else {
        var conv = f.pay_conv && f.pay_conv.pct;
        phrase = 'Оплачено всего: <b>' + finMoney(f.paid_total) + ' ₽</b>' +
          (f.pending_total ? ' · ждём ещё <b>' + finMoney(f.pending_total) + ' ₽</b>' : '') +
          (f.pay_conv && f.pay_conv.booked ? ' · из заявок в оплату дошло <b>' + conv + '%</b>' : '') + '.';
      }
      html = '<div><h2>Финансы</h2>' +
        '<div class="verdict"><span class="vspark">' + ic('spark', 13) + '</span><span>' + phrase + '</span></div></div>';
    }
```

### 3.7 В `renderView` — ДОБАВИТЬ маршрут (после `if (state.page === 'path') return renderPath(view);` ~891)
```js
    if (state.page === 'finance') return renderFinance(view);
```

### 3.8 НОВАЯ функция `finMoney` — формат денег (рядом с `fmtMoney`, либо переиспользовать `fmtMoney`)
`fmtMoney` уже есть и делает ровно то, что нужно (разрядка пробелами). Используем её под алиасом,
чтобы не плодить: в коде финансов зови `fmtMoney`. Если хочется явности — добавь:
```js
  function finMoney(n) { return fmtMoney(n); }
```

### 3.9 НОВАЯ функция `fetchFinance` — загрузка/агрегация (вставить рядом с `loadLeads`, ~2056)
```js
  /* ── ФИНАНСЫ: загрузка агрегата (эндпоинт) + клиентский fallback ── */
  function payConvLocal(payingIds) {
    var booked = 0, paying = 0;
    state.leads.forEach(function (l) {
      if (l.booking) booked++;
      var pays = payingIds ? payingIds[l.id] : (l.crm.status === 'client');
      if (pays) paying++;
    });
    return { booked: booked, paying: paying, pct: booked ? Math.round(paying / booked * 100) : 0 };
  }
  var MONTHS_RU = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  function ymLabel(ym) { var m = parseInt(ym.slice(5, 7), 10) - 1; return MONTHS_RU[m] || ym; }

  function finPeriodFrom() {
    if (state.finPeriod === 'month') { var d = new Date(); d.setDate(d.getDate() - 29); d.setHours(0,0,0,0); return d; }
    if (state.finPeriod === 'year') { var y = new Date(); y.setMonth(y.getMonth() - 11, 1); y.setHours(0,0,0,0); return y; }
    return null;
  }

  /* нормализация агрегата из деталей (общая для api/local) */
  function aggregatePayments(items) {
    // items: [{lead_id, name, payments:[{amount_rub,status,paid_at,created_at,title}]}]
    var from = finPeriodFrom();
    var paid = 0, pending = 0, refunded = 0, paidCount = 0;
    var byMonth = {}, byProduct = {}, byClient = {};
    items.forEach(function (it) {
      (it.payments || []).forEach(function (p) {
        var when = p.paid_at || p.created_at;
        if (from && when && new Date(when) < from) return;
        var amt = p.amount_rub || 0;
        if (p.status === 'paid') {
          paid += amt; paidCount++;
          var ym = (p.paid_at || p.created_at || '').slice(0, 7);
          if (ym) byMonth[ym] = (byMonth[ym] || 0) + amt;
          var key = (p.title || 'Без названия').trim();
          if (!byProduct[key]) byProduct[key] = { title: key, amount: 0, count: 0 };
          byProduct[key].amount += amt; byProduct[key].count++;
          if (!byClient[it.lead_id]) byClient[it.lead_id] = { lead_id: it.lead_id, name: it.name || 'Без имени', amount: 0, count: 0 };
          byClient[it.lead_id].amount += amt; byClient[it.lead_id].count++;
        } else if (p.status === 'refunded') { refunded += amt; }
        else { pending += amt; }
      });
    });
    var months = Object.keys(byMonth).sort().map(function (ym) { return { ym: ym, label: ymLabel(ym), amount: byMonth[ym] }; });
    var products = Object.keys(byProduct).map(function (k) { return byProduct[k]; }).sort(function (a, b) { return b.amount - a.amount; });
    var clients = Object.keys(byClient).map(function (k) { return byClient[k]; }).sort(function (a, b) { return b.amount - a.amount; }).slice(0, 8);
    return {
      paid_total: paid, pending_total: pending, refunded_total: refunded,
      paid_count: paidCount, avg_check: paidCount ? Math.round(paid / paidCount) : 0,
      by_status: [
        { key: 'paid', label: 'Оплачено', amount: paid },
        { key: 'pending', label: 'Ожидается', amount: pending },
        { key: 'refunded', label: 'Возвраты', amount: refunded },
      ],
      by_month: months, by_product: products, top_clients: clients,
    };
  }

  function fetchFinance(force, cb) {
    if (state.finLoading) { if (cb) cb(); return; }
    if (!force && state.finance && state.finance.period === state.finPeriod) { if (cb) cb(); return; }
    state.finLoading = true;
    var qp = state.finPeriod ? ('?period=' + encodeURIComponent(state.finPeriod)) : '';
    api('/admin/api/finance' + qp).then(function (r) {
      // ожидаем готовый агрегат от бэка (см. секцию BACKEND); нормализуем имена на всякий
      var fin = {
        source: 'api', period: state.finPeriod,
        paid_total: r.paid_total || 0, pending_total: r.pending_total || 0, refunded_total: r.refunded_total || 0,
        paid_count: r.paid_count || 0, avg_check: r.avg_check || (r.paid_count ? Math.round((r.paid_total || 0) / r.paid_count) : 0),
        by_status: r.by_status || [
          { key: 'paid', label: 'Оплачено', amount: r.paid_total || 0 },
          { key: 'pending', label: 'Ожидается', amount: r.pending_total || 0 },
          { key: 'refunded', label: 'Возвраты', amount: r.refunded_total || 0 },
        ],
        by_month: (r.by_month || []).map(function (m) { return { ym: m.ym, label: m.label || ymLabel(m.ym || ''), amount: m.amount || 0 }; }),
        by_product: r.by_product || [],
        top_clients: r.top_clients || [],
        pay_conv: payConvLocal(r.paying_lead_ids ? indexBy(r.paying_lead_ids) : null),
      };
      state.finance = fin; state.finLoading = false;
      if (cb) cb();
    }).catch(function (e) {
      if (e.message === '403') { state.finLoading = false; return; }
      // FALLBACK: собираем из деталей клиентов
      fetchFinanceLocal(function () { state.finLoading = false; if (cb) cb(); });
    });
  }
  function indexBy(ids) { var m = {}; (ids || []).forEach(function (id) { m[id] = true; }); return m; }

  /* fallback: тянем детали лидов-клиентов, агрегируем платежи на клиенте */
  function fetchFinanceLocal(done) {
    var cand = state.leads.filter(function (l) { return l.crm.status === 'client'; });
    var pending = cand.length;
    var items = [];
    function finish() {
      var agg = aggregatePayments(items);
      agg.source = 'local'; agg.period = state.finPeriod;
      agg.pay_conv = payConvLocal(null);
      state.finance = agg;
      if (done) done();
    }
    if (!pending) { finish(); return; }
    cand.forEach(function (l) {
      fetchDetail(l.id, function (d) {
        if (d && d.payments && d.payments.length) {
          items.push({ lead_id: l.id, name: l.name || (d && d.name) || 'Без имени', payments: d.payments });
        }
        if (--pending === 0) finish();
      });
    });
  }
```

### 3.10 НОВАЯ функция `renderFinance` (вставить после `renderPath`, ~1379)
```js
  /* ── ФИНАНСЫ ────────────────────────────────────────────── */
  function renderFinance(view) {
    var f = state.finance;
    if (!f) {
      view.innerHTML = '<div class="loadwrap"><div class="loaddot"></div><div class="loaddot"></div><div class="loaddot"></div></div>';
      fetchFinance(false, function () { if (state.page === 'finance') renderView(); });
      return;
    }

    var banner = f.source === 'local'
      ? '<div class="fin-banner">' + ic('spark', 14) + '<span>Оценка по клиентам — точные цифры по всем платежам появятся с обновлением бэка.</span></div>'
      : '';

    /* 1. statBar */
    var bar = statBar([
      { tint: 'green', label: 'Выручка (оплачено)', value: fmtMoney(f.paid_total) + ' ₽',
        sub: f.paid_count + ' ' + plural(f.paid_count, 'платёж', 'платежа', 'платежей') },
      { tint: 'amber', label: 'Ожидается', value: fmtMoney(f.pending_total) + ' ₽',
        sub: f.pending_total ? 'выставлено, не оплачено' : 'всё оплачено' },
      { tint: (f.refunded_total ? 'red' : ''), label: 'Возвраты', value: fmtMoney(f.refunded_total) + ' ₽',
        sub: f.refunded_total ? 'вернули клиентам' : 'возвратов нет' },
      { tint: 'blue', label: 'Средний чек', value: fmtMoney(f.avg_check) + ' ₽',
        sub: f.pay_conv && f.pay_conv.booked ? f.pay_conv.pct + '% заявок платят' : '' },
    ]);

    /* 2. деньги по статусам (stacked) */
    var totalAll = Math.max(1, f.paid_total + f.pending_total + f.refunded_total);
    var stColor = { paid: '#18A957', pending: '#E0922F', refunded: '#E5484D' };
    var stack = '<div class="fin-stack">' + f.by_status.map(function (s) {
      var w = Math.round(s.amount / totalAll * 100);
      return s.amount ? '<i class="' + s.key + '" data-aw="' + w + '%" style="width:0"></i>' : '';
    }).join('') + '</div>';
    var leg = '<div class="fin-leg">' + f.by_status.map(function (s) {
      return '<div class="r"><span class="dd2" style="background:' + stColor[s.key] + '"></span>' +
        '<span class="nm">' + esc(s.label) + '</span>' +
        '<span class="am' + (s.amount ? '' : ' muted') + '">' + fmtMoney(s.amount) + ' ₽</span></div>';
    }).join('') + '</div>';
    var statusCard = '<div class="card sp5" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('wallet', 14) + '</span>' +
      '<div><div class="t">Деньги по статусам</div><div class="s">сколько получено, ждём и вернули</div></div></div>' +
      stack + leg + '</div>';

    /* 3. динамика по месяцам */
    var monthsCard;
    if (f.by_month.length) {
      var maxM = Math.max.apply(null, f.by_month.map(function (m) { return m.amount; })) || 1;
      var peakI = 0; f.by_month.forEach(function (m, i) { if (m.amount > f.by_month[peakI].amount) peakI = i; });
      var bars = '<div class="fin-months">' + f.by_month.map(function (m, i) {
        var h = Math.max(3, Math.round(m.amount / maxM * 100));
        return '<div class="fin-mcol" title="' + esc(m.label) + ': ' + fmtMoney(m.amount) + ' ₽">' +
          '<div class="bar' + (i === peakI ? ' peak' : '') + '" data-ah="' + h + '%" style="height:3px"></div></div>';
      }).join('') + '</div>' +
      '<div class="fin-mlabels">' + f.by_month.map(function (m) { return '<span>' + esc(m.label) + '</span>'; }).join('') + '</div>';
      monthsCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span>' +
        '<div><div class="t">Динамика выручки</div><div class="s">оплаченное по месяцам</div></div>' +
        '<span class="cnt num">' + fmtMoney(f.paid_total) + ' ₽</span></div>' + bars + '</div>';
    } else {
      monthsCard = '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('chart', 14) + '</span>' +
        '<div><div class="t">Динамика выручки</div><div class="s">оплаченное по месяцам</div></div></div>' +
        '<div class="empty">Оплат за период пока нет — график наполнится с первыми платежами.</div></div>';
    }

    /* 4. выручка по продуктам (донат) */
    var prodCard = finDonut(f.by_product);

    /* 5. топ-клиенты */
    var clientsCard;
    if (f.top_clients.length) {
      var maxC = f.top_clients[0].amount || 1;
      var rows = f.top_clients.map(function (cl) {
        var w = Math.max(5, Math.round(cl.amount / maxC * 100));
        return '<div class="fin-client" data-id="' + esc(cl.lead_id) + '">' +
          '<div class="fc-l"><div class="fc-nm">' + esc(cl.name) + '</div>' +
            '<div class="fc-track"><i data-aw="' + w + '%" style="width:0"></i></div></div>' +
          '<div class="fc-am"><div class="fc-sum num">' + fmtMoney(cl.amount) + ' ₽</div>' +
            '<div class="fc-cnt num">' + cl.count + ' ' + plural(cl.count, 'платёж', 'платежа', 'платежей') + '</div></div>' +
          '</div>';
      }).join('');
      clientsCard = '<div class="card sp5" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('leads', 14) + '</span>' +
        '<div><div class="t">Топ-клиенты</div><div class="s">кто принёс больше всего</div></div></div>' +
        '<div style="margin-top:6px">' + rows + '</div></div>';
    } else {
      clientsCard = '<div class="card sp5" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('leads', 14) + '</span>' +
        '<div><div class="t">Топ-клиенты</div><div class="s">кто принёс больше всего</div></div></div>' +
        '<div class="empty">Платящих клиентов пока нет.</div></div>';
    }

    view.innerHTML = banner + bar +
      '<div class="grid" style="margin-top:18px">' +
        statusCard + monthsCard + prodCard + clientsCard +
      '</div>';

    Array.prototype.forEach.call(view.querySelectorAll('.fin-client[data-id]'), function (n) {
      n.addEventListener('click', function () { openDrawer(n.getAttribute('data-id'), [n.getAttribute('data-id')]); });
      n.addEventListener('mouseenter', function () { warm(n.getAttribute('data-id')); });
    });
    // анимация месяц-баров (data-ah) + остальные data-aw
    Array.prototype.forEach.call(view.querySelectorAll('[data-ah]'), function (b) {
      var h = b.getAttribute('data-ah');
      requestAnimationFrame(function () { requestAnimationFrame(function () { b.style.height = h; }); });
    });
    animBars(view);
  }

  /* донат по продуктам (на базе DONUT_COLORS, как dirsCard, но по суммам) */
  function finDonut(products) {
    if (!products || !products.length) {
      return '<div class="card sp7" style="padding:22px 26px">' +
        '<div class="sec-head"><span class="ic">' + ic('pie', 14) + '</span>' +
        '<div><div class="t">Выручка по услугам</div><div class="s">за что платят</div></div></div>' +
        '<div class="empty">Платежей пока нет.</div></div>';
    }
    var parts = products.slice(0, 4).map(function (p) { return { label: p.title, n: p.amount }; });
    var rest = products.slice(4).reduce(function (s, p) { return s + p.amount; }, 0);
    if (rest) parts.push({ label: 'Другое', n: rest });
    var total = parts.reduce(function (s, p) { return s + p.n; }, 0) || 1;
    var acc = 0;
    var grad = parts.map(function (p, i) {
      var from = acc / total * 100; acc += p.n; var to = acc / total * 100;
      return DONUT_COLORS[i] + ' ' + from + '% ' + to + '%';
    }).join(', ');
    var legend = parts.map(function (p, i) {
      return '<div class="r"><span class="dd2" style="background:' + DONUT_COLORS[i] + '"></span>' +
        '<span class="dnm">' + esc(p.label) + '</span>' +
        '<span class="dcount num">' + fmtMoney(p.n) + ' ₽</span>' +
        '<span class="dpc num">' + Math.round(p.n / total * 100) + '%</span></div>';
    }).join('');
    return '<div class="card sp7" style="padding:22px 26px">' +
      '<div class="sec-head"><span class="ic">' + ic('pie', 14) + '</span>' +
      '<div><div class="t">Выручка по услугам</div><div class="s">за что платят — доля каждой услуги</div></div></div>' +
      '<div class="distr-body"><div class="dwrap"><div class="dpie" style="background:conic-gradient(' + grad + ')"></div>' +
      '<div class="dctr"><div><div class="dn num" style="font-size:20px">' + fmtMoney(total) + '</div><div class="ds">₽ всего</div></div></div></div>' +
      '<div class="dleg">' + legend + '</div></div></div>';
  }
```

> Примечание по `.dcount`/`.dpc`: в `dirsCard` легенда — flex со столбцами через gap; суммы в рублях
> длиннее процентов, поэтому в `finDonut` они в том же `.dleg .r`. Если визуально тесно — добавь
> `.dleg .dcount { margin-left:auto }` уже есть поведение через flex; продукт-названия обрезаются по
> `.dnm` (nowrap+ellipsis). Этого достаточно.

### 3.11 ЗАМЕНИТЬ `buildPaySection` (строки ~1692–1711)
```js
  /* ── РАЗДЕЛ «Оплаты» — финансовый учёт клиента ── */
  var PAY_ST = {
    paid:     { label: 'оплачен',   sev: 'client' },
    pending:  { label: 'ожидается', sev: 'contacted' },
    refunded: { label: 'возврат',   sev: 'rejected' },
  };
  function buildPaySection(ctx) {
    var pays = (ctx.d && ctx.d.payments) || [];
    var paid = pays.filter(function (p) { return p.status === 'paid'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);
    var pending = pays.filter(function (p) { return p.status === 'pending'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);
    var refunded = pays.filter(function (p) { return p.status === 'refunded'; }).reduce(function (s, p) { return s + (p.amount_rub || 0); }, 0);

    var board = '<div class="pay-board">' +
      '<div class="pay-cell lead"><div class="pc-l">Оплачено</div><div class="pc-v num">' + fmtMoney(paid) + ' ₽</div></div>' +
      '<div class="pay-cell' + (pending ? '' : ' muted') + '"><div class="pc-l">Ожидается</div><div class="pc-v num">' + fmtMoney(pending) + ' ₽</div></div>' +
      '<div class="pay-cell' + (refunded ? '' : ' muted') + '"><div class="pc-l">Возвраты</div><div class="pc-v num">' + fmtMoney(refunded) + ' ₽</div></div>' +
    '</div>';

    var rows = pays.slice().sort(function (a, b) {
      var aw = a.paid_at || a.created_at || '', bw = b.paid_at || b.created_at || '';
      return aw < bw ? 1 : -1;
    }).map(function (p) {
      var st = PAY_ST[p.status] || PAY_ST.pending;
      var when = p.paid_at
        ? p.paid_at.slice(8, 10) + '.' + p.paid_at.slice(5, 7) + '.' + p.paid_at.slice(0, 4)
        : fmtWhen(p.created_at);
      var amtCls = p.status === 'refunded' ? ' refunded' : (p.status === 'pending' ? ' pending' : '');
      return '<div class="pay-row">' +
        '<div class="doc-b"><div class="doc-n">' + esc(p.title) +
          ' <span class="sev s-' + st.sev + '" style="margin-left:6px"><span class="d"></span>' + st.label + '</span></div>' +
          '<div class="doc-m">' + [when, p.note].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
        '<span class="pay-amt' + amtCls + ' num">' + fmtMoney(p.amount_rub) + ' ₽</span>' +
        '<button class="icobtn del" data-delpay="' + p.id + '" title="Удалить">' + ic('x', 14) + '</button></div>';
    }).join('');

    return '<div class="m-ctitle">Оплаты</div>' +
      '<div class="m-csub">Финансовый учёт по клиенту. Позже подвяжем ЮKassa — будет автоматически.</div>' +
      board +
      (pays.length ? '<div>' + rows + '</div>' : '<div class="field-empty">Платежей пока нет.</div>') +
      '<div class="dr-sec" style="margin-top:14px"><div class="dr-h">Добавить платёж</div>' +
        '<div class="pay-form">' +
          '<span class="pay-seg" id="pay-st"><button data-v="paid" class="on">оплачен</button>' +
            '<button data-v="pending">ожидается</button><button data-v="refunded">возврат</button></span>' +
          '<input id="pay-title" placeholder="За что — например «Диагностика» или «Сопровождение»">' +
          '<div class="pay-grid">' +
            '<input id="pay-amt" inputmode="numeric" placeholder="Сумма, ₽">' +
            '<input id="pay-date" type="date" value="' + todayISO(0) + '">' +
            '<button class="bp sm" id="pay-add-btn" style="justify-content:center">' + ic('plus', 13) + 'Добавить</button>' +
          '</div>' +
        '</div></div>';
  }
```
> `#pay-title` теперь обычный input — стиль берёт из `.pay-grid input`? Нет, он вне `.pay-grid`.
> Дай ему класс или правило. Проще: оставить `#pay-title` со стилем `.pay-grid input` через общий
> селектор. ДОБАВЬ в CSS (раздел оплат 2.1) правило:
> ```css
> .pay-form > input { outline: none; font: 500 13px 'Manrope', sans-serif; color: var(--ink);
>   background: var(--fill); border: 1px solid transparent; border-radius: 10px; padding: 11px 13px; }
> .pay-form > input:focus { background: #fff; border-color: #DCE7FF; }
> ```

### 3.12 ЗАМЕНИТЬ обработчик «добавить платёж» в `attachContentHandlers` (строки ~1800–1808)
```js
    // оплаты: добавить
    var payBtn = el('pay-add-btn');
    if (payBtn) {
      var payStEl = el('pay-st'), payStatus = 'paid';
      if (payStEl) Array.prototype.forEach.call(payStEl.children, function (b) {
        b.addEventListener('click', function () {
          payStatus = b.getAttribute('data-v');
          Array.prototype.forEach.call(payStEl.children, function (x) { x.classList.toggle('on', x === b); });
        });
      });
      payBtn.addEventListener('click', function () {
        var title = (el('pay-title').value || '').trim();
        var amt = parseInt((el('pay-amt').value || '').replace(/\D/g, ''), 10) || 0;
        var date = el('pay-date') && el('pay-date').value ? el('pay-date').value : todayISO(0);
        if (!title) { el('pay-title').focus(); return; }
        var body = { title: title, amount_rub: amt, status: payStatus };
        if (payStatus === 'paid' || payStatus === 'refunded') body.paid_at = date;
        apiSend('/admin/api/leads/' + id + '/payments', 'POST', body, function () {
          refreshDetail(id, function () { if (state.drawerId === id && state.modalSection === 'pay') renderDrawer(true); });
        });
      });
    }
```
> (DELETE-обработчик `data-delpay` ниже — оставить как есть, он не меняется.)

### 3.13 (опционально) В `startApp` сброс finance-страницы для не-owner — уже покрыт строкой про `path`:
В `startApp` есть `if (state.role !== 'owner' && state.page === 'path') state.page = 'dash';`.
ЗАМЕНИТЬ на:
```js
    if (state.role !== 'owner' && (state.page === 'path' || state.page === 'finance')) state.page = 'dash';
```

---

## 4. BACKEND (требования — отдельному агенту, кодом не трогаю)

Нужен один новый эндпоинт-агрегат. Существующие payments-эндпоинты не меняются.

### `GET /admin/api/finance` (роль owner; auth как у прочих `/admin/api/*` через `?k=`)
**Query:** `period` = `''` (всё время) | `month` (последние 30 дней) | `year` (последние 12 мес).
Период применяется к дате платежа (`paid_at` если есть, иначе `created_at`).

**Считает по всем платежам в схеме `eastside` (таблица платежей, та же, что наполняют
POST `/admin/api/leads/{id}/payments`), джойн с лидами для имён.** Статусы: `paid|pending|refunded`.

**Ответ (JSON, суммы — целые ₽):**
```json
{
  "paid_total": 0,
  "pending_total": 0,
  "refunded_total": 0,
  "paid_count": 0,
  "avg_check": 0,
  "by_status": [
    {"key":"paid","label":"Оплачено","amount":0},
    {"key":"pending","label":"Ожидается","amount":0},
    {"key":"refunded","label":"Возвраты","amount":0}
  ],
  "by_month": [ {"ym":"2026-05","label":"май","amount":0} ],
  "by_product": [ {"title":"Диагностика","amount":0,"count":0} ],
  "top_clients": [ {"lead_id":"<uuid>","name":"Имя","amount":0,"count":0} ],
  "paying_lead_ids": ["<uuid>", "..."]
}
```
Правила агрегатов:
- `by_month` — только `paid`, сгруппировано по месяцу даты оплаты, по возрастанию. `label` — рус.
  сокращение месяца (если бэку лень — пришли только `ym`, фронт сам подпишет).
- `by_product` — только `paid`, группировка по `title` (trim), сорт по `amount` desc.
- `top_clients` — только `paid`, группировка по лиду, сорт desc, лимит 8. `name` — из лида.
- `paying_lead_ids` — id лидов, у кого есть хотя бы один `paid` (для конверсии «заявка→оплата»).
- `avg_check = round(paid_total / paid_count)` при `paid_count>0`, иначе 0.

Если эндпоинта нет — фронт сам уйдёт в fallback (тянет детали клиентов и считает на клиенте),
поэтому деплой бэка и фронта можно расцепить. Но fallback неполный (только статусные клиенты) —
эндпоинт обязателен для точных цифр.

---

## Сводка

- Спроектировал НОВУЮ owner-страницу «Финансы» (`renderFinance` + `finDonut` + `fetchFinance`/fallback):
  statBar (выручка/ожидается/возвраты/средний чек), stacked по статусам, бары выручки по месяцам, донат
  по услугам, топ-клиенты с переходом в карточку, конверсия заявка→оплата. Регистрация в `NAV_ALL`
  (owner), маршруты в `setPage`/`renderView`/`renderHead`/`renderTopbar` (табы периода), сброс для не-owner.
- Переписал `buildPaySection`: итог-плашка из 3 цифр сверху, благородные `sev`-чипы статусов, форма
  добавления с выбором статуса (сегмент) + датой; обновил обработчик добавления (статус/дата). CSS блоки
  для финансов и оплат даны полностью (что заменить/добавить, включая мобилу).
- Зависимость от бэкенда: новый `GET /admin/api/finance` (агрегат) — primary; без него фронт работает
  на клиентском fallback по клиентам (неполно, с баннером-предупреждением). Payments POST/DELETE — без
  изменений.
- Пересечения с чужими участками: добавляю 1 строку в `NAV_ALL` и по ветке в `setPage`/`renderTopbar`/
  `renderHead`/`renderView`/`startApp` — это общие функции, агент MODAL тоже может трогать `buildPaySection`
  и `attachContentHandlers` (обработчик оплат). Координировать правки этих двух функций, чтобы не
  затереть друг друга. Иконки `coins`/`wallet` добавляются в `ic()` — не конфликтуют, если не дублировать.
- Дашборд-метрики, списки, воронка, «Путь», остальная модалка — НЕ трогал.
