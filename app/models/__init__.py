from app.models.book import Book
from app.models.shelf import Shelf
from app.models.deleted_record import DeletedRecord
from app.core.database import Base

__all__ = ["Base", "Book", "Shelf", "DeletedRecord"]
