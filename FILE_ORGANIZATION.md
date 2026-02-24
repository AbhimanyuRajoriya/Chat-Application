# Real-Time Chat Application - File Organization

## Complete Project Structure

```
chat-app/
│
├── DOCUMENTATION
│   ├── CHAT_APP_GUIDE.md          ← 9-section complete deployment guide
│   ├── QUICKSTART.md              ← Quick start instructions
│   └── FILE_ORGANIZATION.md       ← This file
│
├── BACKEND
│   ├── app.py                     ← FastAPI + WebSocket server
│   ├── config.py                  ← AWS & application configuration
│   ├── auth.py                    ← JWT token validation (Cognito)
│   ├── models.py                  ← Pydantic data models
│   ├── db.py                      ← DynamoDB operations
│   ├── requirements.txt           ← Python dependencies
│   └── .env.example               ← Environment variables template
│
└── FRONTEND
    ├── index.html                 ← Single-page application
    ├── styles.css                 ← Complete styling
    ├── app.js                     ← Main application logic
    └── config.js                  ← Frontend configuration
```

---

## File Descriptions

### DOCUMENTATION FILES

#### CHAT_APP_GUIDE.md (Main Reference)
**Length**: ~1000 lines  
**Content**: Complete production-ready guide with 9 sections:
1. Architecture overview with diagrams
2. Project folder structure
3. Backend code (step-by-step, fully commented)
4. Frontend code with explanations
5. DynamoDB setup with example commands
6. Cognito configuration instructions
7. EC2 deployment with systemd service
8. S3 + CloudFront deployment
9. Complete testing procedures

**Use When**: Setting up production environment or understanding full architecture

#### QUICKSTART.md
**Length**: ~300 lines  
**Content**: Quick reference guide
- Overview of all files
- Local development setup (5 minutes)
- AWS deployment overview
- Common commands
- Testing checklist
- Troubleshooting tips

**Use When**: Getting started quickly or checking commands

---

### BACKEND FILES

#### app.py
**Lines**: ~250  
**Language**: Python (FastAPI)  
**Purpose**: Main application server  
**Contains**:
- FastAPI application initialization
- WebSocket endpoint with authentication
- Message broadcasting to all clients in a room
- Connection manager class
- Health check and message history endpoints
- CORS middleware configuration
- Error handlers

**Key Functions**:
- `websocket_endpoint()` - Main WebSocket handler
- `ConnectionManager.broadcast()` - Send to all users
- `health_check()` - Health status
- `get_room_messages()` - Retrieve message history

**Run Command**:
```bash
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

---

#### config.py
**Lines**: ~30  
**Language**: Python  
**Purpose**: Centralized configuration  
**Contains**:
- AWS region settings
- Cognito pool and client IDs
- DynamoDB table name
- FastAPI metadata
- CORS allowed origins
- Cognito JWK URL

**Use**: Import with `from config import AWS_REGION, COGNITO_USER_POOL_ID, ...`

**Example .env**:
```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
COGNITO_USER_POOL_ID=us-east-1_abc123def456
COGNITO_CLIENT_ID=1234567890abcdefghijklmnop
```

---

#### auth.py
**Lines**: ~100  
**Language**: Python  
**Purpose**: JWT token validation from AWS Cognito  
**Contains**:
- `CognitoAuthenticator` class with async methods
- Token verification against Cognito JWKS
- Issuer validation
- Error handling

**Key Functions**:
- `verify_token()` - Validate JWT from Cognito
- `get_jwks()` - Fetch public keys from Cognito

**How It Works**:
1. Receives JWT token from WebSocket URL
2. Fetches JWK set from Cognito
3. Finds matching key by 'kid' header
4. Verifies signature using RS256
5. Validates issuer matches user pool
6. Returns decoded token payload

---

#### models.py
**Lines**: ~50  
**Language**: Python (Pydantic)  
**Purpose**: Data validation schemas  
**Contains**:
- `ChatMessage` - WebSocket message model
- `TokenData` - Decoded token model
- `MessageResponse` - Database message model

**Usage**:
```python
from models import ChatMessage
message = ChatMessage(username="alice", text="Hello", room_id="general")
```

---

#### db.py
**Lines**: ~100  
**Language**: Python (boto3)  
**Purpose**: DynamoDB operations  
**Contains**:
- `DynamoDBManager` class
- Message storage with timestamp
- Message retrieval with sorting
- Error handling and logging

**Key Methods**:
- `store_message()` - Save message to DynamoDB
- `get_messages()` - Retrieve room messages

**DynamoDB Table Structure**:
```
Table: chat_messages
├─ Partition Key: room_id (String)
├─ Sort Key: timestamp (String, ISO format)
├─ Attributes:
│  ├─ username (String)
│  └─ text (String)
└─ Billing: Pay-per-request
```

---

#### requirements.txt
**Lines**: ~7  
**Language**: Plain text  
**Purpose**: Python package dependencies  
**Contains**:
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

#### .env.example
**Lines**: ~15  
**Language**: Plain text (shell format)  
**Purpose**: Template for environment variables  
**Use**: Copy to `.env` and fill in your values

**Example**:
```bash
cp .env.example .env
nano .env  # Edit with your credentials
```

**Never commit** `.env` to version control!

---

### FRONTEND FILES

#### index.html
**Lines**: ~180  
**Language**: HTML5  
**Purpose**: Single-page application structure  
**Contains**:
- Login screen with form
- Chat interface with:
  - Room selector
  - Message display area
  - Message input form
  - Connection status indicator
- Loading spinner
- Links to CSS and JavaScript

**Key IDs**:
- `#loginContainer` - Login UI
- `#chatContainer` - Chat UI
- `#messageList` - Messages display
- `#messageInput` - Text input field
- `#roomButtons` - Room selector buttons

