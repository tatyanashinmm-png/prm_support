"""
Сидинг тестовыми данными для локальной разработки.
Запуск: docker-compose exec backend python -m app.seed
"""
import random
from datetime import datetime, timedelta, timezone
from .database import SessionLocal, Base, engine
from . import models

CATEGORIES = ["Биллинг", "Баг", "Настройка", "Вопрос по функционалу", "Интеграция"]
PHRASES = {
    "Биллинг": ["Не сошлась сумма в счёте", "Вопрос по переходу на другой тариф", "Просят закрывающие документы"],
    "Баг": ["Дублируются записи в списке", "Не приходят уведомления", "Ошибка при экспорте отчёта"],
    "Настройка": ["Помочь настроить права доступа", "Настроить шаблон уведомлений", "Вопрос по автоответам"],
    "Вопрос по функционалу": ["Как добавить второго администратора", "Уточнение по лимитам", "Можно ли ограничить видимость раздела"],
    "Интеграция": ["Вебхук перестал присылать статусы", "Не тянутся заказы из 1С", "Вопрос по API-ключу"],
}
CLIENTS = [
    ("Северный Логистик", -100281773),
    ("Вектор Ритейл", -100394821),
    ("ФинГрупп", -100558102),
    ("Атлас Строй", -100669917),
    ("Кристалл Мед", -100772240),
]


def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if db.query(models.Client).count() > 0:
            print("Seed skipped: данные уже есть")
            return

        clients = []
        now = datetime.now(timezone.utc)
        for i, (name, gid) in enumerate(CLIENTS):
            c = models.Client(
                name=name,
                tg_group_id=gid,
                chat_label=name[:10],
                vip=(i in (0, 3)),  # пара VIP для теста фильтра
                tariff_name="Прайм" if i in (0, 3) else ("Стандарт" if i % 2 == 0 else None),
                tariff_price="25 000 ₽" if i in (0, 3) else ("12 000 ₽" if i % 2 == 0 else None),
                connected_at=(now - timedelta(days=25 if i == 4 else 300 + i * 40)).date(),
            )
            db.add(c)
            clients.append(c)
        db.flush()

        code_n = 1000

        for c in clients:
            n_tickets = random.randint(15, 30)
            for _ in range(n_tickets):
                days_ago = random.randint(0, 90)
                category = random.choice(CATEGORIES)
                subject = random.choice(PHRASES[category])
                first_msg = now - timedelta(days=days_ago, minutes=random.randint(0, 500))
                wait_min = random.randint(3, 55)
                roll = random.random()
                code_n += 1

                if roll < 0.75:
                    status = "closed"
                    first_resp = first_msg + timedelta(minutes=wait_min)
                    closed_at = first_resp + timedelta(hours=random.randint(1, 20))
                elif roll < 0.9:
                    status = "open"
                    first_resp = first_msg + timedelta(minutes=wait_min) if random.random() < 0.6 else None
                    closed_at = None
                else:
                    status = "pending_confirm"
                    first_resp = first_msg + timedelta(minutes=wait_min)
                    closed_at = None

                is_paid = random.random() < 0.18
                t = models.Ticket(
                    code=f"SUP-{code_n}",
                    client_id=c.id,
                    category=category,
                    status=status,
                    subject=subject,
                    first_message_at=first_msg,
                    first_response_at=first_resp,
                    closed_at=closed_at,
                    ai_confidence=random.randint(78, 98),
                    jira_url=f"SUP-{800 + random.randint(0, 200)}" if random.random() < 0.2 else None,
                    due_date=(now + timedelta(days=random.randint(-2, 5))).date() if random.random() < 0.15 else None,
                    is_paid_work=is_paid,
                    planned_cost=f"{random.randint(5, 40) * 1000} ₽" if is_paid else None,
                    actual_hours=round(random.uniform(1, 20), 1) if is_paid and status == "closed" else None,
                    actual_cost=f"{random.randint(5, 45) * 1000} ₽" if is_paid and status == "closed" else None,
                )
                db.add(t)

        db.commit()
        print(f"Seed done: {len(clients)} клиентов")
    finally:
        db.close()


if __name__ == "__main__":
    run()
