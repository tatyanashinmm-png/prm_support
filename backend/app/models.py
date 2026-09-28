import uuid
from sqlalchemy import (
    Column, String, Boolean, BigInteger, Text, TIMESTAMP, Date, SmallInteger, Float,
    ForeignKey, CheckConstraint, func
)
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from .database import Base


class Client(Base):
    __tablename__ = "clients"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    tg_group_id = Column(BigInteger, nullable=False, unique=True)
    chat_label = Column(String)
    active = Column(Boolean, nullable=False, default=True)
    vip = Column(Boolean, nullable=False, default=False)
    tariff_name = Column(String)   # приходит с Oracle-синка, без хардкода на фронте
    tariff_price = Column(String)  # строка — формат цены задаёт Oracle, не парсим здесь
    connected_at = Column(Date)    # дата подключения (SERVICE_DT_START) — по ней отличаем
                                    # "новых" от "действующих" в аналитике, тоже с Oracle-синка
    billing_contract_id = Column(String)      # ID_CONTRACT_INST — id подписки в биллинге
    billing_contract_number = Column(String)  # V_EXT_IDENT — номер подписки
    subscription_status = Column(String)      # V_SERVICE_STATUS — статус подписки
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    tickets = relationship("Ticket", back_populates="client")


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    code = Column(String, unique=True, nullable=False)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False, index=True)
    category = Column(String, nullable=False)
    status = Column(String, nullable=False, default="open", index=True)
    subject = Column(Text, nullable=False)
    first_message_at = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    first_response_at = Column(TIMESTAMP(timezone=True))
    closed_at = Column(TIMESTAMP(timezone=True))
    ai_confidence = Column(SmallInteger)
    promise_text = Column(Text)
    comment = Column(Text)  # свободный комментарий к обращению (отдельно от обещания клиенту)
    jira_url = Column(String)
    due_date = Column(Date)
    is_paid_work = Column(Boolean, nullable=False, default=False)
    planned_cost = Column(String)    # свободный формат суммы — как tariff_price у клиента
    actual_hours = Column(Float)
    actual_cost = Column(String)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    agent_seen_at = Column(TIMESTAMP(timezone=True))  # когда агент в последний раз отметил "прочитано" —
                                                        # отдельно от факта ответа, только чтобы гасить чип "N новых"

    client = relationship("Client", back_populates="tickets")

    __table_args__ = (
        CheckConstraint("status in ('open','waiting_client','pending_confirm','closed')", name="ck_tickets_status"),
    )


class Message(Base):
    __tablename__ = "messages"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    client_id = Column(UUID(as_uuid=True), ForeignKey("clients.id"), nullable=False, index=True)
    tg_message_id = Column(BigInteger, nullable=False)
    sender_type = Column(String, nullable=False)
    sender_name = Column(String)
    sender_tg_id = Column(BigInteger)  # числовой id отправителя в Telegram — по нему, а не по
                                        # имени, добавляют в список агентов (имя ненадёжно)
    text = Column(Text, nullable=False)
    sent_at = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    ticket_id = Column(BigInteger, ForeignKey("tickets.id"), nullable=True, index=True)

    __table_args__ = (
        CheckConstraint("sender_type in ('client','agent')", name="ck_messages_sender_type"),
    )


class DailySummary(Base):
    __tablename__ = "daily_summaries"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    summary_date = Column(Date, nullable=False, unique=True)
    summary_text = Column(Text, nullable=False)
    model_used = Column(String, nullable=False)
    generated_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    sent_at = Column(TIMESTAMP(timezone=True))


class Setting(Base):
    __tablename__ = "settings"

    key = Column(String, primary_key=True)
    value = Column(JSONB, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, nullable=False, unique=True, index=True)
    name = Column(String, nullable=False)
    password_hash = Column(String)   # null — вход только через Google
    google_sub = Column(String, unique=True)  # null — вход только по паролю
    role = Column(String, nullable=False, default="user")  # задел на будущую ролевую модель — сейчас не используется
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    __table_args__ = (
        CheckConstraint("password_hash is not null or google_sub is not null", name="ck_users_has_login_method"),
    )


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)  # null — действие бота/системы
    user_email = Column(String)  # дублируем на момент записи — не теряем контекст, если юзера потом удалят
    action = Column(String, nullable=False)         # напр. "ticket.status_changed"
    target_type = Column(String)                     # напр. "ticket"
    target_id = Column(String)                        # строкой — id тикета (int) и клиента (UUID) вперемешку
    details = Column(JSONB)                            # что именно изменилось
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), index=True)
