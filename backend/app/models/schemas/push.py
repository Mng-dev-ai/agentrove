from pydantic import BaseModel, Field


class PushDeviceRegister(BaseModel):
    token: str = Field(min_length=1, max_length=200, pattern=r"^[0-9a-f]+$")
    sandbox: bool
