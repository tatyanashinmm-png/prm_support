"""
Учёт рабочих часов/выходных/праздников при расчёте времени ожидания (SLA).

Настройки в /settings: work_hours_start/work_hours_end ("HH:MM"),
work_days (номера дней недели, 0=понедельник..6=воскресенье, как
date.weekday()), holidays (список ISO-дат "YYYY-MM-DD").

Время считается в Europe/Moscow независимо от таймзоны сервера — иначе
на сервере с UTC (как в проде) "рабочие часы 09:00-18:00" считались бы
по UTC, а не по факту рабочего дня.
"""
from datetime import datetime, timedelta, time as dtime
from typing import Optional
from zoneinfo import ZoneInfo

from . import models, schemas

MSK = ZoneInfo("Europe/Moscow")


def _parse_hm(s: str):
    h, m = s.split(":")
    return int(h), int(m)


def get_work_config(db) -> dict:
    from .routers.settings import DEFAULTS
    rows = {row.key: row.value for row in db.query(models.Setting).all()}
    cfg = {**DEFAULTS, **rows}
    return {
        "work_start": cfg.get("work_hours_start", "09:00"),
        "work_end": cfg.get("work_hours_end", "18:00"),
        "work_days": cfg.get("work_days", [0, 1, 2, 3, 4]),
        "holidays": set(cfg.get("holidays", [])),
    }


