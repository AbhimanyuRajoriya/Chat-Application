# Real-Time Chat Application - Quick Start Guide

## Overview

A complete real-time chat application built with:
- **Backend**: FastAPI + WebSocket + JWT Authentication
- **Frontend**: HTML/JavaScript + Cognito Login
- **Database**: AWS DynamoDB
- **Deployment**: AWS EC2 + S3 + CloudFront

---

## Files Included

### Backend Files
- `app.py` - FastAPI application with WebSocket
- `config.py` - Configuration management
- `auth.py` - JWT validation from Cognito
- `db.py` - DynamoDB operations
- `models.py` - Pydantic data models
- `requirements.txt` - Python dependencies
- `.env.example` - Environment variables template

### Frontend Files
- `index.html` - Single-page application
- `styles.css` - Complete styling
- `app.js` - JavaScript logic
- `config.js` - Frontend configuration

### Documentation
- `CHAT_APP_GUIDE.md` - Complete deployment guide (9 sections)

---

## Quick Start (Local Development)

### 1. Setup Backend

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Copy environment file
cp .env.example .env

# Edit .env with your AWS credentials
nano .env

# Run backend
python -m uvicorn app:app --host 0.0.0.0 --port 8000 --reload
```

**Output**:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete
```

### 2. Setup Frontend

```bash
# Start simple HTTP server
cd frontend
python -m http.server 3000
```

Open browser: `http://localhost:3000`

### 3. Test Login

```
Username: testuser
Password: password123
Click "Login with Cognito"
```

### 4. Test Chat

1. Type message: "Hello World"
2. Click "Send"
3. See message appear with timestamp
4. Try multiple rooms

---

## AWS Deployment Overview

### Prerequisites
- AWS Account with appropriate IAM permissions
- AWS CLI configured
- Python 3.9+

### Step-by-Step Deployment

#### 1. Create DynamoDB Table
```bash
aws dynamodb create-table \
  --table-name chat_messages \
  --attribute-definitions AttributeName=room_id,AttributeType=S AttributeName=timestamp,AttributeType=S \
  --key-schema AttributeName=room_id,KeyType=HASH AttributeName=timestamp,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

#### 2. Create Cognito User Pool
```bash
aws cognito-idp create-user-pool --pool-name ChatAppUserPool
aws cognito-idp create-user-pool-client --user-pool-id us-east-1_xxx --client-name ChatAppClient
```

#### 3. Launch EC2 Instance
```bash
aws ec2 run-instances \
  --image-id ami-0c55b159cbfafe1f0 \
  --instance-type t3.medium \
  --key-name your-key-pair \
  --region us-east-1
```

#### 4. Configure EC2
```bash
ssh ubuntu@your-instance-ip
sudo apt update && sudo apt upgrade -y
sudo apt install python3-pip python3-venv nginx

git clone your-repo
cd chat-app-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Create .env file with credentials
nano .env

# Setup systemd service
sudo systemctl enable chat-app
sudo systemctl start chat-app
```

#### 5. Create S3 Bucket
```bash
aws s3 mb s3://my-chat-app-frontend
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete
```

#### 6. Setup CloudFront
Create distribution with:
- Origin 1: S3 bucket (frontend)
- Origin 2: EC2 instance (backend)
- Default behavior: S3
- Cache behavior for /ws/* → EC2

#### 7. Update Frontend Config
Edit `frontend/config.js`:
```javascript
API_GATEWAY_ENDPOINT: "wss://your-cloudfront-domain.cloudfront.net"
API_REST_ENDPOINT: "https://your-cloudfront-domain.cloudfront.net"
```

Redeploy:
```bash
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete
```

---

## Testing Checklist

- [ ] Backend health check: `curl http://localhost:8000/health`
- [ ] Frontend loads at `http://localhost:3000`
- [ ] Login works with test credentials
- [ ] WebSocket connects (check browser DevTools > Network > WS)
- [ ] Messages send and receive in real-time
- [ ] Message history loads on page refresh
- [ ] Multiple rooms work independently
- [ ] Join/leave messages show correctly
- [ ] Multiple users can chat simultaneously
- [ ] Messages store in DynamoDB
- [ ] Reconnection works after disconnect

---

## Common Commands

### Backend
```bash
# Start development server
python -m uvicorn app:app --reload

# Check logs
journalctl -u chat-app -f

# Restart service
sudo systemctl restart chat-app
```

### DynamoDB
```bash
# Query messages
aws dynamodb scan --table-name chat_messages

# Get messages from specific room
aws dynamodb query \
  --table-name chat_messages \
  --key-condition-expression "room_id = :room" \
  --expression-attribute-values '{":room":{"S":"general"}}'
```

### Frontend Deployment
```bash
# Upload to S3
aws s3 sync frontend/ s3://my-chat-app-frontend/ --delete

# Invalidate CloudFront
aws cloudfront create-invalidation \
  --distribution-id E123ABC \
  --paths "/*"
```

### Cognito
```bash
# Create user
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_xxx \
  --username alice

# Set password
aws cognito-idp admin-set-user-password \
  --user-pool-id us-east-1_xxx \
  --username alice \
  --password Password123! \
  --permanent
```

---

## Architecture

```
Client Browser
    ↓ HTTPS
CloudFront (CDN)
    ├─ /static → S3 (frontend)
    └─ /ws, /api → EC2 (backend)
         ↓
    FastAPI Server (EC2)
         ↓
    DynamoDB (messages)
         ↓
    Cognito (auth)
```

---

## Performance Tips

1. **Enable CloudFront caching** - Cache static assets for 1 hour
2. **Use DynamoDB on-demand** - Scales automatically
3. **Enable EC2 auto-scaling** - Handle traffic spikes
4. **Setup CloudWatch monitoring** - Monitor logs and metrics
5. **Enable encryption** - TLS/SSL for all connections

---

## Troubleshooting

### WebSocket Connection Fails
- Check JWT token in browser DevTools
- Verify Cognito credentials in .env
- Check security groups allow port 443

### Messages Not Storing
- Verify AWS credentials have DynamoDB access
- Check IAM role permissions
- Ensure table exists: `aws dynamodb describe-table --table-name chat_messages`

### Frontend Shows 404
- Check S3 bucket policy
- Verify CloudFront origin access identity
- Clear CloudFront cache

### High Latency
- Check EC2 CPU usage
- Scale up instance type (t3.medium → t3.large)
- Enable compression in CloudFront

---

## Next Steps

1. **Add SSL Certificate** - AWS Certificate Manager
2. **Setup CI/CD** - GitHub Actions or AWS CodePipeline
3. **Add Monitoring** - CloudWatch dashboards
4. **Add Notifications** - Email/SMS alerts
5. **Scale Database** - RDS for analytics
6. **Add User Presence** - Redis for online status
7. **Add File Sharing** - S3 integration
8. **Add Search** - Elasticsearch

---

## Support

For detailed instructions, see: `CHAT_APP_GUIDE.md`

This guide includes:
1. Architecture overview
2. Project structure
3. Backend code explanation
4. Frontend code explanation
5. Database setup
6. Cognito configuration
7. EC2 deployment
8. S3 + CloudFront setup
9. Complete testing guide

---

**Version**: 1.0.0
**Last Updated**: 2024-01-15
**Status**: Production Ready
