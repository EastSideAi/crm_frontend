# Карточка клиента — премиальный редизайн (центр-модалка)

Участок: `renderDrawer` (шапка+nav), `renderModalContent`, `skeletonSection`, `buildNow`,
`buildPathSection` (дедуп с `buildTimeline`), `buildNotesSection`, `buildDocsSection`,
`buildAiSections`, `attachContentHandlers` (точечные добавки под инлайн-эдит и журнал
контактов), плюс CSS блока модалки. Дашборд/списки/Путь-страница/финанс-страница не трогаются.

---

## 1. Решения и логика (коротко)

**JTBD карточки.** Менеджер открыл — за 2 секунды считал «кто это, на каком он шаге,
что делать дальше», и тут же ведёт. Поэтому:

1. **Шапка (m-head) — тихая, с чистой иерархией.** Убран визуальный шум: было
   kicker + большое имя + alert-плашка + мета-строка вперемешку. Стало: слева
   аватар-инициалы + имя (инлайн-редактируемое) + одна строка-сабтайтл (статус-пилюля +
   «пришёл …» + сессия), справа компактный score-«пульс» (число/100 + микрошкала).
   Алерт-плашка убрана из шапки — риск переехал в раздел «Сейчас» и в дот на nav «Сейчас»
   (он там уже есть). Город/email/контакт ушли в редактируемый блок-сводку внутри
   «Сейчас», а не в шапку — шапка стала на 2 строки ниже и спокойнее.

2. **Инлайн-редактирование.** Имя в шапке, а контакт/email/город/заметка — в карточке
   «Кто это» (раздел «Сейчас») и в «Заметки». Паттерн: текст с карандашом по ховеру →
   клик → инпут на месте → blur/Enter автосейв через PATCH с полями-override.
   Бэк должен принять `name`, `contact`, `email`, `city` (override поверх анкеты/booking)
   — см. секцию BACKEND. Сейчас `patch()` шлёт только в `crm.*`; добавляем поддержку
   override-полей (бэк кладёт их в отдельную jsonb-колонку `crm_overrides` или прямо в
   `crm`, фронту всё равно — он читает их через helper `ov()`).

3. **Путь — ОДНО представление.** Удалён дубль (чек-лист `buildJourney` + таймлайн
   `buildTimeline`). Остаётся один богатый вертикальный таймлайн: каркас из 7 шагов
   платформы (FSTEPS) со статусом каждого (пройден / тут оборвался / не дошёл) и временем
   из событий, а реальные мелкие события (клики, шаги анкеты, контакты) подвешиваются
   как под-события под нужный шаг. `buildJourney` удаляется. `buildTimeline` остаётся
   ТОЛЬКО для использования в `buildAiSections` (там он к месту как сырой лог) — не трогаем
   его сигнатуру, но в «Путь» больше не зовём.

4. **Заметки + журнал контактов.** Верхняя граница-разделитель убрана (новый класс
   `.m-sec` без `border-top`, секции разделяются воздухом и подзаголовком, а не линией).
   Журнал контактов: быстрые кнопки звонок/написал/встреча в одну приятную линию +
   компактный лог под ними, без полоски сверху.

5. **Без кричащего красного.** Просрочка/риск — благородно: тёплый янтарь для «пора»,
   приглушённый красный только тонкой левой риской + мелким текстом, без заливки всей
   плашки. `.task.overdue` больше не заливается `--coral-soft`; вместо этого тонкая
   риска `--amber` слева и подпись «просрочено» янтарём.

6. **Разбор AI — премиально и структурно.** `buildAiSections` переписан: крупный
   вердикт-хедлайн → score-сводка → шансы (метрики + категории) → вузы → сильное/рост
   2 колонки → план → анкета (свёрнута до клика). Продажа-блок наверх как «шпаргалка
   на созвон». Чище типографика, карточки-секции вместо линий.

7. **Skeleton-shimmer** вместо «Загружаю…»: каркас, повторяющий будущую раскладку
   раздела (заголовок-плашка + строки разной ширины с бегущим бликом). Новый
   `skeletonSection(kind)` рисует осмысленный каркас под docs/pay/ai.

8. **Микровзаимодействия.** Ховер-карандаш на редактируемых полях, плавный
   shimmer, копирование контакта с галочкой, мягкие тени на nav-пунктах, аккуратные
   under-step под-события в таймлайне.

**Совместимость рендера.** `renderDrawer` по-прежнему строит `.m-head` + `.m-body`
(`.m-nav` + `.m-content`) + `.m-foot`, `renderModalContent` диспетчеризует по
`state.modalSection`, `attachContentHandlers(id, ctx)` навешивает обработчики — контракт
этих функций сохранён, чтобы `setModalSection`, `drawerStep`, `patch()`-перерисовка
продолжали работать без правок вызывающих мест.

---

## 2. CSS

> Заменить блок «════ МОДАЛКА … ════» (строки ~436–711 в style.css: от `.mbg` до конца
> `.prod-r`/`.mech` включительно — то есть весь модальный CSS до «факты/метрики»),
> и блоки `.jrn/.jstep/...` (удалить, journey больше нет). Ниже — цельный новый блок
> модалки. Остальной CSS (`.ab`, `.catr`, `.uni-r`, `.sg2`, `.stage`, `.tl`, `.qa-r`,
> `.sk`, `#smenu`, `#toast`, `#gate`, мобила) — оставить, с правками, помеченными ниже.

### 2a. Заменяет весь блок модалки (от `.mbg` до `.mech`)

