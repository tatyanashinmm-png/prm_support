"""
Oracle-синк — локальный агент, который живёт на машине с доступом к Oracle
БД (backend этого доступа не имеет и иметь не должен — Oracle недоступна
снаружи вашей сети).

Что делает:
1. Забирает SQL-запрос из /settings backend'а (поле oracle_sql — то же
   самое, что редактируется в UI, на «Настройки» → «Синхронизация из
   Oracle»), а не хранит его в себе — один источник правды.
2. Выполняет этот SELECT к Oracle.
3. Схлопывает дубли (см. COLUMN_ALIASES / дедупликация ниже — реальные
   запросы через JOIN нередко отдают одну и ту же подписку несколько раз).
4. Отправляет результат в POST /clients/sync.

Понимает как «сырые» имена колонок из реального биллингового запроса,
так и заранее сокращённые алиасы — можно использовать любой вариант SQL:

  Колонка в Oracle        Поле в нашей системе
  ID_CONTRACT_INST    ->  billing_contract_id   (id подписки в биллинге)
  V_EXT_IDENT         ->  billing_contract_number (номер подписки)
  V_LONG_TITLE        ->  name                  (наименование клиента)
  VID_GROUP           ->  tg_group_id           (id группы в Telegram)
  TARIFF_PLAN_NAME    ->  tariff_name           (наименование тарифа)
  V_SERVICE_STATUS    ->  subscription_status   (статус подписки)
  SERVICE_DT_START    ->  connected_at          (дата подключения)

Режимы запуска:
  python sync.py --once     — выполнить синк один раз и выйти (для cron)
  python sync.py --loop     — крутиться в фоне, проверять раз в
                               POLL_INTERVAL_SEC секунд, не запросили ли
                               синк кнопкой «Запустить синхронизацию» в
                               дашборде (поле oracle_sync_requested)
"""
from __future__ import annotations

import argparse
import sys
import time
from datetime import date, datetime

import httpx
import oracledb
from dotenv import load_dotenv
import os

load_dotenv()

BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000").rstrip("/")
ORACLE_DSN = os.getenv("ORACLE_DSN", "")  # готовая строка подключения (TNS-descriptor) — в приоритете, если задана
ORACLE_HOST = os.getenv("ORACLE_HOST", "")
ORACLE_PORT = os.getenv("ORACLE_PORT", "1521")
ORACLE_SERVICE = os.getenv("ORACLE_SERVICE", "")
ORACLE_USER = os.getenv("ORACLE_USER", "")
ORACLE_PASSWORD = os.getenv("ORACLE_PASSWORD", "")
POLL_INTERVAL_SEC = int(os.getenv("POLL_INTERVAL_SEC", "60"))

# Сопоставление колонок: и «сырые» имена из реального биллингового запроса,
# и заранее сокращённые алиасы — какой вариант SQL ни напишите, отработает.
COLUMN_ALIASES = {
    # короткие алиасы (если написать SQL с "as name" и т.п.)
    "name": "name",
    "tg_group_id": "tg_group_id",
    "chat_label": "chat_label",
    "tariff_name": "tariff_name",
    "tariff_price": "tariff_price",
    "connected_at": "connected_at",
    "billing_contract_id": "billing_contract_id",
    "billing_contract_number": "billing_contract_number",
    "subscription_status": "subscription_status",
    # реальные имена колонок биллингового запроса, как есть
    "v_long_title": "name",
    "vid_group": "tg_group_id",
    "tariff_plan_name": "tariff_name",
    "service_dt_start": "connected_at",
    "id_contract_inst": "billing_contract_id",
    "v_ext_ident": "billing_contract_number",
    "v_service_status": "subscription_status",
}

REQUIRED_FIELDS = {"name", "tg_group_id"}
STRING_FIELDS = {"name", "chat_label", "tariff_name", "tariff_price", "billing_contract_id", "billing_contract_number", "subscription_status"}


