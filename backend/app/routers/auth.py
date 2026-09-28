from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from google.oauth2 import id_token as google_id_token
from google.auth.transport import requests as google_requests

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/config")
def auth_config(db: Session = Depends(get_db)):
    """
    Публично (без токена — экрану входа неоткуда его взять) отдаёт только
    сам client_id Google, если вход через Google настроен. client_id не
    секрет — он в любом случае оказывается в JS на странице логина у
    любого сайта с "Войти через Google", секрет — только client_secret,
    а он тут вообще не участвует (используется id_token-флоу, целиком
    на стороне клиента).
    """
    setting = db.query(models.Setting).get("google_client_id")
    return {"google_client_id": setting.value if setting else None}


def _user_out(u: models.User) -> schemas.UserOut:
    return schemas.UserOut(
        id=u.id, email=u.email, name=u.name, role=u.role, is_active=u.is_active,
        has_password=bool(u.password_hash), has_google=bool(u.google_sub),
        created_at=u.created_at,
    )


@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = db.query(models.User).filter(models.User.email == payload.email.lower().strip()).first()
    if not user or not user.password_hash or not auth.verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Неверный email или пароль")
    if not user.is_active:
        raise HTTPException(403, "Учётная запись деактивирована")
    token = auth.create_access_token(db, user)
    auth.log_action(db, user, "auth.login", "user", user.id)
    return schemas.TokenResponse(access_token=token, user=_user_out(user))


@router.post("/google", response_model=schemas.TokenResponse)
def google_login(payload: schemas.GoogleLoginRequest, db: Session = Depends(get_db)):
    setting = db.query(models.Setting).get("google_client_id")
    client_id = setting.value if setting else None
    if not client_id:
        raise HTTPException(400, "Вход через Google не настроен — задайте google_client_id в /settings")

    try:
        info = google_id_token.verify_oauth2_token(payload.id_token, google_requests.Request(), client_id)
    except ValueError:
        raise HTTPException(401, "Не удалось проверить токен Google")

    email = (info.get("email") or "").lower().strip()
    if not email or not info.get("email_verified"):
        raise HTTPException(401, "Google-аккаунт без подтверждённого email")
    google_sub = info["sub"]

    user = db.query(models.User).filter(models.User.google_sub == google_sub).first()
    if not user:
        # Тот же email уже заведён с паролем — просто привязываем Google к нему,
        # не плодим второй аккаунт на тот же адрес.
        user = db.query(models.User).filter(models.User.email == email).first()
        if user:
            user.google_sub = google_sub
        else:
            raise HTTPException(403, "Для этого email нет учётной записи — обратитесь к администратору")

    if not user.is_active:
        raise HTTPException(403, "Учётная запись деактивирована")

    db.commit()
    token = auth.create_access_token(db, user)
    auth.log_action(db, user, "auth.login_google", "user", user.id)
    return schemas.TokenResponse(access_token=token, user=_user_out(user))


@router.get("/me", response_model=schemas.UserOut)
def me(current_user: models.User = Depends(auth.get_current_user)):
    return _user_out(current_user)


@router.post("/change-password")
def change_password(
    payload: schemas.ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.password_hash:
        if not payload.current_password or not auth.verify_password(payload.current_password, current_user.password_hash):
            raise HTTPException(400, "Текущий пароль неверен")
    if len(payload.new_password) < 8:
        raise HTTPException(400, "Пароль должен быть не короче 8 символов")

    current_user.password_hash = auth.hash_password(payload.new_password)
    db.commit()
    auth.log_action(db, current_user, "auth.password_changed", "user", current_user.id)
    return {"status": "ok"}
