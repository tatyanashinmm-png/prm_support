from typing import Dict, Any
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from .. import models, auth
from ..database import get_db

router = APIRouter(prefix="/settings", tags=["settings"])

DEFAULTS: Dict[str, Any] = {
    "google_client_id": "",
    "ai_providers": [
        {"provider": "gemini", "model": "gemini-2.5-flash-lite", "api_key": "", "enabled": True},
        {"provider": "groq", "model": "llama-3.3-70b-versatile", "api_key": "", "enabled": False},
        {"provider": "openrouter", "model": "deepseek-v4", "api_key": "", "enabled": False},
    ],
    "bot_collector_token": "",
    "bot_digest_token": "",
    "agent_tg_ids": [],
    "target_first_response_min": 20,
    "attention_after_min": 45,
    "auto_confidence_pct": 85,
    "auto_close": True,
    "auto_promise": True,
    "daily_digest": True,
    "daily_digest_hour": 23,
    "daily_digest_minute": 0,
    "remind_before_due": False,
    "work_hours_start": "09:00",
    "work_hours_end": "18:00",
    "work_days": [0, 1, 2, 3, 4],  # 0=понедельник..6=воскресенье
    "holidays": [],  # список ISO-дат "YYYY-MM-DD"
    "oracle_sql": (
        "select ID_CONTRACT_INST, V_EXT_IDENT, V_LONG_TITLE, VID_GROUP,\n"
        "       SERVICE_DT_START, TARIFF_PLAN_NAME, V_SERVICE_STATUS\n"
        "  from billing.v_client_subscriptions\n"
        " where SERVICE_NAME = 'Доступ к платформе PRMOnline'"
    ),
    "oracle_sync_requested": False,  # ставит фронт кнопкой «Запустить синхронизацию», агент подхватывает и сбрасывает
    "oracle_last_sync": None,  # ISO-время последнего успешного синка, проставляет сам агент
    "jira_base_url": "",
    "prompt_categorize": (
        "Ты — ассистент поддержки B2B-сервиса. По первому сообщению клиента определи "
        "категорию обращения строго из списка: Биллинг, Баг, Настройка, Вопрос по "
        "функционалу, Интеграция. Сформулируй краткую тему (до 10 слов) на русском. "
        'Ответь строго JSON: {"category": "...", "subject": "...", "confidence": 0-100}'
    ),
    "prompt_autoclose": (
        "Ты помогаешь определить, решён ли вопрос клиента в поддержке. По тексту "
        "первого сообщения и времени простоя после ответа агента оцени, можно ли "
        'закрыть обращение. Ответь строго JSON: {"should_close": true/false, '
        '"confidence": 0-100, "reason": "..."}'
    ),
    "prompt_summary": (
        "Ты — ассистент поддержки. Напиши короткую (4-6 предложений) дневную сводку "
        "на русском для менеджера поддержки по статистике обращений за день: сколько "
        "обращений, сколько открыто на конец дня, самые частые категории, проблемные "
        "клиенты (если видно из данных). Пиши по-деловому, без воды и без "
        "markdown-разметки."
    ),
}


@router.get("")
def get_settings(db: Session = Depends(get_db)):
    rows = db.query(models.Setting).all()
    values = {row.key: row.value for row in rows}
    return {**DEFAULTS, **values}


@router.patch("")
def update_settings(payload: Dict[str, Any], db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    for key, value in payload.items():
        row = db.query(models.Setting).get(key)
        if row:
            row.value = value
        else:
            db.add(models.Setting(key=key, value=value))
    db.commit()
    # Только НАЗВАНИЯ изменённых ключей — не значения: там бывают API-ключи
    # провайдеров, пароль Oracle и т.п., им не место в журнале действий.
    auth.log_action(db, current_user, "settings.updated", "settings", None, {"changed_keys": list(payload.keys())})
    rows = db.query(models.Setting).all()
    values = {row.key: row.value for row in rows}
    return {**DEFAULTS, **values}


@router.post("/test-key")
def test_key():
    # Реальная проверка ключа у провайдера подключится вместе с LLM-адаптером
    return {"status": "stub", "ok": True, "detail": "Проверка ключа подключится в модуле LLM-конвейера"}
