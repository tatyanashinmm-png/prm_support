# REST API

Базовый адрес — `http://<сервер>:8000`. Интерактивная документация (Swagger) — `/docs`.

**Доступ:**
- **JWT** — заголовок `Authorization: Bearer <токен>`, токен выдаёт `POST /auth/login` или `/auth/google`.
- **ключ бота** — заголовок `X-Bot-Key: <BOT_SERVICE_KEY>`.
- **открыт** — без авторизации.

Ошибки приходят как `{"detail": "..."}` с кодом 4xx/5xx. Ответ **500** уходит без CORS-заголовков,
поэтому браузер показывает его как «Failed to fetch» — при такой ошибке смотрите логи backend.

## Авторизация и пользователи

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /auth/config` | открыт | `{google_client_id}` — нужен экрану входа |
| `POST /auth/login` | открыт | `{email, password}` → `{access_token, user}` |
| `POST /auth/google` | открыт | `{id_token}` → `{access_token, user}`. Пользователь должен быть заведён заранее |
| `GET /auth/me` | JWT | Текущий пользователь |
| `POST /auth/change-password` | JWT | `{current_password, new_password}`; для аккаунтов без пароля `current_password` не нужен |
| `GET /users` | JWT | Список пользователей |
| `POST /users` | JWT | `{email, name, password}` (пароль ≥ 8 символов) |
| `PATCH /users/{id}/deactivate` · `/activate` | JWT | Блокировка/разблокировка (себя деактивировать нельзя) |
| `POST /users/{id}/reset-password` | JWT | `{new_password}` — сброс пароля другому пользователю |
| `GET /audit-log` | JWT | Журнал действий. Параметры: `limit` (≤500), `offset`, `user_email`, `action` |
| `GET /audit-log/actions` | JWT | Список встречающихся типов действий |

## Обращения

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /tickets` | JWT | Список. Параметры: `days` (по умолчанию 30) **или** `date_from`+`date_to`; `view` = `open` · `sla_breach` · `waiting_client` · `closed` · `no_jira`; `attention_after_min` (45); `has_new_messages` (bool) |
| `POST /tickets` | JWT | Создать вручную: `client_id`, `category`, `subject`, опц. `status`, `comment`, `promise_text`, `jira_url`, `due_date`, `is_paid_work`, `planned_cost` |
| `GET /tickets/{id}` | JWT | Один тикет |
| `PATCH /tickets/{id}` | JWT | Частичное обновление: `status`, `category`, `subject`, `comment`, `promise_text`, `jira_url`, `due_date`, `is_paid_work`, `planned_cost`, `actual_hours`, `actual_cost`. При `status=closed` проставляется `closed_at` |
| `DELETE /tickets/{id}` | JWT | Удалить; сообщения отвязываются (`ticket_id → NULL`) |
| `GET /tickets/{id}/messages` | JWT | Переписка: `sent_at`, `tg_message_id`, `id` |
| `POST /tickets/{id}/mark-seen` | JWT | Отметить «прочитано» (гасит чип «N новых», статус/SLA не меняет) |
| `POST /tickets/{id}/split` | JWT | `{message_ids, category?, subject?, mode: "move"\|"copy"}` → новый тикет |
| `POST /tickets/merge` | JWT | `{keep_ticket_id, merge_ticket_id}` — переписка переезжает в первый, второй удаляется |
| `POST /tickets/run-autoclose-check` | JWT | Устарел: запускает отключённую задачу автозакрытия |

