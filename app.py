# app.py - Demo mode (NO AUTH), works on cloud + has in-memory fallback if DynamoDB fails

import logging
import json
from datetime import datetime
from typing import Dict, List, Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

import uvicorn

# Keep your existing config values
from config import API_TITLE, API_VERSION, DEBUG, FRONTEND_DOMAIN

# If DynamoDB is configured correctly, it will be used.
# If it fails, the app still works using memory.
try:
    from db import db_manager  # uses DynamoDBManager :contentReference[oaicite:6]{index=6}
except Exception:
    db_manager = None


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("app-demo")

app = FastAPI(title=API_TITLE, version=API_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_DOMAIN, "*"],  # keep "*" for demo stability
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# In-memory fallback store
# -----------------------------
memory_store: Dict[str, List[Dict[str, Any]]] = {}  # {room_id: [message_dicts...]}


# -----------------------------
# WebSocket connection manager
# -----------------------------
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, room_id: str):
        await websocket.accept()
        self.active_connections.setdefault(room_id, []).append(websocket)
        logger.info(f"Client connected to room: {room_id}")

    async def disconnect(self, websocket: WebSocket, room_id: str):
        conns = self.active_connections.get(room_id, [])
        if websocket in conns:
            conns.remove(websocket)
        if not conns and room_id in self.active_connections:
            del self.active_connections[room_id]
        logger.info(f"Client disconnected from room: {room_id}")

    async def broadcast(self, room_id: str, payload: Dict[str, Any]):
        conns = self.active_connections.get(room_id, [])
        if not conns:
            return

        dead: List[WebSocket] = []
        message_text = json.dumps(payload)

        for ws in conns:
            try:
                await ws.send_text(message_text)
            except Exception as e:
                logger.error(f"Broadcast send failed: {e}")
                dead.append(ws)

        for ws in dead:
            await self.disconnect(ws, room_id)


manager = ConnectionManager()


# -----------------------------
# Helpers
# -----------------------------
def iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def push_memory(room_id: str, msg: Dict[str, Any]):
    memory_store.setdefault(room_id, []).append(msg)
    # keep last 200 per room to avoid memory blowup
    if len(memory_store[room_id]) > 200:
        memory_store[room_id] = memory_store[room_id][-200:]


# -----------------------------
# Routes
# -----------------------------
@app.get("/health")
async def health_check():
    return {"status": "healthy", "version": API_VERSION, "mode": "demo-no-auth"}


@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    """
    For demo:
    - Try DynamoDB if available and working
    - Otherwise return in-memory messages
    """
    # Try DynamoDB
    if db_manager is not None:
        try:
            msgs = await db_manager.get_messages(room_id, limit)  # returns MessageResponse objects
            # Convert to dicts the way your frontend expects
            return {
                "room_id": room_id,
                "messages": [m.dict() for m in msgs],
                "count": len(msgs),
                "source": "dynamodb",
            }
        except Exception as e:
            logger.error(f"DynamoDB get_messages failed, using memory fallback: {e}")

    # Memory fallback
    msgs = memory_store.get(room_id, [])
    return {
        "room_id": room_id,
        "messages": msgs[-limit:],
        "count": len(msgs),
        "source": "memory",
    }


# -----------------------------
# WebSocket (NO AUTH)
# -----------------------------
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    # Random username for demo
    import random
    username = f"User_{random.randint(1000, 9999)}"
    logger.info(f"User {username} assigned for WebSocket connection")

    await manager.connect(websocket, room_id)

    # Join message
    join_msg = {"type": "system", "text": f"{username} joined the chat", "timestamp": iso_now()}
    push_memory(room_id, join_msg)
    await manager.broadcast(room_id, join_msg)

    try:
        while True:
            raw = await websocket.receive_text()

            # Your frontend sends JSON: {"text": "...", "room_id": "..."} :contentReference[oaicite:7]{index=7}
            # So parse JSON and read "text"
            text = ""
            try:
                data = json.loads(raw)
                text = (data.get("text") or "").strip()
            except json.JSONDecodeError:
                # If someone sends plain text, accept it too
                text = raw.strip()

            if not text:
                continue

            msg = {"type": "message", "username": username, "text": text, "timestamp": iso_now()}

            # Save to memory always (so UI works even if Dynamo fails)
            push_memory(room_id, msg)

            # Try DynamoDB (optional)
            if db_manager is not None:
                try:
                    ok = await db_manager.store_message(room_id=room_id, username=username, text=text)
                    if not ok:
                        logger.error("DynamoDB store_message returned False (still broadcasting from memory).")
                except Exception as e:
                    logger.error(f"DynamoDB store_message failed (still broadcasting from memory): {e}")

            # Broadcast to room
            await manager.broadcast(room_id, msg)

    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_id)
        leave_msg = {"type": "system", "text": f"{username} left the chat", "timestamp": iso_now()}
        push_memory(room_id, leave_msg)
        await manager.broadcast(room_id, leave_msg)
        logger.info(f"User {username} disconnected from {room_id}")


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=DEBUG)