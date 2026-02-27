# main.py
import json
import logging
import base64
from datetime import datetime, timezone
from typing import Dict, List, Optional

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware

from db import db_manager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("app-demo")

app = FastAPI(title="Chat Demo", version="2.0")

# Demo CORS (don’t fight it right now)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# room_id -> list of sockets
rooms: Dict[str, List[WebSocket]] = {}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _b64url_decode(s: str) -> bytes:
    s += "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s.encode("utf-8"))


def email_from_token(token: Optional[str]) -> Optional[str]:
    """
    Extract email from a Cognito JWT token payload.
    This does NOT verify signature (keeps app stable).
    """
    if not token:
        return None
    try:
        parts = token.split(".")
        if len(parts) != 3:
            return None
        payload = json.loads(_b64url_decode(parts[1]).decode("utf-8"))

        # common Cognito claims:
        # email, cognito:username, username
        email = payload.get("email") or payload.get("cognito:username") or payload.get("username")
        if not email:
            return None
        return str(email).strip().lower()[:120]
    except Exception:
        return None


async def broadcast(room_id: str, msg: dict):
    dead = []
    payload = json.dumps(msg)

    for ws in rooms.get(room_id, []):
        try:
            await ws.send_text(payload)
        except Exception:
            dead.append(ws)

    for ws in dead:
        try:
            rooms[room_id].remove(ws)
        except Exception:
            pass


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/rooms/{room_id}/messages")
async def get_room_messages(room_id: str, limit: int = Query(50, ge=1, le=100)):
    items = await db_manager.get_messages(room_id, limit)
    # items already in correct shape: username/text/timestamp
    messages = []
    for it in items:
        messages.append({
            "type": "message",
            "username": it.get("username", "guest@local"),
            "text": it.get("text", ""),
            "timestamp": it.get("timestamp", now_iso())
        })
    return {"room_id": room_id, "messages": messages, "count": len(messages)}


@app.websocket("/ws/{room_id}")
async def ws_room(
    websocket: WebSocket,
    room_id: str,
    token: Optional[str] = Query(None),
):
    # Identity = email from token, fallback guest
    email = email_from_token(token) or "guest@local"

    await websocket.accept()
    rooms.setdefault(room_id, []).append(websocket)
    logger.info(f"WS connected room={room_id} user={email}")

    try:
        while True:
            raw = await websocket.receive_text()

            # frontend sends JSON {text:"..."}; also accept plain text
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
                "username": email,     # IMPORTANT: frontend wants username; we put email here
                "text": text,
                "timestamp": now_iso(),
            }

            ok = await db_manager.store_message(room_id, email, text)
            if not ok:
                logger.error("DynamoDB write failed (check credentials/IAM role)")

            await broadcast(room_id, msg)

    except WebSocketDisconnect:
        logger.info(f"WS disconnected room={room_id} user={email}")
    except Exception as e:
        logger.error(f"WS error room={room_id} user={email}: {e}")
    finally:
        try:
            if websocket in rooms.get(room_id, []):
                rooms[room_id].remove(websocket)
        except Exception:
            pass


if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000)
    