```css
/* ════ МОДАЛКА (карточка клиента) — центр + левая навигация ════ */
.mbg { position: fixed; inset: 0; background: rgba(15,19,32,.42);
  -webkit-backdrop-filter: blur(7px); backdrop-filter: blur(7px);
  opacity: 0; visibility: hidden; transition: opacity .25s; z-index: 80; }
.mbg.open { opacity: 1; visibility: visible; }
.modal { position: fixed; top: 50%; left: 50%; transform: translate(-50%, -46%);
  width: 1020px; max-width: 94vw; height: 86vh; max-height: 884px; background: #fff;
  border-radius: 24px; z-index: 81; display: flex; flex-direction: column; overflow: hidden;
  opacity: 0; visibility: hidden; transition: opacity .26s, transform .3s var(--ease);
  box-shadow: 0 44px 130px -30px rgba(15,19,32,.5); }
.modal.open { opacity: 1; visibility: visible; transform: translate(-50%, -50%); }

/* ── ШАПКА — тихая, чистая иерархия ── */
.m-head { flex: none; padding: 22px 26px 20px; border-bottom: 1px solid var(--line);
  position: relative; display: flex; align-items: center; gap: 16px; }
.m-navfloat { position: absolute; top: 18px; right: 22px; display: flex; align-items: center; gap: 7px; }
.m-arrow { width: 34px; height: 34px; border-radius: 50%; background: var(--fill);
  display: grid; place-items: center; color: var(--ink-2); transition: .15s; }
.m-arrow:hover { background: #ECEEF1; color: var(--ink); }
.m-arrow:disabled { opacity: .32; cursor: default; }
.m-arrow#m-close { background: transparent; }
.m-arrow#m-close:hover { background: var(--red-soft); color: var(--red); }

.m-ava { width: 54px; height: 54px; border-radius: 16px; flex: none; display: grid; place-items: center;
  color: #fff; font-weight: 700; font-size: 19px; letter-spacing: -.02em;
  background: linear-gradient(140deg, #4C7DFF, var(--navy)); box-shadow: 0 6px 16px -8px rgba(47,107,255,.6); }
.m-id { flex: 1; min-width: 0; padding-right: 128px; }
.m-name-row { display: flex; align-items: center; gap: 9px; }
.m-name { font-size: 23px; font-weight: 700; letter-spacing: -.025em; line-height: 1.1;
  min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.m-name.anon { color: var(--ink-3); font-weight: 600; }
.m-edit { width: 26px; height: 26px; border-radius: 8px; flex: none; display: grid; place-items: center;
  color: var(--ink-3); opacity: 0; transition: .14s; }
.m-name-row:hover .m-edit, .ed-field:hover .m-edit { opacity: 1; }
.m-edit:hover { background: var(--fill); color: var(--blue); }
.m-edit svg { width: 14px; height: 14px; }
.m-sub { display: flex; align-items: center; gap: 11px; margin-top: 9px; flex-wrap: wrap;
  font-size: 12.5px; color: var(--ink-3); }
.m-sub .dot-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--ink-3); opacity: .55; }
.m-sub .sess { font-feature-settings: 'tnum'; letter-spacing: -.01em; }

/* score-пульс справа в шапке */
.m-pulse { flex: none; display: flex; flex-direction: column; align-items: flex-end; gap: 7px;
  margin-right: 116px; }
.m-pulse .pv { font-size: 26px; font-weight: 700; letter-spacing: -.04em; line-height: 1;
  display: flex; align-items: baseline; gap: 2px; }
.m-pulse .pv small { font-size: 12px; font-weight: 600; color: var(--ink-3); letter-spacing: 0; }
.m-pulse .ptrack { width: 88px; height: 6px; border-radius: 5px; background: var(--fill); overflow: hidden; }
.m-pulse .ptrack i { display: block; height: 100%; border-radius: 5px; min-width: 5px; transition: width .9s var(--ease); }
.m-pulse .plab { font-size: 10.5px; font-weight: 600; letter-spacing: .02em; }

/* ── ТЕЛО: nav + контент ── */
.m-body { flex: 1; display: flex; min-height: 0; }
.m-nav { flex: none; width: 210px; border-right: 1px solid var(--line); padding: 16px 12px;
  overflow-y: auto; background: #FBFBFC; }
.m-nav::-webkit-scrollbar { width: 0; }
.m-ni { display: flex; align-items: center; gap: 11px; width: 100%; text-align: left;
  padding: 10px 13px; border-radius: 11px; font-size: 13.5px; font-weight: 500; color: var(--ink-2); transition: .14s; }
.m-ni svg { color: var(--ink-3); transition: .14s; }
.m-ni:hover { background: #F1F3F6; color: var(--ink); }
.m-ni.on { background: #fff; color: var(--ink); font-weight: 600;
  box-shadow: 0 2px 6px -2px rgba(15,19,32,.1), inset 0 0 0 1px var(--line); }
.m-ni.on svg { color: var(--blue); }
.m-ni .cnt { margin-left: auto; font-size: 11px; font-weight: 700; color: var(--ink-3);
  background: var(--fill); border-radius: 999px; padding: 1px 7px; min-width: 18px; text-align: center; }
.m-ni.on .cnt { background: var(--blue-tint); color: var(--blue); }
.m-ni .dotw { margin-left: auto; width: 7px; height: 7px; border-radius: 50%; background: var(--amber);
  box-shadow: 0 0 0 3px var(--amber-soft); }

.m-content { flex: 1; overflow-y: auto; padding: 26px 30px 36px; min-width: 0; }
.m-content::-webkit-scrollbar { width: 7px; }
.m-content::-webkit-scrollbar-thumb { background: #E3E5EB; border-radius: 99px; }
.m-ctitle { font-size: 18px; font-weight: 700; letter-spacing: -.02em; }
.m-csub { font-size: 13px; color: var(--ink-2); margin-top: 5px; margin-bottom: 20px; line-height: 1.5; }

.m-foot { flex: none; border-top: 1px solid var(--line); padding: 13px 22px; background: #fff; display: flex; gap: 10px; }

/* ── секции БЕЗ верхней полоски (воздух + подзаголовок) ── */
.m-sec { margin-top: 22px; }
.m-sec:first-child { margin-top: 0; }
.m-sec-h { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
  color: var(--ink-3); margin-bottom: 13px; display: flex; align-items: baseline; gap: 10px; }
.m-sec-h .hr { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--blue);
  text-transform: none; letter-spacing: 0; cursor: pointer; }
.m-sec-h .hr:hover { text-decoration: underline; }

/* кнопки (оставляем .bp как было, дублируем здесь для самодостаточности блока) */
.bp { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 12px 18px;
  border-radius: 12px; background: var(--blue); color: #fff; font-size: 13.5px; font-weight: 600;
  transition: .15s; text-decoration: none; }
.bp:hover { background: var(--blue-d); }
.bp.ghost { background: var(--card); border: 1px solid var(--line-2); color: var(--ink); }
.bp.ghost:hover { background: var(--fill); }
.bp.sm { padding: 9px 14px; font-size: 12.5px; }
.bpwide { width: 100%; display: flex; align-items: center; justify-content: center; gap: 9px;
  padding: 14px; border-radius: 12px; background: var(--black); color: #fff; font-size: 13.5px;
  font-weight: 600; transition: .15s; letter-spacing: -.01em; }
.bpwide:hover { background: #0A0B0F; }

/* ── «Сейчас»: херо «что делать» ── */
.now-do { border-radius: 16px; padding: 20px 22px; position: relative; overflow: hidden;
  background: var(--blue-tint); border: 1px solid #DCE7FF; }
.now-do.calm { background: var(--green-soft); border-color: #C7EBD6; }
.now-do.warn { background: linear-gradient(180deg, #FFF6EC, #FDEFDD); border-color: #F4DBB6; }
.now-do .nd-k { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: var(--blue); }
.now-do.calm .nd-k { color: var(--green-ink); }
.now-do.warn .nd-k { color: var(--amber-ink); }
.now-do .nd-k::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.now-do .nd-t { font-size: 18px; font-weight: 700; letter-spacing: -.02em; margin-top: 10px; line-height: 1.3; }
.now-do .nd-s { font-size: 13px; color: var(--ink-2); margin-top: 7px; line-height: 1.55; }
.now-do.warn .nd-s { color: #7A6438; }
.now-do .nd-act { display: flex; gap: 9px; margin-top: 17px; flex-wrap: wrap; }

/* ── «Сейчас»: карточка «Кто это» (редактируемая сводка) ── */
.who { background: var(--fill); border-radius: 15px; padding: 6px 16px; margin-top: 16px; }
.ed-field { display: flex; align-items: center; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line-2); }
.ed-field:first-child { border-top: none; }
.ed-field .ef-ic { width: 30px; height: 30px; border-radius: 9px; flex: none; display: grid; place-items: center;
  background: #fff; color: var(--ink-2); box-shadow: inset 0 0 0 1px var(--line); }
.ed-field .ef-k { font-size: 12.5px; color: var(--ink-3); flex: none; width: 64px; }
.ed-field .ef-v { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: var(--ink);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ed-field .ef-v.empty { color: var(--ink-3); font-weight: 500; }
.ed-field .ef-v a { color: var(--blue); }
.ed-field .ef-v a:hover { text-decoration: underline; }
.ed-field .ef-copy { width: 30px; height: 30px; border-radius: 8px; flex: none; display: grid; place-items: center;
  color: var(--ink-3); opacity: 0; transition: .14s; }
.ed-field:hover .ef-copy { opacity: 1; }
.ed-field .ef-copy:hover { color: var(--blue); background: #fff; }

/* инпут инлайн-редактирования (общий) */
.ed-input { flex: 1; min-width: 0; font: 600 14px 'Manrope', sans-serif; color: var(--ink);
  background: #fff; border: 1px solid var(--blue); border-radius: 9px; padding: 8px 11px; outline: none;
  box-shadow: 0 0 0 3px rgba(47,107,255,.12); }
.ed-input.big { font-size: 19px; font-weight: 700; letter-spacing: -.02em; padding: 6px 10px; }
.ed-save { font-size: 11px; color: var(--green-ink); font-weight: 600; }
.ed-save.err { color: var(--red-ink); }

.slotchip { display: inline-flex; align-items: center; gap: 8px; margin-top: 14px;
  font-size: 13px; font-weight: 600; color: var(--blue); background: var(--blue-tint);
  border-radius: var(--r-pill); padding: 8px 14px; }
.slotchip svg { color: var(--blue); }

/* степпер воронки */
.stage-sec { margin-top: 24px; }
.dr-rej { margin-left: auto; font-size: 12px; font-weight: 600; color: var(--ink-3);
  text-transform: none; letter-spacing: 0; transition: .15s; }
.dr-rej:hover { color: var(--red); }
.pipe { display: flex; gap: 7px; }
.pstep { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 9px;
  padding: 12px 12px 13px; border-radius: 13px; background: var(--fill); cursor: pointer; transition: .15s;
  border: 1px solid transparent; position: relative; }
.pstep .pdot { width: 9px; height: 9px; border-radius: 50%; background: var(--ink-3); opacity: .4; transition: .15s; }
.pstep .plbl { font-size: 11.5px; font-weight: 600; color: var(--ink-3); line-height: 1.25; text-align: left; }
.pstep:hover { background: #EDEFF3; }
.pstep.past .pdot { background: var(--blue); opacity: 1; }
.pstep.past .plbl { color: var(--ink-2); }
.pstep.cur { background: var(--blue); }
.pstep.cur .pdot { background: #fff; opacity: 1; box-shadow: 0 0 0 4px rgba(255,255,255,.25); }
.pstep.cur .plbl { color: #fff; }
.pstep.cur.s-client { background: var(--green); }
.pstep.next:hover .pdot { opacity: .7; }
.rej-banner { display: flex; align-items: center; gap: 9px; font-size: 13px; font-weight: 600; color: var(--ink-2);
  background: var(--fill); border-radius: 13px; padding: 14px 16px; }
.rej-banner svg { color: var(--ink-3); }

/* ── ПУТЬ — единый богатый таймлайн ── */
.path-tl { position: relative; padding-left: 2px; }
.pt-step { position: relative; display: flex; gap: 15px; padding-bottom: 4px; }
.pt-rail { flex: none; width: 30px; display: flex; flex-direction: column; align-items: center; }
.pt-node { width: 30px; height: 30px; border-radius: 50%; flex: none; display: grid; place-items: center;
  background: var(--fill); color: var(--ink-3); border: 1.5px solid var(--line-2); z-index: 1; transition: .15s; }
.pt-node svg { width: 13px; height: 13px; }
.pt-line { flex: 1; width: 2px; background: var(--line); margin: 4px 0; min-height: 14px; }
.pt-step.done .pt-node { background: var(--green); border-color: var(--green); color: #fff; }
.pt-step.done .pt-line { background: #C6E8D4; }
.pt-step.cur .pt-node { background: var(--blue); border-color: var(--blue); color: #fff;
  box-shadow: 0 0 0 4px var(--blue-tint); }
.pt-step.drop .pt-node { background: #fff; border-color: var(--amber); color: var(--amber-ink); }
.pt-step.todo .pt-node { background: var(--fill); color: var(--ink-3); }
.pt-step:last-child .pt-line { display: none; }
.pt-body { flex: 1; min-width: 0; padding-bottom: 18px; }
.pt-t { font-size: 14px; font-weight: 600; color: var(--ink); display: flex; align-items: baseline; gap: 10px; }
.pt-step.todo .pt-t { color: var(--ink-3); font-weight: 500; }
.pt-t .pt-when { margin-left: auto; flex: none; font-size: 11.5px; font-weight: 500; color: var(--ink-3); }
.pt-tag { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  border-radius: var(--r-pill); padding: 2.5px 8px; flex: none; }
.pt-tag.drop { color: var(--amber-ink); background: var(--amber-soft); }
.pt-tag.cur { color: var(--blue); background: var(--blue-tint); }
.pt-s { font-size: 12.5px; color: var(--ink-3); margin-top: 3px; line-height: 1.45; }
.pt-step.drop .pt-s { color: var(--amber-ink); font-weight: 500; }
/* под-события шага */
.pt-subs { margin-top: 9px; display: flex; flex-direction: column; gap: 6px; }
.pt-sub { display: flex; align-items: baseline; gap: 9px; font-size: 12px; color: var(--ink-2); }
.pt-sub::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--line-2); flex: none; transform: translateY(-2px); }
.pt-sub.hi { color: var(--ink); font-weight: 600; }
.pt-sub.hi::before { background: var(--blue); }
.pt-sub.comm::before { background: var(--green); }
.pt-sub .sw { margin-left: auto; flex: none; font-size: 11px; color: var(--ink-3); font-weight: 500; }

/* ── ДОКУМЕНТЫ ── */
.doc-row, .pay-row { display: flex; align-items: center; gap: 13px; padding: 13px 0; border-bottom: 1px solid var(--line); }
.doc-row:last-child, .pay-row:last-child { border-bottom: none; }
.doc-ic { width: 38px; height: 38px; border-radius: 10px; flex: none; display: grid; place-items: center;
  background: var(--blue-tint); color: var(--blue); }
.doc-b { flex: 1; min-width: 0; }
.doc-n { font-size: 13.5px; font-weight: 600; color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-m { font-size: 12px; color: var(--ink-3); margin-top: 2px; }
.doc-act { display: flex; gap: 6px; flex: none; }
.icobtn { width: 32px; height: 32px; border-radius: 9px; border: 1px solid var(--line-2); background: #fff;
  display: grid; place-items: center; color: var(--ink-2); transition: .15s; }
.icobtn:hover { color: var(--blue); border-color: #C9D7FB; }
.icobtn.del:hover { color: var(--red); border-color: #F4CFD0; }
.dropzone { margin-top: 16px; border: 1.5px dashed var(--line-2); border-radius: 14px; padding: 26px 22px;
  text-align: center; color: var(--ink-2); font-size: 13px; cursor: pointer; transition: .15s; }
.dropzone .dz-ic { width: 40px; height: 40px; border-radius: 12px; background: var(--fill); color: var(--ink-2);
  display: grid; place-items: center; margin: 0 auto 11px; transition: .15s; }
.dropzone:hover, .dropzone.over { border-color: var(--blue); background: var(--blue-tint); color: var(--blue); }
.dropzone:hover .dz-ic, .dropzone.over .dz-ic { background: #fff; color: var(--blue); }
.dropzone b { color: var(--blue); font-weight: 600; }
.linkrow { display: flex; gap: 8px; margin-top: 10px; }
.linkrow input { flex: 1; min-width: 0; outline: none; font: 500 13px 'Manrope', sans-serif; color: var(--ink);
  background: var(--fill); border: 1px solid transparent; border-radius: 10px; padding: 11px 13px; transition: .15s; }
.linkrow input:focus { background: #fff; border-color: #DCE7FF; box-shadow: inset 0 0 0 1px #DCE7FF; }

/* ── ОПЛАТЫ ── */
.pay-amt { font-size: 15px; font-weight: 700; flex: none; }
.pay-amt.refunded { color: var(--ink-3); text-decoration: line-through; }
.pay-sum { display: flex; align-items: baseline; gap: 10px; margin-bottom: 16px;
  background: var(--fill); border-radius: 14px; padding: 16px 18px; }
.pay-sum b { font-size: 27px; font-weight: 700; letter-spacing: -.03em; }
.pay-sum span { font-size: 13px; color: var(--ink-3); }
.pay-add { display: grid; grid-template-columns: 1fr 120px; gap: 8px; margin-top: 14px; }
.pay-add input { outline: none; font: 500 13px 'Manrope', sans-serif; color: var(--ink);
  background: var(--fill); border: 1px solid transparent; border-radius: 10px; padding: 11px 13px; }
.pay-add input:focus { background: #fff; border-color: #DCE7FF; box-shadow: inset 0 0 0 1px #DCE7FF; }
.field-empty { text-align: center; color: var(--ink-3); font-size: 13px; padding: 26px 10px; }

/* ── ЗАМЕТКИ ── */
.note-ta { width: 100%; min-height: 76px; resize: vertical; outline: none;
  font: 500 13.5px/1.55 'Manrope', sans-serif; color: var(--ink);
  background: var(--fill); border: 1px solid transparent; border-radius: 13px; padding: 13px 15px; transition: .15s; }
.note-ta::placeholder { color: var(--ink-3); }
.note-ta:focus { background: #fff; border-color: #DCE7FF; box-shadow: inset 0 0 0 1px #DCE7FF; }
.note-state { font-size: 11px; color: var(--ink-3); margin-top: 6px; min-height: 14px; }

/* задачи — благородная просрочка (без заливки) */
.task { display: flex; align-items: flex-start; gap: 12px; padding: 12px 14px;
  background: var(--fill); border-radius: 13px; margin-top: 8px; position: relative; overflow: hidden; }
.task:first-of-type { margin-top: 0; }
.task.overdue::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--amber); }
.task-chk { width: 20px; height: 20px; flex: none; margin-top: 1px; border-radius: 50%;
  border: 1.5px solid #C5CCDA; background: #fff; display: grid; place-items: center; color: transparent; transition: .15s; }
.task-chk:hover { border-color: var(--blue); }
.task.done .task-chk { background: var(--blue); border-color: var(--blue); color: #fff; }
.task-chk svg { width: 11px; height: 11px; }
.task-body { min-width: 0; flex: 1; }
.task-text { font-size: 13.5px; font-weight: 500; color: var(--ink); line-height: 1.4; word-break: break-word; }
.task.done .task-text { text-decoration: line-through; color: var(--ink-3); }
.task-due { display: inline-flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--ink-2); margin-top: 4px; }
.task.overdue .task-due { color: var(--amber-ink); font-weight: 600; }
.task-del { flex: none; color: var(--ink-3); padding: 2px; border-radius: 6px; }
.task-del:hover { color: var(--red); }
.task-add { display: flex; gap: 8px; margin-top: 10px; }
.task-add input { flex: 1; min-width: 0; outline: none; font: 500 13px 'Manrope', sans-serif;
  color: var(--ink); background: #fff; border: 1px solid var(--line-2); border-radius: 11px; padding: 11px 13px; }
.task-add input::placeholder { color: var(--ink-3); }
.task-add input:focus { border-color: var(--blue); box-shadow: 0 0 0 3px rgba(47,107,255,.1); }
.due-seg { display: inline-flex; gap: 3px; padding: 4px; border-radius: 11px; background: var(--fill); }
.due-seg button { color: var(--ink-2); font: 600 11px 'Manrope', sans-serif; padding: 6px 10px; border-radius: 8px; }
.due-seg button.on { background: #fff; color: var(--blue); box-shadow: 0 1px 2px rgba(15,19,32,.1); }

/* журнал контактов — без верхней полоски */
.comm-btns { display: flex; gap: 8px; }
.comm-btns button { flex: 1; border: 1px solid var(--line-2); background: var(--card); color: var(--ink-2);
  border-radius: 12px; padding: 12px 8px; font: 600 12.5px 'Manrope', sans-serif;
  display: inline-flex; align-items: center; justify-content: center; gap: 7px; transition: .15s; }
.comm-btns button svg { width: 14px; height: 14px; color: var(--ink-3); transition: .15s; }
.comm-btns button:hover { border-color: #C9D7FB; color: var(--blue); background: var(--blue-tint); }
.comm-btns button:hover svg { color: var(--blue); }
.comm-log { margin-top: 12px; display: flex; flex-direction: column; }
.comm-row { display: flex; gap: 10px; align-items: center; font-size: 13px; color: var(--ink-2); padding: 9px 0;
  border-top: 1px solid var(--line); }
.comm-row:first-child { border-top: none; }
.comm-row .ci { width: 26px; height: 26px; border-radius: 8px; flex: none; display: grid; place-items: center;
  background: var(--fill); color: var(--ink-2); }
.comm-row .ct { flex: 1; min-width: 0; }
.comm-row .when { margin-left: auto; flex: none; font-size: 11.5px; color: var(--ink-3); }

/* ── РАЗБОР AI ── */
.ai-hero { background: linear-gradient(140deg, #F1F5FF, #EAF0FF); border: 1px solid #DCE7FF;
  border-radius: 16px; padding: 20px 22px; }
.ai-hero .ah-k { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; font-weight: 700;
  letter-spacing: .06em; text-transform: uppercase; color: var(--blue); }
.ai-hero .ah-k svg { color: var(--blue); }
.ai-hero .ah-t { font-size: 17px; font-weight: 700; letter-spacing: -.02em; margin-top: 10px; line-height: 1.35; }
.ai-hero .ah-s { font-size: 13px; color: var(--ink-2); margin-top: 8px; line-height: 1.55; }
.ai-gap { display: grid; grid-template-columns: 1fr; gap: 1px; margin-top: 16px;
  background: #fff; border-radius: 12px; overflow: hidden; border: 1px solid #DCE7FF; }
.ai-gap .gr { display: flex; gap: 12px; padding: 11px 14px; font-size: 13px; }
.ai-gap .gr + .gr { border-top: 1px solid var(--line); }
.ai-gap .gk { flex: none; width: 56px; font-size: 11px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; color: var(--ink-3); padding-top: 1px; }
.ai-gap .gv { font-weight: 500; color: var(--ink); line-height: 1.45; }

/* свёрнутая анкета */
.qa-fold { cursor: pointer; }
.qa-fold .m-sec-h .hr::after { content: ' ▾'; }
.qa-fold.open .m-sec-h .hr::after { content: ' ▴'; }
.qa-wrap { display: none; }
.qa-fold.open .qa-wrap { display: block; }

/* ── SKELETON shimmer ── */
.sk { position: relative; height: 13px; border-radius: 7px; margin-top: 11px; overflow: hidden;
  background: var(--fill); }
.sk::after { content: ''; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, rgba(255,255,255,.75), transparent);
  animation: shimmer 1.3s infinite; }
@keyframes shimmer { 100% { transform: translateX(100%); } }
.sk.w35 { width: 35%; } .sk.w55 { width: 55%; } .sk.w75 { width: 75%; } .sk.w90 { width: 90%; }
.sk.tall { height: 84px; border-radius: 14px; }
.sk.row { height: 52px; border-radius: 12px; }
.sk:first-child { margin-top: 0; }
.sk-rows { display: flex; flex-direction: column; gap: 10px; margin-top: 16px; }
```

