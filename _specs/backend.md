# Backend spec — CRM: правка инфы клиента, финансовая аналитика, полнота docs/payments

Источник правды по форме данных: `eastside-backend/docs/contracts.md`. Эти контракты — про
**публичную воронку** (answers → diagnostics → plan). CRM-слой (lead_crm, client_docs,
client_payments) — внутренний, в contracts.md не описан, поэтому contracts.md **не трогаем**
(см. §0 ниже). Всё ниже — целые функции/SQL для копипасты.

---

## 0. Решение по хранению override клиентских полей

Имя/контакт/email и доп.поля сейчас приходят из `session_answers.answers` и из события
`lead_submitted` (booking) и **read-only** — это вход AI-пайплайна, исходник менять нельзя
(иначе разъедется то, на чём AI уже сгенерил диагностику + потеряем «что человек реально ввёл»).

**Хранение: JSONB-колонка `overrides` в `lead_crm`.** Обоснование:
- `lead_crm` уже 1:1 по `session_id` и уже является изменяемым CRM-слоем (status/note/tasks/comms) —
  override логически там же.
- JSONB, а не N колонок: набор переопределяемых полей **открытый** (name/contact/email + любые
  доп.поля карточки), не хотим миграцию на каждое новое поле; расширение анкеты не должно ломать форму
  (тот же принцип `extra="allow"`, что и в Pydantic-схемах).
- Эффективное значение считается мерджем: `override` поверх исходного. Источник никогда не мутируется.

**Эффективное значение (правило мерджа), применяется и в списке, и в детали:**
- `name`    = `overrides.name`    → `answers.name`    → `booking.name`
- `email`   = `overrides.email`   → `sessions.user_email`
- `contact` = `overrides.contact` → `booking.contact`  (в анкете контакта нет, только в booking)
- любые прочие ключи `overrides.*` отдаются в карточке как есть (доп.поля).

contracts.md описывает только AI-контракты воронки — `overrides` это поле CRM-стороны, формы
AI-данных не меняет, поэтому правок contracts.md нет.

---

## 1. SQL миграция целиком — `migrations/008_crm_overrides_finance.sql`

> Уже создана в репо по этому пути. Не забудь добавить имя в `_auto_migrate` (см. §5).

```sql
-- EastSide AI — CRM v4: переопределение клиентских полей из админки + финансы.
-- Идемпотентна: безопасно перезапускать. Самоприменяется при старте (app/main.py _auto_migrate).
SET search_path TO eastside, public;

-- ── 1. Override клиентских полей ────────────────────────────────────────────
ALTER TABLE lead_crm
    ADD COLUMN IF NOT EXISTS overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 2. Финансы: статус/правка оплаты + связь с продуктом каталога ────────────
ALTER TABLE client_payments
    ADD COLUMN IF NOT EXISTS product_id text;

CREATE INDEX IF NOT EXISTS client_payments_status   ON client_payments(status);
CREATE INDEX IF NOT EXISTS client_payments_paid_at  ON client_payments(paid_at);
CREATE INDEX IF NOT EXISTS client_payments_product  ON client_payments(product_id);
```

---

## 2. Изменённые функции `app/routers/admin.py` (целиком)

### 2.0 Хелпер мерджа эффективных значений (новый, добавить рядом с `_j`/`_fmt`)

```python
# Эффективные клиентские поля: override (правка из CRM) поверх исходных
# (answers/booking/session). Исходник read-only — меняется только overrides.
def _effective_client(overrides: dict, answers: dict, booking: dict | None,
                      user_email: str | None) -> dict:
    overrides = overrides or {}
    answers = answers or {}
    booking = booking or {}
    eff = {
        "name": overrides.get("name") or answers.get("name") or booking.get("name"),
        "email": overrides.get("email") or user_email,
        "contact": overrides.get("contact") or booking.get("contact"),
    }
    # доп.поля карточки, заданные вручную из CRM (всё, что не базовая тройка)
    extra = {k: v for k, v in overrides.items() if k not in ("name", "email", "contact")}
    if extra:
        eff["extra"] = extra
    return eff
```

