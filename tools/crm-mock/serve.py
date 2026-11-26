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

Отвечают ручки /admin/api/me, /admin/api/leads, /admin/api/docs/kinds и «Забота» (care.json);
остальные /admin/api/* и /api/* получают пустую заглушку, чтобы фоновые опросы
не роняли экран. Нужны другие данные — правьте PEOPLE и ME здесь же.
"""
import json
import os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tasks as mock_tasks  # noqa: E402  (рядом с этим файлом)
from datetime import date, datetime, timedelta
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

# Этап маршрута: сервер считает его из плана дела (client_views.lead_stage) и
# отдает строкой списка — шестнадцать этапов с состоянием каждого. Тут собираем
# правдоподобный ответ: кому-то план не собран вовсе (поле None), остальные стоят
# на разных этапах.
STAGE_NAMES = ["Доступ", "Диагностика", "Подбор", "Документы", "Портфолио", "Письма",
               "Методы", "Язык", "CSCA", "Интервью", "Подача", "Зачисление", "Виза",
               "Адаптация", "Прием", "Первые месяцы"]
STAGE_KEYS = ["access", "diag", "pick", "docs", "folio", "letters", "study", "lang",
              "csca", "interview", "apply", "offer", "visa", "adapt", "meet", "settle"]

def stage_of(i):
    if i in (3, 9):           # плана нет — так и пишем, это не «первый этап»
        return None
    pos = [1, 3, 4, 0, 8, 11, 2, 4, 0, 0, 6, 13][i % 12]
    steps = []
    for n, (k, nm) in enumerate(zip(STAGE_KEYS, STAGE_NAMES)):
        if n < pos:
            st, d, t = "done", 3, 3
        elif n == pos:
            st, d, t = "now", 4, 9
        elif n == pos + 1:
            st, d, t = "open", 0, 2
        else:
            st, d, t = "none", 0, 0
        steps.append({"k": k, "n": nm, "s": st, "d": d, "t": t})
    return {"key": STAGE_KEYS[pos], "short": STAGE_NAMES[pos],
            "title": STAGE_NAMES[pos], "pos": pos + 1, "total": len(steps),
            "steps": steps}

# Пакет документов: что мы ждем от семьи. Считает его сервер
# (doc_checklist.package_state) и отдает в карточке полем doc_plan — тут
# правдоподобный ответ, чтобы увидеть блок глазами.
DOC_ITEMS = [
    ("Загранпаспорт", "Загранпаспорт ученика"), ("Паспорт РФ", "Паспорт РФ ученика"),
    ("Паспорт родителя", "Загранпаспорт родителей"), ("Аттестат 9 класс", "Аттестат за 9 класс"),
    ("Аттестат 11 класс", "Аттестат за 11 класс"),
    ("Транскрипт 10 класс", "Транскрипт с оценками за 10 класс"),
    ("Анкета студента", "Анкета студента"), ("Язык", "Языковой сертификат: HSK или Duolingo"),
    ("Фото", "Фото по требованиям вуза"), ("Несудимость", "Справка о несудимости"),
    ("Портфолио", "Портфолио достижений"),
    ("Согласие на выезд", "Нотариальное согласие на выезд ребенка"),
    ("Транскрипт 11 класс", "Выписка оценок за 11 класс, первый семестр"),
]


# Уже присланные файлы и вписанные строки: блок «Ждем от семьи» стоит в разделе
# рядом с ними, и смотреть его в одиночку бессмысленно — рецепты не должны
# спорить между собой.
DOCS = [
    {"id": 1, "name": "passport-rf.pdf", "kind": "Паспорт РФ", "status": "accepted",
     "mime": "application/pdf", "link": None, "size_bytes": 420000, "has_file": True,
     "created_at": "2026-11-12T10:00:00Z", "uploaded_side": "client",
     "uploaded_relation": "parent", "uploaded_by": "мама", "review_note": ""},
    {"id": 2, "name": "attestat-9.jpg", "kind": "Аттестат 9 класс", "status": "needs_fix",
     "mime": "image/jpeg", "link": None, "size_bytes": 1250000, "has_file": True,
     "created_at": "2026-11-14T12:30:00Z", "uploaded_side": "client",
     "uploaded_relation": "self", "uploaded_by": "ученик",
     "review_note": "скан нечитаемый, нужна замена"},
    {"id": 3, "name": "dogovor-74.pdf", "kind": "Договор", "status": "accepted",
     "mime": "application/pdf", "link": None, "size_bytes": 310000, "has_file": True,
     "created_at": "2026-11-09T09:10:00Z", "uploaded_side": "team",
     "uploaded_relation": None, "uploaded_by": "Алена Малахова", "review_note": ""},
]
DOC_FIELDS = [{"key": "contacts_cn", "name": "Телефон и адрес в Китае",
               "value": "+86 131 0000 0000, Harbin, Nangang district"}]


def doc_plan(lead):
    i = int(lead["id"].rsplit("-", 1)[-1])
    track = (lead["crm"]["overrides"] or {}).get("track") or ""
    items = []
    for n, (kind, name) in enumerate(DOC_ITEMS):
        if n < (i % 5) + 1:
            st, note = "ok", ""
        elif n == (i % 5) + 1:
            st, note = "fix", ("скан нечитаемый по нижней половине страницы, "
                              "нужна замена: печать школы и подпись директора")
        elif n == (i % 5) + 2:
            st, note = "review", ""
        else:
            st, note = "wait", ""
        items.append({"key": kind, "kind": kind, "name": name, "state": st,
                      "note": note, "files": 0 if st == "wait" else 1, "field": False})
    names = {t["key"]: t["name"] for t in TRACKS}
    return {"track": track, "track_name": names.get(track, ""), "track_set": bool(track),
            "done": sum(1 for x in items if x["state"] == "ok"),
            "total": len(items), "items": items}



# Доска «Университеты»: вузы одного ученика с уровнями (мечта / реальный /
# запасной). В проде это eastside.uni_applications, тут — память процесса: доску
# надо увидеть глазами и показать ее человеку до промоута, а живые фамилии и
# вузы детей в превью и скриншоты не выносятся.
TIER_T = {"a": "мечта", "b": "реальный", "c": "запасной"}
AP_REQS = [("passport", "Загранпаспорт", True), ("transcript", "Транскрипт оценок", True),
           ("lang_cert", "Языковой сертификат", True), ("photo", "Фото по требованиям", True),
           ("letter", "Мотивационное письмо", False)]
AP_SEED = [
    ("Harbin Institute of Technology", "Computer Science", "2027 осень", 24, "collecting", "a", True),
    ("Shanghai Jiao Tong University", "Civil Engineering", "2027 осень", 38, "draft", "a", False),
    ("Zhejiang University", "Software Engineering", "2027 осень", 12, "check", "b", False),
    ("Jilin University", "International Economics", "2027 осень", 61, "ready", "b", False),
    ("Dalian University of Technology", "Mechanical Engineering", "2027 осень", 90, "submitted", "c", False),
    ("Shandong University", None, None, None, "draft", None, False),
    # Заявка «как до 23.11.2026»: уровня нет, но утверждена миграцией — семья ее
    # видит. Нужна в моке, чтобы метку «видит семья» было видно глазами.
    ("Sichuan University", "Chinese Language", "2027 весна", 45, "collecting", "legacy", False),
]
_APPS, _AP_EV, _AP_SEQ = {}, {}, [100]


def apps_for(lead_id):
    if lead_id in _APPS:
        return _APPS[lead_id]
    out = []
    for n, (uni, prog, intake, dl, st, tier, main) in enumerate(AP_SEED):
        _AP_SEQ[0] += 1
        aid = _AP_SEQ[0]
        reqs = []
        for m, (key, title, req) in enumerate(AP_REQS):
            state = "done" if m < (n % 4) else ("doing" if m == (n % 4) else "todo")
            reqs.append({"key": key, "title": title, "required": req, "state": state, "note": ""})
        done = sum(1 for r in reqs if r["state"] == "done")
        legacy = tier == "legacy"
        if legacy:
            tier = None
        out.append({
            "id": aid, "uniName": uni, "programName": prog, "intake": intake,
            "deadline": (date.today() + timedelta(days=dl)).isoformat() if dl is not None else None,
            "status": st, "appNumber": "", "portalUrl": "", "portalLogin": "",
            "hasSecret": n == 0, "requirements": reqs,
            "progress": {"done": done, "total": len(reqs)},
            "tier": tier, "tierTitle": TIER_T.get(tier or "", "без уровня"),
            "isMain": main, "approved": bool(tier) or legacy,
            "approvedAt": "2026-11-20T10:00:00Z" if (tier or legacy) else None,
            "approvedBy": "перенос 23.11.2026" if legacy else ("Мария Шустова" if tier else None),
            "notes": "",
        })
        _AP_EV[aid] = [{"id": aid * 10, "kind": "created", "text": "Завели вуз: " + uni,
                        "side": "team", "by": "Мария Шустова",
                        "at": "2026-11-20T09:55:00Z", "family": True}]
        if tier:
            _AP_EV[aid].insert(0, {"id": aid * 10 + 1, "kind": "approved",
                                   "text": "Вуз в вашем списке: " + uni, "side": "team",
                                   "by": "Мария Шустова", "at": "2026-11-20T10:00:00Z",
                                   "family": True})
    _APPS[lead_id] = out
    return out


def app_by_id(aid):
    for lead_id, lst in _APPS.items():
        for a in lst:
            if str(a["id"]) == str(aid):
                return lead_id, a
    return None, None


def ap_log(aid, kind, text, family):
    ev = _AP_EV.setdefault(aid, [])
    ev.insert(0, {"id": (ev[0]["id"] + 1) if ev else 1, "kind": kind, "text": text,
                  "side": "team", "by": "Демо Пользователь",
                  "at": datetime.now().isoformat(timespec="seconds"), "family": family})


_LEADS = None


def leads():
    # Список держим в памяти процесса: PATCH правит ту же карточку, что видит
    # список, иначе правка исчезает на первом же перерисовывании.
    global _LEADS
    if _LEADS is not None:
        return _LEADS
    out = []
    for i, (name, track, tariff, score, contact, note) in enumerate(PEOPLE):
        ov = {"tariff": tariff}
        if track:
            ov["track"] = track
        # Дедлайн в «Сопровождении» берется из двух мест: ручная дата в overrides и
        # расчетная (ближайшая подача по вузам уровней А/Б/С, поле uni_deadline от
        # сервера). Для глаз нужны все состояния ячейки: просрочено, вот-вот,
        # спокойно, расчетная дата, ручная поверх расчетной и пусто.
        _dl = {0: -3, 1: 0, 2: 1, 3: 12, 4: 40}.get(i % 7)
        if _dl is not None:
            ov["deadline"] = (date.today() + timedelta(days=_dl)).isoformat()
        _uni = {2: (30, "Чжэцзянский университет"), 5: (9, "Харбинский политехнический"),
                6: (-1, "Университет Сучжоу")}.get(i % 7)
        # Кто ведет: в «Сопровождении» имя тьютора стоит на месте плашки статуса.
        tutors = ["Аюпова Элиза", "Александр Сердотецков", "Алена Малахова",
                  "Анастасия Мишина", "Светлана Рошенская", None]
        tutor = tutors[i % 6]
        # id у тьютора свой, а не у карточки: по нему идет фильтр, и одинаковые
        # id у двух карточек одного человека раздвоили бы его в выпадашке.
        crm = {"status": "client", "note": note, "overrides": ov,
               "owner": ({"id": 100 + (i % 6), "name": tutor} if tutor else None),
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
            "no": 1001 + i,              # короткий номер карточки К-1001
            "name": name,
            "school_class": klass,
            "stage": stage_of(i),
            "uni_deadline": ({"date": (date.today() + timedelta(days=_uni[0])).isoformat(),
                              "uni": _uni[1]} if _uni else None),
            "score": score,
            "status": "diagnosed",
            "grade": "11 класс" if i % 2 else "10 класс",
            "target_year": 2027,
            "paid": True,
            "created_at": "2026-10-%02dT10:00:00Z" % (i + 1),
            "booking": {} if i in (2, 7) else {"contact": contact},
            "crm": crm,
        })
    _LEADS = out
    return out

def _ri(i, who, amount, status="план", cid=None, person=None, item="Мотивация", role="",
        bill=False, service=False, accrual=False, hold=None):
    return {"hold": hold, "id": "o%d" % i, "date": "2026-11-20", "status": status, "receiver": who,
            "item": item, "amount": amount, "dest": "ВТБ, р/с", "comment": "", "has_doc": False,
            "cid": cid, "person": person or who, "role": role, "by_bill": bill,
            "service": service, "accrual": accrual}


FIN_PERIODS = {"periods": [{"id": "p1", "name": "12.11–24.11", "status": "открыт", "open": True,
                            "starts_on": "2026-11-12", "ends_on": "2026-11-24"}], "open_id": "p1"}
FIN_PERIOD = {
    "period": dict(FIN_PERIODS["periods"][0], open=True), "closed_at": None,
    "cascade": {"income": 608430, "income_gross": 610000, "shortterm": 0, "base": 608430,
                "allocations": 300000, "direct": 150000, "profit": 158430, "flex": 74102.77,
                "dividends": 84327.23},
    "plan_cascade": None, "rules": [], "offerings": [], "funds": [], "accounts": [],
    "direct": [], "cash": None, "metrics": None, "distribution": None, "warnings": [],
    "plan_left": {"count": 0, "amount": 0},
}
FIN_REGISTER = {
    "period": FIN_PERIODS["periods"][0], "rs": 300000, "to_pay": 150000, "paid": 29000,
    "after": 150000, "over": False, "dividends": 84327.23,
    "rs_groups": [
        {"id": "управление", "label": "Управление", "to_pay": 50000, "paid": 0, "items": [
            _ri(1, "Тестов Владимир", 25000),
            _ri(2, "Проджектова Анна", 25000, cid="c1", person="Проджектова Анна Ивановна")]},
        {"id": "продажи", "label": "Отдел продаж", "to_pay": 0, "paid": 2080, "items": [
            _ri(3, "Анна Эванс", 2080, status="факт", cid="c1", person="Проджектова Анна Ивановна",
                item="Клиент Икс", accrual=True)]},
        {"id": "администрирование", "label": "Администрирование", "to_pay": 20000, "paid": 0, "items": [
            _ri(4, "Учителева Ольга", 3000), _ri(5, "Лариса бухгалтер", 5000),
            _ri(6, "Админова Мария", 15000, cid="c2", person="Админова Мария Петровна",
                hold="акт № 13 за ноябрь 2026 не подписан")]},
        {"id": "сервисы", "label": "Сервисы и подписки", "to_pay": 0, "paid": 23982.1, "items": [
            _ri(7, "Railway", 23482.10, status="факт", service=True),
            _ri(8, "Селектел", 500, status="факт", service=True)]},
        {"id": "funds_alloc", "label": "Отчисления в фонды", "to_pay": 300000, "paid": 0, "items": [
            {"id": "alloc:contractors", "receiver": "Фонд подрядчиков", "amount": 121686, "status": "план",
             "item": "отчисление в фонд", "dest": "на карту собственника"},
            {"id": "alloc:marketing", "receiver": "Фонд маркетинга", "amount": 150644.11, "status": "план",
             "item": "отчисление в фонд", "dest": "на карту собственника"}]},
    ],
    "funds": [{"id": "marketing", "name": "Фонд маркетинга", "added": 150644.11, "spent": 92500, "items": [
        _ri(9, "СММ Екатерина", 22500, cid="c3", person="Смм Екатерина",
            hold="не заполнил анкету, акт не завести"),
        _ri(10, "Ипшница Ольга", 40000, bill=True),
        _ri(11, "Монтажер Анна", 12500)]}],
}

RC_ARCHIVE = {"items": [
    {"id": "a1", "contractor_id": "c1", "contractor": "Тестова Вера Ивановна", "person": "Вера Тестова",
     "inn": "111111111111", "dept": "Отдел продукта", "title": "Тестова октябрь", "period": "",
     "date": "2026-11-12", "amount": 45000, "receipt_no": "201abc1", "receipt_inn": "111111111111",
     "service": "Технические услуги для сайта",
     "fns_url": "https://lknpd.nalog.ru/api/v1/receipt/111111111111/201abc1/print",
     "file_name": "Тестова октябрь.png", "file_mime": "image/png", "contractor_archived": False},
    {"id": "a2", "contractor_id": "c1", "contractor": "Тестова Вера Ивановна", "person": "Вера Тестова",
     "inn": "111111111111", "dept": "Отдел продукта", "title": "аванс сентябрь", "period": "",
     "date": "2026-09-25", "amount": 22500, "receipt_no": "2009xyz", "receipt_inn": "111111111111",
     "service": "Технические услуги для сайта",
     "fns_url": "https://lknpd.nalog.ru/api/v1/receipt/111111111111/2009xyz/print",
     "file_name": "аванс сентябрь.jpg", "file_mime": "image/jpeg", "contractor_archived": False},
    {"id": "a3", "contractor_id": None, "contractor": "Анна", "person": "Анна",
     "inn": None, "dept": "Отдел маркетинга", "title": "Анна за октябрь 26", "period": "",
     "date": "2026-11-16", "amount": None, "receipt_no": None, "receipt_inn": None,
     "service": "", "fns_url": None,
     "file_name": "Анна за октябрь 26.jpg", "file_mime": "image/jpeg", "contractor_archived": False},
], "count": 3}

ME = {"ok": True, "id": 1, "name": "Демо Пользователь", "role": "super_admin",
      "caps": ["dash", "clients", "team", "tasks", "tasks_all", "finance", "marketing",
               "planfact", "finmodel", "zaezd_review", "academy", "academy_review", "care",
               "inbox", "contractors", "finmodel_edit"]}

# «Забота» (раздел care): причины и случаи, обезличенные из разбора 23.11.2026, id
# диалогов выдуманные. Собирается заново, если поменялся сид причин в бэкенде.
CARE = json.load(open(os.path.join(os.path.dirname(__file__), "care.json"), encoding="utf-8"))

_D = lambda n: (date.today() + timedelta(days=n)).isoformat()
# Дебиторка «Продаж» (11096): выдуманные семьи во всех пяти состояниях, включая
# остаток по прайсу у клиента без графика и деньги только в ведомости.
def _debt(i, name, state, **kw):
    row = {"id": f"dbt-{i}", "name": name, "state": state, "owner": "Павел", "seller": "",
           "tariff": "plus", "mark": "", "paid_rub": 0, "last_paid": None, "order_rub": 0,
           "left_rub": 0, "next_due": None, "next_rub": None, "late_days": 0,
           "contract": True, "support": True, "ledger_rub": 0, "price_rub": 299990,
           "est_left": None}
    row.update(kw)
    return row


DEBTS = {"no_contract": 2, "rows": [
    _debt(1, "Орлова Анна (мама)", "late", paid_rub=149995, last_paid="2026-09-18",
          left_rub=149995, next_due="2026-11-20", next_rub=149995, late_days=4),
    _debt(2, "Семья Белых", "todo", paid_rub=100000, last_paid="2026-10-04", est_left=199990),
    _debt(3, "Семья Кравец", "todo", tariff="std", price_rub=159000, paid_rub=159000,
          last_paid="2026-09-02", est_left=0),
    _debt(4, "Семья Лисиных", "check", ledger_rub=137200, est_left=162790, owner=""),
    _debt(5, "Семья Гордеевых", "check", contract=False),
    _debt(6, "Семья Зуевых", "wait", paid_rub=140000, last_paid="2026-11-19",
          left_rub=160000, next_due="2026-12-15", next_rub=80000,
          plan=[{"due": "2026-12-15", "rub": 80000}, {"due": None, "rub": 80000}]),
    _debt(7, "Семья Миронец", "done", tariff="prem", paid_rub=399990,
          last_paid="2026-08-10", support=False),
], "states": [
    {"key": "late", "label": "Просрочен взнос", "count": 1, "rub": 149995},
    {"key": "todo", "label": "Нет графика", "count": 2, "rub": 199990},
    {"key": "check", "label": "Нет оплат в карточке", "count": 2, "rub": 0},
    {"key": "wait", "label": "Ждем взнос", "count": 1, "rub": 149500},
    {"key": "done", "label": "Долга нет", "count": 1, "rub": 0},
]}

REFUNDS = {"refunded_rub": 117990, "states": [
    {"key": "late", "label": "Шаг просрочен", "count": 1},
    {"key": "going", "label": "Идет", "count": 1},
    {"key": "done", "label": "Вернули", "count": 4}], "rows": [
    {"id": "d1", "goal_id": 101, "name": "Семья Демидовых", "source": "flow", "state": "late",
     "started": _D(-8), "deadline": _D(5), "steps_done": 1, "refunded_rub": 0, "refunded_at": None,
     "step": {"n": 2, "of": 5, "title": "подготовить расчет возврата", "task_id": 1, "who": "Лиана",
              "due": _D(-2), "status": "doing"}},
    {"id": "d2", "goal_id": 102, "name": "Семья Орловых", "source": "flow", "state": "going",
     "started": _D(-2), "deadline": _D(11), "steps_done": 0, "refunded_rub": 0, "refunded_at": None,
     "step": {"n": 1, "of": 5, "title": "передать дело агенту-юристу", "task_id": 2, "who": "Павел Дьяков",
              "due": _D(1), "status": "wait"}},
    {"id": "d3", "goal_id": None, "name": "Семья Ручных", "source": "manual", "state": "done",
     "started": None, "deadline": None, "steps_done": 0, "refunded_rub": 50000, "refunded_at": _D(-20),
     "step": None},
    {"id": "d4", "goal_id": None, "name": "Гость с лендинга", "source": "manual", "state": "done",
     "started": None, "deadline": None, "steps_done": 0, "refunded_rub": 990, "refunded_at": _D(-100),
     "step": None},
    # возвраты до CRM, только в ведомости (миграция 335 бэкенда)
    {"id": "d5", "goal_id": None, "name": "Семья Ведомостных", "source": "ledger", "state": "done",
     "started": None, "deadline": None, "steps_done": 0, "refunded_rub": 62000, "refunded_at": _D(-27),
     "step": None, "ledger": "22.10–10.11", "paid_from": "фонд безопасности", "note": ""},
    {"id": None, "goal_id": None, "name": "Тестова Анна", "source": "ledger", "state": "done",
     "started": None, "deadline": None, "steps_done": 0, "refunded_rub": 5000, "refunded_at": None,
     "step": None, "ledger": "21.05–10.06", "paid_from": "фонд безопасности", "note": ""}]}


BOT_CONV = {"user_id": 501, "channel": "vk_page", "name": "Мама Тестова", "username": None,
            "full_name": "Мама Тестова", "ai_enabled": False, "handoff_requested": False,
            "handoff_reason": None, "taken_by": None, "last_text": "Спасибо, подумаем",
            "last_role": "user", "last_at": "2026-11-25T12:10:00+00:00", "unread": 0, "msgs": 2}
BOT_MSGS = [
    {"id": 1, "role": "assistant", "sender": "manager", "text": "Добрый день, это EastSide, вы оставляли заявку",
     "at": "2026-11-25T12:00:00+00:00"},
    {"id": 2, "role": "user", "sender": None, "text": "Спасибо, подумаем", "at": "2026-11-25T12:10:00+00:00"},
]
BOT_BOUND: list = []

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass

    def end_headers(self):
        # Без no-store браузер держит app.js в кэше, и правка, которую смотришь
        # глазами, в превью не приезжает — проверка тогда врет.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, obj, code=200):
        raw = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self):
        p = self.path.split("?")[0]
        # Задачник живет в соседнем файле: «План», «Цели» и приемка.
        qs = (self.path.split("?") + [""])[1]
        q = dict(x.split("=", 1) for x in qs.split("&") if "=" in x)
        answer = mock_tasks.route(p, q)
        if answer is not None:
            return self._json(answer)
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
                return self._json({"ok": True, **one[0], "docs": DOCS,
                                   "doc_fields": DOC_FIELDS,
                                   "doc_plan": doc_plan(one[0])})
        if p == "/admin/api/care":
            return self._json(CARE["overview"])
        if p == "/admin/api/care/cases":
            key = (self.path.split("cause=", 1) + [""])[1].split("&")[0]
            return self._json({"cases": CARE["cases"].get(key, [])})
        # Реестр возвратов «Продаж» (10808): выдуманные семьи во всех трех состояниях.
        if p == "/admin/api/sales/refunds":
            return self._json(REFUNDS)
        if p == "/admin/api/sales/debts":
            return self._json(DEBTS)
        # Реестр к выводу и сообщение бухгалтеру: выдуманные люди и суммы.
        if p == "/admin/api/fin/periods":
            return self._json(FIN_PERIODS)
        if p == "/admin/api/fin/period":
            return self._json(FIN_PERIOD)
        if p == "/admin/api/fin/register":
            return self._json(FIN_REGISTER)
        # Архив старых чеков (12003): выдуманные люди, у одного нет карточки исполнителя.
        if p == "/admin/api/contractor-receipts/archive":
            return self._json(RC_ARCHIVE)
        # Доска «Университеты» в карточке: вузы ученика и лента одного вуза.
        if p.startswith("/admin/api/leads/") and p.endswith("/applications"):
            lead_id = p.split("/")[4]
            return self._json({"ok": True, "applications": apps_for(lead_id),
                               "statuses": [], "vault": True})
        if p.startswith("/admin/api/applications/") and p.endswith("/events"):
            aid = p.split("/")[4]
            return self._json({"ok": True, "events": _AP_EV.get(int(aid), [])})
        # «Диалоги»: выдуманная переписка с рабочей страницы ВК без карточки — на ней
        # видно «Привязать к карточке» (Павел 25.11.2026, касание по переписке).
        if p == "/admin/api/bot/conversations":
            return self._json({"conversations": [BOT_CONV]})
        if p == "/admin/api/bot/conversations/501/messages":
            return self._json({**BOT_CONV, "contractor": None, "messages": BOT_MSGS})
        if p == "/admin/api/bot/conversations/501/lead":
            if BOT_BOUND:
                return self._json({"found": True, "session_id": BOT_BOUND[0], "match": "id",
                                   "lead_name": "Тестовый Ученик", "status": "new"})
            return self._json({"found": False, "can_create": True, "name": BOT_CONV["name"]})
        if p == "/admin/api/docs/kinds":
            return self._json({"ok": True, "kinds": [], "tracks": TRACKS})
        if p.startswith("/admin/api/") or p.startswith("/api/"):
            return self._json({"ok": True, "items": [], "leads": [], "students": [],
                               "tasks": [], "rows": [], "unread": 0})
        return super().do_GET()

    def do_POST(self):
        """Действия доски «Университеты». Остальным POST-ам хватает «ok».

        Уровень тут МЕНЯЕТ видимость для семьи — ровно как на бэкенде: поставили
        уровень, вуз утвержден, сняли — ушел из кабинета. Мок, который молча
        отвечал «ok», подтверждал бы перенос, которого не произошло, и проверка
        глазами тогда ничего не значит.
        """
        p = self.path.split("?")[0].rstrip("/")
        try:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size) or b"{}")
        except Exception:
            body = {}
        parts = p.split("/")
        if p == "/admin/api/bot/conversations/501/bind":
            BOT_BOUND[:] = [body.get("session_id")]
            return self._json({"ok": True, "id": body.get("session_id")})
        if p.startswith("/admin/api/leads/") and p.endswith("/applications"):
            lead_id = parts[4]
            lst = apps_for(lead_id)
            _AP_SEQ[0] += 1
            aid = _AP_SEQ[0]
            reqs = [{"key": k, "title": ti, "required": rq, "state": "todo", "note": ""}
                    for k, ti, rq in AP_REQS]
            a = {"id": aid, "uniName": body.get("uni_name") or "Без названия",
                 "programName": body.get("program_name"), "intake": body.get("intake"),
                 "deadline": body.get("deadline"), "status": "draft", "appNumber": "",
                 "portalUrl": body.get("portal_url") or "", "portalLogin": body.get("portal_login") or "",
                 "hasSecret": False, "requirements": reqs,
                 "progress": {"done": 0, "total": len(reqs)},
                 "tier": None, "tierTitle": "без уровня", "isMain": False,
                 "approved": False, "approvedAt": None, "approvedBy": None, "notes": ""}
            lst.append(a)
            ap_log(aid, "created", "Завели вуз: " + a["uniName"], True)
            return self._json({"ok": True, **a})
        if len(parts) >= 6 and parts[3] == "applications":
            aid, what = parts[4], parts[5]
            lead_id, a = app_by_id(aid)
            if a is None:
                return self._json({"ok": True})
            if what == "tier":
                tier = body.get("tier") or None
                was = a["tier"]
                a["tier"] = tier
                a["tierTitle"] = TIER_T.get(tier or "", "без уровня")
                a["approved"] = bool(tier)
                a["approvedAt"] = a["approvedAt"] if (tier and a["approvedAt"]) else (
                    datetime.now().isoformat(timespec="seconds") if tier else None)
                if tier and was:
                    ap_log(int(aid), "tier", "Перенесли из «%s» в «%s»"
                           % (TIER_T.get(was, "без уровня"), TIER_T[tier]), False)
                elif tier:
                    ap_log(int(aid), "tier", "Поставили уровень: " + TIER_T[tier], False)
                    ap_log(int(aid), "approved", "Вуз в вашем списке: " + a["uniName"], True)
                else:
                    ap_log(int(aid), "tier", "Сняли уровень «%s»"
                           % TIER_T.get(was, "без уровня"), False)
                return self._json({"ok": True, **a})
            if what == "main":
                on = bool(body.get("main"))
                if on:
                    for other in _APPS.get(lead_id, []):
                        other["isMain"] = False
                a["isMain"] = on
                ap_log(int(aid), "main", ("Главный вуз: " if on else "Сняли отметку главного: ")
                       + a["uniName"], a["approved"])
                return self._json({"ok": True, **a})
            if what == "status":
                a["status"] = body.get("status") or a["status"]
                ap_log(int(aid), "status", "Статус: " + a["status"], True)
                return self._json({"ok": True, **a})
            if what == "requirements":
                for r in a["requirements"]:
                    if r["key"] == body.get("key"):
                        r["state"] = body.get("state") or r["state"]
                a["progress"]["done"] = sum(1 for r in a["requirements"] if r["state"] == "done")
                return self._json({"ok": True, **a})
        return self._json({"ok": True})

    def do_PATCH(self):
        # Настоящая ручка отвечает КАРТОЧКОЙ целиком, и фронт кладет ее себе
        # (`l2.crm = res.crm`). Пока мок отвечал «ok», карточка после правки теряла
        # tariff и track и вываливалась из «Сопровождения» — поломка мока, которую
        # легко принять за поломку экрана. Поэтому мержим и отдаем crm.
        path = self.path.split("?")[0].rstrip("/")
        lead_id = path.rsplit("/", 1)[-1]
        try:
            size = int(self.headers.get("Content-Length") or 0)
            body = json.loads(self.rfile.read(size) or b"{}")
        except Exception:
            body = {}
        for l in leads():
            if l["id"] == lead_id:
                for k in ("status", "note", "tasks", "comms"):
                    if k in body:
                        l["crm"][k] = body[k]
                # overrides настоящая ручка МЕРЖИТ, а ключи со значением "" удаляет
                # (admin.py: `overrides || $2 - del_keys`). Мок, заменявший словарь
                # целиком, молча подтверждал бы снятие срока, которого на бэкенде не
                # происходит, — проверка на моке тогда ничего не значит.
                if "overrides" in body:
                    ov = dict(l["crm"].get("overrides") or {})
                    for k2, v2 in (body["overrides"] or {}).items():
                        if v2 == "":
                            ov.pop(k2, None)
                        else:
                            ov[k2] = v2
                    l["crm"]["overrides"] = ov
                return self._json({"ok": True, "crm": l["crm"]})
        return self._json({"ok": True})

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
