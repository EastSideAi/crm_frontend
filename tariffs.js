/* Мини-лендинг тарифов гранта.
   Данные берутся из того же content/portal.json, что и продуктовый портал: цены и
   состав правятся в одном месте и не могут разъехаться между CRM и страницей,
   которую кидают семье. Дублируется здесь только рисование карточки — тянуть
   app.js целиком ради трех блоков значит грузить всю CRM. Классы те же, что в
   портале, и стили приезжают из общего style.css: второй дизайн-системы у тарифов
   быть не должно.

   Чего тут намеренно НЕТ: гарантий (по протоколу встречи 03.09.2026 они не
   утверждены, а формулировка про пороги написана как обещание), способов оплаты
   (правила рассрочки тоже не утверждены) и экономики. Страницу можно переслать
   наружу, поэтому на ней только то, что уже можно обещать. */
(function () {
  var PRODUCT = 'grant';

  function ic(name, size) {
    var P = {
      path: '<path d="M3 16.5c4.5 0 4-5.5 7-6.5s3.5-4.5 7-4.5"/><circle cx="3" cy="16.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="5.5" r="1.5" fill="currentColor" stroke="none"/>',
      check: '<path d="M16 6l-8 8-4-4"/>',
      x: '<path d="M5 5l10 10M15 5L5 15"/>',
    };
    var s = size || 14;
    return '<svg width="' + s + '" height="' + s + '" viewBox="0 0 20 20" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (P[name] || '') + '</svg>';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtMoney(n) { return String(n || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

  /* ── те же правила этапов, что в портале ── */
  function stageIn(st, tid) {
    var o = st.only || [];
    return !o.length || o.indexOf(tid) !== -1;
  }
  function stageNo(sts, i) {
    if (sts[i].zero) return '00';
    var n = 0;
    for (var j = 0; j <= i; j++) if (!sts[j].zero) n++;
    return (n < 10 ? '0' : '') + n;
  }
  function realStages(sts) {
    return sts.filter(function (st) { return !st.zero; });
  }
  function stageOnly(p, st) {
    var o = st.only || [];
    if (!o.length) return '';
    return (p.tariffs || []).filter(function (t) { return o.indexOf(t.id) !== -1; })
      .map(function (t) { return t.name; }).join(' и ');
  }
  function inherit(p, st, tid, field) {
    var ts = p.tariffs || [], i = 0;
    for (; i < ts.length; i++) if (ts[i].id === tid) break;
    for (var j = i; j >= 0; j--) {
      var c = (st.cells || {})[ts[j].id];
      if (c && c[field]) return { text: c[field], own: j === i };
    }
    return { text: '', own: false };
  }
  function sideLede(p, sts, tid) {
    var name = function (st) { return (st.short || st.title).toLowerCase(); };
    sts = realStages(sts);
    var all = sts.length;
    sts = sts.filter(function (st) { return stageIn(st, tid); });
    var part = sts.length < all;
    var own = sts.filter(function (st) { return inherit(p, st, tid, 'who').text === 'семья сама'; });
    var both = sts.filter(function (st) {
      var w = inherit(p, st, tid, 'who').text;
      return w.indexOf('семья') !== -1 && w !== 'семья сама';
    });
    var head = part ? sts.length + ' из ' + all + ' этапов' : 'Все ' + all + ' этапов';
    if (own.length) return head + ', ' + own.length + ' из них семья делает сама: ' + own.map(name).join(' и ');
    if (both.length) return head + ' ведем мы, вместе с семьей только ' + both.map(name).join(' и ');
    return head + ' ведем мы';
  }

  function routeCard(p) {
    var r = p.route, sts = p.stages || [];
    if (!r || !sts.length) return '';
    var pts = sts.map(function (st, i) {
      var only = stageOnly(p, st);
      return '<div class="po-rt' + (only ? ' po-rt-only' : '') + (st.zero ? ' po-rt-zero' : '') + '">' +
        '<span class="po-rdot num">' + stageNo(sts, i) + '</span>' +
        '<span class="po-rtt">' + esc(st.short || st.title) + '</span></div>';
    }).join('');
    return '<div class="card po-card po-routec lp-route">' +
      '<div class="sec-head"><span class="ic">' + ic('path', 14) + '</span>' +
        '<div><div class="t">' + esc(r.title || '') + '</div>' +
        (r.sub ? '<div class="s">' + esc(r.sub) + '</div>' : '') + '</div></div>' +
      '<div class="po-routew"><div class="po-route">' + pts + '</div></div>' +
      (r.note || r.note_strong ? '<div class="po-lede">' + esc(r.note || '') +
        (r.note_strong ? ' <b>' + esc(r.note_strong) + '</b>' : '') + '</div>' : '') +
    '</div>';
  }

  function diffBlock(p, sts, t) {
    var sc = t.scope || {}, real = realStages(sts);
    var mine = real.filter(function (st) { return stageIn(st, t.id); }).length;
    return '<div class="po-scope">' +
      (sc.num ? '<b>' + esc(sc.num) + '</b>' : '') +
      (sc.cap ? '<small>' + esc(sc.cap) + '</small>' : '') +
      '<div class="po-tdrs">' +
        '<div class="po-tdr"><span>Этапов ведем мы</span><b class="num">' + mine + ' из ' + real.length + '</b></div>' +
        (t.ends ? '<div class="po-tdr"><span>Работа заканчивается</span><b>' + esc(t.ends) + '</b></div>' : '') +
      '</div></div>';
  }
  function addsBlock(t) {
    var a = t.adds;
    if (!a || !(a.items || []).length) return '';
    var label = a.from ? 'Все из тарифа «' + a.from + '», плюс' : (a.label || 'Что вы получаете');
    return '<div class="po-fsec po-tsec"><div class="po-flbl">' + esc(label) + '</div>' +
      '<div class="po-feats">' + a.items.map(function (it) {
        return '<div class="po-feat' + (a.from ? ' up' : '') + '">' +
          (a.from ? '<i>+</i>' : ic('check', 13)) + '<span>' + esc(it) + '</span></div>';
      }).join('') + '</div></div>';
  }
  /* Состав по этапам спрятан под раскрытие намеренно: шестнадцать строк в каждой
     из трех колонок — это та самая простыня, из-за которой карточки читались
     одинаково. Кому нужно подробно, тот откроет. */
  function stagesBlock(p, sts, t) {
    var rows = sts.map(function (st, i) {
      var num = '<span class="po-srn num">' + stageNo(sts, i) + '</span>';
      if (!stageIn(st, t.id)) {
        var miss = inherit(p, st, (st.only || [])[0], 'brief');
        return '<div class="po-sr po-off">' + num +
          '<span class="po-srb"><span class="po-srh"><b>' + esc(st.short || st.title) + '</b>' +
            '<span class="sev po-w po-w-only">только ' + esc(stageOnly(p, st)) + '</span></span>' +
            (miss.text ? '<span class="po-srt">' + esc(miss.text) + '</span>' : '') +
          '</span></div>';
      }
      var who = inherit(p, st, t.id, 'who').text, br = inherit(p, st, t.id, 'brief');
      var self = who.indexOf('семья') !== -1;
      var only = (st.only || []).length;
      return '<div class="po-sr' + (only ? ' po-only' : '') + '">' + num +
        '<span class="po-srb"><span class="po-srh"><b>' + esc(st.short || st.title) + '</b>' +
          (self ? '<span class="sev po-w po-w-self">' + esc(who) + '</span>' : '') + '</span>' +
          (br.text ? '<span class="po-srt">' + esc(br.text) + '</span>' : '') +
        '</span></div>';
    }).join('');
    return '<details class="lp-more"><summary>Весь состав по этапам</summary>' +
      '<div class="po-srlede">' + esc(sideLede(p, sts, t.id)) + '</div>' +
      '<div class="po-srs">' + rows + '</div></details>';
  }

  function cards(p) {
    var sts = p.stages || [];
    return '<div class="po-tariffs">' + (p.tariffs || []).map(function (t) {
      var full = t.price_full || 0, save = full - (t.price || 0);
      var nos = (t.excludes || []).map(function (f) {
        return '<div class="po-nofeat">' + ic('x', 13) + '<span>' + esc(f) + '</span></div>';
      }).join('');
      return '<div class="card po-tcard' + (t.accent ? ' accent' : '') + '">' +
        (t.accent ? '<span class="uz-tag uz-tag--rev po-tflag">основной</span>' : '') +
        '<div class="po-tname">' + esc(t.name) + '</div>' +
        '<div class="po-tpos">' + esc(t.positioning || '') + '</div>' +
        '<div class="po-tfmt">' + esc(t.formats || '') + '</div>' +
        '<div class="po-tpr">' +
          (full ? '<div class="po-told"><s class="num">' + fmtMoney(full) + ' ₽</s> без скидки</div>' : '') +
          '<div class="po-tprow"><span class="po-tprice num">' + fmtMoney(t.price) + ' ₽</span>' +
            (save > 0 ? '<span class="po-psave pill num">выгода ' + fmtMoney(save) + ' ₽</span>' : '') +
          '</div>' +
          (t.price_once ? '<div class="po-tonce">при оплате целиком <b class="num">' +
            fmtMoney(t.price_once) + ' ₽</b></div>' : '') +
        '</div>' +
        diffBlock(p, sts, t) +
        addsBlock(t) +
        stagesBlock(p, sts, t) +
        '<div class="po-fsec po-tsec"><div class="po-flbl">Не входит</div>' +
          (nos ? '<div class="po-feats">' + nos + '</div>'
               : '<div class="po-noall">' + esc(t.excludes_note || '') + '</div>') + '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function commonExcludes(p) {
    var exc = p.excludes_common || {};
    if (!(exc.items || []).length) return '';
    return '<div class="card po-card">' +
      '<div class="sec-head"><span class="ic">' + ic('x', 14) + '</span>' +
        '<div><div class="t">' + esc(exc.title || 'Не входит ни в один тариф') + '</div>' +
        (exc.sub ? '<div class="s">' + esc(exc.sub) + '</div>' : '') + '</div></div>' +
      '<div class="po-feats">' + exc.items.map(function (f) {
        return '<div class="po-nofeat">' + ic('x', 13) + '<span>' + esc(f) + '</span></div>';
      }).join('') + '</div></div>';
  }

  var root = document.getElementById('lp');
  fetch('content/portal.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var p = (d.products || []).filter(function (x) { return x.id === PRODUCT; })[0];
      if (!p) throw new Error('нет продукта');
      document.title = p.title + ' — тарифы ИстСайд';
      root.innerHTML =
        '<header class="lp-head">' +
          '<div class="lp-brand">ИстСайд</div>' +
          '<h1 class="lp-h1">' + esc(p.title) + '</h1>' +
          /* подзаголовок берем из landing.sub, а НЕ из note или lead: те написаны
             для команды («флагман», «продаем вероятность»), и на странице,
             которую пересылают семье, им не место */
          ((p.landing || {}).sub ? '<p class="lp-sub">' + esc(p.landing.sub) + '</p>' : '') +
        '</header>' +
        routeCard(p) + cards(p) + commonExcludes(p) +
        '<footer class="lp-foot">Цены действуют на дату просмотра страницы. ' +
          'Условия сопровождения фиксируются договором.</footer>';
    })
    .catch(function () {
      root.innerHTML = '<div class="card lp-err">Не удалось загрузить тарифы. ' +
        'Обновите страницу — если не помогло, напишите нам.</div>';
    });
})();
