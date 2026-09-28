from datetime import date, datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas
from ..database import get_db
from .. import scheduler as scheduler_module

router = APIRouter(prefix="/digest", tags=["digest"])


def _day_stats(db: Session, target_date: date) -> schemas.DigestOut:
    tomorrow = target_date + timedelta(days=1)
    tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.first_message_at >= target_date)
        .filter(models.Ticket.first_message_at < tomorrow)
        .all()
    )
    summary = db.query(models.DailySummary).filter(models.DailySummary.summary_date == target_date).first()

    # По дате ЗАКРЫТИЯ, не создания — иначе обращение, открытое вчера и
    # закрытое сегодня, не попадало бы в "Закрыто" сегодняшней сводки вовсе.
    closed_count = (
        db.query(models.Ticket)
        .filter(models.Ticket.closed_at >= target_date)
        .filter(models.Ticket.closed_at < tomorrow)
        .count()
    )

    return schemas.DigestOut(
        date=target_date,
        total=len(tickets),
        open_count=len([t for t in tickets if t.status == "open"]),
        closed_count=closed_count,
        summary_text=summary.summary_text if summary else None,
    )


@router.get("/today", response_model=schemas.DigestOut)
def get_today_digest(target_date: Optional[date] = Query(None, alias="date"), db: Session = Depends(get_db)):
    """Несмотря на имя пути (осталось для обратной совместимости) — принимает
    ?date=YYYY-MM-DD для просмотра сводки за произвольный день, не только сегодня."""
    return _day_stats(db, target_date or date.today())


@router.post("/regenerate", response_model=schemas.DigestOut)
def regenerate_digest(target_date: Optional[date] = Query(None, alias="date"), db: Session = Depends(get_db)):
    """Пересобирает сводку через LLM-адаптер (или эвристику) за указанный день, по умолчанию — за сегодня."""
    day = target_date or date.today()
    scheduler_module._generate_and_store_digest(db, day)
    return _day_stats(db, day)


@router.post("/send")
def send_digest(db: Session = Depends(get_db)):
    """
    Помечает сегодняшнюю сводку как отправленную. Реальная доставка в чат
    «Дневные сводки» через Telegram Bot API подключится вместе с bot-digest —
    здесь сохраняем текст и sent_at, чтобы фронт и дальнейшую интеграцию
    можно было проверять уже сейчас. Отправка привязана именно к сегодняшнему
    дню — старую сводку прошлого дня в рабочий чат не шлём.
    """
    today = date.today()
    summary = db.query(models.DailySummary).filter(models.DailySummary.summary_date == today).first()
    if not summary:
        summary = scheduler_module._generate_and_store_digest(db, today)

    summary.sent_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "status": "stub",
        "detail": "Сводка сохранена и помечена отправленной. Реальная доставка в Telegram подключится вместе с bot-digest.",
        "summary_text": summary.summary_text,
    }
