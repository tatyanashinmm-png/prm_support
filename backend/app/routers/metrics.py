from datetime import date, datetime, timezone, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/metrics", tags=["metrics"])


def _period_start(days: int, date_from: Optional[date], date_to: Optional[date]):
    if date_from and date_to:
        start = min(date_from, date_to)
        end = max(date_from, date_to)
        return (
            datetime.combine(start, datetime.min.time(), tzinfo=timezone.utc),
            datetime.combine(end, datetime.min.time(), tzinfo=timezone.utc) + timedelta(days=1),
        )
    start = datetime.now(timezone.utc) - timedelta(days=days)
    return start, None


@router.get("/active-chats", response_model=schemas.ActiveChatsOut)
def active_chats(
    days: int = Query(30),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Активный чат = чат клиента, в котором за период было хотя бы одно
    сообщение от клиента (sender_type='client'). Уникальность — по клиенту,
    а не по количеству сообщений.
    """
    since, until = _period_start(days, date_from, date_to)
    q = (
        db.query(
            models.Message.client_id,
            func.count(models.Message.id).label("message_count"),
            func.max(models.Message.sent_at).label("last_message_at"),
        )
        .filter(models.Message.sender_type == "client")
        .filter(models.Message.sent_at >= since)
    )
    if until:
        q = q.filter(models.Message.sent_at < until)
    rows = q.group_by(models.Message.client_id).all()

    client_ids = [r.client_id for r in rows]
    clients = {c.id: c for c in db.query(models.Client).filter(models.Client.id.in_(client_ids)).all()} if client_ids else {}

    chats = [
        schemas.ActiveChatItem(
            client_id=r.client_id,
            client_name=clients[r.client_id].name if r.client_id in clients else "—",
            message_count=r.message_count,
            last_message_at=r.last_message_at,
        )
        for r in rows
    ]
    chats.sort(key=lambda c: c.last_message_at, reverse=True)
    return schemas.ActiveChatsOut(count=len(chats), chats=chats)


NEW_CLIENT_THRESHOLD_DAYS = 60  # тот же порог, что в clients.py — держим в одном месте было бы лучше,
                                 # но здесь важнее не тянуть роутер clients.py в metrics.py ради константы


@router.get("/period-comparison", response_model=schemas.PeriodComparisonOut)
def period_comparison(
    days: Optional[int] = Query(None, description="Длина периода в днях: 7/30/90"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Сравнивает выбранный период с предыдущим периодом такой же длины и
    раскладывает изменение общего числа обращений на три составляющие:
    - new: обращения от клиентов, подключённых менее NEW_CLIENT_THRESHOLD_DAYS
      дней назад (connected_at с Oracle-синка);
    - active: изменение у остальных ("действующих") клиентов, которые писали
      в обоих периодах или начали писать, оставаясь действующими;
    - churned: клиенты, которые писали в предыдущем периоде и замолчали
      в текущем — считается отдельно, это сигнал оттока, а не просто
      "меньше написали".
    Плюс разбивка по категориям и по каждому клиенту — для детализации по
    клику на фронте, без дополнительных запросов.
    """
    today = date.today()
    if date_from and date_to:
        cur_start, cur_end = min(date_from, date_to), max(date_from, date_to)
    else:
        d = days or 7
        cur_end = today
        cur_start = today - timedelta(days=d - 1)

    length = (cur_end - cur_start).days + 1
    prev_end = cur_start - timedelta(days=1)
    prev_start = prev_end - timedelta(days=length - 1)

    def counts_by_client(start: date, end: date):
        rows = (
            db.query(models.Ticket.client_id, func.count(models.Ticket.id))
            .filter(models.Ticket.first_message_at >= start)
            .filter(models.Ticket.first_message_at <= end + timedelta(days=1))
            .group_by(models.Ticket.client_id)
            .all()
        )
        return {r[0]: r[1] for r in rows}

    def counts_by_category(start: date, end: date):
        rows = (
            db.query(models.Ticket.category, func.count(models.Ticket.id))
            .filter(models.Ticket.first_message_at >= start)
            .filter(models.Ticket.first_message_at <= end + timedelta(days=1))
            .group_by(models.Ticket.category)
            .all()
        )
        return {r[0]: r[1] for r in rows}

    cur_counts = counts_by_client(cur_start, cur_end)
    prev_counts = counts_by_client(prev_start, prev_end)

    client_ids = set(cur_counts) | set(prev_counts)
    clients_map = (
        {c.id: c for c in db.query(models.Client).filter(models.Client.id.in_(client_ids)).all()}
        if client_ids else {}
    )

    clients_out = []
    new_delta = active_delta = churn_delta = 0
    for cid in client_ids:
        c = clients_map.get(cid)
        cur_c = cur_counts.get(cid, 0)
        prev_c = prev_counts.get(cid, 0)
        d = cur_c - prev_c

        is_new = bool(c and c.connected_at and (today - c.connected_at).days < NEW_CLIENT_THRESHOLD_DAYS)
        if is_new:
            bucket = "new"
            new_delta += d
        elif cur_c == 0 and prev_c > 0:
            bucket = "churned"
            churn_delta += d
        else:
            bucket = "active"
            active_delta += d

        clients_out.append(schemas.ClientPeriodDelta(
            client_id=cid,
            client_name=c.name if c else "—",
            bucket=bucket,
            current_count=cur_c,
            previous_count=prev_c,
            delta=d,
        ))
    clients_out.sort(key=lambda x: abs(x.delta), reverse=True)

    cur_cats = counts_by_category(cur_start, cur_end)
    prev_cats = counts_by_category(prev_start, prev_end)
    categories_out = [
        schemas.CategoryPeriodDelta(category=cat, current_count=cur_cats.get(cat, 0), previous_count=prev_cats.get(cat, 0))
        for cat in (set(cur_cats) | set(prev_cats))
    ]
    categories_out.sort(key=lambda x: x.current_count, reverse=True)

    current_total = sum(cur_counts.values())
    previous_total = sum(prev_counts.values())
    delta_total = current_total - previous_total
    delta_pct = round((delta_total / previous_total) * 100, 1) if previous_total else None

    return schemas.PeriodComparisonOut(
        current_start=cur_start, current_end=cur_end,
        previous_start=prev_start, previous_end=prev_end,
        current_total=current_total, previous_total=previous_total,
        delta=delta_total, delta_pct=delta_pct,
        new_clients_delta=new_delta, active_clients_delta=active_delta, churned_delta=churn_delta,
        clients=clients_out, categories=categories_out,
    )
