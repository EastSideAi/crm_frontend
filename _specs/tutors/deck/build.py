#!/usr/bin/env python3
"""Собирает один самодостаточный HTML дека: стили, слайды и картинки в base64.

Почему один файл: Павел скачивает его из панели «Файлы» и открывает локально.
Папка с ассетами рядом там не переживет — качается по одному файлу.
Картинки жмутся в JPEG: четыре PNG по 2,5 МБ дали бы 14 МБ base64.
"""
import base64, io, pathlib, sys
from PIL import Image

HERE = pathlib.Path(__file__).parent
# Кадры серии лежат рядом с деком: .tmp чистится хуком, и пересобрать дек было бы нечем.
SRC = HERE / "assets"
IMGS = {n: f"{n}.jpg" for n in ("title", "work", "money", "sales", "end")}

def data_uri(p: pathlib.Path) -> str:
    im = Image.open(p).convert("RGB")
    im.thumbnail((1536, 1536), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=84, optimize=True, progressive=True)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()

missing = [n for n, f in IMGS.items() if not (SRC / f).exists()]
if missing:
    sys.exit("нет картинок: " + ", ".join(missing))

css = (HERE / "style.css").read_text(encoding="utf-8")
slides = (HERE / "slides.html").read_text(encoding="utf-8")
uris = {n: data_uri(SRC / f) for n, f in IMGS.items()}
for name, uri in uris.items():
    slides = slides.replace(f'data-img="{name}"', f'style="background-image:url({uri})"')

LADDER = [("Полное покрытие, вуз уровня А", 1.00), ("Полное покрытие, Б или С", 0.90),
          ("Покрыто обучение, без стипендии", 0.85), ("Скидка 50—99%", 0.70),
          ("Скидка до 50%", 0.50), ("Целились в грант, ушел на платное", 0.25),
          ("Не поступил никуда", 0.00)]
ladder_js = "[" + ",".join(f'["{n}",{k}]' for n, k in LADDER) + "]"

html = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>Тьюторство 2026/27 — условия и работа</title>
<style>{css}</style></head><body>
<div id="stage"><div id="deck">{slides}</div></div>
<div id="nav"><button id="prev">←</button><button id="next">→</button><span id="pos"></span></div>
<script>
var deck=document.getElementById('deck'),slides=[].slice.call(deck.querySelectorAll('.slide')),i=0;

/* Слайд всегда 1920x1080 — вписываем масштабом, чтобы верстка не плыла по окнам */
function fit(){{var s=Math.min(innerWidth/1920,innerHeight/1080);
  deck.style.transform='translate(-50%,-50%) scale('+s+')';}}
addEventListener('resize',fit);fit();

var LAD={ladder_js},WORK=15000,RES=15000,disc=1;
function money(v){{return v.toLocaleString('ru-RU').replace(/\\u00a0/g,' ');}}
function drawLadder(animate){{
  var box=document.getElementById('ladder'),max=WORK+RES;
  if(!box)return;
  if(!box.children.length){{
    box.innerHTML=LAD.map(function(r,n){{return '<div class="lrow'+(n===0?' top':'')+'">'+
      '<div class="lab">'+r[0]+'</div><div class="track"><i class="bar"></i></div>'+
      '<div class="val">0</div></div>';}}).join('');
  }}
  [].forEach.call(box.children,function(row,n){{
    var v=Math.round((WORK+RES*LAD[n][1])*disc);
    var bar=row.querySelector('.bar'),val=row.querySelector('.val');
    var set=function(){{bar.style.width=(v/max*100).toFixed(2)+'%';}};
    if(animate){{bar.style.width='0';requestAnimationFrame(function(){{setTimeout(set,60+n*70);}});}}
    else set();
    val.textContent=money(v);
  }});
}}
document.getElementById('lseg').addEventListener('click',function(e){{
  var b=e.target.closest('button');if(!b)return;
  [].forEach.call(this.children,function(x){{x.classList.remove('on');}});
  b.classList.add('on');disc=parseFloat(b.dataset.d);drawLadder(true);
}});

function show(n){{
  i=Math.max(0,Math.min(slides.length-1,n));
  slides.forEach(function(s,k){{s.classList.toggle('on',k===i);}});
  document.getElementById('pos').textContent=(i+1)+' / '+slides.length;
  if(slides[i].id==='s-ladder')drawLadder(true);
}}
document.getElementById('prev').onclick=function(){{show(i-1);}};
document.getElementById('next').onclick=function(){{show(i+1);}};
addEventListener('keydown',function(e){{
  if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){{e.preventDefault();show(i+1);}}
  if(e.key==='ArrowLeft'||e.key==='PageUp'){{e.preventDefault();show(i-1);}}
  if(e.key==='Home')show(0); if(e.key==='End')show(slides.length-1);
}});
deck.addEventListener('click',function(e){{
  if(e.target.closest('#lseg'))return;
  show(i+(e.clientX<innerWidth*0.28?-1:1));
}});
show(0);
</script></body></html>"""

out = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "tutor-deck.html")
out.write_text(html, encoding="utf-8")
n = html.count('<section class="slide"')
print(f"собрано: {out} — {out.stat().st_size/1024/1024:.2f} МБ, слайдов {n}")
