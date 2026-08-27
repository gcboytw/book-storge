import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, Integer, BigInteger, String, Text, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

def get_taipei_now():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

class MyBook(Base):
    __tablename__ = "my_books"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    uuid = Column(String(36), default=lambda: str(uuid.uuid4()), unique=True, index=True)
    book_id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True)
    shelf_id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), ForeignKey("shelves.id", ondelete="SET NULL"), nullable=True, index=True)
    
    # 閱讀狀態 (保留相容性)
    status = Column(String(30), default="unread", index=True)
    
    # 購買與書況
    purchase_date = Column(Date, nullable=True)
    purchase_price = Column(Numeric(10, 2), nullable=True)
    purchase_place = Column(String(255), nullable=True)
    condition = Column(String(50), nullable=True)
    
    # 評分與筆記
    rating = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)
    
    created_at = Column(DateTime, default=get_taipei_now)
    updated_at = Column(DateTime, default=get_taipei_now, onupdate=get_taipei_now)

    # 關聯
    book = relationship("Book", back_populates="my_books")
    shelf = relationship("Shelf", back_populates="my_books")
