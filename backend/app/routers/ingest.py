from typing import Optional, List
import hmac
import os
from fastapi import APIRouter, Depends, HTTPException, Header
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import llm, models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/ingest", tags=["ingest"])


# Общий секрет между backend и bot-collector (docker-compose передаёт обоим
# одно и то же значение из .env). Нужен, потому что /settings теперь требует
# вход пользователя, а у бота его нет — при этом отдавать токен бота и
# список агентов без какой-либо проверки нельзя (порт backend открыт наружу).
BOT_SERVICE_KEY = os.getenv("BOT_SERVICE_KEY", "")


@router.get("/bot-config")
def bot_config(x_bot_key: Optional[str] = Header(None), db: Session = Depends(get_db)):
    """Только для bot-collector: токен бота и список агентов. Пустой/не
    заданный ключ на backend — отказ всегда (безопасный дефолт)."""
    if not BOT_SERVICE_KEY or not x_bot_key or not hmac.compare_digest(x_bot_key, BOT_SERVICE_KEY):
        raise HTTPException(401, "Неверный ключ бота")
    rows = db.query(models.Setting).filter(models.Setting.key.in_(["bot_collector_token", "agent_tg_ids"])).all()
    values = {r.key: r.value for r in rows}
    return {
        "bot_collector_token": values.get("bot_collector_token") or "",
        "agent_tg_ids": values.get("agent_tg_ids") or [],
    }