### 2.1 `admin_leads` — список лидов (отдаёт эффективные значения)

Меняется: в SELECT добавлен `c.overrides`; имя/email берутся через `_effective_client`;
в ответ добавлен блок `crm.overrides` (чтобы фронт знал, что переопределено).

```python
@router.get("/admin/api/leads")
async def admin_leads(k: str = Query(""), limit: int = Query(500, ge=1, le=2000)):
    """JSON-список лидов для CRM: сессии со сводкой (имя, балл, статус воронки,
    запись на разбор, контакт). Свежие сверху. Доступ — owner или manager.
    Имя/email/контакт отдаются ЭФФЕКТИВНЫЕ: override из CRM поверх исходных."""
    await require_user(k)

    async with acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT s.id, s.created_at, s.updated_at, s.user_email, s.referrer,
                   s.status_diagnostics, s.status_roadmap, s.status_products,
                   a.answers,
                   d.output AS diag_output, d.error_message AS diag_error,
                   c.status AS crm_status, c.note AS crm_note, c.updated_at AS crm_updated_at,
                   c.tasks AS crm_tasks, c.comms AS crm_comms, c.overrides AS crm_overrides
            FROM eastside.sessions s
            LEFT JOIN eastside.session_answers a ON a.session_id = s.id
            LEFT JOIN eastside.ai_outputs d
                   ON d.session_id = s.id AND d.stage = 'diagnostics'
            LEFT JOIN eastside.lead_crm c ON c.session_id = s.id
            ORDER BY s.created_at DESC
            LIMIT $1
            """,
            limit,
        )
        ids = [r["id"] for r in rows]
        ev_rows = await conn.fetch(
            "SELECT session_id, event_type, payload, created_at "
            "FROM eastside.session_events WHERE session_id = ANY($1::uuid[]) "
            "ORDER BY created_at",
            ids,
        ) if ids else []

    events_by_session: dict = {}
    for ev in ev_rows:
        events_by_session.setdefault(ev["session_id"], []).append(ev)

    leads = []
    for r in rows:
        answers = _j(r["answers"]) or {}
        diag = _j(r["diag_output"]) or {}
        overrides = _j(r["crm_overrides"]) or {}
        evs = events_by_session.get(r["id"], [])

        booking = None
        for ev in reversed(evs):
            if ev["event_type"] == "lead_submitted":
                p = _j(ev["payload"]) or {}
                booking = {
                    "name": p.get("name"),
                    "contact": p.get("contact"),
                    "slot": p.get("slot"),
                    "channel": p.get("channel"),
                    "at": ev["created_at"].isoformat(),
                }
                break

        eff = _effective_client(overrides, answers, booking, r["user_email"])

        # Статус лида по воронке: запись > диагностика > анкета > просто зашел.
        if booking:
            lead_status = "booked"
        elif r["status_diagnostics"] == "done" and answers:
            lead_status = "diagnosed"
        elif answers:
            lead_status = "submitted"
        else:
            lead_status = "visited"

        # Докуда дошел в анкете (для воронки «Путь» в CRM): max шаг из anketa_step.
        # Плюс гео по IP (событие geo с платформы) — город/страна лида.
        anketa_max_step = 0
        geo = None
        for ev in evs:
            if ev["event_type"] == "anketa_step":
                p = _j(ev["payload"]) or {}
                try:
                    anketa_max_step = max(anketa_max_step, int(p.get("step") or 0))
                except (TypeError, ValueError):
                    pass
            elif ev["event_type"] == "geo" and geo is None:
                g = _j(ev["payload"]) or {}
                if g.get("city"):
                    geo = {"city": g.get("city"), "region": g.get("region"), "country": g.get("country")}

        verdict = diag.get("verdict")
        if isinstance(verdict, dict):
            verdict = verdict.get("text")

        last_at = evs[-1]["created_at"] if evs else r["updated_at"] or r["created_at"]
        leads.append({
            "id": str(r["id"]),
            "created_at": r["created_at"].isoformat() if r["created_at"] else None,
            "last_activity": last_at.isoformat() if last_at else None,
            "name": eff["name"],
            "email": eff["email"],
            "contact": eff["contact"],
            "status": lead_status,
            "score": diag.get("score"),
            "verdict": verdict,
            "diag_error": r["diag_error"],
            "stages": {
                "diagnostics": r["status_diagnostics"],
                "roadmap": r["status_roadmap"],
                "products": r["status_products"],
            },
            "grade": answers.get("grade"),
            "target_year": answers.get("target_year"),
            "directions": answers.get("directions"),
            "booking": booking,
            "events": [e["event_type"] for e in evs],
            "anketa_max_step": anketa_max_step,
            "geo": geo,
            "crm": {
                "status": r["crm_status"] or "new",
                "note": r["crm_note"] or "",
                "updated_at": r["crm_updated_at"].isoformat() if r["crm_updated_at"] else None,
                "tasks": _j(r["crm_tasks"]) or [],
                "comms": _j(r["crm_comms"]) or [],
                "overrides": overrides,
            },
        })

    return {"leads": leads, "total": len(leads)}
```

