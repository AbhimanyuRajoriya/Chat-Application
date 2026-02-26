# app.py - Student / Demo Version (In-Memory Storage)
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import json
from datetime import datetime
import random
import uvicorn
from config import API_TITLE, API_VERSION, DEBUG, FRONTEND_DOMAIN

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: dict = {}  # {room_id: [connections,...]}
    
    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        if room_id not in self.active_connections:
            self.active_connections[room_id] = []
        self.active_connections[room_id].append(websocket)
        logger.info(f"Client connected to room: {room_id}")
    
    async def disconnect(self, websocket: WebSocket, room_id: str):
        if room_id in self.active_connections:
            self.active_connections[room_id].remove(websocket)
            if not self.active_connections[room_id]:
                del self.active_connections[room_id]
        logger.info(f"Client disconnected from room: {room_id}")
    
    async def broadcast(self, message: str, room_id: str):
        if room_id not in self.active_connections:
            return
        disconnected_clients = []
        for connection in self.active_connections[room_id]:
            try:
                await connection.send_text(message)
            except:
                disconnected_clients.append(connection)
        for conn in disconnected_clients:
            await self.disconnect(conn, room_id)

manager = ConnectionManager()

# In-memory message storage: {room_id: [message_dicts,...]}
memory_store = {}

# FastAPI lifespan
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup")
    yield
    logger.info("Application shutdown")

# Create app
app = FastAPI(title=API_TITLE, version=API_VERSION, lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_DOMAIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Routes
@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": API_VERSION}

@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    messages = memory_store.get(room_id, [])
    return {"room_id": room_id, "messages": messages[-limit:], "count": len(messages)}

# WebSocket (DEV MODE, no JWT)
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, token: str = Query(None)):
    username = f"User_{random.randint(1000,9999)}"
    logger.info(f"User {username} assigned for WebSocket connection")
    
    await manager.connect(websocket, room_id)
    
    # Send join message
    join_msg = {"type": "system", "text": f"{username} joined the chat", "timestamp": datetime.utcnow().isoformat()+"Z"}
    memory_store.setdefault(room_id, []).append(join_msg)
    await manager.broadcast(json.dumps(join_msg), room_id)
    
    try:
        while True:
            data = await websocket.receive_text()
            try:
                msg_json = json.loads(data)
                text = msg_json.get("text","").strip()
                if not text:
                    continue
                message = {"type":"message","username":username,"text":text,"timestamp":datetime.utcnow().isoformat()+"Z"}
                memory_store.setdefault(room_id, []).append(message)
                await manager.broadcast(json.dumps(message), room_id)
            except json.JSONDecodeError:
                logger.warning(f"Invalid JSON from {username}")
    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_id)
        leave_msg = {"type":"system","text":f"{username} left the chat","timestamp":datetime.utcnow().isoformat()+"Z"}
        memory_store.setdefault(room_id, []).append(leave_msg)
        await manager.broadcast(json.dumps(leave_msg), room_id)
        logger.info(f"User {username} disconnected from {room_id}")

# Global exception
@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error(f"Unhandled exception: {exc}")
    return {"error":"Internal server error"}

# Run
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=DEBUG)