### 2b. Точечные правки в существующем CSS (после блока модалки)

`.mech` используется в AI-разборе — оставить как есть (строки 682–683):
```css
.mech { font-size: 14px; line-height: 1.62; color: #3A3F4C; }
.mech b { color: var(--ink); font-weight: 600; }
```

`.rec`/`.prod-r` (продажа в AI) — оставить как есть (строки 671–680).

Блок `.tl …` (таймлайн, строки 734–744) **оставить** — его всё ещё зовёт
`buildTimeline` внутри `buildAiSections`.

**Удалить** старые классы (журнал пути больше не существует): `.jrn`, `.jstep`,
`.js-mark`, `.js-body`, `.js-t`, `.js-s`, `.js-when` (строки 562–577) и
`.contact-line …` / `.contact-row` / `.contact-val` / `.stchips` / `.stc …`
(строки 489–496, 530–537, 620–621) — заменены на `.who`/`.ed-field`/`.pipe`.

### 2c. Мобила — добавить в `@media (max-width:960px)`

```css
  .m-head { flex-wrap: wrap; gap: 12px; padding: 16px 16px 14px; }
  .m-id { padding-right: 110px; }
  .m-pulse { margin-right: 0; flex-direction: row; align-items: center; gap: 10px; width: 100%; }
  .m-pulse .ptrack { flex: 1; width: auto; }
  .m-name { font-size: 20px; }
  .pipe { flex-wrap: wrap; }
  .pstep { flex: 1 1 28%; }
```