### 2.2 `admin_lead_detail` — карточка (эффективные значения + сырьё для UI «что переопределено»)

Меняется: добавлены `overrides` в SELECT crm; `name/email/contact` — эффективные; в ответ
добавлены `source` (исходные значения, чтобы UI показал «было → стало») и `crm.overrides`.
Также в payments добавлено `product_id`.

```python
@router.get("/admin/api/leads/{session_id}")
async def admin_lead_detail(session_id: UUID, k: str = Query("")):
    """Полная карточка лида для CRM: анкета, выходы всех AI-стадий, события,
    запись на разбор, CRM-статус. Имя/email/контакт — ЭФФЕКТИВНЫЕ (override
    поверх исходных). source[] — исходные значения для UI «было → стало»."""
    await require_user(k)

    async with acquire() as conn:
        sess = await conn.fetchrow(
            "SELECT id, created_at, user_email FROM eastside.sessions WHERE id = $1",
            session_id,
        )
        if sess is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "lead not found")
        ans_row = await conn.fetchrow(
            "SELECT answers FROM eastside.session_answers WHERE session_id = $1", session_id
        )
        outs = await conn.fetch(
            "SELECT stage, output, error_message FROM eastside.ai_outputs WHERE session_id = $1",
            session_id,
        )
        events = await conn.fetch(
            "SELECT event_type, payload, created_at FROM eastside.session_events "
            "WHERE session_id = $1 ORDER BY created_at",
            session_id,
        )
        crm = await conn.fetchrow(
            "SELECT status, note, updated_at, tasks, comms, overrides "
            "FROM eastside.lead_crm WHERE session_id = $1",
            session_id,
        )
        doc_rows = await conn.fetch(
            "SELECT id, name, kind, status, mime, link, size_bytes, created_at "
            "FROM eastside.client_docs WHERE session_id = $1 ORDER BY created_at DESC",
            session_id,
        )
        pay_rows = await conn.fetch(
            "SELECT id, title, amount_rub, status, paid_at, note, product_id, created_at "
            "FROM eastside.client_payments WHERE session_id = $1 ORDER BY created_at DESC",
            session_id,
        )

    by_stage = {r["stage"]: _j(r["output"]) for r in outs}
    answers = (_j(ans_row["answers"]) if ans_row else {}) or {}
    overrides = (_j(crm["overrides"]) if crm else {}) or {}
    ev_list = [
        {"type": r["event_type"], "payload": _j(r["payload"]),
         "at": r["created_at"].isoformat() if r["created_at"] else None}
        for r in events
    ]
    booking = next(
        (e["payload"] for e in reversed(ev_list) if e["type"] == "lead_submitted"), None
    )

    eff = _effective_client(overrides, answers, booking, sess["user_email"])
    source = {  # исходные (read-only) значения — UI показывает «было → стало»
        "name": answers.get("name") or (booking or {}).get("name"),
        "email": sess["user_email"],
        "contact": (booking or {}).get("contact"),
    }

    return {
        "id": str(session_id),
        "created_at": sess["created_at"].isoformat() if sess["created_at"] else None,
        "email": eff["email"],
        "name": eff["name"],
        "contact": eff["contact"],
        "source": source,
        "answers": answers,
        "questions": QUESTIONS,
        "diagnostics": by_stage.get("diagnostics"),
        "roadmap": by_stage.get("roadmap"),
        "products": by_stage.get("products"),
        "stage_errors": {r["stage"]: r["error_message"] for r in outs if r["error_message"]},
        "booking": booking,
        "events": ev_list,
        "crm": {
            "status": crm["status"] if crm else "new",
            "note": crm["note"] if crm else "",
            "updated_at": crm["updated_at"].isoformat() if crm and crm["updated_at"] else None,
            "tasks": (_j(crm["tasks"]) if crm else []) or [],
            "comms": (_j(crm["comms"]) if crm else []) or [],
            "overrides": overrides,
        },
        "docs": [
            {
                "id": d["id"], "name": d["name"], "kind": d["kind"], "status": d["status"],
                "mime": d["mime"], "link": d["link"], "size_bytes": d["size_bytes"],
                "has_file": d["mime"] is not None and d["link"] is None,
                "created_at": d["created_at"].isoformat() if d["created_at"] else None,
            }
            for d in doc_rows
        ],
        "payments": [
            {
                "id": p["id"], "title": p["title"], "amount_rub": p["amount_rub"],
                "status": p["status"], "paid_at": p["paid_at"].isoformat() if p["paid_at"] else None,
                "note": p["note"], "product_id": p["product_id"],
                "created_at": p["created_at"].isoformat() if p["created_at"] else None,
            }
            for p in pay_rows
        ],
    }
```

