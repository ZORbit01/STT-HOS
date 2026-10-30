import logging
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.domain.exceptions import AdminAuthError, DeviceAuthError, NurseAuthError
from app.models.orm import AdminAccount, DeviceAccount, NurseAccount, ScreenAccount

logger = logging.getLogger(__name__)

_ALGORITHM = "HS256"


# ------------------------------------------------------------------
# Password helpers
# ------------------------------------------------------------------


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ------------------------------------------------------------------
# JWT helpers
# ------------------------------------------------------------------


def _create_token(payload: dict, expire_delta: timedelta) -> str:
    data = payload.copy()
    data["exp"] = datetime.now(UTC) + expire_delta
    return jwt.encode(data, settings.SECRET_KEY, algorithm=_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[_ALGORITHM])


# ------------------------------------------------------------------
# Screen auth
# ------------------------------------------------------------------


async def screen_login(
    username: str,
    password: str,
    db: AsyncSession,
) -> tuple[str, ScreenAccount]:
    """Authenticate a display screen. Returns a long-lived read-only JWT."""
    result = await db.execute(
        select(ScreenAccount).where(
            ScreenAccount.username == username,
            ScreenAccount.is_active.is_(True),
        )
    )
    screen = result.scalar_one_or_none()

    if screen is None or not verify_password(password, screen.hashed_password):
        logger.warning("Screen login failed for username=%s", username)
        raise NurseAuthError(username)

    token = _create_token(
        payload={"sub": str(screen.id), "type": "screen", "location": screen.location},
        expire_delta=timedelta(days=365),
    )

    logger.info("Screen login successful: username=%s location=%s", username, screen.location)
    return token, screen


# ------------------------------------------------------------------
# Admin auth
# ------------------------------------------------------------------


async def admin_login(
    username: str,
    password: str,
    db: AsyncSession,
) -> str:
    """Authenticate an admin. Returns a long-lived admin JWT."""
    result = await db.execute(
        select(AdminAccount).where(
            AdminAccount.username == username,
            AdminAccount.is_active.is_(True),
        )
    )
    admin = result.scalar_one_or_none()

    if admin is None or not verify_password(password, admin.hashed_password):
        logger.warning("Admin login failed for username=%s", username)
        raise AdminAuthError(username)

    token = _create_token(
        payload={"sub": str(admin.id), "type": "admin"},
        expire_delta=timedelta(hours=12),
    )

    logger.info("Admin login successful: username=%s", username)
    return token


# ------------------------------------------------------------------
# Device auth
# ------------------------------------------------------------------


async def device_login(
    username: str,
    password: str,
    db: AsyncSession,
) -> str:
    """Authenticate an OR laptop device. Returns a long-lived device JWT."""
    result = await db.execute(
        select(DeviceAccount).where(
            DeviceAccount.username == username,
            DeviceAccount.is_active.is_(True),
        )
    )
    device = result.scalar_one_or_none()

    if device is None or not verify_password(password, device.hashed_password):
        logger.warning("Device login failed for username=%s", username)
        raise DeviceAuthError(username)

    # Update last_seen
    device.last_seen = datetime.now(UTC)
    await db.commit()

    token = _create_token(
        payload={"sub": str(device.id), "type": "device", "room_id": str(device.room_id)},
        expire_delta=timedelta(days=settings.DEVICE_TOKEN_EXPIRE_DAYS),
    )

    logger.info("Device login successful: username=%s room_id=%s", username, device.room_id)
    return token


# ------------------------------------------------------------------
# Nurse auth
# ------------------------------------------------------------------


async def nurse_login(
    username: str,
    password: str,
    db: AsyncSession,
) -> tuple[str, NurseAccount]:
    """Authenticate a nurse. Returns a shift JWT and the nurse record."""
    result = await db.execute(
        select(NurseAccount).where(
            NurseAccount.username == username,
            NurseAccount.is_active.is_(True),
        )
    )
    nurse = result.scalar_one_or_none()

    if nurse is None or not verify_password(password, nurse.hashed_password):
        logger.warning("Nurse login failed for username=%s", username)
        raise NurseAuthError(username)

    token = _create_token(
        payload={"sub": str(nurse.id), "type": "nurse"},
        expire_delta=timedelta(hours=settings.NURSE_TOKEN_EXPIRE_HOURS),
    )

    logger.info("Nurse login successful: username=%s", username)
    return token, nurse
