from datetime import datetime, timezone, timedelta, date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from .. import models, schemas, business_hours, auth
from ..database import get_db

router = APIRouter(prefix="/tickets", tags=["tickets"])


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


def _next_code_tickets(db: Session) -> str:
    last = db.query(models.Ticket).order_by(models.Ticket.id.desc()).first()
    return f"SUP-{1000 + ((last.id if last else 0) + 1)}"


@router.post("", response_model=schemas.TicketOut, status_code=201)
def create_ticket(payload: schemas.TicketCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """Ручное создание обращения из дашборда — в дополнение к автоматическому через /ingest/message."""
    client = db.query(models.Client).get(str(payload.client_id))
    if not client:
        raise HTTPException(404, "Client not found")

    code = _next_code_tickets(db)

    t = models.Ticket(
        code=code,
        client_id=client.id,
        category=payload.category,
        status=payload.status,
        subject=payload.subject,
        first_message_at=datetime.now(timezone.utc),
        promise_text=payload.promise_text,
        comment=payload.comment,
        jira_url=payload.jira_url,
        due_date=payload.due_date,
        is_paid_work=payload.is_paid_work,
        planned_cost=payload.planned_cost,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    auth.log_action(db, current_user, "ticket.created", "ticket", t.id, {"code": t.code, "client_id": str(client.id)})

    work_cfg = business_hours.get_work_config(db)
    return business_hours.to_ticket_out(t, work_cfg)


@router.get("", response_model=List[schemas.TicketOut])
def list_tickets(
    view: Optional[str] = Query(None, description="open|sla_breach|waiting_client|closed|no_jira"),
    days: int = Query(30),
    date_from: Optional[date] = Query(None),
    date_to: Optional[date] = Query(None),
    attention_after_min: int = Query(45),
    has_new_messages: Optional[bool] = Query(None),
    db: Session = Depends(get_db),
):
    work_cfg = business_hours.get_work_config(db)

    since, until = _period_start(days, date_from, date_to)
    q = db.query(models.Ticket).filter(models.Ticket.first_message_at >= since)
    if until:
        q = q.filter(models.Ticket.first_message_at < until)
    tickets = q.order_by(models.Ticket.first_message_at.desc()).all()

    # Один запрос на все сообщения этого списка тикетов — не N+1 на каждый.
    aggs = business_hours.bulk_message_aggregates(db, [t.id for t in tickets])

    if view == "open":
        tickets = [t for t in tickets if t.status == "open"]
    elif view == "sla_breach":
        tickets = [t for t in tickets if t.status not in ("closed", "waiting_client") and not t.due_date and business_hours.ticket_wait_minutes(t, work_cfg, **aggs.get(t.id, {})) > attention_after_min]
    elif view == "waiting_client":
        tickets = [t for t in tickets if t.status == "waiting_client"]
    elif view == "closed":
        tickets = [t for t in tickets if t.status == "closed"]
    elif view == "no_jira":
        tickets = [t for t in tickets if t.status != "closed" and not t.jira_url]

    if has_new_messages is not None:
        tickets = [t for t in tickets if bool(aggs.get(t.id, {}).get("new_client_count", 0)) == has_new_messages]

    return [business_hours.to_ticket_out(t, work_cfg, **aggs.get(t.id, {})) for t in tickets]


@router.post("/merge", response_model=schemas.TicketOut)
def merge_tickets(payload: schemas.TicketMerge, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Объединяет два тикета одного клиента — переносит всю переписку
    merge_ticket_id в keep_ticket_id и удаляет опустевший. Полезно, когда
    один разговор случайно разъехался на два тикета (например, эвристика
    без ИИ разошлась в категории между соседними сообщениями).
    """
    keep = db.query(models.Ticket).get(payload.keep_ticket_id)
    merge = db.query(models.Ticket).get(payload.merge_ticket_id)
    if not keep or not merge:
        raise HTTPException(404, "Ticket not found")
    if keep.id == merge.id:
        raise HTTPException(400, "Нельзя объединить тикет сам с собой")
    if keep.client_id != merge.client_id:
        raise HTTPException(400, "Тикеты принадлежат разным клиентам")

    db.query(models.Message).filter(models.Message.ticket_id == merge.id).update({"ticket_id": keep.id})

    if merge.first_message_at < keep.first_message_at:
        keep.first_message_at = merge.first_message_at
    if merge.first_response_at and (not keep.first_response_at or merge.first_response_at < keep.first_response_at):
        keep.first_response_at = merge.first_response_at
    if merge.status != "closed" and keep.status == "closed":
        keep.status = merge.status

    merge_code = merge.code
    db.delete(merge)
    db.commit()
    db.refresh(keep)
    auth.log_action(db, current_user, "ticket.merged", "ticket", keep.id, {"keep_code": keep.code, "merged_code": merge_code})

    work_cfg = business_hours.get_work_config(db)
    return business_hours.to_ticket_out(keep, work_cfg)


@router.post("/{ticket_id}/split", response_model=schemas.TicketOut)
def split_ticket(ticket_id: int, payload: schemas.TicketSplit, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """Выносит выбранные сообщения тикета в новый тикет того же клиента."""
    source = db.query(models.Ticket).get(ticket_id)
    if not source:
        raise HTTPException(404, "Ticket not found")
    if not payload.message_ids:
        raise HTTPException(400, "Не выбрано ни одного сообщения")

    messages = (
        db.query(models.Message)
        .filter(models.Message.id.in_(payload.message_ids), models.Message.ticket_id == ticket_id)
        .all()
    )
    if not messages:
        raise HTTPException(400, "Выбранные сообщения не найдены в этом тикете")
    messages.sort(key=lambda m: (m.sent_at, m.tg_message_id or 0, m.id))

    # first_response_at нового тикета — самое раннее сообщение агента среди
    # перенесённых (если оно есть). Раньше оставляли пустым, из-за чего время
    # ожидания у нового тикета считалось так, будто ответа не было вообще.
    agent_times = [m.sent_at for m in messages if m.sender_type == "agent"]
    first_response_at = min(agent_times) if agent_times else None

    new_ticket = models.Ticket(
        code=_next_code_tickets(db),
        client_id=source.client_id,
        category=payload.category or source.category,
        subject=(payload.subject or messages[0].text)[:200],
        status="open",
        first_message_at=min(m.sent_at for m in messages),
        first_response_at=first_response_at,
    )
    db.add(new_ticket)
    db.flush()

    if payload.mode == "copy":
        for m in messages:
            db.add(models.Message(
                client_id=m.client_id,
                tg_message_id=m.tg_message_id,
                sender_type=m.sender_type,
                sender_name=m.sender_name,
                sender_tg_id=m.sender_tg_id,
                text=m.text,
                sent_at=m.sent_at,
                ticket_id=new_ticket.id,
            ))
            # исходное сообщение остаётся в source, ticket_id не трогаем
    else:
        for m in messages:
            m.ticket_id = new_ticket.id

    db.commit()
    db.refresh(new_ticket)
    auth.log_action(db, current_user, "ticket.split", "ticket", new_ticket.id, {"from_code": source.code, "new_code": new_ticket.code, "mode": payload.mode, "message_count": len(messages)})

    work_cfg = business_hours.get_work_config(db)
    return business_hours.to_ticket_out(new_ticket, work_cfg)


@router.delete("/{ticket_id}", status_code=204)
def delete_ticket(ticket_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Удаляет тикет. Сообщения не удаляются — просто отвязываются
    (ticket_id → NULL), история переписки в БД остаётся.
    """
    ticket = db.query(models.Ticket).get(ticket_id)
    if not ticket:
        raise HTTPException(404, "Ticket not found")
    code, client_id = ticket.code, str(ticket.client_id)
    db.query(models.Message).filter(models.Message.ticket_id == ticket_id).update({"ticket_id": None})
    db.delete(ticket)
    db.commit()
    auth.log_action(db, current_user, "ticket.deleted", "ticket", ticket_id, {"code": code, "client_id": client_id})


@router.post("/{ticket_id}/mark-seen", response_model=schemas.TicketOut)
def mark_ticket_seen(ticket_id: int, db: Session = Depends(get_db)):
    """Гасит чип "N новых" — не влияет на статус/SLA, это отдельная история от ответа агента."""
    t = db.query(models.Ticket).get(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    t.agent_seen_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(t)
    work_cfg = business_hours.get_work_config(db)
    agg = business_hours.bulk_message_aggregates(db, [ticket_id]).get(ticket_id, {})
    return business_hours.to_ticket_out(t, work_cfg, **agg)


@router.get("/{ticket_id}", response_model=schemas.TicketOut)
def get_ticket(ticket_id: int, db: Session = Depends(get_db)):
    t = db.query(models.Ticket).get(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    work_cfg = business_hours.get_work_config(db)
    agg = business_hours.bulk_message_aggregates(db, [ticket_id]).get(ticket_id, {})
    return business_hours.to_ticket_out(t, work_cfg, **agg)


@router.patch("/{ticket_id}", response_model=schemas.TicketOut)
def update_ticket(ticket_id: int, payload: schemas.TicketUpdate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    t = db.query(models.Ticket).get(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")

    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        setattr(t, field, value)

    if payload.status == "closed" and not t.closed_at:
        t.closed_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(t)
    auth.log_action(db, current_user, "ticket.updated", "ticket", t.id, {"changed": data})
    work_cfg = business_hours.get_work_config(db)
    agg = business_hours.bulk_message_aggregates(db, [ticket_id]).get(ticket_id, {})
    return business_hours.to_ticket_out(t, work_cfg, **agg)


@router.get("/{ticket_id}/messages", response_model=List[schemas.MessageOut])
def get_ticket_messages(ticket_id: int, db: Session = Depends(get_db)):
    t = db.query(models.Ticket).get(ticket_id)
    if not t:
        raise HTTPException(404, "Ticket not found")
    return (
        db.query(models.Message)
        .filter(models.Message.ticket_id == ticket_id)
        .order_by(models.Message.sent_at.asc(), models.Message.tg_message_id.asc(), models.Message.id.asc())
        .all()
    )


@router.post("/run-autoclose-check")
def run_autoclose_check(db: Session = Depends(get_db)):
    """
    Запускает джобу автозакрытия прямо сейчас, не дожидаясь планировщика
    (он делает то же самое раз в 10 минут). Полезно для локального теста —
    без реального ожидания.
    """
    from .. import scheduler as scheduler_module
    scheduler_module.job_suggest_autoclose()

    pending = db.query(models.Ticket).filter(models.Ticket.status == "pending_confirm").all()
    return {
        "pending_confirm_count": len(pending),
        "tickets": [t.code for t in pending],
    }
