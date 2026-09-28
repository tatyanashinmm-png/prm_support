from datetime import date
from typing import Optional, List
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models, schemas
from ..database import get_db

router = APIRouter(prefix="/promises", tags=["promises"])


@router.get("", response_model=List[schemas.PromiseOut])
def list_promises(bucket: Optional[str] = None, status: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Обещания — тикеты со сроком исполнения. Закрытые тоже возвращаются (бакет
    "done"), чтобы на фронте можно было фильтровать активные/выполненные, а
    не только скрывать закрытые молча.
    """
    q = db.query(models.Ticket).filter(models.Ticket.due_date.isnot(None))
    if status:
        q = q.filter(models.Ticket.status == status)
    tickets = q.all()

    today = date.today()
    out = []
    for t in tickets:
        if t.status == "closed":
            b = "done"
        elif t.due_date < today:
            b = "overdue"
        elif t.due_date == today:
            b = "today"
        else:
            b = "week"

        if bucket and b != bucket:
            continue

        out.append(schemas.PromiseOut(
            ticket_id=t.id,
            code=t.code,
            client_id=t.client_id,
            text=t.promise_text or t.subject,
            category=t.category,
            status=t.status,
            is_paid_work=t.is_paid_work,
            due_date=t.due_date,
            jira_url=t.jira_url,
            bucket=b,
        ))
    return out


@router.patch("/{ticket_id}")
def mark_promise_done(ticket_id: int, db: Session = Depends(get_db)):
    t = db.query(models.Ticket).get(ticket_id)
    if t:
        t.promise_text = None
        t.due_date = None
        db.commit()
    return {"status": "ok"}
