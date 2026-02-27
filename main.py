# app.py - Demo mode (NO JWT, NO DynamoDB) but compatible with your app.js
import logging
import json
import random
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app-demo")

# -------------------------
# In-memory storage
# -------------------------
rooms: dict[str, list[WebSocket]] = {}        # {room_id: [ws1, ws2]}
history: dict[str, list[dict]] = {}           # {room_id: [msg_dict, ...]}


class ConnectionManager:
    async def connect(self, ws: WebSocket, room_id: str):
        await ws.accept()
        rooms.setdefault(room_id, []).append(ws)
        logger.info(f"Client connected to room: {room_id}")

    async def disconnect(self, ws: WebSocket, room_id: str):
        if room_id in rooms and ws in rooms[room_id]:
            rooms[room_id].remove(ws)
            if not rooms[room_id]:
                del rooms[room_id]
        logger.info(f"Client disconnected from room: {room_id}")

    async def broadcast(self, room_id: str, msg: dict):
        # store history
        history.setdefault(room_id, []).append(msg)

        # send to all
        dead = []
        for conn in rooms.get(room_id, []):
            try:
                await conn.send_text(json.dumps(msg))
            except Exception as e:
                logger.error(f"Send failed: {e}")
                dead.append(conn)

        # cleanup dead sockets
        for conn in dead:
            await self.disconnect(conn, room_id)


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Application startup")
    yield
    logger.info("Application shutdown")


app = FastAPI(title="Chat Demo", version="1.0", lifespan=lifespan)

# CORS: allow all for demo
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    msgs = history.get(room_id, [])
    return {
        "room_id": room_id,
        "messages": msgs[-limit:],
        "count": len(msgs),
    }


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, token: str = Query(None)):
    # token ignored in demo, but kept so your frontend URL doesn't break
    username = f"User_{random.randint(1000, 9999)}"
    logger.info(f"User {username} assigned for WebSocket connection")

    await manager.connect(websocket, room_id)

    # join message (what your frontend expects)
    await manager.broadcast(room_id, {
        "type": "system",
        "text": f"{username} joined the chat",
        "timestamp": datetime.utcnow().isoformat() + "Z",
    })

    try:
        while True:
            raw = await websocket.receive_text()
            logger.info(f"RAW FROM CLIENT ({username}): {raw}")

            try:
                data = json.loads(raw)              # your frontend sends JSON
                text = (data.get("text") or "").strip()
            except json.JSONDecodeError:
                # if client sends plain text by mistake
                text = raw.strip()

            if not text:
                continue

            msg = {
                "type": "message",
                "username": username,
                "text": text,
                "timestamp": datetime.utcnow().isoformat() + "Z",
            }
            await manager.broadcast(room_id, msg)

    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_id)
        await manager.broadcast(room_id, {
            "type": "system",
            "text": f"{username} left the chat",
            "timestamp": datetime.utcnow().isoformat() + "Z",
        })


if __name__ == "__main__":
    uvicorn.run("app:app", host="0.0.0.0", port=8000)