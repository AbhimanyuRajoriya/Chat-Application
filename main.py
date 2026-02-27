import os
import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from auth import get_current_user, exchange_code_for_tokens

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app-demo")

# ----------------------------
# DynamoDB (optional)
# ----------------------------
DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "").strip()
AWS_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1")).strip()

DDB_PK = os.getenv("DDB_PK", "room_id").strip()
DDB_SK = os.getenv("DDB_SK", "timestamp").strip()  # your table uses "timestamp"

ddb_table = None
if DYNAMODB_TABLE:
    try:
        import boto3

        _ddb = boto3.resource("dynamodb", region_name=AWS_REGION)
        ddb_table = _ddb.Table(DYNAMODB_TABLE)
        ddb_table.load()
        logger.info(f"✅ DynamoDB enabled: table={DYNAMODB_TABLE}, region={AWS_REGION}, PK={DDB_PK}, SK={DDB_SK}")
    except Exception as e:
        ddb_table = None
        logger.error(f"❌ DynamoDB disabled (memory fallback). Reason: {e}")


# ----------------------------
# In-memory fallback
# ----------------------------
rooms: Dict[str, List[WebSocket]] = {}
history: Dict[str, List[dict]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


async def store_message(room_id: str, msg: dict) -> None:
    history.setdefault(room_id, []).append(msg)
    if len(history[room_id]) > 200:
        history[room_id] = history[room_id][-200:]

    if not ddb_table:
        return

    try:
        item = {
            DDB_PK: room_id,
            DDB_SK: msg.get("timestamp", now_iso()),
            "type": msg.get("type", "message"),
            "email": msg.get("email", "guest@local"),
            "text": msg.get("text", ""),
        }
        ddb_table.put_item(Item=item)
        logger.info(f"✅ Stored message -> DDB room={room_id} email={item['email']}")
    except Exception as e:
        logger.error(f"❌ DynamoDB put_item failed (using memory). Reason: {e}")


async def load_messages(room_id: str, limit: int) -> List[dict]:
    if ddb_table:
        try:
            from boto3.dynamodb.conditions import Key

            resp = ddb_table.query(
                KeyConditionExpression=Key(DDB_PK).eq(room_id),
                ScanIndexForward=True,
                Limit=limit,
            )
            items = resp.get("Items", [])
            out = []
            for it in items:
                out.append(
                    {
                        "type": it.get("type", "message"),
                        "email": it.get("email", "guest@local"),
                        "text": it.get("text", ""),
                        "timestamp": it.get(DDB_SK, now_iso()),
                    }
                )
            return out
        except Exception as e:
            logger.error(f"❌ DynamoDB query failed (using memory). Reason: {e}")

    return history.get(room_id, [])[-limit:]


# ----------------------------
# WS manager
# ----------------------------
class ConnectionManager:
    async def connect(self, ws: WebSocket, room_id: str):
        await ws.accept()
        rooms.setdefault(room_id, []).append(ws)
        logger.info(f"Client connected: room={room_id}")

    async def disconnect(self, ws: WebSocket, room_id: str):
        if room_id in rooms and ws in rooms[room_id]:
            rooms[room_id].remove(ws)
            if not rooms[room_id]:
                del rooms[room_id]
        logger.info(f"Client disconnected: room={room_id}")

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

app = FastAPI(title="Chat Backend", version="1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True, "ddb_enabled": bool(ddb_table), "table": DYNAMODB_TABLE}


@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    msgs = await load_messages(room_id, limit)
    return {"room_id": room_id, "messages": msgs, "count": len(msgs)}


@app.post("/auth/exchange")
async def auth_exchange(body: dict):
    """
    Frontend sends: { code: "...", redirect_uri: "https://...." }
    Backend returns tokens from Cognito.
    """
    code = (body.get("code") or "").strip()
    redirect_uri = (body.get("redirect_uri") or "").strip()

    if not code or not redirect_uri:
        return {"ok": False, "error": "code and redirect_uri required"}

    try:
        tokens = await exchange_code_for_tokens(code, redirect_uri)
        return {"ok": True, "tokens": tokens}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.websocket("/ws/{room_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    room_id: str,
    token: Optional[str] = Query(None),
    email: Optional[str] = Query(None),  # optional override
):
    # Primary identity: from token
    user = {"email": "guest@local"}
    try:
        if token:
            user = await get_current_user(token)
    except Exception as e:
        logger.warning(f"Token verify failed, using guest. Reason: {e}")

    # Allow explicit email only if token is missing/invalid (keeps dev mode usable)
    user_email = (email or user.get("email") or "guest@local").strip().lower() or "guest@local"

    logger.info(f"WS connected room={room_id} user={user_email}")
    await manager.connect(websocket, room_id)

    try:
        while True:
            raw = await websocket.receive_text()
            text = ""
            try:
                data = json.loads(raw)
                text = (data.get("text") or "").strip()
            except Exception:
                text = raw.strip()

            if not text:
                continue

            msg = {
                "type": "message",
                "email": user_email,
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