**Поля тикета в ответах** (кроме хранимых): `wait_business_min` (рабочие минуты по правилам
[SLA](architecture.md#33-sla)), `response_kind` (`no_response` · `waiting_us` · `waiting_client` · `closed`),
`new_message_count` (для чипа «N новых»).

## Клиенты

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /clients` | JWT | Список с агрегатами за период (`days` или `date_from`/`date_to`) |
| `POST /clients` | JWT | Создать вручную (`name`, `tg_group_id`, опц. `chat_label`, `vip`, тариф и др.) |
| `GET /clients/{id}` | JWT | Карточка с метриками за период (по умолчанию 30 дней) |
| `PATCH /clients/{id}` | JWT | `vip`, `chat_label`, `name`, `tariff_name`, `subscription_status` |
| `DELETE /clients/{id}` | JWT | Удаляет клиента **вместе с тикетами и сообщениями** |
| `GET /clients/{id}/tickets` | JWT | История обращений; параметры периода и `status` |
| `GET /clients/{id}/category-stats` | JWT | Темы и среднее число обращений в месяц |
| `GET /clients/{id}/telegram-info` | JWT | Название чата через Telegram Bot API `getChat` (нужен `bot_collector_token`) |
| `POST /clients/sync` | JWT | `{clients: [...]}` — upsert по `tg_group_id`; ставит `oracle_last_sync`, сбрасывает `oracle_sync_requested` |

## Метрики, обещания, категории, сводка

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /metrics/active-chats` | JWT | Число активных чатов за период (`days` или `date_from`/`date_to`) |
| `GET /metrics/period-comparison` | JWT | Сравнение периода с предыдущим такой же длины: итоги, клиенты и категории с дельтами |
| `GET /promises` | JWT | Обещания (тикеты со сроком). Фильтры: `bucket` = `overdue` · `today` · `week` · `done`, `status` |
| `PATCH /promises/{ticket_id}` | JWT | «Выполнено»: очищает `promise_text` и `due_date` (тикет не закрывается) |
| `GET /categories` | JWT | Категории: используемые в тикетах + стандартные (Биллинг, Баг, Настройка, Вопрос по функционалу, Интеграция, Доработка) |
| `PATCH /categories/rename` | JWT | `{old_name, new_name}` — массово переименовывает во всех тикетах |
| `GET /digest/today` | JWT | Сводка и метрики дня. Параметр `date=YYYY-MM-DD` — за любой день. «Закрыто» считается по дате закрытия |
| `POST /digest/regenerate` | JWT | Пересобрать сводку через ИИ; параметр `date` |
| `POST /digest/send` | JWT | Заглушка: помечает сегодняшнюю сводку отправленной |

## Настройки

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /settings` | JWT | Все настройки с значениями по умолчанию. **Внимание:** возвращает в том числе `jwt_secret` и секреты — см. [риски](architecture.md#безопасность-по-убыванию-важности) |
| `PATCH /settings` | JWT | Частичное обновление; любые ключи |
| `POST /settings/test-key` | JWT | Заглушка проверки ключа ИИ |

## Приём сообщений и участники

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `POST /ingest/message` | **открыт** | Вызывает бот: `tg_group_id`, `tg_message_id`, `sender_type`, `sender_name?`, `sender_tg_id?`, `text`, `sent_at`, `reply_to_tg_message_id?` → `{ticket_id, ticket_code}`. Клиент с таким `tg_group_id` должен существовать (иначе 404) |
| `GET /ingest/bot-config` | ключ бота | `{bot_collector_token, agent_tg_ids}` для bot-collector |
| `GET /ingest/senders` | JWT | Все, кто писал, с числовым Telegram id, числом сообщений и признаком «уже агент» |
| `POST /ingest/senders/{tg_id}/recompute-role` | JWT | Привести роль всех сообщений этого id к его текущему статусу в `agent_tg_ids` (в обе стороны) и пересчитать `first_response_at` затронутых тикетов |
| `POST /ingest/senders/fix-by-name` | JWT | То же по точному имени: `{sender_name, target_type}` — для сообщений без `sender_tg_id` |

## Служебное

| Метод и путь | Доступ | Назначение |
|---|---|---|
| `GET /health` | открыт | `{"status": "ok"}` |

## Что записывается в журнал действий

`auth.login`, `auth.login_google`, `auth.password_changed`, `user.created`, `user.deactivated`,
`user.activated`, `user.password_reset_by_admin`, `ticket.created`, `ticket.updated`, `ticket.deleted`,
`ticket.merged`, `ticket.split`, `client.created`, `client.updated`, `client.deleted`, `settings.updated`,
`category.renamed`, `sender.role_recomputed`, `sender.role_fixed_by_name`.
