from datetime import datetime
from pydantic import BaseModel, Field

class BookBase(BaseModel):
    title: str = Field(..., description="書名")
    subtitle: str | None = None
    author_display: str | None = None
    author_last: str | None = None
    publisher: str | None = None
    publication_date: str | None = None
    publication_year: str | None = None
    pages: str | None = None
    description: str | None = None
    category: str | None = None
    isbn13: str | None = None
    isbn10: str | None = None
    ean: str | None = None
    cover_url: str | None = None
    metadata_source: str = "Manual"
    uuid: str | None = None

class BookCreate(BookBase):
    pass

class BookUpdate(BaseModel):
    title: str | None = None
    subtitle: str | None = None
    author_display: str | None = None
    author_last: str | None = None
    publisher: str | None = None
    publication_date: str | None = None
    publication_year: str | None = None
    pages: str | None = None
    description: str | None = None
    category: str | None = None
    isbn13: str | None = None
    isbn10: str | None = None
    ean: str | None = None
    cover_url: str | None = None

class BookResponse(BookBase):
    id: int
    uuid: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    class Config:
        from_attributes = True

class ISBNLookupRequest(BaseModel):
    isbn: str = Field(..., min_length=8, max_length=20, description="ISBN-10, ISBN-13 或 EAN 條碼")
