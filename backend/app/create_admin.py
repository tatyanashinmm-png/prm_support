"""
Создание первого пользователя — минуя API (все ручки требуют авторизации,
а создавать первого пользователя ещё некому). Запускать внутри контейнера
backend:

    docker compose exec backend python -m app.create_admin email@example.com "Имя Фамилия"

Пароль спросит интерактивно (не через аргумент — не остаётся в истории shell).
"""
import sys
import getpass

from .database import SessionLocal
from . import models, auth


def main():
    if len(sys.argv) != 3:
        print("Использование: python -m app.create_admin email@example.com \"Имя Фамилия\"")
        sys.exit(1)

    email = sys.argv[1].strip().lower()
    name = sys.argv[2].strip()

    password = getpass.getpass("Пароль (не короче 8 символов): ")
    if len(password) < 8:
        print("Пароль должен быть не короче 8 символов")
        sys.exit(1)
    password2 = getpass.getpass("Повторите пароль: ")
    if password != password2:
        print("Пароли не совпадают")
        sys.exit(1)

    db = SessionLocal()
    try:
        existing = db.query(models.User).filter(models.User.email == email).first()
        if existing:
            print(f"Пользователь {email} уже существует")
            sys.exit(1)

        user = models.User(email=email, name=name, password_hash=auth.hash_password(password))
        db.add(user)
        db.commit()
        print(f"Готово: {email} создан.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