### 2.3 `CrmPatch` + `admin_lead_patch` — расширены под правку клиентских полей

Меняется: в модель добавлены `name/contact/email` и свободный `overrides: dict`. PATCH
мерджит их в `lead_crm.overrides` (частичное обновление: пустую строку трактуем как
«сбросить override» — удаляем ключ, чтобы вернуть исходное значение). Остальное (status/
note/tasks/comms) — без изменений.

```python
class CrmPatch(BaseModel):
    status: str | None = None
    note: str | None = None
    tasks: list | None = None
    comms: list | None = None
    # ── Правка клиентских полей (override поверх анкеты/booking). ──
    # "" => сбросить override (вернуть исходное); None => не трогать ключ.
    name: str | None = None
    contact: str | None = None
    email: str | None = None
    # любые доп.поля карточки разом (мердж в overrides)
    overrides: dict | None = None


@router.patch("/admin/api/leads/{session_id}")
async def admin_lead_patch(session_id: UUID, body: CrmPatch, k: str = Query("")):
    """Обновить CRM-статус/заметку/задачи/коммуникации И переопределить клиентские
    поля (имя/контакт/email + доп.поля). Upsert в lead_crm. tasks/comms приходят
    целиком (полная замена). overrides мерджатся частично: ключ со значением ""
    удаляется (сброс к исходному), None — не трогается."""
    await require_user(k)
    if body.status is not None and body.status not in CRM_STATUSES:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad status")

    # Собрать патч overrides из именованных полей + свободного словаря.
    ov_patch: dict = dict(body.overrides) if body.overrides else {}
    for fld in ("name", "contact", "email"):
        v = getattr(body, fld)
        if v is not None:
            ov_patch[fld] = v

    nothing = (
        body.status is None and body.note is None and body.tasks is None
        and body.comms is None and not ov_patch
    )
    if nothing:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")

    tasks_json = json.dumps(body.tasks, ensure_ascii=False) if body.tasks is not None else None
    comms_json = json.dumps(body.comms, ensure_ascii=False) if body.comms is not None else None

    async with acquire() as conn:
        exists = await conn.fetchval(
            "SELECT 1 FROM eastside.sessions WHERE id = $1", session_id
        )
        if not exists:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "lead not found")

        # Гарантируем строку lead_crm и применяем не-override поля.
        await conn.execute(
            """
            INSERT INTO eastside.lead_crm (session_id, status, note, tasks, comms, updated_at)
            VALUES ($1, COALESCE($2, 'new'), COALESCE($3, ''),
                    COALESCE($4::jsonb, '[]'::jsonb), COALESCE($5::jsonb, '[]'::jsonb), now())
            ON CONFLICT (session_id) DO UPDATE SET
                status = COALESCE($2, lead_crm.status),
                note   = COALESCE($3, lead_crm.note),
                tasks  = COALESCE($4::jsonb, lead_crm.tasks),
                comms  = COALESCE($5::jsonb, lead_crm.comms),
                updated_at = now()
            """,
            session_id, body.status, body.note, tasks_json, comms_json,
        )

        # Мердж overrides: непустые ключи пишем, ключи с "" удаляем (сброс).
        if ov_patch:
            set_keys = {k2: v2 for k2, v2 in ov_patch.items() if v2 != ""}
            del_keys = [k2 for k2, v2 in ov_patch.items() if v2 == ""]
            await conn.execute(
                """
                UPDATE eastside.lead_crm
                SET overrides = (overrides || $2::jsonb) - $3::text[],
                    updated_at = now()
                WHERE session_id = $1
                """,
                session_id,
                json.dumps(set_keys, ensure_ascii=False),
                del_keys,
            )

        row = await conn.fetchrow(
            "SELECT status, note, tasks, comms, overrides, updated_at "
            "FROM eastside.lead_crm WHERE session_id = $1",
            session_id,
        )

    return {
        "ok": True,
        "crm": {
            "status": row["status"],
            "note": row["note"],
            "tasks": _j(row["tasks"]) or [],
            "comms": _j(row["comms"]) or [],
            "overrides": _j(row["overrides"]) or {},
            "updated_at": row["updated_at"].isoformat(),
        },
    }
```

