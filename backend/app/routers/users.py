from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/users", tags=["users"])


def _user_out(u: models.User) -> schemas.UserOut:
    return schemas.UserOut(
        id=u.id, email=u.email, name=u.name, role=u.role, is_active=u.is_active,
        has_password=bool(u.password_hash), has_google=bool(u.google_sub),
        created_at=u.created_at,
    )


@router.get("", response_model=List[schemas.UserOut])
def list_users(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    # Ролевой модели пока нет (сознательно, первый этап) — управление
    # пользователями доступно любому, кто вошёл в систему.
    users = db.query(models.User).order_by(models.User.created_at).all()
    return [_user_out(u) for u in users]


@router.post("", response_model=schemas.UserOut, status_code=201)
def create_user(payload: schemas.UserCreate, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    email = payload.email.lower().strip()
    if db.query(models.User).filter(models.User.email == email).first():
        raise HTTPException(409, f"Пользователь с email {email} уже существует")
    if len(payload.password) < 8:
        raise HTTPException(400, "Пароль должен быть не короче 8 символов")

    user = models.User(email=email, name=payload.name.strip(), password_hash=auth.hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    auth.log_action(db, current_user, "user.created", "user", user.id, {"email": email})
    return _user_out(user)


@router.patch("/{user_id}/deactivate", response_model=schemas.UserOut)
def deactivate_user(user_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if user.id == current_user.id:
        raise HTTPException(400, "Нельзя деактивировать самого себя")
    user.is_active = False
    db.commit()
    auth.log_action(db, current_user, "user.deactivated", "user", user.id)
    return _user_out(user)


@router.patch("/{user_id}/activate", response_model=schemas.UserOut)
def activate_user(user_id: str, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    user.is_active = True
    db.commit()
    auth.log_action(db, current_user, "user.activated", "user", user.id)
    return _user_out(user)


@router.post("/{user_id}/reset-password", response_model=schemas.UserOut)
def admin_reset_password(user_id: str, payload: schemas.ChangePasswordRequest, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """Администратор сбрасывает пароль другому пользователю — current_password не проверяется, это не смена своего пароля."""
    user = db.query(models.User).get(user_id)
    if not user:
        raise HTTPException(404, "User not found")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "Пароль должен быть не короче 8 символов")
    user.password_hash = auth.hash_password(payload.new_password)
    db.commit()
    auth.log_action(db, current_user, "user.password_reset_by_admin", "user", user.id)
    return _user_out(user)
