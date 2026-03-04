from pydantic import BaseModel, Field, EmailStr


class MasterPasswordSetRequest(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class MasterPasswordVerifyRequest(BaseModel):
    password: str = Field(..., min_length=1, max_length=128)


class RemoteDbConfigRequest(BaseModel):
    db_url: str = Field(..., min_length=1, max_length=512)
    enabled: bool = True
    master_password: str | None = Field(None, min_length=1, max_length=128)


class InstanceConfigRequest(BaseModel):
    instance_name: str | None = Field(None, max_length=64)
    is_web_master: bool = False
    allow_remote_connections: bool = False


class SystemStatusResponse(BaseModel):
    has_master_password: bool
    remote_db_enabled: bool
    has_remote_db_url: bool
    instance_name: str | None
    is_web_master: bool
    allow_remote_connections: bool
    smtp_enabled: bool = False


class SmtpConfigRequest(BaseModel):
    host: str = Field(..., min_length=1, max_length=256)
    port: int = Field(..., ge=1, le=65535)
    username: str | None = Field(None, max_length=128)
    password: str | None = Field(None, max_length=128)
    from_email: str = Field(..., min_length=1, max_length=256)
    from_name: str | None = Field(None, max_length=128)
    use_tls: bool = True
    use_ssl: bool = False
    enabled: bool = True


class SmtpStatusResponse(BaseModel):
    enabled: bool
    host: str | None = None
    port: int | None = None
    username: str | None = None
    has_password: bool = False
    from_email: str | None = None
    from_name: str | None = None
    use_tls: bool = True
    use_ssl: bool = False


class SmtpTestRequest(BaseModel):
    test_email: EmailStr
