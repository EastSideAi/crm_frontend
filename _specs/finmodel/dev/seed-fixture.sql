-- ВЫДУМАННЫЕ данные для локальной проверки экранов ведомости.
-- Ни одна сумма не взята с боевой базы: это дев-фикстура, а не копия прода.
DO $$
DECLARE p uuid := '11111111-2222-3333-4444-555555555555';
BEGIN
  INSERT INTO finmodel.periods (id, name, starts_on, ends_on, status)
  VALUES (p, '21.05.2026 — 10.06.2026', '2026-05-21', '2026-06-10', 'открыт')
  ON CONFLICT (id) DO NOTHING;

  PERFORM finmodel.seed_rules(p);
  UPDATE finmodel.period_rules SET mode='сумма+процент', fixed_amount=500000, percent=20,
         base='продажи вручную', manual_base=20000 WHERE period_id=p AND account_id='shortterm';
  UPDATE finmodel.period_rules SET base='доход' WHERE period_id=p AND account_id='taxes';

  INSERT INTO finmodel.period_accounts (period_id, account_id, opening)
  VALUES (p,'safety',40000),(p,'contractors',43500),(p,'marketing',12000)
  ON CONFLICT (period_id, account_id) DO NOTHING;

  -- Доходы: платежи с эквайринга
  INSERT INTO finmodel.operations (period_id, op_date, kind, status, account_id, source, counterparty, amount)
  VALUES
    (p,'2026-05-22','доход','факт','vtb','доходы','ЮKassa / платеж', 159360),
    (p,'2026-05-27','доход','факт','vtb','доходы','ЮKassa / платеж', 240000),
    (p,'2026-06-01','доход','факт','vtb','доходы','ЮKassa / платеж',  77775),
    (p,'2026-06-04','доход','факт','vtb','доходы','Перевод на счет',  460000),
    (p,'2026-06-08','доход','факт','vtb','доходы','ЮKassa / платеж', 303074);

  -- Отложения в фонды: перевод с расчетного счета
  INSERT INTO finmodel.operations (period_id, op_date, kind, status, account_id, account_to_id, source, counterparty, amount)
  VALUES
    (p,'2026-06-09','перевод','факт','vtb','shortterm','фонд','Отложение в фонд краткосрочки', 504000),
    (p,'2026-06-09','перевод','факт','vtb','contractors','фонд','Отложение в фонд подрядчиков', 147242),
    (p,'2026-06-09','перевод','факт','vtb','marketing','фонд','Отложение в фонд маркетинга', 147242),
    (p,'2026-06-09','перевод','факт','vtb','taxes','фонд','Отложение в фонд налогов', 99217);

  -- Прямые расходы по разделам
  INSERT INTO finmodel.operations (period_id, op_date, kind, status, account_id, source, counterparty, amount)
  VALUES
    (p,'2026-05-25','расход','факт','vtb','продажи','Менеджер продаж, аванс', 35000),
    (p,'2026-06-05','расход','факт','vtb','продажи','Менеджер продаж, остаток', 35710),
    (p,'2026-05-30','расход','факт','vtb','продукт','Куратор направления', 75000),
    (p,'2026-05-26','расход','факт','vtb','администрирование','Ассистент, первая половина', 60750),
    (p,'2026-06-06','расход','факт','vtb','администрирование','Ассистент, вторая половина', 60750),
    (p,'2026-06-02','расход','факт','vtb','управление','Управление', 65000),
    (p,'2026-05-24','расход','факт','vtb','сервисы','Хостинг и домены', 3200),
    (p,'2026-05-28','расход','факт','vtb','сервисы','Телефония', 2740),
    (p,'2026-06-03','расход','факт','vtb','сервисы','РКО банка', 1680);

  -- Расход С ФОНДА: маркетинг платит из своего фонда, расчетный счет не трогает
  INSERT INTO finmodel.operations (period_id, op_date, kind, status, account_id, source, counterparty, amount)
  VALUES (p,'2026-06-07','расход','факт','marketing','маркетинг','Реклама, закуп', 62000);

  -- План — в P&L не попадает, но в карте операций виден
  INSERT INTO finmodel.operations (period_id, op_date, kind, status, account_id, source, counterparty, amount)
  VALUES (p,'2026-06-10','расход','план','vtb','сервисы','Подписка на дизайн-сервис', 4900);

  INSERT INTO finmodel.services (name, amount, periodicity, account_id, counterparty, active, next_payment_on)
  VALUES ('Хостинг и домены', 3200, 'месяц','vtb','Хостер', true, '2026-06-24'),
         ('Телефония', 2740, 'месяц','vtb','Оператор связи', true, '2026-06-28'),
         ('РКО банка', 1680, 'месяц','vtb','ВТБ', true, '2026-06-25')
  ON CONFLICT DO NOTHING;

  INSERT INTO finmodel.obligations (kind, title, counterparty, principal, paid, payment, status, opened_on)
  VALUES ('кредит','Кредит на оборудование','Банк', 480000, 180000, 40000, 'открыт','2026-02-10'),
         ('долг','Заем от учредителя','Учредитель', 300000, 300000, 0, 'погашен','2025-11-01')
  ON CONFLICT DO NOTHING;
END $$;
