# Эксплуатация

Практическое руководство: развернуть, обновить, настроить, починить.

> **Где выполнять команды.** Всё с `docker compose` — **на сервере**, в папке проекта
> (`ssh root@31.58.171.228`, затем `cd ~/support-desk-backend`). На вашем Маке эти же команды
> запустят локальную копию стека, а не боевую. Признак «не там»:
> `no configuration file provided: not found` — вы не в папке проекта.
> Команда пишется `docker compose` (через пробел).

## 1. Окружение

| Что | Значение |
|---|---|
| Сервер | HostVDS, Ubuntu 24.04, `31.58.171.228`, доступ `root` по SSH |
| Проект на сервере | `/root/support-desk-backend` |
| Frontend | `http://31.58.171.228:5173` |
| API | `http://31.58.171.228:8000` (Swagger: `/docs`) |
| Открытые порты (ufw) | 22, 8000, 5173. **Порт PostgreSQL 5432 опубликован Docker'ом на `0.0.0.0`, `ufw` он обходит** — см. [риски](architecture.md#безопасность-по-убыванию-важности) |

Переменные окружения:

| Файл | Переменная | Смысл |
|---|---|---|
| `.env` (рядом с `docker-compose.yml`) | `BOT_SERVICE_KEY` | Общий секрет backend ↔ bot-collector. **Обязателен** — без него бот не получит токен и не подключится к Telegram |
| `frontend/.env` | `VITE_API_URL` | Адрес API, вшивается в сборку. Пример: `VITE_API_URL=http://31.58.171.228:8000` |
| `docker-compose.yml` | `DATABASE_URL` | Строка подключения backend к PostgreSQL |

Токен бота, список агентов, ключи ИИ, часы работы и пр. — **не в `.env`**, а в таблице `settings`
(раздел «Настройки»).

## 2. Обновление версии на сервере

```bash
# на Маке
scp ~/Downloads/support-desk-backend.zip root@31.58.171.228:/root/

# на сервере
ssh root@31.58.171.228
cd ~ && unzip -o support-desk-backend.zip && cd support-desk-backend
# один раз, если ключа ещё нет (повторный запуск ничего не перезапишет):
grep -q BOT_SERVICE_KEY .env 2>/dev/null || echo "BOT_SERVICE_KEY=$(openssl rand -hex 24)" >> .env
docker compose up -d --build
docker compose ps
```