> Примечание по `(overrides || $2) - $3::text[]`: оператор `jsonb - text[]` удаляет верхнеуровневые
> ключи. PostgreSQL поддерживает его с 10+ (Supabase — 15+), так что ок.

---

## 3. Финансовая аналитика — `GET /admin/api/finance` (новый эндпоинт)

**Нужен ли отдельный эндпоинт?** Да. Клиентская агрегация по `client_payments` не хватает:
детальный список оплат отдаётся только в карточке **одного** лида (`admin_lead_detail`), а
дашборду нужен срез по **всем** лидам (всего/оплачено/ожидается/возвраты, по продуктам, по
месяцам, топ-клиенты, средний чек). Тянуть на фронт все оплаты всех лидов ради агрегатов —
дорого и не масштабируется; агрегаты считает SQL. Доступ — **owner only** (деньги).

Добавить в конец `admin.py` (использует уже импортированные `Query`, `acquire`, `require_owner`):

```python
# ════════ Финансовая аналитика (агрегаты по всем оплатам) ════════════════════

@router.get("/admin/api/finance")
async def admin_finance(k: str = Query(""), months: int = Query(12, ge=1, le=36)):
    """Сводка по деньгам для дашборда владельца: всего/оплачено/ожидается/возвраты,
    по продуктам, по месяцам, топ-клиенты, средний чек. Только owner.
    amount считаем в рублях (int). months — глубина помесячного среза."""
    await require_owner(k)

    async with acquire() as conn:
        # Тоталы по статусам.
        totals = await conn.fetchrow(
            """
            SELECT
              COALESCE(SUM(amount_rub), 0)                                          AS total,
              COALESCE(SUM(amount_rub) FILTER (WHERE status = 'paid'), 0)           AS paid,
              COALESCE(SUM(amount_rub) FILTER (WHERE status = 'pending'), 0)        AS pending,
              COALESCE(SUM(amount_rub) FILTER (WHERE status = 'refunded'), 0)       AS refunded,
              COUNT(*)                                                              AS count_all,
              COUNT(*) FILTER (WHERE status = 'paid')                               AS count_paid
            FROM eastside.client_payments
            """
        )

        # По продуктам (paid). product_id может быть NULL -> «без продукта».
        by_product = await conn.fetch(
            """
            SELECT COALESCE(p.product_id, '—')              AS product_id,
                   COALESCE(pr.name, 'Без продукта')        AS name,
                   COALESCE(SUM(p.amount_rub), 0)           AS sum_rub,
                   COUNT(*)                                 AS cnt
            FROM eastside.client_payments p
            LEFT JOIN eastside.products pr ON pr.id = p.product_id
            WHERE p.status = 'paid'
            GROUP BY 1, 2
            ORDER BY sum_rub DESC
            """
        )

        # По месяцам (paid, по paid_at; без даты не попадает в помесячный срез).
        by_month = await conn.fetch(
            """
            SELECT to_char(date_trunc('month', paid_at), 'YYYY-MM') AS month,
                   COALESCE(SUM(amount_rub), 0)                      AS sum_rub,
                   COUNT(*)                                          AS cnt
            FROM eastside.client_payments
            WHERE status = 'paid' AND paid_at IS NOT NULL
              AND paid_at >= (date_trunc('month', now()) - make_interval(months => $1 - 1))
            GROUP BY 1
            ORDER BY 1
            """,
            months,
        )

        # Топ-клиенты по оплаченному. Имя — эффективное: override -> answers -> booking.
        # booking берём из последнего события lead_submitted.
        top_clients = await conn.fetch(
            """
            WITH pay AS (
              SELECT session_id, SUM(amount_rub) AS sum_rub, COUNT(*) AS cnt
              FROM eastside.client_payments
              WHERE status = 'paid'
              GROUP BY session_id
            ),
            book AS (
              SELECT DISTINCT ON (session_id)
                     session_id, payload->>'name' AS bname
              FROM eastside.session_events
              WHERE event_type = 'lead_submitted'
              ORDER BY session_id, created_at DESC
            )
            SELECT pay.session_id,
                   pay.sum_rub,
                   pay.cnt,
                   COALESCE(
                     c.overrides->>'name',
                     a.answers->>'name',
                     book.bname,
                     'Без имени'
                   ) AS name
            FROM pay
            LEFT JOIN eastside.lead_crm c        ON c.session_id = pay.session_id
            LEFT JOIN eastside.session_answers a ON a.session_id = pay.session_id
            LEFT JOIN book                       ON book.session_id = pay.session_id
            ORDER BY pay.sum_rub DESC
            LIMIT 10
            """
        )

    count_paid = int(totals["count_paid"] or 0)
    paid = int(totals["paid"] or 0)
    avg_check = round(paid / count_paid) if count_paid else 0

    return {
        "totals": {
            "total": int(totals["total"]),
            "paid": paid,
            "pending": int(totals["pending"]),
            "refunded": int(totals["refunded"]),
            "count_all": int(totals["count_all"]),
            "count_paid": count_paid,
            "avg_check_rub": avg_check,
        },
        "by_product": [
            {"product_id": r["product_id"], "name": r["name"],
             "sum_rub": int(r["sum_rub"]), "count": int(r["cnt"])}
            for r in by_product
        ],
        "by_month": [
            {"month": r["month"], "sum_rub": int(r["sum_rub"]), "count": int(r["cnt"])}
            for r in by_month
        ],
        "top_clients": [
            {"session_id": str(r["session_id"]), "name": r["name"],
             "sum_rub": int(r["sum_rub"]), "count": int(r["cnt"])}
            for r in top_clients
        ],
    }
```

