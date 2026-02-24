from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime

class ChatMessage(BaseModel):
    """Message model for WebSocket communication"""
    username: str
    text: str
    room_id: str
    timestamp: Optional[datetime] = None
    
    class Config:
        json_schema_extra = {
            "example": {
                "username": "alice",
                "text": "Hello everyone!",
                "room_id": "general",
                "timestamp": "2024-01-15T10:30:00Z"
            }
        }

class TokenData(BaseModel):
    """Token validation response"""
    username: str
    user_id: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "username": "alice",
                "user_id": "12345-67890"
            }
        }

class MessageResponse(BaseModel):
    """Response model for stored messages"""
    room_id: str
    username: str
    text: str
    timestamp: str
    
    class Config:
        json_schema_extra = {
            "example": {
                "room_id": "general",
                "username": "alice",
                "text": "Hello everyone!",
                "timestamp": "2024-01-15T10:30:00Z"
            }
        }
