-- Ведомость: дубли платежей и остатки счетов.
--
-- Найдено 16.08.2026 при сверке боевой схемы с перепиской владельца
-- (_specs/finmodel/chat/chat-full.md). Три вещи, каждая тихая: экран не краснеет,
-- цифра просто неверная.
--
-- 1. ЗАЩИТЫ ОТ ДУБЛЕЙ НЕТ. Функция finmodel.flag_duplicate_income написана и лежит
--    в схеме, но триггером к таблице operations никогда не подключалась — проверено
--    на бою запросом к pg_trigger: на operations висят только operations_defaults_trg
--    и mark_edited_after_close_trg. Значит второй платеж с тем же номером ЮKassa
--    молча удваивает доход, а вместе с ним и все отчисления от него (20 % туда,
--    20 % сюда, 8 % налогов). Тот единственный дубль, что есть в базе сейчас
--    (11 707,20), помечен руками — следующий никто не поймает.
--
-- 2. ПОМЕЧЕННЫЙ ДУБЛЬ СИДИТ В ОСТАТКЕ СЧЕТА. Доход считает только учитываемые строки
--    (period_income фильтрует included), а остатки — все подряд: account_movement,
--    balance_live, dashboard_cash и v_fund_balances фильтра не имеют. Из-за этого
--    на бою «пришло на ВТБ» 1 251 916,38 против дохода 1 240 209,18 — разница ровно
--    в задвоенную платежку, и она переезжает в следующий период через carry_opening.
--    Смысл флага included — «строка видна, но не считается»; считаться она не должна
--    нигде, иначе расхождение с банком не исчезло, а спряталось.
--
-- 3. НОВАЯ ВЕДОМОСТЬ, СОЗДАННАЯ НЕ ЗАКРЫТИЕМ, СЧИТАЕТ НАЛОГ ПО-СТАРОМУ. seed_rules
--    до сих пор ставит налогам базу «база», хотя владелец 11.08.2026 перевел их на
--    весь доход (fix-tax-base.sql). Закрытие периода правила копирует и потому не
--    страдает, а вот ведомость, заведенная руками, тихо посчитает 8 % не от того.
--
-- Данные не трогаются: меняются функции, одно представление и добавляется триггер.
-- Прогон повторно безопасен.

-- ── 1. Дубли: функция плюс триггер ───────────────────────────────────────────

-- В проверку добавлено «и это не я сам»: без этого триггер, повешенный на UPDATE,
-- нашел бы саму правимую строку и пометил ее дублем самой себя.
CREATE OR REPLACE FUNCTION finmodel.flag_duplicate_income() RETURNS trigger
LANGUAGE plpgsql AS $function$
declare
  v_pid text := nullif(trim(new.meta->>'paymentId'), '');
begin
  if new.kind = 'доход' and v_pid is not null and new.included then
    if exists (
      select 1 from finmodel.operations o
       where o.kind = 'доход'
         and o.included
         and o.id is distinct from new.id
         and nullif(trim(o.meta->>'paymentId'), '') = v_pid
    ) then
      new.included := false;
      if coalesce(new.comment, '') = '' then
        new.comment := 'дубль платежа — не входит в доход';
      end if;
    end if;
  end if;
  return new;
end;
$function$;

DROP TRIGGER IF EXISTS flag_duplicate_income_trg ON finmodel.operations;
CREATE TRIGGER flag_duplicate_income_trg
  BEFORE INSERT ON finmodel.operations
  FOR EACH ROW EXECUTE FUNCTION finmodel.flag_duplicate_income();

-- ── 2. Остатки считают только то, что считается ──────────────────────────────

CREATE OR REPLACE FUNCTION finmodel.account_movement(p_period_id uuid, p_account text)
RETURNS numeric LANGUAGE sql STABLE AS $function$
  select coalesce((
    select sum(case
      when o.kind = 'доход'   and o.account_id    = p_account then  o.amount
      when o.kind = 'расход'  and o.account_id    = p_account then -o.amount
      when o.kind = 'перевод' and o.account_to_id = p_account then  o.amount
      when o.kind = 'перевод' and o.account_id    = p_account then -o.amount
      else 0 end)
    from finmodel.operations o
    where o.period_id = p_period_id and o.status = 'факт'
      and (o.kind <> 'доход' or o.included)
  ), 0);
