from datetime import date, datetime, timezone, timedelta
from typing import Optional, List
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session
from .. import models, schemas, business_hours, auth
from ..database import get_db

router = APIRouter(prefix="/clients", tags=["clients"])


def _period_bounds(days: Optional[int], date_from: Optional[date], date_to: Optional[date]):
    today = date.today()
    if date_from and date_to:
        return min(date_from, date_to), max(date_from, date_to)
    d = days or 30
    return today - timedelta(days=d), today


NEW_CLIENT_THRESHOLD_DAYS = 60  # порог "новый/действующий" клиент, см. connected_at


def _build_client_out(client: models.Client, period_tickets: list, open_count: int, work_cfg: dict) -> schemas.ClientOut:
    """Собирает ClientOut из уже загруженных данных — без единого обращения
    к БД внутри. И одиночный, и пакетный путь ниже готовят period_tickets/
    open_count заранее и передают сюда готовые списки/числа."""
    count = len(period_tickets)
    closed = len([t for t in period_tickets if t.status == "closed"])
    closed_rate = closed / count if count else 0.0

    responses = [
        business_hours.first_response_business_minutes(t, work_cfg)
        for t in period_tickets if t.first_response_at
    ]
    responses = [r for r in responses if r is not None]
    avg_response = round(sum(responses) / len(responses)) if responses else 0

    is_new = bool(
        client.connected_at
        and (date.today() - client.connected_at).days < NEW_CLIENT_THRESHOLD_DAYS
    )

    return schemas.ClientOut(
        id=client.id,
        name=client.name,
        tg_group_id=client.tg_group_id,
        chat_label=client.chat_label,
        vip=client.vip,
        tariff_name=client.tariff_name,
        tariff_price=client.tariff_price,
        connected_at=client.connected_at,
        is_new_client=is_new,
        billing_contract_id=client.billing_contract_id,
        billing_contract_number=client.billing_contract_number,
        subscription_status=client.subscription_status,
        open_count=open_count,
        ticket_count=count,
        avg_response_min=avg_response,
        closed_rate=round(closed_rate, 2),
    )


def _client_stats(db: Session, client: models.Client, start: date, end: date, work_cfg: dict) -> schemas.ClientOut:
    """Для одиночного клиента (get/update/create) — две точечных запроса,
    это не в цикле, так что N+1 тут не возникает."""
    period_tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == client.id)
        .filter(models.Ticket.first_message_at >= start)
        .filter(models.Ticket.first_message_at <= end + timedelta(days=1))
        .all()
    )
    open_count = (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == client.id, models.Ticket.status == "open")
        .count()
    )
    return _build_client_out(client, period_tickets, open_count, work_cfg)