---

## 3. JS — полные функции

> Все функции ниже — внутри IIFE `crm/app.js`. Для каждой указано, что заменяет.

### 3.0 NEW helper `ov()` + правка `patch()` (override-поля)

`patch()` сейчас отправляет body и ждёт ответ `{crm}`. Чтобы инлайн-эдит работал,
бэк должен возвращать override-поля. Кладём их фронтом в `lead.crm._ov` и в
`d.crm._ov` (если бэк вернёт `crm.overrides`/`crm._ov` — используем; см. BACKEND).
Helper читает override поверх анкеты/booking.

**ВСТАВИТЬ** рядом с другими helpers (после `leadName`, ~строка 223):

```js
  /* override-поля менеджера поверх данных анкеты/booking */
  function ov(ctx, field) {
    var o = (ctx.crm && (ctx.crm._ov || ctx.crm.overrides)) || {};
    if (o[field] != null && o[field] !== '') return o[field];
    var base = ctx.base || {}, booking = base.booking || {};
    if (field === 'name') return base.name || '';
    if (field === 'contact') return booking.contact || '';
    if (field === 'email') return base.email || '';
    if (field === 'city') return (base.geo && base.geo.city) || '';
    return '';
  }
  /* инлайн-эдит: превращает .ef-v / .m-name в инпут, автосейв по blur/Enter */
  function bindInline(node, field, opts) {
    opts = opts || {};
    if (!node) return;
    var id = state.drawerId;
    node.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('a, .ef-copy')) return;
      if (node.querySelector('.ed-input')) return;
      var cur = node.getAttribute('data-raw') || '';
      node.dataset.html = node.innerHTML;
      var inp = document.createElement('input');
      inp.className = 'ed-input' + (opts.big ? ' big' : '');
      inp.value = cur; inp.placeholder = opts.ph || '';
      node.innerHTML = ''; node.appendChild(inp); inp.focus(); inp.select();
      var saved = false;
      function commit() {
        if (saved) return; saved = true;
        var val = inp.value.trim();
        if (val !== cur) {
          var body = {}; body[field] = val;
          patch(id, body, null, function () {
            if (state.drawerId === id) renderDrawer(true);
          });
        } else { node.innerHTML = node.dataset.html; }
      }
      inp.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { ev.preventDefault(); inp.blur(); }
        if (ev.key === 'Escape') { saved = true; node.innerHTML = node.dataset.html; }
      });
      inp.addEventListener('blur', commit);
    });
  }
```

**ПРАВКА в `patch()`** — после `if (lead) lead.crm = res.crm;` блок уже сохраняет
`res.crm` целиком, поэтому override прилетит внутри `res.crm._ov`/`res.crm.overrides`
автоматически. Дополнительно дернуть `renderSide()` уже есть. Ничего больше менять не
надо, ЕСЛИ бэк возвращает override внутри `crm`. Если бэк вернёт их отдельным ключом
`res.overrides`, добавить в `.then`:
```js
      if (res.overrides) { if (lead) lead.crm._ov = res.overrides;
        if (state.details[id]) state.details[id].crm._ov = res.overrides; }
```

### 3.1 ЗАМЕНЯЕТ `renderDrawer` (строки 1449–1519)

