#!/usr/bin/env python3
"""Собирает дек в один самодостаточный HTML: стили и скрипт внутри файла.

Каркас страницы повторяет формат урока истсайд.рф, без окна для спикера.
"""
import pathlib

HERE = pathlib.Path(__file__).parent
css = (HERE / "style.css").read_text(encoding="utf-8")
slides = (HERE / "slides.html").read_text(encoding="utf-8")
js = (HERE / "deck.js").read_text(encoding="utf-8")
n = slides.count('<section class="slide')

html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тьюторство 2026/27 — условия и работа</title>
<style>{css}</style>
</head><body>

<div class="top">
  <h1>Тьюторство 2026/27</h1>
  <span class="note">{n} слайдов к встрече команды. Условия предварительные, обсуждаем на встрече.</span>
</div>

<div class="tabs" role="tablist">
  <button class="tab" id="tab-slides" role="tab" aria-selected="true" aria-controls="view-slides">Слайды</button>
  <button class="tab" id="tab-calc" role="tab" aria-selected="false" aria-controls="view-calc">Калькулятор года</button>
</div>

<div class="view" id="view-slides" role="tabpanel" aria-labelledby="tab-slides">
  <div class="chips">
    <button class="chip" data-part="Начало">Начало</button>
    <button class="chip" data-part="Работа">Как устроена работа</button>
    <button class="chip" data-part="Деньги">Деньги тьютора</button>
    <button class="chip" data-part="Продажи">Продажи</button>
  </div>
  <div class="viewer">
    <div class="frame"><div class="scaler"><div class="canvas">
{slides}
    </div></div></div>
  </div>
  <div class="track"><i></i></div>
  <p class="hint">Слайды горизонтальные: поверни телефон или нажми кнопку «во весь экран».</p>
  <div class="bar">
    <div class="nav">
      <button id="prev" aria-label="Предыдущий слайд">&#8592;</button>
      <button id="next" aria-label="Следующий слайд">&#8594;</button>
      <button id="full" aria-label="Во весь экран" title="Во весь экран">&#9974;</button>
    </div>
    <div class="meta"><span class="now"></span><span class="part"></span></div>
    <span class="count"></span>
  </div>
</div>

<div class="view" id="view-calc" role="tabpanel" aria-labelledby="tab-calc" hidden>
  <div class="wide">
    <h2>Посчитайте свой сезон</h2>
    <p class="lead">Двигайте ползунки и смотрите, что выходит за год. Считается по той же формуле,
    что и на слайдах: средняя ставка по реальной смеси грантов этого года, две консультации на
    ученика и процент с доведенных договоров по тарифу Плюс.</p>
    <div class="calc" id="calc">
      <div class="calcbox">
        <h3>Ваша загрузка</h3>
        <div class="crow"><label>Учеников за сезон <b id="cNlab">20</b></label>
          <input type="range" id="cN" min="5" max="45" step="1" value="20"></div>
        <div class="crow"><label>Вовлеченность <b id="cKlab">0,90</b></label>
          <input type="range" id="cK" min="70" max="100" step="5" value="90"></div>
        <div class="seg" id="cSeg">
          <button class="opt" data-s="1" aria-pressed="true">продаю сам</button>
          <button class="opt" data-s="0" aria-pressed="false">только веду</button>
        </div>
      </div>
      <div class="calcbox">
        <h3>Выходит за сезон</h3>
        <div><div class="total" id="cTotal">776 100 ₽</div>
          <div class="total-cap" id="cMonth"></div></div>
        <ul class="brk" id="cBrk"></ul>
      </div>
    </div>
    <p class="warn">Условия предварительные. Цифры считаются от цен тарифов портала и от
    решений, которые мы обсуждаем на этой встрече.</p>
  </div>
</div>

<script>{js}</script>
</body></html>
"""
out = HERE / "tutor-deck.html"
out.write_text(html, encoding="utf-8")
print(f"{out} · {n} слайдов · {out.stat().st_size // 1024} КБ")
