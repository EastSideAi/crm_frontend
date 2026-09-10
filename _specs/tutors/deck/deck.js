/* Каркас урока: чипсы разделов, вкладки, вписывание холста 1920x1080 в кадр,
   навигация и живые расчеты на слайдах. Все цифры считаются формулами прямо
   в браузере, чтобы на встрече можно было подвигать ползунок, а не спорить. */
var RATE = 25783, CONS = 6000, SALE = 9600, OLD = 33000, YMAX = 1900000;
var fmt = function(v){ return Math.round(v).toLocaleString('ru-RU').replace(/ /g,' '); };
var fk = function(v){ return v.toFixed(2).replace('.', ','); };

/* ---------- вкладки ---------- */
(function(){
  var tabs = [].slice.call(document.querySelectorAll('.tab'));
  tabs.forEach(function(t){
    t.addEventListener('click', function(){
      tabs.forEach(function(x){
        var on = x === t;
        x.setAttribute('aria-selected', String(on));
        document.getElementById(x.getAttribute('aria-controls')).hidden = !on;
      });
      window.dispatchEvent(new Event('resize'));
    });
  });
})();

/* ---------- слайды ---------- */
(function(){
  var slides = [].slice.call(document.querySelectorAll('.slide'));
  var chips = [].slice.call(document.querySelectorAll('.chip'));
  var i = 0;
  var elNow = document.querySelector('.meta .now'), elPart = document.querySelector('.meta .part');
  var elCount = document.querySelector('.count'), elFill = document.querySelector('.track i');
  var prev = document.getElementById('prev'), next = document.getElementById('next');
  var scaler = document.querySelector('.scaler'), frame = document.querySelector('.frame');

  var viewer = document.querySelector('.viewer');
  function fit(){
    // кадр 16:9 должен помещаться в окно целиком, иначе панель навигации уезжает вниз
    var cs = getComputedStyle(viewer), availH;
    if (document.fullscreenElement) {
      availH = viewer.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    } else {
      var below = document.querySelector('.track').offsetHeight +
                  document.querySelector('.bar').offsetHeight + 8;
      availH = window.innerHeight - viewer.getBoundingClientRect().top -
               parseFloat(cs.paddingTop) - below;
    }
    if (availH > 120) frame.style.maxWidth = Math.floor(availH * 16 / 9) + 'px';
    var w = frame.clientWidth, h = frame.clientHeight;
    var k = Math.min(w / 1920, h / 1080);
    scaler.style.transform = 'scale(' + k + ')';
    scaler.style.left = Math.max(0, (w - 1920 * k) / 2) + 'px';
    scaler.style.top = Math.max(0, (h - 1080 * k) / 2) + 'px';
  }
  window.addEventListener('resize', fit);

  function replay(el){
    var kids = el.querySelectorAll('.rise, .rule, .glow');
    for (var k = 0; k < kids.length; k++){
      var n = kids[k], a = n.style.animationName;
      n.style.animationName = 'none'; void n.offsetWidth; n.style.animationName = a || '';
    }
  }

  function show(n){
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function(s, k){ s.classList.toggle('on', k === i); });
    var s = slides[i];
    replay(s);
    elNow.textContent = s.dataset.title;
    elPart.textContent = s.dataset.part;
    elCount.textContent = (i + 1) + ' из ' + slides.length;
    elFill.style.width = ((i + 1) / slides.length * 100) + '%';
    prev.disabled = i === 0; next.disabled = i === slides.length - 1;
    chips.forEach(function(c){ c.setAttribute('aria-current', String(c.dataset.part === s.dataset.part)); });
    var ch = s.querySelector('.chain.auto');
    if (ch) {
      var st = ch.querySelectorAll('.st');
      [].forEach.call(st, function(x){ x.classList.remove('lit'); });
      [].forEach.call(st, function(x, k){ setTimeout(function(){ x.classList.add('lit'); }, 500 + k * 340); });
    }
    if (s.id === 's-ladder') drawLadder();
    if (s.id === 's-chart') drawChart();
    location.hash = '#' + (i + 1);
  }
  window.__show = show;

  prev.addEventListener('click', function(){ show(i - 1); });
  next.addEventListener('click', function(){ show(i + 1); });
  document.getElementById('full').addEventListener('click', function(){
    var v = document.querySelector('.viewer');
    if (document.fullscreenElement) document.exitFullscreen();
    else if (v.requestFullscreen) v.requestFullscreen().then(fit).catch(function(){});
  });
  document.addEventListener('fullscreenchange', function(){ setTimeout(fit, 60); });
  chips.forEach(function(c){
    c.addEventListener('click', function(){
      for (var k = 0; k < slides.length; k++) if (slides[k].dataset.part === c.dataset.part) return show(k);
    });
  });
  document.addEventListener('keydown', function(e){
    if (document.getElementById('view-slides').hidden) return;
    if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); show(i + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1); }
  });
  var x0 = null;
  frame.addEventListener('touchstart', function(e){ x0 = e.touches[0].clientX; }, {passive:true});
  frame.addEventListener('touchend', function(e){
    if (x0 === null) return;
    var dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 45) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  }, {passive:true});

  // пересчитываем после загрузки шрифтов: до нее панель ниже и кадр выходит шире окна
  fit();
  show(parseInt((location.hash || '#1').slice(1), 10) - 1 || 0);
  window.addEventListener('load', fit);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  setTimeout(fit, 400);
})();

