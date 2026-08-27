from datetime import datetime
from pydantic import BaseModel, Field

class ShelfBase(BaseModel):
    name: str = Field(..., max_length=100, description="書架名稱")
    description: str | None = None
    sort_order: int = 0
    is_archived: bool = False

class ShelfCreate(ShelfBase):
    pass

class ShelfUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    sort_order: int | None = None
    is_archived: bool | None = None

class ShelfResponse(ShelfBase):
    id: int
    book_count: int = 0
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True
