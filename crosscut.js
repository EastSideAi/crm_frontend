/* Сквозная аналитика в CRM.

   Экран один в один повторяет черновик на истсайд.рф/сквозная-аналитика: тот же
   счет, те же разрезы, та же верстка. Разница в источнике — здесь данные живые,
   из ручки /admin/api/marketing/crosscut, а не снимок базы в теле страницы.

   Снаружи нужен один вызов:  CROSSCUT.render(контейнер, данные_ручки)

   Файл собирается скриптом analitika/snapshot/build_crm.py — руками не правят,
   правки идут в страницу черновика и в engine.js. */
window.CROSSCUT = (function () {
  var TPL = "  <div class=\"fbar\">\n    <div class=\"fhead\">\n      <span class=\"flabel\">Период</span>\n      <span class=\"seg\" id=\"seg\" role=\"group\" aria-label=\"Быстрый период\">\n        <button type=\"button\" data-p=\"m30\" aria-pressed=\"false\">30 дней</button>\n        <button type=\"button\" data-p=\"cur\" aria-pressed=\"false\">Текущий месяц</button>\n        <button type=\"button\" data-p=\"prev\" aria-pressed=\"true\">Прошлый месяц</button>\n        <button type=\"button\" data-p=\"m6\" aria-pressed=\"false\">6 месяцев</button>\n        <button type=\"button\" data-p=\"all\" aria-pressed=\"false\">Весь период</button>\n      </span>\n      <span class=\"dates\">\n        <label><span>с</span><input type=\"date\" id=\"dFrom\"></label>\n        <label><span>по</span><input type=\"date\" id=\"dTo\"></label>\n        <span class=\"dhint\" id=\"dHint\"></span>\n      </span>\n    </div>\n    <div class=\"fhead fhead2\">\n      <span class=\"flabel\">Кого считаем</span>\n      <span class=\"seg\" id=\"scope\" role=\"group\" aria-label=\"Кого считаем\">\n        <button type=\"button\" data-s=\"all\" aria-pressed=\"true\">Вся компания</button>\n        <button type=\"button\" data-s=\"launch\" aria-pressed=\"false\">Интенсив 23–24 сентября</button>\n      </span>\n    </div>\n    <p class=\"fnote\" id=\"fnote\"></p>\n  </div>\n\n\n  <nav class=\"tabs\" id=\"tabs\" role=\"tablist\">\n    <button type=\"button\" role=\"tab\" id=\"tb-main\" aria-controls=\"tab-main\" data-t=\"main\" aria-selected=\"true\">Главная</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-itogi\" aria-controls=\"tab-itogi\" data-t=\"itogi\" aria-selected=\"false\">Итоги</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-src\" aria-controls=\"tab-src\" data-t=\"src\" aria-selected=\"false\">Источники</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-coh\" aria-controls=\"tab-coh\" data-t=\"coh\" aria-selected=\"false\">Когорты</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-prod\" aria-controls=\"tab-prod\" data-t=\"prod\" aria-selected=\"false\">Продукты</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-diag\" aria-controls=\"tab-diag\" data-t=\"diag\" aria-selected=\"false\">Диагностика</button>\n    <button type=\"button\" role=\"tab\" id=\"tb-gap\" aria-controls=\"tab-gap\" data-t=\"gap\" aria-selected=\"false\">Чего тут нет</button>\n  </nav>\n\n  <div id=\"tab-main\" role=\"tabpanel\" aria-labelledby=\"tb-main\" tabindex=\"0\">\n    <div class=\"mainrow\">\n      <div class=\"mcol\">\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Выручка по дате поступления денег</h2>\n      <span class=\"hint\" id=\"revHint\"></span>\n    </div>\n    <p class=\"lede2\">Деньги приписаны дню, когда они пришли, а не когда выставили счет. Столбец — сумма за день.</p>\n    <div class=\"chart tall\" id=\"revChart\"></div>\n  </section>\n  <section class=\"sec\" id=\"invSec\">\n    <div class=\"sec-head\">\n      <h2>Счета и оплаты по дням</h2>\n      <span class=\"hint\">расстояние между линиями — деньги в неоплаченных счетах</span>\n    </div>\n    <svg class=\"lchart\" id=\"invLines\" aria-label=\"Счета и оплаты по дням\"></svg>\n    <div class=\"legend\">\n      <span><i class=\"i-inv\"></i>выставлено счетов</span>\n      <span><i class=\"i-pay\"></i>оплат пришло</span>\n    </div>\n  </section>\n      </div>\n\n      <div class=\"kwrap\">\n        <p class=\"howto\">Нажмите на плитку — откроется, <b>как цифра считается и как проверить ее руками</b>.</p>\n        <div class=\"kpis\" id=\"kpis\"></div>\n      </div>\n    </div>\n\n  <div class=\"lines\">\n    <section class=\"sec\">\n      <div class=\"sec-head\">\n        <h2>Средний чек по дням</h2>\n        <span class=\"hint\">точка — день, когда приходили деньги</span>\n      </div>\n      <p class=\"lede2\">Сумма дня, поделенная на число оплат этого дня. Один крупный счет сразу поднимает линию.</p>\n      <svg class=\"lchart\" id=\"checkLine\" aria-label=\"Средний чек по дням\"></svg>\n    </section>\n  </div>\n\n  </div>\n\n  <div id=\"tab-itogi\" role=\"tabpanel\" aria-labelledby=\"tb-itogi\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Лестница: от лида до оплаты</h2>\n      <span class=\"hint\" id=\"ladHint\"></span>\n    </div>\n    <div class=\"lad\" id=\"lad\"></div>\n    <p class=\"lede2\" id=\"ladNote\" hidden style=\"margin:14px 0 0\">Ступеней бесплатной диагностики в лестнице запуска нет: она идет в боте и по запуску не делится. Ее цифры смотрите на вкладке «Диагностика» — там они по всей базе.</p>\n    <p class=\"lede2\" id=\"ladGrew\" hidden style=\"margin:14px 0 0\">Ступень бывает больше предыдущей — это не ошибка счета. Люди приходят в разные месяцы: разбор мог пройти у человека, который оставил контакт в прошлом периоде, а оплата — по счету, выставленному раньше.</p>\n    <div class=\"flag bad\" id=\"ladWarn\" hidden></div>\n    <div class=\"flag\">\n      <span class=\"fl-l\">Чему в этой лестнице пока нельзя верить до конца</span>\n      <p style=\"margin:0\">Две ступени диагностики считаются <b>в боте</b>, а не в карточке человека: воронку включили в сентябре, и до нее людей там нет вовсе. Пока бот и CRM не склеены по человеку, эти ступени живут своей жизнью — один и тот же человек может быть в обеих и посчитаться дважды, а может не узнаться вообще. Чинится пунктом 3 плана работ.</p>\n    </div>\n  </section>\n\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Сколько проходит от первого касания до оплаты</h2>\n      <span class=\"hint\">оплаты выбранного периода</span>\n    </div>\n    <p class=\"lede2\">Это главный довод в пользу когорт: пока сделок мало, разброс огромный, и считать выручку месяцем оплаты — значит каждый месяц получать случайное число.</p>\n    <table class=\"tbl\" id=\"srok\"></table>\n  </section>\n\n  </div>\n\n  <div id=\"tab-src\" role=\"tabpanel\" aria-labelledby=\"tb-src\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Через какую дверь зашли люди</h2>\n      <span class=\"hint\">карточки с контактами за выбранный период</span>\n    </div>\n    <p class=\"lede2\">Дверь — это форма, через которую человек попал к нам: бот, лендинг интенсива, страница «Теплый прием». Колонка «с меткой» показывает, у скольких из них мы знаем еще и рекламный источник.</p>\n    <table class=\"tbl\" id=\"src\"></table>\n    <p class=\"lede2\" style=\"margin-top:14px\">Деньги в этой таблице привязаны к <b>людям, пришедшим за период</b>, а не к дате платежа: если человек пришел в сентябре, а заплатил в октябре, его деньги стоят в сентябрьской строке. Поэтому сумма здесь не совпадает с выручкой на главной — там деньги считаются по дню поступления.</p>\n  </section>\n\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Откуда человек пришел к двери</h2>\n      <span class=\"hint\">метка utm_source на ссылке</span>\n    </div>\n    <p class=\"lede2\">Это и есть ответ на вопрос «какой канал работает». Строка «без метки» — люди, пришедшие по голой ссылке: дверь мы знаем, а что их привело — нет.</p>\n    <table class=\"tbl\" id=\"utm\"></table>\n  </section>\n\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>По кампаниям</h2>\n      <span class=\"hint\">метка utm_campaign</span>\n    </div>\n    <p class=\"lede2\">Кампания — это затея целиком: интенсив, тест, рассылка по старой базе. Один запуск иногда записан разными словами — это видно прямо в таблице и чинится словарем меток.</p>\n    <table class=\"tbl\" id=\"camp\"></table>\n    <div class=\"flag\">\n      <span class=\"fl-l\">Что помнить про метки</span>\n      <p style=\"margin:0\">Метка ставится в момент перехода по ссылке и <b>задним числом не восстанавливается</b>. Ссылка без хвостика — человек навсегда останется «без метки». Второе: до карточки метка доезжает не всегда — при регистрации через бота она пока теряется, и в таблице это видно как большая строка «без метки».</p>\n    </div>\n  </section>\n\n  </div>\n\n  <div id=\"tab-coh\" role=\"tabpanel\" aria-labelledby=\"tb-coh\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Когорты: выручка приписана месяцу, когда человек пришел</h2>\n      <span class=\"hint\">а не месяцу, когда заплатил</span>\n    </div>\n    <p class=\"lede2\">Решение о сопровождении семья принимает неделями, иногда месяцами. Если считать выручку по месяцу оплаты, сентябрьская реклама выглядит провальной до тех пор, пока деньги не придут в ноябре, — и ее выключают зря.</p>\n    <table class=\"tbl\" id=\"coh\"></table>\n    <p class=\"lede2\" id=\"cohNote\" style=\"margin-top:14px\"></p>\n  </section>\n\n  </div>\n\n  <div id=\"tab-prod\" role=\"tabpanel\" aria-labelledby=\"tb-prod\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Деньги по продуктам</h2>\n      <span class=\"hint\">за выбранный период</span>\n    </div>\n    <table class=\"tbl\" id=\"prod\"></table>\n    <div class=\"flag\">\n      <span class=\"fl-l\">Разбивки по тарифам сопровождения сейчас нет, и вот почему</span>\n      <p style=\"margin:0\">Самые крупные счета — на сотни тысяч — выставлены <b>без выбора тарифа</b>: название написано руками в поле «назначение». Система видит сумму, но не видит, что именно купили. Пока счета выставляются текстом, ответить «что берут чаще, Стандарт или Премиум» невозможно. Чинится правилом в CRM: тариф выбирается из списка, иначе счет не выставляется.</p>\n    </div>\n  </section>\n\n  </div>\n\n  <div id=\"tab-diag\" role=\"tabpanel\" aria-labelledby=\"tb-diag\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Диагностика: бесплатная и у тьютора-диагноста</h2>\n      <span class=\"hint\">за выбранный период</span>\n    </div>\n    <p class=\"lede2\">Два разных продукта в одной лестнице: бесплатную человек проходит сам в боте, разбор ведет живой тьютор-диагност, и именно на разборе продается сопровождение.</p>\n    <div class=\"lad\" id=\"diag\"></div>\n  </section>\n\n  </div>\n\n  <div id=\"tab-gap\" role=\"tabpanel\" aria-labelledby=\"tb-gap\" tabindex=\"0\" hidden>\n  <section class=\"sec\">\n    <div class=\"sec-head\">\n      <h2>Чего на этой странице нет</h2>\n      <span class=\"hint\">сверил с макетом Олеси и с Монитором</span>\n    </div>\n    <p class=\"lede2\">Эту страницу я сверил с двумя образцами: макетом экрана, который Олеся нарисовала в Миро, и Монитором, которым команда уже пользуется. Ниже все, что есть там и чего нет здесь, с причинами. Это граница черновика, а не список обещаний: чтобы никто не искал кнопку, которой нет.</p>\n    <table class=\"tbl\" id=\"gap\"></table>\n  </section>\n\n  <div class=\"note\">\n    <span class=\"fl-l\">Что это за экран и что с ним делать</span>\n    <p>Это черновик, собранный на <b>настоящих цифрах из боевой базы</b>. Ничего не придумано: где данных нет, стоит прочерк и причина. Когда мы договоримся, что экран показывает правду и показывает ее понятно, он переедет в CRM и начнет считаться сам, в реальном времени.</p>\n    <p>Методика расчета, паспорт каждой цифры и чек-лист подготовки запуска — в соседнем документе: <a href=\"https://истсайд.рф/аналитика-правила/\">истсайд.рф/аналитика-правила</a></p>\n  </div>\n\n  </div>\n\n";

  function build(ROOT, SNAP) {
    function $id(id) { return ROOT.querySelector('#' + id); }
    function $one(sel) { return ROOT.querySelector(sel); }
    function $all(sel) { return ROOT.querySelectorAll(sel); }

    /* Линия на SVG: пустые точки не соединяем — разрыв честнее выдуманного нуля. */
    function line(el, pts, color, fmt){
      /* viewBox по фактической ширине. Раньше стоял жесткий 320 с
         preserveAspectRatio="none": на 500-пиксельной карточке картинка
         растягивалась в полтора раза, точки превращались в эллипсы, а подписи
         уезжали в разрядку — ту самую, что в design.md названа дешевкой. */
      var W = Math.max(260, Math.round(el.clientWidth) || 320), H = 150, L = 26, R = 26, T = 24, B = 24;
      el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      var vals = pts.filter(function(q){ return q.v !== null; }).map(function(q){ return q.v; });
      if (!vals.length){ el.innerHTML = '<text x="12" y="74">нет данных</text>'; return; }
      var mx = Math.max.apply(null, vals);
      var step = pts.length > 1 ? (W - L - R) / (pts.length - 1) : 0;
      var xy = pts.map(function(q, i){
        return {x: L + i * step, y: q.v === null ? null : H - B - q.v / (mx || 1) * (H - T - B), p: q};
      });
      var path = '', open = false;
      xy.forEach(function(q){
        if (q.y === null){ open = false; return; }
        path += (open ? ' L' : ' M') + q.x.toFixed(1) + ' ' + q.y.toFixed(1);
        open = true;
      });
      /* Значение подписываем не у каждой точки: на девяти днях подписи «14к 14к 28к»
         налезали друг на друга и читались как каша. Подписываем пик, концы и дальше
         только те точки, что отошли от предыдущей подписи. */
      var live = xy.filter(function(q){ return q.y !== null; });
      var peak = live.reduce(function(a, q){ return q.p.v > a.p.v ? q : a; }, live[0]);
      var lastLab = -99;
      var dots = live.map(function(q, i){
        var must = q === peak || i === 0 || i === live.length - 1;
        var show = must || (q.x - lastLab) >= 42;
        if (show) lastLab = q.x;
        return '<circle class="dot" cx="' + q.x.toFixed(1) + '" cy="' + q.y.toFixed(1) + '" r="3.2" fill="' + color + '"/>' +
               (show ? '<text class="v' + (q === peak ? ' top' : '') + '" x="' + q.x.toFixed(1) + '" y="' + (q.y - 8).toFixed(1) + '" text-anchor="middle">' + fmt(q.p.v) + '</text>' : '');
      }).join('');
      var caps = xy.map(function(q){
        return '<text x="' + q.x.toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + q.p.m + '</text>';
      }).join('');
      el.innerHTML = '<line class="ax" x1="0" y1="' + (H - B) + '" x2="' + W + '" y2="' + (H - B) + '"/>' +
                     '<path class="ln" d="' + path + '" stroke="' + color + '"/>' + dots + caps;
    }

    /* Две линии на одной шкале. Отдельная функция, а не параметр у line(): там на
       каждой точке подписано значение, а здесь две подписи в одной точке налезли бы
       друг на друга. Поэтому значения подписаны только там, где линии расходятся. */
    function twoLines(el, rows, c1, c2){
      var W = Math.max(260, Math.round(el.clientWidth) || 320), H = 150, L = 22, R = 22, T = 22, B = 24;
      el.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
      var mx = 0;
      rows.forEach(function(r){ mx = Math.max(mx, r.a, r.b); });
      if (!mx){ el.innerHTML = '<text x="12" y="74">нет данных</text>'; return; }
      var step = rows.length > 1 ? (W - L - R) / (rows.length - 1) : 0;
      function path(key){
        return rows.map(function(r, i){
          var x = L + i * step, y = H - B - r[key] / mx * (H - T - B);
          return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        }).join(' ');
      }
      /* Значения подписываем там, где линии разошлись заметно: это и есть смысл
         графика — деньги, которые выставили и не получили. На совпавших точках
         подпись только мешала бы. */
      var gap = rows.map(function(r){ return Math.abs(r.a - r.b); });
      var mg = Math.max.apply(null, gap);
      var dots = rows.map(function(r, i){
        var x = L + i * step;
        var ya = H - B - r.a / mx * (H - T - B);
        var yb = H - B - r.b / mx * (H - T - B);
        var lab = '';
        /* Обе подписи ставим НАД своими точками: подпись под нижней точкой налезала
           на подписи дней у оси. Если точки сошлись ближе 18px, подписываем только
           верхнюю — иначе два числа слипаются. */
        if (mg && gap[i] >= mg * 0.45 && gap[i] > 0){
          var top = ya < yb ? {y: ya, v: r.a} : {y: yb, v: r.b};
          var bot = ya < yb ? {y: yb, v: r.b} : {y: ya, v: r.a};
          lab = '<text class="v" x="' + x.toFixed(1) + '" y="' + (top.y - 7).toFixed(1) + '" text-anchor="middle">' +
                  kk(top.v) + '</text>';
          if (bot.y - top.y >= 18)
            lab += '<text class="v" x="' + x.toFixed(1) + '" y="' + (bot.y - 7).toFixed(1) + '" text-anchor="middle">' +
                   kk(bot.v) + '</text>';
        }
        return '<circle class="dot" cx="' + x.toFixed(1) + '" cy="' + ya.toFixed(1) + '" r="2.8" fill="' + c1 + '"/>' +
               '<circle class="dot" cx="' + x.toFixed(1) + '" cy="' + yb.toFixed(1) + '" r="2.8" fill="' + c2 + '"/>' + lab;
      }).join('');
      /* Подписи дней прореживаем: на месяце их тридцать, все не влезут. */
      var every = Math.ceil(rows.length / 8);
      var caps = rows.map(function(r, i){
        if (i % every) return '';
        return '<text x="' + (L + i * step).toFixed(1) + '" y="' + (H - 7) + '" text-anchor="middle">' + r.m + '</text>';
      }).join('');
      el.innerHTML = '<line class="ax" x1="0" y1="' + (H - B) + '" x2="' + W + '" y2="' + (H - B) + '"/>' +
                     '<path class="ln" d="' + path('a') + '" stroke="' + c1 + '"/>' +
                     '<path class="ln" d="' + path('b') + '" stroke="' + c2 + '"/>' + dots + caps;
    }

    /* ── Движок экрана ───────────────────────────────────────────────────────────
       Снимок боевой базы лежит в SNAP: строка на сессию (визит или лид), деньги
       привязаны к ней же. Все цифры на экране считаются из него прямо в браузере,
       поэтому период, календарь и фильтр запуска работают на каждой вкладке, а не
       на двух. Персональных данных в снимке нет: только даты, суммы и метки. */

    var DOORS = {
      lead_created_bot:        ['Бот в мессенджерах', 'человек написал боту, карточку завел он'],
      webinar_registered:      ['Форма регистрации на интенсив', 'лендинг и страница эфира'],
      lead_created_manual:     ['Менеджер из диалога', 'завел карточку прямо из переписки'],
      arrival_request:         ['Страница «Теплый прием»', 'заявка вместе с оплатой'],
      det_test_started:        ['Тренажеры и тесты', 'DET, HSK, CSCA'],
      hsk_signup:              ['Тренажеры и тесты', 'DET, HSK, CSCA'],
      csca_result:             ['Тренажеры и тесты', 'DET, HSK, CSCA'],
      course_free_guest:       ['Курс китайского, бесплатный', 'первый урок'],
      questionnaire_submitted: ['Анкета на сайте', 'заполнил форму на платформе'],
      cabinet_entered:         ['Кабинет платформы', 'вошел в личный кабинет'],
      lead_submitted:          ['Запись к тьютору с сайта', 'выбрал время сразу'],
      '':                      ['Дверь не определилась', 'старые карточки и разовые страницы']
    };
    function doorOf(k){ return DOORS[k] || ['Прочие двери', 'редкие сценарии платформы']; }

    /* Продукты: в базе лежат кодами тарифов, людям нужны названия. */
    var PRODNAMES = {
      'arrival-solo': 'Теплый прием',
      'arrival-meet': 'Встреча в аэропорту',
      'arrival-online': 'Теплый прием, онлайн',
      'intensive-vip': 'Билет на интенсив',
      'diagnostics': 'Платная диагностика',
      'exam-4': 'Пробный экзамен'
    };
    var OFFERS = {'intensive-vip': 1, 'diagnostics': 1, 'exam-4': 1};
    function prodName(key, title){ return PRODNAMES[key] || title || key; }

    /* Кампании запуска. Коды в базе разъехались — один интенсив писался тремя
       разными словами, поэтому список явный, а не «что похоже на сентябрь». */
    var LAUNCH = {
      title: 'Интенсив 23–24 сентября',
      from: '2026-09-08',
      camps: {'intensiv-sep': 1, 'intensive': 1, 'diag-test': 1, 'diag': 1}
    };

    var TODAY = SNAP.snap.slice(0, 10);
    var FIRST = SNAP.leads.length ? SNAP.leads[0].d : '2026-06-01';

    var MONTHS = ['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','ноя','дек'];
    var MONTHS_FULL = ['январь','февраль','март','апрель','май','июнь','июль',
                       'август','сентябрь','октябрь','ноябрь','декабрь'];
    var MONTHS_OF = ['января','февраля','марта','апреля','мая','июня','июля',
                     'августа','сентября','октября','ноября','декабря'];
    function dmy(iso){ var p = iso.split('-'); return (+p[2]) + '.' + p[1]; }
    function human(iso){ var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS[+p[1] - 1]; }
    function days(a, b){ return Math.round((new Date(b) - new Date(a)) / 86400000) + 1; }
    function shift(iso, n){ var d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
    function monthOf(iso){ return iso.slice(0, 7); }
    function monthName(ym){ var p = ym.split('-'); return MONTHS_FULL[+p[1] - 1] + ' ' + p[0]; }
    function fullDate(iso){ var p = iso.split('-'); return (+p[2]) + ' ' + MONTHS_OF[+p[1] - 1] + ' ' + p[0]; }

    function rub(n){ return Math.round(n).toLocaleString('ru-RU') + ' ₽'; }
    function num(n){ return n.toLocaleString('ru-RU'); }
    function kk(v){ return v >= 1000 ? Math.round(v / 1000) + 'к' : String(Math.round(v)); }

    var state = {from: '2026-09-01', to: '2026-09-30', preset: 'sep', scope: 'all', open: null, tab: 'main'};

    /* Человек склеен по телефону, почте и id мессенджера еще в выгрузке: поле g —
       безликий номер человека, одинаковый у всех его карточек. Благодаря ему запуск
       узнает своего участника, даже если платил он из другой карточки. */
    var LAUNCH_PEOPLE = (function(){
      var set = {};
      SNAP.leads.forEach(function(l){
        if (!l.g) return;
        if (l.reg || (l.cp && LAUNCH.camps[l.cp])) set[l.g] = 1;
      });
      return set;
    })();
    function inLaunch(l){
      if (l.reg) return true;
      if (l.cp && LAUNCH.camps[l.cp]) return true;
      return !!(l.g && LAUNCH_PEOPLE[l.g]);
    }
    function rows(){
      return state.scope === 'launch' ? SNAP.leads.filter(inLaunch) : SNAP.leads;
    }
    function inP(d, a, b){ return !!d && d >= a && d <= b; }

    /* Все числа одного периода считаются одним проходом: два счетчика на один
       вопрос однажды разойдутся, и экран начнет спорить сам с собой. */
    function agg(a, b){
      var r = {leads: 0, visits: 0, regs: 0, watched: 0, signed: 0, meeting: 0, meetings: 0,
               invN: 0, invRub: 0, invCanceled: 0, invPaidN: 0,
               payN: 0, revenue: 0, payers: 0, withUtm: 0, withCamp: 0,
               revByDay: {}, invByDay: {}, payByDay: {}, payCntByDay: {}, doors: {}, utm: {}, camps: {},
               prods: {}, srok: [0, 0, 0, 0], cohorts: {}, _payers: {}, people: {}, peopleN: 0};
      rows().forEach(function(l){
        var mine = inP(l.d, a, b);
        if (mine){
          r.visits++;
          if (l.c){
            r.leads++;
            var gk = l.g ? 'g' + l.g : 'x' + r.leads;
            if (!r.people[gk]){ r.people[gk] = 1; r.peopleN++; }
          }
          if (l.c && l.s) r.withUtm++;
          if (l.c && l.cp) r.withCamp++;
        }
        if (inP(l.reg, a, b)){ r.regs++; if (l.w) r.watched++; }
        if (inP(l.sb, a, b)) r.signed++;
        var myCalls = (l.cl || []).filter(function(c){ return inP(c, a, b); }).length;
        if (myCalls){ r.meetings += myCalls; r.meeting++; }

        /* Деньги приходят тремя дорогами: счета CRM (сопровождение, «Теплый прием»),
           офферы (билет на интенсив, мини-продукты через кассу) и оплата строкой прямо
           в карточке, без счета — так в CRM проводят сопровождение. Считать надо все
           три, иначе экран не сойдется с кассой: до 09.10.2026 третьей не было, и
           2,39 млн рублей с сентября на экран не попадали. */
        var allPays = (l.p || []).map(function(x){ return {d: x[0], v: x[1], prod: null}; })
          .concat((l.op || []).map(function(x){ return {d: x[0], v: x[1], prod: x[2]}; }))
          .concat((l.pc || []).map(function(x){ return {d: x[0], v: x[1], prod: x[2]}; }));
        var myPay = 0, myRub = 0;
        allPays.forEach(function(x){
          if (!inP(x.d, a, b)) return;
          myPay++; myRub += x.v;
          r.payByDay[x.d] = (r.payByDay[x.d] || 0) + x.v;
          r.revByDay[x.d] = (r.revByDay[x.d] || 0) + x.v;
          r.payCntByDay[x.d] = (r.payCntByDay[x.d] || 0) + 1;
          if (x.prod){
            var op = r.prods[x.prod] || (r.prods[x.prod] = {n: 0, inv: 0, paid: 0, tariff: true, title: x.prod});
            op.n++; op.inv += x.v; op.paid += x.v;
          }
          if (l.d){
            var dist = days(l.d, x.d) - 1;
            r.srok[dist < 0 ? 3 : dist === 0 ? 0 : dist <= 7 ? 1 : 2]++;
          }
        });
        if (myPay){
          r.payN += myPay; r.revenue += myRub;
          var pk = l.g ? 'g' + l.g : 's' + (r._sid = (r._sid || 0) + 1);
          if (!r._payers[pk]){ r._payers[pk] = 1; r.payers++; }
        }

        (l.o || []).forEach(function(o){
          if (!inP(o[0], a, b)) return;
          if (o[2] === 'canceled'){ r.invCanceled++; return; }
          r.invN++; r.invRub += o[1];
          if (o[2] === 'paid' || o[2] === 'partially_paid') r.invPaidN++;
          r.invByDay[o[0]] = (r.invByDay[o[0]] || 0) + o[1];
          var key = o[3] === 'custom' ? o[4] : o[3];
          var pr = r.prods[key] || (r.prods[key] = {n: 0, inv: 0, paid: 0, tariff: o[3] !== 'custom', title: o[4]});
          pr.n++; pr.inv += o[1];
        });

        /* Деньги продукта — оплаченная часть счета. Точной разбивки платежа по
           счетам у нас нет, поэтому оплаты лида раскладываются на его счета по
           порядку: это честнее, чем приписывать всю сумму первому. */
        var left = (l.p || []).filter(function(p){ return inP(p[0], a, b); }).reduce(function(s, p){ return s + p[1]; }, 0);
        (l.o || []).forEach(function(o){
          if (!left || !inP(o[0], a, b) || o[2] === 'canceled') return;
          var take = Math.min(left, o[1]); left -= take;
          var key = o[3] === 'custom' ? o[4] : o[3];
          if (r.prods[key]) r.prods[key].paid += take;
        });

        if (mine && l.c){
          var dk = doorOf(l.k)[0];
          var d = r.doors[dk] || (r.doors[dk] = {n: 0, utm: 0, signed: 0, meeting: 0, inv: 0, paid: 0, rub: 0, note: doorOf(l.k)[1]});
          d.n++;
          if (l.s) d.utm++;
          if (l.sb) d.signed++;
          if ((l.cl || []).length) d.meeting++;
          d.inv += (l.o || []).filter(function(o){ return o[2] !== 'canceled'; }).length;
          var paid = allPays;
          d.paid += paid.length;
          d.rub += paid.reduce(function(s, x){ return s + x.v; }, 0);

          var uk = l.s || '(без метки)';
          var u = r.utm[uk] || (r.utm[uk] = {n: 0, signed: 0, meeting: 0, paid: 0, rub: 0});
          u.n++;
          if (l.sb) u.signed++;
          if ((l.cl || []).length) u.meeting++;
          u.paid += paid.length;
          u.rub += paid.reduce(function(s, x){ return s + x.v; }, 0);

          var ck = l.cp || '(без кампании)';
          var c = r.camps[ck] || (r.camps[ck] = {n: 0, rub: 0, paid: 0});
          c.n++; c.paid += paid.length;
          c.rub += paid.reduce(function(s, x){ return s + x.v; }, 0);

          var ym = monthOf(l.d);
          var co = r.cohorts[ym] || (r.cohorts[ym] = {leads: 0, signed: 0, meeting: 0, inv: 0, paid: 0, rub: 0});
          co.leads++;
          if (l.sb) co.signed++;
          if ((l.cl || []).length) co.meeting++;
          co.inv += (l.o || []).filter(function(o){ return o[2] !== 'canceled'; }).length;
          co.paid += paid.length ? 1 : 0;
          co.rub += paid.reduce(function(s, x){ return s + x.v; }, 0);
        }
      });

      /* Диагностика живет в боте отдельной воронкой и к карточке человека пока не
         привязана — по запуску ее не разложить, и об этом сказано на экране. */
      r.diagStart = 0; r.diagDone = 0;
      /* Воронка диагностики приходит из бота отдельным куском: ее может не быть
         (на экране CRM — когда таблицы бота недоступны), и это не повод падать. */
      (SNAP.diag || []).forEach(function(x){
        if (!inP(x[0], a, b)) return;
        r.diagStart++;
        if (x[1] >= 16) r.diagDone++;
      });

      r.spend = 0; r.spendRows = 0;
      SNAP.spend.forEach(function(s){ if (inP(s[0], a, b)){ r.spend += s[2]; r.spendRows++; } });

      r.cv = r.invN ? Math.round(r.invPaidN / r.invN * 100) : null;
      return r;
    }

    function prevRange(){
      var n = days(state.from, state.to);
      return [shift(state.from, -n), shift(state.from, -1)];
    }

    var CUR = null, PRV = null;
    function recalc(){
      CUR = agg(state.from, state.to);
      var p = prevRange();
      PRV = p[0] < FIRST && p[1] < FIRST ? null : agg(p[0], p[1]);
    }

    /* ── Паспорта цифр: что считаем, откуда, как проверить руками ────────────── */
    var PASSPORTS = {
      revenue: {t:'Выручка', what:'Деньги, которые реально пришли за выбранный период. Считается по дате поступления, а не по дате счета.', from:'Платежи по счетам CRM со статусом «оплачено».', how:'Открыть список оплат за тот же период и сложить суммы. Отдельно сверить с кабинетом ЮKassa — помня, что часть денег приходит переводом мимо кассы.'},
      payN: {t:'Оплат', what:'Сколько поступлений пришло. Рассрочка в два платежа — это две оплаты и один человек.', from:'Те же строки платежей.', how:'Список оплат с датами. Количество строк обязано совпасть с цифрой.'},
      invN: {t:'Счетов выставлено', what:'Сколько счетов выписали за период и на какую сумму. Отмененные показаны отдельно и в сумму не входят.', from:'Заказы CRM, кроме черновиков.', how:'Список счетов с суммами и датами. Сумма оплаченного обязана быть не больше суммы выставленного.'},
      checkPay: {t:'Средний чек', what:'Крупное число — выручка на число платежей. Подпись «на человека» — та же выручка на число людей: сопровождение берут в рассрочку, и два платежа одного человека это одна покупка, а не две.', from:'Платежи со статусом «оплачено», во втором случае сгруппированные по людям.', how:'Поделить выручку периода на число оплат и на число плательщиков. Если цифры разошлись — значит кто-то заплатил дважды.'},
      cv: {t:'Счет → оплата', what:'Доля счетов периода, по которым пришли деньги хотя бы частично.', from:'Заказы и платежи за период.', how:'Поделить оплаченные счета на выставленные. Доля выше 100% значит, что оплатили счета прошлого месяца.'},
      leads: {t:'Лидов', what:'Новые карточки людей, у которых есть хотя бы один контакт: телефон, почта или телеграм. Карточка без контактов — это визит, а не лид. Один человек может завести несколько карточек — экран их склеивает по телефону, почте и id мессенджера и подписывает, сколько это живых людей.', from:'Карточки платформы.', how:'Открыть список новых карточек за период и пересчитать. У каждой обязан быть контакт. Если у двух карточек один телефон — это один человек.'},
      withUtm: {t:'Лидов с рекламной меткой', what:'Сколько новых карточек пришло со ссылки с меткой — то есть мы знаем не только дверь, но и что человека к ней привело.', from:'Поле utm в карточке платформы.', how:'Открыть карточку и посмотреть источник. Метка ставится в момент перехода и задним числом не восстанавливается.'},
      diagDone: {t:'Завершили бесплатную диагностику', what:'Люди, дошедшие до результата в диагностике. Диагностика идет в боте отдельной воронкой.', from:'Шаги воронки диагностики в боте.', how:'Открыть воронку в разделе «Маркетинг»: число дошедших до последнего шага обязано совпасть.'},
      meeting: {t:'Прошли разбор у тьютора-диагноста', what:'Разборы, которые реально состоялись. «Записались» и «пришли» — разные цифры, и они не объединяются.', from:'Записи о состоявшихся встречах в карточках.', how:'У каждого разбора есть дата и расшифровка встречи. Открыть одну наугад — либо встреча есть, либо цифра врет.'},
      perLead: {t:'Выручка на лида', what:'Вся выручка периода, поделенная на число лидов этого периода. Грубая мера: деньги часто приходят от людей, пришедших раньше.', from:'Выручка и лиды с этого же экрана.', how:'Поделить одно на другое. Честнее смотреть на когорты — там деньги привязаны к месяцу прихода человека.'},
      spend: {t:'Расход и окупаемость', what:'Сколько потратили на рекламу за период и сколько выручки на этот рубль пришло.', from:'Таблица расходов в CRM, раздел «Маркетинг». Заводится руками.', how:'Сверить с кабинетами рекламы и счетами подрядчиков. Пока расход не заведен, окупаемость не считается — ее не из чего считать.'},
      regs: {t:'Регистраций на интенсив', what:'Сколько человек записалось на эфир за период. Один человек считается один раз, даже если регистрировался дважды.', from:'Регистрации на событие в CRM.', how:'Список регистраций с датами. Служебные записи бота и прогоны робота в цифру не входят.'}
    };

    function pctVal(now, was){ return was ? Math.round((now - was) / was * 100) : null; }
    function delta(now, was){
      if (was === null || was === undefined) return '<div class="k-no">не с чем сравнить</div>';
      if (!was) return '<div class="k-no">в прошлом периоде нуль</div>';
      var p = pctVal(now, was);
      var cls = p > 0 ? 'up' : (p < 0 ? 'down' : 'flat');
      var arrow = p > 0 ? '▲' : (p < 0 ? '▼' : '•');
      return '<div class="k-d ' + cls + '">' + (p > 0 ? '+' : '') + p + '% ' + arrow +
             '<span class="was">было ' + num(was) + '</span></div>';
    }
    function kpiBtn(key, label, value, sub, prevVal, nowVal, extra){
      return '<button class="kpi' + (extra ? ' ' + extra : '') + '" type="button" data-k="' + key + '" aria-expanded="false">' +
        '<span class="k-l">' + label + '</span>' +
        '<span class="k-v">' + value + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
        (prevVal === undefined ? '' : delta(nowVal, prevVal)) + '</button>';
    }

    function renderKpis(){
      var d = CUR, p = PRV, h = '';
      h += kpiBtn('revenue', 'Выручка', rub(d.revenue), '', p ? p.revenue : undefined, d.revenue, 'hero');
      h += kpiBtn('payN', 'Оплат', num(d.payN), '', p ? p.payN : undefined, d.payN);
      h += kpiBtn('invN', 'Счетов выставлено', num(d.invN),
                  'на ' + rub(d.invRub) + (d.invCanceled ? ' · отменено ' + d.invCanceled : ''),
                  p ? p.invN : undefined, d.invN);
      var chPay = d.payN ? d.revenue / d.payN : 0, chMan = d.payers ? d.revenue / d.payers : 0;
      h += kpiBtn('checkPay', 'Средний чек', chPay ? rub(chPay) : '—',
                  (chMan && Math.round(chMan) !== Math.round(chPay)) ? 'на человека ' + rub(chMan) : '',
                  (p && p.payN) ? Math.round(p.revenue / p.payN) : null, Math.round(chPay));
      var cvD = '<div class="k-no">за период счетов не было</div>';
      if (d.cv !== null && p && p.cv !== null){
        var dp = d.cv - p.cv, c2 = dp > 0 ? 'up' : (dp < 0 ? 'down' : 'flat');
        cvD = '<div class="k-d ' + c2 + '">' + (dp > 0 ? '+' : '') + dp + ' п.п. ' +
              (dp > 0 ? '▲' : (dp < 0 ? '▼' : '•')) + '<span class="was">было ' + p.cv + '%</span></div>';
      } else if (d.cv !== null) cvD = '<div class="k-no">не с чем сравнить</div>';
      h += '<button class="kpi" type="button" data-k="cv" aria-expanded="false"><span class="k-l">Счет → оплата</span>' +
           '<span class="k-v">' + (d.cv === null ? '—' : d.cv + '%') + '</span>' + cvD + '</button>';
      h += kpiBtn('leads', 'Лидов', num(d.leads),
                  (d.peopleN && d.peopleN !== d.leads) ? 'это ' + num(d.peopleN) + ' человек, остальные карточки склеены' : '',
                  p ? p.leads : undefined, d.leads);
      h += kpiBtn('withUtm', 'Из них с меткой', d.leads ? num(d.withUtm) : '—',
                  d.leads ? Math.round(d.withUtm / d.leads * 100) + '% лидов' : '',
                  p ? p.withUtm : undefined, d.withUtm);
      h += kpiBtn('diagDone', 'Завершили диагностику', d.diagDone ? num(d.diagDone) : '—', '',
                  p ? p.diagDone : undefined, d.diagDone);
      h += kpiBtn('meeting', 'Разборов прошло', num(d.meetings),
                  d.meetings && d.meetings !== d.meeting ? 'у ' + d.meeting + ' человек' : '',
                  p ? p.meetings : undefined, d.meetings);
      if (state.scope === 'launch')
        h += kpiBtn('regs', 'Регистраций на интенсив', num(d.regs),
                    d.regs ? 'смотрели эфир ' + d.watched : '', p ? p.regs : undefined, d.regs);
      else
        h += kpiBtn('perLead', 'Выручка на лида', d.leads ? rub(d.revenue / d.leads) : '—', '',
                    (p && p.leads) ? Math.round(p.revenue / p.leads) : null,
                    d.leads ? Math.round(d.revenue / d.leads) : 0);
      /* Окупаемость словами, а не коэффициентом: расход в CRM заводится руками и
         заведен не весь, а «×52» читается как готовая метрика и врет. */
      h += kpiBtn('spend', 'Расход на рекламу', d.spend ? rub(d.spend) : '—',
                  d.spend ? 'заведено строк: ' + d.spendRows : 'в CRM за период не заведен',
                  undefined, 0);
      $id('kpis').innerHTML = h;
      if (state.open) openDrawer(state.open, true);
    }

    function openDrawer(key, keep){
      var box = $id('kpis');
      var old = box.querySelector('.drawer');
      if (old) old.remove();
      box.querySelectorAll('.kpi').forEach(function(b){ b.setAttribute('aria-expanded', b.dataset.k === key ? 'true' : 'false'); });
      if (!key){ state.open = null; return; }
      var p = PASSPORTS[key];
      if (!p) return;
      var btn = box.querySelector('.kpi[data-k="' + key + '"]');
      if (!btn) return;
      var d = document.createElement('div');
      d.className = 'drawer';
      d.id = 'drawer-' + key;
      btn.setAttribute('aria-controls', d.id);
      d.innerHTML = '<h4>' + p.t + ' — как считается</h4>' +
        '<dl><dt>Что считаем</dt><dd>' + p.what + '</dd>' +
        '<dt>Откуда</dt><dd>' + p.from + '</dd>' +
        '<dt>Как проверить</dt><dd>' + p.how + '</dd></dl>' +
        '<div class="people">В CRM здесь будет <b>список людей за этой цифрой</b>: имя, контакты, откуда пришел, дата события — с переходом в карточку и в диалог. На этой странице людей нет намеренно: она лежит в открытом интернете, а контакты детей туда не выкладываются.</div>';
      btn.insertAdjacentElement('afterend', d);
      state.open = key;
      if (!keep) d.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    }

    /* Шаг графиков: на длинном периоде по дням получается частокол из трехсот
       столбиков, поэтому от двух месяцев и дальше считаем по месяцам. */
    function byStep(map){
      var long = days(state.from, state.to) > 62;
      var out = {};
      Object.keys(map).forEach(function(k){
        var key = long ? monthOf(k) : k;
        out[key] = (out[key] || 0) + map[k];
      });
      return Object.keys(out).sort().map(function(k){
        return {m: long ? MONTHS[+k.slice(5, 7) - 1] : dmy(k), v: out[k], key: k};
      });
    }

    function renderCharts(){
      var rev = $id('revChart'), hint = $id('revHint');
      var bars = byStep(CUR.revByDay);
      if (!bars.length){
        rev.innerHTML = '<p class="empty">За этот период денег не приходило.</p>';
        hint.textContent = '';
      } else {
        hint.textContent = bars.length + (days(state.from, state.to) > 62 ? ' мес. с деньгами' : ' дн. с деньгами');
        var max = Math.max.apply(null, bars.map(function(r){ return r.v; }));
        rev.innerHTML = bars.map(function(r){
          return '<div class="bar"><span class="val">' + kk(r.v) + '</span>' +
            '<span class="b" style="height:' + Math.max(2, Math.round(r.v / max * 196)) + 'px"></span>' +
            '<span class="cap">' + r.m + '</span></div>';
        }).join('');
      }

      /* Пустой график — хуже отсутствия графика: две прямые у нижнего края
         выглядят как поломка. Нет счетов за период — карточку убираем совсем. */
      var invSec = $id('invSec');
      if (invSec) invSec.hidden = !CUR.invN;
      var inv = $id('invLines');
      var ib = byStep(CUR.invByDay), pb = byStep(CUR.payByDay);
      var keys = {};
      ib.concat(pb).forEach(function(r){ keys[r.key] = r.m; });
      var ks = Object.keys(keys).sort();
      if (!ks.length){
        inv.innerHTML = '<text x="12" y="74">за этот период счетов не выставляли</text>';
      } else {
        var mi = {}, mp = {};
        ib.forEach(function(r){ mi[r.key] = r.v; });
        pb.forEach(function(r){ mp[r.key] = r.v; });
        twoLines(inv, ks.map(function(k){ return {m: keys[k], a: mi[k] || 0, b: mp[k] || 0}; }), '#2F6BFF', '#18A957');
      }
    }

    function renderLadder(){
      var d = CUR, launch = state.scope === 'launch';
      $id('ladHint').textContent = periodWords();
      var steps = launch ? [
        {t: 'Зарегистрировались на интенсив', s: 'оставили заявку на эфир', n: d.regs},
        {t: 'Смотрели эфир', s: 'открыли трансляцию хотя бы раз', n: d.watched},
        {t: 'Оставили контакт', s: 'карточка с телефоном, почтой или телеграмом', n: d.leads},
        {t: 'Записались к тьютору-диагносту', s: 'выбрали время разбора', n: d.signed},
        {t: 'Разбор состоялся', s: 'встреча прошла', n: d.meeting},
        {t: 'Получили счет', s: 'счет выставлен', n: d.invN},
        {t: 'Оплатили', s: 'деньги пришли', n: d.payers}
      ] : [
        {t: 'Лиды', s: 'люди, оставившие контакт', n: d.leads},
        {t: 'Начали бесплатную диагностику', s: 'вошли в воронку теста в боте', n: d.diagStart},
        {t: 'Завершили диагностику', s: 'дошли до результата', n: d.diagDone},
        {t: 'Записались к тьютору-диагносту', s: 'выбрали время разбора', n: d.signed},
        {t: 'Разбор состоялся', s: 'встреча прошла', n: d.meeting},
        {t: 'Получили счет', s: 'счет выставлен', n: d.invN},
        {t: 'Оплатили', s: 'деньги пришли', n: d.payers}
      ];
      var base = (launch ? d.regs : d.leads) || 1;
      var baseWord = launch ? '% от регистраций' : '% от лидов';
      $id('lad').innerHTML = steps.map(function(s, i){
        var share = Math.round(s.n / base * 100);
        return '<div class="lad-row' + (s.n ? '' : ' dead') + '">' +
          '<div class="lad-t">' + s.t + '<span>' + s.s + '</span></div>' +
          '<div class="lad-n">' + (s.n ? num(s.n) : '—') +
          (i && !s.wide ? '<em>' + share + baseWord + '</em>' : '') + '</div>' +
          '<div class="lad-bar"><i style="width:' + Math.min(100, Math.max(s.n ? 1.5 : 0, share)) + '%"></i></div></div>';
      }).join('');

      /* Запуск без единой оплаты — это не ноль продаж, а разорванная связь: человек,
         купивший после интенсива, заведен в CRM отдельной карточкой. Молчать об этом
         нельзя, иначе экран читается как «интенсив не принес ничего». */
      var warn = $id('ladWarn');
      var note = $id('ladNote');
      if (note) note.hidden = !launch;
      /* Ступень, которая больше предыдущей, читается как ошибка счета. Объясняем на
         месте, а не в раскрывашке на другой вкладке. */
      var grew = $id('ladGrew');
      if (grew){
        var bad = false;
        for (var i = 1; i < steps.length; i++) if (steps[i].n > steps[i - 1].n && !steps[i].wide) bad = true;
        grew.hidden = !bad;
      }
      if (launch && !d.invN && d.regs){
        warn.hidden = false;
        warn.innerHTML = '<span class="fl-l">Почему у запуска нет счетов на сопровождение</span>' +
          '<p style="margin:0">Оплаты, которые видно выше, — это билеты на интенсив. Людей экран уже склеивает: ' +
          'карточки с одним телефоном, почтой или мессенджером считаются одним человеком. Но у <b>карточек, на которые выставлены счета, ' +
          'контактов почти нет</b>: из пятнадцати счетов телефон записан у шести, почты нет ни у одного. Склеивать не по чему, ' +
          'и связь «пришел с интенсива — купил сопровождение» в базе не прослеживается. ' +
          'Чинится в CRM: счет не выставляется, пока в карточке нет телефона или почты.</p>';
      } else warn.hidden = true;
    }

    function sortedEntries(obj, key){
      return Object.keys(obj).map(function(k){ var v = obj[k]; v.key = k; return v; })
        .sort(function(x, y){ return y[key] - x[key]; });
    }
    function cell(label, val, cls){
      return '<td class="' + (cls || '') + '" data-l="' + label + '">' + val + '</td>';
    }

    function renderSources(){
      var list = sortedEntries(CUR.doors, 'n');
      var tot = {n: 0, utm: 0, signed: 0, meeting: 0, inv: 0, paid: 0, rub: 0};
      list.forEach(function(r){ ['n','utm','signed','meeting','inv','paid','rub'].forEach(function(k){ tot[k] += r[k]; }); });
      var head = '<thead><tr><th>Через какую дверь зашел</th><th class="r">Лидов</th><th class="r">С меткой</th>' +
                 '<th class="r">Записались</th><th class="r">Разбор</th><th class="r">Счетов</th><th class="r">Оплат</th><th class="r">Выручка</th></tr></thead>';
      function row(name, note, r, cls){
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' +
          '<td data-l="Дверь">' + name + (note ? '<span class="sub">' + note + '</span>' : '') + '</td>' +
          cell('Лидов', num(r.n), 'r num') +
          cell('С меткой', r.utm ? num(r.utm) + '<span class="sub">' + Math.round(r.utm / r.n * 100) + '%</span>' : '—', 'r num') +
          cell('Записались', r.signed || '—', 'r num') + cell('Разбор', r.meeting || '—', 'r num') +
          cell('Счетов', r.inv || '—', 'r num') + cell('Оплат', r.paid || '—', 'r num') +
          cell('Выручка', r.rub ? rub(r.rub) : '—', 'r num') + '</tr>';
      }
      $id('src').innerHTML = head + '<tbody>' +
        list.map(function(r){ return row(r.key, r.note, r); }).join('') +
        (list.length ? row('Всего', '', tot, 'total') : '') + '</tbody>' ;
      if (!list.length) $id('src').innerHTML = head + '<tbody><tr><td colspan="8">За этот период лидов не было.</td></tr></tbody>';

      var u = sortedEntries(CUR.utm, 'n');
      var c = sortedEntries(CUR.camps, 'n');
      $id('utm').innerHTML =
        '<thead><tr><th>Рекламная метка</th><th class="r">Лидов</th><th class="r">Записались</th><th class="r">Разбор</th><th class="r">Оплат</th><th class="r">Выручка</th></tr></thead><tbody>' +
        (u.length ? u.map(function(r){
          return '<tr><td data-l="Метка">' + (r.key === '(без метки)' ? '<span class="muted">без метки</span>' : r.key) + '</td>' +
            cell('Лидов', num(r.n), 'r num') + cell('Записались', r.signed || '—', 'r num') +
            cell('Разбор', r.meeting || '—', 'r num') + cell('Оплат', r.paid || '—', 'r num') +
            cell('Выручка', r.rub ? rub(r.rub) : '—', 'r num') + '</tr>';
        }).join('') : '<tr><td colspan="6">За этот период лидов не было.</td></tr>') + '</tbody>';

      $id('camp').innerHTML =
        '<thead><tr><th>Кампания</th><th class="r">Лидов</th><th class="r">Оплат</th><th class="r">Выручка</th></tr></thead><tbody>' +
        (c.length ? c.map(function(r){
          return '<tr><td data-l="Кампания">' + (r.key === '(без кампании)' ? '<span class="muted">без кампании</span>' : r.key) + '</td>' +
            cell('Лидов', num(r.n), 'r num') + cell('Оплат', r.paid || '—', 'r num') +
            cell('Выручка', r.rub ? rub(r.rub) : '—', 'r num') + '</tr>';
        }).join('') : '<tr><td colspan="4">За этот период лидов не было.</td></tr>') + '</tbody>';
    }

    /* Когорты на одном месяце — это одна строка, сравнивать нечего. Поэтому таблица
       всегда берет не меньше полугода: период сужает ее только тогда, когда он сам
       шире. Фильтр запуска при этом работает как везде. */
    function cohRange(){
      var from = state.from, wide = shift(state.to, -182);
      return [from < wide ? from : wide, state.to];
    }
    function renderCohorts(){
      var cr = cohRange();
      var C = (cr[0] === state.from && cr[1] === state.to) ? CUR : agg(cr[0], cr[1]);
      var ks = Object.keys(C.cohorts).sort();
      var tot = {leads: 0, signed: 0, meeting: 0, inv: 0, paid: 0, rub: 0};
      ks.forEach(function(k){ var r = C.cohorts[k]; Object.keys(tot).forEach(function(f){ tot[f] += r[f]; }); });
      function row(name, r, cls){
        var cv = r.leads ? (r.paid / r.leads * 100).toFixed(1).replace('.', ',') + '%' : '—';
        return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td data-l="Месяц прихода">' + name + '</td>' +
          cell('Лидов', r.leads || '—', 'r num') + cell('Записались', r.signed || '—', 'r num') +
          cell('Разбор', r.meeting || '—', 'r num') + cell('Счетов', r.inv || '—', 'r num') +
          cell('Заплатили', r.paid || '—', 'r num') + cell('Выручка', r.rub ? rub(r.rub) : '—', 'r num') +
          cell('В оплату', cv, 'r num') + '</tr>';
      }
      $id('coh').innerHTML =
        '<thead><tr><th>Месяц прихода</th><th class="r">Лидов</th><th class="r">Записались</th><th class="r">Разбор</th>' +
        '<th class="r">Счетов</th><th class="r">Заплатили</th><th class="r">Выручка</th><th class="r">В оплату</th></tr></thead><tbody>' +
        (ks.length ? ks.map(function(k){ return row(monthName(k), C.cohorts[k]); }).join('') + row('Итого', tot, 'total')
                   : '<tr><td colspan="8">За этот период лидов не было.</td></tr>') + '</tbody>';

      var tail = $id('cohNote');
      var wider = cr[0] !== state.from;
      tail.innerHTML = (wider
          ? 'Таблица показывает <b>' + human(cr[0]) + ' — ' + human(cr[1]) + '</b>: на одном месяце когорты сравнивать не с чем, поэтому берется не меньше полугода. '
          : '') +
        'Деньги в строке — все, что человек заплатил <b>когда-либо</b>, даже если платеж пришел позже. Поэтому сумма не совпадает с выручкой на главной: там деньги считаются по дню поступления.';
    }

    function renderProducts(){
      var list = sortedEntries(CUR.prods, 'inv');
      $id('prod').innerHTML =
        '<thead><tr><th>Продукт</th><th class="r">Счетов</th><th class="r">Выставлено</th><th class="r">Оплачено</th><th>Тариф</th></tr></thead><tbody>' +
        (list.length ? list.map(function(r){
          var offer = OFFERS[r.key];
          return '<tr><td data-l="Продукт">' + prodName(r.key, r.title) + '</td>' +
            cell(offer ? 'Покупок' : 'Счетов', r.n, 'r num') +
            cell('Выставлено', offer ? '—' : rub(r.inv), 'r num') +
            cell('Оплачено', r.paid ? rub(r.paid) : '—', 'r num') +
            '<td data-l="Тариф"><span class="chip ' + (offer ? 'neutral' : r.tariff ? 'ok' : 'wait') + '">' +
            (offer ? 'через кассу' : r.tariff ? 'выбран' : 'не выбран') + '</span><span class="chip-note">' +
            (offer ? 'оплата сразу на сайте, счет не выставлялся'
                   : r.tariff ? 'тариф взят из списка' : 'название вписано руками') + '</span></td></tr>';
        }).join('') : '<tr><td colspan="5">За этот период счетов не выставляли.</td></tr>') + '</tbody>';
    }

    function renderDiag(){
      var d = CUR;
      var rowsD = [
        ['Начали бесплатную диагностику', 'вошли в воронку теста в боте', d.diagStart, 0],
        ['Завершили бесплатную диагностику', 'дошли до результата', d.diagDone, 0],
        ['Записались на разбор к тьютору-диагносту', 'выбрали время', d.signed, 0],
        ['Разбор состоялся', 'людей, у кого встреча прошла', d.meeting, 0],
        ['Дошли до счета', 'счет выставлен', d.invN, 0],
        ['Оплатили', 'деньги пришли', d.payers, d.revenue]
      ];
      /* Тот же рецепт лестницы, что на «Итогах»: одна и та же сущность не должна
         выглядеть двумя разными компонентами. */
      var base = d.diagStart || d.leads || 1;
      $id('diag').innerHTML = rowsD.map(function(r, i){
        var share = Math.round(r[2] / base * 100);
        return '<div class="lad-row' + (r[2] ? '' : ' dead') + '">' +
          '<div class="lad-t">' + r[0] + '<span>' + r[1] + '</span></div>' +
          '<div class="lad-n">' + (r[2] ? num(r[2]) : '—') +
          (r[3] ? '<em>' + rub(r[3]) + '</em>' : (i ? '<em>' + share + '% от начавших</em>' : '')) + '</div>' +
          '<div class="lad-bar"><i style="width:' + Math.min(100, Math.max(r[2] ? 1.5 : 0, share)) + '%"></i></div></div>';
      }).join('');

      var s2 = CUR.srok, names = ['В день обращения', '1–7 дней', '8 дней и дольше', 'Оплата раньше карточки'];
      var notes = ['', '', '', 'клиент пришел не через платформу, карточку завели после оплаты'];
      $id('srok').innerHTML =
        '<thead><tr><th>Сколько прошло</th><th class="r">Оплат</th></tr></thead><tbody>' +
        s2.map(function(n, i){
          return '<tr><td data-l="Сколько прошло">' + names[i] +
            (notes[i] ? '<span class="sub">' + notes[i] + '</span>' : '') + '</td>' +
            '<td class="r num" data-l="Оплат">' + (n || '—') + '</td></tr>';
        }).join('') + '</tbody>';
    }

    /* Средний чек, а не сумма дня: сумма уже стоит столбиками выше, и две одинаковые
       картинки на одном экране — повод не верить ни одной. */
    function renderLines(){
      var sum = byStep(CUR.payByDay), cnt = byStep(CUR.payCntByDay);
      var el = $id('checkLine');
      if (!sum.length){ el.innerHTML = '<text x="12" y="74">за этот период денег не приходило</text>'; return; }
      var by = {};
      cnt.forEach(function(r){ by[r.key] = r.v; });
      line(el, sum.map(function(r){ return {m: r.m, v: Math.round(r.v / (by[r.key] || 1))}; }), '#1C2B4A', kk);
    }

    /* ── Период: быстрые кнопки и календарь ─────────────────────────────────── */
    function monthStart(iso){ return iso.slice(0, 8) + '01'; }
    function monthEnd(iso){
      var d = new Date(iso.slice(0, 8) + '01');
      d.setMonth(d.getMonth() + 1); d.setDate(0);
      return d.toISOString().slice(0, 10);
    }
    function presetRange(p){
      if (p === 'm30') return [shift(TODAY, -29), TODAY];
      if (p === 'cur') return [monthStart(TODAY), TODAY];
      if (p === 'prev'){ var pm = shift(monthStart(TODAY), -1); return [monthStart(pm), monthEnd(pm)]; }
      if (p === 'm6') return [shift(TODAY, -182), TODAY];
      return [FIRST, TODAY];
    }
    function setPeriod(p){
      var r = presetRange(p);
      state.preset = p; state.from = r[0]; state.to = r[1];
      syncBar();
    }
    function syncBar(){
      $all('#seg button').forEach(function(b){
        b.setAttribute('aria-pressed', b.dataset.p === state.preset ? 'true' : 'false');
      });
      $all('#scope button').forEach(function(b){
        b.setAttribute('aria-pressed', b.dataset.s === state.scope ? 'true' : 'false');
      });
      $id('dFrom').value = state.from;
      $id('dTo').value = state.to;
      $id('dHint').textContent = human(state.from) + ' — ' + human(state.to);
    }
    function periodWords(){
      if (state.from === FIRST && state.to === TODAY) return 'все время';
      if (monthOf(state.from) === monthOf(state.to) &&
          state.from === monthStart(state.from) && state.to === monthEnd(state.to))
        return monthName(monthOf(state.from));
      return human(state.from) + ' — ' + human(state.to);
    }
    function renderNote(){
      var n = days(state.from, state.to);
      var p = prevRange();
      var txt = 'Смотрим <b>' + periodWords() + '</b>, это ' + n + ' дн.';
      txt += PRV ? ' Сравнение с предыдущими ' + n + ' дн.: ' + human(p[0]) + ' — ' + human(p[1]) + '.'
                 : ' Сравнивать не с чем: раньше данных нет.';
      if (state.scope === 'launch')
        txt += ' Считаем только людей <b>' + LAUNCH.title.toLowerCase() + '</b>: тех, кто регистрировался на эфир или пришел по ссылке запуска.';
      $id('fnote').innerHTML = txt;
      /* Подпись о снимке есть только на черновике: в CRM цифры живые, и подписывать
         нечего. */
      var sn = $id('snapNote');
      if (sn) sn.textContent =
        'Снимок базы ' + fullDate(SNAP.snap.slice(0, 10)) + ', ' + SNAP.snap.slice(11) + ' по Москве';
    }

    function render(){
      recalc();
      renderNote();
      renderKpis();
      renderCharts();
      renderLadder();
      renderSources();
      renderCohorts();
      renderProducts();
      renderDiag();
      renderLines();
    }

    $id('seg').addEventListener('click', function(e){
      var b = e.target.closest('button');
      if (!b) return;
      state.open = null;
      setPeriod(b.dataset.p);
      render();
    });
    $id('scope').addEventListener('click', function(e){
      var b = e.target.closest('button');
      if (!b) return;
      state.scope = b.dataset.s;
      state.open = null;
      if (state.scope === 'launch'){
        state.back = {preset: state.preset, from: state.from, to: state.to};
        state.preset = ''; state.from = LAUNCH.from; state.to = TODAY;
      } else if (state.back){
        state.preset = state.back.preset; state.from = state.back.from; state.to = state.back.to;
        state.back = null;
      }
      syncBar();
      render();
    });
    ['dFrom', 'dTo'].forEach(function(id){
      document.getElementById(id).addEventListener('change', function(){
        var f = $id('dFrom').value, t = $id('dTo').value;
        if (!f || !t) return;
        if (f > t){ var x = f; f = t; t = x; }
        state.from = f; state.to = t; state.preset = ''; state.open = null;
        syncBar();
        render();
      });
    });


    $id('kpis').addEventListener('click', function(e){
      var b = e.target.closest('.kpi');
      if (!b) return;
      openDrawer(state.open === b.dataset.k ? null : b.dataset.k, false);
    });

    var TABS = ['main', 'itogi', 'src', 'coh', 'prod', 'diag', 'gap'];
    $id('tabs').addEventListener('click', function(e){
      var b = e.target.closest('button');
      if (!b) return;
      state.tab = b.dataset.t;
      this.querySelectorAll('button').forEach(function(x){ x.setAttribute('aria-selected', x === b ? 'true' : 'false'); });
      TABS.forEach(function(t){ $id('tab-' + t).hidden = (t !== state.tab); });
      if (state.tab === 'main'){ renderCharts(); renderLines(); }
      window.scrollTo({top: 0, behavior: 'smooth'});
    });
    $id('tabs').addEventListener('keydown', function(e){
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var all = Array.prototype.slice.call(this.querySelectorAll('button'));
      var i = all.indexOf(document.activeElement);
      if (i < 0) return;
      e.preventDefault();
      var next = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      next.focus(); next.click();
    });

    /* Графики рисуются в пикселях элемента, поэтому при смене ширины их надо
       перерисовать: иначе после поворота телефона линия останется от прошлой. */
    var rsz;
    window.addEventListener('resize', function(){
      clearTimeout(rsz);
      rsz = setTimeout(function(){ renderCharts(); renderLines(); }, 150);
    });

    $id('dFrom').min = FIRST;
    $id('dFrom').max = TODAY;
    $id('dTo').min = FIRST;
    $id('dTo').max = TODAY;
    setPeriod('prev');
      render();

    /* ── Чего на экране нет: граница черновика ──────────────────────────────── */
    var GAP = [
      ['Клик по цифре — список людей за ней', 'нет', 'страница лежит в открытом интернете, контакты детей сюда не кладутся. В CRM список будет'],
      ['Стоимость лида и окупаемость по каналам', 'частично', 'считается там, где заведен расход. Сейчас в CRM заведена одна строка — 5 000 ₽ на ВК за 11 сентября; остальные траты никто не вносил'],
      ['Выручка запуска: кто из участников интенсива купил', 'нет', 'людей экран склеивает по телефону, почте и мессенджеру, но у карточек со счетами контактов почти нет: из пятнадцати счетов телефон записан у шести, почты нет ни у одного. Склеивать не по чему. Чинится в CRM правилом «нет контакта — нет счета»'],
      ['Диагностика в разрезе источника', 'нет', 'бесплатная диагностика живет в боте и к карточке человека пока не склеена: в лестнице она стоит отдельной ступенью, а по метке не раскладывается'],
      ['Вкладки «Отдел продаж», «Сегменты», «LTV» из макета', 'нет', 'у нас продает тьютор-диагност на разборе, а не отдел на обзвоне; подписок и повторных покупок нет, считать LTV не из чего'],
      ['Разбивка счетов по тарифам сопровождения', 'частично', 'три самых крупных счета выставлены без выбора тарифа — название вписано руками. Чинится правилом в CRM'],
      ['Живые цифры в реальном времени', 'нет', 'это снимок базы: он обновляется, когда я его переснимаю. Живым экран станет в CRM']
    ];
    function renderGap(){
      $id('gap').innerHTML =
        '<thead><tr><th>Что это</th><th class="r">Здесь</th><th>Почему</th></tr></thead><tbody>' +
        GAP.map(function(r){
          return '<tr><td data-l="Что это">' + r[0] + '</td>' +
            '<td class="r" data-l="Здесь"><span class="chip ' + (r[1] === 'нет' ? 'no' : 'wait') + '">' + r[1] + '</span></td>' +
            '<td data-l="Почему">' + r[2] + '</td></tr>';
        }).join('') + '</tbody>';
    }
      renderGap();
  }

  return {
    render: function (box, data) {
      box.innerHTML = '<div class="crosscut">' + TPL + '</div>';
      build(box.querySelector('.crosscut'), data);
    }
  };
})();