@router.get("", response_model=List[schemas.ClientOut])
def list_clients(
    days: Optional[int] = Query(None, description="Период в днях: 7/30/90"),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Было N+1: на каждого клиента — отдельный запрос за тикетами периода и
    отдельный за числом открытых (итого 2×N запросов на список из N
    клиентов). Теперь — 3 запроса суммарно, независимо от числа клиентов:
    сами клиенты, все их тикеты периода одним IN-запросом, открытые счётом
    одним GROUP BY. Дальше — чистый Python, без похода в БД.
    """
    start, end = _period_bounds(days, date_from, date_to)
    work_cfg = business_hours.get_work_config(db)

    clients = db.query(models.Client).filter(models.Client.active == True).all()  # noqa: E712
    if not clients:
        return []
    client_ids = [c.id for c in clients]

    period_tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id.in_(client_ids))
        .filter(models.Ticket.first_message_at >= start)
        .filter(models.Ticket.first_message_at <= end + timedelta(days=1))
        .all()
    )
    tickets_by_client = {}
    for t in period_tickets:
        tickets_by_client.setdefault(t.client_id, []).append(t)

    open_rows = (
        db.query(models.Ticket.client_id, func.count(models.Ticket.id))
        .filter(models.Ticket.client_id.in_(client_ids))
        .filter(models.Ticket.status == "open")
        .group_by(models.Ticket.client_id)
        .all()
    )
    open_counts = {cid: cnt for cid, cnt in open_rows}

    return [
        _build_client_out(c, tickets_by_client.get(c.id, []), open_counts.get(c.id, 0), work_cfg)
        for c in clients
    ]


@router.post("", response_model=schemas.ClientOut, status_code=201)
def create_client(payload: schemas.ClientCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """Ручное добавление клиента из дашборда — в дополнение к массовому /clients/sync."""
    existing = db.query(models.Client).filter(models.Client.tg_group_id == payload.tg_group_id).first()
    if existing:
        raise HTTPException(409, f"Клиент с tg_group_id={payload.tg_group_id} уже существует")

    client = models.Client(**payload.model_dump())
    db.add(client)
    db.commit()
    db.refresh(client)
    auth.log_action(db, current_user, "client.created", "client", client.id, {"name": client.name, "tg_group_id": client.tg_group_id})

    work_cfg = business_hours.get_work_config(db)
    start, end = _period_bounds(30, None, None)
    return _client_stats(db, client, start, end, work_cfg)


@router.delete("/{client_id}", status_code=204)
def delete_client(client_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Удаляет клиента вместе со всей его историей (сообщения, тикеты) — это
    безвозвратно, отдельного подтверждения на уровне API нет, подтверждение
    должно быть на фронте перед вызовом.
    """
    client = db.query(models.Client).get(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    client_name = client.name

    db.query(models.Message).filter(models.Message.client_id == client_id).delete(synchronize_session=False)
    db.query(models.Ticket).filter(models.Ticket.client_id == client_id).delete(synchronize_session=False)
    db.delete(client)
    db.commit()
    auth.log_action(db, current_user, "client.deleted", "client", client_id, {"name": client_name})


@router.get("/{client_id}", response_model=schemas.ClientOut)
def get_client(
    client_id: str,
    days: Optional[int] = Query(30),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    db: Session = Depends(get_db),
):
    client = db.query(models.Client).get(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    start, end = _period_bounds(days, date_from, date_to)
    work_cfg = business_hours.get_work_config(db)
    return _client_stats(db, client, start, end, work_cfg)


@router.patch("/{client_id}", response_model=schemas.ClientOut)
def update_client(client_id: str, payload: schemas.ClientUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    client = db.query(models.Client).get(client_id)
    if not client:
        raise HTTPException(404, "Client not found")
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(client, field, value)
    db.commit()
    db.refresh(client)
    auth.log_action(db, current_user, "client.updated", "client", client.id, {"changed": data})
    start, end = _period_bounds(30, None, None)
    work_cfg = business_hours.get_work_config(db)
    return _client_stats(db, client, start, end, work_cfg)


@router.get("/{client_id}/telegram-info", response_model=schemas.TelegramInfoOut)
def telegram_info(client_id: str, db: Session = Depends(get_db)):
    """
    Название группового чата в Telegram — через Bot API getChat, а не
    хранится/хардкодится на фронте. Использует тот же токен, что и
    bot-collector (bot_collector_token из /settings).
    """
    client = db.query(models.Client).get(client_id)
    if not client:
        raise HTTPException(404, "Client not found")

    setting = db.query(models.Setting).get("bot_collector_token")
    token = (setting.value if setting else "") or ""
    if not token:
        return schemas.TelegramInfoOut(ok=False, error="Токен бота не задан в /settings")

    try:
        resp = httpx.get(
            f"https://api.telegram.org/bot{token}/getChat",
            params={"chat_id": client.tg_group_id},
            timeout=10,
        )
        data = resp.json()
        if not data.get("ok"):
            return schemas.TelegramInfoOut(ok=False, error=data.get("description", "Telegram API вернул ошибку"))
        title = data["result"].get("title") or data["result"].get("first_name")
        return schemas.TelegramInfoOut(ok=True, title=title)
    except httpx.RequestError as e:
        return schemas.TelegramInfoOut(ok=False, error=f"Не удалось связаться с Telegram: {e}")
    except Exception as e:  # неожиданный формат ответа и т.п. — не роняем запрос
        return schemas.TelegramInfoOut(ok=False, error=f"Неожиданная ошибка: {e}")


@router.get("/{client_id}/tickets", response_model=List[schemas.TicketOut])
def client_tickets(
    client_id: str,
    days: Optional[int] = Query(None),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    start, end = _period_bounds(days, date_from, date_to)
    work_cfg = business_hours.get_work_config(db)
    q = db.query(models.Ticket).filter(models.Ticket.client_id == client_id)
    q = q.filter(models.Ticket.first_message_at >= start)
    q = q.filter(models.Ticket.first_message_at <= end + timedelta(days=1))
    if status:
        q = q.filter(models.Ticket.status == status)
    tickets = q.order_by(models.Ticket.first_message_at.desc()).all()
    aggs = business_hours.bulk_message_aggregates(db, [t.id for t in tickets])
    return [business_hours.to_ticket_out(t, work_cfg, **aggs.get(t.id, {})) for t in tickets]


@router.get("/{client_id}/category-stats", response_model=List[schemas.CategoryStat])
def category_stats(client_id: str, db: Session = Depends(get_db)):
    since = date.today() - timedelta(days=90)
    tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == client_id)
        .filter(models.Ticket.first_message_at >= since)
        .all()
    )
    by_cat = {}
    for t in tickets:
        b = by_cat.setdefault(t.category, {"count": 0, "wait_sum": 0.0, "wait_n": 0})
        b["count"] += 1
        if t.first_response_at:
            b["wait_sum"] += (t.first_response_at - t.first_message_at).total_seconds() / 60
            b["wait_n"] += 1

    out = [
        schemas.CategoryStat(
            category=cat,
            avg_per_month=round(b["count"] / 3, 1),
            avg_response_min=round(b["wait_sum"] / b["wait_n"]) if b["wait_n"] else 0,
        )
        for cat, b in by_cat.items()
    ]
    out.sort(key=lambda r: r.avg_per_month, reverse=True)
    return out


@router.post("/sync", response_model=schemas.SyncResult)
def sync_clients(payload: schemas.SyncPayload, db: Session = Depends(get_db)):
    created, updated = 0, 0
    for item in payload.clients:
        existing = db.query(models.Client).filter(models.Client.tg_group_id == item.tg_group_id).first()
        if existing:
            existing.name = item.name
            if item.chat_label:
                existing.chat_label = item.chat_label
            if item.tariff_name is not None:
                existing.tariff_name = item.tariff_name
            if item.tariff_price is not None:
                existing.tariff_price = item.tariff_price
            if item.connected_at is not None:
                existing.connected_at = item.connected_at
            if item.billing_contract_id is not None:
                existing.billing_contract_id = item.billing_contract_id
            if item.billing_contract_number is not None:
                existing.billing_contract_number = item.billing_contract_number
            if item.subscription_status is not None:
                existing.subscription_status = item.subscription_status
            updated += 1
        else:
            db.add(models.Client(
                name=item.name,
                tg_group_id=item.tg_group_id,
                chat_label=item.chat_label,
                tariff_name=item.tariff_name,
                tariff_price=item.tariff_price,
                connected_at=item.connected_at,
                billing_contract_id=item.billing_contract_id,
                billing_contract_number=item.billing_contract_number,
                subscription_status=item.subscription_status,
            ))
            created += 1

    # Отмечаем момент успешного синка и снимаем флаг "запрошена синхронизация",
    # чтобы агент и дашборд видели актуальное состояние без дополнительных вызовов.
    now_iso = datetime.now(timezone.utc).isoformat()
    for key, value in (("oracle_last_sync", now_iso), ("oracle_sync_requested", False)):
        row = db.query(models.Setting).get(key)
        if row:
            row.value = value
        else:
            db.add(models.Setting(key=key, value=value))

    db.commit()
    return schemas.SyncResult(created=created, updated=updated)
