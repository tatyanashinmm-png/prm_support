import os

BACKEND_URL = os.getenv("BACKEND_URL", "http://backend:8000")

# Как часто проверять /settings на предмет смены токена/списка агентов, секунд
TOKEN_POLL_INTERVAL_SEC = int(os.getenv("TOKEN_POLL_INTERVAL_SEC", "20"))

# Общий секрет с backend — по нему бот получает токен и список агентов
# (см. /ingest/bot-config). Задаётся в .env рядом с docker-compose.yml.
BOT_SERVICE_KEY = os.getenv("BOT_SERVICE_KEY", "")
