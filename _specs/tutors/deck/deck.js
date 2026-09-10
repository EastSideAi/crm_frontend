/* Дек тьюторства: навигация и живые расчеты.
   Все цифры считаются формулами прямо на слайде, чтобы на встрече можно было
   подвигать ползунок и показать ответ, а не спорить о том, откуда взялось число. */
(function(){
var slides = [].slice.call(document.querySelectorAll('.slide'));
var bar = document.getElementById('bar'), pos = document.getElementById('pos'), cur = 0;

var fmt = function(v){ return Math.round(v).toLocaleString('ru-RU').replace(/ /g,' '); };
var fk  = function(v){ return v.toFixed(2).replace('.', ','); };

function show(i){
  i = Math.max(0, Math.min(slides.length - 1, i));
  slides[cur].classList.remove('on'); cur = i; slides[cur].classList.add('on');
  bar.style.width = ((i + 1) / slides.length * 100) + '%';
  var flow = slides[cur].querySelector('.flow[data-auto]');
  if (flow) {
    var cards = flow.querySelectorAll('.card');
    [].forEach.call(cards, function(c){ c.classList.remove('on'); });
    [].forEach.call(cards, function(c, n){ setTimeout(function(){ c.classList.add('on'); }, 240 + n * 320); });
  }
  if (slides[cur].id === 's-ladder') drawLadder();
  if (slides[cur].id === 's-chart') drawChart();
  location.hash = '#' + (i + 1);
}
document.addEventListener('keydown', function(e){
  if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') { show(cur + 1); e.preventDefault(); }
  if (e.key === 'ArrowLeft' || e.key === 'PageUp') { show(cur - 1); e.preventDefault(); }
  if (e.key === 'Home') show(0);
  if (e.key === 'End') show(slides.length - 1);
  if (e.key === 'f') { document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
});
document.addEventListener('click', function(e){
  if (e.target.closest('input,button,.pt,.st,.lseg')) return;
  show(cur + (e.clientX < innerWidth * 0.25 ? -1 : 1));
});
document.getElementById('prev').onclick = function(e){ e.stopPropagation(); show(cur - 1); };
document.getElementById('next').onclick = function(e){ e.stopPropagation(); show(cur + 1); };
var nav = document.getElementById('nav'), navT;
document.addEventListener('mousemove', function(){
  nav.classList.add('show'); clearTimeout(navT);
  navT = setTimeout(function(){ nav.classList.remove('show'); }, 2200);
});

/* --- s10: сквозной пример --- */
var CASE = [
 'Первая встреча в сентябре. <b>А:</b> два вуза, где по профилю Артема шанс на полный грант выше половины. <b>Б:</b> три запасных. <b>С:</b> два, куда возьмут почти наверняка. План усиления: <b>HSK4 к декабрю</b>, CSCA по математике к февралю, олимпиада по физике. Семья слышит план на плохой сценарий сразу, а не в мае.',
 'К декабрю HSK4 сдан на 210 баллов, план выполнен. Пакет документов агент собрал сам, Артем догрузил справку из школы. Вы открыли экран приемки, вернули на исправление мотивационное письмо, второй вариант приняли. <b>Точка закрыта в срок</b>, деньги ушли в тот же день.',
 'Февраль. Пять заявок: два вуза уровня А, три уровня Б. Все проверены и подтверждены вами, ни одна не вернулась из вуза. Одна заявка зависла на две недели, вы позвонили в приемную комиссию, и ее подняли за день. Это ровно та работа, которую система не заберет.',
 'Май. Артем зачислен в вуз уровня А. В письме: <b>обучение покрыто полностью, стипендии нет</b>. Коэффициент 0,85. Значит за результат идет 15 000 × 0,85 = <b>12 750 ₽</b>. Полный грант дал бы 15 000. Разницу в 2 250 ₽ решает то, куда вы целились в сентябре.',
 'Сентябрь. Виза, билеты, регистрация по прилету, заселение. Через месяц вы связались с Артемом: осваивается, занятия идут. <b>Раньше эти 15 процентов платились по JW202</b>, и после него отвечать было незачем. Теперь они привязаны к тому, что ученик доехал.'
];
var tl = document.getElementById('tl'), tlb = document.getElementById('tlb');
if (tl) {
  var pick = function(i){
    [].forEach.call(tl.children, function(s, n){ s.classList.toggle('on', n === i); });
    tlb.innerHTML = '<p class="q">' + CASE[i] + '</p>';
  };
  [].forEach.call(tl.children, function(s, n){ s.onclick = function(e){ e.stopPropagation(); pick(n); }; });
  pick(0);
}

/* --- s14: контрольные точки --- */
[].forEach.call(document.querySelectorAll('.pt'), function(p){
  p.onclick = function(e){
    e.stopPropagation();
    var was = p.classList.contains('open');
    [].forEach.call(document.querySelectorAll('.pt'), function(x){ x.classList.remove('open'); });
    if (!was) p.classList.add('open');
  };
});

/* --- s16: вовлеченность --- */
var mets = document.getElementById('mets');
if (mets) {
  var recalc = function(){
    var score = 0;
    [].forEach.call(mets.querySelectorAll('.met'), function(m){
      score += (+m.dataset.w) * (+m.querySelector('input').value) / 100;
    });
    var k = score >= 90 ? 1 : score >= 80 ? 0.95 : score >= 70 ? 0.9 : score >= 55 ? 0.8 : 0.7;
    document.getElementById('engScore').textContent = Math.round(score);
    document.getElementById('engK').textContent = fk(k);
    document.getElementById('engMoney').textContent = fmt(30000 * k);
  };
  [].forEach.call(mets.querySelectorAll('input'), function(i){ i.oninput = recalc; });
  recalc();
}

/* --- s17: лестница --- */
var LAD = [
  ['1,00', 'Полное покрытие, вуз уровня А', 1],
  ['0,90', 'Полное покрытие, вуз Б или С', 0.9],
  ['0,85', 'Покрыто обучение, без стипендии', 0.85],
  ['0,70', 'Скидка от 50 до 99 процентов', 0.7],
  ['0,50', 'Скидка до 50 процентов', 0.5],
  ['0,25', 'Целились в грант, ушел на платное', 0.25],
  ['0,00', 'Не поступил никуда', 0]
];
var dvol = 1, ladder = document.getElementById('ladder');
function drawLadder(){
  if (!ladder) return;
  ladder.innerHTML = LAD.map(function(r, n){
    var v = (15000 + 15000 * r[2]) * dvol;
    return '<div class="lrow' + (n === 0 ? ' top' : '') + '"><div class="lab">' + r[1] +
      '</div><div class="track"><div class="bar" data-w="' + (v / 30000 * 100) +
      '"></div></div><div class="val">' + fmt(v) + '</div></div>';
  }).join('');
  requestAnimationFrame(function(){
    [].forEach.call(ladder.querySelectorAll('.bar'), function(b, n){
      setTimeout(function(){ b.style.width = b.dataset.w + '%'; }, n * 70);
    });
  });
}
var lseg = document.getElementById('lseg');
if (lseg) [].forEach.call(lseg.children, function(b){
  b.onclick = function(e){
    e.stopPropagation();
    [].forEach.call(lseg.children, function(x){ x.classList.remove('on'); });
    b.classList.add('on'); dvol = +b.dataset.d; drawLadder();
  };
});

/* --- s18: график роста --- */
/* Модель честная и разбирается по строкам:
   средняя ставка при полной вовлеченности 25 783 (реальная смесь грантов
   этого года), две консультации по 3 000, процент с доведенного договора
   Плюс 3,2% от 299 990 = 9 600. Старые условия: 33 000 за ученика, и все. */
var RATE = 25783, CONS = 6000, SALE = 9600, OLD = 33000, YMAX = 1900000;
var svg = document.getElementById('svg'), chSale = 1;
var X = function(n){ return 60 + n / 45 * 920; }, Y = function(v){ return 400 - v / YMAX * 380; };
function drawChart(){
  if (!svg) return;
  var k = (+document.getElementById('chK').value) / 100;
  var n = +document.getElementById('chN').value;
  var per = Math.round(RATE * k) + CONS + (chSale ? SALE : 0);
  var pNew = '', pOld = '', area = 'M60,400 ';
  for (var i = 0; i <= 45; i++) {
    pNew += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(per * i).toFixed(1);
    pOld += (i ? ' L' : 'M') + X(i).toFixed(1) + ',' + Y(OLD * i).toFixed(1);
    area += 'L' + X(i).toFixed(1) + ',' + Y(per * i).toFixed(1) + ' ';
  }
  area += 'L' + X(45).toFixed(1) + ',400 Z';
  var g = '';
  [0, 500000, 1000000, 1500000].forEach(function(v){
    g += '<line class="grid" x1="60" x2="980" y1="' + Y(v) + '" y2="' + Y(v) + '"/>' +
         '<text class="axis" x="0" y="' + (Y(v) + 5) + '">' + (v ? String(v / 1000000).replace('.', ',') + ' млн' : '0') + '</text>';
  });
  [10, 20, 30, 40].forEach(function(v){
    g += '<text class="axis" x="' + X(v) + '" y="418" text-anchor="middle">' + v + '</text>';
  });
  svg.innerHTML = '<defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="rgba(43,143,255,.22)"/><stop offset="1" stop-color="rgba(43,143,255,0)"/>' +
    '</linearGradient></defs>' + g +
    '<path class="area" d="' + area + '"/><path class="old" d="' + pOld + '"/><path class="new" d="' + pNew + '"/>' +
    '<circle class="dot" cx="' + X(n) + '" cy="' + Y(per * n) + '" r="7"/>' +
    '<text class="dlab" x="' + X(n) + '" y="' + (Y(per * n) - 20) + '" text-anchor="middle">' + fmt(per * n) + ' ₽</text>';
  document.getElementById('chSum').textContent = fmt(per * n);
  document.getElementById('chMonth').textContent = fmt(per * n / 12) + ' ₽ в месяц';
  var diff = (per - OLD) * n, v = document.getElementById('chVerdict');
  v.className = 'verdict ' + (diff >= 0 ? 'up' : 'down');
  v.textContent = diff >= 0
    ? 'выше старых условий на ' + fmt(diff) + ' ₽ за сезон'
    : 'ниже старых условий на ' + fmt(-diff) + ' ₽. Продажи это добирают';
  document.getElementById('chNlab').textContent = n;
  document.getElementById('chKlab').textContent = fk(k);
  document.getElementById('chLegend').innerHTML =
    '<span><i></i>новые условия</span><span><i class="old"></i>старые, 33 000 за ученика</span>';
  var brk = '<li><span>Ставки за ' + n + ' учеников</span><span>' + fmt(Math.round(RATE * k) * n) + '</span></li>' +
            '<li><span>Консультации, две на ученика</span><span>' + fmt(CONS * n) + '</span></li>';
  if (chSale) brk += '<li><span>Процент с договоров</span><span>' + fmt(SALE * n) + '</span></li>';
  brk += '<li><span>Было по старым условиям</span><span>' + fmt(OLD * n) + '</span></li>';
  document.getElementById('chBrk').innerHTML = brk;
}
if (svg) {
  document.getElementById('chN').oninput = drawChart;
  document.getElementById('chK').oninput = drawChart;
  var chSeg = document.getElementById('chSeg');
  [].forEach.call(chSeg.children, function(b){
    b.onclick = function(e){
      e.stopPropagation();
      [].forEach.call(chSeg.children, function(x){ x.classList.remove('on'); });
      b.classList.add('on'); chSale = +b.dataset.s; drawChart();
    };
  });
}

show(parseInt((location.hash || '#1').slice(1), 10) - 1 || 0);
})();
