# Real-Time Chat Application - Complete Guide
## Beginner-Friendly, AWS-Ready

---

## 1. ARCHITECTURE OVERVIEW

### System Components

```
┌─────────────────────────────────────────────────────────────┐
│                     User's Browser                          │
│                  (Frontend - HTML/JS)                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ - Login via Cognito                                  │   │
│  │ - Get JWT Token                                      │   │
│  │ - WebSocket Connection (WSS)                         │   │
│  │ - Send/Receive Messages Real-time                    │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────┬──────────────────────────────────────────┘
                   │
                   │ HTTPS + WSS
                   │
    ┌──────────────┴──────────────────────────┐
    │                                         │
┌───▼──────────────────────────────────────┐  │
│        CloudFront (CDN)                  │  │
│   (Cache + HTTPS Termination)            │  │
├─────────────────────────────────────────┤  │
│  Origins:                               │  │
│  - S3 (Frontend HTML/CSS/JS)            │  │
│  - ALB → EC2 (Backend WebSocket)        │  │
└─────────────────────────────────────────┘  │
    │                  │                      │
    │                  └──────────────────────┘
    │
    │ Static Assets (HTML/CSS/JS)
    │
┌───▼──────────────────────────────────────┐
│        Amazon S3                         │
│   (Frontend - Static Hosting)            │
└──────────────────────────────────────────┘


┌──────────────────────────────────────────────────────────────┐
│             AWS Backend Infrastructure                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  EC2 Instance (Ubuntu 24.04)                         │    │
│  │  ┌────────────────────────────────────────────────┐  │    │
│  │  │  FastAPI + Uvicorn                            │  │    │
│  │  │  - WebSocket Server (WSS)                     │  │    │
│  │  │  - JWT Token Validation (Cognito)            │  │    │
│  │  │  - Connection Management                      │  │    │
│  │  │  - Message Broadcasting                       │  │    │
│  │  └────────────────────────────────────────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│              │                                                 │
│              │ Query/Store Messages                            │
│              │                                                 │
│  ┌───────────▼──────────────────────────────────────────┐    │
│  │  DynamoDB                                            │    │
│  │  ┌──────────────────────────────────────────────┐   │    │
│  │  │  Table: chat_messages                        │   │    │
│  │  │  Partition Key: room_id                      │   │    │
│  │  │  Sort Key: timestamp                         │   │    │
│  │  └──────────────────────────────────────────────┘   │    │
│  └────────────────────────────────────────────────────┘     │
│                                                               │
│  ┌──────────────────────────────────────────────────────┐    │
│  │  Cognito User Pool                                   │    │
│  │  - User Authentication                              │    │
│  │  - JWT Token Generation                             │    │
│  │  - Token Validation                                 │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **User Login**: Browser → Cognito → JWT Token
2. **WebSocket Connect**: Browser sends JWT in WebSocket URL
3. **Authentication**: Backend validates JWT from Cognito
4. **Message Send**: Browser sends message via WebSocket
5. **Message Store**: Backend stores in DynamoDB
6. **Broadcasting**: Backend sends to all connected users
7. **Display**: Browser receives and displays message

---

## 2. PROJECT FOLDER STRUCTURE

```
chat-app/
├── backend/
│   ├── app.py                    # FastAPI + WebSocket server
│   ├── config.py                 # Configuration (AWS, Cognito)
│   ├── auth.py                   # JWT validation
│   ├── db.py                     # DynamoDB operations
│   ├── models.py                 # Pydantic models
│   ├── requirements.txt          # Python dependencies
│   ├── .env.example              # Environment variables template
│   ├── .gitignore                # Git ignore file
│   └── startup.sh                # Startup script for EC2
│
├── frontend/
│   ├── index.html                # Single-page application
│   ├── styles.css                # Styling
│   ├── app.js                    # JavaScript logic
│   └── config.js                 # Frontend config
│
├── scripts/
│   ├── create_dynamodb_table.py  # DynamoDB setup
│   ├── cognito_setup.sh          # Cognito configuration
│   └── deploy.sh                 # Deployment automation
│
└── README.md                      # Quick start guide
```

---

## 3. BACKEND CODE (STEP-BY-STEP)

### Step 3.1: requirements.txt

```
fastapi==0.104.1
uvicorn==0.24.0
python-jose[cryptography]==3.3.0
python-dotenv==1.0.0
boto3==1.29.7
httpx==0.25.1
pydantic==2.5.0
```

**Install**: `pip install -r requirements.txt`

---

### Step 3.2: config.py

```python
import os
from dotenv import load_dotenv

load_dotenv()

# AWS Configuration
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")

# Cognito Configuration
COGNITO_REGION = os.getenv("COGNITO_REGION", "us-east-1")
COGNITO_USER_POOL_ID = os.getenv("COGNITO_USER_POOL_ID")
COGNITO_CLIENT_ID = os.getenv("COGNITO_CLIENT_ID")

# Cognito JWK URL (for token validation)
COGNITO_JWK_URL = (
    f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/"
    f"{COGNITO_USER_POOL_ID}/.well-known/jwks.json"
)

# DynamoDB Configuration
DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "chat_messages")
DYNAMODB_REGION = os.getenv("DYNAMODB_REGION", "us-east-1")

# FastAPI Configuration
API_TITLE = "Real-Time Chat Application"
API_VERSION = "1.0.0"
DEBUG = os.getenv("DEBUG", "False").lower() == "true"

# CORS (for CloudFront distribution domain)
FRONTEND_DOMAIN = os.getenv("FRONTEND_DOMAIN", "http://localhost:3000")
```

---

### Step 3.3: auth.py

```python
import httpx
import json
from jose import jwt, JWTError
from functools import lru_cache
import logging
from config import COGNITO_JWK_URL, COGNITO_REGION, COGNITO_USER_POOL_ID

logger = logging.getLogger(__name__)

