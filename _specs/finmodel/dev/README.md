# Локальная ведомость для разработки

Схема `finmodel` живет только на бою: миграциями репозитория поднимается схема
`eastside`, а ведомость приехала из отдельного приложения. Поэтому локально экраны
раздела «Ведомость» показывать не на чем — ручки честно отвечают 503 «в этой базе нет
схемы finmodel».

Чтобы увидеть экраны глазами, схему берут с боя (ТОЛЬКО структуру и справочники), а
цифры выдумывают. Копировать боевые финансовые записи на машину разработчика не надо:
для проверки верстки хватает выдуманных, а расхождение с боем ловится не тут.

```bash
# 1. Структура схемы (без единой строки данных)
ssh selectel "docker exec supabase-db pg_dump -U postgres -d postgres \
  --schema=finmodel --schema-only --no-owner --no-privileges" > /tmp/finmodel_schema.sql

# 2. Справочники: счета, группы и статьи P&L, услуги, языки. Это настройки, а не деньги
ssh selectel "docker exec supabase-db pg_dump -U postgres -d postgres --data-only --no-owner \
  --table=finmodel.accounts --table=finmodel.pnl_groups --table=finmodel.pnl_items \
  --table=finmodel.pnl_item_rules --table=finmodel.offerings --table=finmodel.languages" \
  > /tmp/finmodel_dicts.sql

# 3. Заглушки того, чего нет в локальной базе: Supabase Auth
psql "$DATABASE_URL" -c "CREATE SCHEMA IF NOT EXISTS auth"
psql "$DATABASE_URL" -c "CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
                         LANGUAGE sql STABLE AS \$\$ select null::uuid \$\$"
psql "$DATABASE_URL" -c "CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text)"

# 4. Схема, справочники и выдуманный период
sed -i '/transaction_timeout/d' /tmp/finmodel_schema.sql /tmp/finmodel_dicts.sql
psql "$DATABASE_URL" -f /tmp/finmodel_schema.sql
psql "$DATABASE_URL" -f /tmp/finmodel_dicts.sql
psql "$DATABASE_URL" -f _specs/finmodel/dev/seed-fixture.sql
```

Дальше поднимаем бэкенд (`CORS_ALLOW_ALL=true`, если фронт открыт с другого порта) и
фронт с `window.EASTSIDE_API_BASE`, указывающим на него. Ключ CRM — сид миграции 010.

Суммы в `seed-fixture.sql` подобраны так, чтобы каскад считался «как на бою» по форме:
доход, фикс плюс процент в краткосрочку, проценты в фонды, расход С ФОНДА (он не трогает
расчетный счет) и одна плановая строка — она видна в карте операций, но в P&L не идет.
