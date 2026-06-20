# План интеграции CRM v7 — DASH + LIST + MODAL + FINANCE + BACKEND

Единый план применения пяти спек к `crm/app.js`, `crm/style.css` и бэку. Источник правды по
пересечениям зафиксирован ниже. Применять строго в указанном порядке.

---

## 0. Карта владения функциями (кто что трогает)

| Функция / класс | Владелец | Прочие касаются |
|---|---|---|
| `.content`/`.chead`/`.verdict`/`.grid`/`.dash`/`.shim`/`@keyframes shimmer` | DASH | LIST/FINANCE только используют |
| `.sev*` (CSS) + `sevPill` + `openSmenu` + `#smenu` | LIST | все рендерят `.sev` |
| `renderDash`/`statBar`/`tasksCard`/`dashCounts`/`dashSkeleton` | DASH | — |
| `leadsToolbar`/`segLeads`/`fillTable`/`fillKanban`/`renderListBody`/`emptyState`/`thCell`/`sortMark` | LIST | — |
| `renderDrawer`/`renderModalContent`/`buildNow`/`buildPathSection`/`buildNotesSection`/`buildDocsSection`/`buildAiSections`/`skeletonSection`/`ov`/`bindInline` | MODAL | FINANCE+MODAL делят `buildPaySection`+`attachContentHandlers` |
| `buildPaySection`/PAY_ST + pay-обработчик в `attachContentHandlers` | FINANCE | MODAL добавляет в ту же `attachContentHandlers` ef-inline |
| `renderFinance`/`finDonut`/`fetchFinance`/`NAV_ALL`/`renderTopbar`/`renderHead`/`setPage`/`renderView` (finance-ветки) | FINANCE | DASH/MODAL тоже правят `renderTopbar`/`renderHead`/`renderView` |

---

## 1. ПОРЯДОК ПРИМЕНЕНИЯ (минимизирует поломку рендера)

Применять снизу пайплайна вверх: сначала helpers и CSS-фундамент, потом листовые билдеры,
в последнюю очередь — общие диспетчеры (`renderTopbar`/`renderHead`/`renderView`/`renderDash`),
которые видят все ветки сразу.

1. **Бэк (отдельный репозиторий/деплой, можно параллельно)** — миграция 008 + admin.py.
   Деплой бэка ПЕРВЫМ или одновременно: фронт-фичи имеют fallback, но override и finance
   без бэка работают вхолостую.
2. **CSS-фундамент (DASH)**: `.content`/`.chead`/`.verdict` (2.1), `.grid` (2.2), блок
   `.dash`/`.dperiod`/`.tasks-*`/`.shim`/`@keyframes shimmer`/`.sk-*` (2.3). Один `@keyframes
   shimmer` — здесь и только здесь.
3. **CSS статус-пилюль (LIST 2.1–2.2)**: заменить `.sev … .sev.s-rejected` (стр. 254–264) +
   `#smenu button .dt` → `.smenu-status` (стр. 770). **Удалить временный фолбэк `.shim` из
   LIST 2.6** — берём `.shim` из DASH.
4. **CSS списка (LIST 2.3–2.6)**: тулбар-чипы, `.list-count`, `.s-clear`, `.th.sortable`,
   `.list-empty`, `.sk-list/.sk-row/.sk-cell` (без второго `.shim`).
5. **CSS модалки (MODAL 2a)**: заменить блок `.mbg … .mech` (стр. 437→ конец оплат/таймлайна).
   **ВАЖНО**: MODAL-блок включает свой `.sk` (пульс-скелетон модалки) и `@keyframes shimmer` —
   см. конфликт §2.E. Удалить мёртвые `.jrn*`/`.contact-line*`/`.stchips/.stc` (MODAL 2b).
6. **CSS оплат+финансов (FINANCE 2.1–2.3)**: заменить блок `/* оплаты */` (стр. 601–611) на
   `.pay-board/.pay-form/.pay-grid`, добавить блок «Финансы», правки мобилы.
7. **JS helpers**: `ov()`+`bindInline()` (MODAL 3.0), `quickPred`/`QUICK` (LIST 3.3),
   `dashCounts`/`groupTasks`/`tasksCard`/`dashSkeleton`/`listSkeleton` (DASH 3.3–3.5,3.8),
   `fetchFinance`/`finDonut`/`finMoney` (FINANCE 3.8–3.10), `thCell`/`emptyState`/`sortMark`
   (LIST 3.8), `coins`/`wallet` в `ic()` (FINANCE 3.1).