def log(msg: str):
    print(f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def get_oracle_sql() -> str:
    resp = httpx.get(f"{BACKEND_URL}/settings", timeout=15)
    resp.raise_for_status()
    sql = resp.json().get("oracle_sql", "").strip()
    if not sql:
        raise RuntimeError("oracle_sql пуст в /settings — нечего выполнять")
    return sql


def _normalize_row(record: dict) -> dict | None:
    """Приводит сырую строку из Oracle (любые из известных имён колонок,
    в любом регистре) к нашему внутреннему набору полей."""
    item = {}
    for raw_key, value in record.items():
        key = COLUMN_ALIASES.get(raw_key.lower())
        if key is None or value is None:
            continue
        item[key] = value

    if not REQUIRED_FIELDS.issubset(item.keys()):
        return None

    item["tg_group_id"] = int(item["tg_group_id"])
    item["name"] = str(item["name"]).strip()

    if "connected_at" in item:
        v = item["connected_at"]
        if isinstance(v, (datetime, date)):
            item["connected_at"] = v.strftime("%Y-%m-%d")
        else:
            # формат вида "2024-03-11 00:00:00.0 Europe/Moscow" — дата в первых 10 символах
            item["connected_at"] = str(v)[:10]

    for key in STRING_FIELDS:
        if key in item and item[key] is not None:
            item[key] = str(item[key]).strip()

    return item


def fetch_from_oracle(sql: str) -> list:
    dsn = ORACLE_DSN if ORACLE_DSN else oracledb.makedsn(ORACLE_HOST, int(ORACLE_PORT), service_name=ORACLE_SERVICE)
    with oracledb.connect(user=ORACLE_USER, password=ORACLE_PASSWORD, dsn=dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
            columns = [c[0].lower() for c in cur.description]
            rows = cur.fetchall()

    by_group: dict = {}
    skipped = 0
    duplicates = 0

    for row in rows:
        record = dict(zip(columns, row))
        item = _normalize_row(record)
        if item is None:
            skipped += 1
            continue

        gid = item["tg_group_id"]
        if gid in by_group:
            duplicates += 1
            continue  # реальный запрос часто отдаёт одну подписку несколько раз (JOIN) — берём первую
        by_group[gid] = item

    if skipped:
        log(f"пропущено строк без обязательных полей (name, tg_group_id): {skipped}")
    if duplicates:
        log(f"схлопнуто дублей (повторных строк на ту же группу): {duplicates}")

    return list(by_group.values())


def push_to_backend(clients: list) -> dict:
    resp = httpx.post(f"{BACKEND_URL}/clients/sync", json={"clients": clients}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def run_once():
    log("старт синхронизации")
    sql = get_oracle_sql()
    clients = fetch_from_oracle(sql)
    log(f"уникальных клиентов после дедупликации: {len(clients)}")

    if not clients:
        log("нечего отправлять — синк пропущен")
        return

    result = push_to_backend(clients)
    log(f"готово: создано {result.get('created', 0)}, обновлено {result.get('updated', 0)}")


def sync_requested() -> bool:
    resp = httpx.get(f"{BACKEND_URL}/settings", timeout=15)
    resp.raise_for_status()
    return bool(resp.json().get("oracle_sync_requested"))


def main():
    parser = argparse.ArgumentParser(description="Oracle → Support Desk синк клиентов")
    parser.add_argument("--once", action="store_true", help="выполнить один раз и выйти (для cron)")
    parser.add_argument("--loop", action="store_true", help="крутиться в фоне и ждать запроса из дашборда")
    args = parser.parse_args()

    if not ((ORACLE_DSN or (ORACLE_HOST and ORACLE_SERVICE)) and ORACLE_USER and ORACLE_PASSWORD):
        log("не заданы параметры подключения к Oracle — заполните .env (ORACLE_DSN, либо ORACLE_HOST+ORACLE_SERVICE, плюс ORACLE_USER/ORACLE_PASSWORD)")
        sys.exit(1)

    if args.once:
        run_once()
        return

    if args.loop:
        log(f"запущен в режиме ожидания, проверка каждые {POLL_INTERVAL_SEC}с")
        while True:
            try:
                if sync_requested():
                    log("получен запрос на синхронизацию из дашборда")
                    run_once()
            except Exception as e:  # сеть моргнула, Oracle недоступна и т.п. — не падаем, пробуем на следующем цикле
                log(f"ошибка: {e}")
            time.sleep(POLL_INTERVAL_SEC)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
