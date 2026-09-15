-- Ведомость: фонд налогов считается от всего дохода, а не от базы.
--
-- Поправка оператора от 2026-08-11: «8 процентов берется не после вычета
-- краткосрочки, а вообще от всей суммы дохода».
--
-- Просто переключить базу у правила НЕЛЬЗЯ — сегодня расчет устроен так, что
-- фонд с базой «доход» выпадает из отчислений совсем (проверено на боевой базе):
--
--   period_allocations() суммирует только правила с base = 'база';
--   rule_base_value() для 'доход' возвращает переданную базу, то есть все равно
--   считает от базы, а не от дохода.
--
-- Если переключить базу в интерфейсе, ничего не поправив, налоги перестанут
-- вычитаться вообще: чистая прибыль и дивиденды ВЫРАСТУТ. Цифра будет красивая и
-- неверная — ровно то, чего в финансах допускать нельзя.
--
-- Поэтому лечим формулы, а потом переключаем правило.
-- Данные не трогаются: меняются только функции расчета и одна строка настройки.

-- 1. База «доход» должна означать доход к зачислению.
CREATE OR REPLACE FUNCTION finmodel.rule_base_value(p_period_id uuid, p_account text,
                                                    p_base numeric)
RETURNS numeric LANGUAGE sql STABLE AS $function$
  select case (select base from finmodel.period_rules
                where period_id = p_period_id and account_id = p_account)
    when 'продажи услуг'   then finmodel.period_offering_sales(p_period_id, p_account)
    when 'продажи вручную' then coalesce((select manual_base from finmodel.period_rules
                                           where period_id = p_period_id
                                             and account_id = p_account), 0)
    when 'доход'           then finmodel.period_income(p_period_id)
    else p_base
  end;
$function$;

-- 2. В отчисления входят все фонды, у которых есть правило, независимо от их базы.
--    Кроме двух: краткосрочка вычитается раньше (она и формирует базу), а флекс
--    считается от чистой прибыли уже после отчислений.
CREATE OR REPLACE FUNCTION finmodel.period_allocations(p_period_id uuid)
RETURNS numeric LANGUAGE sql STABLE AS $function$
  select coalesce(sum(finmodel.rule_amount(p_period_id, account_id,
                                           finmodel.period_base(p_period_id))), 0)
    from finmodel.period_rules
   where period_id = p_period_id
     and account_id not in ('shortterm', 'flex');
$function$;

-- 3. Само правило: налоги считаются от дохода к зачислению.
UPDATE finmodel.period_rules SET base = 'доход' WHERE account_id = 'taxes';

-- ПРОГНАН на боевой базе 2026-08-11 с разрешения владельца («чини налог»).
-- Открытый период 21.05-10.06, было → стало:
--   отчисления в фонды   353 380,41 → 393 700,41  (налоги 8 % от дохода = 99 216,73)
--   чистая прибыль        42 998,77 →   2 678,77
--   флекс-проджекта        8 599,75 →     535,75
--   дивиденды             34 399,02 →   2 143,02
--   доход 1 240 209,18, краткосрочка 504 000,00, база 736 209,18, прямые 339 830,00
--   проверка: select * from finmodel.v_period_summary;
--
-- Откат: вернуть base='база' у taxes и прежние тела двух функций (в git этого нет,
-- прежний вариант описан в комментарии сверху: фильтр base='база' и else p_base).