```js
  function renderDrawer(keepScroll) {
    var modal = el('modal');
    var id = state.drawerId;
    if (!modal || !id) return;
    var prevScroll = 0;
    if (keepScroll) { var c0 = modal.querySelector('.m-content'); prevScroll = c0 ? c0.scrollTop : 0; }

    var ctx = leadCtx(id);
    var lead = ctx.lead, d = ctx.d, base = ctx.base, crm = ctx.crm;
    if (!base) { modal.innerHTML = ''; return; }
    var diag = (d && d.diagnostics) || {};
    var score = lead && lead.score != null ? lead.score : diag.score;
    var tone = score != null ? scoreTone(score) : null;
    var booking = base.booking;
    var risks = lead ? leadRisks(lead) : [];

    var list = state.drawerList || [];
    var pos = list.indexOf(id);

    var nm = ov(ctx, 'name');
    var openTasks = (crm.tasks || []).filter(function (t) { return !t.done; }).length;
    var navHtml = MODAL_SECTIONS.map(function (sct) {
      var extra = '';
      if (sct.id === 'now' && risks.length) extra = '<span class="dotw"></span>';
      else if (sct.id === 'notes' && openTasks) extra = '<span class="cnt num">' + openTasks + '</span>';
      else if (sct.id === 'docs' && d && d.docs && d.docs.length) extra = '<span class="cnt num">' + d.docs.length + '</span>';
      else if (sct.id === 'pay' && d && d.payments && d.payments.length) extra = '<span class="cnt num">' + d.payments.length + '</span>';
      return '<button class="m-ni' + (state.modalSection === sct.id ? ' on' : '') + '" data-s="' + sct.id + '">' +
        ic(sct.icon, 17) + '<span>' + sct.label + '</span>' + extra + '</button>';
    }).join('');

    var subBits = [
      sevPill(lead || { crm: crm, booking: booking }),
      '<span>пришел ' + fmtWhen(base.created_at) + '</span>',
      (pos !== -1 ? '<span>' + (pos + 1) + ' из ' + list.length + '</span>' : ''),
      '<span class="sess">сессия ' + esc(String(id).slice(0, 8)) + '</span>',
    ].filter(Boolean).join('<span class="dot-sep"></span>');

    modal.innerHTML =
      '<div class="m-head">' +
        '<div class="m-navfloat">' +
          '<button class="m-arrow" id="m-prev"' + (pos <= 0 ? ' disabled' : '') + '>' +
            '<svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12.5 5l-5 5 5 5"/></svg></button>' +
          '<button class="m-arrow" id="m-next"' + (pos === -1 || pos >= list.length - 1 ? ' disabled' : '') + '>' + ic('go', 13) + '</button>' +
          '<button class="m-arrow" id="m-close">' + ic('x', 14) + '</button>' +
        '</div>' +
        '<div class="m-ava">' + esc(initials(nm)) + '</div>' +
        '<div class="m-id">' +
          '<div class="m-name-row">' +
            '<div class="m-name' + (nm ? '' : ' anon') + '" id="m-name" data-raw="' + esc(nm) + '">' + esc(nm || 'Без имени') + '</div>' +
            '<button class="m-edit" id="m-name-edit" title="Изменить имя">' + ic('note', 14) + '</button>' +
          '</div>' +
          '<div class="m-sub">' + subBits + '</div>' +
        '</div>' +
        (tone ? '<div class="m-pulse">' +
          '<div class="pv num" style="color:' + tone.c + '">' + score + '<small>/100</small></div>' +
          '<div class="ptrack"><i style="width:' + score + '%;background:' + tone.c + '"></i></div>' +
          '<div class="plab" style="color:' + tone.c + '">' + esc(tone.label) + '</div>' +
        '</div>' : '') +
      '</div>' +
      '<div class="m-body">' +
        '<nav class="m-nav">' + navHtml + '</nav>' +
        '<div class="m-content" id="m-content"></div>' +
      '</div>' +
      '<div class="m-foot">' +
        '<a class="bpwide" target="_blank" rel="noopener" href="' + API + '/admin/' + esc(id) + '?k=' + encodeURIComponent(getKey()) + '">Полная аналитика клиента' + ic('go', 14) + '</a>' +
      '</div>';

    el('m-close').addEventListener('click', closeDrawer);
    var mp = el('m-prev'), mn = el('m-next');
    if (mp) mp.addEventListener('click', function () { drawerStep(-1); });
    if (mn) mn.addEventListener('click', function () { drawerStep(1); });
    Array.prototype.forEach.call(modal.querySelectorAll('.m-ni'), function (b) {
      b.addEventListener('click', function () { setModalSection(b.getAttribute('data-s')); });
    });
    // инлайн-эдит имени (карандаш или клик по имени)
    bindInline(el('m-name'), 'name', { big: true, ph: 'Имя клиента' });
    var ne = el('m-name-edit');
    if (ne) ne.addEventListener('click', function () { var n = el('m-name'); if (n) n.click(); });

    renderModalContent();
    if (keepScroll) { var c1 = modal.querySelector('.m-content'); if (c1) c1.scrollTop = prevScroll; }
    animBars(el('m-head'));
  }
```

### 3.2 ЗАМЕНЯЕТ `renderModalContent` (строки 1521–1535)

```js
  function renderModalContent() {
    var host = el('m-content');
    var id = state.drawerId;
    if (!host || !id) return;
    var ctx = leadCtx(id);
    var s = state.modalSection;
    if (s === 'now') host.innerHTML = buildNow(ctx);
    else if (s === 'path') host.innerHTML = buildPathSection(ctx);
    else if (s === 'notes') host.innerHTML = buildNotesSection(ctx);
    else if (s === 'docs') host.innerHTML = ctx.d ? buildDocsSection(ctx) : skeletonSection('docs');
    else if (s === 'pay') host.innerHTML = ctx.d ? buildPaySection(ctx) : skeletonSection('pay');
    else if (s === 'ai') host.innerHTML = ctx.d ? buildAiSections(ctx.d) : skeletonSection('ai');
    attachContentHandlers(id, ctx);
    animBars(host);
  }
```

### 3.3 ЗАМЕНЯЕТ `skeletonSection` (строки 1536–1539)

```js
  function skeletonSection(kind) {
    var head = { docs: ['Документы', 'Собираю файлы клиента'],
                 pay: ['Оплаты', 'Считаю платежи'],
                 ai: ['Разбор AI', 'Поднимаю диагностику с платформы'] }[kind] || ['Загрузка', ''];
    var body;
    if (kind === 'ai') {
      body = '<div class="sk tall"></div>' +
        '<div class="sk-rows"><div class="sk row"></div><div class="sk row"></div></div>' +
        '<div class="sk w35" style="margin-top:20px"></div>' +
        '<div class="sk w90"></div><div class="sk w75"></div><div class="sk w55"></div>';
    } else {
      body = '<div class="sk-rows"><div class="sk row"></div><div class="sk row"></div></div>' +
        '<div class="sk tall" style="margin-top:16px"></div>';
    }
    return '<div class="m-ctitle">' + head[0] + '</div>' +
      (head[1] ? '<div class="m-csub">' + head[1] + '</div>' : '') + body;
  }
```

### 3.4 ЗАМЕНЯЕТ `buildNow` (строки 1556–1598)

```js
  function buildNow(ctx) {
    var lead = ctx.lead, crm = ctx.crm, base = ctx.base;
    var booking = base.booking;
    var contact = ov(ctx, 'contact');
    var act = contactAction(contact);
    var na = nextAction(lead || { created_at: base.created_at }, crm, booking, act, contact);

    /* 1. ХЕРО — что делать прямо сейчас */
    var html = '<div class="now-do ' + na.cls + '">' +
      '<div class="nd-k">' + na.k + '</div>' +
      '<div class="nd-t">' + na.t + '</div>' +
      (na.s ? '<div class="nd-s">' + na.s + '</div>' : '') +
      (na.a ? '<div class="nd-act">' + na.a + '</div>' : '') +
    '</div>';

    if (booking && booking.slot) {
      html += '<div class="slotchip">' + ic('cal', 13) + 'Разбор назначен: ' + esc(booking.slot) + '</div>';
    }

    /* 2. КТО ЭТО — редактируемая сводка контактов */
    var email = ov(ctx, 'email'), city = ov(ctx, 'city');
    function efv(field, raw, isContact) {
      var a = isContact ? contactAction(raw) : null;
      var inner = raw
        ? (a ? '<a href="' + esc(a.href) + '" target="_blank" rel="noopener">' + esc(raw) + '</a>' : esc(raw))
        : '<span class="empty">добавить</span>';
      return '<div class="ed-field" data-ef="' + field + '">' +
        '<span class="ef-ic">' + ic(field === 'contact' ? 'phone' : field === 'email' ? 'send' : 'pin', 14) + '</span>' +
        '<span class="ef-k">' + (field === 'contact' ? 'Контакт' : field === 'email' ? 'Email' : 'Город') + '</span>' +
        '<span class="ef-v' + (raw ? '' : ' empty') + '" data-edit="' + field + '" data-raw="' + esc(raw) + '">' + inner + '</span>' +
        (raw && isContact ? '<button class="ef-copy" data-copy="' + esc(raw) + '" title="Скопировать">' + ic('copy', 13) + '</button>' : '') +
      '</div>';
    }
    html += '<div class="m-sec" style="margin-top:20px"><div class="m-sec-h">Кто это</div>' +
      '<div class="who">' + efv('contact', contact, true) + efv('email', email, false) + efv('city', city, false) + '</div></div>';

    /* 3. СТАДИЯ — степпер воронки */
    var flow = ['new', 'contacted', 'call_scheduled', 'call_done', 'offer_sent', 'client'];
    var isRej = crm.status === 'rejected';
    var curOrder = CRM[crm.status].order;
    var pipe = flow.map(function (s) {
      var o = CRM[s].order;
      var cls = isRej ? '' : (o < curOrder ? 'past' : o === curOrder ? 'cur' : 'next');
      return '<button class="pstep ' + cls + ' s-' + s + '" data-s="' + s + '">' +
        '<span class="pdot"></span><span class="plbl">' + CRM[s].label + '</span></button>';
    }).join('');
    html += '<div class="m-sec stage-sec" id="m-st"><div class="m-sec-h">Стадия в воронке' +
        '<button class="dr-rej hr" data-s="' + (isRej ? 'new' : 'rejected') + '">' + (isRej ? 'Вернуть в работу' : 'Отметить отказ') + '</button></div>' +
      (isRej ? '<div class="rej-banner">' + ic('x', 13) + 'Сейчас в статусе «отказ» — сделка закрыта</div>' : '<div class="pipe">' + pipe + '</div>') +
    '</div>';
    return html;
  }
```