@router.get("/senders", response_model=List[schemas.SenderInfo])
def list_senders(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Все, кто когда-либо писал в отслеживаемых чатах, с их числовым Telegram
    id — чтобы найти нужного человека по имени/переписке и добавить его id
    в список агентов (в «Настройки»), не выясняя id вручную через сторонние
    боты. Сортировка — от самых активных.
    """
    rows = (
        db.query(
            models.Message.sender_tg_id,
            models.Message.sender_name,
            func.count(models.Message.id),
            func.max(models.Message.sent_at),
        )
        .filter(models.Message.sender_tg_id.isnot(None))
        .group_by(models.Message.sender_tg_id, models.Message.sender_name)
        .all()
    )

    setting = db.query(models.Setting).get("agent_tg_ids")
    current_agents = set(setting.value if setting else [])

    out = [
        schemas.SenderInfo(
            sender_tg_id=r[0],
            sender_name=r[1],
            message_count=r[2],
            last_seen=r[3],
            is_agent=r[0] in current_agents,
        )
        for r in rows
    ]
    out.sort(key=lambda s: s.message_count, reverse=True)
    return out


@router.post("/senders/{tg_id}/recompute-role")
def recompute_sender_role(tg_id: int, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Пересчитывает sender_type всех сообщений этого tg_id под его ТЕКУЩИЙ
    статус в agent_tg_ids — работает в обе стороны: добавили в агенты
    задним числом — прошлые сообщения станут "agent"; убрали из
    агентов — наоборот, вернутся в "client". У всех затронутых тикетов
    first_response_at пересчитывается полностью заново (минимальное время
    среди оставшихся agent-сообщений тикета, либо пусто, если агентских
    сообщений не осталось вовсе) — не просто "поправить, если было пусто",
    а honest full recompute, чтобы отмена ошибочного добавления тоже
    корректно откатывала SLA.
    """
    setting = db.query(models.Setting).get("agent_tg_ids")
    agent_ids = set(setting.value if setting else [])
    target_type = "agent" if tg_id in agent_ids else "client"

    messages = (
        db.query(models.Message)
        .filter(models.Message.sender_tg_id == tg_id, models.Message.sender_type != target_type)
        .all()
    )
    affected_ticket_ids = {m.ticket_id for m in messages if m.ticket_id}
    for m in messages:
        m.sender_type = target_type

    tickets_fixed = 0
    for ticket_id in affected_ticket_ids:
        ticket = db.query(models.Ticket).get(ticket_id)
        earliest_agent_msg = (
            db.query(func.min(models.Message.sent_at))
            .filter(models.Message.ticket_id == ticket_id, models.Message.sender_type == "agent")
            .scalar()
        )
        if ticket.first_response_at != earliest_agent_msg:
            ticket.first_response_at = earliest_agent_msg
            tickets_fixed += 1

    db.commit()
    auth.log_action(db, current_user, "sender.role_recomputed", "sender", tg_id, {"new_role": target_type, "messages_updated": len(messages), "tickets_fixed": tickets_fixed})
    return {"new_role": target_type, "messages_updated": len(messages), "tickets_fixed": tickets_fixed}


@router.post("/senders/fix-by-name")
def fix_role_by_name(payload: schemas.FixRoleByName, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    То же самое, что recompute-role, но по точному совпадению sender_name,
    а не по числовому tg_id. Нужен для сообщений, принятых ДО того, как
    бот стал сохранять sender_tg_id — их recompute-role физически не
    находит (id там просто пустой), а имя в базе всё равно есть.

    Осторожно: совпадение по имени менее надёжно, чем по id (случаются
    полные тёзки) — использовать точечно, когда recompute-role не
    сработал.
    """
    if payload.target_type not in ("agent", "client"):
        raise HTTPException(400, "target_type must be 'agent' or 'client'")

    messages = (
        db.query(models.Message)
        .filter(models.Message.sender_name == payload.sender_name, models.Message.sender_type != payload.target_type)
        .all()
    )
    affected_ticket_ids = {m.ticket_id for m in messages if m.ticket_id}
    for m in messages:
        m.sender_type = payload.target_type

    tickets_fixed = 0
    for ticket_id in affected_ticket_ids:
        ticket = db.query(models.Ticket).get(ticket_id)
        earliest_agent_msg = (
            db.query(func.min(models.Message.sent_at))
            .filter(models.Message.ticket_id == ticket_id, models.Message.sender_type == "agent")
            .scalar()
        )
        if ticket.first_response_at != earliest_agent_msg:
            ticket.first_response_at = earliest_agent_msg
            tickets_fixed += 1

    db.commit()
    auth.log_action(db, current_user, "sender.role_fixed_by_name", "sender", payload.sender_name, {"new_role": payload.target_type, "messages_updated": len(messages), "tickets_fixed": tickets_fixed})
    return {"new_role": payload.target_type, "messages_updated": len(messages), "tickets_fixed": tickets_fixed}


def _next_code(db: Session) -> str:
    last = db.query(models.Ticket).order_by(models.Ticket.id.desc()).first()
    n = 1000 + ((last.id if last else 0) + 1)
    return f"SUP-{n}"


def _ticket_by_reply(db: Session, client_id, reply_to_tg_message_id: Optional[int]) -> Optional[models.Ticket]:
    """
    Самый точный сигнал: если сообщение — Telegram-реплай на конкретное
    сообщение, находим тикет именно того сообщения, без ИИ и без эвристик.
    """
    if not reply_to_tg_message_id:
        return None
    msg = (
        db.query(models.Message)
        .filter(models.Message.client_id == client_id, models.Message.tg_message_id == reply_to_tg_message_id)
        .first()
    )
    if not msg or not msg.ticket_id:
        return None
    return db.query(models.Ticket).get(msg.ticket_id)


def _open_ticket_by_category(db: Session, client_id, category: str) -> Optional[models.Ticket]:
    return (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == client_id, models.Ticket.status != "closed", models.Ticket.category == category)
        .order_by(models.Ticket.first_message_at.desc())
        .first()
    )


def _most_recent_open_ticket(db: Session, client_id) -> Optional[models.Ticket]:
    return (
        db.query(models.Ticket)
        .filter(models.Ticket.client_id == client_id, models.Ticket.status != "closed")
        .order_by(models.Ticket.first_message_at.desc())
        .first()
    )


@router.post("/message", response_model=schemas.IngestResult)
def ingest_message(payload: schemas.IngestMessage, db: Session = Depends(get_db)):
    """
    Маршрутизация сообщения к тикету — по приоритету:

    1. Явный Telegram-реплай на конкретное сообщение — однозначно определяет
       тикет, без обращения к ИИ. Реплай на уже закрытый тикет открывает
       его заново (явный сигнал, что клиент вернулся к этой теме).
    2. Сообщение клиента без реплая, категоризация реальным ИИ — ищется
       открытый тикет этого же клиента с такой же категорией; если нет —
       заводится новый. Так разные темы в одном чате не схлопываются в
       один тикет, даже если клиент пишет о них вперемешку.
    2а. Сообщение клиента без реплая, но ИИ недоступен (ни один провайдер
       не ответил — нет ключа, исчерпан лимит, сеть) — работает эвристика
       по ключевым словам, а она путает темы куда чаще настоящего ИИ.
       Чтобы не дробить один разговор на несколько тикетов из-за случайного
       расхождения эвристики между соседними сообщениями — в этом случае
       матчинг по категории не используется вообще, сообщение уходит в
       последний открытый тикет клиента (если такого нет — заводится
       новый, как обычно).
    3. Сообщение агента без реплая — фолбэк на последний активный открытый
       тикет клиента: если тем несколько параллельно и агент не указал
       реплаем, к какой отвечает, точнее определить нечем.
    """
    client = db.query(models.Client).filter(models.Client.tg_group_id == payload.tg_group_id).first()
    if not client:
        raise HTTPException(404, "Unknown tg_group_id — сначала синхронизируйте клиента через /clients/sync")

    ticket = _ticket_by_reply(db, client.id, payload.reply_to_tg_message_id)
    if ticket and ticket.status == "closed":
        ticket.status = "open"  # реплай на закрытый тикет — открыть всегда безопасно, "open" разрешён любой версией ограничения

    # Статусные переходы, которые МОГУТ упереться в ограничение схемы БД
    # (например, если модель и база временно разъехались, как уже бывало
    # с waiting_client), откладываем в обычные переменные и применяем
    # ОТДЕЛЬНЫМ commit'ом уже после того, как само сообщение надёжно
    # сохранено — тогда даже при сбое здесь сообщение не потеряется.
    new_status = None
    new_first_response_at = None

    if payload.sender_type == "client":
        if not ticket:
            category, subject, confidence, used_ai = llm.categorize_ticket(db, payload.text)
            if used_ai:
                # Реальный ИИ достаточно надёжен, чтобы различать разные темы в одном
                # чате — матчим по категории (см. docstring выше).
                ticket = _open_ticket_by_category(db, client.id, category)
            else:
                # ИИ недоступен (ключ не задан/лимит/сеть) — работает эвристика по
                # ключевым словам, она куда менее надёжна в различении тем. Чтобы не
                # дробить один разговор на несколько тикетов из-за случайного
                # расхождения эвристики между соседними сообщениями — просто
                # продолжаем последний открытый тикет клиента, если он есть.
                ticket = _most_recent_open_ticket(db, client.id)
            if ticket and ticket.status == "closed":
                ticket.status = "open"
            if not ticket:
                ticket = models.Ticket(
                    code=_next_code(db),
                    client_id=client.id,
                    category=category,
                    status="open",
                    subject=subject,
                    first_message_at=payload.sent_at,
                    ai_confidence=confidence,
                )
                db.add(ticket)
                db.flush()
        # Новое сообщение клиента по тикету, который ждал именно его ответа —
        # ход снова наш, тикет переоткрывается автоматически.
        if ticket and ticket.status == "waiting_client":
            new_status = "open"
    elif payload.sender_type == "agent":
        if not ticket:
            ticket = _most_recent_open_ticket(db, client.id)
        if ticket and ticket.first_response_at is None:
            new_first_response_at = payload.sent_at
        # Агент ответил — ход переходит к клиенту. Пока клиент не написал
        # снова, SLA-время в этом статусе сознательно не растёт (см.
        # business_hours.ticket_response_status) — простой сейчас не наш.
        if ticket and ticket.status != "closed":
            new_status = "waiting_client"
    else:
        raise HTTPException(400, "sender_type must be 'client' or 'agent'")

    # Сообщение сохраняем ПЕРВЫМ, отдельным commit — это самое важное и
    # должно случиться всегда, даже если ниже что-то пойдёт не так с
    # обновлением статуса тикета (как уже бывало — рассинхрон схемы БД
    # откатывал всю транзакцию целиком, теряя само сообщение вместе со
    # статусом). Такого больше не должно повторяться ни при каких
    # будущих изменениях статусной модели.
    message = models.Message(
        client_id=client.id,
        tg_message_id=payload.tg_message_id,
        sender_type=payload.sender_type,
        sender_name=payload.sender_name,
        sender_tg_id=payload.sender_tg_id,
        text=payload.text,
        sent_at=payload.sent_at,
        ticket_id=ticket.id if ticket else None,
    )
    db.add(message)
    db.commit()

    # Статус и first_response_at — уже во ВТОРОЙ, отдельной транзакции.
    # Если здесь что-то не так (например, будущее несоответствие схемы),
    # сообщение выше уже надёжно сохранено и не пострадает.
    if ticket and (new_status or new_first_response_at):
        if new_first_response_at:
            ticket.first_response_at = new_first_response_at
        if new_status:
            ticket.status = new_status
        try:
            db.commit()
        except Exception as e:
            db.rollback()
            print(f"[ingest] не удалось обновить статус тикета {ticket.id}: {e}")

    return schemas.IngestResult(
        ticket_id=ticket.id if ticket else None,
        ticket_code=ticket.code if ticket else None,
    )