---

## 4. Полнота эндпоинтов docs/payments — что было и что добавить

Текущие (есть): `POST docs`, `GET docs/{id}/download`, `DELETE docs/{id}`,
`POST payments`, `DELETE payments/{id}`.

**Чего не хватает для нормального UX:**

1. **PATCH статуса/полей документа** (получен → проверен → нужна замена и т.п.) —
   сейчас статус можно задать только при загрузке, поменять нельзя (только удалить и залить заново).
2. **PATCH оплаты** (правка статуса pending→paid, суммы, даты, привязка product_id) —
   сейчас оплату нельзя отредактировать, только удалить. Для «выставил счёт (pending) →
   пришли деньги (paid)» это обязательно.
3. **product_id при создании оплаты** («применить» продукт каталога к оплате) — нужно для
   финансовой аналитики по продуктам. Добавляется в `PaymentBody` + INSERT.

`download` для внешних `link` уже отдаёт `{link}` — фронт сам открывает; для inline-файла отдаёт
bytes. Этого достаточно (add/delete/download закрыты). Добавляем два PATCH + product_id в add.

### 4.1 `PaymentBody` + `add_payment` (добавлен `product_id`)

```python
class PaymentBody(BaseModel):
    title: str
    amount_rub: int = 0
    status: str = "paid"
    paid_at: str | None = None
    note: str | None = None
    product_id: str | None = None   # привязка к продукту каталога (для финансов)


@router.post("/admin/api/leads/{session_id}/payments")
async def add_payment(session_id: UUID, body: PaymentBody, k: str = Query("")):
    await require_user(k)
    if body.status not in ("paid", "pending", "refunded"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad status")
    paid = None
    if body.paid_at:
        from datetime import date
        try:
            paid = date.fromisoformat(body.paid_at[:10])
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad date")
    async with acquire() as conn:
        exists = await conn.fetchval("SELECT 1 FROM eastside.sessions WHERE id = $1", session_id)
        if not exists:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "lead not found")
        row = await conn.fetchrow(
            """
            INSERT INTO eastside.client_payments
                (session_id, title, amount_rub, status, paid_at, note, product_id)
            VALUES ($1,$2,$3,$4,$5,$6,$7)
            RETURNING id, created_at
            """,
            session_id, body.title, body.amount_rub, body.status, paid, body.note, body.product_id,
        )
    return {"ok": True, "id": row["id"], "created_at": row["created_at"].isoformat()}
```

