"""Выдуманный задачник для мок-сервера CRM: «План», «Цели» и пульс команды.

Зачем отдельный файл. Экраны задач смотрятся глазами так же часто, как карточки
лидов, а брать их с прода нельзя — там живые люди. Форма данных взята с боевой
базы (сколько задач, по каким дням и отделам, сколько ждет приемки), сами задачи
выдуманы.

Подключается из serve.py: `route(path, query)` отдает готовый ответ или None,
если ручка не наша.
"""
from datetime import date, datetime, timedelta

ME_ID = 1

PEOPLE = [
    ("Ирина Соловьева", "head"),
    ("Олег Браун", "marketing_lead"),
    ("Тимур Касымов", "sales_lead"),
    ("Злата Корнева", "senior_tutor"),
    ("Нина Жарова", "tutor"),
]


def _monday(d: date) -> date:
    return d - timedelta(days=d.weekday())


TODAY = date.today()
MON = _monday(TODAY)


def _day(shift: int, hour: int = 18) -> str:
    return f"{MON + timedelta(days=shift)}T{hour:02d}:00:00+03:00"


def task(i: int, **kw) -> dict:
    d = {"id": 3000 + i, "title": f"Задача {i}", "status": "wait",
         "due_at": _day(4), "closed_at": None, "dept": "product",
         "assignee_id": ME_ID, "assignee_name": "Демо Руководитель",
         "author_id": ME_ID, "author_name": "Демо Руководитель",
         "executors": [], "watchers": [], "client_name": None,
         "parent_id": None, "parent_title": None, "important": False,
         "carry_count": 0, "stuck": False, "overdue": False, "is_goal": False}
    d.update(kw)
    return d


# Форма недели руководителя на боевой базе 24.11.2026: четырнадцать задач, из них
# двенадцать по одному направлению, все до одной — шаги целей, разложены на четыре
# дня, четыре просрочены.
WEEK = [
    ("Разобрать логику диалогов бота", "product", 0, "План на ноябрь"),
    ("Посчитать конверсию в языковые курсы", "sales", 0, "Низкочековые продукты"),
    ("Теплую базу отдать отделу продаж", "product", 1, "План на ноябрь"),
    ("Ответить на вопросы по процессам", "ops", 1, "Процессы компании"),
    ("Низкочековые продукты на декабрь", "product", 4, "Низкочековые продукты"),
    ("Предварительная диагностика до консультации", "product", 4, "План на ноябрь"),
    ("Сценарии диагностики по классам", "product", 4, "План на ноябрь"),
    ("Описать мини-продукты на портале", "product", 4, "Низкочековые продукты"),
    ("Агент проверяет письмо по анкете", "product", 4, "План на ноябрь"),
    ("Опрос после этапа с порогом 70 процентов", "product", 4, "План на ноябрь"),
    ("Подписание акта в два клика", "product", 4, "План на ноябрь"),
    ("Мануал и база знаний отдела продаж", "product", 5, "Мануал продаж"),
    ("Конструктор тарифа", "product", 5, "План на ноябрь"),
    ("Академия на все отделы", "product", 5, "План на ноябрь"),
]

ACCEPT = [
    "настроить агента, который каждое утро присылает новости о вузах Китая и языковых экзаменах",
    "Подготовить и провести эфир про гранты",
    "Собрать пакет материалов для регионов",
    "Причесать страницу уроков: убрать чужой логотип",
    "Карточки мелких продуктов для маркетинга",
    "Договор отработан или мы еще что-то должны",
]


def week_tasks() -> list:
    out = []
    for i, (title, dept, shift, goal) in enumerate(WEEK):
        out.append(task(600 + i, title=title, dept=dept, due_at=_day(shift),
                        parent_id=500 + (i % 3), parent_title=goal,
                        overdue=shift <= TODAY.weekday() - 1,
                        carry_count=2 if i == 0 else 0))
    return out


def accept_tasks() -> list:
    """Двадцать две задачи на приемке — столько их висит у руководителя на бою."""
    out = []
    for i in range(22):
        title = ACCEPT[i % len(ACCEPT)]
        who = PEOPLE[i % len(PEOPLE)]
        out.append(task(700 + i, title=title, status="review",
                        dept=["product", "marketing", "sales"][i % 3],
                        assignee_id=20 + i, assignee_name=who[0],
                        due_at=_day(-7 + i % 5),
                        parent_id=502 if i % 4 == 0 else None,
                        parent_title="План на ноябрь" if i % 4 == 0 else None))
    return out


def later_tasks() -> list:
    return [task(800 + i, title=f"Отложенное дело {i + 1}", due_at=None)
            for i in range(4)]


GOALS = [
    ("Собрать базу писем и подключить к ним агента", "product", 4, 0),
    ("Сделать «готовность ученика» рабочим показателем", "product", 0, 0),
    ("Сделать приемку этапа: результат вехи, оценка, акт", "product", 3, 1),
    ("План на ноябрь", "", 5, 5),
    ("Партнерская программа доведена до запуска", "marketing", 4, 1),
]


def goal_rows() -> list:
    out = []
    for i, (title, dept, total, done) in enumerate(GOALS):
        steps = [task(900 + i * 10 + j, title=f"Шаг {j + 1} цели «{title[:24]}»",
                      status="done" if j < done else "wait",
                      assignee_id=20 + j, assignee_name=PEOPLE[j % len(PEOPLE)][0],
                      parent_id=500 + i, parent_title=title)
                 for j in range(total)]
        out.append(task(500 + i, title=title, dept=dept, is_goal=True,
                        status="doing" if done else "wait",
                        due_at=_day(9) if i < 3 else None,
                        steps_total=total, steps_done=done, steps=steps))
    return out


def route(path: str, q: dict):
    """Ответ мока или None, если ручка не про задачи."""
    if path == "/admin/api/tasks":
        view = q.get("view", "")
        if view == "goals":
            return {"tasks": goal_rows(), "can_all": True, "me": ME_ID}
        if view == "review":
            return {"tasks": accept_tasks(), "can_all": True, "me": ME_ID}
        if view == "later":
            return {"tasks": later_tasks(), "can_all": True, "me": ME_ID}
        if view == "week":
            return {"tasks": week_tasks(), "can_all": True, "me": ME_ID,
                    "week_starts": str(MON),
                    "week_label": f"{MON.day}-{(MON + timedelta(days=6)).day} ноября"}
        return {"tasks": [], "can_all": True, "me": ME_ID}
    if path == "/admin/api/rhythm":
        return {"ok": True, "cap": 50, "load": len(WEEK),
                "label": f"{MON.day}-{(MON + timedelta(days=6)).day} ноября",
                "plan": {"given": True}, "report": {"given": False}}
    if path == "/admin/api/tasks/summary":
        return {"ok": True, "open": len(WEEK), "overdue": 4, "review": 3,
                "to_accept": 22, "week": len(WEEK)}
    if path == "/admin/api/tasks/goals":
        return {"goals": [{"id": g["id"], "title": g["title"], "dept": g["dept"],
                           "is_goal": True, "assignee_name": "Демо Руководитель"}
                          for g in goal_rows()]}
    return None