8. **JS state/saveUi**: добавить `dashPeriod` (DASH 3.1–3.2) И `finPeriod/finance/finLoading`
   (FINANCE 3.4) в ОДНУ правку `state`+`saveUi` (см. §4, чтобы не затереть друг друга).
9. **JS листовые билдеры**: `buildNow`/`buildPathSection`(+`buildPathTimeline`, удалить
   `buildJourney`)/`buildNotesSection`/`buildDocsSection`/`buildAiSections`(+`aiSec`)/
   `skeletonSection` (MODAL 3.1–3.8); `buildPaySection`+`PAY_ST` (FINANCE 3.11); `sevPill`/
   `openSmenu` (LIST 3.1–3.2); `segLeads`/`leadsToolbar`/`attachToolbarHandlers`/`fillTable`/
   `fillKanban`-empty/`renderListBody`+`fillSkeleton` (LIST 3.4–3.11).
10. **JS `attachContentHandlers`**: ОДНА согласованная правка — MODAL ef-inline добавки (3.9) +
    FINANCE pay-обработчик (3.12). Не двумя ревизиями (§4 чек-лист).
11. **JS общие диспетчеры (применять последними, разом)**: `renderDrawer`+`renderModalContent`
    (MODAL 3.1–3.2); `renderDash`+`renderView`-гард (DASH 3.6–3.7,3.9); `NAV_ALL`/`setPage`/
    `renderTopbar`/`renderHead`/`renderView`-маршрут/`startApp` (FINANCE 3.2–3.7,3.13).
    Удалить мёртвый хвост `renderHead` (стр. 835–873, LIST 3.6-примечание) — он вешает
    `change`-хендлеры на несуществующие нативные select.

---

## 2. РАЗРЕШЕНИЕ КОНФЛИКТОВ (решения зафиксированы)

**A. `.sev` статус-пилюли — источник истины LIST.** Применяем LIST 2.1 целиком (мягкий фон +
цветной текст, r8, БЕЗ точек, `.sev .d{display:none}`). Все остальные спеки рендерят `.sev` как
есть. КОНФЛИКТ РАЗМЕТКИ: DASH `renderDash` (acts-пилюли), MODAL/FINANCE `buildPaySection` и
`renderDrawer` всё ещё печатают `<span class="d"></span>` внутри `.sev`. Решение: `.d` глобально
скрыт CSS → точек нигде нет, разметку чистим оппортунистически (LIST уже чистит `sevPill`;
в DASH/FINANCE/MODAL `<span class="d">` оставить можно — безвреден). FINANCE-спека сама просит
оставить `.d` в pay-чипе — ОК, скроется.

**B. Шиммер `.shim` — источник истины DASH (dash.md 2.3).** Единый `.shim` +
`@keyframes shimmer`. LIST-фолбэк `.shim` (list.md 2.6) НЕ применять. MODAL имеет ОТДЕЛЬНЫЙ
класс `.sk` (пульс-скелетон модалки) — это другой класс, не конфликтует по имени, оставляем.

**C. ДУБЛЬ `@keyframes shimmer` (РИСК).** Его объявляют DASH (2.3) И блок модалки MODAL (2a,
`.sk::after` использует `animation: shimmer`). Если оба блока в одном файле — два одинаковых
`@keyframes shimmer` (1.5s vs 1.3s). Решение: оставить ОДНО объявление в DASH-блоке (1.5s);
в MODAL-блоке `.sk` ссылается на тот же `shimmer` — `@keyframes` из MODAL-вставки УДАЛИТЬ при
вставке (строка 400 спеки modal.md). Анимация `.sk` будет 1.3s через `.sk::after { animation:
shimmer 1.3s ... }` — это ОК, keyframes общий.

**D. Глобальные отступы `.content`/`.chead`/`.grid` — источник DASH.** LIST/FINANCE их НЕ
переопределяют (list.md §E это подтверждает). FINANCE рендерит свой `.grid` с инлайн
`margin-top:18px` (renderFinance) — это допустимо (отдельная страница), но для единого ритма
лучше обернуть в `.dash` или убрать инлайн; НЕ обязательно. `.verdict .vspark` нужен и DASH, и
FINANCE (renderHead finance-ветка) — он в DASH-блоке, FINANCE переиспользует.

