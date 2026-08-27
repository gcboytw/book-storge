from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, Field
from app.schemas.book import BookResponse
from app.schemas.shelf import ShelfResponse

class MyBookBase(BaseModel):
    book_id: int
    shelf_id: int | None = None
    status: str = Field("unread", description="閱讀狀態: unread, reading, read, abandoned")
    purchase_date: date | None = None
    purchase_price: Decimal | None = None
    purchase_place: str | None = None
    condition: str | None = None
    rating: int | None = Field(None, ge=1, le=5, description="1~5 顆星")
    notes: str | None = None

class MyBookCreate(MyBookBase):
    pass

class MyBookUpdate(BaseModel):
    shelf_id: int | None = None
    status: str | None = None
    purchase_date: date | None = None
    purchase_price: Decimal | None = None
    purchase_place: str | None = None
    condition: str | None = None
    rating: int | None = Field(None, ge=1, le=5)
    notes: str | None = None

class MyBookResponse(BaseModel):
    id: int
    book_id: int
    shelf_id: int | None = None
    status: str
    purchase_date: date | None = None
    purchase_price: Decimal | None = None
    purchase_place: str | None = None
    condition: str | None = None
    rating: int | None = None
    notes: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    
    # 關聯書籍與書架資料
    book: BookResponse | None = None
    shelf: ShelfResponse | None = None

    class Config:
        from_attributes = True