/* ---------- сквозной пример ---------- */
(function(){
  var CASE = [
   'Первая встреча в сентябре. <b>А:</b> два вуза, где по профилю Артема шанс на полный грант выше половины. <b>Б:</b> три запасных. <b>С:</b> два, куда возьмут почти наверняка. План усиления: <b>HSK4 к декабрю</b>, CSCA по математике к февралю, олимпиада по физике.',
   'К декабрю HSK4 сдан на 210 баллов, план выполнен. Пакет документов агент собрал сам. Вы открыли экран приемки, вернули на исправление мотивационное письмо, второй вариант приняли. <b>Точка закрыта в срок</b>, деньги ушли в тот же день.',
   'Февраль. Пять заявок: два вуза уровня А, три уровня Б. Все проверены и подтверждены вами, ни одна не вернулась из вуза. Одна зависла на две недели, вы позвонили в приемную комиссию, и ее подняли за день.',
   'Май. Артем зачислен в вуз уровня А. В письме: <b>обучение покрыто полностью, стипендии нет</b>. Коэффициент 0,85, значит за результат идет 15 000 × 0,85 = <b>12 750 ₽</b>. Полный грант дал бы 15 000. Разницу решает то, куда вы целились в сентябре.',
   'Сентябрь. Виза, билеты, регистрация по прилету, заселение. Через месяц вы связались с Артемом: осваивается, занятия идут. <b>Раньше эти 15 процентов платились по JW202</b>, и после него отвечать было незачем.'
  ];
  var tl = document.getElementById('tl'), tlb = document.getElementById('tlb');
  if (!tl) return;
  function pick(k){
    [].forEach.call(tl.children, function(s, n){ s.classList.toggle('on', n === k); });
    tlb.innerHTML = '<p>' + CASE[k] + '</p>';
  }
  [].forEach.call(tl.children, function(s, n){ s.addEventListener('click', function(){ pick(n); }); });
  pick(0);
})();

/* ---------- контрольные точки ---------- */
[].forEach.call(document.querySelectorAll('.pt'), function(p){
  p.addEventListener('click', function(){
    var was = p.classList.contains('open');
    [].forEach.call(document.querySelectorAll('.pt'), function(x){ x.classList.remove('open'); });
    if (!was) p.classList.add('open');
  });
});

