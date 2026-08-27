from datetime import datetime
from sqlalchemy import Column, Integer, BigInteger, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from app.core.database import Base

class Book(Base):
    __tablename__ = "books"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
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
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # 關聯
    my_books = relationship("MyBook", back_populates="book", cascade="all, delete-orphan")
    book_authors = relationship("BookAuthor", back_populates="book", cascade="all, delete-orphan")

class Author(Base):
    __tablename__ = "authors"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True, index=True)
    name = Column(String(255), nullable=False)
    normalized_name = Column(String(255), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    book_authors = relationship("BookAuthor", back_populates="author", cascade="all, delete-orphan")

class BookAuthor(Base):
    __tablename__ = "book_authors"

    id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), primary_key=True, autoincrement=True)
    book_id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), ForeignKey("books.id"), nullable=False, index=True)
    author_id = Column(Integer().with_variant(BigInteger, "mysql", "mariadb"), ForeignKey("authors.id"), nullable=False, index=True)
    role = Column(String(50), default="作者")
    sort_order = Column(Integer, default=0)

    book = relationship("Book", back_populates="book_authors")
    author = relationship("Author", back_populates="book_authors")