> `.dr-rej` получил доп. класс `hr` чтобы лечь в новый `.m-sec-h` без правок (margin-left:auto уже у обоих).

### 3.5 УДАЛИТЬ `buildJourney` (строки 1601–1617) и ЗАМЕНИТЬ `buildPathSection` (1618–1630)

Удалить `buildJourney` целиком. Новый `buildPathSection` рисует ОДИН таймлайн.
`buildTimeline` НЕ трогаем (его зовёт `buildAiSections`).

```js
  /* Путь — единый богатый таймлайн: 7 шагов платформы + под-события из лога */
  function buildPathSection(ctx) {
    var lead = ctx.lead, d = ctx.d, base = ctx.base;
    var L = lead || base;
    var html = '<div class="m-ctitle">Путь по платформе</div>' +
      '<div class="m-csub">Что человек сделал и где остановился — с этим заходи на разговор.</div>';

    if (!d) {
      // каркас пока деталь грузится — но FSTEPS уже можно посчитать по lead
      html += buildPathTimeline(L, null);
      return html;
    }
    html += buildPathTimeline(L, d);
    return html;
  }

  /* группирует реальные события под шаги платформы */
  function buildPathTimeline(L, d) {
    if (!L) return '';
    // время достижения каждого шага из событий
    var ev = (d && d.events) || [];
    var firstAt = function (types) {
      for (var i = 0; i < ev.length; i++) if (types.indexOf(ev[i].type) !== -1) return ev[i].at;
      return null;
    };
    var bookedAt = (L.booking && (L.booking.at)) || null;
    var stepTime = {
      visited: (d && d.created_at) || L.created_at,
      submitted: firstAt(['questionnaire_submitted']),
      diagnosed: null,
      viewed: firstAt(['viewed_result']),
      cta: firstAt(['clicked_book_call', 'clicked_messenger']),
      booked: bookedAt,
      client: (L.crm && L.crm.updated_at) || null,
    };
    // под-события на каждый шаг (по времени между шагами не делим — просто навешиваем по смыслу)
    var subsByStep = { visited: [], submitted: [], diagnosed: [], viewed: [], cta: [], booked: [], client: [] };
    var maxStep = 0;
    ev.forEach(function (e) {
      if (e.type === 'anketa_step') {
        var s = (e.payload || {}).step || 0; if (s > maxStep) maxStep = s; return;
      }
      var label = EVENTS_RU[e.type] || e.type;
      if (e.type === 'opened_product' && e.payload && e.payload.product) label += ': ' + e.payload.product;
      if (e.type === 'clicked_messenger' && e.payload && e.payload.channel) label += ' (' + e.payload.channel + ')';
      var hi = (e.type === 'questionnaire_submitted' || e.type === 'viewed_result' || e.type === 'lead_submitted');
      var bucket = (e.type === 'opened_product' || e.type === 'viewed_result') ? 'viewed'
        : (e.type === 'clicked_book_call' || e.type === 'clicked_messenger') ? 'cta'
        : (e.type === 'lead_submitted') ? 'booked'
        : (e.type === 'questionnaire_submitted') ? 'submitted' : 'visited';
      subsByStep[bucket].push({ text: label, at: e.at, hi: hi });
    });
    if (maxStep) subsByStep.submitted.unshift({ text: 'анкета: дошел до шага ' + maxStep + ' из 7', at: null, hi: false });
    ((d && d.crm && d.crm.comms) || (L.crm && L.crm.comms) || []).forEach(function (cm) {
      subsByStep.booked.push({ text: (COMM_KINDS[cm.kind] || cm.kind) + (cm.text ? ': ' + cm.text : ''), at: cm.at, hi: false, comm: true });
    });

    var reachedPrev = true, dropMarked = false;
    var rows = FSTEPS.map(function (st) {
      var ok = st.test(L);
      var cls, node, tag = '', sdesc;
      if (ok) { cls = 'done'; node = ic('check', 13); sdesc = st.hint; }
      else if (reachedPrev && !dropMarked) { cls = 'drop'; dropMarked = true; node = ic('x', 12);
        tag = '<span class="pt-tag drop">тут оборвался</span>'; sdesc = 'дальше не пошел — здесь остановка'; }
      else { cls = 'todo'; node = '<span style="font-size:11px;font-weight:700">' + (FSTEPS.indexOf(st) + 1) + '</span>';
        sdesc = 'не дошел'; }
      if (!ok) reachedPrev = false;
      var t = stepTime[st.key];
      var subs = (subsByStep[st.key] || []).slice().sort(function (a, b) { return new Date(a.at || 0) - new Date(b.at || 0); });
      var subsHtml = subs.length ? '<div class="pt-subs">' + subs.map(function (s) {
        return '<div class="pt-sub' + (s.hi ? ' hi' : '') + (s.comm ? ' comm' : '') + '">' + esc(s.text) +
          (s.at ? '<span class="sw num">' + fmtWhen(s.at) + '</span>' : '') + '</div>';
      }).join('') + '</div>' : '';
      return '<div class="pt-step ' + cls + '">' +
        '<div class="pt-rail"><div class="pt-node">' + node + '</div><div class="pt-line"></div></div>' +
        '<div class="pt-body"><div class="pt-t">' + st.label + tag +
          (t ? '<span class="pt-when num">' + fmtWhen(t) + '</span>' : '') + '</div>' +
          '<div class="pt-s">' + sdesc + '</div>' + subsHtml +
        '</div></div>';
    }).join('');
    return '<div class="path-tl">' + rows + '</div>';
  }
```

### 3.6 ЗАМЕНЯЕТ `buildNotesSection` (строки 1633–1662)

```js
  function buildNotesSection(ctx) {
    var crm = ctx.crm;
    var tasks = (crm.tasks || []).slice().sort(function (a, b) {
      if (!!a.done !== !!b.done) return a.done ? 1 : -1;
      return (a.due || '9999') < (b.due || '9999') ? -1 : 1;
    });
    var comms = (crm.comms || []).slice(-8).reverse();
    var commIc = { call: 'phone', msg: 'send', meet: 'cal' };
    return '<div class="m-ctitle">Заметки и задачи</div>' +
      '<div class="m-csub">Веди клиента: о чем договорились, что обещал, какой следующий шаг.</div>' +
      '<div class="m-sec"><div class="m-sec-h">Заметка</div>' +
        '<textarea class="note-ta" id="m-note" placeholder="О чем договорились, что обещали, нюансы">' + esc(crm.note || '') + '</textarea>' +
        '<div class="note-state" id="m-notestate"></div></div>' +
      '<div class="m-sec"><div class="m-sec-h">Задачи</div><div id="m-tasks">' + tasks.map(function (t) {
        var over = !t.done && t.due && t.due < todayISO(0);
        return '<div class="task' + (t.done ? ' done' : '') + (over ? ' overdue' : '') + '" data-tid="' + esc(t.id) + '">' +
          '<button class="task-chk">' + ic('check', 11) + '</button>' +
          '<div class="task-body"><div class="task-text">' + esc(t.text) + '</div>' +
          (t.due ? '<div class="task-due">' + (over ? ic('clock', 11) : '') + fmtDue(t.due) + '</div>' : '') + '</div>' +
          '<button class="task-del">' + ic('x', 12) + '</button></div>';
      }).join('') + (tasks.length ? '' : '<div class="field-empty">Задач нет. Поставь следующий шаг ниже.</div>') + '</div>' +
        '<div class="task-add"><input id="m-task-in" placeholder="Новая задача — Enter" autocomplete="off">' +
        '<span class="due-seg" id="m-due"><button data-d="0" class="on">сегодня</button><button data-d="1">завтра</button><button data-d="">без срока</button></span></div></div>' +
      '<div class="m-sec"><div class="m-sec-h">Журнал контактов</div>' +
        '<div class="comm-btns" id="m-comms"><button data-k="call">' + ic('phone', 13) + 'звонок</button>' +
        '<button data-k="msg">' + ic('send', 13) + 'написал</button><button data-k="meet">' + ic('cal', 13) + 'встреча</button></div>' +
        (comms.length ? '<div class="comm-log">' + comms.map(function (cm) {
          return '<div class="comm-row"><span class="ci">' + ic(commIc[cm.kind] || 'note', 13) + '</span>' +
            '<span class="ct">' + esc(COMM_KINDS[cm.kind] || cm.kind) + (cm.text ? ' · ' + esc(cm.text) : '') + '</span>' +
            '<span class="when num">' + fmtWhen(cm.at) + '</span></div>';
        }).join('') + '</div>' : '<div class="field-empty" style="padding:16px 10px">Контактов еще не было. Отметь первый ↑</div>') + '</div>';
  }
```

