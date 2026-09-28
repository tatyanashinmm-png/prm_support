from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/categories", tags=["categories"])

# Базовый набор, чтобы список не был пустым на свежей базе. Любая категория,
# вписанная вручную в панели тикета, сохраняется в tickets.category и сама
# появляется здесь при следующем запросе — отдельного хранилища категорий не
# заводили специально, чтобы не дублировать источник правды.
DEFAULTS = ["Биллинг", "Баг", "Настройка", "Вопрос по функционалу", "Интеграция", "Доработка"]


@router.get("", response_model=List[str])
def list_categories(db: Session = Depends(get_db)):
    rows = db.query(models.Ticket.category).distinct().all()
    used = {r[0] for r in rows if r[0]}
    merged = sorted(used | set(DEFAULTS))
    return merged


@router.patch("/rename")
def rename_category(payload: schemas.CategoryRename, db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    """
    Раз отдельной таблицы категорий нет (источник правды — tickets.category),
    "переименовать категорию" значит массово обновить category у всех тикетов
    с этим значением. Затрагивает всю историю, включая закрытые тикеты.
    """
    old_name, new_name = payload.old_name.strip(), payload.new_name.strip()
    if not new_name:
        raise HTTPException(400, "Новое название не может быть пустым")
    if old_name == new_name:
        return {"updated": 0}

    count = (
        db.query(models.Ticket)
        .filter(models.Ticket.category == old_name)
        .update({"category": new_name}, synchronize_session=False)
    )
    db.commit()
    auth.log_action(db, current_user, "category.renamed", "category", None, {"old_name": old_name, "new_name": new_name, "tickets_updated": count})
    return {"updated": count}
