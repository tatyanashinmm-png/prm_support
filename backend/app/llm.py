"""
LLM-адаптер: OpenAI-совместимый клиент с оркестрацией по нескольким
провайдерам. Настройки хранятся в /settings под ключом ai_providers —
список {provider, model, api_key, enabled} в порядке приоритета.

_chat() пробует включённых провайдеров по очереди сверху вниз: если у
провайдера пустой ключ, он выключен (enabled=false) или запрос упал
(сеть, невалидный ключ, превышен лимит — 429 и т.п.) — переходим к
следующему. Если ни один не ответил (или список пуст) — все функции
переключаются на простые эвристики-заглушки, чтобы приложение оставалось
рабочим без единого настроенного провайдера.
"""
import json
from typing import Optional, Tuple

import httpx
from sqlalchemy.orm import Session

from . import models

PROVIDER_BASE_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
    "groq": "https://api.groq.com/openai/v1",
    "openrouter": "https://openrouter.ai/api/v1",
}

CATEGORIES = ["Биллинг", "Баг", "Настройка", "Вопрос по функционалу", "Интеграция"]


def get_ai_providers(db: Session) -> list:
    from .routers.settings import DEFAULTS
    rows = {row.key: row.value for row in db.query(models.Setting).all()}
    cfg = {**DEFAULTS, **rows}
    return cfg.get("ai_providers") or DEFAULTS["ai_providers"]


def get_prompts(db: Session) -> dict:
    """Промпты редактируются через общий PATCH /settings (ключи prompt_*),
    отдельного эндпоинта под них нет — это те же настройки."""
    from .routers.settings import DEFAULTS
    rows = {row.key: row.value for row in db.query(models.Setting).all()}
    cfg = {**DEFAULTS, **rows}
    return {
        "categorize": cfg.get("prompt_categorize", DEFAULTS["prompt_categorize"]),
        "autoclose": cfg.get("prompt_autoclose", DEFAULTS["prompt_autoclose"]),
        "summary": cfg.get("prompt_summary", DEFAULTS["prompt_summary"]),
    }


def _chat(db: Session, system: str, user: str, json_mode: bool = True) -> Optional[str]:
    providers = get_ai_providers(db)

    for p in providers:
        if not p.get("enabled") or not p.get("api_key"):
            continue

        base_url = PROVIDER_BASE_URLS.get(p.get("provider"), PROVIDER_BASE_URLS["gemini"])
        payload = {
            "model": p.get("model"),
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0.2,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}

        try:
            resp = httpx.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {p['api_key']}"},
                json=payload,
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()
            return data["choices"][0]["message"]["content"]
        except Exception as e:  # сеть, лимиты, невалидный ключ — пробуем следующего провайдера
            print(f"[llm] {p.get('provider')} не ответил ({e}) — пробую следующего провайдера")
            continue

    return None  # ни один провайдер не настроен/не ответил — вызывающая функция использует эвристику


def categorize_ticket(db: Session, text: str) -> Tuple[str, str, int, bool]:
    """Возвращает (category, subject, confidence 0-100, used_ai)."""
    system = get_prompts(db)["categorize"]
    raw = _chat(db, system, text)
    if raw:
        try:
            data = json.loads(raw)
            category = data.get("category") if data.get("category") in CATEGORIES else "Вопрос по функционалу"
            subject = (data.get("subject") or text[:80]).strip()
            confidence = max(0, min(100, int(data.get("confidence", 70))))
            return category, subject, confidence, True
        except Exception as e:
            print(f"[llm] не смог распарсить ответ категоризации: {e}")

    category, subject, confidence = _fallback_categorize(text)
    return category, subject, confidence, False


def _fallback_categorize(text: str) -> Tuple[str, str, int]:
    """Эвристика по ключевым словам — используется, когда ключ ИИ не настроен."""
    t = text.lower()
    rules = [
        (["счёт", "счет", "оплат", "тариф", "биллинг", "документ"], "Биллинг"),
        (["ошибк", "баг", "не работает", "сломал", "глюч", "не приходит"], "Баг"),
        (["настро", "права доступа", "автоответ", "шаблон"], "Настройка"),
        (["интеграц", "вебхук", "api", "1с", "ключ"], "Интеграция"),
    ]
    for keywords, category in rules:
        if any(k in t for k in keywords):
            return category, text[:80], 55
    return "Вопрос по функционалу", text[:80], 40


def suggest_close(db: Session, ticket_text: str, minutes_idle: int) -> Tuple[bool, int, str]:
    """Возвращает (should_close, confidence 0-100, reason)."""
    system = get_prompts(db)["autoclose"]
    user = f"Сообщение клиента: {ticket_text}\nПростой после ответа агента: {minutes_idle} мин."
    raw = _chat(db, system, user)
    if raw:
        try:
            data = json.loads(raw)
            return bool(data.get("should_close")), max(0, min(100, int(data.get("confidence", 60)))), data.get("reason", "")
        except Exception as e:
            print(f"[llm] не смог распарсить ответ автозакрытия: {e}")

    confidence = min(95, 50 + minutes_idle // 10)
    return minutes_idle >= 120, confidence, "Эвристика: долгая тишина после ответа агента (ключ ИИ не настроен)"


def generate_daily_summary(db: Session, stats: dict) -> str:
    system = get_prompts(db)["summary"]
    user = json.dumps(stats, ensure_ascii=False)
    raw = _chat(db, system, user, json_mode=False)
    if raw:
        return raw.strip()
    return _fallback_summary(stats)


def _fallback_summary(stats: dict) -> str:
    return (
        f"За {stats.get('date')} поступило {stats.get('total', 0)} обращений. "
        f"Открыто на конец дня: {stats.get('open_count', 0)}. "
        f"Закрыто: {stats.get('closed_count', 0)}. "
        "Ключ ИИ-провайдера не настроен в /settings, поэтому сводка сформирована по шаблону "
        "без анализа тем и проблемных клиентов — заполните ai_api_key, чтобы получать полноценный текст."
    )
