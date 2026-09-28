import os
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg2://support:support@db:5432/support_desk",
    )
    default_target_first_response_min: int = 20
    default_attention_after_min: int = 45
    default_auto_confidence_pct: int = 85

    class Config:
        env_file = ".env"


settings = Settings()
