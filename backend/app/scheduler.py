"""
Планировщик фоновых задач (APScheduler, внутри процесса backend).

Джобы:
- categorize     — раз в минуту подстраховочно дозаполняет тикеты с
                    категорией "Не определено", если такие вдруг появятся.
                    С переходом на маршрутизацию по категориям (см.
                    routers/ingest.py) категоризация происходит синхронно
                    при создании тикета, так что в норме эта джоба почти
                    никогда не находит работы — оставлена как safety net.
- autoclose      — раз в 10 минут ищет открытые тикеты без активности дольше
                    порога attention_after_min (считается в рабочих часах,
                    см. business_hours.py — выходные и нерабочее время не
                    засчитываются в простой) и с уверенностью ИИ выше
                    auto_confidence_pct переводит в pending_confirm.
- daily_digest   — проверяется раз в 5 минут: как только по Europe/Moscow
                    наступает время из настроек (daily_digest_hour/minute,
                    по умолчанию 23:00) и сводка за сегодня ещё не собрана —
                    генерирует и сохраняет её. Раз в 5 минут вместо точного
                    cron-триггера на конкретную минуту — чтобы смена времени
                    в /settings подхватывалась сама, без перезапуска
                    планировщика.
"""
from datetime import datetime, timedelta, date
from zoneinfo import ZoneInfo

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy import func

from .database import SessionLocal
from . import models, llm, business_hours
from .routers.settings import DEFAULTS

MSK = ZoneInfo("Europe/Moscow")
scheduler = BackgroundScheduler(timezone="Europe/Moscow")


def _get_settings(db) -> dict:
    rows = {row.key: row.value for row in db.query(models.Setting).all()}
    return {**DEFAULTS, **rows}


def job_categorize_pending():
    db = SessionLocal()
    try:
        tickets = (
            db.query(models.Ticket)
            .filter(models.Ticket.category == "Не определено")
            .limit(20)
            .all()
        )
        for t in tickets:
            category, subject, confidence, _used_ai = llm.categorize_ticket(db, t.subject)
            t.category = category
            t.subject = subject
            t.ai_confidence = confidence
        if tickets:
            db.commit()
            print(f"[scheduler] категоризировано тикетов: {len(tickets)}")
    finally:
        db.close()


def job_suggest_autoclose():
    db = SessionLocal()
    try:
        settings = _get_settings(db)
        if not settings.get("auto_close"):
            return

        attention_after = settings.get("attention_after_min", 45)
        auto_conf = settings.get("auto_confidence_pct", 85)
        work_cfg = business_hours.get_work_config(db)

        candidates = (
            db.query(models.Ticket)
            .filter(models.Ticket.status == "open")
            .filter(models.Ticket.first_response_at.isnot(None))
            .all()
        )
        now = datetime.now(MSK)
        changed = 0
        for t in candidates:
            last_msg = (
                db.query(func.max(models.Message.sent_at))
                .filter(models.Message.ticket_id == t.id)
                .scalar()
            )
            reference = last_msg or t.first_response_at
            idle_min = business_hours.business_minutes(reference, now, **work_cfg)
            if idle_min < attention_after:
                continue

            should_close, confidence, _reason = llm.suggest_close(db, t.subject, int(idle_min))
            if should_close and confidence >= auto_conf:
                t.status = "pending_confirm"
                t.ai_confidence = confidence
                changed += 1

        if changed:
            db.commit()
            print(f"[scheduler] предложено закрыть тикетов: {changed}")
    finally:
        db.close()


def _generate_and_store_digest(db, target_date: date = None) -> models.DailySummary:
    target_date = target_date or date.today()
    tomorrow = target_date + timedelta(days=1)
    tickets = (
        db.query(models.Ticket)
        .filter(models.Ticket.first_message_at >= target_date)
        .filter(models.Ticket.first_message_at < tomorrow)
        .all()
    )
    by_cat: dict = {}
    for t in tickets:
        by_cat[t.category] = by_cat.get(t.category, 0) + 1

    stats = {
        "date": str(target_date),
        "total": len(tickets),
        "open_count": len([t for t in tickets if t.status == "open"]),
        "closed_count": len([t for t in tickets if t.status == "closed"]),
        "by_category": by_cat,
    }

    text = llm.generate_daily_summary(db, stats)
    active_providers = [p["provider"] for p in llm.get_ai_providers(db) if p.get("enabled") and p.get("api_key")]
    model_used = active_providers[0] if active_providers else "rule-based-fallback"

    summary = db.query(models.DailySummary).filter(models.DailySummary.summary_date == target_date).first()
    if summary:
        summary.summary_text = text
        summary.model_used = model_used
    else:
        summary = models.DailySummary(summary_date=target_date, summary_text=text, model_used=model_used)
        db.add(summary)
    db.commit()
    db.refresh(summary)
    return summary


def job_daily_digest():
    db = SessionLocal()
    try:
        settings = _get_settings(db)
        if not settings.get("daily_digest"):
            return

        hour = int(settings.get("daily_digest_hour", 23))
        minute = int(settings.get("daily_digest_minute", 0))
        now = datetime.now(MSK)
        today = now.date()

        already = db.query(models.DailySummary).filter(models.DailySummary.summary_date == today).first()
        if already:
            return
        if (now.hour, now.minute) < (hour, minute):
            return

        _generate_and_store_digest(db)
        print(f"[scheduler] дневная сводка сгенерирована в {now.strftime('%H:%M')} МСК")
    finally:
        db.close()


def start():
    scheduler.add_job(job_categorize_pending, "interval", minutes=1, id="categorize", replace_existing=True)
    # job_suggest_autoclose отключена — статус "ожидание клиента" (waiting_client)
    # проставляется автоматически при каждом ответе агента, поэтому условие job'а
    # (status=="open" AND first_response_at IS NOT NULL) больше не встречается:
    # отвеченные тикеты сразу переходят в waiting_client, а не остаются "open".
    # Группа "Ждут ответа клиента" в интерфейсе — прямая замена этой AI-подсказки.
    scheduler.add_job(job_daily_digest, "interval", minutes=5, id="daily_digest", replace_existing=True)
    scheduler.start()
    print("[scheduler] запущен: categorize(1мин) autoclose(10мин) daily_digest(проверка каждые 5мин, время — из настроек)")


def stop():
    scheduler.shutdown(wait=False)