### 4.2 PATCH оплаты (новый)

```python
class PaymentPatch(BaseModel):
    title: str | None = None
    amount_rub: int | None = None
    status: str | None = None
    paid_at: str | None = None
    note: str | None = None
    product_id: str | None = None


@router.patch("/admin/api/payments/{payment_id}")
async def patch_payment(payment_id: int, body: PaymentPatch, k: str = Query("")):
    """Правка оплаты: статус (pending→paid), сумма, дата, привязка к продукту.
    Передаются только меняемые поля; None — не трогать."""
    await require_user(k)
    if body.status is not None and body.status not in ("paid", "pending", "refunded"):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad status")
    paid = None
    if body.paid_at:
        from datetime import date
        try:
            paid = date.fromisoformat(body.paid_at[:10])
        except ValueError:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "bad date")
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE eastside.client_payments SET
                title      = COALESCE($2, title),
                amount_rub = COALESCE($3, amount_rub),
                status     = COALESCE($4, status),
                paid_at    = COALESCE($5, paid_at),
                note       = COALESCE($6, note),
                product_id = COALESCE($7, product_id)
            WHERE id = $1
            RETURNING id, title, amount_rub, status, paid_at, note, product_id, created_at
            """,
            payment_id, body.title, body.amount_rub, body.status, paid, body.note, body.product_id,
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "payment not found")
    return {
        "ok": True,
        "payment": {
            "id": row["id"], "title": row["title"], "amount_rub": row["amount_rub"],
            "status": row["status"], "paid_at": row["paid_at"].isoformat() if row["paid_at"] else None,
            "note": row["note"], "product_id": row["product_id"],
            "created_at": row["created_at"].isoformat(),
        },
    }
```

> Гоча: `paid_at` через `COALESCE` нельзя обнулить (передача null = «не трогать»). Для CRM-учёта
> это норма — дату оплаты не сбрасывают. Если понадобится явный сброс, ввести sentinel-флаг.

