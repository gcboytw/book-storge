from datetime import datetime, timezone, timedelta
from sqlalchemy import Column, Integer, BigInteger, String, DateTime
from app.core.database import Base

def get_taipei_now():
    return datetime.now(timezone(timedelta(hours=8))).replace(tzinfo=None)

class DeletedRecord(Base):
    __tablename__ = "deleted_records"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    uuid = Column(String(36), nullable=False, index=True)
    deleted_at = Column(DateTime, default=get_taipei_now, index=True)