**E. Скелетоны — два уровня, не конфликтуют.** `dashSkeleton()` (DASH, страница dash),
`fillSkeleton()`/`listSkeleton()` (LIST, страница leads), `skeletonSection(kind)` (MODAL, секции
модалки, класс `.sk`). `renderView`-гард `!state.loaded`: DASH 3.7 и LIST 3.9 правят ОДИН блок
(стр. 886–889). Объединённое решение (§4): `if(page==='dash') dashSkeleton(); else if
(page==='leads') renderLeads(view); else listSkeleton/loadwrap`.

**F. Регистрация страницы «Финансы» (FINANCE).** `NAV_ALL` +1 пункт (owner). Маршрут в
`renderView`: порядок проверок — `dash → path → finance → leads(default)`. `renderTopbar`/
`renderHead`/`setPage`/`startApp` получают finance-ветки. ВАЖНО: FINANCE-спека `renderTopbar`
(3.5) переписывает функцию целиком и УБИРАЕТ dash-период-сегмент DASH (3.9). КОНФЛИКТ → §4.

**G. КОНФЛИКТ `renderTopbar` dash-ветка (DASH 3.9 vs FINANCE 3.5) — РЕШЕНИЕ.** Обе спеки
правят `renderTopbar`. FINANCE переписывает целиком, но в `else`-ветке (dash) оставляет старый
`freshchip` — это СОТРЁТ период-сегмент DASH. Решение: взять FINANCE-версию `renderTopbar` как
каркас (в ней есть finance-ветка) И вставить в неё DASH-период-сегмент в ветку `state.page===
'dash'` (заменив `freshchip` на `.dperiod` из DASH 3.9). Итог: leads→tabs, path→периоды,
finance→периоды, dash→`.dperiod`-сегмент. freshchip удаляется (решение DASH).

**H. КОНФЛИКТ `renderView` (3 спеки правят гард + маршрут).** Объединить в одну функцию (§4).

**I. КОНФЛИКТ `renderHead` (DASH владеет, FINANCE добавляет ветку, LIST удаляет хвост).**
Одна правка: оставить dash/leads/path ветки, ДОБАВИТЬ finance-ветку (FINANCE 3.6), УДАЛИТЬ
мёртвый хвост стр. 835–873 (LIST). Не трогать `<h2>Клиенты</h2>`.