$function$;

CREATE OR REPLACE FUNCTION finmodel.balance_live(p_period_id uuid, p_account text)
RETURNS numeric LANGUAGE sql STABLE AS $function$
  select coalesce((select opening from finmodel.period_accounts
                    where period_id = p_period_id and account_id = p_account), 0)
       + coalesce((
           select sum(case
             -- доходы и расходы: только то, что произошло
             when o.kind = 'доход'   and o.account_id    = p_account
                  and o.status = 'факт' and o.included              then  o.amount
             when o.kind = 'расход'  and o.account_id    = p_account
                  and o.status = 'факт'                             then -o.amount
             -- переводы: и факт, и план — отчисление известно по правилу
             when o.kind = 'перевод' and o.account_to_id = p_account
                  and o.status in ('факт','план')                   then  o.amount
             when o.kind = 'перевод' and o.account_id    = p_account
                  and o.status in ('факт','план')                   then -o.amount
             else 0 end)
           from finmodel.operations o
          where o.period_id = p_period_id), 0);
$function$;

CREATE OR REPLACE FUNCTION finmodel.dashboard_cash(p_period_id uuid)
RETURNS TABLE("пришло_втб" numeric, "ушло_наружу" numeric, "ушло_в_фонды" numeric,
              cash_flow numeric, "результат" numeric)
LANGUAGE sql STABLE AS $function$
  -- Cash Flow РАСЧЁТНОГО СЧЁТА ВТБ: сколько на нём осталось.
  -- Отложение в фонд — это отток с ВТБ (деньги ушли на счёт фонда), поэтому
  -- вычитается наравне с расходами наружу. Прямые расходы, идущие С ФОНДОВ,
  -- ВТБ не трогают и здесь не считаются. Дубли платежей не считаются тоже.
  with д as (
    select
      coalesce((select sum(amount) from finmodel.operations
                 where period_id = p_period_id and kind = 'доход'
                   and status = 'факт' and account_id = 'vtb' and included), 0) as приход,
      coalesce((select sum(amount) from finmodel.operations
                 where period_id = p_period_id and kind = 'расход'
                   and status = 'факт' and account_id = 'vtb'), 0) as наружу,
      coalesce((select sum(amount) from finmodel.operations
                 where period_id = p_period_id and kind = 'перевод'
                   and status in ('факт','план') and account_id = 'vtb'
                   and account_to_id in (select id from finmodel.accounts
                                          where kind = 'фонд')), 0) as в_фонды
  )
  select приход, наружу, в_фонды,
         приход - наружу - в_фонды,
         приход - наружу - в_фонды
  from д;
$function$;

