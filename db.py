# db.py
import os
import boto3
import logging
from datetime import datetime
from boto3.dynamodb.conditions import Key

logger = logging.getLogger(__name__)

DYNAMODB_TABLE = os.getenv("DYNAMODB_TABLE", "chat-message")
DYNAMODB_REGION = os.getenv("AWS_REGION", os.getenv("AWS_DEFAULT_REGION", "us-east-1"))


class DynamoDBManager:
    """Handles all DynamoDB operations"""

    def __init__(self):
        # IMPORTANT:
        # Do NOT force credentials here.
        # Let boto3 use the default chain:
        # - env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY)
        # - EC2 IAM role (best)
        # - shared credentials file (if present)
        self.dynamodb = boto3.resource("dynamodb", region_name=DYNAMODB_REGION)
        self.table = self.dynamodb.Table(DYNAMODB_TABLE)

        # fail fast if table/creds are wrong
        try:
            self.table.load()
            logger.info(f"✅ DynamoDB connected: table={DYNAMODB_TABLE}, region={DYNAMODB_REGION}")
        except Exception as e:
            logger.error(f"❌ DynamoDB NOT ready: {e}")
            # keep table object, but calls will fail and be logged

    async def store_message(self, room_id: str, username: str, text: str) -> bool:
        try:
            timestamp = datetime.utcnow().isoformat() + "Z"

            self.table.put_item(
                Item={
                    "room_id": room_id,
                    "timestamp": timestamp,
                    "username": username,   # store email here
                    "text": text
                }
            )

            logger.info(f"✅ Stored message - room={room_id}, user={username}")
            return True
        except Exception as e:
            logger.error(f"❌ Error storing message: {e}")
            return False

    async def get_messages(self, room_id: str, limit: int = 50) -> list:
        try:
            if limit > 100:
                limit = 100
            if limit < 1:
                limit = 1

            resp = self.table.query(
                KeyConditionExpression=Key("room_id").eq(room_id),
                Limit=limit,
                ScanIndexForward=False  # newest first
            )

            items = resp.get("Items", [])
            # return oldest->newest for UI
            items.reverse()

            logger.info(f"✅ Retrieved {len(items)} messages from room='{room_id}'")
            return items
        except Exception as e:
            logger.error(f"❌ Error retrieving messages: {e}")
            return []


db_manager = DynamoDBManager()