### 3.7 ЗАМЕНЯЕТ `buildDocsSection` (строки 1671–1689)

```js
  function buildDocsSection(ctx) {
    var docs = (ctx.d && ctx.d.docs) || [];
    var rows = docs.map(function (dc) {
      var href = dc.link ? dc.link : (API + '/admin/api/docs/' + dc.id + '/download?k=' + encodeURIComponent(getKey()));
      var meta = [dc.kind, dc.link ? 'ссылка' : fmtSize(dc.size_bytes), fmtWhen(dc.created_at)].filter(Boolean).join(' · ');
      return '<div class="doc-row" data-did="' + dc.id + '">' +
        '<span class="doc-ic">' + ic(dc.link ? 'ext' : 'doc', 17) + '</span>' +
        '<div class="doc-b"><div class="doc-n">' + esc(dc.name) + '</div><div class="doc-m">' + esc(meta) + '</div></div>' +
        '<div class="doc-act">' +
          '<a class="icobtn" target="_blank" rel="noopener" href="' + esc(href) + '" title="Открыть">' + ic(dc.link ? 'ext' : 'dl', 14) + '</a>' +
          '<button class="icobtn del" data-deldoc="' + dc.id + '" title="Удалить">' + ic('x', 14) + '</button>' +
        '</div></div>';
    }).join('');
    return '<div class="m-ctitle">Документы</div>' +
      '<div class="m-csub">Паспорт, аттестат, согласия — что прислал клиент. Файл до 12 МБ или ссылка.</div>' +
      (docs.length ? '<div>' + rows + '</div>' : '') +
      '<div class="dropzone" id="m-drop"><input type="file" id="m-file" style="display:none">' +
        '<div class="dz-ic">' + ic('dl', 18) + '</div>' +
        '<div><b>Выбери файл</b> или перетащи сюда</div></div>' +
      '<div class="linkrow"><input id="m-link" placeholder="…или вставь ссылку на документ"><button class="bp sm" id="m-link-add">' + ic('plus', 13) + 'Добавить</button></div>';
  }
```

> Поведение загрузки/удаления уже в `attachContentHandlers` (drag&drop, file, link) —
> id-шники (`m-drop`,`m-file`,`m-link`,`m-link-add`,`data-deldoc`) сохранены, обработчики
> не трогаем.

### 3.8 ЗАМЕНЯЕТ `buildAiSections` (строки 1833–1971)

Использует новый `aiSec(title, inner, opts)` вместо `sec()`. `sec()` оставить (зовётся? — нет, только в buildAiSections; можно оставить как есть, не мешает). `buildTimeline` остаётся.

```js
  function aiSec(title, inner, hr) {
    if (!inner) return '';
    return '<div class="m-sec' + (hr ? ' qa-fold' : '') + '"><div class="m-sec-h">' + title +
      (hr ? '<span class="hr">' + hr + '</span>' : '') + '</div>' +
      (hr ? '<div class="qa-wrap">' + inner + '</div>' : inner) + '</div>';
  }

  function buildAiSections(d) {
    var diag = d.diagnostics || {};
    var plan = d.roadmap || {};
    var answers = d.answers || {};
    var html = '<div class="m-ctitle">Разбор AI</div>' +
      '<div class="m-csub">Что AI показал человеку на диагностике — с этим заходить на созвон.</div>';

    /* 1. ВЕРДИКТ — крупный хедлайн + мост (хиро) */
    var v = diag.verdict || {};
    if (v.headline || v.text || (diag.gap && (diag.gap.point_a || diag.gap.bridge))) {
      var hero = '<div class="ai-hero"><div class="ah-k">' + ic('spark', 12) + 'Вердикт AI</div>';
      if (v.headline) hero += '<div class="ah-t">' + esc(v.headline) + '</div>';
      if (v.text) hero += '<div class="ah-s">' + esc(v.text) + '</div>';
      if (diag.gap && (diag.gap.point_a || diag.gap.point_b || diag.gap.bridge)) {
        hero += '<div class="ai-gap">' +
          (diag.gap.point_a ? '<div class="gr"><span class="gk">Сейчас</span><span class="gv">' + esc(diag.gap.point_a) + '</span></div>' : '') +
          (diag.gap.point_b ? '<div class="gr"><span class="gk">Цель</span><span class="gv">' + esc(diag.gap.point_b) + '</span></div>' : '') +
          (diag.gap.bridge ? '<div class="gr"><span class="gk">Мост</span><span class="gv">' + esc(diag.gap.bridge) + '</span></div>' : '') +
        '</div>';
      }
      hero += '</div>';
      html += '<div class="m-sec">' + hero + '</div>';
    }

    /* 2. ПРОДАЖА — что подобрал AI (шпаргалка) */
    var saleInner = '';
    if (plan.offer && plan.offer.title) {
      saleInner += '<div class="rec"><span class="ri">' + ic('spark', 12) + '</span><div>' +
        '<b>' + esc(plan.offer.title) + '</b>' +
        (plan.offer.outcome ? '<div class="sub">' + esc(plan.offer.outcome) + '</div>' : '') + '</div></div>';
    }
    if (plan.track && (plan.track.title || plan.track.why)) {
      saleInner += '<div class="mech" style="margin-top:' + (saleInner ? '14px' : '0') + '">Трек: <b>' + esc(plan.track.title || plan.track.kind) + '</b>' +
        (plan.track.why ? ' — ' + esc(plan.track.why) : '') + '</div>';
    }
    var prods = [];
    (plan.stages || []).forEach(function (st) { if (st && st.product && st.product.name) prods.push(st.product); });
    if (prods.length) {
      saleInner += '<div style="margin-top:12px">' + prods.map(function (p) {
        return '<div class="prod-r"><b>' + esc(p.name) + '</b><span>' + esc(p.because || '') + '</span></div>';
      }).join('') + '</div>';
    }
    html += aiSec('Что предложить — подбор AI', saleInner);

    /* 3. ШАНСЫ — метрики + категории */
    var mInner = '';
    if (Array.isArray(diag.metrics) && diag.metrics.length) {
      mInner += '<div class="ab">' + diag.metrics.map(function (m) {
        var cls = m.tone === 'ok' ? 'good' : m.tone === 'bad' ? 'bad' : 'mid';
        return '<div class="r"><span class="k">' + esc(m.label) + '</span><span class="v ' + cls + '">' + esc(m.value) +
          (m.note ? ' · ' + esc(m.note) : '') + '</span></div>';
      }).join('') + '</div>';
    }
    if (Array.isArray(diag.categories) && diag.categories.length) {
      mInner += '<div style="margin-top:' + (mInner ? '14px' : '0') + '">' + diag.categories.map(function (ct) {
        var t = scoreTone(ct.pct);
        return '<div class="catr"><span class="k">' + esc(ct.title) + '</span>' +
          '<div class="strack" style="max-width:none"><i style="width:' + (ct.pct || 0) + '%; background:' + t.c + '"></i></div>' +
          '<span class="p num" style="color:' + t.c + '">' + esc(ct.pct) + '%</span></div>';
      }).join('') + '</div>';
    }
    html += aiSec('Шансы на поступление', mInner);

    /* 4. ВУЗЫ */
    if (Array.isArray(diag.universities) && diag.universities.length) {
      html += aiSec('Вузы под профиль', diag.universities.map(function (u) {
        return '<div class="uni-r"><div><div class="uni-nm">' + esc(u.name_ru) + '</div>' +
          '<div class="uni-sub">' + esc(u.name_zh || '') + (u.city ? ' · ' + esc(u.city) : '') + (u.rank ? ' · ' + esc(u.rank) : '') + '</div></div>' +
          '<span class="uni-tag">' + esc(UNI_TYPE[u.type] || u.type || '') + '</span>' +
          '<div class="uni-right"><div class="uni-ch num">' + esc(u.chance_pct) + '%</div>' +
          (u.grant ? '<div class="uni-gr">' + esc(u.grant) + '</div>' : '') + '</div></div>';
      }).join(''));
    }

    /* 5. СИЛЬНОЕ / РОСТ */
    function sgList(arr, isGrow) {
      if (!Array.isArray(arr) || !arr.length) return '';
      return '<ul>' + arr.map(function (it) {
        if (typeof it === 'string') return '<li><b>' + esc(it) + '</b></li>';
        var critHtml = '';
        if (isGrow && it.crit) {
          var critRu = { block: 'критично', imp: 'важно', nice: 'желательно' }[it.crit] || it.crit;
          critHtml = '<span class="crit ' + esc(it.crit) + '">' + esc(critRu) + '</span>';
        }
        return '<li><b>' + esc(it.title) + critHtml + '</b>' + (it.desc ? '<span>' + esc(it.desc) + '</span>' : '') + '</li>';
      }).join('') + '</ul>';
    }
    var sb = sgList(diag.strengths, false), gr = sgList(diag.growth, true);
    if (sb || gr) {
      html += aiSec('Сильное и зоны роста',
        '<div class="sg2">' +
        (sb ? '<div class="sg"><div class="sg-h ok">Сильные стороны</div>' + sb + '</div>' : '') +
        (gr ? '<div class="sg"><div class="sg-h grow">Зоны роста</div>' + gr + '</div>' : '') +
        '</div>');
    }

    /* 6. ПЛАН */
    if (Array.isArray(plan.stages) && plan.stages.length) {
      html += aiSec('План, который увидел человек', plan.stages.map(function (st, i) {
        var acts = (st.acts || st.actions || st.steps || []);
        return '<div class="stage"><div class="stage-n num">' + (i + 1) + '</div><div>' +
          '<div class="stage-t">' + esc(st.title) + (st.when ? '<span>' + esc(st.when) + (st.sub ? ' · ' + esc(st.sub) : '') + '</span>' : '') + '</div>' +
          (acts.length ? '<ul>' + acts.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul>' : '') +
        '</div></div>';
      }).join(''));
    }

    /* 7. АНКЕТА — свёрнута, разворачивается по клику на «показать» */
    var qaPairs = [], shown = {};
    SNAPSHOT.forEach(function (p) {
      var val = fmtVal(answers[p[0]]); if (val == null || val === '') return;
      shown[p[0]] = 1; qaPairs.push([p[1], val]);
    });
    (d.questions || []).forEach(function (pair) {
      var key = pair[0], label = pair[1]; if (shown[key]) return;
      var val = fmtVal(answers[key]); if (val == null || val === '') return;
      shown[key] = 1; qaPairs.push([label, val]);
    });
    Object.keys(answers).forEach(function (key) {
      if (shown[key] || key === 'name') return;
      var val = fmtVal(answers[key]); if (val == null || val === '') return;
      qaPairs.push([key.replace(/_/g, ' '), val]);
    });
    if (qaPairs.length) {
      html += aiSec('Анкета — ответы человека', '<div>' + qaPairs.map(function (p) {
        return '<div class="qa-r"><span class="k">' + esc(p[0]) + '</span><span class="v">' + esc(p[1]) + '</span></div>';
      }).join('') + '</div>', 'показать');
    }
    return html;
  }
```