def business_minutes(start: datetime, end: datetime, work_start: str, work_end: str, work_days: list, holidays: set) -> int:
    """Минуты между start и end, попадающие в рабочие часы рабочих дней —
    выходные, праздники и время вне рабочего окна не считаются."""
    if end <= start:
        return 0

    start = start.astimezone(MSK)
    end = end.astimezone(MSK)
    sh, sm = _parse_hm(work_start)
    eh, em = _parse_hm(work_end)

    total = 0
    cur_date = start.date()
    end_date = end.date()

    while cur_date <= end_date:
        if cur_date.weekday() in work_days and cur_date.isoformat() not in holidays:
            day_start = datetime.combine(cur_date, dtime(sh, sm), tzinfo=MSK)
            day_end = datetime.combine(cur_date, dtime(eh, em), tzinfo=MSK)
            window_start = max(day_start, start)
            window_end = min(day_end, end)
            if window_end > window_start:
                total += int((window_end - window_start).total_seconds() // 60)
        cur_date += timedelta(days=1)

    return total


def bulk_message_aggregates(db, ticket_ids: list) -> dict:
    """
    Для списка ticket_id разом (один запрос, не N+1) считает по каждому:
    last_agent_msg_at, last_client_msg_at, new_client_count (сообщения
    клиента после последнего сообщения агента — «новые» для карточки).
    Возвращает {ticket_id: {...}}, тикеты без сообщений в результат не
    попадают (вызывающий код обязан сам подставлять дефолты).
    """
    if not ticket_ids:
        return {}

    rows = (
        db.query(models.Message.ticket_id, models.Message.sender_type, models.Message.sent_at)
        .filter(models.Message.ticket_id.in_(ticket_ids))
        .order_by(models.Message.sent_at.asc(), models.Message.tg_message_id.asc(), models.Message.id.asc())
        .all()
    )

    by_ticket: dict = {}
    for ticket_id, sender_type, sent_at in rows:
        by_ticket.setdefault(ticket_id, []).append((sender_type, sent_at))

    out = {}
    for ticket_id, msgs in by_ticket.items():
        last_agent_at = None
        for sender_type, sent_at in msgs:
            if sender_type == "agent":
                last_agent_at = sent_at
        client_after = [sent_at for sender_type, sent_at in msgs if sender_type == "client" and (last_agent_at is None or sent_at > last_agent_at)]
        out[ticket_id] = {
            "last_agent_msg_at": last_agent_at,
            "last_client_msg_at": client_after[-1] if client_after else None,
            "new_client_count": len(client_after),
        }
    return out


def first_response_business_minutes(t: models.Ticket, work_cfg: dict) -> Optional[int]:
    """
    Сколько (рабочих) минут занял именно ПЕРВЫЙ ответ — для метрик вроде
    "среднее время ответа" у клиента. Не путать с ticket_wait_minutes:
    та функция теперь отражает ТЕКУЩЕЕ состояние ожидания (может расти
    заново, если после ответа пришли новые сообщения), а эта — всегда
    зафиксированный исторический факт. None, если ответа ещё не было.
    """
    if not t.first_response_at:
        return None
    return business_minutes(t.first_message_at, t.first_response_at, **work_cfg)


def ticket_response_status(
    t: models.Ticket,
    work_cfg: dict,
    last_agent_msg_at=None,
    last_client_msg_at=None,
    new_client_count: int = 0,
) -> dict:
    """
    Единая логика статуса ответа — используется и для "времени ожидания"
    (SLA), и для отображения на карточке в "Пульсе поддержки". Три
    состояния:

    - "no_response" — ответа от нас ещё не было вообще; минуты растут от
      первого сообщения клиента до сейчас.
    - "waiting_us" — мы уже отвечали, но с тех пор пришли новые сообщения
      от клиента без ответа; минуты растут от последнего такого сообщения.
    - "waiting_client" — мы ответили, новых сообщений от клиента с тех пор
      нет — ход за клиентом. Минуты ЗАФИКСИРОВАНЫ на времени до первого
      ответа (SLA сознательно не растёт в этом состоянии — простой сейчас
      не наш, а клиента).

    Для закрытых тикетов — отдельная ветка, как и раньше.
    """
    if t.status == "closed":
        end = t.first_response_at or t.closed_at or datetime.now(MSK)
        return {"kind": "closed", "minutes": business_minutes(t.first_message_at, end, **work_cfg)}

    if not t.first_response_at:
        return {"kind": "no_response", "minutes": business_minutes(t.first_message_at, datetime.now(MSK), **work_cfg)}

    if new_client_count > 0 and last_client_msg_at:
        return {"kind": "waiting_us", "minutes": business_minutes(last_client_msg_at, datetime.now(MSK), **work_cfg)}

    return {"kind": "waiting_client", "minutes": business_minutes(t.first_message_at, t.first_response_at, **work_cfg)}


def ticket_wait_minutes(t: models.Ticket, work_cfg: dict, **msg_aggregates) -> int:
    """Обратная совместимость — просто минуты из ticket_response_status."""
    return ticket_response_status(t, work_cfg, **msg_aggregates)["minutes"]


def to_ticket_out(t: models.Ticket, work_cfg: dict, **msg_aggregates) -> "schemas.TicketOut":
    """
    Единая точка сборки TicketOut с посчитанным wait_business_min —
    чтобы фронт не пересчитывал рабочие часы самостоятельно на JS.

    msg_aggregates — необязательные last_agent_msg_at/last_client_msg_at/
    new_client_count (см. ticket_response_status). Без них тикет
    трактуется как "нет новых сообщений от клиента" — корректно для
    закрытых/только что созданных тикетов, но для настоящей карточки в
    очереди эти данные нужно посчитать заранее одним запросом на весь
    список (см. routers/tickets.py) и передать сюда, а не дёргать БД на
    каждый тикет по отдельности.
    """
    status = ticket_response_status(t, work_cfg, **msg_aggregates)

    # Бейдж "N новых" — отдельная история от SLA-расчёта выше: пометка
    # "прочитано" (agent_seen_at) гасит только этот бейдж, не влияет на
    # то, ждём мы ответа или нет — это по-прежнему решает только реальный
    # ответ агента, не факт прочтения.
    raw_new_count = msg_aggregates.get("new_client_count", 0)
    last_client_msg_at = msg_aggregates.get("last_client_msg_at")
    if t.agent_seen_at and last_client_msg_at and t.agent_seen_at >= last_client_msg_at:
        badge_new_count = 0
    else:
        badge_new_count = raw_new_count

    return schemas.TicketOut(
        id=t.id,
        code=t.code,
        client_id=t.client_id,
        category=t.category,
        status=t.status,
        subject=t.subject,
        first_message_at=t.first_message_at,
        first_response_at=t.first_response_at,
        closed_at=t.closed_at,
        ai_confidence=t.ai_confidence,
        promise_text=t.promise_text,
        comment=t.comment,
        jira_url=t.jira_url,
        due_date=t.due_date,
        is_paid_work=t.is_paid_work,
        planned_cost=t.planned_cost,
        actual_hours=t.actual_hours,
        actual_cost=t.actual_cost,
        wait_business_min=status["minutes"],
        response_kind=status["kind"],
        new_message_count=badge_new_count,
    )
