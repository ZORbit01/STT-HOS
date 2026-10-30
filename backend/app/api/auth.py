from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import require_nurse
from app.db import get_db
from app.domain.exceptions import AdminAuthError, DeviceAuthError, NurseAuthError
from app.schemas.auth import (
    AdminLoginRequest,
    AdminLoginResponse,
    DeviceLoginRequest,
    DeviceLoginResponse,
    NurseLoginRequest,
    NurseLoginResponse,
    ScreenLoginRequest,
    ScreenLoginResponse,
)
from app.services.auth_service import admin_login, device_login, nurse_login, screen_login

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/screen-login", response_model=ScreenLoginResponse)
async def screen_login_endpoint(
    body: ScreenLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> ScreenLoginResponse:
    try:
        token, screen = await screen_login(body.username, body.password, db)
        return ScreenLoginResponse(access_token=token, location=screen.location)
    except NurseAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid screen credentials",
        ) from None


@router.post("/nurse-logout", status_code=status.HTTP_204_NO_CONTENT)
async def nurse_logout(
    _: dict = Depends(require_nurse),
) -> None:
    # JWT is stateless — logout is handled client-side by discarding the token.
    # This endpoint exists so the OR client has a clean logout call to make.
    pass


@router.post("/admin-login", response_model=AdminLoginResponse)
async def admin_login_endpoint(
    body: AdminLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> AdminLoginResponse:
    try:
        token = await admin_login(body.username, body.password, db)
        return AdminLoginResponse(access_token=token)
    except AdminAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid admin credentials",
        ) from None


@router.post("/device-login", response_model=DeviceLoginResponse)
async def device_login_endpoint(
    body: DeviceLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> DeviceLoginResponse:
    try:
        token = await device_login(body.username, body.password, db)
        return DeviceLoginResponse(access_token=token)
    except DeviceAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid device credentials",
        ) from None


@router.post("/nurse-login", response_model=NurseLoginResponse)
async def nurse_login_endpoint(
    body: NurseLoginRequest,
    db: AsyncSession = Depends(get_db),
) -> NurseLoginResponse:
    try:
        token, nurse = await nurse_login(body.username, body.password, db)
        return NurseLoginResponse(
            access_token=token,
            nurse_id=str(nurse.id),
            first_name=nurse.first_name,
            last_name=nurse.last_name,
        )
    except NurseAuthError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid nurse credentials",
        ) from None