class CognitoAuthenticator:
    """Handles JWT validation from AWS Cognito"""
    
    def __init__(self):
        self.jwk_client = None
        self.jwks = None
    
    async def get_jwks(self):
        """Fetch JWK set from Cognito"""
        if self.jwks:
            return self.jwks
        
        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(COGNITO_JWK_URL, timeout=5)
                response.raise_for_status()
                self.jwks = response.json()
                return self.jwks
        except Exception as e:
            logger.error(f"Error fetching JWKS: {e}")
            raise
    
    async def verify_token(self, token: str) -> dict:
        """
        Verify JWT token from Cognito
        
        Args:
            token: JWT token string
            
        Returns:
            Dictionary with decoded token data
            
        Raises:
            JWTError: If token is invalid
        """
        try:
            # Get JWK set
            jwks = await self.get_jwks()
            
            # Get header to find key ID
            unverified_header = jwt.get_unverified_header(token)
            kid = unverified_header.get("kid")
            
            if not kid:
                raise JWTError("Token header missing 'kid'")
            
            # Find matching key
            key = None
            for k in jwks.get("keys", []):
                if k.get("kid") == kid:
                    key = k
                    break
            
            if not key:
                raise JWTError(f"Unable to find a signing key that matches: {kid}")
            
            # Verify token
            payload = jwt.decode(
                token,
                json.dumps(key),
                algorithms=["RS256"],
                options={"verify_signature": True}
            )
            
            # Verify token is from correct user pool
            iss = payload.get("iss")
            expected_iss = f"https://cognito-idp.{COGNITO_REGION}.amazonaws.com/{COGNITO_USER_POOL_ID}"
            
            if iss != expected_iss:
                raise JWTError(f"Invalid issuer: {iss}")
            
            return payload
            
        except JWTError as e:
            logger.error(f"JWT validation failed: {e}")
            raise
        except Exception as e:
            logger.error(f"Token verification error: {e}")
            raise JWTError(f"Token verification failed: {e}")

# Global authenticator instance
authenticator = CognitoAuthenticator()

async def get_current_user(token: str) -> dict:
    """
    Dependency for validating JWT tokens
    
    Args:
        token: JWT token from WebSocket query parameter
        
    Returns:
        Decoded token payload with user info
    """
    payload = await authenticator.verify_token(token)
    username = payload.get("cognito:username")
    
    if not username:
        raise JWTError("Token missing cognito:username")
    
    return {
        "username": username,
        "user_id": payload.get("sub"),
        "token": token
    }
```

---

### Step 3.4: models.py

```python
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
```

---

### Step 3.5: db.py

```python
import boto3
import logging
from datetime import datetime
from config import DYNAMODB_TABLE, DYNAMODB_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
from models import MessageResponse

logger = logging.getLogger(__name__)

class DynamoDBManager:
    """Handles all DynamoDB operations"""
    
    def __init__(self):
        self.dynamodb = boto3.resource(
            "dynamodb",
            region_name=DYNAMODB_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY
        )
        self.table = self.dynamodb.Table(DYNAMODB_TABLE)
    
    async def store_message(self, room_id: str, username: str, text: str) -> bool:
        """
        Store chat message in DynamoDB
        
        Args:
            room_id: Chat room identifier
            username: Sender's username
            text: Message content
            
        Returns:
            True if successful
        """
        try:
            timestamp = datetime.utcnow().isoformat() + "Z"
            
            self.table.put_item(
                Item={
                    "room_id": room_id,
                    "timestamp": timestamp,
                    "username": username,
                    "text": text
                }
            )
            
            logger.info(f"Message stored - Room: {room_id}, User: {username}")
            return True
            
        except Exception as e:
            logger.error(f"Error storing message: {e}")
            return False
    
    async def get_messages(self, room_id: str, limit: int = 50) -> list:
        """
        Retrieve messages from a room
        
        Args:
            room_id: Chat room identifier
            limit: Maximum messages to retrieve
            
        Returns:
            List of MessageResponse objects
        """
        try:
            response = self.table.query(
                KeyConditionExpression="room_id = :room_id",
                ExpressionAttributeValues={":room_id": room_id},
                Limit=limit,
                ScanIndexForward=False  # Most recent first
            )
            
            messages = []
            for item in reversed(response.get("Items", [])):  # Reverse to chronological order
                messages.append(MessageResponse(**item))
            
            logger.info(f"Retrieved {len(messages)} messages from {room_id}")
            return messages
            
        except Exception as e:
            logger.error(f"Error retrieving messages: {e}")
            return []

# Global DynamoDB manager instance
db_manager = DynamoDBManager()
```

---

### Step 3.6: app.py

```python
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
```

---

### Step 3.7: .env.example

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_here
AWS_SECRET_ACCESS_KEY=your_secret_key_here

# Cognito Configuration
COGNITO_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=1234567890abcdefghijklmnop

# DynamoDB Configuration
DYNAMODB_TABLE=chat_messages
DYNAMODB_REGION=us-east-1

# FastAPI Configuration
DEBUG=False
FRONTEND_DOMAIN=https://your-cloudfront-domain.cloudfront.net
```

---

## 4. FRONTEND CODE

### Step 4.1: index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Real-Time Chat Application</title>
    <link rel="stylesheet" href="styles.css">