### 4.3 PATCH документа (новый)

```python
class DocPatch(BaseModel):
    name: str | None = None
    kind: str | None = None
    status: str | None = None


@router.patch("/admin/api/docs/{doc_id}")
async def patch_doc(doc_id: int, body: DocPatch, k: str = Query("")):
    """Правка метаданных документа: имя/тип/статус (получен→проверен→нужна замена).
    Сам файл не меняется — для замены файла удалить и загрузить заново."""
    await require_user(k)
    if body.name is None and body.kind is None and body.status is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "nothing to update")
    async with acquire() as conn:
        row = await conn.fetchrow(
            """
            UPDATE eastside.client_docs SET
                name   = COALESCE($2, name),
                kind   = COALESCE($3, kind),
                status = COALESCE($4, status)
            WHERE id = $1
            RETURNING id, name, kind, status
            """,
            doc_id, body.name, body.kind, body.status,
        )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "doc not found")
    return {"ok": True, "doc": {"id": row["id"], "name": row["name"],
                                "kind": row["kind"], "status": row["status"]}}
```

---

## 5. Регистрация миграции в `_auto_migrate` (`app/main.py`)

Добавить `008_...` в кортеж (и обновить докстринг):

```python
    for fname in ("006_lead_crm_v2.sql", "007_crm_users_docs.sql",
                  "008_crm_overrides_finance.sql"):
```

---

## 6. Порядок применения и деплой

1. Файл `migrations/008_crm_overrides_finance.sql` уже в репо (создан этой задачей).
2. Внести правки `app/routers/admin.py` (§2.0–2.3, §3, §4) и `app/main.py` (§5).
3. Применить миграцию: либо автоматически при старте (после §5 деплой сам прогонит 008,
   идемпотентно), либо вручную в Supabase → SQL Editor вставить 008 — безопасно повторно.
4. Деплой бэка: `git push` → Railway (push-to-deploy). На старте `_auto_migrate` прогонит 008.
5. Проверка после деплоя:
   - `PATCH /admin/api/leads/{id}` с `{"name":"Новое имя"}` → `GET` списка/детали отдаёт новое имя,
     `crm.overrides.name` выставлен; `{"name":""}` сбрасывает к исходному.
   - `GET /admin/api/finance?k=<owner>` → 200 с totals/by_product/by_month/top_clients; под
     manager-токеном → 403.
   - `PATCH /admin/api/payments/{id}` с `{"status":"paid"}`; `PATCH /admin/api/docs/{id}` со статусом.

---

## 7. Риски

- **`jsonb - text[]`** (сброс override) требует Postgres 10+ — Supabase 15+, ок.
- **`/finance` — owner only**: если фронт-дашборд показывает деньги и менеджеру — отдать 403 он
  не должен; здесь сознательно закрыто (деньги). Если нужно manager-у — поменять `require_owner`
  на `require_user`.
- **`product_id` без FK**: оплата переживает удаление продукта из каталога; в `by_product` такой
  id отрендерится с `name='Без продукта'` (LEFT JOIN). Сознательно, чтобы не терять историю денег.
- **`top_clients` по `lead_submitted`**: имя берётся из последнего booking-события; если оплата есть,
  а booking не было — сработает override/answers, иначе «Без имени». Не баг, ожидаемо.
- **`avg_check`** считается только по `paid` (не по всем) — это средний чек по реальным деньгам.
- **`paid_at` помесячно**: оплаты без `paid_at` (напр. `pending`) не попадают в `by_month` —
  ожидаемо, помесячный срез только по фактически оплаченному.
- **Override read-only исходника**: AI-стадии и публичная аналитика (`GET /admin/{id}` HTML)
  по-прежнему читают исходные `answers` — override живёт только в JSON-API CRM. HTML-страница
  лида (`_render`) имя override НЕ покажет (она для телеграм-ссылки, не для CRM) — это осознанно;
  если надо — отдельная мелкая правка `admin_session`, в скоуп не входит.
```