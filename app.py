import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import json
from datetime import datetime

from config import API_TITLE, API_VERSION, DEBUG, FRONTEND_DOMAIN
from auth import authenticator, JWTError
from db import db_manager
from models import ChatMessage

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Connection manager for WebSocket
class ConnectionManager:
    """Manages WebSocket connections and broadcasting"""
    
    def __init__(self):
        self.active_connections: dict = {}  # {room_id: [connection, ...]}
    
    async def connect(self, websocket: WebSocket, room_id: str):
        """Register new WebSocket connection"""
        await websocket.accept()
        
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        
        self.active_connections[room_id].append(websocket)
        logger.info(f"Client connected to room: {room_id}")
    
    async def disconnect(self, websocket: WebSocket, room_id: str):
        """Unregister WebSocket connection"""
        if room_id in self.active_connections:
            self.active_connections[room_id].remove(websocket)
            
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
        
        logger.info(f"Client disconnected from room: {room_id}")
    
    async def broadcast(self, message: str, room_id: str):
        """Send message to all connected clients in room"""
        if room_id not in self.active_connections:
            return
        
        disconnected_clients = []
        
        for connection in self.active_connections[room_id]:
            try:
                await connection.send_text(message)
            except Exception as e:
                logger.error(f"Error sending message: {e}")
                disconnected_clients.append(connection)
        
        # Clean up disconnected clients
        for connection in disconnected_clients:
            await self.disconnect(connection, room_id)

# Initialize connection manager
manager = ConnectionManager()

# FastAPI lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup")
    yield
    logger.info("Application shutdown")

# Create FastAPI app
app = FastAPI(
    title=API_TITLE,
    version=API_VERSION,
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_DOMAIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": API_VERSION}

@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    """Retrieve message history for a room"""
    messages = await db_manager.get_messages(room_id, limit)
    return {
        "room_id": room_id,
        "messages": [msg.dict() for msg in messages],
        "count": len(messages)
    }

# WebSocket endpoint

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, token: str = Query(None)):
    """
    WebSocket endpoint for real-time chat
    
    Args:
        websocket: WebSocket connection
        room_id: Chat room identifier
        token: JWT token for authentication (query parameter)
    """
    
    # Authenticate token
    if not token:
        await websocket.close(code=4001, reason="Missing authentication token")
        logger.warning(f"WebSocket connection rejected: missing token")
        return
    
    try:
        user = await authenticator.verify_token(token)
        username = user.get("username")
        logger.info(f"User {username} authenticated for WebSocket")
    except JWTError as e:
        await websocket.close(code=4001, reason="Invalid authentication token")
        logger.warning(f"WebSocket connection rejected: {e}")
        return
    
    # Connect user
    await manager.connect(websocket, room_id)
    
    try:
        # Send initial message
        welcome_msg = {
            "type": "system",
            "text": f"{username} joined the chat",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        await manager.broadcast(json.dumps(welcome_msg), room_id)
        
        # Listen for messages
        while True:
            data = await websocket.receive_text()
            
            try:
                message_data = json.loads(data)
                text = message_data.get("text", "").strip()
                
                if not text:
                    continue
                
                # Create message object
                message = ChatMessage(
                    username=username,
                    text=text,
                    room_id=room_id,
                    timestamp=datetime.utcnow().isoformat() + "Z"
                )
                
                # Store in DynamoDB
                await db_manager.store_message(
                    room_id=message.room_id,
                    username=message.username,
                    text=message.text
                )
                
                # Broadcast to all clients
                broadcast_msg = {
                    "type": "message",
                    "username": message.username,
                    "text": message.text,
                    "timestamp": message.timestamp
                }
                
                await manager.broadcast(json.dumps(broadcast_msg), room_id)
                logger.info(f"Message broadcast - User: {username}, Room: {room_id}")
                
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON received from {username}")
            except Exception as e:
                logger.error(f"Error processing message: {e}")
    
    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_id)
        
        # Send disconnect message
        disconnect_msg = {
            "type": "system",
            "text": f"{username} left the chat",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        await manager.broadcast(json.dumps(disconnect_msg), room_id)
        logger.info(f"User {username} disconnected from {room_id}")

# Error handlers

@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {exc}")
    return {"error": "Internal server error"}

if __name__ == "__main__":
    import uvicorn
    
    # Run: uvicorn app:app --host 0.0.0.0 --port 8000 --reload
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=DEBUG
    )