</head>
<body>
    <!-- Login Screen -->
    <div id="loginContainer" class="container login-container">
        <div class="login-card">
            <h1>Chat Application</h1>
            <p class="subtitle">Real-time messaging powered by AWS</p>
            
            <form id="loginForm">
                <div class="form-group">
                    <label for="username">Username</label>
                    <input 
                        type="text" 
                        id="username" 
                        name="username" 
                        placeholder="Enter your username"
                        required
                    >
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <input 
                        type="password" 
                        id="password" 
                        name="password" 
                        placeholder="Enter your password"
                        required
                    >
                </div>
                
                <button type="submit" class="btn btn-primary btn-block">
                    Login with Cognito
                </button>
            </form>
            
            <div id="loginError" class="error-message" style="display: none;"></div>
            
            <div class="login-info">
                <p>Demo credentials:</p>
                <p style="font-size: 12px; color: #666;">
                    Check AWS Cognito User Pool for test users
                </p>
            </div>
        </div>
    </div>

    <!-- Chat Screen -->
    <div id="chatContainer" class="container chat-container" style="display: none;">
        <div class="chat-header">
            <div class="header-content">
                <h1>Chat Room</h1>
                <p id="roomInfo">Room: <span id="roomName">general</span></p>
            </div>
            <div class="user-info">
                <span id="currentUser"></span>
                <button id="logoutBtn" class="btn btn-secondary">Logout</button>
            </div>
        </div>

        <div class="chat-main">
            <!-- Room Selection -->
            <div class="room-selector">
                <h3>Rooms</h3>
                <div class="room-list">
                    <button class="room-btn active" data-room="general">
                        # general
                    </button>
                    <button class="room-btn" data-room="random">
                        # random
                    </button>
                    <button class="room-btn" data-room="tech">
                        # tech
                    </button>
                </div>
            </div>

            <!-- Messages Display -->
            <div class="chat-messages" id="messagesContainer">
                <div class="messages-header">
                    <h2>Messages</h2>
                </div>
                <div id="messageList" class="message-list">
                    <!-- Messages appear here -->
                </div>
            </div>

            <!-- Message Input -->
            <div class="chat-input-section">
                <form id="messageForm">
                    <div class="input-group">
                        <input 
                            type="text" 
                            id="messageInput" 
                            placeholder="Type a message..."
                            autocomplete="off"
                        >
                        <button type="submit" class="btn btn-primary">
                            Send
                        </button>
                    </div>
                </form>
                <div id="connectionStatus" class="connection-status">
                    <span class="status-indicator disconnected"></span>
                    <span id="statusText">Disconnected</span>
                </div>
            </div>
        </div>
    </div>

    <!-- Loading Spinner -->
    <div id="loadingSpinner" class="loading-spinner" style="display: none;">
        <div class="spinner"></div>
        <p>Connecting...</p>
    </div>

    <script src="config.js"></script>
    <script src="app.js"></script>
</body>
</html>
```

---

### Step 4.2: styles.css

```css
* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #333;
}

.container {
    width: 100%;
    max-width: 1200px;
    height: 100vh;
}

/* ========== LOGIN SCREEN ========== */

.login-container {
    display: flex;
    align-items: center;
    justify-content: center;
}

.login-card {
    background: white;
    padding: 40px;
    border-radius: 12px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
    width: 100%;
    max-width: 400px;
}

.login-card h1 {
    color: #667eea;
    margin-bottom: 10px;
    font-size: 28px;
}

.subtitle {
    color: #888;
    margin-bottom: 30px;
    font-size: 14px;
}

.form-group {
    margin-bottom: 20px;
}

.form-group label {
    display: block;
    margin-bottom: 8px;
    font-weight: 500;
    color: #333;
}

.form-group input {
    width: 100%;
    padding: 12px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
    transition: border-color 0.3s;
}

.form-group input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.btn {
    padding: 12px 24px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.3s;
}

.btn-primary {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.btn-primary:hover {
    transform: translateY(-2px);
    box-shadow: 0 5px 20px rgba(102, 126, 234, 0.3);
}

.btn-secondary {
    background: #f0f0f0;
    color: #333;
}

.btn-secondary:hover {
    background: #e0e0e0;
}

.btn-block {
    width: 100%;
}

.error-message {
    background: #fee;
    color: #c33;
    padding: 12px;
    border-radius: 6px;
    margin-bottom: 20px;
    font-size: 14px;
}

.login-info {
    margin-top: 20px;
    padding-top: 20px;
    border-top: 1px solid #eee;
    text-align: center;
    color: #666;
    font-size: 12px;
}

/* ========== CHAT SCREEN ========== */

.chat-container {
    display: flex;
    flex-direction: column;
    background: white;
    overflow: hidden;
}

.chat-header {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    padding: 20px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
}

.header-content h1 {
    margin-bottom: 5px;
    font-size: 24px;
}

.header-content p {
    font-size: 12px;
    opacity: 0.9;
}

.user-info {
    display: flex;
    align-items: center;
    gap: 15px;
}

.user-info span {
    font-size: 14px;
}

#logoutBtn {
    padding: 8px 16px;
    font-size: 12px;
}

.chat-main {
    display: flex;
    flex: 1;
    overflow: hidden;
}

/* Room Selector */

.room-selector {
    width: 200px;
    background: #f9f9f9;
    border-right: 1px solid #ddd;
    padding: 20px;
    overflow-y: auto;
}

.room-selector h3 {
    color: #333;
    margin-bottom: 15px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 1px;
}

.room-list {
    display: flex;
    flex-direction: column;
    gap: 5px;
}

.room-btn {
    text-align: left;
    padding: 10px 12px;
    background: transparent;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: #666;
    font-size: 14px;
    transition: all 0.3s;
}

.room-btn:hover {
    background: #e8e8ff;
    color: #667eea;
}

.room-btn.active {
    background: #667eea;
    color: white;
    font-weight: 600;
}

/* Chat Messages */

.chat-messages {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
}

.messages-header {
    padding: 15px 20px;
    background: #f5f5f5;
    border-bottom: 1px solid #ddd;
}

.messages-header h2 {
    font-size: 16px;
    color: #333;
}

.message-list {
    flex: 1;
    overflow-y: auto;
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 12px;
}

.message {
    display: flex;
    flex-direction: column;
    max-width: 70%;
    word-wrap: break-word;
}

.message.own {
    align-self: flex-end;
}

.message-content {
    padding: 10px 15px;
    border-radius: 8px;
    font-size: 14px;
    line-height: 1.4;
}

.message.other .message-content {
    background: #f0f0f0;
    color: #333;
}

.message.own .message-content {
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
}

.message-meta {
    font-size: 12px;
    color: #999;
    margin-top: 5px;
}

.message.own .message-meta {
    text-align: right;
}

.message.system {
    align-self: center;
    max-width: none;
}

.message.system .message-content {
    background: transparent;
    color: #999;
    font-size: 12px;
    font-style: italic;
    text-align: center;
    padding: 5px 0;
}

/* Chat Input */

.chat-input-section {
    border-top: 1px solid #ddd;
    padding: 15px 20px;
    background: white;
}

.input-group {
    display: flex;
    gap: 10px;
}

