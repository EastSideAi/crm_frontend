-- Финмодель: закрыть чтение и запись через представления.
--
-- Проблема (проверено на боевой базе 2026-08-11, только чтением):
-- таблицы схемы finmodel закрыты политиками RLS по ролям, и новый профиль
-- создается неактивным — это сделано верно. Но семь представлений принадлежат
-- суперпользователю postgres и созданы без security_invoker, поэтому RLS базовых
-- таблиц на них НЕ распространяется: представление читает данные правами владельца.
-- При этом роли `authenticated` выданы права arwd на все семь. Значит любой, кто
-- залогинен в общем Supabase (на момент проверки 174 аккаунта, из них 105 — из
-- соседней системы), читает через них все операции, P&L и остатки фондов, даже если
-- его профиль в финмодели неактивен.
--
-- Отдельно: v_period_summary автообновляемое (is_updatable=YES), а права на запись
-- у `authenticated` есть — то есть через него можно и писать мимо политик.
--
-- Лечение: включить у представлений проверку прав вызывающего (PG 15+, у нас 17.6)
-- и оставить `authenticated` только чтение. Ролевые политики таблиц после этого
-- начинают работать и для представлений.
--
-- Третьим шагом — политика чтения операций. Она единственная в схеме режет строки
-- по разделу человека (`source = ANY (my_sources())`), а my_sources() используется
-- и для чтения, и для правки. Пока представления шли мимо RLS, это не мешало:
-- руководитель направления видел ведомость целиком. С security_invoker он вдруг
-- увидел бы в P&L только свои операции, а сводка периода показала бы ему доход 0 и
-- дивиденды минус 298 488 — проверено прогоном в откаченной транзакции. Правило
-- владельца от 2026-08-11 прямо обратное: «видеть могут всю ведомость, править —
-- только свои разделы». Поэтому чтение операций приводим к тому же виду, что у всех
-- остальных таблиц схемы (`my_role() IS NOT NULL`), а политики INSERT/UPDATE/DELETE
-- не трогаем — они и дальше держат правку по разделам.
--
-- Откат (если что-то сломается): ALTER VIEW ... SET (security_invoker = off);
-- GRANT INSERT, UPDATE, DELETE обратно; прежняя политика чтения — в конце файла.
-- Данные скрипт не трогает.

ALTER VIEW finmodel.v_data_bounds         SET (security_invoker = on);
ALTER VIEW finmodel.v_operations_map      SET (security_invoker = on);
ALTER VIEW finmodel.v_fund_reconciliation SET (security_invoker = on);
ALTER VIEW finmodel.v_fund_balances       SET (security_invoker = on);
ALTER VIEW finmodel.v_pnl                 SET (security_invoker = on);
ALTER VIEW finmodel.v_income_duplicates   SET (security_invoker = on);
ALTER VIEW finmodel.v_period_summary      SET (security_invoker = on);

-- Права на запись забираем ТОЛЬКО у представлений. У таблиц они нужны: запись из
-- приложения идет ролью authenticated, а отсекают ее политики RLS, а не грант.
REVOKE INSERT, UPDATE, DELETE ON
  finmodel.v_data_bounds, finmodel.v_operations_map, finmodel.v_fund_reconciliation,
  finmodel.v_fund_balances, finmodel.v_pnl, finmodel.v_income_duplicates,
  finmodel.v_period_summary
FROM authenticated;

-- Смотреть ведомость может каждый, кто в ней активен; правку по-прежнему режут
-- политики INSERT/UPDATE/DELETE по разделам (они остаются на my_sources()).
DROP POLICY "operations: чтение по роли" ON finmodel.operations;
CREATE POLICY "operations: чтение по роли" ON finmodel.operations
  FOR SELECT USING (finmodel.my_role() IS NOT NULL);

-- Проверка после прогона: у всех семи должно стоять security_invoker=on,
-- а в правах `authenticated` остаться только r (SELECT).
--   select c.relname, c.reloptions, array_to_string(c.relacl, ' | ')
--     from pg_class c join pg_namespace n on n.oid = c.relnamespace
--    where n.nspname = 'finmodel' and c.relkind = 'v';
--
-- ПРОГНАН на боевой базе 2026-08-11 с разрешения владельца («убери риски»).
-- Перед прогоном то же самое прокручено в транзакции с откатом, результат:
--   чужой аккаунт (неактивный профиль)  — 0 строк во всех представлениях (было: все)
--   Админ и Финансист                   — 85 операций, 8 строк P&L, сводка целиком
--   Продажи (руководитель направления)   — та же полная картина на чтение,
--                                          правка чужого раздела UPDATE 0,
--                                          своего UPDATE 5,
--                                          запись через представление — permission denied
--
-- Прежняя политика чтения (для отката):
--   CREATE POLICY "operations: чтение по роли" ON finmodel.operations
--     FOR SELECT USING (source = ANY (finmodel.my_sources()));
