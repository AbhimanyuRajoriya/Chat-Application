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