.input-group input {
    flex: 1;
    padding: 12px 15px;
    border: 1px solid #ddd;
    border-radius: 6px;
    font-size: 14px;
}

.input-group input:focus {
    outline: none;
    border-color: #667eea;
    box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.input-group button {
    padding: 12px 24px;
    min-width: 80px;
}

.connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 12px;
    color: #666;
}

.status-indicator {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    animation: pulse 2s infinite;
}

.status-indicator.connected {
    background: #4caf50;
}

.status-indicator.disconnected {
    background: #f44336;
    animation: none;
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

/* Loading Spinner */

.loading-spinner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 1000;
}

.spinner {
    width: 50px;
    height: 50px;
    border: 4px solid rgba(255, 255, 255, 0.3);
    border-top: 4px solid white;
    border-radius: 50%;
    animation: spin 1s linear infinite;
}

@keyframes spin {
    0% {
        transform: rotate(0deg);
    }
    100% {
        transform: rotate(360deg);
    }
}

.loading-spinner p {
    color: white;
    margin-top: 20px;
    font-size: 16px;
}

/* Responsive */

@media (max-width: 768px) {
    .room-selector {
        width: 100px;
        padding: 10px;
    }
    
    .room-btn {
        font-size: 12px;
        padding: 8px;
    }
    
    .message {
        max-width: 85%;
    }
    
    .login-card {
        max-width: 90%;
        padding: 30px 20px;
    }
}
```

---

### Step 4.3: config.js

```javascript
// Frontend Configuration

const CONFIG = {
    // AWS Cognito
    COGNITO_REGION: "us-east-1",
    COGNITO_USER_POOL_ID: "us-east-1_xxxxxxxxx",
    COGNITO_CLIENT_ID: "1234567890abcdefghijklmnop",
    COGNITO_DOMAIN: "your-domain.auth.us-east-1.amazoncognito.com",
    
    // Backend API
    // For local development:
    // API_GATEWAY_ENDPOINT: "ws://localhost:8000",
    // API_REST_ENDPOINT: "http://localhost:8000",
    
    // For production (CloudFront):
    API_GATEWAY_ENDPOINT: "wss://your-cloudfront-domain.cloudfront.net",
    API_REST_ENDPOINT: "https://your-cloudfront-domain.cloudfront.net",
    
    // WebSocket configuration
    WEBSOCKET_RECONNECT_DELAY: 3000,  // 3 seconds
    WEBSOCKET_MAX_RETRIES: 5,
    
    // UI
    DEFAULT_ROOM: "general",
    MESSAGE_LOAD_LIMIT: 50
};

// Helper: Get Cognito authorization code URL
function getCognitoAuthUrl() {
    const redirectUri = window.location.origin;
    const params = new URLSearchParams({
        client_id: CONFIG.COGNITO_CLIENT_ID,
        response_type: "code",
        scope: "openid profile email",
        redirect_uri: redirectUri
    });
    
    return `https://${CONFIG.COGNITO_DOMAIN}/oauth2/authorize?${params.toString()}`;
}
```

---

### Step 4.4: app.js

```javascript
// Real-Time Chat Application - Frontend

class ChatApp {
    constructor() {
        this.username = null;
        this.token = null;
        this.currentRoom = CONFIG.DEFAULT_ROOM;
        this.websocket = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        
        this.initializeElements();
        this.attachEventListeners();
        this.checkAuthenticationStatus();
    }
    
    initializeElements() {
        // Login elements
        this.loginForm = document.getElementById("loginForm");
        this.loginContainer = document.getElementById("loginContainer");
        this.loginError = document.getElementById("loginError");
        this.usernameInput = document.getElementById("username");
        this.passwordInput = document.getElementById("password");
        
        // Chat elements
        this.chatContainer = document.getElementById("chatContainer");
        this.messageForm = document.getElementById("messageForm");
        this.messageInput = document.getElementById("messageInput");
        this.messageList = document.getElementById("messageList");
        this.currentUserSpan = document.getElementById("currentUser");
        this.roomNameSpan = document.getElementById("roomName");
        this.statusText = document.getElementById("statusText");
        this.statusIndicator = document.querySelector(".status-indicator");
        this.logoutBtn = document.getElementById("logoutBtn");
        this.roomButtons = document.querySelectorAll(".room-btn");
        this.loadingSpinner = document.getElementById("loadingSpinner");
    }
    
    attachEventListeners() {
        // Login
        this.loginForm.addEventListener("submit", (e) => this.handleLogin(e));
        
        // Chat
        this.messageForm.addEventListener("submit", (e) => this.handleSendMessage(e));
        this.logoutBtn.addEventListener("click", () => this.handleLogout());
        
        // Room selection
        this.roomButtons.forEach(btn => {
            btn.addEventListener("click", () => this.switchRoom(btn.dataset.room));
        });
    }
    
    checkAuthenticationStatus() {
        const token = localStorage.getItem("token");
        const username = localStorage.getItem("username");
        
        if (token && username) {
            this.token = token;
            this.username = username;
            this.showChatUI();
            this.connectWebSocket();
            this.loadMessageHistory();
        }
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const username = this.usernameInput.value.trim();
        const password = this.passwordInput.value;
        
        if (!username || !password) {
            this.showLoginError("Please enter username and password");
            return;
        }
        
        this.showLoadingSpinner();
        
        try {
            // In production, this would authenticate with AWS Cognito
            // For demo, we'll simulate getting a token
            const token = await this.authenticateWithCognito(username, password);
            
            if (token) {
                this.username = username;
                this.token = token;
                
                // Save to localStorage
                localStorage.setItem("token", token);
                localStorage.setItem("username", username);
                
                // Show chat UI
                this.showChatUI();
                
                // Connect WebSocket
                this.connectWebSocket();
                
                // Load message history
                this.loadMessageHistory();
            }
        } catch (error) {
            this.showLoginError(`Login failed: ${error.message}`);
        } finally {
            this.hideLoadingSpinner();
        }
    }
    
