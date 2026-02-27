# app.py - Stable Student/Demo backend (Email identity, DynamoDB optional, frontend-safe)
import os
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

# ----------------------------
# Logging
# ----------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:%(name)s:%(message)s"
)
logger = logging.getLogger("app-demo")

# ----------------------------
# DynamoDB config (MUST match table keys)
# Your table keys (from screenshot):
#   PK: room_id (String)
#   SK: timestamp (String)
# ----------------------------
DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "").strip()
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1")).strip()

DDB_PK = "room_id"
DDB_SK = "timestamp"

ddb_table = None
if DYNAMODB_TABLE:
    try:
        import boto3
        _ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
        ddb_table = _ddb.Table(DYNAMODB_TABLE)
        ddb_table.load()  # DescribeTable
        logger.info(f"✅ DynamoDB enabled: table={DYNAMODB_TABLE}, region={AWS_REGION}, PK={DDB_PK}, SK={DDB_SK}")
    except Exception as e:
        ddb_table = None
        logger.error(f"❌ DynamoDB disabled (will use memory). Reason: {e}")

# ----------------------------
# In-memory fallback (always works)
# ----------------------------
rooms: Dict[str, List[WebSocket]] = {}
history: Dict[str, List[dict]] = {}  # {room_id: [msg_dict, ...]}

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def normalize_email(email: str) -> str:
    email = (email or "").strip().lower()
    return email[:120] if email else "guest@local"

async def store_message(room_id: str, msg: dict) -> None:
    """
    Store message in DynamoDB if possible; always store in memory too.
    Never raises (won't break chat).
    """
    # Memory first (UI/history never breaks)
    history.setdefault(room_id, []).append(msg)
    if len(history[room_id]) > 200:
        history[room_id] = history[room_id][-200:]

    if not ddb_table:
        return

    try:
        # IMPORTANT: MUST include both keys exactly as table defines
        item = {
            DDB_PK: room_id,
            DDB_SK: msg.get("timestamp", now_iso()),
            "type": msg.get("type", "message"),
            "email": msg.get("email", "guest@local"),
            "username": msg.get("username", msg.get("email", "guest@local")),  # frontend-safe
            "text": msg.get("text", ""),
        }

        ddb_table.put_item(Item=item)

        # Log success so you KNOW it's writing
        logger.info(f"✅ DDB PutItem OK room={room_id} ts={item[DDB_SK]} user={item['email']} text_len={len(item['text'])}")

    except Exception as e:
        # This is the line that will tell you the real reason (AccessDenied, ValidationException, etc.)
        logger.error(f"❌ DDB PutItem FAILED: {e}")

async def load_messages(room_id: str, limit: int) -> List[dict]:
    """
    Load from DynamoDB if possible, else memory.
    Never raises.
    """
    if ddb_table:
        try:
            from boto3.dynamodb.conditions import Key

            resp = ddb_table.query(
                KeyConditionExpression=Key(DDB_PK).eq(room_id),
                ScanIndexForward=True,  # oldest -> newest
                Limit=limit
            )

            items = resp.get("Items", [])
            out = []
            for it in items:
                out.append({
                    "type": it.get("type", "message"),
                    "email": it.get("email", "guest@local"),
                    "username": it.get("username", it.get("email", "guest@local")),
                    "text": it.get("text", ""),
                    "timestamp": it.get(DDB_SK, now_iso()),
                })
            return out
        except Exception as e:
            logger.error(f"❌ DDB Query FAILED (using memory): {e}")

    return history.get(room_id, [])[-limit:]

# ----------------------------
# WebSocket manager
# ----------------------------
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
        payload = json.dumps(msg)
        dead = []

        for conn in rooms.get(room_id, []):
            try:
                await conn.send_text(payload)
            except Exception:
                dead.append(conn)

        for conn in dead:
            await self.disconnect(conn, room_id)

manager = ConnectionManager()

# ----------------------------
# FastAPI app
# ----------------------------
app = FastAPI(title="Chat Demo", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # demo
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"ok": True, "ddb_enabled": bool(ddb_table), "table": DYNAMODB_TABLE, "region": AWS_REGION}

@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    msgs = await load_messages(room_id, limit)
    return {"room_id": room_id, "messages": msgs, "count": len(msgs)}

@app.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    email: str = Query("guest@local"),
    token: Optional[str] = Query(None),  # ignored, kept so old frontend doesn't break
):
    user_email = normalize_email(email)
    logger.info(f"WS user email: {user_email} room={room_id}")

    await manager.connect(websocket, room_id)

    try:
        while True:
            raw = await websocket.receive_text()

            # Accept JSON {"text": "..."} or plain text
            text = ""
            try:
                data = json.loads(raw)
                text = (data.get("text") or "").strip()
            except json.JSONDecodeError:
                text = raw.strip()

            if not text:
                continue

            msg = {
                "type": "message",
                "email": user_email,
                "username": user_email,   # <-- frontend expects this
                "text": text,
                "timestamp": now_iso(),
            }

            await store_message(room_id, msg)
            await manager.broadcast(room_id, msg)

    except WebSocketDisconnect:
        await manager.disconnect(websocket, room_id)
    except Exception as e:
        logger.error(f"WS error: {e}")
        try:
            await manager.disconnect(websocket, room_id)
        except Exception:
            pass

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)