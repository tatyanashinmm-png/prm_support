"""
Авторизация: логин/пароль + Google OAuth, JWT-токены (в localStorage на
фронте, не cookie — см. обсуждение), журнал действий.

Секрет для подписи JWT хранится в таблице settings (ключ jwt_secret),
не в переменных окружения — генерируется сам при первом обращении, чтобы
не терять все сессии при каждом redeploy из-за нового случайного секрета
и не требовать отдельной ручной настройки .env.
"""
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Header
from sqlalchemy.orm import Session

from . import models
from .database import get_db

JWT_ALGORITHM = "HS256"
JWT_TTL_HOURS = 24 * 14  # 2 недели — внутренний инструмент, не банк; не хочется, чтобы разлогинивало каждый день


def get_jwt_secret(db: Session) -> str:
    row = db.query(models.Setting).get("jwt_secret")
    if row:
        return row.value
    secret = secrets.token_urlsafe(32)
    db.add(models.Setting(key="jwt_secret", value=secret))
    db.commit()
    return secret


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False  # битый/пустой хэш — не роняем запрос 500-й ошибкой


def create_access_token(db: Session, user: models.User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_TTL_HOURS),
    }
    return jwt.encode(payload, get_jwt_secret(db), algorithm=JWT_ALGORITHM)


def decode_access_token(db: Session, token: str) -> dict:
    try:
        return jwt.decode(token, get_jwt_secret(db), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Сессия истекла, войдите заново")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Недействительный токен")


def get_current_user(
    authorization: Optional[str] = Header(None),
    db: Session = Depends(get_db),
) -> models.User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Не авторизован")
    token = authorization[len("Bearer "):]
    payload = decode_access_token(db, token)
    user = db.query(models.User).get(payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401, "Пользователь не найден или деактивирован")
    return user


def log_action(
    db: Session,
    user: Optional[models.User],
    action: str,
    target_type: str = None,
    target_id: str = None,
    details: dict = None,
):
    """Пишет строку в журнал действий. Вызывать ПОСЛЕ успешного db.commit()
    основного изменения — и коммитится отдельно.

    Журнал — вторичная вещь: любая ошибка записи (например, в details попал
    объект, который не превращается в JSON) НЕ должна ломать само действие
    пользователя, которое к этому моменту уже сохранено. Поэтому details
    приводим к JSON-совместимому виду (date/datetime/UUID -> строки), а любые
    сбои глотаем с откатом и сообщением в лог."""
    try:
        safe_details = json.loads(json.dumps(details, default=str)) if details is not None else None
        entry = models.AuditLog(
            user_id=user.id if user else None,
            user_email=user.email if user else None,
            action=action,
            target_type=target_type,
            target_id=str(target_id) if target_id is not None else None,
            details=safe_details,
        )
        db.add(entry)
        db.commit()
    except Exception as e:  # noqa: BLE001 — журнал не должен ронять запрос
        db.rollback()
        print(f"[audit] не удалось записать действие {action}: {e}")
