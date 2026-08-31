"""Читаемая версия договора: `dogovor.html` из рабочего `dogovor-uslug.docx`.

Зачем отдельным файлом. Html нужен, чтобы договор можно было прочитать с телефона по
ссылке, не скачивая docx. Раньше его собирал `rebuild.py` попутно со сборкой самих
шаблонов, но с 31 августа 2026 шаблоны приходят от владельца готовыми, и пересборка
запрещена. Читаемая версия при этом обязана идти следом за документом — иначе на
странице останется прошлая редакция, а это хуже, чем ее отсутствие.

Запуск: `python3 to_html.py`. Источник — рабочий docx рядом, не `original/`.
"""

import html
import re
import zipfile
from pathlib import Path

from rebuild import HTML_HEAD

TPL = Path(__file__).resolve().parent
PARA = re.compile(r"<w:p\b[^>]*>.*?</w:p>|<w:p\b[^>]*/>", re.DOTALL)
TEXT = re.compile(r"<w:t(?:\s[^>]*)?>(.*?)</w:t>", re.DOTALL)
# Строки реквизитов и подписей: их верстаем тише основного текста.
SIGN = ("ИП ", "ОГРНИП", "ИНН", "Расчетный", "Банк", "К/сч", "БИК", "Адрес", "Телефон",
        "Электронная почта", "ФИО", "Паспорт", "Выдан", "Дата выдачи", "_______")


def paragraphs(path: Path) -> list[str]:
    xml = zipfile.ZipFile(path).read("word/document.xml").decode("utf-8")
    out = []
    for m in PARA.finditer(xml):
        t = "".join(TEXT.findall(m.group(0))).strip()
        if t:
            out.append(t)
    return out


def build(src: Path, out: Path) -> None:
    body = []
    for t in paragraphs(src):
        e = html.escape(t)
        if t.startswith(("ДОГОВОР", "ПРИЛОЖЕНИЕ")):
            body.append(f"<h1>{e}</h1>")
        elif re.match(r"^\d+\.\s+\S", t) or t in ("ЗАКАЗЧИК", "ИСПОЛНИТЕЛЬ"):
            body.append(f'<div class="sec">{e}</div>')
        elif re.match(r"^\d+\.\d+", t):
            body.append(f'<p class="i">{e}</p>')
        elif t.startswith(("№", "г. Хабаровск", "«____»")):
            body.append(f'<div class="sub">{e}</div>')
        # Длина отсекает абзацы договора, которые лишь начинаются с прочерка под
        # вписываемое имя: реквизит — всегда короткая строка.
        elif t.startswith(SIGN) and len(t) < 120:
            body.append(f'<p class="sign">{e}</p>')
        else:
            body.append(f"<p>{e}</p>")
    out.write_text(HTML_HEAD + "\n".join(body) + "\n</div></body></html>",
                   encoding="utf-8")
    print(f"{out.name}: {len(body)} абзацев из {src.name}")


if __name__ == "__main__":
    build(TPL / "dogovor-uslug.docx", TPL / "dogovor.html")
