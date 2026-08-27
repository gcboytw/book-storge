from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, Text, Boolean, DateTime
from sqlalchemy.orm import relationship
from app.core.database import Base

class Shelf(Base):
    __tablename__ = "shelves"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    name = Column(String(100), nullable=False, unique=True)
    description = Column(Text, nullable=True)
    sort_order = Column(Integer, default=0)
    is_archived = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 關聯
    my_books = relationship("MyBook", back_populates="shelf")
