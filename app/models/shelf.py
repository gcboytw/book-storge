import uuid
from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, Integer, BigInteger, String, Text, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base

def get_taipei_now():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

class Shelf(Base):
    __tablename__ = "shelves"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    uuid = Column(String(36), default=lambda: str(uuid.uuid4()), unique=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=get_taipei_now)
    updated_at = Column(DateTime, default=get_taipei_now, onupdate=get_taipei_now)

    # 關聯
    my_books = relationship("MyBook", back_populates="shelf")
