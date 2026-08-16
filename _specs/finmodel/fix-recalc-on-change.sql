-- Ведомость: отчисления пересчитываются сами, а не по нажатию.
--
-- Найдено 16.08.2026 при сверке переезда ведомости в CRM.
--
-- В ЧЁМ ДЫРА. Пока период открыт, отчисление в фонд — это расчёт: 20 % от базы,
-- база растёт с каждым платежом, сумма едет следом (так владелец и договаривался,
-- сообщение 241 в переписке). Но пересчёт запускала не база, а старый html-файл:
-- после каждой правки он звал recalc_allocations сам (функция refreshAllocations,
-- строка 3332 в finmodel-stage8.html). В CRM такого вызова нет и не будет — экран
-- ведомости только читает. Триггера в базе не было никогда.
--
-- Значит после переезда плановые отчисления застывают на моменте последнего
-- пересчёта, и вместе с ними едут в неверную сторону: остатки фондов, движение
-- денег, P&L и предупреждения перед закрытием.
--
-- ЭТО УЖЕ СЛУЧИЛОСЬ. 11.08.2026 налоги перевели на весь доход. С тех пор никто не
-- пересчитывал, и на бою висит:
--   плановые переводы   857 380,41   а по правилам должно быть 897 700,41
--   налоги в P&L         58 896,73   а должно быть 99 216,73
--   чистая прибыль в P&L 42 998,77   а в каскаде 2 678,77
-- Разница 40 320 ₽ вылечится сама при закрытии периода (close_and_open_next зовёт
-- freeze_allocations, а тот пересчитывает перед заморозкой), но до закрытия все
-- эти цифры на экране неверные.
--
-- ЛЕЧЕНИЕ. Пересчёт переезжает в базу: кто бы ни менял доход или правила — старый
-- файл, CRM, приёмник ЮKassa или человек в SQL — отчисления пересчитаются.
--
-- Триггер висит только на доходах: суммы отчислений зависят от дохода и правил,
-- прямые расходы на них не влияют (они вычитаются ниже по каскаду). Переводы
-- пропускаются намеренно — их создаёт сам пересчёт, и реагировать на них значит
-- уйти в рекурсию; pg_trigger_depth стоит второй страховкой на тот же случай.

CREATE OR REPLACE FUNCTION finmodel.recalc_after_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'finmodel' AS $function$
declare
  v_kind text;
  v_pid  uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;

  if TG_OP = 'DELETE' then
    v_kind := old.kind; v_pid := old.period_id;
  else
    v_kind := new.kind; v_pid := new.period_id;
  end if;

  -- Переводы создаёт сам пересчёт. Прямые расходы на отчисления не влияют.
  if v_kind <> 'доход' then return null; end if;

  -- Для закрытой ведомости recalc_allocations возвращается сразу: история
  -- заморожена, и платёж, внесённый задним числом, её не двигает.
  perform finmodel.recalc_allocations(v_pid);
  return null;
end;
$function$;

COMMENT ON FUNCTION finmodel.recalc_after_change() IS
  'Пересчёт отчислений при изменении доходов открытой ведомости. Раньше это делал фронтенд.';

DROP TRIGGER IF EXISTS recalc_allocations_income_trg ON finmodel.operations;
CREATE TRIGGER recalc_allocations_income_trg
  AFTER INSERT OR UPDATE OR DELETE ON finmodel.operations
  FOR EACH ROW EXECUTE FUNCTION finmodel.recalc_after_change();

-- Правила фондов: поменяли процент — суммы обязаны поехать сразу.
CREATE OR REPLACE FUNCTION finmodel.recalc_after_rule_change() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'finmodel' AS $function$
begin
  if pg_trigger_depth() > 1 then return null; end if;
  perform finmodel.recalc_allocations(
    coalesce(new.period_id, old.period_id));
  return null;
end;
$function$;

DROP TRIGGER IF EXISTS recalc_allocations_rules_trg ON finmodel.period_rules;
CREATE TRIGGER recalc_allocations_rules_trg
  AFTER INSERT OR UPDATE OR DELETE ON finmodel.period_rules
  FOR EACH ROW EXECUTE FUNCTION finmodel.recalc_after_rule_change();

-- Разовое лечение того, что уже разъехалось: пересчитать открытые ведомости.
SELECT finmodel.recalc_allocations(id) FROM finmodel.periods WHERE status = 'открыт';

-- Проверка после прогона:
--   select account_to_id, amount, status from finmodel.operations
--    where kind='перевод' and auto_generated order by amount desc;
--   ждём налоги 99 216,73 (8 % от дохода 1 240 209,18) вместо 58 896,73,
--   сумму переводов 897 700,41 вместо 857 380,41.
--   select чистая_прибыль from finmodel.pnl_totals(null,null);
--   ждём 2 678,77 — столько же, сколько в каскаде.
--
-- ЦЕНА. При массовой заливке истории платежей (этап 3, ЮKassa) пересчёт сработает
-- на каждый платёж. Для разовой заливки это секунды; если станет мешать — заливать
-- в транзакции с ALTER TABLE ... DISABLE TRIGGER и одним пересчётом в конце.
--
-- Откат: DROP TRIGGER recalc_allocations_income_trg ON finmodel.operations;
--        DROP TRIGGER recalc_allocations_rules_trg  ON finmodel.period_rules;