**J. Палитра/токены — конфликтов НЕТ.** Проверено: `--red/--red-ink/--red-soft/--green-ink/
--amber-ink/--green-soft/--amber-soft/--ease/--r-pill/--r-xl/--navy/--blue-tint/--coral*` все
есть в `:root`. `--coral`==`--red`. Спеки используют корректные имена. FINANCE stColor хардкодит
hex (#18A957/#E0922F/#E5484D) == значения токенов — ОК, можно оставить.

---

## 3. КОНСОЛИДИРОВАННЫЙ СПИСОК CSS-КЛАССОВ (без дублей)

**Новые (DASH):** `.dash`, `.dperiod`(+button/.on), `.tasks-card`, `.tk-group`, `.tk-glabel`(+.over/.gn),
`.tk-row`(+.over), `.tk-main`,`.tk-txt`,`.tk-who`,`.tk-due`(+.over/.soon),`.tk-go`,`.tasks-empty`(+.te-ic),
`.shim`(+::after), `@keyframes shimmer` (ЕДИНСТВЕННОЕ), `.sk-statbar`,`.sk-stat`,`.sk-card`,`.sk-h`,`.sk-line`.

**Новые (LIST):** `.searchwrap.has-val`,`.s-clear`,`.list-count`,`.list-quick`,`.qchip`(+.hot/.on/.qn),
`.th.sortable`(+.act/.r),`.th .dir`(+.up svg),`.list-empty`(+.le-ic/.le-t/.le-s/.le-btn),
`.sk-list`,`.sk-row`,`.sk-cell`(+.pill/.w40/.w60/.w80), `#smenu.smenu-status`(+button/.chk/.cur).

**Новые (MODAL):** весь блок `.m-*` (m-head/m-navfloat/m-arrow/m-ava/m-id/m-name-row/m-name/m-edit/
m-sub/m-pulse/m-body/m-nav/m-ni/m-content/m-ctitle/m-csub/m-foot/m-sec/m-sec-h), `.now-do`(+calm/warn),
`.who`,`.ed-field`,`.ed-input`,`.ed-save`,`.slotchip`,`.stage-sec`,`.dr-rej`,`.pipe`,`.pstep`,
`.rej-banner`, `.path-tl`/`.pt-*`, `.doc-row`/`.doc-*`/`.dropzone`/`.linkrow`/`.icobtn`,
`.task`(+overdue)/`.task-*`/`.due-seg`, `.comm-btns`/`.comm-log`/`.comm-row`, `.ai-hero`/`.ah-*`/
`.ai-gap`/`.gr/.gk/.gv`, `.qa-fold`/`.qa-wrap`, `.sk`(+w35/w55/w75/w90/tall/row)/`.sk-rows`.

**Новые (FINANCE):** `.pay-board`,`.pay-cell`(+lead/muted/.pc-l/.pc-v),`.pay-amt`(+pending/refunded),
`.pay-form`,`.pay-seg`(+button),`.pay-grid`, `.fin-money`,`.fin-banner`,`.fin-stack`(+i.paid/pending/
refunded),`.fin-leg`(+.r/.dd2/.nm/.am),`.fin-months`/`.fin-mcol`/`.bar`(+peak)/`.fin-mlabels`,
`.fin-client`(+.fc-l/.fc-nm/.fc-track/.fc-am/.fc-sum/.fc-cnt), `.stat .sdot.gold`.

**Заменяются:** `.content`,`.chead`,`.verdict`,`.grid`,`.sev*`,`.th .dir`,весь `.mbg…mech`,блок оплат.
**Удаляются:** `.jrn*`,`.js-*`,`.contact-line*`,`.stchips`,`.stc*`,`#smenu button .dt`,
старые `.pay-sum`/`.pay-add`, временный LIST-фолбэк `.shim`, лишний `@keyframes shimmer` из MODAL.
**КОЛЛИЗИЯ ИМЁН `.sk`:** MODAL `.sk`=пульс-скелетон модалки; LIST `.sk-row/.sk-cell/.sk-list` и DASH
`.sk-statbar/.sk-stat/.sk-card`=другие префиксы. Конфликта нет (разные суффиксы), но НЕ путать
`.sk` (модалка) с `.sk-*` (списки/дашборд). `.dd2`/`.r`/`.am`/`.nm` в FINANCE-легенде — локальны
под `.fin-leg`/`.fin-stack` контекст, совпадают с `.dleg .r` донатов — проверить, что `finDonut`
переиспользует `.dleg`-стиль (он есть), а `.fin-leg .r` — отдельный.

---

## 4. ЧЕК-ЛИСТ ПРАВОК app.js (по функциям, источник кода)

- [ ] `state` (стр.15–22) — добавить `dashPeriod:''` (DASH 3.1) + `finPeriod:'',finance:null,finLoading:false` (FIN 3.4). ОДНА правка.
- [ ] загрузка savedUi (стр.24–27) — добавить `'dashPeriod'` в список (DASH 3.1).
- [ ] `saveUi` (стр.28–34) — добавить `dashPeriod` (DASH 3.2). finPeriod НЕ сохранять (эфемерно).
- [ ] `ic()` (стр.89) — добавить `coins`,`wallet` (FIN 3.1).
- [ ] `ov()`+`bindInline()` — вставить после `animBars` (~стр.239) (MODAL 3.0).
- [ ] `sevPill` (стр.468–473) — заменить, без `.d` (LIST 3.1).
- [ ] `openSmenu` (стр.481–501) — заменить на `.smenu-status` + мини-пилюли (LIST 3.2).
- [ ] `QUICK`+`quickPred` — вставить перед `segLeads` (LIST 3.3).
- [ ] `segLeads` (стр.355–391) — заменить, `quickPred()` вместо хардкода `attention` (LIST 3.4).
- [ ] `dashCounts`+`DPERIOD_LABEL` — после `counts()` (~стр.407) (DASH 3.3).
- [ ] `groupTasks` — после `dueTasks()` (~стр.439) (DASH 3.4).
- [ ] `leadsToolbar` (стр.533–547) — заменить (поиск+чипы+счётчик) (LIST 3.5).
- [ ] `attachToolbarHandlers`+`updateListCount` (стр.548–575) — заменить (LIST 3.6).
- [ ] `tasksCard` — после `statBar` (~стр.908) (DASH 3.5).
- [ ] `dashSkeleton`/`listSkeleton`/`shimStat`/`shimCard` — перед `renderDash` (DASH 3.8).
- [ ] `renderDash` (стр.910–1064) — заменить (dashCounts, tasksCard, `.dash`-обёртка, без задач в acts) (DASH 3.6).
- [ ] `renderView` (стр.883–893) — ОБЪЕДИНЁННАЯ правка: гард `!loaded` (dash→dashSkeleton, leads→renderLeads, else→listSkeleton) + маршрут finance перед leads (DASH 3.7,3.9 ∪ FIN 3.7).
- [ ] `renderListBody`+`fillSkeleton` (стр.1137–1142) — заменить (LIST 3.7).
- [ ] `fillTable` (стр.1144–1192) — заменить empty-ветку→`emptyState()`+le-clear, шапку→`thCell` (LIST 3.8).
- [ ] `thCell`/`emptyState` — рядом с `sortMark` (~стр.1381) (LIST 3.8).
- [ ] `sortMark` (стр.1381–1384) — заменить на svg-стрелку (LIST 3.8).
- [ ] `fillKanban` empty (стр.1230–1233) — заменить на `.list-empty` (LIST 3.11).
- [ ] `renderTopbar` (стр.767–800) — заменить ОБЪЕДИНЁННОЙ версией: FIN-каркас (leads/path/finance) + dash-ветка с `.dperiod` (§2.G; FIN 3.5 ∪ DASH 3.9).
- [ ] `renderHead` (стр.803–874) — добавить finance-ветку (FIN 3.6) + УДАЛИТЬ мёртвый хвост стр.835–873 (LIST 3.6-прим).
- [ ] `NAV_ALL` (стр.701–705) — +finance owner (FIN 3.2).
- [ ] `setPage` (стр.756–764) — догрузка finance (FIN 3.3).
- [ ] `renderModalContent` (стр.1521–1535) — заменить (MODAL 3.2).
- [ ] `skeletonSection` (стр.1536) — заменить на kind-каркас (MODAL 3.3).
- [ ] `renderDrawer` (стр.1449–1519) — заменить (тихая шапка, ov, pulse) (MODAL 3.1).
- [ ] `buildNow` (стр.1556–1598) — заменить (now-do+who+pipe) (MODAL 3.4).
- [ ] `buildJourney` (стр.1601–1617) — УДАЛИТЬ (MODAL 3.5).
- [ ] `buildPathSection` (стр.1618–1630) + `buildPathTimeline` — заменить/добавить (MODAL 3.5). `buildTimeline` НЕ трогать.
- [ ] `buildNotesSection` (стр.1633–1662) — заменить (MODAL 3.6).
- [ ] `buildDocsSection` (стр.1671–1689) — заменить (MODAL 3.7).
- [ ] `buildPaySection` (стр.1692–1711) + `PAY_ST` — заменить (FIN 3.11).
- [ ] `attachContentHandlers` (стр.1715–1816) — ДОБАВИТЬ ef-inline (MODAL 3.9) + ЗАМЕНИТЬ pay-обработчик (FIN 3.12). Одна согласованная правка, не затирать друг друга.
- [ ] `aiSec`+`buildAiSections` (стр.1828–1971) — заменить (MODAL 3.8). `sec()`/`buildTimeline` оставить.
- [ ] `fetchFinance`+`aggregatePayments`+`payConvLocal`+`fetchFinanceLocal`+`finMoney`+helpers — рядом с `loadLeads` (FIN 3.9).
- [ ] `renderFinance`+`finDonut` — после `renderPath` (~стр.1379) (FIN 3.10).
- [ ] `startApp` — сброс finance для не-owner (FIN 3.13).
- [ ] `patch()` — править НЕ нужно (override прилетает в `res.crm.overrides`, бэк §5; helper `ov()` читает оба ключа).

---

## 5. БЭКЕНД (backend.md — источник истины; modal/finance дублируют требования)

Файлы: `migrations/008_crm_overrides_finance.sql` (уже в репо), `app/routers/admin.py`, `app/main.py`.
contracts.md НЕ трогаем (CRM-слой в нём не описан).

**Шаги:**
1. Миграция 008 — добавляет `lead_crm.overrides jsonb`, `client_payments.product_id` + индексы
   (status/paid_at/product). Идемпотентна.
2. `admin.py`: helper `_effective_client` (override→answers/booking); `admin_leads` и
   `admin_lead_detail` отдают эффективные name/email/contact + `crm.overrides`; деталь +`source`
   (было→стало) и `product_id` в payments; `CrmPatch`+`admin_lead_patch` принимают
   `name/contact/email/overrides` (мердж в `overrides`, ""=сброс ключа); новый
   `GET /admin/api/finance` (owner only, агрегаты); `PaymentBody`+`add_payment` +`product_id`;
   новые `PATCH /admin/api/payments/{id}` и `PATCH /admin/api/docs/{id}`.
3. `app/main.py` `_auto_migrate` — добавить `008_crm_overrides_finance.sql`.

**Порядок деплоя:** миграция применяется авто на старте (после правки main.py) либо вручную в
Supabase SQL Editor (идемпотентна) → `git push` → Railway push-to-deploy. Можно деплоить ПЕРЕД
фронтом (фронт без него уходит в fallback/визуальный no-op, не падает).

**Влияние на фронт (новые поля в ответах):**
- `crm.overrides` в `/admin/api/leads` и `/admin/api/leads/{id}` — `ov()`/`bindInline` MODAL читают его.
- `source` в детали — UI «было→стало» (опционально, MODAL не обязателен).
- `product_id` в payments — FINANCE-аналитика по продуктам.
- `GET /admin/api/finance` — primary-источник `fetchFinance`; без него fallback по client-лидам с баннером.

**КОНФЛИКТ КОНТРАКТА `/admin/api/finance` (РИСК — зафиксировать!):** backend.md отдаёт
`{totals:{paid,pending,refunded,avg_check_rub,count_paid}, by_product:[{name,sum_rub,count}],
by_month:[{month,sum_rub,count}], top_clients:[{session_id,name,sum_rub,count}]}`. А FINANCE-фронт
(`fetchFinance`, finance.md 3.9) ждёт ПЛОСКИЕ `{paid_total,pending_total,refunded_total,paid_count,
avg_check, by_product:[{title,amount,count}], by_month:[{ym,amount}], top_clients:[{lead_id,name,
amount,count}], paying_lead_ids}`. **ФОРМЫ НЕ СОВПАДАЮТ.** РЕШЕНИЕ: привести бэк к форме, которую
ждёт фронт (плоские поля + `title/amount/ym/lead_id` + `paying_lead_ids`), ЛИБО добавить в
`fetchFinance` маппинг `totals.*`→плоские, `sum_rub`→`amount`, `name`→`title`, `session_id`→
`lead_id`, `month`→`ym`. Минимальный риск — поправить нормализацию во фронте (один файл),
оставив бэк как в backend.md, но тогда `paying_lead_ids` бэк не отдаёт (backend.md его не
возвращает) → конверсия посчитается по `crm.status==='client'` локально (приемлемо). Зафиксировано:
**фронт-маппинг в `fetchFinance` обязателен**, иначе finance-дашборд покажет нули.

---

## Замеченные баги/риски в спеках

1. **Контракт `/admin/api/finance` рассинхрон** backend.md ↔ finance.md (см. §5) — БЛОКЕР для
   точных цифр; нужен маппинг во фронте.
2. **Дубль `@keyframes shimmer`** (DASH 2.3 + MODAL 2a стр.400) — удалить из MODAL-вставки (§2.C).
3. **`renderTopbar` затирание** dash-период-сегмента FINANCE-версией (§2.G) — слить вручную.
4. **`renderView`/`renderHead`** правят 3 спеки — объединять, не применять последовательно «как
   есть» (последняя затрёт предыдущие).
5. **MODAL `ov()` city** читает `base.geo.city`, но backend.md эффективные поля не включают city
   (только name/email/contact). modal.md просит бэк принимать `city` override — backend.md его НЕ
   реализует (нет в `_effective_client`). Город-override НЕ персистится корректно: PATCH city
   уйдёт в `overrides.city`, но GET вернёт его только как `crm.overrides.city` (extra), а `ov()`
   fallback на `base.geo.city` сработает — visible-правка сохранится через `crm.overrides`. ОК по
   факту, но `source.city`/эффективный city бэк не отдаёт — расхождение терпимое.
6. **`fillTable` empty-ветка** в LIST 3.8 описана дважды (короткая и с le-clear) — брать версию
   с обработчиком `le-clear`.
7. **`.d` остаётся в разметке** DASH/FINANCE/MODAL `.sev` — скрыт глобально, но при будущем
   рефакторе `.sev .d{display:none}` не удалять, пока разметка не вычищена.
8. **`patch()` перерисовка**: MODAL инлайн-эдит зовёт `patch(id,{name:...})`; текущий `patch`
   перерисовывает view только при `body.status||tasks||comms` — для `name`/контакта вью списка не
   обновится сразу (только модалка через cb в bindInline). Имя в таблице обновится при следующем
   `renderView`. Приемлемо; при желании добавить override-поля в условие перерисовки в `patch()`.
