import boto3
import logging
from datetime import datetime

from boto3.dynamodb.conditions import Key  # ✅ IMPORTANT

from config import DYNAMODB_TABLE, DYNAMODB_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
from models import MessageResponse

logger = logging.getLogger(__name__)

class DynamoDBManager:
    """Handles all DynamoDB operations"""

    def __init__(self):
        # If you're using IAM Role on EC2, you should NOT pass access keys.
        # But keeping your current setup to avoid breaking your env.
        self.dynamodb = boto3.resource(
            "dynamodb",
            region_name=DYNAMODB_REGION,
            aws_access_key_id=AWS_ACCESS_KEY_ID or None,
            aws_secret_access_key=AWS_SECRET_ACCESS_KEY or None
        )
        self.table = self.dynamodb.Table(DYNAMODB_TABLE)

    async def store_message(self, room_id: str, username: str, text: str) -> bool:
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

            logger.info(f"✅ DynamoDB stored - Room: {room_id}, User: {username}, TS: {timestamp}")
            return True

        except Exception as e:
            logger.exception(f"❌ DynamoDB put_item failed: {e}")  # ✅ shows full error
            return False

    async def get_messages(self, room_id: str, limit: int = 50) -> list:
        try:
            if limit > 100:
                limit = 100
            if limit < 1:
                limit = 1

            response = self.table.query(
                KeyConditionExpression=Key("room_id").eq(room_id),  # ✅ FIX
                Limit=limit,
                ScanIndexForward=False  # newest first
            )

            items = response.get("Items", [])
            messages = [MessageResponse(**item) for item in reversed(items)]  # oldest first

            logger.info(f"✅ Retrieved {len(messages)} messages from room '{room_id}' (persistent)")
            return messages

        except Exception as e:
            logger.exception(f"❌ Error retrieving messages from DynamoDB: {e}")
            return []

    async def get_recent_messages(self, room_id: str, since_timestamp: str = None) -> list:
        try:
            if since_timestamp:
                response = self.table.query(
                    KeyConditionExpression=Key("room_id").eq(room_id) & Key("timestamp").gt(since_timestamp),  # ✅ FIX
                    Limit=100,
                    ScanIndexForward=True  # oldest first
                )
            else:
                response = self.table.query(
                    KeyConditionExpression=Key("room_id").eq(room_id),  # ✅ FIX
                    Limit=100,
                    ScanIndexForward=True
                )

            return [MessageResponse(**item) for item in response.get("Items", [])]

        except Exception as e:
            logger.exception(f"❌ Error retrieving recent messages: {e}")
            return []

    async def clear_room_messages(self, room_id: str) -> bool:
        try:
            response = self.table.query(
                KeyConditionExpression=Key("room_id").eq(room_id)  # ✅ FIX
            )

            items = response.get("Items", [])

            with self.table.batch_writer() as batch:
                for item in items:
                    batch.delete_item(
                        Key={
                            "room_id": item["room_id"],
                            "timestamp": item["timestamp"]
                        }
                    )

            logger.info(f"✅ Cleared {len(items)} messages from room '{room_id}'")
            return True

        except Exception as e:
            logger.exception(f"❌ Error clearing room messages: {e}")
            return False

db_manager = DynamoDBManager()