/* ---------- вовлеченность ---------- */
(function(){
  var mets = document.getElementById('mets');
  if (!mets) return;
  function kOf(score){
    return score >= 90 ? 1 : score >= 80 ? 0.95 : score >= 70 ? 0.9 : score >= 55 ? 0.8 : 0.7;
  }
  function recalc(){
    var score = 0;
    [].forEach.call(mets.querySelectorAll('.met'), function(m){
      score += (+m.dataset.w) * (+m.querySelector('input').value) / 100;
    });
    var k = kOf(score);
    document.getElementById('engScore').textContent = Math.round(score);
    document.getElementById('engK').textContent = fk(k);
    document.getElementById('engMoney').textContent = fmt(30000 * k);
  }
  [].forEach.call(mets.querySelectorAll('input'), function(x){ x.addEventListener('input', recalc); });
  recalc();
})();

/* ---------- лестница ---------- */
var LAD = [
  ['Полное покрытие, вуз уровня А', 1], ['Полное покрытие, вуз Б или С', 0.9],
  ['Покрыто обучение, без стипендии', 0.85], ['Скидка от 50 до 99 процентов', 0.7],
  ['Скидка до 50 процентов', 0.5], ['Целились в грант, ушел на платное', 0.25],
  ['Не поступил никуда', 0]
];
var dvol = 1;
function drawLadder(){
  var ladder = document.getElementById('ladder');
  if (!ladder) return;
  ladder.innerHTML = LAD.map(function(r, n){
    var v = (15000 + 15000 * r[1]) * dvol;
    return '<div class="lrow' + (n === 0 ? ' top' : '') + '"><div class="lab">' + r[0] +
      '</div><div class="trk"><i data-w="' + (v / 30000 * 100) + '"></i></div><div class="val">' +
      fmt(v) + '</div></div>';
  }).join('');
  requestAnimationFrame(function(){
    [].forEach.call(ladder.querySelectorAll('.trk i'), function(b, n){
      setTimeout(function(){ b.style.width = b.dataset.w + '%'; }, n * 70);
    });
  });
}
(function(){
  var lseg = document.getElementById('lseg');
  if (!lseg) return;
  [].forEach.call(lseg.children, function(b){
    b.addEventListener('click', function(){
      [].forEach.call(lseg.children, function(x){ x.classList.remove('on'); });
      b.classList.add('on'); dvol = +b.dataset.d; drawLadder();
    });
  });
})();

/* ---------- график роста ----------
   Средняя ставка при полной вовлеченности 25 783 (реальная смесь грантов этого
   года), две консультации по 3 000, процент с договора Плюс 3,2% = 9 600.
   Старые условия: 33 000 за ученика, и все. */