Правила:
1. **Если релиз меняет схему БД — сначала миграция, потом деплой** (см. [Миграции](#миграции)).
   Новый backend, читающий колонку, которой нет в базе, падает с 500 на каждом запросе к таблице.
2. Архив не содержит `.env` — `unzip -o` ваш файл не затирает.
3. После деплоя подождите 10–30 секунд: backend стартует не мгновенно, до этого
   интерфейс показывает «Failed to fetch».
4. `docker compose ps`: у `backend` статус должен быть `Up …` и **расти**, без `Restarting`.

## 3. Первый запуск

### Локально (разработка)
```bash
cp .env.example .env         # BOT_SERVICE_KEY задайте: openssl rand -hex 24
docker compose up --build
docker compose exec backend python -m app.seed        # тестовые данные (необязательно)
docker compose exec backend python -m app.create_admin you@example.com "Ваше Имя"
```
Backend — `http://localhost:8000` (`/docs`), интерфейс — `http://localhost:5173`.

### Первый пользователь
Все ручки API требуют входа, поэтому первого пользователя создаёт CLI, минуя API:
```bash
docker compose exec backend python -m app.create_admin you@example.com "Ваше Имя"
```
Пароль спросит интерактивно (не через аргумент — не остаётся в истории оболочки).
Дальше пользователей заводят в интерфейсе: «Настройки → Пользователи».
Готовой учётной записи «из коробки» нет намеренно.

## 4. Telegram-бот (bot-collector)

1. **Создать бота:** `@BotFather` → `/newbot`, сохранить токен.
2. **Privacy Mode** — самый частый прокол. По умолчанию бот видит в группах только команды и
   реплаи на него. Отключить: `@BotFather` → `/mybots` → бот → `Bot Settings` → `Group Privacy` →
   `Turn off`. Уже добавленного бота удалить из группы и добавить заново (или сделать администратором
   группы — это тоже обходит Privacy Mode).
3. **Токен и агенты** — в интерфейсе: «Настройки» → токен бота и список агентов (числовые
   Telegram id). Бот подхватит их сам за ≈20 секунд (`TOKEN_POLL_INTERVAL_SEC`), перезапуск не нужен.
   Чужой id проще всего найти в «Настройки → Известные участники переписки» (список тех, кто уже
   писал в чатах): кнопка «+ в агенты», затем сохранить.
4. **Зарегистрировать клиента** для каждой группы: «Клиенты → Добавить клиента» с числовым id
   группы (отрицательное число). Если группа неизвестна, бот получает 404 и пишет в лог
   `Группа … ещё не синхронизирована` — оттуда можно скопировать id. В штатном режиме клиентов
   заводит oracle-sync.
5. Проверка: написать в группе — тикет появится в «Пульсе поддержки».

Как бот получает настройки: раз в 20 секунд запрашивает `GET /ingest/bot-config` с заголовком
`X-Bot-Key`. При недоступности backend или неверном ключе он **остаётся подключённым** к Telegram
с текущими настройками и повторяет попытку. `401` в логе бота — `BOT_SERVICE_KEY` не совпадает у
backend и bot-collector или не задан (задать в `.env` и пересобрать).

Ограничения: обрабатываются текст и подписи к файлам; стикеры и файлы без подписи пропускаются
(строка в логе). Бот работает через long polling — публичный адрес не нужен.

### Если бот простоял
Telegram хранит неполученные обновления **до 24 часов**. После восстановления бота они придут
пачкой в исходном порядке. Всё, что старше суток, автоматически не вернуть; способ — выгрузка
истории чата из Telegram Desktop и импорт (скрипта пока нет).

## 5. Синхронизация клиентов из Oracle (oracle-sync)

Локальный агент (`oracle-sync/`, **вне** docker-compose, на машине с доступом к Oracle):
берёт SQL из `settings.oracle_sql` («Настройки → Синхронизация из Oracle»), выполняет и
отправляет результат в `POST /clients/sync`. Режимы: `--once` (для cron) и `--loop` (раз в минуту
проверяет флаг `oracle_sync_requested` — его ставит кнопка «Запустить синхронизацию»).

Колонки SQL понимаются в «сыром» виде: `ID_CONTRACT_INST`, `V_EXT_IDENT`, `V_LONG_TITLE` (имя,
обязательно), `VID_GROUP` (id группы, обязательно), `TARIFF_PLAN_NAME`, `V_SERVICE_STATUS`,
`SERVICE_DT_START`. Дубли по `tg_group_id` схлопываются. Подробности установки — `oracle-sync/README.md`.

> **Известная проблема.** После включения авторизации агент запрашивает `/settings` и
> `/clients/sync` без токена и получает **401** — синхронизация сейчас не работает.
> Требуется служебный доступ для агента. До исправления клиентов можно вести вручную
> («Клиенты → Добавить клиента») или через `POST /clients/sync` с токеном пользователя.

## 6. Бэкапы

Два слоя (подробно — `backup/README.md`):
- **Сервер:** `backup/backup.sh` — `pg_dump | gzip` в `backups/support_desk_ДАТА.sql.gz`,
  хранит последние 14. Cron: `0 3 * * * /root/support-desk-backend/backup/backup.sh >> /root/support-desk-backend/backup/backup.log 2>&1`.
- **Мак:** `backup/pull-backups.sh` забирает дампы в `~/support-desk-backups/`; нужен вход по SSH-ключу
  без пароля (`ssh-copy-id root@31.58.171.228`); автозапуск — `launchd` (`com.supportdesk.backuppull.plist`).

**Восстановление** — на пустую БД (для нового сервера: `docker compose up -d db`, дождаться `healthy`,
backend не поднимать):
```bash
gunzip -c support_desk_ДАТА.sql.gz | docker compose exec -T db psql -U support -d support_desk
```

## Миграции

Alembic нет. `create_all` создаёт только отсутствующие **таблицы** (так появились `users` и
`audit_log`) и не меняет существующие — колонки и ограничения добавляются вручную. Все команды
идемпотентны (`IF NOT EXISTS`), повторный запуск безопасен. Выполнять на сервере:

```bash
docker compose exec db psql -U support -d support_desk -c "<SQL>"
```

| Что | SQL | Нужна, если |
|---|---|---|
| Клиенты: VIP, тариф, биллинг | `ALTER TABLE clients ADD COLUMN IF NOT EXISTS vip BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS tariff_name VARCHAR, ADD COLUMN IF NOT EXISTS tariff_price VARCHAR, ADD COLUMN IF NOT EXISTS connected_at DATE, ADD COLUMN IF NOT EXISTS billing_contract_id VARCHAR, ADD COLUMN IF NOT EXISTS billing_contract_number VARCHAR, ADD COLUMN IF NOT EXISTS subscription_status VARCHAR;` | База создана до этих полей |
| Платная доработка | `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS is_paid_work BOOLEAN NOT NULL DEFAULT false, ADD COLUMN IF NOT EXISTS planned_cost VARCHAR, ADD COLUMN IF NOT EXISTS actual_hours DOUBLE PRECISION, ADD COLUMN IF NOT EXISTS actual_cost VARCHAR;` | То же |
| Telegram id отправителя | `ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_tg_id BIGINT;` | То же |
| Статус «Ожидание ответа клиента» | `ALTER TABLE tickets DROP CONSTRAINT IF EXISTS ck_tickets_status; ALTER TABLE tickets ADD CONSTRAINT ck_tickets_status CHECK (status IN ('open','waiting_client','pending_confirm','closed'));` | Без этого смена статуса на `waiting_client` падает, а вместе с ней — приём ответов агентов |
| Отметка «прочитано» | `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS agent_seen_at TIMESTAMPTZ;` | То же |
| Комментарий к обращению | `ALTER TABLE tickets ADD COLUMN IF NOT EXISTS comment TEXT;` | То же |
| Индексы | `CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_tickets_client_id ON tickets (client_id);` и аналогично для `tickets(status)`, `tickets(first_message_at)`, `messages(client_id)`, `messages(sent_at)`, `messages(ticket_id)` | Каждая команда — **отдельным** `-c`: `CONCURRENTLY` не работает внутри общей транзакции |

**Разовая починка данных** — тикеты, разделённые до исправления, у которых остались агентские
сообщения, но пуст `first_response_at`:
```sql
UPDATE tickets t SET first_response_at = sub.min_resp
FROM (SELECT ticket_id, MIN(sent_at) AS min_resp FROM messages WHERE sender_type = 'agent' GROUP BY ticket_id) sub
WHERE t.id = sub.ticket_id AND t.first_response_at IS NULL;
```

## 7. Вход через Google (не настроен)

Кнопка появляется на экране входа сама, когда в «Настройки → Вход через Google» вписан `google_client_id`.
Google **не разрешает** redirect на `http://` в продакшене, поэтому нужно:
1. Домен (любой, не обязательно `.ru`) с A-записью на `31.58.171.228`.
2. HTTPS для фронтенда **и** API (иначе браузер блокирует смешанное содержимое). Рекомендация —
   Caddy как обратный прокси с автоматическим сертификатом Let's Encrypt. Конфигурация пока не написана.
   После перехода на HTTPS поменять `VITE_API_URL` на https-адрес и пересобрать фронтенд.
3. В Google Cloud Console: экран согласия OAuth и OAuth-клиент типа «Web», в разрешённые
   источники JavaScript добавить адрес сайта. Client ID вписать в настройки (client secret не нужен).
4. Пользователь с таким же email должен быть заведён заранее — автоматического создания нет.

Вход по логину и паролю работает независимо от этого.

## 8. Диагностика

Сначала — логи: `docker compose logs backend --tail 60`, `docker compose logs bot-collector --tail 30`.
**Логи живут, пока жив контейнер:** `up -d --build` пересоздаёт контейнер и стирает его историю —
смотрите логи до пересборки, если нужна причина.

| Симптом | Вероятная причина | Что сделать |
|---|---|---|
| «Нет связи с backend … Failed to fetch» сразу после деплоя | Backend ещё стартует | Подождать 10–30 с, обновить страницу |
| То же, держится | Backend вернул **500** (ответ без CORS-заголовков выглядит для браузера как обрыв) или контейнер падает | `docker compose ps` (нет ли `Restarting`), `docker compose logs backend --tail 60`, искать трейсбек |
| В логе `UndefinedColumn` / `column … does not exist` | Не выполнена миграция колонки | Раздел [Миграции](#миграции), затем обновить страницу |
| В логе `violates check constraint "ck_tickets_status"` | Не обновлено ограничение статусов | Миграция статуса `waiting_client` |
| Backend падает при старте с `ImportError` / `ModuleNotFoundError` | Не установилась зависимость | Проверить `backend/requirements.txt`, пересобрать образ |
| Нет входа в интерфейс | Пользователя нет / неверный пароль | `docker compose exec backend python -m app.create_admin …` |
| Все запросы возвращают 401 | Токен истёк или недействителен | Выйти и войти заново |
| Бот молчит, тикеты не появляются | Бот не подключён / 401 / Privacy Mode | Лог бота: `Подключился к Telegram…`; `401` → `BOT_SERVICE_KEY`; проверить Privacy Mode; клиент должен быть заведён |
| В логе бота `Группа … ещё не синхронизирована` | Клиента с таким `tg_group_id` нет | Завести клиента с этим id |
| Ответы агента отображаются как «клиент» | Id сотрудника нет в списке агентов, или роль сообщения зафиксирована до добавления | Добавить id в «Настройки», затем «Синхронизировать историю» (для старых сообщений без id — «…и по имени») |
| Части одного длинного сообщения в неправильном порядке | Сортировка только по времени (устаревшая версия) | Обновить до версии с сортировкой по `tg_message_id` |
| В терминале «повис» ввод, в начале строки `>` | Не закрыта кавычка (часто из-за «умных» кавычек при копировании) | `Ctrl+C`, набрать команду заново |
| `no configuration file provided: not found` | Команда выполнена не в папке проекта | `cd ~/support-desk-backend` |

## 9. Полезные команды

```bash
docker compose ps                                   # состояние контейнеров
docker compose logs backend --tail 100              # логи backend
docker compose logs -f bot-collector                # логи бота в реальном времени
docker compose up -d --build                        # пересобрать и запустить
docker compose restart backend                      # перезапуск без пересборки
docker compose exec db psql -U support -d support_desk          # консоль БД
docker compose exec backend python -m app.create_admin EMAIL "Имя"   # пользователь
docker compose exec backend python -m app.seed      # тестовые данные (только локально!)
curl -s http://localhost:8000/health                # проверка живости
```

Запрос к защищённому API из терминала — нужен токен:
```bash
TOKEN=$(curl -s -X POST http://localhost:8000/auth/login -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"..."}' | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
curl -s http://localhost:8000/tickets -H "Authorization: Bearer $TOKEN"
```