---

#### styles.css
**Lines**: ~600  
**Language**: CSS3  
**Purpose**: Complete styling and animations  
**Includes**:
- Login screen styling
- Chat interface layout (flexbox)
- Message bubbles (different for own/other)
- Room selector sidebar
- Connection status indicator with pulse animation
- Loading spinner with rotation animation
- Responsive design for mobile
- Gradient background
- Color scheme: Purple (#667eea) + Pink (#764ba2)

**Key Classes**:
- `.message.own` - Sent messages (right-aligned, purple)
- `.message.other` - Received messages (left-aligned, gray)
- `.message.system` - System messages (centered, italic)
- `.status-indicator.connected` - Green pulse
- `.status-indicator.disconnected` - Red static

---

#### app.js
**Lines**: ~400  
**Language**: JavaScript (ES6+)  
**Purpose**: Main application logic  
**Contains**:
- `ChatApp` class with all application logic
- Cognito authentication
- WebSocket connection management
- Message sending and receiving
- Room switching
- Local storage for session persistence

**Key Methods**:
- `handleLogin()` - Process login form
- `connectWebSocket()` - Establish WebSocket connection
- `handleSendMessage()` - Send message to server
- `displayMessage()` - Add message to UI
- `switchRoom()` - Change active room
- `handleLogout()` - Clear session and return to login

**Data Flow**:
1. User logs in → Token stored in localStorage
2. WebSocket connects with token in URL
3. User sends message → Sent to server via WebSocket
4. Server broadcasts to all users → Message received
5. JavaScript adds to UI with username and timestamp

---

#### config.js
**Lines**: ~35  
**Language**: JavaScript  
**Purpose**: Frontend configuration  
**Contains**:
- Cognito settings (region, user pool, client)
- API endpoints (WebSocket and REST)
- WebSocket retry settings
- UI configuration (default room, message limit)

**Important Variables**:
```javascript
CONFIG.API_GATEWAY_ENDPOINT = "wss://..."  // WebSocket URL
CONFIG.API_REST_ENDPOINT = "https://..."   // REST API URL
CONFIG.WEBSOCKET_RECONNECT_DELAY = 3000    // Milliseconds
CONFIG.WEBSOCKET_MAX_RETRIES = 5           // Attempt count
```

**Setup**:
- Development: Use localhost:8000
- Production: Use CloudFront domain

---

## How Files Work Together

### Authentication Flow
```
frontend/config.js (Cognito settings)
         ↓
frontend/app.js (handleLogin)
         ↓
backend/app.py (verify JWT)
         ↓
backend/auth.py (validate token)
         ↓
Success: User authenticated
```

### Message Flow
```
frontend/app.js (handleSendMessage)
         ↓
WebSocket: {"text": "Hello", "room_id": "general"}
         ↓
backend/app.py (websocket_endpoint)
         ↓
backend/db.py (store_message)
         ↓
DynamoDB: Save message
         ↓
backend/app.py (manager.broadcast)
         ↓
WebSocket: All users receive message
         ↓
frontend/app.js (displayMessage)
         ↓
frontend/index.html + frontend/styles.css (Render message)
```

### Configuration Flow
```
.env (AWS credentials)
  ↓
config.py (Load settings)
  ↓
app.py (Use configuration)
  ├─ auth.py (Get Cognito details)
  └─ db.py (Get DynamoDB table)

frontend/config.js (API endpoints)
  ↓
app.js (Connect to API)
```

---

## Testing Each File

### Test Backend
```bash
# Test configuration loads
python -c "from config import AWS_REGION; print(AWS_REGION)"
# Expected: us-east-1

# Test models
python -c "from models import ChatMessage; m = ChatMessage(username='test', text='hi', room_id='general'); print(m.json())"

# Test DynamoDB connection
python -c "from db import db_manager; print('Connected')"

# Run server
python -m uvicorn app:app --reload
# Open http://localhost:8000/docs (Swagger UI)
# Check /health endpoint
```

### Test Frontend
```bash
# Check HTML validity
python -m http.server 3000

# Open http://localhost:3000
# Check browser console for errors (F12)
# Test login form
# Check DevTools Network tab for WebSocket connections
```

---

## File Dependencies

### Backend Dependencies
```
app.py
├─ requires: config.py
├─ requires: auth.py
├─ requires: db.py
├─ requires: models.py
└─ uses: requirements.txt
    ├─ fastapi
    ├─ uvicorn
    ├─ boto3
    ├─ python-jose
    └─ python-dotenv
```

### Frontend Dependencies
```
index.html
├─ loads: styles.css
├─ loads: config.js
└─ loads: app.js
    └─ requires: config.js
```

---

## Deployment Checklist

### Before Deployment
- [ ] All files copied to EC2
- [ ] `.env` created with AWS credentials
- [ ] DynamoDB table created
- [ ] Cognito user pool created
- [ ] Test users created in Cognito
- [ ] S3 bucket created
- [ ] CloudFront distribution created

### Deployment Steps
1. Copy backend files to EC2
2. Create `.env` file with credentials
3. Install dependencies: `pip install -r requirements.txt`
4. Test locally: `python -m uvicorn app:app --reload`
5. Create systemd service for production
6. Upload frontend files to S3
7. Test CloudFront distribution
8. Update config.js with CloudFront domain
9. Re-upload frontend files
10. Test end-to-end

---

## File Sizes (Approximate)

| File | Size | Type |
|------|------|------|
| CHAT_APP_GUIDE.md | 50KB | Documentation |
| QUICKSTART.md | 15KB | Documentation |
| app.py | 15KB | Python |
| auth.py | 5KB | Python |
| config.py | 2KB | Python |
| models.py | 3KB | Python |
| db.py | 5KB | Python |
| requirements.txt | 0.5KB | Text |
| .env.example | 0.5KB | Text |
| index.html | 6KB | HTML |
| styles.css | 12KB | CSS |
| app.js | 18KB | JavaScript |
| config.js | 1KB | JavaScript |
| **TOTAL** | **~133KB** | - |

---

## Version Control

### What to Commit
```
✓ All .py files
✓ All .js files
✓ All .html/.css files
✓ requirements.txt
✓ .env.example
✓ .gitignore
✓ README files
```

### What NOT to Commit
```
✗ .env (has credentials!)
✗ __pycache__/
✗ *.pyc
✗ venv/
✗ node_modules/
✗ .DS_Store
✗ *.log
```

### .gitignore
```
.env
.env.local
__pycache__/
*.pyc
venv/
.vscode/
.idea/
*.log
*.swp
.DS_Store
```

---

## Common Edits

### To Change API Endpoint
Edit `frontend/config.js`:
```javascript
API_GATEWAY_ENDPOINT: "wss://your-new-domain.cloudfront.net"
```

### To Change Database Table
Edit `.env`:
```
DYNAMODB_TABLE=new_table_name
```

### To Change Cognito Settings
Edit `.env`:
```
COGNITO_USER_POOL_ID=us-east-1_newpoolid
COGNITO_CLIENT_ID=newclientid
```

### To Change Port
Edit `app.py` (bottom):
```python
uvicorn.run(app, host="0.0.0.0", port=9000)
```

---

**Ready to deploy? Start with QUICKSTART.md for the 5-minute setup, then refer to CHAT_APP_GUIDE.md for production deployment.**
