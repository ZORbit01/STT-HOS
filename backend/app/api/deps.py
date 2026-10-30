from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.runtime import AppRuntime
from app.services.auth_service import decode_token

_bearer = HTTPBearer()


def _extract_token(credentials: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    try:
        return decode_token(credentials.credentials)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token") from None


def require_nurse(payload: dict = Depends(_extract_token)) -> dict:
    if payload.get("type") != "nurse":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nurse token required")
    return payload


def require_admin(payload: dict = Depends(_extract_token)) -> dict:
    if payload.get("type") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin token required")
    return payload


def require_nurse_or_admin(payload: dict = Depends(_extract_token)) -> dict:
    if payload.get("type") not in ("nurse", "admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Nurse or admin token required")
    return payload


def get_runtime(request: Request) -> AppRuntime:
    return request.app.state.runtime