### 3.9 ДОБАВКИ в `attachContentHandlers` (строки 1715–1816)

Существующее тело не меняем (заметка, задачи, comms, docs, pay, advance, copy — всё
работает по сохранённым id). ДОБАВИТЬ в конец функции (перед закрывающей `}`):

```js
    // инлайн-эдит контакт/email/город (раздел «Сейчас»)
    Array.prototype.forEach.call(host.querySelectorAll('.ef-v[data-edit]'), function (n) {
      bindInline(n, n.getAttribute('data-edit'), {
        ph: { contact: '@username или +7…', email: 'email', city: 'Город' }[n.getAttribute('data-edit')] });
    });
    Array.prototype.forEach.call(host.querySelectorAll('.ef-copy[data-copy]'), function (b) {
      b.addEventListener('click', function (e) { e.stopPropagation(); copyText(b.getAttribute('data-copy'), b); });
    });
    // dr-rej в «Сейчас» теперь .dr-rej (внутри m-st) — уже покрыт stHost-обработчиком ниже,
    //   т.к. у кнопки есть data-s и она внутри #m-st. ОК.
    // свёртка анкеты в Разборе AI
    Array.prototype.forEach.call(host.querySelectorAll('.qa-fold .m-sec-h'), function (h) {
      h.addEventListener('click', function () { h.parentNode.classList.toggle('open'); });
    });
```

> Важно: в старом `buildNow` кнопка отказа была `.dr-rej` БЕЗ `data-s`-обработки через
> `#m-st`? — нет, она внутри `#m-st` и имеет `data-s`, а `stHost` навешивает на
> `#m-st [data-s]`. В новом `buildNow` она тоже внутри `#m-st` с `data-s` — значит
> переключение отказа продолжит работать без изменений. `nd-copy`/`c-copy` из старого
> кода больше не генерятся (контакт-строку заменил блок «Кто это» с `.ef-copy`), их
> обработчики (`cc`,`ndc`) станут no-op (el вернёт null) — безопасно, можно оставить.

---

## 4. BACKEND

Нужна поддержка инлайн-редактирования полей менеджером (override поверх данных анкеты/booking).
Эндпоинт `PATCH /admin/api/leads/{id}` уже принимает `crm`-поля (`status`, `note`, `tasks`,
`comms`) и возвращает `{crm}`. Расширить:

1. **PATCH `/admin/api/leads/{id}` принимает доп. поля:** `name`, `contact`, `email`, `city`
   (строки, любая может прийти одна). Это ручные override менеджера, НЕ перезапись данных
   анкеты. Хранить в новой jsonb-колонке (предлагаю `crm_overrides jsonb default '{}'`) или
   внутри существующего crm-jsonb под ключом `overrides`.
2. **Ответ PATCH** должен вернуть override обратно — проще всего вложить их в возвращаемый
   `crm` под ключом `_ov` (или `overrides`): `{ "crm": { …, "_ov": {"name":"…","contact":"…","email":"…","city":"…"} } }`.
   Фронт читает `crm._ov` / `crm.overrides` (helper `ov()` поддерживает оба).
3. **GET `/admin/api/leads`** (список) и **GET `/admin/api/leads/{id}`** (деталь) должны
   возвращать те же override внутри `crm._ov`/`crm.overrides`, чтобы отредактированные имя/
   контакт показывались и в таблице, и при повторном открытии без правок (поле `name` в
   списке можно оставить как есть — фронт в карточке берёт override первым).
4. Валидация лояльная: пустая строка = очистить override (вернуться к данным анкеты). Длины
   разумные (name ≤ 120, contact ≤ 200, email ≤ 200, city ≤ 120). Email/контакт не
   обязаны быть валидными (менеджер пишет как есть).
5. Существующие эндпоинты docs/pay (`POST /admin/api/leads/{id}/docs`,
   `DELETE /admin/api/docs/{id}`, `POST /admin/api/leads/{id}/payments`,
   `DELETE /admin/api/payments/{id}`) — без изменений, фронт их уже использует.

---

## Сжатый итог

- Передизайнил всю карточку клиента (центр-модалку): тихая шапка с аватаром, инлайн-именем
  и score-«пульсом»; новый блок «Кто это» с редактируемыми контакт/email/город.
- Инлайн-редактирование через общий `bindInline()` + helper `ov()` (override поверх анкеты);
  автосейв по blur/Enter через существующий `patch()`.
- «Путь» дедуплицирован: удалил `buildJourney`, оставил ОДИН богатый таймлайн
  (`buildPathTimeline`) — 7 шагов платформы со статусом/временем и под-событиями; `buildTimeline`
  не трогал (его зовёт AI-разбор).
- Заметки: журнал контактов без верхней полоски, иконки в логе; задачи — благородная
  янтарная риска вместо красной заливки.
- `buildAiSections` пересобран структурно (вердикт-хиро → продажа → шансы → вузы → сильное/рост
  → план → свёрнутая анкета); skeleton заменён на shimmer-каркас под раздел.
- Контракты функций (`renderDrawer`/`renderModalContent`/`attachContentHandlers`) сохранены —
  `setModalSection`/`drawerStep`/`patch`-перерисовка работают без правок вызывающих.
- ЗАВИСИТ ОТ БЭКА: PATCH `/admin/api/leads/{id}` должен принимать override-поля
  `name/contact/email/city` и возвращать их в `crm._ov`/`crm.overrides` (плюс отдавать их в
  GET списка и детали). Без этого инлайн-эдит сохраняется визуально, но не персистится.
- ПЕРЕСЕЧЕНИЯ: статус-пилюли `.sev` — общий стиль с агентом LIST (использую как есть, не
  переопределяю). Удаляю мёртвые классы `.jrn*`, `.contact-line`, `.stchips/.stc` — убедиться,
  что их не использует чужой участок (по коду — только карточка).
```