    async authenticateWithCognito(username, password) {
        // This is a simplified version for demo
        // In production, use AWS Amplify or AWS SDK for proper Cognito authentication
        
        try {
            // For demo, we'll create a mock JWT token
            // In production, authenticate with Cognito User Pool
            
            // Mock authentication - replace with real Cognito call
            const mockToken = btoa(JSON.stringify({
                sub: "mock-user-id",
                username: username,
                iss: `https://cognito-idp.${CONFIG.COGNITO_REGION}.amazonaws.com/${CONFIG.COGNITO_USER_POOL_ID}`,
                aud: CONFIG.COGNITO_CLIENT_ID,
                token_use: "id",
                auth_time: Math.floor(Date.now() / 1000),
                exp: Math.floor(Date.now() / 1000) + 3600
            }));
            
            return mockToken;
            
            // Real Cognito authentication would be:
            // const response = await fetch('https://your-cognito-domain/oauth2/authorize?...');
            
        } catch (error) {
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }
    
    showChatUI() {
        this.loginContainer.style.display = "none";
        this.chatContainer.style.display = "flex";
        this.currentUserSpan.textContent = `Welcome, ${this.username}!`;
    }
    
    connectWebSocket() {
        const wsUrl = `${CONFIG.API_GATEWAY_ENDPOINT}/ws/${this.currentRoom}?token=${this.token}`;
        
        console.log(`Connecting to WebSocket: ${wsUrl}`);
        
        this.websocket = new WebSocket(wsUrl);
        
        this.websocket.onopen = () => {
            console.log("WebSocket connected");
            this.isConnected = true;
            this.updateConnectionStatus(true);
            this.reconnectAttempts = 0;
        };
        
        this.websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessageReceived(message);
            } catch (error) {
                console.error("Error parsing message:", error);
            }
        };
        
        this.websocket.onerror = (error) => {
            console.error("WebSocket error:", error);
            this.updateConnectionStatus(false);
        };
        
        this.websocket.onclose = () => {
            console.log("WebSocket disconnected");
            this.isConnected = false;
            this.updateConnectionStatus(false);
            this.attemptReconnect();
        };
    }
    
    attemptReconnect() {
        if (this.reconnectAttempts < CONFIG.WEBSOCKET_MAX_RETRIES) {
            this.reconnectAttempts++;
            const delay = CONFIG.WEBSOCKET_RECONNECT_DELAY * this.reconnectAttempts;
            
            console.log(`Attempting to reconnect in ${delay}ms...`);
            setTimeout(() => this.connectWebSocket(), delay);
        } else {
            this.showLoginError("Failed to connect. Please refresh the page.");
        }
    }
    
    handleMessageReceived(message) {
        const { type, username, text, timestamp } = message;
        
        if (type === "system") {
            this.displaySystemMessage(text);
        } else if (type === "message") {
            this.displayMessage(username, text, timestamp);
        }
    }
    
    displayMessage(username, text, timestamp) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message";
        
        if (username === this.username) {
            messageDiv.classList.add("own");
        } else {
            messageDiv.classList.add("other");
        }
        
        const time = new Date(timestamp).toLocaleTimeString();
        
        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
            <div class="message-meta">${username} • ${time}</div>
        `;
        
        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }
    
    displaySystemMessage(text) {
        const messageDiv = document.createElement("div");
        messageDiv.className = "message system";
        
        messageDiv.innerHTML = `
            <div class="message-content">${this.escapeHtml(text)}</div>
        `;
        
        this.messageList.appendChild(messageDiv);
        this.messageList.scrollTop = this.messageList.scrollHeight;
    }
    
    async handleSendMessage(e) {
        e.preventDefault();
        
        const text = this.messageInput.value.trim();
        
        if (!text || !this.isConnected) {
            return;
        }
        
        try {
            const message = {
                text: text,
                room_id: this.currentRoom
            };
            
            this.websocket.send(JSON.stringify(message));
            this.messageInput.value = "";
        } catch (error) {
            console.error("Error sending message:", error);
            this.showLoginError("Failed to send message");
        }
    }
    
    async loadMessageHistory() {
        try {
            const url = `${CONFIG.API_REST_ENDPOINT}/rooms/${this.currentRoom}/messages?limit=${CONFIG.MESSAGE_LOAD_LIMIT}`;
            
            const response = await fetch(url, {
                headers: {
                    "Authorization": `Bearer ${this.token}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const data = await response.json();
            
            // Clear current messages
            this.messageList.innerHTML = "";
            
            // Load historical messages
            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(msg => {
                    this.displayMessage(msg.username, msg.text, msg.timestamp);
                });
            }
        } catch (error) {
            console.error("Error loading message history:", error);
        }
    }
    
    switchRoom(roomId) {
        // Update active button
        this.roomButtons.forEach(btn => btn.classList.remove("active"));
        document.querySelector(`[data-room="${roomId}"]`).classList.add("active");
        
        // Update current room
        this.currentRoom = roomId;
        this.roomNameSpan.textContent = roomId;
        
        // Disconnect old WebSocket
        if (this.websocket) {
            this.websocket.close();
        }
        
        // Clear messages
        this.messageList.innerHTML = "";
        
        // Load new room history and connect
        this.loadMessageHistory();
        this.connectWebSocket();
    }
    
    updateConnectionStatus(connected) {
        if (connected) {
            this.statusIndicator.classList.add("connected");
            this.statusIndicator.classList.remove("disconnected");
            this.statusText.textContent = "Connected";
        } else {
            this.statusIndicator.classList.remove("connected");
            this.statusIndicator.classList.add("disconnected");
            this.statusText.textContent = "Disconnected";
        }
    }
    
    handleLogout() {
        localStorage.removeItem("token");
        localStorage.removeItem("username");
        
        if (this.websocket) {
            this.websocket.close();
        }
        
        this.chatContainer.style.display = "none";
        this.loginContainer.style.display = "flex";
        
        this.usernameInput.value = "";
        this.passwordInput.value = "";
        this.messageList.innerHTML = "";
    }
    
    showLoginError(message) {
        this.loginError.textContent = message;
        this.loginError.style.display = "block";
    }
    
    showLoadingSpinner() {
        this.loadingSpinner.style.display = "flex";
    }
    
    hideLoadingSpinner() {
        this.loadingSpinner.style.display = "none";
    }
    
    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener("DOMContentLoaded", () => {
    window.chatApp = new ChatApp();
});
```

---

## 5. DATABASE SETUP

### Step 5.1: Create DynamoDB Table

Create file `scripts/create_dynamodb_table.py`:

```python
import boto3
import sys
from botocore.exceptions import ClientError

