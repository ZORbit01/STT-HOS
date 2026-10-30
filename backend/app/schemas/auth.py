from pydantic import BaseModel


class ScreenLoginRequest(BaseModel):
    username: str
    password: str


class ScreenLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    location: str


class AdminLoginRequest(BaseModel):
    username: str
    password: str


class AdminLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class DeviceLoginRequest(BaseModel):
    username: str
    password: str


class DeviceLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class NurseLoginRequest(BaseModel):
    username: str
    password: str


class NurseLoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    nurse_id: str
    first_name: str
    last_name: str
