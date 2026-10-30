from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    DEVICE_TOKEN_EXPIRE_DAYS: int = 365
    NURSE_TOKEN_EXPIRE_HOURS: int = 12
    CONFIDENCE_THRESHOLD: float = 0.75
    CLEANING_ALERT_MINUTES: int = 15
    DELAY_REASON_GAP_MINUTES: int = 5
    MAX_PTT_SECONDS: int = 5
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str | None = None
    ADMIN_FIRST_NAME: str = "System"
    ADMIN_LAST_NAME: str = "Admin"

    model_config = {"env_file": ".env"}


settings = Settings()
