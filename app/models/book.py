import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, Integer, BigInteger, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

def get_taipei_now():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

class Book(Base):
    __tablename__ = "books"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    uuid = Column(String(36), default=lambda: str(uuid.uuid4()), unique=True, index=True)
    
    # 書籍出版資訊
    isbn13 = Column(String(20), nullable=True, index=True)
    isbn10 = Column(String(20), nullable=True, index=True)
    ean = Column(String(30), nullable=True, index=True)
    title = Column(String(500), nullable=False, index=True)
    subtitle = Column(String(500), nullable=True)
    author_display = Column(String(500), nullable=True)
    author_last = Column(String(255), nullable=True)
    publisher = Column(String(255), nullable=True, index=True)
    publication_date = Column(String(50), nullable=True)
    publication_year = Column(String(10), nullable=True)
    pages = Column(String(50), nullable=True)
    description = Column(Text, nullable=True)
    category = Column(String(255), nullable=True)
    cover_url = Column(String(1000), nullable=True)
    metadata_source = Column(String(50), default="Manual")

    # 個人藏書管理資訊
    shelf_id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), ForeignKey("shelves.id", ondelete="SET NULL"), nullable=True, index=True)
    status = Column(String(30), default="unread", index=True)
    purchase_date = Column(Date, nullable=True)
    purchase_price = Column(Numeric(10, 2), nullable=True)
    purchase_place = Column(String(255), nullable=True)
    condition = Column(String(50), nullable=True)
    rating = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    # 系統時間
    created_at = Column(DateTime, default=get_taipei_now, index=True)
    updated_at = Column(DateTime, default=get_taipei_now, onupdate=get_taipei_now)

    # 關聯
    shelf = relationship("Shelf", back_populates="books")
