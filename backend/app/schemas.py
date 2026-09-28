from datetime import datetime, date
from typing import Optional, List
from uuid import UUID
from pydantic import BaseModel, ConfigDict


class ClientOut(BaseModel):
    id: UUID
    name: str
    tg_group_id: int
    chat_label: Optional[str] = None
    vip: bool = False
    tariff_name: Optional[str] = None
    tariff_price: Optional[str] = None
    connected_at: Optional[date] = None
    is_new_client: bool = False  # connected_at младше NEW_CLIENT_THRESHOLD_DAYS (см. clients.py)
    billing_contract_id: Optional[str] = None
    billing_contract_number: Optional[str] = None
    subscription_status: Optional[str] = None
    open_count: int
    ticket_count: int
    avg_response_min: int
    closed_rate: float

    model_config = ConfigDict(from_attributes=True)


class ClientUpdate(BaseModel):
    vip: Optional[bool] = None
    chat_label: Optional[str] = None
    name: Optional[str] = None
    tariff_name: Optional[str] = None
    subscription_status: Optional[str] = None


class ClientCreate(BaseModel):
    name: str
    tg_group_id: int
    chat_label: Optional[str] = None
    vip: bool = False
    tariff_name: Optional[str] = None
    tariff_price: Optional[str] = None
    connected_at: Optional[date] = None
    billing_contract_id: Optional[str] = None
    billing_contract_number: Optional[str] = None
    subscription_status: Optional[str] = None


class TelegramInfoOut(BaseModel):
    ok: bool
    title: Optional[str] = None
    error: Optional[str] = None


class TicketOut(BaseModel):
    id: int
    code: str
    client_id: UUID
    category: str
    status: str
    subject: str
    first_message_at: datetime
    first_response_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    ai_confidence: Optional[int] = None
    promise_text: Optional[str] = None
    comment: Optional[str] = None
    jira_url: Optional[str] = None
    due_date: Optional[date] = None
    is_paid_work: bool = False
    planned_cost: Optional[str] = None
    actual_hours: Optional[float] = None
    actual_cost: Optional[str] = None
    wait_business_min: int = 0  # время ожидания с учётом рабочих часов/выходных/праздников
    response_kind: str = "no_response"  # no_response | waiting_us | waiting_client | closed
    new_message_count: int = 0  # сообщений клиента после последнего ответа агента

    model_config = ConfigDict(from_attributes=True)


class TicketUpdate(BaseModel):
    status: Optional[str] = None
    promise_text: Optional[str] = None
    comment: Optional[str] = None
    jira_url: Optional[str] = None
    due_date: Optional[date] = None
    category: Optional[str] = None
    subject: Optional[str] = None
    is_paid_work: Optional[bool] = None
    planned_cost: Optional[str] = None
    actual_hours: Optional[float] = None
    actual_cost: Optional[str] = None


class TicketCreate(BaseModel):
    client_id: UUID
    category: str
    subject: str
    status: str = "open"
    promise_text: Optional[str] = None
    comment: Optional[str] = None
    jira_url: Optional[str] = None
    due_date: Optional[date] = None
    is_paid_work: bool = False
    planned_cost: Optional[str] = None


class TicketMerge(BaseModel):
    keep_ticket_id: int    # этот тикет останется, в него переедет переписка
    merge_ticket_id: int   # этот будет удалён после переноса


class TicketSplit(BaseModel):
    message_ids: List[int]           # какие сообщения текущего тикета вынести в новый
    category: Optional[str] = None   # по умолчанию — категория исходного тикета
    subject: Optional[str] = None    # по умолчанию — текст первого перенесённого сообщения
    mode: str = "move"               # "move" — переносит сообщения, "copy" — дублирует, исходные остаются


class CategoryRename(BaseModel):
    old_name: str
    new_name: str


class CategoryStat(BaseModel):
    category: str
    avg_per_month: float
    avg_response_min: int


class SyncClientItem(BaseModel):
    name: str
    tg_group_id: int
    chat_label: Optional[str] = None
    tariff_name: Optional[str] = None
    tariff_price: Optional[str] = None
    connected_at: Optional[date] = None
    billing_contract_id: Optional[str] = None
    billing_contract_number: Optional[str] = None
    subscription_status: Optional[str] = None


class SyncPayload(BaseModel):
    clients: List[SyncClientItem]


class SyncResult(BaseModel):
    created: int
    updated: int


class DigestOut(BaseModel):
    date: date
    total: int
    open_count: int
    closed_count: int
    summary_text: Optional[str] = None


class PromiseOut(BaseModel):
    ticket_id: int
    code: str
    client_id: UUID
    text: str
    category: str
    status: str
    is_paid_work: bool = False
    due_date: Optional[date] = None
    jira_url: Optional[str] = None
    bucket: str


class IngestMessage(BaseModel):
    tg_group_id: int
    tg_message_id: int
    sender_type: str
    sender_name: Optional[str] = None
    sender_tg_id: Optional[int] = None
    text: str
    sent_at: datetime
    reply_to_tg_message_id: Optional[int] = None


class IngestResult(BaseModel):
    ticket_id: Optional[int] = None
    ticket_code: Optional[str] = None


class MessageOut(BaseModel):
    id: int
    sender_type: str
    sender_name: Optional[str] = None
    sender_tg_id: Optional[int] = None
    text: str
    sent_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SenderInfo(BaseModel):
    sender_tg_id: int
    sender_name: Optional[str] = None
    message_count: int
    last_seen: datetime
    is_agent: bool  # уже в списке агентов сейчас, или ещё нет


class FixRoleByName(BaseModel):
    sender_name: str
    target_type: str  # "agent" | "client"


class ActiveChatItem(BaseModel):
    client_id: UUID
    client_name: str
    message_count: int
    last_message_at: datetime


class ActiveChatsOut(BaseModel):
    count: int
    chats: List[ActiveChatItem]


class ClientPeriodDelta(BaseModel):
    client_id: UUID
    client_name: str
    bucket: str  # "new" | "active" | "churned"
    current_count: int
    previous_count: int
    delta: int


class CategoryPeriodDelta(BaseModel):
    category: str
    current_count: int
    previous_count: int


class PeriodComparisonOut(BaseModel):
    current_start: date
    current_end: date
    previous_start: date
    previous_end: date
    current_total: int
    previous_total: int
    delta: int
    delta_pct: Optional[float] = None
    new_clients_delta: int
    active_clients_delta: int
    churned_delta: int
    clients: List[ClientPeriodDelta]
    categories: List[CategoryPeriodDelta]


# ---------- Авторизация ----------

class UserOut(BaseModel):
    id: UUID
    email: str
    name: str
    role: str
    is_active: bool
    has_password: bool
    has_google: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    email: str
    name: str
    password: str


class LoginRequest(BaseModel):
    email: str
    password: str


class GoogleLoginRequest(BaseModel):
    id_token: str


class TokenResponse(BaseModel):
    access_token: str
    user: UserOut


class ChangePasswordRequest(BaseModel):
    current_password: Optional[str] = None  # не требуется, если у пользователя ещё нет пароля (только Google)
    new_password: str


class AuditLogOut(BaseModel):
    id: int
    user_email: Optional[str] = None
    action: str
    target_type: Optional[str] = None
    target_id: Optional[str] = None
    details: Optional[dict] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)
