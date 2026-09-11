from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class SyncChangeItem(BaseModel):
    uuid: str
    action: str  # "create", "update", "delete"
    data: Optional[Dict[str, Any]] = None
    updated_at: Optional[str] = None

class SyncUpRequest(BaseModel):
    client_id: Optional[str] = "mobile_pwa"
    changes: List[SyncChangeItem] = []

class SyncUpResponse(BaseModel):
    status: str
    processed_count: int
    server_time: str

class SyncDownResponse(BaseModel):
    server_time: str
    updates: List[Dict[str, Any]]
    deleted_uuids: List[str]
    total_updates: int
    total_deleted: int
