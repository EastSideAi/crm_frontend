-- Ведомость: план выручки. Раздел «План выручки» + «Платежный календарь» (perenos.md §1.3,
-- §1.7). На старом сайте эти данные жили внутри html и стирались при перезагрузке — в базе
-- их не было никогда. Заводим таблицу, чтобы план пережил перезагрузку и лег в общий контур.
--
-- Одна таблица на обе таблицы старого экрана: «новые продажи» и «дебиторка» — это ожидаемые
-- поступления, отличаются видом (kind) и парой полей. Платежный календарь читает отсюда
-- ожидаемый приход, а плановый расход берет из operations (план) и obligations — своей
-- таблицы ему не нужно.
--
-- План выручки НЕ участвует в каскаде и отчислениях: это прогноз, а не факт. Факт дохода
-- по-прежнему считается по operations (kind='доход'). Экран сравнивает план с фактом.

CREATE TABLE IF NOT EXISTS finmodel.revenue_plan (
    id          uuid DEFAULT gen_random_uuid() NOT NULL,
    period_id   uuid NOT NULL,
    kind        text NOT NULL,                       -- 'продажа' (новая продажа) | 'дебиторка'
    client      text DEFAULT ''::text NOT NULL,      -- клиент/источник
    item        text DEFAULT ''::text NOT NULL,      -- продукт/направление (продажа) или основание (дебиторка)
    offering_id text,                                -- программа, если известна (для разреза по программам)
    amount      numeric(14,2) NOT NULL,
    status      text DEFAULT 'ожидается'::text NOT NULL,  -- 'ожидается' | 'получено' | 'отменено'
    due_on      date,                                -- срок ожидаемого поступления (для платежного календаря)
    comment     text DEFAULT ''::text NOT NULL,
    created_at  timestamp with time zone DEFAULT now() NOT NULL,
    updated_at  timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT revenue_plan_pkey PRIMARY KEY (id),
    CONSTRAINT revenue_plan_kind_check CHECK ((kind = ANY (ARRAY['продажа'::text, 'дебиторка'::text]))),
    CONSTRAINT revenue_plan_status_check CHECK ((status = ANY (ARRAY['ожидается'::text, 'получено'::text, 'отменено'::text]))),
    CONSTRAINT revenue_plan_amount_check CHECK ((amount >= (0)::numeric)),
    CONSTRAINT revenue_plan_period_id_fkey FOREIGN KEY (period_id)
        REFERENCES finmodel.periods(id) ON DELETE CASCADE,
    CONSTRAINT revenue_plan_offering_id_fkey FOREIGN KEY (offering_id)
        REFERENCES finmodel.offerings(id)
);

COMMENT ON TABLE finmodel.revenue_plan IS 'План выручки: ожидаемые новые продажи и дебиторка. Прогноз, в каскад и отчисления не входит.';

CREATE INDEX IF NOT EXISTS revenue_plan_period_idx ON finmodel.revenue_plan (period_id);

-- Секретность как у остальной ведомости: RLS включен, читают только роли finmodel, правит
-- финансист. CRM ходит служебным подключением и RLS обходит (как и к operations) — права
-- режет cap на стороне CRM. Без RLS таблицу читал бы любой аккаунт общего Supabase.
ALTER TABLE finmodel.revenue_plan ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "revenue_plan: чтение по роли" ON finmodel.revenue_plan;
CREATE POLICY "revenue_plan: чтение по роли" ON finmodel.revenue_plan
    FOR SELECT USING ((finmodel.my_role() IS NOT NULL));

DROP POLICY IF EXISTS "revenue_plan: заводит финансист" ON finmodel.revenue_plan;
CREATE POLICY "revenue_plan: заводит финансист" ON finmodel.revenue_plan
    FOR INSERT WITH CHECK ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));

DROP POLICY IF EXISTS "revenue_plan: правит финансист" ON finmodel.revenue_plan;
CREATE POLICY "revenue_plan: правит финансист" ON finmodel.revenue_plan
    FOR UPDATE USING ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])))
    WITH CHECK ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));

DROP POLICY IF EXISTS "revenue_plan: удаляет финансист" ON finmodel.revenue_plan;
CREATE POLICY "revenue_plan: удаляет финансист" ON finmodel.revenue_plan
    FOR DELETE USING ((finmodel.my_role() = ANY (ARRAY['Админ'::text, 'Финансист'::text])));
