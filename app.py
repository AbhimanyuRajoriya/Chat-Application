# app.py - Minimal working demo with message history
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
from datetime import datetime
import random

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("chat-demo")

app = FastAPI(title="Chat Demo", version="1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For testing
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Active connections per room
rooms = {}  # {room_id: [websocket, ...]}

# In-memory message history
messages = {}  # {room_id: [message_dicts]}

# ---------------------
# HTTP endpoint to fetch room messages
# ---------------------
@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    """
    Retrieve the last `limit` messages from a room
    """
    room_msgs = messages.get(room_id, [])
    return {
        "room_id": room_id,
        "messages": room_msgs[-limit:],
        "count": len(room_msgs)
    }

# ---------------------
# WebSocket endpoint
# ---------------------
@app.websocket("/ws/{room_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str):
    username = f"User_{random.randint(1000,9999)}"
    await websocket.accept()

    # Register connection
    rooms.setdefault(room_id, []).append(websocket)

    # Broadcast join
    join_msg = {
        "type": "system",
        "text": f"{username} joined",
        "timestamp": datetime.utcnow().isoformat() + "Z"
    }
    messages.setdefault(room_id, []).append(join_msg)
    for conn in rooms[room_id]:
        await conn.send_json(join_msg)

    try:
        while True:
            data = await websocket.receive_text()
            text = data.strip()
            if not text:
                continue

            msg = {
                "type": "message",
                "username": username,
                "text": text,
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }
            messages.setdefault(room_id, []).append(msg)

            for conn in rooms[room_id]:
                await conn.send_json(msg)

    except WebSocketDisconnect:
        rooms[room_id].remove(websocket)
        leave_msg = {
            "type": "system",
            "text": f"{username} left",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }
        messages.setdefault(room_id, []).append(leave_msg)
        for conn in rooms.get(room_id, []):
            await conn.send_json(leave_msg)
        logger.info(f"{username} disconnected from {room_id}")

# ---------------------
# Run the server
# ---------------------
if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)