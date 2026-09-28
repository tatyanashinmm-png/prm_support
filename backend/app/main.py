from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from .database import Base, engine
from .routers import clients, tickets, settings as settings_router, digest, promises, ingest, categories, metrics, auth as auth_router, users, audit
from . import auth
from . import scheduler as scheduler_module

Base.metadata.create_all(bind=engine)


@asynccontextmanager
async def lifespan(app: FastAPI):
    scheduler_module.start()
    yield
    scheduler_module.stop()


app = FastAPI(title="Support Desk API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=500)  # сжимаем ответы от 500 байт — меньше байт по медленному каналу

# /auth/login и /auth/google — единственные публичные ручки авторизации
# (иначе войти было бы нечем); /auth/me и /auth/change-password защищены
# по отдельности внутри самого роутера.
app.include_router(auth_router.router)

# ingest.router НЕ защищаем на уровне роутера целиком — /ingest/message
# вызывает bot-collector, а не залогиненный пользователь из браузера, у
# него нет и не будет JWT. Три "административных" ручки внутри
# (senders/*) защищены индивидуально, прямо в ingest.py.
app.include_router(ingest.router)

_protected = [Depends(auth.get_current_user)]
app.include_router(clients.router, dependencies=_protected)
app.include_router(tickets.router, dependencies=_protected)
app.include_router(settings_router.router, dependencies=_protected)
app.include_router(digest.router, dependencies=_protected)
app.include_router(promises.router, dependencies=_protected)
app.include_router(categories.router, dependencies=_protected)
app.include_router(metrics.router, dependencies=_protected)
app.include_router(users.router, dependencies=_protected)
app.include_router(audit.router, dependencies=_protected)


@app.get("/health")
def health():
    return {"status": "ok"}
