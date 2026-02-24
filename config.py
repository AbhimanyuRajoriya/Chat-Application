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