var X = function(n){ return 70 + n / 45 * 910; }, Y = function(v){ return 440 - v / YMAX * 410; };
function drawChart(){
  var svg = document.getElementById('svg');
  if (!svg) return;
  var k = (+document.getElementById('chK').value) / 100;
  var n = +document.getElementById('chN').value;
  var per = Math.round(RATE * k) + CONS + (chSale ? SALE : 0);
  var pNew = '', pOld = '', area = 'M70,440 ';
  for (var t = 0; t <= 45; t++){
    pNew += (t ? ' L' : 'M') + X(t).toFixed(1) + ',' + Y(per * t).toFixed(1);
    pOld += (t ? ' L' : 'M') + X(t).toFixed(1) + ',' + Y(OLD * t).toFixed(1);
    area += 'L' + X(t).toFixed(1) + ',' + Y(per * t).toFixed(1) + ' ';
  }
  area += 'L' + X(45).toFixed(1) + ',440 Z';
  var g = '';
  [0, 500000, 1000000, 1500000].forEach(function(v){
    g += '<line class="grid" x1="70" x2="980" y1="' + Y(v) + '" y2="' + Y(v) + '"/>' +
      '<text class="ax" x="0" y="' + (Y(v) + 7) + '">' +
      (v ? String(v / 1000000).replace('.', ',') + ' млн' : '0') + '</text>';
  });
  [10, 20, 30, 40].forEach(function(v){
    g += '<text class="ax" x="' + X(v) + '" y="472" text-anchor="middle">' + v + '</text>';
  });
  svg.innerHTML = '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="rgba(43,143,255,.22)"/><stop offset="1" stop-color="rgba(43,143,255,0)"/>' +
    '</linearGradient></defs>' + g +
    '<path class="area" d="' + area + '"/><path class="old" d="' + pOld + '"/><path class="new" d="' + pNew + '"/>' +
    '<circle class="dot" cx="' + X(n) + '" cy="' + Y(per * n) + '" r="9"/>' +
    '<text class="dlab" x="' + X(n) + '" y="' + (Y(per * n) - 26) + '" text-anchor="middle">' +
    fmt(per * n) + ' ₽</text>';
  document.getElementById('chSum').textContent = fmt(per * n);
  document.getElementById('chMonth').textContent = fmt(per * n / 12) + ' ₽ в месяц';
  var diff = (per - OLD) * n, v = document.getElementById('chVerdict');
  v.className = 'verdict ' + (diff >= 0 ? 'up' : 'down');
  v.textContent = diff >= 0 ? 'выше старых условий на ' + fmt(diff) + ' ₽ за сезон'
                            : 'ниже старых условий на ' + fmt(-diff) + ' ₽. Продажи это добирают';
  document.getElementById('chNlab').textContent = n;
  document.getElementById('chKlab').textContent = fk(k);
}
var chSale = 1;
(function(){
  if (!document.getElementById('svg')) return;
  document.getElementById('chN').addEventListener('input', drawChart);
  document.getElementById('chK').addEventListener('input', drawChart);
  var seg = document.getElementById('chSeg');
  [].forEach.call(seg.children, function(b){
    b.addEventListener('click', function(){
      [].forEach.call(seg.children, function(x){ x.classList.remove('on'); });
      b.classList.add('on'); chSale = +b.dataset.s; drawChart();
    });
  });
})();

/* ---------- калькулятор года ---------- */
(function(){
  var box = document.getElementById('calc');
  if (!box) return;
  var n = document.getElementById('cN'), k = document.getElementById('cK');
  var sale = 1, seg = document.getElementById('cSeg');
  [].forEach.call(seg.children, function(b){
    b.addEventListener('click', function(){
      [].forEach.call(seg.children, function(x){ x.setAttribute('aria-pressed', 'false'); });
      b.setAttribute('aria-pressed', 'true'); sale = +b.dataset.s; calc();
    });
  });
  function calc(){
    var N = +n.value, K = (+k.value) / 100;
    var base = Math.round(RATE * K) * N, cons = CONS * N, pct = sale ? SALE * N : 0;
    var total = base + cons + pct;
    document.getElementById('cNlab').textContent = N;
    document.getElementById('cKlab').textContent = fk(K);
    document.getElementById('cTotal').textContent = fmt(total) + ' ₽';
    document.getElementById('cMonth').textContent = fmt(total / 12) + ' ₽ в месяц · было по старым условиям ' + fmt(OLD * N) + ' ₽';
    document.getElementById('cBrk').innerHTML =
      '<li><span>Ставки за ' + N + ' учеников</span><b>' + fmt(base) + '</b></li>' +
      '<li><span>Консультации, две на ученика</span><b>' + fmt(cons) + '</b></li>' +
      (sale ? '<li><span>Процент с договоров по тарифу Плюс</span><b>' + fmt(pct) + '</b></li>' : '') +
      '<li><span>Разница со старыми условиями</span><b>' + (total - OLD * N >= 0 ? '+' : '') + fmt(total - OLD * N) + '</b></li>';
  }
  n.addEventListener('input', calc); k.addEventListener('input', calc);
  calc();
})();
