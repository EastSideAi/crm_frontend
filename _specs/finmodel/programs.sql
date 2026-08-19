-- Ведомость: разрез по программам. Экран «Программы» в Финансах отвечает на вопрос
-- «выгодна ли программа»: сколько на неё пришло и сколько на неё потратили.
--
-- Доход по программе тянется САМ из фискальных чеков ЮKassa: в позиции чека
-- (item.description) программа названа явно («Летняя программа в Харбине/Шанхае/
-- Шэньчжэне»), тогда как в описании самого платежа она часто пустая (счёт выставлен
-- из панели ЮKassa). Классификатор ищет `match_key` в тексте позиции. Расход правится
-- руками (берётся из детального P&L программы, который живёт вне ведомости).
--
-- Отдельная от operations таблица, и это принципиально: программа идёт СКВОЗЬ несколько
-- периодов ведомости (лето — не две недели), а её P&L уже считает свои налоги, эквайринг
-- и отчисления в фонды. Заведи доход программы ещё и в каскад ведомости — отчисления и
-- налоги задвоятся поверх того, что уже учтено в P&L. Поэтому «Программы» — самостоятельный
-- разрез, а не строки operations, и в каскад/отчисления НЕ входит.

CREATE TABLE IF NOT EXISTS finmodel.programs (
    id           uuid DEFAULT gen_random_uuid() NOT NULL,
    name         text NOT NULL,                          -- «Харбин лето 2026»
    match_key    text DEFAULT ''::text NOT NULL,         -- ключ поиска в позиции чека ЮKassa (нижний регистр)
    status       text DEFAULT 'идет'::text NOT NULL,     -- 'идет' | 'завершена'
    season_start date,                                   -- с какой даты считать доход из чеков
    expense      numeric(14,2) DEFAULT 0 NOT NULL,       -- полный расход программы (из P&L), правится в CRM
    comment      text DEFAULT ''::text NOT NULL,         -- откуда цифра расхода
    sort         integer DEFAULT 0 NOT NULL,
    created_at   timestamp with time zone DEFAULT now() NOT NULL,
    updated_at   timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT programs_pkey PRIMARY KEY (id),
    CONSTRAINT programs_name_key UNIQUE (name),
    CONSTRAINT programs_status_check CHECK ((status = ANY (ARRAY['идет'::text, 'завершена'::text]))),
    CONSTRAINT programs_expense_check CHECK ((expense >= (0)::numeric))
);

COMMENT ON TABLE finmodel.programs IS 'Программы сезона для разреза «выгодность»: доход из чеков ЮKassa, расход из P&L. Сквозь периоды, в каскад не входит.';

-- Секретность как у остальной ведомости: RLS включён, читают роли finmodel, правит
-- финансист. CRM ходит служебным подключением и RLS обходит — права режет cap на стороне CRM.
ALTER TABLE finmodel.programs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "programs: чтение по роли" ON finmodel.programs;
CREATE POLICY "programs: чтение по роли" ON finmodel.programs
    FOR SELECT USING ((finmodel.my_role() IS NOT NULL));

DROP POLICY IF EXISTS "programs: заводит финансист" ON finmodel.programs;
CREATE POLICY "programs: заводит финансист" ON finmodel.programs
    FOR INSERT WITH CHECK ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));

DROP POLICY IF EXISTS "programs: правит финансист" ON finmodel.programs;
CREATE POLICY "programs: правит финансист" ON finmodel.programs
    FOR UPDATE USING ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])))
    WITH CHECK ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));

DROP POLICY IF EXISTS "programs: удаляет финансист" ON finmodel.programs;
CREATE POLICY "programs: удаляет финансист" ON finmodel.programs
    FOR DELETE USING ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));

-- Программы сезона лето-2026 (расход из P&L, дальше правится в CRM). Идемпотентно.
INSERT INTO finmodel.programs (name, match_key, status, season_start, expense, sort, comment) VALUES
    ('Харбин лето 2026', 'харбин', 'завершена', '2026-03-01', 876099, 1, 'расход с налогами и резервами, из итогового P&L'),
    ('Шанхай лето 2026', 'шанха', 'идет', '2026-03-01', 978837, 2, 'расход с налогами, из P&L (факт плюс прогноз)'),
    ('Шэньчжэнь 2026', 'ньчж', 'идет', '2026-03-01', 757992, 3, 'прямые траты по сводке 19.08, программа не закрыта')
ON CONFLICT (name) DO NOTHING;
