from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.core.database import get_db
from app.models import Shelf, Book
from app.schemas import ShelfCreate, ShelfUpdate, ShelfResponse

router = APIRouter(prefix="/api/shelves", tags=["Shelves"])

@router.get("", response_model=list[ShelfResponse])
def get_shelves(db: Session = Depends(get_db)):
    """取得所有書架與藏書數量"""
    shelves = db.query(Shelf).filter(Shelf.is_archived == False).order_by(Shelf.sort_order.asc(), Shelf.id.asc()).all()
    
    # 統計各書架藏書數量
    counts = dict(
        db.query(Book.shelf_id, func.count(Book.id))
        .group_by(Book.shelf_id)
        .all()
    )

    results = []
    for s in shelves:
        resp = ShelfResponse.model_validate(s)
        resp.book_count = counts.get(s.id, 0)
        results.append(resp)

    return results

@router.post("", response_model=ShelfResponse, status_code=status.HTTP_201_CREATED)
def create_shelf(payload: ShelfCreate, db: Session = Depends(get_db)):
    """新增自訂書架"""
    existing = db.query(Shelf).filter(Shelf.name == payload.name).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"書架名稱 [{payload.name}] 已存在"
        )
    
    new_shelf = Shelf(**payload.model_dump())
    db.add(new_shelf)
    db.commit()
    db.refresh(new_shelf)
    
    resp = ShelfResponse.model_validate(new_shelf)
    resp.book_count = 0
    return resp

@router.patch("/{shelf_id}", response_model=ShelfResponse)
def update_shelf(shelf_id: int, payload: ShelfUpdate, db: Session = Depends(get_db)):
    """修改書架資訊"""
    shelf = db.query(Shelf).filter(Shelf.id == shelf_id).first()
    if not shelf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定書架")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(shelf, key, value)

    db.commit()
    db.refresh(shelf)

    count = db.query(func.count(Book.id)).filter(Book.shelf_id == shelf.id).scalar()
    resp = ShelfResponse.model_validate(shelf)
    resp.book_count = count or 0
    return resp

@router.delete("/{shelf_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_shelf(shelf_id: int, db: Session = Depends(get_db)):
    """刪除書架（書本將變為未分類）"""
    shelf = db.query(Shelf).filter(Shelf.id == shelf_id).first()
    if not shelf:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="找不到指定書架")

    # 將原書架下的書本 shelf_id 設為 NULL
    db.query(Book).filter(Book.shelf_id == shelf_id).update({"shelf_id": None})
    db.delete(shelf)
    db.commit()
    return None
