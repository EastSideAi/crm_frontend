#!/usr/bin/env python3
"""Собирает дек в один самодостаточный HTML: стили и скрипт внутри файла.

Без сборщика и без внешних запросов — файл открывается двойным кликом и
работает офлайн, включая все расчеты на слайдах.
"""
import pathlib

HERE = pathlib.Path(__file__).parent
css = (HERE / "style.css").read_text(encoding="utf-8")
body = (HERE / "slides.html").read_text(encoding="utf-8")
js = (HERE / "deck.js").read_text(encoding="utf-8")

html = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Тьюторство 2026/27 — условия и работа</title>
<style>{css}</style>
</head><body>
<div id="bar"></div>
<div id="deck">
{body}
</div>
<div id="nav"><button id="prev">‹</button><button id="next">›</button></div>
<script>{js}</script>
</body></html>
"""
out = HERE / "tutor-deck.html"
out.write_text(html, encoding="utf-8")
n = body.count('<section class="slide')
print(f"{out} · {n} слайдов · {out.stat().st_size // 1024} КБ")
