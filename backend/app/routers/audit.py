from typing import List, Optional
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .. import models, schemas, auth
from ..database import get_db

router = APIRouter(prefix="/audit-log", tags=["audit"])


@router.get("", response_model=List[schemas.AuditLogOut])
def list_audit_log(
    limit: int = Query(100, le=500),
    offset: int = Query(0),
    user_email: Optional[str] = Query(None),
    action: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    q = db.query(models.AuditLog).order_by(models.AuditLog.created_at.desc())
    if user_email:
        q = q.filter(models.AuditLog.user_email == user_email)
    if action:
        q = q.filter(models.AuditLog.action == action)
    return q.offset(offset).limit(limit).all()


@router.get("/actions", response_model=List[str])
def list_action_types(db: Session = Depends(get_db), current_user: models.User = Depends(auth.get_current_user)):
    rows = db.query(models.AuditLog.action).distinct().all()
    return sorted({r[0] for r in rows})