-- Представление пересоздаём целиком: у него меняется одна ветка («поступления»),
-- а CREATE OR REPLACE VIEW требует прежнего списка колонок — он сохранён.
CREATE OR REPLACE VIEW finmodel.v_fund_balances WITH (security_invoker='on') AS
 WITH d AS (
         SELECT p.id AS period_id,
            p.name AS "ведомость",
            p.status AS "статус_ведомости",
            a.id AS account_id,
            a.name AS "счёт",
            a.kind AS "вид",
            a.sort,
            COALESCE(pa.opening, (0)::numeric) AS "остаток_с_прошлого",
            COALESCE(pa.opening_source, 'перенос'::text) AS "остаток_откуда",
            COALESCE(pa.opening_note, ''::text) AS "остаток_почему",
            COALESCE(pr.name, ''::text) AS "остаток_кто",
            pa.opening_at AS "остаток_когда",
            COALESCE(( SELECT sum(o.amount) AS sum
                   FROM finmodel.operations o
                  WHERE ((o.period_id = p.id) AND (o.kind = 'расход'::text) AND (o.account_id = a.id) AND (o.status = 'факт'::text))), (0)::numeric) AS "расходы_с_фонда",
            COALESCE(( SELECT sum(o.amount) AS sum
                   FROM finmodel.operations o
                  WHERE ((o.period_id = p.id) AND (o.kind = 'перевод'::text) AND (o.account_to_id = a.id) AND (o.status = ANY (ARRAY['факт'::text, 'план'::text])))), (0)::numeric) AS "пополнение",
            COALESCE(( SELECT sum(o.amount) AS sum
                   FROM finmodel.operations o
                  WHERE ((o.period_id = p.id) AND (o.kind = 'перевод'::text) AND (o.account_id = a.id) AND (o.status = ANY (ARRAY['факт'::text, 'план'::text])))), (0)::numeric) AS "ушло_с_этого_счёта",
            COALESCE(( SELECT sum(o.amount) AS sum
                   FROM finmodel.operations o
                  WHERE ((o.period_id = p.id) AND (o.account_id = a.id) AND (o.status = 'факт'::text) AND (o.kind = 'доход'::text) AND o.included)), (0)::numeric) AS "поступления"
           FROM (((finmodel.periods p
             CROSS JOIN finmodel.accounts a)
             LEFT JOIN finmodel.period_accounts pa ON (((pa.period_id = p.id) AND (pa.account_id = a.id))))
             LEFT JOIN finmodel.profiles pr ON ((pr.id = pa.opening_by)))
          WHERE (a.active AND (a.kind = ANY (ARRAY['банк'::text, 'фонд'::text])))
        )
 SELECT period_id, "ведомость", "статус_ведомости", account_id, "счёт", "вид", sort,
    "остаток_с_прошлого", "остаток_откуда", "остаток_почему", "остаток_кто",
    "остаток_когда", "расходы_с_фонда", "пополнение", "ушло_с_этого_счёта",
    "поступления",
    ((("остаток_с_прошлого" + "поступления") - "расходы_с_фонда") - "ушло_с_этого_счёта") AS "остаток_в_периоде",
    (((("остаток_с_прошлого" + "поступления") - "расходы_с_фонда") - "ушло_с_этого_счёта") + "пополнение") AS "остаток_на_следующий",
        CASE
            WHEN (((("остаток_с_прошлого" + "поступления") - "расходы_с_фонда") - "ушло_с_этого_счёта") < (0)::numeric) THEN 'фонд ушёл в минус — платили больше, чем на нём было'::text
            ELSE ''::text
        END AS "тревога"
   FROM d;

-- Тревога оставлена как была — она считается по остатку ДО отчислений этого периода,
-- и это правило владельца, а не недосмотр. В рабочей таблице EastSide две цифры
-- остатка: средняя (прошлый минус расходы) показывает, хватало ли фонду денег в
-- момент выплаты, и краснеет именно она; вторая — с переходом на следующий период.
-- Экран ведомости обе и показывает: рядом с тревогой стоит «до отложений столько-то».
-- Первая версия этого патча переводила тревогу на итог периода — то есть меняла
-- смысл сигнала. Убрано: правило чужое, менять его не мне.

-- ── 3. Заводские правила новой ведомости ─────────────────────────────────────

CREATE OR REPLACE FUNCTION finmodel.seed_rules(p_period_id uuid) RETURNS void
LANGUAGE sql AS $function$
  insert into finmodel.period_rules (period_id, account_id, mode, percent, fixed_amount, base, sort)
  values
    (p_period_id, 'shortterm',   'сумма',    0, 0, 'доход',          10),
    (p_period_id, 'contractors', 'процент', 20, 0, 'база',           20),
    (p_period_id, 'marketing',   'процент', 20, 0, 'база',           30),
    (p_period_id, 'taxes',       'процент',  8, 0, 'доход',          40),
    (p_period_id, 'safety',      'сумма',    0, 0, 'база',           50),
    (p_period_id, 'flex',        'процент', 20, 0, 'чистая прибыль', 90)
  on conflict (period_id, account_id) do nothing;
$function$;

-- Проверка после прогона (на бою, открытый период 21.05–10.06):
--   select * from finmodel.dashboard_cash('b65a0a15-78a5-4f58-8953-a6d93bffeac8');
--   ждём «пришло_втб» 1 240 209,18 вместо 1 251 916,38 — на 11 707,20 меньше,
--   ровно на задвоенную платёжку.
--
-- ПРОГНАН на боевой базе 2026-08-17 с разрешения Романа («ну делай»). После прогона
-- dashboard_cash дал «пришло_втб» 1 240 209,18 (было 1 251 916,38) — дубль ушёл из
-- остатка. Снимок схемы обновлён (eastside-backend/tests/finmodel), 2 теста расчёта
-- сняты с xfail. Триггер flag_duplicate_income_trg подтверждён в pg_trigger.