def create_table(table_name, region_name="us-east-1"):
    """Create DynamoDB table for chat messages"""
    
    dynamodb = boto3.client(
        "dynamodb",
        region_name=region_name
    )
    
    try:
        response = dynamodb.create_table(
            TableName=table_name,
            KeySchema=[
                {
                    "AttributeName": "room_id",
                    "KeyType": "HASH"  # Partition key
                },
                {
                    "AttributeName": "timestamp",
                    "KeyType": "RANGE"  # Sort key
                }
            ],
            AttributeDefinitions=[
                {
                    "AttributeName": "room_id",
                    "AttributeType": "S"  # String
                },
                {
                    "AttributeName": "timestamp",
                    "AttributeType": "S"  # String (ISO format)
                }
            ],
            BillingMode="PAY_PER_REQUEST",  # On-demand pricing
            Tags=[
                {"Key": "Project", "Value": "ChatApp"},
                {"Key": "Environment", "Value": "Production"}
            ]
        )
        
        print(f"✓ Table '{table_name}' created successfully")
        print(f"  Status: {response['TableDescription']['TableStatus']}")
        print(f"  ARN: {response['TableDescription']['TableArn']}")
        
        return response
        
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceInUseException":
            print(f"✓ Table '{table_name}' already exists")
            return None
        else:
            print(f"✗ Error creating table: {e}")
            sys.exit(1)

if __name__ == "__main__":
    table_name = "chat_messages"
    region = "us-east-1"
    
    print(f"Creating DynamoDB table: {table_name}")
    print(f"Region: {region}\n")
    
    create_table(table_name, region)
```

**Run**: 
```bash
python scripts/create_dynamodb_table.py
```

**Expected Output**:
```
Creating DynamoDB table: chat_messages
Region: us-east-1

✓ Table 'chat_messages' created successfully
  Status: CREATING
  ARN: arn:aws:dynamodb:us-east-1:123456789012:table/chat_messages
```

---

## 6. COGNITO SETUP

### Step 6.1: Create User Pool (AWS Console or CLI)

**Via AWS CLI**:

```bash
# Create user pool
aws cognito-idp create-user-pool \
  --pool-name ChatAppUserPool \
  --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":false,"RequireLowercase":false,"RequireNumbers":false,"RequireSymbols":false}}' \
  --region us-east-1

# Create app client
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_xxxxxxxxx \
  --client-name ChatAppClient \
  --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --region us-east-1

# Create test user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_xxxxxxxxx \
  --username testuser \
  --message-action SUPPRESS \
  --temporary-password TempPassword123! \
  --region us-east-1

# Set permanent password
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_xxxxxxxxx \
  --username testuser \
  --password password123 \
  --permanent \
  --region us-east-1
```

### Step 6.2: Update config.py with Cognito values

```bash
# Copy .env.example to .env
cp backend/.env.example backend/.env

# Edit .env with your Cognito credentials
nano backend/.env
```

Fill in:
- `COGNITO_USER_POOL_ID`: From AWS Cognito console
- `COGNITO_CLIENT_ID`: From App Client settings
- `COGNITO_REGION`: Your AWS region

---

## 7. EC2 DEPLOYMENT STEPS

### Step 7.1: Launch EC2 Instance

```bash
# Create security group
aws ec2 create-security-group \
  --group-name chat-app-sg \
  --description "Security group for Chat App" \
  --region us-east-1

# Authorize inbound traffic (HTTP, HTTPS, SSH)
aws ec2 authorize-security-group-ingress \
  --group-name chat-app-sg \
  --protocol tcp \
  --port 22 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

aws ec2 authorize-security-group-ingress \
  --group-name chat-app-sg \
  --protocol tcp \
  --port 80 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

aws ec2 authorize-security-group-ingress \
  --group-name chat-app-sg \
  --protocol tcp \
  --port 443 \
  --cidr 0.0.0.0/0 \
  --region us-east-1

# Launch instance (Ubuntu 24.04 LTS)
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --key-name your-key-pair \
  --security-groups chat-app-sg \
  --region us-east-1
```

### Step 7.2: Connect and Setup Backend

```bash
# SSH into instance
ssh -i your-key.pem ubuntu@your-instance-ip

# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y python3-pip python3-venv git nginx

# Clone/upload backend code
git clone your-repo-url /home/ubuntu/chat-app-backend
cd /home/ubuntu/chat-app-backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install Python dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env
nano .env  # Fill in AWS credentials and Cognito config
```

### Step 7.3: Create Systemd Service

Create `/etc/systemd/system/chat-app.service`:

```ini
[Unit]
Description=Real-Time Chat Application
After=network.target

[Service]
Type=notify
User=ubuntu
WorkingDirectory=/home/ubuntu/chat-app-backend
Environment="PATH=/home/ubuntu/chat-app-backend/venv/bin"
ExecStart=/home/ubuntu/chat-app-backend/venv/bin/uvicorn app:app \
    --host 0.0.0.0 \
    --port 8000 \
    --workers 4

Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable chat-app
sudo systemctl start chat-app
sudo systemctl status chat-app
```

**Output**:
```
● chat-app.service - Real-Time Chat Application
     Loaded: loaded (/etc/systemd/system/chat-app.service; enabled; vendor preset: enabled)
     Active: active (running) since Mon 2024-01-15 10:30:00 UTC
   Main PID: 1234 (uvicorn)
      Tasks: 10 (limit: 1024)
     Memory: 150M
        CPU: 2.5%
```

### Step 7.4: Configure Nginx Reverse Proxy

Create `/etc/nginx/sites-available/chat-app`:

```nginx
upstream chat_app {
    server 127.0.0.1:8000;
}

