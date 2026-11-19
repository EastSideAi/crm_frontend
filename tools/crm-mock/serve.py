"""Мок-сервер CRM: отдает статику репозитория и ВЫДУМАННЫЕ карточки.

Зачем. Посмотреть экран CRM глазами и показать его оператору до промоута нечем:
превью ходит в прод-API, а там живые фамилии детей — в превью и скриншоты они не
выносятся (152-ФЗ, правило песочницы). Тут поднимается НАСТОЯЩИЙ app.js поверх
выдуманных карточек: видно ровно то, что увидит человек.

Запуск:
    python3 tools/crm-mock/serve.py 8933 .
    # дальше открыть http://127.0.0.1:8933/#page/leads/support,
    # положить любой ключ: localStorage.setItem('eastside_crm_key', 'demo')
    # и перезагрузить страницу (ключ читается на старте)

Адрес API подставляется в index.html на лету (`location.origin`): пустая строка
не годится — в app.js он берется как `window.EASTSIDE_API_BASE || ...`, и пустое
значение молча уводит запросы на боевой api.истсайд.рф.

Отвечают три ручки — /admin/api/me, /admin/api/leads, /admin/api/docs/kinds;
остальные /admin/api/* и /api/* получают пустую заглушку, чтобы фоновые опросы
не роняли экран. Нужны другие данные — правьте PEOPLE и ME здесь же.
"""
import json, os, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]); ROOT = sys.argv[2]

TRACKS = [
    {"key": "lang_paid", "name": "Платный языковой год"},
    {"key": "lang_grant", "name": "Языковой год по гранту"},
    {"key": "bachelor", "name": "Бакалавриат"},
    {"key": "master", "name": "Магистратура"},
    {"key": "master_after_lang", "name": "Магистратура после языкового года"},
    {"key": "bachelor_after_lang", "name": "Бакалавриат после языкового года"},
    {"key": "master_direct", "name": "Магистратура (ЗАУ), подача напрямую в вуз"},
]

PEOPLE = [
    ("Анна Светлова (мама Ольга)", "bachelor_after_lang", "plus", 72, "@anna_demo", "10-11 класс · поступление 2027"),
    ("Борис Ильин (мама Нина)", "bachelor", "prem", 68, "boris@demo.local", "10-11 класс · поступление 2027"),
    ("Вера Каримова (папа Руслан)", "bachelor", "std", 61, "@vera_demo", "11 класс · поступление 2027"),
    ("Глеб Нестеров (мама Инна)", "lang_grant", "plus", 58, "gleb@demo.local", "языковой год по гранту"),
    ("Дина Полянская (мама Алла)", "lang_paid", "std", 55, "@dina_demo", "платный языковой год"),
    ("Егор Мальцев", "master", "plus", 64, "egor@demo.local", "магистратура, выпуск 2026"),
    ("Жанна Ковтун", "master_after_lang", "prem", 59, "@zhanna_demo", "магистратура после языкового"),
    ("Игорь Трошин", "master_direct", "std", 52, "igor@demo.local", "подача напрямую в вуз"),
    ("Зоя Радченко (мама Лариса)", "", "plus", 47, "@zoya_demo", "направление пока не проставлено"),
    ("Кирилл Панов (мама Юлия)", "bachelor", "plus", 70, "kirill@demo.local", "10-11 класс · поступление 2027"),
    ("Лада Ермакова", "bachelor_after_lang", "std", 50, "@lada_demo", "языковой год + бакалавриат"),
    ("Марк Тихонов (папа Денис)", "", "prem", 44, "mark@demo.local", "направление пока не проставлено"),
]

def leads():
    out = []
    for i, (name, track, tariff, score, contact, note) in enumerate(PEOPLE):
        ov = {"tariff": tariff}
        if track:
            ov["track"] = track
        # Кто ведет: в «Сопровождении» имя тьютора стоит на месте плашки статуса.
        tutors = ["Элиза Аюпова", "Александр Сердотецков", "Лиана Эванс", None]
        tutor = tutors[i % 4]
        crm = {"status": "client", "note": note, "overrides": ov,
               "owner": ({"id": 100 + i, "name": tutor} if tutor else None),
               "tasks": [], "comms": []}
        # Разнобой ради срезов воронки: без него у всех карточек одинаковые
        # признаки, ряд чипов схлопывается в одно «Все», и разницу вкладок
        # («Сопровождение» короче «Клиентов») на экране не увидеть.
        if i % 3 == 0:
            crm["mql"] = {"ok": True}
        if i % 4 == 0:
            crm["sql"] = True
        if i % 5 == 0:
            crm["tasks"] = [{"text": "позвонить семье", "done": False,
                             "due": "2026-11-10"}]
        # Класс школьника считает бэкенд из года окончания школы и отдает полем
        # school_class (вкладки «8 / 9 / 10 класс»). Тут просто подставляем правдоподобно.
        klass = [11, 10, 11, 9, 8, None, None, None, 10, 11, 9, 8][i % 12]
        out.append({
            "id": "demo-%02d" % i,
            "name": name,
            "school_class": klass,
            "score": score,
            "status": "diagnosed",
            "grade": "11 класс" if i % 2 else "10 класс",
            "target_year": 2027,
            "paid": True,
            "created_at": "2026-10-%02dT10:00:00Z" % (i + 1),
            "booking": {} if i in (2, 7) else {"contact": contact},
            "crm": crm,
        })
    return out

ME = {"ok": True, "id": 1, "name": "Демо Пользователь", "role": "super_admin",
      "caps": ["dash", "clients", "team", "tasks", "tasks_all", "finance", "marketing",
               "planfact", "finmodel", "zaezd_review", "academy", "academy_review"]}

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p in ("/", "/index.html"):
            html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
            html = html.replace("<script src=\"app.js\">",
                                "<script>window.EASTSIDE_API_BASE=location.origin;</script><script src=\"app.js\">")
            raw = html.encode()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        if p == "/admin/api/me":
            return self._json(ME)
        if p == "/admin/api/leads":
            return self._json({"ok": True, "leads": leads()})
        # Карточка лида — тот же выдуманный человек, что в списке: без нее окно
        # карточки открывается пустым, и блок квалификации не посмотреть.
        if p.startswith("/admin/api/leads/") and p.count("/") == 4:
            one = [x for x in leads() if x["id"] == p.rsplit("/", 1)[-1]]
            if one:
                return self._json({"ok": True, **one[0]})
        if p == "/admin/api/docs/kinds":
            return self._json({"ok": True, "kinds": [], "tracks": TRACKS})
        if p.startswith("/admin/api/") or p.startswith("/api/"):
            return self._json({"ok": True, "items": [], "leads": [], "students": [],
                               "tasks": [], "rows": [], "unread": 0})
        return super().do_GET()

    def do_POST(self):
        return self._json({"ok": True})

    def do_PATCH(self):
        return self._json({"ok": True})

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
