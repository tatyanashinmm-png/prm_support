"""
bot-collector — слушает групповые чаты поддержки клиентов в Telegram и
пересылает каждое сообщение в backend (POST /ingest/message).

Токен и список id агентов НЕ задаются переменными окружения — оба хранятся
в /settings (ключи bot_collector_token, agent_tg_ids) и правятся через тот
же API/фронт, что и ключ ИИ. Процесс раз в TOKEN_POLL_INTERVAL_SEC секунд
опрашивает /settings: список агентов подхватывается на лету, а при смене
токена бот сам разрывает старое соединение и переподключается — контейнер
перезапускать не нужно ни для того, ни для другого.
"""
import asyncio
import logging
from datetime import timezone
from typing import Optional, Set, Tuple

import httpx
from aiogram import Bot, Dispatcher
from aiogram.enums import ChatType
from aiogram.types import Message

from config import BACKEND_URL, TOKEN_POLL_INTERVAL_SEC, BOT_SERVICE_KEY

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("bot-collector")

dp = Dispatcher()

# Обновляется супервизором на каждом цикле опроса /settings, читается хендлером
current_agent_ids: Set[int] = set()


async def send_to_backend(payload: dict):
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(f"{BACKEND_URL}/ingest/message", json=payload)

            if resp.status_code == 404:
                log.warning(
                    "Группа %s ещё не синхронизирована в backend (нет клиента с таким "
                    "tg_group_id) — сообщение пропущено. Зарегистрируйте клиента через "
                    "POST /clients/sync с этим tg_group_id.",
                    payload["tg_group_id"],
                )
                return

            resp.raise_for_status()
            data = resp.json()
            log.info("Обработано: тикет %s (id=%s)", data.get("ticket_code"), data.get("ticket_id"))

        except httpx.RequestError as e:
            log.error("Не удалось достучаться до backend (%s): %s", BACKEND_URL, e)
        except httpx.HTTPStatusError as e:
            log.error("Backend вернул ошибку %s: %s", e.response.status_code, e.response.text)


@dp.message()
async def handle_message(message: Message):
    if message.chat.type not in (ChatType.GROUP, ChatType.SUPERGROUP):
        return  # бот работает только в групповых чатах поддержки

    # У пересланного файла/фото с подписью текст лежит в caption, а не в text —
    # раньше такие сообщения тихо пропускались целиком, вместе с самой подписью.
    text = message.text or message.caption
    if not text:
        logging.info(
            "пропущено сообщение без текста и подписи (стикер/файл без подписи и т.п.), "
            "chat_id=%s message_id=%s", message.chat.id, message.message_id,
        )
        return  # стикеры, голосовые, файлы совсем без подписи — пока не поддерживаем

    is_agent = bool(message.from_user and message.from_user.id in current_agent_ids)

    payload = {
        "tg_group_id": message.chat.id,
        "tg_message_id": message.message_id,
        "sender_type": "agent" if is_agent else "client",
        "sender_name": message.from_user.full_name if message.from_user else None,
        "sender_tg_id": message.from_user.id if message.from_user else None,
        "text": text,
        "sent_at": message.date.astimezone(timezone.utc).isoformat(),
        "reply_to_tg_message_id": message.reply_to_message.message_id if message.reply_to_message else None,
    }
    await send_to_backend(payload)


async def fetch_settings() -> Optional[Tuple[str, Set[int]]]:
    """Возвращает (token, agent_ids) или None, если получить настройки не
    удалось (backend недоступен, неверный ключ и т.п.). None — сигнал
    супервизору НЕ трогать текущее соединение с Telegram: раньше при любой
    ошибке возвращался пустой токен, и бот сам себя отключал."""
    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get(f"{BACKEND_URL}/ingest/bot-config", headers={"X-Bot-Key": BOT_SERVICE_KEY})
            resp.raise_for_status()
            data = resp.json()
            token = (data.get("bot_collector_token") or "").strip()
            raw_ids = data.get("agent_tg_ids") or []
            if isinstance(raw_ids, (int, str)):
                raw_ids = [raw_ids]  # прислали одно число/строку вместо списка — не роняем бота
            agent_ids = {int(x) for x in raw_ids}
            return token, agent_ids
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                log.error("backend отклонил ключ бота (401): проверьте, что BOT_SERVICE_KEY одинаковый у backend и bot-collector (.env + пересборка)")
            else:
                log.error("backend вернул ошибку %s на /ingest/bot-config", e.response.status_code)
            return None
        except httpx.RequestError as e:
            log.error("Не удалось получить настройки у backend (%s): %s", BACKEND_URL, e)
            return None
        except (TypeError, ValueError) as e:
            log.error("agent_tg_ids в настройках в неверном формате: %s", e)
            return None


async def run_polling(bot: Bot):
    try:
        await dp.start_polling(bot, handle_signals=False)
    except asyncio.CancelledError:
        log.info("Polling остановлен (переподключение с новым токеном)")
        raise


async def supervisor():
    """Следит за /settings: список агентов подхватывается на каждом цикле,
    токен — с переподключением к Telegram при изменении."""
    global current_agent_ids

    current_token = ""
    current_bot: Optional[Bot] = None
    current_task: Optional[asyncio.Task] = None

    while True:
        fetched = await fetch_settings()
        if fetched is None:
            # Настройки не получены — остаёмся как есть (не отключаемся от
            # Telegram из-за временной недоступности backend), пробуем снова.
            await asyncio.sleep(TOKEN_POLL_INTERVAL_SEC)
            continue
        token, agent_ids = fetched

        if agent_ids != current_agent_ids:
            log.info("Список агентов обновлён: %s", sorted(agent_ids))
            current_agent_ids = agent_ids

        if token != current_token:
            if current_task:
                log.info("Токен изменился — останавливаю текущее соединение с Telegram")
                current_task.cancel()
                try:
                    await current_task
                except asyncio.CancelledError:
                    pass
                await current_bot.session.close()
                current_bot, current_task = None, None

            if token:
                current_bot = Bot(token=token)
                current_task = asyncio.create_task(run_polling(current_bot))
                log.info("Подключился к Telegram с новым токеном")
            else:
                log.warning(
                    "bot_collector_token пуст в /settings — бот не подключён к Telegram. "
                    "Впишите токен через PATCH /settings (проверка каждые %sс).",
                    TOKEN_POLL_INTERVAL_SEC,
                )

            current_token = token

        await asyncio.sleep(TOKEN_POLL_INTERVAL_SEC)


async def main():
    log.info(
        "bot-collector запущен. backend=%s, проверка /settings каждые %sс",
        BACKEND_URL, TOKEN_POLL_INTERVAL_SEC,
    )
    await supervisor()


if __name__ == "__main__":
    asyncio.run(main())