server {
    listen 80;
    server_name _;
    client_max_body_size 10M;

    location / {
        proxy_pass http://chat_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }

    location /health {
        proxy_pass http://chat_app/health;
        access_log off;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/chat-app /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 7.5: Test Backend

```bash
# Health check
curl http://localhost/health

# Expected output:
{"status":"healthy","version":"1.0.0"}
```

---

## 8. S3 + CLOUDFRONT DEPLOYMENT

### Step 8.1: Create S3 Bucket

```bash
# Create bucket
aws s3 mb s3://my-chat-app-frontend --region us-east-1

# Block public access (CloudFront will access it)
aws s3api put-public-access-block \
  --bucket my-chat-app-frontend \
  --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket my-chat-app-frontend \
  --versioning-configuration Status=Enabled
```

### Step 8.2: Upload Frontend Files

```bash
# Update config.js with your CloudFront domain (we'll get it next)
# For now, use placeholder values

# Upload files to S3
aws s3 sync frontend/ s3://my-chat-app-frontend/ \
  --delete \
  --cache-control "public, max-age=3600"

# Verify upload
aws s3 ls s3://my-chat-app-frontend/
```

**Output**:
```
2024-01-15 10:30:00    1024 index.html
2024-01-15 10:30:01   15360 styles.css
2024-01-15 10:30:01   45280 app.js
2024-01-15 10:30:01    2048 config.js
```

### Step 8.3: Create CloudFront Distribution

```bash
# Create origin access identity
aws cloudfront create-cloud-front-origin-access-identity \
  --cloud-front-origin-access-identity-config CallerReference=chat-app-$(date +%s) \
  --region us-east-1

# Save the OAI ID
OAI_ID="E2P3EXAMPLE"

# Update S3 bucket policy for CloudFront access
cat > bucket-policy.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::cloudfront:user/CloudFront Origin Access Identity $OAI_ID"
      },
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::my-chat-app-frontend/*"
    }
  ]
}
EOF

aws s3api put-bucket-policy \
  --bucket my-chat-app-frontend \
  --policy file://bucket-policy.json

# Create CloudFront distribution config
cat > distribution-config.json <<'EOF'
{
  "CallerReference": "chat-app-distribution",
  "Comment": "Chat Application CloudFront Distribution",
  "Enabled": true,
  "Origins": {
    "Quantity": 2,
    "Items": [
      {
        "Id": "S3-Frontend",
        "DomainName": "my-chat-app-frontend.s3.us-east-1.amazonaws.com",
        "S3OriginConfig": {
          "OriginAccessIdentity": "origin-access-identity/cloudfront/E2P3EXAMPLE"
        }
      },
      {
        "Id": "EC2-Backend",
        "DomainName": "your-ec2-instance-ip.compute-1.amazonaws.com",
        "CustomOriginConfig": {
          "HTTPPort": 80,
          "HTTPSPort": 443,
          "OriginProtocolPolicy": "http-only"
        }
      }
    ]
  },
  "DefaultRootObject": "index.html",
  "DefaultCacheBehavior": {
    "TargetOriginId": "S3-Frontend",
    "ViewerProtocolPolicy": "redirect-to-https",
    "TrustedSigners": {
      "Enabled": false,
      "Quantity": 0
    },
    "ForwardedValues": {
      "QueryString": false,
      "Cookies": {
        "Forward": "none"
      }
    },
    "MinTTL": 0,
    "DefaultTTL": 3600,
    "MaxTTL": 86400
  },
  "CacheBehaviors": [
    {
      "PathPattern": "/ws/*",
      "TargetOriginId": "EC2-Backend",
      "ViewerProtocolPolicy": "wss-only",
      "TrustedSigners": {
        "Enabled": false,
        "Quantity": 0
      },
      "ForwardedValues": {
        "QueryString": true,
        "Cookies": {
          "Forward": "all"
        },
        "Headers": {
          "Quantity": 1,
          "Items": ["Authorization"]
        }
      },
      "AllowedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      },
      "Compress": true,
      "MinTTL": 0,
      "DefaultTTL": 0,
      "MaxTTL": 0
    },
    {
      "PathPattern": "/rooms/*",
      "TargetOriginId": "EC2-Backend",
      "ViewerProtocolPolicy": "https-only",
      "TrustedSigners": {
        "Enabled": false,
        "Quantity": 0
      },
      "ForwardedValues": {
        "QueryString": true,
        "Cookies": {
          "Forward": "all"
        },
        "Headers": {
          "Quantity": 1,
          "Items": ["Authorization"]
        }
      },
      "AllowedMethods": {
        "Quantity": 2,
        "Items": ["GET", "HEAD"]
      },
      "Compress": true,
      "MinTTL": 0,
      "DefaultTTL": 60,
      "MaxTTL": 300
    }
  ],
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [
      {
        "ErrorCode": 404,
        "ResponsePagePath": "/index.html",
        "ResponseCode": "200",
        "ErrorCachingMinTTL": 300
      }
    ]
  }
}
EOF

# Create distribution
aws cloudfront create-distribution \
  --distribution-config file://distribution-config.json \
  --region us-east-1
```

### Step 8.4: Update Frontend Config with CloudFront Domain

After CloudFront is created, update `frontend/config.js`:

```javascript
const CONFIG = {
    // ... other settings ...
    
    // Update these with your CloudFront domain:
    API_GATEWAY_ENDPOINT: "wss://d111111abcdef8.cloudfront.net",
    API_REST_ENDPOINT: "https://d111111abcdef8.cloudfront.net",
};
```

Redeploy:

```bash
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete
```

---

## 9. HOW TO TEST THE COMPLETE SYSTEM

### Step 9.1: Local Development Testing

```bash
# Terminal 1: Backend
cd backend
source venv/bin/activate
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Output:
# INFO:     Uvicorn running on http://0.0.0.0:8000
# INFO:     Application startup complete

# Terminal 2: Frontend
# Open http://localhost:3000 in browser
# (Use simple Python HTTP server if needed)
cd frontend
python -m http.server 3000

# Open in browser
# http://localhost:3000
```

### Step 9.2: Test Login Flow

```
1. Go to http://localhost:3000
2. Enter username: testuser
3. Enter password: password123
4. Click "Login with Cognito"
5. Should show chat interface
6. User status should show "Welcome, testuser!"
```

### Step 9.3: Test WebSocket Connection

```
1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter by "WS" (WebSocket)
4. Send a message: "Hello World"
5. Should see:
   - WebSocket connection established
   - Message sent: {"text":"Hello World", "room_id":"general"}
   - Message received with your username and timestamp
```

### Step 9.4: Test Multiple Users

```bash
# Terminal 1: User A
# Login as testuser
# Send message: "Hello from A"

# Terminal 2: User B (new browser window/incognito)
# Login as another user
# Should see message from User A
# Send message: "Hello from B"
# User A should see it in real-time
```

### Step 9.5: Test Room Switching

```
1. User A in "general" room sends: "Message in general"
2. Click "#random" room
3. Send message: "Message in random"
4. Switch back to "general"
5. Should see old "Message in general"
6. Switch to "random"
7. Should see "Message in random"
```

### Step 9.6: Test Message History

```bash
# Check DynamoDB messages
aws dynamodb scan \
  --table-name chat_messages \
  --region us-east-1

# Expected output:
{
    "Items": [
        {
            "room_id": {"S": "general"},
            "timestamp": {"S": "2024-01-15T10:30:00Z"},
            "username": {"S": "testuser"},
            "text": {"S": "Hello from A"}
        },
        ...
    ],
    "Count": 5,
    "ScannedCount": 5
}
```

### Step 9.7: Test Connection Stability

```
1. Send 10 messages rapidly
2. All should arrive in correct order
3. Disconnect (close browser)
4. Reconnect
5. Message history should load
6. Should see "testuser joined the chat" message
```

### Step 9.8: Test on Deployed System

```bash
# Update config.js with CloudFront domain
# Upload to S3
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete

# Test CloudFront URL
# https://d111111abcdef8.cloudfront.net

# Check CloudFront cache
aws cloudfront list-distributions

# Invalidate cache if needed
aws cloudfront create-invalidation \
  --distribution-id E123ABCD \
  --paths "/*"
```

### Step 9.9: Monitor Logs

```bash
# Backend logs
ssh ubuntu@your-ec2-ip
journalctl -u chat-app -f

# Output:
# INFO:     Connection from 203.0.113.45:54321
# INFO:     Message broadcast - User: testuser, Room: general
# INFO:     Client disconnected from room: general

# Application logs
tail -f /var/log/nginx/access.log
```

### Step 9.10: Load Testing

```bash
# Test with multiple concurrent connections
# Using Apache Bench or similar tool

ab -n 100 -c 10 http://ec2-instance-ip/health

# Output:
# Requests per second: 1234.56 [#/sec] (mean)
# Transfer rate: 567.89 [Kbytes/sec] received
```

---

## QUICK REFERENCE: COMMON COMMANDS

### Backend
```bash
# Run locally
uvicorn app:app --host 0.0.0.0 --port 8000 --reload

# Check service status
sudo systemctl status chat-app

# View logs
journalctl -u chat-app -f

# Restart service
sudo systemctl restart chat-app
```

### Database
```bash
# Query messages
aws dynamodb scan --table-name chat_messages --region us-east-1

# Delete all messages (CAREFUL!)
aws dynamodb scan --table-name chat_messages --region us-east-1 | \
  jq '.Items[] | {room_id, timestamp}' | \
  xargs -I {} aws dynamodb delete-item --table-name chat_messages --key '{}'
```

### Frontend
```bash
# Upload to S3
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id E123ABCD --paths "/*"

# Check deployment
curl https://d111111abcdef8.cloudfront.net/health
```

### Cognito
```bash
# Create test user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_xxxxxxxxx \
  --username alice \
  --message-action SUPPRESS

# Set password
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_xxxxxxxxx \
  --username alice \
  --password Password123! \
  --permanent
```

---

## TROUBLESHOOTING

### WebSocket Connection Fails
```
Problem: "WebSocket connection rejected: invalid token"
Solution: 
- Check token hasn't expired
- Verify Cognito credentials in .env
- Check COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID
```

### Messages Not Storing in DynamoDB
```
Problem: "Error storing message"
Solution:
- Check AWS credentials in .env
- Verify DynamoDB table exists
- Check IAM permissions for DynamoDB access
```

### CloudFront Returns 404
```
Problem: "404 Not Found" for frontend
Solution:
- Check S3 bucket policy
- Verify Origin Access Identity
- Ensure index.html exists in S3
- Invalidate CloudFront cache
```

### High Latency in Chat
```
Problem: Messages delayed
Solution:
- Check EC2 CPU/memory usage
- Scale EC2 instance (t3.large)
- Enable message compression
- Check DynamoDB throttling
```

---

## DEPLOYMENT CHECKLIST

- [ ] DynamoDB table created
- [ ] Cognito User Pool and App Client created
- [ ] Test users created in Cognito
- [ ] EC2 instance running
- [ ] Backend service active
- [ ] Nginx reverse proxy configured
- [ ] S3 bucket created and configured
- [ ] CloudFront distribution created and active
- [ ] Frontend deployed to S3
- [ ] CloudFront domain updated in config.js
- [ ] Health checks passing
- [ ] WebSocket connections working
- [ ] Messages storing in DynamoDB
- [ ] Multi-user testing complete

---

## NEXT STEPS

1. **Add SSL Certificate** - Use AWS Certificate Manager for HTTPS
2. **Setup CloudWatch** - Monitor application metrics and logs
3. **Add Database Backups** - Enable point-in-time recovery on DynamoDB
4. **Implement Rate Limiting** - Prevent abuse
5. **Add User Presence** - Show who's online
6. **Add Typing Indicators** - Show when users are typing
7. **Add File Sharing** - Upload files to S3
8. **Add Search** - Search message history
9. **Add Push Notifications** - Alert users to new messages
10. **Add Analytics** - Track usage patterns

---

**End of Guide**

Deployment Status: READY FOR PRODUCTION
Last Updated: 2024-01-15
Version: 1.0.0
