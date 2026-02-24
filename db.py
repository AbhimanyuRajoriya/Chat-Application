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
        Retrieve messages from a room (PERSISTENT - from DynamoDB)
        
        Args:
            room_id: Chat room identifier
            limit: Maximum messages to retrieve (default 50, max 100)
            
        Returns:
            List of MessageResponse objects (sorted chronologically)
        """
        try:
            # Ensure limit is reasonable
            if limit > 100:
                limit = 100
            if limit < 1:
                limit = 1
            
            # Query DynamoDB for messages in this room
            response = self.table.query(
                KeyConditionExpression="room_id = :room_id",
                ExpressionAttributeValues={":room_id": room_id},
                Limit=limit,
                ScanIndexForward=False  # Most recent first (reverse order)
            )
            
            # Convert to MessageResponse objects
            messages = []
            items = response.get("Items", [])
            
            # Reverse to get chronological order (oldest first)
            for item in reversed(items):
                messages.append(MessageResponse(**item))
            
            logger.info(f"✅ Retrieved {len(messages)} messages from room '{room_id}' (persistent)")
            return messages
            
        except Exception as e:
            logger.error(f"❌ Error retrieving messages from DynamoDB: {e}")
            return []
    
    async def get_recent_messages(self, room_id: str, since_timestamp: str = None) -> list:
        """
        Get messages since a specific timestamp
        Useful for incremental updates
        
        Args:
            room_id: Chat room identifier
            since_timestamp: Only get messages after this timestamp
            
        Returns:
            List of new MessageResponse objects
        """
        try:
            if since_timestamp:
                response = self.table.query(
                    KeyConditionExpression="room_id = :room_id AND #ts > :ts",
                    ExpressionAttributeNames={"#ts": "timestamp"},
                    ExpressionAttributeValues={
                        ":room_id": room_id,
                        ":ts": since_timestamp
                    },
                    Limit=100,
                    ScanIndexForward=True  # Oldest first
                )
            else:
                response = self.table.query(
                    KeyConditionExpression="room_id = :room_id",
                    ExpressionAttributeValues={":room_id": room_id},
                    Limit=100,
                    ScanIndexForward=True
                )
            
            messages = [MessageResponse(**item) for item in response.get("Items", [])]
            return messages
            
        except Exception as e:
            logger.error(f"❌ Error retrieving recent messages: {e}")
            return []
    
    async def clear_room_messages(self, room_id: str) -> bool:
        """
        Delete all messages from a room (for cleanup)
        
        Args:
            room_id: Chat room identifier
            
        Returns:
            True if successful
        """
        try:
            # Get all messages in room
            response = self.table.query(
                KeyConditionExpression="room_id = :room_id",
                ExpressionAttributeValues={":room_id": room_id}
            )
            
            # Delete each message
            with self.table.batch_writer() as batch:
                for item in response.get("Items", []):
                    batch.delete_item(
                        Key={
                            "room_id": item["room_id"],
                            "timestamp": item["timestamp"]
                        }
                    )
            
            logger.info(f"✅ Cleared {len(response.get('Items', []))} messages from room '{room_id}'")
            return True
            
        except Exception as e:
            logger.error(f"❌ Error clearing room messages: {e}")
            return False

# Global DynamoDB manager instance
db_manager = DynamoDBManager()
